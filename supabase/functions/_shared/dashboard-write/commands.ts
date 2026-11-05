import {
  type DataRecord,
  difficulties,
  horizons,
  invalid,
  type Mutation,
  type Operation,
  priorities,
  record,
  type ResolvedMutation,
  revision,
  uuid4,
  validDate,
  validPeriod,
} from "./contracts.ts";

type Schema = {
  type?: "object" | "string" | "integer" | "array";
  properties?: Record<string, Schema>;
  required?: string[];
  additionalProperties?: false;
  minProperties?: number;
  oneOf?: Schema[];
  enum?: readonly string[];
  format?: "date" | "revision";
  pattern?: string;
  minLength?: number;
  maxLength?: number;
  minimum?: number;
  maximum?: number;
  minItems?: number;
  maxItems?: number;
  items?: Schema;
};
const obj = (
  properties: Record<string, Schema>,
  required: string[] = [],
): Schema => ({
  type: "object",
  properties,
  required,
  additionalProperties: false,
});
const str = (maxLength: number, minLength = 0): Schema => ({
  type: "string",
  minLength,
  maxLength,
});
const int = (
  minimum = Number.MIN_SAFE_INTEGER,
  maximum = Number.MAX_SAFE_INTEGER,
): Schema => ({
  type: "integer",
  minimum,
  maximum,
});
const arr = (items: Schema): Schema => ({
  type: "array",
  items,
  minItems: 1,
  maxItems: 100,
});
const enumeration = (values: readonly string[]): Schema => ({
  type: "string",
  enum: values,
});
const day: Schema = { type: "string", format: "date" };
const rev: Schema = {
  type: "string",
  format: "revision",
  pattern: "^(0|[1-9][0-9]{0,18})$",
};
const identity = str(200, 1);
const target = (referencePattern: string, byDate = false): Schema => {
  const keys = byDate ? { date: day } : {};
  const common = byDate ? ["expectedRevision", "date"] : ["expectedRevision"];
  return {
    oneOf: [
      obj(
        { ...keys, expectedRevision: rev, id: identity } as Record<
          string,
          Schema
        >,
        [...common, "id"],
      ),
      obj(
        {
          ...keys,
          expectedRevision: rev,
          reference: { ...identity, pattern: referencePattern },
        } as Record<string, Schema>,
        [...common, "reference"],
      ),
    ],
  };
};
const taskTarget = target("^\\d{4}-\\d{2}-\\d{2}:(0|[1-9]\\d{0,3})$", true);
const goalTarget = target("^goal:(0|[1-9]\\d{0,3})$");
const inboxTarget = obj({ id: identity, expectedRevision: rev }, [
  "id",
  "expectedRevision",
]);
const taskFields = {
  text: str(500, 1),
  description: str(10000),
  estimatedMin: int(1, 1440),
  sphere: str(200),
  difficulty: enumeration(difficulties),
};
const subtask = obj({ text: str(500, 1) }, ["text"]);
const goalFields = {
  title: str(200, 1),
  priority: enumeration(priorities),
  target: int(),
  unit: str(100),
};
const period = { horizon: enumeration(horizons), periodKey: str(12, 1) };
export const commandSchemas: Record<Operation, Schema> = {
  create_task: obj({
    ...taskFields,
    date: day,
    subtasks: { ...arr(subtask), minItems: 0 },
  }, ["text"]),
  update_task: obj({
    target: taskTarget,
    patch: { ...obj(taskFields), minProperties: 1 },
    subtaskEdits: arr(
      obj({ index: int(0, 99), text: str(500, 1) }, ["index", "text"]),
    ),
    appendSubtasks: arr(subtask),
  }, ["target"]),
  move_task: obj({ target: taskTarget, toDate: day }, ["target", "toDate"]),
  create_goal: obj({
    ...goalFields,
    ...period,
    type: enumeration(["check", "number"]),
    current: int(),
  }, ["title", "horizon", "periodKey", "type"]),
  update_goal: obj({
    target: goalTarget,
    patch: { ...obj(goalFields), minProperties: 1 },
  }, ["target", "patch"]),
  move_goal: obj({
    target: goalTarget,
    toHorizon: period.horizon,
    toPeriodKey: period.periodKey,
    priority: goalFields.priority,
  }, ["target", "toHorizon", "toPeriodKey"]),
  set_goal_progress: obj({ target: goalTarget, current: int() }, [
    "target",
    "current",
  ]),
  complete_goal: obj({ target: goalTarget }, ["target"]),
  reopen_goal: obj({ target: goalTarget, current: int() }, ["target"]),
  route_inbox_to_task: obj({
    target: inboxTarget,
    date: { oneOf: [day, enumeration(["backlog"])] },
  }, ["target", "date"]),
  route_inbox_to_goal: obj({ target: inboxTarget, ...period }, [
    "target",
    "horizon",
    "periodKey",
  ]),
};

function matches(schema: Schema, value: unknown): boolean {
  if (schema.oneOf) {
    return schema.oneOf.filter((s) => matches(s, value)).length === 1;
  }
  if (schema.type === "object") {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return false;
    }
    const fields = schema.properties!,
      r = value as DataRecord,
      keys = Object.keys(r);
    return keys.length >= (schema.minProperties ?? 0) &&
      (schema.required ?? []).every((k) => Object.hasOwn(r, k)) &&
      keys.every((k) => Object.hasOwn(fields, k) && matches(fields[k], r[k]));
  }
  if (schema.type === "array") {
    return Array.isArray(value) && value.length >= (schema.minItems ?? 0) &&
      value.length <= schema.maxItems! && value.every((v) =>
        matches(schema.items!, v)
      );
  }
  if (schema.type === "integer") {
    return typeof value === "number" && Number.isSafeInteger(value) &&
      value >= schema.minimum! && value <= schema.maximum!;
  }
  if (
    typeof value !== "string" || value.includes("\0") ||
    (schema.pattern && !new RegExp(schema.pattern).test(value)) ||
    (schema.enum && !schema.enum.includes(value))
  ) return false;
  if (schema.format === "date") return validDate(value);
  if (schema.format === "revision") return revision(value);
  return [...value.trim()].length >= (schema.minLength ?? 0) &&
    [...value].length <= (schema.maxLength ?? Infinity);
}

export function parseMutation(operation: unknown, args: unknown): Mutation {
  if (
    typeof operation !== "string" ||
    !Object.hasOwn(commandSchemas, operation) ||
    !matches(commandSchemas[operation as Operation], args)
  ) invalid();
  const r = record(args);
  if (
    (operation === "update_task" && !r.patch && !r.subtaskEdits &&
      !r.appendSubtasks) ||
    ((operation === "create_goal" || operation === "route_inbox_to_goal") &&
      !validPeriod(r.horizon, r.periodKey)) ||
    (operation === "move_goal" && !validPeriod(r.toHorizon, r.toPeriodKey)) ||
    (operation === "create_goal" && r.type === "check" &&
      (r.current !== undefined || r.target !== undefined ||
        r.unit !== undefined))
  ) invalid();
  return { operation, arguments: structuredClone(r) } as Mutation;
}

export function canonical(value: unknown): string {
  if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
  if (value && typeof value === "object") {
    return "{" + Object.entries(value).sort(([a], [b]) =>
      a < b ? -1 : a > b ? 1 : 0
    )
      .map(([k, v]) => JSON.stringify(k) + ":" + canonical(v)).join(",") +
      "}";
  }
  return JSON.stringify(value);
}
export async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(text),
  );
  return Array.from(
    new Uint8Array(digest),
    (x) => x.toString(16).padStart(2, "0"),
  ).join("");
}
export function fingerprintMutation(command: Mutation): Promise<string> {
  return sha256(canonical(command));
}
export function resolveMutation(command: Mutation, env: {
  now: Date;
  newUuid: () => string;
}): ResolvedMutation {
  const targetId = env.newUuid();
  if (!uuid4.test(targetId) || !Number.isFinite(env.now.getTime())) invalid();
  const effectiveDate = command.operation === "create_task"
    ? command.arguments.date ??
      new Date(env.now.getTime() - 3600000).toISOString().slice(0, 10)
    : command.operation === "route_inbox_to_task"
    ? command.arguments.date
    : null;
  return {
    ...structuredClone(command),
    context: { effectiveDate, targetId, createdAt: env.now.toISOString() },
  };
}
