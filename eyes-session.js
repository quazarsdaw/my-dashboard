(function (root, factory) {
  if (typeof module === 'object' && module.exports)
    module.exports = factory(require('./eyes-core.js'));
  else root.EyesSession = factory(root.EyesCore);
})(typeof window === 'object' ? window : globalThis, function (C) {
  'use strict';
  function validPlan(plan) {
    if (!plan || !Array.isArray(plan.stages)) return false;
    var expected = C.buildPlan({
      mode: plan.mode,
      durationSeconds: plan.durationSeconds,
      exerciseIds: plan.stages.map(function (s) {
        return s && s.exerciseId;
      }),
    });
    return (
      expected.ok &&
      JSON.stringify(expected.stages) === JSON.stringify(plan.stages)
    );
  }
  function createSession(plan, o) {
    if (!validPlan(plan) || !o || !Number.isFinite(o.nowMs))
      throw new Error('INVALID_SESSION');
    return {
      version: 1,
      id: o.id,
      epoch: o.epoch,
      owner: o.owner,
      plan: JSON.parse(JSON.stringify(plan)),
      phase: 'running',
      playedMs: 0,
      cursorMs: 0,
      lastTickMs: o.nowMs,
      skipped: false,
    };
  }
  function advanceSession(s, now) {
    if (s.phase !== 'running' || !Number.isFinite(now) || now < s.lastTickMs)
      return s;
    var delta = Math.min(
      now - s.lastTickMs,
      s.plan.durationSeconds * 1000 - s.cursorMs,
    );
    var cursor = s.cursorMs + delta;
    return Object.assign({}, s, {
      playedMs: s.playedMs + delta,
      cursorMs: cursor,
      lastTickMs: now,
      phase: cursor >= s.plan.durationSeconds * 1000 ? 'completed' : 'running',
    });
  }
  function pauseSession(s, now) {
    s = advanceSession(s, now);
    return s.phase === 'running'
      ? Object.assign({}, s, { phase: 'paused' })
      : s;
  }
  function resumeSession(s, now) {
    return s.phase === 'paused' && Number.isFinite(now)
      ? Object.assign({}, s, { phase: 'running', lastTickMs: now })
      : s;
  }
  function sessionView(s) {
    var start = 0,
      index = s.plan.stages.length - 1;
    for (var i = 0; i < s.plan.stages.length; i++) {
      var end = start + s.plan.stages[i].durationSeconds * 1000;
      if (s.cursorMs < end || i === s.plan.stages.length - 1) {
        index = i;
        break;
      }
      start = end;
    }
    return {
      phase: s.phase,
      stageIndex: index,
      exerciseId: s.plan.stages[index].exerciseId,
      stageElapsedMs: s.cursorMs - start,
      remainingMs: Math.max(0, s.plan.durationSeconds * 1000 - s.cursorMs),
      progress: s.cursorMs / (s.plan.durationSeconds * 1000),
      skipped: s.skipped,
    };
  }
  function skipStage(s, now) {
    s = advanceSession(s, now);
    if (s.phase !== 'running' && s.phase !== 'paused') return s;
    var v = sessionView(s),
      end = s.plan.stages.slice(0, v.stageIndex + 1).reduce(function (n, x) {
        return n + x.durationSeconds * 1000;
      }, 0);
    return Object.assign({}, s, {
      cursorMs: end,
      skipped: true,
      phase: end >= s.plan.durationSeconds * 1000 ? 'completed' : s.phase,
    });
  }
  function cancelSession(s, now) {
    s = advanceSession(s, now);
    return Object.assign({}, s, { phase: 'cancelled' });
  }
  function restoreSession(raw, o) {
    if (
      !raw ||
      raw.version !== 1 ||
      raw.owner !== o.owner ||
      !validPlan(raw.plan) ||
      ['running', 'paused'].indexOf(raw.phase) < 0 ||
      typeof raw.id !== 'string' ||
      typeof raw.epoch !== 'string' ||
      !Number.isFinite(raw.playedMs) ||
      !Number.isFinite(raw.cursorMs) ||
      raw.playedMs < 0 ||
      raw.cursorMs < raw.playedMs ||
      raw.cursorMs >= raw.plan.durationSeconds * 1000 ||
      typeof raw.skipped !== 'boolean'
    )
      return null;
    return Object.assign({}, JSON.parse(JSON.stringify(raw)), {
      phase: 'paused',
      lastTickMs: o.nowMs,
    });
  }
  function completionRecord(s, at) {
    if (
      !s ||
      s.phase !== 'completed' ||
      s.skipped ||
      s.playedMs !== s.plan.durationSeconds * 1000 ||
      !Number.isFinite(Date.parse(at))
    )
      return null;
    return {
      version: 1,
      id: s.id,
      epoch: s.epoch,
      completedAt: at,
      durationSeconds: s.plan.durationSeconds,
      mode: s.plan.mode,
      exerciseIds: s.plan.stages.map(function (x) {
        return x.exerciseId;
      }),
    };
  }
  return {
    createSession: createSession,
    advanceSession: advanceSession,
    pauseSession: pauseSession,
    resumeSession: resumeSession,
    sessionView: sessionView,
    skipStage: skipStage,
    cancelSession: cancelSession,
    restoreSession: restoreSession,
    completionRecord: completionRecord,
  };
});
