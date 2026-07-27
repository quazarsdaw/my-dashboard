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
    overlap: 'Уроки пересекаются по времени'
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

  function lessonSignalLabels(lesson, hasConflict) {
    var signals = [];
    if (lesson.status === 'В процессе') signals.push('Текущий урок');
    if (lesson.decisionRequest) signals.push('Запрошен перенос в другую неделю');
    if (lesson.moveCount >= 2) signals.push('переносился ' + lesson.moveCount + ' раза');
    (Array.isArray(lesson.warnings) ? lesson.warnings : []).forEach(function (warning) {
      if (warning && ISSUE_LABELS[warning.code]) signals.push(ISSUE_LABELS[warning.code]);
    });
    if (hasConflict) signals.push('Конфликт времени');
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

  function appendLessonDetails(card, documentRef, lesson, conflictIds, isSaving) {
    if (lesson.status === 'Отменён') card.className += ' is-canceled';
    card.appendChild(element(documentRef, 'span', 'school-card-subject', lesson.subject));
    card.appendChild(element(documentRef, 'strong', 'school-card-title', lesson.title));
    var meta = element(documentRef, 'span', 'school-card-meta');
    meta.appendChild(element(documentRef, 'span', 'school-time', scheduleText(lesson)));
    if (lesson.schedule.kind === 'timed') {
      meta.appendChild(element(documentRef, 'span', 'school-time', lesson.durationMinutes + ' минут'));
    }
    meta.appendChild(element(documentRef, 'span', 'school-status' + statusClass(lesson.status), lesson.status));
    meta.appendChild(element(documentRef, 'span', 'school-priority', lesson.priority));
    card.appendChild(meta);

    var signals = lessonSignalLabels(lesson, Boolean(conflictIds && conflictIds.has(lesson.id)));
    if (isSaving) signals.unshift('сохраняется');
    if (signals.length) {
      var warningRoot = element(documentRef, 'span', 'school-card-signals');
      signals.forEach(function (signal) {
        warningRoot.appendChild(element(documentRef, 'span', 'school-card-signal', signal));
      });
      card.appendChild(warningRoot);
    }
  }

  function makeLessonCard(documentRef, lesson, openLesson, conflictIds, configureCard, pendingLessonIds) {
    var card = element(documentRef, 'button', 'school-lesson-card');
    card.type = 'button';
    card.setAttribute('aria-label', 'Открыть урок: ' + lesson.title);
    card.addEventListener('click', function () { openLesson(lesson.id); });
    appendLessonDetails(
      card,
      documentRef,
      lesson,
      conflictIds,
      Boolean(pendingLessonIds && pendingLessonIds.has(lesson.id))
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

  function createController(options) {
    options = isRecord(options) ? options : {};
    var documentRef = options.document === undefined ? (root && root.document) : options.document;
    var runtime = options.runtime || root;
    var api = options.api || (root && root.SchoolApi);
    var core = options.core || (root && root.SchoolCore);
    var queueApi = options.mutationQueue || (root && root.SchoolMutationQueue);
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
    var mutationSequence = 0;
    var timelineZoomIndex = 0;
    var timelineAnchorFrame = null;
    var pendingTimelineAnchor = null;
    var draggedLessonId = null;
    var actionResolver = null;
    var actionPreviousFocus = null;
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
            pendingLessonIds
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
      clearNode(rootNode);
      clearNode(mobileRoot);
      var currentDay = localDateKey(now());
      if (WEEK_DAYS.some(function (day) { return day.date === currentDay; })) mobileDay = currentDay;
      var conflictIds = new Set();
      (model.runtimeIssues || []).forEach(function (issue) {
        if (issue.code === 'overlap') {
          (issue.lessonIds || []).forEach(function (lessonId) { conflictIds.add(lessonId); });
        }
      });
      var timedLessons = lessons.filter(function (lesson) {
        return lesson.schedule && lesson.schedule.kind === 'timed';
      });
      var bounds = getWeekTimeBounds(timedLessons);
      var zoomLevel = core.timelineZoomLevel(timelineZoomIndex);
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
      if (zoomOut) zoomOut.disabled = timelineZoomIndex === 0;
      if (zoomIn) zoomIn.disabled = timelineZoomIndex === 3;

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
          dayColumn.appendChild(makeLessonCard(
            documentRef,
            lesson,
            openLesson,
            conflictIds,
            configureDraggable,
            pendingLessonIds
          ));
        });
        configureDropZone(dayColumn, day.date, 'date-only');
        allDayGrid.appendChild(dayColumn);
      });
      shell.appendChild(allDayGrid);

      var timeShell = element(documentRef, 'div', 'school-time-shell');
      timeShell.id = 'schoolTimeShell';
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
      }
      timeShell.appendChild(labels);

      var columns = element(documentRef, 'div', 'school-time-columns');
      for (var minute = startMinute; minute <= endMinute; minute += zoomLevel.snapMinutes) {
        var minuteInHour = minute % 60;
        var lineKind = ' is-hour';
        if (minuteInHour === 30) lineKind = ' is-half';
        else if (minuteInHour === 15 || minuteInHour === 45) lineKind = ' is-quarter';
        else if (zoomLevel.snapMinutes === 10 && minuteInHour !== 0) lineKind = ' is-ten';
        else if (zoomLevel.snapMinutes === 5 && minuteInHour !== 0) lineKind = ' is-five';
        var line = element(documentRef, 'span', 'school-time-line' + lineKind);
        line.style.top = core.timelineYForMinute(
          minute,
          startMinute,
          zoomLevel.pixelsPerHour
        ) + 'px';
        columns.appendChild(line);
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
            pendingLessonIds.has(lesson.id)
          );
          configureDraggable(card, lesson);
          timeDay.appendChild(card);
        });
        configureDropZone(timeDay, day.date, 'timed', bounds, zoomLevel);
        columns.appendChild(timeDay);
      });
      timeShell.appendChild(columns);
      timeShell.addEventListener('wheel', function (event) {
        handleTimelineWheel(event, timeShell, bounds);
      }, { passive: false });
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
            pendingLessonIds
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

    function restoreTimelineAnchor(anchor, targetIndex) {
      if (!runtime || typeof runtime.requestAnimationFrame !== 'function') {
        pendingTimelineAnchor = null;
        return;
      }
      if (
        timelineAnchorFrame !== null &&
        typeof runtime.cancelAnimationFrame === 'function'
      ) {
        runtime.cancelAnimationFrame(timelineAnchorFrame);
      }
      pendingTimelineAnchor = anchor;
      var targetLevel = core.timelineZoomLevel(targetIndex);
      timelineAnchorFrame = runtime.requestAnimationFrame(function () {
        timelineAnchorFrame = null;
        pendingTimelineAnchor = null;
        var nextShell = byId('schoolTimeShell');
        if (!nextShell || typeof nextShell.getBoundingClientRect !== 'function') return;
        var nextRect = nextShell.getBoundingClientRect();
        var nextY = core.timelineYForMinute(
          anchor.minute,
          anchor.bounds.startHour * 60,
          targetLevel.pixelsPerHour
        );
        if (typeof runtime.scrollBy === 'function') {
          runtime.scrollBy(0, nextRect.top + nextY - anchor.clientY);
        }
      });
    }

    function setTimelineZoom(nextIndex, anchor) {
      var normalized = core.timelineZoomLevel(nextIndex).index;
      if (normalized === timelineZoomIndex) return false;
      timelineZoomIndex = normalized;
      if (readModel) buildModel();
      var nextShell = byId('schoolTimeShell');
      if (nextShell) {
        nextShell.classList.add('is-zooming');
        if (runtime && typeof runtime.setTimeout === 'function') {
          runtime.setTimeout(function () {
            var currentShell = byId('schoolTimeShell');
            if (currentShell) currentShell.classList.remove('is-zooming');
          }, 140);
        }
      }
      if (anchor) restoreTimelineAnchor(anchor, normalized);
      return true;
    }

    function handleTimelineWheel(event, timeShell, bounds) {
      if (!event || !event.deltaY) return;
      var direction = event.deltaY < 0 ? 1 : -1;
      var nextIndex = core.nextTimelineZoomIndex(timelineZoomIndex, direction);
      if (nextIndex === timelineZoomIndex) return;
      event.preventDefault();
      var anchor = pendingTimelineAnchor;
      if (!anchor) {
        var rect = timeShell.getBoundingClientRect();
        var current = core.timelineZoomLevel(timelineZoomIndex);
        anchor = {
          minute: bounds.startHour * 60
            + (event.clientY - rect.top) / current.pixelsPerHour * 60,
          clientY: event.clientY,
          bounds: bounds
        };
      }
      setTimelineZoom(nextIndex, anchor);
    }

    function zoomTimelineFromButton(direction) {
      var nextIndex = core.nextTimelineZoomIndex(timelineZoomIndex, direction);
      if (nextIndex === timelineZoomIndex) return;
      var timeShell = byId('schoolTimeShell');
      if (!timeShell || typeof timeShell.getBoundingClientRect !== 'function') {
        setTimelineZoom(nextIndex);
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
      var anchor = pendingTimelineAnchor;
      if (!anchor) {
        var current = core.timelineZoomLevel(timelineZoomIndex);
        anchor = {
          minute: bounds.startHour * 60
            + (clientY - rect.top) / current.pixelsPerHour * 60,
          clientY: clientY,
          bounds: bounds
        };
      }
      setTimelineZoom(nextIndex, anchor);
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
      confirmedLessons = await api.listLessons({ week: ACTIVE_WEEK });
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
      if (!lessonDialog || lessonDialog.hidden) {
        setBackgroundInert(false);
        if (actionPreviousFocus && typeof actionPreviousFocus.focus === 'function') {
          actionPreviousFocus.focus();
        }
        actionPreviousFocus = null;
      }
      if (
        dialogKeyHandler &&
        (!lessonDialog || lessonDialog.hidden) &&
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
        if (!lessonDialog || lessonDialog.hidden) {
          actionPreviousFocus = documentRef.activeElement;
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
        draggedLessonId = lesson.id;
        card.classList.add('is-dragging');
        if (event.dataTransfer) {
          event.dataTransfer.effectAllowed = 'move';
          event.dataTransfer.setData('text/plain', lesson.id);
        }
      });
      card.addEventListener('dragend', function () {
        draggedLessonId = null;
        card.classList.remove('is-dragging');
        var preview = byId('schoolWeekTimeMeta');
        if (preview) preview.textContent = preview.getAttribute('data-default-text') || preview.textContent;
      });
    }

    function draggedLesson(event) {
      var id = draggedLessonId;
      if (!id && event && event.dataTransfer) {
        id = event.dataTransfer.getData('text/plain');
      }
      return lessons.find(function (lesson) { return lesson.id === id; }) || null;
    }

    function configureDropZone(node, day, kind, bounds, zoomLevel) {
      if (!node) return;
      node.addEventListener('dragover', function (event) {
        if (!draggedLesson(event)) return;
        event.preventDefault();
        node.classList.add('school-drop-active');
        if (kind !== 'timed' || !bounds || typeof node.getBoundingClientRect !== 'function') return;
        var rect = node.getBoundingClientRect();
        var destination = timelineDestination(core, day, event.clientY, rect, bounds, zoomLevel);
        var lesson = draggedLesson(event);
        var previewSchedule = core.scheduleForDestination(
          destination,
          lesson.durationMinutes
        );
        var preview = byId('schoolWeekTimeMeta');
        if (preview) preview.textContent = scheduleRange(previewSchedule.start, previewSchedule.end);
      });
      node.addEventListener('dragleave', function () {
        node.classList.remove('school-drop-active');
      });
      node.addEventListener('drop', function (event) {
        event.preventDefault();
        node.classList.remove('school-drop-active');
        var lesson = draggedLesson(event);
        draggedLessonId = null;
        if (!lesson) return;
        var destination;
        if (kind === 'unscheduled') {
          destination = { kind: 'unscheduled' };
        } else if (kind === 'date-only') {
          destination = { kind: 'date-only', date: day };
        } else {
          var rect = typeof node.getBoundingClientRect === 'function'
            ? node.getBoundingClientRect()
            : { top: 0 };
          destination = timelineDestination(core, day, event.clientY, rect, bounds, zoomLevel);
        }
        var order = orderAtEnd(
          destinationDate(destination),
          destination.kind
        );
        moveLessonTo(lesson, destination, order).catch(function () {
          setMutationMessage('Не удалось перенести урок.');
        });
      });
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
      if (byId('schoolLessonResult')) byId('schoolLessonResult').value = lesson.result || 'Зачёт';
      if (byId('schoolLessonAutonomy')) byId('schoolLessonAutonomy').value = lesson.autonomy || 'A2';
      if (byId('schoolLessonUnderstanding')) {
        byId('schoolLessonUnderstanding').value = lesson.understanding === null
          ? '2'
          : String(lesson.understanding);
      }
      if (byId('schoolLessonMissedReason')) {
        byId('schoolLessonMissedReason').value = lesson.missedReason || 'Внешние обстоятельства';
      }
      if (byId('schoolLessonComment')) byId('schoolLessonComment').value = lesson.comment || '';
      if (byId('schoolLessonArtifact')) byId('schoolLessonArtifact').value = lesson.artifactUrl || '';

      var scheduleControls = byId('schoolScheduleControls');
      if (scheduleControls) {
        scheduleControls.hidden = ['Выполнен', 'Частично выполнен', 'Отменён'].indexOf(lesson.status) !== -1;
      }
      var assessmentControls = byId('schoolAssessmentControls');
      if (assessmentControls) assessmentControls.hidden = lesson.status === 'Отменён';

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
        appendAction(actionRoot, 'Выполнен', 'is-primary', function () {
          return mutateWithDialogs(assessmentCommand(lesson, 'Выполнен'));
        });
        appendAction(actionRoot, 'Частично выполнен', '', function () {
          return mutateWithDialogs(assessmentCommand(lesson, 'Частично выполнен'));
        });
        appendAction(actionRoot, 'Пропущен', 'is-danger', function () {
          return mutateWithDialogs(assessmentCommand(lesson, 'Пропущен'));
        });
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
      currentContentLessonId = null;
      dialog.hidden = true;
      dialog.setAttribute('aria-hidden', 'true');
      if (dialogKeyHandler) documentRef.removeEventListener('keydown', dialogKeyHandler);
      dialogKeyHandler = null;
      setBackgroundInert(false);
      clearNode(byId('schoolLessonMeta'));
      clearNode(byId('schoolLessonContent'));
      clearNode(byId('schoolLessonActions'));
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
          closeDialog();
          return;
        }
        if (event.key !== 'Tab') return;
        var focusRoot = actionDialogOpen() ? byId('schoolActionDialog') : dialog;
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
          documentRef &&
          requestGeneration === dialogGeneration &&
          currentContentLessonId === lessonId &&
          !byId('schoolLessonDialog').hidden
        ) {
          byId('schoolContentState').textContent = content.blocks.length ? '' : 'У урока пока нет дополнительного содержания.';
          renderContentBlocks(byId('schoolLessonContent'), content.blocks, documentRef);
        }
        return content;
      } catch (error) {
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
      bind: bind,
      closeDialog: closeDialog,
      getLessons: function () { return cloneLessons(lessons); },
      getReadModel: function () { return readModel; },
      handleTimelineWheel: handleTimelineWheel,
      load: load,
      openLesson: openLesson,
      revalidateAfterMutation: revalidateAfterMutation,
      retryRevalidation: retryRevalidation,
      render: render,
      runMutation: runMutation,
      selectView: selectView,
      whenMutationsIdle: function () { return queue.whenIdle(); }
    });
  }

  function boot() {
    if (!root || !root.document || !root.SchoolApi || !root.SchoolCore || !root.SchoolMutationQueue) return;
    var controller = createController({
      api: root.SchoolApi,
      core: root.SchoolCore,
      mutationQueue: root.SchoolMutationQueue,
      document: root.document
    });
    root.SchoolController = controller;
    controller.bind();
    controller.load();
  }

  if (root && root.document) {
    if (root.document.readyState === 'loading') root.document.addEventListener('DOMContentLoaded', boot);
    else boot();
  }

  return Object.freeze({
    ACTIVE_WEEK: ACTIVE_WEEK,
    TIME_ZONE: TIME_ZONE,
    WEEK_DAYS: WEEK_DAYS,
    createController: createController,
    commandAfterOverlapChoice: commandAfterOverlapChoice,
    commandForDrop: commandForDrop,
    decisionQueueCommand: decisionQueueCommand,
    diaryResult: diaryResult,
    diaryScores: diaryScores,
    getWeekTimeBounds: getWeekTimeBounds,
    groupDiaryLessons: groupDiaryLessons,
    layoutTimedLessons: layoutTimedLessons,
    isLessonDraggable: isLessonDraggable,
    lessonSignalLabels: lessonSignalLabels,
    partitionDecisionItems: partitionDecisionItems,
    renderContentBlocks: renderContentBlocks,
    safeHttpsUrl: safeHttpsUrl,
    selectTodayFocus: selectTodayFocus,
    timelineDestination: timelineDestination
  });
});
