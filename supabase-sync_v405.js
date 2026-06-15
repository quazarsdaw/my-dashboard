(function () {
  'use strict';
  var supabase = null, currentUser = null;
  var pendingKeys = {}, isSyncing = false;

  function rawSetItem(k, v) { window.Storage.prototype.setItem.call(localStorage, k, v); }

  function initSupabase() {
    if (!window.supabase) return;
    supabase = window.supabase.createClient('https://rruyvksmreigvvepwvtt.supabase.co', 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJydXl2a3NtcmVpZ3Z2ZXB3dnR0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3MTgzODUwNjYsImV4cCI6MjAzMzk2MTA2Nn0.6N5_ZfVf7z7_8u9vWv9vWv9vWv9vWv9vWv9vWv9vWv9vWv9v');
    
    supabase.auth.getSession().then(function(res) {
      currentUser = res.data.session ? res.data.session.user : null;
      if (currentUser) {
        console.log('[SUPABASE] Авторизован:', currentUser.email);
        window.DashboardSync = {
          client: supabase,
          user: currentUser,
          forceSync: function(key) {
            pendingKeys[key] = true;
            return syncNow();
          }
        };
        // pullFromCloud(); // ОТКЛЮЧЕНО: Чтобы не воскрешать удаленные задачи
      }
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
        if (res.error) console.error('[SUPABASE] Ошибка:', res.error.message);
        return res;
      });
  }

  var nativeSet = window.Storage.prototype.setItem;
  window.Storage.prototype.setItem = function(k, v) {
    nativeSet.call(this, k, v);
    if (this === localStorage && !isSyncing && k.indexOf('_sync') === -1) {
      pendingKeys[k] = true;
      clearTimeout(window._syncTimer);
      window._syncTimer = setTimeout(syncNow, 1000);
    }
  };

  initSupabase();
})();
