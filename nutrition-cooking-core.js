(function (root, factory) {
  'use strict';

  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.NutritionCookingCore = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var ACTIVE_MODES = ['extended', 'winter'];
  var ACTIVE_CATEGORIES = ['cutting', 'prep', 'portioning', 'washing', 'other'];
  var SLOT_ORDER = ['breakfast', 'lunch', 'dinner'];

  function clone(value) {
    if (value === undefined) return undefined;
    return JSON.parse(JSON.stringify(value));
  }

  function isRecord(value) {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
  }

  function finiteInRange(value, min, max, fallback) {
    var number = Number(value);
    return Number.isFinite(number) && number >= min && number <= max ? number : fallback;
  }

  function createDefaultResources() {
    return [
      { id: 'burner-1', type: 'burner', kind: 'equipment', title: 'конфорка 1', preferredLocation: 'kitchen', requiresOutlet: true, strength: 'good' },
      { id: 'burner-2', type: 'burner', kind: 'equipment', title: 'конфорка 2', preferredLocation: 'kitchen', requiresOutlet: true, strength: 'good' },
      { id: 'burner-weak', type: 'burner', kind: 'equipment', title: 'резервная конфорка', preferredLocation: 'kitchen', requiresOutlet: true, strength: 'weak' },
      { id: 'air-fryer', type: 'airFryer', kind: 'equipment', title: 'аэрогриль', preferredLocation: 'room', requiresOutlet: true },
      { id: 'multicooker', type: 'multicooker', kind: 'equipment', title: 'мультиварка', preferredLocation: 'room', requiresOutlet: true },
      { id: 'oven', type: 'oven', kind: 'equipment', title: 'духовка', preferredLocation: 'kitchen', requiresOutlet: true },
      { id: 'microwave', type: 'microwave', kind: 'equipment', title: 'микроволновка', preferredLocation: 'kitchen', requiresOutlet: true },
      { id: 'kettle', type: 'kettle', kind: 'equipment', title: 'чайник', preferredLocation: 'kitchen', requiresOutlet: true },
      { id: 'blender', type: 'blender', kind: 'equipment', title: 'блендер', preferredLocation: 'kitchen', requiresOutlet: true },
      { id: 'pan-1', type: 'pan', kind: 'cookware', title: 'сковорода', preferredLocation: 'kitchen', requiresOutlet: false },
      { id: 'pan-deep', type: 'deepPan', kind: 'cookware', title: 'глубокая сковорода', preferredLocation: 'kitchen', requiresOutlet: false },
      { id: 'pot-1', type: 'pot', kind: 'cookware', title: 'кастрюля', preferredLocation: 'kitchen', requiresOutlet: false },
      { id: 'pot-small', type: 'smallPot', kind: 'cookware', title: 'небольшая кастрюля', preferredLocation: 'kitchen', requiresOutlet: false }
    ];
  }

  function createDefaultKitchenProfile() {
    return {
      version: 1,
      activeMode: 'extended',
      modes: {
        extended: {
          kitchenOutlets: 2,
          roomOutlets: 2,
          preferredLocations: { airFryer: 'room', multicooker: 'room', burner: 'kitchen' }
        },
        winter: {
          kitchenOutlets: 2,
          roomOutlets: 0,
          preferredLocations: { airFryer: 'kitchen', multicooker: 'kitchen', burner: 'kitchen' }
        }
      },
      resources: createDefaultResources(),
      calibration: {
        defaultActiveFactor: 1.5,
        factors: {},
        observations: {}
      }
    };
  }

  function normalizeKitchenProfile(raw) {
    var fallback = createDefaultKitchenProfile();
    if (!isRecord(raw)) return fallback;
    var activeMode = ACTIVE_MODES.indexOf(raw.activeMode) !== -1 ? raw.activeMode : fallback.activeMode;
    var factors = {};
    var observations = {};
    var rawCalibration = isRecord(raw.calibration) ? raw.calibration : {};

    ACTIVE_CATEGORIES.forEach(function (category) {
      var factor = Number(rawCalibration.factors && rawCalibration.factors[category]);
      if (Number.isFinite(factor) && factor >= 0.75 && factor <= 3) factors[category] = factor;
      var count = Number(rawCalibration.observations && rawCalibration.observations[category]);
      if (Number.isInteger(count) && count > 0) observations[category] = count;
    });

    ACTIVE_MODES.forEach(function (mode) {
      var rawMode = isRecord(raw.modes && raw.modes[mode]) ? raw.modes[mode] : {};
      fallback.modes[mode].kitchenOutlets = finiteInRange(
        rawMode.kitchenOutlets,
        0,
        8,
        fallback.modes[mode].kitchenOutlets
      );
      fallback.modes[mode].roomOutlets = finiteInRange(
        rawMode.roomOutlets,
        0,
        8,
        fallback.modes[mode].roomOutlets
      );
    });

    fallback.activeMode = activeMode;
    fallback.calibration.defaultActiveFactor = finiteInRange(
      rawCalibration.defaultActiveFactor,
      1,
      2.5,
      fallback.calibration.defaultActiveFactor
    );
    fallback.calibration.factors = factors;
    fallback.calibration.observations = observations;
    return fallback;
  }

  function getActiveOutletPool(profile) {
    var safe = normalizeKitchenProfile(profile);
    var mode = safe.modes[safe.activeMode];
    var outlets = [];
    var index;
    for (index = 1; index <= mode.kitchenOutlets; index++) {
      outlets.push({ id: 'kitchen-outlet-' + index, location: 'kitchen' });
    }
    for (index = 1; index <= mode.roomOutlets; index++) {
      outlets.push({ id: 'room-outlet-' + index, location: 'room' });
    }
    return outlets;
  }

  function catalogMap(catalog) {
    var result = {};
    (catalog || []).forEach(function (item) {
      if (item && item.id && !result[item.id]) result[item.id] = item;
    });
    return result;
  }

  function resolveMealId(templateDay, state, dayNumber, slot) {
    var cycleId = state && state.activeCycle && state.activeCycle.id || '';
    var key = cycleId + ':' + dayNumber + ':' + slot;
    return state && state.overrides && state.overrides[key] || templateDay.meals[slot];
  }

  function stableStringify(value) {
    if (Array.isArray(value)) return '[' + value.map(stableStringify).join(',') + ']';
    if (isRecord(value)) {
      return '{' + Object.keys(value).sort().map(function (key) {
        return JSON.stringify(key) + ':' + stableStringify(value[key]);
      }).join(',') + '}';
    }
    return JSON.stringify(value);
  }

  function hashString(value) {
    var hash = 2166136261;
    for (var index = 0; index < value.length; index++) {
      hash ^= value.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(36);
  }

  function batchIdentity(meal) {
    var title = String(meal.title || meal.id || 'блюдо').trim().toLowerCase();
    return {
      id: 'batch-' + meal.id,
      label: 'партия · ' + title,
      colorIndex: parseInt(hashString(meal.id), 36) % 8
    };
  }

  function buildCookingDemand(template, state, catalog, week) {
    var safeWeek = Number(week) === 2 ? 2 : 1;
    var startDay = safeWeek === 1 ? 1 : 8;
    var endDay = startDay + 6;
    var byId = catalogMap(catalog);
    var groups = {};

    (template && Array.isArray(template.days) ? template.days : []).forEach(function (day) {
      var dayNumber = Number(day.day);
      if (dayNumber < startDay || dayNumber > endDay || !isRecord(day.meals)) return;
      SLOT_ORDER.forEach(function (slot) {
        var baseId = day.meals[slot];
        var selectedId = resolveMealId(day, state, dayNumber, slot);
        var meal = byId[selectedId] || byId[baseId];
        if (!meal) return;
        if (!groups[meal.id]) groups[meal.id] = { meal: meal, occurrences: [] };
        groups[meal.id].occurrences.push({ day: dayNumber, slot: slot });
      });
    });

    var batches = Object.keys(groups).map(function (mealId) {
      var group = groups[mealId];
      var identity = batchIdentity(group.meal);
      var outside = Array.isArray(group.meal.tags) && group.meal.tags.indexOf('вне дома') !== -1;
      return {
        id: identity.id,
        mealId: mealId,
        title: group.meal.title,
        label: outside ? 'вне дома' : identity.label,
        colorIndex: identity.colorIndex,
        portions: group.occurrences.length,
        servingDays: group.occurrences.map(function (item) { return item.day; }),
        occurrences: clone(group.occurrences),
        strategy: outside ? 'outside' : group.occurrences.length > 1 ? 'batch' : 'serve-day',
        meal: clone(group.meal)
      };
    });

    batches.sort(function (left, right) {
      return left.servingDays[0] - right.servingDays[0] || left.mealId.localeCompare(right.mealId);
    });

    return {
      version: 1,
      cycleId: state && state.activeCycle && state.activeCycle.id || '',
      week: safeWeek,
      batches: batches
    };
  }

  function profileFingerprint(profile) {
    var safe = normalizeKitchenProfile(profile);
    return {
      activeMode: safe.activeMode,
      mode: safe.modes[safe.activeMode],
      resources: safe.resources.map(function (item) {
        return { id: item.id, type: item.type, preferredLocation: item.preferredLocation };
      }),
      calibration: safe.calibration
    };
  }

  function createPlanFingerprint(demand, profile) {
    return 'cook-' + hashString(stableStringify({ demand: demand, profile: profileFingerprint(profile) }));
  }

  function createEmptyCookingStore() {
    return { version: 1, plansByHash: {}, sessionsById: {}, activeSessionId: null, lastSessionId: null, lastSessionIdsByWeek: {} };
  }

  function normalizeCookingStore(raw) {
    var empty = createEmptyCookingStore();
    if (!isRecord(raw)) return empty;
    empty.plansByHash = isRecord(raw.plansByHash) ? clone(raw.plansByHash) : {};
    empty.sessionsById = isRecord(raw.sessionsById) ? clone(raw.sessionsById) : {};
    empty.activeSessionId = typeof raw.activeSessionId === 'string' ? raw.activeSessionId : null;
    empty.lastSessionId = typeof raw.lastSessionId === 'string' ? raw.lastSessionId : null;
    empty.lastSessionIdsByWeek = isRecord(raw.lastSessionIdsByWeek) ? clone(raw.lastSessionIdsByWeek) : {};
    return empty;
  }

  function getCachedPlan(store, hash) {
    var safe = normalizeCookingStore(store);
    return safe.plansByHash[hash] ? clone(safe.plansByHash[hash]) : null;
  }

  function putCachedPlan(store, plan) {
    var safe = normalizeCookingStore(store);
    if (!isRecord(plan) || typeof plan.planHash !== 'string' || !plan.planHash) return safe;
    safe.plansByHash[plan.planHash] = clone(plan);
    return safe;
  }

  function activeSessionForPlan(store, planHash) {
    var safe = normalizeCookingStore(store);
    var session = safe.activeSessionId && safe.sessionsById[safe.activeSessionId];
    return Boolean(session && session.status !== 'completed' && session.planHash === planHash);
  }

  function clearCachedPlans(store) {
    var safe = normalizeCookingStore(store);
    var active = safe.activeSessionId && safe.sessionsById[safe.activeSessionId];
    var activePlan = active && safe.plansByHash[active.planHash];
    safe.plansByHash = {};
    if (activePlan) safe.plansByHash[active.planHash] = clone(activePlan);
    return safe;
  }

  function invalidateWeek(store, cycleId, week) {
    var safe = normalizeCookingStore(store);
    var active = safe.activeSessionId && safe.sessionsById[safe.activeSessionId];
    var protectedHash = active && active.status !== 'completed' ? active.planHash : '';
    Object.keys(safe.plansByHash).forEach(function (hash) {
      var plan = safe.plansByHash[hash];
      if (hash !== protectedHash && plan && plan.cycleId === cycleId && Number(plan.week) === Number(week)) {
        delete safe.plansByHash[hash];
      }
    });
    return safe;
  }

  function sameStringSet(left, right) {
    var first = Array.from(new Set(left)).sort();
    var second = Array.from(new Set(right)).sort();
    return first.length === second.length && first.every(function (value, index) { return value === second[index]; });
  }

  function planCoversDemand(plan, demand) {
    if (!isRecord(plan) || !Array.isArray(plan.batches) || !Array.isArray(plan.actions)) return false;
    var expected = (demand && Array.isArray(demand.batches) ? demand.batches : []).filter(function (batch) {
      return batch && batch.strategy !== 'outside';
    }).map(function (batch) { return batch.id; }).filter(Boolean);
    var declared = plan.batches.map(function (batch) { return batch && batch.id; }).filter(Boolean);
    var covered = plan.actions.map(function (action) { return action && action.batchId; }).filter(Boolean);
    return sameStringSet(declared, expected) && sameStringSet(covered, expected);
  }

  function validationError(code, message, actionId) {
    var error = { code: code, message: message };
    if (actionId) error.actionId = actionId;
    return error;
  }

  function normalizeBatch(value, index) {
    if (!isRecord(value)) return null;
    var id = typeof value.id === 'string' ? value.id.trim() : '';
    var mealId = typeof value.mealId === 'string' ? value.mealId.trim() : '';
    var title = typeof value.title === 'string' ? value.title.trim() : '';
    var portions = Math.round(Number(value.portions));
    if (!id || !mealId || !title || !Number.isFinite(portions) || portions < 1 || portions > 100) return null;
    return {
      id: id,
      mealId: mealId,
      title: title,
      portions: portions,
      label: typeof value.label === 'string' && value.label.trim() ? value.label.trim() : 'партия ' + (index + 1),
      colorIndex: Number.isInteger(value.colorIndex) ? Math.abs(value.colorIndex) % 8 : index % 8,
      servingDays: Array.isArray(value.servingDays)
        ? value.servingDays.map(Number).filter(function (day) { return Number.isInteger(day) && day >= 1 && day <= 14; })
        : [],
      strategy: ['batch', 'serve-day', 'outside'].indexOf(value.strategy) !== -1 ? value.strategy : 'batch'
    };
  }

  function allowedResourceTypes(profile) {
    var safe = normalizeKitchenProfile(profile);
    var equipment = {};
    var cookware = {};
    safe.resources.forEach(function (resource) {
      if (resource.kind === 'cookware') cookware[resource.type] = true;
      else equipment[resource.type] = true;
    });
    return { equipment: equipment, cookware: cookware };
  }

  function cleanStringArray(value) {
    if (!Array.isArray(value)) return [];
    var seen = {};
    return value.map(function (item) { return String(item || '').trim(); }).filter(function (item) {
      if (!item || seen[item]) return false;
      seen[item] = true;
      return true;
    });
  }

  function findDependencyCycle(actions) {
    var byId = {};
    var status = {};
    var cycle = null;
    actions.forEach(function (action) { byId[action.id] = action; });

    function visit(id, path) {
      if (cycle) return;
      if (status[id] === 1) {
        cycle = path.slice(path.indexOf(id)).concat(id);
        return;
      }
      if (status[id] === 2 || !byId[id]) return;
      status[id] = 1;
      byId[id].dependsOn.forEach(function (dependency) { visit(dependency, path.concat(id)); });
      status[id] = 2;
    }

    actions.forEach(function (action) { visit(action.id, []); });
    return cycle;
  }

  function validateGeneratedPlan(raw, profile) {
    var errors = [];
    if (!isRecord(raw)) {
      return { ok: false, value: null, errors: [validationError('invalid-plan', 'план должен быть объектом')] };
    }

    var batches = [];
    var batchIds = {};
    (Array.isArray(raw.batches) ? raw.batches : []).forEach(function (value, index) {
      var batch = normalizeBatch(value, index);
      if (!batch) {
        errors.push(validationError('invalid-batch', 'партия имеет неверный формат'));
        return;
      }
      if (batchIds[batch.id]) {
        errors.push(validationError('duplicate-batch-id', 'идентификатор партии повторяется'));
        return;
      }
      batchIds[batch.id] = true;
      batches.push(batch);
    });
    if (!batches.length) errors.push(validationError('missing-batches', 'в плане нет партий'));

    var allowed = allowedResourceTypes(profile);
    var actions = [];
    var actionIds = {};
    (Array.isArray(raw.actions) ? raw.actions : []).forEach(function (value) {
      if (!isRecord(value)) {
        errors.push(validationError('invalid-action', 'действие должно быть объектом'));
        return;
      }
      var id = typeof value.id === 'string' ? value.id.trim() : '';
      var batchId = typeof value.batchId === 'string' ? value.batchId.trim() : '';
      var title = typeof value.title === 'string' ? value.title.trim() : '';
      var duration = Number(value.durationMinutes);
      var mode = value.mode === 'passive' ? 'passive' : value.mode === 'active' ? 'active' : '';
      var category = typeof value.category === 'string' ? value.category.trim() : '';
      var normalizedCategory = mode === 'active'
        ? (ACTIVE_CATEGORIES.indexOf(category) !== -1 ? category : 'other')
        : 'physical';
      var requires = isRecord(value.requires) ? value.requires : {};
      var equipmentTypes = cleanStringArray(requires.equipmentTypes);
      var cookwareTypes = cleanStringArray(requires.cookwareTypes);
      var location = ['kitchen', 'room', 'either'].indexOf(requires.locationPreference) !== -1
        ? requires.locationPreference
        : 'either';
      var outletCount = Math.round(Number(requires.outletCount || 0));

      if (!id || !batchId || !title || !mode || !category) {
        errors.push(validationError('invalid-action', 'в действии не заполнены обязательные поля', id));
      }
      if (actionIds[id]) errors.push(validationError('duplicate-action-id', 'идентификатор действия повторяется', id));
      actionIds[id] = true;
      if (!batchIds[batchId]) errors.push(validationError('unknown-batch', 'действие ссылается на неизвестную партию', id));
      if (!Number.isFinite(duration) || duration <= 0 || duration > 720) {
        errors.push(validationError('invalid-duration', 'длительность должна быть от 1 до 720 минут', id));
      }
      equipmentTypes.forEach(function (type) {
        if (!allowed.equipment[type]) errors.push(validationError('unknown-resource', 'неизвестный прибор: ' + type, id));
      });
      cookwareTypes.forEach(function (type) {
        if (!allowed.cookware[type]) errors.push(validationError('unknown-resource', 'неизвестная посуда: ' + type, id));
      });
      if (!Number.isInteger(outletCount) || outletCount < 0 || outletCount > 4) {
        errors.push(validationError('invalid-outlet-count', 'неверное число розеток', id));
      }

      actions.push({
        id: id,
        batchId: batchId,
        title: title,
        durationMinutes: Number.isFinite(duration) ? Math.round(duration * 10) / 10 : 0,
        mode: mode,
        category: normalizedCategory,
        dependsOn: cleanStringArray(value.dependsOn),
        interruptible: value.interruptible === true,
        readiness: typeof value.readiness === 'string' ? value.readiness.trim() : '',
        warning: typeof value.warning === 'string' ? value.warning.trim() : '',
        requires: {
          equipmentTypes: equipmentTypes,
          cookwareTypes: cookwareTypes,
          outletCount: outletCount,
          locationPreference: location
        }
      });
    });
    if (!actions.length) errors.push(validationError('missing-actions', 'в плане нет действий'));

    actions.forEach(function (action) {
      action.dependsOn.forEach(function (dependency) {
        if (!actionIds[dependency]) {
          errors.push(validationError('missing-dependency', 'не найдена зависимость: ' + dependency, action.id));
        }
      });
    });
    var cycle = findDependencyCycle(actions);
    if (cycle) errors.push(validationError('cyclic-dependency', 'зависимости образуют цикл: ' + cycle.join(' → ')));

    return {
      ok: errors.length === 0,
      value: errors.length === 0 ? { batches: batches, actions: actions } : null,
      errors: errors
    };
  }

  function instructionDuration(text, fallback) {
    var match = String(text || '').match(/(\d{1,3})\s*(?:мин|минут)/i);
    return match ? Math.max(1, Number(match[1])) : fallback;
  }

  function instructionMode(text) {
    return /(свар|отвар|вар[иь]|запек|запеч|потуш|туши|остуд|выпек|кипят|наста|разогре|довед.*готовност)/i.test(text)
      ? 'passive'
      : 'active';
  }

  function instructionRequirements(text) {
    var source = String(text || '').toLowerCase();
    var equipment = [];
    var cookware = [];
    if (/(свар|отвар|вар[иь]|кипят|довед.*готовност)/.test(source)) {
      equipment.push('burner');
      cookware.push('pot');
    } else if (/(запек|запеч|выпек)/.test(source)) {
      equipment.push('airFryer');
    } else if (/(потуш|туши)/.test(source)) {
      equipment.push('burner');
      cookware.push('deepPan');
    } else if (/(обжар|жар[иь]|сковород|приготов.*(?:яйц|куриц|индейк|говядин))/.test(source)) {
      equipment.push('burner');
      cookware.push('pan');
    } else if (/разогре/.test(source)) {
      equipment.push('microwave');
    } else if (/(измельч|взбей|смешай.*блендер)/.test(source)) {
      equipment.push('blender');
    }
    return {
      equipmentTypes: equipment,
      cookwareTypes: cookware,
      outletCount: equipment.length ? 1 : 0,
      locationPreference: equipment.indexOf('airFryer') !== -1 ? 'room' : 'kitchen'
    };
  }

  function buildFallbackActions(demand, profile) {
    var safeProfile = normalizeKitchenProfile(profile);
    var actions = [];
    var previousId = null;

    (demand && Array.isArray(demand.batches) ? demand.batches : []).forEach(function (batch) {
      if (!batch || batch.strategy === 'outside' || !batch.meal) return;
      var instructions = Array.isArray(batch.meal.instructions) && batch.meal.instructions.length
        ? batch.meal.instructions
        : ['приготовить ' + batch.title];
      var prep = isRecord(batch.meal.prepMinutes) ? Number(batch.meal.prepMinutes.max) : Number(batch.meal.prepMinutes);
      var activeBase = Number.isFinite(prep) && prep > 0 ? prep / instructions.length : 10;

      instructions.forEach(function (instruction, index) {
        var mode = instructionMode(instruction);
        var category = mode === 'active' ? 'prep' : 'physical';
        var factor = mode === 'active'
          ? safeProfile.calibration.factors[category] || safeProfile.calibration.defaultActiveFactor
          : 1;
        var duration = instructionDuration(instruction, activeBase);
        var id = batch.id + ':fallback-' + (index + 1);
        actions.push({
          id: id,
          batchId: batch.id,
          title: String(instruction),
          durationMinutes: Math.max(1, Math.ceil(duration * factor)),
          mode: mode,
          category: category,
          dependsOn: previousId ? [previousId] : [],
          interruptible: mode === 'active',
          readiness: '',
          warning: '',
          requires: instructionRequirements(instruction)
        });
        previousId = id;
      });

      if (batch.strategy === 'batch' && Number(batch.portions) > 1) {
        var portionId = batch.id + ':portion';
        actions.push({
          id: portionId,
          batchId: batch.id,
          title: 'разложить ' + batch.portions + ' порции по контейнерам',
          durationMinutes: Math.ceil(Math.max(5, Number(batch.portions) * 2) * (
            safeProfile.calibration.factors.portioning || safeProfile.calibration.defaultActiveFactor
          )),
          mode: 'active',
          category: 'portioning',
          dependsOn: previousId ? [previousId] : [],
          interruptible: true,
          readiness: '',
          warning: '',
          requires: {
            equipmentTypes: [],
            cookwareTypes: [],
            outletCount: 0,
            locationPreference: 'kitchen'
          }
        });
        previousId = portionId;
      }
    });
    return actions;
  }

  function numericTimestamp(value) {
    var number = Number(value);
    return Number.isFinite(number) && number >= 0 ? number : Date.now();
  }

  function startSession(plan, now) {
    var timestamp = numericTimestamp(now);
    var schedule = plan && Array.isArray(plan.schedule) ? plan.schedule : [];
    var actions = plan && Array.isArray(plan.actions) ? clone(plan.actions) : [];
    actions.forEach(function (action) {
      var entry = schedule.find(function (item) { return item.actionId === action.id; });
      if (!entry) return;
      action.assignedResources = {
        equipmentIds: cleanStringArray(entry.equipmentIds),
        cookwareIds: cleanStringArray(entry.cookwareIds),
        outletIds: cleanStringArray(entry.outletIds)
      };
    });
    var steps = {};
    actions.forEach(function (action) {
      steps[action.id] = {
        actionId: action.id,
        status: 'pending',
        plannedMinutes: Number(action.durationMinutes) || 0,
        mode: action.mode,
        category: action.category || 'other',
        actualMs: 0,
        lastStartedAt: null,
        completedAt: null,
        pauses: []
      };
    });
    return {
      version: 1,
      id: 'session-' + String(plan && plan.planHash || 'plan') + '-' + timestamp,
      planHash: String(plan && plan.planHash || ''),
      cycleId: String(plan && plan.cycleId || ''),
      week: Number(plan && plan.week) || 1,
      status: 'ready',
      createdAt: timestamp,
      startedAt: null,
      completedAt: null,
      actions: actions,
      steps: steps
    };
  }

  function sessionResult(ok, session, code, message) {
    var result = { ok: ok, session: session };
    if (!ok) result.error = { code: code, message: message };
    return result;
  }

  function sessionAction(session, actionId) {
    return (session.actions || []).find(function (action) { return action.id === actionId; }) || null;
  }

  function dependenciesResolved(session, action) {
    return (action.dependsOn || []).every(function (dependencyId) {
      var dependency = session.steps[dependencyId];
      return dependency && (dependency.status === 'done' || dependency.status === 'skipped');
    });
  }

  function actionResourceKeys(action) {
    var source = isRecord(action && action.assignedResources) ? action.assignedResources : action || {};
    return cleanStringArray(source.equipmentIds).map(function (id) { return 'equipment:' + id; })
      .concat(cleanStringArray(source.cookwareIds).map(function (id) { return 'cookware:' + id; }))
      .concat(cleanStringArray(source.outletIds).map(function (id) { return 'outlet:' + id; }));
  }

  function resourcesAvailable(session, action, orderedActions) {
    var requested = actionResourceKeys(action);
    if (!requested.length) return true;
    return !orderedActions.some(function (other) {
      var otherId = other.actionId || other.id;
      var step = session.steps[otherId];
      if (!step || (step.status !== 'running' && step.status !== 'paused')) return false;
      var actionId = action.actionId || action.id;
      if (otherId === actionId) return false;
      return actionResourceKeys(other).some(function (key) { return requested.indexOf(key) !== -1; });
    });
  }

  function nextSessionActionId(orderedActions, session) {
    var actions = Array.isArray(orderedActions) ? orderedActions : [];
    if (!session || !isRecord(session.steps)) return actions[0] && (actions[0].actionId || actions[0].id) || null;

    var active = actions.find(function (action) {
      var id = action.actionId || action.id;
      var step = session.steps[id];
      return step && step.mode === 'active' && (step.status === 'running' || step.status === 'paused');
    });
    if (active) return active.actionId || active.id;

    var available = actions.find(function (action) {
      var id = action.actionId || action.id;
      var step = session.steps[id];
      return step && step.status === 'pending' && dependenciesResolved(session, action) && resourcesAvailable(session, action, actions);
    });
    if (available) return available.actionId || available.id;

    var passive = actions.find(function (action) {
      var id = action.actionId || action.id;
      var step = session.steps[id];
      return step && step.mode === 'passive' && (step.status === 'running' || step.status === 'paused');
    });
    return passive ? passive.actionId || passive.id : null;
  }

  function accumulateRunningTime(step, timestamp) {
    if (Number.isFinite(step.lastStartedAt)) {
      step.actualMs += Math.max(0, timestamp - step.lastStartedAt);
      step.lastStartedAt = null;
    }
  }

  function startStep(inputSession, actionId, now) {
    var session = clone(inputSession);
    var action = sessionAction(session, actionId);
    var step = session.steps && session.steps[actionId];
    var timestamp = numericTimestamp(now);
    if (!action || !step) return sessionResult(false, session, 'unknown-step', 'шаг не найден');
    if (!dependenciesResolved(session, action)) {
      return sessionResult(false, session, 'blocked-dependency', 'сначала заверши зависимые шаги');
    }
    var anotherRunning = Object.keys(session.steps).some(function (id) {
      return id !== actionId && (session.steps[id].status === 'running' || session.steps[id].status === 'paused') && session.steps[id].mode === 'active';
    });
    if (action.mode === 'active' && anotherRunning) {
      return sessionResult(false, session, 'active-step-running', 'другое активное действие уже запущено');
    }
    if (!resourcesAvailable(session, action, session.actions || [])) {
      return sessionResult(false, session, 'resource-in-use', 'нужный прибор, посуда или розетка уже заняты');
    }
    if (step.status === 'done' || step.status === 'skipped') {
      return sessionResult(false, session, 'step-resolved', 'шаг уже завершён');
    }
    step.status = 'running';
    step.lastStartedAt = timestamp;
    if (session.startedAt === null) session.startedAt = timestamp;
    session.status = 'running';
    return sessionResult(true, session);
  }

  function pauseStep(inputSession, actionId, now) {
    var session = clone(inputSession);
    var step = session.steps && session.steps[actionId];
    var timestamp = numericTimestamp(now);
    if (!step || step.status !== 'running') return sessionResult(false, session, 'step-not-running', 'шаг не запущен');
    var startedAt = step.lastStartedAt;
    accumulateRunningTime(step, timestamp);
    step.pauses.push({ startedAt: startedAt, pausedAt: timestamp });
    step.status = 'paused';
    session.status = 'paused';
    return sessionResult(true, session);
  }

  function completeStep(inputSession, actionId, now) {
    var session = clone(inputSession);
    var step = session.steps && session.steps[actionId];
    var timestamp = numericTimestamp(now);
    if (!step || ['running', 'paused'].indexOf(step.status) === -1) {
      return sessionResult(false, session, 'step-not-started', 'сначала запусти шаг');
    }
    accumulateRunningTime(step, timestamp);
    step.status = 'done';
    step.completedAt = timestamp;
    var complete = Object.keys(session.steps).every(function (id) {
      return session.steps[id].status === 'done' || session.steps[id].status === 'skipped';
    });
    session.status = complete ? 'completed' : 'running';
    if (complete) session.completedAt = timestamp;
    return sessionResult(true, session);
  }

  function skipStep(inputSession, actionId, now) {
    var session = clone(inputSession);
    var step = session.steps && session.steps[actionId];
    var timestamp = numericTimestamp(now);
    if (!step || step.status === 'done' || step.status === 'skipped') {
      return sessionResult(false, session, 'step-resolved', 'шаг уже завершён');
    }
    accumulateRunningTime(step, timestamp);
    step.status = 'skipped';
    step.completedAt = timestamp;
    var complete = Object.keys(session.steps).every(function (id) {
      return session.steps[id].status === 'done' || session.steps[id].status === 'skipped';
    });
    session.status = complete ? 'completed' : session.status;
    if (complete) session.completedAt = timestamp;
    return sessionResult(true, session);
  }

  function setStepActualMinutes(inputSession, actionId, minutes) {
    var session = clone(inputSession);
    var step = session.steps && session.steps[actionId];
    var value = Number(minutes);
    if (!step || step.status !== 'done') return sessionResult(false, session, 'step-not-complete', 'можно исправить только завершённый шаг');
    if (!Number.isFinite(value) || value < 1 || value > 720) {
      return sessionResult(false, session, 'invalid-actual-time', 'фактическое время должно быть от 1 до 720 минут');
    }
    step.actualMs = Math.round(value * 60 * 1000);
    step.manualActualMinutes = value;
    return sessionResult(true, session);
  }

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function updateCalibration(profile, session) {
    var result = normalizeKitchenProfile(profile);
    if (!session || !isRecord(session.steps)) return result;
    Object.keys(session.steps).forEach(function (actionId) {
      var step = session.steps[actionId];
      if (!step || step.status !== 'done' || step.mode !== 'active') return;
      if (ACTIVE_CATEGORIES.indexOf(step.category) === -1) return;
      var actualMinutes = Number(step.actualMs) / 60000;
      var plannedMinutes = Number(step.plannedMinutes);
      if (!Number.isFinite(actualMinutes) || actualMinutes < 1 || actualMinutes > 720 || plannedMinutes <= 0) return;
      var current = result.calibration.factors[step.category] || result.calibration.defaultActiveFactor;
      var observed = clamp(current * actualMinutes / plannedMinutes, 0.75, 3);
      var next = clamp(current + (observed - current) * 0.25, 0.75, 3);
      result.calibration.factors[step.category] = Math.round(next * 1000) / 1000;
      result.calibration.observations[step.category] = (result.calibration.observations[step.category] || 0) + 1;
    });
    return result;
  }

  function applySessionCalibration(profile, inputSession, reuseBase) {
    var session = clone(inputSession);
    var current = normalizeKitchenProfile(profile);
    if (!reuseBase || !isRecord(session.calibrationBase)) {
      session.calibrationBase = clone(current.calibration);
    }
    current.calibration = clone(session.calibrationBase);
    current = normalizeKitchenProfile(current);
    var calibrated = updateCalibration(current, session);
    session.calibrationResult = clone(calibrated.calibration);
    return { profile: calibrated, session: session };
  }

  function applyCalibrationToActions(actions, profile) {
    var safe = normalizeKitchenProfile(profile);
    return (Array.isArray(actions) ? actions : []).map(function (action) {
      var copy = clone(action);
      if (copy.mode !== 'active') return copy;
      var factor = safe.calibration.factors[copy.category] || safe.calibration.defaultActiveFactor;
      copy.durationMinutes = Math.max(1, Math.ceil(Number(copy.durationMinutes) * factor));
      return copy;
    });
  }

  function resetCalibration(profile) {
    var result = normalizeKitchenProfile(profile);
    result.calibration.factors = {};
    result.calibration.observations = {};
    return result;
  }

  return {
    createDefaultKitchenProfile: createDefaultKitchenProfile,
    normalizeKitchenProfile: normalizeKitchenProfile,
    getActiveOutletPool: getActiveOutletPool,
    buildCookingDemand: buildCookingDemand,
    createPlanFingerprint: createPlanFingerprint,
    createEmptyCookingStore: createEmptyCookingStore,
    normalizeCookingStore: normalizeCookingStore,
    getCachedPlan: getCachedPlan,
    putCachedPlan: putCachedPlan,
    activeSessionForPlan: activeSessionForPlan,
    clearCachedPlans: clearCachedPlans,
    invalidateWeek: invalidateWeek,
    planCoversDemand: planCoversDemand,
    stableStringify: stableStringify,
    validateGeneratedPlan: validateGeneratedPlan,
    buildFallbackActions: buildFallbackActions,
    startSession: startSession,
    startStep: startStep,
    pauseStep: pauseStep,
    completeStep: completeStep,
    skipStep: skipStep,
    nextSessionActionId: nextSessionActionId,
    setStepActualMinutes: setStepActualMinutes,
    updateCalibration: updateCalibration,
    applySessionCalibration: applySessionCalibration,
    applyCalibrationToActions: applyCalibrationToActions,
    resetCalibration: resetCalibration
  };
});
