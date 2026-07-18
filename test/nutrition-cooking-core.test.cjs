const assert = require('node:assert/strict');
const test = require('node:test');

let CookingCore = null;
try {
  CookingCore = require('../nutrition-cooking-core.js');
} catch (_) {
  CookingCore = null;
}

function range(min, max) {
  return { min, max };
}

function meal(id, title, mealType = 'lunch') {
  return {
    id,
    source: 'seed',
    mealType,
    title,
    tags: [],
    prepMinutes: range(20, 30),
    caloriesApprox: range(500, 600),
    proteinApprox: range(25, 35),
    estimatedCostRub: range(150, 200),
    ingredients: [{ id: `${id}-base`, name: 'основа', amount: 100, unit: 'г', category: 'bases' }],
    instructions: ['подготовить продукты', 'приготовить до готовности'],
    notes: ''
  };
}

const catalog = [
  meal('meal-rice', 'рис с курицей'),
  meal('meal-fish', 'рыба с картофелем', 'dinner'),
  meal('meal-eggs', 'яйца с творогом', 'breakfast'),
  meal('meal-oats', 'овсянка', 'breakfast')
];

const plan = {
  id: 'plan-14-v1',
  days: Array.from({ length: 14 }, (_, index) => ({
    day: index + 1,
    meals: {
      breakfast: index === 0 ? 'meal-eggs' : 'meal-oats',
      lunch: index < 7 ? 'meal-rice' : 'meal-fish',
      dinner: 'meal-fish'
    }
  }))
};

function state() {
  return {
    activeCycle: { id: 'cycle-test', startDate: '2026-07-18' },
    overrides: {}
  };
}

test('creates the approved extended kitchen profile by default', () => {
  assert.ok(CookingCore, 'nutrition-cooking-core.js должен существовать');
  const profile = CookingCore.createDefaultKitchenProfile();

  assert.equal(profile.activeMode, 'extended');
  assert.equal(profile.modes.extended.kitchenOutlets, 2);
  assert.equal(profile.modes.extended.roomOutlets, 2);
  assert.equal(profile.modes.winter.roomOutlets, 0);
  assert.equal(profile.calibration.defaultActiveFactor, 1.5);
  assert.equal(profile.resources.filter((item) => item.type === 'burner').length, 3);
  assert.equal(profile.resources.find((item) => item.id === 'air-fryer').preferredLocation, 'room');
  assert.equal(profile.resources.find((item) => item.id === 'multicooker').preferredLocation, 'room');
});

test('normalizes a damaged kitchen profile without mutating it', () => {
  const damaged = {
    activeMode: 'unknown',
    modes: { extended: { kitchenOutlets: -5, roomOutlets: 'two' } },
    calibration: { defaultActiveFactor: 99, factors: { prep: 0 } },
    resources: [{ id: 'fake', type: 'laser' }]
  };
  const snapshot = JSON.stringify(damaged);

  const normalized = CookingCore.normalizeKitchenProfile(damaged);

  assert.equal(JSON.stringify(damaged), snapshot);
  assert.equal(normalized.activeMode, 'extended');
  assert.equal(normalized.modes.extended.kitchenOutlets, 2);
  assert.equal(normalized.calibration.defaultActiveFactor, 1.5);
  assert.equal(normalized.calibration.factors.prep, undefined);
  assert.equal(normalized.resources.some((item) => item.id === 'fake'), false);
});

test('normalizes exact cooking duration overrides', () => {
  const profile = CookingCore.normalizeKitchenProfile({
    calibration: {
      durationOverrides: {
        'meal-rice::prep::отвари рис': 18,
        broken: 0,
        huge: 900
      }
    }
  });

  assert.deepEqual(profile.calibration.durationOverrides, {
    'meal-rice::prep::отвари рис': 18
  });
});

test('applies an exact duration only to the same action and meal', () => {
  const batches = [
    { id: 'rice-batch', mealId: 'meal-rice' },
    { id: 'fish-batch', mealId: 'meal-fish' }
  ];
  const rice = { id: 'rice-step', batchId: 'rice-batch', title: ' Отвари  рис ', category: 'prep', mode: 'active', durationMinutes: 10 };
  const fish = { id: 'fish-step', batchId: 'fish-batch', title: 'отвари рис', category: 'prep', mode: 'active', durationMinutes: 10 };
  const saved = CookingCore.setActionDurationOverride(
    CookingCore.createDefaultKitchenProfile(), rice, batches, 18
  );
  const adjusted = CookingCore.applyCalibrationToActions([rice, fish], saved.profile, batches);

  assert.equal(saved.ok, true);
  assert.equal(adjusted[0].durationMinutes, 18);
  assert.notEqual(adjusted[1].durationMinutes, 18);
});

test('clears an exact duration without resetting pace calibration', () => {
  const batches = [{ id: 'rice-batch', mealId: 'meal-rice' }];
  const action = { id: 'rice-step', batchId: 'rice-batch', title: 'отвари рис', category: 'prep', mode: 'active', durationMinutes: 10 };
  let profile = CookingCore.createDefaultKitchenProfile();
  profile.calibration.factors.prep = 1.8;
  profile = CookingCore.setActionDurationOverride(profile, action, batches, 18).profile;
  profile = CookingCore.clearActionDurationOverride(profile, action, batches).profile;

  assert.equal(profile.calibration.factors.prep, 1.8);
  assert.deepEqual(profile.calibration.durationOverrides, {});
});

test('locks duration editing after a cooking session starts', () => {
  assert.equal(CookingCore.canEditActionDuration(null, 'step'), true);
  assert.equal(CookingCore.canEditActionDuration({ steps: { step: { status: 'pending' } } }, 'step'), false);
  assert.equal(CookingCore.canEditActionDuration({ steps: { step: { status: 'pending' } } }, 'other-step'), false);
  assert.equal(CookingCore.canEditActionDuration({ steps: { step: { status: 'running' } } }, 'step'), false);
  assert.equal(CookingCore.canEditActionDuration({ steps: { step: { status: 'done' } } }, 'step'), false);
});

test('rejects an exact duration without an identifiable action', () => {
  const result = CookingCore.setActionDurationOverride(
    CookingCore.createDefaultKitchenProfile(), null, [], 18
  );

  assert.equal(result.ok, false);
  assert.equal(result.key, '');
});

test('changes a plan fingerprint after saving an exact duration', () => {
  const demand = CookingCore.buildCookingDemand(plan, state(), catalog, 1);
  const batches = [{ id: 'rice-batch', mealId: 'meal-rice' }];
  const action = { id: 'rice-step', batchId: 'rice-batch', title: 'отвари рис', category: 'prep', mode: 'active', durationMinutes: 10 };
  const profile = CookingCore.createDefaultKitchenProfile();
  const saved = CookingCore.setActionDurationOverride(profile, action, batches, 18).profile;

  assert.notEqual(
    CookingCore.createPlanFingerprint(demand, profile),
    CookingCore.createPlanFingerprint(demand, saved)
  );
});

test('applies exact durations to already-calibrated fallback actions', () => {
  const batches = [{
    id: 'rice-batch',
    mealId: 'meal-rice',
    title: 'рис',
    strategy: 'serve-day',
    portions: 1,
    meal: { instructions: ['подготовить продукты'], prepMinutes: { max: 20 } }
  }];
  const action = { batchId: 'rice-batch', title: 'подготовить продукты', category: 'prep' };
  const profile = CookingCore.setActionDurationOverride(
    CookingCore.createDefaultKitchenProfile(), action, batches, 7
  ).profile;

  assert.equal(CookingCore.buildFallbackActions({ batches }, profile)[0].durationMinutes, 7);
});

test('exposes concrete outlets for the active kitchen mode', () => {
  const profile = CookingCore.createDefaultKitchenProfile();

  assert.deepEqual(
    CookingCore.getActiveOutletPool(profile).map((item) => `${item.location}:${item.id}`),
    ['kitchen:kitchen-outlet-1', 'kitchen:kitchen-outlet-2', 'room:room-outlet-1', 'room:room-outlet-2']
  );

  profile.activeMode = 'winter';
  assert.deepEqual(
    CookingCore.getActiveOutletPool(profile).map((item) => item.id),
    ['kitchen-outlet-1', 'kitchen-outlet-2']
  );
});

test('groups repeated meals into stable weekly batches', () => {
  const demand = CookingCore.buildCookingDemand(plan, state(), catalog, 1);
  const rice = demand.batches.find((item) => item.mealId === 'meal-rice');
  const eggs = demand.batches.find((item) => item.mealId === 'meal-eggs');

  assert.equal(rice.strategy, 'batch');
  assert.equal(rice.portions, 7);
  assert.deepEqual(rice.servingDays, [1, 2, 3, 4, 5, 6, 7]);
  assert.match(rice.label, /^партия /);
  assert.equal(Number.isInteger(rice.colorIndex), true);
  assert.equal(eggs.strategy, 'serve-day');
  assert.equal(eggs.portions, 1);
});

test('splits weekly preparation into main lunches and refresh dinners', () => {
  const demand = {
    version: 1,
    cycleId: 'cycle-test',
    week: 1,
    batches: [
      { id: 'lunch', strategy: 'batch', meal: meal('lunch', 'обед', 'lunch') },
      { id: 'dinner', strategy: 'batch', meal: meal('dinner', 'ужин', 'dinner') },
      { id: 'breakfast', strategy: 'batch', meal: meal('breakfast', 'завтрак', 'breakfast') },
      { id: 'serve-day', strategy: 'serve-day', meal: meal('serve-day', 'разовая подача', 'lunch') },
      { id: 'outside', strategy: 'outside', meal: meal('outside', 'вне дома', 'lunch') }
    ]
  };

  const main = CookingCore.selectCookingSessionDemand(demand, 'main');
  const refresh = CookingCore.selectCookingSessionDemand(demand, 'refresh');

  assert.equal(main.sessionKind, 'main');
  assert.deepEqual(main.batches.map((batch) => batch.id), ['lunch']);
  assert.equal(refresh.sessionKind, 'refresh');
  assert.deepEqual(refresh.batches.map((batch) => batch.id), ['dinner']);
  assert.equal(demand.sessionKind, undefined, 'исходный спрос не должен изменяться');
});

test('versions cooking fingerprints and distinguishes preparation sessions', () => {
  const demand = CookingCore.buildCookingDemand(plan, state(), catalog, 1);
  const profile = CookingCore.createDefaultKitchenProfile();
  const mainHash = CookingCore.createPlanFingerprint(
    CookingCore.selectCookingSessionDemand(demand, 'main'),
    profile
  );
  const refreshHash = CookingCore.createPlanFingerprint(
    CookingCore.selectCookingSessionDemand(demand, 'refresh'),
    profile
  );

  assert.match(mainHash, /^cook-v2-/);
  assert.notEqual(mainHash, refreshHash);
});

test('changes only the affected week fingerprint after a replacement', () => {
  const profile = CookingCore.createDefaultKitchenProfile();
  const current = state();
  const beforeWeekOne = CookingCore.createPlanFingerprint(
    CookingCore.buildCookingDemand(plan, current, catalog, 1),
    profile
  );
  const beforeWeekTwo = CookingCore.createPlanFingerprint(
    CookingCore.buildCookingDemand(plan, current, catalog, 2),
    profile
  );

  current.overrides['cycle-test:2:lunch'] = 'meal-fish';
  const afterWeekOne = CookingCore.createPlanFingerprint(
    CookingCore.buildCookingDemand(plan, current, catalog, 1),
    profile
  );
  const afterWeekTwo = CookingCore.createPlanFingerprint(
    CookingCore.buildCookingDemand(plan, current, catalog, 2),
    profile
  );

  assert.notEqual(afterWeekOne, beforeWeekOne);
  assert.equal(afterWeekTwo, beforeWeekTwo);
});

test('stores plans by hash and invalidates one cycle week', () => {
  let store = CookingCore.createEmptyCookingStore();
  store = CookingCore.putCachedPlan(store, {
    planHash: 'hash-1', cycleId: 'cycle-test', week: 1, status: 'ready'
  });
  store = CookingCore.putCachedPlan(store, {
    planHash: 'hash-2', cycleId: 'cycle-test', week: 2, status: 'ready'
  });

  assert.equal(CookingCore.getCachedPlan(store, 'hash-1').week, 1);
  const invalidated = CookingCore.invalidateWeek(store, 'cycle-test', 1);
  assert.equal(CookingCore.getCachedPlan(invalidated, 'hash-1'), null);
  assert.equal(CookingCore.getCachedPlan(invalidated, 'hash-2').week, 2);
  assert.equal(CookingCore.getCachedPlan(store, 'hash-1').week, 1, 'исходное хранилище не мутируется');
});

test('clears cached plans without deleting the active session or its plan', () => {
  let store = CookingCore.createEmptyCookingStore();
  store = CookingCore.putCachedPlan(store, { planHash: 'active-plan', cycleId: 'cycle-test', week: 1 });
  store = CookingCore.putCachedPlan(store, { planHash: 'old-plan', cycleId: 'cycle-test', week: 2 });
  store.sessionsById['session-active'] = { id: 'session-active', planHash: 'active-plan', status: 'running' };
  store.activeSessionId = 'session-active';
  store.lastSessionId = 'session-complete';
  store.lastSessionIdsByWeek = { 'cycle-test:2': 'session-complete' };
  store.calibrationSessionIds = ['session-complete'];
  store.sessionsById['session-complete'] = { id: 'session-complete', planHash: 'old-plan', status: 'completed' };

  const cleared = CookingCore.clearCachedPlans(store);

  assert.equal(CookingCore.getCachedPlan(cleared, 'old-plan'), null);
  assert.equal(CookingCore.getCachedPlan(cleared, 'active-plan').week, 1);
  assert.equal(cleared.activeSessionId, 'session-active');
  assert.equal(cleared.lastSessionId, 'session-complete');
  assert.equal(cleared.lastSessionIdsByWeek['cycle-test:2'], 'session-complete');
  assert.deepEqual(cleared.calibrationSessionIds, ['session-complete']);
  assert.equal(cleared.sessionsById['session-complete'].status, 'completed');
  assert.equal(CookingCore.activeSessionForPlan(cleared, 'active-plan'), true);

  const invalidated = CookingCore.invalidateWeek(cleared, 'cycle-test', 1);
  assert.equal(CookingCore.getCachedPlan(invalidated, 'active-plan').week, 1);
});

test('migrates the calibration order from completed legacy sessions', () => {
  const migrated = CookingCore.normalizeCookingStore({
    version: 1,
    sessionsById: {
      later: { id: 'later', status: 'completed', completedAt: 200, calibrationBase: {}, calibrationResult: {} },
      running: { id: 'running', status: 'running', createdAt: 150 },
      earlier: { id: 'earlier', status: 'completed', completedAt: 100, calibrationBase: {}, calibrationResult: {} }
    }
  });

  assert.deepEqual(migrated.calibrationSessionIds, ['earlier', 'later']);
  const resetStore = CookingCore.normalizeCookingStore({
    sessionsById: migrated.sessionsById,
    calibrationSessionIds: []
  });
  assert.deepEqual(resetStore.calibrationSessionIds, [], 'явный пустой список после сброса не восстанавливает старую историю');
});

test('requires an ai plan to cover every cooking batch exactly', () => {
  const demand = {
    batches: [
      { id: 'batch-a', strategy: 'batch' },
      { id: 'batch-b', strategy: 'serve-day' },
      { id: 'outside', strategy: 'outside' }
    ]
  };

  assert.equal(CookingCore.planCoversDemand({
    batches: [{ id: 'batch-a' }, { id: 'batch-b' }],
    actions: [{ batchId: 'batch-a' }, { batchId: 'batch-b' }]
  }, demand), true);
  assert.equal(CookingCore.planCoversDemand({
    batches: [{ id: 'batch-a' }, { id: 'batch-b' }],
    actions: [{ batchId: 'batch-a' }]
  }, demand), false);
  assert.equal(CookingCore.planCoversDemand({
    batches: [{ id: 'batch-a' }, { id: 'batch-b' }, { id: 'extra' }],
    actions: [{ batchId: 'batch-a' }, { batchId: 'batch-b' }, { batchId: 'extra' }]
  }, demand), false);
});

function action(overrides = {}) {
  return {
    id: 'rice:wash',
    batchId: 'batch-meal-rice',
    title: 'промыть рис',
    durationMinutes: 8,
    mode: 'active',
    category: 'prep',
    dependsOn: [],
    requires: {
      equipmentTypes: [],
      cookwareTypes: ['pot'],
      outletCount: 0,
      locationPreference: 'kitchen'
    },
    ...overrides
  };
}

test('accepts a strict generated action contract', () => {
  const result = CookingCore.validateGeneratedPlan({
    batches: [{ id: 'batch-meal-rice', mealId: 'meal-rice', title: 'рис', portions: 3 }],
    actions: [action()]
  }, CookingCore.createDefaultKitchenProfile());

  assert.equal(result.ok, true);
  assert.equal(result.value.actions[0].title, 'промыть рис');
  assert.deepEqual(result.errors, []);
});

test('normalizes unknown model categories to a calibrated fallback category', () => {
  const result = CookingCore.validateGeneratedPlan({
    batches: [{ id: 'batch-meal-rice', mealId: 'meal-rice', title: 'рис', portions: 3 }],
    actions: [action({ category: 'chopping' })]
  }, CookingCore.createDefaultKitchenProfile());

  assert.equal(result.ok, true);
  assert.equal(result.value.actions[0].category, 'other');
});

test('rejects duplicate ids, unknown resources and missing dependencies', () => {
  const result = CookingCore.validateGeneratedPlan({
    batches: [{ id: 'batch-meal-rice', mealId: 'meal-rice', title: 'рис', portions: 3 }],
    actions: [
      action({ dependsOn: ['missing'], requires: { equipmentTypes: ['laser'], cookwareTypes: [], outletCount: 0, locationPreference: 'kitchen' } }),
      action({ durationMinutes: -1 })
    ]
  }, CookingCore.createDefaultKitchenProfile());

  assert.equal(result.ok, false);
  assert.ok(result.errors.some((item) => item.code === 'duplicate-action-id'));
  assert.ok(result.errors.some((item) => item.code === 'unknown-resource'));
  assert.ok(result.errors.some((item) => item.code === 'missing-dependency'));
  assert.ok(result.errors.some((item) => item.code === 'invalid-duration'));
});

test('rejects cyclic generated actions', () => {
  const result = CookingCore.validateGeneratedPlan({
    batches: [{ id: 'batch-meal-rice', mealId: 'meal-rice', title: 'рис', portions: 3 }],
    actions: [
      action({ id: 'a', dependsOn: ['b'] }),
      action({ id: 'b', dependsOn: ['a'] })
    ]
  }, CookingCore.createDefaultKitchenProfile());

  assert.equal(result.ok, false);
  assert.ok(result.errors.some((item) => item.code === 'cyclic-dependency'));
});

test('rejects generated dependencies between separate meal batches', () => {
  const result = CookingCore.validateGeneratedPlan({
    batches: [
      { id: 'batch-one', mealId: 'one', title: 'первое', portions: 2 },
      { id: 'batch-two', mealId: 'two', title: 'второе', portions: 2 }
    ],
    actions: [
      action({ id: 'one:finish', batchId: 'batch-one' }),
      action({ id: 'two:start', batchId: 'batch-two', dependsOn: ['one:finish'] })
    ]
  }, CookingCore.createDefaultKitchenProfile());

  assert.equal(result.ok, false);
  assert.ok(result.errors.some((item) => item.code === 'cross-batch-dependency'));
});

test('builds a conservative sequential fallback from meal instructions', () => {
  const demand = {
    version: 1,
    cycleId: 'cycle-test',
    week: 1,
    batches: [{
      id: 'batch-rice',
      mealId: 'rice',
      title: 'рис',
      portions: 3,
      strategy: 'batch',
      servingDays: [1, 2, 3],
      meal: {
        id: 'rice',
        title: 'рис',
        prepMinutes: range(20, 30),
        instructions: ['промыть рис', 'варить рис 20 минут']
      }
    }]
  };

  const actions = CookingCore.buildFallbackActions(demand, CookingCore.createDefaultKitchenProfile());

  assert.equal(actions.length, 3);
  assert.equal(actions[0].mode, 'active');
  assert.ok(actions[0].durationMinutes >= 15 * 1.5);
  assert.equal(actions[1].mode, 'passive');
  assert.equal(actions[1].durationMinutes, 20, 'физическое время варки не сокращается');
  assert.deepEqual(actions[1].dependsOn, [actions[0].id]);
  assert.match(actions[2].title, /разложить 3 порции/);
  assert.deepEqual(actions[2].dependsOn, [actions[1].id]);
  assert.equal(CookingCore.validateGeneratedPlan({ batches: demand.batches, actions }, CookingCore.createDefaultKitchenProfile()).ok, true);
});

test('keeps fallback dependencies inside each batch without chaining separate meals', () => {
  const demand = {
    version: 1,
    cycleId: 'cycle-test',
    week: 1,
    batches: [
      {
        id: 'batch-one', title: 'первое блюдо', portions: 2, strategy: 'batch',
        meal: { title: 'первое блюдо', prepMinutes: range(20, 30), instructions: ['нарезать первое', 'свари первое'] }
      },
      {
        id: 'batch-two', title: 'второе блюдо', portions: 2, strategy: 'batch',
        meal: { title: 'второе блюдо', prepMinutes: range(20, 30), instructions: ['нарезать второе', 'запеки второе'] }
      }
    ]
  };

  const actions = CookingCore.buildFallbackActions(demand, CookingCore.createDefaultKitchenProfile());
  const firstOfSecondBatch = actions.find((action) => action.id === 'batch-two:fallback-1');
  const secondOfSecondBatch = actions.find((action) => action.id === 'batch-two:fallback-2');

  assert.deepEqual(firstOfSecondBatch.dependsOn, []);
  assert.deepEqual(secondOfSecondBatch.dependsOn, ['batch-two:fallback-1']);
});

test('recognizes imperative cooking verbs from the built-in meal catalog', () => {
  const demand = {
    version: 1,
    cycleId: 'cycle-test',
    week: 1,
    batches: [{
      id: 'batch-real-phrases', mealId: 'real-phrases', title: 'реальные формулировки',
      portions: 2, strategy: 'batch', servingDays: [1, 2],
      meal: {
        id: 'real-phrases', title: 'реальные формулировки', prepMinutes: range(30, 40),
        instructions: ['свари овсянку', 'запеки рыбу', 'потуши курицу', 'разогрей картофель']
      }
    }]
  };

  const actions = CookingCore.buildFallbackActions(demand, CookingCore.createDefaultKitchenProfile());

  assert.deepEqual(actions[0].requires.equipmentTypes, ['burner']);
  assert.deepEqual(actions[0].requires.cookwareTypes, ['pot']);
  assert.equal(actions[0].mode, 'passive');
  assert.deepEqual(actions[1].requires.equipmentTypes, ['airFryer']);
  assert.deepEqual(actions[2].requires.equipmentTypes, ['burner']);
  assert.deepEqual(actions[2].requires.cookwareTypes, ['deepPan']);
  assert.deepEqual(actions[3].requires.equipmentTypes, ['microwave']);
});

function sessionPlan() {
  return {
    planHash: 'plan-session',
    cycleId: 'cycle-test',
    week: 1,
    sessionKind: 'refresh',
    actions: [
      action({ id: 'prepare', durationMinutes: 10, category: 'prep' }),
      action({ id: 'cook', mode: 'passive', durationMinutes: 20, category: 'physical', dependsOn: ['prepare'] })
    ]
  };
}

test('tracks start, pause, resume and completion without counting pauses', () => {
  let session = CookingCore.startSession(sessionPlan(), 0);
  assert.equal(session.sessionKind, 'refresh');
  const blocked = CookingCore.startStep(session, 'cook', 0);
  assert.equal(blocked.ok, false);
  assert.equal(blocked.error.code, 'blocked-dependency');

  session = CookingCore.startStep(session, 'prepare', 0).session;
  session = CookingCore.pauseStep(session, 'prepare', 5 * 60 * 1000).session;
  session = CookingCore.startStep(session, 'prepare', 7 * 60 * 1000).session;
  session = CookingCore.completeStep(session, 'prepare', 12 * 60 * 1000).session;

  assert.equal(session.steps.prepare.status, 'done');
  assert.equal(session.steps.prepare.actualMs, 10 * 60 * 1000);
  assert.equal(session.steps.prepare.pauses.length, 1);
  assert.deepEqual(JSON.parse(JSON.stringify(session)), session);
});

test('skipped prerequisites resolve dependencies but remain visible in the journal', () => {
  let session = CookingCore.startSession(sessionPlan(), 1000);
  session = CookingCore.skipStep(session, 'prepare', 2000).session;
  const next = CookingCore.startStep(session, 'cook', 3000);

  assert.equal(session.steps.prepare.status, 'skipped');
  assert.equal(next.ok, true);
  assert.equal(next.session.steps.cook.status, 'running');
});

test('offers an independent active step while a passive process is running', () => {
  const parallelPlan = {
    planHash: 'parallel-plan', cycleId: 'cycle-test', week: 1,
    actions: [
      action({ id: 'passive', mode: 'passive', category: 'physical', dependsOn: [] }),
      action({ id: 'independent', mode: 'active', category: 'prep', dependsOn: [] }),
      action({ id: 'after-passive', mode: 'active', category: 'prep', dependsOn: ['passive'] })
    ]
  };
  let session = CookingCore.startSession(parallelPlan, 0);
  session = CookingCore.startStep(session, 'passive', 0).session;

  assert.equal(CookingCore.nextSessionActionId(parallelPlan.actions, session), 'independent');
});

test('does not offer or start a step that reuses resources held by a running process', () => {
  const resourcePlan = {
    planHash: 'resource-plan', cycleId: 'cycle-test', week: 1,
    actions: [
      action({
        id: 'first-pot', mode: 'passive', category: 'physical', dependsOn: [],
        assignedResources: { equipmentIds: ['burner-1'], cookwareIds: ['pot-1'], outletIds: ['kitchen-outlet-1'] }
      }),
      action({
        id: 'second-pot', mode: 'passive', category: 'physical', dependsOn: [],
        assignedResources: { equipmentIds: ['burner-1'], cookwareIds: ['pot-1'], outletIds: ['kitchen-outlet-1'] }
      })
    ]
  };
  let session = CookingCore.startSession(resourcePlan, 0);
  session = CookingCore.startStep(session, 'first-pot', 0).session;

  assert.equal(CookingCore.nextSessionActionId(resourcePlan.actions, session), 'first-pot');
  const blocked = CookingCore.startStep(session, 'second-pot', 1000);
  assert.equal(blocked.ok, false);
  assert.equal(blocked.error.code, 'resource-in-use');
});

test('calibrates active categories with bounded smoothing and ignores passive time', () => {
  const profile = CookingCore.createDefaultKitchenProfile();
  let session = CookingCore.startSession(sessionPlan(), 0);
  session = CookingCore.startStep(session, 'prepare', 0).session;
  session = CookingCore.completeStep(session, 'prepare', 20 * 60 * 1000).session;
  session = CookingCore.startStep(session, 'cook', 20 * 60 * 1000).session;
  session = CookingCore.completeStep(session, 'cook', 80 * 60 * 1000).session;

  const calibrated = CookingCore.updateCalibration(profile, session);

  assert.equal(calibrated.calibration.factors.prep, 1.875);
  assert.equal(calibrated.calibration.factors.physical, undefined);
  assert.equal(calibrated.calibration.observations.prep, 1);
  assert.deepEqual(profile.calibration.factors, {}, 'исходный профиль не мутируется');
});

test('applies pace factors only to active work and supports reset', () => {
  const profile = CookingCore.createDefaultKitchenProfile();
  profile.calibration.factors.prep = 2;
  const adjusted = CookingCore.applyCalibrationToActions(sessionPlan().actions, profile);

  assert.equal(adjusted[0].durationMinutes, 20);
  assert.equal(adjusted[1].durationMinutes, 20);
  assert.equal(adjusted[1].mode, 'passive');

  const reset = CookingCore.resetCalibration(profile);
  assert.deepEqual(reset.calibration.factors, {});
  assert.deepEqual(reset.calibration.observations, {});
});

test('allows correction of an accidentally recorded actual time', () => {
  let session = CookingCore.startSession(sessionPlan(), 0);
  session = CookingCore.startStep(session, 'prepare', 0).session;
  session = CookingCore.completeStep(session, 'prepare', 3 * 60 * 1000).session;
  const corrected = CookingCore.setStepActualMinutes(session, 'prepare', 14);

  assert.equal(corrected.ok, true);
  assert.equal(corrected.session.steps.prepare.actualMs, 14 * 60 * 1000);
  assert.equal(corrected.session.steps.prepare.manualActualMinutes, 14);
});

test('recalculates a completed session from its original calibration baseline after correction', () => {
  const profile = CookingCore.createDefaultKitchenProfile();
  let session = CookingCore.startSession(sessionPlan(), 0);
  session = CookingCore.startStep(session, 'prepare', 0).session;
  session = CookingCore.completeStep(session, 'prepare', 20 * 60 * 1000).session;
  const first = CookingCore.applySessionCalibration(profile, session);
  const corrected = CookingCore.setStepActualMinutes(first.session, 'prepare', 10).session;
  const recalculated = CookingCore.applySessionCalibration(first.profile, corrected, true);

  assert.equal(first.profile.calibration.factors.prep, 1.875);
  assert.equal(recalculated.profile.calibration.factors.prep, 1.5);
  assert.equal(recalculated.profile.calibration.observations.prep, 1);
  assert.equal(recalculated.session.calibrationResult.factors.prep, 1.5);
});

test('replays later calibration sessions after correcting an older observation', () => {
  const profile = CookingCore.createDefaultKitchenProfile();
  let firstSession = CookingCore.startSession(sessionPlan(), 0);
  firstSession = CookingCore.startStep(firstSession, 'prepare', 0).session;
  firstSession = CookingCore.completeStep(firstSession, 'prepare', 20 * 60 * 1000).session;
  const firstApplied = CookingCore.applySessionCalibration(profile, firstSession);

  let secondSession = CookingCore.startSession({ ...sessionPlan(), planHash: 'plan-session-2' }, 30 * 60 * 1000);
  secondSession = CookingCore.startStep(secondSession, 'prepare', 30 * 60 * 1000).session;
  secondSession = CookingCore.completeStep(secondSession, 'prepare', 40 * 60 * 1000).session;
  const secondApplied = CookingCore.applySessionCalibration(firstApplied.profile, secondSession);
  const correctedFirst = CookingCore.setStepActualMinutes(firstApplied.session, 'prepare', 10).session;

  const replayed = CookingCore.replaySessionCalibrations(secondApplied.profile, [correctedFirst, secondApplied.session]);

  assert.equal(replayed.profile.calibration.factors.prep, 1.5);
  assert.equal(replayed.profile.calibration.observations.prep, 2);
  assert.equal(replayed.sessions[0].calibrationResult.factors.prep, 1.5);
  assert.equal(replayed.sessions[1].calibrationBase.factors.prep, 1.5);
});
