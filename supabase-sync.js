(function () {
  'use strict';

  /* ── Supabase config ── */
  // TODO: Replace with your actual credentials
  var SUPABASE_URL = 'https://yiuiiixovxmoqifsdsuf.supabase.co';
  var SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlpdWlpaXhvdnhtb3FpZnNkc3VmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODA0MDg1MTEsImV4cCI6MjA5NTk4NDUxMX0.DJIfFDxPVq9s6s16AdfLyFMJqY9WuWnB-kgxd0UaF10';

  /* ── Load Supabase SDK ── */
  var sdkURL = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2';
  var sdkReady = false;
  var supabase = null;

  function loadSDK() {
    var s = document.createElement('script');
    s.src = sdkURL;
    s.onload = function () {
      if (window.supabase) {
        onSDKReady();
      } else {
        console.error('Supabase SDK failed to initialize from window');
      }
    };
    s.onerror = function () {
      console.error('Supabase SDK load failed');
    };
    document.head.appendChild(s);
  }

  /* ── State ── */
  var SYNC_VERSION = '26-sb';
  var currentUser = null;
  var syncEnabled = false;
  var isSyncing = false; // true while applying cloud data to localStorage
  var hasPendingLocalChanges = false;
  var subscription = null;

  var SYNC_META_KEY = '_sync_meta_v1';
  var DELETE_META_KEY = '_sync_deleted_v1';
  var SKIP_KEYS = ['_sync_reload_at', '_sync_debug_v1', 'supabase.auth.token']; 

  function shouldSkipStorageKey(key) {
    if (!key) return true;
    if (SKIP_KEYS.indexOf(key) !== -1) return true;
    if (key.indexOf('sb-') === 0) return true; // Supabase internal keys
    if (key.indexOf('firebase:') === 0) return true;
    return false;
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

  /* ── SDK Ready ── */
  function onSDKReady() {
    sdkReady = true;
    supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

    // Initial auth check
    supabase.auth.getSession().then(function (res) {
      handleAuthStateChange(res.data.session ? res.data.session.user : null);
    });

    // Auth listener
    supabase.auth.onAuthStateChange(function (event, session) {
      handleAuthStateChange(session ? session.user : null);
    });

    installStorageHook();
    installChangeListeners();
    updateAuthUI();
  }

  function handleAuthStateChange(user) {
    var userChanged = (!currentUser && user) || (currentUser && !user) || (currentUser && user && currentUser.id !== user.id);
    currentUser = user;
    syncEnabled = !!user;

    if (userChanged) {
      if (user) {
        startRealtimeSync();
      } else {
        stopRealtimeSync();
      }
    }
    updateAuthUI();
  }

  function startGoogleSignIn() {
    if (!supabase) return;
    supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: window.location.origin + window.location.pathname
      }
    });
  }

  function signOut() {
    if (!supabase) return;
    supabase.auth.signOut().then(function() {
        // Clear sync metadata on logout to start fresh next time
        localStorage.removeItem(SYNC_META_KEY);
        localStorage.removeItem(DELETE_META_KEY);
        window.location.reload();
    });
  }

  /* ── Storage Hooks ── */
  var rawSetItem = null;
  var rawRemoveItem = null;

  function installStorageHook() {
    try {
      if (window.Storage && window.Storage.prototype && window.Storage.prototype.setItem) {
        var nativeSetItem = window.Storage.prototype.setItem;
        var nativeRemoveItem = window.Storage.prototype.removeItem;
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
      }
    } catch (e) {
        console.error('Failed to install storage hooks', e);
    }
  }

  function installChangeListeners() {
    window.addEventListener('storage', function (e) {
      if (!isSyncing) schedulePush(e && e.key);
    });

    window.addEventListener('dashboard-data-changed', function (e) {
      var key = e && e.detail && e.detail.key;
      if (!isSyncing) schedulePush(key);
    });
  }

  /* ── Sync Logic ── */
  var syncDebounceTimer = null;
  var SYNC_DEBOUNCE_MS = 1000;

  function schedulePush(key) {
    if (isSyncing || !syncEnabled || !currentUser) return;
    if (key && shouldSkipStorageKey(key)) return;
    
    clearTimeout(syncDebounceTimer);
    syncDebounceTimer = setTimeout(pushAllToCloud, SYNC_DEBOUNCE_MS);
  }

  function pushAllToCloud() {
    if (!currentUser || !supabase) return;

    var keys = getAllSyncKeys();
    var rows = keys.map(function(k) {
        return {
            user_id: currentUser.id,
            key: k,
            value: localStorage.getItem(k),
            updated_at: new Date().toISOString()
        };
    });

    if (rows.length === 0) return;

    supabase.from('user_data').upsert(rows, { onConflict: 'user_id, key' })
      .then(function(res) {
          if (res.error) console.error('Push error:', res.error);
          else showSyncIndicator('pushed');
      });
  }

  function startRealtimeSync() {
    if (!currentUser || !supabase) return;

    // 1. Initial Pull
    pullFromCloud();

    // 2. Subscribe to changes
    if (subscription) {
      supabase.removeChannel(subscription);
    }

    subscription = supabase
      .channel('public:user_data')
      .on('postgres_changes', { 
        event: '*', 
        schema: 'public', 
        table: 'user_data',
        filter: 'user_id=eq.' + currentUser.id
      }, function(payload) {
        if (!isSyncing) handleCloudChange(payload);
      })
      .subscribe();
  }

  function stopRealtimeSync() {
    if (subscription) {
      supabase.removeChannel(subscription);
      subscription = null;
    }
  }

  function pullFromCloud() {
    if (!currentUser || !supabase) return;
    
    isSyncing = true;
    supabase.from('user_data').select('key, value, updated_at')
      .eq('user_id', currentUser.id)
      .then(function(res) {
        if (res.data) {
          var changedKeys = [];
          res.data.forEach(function(row) {
            var localVal = localStorage.getItem(row.key);
            if (localVal !== row.value) {
              rawSetItem(row.key, row.value);
              changedKeys.push(row.key);
            }
          });
          if (changedKeys.length > 0) {
            notifySyncedDataApplied(changedKeys);
          }
        }
        isSyncing = false;
        showSyncIndicator('synced');
      })
      .catch(function(err) {
        console.error('Pull error:', err);
        isSyncing = false;
      });
  }

  function handleCloudChange(payload) {
    if (payload.eventType === 'INSERT' || payload.eventType === 'UPDATE') {
      var row = payload.new;
      if (localStorage.getItem(row.key) !== row.value) {
        isSyncing = true;
        rawSetItem(row.key, row.value);
        notifySyncedDataApplied([row.key]);
        isSyncing = false;
        showSyncIndicator('synced');
      }
    }
  }

  function notifySyncedDataApplied(changedKeys) {
    window.dispatchEvent(new CustomEvent('dashboard-sync-applied', {
      detail: { changedKeys: changedKeys, version: SYNC_VERSION }
    }));
    window.dispatchEvent(new CustomEvent('gamification-update', {
      detail: { source: 'sync', changedKeys: changedKeys }
    }));
  }

  /* ── UI Logic ── */
  function waitForTopbar() {
    var topbar = document.getElementById('topbar');
    if (topbar) {
      injectAuthUI();
    } else {
      setTimeout(waitForTopbar, 200);
    }
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
        alert('Supabase loading...');
        return;
      }
      if (currentUser) {
        if (confirm('Выйти из синхронизации?\n\nДанные останутся на этом устройстве.')) {
          signOut();
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
      var photo = currentUser.user_metadata ? currentUser.user_metadata.avatar_url : null;
      if (photo) {
        btn.innerHTML = '<img src="' + photo + '" style="width:100%;height:100%;border-radius:50%;object-fit:cover">';
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

  function showSyncIndicator(type) {
    var btn = document.getElementById('syncAuthBtn');
    if (!btn) return;
    btn.style.borderColor = type === 'synced' ? 'rgba(107,227,164,0.5)' : 'rgba(242,192,99,0.5)';
    setTimeout(function () {
      btn.style.borderColor = currentUser ? 'rgba(107,227,164,0.3)' : 'rgba(255,255,255,0.15)';
    }, 1500);
  }

  /* ── Initialize ── */
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', waitForTopbar, { once: true });
  } else {
    waitForTopbar();
  }
  loadSDK();

  /* ── Public API ── */
  window.SupabaseSync = {
    version: SYNC_VERSION,
    isSignedIn: function () { return !!currentUser; },
    getUser: function () { return currentUser; },
    pullNow: pullFromCloud,
    pushNow: pushAllToCloud
  };

})();
