import type { PageObjectResponse } from "@notionhq/client";
import { SchoolHttpError } from "./errors.ts";
import {
  ACTIVE_LESSON_WEEK,
  LESSON_AUTONOMIES,
  LESSON_DECISION_REQUESTS,
  LESSON_MISSED_REASONS,
  LESSON_PRIORITIES,
  LESSON_RESULTS,
  LESSON_STATUSES,
  LESSON_SUBJECTS,
} from "./types.ts";
import type {
  Lesson,
  LessonAutonomy,
  LessonMissedReason,
  LessonPriority,
  LessonResult,
  LessonSchedule,
  LessonStatus,
  LessonSubject,
} from "./types.ts";

export const READ_PROPERTY_SCHEMA = Object.freeze(
  [
    ["Урок", "title"],
    ["Предмет", "select"],
    ["Модуль", "rich_text"],
    ["Начало и окончание", "date"],
    ["Статус", "select"],
    ["Приоритет", "select"],
    ["Неделя", "select"],
    ["Результат", "select"],
    ["Автономность", "select"],
    ["Понимание", "number"],
    ["Артефакт", "url"],
    ["Краткий комментарий", "rich_text"],
    ["Причина пропуска", "select"],
    ["Количество переносов", "number"],
    ["Продолжительность, мин", "number"],
    ["Порядок", "number"],
    ["Требует решения", "select"],
  ] as const,
);
export const READ_PROPERTY_NAMES = Object.freeze(
  READ_PROPERTY_SCHEMA.map(([name]) => name),
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
const statuses = new Set<LessonStatus>(LESSON_STATUSES);
const priorities = new Set<LessonPriority>(LESSON_PRIORITIES);
const results = new Set<Exclude<LessonResult, null>>(LESSON_RESULTS);
const autonomies = new Set<Exclude<LessonAutonomy, null>>(
  LESSON_AUTONOMIES,
);
const lessonSubjects = new Set<string>(LESSON_SUBJECTS);
const missedReasons = new Set<string>(LESSON_MISSED_REASONS);
const decisionRequests = new Set<string>(LESSON_DECISION_REQUESTS);
const dateOnlyPattern = /^(\d{4})-(\d{2})-(\d{2})$/;
const timedIsoPattern =
  /^(\d{4})-(\d{2})-(\d{2})T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,9})?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/;

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function schemaError(): never {
  throw new SchoolHttpError(
    502,
    "NOTION_SCHEMA_ERROR",
    "notion lesson schema is invalid",
  );
}

function isRealCalendarDate(
  yearText: string,
  monthText: string,
  dayText: string,
): boolean {
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const date = new Date(Date.UTC(year, month - 1, day));

  return date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day;
}

function isStrictDateOnly(value: string): boolean {
  const match = value.match(dateOnlyPattern);
  return match !== null && isRealCalendarDate(match[1], match[2], match[3]);
}

function isStrictTimedIso(value: string): boolean {
  const match = value.match(timedIsoPattern);
  return match !== null &&
    isRealCalendarDate(match[1], match[2], match[3]) &&
    Number.isFinite(Date.parse(value));
}

function assertDatePayload(date: UnknownRecord): void {
  const start = date.start;
  const end = date.end;
  if (typeof start !== "string") {
    return schemaError();
  }

  if (isStrictDateOnly(start)) {
    if (end !== null) {
      return schemaError();
    }
    return;
  }

  if (!isStrictTimedIso(start)) {
    return schemaError();
  }

  if (end !== null) {
    if (
      typeof end !== "string" ||
      !isStrictTimedIso(end) ||
      start.slice(0, 10) !== end.slice(0, 10) ||
      Date.parse(end) <= Date.parse(start)
    ) {
      return schemaError();
    }
  }
}

function assertPropertyValue(
  value: unknown,
  expectedType: (typeof READ_PROPERTY_SCHEMA)[number][1],
): asserts value is UnknownRecord {
  if (!isRecord(value) || value.type !== expectedType) {
    return schemaError();
  }

  if (
    (expectedType === "title" || expectedType === "rich_text") &&
    (!Array.isArray(value[expectedType]) ||
      value[expectedType].some((item) =>
        !isRecord(item) || typeof item.plain_text !== "string"
      ))
  ) {
    return schemaError();
  }

  if (
    expectedType === "select" &&
    value.select !== null &&
    (!isRecord(value.select) || typeof value.select.name !== "string")
  ) {
    return schemaError();
  }

  if (
    expectedType === "number" &&
    value.number !== null &&
    (typeof value.number !== "number" || !Number.isFinite(value.number))
  ) {
    return schemaError();
  }

  if (
    expectedType === "url" &&
    value.url !== null &&
    typeof value.url !== "string"
  ) {
    return schemaError();
  }

  if (expectedType === "date" && value.date !== null) {
    if (
      !isRecord(value.date) ||
      typeof value.date.start !== "string" ||
      value.date.end !== null && typeof value.date.end !== "string" ||
      value.date.time_zone !== null &&
        typeof value.date.time_zone !== "string"
    ) {
      return schemaError();
    }
    assertDatePayload(value.date);
  }
}

function assertPageSchema(page: PageObjectResponse): void {
  if (!isRecord(page.properties)) {
    return schemaError();
  }

  for (const [name, expectedType] of READ_PROPERTY_SCHEMA) {
    assertPropertyValue(page.properties[name], expectedType);
  }
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
  return Number.isFinite(difference) ? difference : null;
}

function resolvedDuration(
  dateProperty: unknown,
  durationProperty: unknown,
): number {
  const canonical = numberValue(durationProperty);
  if (canonical !== null) {
    return canonical;
  }

  const legacyDifference = timedDifferenceMinutes(dateValue(dateProperty));
  return validDuration(legacyDifference)
    ? legacyDifference
    : defaultDurationMinutes;
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
  assertPropertyValue(dateProperty, "date");
  assertPropertyValue(durationProperty, "number");
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
  if (isStrictDateOnly(start)) {
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
  if (
    !isStrictTimedIso(end) ||
    end.slice(0, 10) !== start.slice(0, 10) ||
    Date.parse(end) <= Date.parse(start)
  ) {
    return schemaError();
  }

  return {
    date: start.slice(0, 10),
    end,
    kind: "timed",
    start,
  };
}

function normalizeStatus(value: string | null): LessonStatus {
  if (!value || !statuses.has(value as LessonStatus)) {
    return schemaError();
  }

  return value as LessonStatus;
}

function normalizePriority(value: string | null): LessonPriority {
  if (!value || !priorities.has(value as LessonPriority)) {
    return schemaError();
  }

  return value as LessonPriority;
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

function normalizeSubject(value: string | null): LessonSubject {
  if (!value || !lessonSubjects.has(value)) {
    return schemaError();
  }

  return value as LessonSubject;
}

function normalizeMissedReason(value: string | null): LessonMissedReason {
  if (value !== null && !missedReasons.has(value)) {
    return schemaError();
  }

  return value as LessonMissedReason;
}

function normalizeWeek(
  value: string | null,
): typeof ACTIVE_LESSON_WEEK {
  if (value !== ACTIVE_LESSON_WEEK) {
    return schemaError();
  }

  return value;
}

function assertAllowedValues(
  status: string | null,
  priority: string | null,
  week: string | null,
  result: string | null,
  autonomy: string | null,
  understanding: number | null,
  missedReason: string | null,
  decisionRequest: string | null,
): void {
  if (
    status === null || !statuses.has(status as LessonStatus) ||
    priority === null || !priorities.has(priority as LessonPriority) ||
    week !== ACTIVE_LESSON_WEEK ||
    result !== null &&
      !results.has(result as Exclude<LessonResult, null>) ||
    autonomy !== null &&
      !autonomies.has(autonomy as Exclude<LessonAutonomy, null>) ||
    understanding !== null &&
      understanding !== 0 &&
      understanding !== 1 &&
      understanding !== 2 &&
      understanding !== 3 ||
    missedReason !== null && !missedReasons.has(missedReason) ||
    decisionRequest !== null && !decisionRequests.has(decisionRequest)
  ) {
    return schemaError();
  }
}

function numericOrDefault(value: number | null): number {
  return Number.isFinite(value) && value !== null ? value : 0;
}

export function mapNotionPageToLesson(page: PageObjectResponse): Lesson {
  assertPageSchema(page);
  const scheduleProperty = property(page, "Начало и окончание");
  const durationProperty = property(page, "Продолжительность, мин");
  const date = dateValue(scheduleProperty);
  const canonicalDuration = numberValue(durationProperty);
  const durationMinutes = resolvedDuration(scheduleProperty, durationProperty);
  const rawStatus = selectValue(property(page, "Статус"));
  const rawPriority = selectValue(property(page, "Приоритет"));
  const rawWeek = selectValue(property(page, "Неделя"));
  const rawResult = selectValue(property(page, "Результат"));
  const rawAutonomy = selectValue(property(page, "Автономность"));
  const rawUnderstanding = numberValue(property(page, "Понимание"));
  const rawMissedReason = selectValue(property(page, "Причина пропуска"));
  const rawDecisionRequest = selectValue(property(page, "Требует решения"));
  assertAllowedValues(
    rawStatus,
    rawPriority,
    rawWeek,
    rawResult,
    rawAutonomy,
    rawUnderstanding,
    rawMissedReason,
    rawDecisionRequest,
  );
  const status = normalizeStatus(rawStatus);
  const result = normalizeResult(rawResult);
  const autonomy = normalizeAutonomy(rawAutonomy);
  const understanding = normalizeUnderstanding(rawUnderstanding);
  const artifactUrl = urlValue(property(page, "Артефакт"));
  const comment = richTextValue(
    property(page, "Краткий комментарий"),
    "rich_text",
  );
  const hasInvalidDuration = canonicalDuration !== null &&
    !validDuration(canonicalDuration);
  const hasDurationMismatch = canonicalDuration !== null &&
    typeof date?.end === "string" &&
    timedDifferenceMinutes(date) !== canonicalDuration;
  const warnings: Lesson["warnings"] = [];

  if (hasInvalidDuration) {
    warnings.push({ code: "invalid-duration" });
  }
  if (hasDurationMismatch) {
    warnings.push({ code: "duration-mismatch" });
  }

  return {
    artifactUrl,
    autonomy,
    comment,
    decisionRequest: rawDecisionRequest === LESSON_DECISION_REQUESTS[0]
      ? LESSON_DECISION_REQUESTS[0]
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
    missedReason: normalizeMissedReason(rawMissedReason),
    module: richTextValue(property(page, "Модуль"), "rich_text"),
    moveCount: numericOrDefault(
      numberValue(property(page, "Количество переносов")),
    ),
    order: numericOrDefault(numberValue(property(page, "Порядок"))),
    priority: normalizePriority(rawPriority),
    result,
    schedule: normalizeNotionDate(scheduleProperty, durationProperty),
    status,
    subject: normalizeSubject(selectValue(property(page, "Предмет"))),
    title: richTextValue(property(page, "Урок"), "title"),
    understanding,
    warnings,
    week: normalizeWeek(rawWeek),
  };
}
