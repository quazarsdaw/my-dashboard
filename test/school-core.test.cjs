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

test('preserves only known mapper warnings and exposes them as runtime issues', () => {
  const warned = SchoolCore.normalizeLesson(lesson({
    id: 'warned',
    warnings: [
      { code: 'duration-mismatch' },
      { code: 'invalid-duration' },
      { code: 'raw-notion-payload', token: 'must-not-survive' }
    ]
  }));

  assert.deepEqual(warned.warnings, [
    { code: 'duration-mismatch' },
    { code: 'invalid-duration' }
  ]);
  assert.deepEqual(
    SchoolCore.computeRuntimeIssues([warned], '2026-08-03T12:00:00+05:00', 'Asia/Yekaterinburg')
      .filter((issue) => ['duration-mismatch', 'invalid-duration'].includes(issue.code)),
    [
      { code: 'duration-mismatch', lessonId: 'warned' },
      { code: 'invalid-duration', lessonId: 'warned' }
    ]
  );
});

test('marks an invalid scheduled date without leaking the raw value', () => {
  const normalized = SchoolCore.normalizeLesson(lesson({
    id: 'invalid-date',
    schedule: { kind: 'date-only', date: '2026-02-31', start: null, end: null }
  }));

  assert.deepEqual(normalized.schedule, { kind: 'date-only', date: null, start: null, end: null });
  assert.deepEqual(normalized.warnings, [{ code: 'invalid-date' }]);
  assert.deepEqual(
    SchoolCore.computeRuntimeIssues([normalized], '2026-08-03T12:00:00+05:00', 'Asia/Yekaterinburg')
      .filter((issue) => issue.code === 'invalid-date'),
    [{ code: 'invalid-date', lessonId: 'invalid-date' }]
  );
});

test('orders dangerous runtime inconsistencies before overdue and soft schedule issues', () => {
  const issues = SchoolCore.computeRuntimeIssues([
    lesson({ id: 'active-a', status: 'В процессе', order: 100 }),
    lesson({ id: 'active-b', status: 'В процессе', order: 200 }),
    lesson({ id: 'bad-history', result: 'Зачёт', order: 300 }),
    lesson({
      id: 'bad-duration',
      order: 400,
      warnings: [{ code: 'duration-mismatch' }]
    }),
    lesson({
      id: 'overdue',
      order: 500,
      schedule: { kind: 'date-only', date: '2026-08-02', start: null, end: null }
    }),
    lesson({ id: 'duplicate-a', order: 600 }),
    lesson({ id: 'duplicate-b', order: 600 })
  ], '2026-08-04T12:00:00+05:00', 'Asia/Yekaterinburg');

  assert.deepEqual(issues.map((issue) => issue.code), [
    'multiple-active',
    'planned-with-assessment',
    'duration-mismatch',
    'overdue-planned',
    'overdue-planned',
    'overdue-planned',
    'overdue-planned',
    'overdue-planned',
    'duplicate-order'
  ]);
});

test('snaps drag positions to 15 minutes without coupling them to duration steps', () => {
  assert.equal(SchoolCore.ACTIVE_WEEK.start, '2026-08-03');
  assert.equal(SchoolCore.ACTIVE_WEEK.end, '2026-08-09');
  assert.equal(SchoolCore.DRAG_SNAP_MINUTES, 15);
  assert.equal(SchoolCore.DURATION_STEP_MINUTES, 5);
  assert.equal(SchoolCore.snapMinuteOfDay(607), 600);
  assert.equal(SchoolCore.snapMinuteOfDay(608), 615);
  assert.equal(SchoolCore.changeDurationBySteps(45, 1), 50);
  assert.equal(SchoolCore.changeDurationBySteps(60, -2), 50);
  assert.equal(SchoolCore.changeDurationBySteps(15, -1), 15);
  assert.equal(SchoolCore.changeDurationBySteps(180, 1), 180);
});

test('exposes the four approved timeline zoom levels', () => {
  assert.deepEqual(
    [0, 1, 2, 3].map(SchoolCore.timelineZoomLevel),
    [
      { index: 0, label: '×1 · шаг 15 минут', pixelsPerHour: 60, snapMinutes: 15 },
      { index: 1, label: '×1.5 · шаг 10 минут', pixelsPerHour: 90, snapMinutes: 10 },
      { index: 2, label: '×2 · шаг 5 минут', pixelsPerHour: 120, snapMinutes: 5 },
      { index: 3, label: '×3 · шаг 5 минут', pixelsPerHour: 180, snapMinutes: 5 }
    ]
  );
});

test('snaps timeline minutes with the active zoom precision', () => {
  assert.equal(SchoolCore.snapMinuteOfDay(14 * 60 + 7, 15), 14 * 60);
  assert.equal(SchoolCore.snapMinuteOfDay(14 * 60 + 7, 10), 14 * 60 + 10);
  assert.equal(SchoolCore.snapMinuteOfDay(14 * 60 + 7, 5), 14 * 60 + 5);
});

test('converts minutes and vertical coordinates without losing the anchor', () => {
  const y = SchoolCore.timelineYForMinute(14 * 60 + 5, 9 * 60, 120);
  assert.equal(y, 610);
  assert.equal(
    SchoolCore.timelineMinuteAtY(y, 9 * 60, 120, 5),
    14 * 60 + 5
  );
});

test('clamps wheel zoom to the supported range', () => {
  assert.equal(SchoolCore.nextTimelineZoomIndex(0, -1), 0);
  assert.equal(SchoolCore.nextTimelineZoomIndex(0, 1), 1);
  assert.equal(SchoolCore.nextTimelineZoomIndex(3, 1), 3);
});

test('normalizes continuous timeline scale and derives snap thresholds', () => {
  assert.equal(SchoolCore.normalizeTimelineScale('broken'), 1);
  assert.equal(SchoolCore.normalizeTimelineScale(0.4), 1);
  assert.equal(SchoolCore.normalizeTimelineScale(1.26), 1.3);
  assert.equal(SchoolCore.normalizeTimelineScale(4), 3);
  assert.equal(SchoolCore.timelinePixelsPerHour(1.345), 80.7);
  assert.equal(SchoolCore.timelineSnapMinutesForScale(1.2), 15);
  assert.equal(SchoolCore.timelineSnapMinutesForScale(1.3), 10);
  assert.equal(SchoolCore.timelineSnapMinutesForScale(1.7), 10);
  assert.equal(SchoolCore.timelineSnapMinutesForScale(1.8), 5);
  assert.equal(SchoolCore.timelineZoomLabel(1.4), '×1.4 · шаг 10 минут');
});

test('accumulates wheel direction and consumes at most two scale steps', () => {
  assert.equal(SchoolCore.accumulateTimelineWheel(40, -20), -20);
  assert.deepEqual(
    SchoolCore.consumeTimelineWheel(190),
    { steps: 2, remainder: 70 }
  );
  assert.deepEqual(
    SchoolCore.consumeTimelineWheel(-130),
    { steps: -2, remainder: -10 }
  );
});

test('selects landmark buttons and exposes bounded ease-out progress', () => {
  assert.equal(SchoolCore.nextTimelineLandmark(1, 1), 1.5);
  assert.equal(SchoolCore.nextTimelineLandmark(1.4, 1), 1.5);
  assert.equal(SchoolCore.nextTimelineLandmark(1.5, -1), 1);
  assert.equal(SchoolCore.nextTimelineLandmark(3, 1), 3);
  assert.equal(SchoolCore.easeOutTimelineZoom(0), 0);
  assert.equal(SchoolCore.easeOutTimelineZoom(1), 1);
  assert.ok(SchoolCore.easeOutTimelineZoom(0.5) > 0.5);
});

test('derives timed end from the saved duration and preserves date-only duration', () => {
  assert.deepEqual(
    SchoolCore.scheduleForDestination(
      { kind: 'timed', start: '2026-08-03T14:15:00+05:00' },
      60
    ),
    {
      kind: 'timed',
      date: '2026-08-03',
      start: '2026-08-03T14:15:00+05:00',
      end: '2026-08-03T15:15:00+05:00'
    }
  );
  assert.deepEqual(
    SchoolCore.scheduleForDestination(
      { kind: 'date-only', date: '2026-08-04' },
      60
    ),
    { kind: 'date-only', date: '2026-08-04', start: null, end: null }
  );
});

test('allocates sparse local day order and renumbers only one ordered collection', () => {
  assert.equal(SchoolCore.orderForDrop(null, 100), 50);
  assert.equal(SchoolCore.orderForDrop(100, 200), 150);
  assert.equal(SchoolCore.orderForDrop(300, null), 400);
  assert.deepEqual(
    SchoolCore.renumberLessonOrders([
      lesson({ id: 'third', order: 10 }),
      lesson({ id: 'first', order: -5 }),
      lesson({ id: 'second', order: 10 })
    ]),
    [
      { id: 'first', order: 100 },
      { id: 'second', order: 200 },
      { id: 'third', order: 300 }
    ]
  );
});

test('finds only strict timed overlaps and ignores boundary touch or canceled lessons', () => {
  const candidate = lesson({
    id: 'candidate',
    schedule: {
      kind: 'timed',
      date: '2026-08-03',
      start: '2026-08-03T14:00:00+05:00',
      end: '2026-08-03T14:45:00+05:00'
    }
  });
  const conflicts = SchoolCore.findTimeConflicts(candidate, [
    lesson({
      id: 'overlap',
      schedule: {
        kind: 'timed',
        date: '2026-08-03',
        start: '2026-08-03T14:30:00+05:00',
        end: '2026-08-03T15:15:00+05:00'
      }
    }),
    lesson({
      id: 'touch',
      schedule: {
        kind: 'timed',
        date: '2026-08-03',
        start: '2026-08-03T14:45:00+05:00',
        end: '2026-08-03T15:30:00+05:00'
      }
    }),
    lesson({
      id: 'canceled-overlap',
      status: 'Отменён',
      schedule: {
        kind: 'timed',
        date: '2026-08-03',
        start: '2026-08-03T14:15:00+05:00',
        end: '2026-08-03T15:00:00+05:00'
      }
    }),
    lesson({ id: 'date-only' })
  ]);

  assert.deepEqual(conflicts.map((item) => item.id), ['overlap']);
});

test('reports a soft break warning only when the positive gap is under five minutes', () => {
  const first = lesson({
    id: 'first',
    schedule: {
      kind: 'timed',
      date: '2026-08-03',
      start: '2026-08-03T14:00:00+05:00',
      end: '2026-08-03T14:45:00+05:00'
    }
  });
  const fourMinutes = lesson({
    id: 'four-minutes',
    schedule: {
      kind: 'timed',
      date: '2026-08-03',
      start: '2026-08-03T14:49:00+05:00',
      end: '2026-08-03T15:34:00+05:00'
    }
  });
  const fiveMinutes = lesson({
    id: 'five-minutes',
    schedule: {
      kind: 'timed',
      date: '2026-08-03',
      start: '2026-08-03T14:50:00+05:00',
      end: '2026-08-03T15:35:00+05:00'
    }
  });

  assert.deepEqual(
    SchoolCore.findShortBreaks([first, fourMinutes]).map((item) => item.gapMinutes),
    [4]
  );
  assert.deepEqual(SchoolCore.findShortBreaks([first, fiveMinutes]), []);
});

test('includes a short break as a derived runtime issue in the weekly read model', () => {
  const first = lesson({
    id: 'first',
    order: 100,
    schedule: {
      kind: 'timed',
      date: '2026-08-03',
      start: '2026-08-03T14:00:00+05:00',
      end: '2026-08-03T14:45:00+05:00'
    }
  });
  const next = lesson({
    id: 'next',
    order: 200,
    schedule: {
      kind: 'timed',
      date: '2026-08-03',
      start: '2026-08-03T14:49:00+05:00',
      end: '2026-08-03T15:34:00+05:00'
    }
  });

  const model = SchoolCore.buildReadModel([first, next], {
    now: '2026-08-03T10:00:00+05:00',
    timeZone: 'Asia/Yekaterinburg',
    activeWeek: 'W01'
  });

  assert.deepEqual(
    model.runtimeIssues.filter((issue) => issue.code === 'short-break'),
    [{
      code: 'short-break',
      gapMinutes: 4,
      lessonIds: ['first', 'next']
    }]
  );
});
