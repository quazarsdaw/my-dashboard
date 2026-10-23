(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.IdentityPath = api;
})(typeof window !== 'undefined' ? window : null, function () {
  'use strict';
  var KEY = 'identity_path_v1';
  var DEFAULT_VISUAL = { energy: 40, outfit: 'casual', scene: 'calm' };
  var OUTFITS = ['casual', 'sport', 'smart'];
  var SCENES = ['calm', 'work', 'graduate'];
  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }
  function fail(code) {
    var e = new Error(code);
    e.code = code;
    throw e;
  }
  function text(value, max, required) {
    if (
      typeof value !== 'string' ||
      Array.from(value).length > max ||
      (required && !value.trim())
    )
      fail('INVALID_DATA');
    return value.trim();
  }
  function validId(value) {
    return typeof value === 'string' && /^[a-zA-Z0-9_-]{1,100}$/.test(value);
  }
  function validDate(value) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value || '')) return false;
    var date = new Date(value + 'T12:00:00Z');
    return (
      Number.isFinite(date.getTime()) &&
      date.toISOString().slice(0, 10) === value
    );
  }
  function dayKey(now) {
    var parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Yekaterinburg',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(new Date(now || Date.now()));
    var p = {};
    parts.forEach(function (v) {
      p[v.type] = v.value;
    });
    return p.year + '-' + p.month + '-' + p.day;
  }
  function visual(value) {
    var v = Object.assign({}, DEFAULT_VISUAL, value || {});
    if (
      !Number.isInteger(v.energy) ||
      v.energy < 0 ||
      v.energy > 100 ||
      !OUTFITS.includes(v.outfit) ||
      !SCENES.includes(v.scene)
    )
      fail('INVALID_DATA');
    return { energy: v.energy, outfit: v.outfit, scene: v.scene };
  }
  function avatar(value) {
    var a = value || { skin: '#c99572', hair: '#29221f' };
    if (!/^#[a-fA-F0-9]{6}$/.test(a.skin) || !/^#[a-fA-F0-9]{6}$/.test(a.hair))
      fail('INVALID_DATA');
    return { skin: a.skin, hair: a.hair };
  }
  function criterion(value) {
    if (!value || !validId(value.id)) fail('INVALID_DATA');
    var c = {
      id: value.id,
      type: value.type,
      title: text(value.title, 160, true),
      required: value.required !== false,
    };
    if (c.type === 'manual') c.done = value.done === true;
    else if (c.type === 'goal') {
      if (!validId(value.goalId)) fail('INVALID_DATA');
      c.goalId = value.goalId;
    } else if (c.type === 'habit') {
      if (
        !validId(value.habitId) ||
        !validDate(value.since) ||
        !Number.isInteger(value.target) ||
        value.target < 1 ||
        value.target > 3650
      )
        fail('INVALID_DATA');
      c.habitId = value.habitId;
      c.since = value.since;
      c.target = value.target;
    } else fail('INVALID_DATA');
    return c;
  }
  function stageDraft(value) {
    if (
      !value ||
      !validId(value.id) ||
      !Array.isArray(value.criteria) ||
      value.criteria.length > 20
    )
      fail('INVALID_DATA');
    var criteria = value.criteria.map(criterion);
    if (
      new Set(
        criteria.map(function (c) {
          return c.id;
        }),
      ).size !== criteria.length
    )
      fail('INVALID_DATA');
    var targetDate = value.targetDate || '';
    if (targetDate && !validDate(targetDate)) fail('INVALID_DATA');
    return {
      id: value.id,
      title: text(value.title, 80, true),
      description: text(value.description || '', 1000, false),
      targetDate: targetDate,
      visual: visual(value.visual),
      criteria: criteria,
      destination: value.destination === true,
    };
  }
  function validatePath(value) {
    if (!value || typeof value !== 'object' || value.schemaVersion !== 1)
      fail('UNSUPPORTED_VERSION');
    if (
      !Number.isInteger(value.revision) ||
      value.revision < 1 ||
      !Array.isArray(value.stages) ||
      value.stages.length < 1 ||
      value.stages.length > 24
    )
      fail('INVALID_DATA');
    avatar(value.avatar);
    var pending = false;
    var ids = new Set();
    value.stages.forEach(function (s, i) {
      stageDraft(s);
      if (ids.has(s.id)) fail('INVALID_DATA');
      ids.add(s.id);
      if (s.destination && i !== value.stages.length - 1)
        fail('DESTINATION_LAST');
      if (s.acceptedAt) {
        if (
          pending ||
          !Number.isFinite(Date.parse(s.acceptedAt)) ||
          !s.snapshot
        )
          fail('INVALID_DATA');
        text(s.snapshot.title, 80, true);
        text(s.snapshot.description, 1000, false);
        visual(s.snapshot.visual);
        avatar(s.snapshot.avatar);
        if (
          !Array.isArray(s.snapshot.criteria) ||
          s.snapshot.criteria.length > 20
        )
          fail('INVALID_DATA');
        s.snapshot.criteria.forEach(function (c) {
          criterion(c);
          if (
            typeof c.done !== 'boolean' ||
            !Number.isFinite(c.current) ||
            !Number.isFinite(c.target) ||
            typeof c.progress !== 'number'
          )
            fail('INVALID_DATA');
        });
      } else {
        pending = true;
        if (i === 0) fail('INVALID_DATA');
      }
    });
    return value;
  }
  function createPath(now) {
    var a = avatar();
    var v = visual();
    return {
      schemaVersion: 1,
      revision: 1,
      avatar: a,
      stages: [
        {
          id: 'origin',
          title: 'я сейчас',
          description: 'моя исходная точка',
          targetDate: '',
          criteria: [],
          visual: v,
          acceptedAt: new Date(now || Date.now()).toISOString(),
          snapshot: {
            title: 'я сейчас',
            description: 'моя исходная точка',
            targetDate: '',
            visual: clone(v),
            avatar: clone(a),
            criteria: [],
          },
        },
      ],
    };
  }
  function evaluateCriterion(c, sources, today) {
    var current = 0;
    var target = 1;
    var warning = null;
    if (c.type === 'manual') current = c.done ? 1 : 0;
    if (c.type === 'goal') {
      var goals = Array.isArray(sources.goals) ? sources.goals : [];
      var g = goals.find(function (g) {
        return g && g.id === c.goalId;
      });
      if (!g) warning = 'SOURCE_MISSING';
      else if (g.done === true) current = 1;
      else if (
        g.type === 'number' &&
        Number.isFinite(g.current) &&
        Number.isFinite(g.target) &&
        g.target > 0
      ) {
        current = Math.max(0, g.current);
        target = g.target;
      }
    }
    if (c.type === 'habit') {
      target = c.target;
      var tracker = sources.tracker || {};
      if (
        !Array.isArray(tracker.good) ||
        !tracker.good.some(function (h) {
          return h && h.id === c.habitId;
        })
      )
        warning = 'SOURCE_MISSING';
      else {
        var prefix = c.habitId + ':';
        var marks = tracker.marks || {};
        Object.keys(marks).forEach(function (key) {
          var date = key.slice(prefix.length);
          if (
            key.startsWith(prefix) &&
            validDate(date) &&
            date >= c.since &&
            date <= today &&
            marks[key] === 1
          )
            current++;
        });
      }
    }
    var done = !warning && current >= target;
    return Object.assign({}, c, {
      current: current,
      target: target,
      done: done,
      warning: warning,
      progress: Math.round(Math.max(0, Math.min(1, current / target)) * 100),
    });
  }
  function evaluate(path, sources, now) {
    validatePath(path);
    sources = sources || {};
    var nextId = (
      path.stages.find(function (s) {
        return !s.acceptedAt;
      }) || {}
    ).id;
    var today = dayKey(now);
    return path.stages.map(function (s, index) {
      var snapshot = s.acceptedAt ? s.snapshot : null;
      var criteria = snapshot
        ? clone(snapshot.criteria)
        : s.criteria.map(function (c) {
            return evaluateCriterion(c, sources, today);
          });
      var required = criteria.filter(function (c) {
        return c.required;
      });
      var ready =
        required.length > 0 &&
        required.every(function (c) {
          return c.done;
        });
      var progress = snapshot
        ? 100
        : required.length
          ? Math.round(
              required.reduce(function (n, c) {
                return n + c.progress;
              }, 0) / required.length,
            )
          : 0;
      return {
        id: s.id,
        index: index,
        title: snapshot ? snapshot.title : s.title,
        description: snapshot ? snapshot.description : s.description,
        targetDate: snapshot ? snapshot.targetDate : s.targetDate,
        visual: clone(snapshot ? snapshot.visual : s.visual),
        avatar: clone(snapshot ? snapshot.avatar : path.avatar),
        criteria: criteria,
        state: snapshot
          ? 'completed'
          : ready
            ? 'ready'
            : s.id === nextId
              ? 'active'
              : 'planned',
        ready: ready,
        progress: progress,
        isNext: s.id === nextId,
        acceptedAt: s.acceptedAt || null,
        destination: s.destination === true,
      };
    });
  }
  function revise(path) {
    validatePath(path);
    var p = clone(path);
    p.revision++;
    return p;
  }
  function findStage(path, id) {
    var s = path.stages.find(function (s) {
      return s.id === id;
    });
    if (!s) fail('STAGE_MISSING');
    return s;
  }
  function editable(path, id) {
    var s = findStage(path, id);
    if (s.acceptedAt) fail('STAGE_ACCEPTED');
    return s;
  }
  function upsertStage(path, draft) {
    validatePath(path);
    var next = stageDraft(draft);
    var old = path.stages.find(function (s) {
      return s.id === next.id;
    });
    if (old && old.acceptedAt) fail('STAGE_ACCEPTED');
    if (!old && path.stages.length >= 24) fail('STAGE_LIMIT');
    var destination = path.stages.find(function (s) {
      return s.destination && s.id !== next.id;
    });
    if (next.destination && destination) fail('DESTINATION_EXISTS');
    if (destination && destination.acceptedAt) fail('PATH_COMPLETE');
    var p = revise(path);
    var index = p.stages.findIndex(function (s) {
      return s.id === next.id;
    });
    if (index === -1) {
      if (destination) p.stages.splice(p.stages.length - 1, 0, next);
      else p.stages.push(next);
    } else {
      p.stages[index] = next;
      if (next.destination) {
        p.stages.splice(index, 1);
        p.stages.push(next);
      }
    }
    return p;
  }
  function setManualCriterion(path, stageId, criterionId, done) {
    var p = revise(path);
    var s = editable(p, stageId);
    var c = s.criteria.find(function (c) {
      return c.id === criterionId;
    });
    if (!c || c.type !== 'manual' || typeof done !== 'boolean')
      fail('INVALID_DATA');
    c.done = done;
    return p;
  }
  function acceptStage(path, id, sources, now) {
    validatePath(path);
    var s = findStage(path, id);
    if (s.acceptedAt) return clone(path);
    var evaluated = evaluate(path, sources, now).find(function (s) {
      return s.id === id;
    });
    if (!evaluated.isNext) fail('PREVIOUS_STAGE_REQUIRED');
    if (!evaluated.ready) fail('CRITERIA_NOT_MET');
    var p = revise(path);
    var target = findStage(p, id);
    target.acceptedAt = new Date(now || Date.now()).toISOString();
    target.snapshot = {
      title: target.title,
      description: target.description,
      targetDate: target.targetDate,
      visual: clone(target.visual),
      avatar: clone(p.avatar),
      criteria: clone(evaluated.criteria),
    };
    return p;
  }
  function moveStage(path, id, delta) {
    var p = revise(path);
    editable(p, id);
    if (delta !== -1 && delta !== 1) fail('INVALID_DATA');
    var i = p.stages.findIndex(function (s) {
      return s.id === id;
    });
    var j = i + delta;
    if (j < 0 || j >= p.stages.length) return clone(path);
    if (p.stages[j].acceptedAt) fail('STAGE_ACCEPTED');
    if (p.stages[j].destination || p.stages[i].destination)
      fail('DESTINATION_LAST');
    var other = p.stages[j];
    p.stages[j] = p.stages[i];
    p.stages[i] = other;
    return p;
  }
  function removeStage(path, id) {
    var p = revise(path);
    editable(p, id);
    p.stages = p.stages.filter(function (s) {
      return s.id !== id;
    });
    return p;
  }
  function updateAvatar(path, value) {
    var p = revise(path);
    p.avatar = avatar(value);
    return p;
  }
  function label(index) {
    return 'АБВГДЕЖЗИКЛМНОПРСТУФХЦЧШ'[index] || String(index + 1);
  }
  return {
    KEY: KEY,
    createPath: createPath,
    validatePath: validatePath,
    evaluate: evaluate,
    acceptStage: acceptStage,
    upsertStage: upsertStage,
    setManualCriterion: setManualCriterion,
    moveStage: moveStage,
    removeStage: removeStage,
    updateAvatar: updateAvatar,
    dayKey: dayKey,
    label: label,
  };
});
