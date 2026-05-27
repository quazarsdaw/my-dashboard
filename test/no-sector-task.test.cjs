const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

function loadGamification() {
  const storage = new Map();
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
    window: {
      dispatchEvent() {},
    },
  };
  context.window.CustomEvent = context.CustomEvent;
  context.window.localStorage = context.localStorage;
  vm.createContext(context);
  const source = fs.readFileSync(path.join(__dirname, '..', 'gamification.js'), 'utf8');
  vm.runInContext(source, context);
  return { G: context.window.Gamification, storage };
}

test('completing a task without a sector gives coins but no sphere XP', () => {
  const { G, storage } = loadGamification();

  const result = G.completeTask('', 'medium', 30);
  const coins = JSON.parse(storage.get('coins_v1'));
  const spheres = storage.has('spheres_v1') ? JSON.parse(storage.get('spheres_v1')) : {};

  assert.equal(result.coins, 10);
  assert.equal(coins.balance, 10);
  assert.equal(coins.history[0].reason, 'Задача (без сектора)');
  assert.deepEqual(spheres, {});
});

test('task UI offers an explicit no-sector choice', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

  assert.match(html, /Без сектора/);
  assert.match(html, /appendNoSphereOption\(sel\)/);
  assert.match(html, /pickerCallback\(''\)/);
});
