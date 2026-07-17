const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

function makeStorage(initial = {}) {
  function Storage() {
    this.data = new Map(Object.entries(initial).map(([k, v]) => [k, String(v)]));
  }
  Storage.prototype.key = function key(index) {
    return Array.from(this.data.keys())[index] || null;
  };
  Storage.prototype.getItem = function getItem(key) {
    return this.data.has(key) ? this.data.get(key) : null;
  };
  Storage.prototype.setItem = function setItem(key, value) {
    this.data.set(key, String(value));
  };
  Storage.prototype.removeItem = function removeItem(key) {
    this.data.delete(key);
  };
  Object.defineProperty(Storage.prototype, 'length', {
    get() { return this.data.size; },
  });
  return { Storage, localStorage: new Storage() };
}

async function flushPromises() {
  for (let i = 0; i < 5; i++) await Promise.resolve();
  await new Promise((resolve) => setImmediate(resolve));
}

async function loadSupabaseSync(options = {}) {
  const { Storage, localStorage } = makeStorage(options.initialStorage || {});
  const timers = [];
  const listeners = {};
  const writes = { upserts: [], deletes: [] };
  const elements = {};
  const topbar = {
    firstChild: null,
    insertBefore(child) {
      this.firstChild = child;
      if (child.id) elements[child.id] = child;
    },
  };
  let postgresChangeHandler = null;

  function setTimer(fn) {
    const timer = { fn, active: true };
    timers.push(timer);
    return timer;
  }

  function clearTimer(timer) {
    if (timer) timer.active = false;
  }

  function makeElement() {
    return {
      style: {},
      set id(value) {
        this._id = value;
        elements[value] = this;
      },
      get id() {
        return this._id;
      },
      setAttribute() {},
      addEventListener() {},
    };
  }

  function makeBuilder() {
    const builder = {
      select() { return builder; },
      eq() { return builder; },
      upsert(rows) {
        writes.upserts.push(rows);
        return Promise.resolve({ data: rows, error: null });
      },
      delete() {
        builder.isDelete = true;
        return builder;
      },
      then(resolve) {
        if (builder.isDelete) {
          writes.deletes.push(true);
          return Promise.resolve(resolve({ data: null, error: null }));
        }
        return Promise.resolve(resolve({ data: options.cloudRows || [], error: null }));
      },
      catch() { return builder; },
    };
    return builder;
  }

  const context = {
    console: { log() {}, warn() {}, error() {}, info() {}, debug() {} },
    CustomEvent: function CustomEvent(type, init) {
      this.type = type;
      this.detail = init && init.detail;
    },
    Date,
    Promise,
    localStorage,
    setTimeout(fn) {
      return setTimer(fn);
    },
    clearTimeout: clearTimer,
    window: {
      Storage,
      localStorage,
      location: { origin: 'https://example.test', pathname: '/index.html' },
      addEventListener(type, cb) {
        if (!listeners[type]) listeners[type] = [];
        listeners[type].push(cb);
      },
      dispatchEvent(event) {
        (listeners[event.type] || []).forEach((cb) => cb(event));
      },
      supabase: {
        createClient() {
          return {
            auth: {
              getSession() {
                return Promise.resolve({ data: { session: { user: { id: 'u1', email: 'u@test' } } } });
              },
              onAuthStateChange() {},
            },
            from() {
              return makeBuilder();
            },
            channel() {
              return {
                on(_event, _filter, cb) {
                  postgresChangeHandler = cb;
                  return this;
                },
                subscribe() { return this; },
              };
            },
            removeChannel() {},
          };
        },
      },
    },
    document: {
      readyState: 'complete',
      head: {
        appendChild(script) {
          script.onload();
        },
      },
      createElement() {
        return makeElement();
      },
      getElementById(id) {
        if (id === 'topbar') return topbar;
        return elements[id] || null;
      },
      addEventListener() {},
    },
  };
  context.window.CustomEvent = context.CustomEvent;
  context.window.setTimeout = context.setTimeout;
  context.window.clearTimeout = context.clearTimeout;

  vm.createContext(context);
  const source = fs.readFileSync(path.join(__dirname, '..', 'supabase-sync.js'), 'utf8');
  vm.runInContext(source, context);
  await flushPromises();

  return {
    context,
    localStorage,
    writes,
    runTimers: async function runTimers() {
      while (timers.length) {
        const timer = timers.shift();
        if (timer.active) timer.fn();
      }
      await flushPromises();
    },
    emitCloudChange(payload) {
      assert.ok(postgresChangeHandler, 'postgres change handler should be installed');
      postgresChangeHandler(payload);
    },
  };
}

test('initial push does not sync sensitive OpenRouter settings', async () => {
  const app = await loadSupabaseSync({
    initialStorage: {
      openrouter_settings_v1: JSON.stringify({ key: 'sk-secret', model: 'x' }),
      nutrition_kitchen_profile_v1: JSON.stringify({ activeMode: 'extended' }),
      nutrition_cooking_plans_v1: JSON.stringify({ version: 1 }),
      store_v2: JSON.stringify({ rewards: [] }),
    },
  });

  await app.runTimers();

  const pushedKeys = app.writes.upserts.flat().map((row) => row.key);
  assert.ok(pushedKeys.includes('store_v2'));
  assert.ok(pushedKeys.includes('nutrition_kitchen_profile_v1'));
  assert.ok(pushedKeys.includes('nutrition_cooking_plans_v1'));
  assert.ok(!pushedKeys.includes('openrouter_settings_v1'));
});

test('removing a local key deletes the cloud row instead of upserting null', async () => {
  const app = await loadSupabaseSync({
    initialStorage: {
      store_v2: JSON.stringify({ rewards: [{ id: 'r1' }] }),
    },
  });

  app.localStorage.removeItem('store_v2');
  await app.context.window.DashboardSync.forceSync('store_v2');

  assert.equal(app.writes.deletes.length, 1);
  assert.equal(app.writes.upserts.flat().some((row) => row.key === 'store_v2'), false);
});

test('cloud delete events remove local keys and notify listeners', async () => {
  const app = await loadSupabaseSync({
    initialStorage: {
      store_v2: JSON.stringify({ rewards: [{ id: 'r1' }] }),
    },
  });
  const applied = [];
  app.context.window.addEventListener('dashboard-sync-applied', (event) => {
    applied.push(event.detail.changedKeys);
  });

  app.emitCloudChange({
    eventType: 'DELETE',
    old: { key: 'store_v2', updated_at: new Date(Date.now() + 1000).toISOString() },
  });

  assert.equal(app.localStorage.getItem('store_v2'), null);
  assert.equal(JSON.stringify(applied), JSON.stringify([['store_v2']]));
});
