(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.HabitRewardsCore = factory();
})(typeof window === 'object' ? window : globalThis, function () {
  'use strict';
  var UUID =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  function fail(code) {
    throw new Error(code);
  }
  function clone(x) {
    return JSON.parse(JSON.stringify(x));
  }
  function mark(v) {
    return v === 0 || v === 0.5 || v === 1;
  }
  function rewardForMark(value) {
    if (!mark(value)) fail('INVALID_MARK');
    return value * 2;
  }
  function validateCommand(raw) {
    if (
      !raw ||
      !UUID.test(raw.operationId) ||
      typeof raw.habitId !== 'string' ||
      !raw.habitId ||
      raw.habitId.length > 128 ||
      typeof raw.owner !== 'string' ||
      !raw.owner ||
      raw.owner.length > 128 ||
      !mark(raw.expectedMark) ||
      !mark(raw.targetMark) ||
      typeof raw.date !== 'string' ||
      !/^\d{4}-\d\d-\d\d$/.test(raw.date) ||
      !Number.isFinite(Date.parse(raw.date + 'T00:00:00Z')) ||
      new Date(raw.date + 'T00:00:00Z').toISOString().slice(0, 10) !==
        raw.date ||
      typeof raw.at !== 'string' ||
      !Number.isFinite(Date.parse(raw.at))
    )
      fail('INVALID_COMMAND');
    return {
      operationId: raw.operationId,
      habitId: raw.habitId,
      date: raw.date,
      expectedMark: raw.expectedMark,
      targetMark: raw.targetMark,
      owner: raw.owner,
      at: raw.at,
    };
  }
  function coinsData(coins) {
    var c = coins || { balance: 0, earned: 0, spent: 0, history: [] };
    if (
      !Number.isFinite(c.balance) ||
      !Number.isFinite(c.earned) ||
      c.earned < 0 ||
      !Number.isFinite(c.spent) ||
      c.spent < 0 ||
      !Array.isArray(c.history)
    )
      fail('INVALID_COINS');
    if (
      c.habitRewardsV1 &&
      (typeof c.habitRewardsV1 !== 'object' || Array.isArray(c.habitRewardsV1))
    )
      fail('INVALID_REWARD_LEDGER');
    return c;
  }
  function slotFor(coins, key) {
    var x = coins.habitRewardsV1 && coins.habitRewardsV1[key];
    if (
      x &&
      (!UUID.test(x.operationId) ||
        [0, 1, 2].indexOf(x.paid) < 0 ||
        !mark(x.targetMark) ||
        rewardForMark(x.targetMark) !== x.paid)
    )
      fail('INVALID_REWARD_LEDGER');
    return x || null;
  }
  function habitFor(tracker, id) {
    if (
      !tracker ||
      !Array.isArray(tracker.good) ||
      !tracker.marks ||
      typeof tracker.marks !== 'object'
    )
      fail('INVALID_TRACKER');
    var h = tracker.good.find(function (x) {
      return x && x.id === id;
    });
    if (!h) fail('HABIT_NOT_FOUND');
    return h;
  }
  function prepareChange(tracker, rawCoins, input) {
    var cmd = validateCommand(input),
      coins = coinsData(rawCoins),
      habit = habitFor(tracker, cmd.habitId),
      key = cmd.habitId + ':' + cmd.date,
      slot = slotFor(coins, key),
      current = tracker.marks[key] || 0;
    if (!mark(current)) fail('INVALID_MARK');
    var duplicate = slot && slot.operationId === cmd.operationId;
    if (duplicate && slot.targetMark !== cmd.targetMark)
      fail('OPERATION_CONFLICT');
    if (!duplicate && current !== cmd.expectedMark) fail('STALE_MARK');
    var previous = slot ? slot.paid : 0;
    return {
      command: cmd,
      markKey: key,
      previousReward: previous,
      previousOperationId: slot ? slot.operationId : null,
      targetReward: rewardForMark(cmd.targetMark),
      delta: duplicate ? 0 : rewardForMark(cmd.targetMark) - previous,
      noOp: !!duplicate,
      reason:
        'Привычка: ' + String(habit.name || 'Без названия') + ' · ' + cmd.date,
    };
  }
  function applyCoinChange(rawCoins, change) {
    var coins = coinsData(rawCoins),
      cmd = validateCommand(change.command),
      key = cmd.habitId + ':' + cmd.date,
      slot = slotFor(coins, key);
    if (slot && slot.operationId === cmd.operationId) {
      if (slot.targetMark !== cmd.targetMark) fail('OPERATION_CONFLICT');
      return coins;
    }
    if ((slot ? slot.operationId : null) !== change.previousOperationId)
      fail('STALE_REWARD');
    var delta = rewardForMark(cmd.targetMark) - (slot ? slot.paid : 0);
    if (coins.earned + delta < 0) fail('INVALID_COIN_TOTALS');
    var result = clone(coins);
    result.balance += delta;
    result.earned += delta;
    result.habitRewardsV1 = result.habitRewardsV1 || {};
    result.habitRewardsV1[key] = {
      paid: rewardForMark(cmd.targetMark),
      operationId: cmd.operationId,
      targetMark: cmd.targetMark,
      at: cmd.at,
    };
    if (delta) {
      result.history.unshift({
        type: 'adjust',
        amount: delta,
        reason: change.reason,
        date: cmd.at,
        operationId: cmd.operationId,
      });
      result.history = result.history.slice(0, 200);
    }
    return result;
  }
  function applyTrackerChange(tracker, change) {
    var cmd = validateCommand(change.command);
    habitFor(tracker, cmd.habitId);
    var key = cmd.habitId + ':' + cmd.date,
      current = tracker.marks[key] || 0;
    if (current !== cmd.expectedMark && current !== cmd.targetMark)
      fail('STALE_MARK');
    if (current === cmd.targetMark) return tracker;
    var result = clone(tracker);
    if (cmd.targetMark === 0) delete result.marks[key];
    else result.marks[key] = cmd.targetMark;
    return result;
  }
  return {
    validateCommand: validateCommand,
    rewardForMark: rewardForMark,
    prepareChange: prepareChange,
    applyCoinChange: applyCoinChange,
    applyTrackerChange: applyTrackerChange,
  };
});
