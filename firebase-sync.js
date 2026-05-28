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
  loadNext();

  /* ── State ── */
  var db = null;
  var currentUser = null;
  var syncEnabled = false;
  var syncDebounceTimer = null;
  var SYNC_DEBOUNCE_MS = 2000;
  var isSyncing = false;      // true while applying cloud data to localStorage
  var hasPendingLocalChanges = false; // local edits waiting to be pushed must not be overwritten by stale snapshots
  var unsubSnapshot = null;    // onSnapshot unsubscribe function
  var rawSetItem = null;       // native localStorage writer used when applying cloud data

  // Sync ALL localStorage keys — no whitelist, nothing gets missed
  var SKIP_KEYS = ['_sync_reload_at']; // internal keys to skip

  function getAllSyncKeys() {
    var keys = [];
    for (var i = 0; i < localStorage.length; i++) {
      var k = localStorage.key(i);
      if (k && SKIP_KEYS.indexOf(k) === -1) {
        keys.push(k);
      }
    }
    return keys;
  }

  /* ── SDK Ready ── */
  function onSDKReady() {
    sdkReady = true;
    firebase.initializeApp(firebaseConfig);
    db = firebase.firestore();

    installStorageHook();

    // Auth state listener
    firebase.auth().onAuthStateChanged(function (user) {
      currentUser = user;
      syncEnabled = !!user;
      updateAuthUI();
      if (user) {
        startRealtimeSync();
      } else {
        stopRealtimeSync();
      }
    });

    // Cross-tab changes
    window.addEventListener('storage', function () {
      if (!isSyncing) schedulePush();
    });

    window.addEventListener('dashboard-data-changed', function () {
      if (!isSyncing) schedulePush();
    });

    // Gamification.js events (backup in case setItem interception misses)
    window.addEventListener('gamification-update', function () {
      if (!isSyncing) schedulePush();
    });

    updateAuthUI();
  }

  /* ═══════════════════════════════════════════════════════
     REALTIME SYNC — onSnapshot listener
     ═══════════════════════════════════════════════════════ */
  var initialSnapshotDone = false;

  function installStorageHook() {
    try {
      if (window.Storage && window.Storage.prototype && window.Storage.prototype.setItem) {
        var nativeSetItem = window.Storage.prototype.setItem;
        rawSetItem = function (key, value) { nativeSetItem.call(localStorage, key, value); };
        window.Storage.prototype.setItem = function (key, value) {
          nativeSetItem.call(this, key, value);
          if (this === localStorage && !isSyncing) schedulePush();
        };
        return;
      }
    } catch (e) {}

    var nativeLocalSetItem = localStorage.setItem.bind(localStorage);
    rawSetItem = function (key, value) { nativeLocalSetItem(key, value); };
    try {
      localStorage.setItem = function (key, value) {
        nativeLocalSetItem(key, value);
        if (!isSyncing) schedulePush();
      };
    } catch (e) {}
  }

  function setLocalStorageRaw(key, value) {
    if (rawSetItem) {
      rawSetItem(key, value);
    } else {
      localStorage.setItem(key, value);
    }
  }

  function cloudMatchesLocal(cloudData) {
    var keys = getAllSyncKeys();
    for (var i = 0; i < keys.length; i++) {
      var key = keys[i];
      var localVal = localStorage.getItem(key);
      if (localVal !== null && cloudData[sanitizeKey(key)] !== localVal) {
        return false;
      }
    }
    return true;
  }

  function startRealtimeSync() {
    if (unsubSnapshot) unsubSnapshot();
    if (!currentUser || !db) return;
    initialSnapshotDone = false;

    unsubSnapshot = db.collection('users').doc(currentUser.uid)
      .onSnapshot(function (doc) {
        if (!doc.exists || !doc.data() || !doc.data().data) {
          // No cloud data — push everything local
          pushToCloud();
          initialSnapshotDone = true;
          return;
        }

        isSyncing = true;
        var cloudData = doc.data().data;
        var changed = false;

        if (!initialSnapshotDone) {
          // ── FIRST SNAPSHOT: local wins ──
          // Only import cloud keys we DON'T have locally.
          // Never overwrite existing local data.
          Object.keys(cloudData).forEach(function (sanitized) {
            var originalKey = unsanitizeKey(sanitized);
            var cloudVal = cloudData[sanitized];
            if (cloudVal !== null && cloudVal !== undefined) {
              var localVal = localStorage.getItem(originalKey);
              if (localVal === null) {
                // Key missing locally — import from cloud
                setLocalStorageRaw(originalKey, cloudVal);
                changed = true;
              }
            }
          });
          initialSnapshotDone = true;
          isSyncing = false;

          // Push local data to cloud (merges, doesn't delete cloud keys)
          pushToCloud();

          if (changed) {
            // Imported new keys — reload to render them
            var lastReload = parseInt(sessionStorage.getItem('_sync_reload_at') || '0', 10);
            if (Date.now() - lastReload > 3000) {
              sessionStorage.setItem('_sync_reload_at', String(Date.now()));
              window.location.reload();
              return;
            }
          }
          showSyncIndicator('synced');

        } else {
          // ── SUBSEQUENT SNAPSHOTS: real-time from other devices ──
          if (hasPendingLocalChanges) {
            if (cloudMatchesLocal(cloudData)) {
              hasPendingLocalChanges = false;
              showSyncIndicator('synced');
            }
            isSyncing = false;
            return;
          }

          // Cloud wins — apply all changes
          Object.keys(cloudData).forEach(function (sanitized) {
            var originalKey = unsanitizeKey(sanitized);
            var cloudVal = cloudData[sanitized];
            if (cloudVal !== null && cloudVal !== undefined) {
              var localVal = localStorage.getItem(originalKey);
              if (localVal !== cloudVal) {
                setLocalStorageRaw(originalKey, cloudVal);
                changed = true;
              }
            }
          });
          isSyncing = false;

          if (changed) {
            var lastReload2 = parseInt(sessionStorage.getItem('_sync_reload_at') || '0', 10);
            if (Date.now() - lastReload2 > 3000) {
              sessionStorage.setItem('_sync_reload_at', String(Date.now()));
              window.location.reload();
              return;
            }
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
        var provider = new firebase.auth.GoogleAuthProvider();
        firebase.auth().signInWithPopup(provider).catch(function (err) {
          if (err.code === 'auth/popup-blocked' || err.code === 'auth/popup-closed-by-user') {
            firebase.auth().signInWithRedirect(provider);
          } else {
            console.error('Auth error:', err);
            alert('Auth error: ' + err.message);
          }
        });
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
  function schedulePush() {
    if (!syncEnabled || !currentUser || isSyncing) return;
    hasPendingLocalChanges = true;
    clearTimeout(syncDebounceTimer);
    syncDebounceTimer = setTimeout(pushToCloud, SYNC_DEBOUNCE_MS);
  }

  function pushToCloudThen(callback) {
    if (!currentUser || !db) { if (callback) callback(); return; }

    var updates = {
      updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
      email: currentUser.email
    };
    var keys = getAllSyncKeys();
    var hasData = false;
    keys.forEach(function (key) {
      var val = localStorage.getItem(key);
      if (val !== null) {
        updates['data.' + sanitizeKey(key)] = val;
        hasData = true;
      }
    });

    if (!hasData) {
      // Nothing to push — just start listening
      hasPendingLocalChanges = false;
      if (callback) callback();
      return;
    }

    hasPendingLocalChanges = true;
    db.collection('users').doc(currentUser.uid).set(updates, { merge: true })
      .then(function () {
        showSyncIndicator('pushed');
        if (callback) callback();
      }).catch(function (err) {
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

  /* ── Public API ── */
  window.FirebaseSync = {
    isSignedIn: function () { return !!currentUser; },
    getUser: function () { return currentUser; },
    pushNow: pushToCloud
  };

})();
