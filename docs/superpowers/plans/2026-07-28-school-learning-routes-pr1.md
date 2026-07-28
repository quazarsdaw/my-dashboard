# маршрутизация уроков по кабинетам — implementation plan pr 1

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** добавить frontend-конфигурацию учебных маршрутов, чистый resolver и
read-only отображение кабинета, преподавателя, формата и ресурса без изменения
Notion schema и без новых mutations.

**Architecture:** `school-teacher-config.js` становится единственным источником
постоянных кабинетов и subject defaults. Новый чистый
`school-learning-route.js` разрешает route, URL policy, reviewer и компактные
labels; `school.js` только оркестрирует resolver и рендерит его результат.
`school-teacher-bridge.js` получает уже разрешённый route и добавляет metadata в
стартовый prompt, не меняя `LESSON RESULT`.

**Tech Stack:** browser JavaScript в существующем UMD/IIFE стиле, Node.js
`node:test`, существующий DOM controller, статические HTML/CSS assets.

## глобальные ограничения

- ветка PR 1 — `agent/school-learning-routes-readonly`.
- base — `agent/school-teacher-bridge` из PR #52.
- никакой реализации PR 2 или PR 3 в этой ветке.
- не менять Notion schema, Supabase Edge Function, frontend API transport или
  реальные уроки.
- `routeOverride` в PR 1 существует только в pure fixtures; отсутствие поля у
  production lesson означает четыре `null`.
- постоянные URL хранятся только в `school-teacher-config.js`.
- URL в config являются публичными и не могут содержать credentials.
- неизвестный explicit cabinet, teacher или format не заменяется default:
  warning, `canOpenCabinet = false`, доступно только копирование prompt.
- глобальный fallback: `self-study` + `self-study` +
  `Самостоятельная практика`.
- постоянный `resourceUrl` является дополнительным материалом и не заменяет
  URL кабинета.
- Codex остаётся instruction-only; platform launch strategies и secure
  pre-open flow относятся к PR 3.
- существующий teacher bridge launch в PR 1 сохраняется только для
  разрешённого ChatGPT route.
- `LESSON RESULT` и parser не меняются.
- все новые browser values выводятся через `textContent`/text nodes, не через
  `innerHTML`.
- commit subjects и будущий PR body — на русском языке, в нижнем регистре,
  без co-authorship.
- PR остаётся Draft; merge запрещён.

## карта файлов

### создать

- `school-learning-route.js` — config validation, URL normalization, route
  resolution, reviewer и compact labels.
- `test/school-learning-route.test.cjs` — pure behavior tests resolver.

### изменить

- `school-teacher-config.js` — единый `window.SchoolLearningConfig`.
- `school-teacher-bridge.js` — route metadata в prompt.
- `school.js` — dependency injection resolver, card labels, read-only drawer и
  совместимость текущих teacher actions.
- `school.html` — script order, route drawer markup, cache versions.
- `school.css` — компактная route line и read-only route summary.
- `test/school-teacher-bridge.test.cjs` — prompt contract.
- `test/school-ui.test.cjs` — controller/card/drawer integration.
- `README.md` — обновление постоянных ссылок в одном config.

---

### task 1: единая конфигурация и базовый subject resolver

**Files:**

- Create: `school-learning-route.js`
- Create: `test/school-learning-route.test.cjs`
- Modify: `school-teacher-config.js`
- Modify: `school.html:17-23`

**Interfaces:**

- Consumes: normalized lesson с `subject` и необязательным `routeOverride`.
- Produces:
  - `window.SchoolLearningConfig`;
  - `SchoolLearningRoute.resolveLessonRoute(lesson, config)`;
  - CommonJS export `require('../school-learning-route.js')`.

- [ ] **step 1: написать failing test единственного config source**

Добавить в `test/school-learning-route.test.cjs` загрузку browser config через
`vm` и literal assertions:

```javascript
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
  assert.deepEqual(config.defaultsBySubject['Software Engineering'], {
    cabinetId: 'chatgpt-software',
    teacherId: 'chatgpt-main',
    format: 'Сократовский урок'
  });
  assert.deepEqual(config.defaultsBySubject.Mathematics, {
    cabinetId: 'chatgpt-mathematics',
    teacherId: 'chatgpt-deep',
    format: 'Сократовский урок'
  });
  assert.deepEqual(config.globalFallback, {
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
  assert.deepEqual(
    Object.values(config.cabinets)
      .filter((cabinet) => cabinet.kind === 'permanent')
      .map((cabinet) => cabinet.url),
    ['', '', '', '', '', '', '', '', '']
  );
  assert.deepEqual(config.lessonFormats, [
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
```

Этот test ловит возврат второго config source, потерю subject key и
поверхностную заморозку nested descriptors.

- [ ] **step 2: запустить test и подтвердить RED**

Run:

```bash
node --test test/school-learning-route.test.cjs
```

Expected: FAIL, потому что `SchoolLearningConfig` и
его nested records ещё отсутствуют; failure не должен быть синтаксической
ошибкой test fixture.

- [ ] **step 3: заменить config точной frozen-моделью**

В `school-teacher-config.js` оставить IIFE и создать один config:

```javascript
(function (root) {
  'use strict';

  function freezeRecord(value) {
    Object.keys(value).forEach(function (key) {
      if (value[key] && typeof value[key] === 'object') {
        Object.freeze(value[key]);
      }
    });
    return Object.freeze(value);
  }

  var cabinets = freezeRecord({
    'chatgpt-software': { label: 'ChatGPT · Software Engineering', platform: 'ChatGPT', kind: 'permanent', url: '' },
    'chatgpt-devops': { label: 'ChatGPT · DevOps', platform: 'ChatGPT', kind: 'permanent', url: '' },
    'chatgpt-mathematics': { label: 'ChatGPT · Mathematics', platform: 'ChatGPT', kind: 'permanent', url: '' },
    'chatgpt-english': { label: 'ChatGPT · English & IELTS', platform: 'ChatGPT', kind: 'permanent', url: '' },
    'chatgpt-university': { label: 'ChatGPT · University', platform: 'ChatGPT', kind: 'permanent', url: '' },
    'chatgpt-director': { label: 'ChatGPT · Director', platform: 'ChatGPT', kind: 'permanent', url: '' },
    'codex-main': { label: 'Codex', platform: 'Codex', kind: 'permanent', url: '' },
    'cursor-main': { label: 'Cursor', platform: 'Cursor', kind: 'permanent', url: '' },
    'terminal-local': { label: 'Терминал', platform: 'Terminal', kind: 'permanent', url: '' },
    'kimi-temporary': { label: 'Kimi · временный чат', platform: 'Kimi', kind: 'temporary', url: '' },
    youtube: { label: 'YouTube', platform: 'YouTube', kind: 'temporary', url: '' },
    'book-pdf': { label: 'Книга или PDF', platform: 'Book', kind: 'temporary', url: '' },
    documentation: { label: 'Документация', platform: 'Documentation', kind: 'temporary', url: '' },
    'self-study': { label: 'Самостоятельная практика', platform: 'None', kind: 'temporary', url: '' }
  });

  var teachers = freezeRecord({
    'chatgpt-main': { label: 'ChatGPT · основной преподаватель', platform: 'ChatGPT', modelHint: 'выберите основную модель вручную' },
    'chatgpt-deep': { label: 'ChatGPT · глубокое рассуждение', platform: 'ChatGPT', modelHint: 'выберите сильную reasoning-модель вручную' },
    'chatgpt-fast': { label: 'ChatGPT · быстрый преподаватель', platform: 'ChatGPT', modelHint: 'выберите быструю модель вручную' },
    'codex-main': { label: 'Codex · coding agent', platform: 'Codex', modelHint: 'выберите coding-модель вручную' },
    'kimi-k3': { label: 'Kimi K3', platform: 'Kimi', modelHint: 'выберите Kimi K3 вручную' },
    'material-author': { label: 'Автор материала', platform: 'External', modelHint: '' },
    'self-study': { label: 'Самостоятельная работа', platform: 'None', modelHint: '' }
  });

  var defaultsBySubject = freezeRecord({
    'Software Engineering': {
      cabinetId: 'chatgpt-software',
      teacherId: 'chatgpt-main',
      format: 'Сократовский урок'
    },
    'DevOps & Infrastructure': {
      cabinetId: 'chatgpt-devops',
      teacherId: 'chatgpt-main',
      format: 'Практическая лаборатория'
    },
    Mathematics: {
      cabinetId: 'chatgpt-mathematics',
      teacherId: 'chatgpt-deep',
      format: 'Сократовский урок'
    },
    'English & IELTS': {
      cabinetId: 'chatgpt-english',
      teacherId: 'chatgpt-main',
      format: 'Диалоговый урок'
    },
    University: {
      cabinetId: 'chatgpt-university',
      teacherId: 'chatgpt-main',
      format: 'Разбор материала'
    },
    'Director & Assessment': {
      cabinetId: 'chatgpt-director',
      teacherId: 'chatgpt-deep',
      format: 'Недельная ревизия'
    }
  });

  var globalFallback = Object.freeze({
    cabinetId: 'self-study',
    teacherId: 'self-study',
    format: 'Самостоятельная практика'
  });

  var lessonFormats = Object.freeze([
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

  root.SchoolLearningConfig = Object.freeze({
    cabinets: cabinets,
    teachers: teachers,
    defaultsBySubject: defaultsBySubject,
    globalFallback: globalFallback,
    lessonFormats: lessonFormats
  });
})(typeof window !== 'undefined' ? window : globalThis);
```

Итоговый config не экспортирует `SchoolTeacherConfig`.

- [ ] **step 4: написать failing test default и fallback resolution**

```javascript
function loadRouteModule() {
  try {
    return require('../school-learning-route.js');
  } catch (error) {
    if (error && error.code === 'MODULE_NOT_FOUND') return {};
    throw error;
  }
}

const SchoolLearningRoute = loadRouteModule();

test('route resolves subject defaults without lesson overrides', () => {
  const config = loadConfig().SchoolLearningConfig;
  const route = SchoolLearningRoute.resolveLessonRoute(
    { id: 'lesson-1', subject: 'Mathematics' },
    config
  );

  assert.equal(route.cabinetId, 'chatgpt-mathematics');
  assert.equal(route.teacherId, 'chatgpt-deep');
  assert.equal(route.format, 'Сократовский урок');
  assert.equal(route.usesDefaultCabinet, true);
  assert.equal(route.usesDefaultTeacher, true);
  assert.deepEqual(route.warnings, []);
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
```

- [ ] **step 5: запустить test и подтвердить RED resolver**

Run:

```bash
node --test test/school-learning-route.test.cjs
```

Expected: config test PASS, resolver tests FAIL с
`actual: 'undefined', expected: 'function'` после отдельного assertion:

```javascript
assert.equal(
  typeof SchoolLearningRoute.resolveLessonRoute,
  'function'
);
```

Этот assertion поставить в начале первого resolver test до вызова функции.

- [ ] **step 6: реализовать минимальный UMD resolver**

`school-learning-route.js` должен экспортировать один и тот же frozen API в
browser и CommonJS:

```javascript
(function (root, factory) {
  'use strict';
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.SchoolLearningRoute = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  function text(value) {
    return typeof value === 'string' ? value.trim() : '';
  }

  function overrideValue(override, key) {
    return override && text(override[key]) ? text(override[key]) : null;
  }

  function resolveLessonRoute(lesson, config) {
    var item = lesson && typeof lesson === 'object' ? lesson : {};
    var source = config && typeof config === 'object' ? config : {};
    var defaults = source.defaultsBySubject &&
      source.defaultsBySubject[text(item.subject)] ||
      source.globalFallback;
    var override = item.routeOverride || {};
    var cabinetId = overrideValue(override, 'cabinetId') || defaults.cabinetId;
    var teacherId = overrideValue(override, 'teacherId') || defaults.teacherId;
    var format = overrideValue(override, 'format') || defaults.format;
    var cabinet = source.cabinets[cabinetId];
    var teacher = source.teachers[teacherId];

    return Object.freeze({
      cabinetId: cabinetId,
      cabinetLabel: cabinet.label,
      platform: cabinet.platform,
      cabinetKind: cabinet.kind,
      cabinetUrl: null,
      teacherId: teacherId,
      teacherLabel: teacher.label,
      modelHint: text(teacher.modelHint) || null,
      format: format,
      resourceUrl: null,
      usesDefaultCabinet: !overrideValue(override, 'cabinetId'),
      usesDefaultTeacher: !overrideValue(override, 'teacherId'),
      canOpenCabinet: false,
      warnings: Object.freeze([]),
      reviewer: null
    });
  }

  return Object.freeze({
    resolveLessonRoute: resolveLessonRoute
  });
});
```

На этом шаге не добавлять advanced validation: следующий task начнётся с
отдельных failing tests.

- [ ] **step 7: подключить module в HTML и проверить GREEN**

В `school.html` подключить `school-learning-route.js?v=1` после
`school-teacher-config.js?v=2` и до `school-teacher-bridge.js`; остальные
cache versions пока не менять.

Run:

```bash
node --test test/school-learning-route.test.cjs
```

Expected: PASS для config/default/fallback tests.

- [ ] **step 8: commit**

```bash
git add school-teacher-config.js school-learning-route.js school.html test/school-learning-route.test.cjs
git commit -m "добавить конфигурацию маршрутов школы"
```

---

### task 2: fail-safe overrides, URL policy, reviewer и compact labels

**Files:**

- Modify: `school-learning-route.js`
- Modify: `test/school-learning-route.test.cjs`

**Interfaces:**

- Consumes: `lesson.routeOverride` с nullable `cabinetId`, `teacherId`,
  `format`, `resourceUrl`.
- Produces:
  - полный immutable `LessonRoute`;
  - `normalizeRouteUrl(value, allowedHosts)`;
  - `compactRouteLabels(route) -> { desktop, mobile }`.

- [ ] **step 1: написать failing tests override и permanent resource**

Сначала добавить exact test helper:

```javascript
function configWithUrls(urls) {
  const base = loadConfig().SchoolLearningConfig;
  const copy = JSON.parse(JSON.stringify(base));
  Object.entries(urls).forEach(([cabinetId, url]) => {
    copy.cabinets[cabinetId].url = url;
  });
  return copy;
}
```

```javascript
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
```

`configWithUrls` должен клонировать complete config fixture и заменить только
literal URL до freeze; expected URL нельзя получать через resolver.

- [ ] **step 2: написать failing table tests temporary URL policy**

```javascript
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
```

Добавить отдельный literal invalid URL test:

```javascript
test('route url normalization rejects unsafe schemes credentials length and host suffixes', () => {
  const invalid = [
    'javascript:alert(1)',
    'file:///tmp/lesson.pdf',
    'data:text/plain,lesson',
    'https://user:password@youtube.com/watch?v=abc',
    'https://youtube.com.attacker.example/watch?v=abc',
    `https://example.com/${'a'.repeat(2049)}`
  ];
  invalid.forEach((url) => {
    assert.equal(
      SchoolLearningRoute.normalizeRouteUrl(url),
      null,
      url.slice(0, 80)
    );
  });
});
```

Добавить route-level warnings:

```javascript
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
```

- [ ] **step 3: написать failing tests unknown explicit values**

```javascript
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
```

Добавить literal preservation test:

```javascript
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
```

- [ ] **step 4: написать failing tests reviewer и labels**

```javascript
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
```

Добавить этот literal table test:

```javascript
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
```

- [ ] **step 5: запустить focused test и подтвердить RED**

Run:

```bash
node --test test/school-learning-route.test.cjs
```

Expected: новые tests FAIL на URL normalization, warnings, reviewer и labels;
task 1 tests остаются PASS.

- [ ] **step 6: реализовать URL normalization и полный resolver**

Реализация должна:

```javascript
function normalizeRouteUrl(value, allowedHosts) {
  var raw = text(value);
  if (!raw || Array.from(raw).length > 2048) return null;
  try {
    var parsed = new URL(raw);
    var hostname = parsed.hostname.toLowerCase();
    if (
      parsed.protocol !== 'https:' ||
      parsed.username ||
      parsed.password ||
      !hostname ||
      allowedHosts && allowedHosts.indexOf(hostname) === -1
    ) return null;
    return parsed.href;
  } catch (_error) {
    return null;
  }
}
```

Использовать exact policies:

```javascript
var HOSTS = Object.freeze({
  ChatGPT: Object.freeze(['chatgpt.com', 'chat.openai.com']),
  Kimi: Object.freeze(['kimi.com', 'www.kimi.com']),
  YouTube: Object.freeze(['youtube.com', 'www.youtube.com', 'youtu.be']),
  Cursor: Object.freeze(['cursor.com', 'www.cursor.com'])
});

var REVIEWER_PLATFORMS = Object.freeze([
  'YouTube',
  'Book',
  'Documentation',
  'Terminal',
  'None'
]);
```

Для `Book` и `Documentation` разрешить любой credential-free HTTPS URL.
Для `Codex`, `Terminal`, `None` URL кабинета всегда `null`. Для permanent
cabinet валидировать `cabinet.url`; для temporary cabinet валидировать
`resourceUrl`. Permanent `resourceUrl` нормализовать отдельно и никогда не
присваивать в `cabinetUrl`.

Любой непустой invalid `resourceUrl` добавляет `invalid-resource` без raw URL и
делает `canOpenCabinet = false`. Temporary кабинет без обязательного resource
добавляет `missing-resource`. Пустой URL permanent ChatGPT/Cursor добавляет
`missing-cabinet-url`, но route metadata и prompt остаются доступными.

Warnings имеют форму:

```javascript
Object.freeze({
  code: 'unknown-cabinet',
  message: 'Неизвестный кабинет: missing-cabinet'
})
```

Не включать raw URL в warning message. При любом unknown explicit override
итоговый `canOpenCabinet` принудительно `false`.

Для неизвестного cabinet вернуть:

```javascript
{
  cabinetId: rawCabinetId,
  cabinetLabel: rawCabinetId,
  platform: 'Unknown',
  cabinetKind: 'unknown',
  cabinetUrl: null
}
```

- [ ] **step 7: реализовать compact labels без DOM**

```javascript
function compactRouteLabels(route) {
  var platform = text(route && route.platform) || 'Неизвестный кабинет';
  var teacher = text(route && route.teacherLabel);
  var desktopByPlatform = {
    ChatGPT: teacher.indexOf('глубокое') !== -1
      ? 'ChatGPT · глубокое рассуждение'
      : teacher.indexOf('быстрый') !== -1
        ? 'ChatGPT · быстрый'
        : 'ChatGPT · основной',
    Codex: 'Codex · coding agent',
    Kimi: 'Kimi · K3',
    YouTube: 'YouTube · автор материала',
    Book: 'Книга · автор материала',
    Documentation: 'Документация · автор материала',
    Terminal: 'Терминал · самостоятельная работа',
    None: 'Самостоятельная практика'
  };
  return Object.freeze({
    desktop: desktopByPlatform[platform] || 'Неизвестный кабинет',
    mobile: platform === 'Book'
      ? 'Книга'
      : platform === 'Documentation'
        ? 'Документация'
        : platform === 'Terminal'
          ? 'Терминал'
          : platform === 'None'
            ? 'Самостоятельно'
            : platform === 'Unknown'
              ? 'Неизвестно'
              : platform
  });
}
```

- [ ] **step 8: проверить GREEN и regression**

Run:

```bash
node --test test/school-learning-route.test.cjs
node --test test/school-teacher-bridge.test.cjs test/school-ui.test.cjs
```

Expected: all focused tests PASS.

- [ ] **step 9: commit**

```bash
git add school-learning-route.js test/school-learning-route.test.cjs
git commit -m "реализовать разрешение маршрута урока"
```

---

### task 3: route metadata в стартовом prompt

**Files:**

- Modify: `school-teacher-bridge.js:310-365`
- Modify: `test/school-teacher-bridge.test.cjs:120-215`

**Interfaces:**

- Consumes:
  `buildLessonTeacherPrompt(lesson, contentBlocks, route)`.
- Produces: stable optional lines `CABINET`, `TEACHER`, `MODEL_HINT`,
  `LESSON_FORMAT`, `RESOURCE`.

- [ ] **step 1: написать failing test exact metadata order**

```javascript
test('prompt includes resolved route metadata in a stable order', () => {
  const prompt = SchoolTeacherBridge.buildLessonTeacherPrompt(
    lesson(),
    [],
    {
      cabinetLabel: 'Codex',
      teacherLabel: 'Codex · coding agent',
      modelHint: 'выберите coding-модель вручную',
      format: 'Практическая лаборатория',
      resourceUrl: 'https://example.com/project-context'
    }
  );

  assert.match(
    prompt,
    /PRIORITY: Must\nCABINET: Codex\nTEACHER: Codex · coding agent\nMODEL_HINT: выберите coding-модель вручную\nLESSON_FORMAT: Практическая лаборатория\nRESOURCE: https:\/\/example\.com\/project-context/
  );
});
```

- [ ] **step 2: написать failing test пустых optional values и result contract**

```javascript
test('prompt omits empty route metadata and keeps one unchanged result contract', () => {
  const prompt = SchoolTeacherBridge.buildLessonTeacherPrompt(
    lesson(),
    [],
    {
      cabinetLabel: 'Самостоятельная практика',
      teacherLabel: 'Самостоятельная работа',
      modelHint: null,
      format: 'Самостоятельная практика',
      resourceUrl: null
    }
  );

  assert.match(prompt, /^CABINET: Самостоятельная практика$/m);
  assert.match(prompt, /^TEACHER: Самостоятельная работа$/m);
  assert.doesNotMatch(prompt, /^MODEL_HINT:/m);
  assert.doesNotMatch(prompt, /^RESOURCE:/m);
  assert.equal(
    prompt.split('=== LESSON RESULT ===').length - 1,
    1
  );
  assert.match(prompt, /=== END LESSON RESULT ===/);
});
```

Существующие calls без третьего аргумента должны продолжить строить prompt без
route lines; это сохраняет чистую обратную совместимость helper.

- [ ] **step 3: запустить test и подтвердить RED**

Run:

```bash
node --test test/school-teacher-bridge.test.cjs
```

Expected: metadata tests FAIL, parser/result tests PASS.

- [ ] **step 4: добавить route metadata минимальным helper**

```javascript
function routeMetadata(route) {
  var item = route && typeof route === 'object' ? route : {};
  return [
    text(item.cabinetLabel) ? 'CABINET: ' + text(item.cabinetLabel) : '',
    text(item.teacherLabel) ? 'TEACHER: ' + text(item.teacherLabel) : '',
    text(item.modelHint) ? 'MODEL_HINT: ' + text(item.modelHint) : '',
    text(item.format) ? 'LESSON_FORMAT: ' + text(item.format) : '',
    text(item.resourceUrl) ? 'RESOURCE: ' + text(item.resourceUrl) : ''
  ].filter(Boolean);
}
```

В `buildLessonTeacherPrompt` добавить `route` третьим аргументом и append
`routeMetadata(route)` после `PRIORITY`, до assignment content. Не изменять
`resultContract`, parser constants или pedagogical rules в PR 1.

- [ ] **step 5: проверить GREEN**

Run:

```bash
node --test test/school-teacher-bridge.test.cjs
```

Expected: all teacher bridge tests PASS.

- [ ] **step 6: commit**

```bash
git add school-teacher-bridge.js test/school-teacher-bridge.test.cjs
git commit -m "добавить маршрут в промт урока"
```

---

### task 4: dependency injection и compact route line на карточках

**Files:**

- Modify: `school.js:832-875`
- Modify: `school.js:1030-1060`
- Modify: `school.js:1243-1535`
- Modify: `school.js:2510-2535`
- Modify: `school.js:3510-3530`
- Modify: `school.css:367-430`
- Modify: `school.css:750-800`
- Modify: `test/school-ui.test.cjs`

**Interfaces:**

- Consumes:
  - `options.learningRoute`;
  - `options.learningConfig`;
  - `learningRoute.resolveLessonRoute`;
  - `learningRoute.compactRouteLabels`.
- Produces:
  - `controller.getCurrentLessonRoute()`;
  - `.school-card-route`;
  - desktop/mobile label spans.

- [ ] **step 1: написать failing controller test route resolution**

```javascript
test('controller resolves the current lesson route through injected dependencies', async () => {
  const activeLesson = {
    id: 'lesson-42',
    title: 'Cold start «Прометея»',
    subject: 'Software Engineering',
    status: 'В процессе'
  };
  const expectedRoute = {
    cabinetId: 'chatgpt-software',
    cabinetLabel: 'ChatGPT · Software Engineering'
  };
  const controller = SchoolUi.createController({
    api: {
      listLessons: async () => [activeLesson],
      getLessonContent: async () => ({ lesson: activeLesson, blocks: [] })
    },
    core: loadingCore(),
    document: null,
    learningConfig: { marker: 'config' },
    learningRoute: {
      resolveLessonRoute(lesson, config) {
        assert.equal(lesson.id, 'lesson-42');
        assert.equal(config.marker, 'config');
        return expectedRoute;
      }
    }
  });

  await controller.load();
  await controller.openLesson('lesson-42');
  assert.equal(controller.getCurrentLessonRoute(), expectedRoute);
});
```

Этот test проверяет реальный controller boundary, а не наличие имени функции в
source.

- [ ] **step 2: запустить controller test и подтвердить RED**

Run:

```bash
node --test --test-name-pattern="controller resolves the current lesson route" test/school-ui.test.cjs
```

Expected: FAIL, `getCurrentLessonRoute` отсутствует.

- [ ] **step 3: внедрить config и resolver**

В `createController`:

```javascript
var learningRoute = options.learningRoute ||
  (root && root.SchoolLearningRoute);
var learningConfig = options.learningConfig ||
  (root && root.SchoolLearningConfig) ||
  {};

function routeForLesson(lesson) {
  if (
    !learningRoute ||
    typeof learningRoute.resolveLessonRoute !== 'function'
  ) return null;
  return learningRoute.resolveLessonRoute(lesson, learningConfig);
}
```

Добавить `getCurrentLessonRoute` в frozen controller return. В `boot` передать
оба globals явно. Старые `teacherConfig` и `SchoolTeacherConfig` удалить,
чтобы постоянные URL не имели второго источника.

- [ ] **step 4: написать failing DOM test compact labels**

Экспортировать production helper `appendLessonRoute` из `school.js`; helper
вызывается реальным card renderer и поэтому не является test-only методом:

```javascript
test('lesson card renders distinct desktop and mobile route labels as text', () => {
  const document = fakeDocument();
  const card = document.createElement('button');

  SchoolUi.appendLessonRoute(
    card,
    document,
    {
      desktop: 'Codex · coding agent',
      mobile: 'Codex'
    }
  );

  assert.equal(card.children.length, 1);
  assert.equal(card.children[0].className, 'school-card-route');
  assert.equal(card.children[0].children[0].textContent, 'Codex · coding agent');
  assert.equal(card.children[0].children[1].textContent, 'Codex');
  assert.equal(card.children[0].children[0].className, 'school-route-desktop');
  assert.equal(card.children[0].children[1].className, 'school-route-mobile');
});
```

- [ ] **step 5: запустить DOM test и подтвердить RED**

Run:

```bash
node --test --test-name-pattern="lesson card renders distinct" test/school-ui.test.cjs
```

Expected: FAIL, `appendLessonRoute` отсутствует.

- [ ] **step 6: реализовать route line и подключить ко всем card variants**

```javascript
function appendLessonRoute(card, documentRef, labels) {
  if (!card || !documentRef || !labels) return;
  var line = element(documentRef, 'span', 'school-card-route');
  line.appendChild(element(
    documentRef,
    'span',
    'school-route-desktop',
    labels.desktop
  ));
  line.appendChild(element(
    documentRef,
    'span',
    'school-route-mobile',
    labels.mobile
  ));
  card.appendChild(line);
}
```

`appendLessonDetails` получает `routeLabels` последним аргументом и вызывает
helper после title, до schedule/status metadata. Во всех местах
`makeLessonCard`, timed card и today focus передавать labels, полученные только
через:

```javascript
function routeLabelsForLesson(lesson) {
  var route = routeForLesson(lesson);
  return route && learningRoute.compactRouteLabels(route);
}
```

Не разрешать card renderer обращаться к config напрямую.

- [ ] **step 7: добавить responsive CSS**

```css
.school-card-route {
  display: block;
  margin-top: 6px;
  overflow: hidden;
  color: var(--school-text-2);
  font-family: var(--school-mono);
  font-size: 9px;
  line-height: 1.2;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.school-route-mobile { display: none; }

.school-time-card .school-card-route {
  margin-top: 2px;
  font-size: 6.5px;
}

@media (max-width: 760px) {
  .school-route-desktop { display: none; }
  .school-route-mobile { display: inline; }
}
```

Проверить, что route line не меняет minimum height timed cards и не скрывает
time/status. Для очень коротких timed cards применять существующие overflow
правила, не увеличивать card height.

- [ ] **step 8: проверить GREEN и all card regression**

Run:

```bash
node --test test/school-learning-route.test.cjs test/school-ui.test.cjs
```

Expected: PASS; существующие drag, timeline и focus tests остаются зелёными.

- [ ] **step 9: commit**

```bash
git add school.js school.css test/school-ui.test.cjs
git commit -m "показать маршруты на карточках уроков"
```

---

### task 5: read-only drawer и совместимость teacher bridge actions

**Files:**

- Modify: `school.html:214-240`
- Modify: `school.js:2510-2835`
- Modify: `school.js:3040-3070`
- Modify: `school.css`
- Modify: `test/school-ui.test.cjs`

**Interfaces:**

- Consumes: `LessonRoute` и загруженные content blocks.
- Produces:
  - read-only section `Где проходит урок`;
  - `getCurrentTeacherPrompt()` с route metadata;
  - `teacherTargetForRoute(route)` для существующего `copyPromptAndOpen`.

- [ ] **step 1: написать failing test prompt получает текущий route**

Обновить существующий test
`controller rebuilds the same teacher prompt from reloaded notion content`:

```javascript
const route = {
  cabinetId: 'chatgpt-software',
  cabinetLabel: 'ChatGPT · Software Engineering',
  platform: 'ChatGPT',
  cabinetKind: 'permanent',
  cabinetUrl: 'https://chatgpt.com/g/software',
  teacherId: 'chatgpt-main',
  teacherLabel: 'ChatGPT · основной преподаватель',
  modelHint: 'выберите основную модель вручную',
  format: 'Сократовский урок',
  resourceUrl: null,
  usesDefaultCabinet: true,
  usesDefaultTeacher: true,
  canOpenCabinet: true,
  warnings: [],
  reviewer: null
};
```

В controller fixture внедрить real `SchoolTeacherBridge`, synthetic
`learningRoute.resolveLessonRoute: () => route`, затем assert:

```javascript
assert.match(first, /CABINET: ChatGPT · Software Engineering/);
assert.match(first, /TEACHER: ChatGPT · основной преподаватель/);
assert.match(first, /MODEL_HINT: выберите основную модель вручную/);
assert.match(first, /LESSON_FORMAT: Сократовский урок/);
```

- [ ] **step 2: запустить test и подтвердить RED**

Run:

```bash
node --test --test-name-pattern="controller rebuilds the same teacher prompt" test/school-ui.test.cjs
```

Expected: FAIL, controller вызывает prompt builder без route.

- [ ] **step 3: передать resolved route в prompt**

```javascript
return teacherBridge.buildLessonTeacherPrompt(
  lesson,
  currentContentBlocks,
  routeForLesson(lesson)
);
```

Route вычисляется из current lesson при каждом prompt build; cached URL или
teacher object в controller не хранить.

- [ ] **step 4: написать failing test read-only route view model**

Добавить pure production helper в `school.js`:
`routeDrawerRows(route)`. Test проверяет только фактически заполненные значения:

```javascript
test('route drawer rows expose cabinet teacher model format resource and reviewer', () => {
  assert.deepEqual(SchoolUi.routeDrawerRows({
    cabinetLabel: 'YouTube',
    cabinetKind: 'temporary',
    platform: 'YouTube',
    teacherLabel: 'Автор материала',
    modelHint: null,
    format: 'Видео + retrieval',
    resourceUrl: 'https://youtu.be/abc',
    warnings: [{ code: 'resource', message: 'warning text' }],
    reviewer: {
      cabinetLabel: 'ChatGPT · English & IELTS',
      teacherLabel: 'ChatGPT · основной преподаватель'
    }
  }), {
    cabinet: 'YouTube',
    kind: 'временный',
    teacher: 'Автор материала',
    modelHint: '',
    format: 'Видео + retrieval',
    resource: 'https://youtu.be/abc',
    reviewer: 'ChatGPT · English & IELTS · ChatGPT · основной преподаватель',
    warnings: ['warning text'],
    instruction: 'Скопируйте промт. Автоматический запуск этого кабинета появится в PR 3.'
  });
});
```

Добавить exact rows cases:

```javascript
test('route drawer rows distinguish permanent and unknown routes', () => {
  assert.deepEqual(SchoolUi.routeDrawerRows({
    cabinetLabel: 'ChatGPT · Mathematics',
    cabinetKind: 'permanent',
    platform: 'ChatGPT',
    canOpenCabinet: false,
    teacherLabel: 'ChatGPT · глубокое рассуждение',
    modelHint: 'выберите сильную reasoning-модель вручную',
    format: 'Сократовский урок',
    resourceUrl: null,
    warnings: [],
    reviewer: null
  }), {
    cabinet: 'ChatGPT · Mathematics',
    kind: 'постоянный',
    teacher: 'ChatGPT · глубокое рассуждение',
    modelHint: 'выберите сильную reasoning-модель вручную',
    format: 'Сократовский урок',
    resource: '',
    reviewer: '',
    warnings: [],
    instruction: 'Ссылка кабинета ещё не настроена. Промт можно скопировать вручную.'
  });

  assert.deepEqual(SchoolUi.routeDrawerRows({
    cabinetLabel: 'missing-cabinet',
    cabinetKind: 'unknown',
    teacherLabel: 'missing-teacher',
    modelHint: null,
    format: 'Неизвестный формат',
    resourceUrl: null,
    warnings: [{ message: 'Проверьте маршрут урока' }],
    reviewer: null
  }).kind, 'неизвестный');
});
```

- [ ] **step 5: запустить helper test и подтвердить RED**

Run:

```bash
node --test --test-name-pattern="route drawer rows" test/school-ui.test.cjs
```

Expected: FAIL, helper отсутствует.

- [ ] **step 6: заменить teacher heading и добавить semantic drawer markup**

В `school.html` переименовать section title в `Где проходит урок` и добавить
static `<dl>`:

```html
<dl class="school-route-summary" id="schoolRouteSummary">
  <div><dt>Кабинет</dt><dd id="schoolRouteCabinet"></dd></div>
  <div><dt>Тип</dt><dd id="schoolRouteKind"></dd></div>
  <div><dt>Преподаватель</dt><dd id="schoolRouteTeacher"></dd></div>
  <div id="schoolRouteModelRow"><dt>Модель</dt><dd id="schoolRouteModel"></dd></div>
  <div><dt>Формат</dt><dd id="schoolRouteFormat"></dd></div>
  <div id="schoolRouteResourceRow"><dt>Ресурс</dt><dd id="schoolRouteResource"></dd></div>
  <div id="schoolRouteReviewerRow"><dt>Проверяющий</dt><dd id="schoolRouteReviewer"></dd></div>
</dl>
<div class="school-route-warnings" id="schoolRouteWarnings" role="status"></div>
<p class="school-teacher-note" id="schoolTeacherNote"></p>
```

Resource в PR 1 показывать как inert text, а не clickable raw link. Existing
fallback teacher link остаётся единственной navigation ссылкой.

- [ ] **step 7: реализовать rows и render через textContent**

`routeDrawerRows` возвращает literal normalized strings:

```javascript
function routeDrawerRows(route) {
  var item = route && typeof route === 'object' ? route : {};
  var reviewer = item.reviewer || null;
  var warnings = Array.isArray(item.warnings)
    ? item.warnings.map(function (warning) {
      return text(warning && warning.message);
    }).filter(Boolean)
    : [];
  var kind = item.cabinetKind === 'permanent'
    ? 'постоянный'
    : item.cabinetKind === 'temporary'
      ? 'временный'
      : 'неизвестный';
  var instruction = item.platform === 'Codex'
    ? 'Скопируйте промт и откройте Codex desktop вручную.'
    : item.platform === 'ChatGPT' && item.canOpenCabinet
      ? 'Скопируйте промт и откройте постоянный кабинет преподавателя.'
      : item.platform === 'ChatGPT'
        ? 'Ссылка кабинета ещё не настроена. Промт можно скопировать вручную.'
        : item.platform === 'None'
          ? 'Выполните самостоятельную попытку; prompt остаётся доступен для проверки.'
          : item.platform === 'Unknown'
            ? 'Проверьте неизвестные значения маршрута. Открытие заблокировано.'
            : 'Скопируйте промт. Автоматический запуск этого кабинета появится в PR 3.';
  return {
    cabinet: text(item.cabinetLabel),
    kind: kind,
    teacher: text(item.teacherLabel),
    modelHint: text(item.modelHint),
    format: text(item.format),
    resource: text(item.resourceUrl),
    reviewer: reviewer
      ? [
        text(reviewer.cabinetLabel),
        text(reviewer.teacherLabel)
      ].filter(Boolean).join(' · ')
      : '',
    warnings: warnings,
    instruction: instruction
  };
}
```

В `renderTeacherSection`:

```javascript
var route = routeForLesson(lesson);
var rows = routeDrawerRows(route);
byId('schoolRouteCabinet').textContent = rows.cabinet;
byId('schoolRouteKind').textContent = rows.kind;
byId('schoolRouteTeacher').textContent = rows.teacher;
byId('schoolRouteModel').textContent = rows.modelHint;
byId('schoolRouteModelRow').hidden = !rows.modelHint;
byId('schoolRouteFormat').textContent = rows.format;
byId('schoolRouteResource').textContent = rows.resource;
byId('schoolRouteResourceRow').hidden = !rows.resource;
byId('schoolRouteReviewer').textContent = rows.reviewer;
byId('schoolRouteReviewerRow').hidden = !rows.reviewer;
byId('schoolTeacherNote').textContent = rows.instruction;
```

Warnings очистить через существующий `clearNode`, затем для каждого message
создать `<p>` через `element(documentRef, 'p', '', message)`.

- [ ] **step 8: написать failing test ChatGPT-only launch target**

```javascript
test('teacher launch target accepts only a configured safe ChatGPT route', () => {
  assert.deepEqual(SchoolUi.teacherTargetForRoute({
    platform: 'ChatGPT',
    cabinetKind: 'permanent',
    canOpenCabinet: true,
    cabinetUrl: 'https://chatgpt.com/g/software',
    teacherLabel: 'ChatGPT · основной преподаватель'
  }), {
    configured: true,
    label: 'ChatGPT · основной преподаватель',
    url: 'https://chatgpt.com/g/software'
  });

  assert.deepEqual(SchoolUi.teacherTargetForRoute({
    platform: 'Codex',
    cabinetKind: 'permanent',
    canOpenCabinet: false,
    cabinetUrl: null,
    teacherLabel: 'Codex · coding agent'
  }), {
    configured: false,
    label: 'Codex · coding agent',
    url: null
  });
});
```

Run:

```bash
node --test --test-name-pattern="teacher launch target" test/school-ui.test.cjs
```

Expected: FAIL, helper отсутствует.

- [ ] **step 9: адаптировать существующие teacher actions без PR 3 behavior**

Заменить `teacherForLesson` на production helper:

```javascript
function teacherTargetForRoute(route) {
  var chatGpt = route &&
    route.platform === 'ChatGPT' &&
    route.cabinetKind === 'permanent' &&
    route.canOpenCabinet;
  return {
    configured: Boolean(chatGpt),
    label: route ? route.teacherLabel : 'Преподаватель',
    url: chatGpt ? route.cabinetUrl : null
  };
}
```

Экспортировать helper из frozen `SchoolUi` API и вызывать его только с
`routeForLesson(lesson)`.

Правила buttons:

- known configured ChatGPT route сохраняет текущие copy/open actions;
- пустой ChatGPT URL показывает existing config warning и разрешает copy;
- Codex/Cursor/Kimi/YouTube/Book/Documentation/Terminal/self-study в PR 1
  разрешают preview/copy prompt, но `Только открыть преподавателя` disabled;
- unknown override разрешает только preview/copy и показывает warning;
- final result import и completion request не меняются.

Не вызывать новый secure pre-open/start orchestration: он относится к PR 3.

- [ ] **step 10: написать и выполнить integration tests button state**

Сначала расширить test helper без production hooks двумя точными изменениями:

```diff
-function interactiveDocument() {
+function interactiveDocument(extraNodes = []) {
```

и:

```diff
-  ].forEach(([tagName, id]) => node(tagName, id));
+  ].concat(extraNodes).forEach(([tagName, id]) => node(tagName, id));
```

После этого добавить integration test с полным набором route nodes:

```javascript
test('read-only route keeps external launch disabled before strategy PR', async () => {
  const ui = interactiveDocument([
    ['section', 'schoolTeacherSection'],
    ['span', 'schoolTeacherStatus'],
    ['p', 'schoolTeacherNote'],
    ['button', 'schoolTeacherPrimary'],
    ['button', 'schoolTeacherCopy'],
    ['button', 'schoolTeacherOpen'],
    ['button', 'schoolTeacherFinishRequest'],
    ['button', 'schoolTeacherImport'],
    ['a', 'schoolTeacherFallbackLink'],
    ['dl', 'schoolRouteSummary'],
    ['dd', 'schoolRouteCabinet'],
    ['dd', 'schoolRouteKind'],
    ['dd', 'schoolRouteTeacher'],
    ['div', 'schoolRouteModelRow'],
    ['dd', 'schoolRouteModel'],
    ['dd', 'schoolRouteFormat'],
    ['div', 'schoolRouteResourceRow'],
    ['dd', 'schoolRouteResource'],
    ['div', 'schoolRouteReviewerRow'],
    ['dd', 'schoolRouteReviewer'],
    ['div', 'schoolRouteWarnings'],
    ['div', 'schoolLessonActions'],
    ['details', 'schoolCancelledHistory'],
    ['div', 'schoolCancelledHistoryContent']
  ]);
  const lesson = {
    id: 'lesson-codex',
    title: 'Coding laboratory',
    subject: 'Software Engineering',
    module: 'Debugging',
    status: 'В процессе',
    priority: 'Must',
    durationMinutes: 45,
    schedule: {
      kind: 'date-only',
      date: '2026-08-03',
      start: null,
      end: null
    }
  };
  const route = {
    cabinetId: 'codex-main',
    platform: 'Codex',
    cabinetKind: 'permanent',
    cabinetUrl: null,
    canOpenCabinet: false,
    cabinetLabel: 'Codex',
    teacherId: 'codex-main',
    teacherLabel: 'Codex · coding agent',
    modelHint: 'выберите coding-модель вручную',
    format: 'Практическая лаборатория',
    resourceUrl: null,
    warnings: [],
    reviewer: null
  };
  const controller = SchoolUi.createController({
    api: {
      listLessons: async () => [lesson],
      getLessonContent: async () => ({ lesson, blocks: [] })
    },
    core: loadingCore(),
    document: ui.document,
    teacherBridge: SchoolTeacherBridge,
    learningConfig: {},
    learningRoute: {
      resolveLessonRoute: () => route,
      compactRouteLabels: () => ({
        desktop: 'Codex · coding agent',
        mobile: 'Codex'
      })
    }
  });

  await controller.load();
  await controller.openLesson('lesson-codex');

  assert.equal(ui.nodes.get('schoolTeacherCopy').disabled, false);
  assert.equal(ui.nodes.get('schoolTeacherOpen').disabled, true);
  assert.equal(ui.nodes.get('schoolRouteCabinet').textContent, 'Codex');
  assert.equal(
    ui.nodes.get('schoolRouteModel').textContent,
    'выберите coding-модель вручную'
  );
  assert.equal(
    ui.nodes.get('schoolTeacherNote').textContent,
    'Скопируйте промт и откройте Codex desktop вручную.'
  );
});
```

Не создавать test-only production hooks.

Run:

```bash
node --test test/school-ui.test.cjs
```

Expected: all UI tests PASS, включая popup/clipboard teacher bridge tests.

- [ ] **step 11: добавить drawer CSS и commit**

Использовать existing surface, line, text и mono variables:

```css
.school-route-summary {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
  margin: 12px 0;
}

.school-route-summary > div {
  min-width: 0;
  padding: 10px;
  border: 1px solid var(--school-line);
  border-radius: 10px;
}

.school-route-summary dt {
  color: var(--school-text-3);
  font-size: 9px;
  text-transform: uppercase;
}

.school-route-summary dd {
  margin: 4px 0 0;
  overflow-wrap: anywhere;
}

.school-route-warnings {
  color: var(--school-warning);
}

@media (max-width: 760px) {
  .school-route-summary { grid-template-columns: 1fr; }
}
```

```bash
git add school.html school.js school.css test/school-ui.test.cjs
git commit -m "показать маршрут в карточке урока"
```

---

### task 6: README, cache contract и полный regression gate

**Files:**

- Modify: `README.md:1-35`
- Modify: `school.html:8-24`
- Modify: `test/school-ui.test.cjs`
- Test: all frontend and school-notion tests

**Interfaces:**

- Consumes: итоговые assets PR 1.
- Produces: documented permanent URL update procedure и coherent asset
  versions.

- [ ] **step 1: написать failing cache-order test**

Обновить existing page load/cache test с exact sequence:

```javascript
const scripts = [
  'profile-theme.js?v=401',
  'topbar.js?v=403',
  'supabase-sync.js?v=406-sb',
  'school-core.js?v=6',
  'school-api.js',
  'school-teacher-config.js?v=2',
  'school-learning-route.js?v=1',
  'school-teacher-bridge.js?v=2',
  'school-mutation-queue.js?v=1',
  'school.js?v=11'
];
```

Отдельно assert `school.css?v=11`. Проверять порядок через DOM/source index
как asset integration contract, не внутреннюю реализацию resolver.

- [ ] **step 2: запустить test и подтвердить RED**

Run:

```bash
node --test --test-name-pattern="school page loads|cache-busts" test/school-ui.test.cjs
```

Expected: FAIL на старых versions.

- [ ] **step 3: обновить versions одним release set**

В `school.html` установить:

- `school.css?v=11`;
- `school-teacher-config.js?v=2`;
- `school-learning-route.js?v=1`;
- `school-teacher-bridge.js?v=2`;
- `school.js?v=11`.

Не менять versions незатронутых assets.

- [ ] **step 4: переписать README под новый единый config**

README должен явно содержать:

1. найти permanent cabinet key в `SchoolLearningConfig.cabinets`;
2. изменить только его `url`;
3. проверить `https`, exact hostname и отсутствие username/password;
4. не записывать URL в Notion, localStorage, Supabase или lesson;
5. обновить `school-teacher-config.js?v=2` при следующем изменении;
6. открыть один урок и проверить cabinet/teacher/format;
7. подтвердить, что `LESSON_REF` и import result не изменились.

Добавить literal example:

```javascript
'chatgpt-software': {
  label: 'ChatGPT · Software Engineering',
  platform: 'ChatGPT',
  kind: 'permanent',
  url: 'https://chatgpt.com/g/example'
}
```

Указать допустимые ChatGPT hosts `chatgpt.com`, `chat.openai.com`; Codex URL
в MVP отсутствует; Cursor URL допускает только `cursor.com`; temporary resource
не переносится в permanent config.

- [ ] **step 5: focused GREEN**

Run:

```bash
node --test test/school-learning-route.test.cjs test/school-teacher-bridge.test.cjs test/school-ui.test.cjs
```

Expected: all focused tests PASS.

- [ ] **step 6: syntax и full test gate**

Run:

```bash
node --check school-teacher-config.js
node --check school-learning-route.js
node --check school-teacher-bridge.js
node --check school.js
node --test
```

Expected: syntax checks exit 0; full suite PASS, не меньше baseline 338 tests и
с добавленными PR 1 tests.

- [ ] **step 7: backend unchanged regression gate**

Run:

```bash
cd supabase/functions/school-notion
deno task check
deno task lint
deno task test
```

Expected: check/lint exit 0 и все backend tests PASS. Вернуться в repository
root перед следующими commands.

- [ ] **step 8: diff, scope и secret checks**

Run from repository root:

```bash
git diff --check agent/school-teacher-bridge..HEAD
git diff --name-only agent/school-teacher-bridge..HEAD
git grep -nE 'ntn_[A-Za-z0-9]|sb_secret_[A-Za-z0-9]|service_role.*[=:].*[A-Za-z0-9]' -- school-teacher-config.js school-learning-route.js school-teacher-bridge.js school.js school.html README.md test
```

Expected:

- diff check exit 0;
- changed code files совпадают с картой этого plan;
- secret grep не находит значений;
- нет файлов Supabase/Notion implementation в diff;
- no route editor, `updateLessonRoute` или platform strategy handlers.

- [ ] **step 9: commit documentation/cache block**

```bash
git add README.md school.html test/school-ui.test.cjs
git commit -m "документировать постоянные кабинеты школы"
```

После commit повторить focused tests, потому что HTML asset order является
runtime contract.

---

### task 7: read-only browser QA и подготовка Draft PR 1

**Files:**

- No production changes expected.
- Screenshots передаются в итоговом отчёте и не коммитятся без отдельного
  требования.

**Interfaces:**

- Consumes: полностью зелёный branch PR 1.
- Produces: desktop/mobile evidence и Draft PR, stacked на PR #52.

- [ ] **step 1: проверить branch ancestry и clean tree**

```bash
git status --short --branch
git merge-base --is-ancestor agent/school-teacher-bridge HEAD
git log --oneline --decorate agent/school-teacher-bridge..HEAD
```

Expected: clean tree; ancestry command exit 0; commits относятся только к
config/resolver/prompt/read-only UI/docs.

- [ ] **step 2: запустить local preview без mutations**

Использовать существующую Supabase session и открыть
`http://127.0.0.1:8765/school.html`. Если server не запущен:

```bash
python3 -m http.server 8765 --bind 127.0.0.1
```

Не выполнять `startLesson`, move, complete, cancel или другие mutations.

- [ ] **step 3: desktop QA 1440×900**

Проверить на реальном lesson:

- route line не вытесняет title/time/status;
- default subject cabinet и teacher соответствуют предмету;
- drawer показывает `Где проходит урок`, type, teacher, model hint и format;
- model hint явно говорит о ручном выборе;
- пустой permanent URL показывает configuration warning;
- prompt preview содержит route metadata;
- import `LESSON RESULT` UI остаётся доступным и не сохраняет без
  подтверждения;
- route editor отсутствует.

Сделать screenshots week card и drawer.

- [ ] **step 4: mobile QA 390×844**

Проверить:

- compact line показывает только platform;
- card title/time/status остаются читаемыми;
- drawer summary становится одной колонкой;
- warning и teacher actions не создают horizontal overflow;
- keyboard/focus behavior и close drawer не регрессировали.

Сделать screenshots mobile card и drawer.

- [ ] **step 5: финально повторить automated gate**

```bash
node --test
cd supabase/functions/school-notion
deno task check
deno task lint
deno task test
```

Expected: все проверки PASS после browser QA.

- [ ] **step 6: подготовить подробный Draft PR**

Base PR должен быть `agent/school-teacher-bridge`, не `main`.

PR title в нижнем регистре:

```text
добавить read-only маршрутизацию уроков по кабинетам
```

PR body должен содержать:

- что добавлены единый config, pure resolver и read-only UI;
- почему permanent URL остаются frontend config;
- как unknown override блокирует неправильное открытие;
- что `LESSON RESULT`, Notion schema и mutations не изменены;
- влияние на текущий teacher bridge;
- полный список test commands и фактические counts;
- desktop/mobile QA и screenshots;
- stacked dependency на PR #52;
- scope следующих PR 2/PR 3;
- известное ограничение artifact у `Пропущен` не входит в этот PR.

Открыть только Draft PR. Не переводить в Ready и не merge.

## self-review plan

- spec coverage: config, resolver, fail-safe unknown values, permanent и
  temporary URL policy, reviewer metadata, prompt metadata, cards, drawer,
  README и stacked PR gate имеют отдельные tasks.
- scope protection: Notion properties, backend route command, editor и launch
  strategies явно исключены.
- TDD order: каждый production block начинается с test и наблюдаемого RED,
  затем minimal GREEN, regression и commit.
- type consistency:
  - `resolveLessonRoute(lesson, config)`;
  - `compactRouteLabels(route)`;
  - `buildLessonTeacherPrompt(lesson, contentBlocks, route)`;
  - `routeDrawerRows(route)`;
  - `teacherTargetForRoute(route)`;
  - `getCurrentLessonRoute()`.
- no test-only production method: экспортируемые UI helpers вызываются
  production renderer.
- no real lesson mutation: browser QA PR 1 полностью read-only.
- popup security не реализуется преждевременно: exact pre-open относится к
  отдельному PR 3.
