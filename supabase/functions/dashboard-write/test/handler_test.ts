import assert from "node:assert/strict";
import { handleWrite } from "../handler.ts";
import { sha256 } from "../../_shared/dashboard-write/commands.ts";

const token = "a".repeat(43);
const requestId = "11111111-1111-4111-8111-111111111111";
const draftId = "22222222-2222-4222-8222-222222222222";
const owner = "33333333-3333-4333-8333-333333333333";
const targetId = "44444444-4444-4444-8444-444444444444";
const origin = "https://abcdefghijklmnopqrst.supabase.co";
const base = origin + "/functions/v1/dashboard-write";
const created = new Date("2026-11-06T00:59:59Z");
const expiresAt = "2026-11-06T01:04:59.000Z";
const hash = await sha256(token);
const env = {
  SUPABASE_URL: origin,
  SUPABASE_SERVICE_ROLE_KEY: "synthetic-service-role-only",
  DASHBOARD_AGENT_USER_ID: owner,
  DASHBOARD_AGENT_WRITE_TOKEN_SHA256: hash,
  DASHBOARD_AGENT_WRITE_EXPIRES_AT: "2026-12-06T00:00:00Z",
};
const prepare = {
  requestId,
  operation: "route_inbox_to_task",
  arguments: {
    target: { id: "in_1", expectedRevision: "1" },
    date: "2026-11-06",
  },
};
function call(path: string, body: unknown, options: RequestInit = {}) {
  return new Request(base + path, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-dashboard-write-token": token,
      ...options.headers,
    },
    body: JSON.stringify(body),
    ...Object.fromEntries(
      Object.entries(options).filter(([k]) => k !== "headers"),
    ),
  });
}
const ok = (data: unknown) => Response.json({ ok: true, data });
const bad = (code: string, status: number) =>
  Response.json({ ok: false, error: { code, status } });

Deno.test("неверный токен, expiry, origin, путь и большой запрос останавливаются до базы", async () => {
  const fetcher: typeof fetch = () => {
    throw new Error("не должно быть запроса в бд");
  };
  const deps = { env, now: () => created, fetch: fetcher };
  for (
    const [req, status] of [
      [
        call("/prepare", prepare, {
          headers: { "x-dashboard-write-token": "b".repeat(43) },
        }),
        401,
      ],
      [
        call("/prepare", prepare, {
          headers: { origin: "https://example.test" },
        }),
        403,
      ],
      [call("/prepare?key=coins_v1", prepare), 404],
      [call("/rpc", prepare), 404],
      [call("/commit", { requestId, draftId, patch: { done: true } }), 422],
      [call("/prepare", { ...prepare, owner }), 422],
      [
        call("/prepare", {
          ...prepare,
          arguments: { ...prepare.arguments, force: true },
        }),
        422,
      ],
      [call("/prepare", { text: "x".repeat(32768) }), 413],
    ] as const
  ) assert.equal((await handleWrite(req, deps)).status, status);
  const expired = await handleWrite(call("/prepare", prepare), {
    ...deps,
    env: { ...env, DASHBOARD_AGENT_WRITE_EXPIRES_AT: created.toISOString() },
  });
  assert.equal(expired.status, 401);
});

function fixture() {
  let payload: Record<string, unknown> | undefined,
    commandHash: string | undefined;
  let clock = created, sourceVersion = "1", allowed = true;
  const calls: { name: string; body: Record<string, unknown> }[] = [];
  const draft = () => ({
    requestId,
    draftId,
    expiresAt,
    previewText: payload?.previewText,
  });
  const fetcher: typeof fetch = (url, init) => {
    const parsed = new URL(String(url));
    assert.equal(parsed.origin, origin);
    assert.equal(init?.redirect, "error");
    const name = parsed.pathname.slice("/rest/v1/rpc/".length);
    const body = JSON.parse(String(init?.body));
    calls.push({ name, body });
    assert.equal(body.p_owner, owner);
    if (name === "dashboard_read_agent_documents") {
      return Promise.resolve(
        Response.json(
          (body.p_keys as string[]).map((key) =>
            key === "inbox_v1"
              ? {
                key,
                exists: true,
                revision: sourceVersion,
                updatedAt: created.toISOString(),
                valueText:
                  '[{"id":"in_1","text":"проверка","date":"2026-11-05T00:00:00Z"}]',
              }
              : {
                key,
                exists: false,
                revision: "0",
                updatedAt: null,
                valueText: null,
              }
          ),
        ),
      );
    }
    assert.equal(body.p_credential, hash);
    if (!allowed) return Promise.resolve(bad("write_disabled", 403));
    if (name === "dashboard_agent_prepare") {
      if (payload) {
        return Promise.resolve(
          commandHash === body.p_command_hash
            ? ok({ state: "prepared", draft: draft() })
            : bad("request_mismatch", 409),
        );
      }
      if (!body.p_payload) return Promise.resolve(bad("request_unknown", 404));
      payload = body.p_payload;
      commandHash = body.p_command_hash;
      return Promise.resolve(ok({ state: "prepared", draft: draft() }));
    }
    if (name === "dashboard_agent_load") {
      return Promise.resolve(
        ok({ state: "prepared", draft: draft(), payload }),
      );
    }
    if (name === "dashboard_agent_commit") {
      if (sourceVersion !== "1") {
        assert.deepEqual(body.p_documents, []);
        return Promise.resolve(bad("conflict", 409));
      }
      assert.equal(body.p_documents.length, 2);
      assert.equal(body.p_documents[0].valueText, "[]");
      return Promise.resolve(
        ok({
          requestId,
          draftId,
          outcome: "committed",
          operation: prepare.operation,
          targetId,
          location: { date: "2026-11-06" },
          versions: { inbox_v1: "2", "goals:2026-11-06": "1" },
          committedAt: created.toISOString(),
          internal: "не возвращать",
        }),
      );
    }
    throw Error("неизвестный rpc");
  };
  return {
    calls,
    deps: { env, now: () => clock, fetch: fetcher, newUuid: () => targetId },
    changeVersion: () => {
      sourceVersion = "2";
    },
    disable: () => {
      allowed = false;
    },
    nextDay: () => {
      clock = new Date(created.getTime() + 60000);
    },
  };
}

Deno.test("prepare не пишет, повтор возвращает тот же preview, commit принимает только ids", async () => {
  const f = fixture();
  const response = await handleWrite(call("/prepare", prepare), f.deps);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  const first = await response.json();
  assert.match(first.draft.previewText, /входящих/);
  assert.equal(f.calls.some((c) => c.name === "dashboard_agent_commit"), false);
  assert.deepEqual(
    f.calls.find((c) => c.name === "dashboard_read_agent_documents")?.body
      .p_keys,
    ["inbox_v1", "goals:2026-11-06"],
  );
  f.nextDay();
  assert.deepEqual(
    await (await handleWrite(call("/prepare", prepare), f.deps)).json(),
    first,
  );
  assert.equal(
    f.calls.filter((c) => c.name === "dashboard_read_agent_documents").length,
    1,
  );
  const committed = await handleWrite(
    call("/commit", { requestId, draftId }),
    f.deps,
  );
  assert.equal(committed.status, 200);
  const receipt = await committed.json();
  assert.equal(receipt.outcome, "committed");
  assert.equal(receipt.targetId, targetId);
  assert.equal("internal" in receipt, false);
});

Deno.test("конфликт на commit сохраняется в бд, а выключенный writer не читает документы", async () => {
  const f = fixture();
  assert.equal(
    (await handleWrite(call("/prepare", prepare), f.deps)).status,
    200,
  );
  f.changeVersion();
  const result = await handleWrite(
    call("/commit", { requestId, draftId }),
    f.deps,
  );
  assert.equal(result.status, 409);
  assert.deepEqual(await result.json(), { error: "conflict" });
  f.disable();
  const count = f.calls.length;
  assert.equal(
    (await handleWrite(call("/prepare", prepare), f.deps)).status,
    403,
  );
  assert.deepEqual(f.calls.slice(count).map((c) => c.name), [
    "dashboard_agent_prepare",
  ]);
});

Deno.test("сырой ответ базы и sql не возвращаются клиенту", async () => {
  const result = await handleWrite(call("/prepare", prepare), {
    env,
    now: () => created,
    fetch: () =>
      Promise.resolve(new Response("sql private-secret", { status: 500 })),
  });
  assert.equal(result.status, 502);
  assert.deepEqual(await result.json(), { error: "upstream_unavailable" });
});
