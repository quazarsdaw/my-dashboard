import { SchoolHttpError } from "./errors.ts";

export const SCHOOL_LOCK_TTL_SECONDS = 60;

const ACQUIRE_ATTEMPTS = 3;
const MIN_RETRY_DELAY_MS = 20;
const RETRY_JITTER_MS = 40;

type RpcResult = Readonly<{
  data: unknown;
  error: unknown;
}>;

export interface SchoolLockRpcClient {
  rpc(
    name: string,
    args: Readonly<Record<string, unknown>>,
  ): Promise<RpcResult>;
}

export interface ActiveLessonLease {
  renew(): Promise<void>;
}

export interface SchoolLockService {
  withActiveLessonLock<T>(
    ownerId: string,
    operation: (lease: ActiveLessonLease) => T | Promise<T>,
  ): Promise<T>;
}

type LockServiceDependencies = Readonly<{
  createToken?: () => string;
  delay?: (milliseconds: number) => Promise<void>;
  random?: () => number;
}>;

function unavailableError(): SchoolHttpError {
  return new SchoolHttpError(
    500,
    "SCHOOL_LOCK_UNAVAILABLE",
    "school coordination is temporarily unavailable",
  );
}

function lostError(): SchoolHttpError {
  return new SchoolHttpError(
    409,
    "SCHOOL_LOCK_LOST",
    "school coordination lease was lost",
  );
}

function assertBooleanRpcResult(result: RpcResult): boolean {
  if (result.error || typeof result.data !== "boolean") {
    throw unavailableError();
  }

  return result.data;
}

function defaultDelay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export function createSchoolLockService(
  client: SchoolLockRpcClient,
  dependencies: LockServiceDependencies = {},
): SchoolLockService {
  const createToken = dependencies.createToken ?? (() => crypto.randomUUID());
  const delay = dependencies.delay ?? defaultDelay;
  const random = dependencies.random ?? Math.random;

  return {
    async withActiveLessonLock<T>(
      ownerId: string,
      operation: (lease: ActiveLessonLease) => T | Promise<T>,
    ): Promise<T> {
      if (!ownerId) {
        throw new SchoolHttpError(
          500,
          "SERVER_MISCONFIGURED",
          "server configuration is invalid",
        );
      }

      const lockKey = `active-lesson:${ownerId}`;
      const lockToken = createToken();
      let acquired = false;

      for (let attempt = 0; attempt < ACQUIRE_ATTEMPTS; attempt += 1) {
        const result = await client.rpc("acquire_school_mutation_lock", {
          p_lock_key: lockKey,
          p_lock_token: lockToken,
          p_ttl_seconds: SCHOOL_LOCK_TTL_SECONDS,
        });

        acquired = assertBooleanRpcResult(result);
        if (acquired) {
          break;
        }

        if (attempt < ACQUIRE_ATTEMPTS - 1) {
          const jitter = Math.floor(
            Math.max(0, Math.min(1, random())) * RETRY_JITTER_MS,
          );
          await delay(MIN_RETRY_DELAY_MS + jitter);
        }
      }

      if (!acquired) {
        throw new SchoolHttpError(
          409,
          "SCHOOL_MUTATION_IN_PROGRESS",
          "другая операция с активным уроком ещё выполняется",
        );
      }

      const lease: ActiveLessonLease = Object.freeze({
        async renew(): Promise<void> {
          const result = await client.rpc("renew_school_mutation_lock", {
            p_lock_key: lockKey,
            p_lock_token: lockToken,
            p_ttl_seconds: SCHOOL_LOCK_TTL_SECONDS,
          });

          if (result.error || result.data !== true) {
            throw lostError();
          }
        },
      });

      try {
        return await operation(lease);
      } finally {
        try {
          await client.rpc("release_school_mutation_lock", {
            p_lock_key: lockKey,
            p_lock_token: lockToken,
          });
        } catch {
          // The sixty-second lease is the recovery path after a crashed release.
        }
      }
    },
  };
}
