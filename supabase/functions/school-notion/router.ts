import { authorizeRequest } from "./auth.ts";
import { buildCorsHeaders } from "./cors.ts";
import { normalizeError, SchoolHttpError } from "./errors.ts";
import type {
  HandlerDependencies,
  RouterContext,
  SchoolCommand,
} from "./types.ts";

const allowedMethods = new Set(["OPTIONS", "POST"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeCommand(input: unknown): SchoolCommand {
  if (!isRecord(input) || typeof input.operation !== "string") {
    throw new SchoolHttpError(
      400,
      "INVALID_COMMAND",
      "request body must contain an operation",
    );
  }

  const operation = input.operation.trim();

  if (!operation) {
    throw new SchoolHttpError(
      400,
      "INVALID_COMMAND",
      "request body must contain an operation",
    );
  }

  const command: Record<string, unknown> = { operation };

  for (const [key, value] of Object.entries(input)) {
    if (
      key !== "operation" &&
      key !== "__proto__" &&
      key !== "constructor" &&
      key !== "prototype"
    ) {
      command[key] = value;
    }
  }

  return Object.freeze(command) as SchoolCommand;
}

function withHeaders(response: Response, headers: Headers): Response {
  const responseHeaders = new Headers(response.headers);

  for (const [name, value] of headers) {
    responseHeaders.set(name, value);
  }

  return new Response(response.body, {
    headers: responseHeaders,
    status: response.status,
    statusText: response.statusText,
  });
}

export function routeSchoolCommand(
  _command: SchoolCommand,
  context: RouterContext,
): Promise<Response> {
  return Promise.resolve(
    Response.json(
      {
        ok: false,
        error: "COMMAND_NOT_IMPLEMENTED",
        message: "command is not implemented",
        requestId: context.requestId,
      },
      { status: 501 },
    ),
  );
}

export async function handleRequest(
  request: Request,
  dependencies: HandlerDependencies,
): Promise<Response> {
  const requestId = dependencies.createRequestId?.() ?? crypto.randomUUID();
  let corsHeaders: Headers | undefined;

  try {
    if (!allowedMethods.has(request.method)) {
      throw new SchoolHttpError(
        405,
        "METHOD_NOT_ALLOWED",
        "request method is not allowed",
      );
    }

    corsHeaders = buildCorsHeaders(
      request.headers.get("origin"),
      dependencies.env,
    );

    if (request.method === "OPTIONS") {
      return new Response(null, {
        headers: corsHeaders,
        status: 204,
      });
    }

    const auth = await authorizeRequest(
      request,
      dependencies.env,
      dependencies.createUserClient,
    );

    let body: unknown;

    try {
      body = await request.json();
    } catch {
      throw new SchoolHttpError(
        400,
        "INVALID_JSON",
        "request body must be valid json",
      );
    }

    const command = normalizeCommand(body);
    const router = dependencies.router ?? routeSchoolCommand;
    const response = await router(command, {
      auth,
      requestId,
      userId: auth.userId,
    });

    return withHeaders(response, corsHeaders);
  } catch (error) {
    const response = normalizeError(error, requestId);
    return corsHeaders ? withHeaders(response, corsHeaders) : response;
  }
}
