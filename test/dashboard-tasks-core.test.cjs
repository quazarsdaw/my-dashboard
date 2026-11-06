const assert = require('node:assert/strict');
const test = require('node:test');
const Tasks = require('../dashboard-tasks-core.js');
const uuid = '00000000-0000-4000-8000-000000000001';

test('новая задача получает uuid один раз и сохраняет его после json reload', () => {
  let calls = 0;
  const task = Tasks.createTask({ text: 'дело', description: 'подробности', done: true }, () => { calls++; return uuid; });
  assert.equal(calls, 1);
  assert.equal(task.id, uuid);
  assert.equal(task.done, false);
  assert.equal(JSON.parse(JSON.stringify(task)).id, uuid);
});

test('копия получает новый id, а patch и перенос сохраняют исходный', () => {
  const old = { id: 'legacy-id', text: 'дело', done: false, description: 'описание', subtasks: [{ text: 'этап', done: true }], custom: { a: 1 } };
  const copied = Tasks.createTask(old, () => uuid);
  assert.equal(copied.id, uuid);
  const updated = Tasks.patchTask([old], { id: 'legacy-id' }, { text: 'новое' });
  assert.equal(updated[0].id, 'legacy-id');
  assert.equal(old.text, 'дело');
  const moved = Tasks.moveTask(updated, [], { id: 'legacy-id' });
  assert.deepEqual(moved.source, []);
  assert.deepEqual(moved.destination[0], { ...old, text: 'новое' });
});

test('legacy index не выдаёт id остальным записям и неоднозначность отклоняется', () => {
  const result = Tasks.patchTask([{ text: 'а' }, { text: 'б' }], { index: 1 }, { text: 'в' });
  assert.deepEqual(result, [{ text: 'а' }, { text: 'в' }]);
  assert.throws(() => Tasks.patchTask([{ id: 'a' }, { id: 'a' }], { id: 'a' }, {}), /AMBIGUOUS_TASK/);
  assert.throws(() => Tasks.moveTask([{ id: 'a' }], [{ id: 'a' }], { id: 'a' }), /DUPLICATE_TASK/);
  assert.throws(() => Tasks.patchTask([], { index: 0 }, {}), /TASK_NOT_FOUND/);
});

test('нет crypto или не uuid v4 — создание отклоняется без timestamp fallback', () => {
  for (const create of [undefined, () => 'hg_123', () => '00000000-0000-1000-8000-000000000001']) {
    assert.throws(() => Tasks.createTask({ text: 'а' }, create), /UUID_UNAVAILABLE/);
  }
});

test('версия редактора допускает только собственный ack с тем же содержимым и владельцем', () => {
  const token = { owner: 'u1', key: 'goals:2026-10-27', baseRevision: '1', localEpoch: 2, remoteRevision: null };
  const binding = { serialized: '[1]', token };
  assert.equal(Tasks.documentMatches(binding, '[1]', { ...token, baseRevision: '2' }), true);
  assert.equal(Tasks.documentMatches(binding, '[2]', token), false);
  assert.equal(Tasks.documentMatches(binding, '[1]', { ...token, owner: 'u2' }), false);
  assert.equal(Tasks.documentMatches(binding, '[1]', { ...token, remoteRevision: '3' }), false);
});

test('новая задача из входящих использует границу 06:00 екатеринбурга', () => {
  assert.equal(Tasks.dateKey(new Date('2026-10-27T00:59:59Z')), '2026-10-26');
  assert.equal(Tasks.dateKey(new Date('2026-10-27T01:00:00Z')), '2026-10-27');
  assert.equal(Tasks.dateKey(new Date('2026-10-27T00:30:00Z'), 1), '2026-10-27');
});
