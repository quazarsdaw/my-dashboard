const assert = require('node:assert/strict');
const test = require('node:test');

const NutritionCore = require('../nutrition-core.js');
const NutritionData = require('../nutrition-data.js');

test('seed catalog uses unique stable ids and valid meal records', () => {
  const ids = NutritionData.meals.map((meal) => meal.id);

  assert.equal(new Set(ids).size, ids.length);
  assert.ok(ids.length >= 14);
  NutritionData.meals.forEach((meal) => {
    assert.equal(meal.source, 'seed');
    assert.equal(NutritionCore.validateMeal(meal).ok, true, meal.id);
    assert.ok(meal.estimatedCostRub.min > 0, meal.id);
  });
});

test('default plan contains fourteen complete days and only known meals', () => {
  const ids = new Set(NutritionData.meals.map((meal) => meal.id));

  assert.equal(NutritionData.plan14.days.length, 14);
  NutritionData.plan14.days.forEach((day, index) => {
    assert.equal(day.day, index + 1);
    assert.deepEqual(Object.keys(day.meals).sort(), ['breakfast', 'dinner', 'lunch']);
    Object.values(day.meals).forEach((mealId) => assert.equal(ids.has(mealId), true, mealId));
  });
});

test('catalog includes outside meals and training extras', () => {
  const outsideMeals = NutritionData.meals.filter((meal) => meal.tags.includes('вне дома'));
  const extraIds = new Set(NutritionData.trainingExtras.map((item) => item.mealId));

  assert.ok(outsideMeals.length >= 3);
  assert.equal(NutritionData.trainingExtras.length, 3);
  extraIds.forEach((mealId) => {
    const meal = NutritionData.meals.find((item) => item.id === mealId);
    assert.ok(meal, mealId);
    assert.equal(meal.mealType, 'extra');
  });
});

test('each week has separate main and short cooking sessions', () => {
  assert.deepEqual(Object.keys(NutritionData.cookingSessions).sort(), ['1', '2']);

  [1, 2].forEach((week) => {
    const sessions = NutritionData.cookingSessions[week];
    assert.equal(sessions.length, 2);
    assert.deepEqual(sessions.map((item) => item.kind).sort(), ['main', 'short']);
    sessions.forEach((session) => {
      assert.ok(session.title);
      assert.ok(session.durationLabel.startsWith('≈'));
      assert.ok(session.steps.length >= 4);
      assert.equal(new Set(session.steps.map((step) => step.id)).size, session.steps.length);
    });
  });
});

test('ingredient categories have user-facing labels', () => {
  const usedCategories = new Set();
  NutritionData.meals.forEach((meal) => {
    meal.ingredients.forEach((ingredient) => usedCategories.add(ingredient.category));
  });

  usedCategories.forEach((category) => {
    assert.ok(NutritionData.ingredientCategories[category], category);
  });
});
