export class SchoolHttpError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(
    status: number,
    code: string,
    message: string,
  ) {
    super(message);
    this.name = "SchoolHttpError";
    this.status = status;
    this.code = code;
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

  return Response.json(
    {
      ok: false,
      error: normalized.code,
      message: normalized.message,
      requestId,
    },
    { status: normalized.status },
  );
}
