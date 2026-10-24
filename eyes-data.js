(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.EyesData = factory();
})(typeof window === 'object' ? window : globalThis, function () {
  'use strict';
  var CATALOG = Object.freeze(
    [
      [
        'horizontal',
        'Влево и вправо',
        'motion',
        8,
        'Следите за точкой из стороны в сторону.',
      ],
      [
        'vertical',
        'Вверх и вниз',
        'motion',
        8,
        'Следите за точкой вверх и вниз.',
      ],
      [
        'diagonal-left',
        'Диагональ слева',
        'motion',
        8,
        'Переводите взгляд по диагонали ↘ и обратно.',
      ],
      [
        'diagonal-right',
        'Диагональ справа',
        'motion',
        8,
        'Переводите взгляд по диагонали ↙ и обратно.',
      ],
      [
        'circle',
        'Круг',
        'motion',
        8,
        'Следите за точкой: сначала по часовой стрелке, затем обратно.',
      ],
      [
        'figure-eight',
        'Восьмёрка',
        'motion',
        8,
        'Плавно следите за точкой по траектории ∞.',
      ],
      [
        'jumps',
        'Прыжки взгляда',
        'motion',
        8,
        'Найдите новую точку и переведите на неё взгляд.',
      ],
      [
        'near-far',
        'Близко и далеко',
        'rest',
        12,
        'Чередуйте взгляд на палец перед собой и удалённый предмет.',
      ],
      [
        'distance',
        'Взгляд вдаль',
        'rest',
        10,
        'Посмотрите на предмет примерно в 6 метрах или дальше.',
      ],
      [
        'blinking',
        'Моргание',
        'rest',
        8,
        'Спокойно закрывайте и открывайте глаза, без усилия.',
      ],
      [
        'rest',
        'Отдых с закрытыми глазами',
        'rest',
        8,
        'Закройте глаза. Можно прикрыть их ладонями, без давления.',
      ],
    ].map(function (a) {
      return Object.freeze({
        id: a[0],
        title: a[1],
        kind: a[2],
        minSeconds: a[3],
        instruction: a[4],
      });
    }),
  );
  var IDS = CATALOG.map(function (x) {
    return x.id;
  });
  function pick(v, options, fallback) {
    return options.indexOf(v) >= 0 ? v : fallback;
  }
  function normalizeSettings(raw, env) {
    var s = raw && typeof raw === 'object' ? raw : {};
    env = env || {};
    var ids = Array.isArray(s.exerciseIds)
      ? IDS.filter(function (id) {
          return s.exerciseIds.indexOf(id) >= 0;
        })
      : ['horizontal', 'vertical', 'blinking'];
    return {
      version: 1,
      mode: pick(s.mode, ['short', 'full', 'custom', 'single'], 'short'),
      durationSeconds: pick(s.durationSeconds, [30, 60, 120, 180], 60),
      exerciseIds: ids,
      speed: pick(
        s.speed,
        ['slow', 'normal', 'fast'],
        env.reducedMotion ? 'slow' : 'normal',
      ),
      dotSize: pick(s.dotSize, ['small', 'medium', 'large'], 'medium'),
      dotColor: pick(s.dotColor, ['amber', 'mint', 'white', 'pink'], 'amber'),
      showPath: s.showPath !== false,
      soundEnabled: s.soundEnabled !== false,
      vibrationEnabled: s.vibrationEnabled === true,
      fullscreenEnabled: s.fullscreenEnabled === true,
      reminderEnabled: s.reminderEnabled === true,
    };
  }
  var UUID =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  function validateRecord(r) {
    if (
      !r ||
      r.version !== 1 ||
      !UUID.test(r.id) ||
      typeof r.epoch !== 'string' ||
      !r.epoch ||
      r.epoch.length > 64 ||
      typeof r.completedAt !== 'string' ||
      !/^\d{4}-\d\d-\d\dT/.test(r.completedAt) ||
      !Number.isFinite(Date.parse(r.completedAt))
    )
      return null;
    var date = new Date(r.completedAt);
    if (date.toISOString().slice(0, 10) !== r.completedAt.slice(0, 10))
      return null;
    if (
      !Array.isArray(r.exerciseIds) ||
      !r.exerciseIds.length ||
      r.exerciseIds.length > 11 ||
      new Set(r.exerciseIds).size !== r.exerciseIds.length ||
      r.exerciseIds.some(function (id) {
        return IDS.indexOf(id) < 0;
      })
    )
      return null;
    if (r.mode === 'reminder') {
      if (
        r.durationSeconds !== 20 ||
        r.exerciseIds.length !== 1 ||
        r.exerciseIds[0] !== 'distance'
      )
        return null;
    } else if (
      ['short', 'full', 'custom', 'single'].indexOf(r.mode) < 0 ||
      [30, 60, 120, 180].indexOf(r.durationSeconds) < 0
    )
      return null;
    return {
      version: 1,
      id: r.id,
      epoch: r.epoch,
      completedAt: date.toISOString(),
      durationSeconds: r.durationSeconds,
      mode: r.mode,
      exerciseIds: r.exerciseIds.slice(),
    };
  }
  function dayKey(iso) {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Yekaterinburg',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date(iso));
  }
  function previousDay(key) {
    return new Date(Date.parse(key + 'T12:00:00Z') - 86400000)
      .toISOString()
      .slice(0, 10);
  }
  function summarize(records, epoch, now) {
    var seen = new Set(),
      days = new Set(),
      seconds = 0,
      count = 0,
      stamp = Date.parse(now);
    (Array.isArray(records) ? records : []).forEach(function (raw) {
      var r = validateRecord(raw);
      if (
        !r ||
        r.epoch !== epoch ||
        seen.has(r.id) ||
        Date.parse(r.completedAt) > stamp
      )
        return;
      seen.add(r.id);
      count++;
      seconds += r.durationSeconds;
      days.add(dayKey(r.completedAt));
    });
    var d = dayKey(now),
      streak = 0;
    if (!days.has(d)) d = previousDay(d);
    while (days.has(d)) {
      streak++;
      d = previousDay(d);
    }
    return {
      streakDays: streak,
      sessions: count,
      seconds: seconds,
      minutes: seconds / 60,
    };
  }
  return {
    CATALOG: CATALOG,
    IDS: IDS,
    UUID: UUID,
    normalizeSettings: normalizeSettings,
    validateRecord: validateRecord,
    summarize: summarize,
    dayKey: dayKey,
  };
});
