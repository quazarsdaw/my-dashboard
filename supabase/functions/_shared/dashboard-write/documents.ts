import {
  type Change,
  conflict,
  type DataRecord,
  type Dependency,
  GOALS_KEY,
  INBOX_KEY,
  invalid,
  MAX_DOCUMENT_BYTES,
  type MutationEffect,
  record,
  type ResolvedMutation,
  revision,
  type Snapshot,
  SPHERES_KEY,
  type Target,
  taskKey,
  validDate,
  WriteError,
} from "./contracts.ts";
import { canonical, sha256 } from "./commands.ts";
import {
  asRecords,
  asText,
  checkTask,
  makeTask,
  patchTask,
  taskProjection,
} from "./tasks.ts";
import { checkGoal, endOrder, goalProjection, makeGoal } from "./goals.ts";

const encoder = new TextEncoder();
// Compare decimal values instead of relying on binary float round-trip precision.
function decimal(value: string): string {
  const [mantissa, exponent = "0"] = value.toLowerCase().split("e");
  if (exponent.length > 8) invalid();
  const [whole, fraction = ""] = mantissa.split(".");
  const negative = whole.startsWith("-");
  let digits = (whole.replace("-", "") + fraction).replace(/^0+/, "");
  if (!digits) return negative ? "-0" : "0";
  const stripped = digits.replace(/0+$/, "");
  const scale = Number(exponent) - fraction.length + digits.length -
    stripped.length;
  digits = stripped;
  return (negative ? "-" : "") + digits + "e" + scale;
}
function fromText(value: string | null, fallback: unknown): unknown {
  if (value === null) return fallback;
  if (encoder.encode(value).length > MAX_DOCUMENT_BYTES) invalid();
  try {
    const parse = JSON.parse as (
      text: string,
      reviver: (
        key: string,
        val: unknown,
        context?: { source?: string },
      ) => unknown,
    ) => unknown;
    return parse(value, (_key, v, context) => {
      if (typeof v === "number") {
        if (
          !Number.isFinite(v) ||
          (Number.isInteger(v) && !Number.isSafeInteger(v)) ||
          !context?.source ||
          decimal(context.source) !== decimal(JSON.stringify(v))
        ) invalid();
      }
      return v;
    });
  } catch {
    invalid();
  }
}

export function validateSnapshot(value: unknown): Snapshot {
  const r = record(value);
  if (
    typeof r.key !== "string" || typeof r.exists !== "boolean" ||
    !revision(r.revision) ||
    (r.valueText !== null && typeof r.valueText !== "string") ||
    (r.updatedAt !== null &&
      (typeof r.updatedAt !== "string" ||
        !Number.isFinite(Date.parse(r.updatedAt)))) ||
    (r.exists
      ? r.revision === "0"
      : r.revision !== "0" || r.valueText !== null || r.updatedAt !== null)
  ) throw new WriteError("upstream_unavailable", 502);
  return r as Snapshot;
}
export function requiredKeys(command: ResolvedMutation): string[] {
  switch (command.operation) {
    case "create_task":
      return [
        taskKey(command.context.effectiveDate!),
        ...(command.arguments.sphere ? [SPHERES_KEY] : []),
      ];
    case "update_task":
      return [
        taskKey(command.arguments.target.date),
        ...(command.arguments.patch?.sphere ? [SPHERES_KEY] : []),
      ];
    case "move_task":
      return [
        ...new Set([
          taskKey(command.arguments.target.date),
          taskKey(command.arguments.toDate),
        ]),
      ];
    case "route_inbox_to_task":
      return [INBOX_KEY, taskKey(command.context.effectiveDate!)];
    case "route_inbox_to_goal":
      return [INBOX_KEY, GOALS_KEY];
    default:
      return [GOALS_KEY];
  }
}

const defaultSpheres = [
  { id: "health", name: "Здоровье", icon: "🏃" },
  { id: "career", name: "Карьера", icon: "💼" },
  { id: "finance", name: "Финансы", icon: "💰" },
  { id: "relations", name: "Отношения", icon: "💛" },
  { id: "growth", name: "Саморазвитие", icon: "📚" },
  { id: "hobbies", name: "Хобби", icon: "🎮" },
];
export function editOptions(row: Snapshot) {
  const values = asRecords(fromText(row.valueText, []), 200);
  const seen = new Set<string>();
  const spheres = (values.length ? values : defaultSpheres).map((s) => {
    const id = asText(s.id, 200, true);
    if (seen.has(id)) invalid();
    seen.add(id);
    return { id, name: asText(s.name, 200, true), icon: asText(s.icon, 32) };
  });
  return {
    spheres,
    noSphere: "",
    priorities: ["p1", "p2", "p3", "p4"],
    difficulties: ["easy", "medium", "hard"],
    goalTypes: ["check", "number"],
  };
}
function select(rows: DataRecord[], target: Target, prefix: string): number {
  if ("id" in target) {
    const matches = rows.flatMap((row, index) =>
      row.id === target.id ? [index] : []
    );
    if (matches.length !== 1) invalid();
    return matches[0];
  }
  if (!target.reference.startsWith(prefix)) invalid();
  const index = Number(target.reference.slice(prefix.length));
  if (!Number.isSafeInteger(index) || !rows[index] || rows[index].id != null) {
    invalid();
  }
  return index;
}
function unusedId(rows: DataRecord[], id: unknown, except?: number): string {
  const verified = asText(id, 200, true);
  if (rows.some((row, index) => index !== except && row.id === verified)) {
    invalid();
  }
  return verified;
}

export async function applyMutation(
  command: ResolvedMutation,
  snapshots: Snapshot[],
): Promise<MutationEffect> {
  const changes: Change[] = [],
    dependencies: Dependency[] = [],
    warnings: string[] = [];
  const byKey = new Map(
    snapshots.map((snapshot) => [snapshot.key, validateSnapshot(snapshot)]),
  );
  const required = requiredKeys(command);
  if (
    byKey.size !== snapshots.length || required.some((key) => !byKey.has(key))
  ) {
    throw new WriteError("upstream_unavailable", 502);
  }
  for (const key of required) {
    dependencies.push({ key, expectedRevision: byKey.get(key)!.revision });
  }
  const read = (key: string, fallback: unknown, expected?: string) => {
    const row = byKey.get(key)!;
    if (expected !== undefined && row.revision !== expected) conflict();
    return fromText(row.valueText, fallback);
  };
  const write = (key: string, value: unknown) => {
    const valueText = canonical(value);
    if (encoder.encode(valueText).length > MAX_DOCUMENT_BYTES) invalid();
    changes.push({
      key,
      expectedRevision: byKey.get(key)!.revision,
      valueText,
    });
  };
  function checkSphere(sphere: string | undefined) {
    if (
      sphere &&
      !editOptions(byKey.get(SPHERES_KEY)!).spheres.some((s) => s.id === sphere)
    ) invalid();
  }
  const ctx = command.context;
  let before: DataRecord | null = null,
    after: DataRecord,
    targetId = ctx.targetId;
  let inboxText: string | undefined;
  if (
    command.operation === "route_inbox_to_task" ||
    command.operation === "route_inbox_to_goal"
  ) {
    const t = command.arguments.target;
    const rows = asRecords(read(INBOX_KEY, [], t.expectedRevision));
    const index = select(rows, t, "inbox:");
    inboxText = asText(
      rows[index].text,
      command.operation === "route_inbox_to_task" ? 500 : 200,
      true,
    );
    before = {
      text: inboxText,
      date: rows[index].date ?? null,
      source: "inbox",
    };
    write(INBOX_KEY, rows.filter((_row, i) => i !== index));
  }

  if (
    command.operation === "create_task" ||
    command.operation === "route_inbox_to_task"
  ) {
    const day = ctx.effectiveDate!;
    if (
      !validDate(day) &&
      !(command.operation === "route_inbox_to_task" && day === "backlog")
    ) invalid();
    const key = taskKey(day), rows = asRecords(read(key, []));
    unusedId(rows, targetId);
    const fields = command.operation === "create_task"
      ? { ...command.arguments, text: command.arguments.text.trim() }
      : { text: inboxText! };
    checkSphere("sphere" in fields ? fields.sphere : undefined);
    const value = makeTask(fields, targetId, ctx.createdAt);
    const projected = taskProjection(value);
    if (
      rows.some((row) =>
        row.text === value.text &&
        canonical(taskProjection(row)) === canonical(projected)
      )
    ) {
      warnings.push("duplicate_creation");
    }
    after = { ...projected, date: day };
    write(key, [...rows, value]);
  } else if (
    command.operation === "update_task" || command.operation === "move_task"
  ) {
    const input = command.arguments,
      day = input.target.date,
      key = taskKey(day);
    const rows = asRecords(read(key, [], input.target.expectedRevision));
    const index = select(rows, input.target, day + ":"), original = rows[index];
    checkTask(original);
    before = { ...taskProjection(original), date: day };
    targetId = unusedId(rows, original.id ?? ctx.targetId, index);
    if (command.operation === "update_task") {
      checkSphere(command.arguments.patch?.sphere);
      const value = { ...patchTask(original, command.arguments), id: targetId };
      rows[index] = value;
      write(key, rows);
      after = { ...taskProjection(value), date: day };
    } else {
      const next = command.arguments.toDate;
      if (next === day) invalid();
      const destinationKey = taskKey(next),
        destination = asRecords(read(destinationKey, []));
      unusedId(destination, targetId);
      write(key, rows.filter((_row, i) => i !== index));
      write(destinationKey, [...destination, { ...original, id: targetId }]);
      after = { ...taskProjection(original), date: next };
    }
  } else {
    const input = command.arguments;
    const sourceRevision = command.operation === "create_goal" ||
        command.operation === "route_inbox_to_goal"
      ? undefined
      : (input as { target: Target }).target.expectedRevision;
    const document = record(
      read(GOALS_KEY, { schemaVersion: 3, goals: [] }, sourceRevision),
    );
    const rows = asRecords(document.goals);
    let value: DataRecord;
    if (
      command.operation === "create_goal" ||
      command.operation === "route_inbox_to_goal"
    ) {
      unusedId(rows, targetId);
      value = makeGoal(
        command.operation === "create_goal"
          ? { ...command.arguments, title: command.arguments.title.trim() }
          : {
            horizon: command.arguments.horizon,
            periodKey: command.arguments.periodKey,
            title: inboxText!,
            type: "check",
          },
        targetId,
        ctx.createdAt,
      );
      value.order = endOrder(rows, value);
      const comparable = (r: DataRecord) => {
        const p = goalProjection(r);
        delete p.order;
        return canonical(p);
      };
      if (
        rows.some((r) =>
          r.title === value.title && comparable(r) === comparable(value)
        )
      ) warnings.push("duplicate_creation");
      rows.push(value);
    } else {
      const index = select(rows, command.arguments.target, "goal:"),
        original = rows[index];
      checkGoal(original);
      before = goalProjection(original);
      targetId = unusedId(rows, original.id ?? ctx.targetId, index);
      value = { ...original, id: targetId };
      switch (command.operation) {
        case "update_goal": {
          const patch = command.arguments.patch;
          if (
            original.done && patch.priority !== undefined &&
            patch.priority !== original.priority
          ) invalid();
          if (
            original.type === "check" &&
            (patch.target !== undefined || patch.unit !== undefined)
          ) invalid();
          value = { ...value, ...patch };
          if (patch.title !== undefined) value.title = patch.title.trim();
          if (patch.target !== undefined) {
            value.done = Number(value.current) >= patch.target;
          }
          if (original.priority !== value.priority) {
            value.order = endOrder(rows, value, index);
          }
          break;
        }
        case "move_goal":
          if (original.done) invalid();
          value.horizon = command.arguments.toHorizon;
          value.periodKey = command.arguments.toPeriodKey;
          value.priority = command.arguments.priority ?? value.priority;
          value.order = endOrder(rows, value, index);
          break;
        case "set_goal_progress":
          if (original.type !== "number") invalid();
          value.current = command.arguments.current;
          value.done = Number(value.current) >= Number(value.target);
          break;
        case "complete_goal":
          value.current = original.type === "check"
            ? 1
            : Math.max(Number(value.current), Number(value.target));
          value.done = true;
          break;
        case "reopen_goal": {
          const current = command.arguments.current;
          if (
            original.type === "number"
              ? current === undefined || current >= Number(original.target)
              : current !== undefined
          ) invalid();
          value.current = current ?? 0;
          value.done = false;
          break;
        }
      }
      rows[index] = value;
    }
    after = goalProjection(value);
    write(GOALS_KEY, { ...document, goals: rows });
  }
  const changedFields = [
    ...new Set([...Object.keys(before ?? {}), ...Object.keys(after)]),
  ]
    .filter((field) => canonical(before?.[field]) !== canonical(after[field]));
  const afterHashes = Object.fromEntries(
    await Promise.all(
      changes.map(async (
        change,
      ) => [change.key, await sha256(change.valueText)]),
    ),
  );
  const target = "target" in command.arguments
    ? command.arguments.target
    : null;
  const sourceRef = target && typeof target === "object"
    ? ("id" in target ? target.id : target.reference)
    : null;
  return {
    operation: command.operation,
    changes,
    dependencies,
    before,
    after,
    targetId,
    sourceRef,
    warnings,
    afterHashes,
    changedFields,
  };
}
