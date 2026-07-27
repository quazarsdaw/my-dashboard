(function (root, factory) {
  'use strict';

  var api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.SchoolApi = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (root) {
  'use strict';

  var FUNCTION_NAME = 'school-notion';
  var SDK_WAIT_TIMEOUT_MS = 5000;
  var POLL_INTERVAL_MS = 10;

  function isRecord(value) {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
  }

  function delay(milliseconds) {
    return new Promise(function (resolve) {
      setTimeout(resolve, milliseconds);
    });
  }

  function SchoolClientError(input) {
    input = isRecord(input) ? input : {};
    Error.call(this, input.message || 'не удалось выполнить запрос школы');
    this.name = 'SchoolClientError';
    this.message = input.message || 'не удалось выполнить запрос школы';
    this.code = input.code || 'UPSTREAM_UNAVAILABLE';
    this.status = Number.isInteger(input.status) ? input.status : 503;
    this.requestId = typeof input.requestId === 'string' ? input.requestId : null;
    this.details = isRecord(input.details) ? input.details : undefined;
    if (Error.captureStackTrace) Error.captureStackTrace(this, SchoolClientError);
  }

  SchoolClientError.prototype = Object.create(Error.prototype);
  SchoolClientError.prototype.constructor = SchoolClientError;
  SchoolClientError.prototype.toJSON = function () {
    var serialized = {
      name: this.name,
      code: this.code,
      status: this.status,
      message: this.message,
      requestId: this.requestId
    };
    if (this.details) serialized.details = this.details;
    return serialized;
  };

  function clientError(code, status, message) {
    return new SchoolClientError({
      code: code,
      status: status,
      message: message
    });
  }

  function readSyncState() {
    var sync = root && root.SupabaseSync;
    if (!sync) return null;

    var client = sync.client || null;
    var user = typeof sync.getUser === 'function' ? sync.getUser() : (sync.user || null);
    var signedIn = typeof sync.isSignedIn === 'function' ? sync.isSignedIn() : Boolean(user);

    return {
      client: client,
      signedIn: signedIn,
      user: user
    };
  }

  function waitForSession(client, timeoutMs) {
    return new Promise(function (resolve, reject) {
      var settled = false;
      var timer = setTimeout(function () {
        if (settled) return;
        settled = true;
        reject(clientError(
          'AUTH_UNAVAILABLE',
          503,
          'проверка авторизации не успела завершиться'
        ));
      }, Math.max(0, timeoutMs));

      Promise.resolve().then(function () {
        return client.auth.getSession();
      }).then(function (result) {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(result);
      }, function () {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(clientError(
          'AUTH_UNAVAILABLE',
          503,
          'не удалось проверить авторизацию'
        ));
      });
    });
  }

  async function waitForAuth() {
    var startedAt = Date.now();
    var clientSeen = false;

    while (Date.now() - startedAt <= SDK_WAIT_TIMEOUT_MS) {
      var state = readSyncState();

      if (state && state.client) {
        clientSeen = true;
        if (
          !state.client.functions ||
          typeof state.client.functions.invoke !== 'function'
        ) {
          throw clientError(
            'AUTH_UNAVAILABLE',
            503,
            'клиент авторизации временно недоступен'
          );
        }

        if (state.signedIn && state.user) {
          return {
            client: state.client,
            user: state.user
          };
        }

        if (
          state.client.auth &&
          typeof state.client.auth.getSession === 'function'
        ) {
          var remainingMs = SDK_WAIT_TIMEOUT_MS - (Date.now() - startedAt);
          var sessionResult = await waitForSession(state.client, remainingMs);
          if (!isRecord(sessionResult) || sessionResult.error) {
            throw clientError(
              'AUTH_UNAVAILABLE',
              503,
              'не удалось проверить авторизацию'
            );
          }

          var session = isRecord(sessionResult.data)
            ? sessionResult.data.session
            : undefined;
          if (isRecord(session) && isRecord(session.user)) {
            return {
              client: state.client,
              user: session.user
            };
          }
          if (session === null) {
            throw clientError(
              'UNAUTHORIZED',
              401,
              'для доступа к школе необходимо войти'
            );
          }

          throw clientError(
            'AUTH_UNAVAILABLE',
            503,
            'клиент авторизации вернул некорректную сессию'
          );
        }

        state = readSyncState();
        if (state && state.client && state.signedIn && state.user) {
          return {
            client: state.client,
            user: state.user
          };
        }
      }

      await delay(POLL_INTERVAL_MS);
    }

    if (clientSeen) {
      throw clientError(
        'AUTH_UNAVAILABLE',
        503,
        'не удалось определить состояние авторизации'
      );
    }

    throw clientError(
      'AUTH_UNAVAILABLE',
      503,
      'клиент авторизации не успел загрузиться'
    );
  }

  function isIsoDate(value) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    var parsed = new Date(value + 'T00:00:00.000Z');
    return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
  }

  function validationError() {
    return clientError(
      'VALIDATION_ERROR',
      400,
      'параметры запроса школы некорректны'
    );
  }

  function normalizeListCommand(input) {
    if (!isRecord(input)) throw validationError();

    var hasWeek = typeof input.week === 'string';
    var hasFrom = typeof input.from === 'string';
    var hasTo = typeof input.to === 'string';

    if (
      hasWeek &&
      !hasFrom &&
      !hasTo &&
      input.week.length > 0 &&
      input.week.trim() === input.week
    ) {
      return {
        operation: 'listLessons',
        week: input.week
      };
    }

    if (
      !hasWeek &&
      hasFrom &&
      hasTo &&
      isIsoDate(input.from) &&
      isIsoDate(input.to) &&
      input.from <= input.to
    ) {
      return {
        operation: 'listLessons',
        from: input.from,
        to: input.to
      };
    }

    throw validationError();
  }

  function normalizeContentCommand(input) {
    if (
      !isRecord(input) ||
      typeof input.lessonId !== 'string' ||
      input.lessonId.length === 0 ||
      input.lessonId.trim() !== input.lessonId
    ) {
      throw validationError();
    }

    return {
      operation: 'getLessonContent',
      lessonId: input.lessonId
    };
  }

  function normalizeReadCommand(command) {
    if (!isRecord(command)) throw validationError();
    if (command.operation === 'listLessons') return normalizeListCommand(command);
    if (command.operation === 'getLessonContent') return normalizeContentCommand(command);
    throw validationError();
  }

  function normalizeLessonId(value) {
    if (
      typeof value !== 'string' ||
      value.length === 0 ||
      value.trim() !== value
    ) {
      throw validationError();
    }
    return value;
  }

  function normalizeDestination(value, allowUnscheduled) {
    if (!isRecord(value) || typeof value.kind !== 'string') throw validationError();
    if (value.kind === 'date-only' && isIsoDate(value.date)) {
      return { kind: 'date-only', date: value.date };
    }
    if (
      value.kind === 'timed' &&
      typeof value.start === 'string' &&
      Number.isFinite(Date.parse(value.start))
    ) {
      return { kind: 'timed', start: value.start };
    }
    if (allowUnscheduled && value.kind === 'unscheduled') {
      return { kind: 'unscheduled' };
    }
    throw validationError();
  }

  function optionalBoolean(command, name, normalized) {
    if (!Object.prototype.hasOwnProperty.call(command, name)) return;
    if (typeof command[name] !== 'boolean') throw validationError();
    normalized[name] = command[name];
  }

  function optionalString(command, name, normalized, allowNull) {
    if (!Object.prototype.hasOwnProperty.call(command, name)) return;
    if (allowNull && command[name] === null) {
      normalized[name] = null;
      return;
    }
    if (typeof command[name] !== 'string') throw validationError();
    normalized[name] = command[name];
  }

  function normalizeMutationCommand(command) {
    if (!isRecord(command) || typeof command.operation !== 'string') throw validationError();
    var operation = command.operation;
    if (operation === 'switchActiveLesson') {
      return {
        operation: operation,
        previousLessonId: normalizeLessonId(command.previousLessonId),
        newLessonId: normalizeLessonId(command.newLessonId)
      };
    }
    if (operation === 'resolveActiveLessons') {
      return {
        operation: operation,
        keepLessonId: normalizeLessonId(command.keepLessonId)
      };
    }

    var lessonId = normalizeLessonId(command.lessonId);
    var simple = [
      'startLesson',
      'reopenLesson',
      'restoreCancelledLesson',
      'correctMissedStatus',
      'requestCrossWeekMove',
      'clearDecisionRequest'
    ];
    if (simple.indexOf(operation) !== -1) {
      return { operation: operation, lessonId: lessonId };
    }

    if (
      operation === 'moveLesson' ||
      operation === 'pauseAndMoveLesson' ||
      operation === 'restoreMissedLesson'
    ) {
      if (!Number.isFinite(command.order)) throw validationError();
      var moved = {
        operation: operation,
        lessonId: lessonId,
        destination: normalizeDestination(
          command.destination,
          operation === 'pauseAndMoveLesson'
        ),
        order: command.order
      };
      optionalBoolean(command, 'allowOverlap', moved);
      return moved;
    }

    if (operation === 'unscheduleLesson' || operation === 'reorderLesson') {
      if (!Number.isFinite(command.order)) throw validationError();
      return {
        operation: operation,
        lessonId: lessonId,
        order: command.order
      };
    }

    if (operation === 'changeLessonDuration') {
      if (
        !Number.isInteger(command.durationMinutes) ||
        command.durationMinutes < 15 ||
        command.durationMinutes > 180
      ) {
        throw validationError();
      }
      var duration = {
        operation: operation,
        lessonId: lessonId,
        durationMinutes: command.durationMinutes
      };
      optionalBoolean(command, 'allowOverlap', duration);
      return duration;
    }

    if (operation === 'completeLesson') {
      if (typeof command.status !== 'string') throw validationError();
      var assessment = {
        operation: operation,
        lessonId: lessonId,
        status: command.status
      };
      optionalString(command, 'result', assessment, false);
      optionalString(command, 'autonomy', assessment, false);
      optionalString(command, 'missedReason', assessment, false);
      optionalString(command, 'comment', assessment, false);
      optionalString(command, 'artifactUrl', assessment, true);
      if (Object.prototype.hasOwnProperty.call(command, 'understanding')) {
        if (!Number.isInteger(command.understanding)) throw validationError();
        assessment.understanding = command.understanding;
      }
      return assessment;
    }

    if (operation === 'cancelLesson') {
      var cancellation = { operation: operation, lessonId: lessonId };
      optionalBoolean(command, 'confirmLearningEvidence', cancellation);
      return cancellation;
    }
    if (operation === 'clearLearningEvidence') {
      if (command.confirm !== true) throw validationError();
      return {
        operation: operation,
        lessonId: lessonId,
        confirm: true
      };
    }

    throw validationError();
  }

  function normalizeCommand(command) {
    if (!isRecord(command)) throw validationError();
    if (command.operation === 'listLessons' || command.operation === 'getLessonContent') {
      return normalizeReadCommand(command);
    }
    return normalizeMutationCommand(command);
  }

  function safeText(value, maximum) {
    return typeof value === 'string' &&
      value.length > 0 &&
      Array.from(value).length <= maximum;
  }

  function safeLessonSummary(value, timed) {
    if (
      !isRecord(value) ||
      !safeText(value.id, 128) ||
      !safeText(value.title, 500) ||
      !safeText(value.subject, 100)
    ) {
      return null;
    }
    var summary = {
      id: value.id,
      title: value.title,
      subject: value.subject
    };
    if (timed) {
      if (
        !safeText(value.start, 64) ||
        !safeText(value.end, 64) ||
        !Number.isFinite(Date.parse(value.start)) ||
        !Number.isFinite(Date.parse(value.end))
      ) {
        return null;
      }
      summary.start = value.start;
      summary.end = value.end;
    }
    return summary;
  }

  function safeScalarDetails(value) {
    if (!isRecord(value)) return undefined;
    var result = {};
    Object.keys(value).slice(0, 20).forEach(function (key) {
      var item = value[key];
      if (
        typeof item === 'boolean' ||
        Number.isFinite(item) ||
        (typeof item === 'string' && Array.from(item).length <= 500)
      ) {
        result[key] = item;
      }
    });
    return Object.keys(result).length ? result : undefined;
  }

  function safeFailureDetails(value) {
    var details = safeScalarDetails(value.details) || {};
    if (value.activeLesson !== undefined) {
      var activeLesson = safeLessonSummary(value.activeLesson, false);
      if (!activeLesson) return null;
      details.activeLesson = activeLesson;
    }
    if (value.activeLessons !== undefined) {
      if (!Array.isArray(value.activeLessons) || value.activeLessons.length > 100) return null;
      var activeLessons = value.activeLessons.map(function (item) {
        return safeLessonSummary(item, false);
      });
      if (activeLessons.some(function (item) { return !item; })) return null;
      details.activeLessons = activeLessons;
    }
    if (value.conflicts !== undefined) {
      if (!Array.isArray(value.conflicts) || value.conflicts.length > 100) return null;
      var conflicts = value.conflicts.map(function (item) {
        return safeLessonSummary(item, true);
      });
      if (conflicts.some(function (item) { return !item; })) return null;
      details.conflicts = conflicts;
    }
    if (typeof value.status === 'string' && Array.from(value.status).length <= 100) {
      details.status = value.status;
    }
    return Object.keys(details).length ? details : undefined;
  }

  function isSafeFailureEnvelope(value) {
    if (
      !isRecord(value) ||
      value.ok !== false ||
      typeof value.error !== 'string' ||
      !/^[A-Z][A-Z0-9_]{0,63}$/.test(value.error) ||
      typeof value.message !== 'string' ||
      value.message.length === 0 ||
      Array.from(value.message).length > 500 ||
      typeof value.requestId !== 'string' ||
      value.requestId.length === 0 ||
      value.requestId.length > 128 ||
      value.requestId.trim() !== value.requestId ||
      (value.details !== undefined && !isRecord(value.details)) ||
      (value.status !== undefined &&
        !Number.isInteger(value.status) &&
        typeof value.status !== 'string') ||
      safeFailureDetails(value) === null
    ) {
      return false;
    }

    return Object.keys(value).every(function (key) {
      return [
        'ok',
        'error',
        'message',
        'requestId',
        'details',
        'status',
        'activeLesson',
        'activeLessons',
        'conflicts'
      ].indexOf(key) !== -1;
    });
  }

  function isSafeSuccessEnvelope(value) {
    if (
      !isRecord(value) ||
      value.ok !== true ||
      !isRecord(value.data) ||
      typeof value.requestId !== 'string' ||
      value.requestId.length === 0 ||
      value.requestId.length > 128 ||
      value.requestId.trim() !== value.requestId
    ) {
      return false;
    }

    var keys = Object.keys(value).sort();
    return keys.length === 3 &&
      keys[0] === 'data' &&
      keys[1] === 'ok' &&
      keys[2] === 'requestId';
  }

  function isResponse(value) {
    return typeof Response !== 'undefined' && value instanceof Response;
  }

  async function readResponseBody(response, allowPlainEnvelope) {
    if (!response) return null;
    if (isResponse(response)) {
      try {
        var parsed = await response.clone().json();
        return isSafeFailureEnvelope(parsed) ? parsed : null;
      } catch (_error) {
        return null;
      }
    }
    return allowPlainEnvelope && isSafeFailureEnvelope(response) ? response : null;
  }

  function fallbackCode(status) {
    if (status === 401) return 'UNAUTHORIZED';
    if (status === 403) return 'FORBIDDEN';
    if (status === 409) return 'CONFLICT';
    if (status === 503) return 'UPSTREAM_UNAVAILABLE';
    if (status === 400) return 'VALIDATION_ERROR';
    if (status === 404) return 'LESSON_NOT_FOUND';
    return status >= 500 ? 'UPSTREAM_UNAVAILABLE' : 'REQUEST_FAILED';
  }

  function fallbackMessage(status) {
    if (status === 401) return 'для доступа к школе необходимо войти';
    if (status === 403) return 'доступ к школе запрещён';
    if (status === 409) return 'состояние школы изменилось';
    if (status === 503) return 'сервис школы временно недоступен';
    return 'не удалось выполнить запрос школы';
  }

  function statusFromCode(code) {
    if (code === 'UNAUTHORIZED') return 401;
    if (code === 'FORBIDDEN' || code === 'ORIGIN_NOT_ALLOWED') return 403;
    if (code === 'VALIDATION_ERROR' || code === 'INVALID_COMMAND' || code === 'INVALID_JSON') return 400;
    if (code === 'LESSON_NOT_FOUND' || code === 'LESSON_OUTSIDE_SCHOOL_DATABASE') return 404;
    if (
      typeof code === 'string' &&
      (
        code === 'CONFLICT' ||
        code.indexOf('ACTIVE_LESSON_') === 0 ||
        code.indexOf('SCHOOL_') === 0 ||
        code === 'LESSON_STATUS_TRANSITION_REQUIRED' ||
        code === 'LESSON_TIME_CONFLICT' ||
        code === 'CROSS_WEEK_MOVE_REQUIRES_REVIEW'
      )
    ) {
      return 409;
    }
    return 503;
  }

  async function toSchoolError(functionError, response) {
    var source = response || (functionError && functionError.context) || null;
    var trustedResponse = isResponse(source);
    var body = await readResponseBody(source, !functionError);
    var status = trustedResponse && Number.isInteger(source.status)
      ? source.status
      : (body ? statusFromCode(body.error) : 503);

    if (body && Number.isInteger(body.status)) status = body.status;

    return new SchoolClientError({
      code: body && typeof body.error === 'string' ? body.error : fallbackCode(status),
      status: status,
      message: body && typeof body.message === 'string' ? body.message : fallbackMessage(status),
      requestId: body && typeof body.requestId === 'string' ? body.requestId : null,
      details: body ? safeFailureDetails(body) : undefined
    });
  }

  async function invoke(command) {
    var normalized = normalizeCommand(command);
    var auth = await waitForAuth();
    var result;

    try {
      result = await auth.client.functions.invoke(FUNCTION_NAME, {
        body: normalized
      });
    } catch (error) {
      if (error instanceof SchoolClientError) throw error;
      throw await toSchoolError(error, error && error.context);
    }

    if (!isRecord(result)) {
      throw clientError(
        'INVALID_RESPONSE',
        502,
        'сервис школы вернул некорректный ответ'
      );
    }

    if (result.error) {
      if (isSafeFailureEnvelope(result.data)) {
        throw await toSchoolError(null, result.data);
      }
      throw await toSchoolError(
        result.error,
        result.error.context
      );
    }

    if (!isSafeSuccessEnvelope(result.data)) {
      if (isRecord(result.data) && result.data.ok === false) {
        throw await toSchoolError(null, result.data);
      }
      throw clientError(
        'INVALID_RESPONSE',
        502,
        'сервис школы вернул некорректный ответ'
      );
    }

    return result.data;
  }

  async function listLessons(filter) {
    var command = normalizeListCommand(filter);
    var success = await invoke(command);

    if (!isRecord(success.data) || !Array.isArray(success.data.lessons)) {
      throw clientError(
        'INVALID_RESPONSE',
        502,
        'сервис школы вернул некорректный список уроков'
      );
    }

    return success.data.lessons;
  }

  async function getLessonContent(lessonId) {
    var success = await invoke({
      operation: 'getLessonContent',
      lessonId: lessonId
    });

    if (!isRecord(success.data) || !Array.isArray(success.data.blocks) || !isRecord(success.data.lesson)) {
      throw clientError(
        'INVALID_RESPONSE',
        502,
        'сервис школы вернул некорректное содержимое урока'
      );
    }

    return success.data;
  }

  async function mutate(command) {
    var success = await invoke(normalizeMutationCommand(command));
    if (!isRecord(success.data)) {
      throw clientError(
        'INVALID_RESPONSE',
        502,
        'сервис школы вернул некорректный результат изменения'
      );
    }
    return success.data;
  }

  return Object.freeze({
    SchoolClientError: SchoolClientError,
    waitForAuth: waitForAuth,
    listLessons: listLessons,
    getLessonContent: getLessonContent,
    mutate: mutate,
    invoke: invoke,
    toSchoolError: toSchoolError
  });
});
