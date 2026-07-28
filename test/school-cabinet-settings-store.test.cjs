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
  let authHandler = null;
  let authUnsubscribes = 0;
  let currentSelectPromise = options.selectPromise || null;
  let selectRequests = 0;
  let realtimeSubscribeHandler = null;
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

  function selectResult(userId) {
    selectRequests += 1;
    if (currentSelectPromise) return currentSelectPromise;
    const remoteRow = options.remoteRowsByUser
      ? options.remoteRowsByUser[userId]
      : options.remoteRow;
    return Promise.resolve({
      data: remoteRow === undefined ? null : remoteRow,
      error: options.selectError || null,
    });
  }

  function makeBuilder() {
    let operation = 'select';
    let upsertedRow = null;
    let selectedUserId = null;
    const builder = {
      select() {
        return builder;
      },
      eq(column, value) {
        if (operation === 'select') {
          selectFilters.push([column, value]);
          if (column === 'user_id') selectedUserId = value;
        }
        return builder;
      },
      maybeSingle() {
        return selectResult(selectedUserId);
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
      onAuthStateChange(handler) {
        authHandler = handler;
        return {
          data: {
            subscription: {
              unsubscribe() {
                authUnsubscribes += 1;
              },
            },
          },
        };
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
        subscribe(handler) {
          realtimeSubscribeHandler = handler || null;
          if (
            typeof handler === 'function' &&
            !options.deferRealtimeSubscribe
          ) {
            handler('SUBSCRIBED');
          }
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
    emitAuth(user) {
      currentUser = user;
      assert.ok(authHandler, 'auth handler should be installed');
      authHandler(
        user ? 'SIGNED_IN' : 'SIGNED_OUT',
        user ? { user } : null
      );
    },
    setSelectPromise(promise) {
      currentSelectPromise = promise;
    },
    emitRealtime(payload) {
      assert.ok(realtimeHandler, 'realtime handler should be installed');
      realtimeHandler(payload);
    },
    confirmRealtime() {
      assert.ok(
        realtimeSubscribeHandler,
        'realtime subscribe handler should be installed'
      );
      realtimeSubscribeHandler('SUBSCRIBED');
    },
    failRealtime(status = 'CHANNEL_ERROR') {
      assert.ok(
        realtimeSubscribeHandler,
        'realtime subscribe handler should be installed'
      );
      realtimeSubscribeHandler(status);
    },
    get removedChannels() {
      return removedChannels;
    },
    get authUnsubscribes() {
      return authUnsubscribes;
    },
    get selectRequests() {
      return selectRequests;
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
  await app.store.load();

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

test('remote source of truth replaces a future-dated user-scoped cache', async () => {
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
    'https://chatgpt.com/g/old'
  );
  assert.equal(state.source, 'remote');
});

test('a slow refresh cannot overwrite newer realtime settings', async () => {
  const app = makeStore({
    user: { id: 'u1' },
    remoteRow: {
      value: JSON.stringify({
        version: 1,
        cabinets: {
          'chatgpt-software': 'https://chatgpt.com/g/initial',
        },
      }),
      updated_at: '2026-07-29T01:00:00.000Z',
    },
  });
  await app.store.load();

  const pending = deferred();
  app.setSelectPromise(pending.promise);
  const refreshPromise = app.store.refresh();
  while (app.selectRequests < 2) await Promise.resolve();
  app.emitRealtime({
    eventType: 'UPDATE',
    new: {
      user_id: 'u1',
      key: 'school_cabinet_urls_v1',
      value: JSON.stringify({
        version: 1,
        cabinets: {
          'chatgpt-software': 'https://chatgpt.com/g/realtime',
        },
      }),
      updated_at: '2026-07-29T03:00:00.000Z',
    },
  });
  pending.resolve({
    data: {
      value: JSON.stringify({
        version: 1,
        cabinets: {
          'chatgpt-software': 'https://chatgpt.com/g/stale-select',
        },
      }),
      updated_at: '2026-07-29T02:00:00.000Z',
    },
    error: null,
  });

  await refreshPromise;
  assert.equal(
    app.store.getState().settings.cabinets['chatgpt-software'],
    'https://chatgpt.com/g/realtime'
  );
  assert.equal(app.store.getState().source, 'realtime');
});

test('initial load confirms realtime subscription before taking its select snapshot', async () => {
  const pending = deferred();
  const app = makeStore({
    user: { id: 'u1' },
    deferRealtimeSubscribe: true,
    selectPromise: pending.promise,
  });
  const loadPromise = app.store.load();
  await Promise.resolve();
  await Promise.resolve();

  assert.equal(app.selectRequests, 0);
  app.confirmRealtime();
  while (app.selectRequests < 1) await Promise.resolve();
  app.emitRealtime({
    eventType: 'UPDATE',
    commit_timestamp: '2026-07-29T03:00:00.000Z',
    new: {
      user_id: 'u1',
      key: 'school_cabinet_urls_v1',
      value: JSON.stringify({
        version: 1,
        cabinets: {
          'chatgpt-software': 'https://chatgpt.com/g/realtime',
        },
      }),
      updated_at: '2026-07-29T03:00:00.000Z',
    },
  });
  pending.resolve({
    data: {
      value: JSON.stringify({
        version: 1,
        cabinets: {
          'chatgpt-software': 'https://chatgpt.com/g/stale-select',
        },
      }),
      updated_at: '2026-07-29T02:00:00.000Z',
    },
    error: null,
  });

  await loadPromise;
  assert.equal(
    app.store.getState().settings.cabinets['chatgpt-software'],
    'https://chatgpt.com/g/realtime'
  );
});

test('realtime subscription failure falls back to an authoritative select', async () => {
  const app = makeStore({
    user: { id: 'u1' },
    deferRealtimeSubscribe: true,
    remoteRow: {
      value: JSON.stringify({
        version: 1,
        cabinets: {
          'chatgpt-software': 'https://chatgpt.com/g/remote-fallback',
        },
      }),
      updated_at: '2026-07-29T03:00:00.000Z',
    },
  });
  const loadPromise = app.store.load();
  await Promise.resolve();
  await Promise.resolve();
  app.failRealtime();

  const state = await loadPromise;
  assert.equal(
    state.settings.cabinets['chatgpt-software'],
    'https://chatgpt.com/g/remote-fallback'
  );
  assert.equal(state.source, 'remote');
});

test('auth switch clears account A before loading and saving account B', async () => {
  const app = makeStore({
    user: { id: 'u1' },
    remoteRow: {
      value: JSON.stringify({
        version: 1,
        cabinets: {
          'chatgpt-software': 'https://chatgpt.com/g/account-a',
        },
      }),
      updated_at: '2026-07-29T01:00:00.000Z',
    },
  });
  await app.store.load();

  app.emitAuth({ id: 'u2' });
  assert.equal(app.store.getState().userId, null);
  assert.deepEqual(app.store.getState().settings.cabinets, {});

  await assert.rejects(
    app.store.save({
      'chatgpt-software': 'https://chatgpt.com/g/account-a',
    }),
    (error) => error.code === 'SETTINGS_NOT_READY'
  );
  assert.equal(app.upserts.length, 0);
});

test('logout and login automatically load only the next account settings', async () => {
  const app = makeStore({
    user: { id: 'u1' },
    remoteRowsByUser: {
      u1: {
        value: JSON.stringify({
          version: 1,
          cabinets: {
            'chatgpt-software': 'https://chatgpt.com/g/account-a',
          },
        }),
        updated_at: '2026-07-29T01:00:00.000Z',
      },
      u2: {
        value: JSON.stringify({
          version: 1,
          cabinets: {
            'chatgpt-software': 'https://chatgpt.com/g/account-b',
          },
        }),
        updated_at: '2026-07-29T02:00:00.000Z',
      },
    },
  });
  await app.store.load();

  app.emitAuth(null);
  assert.equal(app.store.getState().userId, null);
  assert.deepEqual(app.store.getState().settings.cabinets, {});

  app.emitAuth({ id: 'u2' });
  while (app.selectRequests < 2) await Promise.resolve();
  while (app.store.getState().status !== 'ready') await Promise.resolve();

  assert.equal(app.store.getState().userId, 'u2');
  assert.equal(
    app.store.getState().settings.cabinets['chatgpt-software'],
    'https://chatgpt.com/g/account-b'
  );
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

test('older realtime commits cannot overwrite a newer realtime commit', async () => {
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
    commit_timestamp: '2026-07-29T03:00:00.000Z',
    new: {
      user_id: 'u1',
      key: 'school_cabinet_urls_v1',
      value: JSON.stringify({
        version: 1,
        cabinets: {
          'chatgpt-software': 'https://chatgpt.com/g/newer-realtime',
        },
      }),
      updated_at: '2026-07-29T03:00:00.000Z',
    },
  });
  app.emitRealtime({
    eventType: 'UPDATE',
    commit_timestamp: '2026-07-29T02:00:00.000Z',
    new: {
      user_id: 'u1',
      key: 'school_cabinet_urls_v1',
      value: JSON.stringify({
        version: 1,
        cabinets: {
          'chatgpt-software': 'https://chatgpt.com/g/older-realtime',
        },
      }),
      updated_at: '2026-07-29T02:00:00.000Z',
    },
  });

  assert.equal(
    app.store.getState().settings.cabinets['chatgpt-software'],
    'https://chatgpt.com/g/newer-realtime'
  );
});

test('delayed realtime cannot overwrite a newer select or save', async () => {
  const app = makeStore({
    user: { id: 'u1' },
    remoteRow: {
      value: JSON.stringify({
        version: 1,
        cabinets: {
          'chatgpt-software': 'https://chatgpt.com/g/new-select',
        },
      }),
      updated_at: '2026-07-29T04:00:00.000Z',
    },
    savedUpdatedAt: '2026-07-29T06:00:00.000Z',
  });
  await app.store.load();

  app.emitRealtime({
    eventType: 'UPDATE',
    commit_timestamp: '2026-07-29T03:00:00.000Z',
    new: {
      user_id: 'u1',
      key: 'school_cabinet_urls_v1',
      value: JSON.stringify({
        version: 1,
        cabinets: {
          'chatgpt-software': 'https://chatgpt.com/g/old-before-select',
        },
      }),
      updated_at: '2026-07-29T03:00:00.000Z',
    },
  });
  assert.equal(
    app.store.getState().settings.cabinets['chatgpt-software'],
    'https://chatgpt.com/g/new-select'
  );

  await app.store.save({
    'chatgpt-software': 'https://chatgpt.com/g/new-save',
  });
  assert.equal('updated_at' in app.upserts[0], false);
  app.emitRealtime({
    eventType: 'UPDATE',
    commit_timestamp: '2026-07-29T05:00:00.000Z',
    new: {
      user_id: 'u1',
      key: 'school_cabinet_urls_v1',
      value: JSON.stringify({
        version: 1,
        cabinets: {
          'chatgpt-software': 'https://chatgpt.com/g/old-before-save',
        },
      }),
      updated_at: '2026-07-29T05:00:00.000Z',
    },
  });
  assert.equal(
    app.store.getState().settings.cabinets['chatgpt-software'],
    'https://chatgpt.com/g/new-save'
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
  assert.equal(app.authUnsubscribes, 1);
});

test('load requires a current authenticated session', async () => {
  const app = makeStore({ user: null });

  await assert.rejects(
    app.store.load(),
    (error) => error.code === 'UNAUTHORIZED'
  );
  assert.equal(app.store.getState().userId, null);
});
