const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

function loadGamification() {
  const storage = new Map();
  const events = [];
  const context = {
    CustomEvent: function CustomEvent(type, init) {
      this.type = type;
      this.detail = init && init.detail;
    },
    localStorage: {
      getItem(key) {
        return storage.has(key) ? storage.get(key) : null;
      },
      setItem(key, value) {
        storage.set(key, String(value));
      },
    },
    setTimeout(fn) {
      if (typeof fn === 'function') fn();
      return 1;
    },
    clearTimeout() {},
    window: {
      dispatchEvent(event) {
        events.push(event);
      },
    },
  };
  context.window.CustomEvent = context.CustomEvent;
  context.window.localStorage = context.localStorage;
  context.window.setTimeout = context.setTimeout;
  context.window.clearTimeout = context.clearTimeout;
  vm.createContext(context);
  const source = fs.readFileSync(path.join(__dirname, '..', 'gamification.js'), 'utf8');
  vm.runInContext(source, context);
  return { G: context.window.Gamification, storage, events };
}

test('completing a task without a sector gives coins but no sphere XP', () => {
  const { G, storage } = loadGamification();

  const result = G.completeTask('', 'medium', 30);
  const coins = JSON.parse(storage.get('coins_v1'));
  const spheres = storage.has('spheres_v1') ? JSON.parse(storage.get('spheres_v1')) : {};

  assert.equal(result.coins, 6);
  assert.ok(coins.balance >= result.coins);
  assert.ok(coins.history.some(function (h) {
    return h.amount === result.coins && h.reason === 'Задача (без сектора)';
  }));
  assert.deepEqual(spheres, {});
});

test('task UI offers an explicit no-sector choice', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

  assert.match(html, /Без сектора/);
  assert.match(html, /appendNoSphereOption\(sel\)/);
  assert.match(html, /pickerCallback\(''\)/);
});

test('storeSet emits a local data change event for sync', () => {
  const { G, events } = loadGamification();

  G.storeSet('store_v1', { rewards: [], purchases: [] });

  const event = events.find(function (e) { return e.type === 'dashboard-data-changed'; });
  assert.ok(event);
  assert.equal(event.detail.key, 'store_v1');
});

test('task completion awards locally before awaiting cloud sync', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  const rewardIndex = html.indexOf('G.completeTask(goalsUpdate[idx].sphere, goalsUpdate[idx].difficulty, actualMin)');
  const syncIndex = html.indexOf('await window.DashboardSync.forceSync(key)');

  assert.ok(rewardIndex !== -1);
  assert.ok(syncIndex !== -1);
  assert.ok(rewardIndex < syncIndex);
});
