(function (root, factory) {
  'use strict';

  var core = typeof module === 'object' && module.exports
    ? require('./nutrition-cooking-core.js')
    : root && root.NutritionCookingCore;
  var api = factory(core);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.NutritionScheduler = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (CookingCore) {
  'use strict';

  function overlaps(left, right) {
    return left.startMinute < right.endMinute && right.startMinute < left.endMinute;
  }

  function uses(entry, key, id) {
    return Array.isArray(entry[key]) && entry[key].indexOf(id) !== -1;
  }

  function conflict(code, message, left, right, resourceId) {
    return {
      code: code,
      message: message,
      actionIds: [left.actionId, right.actionId],
      resourceId: resourceId || null
    };
  }

  function findResourceConflicts(schedule) {
    var entries = Array.isArray(schedule) ? schedule : [];
    var conflicts = [];
    for (var leftIndex = 0; leftIndex < entries.length; leftIndex++) {
      for (var rightIndex = leftIndex + 1; rightIndex < entries.length; rightIndex++) {
        var left = entries[leftIndex];
        var right = entries[rightIndex];
        if (!overlaps(left, right)) continue;
        if (left.userOccupied && right.userOccupied) {
          conflicts.push(conflict('user-conflict', 'активные действия пользователя пересекаются', left, right));
        }
        ['equipmentIds', 'cookwareIds', 'outletIds'].forEach(function (key) {
          (left[key] || []).forEach(function (id) {
            if (!uses(right, key, id)) return;
            var code = key === 'equipmentIds'
              ? 'equipment-conflict'
              : key === 'cookwareIds' ? 'cookware-conflict' : 'outlet-conflict';
            conflicts.push(conflict(code, 'ресурс занят двумя действиями', left, right, id));
          });
        });
      }
    }
    return conflicts;
  }

  function resourceAvailable(schedule, key, id, startMinute, endMinute) {
    return !(schedule || []).some(function (entry) {
      return uses(entry, key, id) && overlaps(entry, { startMinute: startMinute, endMinute: endMinute });
    });
  }

  function userAvailable(schedule, startMinute, endMinute) {
    return !(schedule || []).some(function (entry) {
      return entry.userOccupied && overlaps(entry, { startMinute: startMinute, endMinute: endMinute });
    });
  }

  function resourceMatchesType(resource, requiredType, kind) {
    if (resource.kind !== kind) return false;
    if (resource.type === requiredType) return true;
    if (kind !== 'cookware') return false;
    return (requiredType === 'pot' && resource.type === 'smallPot') ||
      (requiredType === 'pan' && resource.type === 'deepPan');
  }

  function resourcesByType(profile, type, kind) {
    return profile.resources.filter(function (item) {
      return resourceMatchesType(item, type, kind);
    });
  }

  function movableResource(resource) {
    return resource && (resource.type === 'airFryer' || resource.type === 'multicooker');
  }

  function resourceCanUseLocation(resource, location) {
    if (!resource || resource.kind === 'cookware') return true;
    return movableResource(resource) || resource.preferredLocation === location;
  }

  function locationOrder(action, profile) {
    var preferred = action.requires.locationPreference;
    var mode = profile.modes[profile.activeMode];
    var hasRoom = mode.roomOutlets > 0;
    if (preferred === 'room') return hasRoom ? ['room', 'kitchen'] : ['kitchen'];
    if (preferred === 'kitchen') return hasRoom ? ['kitchen', 'room'] : ['kitchen'];
    var firstType = action.requires.equipmentTypes[0];
    var configured = mode.preferredLocations && mode.preferredLocations[firstType];
    if (configured === 'room' && hasRoom) return ['room', 'kitchen'];
    return hasRoom ? ['kitchen', 'room'] : ['kitchen'];
  }

  function chooseTypedResources(schedule, profile, types, kind, key, location, startMinute, endMinute) {
    var selected = [];
    for (var typeIndex = 0; typeIndex < types.length; typeIndex++) {
      var candidates = resourcesByType(profile, types[typeIndex], kind).filter(function (resource) {
        return resourceCanUseLocation(resource, location) &&
          selected.indexOf(resource.id) === -1 &&
          resourceAvailable(schedule, key, resource.id, startMinute, endMinute);
      });
      if (!candidates.length) return null;
      selected.push(candidates[0].id);
    }
    return selected;
  }

  function chooseOutlets(schedule, profile, location, count, startMinute, endMinute) {
    if (!count) return [];
    var available = CookingCore.getActiveOutletPool(profile).filter(function (outlet) {
      return outlet.location === location && resourceAvailable(
        schedule,
        'outletIds',
        outlet.id,
        startMinute,
        endMinute
      );
    });
    return available.length >= count ? available.slice(0, count).map(function (item) { return item.id; }) : null;
  }

  function equipmentOutletCount(profile, equipmentIds) {
    return equipmentIds.reduce(function (count, id) {
      var resource = profile.resources.find(function (item) { return item.id === id; });
      return count + (resource && resource.requiresOutlet ? 1 : 0);
    }, 0);
  }

  function tryAssignment(action, profile, schedule, startMinute) {
    var duration = Math.max(1, Math.ceil(Number(action.durationMinutes)));
    var endMinute = startMinute + duration;
    if (action.mode === 'active' && !userAvailable(schedule, startMinute, endMinute)) return null;

    var locations = locationOrder(action, profile);
    for (var locationIndex = 0; locationIndex < locations.length; locationIndex++) {
      var location = locations[locationIndex];
      var equipmentIds = chooseTypedResources(
        schedule,
        profile,
        action.requires.equipmentTypes,
        'equipment',
        'equipmentIds',
        location,
        startMinute,
        endMinute
      );
      if (!equipmentIds) continue;
      var cookwareIds = chooseTypedResources(
        schedule,
        profile,
        action.requires.cookwareTypes,
        'cookware',
        'cookwareIds',
        location,
        startMinute,
        endMinute
      );
      if (!cookwareIds) continue;
      var outletCount = Math.max(
        Number(action.requires.outletCount) || 0,
        equipmentOutletCount(profile, equipmentIds)
      );
      var outletIds = chooseOutlets(schedule, profile, location, outletCount, startMinute, endMinute);
      if (!outletIds) continue;
      return {
        actionId: action.id,
        batchId: action.batchId,
        title: action.title,
        mode: action.mode,
        category: action.category,
        startMinute: startMinute,
        endMinute: endMinute,
        durationMinutes: duration,
        userOccupied: action.mode === 'active',
        equipmentIds: equipmentIds,
        cookwareIds: cookwareIds,
        outletIds: outletIds,
        location: location,
        dependsOn: action.dependsOn.slice()
      };
    }
    return null;
  }

  function dependencyEnd(action, byActionId) {
    return action.dependsOn.reduce(function (latest, dependencyId) {
      var dependency = byActionId[dependencyId];
      return dependency ? Math.max(latest, dependency.endMinute) : latest;
    }, 0);
  }

  function validateActions(actions) {
    var errors = [];
    var ids = {};
    (actions || []).forEach(function (action) {
      if (!action || typeof action.id !== 'string' || !action.id) {
        errors.push({ code: 'invalid-action', message: 'действие не имеет идентификатора' });
        return;
      }
      if (ids[action.id]) errors.push({ code: 'duplicate-action-id', message: 'идентификатор действия повторяется' });
      ids[action.id] = true;
      if (!Number.isFinite(Number(action.durationMinutes)) || Number(action.durationMinutes) <= 0) {
        errors.push({ code: 'invalid-duration', message: 'длительность действия должна быть положительной' });
      }
    });
    (actions || []).forEach(function (action) {
      (action && action.dependsOn || []).forEach(function (dependency) {
        if (!ids[dependency]) errors.push({ code: 'missing-dependency', message: 'не найдена зависимость ' + dependency });
      });
    });
    return errors;
  }

  function peakOutletUsage(schedule) {
    var events = [];
    schedule.forEach(function (entry) {
      if (!entry.outletIds.length) return;
      events.push({ minute: entry.startMinute, delta: entry.outletIds.length });
      events.push({ minute: entry.endMinute, delta: -entry.outletIds.length });
    });
    events.sort(function (left, right) {
      return left.minute - right.minute || left.delta - right.delta;
    });
    var current = 0;
    var peak = 0;
    events.forEach(function (event) {
      current += event.delta;
      peak = Math.max(peak, current);
    });
    return peak;
  }

  function scheduleActions(inputActions, inputProfile) {
    var profile = CookingCore.normalizeKitchenProfile(inputProfile);
    var actions = Array.isArray(inputActions) ? inputActions.map(function (action) {
      return {
        id: action.id,
        batchId: action.batchId,
        title: action.title,
        durationMinutes: Number(action.durationMinutes),
        mode: action.mode === 'passive' ? 'passive' : 'active',
        category: action.category || 'other',
        dependsOn: Array.isArray(action.dependsOn) ? action.dependsOn.slice() : [],
        requires: {
          equipmentTypes: action.requires && Array.isArray(action.requires.equipmentTypes) ? action.requires.equipmentTypes.slice() : [],
          cookwareTypes: action.requires && Array.isArray(action.requires.cookwareTypes) ? action.requires.cookwareTypes.slice() : [],
          outletCount: action.requires ? Number(action.requires.outletCount) || 0 : 0,
          locationPreference: action.requires && action.requires.locationPreference || 'either'
        }
      };
    }) : [];
    var errors = validateActions(actions);
    if (errors.length) return { ok: false, errors: errors, schedule: [], estimate: null, peakOutlets: 0, warnings: [] };

    var remaining = actions.slice().sort(function (left, right) { return left.id.localeCompare(right.id); });
    var schedule = [];
    var byActionId = {};
    var warnings = [];

    while (remaining.length) {
      var ready = remaining.filter(function (action) {
        return action.dependsOn.every(function (dependency) { return Boolean(byActionId[dependency]); });
      });
      if (!ready.length) {
        return {
          ok: false,
          errors: [{ code: 'cyclic-dependency', message: 'зависимости действий образуют цикл' }],
          schedule: [], estimate: null, peakOutlets: 0, warnings: warnings
        };
      }

      var action = ready[0];
      var earliest = dependencyEnd(action, byActionId);
      var assignment = null;
      for (var minute = earliest; minute <= 10000 && !assignment; minute++) {
        assignment = tryAssignment(action, profile, schedule, minute);
      }
      if (!assignment) {
        return {
          ok: false,
          errors: [{ code: 'resource-unavailable', message: 'не удалось назначить ресурсы для действия ' + action.title }],
          schedule: [], estimate: null, peakOutlets: 0, warnings: warnings
        };
      }
      schedule.push(assignment);
      byActionId[action.id] = assignment;
      remaining = remaining.filter(function (item) { return item.id !== action.id; });
    }

    schedule.sort(function (left, right) {
      return left.startMinute - right.startMinute || left.actionId.localeCompare(right.actionId);
    });
    var conflicts = findResourceConflicts(schedule);
    if (conflicts.length) {
      return { ok: false, errors: conflicts, schedule: [], estimate: null, peakOutlets: 0, warnings: warnings };
    }
    var minimum = schedule.reduce(function (latest, entry) { return Math.max(latest, entry.endMinute); }, 0);
    return {
      ok: true,
      errors: [],
      schedule: schedule,
      estimate: {
        minMinutes: minimum,
        maxMinutes: minimum ? Math.ceil(minimum * 1.15 + 10) : 0
      },
      peakOutlets: peakOutletUsage(schedule),
      warnings: warnings
    };
  }

  return {
    scheduleActions: scheduleActions,
    findResourceConflicts: findResourceConflicts
  };
});
