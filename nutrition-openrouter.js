(function (root, factory) {
  'use strict';

  var core = typeof module === 'object' && module.exports
    ? require('./nutrition-cooking-core.js')
    : root && root.NutritionCookingCore;
  var api = factory(core);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.NutritionOpenRouter = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (CookingCore) {
  'use strict';

  var ENDPOINT = 'https://openrouter.ai/api/v1/chat/completions';

  function cookingPlanSchema() {
    return {
      type: 'object',
      additionalProperties: false,
      required: ['batches', 'actions'],
      properties: {
        batches: {
          type: 'array',
          minItems: 1,
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['id', 'mealId', 'title', 'portions'],
            properties: {
              id: { type: 'string', minLength: 1 },
              mealId: { type: 'string', minLength: 1 },
              title: { type: 'string', minLength: 1 },
              portions: { type: 'integer', minimum: 1, maximum: 100 }
            }
          }
        },
        actions: {
          type: 'array',
          minItems: 1,
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['id', 'batchId', 'title', 'durationMinutes', 'mode', 'category', 'dependsOn', 'requires'],
            properties: {
              id: { type: 'string', minLength: 1 },
              batchId: { type: 'string', minLength: 1 },
              title: { type: 'string', minLength: 1 },
              durationMinutes: { type: 'number', exclusiveMinimum: 0, maximum: 720 },
              mode: { type: 'string', enum: ['active', 'passive'] },
              category: { type: 'string', minLength: 1 },
              dependsOn: { type: 'array', items: { type: 'string' } },
              requires: {
                type: 'object',
                additionalProperties: false,
                required: ['equipmentTypes', 'cookwareTypes', 'outletCount', 'locationPreference'],
                properties: {
                  equipmentTypes: { type: 'array', items: { type: 'string' } },
                  cookwareTypes: { type: 'array', items: { type: 'string' } },
                  outletCount: { type: 'integer', minimum: 0, maximum: 4 },
                  locationPreference: { type: 'string', enum: ['kitchen', 'room', 'either'] }
                }
              }
            }
          }
        }
      }
    };
  }

  function sanitizedDemand(demand) {
    return {
      week: Number(demand && demand.week) || 1,
      batches: (demand && Array.isArray(demand.batches) ? demand.batches : []).map(function (batch) {
        var meal = batch.meal || {};
        return {
          id: batch.id,
          mealId: batch.mealId,
          title: batch.title,
          portions: batch.portions,
          servingDays: Array.isArray(batch.servingDays) ? batch.servingDays.slice() : [],
          strategy: batch.strategy,
          prepMinutes: meal.prepMinutes,
          ingredients: (Array.isArray(meal.ingredients) ? meal.ingredients : []).map(function (item) {
            return {
              id: item.id,
              name: item.name,
              amount: item.amount,
              unit: item.unit
            };
          }),
          instructions: (Array.isArray(meal.instructions) ? meal.instructions : []).map(String)
        };
      })
    };
  }

  function sanitizedKitchen(profile) {
    var safe = CookingCore.normalizeKitchenProfile(profile);
    var mode = safe.modes[safe.activeMode];
    return {
      mode: safe.activeMode,
      kitchenOutlets: mode.kitchenOutlets,
      roomOutlets: mode.roomOutlets,
      resources: safe.resources.map(function (item) {
        return {
          type: item.type,
          kind: item.kind,
          preferredLocation: item.preferredLocation,
          strength: item.strength || 'normal'
        };
      })
    };
  }

  function requestBody(model, demand, profile, mode) {
    var payload = {
      meals: sanitizedDemand(demand),
      kitchen: sanitizedKitchen(profile)
    };
    var responseFormat = mode === 'json_object'
      ? { type: 'json_object' }
      : {
        type: 'json_schema',
        json_schema: {
          name: 'nutrition_cooking_plan',
          strict: true,
          schema: cookingPlanSchema()
        }
      };
    return {
      model: model,
      temperature: 0.1,
      provider: { require_parameters: true },
      response_format: responseFormat,
      messages: [
        {
          role: 'system',
          content: 'разложи блюда на атомарные действия готовки. не назначай окончательное время и не выдумывай приборы. активное действие требует участия человека, пассивное может идти параллельно. верни только json по заданной схеме.'
        },
        {
          role: 'user',
          content: JSON.stringify(payload)
        }
      ]
    };
  }

  function safeError(code, message) {
    return { ok: false, error: { code: code, message: message } };
  }

  function schemaUnsupported(status, data) {
    if (status !== 400 && status !== 422) return false;
    var message = String(data && data.error && data.error.message || '').toLowerCase();
    return message.indexOf('json_schema') !== -1 || message.indexOf('response_format') !== -1 || message.indexOf('structured') !== -1;
  }

  function parseProviderContent(data) {
    var content = data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
    if (content && typeof content === 'object') return content;
    if (typeof content !== 'string' || !content.trim()) return null;
    try {
      return JSON.parse(content);
    } catch (_) {
      return null;
    }
  }

  function createOpenRouterCookingClient(options) {
    var fetchImpl = options && options.fetchImpl || (typeof fetch === 'function' ? fetch.bind(globalThis) : null);
    var active = null;

    async function requestOnce(params, mode, signal) {
      return fetchImpl(ENDPOINT, {
        method: 'POST',
        headers: {
          Authorization: 'Bearer ' + params.apiKey,
          'Content-Type': 'application/json'
        },
        signal: signal,
        body: JSON.stringify(requestBody(params.model, params.demand, params.profile, mode))
      });
    }

    async function run(params, controller) {
      if (!fetchImpl) return safeError('network-unavailable', 'сетевой клиент недоступен');
      if (!params.apiKey) return safeError('missing-api-key', 'для уточнения плана нужен ключ openrouter');
      try {
        var mode = 'json_schema';
        var response = await requestOnce(params, mode, controller.signal);
        var data = await response.json();
        if (!response.ok && schemaUnsupported(response.status, data)) {
          mode = 'json_object';
          response = await requestOnce(params, mode, controller.signal);
          data = await response.json();
        }
        if (!response.ok || data && data.error) {
          return safeError('provider-error', 'openrouter не смог построить план готовки');
        }
        var parsed = parseProviderContent(data);
        if (!parsed) return safeError('invalid-model-output', 'модель вернула нечитаемый план готовки');
        var checked = CookingCore.validateGeneratedPlan(parsed, params.profile);
        if (!checked.ok) return safeError('invalid-model-output', 'план модели не прошёл локальную проверку');
        return {
          ok: true,
          value: checked.value,
          mode: mode,
          model: params.model
        };
      } catch (error) {
        if (error && error.name === 'AbortError') return safeError('aborted', 'запрос отменён после изменения рациона');
        return safeError('network-error', 'не удалось связаться с openrouter');
      }
    }

    function decompose(params) {
      var safeParams = params || {};
      var hash = CookingCore.createPlanFingerprint(safeParams.demand || {}, safeParams.profile);
      if (active && active.hash === hash) return active.promise;
      if (active) active.controller.abort();

      var controller = new AbortController();
      if (safeParams.signal) {
        if (safeParams.signal.aborted) controller.abort();
        else safeParams.signal.addEventListener('abort', function () { controller.abort(); }, { once: true });
      }
      var promise = run(safeParams, controller).finally(function () {
        if (active && active.controller === controller) active = null;
      });
      active = { hash: hash, controller: controller, promise: promise };
      return promise;
    }

    function abort() {
      if (active) active.controller.abort();
    }

    return { decompose: decompose, abort: abort };
  }

  return {
    createOpenRouterCookingClient: createOpenRouterCookingClient,
    cookingPlanSchema: cookingPlanSchema
  };
});
