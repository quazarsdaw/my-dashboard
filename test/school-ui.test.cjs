const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const SchoolCore = require('../school-core.js');
const SchoolMutationQueue = require('../school-mutation-queue.js');
const SchoolTeacherBridge = require('../school-teacher-bridge.js');
const SchoolUi = require('../school.js');

function read(file) {
  return fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
}

function assertSchoolAssetContract(html) {
  const expectedScripts = [
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
  const scripts = Array.from(
    html.matchAll(/<script\b[^>]*\bsrc="([^"]+)"[^>]*>/g),
    (match) => match[1]
  );
  const stylesheets = Array.from(
    html.matchAll(/<link\b(?=[^>]*\brel="stylesheet")[^>]*\bhref="([^"]+)"[^>]*>/g),
    (match) => match[1]
  );

  assert.ok(html.includes('<body data-page="school">'));
  assert.deepEqual(stylesheets, ['school.css?v=11']);
  assert.deepEqual(scripts, expectedScripts);
}

function fakeDocument() {
  function node(tagName) {
    return {
      tagName: tagName.toUpperCase(),
      attributes: {},
      children: [],
      className: '',
      style: {},
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

function loadingCore() {
  return {
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
  };
}

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

function interactiveDocument(extraNodes = []) {
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
    ['section', 'schoolState'],
    ['strong', 'schoolStateTitle'],
    ['span', 'schoolStateText'],
    ['div', 'schoolReady'],
    ['section', 'schoolLoadingSkeleton'],
    ['span', 'schoolLoadingText'],
    ['section', 'schoolSyncBanner'],
    ['span', 'schoolSyncMessage'],
    ['button', 'schoolSyncRetry'],
    ['div', 'schoolLessonDialog'],
    ['button', 'schoolLessonClose'],
    ['h2', 'schoolLessonTitle'],
    ['p', 'schoolLessonSubject'],
    ['div', 'schoolLessonMeta'],
    ['div', 'schoolContentState'],
    ['article', 'schoolLessonContent']
  ].concat(extraNodes).forEach(([tagName, id]) => node(tagName, id));
  nodes.get('schoolLessonDialog').hidden = true;
  nodes.get('schoolReady').hidden = true;
  return { document, nodes };
}

test('school page loads the coherent read-only school release set in dependency order', () => {
  const html = read('school.html');
  assertSchoolAssetContract(html);
});

test('school page cache contract rejects a legacy duplicate asset', () => {
  const legacyDuplicate = read('school.html').replace(
    '  <script src="school.js?v=11" defer></script>',
    '  <script src="school.js?v=10" defer></script>\n  <script src="school.js?v=11" defer></script>'
  );

  assert.throws(() => assertSchoolAssetContract(legacyDuplicate));
});

test('school shell exposes the teacher section, import dialog and explicit final status', () => {
  const html = read('school.html');

  [
    'schoolTeacherSection',
    'schoolTeacherPrimary',
    'schoolTeacherCopy',
    'schoolTeacherOpen',
    'schoolTeacherFinishRequest',
    'schoolTeacherImport',
    'schoolTeacherDialog',
    'schoolTeacherSource',
    'schoolTeacherPreview',
    'schoolLessonFinalStatus',
    'schoolAssessmentErrors',
    'schoolToast'
  ].forEach((id) => assert.ok(html.includes(`id="${id}"`), id));
  assert.ok(html.includes('Сохранить результат в дневник'));
  assert.ok(html.includes('aria-live="polite"'));
});

test('combined teacher action opens a secure blank synchronously before clipboard resolves', async () => {
  const clipboard = deferred();
  const events = [];
  const metaNodes = [];
  const popup = {
    opener: {},
    document: {
      head: {
        appendChild(node) {
          metaNodes.push(node);
        }
      },
      createElement(tagName) {
        return {
          tagName,
          attributes: {},
          setAttribute(name, value) {
            this.attributes[name] = value;
          }
        };
      }
    },
    location: {
      replace(url) {
        events.push(['navigate', url]);
      }
    }
  };
  const runtime = {
    open(url, target) {
      events.push(['open', url, target]);
      return popup;
    }
  };

  const action = SchoolUi.copyPromptAndOpen({
    copyText(value) {
      events.push(['copy', value]);
      return clipboard.promise;
    },
    prompt: 'prompt body',
    runtime,
    teacher: {
      configured: true,
      label: 'преподаватель',
      url: 'https://chatgpt.com/g/g-123'
    }
  });

  assert.deepEqual(events, [
    ['open', 'about:blank', '_blank'],
    ['copy', 'prompt body']
  ]);
  assert.equal(popup.opener, null);
  assert.deepEqual(metaNodes[0].attributes, {
    name: 'referrer',
    content: 'no-referrer'
  });
  clipboard.resolve();
  const result = await action;

  assert.deepEqual(events.at(-1), ['navigate', 'https://chatgpt.com/g/g-123']);
  assert.deepEqual(result, {
    copied: true,
    opened: true,
    popupBlocked: false
  });
});

test('blocked popup or clipboard failure never loses the prompt', async () => {
  const fallback = [];
  const blocked = [];
  const result = await SchoolUi.copyPromptAndOpen({
    copyText() {
      return Promise.reject(new Error('clipboard denied'));
    },
    onClipboardFallback(value) {
      fallback.push(value);
    },
    onPopupBlocked(url) {
      blocked.push(url);
    },
    prompt: 'prompt body',
    runtime: { open: () => null },
    teacher: {
      configured: true,
      label: 'преподаватель',
      url: 'https://chatgpt.com/g/g-123'
    }
  });

  assert.deepEqual(fallback, ['prompt body']);
  assert.deepEqual(blocked, ['https://chatgpt.com/g/g-123']);
  assert.deepEqual(result, {
    copied: false,
    opened: false,
    popupBlocked: true
  });
});

test('a throwing popup implementation still copies the prompt', async () => {
  const copied = [];
  const blocked = [];
  const result = await SchoolUi.copyPromptAndOpen({
    copyText(value) {
      copied.push(value);
      return Promise.resolve();
    },
    onPopupBlocked(url) {
      blocked.push(url);
    },
    prompt: 'prompt body',
    runtime: {
      open() {
        throw new Error('popup policy');
      }
    },
    teacher: {
      configured: true,
      label: 'преподаватель',
      url: 'https://chatgpt.com/g/g-123'
    }
  });

  assert.deepEqual(copied, ['prompt body']);
  assert.deepEqual(blocked, ['https://chatgpt.com/g/g-123']);
  assert.equal(result.popupBlocked, true);
});

test('failed popup navigation keeps a copied prompt and exposes the fallback link', async () => {
  const blocked = [];
  const result = await SchoolUi.copyPromptAndOpen({
    copyText() {
      return Promise.resolve();
    },
    onPopupBlocked(url) {
      blocked.push(url);
    },
    prompt: 'prompt body',
    runtime: {
      open() {
        return {
          opener: {},
          location: {
            replace() {
              throw new Error('navigation denied');
            }
          }
        };
      }
    },
    teacher: {
      configured: true,
      label: 'преподаватель',
      url: 'https://chatgpt.com/g/g-123'
    }
  });

  assert.deepEqual(blocked, ['https://chatgpt.com/g/g-123']);
  assert.deepEqual(result, {
    copied: true,
    opened: false,
    popupBlocked: true
  });
});

test('empty teacher url still copies without opening a blank tab', async () => {
  const events = [];
  const result = await SchoolUi.copyPromptAndOpen({
    copyText(value) {
      events.push(['copy', value]);
      return Promise.resolve();
    },
    prompt: 'prompt body',
    runtime: {
      open() {
        events.push(['open']);
      }
    },
    teacher: {
      configured: false,
      label: 'преподаватель',
      url: null
    }
  });

  assert.deepEqual(events, [['copy', 'prompt body']]);
  assert.deepEqual(result, {
    copied: true,
    opened: false,
    popupBlocked: false
  });
});

test('applying teacher result fills editable controls but performs no mutation', () => {
  const controls = new Map();
  const mutations = [];

  function editableControl(id, value = '') {
    const listeners = new Map();
    const classes = new Set();
    const control = {
      id,
      value,
      disabled: false,
      addEventListener(type, handler) {
        if (!listeners.has(type)) listeners.set(type, []);
        listeners.get(type).push(handler);
      },
      dispatch(type) {
        (listeners.get(type) || []).forEach((handler) => handler({ target: control }));
      },
      classList: {
        add(name) { classes.add(name); },
        remove(name) { classes.delete(name); },
        contains(name) { return classes.has(name); }
      }
    };
    controls.set(id, control);
    return control;
  }

  [
    'schoolLessonFinalStatus',
    'schoolLessonResult',
    'schoolLessonAutonomy',
    'schoolLessonUnderstanding',
    'schoolLessonComment',
    'schoolLessonArtifact',
    'schoolLessonMissedReason'
  ].forEach((id) => editableControl(id));
  const document = {
    getElementById(id) {
      return controls.get(id) || null;
    }
  };

  SchoolUi.applyTeacherResultToControls(document, {
    lessonId: 'lesson-42',
    status: 'Выполнен',
    result: 'Зачёт',
    autonomy: 'A2',
    understanding: 2,
    comment: 'Готово.',
    artifactUrl: 'https://example.com/artifact',
    missedReason: null
  }, {
    mutate(command) {
      mutations.push(command);
    }
  });

  assert.deepEqual(
    Object.fromEntries([...controls].map(([id, control]) => [id, control.value])),
    {
      schoolLessonFinalStatus: 'Выполнен',
      schoolLessonResult: 'Зачёт',
      schoolLessonAutonomy: 'A2',
      schoolLessonUnderstanding: '2',
      schoolLessonComment: 'Готово.',
      schoolLessonArtifact: 'https://example.com/artifact',
      schoolLessonMissedReason: ''
    }
  );
  assert.deepEqual(mutations, []);
  assert.equal(controls.get('schoolLessonComment').classList.contains('is-teacher-filled'), true);

  controls.get('schoolLessonComment').value = 'Исправлено вручную.';
  controls.get('schoolLessonComment').dispatch('input');
  assert.equal(controls.get('schoolLessonComment').value, 'Исправлено вручную.');
  assert.equal(controls.get('schoolLessonComment').classList.contains('is-teacher-filled'), false);
  assert.equal(controls.get('schoolLessonComment').disabled, false);
});

test('assessment command uses only current editable controls and existing completeLesson', () => {
  const values = {
    schoolLessonFinalStatus: 'Частично выполнен',
    schoolLessonResult: 'Незачёт',
    schoolLessonAutonomy: 'A1',
    schoolLessonUnderstanding: '1',
    schoolLessonComment: 'Нужно повторить.',
    schoolLessonArtifact: 'https://example.com/work',
    schoolLessonMissedReason: ''
  };
  const document = {
    getElementById(id) {
      return Object.hasOwn(values, id) ? { value: values[id] } : null;
    }
  };

  assert.deepEqual(
    SchoolUi.assessmentDraft(document, { id: 'lesson-42' }, SchoolTeacherBridge),
    {
      command: {
        operation: 'completeLesson',
        lessonId: 'lesson-42',
        status: 'Частично выполнен',
        autonomy: 'A1',
        understanding: 1,
        comment: 'Нужно повторить.',
        artifactUrl: 'https://example.com/work'
      },
      errors: [],
      summary: [
        'Статус: Частично выполнен',
        'Результат: Требует повторения',
        'Автономность: A1',
        'Понимание: 1/3',
        'Комментарий: Нужно повторить.',
        'Артефакт: https://example.com/work'
      ].join('\n')
    }
  );
});

test('changing final status keeps assessment fields semantically consistent', () => {
  const values = {
    schoolLessonResult: { value: 'Незачёт' },
    schoolLessonAutonomy: { value: 'A2' },
    schoolLessonUnderstanding: { value: '2' },
    schoolLessonMissedReason: { value: 'Низкая энергия' }
  };
  const document = {
    getElementById(id) {
      return values[id] || null;
    }
  };

  SchoolUi.syncAssessmentControlsForStatus(document, 'Пропущен');
  assert.deepEqual(
    Object.fromEntries(Object.entries(values).map(([id, control]) => [id, control.value])),
    {
      schoolLessonResult: '',
      schoolLessonAutonomy: '',
      schoolLessonUnderstanding: '',
      schoolLessonMissedReason: 'Низкая энергия'
    }
  );

  SchoolUi.syncAssessmentControlsForStatus(document, 'Частично выполнен');
  assert.equal(values.schoolLessonResult.value, 'Требует повторения');
  assert.equal(values.schoolLessonMissedReason.value, '');

  values.schoolLessonResult.value = '';
  SchoolUi.syncAssessmentControlsForStatus(document, 'Выполнен');
  assert.equal(values.schoolLessonResult.value, 'Зачёт');
});

test('controller rebuilds the same teacher prompt from reloaded notion content', async () => {
  const activeLesson = {
    id: 'lesson-42',
    title: 'Cold start «Прометея»',
    subject: 'Software Engineering',
    module: 'Environment & Setup',
    schedule: {
      kind: 'date-only',
      date: '2026-08-03',
      start: null,
      end: null
    },
    status: 'В процессе',
    priority: 'Must',
    durationMinutes: 45
  };
  const blocks = [{
    type: 'paragraph',
    spans: [{ text: 'Проверить чистый запуск.', annotations: {} }],
    children: []
  }];
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
  const controller = SchoolUi.createController({
    api: {
      listLessons: async () => [activeLesson],
      getLessonContent: async () => ({ lesson: activeLesson, blocks })
    },
    core: loadingCore(),
    document: null,
    teacherBridge: SchoolTeacherBridge,
    learningConfig: {},
    learningRoute: { resolveLessonRoute: () => route }
  });

  await controller.load();
  await controller.openLesson('lesson-42');
  const first = controller.getCurrentTeacherPrompt();
  await controller.openLesson('lesson-42');
  const second = controller.getCurrentTeacherPrompt();

  assert.equal(first, second);
  assert.match(first, /LESSON_REF: lesson-42/);
  assert.match(first, /Проверить чистый запуск\./);
  assert.match(first, /CABINET: ChatGPT · Software Engineering/);
  assert.match(first, /TEACHER: ChatGPT · основной преподаватель/);
  assert.match(first, /MODEL_HINT: выберите основную модель вручную/);
  assert.match(first, /LESSON_FORMAT: Сократовский урок/);
});

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

  assert.equal(SchoolUi.routeDrawerRows({
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

test('teacher launch target accepts only a configured safe ChatGPT route', () => {
  assert.deepEqual(SchoolUi.teacherTargetForRoute({
    platform: 'ChatGPT', cabinetKind: 'permanent', canOpenCabinet: true,
    cabinetUrl: 'https://chatgpt.com/g/software',
    teacherLabel: 'ChatGPT · основной преподаватель'
  }), {
    configured: true, label: 'ChatGPT · основной преподаватель',
    url: 'https://chatgpt.com/g/software'
  });
  assert.deepEqual(SchoolUi.teacherTargetForRoute({
    platform: 'Codex', cabinetKind: 'permanent', canOpenCabinet: false,
    cabinetUrl: null, teacherLabel: 'Codex · coding agent'
  }), { configured: false, label: 'Codex · coding agent', url: null });
  assert.deepEqual(SchoolUi.teacherTargetForRoute({
    platform: 'ChatGPT', cabinetKind: 'permanent', canOpenCabinet: false,
    cabinetUrl: 'https://chatgpt.com/g/unconfigured', teacherLabel: 'Неизвестный'
  }), { configured: false, label: 'Неизвестный', url: null });
  assert.deepEqual(SchoolUi.teacherTargetForRoute({
    platform: 'Unknown', cabinetKind: 'permanent', canOpenCabinet: true,
    cabinetUrl: 'https://example.test/route', teacherLabel: 'Неизвестный'
  }), { configured: false, label: 'Неизвестный', url: null });
});

test('read-only route keeps external launch disabled before strategy PR', async () => {
  const ui = interactiveDocument([
    ['section', 'schoolTeacherSection'], ['span', 'schoolTeacherStatus'],
    ['p', 'schoolTeacherLabel'], ['p', 'schoolTeacherNote'],
    ['button', 'schoolTeacherPrimary'], ['button', 'schoolTeacherCopy'],
    ['button', 'schoolTeacherOpen'], ['button', 'schoolTeacherFinishRequest'],
    ['button', 'schoolTeacherImport'], ['a', 'schoolTeacherFallbackLink'],
    ['dl', 'schoolRouteSummary'], ['dd', 'schoolRouteCabinet'],
    ['dd', 'schoolRouteKind'], ['dd', 'schoolRouteTeacher'],
    ['div', 'schoolRouteModelRow'], ['dd', 'schoolRouteModel'],
    ['dd', 'schoolRouteFormat'], ['div', 'schoolRouteResourceRow'],
    ['dd', 'schoolRouteResource'], ['div', 'schoolRouteReviewerRow'],
    ['dd', 'schoolRouteReviewer'], ['div', 'schoolRouteWarnings'],
    ['div', 'schoolLessonActions'], ['details', 'schoolCancelledHistory'],
    ['div', 'schoolCancelledHistoryContent']
  ]);
  const lesson = {
    id: 'lesson-codex', title: 'Coding laboratory', subject: 'Software Engineering',
    module: 'Debugging', status: 'В процессе', priority: 'Must', durationMinutes: 45,
    schedule: { kind: 'date-only', date: '2026-08-03', start: null, end: null }
  };
  const route = {
    cabinetId: 'codex-main', platform: 'Codex', cabinetKind: 'permanent', cabinetUrl: null,
    canOpenCabinet: false, cabinetLabel: 'Codex', teacherId: 'codex-main',
    teacherLabel: 'Codex · coding agent', modelHint: 'выберите coding-модель вручную',
    format: 'Практическая лаборатория', resourceUrl: null, warnings: [], reviewer: null
  };
  const controller = SchoolUi.createController({
    api: {
      listLessons: async () => [lesson],
      getLessonContent: async () => ({ lesson, blocks: [] })
    },
    core: loadingCore(), document: ui.document, teacherBridge: SchoolTeacherBridge,
    learningConfig: {},
    learningRoute: {
      resolveLessonRoute: () => route,
      compactRouteLabels: () => ({ desktop: 'Codex · coding agent', mobile: 'Codex' })
    }
  });
  await controller.load();
  await controller.openLesson('lesson-codex');
  assert.equal(ui.nodes.get('schoolTeacherCopy').disabled, false);
  assert.equal(ui.nodes.get('schoolTeacherOpen').disabled, true);
  assert.equal(ui.nodes.get('schoolRouteCabinet').textContent, 'Codex');
  assert.equal(ui.nodes.get('schoolRouteModel').textContent, 'выберите coding-модель вручную');
  assert.equal(ui.nodes.get('schoolTeacherNote').textContent, 'Скопируйте промт и откройте Codex desktop вручную.');
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

test('school shell exposes a global retry for failed notion revalidation', () => {
  const html = read('school.html');
  assert.ok(html.includes('id="schoolSyncBanner"'));
  assert.ok(html.includes('id="schoolSyncMessage"'));
  assert.ok(html.includes('id="schoolSyncRetry"'));
  assert.ok(html.includes('Повторить чтение'));
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

test('timeline drag preview snaps geometry and schedule to the active zoom step', () => {
  const preview = SchoolUi.timelineDragPreview(
    SchoolCore,
    { durationMinutes: 45 },
    '2026-08-03',
    137,
    { top: 10 },
    { startHour: 9 },
    { pixelsPerHour: 120, snapMinutes: 5 }
  );

  assert.equal(preview.destination.start, '2026-08-03T10:05:00+05:00');
  assert.equal(preview.schedule.end, '2026-08-03T10:50:00+05:00');
  assert.equal(preview.top, 130);
  assert.equal(preview.height, 90);
});

test('builds a snapped preview card and line from the destination shown to the user', () => {
  const documentRef = fakeDocument();
  const lesson = {
    title: 'technical reading baseline',
    subject: 'english & ielts'
  };
  const nodes = SchoolUi.makeTimelineDragPreviewNodes(documentRef, lesson, {
    top: 130,
    height: 90,
    schedule: {
      start: '2026-08-03T10:05:00+05:00',
      end: '2026-08-03T10:50:00+05:00'
    }
  });

  assert.equal(nodes.previewNode.className, 'school-time-drag-preview');
  assert.equal(nodes.previewNode.style.top, '130px');
  assert.equal(nodes.previewNode.style.height, '90px');
  assert.equal(nodes.previewNode.children[0].textContent, 'english & ielts');
  assert.equal(nodes.previewNode.children[1].textContent, 'technical reading baseline');
  assert.equal(nodes.previewNode.children[2].textContent, '10:05–10:50');
  assert.equal(nodes.lineNode.className, 'school-time-snap-line');
  assert.equal(nodes.lineNode.style.top, '130px');
});

test('passes a transparent element to the browser drag image contract', () => {
  const dragImageNode = {};
  let received = null;
  const applied = SchoolUi.setTransparentDragImage({
    dataTransfer: {
      setDragImage(node, x, y) {
        received = { node, x, y };
      }
    }
  }, dragImageNode);

  assert.equal(applied, true);
  assert.deepEqual(received, { node: dragImageNode, x: 0, y: 0 });
});

test('drop reuses the snapped destination shown for the same lesson and column', () => {
  const column = {};
  const shownDestination = {
    kind: 'timed',
    start: '2026-08-03T10:05:00+05:00'
  };
  const fallbackDestination = {
    kind: 'timed',
    start: '2026-08-03T10:10:00+05:00'
  };
  const activePreview = {
    node: column,
    lessonId: 'lesson-a',
    destination: shownDestination
  };

  assert.equal(
    SchoolUi.timelineDropDestination(activePreview, column, 'lesson-a', fallbackDestination),
    shownDestination
  );
  assert.equal(
    SchoolUi.timelineDropDestination(activePreview, {}, 'lesson-a', fallbackDestination),
    fallbackDestination
  );
  assert.equal(
    SchoolUi.timelineDropDestination(activePreview, column, 'lesson-b', fallbackDestination),
    fallbackDestination
  );
});

test('short lesson cards keep a compact 44px visual minimum at every zoom level', () => {
  const lesson = {
    id: 'short',
    order: 100,
    schedule: {
      start: '2026-08-03T14:00:00+05:00',
      end: '2026-08-03T14:15:00+05:00'
    }
  };

  [60, 90, 120, 180].forEach((pixelsPerHour) => {
    const layout = SchoolUi.layoutTimedLessons([lesson], pixelsPerHour)[0];
    const visualHeight = (layout.visualEnd - 14 * 60) / 60 * pixelsPerHour;
    assert.ok(visualHeight >= 44, `${pixelsPerHour}px/hour keeps the touch target`);
    assert.ok(visualHeight <= 45, `${pixelsPerHour}px/hour does not inflate the lesson`);
  });
});

test('applies continuous timeline geometry in place without rebuilding the week', () => {
  const shell = {
    attributes: {},
    style: {},
    setAttribute(name, value) {
      this.attributes[name] = String(value);
    }
  };
  const hourLabel = { style: {} };
  const gridLine = { style: {} };
  const lessonCard = { style: {} };
  const result = SchoolUi.applyTimelineGeometry(SchoolCore, {
    shell,
    startMinute: 9 * 60,
    endMinute: 20 * 60,
    labels: [{ node: hourLabel, minute: 10 * 60 }],
    lines: [{ node: gridLine, minute: 9 * 60 + 30 }],
    cards: [{ node: lessonCard, startMinute: 10 * 60, endMinute: 10 * 60 + 45 }]
  }, 1.4);

  assert.deepEqual(result, {
    pixelsPerHour: 84,
    snapMinutes: 10,
    height: 924
  });
  assert.equal(shell.style['--school-time-height'], '924px');
  assert.equal(shell.attributes['data-school-snap'], '10');
  assert.equal(hourLabel.style.top, '84px');
  assert.equal(gridLine.style.top, '42px');
  assert.equal(lessonCard.style.top, '84px');
  assert.equal(lessonCard.style.height, '63px');
});

test('small wheel deltas accumulate into a smooth cursor-anchored zoom', () => {
  let nextFrame = 0;
  const frames = new Map();
  const scrolls = [];
  let shellTop = 10;
  const runtime = {
    requestAnimationFrame(callback) {
      const id = ++nextFrame;
      frames.set(id, callback);
      return id;
    },
    cancelAnimationFrame(id) {
      frames.delete(id);
    },
    scrollBy(x, y) {
      scrolls.push([x, y]);
      shellTop -= y;
    }
  };
  const shell = {
    classList: { add() {}, remove() {} },
    getBoundingClientRect() {
      return { top: shellTop, bottom: shellTop + 600, height: 600 };
    }
  };
  const document = {
    getElementById(id) {
      return id === 'schoolTimeShell' ? shell : null;
    }
  };
  const controller = SchoolUi.createController({
    api: {},
    core: SchoolCore,
    document,
    runtime
  });
  function runNextFrame(timestamp) {
    const [id, callback] = frames.entries().next().value;
    frames.delete(id);
    callback(timestamp);
  }
  function wheel(deltaY) {
    return {
      clientY: 70,
      deltaY,
      prevented: false,
      preventDefault() {
        this.prevented = true;
      }
    };
  }

  const first = wheel(-20);
  const second = wheel(-20);
  const third = wheel(-20);
  controller.handleTimelineWheel(first, shell, { startHour: 9, endHour: 20 });
  controller.handleTimelineWheel(second, shell, { startHour: 9, endHour: 20 });
  assert.equal(frames.size, 0, 'sub-threshold deltas wait for the next wheel event');
  controller.handleTimelineWheel(third, shell, { startHour: 9, endHour: 20 });
  assert.equal(first.prevented, true);
  assert.equal(second.prevented, true);
  assert.equal(third.prevented, true);
  assert.equal(frames.size, 1);
  assert.deepEqual(controller.getTimelineZoomState(), {
    currentScale: 1,
    targetScale: 1.1,
    wheelDelta: 0,
    animating: true
  });

  runNextFrame(0);
  runNextFrame(80);
  assert.ok(controller.getTimelineZoomState().currentScale > 1);
  assert.ok(controller.getTimelineZoomState().currentScale < 1.1);
  runNextFrame(160);
  assert.deepEqual(controller.getTimelineZoomState(), {
    currentScale: 1.1,
    targetScale: 1.1,
    wheelDelta: 0,
    animating: false
  });
  assert.ok(Math.abs(scrolls.reduce((sum, entry) => sum + entry[1], 0) - 6) < 0.001);
});

test('reduced motion applies zoom immediately and drag finalization cancels animation', () => {
  let nextFrame = 0;
  const frames = new Map();
  const shell = {
    classList: { add() {}, remove() {} },
    getBoundingClientRect() {
      return { top: 10, bottom: 610, height: 600 };
    }
  };
  const document = {
    getElementById(id) {
      return id === 'schoolTimeShell' ? shell : null;
    }
  };
  const animated = SchoolUi.createController({
    api: {},
    core: SchoolCore,
    document,
    runtime: {
      requestAnimationFrame(callback) {
        const id = ++nextFrame;
        frames.set(id, callback);
        return id;
      },
      cancelAnimationFrame(id) {
        frames.delete(id);
      },
      scrollBy() {}
    }
  });
  const animatedWheel = {
    clientY: 70,
    deltaY: -60,
    preventDefault() {}
  };
  animated.handleTimelineWheel(animatedWheel, shell, { startHour: 9, endHour: 20 });
  assert.equal(frames.size, 1);
  animated.finishTimelineZoom();
  assert.equal(frames.size, 0);
  assert.equal(animated.getTimelineZoomState().currentScale, 1.1);

  const reduced = SchoolUi.createController({
    api: {},
    core: SchoolCore,
    document,
    runtime: {
      matchMedia() {
        return { matches: true };
      },
      requestAnimationFrame() {
        throw new Error('reduced motion must not schedule a frame');
      },
      scrollBy() {}
    }
  });
  reduced.handleTimelineWheel({
    clientY: 70,
    deltaY: -60,
    preventDefault() {}
  }, shell, { startHour: 9, endHour: 20 });
  assert.equal(reduced.getTimelineZoomState().currentScale, 1.1);
});

test('school styles distinguish quarter ten and five minute lines', () => {
  const css = read('school.css');
  const source = read('school.js');
  assert.ok(css.includes('.school-time-line.is-quarter'));
  assert.ok(css.includes('.school-time-line.is-ten'));
  assert.ok(css.includes('.school-time-line.is-five'));
  assert.ok(css.includes('[data-school-snap="15"]'));
  assert.ok(css.includes('[data-school-snap="10"]'));
  assert.ok(css.includes('[data-school-snap="5"]'));
  assert.ok(css.includes('.school-zoom-controls'));
  assert.match(source, /minute\s*\+=\s*5/);
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

test('all-day drop computes a sparse order before or after the hovered lesson', () => {
  const lessons = [
    {
      id: 'first',
      order: 100,
      status: 'Запланирован',
      schedule: { kind: 'date-only', date: '2026-08-03' }
    },
    {
      id: 'second',
      order: 200,
      status: 'Запланирован',
      schedule: { kind: 'date-only', date: '2026-08-03' }
    },
    {
      id: 'third',
      order: 300,
      status: 'Запланирован',
      schedule: { kind: 'date-only', date: '2026-08-03' }
    }
  ];

  assert.equal(
    SchoolUi.allDayDropPlacement({ top: 100, height: 60 }, 129),
    'before'
  );
  assert.equal(
    SchoolUi.allDayDropPlacement({ top: 100, height: 60 }, 130),
    'after'
  );
  assert.equal(
    SchoolUi.allDayDropOrder(
      SchoolCore,
      lessons,
      '2026-08-03',
      'third',
      'second',
      'before'
    ),
    150
  );
  assert.equal(
    SchoolUi.allDayDropOrder(
      SchoolCore,
      lessons,
      '2026-08-03',
      'first',
      'second',
      'after'
    ),
    250
  );
});

test('all-day drop reorders in place but keeps cross-day and missed transitions explicit', () => {
  const planned = {
    id: 'planned',
    status: 'Запланирован',
    schedule: { kind: 'date-only', date: '2026-08-03' }
  };
  assert.deepEqual(
    SchoolUi.commandForAllDayDrop(planned, '2026-08-03', 150),
    {
      kind: 'command',
      command: {
        operation: 'reorderLesson',
        lessonId: 'planned',
        order: 150
      }
    }
  );
  assert.deepEqual(
    SchoolUi.commandForAllDayDrop(planned, '2026-08-04', 150),
    SchoolUi.commandForDrop(
      planned,
      { kind: 'date-only', date: '2026-08-04' },
      150
    )
  );
  assert.equal(
    SchoolUi.commandForAllDayDrop({
      id: 'missed',
      status: 'Пропущен',
      schedule: { kind: 'date-only', date: '2026-08-03' }
    }, '2026-08-03', 150).kind,
    'restore-confirm'
  );
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
  assert.deepEqual(
    SchoolUi.lessonSignalLabels({
      status: 'Запланирован',
      decisionRequest: null,
      moveCount: 0,
      warnings: []
    }, false, true),
    ['Между уроками нет запланированного перерыва']
  );

  const persisted = [{ id: 'request' }];
  const groups = SchoolUi.partitionDecisionItems({
    persistedDecisions: persisted,
    runtimeIssues: [
      { code: 'overdue-planned' },
      { code: 'multiple-active' },
      { code: 'duration-mismatch' },
      { code: 'overlap' },
      { code: 'short-break', lessonIds: ['first', 'next'], gapMinutes: 4 }
    ]
  });
  assert.deepEqual(groups, {
    importantIssues: [{ code: 'multiple-active' }, { code: 'duration-mismatch' }],
    persisted,
    remainingIssues: [
      { code: 'overdue-planned' },
      { code: 'overlap' },
      { code: 'short-break', lessonIds: ['first', 'next'], gapMinutes: 4 }
    ]
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

test('failed batch revalidation is visible globally and can be retried', async () => {
  const ui = interactiveDocument();
  let listCalls = 0;
  let failRevalidation = true;
  const controller = SchoolUi.createController({
    api: {
      async listLessons() {
        listCalls += 1;
        if (listCalls > 1 && failRevalidation) throw new Error('notion unavailable');
        return [{ id: 'lesson-1', status: 'Запланирован' }];
      },
      async mutate() {
        return { id: 'lesson-1', status: 'Запланирован' };
      }
    },
    core: loadingCore(),
    mutationQueue: SchoolMutationQueue,
    document: ui.document
  });

  await controller.load();
  await controller.runMutation(
    { operation: 'moveLesson', lessonId: 'lesson-1' },
    (lessons) => lessons
  );
  await assert.rejects(controller.whenMutationsIdle(), /notion unavailable/);
  assert.equal(ui.nodes.get('schoolLessonDialog').hidden, true);
  assert.equal(ui.nodes.get('schoolSyncBanner').hidden, false);
  assert.match(ui.nodes.get('schoolSyncMessage').textContent, /контрольное чтение/i);

  failRevalidation = false;
  await controller.retryRevalidation();
  assert.equal(ui.nodes.get('schoolSyncBanner').hidden, true);
  assert.equal(listCalls, 3);
});

test('a stale manual retry cannot overwrite a newer mutation revalidation', async () => {
  const olderRetry = deferred();
  const newerRevalidation = deferred();
  const newerStarted = deferred();
  let listCalls = 0;
  const controller = SchoolUi.createController({
    api: {
      async listLessons() {
        listCalls += 1;
        if (listCalls === 1) return [{ id: 'lesson-1', status: 'Запланирован', version: 0 }];
        if (listCalls === 2) return olderRetry.promise;
        newerStarted.resolve();
        return newerRevalidation.promise;
      },
      async mutate() {
        return { id: 'lesson-1' };
      }
    },
    core: loadingCore(),
    mutationQueue: SchoolMutationQueue,
    document: null
  });

  await controller.load();
  const retry = controller.retryRevalidation();
  await controller.runMutation(
    { operation: 'moveLesson', lessonId: 'lesson-1' },
    (lessons) => lessons
  );
  await newerStarted.promise;
  newerRevalidation.resolve([{ id: 'lesson-1', status: 'Запланирован', version: 1 }]);
  await controller.whenMutationsIdle();
  olderRetry.resolve([{ id: 'lesson-1', status: 'Запланирован', version: 0 }]);
  await retry;

  assert.equal(controller.getLessons()[0].version, 1);
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

test('shows the school shell before the initial notion read resolves', async () => {
  const pending = deferred();
  const ui = interactiveDocument();
  const html = read('school.html');
  const css = read('school.css');
  assert.ok(html.includes('id="schoolLoadingSkeleton"'));
  assert.ok(html.includes('id="schoolLoadingText"'));
  assert.ok(css.includes('@keyframes school-skeleton-pulse'));
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)[\s\S]*\.school-skeleton-card \{ animation: none; \}/);
  const controller = SchoolUi.createController({
    api: { listLessons: () => pending.promise },
    core: loadingCore(),
    mutationQueue: SchoolMutationQueue,
    document: ui.document
  });

  const loading = controller.load();
  assert.equal(ui.nodes.get('schoolReady').hidden, false);
  assert.equal(ui.nodes.get('schoolLoadingSkeleton').hidden, false);
  assert.equal(ui.nodes.get('schoolApp').attributes['aria-busy'], 'true');
  pending.resolve([queueLesson('lesson-1', '09:00')]);
  await loading;
  assert.equal(ui.nodes.get('schoolLoadingSkeleton').hidden, true);
  assert.equal(ui.nodes.get('schoolApp').attributes['aria-busy'], 'false');
});

test('replaces the loading shell with a normalized auth error', async () => {
  const ui = interactiveDocument();
  const controller = SchoolUi.createController({
    api: {
      listLessons: () => Promise.reject(Object.assign(new Error('safe'), { status: 401 }))
    },
    core: loadingCore(),
    mutationQueue: SchoolMutationQueue,
    document: ui.document
  });

  await controller.load();
  assert.equal(ui.nodes.get('schoolLoadingSkeleton').hidden, true);
  assert.equal(ui.nodes.get('schoolReady').hidden, true);
  assert.equal(ui.nodes.get('schoolStateTitle').textContent, 'Нужно войти');
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
  assert.ok(source.includes('school-all-day-drop-before'));
  assert.ok(source.includes('school-all-day-drop-after'));
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
