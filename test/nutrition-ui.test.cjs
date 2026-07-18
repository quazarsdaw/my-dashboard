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
    invalidateWeek(store) {
      return clone(store);
    }
  }, options.cookingCore || {});
  const document = {
    readyState: 'loading',
    addEventListener() {},
    getElementById() { return null; },
    querySelector() { return null; },
    querySelectorAll() { return []; }
  };
  const window = {
    location: { hash: '' },
    addEventListener() {},
    confirm() { return true; },
    NutritionCore: {
      getLocalDateKey() { return '2026-07-18'; },
      normalizeState() { return { activeCycle: { id: 'cycle-1', startDate: '2026-07-18' } }; }
    },
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
            return new Promise((resolve) => requests.push(resolve));
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
    "window.__nutritionTestApi = { ensureCookingPlan: ensureCookingPlan, scheduleCookingGeneration: scheduleCookingGeneration, saveCookingData: typeof saveCookingData === 'function' ? saveCookingData : null, loadCookingData: loadCookingData, getUiState: function () { return cookingUiState; }, setRuntime: function (next) { state = next.state; kitchenProfile = next.kitchenProfile; cookingStore = next.cookingStore; } };\n  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);"
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

test('nutrition controller replaces an obsolete ai request after a cooking rebuild', async () => {
  const harness = loadNutritionController();
  setCookingRuntime(harness, 1);

  harness.api.ensureCookingPlan(1, 'main');
  assert.equal(harness.requests.length, 1);

  harness.api.setRuntime({
    state: { activeCycle: { id: 'cycle-1', startDate: '2026-07-18' } },
    kitchenProfile: { revision: 2, calibration: { durationOverrides: {} } },
    cookingStore: { plansByHash: {}, sessionsById: {}, activeSessionId: null }
  });
  harness.api.scheduleCookingGeneration(1, 'main', 450);
  const delayedGeneration = harness.timers[0];
  harness.api.ensureCookingPlan(1, 'main', { forceAi: true });

  assert.equal(delayedGeneration.active, false);
  assert.equal(harness.requests.length, 2);

  harness.requests[0]({ ok: true, value: { actions: [] } });
  await flushPromises();
  assert.equal(harness.api.getUiState()['1:main'], 'generating');

  harness.requests[1]({ ok: true, value: { actions: [] } });
  await flushPromises();
  assert.equal(harness.api.getUiState()['1:main'], 'ready');
});

test('nutrition controller rolls back both cooking records when the second storage write fails', () => {
  const originalProfile = { revision: 1, calibration: { durationOverrides: {} } };
  const originalStore = { plansByHash: { before: { planHash: 'before' } }, sessionsById: {}, activeSessionId: null };
  let cookingStoreFailures = 0;
  const harness = loadNutritionController({
    storage: {
      nutrition_kitchen_profile_v1: originalProfile,
      nutrition_cooking_plans_v1: originalStore
    },
    failWrite(key) {
      if (key !== 'nutrition_cooking_plans_v1') return false;
      cookingStoreFailures += 1;
      return cookingStoreFailures === 1;
    }
  });
  setCookingRuntime(harness, 2);

  assert.throws(() => harness.api.saveCookingData(), /storage failed/);
  assert.deepEqual(harness.values.get('nutrition_kitchen_profile_v1'), originalProfile);
  assert.deepEqual(harness.values.get('nutrition_cooking_plans_v1'), originalStore);
  assert.equal(harness.values.get('nutrition_cooking_transaction_v1'), null);
});

test('nutrition controller recovers a failed cooking transaction on the next load', () => {
  const originalProfile = { revision: 1, calibration: { durationOverrides: {} } };
  const originalStore = { plansByHash: { before: { planHash: 'before' } }, sessionsById: {}, activeSessionId: null };
  let fail = true;
  const harness = loadNutritionController({
    storage: {
      nutrition_kitchen_profile_v1: originalProfile,
      nutrition_cooking_plans_v1: originalStore
    },
    failWrite(key) {
      return fail && key === 'nutrition_cooking_plans_v1';
    }
  });
  setCookingRuntime(harness, 2);

  assert.throws(() => harness.api.saveCookingData(), /storage failed/);
  assert.ok(harness.values.get('nutrition_cooking_transaction_v1'));

  fail = false;
  harness.api.loadCookingData();

  assert.deepEqual(harness.values.get('nutrition_kitchen_profile_v1'), originalProfile);
  assert.deepEqual(harness.values.get('nutrition_cooking_plans_v1'), originalStore);
  assert.equal(harness.values.get('nutrition_cooking_transaction_v1'), null);
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
  assert.ok(html.includes('nutrition-core.js?v=405'));
  assert.ok(html.includes('nutrition-cooking-core.js?v=405'));
  assert.ok(html.includes('nutrition.js?v=405'));
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
