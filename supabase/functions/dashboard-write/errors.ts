import {
  type DataRecord,
  invalid,
  record,
  WriteError,
} from "../_shared/dashboard-write/contracts.ts";

const known = {
  unauthorized_or_expired: 401,
  write_disabled: 403,
  request_unknown: 404,
  request_mismatch: 409,
  conflict: 409,
  request_retired: 410,
  draft_expired: 410,
  draft_cancelled: 410,
  invalid_change: 422,
  rate_limited: 429,
} as const;
export function unavailable(): never {
  throw new WriteError("upstream_unavailable", 502);
}
export function closed(value: unknown, keys: string[]): DataRecord {
  const body = record(value);
  if (
    Object.keys(body).length !== keys.length ||
    keys.some((k) => !Object.hasOwn(body, k))
  ) invalid();
  return body;
}
export function rpcData(value: unknown): DataRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    unavailable();
  }
  const envelope = value as DataRecord;
  if (
    envelope.ok === true && envelope.data &&
    typeof envelope.data === "object" && !Array.isArray(envelope.data)
  ) {
    return envelope.data as DataRecord;
  }
  const error = envelope.error as DataRecord | null;
  if (
    envelope.ok === false && error && typeof error.code === "string" &&
    Object.hasOwn(known, error.code) &&
    known[error.code as keyof typeof known] === error.status
  ) {
    throw new WriteError(error.code, error.status as number);
  }
  unavailable();
}

export async function boundedJson(
  stream: ReadableStream<Uint8Array> | null,
  maximum: number,
  invalidBody: WriteError,
  tooLarge: WriteError,
): Promise<unknown> {
  if (!stream) throw invalidBody;
  const reader = stream.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  const parts: string[] = [];
  let size = 0;
  try {
    for (;;) {
      const next = await reader.read();
      if (next.done) break;
      size += next.value.length;
      if (size > maximum) {
        void reader.cancel().catch(() => {});
        throw tooLarge;
      }
      parts.push(decoder.decode(next.value, { stream: true }));
    }
    parts.push(decoder.decode());
    return JSON.parse(parts.join(""));
  } catch (error) {
    if (error instanceof WriteError) throw error;
    void reader.cancel().catch(() => {});
    throw invalidBody;
  } finally {
    reader.releaseLock();
  }
}
