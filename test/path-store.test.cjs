const test = require('node:test');
const assert = require('node:assert/strict');
const P = require('../path-core.js');
const Store = require('../path-store.js');
function fixture() {
  const values = new Map();
  const events = new EventTarget();
  let blocked = false;
  const storage = {
    getItem: (k) => values.get(k) ?? null,
    setItem(k, v) {
      if (blocked) throw new Error('quota');
      values.set(k, v);
    },
  };
  const s = Store.create({
    storage,
    events,
    write(k, v) {
      storage.setItem(k, JSON.stringify(v));
    },
  });
  return {
    s,
    values,
    events,
    block() {
      blocked = true;
    },
  };
}
test('чтение пустого пути не создаёт данные, создание выполняется явно', () => {
  const { s, values } = fixture();
  assert.equal(s.read(), null);
  assert.equal(values.size, 0);
  s.initialize('2026-10-23T12:00:00Z');
  assert.equal(s.read().stages.length, 1);
  assert.throws(() => s.initialize(), { code: 'PATH_EXISTS' });
});
test('неизвестная схема и повреждённый json сохраняются без автоматического сброса', () => {
  const { s, values } = fixture();
  values.set(P.KEY, '{"schemaVersion":9}');
  assert.throws(() => s.read(), { code: 'UNSUPPORTED_VERSION' });
  assert.throws(() => s.initialize(), { code: 'UNSUPPORTED_VERSION' });
  assert.equal(values.get(P.KEY), '{"schemaVersion":9}');
  values.set(P.KEY, 'oops');
  assert.throws(() => s.read(), { code: 'INVALID_DATA' });
});
test('устаревший редактор не перезаписывает изменение из другой вкладки', () => {
  const { s } = fixture();
  const first = s.initialize();
  s.update(first.revision, (p) =>
    P.updateAvatar(p, { skin: '#d1a090', hair: '#101010' }),
  );
  assert.throws(
    () =>
      s.update(first.revision, (p) =>
        P.updateAvatar(p, { skin: '#ffffff', hair: '#ffffff' }),
      ),
    { code: 'STALE_REVISION' },
  );
  assert.equal(s.read().avatar.hair, '#101010');
});
test('ошибка сохранения не заменяет успешно сохранённый путь', () => {
  const { s, block } = fixture();
  const first = s.initialize();
  block();
  assert.throws(() =>
    s.update(first.revision, (p) =>
      P.updateAvatar(p, { skin: '#ffffff', hair: '#ffffff' }),
    ),
  );
  assert.deepEqual(s.read(), first);
});
test('цели и привычки читаются как источники, не копируются и не изменяются', () => {
  const { s, values } = fixture();
  values.set(
    'horizons_goals_v2',
    JSON.stringify({ goals: [{ id: 'a', done: true }] }),
  );
  values.set(
    'tracker_v1',
    JSON.stringify({ good: [{ id: 'h' }], marks: { 'h:2026-10-23': 1 } }),
  );
  assert.deepEqual(s.sources().goals, [{ id: 'a', done: true }]);
  assert.equal(s.sources().tracker.good[0].id, 'h');
  assert.equal(values.size, 2);
});
test('применение sync и изменение источника уведомляют подписчика, unsubscribe снимает слушатели', () => {
  const { s, events } = fixture();
  let calls = 0;
  const unsub = s.subscribe(() => calls++);
  events.dispatchEvent(new Event('dashboard-sync-applied'));
  events.dispatchEvent(new Event('storage'));
  assert.equal(calls, 2);
  unsub();
  events.dispatchEvent(new Event('storage'));
  assert.equal(calls, 2);
});
