(function () {
  'use strict';

  var STATE_KEY = 'nutrition_state_v1';
  var MEALS_KEY = 'nutrition_meals_v1';
  var DEFAULT_VIEW = 'today';
  var VIEWS = ['today', 'cycle', 'dishes', 'shopping', 'cooking', 'history'];
  var MAIN_SLOTS = ['breakfast', 'lunch', 'dinner'];
  var SLOT_LABELS = { breakfast: 'завтрак', lunch: 'обед', dinner: 'ужин' };
  var Gamification = window.Gamification;
  var NutritionCore = window.NutritionCore;
  var NutritionData = window.NutritionData;

  if (!Gamification || !NutritionCore || !NutritionData) return;

  var state;
  var importedMeals = [];
  var catalog = [];
  var selectedDay = 1;
  var shoppingWeek = 1;
  var cookingWeek = 1;
  var activeView = DEFAULT_VIEW;
  var replacementTarget = null;

  function getStored(key) {
    return Gamification.storeGet(key);
  }

  function saveState() {
    Gamification.storeSet(STATE_KEY, state);
  }

  function saveImportedMeals() {
    Gamification.storeSet(MEALS_KEY, { version: 1, meals: importedMeals });
  }

  function loadImportedMeals() {
    var stored = getStored(MEALS_KEY);
    var checked = NutritionCore.validateImportedCatalog(stored, NutritionData.meals, []);
    importedMeals = checked.ok ? checked.meals : [];
    catalog = NutritionCore.mergeCatalog(NutritionData.meals, importedMeals);
  }

  function loadState() {
    var todayKey = NutritionCore.getLocalDateKey();
    state = NutritionCore.normalizeState(getStored(STATE_KEY), todayKey);
    if (!getStored(STATE_KEY)) saveState();
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

  function isTrainingDay(dayNumber) {
    return state.trainingDays[cycleKey(dayNumber)] === true;
  }

  function currentDayPlan(dayNumber) {
    return NutritionCore.resolveDayPlan(NutritionData.plan14, state, dayNumber, catalog);
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
    var snapshot = NutritionCore.createCycleSnapshot(state, NutritionData.plan14, catalog);
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

    renderDaySummary(dayPlan, trainingExtra);
    var list = document.getElementById('todayMeals');
    clearElement(list);
    MAIN_SLOTS.forEach(function (slot) {
      if (dayPlan.meals[slot]) list.appendChild(createMealRow(slot, dayPlan.meals[slot]));
    });
    renderTrainingExtra(trainingExtra);
    var week = getWeekForDay(selectedDay);
    var shoppingMeta = document.getElementById('shoppingQuickMeta');
    var cookingMeta = document.getElementById('cookingQuickMeta');
    if (shoppingMeta) shoppingMeta.textContent = 'неделя ' + week;
    if (cookingMeta) cookingMeta.textContent = 'неделя ' + week + ' · ≈80–100 мин';
    renderCycleCompleteActions();
  }

  function renderCycle() {
    var grid = document.getElementById('cycleGrid');
    clearElement(grid);
    var todayInfo = NutritionCore.getCycleDay(state.activeCycle.startDate, NutritionCore.getLocalDateKey());
    for (var dayNumber = 1; dayNumber <= 14; dayNumber++) {
      (function (day) {
        var plan = currentDayPlan(day);
        var extra = isTrainingDay(day) ? getTrainingExtra(day) : null;
        var summary = NutritionCore.calculateDaySummary(plan, catalog, extra);
        var button = createElement('button', 'cycle-day');
        button.type = 'button';
        if (todayInfo && !todayInfo.completed && day === todayInfo.dayNumber) button.classList.add('current');
        var head = createElement('div', 'cycle-day-head');
        appendChildren(head, [
          createElement('span', 'cycle-day-number', 'день ' + day + (isTrainingDay(day) ? ' · тренировка' : '')),
          createElement('span', 'cycle-day-date', formatDate(getDayDate(day), { day: 'numeric', month: 'short' }))
        ]);
        button.appendChild(head);
        var mealsList = createElement('div', 'cycle-meals');
        MAIN_SLOTS.forEach(function (slot) {
          var selected = plan.meals[slot];
          if (selected) mealsList.appendChild(createElement('span', '', SLOT_LABELS[slot] + ': ' + selected.title));
        });
        button.appendChild(mealsList);
        var completeCount = MAIN_SLOTS.filter(function (slot) { return state.completions[cycleKey(day, slot)] === true; }).length;
        button.appendChild(createElement('div', 'cycle-day-summary', completeCount + '/3 · ' + formatRange(summary.caloriesApprox, 'ккал') + ' · ' + formatRange(summary.proteinApprox, 'г белка')));
        button.addEventListener('click', function () {
          selectedDay = day;
          switchView('today');
          window.scrollTo({ top: 0, behavior: 'smooth' });
        });
        grid.appendChild(button);
      })(dayNumber);
    }
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
    if (!container) return;
    clearElement(container);
    var items = NutritionCore.buildShoppingList(NutritionData.plan14, state, catalog, shoppingWeek);
    var groups = groupShopping(items);
    Object.keys(NutritionData.ingredientCategories).forEach(function (category) {
      if (!groups[category] || !groups[category].length) return;
      var section = createElement('section');
      section.appendChild(createElement('h3', 'shopping-group-title', NutritionData.ingredientCategories[category]));
      var list = createElement('div', 'shopping-list');
      groups[category].forEach(function (item) {
        var key = state.activeCycle.id + ':' + shoppingWeek + ':' + item.id + ':' + item.unit;
        var row = createElement('label', 'shopping-item');
        var checkbox = createElement('input');
        checkbox.type = 'checkbox';
        checkbox.checked = state.shoppingChecks[key] === true;
        row.classList.toggle('checked', checkbox.checked);
        checkbox.addEventListener('change', function () {
          if (checkbox.checked) state.shoppingChecks[key] = true;
          else delete state.shoppingChecks[key];
          saveState();
          row.classList.toggle('checked', checkbox.checked);
        });
        appendChildren(row, [checkbox, createElement('span', 'shopping-name', item.name), createElement('span', 'shopping-amount', formatIngredientAmount(item.amount) + ' ' + item.unit)]);
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

  function renderCooking() {
    var container = document.getElementById('cookingSessions');
    var context = document.getElementById('cookingWeekContext');
    if (!container) return;
    clearElement(container);
    if (context) context.textContent = 'готовка на неделю ' + cookingWeek;
    var sessions = NutritionData.cookingSessions[cookingWeek] || [];
    sessions.forEach(function (session) {
      var block = createElement('section', 'cooking-session');
      var head = createElement('div', 'cooking-session-head');
      var title = createElement('div');
      appendChildren(title, [
        createElement('h3', 'cooking-session-title', session.title),
        createElement('div', 'cooking-session-meta', session.scheduleLabel + ' · ' + session.durationLabel)
      ]);
      head.appendChild(title);
      block.appendChild(head);
      var list = createElement('div', 'prep-list');
      session.steps.forEach(function (step) {
        var key = state.activeCycle.id + ':' + cookingWeek + ':' + session.id + ':' + step.id;
        var row = createElement('label', 'prep-step');
        var checkbox = createElement('input');
        checkbox.type = 'checkbox';
        checkbox.checked = state.cookingChecks[key] === true;
        row.classList.toggle('checked', checkbox.checked);
        checkbox.addEventListener('change', function () {
          if (checkbox.checked) state.cookingChecks[key] = true;
          else delete state.cookingChecks[key];
          saveState();
          row.classList.toggle('checked', checkbox.checked);
        });
        appendChildren(row, [checkbox, createElement('span', '', step.title)]);
        list.appendChild(row);
      });
      block.appendChild(list);
      container.appendChild(block);
    });
  }

  function renderHistory() {
    var container = document.getElementById('historyList');
    if (!container) return;
    clearElement(container);
    if (!state.history.length) {
      var empty = createElement('div', 'empty-state');
      appendChildren(empty, [createElement('strong', '', 'завершённых циклов пока нет'), createElement('span', '', 'первый результат появится после 14 дней')]);
      container.appendChild(empty);
      return;
    }
    state.history.slice().reverse().forEach(function (item) {
      var row = createElement('article', 'history-item');
      appendChildren(row, [
        createElement('div', 'history-date', formatDate(item.startDate) + ' — ' + formatDate(item.endDate)),
        createElement('div', 'history-metric', item.completedMeals + ' / ' + item.plannedMeals + ' приёмов'),
        createElement('div', 'history-metric', item.adherencePercent + '% · ' + item.trainingDays + ' тренировок')
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
        var key = cycleKey(replacementTarget.day, replacementTarget.slot);
        state.overrides[key] = meal.id;
        saveState();
        closeReplaceDialog();
        renderToday();
        renderCycle();
        renderShopping();
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
    if (kind === 'shopping') shoppingWeek = safeWeek;
    if (kind === 'cooking') cookingWeek = safeWeek;
    var tabs = document.querySelector('[data-week-tabs="' + kind + '"]');
    if (tabs) tabs.querySelectorAll('[data-week]').forEach(function (button) {
      button.classList.toggle('active', Number(button.getAttribute('data-week')) === safeWeek);
    });
    if (kind === 'shopping') renderShopping();
    if (kind === 'cooking') renderCooking();
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
    window.addEventListener('storage', function (event) {
      if (!event || (event.key !== STATE_KEY && event.key !== MEALS_KEY)) return;
      if (event.key === MEALS_KEY) loadImportedMeals();
      if (event.key === STATE_KEY) loadState();
      renderAll();
    });
  }

  function boot() {
    loadImportedMeals();
    loadState();
    wireEvents();
    var initialView = window.location.hash.slice(1);
    switchView(initialView || DEFAULT_VIEW, false);
    renderAll();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
