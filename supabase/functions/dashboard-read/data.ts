export class ReadError extends Error {
  constructor(public code: string, public status = 400) {
    super(code);
  }
}
export type Row = { key: string; value: unknown; updated_at: string };
const operations = [
  "get_today_tasks",
  "list_tasks",
  "get_goals",
  "get_tracker",
  "get_dashboard_summary",
] as const;
const horizons = ["week", "month", "quarter", "year", "5year", "life"];
export type Command = {
  operation: typeof operations[number];
  keys: string[];
  dates: string[];
  limit: number;
  cursor: number;
  horizon?: string;
  periodKey?: string;
  includeDone: boolean;
};
type RecordValue = Record<string, unknown>;
type Source = {
  key: string;
  state: "missing" | "available";
  updatedAt: string | null;
};
export type Page = {
  items: RecordValue[];
  total: number;
  nextCursor: number | null;
};
export type Summary = {
  tasks: { total: number | null; done: number | null };
  goals: { total: number | null; done: number | null };
  tracker: { full: number | null; partial: number | null; bad: number | null };
};
export type ReadResult = {
  meta: {
    readAt: string;
    source: string;
    atomic: boolean;
    timezone: string;
    activeDate: string;
    calendarDate: string;
  };
  sources: Source[];
  warnings: string[];
  data: Page | Summary;
};
const dayMs = 86400000;
export function calendarDay(now: Date, active = false): string {
  return new Date(now.getTime() + (active ? -1 : 5) * 3600000).toISOString()
    .slice(0, 10);
}
function date(value: unknown): string {
  if (
    typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
    !Number.isFinite(Date.parse(value + "T00:00:00Z")) ||
    new Date(value + "T00:00:00Z").toISOString().slice(0, 10) !== value
  ) {
    throw new ReadError("INVALID_COMMAND");
  }
  return value;
}
function period(horizon: string, value: unknown): boolean {
  if (typeof value !== "string") return false;
  if (horizon === "life") return value === "life";
  if (horizon === "week") {
    try {
      return date(value) === value &&
        new Date(value + "T00:00:00Z").getUTCDay() === 1;
    } catch {
      return false;
    }
  }
  if (horizon === "month") return /^\d{4}-(0[1-9]|1[0-2])$/.test(value);
  if (horizon === "quarter") return /^\d{4}-Q[1-4]$/.test(value);
  if (horizon === "year") return /^\d{4}$/.test(value);
  return horizon === "5year" && /^\d{4}$/.test(value) &&
    (Number(value) - 2026) % 5 === 0;
}
function currentPeriod(horizon: string, now: Date): string {
  const today = calendarDay(now),
    d = new Date(today + "T00:00:00Z"),
    year = d.getUTCFullYear();
  if (horizon === "week") {
    d.setUTCDate(d.getUTCDate() - (d.getUTCDay() + 6) % 7);
    return d.toISOString().slice(0, 10);
  }
  if (horizon === "month") return today.slice(0, 7);
  if (horizon === "quarter") {
    return `${year}-Q${Math.floor(d.getUTCMonth() / 3) + 1}`;
  }
  if (horizon === "year") return String(year);
  if (horizon === "5year") {
    return String(2026 + Math.floor((year - 2026) / 5) * 5);
  }
  return "life";
}
function object(value: unknown, code = "INVALID_DASHBOARD_DATA"): RecordValue {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ReadError(code, code === "INVALID_COMMAND" ? 400 : 502);
  }
  return value as RecordValue;
}
export function parseCommand(raw: unknown, now: Date): Command {
  const r = object(raw, "INVALID_COMMAND"), op = r.operation;
  if (!operations.includes(op as Command["operation"])) {
    throw new ReadError("INVALID_COMMAND");
  }
  const allowed = op === "get_dashboard_summary" ? ["operation"] : [
    "operation",
    "cursor",
    "limit",
    ...(op === "list_tasks" || op === "get_tracker" ? ["from", "to"] : []),
    ...(op === "get_goals" ? ["horizon", "periodKey", "includeDone"] : []),
  ];
  if (Object.keys(r).some((k) => !allowed.includes(k))) {
    throw new ReadError("INVALID_COMMAND");
  }
  const limit = r.limit ?? 50, cursor = r.cursor ?? 0;
  if (
    !Number.isInteger(limit) || Number(limit) < 1 || Number(limit) > 100 ||
    !Number.isInteger(cursor) || Number(cursor) < 0 || Number(cursor) > 10000
  ) {
    throw new ReadError("INVALID_COMMAND");
  }
  let dates = [calendarDay(now, true)];
  if (op === "list_tasks" || op === "get_tracker") {
    const from = date(r.from),
      to = date(r.to),
      count = (Date.parse(to) - Date.parse(from)) / dayMs + 1;
    if (count < 1 || count > 31) throw new ReadError("INVALID_COMMAND");
    dates = Array.from(
      { length: count },
      (_, i) =>
        new Date(Date.parse(from) + i * dayMs).toISOString().slice(0, 10),
    );
  }
  if (
    r.horizon !== undefined &&
    (typeof r.horizon !== "string" || !horizons.includes(r.horizon))
  ) throw new ReadError("INVALID_COMMAND");
  if (
    r.periodKey !== undefined &&
    (!r.horizon || !period(String(r.horizon), r.periodKey))
  ) throw new ReadError("INVALID_COMMAND");
  if (r.includeDone !== undefined && typeof r.includeDone !== "boolean") {
    throw new ReadError("INVALID_COMMAND");
  }
  const taskKeys = dates.map((d) => "goals:" + d);
  const keys = op === "get_goals"
    ? ["horizons_goals_v2"]
    : op === "get_tracker"
    ? ["tracker_v1"]
    : op === "get_dashboard_summary"
    ? [...taskKeys, "horizons_goals_v2", "tracker_v1"]
    : taskKeys;
  return {
    operation: op as Command["operation"],
    dates,
    keys,
    cursor: Number(cursor),
    limit: Number(limit),
    horizon: r.horizon as string | undefined,
    periodKey: r.periodKey as string | undefined,
    includeDone: r.includeDone !== false,
  };
}
function text(value: unknown): string {
  if (typeof value !== "string" || value.length > 10000) {
    throw new ReadError("INVALID_DASHBOARD_DATA", 502);
  }
  return value;
}
function flag(value: unknown): boolean {
  if (typeof value !== "boolean") {
    throw new ReadError("INVALID_DASHBOARD_DATA", 502);
  }
  return value;
}
function optionalText(value: unknown): string | null {
  return value === undefined || value === null ? null : text(value);
}
function optionalSignedNumber(value: unknown): number | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new ReadError("INVALID_DASHBOARD_DATA", 502);
  }
  return value;
}
function optionalNumber(value: unknown): number | null {
  const number = optionalSignedNumber(value);
  if (number !== null && number < 0) {
    throw new ReadError("INVALID_DASHBOARD_DATA", 502);
  }
  return number;
}
function records(value: unknown): RecordValue[] {
  if (!Array.isArray(value) || value.length > 10000) {
    throw new ReadError("INVALID_DASHBOARD_DATA", 502);
  }
  return value.map((v) => object(v));
}
export function readDashboard(
  command: Command,
  rows: Row[],
  now: Date,
): ReadResult {
  if (!Array.isArray(rows) || rows.length > command.keys.length) {
    throw new ReadError("INVALID_DASHBOARD_DATA", 502);
  }
  const values = new Map<string, unknown>(),
    sources: Source[] = [],
    warnings: string[] = [];
  for (const row of rows) {
    if (
      !row || !command.keys.includes(row.key) || values.has(row.key) ||
      !Number.isFinite(Date.parse(row.updated_at))
    ) {
      throw new ReadError("INVALID_DASHBOARD_DATA", 502);
    }
    let value = row.value;
    if (typeof value === "string") {
      try {
        value = JSON.parse(value);
      } catch {
        throw new ReadError("INVALID_DASHBOARD_DATA", 502);
      }
    }
    values.set(row.key, value);
  }
  for (const key of command.keys) {
    const sourceRow = rows.find((r) => r.key === key);
    sources.push({
      key,
      state: values.get(key) == null ? "missing" : "available",
      updatedAt: sourceRow
        ? new Date(sourceRow.updated_at).toISOString()
        : null,
    });
  }
  function tasks(): RecordValue[] {
    return command.dates.flatMap((day) => {
      const value = values.get("goals:" + day);
      return value == null ? [] : records(value).map((r, index) => ({
        reference: `${day}:${index}`,
        date: day,
        title: text(r.text),
        done: flag(r.done),
        estimatedMin: optionalNumber(r.estimatedMin),
        sphere: optionalText(r.sphere),
        difficulty: optionalText(r.difficulty),
        subtasks: r.subtasks == null ? [] : records(r.subtasks).map((s) => ({
          title: text(s.text),
          done: flag(s.done),
        })),
      }));
    });
  }
  function goals(): RecordValue[] {
    const value = values.get("horizons_goals_v2");
    if (value == null) return [];
    const ids = new Set<string>();
    const result = records(object(value).goals).map((g) => {
      const id = text(g.id), horizon = text(g.horizon);
      if (
        !id || ids.has(id) || !horizons.includes(horizon) ||
        !["check", "number"].includes(String(g.type))
      ) throw new ReadError("INVALID_DASHBOARD_DATA", 502);
      ids.add(id);
      const validPeriod = period(horizon, g.periodKey);
      if (!validPeriod && !warnings.includes("legacy_goal_period")) {
        warnings.push("legacy_goal_period");
      }
      const priority = ["p1", "p2", "p3", "p4"].includes(String(g.priority))
        ? g.priority
        : null;
      return {
        id,
        title: text(g.title),
        horizon,
        periodKey: validPeriod ? g.periodKey : null,
        priority,
        order: optionalNumber(g.order),
        type: g.type,
        done: flag(g.done),
        current: optionalSignedNumber(g.current),
        target: optionalSignedNumber(g.target),
        unit: optionalText(g.unit),
      };
    });
    return result.filter((g) =>
      (!command.horizon || g.horizon === command.horizon) &&
      (!command.periodKey || g.periodKey === command.periodKey) &&
      (command.includeDone || !g.done)
    )
      .sort((a, b) =>
        Number(a.done) - Number(b.done) ||
        ["p1", "p2", "p3", "p4", null].indexOf(a.priority as string | null) -
          ["p1", "p2", "p3", "p4", null].indexOf(b.priority as string | null) ||
        Number(a.order ?? 0) - Number(b.order ?? 0) || a.id.localeCompare(b.id)
      );
  }
  function tracker(days: string[]): RecordValue[] {
    const value = values.get("tracker_v1");
    if (value == null) return [];
    const t = object(value), marks = object(t.marks), ids = new Set<string>();
    return ["good", "bad"].flatMap((kind) =>
      records(t[kind]).map((h) => {
        const id = text(h.id);
        if (!id || ids.has(id)) {
          throw new ReadError("INVALID_DASHBOARD_DATA", 502);
        }
        ids.add(id);
        return {
          id,
          name: text(h.name),
          kind,
          marks: days.map((day) => {
            const value = marks[`${id}:${day}`];
            if (
              value !== undefined && ![0, 0.5, 1].includes(value as number)
            ) throw new ReadError("INVALID_DASHBOARD_DATA", 502);
            if (kind === "bad" && value === 0.5) {
              throw new ReadError("INVALID_DASHBOARD_DATA", 502);
            }
            return { date: day, value: value ?? null };
          }),
        };
      })
    );
  }
  let data: Page | Summary;
  if (command.operation === "get_dashboard_summary") {
    const ts = tasks(),
      gs = goals().filter((g) =>
        g.periodKey === currentPeriod(String(g.horizon), now)
      );
    const hs = tracker([calendarDay(now)]);
    const count = (key: string, items: RecordValue[]) =>
      values.get(key) == null
        ? { total: null, done: null }
        : { total: items.length, done: items.filter((i) => i.done).length };
    const marks = hs.map((h) => ({
      kind: h.kind,
      value: (h.marks as { value: number | null }[])[0].value,
    }));
    data = {
      tasks: count(command.keys[0], ts),
      goals: count("horizons_goals_v2", gs),
      tracker: values.get("tracker_v1") == null
        ? { full: null, partial: null, bad: null }
        : {
          full: marks.filter((m) => m.kind === "good" && m.value === 1).length,
          partial: marks.filter((m) =>
            m.kind === "good" && m.value === 0.5
          ).length,
          bad: marks.filter((m) => m.kind === "bad" && m.value === 1).length,
        },
    };
  } else {
    const items = command.operation === "get_goals"
      ? goals()
      : command.operation === "get_tracker"
      ? tracker(command.dates)
      : tasks();
    data = {
      items: items.slice(command.cursor, command.cursor + command.limit),
      total: items.length,
      nextCursor: command.cursor + command.limit < items.length
        ? command.cursor + command.limit
        : null,
    };
  }
  return {
    meta: {
      readAt: now.toISOString(),
      source: "last_synced_cloud",
      atomic: false,
      timezone: "Asia/Yekaterinburg",
      activeDate: calendarDay(now, true),
      calendarDate: calendarDay(now),
    },
    sources,
    warnings,
    data,
  };
}
