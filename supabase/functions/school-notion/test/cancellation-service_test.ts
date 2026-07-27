import { createAssessmentService } from "../assessment-service.ts";
import { SchoolHttpError } from "../errors.ts";
import {
  ACTIVE_LESSON_WEEK,
  type ActiveLessonRepository,
  type Lesson,
  type SchoolCommand,
  type SchoolLockService,
} from "../types.ts";

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

function lock(events: string[]): SchoolLockService {
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

function repositoryState(initial: Lesson, events: string[]) {
  let current = initial;
  const repository: ActiveLessonRepository = {
    getLesson: () => Promise.resolve(current),
    listActiveLessons: () =>
      Promise.resolve(current.status === "В процессе" ? [current] : []),
    updateLesson: (command: SchoolCommand) => {
      events.push(`update:${command.operation}`);
      switch (command.operation) {
        case "cancelLesson":
          current = lesson("Отменён", {
            artifactUrl: current.artifactUrl,
            autonomy: current.autonomy,
            comment: current.comment,
            decisionRequest: null,
            hasLearningEvidence: current.hasLearningEvidence,
            result: current.result,
            understanding: current.understanding,
          });
          break;
        case "restoreCancelledLesson":
          current = lesson("Запланирован", {
            artifactUrl: current.artifactUrl,
            autonomy: current.autonomy,
            comment: current.comment,
            hasLearningEvidence: current.hasLearningEvidence,
            result: current.result,
            understanding: current.understanding,
          });
          break;
        case "correctMissedStatus":
          current = lesson("Запланирован", {
            missedReason: null,
          });
          break;
        case "clearLearningEvidence":
          current = lesson(current.status, {
            artifactUrl: null,
            autonomy: null,
            comment: "",
            hasLearningEvidence: false,
            result: null,
            understanding: null,
          });
          break;
        default:
          throw new Error(`unexpected command ${command.operation}`);
      }
      return Promise.resolve(current);
    },
  };
  return {
    current: () => current,
    repository,
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
  Deno.test("empty scheduled lesson cancels without changing assessment history", async () => {
    const events: string[] = [];
    const state = repositoryState(lesson(), events);
    const service = createAssessmentService(state.repository, lock(events));

    const result = await service.cancelLesson("owner", {
      lessonId: "lesson-id",
      operation: "cancelLesson",
    });

    assertEquals(result.status, "Отменён", "cancelled status");
    assertEquals(result.result, null, "unchanged result");
    assertEquals(events.includes("acquire"), false, "unnecessary lock");
  });

  Deno.test("active or evidence-bearing lesson requires reinforced confirmation", async () => {
    for (
      const started of [
        lesson("В процессе"),
        lesson("Запланирован", {
          artifactUrl: "https://example.com/result",
          hasLearningEvidence: true,
        }),
        lesson("Запланирован", {
          comment: "student outcome",
          hasLearningEvidence: true,
        }),
      ]
    ) {
      const events: string[] = [];
      const state = repositoryState(started, events);
      const service = createAssessmentService(state.repository, lock(events));

      await expectCode(
        () =>
          service.cancelLesson("owner", {
            lessonId: "lesson-id",
            operation: "cancelLesson",
          }),
        "LEARNING_EVIDENCE_CONFIRMATION_REQUIRED",
      );
      assertEquals(
        events.some((event) => event.startsWith("update:")),
        false,
        "cancel without confirmation",
      );
    }
  });

  Deno.test("confirmed active cancellation uses the lock and preserves existing evidence", async () => {
    const events: string[] = [];
    const state = repositoryState(
      lesson("В процессе", {
        artifactUrl: "https://example.com/result",
        autonomy: "A2",
        comment: "saved",
        hasLearningEvidence: true,
        result: "Зачёт",
        understanding: 3,
      }),
      events,
    );
    const service = createAssessmentService(state.repository, lock(events));

    const result = await service.cancelLesson("owner", {
      confirmLearningEvidence: true,
      lessonId: "lesson-id",
      operation: "cancelLesson",
    });

    assertEquals(result.status, "Отменён", "cancelled active status");
    assertEquals(result.result, "Зачёт", "preserved result");
    assertEquals(result.autonomy, "A2", "preserved autonomy");
    assertEquals(result.understanding, 3, "preserved understanding");
    assertEquals(result.comment, "saved", "preserved comment");
    assertEquals(
      result.artifactUrl,
      "https://example.com/result",
      "preserved artifact",
    );
    assert(
      events.includes("acquire") && events.includes("release"),
      "active cancel lock",
    );
  });

  Deno.test("finalized completed and partial lessons cannot be cancelled directly", async () => {
    for (const status of ["Выполнен", "Частично выполнен"] as const) {
      const events: string[] = [];
      const state = repositoryState(lesson(status), events);
      const service = createAssessmentService(state.repository, lock(events));

      await expectCode(
        () =>
          service.cancelLesson("owner", {
            confirmLearningEvidence: true,
            lessonId: "lesson-id",
            operation: "cancelLesson",
          }),
        "FINALIZED_LESSON_REOPEN_REQUIRED",
      );
    }
  });

  Deno.test("missed lesson requires status correction before cancellation", async () => {
    const events: string[] = [];
    const state = repositoryState(
      lesson("Пропущен", {
        missedReason: "Техническая проблема",
      }),
      events,
    );
    const service = createAssessmentService(state.repository, lock(events));

    await expectCode(
      () =>
        service.cancelLesson("owner", {
          lessonId: "lesson-id",
          operation: "cancelLesson",
        }),
      "MISSED_STATUS_CORRECTION_REQUIRED",
    );
  });

  Deno.test("restore keeps historical evidence and correct missed clears only the reason", async () => {
    const events: string[] = [];
    const cancelled = repositoryState(
      lesson("Отменён", {
        artifactUrl: "https://example.com/result",
        autonomy: "A2",
        comment: "saved",
        hasLearningEvidence: true,
        result: "Зачёт",
        understanding: 3,
      }),
      events,
    );
    const service = createAssessmentService(
      cancelled.repository,
      lock(events),
    );

    const restored = await service.restoreCancelledLesson("owner", {
      lessonId: "lesson-id",
      operation: "restoreCancelledLesson",
    });
    assertEquals(restored.status, "Запланирован", "restored status");
    assertEquals(restored.hasLearningEvidence, true, "preserved evidence");
    assertEquals(restored.result, "Зачёт", "restored result");

    const missed = repositoryState(
      lesson("Пропущен", {
        missedReason: "Низкая энергия",
      }),
      events,
    );
    const missedService = createAssessmentService(
      missed.repository,
      lock(events),
    );
    const corrected = await missedService.correctMissedStatus("owner", {
      lessonId: "lesson-id",
      operation: "correctMissedStatus",
    });
    assertEquals(corrected.status, "Запланирован", "corrected status");
    assertEquals(corrected.missedReason, null, "cleared missed reason");
  });

  Deno.test("explicit start-over command clears only learning evidence", async () => {
    const events: string[] = [];
    const state = repositoryState(
      lesson("Запланирован", {
        artifactUrl: "https://example.com/result",
        autonomy: "A2",
        comment: "saved",
        hasLearningEvidence: true,
        result: "Зачёт",
        understanding: 3,
      }),
      events,
    );
    const service = createAssessmentService(state.repository, lock(events));

    const cleared = await service.clearLearningEvidence("owner", {
      confirm: true,
      lessonId: "lesson-id",
      operation: "clearLearningEvidence",
    });

    assertEquals(cleared.status, "Запланирован", "unchanged status");
    assertEquals(cleared.result, null, "cleared result");
    assertEquals(cleared.autonomy, null, "cleared autonomy");
    assertEquals(cleared.understanding, null, "cleared understanding");
    assertEquals(cleared.comment, "", "cleared comment");
    assertEquals(cleared.artifactUrl, null, "cleared artifact");
  });
}
