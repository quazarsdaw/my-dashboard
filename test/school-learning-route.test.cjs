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

function configWithUrls(urls) {
  const base = loadConfig().SchoolLearningConfig;
  const copy = JSON.parse(JSON.stringify(base));
  Object.entries(urls).forEach(([cabinetId, url]) => {
    copy.cabinets[cabinetId].url = url;
  });
  return copy;
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

test('subject prototype keys use the global fallback', () => {
  const config = loadConfig().SchoolLearningConfig;

  ['toString', 'constructor', '__proto__'].forEach((subject) => {
    const route = SchoolLearningRoute.resolveLessonRoute({ subject }, config);

    assert.equal(route.cabinetId, 'self-study', subject);
    assert.equal(route.teacherId, 'self-study', subject);
    assert.equal(route.format, 'Самостоятельная практика', subject);
    assert.equal(route.canOpenCabinet, false, subject);
  });
});

test('known overrides replace fields independently and keep permanent resource supplementary', () => {
  const config = configWithUrls({
    'chatgpt-software': 'https://chatgpt.com/g/software'
  });
  const route = SchoolLearningRoute.resolveLessonRoute({
    subject: 'Software Engineering',
    routeOverride: {
      cabinetId: null,
      teacherId: 'chatgpt-deep',
      format: 'Сократовская диагностика',
      resourceUrl: 'https://developer.mozilla.org/en-US/docs/Web/HTTP'
    }
  }, config);

  assert.equal(route.cabinetId, 'chatgpt-software');
  assert.equal(route.teacherId, 'chatgpt-deep');
  assert.equal(route.format, 'Сократовская диагностика');
  assert.equal(route.cabinetUrl, 'https://chatgpt.com/g/software');
  assert.equal(
    route.resourceUrl,
    'https://developer.mozilla.org/en-US/docs/Web/HTTP'
  );
  assert.equal(route.usesDefaultCabinet, true);
  assert.equal(route.usesDefaultTeacher, false);
  assert.equal(route.canOpenCabinet, true);
});

test('temporary cabinets accept only their approved resource hosts', () => {
  const config = loadConfig().SchoolLearningConfig;
  const cases = [
    ['kimi-temporary', 'https://kimi.com/chat/123', true],
    ['kimi-temporary', 'https://example.com/chat/123', false],
    ['youtube', 'https://youtu.be/abc', true],
    ['youtube', 'https://www.youtube.com/watch?v=abc', true],
    ['youtube', 'https://example.com/watch/abc', false],
    ['book-pdf', 'https://example.com/book.pdf', true],
    ['documentation', 'https://docs.example.com/guide', true],
    ['documentation', 'http://docs.example.com/guide', false]
  ];

  cases.forEach(([cabinetId, resourceUrl, canOpen]) => {
    const route = SchoolLearningRoute.resolveLessonRoute({
      subject: 'Software Engineering',
      routeOverride: {
        cabinetId,
        teacherId: cabinetId === 'kimi-temporary'
          ? 'kimi-k3'
          : 'material-author',
        format: cabinetId === 'youtube'
          ? 'Видео + retrieval'
          : 'Чтение + retrieval',
        resourceUrl
      }
    }, config);
    assert.equal(route.canOpenCabinet, canOpen, `${cabinetId} ${resourceUrl}`);
  });
});

test('route url normalization rejects unsafe schemes credentials length and host suffixes', () => {
  const invalid = [
    'javascript:alert(1)',
    'file:///tmp/lesson.pdf',
    'data:text/plain,lesson',
    'https://user:password@youtube.com/watch?v=abc',
    `https://example.com/${'a'.repeat(2049)}`
  ];
  invalid.forEach((url) => {
    assert.equal(
      SchoolLearningRoute.normalizeRouteUrl(url),
      null,
      url.slice(0, 80)
    );
  });
  assert.equal(
    SchoolLearningRoute.normalizeRouteUrl(
      'https://youtube.com.attacker.example/watch?v=abc',
      ['youtube.com', 'www.youtube.com', 'youtu.be']
    ),
    null
  );
});

test('invalid or missing route urls block opening without exposing the raw url', () => {
  const config = configWithUrls({
    'chatgpt-software': 'https://chatgpt.com/g/software'
  });
  const invalidSupplement = SchoolLearningRoute.resolveLessonRoute({
    subject: 'Software Engineering',
    routeOverride: {
      cabinetId: null,
      teacherId: null,
      format: null,
      resourceUrl: 'javascript:alert(1)'
    }
  }, config);
  assert.equal(invalidSupplement.resourceUrl, null);
  assert.equal(invalidSupplement.canOpenCabinet, false);
  assert.equal(
    invalidSupplement.warnings.some((item) => item.code === 'invalid-resource'),
    true
  );
  assert.equal(
    invalidSupplement.warnings.some((item) => item.message.includes('javascript:')),
    false
  );

  const missingTemporary = SchoolLearningRoute.resolveLessonRoute({
    subject: 'Software Engineering',
    routeOverride: {
      cabinetId: 'youtube',
      teacherId: 'material-author',
      format: 'Видео + retrieval',
      resourceUrl: null
    }
  }, config);
  assert.equal(missingTemporary.canOpenCabinet, false);
  assert.equal(
    missingTemporary.warnings.some((item) => item.code === 'missing-resource'),
    true
  );
});

test('empty permanent cabinet url keeps prompt route readable but not openable', () => {
  const config = loadConfig().SchoolLearningConfig;
  const route = SchoolLearningRoute.resolveLessonRoute({
    subject: 'Software Engineering'
  }, config);
  assert.equal(route.cabinetUrl, null);
  assert.equal(route.canOpenCabinet, false);
  assert.equal(
    route.warnings.some((item) => item.code === 'missing-cabinet-url'),
    true
  );
});

test('unknown explicit override is never replaced by a default route', () => {
  const config = configWithUrls({
    'chatgpt-software': 'https://chatgpt.com/g/software'
  });
  const cases = [
    [{ cabinetId: 'missing-cabinet' }, 'unknown-cabinet'],
    [{ teacherId: 'missing-teacher' }, 'unknown-teacher'],
    [{ format: 'Неизвестный формат' }, 'unknown-format']
  ];

  cases.forEach(([override, warningCode]) => {
    const route = SchoolLearningRoute.resolveLessonRoute({
      subject: 'Software Engineering',
      routeOverride: {
        cabinetId: null,
        teacherId: null,
        format: null,
        resourceUrl: null,
        ...override
      }
    }, config);
    assert.equal(route.canOpenCabinet, false, warningCode);
    assert.equal(
      route.warnings.some((warning) => warning.code === warningCode),
      true,
      warningCode
    );
  });
});

test('unknown route values remain visible for correction', () => {
  const config = configWithUrls({
    'chatgpt-software': 'https://chatgpt.com/g/software'
  });
  const route = SchoolLearningRoute.resolveLessonRoute({
    subject: 'Software Engineering',
    routeOverride: {
      cabinetId: 'missing-cabinet',
      teacherId: 'missing-teacher',
      format: 'Неизвестный формат',
      resourceUrl: null
    }
  }, config);

  assert.equal(route.cabinetId, 'missing-cabinet');
  assert.equal(route.cabinetLabel, 'missing-cabinet');
  assert.equal(route.platform, 'Unknown');
  assert.equal(route.cabinetKind, 'unknown');
  assert.equal(route.cabinetUrl, null);
  assert.equal(route.teacherId, 'missing-teacher');
  assert.equal(route.teacherLabel, 'missing-teacher');
  assert.equal(route.format, 'Неизвестный формат');
});

test('prototype cabinet and teacher overrides stay unknown and cannot open', () => {
  const config = configWithUrls({
    'chatgpt-software': 'https://chatgpt.com/g/software'
  });
  const cases = [];
  ['toString', 'constructor', '__proto__'].forEach((value) => {
    cases.push(['cabinetId', value, 'unknown-cabinet']);
    cases.push(['teacherId', value, 'unknown-teacher']);
  });

  cases.forEach(([field, value, warningCode]) => {
    const route = SchoolLearningRoute.resolveLessonRoute({
      subject: 'Software Engineering',
      routeOverride: {
        cabinetId: null,
        teacherId: null,
        format: null,
        resourceUrl: null,
        [field]: value
      }
    }, config);

    assert.equal(route[field], value, `${field} ${value}`);
    assert.equal(route.canOpenCabinet, false, `${field} ${value}`);
    assert.equal(
      route.warnings.some((item) => item.code === warningCode),
      true,
      `${field} ${value}`
    );
  });
});

test('external study route gets the subject ChatGPT reviewer', () => {
  const config = configWithUrls({
    'chatgpt-english': 'https://chatgpt.com/g/english'
  });
  const route = SchoolLearningRoute.resolveLessonRoute({
    subject: 'English & IELTS',
    routeOverride: {
      cabinetId: 'youtube',
      teacherId: 'material-author',
      format: 'Видео + retrieval',
      resourceUrl: 'https://youtu.be/abc'
    }
  }, config);

  assert.deepEqual(route.reviewer, {
    cabinetId: 'chatgpt-english',
    cabinetLabel: 'ChatGPT · English & IELTS',
    teacherId: 'chatgpt-main',
    teacherLabel: 'ChatGPT · основной преподаватель',
    modelHint: 'выберите основную модель вручную',
    url: 'https://chatgpt.com/g/english'
  });
  assert.deepEqual(SchoolLearningRoute.compactRouteLabels(route), {
    desktop: 'YouTube · автор материала',
    mobile: 'YouTube'
  });
});

test('external routes warn when the subject reviewer url is missing', () => {
  const config = loadConfig().SchoolLearningConfig;
  const cases = [
    ['youtube', 'Видео + retrieval', 'https://youtu.be/abc'],
    ['book-pdf', 'Чтение + retrieval', 'https://example.com/book.pdf'],
    ['documentation', 'Чтение + retrieval', 'https://docs.example.com/guide']
  ];

  cases.forEach(([cabinetId, format, resourceUrl]) => {
    const route = SchoolLearningRoute.resolveLessonRoute({
      subject: 'Software Engineering',
      routeOverride: {
        cabinetId,
        teacherId: 'material-author',
        format,
        resourceUrl
      }
    }, config);

    assert.equal(route.reviewer.cabinetId, 'chatgpt-software', cabinetId);
    assert.equal(route.reviewer.teacherId, 'chatgpt-main', cabinetId);
    assert.equal(route.reviewer.url, null, cabinetId);
    assert.equal(
      route.warnings.some((item) => item.code === 'missing-reviewer-url'),
      true,
      cabinetId
    );
  });
});

test('external routes reject an invalid reviewer url without exposing it', () => {
  const invalidUrl = 'https://chatgpt.com.attacker.example/reviewer';
  const config = configWithUrls({ 'chatgpt-software': invalidUrl });
  const cases = [
    ['youtube', 'Видео + retrieval', 'https://youtu.be/abc'],
    ['book-pdf', 'Чтение + retrieval', 'https://example.com/book.pdf'],
    ['documentation', 'Чтение + retrieval', 'https://docs.example.com/guide']
  ];

  cases.forEach(([cabinetId, format, resourceUrl]) => {
    const route = SchoolLearningRoute.resolveLessonRoute({
      subject: 'Software Engineering',
      routeOverride: {
        cabinetId,
        teacherId: 'material-author',
        format,
        resourceUrl
      }
    }, config);

    assert.equal(route.reviewer.cabinetId, 'chatgpt-software', cabinetId);
    assert.equal(route.reviewer.teacherId, 'chatgpt-main', cabinetId);
    assert.equal(route.reviewer.url, null, cabinetId);
    assert.equal(
      route.warnings.some((item) => item.code === 'invalid-reviewer-url'),
      true,
      cabinetId
    );
    assert.equal(
      route.warnings.some((item) => item.message.includes(invalidUrl)),
      false,
      cabinetId
    );
  });
});

test('external routes accept a valid reviewer url without reviewer warnings', () => {
  const config = configWithUrls({
    'chatgpt-software': 'https://chatgpt.com/g/software'
  });
  const cases = [
    ['youtube', 'Видео + retrieval', 'https://youtu.be/abc'],
    ['book-pdf', 'Чтение + retrieval', 'https://example.com/book.pdf'],
    ['documentation', 'Чтение + retrieval', 'https://docs.example.com/guide']
  ];

  cases.forEach(([cabinetId, format, resourceUrl]) => {
    const route = SchoolLearningRoute.resolveLessonRoute({
      subject: 'Software Engineering',
      routeOverride: {
        cabinetId,
        teacherId: 'material-author',
        format,
        resourceUrl
      }
    }, config);

    assert.equal(
      route.reviewer.url,
      'https://chatgpt.com/g/software',
      cabinetId
    );
    assert.equal(
      route.warnings.some((item) => (
        item.code === 'missing-reviewer-url' ||
        item.code === 'invalid-reviewer-url'
      )),
      false,
      cabinetId
    );
  });
});

test('regular ChatGPT route has no second reviewer', () => {
  const config = loadConfig().SchoolLearningConfig;
  const route = SchoolLearningRoute.resolveLessonRoute(
    { subject: 'University' },
    config
  );
  assert.equal(route.reviewer, null);
  assert.deepEqual(SchoolLearningRoute.compactRouteLabels(route), {
    desktop: 'ChatGPT · основной',
    mobile: 'ChatGPT'
  });
});

test('compact labels cover every supported platform and unknown cabinet', () => {
  const cases = [
    ['Codex', 'Codex · coding agent', 'Codex'],
    ['Kimi', 'Kimi · K3', 'Kimi'],
    ['Book', 'Книга · автор материала', 'Книга'],
    ['Documentation', 'Документация · автор материала', 'Документация'],
    ['Terminal', 'Терминал · самостоятельная работа', 'Терминал'],
    ['None', 'Самостоятельная практика', 'Самостоятельно'],
    ['Unknown', 'Неизвестный кабинет', 'Неизвестно']
  ];
  cases.forEach(([platform, desktop, mobile]) => {
    assert.deepEqual(
      SchoolLearningRoute.compactRouteLabels({
        platform,
        teacherLabel: platform === 'Codex'
          ? 'Codex · coding agent'
          : platform === 'Kimi'
            ? 'Kimi K3'
            : 'Автор материала'
      }),
      { desktop, mobile },
      platform
    );
  });
});
