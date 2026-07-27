import { createSupabaseContext } from "@supabase/server";
import { createSchoolNotionMutationClient } from "./notion-client.ts";
import { handleRequest, routeSchoolCommand } from "./router.ts";
import type { SchoolEnvironment } from "./types.ts";

function readEnvironment(): SchoolEnvironment {
  return {
    DASHBOARD_ORIGIN: Deno.env.get("DASHBOARD_ORIGIN") ?? "",
    NOTION_DATA_SOURCE_ID: Deno.env.get("NOTION_DATA_SOURCE_ID") ?? "",
    NOTION_TOKEN: Deno.env.get("NOTION_TOKEN") ?? "",
    SCHOOL_ENV: Deno.env.get("SCHOOL_ENV"),
    SCHOOL_OWNER_USER_ID: Deno.env.get("SCHOOL_OWNER_USER_ID") ?? "",
  };
}

export default {
  fetch(request: Request): Promise<Response> {
    const env = readEnvironment();

    return handleRequest(request, {
      createUserClient: (userRequest, options) =>
        createSupabaseContext(userRequest, options),
      env,
      router: (command, context) =>
        routeSchoolCommand(command, {
          ...context,
          notionClient: createSchoolNotionMutationClient(env),
        }),
    });
  },
};
