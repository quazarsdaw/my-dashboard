import { SchoolHttpError } from "./errors.ts";
import { LESSON_DECISION_REQUESTS } from "./types.ts";
import type {
  Lesson,
  LessonDestination,
  NotionPageUpdateResponse,
  NotionUpdateProperties,
  SchoolCommand,
  SchoolNotionMutationClient,
} from "./types.ts";
import { assertLessonBelongsToSchool } from "./validation.ts";

export const WRITE_PROPERTY_NAMES = Object.freeze(
  [
    "Начало и окончание",
    "Статус",
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

const writePropertyNames = new Set<string>(WRITE_PROPERTY_NAMES);

export type WhitelistedProperties = NotionUpdateProperties;

function select(name: string | null) {
  return { select: name === null ? null : { name } };
}

function number(value: number | null) {
  return { number: value };
}

function richText(value: string) {
  return {
    rich_text: value.length === 0
      ? []
      : [{ text: { content: value }, type: "text" as const }],
  };
}

function url(value: string | null) {
  return { url: value };
}

function notionDate(start: string, end: string | null) {
  return {
    date: {
      end,
      start,
      time_zone: null,
    },
  };
}

function addMinutesPreservingOffset(start: string, minutes: number): string {
  const timestamp = Date.parse(start);
  if (!Number.isFinite(timestamp)) {
    throw new SchoolHttpError(
      400,
      "INVALID_COMMAND",
      "command payload is invalid",
    );
  }

  if (start.endsWith("Z")) {
    return new Date(timestamp + minutes * 60_000).toISOString();
  }

  const offsetMatch = start.match(/([+-])(\d{2}):(\d{2})$/);
  if (!offsetMatch) {
    throw new SchoolHttpError(
      400,
      "INVALID_COMMAND",
      "command payload is invalid",
    );
  }

  const direction = offsetMatch[1] === "+" ? 1 : -1;
  const offsetMinutes = direction *
    (Number(offsetMatch[2]) * 60 + Number(offsetMatch[3]));
  const localTimestamp = timestamp + minutes * 60_000 +
    offsetMinutes * 60_000;
  const local = new Date(localTimestamp).toISOString().slice(0, 19);
  const end = `${local}${offsetMatch[0]}`;

  if (end.slice(0, 10) !== start.slice(0, 10)) {
    throw new SchoolHttpError(
      400,
      "INVALID_COMMAND",
      "timed lesson must end on the same calendar day",
    );
  }

  return end;
}

function destinationDate(destination: LessonDestination): string | null {
  if (destination.kind === "date-only") {
    return destination.date;
  }
  if (destination.kind === "timed") {
    return destination.start.slice(0, 10);
  }
  return null;
}

function scheduleProperties(
  destination: LessonDestination,
  order: number,
  currentLesson: Lesson,
): WhitelistedProperties {
  const targetDate = destinationDate(destination);
  const changedDay = currentLesson.schedule.date !== null &&
    targetDate !== null &&
    currentLesson.schedule.date !== targetDate;

  if (destination.kind === "unscheduled") {
    return {
      "Начало и окончание": { date: null },
      "Порядок": number(order),
    };
  }

  const schedule = destination.kind === "date-only"
    ? notionDate(destination.date, null)
    : notionDate(
      destination.start,
      addMinutesPreservingOffset(
        destination.start,
        currentLesson.durationMinutes,
      ),
    );

  return {
    ...(changedDay
      ? {
        "Количество переносов": number(currentLesson.moveCount + 1),
      }
      : {}),
    "Начало и окончание": schedule,
    "Порядок": number(order),
  };
}

function assessmentProperties(
  command: Extract<SchoolCommand, { operation: "completeLesson" }>,
): WhitelistedProperties {
  if (command.status === "Выполнен") {
    return {
      ...("artifactUrl" in command
        ? { "Артефакт": url(command.artifactUrl ?? null) }
        : {}),
      "Автономность": select(command.autonomy),
      ...("comment" in command
        ? { "Краткий комментарий": richText(command.comment ?? "") }
        : {}),
      "Понимание": number(command.understanding),
      "Причина пропуска": select(null),
      "Результат": select(command.result),
      "Статус": select("Выполнен"),
    };
  }

  if (command.status === "Частично выполнен") {
    return {
      ...("artifactUrl" in command
        ? { "Артефакт": url(command.artifactUrl ?? null) }
        : {}),
      "Автономность": select(command.autonomy),
      ...("comment" in command
        ? { "Краткий комментарий": richText(command.comment ?? "") }
        : {}),
      "Понимание": number(command.understanding),
      "Причина пропуска": select(null),
      "Результат": select("Требует повторения"),
      "Статус": select("Частично выполнен"),
    };
  }

  return {
    "Автономность": select(null),
    "Понимание": number(null),
    "Причина пропуска": select(command.missedReason),
    "Результат": select(null),
    "Статус": select("Пропущен"),
    ...("comment" in command
      ? { "Краткий комментарий": richText(command.comment ?? "") }
      : {}),
  };
}

function invalidMutationCommand(): never {
  throw new SchoolHttpError(
    400,
    "INVALID_COMMAND",
    "command is not a mutation",
  );
}

export function buildWhitelistedProperties(
  command: SchoolCommand,
  currentLesson: Lesson,
): WhitelistedProperties {
  switch (command.operation) {
    case "startLesson":
    case "reopenLesson":
      return { "Статус": select("В процессе") };

    case "switchActiveLesson":
      if (currentLesson.id === command.previousLessonId) {
        return { "Статус": select("Запланирован") };
      }
      if (currentLesson.id === command.newLessonId) {
        return { "Статус": select("В процессе") };
      }
      return invalidMutationCommand();

    case "resolveActiveLessons":
      return {
        "Статус": select(
          currentLesson.id === command.keepLessonId
            ? "В процессе"
            : "Запланирован",
        ),
      };

    case "completeLesson":
      return assessmentProperties(command);

    case "cancelLesson":
      return {
        "Статус": select("Отменён"),
        "Требует решения": select(null),
      };

    case "restoreCancelledLesson":
      return { "Статус": select("Запланирован") };

    case "correctMissedStatus":
      return {
        "Причина пропуска": select(null),
        "Статус": select("Запланирован"),
      };

    case "clearLearningEvidence":
      return {
        "Артефакт": url(null),
        "Автономность": select(null),
        "Краткий комментарий": richText(""),
        "Понимание": number(null),
        "Результат": select(null),
      };

    case "requestCrossWeekMove":
      return {
        "Требует решения": select(LESSON_DECISION_REQUESTS[0]),
      };

    case "clearDecisionRequest":
      return { "Требует решения": select(null) };

    case "reorderLesson":
      return { "Порядок": number(command.order) };

    case "changeLessonDuration": {
      if (currentLesson.schedule.kind !== "timed") {
        return {
          "Продолжительность, мин": number(command.durationMinutes),
        };
      }

      return {
        "Начало и окончание": notionDate(
          currentLesson.schedule.start,
          addMinutesPreservingOffset(
            currentLesson.schedule.start,
            command.durationMinutes,
          ),
        ),
        "Продолжительность, мин": number(command.durationMinutes),
      };
    }

    case "moveLesson": {
      const properties = scheduleProperties(
        command.destination,
        command.order,
        currentLesson,
      );
      return currentLesson.status === "Нераспределён"
        ? { ...properties, "Статус": select("Запланирован") }
        : properties;
    }

    case "unscheduleLesson":
      return {
        "Начало и окончание": { date: null },
        "Порядок": number(command.order),
        "Статус": select("Нераспределён"),
      };

    case "pauseAndMoveLesson":
      return {
        ...scheduleProperties(
          command.destination,
          command.order,
          currentLesson,
        ),
        "Статус": select("Запланирован"),
      };

    case "restoreMissedLesson":
      return {
        "Автономность": select(null),
        ...scheduleProperties(
          command.destination,
          command.order,
          currentLesson,
        ),
        "Понимание": number(null),
        "Причина пропуска": select(null),
        "Результат": select(null),
        "Статус": select("Запланирован"),
      };

    case "listLessons":
    case "getLessonContent":
      return invalidMutationCommand();
  }
}

function assertOnlyWhitelistedProperties(
  properties: WhitelistedProperties,
): void {
  const names = Object.keys(properties);
  if (
    names.length === 0 ||
    names.some((name) => !writePropertyNames.has(name))
  ) {
    throw new SchoolHttpError(
      500,
      "INVALID_NOTION_UPDATE",
      "server generated an invalid notion update",
    );
  }
}

export async function updateWhitelistedSchoolLesson(
  client: SchoolNotionMutationClient,
  pageId: string,
  notionDataSourceId: string,
  properties: WhitelistedProperties,
): Promise<NotionPageUpdateResponse> {
  assertOnlyWhitelistedProperties(properties);
  const page = await client.retrievePage(pageId);
  assertLessonBelongsToSchool(page, notionDataSourceId);
  return await client.updatePage(pageId, properties);
}
