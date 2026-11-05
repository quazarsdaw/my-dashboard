import { invalid, WriteError } from "../_shared/dashboard-write/contracts.ts";
import { authorize, type Environment } from "./auth.ts";
import { boundedJson } from "./errors.ts";
import { Repository } from "./repository.ts";
import { type Route, routes, runWrite } from "./service.ts";

export async function handleWrite(request: Request, dependencies: {
  env: Environment;
  fetch?: typeof fetch;
  now?: () => Date;
  newUuid?: () => string;
}): Promise<Response> {
  const headers = {
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
  };
  try {
    if (request.method !== "POST") {
      throw new WriteError("method_not_allowed", 405);
    }
    if (request.headers.has("origin")) {
      throw new WriteError("origin_not_allowed", 403);
    }
    const url = new URL(request.url);
    const pathname = /^(?:\/functions\/v1)?\/dashboard-write\/([a-z]+)$/.exec(
      url.pathname,
    );
    if (
      url.search || url.hash || !pathname ||
      !routes.includes(pathname[1] as Route)
    ) {
      throw new WriteError("route_not_found", 404);
    }
    const now = (dependencies.now ?? (() => new Date()))();
    const access = await authorize(request, dependencies.env, now);
    if (
      request.headers.get("content-type")?.split(";")[0].trim()
        .toLowerCase() !== "application/json"
    ) invalid();
    const body = await boundedJson(
      request.body,
      32768,
      new WriteError("invalid_change", 422),
      new WriteError("request_too_large", 413),
    );
    const data = await runWrite(
      pathname[1] as Route,
      body,
      new Repository(access, dependencies.fetch ?? fetch),
      {
        now,
        newUuid: dependencies.newUuid ?? (() => crypto.randomUUID()),
        expiresAt: access.expiresAt,
      },
    );
    return Response.json(data, { headers });
  } catch (error) {
    const known = error instanceof WriteError;
    return Response.json(
      { error: known ? error.code : "upstream_unavailable" },
      { status: known ? error.status : 502, headers },
    );
  }
}
