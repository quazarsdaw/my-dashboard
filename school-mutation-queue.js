(function (root, factory) {
  'use strict';

  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.SchoolMutationQueue = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  function create(options) {
    options = options || {};
    var items = [];
    var pendingCounts = new Map();
    var processing = false;
    var idleWaiters = [];

    function pendingKeys() {
      return new Set(Array.from(pendingCounts.keys()).filter(function (key) {
        return pendingCounts.get(key) > 0;
      }));
    }

    function emitPending() {
      if (typeof options.onPendingChange === 'function') {
        options.onPendingChange(pendingKeys());
      }
    }

    function changeKeys(keys, delta) {
      (keys || []).forEach(function (key) {
        var next = (pendingCounts.get(key) || 0) + delta;
        if (next > 0) pendingCounts.set(key, next);
        else pendingCounts.delete(key);
      });
      emitPending();
    }

    function settleIdle(error) {
      var waiters = idleWaiters.splice(0);
      waiters.forEach(function (waiter) {
        if (error) waiter.reject(error);
        else waiter.resolve();
      });
    }

    async function drain() {
      if (processing) return;
      processing = true;
      var idleError = null;
      try {
        do {
          while (items.length) {
            var item = items.shift();
            try {
              item.resolve(await options.execute(item.entry));
            } catch (error) {
              item.reject(error);
            } finally {
              changeKeys(item.entry.keys, -1);
            }
          }
          try {
            if (typeof options.afterBatch === 'function') await options.afterBatch();
            idleError = null;
          } catch (error) {
            idleError = error;
            if (typeof options.onAfterBatchError === 'function') {
              options.onAfterBatchError(error);
            }
          }
        } while (items.length);
      } finally {
        processing = false;
        settleIdle(idleError);
        if (items.length) drain();
      }
    }

    function enqueue(entry) {
      changeKeys(entry.keys, 1);
      return new Promise(function (resolve, reject) {
        items.push({ entry: entry, resolve: resolve, reject: reject });
        drain();
      });
    }

    function whenIdle() {
      if (!processing && items.length === 0) return Promise.resolve();
      return new Promise(function (resolve, reject) {
        idleWaiters.push({ resolve: resolve, reject: reject });
      });
    }

    return Object.freeze({
      enqueue: enqueue,
      isPending: function (key) { return pendingCounts.has(key); },
      whenIdle: whenIdle
    });
  }

  return Object.freeze({ create: create });
});
