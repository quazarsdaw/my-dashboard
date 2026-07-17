(function (root, factory) {
  'use strict';

  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.NutritionCore = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var MEAL_TYPES = ['breakfast', 'lunch', 'dinner', 'extra'];
  var MAIN_SLOTS = ['breakfast', 'lunch', 'dinner'];

  function isRecord(value) {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
  }

  function clone(value) {
    if (value === undefined) return undefined;
    return JSON.parse(JSON.stringify(value));
  }

  function normalizeLocalDate(value) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
    var parts = value.split('-').map(Number);
    var date = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2]));
    if (
      date.getUTCFullYear() !== parts[0] ||
      date.getUTCMonth() !== parts[1] - 1 ||
      date.getUTCDate() !== parts[2]
    ) return null;
    return value;
  }

  function getLocalDateKey(date) {
    var source = date instanceof Date ? date : new Date();
    var year = source.getFullYear();
    var month = String(source.getMonth() + 1).padStart(2, '0');
    var day = String(source.getDate()).padStart(2, '0');
    return year + '-' + month + '-' + day;
  }

  function dateKeyToUtc(value) {
    var safe = normalizeLocalDate(value);
    if (!safe) return null;
    var parts = safe.split('-').map(Number);
    return Date.UTC(parts[0], parts[1] - 1, parts[2]);
  }

  function getCycleDay(startDate, currentDate) {
    var start = dateKeyToUtc(startDate);
    var current = dateKeyToUtc(currentDate);
    if (start === null || current === null) return null;
    var daysElapsed = Math.round((current - start) / 86400000);
    return {
      dayNumber: Math.min(14, Math.max(1, daysElapsed + 1)),
      daysElapsed: daysElapsed,
      completed: daysElapsed >= 14,
      beforeStart: daysElapsed < 0
    };
  }

  function normalizeRange(value) {
    var min;
    var max;
    if (typeof value === 'number' && Number.isFinite(value)) {
      min = value;
      max = value;
    } else if (isRecord(value)) {
      min = Number(value.min);
      max = Number(value.max);
    }
    if (!Number.isFinite(min) || !Number.isFinite(max)) return { min: 0, max: 0 };
    return min <= max ? { min: min, max: max } : { min: max, max: min };
  }

  function normalizeIngredient(value) {
    if (!isRecord(value)) return null;
    var id = typeof value.id === 'string' ? value.id.trim() : '';
    var name = typeof value.name === 'string' ? value.name.trim() : '';
    var unit = typeof value.unit === 'string' ? value.unit.trim() : '';
    var category = typeof value.category === 'string' ? value.category.trim() : '';
    var amount = Number(value.amount);
    if (!id || !name || !unit || !category || !Number.isFinite(amount) || amount <= 0) return null;
    return { id: id, name: name, amount: amount, unit: unit, category: category };
  }

  function validateMeal(value) {
    if (!isRecord(value)) return { ok: false, errors: ['блюдо должно быть объектом'] };
    var errors = [];
    var id = typeof value.id === 'string' ? value.id.trim() : '';
    var title = typeof value.title === 'string' ? value.title.trim() : '';
    var mealType = typeof value.mealType === 'string' ? value.mealType.trim() : '';
    if (!/^[a-z0-9][a-z0-9_-]{2,79}$/.test(id)) errors.push('неверный идентификатор');
    if (!title) errors.push('нет названия');
    if (MEAL_TYPES.indexOf(mealType) === -1) errors.push('неверный тип приёма пищи');

    var ingredients = Array.isArray(value.ingredients)
      ? value.ingredients.map(normalizeIngredient).filter(Boolean)
      : [];
    if (!ingredients.length || ingredients.length !== (value.ingredients || []).length) {
      errors.push('неверные ингредиенты');
    }

    var instructions = Array.isArray(value.instructions)
      ? value.instructions.map(function (item) { return String(item || '').trim(); }).filter(Boolean)
      : [];
    if (!instructions.length) errors.push('нет инструкции');
    if (errors.length) return { ok: false, errors: errors };

    return {
      ok: true,
      meal: {
        id: id,
        source: value.source === 'seed' ? 'seed' : 'imported',
        mealType: mealType,
        title: title,
        tags: Array.isArray(value.tags)
          ? value.tags.map(function (item) { return String(item || '').trim(); }).filter(Boolean)
          : [],
        prepMinutes: normalizeRange(value.prepMinutes),
        caloriesApprox: normalizeRange(value.caloriesApprox),
        proteinApprox: normalizeRange(value.proteinApprox),
        estimatedCostRub: normalizeRange(value.estimatedCostRub),
        ingredients: ingredients,
        instructions: instructions,
        notes: typeof value.notes === 'string' ? value.notes.trim() : ''
      }
    };
  }

  function validateImportedCatalog(payload, seedMeals, existingMeals) {
    if (!isRecord(payload) || payload.version !== 1 || !Array.isArray(payload.meals)) {
      return {
        ok: false,
        code: 'invalid-payload',
        meals: [],
        skipped: 0,
        errors: [{ code: 'invalid-payload', message: 'ожидается объект версии 1 со списком meals' }]
      };
    }

    var usedIds = new Set();
    (seedMeals || []).concat(existingMeals || []).forEach(function (item) {
      if (item && item.id) usedIds.add(item.id);
    });
    var accepted = [];
    var errors = [];

    payload.meals.forEach(function (value, index) {
      var checked = validateMeal(value);
      if (!checked.ok) {
        errors.push({ code: 'invalid-meal', index: index, message: checked.errors.join(', ') });
        return;
      }
      if (usedIds.has(checked.meal.id)) {
        errors.push({ code: 'duplicate-id', index: index, id: checked.meal.id, message: 'идентификатор уже существует' });
        return;
      }
      checked.meal.source = 'imported';
      usedIds.add(checked.meal.id);
      accepted.push(checked.meal);
    });

    return { ok: true, meals: accepted, skipped: errors.length, errors: errors };
  }

  function mergeCatalog(seedMeals, importedMeals) {
    var result = (seedMeals || []).slice();
    var usedIds = new Set(result.map(function (item) { return item.id; }));
    (importedMeals || []).forEach(function (item) {
      if (!item || !item.id || usedIds.has(item.id)) return;
      usedIds.add(item.id);
      result.push(item);
    });
    return result;
  }

  function createCycleId(startDate) {
    return 'cycle-' + startDate + '-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 7);
  }

  function createDefaultState(todayKey) {
    var startDate = normalizeLocalDate(todayKey) || getLocalDateKey();
    return {
      version: 1,
      activeCycle: { id: createCycleId(startDate), startDate: startDate, templateId: 'plan-14-v1' },
      overrides: {},
      completions: {},
      notes: {},
      trainingDays: {},
      trainingExtras: {},
      shoppingChecks: {},
      ingredientPrices: {},
      cookingChecks: {},
      history: []
    };
  }

  function normalizeDictionary(value) {
    return isRecord(value) ? clone(value) : {};
  }

  function normalizePriceBook(value) {
    var result = {};
    if (!isRecord(value)) return result;
    Object.keys(value).forEach(function (key) {
      var price = value[key];
      if (typeof price === 'number' && Number.isFinite(price) && price >= 0) result[key] = price;
    });
    return result;
  }

  function resolvePriceBook(legacyPrices, storedPriceBook) {
    if (!isRecord(storedPriceBook) || storedPriceBook.version !== 1 || !isRecord(storedPriceBook.prices)) {
      return normalizePriceBook(legacyPrices);
    }
    return normalizePriceBook(storedPriceBook.prices);
  }

  function normalizeState(rawState, todayKey) {
    var fallback = createDefaultState(todayKey);
    if (!isRecord(rawState)) return fallback;
    var cycle = isRecord(rawState.activeCycle) ? rawState.activeCycle : {};
    var startDate = normalizeLocalDate(cycle.startDate) || fallback.activeCycle.startDate;
    return {
      version: 1,
      activeCycle: {
        id: typeof cycle.id === 'string' && cycle.id ? cycle.id : createCycleId(startDate),
        startDate: startDate,
        templateId: typeof cycle.templateId === 'string' && cycle.templateId ? cycle.templateId : 'plan-14-v1'
      },
      overrides: normalizeDictionary(rawState.overrides),
      completions: normalizeDictionary(rawState.completions),
      notes: normalizeDictionary(rawState.notes),
      trainingDays: normalizeDictionary(rawState.trainingDays),
      trainingExtras: normalizeDictionary(rawState.trainingExtras),
      shoppingChecks: normalizeDictionary(rawState.shoppingChecks),
      ingredientPrices: normalizePriceBook(rawState.ingredientPrices),
      cookingChecks: normalizeDictionary(rawState.cookingChecks),
      history: Array.isArray(rawState.history) ? clone(rawState.history) : []
    };
  }

  function catalogMap(catalog) {
    var map = {};
    (catalog || []).forEach(function (item) {
      if (item && item.id && !map[item.id]) map[item.id] = item;
    });
    return map;
  }

  function findTemplateDay(template, dayNumber) {
    if (!template || !Array.isArray(template.days)) return null;
    return template.days.find(function (item) { return Number(item.day) === Number(dayNumber); }) || null;
  }

  function resolveMealId(template, state, dayNumber, slot) {
    var day = findTemplateDay(template, dayNumber);
    if (!day || !day.meals) return null;
    var baseId = day.meals[slot] || null;
    var cycleId = state && state.activeCycle ? state.activeCycle.id : '';
    var overrideKey = cycleId + ':' + dayNumber + ':' + slot;
    return state && state.overrides && state.overrides[overrideKey] || baseId;
  }

  function resolveDayPlan(template, state, dayNumber, catalog) {
    var day = findTemplateDay(template, dayNumber);
    var byId = catalogMap(catalog);
    var resolved = {};
    MAIN_SLOTS.forEach(function (slot) {
      var baseId = day && day.meals ? day.meals[slot] : null;
      var selectedId = resolveMealId(template, state, dayNumber, slot);
      resolved[slot] = byId[selectedId] || byId[baseId] || null;
    });
    return { dayNumber: Number(dayNumber), meals: resolved };
  }

  function addRange(total, value) {
    var safe = normalizeRange(value);
    total.min += safe.min;
    total.max += safe.max;
  }

  function calculateDaySummary(dayPlan, catalog, trainingExtra) {
    var byId = catalogMap(catalog);
    var meals = [];
    if (dayPlan && isRecord(dayPlan.meals)) {
      MAIN_SLOTS.forEach(function (slot) {
        var value = dayPlan.meals[slot];
        var resolved = typeof value === 'string' ? byId[value] : value;
        if (resolved) meals.push(resolved);
      });
    }
    if (trainingExtra) meals.push(typeof trainingExtra === 'string' ? byId[trainingExtra] : trainingExtra);

    var summary = {
      caloriesApprox: { min: 0, max: 0 },
      proteinApprox: { min: 0, max: 0 },
      estimatedCostRub: { min: 0, max: 0 }
    };
    meals.forEach(function (item) {
      addRange(summary.caloriesApprox, item.caloriesApprox);
      addRange(summary.proteinApprox, item.proteinApprox);
      addRange(summary.estimatedCostRub, item.estimatedCostRub);
    });
    return summary;
  }

  function buildShoppingList(template, state, catalog, weekNumber) {
    var week = Number(weekNumber) === 2 ? 2 : 1;
    var minDay = week === 1 ? 1 : 8;
    var maxDay = week === 1 ? 7 : 14;
    var grouped = {};

    (template && Array.isArray(template.days) ? template.days : []).forEach(function (day) {
      if (day.day < minDay || day.day > maxDay) return;
      var plan = resolveDayPlan(template, state, day.day, catalog);
      MAIN_SLOTS.forEach(function (slot) {
        var selected = plan.meals[slot];
        if (!selected || !Array.isArray(selected.ingredients)) return;
        if (Array.isArray(selected.tags) && selected.tags.indexOf('вне дома') !== -1) return;
        selected.ingredients.forEach(function (item) {
          var key = item.id + '::' + item.unit;
          if (!grouped[key]) {
            grouped[key] = {
              id: item.id,
              name: item.name,
              amount: 0,
              unit: item.unit,
              category: item.category
            };
          }
          grouped[key].amount += Number(item.amount) || 0;
        });
      });
    });

    return Object.keys(grouped).map(function (key) { return grouped[key]; }).sort(function (a, b) {
      return a.category.localeCompare(b.category, 'ru') || a.name.localeCompare(b.name, 'ru');
    });
  }

  function priceKey(item) {
    return item.id + '::' + item.unit;
  }

  function priceBasis(unit) {
    if (unit === 'г') return { amount: 1000, label: '₽/кг' };
    if (unit === 'мл') return { amount: 1000, label: '₽/л' };
    return { amount: 1, label: '₽/' + unit };
  }

  function validPrice(book, key) {
    if (!isRecord(book) || !Object.prototype.hasOwnProperty.call(book, key)) return null;
    var value = book[key];
    return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
  }

  function priceShoppingItems(items, priceBook, defaultPrices) {
    return (items || []).map(function (item) {
      var key = priceKey(item);
      var savedPrice = validPrice(priceBook, key);
      var fallbackPrice = validPrice(defaultPrices, key);
      var unitPrice = savedPrice !== null ? savedPrice : fallbackPrice;
      var basis = priceBasis(item.unit);
      return Object.assign({}, item, {
        priceKey: key,
        priceLabel: basis.label,
        unitPriceRub: unitPrice,
        lineCostRub: unitPrice === null ? null : Math.round((Number(item.amount) || 0) / basis.amount * unitPrice),
        hasPrice: unitPrice !== null
      });
    });
  }

  function calculateShoppingTotal(items) {
    return Math.round((items || []).reduce(function (total, item) {
      return total + (Number.isFinite(item.lineCostRub) ? item.lineCostRub : 0);
    }, 0));
  }

  function createCycleSnapshot(state, template, catalog, defaultPrices) {
    var cycle = state && state.activeCycle ? state.activeCycle : {};
    var cyclePrefix = (cycle.id || '') + ':';
    var completedMeals = Object.keys(state && state.completions || {}).filter(function (key) {
      return key.indexOf(cyclePrefix) === 0 && state.completions[key] === true;
    }).length;
    var trainingDays = Object.keys(state && state.trainingDays || {}).filter(function (key) {
      return key.indexOf(cyclePrefix) === 0 && state.trainingDays[key] === true;
    }).length;
    var plannedMeals = (template && Array.isArray(template.days) ? template.days.length : 14) * 3;
    var startUtc = dateKeyToUtc(cycle.startDate);
    var endDate = cycle.startDate;
    if (startUtc !== null) {
      var end = new Date(startUtc + 13 * 86400000);
      endDate = end.toISOString().slice(0, 10);
    }
    var pricedShopping = [];
    if (Array.isArray(catalog)) {
      [1, 2].forEach(function (week) {
        var items = buildShoppingList(template, state, catalog, week);
        pricedShopping = pricedShopping.concat(priceShoppingItems(items, state && state.ingredientPrices, defaultPrices));
      });
    }
    var shoppingCostRub = pricedShopping.length && pricedShopping.every(function (item) { return item.hasPrice; })
      ? calculateShoppingTotal(pricedShopping)
      : null;
    return {
      id: cycle.id || '',
      templateId: cycle.templateId || 'plan-14-v1',
      startDate: cycle.startDate || '',
      endDate: endDate,
      completedMeals: completedMeals,
      plannedMeals: plannedMeals,
      adherencePercent: plannedMeals ? Math.round(completedMeals / plannedMeals * 100) : 0,
      trainingDays: trainingDays,
      shoppingCostRub: shoppingCostRub,
      overrides: clone(state && state.overrides || {}),
      completions: clone(state && state.completions || {}),
      notes: clone(state && state.notes || {}),
      trainingDayMap: clone(state && state.trainingDays || {}),
      trainingExtras: clone(state && state.trainingExtras || {})
    };
  }

  function startNextCycle(state, startDate, mode, snapshot) {
    var safeState = normalizeState(state, startDate);
    var safeDate = normalizeLocalDate(startDate) || getLocalDateKey();
    var history = safeState.history.slice();
    if (snapshot) history.push(clone(snapshot));
    return {
      version: 1,
      activeCycle: {
        id: createCycleId(safeDate),
        startDate: safeDate,
        templateId: safeState.activeCycle.templateId || 'plan-14-v1',
        mode: mode === 'new' ? 'new' : 'repeat'
      },
      overrides: {},
      completions: {},
      notes: {},
      trainingDays: {},
      trainingExtras: {},
      shoppingChecks: {},
      ingredientPrices: clone(safeState.ingredientPrices),
      cookingChecks: {},
      history: history
    };
  }

  return {
    MEAL_TYPES: MEAL_TYPES.slice(),
    MAIN_SLOTS: MAIN_SLOTS.slice(),
    normalizeLocalDate: normalizeLocalDate,
    getLocalDateKey: getLocalDateKey,
    getCycleDay: getCycleDay,
    normalizeRange: normalizeRange,
    validateMeal: validateMeal,
    validateImportedCatalog: validateImportedCatalog,
    mergeCatalog: mergeCatalog,
    createDefaultState: createDefaultState,
    normalizeState: normalizeState,
    resolveMealId: resolveMealId,
    resolveDayPlan: resolveDayPlan,
    calculateDaySummary: calculateDaySummary,
    buildShoppingList: buildShoppingList,
    priceKey: priceKey,
    priceBasis: priceBasis,
    resolvePriceBook: resolvePriceBook,
    priceShoppingItems: priceShoppingItems,
    calculateShoppingTotal: calculateShoppingTotal,
    createCycleSnapshot: createCycleSnapshot,
    startNextCycle: startNextCycle
  };
});
