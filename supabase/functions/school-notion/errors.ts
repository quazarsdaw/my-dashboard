export class SchoolHttpError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: Readonly<Record<string, unknown>>;

  constructor(
    status: number,
    code: string,
    message: string,
    details?: Readonly<Record<string, unknown>>,
  ) {
    super(message);
    this.name = "SchoolHttpError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export function normalizeError(error: unknown, requestId: string): Response {
  const normalized = error instanceof SchoolHttpError
    ? error
    : new SchoolHttpError(
      500,
      "INTERNAL_ERROR",
      "an internal error occurred",
    );

  const safeDetails = Object.fromEntries(
    Object.entries(normalized.details ?? {}).filter(([name]) =>
      name !== "error" &&
      name !== "message" &&
      name !== "ok" &&
      name !== "requestId"
    ),
  );

  return Response.json(
    {
      ok: false,
      error: normalized.code,
      message: normalized.message,
      requestId,
      ...safeDetails,
    },
    { status: normalized.status },
  );
}
