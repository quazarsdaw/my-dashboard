const assert = require('node:assert/strict');
const test = require('node:test');

const SchoolCore = require('../school-core.js');

function lesson(overrides = {}) {
  return {
    id: 'lesson-1',
    title: 'тестовый урок',
    subject: 'Software Engineering',
    module: 'W01',
    schedule: { kind: 'date-only', date: '2026-08-03', start: null, end: null },
    status: 'Запланирован',
    priority: 'Must',
    week: 'W01',
    result: null,
    autonomy: null,
    understanding: null,
    artifactUrl: null,
    comment: '',
    missedReason: null,
    moveCount: 0,
    durationMinutes: 45,
    order: 100,
    decisionRequest: null,
    ...overrides
  };
}

const weeklyLessons = [
  ...Array.from({ length: 9 }, (_, index) => lesson({ id: `se-${index}`, subject: 'Software Engineering', order: 100 + index })),
  ...Array.from({ length: 2 }, (_, index) => lesson({ id: `devops-${index}`, subject: 'DevOps & Infrastructure', order: 200 + index })),
  ...Array.from({ length: 3 }, (_, index) => lesson({ id: `english-${index}`, subject: 'English & IELTS', order: 300 + index })),
  ...Array.from({ length: 2 }, (_, index) => lesson({ id: `math-${index}`, subject: 'Mathematics', order: 400 + index })),
  lesson({ id: 'university', subject: 'University', order: 500 }),
  lesson({ id: 'director', subject: 'Director & Assessment', order: 600 })
];

test('counts all 18 weekly lessons by subject', () => {
  assert.deepEqual(SchoolCore.countSubjects(weeklyLessons), {
    'Software Engineering': 9,
    'DevOps & Infrastructure': 2,
    'English & IELTS': 3,
    Mathematics: 2,
    University: 1,
    'Director & Assessment': 1
  });
});

test('counts completed, partial and missed lessons while excluding canceled lessons', () => {
  assert.deepEqual(
    SchoolCore.computeWeeklyProgress([
      lesson({ status: 'Выполнен' }),
      lesson({ status: 'Частично выполнен' }),
      lesson({ status: 'Пропущен' }),
      lesson({ status: 'Отменён' })
    ]),
    { completed: 1, total: 3, partial: 1, missed: 1 }
  );
});

test('places the active lesson first in today even when its time is later', () => {
  const model = SchoolCore.buildReadModel([
    lesson({ id: 'early', schedule: { kind: 'timed', date: '2026-08-03', start: '2026-08-03T09:00:00+05:00', end: '2026-08-03T09:45:00+05:00' } }),
    lesson({ id: 'active', status: 'В процессе', schedule: { kind: 'timed', date: '2026-08-03', start: '2026-08-03T15:00:00+05:00', end: '2026-08-03T15:45:00+05:00' } })
  ], { now: '2026-08-03T10:00:00+05:00', timeZone: 'Asia/Yekaterinburg', activeWeek: 'W01' });

  assert.deepEqual(model.today.map((item) => item.id), ['active', 'early']);
});

test('keeps finalized non-canceled lessons in the diary', () => {
  assert.deepEqual(
    SchoolCore.selectDiaryLessons([
      lesson({ id: 'done', status: 'Выполнен' }),
      lesson({ id: 'partial', status: 'Частично выполнен' }),
      lesson({ id: 'missed', status: 'Пропущен' }),
      lesson({ id: 'canceled', status: 'Отменён' })
    ]).map((item) => item.id),
    ['done', 'partial', 'missed']
  );
});

test('marks a date-only planned lesson overdue only after its Yekaterinburg day ends', () => {
  const dateOnly = lesson({ schedule: { kind: 'date-only', date: '2026-08-03', start: null, end: null } });

  assert.equal(
    SchoolCore.computeRuntimeIssues([dateOnly], '2026-08-03T23:59:59+05:00', 'Asia/Yekaterinburg')
      .some((issue) => issue.code === 'overdue-planned'),
    false
  );
  assert.equal(
    SchoolCore.computeRuntimeIssues([dateOnly], '2026-08-04T00:00:00+05:00', 'Asia/Yekaterinburg')
      .some((issue) => issue.code === 'overdue-planned'),
    true
  );
});

test('excludes canceled lessons from next selection, conflicts, progress and decision queue', () => {
  const canceled = lesson({
    id: 'canceled',
    status: 'Отменён',
    decisionRequest: 'Перенос между неделями',
    schedule: { kind: 'timed', date: '2026-08-03', start: '2026-08-03T09:00:00+05:00', end: '2026-08-03T10:00:00+05:00' }
  });
  const planned = lesson({
    id: 'planned',
    order: 200,
    schedule: { kind: 'timed', date: '2026-08-03', start: '2026-08-03T09:30:00+05:00', end: '2026-08-03T10:15:00+05:00' }
  });
  const model = SchoolCore.buildReadModel([canceled, planned], {
    now: '2026-08-03T08:00:00+05:00', timeZone: 'Asia/Yekaterinburg', activeWeek: 'W01'
  });

  assert.equal(SchoolCore.selectNextLesson([canceled, planned], '2026-08-03T08:00:00+05:00', 'Asia/Yekaterinburg').id, 'planned');
  assert.deepEqual(model.progress, { completed: 0, total: 1, partial: 0, missed: 0 });
  assert.deepEqual(model.persistedDecisions, []);
  assert.equal(model.runtimeIssues.some((issue) => issue.code === 'overlap'), false);
});

test('skips a timed lesson that started before now when selecting the next lesson', () => {
  const past = lesson({
    id: 'past',
    schedule: { kind: 'timed', date: '2026-08-03', start: '2026-08-03T09:00:00+05:00', end: '2026-08-03T09:45:00+05:00' }
  });
  const future = lesson({
    id: 'future',
    order: 200,
    schedule: { kind: 'timed', date: '2026-08-03', start: '2026-08-03T15:00:00+05:00', end: '2026-08-03T15:45:00+05:00' }
  });

  assert.equal(
    SchoolCore.selectNextLesson([past, future], '2026-08-03T12:00:00+05:00', 'Asia/Yekaterinburg').id,
    'future'
  );
});

test('returns persisted requests separately from derived runtime issues', () => {
  const model = SchoolCore.buildReadModel([
    lesson({ id: 'request', decisionRequest: 'Перенос между неделями' }),
    lesson({ id: 'bad-data', order: 200, result: 'Зачёт' })
  ], { now: '2026-08-03T12:00:00+05:00', timeZone: 'Asia/Yekaterinburg', activeWeek: 'W01' });

  assert.deepEqual(model.persistedDecisions.map((item) => item.id), ['request']);
  assert.deepEqual(model.runtimeIssues.map((item) => item.code), ['planned-with-assessment']);
});

test('reports duplicate order within one scheduled day', () => {
  const issues = SchoolCore.computeRuntimeIssues([
    lesson({ id: 'first', order: 100 }),
    lesson({ id: 'second', order: 100 })
  ], '2026-08-03T12:00:00+05:00', 'Asia/Yekaterinburg');

  assert.deepEqual(issues.filter((item) => item.code === 'duplicate-order').map((item) => item.lessonIds), [['first', 'second']]);
});

test('reports planned lessons that already contain assessment data', () => {
  assert.deepEqual(
    SchoolCore.computeRuntimeIssues([lesson({ id: 'assessed', result: 'Зачёт', autonomy: 'A2', understanding: 3 })], '2026-08-03T12:00:00+05:00', 'Asia/Yekaterinburg')
      .map((item) => item.code),
    ['planned-with-assessment']
  );
});

test('reports several active lessons as one global runtime issue', () => {
  const issues = SchoolCore.computeRuntimeIssues([
    lesson({ id: 'first-active', status: 'В процессе' }),
    lesson({ id: 'second-active', status: 'В процессе' })
  ], '2026-08-03T12:00:00+05:00', 'Asia/Yekaterinburg');

  assert.deepEqual(issues.filter((item) => item.code === 'multiple-active'), [{ code: 'multiple-active', lessonIds: ['first-active', 'second-active'] }]);
});

test('normalizes a lesson without reading ambient browser or clock state', () => {
  assert.deepEqual(SchoolCore.normalizeLesson({ id: ' raw ', title: ' урок ', durationMinutes: 10, schedule: { kind: 'date-only', date: '2026-08-03' } }), {
    id: 'raw', title: 'урок', subject: '', module: '', schedule: { kind: 'date-only', date: '2026-08-03', start: null, end: null },
    status: 'Нераспределён', priority: 'Could', week: '', result: null, autonomy: null, understanding: null,
    artifactUrl: null, comment: '', missedReason: null, moveCount: 0, durationMinutes: 45, order: 0,
    decisionRequest: null, hasLearningEvidence: false, isFinalized: false, warnings: []
  });
});
