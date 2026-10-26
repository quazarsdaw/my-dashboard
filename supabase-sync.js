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
    var timeout = setTimeout(function() {
      if (!sdkReady) {
        console.warn('Supabase SDK load timeout');
        updateAuthUI();
      }
    }, 5000);

    var s = document.createElement('script');
    s.src = sdkURL;
    s.async = true;
    s.onload = function () {
      clearTimeout(timeout);
      if (window.supabase) {
        onSDKReady();
      } else {
        console.error('Supabase SDK failed to initialize from window');
        updateAuthUI();
      }
    };
    s.onerror = function () {
      clearTimeout(timeout);
      console.error('Supabase SDK load failed');
      updateAuthUI();
    };
    document.head.appendChild(s);
  }

  /* ── State ── */
  var SYNC_VERSION = '26-sb';
  var currentUser = null;
  var syncEnabled = false;
  var isSyncing = false; // true while applying cloud data to localStorage
  var pullGeneration = 0;
  var hasPendingLocalChanges = false;
  var lastLocalPushAt = 0; // timestamp of last push to cloud
  var pendingKeys = {}; // Queue of keys that need to be pushed: { key: true }
  var subscription = null;
  var syncPollTimer = null;
  var pageSyncListenersInstalled = false;
  var authGeneration = 0;
  var casMode = 0, casOwner = null, casStates = {}, casHydrated = false;
  var casCapabilities = null, casPreviousOwner = null, casQueues = {};
  var CAS_PREFIX = '_sync_cas_v2:';
  var CAS_DISPLAY_OWNER = '_sync_cas_display_owner_v2';

  var SYNC_META_KEY = '_sync_meta_v1';
  var DELETE_META_KEY = '_sync_deleted_v1';
  var SYNC_INIT_KEY = '_sync_init_v1';
  var SYNC_USER_KEY = '_sync_user_v1';
  var SCHOOL_CABINET_REMOTE_KEY = 'school_cabinet_urls_v1';
  var SCHOOL_CABINET_CACHE_PREFIX = 'school_cabinet_urls_cache_v1:';
  var SKIP_KEYS = [
    SYNC_META_KEY,
    DELETE_META_KEY,
    SYNC_INIT_KEY,
    SYNC_USER_KEY,
    '_sync_reload_at',
    '_sync_debug_v1',
    'supabase.auth.token',
    '_rollover_done_v1',
    'openrouter_settings_v1'
  ];
  var SYNC_POLL_MS = 45000;

  function shouldSkipStorageKey(key) {
    if (!key) return true;
    if (SKIP_KEYS.indexOf(key) !== -1) return true;
    if (key === SCHOOL_CABINET_REMOTE_KEY) return true;
    if (key.indexOf(SCHOOL_CABINET_CACHE_PREFIX) === 0) return true;
    if (key.indexOf('sb-') === 0) return true; // Supabase internal keys
    if (key.indexOf('firebase:') === 0) return true;
    if (key.indexOf('openrouter_') === 0) return true;
    if (key.indexOf('_eye_break_') === 0 || key.indexOf('_habit_reward_') === 0) return true;
    if (key.indexOf('_sync_cas_') === 0) return true;
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
    try {
      if (SUPABASE_URL.indexOf('YOUR_PROJECT_ID') !== -1) {
        console.warn('Supabase: Ключи не настроены. Синхронизация отключена.');
        updateAuthUI();
        return;
      }
      sdkReady = true;
      supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

      // Initial auth check
      supabase.auth.getSession().then(function (res) {
        handleAuthStateChange(res.data.session ? res.data.session.user : null);
      }).catch(function(e) { console.error('Supabase Auth error:', e); });

      // Auth listener
      supabase.auth.onAuthStateChange(function (event, session) {
        handleAuthStateChange(session ? session.user : null);
      });

      installStorageHook();
      installChangeListeners();
    } catch (e) {
      console.error('Supabase Init failed:', e);
    }
    updateAuthUI();
  }

  function handleAuthStateChange(user) {
    var userChanged = (!currentUser && user) || (currentUser && !user) || (currentUser && user && currentUser.id !== user.id);
    if (userChanged) pullGeneration += 1;
    var previousSyncUser = readSyncUserId();
    if (userChanged) {
      if (casMode === 2 && casOwner) {
        Object.keys(casStates).forEach(function(key) { casStates[key] = window.DashboardSyncCore.reduce(casStates[key], { type: 'account_changed' }).state; });
        persistCas();
      }
      authGeneration += 1;
      casPreviousOwner = localStorage.getItem(CAS_DISPLAY_OWNER) || previousSyncUser;
      casMode = 0; casOwner = null; casStates = {}; casCapabilities = null; casHydrated = false;
    }

    if (currentUser && user && currentUser.id !== user.id) {
      resetSyncState();
      pendingKeys = {};
    }
    if (!user && currentUser) {
      resetSyncState();
      pendingKeys = {};
    } else if (user && previousSyncUser && previousSyncUser !== user.id) {
      resetSyncState();
      pendingKeys = {};
    }

    currentUser = user;
    syncEnabled = !!user;

    if (userChanged) {
      if (user) {
        startRealtimeSync();
        writeSyncUserId(currentUser.id);
      } else {
        stopRealtimeSync();
        writeSyncUserId(null);
      }
    }
    updateAuthUI();
    if (userChanged) window.dispatchEvent(new CustomEvent('dashboard-auth-changed'));
  }

  function startSignIn() {
    if (!supabase) return;
    
    var method = confirm('Войти через Google?\n\n(Нажми "Отмена", чтобы войти по почте)') 
      ? 'google' 
      : 'email';

    if (method === 'google') {
      supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: window.location.origin + window.location.pathname
        }
      });
    } else {
      var email = prompt('Введи твой email для входа:');
      if (email) {
        supabase.auth.signInWithOtp({
          email: email,
          options: {
            emailRedirectTo: window.location.origin + window.location.pathname
          }
        }).then(function(res) {
          if (res.error) alert('Ошибка: ' + res.error.message);
          else alert('Ссылка для входа отправлена на почту!');
        });
      }
    }
  }

  function signOut() {
    if (!supabase) return;
    supabase.auth.signOut().then(function() {
        // Clear sync metadata on logout to start fresh next time
        resetSyncState();
        localStorage.removeItem(SYNC_INIT_KEY);
        window.location.reload();
    });
  }

  /* ── Storage Hooks ── */
  var rawSetItem = null;
  var rawRemoveItem = null;

  function installStorageHook() {
    rawSetItem = function (key, value) {
      localStorage.setItem(key, value);
    };
    rawRemoveItem = function (key) {
      localStorage.removeItem(key);
    };

    try {
      if (window.Storage && window.Storage.prototype && window.Storage.prototype.setItem) {
        var nativeSetItem = window.Storage.prototype.setItem;
        var nativeRemoveItem = window.Storage.prototype.removeItem;
        rawSetItem = function (key, value) { nativeSetItem.call(localStorage, key, value); };
        rawRemoveItem = function (key) { nativeRemoveItem.call(localStorage, key); };

        window.Storage.prototype.setItem = function (key, value) {
          nativeSetItem.call(this, key, value);
          // Only sync if it's localStorage and not an internal/Supabase key
          if (this === localStorage && !shouldSkipStorageKey(key)) {
            touchLocalKey(key); // Always touch meta on local write
            if (!isSyncing) {
              schedulePush(key);
            }
          }
        };
        window.Storage.prototype.removeItem = function (key) {
          nativeRemoveItem.call(this, key);
          if (this === localStorage && !isSyncing && !shouldSkipStorageKey(key)) {
            touchLocalKey(key);
            schedulePush(key);
          }
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

    if (!pageSyncListenersInstalled) {
      pageSyncListenersInstalled = true;
      window.addEventListener('focus', function () {
        if (currentUser) {
          pullFromCloud().catch(function () {});
        }
      });
      window.addEventListener('online', function () {
        if (currentUser) {
          pullFromCloud().catch(function () {});
        }
      });
      document.addEventListener('visibilitychange', function () {
        if (!document.hidden && currentUser) {
        pullFromCloud().catch(function () {});
        }
      });
    }
  }

  /* ── Sync Logic ── */
  var syncDebounceTimer = null;
  var SYNC_DEBOUNCE_MS = 1000; // Increased to prevent spam

  function schedulePush(key) {
    if (isSyncing || !syncEnabled || !currentUser) return;
    if (key && shouldSkipStorageKey(key)) return;
    
    if (key) {
      pendingKeys[key] = true;
      noteCasLocal(key);
    } else {
      // If no key provided, mark all for sync (full sync)
      getAllSyncKeys().forEach(function(k) { pendingKeys[k] = true; noteCasLocal(k); });
    }

    clearTimeout(syncDebounceTimer);
    syncDebounceTimer = setTimeout(syncPendingChanges, SYNC_DEBOUNCE_MS);
  }

  function readLocalMeta() {
    try { return JSON.parse(localStorage.getItem(SYNC_META_KEY)) || {}; } catch (e) { return {}; }
  }

  function writeLocalMeta(meta) {
    rawSetItem(SYNC_META_KEY, JSON.stringify(meta));
  }

  function readSyncUserId() {
    return localStorage.getItem(SYNC_USER_KEY);
  }

  function writeSyncUserId(userId) {
    if (userId) {
      if (rawSetItem) rawSetItem(SYNC_USER_KEY, String(userId));
      else localStorage.setItem(SYNC_USER_KEY, String(userId));
    } else {
      if (rawRemoveItem) rawRemoveItem(SYNC_USER_KEY);
      else localStorage.removeItem(SYNC_USER_KEY);
    }
  }

  function resetSyncState() {
    try {
      rawSetItem(SYNC_META_KEY, '{}');
      rawSetItem(DELETE_META_KEY, '{}');
      rawRemoveItem(SYNC_INIT_KEY);
      rawRemoveItem(SYNC_USER_KEY);
    } catch (e) {
      console.warn('Sync state reset failed:', e);
      try { localStorage.removeItem(SYNC_META_KEY); } catch (_e) {}
      try { localStorage.removeItem(DELETE_META_KEY); } catch (_e) {}
      try { localStorage.removeItem(SYNC_INIT_KEY); } catch (_e) {}
      try { localStorage.removeItem(SYNC_USER_KEY); } catch (_e) {}
    }
  }

  function touchLocalKey(key) {
    var meta = readLocalMeta();
    meta[key] = Date.now();
    writeLocalMeta(meta);
  }

  function protectedKey(key) {
    return key === 'horizons_goals_v2' || /^goals:\d{4}-\d{2}-\d{2}$/.test(key);
  }

  function missingSnapshot(key) {
    return { key: key, exists: false, valueText: null, revision: '0', updatedAt: null };
  }

  function persistCas() {
    if (casMode !== 2 || !casOwner) return;
    rawSetItem(CAS_PREFIX + casOwner, JSON.stringify({ version: 2, owner: casOwner, documents: casStates }));
  }

  function getCasState(key) {
    if (!casStates[key]) {
      casStates[key] = window.DashboardSyncCore.create(casOwner, key);
      if (casHydrated) casStates[key].base = missingSnapshot(key);
    }
    return casStates[key];
  }

  function applyCasEvent(key, event) {
    var outcome = window.DashboardSyncCore.reduce(getCasState(key), event);
    casStates[key] = outcome.state;
    var changed = false;
    outcome.effects.forEach(function(effect) {
      if (effect.type !== 'apply' || localStorage.getItem(key) === effect.valueText) return;
      if (effect.valueText === null) rawRemoveItem(key); else rawSetItem(key, effect.valueText);
      changed = true;
    });
    return { state: outcome.state, effects: outcome.effects, changed: changed };
  }

  function noteCasLocal(key) {
    if (casMode !== 2 || casOwner !== (currentUser && currentUser.id) || !protectedKey(key)) return;
    applyCasEvent(key, { type: 'local_edit', valueText: localStorage.getItem(key) });
    persistCas();
  }

  function initializeCas(owner) {
    if (!window.DashboardSyncCore) throw new Error('SYNC_CORE_MISSING');
    var saved = localStorage.getItem(CAS_PREFIX + owner);
    var stored = saved ? JSON.parse(saved) : { version: 2, owner: owner, documents: {} };
    if (!stored || stored.version !== 2 || stored.owner !== owner || !stored.documents || typeof stored.documents !== 'object' || Array.isArray(stored.documents)) throw new Error('INVALID_SYNC_CACHE');
    Object.keys(stored.documents).forEach(function(key) {
      var state = stored.documents[key];
      if (!protectedKey(key) || !state || state.owner !== owner || state.key !== key ||
          !Number.isSafeInteger(state.localEpoch) || state.localEpoch < 0 ||
          (state.base !== null && !window.DashboardSyncCore.validSnapshot(state.base, key)) ||
          (state.dirty !== null && (!state.dirty || !Number.isSafeInteger(state.dirty.epoch) || state.dirty.epoch !== state.localEpoch || (state.dirty.valueText !== null && typeof state.dirty.valueText !== 'string'))) ||
          (state.conflict !== null && (!state.conflict || !window.DashboardSyncCore.validSnapshot(state.conflict.remote, key)))) throw new Error('INVALID_SYNC_CACHE');
      state.inFlight = null;
    });
    casOwner = owner; casStates = stored.documents; casMode = 2;
    var changedKeys = [], differentOwner = casPreviousOwner && casPreviousOwner !== owner;
    if (differentOwner) {
      getAllSyncKeys().filter(protectedKey).forEach(function(key) { rawRemoveItem(key); changedKeys.push(key); });
      Object.keys(casStates).forEach(function(key) {
        var state = casStates[key], value = state.dirty ? state.dirty.valueText : state.base && state.base.valueText;
        if (value !== null && value !== undefined) rawSetItem(key, value);
        changedKeys.push(key);
      });
    } else {
      getAllSyncKeys().filter(protectedKey).forEach(function(key) {
        applyCasEvent(key, { type: 'local_edit', valueText: localStorage.getItem(key) });
      });
    }
    Object.keys(casStates).forEach(function(key) { if (casStates[key].dirty) pendingKeys[key] = true; });
    rawSetItem(CAS_DISPLAY_OWNER, owner);
    persistCas();
    if (changedKeys.length) notifySyncedDataApplied(changedKeys);
  }

  function ensureSyncProtocol() {
    if (!currentUser || !supabase) return Promise.reject(new Error('NO_SESSION'));
    if (casMode && casOwner === currentUser.id) return Promise.resolve(casMode);
    if (casCapabilities) return casCapabilities;
    var owner = currentUser.id, generation = authGeneration;
    casCapabilities = Promise.resolve().then(function() {
      return supabase.rpc('dashboard_sync_capabilities', { p_expected_owner: owner });
    }).then(function(result) {
      if (!currentUser || currentUser.id !== owner || authGeneration !== generation) throw new Error('OWNER_CHANGED');
      if (result.error) {
        if (result.error.code === 'PGRST202' && !result.error.hint && String(result.error.message).indexOf('public.dashboard_sync_capabilities') !== -1) {
          casMode = 1; casOwner = owner; return 1;
        }
        throw new Error('CAPABILITIES_UNAVAILABLE');
      }
      if (!result.data || result.data.protocol !== 2 || typeof result.data.guardEnabled !== 'boolean' || typeof result.data.writeEnabled !== 'boolean') throw new Error('INVALID_CAPABILITIES');
      initializeCas(owner);
      return 2;
    }).catch(function(error) {
      if (authGeneration === generation) casCapabilities = null;
      throw error;
    });
    return casCapabilities;
  }

  function documentToken(key) {
    if (!currentUser) return { owner: null, key: key, baseRevision: null, localEpoch: 0 };
    if (casMode !== 2 || !protectedKey(key)) return { owner: currentUser.id, key: key, baseRevision: null, localEpoch: readLocalMeta()[key] || 0 };
    var state = getCasState(key);
    return { owner: currentUser.id, key: key, baseRevision: state.base && state.base.revision, localEpoch: state.localEpoch, remoteRevision: state.conflict && state.conflict.remote.revision };
  }

  // Expose for manual sync
  window.DashboardSync = {
    forceSync: function(key) {
      if (!currentUser || !supabase) return Promise.resolve();
      if (key && shouldSkipStorageKey(key)) return Promise.resolve();
      if (key) {
        touchLocalKey(key);
        pendingKeys[key] = true;
        noteCasLocal(key);
      } else {
        getAllSyncKeys().forEach(function(k) {
          touchLocalKey(k);
          pendingKeys[k] = true;
          noteCasLocal(k);
        });
      }
      return syncPendingChanges();
    },
    getDocumentToken: documentToken,
    canApplyDocumentToken: function(token) { return !!token && JSON.stringify(token) === JSON.stringify(documentToken(token.key)); }
  };

  function syncOutcome(code, status) {
    return { ok: false, error: { code: code, status: status || 409 } };
  }

  function blockCasGroup(keys, current) {
    keys.forEach(function(key) {
      var state = getCasState(key);
      var remote = (current || []).find(function(row) { return row.key === key; }) ||
        (state.conflict && state.conflict.remote) || state.base || missingSnapshot(key);
      if (!window.DashboardSyncCore.validSnapshot(remote, key)) throw new Error('INVALID_SNAPSHOT');
      casStates[key] = Object.assign({}, state, { inFlight: null, conflict: { base: state.base, remote: remote }, conflictKeys: keys.slice() });
      delete pendingKeys[key];
    });
    persistCas();
    window.dispatchEvent(new CustomEvent('dashboard-sync-conflict', { detail: { keys: keys } }));
    return syncOutcome('conflict');
  }

  async function pushCasChanges(owner, generation) {
    if (!currentUser || currentUser.id !== owner || generation !== authGeneration) return syncOutcome('owner_changed', 403);
    var keys = Object.keys(pendingKeys).filter(protectedKey), active = [];
    keys.forEach(function(key) { noteCasLocal(key); });
    var fresh = keys.filter(function(key) { return !getCasState(key).conflictKeys; });
    var blocked = keys.some(function(key) { return !!getCasState(key).conflict; });
    var newConflict = fresh.some(function(key) { return !!getCasState(key).conflict; });
    if (newConflict) {
      blockCasGroup(fresh);
      fresh = [];
    }
    var needsBase = fresh.some(function(key) { return getCasState(key).dirty && !getCasState(key).base; });
    if (needsBase) {
      await pullFromCloud();
      if (!currentUser || currentUser.id !== owner || generation !== authGeneration) return syncOutcome('owner_changed', 403);
      return pushCasChanges(owner, generation);
    }
    fresh.forEach(function(key) {
      var step = applyCasEvent(key, { type: 'push_started' });
      step.effects.forEach(function(effect) { if (effect.type === 'save') active.push(effect); });
      if (!step.state.dirty) delete pendingKeys[key];
    });
    var bytes = active.reduce(function(total, effect) { return total + new TextEncoder().encode(effect.change.valueText || '').length; }, 0);
    if (active.length > 64 || bytes > 4194304) {
      active.forEach(function(effect) { applyCasEvent(effect.change.key, { type: 'push_failed' }); });
      persistCas();
      return syncOutcome('request_too_large', 413);
    }
    if (active.length) {
      active.forEach(function(effect) { delete pendingKeys[effect.change.key]; });
      persistCas();
      var result;
      try {
        result = await supabase.rpc('dashboard_save_documents', { p_expected_owner: owner, p_changes: active.map(function(effect) { return effect.change; }) });
        if (!currentUser || currentUser.id !== owner || generation !== authGeneration) return syncOutcome('owner_changed', 403);
        if (result.error || !result.data || typeof result.data.ok !== 'boolean') throw new Error('SAVE_UNAVAILABLE');
        if (!result.data.ok) {
          if (result.data.error && result.data.error.code === 'conflict') {
            var current = result.data.current;
            var identical = Array.isArray(current) && current.length === active.length && active.every(function(effect) {
              var matches = current.filter(function(row) { return row.key === effect.change.key; });
              return matches.length === 1 && window.DashboardSyncCore.validSnapshot(matches[0], effect.change.key) && matches[0].valueText === effect.change.valueText &&
                window.DashboardSyncCore.compareRevision(matches[0].revision, effect.change.expectedRevision) > 0;
            });
            if (!identical) return blockCasGroup(active.map(function(effect) { return effect.change.key; }), current);
            result = { data: { ok: true, data: current }, error: null };
          } else throw new Error('SAVE_REJECTED');
        }
        if (!Array.isArray(result.data.data) || result.data.data.length !== active.length) throw new Error('INVALID_SAVE_RECEIPT');
        var receiptRows = result.data.data;
        active.forEach(function(effect) {
          var matching = receiptRows.filter(function(row) { return row.key === effect.change.key; });
          if (matching.length !== 1 || !window.DashboardSyncCore.validSnapshot(matching[0], effect.change.key) || matching[0].valueText !== effect.change.valueText ||
              window.DashboardSyncCore.compareRevision(matching[0].revision, effect.change.expectedRevision) <= 0) throw new Error('INVALID_SAVE_RECEIPT');
        });
        active.forEach(function(effect) {
          var row = receiptRows.find(function(item) { return item.key === effect.change.key; });
          var state = applyCasEvent(effect.change.key, { type: 'push_ok', snapshot: row, epoch: effect.epoch }).state;
          if (state.dirty && !state.conflict) pendingKeys[effect.change.key] = true;
        });
        persistCas();
      } catch (error) {
        if (currentUser && currentUser.id === owner && generation === authGeneration) {
          active.forEach(function(effect) { applyCasEvent(effect.change.key, { type: 'push_failed' }); pendingKeys[effect.change.key] = true; });
          persistCas();
        }
        return syncOutcome('save_unavailable', 502);
      }
    }
    if (!currentUser || currentUser.id !== owner || generation !== authGeneration) return syncOutcome('owner_changed', 403);
    await syncLegacyPendingChanges();
    return blocked || newConflict ? syncOutcome('conflict') : { ok: true };
  }

  function syncPendingChanges() {
    if (!currentUser || !supabase) return Promise.resolve(syncOutcome('no_session', 401));
    var owner = currentUser.id, generation = authGeneration;
    return ensureSyncProtocol().then(function(mode) {
      if (!currentUser || currentUser.id !== owner || generation !== authGeneration) return syncOutcome('owner_changed', 403);
      if (mode === 1) return syncLegacyPendingChanges();
      var queue = (casQueues[owner] || Promise.resolve()).catch(function() {}).then(function() { return pushCasChanges(owner, generation); });
      casQueues[owner] = queue;
      return queue;
    }).catch(function() { showSyncIndicator('error'); return syncOutcome('sync_unavailable', 502); });
  }

  function syncLegacyPendingChanges() {
    if (!currentUser || !supabase) return Promise.resolve();
    var owner = currentUser.id, generation = authGeneration;

    var keysToPush = Object.keys(pendingKeys).filter(function(key) { return casMode !== 2 || !protectedKey(key); });
    if (keysToPush.length === 0) return Promise.resolve();

    var rows = [];
    var deletedKeys = [];
    keysToPush.forEach(function(k) {
      var val = localStorage.getItem(k);
      if (val === null) {
        deletedKeys.push(k);
        return;
      }
      var jsonVal = null;
      try { jsonVal = JSON.parse(val); } catch(e) { jsonVal = val; }

      rows.push({
        user_id: currentUser.id,
        key: k,
        value: jsonVal,
        updated_at: new Date().toISOString()
      });
    });

    var processingKeys = {};
    keysToPush.forEach(function(key) { processingKeys[key] = true; delete pendingKeys[key]; });

    lastLocalPushAt = Date.now();
    showSyncIndicator('syncing');

    var operations = [];
    if (rows.length > 0) {
      operations.push(supabase.from('user_data').upsert(rows, { onConflict: 'user_id, key' }));
    }
    deletedKeys.forEach(function(k) {
      operations.push(supabase.from('user_data').delete().eq('user_id', currentUser.id).eq('key', k));
    });

    return Promise.all(operations)
      .then(function(results) {
        if (!currentUser || currentUser.id !== owner || generation !== authGeneration) return syncOutcome('owner_changed', 403);
        for (var i = 0; i < results.length; i++) {
          if (results[i] && results[i].error) {
            console.error('[Supabase Sync] Ошибка сохранения:', results[i].error.message);
            console.error('Детали:', results[i].error.details, results[i].error.hint);
            Object.assign(pendingKeys, processingKeys);
            showSyncIndicator('error');
            throw results[i].error;
          }
        }
        console.log('[Supabase Sync] Данные успешно отправлены в облако для ключей:', keysToPush);
        lastLocalPushAt = Date.now();
        showSyncIndicator('pushed');
        return results;
      })
      .catch(function(err) {
        if (!currentUser || currentUser.id !== owner || generation !== authGeneration) return syncOutcome('owner_changed', 403);
        console.error('[Supabase Sync] Critical error:', err);
        Object.assign(pendingKeys, processingKeys);
        showSyncIndicator('error');
        throw err;
      });
  }

  function pushAllToCloud() {
    getAllSyncKeys().forEach(function(key) { pendingKeys[key] = true; noteCasLocal(key); });
    return syncPendingChanges();
  }

  function markMissingLocalKeysAfterSync(remoteRows) {
    if (localStorage.getItem(SYNC_INIT_KEY)) return;
    var remoteSet = {};
    var hasLocalOnly = false;
    for (var i = 0; i < remoteRows.length; i++) {
      remoteSet[remoteRows[i].key] = true;
    }
    getAllSyncKeys().forEach(function (k) {
      if (casMode === 2 && protectedKey(k)) return;
      if (remoteSet[k]) return;
      pendingKeys[k] = true;
      touchLocalKey(k);
      hasLocalOnly = true;
    });
    rawSetItem(SYNC_INIT_KEY, '1');
    if (hasLocalOnly) {
      setTimeout(syncPendingChanges, 0);
    }
  }

  function startSyncPolling() {
    if (syncPollTimer) return;
    function poll() {
      if (!currentUser || !supabase) {
        syncPollTimer = null;
        return;
      }
      pullFromCloud().catch(function () {}).finally(function () {
        if (currentUser && supabase) {
          syncPollTimer = setTimeout(poll, SYNC_POLL_MS);
        } else {
          syncPollTimer = null;
        }
      });
    }
    syncPollTimer = setTimeout(poll, SYNC_POLL_MS);
  }

  function stopSyncPolling() {
    if (syncPollTimer) {
      clearTimeout(syncPollTimer);
      syncPollTimer = null;
    }
  }

  function startRealtimeSync() {
    if (!currentUser || !supabase) return;

    // 1. Initial Pull
    pullFromCloud().catch(function () {});
    startSyncPolling();

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
        var eventKey = payload.new && payload.new.key || payload.old && payload.old.key;
        if (protectedKey(eventKey) && casMode !== 1) { pullFromCloud().catch(function() {}); return; }
        // IGNORE changes if we just pushed something ourselves (< 3 seconds ago)
        // This prevents the "flicker" effect.
        if (Date.now() - lastLocalPushAt < 3000) {
          return;
        }
        if (!isSyncing) handleCloudChange(payload);
      })
      .subscribe();
  }

  function stopRealtimeSync() {
    if (subscription) {
      supabase.removeChannel(subscription);
      subscription = null;
    }
    stopSyncPolling();
  }

  async function fetchAllUserData(client, userId, mode) {
    var rows = [], cursor = null, seen = new Set();
    while (true) {
      var response;
      if (mode === 2) response = await client.rpc('dashboard_read_user_data', { p_after_key: cursor, p_limit: 500, p_expected_owner: userId });
      else {
        var query = client.from('user_data').select('key, value, updated_at').eq('user_id', userId).order('key', { ascending: true }).limit(500);
        if (cursor !== null) query = query.gt('key', cursor);
        response = await query;
      }
      if (response.error) throw new Error('CLOUD_PAGE_FAILED');
      if (!Array.isArray(response.data)) throw new Error('INVALID_CLOUD_PAGE');
      if (!response.data.length) return rows;
      for (var i = 0; i < response.data.length; i++) {
        var row = response.data[i];
        if (!row || typeof row.key !== 'string' || seen.has(row.key)) throw new Error('INVALID_CLOUD_CURSOR');
        if (mode === 2) {
          if (!window.DashboardSyncCore.validSnapshot(row, row.key)) throw new Error('INVALID_CLOUD_SNAPSHOT');
          row = Object.assign({}, row, { value: row.valueText, updated_at: row.updatedAt });
        }
        seen.add(row.key); rows.push(row);
      }
      var nextCursor = response.data[response.data.length - 1].key;
      if (nextCursor === cursor) throw new Error('INVALID_CLOUD_CURSOR');
      cursor = nextCursor;
    }
  }

  function pullFromCloud() {
    if (!currentUser || !supabase) return Promise.resolve();
    var userId = currentUser.id, generation = ++pullGeneration;
    return ensureSyncProtocol().then(function(mode) { return fetchAllUserData(supabase, userId, mode); })
      .then(function(rows) {
        if (!currentUser || currentUser.id !== userId || generation !== pullGeneration) return;
        isSyncing = true;
        try {
          var changedKeys = [];
          var localMeta = readLocalMeta();
          var hasMetaUpdates = false;
          var protectedSeen = {};
          rows.forEach(function(row) {
            if (shouldSkipStorageKey(row.key)) return;
            if (casMode === 2 && protectedKey(row.key)) {
              protectedSeen[row.key] = true;
              var known = casStates[row.key];
              if ((known && (known.base || known.dirty)) || localStorage.getItem(row.key) !== null) noteCasLocal(row.key);
              if (applyCasEvent(row.key, { type: 'remote', snapshot: row }).changed) changedKeys.push(row.key);
              return;
            }
            var cloudTime = new Date(row.updated_at).getTime();
            var localTime = localMeta[row.key] || 0;
            
            // Sync ONLY if cloud data is newer than local change
            if (cloudTime > localTime) {
              if (row.value === null) {
                if (localStorage.getItem(row.key) !== null) {
                  rawRemoveItem(row.key);
                  changedKeys.push(row.key);
                }
                localMeta[row.key] = cloudTime;
                hasMetaUpdates = true;
              } else {
                var stringVal = typeof row.value === 'string' ? row.value : JSON.stringify(row.value);
                if (localStorage.getItem(row.key) !== stringVal) {
                  rawSetItem(row.key, stringVal);
                  changedKeys.push(row.key);
                }
                localMeta[row.key] = cloudTime;
                hasMetaUpdates = true;
              }
            }
          });
          if (casMode === 2) {
            Object.keys(casStates).forEach(function(key) {
              if (!protectedSeen[key]) {
                var known = casStates[key];
                if (known.base || known.dirty || localStorage.getItem(key) !== null) noteCasLocal(key);
                if (applyCasEvent(key, { type: 'remote', snapshot: missingSnapshot(key) }).changed) changedKeys.push(key);
              }
            });
            casHydrated = true;
            persistCas();
            var conflicts = Object.keys(casStates).filter(function(key) { return !!casStates[key].conflict; });
            if (conflicts.length) window.dispatchEvent(new CustomEvent('dashboard-sync-conflict', { detail: { keys: conflicts } }));
          }
          markMissingLocalKeysAfterSync(rows);
          if (changedKeys.length > 0 || hasMetaUpdates) {
            writeLocalMeta(localMeta);
            notifySyncedDataApplied(changedKeys);
          }
        } finally { isSyncing = false; }
        showSyncIndicator('synced');
      })
      .catch(function(err) {
        if (!currentUser || currentUser.id !== userId || generation !== pullGeneration) return;
        console.error('Не удалось загрузить полный снимок данных.');
        isSyncing = false;
        showSyncIndicator('error');
        return Promise.reject(err);
      });
  }

  function handleCloudChange(payload) {
    if (payload.eventType === 'DELETE') {
      var oldRow = payload.old || {};
      if (!oldRow.key || shouldSkipStorageKey(oldRow.key)) return;
      var deleteMeta = readLocalMeta();
      var deletedAt = oldRow.updated_at ? new Date(oldRow.updated_at).getTime() : Date.now();
      var localDeletedTime = deleteMeta[oldRow.key] || 0;
      if (deletedAt >= localDeletedTime) {
        isSyncing = true;
        if (localStorage.getItem(oldRow.key) !== null) {
          rawRemoveItem(oldRow.key);
          notifySyncedDataApplied([oldRow.key]);
        }
        deleteMeta[oldRow.key] = deletedAt;
        writeLocalMeta(deleteMeta);
        isSyncing = false;
        showSyncIndicator('synced');
      }
      return;
    }

    if (payload.eventType === 'INSERT' || payload.eventType === 'UPDATE') {
      var row = payload.new;
      if (!row || shouldSkipStorageKey(row.key)) return;
      var localMeta = readLocalMeta();
      var cloudTime = new Date(row.updated_at).getTime();
      var localTime = localMeta[row.key] || 0;

      if (cloudTime > localTime) {
        if (row.value === null) {
          isSyncing = true;
          if (localStorage.getItem(row.key) !== null) {
            rawRemoveItem(row.key);
            notifySyncedDataApplied([row.key]);
          }
          localMeta[row.key] = cloudTime;
          writeLocalMeta(localMeta);
          isSyncing = false;
          showSyncIndicator('synced');
          return;
        }

        var stringVal = typeof row.value === 'string' ? row.value : JSON.stringify(row.value);
        if (localStorage.getItem(row.key) !== stringVal) {
          isSyncing = true;
          rawSetItem(row.key, stringVal);
          localMeta[row.key] = cloudTime;
          writeLocalMeta(localMeta);
          notifySyncedDataApplied([row.key]);
          isSyncing = false;
          showSyncIndicator('synced');
        }
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
        startSignIn();
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
    get client() { return supabase; },
    get user() { return currentUser; },
    isSignedIn: function () { return !!currentUser; },
    getUser: function () { return currentUser; },
    pullNow: pullFromCloud,
    pushNow: pushAllToCloud,
    clearCloudData: function() {
      if (!supabase || !currentUser) {
        console.warn('Supabase: Невозможно удалить данные (нет сессии)');
        return Promise.resolve({ error: 'No session' });
      }
      console.log('Supabase: Удаление облачных данных для', currentUser.id);
      return supabase.from('user_data').delete().eq('user_id', currentUser.id);
    }
  };

})();
