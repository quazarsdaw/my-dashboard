const assert = require('node:assert/strict');
const test = require('node:test');

const SchoolApi = require('../school-api.js');

function successEnvelope(data) {
  return {
    data: {
      ok: true,
      data,
      requestId: 'request-1'
    },
    error: null
  };
}

function installSignedInSync(invoke) {
  const user = { id: 'owner-id', email: 'owner@example.com' };
  const client = { functions: { invoke } };
  globalThis.SupabaseSync = {
    get client() { return client; },
    get user() { return user; },
    isSignedIn() { return true; },
    getUser() { return user; }
  };
  return { client, user };
}

test.afterEach(() => {
  delete globalThis.SupabaseSync;
});

test('waits for the asynchronously loaded existing SupabaseSync client', async () => {
  const calls = [];
  const pending = SchoolApi.listLessons({ week: 'W01 · 3–9 августа 2026' });

  setTimeout(() => {
    installSignedInSync(async (name, options) => {
      calls.push({ name, options });
      return successEnvelope({ lessons: [{ id: 'lesson-1' }] });
    });
  }, 5);

  const lessons = await pending;

  assert.deepEqual(lessons, [{ id: 'lesson-1' }]);
  assert.equal(calls.length, 1);
});

test('waits for explicit session restoration longer than the former auth grace period', async () => {
  let currentUser = null;
  let edgeCallCount = 0;
  const restoredUser = { id: 'owner-id', email: 'owner@example.com' };
  const client = {
    auth: {
      getSession: async () => {
        await new Promise((resolve) => setTimeout(resolve, 400));
        currentUser = restoredUser;
        return {
          data: {
            session: {
              access_token: 'managed-inside-the-shared-client',
              token_type: 'bearer',
              user: restoredUser
            }
          },
          error: null
        };
      }
    },
    functions: {
      invoke: async () => {
        edgeCallCount += 1;
        return successEnvelope({ lessons: [{ id: 'restored-lesson' }] });
      }
    }
  };
  globalThis.SupabaseSync = {
    get client() { return client; },
    get user() { return currentUser; },
    isSignedIn() { return Boolean(currentUser); },
    getUser() { return currentUser; }
  };

  assert.deepEqual(
    await SchoolApi.listLessons({ week: 'W01 · 3–9 августа 2026' }),
    [{ id: 'restored-lesson' }]
  );
  assert.equal(edgeCallCount, 1);
});

test('does not call the edge function when the existing session has no user', async () => {
  let callCount = 0;
  let getSessionCount = 0;
  const client = {
    auth: {
      getSession: async () => {
        getSessionCount += 1;
        return {
          data: { session: null },
          error: null
        };
      }
    },
    functions: {
      invoke: async () => {
        callCount += 1;
        return successEnvelope({ lessons: [] });
      }
    }
  };
  globalThis.SupabaseSync = {
    get client() { return client; },
    get user() { return null; },
    isSignedIn() { return false; },
    getUser() { return null; }
  };

  await assert.rejects(
    SchoolApi.listLessons({ week: 'W01 · 3–9 августа 2026' }),
    (error) => error.name === 'SchoolClientError' && error.status === 401 && error.code === 'UNAUTHORIZED'
  );
  assert.equal(getSessionCount, 1);
  assert.equal(callCount, 0);
});

test('uses the current shared client and returns lessons from the success envelope', async () => {
  const calls = [];
  const shared = installSignedInSync(async (name, options) => {
    calls.push({ name, options });
    return successEnvelope({
      lessons: [{ id: 'lesson-1', title: 'Cold start «Прометея»' }],
      total: 1
    });
  });

  assert.deepEqual(await SchoolApi.waitForAuth(), shared);
  assert.deepEqual(
    await SchoolApi.listLessons({ week: 'W01 · 3–9 августа 2026' }),
    [{ id: 'lesson-1', title: 'Cold start «Прометея»' }]
  );
  assert.deepEqual(calls, [{
    name: 'school-notion',
    options: {
      body: {
        operation: 'listLessons',
        week: 'W01 · 3–9 августа 2026'
      }
    }
  }]);
});

test('drops secrets and non-whitelisted fields from read command bodies', async () => {
  const bodies = [];
  installSignedInSync(async (_name, options) => {
    bodies.push(options.body);
    return successEnvelope({ lessons: [] });
  });

  await SchoolApi.listLessons({
    week: 'W01 · 3–9 августа 2026',
    NOTION_TOKEN: 'must-not-leak',
    notionDataSourceId: 'server-only-id',
    SCHOOL_OWNER_USER_ID: 'owner-id',
    extra: 'ignored'
  });

  assert.deepEqual(bodies, [{
    operation: 'listLessons',
    week: 'W01 · 3–9 августа 2026'
  }]);
  assert.equal(JSON.stringify(bodies).includes('must-not-leak'), false);
  assert.equal(JSON.stringify(bodies).includes('server-only-id'), false);
});

test('sends only from and to for a date-range lesson query', async () => {
  const bodies = [];
  installSignedInSync(async (_name, options) => {
    bodies.push(options.body);
    return successEnvelope({ lessons: [] });
  });

  await SchoolApi.listLessons({
    from: '2026-08-03',
    to: '2026-08-09',
    pageSize: 500
  });

  assert.deepEqual(bodies, [{
    operation: 'listLessons',
    from: '2026-08-03',
    to: '2026-08-09'
  }]);
});

test('sends only the lesson id when loading lesson content', async () => {
  const bodies = [];
  installSignedInSync(async (_name, options) => {
    bodies.push(options.body);
    return successEnvelope({
      lesson: { id: 'lesson-1' },
      blocks: [{ type: 'paragraph', spans: [] }]
    });
  });

  const content = await SchoolApi.getLessonContent('lesson-1', {
    NOTION_TOKEN: 'must-not-leak'
  });

  assert.deepEqual(content, {
    lesson: { id: 'lesson-1' },
    blocks: [{ type: 'paragraph', spans: [] }]
  });
  assert.deepEqual(bodies, [{
    operation: 'getLessonContent',
    lessonId: 'lesson-1'
  }]);
});

for (const scenario of [
  { status: 401, bodyCode: 'UNAUTHORIZED', expectedCode: 'UNAUTHORIZED' },
  { status: 403, bodyCode: 'FORBIDDEN', expectedCode: 'FORBIDDEN' },
  { status: 409, bodyCode: 'ACTIVE_LESSON_EXISTS', expectedCode: 'ACTIVE_LESSON_EXISTS' },
  { status: 503, bodyCode: 'UPSTREAM_UNAVAILABLE', expectedCode: 'UPSTREAM_UNAVAILABLE' }
]) {
  test(`normalizes ${scenario.status} edge errors without exposing the transport error`, async () => {
    const response = new Response(JSON.stringify({
      ok: false,
      error: scenario.bodyCode,
      message: 'безопасное сообщение',
      requestId: `request-${scenario.status}`,
      details: { retryAfterSeconds: 2 }
    }), {
      status: scenario.status,
      headers: { 'content-type': 'application/json' }
    });
    const transportError = new Error(`authorization bearer secret-${scenario.status}`);
    transportError.context = response;
    installSignedInSync(async () => ({ data: null, error: transportError }));

    await assert.rejects(
      SchoolApi.listLessons({ week: 'W01 · 3–9 августа 2026' }),
      (error) => {
        assert.equal(error.name, 'SchoolClientError');
        assert.equal(error.status, scenario.status);
        assert.equal(error.code, scenario.expectedCode);
        assert.equal(error.message, 'безопасное сообщение');
        assert.equal(error.requestId, `request-${scenario.status}`);
        assert.deepEqual(error.details, { retryAfterSeconds: 2 });
        assert.equal(JSON.stringify(error).includes(`secret-${scenario.status}`), false);
        return true;
      }
    );
  });
}

for (const context of [
  new Error('authorization bearer secret-from-error-context'),
  {
    status: 403,
    error: 'FORBIDDEN',
    message: 'authorization bearer secret-from-object-context',
    details: { token: 'secret-detail' }
  }
]) {
  test(`ignores untrusted ${context instanceof Error ? 'error' : 'plain object'} transport context`, async () => {
    const transportError = new Error('transport failed');
    transportError.context = context;
    installSignedInSync(async () => ({ data: null, error: transportError }));

    await assert.rejects(
      SchoolApi.listLessons({ week: 'W01 · 3–9 августа 2026' }),
      (error) => {
        assert.equal(error.name, 'SchoolClientError');
        assert.equal(error.status, 503);
        assert.equal(error.code, 'UPSTREAM_UNAVAILABLE');
        assert.equal(error.message, 'сервис школы временно недоступен');
        assert.equal(error.details, undefined);
        const serialized = JSON.stringify(error);
        assert.equal(serialized.includes('bearer'), false);
        assert.equal(serialized.includes('secret-detail'), false);
        return true;
      }
    );
  });
}

test('rejects mixed or incomplete list filters before calling the edge function', async () => {
  let callCount = 0;
  installSignedInSync(async () => {
    callCount += 1;
    return successEnvelope({ lessons: [] });
  });

  await assert.rejects(
    SchoolApi.listLessons({
      week: 'W01 · 3–9 августа 2026',
      from: '2026-08-03',
      to: '2026-08-09'
    }),
    (error) => error.code === 'VALIDATION_ERROR'
  );
  await assert.rejects(
    SchoolApi.listLessons({ from: '2026-08-03' }),
    (error) => error.code === 'VALIDATION_ERROR'
  );
  assert.equal(callCount, 0);
});

for (const scenario of [
  {
    name: 'missing data',
    envelope: { ok: true, requestId: 'request-1' }
  },
  {
    name: 'undefined data',
    envelope: { ok: true, data: undefined, requestId: 'request-1' }
  },
  {
    name: 'null data',
    envelope: { ok: true, data: null, requestId: 'request-1' }
  },
  {
    name: 'array data',
    envelope: { ok: true, data: [], requestId: 'request-1' }
  },
  {
    name: 'scalar data',
    envelope: { ok: true, data: 'lessons', requestId: 'request-1' }
  },
  {
    name: 'missing request id',
    envelope: { ok: true, data: {} }
  },
  {
    name: 'empty request id',
    envelope: { ok: true, data: {}, requestId: '' }
  },
  {
    name: 'non-string request id',
    envelope: { ok: true, data: {}, requestId: 42 }
  }
]) {
  test(`invoke rejects a success envelope with ${scenario.name}`, async () => {
    installSignedInSync(async () => ({
      data: scenario.envelope,
      error: null
    }));

    await assert.rejects(
      SchoolApi.invoke({
        operation: 'listLessons',
        week: 'W01 · 3–9 августа 2026'
      }),
      (error) => error.code === 'INVALID_RESPONSE' && error.status === 502
    );
  });
}

test('mutation transport sends only the whitelisted domain command fields', async () => {
  const bodies = [];
  installSignedInSync(async (_name, options) => {
    bodies.push(options.body);
    return successEnvelope({ id: 'lesson-1', status: 'В процессе' });
  });

  const result = await SchoolApi.mutate({
    operation: 'startLesson',
    lessonId: 'lesson-1',
    NOTION_TOKEN: 'must-not-leak',
    properties: { Статус: { select: { name: 'В процессе' } } },
    status: 'В процессе'
  });

  assert.deepEqual(result, { id: 'lesson-1', status: 'В процессе' });
  assert.deepEqual(bodies, [{
    operation: 'startLesson',
    lessonId: 'lesson-1'
  }]);
  assert.equal(JSON.stringify(bodies).includes('must-not-leak'), false);
});

test('mutation transport normalizes nested move and assessment commands', async () => {
  const bodies = [];
  installSignedInSync(async (_name, options) => {
    bodies.push(options.body);
    return successEnvelope({ id: 'lesson-1' });
  });

  await SchoolApi.mutate({
    operation: 'moveLesson',
    lessonId: 'lesson-1',
    destination: {
      kind: 'timed',
      start: '2026-08-03T14:15:00+05:00',
      end: 'must-be-derived-on-server'
    },
    order: 150,
    allowOverlap: true,
    rawNotionPayload: { token: 'secret' }
  });
  await SchoolApi.mutate({
    operation: 'completeLesson',
    lessonId: 'lesson-1',
    status: 'Выполнен',
    result: 'Незачёт',
    autonomy: 'A2',
    understanding: 2,
    comment: 'итог',
    artifactUrl: 'https://example.com/result',
    extra: 'ignored'
  });

  assert.deepEqual(bodies, [
    {
      operation: 'moveLesson',
      lessonId: 'lesson-1',
      destination: {
        kind: 'timed',
        start: '2026-08-03T14:15:00+05:00'
      },
      order: 150,
      allowOverlap: true
    },
    {
      operation: 'completeLesson',
      lessonId: 'lesson-1',
      status: 'Выполнен',
      result: 'Незачёт',
      autonomy: 'A2',
      understanding: 2,
      comment: 'итог',
      artifactUrl: 'https://example.com/result'
    }
  ]);
});

test('safe conflict summaries are exposed to dialogs without transport secrets', async () => {
  const response = new Response(JSON.stringify({
    ok: false,
    error: 'LESSON_TIME_CONFLICT',
    message: 'lesson time overlaps another lesson',
    requestId: 'request-conflict',
    conflicts: [{
      id: 'english',
      title: 'English baseline',
      subject: 'English & IELTS',
      start: '2026-08-03T14:30:00+05:00',
      end: '2026-08-03T15:15:00+05:00'
    }]
  }), {
    status: 409,
    headers: { 'content-type': 'application/json' }
  });
  const transportError = new Error('authorization bearer secret');
  transportError.context = response;
  installSignedInSync(async () => ({ data: null, error: transportError }));

  await assert.rejects(
    SchoolApi.mutate({
      operation: 'moveLesson',
      lessonId: 'lesson-1',
      destination: {
        kind: 'timed',
        start: '2026-08-03T14:00:00+05:00'
      },
      order: 100
    }),
    (error) => {
      assert.equal(error.code, 'LESSON_TIME_CONFLICT');
      assert.deepEqual(error.details.conflicts, [{
        id: 'english',
        title: 'English baseline',
        subject: 'English & IELTS',
        start: '2026-08-03T14:30:00+05:00',
        end: '2026-08-03T15:15:00+05:00'
      }]);
      assert.equal(JSON.stringify(error).includes('bearer'), false);
      return true;
    }
  );
});

test('active lesson conflict exposes only the safe lesson summary needed by the switch dialog', async () => {
  const response = new Response(JSON.stringify({
    ok: false,
    error: 'ACTIVE_LESSON_EXISTS',
    message: 'another lesson is active',
    requestId: 'request-active',
    activeLesson: {
      id: 'active-lesson',
      title: 'Current lesson',
      subject: 'Mathematics',
      notionToken: 'must-not-pass'
    }
  }), {
    status: 409,
    headers: { 'content-type': 'application/json' }
  });
  const transportError = new Error('authorization bearer secret');
  transportError.context = response;
  installSignedInSync(async () => ({ data: null, error: transportError }));

  await assert.rejects(
    SchoolApi.mutate({
      operation: 'startLesson',
      lessonId: 'next-lesson'
    }),
    (error) => {
      assert.equal(error.code, 'ACTIVE_LESSON_EXISTS');
      assert.deepEqual(error.details.activeLesson, {
        id: 'active-lesson',
        title: 'Current lesson',
        subject: 'Mathematics'
      });
      assert.equal(JSON.stringify(error).includes('must-not-pass'), false);
      assert.equal(JSON.stringify(error).includes('bearer'), false);
      return true;
    }
  );
});

test('invoke rejects unsupported operations before calling the edge function', async () => {
  let callCount = 0;
  installSignedInSync(async () => {
    callCount += 1;
    return successEnvelope({});
  });

  await assert.rejects(
    SchoolApi.invoke({ operation: 'deleteNotionPage', lessonId: 'lesson-1' }),
    (error) => error.code === 'VALIDATION_ERROR'
  );
  assert.equal(callCount, 0);
});
