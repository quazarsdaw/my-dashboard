const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

function makeStorage() {
  const data = new Map();
  return {
    get length() {
      return data.size;
    },
    key(index) {
      return Array.from(data.keys())[index] || null;
    },
    getItem(key) {
      return data.has(key) ? data.get(key) : null;
    },
    setItem(key, value) {
      data.set(key, String(value));
    },
    rawSetItem(key, value) {
      data.set(key, String(value));
    },
    dump() {
      return Object.fromEntries(data.entries());
    },
  };
}

function loadFirebaseSync() {
  const localStorage = makeStorage();
  const sessionStorage = makeStorage();
  const timers = [];
  const scriptLoads = [];
  const listeners = {};
  let reloadCount = 0;
  const sets = [];

  const fakeDoc = {
    exists: true,
    data() {
      return { data: {} };
    },
  };

  const context = {
    console,
    localStorage,
    sessionStorage,
    setTimeout(fn) {
      timers.push(fn);
      return timers.length;
    },
    clearTimeout() {},
    document: {
      readyState: 'loading',
      head: {
        appendChild(script) {
          scriptLoads.push(script.onload);
        },
      },
      createElement() {
        return {};
      },
      addEventListener() {},
      getElementById() {
        return null;
      },
    },
    window: {
      addEventListener(type, cb) {
        if (!listeners[type]) listeners[type] = [];
        listeners[type].push(cb);
      },
      dispatchEvent(event) {
        (listeners[event.type] || []).forEach(function (cb) { cb(event); });
      },
      location: {
        reload() {
          reloadCount++;
        },
      },
    },
    firebase: {
      initializeApp() {},
      firestore: Object.assign(function firestore() {
        return {
          collection() {
            return {
              doc() {
                return {
                  onSnapshot(cb) {
                    context.__snapshotCallback = cb;
                    return function unsubscribe() {};
                  },
                  set(update) {
                    sets.push(update);
                    return Promise.resolve();
                  },
                };
              },
            };
          },
        };
      }, {
        FieldValue: {
          serverTimestamp() {
            return 'server-time';
          },
        },
      }),
      auth() {
        return {
          onAuthStateChanged(cb) {
            context.__authCallback = cb;
          },
        };
      },
    },
  };
  context.window.localStorage = localStorage;
  context.window.sessionStorage = sessionStorage;
  context.window.setTimeout = context.setTimeout;
  context.window.clearTimeout = context.clearTimeout;
  context.CustomEvent = function CustomEvent(type, init) {
    this.type = type;
    this.detail = init && init.detail;
  };
  context.window.CustomEvent = context.CustomEvent;

  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'firebase-sync.js'), 'utf8'), context);
  while (scriptLoads.length) {
    var onload = scriptLoads.shift();
    if (onload) onload();
  }

  return {
    localStorage,
    timers,
    sets,
    signIn() {
      vm.runInContext('__authCallback({ uid: "user-1", email: "me@example.com" })', context);
    },
    snapshot(data) {
      context.__snapshotData = data;
      vm.runInContext('__snapshotCallback({ exists: true, data: function () { return { data: __snapshotData }; } })', context);
    },
    emptySnapshot() {
      context.__snapshotData = fakeDoc.data().data;
      vm.runInContext('__snapshotCallback({ exists: true, data: function () { return { data: __snapshotData }; } })', context);
    },
    dispatch(type, detail) {
      context.__eventDetail = detail || null;
      vm.runInContext('window.dispatchEvent(new CustomEvent(__eventType, { detail: __eventDetail }))', Object.assign(context, { __eventType: type }));
    },
    runTimers() {
      while (timers.length) {
        timers.shift()();
      }
    },
    get reloadCount() {
      return reloadCount;
    },
  };
}

test('pending local store changes are not overwritten by a stale cloud snapshot', () => {
  const h = loadFirebaseSync();
  const cloudStore = JSON.stringify({
    rewards: [{ id: 'series_1h', name: '1 час сериала', price: 50, icon: '📺' }],
    purchases: [],
  });
  const localStoreAfterDelete = JSON.stringify({ rewards: [], purchases: [] });

  h.localStorage.setItem('store_v1', cloudStore);
  h.signIn();
  h.snapshot({ store_v1: cloudStore });
  h.localStorage.setItem('store_v1', localStoreAfterDelete);
  h.snapshot({ store_v1: cloudStore });

  assert.equal(h.localStorage.getItem('store_v1'), localStoreAfterDelete);
  assert.equal(h.reloadCount, 0);
});

test('explicit local data change events protect writes even when setItem interception misses them', () => {
  const h = loadFirebaseSync();
  const cloudStore = JSON.stringify({
    rewards: [{ id: 'series_1h', name: '1 час сериала', price: 50, icon: '📺' }],
    purchases: [],
  });
  const localStoreAfterDelete = JSON.stringify({ rewards: [], purchases: [] });

  h.localStorage.rawSetItem('store_v1', cloudStore);
  h.signIn();
  h.snapshot({ store_v1: cloudStore });
  h.localStorage.rawSetItem('store_v1', localStoreAfterDelete);
  h.dispatch('dashboard-data-changed', { key: 'store_v1' });
  h.snapshot({ store_v1: cloudStore });

  assert.equal(h.localStorage.getItem('store_v1'), localStoreAfterDelete);
  assert.equal(h.reloadCount, 0);
});

test('stale snapshots after a push promise resolves still cannot undo local edits', async () => {
  const h = loadFirebaseSync();
  const cloudStore = JSON.stringify({
    rewards: [{ id: 'series_1h', name: '1 час сериала', price: 50, icon: '📺' }],
    purchases: [],
  });
  const localStoreAfterDelete = JSON.stringify({ rewards: [], purchases: [] });

  h.localStorage.rawSetItem('store_v1', cloudStore);
  h.signIn();
  h.snapshot({ store_v1: cloudStore });
  h.localStorage.rawSetItem('store_v1', localStoreAfterDelete);
  h.dispatch('dashboard-data-changed', { key: 'store_v1' });
  h.runTimers();
  await Promise.resolve();
  h.snapshot({ store_v1: cloudStore });

  assert.equal(h.localStorage.getItem('store_v1'), localStoreAfterDelete);
  assert.equal(h.reloadCount, 0);
});

test('unversioned stale cloud data never overwrites an existing local key', () => {
  const h = loadFirebaseSync();
  const staleCloudStore = JSON.stringify({
    rewards: [{ id: 'series_1h', name: '1 час сериала', price: 50, icon: '📺' }],
    purchases: [],
  });
  const localStore = JSON.stringify({ rewards: [], purchases: [] });

  h.localStorage.rawSetItem('store_v1', localStore);
  h.signIn();
  h.snapshot({ store_v1: staleCloudStore });
  h.snapshot({ store_v1: staleCloudStore });

  assert.equal(h.localStorage.getItem('store_v1'), localStore);
  assert.equal(h.reloadCount, 0);
});

test('newer cloud data with sync metadata can update an existing local key', () => {
  const h = loadFirebaseSync();
  const localStore = JSON.stringify({ rewards: [], purchases: [] });
  const remoteStore = JSON.stringify({
    rewards: [{ id: 'series_1h', name: '1 час сериала', price: 50, icon: '📺' }],
    purchases: [],
  });
  const remoteMeta = JSON.stringify({ store_v1: 2000 });

  h.localStorage.rawSetItem('store_v1', localStore);
  h.localStorage.rawSetItem('_sync_meta_v1', JSON.stringify({ store_v1: 1000 }));
  h.signIn();
  h.snapshot({ store_v1: localStore, _sync_meta_v1: JSON.stringify({ store_v1: 1000 }) });
  h.snapshot({ store_v1: remoteStore, _sync_meta_v1: remoteMeta });

  assert.equal(h.localStorage.getItem('store_v1'), remoteStore);
  assert.equal(JSON.parse(h.localStorage.getItem('_sync_meta_v1')).store_v1, 2000);
});

test('initial sync pushes local-only store data into an existing cloud document', async () => {
  const h = loadFirebaseSync();
  const localStore = JSON.stringify({
    rewards: [{ id: 'custom_sync', name: 'Кастом', price: 42, icon: '🎁' }],
    purchases: [],
  });

  h.localStorage.rawSetItem('store_v1', localStore);
  h.localStorage.rawSetItem('_sync_meta_v1', JSON.stringify({ store_v1: 1000 }));
  h.signIn();
  h.snapshot({ coins_v1: JSON.stringify({ balance: 10, earned: 10, spent: 0, history: [] }) });
  await Promise.resolve();

  assert.ok(h.sets.length > 0);
  const lastSet = h.sets[h.sets.length - 1];
  assert.equal(lastSet['data.store_v1'], localStore);
  assert.match(lastSet['data._sync_meta_v1'], /store_v1/);
});
