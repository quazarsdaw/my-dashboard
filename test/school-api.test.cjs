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

test('invoke accepts only the two read-only operations', async () => {
  let callCount = 0;
  installSignedInSync(async () => {
    callCount += 1;
    return successEnvelope({});
  });

  await assert.rejects(
    SchoolApi.invoke({ operation: 'startLesson', lessonId: 'lesson-1' }),
    (error) => error.code === 'VALIDATION_ERROR'
  );
  assert.equal(callCount, 0);
});
