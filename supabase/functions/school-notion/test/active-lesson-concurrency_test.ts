import { createActiveLessonService } from "../active-lesson-service.ts";
import { SchoolHttpError } from "../errors.ts";
import { createSchoolLockService } from "../lock-service.ts";
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

function lesson(
  id: string,
  status: Lesson["status"] = "Запланирован",
): Lesson {
  return {
    artifactUrl: null,
    autonomy: null,
    comment: "",
    decisionRequest: null,
    durationMinutes: 45,
    hasLearningEvidence: status === "В процессе",
    id,
    isFinalized: false,
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
    title: `lesson ${id}`,
    understanding: null,
    warnings: [],
    week: ACTIVE_LESSON_WEEK,
  };
}

function sequenceLock(
  events: string[],
  renewFailures: Set<number> = new Set(),
): SchoolLockService {
  let renewCount = 0;
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
            renewCount += 1;
            events.push("renew");
            if (renewFailures.has(renewCount)) {
              return Promise.reject(
                new SchoolHttpError(
                  409,
                  "SCHOOL_LOCK_LOST",
                  "school coordination lease was lost",
                ),
              );
            }
            return Promise.resolve();
          },
        }) as T;
      } finally {
        events.push("release");
      }
    },
  };
}

function switchRepository(
  events: string[],
  options: {
    failNewUpdate?: boolean;
  } = {},
): ActiveLessonRepository {
  let oldLesson = lesson("old", "В процессе");
  let newLesson = lesson("new", "Запланирован");
  let activeReads = 0;

  return {
    getLesson: (lessonId) => {
      events.push(`read:${lessonId}`);
      return Promise.resolve(lessonId === "old" ? oldLesson : newLesson);
    },
    listActiveLessons: () => {
      events.push("read:active");
      activeReads += 1;
      if (activeReads === 1) {
        return Promise.resolve([oldLesson]);
      }
      return Promise.resolve(
        [oldLesson, newLesson].filter((item) => item.status === "В процессе"),
      );
    },
    updateLesson: (
      command: SchoolCommand,
      currentLesson: Lesson,
    ) => {
      const nextStatus = command.operation === "reopenLesson" ||
          currentLesson.id === "new"
        ? "В процессе"
        : "Запланирован";
      events.push(`update:${currentLesson.id}:${nextStatus}`);

      if (currentLesson.id === "new" && options.failNewUpdate) {
        return Promise.reject(new Error("notion second update failed"));
      }

      const updated = lesson(currentLesson.id, nextStatus);
      if (currentLesson.id === "old") {
        oldLesson = updated;
      } else {
        newLesson = updated;
      }
      return Promise.resolve(updated);
    },
  };
}

if (typeof Deno !== "undefined") {
  Deno.test("switch follows the exact read-renew-update-renew sequence", async () => {
    const events: string[] = [];
    const service = createActiveLessonService(
      switchRepository(events),
      sequenceLock(events),
    );

    const result = await service.switchActiveLesson("owner", {
      newLessonId: "new",
      operation: "switchActiveLesson",
      previousLessonId: "old",
    });

    assertEquals(result.previousLesson.status, "Запланирован", "old status");
    assertEquals(result.activeLesson.status, "В процессе", "new status");
    assertJsonEquals(
      events,
      [
        "acquire",
        "read:active",
        "renew",
        "read:old",
        "renew",
        "read:new",
        "renew",
        "update:old:Запланирован",
        "renew",
        "update:new:В процессе",
        "renew",
        "read:active",
        "renew",
        "release",
      ],
      "switch lease sequence",
    );
  });

  Deno.test("failed second update compensates the previous lesson and rechecks notion", async () => {
    const events: string[] = [];
    const logs: Array<Readonly<Record<string, unknown>>> = [];
    const service = createActiveLessonService(
      switchRepository(events, { failNewUpdate: true }),
      sequenceLock(events),
      {
        error: (event) => logs.push(event),
      },
    );

    let error: unknown;
    try {
      await service.switchActiveLesson("owner", {
        newLessonId: "new",
        operation: "switchActiveLesson",
        previousLessonId: "old",
      });
    } catch (caught) {
      error = caught;
    }

    assert(error instanceof SchoolHttpError, "normalized switch error");
    assertEquals(
      error.code,
      "ACTIVE_LESSON_SWITCH_FAILED",
      "switch error code",
    );
    assert(
      events.includes("update:old:В процессе"),
      "previous lesson compensation update",
    );
    assertJsonEquals(
      events.slice(-5),
      [
        "update:old:В процессе",
        "renew",
        "read:active",
        "renew",
        "release",
      ],
      "compensation tail",
    );
    assertEquals(logs.length, 1, "compensation log count");
    assertEquals(
      logs[0]?.event,
      "active_lesson_switch_compensation",
      "compensation log event",
    );
  });

  Deno.test("lost lease after the first update blocks the second update and compensates", async () => {
    const events: string[] = [];
    const service = createActiveLessonService(
      switchRepository(events),
      sequenceLock(events, new Set([4])),
    );

    let error: unknown;
    try {
      await service.switchActiveLesson("owner", {
        newLessonId: "new",
        operation: "switchActiveLesson",
        previousLessonId: "old",
      });
    } catch (caught) {
      error = caught;
    }

    assert(error instanceof SchoolHttpError, "lost lease error");
    assertEquals(error.code, "SCHOOL_LOCK_LOST", "lost lease code");
    assertEquals(
      events.includes("update:new:В процессе"),
      false,
      "new lesson update after lost lease",
    );
    assert(
      events.includes("update:old:В процессе"),
      "compensation after lost lease",
    );
  });

  Deno.test("two concurrent starts never leave two active lessons", async () => {
    let heldToken: string | null = null;
    const lockClient = {
      rpc(
        name: string,
        args: Readonly<Record<string, unknown>>,
      ): Promise<{ data: boolean; error: null }> {
        const token = String(args.p_lock_token);
        if (name === "acquire_school_mutation_lock") {
          if (heldToken !== null) {
            return Promise.resolve({ data: false, error: null });
          }
          heldToken = token;
          return Promise.resolve({ data: true, error: null });
        }
        if (name === "renew_school_mutation_lock") {
          return Promise.resolve({
            data: heldToken === token,
            error: null,
          });
        }
        if (name === "release_school_mutation_lock") {
          const matches = heldToken === token;
          if (matches) {
            heldToken = null;
          }
          return Promise.resolve({ data: matches, error: null });
        }
        throw new Error("unexpected rpc");
      },
    };
    let tokenCounter = 0;
    const lock = createSchoolLockService(lockClient, {
      createToken: () =>
        `00000000-0000-4000-8000-${String(++tokenCounter).padStart(12, "0")}`,
      delay: async () => {
        await Promise.resolve();
        await Promise.resolve();
      },
      random: () => 0,
    });
    const lessons = new Map<string, Lesson>([
      ["a", lesson("a")],
      ["b", lesson("b")],
    ]);
    const repository: ActiveLessonRepository = {
      getLesson: (lessonId) => Promise.resolve(lessons.get(lessonId)!),
      listActiveLessons: () =>
        Promise.resolve(
          [...lessons.values()].filter((item) => item.status === "В процессе"),
        ),
      updateLesson: (_command, currentLesson) => {
        const updated = lesson(currentLesson.id, "В процессе");
        lessons.set(currentLesson.id, updated);
        return Promise.resolve(updated);
      },
    };
    const service = createActiveLessonService(repository, lock);

    const results = await Promise.allSettled([
      service.startLesson("owner", {
        lessonId: "a",
        operation: "startLesson",
      }),
      service.startLesson("owner", {
        lessonId: "b",
        operation: "startLesson",
      }),
    ]);

    const active = [...lessons.values()].filter((item) =>
      item.status === "В процессе"
    );
    assertEquals(active.length, 1, "active lesson count");
    assertEquals(
      results.filter((result) => result.status === "fulfilled").length,
      1,
      "successful start count",
    );
    const rejected = results.find((result) => result.status === "rejected");
    assert(rejected?.status === "rejected", "one start must be rejected");
    assert(
      rejected.reason instanceof SchoolHttpError &&
        (
          rejected.reason.code === "ACTIVE_LESSON_EXISTS" ||
          rejected.reason.code === "SCHOOL_MUTATION_IN_PROGRESS"
        ),
      "second request must receive a normalized conflict",
    );
  });
}
