const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

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

test('school layout keeps mobile targets accessible and document overflow contained', () => {
  const css = read('school.css');

  assert.ok(css.includes('grid-template-columns: repeat(7, minmax(0, 1fr))'));
  assert.ok(css.includes('.school-time-line.is-half'));
  assert.ok(css.includes('@media (max-width: 620px)'));
  assert.ok(css.includes('min-height: 44px'));
  assert.ok(css.includes('overflow-x: hidden'));
  assert.ok(css.includes('.school-mobile-days'));
  assert.ok(css.includes('.school-drawer'));
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

test('controller calls only the two read-only school api methods', () => {
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
      startLesson() {
        throw new Error('write method must never be called');
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

test('school source is read-only and does not install drag or optimistic behavior', () => {
  const source = read('school.js');

  assert.ok(source.includes('.listLessons('));
  assert.ok(source.includes('.getLessonContent('));
  assert.ok(!source.includes('.startLesson('));
  assert.ok(!source.includes('.moveLesson('));
  assert.ok(!source.includes('.completeLesson('));
  assert.ok(!source.includes("addEventListener('drag"));
  assert.ok(!source.includes("addEventListener('drop"));
  assert.ok(!source.includes('optimistic'));
  assert.ok(!source.includes('.innerHTML'));
});
