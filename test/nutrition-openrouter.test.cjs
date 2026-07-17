const assert = require('node:assert/strict');
const test = require('node:test');

const CookingCore = require('../nutrition-cooking-core.js');
let OpenRouter = null;
try {
  OpenRouter = require('../nutrition-openrouter.js');
} catch (_) {
  OpenRouter = null;
}

function response(status, payload) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => payload
  };
}

function validPlan() {
  return {
    batches: [{ id: 'batch-rice', mealId: 'rice', title: 'рис', portions: 2 }],
    actions: [{
      id: 'rice:prep',
      batchId: 'batch-rice',
      title: 'подготовить рис',
      durationMinutes: 10,
      mode: 'active',
      category: 'prep',
      dependsOn: [],
      requires: {
        equipmentTypes: [], cookwareTypes: ['pot'], outletCount: 0, locationPreference: 'kitchen'
      }
    }]
  };
}

function demand(id = 'rice') {
  return {
    version: 1,
    cycleId: 'cycle-test',
    week: 1,
    batches: [{
      id: `batch-${id}`,
      mealId: id,
      title: id,
      portions: 2,
      servingDays: [1, 2],
      strategy: 'batch',
      meal: {
        id,
        title: id,
        notes: 'секретная заметка не должна уйти',
        ingredients: [{ id: 'grain', name: 'крупа', amount: 100, unit: 'г' }],
        instructions: ['промыть', 'сварить'],
        prepMinutes: { min: 20, max: 30 }
      }
    }]
  };
}

function successPayload(plan = validPlan()) {
  return { choices: [{ message: { content: JSON.stringify(plan) } }] };
}

test('sends a strict schema request without leaking the api key or notes', async () => {
  assert.ok(OpenRouter, 'nutrition-openrouter.js должен существовать');
  const calls = [];
  const client = OpenRouter.createOpenRouterCookingClient({
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return response(200, successPayload());
    }
  });

  const result = await client.decompose({
    apiKey: 'private-key',
    model: 'test/model',
    demand: demand(),
    profile: CookingCore.createDefaultKitchenProfile()
  });
  const bodyText = calls[0].options.body;
  const body = JSON.parse(bodyText);

  assert.equal(result.ok, true);
  assert.equal(body.response_format.type, 'json_schema');
  assert.equal(body.response_format.json_schema.strict, true);
  assert.equal(body.provider.require_parameters, true);
  assert.equal(bodyText.includes('private-key'), false);
  assert.equal(bodyText.includes('секретная заметка'), false);
  assert.equal(calls[0].options.headers.Authorization, 'Bearer private-key');
});

test('retries once with json object when strict schema is unsupported', async () => {
  const bodies = [];
  const client = OpenRouter.createOpenRouterCookingClient({
    fetchImpl: async (_url, options) => {
      bodies.push(JSON.parse(options.body));
      if (bodies.length === 1) return response(400, { error: { message: 'response_format json_schema is not supported' } });
      return response(200, successPayload());
    }
  });

  const result = await client.decompose({
    apiKey: 'key', model: 'test/model', demand: demand(),
    profile: CookingCore.createDefaultKitchenProfile()
  });

  assert.equal(result.ok, true);
  assert.equal(result.mode, 'json_object');
  assert.equal(bodies.length, 2);
  assert.equal(bodies[1].response_format.type, 'json_object');
});

test('rejects invalid model output locally without retrying', async () => {
  let calls = 0;
  const client = OpenRouter.createOpenRouterCookingClient({
    fetchImpl: async () => {
      calls++;
      return response(200, successPayload({ batches: [], actions: [] }));
    }
  });

  const result = await client.decompose({
    apiKey: 'key', model: 'test/model', demand: demand(),
    profile: CookingCore.createDefaultKitchenProfile()
  });

  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'invalid-model-output');
  assert.equal(calls, 1);
});

test('returns sanitized errors without api keys or raw provider text', async () => {
  const client = OpenRouter.createOpenRouterCookingClient({
    fetchImpl: async () => { throw new Error('provider exploded with private-key'); }
  });

  const result = await client.decompose({
    apiKey: 'private-key', model: 'test/model', demand: demand(),
    profile: CookingCore.createDefaultKitchenProfile()
  });

  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'network-error');
  assert.equal(result.error.message.includes('private-key'), false);
  assert.equal(result.error.message.includes('exploded'), false);
});

test('deduplicates the active request for the same plan hash', async () => {
  let calls = 0;
  let resolveFetch;
  const pending = new Promise((resolve) => { resolveFetch = resolve; });
  const client = OpenRouter.createOpenRouterCookingClient({
    fetchImpl: async () => {
      calls++;
      await pending;
      return response(200, successPayload());
    }
  });
  const params = {
    apiKey: 'key', model: 'test/model', demand: demand(),
    profile: CookingCore.createDefaultKitchenProfile()
  };

  const first = client.decompose(params);
  const second = client.decompose(params);
  resolveFetch();
  const results = await Promise.all([first, second]);

  assert.equal(calls, 1);
  assert.equal(results[0].ok, true);
  assert.deepEqual(results[0], results[1]);
});

test('aborts a stale request when the plan hash changes', async () => {
  const signals = [];
  const client = OpenRouter.createOpenRouterCookingClient({
    fetchImpl: async (_url, options) => {
      signals.push(options.signal);
      if (signals.length === 1) {
        return new Promise((_resolve, reject) => {
          options.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
        });
      }
      return response(200, successPayload());
    }
  });
  const profile = CookingCore.createDefaultKitchenProfile();

  const stale = client.decompose({ apiKey: 'key', model: 'test/model', demand: demand('rice'), profile });
  const fresh = client.decompose({ apiKey: 'key', model: 'test/model', demand: demand('buckwheat'), profile });
  const staleResult = await stale;
  const freshResult = await fresh;

  assert.equal(signals[0].aborted, true);
  assert.equal(staleResult.error.code, 'aborted');
  assert.equal(freshResult.ok, true);
});
