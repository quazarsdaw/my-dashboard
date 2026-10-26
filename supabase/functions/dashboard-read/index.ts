import { type Environment, handleRead } from "./handler.ts";
function environment(): Environment {
  return {
    SUPABASE_URL: Deno.env.get("SUPABASE_URL") ?? "",
    SUPABASE_SERVICE_ROLE_KEY: Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    DASHBOARD_AGENT_USER_ID: Deno.env.get("DASHBOARD_AGENT_USER_ID") ?? "",
    DASHBOARD_AGENT_TOKEN_SHA256:
      Deno.env.get("DASHBOARD_AGENT_TOKEN_SHA256") ?? "",
    DASHBOARD_AGENT_EXPIRES_AT: Deno.env.get("DASHBOARD_AGENT_EXPIRES_AT") ??
      "",
  };
}
export default {
  fetch: (request: Request) => handleRead(request, { env: environment() }),
};
