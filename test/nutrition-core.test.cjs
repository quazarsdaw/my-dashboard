const assert = require('node:assert/strict');
const test = require('node:test');

const NutritionCore = require('../nutrition-core.js');

function range(min, max) {
  return { min, max };
}

function ingredient(id, name, amount, unit = 'г', category = 'bases') {
  return { id, name, amount, unit, category };
}

function meal(overrides = {}) {
  return {
    id: 'seed-breakfast-a',
    source: 'seed',
    mealType: 'breakfast',
    title: 'тестовый завтрак',
    tags: ['быстро'],
    prepMinutes: range(5, 10),
    caloriesApprox: range(400, 450),
    proteinApprox: range(20, 25),
    estimatedCostRub: range(100, 120),
    ingredients: [ingredient('oats', 'овсяные хлопья', 70)],
    instructions: ['смешать ингредиенты'],
    notes: '',
    ...overrides
  };
}

const seedMeals = [
  meal(),
  meal({
    id: 'seed-breakfast-b',
    title: 'другой завтрак',
    caloriesApprox: range(500, 550),
    proteinApprox: range(30, 35),
    estimatedCostRub: range(150, 180),
    ingredients: [ingredient('rice', 'рис', 80)]
  }),
  meal({
    id: 'seed-lunch-a',
    mealType: 'lunch',
    title: 'тестовый обед',
    caloriesApprox: range(700, 750),
    proteinApprox: range(40, 45),
    estimatedCostRub: range(220, 260),
    ingredients: [
      ingredient('rice', 'рис', 100),
      ingredient('chicken', 'курица', 150, 'г', 'protein')
    ]
  }),
  meal({
    id: 'seed-dinner-a',
    mealType: 'dinner',
    title: 'тестовый ужин',
    caloriesApprox: range(600, 650),
    proteinApprox: range(35, 40),
    estimatedCostRub: range(200, 240),
    ingredients: [ingredient('potato', 'картофель', 300)]
  })
];

const template = {
  id: 'plan-14-v1',
  days: [
    { day: 1, meals: { breakfast: 'seed-breakfast-a', lunch: 'seed-lunch-a', dinner: 'seed-dinner-a' } },
    { day: 2, meals: { breakfast: 'seed-breakfast-a', lunch: 'seed-lunch-a', dinner: 'seed-dinner-a' } },
    { day: 8, meals: { breakfast: 'seed-breakfast-a', lunch: 'seed-lunch-a', dinner: 'seed-dinner-a' } }
  ]
};

test('normalizes valid local date keys and rejects impossible dates', () => {
  assert.equal(NutritionCore.normalizeLocalDate('2026-07-17'), '2026-07-17');
  assert.equal(NutritionCore.normalizeLocalDate('2026-02-30'), null);
  assert.equal(NutritionCore.normalizeLocalDate('17.07.2026'), null);
});

test('calculates a one-based cycle day from calendar dates', () => {
  assert.deepEqual(
    NutritionCore.getCycleDay('2026-07-17', '2026-07-17'),
    { dayNumber: 1, daysElapsed: 0, completed: false, beforeStart: false }
  );
  assert.deepEqual(
    NutritionCore.getCycleDay('2026-07-17', '2026-07-30'),
    { dayNumber: 14, daysElapsed: 13, completed: false, beforeStart: false }
  );
  assert.deepEqual(
    NutritionCore.getCycleDay('2026-07-17', '2026-07-31'),
    { dayNumber: 14, daysElapsed: 14, completed: true, beforeStart: false }
  );
});

test('marks dates before the cycle start without returning a negative day', () => {
  assert.deepEqual(
    NutritionCore.getCycleDay('2026-07-17', '2026-07-15'),
    { dayNumber: 1, daysElapsed: -2, completed: false, beforeStart: true }
  );
});

test('accepts valid imported meals and reports invalid or conflicting entries', () => {
  const payload = {
    version: 1,
    meals: [
      meal({ id: 'import-breakfast-berry', source: 'imported', title: 'овсянка с ягодами' }),
      meal({ id: 'seed-breakfast-a', source: 'imported', title: 'конфликт' }),
      meal({ id: 'import-broken', source: 'imported', mealType: 'snack' })
    ]
  };

  const result = NutritionCore.validateImportedCatalog(payload, seedMeals, []);

  assert.equal(result.ok, true);
  assert.deepEqual(result.meals.map((item) => item.id), ['import-breakfast-berry']);
  assert.equal(result.skipped, 2);
  assert.ok(result.errors.some((item) => item.code === 'duplicate-id'));
  assert.ok(result.errors.some((item) => item.code === 'invalid-meal'));
});

test('rejects an invalid catalog envelope without returning partial data', () => {
  const result = NutritionCore.validateImportedCatalog({ version: 2, meals: [] }, seedMeals, []);

  assert.equal(result.ok, false);
  assert.equal(result.code, 'invalid-payload');
  assert.deepEqual(result.meals, []);
});

test('keeps seed meals authoritative when catalogs are merged', () => {
  const imported = [
    meal({ id: 'seed-breakfast-a', source: 'imported', title: 'не должен заменить основу' }),
    meal({ id: 'import-breakfast-c', source: 'imported', title: 'новое блюдо' })
  ];

  const merged = NutritionCore.mergeCatalog(seedMeals, imported);

  assert.equal(merged.length, seedMeals.length + 1);
  assert.equal(merged.find((item) => item.id === 'seed-breakfast-a').title, 'тестовый завтрак');
  assert.equal(seedMeals.length, 4);
  assert.equal(imported.length, 2);
});

test('resolves replacements and falls back to the template for unknown meal ids', () => {
  const state = NutritionCore.createDefaultState('2026-07-17');
  state.overrides[`${state.activeCycle.id}:1:breakfast`] = 'seed-breakfast-b';
  state.overrides[`${state.activeCycle.id}:1:lunch`] = 'missing-meal';

  const day = NutritionCore.resolveDayPlan(template, state, 1, seedMeals);

  assert.equal(day.meals.breakfast.id, 'seed-breakfast-b');
  assert.equal(day.meals.lunch.id, 'seed-lunch-a');
  assert.equal(day.meals.dinner.id, 'seed-dinner-a');
});

test('sums approximate day ranges and an optional training extra', () => {
  const state = NutritionCore.createDefaultState('2026-07-17');
  const day = NutritionCore.resolveDayPlan(template, state, 1, seedMeals);
  const extra = meal({
    id: 'seed-extra-a',
    mealType: 'extra',
    caloriesApprox: range(200, 220),
    proteinApprox: range(5, 7),
    estimatedCostRub: range(50, 60)
  });

  const summary = NutritionCore.calculateDaySummary(day, seedMeals, extra);

  assert.deepEqual(summary.caloriesApprox, range(1900, 2070));
  assert.deepEqual(summary.proteinApprox, range(100, 117));
  assert.deepEqual(summary.estimatedCostRub, range(570, 680));
});

test('aggregates ingredients by stable id and unit for one week', () => {
  const state = NutritionCore.createDefaultState('2026-07-17');
  const shopping = NutritionCore.buildShoppingList(template, state, seedMeals, 1);

  assert.deepEqual(
    shopping.find((item) => item.id === 'rice'),
    { id: 'rice', name: 'рис', amount: 200, unit: 'г', category: 'bases' }
  );
  assert.deepEqual(
    shopping.find((item) => item.id === 'chicken'),
    { id: 'chicken', name: 'курица', amount: 300, unit: 'г', category: 'protein' }
  );
});

test('updates shopping for the affected week after a meal replacement', () => {
  const state = NutritionCore.createDefaultState('2026-07-17');
  state.overrides[`${state.activeCycle.id}:1:breakfast`] = 'seed-breakfast-b';

  const firstWeek = NutritionCore.buildShoppingList(template, state, seedMeals, 1);
  const secondWeek = NutritionCore.buildShoppingList(template, state, seedMeals, 2);

  assert.equal(firstWeek.find((item) => item.id === 'oats').amount, 70);
  assert.equal(firstWeek.find((item) => item.id === 'rice').amount, 280);
  assert.equal(secondWeek.find((item) => item.id === 'oats').amount, 70);
  assert.equal(secondWeek.find((item) => item.id === 'rice').amount, 100);
});

test('does not add outside meals to the grocery shopping list', () => {
  const outside = meal({
    id: 'seed-breakfast-outside',
    tags: ['вне дома'],
    ingredients: [ingredient('cafe-breakfast', 'завтрак в кафе', 1, 'порция', 'other')]
  });
  const outsideTemplate = {
    id: 'outside-plan',
    days: [
      { day: 1, meals: { breakfast: outside.id, lunch: 'seed-lunch-a', dinner: 'seed-dinner-a' } }
    ]
  };

  const shopping = NutritionCore.buildShoppingList(
    outsideTemplate,
    NutritionCore.createDefaultState('2026-07-17'),
    seedMeals.concat(outside),
    1
  );

  assert.equal(shopping.some((item) => item.id === 'cafe-breakfast'), false);
  assert.equal(shopping.some((item) => item.id === 'chicken'), true);
});

test('prices shopping amounts by kilogram, litre and item', () => {
  const priced = NutritionCore.priceShoppingItems([
    ingredient('chicken', 'курица', 300, 'г', 'protein'),
    ingredient('milk', 'молоко', 500, 'мл', 'dairy'),
    ingredient('eggs', 'яйца', 4, 'шт', 'protein')
  ], {
    'chicken::г': 500,
    'milk::мл': 120,
    'eggs::шт': 12
  }, {});

  assert.deepEqual(priced.map((item) => item.priceLabel), ['₽/кг', '₽/л', '₽/шт']);
  assert.deepEqual(priced.map((item) => item.lineCostRub), [150, 60, 48]);
  assert.equal(NutritionCore.calculateShoppingTotal(priced), 258);
});

test('uses defaults only when a saved ingredient price is absent', () => {
  const priced = NutritionCore.priceShoppingItems([
    ingredient('oats', 'овсяные хлопья', 500)
  ], { 'oats::г': 240 }, { 'oats::г': 180 });

  assert.equal(priced[0].unitPriceRub, 240);
  assert.equal(priced[0].lineCostRub, 120);
  assert.equal(priced[0].hasPrice, true);
});

test('keeps a separate price book authoritative over legacy nutrition state', () => {
  const legacyPrices = { 'oats::г': 180 };

  assert.deepEqual(
    NutritionCore.resolvePriceBook(legacyPrices, {
      version: 1,
      prices: { 'oats::г': 321, 'milk::мл': 120 }
    }),
    { 'oats::г': 321, 'milk::мл': 120 }
  );
  assert.deepEqual(NutritionCore.resolvePriceBook(legacyPrices, null), legacyPrices);
  assert.deepEqual(
    NutritionCore.resolvePriceBook(legacyPrices, { version: 1, prices: {} }),
    {}
  );
});

test('builds one readable warped timeline scale for every resource lane', () => {
  const scale = NutritionCore.buildTimelineScale([
    { startMinute: 0, endMinute: 10 },
    { startMinute: 4, endMinute: 6 }
  ], 10, 7, 220);

  assert.equal(scale.width, 660);
  assert.equal(scale.positionAt(0), 0);
  assert.equal(scale.positionAt(4), 220);
  assert.equal(scale.positionAt(6), 440);
  assert.equal(scale.positionAt(10), 660);
  assert.equal(scale.positionAt(6) - scale.positionAt(4), 220);
});

test('keeps a regular time scale when one interval is already wide enough', () => {
  const scale = NutritionCore.buildTimelineScale([], 100, 7, 220);

  assert.equal(scale.width, 700);
  assert.equal(scale.positionAt(50), 350);
});

test('keeps partially overlapping resource actions on one shared scale', () => {
  const scale = NutritionCore.buildTimelineScale([
    { resource: 'user', startMinute: 0, endMinute: 10 },
    { resource: 'air_fryer', startMinute: 5, endMinute: 15 }
  ], 15, 7, 220);

  assert.equal(scale.width, 660);
  assert.equal(scale.positionAt(5), 220);
  assert.equal(scale.positionAt(10), 440);
  assert.equal(scale.positionAt(15), 660);
  assert.equal(scale.positionAt(10) - scale.positionAt(5), 220);
});

test('normalizes damaged state while preserving supported cycle data', () => {
  const normalized = NutritionCore.normalizeState({
    version: 1,
    activeCycle: { id: 'cycle-custom', startDate: '2026-07-01', templateId: 'plan-14-v1' },
    overrides: null,
    completions: { 'cycle-custom:1:breakfast': true },
    notes: 'broken',
    trainingDays: [],
    shoppingChecks: null,
    ingredientPrices: {
      'oats::г': 180,
      'negative::г': -1,
      'broken::шт': 'дорого',
      'free::шт': 0
    },
    cookingChecks: null,
    history: 'broken'
  }, '2026-07-17');

  assert.equal(normalized.activeCycle.id, 'cycle-custom');
  assert.equal(normalized.activeCycle.startDate, '2026-07-01');
  assert.deepEqual(normalized.overrides, {});
  assert.equal(normalized.completions['cycle-custom:1:breakfast'], true);
  assert.deepEqual(normalized.notes, {});
  assert.deepEqual(normalized.ingredientPrices, { 'oats::г': 180, 'free::шт': 0 });
  assert.deepEqual(normalized.history, []);
});

test('stores an immutable two-week shopping cost in a cycle snapshot', () => {
  const state = NutritionCore.createDefaultState('2026-07-01');
  state.ingredientPrices = {
    'oats::г': 200,
    'rice::г': 100,
    'chicken::г': 500,
    'potato::г': 50
  };

  const snapshot = NutritionCore.createCycleSnapshot(state, template, seedMeals, {});
  state.ingredientPrices['chicken::г'] = 900;

  assert.equal(snapshot.shoppingCostRub, 342);
});

test('starts a new cycle with a snapshot and clean active collections', () => {
  const state = NutritionCore.createDefaultState('2026-07-01');
  state.completions[`${state.activeCycle.id}:1:breakfast`] = true;
  state.trainingDays[`${state.activeCycle.id}:1`] = true;
  const snapshot = NutritionCore.createCycleSnapshot(state, template, seedMeals);

  const next = NutritionCore.startNextCycle(state, '2026-07-15', 'repeat', snapshot);

  assert.equal(next.activeCycle.startDate, '2026-07-15');
  assert.notEqual(next.activeCycle.id, state.activeCycle.id);
  assert.deepEqual(next.overrides, {});
  assert.deepEqual(next.completions, {});
  assert.deepEqual(next.trainingDays, {});
  assert.deepEqual(next.ingredientPrices, state.ingredientPrices);
  assert.equal(next.history.length, 1);
  assert.equal(next.history[0].completedMeals, 1);
  assert.equal(next.history[0].trainingDays, 1);
  assert.equal(next.history[0].completions[`${state.activeCycle.id}:1:breakfast`], true);
  assert.equal(next.history[0].trainingDayMap[`${state.activeCycle.id}:1`], true);
});
