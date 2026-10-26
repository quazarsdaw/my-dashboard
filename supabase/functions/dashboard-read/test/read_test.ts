import assert from "node:assert/strict";
import { parseCommand, readDashboard } from "../data.ts";
import { type Environment, handleRead } from "../handler.ts";

const now = new Date("2026-10-26T00:59:59Z"); // 05:59:59 екатеринбурга
const updated = "2026-10-25T19:00:00Z";
const token = "a".repeat(43);
const owner = "11111111-1111-4111-8111-111111111111";
function row<T>(key: string, value: T) {
  return { key, value, updated_at: updated };
}
function project(raw: unknown, rows: ReturnType<typeof row>[], at = now) {
  return readDashboard(parseCommand(raw, at), rows, at);
}
function page(raw: unknown, rows: ReturnType<typeof row>[]) {
  const result = project(raw, rows);
  assert.ok("items" in result.data);
  return { ...result, data: result.data };
}
function summary(rows: ReturnType<typeof row>[]) {
  const result = project({ operation: "get_dashboard_summary" }, rows);
  assert.ok("tasks" in result.data);
  return { ...result, data: result.data };
}

Deno.test("активный день задач меняется в 06:00, календарный tracker — в полночь", () => {
  assert.deepEqual(parseCommand({ operation: "get_today_tasks" }, now).keys, [
    "goals:2026-10-25",
  ]);
  assert.deepEqual(
    parseCommand(
      { operation: "get_today_tasks" },
      new Date("2026-10-26T01:00:00Z"),
    ).keys,
    ["goals:2026-10-26"],
  );
  const result = project({ operation: "get_dashboard_summary" }, []);
  assert.equal(result.meta.activeDate, "2026-10-25");
  assert.equal(result.meta.calendarDate, "2026-10-26");
  assert.equal(result.meta.source, "last_synced_cloud");
  assert.equal(result.meta.atomic, false);
});
Deno.test("неизвестные операции, поля, владельцы, sql и неверные даты отклоняются", () => {
  for (
    const raw of [
      null,
      [],
      { operation: "update_task" },
      { operation: "get_today_tasks", userId: owner },
      { operation: "get_goals", keys: ["coins_v1"] },
      { operation: "list_tasks", from: "2026-02-30", to: "2026-03-01" },
      { operation: "list_tasks", from: "2026-10-31", to: "2026-10-01" },
      { operation: "list_tasks", from: "2026-10-01", to: "2026-11-01" },
      { operation: "get_goals", periodKey: "2026-10" },
      { operation: "get_goals", horizon: "week", periodKey: "2026-10-06" },
      { operation: "get_goals", horizon: "5year", periodKey: "2027" },
      { operation: "get_goals", limit: 101 },
      { operation: "get_goals", cursor: -1 },
    ]
  ) {
    assert.throws(() => parseCommand(raw, now), /INVALID_COMMAND/);
  }
  assert.equal(
    parseCommand({
      operation: "list_tasks",
      from: "2026-10-01",
      to: "2026-10-31",
    }, now).keys.length,
    31,
  );
});
Deno.test("задачи читаются из text/json без raw полей и со snapshot reference", () => {
  const input = [row(
    "goals:2026-10-25",
    JSON.stringify([
      {
        text: "разобрать документы",
        done: true,
        estimatedMin: 20,
        sphere: "career",
        difficulty: "medium",
        secret: "не отдавать",
        subtasks: [{ text: "папка", done: false, internal: "не отдавать" }],
      },
    ]),
  )];
  const result = page({ operation: "get_today_tasks" }, input);
  assert.deepEqual(result.data.items, [{
    reference: "2026-10-25:0",
    date: "2026-10-25",
    title: "разобрать документы",
    done: true,
    estimatedMin: 20,
    sphere: "career",
    difficulty: "medium",
    subtasks: [{ title: "папка", done: false }],
  }]);
  assert.equal(result.sources[0].updatedAt, "2026-10-25T19:00:00.000Z");
  assert.equal(JSON.stringify(result).includes("не отдавать"), false);
  assert.equal(input[0].value.includes("secret"), true);
});
Deno.test("страницы задач не теряют остаток списка и принимают несколько дней", () => {
  const rows = [
    row("goals:2026-10-25", [{ text: "а", done: false }, {
      text: "б",
      done: true,
    }]),
    row("goals:2026-10-26", [{ text: "в", done: false }]),
  ];
  const raw = {
    operation: "list_tasks",
    from: "2026-10-25",
    to: "2026-10-26",
    limit: 2,
  };
  const first = page(raw, rows);
  assert.equal(first.data.total, 3);
  assert.equal(first.data.nextCursor, 2);
  assert.deepEqual(
    page({ ...raw, cursor: 2 }, rows).data.items.map((
      x: Record<string, unknown>,
    ) => x.title),
    ["в"],
  );
});
Deno.test("missing и пустой список различаются, corrupt не выдаётся за успешный ноль", () => {
  assert.equal(
    project({ operation: "get_today_tasks" }, []).sources[0].state,
    "missing",
  );
  assert.equal(
    project({ operation: "get_today_tasks" }, [row("goals:2026-10-25", [])])
      .sources[0].state,
    "available",
  );
  for (
    const value of ["{broken", {}, [{ done: true }], [{
      text: "а",
      done: "yes",
    }]]
  ) {
    assert.throws(
      () =>
        project({ operation: "get_today_tasks" }, [
          row("goals:2026-10-25", value),
        ]),
      /INVALID_DASHBOARD_DATA/,
    );
  }
  for (
    const rows of [[row("coins_v1", {})], [
      row("goals:2026-10-25", []),
      row("goals:2026-10-25", []),
    ]]
  ) {
    assert.throws(
      () => project({ operation: "get_today_tasks" }, rows),
      /INVALID_DASHBOARD_DATA/,
    );
  }
  assert.equal(summary([]).data.tasks.total, null);
});
const goals = [
  {
    id: "oct",
    title: "октябрь",
    type: "number",
    current: 2,
    target: 10,
    unit: "шагов",
    done: false,
    horizon: "month",
    periodKey: "2026-10",
    priority: "p2",
    order: 200,
    private: "не отдавать",
  },
  {
    id: "done",
    title: "готово",
    type: "check",
    done: true,
    horizon: "month",
    periodKey: "2026-10",
    priority: "p1",
    order: 100,
  },
  {
    id: "nov",
    title: "ноябрь",
    type: "check",
    done: false,
    horizon: "month",
    periodKey: "2026-11",
    priority: "p1",
    order: 100,
  },
  {
    id: "old",
    title: "старая цель",
    type: "check",
    done: false,
    horizon: "month",
  },
];
Deno.test("цели фильтруются по периоду, сохраняют done/приоритет/прогресс; legacy не переезжает", () => {
  const rows = [row("horizons_goals_v2", { schemaVersion: 3, goals })];
  const result = page({
    operation: "get_goals",
    horizon: "month",
    periodKey: "2026-10",
  }, rows);
  assert.deepEqual(
    result.data.items.map((x: Record<string, unknown>) => x.id),
    ["oct", "done"],
  );
  assert.equal(result.data.items[0].current, 2);
  assert.equal(result.data.items[0].priority, "p2");
  assert.equal(result.warnings.includes("legacy_goal_period"), true);
  assert.equal(JSON.stringify(result).includes("не отдавать"), false);
  assert.equal(
    page({ operation: "get_goals", includeDone: false }, rows).data.total,
    3,
  );
  const all = page({ operation: "get_goals" }, rows);
  assert.equal(
    all.data.items.find((x: Record<string, unknown>) => x.id === "old")
      ?.periodKey,
    null,
  );
});
Deno.test("tracker возвращает только запрошенные даты и отличает отсутствие отметки от 0", () => {
  const result = page({
    operation: "get_tracker",
    from: "2026-10-25",
    to: "2026-10-26",
  }, [row("tracker_v1", {
    good: [{ id: "g1", name: "зарядка" }],
    bad: [{ id: "b1", name: "срыв", severity: "high" }],
    marks: { "g1:2026-10-25": 0.5, "g1:2026-10-24": 1, "b1:2026-10-26": 1 },
    token: "не отдавать",
  })]);
  assert.deepEqual(result.data.items, [
    {
      id: "g1",
      name: "зарядка",
      kind: "good",
      marks: [{ date: "2026-10-25", value: 0.5 }, {
        date: "2026-10-26",
        value: null,
      }],
    },
    {
      id: "b1",
      name: "срыв",
      kind: "bad",
      marks: [{ date: "2026-10-25", value: null }, {
        date: "2026-10-26",
        value: 1,
      }],
    },
  ]);
  assert.equal(JSON.stringify(result).includes("2026-10-24"), false);
});
Deno.test("summary считает текущие периоды и различает active/calendar день", () => {
  const result = summary([
    row("goals:2026-10-25", [{ text: "а", done: true }, {
      text: "б",
      done: false,
    }]),
    row("horizons_goals_v2", { goals }),
    row("tracker_v1", {
      good: [{ id: "g1", name: "а" }, { id: "g2", name: "б" }],
      bad: [],
      marks: { "g1:2026-10-26": 1, "g2:2026-10-26": 0.5 },
    }),
  ]);
  assert.deepEqual(result.data.tasks, { total: 2, done: 1 });
  assert.deepEqual(result.data.goals, { total: 2, done: 1 });
  assert.deepEqual(result.data.tracker, { full: 1, partial: 1, bad: 0 });
});

async function env(): Promise<Environment> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(token),
  );
  return {
    SUPABASE_URL: "https://abcdefghijklmnopqrst.supabase.co",
    SUPABASE_SERVICE_ROLE_KEY: "service-secret-not-for-client",
    DASHBOARD_AGENT_USER_ID: owner,
    DASHBOARD_AGENT_TOKEN_SHA256: Array.from(
      new Uint8Array(digest),
      (n) => n.toString(16).padStart(2, "0"),
    ).join(""),
    DASHBOARD_AGENT_EXPIRES_AT: "2026-12-01T00:00:00Z",
  };
}
function request(
  body: unknown = { operation: "get_today_tasks" },
  options: { token?: string; method?: string; origin?: string } = {},
) {
  const headers = new Headers({
    "content-type": "application/json",
    "x-dashboard-token": options.token ?? token,
  });
  if (options.origin) headers.set("origin", options.origin);
  return new Request("https://edge.example/functions/v1/dashboard-read", {
    method: options.method ?? "POST",
    headers,
    body: options.method === "GET" ? undefined : JSON.stringify(body),
  });
}
Deno.test("auth/expiry/config fail closed до database fetch и ошибки не раскрывают секреты", async () => {
  const environment = await env();
  let fetched = false;
  for (
    const [req, e, status] of [
      [request(undefined, { token: "b".repeat(43) }), environment, 401],
      [request(), {
        ...environment,
        DASHBOARD_AGENT_EXPIRES_AT: "2026-01-01T00:00:00Z",
      }, 401],
      [request(), { ...environment, DASHBOARD_AGENT_USER_ID: "" }, 503],
      [
        request(undefined, { origin: "https://evil.example" }),
        environment,
        403,
      ],
      [request(undefined, { method: "GET" }), environment, 405],
    ] as const
  ) {
    const result = await handleRead(req, {
      env: e,
      now: () => now,
      fetch: () => {
        fetched = true;
        throw Error("secret");
      },
    });
    assert.equal(result.status, status);
    assert.equal((await result.text()).includes("service-secret"), false);
    assert.equal(result.headers.get("cache-control"), "no-store");
  }
  assert.equal(fetched, false);
});
Deno.test("api делает только bounded get с фиксированными owner/keys и не прокидывает token", async () => {
  const result = await handleRead(request(), {
    env: await env(),
    now: () => now,
    fetch: (url, options) => {
      const query = new URL(String(url));
      assert.equal(query.origin, "https://abcdefghijklmnopqrst.supabase.co");
      assert.equal(query.pathname, "/rest/v1/user_data");
      assert.equal(query.searchParams.get("user_id"), "eq." + owner);
      assert.equal(query.searchParams.get("key"), 'in.("goals:2026-10-25")');
      assert.equal(query.searchParams.get("select"), "key,value,updated_at");
      assert.equal(options?.method, "GET");
      assert.equal(options?.redirect, "error");
      const headers = new Headers(options?.headers);
      assert.equal(headers.get("x-dashboard-token"), null);
      assert.equal(
        headers.get("authorization"),
        "Bearer service-secret-not-for-client",
      );
      return Promise.resolve(Response.json([row("goals:2026-10-25", [])]));
    },
  });
  assert.equal(result.status, 200);
  assert.equal(result.headers.get("access-control-allow-origin"), null);
});
Deno.test("unknown fields, oversized input/upstream и provider errors не становятся частичным успехом", async () => {
  const e = await env();
  let fetched = 0;
  const deps = {
    env: e,
    now: () => now,
    fetch: () => {
      fetched++;
      return Promise.resolve(new Response("provider-secret", { status: 403 }));
    },
  };
  assert.equal(
    (await handleRead(request({ operation: "get_today_tasks", owner }), deps))
      .status,
    400,
  );
  assert.equal(
    (await handleRead(
      request({ operation: "get_today_tasks", huge: "a".repeat(5000) }),
      deps,
    )).status,
    413,
  );
  assert.equal(fetched, 0);
  const failed = await handleRead(request(), deps);
  assert.equal(failed.status, 502);
  assert.equal((await failed.text()).includes("provider-secret"), false);
  const huge = await handleRead(request(), {
    ...deps,
    fetch: () => Promise.resolve(new Response("x".repeat(4 * 1024 * 1024 + 1))),
  });
  assert.equal(huge.status, 502);
});
