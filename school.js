(function (root, factory) {
  'use strict';

  var api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.SchoolUi = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (root) {
  'use strict';

  var ACTIVE_WEEK = 'W01 · 3–9 августа 2026';
  var TIME_ZONE = 'Asia/Yekaterinburg';
  var WEEK_DAYS = [
    { date: '2026-08-03', short: 'Пн', label: '3 августа' },
    { date: '2026-08-04', short: 'Вт', label: '4 августа' },
    { date: '2026-08-05', short: 'Ср', label: '5 августа' },
    { date: '2026-08-06', short: 'Чт', label: '6 августа' },
    { date: '2026-08-07', short: 'Пт', label: '7 августа' },
    { date: '2026-08-08', short: 'Сб', label: '8 августа' },
    { date: '2026-08-09', short: 'Вс', label: '9 августа' }
  ];
  var FINAL_DIARY_STATUSES = ['Выполнен', 'Частично выполнен', 'Пропущен'];
  var RICH_BLOCK_TAGS = Object.freeze({
    paragraph: 'p',
    heading_1: 'h1',
    heading_2: 'h2',
    heading_3: 'h3',
    heading_4: 'h4',
    quote: 'blockquote',
    callout: 'aside'
  });
  var HIGH_PRIORITY_ISSUES = [
    'multiple-active',
    'planned-with-assessment',
    'missed-with-assessment',
    'invalid-duration',
    'duration-mismatch',
    'invalid-date'
  ];
  var ISSUE_LABELS = {
    'multiple-active': 'Активно несколько уроков',
    'planned-with-assessment': 'Запланированный урок содержит оценочные данные',
    'missed-with-assessment': 'У пропущенного урока остались оценочные данные',
    'invalid-duration': 'Некорректная продолжительность',
    'duration-mismatch': 'Время окончания не совпадает с продолжительностью',
    'invalid-date': 'Некорректная дата урока',
    'duplicate-order': 'Повторяется порядок уроков внутри дня',
    'overdue-planned': 'Урок просрочен',
    overlap: 'Уроки пересекаются по времени',
    'short-break': 'Между уроками нет запланированного перерыва'
  };

  function isRecord(value) {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
  }

  function text(value) {
    return typeof value === 'string' ? value : '';
  }

  function clearNode(node) {
    if (!node) return;
    while (node.firstChild) node.removeChild(node.firstChild);
    node.textContent = '';
  }

  function element(documentRef, tagName, className, value) {
    var node = documentRef.createElement(tagName);
    if (className) node.className = className;
    if (value !== undefined && value !== null) node.textContent = String(value);
    return node;
  }

  function safeHttpsUrl(value) {
    if (typeof value !== 'string' || value.length > 2048 || value.trim() !== value) return null;
    try {
      var url = new URL(value);
      if (url.protocol !== 'https:' || !url.hostname || url.username || url.password) return null;
      return value;
    } catch (_error) {
      return null;
    }
  }

  function routeDrawerRows(route) {
    var item = isRecord(route) ? route : {};
    var reviewer = isRecord(item.reviewer) ? item.reviewer : null;
    var warningCodes = Array.isArray(item.warnings)
      ? item.warnings.map(function (warning) {
        return text(warning && warning.code);
      })
      : [];
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
    var hasUnknownRouteValue = warningCodes.some(function (code) {
      return code === 'unknown-cabinet' ||
        code === 'unknown-teacher' ||
        code === 'unknown-format';
    });
    var hasInvalidCabinetUrl = warningCodes.indexOf('invalid-cabinet-url') !== -1;
    var instruction = item.platform === 'Codex'
      ? 'Скопируйте промт и откройте Codex desktop вручную.'
      : item.platform === 'ChatGPT' && item.canOpenCabinet
        ? 'Скопируйте промт и откройте постоянный кабинет преподавателя.'
        : item.platform === 'ChatGPT' && hasUnknownRouteValue
          ? 'Проверьте маршрут урока: неизвестные значения блокируют открытие. Промт можно скопировать вручную.'
          : item.platform === 'ChatGPT' && hasInvalidCabinetUrl
            ? 'URL постоянного кабинета некорректен. Промт можно скопировать вручную.'
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
        ? [text(reviewer.cabinetLabel), text(reviewer.teacherLabel)].filter(Boolean).join(' · ')
        : '',
      warnings: warnings,
      instruction: instruction
    };
  }

  function teacherTargetForRoute(route) {
    var chatGpt = route &&
      route.platform === 'ChatGPT' &&
      route.cabinetKind === 'permanent' &&
      route.canOpenCabinet;
    var url = chatGpt ? safeHttpsUrl(route.cabinetUrl) : null;
    return {
      configured: Boolean(url),
      label: route ? text(route.teacherLabel) : 'Преподаватель',
      url: url
    };
  }

  function copyPromptAndOpen(options) {
    options = isRecord(options) ? options : {};
    var runtime = options.runtime || root;
    var teacher = isRecord(options.teacher) ? options.teacher : {};
    var prompt = text(options.prompt);
    var copyText = typeof options.copyText === 'function'
      ? options.copyText
      : function () { return Promise.reject(new Error('clipboard unavailable')); };
    var onClipboardFallback = typeof options.onClipboardFallback === 'function'
      ? options.onClipboardFallback
      : function () {};
    var onPopupBlocked = typeof options.onPopupBlocked === 'function'
      ? options.onPopupBlocked
      : function () {};
    var popup = null;
    var popupBlocked = false;

    if (teacher.configured && teacher.url) {
      try {
        popup = runtime && typeof runtime.open === 'function'
          ? runtime.open('about:blank', '_blank')
          : null;
      } catch (_error) {
        popup = null;
      }
      popupBlocked = !popup;
      if (popup) {
        try {
          popup.opener = null;
          if (
            popup.document &&
            popup.document.head &&
            typeof popup.document.createElement === 'function'
          ) {
            var referrerPolicy = popup.document.createElement('meta');
            referrerPolicy.setAttribute('name', 'referrer');
            referrerPolicy.setAttribute('content', 'no-referrer');
            popup.document.head.appendChild(referrerPolicy);
          }
        } catch (_error) {}
      }
    }

    function reportPopupBlocked() {
      try {
        onPopupBlocked(teacher.url);
      } catch (_error) {}
    }

    function navigatePopup() {
      if (!popup || !popup.location || typeof popup.location.replace !== 'function') {
        if (popupBlocked) reportPopupBlocked();
        return false;
      }
      try {
        popup.location.replace(teacher.url);
        return true;
      } catch (_error) {
        popupBlocked = true;
        reportPopupBlocked();
        return false;
      }
    }

    var copyResult;
    try {
      copyResult = copyText(prompt);
    } catch (error) {
      copyResult = Promise.reject(error);
    }
    return Promise.resolve(copyResult).then(function () {
      var opened = navigatePopup();
      return {
        copied: true,
        opened: opened,
        popupBlocked: popupBlocked
      };
    }).catch(function () {
      try {
        onClipboardFallback(prompt);
      } catch (_error) {}
      var opened = navigatePopup();
      return {
        copied: false,
        opened: opened,
        popupBlocked: popupBlocked
      };
    });
  }

  function controlFrom(documentRef, id) {
    return documentRef && typeof documentRef.getElementById === 'function'
      ? documentRef.getElementById(id)
      : null;
  }

  function applyTeacherResultToControls(documentRef, values) {
    var result = isRecord(values) ? values : {};
    var assignments = {
      schoolLessonFinalStatus: result.status || '',
      schoolLessonResult: result.result || '',
      schoolLessonAutonomy: result.autonomy || '',
      schoolLessonUnderstanding: result.understanding === null ||
          result.understanding === undefined
        ? ''
        : String(result.understanding),
      schoolLessonComment: text(result.comment),
      schoolLessonArtifact: result.artifactUrl || '',
      schoolLessonMissedReason: result.missedReason || ''
    };

    Object.keys(assignments).forEach(function (id) {
      var control = controlFrom(documentRef, id);
      if (!control) return;
      control.value = assignments[id];
      if (control.classList) control.classList.add('is-teacher-filled');
      if (control._schoolTeacherEditBound) return;
      control._schoolTeacherEditBound = true;
      ['input', 'change'].forEach(function (eventName) {
        if (typeof control.addEventListener !== 'function') return;
        control.addEventListener(eventName, function () {
          if (control.classList) control.classList.remove('is-teacher-filled');
        });
      });
    });
    return assignments;
  }

  function syncAssessmentControlsForStatus(documentRef, status) {
    var result = controlFrom(documentRef, 'schoolLessonResult');
    var autonomy = controlFrom(documentRef, 'schoolLessonAutonomy');
    var understanding = controlFrom(documentRef, 'schoolLessonUnderstanding');
    var missedReason = controlFrom(documentRef, 'schoolLessonMissedReason');
    if (status === 'Пропущен') {
      if (result) result.value = '';
      if (autonomy) autonomy.value = '';
      if (understanding) understanding.value = '';
      return;
    }
    if (missedReason) missedReason.value = '';
    if (status === 'Частично выполнен' && result) {
      result.value = 'Требует повторения';
    } else if (status === 'Выполнен' && result && !result.value) {
      result.value = 'Зачёт';
    }
  }

  function assessmentDraft(documentRef, lesson, teacherBridge) {
    var bridge = teacherBridge || (root && root.SchoolTeacherBridge) || {};
    var errors = [];
    function value(id) {
      var control = controlFrom(documentRef, id);
      return control && typeof control.value === 'string' ? control.value : '';
    }
    var status = value('schoolLessonFinalStatus');
    var result = value('schoolLessonResult');
    var autonomy = value('schoolLessonAutonomy');
    var understandingValue = value('schoolLessonUnderstanding');
    var comment = value('schoolLessonComment').trim();
    var artifact = value('schoolLessonArtifact').trim();
    var missedReason = value('schoolLessonMissedReason');
    var understanding = understandingValue === '' ? null : Number(understandingValue);
    var command = {
      operation: 'completeLesson',
      lessonId: lesson && lesson.id,
      status: status
    };
    var summary = ['Статус: ' + (status || 'не выбран')];

    if (['Выполнен', 'Частично выполнен', 'Пропущен'].indexOf(status) === -1) {
      errors.push('Выберите итоговый статус.');
    }
    if (
      bridge &&
      typeof bridge.unicodeLength === 'function' &&
      bridge.unicodeLength(comment) > 1000
    ) {
      errors.push('Комментарий длиннее 1000 Unicode code points.');
    }
    if (artifact && !safeHttpsUrl(artifact)) {
      errors.push('Артефакт должен быть абсолютным HTTPS URL длиной не более 2048 символов.');
    }

    if (status === 'Пропущен') {
      if (!missedReason) errors.push('Выберите причину пропуска.');
      command.missedReason = missedReason;
      if (comment) command.comment = comment;
      summary.push('Причина пропуска: ' + (missedReason || 'не выбрана'));
      if (comment) summary.push('Комментарий: ' + comment);
    } else if (status === 'Выполнен' || status === 'Частично выполнен') {
      if (!autonomy) errors.push('Выберите автономность.');
      if (!Number.isInteger(understanding) || understanding < 0 || understanding > 3) {
        errors.push('Выберите понимание от 0 до 3.');
      }
      command.autonomy = autonomy;
      command.understanding = understanding;
      if (status === 'Выполнен') {
        command.result = result || 'Зачёт';
      }
      if (comment) command.comment = comment;
      if (artifact) command.artifactUrl = artifact;
      summary.push(
        'Результат: ' + (
          status === 'Частично выполнен'
            ? 'Требует повторения'
            : (command.result || 'Зачёт')
        )
      );
      summary.push('Автономность: ' + (autonomy || 'не выбрана'));
      summary.push(
        'Понимание: ' + (
          Number.isInteger(understanding) ? understanding + '/3' : 'не выбрано'
        )
      );
      if (comment) summary.push('Комментарий: ' + comment);
      if (artifact) summary.push('Артефакт: ' + artifact);
    }

    return {
      command: command,
      errors: errors,
      summary: summary.join('\n')
    };
  }

  function appendSpans(parent, spans, documentRef) {
    (Array.isArray(spans) ? spans : []).forEach(function (span) {
      if (!isRecord(span)) return;
      var annotations = isRecord(span.annotations) ? span.annotations : {};
      var node = element(documentRef, annotations.code ? 'code' : 'span');
      node.textContent = text(span.text);
      if (annotations.bold) node.className += ' is-bold';
      if (annotations.italic) node.className += ' is-italic';
      if (annotations.underline) node.className += ' is-underline';
      if (annotations.strikethrough) node.className += ' is-struck';

      var href = safeHttpsUrl(span.link);
      if (href) {
        var link = element(documentRef, 'a');
        link.setAttribute('href', href);
        link.setAttribute('target', '_blank');
        link.setAttribute('rel', 'noopener noreferrer');
        link.appendChild(node);
        parent.appendChild(link);
      } else {
        parent.appendChild(node);
      }
    });
  }

  function appendChildren(parent, children, documentRef) {
    if (!Array.isArray(children) || children.length === 0) return;
    var nested = element(documentRef, 'div', 'school-content-children');
    renderContentBlocks(nested, children, documentRef);
    parent.appendChild(nested);
  }

  function renderTableBlock(rootNode, block, documentRef) {
    var shell = element(documentRef, 'div', 'school-content-table');
    var table = element(documentRef, 'table');
    (Array.isArray(block.children) ? block.children : []).forEach(function (rowBlock) {
      if (!isRecord(rowBlock) || rowBlock.type !== 'table_row') return;
      var row = element(documentRef, 'tr');
      (Array.isArray(rowBlock.cells) ? rowBlock.cells : []).forEach(function (cell) {
        var cellNode = element(documentRef, 'td');
        appendSpans(cellNode, cell, documentRef);
        row.appendChild(cellNode);
      });
      table.appendChild(row);
    });
    shell.appendChild(table);
    rootNode.appendChild(shell);
  }

  function renderContentBlocks(rootNode, blocks, documentRef) {
    documentRef = documentRef || (root && root.document);
    if (!rootNode || !documentRef) return rootNode;
    var items = Array.isArray(blocks) ? blocks : [];
    var index = 0;

    while (index < items.length) {
      var block = items[index];
      index += 1;
      if (!isRecord(block)) continue;
      var node;
      var tagName = Object.prototype.hasOwnProperty.call(RICH_BLOCK_TAGS, block.type)
        ? RICH_BLOCK_TAGS[block.type]
        : null;

      if (tagName) {
        node = element(documentRef, tagName, block.type === 'callout' ? 'school-content-callout' : '');
        appendSpans(node, block.spans, documentRef);
        appendChildren(node, block.children, documentRef);
        rootNode.appendChild(node);
        continue;
      }

      if (block.type === 'bulleted_list_item' || block.type === 'numbered_list_item') {
        var list = element(documentRef, block.type === 'bulleted_list_item' ? 'ul' : 'ol');
        var listType = block.type;
        var listItem = block;
        while (isRecord(listItem) && listItem.type === listType) {
          node = element(documentRef, 'li');
          appendSpans(node, listItem.spans, documentRef);
          appendChildren(node, listItem.children, documentRef);
          list.appendChild(node);
          if (index >= items.length || !isRecord(items[index]) || items[index].type !== listType) break;
          listItem = items[index];
          index += 1;
        }
        rootNode.appendChild(list);
        continue;
      }

      if (block.type === 'toggle') {
        node = element(documentRef, 'details');
        var summary = element(documentRef, 'summary');
        appendSpans(summary, block.spans, documentRef);
        node.appendChild(summary);
        appendChildren(node, block.children, documentRef);
        rootNode.appendChild(node);
        continue;
      }

      if (block.type === 'to_do') {
        node = element(documentRef, 'p', 'school-content-todo');
        var checkbox = element(documentRef, 'input');
        checkbox.setAttribute('type', 'checkbox');
        checkbox.setAttribute('disabled', '');
        if (block.checked) checkbox.setAttribute('checked', '');
        node.appendChild(checkbox);
        appendSpans(node, block.spans, documentRef);
        appendChildren(node, block.children, documentRef);
        rootNode.appendChild(node);
        continue;
      }

      if (block.type === 'code') {
        node = element(documentRef, 'pre');
        var code = element(documentRef, 'code');
        appendSpans(code, block.spans, documentRef);
        node.appendChild(code);
        rootNode.appendChild(node);
        appendChildren(node, block.children, documentRef);
        continue;
      }

      if (block.type === 'divider') {
        rootNode.appendChild(element(documentRef, 'hr'));
        continue;
      }

      if (block.type === 'equation') {
        rootNode.appendChild(element(documentRef, 'p', 'school-content-equation', text(block.expression)));
        continue;
      }

      if (block.type === 'table') {
        renderTableBlock(rootNode, block, documentRef);
        continue;
      }

      if (block.type === 'column_list' || block.type === 'column' || block.type === 'synced_block') {
        node = element(documentRef, 'div', 'school-content-group');
        appendChildren(node, block.children, documentRef);
        rootNode.appendChild(node);
        continue;
      }

      if ([
        'bookmark', 'link_preview', 'image', 'file', 'pdf', 'video', 'audio', 'embed'
      ].indexOf(block.type) !== -1) {
        var safeUrl = safeHttpsUrl(block.url);
        node = element(documentRef, safeUrl ? 'a' : 'div', 'school-content-reference', text(block.label) || 'внешний материал');
        if (safeUrl) {
          node.setAttribute('href', safeUrl);
          node.setAttribute('target', '_blank');
          node.setAttribute('rel', 'noopener noreferrer');
        }
        rootNode.appendChild(node);
        appendChildren(node, block.children, documentRef);
        continue;
      }

      rootNode.appendChild(element(
        documentRef,
        'p',
        'school-content-unsupported',
        text(block.label) || 'неподдерживаемый блок'
      ));
    }

    return rootNode;
  }

  function localDateKey(value) {
    var date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) return null;
    var parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: TIME_ZONE,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    }).formatToParts(date);
    var values = {};
    parts.forEach(function (part) { values[part.type] = part.value; });
    return values.year && values.month && values.day
      ? values.year + '-' + values.month + '-' + values.day
      : null;
  }

  function timeText(value) {
    var date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    return new Intl.DateTimeFormat('ru-RU', {
      timeZone: TIME_ZONE,
      hour: '2-digit',
      minute: '2-digit'
    }).format(date);
  }

  function dateText(value) {
    if (typeof value !== 'string') return '';
    var date = new Date(value + 'T12:00:00+05:00');
    if (Number.isNaN(date.getTime())) return value;
    return new Intl.DateTimeFormat('ru-RU', {
      timeZone: TIME_ZONE,
      day: 'numeric',
      month: 'short'
    }).format(date).replace('.', '');
  }

  function scheduleText(lesson) {
    var schedule = lesson && lesson.schedule;
    if (!schedule || schedule.kind === 'unscheduled') return 'Нераспределён · ' + lesson.durationMinutes + ' минут';
    if (schedule.kind === 'date-only') return 'Без времени · ' + lesson.durationMinutes + ' минут';
    return timeText(schedule.start) + '–' + timeText(schedule.end);
  }

  function scheduleRange(start, end) {
    return timeText(start) + '–' + timeText(end);
  }

  function selectTodayFocus(model) {
    var active = model && Array.isArray(model.activeLessons) ? model.activeLessons : [];
    if (active.length === 1) return active[0];
    if (active.length > 1) return null;
    return model && model.nextLesson ? model.nextLesson : null;
  }

  function diaryResult(lesson) {
    if (lesson.status === 'Пропущен') {
      return lesson.missedReason ? 'Пропущен · ' + lesson.missedReason : 'Пропущен';
    }
    return lesson.result || lesson.status;
  }

  function diaryScores(lesson) {
    if (lesson.status === 'Пропущен') return { autonomy: '', understanding: '' };
    return {
      autonomy: lesson.autonomy || '',
      understanding: lesson.understanding === null || lesson.understanding === undefined
        ? ''
        : String(lesson.understanding) + '/3'
    };
  }

  function groupDiaryLessons(entries) {
    var byDate = {};
    (Array.isArray(entries) ? entries : []).filter(function (lesson) {
      return lesson && FINAL_DIARY_STATUSES.indexOf(lesson.status) !== -1;
    }).forEach(function (lesson) {
      var date = lesson.schedule && typeof lesson.schedule.date === 'string'
        ? lesson.schedule.date
        : '';
      if (!byDate[date]) byDate[date] = [];
      byDate[date].push(lesson);
    });
    return Object.keys(byDate).sort().reverse().map(function (date) {
      return {
        date: date,
        lessons: byDate[date].slice().sort(function (left, right) {
          return (left.order || 0) - (right.order || 0) || text(left.id).localeCompare(text(right.id));
        })
      };
    });
  }

  function timeMinutes(value) {
    var date = new Date(value);
    if (Number.isNaN(date.getTime())) return 0;
    var parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: TIME_ZONE,
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23'
    }).formatToParts(date);
    var values = {};
    parts.forEach(function (part) { values[part.type] = Number(part.value); });
    return (values.hour || 0) * 60 + (values.minute || 0);
  }

  function getWeekTimeBounds(entries) {
    var timed = (Array.isArray(entries) ? entries : []).filter(function (lesson) {
      return lesson && lesson.schedule && lesson.schedule.kind === 'timed'
        && lesson.schedule.start && lesson.schedule.end;
    });
    var starts = timed.map(function (lesson) { return timeMinutes(lesson.schedule.start); });
    var ends = timed.map(function (lesson) { return timeMinutes(lesson.schedule.end); });
    var startHour = Math.min(9, starts.length ? Math.floor(Math.min.apply(null, starts) / 60) : 9);
    var endHour = Math.max(20, ends.length ? Math.ceil(Math.max.apply(null, ends) / 60) : 20);
    if (endHour <= startHour) endHour = startHour + 1;
    return {
      startHour: startHour,
      endHour: endHour,
      height: (endHour - startHour) * 60
    };
  }

  function timelineDestination(core, day, clientY, rect, bounds, zoomLevel) {
    var minute = core.timelineMinuteAtY(
      clientY - rect.top,
      bounds.startHour * 60,
      zoomLevel.pixelsPerHour,
      zoomLevel.snapMinutes
    );
    return {
      kind: 'timed',
      start: day + 'T' + String(Math.floor(minute / 60)).padStart(2, '0')
        + ':' + String(minute % 60).padStart(2, '0') + ':00+05:00'
    };
  }

  function timelineDragPreview(core, lesson, day, clientY, rect, bounds, zoomLevel) {
    var destination = timelineDestination(core, day, clientY, rect, bounds, zoomLevel);
    var schedule = core.scheduleForDestination(destination, lesson.durationMinutes);
    var start = timeMinutes(schedule.start);
    var end = timeMinutes(schedule.end);
    var startMinute = bounds.startHour * 60;
    return {
      destination: destination,
      schedule: schedule,
      top: Math.max(0, core.timelineYForMinute(start, startMinute, zoomLevel.pixelsPerHour)),
      height: Math.max(44, core.timelineYForMinute(end, start, zoomLevel.pixelsPerHour))
    };
  }

  function makeTimelineDragPreviewNodes(documentRef, lesson, preview) {
    var previewNode = element(documentRef, 'div', 'school-time-drag-preview');
    previewNode.style.top = preview.top + 'px';
    previewNode.style.height = preview.height + 'px';
    previewNode.setAttribute('aria-hidden', 'true');
    previewNode.appendChild(element(documentRef, 'span', 'school-card-subject', lesson.subject));
    previewNode.appendChild(element(documentRef, 'strong', 'school-card-title', lesson.title));
    previewNode.appendChild(element(
      documentRef,
      'span',
      'school-card-meta',
      scheduleRange(preview.schedule.start, preview.schedule.end)
    ));

    var lineNode = element(documentRef, 'span', 'school-time-snap-line');
    lineNode.style.top = preview.top + 'px';
    lineNode.setAttribute('aria-hidden', 'true');
    return {
      previewNode: previewNode,
      lineNode: lineNode
    };
  }

  function setTransparentDragImage(event, dragImageNode) {
    if (
      !dragImageNode ||
      !event ||
      !event.dataTransfer ||
      typeof event.dataTransfer.setDragImage !== 'function'
    ) {
      return false;
    }
    event.dataTransfer.setDragImage(dragImageNode, 0, 0);
    return true;
  }

  function timelineDropDestination(activePreview, node, lessonId, fallbackDestination) {
    if (
      activePreview &&
      activePreview.node === node &&
      activePreview.lessonId === lessonId
    ) {
      return activePreview.destination;
    }
    return fallbackDestination;
  }

  function setTimelineStyle(node, property, value) {
    if (!node || !node.style) return;
    if (typeof node.style.setProperty === 'function') node.style.setProperty(property, value);
    else node.style[property] = value;
  }

  function applyTimelineGeometry(core, registry, scale) {
    if (!core || !registry || !registry.shell) return null;
    var pixelsPerHour = core.timelinePixelsPerHour(scale);
    var snapMinutes = core.timelineSnapMinutesForScale(scale);
    var startMinute = Number(registry.startMinute) || 0;
    var endMinute = Number(registry.endMinute) || startMinute;
    var height = core.timelineYForMinute(endMinute, startMinute, pixelsPerHour);
    setTimelineStyle(registry.shell, '--school-time-height', height + 'px');
    if (typeof registry.shell.setAttribute === 'function') {
      registry.shell.setAttribute('data-school-snap', String(snapMinutes));
    }
    (registry.labels || []).forEach(function (entry) {
      entry.node.style.top = core.timelineYForMinute(
        entry.minute,
        startMinute,
        pixelsPerHour
      ) + 'px';
    });
    (registry.lines || []).forEach(function (entry) {
      entry.node.style.top = core.timelineYForMinute(
        entry.minute,
        startMinute,
        pixelsPerHour
      ) + 'px';
    });
    (registry.cards || []).forEach(function (entry) {
      entry.node.style.top = Math.max(
        0,
        core.timelineYForMinute(entry.startMinute, startMinute, pixelsPerHour)
      ) + 'px';
      entry.node.style.height = Math.max(
        44,
        core.timelineYForMinute(entry.endMinute, entry.startMinute, pixelsPerHour)
      ) + 'px';
    });
    return {
      pixelsPerHour: pixelsPerHour,
      snapMinutes: snapMinutes,
      height: height
    };
  }

  function layoutTimedLessons(entries, pixelsPerHour) {
    var scale = Number.isFinite(Number(pixelsPerHour)) && Number(pixelsPerHour) > 0
      ? Number(pixelsPerHour)
      : 60;
    var minimumVisualMinutes = 44 * 60 / scale;
    var sorted = (Array.isArray(entries) ? entries : []).slice().sort(function (left, right) {
      return timeMinutes(left.schedule.start) - timeMinutes(right.schedule.start)
        || (Number.isFinite(Number(left.order)) ? Number(left.order) : 0)
          - (Number.isFinite(Number(right.order)) ? Number(right.order) : 0)
        || text(left.id).localeCompare(text(right.id));
    });
    var laneEnds = [];
    var laidOut = [];
    var group = [];
    var groupEnd = -1;

    function finishGroup() {
      var laneCount = Math.max(1, laneEnds.length);
      group.forEach(function (item) { item.laneCount = laneCount; });
      laneEnds = [];
      group = [];
      groupEnd = -1;
    }

    sorted.forEach(function (lesson) {
      var start = timeMinutes(lesson.schedule.start);
      var actualEnd = timeMinutes(lesson.schedule.end);
      if (actualEnd < start) actualEnd += 24 * 60;
      var visualEnd = Math.max(actualEnd, start + minimumVisualMinutes);
      if (group.length && start >= groupEnd) finishGroup();
      var lane = laneEnds.findIndex(function (laneEnd) { return laneEnd <= start; });
      if (lane === -1) {
        lane = laneEnds.length;
        laneEnds.push(visualEnd);
      } else {
        laneEnds[lane] = visualEnd;
      }
      var item = { lesson: lesson, lane: lane, laneCount: 0, visualEnd: visualEnd };
      group.push(item);
      laidOut.push(item);
      groupEnd = Math.max(groupEnd, visualEnd);
    });
    if (group.length) finishGroup();
    return laidOut;
  }

  function lessonSignalLabels(lesson, hasConflict, hasShortBreak) {
    var signals = [];
    if (lesson.status === 'В процессе') signals.push('Текущий урок');
    if (lesson.decisionRequest) signals.push('Запрошен перенос в другую неделю');
    if (lesson.moveCount >= 2) signals.push('переносился ' + lesson.moveCount + ' раза');
    (Array.isArray(lesson.warnings) ? lesson.warnings : []).forEach(function (warning) {
      if (warning && ISSUE_LABELS[warning.code]) signals.push(ISSUE_LABELS[warning.code]);
    });
    if (hasConflict) signals.push('Конфликт времени');
    if (hasShortBreak) signals.push(ISSUE_LABELS['short-break']);
    return signals;
  }

  function partitionDecisionItems(model) {
    var issues = model && Array.isArray(model.runtimeIssues) ? model.runtimeIssues : [];
    return {
      importantIssues: issues.filter(function (issue) {
        return HIGH_PRIORITY_ISSUES.indexOf(issue.code) !== -1;
      }),
      persisted: model && Array.isArray(model.persistedDecisions) ? model.persistedDecisions : [],
      remainingIssues: issues.filter(function (issue) {
        return HIGH_PRIORITY_ISSUES.indexOf(issue.code) === -1;
      })
    };
  }

  function decisionQueueCommand(item, persisted, choice) {
    if (
      persisted &&
      item &&
      typeof item.id === 'string' &&
      choice === 'clear'
    ) {
      return {
        operation: 'clearDecisionRequest',
        lessonId: item.id
      };
    }
    if (
      !persisted &&
      item &&
      item.code === 'multiple-active' &&
      Array.isArray(item.lessonIds) &&
      item.lessonIds.indexOf(choice) !== -1
    ) {
      return {
        operation: 'resolveActiveLessons',
        keepLessonId: choice
      };
    }
    return null;
  }

  function statusClass(status) {
    if (status === 'Выполнен') return ' is-done';
    if (status === 'Пропущен') return ' is-missed';
    if (status === 'В процессе') return ' is-active';
    return '';
  }

  function appendLessonRoute(card, documentRef, labels) {
    if (!card || !documentRef || !labels) return;
    var line = element(
      documentRef,
      'span',
      'school-card-route' + (labels.warning ? ' is-warning' : '')
    );
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

  function appendLessonDetails(card, documentRef, lesson, conflictIds, isSaving, shortBreakIds, routeLabels) {
    if (lesson.status === 'Отменён') card.className += ' is-canceled';
    card.appendChild(element(documentRef, 'span', 'school-card-subject', lesson.subject));
    card.appendChild(element(documentRef, 'strong', 'school-card-title', lesson.title));
    appendLessonRoute(card, documentRef, routeLabels);
    var meta = element(documentRef, 'span', 'school-card-meta');
    meta.appendChild(element(documentRef, 'span', 'school-time', scheduleText(lesson)));
    if (lesson.schedule.kind === 'timed') {
      meta.appendChild(element(documentRef, 'span', 'school-time', lesson.durationMinutes + ' минут'));
    }
    meta.appendChild(element(documentRef, 'span', 'school-status' + statusClass(lesson.status), lesson.status));
    meta.appendChild(element(documentRef, 'span', 'school-priority', lesson.priority));
    card.appendChild(meta);

    var signals = lessonSignalLabels(
      lesson,
      Boolean(conflictIds && conflictIds.has(lesson.id)),
      Boolean(shortBreakIds && shortBreakIds.has(lesson.id))
    );
    if (isSaving) signals.unshift('сохраняется');
    if (signals.length) {
      var warningRoot = element(documentRef, 'span', 'school-card-signals');
      signals.forEach(function (signal) {
        warningRoot.appendChild(element(documentRef, 'span', 'school-card-signal', signal));
      });
      card.appendChild(warningRoot);
    }
  }

  function makeLessonCard(documentRef, lesson, openLesson, conflictIds, configureCard, pendingLessonIds, shortBreakIds, routeLabels) {
    var card = element(documentRef, 'button', 'school-lesson-card');
    card.type = 'button';
    card.setAttribute('aria-label', 'Открыть урок: ' + lesson.title);
    card.addEventListener('click', function () { openLesson(lesson.id); });
    appendLessonDetails(
      card,
      documentRef,
      lesson,
      conflictIds,
      Boolean(pendingLessonIds && pendingLessonIds.has(lesson.id)),
      shortBreakIds,
      routeLabels
    );
    if (typeof configureCard === 'function') configureCard(card, lesson);
    return card;
  }

  function isLessonDraggable(lesson) {
    return Boolean(lesson) && [
      'Нераспределён',
      'Запланирован',
      'В процессе',
      'Пропущен'
    ].indexOf(lesson.status) !== -1;
  }

  function destinationDate(destination) {
    if (!destination) return null;
    if (destination.kind === 'date-only') return destination.date;
    if (destination.kind === 'timed') return text(destination.start).slice(0, 10);
    return null;
  }

  function allDayDropPlacement(rect, clientY) {
    rect = isRecord(rect) ? rect : {};
    var top = Number(rect.top) || 0;
    var height = Number(rect.height);
    if (!Number.isFinite(height) && Number.isFinite(Number(rect.bottom))) {
      height = Number(rect.bottom) - top;
    }
    if (!Number.isFinite(height) || height < 0) height = 0;
    return Number(clientY) < top + height / 2 ? 'before' : 'after';
  }

  function allDayDropOrder(core, entries, date, draggedId, targetId, placement) {
    var candidates = (Array.isArray(entries) ? entries : []).filter(function (lesson) {
      return lesson && lesson.id !== draggedId && lesson.schedule &&
        lesson.schedule.kind === 'date-only' && lesson.schedule.date === date;
    });
    candidates = core.sortLessonsForDay(candidates);
    var targetIndex = candidates.findIndex(function (lesson) {
      return lesson.id === targetId;
    });
    if (targetIndex === -1) {
      var lastOrder = candidates.reduce(function (maximum, lesson) {
        return Math.max(maximum, Number(lesson.order) || 0);
      }, 0);
      return lastOrder ? lastOrder + 100 : 100;
    }
    var previous;
    var next;
    if (placement === 'after') {
      previous = candidates[targetIndex] || null;
      next = candidates[targetIndex + 1] || null;
    } else {
      previous = candidates[targetIndex - 1] || null;
      next = candidates[targetIndex] || null;
    }
    return core.orderForDrop(
      previous ? previous.order : null,
      next ? next.order : null
    );
  }

  function commandForAllDayDrop(lesson, date, order) {
    if (
      lesson &&
      lesson.schedule &&
      lesson.schedule.kind === 'date-only' &&
      lesson.schedule.date === date &&
      ['Нераспределён', 'Запланирован', 'В процессе'].indexOf(lesson.status) !== -1
    ) {
      return {
        kind: 'command',
        command: {
          operation: 'reorderLesson',
          lessonId: lesson.id,
          order: order
        }
      };
    }
    return commandForDrop(lesson, { kind: 'date-only', date: date }, order);
  }

  function commandForDrop(lesson, destination, order) {
    if (!lesson || !destination) return { kind: 'blocked' };
    if (['Выполнен', 'Частично выполнен', 'Отменён'].indexOf(lesson.status) !== -1) {
      return { kind: 'blocked', status: lesson.status };
    }
    if (lesson.status === 'Пропущен') {
      return {
        kind: 'restore-confirm',
        command: {
          operation: 'restoreMissedLesson',
          lessonId: lesson.id,
          destination: destination,
          order: order
        }
      };
    }
    if (lesson.status === 'В процессе') {
      var currentDate = lesson.schedule ? lesson.schedule.date : null;
      if (destination.kind === 'unscheduled' || destinationDate(destination) !== currentDate) {
        return {
          kind: 'pause-confirm',
          command: {
            operation: 'pauseAndMoveLesson',
            lessonId: lesson.id,
            destination: destination,
            order: order
          }
        };
      }
    }
    if (destination.kind === 'unscheduled') {
      return {
        kind: 'command',
        command: {
          operation: 'unscheduleLesson',
          lessonId: lesson.id,
          order: order
        }
      };
    }
    return {
      kind: 'command',
      command: {
        operation: 'moveLesson',
        lessonId: lesson.id,
        destination: destination,
        order: order
      }
    };
  }

  function commandAfterOverlapChoice(command, error, choice) {
    if (!command || !error || error.code !== 'LESSON_TIME_CONFLICT') return null;
    if (choice === 'allow') return Object.assign({}, command, { allowOverlap: true });
    if (choice !== 'after') return null;
    var conflicts = error.details && Array.isArray(error.details.conflicts)
      ? error.details.conflicts
      : [];
    var end = conflicts.map(function (item) { return text(item && item.end); })
      .filter(Boolean).sort().pop();
    if (!end || !command.destination || command.destination.kind !== 'timed') return null;
    return Object.assign({}, command, {
      destination: {
        kind: 'timed',
        start: end
      }
    });
  }

  function cloneLessons(lessons) {
    return JSON.parse(JSON.stringify(Array.isArray(lessons) ? lessons : []));
  }

  function cloneValue(value) {
    return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
  }

  function cabinetSettingsDraft(confirmed, edits, settingsCore) {
    var core = settingsCore || (root && root.SchoolCabinetSettings);
    var ids = core && Array.isArray(core.CABINET_IDS)
      ? core.CABINET_IDS
      : [];
    var confirmedCabinets = isRecord(confirmed && confirmed.cabinets)
      ? confirmed.cabinets
      : {};
    var changes = isRecord(edits) ? edits : {};
    var confirmedDraft = {};
    var draft = {};

    ids.forEach(function (cabinetId) {
      confirmedDraft[cabinetId] = text(confirmedCabinets[cabinetId]);
      draft[cabinetId] = Object.prototype.hasOwnProperty.call(changes, cabinetId)
        ? text(changes[cabinetId])
        : confirmedDraft[cabinetId];
    });

    var validation = core && typeof core.validateDraft === 'function'
      ? core.validateDraft(draft)
      : { valid: false, errors: {} };
    var errors = {};
    var fieldStates = {};
    ids.forEach(function (cabinetId) {
      if (validation.errors && validation.errors[cabinetId]) {
        errors[cabinetId] = 'Проверьте ссылку';
        fieldStates[cabinetId] = 'проверьте ссылку';
      } else if (!draft[cabinetId].trim()) {
        fieldStates[cabinetId] = 'не настроено';
      } else {
        fieldStates[cabinetId] = 'готово';
      }
    });

    return {
      confirmed: confirmedDraft,
      draft: draft,
      dirty: ids.some(function (cabinetId) {
        return draft[cabinetId] !== confirmedDraft[cabinetId];
      }),
      valid: Boolean(validation.valid),
      errors: errors,
      fieldStates: fieldStates,
      pendingRemote: null,
      showRemoteNotice: false
    };
  }

  function mergeCabinetSettingsState(currentUiState, incomingState) {
    var current = isRecord(currentUiState) ? currentUiState : {};
    var incoming = isRecord(incomingState) ? cloneValue(incomingState) : null;
    var incomingCabinets = incoming &&
      incoming.settings &&
      isRecord(incoming.settings.cabinets)
      ? incoming.settings.cabinets
      : {};
    if (current.dirty) {
      return Object.assign({}, cloneValue(current), {
        confirmed: cloneValue(incomingCabinets),
        pendingRemote: incoming,
        showRemoteNotice: Boolean(incoming)
      });
    }
    return Object.assign({}, cloneValue(current), {
      confirmed: cloneValue(incomingCabinets),
      draft: cloneValue(incomingCabinets),
      dirty: false,
      pendingRemote: null,
      showRemoteNotice: false
    });
  }

  function createController(options) {
    options = isRecord(options) ? options : {};
    var documentRef = options.document === undefined ? (root && root.document) : options.document;
    var runtime = options.runtime || root;
    var api = options.api || (root && root.SchoolApi);
    var core = options.core || (root && root.SchoolCore);
    var queueApi = options.mutationQueue || (root && root.SchoolMutationQueue);
    var teacherBridge = options.teacherBridge || (root && root.SchoolTeacherBridge);
    var learningRoute = options.learningRoute || (root && root.SchoolLearningRoute);
    var cabinetSettingsStore = options.cabinetSettingsStore || null;
    var cabinetSettingsCore = options.cabinetSettingsCore ||
      (root && root.SchoolCabinetSettings);
    var baseLearningConfig = options.learningConfig ||
      (root && root.SchoolLearningConfig) || {};
    var cabinetSettingsState = null;
    var effectiveLearningConfig = baseLearningConfig;
    var now = typeof options.now === 'function' ? options.now : function () { return new Date(); };
    var onState = typeof options.onState === 'function' ? options.onState : function () {};
    var lessons = [];
    var confirmedLessons = [];
    var optimisticMutations = [];
    var pendingLessonIds = new Set();
    var readModel = null;
    var currentView = 'today';
    var mobileDay = '2026-08-03';
    var previousFocus = null;
    var dialogKeyHandler = null;
    var dialogGeneration = 0;
    var currentContentLessonId = null;
    var currentContentBlocks = [];
    var currentContentLoaded = false;
    var currentTeacherParse = null;
    var teacherPreviousFocus = null;
    var toastTimer = null;
    var mutationSequence = 0;
    var revalidationGeneration = 0;
    var timelineScale = 1;
    var targetTimelineScale = 1;
    var timelineWheelDelta = 0;
    var timelineZoomFrame = null;
    var timelineZoomAnimation = null;
    var timelineGeometryRegistry = null;
    var draggedLessonId = null;
    var activeTimelineDragPreview = null;
    var activeAllDayDropPreview = null;
    var transparentDragImage = null;
    var actionResolver = null;
    var actionPreviousFocus = null;
    var settingsUiState = cabinetSettingsDraft(
      { version: 1, cabinets: {} },
      {},
      cabinetSettingsCore
    );
    var settingsPreviousFocus = null;
    var settingsSaving = false;

    function routeForLesson(lesson) {
      if (!learningRoute || typeof learningRoute.resolveLessonRoute !== 'function') return null;
      return learningRoute.resolveLessonRoute(lesson, effectiveLearningConfig);
    }

    function applyCabinetSettings(nextState) {
      cabinetSettingsState = nextState ? cloneValue(nextState) : null;
      effectiveLearningConfig = cabinetSettingsCore &&
        typeof cabinetSettingsCore.applyToConfig === 'function'
        ? cabinetSettingsCore.applyToConfig(
          baseLearningConfig,
          nextState && nextState.settings
        )
        : baseLearningConfig;
      if (readModel) render(readModel);
      return cabinetSettingsState ? cloneValue(cabinetSettingsState) : null;
    }

    function routeLabelsForLesson(lesson) {
      var route = routeForLesson(lesson);
      if (!route || typeof learningRoute.compactRouteLabels !== 'function') return null;
      var labels = learningRoute.compactRouteLabels(route);
      return {
        desktop: labels.desktop,
        mobile: labels.mobile,
        warning: Array.isArray(route.warnings) && route.warnings.length > 0
      };
    }
    var queue = queueApi.create({
      execute: async function (entry) {
        try {
          var result = await api.mutate(entry.command);
          confirmedLessons = entry.reducer(cloneLessons(confirmedLessons));
          optimisticMutations = optimisticMutations.filter(function (item) {
            return item.id !== entry.id;
          });
          rebuildVisibleLessons();
          return result;
        } catch (error) {
          optimisticMutations = optimisticMutations.filter(function (item) {
            return item.id !== entry.id;
          });
          rebuildVisibleLessons();
          throw error;
        }
      },
      afterBatch: async function () {
        await revalidateAfterMutation();
      },
      onPendingChange: function (keys) {
        pendingLessonIds = keys;
        if (readModel) buildModel();
      },
      onAfterBatchError: function () {
        setSyncBanner('Изменения сохранены, но контрольное чтение не удалось.', true);
      }
    });

    function byId(id) {
      return documentRef ? documentRef.getElementById(id) : null;
    }

    function settingsDialogOpen() {
      var dialog = byId('schoolSettingsDialog');
      return Boolean(dialog && !dialog.hidden);
    }

    function settingsConfirmed() {
      return cabinetSettingsState &&
        cabinetSettingsState.settings &&
        isRecord(cabinetSettingsState.settings.cabinets)
        ? cabinetSettingsState.settings
        : { version: 1, cabinets: {} };
    }

    function renderSettingsForm() {
      if (!documentRef || !settingsUiState) return;
      documentRef.querySelectorAll(
        'input[data-school-cabinet-id]'
      ).forEach(function (input) {
        var cabinetId = input.getAttribute('data-school-cabinet-id');
        input.value = text(settingsUiState.draft[cabinetId]);
        var hasError = Boolean(settingsUiState.errors[cabinetId]);
        input.setAttribute('aria-invalid', hasError ? 'true' : 'false');
        var stateId = input.getAttribute('aria-describedby');
        var stateNode = stateId ? byId(stateId) : null;
        if (stateNode) {
          stateNode.textContent = settingsUiState.fieldStates[cabinetId] || '';
          if (stateNode.classList) {
            stateNode.classList.toggle('is-error', hasError);
          }
        }
      });

      var notice = byId('schoolSettingsRemoteNotice');
      if (notice) notice.hidden = !settingsUiState.showRemoteNotice;
      var status = byId('schoolSettingsStatus');
      if (status) status.textContent = settingsUiState.statusMessage || '';
      var save = byId('schoolSettingsSave');
      if (save) {
        save.disabled = settingsSaving ||
          !settingsUiState.valid ||
          !settingsUiState.dirty;
        save.textContent = settingsSaving ? 'Сохраняю…' : 'Сохранить';
      }
    }

    function rebuildSettingsDraft(edits) {
      settingsUiState = cabinetSettingsDraft(
        settingsConfirmed(),
        edits,
        cabinetSettingsCore
      );
      renderSettingsForm();
      return cloneValue(settingsUiState);
    }

    function updateCabinetSettingsDraft(cabinetId, value) {
      if (
        !cabinetSettingsCore ||
        cabinetSettingsCore.CABINET_IDS.indexOf(cabinetId) === -1
      ) {
        return cloneValue(settingsUiState);
      }
      var edits = Object.assign({}, settingsUiState.draft);
      edits[cabinetId] = text(value);
      return rebuildSettingsDraft(edits);
    }

    function receiveCabinetSettingsState(nextState) {
      applyCabinetSettings(nextState);
      if (settingsDialogOpen() && settingsUiState && settingsUiState.dirty) {
        settingsUiState = mergeCabinetSettingsState(
          settingsUiState,
          nextState
        );
        var validation = cabinetSettingsDraft(
          nextState && nextState.settings,
          settingsUiState.draft,
          cabinetSettingsCore
        );
        settingsUiState = Object.assign({}, validation, {
          pendingRemote: cloneValue(nextState),
          showRemoteNotice: true
        });
      } else {
        settingsUiState = cabinetSettingsDraft(
          nextState && nextState.settings,
          {},
          cabinetSettingsCore
        );
      }
      renderSettingsForm();
      return cloneValue(settingsUiState);
    }

    function openSettings() {
      if (!documentRef) return false;
      var dialog = byId('schoolSettingsDialog');
      if (!dialog) return false;
      settingsPreviousFocus = documentRef.activeElement;
      settingsUiState = cabinetSettingsDraft(
        settingsConfirmed(),
        {},
        cabinetSettingsCore
      );
      dialog.hidden = false;
      dialog.setAttribute('aria-hidden', 'false');
      setBackgroundInert(true);
      renderSettingsForm();
      installDialogKeys(dialog);
      var first = dialog.querySelector('input');
      if (first && typeof first.focus === 'function') first.focus();
      return true;
    }

    function closeSettingsImmediately() {
      var dialog = byId('schoolSettingsDialog');
      if (!dialog || dialog.hidden) return false;
      dialog.hidden = true;
      dialog.setAttribute('aria-hidden', 'true');
      settingsUiState = cabinetSettingsDraft(
        settingsConfirmed(),
        {},
        cabinetSettingsCore
      );
      var lessonDialog = byId('schoolLessonDialog');
      if (!lessonDialog || lessonDialog.hidden) {
        setBackgroundInert(false);
      }
      if (
        dialogKeyHandler &&
        (!lessonDialog || lessonDialog.hidden) &&
        !actionDialogOpen()
      ) {
        documentRef.removeEventListener('keydown', dialogKeyHandler);
        dialogKeyHandler = null;
      }
      if (
        settingsPreviousFocus &&
        typeof settingsPreviousFocus.focus === 'function'
      ) {
        settingsPreviousFocus.focus();
      }
      settingsPreviousFocus = null;
      return true;
    }

    async function closeSettings(force) {
      if (!settingsDialogOpen()) return true;
      if (settingsUiState.dirty && !force) {
        var choice = await askAction(
          'Закрыть настройки без сохранения?',
          'Несохранённые ссылки останутся только в открытой форме.',
          [
            {
              label: 'Продолжить редактирование',
              value: 'keep',
              primary: true
            },
            {
              label: 'Закрыть без сохранения',
              value: 'discard',
              danger: true
            }
          ]
        );
        if (choice !== 'discard') return false;
      }
      return closeSettingsImmediately();
    }

    async function saveCabinetSettings() {
      if (
        settingsSaving ||
        !settingsUiState.valid ||
        !settingsUiState.dirty
      ) {
        return null;
      }
      if (!cabinetSettingsStore ||
          typeof cabinetSettingsStore.save !== 'function') {
        settingsUiState.statusMessage =
          'Для сохранения войдите в аккаунт синхронизации.';
        renderSettingsForm();
        return null;
      }

      settingsSaving = true;
      settingsUiState.statusMessage = 'Сохраняю в аккаунт…';
      renderSettingsForm();
      var draft = cloneValue(settingsUiState.draft);
      try {
        var savedState = await cabinetSettingsStore.save(draft);
        applyCabinetSettings(savedState);
        settingsUiState = cabinetSettingsDraft(
          savedState && savedState.settings,
          {},
          cabinetSettingsCore
        );
        settingsUiState.statusMessage = 'Сохранено в аккаунте';
        return savedState;
      } catch (_error) {
        settingsUiState.statusMessage =
          'Не удалось сохранить. Проверьте соединение и повторите.';
        return null;
      } finally {
        settingsSaving = false;
        renderSettingsForm();
      }
    }

    function usePendingCabinetSettings() {
      if (!settingsUiState.pendingRemote) return false;
      var pending = settingsUiState.pendingRemote;
      applyCabinetSettings(pending);
      settingsUiState = cabinetSettingsDraft(
        pending.settings,
        {},
        cabinetSettingsCore
      );
      renderSettingsForm();
      return true;
    }

    function keepCabinetSettingsDraft() {
      if (!settingsUiState.pendingRemote) return false;
      settingsUiState.pendingRemote = null;
      settingsUiState.showRemoteNotice = false;
      renderSettingsForm();
      return true;
    }

    function setLoadingShell(visible, message) {
      var skeleton = byId('schoolLoadingSkeleton');
      var loadingText = byId('schoolLoadingText');
      if (skeleton) skeleton.hidden = !visible;
      if (loadingText) loadingText.textContent = message || 'Загружаю уроки из notion…';
    }

    function setSyncBanner(message, visible) {
      var banner = byId('schoolSyncBanner');
      var textNode = byId('schoolSyncMessage');
      if (textNode) textNode.textContent = message || '';
      if (banner) banner.hidden = !visible;
    }

    function setState(state, title, message) {
      onState(state);
      if (!documentRef) return;
      var app = byId('schoolApp');
      var stateNode = byId('schoolState');
      var ready = byId('schoolReady');
      var showsSchoolShell = state === 'loading' || state === 'ready';
      if (app) app.setAttribute('data-state', state);
      if (app) app.setAttribute('aria-busy', state === 'loading' ? 'true' : 'false');
      if (stateNode) stateNode.hidden = showsSchoolShell;
      if (ready) ready.hidden = !showsSchoolShell;
      setLoadingShell(state === 'loading');
      if (byId('schoolStateTitle')) byId('schoolStateTitle').textContent = title || '';
      if (byId('schoolStateText')) byId('schoolStateText').textContent = message || '';
    }

    function stateFromError(error) {
      if (error && error.status === 401) return 'unauthenticated';
      if (error && error.status === 403) return 'forbidden';
      return 'unavailable';
    }

    function errorCopy(state) {
      if (state === 'unauthenticated') return ['Нужно войти', 'Авторизуйтесь в dashboard, чтобы открыть личную школу.'];
      if (state === 'forbidden') return ['Доступ закрыт', 'Раздел школы доступен только владельцу dashboard.'];
      return ['Школа временно недоступна', 'Не удалось получить уроки. Обновите страницу немного позже.'];
    }

    function renderProgress(model) {
      var progress = model.progress || { completed: 0, total: 0, partial: 0, missed: 0 };
      var progressNode = byId('schoolProgress');
      var metaNode = byId('schoolProgressMeta');
      if (progressNode) progressNode.textContent = 'Выполнено ' + progress.completed + ' из ' + progress.total;
      var meta = [];
      if (progress.partial) meta.push(progress.partial + ' частично');
      if (progress.missed) meta.push(progress.missed + ' пропущено');
      if (metaNode) metaNode.textContent = meta.join(' · ');
    }

    function issueTitle(issue) {
      if (!issue) return 'Требуется проверка';
      return ISSUE_LABELS[issue.code] || 'Требуется проверка данных';
    }

    function lessonTitle(id) {
      var lesson = lessons.find(function (item) { return item.id === id; });
      return lesson ? lesson.title : '';
    }

    function renderDecisionGroup(title, items, persisted) {
      var group = element(documentRef, 'section', 'school-decision-group');
      group.appendChild(element(documentRef, 'h3', '', title + ' — ' + items.length));
      items.forEach(function (item) {
        var row = element(documentRef, 'div', 'school-decision-item');
        if (persisted) {
          row.appendChild(element(documentRef, 'strong', '', item.title));
          row.appendChild(element(documentRef, 'span', '', item.decisionRequest));
        } else {
          var ids = item.lessonIds || (item.lessonId ? [item.lessonId] : []);
          row.appendChild(element(documentRef, 'strong', '', issueTitle(item)));
          var affected = ids.map(lessonTitle).filter(Boolean).join(' · ');
          if (affected) row.appendChild(element(documentRef, 'span', '', affected));
        }
        var actions = element(documentRef, 'div', 'school-decision-actions');
        if (persisted) {
          appendAction(actions, 'Оставить в W01', 'is-primary', function () {
            var clearCommand = decisionQueueCommand(item, true, 'clear');
            return clearCommand ? mutateWithDialogs(clearCommand) : null;
          });
        } else if (item.code === 'multiple-active') {
          appendAction(actions, 'Разрешить состояние', 'is-primary', async function () {
            var activeOptions = (item.lessonIds || []).map(function (lessonId) {
              return {
                label: 'Оставить: ' + (lessonTitle(lessonId) || 'урок'),
                value: lessonId,
                primary: true
              };
            });
            activeOptions.push({ label: 'Отмена', value: 'cancel' });
            var selected = await askAction(
              'Выберите один текущий урок',
              'Остальные активные уроки вернутся в статус «Запланирован».',
              activeOptions
            );
            var resolveCommand = decisionQueueCommand(item, false, selected);
            return resolveCommand ? mutateWithDialogs(resolveCommand) : null;
          });
        } else if (item.lessonId) {
          appendAction(actions, 'Открыть урок', '', function () {
            return openLesson(item.lessonId);
          });
        }
        if (actions.children && actions.children.length) row.appendChild(actions);
        group.appendChild(row);
      });
      return group;
    }

    function renderDecisions(model) {
      var rootNode = byId('schoolDecisions');
      if (!rootNode) return;
      clearNode(rootNode);
      var groupsByPriority = partitionDecisionItems(model);
      var persisted = groupsByPriority.persisted;
      var importantIssues = groupsByPriority.importantIssues;
      var remainingIssues = groupsByPriority.remainingIssues;
      var issues = importantIssues.concat(remainingIssues);
      var count = persisted.length + issues.length;
      var head = element(documentRef, 'header', 'school-decision-head');
      head.appendChild(element(documentRef, 'h2', '', 'Требует решения'));
      head.appendChild(element(documentRef, 'span', 'school-decision-count', String(count)));
      rootNode.appendChild(head);
      if (!count) {
        rootNode.appendChild(element(documentRef, 'div', 'school-decision-ok', 'Всё в порядке — решений не требуется'));
        return;
      }
      var groups = element(documentRef, 'div', 'school-decision-groups');
      if (importantIssues.length) {
        groups.appendChild(renderDecisionGroup('Обнаруженные проблемы · важно', importantIssues, false));
      }
      if (persisted.length) groups.appendChild(renderDecisionGroup('Запрошенные действия', persisted, true));
      if (remainingIssues.length) {
        groups.appendChild(renderDecisionGroup('Обнаруженные проблемы · остальное', remainingIssues, false));
      }
      rootNode.appendChild(groups);
    }

    function renderToday(model) {
      var rootNode = byId('schoolToday');
      if (!rootNode) return;
      clearNode(rootNode);
      var today = model.today || [];
      var activeLessons = model.activeLessons || [];
      var focus = selectTodayFocus(model);
      var metaNode = byId('schoolTodayMeta');
      if (metaNode) metaNode.textContent = today.length ? today.length + ' урока на день' : 'уроков на сегодня нет';

      if (!focus) {
        rootNode.appendChild(element(
          documentRef,
          'div',
          'school-empty',
          activeLessons.length > 1
            ? 'Сейчас активно несколько уроков. Сначала разрешите состояние в разделе «Требует решения».'
            : 'На сегодня и ближайшее время уроков нет.'
        ));
        return;
      }

      var focusSaving = pendingLessonIds.has(focus.id);
      var focusCard = element(
        documentRef,
        'article',
        'school-today-focus'
          + (focus.status === 'В процессе' ? ' is-active' : '')
          + (focusSaving ? ' is-saving' : '')
      );
      focusCard.setAttribute('aria-busy', focusSaving ? 'true' : 'false');
      var copy = element(documentRef, 'div');
      copy.appendChild(element(
        documentRef,
        'p',
        'school-card-kicker',
        focus.status === 'В процессе' ? 'В процессе' : (today.indexOf(focus) !== -1 ? 'Следующий сегодня' : 'Следующий урок')
      ));
      copy.appendChild(element(documentRef, 'h3', '', focus.title));
      appendLessonRoute(copy, documentRef, routeLabelsForLesson(focus));
      var focusMeta = element(documentRef, 'div', 'school-focus-meta');
      focusMeta.appendChild(element(documentRef, 'span', '', focus.subject));
      focusMeta.appendChild(element(documentRef, 'span', '', scheduleText(focus)));
      focusMeta.appendChild(element(documentRef, 'span', '', focus.module));
      if (focusSaving) focusMeta.appendChild(element(documentRef, 'span', 'school-saving-label', 'сохраняется'));
      copy.appendChild(focusMeta);
      focusCard.appendChild(copy);
      var action = element(
        documentRef,
        'button',
        'school-open',
        focus.status === 'В процессе' ? 'Продолжить урок' : 'Открыть урок'
      );
      action.type = 'button';
      action.addEventListener('click', function () { openLesson(focus.id); });
      focusCard.appendChild(action);
      rootNode.appendChild(focusCard);

      var remaining = today.filter(function (lesson) { return lesson.id !== focus.id; });
      if (remaining.length) {
        var list = element(documentRef, 'div', 'school-today-list');
        remaining.forEach(function (lesson) {
          list.appendChild(makeLessonCard(
            documentRef,
            lesson,
            openLesson,
            null,
            configureDraggable,
            pendingLessonIds,
            null,
            routeLabelsForLesson(lesson)
          ));
        });
        rootNode.appendChild(list);
      }
    }

    function setMobileDay(date) {
      mobileDay = date;
      if (!documentRef) return;
      documentRef.querySelectorAll('[data-school-day]').forEach(function (node) {
        var selected = node.getAttribute('data-school-day') === date;
        node.classList.toggle('is-mobile-active', selected);
        if (node.classList.contains('school-mobile-day')) {
          node.classList.toggle('is-active', selected);
          node.setAttribute('aria-pressed', selected ? 'true' : 'false');
        }
      });
    }

    function renderWeek(model) {
      var rootNode = byId('schoolWeek');
      var mobileRoot = byId('schoolMobileDays');
      if (!rootNode || !mobileRoot) return;
      timelineGeometryRegistry = null;
      clearNode(rootNode);
      clearNode(mobileRoot);
      var currentDay = localDateKey(now());
      if (WEEK_DAYS.some(function (day) { return day.date === currentDay; })) mobileDay = currentDay;
      var conflictIds = new Set();
      var shortBreakIds = new Set();
      (model.runtimeIssues || []).forEach(function (issue) {
        if (issue.code === 'overlap') {
          (issue.lessonIds || []).forEach(function (lessonId) { conflictIds.add(lessonId); });
        }
        if (issue.code === 'short-break') {
          (issue.lessonIds || []).forEach(function (lessonId) { shortBreakIds.add(lessonId); });
        }
      });
      var timedLessons = lessons.filter(function (lesson) {
        return lesson.schedule && lesson.schedule.kind === 'timed';
      });
      var bounds = getWeekTimeBounds(timedLessons);
      var zoomLevel = {
        label: core.timelineZoomLabel(timelineScale),
        pixelsPerHour: core.timelinePixelsPerHour(timelineScale),
        snapMinutes: core.timelineSnapMinutesForScale(timelineScale)
      };
      var startMinute = bounds.startHour * 60;
      var endMinute = bounds.endHour * 60;
      var timelineHeight = core.timelineYForMinute(
        endMinute,
        startMinute,
        zoomLevel.pixelsPerHour
      );
      var weekMeta = byId('schoolWeekTimeMeta');
      if (weekMeta) {
        var weekMetaText = String(bounds.startHour).padStart(2, '0') + ':00–'
          + String(bounds.endHour).padStart(2, '0') + ':00 · Asia/Yekaterinburg';
        weekMeta.textContent = weekMetaText;
        weekMeta.setAttribute('data-default-text', weekMetaText);
      }
      var zoomLabel = byId('schoolZoomLabel');
      var zoomOut = byId('schoolZoomOut');
      var zoomIn = byId('schoolZoomIn');
      if (zoomLabel) zoomLabel.textContent = zoomLevel.label;
      if (zoomOut) zoomOut.disabled = targetTimelineScale <= 1;
      if (zoomIn) zoomIn.disabled = targetTimelineScale >= 3;

      WEEK_DAYS.forEach(function (day) {
        var dayButton = element(documentRef, 'button', 'school-mobile-day', day.short + ' ' + day.date.slice(-2));
        dayButton.type = 'button';
        dayButton.setAttribute('data-school-day', day.date);
        dayButton.setAttribute('aria-pressed', 'false');
        dayButton.addEventListener('click', function () { setMobileDay(day.date); });
        mobileRoot.appendChild(dayButton);
      });

      var scheduledByDay = model.weekDays || {};
      var shell = element(documentRef, 'div', 'school-week-shell');
      var head = element(documentRef, 'div', 'school-week-head');
      WEEK_DAYS.forEach(function (day) {
        var dayHead = element(documentRef, 'div', 'school-week-day-head');
        dayHead.setAttribute('data-school-day', day.date);
        dayHead.appendChild(element(documentRef, 'strong', '', day.short));
        dayHead.appendChild(element(documentRef, 'span', '', day.label));
        head.appendChild(dayHead);
      });
      shell.appendChild(head);
      shell.appendChild(element(documentRef, 'div', 'school-all-day-label', 'Без времени'));

      var allDayGrid = element(documentRef, 'div', 'school-all-day-grid');
      WEEK_DAYS.forEach(function (day) {
        var dayColumn = element(documentRef, 'div', 'school-day-all');
        dayColumn.setAttribute('data-school-day', day.date);
        (scheduledByDay[day.date] || []).filter(function (lesson) {
          return lesson.schedule.kind === 'date-only';
        }).forEach(function (lesson) {
          var allDayCard = makeLessonCard(
            documentRef,
            lesson,
            openLesson,
            conflictIds,
            configureDraggable,
            pendingLessonIds,
            shortBreakIds,
            routeLabelsForLesson(lesson)
          );
          configureAllDayDropTarget(allDayCard, day.date, lesson);
          dayColumn.appendChild(allDayCard);
        });
        configureDropZone(dayColumn, day.date, 'date-only');
        allDayGrid.appendChild(dayColumn);
      });
      shell.appendChild(allDayGrid);

      var timeShell = element(documentRef, 'div', 'school-time-shell');
      timeShell.id = 'schoolTimeShell';
      var geometryRegistry = {
        shell: timeShell,
        startMinute: startMinute,
        endMinute: endMinute,
        labels: [],
        lines: [],
        cards: []
      };
      timeShell.style.setProperty('--school-time-height', timelineHeight + 'px');
      var labels = element(documentRef, 'div', 'school-time-labels');
      for (var hour = bounds.startHour; hour <= bounds.endHour; hour += 1) {
        var label = element(documentRef, 'span', 'school-hour-label', String(hour).padStart(2, '0') + ':00');
        label.style.top = core.timelineYForMinute(
          hour * 60,
          startMinute,
          zoomLevel.pixelsPerHour
        ) + 'px';
        labels.appendChild(label);
        geometryRegistry.labels.push({ node: label, minute: hour * 60 });
      }
      timeShell.appendChild(labels);

      var columns = element(documentRef, 'div', 'school-time-columns');
      for (var minute = startMinute; minute <= endMinute; minute += 5) {
        var minuteInHour = minute % 60;
        var lineKind = ' is-hour';
        if (minuteInHour === 30) lineKind = ' is-half';
        else if (minuteInHour === 15 || minuteInHour === 45) lineKind = ' is-quarter';
        else if (minuteInHour % 10 === 0 && minuteInHour !== 0) lineKind = ' is-ten';
        else if (minuteInHour !== 0) lineKind = ' is-five';
        var line = element(documentRef, 'span', 'school-time-line' + lineKind);
        line.style.top = core.timelineYForMinute(
          minute,
          startMinute,
          zoomLevel.pixelsPerHour
        ) + 'px';
        columns.appendChild(line);
        geometryRegistry.lines.push({ node: line, minute: minute });
      }
      WEEK_DAYS.forEach(function (day) {
        var timeDay = element(documentRef, 'div', 'school-time-day');
        timeDay.setAttribute('data-school-day', day.date);
        var dayTimed = (scheduledByDay[day.date] || []).filter(function (lesson) {
          return lesson.schedule.kind === 'timed';
        });
        layoutTimedLessons(dayTimed, zoomLevel.pixelsPerHour).forEach(function (layout) {
          var lesson = layout.lesson;
          var start = timeMinutes(lesson.schedule.start);
          var card = element(documentRef, 'button', 'school-time-card');
          card.type = 'button';
          card.style.top = Math.max(
            0,
            core.timelineYForMinute(start, startMinute, zoomLevel.pixelsPerHour)
          ) + 'px';
          card.style.height = core.timelineYForMinute(
            layout.visualEnd,
            start,
            zoomLevel.pixelsPerHour
          ) + 'px';
          card.style.left = 'calc(' + (layout.lane * 100 / layout.laneCount) + '% + 4px)';
          card.style.width = 'calc(' + (100 / layout.laneCount) + '% - 8px)';
          card.setAttribute('aria-label', 'Открыть урок: ' + lesson.title);
          card.addEventListener('click', function () { openLesson(lesson.id); });
          appendLessonDetails(
            card,
            documentRef,
            lesson,
            conflictIds,
            pendingLessonIds.has(lesson.id),
            shortBreakIds,
            routeLabelsForLesson(lesson)
          );
          configureDraggable(card, lesson);
          timeDay.appendChild(card);
          geometryRegistry.cards.push({
            node: card,
            startMinute: start,
            endMinute: timeMinutes(lesson.schedule.end)
          });
        });
        configureDropZone(timeDay, day.date, 'timed', bounds);
        columns.appendChild(timeDay);
      });
      timeShell.appendChild(columns);
      timeShell.addEventListener('wheel', function (event) {
        handleTimelineWheel(event, timeShell, bounds);
      }, { passive: false });
      timelineGeometryRegistry = geometryRegistry;
      applyTimelineGeometry(core, geometryRegistry, zoomLevel.pixelsPerHour / 60);
      shell.appendChild(timeShell);
      rootNode.appendChild(shell);

      var unscheduled = lessons.filter(function (lesson) {
        return lesson.schedule && lesson.schedule.kind === 'unscheduled';
      });
      if (unscheduled.length) {
        var details = element(documentRef, 'details', 'school-unscheduled');
        details.appendChild(element(documentRef, 'summary', '', 'Нераспределённые · ' + unscheduled.length));
        var list = element(documentRef, 'div', 'school-unscheduled-list');
        unscheduled.forEach(function (lesson) {
          list.appendChild(makeLessonCard(
            documentRef,
            lesson,
            openLesson,
            conflictIds,
            configureDraggable,
            pendingLessonIds,
            shortBreakIds,
            routeLabelsForLesson(lesson)
          ));
        });
        details.appendChild(list);
        configureDropZone(details, null, 'unscheduled');
        rootNode.appendChild(details);
      }
      setMobileDay(mobileDay);
    }

    function renderDiary(model) {
      var rootNode = byId('schoolDiary');
      if (!rootNode) return;
      clearNode(rootNode);
      var groups = groupDiaryLessons(model.diary || []);
      if (!groups.length) {
        rootNode.appendChild(element(documentRef, 'div', 'school-empty', 'В дневнике пока нет завершённых занятий.'));
        return;
      }
      var list = element(documentRef, 'div', 'school-diary');
      var columnLabels = ['Дата', 'Предмет', 'Урок', 'Результат', 'Автономность', 'Понимание'];
      groups.forEach(function (group) {
        var section = element(documentRef, 'section', 'school-diary-group');
        section.appendChild(element(documentRef, 'h3', 'school-diary-group-title', dateText(group.date)));
        var headings = element(documentRef, 'div', 'school-diary-columns');
        columnLabels.forEach(function (label) {
          headings.appendChild(element(documentRef, 'span', '', label));
        });
        section.appendChild(headings);
        group.lessons.forEach(function (lesson) {
          var scores = diaryScores(lesson);
          var row = element(documentRef, 'button', 'school-diary-row');
          row.type = 'button';
          row.setAttribute('aria-label', 'Открыть запись: ' + lesson.title);
          row.addEventListener('click', function () { openLesson(lesson.id); });
          row.appendChild(element(documentRef, 'span', 'school-diary-date', dateText(lesson.schedule.date)));
          row.appendChild(element(documentRef, 'span', 'school-diary-subject', lesson.subject));
          row.appendChild(element(documentRef, 'strong', 'school-diary-title', lesson.title));
          row.appendChild(element(
            documentRef,
            'span',
            'school-diary-result' + (lesson.status === 'Пропущен' ? ' is-missed' : ''),
            diaryResult(lesson)
          ));
          row.appendChild(element(documentRef, 'span', 'school-diary-score', scores.autonomy));
          row.appendChild(element(
            documentRef,
            'span',
            'school-diary-score',
            scores.understanding
          ));
          section.appendChild(row);
        });
        list.appendChild(section);
      });
      rootNode.appendChild(list);
    }

    function render(model) {
      readModel = model;
      if (!documentRef) return model;
      renderProgress(model);
      renderDecisions(model);
      renderToday(model);
      renderWeek(model);
      renderDiary(model);
      selectView(currentView);
      setState('ready');
      return model;
    }

    function buildModel() {
      readModel = core.buildReadModel(lessons, {
        activeWeek: ACTIVE_WEEK,
        now: now(),
        timeZone: TIME_ZONE
      });
      return render(readModel);
    }

    function timelineZoomSettings(scale) {
      return {
        label: core.timelineZoomLabel(scale),
        pixelsPerHour: core.timelinePixelsPerHour(scale),
        snapMinutes: core.timelineSnapMinutesForScale(scale)
      };
    }

    function createTimelineAnchor(timeShell, bounds, clientY) {
      if (!timeShell || typeof timeShell.getBoundingClientRect !== 'function') return null;
      var rect = timeShell.getBoundingClientRect();
      var pixelsPerHour = core.timelinePixelsPerHour(timelineScale);
      return {
        minute: bounds.startHour * 60
          + (clientY - rect.top) / pixelsPerHour * 60,
        clientY: clientY,
        bounds: bounds
      };
    }

    function updateTimelineZoomControls() {
      var zoomLabel = byId('schoolZoomLabel');
      var zoomOut = byId('schoolZoomOut');
      var zoomIn = byId('schoolZoomIn');
      if (zoomLabel) zoomLabel.textContent = core.timelineZoomLabel(timelineScale);
      if (zoomOut) zoomOut.disabled = targetTimelineScale <= 1;
      if (zoomIn) zoomIn.disabled = targetTimelineScale >= 3;
    }

    function restoreTimelineAnchor(anchor) {
      if (!anchor || !runtime || typeof runtime.scrollBy !== 'function') return;
      var shell = byId('schoolTimeShell');
      if (!shell || typeof shell.getBoundingClientRect !== 'function') return;
      var rect = shell.getBoundingClientRect();
      var nextY = core.timelineYForMinute(
        anchor.minute,
        anchor.bounds.startHour * 60,
        core.timelinePixelsPerHour(timelineScale)
      );
      var delta = rect.top + nextY - anchor.clientY;
      if (Math.abs(delta) > 0.001) runtime.scrollBy(0, delta);
    }

    function applyCurrentTimelineScale(scale, anchor) {
      timelineScale = Math.max(1, Math.min(3, Number(scale) || 1));
      if (timelineGeometryRegistry) {
        applyTimelineGeometry(core, timelineGeometryRegistry, timelineScale);
      }
      updateTimelineZoomControls();
      restoreTimelineAnchor(anchor);
    }

    function prefersReducedTimelineMotion() {
      return Boolean(
        runtime &&
        typeof runtime.matchMedia === 'function' &&
        runtime.matchMedia('(prefers-reduced-motion: reduce)').matches
      );
    }

    function clearTimelineZoomFrame() {
      if (
        timelineZoomFrame !== null &&
        runtime &&
        typeof runtime.cancelAnimationFrame === 'function'
      ) {
        runtime.cancelAnimationFrame(timelineZoomFrame);
      }
      timelineZoomFrame = null;
    }

    function finishTimelineZoom(anchorOverride) {
      var anchor = anchorOverride || (timelineZoomAnimation && timelineZoomAnimation.anchor);
      clearTimelineZoomFrame();
      timelineZoomAnimation = null;
      timelineWheelDelta = 0;
      applyCurrentTimelineScale(targetTimelineScale, anchor);
      var shell = byId('schoolTimeShell');
      if (shell) shell.classList.remove('is-zooming');
    }

    function consumePendingTimelineWheel(anchor, timestamp) {
      var consumed = core.consumeTimelineWheel(timelineWheelDelta);
      if (!consumed.steps) return false;
      timelineWheelDelta = consumed.remainder;
      var nextTarget = core.normalizeTimelineScale(
        targetTimelineScale + consumed.steps * 0.1
      );
      if (nextTarget === targetTimelineScale) {
        timelineWheelDelta = 0;
        return false;
      }
      targetTimelineScale = nextTarget;
      timelineZoomAnimation = {
        from: timelineScale,
        to: targetTimelineScale,
        startTime: Number.isFinite(timestamp) ? timestamp : null,
        duration: 160,
        anchor: anchor
      };
      return true;
    }

    function runTimelineZoomFrame(timestamp) {
      timelineZoomFrame = null;
      if (!timelineZoomAnimation) return;
      var anchor = timelineZoomAnimation.anchor;
      if (Math.abs(timelineWheelDelta) >= 60) {
        consumePendingTimelineWheel(anchor, timestamp);
      }
      var animation = timelineZoomAnimation;
      if (animation.startTime === null) animation.startTime = timestamp;
      var progress = animation.duration > 0
        ? Math.max(0, Math.min(1, (timestamp - animation.startTime) / animation.duration))
        : 1;
      var eased = core.easeOutTimelineZoom(progress);
      var nextScale = animation.from + (animation.to - animation.from) * eased;
      applyCurrentTimelineScale(nextScale, anchor);
      if (progress >= 1) {
        timelineScale = animation.to;
        timelineZoomAnimation = null;
        var shell = byId('schoolTimeShell');
        if (shell) shell.classList.remove('is-zooming');
        return;
      }
      timelineZoomFrame = runtime.requestAnimationFrame(runTimelineZoomFrame);
    }

    function setTimelineZoomTarget(nextScale, anchor) {
      var normalized = core.normalizeTimelineScale(nextScale);
      if (normalized === targetTimelineScale && !timelineZoomAnimation) return false;
      targetTimelineScale = normalized;
      if (
        prefersReducedTimelineMotion() ||
        !runtime ||
        typeof runtime.requestAnimationFrame !== 'function'
      ) {
        finishTimelineZoom(anchor);
        return true;
      }
      timelineZoomAnimation = {
        from: timelineScale,
        to: targetTimelineScale,
        startTime: null,
        duration: 160,
        anchor: anchor
      };
      var shell = byId('schoolTimeShell');
      if (shell) shell.classList.add('is-zooming');
      if (timelineZoomFrame === null) {
        timelineZoomFrame = runtime.requestAnimationFrame(runTimelineZoomFrame);
      }
      updateTimelineZoomControls();
      return true;
    }

    function handleTimelineWheel(event, timeShell, bounds) {
      if (!event || !event.deltaY) return;
      var zoomDelta = -Number(event.deltaY);
      var canZoom = zoomDelta > 0 ? targetTimelineScale < 3 : targetTimelineScale > 1;
      if (!canZoom) {
        timelineWheelDelta = 0;
        return;
      }
      event.preventDefault();
      var anchor = createTimelineAnchor(timeShell, bounds, event.clientY);
      timelineWheelDelta = core.accumulateTimelineWheel(timelineWheelDelta, zoomDelta);
      var consumed = core.consumeTimelineWheel(timelineWheelDelta);
      if (!consumed.steps) return;
      timelineWheelDelta = consumed.remainder;
      setTimelineZoomTarget(
        targetTimelineScale + consumed.steps * 0.1,
        anchor
      );
    }

    function zoomTimelineFromButton(direction) {
      timelineWheelDelta = 0;
      var nextScale = core.nextTimelineLandmark(targetTimelineScale, direction);
      if (nextScale === targetTimelineScale) return;
      var timeShell = byId('schoolTimeShell');
      if (!timeShell || typeof timeShell.getBoundingClientRect !== 'function') {
        setTimelineZoomTarget(nextScale, null);
        return;
      }
      var bounds = getWeekTimeBounds(lessons.filter(function (lesson) {
        return lesson.schedule && lesson.schedule.kind === 'timed';
      }));
      var rect = timeShell.getBoundingClientRect();
      var viewportHeight = runtime && Number.isFinite(runtime.innerHeight)
        ? runtime.innerHeight
        : rect.bottom;
      var visibleTop = Math.max(0, rect.top);
      var visibleBottom = Math.min(viewportHeight, rect.bottom);
      var clientY = visibleBottom > visibleTop
        ? (visibleTop + visibleBottom) / 2
        : rect.top + Math.max(0, rect.height || 0) / 2;
      setTimelineZoomTarget(
        nextScale,
        createTimelineAnchor(timeShell, bounds, clientY)
      );
    }

    function rebuildVisibleLessons() {
      lessons = optimisticMutations.reduce(function (items, entry) {
        return entry.reducer(cloneLessons(items));
      }, cloneLessons(confirmedLessons));
      return buildModel();
    }

    function affectedLessonIds(command) {
      var ids = [];
      if (command && command.lessonId) ids.push(command.lessonId);
      if (command && command.previousLessonId) ids.push(command.previousLessonId);
      if (command && command.newLessonId) ids.push(command.newLessonId);
      if (command && command.keepLessonId) ids.push(command.keepLessonId);
      if (command && command.operation === 'resolveActiveLessons') {
        lessons.forEach(function (lesson) {
          if (lesson.status === 'В процессе') ids.push(lesson.id);
        });
      }
      return ids.filter(function (id, index) {
        return id && ids.indexOf(id) === index;
      });
    }

    async function revalidateAfterMutation() {
      var generation = ++revalidationGeneration;
      var latestLessons;
      try {
        latestLessons = await api.listLessons({ week: ACTIVE_WEEK });
      } catch (error) {
        if (generation !== revalidationGeneration) return readModel;
        throw error;
      }
      if (generation !== revalidationGeneration) return readModel;
      confirmedLessons = latestLessons;
      var model = rebuildVisibleLessons();
      setSyncBanner('', false);
      return model;
    }

    async function retryRevalidation() {
      setSyncBanner('Повторно читаю уроки из notion…', true);
      try {
        return await revalidateAfterMutation();
      } catch (error) {
        setSyncBanner('Контрольное чтение снова не удалось. Попробуйте ещё раз.', true);
        throw error;
      }
    }

    function runMutation(command, optimisticReducer) {
      var reducer = typeof optimisticReducer === 'function'
        ? optimisticReducer
        : function (items) { return items; };
      var entry = {
        id: 'school-mutation-' + (++mutationSequence),
        keys: affectedLessonIds(command),
        command: command,
        reducer: reducer
      };
      optimisticMutations.push(entry);
      rebuildVisibleLessons();
      return queue.enqueue(entry);
    }

    function optimisticLessons(command) {
      return function (items) {
        return items.map(function (lesson) {
          var matches = lesson.id === command.lessonId ||
            command.operation === 'switchActiveLesson' &&
              (lesson.id === command.previousLessonId || lesson.id === command.newLessonId) ||
            command.operation === 'resolveActiveLessons' &&
              lesson.status === 'В процессе';
          if (!matches) return lesson;
          var next = Object.assign({}, lesson);
          if (command.operation === 'startLesson' || command.operation === 'reopenLesson') {
            next.status = 'В процессе';
          } else if (command.operation === 'switchActiveLesson') {
            next.status = lesson.id === command.newLessonId ? 'В процессе' : 'Запланирован';
          } else if (command.operation === 'resolveActiveLessons') {
            next.status = lesson.id === command.keepLessonId ? 'В процессе' : 'Запланирован';
          } else if (command.operation === 'completeLesson') {
            next.status = command.status;
            next.result = command.status === 'Пропущен'
              ? null
              : (command.status === 'Частично выполнен' ? 'Требует повторения' : (command.result || 'Зачёт'));
            next.autonomy = command.status === 'Пропущен' ? null : command.autonomy;
            next.understanding = command.status === 'Пропущен' ? null : command.understanding;
            next.missedReason = command.status === 'Пропущен' ? command.missedReason : null;
            if (command.comment !== undefined) next.comment = command.comment;
            if (command.artifactUrl !== undefined) next.artifactUrl = command.artifactUrl;
          } else if (command.operation === 'cancelLesson') {
            next.status = 'Отменён';
            next.decisionRequest = null;
          } else if (command.operation === 'restoreCancelledLesson' || command.operation === 'correctMissedStatus') {
            next.status = 'Запланирован';
            if (command.operation === 'correctMissedStatus') next.missedReason = null;
          } else if (command.operation === 'clearLearningEvidence') {
            next.result = null;
            next.autonomy = null;
            next.understanding = null;
            next.comment = '';
            next.artifactUrl = null;
          } else if (
            command.operation === 'moveLesson' ||
            command.operation === 'pauseAndMoveLesson' ||
            command.operation === 'restoreMissedLesson'
          ) {
            var previousDate = lesson.schedule && lesson.schedule.date;
            next.schedule = core.scheduleForDestination(command.destination, lesson.durationMinutes);
            next.order = command.order;
            next.status = next.schedule.kind === 'unscheduled'
              ? 'Нераспределён'
              : (command.operation === 'moveLesson' && lesson.status === 'В процессе'
                ? 'В процессе'
                : 'Запланирован');
            if (previousDate && next.schedule.date && previousDate !== next.schedule.date) {
              next.moveCount = (lesson.moveCount || 0) + 1;
            }
            if (command.operation === 'restoreMissedLesson') {
              next.result = null;
              next.autonomy = null;
              next.understanding = null;
              next.missedReason = null;
            }
          } else if (command.operation === 'unscheduleLesson') {
            next.schedule = { kind: 'unscheduled', date: null, start: null, end: null };
            next.status = 'Нераспределён';
            next.order = command.order;
          } else if (command.operation === 'changeLessonDuration') {
            next.durationMinutes = command.durationMinutes;
            if (lesson.schedule && lesson.schedule.kind === 'timed') {
              next.schedule = core.scheduleForDestination({
                kind: 'timed',
                start: lesson.schedule.start
              }, command.durationMinutes);
            }
          } else if (command.operation === 'reorderLesson') {
            next.order = command.order;
          } else if (command.operation === 'requestCrossWeekMove') {
            next.decisionRequest = 'Перенос между неделями';
          } else if (command.operation === 'clearDecisionRequest') {
            next.decisionRequest = null;
          }
          return next;
        });
      };
    }

    function actionDialogOpen() {
      var actionDialog = byId('schoolActionDialog');
      return Boolean(actionDialog && !actionDialog.hidden);
    }

    function closeActionDialog(choice) {
      var dialog = byId('schoolActionDialog');
      if (dialog) {
        dialog.hidden = true;
        dialog.setAttribute('aria-hidden', 'true');
      }
      var resolve = actionResolver;
      actionResolver = null;
      if (resolve) resolve(choice || 'cancel');
      var lessonDialog = byId('schoolLessonDialog');
      var settingsDialog = byId('schoolSettingsDialog');
      var hasParentDialog = Boolean(
        lessonDialog && !lessonDialog.hidden ||
        settingsDialog && !settingsDialog.hidden
      );
      if (!hasParentDialog) {
        setBackgroundInert(false);
      }
      if (
        actionPreviousFocus &&
        typeof actionPreviousFocus.focus === 'function'
      ) {
        actionPreviousFocus.focus();
      }
      actionPreviousFocus = null;
      if (
        dialogKeyHandler &&
        !hasParentDialog &&
        documentRef
      ) {
        documentRef.removeEventListener('keydown', dialogKeyHandler);
        dialogKeyHandler = null;
      }
    }

    function askAction(title, message, actions, details) {
      if (!documentRef || !byId('schoolActionDialog')) return Promise.resolve('cancel');
      if (actionResolver) closeActionDialog('cancel');
      byId('schoolActionTitle').textContent = title;
      byId('schoolActionMessage').textContent = message || '';
      byId('schoolActionDetails').textContent = details || '';
      var actionRoot = byId('schoolActionButtons');
      clearNode(actionRoot);
      return new Promise(function (resolve) {
        actionResolver = resolve;
        (actions || []).forEach(function (action) {
          var button = element(
            documentRef,
            'button',
            (action.primary ? 'is-primary' : '') + (action.danger ? ' is-danger' : ''),
            action.label
          );
          button.type = 'button';
          button.addEventListener('click', function () {
            closeActionDialog(action.value);
          });
          actionRoot.appendChild(button);
        });
        var dialog = byId('schoolActionDialog');
        var lessonDialog = byId('schoolLessonDialog');
        var settingsDialog = byId('schoolSettingsDialog');
        actionPreviousFocus = documentRef.activeElement;
        if (
          (!lessonDialog || lessonDialog.hidden) &&
          (!settingsDialog || settingsDialog.hidden)
        ) {
          setBackgroundInert(true);
        }
        dialog.hidden = false;
        dialog.setAttribute('aria-hidden', 'false');
        installDialogKeys(dialog);
        var first = actionRoot.firstChild;
        if (first && typeof first.focus === 'function') first.focus();
      });
    }

    function setMutationMessage(value) {
      var node = byId('schoolContentState');
      if (node) node.textContent = value || '';
    }

    async function mutateWithDialogs(command) {
      try {
        setMutationMessage('Сохраняю изменения…');
        var result = await runMutation(command, optimisticLessons(command));
        setMutationMessage('Сохранено в Notion.');
        if (currentContentLessonId) renderLessonControls(
          lessons.find(function (lesson) { return lesson.id === currentContentLessonId; })
        );
        return result;
      } catch (error) {
        setMutationMessage('');
        if (!documentRef) throw error;
        if (error && error.code === 'ACTIVE_LESSON_EXISTS' && error.details && error.details.activeLesson) {
          var active = error.details.activeLesson;
          var activeChoice = await askAction(
            'Сейчас уже идёт урок: ' + active.title,
            'Одновременно активным может быть только один урок.',
            [
              { label: 'Продолжить текущий', value: 'continue', primary: true },
              { label: 'Приостановить и начать новый', value: 'switch' },
              { label: 'Отмена', value: 'cancel' }
            ]
          );
          if (activeChoice === 'continue') return openLesson(active.id);
          if (activeChoice === 'switch') {
            return mutateWithDialogs({
              operation: 'switchActiveLesson',
              previousLessonId: active.id,
              newLessonId: command.lessonId
            });
          }
          return null;
        }
        if (error && error.code === 'LESSON_TIME_CONFLICT') {
          var conflicts = error.details && Array.isArray(error.details.conflicts)
            ? error.details.conflicts
            : [];
          var conflictText = conflicts.map(function (item) {
            return scheduleRange(item.start, item.end) + ' — ' + item.title;
          }).join('\n');
          var overlapChoice = await askAction(
            'Это время пересекается с другим уроком',
            'Выберите другое время, поставьте урок после пересечения или сохраните осознанно.',
            [
              { label: 'Выбрать другое время', value: 'change', primary: true },
              { label: 'Поставить после него', value: 'after' },
              { label: 'Всё равно сохранить', value: 'allow', danger: true }
            ],
            conflictText
          );
          var retryCommand = commandAfterOverlapChoice(command, error, overlapChoice);
          return retryCommand ? mutateWithDialogs(retryCommand) : null;
        }
        if (error && error.code === 'CROSS_WEEK_MOVE_REQUIRES_REVIEW') {
          var crossWeekChoice = await askAction(
            'Перенос между учебными неделями пока выполняется через недельную ревизию',
            'Дата урока останется без изменений.',
            [
              { label: 'Вернуть обратно', value: 'cancel', primary: true },
              { label: 'Отметить для переноса', value: 'mark' }
            ]
          );
          return crossWeekChoice === 'mark'
            ? mutateWithDialogs({
              operation: 'requestCrossWeekMove',
              lessonId: command.lessonId
            })
            : null;
        }
        if (error && error.code === 'SCHOOL_MUTATION_IN_PROGRESS') {
          var retry = await askAction(
            'Изменение ещё сохраняется',
            'Другая операция с активным уроком ещё выполняется.',
            [
              { label: 'Повторить', value: 'retry', primary: true },
              { label: 'Отмена', value: 'cancel' }
            ]
          );
          return retry === 'retry' ? mutateWithDialogs(command) : null;
        }
        setMutationMessage('Не удалось сохранить изменение.');
        throw error;
      }
    }

    function currentLesson() {
      return lessons.find(function (lesson) {
        return lesson.id === currentContentLessonId;
      }) || null;
    }

    function controlValue(id) {
      var node = byId(id);
      return node && typeof node.value === 'string' ? node.value : '';
    }

    function selectedDestination(forceDateOnly) {
      var date = controlValue('schoolLessonDate');
      var time = controlValue('schoolLessonTime');
      if (!date) return null;
      if (forceDateOnly || !time) return { kind: 'date-only', date: date };
      return {
        kind: 'timed',
        start: date + 'T' + time + ':00+05:00'
      };
    }

    function appendAction(rootNode, label, className, action) {
      if (!rootNode) return;
      var button = element(documentRef, 'button', className || '', label);
      button.type = 'button';
      button.addEventListener('click', function () {
        Promise.resolve().then(action).catch(function () {
          setMutationMessage('Не удалось выполнить действие.');
        });
      });
      rootNode.appendChild(button);
    }

    async function runDropTransition(transition) {
      if (!transition || transition.kind === 'blocked') {
        var status = transition && transition.status;
        var title = status === 'Отменён' ? 'Урок отменён' : 'Урок уже завершён';
        var blockedChoice = await askAction(
          title,
          status === 'Отменён'
            ? 'Сначала верните урок в расписание.'
            : 'Дата результата является частью истории дневника.',
          status === 'Отменён'
            ? [
              { label: 'Вернуть в расписание', value: 'restore', primary: true },
              { label: 'Отмена', value: 'cancel' }
            ]
            : [
              { label: 'Открыть запись', value: 'open', primary: true },
              { label: 'Вернуть к редактированию', value: 'reopen' },
              { label: 'Отмена', value: 'cancel' }
            ]
        );
        var blockedLesson = currentLesson();
        if (!blockedLesson && transition && transition.lessonId) {
          blockedLesson = lessons.find(function (item) { return item.id === transition.lessonId; });
        }
        if (blockedChoice === 'open' && blockedLesson) return openLesson(blockedLesson.id);
        if (blockedChoice === 'reopen' && blockedLesson) {
          return mutateWithDialogs({ operation: 'reopenLesson', lessonId: blockedLesson.id });
        }
        if (blockedChoice === 'restore' && blockedLesson) {
          return mutateWithDialogs({ operation: 'restoreCancelledLesson', lessonId: blockedLesson.id });
        }
        return null;
      }
      if (transition.kind === 'pause-confirm') {
        var pauseChoice = await askAction(
          'Урок сейчас находится в процессе',
          'Чтобы перенести его на другой день или в нераспределённые, сначала приостановите урок.',
          [
            { label: 'Оставить активным', value: 'cancel', primary: true },
            { label: 'Приостановить и перенести', value: 'pause' },
            { label: 'Отмена', value: 'cancel' }
          ]
        );
        return pauseChoice === 'pause'
          ? mutateWithDialogs(transition.command)
          : null;
      }
      if (transition.kind === 'restore-confirm') {
        if (transition.command.destination.kind === 'unscheduled') return null;
        var restoreChoice = await askAction(
          'Вернуть пропущенный урок в расписание?',
          'Причина пропуска и старые оценочные поля будут очищены по правилам школы.',
          [
            { label: 'Перенести и вернуть', value: 'restore', primary: true },
            { label: 'Отмена', value: 'cancel' }
          ]
        );
        return restoreChoice === 'restore'
          ? mutateWithDialogs(transition.command)
          : null;
      }
      return mutateWithDialogs(transition.command);
    }

    function orderAtEnd(date, scheduleKind) {
      var sameZone = lessons.filter(function (lesson) {
        if (!lesson.schedule || lesson.schedule.kind !== scheduleKind) return false;
        return scheduleKind === 'unscheduled' || lesson.schedule.date === date;
      });
      var last = sameZone.reduce(function (maximum, lesson) {
        return Math.max(maximum, Number(lesson.order) || 0);
      }, 0);
      return last ? last + 100 : 100;
    }

    async function moveLessonTo(lesson, destination, order) {
      var transition = commandForDrop(lesson, destination, order);
      if (transition.kind === 'blocked') {
        transition = Object.assign({}, transition, {
          lessonId: lesson.id
        });
      }
      return runDropTransition(transition);
    }

    function resetTimelineDragMeta() {
      var preview = byId('schoolWeekTimeMeta');
      if (preview) preview.textContent = preview.getAttribute('data-default-text') || preview.textContent;
    }

    function removeDragPreviewNode(node) {
      if (node && node.parentNode && typeof node.parentNode.removeChild === 'function') {
        node.parentNode.removeChild(node);
      }
    }

    function clearTimelineDragPreview() {
      if (!activeTimelineDragPreview) return;
      removeDragPreviewNode(activeTimelineDragPreview.previewNode);
      removeDragPreviewNode(activeTimelineDragPreview.lineNode);
      activeTimelineDragPreview = null;
    }

    function ensureTransparentDragImage() {
      if (transparentDragImage || !documentRef || !documentRef.body) return transparentDragImage;
      transparentDragImage = element(documentRef, 'span', 'school-drag-image');
      transparentDragImage.setAttribute('aria-hidden', 'true');
      documentRef.body.appendChild(transparentDragImage);
      return transparentDragImage;
    }

    function renderTimelineDragPreview(node, lesson, day, clientY, rect, bounds, zoomLevel) {
      var preview = timelineDragPreview(
        core,
        lesson,
        day,
        clientY,
        rect,
        bounds,
        zoomLevel
      );
      if (
        activeTimelineDragPreview &&
        activeTimelineDragPreview.node === node &&
        activeTimelineDragPreview.lessonId === lesson.id &&
        activeTimelineDragPreview.destination.start === preview.destination.start
      ) {
        return activeTimelineDragPreview.preview;
      }

      clearTimelineDragPreview();
      var nodes = makeTimelineDragPreviewNodes(documentRef, lesson, preview);
      node.appendChild(nodes.lineNode);
      node.appendChild(nodes.previewNode);
      activeTimelineDragPreview = {
        node: node,
        lessonId: lesson.id,
        destination: preview.destination,
        preview: preview,
        previewNode: nodes.previewNode,
        lineNode: nodes.lineNode
      };
      return preview;
    }

    function configureDraggable(card, lesson) {
      var saving = pendingLessonIds.has(lesson.id);
      var draggable = isLessonDraggable(lesson) && !saving;
      card.draggable = draggable;
      card.classList.toggle('is-saving', saving);
      card.setAttribute('aria-busy', saving ? 'true' : 'false');
      card.className += draggable ? ' is-draggable' : ' is-locked';
      card.setAttribute('data-lesson-id', lesson.id);
      if (!draggable) return;
      card.addEventListener('dragstart', function (event) {
        finishTimelineZoom();
        clearTimelineDragPreview();
        clearAllDayDropPreview();
        resetTimelineDragMeta();
        draggedLessonId = lesson.id;
        card.classList.add('is-dragging');
        if (event.dataTransfer) {
          event.dataTransfer.effectAllowed = 'move';
          event.dataTransfer.setData('text/plain', lesson.id);
          setTransparentDragImage(event, ensureTransparentDragImage());
        }
      });
      card.addEventListener('dragend', function () {
        draggedLessonId = null;
        card.classList.remove('is-dragging');
        clearTimelineDragPreview();
        clearAllDayDropPreview();
        resetTimelineDragMeta();
      });
    }

    function clearAllDayDropPreview() {
      if (!activeAllDayDropPreview) return;
      activeAllDayDropPreview.node.classList.remove('school-all-day-drop-before');
      activeAllDayDropPreview.node.classList.remove('school-all-day-drop-after');
      activeAllDayDropPreview = null;
    }

    function configureAllDayDropTarget(card, day, targetLesson) {
      if (!card) return;
      card.addEventListener('dragover', function (event) {
        var lesson = draggedLesson(event);
        if (!lesson || lesson.id === targetLesson.id) {
          if (typeof event.stopPropagation === 'function') event.stopPropagation();
          clearAllDayDropPreview();
          return;
        }
        event.preventDefault();
        if (typeof event.stopPropagation === 'function') event.stopPropagation();
        var rect = typeof card.getBoundingClientRect === 'function'
          ? card.getBoundingClientRect()
          : { top: 0, height: 0 };
        var placement = allDayDropPlacement(rect, event.clientY);
        if (
          activeAllDayDropPreview &&
          activeAllDayDropPreview.node === card &&
          activeAllDayDropPreview.placement === placement
        ) {
          return;
        }
        clearAllDayDropPreview();
        card.classList.add(
          placement === 'before'
            ? 'school-all-day-drop-before'
            : 'school-all-day-drop-after'
        );
        activeAllDayDropPreview = {
          day: day,
          node: card,
          placement: placement,
          targetLessonId: targetLesson.id
        };
      });
      card.addEventListener('dragleave', function (event) {
        if (typeof event.stopPropagation === 'function') event.stopPropagation();
        if (activeAllDayDropPreview && activeAllDayDropPreview.node === card) {
          clearAllDayDropPreview();
        }
      });
      card.addEventListener('drop', function (event) {
        event.preventDefault();
        if (typeof event.stopPropagation === 'function') event.stopPropagation();
        var lesson = draggedLesson(event);
        if (!lesson || lesson.id === targetLesson.id) {
          draggedLessonId = null;
          clearAllDayDropPreview();
          return;
        }
        var rect = typeof card.getBoundingClientRect === 'function'
          ? card.getBoundingClientRect()
          : { top: 0, height: 0 };
        var placement = activeAllDayDropPreview &&
            activeAllDayDropPreview.node === card
          ? activeAllDayDropPreview.placement
          : allDayDropPlacement(rect, event.clientY);
        var order = allDayDropOrder(
          core,
          lessons,
          day,
          lesson.id,
          targetLesson.id,
          placement
        );
        draggedLessonId = null;
        clearAllDayDropPreview();
        clearTimelineDragPreview();
        resetTimelineDragMeta();
        runDropTransition(
          commandForAllDayDrop(lesson, day, order)
        ).catch(function () {
          setMutationMessage('Не удалось изменить порядок уроков.');
        });
      });
    }

    function draggedLesson(event) {
      var id = draggedLessonId;
      if (!id && event && event.dataTransfer) {
        id = event.dataTransfer.getData('text/plain');
      }
      return lessons.find(function (lesson) { return lesson.id === id; }) || null;
    }

    function configureDropZone(node, day, kind, bounds) {
      if (!node) return;
      node.addEventListener('dragover', function (event) {
        if (!draggedLesson(event)) return;
        event.preventDefault();
        node.classList.add('school-drop-active');
        if (kind !== 'timed' || !bounds || typeof node.getBoundingClientRect !== 'function') {
          clearTimelineDragPreview();
          resetTimelineDragMeta();
          return;
        }
        var rect = node.getBoundingClientRect();
        var lesson = draggedLesson(event);
        var zoomLevel = timelineZoomSettings(timelineScale);
        var dragPreview = renderTimelineDragPreview(
          node,
          lesson,
          day,
          event.clientY,
          rect,
          bounds,
          zoomLevel
        );
        var previewMeta = byId('schoolWeekTimeMeta');
        if (previewMeta) {
          previewMeta.textContent = scheduleRange(
            dragPreview.schedule.start,
            dragPreview.schedule.end
          );
        }
      });
      node.addEventListener('dragleave', function () {
        node.classList.remove('school-drop-active');
        if (activeTimelineDragPreview && activeTimelineDragPreview.node === node) {
          clearTimelineDragPreview();
          resetTimelineDragMeta();
        }
      });
      node.addEventListener('drop', function (event) {
        event.preventDefault();
        node.classList.remove('school-drop-active');
        var lesson = draggedLesson(event);
        draggedLessonId = null;
        if (!lesson) {
          clearTimelineDragPreview();
          resetTimelineDragMeta();
          return;
        }
        var destination;
        if (kind === 'unscheduled') {
          destination = { kind: 'unscheduled' };
        } else if (kind === 'date-only') {
          destination = { kind: 'date-only', date: day };
        } else {
          var rect = typeof node.getBoundingClientRect === 'function'
            ? node.getBoundingClientRect()
            : { top: 0 };
          var zoomLevel = timelineZoomSettings(timelineScale);
          var fallbackDestination = timelineDestination(
            core,
            day,
            event.clientY,
            rect,
            bounds,
            zoomLevel
          );
          destination = timelineDropDestination(
            activeTimelineDragPreview,
            node,
            lesson.id,
            fallbackDestination
          );
        }
        clearTimelineDragPreview();
        clearAllDayDropPreview();
        resetTimelineDragMeta();
        var order = orderAtEnd(
          destinationDate(destination),
          destination.kind
        );
        moveLessonTo(lesson, destination, order).catch(function () {
          setMutationMessage('Не удалось перенести урок.');
        });
      });
    }

    function teacherForLesson(lesson) {
      return teacherTargetForRoute(routeForLesson(lesson));
    }

    function getCurrentTeacherPrompt() {
      var lesson = currentLesson();
      if (
        !lesson ||
        !currentContentLoaded ||
        !teacherBridge ||
        typeof teacherBridge.buildLessonTeacherPrompt !== 'function'
      ) return '';
      return teacherBridge.buildLessonTeacherPrompt(
        lesson,
        currentContentBlocks,
        routeForLesson(lesson)
      );
    }

    function showToast(message) {
      var toast = byId('schoolToast');
      if (!toast) return;
      toast.textContent = message || '';
      toast.hidden = !message;
      if (toastTimer && runtime && typeof runtime.clearTimeout === 'function') {
        runtime.clearTimeout(toastTimer);
      }
      if (message && runtime && typeof runtime.setTimeout === 'function') {
        toastTimer = runtime.setTimeout(function () {
          toast.hidden = true;
          toastTimer = null;
        }, 4200);
      }
    }

    function teacherDialogOpen() {
      var dialog = byId('schoolTeacherDialog');
      return Boolean(dialog && !dialog.hidden);
    }

    function closeTeacherDialog() {
      var dialog = byId('schoolTeacherDialog');
      if (!dialog || dialog.hidden) return;
      dialog.hidden = true;
      dialog.setAttribute('aria-hidden', 'true');
      currentTeacherParse = null;
      var preview = byId('schoolTeacherPreview');
      if (preview) {
        clearNode(preview);
        preview.hidden = true;
      }
      if (teacherPreviousFocus && typeof teacherPreviousFocus.focus === 'function') {
        teacherPreviousFocus.focus();
      }
      teacherPreviousFocus = null;
    }

    function showTeacherDialog() {
      var dialog = byId('schoolTeacherDialog');
      if (!dialog || !documentRef) return;
      teacherPreviousFocus = documentRef.activeElement;
      dialog.hidden = false;
      dialog.setAttribute('aria-hidden', 'false');
      installDialogKeys(byId('schoolLessonDialog'));
    }

    function configureTeacherDialogButtons(mode) {
      var paste = byId('schoolTeacherPaste');
      var parse = byId('schoolTeacherParse');
      var apply = byId('schoolTeacherApply');
      var edit = byId('schoolTeacherEditSource');
      var source = byId('schoolTeacherSource');
      if (paste) {
        paste.hidden = false;
        paste.textContent = mode === 'import'
          ? 'Вставить из буфера'
          : 'Копировать вручную';
      }
      if (parse) parse.hidden = mode !== 'import';
      if (apply) apply.hidden = true;
      if (edit) edit.hidden = true;
      if (source) source.readOnly = mode !== 'import';
    }

    function openTeacherTextDialog(title, message, value) {
      if (!documentRef) return;
      byId('schoolTeacherDialogTitle').textContent = title;
      byId('schoolTeacherDialogMessage').textContent = message || '';
      var source = byId('schoolTeacherSource');
      source.value = value || '';
      byId('schoolTeacherSourceWrap').hidden = false;
      byId('schoolTeacherPreview').hidden = true;
      byId('schoolTeacherArtifactConfirmWrap').hidden = true;
      configureTeacherDialogButtons('text');
      showTeacherDialog();
      if (typeof source.focus === 'function') source.focus();
      if (typeof source.select === 'function') source.select();
    }

    function openTeacherImportDialog() {
      if (!documentRef) return;
      byId('schoolTeacherDialogTitle').textContent = 'Импорт результата преподавателя';
      byId('schoolTeacherDialogMessage').textContent =
        'Вставьте исходный блок LESSON RESULT. Разбор ничего не сохраняет в notion.';
      var source = byId('schoolTeacherSource');
      source.value = '';
      byId('schoolTeacherSourceWrap').hidden = false;
      clearNode(byId('schoolTeacherPreview'));
      byId('schoolTeacherPreview').hidden = true;
      byId('schoolTeacherArtifactConfirmWrap').hidden = true;
      if (byId('schoolTeacherArtifactConfirm')) {
        byId('schoolTeacherArtifactConfirm').checked = false;
      }
      configureTeacherDialogButtons('import');
      currentTeacherParse = null;
      showTeacherDialog();
      if (typeof source.focus === 'function') source.focus();
    }

    function previewValue(value) {
      if (value === null || value === undefined || value === '') return 'не заполнено';
      return String(value);
    }

    function renderTeacherResultPreview(parsed) {
      var rootNode = byId('schoolTeacherPreview');
      if (!rootNode || !documentRef) return;
      clearNode(rootNode);
      rootNode.hidden = false;
      rootNode.appendChild(element(
        documentRef,
        'h3',
        '',
        parsed.canApply ? 'Результат распознан' : 'Результат требует проверки'
      ));
      var values = parsed.values || {};
      var labels = [
        ['Статус', values.status],
        ['Результат', values.result],
        ['Автономность', values.autonomy],
        ['Понимание', values.understanding],
        ['Комментарий', values.comment],
        ['Артефакт', values.artifactUrl],
        ['Причина пропуска', values.missedReason]
      ];
      var list = element(documentRef, 'dl');
      labels.forEach(function (entry) {
        list.appendChild(element(documentRef, 'dt', '', entry[0]));
        list.appendChild(element(documentRef, 'dd', '', previewValue(entry[1])));
      });
      rootNode.appendChild(list);
      (parsed.warnings || []).forEach(function (warning) {
        rootNode.appendChild(element(
          documentRef,
          'p',
          'is-warning',
          warning.message
        ));
      });
      (parsed.errors || []).forEach(function (error) {
        rootNode.appendChild(element(
          documentRef,
          'p',
          'is-error',
          error.message
        ));
      });
      var apply = byId('schoolTeacherApply');
      var edit = byId('schoolTeacherEditSource');
      if (apply) apply.hidden = !parsed.canApplyToForm;
      if (edit) edit.hidden = false;
      var confirm = byId('schoolTeacherArtifactConfirmWrap');
      if (confirm) confirm.hidden = !parsed.requiresArtifactConfirmation;
    }

    function parseTeacherSource() {
      var lesson = currentLesson();
      if (
        !lesson ||
        !teacherBridge ||
        typeof teacherBridge.parseLessonResultBlock !== 'function'
      ) return null;
      currentTeacherParse = teacherBridge.parseLessonResultBlock(
        controlValue('schoolTeacherSource'),
        lesson.id
      );
      renderTeacherResultPreview(currentTeacherParse);
      return currentTeacherParse;
    }

    function applyCurrentTeacherParse() {
      if (!currentTeacherParse || !currentTeacherParse.canApplyToForm) return false;
      var values = Object.assign({}, currentTeacherParse.values);
      if (
        currentTeacherParse.requiresArtifactConfirmation &&
        !byId('schoolTeacherArtifactConfirm').checked
      ) {
        values.artifactUrl = null;
      }
      applyTeacherResultToControls(documentRef, values);
      updateCommentCount();
      closeTeacherDialog();
      showToast('Результат применён к форме — проверьте поля перед сохранением.');
      return true;
    }

    function revealTeacherFallbackLink(url) {
      var link = byId('schoolTeacherFallbackLink');
      var safeUrl = safeHttpsUrl(url);
      if (!link || !safeUrl) return;
      link.setAttribute('href', safeUrl);
      link.hidden = false;
    }

    function clipboardWrite(value) {
      var clipboard = runtime && runtime.navigator && runtime.navigator.clipboard;
      if (!clipboard || typeof clipboard.writeText !== 'function') {
        return Promise.reject(new Error('clipboard unavailable'));
      }
      return clipboard.writeText(value);
    }

    function copyTeacherText(value, successMessage) {
      return clipboardWrite(value).then(function () {
        showToast(successMessage);
        return true;
      }).catch(function () {
        openTeacherTextDialog(
          'Скопируйте текст вручную',
          'Clipboard API недоступен. Нажмите Cmd+C или Ctrl+C для выделенного текста.',
          value
        );
        return false;
      });
    }

    function runTeacherPrimary() {
      var lesson = currentLesson();
      var prompt = getCurrentTeacherPrompt();
      if (!lesson || !prompt) return Promise.resolve(null);
      if (lesson.status !== 'В процессе' && FINAL_DIARY_STATUSES.indexOf(lesson.status) === -1) {
        openTeacherTextDialog(
          'Предпросмотр промта урока',
          'Диалог преподавателя можно открыть после успешного начала урока.',
          prompt
        );
        return Promise.resolve({ copied: false, opened: false, popupBlocked: false });
      }
      var teacher = teacherForLesson(lesson);
      return copyPromptAndOpen({
        runtime: runtime,
        teacher: teacher,
        prompt: prompt,
        copyText: clipboardWrite,
        onClipboardFallback: function (value) {
          openTeacherTextDialog(
            'Скопируйте промт вручную',
            'Clipboard API недоступен. Нажмите Cmd+C или Ctrl+C для выделенного текста.',
            value
          );
        },
        onPopupBlocked: function (url) {
          revealTeacherFallbackLink(url);
        }
      }).then(function (result) {
        if (result.copied) {
          showToast('Промт урока скопирован — вставьте его в диалог преподавателя.');
        }
        if (!teacher.configured) {
          showToast('Ссылка преподавателя для этого предмета ещё не настроена.');
        }
        return result;
      });
    }

    function renderTeacherSection(lesson) {
      var section = byId('schoolTeacherSection');
      if (!section || !lesson || !teacherBridge) return;
      section.hidden = false;
      var route = routeForLesson(lesson);
      var rows = routeDrawerRows(route);
      var teacher = teacherTargetForRoute(route);
      var active = lesson.status === 'В процессе';
      var finalized = FINAL_DIARY_STATUSES.indexOf(lesson.status) !== -1;
      var ready = currentContentLoaded && currentContentLessonId === lesson.id;
      byId('schoolTeacherLabel').textContent =
        rows.teacher || teacher.label || lesson.subject;
      byId('schoolTeacherStatus').textContent = active
        ? 'урок активен'
        : (finalized ? 'урок сохранён в дневнике' : 'предпросмотр');
      var cabinet = byId('schoolRouteCabinet');
      if (cabinet) cabinet.textContent = rows.cabinet;
      var kind = byId('schoolRouteKind');
      if (kind) kind.textContent = rows.kind;
      var routeTeacher = byId('schoolRouteTeacher');
      if (routeTeacher) routeTeacher.textContent = rows.teacher;
      var model = byId('schoolRouteModel');
      if (model) model.textContent = rows.modelHint;
      var modelRow = byId('schoolRouteModelRow');
      if (modelRow) modelRow.hidden = !rows.modelHint;
      var format = byId('schoolRouteFormat');
      if (format) format.textContent = rows.format;
      var resource = byId('schoolRouteResource');
      if (resource) resource.textContent = rows.resource;
      var resourceRow = byId('schoolRouteResourceRow');
      if (resourceRow) resourceRow.hidden = !rows.resource;
      var reviewer = byId('schoolRouteReviewer');
      if (reviewer) reviewer.textContent = rows.reviewer;
      var reviewerRow = byId('schoolRouteReviewerRow');
      if (reviewerRow) reviewerRow.hidden = !rows.reviewer;
      var warnings = byId('schoolRouteWarnings');
      clearNode(warnings);
      if (warnings && documentRef) {
        rows.warnings.forEach(function (message) {
          warnings.appendChild(element(documentRef, 'p', '', message));
        });
      }
      byId('schoolTeacherNote').textContent = rows.instruction;
      var primary = byId('schoolTeacherPrimary');
      primary.textContent = active || finalized
        ? (teacher.configured
          ? 'Скопировать промт и открыть преподавателя'
          : 'Скопировать промт')
        : 'Посмотреть промт';
      primary.disabled = !ready;
      byId('schoolTeacherCopy').disabled = !ready;
      byId('schoolTeacherOpen').disabled = !ready || !teacher.configured || (!active && !finalized);
      byId('schoolTeacherFinishRequest').disabled = !ready || (!active && !finalized);
      byId('schoolTeacherImport').disabled = !ready;
      byId('schoolTeacherFallbackLink').hidden = true;
    }

    function updateCommentCount() {
      var comment = controlValue('schoolLessonComment');
      var length = teacherBridge && typeof teacherBridge.unicodeLength === 'function'
        ? teacherBridge.unicodeLength(comment)
        : Array.from(comment).length;
      var count = byId('schoolLessonCommentCount');
      if (count) count.textContent = length + ' / 1000';
    }

    function renderCancelledHistory(lesson) {
      var details = byId('schoolCancelledHistory');
      var content = byId('schoolCancelledHistoryContent');
      if (!details || !content) return;
      clearNode(content);
      var values = [
        ['Результат', lesson.result],
        ['Автономность', lesson.autonomy],
        ['Понимание', lesson.understanding === null ? '' : lesson.understanding + '/3'],
        ['Комментарий', lesson.comment],
        ['Артефакт', lesson.artifactUrl]
      ].filter(function (entry) { return entry[1] !== null && entry[1] !== ''; });
      details.hidden = lesson.status !== 'Отменён' || values.length === 0;
      values.forEach(function (entry) {
        content.appendChild(element(documentRef, 'p', '', entry[0] + ': ' + entry[1]));
      });
    }

    function assessmentCommand(lesson, status) {
      var command = {
        operation: 'completeLesson',
        lessonId: lesson.id,
        status: status
      };
      if (status === 'Пропущен') {
        command.missedReason = controlValue('schoolLessonMissedReason');
        var missedComment = controlValue('schoolLessonComment').trim();
        if (missedComment) command.comment = missedComment;
        return command;
      }
      command.autonomy = controlValue('schoolLessonAutonomy');
      command.understanding = Number(controlValue('schoolLessonUnderstanding'));
      if (status === 'Выполнен') command.result = controlValue('schoolLessonResult') || 'Зачёт';
      var comment = controlValue('schoolLessonComment').trim();
      var artifact = controlValue('schoolLessonArtifact').trim();
      if (comment) command.comment = comment;
      if (artifact) command.artifactUrl = artifact;
      return command;
    }

    async function cancelLessonWithConfirmation(lesson) {
      var evidence = Boolean(lesson.hasLearningEvidence);
      var first = await askAction(
        evidence ? 'По этому уроку уже начата работа' : 'Отменить урок?',
        evidence
          ? 'Существующие результаты сохранятся как история до отмены.'
          : 'Запись останется в Notion и будет приглушена в календаре.',
        evidence
          ? [
            { label: 'Продолжить урок', value: 'continue', primary: true },
            { label: 'Сохранить как частично выполненный', value: 'partial' },
            { label: 'Всё равно отменить', value: 'cancel-anyway', danger: true },
            { label: 'Назад', value: 'back' }
          ]
          : [
            { label: 'Отменить урок', value: 'cancel', danger: true },
            { label: 'Назад', value: 'back', primary: true }
          ]
      );
      if (first === 'continue') return openLesson(lesson.id);
      if (first === 'partial') {
        return mutateWithDialogs(assessmentCommand(lesson, 'Частично выполнен'));
      }
      if (first !== 'cancel' && first !== 'cancel-anyway') return null;
      if (evidence) {
        var second = await askAction(
          'Точно отменить урок?',
          'Оценочные данные не будут удалены, но исчезнут из обычного дневника.',
          [
            { label: 'Да, отменить', value: 'confirm', danger: true },
            { label: 'Назад', value: 'back', primary: true }
          ]
        );
        if (second !== 'confirm') return null;
      }
      return mutateWithDialogs({
        operation: 'cancelLesson',
        lessonId: lesson.id,
        confirmLearningEvidence: evidence
      });
    }

    function renderLessonControls(lesson) {
      if (!documentRef || !lesson) return;
      var dateSelect = byId('schoolLessonDate');
      if (dateSelect) {
        clearNode(dateSelect);
        WEEK_DAYS.forEach(function (day) {
          var option = element(documentRef, 'option', '', day.short + ' · ' + day.label);
          option.value = day.date;
          dateSelect.appendChild(option);
        });
        dateSelect.value = lesson.schedule.date || mobileDay || WEEK_DAYS[0].date;
      }
      var timeInput = byId('schoolLessonTime');
      if (timeInput) {
        timeInput.value = lesson.schedule.kind === 'timed'
          ? timeText(lesson.schedule.start)
          : '';
      }
      if (byId('schoolLessonDuration')) {
        byId('schoolLessonDuration').textContent = lesson.durationMinutes + ' минут';
      }
      if (byId('schoolLessonFinalStatus')) {
        byId('schoolLessonFinalStatus').value =
          FINAL_DIARY_STATUSES.indexOf(lesson.status) !== -1
            ? lesson.status
            : 'Выполнен';
      }
      if (byId('schoolLessonResult')) byId('schoolLessonResult').value = lesson.result || 'Зачёт';
      if (byId('schoolLessonAutonomy')) byId('schoolLessonAutonomy').value = lesson.autonomy || '';
      if (byId('schoolLessonUnderstanding')) {
        byId('schoolLessonUnderstanding').value = lesson.understanding === null
          ? ''
          : String(lesson.understanding);
      }
      if (byId('schoolLessonMissedReason')) {
        byId('schoolLessonMissedReason').value = lesson.missedReason || '';
      }
      if (byId('schoolLessonComment')) byId('schoolLessonComment').value = lesson.comment || '';
      if (byId('schoolLessonArtifact')) byId('schoolLessonArtifact').value = lesson.artifactUrl || '';
      if (byId('schoolAssessmentErrors')) byId('schoolAssessmentErrors').textContent = '';
      updateCommentCount();

      var scheduleControls = byId('schoolScheduleControls');
      if (scheduleControls) {
        scheduleControls.hidden = ['Выполнен', 'Частично выполнен', 'Отменён'].indexOf(lesson.status) !== -1;
      }
      var assessmentControls = byId('schoolAssessmentControls');
      if (assessmentControls) assessmentControls.hidden = lesson.status === 'Отменён';
      var saveAssessment = byId('schoolSaveAssessment');
      if (saveAssessment) saveAssessment.hidden = lesson.status !== 'В процессе';

      var actionRoot = byId('schoolLessonActions');
      clearNode(actionRoot);
      if (lesson.status === 'Нераспределён') {
        appendAction(actionRoot, 'Назначить и начать', 'is-primary', async function () {
          var destination = selectedDestination(true);
          if (!destination) return;
          await mutateWithDialogs({
            operation: 'moveLesson',
            lessonId: lesson.id,
            destination: destination,
            order: orderAtEnd(destination.date, 'date-only')
          });
          await mutateWithDialogs({ operation: 'startLesson', lessonId: lesson.id });
        });
      } else if (lesson.status === 'Запланирован') {
        appendAction(actionRoot, 'Начать урок', 'is-primary', function () {
          return mutateWithDialogs({ operation: 'startLesson', lessonId: lesson.id });
        });
        appendAction(actionRoot, 'Отменить', 'is-danger', function () {
          return cancelLessonWithConfirmation(lesson);
        });
      } else if (lesson.status === 'В процессе') {
        appendAction(actionRoot, 'Отменить', 'is-danger', function () {
          return cancelLessonWithConfirmation(lesson);
        });
      } else if (lesson.status === 'Выполнен' || lesson.status === 'Частично выполнен') {
        appendAction(actionRoot, 'Вернуть к редактированию', 'is-primary', function () {
          return mutateWithDialogs({ operation: 'reopenLesson', lessonId: lesson.id });
        });
      } else if (lesson.status === 'Пропущен') {
        appendAction(actionRoot, 'Перенести урок', 'is-primary', function () {
          var destination = selectedDestination(false);
          if (!destination) return null;
          return runDropTransition({
            kind: 'restore-confirm',
            command: {
              operation: 'restoreMissedLesson',
              lessonId: lesson.id,
              destination: destination,
              order: orderAtEnd(destinationDate(destination), destination.kind)
            }
          });
        });
        appendAction(actionRoot, 'Исправить статус', '', function () {
          return mutateWithDialogs({ operation: 'correctMissedStatus', lessonId: lesson.id });
        });
      } else if (lesson.status === 'Отменён') {
        appendAction(actionRoot, 'Вернуть в расписание', 'is-primary', async function () {
          await mutateWithDialogs({ operation: 'restoreCancelledLesson', lessonId: lesson.id });
          if (!lesson.hasLearningEvidence) return;
          var restoredChoice = await askAction(
            'У урока сохранились результаты предыдущей работы',
            'Можно продолжить с ними или отдельно очистить и начать заново.',
            [
              { label: 'Продолжить с сохранёнными данными', value: 'continue', primary: true },
              { label: 'Начать заново', value: 'reset', danger: true }
            ]
          );
          if (restoredChoice === 'reset') {
            var resetConfirm = await askAction(
              'Очистить результаты предыдущей работы?',
              'Будут удалены результат, автономность, понимание, комментарий и артефакт.',
              [
                { label: 'Очистить', value: 'confirm', danger: true },
                { label: 'Назад', value: 'back', primary: true }
              ]
            );
            if (resetConfirm === 'confirm') {
              await mutateWithDialogs({
                operation: 'clearLearningEvidence',
                lessonId: lesson.id,
                confirm: true
              });
            }
          }
        });
      }

      if (lesson.status !== 'Отменён') {
        appendAction(
          actionRoot,
          lesson.decisionRequest ? 'Снять отметку переноса' : 'Отметить для переноса',
          '',
          function () {
            return mutateWithDialogs({
              operation: lesson.decisionRequest
                ? 'clearDecisionRequest'
                : 'requestCrossWeekMove',
              lessonId: lesson.id
            });
          }
        );
      }
      renderTeacherSection(lesson);
      renderCancelledHistory(lesson);
    }

    function selectView(view) {
      if (['today', 'week', 'diary'].indexOf(view) === -1) return false;
      currentView = view;
      if (!documentRef) return true;
      documentRef.querySelectorAll('[data-school-view]').forEach(function (tab) {
        var active = tab.getAttribute('data-school-view') === view;
        tab.classList.toggle('is-active', active);
        tab.setAttribute('aria-selected', active ? 'true' : 'false');
        tab.tabIndex = active ? 0 : -1;
      });
      documentRef.querySelectorAll('[data-school-panel]').forEach(function (panel) {
        panel.hidden = panel.getAttribute('data-school-panel') !== view;
      });
      return true;
    }

    function setBackgroundInert(inert) {
      ['schoolApp', 'topbar', 'bottombar'].forEach(function (id) {
        var node = byId(id);
        if (!node) return;
        node.inert = inert;
        if (inert) {
          node.setAttribute('inert', '');
          node.setAttribute('aria-hidden', 'true');
        } else {
          node.removeAttribute('inert');
          node.removeAttribute('aria-hidden');
        }
      });
      if (documentRef.body) documentRef.body.classList.toggle('school-dialog-open', inert);
    }

    function closeDialog() {
      if (!documentRef) return;
      var dialog = byId('schoolLessonDialog');
      if (!dialog || dialog.hidden) return;
      dialogGeneration += 1;
      closeTeacherDialog();
      currentContentLessonId = null;
      currentContentBlocks = [];
      currentContentLoaded = false;
      dialog.hidden = true;
      dialog.setAttribute('aria-hidden', 'true');
      if (dialogKeyHandler) documentRef.removeEventListener('keydown', dialogKeyHandler);
      dialogKeyHandler = null;
      setBackgroundInert(false);
      clearNode(byId('schoolLessonMeta'));
      clearNode(byId('schoolLessonContent'));
      clearNode(byId('schoolLessonActions'));
      if (byId('schoolTeacherSection')) byId('schoolTeacherSection').hidden = true;
      closeActionDialog('cancel');
      if (byId('schoolLessonTitle')) byId('schoolLessonTitle').textContent = 'Урок';
      if (byId('schoolLessonSubject')) byId('schoolLessonSubject').textContent = '';
      if (byId('schoolContentState')) byId('schoolContentState').textContent = '';
      if (previousFocus && typeof previousFocus.focus === 'function') previousFocus.focus();
      previousFocus = null;
    }

    function installDialogKeys(dialog) {
      if (dialogKeyHandler) return;
      dialogKeyHandler = function (event) {
        if (event.key === 'Escape') {
          event.preventDefault();
          if (actionDialogOpen()) {
            closeActionDialog('cancel');
            return;
          }
          if (teacherDialogOpen()) {
            closeTeacherDialog();
            return;
          }
          if (settingsDialogOpen()) {
            closeSettings(false);
            return;
          }
          closeDialog();
          return;
        }
        if (event.key !== 'Tab') return;
        var focusRoot = actionDialogOpen()
          ? byId('schoolActionDialog')
          : (teacherDialogOpen()
            ? byId('schoolTeacherDialog')
            : (settingsDialogOpen()
              ? byId('schoolSettingsDialog')
              : dialog));
        var focusable = Array.from(focusRoot.querySelectorAll('button, a[href], [tabindex]:not([tabindex="-1"])'))
          .filter(function (node) { return !node.disabled && !node.hidden; });
        if (!focusable.length) return;
        var first = focusable[0];
        var last = focusable[focusable.length - 1];
        if (event.shiftKey && documentRef.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && documentRef.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      };
      documentRef.addEventListener('keydown', dialogKeyHandler);
    }

    function renderLessonMeta(lesson) {
      var meta = byId('schoolLessonMeta');
      if (!meta) return;
      clearNode(meta);
      [scheduleText(lesson), lesson.status, lesson.module, lesson.priority].filter(Boolean).forEach(function (value) {
        meta.appendChild(element(documentRef, 'span', '', value));
      });
    }

    async function openLesson(lessonId) {
      var lesson = lessons.find(function (item) { return item.id === lessonId; }) || null;
      dialogGeneration += 1;
      var requestGeneration = dialogGeneration;
      currentContentLessonId = lessonId;
      currentContentBlocks = [];
      currentContentLoaded = false;
      if (documentRef) {
        var dialog = byId('schoolLessonDialog');
        if (dialog) {
          if (dialog.hidden) previousFocus = documentRef.activeElement;
          dialog.hidden = false;
          dialog.setAttribute('aria-hidden', 'false');
          setBackgroundInert(true);
          byId('schoolLessonTitle').textContent = lesson ? lesson.title : 'Урок';
          byId('schoolLessonSubject').textContent = lesson ? lesson.subject : '';
          clearNode(byId('schoolLessonMeta'));
          if (lesson) renderLessonMeta(lesson);
          if (lesson) renderLessonControls(lesson);
          clearNode(byId('schoolLessonContent'));
          byId('schoolContentState').textContent = 'Загружаю содержание урока…';
          installDialogKeys(dialog);
          var close = byId('schoolLessonClose');
          if (close) close.focus();
        }
      }

      try {
        var content = await api.getLessonContent(lessonId);
        if (
          requestGeneration === dialogGeneration &&
          currentContentLessonId === lessonId
        ) {
          currentContentBlocks = Array.isArray(content.blocks) ? content.blocks : [];
          currentContentLoaded = true;
        }
        if (
          documentRef &&
          requestGeneration === dialogGeneration &&
          currentContentLessonId === lessonId &&
          !byId('schoolLessonDialog').hidden
        ) {
          byId('schoolContentState').textContent = content.blocks.length ? '' : 'У урока пока нет дополнительного содержания.';
          renderContentBlocks(byId('schoolLessonContent'), content.blocks, documentRef);
          if (lesson) renderTeacherSection(lesson);
        }
        return content;
      } catch (error) {
        if (
          requestGeneration === dialogGeneration &&
          currentContentLessonId === lessonId
        ) {
          currentContentBlocks = [];
          currentContentLoaded = false;
        }
        if (
          documentRef &&
          requestGeneration === dialogGeneration &&
          currentContentLessonId === lessonId &&
          !byId('schoolLessonDialog').hidden
        ) {
          byId('schoolContentState').textContent = 'Не удалось загрузить содержание урока.';
        }
        return null;
      }
    }

    async function load() {
      setState('loading', 'Загружаю уроки', 'Проверяю доступ к личной школе.');
      setSyncBanner('', false);
      try {
        confirmedLessons = await api.listLessons({ week: ACTIVE_WEEK });
        optimisticMutations = [];
        lessons = cloneLessons(confirmedLessons);
        if (!Array.isArray(lessons) || lessons.length === 0) {
          setState('empty', 'Уроков пока нет', 'В выбранной учебной неделе нет доступных уроков.');
          return null;
        }
        buildModel();
        return readModel;
      } catch (error) {
        var state = stateFromError(error);
        var copy = errorCopy(state);
        setState(state, copy[0], copy[1]);
        return null;
      }
    }

    function bind() {
      if (!documentRef) return;
      var settingsOpen = byId('schoolSettingsOpen');
      if (settingsOpen) {
        settingsOpen.addEventListener('click', openSettings);
      }
      var settingsDialog = byId('schoolSettingsDialog');
      if (settingsDialog) {
        settingsDialog.addEventListener('click', function (event) {
          if (event.target === settingsDialog) closeSettings(false);
        });
      }
      [
        'schoolSettingsClose',
        'schoolSettingsCancel'
      ].forEach(function (id) {
        var closeButton = byId(id);
        if (closeButton) {
          closeButton.addEventListener('click', function () {
            closeSettings(false);
          });
        }
      });
      documentRef.querySelectorAll(
        'input[data-school-cabinet-id]'
      ).forEach(function (input) {
        input.addEventListener('input', function () {
          updateCabinetSettingsDraft(
            input.getAttribute('data-school-cabinet-id'),
            input.value
          );
        });
      });
      documentRef.querySelectorAll(
        '[data-school-cabinet-reset]'
      ).forEach(function (button) {
        button.addEventListener('click', function () {
          updateCabinetSettingsDraft(
            button.getAttribute('data-school-cabinet-id'),
            ''
          );
        });
      });
      var settingsForm = byId('schoolSettingsForm');
      if (settingsForm) {
        settingsForm.addEventListener('submit', function (event) {
          event.preventDefault();
          saveCabinetSettings();
        });
      }
      var useRemoteSettings = byId('schoolSettingsUseRemote');
      if (useRemoteSettings) {
        useRemoteSettings.addEventListener(
          'click',
          usePendingCabinetSettings
        );
      }
      var keepSettingsDraft = byId('schoolSettingsKeepDraft');
      if (keepSettingsDraft) {
        keepSettingsDraft.addEventListener(
          'click',
          keepCabinetSettingsDraft
        );
      }
      documentRef.querySelectorAll('[data-school-view]').forEach(function (tab) {
        tab.addEventListener('click', function () {
          selectView(tab.getAttribute('data-school-view'));
        });
      });
      var close = byId('schoolLessonClose');
      if (close) close.addEventListener('click', closeDialog);
      var dialog = byId('schoolLessonDialog');
      if (dialog) dialog.addEventListener('click', function (event) {
        if (event.target === dialog) closeDialog();
      });
      var actionDialog = byId('schoolActionDialog');
      if (actionDialog) actionDialog.addEventListener('click', function (event) {
        if (event.target === actionDialog) closeActionDialog('cancel');
      });
      var teacherDialog = byId('schoolTeacherDialog');
      if (teacherDialog) teacherDialog.addEventListener('click', function (event) {
        if (event.target === teacherDialog) closeTeacherDialog();
      });
      [
        'schoolTeacherDialogClose',
        'schoolTeacherDialogCancel'
      ].forEach(function (id) {
        var closeTeacher = byId(id);
        if (closeTeacher) closeTeacher.addEventListener('click', closeTeacherDialog);
      });
      var teacherPrimary = byId('schoolTeacherPrimary');
      if (teacherPrimary) teacherPrimary.addEventListener('click', function () {
        runTeacherPrimary();
      });
      var teacherCopy = byId('schoolTeacherCopy');
      if (teacherCopy) teacherCopy.addEventListener('click', function () {
        var prompt = getCurrentTeacherPrompt();
        if (!prompt) return;
        copyTeacherText(
          prompt,
          'Промт урока скопирован — вставьте его в диалог преподавателя.'
        );
      });
      var teacherOpen = byId('schoolTeacherOpen');
      if (teacherOpen) teacherOpen.addEventListener('click', function () {
        var lesson = currentLesson();
        var teacher = teacherForLesson(lesson);
        if (!teacher.configured || !teacher.url) return;
        var popup = runtime && typeof runtime.open === 'function'
          ? runtime.open(teacher.url, '_blank', 'noopener,noreferrer')
          : null;
        if (!popup) revealTeacherFallbackLink(teacher.url);
      });
      var teacherFinish = byId('schoolTeacherFinishRequest');
      if (teacherFinish) teacherFinish.addEventListener('click', function () {
        var lesson = currentLesson();
        if (
          !lesson ||
          !teacherBridge ||
          typeof teacherBridge.buildLessonCompletionRequest !== 'function'
        ) return;
        copyTeacherText(
          teacherBridge.buildLessonCompletionRequest(lesson),
          'Запрос на итог скопирован — вставьте его в диалог преподавателя.'
        );
      });
      var teacherImport = byId('schoolTeacherImport');
      if (teacherImport) teacherImport.addEventListener('click', async function () {
        var lesson = currentLesson();
        if (!lesson) return;
        if (lesson.status === 'В процессе') {
          openTeacherImportDialog();
          return;
        }
        if (FINAL_DIARY_STATUSES.indexOf(lesson.status) !== -1) {
          await askAction(
            'Урок уже сохранён в дневнике',
            'Чтобы импортировать новый результат, сначала используйте «Вернуть к редактированию».',
            [{ label: 'Понятно', value: 'cancel', primary: true }]
          );
          return;
        }
        var choice = await askAction(
          'Урок ещё не начат',
          'Можно разобрать итог заранее, но сохранить его получится только после успешного начала урока.',
          [
            { label: 'Продолжить импорт', value: 'continue', primary: true },
            { label: 'Отмена', value: 'cancel' }
          ]
        );
        if (choice === 'continue') openTeacherImportDialog();
      });
      var teacherPaste = byId('schoolTeacherPaste');
      if (teacherPaste) teacherPaste.addEventListener('click', function () {
        var source = byId('schoolTeacherSource');
        if (!source) return;
        if (source.readOnly) {
          if (typeof source.focus === 'function') source.focus();
          if (typeof source.select === 'function') source.select();
          if (documentRef && typeof documentRef.execCommand === 'function') {
            try {
              if (documentRef.execCommand('copy')) {
                showToast('Текст скопирован.');
              }
            } catch (_error) {}
          }
          return;
        }
        var clipboard = runtime && runtime.navigator && runtime.navigator.clipboard;
        if (!clipboard || typeof clipboard.readText !== 'function') {
          showToast('Нажмите Cmd+V или Ctrl+V в поле исходного текста.');
          if (typeof source.focus === 'function') source.focus();
          return;
        }
        clipboard.readText().then(function (value) {
          source.value = value;
          if (typeof source.focus === 'function') source.focus();
          parseTeacherSource();
        }).catch(function () {
          showToast('Нажмите Cmd+V или Ctrl+V в поле исходного текста.');
          if (typeof source.focus === 'function') source.focus();
        });
      });
      var teacherParse = byId('schoolTeacherParse');
      if (teacherParse) teacherParse.addEventListener('click', parseTeacherSource);
      var teacherApply = byId('schoolTeacherApply');
      if (teacherApply) teacherApply.addEventListener('click', applyCurrentTeacherParse);
      var teacherEdit = byId('schoolTeacherEditSource');
      if (teacherEdit) teacherEdit.addEventListener('click', function () {
        var preview = byId('schoolTeacherPreview');
        if (preview) preview.hidden = true;
        if (teacherApply) teacherApply.hidden = true;
        teacherEdit.hidden = true;
        var source = byId('schoolTeacherSource');
        if (source && typeof source.focus === 'function') source.focus();
      });
      var commentControl = byId('schoolLessonComment');
      if (commentControl) commentControl.addEventListener('input', updateCommentCount);
      var finalStatus = byId('schoolLessonFinalStatus');
      if (finalStatus) finalStatus.addEventListener('change', function () {
        syncAssessmentControlsForStatus(documentRef, finalStatus.value);
      });
      var saveAssessment = byId('schoolSaveAssessment');
      if (saveAssessment) saveAssessment.addEventListener('click', async function () {
        var lesson = currentLesson();
        if (!lesson || lesson.status !== 'В процессе') return;
        var draft = assessmentDraft(documentRef, lesson, teacherBridge);
        var errors = byId('schoolAssessmentErrors');
        if (errors) errors.textContent = draft.errors.join('\n');
        if (draft.errors.length) return;
        var choice = await askAction(
          'Сохранить результат в дневник?',
          'Проверьте итог. После сохранения урок станет финализированным.',
          [
            { label: 'Сохранить результат', value: 'save', primary: true },
            { label: 'Вернуться к форме', value: 'cancel' }
          ],
          draft.summary
        );
        if (choice !== 'save') return;
        await mutateWithDialogs(draft.command);
        showToast('Урок сохранён в дневнике.');
      });
      var zoomOut = byId('schoolZoomOut');
      if (zoomOut) zoomOut.addEventListener('click', function () {
        zoomTimelineFromButton(-1);
      });
      var zoomIn = byId('schoolZoomIn');
      if (zoomIn) zoomIn.addEventListener('click', function () {
        zoomTimelineFromButton(1);
      });
      var syncRetry = byId('schoolSyncRetry');
      if (syncRetry) syncRetry.addEventListener('click', function () {
        retryRevalidation().catch(function () {});
      });

      var applySchedule = byId('schoolApplySchedule');
      if (applySchedule) applySchedule.addEventListener('click', function () {
        var lesson = currentLesson();
        var destination = selectedDestination(false);
        if (!lesson || !destination) return;
        moveLessonTo(
          lesson,
          destination,
          orderAtEnd(destinationDate(destination), destination.kind)
        ).catch(function () { setMutationMessage('Не удалось сохранить время.'); });
      });
      var setDateOnly = byId('schoolSetDateOnly');
      if (setDateOnly) setDateOnly.addEventListener('click', function () {
        var lesson = currentLesson();
        var destination = selectedDestination(true);
        if (!lesson || !destination) return;
        moveLessonTo(
          lesson,
          destination,
          orderAtEnd(destination.date, destination.kind)
        ).catch(function () { setMutationMessage('Не удалось сохранить день.'); });
      });
      var setUnscheduled = byId('schoolSetUnscheduled');
      if (setUnscheduled) setUnscheduled.addEventListener('click', function () {
        var lesson = currentLesson();
        if (!lesson) return;
        moveLessonTo(
          lesson,
          { kind: 'unscheduled' },
          orderAtEnd(null, 'unscheduled')
        ).catch(function () { setMutationMessage('Не удалось снять урок с расписания.'); });
      });

      [
        ['schoolDurationDown', -1],
        ['schoolDurationUp', 1]
      ].forEach(function (entry) {
        var button = byId(entry[0]);
        if (!button) return;
        button.addEventListener('click', function () {
          var lesson = currentLesson();
          if (!lesson) return;
          var duration = core.changeDurationBySteps(lesson.durationMinutes, entry[1]);
          mutateWithDialogs({
            operation: 'changeLessonDuration',
            lessonId: lesson.id,
            durationMinutes: duration
          }).catch(function () {
            setMutationMessage('Не удалось изменить продолжительность.');
          });
        });
      });
    }

    return Object.freeze({
      applyCabinetSettings: applyCabinetSettings,
      bind: bind,
      closeSettings: closeSettings,
      closeDialog: closeDialog,
      finishTimelineZoom: finishTimelineZoom,
      getCabinetSettingsState: function () {
        return cabinetSettingsState ? cloneValue(cabinetSettingsState) : null;
      },
      getCabinetSettingsUiState: function () {
        return cloneValue(settingsUiState);
      },
      getCurrentLessonRoute: function () { return routeForLesson(currentLesson()); },
      getCurrentTeacherPrompt: getCurrentTeacherPrompt,
      getLessons: function () { return cloneLessons(lessons); },
      getReadModel: function () { return readModel; },
      getTimelineZoomState: function () {
        return {
          currentScale: timelineScale,
          targetScale: targetTimelineScale,
          wheelDelta: timelineWheelDelta,
          animating: Boolean(timelineZoomAnimation)
        };
      },
      handleTimelineWheel: handleTimelineWheel,
      load: load,
      openLesson: openLesson,
      openSettings: openSettings,
      receiveCabinetSettingsState: receiveCabinetSettingsState,
      revalidateAfterMutation: revalidateAfterMutation,
      retryRevalidation: retryRevalidation,
      render: render,
      runMutation: runMutation,
      saveCabinetSettings: saveCabinetSettings,
      selectView: selectView,
      updateCabinetSettingsDraft: updateCabinetSettingsDraft,
      usePendingCabinetSettings: usePendingCabinetSettings,
      keepCabinetSettingsDraft: keepCabinetSettingsDraft,
      whenMutationsIdle: function () { return queue.whenIdle(); }
    });
  }

  function boot() {
    if (!root || !root.document || !root.SchoolApi || !root.SchoolCore || !root.SchoolMutationQueue) return;
    var settingsStore = root.SchoolCabinetSettingsStore &&
      root.SchoolCabinetSettings
      ? root.SchoolCabinetSettingsStore.create({
        settingsCore: root.SchoolCabinetSettings,
        getSync: function () { return root.SupabaseSync; },
        storage: root.localStorage,
        eventTarget: root
      })
      : null;
    var controller = createController({
      api: root.SchoolApi,
      core: root.SchoolCore,
      mutationQueue: root.SchoolMutationQueue,
      document: root.document,
      cabinetSettingsCore: root.SchoolCabinetSettings,
      cabinetSettingsStore: settingsStore,
      learningConfig: root.SchoolLearningConfig,
      learningRoute: root.SchoolLearningRoute
    });
    root.SchoolController = controller;
    controller.bind();
    controller.load();
    if (settingsStore) {
      settingsStore.subscribe(function (state) {
        controller.receiveCabinetSettingsState(state);
      });
      settingsStore.load().catch(function () {
        controller.receiveCabinetSettingsState(settingsStore.getState());
      });
      if (typeof root.addEventListener === 'function') {
        root.addEventListener('pagehide', function () {
          settingsStore.destroy();
        }, { once: true });
      }
    }
  }

  if (root && root.document) {
    if (root.document.readyState === 'loading') root.document.addEventListener('DOMContentLoaded', boot);
    else boot();
  }

  return Object.freeze({
    ACTIVE_WEEK: ACTIVE_WEEK,
    TIME_ZONE: TIME_ZONE,
    WEEK_DAYS: WEEK_DAYS,
    allDayDropOrder: allDayDropOrder,
    allDayDropPlacement: allDayDropPlacement,
    applyTimelineGeometry: applyTimelineGeometry,
    appendLessonRoute: appendLessonRoute,
    applyTeacherResultToControls: applyTeacherResultToControls,
    assessmentDraft: assessmentDraft,
    cabinetSettingsDraft: cabinetSettingsDraft,
    copyPromptAndOpen: copyPromptAndOpen,
    createController: createController,
    commandAfterOverlapChoice: commandAfterOverlapChoice,
    commandForAllDayDrop: commandForAllDayDrop,
    commandForDrop: commandForDrop,
    decisionQueueCommand: decisionQueueCommand,
    diaryResult: diaryResult,
    diaryScores: diaryScores,
    getWeekTimeBounds: getWeekTimeBounds,
    groupDiaryLessons: groupDiaryLessons,
    layoutTimedLessons: layoutTimedLessons,
    isLessonDraggable: isLessonDraggable,
    lessonSignalLabels: lessonSignalLabels,
    makeTimelineDragPreviewNodes: makeTimelineDragPreviewNodes,
    mergeCabinetSettingsState: mergeCabinetSettingsState,
    partitionDecisionItems: partitionDecisionItems,
    renderContentBlocks: renderContentBlocks,
    routeDrawerRows: routeDrawerRows,
    safeHttpsUrl: safeHttpsUrl,
    selectTodayFocus: selectTodayFocus,
    setTransparentDragImage: setTransparentDragImage,
    syncAssessmentControlsForStatus: syncAssessmentControlsForStatus,
    timelineDragPreview: timelineDragPreview,
    timelineDestination: timelineDestination,
    teacherTargetForRoute: teacherTargetForRoute,
    timelineDropDestination: timelineDropDestination
  });
});
