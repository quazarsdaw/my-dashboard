const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

function loadConfig() {
  const source = fs.readFileSync(
    path.join(__dirname, '..', 'school-teacher-config.js'),
    'utf8'
  );
  const context = { window: {} };
  vm.runInNewContext(source, context);
  return context.window;
}

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

function loadRouteModule() {
  try {
    return require('../school-learning-route.js');
  } catch (error) {
    if (error && error.code === 'MODULE_NOT_FOUND') return {};
    throw error;
  }
}

const SchoolLearningRoute = loadRouteModule();

test('learning config is the single frozen source for cabinets and defaults', () => {
  const window = loadConfig();
  const config = window.SchoolLearningConfig;

  assert.equal(window.SchoolTeacherConfig, undefined);
  assert.deepEqual(
    Object.keys(config.defaultsBySubject),
    [
      'Software Engineering',
      'DevOps & Infrastructure',
      'Mathematics',
      'English & IELTS',
      'University',
      'Director & Assessment'
    ]
  );
  assert.deepEqual(plain(config.defaultsBySubject['Software Engineering']), {
    cabinetId: 'chatgpt-software',
    teacherId: 'chatgpt-main',
    format: 'Сократовский урок'
  });
  assert.deepEqual(plain(config.defaultsBySubject.Mathematics), {
    cabinetId: 'chatgpt-mathematics',
    teacherId: 'chatgpt-deep',
    format: 'Сократовский урок'
  });
  assert.deepEqual(plain(config.globalFallback), {
    cabinetId: 'self-study',
    teacherId: 'self-study',
    format: 'Самостоятельная практика'
  });
  assert.deepEqual(
    Object.keys(config.cabinets),
    [
      'chatgpt-software',
      'chatgpt-devops',
      'chatgpt-mathematics',
      'chatgpt-english',
      'chatgpt-university',
      'chatgpt-director',
      'codex-main',
      'cursor-main',
      'terminal-local',
      'kimi-temporary',
      'youtube',
      'book-pdf',
      'documentation',
      'self-study'
    ]
  );
  assert.deepEqual(plain(
    Object.values(config.cabinets)
      .filter((cabinet) => cabinet.kind === 'permanent')
      .map((cabinet) => cabinet.url)),
    ['', '', '', '', '', '', '', '', '']
  );
  assert.deepEqual(plain(config.lessonFormats), [
    'Сократовский урок',
    'Сократовская диагностика',
    'Практическая лаборатория',
    'Диалоговый урок',
    'Разбор материала',
    'Большой контекст',
    'Видео + retrieval',
    'Чтение + retrieval',
    'Самостоятельная практика',
    'Недельная ревизия'
  ]);
  assert.equal(Object.isFrozen(config), true);
  assert.equal(Object.isFrozen(config.cabinets), true);
  assert.equal(Object.isFrozen(config.teachers), true);
  assert.equal(Object.isFrozen(config.defaultsBySubject), true);
  assert.equal(
    Object.values(config.cabinets).every(Object.isFrozen),
    true
  );
});

test('route resolves subject defaults without lesson overrides', () => {
  const config = loadConfig().SchoolLearningConfig;
  assert.equal(
    typeof SchoolLearningRoute.resolveLessonRoute,
    'function'
  );
  const route = SchoolLearningRoute.resolveLessonRoute(
    { id: 'lesson-1', subject: 'Mathematics' },
    config
  );

  assert.equal(route.cabinetId, 'chatgpt-mathematics');
  assert.equal(route.teacherId, 'chatgpt-deep');
  assert.equal(route.format, 'Сократовский урок');
  assert.equal(route.usesDefaultCabinet, true);
  assert.equal(route.usesDefaultTeacher, true);
  assert.equal(
    route.warnings.some((warning) => warning.code.startsWith('unknown-')),
    false
  );
});

test('route uses self-study fallback for an unknown subject', () => {
  const config = loadConfig().SchoolLearningConfig;
  const route = SchoolLearningRoute.resolveLessonRoute(
    { id: 'lesson-2', subject: 'New subject' },
    config
  );

  assert.equal(route.cabinetId, 'self-study');
  assert.equal(route.teacherId, 'self-study');
  assert.equal(route.format, 'Самостоятельная практика');
  assert.equal(route.cabinetUrl, null);
  assert.equal(route.canOpenCabinet, false);
});
