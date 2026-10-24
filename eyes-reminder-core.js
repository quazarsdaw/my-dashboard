(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.EyesReminderCore = factory();
})(typeof window === 'object' ? window : globalThis, function () {
  'use strict';
  var PERIOD = 1200000;
  function reduce(raw, e) {
    var s = Object.assign(
        {
          enabled: false,
          dueAt: null,
          cycleId: 0,
          claimedCycle: null,
          distanceSession: null,
        },
        raw || {},
      ),
      effects = [],
      n = e.nowMs;
    function reset(ms) {
      s.dueAt = s.enabled ? n + ms : null;
      s.cycleId++;
      s.claimedCycle = null;
    }
    switch (e.type) {
      case 'enable':
        s.enabled = true;
        reset(PERIOD);
        break;
      case 'disable':
        s.enabled = false;
        s.dueAt = null;
        s.distanceSession = null;
        effects.push({ type: 'hide' });
        break;
      case 'open':
        if (e.fresh && s.enabled) reset(PERIOD);
        break;
      case 'ownerChanged':
        s.owner = e.owner;
        s.distanceSession = null;
        reset(PERIOD);
        effects.push({ type: 'hide' });
        break;
      case 'tick':
        if (
          s.enabled &&
          e.visible &&
          !e.busy &&
          Number.isFinite(s.dueAt) &&
          n >= s.dueAt
        ) {
          s.claimedCycle = s.cycleId;
          effects.push({ type: 'show', cycleId: s.cycleId });
          s.dueAt = n + PERIOD;
          s.cycleId++;
        }
        break;
      case 'later':
        reset(300000);
        effects.push({ type: 'hide' });
        break;
      case 'completeExercise':
        reset(PERIOD);
        effects.push({ type: 'hide' });
        break;
      case 'startDistance':
        s.distanceSession = {
          id: e.id,
          epoch: e.epoch,
          owner: e.owner,
          elapsedMs: 0,
          lastMono: e.monoMs,
          phase: 'running',
        };
        effects.push({ type: 'startDistance' });
        break;
      case 'distanceTick':
        if (
          s.distanceSession &&
          s.distanceSession.phase === 'running' &&
          e.visible
        ) {
          var d = Object.assign({}, s.distanceSession),
            delta = Math.max(0, e.monoMs - d.lastMono);
          d.lastMono = Math.max(d.lastMono, e.monoMs);
          d.elapsedMs = Math.min(20000, d.elapsedMs + delta);
          s.distanceSession = d;
          if (d.elapsedMs >= 20000) {
            effects.push({ type: 'completeDistance', session: d });
            s.distanceSession = null;
            reset(PERIOD);
          }
        }
        break;
      case 'pauseDistance':
        if (s.distanceSession)
          s.distanceSession = Object.assign({}, s.distanceSession, {
            phase: 'paused',
          });
        break;
      case 'resumeDistance':
        if (s.distanceSession)
          s.distanceSession = Object.assign({}, s.distanceSession, {
            phase: 'running',
            lastMono: e.monoMs,
          });
        break;
      case 'cancelDistance':
        s.distanceSession = null;
        effects.push({ type: 'hide' });
        break;
    }
    return { state: s, effects: effects };
  }
  return { reduce: reduce };
});
