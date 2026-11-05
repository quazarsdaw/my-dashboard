import {
  canonical,
  commandSchemas,
  fingerprintMutation,
  parseMutation,
  resolveMutation,
} from "../_shared/dashboard-write/commands.ts";
import {
  type DataRecord,
  type Dependency,
  invalid,
  type Operation,
  type Prepared,
  type PrepareOutcome,
  type Receipt,
  record,
  revision,
  SPHERES_KEY,
  uuid4,
  WriteError,
} from "../_shared/dashboard-write/contracts.ts";
import {
  applyMutation,
  editOptions,
  requiredKeys,
} from "../_shared/dashboard-write/documents.ts";
import {
  boundedPreview,
  renderPreview,
} from "../_shared/dashboard-write/preview.ts";
import { closed, unavailable } from "./errors.ts";
import { type Repository } from "./repository.ts";

export const routes = [
  "prepare",
  "commit",
  "status",
  "cancel",
  "options",
] as const;
export type Route = typeof routes[number];
function id(value: unknown): string {
  if (typeof value !== "string" || !uuid4.test(value)) invalid();
  return value.toLowerCase();
}
function responseRecord(value: unknown): DataRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    unavailable();
  }
  return value as DataRecord;
}
function returnedId(value: unknown): string {
  if (typeof value !== "string" || !uuid4.test(value)) unavailable();
  return value;
}
function timestamp(value: unknown): string {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) {
    unavailable();
  }
  return new Date(value).toISOString();
}
function location(value: unknown): DataRecord {
  const out = responseRecord(value);
  return Object.fromEntries(
    Object.entries(out).filter(([key, value]) =>
      ["date", "horizon", "periodKey"].includes(key) &&
      typeof value === "string" && value.length <= 20
    ),
  );
}
function receipt(
  value: unknown,
  requestId: string,
  draftId?: string,
): Receipt & { location: DataRecord } {
  const raw = responseRecord(value), draft = returnedId(raw.draftId);
  if (
    raw.requestId !== requestId ||
    (draftId !== undefined && draft !== draftId) ||
    raw.outcome !== "committed" || typeof raw.operation !== "string" ||
    !Object.hasOwn(commandSchemas, raw.operation) ||
    typeof raw.targetId !== "string" ||
    !raw.targetId || raw.targetId.length > 400
  ) unavailable();
  const versions = responseRecord(raw.versions);
  if (
    Object.keys(versions).length < 1 || Object.keys(versions).length > 2 ||
    Object.entries(versions).some(([key, value]) =>
      !/^(inbox_v1|backlog_tasks_v1|horizons_goals_v2|goals:\d{4}-\d{2}-\d{2})$/
        .test(key) || !revision(value) || value === "0"
    )
  ) unavailable();
  return {
    requestId,
    draftId: draft,
    outcome: "committed",
    operation: raw.operation as Operation,
    targetId: raw.targetId,
    versions: versions as Record<string, string>,
    committedAt: timestamp(raw.committedAt),
    location: location(raw.location),
  };
}
function prepared(
  value: unknown,
  requestId: string,
  draftId?: string,
): Prepared {
  const raw = responseRecord(value), draft = returnedId(raw.draftId);
  if (
    raw.requestId !== requestId ||
    (draftId !== undefined && draft !== draftId) ||
    typeof raw.previewText !== "string" || !raw.previewText ||
    raw.previewText.length > 2500
  ) unavailable();
  return {
    requestId,
    draftId: draft,
    expiresAt: timestamp(raw.expiresAt),
    previewText: raw.previewText,
  };
}
function prepareOutcome(raw: DataRecord, requestId: string): PrepareOutcome {
  if (raw.state === "prepared") {
    return { state: "prepared", draft: prepared(raw.draft, requestId) };
  }
  if (raw.state === "committed") {
    return { state: "committed", receipt: receipt(raw.receipt, requestId) };
  }
  unavailable();
}
function statusOutcome(
  raw: DataRecord,
  requestId: string,
  draftId?: string,
): DataRecord {
  if (
    raw.requestId !== requestId ||
    (draftId !== undefined && raw.draftId !== draftId)
  ) unavailable();
  const common = {
    requestId,
    draftId: returnedId(raw.draftId),
    state: raw.state,
  };
  if (raw.state === "committed") {
    if (raw.receipt_expired === true) {
      const former = receipt(
        { ...raw, outcome: "committed", location: {} },
        requestId,
        draftId,
      );
      return {
        ...common,
        receipt_expired: true,
        operation: former.operation,
        targetId: former.targetId,
        versions: former.versions,
        committedAt: former.committedAt,
      };
    }
    return {
      ...common,
      receipt: receipt(raw.receipt, requestId, common.draftId),
    };
  }
  if (raw.state === "prepared") {
    return { ...common, expiresAt: timestamp(raw.expiresAt) };
  }
  if (
    raw.state === "cancelled" || raw.state === "expired" ||
    raw.state === "conflicted"
  ) return common;
  unavailable();
}

export async function runWrite(
  route: Route,
  input: unknown,
  repository: Repository,
  env: { now: Date; newUuid: () => string; expiresAt: string },
): Promise<unknown> {
  if (route === "options") {
    closed(input, []);
    if ((await repository.status(null)).state !== "enabled") unavailable();
    return editOptions((await repository.read([SPHERES_KEY]))[0]);
  }
  if (route === "prepare") {
    const body = closed(input, ["requestId", "operation", "arguments"]);
    const requestId = id(body.requestId);
    const command = parseMutation(body.operation, body.arguments);
    const fingerprint = await fingerprintMutation(command);
    try {
      return prepareOutcome(
        await repository.prepare(requestId, fingerprint, null),
        requestId,
      );
    } catch (error) {
      if (!(error instanceof WriteError && error.code === "request_unknown")) {
        throw error;
      }
    }
    const resolved = resolveMutation(command, env);
    const effect = await applyMutation(
      resolved,
      await repository.read(requiredKeys(resolved)),
    );
    const payload = {
      resolved,
      previewText: renderPreview(effect),
      dependencies: effect.dependencies,
      afterHashes: effect.afterHashes,
      targetId: effect.targetId,
      changedFields: effect.changedFields,
      location: location(effect.after),
      credentialExpiresAt: env.expiresAt,
    };
    return prepareOutcome(
      await repository.prepare(requestId, fingerprint, payload),
      requestId,
    );
  }
  if (route === "status") {
    const requestId = id(closed(input, ["requestId"]).requestId);
    return statusOutcome(await repository.status(requestId), requestId);
  }
  const body = closed(input, ["requestId", "draftId"]);
  const requestId = id(body.requestId), draftId = id(body.draftId);
  if (route === "cancel") {
    return statusOutcome(
      await repository.cancel(requestId, draftId),
      requestId,
      draftId,
    );
  }
  const loaded = await repository.load(requestId, draftId);
  if (loaded.state === "committed") {
    return receipt(loaded.receipt, requestId, draftId);
  }
  if (loaded.state !== "prepared") unavailable();
  const saved = prepared(loaded.draft, requestId, draftId);
  boundedPreview(saved.previewText);
  const payload = responseRecord(loaded.payload),
    stored = responseRecord(payload.resolved);
  const context = responseRecord(stored.context);
  const resolved = resolveMutation(
    parseMutation(stored.operation, stored.arguments),
    {
      now: new Date(timestamp(context.createdAt)),
      newUuid: () => returnedId(context.targetId),
    },
  );
  if (canonical(resolved.context) !== canonical(context)) unavailable();
  const keys = requiredKeys(resolved), rows = await repository.read(keys);
  if (
    !Array.isArray(payload.dependencies) ||
    payload.dependencies.length !== keys.length
  ) unavailable();
  const dependencies = payload.dependencies.map(record) as Dependency[];
  if (
    new Set(dependencies.map((d) => d.key)).size !== keys.length ||
    dependencies.some((d) =>
      !keys.includes(d.key) || !revision(d.expectedRevision)
    )
  ) unavailable();
  if (
    rows.some((row) =>
      dependencies.find((d) => d.key === row.key)?.expectedRevision !==
        row.revision
    )
  ) {
    // Состояние конфликта фиксирует БД под теми же блокировками; пустой пакет не может записать данные.
    return receipt(
      await repository.commit(requestId, draftId, []),
      requestId,
      draftId,
    );
  }
  const effect = await applyMutation(resolved, rows);
  if (
    canonical(effect.afterHashes) !== canonical(payload.afterHashes) ||
    effect.targetId !== payload.targetId
  ) unavailable();
  return receipt(
    await repository.commit(requestId, draftId, effect.changes),
    requestId,
    draftId,
  );
}
