import { createAssessmentService } from "../assessment-service.ts";
import { SchoolHttpError } from "../errors.ts";
import {
  ACTIVE_LESSON_WEEK,
  type ActiveLessonRepository,
  type Lesson,
  type SchoolCommand,
  type SchoolLockService,
} from "../types.ts";
import { parseSchoolCommand } from "../validation.ts";

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

function lesson(
  status: Lesson["status"] = "Запланирован",
  overrides: Partial<Lesson> = {},
): Lesson {
  return {
    artifactUrl: null,
    autonomy: null,
    comment: "",
    decisionRequest: null,
    durationMinutes: 45,
    hasLearningEvidence: status === "В процессе" ||
      status === "Выполнен" ||
      status === "Частично выполнен",
    id: "lesson-id",
    isFinalized: status === "Выполнен" ||
      status === "Частично выполнен" ||
      status === "Пропущен",
    missedReason: null,
    module: "module",
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
    status,
    subject: "Software Engineering",
    title: "lesson title",
    understanding: null,
    warnings: [],
    week: ACTIVE_LESSON_WEEK,
    ...overrides,
  };
}

function trackingLock(events: string[]): SchoolLockService {
  return {
    async withActiveLessonLock<T>(
      _ownerId: string,
      operation: Parameters<
        SchoolLockService["withActiveLessonLock"]
      >[1],
    ): Promise<T> {
      events.push("acquire");
      try {
        return await operation({
          renew: () => {
            events.push("renew");
            return Promise.resolve();
          },
        }) as T;
      } finally {
        events.push("release");
      }
    },
  };
}

function stateRepository(
  initial: Lesson,
  events: string[],
): {
  current(): Lesson;
  repository: ActiveLessonRepository;
} {
  let current = initial;

  return {
    current: () => current,
    repository: {
      getLesson: () => {
        events.push("read:lesson");
        return Promise.resolve(current);
      },
      listActiveLessons: () => {
        events.push("read:active");
        return Promise.resolve(
          current.status === "В процессе" ? [current] : [],
        );
      },
      updateLesson: (command: SchoolCommand) => {
        events.push(`update:${command.operation}`);
        if (command.operation !== "completeLesson") {
          throw new Error("unexpected command");
        }

        if (command.status === "Выполнен") {
          current = lesson("Выполнен", {
            artifactUrl: command.artifactUrl ?? current.artifactUrl,
            autonomy: command.autonomy,
            comment: command.comment ?? current.comment,
            hasLearningEvidence: true,
            isFinalized: true,
            result: command.result,
            understanding: command.understanding,
          });
        } else if (command.status === "Частично выполнен") {
          current = lesson("Частично выполнен", {
            artifactUrl: command.artifactUrl ?? current.artifactUrl,
            autonomy: command.autonomy,
            comment: command.comment ?? current.comment,
            hasLearningEvidence: true,
            isFinalized: true,
            result: "Требует повторения",
            understanding: command.understanding,
          });
        } else {
          current = lesson("Пропущен", {
            autonomy: null,
            comment: command.comment ?? current.comment,
            isFinalized: true,
            missedReason: command.missedReason,
            result: null,
            understanding: null,
          });
        }

        return Promise.resolve(current);
      },
    },
  };
}

async function expectCode(
  action: () => Promise<unknown>,
  code: string,
): Promise<void> {
  try {
    await action();
  } catch (error) {
    assert(error instanceof SchoolHttpError, "expected SchoolHttpError");
    assertEquals(error.code, code, "error code");
    return;
  }
  throw new Error(`expected ${code}`);
}

if (typeof Deno !== "undefined") {
  Deno.test("completed lesson defaults to pass but keeps the selected editable result", async () => {
    const events: string[] = [];
    const state = stateRepository(lesson(), events);
    const service = createAssessmentService(
      state.repository,
      trackingLock(events),
    );

    const defaultResult = await service.completeLesson(
      "owner",
      parseSchoolCommand({
        autonomy: "A2",
        lessonId: "lesson-id",
        operation: "completeLesson",
        status: "Выполнен",
        understanding: 3,
      }) as Extract<SchoolCommand, { operation: "completeLesson" }>,
    );
    assertEquals(defaultResult.result, "Зачёт", "default completed result");

    const corrected = await service.completeLesson(
      "owner",
      parseSchoolCommand({
        autonomy: "A1",
        lessonId: "lesson-id",
        operation: "completeLesson",
        result: "Незачёт",
        status: "Выполнен",
        understanding: 2,
      }) as Extract<SchoolCommand, { operation: "completeLesson" }>,
    );
    assertEquals(corrected.result, "Незачёт", "corrected result");
  });

  Deno.test("partial lesson always stores requires-repetition with required assessment", async () => {
    const events: string[] = [];
    const state = stateRepository(lesson(), events);
    const service = createAssessmentService(
      state.repository,
      trackingLock(events),
    );

    const result = await service.completeLesson("owner", {
      autonomy: "A3",
      lessonId: "lesson-id",
      operation: "completeLesson",
      status: "Частично выполнен",
      understanding: 1,
    });

    assertEquals(result.status, "Частично выполнен", "partial status");
    assertEquals(result.result, "Требует повторения", "partial result");
    assertEquals(result.autonomy, "A3", "partial autonomy");
    assertEquals(result.understanding, 1, "partial understanding");
  });

  Deno.test("missed lesson clears stale assessment and requires a missed reason", async () => {
    const events: string[] = [];
    const state = stateRepository(
      lesson("Запланирован", {
        autonomy: "A2",
        result: "Зачёт",
        understanding: 3,
      }),
      events,
    );
    const service = createAssessmentService(
      state.repository,
      trackingLock(events),
    );

    const result = await service.completeLesson("owner", {
      lessonId: "lesson-id",
      missedReason: "Низкая энергия",
      operation: "completeLesson",
      status: "Пропущен",
    });

    assertEquals(result.status, "Пропущен", "missed status");
    assertEquals(result.missedReason, "Низкая энергия", "missed reason");
    assertEquals(result.result, null, "cleared result");
    assertEquals(result.autonomy, null, "cleared autonomy");
    assertEquals(result.understanding, null, "cleared understanding");
  });

  Deno.test("finalizing the active lesson uses the global lock and leaves no active lesson", async () => {
    const events: string[] = [];
    const state = stateRepository(lesson("В процессе"), events);
    const service = createAssessmentService(
      state.repository,
      trackingLock(events),
    );

    const result = await service.completeLesson("owner", {
      autonomy: "A2",
      lessonId: "lesson-id",
      operation: "completeLesson",
      status: "Выполнен",
      understanding: 3,
    });

    assertEquals(result.status, "Выполнен", "final status");
    assert(
      events.includes("acquire") && events.includes("release"),
      "active finalization lock",
    );
    assertEquals(
      state.current().status === "В процессе",
      false,
      "active state after finalization",
    );
  });

  Deno.test("finalizing a non-active lesson does not take the global active lock", async () => {
    const events: string[] = [];
    const state = stateRepository(lesson(), events);
    const service = createAssessmentService(
      state.repository,
      trackingLock(events),
    );

    await service.completeLesson("owner", {
      autonomy: "A2",
      lessonId: "lesson-id",
      operation: "completeLesson",
      status: "Выполнен",
      understanding: 3,
    });

    assertEquals(events.includes("acquire"), false, "unnecessary lock");
  });

  Deno.test("cancelled lesson cannot receive new assessment data", async () => {
    const events: string[] = [];
    const state = stateRepository(lesson("Отменён"), events);
    const service = createAssessmentService(
      state.repository,
      trackingLock(events),
    );

    await expectCode(
      () =>
        service.completeLesson("owner", {
          autonomy: "A2",
          lessonId: "lesson-id",
          operation: "completeLesson",
          status: "Выполнен",
          understanding: 3,
        }),
      "LESSON_STATUS_TRANSITION_REQUIRED",
    );
  });
}
