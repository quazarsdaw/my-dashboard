import {
  buildWhitelistedProperties,
  updateWhitelistedSchoolLesson,
  WRITE_PROPERTY_NAMES,
} from "../notion-properties.ts";
import { parseSchoolCommand } from "../validation.ts";
import {
  ACTIVE_LESSON_WEEK,
  type Lesson,
  type SchoolNotionMutationClient,
} from "../types.ts";
import { createActiveLessonRepository } from "../lesson-repository.ts";
import {
  notionLessonPage,
  notionQueryResponse,
} from "./fixtures/notion-lessons.ts";

function assert(
  condition: unknown,
  message: string,
): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

function assertEquals<T>(actual: T, expected: T, message: string): void {
  if (actual !== expected) {
    throw new Error(
      `${message}: expected ${String(expected)}, got ${String(actual)}`,
    );
  }
}

function assertJsonEquals(
  actual: unknown,
  expected: unknown,
  message: string,
): void {
  const actualJson = JSON.stringify(actual);
  const expectedJson = JSON.stringify(expected);
  if (actualJson !== expectedJson) {
    throw new Error(
      `${message}: expected ${expectedJson}, got ${actualJson}`,
    );
  }
}

function lesson(overrides: Partial<Lesson> = {}): Lesson {
  return {
    artifactUrl: null,
    autonomy: null,
    comment: "",
    decisionRequest: null,
    durationMinutes: 45,
    hasLearningEvidence: false,
    id: "lesson-id",
    isFinalized: false,
    missedReason: null,
    module: "Environment & Setup",
    moveCount: 0,
    order: 100,
    priority: "Must",
    result: null,
    schedule: {
      date: "2026-08-03",
      end: null,
      kind: "date-only",
      start: null,
    },
    status: "Запланирован",
    subject: "Software Engineering",
    title: "Cold start «Прометея»",
    understanding: null,
    warnings: [],
    week: ACTIVE_LESSON_WEEK,
    ...overrides,
  };
}

function assertOnlyWhitelisted(properties: Readonly<Record<string, unknown>>) {
  const allowed = new Set<string>(WRITE_PROPERTY_NAMES);
  assert(
    Object.keys(properties).every((name) => allowed.has(name)),
    "property mapper emitted a non-whitelisted notion property",
  );
}

if (typeof Deno !== "undefined") {
  Deno.test("start command emits only the canonical status property", () => {
    const properties = buildWhitelistedProperties(
      parseSchoolCommand({
        lessonId: "lesson-id",
        operation: "startLesson",
      }),
      lesson(),
    );

    assertJsonEquals(
      properties,
      { Статус: { select: { name: "В процессе" } } },
      "start properties",
    );
    assertOnlyWhitelisted(properties);
  });

  Deno.test("completed assessment maps normalized values and never accepts raw property names", () => {
    const properties = buildWhitelistedProperties(
      parseSchoolCommand({
        artifactUrl: "https://example.com/setup",
        autonomy: "A3",
        comment: "готово",
        lessonId: "lesson-id",
        operation: "completeLesson",
        result: "Незачёт",
        status: "Выполнен",
        understanding: 2,
      }),
      lesson(),
    );

    assertJsonEquals(
      properties,
      {
        "Артефакт": { url: "https://example.com/setup" },
        "Автономность": { select: { name: "A3" } },
        "Краткий комментарий": {
          rich_text: [{ text: { content: "готово" }, type: "text" }],
        },
        "Понимание": { number: 2 },
        "Причина пропуска": { select: null },
        "Результат": { select: { name: "Незачёт" } },
        "Статус": { select: { name: "Выполнен" } },
      },
      "completed properties",
    );
    assertOnlyWhitelisted(properties);
  });

  Deno.test("partial result is derived and missed clears stale assessment fields", () => {
    const partial = buildWhitelistedProperties(
      parseSchoolCommand({
        autonomy: "A1",
        lessonId: "lesson-id",
        operation: "completeLesson",
        status: "Частично выполнен",
        understanding: 1,
      }),
      lesson(),
    );
    assertJsonEquals(
      partial.Результат,
      { select: { name: "Требует повторения" } },
      "partial result",
    );

    const missed = buildWhitelistedProperties(
      parseSchoolCommand({
        lessonId: "lesson-id",
        missedReason: "Низкая энергия",
        operation: "completeLesson",
        status: "Пропущен",
      }),
      lesson({
        artifactUrl: "https://example.com/existing",
        autonomy: "A2",
        result: "Зачёт",
        understanding: 3,
      }),
    );
    assertJsonEquals(
      missed,
      {
        "Автономность": { select: null },
        "Понимание": { number: null },
        "Причина пропуска": { select: { name: "Низкая энергия" } },
        "Результат": { select: null },
        "Статус": { select: { name: "Пропущен" } },
      },
      "missed properties",
    );
    assert(
      !("Артефакт" in missed),
      "missed mutation must not create or clear artifact data",
    );
  });

  Deno.test("timed move derives end from canonical duration and increments only across days", () => {
    const moved = buildWhitelistedProperties(
      parseSchoolCommand({
        allowOverlap: false,
        destination: {
          kind: "timed",
          start: "2026-08-04T14:15:00+05:00",
        },
        lessonId: "lesson-id",
        operation: "moveLesson",
        order: 150,
      }),
      lesson({ durationMinutes: 60, moveCount: 2 }),
    );

    assertJsonEquals(
      moved,
      {
        "Количество переносов": { number: 3 },
        "Начало и окончание": {
          date: {
            end: "2026-08-04T15:15:00+05:00",
            start: "2026-08-04T14:15:00+05:00",
            time_zone: null,
          },
        },
        "Порядок": { number: 150 },
      },
      "cross-day timed move",
    );

    const sameDay = buildWhitelistedProperties(
      parseSchoolCommand({
        destination: {
          kind: "timed",
          start: "2026-08-03T15:00:00+05:00",
        },
        lessonId: "lesson-id",
        operation: "moveLesson",
        order: 100,
      }),
      lesson({ moveCount: 2 }),
    );
    assert(
      !("Количество переносов" in sameDay),
      "same-day time change must not increment move count",
    );
  });

  Deno.test("date-only and unscheduled moves preserve canonical duration", () => {
    const dateOnly = buildWhitelistedProperties(
      parseSchoolCommand({
        destination: { date: "2026-08-05", kind: "date-only" },
        lessonId: "lesson-id",
        operation: "moveLesson",
        order: 200,
      }),
      lesson({ durationMinutes: 60 }),
    );
    assertJsonEquals(
      dateOnly["Начало и окончание"],
      {
        date: {
          end: null,
          start: "2026-08-05",
          time_zone: null,
        },
      },
      "date-only schedule",
    );
    assert(
      !("Продолжительность, мин" in dateOnly),
      "date-only move must preserve duration",
    );

    const unscheduled = buildWhitelistedProperties(
      parseSchoolCommand({
        lessonId: "lesson-id",
        operation: "unscheduleLesson",
        order: 100,
      }),
      lesson({ durationMinutes: 60 }),
    );
    assertJsonEquals(
      unscheduled,
      {
        "Начало и окончание": { date: null },
        "Порядок": { number: 100 },
        "Статус": { select: { name: "Нераспределён" } },
      },
      "unscheduled properties",
    );

    const pausedToUnscheduled = buildWhitelistedProperties(
      parseSchoolCommand({
        destination: { kind: "unscheduled" },
        lessonId: "lesson-id",
        operation: "pauseAndMoveLesson",
        order: 100,
      }),
      lesson({ status: "В процессе" }),
    );
    assertJsonEquals(
      pausedToUnscheduled.Статус,
      { select: { name: "Нераспределён" } },
      "paused unscheduled status",
    );
  });

  Deno.test("duration change preserves start and recomputes timed end", () => {
    const properties = buildWhitelistedProperties(
      parseSchoolCommand({
        durationMinutes: 60,
        lessonId: "lesson-id",
        operation: "changeLessonDuration",
      }),
      lesson({
        schedule: {
          date: "2026-08-03",
          end: "2026-08-03T14:45:00+05:00",
          kind: "timed",
          start: "2026-08-03T14:00:00+05:00",
        },
      }),
    );

    assertJsonEquals(
      properties,
      {
        "Начало и окончание": {
          date: {
            end: "2026-08-03T15:00:00+05:00",
            start: "2026-08-03T14:00:00+05:00",
            time_zone: null,
          },
        },
        "Продолжительность, мин": { number: 60 },
      },
      "duration properties",
    );
  });

  Deno.test("decision request, cancellation and evidence reset touch only explicit fields", () => {
    const requested = buildWhitelistedProperties(
      parseSchoolCommand({
        lessonId: "lesson-id",
        operation: "requestCrossWeekMove",
      }),
      lesson(),
    );
    assertJsonEquals(
      requested,
      {
        "Требует решения": {
          select: { name: "Перенос между неделями" },
        },
      },
      "decision request",
    );

    const cancelled = buildWhitelistedProperties(
      parseSchoolCommand({
        confirmLearningEvidence: true,
        lessonId: "lesson-id",
        operation: "cancelLesson",
      }),
      lesson(),
    );
    assertJsonEquals(
      cancelled,
      {
        "Статус": { select: { name: "Отменён" } },
        "Требует решения": { select: null },
      },
      "cancel properties",
    );

    const cleared = buildWhitelistedProperties(
      parseSchoolCommand({
        confirm: true,
        lessonId: "lesson-id",
        operation: "clearLearningEvidence",
      }),
      lesson(),
    );
    assertJsonEquals(
      cleared,
      {
        "Артефакт": { url: null },
        "Автономность": { select: null },
        "Краткий комментарий": { rich_text: [] },
        "Понимание": { number: null },
        "Результат": { select: null },
      },
      "evidence reset",
    );
  });

  Deno.test("membership is retrieved and verified before the first update", async () => {
    const events: string[] = [];
    const matchingPage = {
      archived: false,
      id: "lesson-id",
      in_trash: false,
      is_archived: false,
      object: "page",
      parent: {
        data_source_id: "school-data-source",
        type: "data_source_id",
      },
      properties: {},
      url: "https://www.notion.so/lesson-id",
    };
    const client = {
      listBlockChildren: () => Promise.reject(new Error("unused")),
      queryDataSource: () => Promise.reject(new Error("unused")),
      retrievePage: () => {
        events.push("retrieve");
        return Promise.resolve(matchingPage as never);
      },
      updatePage: (_pageId: string, properties: unknown) => {
        events.push("update");
        return Promise.resolve({ properties } as never);
      },
    } satisfies SchoolNotionMutationClient;

    await updateWhitelistedSchoolLesson(
      client,
      "lesson-id",
      "school-data-source",
      { Статус: { select: { name: "В процессе" } } },
    );

    assertJsonEquals(events, ["retrieve", "update"], "membership sequence");
  });

  Deno.test("page outside the school database is never updated", async () => {
    let updateCalled = false;
    const client = {
      listBlockChildren: () => Promise.reject(new Error("unused")),
      queryDataSource: () => Promise.reject(new Error("unused")),
      retrievePage: () =>
        Promise.resolve({
          archived: false,
          id: "lesson-id",
          in_trash: false,
          is_archived: false,
          object: "page",
          parent: {
            data_source_id: "other-data-source",
            type: "data_source_id",
          },
          properties: {},
          url: "https://www.notion.so/lesson-id",
        } as never),
      updatePage: () => {
        updateCalled = true;
        return Promise.resolve({} as never);
      },
    } satisfies SchoolNotionMutationClient;

    try {
      await updateWhitelistedSchoolLesson(
        client,
        "lesson-id",
        "school-data-source",
        { Статус: { select: { name: "В процессе" } } },
      );
    } catch {
      assertEquals(updateCalled, false, "update outside school");
      return;
    }

    throw new Error("expected school membership rejection");
  });

  Deno.test("first mutation persists an inferred legacy duration", async () => {
    const legacy = notionLessonPage({
      date: {
        end: "2026-08-03T15:00:00+05:00",
        start: "2026-08-03T14:00:00+05:00",
        time_zone: null,
      },
      durationMinutes: null,
      id: "legacy-duration",
    });
    const canonical = notionLessonPage({
      date: {
        end: "2026-08-03T15:00:00+05:00",
        start: "2026-08-03T14:00:00+05:00",
        time_zone: null,
      },
      durationMinutes: 60,
      id: "legacy-duration",
      order: 150,
    });
    let writtenProperties: Record<string, unknown> | null = null;
    const client = {
      listBlockChildren: () => Promise.reject(new Error("unused")),
      queryDataSource: () => Promise.resolve(notionQueryResponse([])),
      retrievePage: () => Promise.resolve(legacy),
      updatePage: (_pageId: string, properties: Record<string, unknown>) => {
        writtenProperties = properties;
        return Promise.resolve(canonical);
      },
    } satisfies SchoolNotionMutationClient;
    const repository = createActiveLessonRepository(
      client,
      "server-only-data-source-id",
    );
    const current = await repository.getLesson("legacy-duration");

    await repository.updateLesson(
      {
        lessonId: "legacy-duration",
        operation: "reorderLesson",
        order: 150,
      },
      current,
    );

    assertJsonEquals(
      writtenProperties?.["Продолжительность, мин"],
      { number: 60 },
      "persisted inferred duration",
    );
  });
}
