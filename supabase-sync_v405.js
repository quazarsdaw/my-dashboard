(function () {
  'use strict';
  var SYNC_VERSION = 'v1';
  var SYNC_META_KEY = '_sync_meta_v1';
  var SYNC_DEBOUNCE_MS = 1000;

  var supabase = null, currentUser = null, sdkReady = false, syncEnabled = true;
  var pendingKeys = {}, isSyncing = false, lastLocalPushAt = 0;

  function rawSetItem(k, v) { window.Storage.prototype.setItem.call(localStorage, k, v); }

  function initSupabase() {
    if (window.supabase) {
      supabase = window.supabase.createClient('https://rruyvksmreigvvepwvtt.supabase.co', 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJydXl2a3NtcmVpZ3Z2ZXB3dnR0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3MTgzODUwNjYsImV4cCI6MjAzMzk2MTA2Nn0.6N5_ZfVf7z7_8u9vWv9vWv9vWv9vWv9vWv9vWv9vWv9v');
      sdkReady = true;
      checkAuth();
    }
  }

  function checkAuth() {
    supabase.auth.getSession().then(function(res) {
      currentUser = res.data.session ? res.data.session.user : null;
      if (currentUser) startSync();
    });
    supabase.auth.onAuthStateChange(function(event, session) {
      currentUser = session ? session.user : null;
      if (currentUser) startSync();
    });
  }

  function startSync() {
    console.log('[SUPABASE] Синхронизация активна');
    window.DashboardSync = {
      forceSync: function(key) {
        if (!currentUser) return Promise.resolve();
        pendingKeys[key] = true;
        return syncNow();
      }
    };
  }

  function syncNow() {
    if (!currentUser || isSyncing) return Promise.resolve();
    var keys = Object.keys(pendingKeys);
    if (keys.length === 0) return Promise.resolve();

    var rows = [];
    keys.forEach(function(k) {
      var val = localStorage.getItem(k);
      if (val) rows.push({ user_id: currentUser.id, key: k, value: JSON.parse(val), updated_at: new Date().toISOString() });
    });

    isSyncing = true;
    pendingKeys = {};
    return supabase.from('user_data').upsert(rows, { onConflict: 'user_id, key' })
      .then(function(res) {
        isSyncing = false;
        if (res.error) console.error('[SUPABASE] Ошибка:', res.error.message);
        else console.log('[SUPABASE] База обновлена');
        return res;
      });
  }

  // Hook localStorage
  var nativeSet = window.Storage.prototype.setItem;
  window.Storage.prototype.setItem = function(k, v) {
    nativeSet.call(this, k, v);
    if (this === localStorage && !isSyncing && k.indexOf('_sync') === -1) {
      pendingKeys[k] = true;
      setTimeout(syncNow, SYNC_DEBOUNCE_MS);
    }
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initSupabase); else initSupabase();
})();
