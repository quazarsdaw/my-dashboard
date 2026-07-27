import { authorizeRequest } from "./auth.ts";
import { buildCorsHeaders } from "./cors.ts";
import { normalizeError, SchoolHttpError } from "./errors.ts";
import { createLessonRepository } from "./lesson-repository.ts";
import { createLessonService } from "./lesson-service.ts";
import { parseSchoolCommand } from "./validation.ts";
import type {
  HandlerDependencies,
  RouterContext,
  SchoolCommand,
} from "./types.ts";

const allowedMethods = new Set(["OPTIONS", "POST"]);

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
  command: SchoolCommand,
  context: RouterContext,
): Promise<Response> {
  if (
    command.operation !== "listLessons" &&
    command.operation !== "getLessonContent"
  ) {
    throw new SchoolHttpError(
      400,
      "INVALID_COMMAND",
      "command operation is not allowed",
    );
  }

  if (!context.notionClient) {
    throw new SchoolHttpError(
      500,
      "SERVER_MISCONFIGURED",
      "server configuration is invalid",
    );
  }

  const repository = createLessonRepository(
    context.notionClient,
    context.notionDataSourceId,
  );
  const service = createLessonService(repository, context.notionClient);

  if (command.operation === "getLessonContent") {
    return service.getLessonContent(command.lessonId).then((data) =>
      Response.json({
        data,
        ok: true,
        requestId: context.requestId,
      })
    );
  }

  return service.listLessons(command).then((data) =>
    Response.json({
      data,
      ok: true,
      requestId: context.requestId,
    })
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

    const command = parseSchoolCommand(body);
    const router = dependencies.router ?? routeSchoolCommand;
    const response = await router(command, {
      auth,
      notionDataSourceId: dependencies.env.NOTION_DATA_SOURCE_ID,
      requestId,
      userId: auth.userId,
    });

    return withHeaders(response, corsHeaders);
  } catch (error) {
    const response = normalizeError(error, requestId);
    return corsHeaders ? withHeaders(response, corsHeaders) : response;
  }
}
