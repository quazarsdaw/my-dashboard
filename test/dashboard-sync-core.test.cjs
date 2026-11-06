const assert = require('node:assert/strict');
const test = require('node:test');
const Core = require('../dashboard-sync-core.js');

const key = 'goals:2026-10-27';
function snapshot(valueText, revision = '1') {
  return { key, exists: revision !== '0', valueText, revision, updatedAt: null };
}
function start(value = 'a') {
  return Core.reduce(Core.create('owner-a', key), { type: 'remote', snapshot: snapshot(value) }).state;
}
function edit(state, valueText) { return Core.reduce(state, { type: 'local_edit', valueText }).state; }
function sending(value = 'b') {
  return Core.reduce(edit(start(), value), { type: 'push_started' }).state;
}

test('поздний ack сохраняет более новую локальную правку', () => {
  const state = edit(sending(), 'c');
  const next = Core.reduce(state, { type: 'push_ok', epoch: 1, snapshot: snapshot('b', '2') });
  assert.equal(next.state.base.valueText, 'b');
  assert.equal(next.state.dirty.valueText, 'c');
  assert.equal(next.state.dirty.epoch, 2);
  assert.equal(next.state.inFlight, null);
  assert.equal(next.effects.length, 0);
});

test('собственный realtime не конфликтует и не удаляет следующую правку', () => {
  const next = Core.reduce(edit(sending(), 'c'), { type: 'remote', snapshot: snapshot('b', '2') });
  assert.equal(next.state.base.revision, '2');
  assert.equal(next.state.dirty.valueText, 'c');
  assert.equal(next.state.conflict, null);
  assert.equal(next.effects.length, 0);
});

test('чужое обновление не затирает dirty и требует явного решения', () => {
  const state = edit(start(), 'b');
  const result = Core.reduce(state, { type: 'remote', snapshot: snapshot('server', '2') });
  assert.equal(result.state.dirty.valueText, 'b');
  assert.equal(result.state.base.valueText, 'a');
  assert.equal(result.state.conflict.remote.valueText, 'server');
  assert.equal(result.effects.some(e => e.type === 'apply'), false);
  assert.equal(Core.reduce(result.state, { type: 'push_started' }).effects.some(e => e.type === 'save'), false);
});

test('неизвестная база не заменяется скачанной revision перед первым push', () => {
  const state = edit(Core.create('owner-a', key), 'offline');
  assert.equal(Core.reduce(state, { type: 'push_started' }).effects.some(e => e.type === 'save'), false);
  const result = Core.reduce(state, { type: 'remote', snapshot: snapshot('server', '5') });
  assert.equal(result.state.base, null);
  assert.equal(result.state.conflict.remote.revision, '5');
  assert.equal(result.state.dirty.valueText, 'offline');
});

test('отсутствие строки и tombstone сохраняют разные базы', () => {
  const missing = Core.reduce(Core.create('owner-a', key), { type: 'remote', snapshot: snapshot(null, '0') }).state;
  const change = Core.reduce(edit(missing, 'new'), { type: 'push_started' });
  assert.deepEqual(change.effects, [{ type: 'save', change: { key, expectedRevision: '0', valueText: 'new' }, epoch: 1 }]);
  const tombstone = Core.reduce(missing, { type: 'remote', snapshot: snapshot(null, '3') }).state;
  assert.equal(tombstone.base.exists, true);
  assert.equal(tombstone.base.revision, '3');
});

test('серверные версии сильнее часов, bigint не округляется', () => {
  const state = Core.reduce(start(), { type: 'remote', snapshot: { ...snapshot('newer', '9007199254740993'), updatedAt: '2000-01-01T00:00:00Z' } }).state;
  const result = Core.reduce(state, { type: 'remote', snapshot: { ...snapshot('older', '9007199254740992'), updatedAt: '2099-01-01T00:00:00Z' } });
  assert.equal(result.state.base.valueText, 'newer');
  assert.equal(result.effects.length, 0);
});

test('смена аккаунта сохраняет pending старого владельца, но игнорирует поздний ack', () => {
  const previous = Core.reduce(sending(), { type: 'account_changed' }).state;
  const result = Core.reduce(previous, { type: 'push_ok', epoch: 1, snapshot: snapshot('b', '2') });
  assert.equal(result.state.owner, 'owner-a');
  assert.equal(result.state.dirty.valueText, 'b');
  assert.equal(result.state.base.revision, '1');
  const other = Core.create('owner-b', key);
  assert.equal(other.dirty, null);
});

test('ошибка сохранения оставляет pending и conflict содержит полный remote', () => {
  const result = Core.reduce(sending(), { type: 'push_failed', current: snapshot('remote', '2') });
  assert.equal(result.state.inFlight, null);
  assert.equal(result.state.dirty.valueText, 'b');
  assert.equal(result.state.conflict.remote.valueText, 'remote');
});

test('авторитетный conflict после legacy delete не теряется из-за revision ноль', () => {
  const result = Core.reduce(sending(), { type: 'push_failed', current: snapshot(null, '0') });
  assert.equal(result.state.conflict.remote.revision, '0');
  assert.equal(result.state.dirty.valueText, 'b');
});

test('решение привязано к точным remote revision и local epoch', () => {
  const conflict = Core.reduce(edit(start(), 'b'), { type: 'remote', snapshot: snapshot('remote', '2') }).state;
  const newer = Core.reduce(conflict, { type: 'remote', snapshot: snapshot('latest', '3') }).state;
  const stale = Core.reduce(newer, { type: 'resolve', choice: 'apply_reviewed_local', remoteRevision: '2', localEpoch: 1 });
  assert.ok(stale.state.conflict);
  assert.equal(stale.effects.some(e => e.type === 'save'), false);
  const accepted = Core.reduce(newer, { type: 'resolve', choice: 'apply_reviewed_local', remoteRevision: '3', localEpoch: 1 }).state;
  assert.equal(accepted.base.revision, '3');
  assert.equal(accepted.dirty.valueText, 'b');
  assert.equal(accepted.conflict, null);
  const remote = Core.reduce(newer, { type: 'resolve', choice: 'use_remote', remoteRevision: '3', localEpoch: 1 });
  assert.equal(remote.state.dirty, null);
  assert.deepEqual(remote.effects, [{ type: 'apply', valueText: 'latest' }]);
});

test('повторная запись того же значения не меняет epoch, reducer не мутирует вход', () => {
  const state = edit(start(), 'b');
  const before = JSON.stringify(state);
  const result = Core.reduce(state, { type: 'local_edit', valueText: 'b' });
  assert.equal(result.state.localEpoch, 1);
  assert.equal(JSON.stringify(state), before);
});
