(function(root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.GoalsCore = api;
})(typeof window !== 'undefined' ? window : null, function() {
  'use strict';

  var TIME_ZONE = 'Asia/Yekaterinburg';
  var FIVE_YEAR_ANCHOR = 2026;
  var HORIZONS = ['week', 'month', 'quarter', 'year', '5year', 'life'];
  var PRIORITIES = ['p1', 'p2', 'p3', 'p4'];
  var MONTHS_NOMINATIVE = [
    'Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь',
    'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'
  ];
  var MONTHS_GENITIVE = [
    'января', 'февраля', 'марта', 'апреля', 'мая', 'июня',
    'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'
  ];

  function pad2(value) {
    return String(value).padStart(2, '0');
  }

  function formatDateKey(date) {
    return date.getUTCFullYear() + '-' + pad2(date.getUTCMonth() + 1) + '-' + pad2(date.getUTCDate());
  }

  function datePartsInYekaterinburg(now) {
    var date = now instanceof Date ? now : new Date(now || Date.now());
    if (!Number.isFinite(date.getTime())) date = new Date();
    var parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: TIME_ZONE,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    }).formatToParts(date);
    var values = {};
    parts.forEach(function(part) {
      if (part.type !== 'literal') values[part.type] = Number(part.value);
    });
    return {
      year: values.year,
      month: values.month,
      day: values.day
    };
  }

  function calendarDate(parts) {
    return new Date(Date.UTC(parts.year, parts.month - 1, parts.day));
  }

  function fiveYearStart(year) {
    return FIVE_YEAR_ANCHOR + Math.floor((year - FIVE_YEAR_ANCHOR) / 5) * 5;
  }

  function currentPeriodKey(horizon, now) {
    var parts = datePartsInYekaterinburg(now || new Date());
    var date;
    var mondayOffset;

    if (horizon === 'life') return 'life';
    if (horizon === 'month') return parts.year + '-' + pad2(parts.month);
    if (horizon === 'quarter') return parts.year + '-Q' + (Math.floor((parts.month - 1) / 3) + 1);
    if (horizon === 'year') return String(parts.year);
    if (horizon === '5year') return String(fiveYearStart(parts.year));
    if (horizon !== 'week') return null;

    date = calendarDate(parts);
    mondayOffset = (date.getUTCDay() + 6) % 7;
    date.setUTCDate(date.getUTCDate() - mondayOffset);
    return formatDateKey(date);
  }

  function parseDateKey(value) {
    var match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || ''));
    if (!match) return null;
    var date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
    if (formatDateKey(date) !== match[0]) return null;
    return date;
  }

  function isValidPeriodKey(horizon, periodKey) {
    var match;
    var date;
    if (horizon === 'life') return periodKey === 'life';
    if (horizon === 'week') {
      date = parseDateKey(periodKey);
      return !!date && date.getUTCDay() === 1;
    }
    if (horizon === 'month') {
      match = /^(\d{4})-(\d{2})$/.exec(String(periodKey || ''));
      return !!match && Number(match[2]) >= 1 && Number(match[2]) <= 12;
    }
    if (horizon === 'quarter') return /^\d{4}-Q[1-4]$/.test(String(periodKey || ''));
    if (horizon === 'year') return /^\d{4}$/.test(String(periodKey || ''));
    if (horizon === '5year') {
      if (!/^\d{4}$/.test(String(periodKey || ''))) return false;
      return (Number(periodKey) - FIVE_YEAR_ANCHOR) % 5 === 0;
    }
    return false;
  }

  function shiftPeriodKey(horizon, periodKey, delta) {
    var amount = Number.isFinite(Number(delta)) ? Math.trunc(Number(delta)) : 0;
    var match;
    var date;
    var total;
    var year;
    var quarterIndex;
    if (!isValidPeriodKey(horizon, periodKey)) return null;
    if (horizon === 'life') return 'life';
    if (horizon === 'week') {
      date = parseDateKey(periodKey);
      date.setUTCDate(date.getUTCDate() + amount * 7);
      return formatDateKey(date);
    }
    if (horizon === 'month') {
      match = /^(\d{4})-(\d{2})$/.exec(periodKey);
      date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1 + amount, 1));
      return date.getUTCFullYear() + '-' + pad2(date.getUTCMonth() + 1);
    }
    if (horizon === 'quarter') {
      match = /^(\d{4})-Q([1-4])$/.exec(periodKey);
      total = Number(match[1]) * 4 + Number(match[2]) - 1 + amount;
      year = Math.floor(total / 4);
      quarterIndex = ((total % 4) + 4) % 4;
      return year + '-Q' + (quarterIndex + 1);
    }
    if (horizon === 'year') return String(Number(periodKey) + amount);
    if (horizon === '5year') return String(Number(periodKey) + amount * 5);
    return null;
  }

  function formatPeriodLabel(horizon, periodKey) {
    var match;
    var start;
    var end;
    var startDay;
    var endDay;
    if (!isValidPeriodKey(horizon, periodKey)) return '';
    if (horizon === 'life') return 'Вся жизнь';
    if (horizon === 'month') {
      match = /^(\d{4})-(\d{2})$/.exec(periodKey);
      return MONTHS_NOMINATIVE[Number(match[2]) - 1] + ' ' + match[1];
    }
    if (horizon === 'quarter') {
      match = /^(\d{4})-Q([1-4])$/.exec(periodKey);
      return Number(match[2]) + ' квартал ' + match[1];
    }
    if (horizon === 'year') return periodKey + ' год';
    if (horizon === '5year') return periodKey + '–' + (Number(periodKey) + 4);

    start = parseDateKey(periodKey);
    end = new Date(start.getTime());
    end.setUTCDate(end.getUTCDate() + 6);
    startDay = start.getUTCDate();
    endDay = end.getUTCDate();
    if (start.getUTCFullYear() === end.getUTCFullYear() && start.getUTCMonth() === end.getUTCMonth()) {
      return startDay + '–' + endDay + ' ' + MONTHS_GENITIVE[end.getUTCMonth()] + ' ' + end.getUTCFullYear();
    }
    if (start.getUTCFullYear() === end.getUTCFullYear()) {
      return startDay + ' ' + MONTHS_GENITIVE[start.getUTCMonth()] + ' – ' + endDay + ' ' + MONTHS_GENITIVE[end.getUTCMonth()] + ' ' + end.getUTCFullYear();
    }
    return startDay + ' ' + MONTHS_GENITIVE[start.getUTCMonth()] + ' ' + start.getUTCFullYear() + ' – ' + endDay + ' ' + MONTHS_GENITIVE[end.getUTCMonth()] + ' ' + end.getUTCFullYear();
  }

  function normalizeHorizon(value) {
    return HORIZONS.includes(value) ? value : 'year';
  }

  function normalizePriority(value) {
    return PRIORITIES.includes(value) ? value : 'p3';
  }

  function groupKey(goal) {
    return goal.horizon + '\u0000' + goal.periodKey + '\u0000' + goal.priority;
  }

  function normalizeData(input, now) {
    var source = input && typeof input === 'object' ? input : {};
    var sourceGoals = Array.isArray(source.goals) ? source.goals : [];
    var goals = sourceGoals.map(function(rawGoal) {
      var goal = rawGoal && typeof rawGoal === 'object' ? Object.assign({}, rawGoal) : {};
      goal.horizon = normalizeHorizon(goal.horizon);
      goal.periodKey = isValidPeriodKey(goal.horizon, goal.periodKey)
        ? goal.periodKey
        : currentPeriodKey(goal.horizon, now || new Date());
      goal.priority = normalizePriority(goal.priority);
      return goal;
    });
    var groups = new Map();

    goals.forEach(function(goal) {
      var key = groupKey(goal);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(goal);
    });

    groups.forEach(function(group) {
      var seen = new Set();
      var valid = group.every(function(goal) {
        var order = Number(goal.order);
        if (!Number.isFinite(order) || order <= 0 || seen.has(order)) return false;
        seen.add(order);
        return true;
      });
      if (!valid) {
        group.forEach(function(goal, index) {
          goal.order = (index + 1) * 100;
        });
      } else {
        group.forEach(function(goal) {
          goal.order = Number(goal.order);
        });
      }
    });

    return {
      schemaVersion: 3,
      goals: goals
    };
  }

  function priorityRank(priority) {
    var index = PRIORITIES.indexOf(priority);
    return index === -1 ? PRIORITIES.indexOf('p3') : index;
  }

  function sortGoals(goals) {
    return (Array.isArray(goals) ? goals : []).slice().sort(function(left, right) {
      var doneDifference = Number(left.done === true) - Number(right.done === true);
      if (doneDifference) return doneDifference;
      var priorityDifference = priorityRank(left.priority) - priorityRank(right.priority);
      if (priorityDifference) return priorityDifference;
      var orderDifference = Number(left.order || 0) - Number(right.order || 0);
      if (orderDifference) return orderDifference;
      return String(left.id || '').localeCompare(String(right.id || ''), 'ru');
    });
  }

  function membersOfGroup(goals, key, excludedId) {
    return goals
      .map(function(goal, index) { return { goal: goal, index: index }; })
      .filter(function(item) { return item.goal.id !== excludedId && groupKey(item.goal) === key; })
      .sort(function(left, right) {
        var difference = Number(left.goal.order || 0) - Number(right.goal.order || 0);
        return difference || left.index - right.index;
      })
      .map(function(item) { return item.goal; });
  }

  function assignOrders(goals) {
    goals.forEach(function(goal, index) {
      goal.order = (index + 1) * 100;
    });
  }

  function moveGoal(data, command) {
    if (!command || typeof command !== 'object' || !command.goalId) {
      return { ok: false, error: 'INVALID_TARGET' };
    }
    var source = data && typeof data === 'object' ? data : { goals: [] };
    var goals = Array.isArray(source.goals) ? source.goals.map(function(goal) {
      return Object.assign({}, goal);
    }) : [];
    var moved = goals.find(function(goal) { return goal.id === command.goalId; });
    if (!moved) return { ok: false, error: 'GOAL_NOT_FOUND' };
    if (moved.done === true) return { ok: false, error: 'GOAL_COMPLETED' };
    if (!isValidPeriodKey(moved.horizon, command.targetPeriodKey)) {
      return { ok: false, error: 'INVALID_PERIOD' };
    }
    var targetPriority = command.targetPriority === undefined
      ? normalizePriority(moved.priority)
      : command.targetPriority;
    if (!PRIORITIES.includes(targetPriority)) return { ok: false, error: 'INVALID_TARGET' };

    var sourceKey = groupKey(moved);
    var targetKey = moved.horizon + '\u0000' + command.targetPeriodKey + '\u0000' + targetPriority;
    var beforeGoal = null;
    if (command.beforeGoalId !== undefined && command.beforeGoalId !== null) {
      beforeGoal = goals.find(function(goal) { return goal.id === command.beforeGoalId; });
      if (!beforeGoal || beforeGoal.id === moved.id || beforeGoal.done === true || groupKey(beforeGoal) !== targetKey) {
        return { ok: false, error: 'INVALID_TARGET' };
      }
    }

    var sourceMembers = membersOfGroup(goals, sourceKey, moved.id);
    moved.periodKey = command.targetPeriodKey;
    moved.priority = targetPriority;
    var targetMembers = sourceKey === targetKey
      ? sourceMembers.slice()
      : membersOfGroup(goals, targetKey, moved.id);
    var insertAt = beforeGoal
      ? targetMembers.findIndex(function(goal) { return goal.id === beforeGoal.id; })
      : targetMembers.length;
    if (insertAt < 0) return { ok: false, error: 'INVALID_TARGET' };
    targetMembers.splice(insertAt, 0, moved);

    if (sourceKey !== targetKey) assignOrders(sourceMembers);
    assignOrders(targetMembers);

    return {
      ok: true,
      data: Object.assign({}, source, {
        schemaVersion: 3,
        goals: goals
      })
    };
  }

  return Object.freeze({
    currentPeriodKey: currentPeriodKey,
    shiftPeriodKey: shiftPeriodKey,
    formatPeriodLabel: formatPeriodLabel,
    normalizeData: normalizeData,
    sortGoals: sortGoals,
    moveGoal: moveGoal
  });
});
