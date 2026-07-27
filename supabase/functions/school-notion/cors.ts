import { SchoolHttpError } from "./errors.ts";
import type { SchoolEnvironment } from "./types.ts";

const developmentOrigin = "http://127.0.0.1:8765";
const allowedHeaders = [
  "authorization",
  "apikey",
  "content-type",
  "x-client-info",
].join(", ");

export function buildCorsHeaders(
  requestOrigin: string | null,
  env: SchoolEnvironment,
): Headers {
  const allowedOrigins = new Set<string>();

  if (env.DASHBOARD_ORIGIN) {
    allowedOrigins.add(env.DASHBOARD_ORIGIN);
  }

  if (env.SCHOOL_ENV === "development") {
    allowedOrigins.add(developmentOrigin);
  }

  if (!requestOrigin || !allowedOrigins.has(requestOrigin)) {
    throw new SchoolHttpError(
      403,
      "ORIGIN_NOT_ALLOWED",
      "request origin is not allowed",
    );
  }

  return new Headers({
    "access-control-allow-headers": allowedHeaders,
    "access-control-allow-methods": "POST, OPTIONS",
    "access-control-allow-origin": requestOrigin,
    "vary": "Origin",
  });
}
