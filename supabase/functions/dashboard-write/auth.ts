import { sha256 } from "../_shared/dashboard-write/commands.ts";
import { WriteError } from "../_shared/dashboard-write/contracts.ts";

export type Environment = {
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
  DASHBOARD_AGENT_USER_ID: string;
  DASHBOARD_AGENT_WRITE_TOKEN_SHA256: string;
  DASHBOARD_AGENT_WRITE_EXPIRES_AT: string;
};
export type Access = {
  project: string;
  serviceKey: string;
  owner: string;
  generation: string;
  expiresAt: string;
};

export async function authorize(
  request: Request,
  env: Environment,
  now: Date,
): Promise<Access> {
  const hash = env.DASHBOARD_AGENT_WRITE_TOKEN_SHA256;
  const token = request.headers.get("x-dashboard-write-token") ?? "";
  const expiry = Date.parse(env.DASHBOARD_AGENT_WRITE_EXPIRES_AT);
  if (
    !/^https:\/\/[a-z0-9]{20}\.supabase\.co$/.test(env.SUPABASE_URL) ||
    !env.SUPABASE_SERVICE_ROLE_KEY ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
      .test(env.DASHBOARD_AGENT_USER_ID) ||
    !/^[0-9a-f]{64}$/.test(hash) || !Number.isFinite(expiry)
  ) {
    throw new WriteError("write_disabled", 403);
  }
  if (expiry <= now.getTime() || !/^[A-Za-z0-9_-]{43}$/.test(token)) {
    throw new WriteError("unauthorized_or_expired", 401);
  }
  const actual = await sha256(token);
  let different = 0;
  for (let index = 0; index < 64; index++) {
    different |= actual.charCodeAt(index) ^ hash.charCodeAt(index);
  }
  if (different) throw new WriteError("unauthorized_or_expired", 401);
  return {
    project: env.SUPABASE_URL,
    serviceKey: env.SUPABASE_SERVICE_ROLE_KEY,
    owner: env.DASHBOARD_AGENT_USER_ID,
    generation: hash,
    expiresAt: new Date(expiry).toISOString(),
  };
}
