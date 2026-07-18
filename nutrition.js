(function () {
  'use strict';

  var STATE_KEY = 'nutrition_state_v1';
  var PRICES_KEY = 'nutrition_prices_v1';
  var MEALS_KEY = 'nutrition_meals_v1';
  var KITCHEN_PROFILE_KEY = 'nutrition_kitchen_profile_v1';
  var COOKING_PLANS_KEY = 'nutrition_cooking_plans_v1';
  var DEFAULT_VIEW = 'today';
  var VIEWS = ['today', 'cycle', 'dishes', 'shopping', 'cooking', 'history'];
  var MAIN_SLOTS = ['breakfast', 'lunch', 'dinner'];
  var SLOT_LABELS = { breakfast: 'завтрак', lunch: 'обед', dinner: 'ужин' };
  var Gamification = window.Gamification;
  var NutritionCore = window.NutritionCore;
  var NutritionData = window.NutritionData;
  var NutritionCookingCore = window.NutritionCookingCore;
  var NutritionScheduler = window.NutritionScheduler;
  var NutritionOpenRouter = window.NutritionOpenRouter;

  if (!Gamification || !NutritionCore || !NutritionData || !NutritionCookingCore || !NutritionScheduler || !NutritionOpenRouter) return;

  var state;
  var importedMeals = [];
  var catalog = [];
  var selectedDay = 1;
  var cycleWeek = 1;
  var shoppingWeek = 1;
  var cookingWeek = 1;
  var cookingSessionKind = 'main';
  var activeView = DEFAULT_VIEW;
  var replacementTarget = null;
  var activeBatchId = null;
  var selectedCookingActionId = null;
  var kitchenProfile;
  var cookingStore;
  var cookingClient = NutritionOpenRouter.createOpenRouterCookingClient({});
  var cookingUiState = {};
  var cookingUiError = {};
  var generationTimers = {};

  function getStored(key) {
    return Gamification.storeGet(key);
  }

  function saveState() {
    var persistedState = Object.assign({}, state);
    delete persistedState.ingredientPrices;
    Gamification.storeSet(STATE_KEY, persistedState);
  }

  function savePriceBook() {
    Gamification.storeSet(PRICES_KEY, { version: 1, prices: state.ingredientPrices });
  }

  function saveImportedMeals() {
    Gamification.storeSet(MEALS_KEY, { version: 1, meals: importedMeals });
  }

  function saveKitchenProfile() {
    Gamification.storeSet(KITCHEN_PROFILE_KEY, kitchenProfile);
  }

  function saveCookingStore() {
    Gamification.storeSet(COOKING_PLANS_KEY, cookingStore);
  }

  function loadCookingData() {
    kitchenProfile = NutritionCookingCore.normalizeKitchenProfile(getStored(KITCHEN_PROFILE_KEY));
    cookingStore = NutritionCookingCore.normalizeCookingStore(getStored(COOKING_PLANS_KEY));
    if (!getStored(KITCHEN_PROFILE_KEY)) saveKitchenProfile();
    if (!getStored(COOKING_PLANS_KEY)) saveCookingStore();
  }

  function loadImportedMeals() {
    var stored = getStored(MEALS_KEY);
    var checked = NutritionCore.validateImportedCatalog(stored, NutritionData.meals, []);
    importedMeals = checked.ok ? checked.meals : [];
    catalog = NutritionCore.mergeCatalog(NutritionData.meals, importedMeals);
  }

  function loadState() {
    var todayKey = NutritionCore.getLocalDateKey();
    var storedState = getStored(STATE_KEY);
    var storedPriceBook = getStored(PRICES_KEY);
    state = NutritionCore.normalizeState(storedState, todayKey);
    state.ingredientPrices = NutritionCore.resolvePriceBook(state.ingredientPrices, storedPriceBook);
    if (!storedState) saveState();
    if (!storedPriceBook && Object.keys(state.ingredientPrices).length) savePriceBook();
    var current = NutritionCore.getCycleDay(state.activeCycle.startDate, todayKey);
    selectedDay = current ? current.dayNumber : 1;
  }

  function createElement(tag, className, textValue) {
    var element = document.createElement(tag);
    if (className) element.className = className;
    if (textValue !== undefined && textValue !== null) element.textContent = String(textValue);
    return element;
  }

  function clearElement(element) {
    if (!element) return;
    while (element.firstChild) element.removeChild(element.firstChild);
  }

  function appendChildren(parent, children) {
    children.forEach(function (child) {
      if (child) parent.appendChild(child);
    });
    return parent;
  }

  function formatRange(value, unit) {
    var safe = NutritionCore.normalizeRange(value);
    var min = Math.round(safe.min);
    var max = Math.round(safe.max);
    return '≈' + (min === max ? min : min + '–' + max) + (unit ? ' ' + unit : '');
  }

  function formatRub(value) {
    return Math.round(Number(value) || 0).toLocaleString('ru-RU') + ' ₽';
  }

  function parseDateKey(value) {
    var parts = String(value || '').split('-').map(Number);
    return new Date(parts[0], parts[1] - 1, parts[2], 12, 0, 0);
  }

  function addDays(dateKey, amount) {
    var date = parseDateKey(dateKey);
    date.setDate(date.getDate() + amount);
    return NutritionCore.getLocalDateKey(date);
  }

  function formatDate(dateKey, options) {
    return parseDateKey(dateKey).toLocaleDateString('ru-RU', options || { day: 'numeric', month: 'long' });
  }

  function getDayDate(dayNumber) {
    return addDays(state.activeCycle.startDate, Number(dayNumber) - 1);
  }

  function getWeekForDay(dayNumber) {
    return Number(dayNumber) <= 7 ? 1 : 2;
  }

  function cycleKey(dayNumber, suffix) {
    return state.activeCycle.id + ':' + dayNumber + (suffix ? ':' + suffix : '');
  }

  function getTrainingExtra(dayNumber) {
    var key = cycleKey(dayNumber);
    var configured = state.trainingExtras[key];
    var fallback = NutritionData.trainingExtras[0] && NutritionData.trainingExtras[0].mealId;
    var mealId = configured || fallback;
    return catalog.find(function (item) { return item.id === mealId; }) || null;
  }

  function getHealthContext() {
    var water = getStored('po_water_v1') || {};
    var weight = getStored('weight_v1') || {};
    var calories = getStored('calories_v1') || {};
    var entries = Array.isArray(weight.entries) ? weight.entries : [];
    var latestWeight = entries.length && Number(entries[entries.length - 1].kg);
    var profile = water.profile || {};
    var weightKg = Number.isFinite(latestWeight) && latestWeight > 0 ? latestWeight : Number(profile.weightKg) || 75;
    var activity = Number(profile.activityHrsPerWeek) || 0;
    var bottleMl = Number(water.bottleMl) || 500;
    var targetMl = weightKg * 35 + activity / 7 * 500;
    var todayKey = NutritionCore.getLocalDateKey();
    return {
      weightKg: weightKg,
      calorieTarget: Number(calories.target) || 2000,
      waterDone: Number(water.logs && water.logs[todayKey]) || 0,
      waterTarget: Math.max(1, Math.ceil(targetMl / bottleMl))
    };
  }

  function isTrainingDay(dayNumber) {
    return state.trainingDays[cycleKey(dayNumber)] === true;
  }

  function currentDayPlan(dayNumber) {
    return NutritionCore.resolveDayPlan(NutritionData.plan14, state, dayNumber, catalog);
  }

  function getWeekDemand(week) {
    return NutritionCookingCore.buildCookingDemand(NutritionData.plan14, state, catalog, week);
  }

  function cookingPlanKey(week, sessionKind) {
    return String(Number(week) === 2 ? 2 : 1) + ':' + (sessionKind === 'refresh' ? 'refresh' : 'main');
  }

  function activeCookingPlanKey() {
    return cookingPlanKey(cookingWeek, cookingSessionKind);
  }

  function getCookingDemand(week, sessionKind) {
    return NutritionCookingCore.selectCookingSessionDemand(getWeekDemand(week), sessionKind);
  }

  function getOpenRouterSettings() {
    var stored = getStored('openrouter_settings_v1');
    return stored && typeof stored === 'object' ? stored : {};
  }

  function formatMinutes(value) {
    var minutes = Math.max(0, Math.round(Number(value) || 0));
    var hours = Math.floor(minutes / 60);
    var rest = minutes % 60;
    if (!hours) return rest + ' мин';
    return hours + ' ч' + (rest ? ' ' + rest + ' мин' : '');
  }

  function formatBatchCount(value) {
    var count = Math.max(0, Math.round(Number(value) || 0));
    var mod100 = count % 100;
    var mod10 = count % 10;
    var noun = mod100 >= 11 && mod100 <= 14 ? 'партий' : mod10 === 1 ? 'партия' : mod10 >= 2 && mod10 <= 4 ? 'партии' : 'партий';
    return count + ' ' + noun;
  }

  function buildFallbackPlan(demand, planHash) {
    var actions = NutritionCookingCore.buildFallbackActions(demand, kitchenProfile);
    var scheduled = NutritionScheduler.scheduleActions(actions, kitchenProfile);
    return {
      version: 1,
      planHash: planHash,
      cycleId: demand.cycleId,
      week: demand.week,
      sessionKind: demand.sessionKind,
      model: '',
      generatedAt: new Date().toISOString(),
      status: scheduled.ok ? 'fallback' : 'error',
      source: 'fallback',
      batches: demand.batches,
      actions: actions,
      schedule: scheduled.ok ? scheduled.schedule : [],
      estimate: scheduled.ok ? scheduled.estimate : { minMinutes: 0, maxMinutes: 0 },
      peakOutlets: scheduled.ok ? scheduled.peakOutlets : 0,
      warnings: scheduled.ok
        ? ['локальный план собран из инструкций блюд']
        : ['не удалось построить резервный план']
    };
  }

  function planMatchesDemand(plan, demand) {
    return NutritionCookingCore.planCoversDemand(plan, demand);
  }

  function createAiPlan(demand, planHash, result) {
    if (!result.ok || !planMatchesDemand(result.value, demand)) return null;
    var adjustedActions = NutritionCookingCore.applyCalibrationToActions(result.value.actions, kitchenProfile, demand.batches);
    var scheduled = NutritionScheduler.scheduleActions(adjustedActions, kitchenProfile);
    if (!scheduled.ok) return null;
    return {
      version: 1,
      planHash: planHash,
      cycleId: demand.cycleId,
      week: demand.week,
      sessionKind: demand.sessionKind,
      model: result.model || '',
      generatedAt: new Date().toISOString(),
      status: 'ready',
      source: 'ai',
      batches: demand.batches,
      actions: adjustedActions,
      schedule: scheduled.schedule,
      estimate: scheduled.estimate,
      peakOutlets: scheduled.peakOutlets,
      warnings: scheduled.warnings || []
    };
  }

  function requestAiCookingPlan(week, sessionKind, demand, planHash) {
    var key = cookingPlanKey(week, sessionKind);
    var settings = getOpenRouterSettings();
    if (!settings.key) {
      cookingUiState[key] = 'fallback';
      cookingUiError[key] = '';
      return;
    }
    cookingUiState[key] = 'generating';
    cookingUiError[key] = '';
    if (activeView === 'cooking' && cookingWeek === week && cookingSessionKind === sessionKind) renderCooking();
    if (sessionKind === 'main' && activeView === 'cycle' && cycleWeek === week) {
      renderBatchRail(getWeekDemand(week), NutritionCookingCore.getCachedPlan(cookingStore, planHash));
    }

    cookingClient.decompose({
      apiKey: settings.key,
      model: settings.model || 'google/gemini-2.0-flash-001',
      demand: demand,
      profile: kitchenProfile
    }).then(function (result) {
      var currentDemand = getCookingDemand(week, sessionKind);
      var currentHash = NutritionCookingCore.createPlanFingerprint(currentDemand, kitchenProfile);
      if (currentHash !== planHash) return;
      var aiPlan = createAiPlan(demand, planHash, result);
      if (aiPlan) {
        if (NutritionCookingCore.activeSessionForPlan(cookingStore, planHash)) {
          var activePlan = NutritionCookingCore.getCachedPlan(cookingStore, planHash);
          cookingUiState[key] = activePlan && activePlan.source === 'ai' ? 'ready' : 'fallback';
          cookingUiError[key] = '';
          if (sessionKind === 'main' && activeView === 'cycle' && cycleWeek === week) renderCycle();
          if (activeView === 'cooking' && cookingWeek === week && cookingSessionKind === sessionKind) renderCooking();
          return;
        }
        cookingStore = NutritionCookingCore.putCachedPlan(cookingStore, aiPlan);
        saveCookingStore();
        cookingUiState[key] = 'ready';
        cookingUiError[key] = '';
      } else {
        cookingUiState[key] = 'error';
        cookingUiError[key] = result && result.error ? result.error.message : 'план не прошёл локальную проверку';
      }
      if (sessionKind === 'main' && activeView === 'cycle' && cycleWeek === week) renderCycle();
      if (activeView === 'cooking' && cookingWeek === week && cookingSessionKind === sessionKind) renderCooking();
    });
  }

  function ensureCookingPlan(week, sessionKind, options) {
    var kind = sessionKind === 'refresh' ? 'refresh' : 'main';
    var key = cookingPlanKey(week, kind);
    var activeSessionId = cookingStore.activeSessionId;
    var activeSession = activeSessionId && cookingStore.sessionsById[activeSessionId];
    if (activeSession && activeSession.status !== 'completed' && activeSession.cycleId === state.activeCycle.id &&
      Number(activeSession.week) === Number(week) && (activeSession.sessionKind || 'main') === kind) {
      var runningPlan = NutritionCookingCore.getCachedPlan(cookingStore, activeSession.planHash);
      if (runningPlan) {
        cookingUiState[key] = runningPlan.status === 'ready' ? 'ready' : 'fallback';
        return runningPlan;
      }
    }
    var demand = getCookingDemand(week, kind);
    var planHash = NutritionCookingCore.createPlanFingerprint(demand, kitchenProfile);
    var cached = NutritionCookingCore.getCachedPlan(cookingStore, planHash);
    if (!cached) {
      cached = buildFallbackPlan(demand, planHash);
      cookingStore = NutritionCookingCore.putCachedPlan(cookingStore, cached);
      saveCookingStore();
    }
    if (cookingUiState[key] !== 'generating' && cookingUiState[key] !== 'stale' && cookingUiState[key] !== 'error') {
      cookingUiState[key] = cached.status === 'ready' ? 'ready' : 'fallback';
    }
    var settings = getOpenRouterSettings();
    if (!settings.key && cookingUiState[key] !== 'generating') {
      cookingUiState[key] = cached.status === 'ready' ? 'ready' : 'fallback';
      cookingUiError[key] = '';
    }
    if (settings.key && cookingUiState[key] !== 'generating' && (
      (options && (options.force || options.forceAi)) || (cookingUiState[key] !== 'stale' && cached.source !== 'ai')
    )) {
      requestAiCookingPlan(week, kind, demand, planHash);
    }
    return cached;
  }

  function scheduleCookingGeneration(week, sessionKind, delay) {
    var kind = sessionKind === 'refresh' ? 'refresh' : 'main';
    var key = cookingPlanKey(week, kind);
    cookingUiState[key] = 'stale';
    cookingUiError[key] = '';
    if (generationTimers[key]) clearTimeout(generationTimers[key]);
    generationTimers[key] = setTimeout(function () {
      delete generationTimers[key];
      ensureCookingPlan(week, kind, { forceAi: true });
      if (activeView === 'cycle' && cycleWeek === week) renderCycle();
      if (activeView === 'cooking' && cookingWeek === week && cookingSessionKind === kind) renderCooking();
    }, Number(delay) || 450);
  }

  function renderView(view) {
    if (view === 'today') renderToday();
    if (view === 'cycle') renderCycle();
    if (view === 'dishes') renderCatalog();
    if (view === 'shopping') renderShopping();
    if (view === 'cooking') renderCooking();
    if (view === 'history') renderHistory();
  }

  function switchView(view, updateHash) {
    var safeView = VIEWS.indexOf(view) !== -1 ? view : DEFAULT_VIEW;
    activeView = safeView;
    document.querySelectorAll('[data-menu-view]').forEach(function (item) {
      var isActive = item.getAttribute('data-menu-view') === safeView;
      item.classList.toggle('active', isActive);
      if (isActive) item.setAttribute('aria-current', 'page');
      else item.removeAttribute('aria-current');
    });
    document.querySelectorAll('[data-menu-panel]').forEach(function (panel) {
      panel.classList.toggle('active', panel.getAttribute('data-menu-panel') === safeView);
    });
    var select = document.getElementById('menuViewSelect');
    if (select) select.value = safeView;
    if (updateHash !== false && window.location.hash !== '#' + safeView) window.location.hash = safeView;
    renderView(safeView);
  }

  function renderCycleMark() {
    var mark = document.getElementById('cycleMark');
    if (!mark) return;
    var current = NutritionCore.getCycleDay(state.activeCycle.startDate, NutritionCore.getLocalDateKey());
    mark.textContent = current && current.completed ? 'цикл завершён' : 'цикл ' + (current ? current.dayNumber : 1) + ' / 14';
  }

  function summaryItem(label, value, note) {
    var item = createElement('div', 'summary-item');
    appendChildren(item, [
      createElement('div', 'summary-label', label),
      createElement('div', 'summary-value', value),
      note ? createElement('div', 'summary-note', note) : null
    ]);
    return item;
  }

  function renderDaySummary(dayPlan, trainingExtra) {
    var container = document.getElementById('daySummary');
    clearElement(container);
    var summary = NutritionCore.calculateDaySummary(dayPlan, catalog, trainingExtra);
    var completed = MAIN_SLOTS.filter(function (slot) {
      return state.completions[cycleKey(selectedDay, slot)] === true;
    }).length;
    appendChildren(container, [
      summaryItem('калории', formatRange(summary.caloriesApprox, 'ккал')),
      summaryItem('белок', formatRange(summary.proteinApprox, 'г')),
      summaryItem('бюджет', formatRange(summary.estimatedCostRub, '₽')),
      summaryItem('соблюдение', completed + ' / 3', 'ориентир, не медрекомендация')
    ]);
  }

  function renderHealthContext() {
    var container = document.getElementById('healthContext');
    if (!container) return;
    clearElement(container);
    var context = getHealthContext();
    appendChildren(container, [
      createElement('span', 'health-context-label', 'из здоровья'),
      createElement('span', '', 'цель ' + Math.round(context.calorieTarget) + ' ккал'),
      createElement('span', '', 'вес ' + (Math.round(context.weightKg * 10) / 10) + ' кг'),
      createElement('span', '', 'вода ' + context.waterDone + ' / ' + context.waterTarget)
    ]);
    var link = createElement('a', 'health-context-link', 'открыть');
    link.href = 'health.html';
    container.appendChild(link);
  }

  function ingredientText(item) {
    var amount = Number.isInteger(item.amount) ? item.amount : Math.round(item.amount * 10) / 10;
    return item.name + ' — ' + amount + ' ' + item.unit;
  }

  function createMealDetails(meal, slot) {
    var details = createElement('div', 'meal-details');
    var ingredientsBlock = createElement('div');
    ingredientsBlock.appendChild(createElement('div', 'detail-title', 'ингредиенты'));
    var ingredients = createElement('ul', 'detail-list');
    meal.ingredients.forEach(function (item) {
      ingredients.appendChild(createElement('li', '', ingredientText(item)));
    });
    ingredientsBlock.appendChild(ingredients);

    var actionBlock = createElement('div');
    actionBlock.appendChild(createElement('div', 'detail-title', 'приготовление'));
    var instructions = createElement('ol', 'detail-list');
    meal.instructions.forEach(function (item) {
      instructions.appendChild(createElement('li', '', item));
    });
    actionBlock.appendChild(instructions);
    var note = createElement('textarea', 'meal-note-input');
    note.setAttribute('aria-label', 'заметка к приёму пищи');
    note.placeholder = 'Заметка';
    note.value = state.notes[cycleKey(selectedDay, slot)] || '';
    note.addEventListener('change', function () {
      var value = note.value.trim();
      var key = cycleKey(selectedDay, slot);
      if (value) state.notes[key] = value;
      else delete state.notes[key];
      saveState();
    });
    actionBlock.appendChild(note);
    appendChildren(details, [ingredientsBlock, actionBlock]);
    return details;
  }

  function createMealRow(slot, meal) {
    var row = createElement('article', 'meal-row');
    row.setAttribute('data-meal-slot', slot);
    row.appendChild(createElement('div', 'meal-slot', SLOT_LABELS[slot]));

    var info = createElement('div');
    info.appendChild(createElement('div', 'meal-title', meal.title));
    var meta = createElement('div', 'meal-meta');
    appendChildren(meta, [
      createElement('span', '', formatRange(meal.prepMinutes, 'мин')),
      createElement('span', '', formatRange(meal.caloriesApprox, 'ккал')),
      createElement('span', '', formatRange(meal.proteinApprox, 'г белка'))
    ]);
    meal.tags.forEach(function (tag) { meta.appendChild(createElement('span', 'meal-tag', tag)); });
    info.appendChild(meta);
    row.appendChild(info);

    var actions = createElement('div', 'meal-actions');
    var detailsButton = createElement('button', 'quiet-btn', 'детали');
    detailsButton.type = 'button';
    detailsButton.addEventListener('click', function () {
      row.classList.toggle('expanded');
      detailsButton.textContent = row.classList.contains('expanded') ? 'скрыть' : 'детали';
    });
    var replaceButton = createElement('button', 'quiet-btn', 'заменить');
    replaceButton.type = 'button';
    replaceButton.addEventListener('click', function () { openReplaceDialog(slot, meal.mealType); });
    var complete = createElement('input', 'meal-complete');
    complete.type = 'checkbox';
    complete.setAttribute('aria-label', 'отметить ' + SLOT_LABELS[slot]);
    complete.checked = state.completions[cycleKey(selectedDay, slot)] === true;
    complete.addEventListener('change', function () {
      var key = cycleKey(selectedDay, slot);
      if (complete.checked) state.completions[key] = true;
      else delete state.completions[key];
      saveState();
      renderToday();
      if (activeView === 'cycle') renderCycle();
    });
    appendChildren(actions, [detailsButton, replaceButton, complete]);
    row.appendChild(actions);
    row.appendChild(createMealDetails(meal, slot));
    return row;
  }

  function renderTrainingExtra(extra) {
    var container = document.getElementById('trainingExtra');
    clearElement(container);
    var enabled = isTrainingDay(selectedDay);
    container.hidden = !enabled;
    if (!enabled || !extra) return;
    var head = createElement('div', 'cooking-session-head');
    var titleWrap = createElement('div');
    appendChildren(titleWrap, [
      createElement('div', 'detail-title', 'дополнение к тренировке'),
      createElement('div', 'meal-title', extra.title),
      createElement('div', 'meal-meta', formatRange(extra.caloriesApprox, 'ккал') + ' · ' + formatRange(extra.proteinApprox, 'г белка'))
    ]);
    var select = createElement('select', 'field-control');
    select.setAttribute('aria-label', 'дополнение к тренировке');
    NutritionData.trainingExtras.forEach(function (item) {
      var optionMeal = catalog.find(function (catalogMeal) { return catalogMeal.id === item.mealId; });
      if (!optionMeal) return;
      var option = createElement('option', '', optionMeal.title);
      option.value = optionMeal.id;
      option.selected = optionMeal.id === extra.id;
      select.appendChild(option);
    });
    select.addEventListener('change', function () {
      state.trainingExtras[cycleKey(selectedDay)] = select.value;
      saveState();
      renderToday();
    });
    appendChildren(head, [titleWrap, select]);
    container.appendChild(head);
  }

  function renderCycleCompleteActions() {
    var container = document.getElementById('cycleCompleteActions');
    clearElement(container);
    var current = NutritionCore.getCycleDay(state.activeCycle.startDate, NutritionCore.getLocalDateKey());
    if (!current || !current.completed) return;
    var block = createElement('div', 'training-extra');
    appendChildren(block, [
      createElement('div', 'meal-title', 'цикл завершён'),
      createElement('div', 'panel-meta', 'сохрани результат и начни следующие 14 дней')
    ]);
    var actions = createElement('div', 'panel-actions');
    var repeat = createElement('button', 'primary-btn', 'повторить план');
    var fresh = createElement('button', 'quiet-btn', 'новый цикл');
    repeat.type = fresh.type = 'button';
    repeat.addEventListener('click', function () { beginNextCycle('repeat'); });
    fresh.addEventListener('click', function () { beginNextCycle('new'); });
    appendChildren(actions, [repeat, fresh]);
    block.appendChild(actions);
    container.appendChild(block);
  }

  function beginNextCycle(mode) {
    if (!window.confirm('завершить текущий цикл и начать следующие 14 дней?')) return;
    var snapshot = NutritionCore.createCycleSnapshot(state, NutritionData.plan14, catalog, NutritionData.ingredientPrices);
    state = NutritionCore.startNextCycle(state, NutritionCore.getLocalDateKey(), mode, snapshot);
    selectedDay = 1;
    saveState();
    renderAll();
  }

  function renderToday() {
    renderCycleMark();
    var dayPlan = currentDayPlan(selectedDay);
    var trainingExtra = isTrainingDay(selectedDay) ? getTrainingExtra(selectedDay) : null;
    var title = document.getElementById('todayTitle');
    var meta = document.getElementById('todayMeta');
    var startInput = document.getElementById('cycleStartDate');
    var trainingToggle = document.getElementById('trainingToggle');
    var currentCycleDay = NutritionCore.getCycleDay(state.activeCycle.startDate, NutritionCore.getLocalDateKey());
    var selectedIsToday = currentCycleDay && !currentCycleDay.completed && selectedDay === currentCycleDay.dayNumber;
    if (title) title.textContent = selectedIsToday ? 'Сегодня' : 'День ' + selectedDay;
    if (meta) meta.textContent = formatDate(getDayDate(selectedDay), { weekday: 'long', day: 'numeric', month: 'long' }) + ' · день ' + selectedDay + ' из 14';
    if (startInput) startInput.value = state.activeCycle.startDate;
    if (trainingToggle) trainingToggle.checked = isTrainingDay(selectedDay);

    renderHealthContext();
    renderDaySummary(dayPlan, trainingExtra);
    var list = document.getElementById('todayMeals');
    clearElement(list);
    MAIN_SLOTS.forEach(function (slot) {
      if (dayPlan.meals[slot]) list.appendChild(createMealRow(slot, dayPlan.meals[slot]));
    });
    renderTrainingExtra(trainingExtra);
    var week = getWeekForDay(selectedDay);
    var quickPlan = ensureCookingPlan(week, 'main');
    var shoppingMeta = document.getElementById('shoppingQuickMeta');
    var cookingMeta = document.getElementById('cookingQuickMeta');
    if (shoppingMeta) shoppingMeta.textContent = 'неделя ' + week;
    if (cookingMeta) cookingMeta.textContent = 'основная заготовка · ' + formatMinutes(quickPlan.estimate.minMinutes) + '–' + formatMinutes(quickPlan.estimate.maxMinutes);
    renderCycleCompleteActions();
  }

  function renderCycle() {
    var grid = document.getElementById('cycleGrid');
    var rail = document.getElementById('cycleBatchRail');
    if (!grid || !rail) return;
    clearElement(grid);
    var demand = getWeekDemand(cycleWeek);
    var cookingPlan = ensureCookingPlan(cycleWeek, 'main');
    var occurrenceBatches = {};
    demand.batches.forEach(function (batch) {
      batch.occurrences.forEach(function (occurrence) {
        occurrenceBatches[occurrence.day + ':' + occurrence.slot] = batch;
      });
    });
    var todayInfo = NutritionCore.getCycleDay(state.activeCycle.startDate, NutritionCore.getLocalDateKey());
    var startDay = cycleWeek === 1 ? 1 : 8;
    var endDay = startDay + 6;
    for (var dayNumber = startDay; dayNumber <= endDay; dayNumber++) {
      (function (day) {
        var plan = currentDayPlan(day);
        var extra = isTrainingDay(day) ? getTrainingExtra(day) : null;
        var summary = NutritionCore.calculateDaySummary(plan, catalog, extra);
        var column = createElement('section', 'calendar-day');
        if (todayInfo && !todayInfo.completed && day === todayInfo.dayNumber) column.classList.add('current');
        var head = createElement('header', 'calendar-day-head');
        appendChildren(head, [
          createElement('span', 'calendar-weekday', formatDate(getDayDate(day), { weekday: 'short' })),
          createElement('span', 'calendar-date', formatDate(getDayDate(day), { day: 'numeric', month: 'short' })),
          isTrainingDay(day) ? createElement('span', 'calendar-training', 'тренировка') : null
        ]);
        column.appendChild(head);
        var mealsList = createElement('div', 'calendar-meals');
        MAIN_SLOTS.forEach(function (slot) {
          var meal = plan.meals[slot];
          if (!meal) return;
          var batch = occurrenceBatches[day + ':' + slot];
          var button = createElement('button', 'calendar-meal');
          button.type = 'button';
          button.setAttribute('data-batch-id', batch ? batch.id : '');
          if (batch) button.classList.add('batch-color-' + batch.colorIndex);
          appendChildren(button, [
            createElement('span', 'calendar-meal-type', SLOT_LABELS[slot]),
            createElement('span', 'calendar-meal-title', meal.title),
            createElement('span', 'calendar-meal-meta', formatRange(meal.caloriesApprox, 'ккал') + ' · ' + formatRange(meal.proteinApprox, 'г')),
            createElement('span', 'calendar-batch-label', batch ? batch.label : 'готовить в день подачи')
          ]);
          button.addEventListener('click', function () {
            selectedDay = day;
            switchView('today');
            window.scrollTo({ top: 0, behavior: 'smooth' });
          });
          mealsList.appendChild(button);
        });
        column.appendChild(mealsList);
        var completeCount = MAIN_SLOTS.filter(function (slot) { return state.completions[cycleKey(day, slot)] === true; }).length;
        head.title = completeCount + '/3 · ' + formatRange(summary.caloriesApprox, 'ккал');
        grid.appendChild(column);
      })(dayNumber);
    }
    renderBatchRail(demand, cookingPlan);
    applyBatchHighlight();
  }

  function cookingStateLabel(week, plan) {
    var stateName = cookingUiState[cookingPlanKey(week, plan && plan.sessionKind)] || plan && plan.status || 'fallback';
    var labels = {
      ready: 'план актуален',
      generating: 'пересобирается',
      stale: 'состав изменён',
      fallback: 'локальный резервный план',
      error: 'используется резервный план'
    };
    return { name: stateName, label: labels[stateName] || labels.fallback };
  }

  function batchScheduleMinutes(plan, batchId) {
    return (plan && Array.isArray(plan.schedule) ? plan.schedule : []).filter(function (entry) {
      return entry.batchId === batchId;
    }).reduce(function (total, entry) { return total + entry.durationMinutes; }, 0);
  }

  function renderBatchRail(demand, plan) {
    var rail = document.getElementById('cycleBatchRail');
    if (!rail) return;
    clearElement(rail);
    var stateInfo = cookingStateLabel(cycleWeek, plan);
    var head = createElement('div', 'batch-rail-head');
    appendChildren(head, [
      createElement('div', 'batch-rail-title', 'партии этой недели'),
      createElement('div', 'batch-rail-status', stateInfo.label)
    ]);
    rail.appendChild(head);
    var list = createElement('div', 'batch-rail-list');
    demand.batches.forEach(function (batch) {
      var button = createElement('button', 'batch-rail-item batch-color-' + batch.colorIndex);
      button.type = 'button';
      button.setAttribute('data-batch-id', batch.id);
      if (activeBatchId === batch.id) button.classList.add('active');
      var strategy = batch.strategy === 'batch'
        ? batch.portions + ' порц. · дни ' + batch.servingDays.join(', ')
        : batch.strategy === 'outside' ? 'без готовки' : 'в день подачи';
      var minutes = batchScheduleMinutes(plan, batch.id);
      appendChildren(button, [
        createElement('strong', '', batch.title),
        createElement('span', '', strategy + (minutes ? ' · ' + formatMinutes(minutes) : ''))
      ]);
      button.addEventListener('click', function () {
        activeBatchId = activeBatchId === batch.id ? null : batch.id;
        renderCycle();
      });
      list.appendChild(button);
    });
    rail.appendChild(list);
    var open = createElement('button', 'primary-btn batch-rail-action', 'открыть готовку');
    open.type = 'button';
    open.addEventListener('click', function () {
      setWeek('cooking', cycleWeek);
      switchView('cooking');
    });
    rail.appendChild(open);
  }

  function applyBatchHighlight() {
    document.querySelectorAll('[data-batch-id]').forEach(function (element) {
      var batchId = element.getAttribute('data-batch-id');
      element.classList.toggle('batch-active', Boolean(activeBatchId) && batchId === activeBatchId);
      element.classList.toggle('batch-muted', Boolean(activeBatchId) && batchId !== activeBatchId);
    });
  }

  function dishMatchesFilters(meal) {
    var search = (document.getElementById('dishSearch').value || '').trim().toLowerCase();
    var type = document.getElementById('dishTypeFilter').value;
    var source = document.getElementById('dishSourceFilter').value;
    var haystack = [meal.title].concat(meal.tags || []).join(' ').toLowerCase();
    if (search && haystack.indexOf(search) === -1) return false;
    if (type !== 'all' && meal.mealType !== type) return false;
    if (source === 'outside' && meal.tags.indexOf('вне дома') === -1) return false;
    if (source !== 'all' && source !== 'outside' && meal.source !== source) return false;
    return true;
  }

  function createDishCard(meal) {
    var details = createElement('details', 'dish-card');
    var summary = createElement('summary');
    appendChildren(summary, [
      createElement('div', 'dish-source', meal.source === 'seed' ? 'встроенное' : 'загруженное'),
      createElement('div', 'dish-title', meal.title),
      createElement('div', 'meal-meta', NutritionData.mealTypeLabels[meal.mealType] + ' · ' + formatRange(meal.caloriesApprox, 'ккал') + ' · ' + formatRange(meal.proteinApprox, 'г белка'))
    ]);
    details.appendChild(summary);
    var body = createElement('div', 'dish-details');
    var tags = createElement('div', 'meal-meta');
    meal.tags.forEach(function (tag) { tags.appendChild(createElement('span', 'meal-tag', tag)); });
    body.appendChild(tags);
    body.appendChild(createElement('div', 'detail-title', 'ингредиенты'));
    var ingredients = createElement('ul', 'detail-list');
    meal.ingredients.forEach(function (item) { ingredients.appendChild(createElement('li', '', ingredientText(item))); });
    body.appendChild(ingredients);
    body.appendChild(createElement('div', 'detail-title', 'приготовление'));
    var instructions = createElement('ol', 'detail-list');
    meal.instructions.forEach(function (item) { instructions.appendChild(createElement('li', '', item)); });
    body.appendChild(instructions);
    if (meal.notes) body.appendChild(createElement('p', '', meal.notes));
    details.appendChild(body);
    return details;
  }

  function renderCatalog() {
    var list = document.getElementById('catalogList');
    var meta = document.getElementById('catalogMeta');
    if (!list) return;
    clearElement(list);
    var filtered = catalog.filter(dishMatchesFilters);
    filtered.forEach(function (meal) { list.appendChild(createDishCard(meal)); });
    if (!filtered.length) {
      var empty = createElement('div', 'empty-state');
      appendChildren(empty, [createElement('strong', '', 'ничего не найдено'), createElement('span', '', 'измени поиск или фильтры')]);
      list.appendChild(empty);
    }
    if (meta) meta.textContent = NutritionData.meals.length + ' встроенных · ' + importedMeals.length + ' загруженных';
  }

  function showImportStatus(message, isError) {
    var status = document.getElementById('importStatus');
    if (!status) return;
    status.textContent = message;
    status.style.color = isError ? 'var(--danger)' : 'var(--text-tertiary)';
  }

  function importMealsFile(file) {
    if (!file) return;
    var reader = new FileReader();
    reader.onload = function (event) {
      try {
        var payload = JSON.parse(event.target.result);
        var result = NutritionCore.validateImportedCatalog(payload, NutritionData.meals, importedMeals);
        if (!result.ok) {
          showImportStatus(result.errors[0].message, true);
          return;
        }
        if (result.meals.length) {
          importedMeals = importedMeals.concat(result.meals);
          catalog = NutritionCore.mergeCatalog(NutritionData.meals, importedMeals);
          saveImportedMeals();
        }
        var message = 'добавлено: ' + result.meals.length;
        if (result.skipped) message += ' · пропущено: ' + result.skipped;
        showImportStatus(message, result.meals.length === 0 && result.skipped > 0);
        renderCatalog();
      } catch (error) {
        showImportStatus('не удалось прочитать json: ' + error.message, true);
      }
    };
    reader.onerror = function () { showImportStatus('не удалось прочитать файл', true); };
    reader.readAsText(file);
  }

  function groupShopping(items) {
    var groups = {};
    items.forEach(function (item) {
      if (!groups[item.category]) groups[item.category] = [];
      groups[item.category].push(item);
    });
    return groups;
  }

  function renderShopping() {
    var container = document.getElementById('shoppingGroups');
    var budgetMeta = document.getElementById('shoppingBudgetMeta');
    if (!container || !budgetMeta) return;
    clearElement(container);
    var shoppingItems = NutritionCore.buildShoppingList(NutritionData.plan14, state, catalog, shoppingWeek);
    var items = NutritionCore.priceShoppingItems(shoppingItems, state.ingredientPrices, NutritionData.ingredientPrices);
    var missingPrices = items.filter(function (item) { return !item.hasPrice; }).length;
    var totalRub = NutritionCore.calculateShoppingTotal(items);
    budgetMeta.textContent = 'неделя ' + shoppingWeek + ' · ≈' + formatRub(totalRub) + (missingPrices ? ' · без цены: ' + missingPrices : '');
    var groups = groupShopping(items);
    Object.keys(NutritionData.ingredientCategories).forEach(function (category) {
      if (!groups[category] || !groups[category].length) return;
      var section = createElement('section');
      section.appendChild(createElement('h3', 'shopping-group-title', NutritionData.ingredientCategories[category]));
      var list = createElement('div', 'shopping-list');
      groups[category].forEach(function (item) {
        var key = state.activeCycle.id + ':' + shoppingWeek + ':' + item.id + ':' + item.unit;
        var row = createElement('div', 'shopping-item');
        var checkbox = createElement('input', 'shopping-check');
        checkbox.type = 'checkbox';
        checkbox.setAttribute('aria-label', 'куплено: ' + item.name);
        checkbox.checked = state.shoppingChecks[key] === true;
        row.classList.toggle('checked', checkbox.checked);
        checkbox.addEventListener('change', function () {
          if (checkbox.checked) state.shoppingChecks[key] = true;
          else delete state.shoppingChecks[key];
          saveState();
          row.classList.toggle('checked', checkbox.checked);
        });
        var priceKey = item.priceKey;
        var priceField = createElement('label', 'shopping-price-field');
        var priceInput = createElement('input', 'shopping-price-input');
        priceInput.type = 'number';
        priceInput.min = '0';
        priceInput.step = '1';
        priceInput.inputMode = 'decimal';
        priceInput.value = item.unitPriceRub === null ? '' : String(item.unitPriceRub);
        priceInput.setAttribute('aria-label', 'цена: ' + item.name + ', ' + item.priceLabel);
        priceInput.addEventListener('change', function () {
          var nextPrice = priceInput.value === '' ? null : Number(priceInput.value);
          if (nextPrice !== null && Number.isFinite(nextPrice) && nextPrice >= 0) {
            state.ingredientPrices[priceKey] = Math.round(nextPrice * 100) / 100;
          } else {
            delete state.ingredientPrices[priceKey];
          }
          savePriceBook();
          renderShopping();
        });
        appendChildren(priceField, [priceInput, createElement('span', 'shopping-price-unit', item.priceLabel)]);
        appendChildren(row, [
          checkbox,
          createElement('span', 'shopping-name', item.name),
          createElement('span', 'shopping-amount', formatIngredientAmount(item.amount) + ' ' + item.unit),
          priceField,
          createElement('span', 'shopping-line-cost', item.hasPrice ? '≈' + formatRub(item.lineCostRub) : '—')
        ]);
        list.appendChild(row);
      });
      section.appendChild(list);
      container.appendChild(section);
    });
  }

  function formatIngredientAmount(amount) {
    var value = Math.round(Number(amount) * 10) / 10;
    return Number.isInteger(value) ? String(value) : value.toFixed(1);
  }

  function getActiveCookingSession(plan) {
    var id = cookingStore.activeSessionId;
    var session = id && cookingStore.sessionsById[id];
    return session && session.planHash === plan.planHash ? session : null;
  }

  function getLastCookingSession(plan) {
    var weekKey = plan.cycleId + ':' + plan.week + ':' + (plan.sessionKind || 'main');
    var legacyWeekKey = plan.cycleId + ':' + plan.week;
    var id = cookingStore.lastSessionIdsByWeek && (cookingStore.lastSessionIdsByWeek[weekKey] || cookingStore.lastSessionIdsByWeek[legacyWeekKey]) || cookingStore.lastSessionId;
    var session = id && cookingStore.sessionsById[id];
    return session && session.status === 'completed' && session.cycleId === plan.cycleId && Number(session.week) === Number(plan.week) &&
      (session.sessionKind || 'main') === (plan.sessionKind || 'main')
      ? session
      : null;
  }

  function hasActiveCookingSession() {
    var id = cookingStore.activeSessionId;
    var session = id && cookingStore.sessionsById[id];
    return Boolean(session && session.status !== 'completed');
  }

  function syncCookingSelectionToActiveSession() {
    var id = cookingStore.activeSessionId;
    var session = id && cookingStore.sessionsById[id];
    if (!session || session.status === 'completed' || session.cycleId !== state.activeCycle.id) return;
    cookingWeek = Number(session.week) === 2 ? 2 : 1;
    cookingSessionKind = session.sessionKind === 'refresh' ? 'refresh' : 'main';
    var weekTabs = document.querySelector('[data-week-tabs="cooking"]');
    if (weekTabs) weekTabs.querySelectorAll('[data-week]').forEach(function (button) {
      button.classList.toggle('active', Number(button.getAttribute('data-week')) === cookingWeek);
    });
    var sessionTabs = document.getElementById('cookingSessionTabs');
    if (sessionTabs) sessionTabs.querySelectorAll('[data-cooking-session]').forEach(function (button) {
      var active = button.getAttribute('data-cooking-session') === cookingSessionKind;
      button.classList.toggle('active', active);
      button.setAttribute('aria-pressed', active ? 'true' : 'false');
    });
  }

  function persistCookingSession(session) {
    cookingStore.sessionsById[session.id] = session;
    cookingStore.activeSessionId = session.status === 'completed' ? null : session.id;
    if (session.status === 'completed') {
      cookingStore.lastSessionId = session.id;
      if (!cookingStore.lastSessionIdsByWeek) cookingStore.lastSessionIdsByWeek = {};
      cookingStore.lastSessionIdsByWeek[session.cycleId + ':' + session.week + ':' + (session.sessionKind || 'main')] = session.id;
      if (!Array.isArray(cookingStore.calibrationSessionIds)) cookingStore.calibrationSessionIds = [];
      if (cookingStore.calibrationSessionIds.indexOf(session.id) === -1) cookingStore.calibrationSessionIds.push(session.id);
    }
    saveCookingStore();
  }

  function entryForAction(plan, actionId) {
    return plan.schedule.find(function (entry) { return entry.actionId === actionId; }) || null;
  }

  function getSelectedCookingEntry(plan) {
    if (!selectedCookingActionId || !plan || !Array.isArray(plan.schedule)) return null;
    return entryForAction(plan, selectedCookingActionId);
  }

  function rebuildCookingPlanAfterDurationChange(plan) {
    cookingStore = NutritionCookingCore.invalidateWeek(cookingStore, plan.cycleId, plan.week);
    saveCookingStore();
    var rebuiltPlan = ensureCookingPlan(cookingWeek, cookingSessionKind, { force: true });
    if (!getSelectedCookingEntry(rebuiltPlan)) selectedCookingActionId = null;
    renderCooking();
    return rebuiltPlan;
  }

  function updateCookingActionDuration(plan, actionId, updateProfile) {
    var actions = plan && Array.isArray(plan.actions) ? plan.actions : [];
    var action = actions.find(function (item) { return item && item.id === actionId; });
    var activeSessionId = cookingStore.activeSessionId;
    var activeSession = activeSessionId && cookingStore.sessionsById[activeSessionId];
    if (!action) return { ok: false, error: 'шаг готовки не найден' };
    if (hasActiveCookingSession() || !NutritionCookingCore.canEditActionDuration(activeSession, actionId)) {
      return { ok: false, error: 'сначала заверши активную сессию готовки' };
    }
    var updated = updateProfile(kitchenProfile, action, plan.batches);
    if (!updated.ok) return updated;
    var previousKitchenProfile = kitchenProfile;
    var previousCookingStore = cookingStore;
    try {
      kitchenProfile = updated.profile;
      saveKitchenProfile();
      var rebuiltPlan = rebuildCookingPlanAfterDurationChange(plan);
      return { ok: true, key: updated.key, plan: rebuiltPlan };
    } catch (error) {
      kitchenProfile = previousKitchenProfile;
      cookingStore = previousCookingStore;
      try {
        saveKitchenProfile();
        saveCookingStore();
      } catch (_) {}
      return { ok: false, error: error.message || 'не удалось сохранить длительность шага' };
    }
  }

  function saveCookingActionDuration(plan, actionId, minutes) {
    return updateCookingActionDuration(plan, actionId, function (profile, action, batches) {
      return NutritionCookingCore.setActionDurationOverride(profile, action, batches, minutes);
    });
  }

  function resetCookingActionDuration(plan, actionId) {
    return updateCookingActionDuration(plan, actionId, function (profile, action, batches) {
      return NutritionCookingCore.clearActionDurationOverride(profile, action, batches);
    });
  }

  function nextSessionEntry(plan, session) {
    var actionId = NutritionCookingCore.nextSessionActionId(plan.schedule, session);
    return actionId ? entryForAction(plan, actionId) : null;
  }

  function runSessionTransition(plan, transition, actionId) {
    var session = getActiveCookingSession(plan);
    var activeId = cookingStore.activeSessionId;
    var activeSession = activeId && cookingStore.sessionsById[activeId];
    if (!session && activeSession && activeSession.status !== 'completed' && activeSession.planHash !== plan.planHash) {
      cookingUiError[activeCookingPlanKey()] = 'сначала заверши активную сессию готовки';
      renderCooking();
      return;
    }
    if (!session) session = NutritionCookingCore.startSession(plan, Date.now());
    var result = transition(session, actionId, Date.now());
    if (!result.ok) {
      cookingUiError[activeCookingPlanKey()] = result.error.message;
      renderCooking();
      return;
    }
    if (result.session.status === 'completed') {
      var calibrated = NutritionCookingCore.applySessionCalibration(kitchenProfile, result.session);
      result.session = calibrated.session;
      kitchenProfile = calibrated.profile;
      saveKitchenProfile();
      persistCookingSession(result.session);
      cookingStore = NutritionCookingCore.invalidateWeek(cookingStore, state.activeCycle.id, cookingWeek);
      saveCookingStore();
      scheduleCookingGeneration(cookingWeek, result.session.sessionKind, 250);
    } else {
      persistCookingSession(result.session);
    }
    cookingUiError[activeCookingPlanKey()] = '';
    renderCooking();
  }

  function correctStepTime(plan, session, actionId) {
    var step = session.steps[actionId];
    var current = Math.max(1, Math.round(Number(step.actualMs) / 60000));
    var answer = window.prompt('фактическое время шага в минутах', String(current));
    if (answer === null) return;
    var corrected = NutritionCookingCore.setStepActualMinutes(session, actionId, Number(answer));
    if (!corrected.ok) {
      cookingUiError[activeCookingPlanKey()] = corrected.error.message;
      renderCooking();
      return;
    }
    if (corrected.session.status === 'completed' && corrected.session.calibrationBase) {
      var calibrationIds = Array.isArray(cookingStore.calibrationSessionIds) ? cookingStore.calibrationSessionIds.slice() : [];
      if (calibrationIds.indexOf(corrected.session.id) === -1) calibrationIds.push(corrected.session.id);
      var calibrationSessions = calibrationIds.map(function (sessionId) {
        return sessionId === corrected.session.id ? corrected.session : cookingStore.sessionsById[sessionId];
      }).filter(Boolean);
      var replayed = NutritionCookingCore.replaySessionCalibrations(kitchenProfile, calibrationSessions);
      replayed.sessions.forEach(function (session) { cookingStore.sessionsById[session.id] = session; });
      corrected.session = cookingStore.sessionsById[corrected.session.id] || corrected.session;
      kitchenProfile = replayed.profile;
      saveKitchenProfile();
      cookingStore = NutritionCookingCore.invalidateWeek(cookingStore, state.activeCycle.id, corrected.session.week);
      scheduleCookingGeneration(corrected.session.week, corrected.session.sessionKind, 250);
    }
    persistCookingSession(corrected.session);
    cookingUiError[activeCookingPlanKey()] = '';
    renderCookingNow(plan, document.getElementById('cookingNow'));
  }

  function renderCooking() {
    var context = document.getElementById('cookingWeekContext');
    var status = document.getElementById('cookingStatus');
    var overview = document.getElementById('cookingOverview');
    var timeline = document.getElementById('cookingTimeline');
    var now = document.getElementById('cookingNow');
    var legend = document.getElementById('cookingBatchLegend');
    if (!context || !status || !overview || !timeline || !now || !legend) return;
    var plan = ensureCookingPlan(cookingWeek, cookingSessionKind);
    var stateInfo = cookingStateLabel(cookingWeek, plan);
    var sessionTitle = cookingSessionKind === 'refresh' ? 'короткое обновление' : 'основная заготовка';
    context.textContent = 'неделя ' + cookingWeek + ' · ' + sessionTitle + ' · ' + formatBatchCount(plan.batches.length);
    status.className = 'cooking-status ' + stateInfo.name;
    status.textContent = cookingUiError[activeCookingPlanKey()] || stateInfo.label;
    var modeSelect = document.getElementById('kitchenModeSelect');
    if (modeSelect) modeSelect.value = kitchenProfile.activeMode;

    clearElement(overview);
    appendChildren(overview, [
      createElement('strong', '', formatMinutes(plan.estimate.minMinutes) + '–' + formatMinutes(plan.estimate.maxMinutes)),
      createElement('span', '', 'время одной сессии'),
      createElement('span', '', 'пик ' + plan.peakOutlets + ' роз.'),
      createElement('span', '', plan.source === 'ai' ? 'openrouter · ' + (plan.model || 'модель') : 'локально · без api'),
      createElement('span', '', plan.generatedAt ? 'обновлено ' + new Date(plan.generatedAt).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }) : '')
    ]);
    renderCookingTimeline(plan, timeline);
    renderCookingNow(plan, now);
    renderCookingLegend(plan, legend);
    applyBatchHighlight();
  }

  function resourceTitle(resourceId) {
    var resource = kitchenProfile.resources.find(function (item) { return item.id === resourceId; });
    return resource ? resource.title : resourceId;
  }

  function timelineLanes(plan) {
    var lanes = [{ id: 'user', title: 'ты', entries: plan.schedule.filter(function (entry) { return entry.userOccupied; }) }];
    var resourceIds = [];
    plan.schedule.forEach(function (entry) {
      entry.equipmentIds.forEach(function (id) {
        if (resourceIds.indexOf(id) === -1) resourceIds.push(id);
      });
    });
    resourceIds.forEach(function (id) {
      lanes.push({
        id: id,
        title: resourceTitle(id),
        entries: plan.schedule.filter(function (entry) { return entry.equipmentIds.indexOf(id) !== -1; })
      });
    });
    var passiveWithoutEquipment = plan.schedule.filter(function (entry) {
      return !entry.userOccupied && !entry.equipmentIds.length;
    });
    if (passiveWithoutEquipment.length) lanes.push({ id: 'process', title: 'ожидание', entries: passiveWithoutEquipment });
    return lanes;
  }

  var TIMELINE_PIXELS_PER_MINUTE = 7;
  var TIMELINE_RESOURCE_WIDTH = 140;
  var TIMELINE_MIN_SEGMENT_WIDTH = 260;

  function renderCookingTimeline(plan, container) {
    clearElement(container);
    if (!plan.schedule.length) {
      container.appendChild(createElement('div', 'cooking-empty', 'для этой недели нет действий готовки'));
      return;
    }
    var timelineScale = NutritionCore.buildTimelineScale(
      plan.schedule,
      plan.estimate.minMinutes,
      TIMELINE_PIXELS_PER_MINUTE,
      TIMELINE_MIN_SEGMENT_WIDTH
    );
    var duration = timelineScale.duration;
    var timelineWidth = TIMELINE_RESOURCE_WIDTH + Math.ceil(timelineScale.width);
    container.style.setProperty('--timeline-width', timelineWidth + 'px');
    var ruler = createElement('div', 'timeline-ruler');
    ruler.appendChild(createElement('div', 'timeline-ruler-label', 'ресурс'));
    var scale = createElement('div', 'timeline-scale');
    [0, 25, 50, 75, 100].forEach(function (percent) {
      var tick = createElement('span', 'timeline-tick', formatMinutes(duration * percent / 100));
      tick.style.left = timelineScale.positionAt(duration * percent / 100) + 'px';
      scale.appendChild(tick);
    });
    ruler.appendChild(scale);
    container.appendChild(ruler);

    timelineLanes(plan).forEach(function (lane) {
      var row = createElement('div', 'timeline-lane');
      row.appendChild(createElement('div', 'timeline-lane-name', lane.title));
      var track = createElement('div', 'timeline-track');
      [0, 25, 50, 75, 100].forEach(function (percent) {
        var guide = createElement('span', 'timeline-guide');
        guide.style.left = timelineScale.positionAt(duration * percent / 100) + 'px';
        track.appendChild(guide);
      });
      lane.entries.forEach(function (entry) {
        var batch = plan.batches.find(function (item) { return item.id === entry.batchId; });
        var block = createElement('button', 'timeline-block ' + entry.mode + ' batch-color-' + (batch ? batch.colorIndex : 0));
        block.type = 'button';
        block.setAttribute('data-batch-id', entry.batchId);
        var blockStart = timelineScale.positionAt(entry.startMinute);
        block.style.left = blockStart + 'px';
        block.style.width = Math.max(2, timelineScale.positionAt(entry.endMinute) - blockStart) + 'px';
        block.title = entry.title + ' · ' + entry.location + ' · ' + formatMinutes(entry.durationMinutes);
        appendChildren(block, [
          createElement('strong', '', entry.title),
          createElement('span', '', formatMinutes(entry.startMinute) + ' → ' + formatMinutes(entry.endMinute))
        ]);
        block.addEventListener('click', function () {
          activeBatchId = activeBatchId === entry.batchId ? null : entry.batchId;
          renderCooking();
        });
        track.appendChild(block);
      });
      row.appendChild(track);
      container.appendChild(row);
    });
  }

  function actionMeta(entry) {
    var pieces = [];
    entry.equipmentIds.forEach(function (id) { pieces.push(resourceTitle(id)); });
    entry.cookwareIds.forEach(function (id) { pieces.push(resourceTitle(id)); });
    if (entry.outletIds.length) pieces.push(entry.location === 'room' ? 'комната' : 'кухня');
    entry.outletIds.forEach(function (id) { pieces.push(id.replace('-outlet-', ' · розетка ')); });
    return pieces.length ? pieces.join(' · ') : 'без отдельного оборудования';
  }

  function renderCookingNow(plan, container) {
    clearElement(container);
    var session = getActiveCookingSession(plan);
    var journalSession = session || getLastCookingSession(plan);
    var current = nextSessionEntry(plan, session);
    if (!current) {
      container.appendChild(createElement('div', 'cooking-empty', session ? 'все шаги сессии завершены' : 'готовить нечего'));
      return;
    }
    var currentStep = session && session.steps[current.actionId];
    var currentStatus = currentStep ? currentStep.status : 'pending';
    var passive = session ? plan.schedule.filter(function (entry) {
      var step = session.steps[entry.actionId];
      return step && step.mode === 'passive' && (step.status === 'running' || step.status === 'paused');
    }) : plan.schedule.filter(function (entry) {
      return !entry.userOccupied && entry.startMinute <= current.startMinute && entry.endMinute > current.startMinute;
    });
    var next = plan.schedule.find(function (entry) {
      return entry.userOccupied && entry.startMinute >= current.endMinute && entry.actionId !== current.actionId;
    });
    appendChildren(container, [
      createElement('div', 'cooking-now-eyebrow', currentStatus === 'running' ? 'в работе' : currentStatus === 'paused' ? 'на паузе' : 'делай сейчас'),
      createElement('h3', 'cooking-now-title', current.title),
      createElement('div', 'cooking-now-meta', formatMinutes(current.durationMinutes) + ' · ' + actionMeta(current)),
      next ? createElement('div', 'cooking-now-meta', 'дальше: ' + next.title) : null
    ]);
    var passiveBlock = createElement('div', 'cooking-now-passive');
    passiveBlock.appendChild(createElement('strong', '', 'параллельно'));
    passiveBlock.appendChild(createElement('span', '', passive.length
      ? passive.map(function (entry) { return entry.title + ' до ' + formatMinutes(entry.endMinute); }).join(' · ')
      : 'пассивных процессов пока нет'));
    container.appendChild(passiveBlock);
    var actions = createElement('div', 'cooking-now-actions');
    var start = createElement('button', 'primary-btn', 'начать');
    var pause = createElement('button', 'quiet-btn', 'пауза');
    var done = createElement('button', 'quiet-btn', 'готово');
    var skip = createElement('button', 'quiet-btn', 'пропустить');
    start.type = pause.type = done.type = skip.type = 'button';
    start.id = 'cookingStartStepBtn';
    pause.id = 'cookingPauseStepBtn';
    done.id = 'cookingCompleteStepBtn';
    skip.id = 'cookingSkipStepBtn';
    start.textContent = currentStatus === 'paused' ? 'продолжить' : 'начать';
    start.disabled = currentStatus === 'running';
    pause.disabled = currentStatus !== 'running';
    done.disabled = currentStatus !== 'running' && currentStatus !== 'paused';
    start.addEventListener('click', function () {
      runSessionTransition(plan, NutritionCookingCore.startStep, current.actionId);
    });
    pause.addEventListener('click', function () {
      runSessionTransition(plan, NutritionCookingCore.pauseStep, current.actionId);
    });
    done.addEventListener('click', function () {
      runSessionTransition(plan, NutritionCookingCore.completeStep, current.actionId);
    });
    skip.addEventListener('click', function () {
      var hasDependents = plan.actions.some(function (action) {
        return Array.isArray(action.dependsOn) && action.dependsOn.indexOf(current.actionId) !== -1;
      });
      if (hasDependents && !window.confirm('пропустить шаг? зависящие от него действия будут разблокированы без проверки результата.')) return;
      runSessionTransition(plan, NutritionCookingCore.skipStep, current.actionId);
    });
    appendChildren(actions, [start, pause, done, skip]);
    container.appendChild(actions);

    if (journalSession) {
      var completedIds = journalSession.actions.map(function (action) { return action.id; }).filter(function (actionId) {
        return journalSession.steps[actionId] && journalSession.steps[actionId].status === 'done';
      });
      if (completedIds.length) {
        var completed = createElement('div', 'cooking-now-passive');
        completed.appendChild(createElement('strong', '', 'последний завершённый'));
        var lastId = completedIds[completedIds.length - 1];
        var lastAction = journalSession.actions.find(function (action) { return action.id === lastId; });
        var lastStep = journalSession.steps[lastId];
        var factor = journalSession.calibrationResult && journalSession.calibrationResult.factors[lastStep.category];
        var summary = (lastAction ? lastAction.title : lastId) + ' · ' + formatMinutes(lastStep.actualMs / 60000);
        if (Number.isFinite(factor)) summary += ' · коэффициент ×' + factor.toFixed(2);
        completed.appendChild(createElement('span', '', summary));
        var correctionIds = completedIds.filter(function (actionId) {
          return journalSession.steps[actionId].mode === 'active';
        });
        if (correctionIds.length) {
          var correctionTools = createElement('div', 'cooking-correction-tools');
          var correctionSelect = createElement('select', 'field-control cooking-correction-select');
          correctionSelect.setAttribute('aria-label', 'завершённый шаг для исправления времени');
          correctionIds.forEach(function (actionId) {
            var action = journalSession.actions.find(function (item) { return item.id === actionId; });
            var step = journalSession.steps[actionId];
            var option = document.createElement('option');
            option.value = actionId;
            option.textContent = (action ? action.title : actionId) + ' · ' + formatMinutes(step.actualMs / 60000);
            correctionSelect.appendChild(option);
          });
          correctionSelect.value = correctionIds.indexOf(lastId) !== -1 ? lastId : correctionIds[correctionIds.length - 1];
          var correct = createElement('button', 'quiet-btn', 'исправить время');
          correct.type = 'button';
          correct.addEventListener('click', function () { correctStepTime(plan, journalSession, correctionSelect.value); });
          appendChildren(correctionTools, [correctionSelect, correct]);
          completed.appendChild(correctionTools);
        }
        container.appendChild(completed);
      }
    }
  }

  function renderCookingLegend(plan, container) {
    clearElement(container);
    plan.batches.filter(function (batch) { return batch.strategy !== 'outside'; }).forEach(function (batch) {
      var button = createElement('button', 'cooking-batch-chip batch-color-' + batch.colorIndex, batch.label);
      button.type = 'button';
      button.setAttribute('data-batch-id', batch.id);
      button.addEventListener('click', function () {
        activeBatchId = activeBatchId === batch.id ? null : batch.id;
        renderCooking();
      });
      container.appendChild(button);
    });
  }

  function renderHistory() {
    var container = document.getElementById('historyList');
    var summary = document.getElementById('historySummary');
    if (!container || !summary) return;
    clearElement(container);
    clearElement(summary);
    if (!state.history.length) {
      summary.hidden = true;
      var empty = createElement('div', 'empty-state');
      appendChildren(empty, [createElement('strong', '', 'завершённых циклов пока нет'), createElement('span', '', 'первый результат появится после 14 дней')]);
      container.appendChild(empty);
      return;
    }
    summary.hidden = false;
    var pricedHistory = state.history.filter(function (item) { return Number.isFinite(item.shoppingCostRub); });
    var latestCost = pricedHistory.length ? pricedHistory[pricedHistory.length - 1].shoppingCostRub : null;
    var averageCost = pricedHistory.length ? Math.round(pricedHistory.reduce(function (total, item) { return total + item.shoppingCostRub; }, 0) / pricedHistory.length) : null;
    [
      ['завершено циклов', String(state.history.length)],
      ['последний расход', latestCost === null ? 'нет данных' : formatRub(latestCost)],
      ['средний расход', averageCost === null ? 'нет данных' : formatRub(averageCost)]
    ].forEach(function (metric) {
      var stat = createElement('div', 'history-stat');
      appendChildren(stat, [createElement('span', 'history-stat-label', metric[0]), createElement('strong', 'history-stat-value', metric[1])]);
      summary.appendChild(stat);
    });
    state.history.slice().reverse().forEach(function (item) {
      var row = createElement('article', 'history-item');
      appendChildren(row, [
        createElement('div', 'history-date', formatDate(item.startDate) + ' — ' + formatDate(item.endDate)),
        createElement('div', 'history-metric', item.completedMeals + ' / ' + item.plannedMeals + ' приёмов'),
        createElement('div', 'history-metric', item.adherencePercent + '% · ' + item.trainingDays + ' тренировок'),
        createElement('div', 'history-metric history-cost', Number.isFinite(item.shoppingCostRub) ? formatRub(item.shoppingCostRub) : 'расход не зафиксирован')
      ]);
      container.appendChild(row);
    });
  }

  function openReplaceDialog(slot, mealType) {
    replacementTarget = { day: selectedDay, slot: slot, mealType: mealType };
    var dialog = document.getElementById('replaceDialog');
    var list = document.getElementById('replaceList');
    clearElement(list);
    catalog.filter(function (meal) { return meal.mealType === mealType; }).forEach(function (meal) {
      var button = createElement('button', 'replace-option');
      button.type = 'button';
      appendChildren(button, [
        createElement('strong', '', meal.title),
        createElement('span', '', formatRange(meal.caloriesApprox, 'ккал') + ' · ' + formatRange(meal.proteinApprox, 'г белка') + ' · ' + formatRange(meal.estimatedCostRub, '₽'))
      ]);
      button.addEventListener('click', function () {
        var affectedWeek = getWeekForDay(replacementTarget.day);
        var key = cycleKey(replacementTarget.day, replacementTarget.slot);
        state.overrides[key] = meal.id;
        saveState();
        cookingStore = NutritionCookingCore.invalidateWeek(cookingStore, state.activeCycle.id, affectedWeek);
        saveCookingStore();
        activeBatchId = null;
        if (replacementTarget.slot === 'lunch') scheduleCookingGeneration(affectedWeek, 'main', 450);
        if (replacementTarget.slot === 'dinner') scheduleCookingGeneration(affectedWeek, 'refresh', 450);
        closeReplaceDialog();
        renderToday();
        renderCycle();
        renderShopping();
        renderCooking();
      });
      list.appendChild(button);
    });
    if (typeof dialog.showModal === 'function') dialog.showModal();
    else dialog.setAttribute('open', '');
  }

  function closeReplaceDialog() {
    var dialog = document.getElementById('replaceDialog');
    replacementTarget = null;
    if (dialog && typeof dialog.close === 'function') dialog.close();
    else if (dialog) dialog.removeAttribute('open');
  }

  function renderAll() {
    renderCycleMark();
    renderToday();
    renderCycle();
    renderCatalog();
    renderShopping();
    renderCooking();
    renderHistory();
  }

  function setWeek(kind, week) {
    var safeWeek = Number(week) === 2 ? 2 : 1;
    if (kind === 'cooking') {
      var activeId = cookingStore.activeSessionId;
      var activeSession = activeId && cookingStore.sessionsById[activeId];
      if (activeSession && activeSession.status !== 'completed' && Number(activeSession.week) !== safeWeek) {
        cookingUiError[activeCookingPlanKey()] = 'сначала заверши активную сессию готовки';
        renderCooking();
        return;
      }
    }
    if (kind === 'cycle') cycleWeek = safeWeek;
    if (kind === 'shopping') shoppingWeek = safeWeek;
    if (kind === 'cooking') cookingWeek = safeWeek;
    var tabs = document.querySelector('[data-week-tabs="' + kind + '"]');
    if (tabs) tabs.querySelectorAll('[data-week]').forEach(function (button) {
      button.classList.toggle('active', Number(button.getAttribute('data-week')) === safeWeek);
    });
    if (kind === 'cycle') renderCycle();
    if (kind === 'shopping') renderShopping();
    if (kind === 'cooking') renderCooking();
  }

  function setCookingSession(sessionKind) {
    var kind = sessionKind === 'refresh' ? 'refresh' : 'main';
    var activeId = cookingStore.activeSessionId;
    var activeSession = activeId && cookingStore.sessionsById[activeId];
    if (activeSession && activeSession.status !== 'completed' && (activeSession.sessionKind || 'main') !== kind) {
      cookingUiError[activeCookingPlanKey()] = 'сначала заверши активную сессию готовки';
      renderCooking();
      return;
    }
    cookingSessionKind = kind;
    activeBatchId = null;
    var tabs = document.getElementById('cookingSessionTabs');
    if (tabs) tabs.querySelectorAll('[data-cooking-session]').forEach(function (button) {
      var active = button.getAttribute('data-cooking-session') === kind;
      button.classList.toggle('active', active);
      button.setAttribute('aria-pressed', active ? 'true' : 'false');
    });
    renderCooking();
  }

  function wireEvents() {
    document.querySelectorAll('[data-menu-view]').forEach(function (button) {
      button.addEventListener('click', function () { switchView(button.getAttribute('data-menu-view')); });
    });
    var viewSelect = document.getElementById('menuViewSelect');
    viewSelect.addEventListener('change', function () { switchView(viewSelect.value); });
    document.querySelectorAll('[data-open-view]').forEach(function (link) {
      link.addEventListener('click', function (event) {
        event.preventDefault();
        var view = link.getAttribute('data-open-view');
        var week = getWeekForDay(selectedDay);
        if (view === 'shopping') setWeek('shopping', week);
        if (view === 'cooking') setWeek('cooking', week);
        switchView(view);
      });
    });
    document.querySelectorAll('[data-week-tabs]').forEach(function (tabs) {
      tabs.addEventListener('click', function (event) {
        var button = event.target.closest('[data-week]');
        if (button) setWeek(tabs.getAttribute('data-week-tabs'), button.getAttribute('data-week'));
      });
    });
    document.getElementById('cookingSessionTabs').addEventListener('click', function (event) {
      var button = event.target.closest('[data-cooking-session]');
      if (button) setCookingSession(button.getAttribute('data-cooking-session'));
    });
    document.getElementById('kitchenModeSelect').addEventListener('change', function (event) {
      if (hasActiveCookingSession()) {
        event.target.value = kitchenProfile.activeMode;
        cookingUiError[activeCookingPlanKey()] = 'сначала заверши активную сессию готовки';
        renderCooking();
        return;
      }
      kitchenProfile.activeMode = event.target.value === 'winter' ? 'winter' : 'extended';
      kitchenProfile = NutritionCookingCore.normalizeKitchenProfile(kitchenProfile);
      saveKitchenProfile();
      cookingStore = NutritionCookingCore.invalidateWeek(cookingStore, state.activeCycle.id, 1);
      cookingStore = NutritionCookingCore.invalidateWeek(cookingStore, state.activeCycle.id, 2);
      saveCookingStore();
      scheduleCookingGeneration(cookingWeek, cookingSessionKind, 10);
      renderCycle();
      renderCooking();
    });
    document.getElementById('regenerateCookingBtn').addEventListener('click', function () {
      if (hasActiveCookingSession()) {
        cookingUiError[activeCookingPlanKey()] = 'сначала заверши активную сессию готовки';
        renderCooking();
        return;
      }
      cookingStore = NutritionCookingCore.invalidateWeek(cookingStore, state.activeCycle.id, cookingWeek);
      saveCookingStore();
      scheduleCookingGeneration(cookingWeek, cookingSessionKind, 10);
      renderCooking();
    });
    document.getElementById('resetCookingCalibrationBtn').addEventListener('click', function () {
      if (hasActiveCookingSession()) {
        cookingUiError[activeCookingPlanKey()] = 'сначала заверши активную сессию готовки';
        renderCooking();
        return;
      }
      if (!window.confirm('сбросить накопленный темп готовки? журнал сессий останется.')) return;
      kitchenProfile = NutritionCookingCore.resetCalibration(kitchenProfile);
      cookingStore.lastSessionId = null;
      cookingStore.lastSessionIdsByWeek = {};
      cookingStore.calibrationSessionIds = [];
      saveKitchenProfile();
      cookingStore = NutritionCookingCore.invalidateWeek(cookingStore, state.activeCycle.id, 1);
      cookingStore = NutritionCookingCore.invalidateWeek(cookingStore, state.activeCycle.id, 2);
      saveCookingStore();
      scheduleCookingGeneration(cookingWeek, cookingSessionKind, 10);
      renderCooking();
    });
    document.getElementById('clearCookingCacheBtn').addEventListener('click', function () {
      if (!window.confirm('удалить кеш планов готовки? рацион и блюда останутся без изменений.')) return;
      cookingClient.abort();
      cookingStore = NutritionCookingCore.clearCachedPlans(cookingStore);
      cookingUiState = {};
      cookingUiError = {};
      saveCookingStore();
      renderCycle();
      renderCooking();
    });
    document.getElementById('previousDayBtn').addEventListener('click', function () {
      selectedDay = Math.max(1, selectedDay - 1);
      renderToday();
    });
    document.getElementById('nextDayBtn').addEventListener('click', function () {
      selectedDay = Math.min(14, selectedDay + 1);
      renderToday();
    });
    document.getElementById('trainingToggle').addEventListener('change', function (event) {
      var key = cycleKey(selectedDay);
      if (event.target.checked) {
        state.trainingDays[key] = true;
        if (!state.trainingExtras[key]) state.trainingExtras[key] = NutritionData.trainingExtras[0].mealId;
      } else {
        delete state.trainingDays[key];
      }
      saveState();
      renderToday();
      renderCycle();
    });
    document.getElementById('cycleStartDate').addEventListener('change', function (event) {
      var safeDate = NutritionCore.normalizeLocalDate(event.target.value);
      if (!safeDate) return;
      state.activeCycle.startDate = safeDate;
      var current = NutritionCore.getCycleDay(safeDate, NutritionCore.getLocalDateKey());
      selectedDay = current ? current.dayNumber : 1;
      saveState();
      renderAll();
    });
    ['dishSearch', 'dishTypeFilter', 'dishSourceFilter'].forEach(function (id) {
      var element = document.getElementById(id);
      element.addEventListener(id === 'dishSearch' ? 'input' : 'change', renderCatalog);
    });
    document.getElementById('importMealsBtn').addEventListener('click', function () {
      document.getElementById('importMealsFile').click();
    });
    document.getElementById('importMealsFile').addEventListener('change', function (event) {
      importMealsFile(event.target.files[0]);
      event.target.value = '';
    });
    document.getElementById('replaceDialogClose').addEventListener('click', closeReplaceDialog);
    window.addEventListener('hashchange', function () {
      switchView(window.location.hash.slice(1), false);
    });
    function reloadStoredData(changedKeys) {
      var keys = Array.isArray(changedKeys) ? changedKeys : [];
      var supportedKeys = [STATE_KEY, PRICES_KEY, MEALS_KEY, KITCHEN_PROFILE_KEY, COOKING_PLANS_KEY];
      if (!keys.some(function (key) { return supportedKeys.indexOf(key) !== -1; })) return;
      if (keys.indexOf(MEALS_KEY) !== -1) loadImportedMeals();
      if (keys.indexOf(STATE_KEY) !== -1 || keys.indexOf(PRICES_KEY) !== -1) loadState();
      if (keys.indexOf(KITCHEN_PROFILE_KEY) !== -1 || keys.indexOf(COOKING_PLANS_KEY) !== -1) loadCookingData();
      renderAll();
    }
    window.addEventListener('storage', function (event) {
      reloadStoredData(event ? [event.key] : []);
    });
    window.addEventListener('dashboard-sync-applied', function (event) {
      var changedKeys = event && event.detail ? event.detail.changedKeys : [];
      reloadStoredData(changedKeys);
    });
  }

  function boot() {
    loadImportedMeals();
    loadState();
    loadCookingData();
    syncCookingSelectionToActiveSession();
    wireEvents();
    var initialView = window.location.hash.slice(1);
    switchView(initialView || DEFAULT_VIEW, false);
    renderAll();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
