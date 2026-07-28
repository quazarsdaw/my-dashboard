const assert = require('node:assert/strict');
const test = require('node:test');
const SchoolCabinetSettings = require('../school-cabinet-settings.js');
const SchoolCabinetSettingsStore = require('../school-cabinet-settings-store.js');

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function makeStore(options = {}) {
  let currentUser = options.user === undefined ? { id: 'u1' } : options.user;
  let realtimeHandler = null;
  let removedChannels = 0;
  const storageData = new Map(Object.entries(options.storage || {}));
  const storageReads = [];
  const storageWrites = [];
  const selectFilters = [];
  const upserts = [];
  const events = [];
  const listeners = {};

  const storage = {
    getItem(key) {
      storageReads.push(key);
      return storageData.has(key) ? storageData.get(key) : null;
    },
    setItem(key, value) {
      storageWrites.push([key, String(value)]);
      storageData.set(key, String(value));
    },
    removeItem(key) {
      storageWrites.push([key, null]);
      storageData.delete(key);
    },
  };

  function selectResult() {
    if (options.selectPromise) return options.selectPromise;
    return Promise.resolve({
      data: options.remoteRow === undefined ? null : options.remoteRow,
      error: options.selectError || null,
    });
  }

  function makeBuilder() {
    let operation = 'select';
    let upsertedRow = null;
    const builder = {
      select() {
        return builder;
      },
      eq(column, value) {
        if (operation === 'select') selectFilters.push([column, value]);
        return builder;
      },
      maybeSingle() {
        return selectResult();
      },
      upsert(row) {
        operation = 'upsert';
        upsertedRow = row;
        upserts.push(row);
        return builder;
      },
      single() {
        if (options.upsertError) {
          return Promise.resolve({ data: null, error: options.upsertError });
        }
        const updatedAt = options.savedUpdatedAt || rowTimestamp(upsertedRow);
        return Promise.resolve({
          data: options.savedRow || {
            value: upsertedRow.value,
            updated_at: updatedAt,
          },
          error: null,
        });
      },
    };
    return builder;
  }

  function rowTimestamp(row) {
    return row && row.updated_at
      ? row.updated_at
      : '2026-07-29T00:00:00.000Z';
  }

  const client = {
    auth: {
      getSession() {
        return Promise.resolve({
          data: {
            session: currentUser ? { user: currentUser } : null,
          },
          error: null,
        });
      },
    },
    from(table) {
      assert.equal(table, 'user_data');
      return makeBuilder();
    },
    channel(name) {
      assert.match(name, /^school-cabinet-settings:/);
      return {
        on(event, filter, handler) {
          assert.equal(event, 'postgres_changes');
          assert.equal(filter.table, 'user_data');
          realtimeHandler = handler;
          return this;
        },
        subscribe() {
          return this;
        },
      };
    },
    removeChannel() {
      removedChannels += 1;
    },
  };

  const eventTarget = {
    addEventListener(type, listener) {
      if (!listeners[type]) listeners[type] = [];
      listeners[type].push(listener);
    },
    dispatchEvent(event) {
      events.push(event);
      (listeners[event.type] || []).forEach((listener) => listener(event));
      return true;
    },
  };

  function CustomEvent(type, init) {
    this.type = type;
    this.detail = init && init.detail;
  }

  const store = SchoolCabinetSettingsStore.create({
    settingsCore: SchoolCabinetSettings,
    getSync() {
      return { client };
    },
    storage,
    eventTarget,
    CustomEvent,
    delay() {
      return Promise.resolve();
    },
    now() {
      return new Date('2026-07-29T03:00:00.000Z');
    },
  });

  return {
    store,
    storageReads,
    storageWrites,
    selectFilters,
    upserts,
    events,
    setUser(user) {
      currentUser = user;
    },
    emitRealtime(payload) {
      assert.ok(realtimeHandler, 'realtime handler should be installed');
      realtimeHandler(payload);
    },
    get removedChannels() {
      return removedChannels;
    },
  };
}

test('load scopes remote row and cache to current auth user', async () => {
  const app = makeStore({
    user: { id: 'u1' },
    remoteRow: {
      value: JSON.stringify({
        version: 1,
        cabinets: {
          'chatgpt-software': 'https://chatgpt.com/g/u1',
        },
      }),
      updated_at: '2026-07-29T00:00:00.000Z',
    },
    storage: {
      'school_cabinet_urls_cache_v1:u2': JSON.stringify({
        version: 1,
        cabinets: {
          'chatgpt-software': 'https://chatgpt.com/g/u2',
        },
      }),
    },
  });

  const state = await app.store.load();

  assert.equal(state.userId, 'u1');
  assert.equal(
    state.settings.cabinets['chatgpt-software'],
    'https://chatgpt.com/g/u1'
  );
  assert.deepEqual(app.selectFilters, [
    ['user_id', 'u1'],
    ['key', 'school_cabinet_urls_v1'],
  ]);
  assert.equal(
    app.storageReads.includes('school_cabinet_urls_cache_v1:u2'),
    false
  );
});

test('save writes serialized text and never accepts a foreign user id', async () => {
  const app = makeStore({ user: { id: 'u1' } });

  await app.store.save({
    'chatgpt-mathematics': 'https://chatgpt.com/g/math',
    user_id: 'u2',
  });

  assert.equal(app.upserts.length, 1);
  assert.equal(app.upserts[0].user_id, 'u1');
  assert.equal(app.upserts[0].key, 'school_cabinet_urls_v1');
  assert.equal(typeof app.upserts[0].value, 'string');
  assert.equal(JSON.parse(app.upserts[0].value).version, 1);
  assert.equal('user_id' in JSON.parse(app.upserts[0].value), false);
});

test('failed cloud save keeps confirmed state and draft outside store', async () => {
  const app = makeStore({
    user: { id: 'u1' },
    remoteRow: {
      value: JSON.stringify({ version: 1, cabinets: {} }),
      updated_at: '2026-07-29T00:00:00.000Z',
    },
    upsertError: { message: 'network unavailable' },
  });
  await app.store.load();
  app.storageWrites.length = 0;

  await assert.rejects(
    app.store.save({
      'chatgpt-software': 'https://chatgpt.com/g/new',
    }),
    (error) => error.code === 'SAVE_FAILED'
  );

  assert.deepEqual(app.store.getState().settings.cabinets, {});
  assert.equal(app.storageWrites.length, 0);
});

test('response from previous auth user is discarded', async () => {
  const pending = deferred();
  const app = makeStore({
    user: { id: 'u1' },
    selectPromise: pending.promise,
  });
  const loadPromise = app.store.load();
  await Promise.resolve();
  app.setUser({ id: 'u2' });
  pending.resolve({
    data: {
      value: JSON.stringify({
        version: 1,
        cabinets: {
          'chatgpt-software': 'https://chatgpt.com/g/u1',
        },
      }),
      updated_at: '2026-07-29T00:00:00.000Z',
    },
    error: null,
  });

  await assert.rejects(
    loadPromise,
    (error) => error.code === 'AUTH_CHANGED'
  );
  assert.equal(app.store.getState().userId, null);
});

test('older select rows cannot overwrite a newer user-scoped cache', async () => {
  const app = makeStore({
    user: { id: 'u1' },
    remoteRow: {
      value: JSON.stringify({
        version: 1,
        cabinets: {
          'chatgpt-software': 'https://chatgpt.com/g/old',
        },
      }),
      updated_at: '2026-07-29T01:00:00.000Z',
    },
    storage: {
      'school_cabinet_urls_cache_v1:u1': JSON.stringify({
        version: 1,
        cabinets: {
          'chatgpt-software': 'https://chatgpt.com/g/new',
        },
        updatedAt: '2026-07-29T02:00:00.000Z',
      }),
    },
  });

  const state = await app.store.load();

  assert.equal(
    state.settings.cabinets['chatgpt-software'],
    'https://chatgpt.com/g/new'
  );
  assert.equal(state.source, 'cache');
});

test('realtime applies only the current user settings key', async () => {
  const app = makeStore({ user: { id: 'u1' } });
  await app.store.load();
  app.events.length = 0;

  app.emitRealtime({
    eventType: 'UPDATE',
    new: {
      user_id: 'u1',
      key: 'school_cabinet_urls_v1',
      value: JSON.stringify({
        version: 1,
        cabinets: {
          'chatgpt-english': 'https://chatgpt.com/g/english',
        },
      }),
      updated_at: '2026-07-29T01:00:00.000Z',
    },
  });

  assert.equal(
    app.store.getState().settings.cabinets['chatgpt-english'],
    'https://chatgpt.com/g/english'
  );

  app.emitRealtime({
    eventType: 'UPDATE',
    new: {
      user_id: 'u1',
      key: 'store_v2',
      value: '{}',
      updated_at: '2026-07-29T02:00:00.000Z',
    },
  });
  app.emitRealtime({
    eventType: 'UPDATE',
    new: {
      user_id: 'u2',
      key: 'school_cabinet_urls_v1',
      value: '{}',
      updated_at: '2026-07-29T02:00:00.000Z',
    },
  });

  assert.equal(app.events.length, 1);
});

test('older realtime rows cannot overwrite newer confirmed settings', async () => {
  const app = makeStore({
    user: { id: 'u1' },
    remoteRow: {
      value: JSON.stringify({
        version: 1,
        cabinets: {
          'chatgpt-software': 'https://chatgpt.com/g/new',
        },
      }),
      updated_at: '2026-07-29T02:00:00.000Z',
    },
  });
  await app.store.load();

  app.emitRealtime({
    eventType: 'UPDATE',
    new: {
      user_id: 'u1',
      key: 'school_cabinet_urls_v1',
      value: JSON.stringify({
        version: 1,
        cabinets: {
          'chatgpt-software': 'https://chatgpt.com/g/old',
        },
      }),
      updated_at: '2026-07-29T01:00:00.000Z',
    },
  });

  assert.equal(
    app.store.getState().settings.cabinets['chatgpt-software'],
    'https://chatgpt.com/g/new'
  );
});

test('realtime delete resets the current row and destroy removes channel', async () => {
  const app = makeStore({
    user: { id: 'u1' },
    remoteRow: {
      value: JSON.stringify({
        version: 1,
        cabinets: {
          'chatgpt-university': 'https://chatgpt.com/g/university',
        },
      }),
      updated_at: '2026-07-29T01:00:00.000Z',
    },
  });
  await app.store.load();

  app.emitRealtime({
    eventType: 'DELETE',
    old: {
      user_id: 'u1',
      key: 'school_cabinet_urls_v1',
      updated_at: '2026-07-29T02:00:00.000Z',
    },
  });

  assert.deepEqual(app.store.getState().settings, {
    version: 1,
    cabinets: {},
  });

  app.store.destroy();
  assert.equal(app.removedChannels, 1);
});

test('load requires a current authenticated session', async () => {
  const app = makeStore({ user: null });

  await assert.rejects(
    app.store.load(),
    (error) => error.code === 'UNAUTHORIZED'
  );
  assert.equal(app.store.getState().userId, null);
});
