const test = require('node:test'),
  assert = require('node:assert/strict'),
  crypto = require('node:crypto');
const D = require('../eyes-data.js'),
  Store = require('../eyes-store.js');
const NOW = '2026-10-24T12:00:00Z';
function record(o = {}) {
  return {
    version: 1,
    id: crypto.randomUUID(),
    epoch: 'initial',
    completedAt: NOW,
    durationSeconds: 30,
    mode: 'short',
    exerciseIds: ['horizontal', 'vertical', 'blinking'],
    ...o,
  };
}
function harness() {
  const map = new Map(),
    writes = [];
  let owner = 'local',
    fail = false;
  const storage = {
    get length() {
      return map.size;
    },
    key(i) {
      return [...map.keys()][i] || null;
    },
    getItem(k) {
      return map.get(k) || null;
    },
    setItem(k, v) {
      if (fail) throw Error('quota');
      map.set(k, v);
    },
    removeItem(k) {
      if (fail) throw Error('quota');
      map.delete(k);
    },
  };
  const s = Store.create({
    storage,
    get: (k) => JSON.parse(storage.getItem(k)),
    set: (k, v) => {
      storage.setItem(k, JSON.stringify(v));
      writes.push(k);
    },
    getOwner: () => owner,
    uuid: crypto.randomUUID,
    now: () => NOW,
  });
  return { s, map, writes, owner: (v) => (owner = v), fail: (v) => (fail = v) };
}
test('завершения идемпотентны и не теряются при добавлении разных записей', () => {
  const h = harness(),
    r = record();
  h.s.recordCompletion(r);
  h.s.recordCompletion(r);
  assert.equal(h.s.summary().sessions, 1);
  assert.equal(h.s.summary().minutes, 0.5);
  assert.equal(h.writes.length, 1);
  h.s.recordCompletion(record());
  assert.equal(h.s.summary().sessions, 2);
  assert.throws(() => h.s.recordCompletion({ ...r, durationSeconds: 60 }));
});
test('серия проходит полночь екатеринбурга и сохраняет вчерашнее достижение', () => {
  const rows = [
    record({ completedAt: '2026-10-22T19:00:00Z' }),
    record({ completedAt: '2026-10-23T19:00:00Z' }),
  ];
  assert.equal(
    D.summarize(rows, 'initial', '2026-10-24T19:00:00Z').streakDays,
    2,
  );
  assert.equal(
    D.summarize(rows, 'initial', '2026-10-25T19:00:00Z').streakDays,
    0,
  );
  assert.equal(
    D.summarize(
      [record({ completedAt: '2099-01-01T00:00:00Z' })],
      'initial',
      NOW,
    ).sessions,
    0,
  );
});
test('сброс меняет только поколение и не возвращает старые сессии', () => {
  const h = harness();
  h.s.saveSettings({ speed: 'fast' });
  h.s.recordCompletion(record());
  const epoch = h.s.resetStats();
  assert.equal(h.s.summary().sessions, 0);
  assert.equal(h.s.settings().speed, 'fast');
  h.s.recordCompletion(record({ epoch }));
  assert.equal(h.s.summary().sessions, 1);
  assert.equal(h.s.records().length, 2);
});
test('чтение повреждённых данных не пишет defaults и чужой active не восстанавливается', () => {
  const h = harness();
  h.map.set('eye_break_settings_v1', 'bad');
  assert.equal(h.s.settings().durationSeconds, 60);
  assert.equal(h.writes.length, 0);
  h.s.saveActive({ owner: 'local', phase: 'paused' });
  h.owner('u2');
  assert.equal(h.s.loadActive(), null);
  assert.throws(() => h.s.saveActive({ owner: 'local' }));
});
test('ошибки storage не маскируются под сохранённую статистику', () => {
  const h = harness();
  h.fail(true);
  assert.throws(() => h.s.recordCompletion(record()), /quota/);
  assert.equal(h.s.summary().sessions, 0);
  assert.equal(D.validateRecord(record({ durationSeconds: 9999 })), null);
  assert.equal(
    D.validateRecord(record({ completedAt: '2026-02-30T12:00:00Z' })),
    null,
  );
  assert.equal(
    D.validateRecord(
      record({
        mode: 'reminder',
        durationSeconds: 20,
        exerciseIds: ['distance'],
      }),
    ).durationSeconds,
    20,
  );
});
