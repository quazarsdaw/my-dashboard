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
  var RICH_BLOCK_TAGS = {
    paragraph: 'p',
    heading_1: 'h1',
    heading_2: 'h2',
    heading_3: 'h3',
    heading_4: 'h4',
    quote: 'blockquote',
    callout: 'aside',
    toggle: 'details'
  };
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

    (Array.isArray(blocks) ? blocks : []).forEach(function (block) {
      if (!isRecord(block)) return;
      var node;
      var tagName = RICH_BLOCK_TAGS[block.type];

      if (tagName) {
        node = element(documentRef, tagName, block.type === 'callout' ? 'school-content-callout' : '');
        appendSpans(node, block.spans, documentRef);
        appendChildren(node, block.children, documentRef);
        rootNode.appendChild(node);
        return;
      }

      if (block.type === 'bulleted_list_item' || block.type === 'numbered_list_item') {
        node = element(documentRef, 'li');
        appendSpans(node, block.spans, documentRef);
        appendChildren(node, block.children, documentRef);
        var list = element(documentRef, block.type === 'bulleted_list_item' ? 'ul' : 'ol');
        list.appendChild(node);
        rootNode.appendChild(list);
        return;
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
        return;
      }

      if (block.type === 'code') {
        node = element(documentRef, 'pre');
        var code = element(documentRef, 'code');
        appendSpans(code, block.spans, documentRef);
        node.appendChild(code);
        rootNode.appendChild(node);
        appendChildren(node, block.children, documentRef);
        return;
      }

      if (block.type === 'divider') {
        rootNode.appendChild(element(documentRef, 'hr'));
        return;
      }

      if (block.type === 'equation') {
        rootNode.appendChild(element(documentRef, 'p', 'school-content-equation', text(block.expression)));
        return;
      }

      if (block.type === 'table') {
        renderTableBlock(rootNode, block, documentRef);
        return;
      }

      if (block.type === 'column_list' || block.type === 'column' || block.type === 'synced_block') {
        node = element(documentRef, 'div', 'school-content-group');
        appendChildren(node, block.children, documentRef);
        rootNode.appendChild(node);
        return;
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
        return;
      }

      rootNode.appendChild(element(
        documentRef,
        'p',
        'school-content-unsupported',
        text(block.label) || 'неподдерживаемый блок'
      ));
    });

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

  function statusClass(status) {
    if (status === 'Выполнен') return ' is-done';
    if (status === 'Пропущен') return ' is-missed';
    if (status === 'В процессе') return ' is-active';
    return '';
  }

  function makeLessonCard(documentRef, lesson, openLesson) {
    var card = element(documentRef, 'button', 'school-lesson-card');
    card.type = 'button';
    if (lesson.status === 'Отменён') card.className += ' is-canceled';
    card.setAttribute('aria-label', 'Открыть урок: ' + lesson.title);
    card.addEventListener('click', function () { openLesson(lesson.id); });
    card.appendChild(element(documentRef, 'span', 'school-card-subject', lesson.subject));
    card.appendChild(element(documentRef, 'strong', 'school-card-title', lesson.title));
    var meta = element(documentRef, 'span', 'school-card-meta');
    meta.appendChild(element(documentRef, 'span', 'school-time', scheduleText(lesson)));
    meta.appendChild(element(documentRef, 'span', 'school-status' + statusClass(lesson.status), lesson.status));
    card.appendChild(meta);
    return card;
  }

  function createController(options) {
    options = isRecord(options) ? options : {};
    var documentRef = options.document === undefined ? (root && root.document) : options.document;
    var api = options.api || (root && root.SchoolApi);
    var core = options.core || (root && root.SchoolCore);
    var now = typeof options.now === 'function' ? options.now : function () { return new Date(); };
    var onState = typeof options.onState === 'function' ? options.onState : function () {};
    var lessons = [];
    var readModel = null;
    var currentView = 'today';
    var mobileDay = '2026-08-03';
    var previousFocus = null;
    var dialogKeyHandler = null;

    function byId(id) {
      return documentRef ? documentRef.getElementById(id) : null;
    }

    function setState(state, title, message) {
      onState(state);
      if (!documentRef) return;
      var app = byId('schoolApp');
      var stateNode = byId('schoolState');
      var ready = byId('schoolReady');
      if (app) app.setAttribute('data-state', state);
      if (app) app.setAttribute('aria-busy', state === 'loading' ? 'true' : 'false');
      if (stateNode) stateNode.hidden = state === 'ready';
      if (ready) ready.hidden = state !== 'ready';
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
        group.appendChild(row);
      });
      return group;
    }

    function renderDecisions(model) {
      var rootNode = byId('schoolDecisions');
      if (!rootNode) return;
      clearNode(rootNode);
      var persisted = model.persistedDecisions || [];
      var issues = model.runtimeIssues || [];
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
      if (persisted.length) groups.appendChild(renderDecisionGroup('Запрошенные действия', persisted, true));
      if (issues.length) groups.appendChild(renderDecisionGroup('Обнаруженные проблемы', issues, false));
      rootNode.appendChild(groups);
    }

    function renderToday(model) {
      var rootNode = byId('schoolToday');
      if (!rootNode) return;
      clearNode(rootNode);
      var today = model.today || [];
      var active = (model.activeLessons || [])[0] || null;
      var focus = active || today[0] || model.nextLesson;
      var metaNode = byId('schoolTodayMeta');
      if (metaNode) metaNode.textContent = today.length ? today.length + ' урока на день' : 'уроков на сегодня нет';

      if (!focus) {
        rootNode.appendChild(element(documentRef, 'div', 'school-empty', 'На сегодня и ближайшее время уроков нет.'));
        return;
      }

      var focusCard = element(documentRef, 'article', 'school-today-focus' + (focus.status === 'В процессе' ? ' is-active' : ''));
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
        remaining.forEach(function (lesson) { list.appendChild(makeLessonCard(documentRef, lesson, openLesson)); });
        rootNode.appendChild(list);
      }
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
          dayColumn.appendChild(makeLessonCard(documentRef, lesson, openLesson));
        });
        allDayGrid.appendChild(dayColumn);
      });
      shell.appendChild(allDayGrid);

      var timeShell = element(documentRef, 'div', 'school-time-shell');
      var labels = element(documentRef, 'div', 'school-time-labels');
      for (var hour = 9; hour <= 20; hour += 1) {
        var label = element(documentRef, 'span', 'school-hour-label', String(hour).padStart(2, '0') + ':00');
        label.style.top = ((hour - 9) * 60) + 'px';
        labels.appendChild(label);
      }
      timeShell.appendChild(labels);

      var columns = element(documentRef, 'div', 'school-time-columns');
      for (var half = 0; half <= 22; half += 1) {
        var line = element(documentRef, 'span', 'school-time-line' + (half % 2 ? ' is-half' : ''));
        line.style.top = (half * 30) + 'px';
        columns.appendChild(line);
      }
      WEEK_DAYS.forEach(function (day) {
        var timeDay = element(documentRef, 'div', 'school-time-day');
        timeDay.setAttribute('data-school-day', day.date);
        (scheduledByDay[day.date] || []).filter(function (lesson) {
          return lesson.schedule.kind === 'timed';
        }).forEach(function (lesson) {
          var start = timeMinutes(lesson.schedule.start);
          var end = timeMinutes(lesson.schedule.end);
          var card = element(documentRef, 'button', 'school-time-card');
          card.type = 'button';
          card.style.top = Math.max(0, start - 9 * 60) + 'px';
          card.style.height = Math.max(38, end - start) + 'px';
          card.setAttribute('aria-label', 'Открыть урок: ' + lesson.title);
          card.addEventListener('click', function () { openLesson(lesson.id); });
          card.appendChild(element(documentRef, 'strong', '', lesson.title));
          card.appendChild(element(documentRef, 'span', '', scheduleText(lesson)));
          if (lesson.status === 'Отменён') card.className += ' is-canceled';
          timeDay.appendChild(card);
        });
        columns.appendChild(timeDay);
      });
      timeShell.appendChild(columns);
      shell.appendChild(timeShell);
      rootNode.appendChild(shell);

      var unscheduled = lessons.filter(function (lesson) {
        return lesson.schedule && lesson.schedule.kind === 'unscheduled' && lesson.status !== 'Отменён';
      });
      if (unscheduled.length) {
        var details = element(documentRef, 'details', 'school-unscheduled');
        details.appendChild(element(documentRef, 'summary', '', 'Нераспределённые · ' + unscheduled.length));
        var list = element(documentRef, 'div', 'school-unscheduled-list');
        unscheduled.forEach(function (lesson) { list.appendChild(makeLessonCard(documentRef, lesson, openLesson)); });
        details.appendChild(list);
        rootNode.appendChild(details);
      }
      setMobileDay(mobileDay);
    }

    function diaryResult(lesson) {
      if (lesson.status === 'Пропущен') return 'Пропущен';
      return lesson.result || lesson.status;
    }

    function renderDiary(model) {
      var rootNode = byId('schoolDiary');
      if (!rootNode) return;
      clearNode(rootNode);
      var diary = (model.diary || []).filter(function (lesson) {
        return FINAL_DIARY_STATUSES.indexOf(lesson.status) !== -1;
      }).slice().sort(function (left, right) {
        return (right.schedule.date || '').localeCompare(left.schedule.date || '') || right.order - left.order;
      });
      if (!diary.length) {
        rootNode.appendChild(element(documentRef, 'div', 'school-empty', 'В дневнике пока нет завершённых занятий.'));
        return;
      }
      var list = element(documentRef, 'div', 'school-diary');
      diary.forEach(function (lesson) {
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
        row.appendChild(element(documentRef, 'span', 'school-diary-score', lesson.autonomy || ''));
        row.appendChild(element(
          documentRef,
          'span',
          'school-diary-score',
          lesson.understanding === null ? '' : String(lesson.understanding) + '/3'
        ));
        list.appendChild(row);
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

    function closeDialog() {
      if (!documentRef) return;
      var dialog = byId('schoolLessonDialog');
      if (!dialog || dialog.hidden) return;
      dialog.hidden = true;
      dialog.setAttribute('aria-hidden', 'true');
      if (dialogKeyHandler) documentRef.removeEventListener('keydown', dialogKeyHandler);
      dialogKeyHandler = null;
      if (previousFocus && typeof previousFocus.focus === 'function') previousFocus.focus();
      previousFocus = null;
    }

    function installDialogKeys(dialog) {
      dialogKeyHandler = function (event) {
        if (event.key === 'Escape') {
          event.preventDefault();
          closeDialog();
          return;
        }
        if (event.key !== 'Tab') return;
        var focusable = Array.from(dialog.querySelectorAll('button, a[href], [tabindex]:not([tabindex="-1"])'))
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
      if (documentRef) {
        var dialog = byId('schoolLessonDialog');
        if (dialog) {
          previousFocus = documentRef.activeElement;
          dialog.hidden = false;
          dialog.setAttribute('aria-hidden', 'false');
          byId('schoolLessonTitle').textContent = lesson ? lesson.title : 'Урок';
          byId('schoolLessonSubject').textContent = lesson ? lesson.subject : '';
          if (lesson) renderLessonMeta(lesson);
          clearNode(byId('schoolLessonContent'));
          byId('schoolContentState').textContent = 'Загружаю содержание урока…';
          installDialogKeys(dialog);
          var close = byId('schoolLessonClose');
          if (close) close.focus();
        }
      }

      try {
        var content = await api.getLessonContent(lessonId);
        if (documentRef) {
          byId('schoolContentState').textContent = content.blocks.length ? '' : 'У урока пока нет дополнительного содержания.';
          renderContentBlocks(byId('schoolLessonContent'), content.blocks, documentRef);
        }
        return content;
      } catch (error) {
        if (documentRef) byId('schoolContentState').textContent = 'Не удалось загрузить содержание урока.';
        return null;
      }
    }

    async function load() {
      setState('loading', 'Загружаю уроки', 'Проверяю доступ к личной школе.');
      try {
        lessons = await api.listLessons({ week: ACTIVE_WEEK });
        if (!Array.isArray(lessons) || lessons.length === 0) {
          setState('empty', 'Уроков пока нет', 'В выбранной учебной неделе нет доступных уроков.');
          return null;
        }
        readModel = core.buildReadModel(lessons, {
          activeWeek: ACTIVE_WEEK,
          now: now(),
          timeZone: TIME_ZONE
        });
        render(readModel);
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
    }

    return Object.freeze({
      bind: bind,
      closeDialog: closeDialog,
      load: load,
      openLesson: openLesson,
      render: render,
      selectView: selectView
    });
  }

  function boot() {
    if (!root || !root.document || !root.SchoolApi || !root.SchoolCore) return;
    var controller = createController({
      api: root.SchoolApi,
      core: root.SchoolCore,
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
    renderContentBlocks: renderContentBlocks,
    safeHttpsUrl: safeHttpsUrl
  });
});
