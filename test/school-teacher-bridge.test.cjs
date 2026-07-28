const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const SchoolTeacherBridge = require('../school-teacher-bridge.js');

function lesson(overrides = {}) {
  return {
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
    week: 'W01 · 3–9 августа 2026',
    durationMinutes: 45,
    ...overrides
  };
}

function span(text) {
  return {
    annotations: {
      bold: false,
      code: false,
      color: 'default',
      italic: false,
      strikethrough: false,
      underline: false
    },
    link: null,
    text
  };
}

function richBlock(type, text, children = []) {
  return { type, spans: [span(text)], children };
}

function resultBlock(lines) {
  return [
    '=== LESSON RESULT ===',
    ...lines,
    '=== END LESSON RESULT ==='
  ].join('\n');
}

test('teacher config exposes six exact subjects with empty urls', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '..', 'school-teacher-config.js'),
    'utf8'
  );
  const context = { window: {} };
  vm.runInNewContext(source, context);

  assert.deepEqual(
    Object.keys(context.window.SchoolTeacherConfig),
    [
      'Software Engineering',
      'DevOps & Infrastructure',
      'Mathematics',
      'English & IELTS',
      'University',
      'Director & Assessment'
    ]
  );
  assert.deepEqual(
    Object.values(context.window.SchoolTeacherConfig).map((item) => item.url),
    ['', '', '', '', '', '']
  );
  assert.equal(Object.isFrozen(context.window.SchoolTeacherConfig), true);
  assert.equal(
    Object.values(context.window.SchoolTeacherConfig)
      .every((item) => Object.isFrozen(item)),
    true
  );
});

test('teacher url accepts only absolute chatgpt https hosts', () => {
  assert.deepEqual(
    SchoolTeacherBridge.resolveTeacher({
      label: 'преподаватель',
      url: 'https://chatgpt.com/g/g-123'
    }),
    {
      configured: true,
      label: 'преподаватель',
      url: 'https://chatgpt.com/g/g-123'
    }
  );
  assert.equal(
    SchoolTeacherBridge.resolveTeacher({
      label: 'преподаватель',
      url: 'https://chat.openai.com/c/123'
    }).configured,
    true
  );

  [
    '',
    '/relative',
    'http://chatgpt.com/g/g-123',
    'https://example.com/g/g-123',
    'javascript:alert(1)',
    'https://user:password@chatgpt.com/g/g-123'
  ].forEach((url) => {
    assert.equal(
      SchoolTeacherBridge.resolveTeacher({ label: 'преподаватель', url }).configured,
      false,
      url
    );
  });
});

test('prompt contains lesson metadata, readable assignment and exact result contract', () => {
  const blocks = [
    richBlock('heading_2', 'Цель'),
    richBlock('paragraph', 'Получить воспроизводимый запуск.'),
    richBlock('heading_2', 'Задание'),
    richBlock('numbered_list_item', 'Создать учебную копию.'),
    richBlock('numbered_list_item', 'Запустить проект.'),
    richBlock('heading_2', 'Критерий выполнения'),
    richBlock('paragraph', 'Проект запускается по инструкции.')
  ];

  const prompt = SchoolTeacherBridge.buildLessonTeacherPrompt(lesson(), blocks);

  assert.match(prompt, /^=== PERSONAL SCHOOL LESSON ===/);
  assert.match(prompt, /LESSON_REF: lesson-42/);
  assert.match(prompt, /SUBJECT: Software Engineering/);
  assert.match(prompt, /TITLE: Cold start «Прометея»/);
  assert.match(prompt, /DURATION_MINUTES: 45/);
  assert.match(prompt, /SCHEDULE: 3 августа 2026 · без точного времени/);
  assert.match(prompt, /ЦЕЛЬ\nПолучить воспроизводимый запуск\./);
  assert.match(prompt, /ЗАДАНИЕ\n1\. Создать учебную копию\.\n2\. Запустить проект\./);
  assert.match(prompt, /КРИТЕРИЙ ВЫПОЛНЕНИЯ\nПроект запускается по инструкции\./);
  assert.match(prompt, /=== LESSON RESULT ===/);
  assert.match(prompt, /STATUS: Выполнен/);
  assert.match(prompt, /=== END LESSON RESULT ===/);
  assert.match(prompt, /=== END PERSONAL SCHOOL LESSON ===$/);
});

test('prompt omits empty metadata and empty content sections', () => {
  const prompt = SchoolTeacherBridge.buildLessonTeacherPrompt(
    lesson({ module: '', priority: '' }),
    [
      richBlock('heading_2', 'Цель'),
      richBlock('paragraph', '   '),
      richBlock('heading_2', 'Задание'),
      richBlock('paragraph', 'Проверить запуск.')
    ]
  );

  assert.doesNotMatch(prompt, /^MODULE:/m);
  assert.doesNotMatch(prompt, /^PRIORITY:/m);
  assert.doesNotMatch(prompt, /\nЦЕЛЬ\n/);
  assert.match(prompt, /\nЗАДАНИЕ\nПроверить запуск\./);
});

test('prompt recursively renders normalized blocks without raw notion data', () => {
  const prompt = SchoolTeacherBridge.buildLessonTeacherPrompt(lesson(), [
    richBlock('toggle', 'Подсказка', [
      { type: 'to_do', checked: true, spans: [span('Проверить env')], children: [] }
    ]),
    {
      type: 'table',
      tableWidth: 2,
      hasColumnHeader: true,
      hasRowHeader: false,
      children: [{
        type: 'table_row',
        cells: [[span('Команда')], [span('Результат')]],
        children: []
      }]
    },
    {
      type: 'bookmark',
      caption: [span('Документация')],
      children: [],
      label: 'Документация',
      url: 'https://example.com/docs'
    }
  ]);

  assert.match(prompt, /Подсказка/);
  assert.match(prompt, /\[x\] Проверить env/);
  assert.match(prompt, /Команда \| Результат/);
  assert.match(prompt, /Документация — https:\/\/example\.com\/docs/);
  assert.doesNotMatch(prompt, /notion_token|service_role|raw_payload/i);
});

test('prompt can still be built when teacher url is empty', () => {
  const teacher = SchoolTeacherBridge.resolveTeacher({
    label: 'преподаватель',
    url: ''
  });
  const prompt = SchoolTeacherBridge.buildLessonTeacherPrompt(lesson(), []);

  assert.equal(teacher.configured, false);
  assert.match(prompt, /LESSON_REF: lesson-42/);
});

test('completion request keeps the current lesson reference', () => {
  assert.match(
    SchoolTeacherBridge.buildLessonCompletionRequest(lesson()),
    /LESSON_REF lesson-42/
  );
});

test('parses a correct completed result', () => {
  const parsed = SchoolTeacherBridge.parseLessonResultBlock(resultBlock([
    'LESSON_REF: lesson-42',
    'STATUS: Выполнен',
    'RESULT: Зачёт',
    'AUTONOMY: A2',
    'UNDERSTANDING: 2',
    'COMMENT: Запустил проект и зафиксировал команды.',
    'ARTIFACT: https://example.com/setup',
    'MISSED_REASON:'
  ]), 'lesson-42');

  assert.equal(parsed.canApply, true);
  assert.deepEqual(parsed.errors, []);
  assert.deepEqual(parsed.values, {
    lessonId: 'lesson-42',
    status: 'Выполнен',
    result: 'Зачёт',
    autonomy: 'A2',
    understanding: 2,
    comment: 'Запустил проект и зафиксировал команды.',
    artifactUrl: 'https://example.com/setup',
    missedReason: null
  });
});

test('parses a correct partial result and forces repetition', () => {
  const parsed = SchoolTeacherBridge.parseLessonResultBlock(resultBlock([
    'lesson_ref: lesson-42',
    'status: Частично выполнен',
    'result: Незачёт',
    'autonomy: A1',
    'understanding: 1',
    'comment: Требуется повторить запуск.',
    'artifact:',
    'missed_reason:'
  ]), 'lesson-42');

  assert.equal(parsed.canApply, true);
  assert.equal(parsed.values.result, 'Требует повторения');
  assert.ok(parsed.warnings.some((warning) => warning.code === 'partial-result-overridden'));
});

test('parses a correct missed result and clears assessment values', () => {
  const parsed = SchoolTeacherBridge.parseLessonResultBlock(resultBlock([
    'LESSON_REF: lesson-42',
    'STATUS: Пропущен',
    'RESULT: Зачёт',
    'AUTONOMY: A3',
    'UNDERSTANDING: 3',
    'COMMENT: Не удалось начать.',
    'ARTIFACT:',
    'MISSED_REASON: Техническая проблема'
  ]), 'lesson-42');

  assert.equal(parsed.canApply, true);
  assert.equal(parsed.values.result, null);
  assert.equal(parsed.values.autonomy, null);
  assert.equal(parsed.values.understanding, null);
  assert.ok(parsed.warnings.some((warning) => warning.code === 'missed-assessment-cleared'));
});

test('missed artifact requires an explicit confirmation before apply', () => {
  const parsed = SchoolTeacherBridge.parseLessonResultBlock(resultBlock([
    'LESSON_REF: lesson-42',
    'STATUS: Пропущен',
    'RESULT:',
    'AUTONOMY:',
    'UNDERSTANDING:',
    'COMMENT: Сохранился диагностический лог.',
    'ARTIFACT: https://example.com/log',
    'MISSED_REASON: Техническая проблема'
  ]), 'lesson-42');

  assert.equal(parsed.canApply, true);
  assert.equal(parsed.values.artifactUrl, 'https://example.com/log');
  assert.equal(parsed.requiresArtifactConfirmation, true);
});

test('reports missing result markers', () => {
  const parsed = SchoolTeacherBridge.parseLessonResultBlock(
    'LESSON_REF: lesson-42\nSTATUS: Выполнен',
    'lesson-42'
  );

  assert.equal(parsed.canApply, false);
  assert.ok(parsed.errors.some((error) => error.code === 'markers-missing'));
});

test('rejects a result for another lesson', () => {
  const parsed = SchoolTeacherBridge.parseLessonResultBlock(resultBlock([
    'LESSON_REF: lesson-other',
    'STATUS: Выполнен',
    'RESULT: Зачёт',
    'AUTONOMY: A2',
    'UNDERSTANDING: 2'
  ]), 'lesson-42');

  assert.equal(parsed.canApply, false);
  assert.ok(parsed.errors.some((error) =>
    error.message === 'Этот итог относится к другому уроку'
  ));
});

test('duplicate keys are errors while unknown keys are warnings', () => {
  const parsed = SchoolTeacherBridge.parseLessonResultBlock(resultBlock([
    'LESSON_REF: lesson-42',
    'STATUS: Выполнен',
    'STATUS: Выполнен',
    'RESULT: Зачёт',
    'AUTONOMY: A2',
    'UNDERSTANDING: 2',
    'SCORE: 99'
  ]), 'lesson-42');

  assert.equal(parsed.canApply, false);
  assert.ok(parsed.errors.some((error) => error.code === 'duplicate-key'));
  assert.ok(parsed.warnings.some((warning) => warning.code === 'unknown-key'));
});

test('splits values on the first colon only', () => {
  const parsed = SchoolTeacherBridge.parseLessonResultBlock(resultBlock([
    'LESSON_REF: lesson-42',
    'STATUS: Выполнен',
    'RESULT: Зачёт',
    'AUTONOMY: A2',
    'UNDERSTANDING: 2',
    'COMMENT: Причина: неверная переменная окружения'
  ]), 'lesson-42');

  assert.equal(parsed.values.comment, 'Причина: неверная переменная окружения');
});

test('rejects invalid status, result, autonomy and understanding', () => {
  const cases = [
    ['STATUS', 'Готово', 'invalid-status'],
    ['RESULT', 'Отлично', 'invalid-result'],
    ['AUTONOMY', 'A4', 'invalid-autonomy'],
    ['UNDERSTANDING', '2.5', 'invalid-understanding']
  ];

  cases.forEach(([key, value, errorCode]) => {
    const fields = {
      LESSON_REF: 'lesson-42',
      STATUS: 'Выполнен',
      RESULT: 'Зачёт',
      AUTONOMY: 'A2',
      UNDERSTANDING: '2'
    };
    fields[key] = value;
    const parsed = SchoolTeacherBridge.parseLessonResultBlock(
      resultBlock(Object.entries(fields).map(([name, fieldValue]) =>
        `${name}: ${fieldValue}`
      )),
      'lesson-42'
    );

    assert.equal(parsed.canApply, false, key);
    assert.ok(parsed.errors.some((error) => error.code === errorCode), key);
  });
});

test('completed result defaults to credit with a visible warning', () => {
  const parsed = SchoolTeacherBridge.parseLessonResultBlock(resultBlock([
    'LESSON_REF: lesson-42',
    'STATUS: Выполнен',
    'RESULT:',
    'AUTONOMY: A2',
    'UNDERSTANDING: 2'
  ]), 'lesson-42');

  assert.equal(parsed.canApply, true);
  assert.equal(parsed.values.result, 'Зачёт');
  assert.ok(parsed.warnings.some((warning) => warning.code === 'completed-result-defaulted'));
});

test('missing status-specific fields are reported beside their fields', () => {
  const completed = SchoolTeacherBridge.parseLessonResultBlock(resultBlock([
    'LESSON_REF: lesson-42',
    'STATUS: Выполнен'
  ]), 'lesson-42');
  const missed = SchoolTeacherBridge.parseLessonResultBlock(resultBlock([
    'LESSON_REF: lesson-42',
    'STATUS: Пропущен'
  ]), 'lesson-42');

  assert.deepEqual(
    completed.errors.filter((error) => error.code === 'required-field')
      .map((error) => error.field),
    ['autonomy', 'understanding']
  );
  assert.deepEqual(
    missed.errors.filter((error) => error.code === 'required-field')
      .map((error) => error.field),
    ['missedReason']
  );
});

test('artifact accepts only absolute https urls up to 2048 characters', () => {
  [
    'http://example.com/file',
    'file:///tmp/report',
    'javascript:alert(1)',
    '/relative/path',
    `https://example.com/${'a'.repeat(2030)}`
  ].forEach((artifact) => {
    const parsed = SchoolTeacherBridge.parseLessonResultBlock(resultBlock([
      'LESSON_REF: lesson-42',
      'STATUS: Выполнен',
      'RESULT: Зачёт',
      'AUTONOMY: A2',
      'UNDERSTANDING: 2',
      `ARTIFACT: ${artifact}`
    ]), 'lesson-42');

    assert.equal(parsed.canApply, false, artifact.slice(0, 40));
    assert.ok(parsed.errors.some((error) => error.code === 'invalid-artifact'));
  });

  const valid = SchoolTeacherBridge.parseLessonResultBlock(resultBlock([
    'LESSON_REF: lesson-42',
    'STATUS: Выполнен',
    'RESULT: Зачёт',
    'AUTONOMY: A2',
    'UNDERSTANDING: 2',
    'ARTIFACT: https://example.com/file'
  ]), 'lesson-42');
  assert.equal(valid.canApply, true);
});

test('comment limit counts unicode code points and never truncates', () => {
  const acceptedComment = '🙂'.repeat(1000);
  const rejectedComment = `${acceptedComment}🙂`;
  const accepted = SchoolTeacherBridge.parseLessonResultBlock(resultBlock([
    'LESSON_REF: lesson-42',
    'STATUS: Выполнен',
    'RESULT: Зачёт',
    'AUTONOMY: A2',
    'UNDERSTANDING: 2',
    `COMMENT: ${acceptedComment}`
  ]), 'lesson-42');
  const rejected = SchoolTeacherBridge.parseLessonResultBlock(resultBlock([
    'LESSON_REF: lesson-42',
    'STATUS: Выполнен',
    'RESULT: Зачёт',
    'AUTONOMY: A2',
    'UNDERSTANDING: 2',
    `COMMENT: ${rejectedComment}`
  ]), 'lesson-42');

  assert.equal(accepted.canApply, true);
  assert.equal(accepted.values.comment, acceptedComment);
  assert.equal(rejected.canApply, false);
  assert.equal(rejected.values.comment, rejectedComment);
  assert.ok(rejected.errors.some((error) => error.code === 'comment-too-long'));
});

test('parser preserves html as inert text', () => {
  const parsed = SchoolTeacherBridge.parseLessonResultBlock(resultBlock([
    'LESSON_REF: lesson-42',
    'STATUS: Выполнен',
    'RESULT: Зачёт',
    'AUTONOMY: A2',
    'UNDERSTANDING: 2',
    'COMMENT: <img src=x onerror=alert(1)>'
  ]), 'lesson-42');

  assert.equal(parsed.values.comment, '<img src=x onerror=alert(1)>');
});

test('parser ignores text outside markers and reports it', () => {
  const parsed = SchoolTeacherBridge.parseLessonResultBlock([
    'Вот мой комментарий до блока.',
    resultBlock([
      'LESSON_REF: lesson-42',
      'STATUS: Выполнен',
      'RESULT: Зачёт',
      'AUTONOMY: A2',
      'UNDERSTANDING: 2'
    ]),
    'Этот текст после блока тоже не используется.'
  ].join('\n'), 'lesson-42');

  assert.equal(parsed.canApply, true);
  assert.ok(parsed.warnings.some((warning) => warning.code === 'outside-text-ignored'));
  assert.equal(Object.values(parsed.values).includes('Вот мой комментарий до блока.'), false);
});

