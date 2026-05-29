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
    removeItem(key) {
      data.delete(key);
    },
    rawSetItem(key, value) {
      data.set(key, String(value));
    },
    rawRemoveItem(key) {
      data.delete(key);
    },
    dump() {
      return Object.fromEntries(data.entries());
    },
  };
}

async function flushPromises() {
  for (let i = 0; i < 5; i++) {
    await Promise.resolve();
  }
  await new Promise((resolve) => setImmediate(resolve));
}

function loadFirebaseSync(options = {}) {
  const localStorage = makeStorage();
  const sessionStorage = makeStorage();
  const timers = [];
  const scriptLoads = [];
  const listeners = {};
  const elementsById = {};
  const popupCalls = [];
  const redirectCalls = [];
  const redirectResultCalls = [];
  const persistenceCalls = [];
  const alerts = [];
  let reloadCount = 0;
  const sets = [];
  const setOptions = [];

  function makeElement(tagName) {
    const elementListeners = {};
    const attrs = {};
    const element = {
      tagName: tagName.toUpperCase(),
      children: [],
      style: {},
      firstChild: null,
      innerHTML: '',
      textContent: '',
      set id(value) {
        this._id = value;
        elementsById[value] = this;
      },
      get id() {
        return this._id;
      },
      setAttribute(name, value) {
        attrs[name] = String(value);
      },
      getAttribute(name) {
        return attrs[name] || null;
      },
      addEventListener(type, cb) {
        elementListeners[type] = cb;
      },
      click() {
        if (elementListeners.click) elementListeners.click({ target: this });
      },
      appendChild(child) {
        this.children.push(child);
        if (!this.firstChild) this.firstChild = child;
      },
      insertBefore(child, before) {
        const index = before ? this.children.indexOf(before) : -1;
        if (index >= 0) this.children.splice(index, 0, child);
        else this.children.unshift(child);
        this.firstChild = this.children[0] || null;
      },
      remove() {
        if (this.id) delete elementsById[this.id];
      },
    };
    return element;
  }

  if (options.enableTopbar) {
    elementsById.topbar = makeElement('div');
    elementsById.topbar.id = 'topbar';
  }

  const fakeDoc = {
    exists: true,
    data() {
      return { data: {} };
    },
  };
  const silentConsole = {
    log() {},
    warn() {},
    error() {},
    info() {},
    debug() {},
  };

  const context = {
    console: options.console || silentConsole,
    localStorage,
    sessionStorage,
    setTimeout(fn) {
      timers.push(fn);
      return timers.length;
    },
    clearTimeout() {},
    alert(message) {
      alerts.push(String(message));
    },
    confirm() {
      return true;
    },
    navigator: {
      userAgent: options.userAgent || '',
      platform: options.platform || '',
      maxTouchPoints: options.maxTouchPoints || 0,
      standalone: !!options.standalone,
    },
    document: {
      readyState: options.enableTopbar ? 'complete' : 'loading',
      head: {
        appendChild(script) {
          scriptLoads.push(script.onload);
        },
      },
      createElement(tagName) {
        return makeElement(tagName || 'div');
      },
      addEventListener() {},
      getElementById(id) {
        return elementsById[id] || null;
      },
      body: makeElement('body'),
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
        search: '',
        reload() {
          reloadCount++;
        },
      },
      matchMedia() {
        return { matches: !!options.displayModeStandalone };
      },
    },
  };
  context.window.localStorage = localStorage;
  context.window.sessionStorage = sessionStorage;
  context.window.setTimeout = context.setTimeout;
  context.window.clearTimeout = context.clearTimeout;
  context.window.navigator = context.navigator;
  context.window.alert = context.alert;
  context.window.confirm = context.confirm;

  const fakeAuth = {
    onAuthStateChanged(cb) {
      context.__authCallback = cb;
    },
    setPersistence(value) {
      persistenceCalls.push(value);
      return Promise.resolve();
    },
    getRedirectResult() {
      redirectResultCalls.push(true);
      return Promise.resolve(null);
    },
    signInWithPopup(provider) {
      popupCalls.push(provider);
      const result = options.popupResult || Promise.reject(Object.assign(new Error('Popup blocked'), {
        code: 'auth/popup-blocked',
        message: 'Popup blocked',
      }));
      return Promise.resolve().then(() => result);
    },
    signInWithRedirect(provider) {
      redirectCalls.push(provider);
      return Promise.resolve();
    },
    signOut() {
      context.__authCallback(null);
      return Promise.resolve();
    },
  };

  function auth() {
    return fakeAuth;
  }
  auth.GoogleAuthProvider = function GoogleAuthProvider() {
    this.customParameters = null;
    this.setCustomParameters = function setCustomParameters(params) {
      this.customParameters = params;
    };
  };
  auth.Auth = {
    Persistence: {
      LOCAL: 'LOCAL',
    },
  };

  context.firebase = {
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
                  set(update, options) {
                    sets.push(update);
                    setOptions.push(options || null);
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
          delete() {
            return 'delete-field';
          },
        },
      }),
    auth,
  };
  context.CustomEvent = function CustomEvent(type, init) {
    this.type = type;
    this.detail = init && init.detail;
  };
  context.window.CustomEvent = context.CustomEvent;

  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'firebase-sync.js'), 'utf8'), context);
  function loadSdk() {
    while (scriptLoads.length) {
      var onload = scriptLoads.shift();
      if (onload) onload();
    }
  }
  if (options.autoLoadSdk !== false) loadSdk();

  return {
    localStorage,
    timers,
    sets,
    setOptions,
    loadSdk,
    clickSyncButton() {
      const btn = elementsById.syncAuthBtn;
      assert.ok(btn, 'sync auth button should exist');
      btn.click();
    },
    popupCalls,
    redirectCalls,
    redirectResultCalls,
    persistenceCalls,
    alerts,
    listen(type, cb) {
      if (!listeners[type]) listeners[type] = [];
      listeners[type].push(cb);
    },
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

test('iOS auth popup failures do not fall back to Firebase redirect', async () => {
  const h = loadFirebaseSync({
    enableTopbar: true,
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148',
    platform: 'iPhone',
  });

  h.clickSyncButton();
  await flushPromises();

  assert.equal(h.popupCalls.length, 1);
  assert.equal(h.redirectCalls.length, 0);
  assert.equal(h.alerts.length, 1);
  assert.match(h.alerts[0], /телефон/i);
});

test('auth popup starts synchronously from the click gesture', () => {
  const h = loadFirebaseSync({
    enableTopbar: true,
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148',
    platform: 'iPhone',
    popupResult: new Promise(() => {}),
  });

  h.clickSyncButton();

  assert.equal(h.popupCalls.length, 1);
});

test('desktop auth popup-blocked errors still fall back to redirect', async () => {
  const h = loadFirebaseSync({
    enableTopbar: true,
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/125 Safari/537.36',
    platform: 'MacIntel',
  });

  h.clickSyncButton();
  await flushPromises();

  assert.equal(h.popupCalls.length, 1);
  assert.equal(h.redirectCalls.length, 1);
  assert.equal(h.alerts.length, 0);
});

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
  assert.equal(h.setOptions[h.setOptions.length - 1].merge, true);
});

test('push writes merge field updates for special localStorage keys', async () => {
  const h = loadFirebaseSync();
  const key = 'goals:2026-05-28';
  const goals = JSON.stringify([{ text: 'Разобрать стол', done: false }]);

  h.localStorage.rawSetItem(key, goals);
  h.signIn();
  h.snapshot({ coins_v1: JSON.stringify({ balance: 10, earned: 10, spent: 0, history: [] }) });
  await Promise.resolve();

  assert.ok(h.sets.length > 0);
  const lastSet = h.sets[h.sets.length - 1];
  assert.equal(lastSet['data.' + key], goals);
  assert.equal(Object.prototype.hasOwnProperty.call(lastSet, 'data'), false);
  assert.equal(h.setOptions[h.setOptions.length - 1].merge, true);
});

test('local key deletion is pushed and not restored by a stale cloud snapshot', async () => {
  const h = loadFirebaseSync();
  const key = 'goals:2026-05-28';
  const goals = JSON.stringify([{ text: 'Разобрать стол', done: false }]);
  const oldMeta = JSON.stringify({ [key]: 1000 });

  h.localStorage.rawSetItem(key, goals);
  h.localStorage.rawSetItem('_sync_meta_v1', oldMeta);
  h.signIn();
  h.snapshot({ [key]: goals, _sync_meta_v1: oldMeta });
  h.localStorage.rawRemoveItem(key);
  h.dispatch('dashboard-data-changed', { key });
  h.runTimers();
  await Promise.resolve();
  h.snapshot({ [key]: goals, _sync_meta_v1: oldMeta });

  assert.equal(h.localStorage.getItem(key), null);
  const lastSet = h.sets[h.sets.length - 1];
  assert.equal(lastSet['data.' + key], 'delete-field');
  assert.match(lastSet['data._sync_deleted_v1'], /goals:2026-05-28/);
  assert.equal(h.setOptions[h.setOptions.length - 1].merge, true);
});

test('removeItem records a deletion for sync', async () => {
  const h = loadFirebaseSync();
  const key = 'goals:2026-05-28';
  const goals = JSON.stringify([{ text: 'Разобрать стол', done: false }]);
  const oldMeta = JSON.stringify({ [key]: 1000 });

  h.localStorage.rawSetItem(key, goals);
  h.localStorage.rawSetItem('_sync_meta_v1', oldMeta);
  h.signIn();
  h.snapshot({ [key]: goals, _sync_meta_v1: oldMeta });
  h.localStorage.removeItem(key);
  h.runTimers();
  await Promise.resolve();

  assert.equal(h.localStorage.getItem(key), null);
  const lastSet = h.sets[h.sets.length - 1];
  assert.equal(lastSet['data.' + key], 'delete-field');
  assert.match(lastSet['data._sync_deleted_v1'], /goals:2026-05-28/);
  assert.equal(h.setOptions[h.setOptions.length - 1].merge, true);
});

test('newer cloud deletion removes an existing local key', () => {
  const h = loadFirebaseSync();
  const key = 'goals:2026-05-28';
  const goals = JSON.stringify([{ text: 'Разобрать стол', done: false }]);

  h.localStorage.rawSetItem(key, goals);
  h.localStorage.rawSetItem('_sync_meta_v1', JSON.stringify({ [key]: 1000 }));
  h.signIn();
  h.snapshot({
    _sync_meta_v1: JSON.stringify({ [key]: 1000 }),
    _sync_deleted_v1: JSON.stringify({ [key]: 2000 }),
  });

  assert.equal(h.localStorage.getItem(key), null);
});

test('local store changes made before Firebase is ready beat older cloud data', async () => {
  const h = loadFirebaseSync({ autoLoadSdk: false });
  const localStore = JSON.stringify({
    rewards: [{ id: 'custom_early', name: 'Ранний кастом', price: 42, icon: '🎁' }],
    purchases: [],
  });
  const olderCloudStore = JSON.stringify({
    rewards: [{ id: 'series_1h', name: '1 час сериала', price: 50, icon: '📺' }],
    purchases: [],
  });

  h.localStorage.setItem('store_v1', localStore);
  h.loadSdk();
  h.signIn();
  h.snapshot({ store_v1: olderCloudStore, _sync_meta_v1: JSON.stringify({ store_v1: 1000 }) });
  await Promise.resolve();

  assert.equal(h.localStorage.getItem('store_v1'), localStore);
  assert.ok(h.sets.length > 0);
  assert.equal(h.sets[h.sets.length - 1]['data.store_v1'], localStore);
  assert.equal(h.setOptions[h.setOptions.length - 1].merge, true);
});

test('cloud-applied store changes emit render events', () => {
  const h = loadFirebaseSync();
  const events = [];
  const remoteStore = JSON.stringify({
    rewards: [{ id: 'remote_reward', name: 'С телефона', price: 70, icon: '📱' }],
    purchases: [],
  });

  h.listen('dashboard-sync-applied', function (e) { events.push({ type: e.type, detail: e.detail }); });
  h.listen('gamification-update', function (e) { events.push({ type: e.type, detail: e.detail }); });
  h.signIn();
  h.snapshot({ store_v1: remoteStore, _sync_meta_v1: JSON.stringify({ store_v1: 2000 }) });

  assert.equal(h.localStorage.getItem('store_v1'), remoteStore);
  assert.ok(events.some(function (e) {
    return e.type === 'dashboard-sync-applied' && e.detail.changedKeys.indexOf('store_v1') !== -1;
  }));
  assert.ok(events.some(function (e) { return e.type === 'gamification-update'; }));
});

test('Firebase SDK localStorage keys are ignored by dashboard sync metadata', () => {
  const h = loadFirebaseSync({ autoLoadSdk: false });

  h.localStorage.setItem('firebase:authUser:demo:[DEFAULT]', '{"uid":"user-1"}');
  h.localStorage.setItem('firebase-heartbeat-database', '{}');

  assert.equal(h.localStorage.getItem('_sync_meta_v1'), null);
  assert.equal(h.localStorage.getItem('_sync_deleted_v1'), null);
});

test('explicit store changes flush immediately after the initial snapshot', async () => {
  const h = loadFirebaseSync();
  const cloudStore = JSON.stringify({ rewards: [], purchases: [] });
  const localStore = JSON.stringify({
    rewards: [{ id: 'custom_now', name: 'Сразу', price: 33, icon: '⚡' }],
    purchases: [],
  });

  h.localStorage.rawSetItem('store_v1', cloudStore);
  h.signIn();
  h.snapshot({ store_v1: cloudStore, _sync_meta_v1: JSON.stringify({ store_v1: 1000 }) });
  const before = h.sets.length;
  h.localStorage.rawSetItem('store_v1', localStore);
  h.dispatch('dashboard-data-changed', { key: 'store_v1' });
  await Promise.resolve();

  assert.equal(h.sets.length, before + 1);
  assert.equal(h.sets[h.sets.length - 1]['data.store_v1'], localStore);
  assert.equal(h.setOptions[h.setOptions.length - 1].merge, true);
});
