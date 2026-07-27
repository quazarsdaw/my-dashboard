import { authorizeRequest } from "./auth.ts";
import { buildCorsHeaders } from "./cors.ts";
import { normalizeError, SchoolHttpError } from "./errors.ts";
import { createLessonRepository } from "./lesson-repository.ts";
import { createLessonService } from "./lesson-service.ts";
import type {
  HandlerDependencies,
  ListLessonsCommand,
  RouterContext,
  SchoolCommand,
} from "./types.ts";

const allowedMethods = new Set(["OPTIONS", "POST"]);
const activeWeek = Object.freeze({
  endDate: "2026-08-09",
  notionValue: "W01 · 3–9 августа 2026",
  startDate: "2026-08-03",
});

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
  command: SchoolCommand,
  context: RouterContext,
): Promise<Response> {
  if (command.operation !== "listLessons") {
    throw new SchoolHttpError(
      400,
      "INVALID_COMMAND",
      "command operation is not allowed",
    );
  }

  const validated = validateListLessonsCommand(command);
  if (!context.notionClient) {
    throw new SchoolHttpError(
      500,
      "SERVER_MISCONFIGURED",
      "server configuration is invalid",
    );
  }

  const repository = createLessonRepository(context.notionClient);
  const service = createLessonService(repository);

  return service.listLessons(validated).then((data) =>
    Response.json({
      data,
      ok: true,
      requestId: context.requestId,
    })
  );
}

function isIsoDate(value: unknown): value is string {
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}$/.test(value)
  ) {
    return false;
  }

  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) &&
    parsed.toISOString().slice(0, 10) === value;
}

function invalidCommand(): never {
  throw new SchoolHttpError(
    400,
    "INVALID_COMMAND",
    "listLessons command is invalid",
  );
}

function validateListLessonsCommand(
  command: SchoolCommand,
): ListLessonsCommand {
  const keys = Object.keys(command).sort();
  const weekShape = keys.length === 2 &&
    keys[0] === "operation" &&
    keys[1] === "week";
  const rangeShape = keys.length === 3 &&
    keys[0] === "from" &&
    keys[1] === "operation" &&
    keys[2] === "to";

  if (weekShape) {
    if (command.week !== activeWeek.notionValue) {
      return invalidCommand();
    }

    return {
      operation: "listLessons",
      week: activeWeek.notionValue,
    };
  }

  if (
    !rangeShape ||
    !isIsoDate(command.from) ||
    !isIsoDate(command.to) ||
    command.from < activeWeek.startDate ||
    command.to > activeWeek.endDate ||
    command.from > command.to
  ) {
    return invalidCommand();
  }

  return {
    from: command.from,
    operation: "listLessons",
    to: command.to,
  };
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
