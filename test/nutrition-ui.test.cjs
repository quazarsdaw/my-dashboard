const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

function read(file) {
  return fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
}

test('nutrition controller persists both state layers through gamification storage', () => {
  const js = read('nutrition.js');

  assert.ok(js.includes("STATE_KEY = 'nutrition_state_v1'"));
  assert.ok(js.includes("MEALS_KEY = 'nutrition_meals_v1'"));
  assert.ok(js.includes('Gamification.storeSet(STATE_KEY'));
  assert.ok(js.includes('Gamification.storeSet(MEALS_KEY'));
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
  assert.ok(js.includes('NutritionData.cookingSessions'));
  assert.ok(js.includes('cookingWeek'));
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
  assert.ok(js.includes('event.key === STATE_KEY'));
  assert.ok(js.includes('event.key === MEALS_KEY'));
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
