const test = require('node:test'),
  assert = require('node:assert/strict'),
  crypto = require('node:crypto');
const H = require('../habit-rewards-core.js');
test('повтор старой команды после следующего цикла не меняет отметку и монеты', () => {
  let { tracker, coins } = fixture();
  const a = command(0, 1),
    b = command(1, 0.5),
    c = command(0.5, 0);
  for (const cmd of [a, b, c]) {
    const change = H.prepareChange(tracker, coins, cmd);
    coins = H.applyCoinChange(coins, change);
    tracker = H.applyTrackerChange(tracker, change);
  }
  const before = JSON.stringify({ tracker, coins }),
    repeat = H.prepareChange(tracker, coins, a);
  coins = H.applyCoinChange(coins, repeat);
  tracker = H.applyTrackerChange(tracker, repeat);
  assert.equal(JSON.stringify({ tracker, coins }), before);
  assert.throws(
    () => H.prepareChange(tracker, coins, { ...a, targetMark: 0.5 }),
    /OPERATION_CONFLICT/,
  );
});
function fixture(mark = 0) {
  return {
    tracker: {
      good: [{ id: 'sleep', name: 'Сон' }],
      bad: [],
      marks: mark ? { 'sleep:2026-10-24': mark } : {},
    },
    coins: { balance: 0, earned: 0, spent: 4, history: [] },
  };
}
function command(expectedMark, targetMark, extra = {}) {
  return {
    operationId: crypto.randomUUID(),
    habitId: 'sleep',
    date: '2026-10-24',
    expectedMark,
    targetMark,
    owner: 'local',
    at: '2026-10-24T12:00:00Z',
    ...extra,
  };
}
test('цикл отметок корректирует чистые выплаты без накрутки заработанного', () => {
  let { tracker, coins } = fixture();
  for (const [old, next, delta] of [
    [0, 1, 2],
    [1, 0.5, -1],
    [0.5, 0, -1],
    [0, 1, 2],
  ]) {
    const change = H.prepareChange(tracker, coins, command(old, next));
    assert.equal(change.delta, delta);
    coins = H.applyCoinChange(coins, change);
    tracker = H.applyTrackerChange(tracker, change);
  }
  assert.equal(coins.balance, 2);
  assert.equal(coins.earned, 2);
  assert.equal(coins.spent, 4);
  assert.equal(coins.habitRewardsV1['sleep:2026-10-24'].paid, 2);
});
test('неоплаченные старые marks не создают несуществующее списание', () => {
  const a = fixture(1),
    change = H.prepareChange(a.tracker, a.coins, command(1, 0.5));
  assert.equal(change.delta, 1);
  assert.equal(H.applyCoinChange(a.coins, change).balance, 1);
  const b = fixture(0.5);
  assert.equal(H.prepareChange(b.tracker, b.coins, command(0.5, 0)).delta, 0);
  assert.equal(a.coins.balance, 0);
});
test('повтор команды идемпотентен даже после записи только монет', () => {
  const f = fixture(),
    cmd = command(0, 1),
    change = H.prepareChange(f.tracker, f.coins, cmd),
    paid = H.applyCoinChange(f.coins, change);
  const again = H.prepareChange(f.tracker, paid, cmd);
  assert.deepEqual(H.applyCoinChange(paid, again), paid);
  assert.equal(
    H.applyTrackerChange(f.tracker, again).marks['sleep:2026-10-24'],
    1,
  );
  assert.throws(
    () => H.prepareChange(f.tracker, paid, { ...cmd, targetMark: 0.5 }),
    /OPERATION_CONFLICT/,
  );
});
test('stale ввод и повреждённые деньги не проходят, посторонние поля сохраняются', () => {
  const f = fixture();
  assert.throws(
    () => H.prepareChange(f.tracker, f.coins, command(1, 0.5)),
    /STALE/,
  );
  assert.throws(() =>
    H.prepareChange(f.tracker, f.coins, command(0, 1, { habitId: 'unknown' })),
  );
  assert.throws(() =>
    H.prepareChange(f.tracker, { ...f.coins, balance: NaN }, command(0, 1)),
  );
  assert.throws(() =>
    H.prepareChange(f.tracker, f.coins, command(0, 1, { date: '2026-02-30' })),
  );
  const c = H.applyCoinChange(
    { ...f.coins, custom: 7 },
    H.prepareChange(f.tracker, f.coins, command(0, 1)),
  );
  assert.equal(c.custom, 7);
  assert.equal(f.tracker.marks['sleep:2026-10-24'], undefined);
});
