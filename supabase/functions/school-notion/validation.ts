import { SchoolHttpError } from "./errors.ts";
import {
  ACTIVE_LESSON_WEEK,
  LESSON_AUTONOMIES,
  LESSON_MISSED_REASONS,
  LESSON_RESULTS,
} from "./types.ts";
import type {
  CompleteLessonCommand,
  LessonAutonomy,
  LessonDestination,
  LessonMissedReason,
  LessonResult,
  NotionPage,
  SchoolCommand,
} from "./types.ts";

type UnknownRecord = Record<string, unknown>;

const activeWeekStart = "2026-08-03";
const activeWeekEnd = "2026-08-09";
const dateOnlyPattern = /^(\d{4})-(\d{2})-(\d{2})$/;
const timedIsoPattern =
  /^(\d{4})-(\d{2})-(\d{2})T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,9})?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function invalidCommand(): never {
  throw new SchoolHttpError(
    400,
    "INVALID_COMMAND",
    "command payload is invalid",
  );
}

function hasExactKeys(
  value: UnknownRecord,
  allowed: readonly string[],
  required: readonly string[] = allowed,
): boolean {
  const allowedKeys = new Set(allowed);
  return Object.keys(value).every((key) => allowedKeys.has(key)) &&
    required.every((key) => Object.prototype.hasOwnProperty.call(value, key));
}

function parseLessonId(value: unknown): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.trim() !== value
  ) {
    return invalidCommand();
  }

  return value;
}

function parseFiniteNumber(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return invalidCommand();
  }

  return value;
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

function crossWeekMoveRequiresReview(): never {
  throw new SchoolHttpError(
    409,
    "CROSS_WEEK_MOVE_REQUIRES_REVIEW",
    "cross-week move requires weekly review",
  );
}

function parseActiveWeekDate(
  value: unknown,
  reportCrossWeek = false,
): string {
  if (typeof value !== "string") {
    return invalidCommand();
  }

  const match = value.match(dateOnlyPattern);
  if (
    !match ||
    !isRealCalendarDate(match[1], match[2], match[3])
  ) {
    return invalidCommand();
  }
  if (value < activeWeekStart || value > activeWeekEnd) {
    return reportCrossWeek ? crossWeekMoveRequiresReview() : invalidCommand();
  }

  return value;
}

function parseActiveWeekTimestamp(
  value: unknown,
  reportCrossWeek = false,
): string {
  if (typeof value !== "string") {
    return invalidCommand();
  }

  const match = value.match(timedIsoPattern);
  if (
    !match ||
    !isRealCalendarDate(match[1], match[2], match[3]) ||
    !Number.isFinite(Date.parse(value))
  ) {
    return invalidCommand();
  }
  if (
    value.slice(0, 10) < activeWeekStart ||
    value.slice(0, 10) > activeWeekEnd
  ) {
    return reportCrossWeek ? crossWeekMoveRequiresReview() : invalidCommand();
  }

  return value;
}

function parseDestination(
  value: unknown,
  allowUnscheduled: boolean,
): LessonDestination {
  if (!isRecord(value) || typeof value.kind !== "string") {
    return invalidCommand();
  }

  if (
    value.kind === "date-only" &&
    hasExactKeys(value, ["date", "kind"])
  ) {
    return Object.freeze({
      date: parseActiveWeekDate(value.date, true),
      kind: "date-only" as const,
    });
  }

  if (
    value.kind === "timed" &&
    hasExactKeys(value, ["kind", "start"])
  ) {
    return Object.freeze({
      kind: "timed" as const,
      start: parseActiveWeekTimestamp(value.start, true),
    });
  }

  if (
    allowUnscheduled &&
    value.kind === "unscheduled" &&
    hasExactKeys(value, ["kind"])
  ) {
    return Object.freeze({ kind: "unscheduled" as const });
  }

  return invalidCommand();
}

function optionalAllowOverlap(value: UnknownRecord): boolean | undefined {
  if (!Object.prototype.hasOwnProperty.call(value, "allowOverlap")) {
    return undefined;
  }

  if (typeof value.allowOverlap !== "boolean") {
    return invalidCommand();
  }

  return value.allowOverlap;
}

function optionalComment(value: UnknownRecord): string | undefined {
  if (!Object.prototype.hasOwnProperty.call(value, "comment")) {
    return undefined;
  }

  if (typeof value.comment !== "string") {
    return invalidCommand();
  }

  const comment = value.comment.trim();
  if (countUnicodeCodePoints(comment) > 1000) {
    return invalidCommand();
  }

  return comment;
}

function optionalArtifactUrl(
  value: UnknownRecord,
): string | null | undefined {
  if (!Object.prototype.hasOwnProperty.call(value, "artifactUrl")) {
    return undefined;
  }

  return validateArtifactUrl(value.artifactUrl);
}

function parseAutonomy(
  value: unknown,
): Exclude<LessonAutonomy, null> {
  if (!LESSON_AUTONOMIES.includes(value as never)) {
    return invalidCommand();
  }

  return value as Exclude<LessonAutonomy, null>;
}

function parseUnderstanding(value: unknown): 0 | 1 | 2 | 3 {
  if (
    typeof value !== "number" ||
    !Number.isInteger(value) ||
    value < 0 ||
    value > 3
  ) {
    return invalidCommand();
  }

  return value as 0 | 1 | 2 | 3;
}

function parseResult(value: unknown): Exclude<LessonResult, null> {
  if (!LESSON_RESULTS.includes(value as never)) {
    return invalidCommand();
  }

  return value as Exclude<LessonResult, null>;
}

function parseMissedReason(
  value: unknown,
): Exclude<LessonMissedReason, null> {
  if (!LESSON_MISSED_REASONS.includes(value as never)) {
    return invalidCommand();
  }

  return value as Exclude<LessonMissedReason, null>;
}

function parseCompleteLesson(value: UnknownRecord): CompleteLessonCommand {
  if (value.status === "Выполнен") {
    if (
      !hasExactKeys(
        value,
        [
          "artifactUrl",
          "autonomy",
          "comment",
          "lessonId",
          "operation",
          "result",
          "status",
          "understanding",
        ],
        ["autonomy", "lessonId", "operation", "status", "understanding"],
      )
    ) {
      return invalidCommand();
    }

    const comment = optionalComment(value);
    const artifactUrl = optionalArtifactUrl(value);
    return Object.freeze({
      ...(artifactUrl === undefined ? {} : { artifactUrl }),
      autonomy: parseAutonomy(value.autonomy),
      ...(comment === undefined ? {} : { comment }),
      lessonId: parseLessonId(value.lessonId),
      operation: "completeLesson" as const,
      result: Object.prototype.hasOwnProperty.call(value, "result")
        ? parseResult(value.result)
        : "Зачёт",
      status: "Выполнен" as const,
      understanding: parseUnderstanding(value.understanding),
    });
  }

  if (value.status === "Частично выполнен") {
    if (
      !hasExactKeys(
        value,
        [
          "artifactUrl",
          "autonomy",
          "comment",
          "lessonId",
          "operation",
          "status",
          "understanding",
        ],
        ["autonomy", "lessonId", "operation", "status", "understanding"],
      )
    ) {
      return invalidCommand();
    }

    const comment = optionalComment(value);
    const artifactUrl = optionalArtifactUrl(value);
    return Object.freeze({
      ...(artifactUrl === undefined ? {} : { artifactUrl }),
      autonomy: parseAutonomy(value.autonomy),
      ...(comment === undefined ? {} : { comment }),
      lessonId: parseLessonId(value.lessonId),
      operation: "completeLesson" as const,
      status: "Частично выполнен" as const,
      understanding: parseUnderstanding(value.understanding),
    });
  }

  if (value.status === "Пропущен") {
    if (
      !hasExactKeys(
        value,
        ["comment", "lessonId", "missedReason", "operation", "status"],
        ["lessonId", "missedReason", "operation", "status"],
      )
    ) {
      return invalidCommand();
    }

    const comment = optionalComment(value);
    return Object.freeze({
      ...(comment === undefined ? {} : { comment }),
      lessonId: parseLessonId(value.lessonId),
      missedReason: parseMissedReason(value.missedReason),
      operation: "completeLesson" as const,
      status: "Пропущен" as const,
    });
  }

  return invalidCommand();
}

export function countUnicodeCodePoints(value: string): number {
  return Array.from(value).length;
}

export function validateArtifactUrl(value: unknown): string | null {
  if (value === null) {
    return null;
  }

  if (typeof value !== "string") {
    return invalidCommand();
  }

  const input = value.trim();
  if (
    input.length === 0 ||
    countUnicodeCodePoints(input) > 2048
  ) {
    return invalidCommand();
  }

  let parsed: URL;
  try {
    parsed = new URL(input);
  } catch {
    return invalidCommand();
  }

  if (
    parsed.protocol !== "https:" ||
    !parsed.hostname ||
    parsed.username ||
    parsed.password ||
    countUnicodeCodePoints(parsed.href) > 2048
  ) {
    return invalidCommand();
  }

  return parsed.href;
}

export function parseSchoolCommand(value: unknown): SchoolCommand {
  if (!isRecord(value) || typeof value.operation !== "string") {
    return invalidCommand();
  }

  const operation = value.operation;

  if (operation === "listLessons") {
    if (
      hasExactKeys(value, ["operation", "week"]) &&
      value.week === ACTIVE_LESSON_WEEK
    ) {
      return Object.freeze({
        operation: "listLessons" as const,
        week: ACTIVE_LESSON_WEEK,
      });
    }

    if (
      hasExactKeys(value, ["from", "operation", "to"])
    ) {
      const from = parseActiveWeekDate(value.from);
      const to = parseActiveWeekDate(value.to);
      if (from > to) {
        return invalidCommand();
      }
      return Object.freeze({
        from,
        operation: "listLessons" as const,
        to,
      });
    }

    return invalidCommand();
  }

  if (
    operation === "getLessonContent" ||
    operation === "startLesson" ||
    operation === "reopenLesson" ||
    operation === "restoreCancelledLesson" ||
    operation === "correctMissedStatus" ||
    operation === "requestCrossWeekMove" ||
    operation === "clearDecisionRequest"
  ) {
    if (!hasExactKeys(value, ["lessonId", "operation"])) {
      return invalidCommand();
    }
    return Object.freeze({
      lessonId: parseLessonId(value.lessonId),
      operation,
    }) as SchoolCommand;
  }

  if (operation === "switchActiveLesson") {
    if (
      !hasExactKeys(
        value,
        ["newLessonId", "operation", "previousLessonId"],
      )
    ) {
      return invalidCommand();
    }
    const previousLessonId = parseLessonId(value.previousLessonId);
    const newLessonId = parseLessonId(value.newLessonId);
    if (previousLessonId === newLessonId) {
      return invalidCommand();
    }
    return Object.freeze({
      newLessonId,
      operation,
      previousLessonId,
    });
  }

  if (operation === "resolveActiveLessons") {
    if (!hasExactKeys(value, ["keepLessonId", "operation"])) {
      return invalidCommand();
    }
    return Object.freeze({
      keepLessonId: parseLessonId(value.keepLessonId),
      operation,
    });
  }

  if (
    operation === "moveLesson" ||
    operation === "pauseAndMoveLesson" ||
    operation === "restoreMissedLesson"
  ) {
    if (
      !hasExactKeys(
        value,
        ["allowOverlap", "destination", "lessonId", "operation", "order"],
        ["destination", "lessonId", "operation", "order"],
      )
    ) {
      return invalidCommand();
    }
    const destination = parseDestination(
      value.destination,
      operation === "pauseAndMoveLesson",
    );
    if (
      operation !== "pauseAndMoveLesson" &&
      destination.kind === "unscheduled"
    ) {
      return invalidCommand();
    }
    const allowOverlap = optionalAllowOverlap(value);
    return Object.freeze({
      ...(allowOverlap === undefined ? {} : { allowOverlap }),
      destination,
      lessonId: parseLessonId(value.lessonId),
      operation,
      order: parseFiniteNumber(value.order),
    }) as SchoolCommand;
  }

  if (operation === "unscheduleLesson") {
    if (!hasExactKeys(value, ["lessonId", "operation", "order"])) {
      return invalidCommand();
    }
    return Object.freeze({
      lessonId: parseLessonId(value.lessonId),
      operation,
      order: parseFiniteNumber(value.order),
    });
  }

  if (operation === "changeLessonDuration") {
    if (
      !hasExactKeys(
        value,
        ["allowOverlap", "durationMinutes", "lessonId", "operation"],
        ["durationMinutes", "lessonId", "operation"],
      )
    ) {
      return invalidCommand();
    }
    if (
      typeof value.durationMinutes !== "number" ||
      !Number.isInteger(value.durationMinutes) ||
      value.durationMinutes < 15 ||
      value.durationMinutes > 180
    ) {
      return invalidCommand();
    }
    const allowOverlap = optionalAllowOverlap(value);
    return Object.freeze({
      ...(allowOverlap === undefined ? {} : { allowOverlap }),
      durationMinutes: value.durationMinutes,
      lessonId: parseLessonId(value.lessonId),
      operation,
    });
  }

  if (operation === "reorderLesson") {
    if (!hasExactKeys(value, ["lessonId", "operation", "order"])) {
      return invalidCommand();
    }
    return Object.freeze({
      lessonId: parseLessonId(value.lessonId),
      operation,
      order: parseFiniteNumber(value.order),
    });
  }

  if (operation === "completeLesson") {
    return parseCompleteLesson(value);
  }

  if (operation === "cancelLesson") {
    if (
      !hasExactKeys(
        value,
        ["confirmLearningEvidence", "lessonId", "operation"],
        ["lessonId", "operation"],
      ) ||
      Object.prototype.hasOwnProperty.call(
          value,
          "confirmLearningEvidence",
        ) &&
        typeof value.confirmLearningEvidence !== "boolean"
    ) {
      return invalidCommand();
    }
    return Object.freeze({
      ...(Object.prototype.hasOwnProperty.call(
          value,
          "confirmLearningEvidence",
        )
        ? { confirmLearningEvidence: value.confirmLearningEvidence as boolean }
        : {}),
      lessonId: parseLessonId(value.lessonId),
      operation,
    });
  }

  if (operation === "clearLearningEvidence") {
    if (
      !hasExactKeys(value, ["confirm", "lessonId", "operation"]) ||
      value.confirm !== true
    ) {
      return invalidCommand();
    }
    return Object.freeze({
      confirm: true as const,
      lessonId: parseLessonId(value.lessonId),
      operation,
    });
  }

  return invalidCommand();
}

export function assertLessonBelongsToSchool(
  page: NotionPage,
  notionDataSourceId: string,
): NotionPage {
  if (!notionDataSourceId) {
    throw new SchoolHttpError(
      500,
      "SERVER_MISCONFIGURED",
      "server configuration is invalid",
    );
  }

  if (
    page.object !== "page" ||
    !("url" in page) ||
    !("properties" in page) ||
    page.parent.type !== "data_source_id" ||
    page.parent.data_source_id !== notionDataSourceId ||
    page.in_trash ||
    page.archived ||
    page.is_archived
  ) {
    throw new SchoolHttpError(
      404,
      "LESSON_OUTSIDE_SCHOOL_DATABASE",
      "lesson is outside the school database",
    );
  }

  return page;
}
