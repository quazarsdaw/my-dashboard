(function (root) {
  'use strict';

  function freezeRecord(value) {
    Object.keys(value).forEach(function (key) {
      if (value[key] && typeof value[key] === 'object') {
        Object.freeze(value[key]);
      }
    });
    return Object.freeze(value);
  }

  var cabinets = freezeRecord({
    'chatgpt-software': { label: 'ChatGPT · Software Engineering', platform: 'ChatGPT', kind: 'permanent', url: '' },
    'chatgpt-devops': { label: 'ChatGPT · DevOps', platform: 'ChatGPT', kind: 'permanent', url: '' },
    'chatgpt-mathematics': { label: 'ChatGPT · Mathematics', platform: 'ChatGPT', kind: 'permanent', url: '' },
    'chatgpt-english': { label: 'ChatGPT · English & IELTS', platform: 'ChatGPT', kind: 'permanent', url: '' },
    'chatgpt-university': { label: 'ChatGPT · University', platform: 'ChatGPT', kind: 'permanent', url: '' },
    'chatgpt-director': { label: 'ChatGPT · Director', platform: 'ChatGPT', kind: 'permanent', url: '' },
    'codex-main': { label: 'Codex', platform: 'Codex', kind: 'permanent', url: '' },
    'cursor-main': { label: 'Cursor', platform: 'Cursor', kind: 'permanent', url: '' },
    'terminal-local': { label: 'Терминал', platform: 'Terminal', kind: 'permanent', url: '' },
    'kimi-temporary': { label: 'Kimi · временный чат', platform: 'Kimi', kind: 'temporary', url: '' },
    youtube: { label: 'YouTube', platform: 'YouTube', kind: 'temporary', url: '' },
    'book-pdf': { label: 'Книга или PDF', platform: 'Book', kind: 'temporary', url: '' },
    documentation: { label: 'Документация', platform: 'Documentation', kind: 'temporary', url: '' },
    'self-study': { label: 'Самостоятельная практика', platform: 'None', kind: 'temporary', url: '' }
  });

  var teachers = freezeRecord({
    'chatgpt-main': { label: 'ChatGPT · основной преподаватель', platform: 'ChatGPT', modelHint: 'выберите основную модель вручную' },
    'chatgpt-deep': { label: 'ChatGPT · глубокое рассуждение', platform: 'ChatGPT', modelHint: 'выберите сильную reasoning-модель вручную' },
    'chatgpt-fast': { label: 'ChatGPT · быстрый преподаватель', platform: 'ChatGPT', modelHint: 'выберите быструю модель вручную' },
    'codex-main': { label: 'Codex · coding agent', platform: 'Codex', modelHint: 'выберите coding-модель вручную' },
    'kimi-k3': { label: 'Kimi K3', platform: 'Kimi', modelHint: 'выберите Kimi K3 вручную' },
    'material-author': { label: 'Автор материала', platform: 'External', modelHint: '' },
    'self-study': { label: 'Самостоятельная работа', platform: 'None', modelHint: '' }
  });

  var defaultsBySubject = freezeRecord({
    'Software Engineering': {
      cabinetId: 'chatgpt-software',
      teacherId: 'chatgpt-main',
      format: 'Сократовский урок'
    },
    'DevOps & Infrastructure': {
      cabinetId: 'chatgpt-devops',
      teacherId: 'chatgpt-main',
      format: 'Практическая лаборатория'
    },
    Mathematics: {
      cabinetId: 'chatgpt-mathematics',
      teacherId: 'chatgpt-deep',
      format: 'Сократовский урок'
    },
    'English & IELTS': {
      cabinetId: 'chatgpt-english',
      teacherId: 'chatgpt-main',
      format: 'Диалоговый урок'
    },
    University: {
      cabinetId: 'chatgpt-university',
      teacherId: 'chatgpt-main',
      format: 'Разбор материала'
    },
    'Director & Assessment': {
      cabinetId: 'chatgpt-director',
      teacherId: 'chatgpt-deep',
      format: 'Недельная ревизия'
    }
  });

  var globalFallback = Object.freeze({
    cabinetId: 'self-study',
    teacherId: 'self-study',
    format: 'Самостоятельная практика'
  });

  var lessonFormats = Object.freeze([
    'Сократовский урок',
    'Сократовская диагностика',
    'Практическая лаборатория',
    'Диалоговый урок',
    'Разбор материала',
    'Большой контекст',
    'Видео + retrieval',
    'Чтение + retrieval',
    'Самостоятельная практика',
    'Недельная ревизия'
  ]);

  root.SchoolLearningConfig = Object.freeze({
    cabinets: cabinets,
    teachers: teachers,
    defaultsBySubject: defaultsBySubject,
    globalFallback: globalFallback,
    lessonFormats: lessonFormats
  });
})(typeof window !== 'undefined' ? window : globalThis);
