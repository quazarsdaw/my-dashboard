import { handleRequest } from "../router.ts";
import { ACTIVE_LESSON_WEEK } from "../types.ts";

type UserClaims = {
  id?: string;
  sub?: string;
};

type UserContextResult = {
  data: {
    userClaims?: UserClaims;
    supabase?: unknown;
  } | null;
  error: {
    code?: string;
    message?: string;
    status?: number;
  } | null;
};

type TestEnvironment = {
  DASHBOARD_ORIGIN: string;
  NOTION_DATA_SOURCE_ID: string;
  NOTION_TOKEN: string;
  SCHOOL_ENV?: string;
  SCHOOL_OWNER_USER_ID: string;
};

type TestDependencies = {
  createRequestId: () => string;
  createUserClient: (
    request: Request,
    options: { auth: "user" },
  ) => Promise<UserContextResult>;
  env: TestEnvironment;
  router: (
    command: Readonly<Record<string, unknown>>,
    context: { requestId: string; userId: string },
  ) => Promise<Response>;
};

const allowedOrigin = "https://dashboard.example";
const authorizationToken = "session-token-that-must-not-leak";
const ownerId = "owner-user-id";

const baseEnv: TestEnvironment = {
  DASHBOARD_ORIGIN: allowedOrigin,
  NOTION_DATA_SOURCE_ID: "notion-data-source-secret",
  NOTION_TOKEN: "notion-token-that-must-not-leak",
  SCHOOL_OWNER_USER_ID: ownerId,
};

function assert(
  condition: unknown,
  message: string,
): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

function assertEquals<T>(actual: T, expected: T, message: string): void {
  if (actual !== expected) {
    throw new Error(
      `${message}: expected ${String(expected)}, got ${String(actual)}`,
    );
  }
}

function request(
  method: string,
  options: {
    authorization?: string;
    body?: Record<string, unknown>;
    origin?: string;
  } = {},
): Request {
  const headers = new Headers();
  headers.set("origin", options.origin ?? allowedOrigin);
  headers.set("content-type", "application/json");

  if (options.authorization) {
    headers.set("authorization", options.authorization);
  }

  return new Request("https://edge.example/functions/v1/school-notion", {
    method,
    headers,
    body: method === "POST"
      ? JSON.stringify(
        options.body ??
          { operation: "listLessons", week: ACTIVE_LESSON_WEEK },
      )
      : undefined,
  });
}

function authenticatedContext(userId: string): UserContextResult {
  return {
    data: {
      userClaims: { sub: userId },
      supabase: {},
    },
    error: null,
  };
}

function dependencies(
  overrides: Partial<TestDependencies> = {},
): TestDependencies {
  return {
    createRequestId: () => "request-id-123",
    createUserClient: () => Promise.resolve(authenticatedContext(ownerId)),
    env: { ...baseEnv },
    router: () => Promise.resolve(Response.json({ ok: true }, { status: 200 })),
    ...overrides,
  };
}

async function readJson(response: Response): Promise<Record<string, unknown>> {
  return await response.json() as Record<string, unknown>;
}

if (typeof Deno !== "undefined") {
  Deno.test("allowed preflight returns 204 before authentication", async () => {
    const response = await handleRequest(
      request("OPTIONS"),
      dependencies({
        createUserClient: () => {
          throw new Error("authentication must not run for preflight");
        },
      }),
    );

    assertEquals(response.status, 204, "preflight status");
    assertEquals(await response.text(), "", "preflight body");
  });

  Deno.test("preflight exposes only the allowed request headers", async () => {
    const response = await handleRequest(request("OPTIONS"), dependencies());

    assertEquals(
      response.headers.get("access-control-allow-headers"),
      "authorization, apikey, content-type, x-client-info",
      "allowed headers",
    );
  });

  Deno.test("origin outside the allowlist returns ORIGIN_NOT_ALLOWED", async () => {
    const response = await handleRequest(
      request("POST", {
        authorization: `Bearer ${authorizationToken}`,
        origin: "https://attacker.example",
      }),
      dependencies(),
    );
    const body = await readJson(response);

    assertEquals(response.status, 403, "disallowed origin status");
    assertEquals(body.error, "ORIGIN_NOT_ALLOWED", "disallowed origin code");
  });

  Deno.test("missing session returns 401", async () => {
    const response = await handleRequest(request("POST"), dependencies());
    const body = await readJson(response);

    assertEquals(response.status, 401, "missing session status");
    assertEquals(body.error, "AUTH_REQUIRED", "missing session code");
  });

  Deno.test("invalid session returns 401", async () => {
    const response = await handleRequest(
      request("POST", { authorization: `Bearer ${authorizationToken}` }),
      dependencies({
        createUserClient: () =>
          Promise.resolve({
            data: null,
            error: {
              code: "invalid_jwt",
              message: authorizationToken,
              status: 401,
            },
          }),
      }),
    );
    const body = await readJson(response);

    assertEquals(response.status, 401, "invalid session status");
    assertEquals(body.error, "AUTH_REQUIRED", "invalid session code");
  });

  Deno.test("authenticated non-owner returns 403", async () => {
    const response = await handleRequest(
      request("POST", { authorization: `Bearer ${authorizationToken}` }),
      dependencies({
        createUserClient: () =>
          Promise.resolve(authenticatedContext("different-user-id")),
      }),
    );
    const body = await readJson(response);

    assertEquals(response.status, 403, "non-owner status");
    assertEquals(body.error, "OWNER_ONLY", "non-owner code");
  });

  Deno.test("owner reaches router with a normalized command", async () => {
    const response = await handleRequest(
      request("POST", {
        authorization: `Bearer ${authorizationToken}`,
        body: {
          operation: "listLessons",
          week: ACTIVE_LESSON_WEEK,
        },
      }),
      dependencies({
        router: (command, context) => {
          assertEquals(
            command.operation,
            "listLessons",
            "normalized operation",
          );
          assertEquals(
            command.week,
            ACTIVE_LESSON_WEEK,
            "normalized week",
          );
          assertEquals(context.userId, ownerId, "router user id");
          assertEquals(
            context.requestId,
            "request-id-123",
            "router request id",
          );
          return Promise.resolve(
            Response.json({ ok: true }, { status: 200 }),
          );
        },
      }),
    );

    assertEquals(response.status, 200, "owner response status");
  });

  Deno.test("error response does not leak request headers, stack, or environment values", async () => {
    const response = await handleRequest(
      request("POST", { authorization: `Bearer ${authorizationToken}` }),
      dependencies({
        router: () => {
          const error = new Error(
            `${authorizationToken} ${baseEnv.NOTION_TOKEN} ${baseEnv.NOTION_DATA_SOURCE_ID}`,
          );
          error.stack = `sensitive-stack ${authorizationToken}`;
          return Promise.reject(error);
        },
      }),
    );
    const text = await response.text();

    assertEquals(response.status, 500, "internal error status");
    assert(!text.includes(authorizationToken), "authorization token leaked");
    assert(!text.includes(baseEnv.NOTION_TOKEN), "notion token leaked");
    assert(
      !text.includes(baseEnv.NOTION_DATA_SOURCE_ID),
      "environment value leaked",
    );
    assert(!text.includes("sensitive-stack"), "stack leaked");
  });
}
