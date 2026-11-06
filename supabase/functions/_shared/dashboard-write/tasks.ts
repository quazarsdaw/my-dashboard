import {
  type DataRecord,
  difficulties,
  invalid,
  record,
  type TaskFields,
} from "./contracts.ts";

export function asText(value: unknown, max: number, nonempty = false): string {
  if (
    typeof value !== "string" || value.includes("\0") ||
    [...value].length > max ||
    (nonempty && !value.trim())
  ) invalid();
  return value;
}
export function asRecords(value: unknown, max = 10000): DataRecord[] {
  if (!Array.isArray(value) || value.length > max) invalid();
  return value.map(record);
}
export function asInteger(
  value: unknown,
  min = Number.MIN_SAFE_INTEGER,
  max = Number.MAX_SAFE_INTEGER,
): number {
  if (
    typeof value !== "number" || !Number.isSafeInteger(value) || value < min ||
    value > max
  ) invalid();
  return value;
}
export function selectFields(value: DataRecord, fields: string[]): DataRecord {
  return Object.fromEntries(
    fields.filter((field) => Object.hasOwn(value, field)).map((
      field,
    ) => [field, value[field]]),
  );
}
export function makeTask(
  fields: Pick<TaskFields, "text"> & Partial<TaskFields> & {
    subtasks?: { text: string }[];
  },
  id: string,
  createdAt: string,
): DataRecord {
  const task: DataRecord = {
    id,
    text: asText(fields.text, 500, true),
    done: false,
    estimatedMin: fields.estimatedMin ?? 15,
    sphere: fields.sphere ?? "",
    difficulty: fields.difficulty ?? "medium",
    createdAt,
    subtasks: (fields.subtasks ?? []).map((s) => ({
      text: s.text.trim(),
      done: false,
    })),
  };
  if (fields.description !== undefined) task.description = fields.description;
  return task;
}

export function taskProjection(value: DataRecord): DataRecord {
  const projected = selectFields(value, [
    "text",
    "description",
    "done",
    "estimatedMin",
    "sphere",
    "difficulty",
  ]);
  if (value.subtasks !== undefined) {
    projected.subtasks = asRecords(value.subtasks, 100).map((s) =>
      selectFields(s, ["text", "done"])
    );
  }
  return projected;
}
export function checkTask(value: DataRecord): void {
  asText(value.text, 500, true);
  if (value.done !== false) invalid();
  if (value.description !== undefined) asText(value.description, 10000);
  if (value.estimatedMin !== undefined) asInteger(value.estimatedMin, 1, 1440);
  if (value.sphere !== undefined && value.sphere !== null) {
    asText(value.sphere, 200);
  }
  if (
    value.difficulty !== undefined &&
    !difficulties.includes(value.difficulty as TaskFields["difficulty"])
  ) invalid();
  if (value.subtasks !== undefined) {
    for (const s of asRecords(value.subtasks, 100)) {
      asText(s.text, 500, true);
      if (typeof s.done !== "boolean") invalid();
    }
  }
}
export function patchTask(
  value: DataRecord,
  input: {
    patch?: Partial<TaskFields>;
    subtaskEdits?: { index: number; text: string }[];
    appendSubtasks?: { text: string }[];
  },
): DataRecord {
  checkTask(value);
  const result: DataRecord = { ...value, ...input.patch };
  if (input.patch?.text !== undefined) result.text = input.patch.text.trim();
  if (input.subtaskEdits || input.appendSubtasks) {
    const subtasks = value.subtasks === undefined
      ? []
      : asRecords(value.subtasks, 100).slice();
    const seen = new Set<number>();
    for (const change of input.subtaskEdits ?? []) {
      if (change.index >= subtasks.length || seen.has(change.index)) invalid();
      seen.add(change.index);
      subtasks[change.index] = {
        ...subtasks[change.index],
        text: change.text.trim(),
      };
    }
    subtasks.push(
      ...(input.appendSubtasks ?? []).map((s) => ({
        text: s.text.trim(),
        done: false,
      })),
    );
    if (subtasks.length > 100) invalid();
    result.subtasks = subtasks;
  }
  return result;
}
