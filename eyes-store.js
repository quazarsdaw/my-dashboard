(function (root, factory) {
  if (typeof module === 'object' && module.exports)
    module.exports = factory(require('./eyes-data.js'));
  else root.EyesStore = factory(root.EyesData);
})(typeof window === 'object' ? window : globalThis, function (D) {
  'use strict';
  var SETTINGS = 'eye_break_settings_v1',
    EPOCH = 'eye_break_stats_epoch_v1',
    PREFIX = 'eye_break_session_v1:',
    ACTIVE = '_eye_break_active_v1';
  function create(o) {
    var storage = o.storage,
      reader =
        o.get ||
        function (k) {
          return JSON.parse(storage.getItem(k));
        },
      set =
        o.set ||
        function (k, v) {
          storage.setItem(k, JSON.stringify(v));
        },
      owner =
        o.getOwner ||
        function () {
          return 'local';
        },
      now =
        o.now ||
        function () {
          return new Date().toISOString();
        };
    function get(k) {
      try {
        return reader(k);
      } catch (_) {
        return null;
      }
    }
    function epoch() {
      var v = get(EPOCH);
      return typeof v === 'string' && v.length <= 64 && v ? v : 'initial';
    }
    function settings() {
      return D.normalizeSettings(get(SETTINGS), {
        reducedMotion: !!o.reducedMotion,
      });
    }
    function records() {
      var rows = [];
      try {
        for (var i = 0; i < storage.length; i++) {
          var k = storage.key(i);
          if (k && k.indexOf(PREFIX) === 0) {
            var r = D.validateRecord(get(k));
            if (r && k === PREFIX + r.id) rows.push(r);
          }
        }
      } catch (_) {}
      return rows;
    }
    function recordCompletion(raw) {
      var r = D.validateRecord(raw);
      if (!r || Date.parse(r.completedAt) > Date.parse(now()) + 1000)
        throw new Error('INVALID_RECORD');
      var key = PREFIX + r.id,
        existing = get(key);
      if (existing) {
        if (JSON.stringify(D.validateRecord(existing)) !== JSON.stringify(r))
          throw new Error('RECORD_CONFLICT');
        return false;
      }
      set(key, r);
      return true;
    }
    function loadActive() {
      var a = get(ACTIVE);
      return a && a.owner === owner() ? a : null;
    }
    function saveActive(a) {
      if (a.owner !== owner()) throw new Error('OWNER_CHANGED');
      storage.setItem(ACTIVE, JSON.stringify(a));
    }
    function clearActive(id) {
      var raw = get(ACTIVE);
      if (raw && raw.owner === owner() && (!id || raw.id === id))
        storage.removeItem(ACTIVE);
    }
    function subscribe(fn) {
      var events = o.events;
      if (!events) return function () {};
      var names = [
        'storage',
        'dashboard-sync-applied',
        'dashboard-data-changed',
      ];
      function listener(e) {
        if (e.type === 'storage' && e.key && e.key.indexOf('eye_break_') !== 0)
          return;
        fn(e);
      }
      names.forEach(function (n) {
        events.addEventListener(n, listener);
      });
      return function () {
        names.forEach(function (n) {
          events.removeEventListener(n, listener);
        });
      };
    }
    return {
      settings: settings,
      saveSettings: function (raw) {
        var s = D.normalizeSettings(raw, { reducedMotion: !!o.reducedMotion });
        set(SETTINGS, s);
        return s;
      },
      records: records,
      recordCompletion: recordCompletion,
      summary: function () {
        return D.summarize(records(), epoch(), now());
      },
      epoch: epoch,
      resetStats: function () {
        var id = o.uuid();
        set(EPOCH, id);
        return id;
      },
      loadActive: loadActive,
      saveActive: saveActive,
      clearActive: clearActive,
      subscribe: subscribe,
    };
  }
  return {
    create: create,
    KEYS: { settings: SETTINGS, epoch: EPOCH, prefix: PREFIX, active: ACTIVE },
  };
});
