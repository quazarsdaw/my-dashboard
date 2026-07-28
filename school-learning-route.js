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
