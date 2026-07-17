const assert = require('node:assert/strict');
const test = require('node:test');

const CookingCore = require('../nutrition-cooking-core.js');
let Scheduler = null;
try {
  Scheduler = require('../nutrition-scheduler.js');
} catch (_) {
  Scheduler = null;
}

function action(id, overrides = {}) {
  return {
    id,
    batchId: 'batch-main',
    title: id,
    durationMinutes: 10,
    mode: 'active',
    category: 'prep',
    dependsOn: [],
    requires: {
      equipmentTypes: [],
      cookwareTypes: [],
      outletCount: 0,
      locationPreference: 'kitchen'
    },
    ...overrides
  };
}

test('schedules dependencies after their prerequisites', () => {
  assert.ok(Scheduler, 'nutrition-scheduler.js должен существовать');
  const result = Scheduler.scheduleActions([
    action('prepare', { durationMinutes: 12 }),
    action('cook', { mode: 'passive', durationMinutes: 20, dependsOn: ['prepare'] })
  ], CookingCore.createDefaultKitchenProfile());

  assert.equal(result.ok, true);
  const prepare = result.schedule.find((item) => item.actionId === 'prepare');
  const cook = result.schedule.find((item) => item.actionId === 'cook');
  assert.ok(cook.startMinute >= prepare.endMinute);
});

test('does not overlap active user work but overlaps passive cooking', () => {
  const result = Scheduler.scheduleActions([
    action('cut', { durationMinutes: 15 }),
    action('wash', { durationMinutes: 10 }),
    action('boil', {
      mode: 'passive',
      durationMinutes: 30,
      requires: {
        equipmentTypes: ['burner'],
        cookwareTypes: ['pot'],
        outletCount: 1,
        locationPreference: 'kitchen'
      }
    })
  ], CookingCore.createDefaultKitchenProfile());

  const cut = result.schedule.find((item) => item.actionId === 'cut');
  const wash = result.schedule.find((item) => item.actionId === 'wash');
  const boil = result.schedule.find((item) => item.actionId === 'boil');
  assert.equal(result.ok, true);
  assert.ok(cut.endMinute <= wash.startMinute || wash.endMinute <= cut.startMinute);
  assert.equal(boil.startMinute, 0);
  assert.ok(boil.endMinute > Math.min(cut.endMinute, wash.endMinute));
});

test('keeps cookware, appliances and outlets exclusive', () => {
  const requirements = {
    equipmentTypes: ['burner'],
    cookwareTypes: ['pot'],
    outletCount: 1,
    locationPreference: 'kitchen'
  };
  const result = Scheduler.scheduleActions([
    action('pot-a', { mode: 'passive', durationMinutes: 20, requires: requirements }),
    action('pot-b', { mode: 'passive', durationMinutes: 20, requires: requirements })
  ], CookingCore.createDefaultKitchenProfile());

  assert.equal(result.ok, true);
  const first = result.schedule.find((item) => item.actionId === 'pot-a');
  const second = result.schedule.find((item) => item.actionId === 'pot-b');
  assert.ok(first.endMinute <= second.startMinute || second.endMinute <= first.startMinute);
  assert.equal(Scheduler.findResourceConflicts(result.schedule).length, 0);
});

test('prefers room outlets for air fryer and multicooker in extended mode', () => {
  const result = Scheduler.scheduleActions([
    action('air', {
      mode: 'passive',
      requires: { equipmentTypes: ['airFryer'], cookwareTypes: [], outletCount: 1, locationPreference: 'room' }
    }),
    action('multi', {
      mode: 'passive',
      requires: { equipmentTypes: ['multicooker'], cookwareTypes: [], outletCount: 1, locationPreference: 'room' }
    })
  ], CookingCore.createDefaultKitchenProfile());

  assert.equal(result.ok, true);
  assert.deepEqual(result.schedule.map((item) => item.location), ['room', 'room']);
  assert.ok(result.schedule.every((item) => item.outletIds[0].startsWith('room-outlet-')));
});

test('extended mode schedules more parallel appliances than winter mode', () => {
  const actions = [
    action('burner', {
      mode: 'passive', durationMinutes: 30,
      requires: { equipmentTypes: ['burner'], cookwareTypes: ['pot'], outletCount: 1, locationPreference: 'kitchen' }
    }),
    action('air', {
      mode: 'passive', durationMinutes: 30,
      requires: { equipmentTypes: ['airFryer'], cookwareTypes: [], outletCount: 1, locationPreference: 'room' }
    }),
    action('multi', {
      mode: 'passive', durationMinutes: 30,
      requires: { equipmentTypes: ['multicooker'], cookwareTypes: [], outletCount: 1, locationPreference: 'room' }
    })
  ];
  const extended = CookingCore.createDefaultKitchenProfile();
  const winter = CookingCore.createDefaultKitchenProfile();
  winter.activeMode = 'winter';

  const extendedResult = Scheduler.scheduleActions(actions, extended);
  const winterResult = Scheduler.scheduleActions(actions, winter);

  assert.equal(extendedResult.ok, true);
  assert.equal(winterResult.ok, true);
  assert.equal(extendedResult.estimate.minMinutes, 30);
  assert.ok(winterResult.estimate.minMinutes > extendedResult.estimate.minMinutes);
  assert.equal(extendedResult.peakOutlets, 3);
  assert.equal(winterResult.peakOutlets, 2);
});

test('reports each kind of resource conflict', () => {
  const conflicts = Scheduler.findResourceConflicts([
    {
      actionId: 'a', startMinute: 0, endMinute: 10, userOccupied: true,
      equipmentIds: ['burner-1'], cookwareIds: ['pot-1'], outletIds: ['kitchen-outlet-1']
    },
    {
      actionId: 'b', startMinute: 5, endMinute: 15, userOccupied: true,
      equipmentIds: ['burner-1'], cookwareIds: ['pot-1'], outletIds: ['kitchen-outlet-1']
    }
  ]);

  assert.ok(conflicts.some((item) => item.code === 'user-conflict'));
  assert.ok(conflicts.some((item) => item.code === 'equipment-conflict'));
  assert.ok(conflicts.some((item) => item.code === 'cookware-conflict'));
  assert.ok(conflicts.some((item) => item.code === 'outlet-conflict'));
});

test('returns the same schedule for the same input', () => {
  const actions = [action('b'), action('a')];
  const profile = CookingCore.createDefaultKitchenProfile();

  const first = Scheduler.scheduleActions(actions, profile);
  const second = Scheduler.scheduleActions(actions, profile);

  assert.deepEqual(first, second);
});
