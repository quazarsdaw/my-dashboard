const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const SchoolCore = require('../school-core.js');
const SchoolMutationQueue = require('../school-mutation-queue.js');
const SchoolUi = require('../school.js');

function read(file) {
  return fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
}

function fakeDocument() {
  function node(tagName) {
    return {
      tagName: tagName.toUpperCase(),
      attributes: {},
      children: [],
      className: '',
      textContent: '',
      appendChild(child) {
        this.children.push(child);
        return child;
      },
      setAttribute(name, value) {
        this.attributes[name] = String(value);
      }
    };
  }
  return { createElement: node };
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function queueLesson(id, time) {
  const start = `2026-08-03T${time}:00+05:00`;
  return {
    id,
    status: 'Запланирован',
    durationMinutes: 45,
    schedule: SchoolCore.scheduleForDestination({ kind: 'timed', start }, 45)
  };
}

function moveCommand(id, time) {
  return {
    operation: 'moveLesson',
    lessonId: id,
    destination: {
      kind: 'timed',
      start: `2026-08-03T${time}:00+05:00`
    },
    order: id === 'a' ? 100 : 200
  };
}

function moveReducer(command) {
  return (lessons) => lessons.map((lesson) => {
    if (lesson.id !== command.lessonId) return lesson;
    const start = command.destination.start;
    return {
      ...lesson,
      schedule: {
        kind: 'timed',
        date: '2026-08-03',
        start,
        end: SchoolCore.scheduleForDestination(
          { kind: 'timed', start },
          lesson.durationMinutes
        ).end
      }
    };
  });
}

function createQueueController({ mutate }) {
  let serverLessons = [queueLesson('a', '09:00'), queueLesson('b', '09:30')];
  return SchoolUi.createController({
    api: {
      async listLessons() {
        return structuredClone(serverLessons);
      },
      async mutate(command) {
        const result = await mutate(command);
        serverLessons = moveReducer(command)(serverLessons);
        return result;
      }
    },
    core: {
      buildReadModel(lessons) {
        return {
          lessons,
          today: [],
          weekDays: {},
          diary: [],
          progress: { completed: 0, total: lessons.length, partial: 0, missed: 0 },
          activeLessons: [],
          nextLesson: null,
          persistedDecisions: [],
          runtimeIssues: []
        };
      }
    },
    mutationQueue: SchoolMutationQueue,
    document: null
  });
}

function interactiveDocument() {
  const listeners = new Map();
  const nodes = new Map();
  let document;

  function node(tagName, id = '') {
    const value = {
      tagName: tagName.toUpperCase(),
      id,
      attributes: {},
      children: [],
      className: '',
      hidden: false,
      inert: false,
      style: {},
      textContent: '',
      appendChild(child) {
        this.children.push(child);
        return child;
      },
      removeChild(child) {
        this.children.splice(this.children.indexOf(child), 1);
      },
      get firstChild() {
        return this.children[0] || null;
      },
      setAttribute(name, valueToSet) {
        this.attributes[name] = String(valueToSet);
      },
      getAttribute(name) {
        return this.attributes[name];
      },
      removeAttribute(name) {
        delete this.attributes[name];
      },
      addEventListener() {},
      querySelectorAll() {
        return id === 'schoolLessonDialog' ? [nodes.get('schoolLessonClose')] : [];
      },
      focus() {
        document.activeElement = this;
        this.focusCount = (this.focusCount || 0) + 1;
      }
    };
    value.classList = {
      add(name) {
        const values = new Set(value.className.split(/\s+/).filter(Boolean));
        values.add(name);
        value.className = [...values].join(' ');
      },
      remove(name) {
        value.className = value.className.split(/\s+/).filter((entry) => entry && entry !== name).join(' ');
      },
      contains(name) {
        return value.className.split(/\s+/).includes(name);
      },
      toggle(name, force) {
        if (force === undefined ? !this.contains(name) : force) this.add(name);
        else this.remove(name);
      }
    };
    if (id) nodes.set(id, value);
    return value;
  }

  document = {
    activeElement: null,
    body: node('body', 'body'),
    createElement(tagName) {
      return node(tagName);
    },
    getElementById(id) {
      return nodes.get(id) || null;
    },
    querySelectorAll() {
      return [];
    },
    addEventListener(type, handler) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type).add(handler);
    },
    removeEventListener(type, handler) {
      if (listeners.has(type)) listeners.get(type).delete(handler);
    },
    listenerCount(type) {
      return listeners.has(type) ? listeners.get(type).size : 0;
    },
    dispatchKey(key, options = {}) {
      const event = {
        key,
        shiftKey: Boolean(options.shiftKey),
        prevented: false,
        preventDefault() {
          this.prevented = true;
        }
      };
      [...(listeners.get('keydown') || [])].forEach((handler) => handler(event));
      return event;
    }
  };

  [
    ['main', 'schoolApp'],
    ['div', 'schoolLessonDialog'],
    ['button', 'schoolLessonClose'],
    ['h2', 'schoolLessonTitle'],
    ['p', 'schoolLessonSubject'],
    ['div', 'schoolLessonMeta'],
    ['div', 'schoolContentState'],
    ['article', 'schoolLessonContent']
  ].forEach(([tagName, id]) => node(tagName, id));
  nodes.get('schoolLessonDialog').hidden = true;
  return { document, nodes };
}

test('school page loads shared dashboard dependencies before read-only school scripts', () => {
  const html = read('school.html');
  const scripts = [
    'profile-theme.js?v=401',
    'topbar.js?v=402',
    'supabase-sync.js?v=406-sb',
    'school-core.js',
    'school-api.js',
    'school.js'
  ];

  assert.ok(html.includes('<body data-page="school">'));
  scripts.forEach((script) => assert.ok(html.includes(script), script));
  scripts.slice(1).forEach((script, index) => {
    assert.ok(html.indexOf(scripts[index]) < html.indexOf(script), `${scripts[index]} before ${script}`);
  });
});

test('school shell exposes the three approved views and accessible lesson dialog', () => {
  const html = read('school.html');
  const source = read('school.js');

  ['today', 'week', 'diary'].forEach((view) => {
    assert.ok(html.includes(`data-school-view="${view}"`), view);
    assert.ok(html.includes(`data-school-panel="${view}"`), view);
  });
  assert.ok(html.includes('id="schoolLessonDialog"'));
  assert.ok(html.includes('role="dialog"'));
  assert.ok(html.includes('aria-modal="true"'));
  assert.ok(html.includes('aria-labelledby="schoolLessonTitle"'));
  assert.ok(html.includes('Выполнено 0 из 0'));
  assert.ok(source.includes("'Выполнено ' + progress.completed + ' из ' + progress.total"));
});

test('school week exposes accessible timeline zoom controls', () => {
  const html = read('school.html');
  assert.ok(html.includes('id="schoolZoomOut"'));
  assert.ok(html.includes('aria-label="Уменьшить масштаб времени"'));
  assert.ok(html.includes('id="schoolZoomLabel"'));
  assert.ok(html.includes('id="schoolZoomIn"'));
  assert.ok(html.includes('aria-label="Увеличить масштаб времени"'));
});

test('loads mutation queue before the school controller', () => {
  const html = read('school.html');
  assert.ok(html.includes('school-mutation-queue.js'));
  assert.ok(html.includes('school.js'));
  assert.ok(
    html.indexOf('school-mutation-queue.js') < html.indexOf('school.js'),
    'queue must load before the controller'
  );
});

test('timeline destination uses the active zoom step', () => {
  assert.deepEqual(
    SchoolUi.timelineDestination(
      SchoolCore,
      '2026-08-03',
      130,
      { top: 10 },
      { startHour: 9 },
      { pixelsPerHour: 120, snapMinutes: 5 }
    ),
    { kind: 'timed', start: '2026-08-03T10:00:00+05:00' }
  );
});

test('school styles distinguish quarter ten and five minute lines', () => {
  const css = read('school.css');
  assert.ok(css.includes('.school-time-line.is-quarter'));
  assert.ok(css.includes('.school-time-line.is-ten'));
  assert.ok(css.includes('.school-time-line.is-five'));
  assert.ok(css.includes('.school-zoom-controls'));
});

test('school layout keeps mobile targets accessible and document overflow contained', () => {
  const css = read('school.css');

  assert.ok(css.includes('grid-template-columns: repeat(7, minmax(0, 1fr))'));
  assert.ok(css.includes('.school-time-line.is-half'));
  assert.ok(css.includes('@media (max-width: 620px)'));
  assert.ok(css.includes('min-height: 44px'));
  assert.ok(css.includes('overflow-x: hidden'));
  assert.ok(css.includes('.school-mobile-days'));
  assert.ok(css.includes('.school-drawer'));
  assert.match(css, /\.school-time-card\s*\{[^}]*min-height:\s*44px/s);
});

test('shared navigation places school between tracker and menu in eight columns', () => {
  const topbar = read('topbar.js');
  const tracker = topbar.indexOf('data-page="tracker"');
  const school = topbar.indexOf('data-page="school"');
  const menu = topbar.indexOf('data-page="menu"');

  assert.ok(topbar.includes('grid-template-columns: repeat(8, minmax(0, 1fr))'));
  assert.ok(tracker !== -1 && school > tracker && menu > school);
  assert.ok(topbar.includes("if (p.indexOf('school') !== -1) return 'school';"));
});

test('controller loads and opens lesson content without mutating before user action', () => {
  const calls = [];
  const controller = SchoolUi.createController({
    api: {
      async listLessons(filter) {
        calls.push(['listLessons', filter]);
        return [];
      },
      async getLessonContent(id) {
        calls.push(['getLessonContent', id]);
        return { lesson: { id }, blocks: [] };
      },
      mutate() {
        throw new Error('mutation requires explicit user action');
      }
    },
    core: {
      buildReadModel() {
        return {
          today: [],
          weekDays: {},
          diary: [],
          progress: { completed: 0, total: 0, partial: 0, missed: 0 },
          activeLessons: [],
          nextLesson: null,
          persistedDecisions: [],
          runtimeIssues: []
        };
      }
    },
    document: null,
    now: () => new Date('2026-08-03T10:00:00+05:00')
  });

  return controller.load().then(async () => {
    await controller.openLesson('lesson-1');
    assert.deepEqual(calls, [
      ['listLessons', { week: 'W01 · 3–9 августа 2026' }],
      ['getLessonContent', 'lesson-1']
    ]);
  });
});

test('controller rolls back optimistic lessons when mutation fails', async () => {
  const initial = [{ id: 'lesson-1', status: 'Запланирован' }];
  const rendered = [];
  const controller = SchoolUi.createController({
    api: {
      async listLessons() {
        return initial;
      },
      async mutate() {
        const error = new Error('conflict');
        error.code = 'LESSON_TIME_CONFLICT';
        error.status = 409;
        throw error;
      }
    },
    core: {
      buildReadModel(lessons) {
        rendered.push(lessons.map((lesson) => lesson.status));
        return {
          lessons,
          today: [],
          weekDays: {},
          diary: [],
          progress: { completed: 0, total: 1, partial: 0, missed: 0 },
          activeLessons: [],
          nextLesson: null,
          persistedDecisions: [],
          runtimeIssues: []
        };
      }
    },
    document: null
  });
  await controller.load();

  await assert.rejects(
    controller.runMutation(
      { operation: 'startLesson', lessonId: 'lesson-1' },
      (lessons) => lessons.map((lesson) => ({ ...lesson, status: 'В процессе' }))
    ),
    (error) => error.code === 'LESSON_TIME_CONFLICT'
  );
  await controller.whenMutationsIdle();

  assert.deepEqual(rendered[0], ['Запланирован']);
  assert.ok(rendered.some((statuses) => statuses[0] === 'В процессе'));
  assert.deepEqual(rendered.at(-1), ['Запланирован']);
  assert.deepEqual(controller.getLessons(), initial);
});

test('successful mutation revalidates from notion and rechecks active lessons', async () => {
  const calls = [];
  const lists = [
    [{ id: 'lesson-1', status: 'Запланирован' }],
    [{ id: 'lesson-1', status: 'В процессе' }]
  ];
  const controller = SchoolUi.createController({
    api: {
      async listLessons() {
        calls.push('list');
        return lists.shift();
      },
      async mutate(command) {
        calls.push(command.operation);
        return { id: 'lesson-1', status: 'В процессе' };
      }
    },
    core: {
      buildReadModel(lessons) {
        return {
          today: [],
          weekDays: {},
          diary: [],
          progress: { completed: 0, total: 1, partial: 0, missed: 0 },
          activeLessons: lessons.filter((lesson) => lesson.status === 'В процессе'),
          nextLesson: null,
          persistedDecisions: [],
          runtimeIssues: []
        };
      }
    },
    document: null
  });
  await controller.load();
  await controller.runMutation(
    { operation: 'startLesson', lessonId: 'lesson-1' },
    (lessons) => lessons.map((lesson) => ({ ...lesson, status: 'В процессе' }))
  );

  assert.deepEqual(calls, ['list', 'startLesson', 'list']);
  assert.deepEqual(controller.getReadModel().activeLessons.map((lesson) => lesson.id), ['lesson-1']);
});

test('controller keeps a second optimistic drop while the first mutation is pending', async () => {
  const first = deferred();
  const calls = [];
  const controller = createQueueController({
    mutate(command) {
      calls.push(command.lessonId);
      return command.lessonId === 'a' ? first.promise : Promise.resolve({ id: 'b' });
    }
  });

  await controller.load();
  const a = controller.runMutation(moveCommand('a', '10:00'), moveReducer(moveCommand('a', '10:00')));
  const b = controller.runMutation(moveCommand('b', '11:00'), moveReducer(moveCommand('b', '11:00')));
  assert.deepEqual(
    controller.getLessons().map((lesson) => lesson.schedule.start.slice(11, 16)),
    ['10:00', '11:00']
  );
  first.resolve({ id: 'a' });
  await Promise.all([a, b]);
  await controller.whenMutationsIdle();
  assert.deepEqual(calls, ['a', 'b']);
});

test('failed queued mutation removes only its optimistic layer', async () => {
  const controller = createQueueController({
    mutate(command) {
      return command.lessonId === 'a'
        ? Promise.reject(new Error('failed a'))
        : Promise.resolve({ id: 'b' });
    }
  });

  await controller.load();
  const commandA = moveCommand('a', '10:00');
  const commandB = moveCommand('b', '11:00');
  const a = controller.runMutation(commandA, moveReducer(commandA));
  const b = controller.runMutation(commandB, moveReducer(commandB));
  await assert.rejects(a, /failed a/);
  await b;
  await controller.whenMutationsIdle();
  assert.equal(
    controller.getLessons().find((lesson) => lesson.id === 'a').schedule.start.slice(11, 16),
    '09:00'
  );
  assert.equal(
    controller.getLessons().find((lesson) => lesson.id === 'b').schedule.start.slice(11, 16),
    '11:00'
  );
});

test('drop transition matrix blocks finalized cards and requires explicit status commands', () => {
  const timed = {
    kind: 'timed',
    start: '2026-08-04T14:15:00+05:00'
  };

  assert.deepEqual(
    SchoolUi.commandForDrop({
      id: 'planned',
      status: 'Запланирован',
      schedule: { kind: 'date-only', date: '2026-08-03' }
    }, timed, 150),
    {
      kind: 'command',
      command: {
        operation: 'moveLesson',
        lessonId: 'planned',
        destination: timed,
        order: 150
      }
    }
  );
  assert.equal(
    SchoolUi.commandForDrop({
      id: 'active',
      status: 'В процессе',
      schedule: { kind: 'date-only', date: '2026-08-03' }
    }, timed, 150).kind,
    'pause-confirm'
  );
  assert.equal(
    SchoolUi.commandForDrop({
      id: 'missed',
      status: 'Пропущен',
      schedule: { kind: 'date-only', date: '2026-08-03' }
    }, timed, 150).kind,
    'restore-confirm'
  );
  ['Выполнен', 'Частично выполнен', 'Отменён'].forEach((status) => {
    assert.equal(
      SchoolUi.commandForDrop({
        id: status,
        status,
        schedule: { kind: 'date-only', date: '2026-08-03' }
      }, timed, 150).kind,
      'blocked'
    );
    assert.equal(SchoolUi.isLessonDraggable({ status }), false);
  });
  assert.equal(SchoolUi.isLessonDraggable({ status: 'Пропущен' }), true);
});

test('overlap choices retry only with an explicit command change', () => {
  const command = {
    operation: 'moveLesson',
    lessonId: 'lesson-1',
    destination: {
      kind: 'timed',
      start: '2026-08-03T14:00:00+05:00'
    },
    order: 100
  };
  const error = {
    code: 'LESSON_TIME_CONFLICT',
    details: {
      conflicts: [{
        end: '2026-08-03T15:15:00+05:00'
      }]
    }
  };

  assert.deepEqual(
    SchoolUi.commandAfterOverlapChoice(command, error, 'allow'),
    { ...command, allowOverlap: true }
  );
  assert.deepEqual(
    SchoolUi.commandAfterOverlapChoice(command, error, 'after'),
    {
      ...command,
      destination: {
        kind: 'timed',
        start: '2026-08-03T15:15:00+05:00'
      }
    }
  );
  assert.equal(
    SchoolUi.commandAfterOverlapChoice(command, error, 'change'),
    null
  );
});

test('content renderer creates text nodes and keeps unsafe links inert', () => {
  const document = fakeDocument();
  const root = document.createElement('div');

  SchoolUi.renderContentBlocks(root, [
    {
      type: 'paragraph',
      spans: [{
        text: '<img src=x onerror=alert(1)>',
        link: 'javascript:alert(1)',
        annotations: { bold: false, italic: false, underline: false, strikethrough: false, code: false }
      }],
      children: []
    },
    {
      type: 'bookmark',
      label: 'официальный материал',
      url: 'https://example.com/lesson',
      caption: [],
      children: []
    }
  ], document);

  assert.equal(root.children[0].children[0].textContent, '<img src=x onerror=alert(1)>');
  assert.equal(root.children[0].children[0].attributes.href, undefined);
  assert.equal(root.children[1].attributes.href, 'https://example.com/lesson');
  assert.equal(root.children[1].attributes.rel, 'noopener noreferrer');
});

test('content renderer groups consecutive list items and gives toggles a summary', () => {
  const document = fakeDocument();
  const root = document.createElement('div');

  SchoolUi.renderContentBlocks(root, [
    { type: 'numbered_list_item', spans: [{ text: 'первый', annotations: {} }], children: [] },
    { type: 'numbered_list_item', spans: [{ text: 'второй', annotations: {} }], children: [] },
    { type: 'bulleted_list_item', spans: [{ text: 'маркер', annotations: {} }], children: [] },
    {
      type: 'toggle',
      spans: [{ text: 'подробнее', annotations: {} }],
      children: [{ type: 'paragraph', spans: [{ text: 'ответ', annotations: {} }], children: [] }]
    },
    { type: 'constructor', label: 'prototype lookup must not select a tag' }
  ], document);

  assert.equal(root.children[0].tagName, 'OL');
  assert.equal(root.children[0].children.length, 2);
  assert.equal(root.children[1].tagName, 'UL');
  assert.equal(root.children[1].children.length, 1);
  assert.equal(root.children[2].tagName, 'DETAILS');
  assert.equal(root.children[2].children[0].tagName, 'SUMMARY');
  assert.equal(root.children[2].children[1].className, 'school-content-children');
  assert.equal(root.children[3].className, 'school-content-unsupported');
});

test('today focus is the sole active lesson or the computed next lesson', () => {
  const active = { id: 'active' };
  const completed = { id: 'completed', status: 'Выполнен' };
  const next = { id: 'next' };

  assert.equal(SchoolUi.selectTodayFocus({
    activeLessons: [active],
    today: [completed],
    nextLesson: next
  }), active);
  assert.equal(SchoolUi.selectTodayFocus({
    activeLessons: [],
    today: [completed],
    nextLesson: next
  }), next);
  assert.equal(SchoolUi.selectTodayFocus({
    activeLessons: [{ id: 'a' }, { id: 'b' }],
    today: [completed],
    nextLesson: next
  }), null);
});

test('diary groups rows by planned date and keeps missed reason instead of an empty result', () => {
  const groups = SchoolUi.groupDiaryLessons([
    {
      id: 'missed',
      status: 'Пропущен',
      result: null,
      missedReason: 'Низкая энергия',
      order: 100,
      schedule: { date: '2026-08-03' }
    },
    {
      id: 'done',
      status: 'Выполнен',
      result: 'Зачёт',
      missedReason: null,
      order: 200,
      schedule: { date: '2026-08-04' }
    },
    {
      id: 'canceled',
      status: 'Отменён',
      result: 'Зачёт',
      order: 300,
      schedule: { date: '2026-08-04' }
    }
  ]);

  assert.deepEqual(groups.map((group) => [group.date, group.lessons.map((lesson) => lesson.id)]), [
    ['2026-08-04', ['done']],
    ['2026-08-03', ['missed']]
  ]);
  assert.equal(SchoolUi.diaryResult(groups[1].lessons[0]), 'Пропущен · Низкая энергия');
  const missedModel = SchoolCore.buildReadModel([{
    id: 'missed-with-stale-assessment',
    title: 'пропущенный урок',
    subject: 'Software Engineering',
    schedule: { kind: 'date-only', date: '2026-08-03' },
    status: 'Пропущен',
    priority: 'Must',
    week: 'W01',
    autonomy: 'A3',
    understanding: 3,
    durationMinutes: 45,
    order: 100
  }], {
    now: '2026-08-04T12:00:00+05:00',
    timeZone: 'Asia/Yekaterinburg',
    activeWeek: 'W01'
  });
  assert.deepEqual(
    missedModel.runtimeIssues.filter((issue) => issue.code === 'missed-with-assessment'),
    [{ code: 'missed-with-assessment', lessonId: 'missed-with-stale-assessment' }]
  );
  assert.deepEqual(SchoolUi.diaryScores(missedModel.diary[0]), { autonomy: '', understanding: '' });
  assert.deepEqual(SchoolUi.diaryScores({
    status: 'Выполнен',
    autonomy: 'A2',
    understanding: 2
  }), { autonomy: 'A2', understanding: '2/3' });
});

test('week time bounds expand to actual lessons and overlapping lessons receive stable lanes', () => {
  const lessons = [
    {
      id: 'early',
      schedule: {
        kind: 'timed',
        start: '2026-08-03T07:20:00+05:00',
        end: '2026-08-03T08:05:00+05:00'
      }
    },
    {
      id: 'overlap-a',
      schedule: {
        kind: 'timed',
        start: '2026-08-03T14:00:00+05:00',
        end: '2026-08-03T15:00:00+05:00'
      }
    },
    {
      id: 'overlap-b',
      schedule: {
        kind: 'timed',
        start: '2026-08-03T14:30:00+05:00',
        end: '2026-08-03T15:15:00+05:00'
      }
    },
    {
      id: 'late',
      schedule: {
        kind: 'timed',
        start: '2026-08-03T21:20:00+05:00',
        end: '2026-08-03T22:10:00+05:00'
      }
    }
  ];

  assert.deepEqual(SchoolUi.getWeekTimeBounds(lessons), {
    startHour: 7,
    endHour: 23,
    height: 960
  });
  assert.deepEqual(
    SchoolUi.layoutTimedLessons(lessons).map((item) => [item.lesson.id, item.lane, item.laneCount]),
    [
      ['early', 0, 1],
      ['overlap-a', 0, 2],
      ['overlap-b', 1, 2],
      ['late', 0, 1]
    ]
  );
});

test('same-start timed lessons sort by numeric order and stable id before duration', () => {
  const lessons = [
    {
      id: 'later-order',
      order: 300,
      schedule: {
        kind: 'timed',
        start: '2026-08-03T14:00:00+05:00',
        end: '2026-08-03T14:15:00+05:00'
      }
    },
    {
      id: 'z-stable',
      order: 100,
      schedule: {
        kind: 'timed',
        start: '2026-08-03T14:00:00+05:00',
        end: '2026-08-03T15:00:00+05:00'
      }
    },
    {
      id: 'a-stable',
      order: 100,
      schedule: {
        kind: 'timed',
        start: '2026-08-03T14:00:00+05:00',
        end: '2026-08-03T15:30:00+05:00'
      }
    }
  ];

  assert.deepEqual(
    SchoolUi.layoutTimedLessons(lessons).map((item) => item.lesson.id),
    ['a-stable', 'z-stable', 'later-order']
  );
});

test('adjacent short lessons use separate visual lanes without becoming an actual conflict', () => {
  const lessons = [
    {
      id: 'first',
      order: 100,
      schedule: {
        kind: 'timed',
        start: '2026-08-03T14:00:00+05:00',
        end: '2026-08-03T14:15:00+05:00'
      }
    },
    {
      id: 'second',
      order: 200,
      schedule: {
        kind: 'timed',
        start: '2026-08-03T14:15:00+05:00',
        end: '2026-08-03T14:30:00+05:00'
      }
    }
  ];

  assert.deepEqual(
    SchoolUi.layoutTimedLessons(lessons).map((item) => ({
      id: item.lesson.id,
      lane: item.lane,
      laneCount: item.laneCount,
      visualEnd: item.visualEnd
    })),
    [
      { id: 'first', lane: 0, laneCount: 2, visualEnd: 14 * 60 + 44 },
      { id: 'second', lane: 1, laneCount: 2, visualEnd: 14 * 60 + 15 + 44 }
    ]
  );

  const issues = SchoolCore.computeRuntimeIssues(
    lessons.map((entry) => ({
      ...entry,
      title: entry.id,
      subject: 'Software Engineering',
      status: 'Запланирован',
      priority: 'Must',
      week: 'W01',
      durationMinutes: 15,
      warnings: []
    })),
    '2026-08-03T10:00:00+05:00',
    'Asia/Yekaterinburg'
  );
  assert.equal(issues.some((issue) => issue.code === 'overlap'), false);
});

test('card signals and decision partitions preserve the approved priority', () => {
  assert.deepEqual(SchoolUi.lessonSignalLabels({
    id: 'active',
    status: 'В процессе',
    decisionRequest: 'Перенос между неделями',
    moveCount: 2,
    warnings: [{ code: 'duration-mismatch' }]
  }, true), [
    'Текущий урок',
    'Запрошен перенос в другую неделю',
    'переносился 2 раза',
    'Время окончания не совпадает с продолжительностью',
    'Конфликт времени'
  ]);
  assert.equal(SchoolUi.lessonSignalLabels({
    status: 'Запланирован',
    decisionRequest: null,
    moveCount: 1,
    warnings: []
  }, false).some((label) => label.includes('перенос')), false);

  const persisted = [{ id: 'request' }];
  const groups = SchoolUi.partitionDecisionItems({
    persistedDecisions: persisted,
    runtimeIssues: [
      { code: 'overdue-planned' },
      { code: 'multiple-active' },
      { code: 'duration-mismatch' },
      { code: 'overlap' }
    ]
  });
  assert.deepEqual(groups, {
    importantIssues: [{ code: 'multiple-active' }, { code: 'duration-mismatch' }],
    persisted,
    remainingIssues: [{ code: 'overdue-planned' }, { code: 'overlap' }]
  });
});

test('decision queue commands only clear persisted requests or resolve an explicit active lesson', () => {
  assert.deepEqual(SchoolUi.decisionQueueCommand(
    { id: 'requested', decisionRequest: 'Перенос между неделями' },
    true,
    'clear'
  ), {
    operation: 'clearDecisionRequest',
    lessonId: 'requested'
  });
  assert.deepEqual(SchoolUi.decisionQueueCommand(
    { code: 'multiple-active', lessonIds: ['active-a', 'active-b'] },
    false,
    'active-b'
  ), {
    operation: 'resolveActiveLessons',
    keepLessonId: 'active-b'
  });
  assert.equal(SchoolUi.decisionQueueCommand(
    { code: 'multiple-active', lessonIds: ['active-a', 'active-b'] },
    false,
    'unknown'
  ), null);
  assert.equal(SchoolUi.decisionQueueCommand(
    { code: 'overdue-planned', lessonId: 'late' },
    false,
    'clear'
  ), null);
});

test('opening lessons is generation guarded and installs one dialog key handler', async () => {
  const first = deferred();
  const second = deferred();
  const requests = { a: first, b: second };
  const { document, nodes } = interactiveDocument();
  const originalFocus = document.createElement('button');
  document.activeElement = originalFocus;
  const controller = SchoolUi.createController({
    api: {
      getLessonContent(id) {
        return requests[id].promise;
      }
    },
    core: {},
    document
  });

  const openA = controller.openLesson('a');
  const openB = controller.openLesson('b');
  assert.equal(document.listenerCount('keydown'), 1);

  second.resolve({
    lesson: { id: 'b' },
    blocks: [{ type: 'paragraph', spans: [{ text: 'content b', annotations: {} }], children: [] }]
  });
  await openB;
  assert.equal(nodes.get('schoolLessonContent').children[0].children[0].textContent, 'content b');

  first.resolve({
    lesson: { id: 'a' },
    blocks: [{ type: 'paragraph', spans: [{ text: 'stale a', annotations: {} }], children: [] }]
  });
  await openA;
  assert.equal(nodes.get('schoolLessonContent').children.length, 1);
  assert.equal(nodes.get('schoolLessonContent').children[0].children[0].textContent, 'content b');

  const escapeEvent = document.dispatchKey('Escape');
  assert.equal(escapeEvent.prevented, true);
  assert.equal(document.listenerCount('keydown'), 0);
  assert.equal(nodes.get('schoolLessonContent').children.length, 0);
  assert.equal(nodes.get('schoolApp').attributes['aria-hidden'], undefined);
  assert.equal(nodes.get('schoolApp').inert, false);
  assert.equal(originalFocus.focusCount, 1);
});

test('read-only controller normalizes loading and auth error states', async () => {
  for (const scenario of [
    { status: 401, expected: 'unauthenticated' },
    { status: 403, expected: 'forbidden' },
    { status: 503, expected: 'unavailable' }
  ]) {
    const states = [];
    const controller = SchoolUi.createController({
      api: {
        async listLessons() {
          const error = new Error('safe');
          error.status = scenario.status;
          throw error;
        }
      },
      core: {},
      document: null,
      onState(state) {
        states.push(state);
      }
    });

    await controller.load();
    assert.deepEqual(states, ['loading', scenario.expected]);
  }
});

test('school controller contains focus trap, escape close and restore behavior', () => {
  const source = read('school.js');

  assert.ok(source.includes("event.key === 'Escape'"));
  assert.ok(source.includes("event.key !== 'Tab'"));
  assert.ok(source.includes('previousFocus'));
  assert.ok(source.includes('previousFocus.focus()'));
  assert.ok(source.includes('aria-hidden'));
});

test('school source installs drag, touch-safe fallback and isolated optimistic queue behavior', () => {
  const source = read('school.js');
  const html = read('school.html');
  const css = read('school.css');

  assert.ok(source.includes('.listLessons('));
  assert.ok(source.includes('.getLessonContent('));
  assert.ok(source.includes('.mutate('));
  assert.ok(source.includes("addEventListener('dragstart"));
  assert.ok(source.includes("addEventListener('drop"));
  assert.ok(source.includes('Разрешить состояние'));
  assert.ok(source.includes('Оставить в W01'));
  assert.ok(source.includes("operation: 'resolveActiveLessons'"));
  assert.ok(source.includes('optimisticReducer'));
  assert.ok(source.includes('optimisticMutations'));
  assert.ok(source.includes('pendingLessonIds'));
  assert.ok(source.includes('whenMutationsIdle'));
  assert.ok(!css.includes('.school-page[data-mutation-pending="true"]'));
  assert.ok(html.includes('id="schoolActionDialog"'));
  assert.ok(html.includes('id="schoolScheduleControls"'));
  assert.ok(!source.includes('.innerHTML'));
});
