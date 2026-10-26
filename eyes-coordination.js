(function (root, factory) {
  if (typeof module === 'object' && module.exports)
    module.exports = factory(require('./browser-lock.js'));
  else root.EyesCoordination = factory(root.BrowserLock);
})(typeof window === 'object' ? window : globalThis, function (B) {
  'use strict';
  var KEY = '_eye_break_session_lease_v1';
  var RETIRED = '_eye_break_session_retired_v1:';
  function create(o) {
    var lock = B.create(o),
      now = o.now || Date.now,
      instanceId = o.uuid(),
      channel = o.channelFactory
        ? o.channelFactory('dashboard-eye-breaks')
        : null,
      listeners = [];
    function readLease() {
      try {
        var x = JSON.parse(o.storage.getItem(KEY));
        return x &&
          typeof x.token === 'string' &&
          typeof x.instanceId === 'string'
          ? x
          : null;
      } catch (_) {
        return null;
      }
    }
    function active() {
      var x = readLease();
      return x && x.until > now() && x.until <= now() + 16000 &&
        o.storage.getItem(RETIRED + x.token) !== x.instanceId
        ? x : null;
    }
    function publish() {
      if (channel) channel.postMessage({ type: 'changed' });
      listeners.forEach(function (fn) {
        fn();
      });
    }
    if (channel) channel.onmessage = publishLocal;
    function publishLocal() {
      listeners.forEach(function (fn) {
        fn();
      });
    }
    async function claimSession(request) {
      return lock.withLock('eye-active-session', function () {
        var previous = readLease(), x = active();
        if (
          x &&
          (x.id !== request.id ||
            x.owner !== request.owner ||
            x.instanceId !== instanceId)
        )
          return { ok: false, active: x };
        var token = x ? x.token : o.uuid();
        o.storage.setItem(
          KEY,
          JSON.stringify({
            id: request.id,
            owner: request.owner,
            tabId: o.tabId,
            instanceId: instanceId,
            token: token,
            until: now() + 15000,
          }),
        );
        if (previous) o.storage.removeItem(RETIRED + previous.token);
        publish();
        return { ok: true, token: token };
      });
    }
    async function renewSession(token) {
      return lock.withLock('eye-active-session', function () {
        var x = active();
        if (!x || x.token !== token || x.instanceId !== instanceId)
          return false;
        x.until = now() + 15000;
        o.storage.setItem(KEY, JSON.stringify(x));
        return true;
      });
    }
    async function releaseSession(token) {
      return lock.withLock('eye-active-session', function () {
        var x = active();
        if (!x || x.token !== token || x.instanceId !== instanceId)
          return false;
        o.storage.removeItem(KEY);
        publish();
        return true;
      });
    }
    // pagehide не ждёт promises. Отзыв отдельного token не перезаписывает
    // lease и не может удалить владение, полученное другим документом.
    function retireSession(token) {
      var x = readLease();
      if (!x || x.token !== token || x.instanceId !== instanceId) return false;
      o.storage.setItem(RETIRED + token, instanceId);
      publish();
      return true;
    }
    return {
      withLock: lock.withLock,
      claimSession: claimSession,
      renewSession: renewSession,
      releaseSession: releaseSession,
      retireSession: retireSession,
      active: active,
      subscribe: function (fn) {
        listeners.push(fn);
        return function () {
          listeners = listeners.filter(function (f) {
            return f !== fn;
          });
        };
      },
      close: function () {
        if (channel) channel.close();
        listeners = [];
      },
    };
  }
  return { create: create };
});
