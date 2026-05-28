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
      addEventListener() {},
      dispatchEvent() {},
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
