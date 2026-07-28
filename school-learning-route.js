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

  function ownValue(record, key) {
    return record && Object.prototype.hasOwnProperty.call(record, key)
      ? record[key]
      : undefined;
  }

  function overrideValue(override, key) {
    return override && text(override[key]) ? text(override[key]) : null;
  }

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

  function warning(code, message) {
    return Object.freeze({ code: code, message: message });
  }

  function resolveCabinet(cabinetId, cabinet) {
    if (cabinet) {
      return {
        cabinetId: cabinetId,
        cabinetLabel: text(cabinet.label) || cabinetId,
        platform: text(cabinet.platform) || 'Unknown',
        cabinetKind: text(cabinet.kind) || 'unknown'
      };
    }
    return {
      cabinetId: cabinetId,
      cabinetLabel: cabinetId,
      platform: 'Unknown',
      cabinetKind: 'unknown'
    };
  }

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

  function reviewerFor(defaults, source, warnings) {
    var cabinet = ownValue(source.cabinets, defaults.cabinetId);
    var teacher = ownValue(source.teachers, defaults.teacherId);
    if (!cabinet || !teacher || text(cabinet.platform) !== 'ChatGPT') return null;
    var rawUrl = text(cabinet.url);
    var url = normalizeRouteUrl(rawUrl, HOSTS.ChatGPT);
    if (!rawUrl) {
      warnings.push(warning(
        'missing-reviewer-url',
        'Не задан URL проверяющего'
      ));
    } else if (!url) {
      warnings.push(warning(
        'invalid-reviewer-url',
        'Некорректный URL проверяющего'
      ));
    }
    return Object.freeze({
      cabinetId: defaults.cabinetId,
      cabinetLabel: text(cabinet.label) || defaults.cabinetId,
      teacherId: defaults.teacherId,
      teacherLabel: text(teacher.label) || defaults.teacherId,
      modelHint: teacher && text(teacher.modelHint) || null,
      url: url
    });
  }

  function resolveLessonRoute(lesson, config) {
    var item = lesson && typeof lesson === 'object' ? lesson : {};
    var source = config && typeof config === 'object' ? config : {};
    var defaults = ownValue(source.defaultsBySubject, text(item.subject)) ||
      source.globalFallback || {};
    var override = item.routeOverride || {};
    var explicitCabinetId = overrideValue(override, 'cabinetId');
    var explicitTeacherId = overrideValue(override, 'teacherId');
    var explicitFormat = overrideValue(override, 'format');
    var cabinetId = explicitCabinetId || text(defaults.cabinetId);
    var teacherId = explicitTeacherId || text(defaults.teacherId);
    var format = explicitFormat || text(defaults.format);
    var cabinets = source.cabinets || {};
    var teachers = source.teachers || {};
    var cabinet = ownValue(cabinets, cabinetId);
    var teacher = ownValue(teachers, teacherId);
    var routeCabinet = resolveCabinet(cabinetId, cabinet);
    var routeTeacherLabel = teacher ? text(teacher.label) || teacherId : teacherId;
    var warnings = [];
    var unknownOverride = false;
    var rawResourceUrl = text(override.resourceUrl);
    var resourceUrl = normalizeRouteUrl(rawResourceUrl);
    var cabinetUrl = null;
    var canOpenCabinet = false;

    if (explicitCabinetId && !cabinet) {
      warnings.push(warning(
        'unknown-cabinet',
        'Неизвестный кабинет: ' + explicitCabinetId
      ));
      unknownOverride = true;
    }
    if (explicitTeacherId && !teacher) {
      warnings.push(warning(
        'unknown-teacher',
        'Неизвестный преподаватель: ' + explicitTeacherId
      ));
      unknownOverride = true;
    }
    if (explicitFormat && (!Array.isArray(source.lessonFormats) ||
      source.lessonFormats.indexOf(format) === -1)) {
      warnings.push(warning(
        'unknown-format',
        'Неизвестный формат: ' + explicitFormat
      ));
      unknownOverride = true;
    }
    if (rawResourceUrl && !resourceUrl) {
      warnings.push(warning('invalid-resource', 'Некорректный URL материала'));
    }

    if (cabinet) {
      if (cabinet.kind === 'permanent') {
        if (routeCabinet.platform !== 'Codex' &&
          routeCabinet.platform !== 'Terminal' &&
          routeCabinet.platform !== 'None') {
          var rawCabinetUrl = text(cabinet.url);
          cabinetUrl = normalizeRouteUrl(rawCabinetUrl, HOSTS[routeCabinet.platform]);
          if (!rawCabinetUrl) {
            warnings.push(warning(
              'missing-cabinet-url',
              'Не задан URL постоянного кабинета'
            ));
          } else if (!cabinetUrl) {
            warnings.push(warning(
              'invalid-cabinet-url',
              'Некорректный URL постоянного кабинета'
            ));
          }
          canOpenCabinet = Boolean(cabinetUrl);
        }
      } else if (routeCabinet.platform !== 'Terminal' &&
        routeCabinet.platform !== 'None') {
        resourceUrl = normalizeRouteUrl(rawResourceUrl, HOSTS[routeCabinet.platform]);
        if (!rawResourceUrl) {
          warnings.push(warning('missing-resource', 'Не задан URL материала'));
        } else if (!resourceUrl && !warnings.some(function (item) {
          return item.code === 'invalid-resource';
        })) {
          warnings.push(warning('invalid-resource', 'Некорректный URL материала'));
        }
        canOpenCabinet = Boolean(resourceUrl);
      }
    }

    if (rawResourceUrl && !resourceUrl) canOpenCabinet = false;
    if (unknownOverride) canOpenCabinet = false;

    var reviewer = REVIEWER_PLATFORMS.indexOf(routeCabinet.platform) !== -1
      ? reviewerFor(defaults, source, warnings)
      : null;

    return Object.freeze({
      cabinetId: routeCabinet.cabinetId,
      cabinetLabel: routeCabinet.cabinetLabel,
      platform: routeCabinet.platform,
      cabinetKind: routeCabinet.cabinetKind,
      cabinetUrl: cabinetUrl,
      teacherId: teacherId,
      teacherLabel: routeTeacherLabel,
      modelHint: teacher && text(teacher.modelHint) || null,
      format: format,
      resourceUrl: resourceUrl,
      usesDefaultCabinet: !explicitCabinetId,
      usesDefaultTeacher: !explicitTeacherId,
      canOpenCabinet: canOpenCabinet,
      warnings: Object.freeze(warnings),
      reviewer: reviewer
    });
  }

  return Object.freeze({
    compactRouteLabels: compactRouteLabels,
    normalizeRouteUrl: normalizeRouteUrl,
    resolveLessonRoute: resolveLessonRoute
  });
});
