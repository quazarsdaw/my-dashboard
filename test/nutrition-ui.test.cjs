const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

function read(file) {
  return fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
}

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function durationOverrideKey(action, batches) {
  const batch = (batches || []).find((item) => item && action && item.id === action.batchId);
  const mealId = batch && batch.mealId;
  const title = String(action && action.title || '').trim().toLowerCase().replace(/\s+/g, ' ');
  const category = String(action && action.category || '').trim().toLowerCase().replace(/\s+/g, ' ');
  return mealId && title && category ? [mealId, category, title].join('::') : '';
}

class FakeClassList {
  constructor(element) {
    this.element = element;
  }

  values() {
    return this.element.className.split(/\s+/).filter(Boolean);
  }

  write(values) {
    this.element.className = Array.from(new Set(values)).join(' ');
  }

  add(...names) {
    this.write(this.values().concat(names));
  }

  contains(name) {
    return this.values().includes(name);
  }

  toggle(name, force) {
    const values = this.values().filter((value) => value !== name);
    const enabled = force === undefined ? !this.contains(name) : Boolean(force);
    if (enabled) values.push(name);
    this.write(values);
    return enabled;
  }
}

function matchesSelector(element, selector) {
  if (selector.startsWith('.')) {
    return selector.slice(1).split('.').every((className) => element.classList.contains(className));
  }
  const attribute = selector.match(/^\[([^\]=]+)(?:="([^"]*)")?\]$/);
  if (attribute) {
    const value = element.getAttribute(attribute[1]);
    return attribute[2] === undefined ? value !== null : value === attribute[2];
  }
  return element.tagName.toLowerCase() === selector.toLowerCase();
}

class FakeElement {
  constructor(tagName) {
    this.tagName = tagName.toUpperCase();
    this.className = '';
    this.classList = new FakeClassList(this);
    this.children = [];
    this.parentNode = null;
    this.attributes = new Map();
    this.listeners = new Map();
    this.pointerCaptures = new Set();
    this.style = {
      setProperty: (name, value) => {
        this.style[name] = value;
      }
    };
    this.textContent = '';
    this.scrollLeft = 0;
    this.tabIndex = -1;
  }

  get firstChild() {
    return this.children[0] || null;
  }

  appendChild(child) {
    child.parentNode = this;
    this.children.push(child);
    return child;
  }

  removeChild(child) {
    const index = this.children.indexOf(child);
    if (index !== -1) this.children.splice(index, 1);
    child.parentNode = null;
    return child;
  }

  setAttribute(name, value) {
    this.attributes.set(name, String(value));
  }

  getAttribute(name) {
    return this.attributes.has(name) ? this.attributes.get(name) : null;
  }

  removeAttribute(name) {
    this.attributes.delete(name);
  }

  addEventListener(type, listener) {
    if (!this.listeners.has(type)) this.listeners.set(type, []);
    this.listeners.get(type).push(listener);
  }

  dispatch(type, values = {}) {
    const event = Object.assign({
      type,
      button: 0,
      pointerId: 1,
      clientX: 0,
      key: '',
      shiftKey: false,
      preventDefault() {},
      stopPropagation() {}
    }, values);
    (this.listeners.get(type) || []).forEach((listener) => listener(event));
    return event;
  }

  querySelectorAll(selector) {
    const matches = [];
    const visit = (element) => {
      element.children.forEach((child) => {
        if (matchesSelector(child, selector)) matches.push(child);
        visit(child);
      });
    };
    visit(this);
    return matches;
  }

  querySelector(selector) {
    return this.querySelectorAll(selector)[0] || null;
  }

  setPointerCapture(pointerId) {
    this.pointerCaptures.add(pointerId);
  }

  hasPointerCapture(pointerId) {
    return this.pointerCaptures.has(pointerId);
  }

  releasePointerCapture(pointerId) {
    this.pointerCaptures.delete(pointerId);
  }

  getBoundingClientRect() {
    return { left: 0 };
  }

  focus() {
    this.focused = true;
  }
}

function createFakeDocument() {
  const elementsById = new Map();
  const document = {
    readyState: 'loading',
    roots: [],
    addEventListener() {},
    createElement(tagName) {
      return new FakeElement(tagName);
    },
    register(id, element) {
      element.setAttribute('id', id);
      elementsById.set(id, element);
      this.roots.push(element);
      return element;
    },
    getElementById(id) {
      return elementsById.get(id) || null;
    },
    querySelector() {
      return null;
    },
    querySelectorAll(selector) {
      return this.roots.flatMap((root) => {
        const matches = matchesSelector(root, selector) ? [root] : [];
        return matches.concat(root.querySelectorAll(selector));
      });
    }
  };
  return document;
}

function loadNutritionController(options = {}) {
  const values = new Map(Object.entries(options.storage || {}).map(([key, value]) => [key, clone(value)]));
  if (!values.has('openrouter_settings_v1')) values.set('openrouter_settings_v1', { key: 'test-key' });
  const writes = [];
  const timers = [];
  const requests = [];
  const cookingCore = Object.assign({
    normalizeKitchenProfile(value) {
      return clone(value || { revision: 1, calibration: { durationOverrides: {} } });
    },
    normalizeCookingStore(value) {
      return clone(value || { plansByHash: {}, sessionsById: {}, activeSessionId: null });
    },
    buildCookingDemand(template, state, catalog, week) {
      return { cycleId: state.activeCycle.id, week, batches: [] };
    },
    selectCookingSessionDemand(demand, sessionKind) {
      return Object.assign({}, demand, { sessionKind });
    },
    createPlanFingerprint(demand, profile) {
      return 'hash-' + profile.revision;
    },
    getCachedPlan(store, hash) {
      return store.plansByHash[hash] ? clone(store.plansByHash[hash]) : null;
    },
    putCachedPlan(store, plan) {
      const next = clone(store);
      next.plansByHash[plan.planHash] = clone(plan);
      return next;
    },
    activeSessionForPlan() {
      return false;
    },
    planCoversDemand() {
      return true;
    },
    buildFallbackActions() {
      return [];
    },
    applyCalibrationToActions(actions) {
      return clone(actions);
    },
    invalidateWeek(store, cycleId, week) {
      const next = clone(store);
      const active = next.activeSessionId && next.sessionsById[next.activeSessionId];
      const protectedHash = active && active.status !== 'completed' ? active.planHash : '';
      Object.keys(next.plansByHash).forEach((hash) => {
        const plan = next.plansByHash[hash];
        if (hash !== protectedHash && plan && plan.cycleId === cycleId && Number(plan.week) === Number(week)) {
          delete next.plansByHash[hash];
        }
      });
      return next;
    },
    setActionDurationOverride(profile, action, batches, minutes) {
      const next = clone(profile);
      const key = durationOverrideKey(action, batches);
      if (!key) return { ok: false, profile: next, key, error: 'не удалось определить шаг готовки' };
      next.revision += 1;
      next.calibration.durationOverrides[key] = minutes;
      return { ok: true, profile: next, key, error: null };
    },
    clearActionDurationOverride(profile, action, batches) {
      const next = clone(profile);
      const key = durationOverrideKey(action, batches);
      if (!key) return { ok: false, profile: next, key, error: 'не удалось определить шаг готовки' };
      next.revision += 1;
      delete next.calibration.durationOverrides[key];
      return { ok: true, profile: next, key, error: null };
    },
    canEditActionDuration(session) {
      return !(session && session.steps);
    },
    getActionDurationKey(action, batches) {
      return durationOverrideKey(action, batches);
    },
    nextSessionActionId() {
      return null;
    }
  }, options.cookingCore || {});
  const document = options.document || {
    readyState: 'loading',
    addEventListener() {},
    createElement() { return new FakeElement('div'); },
    getElementById() { return null; },
    querySelector() { return null; },
    querySelectorAll() { return []; }
  };
  const window = {
    location: { hash: '' },
    addEventListener() {},
    confirm() { return true; },
    NutritionCore: Object.assign({
      getLocalDateKey() { return '2026-07-18'; },
      normalizeState() { return { activeCycle: { id: 'cycle-1', startDate: '2026-07-18' } }; }
    }, options.nutritionCore || {}),
    NutritionData: { plan14: [], meals: [] },
    NutritionCookingCore: cookingCore,
    NutritionScheduler: {
      scheduleActions() {
        return { ok: true, schedule: [], estimate: { minMinutes: 0, maxMinutes: 0 }, peakOutlets: 0, warnings: [] };
      }
    },
    NutritionOpenRouter: {
      createOpenRouterCookingClient() {
        return {
          decompose() {
            return new Promise((resolve, reject) => requests.push({ resolve, reject }));
          },
          abort() {}
        };
      }
    },
    Gamification: {
      storeGet(key) {
        return clone(values.get(key));
      },
      storeSet(key, value) {
        writes.push({ key, value: clone(value) });
        if (options.failWrite && options.failWrite(key, writes.length)) throw new Error('storage failed for ' + key);
        values.set(key, clone(value));
      }
    }
  };
  const context = {
    window,
    document,
    console,
    setTimeout(callback) {
      const timer = { callback, active: true };
      timers.push(timer);
      return timer;
    },
    clearTimeout(timer) {
      if (timer) timer.active = false;
    },
    Date,
    JSON,
    Object,
    Array,
    Number,
    Boolean,
    String,
    Math
  };
  window.setTimeout = context.setTimeout;
  window.clearTimeout = context.clearTimeout;
  const source = read('nutrition.js').replace(
    "if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);",
    "window.__nutritionTestApi = { ensureCookingPlan: ensureCookingPlan, scheduleCookingGeneration: scheduleCookingGeneration, saveCookingActionDuration: saveCookingActionDuration, resetCookingActionDuration: resetCookingActionDuration, buildCookingKeyboardResizePreview: buildCookingKeyboardResizePreview, cookingMinuteAtPixel: typeof cookingMinuteAtPixel === 'function' ? cookingMinuteAtPixel : undefined, buildCookingPointerResizePreview: typeof buildCookingPointerResizePreview === 'function' ? buildCookingPointerResizePreview : undefined, renderCookingTimeline: renderCookingTimeline, loadCookingData: loadCookingData, getUiState: function () { return cookingUiState; }, getUiError: function () { return cookingUiError; }, getGenerationRequests: function () { return generationRequests; }, getCookingSelection: function () { return { actionId: selectedCookingActionId, batchId: activeBatchId }; }, getRuntime: function () { return { kitchenProfile: kitchenProfile, cookingStore: cookingStore, cookingWeek: cookingWeek, cookingSessionKind: cookingSessionKind }; }, setRuntime: function (next) { state = next.state; kitchenProfile = next.kitchenProfile; cookingStore = next.cookingStore; cookingWeek = next.cookingWeek || 1; cookingSessionKind = next.cookingSessionKind === 'refresh' ? 'refresh' : 'main'; } };\n  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);"
  );
  vm.createContext(context);
  vm.runInContext(source, context);
  return { api: window.__nutritionTestApi, values, writes, timers, requests };
}

async function flushPromises() {
  await Promise.resolve();
  await Promise.resolve();
  await new Promise((resolve) => setImmediate(resolve));
}

function setCookingRuntime(harness, revision) {
  harness.api.setRuntime({
    state: { activeCycle: { id: 'cycle-1', startDate: '2026-07-18' } },
    kitchenProfile: { revision, calibration: { durationOverrides: {} } },
    cookingStore: { plansByHash: {}, sessionsById: {}, activeSessionId: null }
  });
}

function createDurationPlan(sessionKind = 'main') {
  return {
    version: 1,
    planHash: 'hash-1',
    cycleId: 'cycle-1',
    week: 1,
    sessionKind,
    batches: [{ id: 'batch-1', mealId: 'meal-1' }],
    actions: [{ id: 'action-1', title: 'подготовить блюдо', category: 'prep', batchId: 'batch-1' }],
    schedule: [{ actionId: 'action-1', startMinute: 0, endMinute: 10 }]
  };
}

function createStoredCookingState(sessionKind = 'main') {
  const profile = { revision: 1, calibration: { durationOverrides: {} } };
  const plan = createDurationPlan(sessionKind);
  const store = { plansByHash: { 'hash-1': plan }, sessionsById: {}, activeSessionId: null };
  return { profile, plan, store };
}

function setDurationRuntime(harness, stored, sessionKind = 'main') {
  harness.api.setRuntime({
    state: { activeCycle: { id: 'cycle-1', startDate: '2026-07-18' } },
    kitchenProfile: clone(stored.profile),
    cookingStore: clone(stored.store),
    cookingWeek: 1,
    cookingSessionKind: sessionKind
  });
}

function createTimelinePlan() {
  return {
    version: 1,
    planHash: 'timeline-hash',
    cycleId: 'cycle-1',
    week: 1,
    sessionKind: 'main',
    batches: [{ id: 'batch-1', mealId: 'meal-1', label: 'блюдо 1', colorIndex: 0 }],
    actions: [{ id: 'action-1', title: 'подготовить блюдо', category: 'prep', batchId: 'batch-1' }],
    schedule: [{
      actionId: 'action-1',
      batchId: 'batch-1',
      title: 'подготовить блюдо',
      mode: 'active',
      location: 'kitchen',
      startMinute: 0,
      endMinute: 10,
      durationMinutes: 10,
      userOccupied: true,
      equipmentIds: [],
      cookwareIds: [],
      outletIds: []
    }],
    estimate: { minMinutes: 10, maxMinutes: 10 },
    peakOutlets: 0,
    warnings: []
  };
}

function createTimelineHarness(durationOverrides = {}) {
  const document = createFakeDocument();
  const timeline = document.register('cookingTimeline', new FakeElement('div'));
  const now = document.register('cookingNow', new FakeElement('aside'));
  const NutritionCore = require('../nutrition-core.js');
  const harness = loadNutritionController({ document, nutritionCore: NutritionCore });
  harness.api.setRuntime({
    state: { activeCycle: { id: 'cycle-1', startDate: '2026-07-18' } },
    kitchenProfile: {
      revision: 1,
      activeMode: 'home',
      resources: [],
      calibration: { durationOverrides: clone(durationOverrides) }
    },
    cookingStore: { plansByHash: {}, sessionsById: {}, activeSessionId: null },
    cookingWeek: 1,
    cookingSessionKind: 'main'
  });
  const plan = createTimelinePlan();
  harness.api.renderCookingTimeline(plan, timeline);
  return Object.assign(harness, { document, timeline, now, plan });
}

test('nutrition controller persists menu, kitchen and cooking state through gamification storage', () => {
  const js = read('nutrition.js');
  const profile = read('profile.html');

  assert.ok(js.includes("STATE_KEY = 'nutrition_state_v1'"));
  assert.ok(js.includes("PRICES_KEY = 'nutrition_prices_v1'"));
  assert.ok(js.includes("MEALS_KEY = 'nutrition_meals_v1'"));
  assert.ok(js.includes("KITCHEN_PROFILE_KEY = 'nutrition_kitchen_profile_v1'"));
  assert.ok(js.includes("COOKING_PLANS_KEY = 'nutrition_cooking_plans_v1'"));
  assert.ok(js.includes('Gamification.storeSet(STATE_KEY'));
  assert.ok(js.includes('Gamification.storeSet(PRICES_KEY'));
  assert.ok(js.includes('Gamification.storeSet(MEALS_KEY'));
  assert.ok(js.includes('Gamification.storeSet(KITCHEN_PROFILE_KEY'));
  assert.ok(js.includes('Gamification.storeSet(COOKING_PLANS_KEY'));
  assert.ok(profile.includes("'nutrition_kitchen_profile_v1'"));
  assert.ok(profile.includes("'nutrition_cooking_plans_v1'"));
  assert.equal(profile.includes("'openrouter_settings_v1'"), false);
});

test('nutrition controller synchronizes hash, desktop navigation and mobile selection', () => {
  const js = read('nutrition.js');

  assert.ok(js.includes('function switchView(view'));
  assert.ok(js.includes('window.location.hash'));
  assert.ok(js.includes("querySelectorAll('[data-menu-view]')"));
  assert.ok(js.includes("getElementById('menuViewSelect')"));
  assert.ok(js.includes("addEventListener('hashchange'"));
});

test('nutrition controller renders every approved view and weekly preparation independently', () => {
  const js = read('nutrition.js');

  ['renderToday', 'renderCycle', 'renderCatalog', 'renderShopping', 'renderCooking', 'renderHistory'].forEach((name) => {
    assert.ok(js.includes(`function ${name}(`), name);
  });
  assert.ok(js.includes('NutritionCore.buildShoppingList'));
  assert.ok(js.includes('NutritionCookingCore.buildCookingDemand'));
  assert.ok(js.includes('NutritionCookingCore.buildFallbackActions'));
  assert.ok(js.includes('NutritionScheduler.scheduleActions'));
  assert.equal(js.includes('NutritionData.cookingSessions'), false);
  assert.ok(js.includes('cookingWeek'));
});

test('nutrition shopping renders editable persisted prices and expense analytics', () => {
  const html = read('menu.html');
  const js = read('nutrition.js');

  assert.ok(html.includes('id="shoppingBudgetMeta"'));
  assert.ok(html.includes('id="historySummary"'));
  assert.ok(html.includes('.shopping-price-input'));
  assert.ok(html.includes('.shopping-line-cost'));
  assert.ok(js.includes('NutritionCore.priceShoppingItems'));
  assert.ok(js.includes('NutritionCore.calculateShoppingTotal'));
  assert.ok(js.includes('NutritionData.ingredientPrices'));
  assert.ok(js.includes("priceInput.type = 'number'"));
  assert.ok(js.includes('state.ingredientPrices[priceKey]'));
  assert.ok(js.includes("priceInput.addEventListener('change'"));
  assert.ok(js.includes('shoppingCostRub'));
});

test('nutrition controller renders weekly calendar batches and invalidates only a replaced week', () => {
  const html = read('menu.html');
  const js = read('nutrition.js');

  assert.ok(html.includes('id="cycleWeekTabs"'));
  assert.ok(html.includes('id="cycleBatchRail"'));
  assert.ok(html.includes('class="cycle-workspace"'));
  assert.ok(js.includes("setAttribute('data-batch-id'"));
  assert.ok(js.includes('activeBatchId'));
  assert.ok(js.includes('NutritionCookingCore.invalidateWeek'));
  assert.ok(js.includes('scheduleCookingGeneration'));
});

test('nutrition controller exposes all cooking plan states and resource timeline controls', () => {
  const html = read('menu.html');
  const js = read('nutrition.js');

  ['ready', 'generating', 'stale', 'fallback', 'error'].forEach((state) => {
    assert.ok(js.includes(`'${state}'`), state);
  });
  assert.ok(html.includes('id="kitchenModeSelect"'));
  assert.ok(html.includes('id="regenerateCookingBtn"'));
  assert.ok(html.includes('id="clearCookingCacheBtn"'));
  assert.ok(html.includes('id="cookingTimeline"'));
  assert.ok(html.includes('id="cookingNow"'));
  assert.ok(html.includes('id="cookingSessionTabs"'));
  assert.ok(html.includes('data-cooking-session="main"'));
  assert.ok(html.includes('data-cooking-session="refresh"'));
  assert.ok(js.includes('function ensureCookingPlan('));
  assert.ok(js.includes('NutritionCookingCore.selectCookingSessionDemand'));
});

test('nutrition desktop layout keeps calendar and cooking timeline readable at full zoom', () => {
  const html = read('menu.html');
  const js = read('nutrition.js');

  assert.ok(html.includes('max-width:1760px'));
  assert.ok(html.includes('grid-template-columns:164px minmax(0,1fr)'));
  assert.ok(html.includes('grid-template-columns:minmax(0,1fr) 272px;gap:32px'));
  assert.ok(html.includes('class="cycle-scroll"'));
  assert.ok(html.includes('min-width:1820px'));
  assert.ok(html.includes('min-height:128px'));
  assert.ok(html.includes('grid-template-columns:minmax(0,1fr) 320px;gap:32px'));
  assert.ok(html.includes('.cooking-timeline-column{min-width:0;'));
  assert.ok(html.includes('.timeline-shell{width:100%;max-width:100%;min-width:0;overflow-x:auto'));
  assert.ok(html.includes('position:sticky;left:0'));
  assert.ok(html.includes('min-height:136px'));
  assert.equal(html.includes('-webkit-line-clamp:2'), false);
  assert.equal(html.includes('display:-webkit-box'), false);
  assert.ok(html.includes('.cycle-workspace,.cooking-layout{grid-template-columns:minmax(0,1fr)}'));
  assert.ok(js.includes('TIMELINE_PIXELS_PER_MINUTE = 7'));
  assert.ok(js.includes('TIMELINE_MIN_SEGMENT_WIDTH = 260'));
  assert.ok(js.includes('NutritionCore.buildTimelineScale'));
  assert.ok(js.includes("setProperty('--timeline-width'"));
  assert.ok(html.includes('@media(max-width:1480px)'));
  assert.ok(html.includes('@media(max-width:820px)'));
});

test('cooking timeline source exposes resize handles and the duration inspector', () => {
  const html = read('menu.html');
  const js = read('nutrition.js');

  assert.ok(html.includes('.timeline-resize-handle'));
  assert.ok(html.includes('cursor:ew-resize'));
  assert.ok(html.includes('.timeline-block-selected'));
  assert.ok(html.includes('.cooking-duration-editor'));
  assert.ok(js.includes("createElement('div', 'timeline-block"));
  assert.equal(js.includes("createElement('button', 'timeline-block '"), false);
  assert.ok(js.includes("createElement('button', 'timeline-block-select')"));
  assert.ok(js.includes("setAttribute('data-action-id'"));
  assert.ok(js.includes("setAttribute('role', 'slider')"));
  assert.ok(js.includes("setAttribute('aria-valuemin', '1')"));
  assert.ok(js.includes("setAttribute('aria-valuemax', '720')"));
  assert.ok(js.includes('renderCookingDurationEditor'));
  assert.ok(js.includes('attachCookingResizeHandle'));
  assert.ok(js.includes("createElement('input', 'field-control cooking-duration-input')"));
  assert.ok(js.includes("input.type = 'number'"));
  assert.ok(js.includes("input.min = '1'"));
  assert.ok(js.includes("input.max = '720'"));
  assert.ok(js.includes("input.step = '1'"));
  assert.ok(js.includes('saveCookingActionDuration(plan, entry.actionId'));
  assert.ok(js.includes('resetCookingActionDuration(plan, entry.actionId'));
});

test('cooking timeline renders a neutral block with sibling select button and sliders', () => {
  const harness = createTimelineHarness();
  const block = harness.timeline.querySelector('.timeline-block');
  const select = block.querySelector('.timeline-block-select');
  const handles = block.querySelectorAll('.timeline-resize-handle');

  assert.equal(block.tagName, 'DIV');
  assert.equal(block.getAttribute('role'), null);
  assert.equal(block.getAttribute('tabindex'), null);
  assert.equal(block.tabIndex, -1);
  assert.ok(select, 'timeline block must contain a native select button');
  assert.equal(select.tagName, 'BUTTON');
  assert.equal(select.parentNode, block);
  assert.equal(select.getAttribute('aria-pressed'), 'false');
  assert.match(select.getAttribute('aria-label'), /подготовить блюдо/);
  assert.match(select.title, /подготовить блюдо/);
  assert.equal(handles.length, 2);
  handles.forEach((handle) => {
    assert.equal(handle.parentNode, block);
    assert.equal(handle.getAttribute('role'), 'slider');
    assert.notEqual(handle.parentNode, select);
  });
});

test('cooking select button toggles batch highlight while handles leave it unchanged', () => {
  const harness = createTimelineHarness();
  const block = harness.timeline.querySelector('.timeline-block');
  const select = block.querySelector('.timeline-block-select');
  const handle = block.querySelector('.timeline-resize-handle.end');

  assert.ok(select, 'timeline block must contain a native select button');
  select.dispatch('click');
  assert.deepEqual(clone(harness.api.getCookingSelection()), { actionId: 'action-1', batchId: 'batch-1' });
  assert.equal(block.classList.contains('batch-active'), true);
  assert.equal(select.getAttribute('aria-pressed'), 'true');

  handle.dispatch('pointerdown', { clientX: 260 });
  handle.dispatch('pointerup', { clientX: 260 });
  assert.equal(harness.api.getCookingSelection().batchId, 'batch-1');

  select.dispatch('click');
  assert.deepEqual(clone(harness.api.getCookingSelection()), { actionId: 'action-1', batchId: null });
  assert.equal(block.classList.contains('batch-active'), false);
});

test('cooking pointer resize does not save or change duration without rounded movement', () => {
  const harness = createTimelineHarness();
  const block = harness.timeline.querySelector('.timeline-block');
  const handle = block.querySelector('.timeline-resize-handle.end');
  const writesBefore = harness.writes.length;

  handle.dispatch('pointerdown', { clientX: 254 });
  handle.dispatch('pointerup', { clientX: 254 });

  assert.equal(harness.writes.length, writesBefore);
  assert.equal(block.getAttribute('data-preview-duration'), null);
  assert.equal(handle.getAttribute('aria-valuenow'), '10');
});

test('cooking pointer resize restores its label after a rounded-zero move', () => {
  const harness = createTimelineHarness();
  const block = harness.timeline.querySelector('.timeline-block');
  const handle = block.querySelector('.timeline-resize-handle.end');
  const time = block.querySelector('.timeline-block-time');
  const writesBefore = harness.writes.length;

  handle.dispatch('pointerdown', { clientX: 254 });
  handle.dispatch('pointermove', { clientX: 255 });
  handle.dispatch('pointerup', { clientX: 255 });

  assert.equal(harness.writes.length, writesBefore);
  assert.equal(block.getAttribute('data-preview-duration'), null);
  assert.equal(time.textContent, '0 мин → 10 мин');
  assert.equal(handle.getAttribute('aria-valuenow'), '10');
});

test('cooking resize extrapolates first and last boundaries outside the timeline', () => {
  const harness = loadNutritionController();
  const scale = {
    width: 70,
    minuteAt(pixel) {
      return Math.max(0, Math.min(70, pixel)) / 7;
    }
  };
  const entry = { startMinute: 0, endMinute: 10, durationMinutes: 10 };

  assert.equal(typeof harness.api.cookingMinuteAtPixel, 'function');
  assert.equal(typeof harness.api.buildCookingPointerResizePreview, 'function');
  assert.equal(harness.api.cookingMinuteAtPixel(scale, -70), -10);
  assert.equal(harness.api.cookingMinuteAtPixel(scale, 140), 20);
  assert.deepEqual(
    clone(harness.api.buildCookingPointerResizePreview(
      entry,
      'end',
      { pointerPixel: 70, pointerMinute: 10, boundaryMinute: 10 },
      140,
      scale
    )),
    { startMinute: 0, endMinute: 20, durationMinutes: 20 }
  );
  assert.deepEqual(
    clone(harness.api.buildCookingPointerResizePreview(
      entry,
      'start',
      { pointerPixel: 0, pointerMinute: 0, boundaryMinute: 0 },
      -70,
      scale
    )),
    { startMinute: -10, endMinute: 10, durationMinutes: 20 }
  );
});

test('cooking resize keeps one action synchronized and supports pointer cancellation and keyboard steps', () => {
  const js = read('nutrition.js');

  assert.ok(js.includes("querySelectorAll('.timeline-block')"));
  assert.ok(js.includes("getAttribute('data-action-id') === actionId"));
  assert.ok(js.includes('cookingMinuteAtPixel'));
  assert.ok(js.includes('pointerMinute'));
  assert.ok(js.includes('boundaryMinute'));
  assert.ok(js.includes('setPointerCapture'));
  assert.ok(js.includes("addEventListener('pointermove'"));
  assert.ok(js.includes("addEventListener('pointerup'"));
  assert.ok(js.includes("addEventListener('pointercancel'"));
  assert.ok(js.includes("event.key !== 'ArrowLeft'"));
  assert.ok(js.includes("key === 'ArrowRight'"));
  assert.ok(js.includes('shiftKey ? 5 : 1'));
  assert.ok(js.includes('event.stopPropagation()'));
  assert.ok(js.includes('hasActiveCookingSession()'));
  assert.ok(js.includes('timelineScrollLeft = timeline.scrollLeft'));
  assert.ok(js.includes('focusCookingResizeHandle'));
});

test('cooking resize keyboard preview follows each physical edge', () => {
  const harness = loadNutritionController();
  const entry = { startMinute: 10, endMinute: 20, durationMinutes: 10 };

  assert.deepEqual(
    clone(harness.api.buildCookingKeyboardResizePreview(entry, 'end', 'ArrowRight', false)),
    { startMinute: 10, endMinute: 21, durationMinutes: 11 }
  );
  assert.deepEqual(
    clone(harness.api.buildCookingKeyboardResizePreview(entry, 'end', 'ArrowLeft', true)),
    { startMinute: 10, endMinute: 15, durationMinutes: 5 }
  );
  assert.deepEqual(
    clone(harness.api.buildCookingKeyboardResizePreview(entry, 'start', 'ArrowRight', false)),
    { startMinute: 11, endMinute: 20, durationMinutes: 9 }
  );
  assert.deepEqual(
    clone(harness.api.buildCookingKeyboardResizePreview(entry, 'start', 'ArrowLeft', true)),
    { startMinute: 5, endMinute: 20, durationMinutes: 15 }
  );
});

test('calendar and timeline use quiet internal scrollbars without page overflow', () => {
  const html = read('menu.html');

  assert.ok(html.includes('class="cycle-scroll"'));
  assert.ok(html.includes('class="timeline-shell"'));
  assert.ok(html.includes('scrollbar-width:thin'));
  assert.ok(html.includes('scrollbar-color:#555B66 transparent'));
  assert.ok(html.includes('::-webkit-scrollbar-thumb'));
  assert.ok(html.includes('::-webkit-scrollbar-track'));
  assert.ok(html.includes('::-webkit-scrollbar-thumb:hover'));
  assert.ok(html.includes(':focus-within::-webkit-scrollbar-thumb'));
  assert.ok(html.includes('body{min-height:100vh;max-width:1760px;overflow-x:hidden'));
  assert.equal(html.includes('.cycle-scroll{overflow:visible'), false);
  assert.ok(html.includes('.cooking-now{min-width:0;max-width:100%'));
});

test('duration inspector shows a raw manual override separately from current duration', () => {
  const key = 'meal-1::prep::подготовить блюдо';
  const harness = createTimelineHarness({ [key]: 14 });
  const select = harness.timeline.querySelector('.timeline-block-select');

  assert.ok(select, 'timeline block must contain a native select button');
  select.dispatch('click');

  assert.equal(harness.now.querySelector('.cooking-duration-current').textContent, 'текущая длительность · 10 мин');
  assert.equal(harness.now.querySelector('.cooking-duration-saved').textContent, 'сохранено вручную · 14 мин');
});

test('nutrition controller persists cooking sessions and calibrates completed active work', () => {
  const html = read('menu.html');
  const js = read('nutrition.js');

  assert.ok(html.includes('id="resetCookingCalibrationBtn"'));
  assert.ok(js.includes('NutritionCookingCore.startSession'));
  assert.ok(js.includes('NutritionCookingCore.startStep'));
  assert.ok(js.includes('NutritionCookingCore.pauseStep'));
  assert.ok(js.includes('NutritionCookingCore.completeStep'));
  assert.ok(js.includes('NutritionCookingCore.skipStep'));
  assert.ok(js.includes('NutritionCookingCore.setStepActualMinutes'));
  assert.ok(js.includes('NutritionCookingCore.applySessionCalibration'));
  assert.ok(js.includes('NutritionCookingCore.resetCalibration'));
  assert.ok(js.includes('cookingStore.activeSessionId'));
  assert.ok(js.includes('cookingStore.lastSessionId'));
  assert.ok(js.includes('cookingStore.lastSessionIdsByWeek'));
  assert.ok(js.includes('cookingStore.calibrationSessionIds'));
  assert.ok(js.includes('NutritionCookingCore.replaySessionCalibrations'));
  assert.ok(js.includes('cooking-correction-select'));
  assert.ok(js.includes('NutritionCookingCore.nextSessionActionId'));
  assert.ok(js.includes('NutritionCookingCore.clearCachedPlans'));
  assert.ok(js.includes('NutritionCookingCore.activeSessionForPlan'));
  assert.ok(js.includes("if (!settings.key && cookingUiState[key] !== 'generating')"));
  assert.ok(js.includes('function syncCookingSelectionToActiveSession('));
  assert.ok(js.includes('activeSession.planHash !== plan.planHash'));
});

test('nutrition controller edits and persists planned cooking durations', () => {
  const js = read('nutrition.js');

  assert.ok(js.includes('selectedCookingActionId'));
  assert.ok(js.includes('NutritionCookingCore.setActionDurationOverride'));
  assert.ok(js.includes('NutritionCookingCore.clearActionDurationOverride'));
  assert.ok(js.includes('NutritionCookingCore.canEditActionDuration'));
  assert.ok(js.includes('function saveCookingActionDuration('));
  assert.ok(js.includes('function resetCookingActionDuration('));
  assert.ok(js.includes('NutritionCookingCore.invalidateWeek'));
  assert.ok(js.includes('applyCalibrationToActions(result.value.actions, kitchenProfile, demand.batches)'));
});

test('nutrition controller replaces the latest ai request when its hash changes without an external force', async () => {
  const harness = loadNutritionController();
  setCookingRuntime(harness, 1);

  harness.api.ensureCookingPlan(1, 'main');
  assert.equal(harness.requests.length, 1);

  harness.api.setRuntime({
    state: { activeCycle: { id: 'cycle-1', startDate: '2026-07-18' } },
    kitchenProfile: { revision: 2, calibration: { durationOverrides: {} } },
    cookingStore: { plansByHash: {}, sessionsById: {}, activeSessionId: null }
  });
  harness.requests[0].resolve({ ok: true, value: { actions: [] } });
  await flushPromises();

  assert.equal(harness.requests.length, 2);
  assert.equal(harness.api.getUiState()['1:main'], 'generating');
  assert.equal(harness.api.getGenerationRequests()['1:main'].planHash, 'hash-2');

  harness.requests[1].resolve({ ok: true, value: { actions: [] } });
  await flushPromises();
  assert.equal(harness.api.getUiState()['1:main'], 'ready');
});

test('nutrition controller restarts a mismatched latest rejection and ignores a result from an older token', async () => {
  const harness = loadNutritionController();
  setCookingRuntime(harness, 1);

  harness.api.ensureCookingPlan(1, 'main');
  setCookingRuntime(harness, 2);
  harness.requests[0].reject(new Error('obsolete rejection'));
  await flushPromises();

  assert.equal(harness.requests.length, 2);
  assert.equal(harness.api.getUiState()['1:main'], 'generating');

  harness.api.ensureCookingPlan(1, 'main', { forceAi: true });
  assert.equal(harness.requests.length, 3);
  const latestToken = harness.api.getGenerationRequests()['1:main'].token;
  harness.requests[1].resolve({ ok: true, value: { actions: [] } });
  await flushPromises();
  assert.equal(harness.api.getUiState()['1:main'], 'generating');
  assert.equal(harness.api.getGenerationRequests()['1:main'].token, latestToken);
  assert.equal(harness.api.getRuntime().cookingStore.plansByHash['hash-2'].source, 'fallback');

  harness.requests[2].reject(new Error('latest rejection'));
  await flushPromises();
  assert.equal(harness.api.getUiState()['1:main'], 'error');
  assert.equal(harness.api.getUiError()['1:main'], 'latest rejection');
  assert.equal(harness.api.getGenerationRequests()['1:main'], undefined);
});

test('nutrition controller saves a duration and rebuilds main and refresh plans inside one journal', () => {
  ['main', 'refresh'].forEach((sessionKind) => {
    const original = createStoredCookingState(sessionKind);
    const overrideKey = durationOverrideKey(original.plan.actions[0], original.plan.batches);
    const harness = loadNutritionController({
      storage: {
        openrouter_settings_v1: {},
        nutrition_kitchen_profile_v1: original.profile,
        nutrition_cooking_plans_v1: original.store
      }
    });
    setDurationRuntime(harness, original, sessionKind);

    const result = harness.api.saveCookingActionDuration(original.plan, 'action-1', 25);

    assert.equal(result.ok, true, sessionKind);
    assert.equal(harness.values.get('nutrition_kitchen_profile_v1').calibration.durationOverrides[overrideKey], 25);
    assert.equal(harness.values.get('nutrition_cooking_plans_v1').plansByHash['hash-1'], undefined);
    assert.equal(harness.values.get('nutrition_cooking_plans_v1').plansByHash['hash-2'].sessionKind, sessionKind);
    assert.equal(harness.values.get('nutrition_cooking_transaction_v1'), null);
    const journals = harness.writes.filter((write) => write.key === 'nutrition_cooking_transaction_v1' && write.value);
    assert.equal(journals.length, 1);
    assert.deepEqual(journals[0].value.kitchenProfile, original.profile);
    assert.deepEqual(journals[0].value.cookingStore, original.store);
  });
});

test('nutrition controller invalidates main and refresh plans for the week in one duration update', () => {
  const original = createStoredCookingState('main');
  const mainPlan = clone(original.plan);
  mainPlan.planHash = 'main-before';
  const refreshPlan = createDurationPlan('refresh');
  refreshPlan.planHash = 'refresh-before';
  original.plan = mainPlan;
  original.store.plansByHash = {
    'main-before': mainPlan,
    'refresh-before': refreshPlan
  };
  const harness = loadNutritionController({
    storage: {
      openrouter_settings_v1: {},
      nutrition_kitchen_profile_v1: original.profile,
      nutrition_cooking_plans_v1: original.store
    }
  });
  setDurationRuntime(harness, original);

  const result = harness.api.saveCookingActionDuration(mainPlan, 'action-1', 25);

  assert.equal(result.ok, true);
  assert.equal(harness.values.get('nutrition_cooking_plans_v1').plansByHash['main-before'], undefined);
  assert.equal(harness.values.get('nutrition_cooking_plans_v1').plansByHash['refresh-before'], undefined);
  assert.equal(harness.values.get('nutrition_cooking_plans_v1').plansByHash['hash-2'].sessionKind, 'main');
});

test('nutrition controller resets a saved duration through the vm api', () => {
  const original = createStoredCookingState();
  const overrideKey = durationOverrideKey(original.plan.actions[0], original.plan.batches);
  original.profile.calibration.durationOverrides[overrideKey] = 25;
  const harness = loadNutritionController({
    storage: {
      openrouter_settings_v1: {},
      nutrition_kitchen_profile_v1: original.profile,
      nutrition_cooking_plans_v1: original.store
    }
  });
  setDurationRuntime(harness, original);

  const result = harness.api.resetCookingActionDuration(original.plan, 'action-1');

  assert.equal(result.ok, true);
  assert.equal(result.key, overrideKey);
  assert.equal(harness.values.get('nutrition_kitchen_profile_v1').calibration.durationOverrides[overrideKey], undefined);
  assert.equal(harness.values.get('nutrition_cooking_transaction_v1'), null);
});

test('nutrition controller recovers a stale journal before updating and journals the recovered pair', () => {
  const recovered = createStoredCookingState();
  const recent = createStoredCookingState();
  recent.profile.revision = 5;
  recent.plan.planHash = 'hash-5';
  recent.store.plansByHash = { 'hash-5': recent.plan };
  let updatedRevision = null;
  let cookingStoreWrites = 0;
  const harness = loadNutritionController({
    storage: {
      openrouter_settings_v1: {},
      nutrition_kitchen_profile_v1: recent.profile,
      nutrition_cooking_plans_v1: recent.store,
      nutrition_cooking_transaction_v1: {
        version: 1,
        kitchenProfile: recovered.profile,
        cookingStore: recovered.store
      }
    },
    cookingCore: {
      setActionDurationOverride(profile, action, batches, minutes) {
        updatedRevision = profile.revision;
        const next = clone(profile);
        const key = durationOverrideKey(action, batches);
        next.revision += 1;
        next.calibration.durationOverrides[key] = minutes;
        return { ok: true, profile: next, key, error: null };
      }
    },
    failWrite(key) {
      if (key !== 'nutrition_cooking_plans_v1') return false;
      cookingStoreWrites += 1;
      return cookingStoreWrites === 3;
    }
  });
  setDurationRuntime(harness, recent);

  const result = harness.api.saveCookingActionDuration(recovered.plan, 'action-1', 25);

  assert.equal(result.ok, false);
  assert.equal(updatedRevision, 1);
  assert.deepEqual(harness.api.getRuntime().kitchenProfile, recovered.profile);
  assert.deepEqual(harness.api.getRuntime().cookingStore, recovered.store);
  assert.deepEqual(harness.values.get('nutrition_kitchen_profile_v1'), recovered.profile);
  assert.deepEqual(harness.values.get('nutrition_cooking_plans_v1'), recovered.store);
  assert.equal(harness.values.get('nutrition_cooking_transaction_v1'), null);
  const journalWrites = harness.writes.filter((write) => write.key === 'nutrition_cooking_transaction_v1');
  assert.deepEqual(journalWrites.map((write) => write.value && write.value.kitchenProfile.revision), [null, 1, null]);
  assert.deepEqual(journalWrites[1].value.cookingStore, recovered.store);
});

test('nutrition controller aborts a new duration update when stale journal recovery fails', () => {
  const recovered = createStoredCookingState();
  const recent = createStoredCookingState();
  recent.profile.revision = 5;
  recent.plan.planHash = 'hash-5';
  recent.store.plansByHash = { 'hash-5': recent.plan };
  let updateCalls = 0;
  let cookingStoreWrites = 0;
  const staleJournal = {
    version: 1,
    kitchenProfile: recovered.profile,
    cookingStore: recovered.store
  };
  const harness = loadNutritionController({
    storage: {
      openrouter_settings_v1: {},
      nutrition_kitchen_profile_v1: recent.profile,
      nutrition_cooking_plans_v1: recent.store,
      nutrition_cooking_transaction_v1: staleJournal
    },
    cookingCore: {
      setActionDurationOverride() {
        updateCalls += 1;
        return { ok: false, error: 'не должно вызываться' };
      }
    },
    failWrite(key) {
      if (key !== 'nutrition_cooking_plans_v1') return false;
      cookingStoreWrites += 1;
      return cookingStoreWrites === 1;
    }
  });
  setDurationRuntime(harness, recent);

  const result = harness.api.saveCookingActionDuration(recovered.plan, 'action-1', 25);

  assert.equal(result.ok, false);
  assert.match(result.error, /не удалось восстановить незавершенное изменение длительности/);
  assert.equal(updateCalls, 0);
  assert.deepEqual(harness.api.getRuntime().kitchenProfile, recent.profile);
  assert.deepEqual(harness.api.getRuntime().cookingStore, recent.store);
  assert.deepEqual(harness.values.get('nutrition_cooking_transaction_v1'), staleJournal);
  assert.equal(harness.writes.some((write) => write.key === 'nutrition_cooking_transaction_v1'), false);
});

test('nutrition controller blocks duration edits while any cooking session is active', () => {
  const original = createStoredCookingState();
  original.store.activeSessionId = 'other-session';
  original.store.sessionsById['other-session'] = {
    id: 'other-session',
    status: 'running',
    planHash: 'other-plan',
    steps: {}
  };
  const harness = loadNutritionController({
    storage: {
      openrouter_settings_v1: {},
      nutrition_kitchen_profile_v1: original.profile,
      nutrition_cooking_plans_v1: original.store
    }
  });
  setDurationRuntime(harness, original);

  const result = harness.api.saveCookingActionDuration(original.plan, 'action-1', 25);

  assert.equal(result.ok, false);
  assert.equal(result.error, 'сначала заверши активную сессию готовки');
  assert.equal(harness.writes.length, 0);
  assert.deepEqual(harness.api.getRuntime().kitchenProfile, original.profile);
  assert.deepEqual(harness.api.getRuntime().cookingStore, original.store);
});

test('nutrition controller restores the original pair when the first cooking store persist fails', () => {
  const original = createStoredCookingState();
  let cookingStoreWrites = 0;
  const harness = loadNutritionController({
    storage: {
      openrouter_settings_v1: {},
      nutrition_kitchen_profile_v1: original.profile,
      nutrition_cooking_plans_v1: original.store
    },
    failWrite(key) {
      if (key !== 'nutrition_cooking_plans_v1') return false;
      cookingStoreWrites += 1;
      return cookingStoreWrites === 1;
    }
  });
  setDurationRuntime(harness, original);

  const result = harness.api.saveCookingActionDuration(original.plan, 'action-1', 25);

  assert.equal(result.ok, false);
  assert.deepEqual(harness.values.get('nutrition_kitchen_profile_v1'), original.profile);
  assert.deepEqual(harness.values.get('nutrition_cooking_plans_v1'), original.store);
  assert.equal(harness.values.get('nutrition_cooking_transaction_v1'), null);
  assert.deepEqual(harness.api.getRuntime().kitchenProfile, original.profile);
  assert.deepEqual(harness.api.getRuntime().cookingStore, original.store);
});

test('nutrition controller restores the original pair when fallback persistence fails after the first persist', () => {
  const original = createStoredCookingState();
  let cookingStoreWrites = 0;
  const harness = loadNutritionController({
    storage: {
      openrouter_settings_v1: {},
      nutrition_kitchen_profile_v1: original.profile,
      nutrition_cooking_plans_v1: original.store
    },
    failWrite(key) {
      if (key !== 'nutrition_cooking_plans_v1') return false;
      cookingStoreWrites += 1;
      return cookingStoreWrites === 2;
    }
  });
  setDurationRuntime(harness, original);

  const result = harness.api.saveCookingActionDuration(original.plan, 'action-1', 25);

  assert.equal(result.ok, false);
  assert.deepEqual(harness.values.get('nutrition_kitchen_profile_v1'), original.profile);
  assert.deepEqual(harness.values.get('nutrition_cooking_plans_v1'), original.store);
  assert.equal(harness.values.get('nutrition_cooking_transaction_v1'), null);
  assert.deepEqual(harness.api.getRuntime().kitchenProfile, original.profile);
  assert.deepEqual(harness.api.getRuntime().cookingStore, original.store);
  const journals = harness.writes.filter((write) => write.key === 'nutrition_cooking_transaction_v1' && write.value);
  assert.equal(journals.length, 1);
  assert.deepEqual(journals[0].value.kitchenProfile, original.profile);
  assert.deepEqual(journals[0].value.cookingStore, original.store);
});

test('nutrition controller retains the original journal after rollback failure and recovers it on load', () => {
  const original = createStoredCookingState();
  let failWrites = true;
  let cookingStoreWrites = 0;
  const harness = loadNutritionController({
    storage: {
      openrouter_settings_v1: {},
      nutrition_kitchen_profile_v1: original.profile,
      nutrition_cooking_plans_v1: original.store
    },
    failWrite(key) {
      if (!failWrites || key !== 'nutrition_cooking_plans_v1') return false;
      cookingStoreWrites += 1;
      return cookingStoreWrites === 2 || cookingStoreWrites === 3;
    }
  });
  setDurationRuntime(harness, original);

  const result = harness.api.saveCookingActionDuration(original.plan, 'action-1', 25);

  assert.equal(result.ok, false);
  assert.deepEqual(harness.values.get('nutrition_cooking_transaction_v1'), {
    version: 1,
    kitchenProfile: original.profile,
    cookingStore: original.store
  });
  assert.deepEqual(harness.api.getRuntime().kitchenProfile, original.profile);
  assert.deepEqual(harness.api.getRuntime().cookingStore, original.store);

  failWrites = false;
  harness.api.loadCookingData();

  assert.deepEqual(harness.values.get('nutrition_kitchen_profile_v1'), original.profile);
  assert.deepEqual(harness.values.get('nutrition_cooking_plans_v1'), original.store);
  assert.equal(harness.values.get('nutrition_cooking_transaction_v1'), null);
  assert.deepEqual(harness.api.getRuntime().kitchenProfile, original.profile);
  assert.deepEqual(harness.api.getRuntime().cookingStore, original.store);
});

test('nutrition controller supports completion, notes, replacement and training extras', () => {
  const js = read('nutrition.js');

  assert.ok(js.includes('state.completions'));
  assert.ok(js.includes('state.notes'));
  assert.ok(js.includes('state.overrides'));
  assert.ok(js.includes('state.trainingDays'));
  assert.ok(js.includes('state.trainingExtras'));
  assert.ok(js.includes('openReplaceDialog'));
});

test('nutrition controller validates imported json before replacing stored meals', () => {
  const js = read('nutrition.js');

  assert.ok(js.includes('NutritionCore.validateImportedCatalog'));
  assert.ok(js.includes('JSON.parse'));
  assert.ok(js.includes('FileReader'));
  assert.ok(js.includes('result.ok'));
});

test('nutrition controller uses dom text nodes for user-controlled titles and notes', () => {
  const js = read('nutrition.js');

  assert.ok(js.includes('document.createElement'));
  assert.ok(js.includes('.textContent ='));
  assert.ok(!js.includes('meal.title +'));
  assert.ok(!js.includes('note +'));
});

test('nutrition controller reloads synced state from storage events', () => {
  const js = read('nutrition.js');

  assert.ok(js.includes("addEventListener('storage'"));
  assert.ok(js.includes("addEventListener('dashboard-sync-applied'"));
  assert.ok(js.includes('reloadStoredData(event ? [event.key] : [])'));
  assert.ok(js.includes('changedKeys'));
  assert.ok(js.includes('PRICES_KEY'));
});

test('nutrition scripts use one fresh cache version for the changed controller contract', () => {
  const html = read('menu.html');

  assert.ok(html.includes('nutrition-data.js?v=405'));
  assert.ok(html.includes('nutrition-core.js?v=406'));
  assert.ok(html.includes('nutrition-cooking-core.js?v=406'));
  assert.ok(html.includes('nutrition-scheduler.js?v=406'));
  assert.ok(html.includes('nutrition.js?v=407'));
});

test('nutrition reads health targets without writing meal data back to health storage', () => {
  const js = read('nutrition.js');

  assert.ok(js.includes('function getHealthContext('));
  assert.ok(js.includes("getStored('po_water_v1')"));
  assert.ok(js.includes("getStored('weight_v1')"));
  assert.ok(js.includes("getStored('calories_v1')"));
  assert.ok(!js.includes("storeSet('po_water_v1'"));
  assert.ok(!js.includes("storeSet('weight_v1'"));
  assert.ok(!js.includes("storeSet('calories_v1'"));
});
