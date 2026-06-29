const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

function loadGamification(fileName) {
  const events = [];
  const listeners = {};
  const storage = new Map();
  const context = {
    console: {},
    localStorage: {
      get length() { return storage.size; },
      key(index) { return Array.from(storage.keys())[index] || null; },
      getItem(key) { return storage.has(key) ? String(storage.get(key)) : null; },
      setItem(key, value) { storage.set(key, String(value)); },
      removeItem(key) { storage.delete(key); },
    },
    setTimeout(fn) { if (typeof fn === 'function') fn(); return 1; },
    clearTimeout() {},
    CustomEvent: function CustomEvent(type, init) {
      this.type = type;
      this.detail = init && init.detail;
    },
    window: {
      addEventListener(type, cb) {
        if (!listeners[type]) listeners[type] = [];
        listeners[type].push(cb);
      },
      dispatchEvent(event) {
        events.push(event);
        (listeners[event.type] || []).forEach(function (cb) { cb(event); });
      },
    },
  };
  context.window.CustomEvent = context.CustomEvent;
  context.window.localStorage = context.localStorage;
  context.window.setTimeout = context.setTimeout;
  context.window.clearTimeout = context.clearTimeout;
  vm.createContext(context);
  const source = fs.readFileSync(path.join(__dirname, '..', fileName), 'utf8');
  vm.runInContext(source, context);
  return { G: context.window.Gamification, storage };
}

test('storeGet cleans duplicate rewards and purchases in gamification_v405', () => {
  const { G, storage } = loadGamification('gamification_v405.js');
  storage.set('store_v2', JSON.stringify({
    customRewards: [
      { id: 'shopping', name: 'Тест', price: 100, icon: '🛒', expiresIn: 12 },
      { id: 'custom_1', name: 'Одинаково', price: '30', icon: '🎁', expiresIn: '6' },
      { id: 'custom_1', name: 'Одинаково', price: '30', icon: '🎁', expiresIn: '6' },
      { id: null, name: 'Без id', price: 'bad', icon: '🧪' },
      {},
    ],
    catalogOverrides: {
      shopping: 0,
      walk_park: 20,
      ghost_reward: 10,
    },
    hiddenCatalogIds: ['music_relax', 'music_relax', 'ghost_reward'],
    purchases: [
      { id: 'p1', rewardId: 'custom_1', date: '2020-01-01T00:00:00.000Z', name: 'A', price: 10 },
      { id: 'p1', rewardId: 'custom_1', date: '2020-01-01T00:00:00.000Z', name: 'A', price: 10 },
      { name: 'без id', rewardId: 'custom_1' },
      null
    ],
  }));

  const store = G.getStore();
  const persisted = JSON.parse(storage.get('store_v2'));

  assert.equal(store.customRewards.length, 2);
  assert.equal(store.purchases.length, 2);
  assert.equal(persisted.catalogOverrides.walk_park, 20);
  assert.equal(persisted.catalogOverrides.shopping, undefined);
  assert.equal(persisted.catalogOverrides.ghost_reward, undefined);
  assert.equal(persisted.hiddenCatalogIds.length, 1);
  assert.equal(persisted.hiddenCatalogIds[0], 'music_relax');
});

test('storeGet normalizes legacy store_v2.reward-shape in gamification', () => {
  const { G, storage } = loadGamification('gamification.js');
  storage.set('store_v2', JSON.stringify({
    rewards: [
      { id: 'shopping', name: 'Сломанная', price: 100, icon: '🛒' },
      { id: 'custom_foo', name: 'Свой', price: 20, icon: '🎁' },
      { id: 'custom_foo', name: 'Свой дубль', price: 20, icon: '🎁' },
    ],
    catalogOverrides: { shopping: 0, sleep_in: 'oops' },
    hiddenCatalogIds: ['shopping', 'unknown', 'sleep_in'],
    purchases: [
      { id: 'dup', rewardId: 'custom_foo' },
      { id: 'dup', rewardId: 'custom_foo' },
    ],
  }));

  const store = G.getStore();
  const persisted = JSON.parse(storage.get('store_v2'));

  assert.equal(store.customRewards.length, 1);
  assert.equal(store.customRewards[0].id, 'custom_foo');
  assert.equal(store.purchases.length, 1);
  assert.equal(store.catalogOverrides.sleep_in, undefined);
  assert.equal(store.hiddenCatalogIds.includes('sleep_in'), true);
  assert.equal(store.hiddenCatalogIds.includes('shopping'), true);
  assert.equal(store.hiddenCatalogIds.length, 2);
  assert.equal(persisted.catalogOverrides.sleep_in, undefined);
});
