import { SchoolHttpError } from "./errors.ts";
import type {
  AuthContext,
  CreateUserClient,
  SchoolEnvironment,
} from "./types.ts";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export async function authorizeRequest(
  request: Request,
  env: SchoolEnvironment,
  createUserClient: CreateUserClient,
): Promise<AuthContext> {
  if (!request.headers.get("authorization")) {
    throw new SchoolHttpError(
      401,
      "AUTH_REQUIRED",
      "a valid user session is required",
    );
  }

  let result;

  try {
    result = await createUserClient(request, { auth: "user" });
  } catch {
    throw new SchoolHttpError(
      401,
      "AUTH_REQUIRED",
      "a valid user session is required",
    );
  }

  if (result.error || !isRecord(result.data)) {
    throw new SchoolHttpError(
      401,
      "AUTH_REQUIRED",
      "a valid user session is required",
    );
  }

  const userClaims = isRecord(result.data.userClaims)
    ? result.data.userClaims
    : {};
  const userId = typeof userClaims.id === "string"
    ? userClaims.id
    : typeof userClaims.sub === "string"
    ? userClaims.sub
    : "";

  if (!userId) {
    throw new SchoolHttpError(
      401,
      "AUTH_REQUIRED",
      "a valid user session is required",
    );
  }

  if (!env.SCHOOL_OWNER_USER_ID) {
    throw new SchoolHttpError(
      500,
      "SERVER_MISCONFIGURED",
      "server configuration is invalid",
    );
  }

  if (userId !== env.SCHOOL_OWNER_USER_ID) {
    throw new SchoolHttpError(
      403,
      "OWNER_ONLY",
      "this dashboard is restricted to its owner",
    );
  }

  return {
    supabase: result.data.supabase,
    userClaims,
    userId,
  };
}
