import {
  createSchoolLockService,
  SCHOOL_LOCK_TTL_SECONDS,
} from "../lock-service.ts";
import { SchoolHttpError } from "../errors.ts";

type RpcResult = Readonly<{
  data: unknown;
  error: unknown;
}>;

type RpcCall = Readonly<{
  args: Readonly<Record<string, unknown>>;
  name: string;
}>;

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

function assertArrayEquals<T>(
  actual: readonly T[],
  expected: readonly T[],
  message: string,
): void {
  if (
    actual.length !== expected.length ||
    actual.some((value, index) => value !== expected[index])
  ) {
    throw new Error(
      `${message}: expected ${JSON.stringify(expected)}, got ${
        JSON.stringify(actual)
      }`,
    );
  }
}

function rpcClient(
  handler: (
    name: string,
    args: Readonly<Record<string, unknown>>,
  ) => RpcResult | Promise<RpcResult>,
  calls: RpcCall[],
) {
  return {
    rpc(
      name: string,
      args: Readonly<Record<string, unknown>>,
    ): Promise<RpcResult> {
      calls.push({ args, name });
      return Promise.resolve(handler(name, args));
    },
  };
}

async function expectSchoolError(
  action: () => Promise<unknown>,
  expectedStatus: number,
  expectedCode: string,
): Promise<SchoolHttpError> {
  try {
    await action();
  } catch (error) {
    assert(error instanceof SchoolHttpError, "expected SchoolHttpError");
    assertEquals(error.status, expectedStatus, "error status");
    assertEquals(error.code, expectedCode, "error code");
    return error;
  }

  throw new Error(`expected ${expectedCode}`);
}

if (typeof Deno !== "undefined") {
  Deno.test("active lesson lock uses the owner-scoped key and sixty-second ttl", async () => {
    const calls: RpcCall[] = [];
    const token = "00000000-0000-4000-8000-000000000001";
    const service = createSchoolLockService(
      rpcClient(() => ({ data: true, error: null }), calls),
      {
        createToken: () => token,
        delay: () => Promise.resolve(),
        random: () => 0,
      },
    );

    const result = await service.withActiveLessonLock(
      "owner-user-id",
      () => Promise.resolve("done"),
    );

    assertEquals(result, "done", "operation result");
    assertEquals(calls[0]?.name, "acquire_school_mutation_lock", "acquire rpc");
    assertEquals(
      calls[0]?.args.p_lock_key,
      "active-lesson:owner-user-id",
      "owner-scoped lock key",
    );
    assertEquals(calls[0]?.args.p_lock_token, token, "request token");
    assertEquals(
      calls[0]?.args.p_ttl_seconds,
      SCHOOL_LOCK_TTL_SECONDS,
      "lease ttl",
    );
    assertEquals(
      calls.at(-1)?.name,
      "release_school_mutation_lock",
      "release rpc",
    );
  });

  Deno.test("active lesson lock retries at most three times with short jitter", async () => {
    const calls: RpcCall[] = [];
    const delays: number[] = [];
    let acquireAttempts = 0;
    const service = createSchoolLockService(
      rpcClient((name) => {
        if (name === "acquire_school_mutation_lock") {
          acquireAttempts += 1;
          return { data: acquireAttempts === 3, error: null };
        }
        return { data: true, error: null };
      }, calls),
      {
        createToken: () => "00000000-0000-4000-8000-000000000001",
        delay: (milliseconds) => {
          delays.push(milliseconds);
          return Promise.resolve();
        },
        random: () => 0.5,
      },
    );

    await service.withActiveLessonLock(
      "owner-user-id",
      () => Promise.resolve(),
    );

    assertEquals(acquireAttempts, 3, "acquire attempt count");
    assertEquals(delays.length, 2, "delay count");
    assert(
      delays.every((milliseconds) =>
        Number.isInteger(milliseconds) &&
        milliseconds >= 10 &&
        milliseconds <= 100
      ),
      "retry delay must use short jitter",
    );
  });

  Deno.test("busy lock returns a normalized conflict after three attempts", async () => {
    const calls: RpcCall[] = [];
    let operationCalled = false;
    const service = createSchoolLockService(
      rpcClient(() => ({ data: false, error: null }), calls),
      {
        createToken: () => "00000000-0000-4000-8000-000000000001",
        delay: () => Promise.resolve(),
        random: () => 0,
      },
    );

    const error = await expectSchoolError(
      () =>
        service.withActiveLessonLock("owner-user-id", () => {
          operationCalled = true;
          return Promise.resolve();
        }),
      409,
      "SCHOOL_MUTATION_IN_PROGRESS",
    );

    assertEquals(operationCalled, false, "operation must not run");
    assertEquals(
      calls.filter((call) => call.name === "acquire_school_mutation_lock")
        .length,
      3,
      "maximum acquire attempts",
    );
    assertEquals(
      calls.some((call) => call.name === "release_school_mutation_lock"),
      false,
      "unacquired lease must not be released",
    );
    assert(
      !error.message.includes("00000000-0000-4000-8000-000000000001"),
      "error message must not leak lock token",
    );
  });

  Deno.test("operation explicitly renews the same lease between notion steps", async () => {
    const calls: RpcCall[] = [];
    const token = "00000000-0000-4000-8000-000000000001";
    const service = createSchoolLockService(
      rpcClient(() => ({ data: true, error: null }), calls),
      {
        createToken: () => token,
        delay: () => Promise.resolve(),
        random: () => 0,
      },
    );

    const steps: string[] = [];
    await service.withActiveLessonLock("owner-user-id", async (lease) => {
      steps.push("notion-read");
      await lease.renew();
      steps.push("notion-update");
      await lease.renew();
    });

    assertArrayEquals(
      steps,
      ["notion-read", "notion-update"],
      "notion steps",
    );
    const renewCalls = calls.filter((call) =>
      call.name === "renew_school_mutation_lock"
    );
    assertEquals(renewCalls.length, 2, "explicit renew count");
    assert(
      renewCalls.every((call) =>
        call.args.p_lock_key === "active-lesson:owner-user-id" &&
        call.args.p_lock_token === token &&
        call.args.p_ttl_seconds === SCHOOL_LOCK_TTL_SECONDS
      ),
      "renew must use the current lease identity",
    );
  });

  Deno.test("lost lease blocks the next notion step and still runs release", async () => {
    const calls: RpcCall[] = [];
    const service = createSchoolLockService(
      rpcClient((name) => ({
        data: name !== "renew_school_mutation_lock",
        error: null,
      }), calls),
      {
        createToken: () => "00000000-0000-4000-8000-000000000001",
        delay: () => Promise.resolve(),
        random: () => 0,
      },
    );
    let secondStepCalled = false;

    await expectSchoolError(
      () =>
        service.withActiveLessonLock("owner-user-id", async (lease) => {
          await Promise.resolve("notion-read");
          await lease.renew();
          secondStepCalled = true;
        }),
      409,
      "SCHOOL_LOCK_LOST",
    );

    assertEquals(secondStepCalled, false, "next step must not run");
    assertEquals(
      calls.at(-1)?.name,
      "release_school_mutation_lock",
      "release after lost lease",
    );
  });

  Deno.test("finally releases the lease when the domain operation throws", async () => {
    const calls: RpcCall[] = [];
    const domainError = new Error("domain failed");
    const service = createSchoolLockService(
      rpcClient(() => ({ data: true, error: null }), calls),
      {
        createToken: () => "00000000-0000-4000-8000-000000000001",
        delay: () => Promise.resolve(),
        random: () => 0,
      },
    );

    let caught: unknown;
    try {
      await service.withActiveLessonLock("owner-user-id", () => {
        throw domainError;
      });
    } catch (error) {
      caught = error;
    }

    assertEquals(caught, domainError, "domain error identity");
    assertEquals(
      calls.at(-1)?.name,
      "release_school_mutation_lock",
      "release in finally",
    );
  });

  Deno.test("rpc failures do not log or expose lock tokens", async () => {
    const calls: RpcCall[] = [];
    const token = "00000000-0000-4000-8000-000000000001";
    const capturedLogs: string[] = [];
    const originalError = console.error;
    console.error = (...values: unknown[]) => {
      capturedLogs.push(values.map(String).join(" "));
    };

    try {
      const service = createSchoolLockService(
        rpcClient(() => ({
          data: null,
          error: { message: `database failed for ${token}` },
        }), calls),
        {
          createToken: () => token,
          delay: () => Promise.resolve(),
          random: () => 0,
        },
      );

      const error = await expectSchoolError(
        () =>
          service.withActiveLessonLock(
            "owner-user-id",
            () => Promise.resolve(),
          ),
        500,
        "SCHOOL_LOCK_UNAVAILABLE",
      );

      assert(!error.message.includes(token), "normalized error leaked token");
      assert(
        capturedLogs.every((line) => !line.includes(token)),
        "server log leaked token",
      );
    } finally {
      console.error = originalError;
    }
  });
}
