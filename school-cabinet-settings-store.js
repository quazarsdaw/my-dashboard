(function (root, factory) {
  'use strict';
  var api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.SchoolCabinetSettingsStore = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (root) {
  'use strict';

  function emptySettings() {
    return { version: 1, cabinets: {} };
  }

  function storeError(code, message) {
    var error = new Error(message);
    error.code = code;
    return error;
  }

  function safeError(code, message) {
    return Object.freeze({ code: code, message: message });
  }

  function clone(value) {
    return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
  }

  function timestamp(value) {
    if (!value) return null;
    var parsed = new Date(value).getTime();
    return Number.isFinite(parsed) ? parsed : null;
  }

  function create(options) {
    options = options || {};
    var settingsCore = options.settingsCore ||
      (root && root.SchoolCabinetSettings);
    if (!settingsCore) {
      throw new TypeError('school cabinet settings core is required');
    }

    var getSync = options.getSync || function () {
      return root && root.SupabaseSync;
    };
    var storage = options.storage || (root && root.localStorage);
    var eventTarget = options.eventTarget || root;
    var CustomEventCtor = options.CustomEvent ||
      (root && root.CustomEvent);
    var wait = options.delay || function (milliseconds) {
      return new Promise(function (resolve) {
        setTimeout(resolve, milliseconds);
      });
    };
    var listeners = [];
    var channel = null;
    var channelClient = null;
    var authSubscription = null;
    var authClient = null;
    var destroyed = false;
    var operationGeneration = 0;
    var liveRevision = 0;
    var lastRealtimeCommitAt = null;
    var state = {
      status: 'idle',
      userId: null,
      settings: emptySettings(),
      updatedAt: null,
      source: 'empty',
      warning: null,
      error: null
    };

    function getState() {
      return clone(state);
    }

    function notify() {
      var snapshot = getState();
      listeners.slice().forEach(function (listener) {
        listener(snapshot);
      });
      if (
        eventTarget &&
        typeof eventTarget.dispatchEvent === 'function' &&
        typeof CustomEventCtor === 'function'
      ) {
        eventTarget.dispatchEvent(new CustomEventCtor(
          'school-cabinet-settings-applied',
          { detail: snapshot }
        ));
      }
    }

    function replaceState(nextState, shouldNotify) {
      state = Object.assign({}, state, nextState);
      if (shouldNotify) notify();
      return getState();
    }

    async function authContext() {
      var startedAt = Date.now();
      while (Date.now() - startedAt <= 5000) {
        var sync = getSync();
        var client = sync && sync.client;
        if (
          client &&
          client.auth &&
          typeof client.auth.getSession === 'function'
        ) {
          var result = await client.auth.getSession();
          if (result && result.error) {
            throw storeError(
              'AUTH_UNAVAILABLE',
              'не удалось проверить аккаунт'
            );
          }
          var session = result && result.data && result.data.session;
          if (session && session.user && session.user.id) {
            return { client: client, user: session.user };
          }
          if (session === null) {
            throw storeError(
              'UNAUTHORIZED',
              'для синхронизации необходимо войти'
            );
          }
        }
        await wait(10);
      }
      throw storeError(
        'AUTH_UNAVAILABLE',
        'не удалось определить аккаунт'
      );
    }

    function resetForAuthChange(shouldNotify) {
      operationGeneration += 1;
      liveRevision += 1;
      lastRealtimeCommitAt = null;
      stopRealtime();
      replaceState({
        status: 'idle',
        userId: null,
        settings: emptySettings(),
        updatedAt: null,
        source: 'auth',
        warning: null,
        error: null
      }, Boolean(shouldNotify));
    }

    async function ensureSameAuth(expectedUserId) {
      var current;
      try {
        current = await authContext();
      } catch (error) {
        resetForAuthChange(true);
        if (error && error.code === 'UNAUTHORIZED') {
          throw storeError('AUTH_CHANGED', 'аккаунт изменился во время запроса');
        }
        throw error;
      }
      if (!current.user || current.user.id !== expectedUserId) {
        resetForAuthChange(true);
        throw storeError('AUTH_CHANGED', 'аккаунт изменился во время запроса');
      }
      return current;
    }

    function readCache(userId) {
      if (!storage || typeof storage.getItem !== 'function') return null;
      var raw;
      try {
        raw = storage.getItem(settingsCore.cacheKeyForUser(userId));
      } catch (_error) {
        return null;
      }
      if (!raw) return null;

      var parsed = settingsCore.parseStoredValue(raw);
      if (parsed.warning) return null;

      var updatedAt = null;
      try {
        var envelope = JSON.parse(raw);
        updatedAt = envelope && (
          envelope.updatedAt ||
          envelope.updated_at
        ) || null;
      } catch (_error) {
        updatedAt = null;
      }
      return {
        settings: parsed.settings,
        updatedAt: updatedAt
      };
    }

    function writeCache(userId, nextSettings, updatedAt) {
      if (!storage || typeof storage.setItem !== 'function') return;
      var envelope = {
        version: 1,
        cabinets: clone(nextSettings.cabinets || {}),
        updatedAt: updatedAt || null
      };
      try {
        storage.setItem(
          settingsCore.cacheKeyForUser(userId),
          JSON.stringify(envelope)
        );
      } catch (_error) {
        // The cloud row remains authoritative when browser storage is unavailable.
      }
    }

    function removeCache(userId) {
      if (!storage || typeof storage.removeItem !== 'function') return;
      try {
        storage.removeItem(settingsCore.cacheKeyForUser(userId));
      } catch (_error) {
        // Cache cleanup must not change the confirmed cloud state.
      }
    }

    function applyParsed(userId, parsed, updatedAt, source) {
      liveRevision += 1;
      writeCache(userId, parsed.settings, updatedAt);
      return replaceState({
        status: 'ready',
        userId: userId,
        settings: parsed.settings,
        updatedAt: updatedAt || null,
        source: source,
        warning: parsed.warning || null,
        error: null
      }, true);
    }

    function stopRealtime() {
      if (
        channel &&
        channelClient &&
        typeof channelClient.removeChannel === 'function'
      ) {
        channelClient.removeChannel(channel);
      }
      channel = null;
      channelClient = null;
    }

    function stopAuthWatch() {
      if (
        authSubscription &&
        typeof authSubscription.unsubscribe === 'function'
      ) {
        authSubscription.unsubscribe();
      }
      authSubscription = null;
      authClient = null;
    }

    function scheduleAuthLoad() {
      Promise.resolve().then(function () {
        if (destroyed) return;
        load().catch(function () {
          if (!destroyed) notify();
        });
      });
    }

    function startAuthWatch(client) {
      if (
        destroyed ||
        !client ||
        !client.auth ||
        typeof client.auth.onAuthStateChange !== 'function' ||
        authClient === client
      ) {
        return;
      }
      stopAuthWatch();
      authClient = client;
      var result = client.auth.onAuthStateChange(function (_event, session) {
        if (destroyed) return;
        var nextUserId = session && session.user && session.user.id
          ? session.user.id
          : null;
        if (nextUserId && nextUserId === state.userId) return;
        resetForAuthChange(true);
        if (nextUserId) scheduleAuthLoad();
      });
      authSubscription = result &&
        result.data &&
        result.data.subscription
        ? result.data.subscription
        : null;
    }

    function handleRealtime(payload) {
      if (destroyed || !payload || !state.userId) return;
      var isDelete = payload.eventType === 'DELETE';
      var row = isDelete ? payload.old : payload.new;
      if (
        !row ||
        row.user_id !== state.userId ||
        row.key !== settingsCore.REMOTE_KEY
      ) {
        return;
      }

      var commitTimestamp = timestamp(payload.commit_timestamp);
      if (
        commitTimestamp !== null &&
        lastRealtimeCommitAt !== null &&
        commitTimestamp <= lastRealtimeCommitAt
      ) {
        return;
      }
      if (commitTimestamp !== null) {
        lastRealtimeCommitAt = commitTimestamp;
      }
      var updatedAt = row.updated_at || payload.commit_timestamp || null;

      if (isDelete) {
        liveRevision += 1;
        removeCache(state.userId);
        replaceState({
          status: 'ready',
          settings: emptySettings(),
          updatedAt: updatedAt,
          source: 'realtime',
          warning: null,
          error: null
        }, true);
        return;
      }

      var parsed = settingsCore.parseStoredValue(row.value);
      if (parsed.warning) {
        replaceState({
          warning: parsed.warning
        }, true);
        return;
      }
      applyParsed(state.userId, parsed, updatedAt, 'realtime');
    }

    function startRealtime(client, userId) {
      stopRealtime();
      if (
        !client ||
        typeof client.channel !== 'function' ||
        destroyed
      ) {
        return;
      }
      channelClient = client;
      channel = client
        .channel('school-cabinet-settings:' + userId)
        .on('postgres_changes', {
          event: '*',
          schema: 'public',
          table: 'user_data',
          filter: 'user_id=eq.' + userId
        }, handleRealtime)
        .subscribe();
    }

    async function load() {
      destroyed = false;
      var requestGeneration = ++operationGeneration;
      replaceState({ status: 'loading', error: null }, false);

      var auth;
      try {
        auth = await authContext();
      } catch (error) {
        resetForAuthChange(true);
        replaceState({
          status: 'error',
          error: safeError(
            error.code || 'AUTH_UNAVAILABLE',
            error.message || 'не удалось определить аккаунт'
          )
        }, false);
        throw error;
      }

      var userId = auth.user.id;
      if (requestGeneration !== operationGeneration) {
        throw storeError('AUTH_CHANGED', 'аккаунт изменился во время запроса');
      }
      var sameUser = state.userId === userId;
      replaceState({
        status: 'loading',
        userId: userId,
        settings: sameUser ? state.settings : emptySettings(),
        updatedAt: sameUser ? state.updatedAt : null,
        source: sameUser ? state.source : 'empty',
        warning: null,
        error: null
      }, false);
      startAuthWatch(auth.client);

      var cached = sameUser ? null : readCache(userId);
      if (cached) {
        replaceState({
          status: 'loading',
          settings: cached.settings,
          updatedAt: cached.updatedAt,
          source: 'cache'
        }, true);
      }
      var revisionBeforeSelect = liveRevision;

      var result;
      try {
        result = await auth.client
          .from('user_data')
          .select('value, updated_at')
          .eq('user_id', userId)
          .eq('key', settingsCore.REMOTE_KEY)
          .maybeSingle();
      } catch (_error) {
        result = { data: null, error: true };
      }

      await ensureSameAuth(userId);
      if (requestGeneration !== operationGeneration) {
        throw storeError('AUTH_CHANGED', 'аккаунт изменился во время запроса');
      }

      if (!result || result.error) {
        var loadError = storeError(
          'LOAD_FAILED',
          'не удалось загрузить настройки кабинетов'
        );
        replaceState({
          status: 'error',
          error: safeError(loadError.code, loadError.message)
        }, false);
        throw loadError;
      }

      if (liveRevision !== revisionBeforeSelect && state.userId === userId) {
        replaceState({ status: 'ready', error: null }, false);
        startRealtime(auth.client, userId);
        return getState();
      }

      if (!result.data) {
        liveRevision += 1;
        removeCache(userId);
        replaceState({
          status: 'ready',
          userId: userId,
          settings: emptySettings(),
          updatedAt: null,
          source: 'remote',
          warning: null,
          error: null
        }, true);
        startRealtime(auth.client, userId);
        return getState();
      }

      var parsed = settingsCore.parseStoredValue(result.data.value);
      if (parsed.warning) {
        removeCache(userId);
      }
      liveRevision += 1;
      replaceState({
        status: 'ready',
        userId: userId,
        settings: parsed.settings,
        updatedAt: result.data.updated_at || null,
        source: 'remote',
        warning: parsed.warning || null,
        error: null
      }, true);
      if (!parsed.warning) {
        writeCache(userId, parsed.settings, result.data.updated_at);
      }
      startRealtime(auth.client, userId);
      return getState();
    }

    async function save(draft) {
      var validation = settingsCore.validateDraft(draft);
      if (!validation.valid) {
        throw storeError('VALIDATION_ERROR', 'проверьте ссылки');
      }

      var auth = await authContext();
      var userId = auth.user.id;
      if (state.userId !== userId || state.status !== 'ready') {
        throw storeError(
          'SETTINGS_NOT_READY',
          'настройки текущего аккаунта ещё не загружены'
        );
      }
      var saveGeneration = operationGeneration;
      var confirmedState = getState();
      replaceState({
        status: 'saving',
        userId: userId,
        error: null
      }, false);

      var row = {
        user_id: userId,
        key: settingsCore.REMOTE_KEY,
        value: settingsCore.serialize(validation.settings)
      };
      var result;
      try {
        result = await auth.client
          .from('user_data')
          .upsert(row, { onConflict: 'user_id,key' })
          .select('value, updated_at')
          .single();
      } catch (_error) {
        result = { data: null, error: true };
      }

      if (!result || result.error) {
        var saveError = storeError(
          'SAVE_FAILED',
          'не удалось сохранить настройки кабинетов'
        );
        if (
          state.userId === userId &&
          operationGeneration === saveGeneration
        ) {
          state = Object.assign({}, confirmedState, {
            status: 'error',
            error: safeError(saveError.code, saveError.message)
          });
        }
        throw saveError;
      }

      await ensureSameAuth(userId);
      if (operationGeneration !== saveGeneration) {
        throw storeError('AUTH_CHANGED', 'аккаунт изменился во время запроса');
      }
      var savedRow = result.data || row;
      var parsed = settingsCore.parseStoredValue(savedRow.value);
      if (parsed.warning) {
        state = Object.assign({}, confirmedState, {
          status: 'error',
          error: safeError(
            'SAVE_FAILED',
            'сервер вернул некорректные настройки кабинетов'
          )
        });
        throw storeError(
          'SAVE_FAILED',
          'сервер вернул некорректные настройки кабинетов'
        );
      }

      var savedAt = savedRow.updated_at || null;
      var nextState = applyParsed(userId, parsed, savedAt, 'save');
      startRealtime(auth.client, userId);
      return nextState;
    }

    function subscribe(listener) {
      if (typeof listener !== 'function') {
        throw new TypeError('listener must be a function');
      }
      listeners.push(listener);
      return function unsubscribe() {
        var index = listeners.indexOf(listener);
        if (index !== -1) listeners.splice(index, 1);
      };
    }

    function destroy() {
      destroyed = true;
      operationGeneration += 1;
      stopRealtime();
      stopAuthWatch();
      listeners = [];
    }

    return Object.freeze({
      load: load,
      refresh: load,
      save: save,
      getState: getState,
      subscribe: subscribe,
      destroy: destroy
    });
  }

  return Object.freeze({
    create: create
  });
});
