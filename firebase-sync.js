(function () {
  'use strict';

  /* ── Firebase config ── */
  var firebaseConfig = {
    apiKey: "AIzaSyCROjrB7qeJa5pwwyDx_iyVuIpevpSNbBw",
    authDomain: "quazar-dash.firebaseapp.com",
    projectId: "quazar-dash",
    storageBucket: "quazar-dash.firebasestorage.app",
    messagingSenderId: "510766320600",
    appId: "1:510766320600:web:671d7003be1aead6b500ad"
  };

  /* ── Load Firebase SDK (compat) ── */
  var sdkBase = 'https://www.gstatic.com/firebasejs/10.12.2/';
  var scriptsToLoad = [
    sdkBase + 'firebase-app-compat.js',
    sdkBase + 'firebase-auth-compat.js',
    sdkBase + 'firebase-firestore-compat.js'
  ];

  var loaded = 0;
  var sdkReady = false;

  function loadNext() {
    if (loaded >= scriptsToLoad.length) {
      onSDKReady();
      return;
    }
    var s = document.createElement('script');
    s.src = scriptsToLoad[loaded];
    s.onload = function () { loaded++; loadNext(); };
    s.onerror = function () {
      console.error('Firebase SDK load failed:', scriptsToLoad[loaded]);
      injectAuthUI();
    };
    document.head.appendChild(s);
  }

  /* ── State ── */
  var SYNC_VERSION = '20';
  var db = null;
  var currentUser = null;
  var syncEnabled = false;
  var syncDebounceTimer = null;
  var SYNC_DEBOUNCE_MS = 2000;
  var URGENT_SYNC_KEYS = ['store_v1'];
  var isSyncing = false;      // true while applying cloud data to localStorage
  var hasPendingLocalChanges = false; // local edits waiting to be pushed must not be overwritten by stale snapshots
  var unsubSnapshot = null;    // onSnapshot unsubscribe function
  var rawSetItem = null;       // native localStorage writer used when applying cloud data
  var rawRemoveItem = null;    // native localStorage remover used when applying cloud data

  // Sync ALL localStorage keys — no whitelist, nothing gets missed
  var SKIP_KEYS = ['_sync_reload_at', '_sync_debug_v1']; // internal keys to skip
  var SYNC_META_KEY = '_sync_meta_v1';
  var DELETE_META_KEY = '_sync_deleted_v1';
  var listenersInstalled = false;
  var lastPushStatus = 'idle';
  var lastPushError = null;
  var lastPushAt = null;
  var lastSnapshotAt = null;
  var lastCloudKeys = [];
  var lastCloudData = null;
  var lastChangedKeys = [];
  var lastAuthMethod = null;
  var lastAuthError = null;

  function isInternalSyncKey(key) {
    return shouldSkipStorageKey(key) || key === SYNC_META_KEY || key === DELETE_META_KEY;
  }

  function shouldSkipStorageKey(key) {
    return !key ||
      SKIP_KEYS.indexOf(key) !== -1 ||
      key.indexOf('firebase:') === 0 ||
      key.indexOf('firebase-heartbeat') === 0 ||
      key.indexOf('firebase-installations') === 0;
  }

  function getAllSyncKeys() {
    var keys = [];
    for (var i = 0; i < localStorage.length; i++) {
      var k = localStorage.key(i);
      if (!shouldSkipStorageKey(k)) {
        keys.push(k);
      }
    }
    return keys;
  }

  installStorageHook();
  installChangeListeners();
  loadNext();

  /* ── SDK Ready ── */
  function onSDKReady() {
    sdkReady = true;
    firebase.initializeApp(firebaseConfig);
    db = firebase.firestore();

    var auth = firebase.auth();
    ensureAuthPersistence(auth);
    handleRedirectResult(auth);

    // Auth state listener
    auth.onAuthStateChanged(function (user) {
      currentUser = user;
      syncEnabled = !!user;
      updateAuthUI();
      if (user) {
        startRealtimeSync();
      } else {
        stopRealtimeSync();
      }
    });

    updateAuthUI();
  }

  function ensureAuthPersistence(auth) {
    try {
      if (auth && auth.setPersistence && firebase.auth.Auth &&
          firebase.auth.Auth.Persistence && firebase.auth.Auth.Persistence.LOCAL) {
        return auth.setPersistence(firebase.auth.Auth.Persistence.LOCAL).catch(function (err) {
          recordAuthError(err);
          console.warn('Auth persistence setup failed:', err);
        });
      }
    } catch (err) {
      recordAuthError(err);
      console.warn('Auth persistence setup failed:', err);
    }
    return Promise.resolve();
  }

  function handleRedirectResult(auth) {
    try {
      if (auth && auth.getRedirectResult) {
        auth.getRedirectResult().catch(function (err) {
          recordAuthError(err);
          console.error('Auth redirect error:', err);
        });
      }
    } catch (err) {
      recordAuthError(err);
      console.error('Auth redirect error:', err);
    }
  }

  function createGoogleProvider() {
    var provider = new firebase.auth.GoogleAuthProvider();
    if (provider.setCustomParameters) {
      provider.setCustomParameters({ prompt: 'select_account' });
    }
    return provider;
  }

  function isAppleMobile() {
    var nav = window.navigator || {};
    var ua = nav.userAgent || '';
    return /iPad|iPhone|iPod/.test(ua) ||
      (nav.platform === 'MacIntel' && nav.maxTouchPoints > 1);
  }

  function isStandaloneApp() {
    var nav = window.navigator || {};
    if (nav.standalone) return true;
    try {
      return !!(window.matchMedia && window.matchMedia('(display-mode: standalone)').matches);
    } catch (e) {
      return false;
    }
  }

  function shouldAvoidRedirectAuth() {
    return isAppleMobile() || isStandaloneApp();
  }

  function isPopupAuthError(err) {
    return err && (
      err.code === 'auth/popup-blocked' ||
      err.code === 'auth/popup-closed-by-user' ||
      err.code === 'auth/cancelled-popup-request'
    );
  }

  function recordAuthError(err) {
    lastAuthError = err ? ((err.code ? err.code + ': ' : '') + (err.message || String(err))) : null;
  }

  function getAuthErrorMessage(err) {
    var code = err && err.code || 'unknown';
    var message = err && err.message || String(err || 'unknown error');

    if (shouldAvoidRedirectAuth()) {
      return 'Не удалось открыть Google-вход на телефоне.\n\n' +
        'Если это иконка на домашнем экране, открой сайт в обычной вкладке Safari/Chrome ' +
        'и нажми кнопку синхронизации ещё раз. Разреши всплывающее окно, если браузер спросит.\n\n' +
        'Код: ' + code;
    }

    if (code === 'auth/unauthorized-domain') {
      return 'Домен не разрешён в Firebase Authentication.\n\n' +
        'Нужно добавить текущий домен в Firebase Console → Authentication → Settings → Authorized domains.';
    }

    if (code === 'auth/network-request-failed') {
      return 'Не удалось подключиться к Firebase Auth. Проверь интернет/VPN и попробуй ещё раз.';
    }

    return 'Auth error: ' + message;
  }

  function showAuthError(err) {
    recordAuthError(err);
    console.error('Auth error:', err);
    alert(getAuthErrorMessage(err));
  }

  function startGoogleSignIn() {
    var auth = firebase.auth();
    var provider = createGoogleProvider();
    lastAuthMethod = 'popup';
    lastAuthError = null;
    ensureAuthPersistence(auth);

    try {
      auth.signInWithPopup(provider).catch(function (err) {
        if (isPopupAuthError(err) && !shouldAvoidRedirectAuth()) {
          lastAuthMethod = 'redirect';
          return auth.signInWithRedirect(provider).catch(showAuthError);
        }
        showAuthError(err);
      });
    } catch (err) {
      showAuthError(err);
    }
  }

  function installChangeListeners() {
    if (listenersInstalled) return;
    listenersInstalled = true;

    // Cross-tab changes
    window.addEventListener('storage', function (e) {
      if (!isSyncing) schedulePush(e && e.key);
    });

    window.addEventListener('dashboard-data-changed', function (e) {
      var key = e && e.detail && e.detail.key;
      if (!isSyncing) schedulePush(key, URGENT_SYNC_KEYS.indexOf(key) !== -1);
    });

    // Gamification.js events (backup in case setItem interception misses)
    window.addEventListener('gamification-update', function () {
      if (!isSyncing) schedulePush();
    });
  }

  /* ═══════════════════════════════════════════════════════
     REALTIME SYNC — onSnapshot listener
     ═══════════════════════════════════════════════════════ */
  var initialSnapshotDone = false;

  function installStorageHook() {
    try {
      if (window.Storage && window.Storage.prototype && window.Storage.prototype.setItem) {
        var nativeSetItem = window.Storage.prototype.setItem;
        var nativeRemoveItem = window.Storage.prototype.removeItem;
        var nativeClear = window.Storage.prototype.clear;
        rawSetItem = function (key, value) { nativeSetItem.call(localStorage, key, value); };
        rawRemoveItem = function (key) { nativeRemoveItem.call(localStorage, key); };
        window.Storage.prototype.setItem = function (key, value) {
          nativeSetItem.call(this, key, value);
          if (this === localStorage && !isSyncing) schedulePush(key);
        };
        window.Storage.prototype.removeItem = function (key) {
          nativeRemoveItem.call(this, key);
          if (this === localStorage && !isSyncing) schedulePush(key);
        };
        window.Storage.prototype.clear = function () {
          if (this !== localStorage || isSyncing) {
            nativeClear.call(this);
            return;
          }
          var keys = getAllSyncKeys().filter(function (key) { return !isInternalSyncKey(key); });
          nativeClear.call(this);
          keys.forEach(function (key) { touchDeletedKey(key); });
          schedulePush();
        };
        return;
      }
    } catch (e) {}

    var nativeLocalSetItem = localStorage.setItem.bind(localStorage);
    var nativeLocalRemoveItem = localStorage.removeItem.bind(localStorage);
    var nativeLocalClear = localStorage.clear ? localStorage.clear.bind(localStorage) : null;
    rawSetItem = function (key, value) { nativeLocalSetItem(key, value); };
    rawRemoveItem = function (key) { nativeLocalRemoveItem(key); };
    try {
      localStorage.setItem = function (key, value) {
        nativeLocalSetItem(key, value);
        if (!isSyncing) schedulePush(key);
      };
      localStorage.removeItem = function (key) {
        nativeLocalRemoveItem(key);
        if (!isSyncing) schedulePush(key);
      };
      if (nativeLocalClear) {
        localStorage.clear = function () {
          if (isSyncing) {
            nativeLocalClear();
            return;
          }
          var keys = getAllSyncKeys().filter(function (key) { return !isInternalSyncKey(key); });
          nativeLocalClear();
          keys.forEach(function (key) { touchDeletedKey(key); });
          schedulePush();
        };
      }
    } catch (e) {}
  }

  function setLocalStorageRaw(key, value) {
    if (rawSetItem) {
      rawSetItem(key, value);
    } else {
      localStorage.setItem(key, value);
    }
  }

  function removeLocalStorageRaw(key) {
    if (rawRemoveItem) {
      rawRemoveItem(key);
    } else {
      localStorage.removeItem(key);
    }
  }

  function collectLocalData() {
    var data = {};
    var keys = getAllSyncKeys();
    keys.forEach(function (key) {
      var val = localStorage.getItem(key);
      if (val !== null) data[sanitizeKey(key)] = val;
    });
    return data;
  }

  function addLocalDataFieldUpdates(updates) {
    var keys = getAllSyncKeys();
    var hasData = false;
    keys.forEach(function (key) {
      var val = localStorage.getItem(key);
      if (val !== null) {
        updates['data.' + sanitizeKey(key)] = val;
        hasData = true;
      }
    });

    var deleted = readDeleteMeta();
    Object.keys(deleted).forEach(function (key) {
      if (isInternalSyncKey(key)) return;
      updates['data.' + sanitizeKey(key)] = firebase.firestore.FieldValue.delete();
      hasData = true;
    });

    return hasData;
  }

  function cloudMatchesLocal(cloudData) {
    var localData = collectLocalData();
    var localKeys = Object.keys(localData);
    var cloudKeys = Object.keys(cloudData || {}).filter(function (key) {
      return SKIP_KEYS.indexOf(unsanitizeKey(key)) === -1;
    });
    if (localKeys.length !== cloudKeys.length) return false;
    for (var i = 0; i < localKeys.length; i++) {
      var key = localKeys[i];
      if (cloudData[key] !== localData[key]) return false;
    }
    return true;
  }

  function readLocalMeta() {
    try { return JSON.parse(localStorage.getItem(SYNC_META_KEY)) || {}; } catch (e) { return {}; }
  }

  function writeLocalMeta(meta) {
    setLocalStorageRaw(SYNC_META_KEY, JSON.stringify(meta));
  }

  function readCloudMeta(cloudData) {
    try { return JSON.parse(cloudData[sanitizeKey(SYNC_META_KEY)] || '{}') || {}; } catch (e) { return {}; }
  }

  function readDeleteMeta() {
    try { return JSON.parse(localStorage.getItem(DELETE_META_KEY)) || {}; } catch (e) { return {}; }
  }

  function writeDeleteMeta(meta) {
    setLocalStorageRaw(DELETE_META_KEY, JSON.stringify(meta));
  }

  function readCloudDeleteMeta(cloudData) {
    try { return JSON.parse(cloudData[sanitizeKey(DELETE_META_KEY)] || '{}') || {}; } catch (e) { return {}; }
  }

  function touchLocalKey(key) {
    if (isInternalSyncKey(key)) return;
    var meta = readLocalMeta();
    meta[key] = Date.now();
    writeLocalMeta(meta);
    var deleted = readDeleteMeta();
    if (deleted[key]) {
      delete deleted[key];
      writeDeleteMeta(deleted);
    }
  }

  function touchDeletedKey(key) {
    if (isInternalSyncKey(key)) return;
    var deleted = readDeleteMeta();
    deleted[key] = Date.now();
    writeDeleteMeta(deleted);
    var meta = readLocalMeta();
    if (meta[key]) {
      delete meta[key];
      writeLocalMeta(meta);
    }
  }

  function mergeCloudData(cloudData) {
    var changed = false;
    var changedKeys = [];
    var shouldPushLocal = false;
    var localMeta = readLocalMeta();
    var cloudMeta = readCloudMeta(cloudData);
    var deletedMeta = readDeleteMeta();
    var cloudDeletedMeta = readCloudDeleteMeta(cloudData);
    var metaChanged = false;
    var deletedMetaChanged = false;

    function markChanged(key) {
      changed = true;
      if (changedKeys.indexOf(key) === -1) changedKeys.push(key);
    }

    function clearDeletedMeta(key) {
      if (deletedMeta[key]) {
        delete deletedMeta[key];
        deletedMetaChanged = true;
      }
    }

    function applyCloudDeletion(key, deletedTime) {
      if (localStorage.getItem(key) !== null) {
        removeLocalStorageRaw(key);
        markChanged(key);
      }
      if (localMeta[key]) {
        delete localMeta[key];
        metaChanged = true;
      }
      if (deletedTime && deletedMeta[key] !== deletedTime) {
        deletedMeta[key] = deletedTime;
        deletedMetaChanged = true;
      }
    }

    Object.keys(cloudData).forEach(function (sanitized) {
      var originalKey = unsanitizeKey(sanitized);
      if (isInternalSyncKey(originalKey)) return;

      var cloudVal = cloudData[sanitized];
      if (cloudVal === null || cloudVal === undefined) return;

      var localVal = localStorage.getItem(originalKey);
      var localTime = localMeta[originalKey] || 0;
      var cloudTime = cloudMeta[originalKey] || 0;
      var deleteTime = deletedMeta[originalKey] || 0;
      var cloudDeleteTime = cloudDeletedMeta[originalKey] || 0;

      if (cloudDeleteTime && cloudDeleteTime >= cloudTime && cloudDeleteTime > localTime) {
        applyCloudDeletion(originalKey, cloudDeleteTime);
        return;
      }

      if (localVal === null) {
        if (deleteTime && deleteTime >= cloudTime) {
          shouldPushLocal = true;
          return;
        }
        setLocalStorageRaw(originalKey, cloudVal);
        markChanged(originalKey);
        clearDeletedMeta(originalKey);
        if (cloudTime && localMeta[originalKey] !== cloudTime) {
          localMeta[originalKey] = cloudTime;
          metaChanged = true;
        }
        return;
      }

      if (cloudTime > Math.max(localTime, deleteTime)) {
        if (localVal !== cloudVal) {
          setLocalStorageRaw(originalKey, cloudVal);
          markChanged(originalKey);
        }
        clearDeletedMeta(originalKey);
        if (cloudTime && localMeta[originalKey] !== cloudTime) {
          localMeta[originalKey] = cloudTime;
          metaChanged = true;
        }
        return;
      }

      if (localVal !== cloudVal) {
        if (!localTime) {
          localMeta[originalKey] = Date.now();
          metaChanged = true;
        }
        shouldPushLocal = true;
      }
    });

    getAllSyncKeys().forEach(function (key) {
      if (isInternalSyncKey(key)) return;
      var localVal = localStorage.getItem(key);
      if (localVal !== null && cloudData[sanitizeKey(key)] === undefined) {
        var cloudDeleteTime = cloudDeletedMeta[key] || 0;
        var localTime = localMeta[key] || 0;
        if (cloudDeleteTime && cloudDeleteTime > localTime) {
          applyCloudDeletion(key, cloudDeleteTime);
          return;
        }
        if (!localMeta[key]) {
          localMeta[key] = Date.now();
          metaChanged = true;
        }
        shouldPushLocal = true;
      }
    });

    Object.keys(deletedMeta).forEach(function (key) {
      if (isInternalSyncKey(key)) return;
      var deleteTime = deletedMeta[key] || 0;
      var cloudTime = cloudMeta[key] || 0;
      var cloudDeleteTime = cloudDeletedMeta[key] || 0;
      if (deleteTime > cloudDeleteTime || (cloudData[sanitizeKey(key)] !== undefined && deleteTime >= cloudTime)) {
        shouldPushLocal = true;
      }
    });

    if (metaChanged) writeLocalMeta(localMeta);
    if (deletedMetaChanged) writeDeleteMeta(deletedMeta);
    return { changed: changed, changedKeys: changedKeys, shouldPushLocal: shouldPushLocal };
  }

  function notifySyncedDataApplied(changedKeys) {
    if (!changedKeys || changedKeys.length === 0) return;
    lastChangedKeys = changedKeys.slice();
    var previousSyncing = isSyncing;
    isSyncing = true;
    try {
      window.dispatchEvent(new CustomEvent('dashboard-sync-applied', {
        detail: { changedKeys: changedKeys.slice(), version: SYNC_VERSION }
      }));
    } catch (e) {}
    try {
      window.dispatchEvent(new CustomEvent('gamification-update', {
        detail: { source: 'sync', changedKeys: changedKeys.slice() }
      }));
    } catch (e) {}
    isSyncing = previousSyncing;
  }

  function startRealtimeSync() {
    if (unsubSnapshot) unsubSnapshot();
    if (!currentUser || !db) return;
    initialSnapshotDone = false;

    unsubSnapshot = db.collection('users').doc(currentUser.uid)
      .onSnapshot(function (doc) {
        lastSnapshotAt = new Date().toISOString();
        if (!doc.exists || !doc.data() || !doc.data().data) {
          // No cloud data — push everything local
          initialSnapshotDone = true;
          pushToCloud();
          return;
        }

        isSyncing = true;
        var cloudData = doc.data().data;
        lastCloudData = cloudData;
        lastCloudKeys = Object.keys(cloudData || {}).map(unsanitizeKey);
        var result = mergeCloudData(cloudData);
        var changed = result.changed;

        if (!initialSnapshotDone) {
          initialSnapshotDone = true;
          isSyncing = false;

          if (result.shouldPushLocal) pushToCloud();

          if (changed) {
            notifySyncedDataApplied(result.changedKeys);
          }
          showSyncIndicator('synced');

        } else {
          if (result.shouldPushLocal) pushToCloud();
          if (hasPendingLocalChanges && cloudMatchesLocal(cloudData)) {
            hasPendingLocalChanges = false;
            showSyncIndicator('synced');
          }
          isSyncing = false;

          if (changed) {
            notifySyncedDataApplied(result.changedKeys);
            showSyncIndicator('synced');
          }
        }

      }, function (err) {
        console.error('Realtime sync error:', err);
      });
  }

  function stopRealtimeSync() {
    if (unsubSnapshot) {
      unsubSnapshot();
      unsubSnapshot = null;
    }
  }

  /* ── Auth UI ── */
  function waitForTopbar() {
    var topbar = document.getElementById('topbar');
    if (topbar) {
      injectAuthUI();
      injectDebugUI();
    } else {
      setTimeout(waitForTopbar, 200);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', waitForTopbar, { once: true });
  } else {
    waitForTopbar();
  }

  function injectAuthUI() {
    var topbar = document.getElementById('topbar');
    if (!topbar || document.getElementById('syncAuthBtn')) return;

    var btn = document.createElement('button');
    btn.id = 'syncAuthBtn';
    btn.setAttribute('aria-label', 'Sync account');
    btn.style.cssText = 'background:none;border:1px solid rgba(255,255,255,0.15);border-radius:50%;' +
      'width:34px;height:34px;cursor:pointer;display:flex;align-items:center;justify-content:center;' +
      'font-size:16px;padding:0;-webkit-tap-highlight-color:transparent;transition:border-color 0.15s,opacity 0.15s;' +
      'flex-shrink:0;overflow:hidden;margin-right:auto;';
    topbar.insertBefore(btn, topbar.firstChild);

    btn.addEventListener('click', function () {
      if (!sdkReady) {
        alert('Firebase loading...');
        return;
      }
      if (currentUser) {
        if (confirm('Выйти из синхронизации?\n\nДанные останутся на этом устройстве.')) {
          firebase.auth().signOut();
        }
      } else {
        startGoogleSignIn();
      }
    });

    updateAuthUI();
  }

  function updateAuthUI() {
    var btn = document.getElementById('syncAuthBtn');
    if (!btn) return;

    if (currentUser) {
      if (currentUser.photoURL) {
        btn.innerHTML = '<img src="' + currentUser.photoURL + '" style="width:100%;height:100%;border-radius:50%;object-fit:cover">';
      } else {
        btn.textContent = '✓';
        btn.style.color = '#6BE3A4';
        btn.style.borderColor = 'rgba(107,227,164,0.3)';
      }
      btn.title = 'Sync: ' + currentUser.email;
    } else {
      btn.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="rgba(255,255,255,0.5)" stroke="none"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 3c1.66 0 3 1.34 3 3s-1.34 3-3 3-3-1.34-3-3 1.34-3 3-3zm0 14.2c-2.5 0-4.71-1.28-6-3.22.03-1.99 4-3.08 6-3.08 1.99 0 5.97 1.09 6 3.08-1.29 1.94-3.5 3.22-6 3.22z"/></svg>';
      btn.title = 'Sign in to sync';
      btn.style.borderColor = 'rgba(255,255,255,0.15)';
    }
  }

  /* ── Push local → Cloud ── */
  function schedulePush(key, immediate) {
    if (isSyncing) return;
    if (key && shouldSkipStorageKey(key)) return;
    if (key) {
      if (localStorage.getItem(key) === null) touchDeletedKey(key);
      else touchLocalKey(key);
    }
    hasPendingLocalChanges = true;
    if (!syncEnabled || !currentUser || !db) return;
    clearTimeout(syncDebounceTimer);
    if (immediate) {
      pushToCloud();
    } else {
      syncDebounceTimer = setTimeout(pushToCloud, SYNC_DEBOUNCE_MS);
    }
  }

  function pushToCloudThen(callback) {
    if (!currentUser || !db) { if (callback) callback(); return; }
    if (!initialSnapshotDone) {
      clearTimeout(syncDebounceTimer);
      syncDebounceTimer = setTimeout(pushToCloud, SYNC_DEBOUNCE_MS);
      if (callback) callback();
      return;
    }

    var updates = {
      updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
      email: currentUser.email
    };
    var hasData = addLocalDataFieldUpdates(updates);

    if (!hasData) {
      // Nothing to push — just start listening
      hasPendingLocalChanges = false;
      if (callback) callback();
      return;
    }

    hasPendingLocalChanges = true;
    lastPushStatus = 'pending';
    lastPushError = null;
    db.collection('users').doc(currentUser.uid).set(updates, { merge: true })
      .then(function () {
        lastPushStatus = 'ok';
        lastPushAt = new Date().toISOString();
        showSyncIndicator('pushed');
        if (callback) callback();
      }).catch(function (err) {
        lastPushStatus = 'error';
        lastPushError = err && (err.message || String(err));
        console.error('Push failed:', err);
        // Still start listening even if push fails
        if (callback) callback();
      });
  }

  function pushToCloud() {
    pushToCloudThen(null);
  }

  /* ── Firestore key sanitization ── */
  function sanitizeKey(key) {
    return key.replace(/\./g, '__DOT__').replace(/\//g, '__SLASH__');
  }
  function unsanitizeKey(key) {
    return key.replace(/__DOT__/g, '.').replace(/__SLASH__/g, '/');
  }

  /* ── Sync indicator ── */
  function showSyncIndicator(type) {
    var btn = document.getElementById('syncAuthBtn');
    if (!btn) return;
    btn.style.borderColor = type === 'synced' ? 'rgba(107,227,164,0.5)' : 'rgba(242,192,99,0.5)';
    setTimeout(function () {
      btn.style.borderColor = currentUser ? 'rgba(107,227,164,0.3)' : 'rgba(255,255,255,0.15)';
    }, 1500);
  }

  function hashString(value) {
    var str = value || '';
    var hash = 0;
    for (var i = 0; i < str.length; i++) {
      hash = ((hash << 5) - hash + str.charCodeAt(i)) | 0;
    }
    return (hash >>> 0).toString(16);
  }

  function getDebugState() {
    var storeValue = localStorage.getItem('store_v1') || '';
    var goalsKeys = getAllSyncKeys().filter(function (key) { return key.indexOf('goals:') === 0; }).sort();
    return {
      version: SYNC_VERSION,
      sdkReady: sdkReady,
      signedIn: !!currentUser,
      email: currentUser && currentUser.email || null,
      authMethod: lastAuthMethod,
      lastAuthError: lastAuthError,
      authRedirectDisabled: shouldAvoidRedirectAuth(),
      syncEnabled: syncEnabled,
      initialSnapshotDone: initialSnapshotDone,
      pendingLocalChanges: hasPendingLocalChanges,
      lastPushStatus: lastPushStatus,
      lastPushError: lastPushError,
      lastPushAt: lastPushAt,
      lastSnapshotAt: lastSnapshotAt,
      lastCloudKeys: lastCloudKeys.slice(-20),
      lastChangedKeys: lastChangedKeys.slice(),
      localKeysCount: getAllSyncKeys().length,
      storePresent: !!storeValue,
      storeHash: storeValue ? hashString(storeValue) : null,
      storeLength: storeValue.length,
      goalsKeys: goalsKeys
    };
  }

  function pullLatestCloudNow() {
    if (!lastCloudData) return;
    isSyncing = true;
    var result = mergeCloudData(lastCloudData);
    isSyncing = false;
    if (result.changed) notifySyncedDataApplied(result.changedKeys);
  }

  function injectDebugUI() {
    try {
      var enabled = window.location.search.indexOf('syncdebug=1') !== -1 ||
        localStorage.getItem('_sync_debug_v1') === '1';
      if (!enabled || document.getElementById('syncDebugPanel')) return;
    } catch (e) { return; }

    var panel = document.createElement('div');
    panel.id = 'syncDebugPanel';
    panel.style.cssText = 'position:fixed;left:10px;right:10px;bottom:82px;z-index:99999;' +
      'max-height:42vh;overflow:auto;background:rgba(5,5,6,0.94);color:#fafafa;' +
      'border:1px solid rgba(255,255,255,0.16);border-radius:10px;padding:10px;' +
      'font:11px ui-monospace,SFMono-Regular,Menlo,monospace;white-space:pre-wrap;' +
      'box-shadow:0 12px 40px rgba(0,0,0,0.5);';
    document.body.appendChild(panel);

    function button(label, action) {
      return '<button data-action="' + action + '" style="margin:0 6px 8px 0;padding:5px 8px;' +
        'border-radius:7px;border:1px solid rgba(255,255,255,0.18);background:rgba(255,255,255,0.08);' +
        'color:#fafafa;font:11px ui-monospace,SFMono-Regular,Menlo,monospace;">' + label + '</button>';
    }

    function render() {
      var state = getDebugState();
      panel.innerHTML =
        button('push local', 'push') +
        button('pull snapshot', 'pull') +
        button('hide', 'hide') +
        '\n' + JSON.stringify(state, null, 2);
    }

    panel.addEventListener('click', function (e) {
      var action = e.target && e.target.getAttribute && e.target.getAttribute('data-action');
      if (action === 'push') pushToCloud();
      if (action === 'pull') pullLatestCloudNow();
      if (action === 'hide') {
        localStorage.removeItem('_sync_debug_v1');
        panel.remove();
        return;
      }
      render();
    });

    render();
    setInterval(function () {
      if (document.getElementById('syncDebugPanel')) render();
    }, 1500);
  }

  /* ── Public API ── */
  window.FirebaseSync = {
    version: SYNC_VERSION,
    isSignedIn: function () { return !!currentUser; },
    getUser: function () { return currentUser; },
    pushNow: pushToCloud,
    pullNow: pullLatestCloudNow,
    debug: getDebugState,
    enableDebug: function () {
      localStorage.setItem('_sync_debug_v1', '1');
      injectDebugUI();
    }
  };

})();
