(function (root, factory) {
  'use strict';

  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.SchoolTeacherBridge = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var RESULT_START = '=== LESSON RESULT ===';
  var RESULT_END = '=== END LESSON RESULT ===';
  var KNOWN_KEYS = Object.freeze([
    'LESSON_REF',
    'STATUS',
    'RESULT',
    'AUTONOMY',
    'UNDERSTANDING',
    'COMMENT',
    'ARTIFACT',
    'MISSED_REASON'
  ]);
  var STATUSES = Object.freeze([
    'Выполнен',
    'Частично выполнен',
    'Пропущен'
  ]);
  var RESULTS = Object.freeze([
    'Зачёт',
    'Незачёт',
    'Требует повторения'
  ]);
  var AUTONOMIES = Object.freeze(['A0', 'A1', 'A2', 'A3']);
  var MISSED_REASONS = Object.freeze([
    'Внешние обстоятельства',
    'Ошибка планирования',
    'Низкая энергия',
    'Избегание сложной задачи',
    'Задача слишком большая',
    'Техническая проблема'
  ]);
  var MONTHS = Object.freeze([
    'января',
    'февраля',
    'марта',
    'апреля',
    'мая',
    'июня',
    'июля',
    'августа',
    'сентября',
    'октября',
    'ноября',
    'декабря'
  ]);

  function text(value) {
    return typeof value === 'string' ? value.trim() : '';
  }

  function unicodeLength(value) {
    return Array.from(typeof value === 'string' ? value : '').length;
  }

  function spansText(spans) {
    if (!Array.isArray(spans)) return '';
    return spans.map(function (item) {
      return item && typeof item.text === 'string' ? item.text : '';
    }).join('').trim();
  }

  function isSafeHttpsUrl(value, allowedHosts) {
    var raw = text(value);
    if (!raw) return false;
    try {
      var parsed = new URL(raw);
      if (
        parsed.protocol !== 'https:' ||
        parsed.username ||
        parsed.password ||
        !parsed.hostname
      ) return false;
      return !allowedHosts || allowedHosts.indexOf(parsed.hostname) !== -1;
    } catch (_error) {
      return false;
    }
  }

  function resolveTeacher(configEntry) {
    var entry = configEntry && typeof configEntry === 'object'
      ? configEntry
      : {};
    var label = text(entry.label) || 'Преподаватель';
    var rawUrl = text(entry.url);
    var configured = rawUrl.length > 0 && isSafeHttpsUrl(
      rawUrl,
      ['chatgpt.com', 'chat.openai.com']
    );
    return {
      configured: configured,
      label: label,
      url: configured ? rawUrl : null
    };
  }

  function renderReference(block) {
    var label = text(block.label) || spansText(block.caption);
    var url = isSafeHttpsUrl(block.url) ? text(block.url) : '';
    if (label && url) return label + ' — ' + url;
    return label || url;
  }

  function renderBlock(block, depth) {
    if (!block || typeof block !== 'object') return '';
    var type = text(block.type);
    var content = spansText(block.spans);
    var prefix = '';
    var suffix = '';

    if (type === 'bulleted_list_item') prefix = '- ';
    if (type === 'to_do') prefix = block.checked ? '[x] ' : '[ ] ';
    if (type === 'quote') prefix = '> ';
    if (type === 'callout') prefix = 'Важно: ';
    if (type === 'equation') content = text(block.expression);
    if (type === 'divider') content = '---';
    if (type === 'table_row') {
      content = Array.isArray(block.cells)
        ? block.cells.map(spansText).filter(Boolean).join(' | ')
        : '';
    }
    if (type === 'code') {
      content = spansText(block.spans);
      if (content) {
        prefix = 'Код' + (text(block.language) ? ' (' + text(block.language) + ')' : '') + ':\n';
      }
    }
    if ([
      'bookmark',
      'link_preview',
      'image',
      'file',
      'pdf',
      'video',
      'audio',
      'embed'
    ].indexOf(type) !== -1) {
      content = renderReference(block);
    }
    if (type === 'unsupported') content = text(block.label);

    var children = renderBlockSequence(block.children, depth + 1);
    if (children) {
      suffix = (content ? '\n' : '') + children.split('\n').map(function (line) {
        return line ? '  ' + line : line;
      }).join('\n');
    }
    return (prefix + content + suffix).trim();
  }

  function renderBlockSequence(blocks, depth) {
    if (!Array.isArray(blocks)) return '';
    var lines = [];
    var numberedIndex = 0;
    blocks.forEach(function (block) {
      if (!block || typeof block !== 'object') return;
      if (block.type === 'numbered_list_item') {
        numberedIndex += 1;
        var numbered = renderBlock(block, depth);
        if (numbered) lines.push(numberedIndex + '. ' + numbered);
        return;
      }
      numberedIndex = 0;
      var rendered = renderBlock(block, depth);
      if (rendered) lines.push(rendered);
    });
    return lines.join('\n');
  }

  function contentBlocksToText(blocks) {
    if (!Array.isArray(blocks)) return '';
    var sections = [];
    var preface = [];
    var current = null;

    function flushCurrent() {
      if (!current) return;
      var body = renderBlockSequence(current.blocks, 0);
      if (body) sections.push(current.title + '\n' + body);
      current = null;
    }

    blocks.forEach(function (block) {
      var type = block && text(block.type);
      if (/^heading_[1-4]$/.test(type)) {
        flushCurrent();
        var heading = spansText(block.spans).toLocaleUpperCase('ru-RU');
        current = { title: heading, blocks: [] };
        if (Array.isArray(block.children) && block.children.length) {
          current.blocks = current.blocks.concat(block.children);
        }
        return;
      }
      if (current) current.blocks.push(block);
      else preface.push(block);
    });
    flushCurrent();

    var prefaceText = renderBlockSequence(preface, 0);
    if (prefaceText) sections.unshift(prefaceText);
    return sections.join('\n\n');
  }

  function formatDate(dateValue) {
    var raw = text(dateValue);
    var match = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!match) return '';
    var month = MONTHS[Number(match[2]) - 1];
    if (!month) return '';
    return Number(match[3]) + ' ' + month + ' ' + match[1];
  }

  function formatSchedule(schedule) {
    if (!schedule || typeof schedule !== 'object') return 'не назначено';
    if (schedule.kind === 'unscheduled') return 'не назначено';
    var date = formatDate(schedule.date);
    if (schedule.kind === 'date-only') {
      return (date || 'дата не определена') + ' · без точного времени';
    }
    if (schedule.kind === 'timed') {
      var start = text(schedule.start).slice(11, 16);
      var end = text(schedule.end).slice(11, 16);
      var timeRange = start && end ? start + '–' + end : 'время не определено';
      return (date || 'дата не определена') + ' · ' + timeRange;
    }
    return 'не назначено';
  }

  function resultContract(lessonId) {
    return [
      'ФОРМАТ ИТОГА',
      '',
      'Верни блок с тем же LESSON_REF:',
      '',
      RESULT_START,
      'LESSON_REF: ' + lessonId,
      'STATUS: Выполнен',
      'RESULT: Зачёт',
      'AUTONOMY: A2',
      'UNDERSTANDING: 2',
      'COMMENT: Кратко: что сделал, главная ошибка или пробел, что делать дальше.',
      'ARTIFACT:',
      'MISSED_REASON:',
      RESULT_END,
      '',
      'Разрешённые значения:',
      '',
      'STATUS:',
      '- Выполнен',
      '- Частично выполнен',
      '- Пропущен',
      '',
      'RESULT:',
      '- Зачёт',
      '- Незачёт',
      '- Требует повторения',
      '',
      'AUTONOMY:',
      '- A0',
      '- A1',
      '- A2',
      '- A3',
      '',
      'UNDERSTANDING:',
      '- 0',
      '- 1',
      '- 2',
      '- 3',
      '',
      'Для «Выполнен»:',
      '- RESULT обязателен;',
      '- AUTONOMY обязателен;',
      '- UNDERSTANDING обязателен.',
      '',
      'Для «Частично выполнен»:',
      '- RESULT всегда «Требует повторения»;',
      '- AUTONOMY обязателен;',
      '- UNDERSTANDING обязателен.',
      '',
      'Для «Пропущен»:',
      '- MISSED_REASON обязателен;',
      '- RESULT оставить пустым;',
      '- AUTONOMY оставить пустым;',
      '- UNDERSTANDING оставить пустым.',
      '',
      'COMMENT:',
      '- одна компактная строка;',
      '- максимум 1000 Unicode code points;',
      '- без переносов строк внутри значения;',
      '- должна содержать полезную информацию для недельной ревизии директора.',
      '',
      'ARTIFACT:',
      '- необязательный абсолютный HTTPS URL;',
      '- если артефакта нет, оставить пустым.',
      '',
      'Не добавляй поля, которых нет в формате.',
      'Не оборачивай итоговый блок в Markdown code fence.',
      'Не добавляй текст после END LESSON RESULT.'
    ].join('\n');
  }

  function buildLessonTeacherPrompt(lesson, contentBlocks) {
    var item = lesson && typeof lesson === 'object' ? lesson : {};
    var lessonId = text(item.id);
    var metadata = [
      'LESSON_REF: ' + lessonId,
      text(item.subject) ? 'SUBJECT: ' + text(item.subject) : '',
      text(item.title) ? 'TITLE: ' + text(item.title) : '',
      text(item.module) ? 'MODULE: ' + text(item.module) : '',
      Number.isInteger(item.durationMinutes)
        ? 'DURATION_MINUTES: ' + item.durationMinutes
        : '',
      'SCHEDULE: ' + formatSchedule(item.schedule),
      text(item.priority) ? 'PRIORITY: ' + text(item.priority) : ''
    ].filter(Boolean).join('\n');
    var assignment = contentBlocksToText(contentBlocks);
    var teacherRules = [
      'ПРАВИЛА ПРЕПОДАВАТЕЛЯ',
      '',
      '1. Веди занятие преимущественно сократовски.',
      '2. Сначала запроси мою самостоятельную попытку.',
      '3. Не выдавай полный ответ немедленно.',
      '4. Диагностируй конкретный пробел.',
      '5. Дай минимальную необходимую модель или подсказку.',
      '6. После объяснения обязательно запроси повторную попытку.',
      '7. Не расширяй тему за пределы текущего урока.',
      '8. Не уходи на фундаментальный уровень без доказанной необходимости.',
      '9. Ориентируйся на длительность занятия DURATION_MINUTES.',
      '10. Практический результат важнее количества объяснённой теории.',
      '11. Когда я напишу «Завершаем урок», оцени фактическую работу.',
      '12. В конце верни специальный блок строго установленного формата.',
      '13. До запроса завершения не выводи итоговый блок.',
      '',
      'ШКАЛА АВТОНОМНОСТИ',
      '',
      'A0 — не смог начать даже с направлением.',
      'A1 — выполнял в основном под пошаговым управлением ИИ.',
      'A2 — справился с документацией и точечными вопросами.',
      'A3 — справился самостоятельно и способен повторить навык.',
      '',
      'ШКАЛА ПОНИМАНИЯ',
      '',
      '0 — не могу объяснить.',
      '1 — узнаю термины и повторяю формулировку.',
      '2 — могу причинно объяснить и применить в типовой задаче.',
      '3 — могу перенести понимание на новую ситуацию.'
    ].join('\n');

    return [
      '=== PERSONAL SCHOOL LESSON ===',
      '',
      metadata,
      assignment,
      teacherRules,
      resultContract(lessonId),
      '=== END PERSONAL SCHOOL LESSON ==='
    ].filter(Boolean).join('\n\n');
  }

  function buildLessonCompletionRequest(lesson) {
    var lessonId = text(lesson && lesson.id);
    return [
      'Завершаем урок.',
      '',
      'Оцени только фактически выполненную мной работу и верни итог строго в формате === LESSON RESULT ===, который был указан в стартовом промте.',
      '',
      'Обязательно:',
      '- сохрани тот же LESSON_REF ' + lessonId + ';',
      '- не завышай автономность;',
      '- отделяй факт выполнения от ощущения понимания;',
      '- COMMENT сделай одной компактной строкой для недельной ревизии директора;',
      '- не добавляй Markdown code fence;',
      '- не пиши ничего после === END LESSON RESULT ===.'
    ].join('\n');
  }

  function issue(code, message, field) {
    var result = { code: code, message: message };
    if (field) result.field = field;
    return result;
  }

  function parseRawFields(blockText, warnings, errors) {
    var fields = {};
    var seen = {};
    blockText.split(/\r?\n/).forEach(function (line) {
      if (!line.trim()) return;
      var separator = line.indexOf(':');
      if (separator === -1) {
        warnings.push(issue(
          'unknown-line',
          'Строка без ключа проигнорирована'
        ));
        return;
      }
      var key = line.slice(0, separator).trim().toUpperCase();
      var value = line.slice(separator + 1).trim();
      if (!key) {
        warnings.push(issue('unknown-key', 'Пустой ключ проигнорирован'));
        return;
      }
      if (seen[key]) {
        errors.push(issue(
          'duplicate-key',
          'Ключ ' + key + ' указан несколько раз',
          key.toLowerCase()
        ));
        return;
      }
      seen[key] = true;
      if (KNOWN_KEYS.indexOf(key) === -1) {
        warnings.push(issue(
          'unknown-key',
          'Неизвестный ключ ' + key + ' проигнорирован'
        ));
        return;
      }
      fields[key] = value;
    });
    return fields;
  }

  function parseLessonResultBlock(value, expectedLessonId) {
    var source = typeof value === 'string' ? value : '';
    var warnings = [];
    var errors = [];
    var values = {
      lessonId: null,
      status: null,
      result: null,
      autonomy: null,
      understanding: null,
      comment: '',
      artifactUrl: null,
      missedReason: null
    };
    var start = source.indexOf(RESULT_START);
    var end = start === -1 ? -1 : source.indexOf(RESULT_END, start + RESULT_START.length);
    if (start === -1 || end === -1 || end < start) {
      errors.push(issue(
        'markers-missing',
        'Не найден блок LESSON RESULT'
      ));
      return {
        canApply: false,
        canApplyToForm: false,
        errors: errors,
        requiresArtifactConfirmation: false,
        values: values,
        warnings: warnings
      };
    }

    var before = source.slice(0, start).trim();
    var after = source.slice(end + RESULT_END.length).trim();
    if (before || after) {
      warnings.push(issue(
        'outside-text-ignored',
        'Текст вне блока LESSON RESULT проигнорирован'
      ));
    }
    var blockText = source.slice(start + RESULT_START.length, end);
    var fields = parseRawFields(blockText, warnings, errors);

    var lessonRef = text(fields.LESSON_REF);
    if (!lessonRef) {
      errors.push(issue('required-field', 'LESSON_REF обязателен', 'lessonId'));
    } else if (lessonRef !== text(expectedLessonId)) {
      errors.push(issue(
        'lesson-ref-mismatch',
        'Этот итог относится к другому уроку',
        'lessonId'
      ));
    }
    values.lessonId = lessonRef || null;

    var status = text(fields.STATUS);
    if (!status) {
      errors.push(issue('required-field', 'STATUS обязателен', 'status'));
    } else if (STATUSES.indexOf(status) === -1) {
      errors.push(issue('invalid-status', 'Недопустимый STATUS', 'status'));
    } else {
      values.status = status;
    }

    var rawResult = text(fields.RESULT);
    if (rawResult && RESULTS.indexOf(rawResult) === -1) {
      errors.push(issue('invalid-result', 'Недопустимый RESULT', 'result'));
    } else if (rawResult) {
      values.result = rawResult;
    }

    var rawAutonomy = text(fields.AUTONOMY);
    if (rawAutonomy && AUTONOMIES.indexOf(rawAutonomy) === -1) {
      errors.push(issue('invalid-autonomy', 'Недопустимая AUTONOMY', 'autonomy'));
    } else if (rawAutonomy) {
      values.autonomy = rawAutonomy;
    }

    var rawUnderstanding = text(fields.UNDERSTANDING);
    if (rawUnderstanding && !/^[0-3]$/.test(rawUnderstanding)) {
      errors.push(issue(
        'invalid-understanding',
        'UNDERSTANDING должен быть целым числом от 0 до 3',
        'understanding'
      ));
    } else if (rawUnderstanding) {
      values.understanding = Number(rawUnderstanding);
    }

    values.comment = text(fields.COMMENT);
    if (unicodeLength(values.comment) > 1000) {
      errors.push(issue(
        'comment-too-long',
        'Комментарий длиннее 1000 Unicode code points',
        'comment'
      ));
    }

    var rawArtifact = text(fields.ARTIFACT);
    if (rawArtifact) {
      if (rawArtifact.length > 2048 || !isSafeHttpsUrl(rawArtifact)) {
        errors.push(issue(
          'invalid-artifact',
          'Артефакт должен быть абсолютным HTTPS URL длиной не более 2048 символов',
          'artifactUrl'
        ));
      } else {
        values.artifactUrl = rawArtifact;
      }
    }

    var rawMissedReason = text(fields.MISSED_REASON);
    if (rawMissedReason && MISSED_REASONS.indexOf(rawMissedReason) === -1) {
      errors.push(issue(
        'invalid-missed-reason',
        'Недопустимая причина пропуска',
        'missedReason'
      ));
    } else if (rawMissedReason) {
      values.missedReason = rawMissedReason;
    }

    if (values.status === 'Выполнен') {
      if (!rawResult) {
        values.result = 'Зачёт';
        warnings.push(issue(
          'completed-result-defaulted',
          'RESULT отсутствовал: предложено значение «Зачёт»',
          'result'
        ));
      }
      if (!values.autonomy) {
        errors.push(issue(
          'required-field',
          'AUTONOMY обязательна для выполненного урока',
          'autonomy'
        ));
      }
      if (values.understanding === null) {
        errors.push(issue(
          'required-field',
          'UNDERSTANDING обязателен для выполненного урока',
          'understanding'
        ));
      }
      values.missedReason = null;
    }

    if (values.status === 'Частично выполнен') {
      if (values.result && values.result !== 'Требует повторения') {
        warnings.push(issue(
          'partial-result-overridden',
          'Для частично выполненного урока RESULT заменён на «Требует повторения»',
          'result'
        ));
      }
      values.result = 'Требует повторения';
      if (!values.autonomy) {
        errors.push(issue(
          'required-field',
          'AUTONOMY обязательна для частично выполненного урока',
          'autonomy'
        ));
      }
      if (values.understanding === null) {
        errors.push(issue(
          'required-field',
          'UNDERSTANDING обязателен для частично выполненного урока',
          'understanding'
        ));
      }
      values.missedReason = null;
    }

    if (values.status === 'Пропущен') {
      if (values.result || values.autonomy || values.understanding !== null) {
        warnings.push(issue(
          'missed-assessment-cleared',
          'Оценочные поля очищены для пропущенного урока'
        ));
      }
      values.result = null;
      values.autonomy = null;
      values.understanding = null;
      if (!values.missedReason) {
        errors.push(issue(
          'required-field',
          'MISSED_REASON обязателен для пропущенного урока',
          'missedReason'
        ));
      }
    }

    return {
      canApply: errors.length === 0,
      canApplyToForm: Boolean(values.status) && !errors.some(function (error) {
        return [
          'markers-missing',
          'lesson-ref-mismatch',
          'duplicate-key',
          'invalid-status'
        ].indexOf(error.code) !== -1 ||
          error.code === 'required-field' &&
          (error.field === 'lessonId' || error.field === 'status');
      }),
      errors: errors,
      requiresArtifactConfirmation: (
        values.status === 'Пропущен' && Boolean(values.artifactUrl)
      ),
      values: values,
      warnings: warnings
    };
  }

  return Object.freeze({
    AUTONOMIES: AUTONOMIES,
    MISSED_REASONS: MISSED_REASONS,
    RESULTS: RESULTS,
    RESULT_END: RESULT_END,
    RESULT_START: RESULT_START,
    STATUSES: STATUSES,
    buildLessonCompletionRequest: buildLessonCompletionRequest,
    buildLessonTeacherPrompt: buildLessonTeacherPrompt,
    contentBlocksToText: contentBlocksToText,
    parseLessonResultBlock: parseLessonResultBlock,
    resolveTeacher: resolveTeacher,
    unicodeLength: unicodeLength
  });
});
