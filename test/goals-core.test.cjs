const assert = require('node:assert/strict');
const test = require('node:test');

const GoalsCore = require('../goals-core.js');

test('неделя начинается в понедельник по времени екатеринбурга', () => {
  assert.equal(
    GoalsCore.currentPeriodKey('week', new Date('2026-10-04T18:59:59.000Z')),
    '2026-09-28'
  );
  assert.equal(
    GoalsCore.currentPeriodKey('week', new Date('2026-10-04T19:00:00.000Z')),
    '2026-10-05'
  );
});

test('неделя на стыке года хранит дату своего понедельника', () => {
  assert.equal(
    GoalsCore.currentPeriodKey('week', new Date('2026-12-31T21:00:00.000Z')),
    '2026-12-28'
  );
  assert.equal(GoalsCore.shiftPeriodKey('week', '2026-12-28', 1), '2027-01-04');
});

test('месяц квартал год и жизнь получают стабильные ключи', () => {
  const now = new Date('2026-10-09T12:00:00.000Z');

  assert.equal(GoalsCore.currentPeriodKey('month', now), '2026-10');
  assert.equal(GoalsCore.currentPeriodKey('quarter', now), '2026-Q4');
  assert.equal(GoalsCore.currentPeriodKey('year', now), '2026');
  assert.equal(GoalsCore.currentPeriodKey('life', now), 'life');
  assert.equal(GoalsCore.shiftPeriodKey('month', '2026-12', 1), '2027-01');
  assert.equal(GoalsCore.shiftPeriodKey('quarter', '2026-Q4', 1), '2027-Q1');
  assert.equal(GoalsCore.shiftPeriodKey('year', '2026', -1), '2025');
  assert.equal(GoalsCore.shiftPeriodKey('life', 'life', 7), 'life');
});

test('пятилетние периоды привязаны к блоку 2026–2030', () => {
  assert.equal(
    GoalsCore.currentPeriodKey('5year', new Date('2025-06-01T00:00:00.000Z')),
    '2021'
  );
  assert.equal(
    GoalsCore.currentPeriodKey('5year', new Date('2026-06-01T00:00:00.000Z')),
    '2026'
  );
  assert.equal(
    GoalsCore.currentPeriodKey('5year', new Date('2031-06-01T00:00:00.000Z')),
    '2031'
  );
  assert.equal(GoalsCore.shiftPeriodKey('5year', '2026', -1), '2021');
  assert.equal(GoalsCore.shiftPeriodKey('5year', '2026', 1), '2031');
});

test('подписи периодов понятны пользователю', () => {
  assert.equal(GoalsCore.formatPeriodLabel('week', '2026-10-05'), '5–11 октября 2026');
  assert.equal(GoalsCore.formatPeriodLabel('month', '2026-10'), 'Октябрь 2026');
  assert.equal(GoalsCore.formatPeriodLabel('quarter', '2026-Q4'), '4 квартал 2026');
  assert.equal(GoalsCore.formatPeriodLabel('year', '2026'), '2026 год');
  assert.equal(GoalsCore.formatPeriodLabel('5year', '2026'), '2026–2030');
  assert.equal(GoalsCore.formatPeriodLabel('life', 'life'), 'Вся жизнь');
});

test('старые цели мигрируют в текущий период с p3 без потери полей', () => {
  const input = {
    goals: [
      {
        id: 'month-a',
        title: 'Сохранить прогресс',
        horizon: 'month',
        type: 'number',
        target: 100,
        current: 47,
        unit: '%',
        done: false,
        legacyNote: 'не терять'
      },
      {
        id: 'month-b',
        title: 'Вторая цель',
        horizon: 'month',
        type: 'check',
        done: true
      },
      {
        id: 'life-a',
        title: 'Большая цель',
        horizon: 'life',
        type: 'check',
        done: false
      }
    ]
  };
  const snapshot = structuredClone(input);
  const migrated = GoalsCore.normalizeData(input, new Date('2026-10-09T12:00:00.000Z'));

  assert.deepEqual(input, snapshot, 'входной объект не мутируется');
  assert.equal(migrated.schemaVersion, 3);
  assert.deepEqual(migrated.goals[0], {
    ...input.goals[0],
    periodKey: '2026-10',
    priority: 'p3',
    order: 100
  });
  assert.deepEqual(migrated.goals[1], {
    ...input.goals[1],
    periodKey: '2026-10',
    priority: 'p3',
    order: 200
  });
  assert.equal(migrated.goals[2].periodKey, 'life');
  assert.equal(migrated.goals[2].priority, 'p3');
  assert.equal(migrated.goals[2].order, 100);
});

test('нормализация идемпотентна и восстанавливает повреждённую группу', () => {
  const input = {
    schemaVersion: 3,
    goals: [
      {
        id: 'a', title: 'A', horizon: 'month', periodKey: 'не дата',
        priority: 'urgent', order: 100, done: false
      },
      {
        id: 'b', title: 'B', horizon: 'month', periodKey: '2026-10',
        priority: 'p3', order: 100, done: false
      },
      {
        id: 'c', title: 'C', horizon: 'month', periodKey: '2026-10',
        priority: 'p3', order: 100, done: false
      }
    ]
  };
  const now = new Date('2026-10-09T12:00:00.000Z');
  const once = GoalsCore.normalizeData(input, now);
  const twice = GoalsCore.normalizeData(once, now);

  assert.deepEqual(twice, once);
  assert.deepEqual(once.goals.map((goal) => [goal.periodKey, goal.priority, goal.order]), [
    ['2026-10', 'p3', 100],
    ['2026-10', 'p3', 200],
    ['2026-10', 'p3', 300]
  ]);
});

test('цели сортируются по завершённости приоритету и ручному порядку', () => {
  const goals = [
    { id: 'done', done: true, priority: 'p1', order: 10 },
    { id: 'p4', done: false, priority: 'p4', order: 10 },
    { id: 'p1-late', done: false, priority: 'p1', order: 200 },
    { id: 'p1-first', done: false, priority: 'p1', order: 100 },
    { id: 'p2', done: false, priority: 'p2', order: 100 }
  ];

  assert.deepEqual(
    GoalsCore.sortGoals(goals).map((goal) => goal.id),
    ['p1-first', 'p1-late', 'p2', 'p4', 'done']
  );
  assert.deepEqual(goals.map((goal) => goal.id), ['done', 'p4', 'p1-late', 'p1-first', 'p2']);
});

test('активная цель переносится в другой период и в конец новой группы', () => {
  const data = {
    schemaVersion: 3,
    goals: [
      { id: 'moving', horizon: 'month', periodKey: '2026-10', priority: 'p1', order: 100, done: false },
      { id: 'source', horizon: 'month', periodKey: '2026-10', priority: 'p1', order: 200, done: false },
      { id: 'target', horizon: 'month', periodKey: '2026-11', priority: 'p2', order: 100, done: false }
    ]
  };

  const result = GoalsCore.moveGoal(data, {
    goalId: 'moving',
    targetPeriodKey: '2026-11',
    targetPriority: 'p2'
  });

  assert.equal(result.ok, true);
  assert.deepEqual(data.goals.map((goal) => [goal.id, goal.periodKey, goal.priority, goal.order]), [
    ['moving', '2026-10', 'p1', 100],
    ['source', '2026-10', 'p1', 200],
    ['target', '2026-11', 'p2', 100]
  ], 'исходные данные не мутируются');
  assert.deepEqual(result.data.goals.map((goal) => [goal.id, goal.periodKey, goal.priority, goal.order]), [
    ['moving', '2026-11', 'p2', 200],
    ['source', '2026-10', 'p1', 100],
    ['target', '2026-11', 'p2', 100]
  ]);
});

test('цель вставляется перед указанной целью только в целевой группе', () => {
  const data = {
    schemaVersion: 3,
    goals: [
      { id: 'a', horizon: 'week', periodKey: '2026-10-05', priority: 'p1', order: 100, done: false },
      { id: 'b', horizon: 'week', periodKey: '2026-10-05', priority: 'p1', order: 200, done: false },
      { id: 'untouched', horizon: 'week', periodKey: '2026-10-05', priority: 'p2', order: 777, done: false }
    ]
  };
  const result = GoalsCore.moveGoal(data, {
    goalId: 'b',
    targetPeriodKey: '2026-10-05',
    targetPriority: 'p1',
    beforeGoalId: 'a'
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.data.goals.map((goal) => [goal.id, goal.order]), [
    ['a', 200],
    ['b', 100],
    ['untouched', 777]
  ]);
});

test('выполненная цель остаётся в историческом периоде', () => {
  const data = {
    schemaVersion: 3,
    goals: [
      { id: 'done', horizon: 'year', periodKey: '2026', priority: 'p1', order: 100, done: true }
    ]
  };

  assert.deepEqual(GoalsCore.moveGoal(data, {
    goalId: 'done',
    targetPeriodKey: '2027'
  }), {
    ok: false,
    error: 'GOAL_COMPLETED'
  });
  assert.equal(GoalsCore.moveGoal(data, {
    goalId: 'missing',
    targetPeriodKey: '2027'
  }).error, 'GOAL_NOT_FOUND');
  assert.equal(GoalsCore.moveGoal(data, {
    goalId: 'done',
    targetPeriodKey: '2026-12'
  }).error, 'GOAL_COMPLETED');
});
