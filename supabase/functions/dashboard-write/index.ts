import { handleWrite } from "./handler.ts";
export default {
  fetch(request: Request) {
    return handleWrite(request, {
      env: {
        SUPABASE_URL: Deno.env.get("SUPABASE_URL") ?? "",
        SUPABASE_SERVICE_ROLE_KEY: Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ??
          "",
        DASHBOARD_AGENT_USER_ID: Deno.env.get("DASHBOARD_AGENT_USER_ID") ?? "",
        DASHBOARD_AGENT_WRITE_TOKEN_SHA256:
          Deno.env.get("DASHBOARD_AGENT_WRITE_TOKEN_SHA256") ?? "",
        DASHBOARD_AGENT_WRITE_EXPIRES_AT:
          Deno.env.get("DASHBOARD_AGENT_WRITE_EXPIRES_AT") ?? "",
      },
    });
  },
};
