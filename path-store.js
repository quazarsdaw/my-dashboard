(function (root, factory) {
  var core =
    typeof module === 'object' && module.exports
      ? require('./path-core.js')
      : root.IdentityPath;
  var api = factory(core);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.IdentityPathStore = api;
})(typeof window !== 'undefined' ? window : null, function (P) {
  'use strict';
  function error(code) {
    var e = new Error(code);
    e.code = code;
    return e;
  }
  function create(options) {
    var storage = options.storage;
    var write =
      options.write ||
      function (key, value) {
        storage.setItem(key, JSON.stringify(value));
      };
    function read() {
      var raw = storage.getItem(P.KEY);
      if (raw === null) return null;
      var path;
      try {
        path = JSON.parse(raw);
      } catch (e) {
        throw error('INVALID_DATA');
      }
      return P.validatePath(path);
    }
    function initialize(now) {
      if (read()) throw error('PATH_EXISTS');
      var path = P.createPath(now);
      write(P.KEY, path);
      return path;
    }
    function update(expectedRevision, operation) {
      var current = read();
      if (!current) throw error('PATH_MISSING');
      if (current.revision !== expectedRevision) throw error('STALE_REVISION');
      var next = P.validatePath(operation(current));
      if (JSON.stringify(next) !== JSON.stringify(current)) write(P.KEY, next);
      return next;
    }
    function source(key, fallback) {
      try {
        return JSON.parse(storage.getItem(key)) || fallback;
      } catch (e) {
        return fallback;
      }
    }
    function sources() {
      var goals = source('horizons_goals_v2', {});
      var tracker = source('tracker_v1', {});
      function records(value) {
        return Array.isArray(value)
          ? value.filter(function (item) {
              return (
                item &&
                typeof item === 'object' &&
                typeof item.id === 'string' &&
                item.id.trim()
              );
            })
          : [];
      }
      tracker = tracker && typeof tracker === 'object' ? tracker : {};
      return {
        goals: records(goals.goals),
        tracker: {
          good: records(tracker.good),
          bad: records(tracker.bad),
          marks:
            tracker.marks &&
            typeof tracker.marks === 'object' &&
            !Array.isArray(tracker.marks)
              ? tracker.marks
              : {},
        },
      };
    }
    function subscribe(fn) {
      var events = options.events;
      if (!events) return function () {};
      var names = ['storage', 'dashboard-sync-applied', 'gamification-update'];
      names.forEach(function (name) {
        events.addEventListener(name, fn);
      });
      return function () {
        names.forEach(function (name) {
          events.removeEventListener(name, fn);
        });
      };
    }
    return {
      read: read,
      initialize: initialize,
      update: update,
      sources: sources,
      subscribe: subscribe,
    };
  }
  return { create: create };
});
