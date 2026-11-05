export type Revision = string;
export type DataRecord = Record<string, unknown>;
export type Snapshot = {
  key: string;
  exists: boolean;
  valueText: string | null;
  revision: Revision;
  updatedAt: string | null;
};
export type Dependency = { key: string; expectedRevision: Revision };
export type Change = Dependency & { valueText: string };
export type Target =
  & { expectedRevision: Revision }
  & ({ id: string } | { reference: string });
export type InboxTarget = { id: string; expectedRevision: Revision };
export type TaskTarget = Target & { date: string };
export type SubtaskInput = { text: string };
export type TaskFields = {
  text: string;
  description: string;
  estimatedMin: number;
  sphere: string;
  difficulty: "easy" | "medium" | "hard";
};
export type Horizon = "week" | "month" | "quarter" | "year" | "5year" | "life";
export type Priority = "p1" | "p2" | "p3" | "p4";
export type GoalFields = {
  title: string;
  priority: Priority;
  target: number;
  unit: string;
};
export type GoalPeriod = { horizon: Horizon; periodKey: string };
type Args = {
  create_task: Pick<TaskFields, "text"> & Partial<TaskFields> & {
    date?: string;
    subtasks?: SubtaskInput[];
  };
  update_task: {
    target: TaskTarget;
    patch?: Partial<TaskFields>;
    subtaskEdits?: (SubtaskInput & { index: number })[];
    appendSubtasks?: SubtaskInput[];
  };
  move_task: { target: TaskTarget; toDate: string };
  create_goal: Pick<GoalFields, "title"> & Partial<GoalFields> & GoalPeriod & {
    type: "check" | "number";
    current?: number;
  };
  update_goal: { target: Target; patch: Partial<GoalFields> };
  move_goal: {
    target: Target;
    toHorizon: Horizon;
    toPeriodKey: string;
    priority?: Priority;
  };
  set_goal_progress: { target: Target; current: number };
  complete_goal: { target: Target };
  reopen_goal: { target: Target; current?: number };
  route_inbox_to_task: { target: InboxTarget; date: string };
  route_inbox_to_goal: { target: InboxTarget } & GoalPeriod;
};
export type Operation = keyof Args;
export type Mutation = {
  [K in Operation]: { operation: K; arguments: Args[K] };
}[Operation];
export type Context = {
  effectiveDate: string | null;
  targetId: string;
  createdAt: string;
};
export type ResolvedMutation = Mutation & { context: Context };
export type MutationEffect = {
  operation: Operation;
  changes: Change[];
  dependencies: Dependency[];
  targetId: string;
  sourceRef: string | null;
  before: DataRecord | null;
  after: DataRecord;
  warnings: string[];
  afterHashes: Record<string, string>;
  changedFields: string[];
};
export type Prepared = {
  requestId: string;
  draftId: string;
  previewText: string;
  expiresAt: string;
};
export type Receipt = {
  requestId: string;
  draftId: string;
  outcome: "committed";
  operation: Operation;
  targetId: string;
  versions: Record<string, Revision>;
  committedAt: string;
};
export type PrepareOutcome =
  | { state: "prepared"; draft: Prepared }
  | { state: "committed"; receipt: Receipt };
export class WriteError extends Error {
  constructor(public code: string, public status: number) {
    super(code);
  }
}
export function invalid(): never {
  throw new WriteError("invalid_change", 422);
}
export function conflict(): never {
  throw new WriteError("conflict", 409);
}
export function record(value: unknown): DataRecord {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    invalid();
  }
  return value as DataRecord;
}
export function revision(value: unknown): value is Revision {
  return typeof value === "string" && /^(0|[1-9][0-9]{0,18})$/.test(value) &&
    BigInt(value) <= 9223372036854775807n;
}
export function validDate(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    Number.isFinite(Date.parse(value)) &&
    new Date(value + "T00:00:00Z").toISOString().slice(0, 10) === value;
}
export const horizons = [
  "week",
  "month",
  "quarter",
  "year",
  "5year",
  "life",
] as const;
export const priorities = ["p1", "p2", "p3", "p4"] as const;
export const difficulties = ["easy", "medium", "hard"] as const;
export const uuid4 =
  /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
export function validPeriod(horizon: unknown, key: unknown): boolean {
  if (typeof key !== "string") return false;
  switch (horizon) {
    case "week":
      return validDate(key) && new Date(key).getUTCDay() === 1;
    case "month":
      return /^\d{4}-(0[1-9]|1[0-2])$/.test(key);
    case "quarter":
      return /^\d{4}-Q[1-4]$/.test(key);
    case "year":
      return /^\d{4}$/.test(key);
    case "5year":
      return /^\d{4}$/.test(key) && (Number(key) - 2026) % 5 === 0;
    case "life":
      return key === "life";
    default:
      return false;
  }
}
export const GOALS_KEY = "horizons_goals_v2";
export const INBOX_KEY = "inbox_v1";
export const BACKLOG_KEY = "backlog_tasks_v1";
export const SPHERES_KEY = "sphere_defs_v1";
export const MAX_DOCUMENT_BYTES = 4 * 1024 * 1024;
export function taskKey(date: string): string {
  return date === "backlog" ? BACKLOG_KEY : "goals:" + date;
}
