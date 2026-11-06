import { parseCommand, readDashboard, ReadError, type Row } from "./data.ts";
export type Environment = {
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
  DASHBOARD_AGENT_USER_ID: string;
  DASHBOARD_AGENT_TOKEN_SHA256: string;
  DASHBOARD_AGENT_EXPIRES_AT: string;
};
type Dependencies = {
  env: Environment;
  now?: () => Date;
  fetch?: typeof fetch;
};
async function boundedJson(
  stream: ReadableStream<Uint8Array> | null,
  max: number,
  code: string,
  status: number,
): Promise<unknown> {
  if (!stream) throw new ReadError(code, status);
  const reader = stream.getReader(), chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      size += next.value.length;
      if (size > max) {
        await reader.cancel();
        throw new ReadError(code, status);
      }
      chunks.push(next.value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.length;
    }
    try {
      return JSON.parse(
        new TextDecoder("utf-8", { fatal: true }).decode(bytes),
      );
    } catch {
      throw new ReadError(code, status);
    }
  } finally {
    reader.releaseLock();
  }
}
function configured(env: Environment): boolean {
  return /^https:\/\/[a-z0-9]{20}\.supabase\.co$/.test(env.SUPABASE_URL) &&
    !!env.SUPABASE_SERVICE_ROLE_KEY &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
      .test(env.DASHBOARD_AGENT_USER_ID) &&
    /^[0-9a-f]{64}$/.test(env.DASHBOARD_AGENT_TOKEN_SHA256) &&
    Number.isFinite(Date.parse(env.DASHBOARD_AGENT_EXPIRES_AT));
}
async function tokenValid(token: string, expected: string): Promise<boolean> {
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) return false;
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(token),
  );
  const actual = Array.from(
    new Uint8Array(digest),
    (x) => x.toString(16).padStart(2, "0"),
  ).join("");
  let difference = 0;
  for (let i = 0; i < 64; i++) {
    difference |= actual.charCodeAt(i) ^ expected.charCodeAt(i);
  }
  return difference === 0;
}
export async function handleRead(
  request: Request,
  deps: Dependencies,
): Promise<Response> {
  const headers = {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
  };
  try {
    if (request.method !== "POST") {
      throw new ReadError("METHOD_NOT_ALLOWED", 405);
    }
    if (request.headers.has("origin")) {
      throw new ReadError("ORIGIN_NOT_ALLOWED", 403);
    }
    const env = deps.env, now = (deps.now ?? (() => new Date()))();
    if (!configured(env)) throw new ReadError("CONNECTOR_NOT_CONFIGURED", 503);
    if (
      Date.parse(env.DASHBOARD_AGENT_EXPIRES_AT) <= now.getTime() ||
      !await tokenValid(
        request.headers.get("x-dashboard-token") ?? "",
        env.DASHBOARD_AGENT_TOKEN_SHA256,
      )
    ) {
      throw new ReadError("UNAUTHORIZED", 401);
    }
    if (
      request.headers.get("content-type")?.split(";")[0].trim()
        .toLowerCase() !== "application/json"
    ) throw new ReadError("INVALID_COMMAND");
    const raw = await boundedJson(
      request.body,
      4096,
      "INVALID_OR_OVERSIZED_REQUEST",
      413,
    );
    const command = parseCommand(raw, now);
    const url = new URL(env.SUPABASE_URL + "/rest/v1/user_data");
    url.searchParams.set("select", "key,value,updated_at");
    url.searchParams.set("user_id", "eq." + env.DASHBOARD_AGENT_USER_ID);
    url.searchParams.set(
      "key",
      "in.(" + command.keys.map((k) => '"' + k + '"').join(",") + ")",
    );
    url.searchParams.set("limit", String(command.keys.length + 1));
    const upstream = await (deps.fetch ?? fetch)(url, {
      method: "GET",
      redirect: "error",
      signal: AbortSignal.timeout(10000),
      headers: {
        apikey: env.SUPABASE_SERVICE_ROLE_KEY,
        authorization: "Bearer " + env.SUPABASE_SERVICE_ROLE_KEY,
        accept: "application/json",
        prefer: "count=exact",
      },
    });
    if (!upstream.ok) {
      await upstream.body?.cancel();
      throw new ReadError("DASHBOARD_UNAVAILABLE", 502);
    }
    const rows = await boundedJson(
      upstream.body,
      4 * 1024 * 1024,
      "DASHBOARD_UNAVAILABLE",
      502,
    );
    const range = /^(?:\d+-\d+|\*)\/(\d+)$/.exec(
      upstream.headers.get("content-range") ?? "",
    );
    if (!Array.isArray(rows) || !range || Number(range[1]) !== rows.length) {
      throw new ReadError("DASHBOARD_UNAVAILABLE", 502);
    }
    const result = readDashboard(command, rows as Row[], now),
      output = JSON.stringify(result);
    if (new TextEncoder().encode(output).length > 1024 * 1024) {
      throw new ReadError("RESPONSE_TOO_LARGE", 502);
    }
    return new Response(output, { status: 200, headers });
  } catch (error) {
    const known = error instanceof ReadError;
    return new Response(
      JSON.stringify({ error: known ? error.code : "DASHBOARD_UNAVAILABLE" }),
      { status: known ? error.status : 502, headers },
    );
  }
}
