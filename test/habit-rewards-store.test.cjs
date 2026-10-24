const test = require('node:test'),
  assert = require('node:assert/strict'),
  crypto = require('node:crypto');
const H = require('../habit-rewards-store.js'),
  B = require('../browser-lock.js');
function harness() {
  const values = new Map([
    [
      'tracker_v1',
      JSON.stringify({ good: [{ id: 'h', name: 'сон' }], bad: [], marks: {} }),
    ],
    [
      'coins_v1',
      JSON.stringify({
        balance: 10,
        earned: 10,
        spent: 0,
        history: [],
        custom: 7,
      }),
    ],
  ]);
  let failAt = 0,
    count = 0,
    owner = 'local',
    tail = Promise.resolve(),
    afterCoin = null;
  const get = (k) => JSON.parse(values.get(k) || 'null');
  const storage = {
    getItem: (k) => values.get(k) || null,
    setItem(k, v) {
      if (++count === failAt) throw Error('quota');
      values.set(k, v);
    },
    removeItem(k) {
      if (++count === failAt) throw Error('quota');
      values.delete(k);
    },
  };
  const lock = B.create({
    locks: {
      request(_n, _o, fn) {
        const p = tail.then(() => fn());
        tail = p.catch(() => {});
        return p;
      },
    },
  });
  const service = H.create({
    get,
    set(k, v) {
      storage.setItem(k, JSON.stringify(v));
      if (k === 'coins_v1' && afterCoin) afterCoin(values);
    },
    runtimeStorage: storage,
    getOwner: () => owner,
    withLock: lock.withLock,
    now: () => '2026-10-24T12:00:00Z',
    uuid: crypto.randomUUID,
  });
  return {
    service,
    get,
    values,
    owner: (v) => (owner = v),
    fail: (v) => {
      failAt = v;
      count = 0;
    },
    after: (v) => (afterCoin = v),
  };
}
const opts = () => ({ expectedMark: 0, operationId: crypto.randomUUID() });
test('каждая точка сбоя восстанавливает только одну принятую выплату', async () => {
  for (const at of [1, 2, 3, 4]) {
    const h = harness(),
      o = opts();
    h.fail(at);
    await assert.rejects(h.service.setGoodMark('h', '2026-10-24', 1, o));
    h.fail(0);
    await h.service.recover();
    if (at === 1) {
      assert.equal(h.get('coins_v1').balance, 10);
      assert.equal(h.get('tracker_v1').marks['h:2026-10-24'], undefined);
    } else {
      assert.equal(h.get('coins_v1').balance, 12);
      assert.equal(h.get('tracker_v1').marks['h:2026-10-24'], 1);
      assert.equal(h.get('coins_v1').history.length, 1);
    }
    await h.service.recover();
  }
});
test('восстановление не затирает новые посторонние монеты и поля', async () => {
  const h = harness();
  h.fail(3);
  await assert.rejects(h.service.setGoodMark('h', '2026-10-24', 1, opts()));
  h.fail(0);
  const fresh = h.get('coins_v1');
  fresh.balance += 30;
  fresh.earned += 30;
  h.values.set('coins_v1', JSON.stringify(fresh));
  await h.service.recover();
  assert.equal(h.get('coins_v1').balance, 42);
  assert.equal(h.get('coins_v1').custom, 7);
});
test('две одинаковые команды не выдают две награды и чужой журнал не применяется', async () => {
  const h = harness(),
    o = opts();
  await Promise.all([
    h.service.setGoodMark('h', '2026-10-24', 1, o),
    h.service.setGoodMark('h', '2026-10-24', 1, o),
  ]);
  assert.equal(h.get('coins_v1').balance, 12);
  const a = harness();
  a.fail(3);
  await assert.rejects(a.service.setGoodMark('h', '2026-10-24', 1, opts()));
  a.fail(0);
  a.owner('other');
  await a.service.recover();
  assert.equal(a.get('tracker_v1').marks['h:2026-10-24'], undefined);
});
test('синхронные достижения после записи монет не затираются второй записью', async () => {
  const h = harness();
  h.after((values) => {
    const c = JSON.parse(values.get('coins_v1'));
    c.balance += 5;
    c.earned += 5;
    values.set('coins_v1', JSON.stringify(c));
  });
  await h.service.setGoodMark('h', '2026-10-24', 1, opts());
  assert.equal(h.get('coins_v1').balance, 17);
  assert.equal(h.get('coins_v1').earned, 17);
});
