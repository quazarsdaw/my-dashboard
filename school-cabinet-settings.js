(function (root, factory) {
  'use strict';
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.SchoolCabinetSettings = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var REMOTE_KEY = 'school_cabinet_urls_v1';
  var CACHE_PREFIX = 'school_cabinet_urls_cache_v1:';
  var CABINET_IDS = Object.freeze([
    'chatgpt-software',
    'chatgpt-devops',
    'chatgpt-mathematics',
    'chatgpt-english',
    'chatgpt-university',
    'chatgpt-director'
  ]);
  var ALLOWED_HOSTS = Object.freeze(['chatgpt.com', 'chat.openai.com']);

  function emptySettings() {
    return { version: 1, cabinets: {} };
  }

  function warning(code, message) {
    return Object.freeze({ code: code, message: message });
  }

  function normalizeUrl(value) {
    var raw = typeof value === 'string' ? value.trim() : '';
    if (!raw) return { valid: true, value: null };
    if (Array.from(raw).length > 2048) {
      return { valid: false, value: null, code: 'URL_TOO_LONG' };
    }

    try {
      var parsed = new URL(raw);
      var hostname = parsed.hostname.toLowerCase();
      if (
        parsed.protocol !== 'https:' ||
        parsed.username ||
        parsed.password ||
        ALLOWED_HOSTS.indexOf(hostname) === -1
      ) {
        return { valid: false, value: null, code: 'INVALID_URL' };
      }
      var canonical = parsed.href;
      if (Array.from(canonical).length > 2048) {
        return { valid: false, value: null, code: 'URL_TOO_LONG' };
      }
      return { valid: true, value: canonical };
    } catch (_error) {
      return { valid: false, value: null, code: 'INVALID_URL' };
    }
  }

  function validateDraft(draft) {
    var source = draft && typeof draft === 'object' && !Array.isArray(draft)
      ? draft
      : {};
    var cabinets = {};
    var errors = {};

    CABINET_IDS.forEach(function (cabinetId) {
      var normalized = normalizeUrl(source[cabinetId]);
      if (!normalized.valid) {
        errors[cabinetId] = Object.freeze({ code: normalized.code });
        return;
      }
      if (normalized.value) cabinets[cabinetId] = normalized.value;
    });

    return {
      valid: Object.keys(errors).length === 0,
      settings: {
        version: 1,
        cabinets: cabinets
      },
      errors: errors
    };
  }

  function parseStoredValue(raw) {
    if (raw === null || raw === undefined || raw === '') {
      return { settings: emptySettings(), warning: null };
    }

    var parsed = raw;
    if (typeof raw === 'string') {
      try {
        parsed = JSON.parse(raw);
      } catch (_error) {
        return {
          settings: emptySettings(),
          warning: warning('DAMAGED_SETTINGS', 'Настройки кабинетов повреждены')
        };
      }
    }

    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return {
        settings: emptySettings(),
        warning: warning('DAMAGED_SETTINGS', 'Настройки кабинетов повреждены')
      };
    }
    if (parsed.version !== 1) {
      return {
        settings: emptySettings(),
        warning: warning(
          'UNSUPPORTED_VERSION',
          'Версия настроек кабинетов не поддерживается'
        )
      };
    }
    if (
      !parsed.cabinets ||
      typeof parsed.cabinets !== 'object' ||
      Array.isArray(parsed.cabinets)
    ) {
      return {
        settings: emptySettings(),
        warning: warning('DAMAGED_SETTINGS', 'Настройки кабинетов повреждены')
      };
    }

    var knownCabinets = {};
    CABINET_IDS.forEach(function (cabinetId) {
      if (Object.prototype.hasOwnProperty.call(parsed.cabinets, cabinetId)) {
        knownCabinets[cabinetId] = parsed.cabinets[cabinetId];
      }
    });
    var result = validateDraft(knownCabinets);
    if (!result.valid) {
      return {
        settings: emptySettings(),
        warning: warning(
          'INVALID_STORED_URL',
          'Сохранённая ссылка кабинета недопустима'
        )
      };
    }
    return { settings: result.settings, warning: null };
  }

  function serialize(settings) {
    var source = settings && settings.cabinets
      ? settings.cabinets
      : settings;
    var result = validateDraft(source);
    if (!result.valid) {
      var error = new Error('cabinet settings are invalid');
      error.code = 'INVALID_SETTINGS';
      throw error;
    }
    return JSON.stringify(result.settings);
  }

  function cacheKeyForUser(userId) {
    var normalizedUserId = typeof userId === 'string' ? userId.trim() : '';
    if (!normalizedUserId) throw new TypeError('user id is required');
    return CACHE_PREFIX + normalizedUserId;
  }

  function applyToConfig(baseConfig, settings) {
    var base = baseConfig && typeof baseConfig === 'object' ? baseConfig : {};
    var cabinets = Object.assign({}, base.cabinets || {});
    var source = settings && settings.cabinets ? settings.cabinets : {};
    var normalized = validateDraft(source);

    if (normalized.valid) {
      CABINET_IDS.forEach(function (cabinetId) {
        var baseCabinet = cabinets[cabinetId];
        var overrideUrl = normalized.settings.cabinets[cabinetId];
        if (!baseCabinet || !overrideUrl) return;
        cabinets[cabinetId] = Object.freeze(
          Object.assign({}, baseCabinet, { url: overrideUrl })
        );
      });
    }

    return Object.freeze(Object.assign({}, base, {
      cabinets: Object.freeze(cabinets)
    }));
  }

  return Object.freeze({
    REMOTE_KEY: REMOTE_KEY,
    CACHE_PREFIX: CACHE_PREFIX,
    CABINET_IDS: CABINET_IDS,
    parseStoredValue: parseStoredValue,
    validateDraft: validateDraft,
    serialize: serialize,
    cacheKeyForUser: cacheKeyForUser,
    applyToConfig: applyToConfig
  });
});
