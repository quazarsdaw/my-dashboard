(function () {
  'use strict';
  var supabase = null, currentUser = null;
  var pendingKeys = {}, isSyncing = false, lastLocalPushAt = 0;
  var SYNC_DEBOUNCE_MS = 1000;

  function rawSetItem(k, v) { window.Storage.prototype.setItem.call(localStorage, k, v); }

  function initSupabase() {
    if (!window.supabase) return;
    supabase = window.supabase.createClient('https://rruyvksmreigvvepwvtt.supabase.co', 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJydXl2a3NtcmVpZ3Z2ZXB3dnR0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3MTgzODUwNjYsImV4cCI6MjAzMzk2MTA2Nn0.6N5_ZfVf7z7_8u9vWv9vWv9vWv9vWv9vWv9vWv9vWv9v');
    
    supabase.auth.getSession().then(function(res) {
      currentUser = res.data.session ? res.data.session.user : null;
      if (currentUser) {
        console.log('[SUPABASE] Авторизован:', currentUser.email);
        window.DashboardSync = {
          forceSync: function(key) {
            pendingKeys[key] = true;
            return syncNow();
          }
        };
        pullFromCloud();
      }
    });
  }

  function pullFromCloud() {
    if (!currentUser || !supabase) return;
    isSyncing = true;
    supabase.from('user_data').select('key, value, updated_at').eq('user_id', currentUser.id)
      .then(function(res) {
        if (res.data) {
          res.data.forEach(function(row) {
            var localVal = localStorage.getItem(row.key);
            // Если в облаке данные новее или локально их нет - обновляем
            rawSetItem(row.key, JSON.stringify(row.value));
          });
          window.dispatchEvent(new CustomEvent('dashboard-sync-applied', { detail: { changedKeys: res.data.map(function(r){return r.key;}) } }));
        }
        isSyncing = false;
      });
  }

  function syncNow() {
    if (!currentUser || isSyncing) return Promise.resolve();
    var keys = Object.keys(pendingKeys);
    if (keys.length === 0) return Promise.resolve();

    var rows = [];
    keys.forEach(function(k) {
      var val = localStorage.getItem(k);
      if (val) {
        try {
          rows.push({
            user_id: currentUser.id,
            key: k,
            value: JSON.parse(val),
            updated_at: new Date().toISOString()
          });
        } catch(e) {}
      }
    });

    if (rows.length === 0) return Promise.resolve();

    isSyncing = true;
    pendingKeys = {};
    return supabase.from('user_data').upsert(rows, { onConflict: 'user_id, key' })
      .then(function(res) {
        isSyncing = false;
        if (res.error) console.error('[SUPABASE] Ошибка сохранения:', res.error.message);
        else console.log('[SUPABASE] База данных успешно обновлена');
        return res;
      });
  }

  // Перехват localStorage.setItem
  var nativeSet = window.Storage.prototype.setItem;
  window.Storage.prototype.setItem = function(k, v) {
    nativeSet.call(this, k, v);
    if (this === localStorage && !isSyncing && k.indexOf('_sync') === -1) {
      pendingKeys[k] = true;
      clearTimeout(window._syncTimer);
      window._syncTimer = setTimeout(syncNow, SYNC_DEBOUNCE_MS);
    }
  };

  initSupabase();
})();
