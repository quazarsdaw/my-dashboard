import { createActiveLessonService } from "./active-lesson-service.ts";
import { authorizeRequest } from "./auth.ts";
import { buildCorsHeaders } from "./cors.ts";
import { normalizeError, SchoolHttpError } from "./errors.ts";
import {
  createActiveLessonRepository,
  createLessonRepository,
} from "./lesson-repository.ts";
import { createLessonService } from "./lesson-service.ts";
import { createSchoolLockService } from "./lock-service.ts";
import { parseSchoolCommand } from "./validation.ts";
import type {
  HandlerDependencies,
  RouterContext,
  SchoolCommand,
  SchoolLockRpcClient,
  SchoolNotionMutationClient,
  SchoolNotionReadClient,
} from "./types.ts";

const allowedMethods = new Set(["OPTIONS", "POST"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireMutationClient(
  client: SchoolNotionReadClient,
): SchoolNotionMutationClient {
  if (
    !("updatePage" in client) ||
    typeof client.updatePage !== "function"
  ) {
    throw new SchoolHttpError(
      500,
      "SERVER_MISCONFIGURED",
      "server configuration is invalid",
    );
  }

  return client as SchoolNotionMutationClient;
}

function createLockRpcClient(value: unknown): SchoolLockRpcClient {
  if (!isRecord(value) || typeof value.rpc !== "function") {
    throw new SchoolHttpError(
      500,
      "SERVER_MISCONFIGURED",
      "server configuration is invalid",
    );
  }

  const rpc = value.rpc;
  return Object.freeze({
    async rpc(
      name: string,
      args: Readonly<Record<string, unknown>>,
    ) {
      const result = await Reflect.apply(rpc, value, [name, args]);
      if (!isRecord(result)) {
        return { data: null, error: true };
      }
      return {
        data: result.data,
        error: result.error,
      };
    },
  });
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
  command: SchoolCommand,
  context: RouterContext,
): Promise<Response> {
  if (!context.notionClient) {
    throw new SchoolHttpError(
      500,
      "SERVER_MISCONFIGURED",
      "server configuration is invalid",
    );
  }

  if (
    command.operation === "getLessonContent" ||
    command.operation === "listLessons"
  ) {
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

  if (
    command.operation !== "startLesson" &&
    command.operation !== "switchActiveLesson" &&
    command.operation !== "resolveActiveLessons" &&
    command.operation !== "reopenLesson"
  ) {
    throw new SchoolHttpError(
      400,
      "INVALID_COMMAND",
      "command operation is not allowed",
    );
  }

  const mutationClient = requireMutationClient(context.notionClient);
  const activeRepository = createActiveLessonRepository(
    mutationClient,
    context.notionDataSourceId,
  );
  const lockService = createSchoolLockService(
    createLockRpcClient(context.auth.supabaseAdmin),
  );
  const activeService = createActiveLessonService(
    activeRepository,
    lockService,
  );

  let operation;
  switch (command.operation) {
    case "startLesson":
      operation = activeService.startLesson(context.userId, command);
      break;
    case "switchActiveLesson":
      operation = activeService.switchActiveLesson(
        context.userId,
        command,
      );
      break;
    case "resolveActiveLessons":
      operation = activeService.resolveActiveLessons(
        context.userId,
        command,
      );
      break;
    case "reopenLesson":
      operation = activeService.reopenLesson(context.userId, command);
      break;
  }

  return operation.then((data) =>
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
