import type { PageObjectResponse } from "@notionhq/client";
import type {
  Lesson,
  LessonAutonomy,
  LessonPriority,
  LessonResult,
  LessonSchedule,
  LessonStatus,
} from "./types.ts";

export const READ_PROPERTY_NAMES = Object.freeze(
  [
    "Урок",
    "Предмет",
    "Модуль",
    "Начало и окончание",
    "Статус",
    "Приоритет",
    "Неделя",
    "Результат",
    "Автономность",
    "Понимание",
    "Артефакт",
    "Краткий комментарий",
    "Причина пропуска",
    "Количество переносов",
    "Продолжительность, мин",
    "Порядок",
    "Требует решения",
  ] as const,
);

const defaultDurationMinutes = 45;
const minimumDurationMinutes = 15;
const maximumDurationMinutes = 180;
const finalizedStatuses = new Set<LessonStatus>([
  "Выполнен",
  "Частично выполнен",
  "Пропущен",
]);
const evidenceStatuses = new Set<LessonStatus>([
  "В процессе",
  "Выполнен",
  "Частично выполнен",
]);
const statuses = new Set<LessonStatus>([
  "Нераспределён",
  "Запланирован",
  "В процессе",
  "Выполнен",
  "Частично выполнен",
  "Пропущен",
  "Отменён",
]);
const priorities = new Set<LessonPriority>(["Must", "Should", "Could"]);
const results = new Set<Exclude<LessonResult, null>>([
  "Зачёт",
  "Незачёт",
  "Требует повторения",
]);
const autonomies = new Set<Exclude<LessonAutonomy, null>>([
  "A0",
  "A1",
  "A2",
  "A3",
]);

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function property(page: PageObjectResponse, name: string): unknown {
  return page.properties[name];
}

function richTextValue(value: unknown, key: "rich_text" | "title"): string {
  if (!isRecord(value) || value.type !== key || !Array.isArray(value[key])) {
    return "";
  }

  return value[key].map((item) =>
    isRecord(item) && typeof item.plain_text === "string" ? item.plain_text : ""
  ).join("");
}

function selectValue(value: unknown): string | null {
  if (
    !isRecord(value) ||
    value.type !== "select" ||
    !isRecord(value.select) ||
    typeof value.select.name !== "string"
  ) {
    return null;
  }

  return value.select.name;
}

function numberValue(value: unknown): number | null {
  if (
    !isRecord(value) ||
    value.type !== "number" ||
    (typeof value.number !== "number" && value.number !== null)
  ) {
    return null;
  }

  return value.number;
}

function urlValue(value: unknown): string | null {
  if (
    !isRecord(value) ||
    value.type !== "url" ||
    (typeof value.url !== "string" && value.url !== null)
  ) {
    return null;
  }

  return value.url;
}

function dateValue(value: unknown): UnknownRecord | null {
  if (
    !isRecord(value) ||
    value.type !== "date" ||
    !isRecord(value.date) ||
    typeof value.date.start !== "string"
  ) {
    return null;
  }

  return value.date;
}

function validDuration(value: unknown): value is number {
  return Number.isInteger(value) &&
    typeof value === "number" &&
    value >= minimumDurationMinutes &&
    value <= maximumDurationMinutes;
}

function timedDifferenceMinutes(date: UnknownRecord | null): number | null {
  if (!date || typeof date.start !== "string" || typeof date.end !== "string") {
    return null;
  }

  const difference = (Date.parse(date.end) - Date.parse(date.start)) / 60_000;
  return validDuration(difference) ? difference : null;
}

function resolvedDuration(
  dateProperty: unknown,
  durationProperty: unknown,
): number {
  const canonical = numberValue(durationProperty);
  if (validDuration(canonical)) {
    return canonical;
  }

  return timedDifferenceMinutes(dateValue(dateProperty)) ??
    defaultDurationMinutes;
}

function addMinutesPreservingOffset(start: string, minutes: number): string {
  const timestamp = Date.parse(start);
  if (!Number.isFinite(timestamp)) {
    return start;
  }

  if (start.endsWith("Z")) {
    return new Date(timestamp + minutes * 60_000).toISOString();
  }

  const offsetMatch = start.match(/([+-])(\d{2}):(\d{2})$/);
  if (!offsetMatch) {
    return new Date(timestamp + minutes * 60_000).toISOString();
  }

  const direction = offsetMatch[1] === "+" ? 1 : -1;
  const offsetMinutes = direction *
    (Number(offsetMatch[2]) * 60 + Number(offsetMatch[3]));
  const localTimestamp = timestamp + minutes * 60_000 +
    offsetMinutes * 60_000;
  const local = new Date(localTimestamp).toISOString().slice(0, 19);

  return `${local}${offsetMatch[0]}`;
}

export function normalizeNotionDate(
  dateProperty: unknown,
  durationProperty: unknown,
): LessonSchedule {
  const date = dateValue(dateProperty);
  if (!date) {
    return {
      date: null,
      end: null,
      kind: "unscheduled",
      start: null,
    };
  }

  const start = date.start as string;
  if (/^\d{4}-\d{2}-\d{2}$/.test(start)) {
    return {
      date: start,
      end: null,
      kind: "date-only",
      start: null,
    };
  }

  const durationMinutes = resolvedDuration(dateProperty, durationProperty);
  const rawEnd = typeof date.end === "string" ? date.end : null;
  const rawDifference = timedDifferenceMinutes(date);
  const end = rawEnd && rawDifference === durationMinutes
    ? rawEnd
    : addMinutesPreservingOffset(start, durationMinutes);

  return {
    date: start.slice(0, 10),
    end,
    kind: "timed",
    start,
  };
}

function normalizeStatus(value: string | null): LessonStatus {
  return value && statuses.has(value as LessonStatus)
    ? value as LessonStatus
    : "Нераспределён";
}

function normalizePriority(value: string | null): LessonPriority {
  return value && priorities.has(value as LessonPriority)
    ? value as LessonPriority
    : "Could";
}

function normalizeResult(value: string | null): LessonResult {
  return value && results.has(value as Exclude<LessonResult, null>)
    ? value as Exclude<LessonResult, null>
    : null;
}

function normalizeAutonomy(value: string | null): LessonAutonomy {
  return value && autonomies.has(value as Exclude<LessonAutonomy, null>)
    ? value as Exclude<LessonAutonomy, null>
    : null;
}

function normalizeUnderstanding(value: number | null): 0 | 1 | 2 | 3 | null {
  return value === 0 || value === 1 || value === 2 || value === 3
    ? value
    : null;
}

function numericOrDefault(value: number | null): number {
  return Number.isFinite(value) && value !== null ? value : 0;
}

export function mapNotionPageToLesson(page: PageObjectResponse): Lesson {
  const scheduleProperty = property(page, "Начало и окончание");
  const durationProperty = property(page, "Продолжительность, мин");
  const date = dateValue(scheduleProperty);
  const canonicalDuration = numberValue(durationProperty);
  const durationMinutes = resolvedDuration(scheduleProperty, durationProperty);
  const status = normalizeStatus(selectValue(property(page, "Статус")));
  const result = normalizeResult(selectValue(property(page, "Результат")));
  const autonomy = normalizeAutonomy(
    selectValue(property(page, "Автономность")),
  );
  const understanding = normalizeUnderstanding(
    numberValue(property(page, "Понимание")),
  );
  const artifactUrl = urlValue(property(page, "Артефакт"));
  const comment = richTextValue(
    property(page, "Краткий комментарий"),
    "rich_text",
  );
  const hasDurationMismatch = validDuration(canonicalDuration) &&
    typeof date?.end === "string" &&
    timedDifferenceMinutes(date) !== canonicalDuration;

  return {
    artifactUrl,
    autonomy,
    comment,
    decisionRequest: selectValue(property(page, "Требует решения")) ===
        "Перенос между неделями"
      ? "Перенос между неделями"
      : null,
    durationMinutes,
    hasLearningEvidence: evidenceStatuses.has(status) ||
      result !== null ||
      autonomy !== null ||
      understanding !== null ||
      comment.trim().length > 0 ||
      artifactUrl !== null && artifactUrl.trim().length > 0,
    id: page.id,
    isFinalized: finalizedStatuses.has(status),
    missedReason: selectValue(property(page, "Причина пропуска")),
    module: richTextValue(property(page, "Модуль"), "rich_text"),
    moveCount: numericOrDefault(
      numberValue(property(page, "Количество переносов")),
    ),
    order: numericOrDefault(numberValue(property(page, "Порядок"))),
    priority: normalizePriority(selectValue(property(page, "Приоритет"))),
    result,
    schedule: normalizeNotionDate(scheduleProperty, durationProperty),
    status,
    subject: selectValue(property(page, "Предмет")) ?? "",
    title: richTextValue(property(page, "Урок"), "title"),
    understanding,
    warnings: hasDurationMismatch ? [{ code: "duration-mismatch" }] : [],
    week: selectValue(property(page, "Неделя")) ?? "",
  };
}
