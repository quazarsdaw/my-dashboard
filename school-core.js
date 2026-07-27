(function (root, factory) {
  'use strict';

  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.SchoolCore = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var CANCELED = 'Отменён';
  var FINALIZED = ['Выполнен', 'Частично выполнен', 'Пропущен'];
  var ASSESSMENT_FIELDS = ['result', 'autonomy', 'understanding'];
  var KNOWN_WARNING_CODES = ['invalid-duration', 'duration-mismatch', 'invalid-date'];
  var ACTIVE_WEEK = Object.freeze({
    key: 'W01 · 3–9 августа 2026',
    start: '2026-08-03',
    end: '2026-08-09',
    timeZone: 'Asia/Yekaterinburg'
  });
  var DRAG_SNAP_MINUTES = 15;
  var DURATION_STEP_MINUTES = 5;
  var TIMELINE_ZOOM_LEVELS = Object.freeze([
    Object.freeze({ index: 0, label: '×1 · шаг 15 минут', pixelsPerHour: 60, snapMinutes: 15 }),
    Object.freeze({ index: 1, label: '×1.5 · шаг 10 минут', pixelsPerHour: 90, snapMinutes: 10 }),
    Object.freeze({ index: 2, label: '×2 · шаг 5 минут', pixelsPerHour: 120, snapMinutes: 5 }),
    Object.freeze({ index: 3, label: '×3 · шаг 5 минут', pixelsPerHour: 180, snapMinutes: 5 })
  ]);

  function isRecord(value) {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
  }

  function text(value) {
    return typeof value === 'string' ? value.trim() : '';
  }

  function dateKey(value) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
    var parts = value.split('-').map(Number);
    var date = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2]));
    if (date.getUTCFullYear() !== parts[0] || date.getUTCMonth() !== parts[1] - 1 || date.getUTCDate() !== parts[2]) return null;
    return value;
  }

  function timeZoneDayKey(value, timeZone) {
    var date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) return null;
    var parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: timeZone,
      year: 'numeric', month: '2-digit', day: '2-digit'
    }).formatToParts(date);
    var values = {};
    parts.forEach(function (part) { values[part.type] = part.value; });
    return values.year && values.month && values.day ? values.year + '-' + values.month + '-' + values.day : null;
  }

  function normalizeSchedule(value) {
    var raw = isRecord(value) ? value : {};
    var kind = ['unscheduled', 'date-only', 'timed'].indexOf(raw.kind) !== -1 ? raw.kind : 'unscheduled';
    var date = dateKey(raw.date);
    var start = text(raw.start) || null;
    var end = text(raw.end) || null;
    if (kind === 'unscheduled') return { kind: 'unscheduled', date: null, start: null, end: null };
    if (kind === 'date-only') return { kind: 'date-only', date: date, start: null, end: null };
    return { kind: 'timed', date: date, start: start, end: end };
  }

  function addMinutesPreservingOffset(start, minutes) {
    var timestamp = Date.parse(start);
    if (!Number.isFinite(timestamp)) return null;
    var nextTimestamp = timestamp + minutes * 60000;
    if (/Z$/.test(start)) return new Date(nextTimestamp).toISOString();
    var offset = start.match(/([+-])(\d{2}):(\d{2})$/);
    if (!offset) return null;
    var direction = offset[1] === '+' ? 1 : -1;
    var offsetMinutes = direction * (Number(offset[2]) * 60 + Number(offset[3]));
    var local = new Date(nextTimestamp + offsetMinutes * 60000).toISOString().slice(0, 19);
    return local + offset[0];
  }

  function timelineZoomLevel(index) {
    var normalized = Number.isInteger(index) ? index : 0;
    return TIMELINE_ZOOM_LEVELS[Math.max(0, Math.min(TIMELINE_ZOOM_LEVELS.length - 1, normalized))];
  }

  function nextTimelineZoomIndex(index, direction) {
    return timelineZoomLevel(Number(index) + (direction > 0 ? 1 : -1)).index;
  }

  function timelineYForMinute(minute, startMinute, pixelsPerHour) {
    return (Number(minute) - Number(startMinute)) / 60 * Number(pixelsPerHour);
  }

  function timelineMinuteAtY(y, startMinute, pixelsPerHour, snapMinutes) {
    return snapMinuteOfDay(
      Number(startMinute) + Number(y) / Number(pixelsPerHour) * 60,
      snapMinutes
    );
  }

  function snapMinuteOfDay(value, stepMinutes) {
    var minutes = Number(value);
    var step = Number.isInteger(stepMinutes) && stepMinutes > 0 ? stepMinutes : DRAG_SNAP_MINUTES;
    if (!Number.isFinite(minutes)) return 0;
    return Math.max(0, Math.min(24 * 60 - step,
      Math.round(minutes / step) * step));
  }

  function changeDurationBySteps(duration, stepDelta) {
    var current = Number.isInteger(duration) && duration >= 15 && duration <= 180 ? duration : 45;
    var steps = Number.isInteger(stepDelta) ? stepDelta : 0;
    return Math.max(15, Math.min(180, current + steps * DURATION_STEP_MINUTES));
  }

  function scheduleForDestination(destination, durationMinutes) {
    if (!isRecord(destination)) return { kind: 'unscheduled', date: null, start: null, end: null };
    if (destination.kind === 'date-only') {
      return { kind: 'date-only', date: dateKey(destination.date), start: null, end: null };
    }
    if (destination.kind === 'timed') {
      var start = text(destination.start);
      return {
        kind: 'timed',
        date: start ? start.slice(0, 10) : null,
        start: start || null,
        end: start ? addMinutesPreservingOffset(start, durationMinutes) : null
      };
    }
    return { kind: 'unscheduled', date: null, start: null, end: null };
  }

  function orderForDrop(previousOrder, nextOrder) {
    var previous = Number(previousOrder);
    var next = Number(nextOrder);
    var hasPrevious = previousOrder !== null && Number.isFinite(previous);
    var hasNext = nextOrder !== null && Number.isFinite(next);
    if (!hasPrevious && !hasNext) return 100;
    if (!hasPrevious) return next - 50;
    if (!hasNext) return previous + 100;
    return previous + (next - previous) / 2;
  }

  function renumberLessonOrders(lessons) {
    return (lessons || []).slice().sort(function (left, right) {
      return Number(left.order) - Number(right.order) || text(left.id).localeCompare(text(right.id));
    }).map(function (lesson, index) {
      return { id: text(lesson.id), order: (index + 1) * 100 };
    });
  }

  function isTimedLesson(lesson) {
    return lesson && lesson.status !== CANCELED && lesson.schedule &&
      lesson.schedule.kind === 'timed' && text(lesson.schedule.start) && text(lesson.schedule.end);
  }

  function overlaps(left, right) {
    return left.schedule.start < right.schedule.end &&
      left.schedule.end > right.schedule.start;
  }

  function findTimeConflicts(candidate, lessons) {
    if (!isTimedLesson(candidate)) return [];
    return (lessons || []).filter(function (lesson) {
      return isTimedLesson(lesson) && lesson.id !== candidate.id &&
        lesson.schedule.date === candidate.schedule.date &&
        overlaps(candidate, lesson);
    }).slice().sort(function (left, right) {
      return left.schedule.start.localeCompare(right.schedule.start) ||
        left.order - right.order || left.id.localeCompare(right.id);
    });
  }

  function findShortBreaks(lessons) {
    var timed = (lessons || []).filter(isTimedLesson).slice().sort(function (left, right) {
      return left.schedule.start.localeCompare(right.schedule.start) ||
        left.order - right.order || left.id.localeCompare(right.id);
    });
    var warnings = [];
    for (var index = 1; index < timed.length; index += 1) {
      var previous = timed[index - 1];
      var next = timed[index];
      if (previous.schedule.date !== next.schedule.date) continue;
      var gapMinutes = (Date.parse(next.schedule.start) - Date.parse(previous.schedule.end)) / 60000;
      if (Number.isFinite(gapMinutes) && gapMinutes >= 0 && gapMinutes < 5) {
        warnings.push({
          code: 'short-break',
          gapMinutes: gapMinutes,
          lessonIds: [previous.id, next.id]
        });
      }
    }
    return warnings;
  }

  function normalizeLesson(raw) {
    raw = isRecord(raw) ? raw : {};
    var rawSchedule = isRecord(raw.schedule) ? raw.schedule : {};
    var schedule = normalizeSchedule(rawSchedule);
    var status = text(raw.status) || 'Нераспределён';
    var duration = Number(raw.durationMinutes);
    var warnings = [];
    (Array.isArray(raw.warnings) ? raw.warnings : []).forEach(function (warning) {
      var code = isRecord(warning) ? text(warning.code) : '';
      if (KNOWN_WARNING_CODES.indexOf(code) !== -1 && !warnings.some(function (item) { return item.code === code; })) {
        warnings.push({ code: code });
      }
    });
    if (
      rawSchedule.kind !== 'unscheduled' &&
      rawSchedule.kind !== undefined &&
      !schedule.date &&
      !warnings.some(function (item) { return item.code === 'invalid-date'; })
    ) {
      warnings.push({ code: 'invalid-date' });
    }
    if (!Number.isFinite(duration) || duration < 15 || duration > 180) duration = 45;
    var result = text(raw.result) || null;
    var autonomy = text(raw.autonomy) || null;
    var understanding = Number.isInteger(raw.understanding) && raw.understanding >= 0 && raw.understanding <= 3
      ? raw.understanding : null;
    var comment = text(raw.comment);
    var artifactUrl = text(raw.artifactUrl) || null;
    var finalized = FINALIZED.indexOf(status) !== -1;
    return {
      id: text(raw.id), title: text(raw.title), subject: text(raw.subject), module: text(raw.module),
      schedule: schedule, status: status, priority: text(raw.priority) || 'Could', week: text(raw.week),
      result: result, autonomy: autonomy, understanding: understanding, artifactUrl: artifactUrl, comment: comment,
      missedReason: text(raw.missedReason) || null, moveCount: Number.isFinite(Number(raw.moveCount)) ? Number(raw.moveCount) : 0,
      durationMinutes: duration, order: Number.isFinite(Number(raw.order)) ? Number(raw.order) : 0,
      decisionRequest: text(raw.decisionRequest) || null,
      hasLearningEvidence: status === 'В процессе' || status === 'Частично выполнен' || status === 'Выполнен'
        || Boolean(result || autonomy || understanding !== null || comment || artifactUrl),
      isFinalized: finalized, warnings: warnings
    };
  }

  function getLessonDayKey(lesson, timeZone) {
    var schedule = lesson && lesson.schedule;
    if (!schedule || schedule.kind === 'unscheduled') return null;
    if (dateKey(schedule.date)) return schedule.date;
    return schedule.kind === 'timed' ? timeZoneDayKey(schedule.start, timeZone) : null;
  }

  function sortLessonsForDay(lessons) {
    return (lessons || []).slice().sort(function (left, right) {
      if (left.status === 'В процессе' && right.status !== 'В процессе') return -1;
      if (right.status === 'В процессе' && left.status !== 'В процессе') return 1;
      var leftTimed = left.schedule && left.schedule.kind === 'timed';
      var rightTimed = right.schedule && right.schedule.kind === 'timed';
      if (leftTimed && !rightTimed) return -1;
      if (!leftTimed && rightTimed) return 1;
      if (leftTimed && rightTimed && left.schedule.start !== right.schedule.start) return (left.schedule.start || '').localeCompare(right.schedule.start || '');
      if (left.order !== right.order) return left.order - right.order;
      return left.id.localeCompare(right.id);
    });
  }

  function countSubjects(lessons) {
    return (lessons || []).reduce(function (counts, lesson) {
      var subject = lesson.subject || '';
      if (subject) counts[subject] = (counts[subject] || 0) + 1;
      return counts;
    }, {});
  }

  function computeWeeklyProgress(lessons) {
    var progress = { completed: 0, total: 0, partial: 0, missed: 0 };
    (lessons || []).forEach(function (lesson) {
      if (lesson.status === CANCELED) return;
      progress.total += 1;
      if (lesson.status === 'Выполнен') progress.completed += 1;
      if (lesson.status === 'Частично выполнен') progress.partial += 1;
      if (lesson.status === 'Пропущен') progress.missed += 1;
    });
    return progress;
  }

  function selectDiaryLessons(lessons) {
    return (lessons || []).filter(function (lesson) { return FINALIZED.indexOf(lesson.status) !== -1; });
  }

  function selectNextLesson(lessons, now, timeZone) {
    var day = timeZoneDayKey(now, timeZone);
    var nowTime = new Date(now).getTime();
    var candidates = (lessons || []).filter(function (lesson) {
      return lesson.status !== CANCELED && !lesson.isFinalized && lesson.status !== 'В процессе';
    });
    var timed = candidates.filter(function (lesson) {
      return lesson.schedule.kind === 'timed' && lesson.schedule.start
        && getLessonDayKey(lesson, timeZone) >= day && new Date(lesson.schedule.start).getTime() >= nowTime;
    }).sort(function (left, right) { return left.schedule.start.localeCompare(right.schedule.start) || left.order - right.order; });
    if (timed.length) return timed[0];
    var dateOnly = candidates.filter(function (lesson) {
      return lesson.schedule.kind === 'date-only' && getLessonDayKey(lesson, timeZone) >= day;
    }).sort(function (left, right) { return getLessonDayKey(left, timeZone).localeCompare(getLessonDayKey(right, timeZone)) || left.order - right.order; });
    return dateOnly[0] || null;
  }

  function hasAssessment(lesson) {
    return ASSESSMENT_FIELDS.some(function (field) { return lesson[field] !== null && lesson[field] !== ''; });
  }

  function computeRuntimeIssues(lessons, now, timeZone) {
    var active = (lessons || []).filter(function (lesson) { return lesson.status === 'В процессе'; });
    var included = (lessons || []).filter(function (lesson) { return lesson.status !== CANCELED; });
    var issues = [];
    if (active.length > 1) issues.push({ code: 'multiple-active', lessonIds: active.map(function (lesson) { return lesson.id; }) });
    included.forEach(function (lesson) {
      if (lesson.status === 'Запланирован' && hasAssessment(lesson)) issues.push({ code: 'planned-with-assessment', lessonId: lesson.id });
      if (lesson.status === 'Пропущен' && (lesson.autonomy || lesson.understanding !== null)) issues.push({ code: 'missed-with-assessment', lessonId: lesson.id });
      (Array.isArray(lesson.warnings) ? lesson.warnings : []).forEach(function (warning) {
        if (warning && KNOWN_WARNING_CODES.indexOf(warning.code) !== -1) {
          issues.push({ code: warning.code, lessonId: lesson.id });
        }
      });
    });
    included.forEach(function (lesson) {
      var lessonDay = getLessonDayKey(lesson, timeZone);
      var nowDay = timeZoneDayKey(now, timeZone);
      if (lesson.status === 'Запланирован' && lessonDay && nowDay && lessonDay < nowDay) issues.push({ code: 'overdue-planned', lessonId: lesson.id });
    });
    var byDayAndOrder = {};
    included.forEach(function (lesson) {
      var day = getLessonDayKey(lesson, timeZone);
      if (!day) return;
      var key = day + ':' + lesson.order;
      (byDayAndOrder[key] || (byDayAndOrder[key] = [])).push(lesson.id);
    });
    Object.keys(byDayAndOrder).sort().forEach(function (key) {
      if (byDayAndOrder[key].length > 1) issues.push({ code: 'duplicate-order', lessonIds: byDayAndOrder[key] });
    });
    var timed = included.filter(function (lesson) { return lesson.schedule.kind === 'timed' && lesson.schedule.start && lesson.schedule.end; });
    for (var index = 0; index < timed.length; index += 1) {
      for (var other = index + 1; other < timed.length; other += 1) {
        if (getLessonDayKey(timed[index], timeZone) !== getLessonDayKey(timed[other], timeZone)) continue;
        if (timed[index].schedule.start < timed[other].schedule.end && timed[other].schedule.start < timed[index].schedule.end) {
          issues.push({ code: 'overlap', lessonIds: [timed[index].id, timed[other].id] });
        }
      }
    }
    return issues;
  }

  function buildReadModel(lessons, context) {
    context = isRecord(context) ? context : {};
    var timeZone = text(context.timeZone) || 'Asia/Yekaterinburg';
    var normalized = (lessons || []).map(normalizeLesson);
    var activeWeek = text(context.activeWeek);
    if (activeWeek) normalized = normalized.filter(function (lesson) { return lesson.week === activeWeek; });
    var todayKey = timeZoneDayKey(context.now, timeZone);
    var today = sortLessonsForDay(normalized.filter(function (lesson) { return getLessonDayKey(lesson, timeZone) === todayKey; }));
    var weekDays = normalized.reduce(function (days, lesson) {
      var day = getLessonDayKey(lesson, timeZone);
      if (day) (days[day] || (days[day] = [])).push(lesson);
      return days;
    }, {});
    Object.keys(weekDays).forEach(function (day) { weekDays[day] = sortLessonsForDay(weekDays[day]); });
    return {
      today: today,
      weekDays: weekDays,
      diary: selectDiaryLessons(normalized),
      progress: computeWeeklyProgress(normalized),
      activeLessons: normalized.filter(function (lesson) { return lesson.status === 'В процессе'; }),
      nextLesson: selectNextLesson(normalized, context.now, timeZone),
      persistedDecisions: normalized.filter(function (lesson) { return lesson.status !== CANCELED && lesson.decisionRequest; }),
      runtimeIssues: computeRuntimeIssues(normalized, context.now, timeZone)
    };
  }

  return {
    ACTIVE_WEEK: ACTIVE_WEEK,
    DRAG_SNAP_MINUTES: DRAG_SNAP_MINUTES,
    DURATION_STEP_MINUTES: DURATION_STEP_MINUTES,
    normalizeLesson: normalizeLesson,
    getLessonDayKey: getLessonDayKey,
    sortLessonsForDay: sortLessonsForDay,
    countSubjects: countSubjects,
    computeWeeklyProgress: computeWeeklyProgress,
    selectDiaryLessons: selectDiaryLessons,
    selectNextLesson: selectNextLesson,
    computeRuntimeIssues: computeRuntimeIssues,
    buildReadModel: buildReadModel,
    snapMinuteOfDay: snapMinuteOfDay,
    timelineZoomLevel: timelineZoomLevel,
    nextTimelineZoomIndex: nextTimelineZoomIndex,
    timelineYForMinute: timelineYForMinute,
    timelineMinuteAtY: timelineMinuteAtY,
    changeDurationBySteps: changeDurationBySteps,
    scheduleForDestination: scheduleForDestination,
    orderForDrop: orderForDrop,
    renumberLessonOrders: renumberLessonOrders,
    findTimeConflicts: findTimeConflicts,
    findShortBreaks: findShortBreaks
  };
});
