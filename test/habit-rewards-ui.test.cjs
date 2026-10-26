const test = require('node:test'),
  assert = require('node:assert/strict'),
  fs = require('node:fs'),
  vm = require('node:vm'),
  crypto = require('node:crypto');
const UI = require('../habit-rewards-ui.js'),
  Store = require('../habit-rewards-store.js');
function setup() {
  let tracker = { good: [{ id: 'h', name: 'сон' }], bad: [], marks: {} },
    coins = null,
    calls = 0,
    error = '',
    pending = false,
    hold = null;
  const memory = new Map();
  const service = Store.create({
    get: (k) => structuredClone(k === 'tracker_v1' ? tracker : coins),
    set(k, v) {
      if (k === 'tracker_v1') tracker = v;
      else coins = v;
    },
    runtimeStorage: {
      getItem: (k) => memory.get(k),
      setItem: (k, v) => memory.set(k, v),
      removeItem: (k) => memory.delete(k),
    },
    getOwner: () => 'local',
    withLock: async (_owner, fn) => {
      calls++;
      if (hold) await hold;
      return fn();
    },
    uuid: crypto.randomUUID,
    now: () => new Date().toISOString(),
  });
  const app = UI.create({
    service,
    getTracker: () => tracker,
    onChange() {},
    onError: (e) => (error = e),
    onPending: (_key, v) => (pending = v),
    uuid: crypto.randomUUID,
  });
  return {
    app,
    service,
    get tracker() {
      return tracker;
    },
    get coins() {
      return coins;
    },
    get calls() {
      return calls;
    },
    get pending() {
      return pending;
    },
    get error() {
      return error;
    },
    hold: (p) => (hold = p),
  };
}
test('ui цикл платит 2/1/0, pending блокирует повтор и загрузка не выдаёт старые монеты', async () => {
  const h = setup();
  h.tracker.marks['h:2026-10-23'] = 1;
  await h.app.recover();
  assert.equal(h.coins, null);
  let release;
  h.hold(new Promise((r) => (release = r)));
  const first = h.app.toggle('h', '2026-10-24');
  assert.equal(h.pending, true);
  await h.app.toggle('h', '2026-10-24');
  assert.equal(h.calls, 2);
  release();
  await first;
  h.hold(null);
  assert.equal(h.coins.balance, 2);
  await h.app.toggle('h', '2026-10-24');
  assert.equal(h.coins.balance, 1);
  await h.app.toggle('h', '2026-10-24');
  assert.equal(h.coins.balance, 0);
  assert.equal(h.coins.spent, 0);
});
test('ошибка не меняет отметку и снимает pending', async () => {
  const h = setup();
  h.service.setGoodMark = async () => {
    throw Error('quota');
  };
  await h.app.toggle('h', '2026-10-24');
  assert.equal(h.tracker.marks['h:2026-10-24'], undefined);
  assert.equal(h.pending, false);
  assert.match(h.error, /Не удалось/);
});
test('обе gamification версии сохраняют ledger и корректировку без переплаты', async () => {
  for (const file of ['gamification.js', 'gamification_v405.js']) {
    const memory = new Map();
    const win = { addEventListener() {}, dispatchEvent() {} };
    const ctx = {
      window: win,
      navigator: {},
      CustomEvent: function () {},
      localStorage: {
        getItem: (k) => memory.get(k) || null,
        setItem: (k, v) => memory.set(k, v),
      },
      setTimeout() {},
      clearTimeout() {},
      console,
    };
    vm.runInNewContext(fs.readFileSync(file, 'utf8'), ctx);
    const G = win.Gamification;
    G.Juice.playSuccess = () => {};
    G.Juice.playAchievement = () => {};
    G.storeSet('tracker_v1', {
      good: [{ id: 'h', name: 'сон' }],
      bad: [],
      marks: {},
    });
    const service = Store.create({
      get: G.storeGet,
      set: G.storeSet,
      runtimeStorage: {
        getItem: (k) => memory.get(k),
        setItem: (k, v) => memory.set(k, v),
        removeItem: (k) => memory.delete(k),
      },
      getOwner: () => 'local',
      withLock: (_o, fn) => Promise.resolve(fn()),
      now: () => new Date().toISOString(),
      uuid: crypto.randomUUID,
    });
    await service.setGoodMark('h', '2026-10-24', 1, { expectedMark: 0 });
    G.earnCoins(5, 'другое');
    await service.setGoodMark('h', '2026-10-24', 0.5, { expectedMark: 1 });
    assert.equal(G.getCoins().balance, 6);
    assert.equal(G.getCoins().spent, 0);
    assert.equal(G.getCoins().habitRewardsV1['h:2026-10-24'].paid, 1);
  }
});
test('история безопасно показывает signed adjust в обоих списках', () => {
  const html = fs.readFileSync('profile.html', 'utf8');
  const start = html.indexOf('  function coinHistoryRow('),
    end = html.indexOf('  function renderCoinHistory()', start);
  assert.ok(start >= 0);
  const context = {
    G: { esc: (s) => String(s).replace(/</g, '&lt;') },
    formatShortDate: () => '24 окт',
  };
  vm.createContext(context);
  vm.runInContext(html.slice(start, end), context);
  const row = context.coinHistoryRow;
  assert.match(
    row({ type: 'adjust', amount: -1, reason: '<img onerror=1>' }),
    /spend.*-1/,
  );
  assert.match(row({ type: 'adjust', amount: 2 }), /earn.*\+2/);
  assert.doesNotMatch(row({ type: 'adjust', amount: '<img>' }), /<img>/);
  assert.match(row({ type: 'earn', amount: 4 }), /\+4/);
  assert.match(row({ type: 'spend', amount: 3 }), /-3/);
  assert.equal((html.match(/coinHistoryRow\(h\)/g) || []).length, 3);
});
