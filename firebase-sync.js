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

  /* ── Load Firebase SDK (compat version for simplicity) ── */
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
      // Still try to inject the button so user sees something
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
  var isSyncing = false;

  // Keys we sync to Firestore
  var SYNC_KEYS = [
    'coins_v1', 'spheres_v1', 'sphere_defs_v1', 'achievements_v1',
    'tracker_v1', 'po_water_v1', 'pomo_history_v1',
    'fin_accounts_v1', 'fin_subs_v1', 'fin_wishlist_v1', 'fin_reports_v1',
    'yearly_goals_v1', 'rewards_v1', 'penalty_log_v1',
    'dayskip_last_check_v1', 'gym_v1', 'health_v1'
  ];
  // Also sync any key starting with 'pomo:' (daily pomo counts)
  function getAllSyncKeys() {
    var keys = SYNC_KEYS.slice();
    for (var i = 0; i < localStorage.length; i++) {
      var k = localStorage.key(i);
      if (k && (k.indexOf('pomo:') === 0 || k.indexOf('tasks:') === 0 || k.indexOf('timer_') === 0)) {
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

    // Enable offline persistence
    db.enablePersistence({ synchronizeTabs: true }).catch(function (err) {
      console.warn('Firestore persistence:', err.code);
    });

    // Auth state listener
    firebase.auth().onAuthStateChanged(function (user) {
      currentUser = user;
      syncEnabled = !!user;
      updateAuthUI();
      if (user) {
        pullFromCloud();
      }
    });

    // Listen for localStorage changes (from other tabs or gamification.js writes)
    window.addEventListener('storage', schedulePush);
    window.addEventListener('gamification-update', schedulePush);

    // Intercept localStorage.setItem to catch same-tab writes
    var origSetItem = localStorage.setItem.bind(localStorage);
    localStorage.setItem = function (key, value) {
      origSetItem(key, value);
      if (!isSyncing) schedulePush();
    };

    // Update UI now that SDK is loaded
    updateAuthUI();
  }

  /* ── Auth UI — injected immediately, doesn't wait for SDK ── */
  function waitForTopbar() {
    var topbar = document.getElementById('topbar');
    if (topbar) {
      injectAuthUI();
    } else {
      setTimeout(waitForTopbar, 200);
    }
  }

  // Start looking for topbar right away (don't wait for SDK)
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', waitForTopbar, { once: true });
  } else {
    waitForTopbar();
  }

  function injectAuthUI() {
    var topbar = document.getElementById('topbar');
    if (!topbar) return;

    // Check if already injected
    if (document.getElementById('syncAuthBtn')) return;

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
        alert('Firebase загружается, подождите пару секунд...');
        return;
      }
      if (currentUser) {
        if (confirm('Выйти из синхронизации?\n\nДанные останутся на этом устройстве.')) {
          firebase.auth().signOut();
        }
      } else {
        var provider = new firebase.auth.GoogleAuthProvider();
        firebase.auth().signInWithPopup(provider).catch(function (err) {
          // Popup blocked? Try redirect
          if (err.code === 'auth/popup-blocked' || err.code === 'auth/popup-closed-by-user') {
            firebase.auth().signInWithRedirect(provider);
          } else {
            console.error('Auth error:', err);
            alert('Ошибка входа: ' + err.message);
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
      btn.title = 'Синхронизация: ' + currentUser.email;
    } else {
      btn.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="rgba(255,255,255,0.5)" stroke="none"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 3c1.66 0 3 1.34 3 3s-1.34 3-3 3-3-1.34-3-3 1.34-3 3-3zm0 14.2c-2.5 0-4.71-1.28-6-3.22.03-1.99 4-3.08 6-3.08 1.99 0 5.97 1.09 6 3.08-1.29 1.94-3.5 3.22-6 3.22z"/></svg>';
      btn.title = 'Войти для синхронизации';
      btn.style.borderColor = 'rgba(255,255,255,0.15)';
    }
  }

  /* ── Sync: Push local → Cloud ── */
  function schedulePush() {
    if (!syncEnabled || !currentUser) return;
    clearTimeout(syncDebounceTimer);
    syncDebounceTimer = setTimeout(pushToCloud, SYNC_DEBOUNCE_MS);
  }

  function pushToCloud() {
    if (!syncEnabled || !currentUser || !db) return;

    var data = {};
    var keys = getAllSyncKeys();
    keys.forEach(function (key) {
      var val = localStorage.getItem(key);
      if (val !== null) {
        data[sanitizeKey(key)] = val;
      }
    });

    // Store as a single document per user (simple, avoids complex merging)
    db.collection('users').doc(currentUser.uid).set({
      data: data,
      updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
      email: currentUser.email
    }, { merge: true }).then(function () {
      showSyncIndicator('pushed');
    }).catch(function (err) {
      console.error('Push failed:', err);
    });
  }

  /* ── Sync: Pull cloud → Local ── */
  function pullFromCloud() {
    if (!currentUser || !db) return;

    db.collection('users').doc(currentUser.uid).get().then(function (doc) {
      if (doc.exists && doc.data().data) {
        isSyncing = true;
        var cloudData = doc.data().data;
        var changed = false;

        // Apply cloud data, track if anything actually changed
        Object.keys(cloudData).forEach(function (sanitized) {
          var originalKey = unsanitizeKey(sanitized);
          var cloudVal = cloudData[sanitized];
          if (cloudVal !== null && cloudVal !== undefined) {
            var localVal = localStorage.getItem(originalKey);
            if (localVal !== cloudVal) {
              localStorage.setItem(originalKey, cloudVal);
              changed = true;
            }
          }
        });

        isSyncing = false;

        // Update UI without reloading (reload causes infinite loops)
        if (changed) {
          window.dispatchEvent(new CustomEvent('gamification-update'));
        }
      } else {
        // No cloud data yet — push current local data
        pushToCloud();
      }
      showSyncIndicator('synced');
    }).catch(function (err) {
      console.error('Pull failed:', err);
    });
  }

  /* ── Firestore key sanitization (dots and slashes not allowed) ── */
  function sanitizeKey(key) {
    return key.replace(/\./g, '__DOT__').replace(/\//g, '__SLASH__');
  }
  function unsanitizeKey(key) {
    return key.replace(/__DOT__/g, '.').replace(/__SLASH__/g, '/');
  }

  /* ── Visual sync indicator ── */
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
    pushNow: pushToCloud,
    pullNow: pullFromCloud
  };

})();
