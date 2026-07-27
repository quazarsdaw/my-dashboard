import { createScheduleService } from "../schedule-service.ts";
import { SchoolHttpError } from "../errors.ts";
import { routeSchoolCommand } from "../router.ts";
import {
  ACTIVE_LESSON_WEEK,
  type Lesson,
  type LessonDestination,
  type ScheduleLessonRepository,
  type SchoolCommand,
  type SchoolLockService,
  type SchoolNotionMutationClient,
} from "../types.ts";
import { parseSchoolCommand } from "../validation.ts";
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

function lesson(
  id: string,
  overrides: Partial<Lesson> = {},
): Lesson {
  return {
    artifactUrl: null,
    autonomy: null,
    comment: "",
    decisionRequest: null,
    durationMinutes: 45,
    hasLearningEvidence: false,
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
    status: "Запланирован",
    subject: "Software Engineering",
    title: `lesson ${id}`,
    understanding: null,
    warnings: [],
    week: ACTIVE_LESSON_WEEK,
    ...overrides,
  };
}

function addMinutes(start: string, minutes: number): string {
  const offset = start.slice(-6);
  const direction = offset[0] === "+" ? 1 : -1;
  const offsetMinutes = direction *
    (Number(offset.slice(1, 3)) * 60 + Number(offset.slice(4, 6)));
  const local = new Date(
    Date.parse(start) + minutes * 60_000 + offsetMinutes * 60_000,
  ).toISOString().slice(0, 19);
  return `${local}${offset}`;
}

function scheduleFromDestination(
  destination: LessonDestination,
  durationMinutes: number,
): Lesson["schedule"] {
  if (destination.kind === "unscheduled") {
    return {
      date: null,
      end: null,
      kind: "unscheduled",
      start: null,
    };
  }
  if (destination.kind === "date-only") {
    return {
      date: destination.date,
      end: null,
      kind: "date-only",
      start: null,
    };
  }
  return {
    date: destination.start.slice(0, 10),
    end: addMinutes(destination.start, durationMinutes),
    kind: "timed",
    start: destination.start,
  };
}

function repositoryState(initial: Lesson[], events: string[]) {
  const lessons = new Map(initial.map((item) => [item.id, item]));

  const repository: ScheduleLessonRepository = {
    getLesson: (lessonId) => {
      events.push(`read:${lessonId}`);
      return Promise.resolve(lessons.get(lessonId)!);
    },
    listActiveLessons: () => {
      events.push("read:active");
      return Promise.resolve(
        [...lessons.values()].filter((item) => item.status === "В процессе"),
      );
    },
    listWeekLessons: () => {
      events.push("read:week");
      return Promise.resolve([...lessons.values()]);
    },
    updateLesson: (command: SchoolCommand, current: Lesson) => {
      events.push(`update:${command.operation}`);
      let updated = current;
      switch (command.operation) {
        case "moveLesson":
        case "pauseAndMoveLesson":
        case "restoreMissedLesson": {
          const schedule = scheduleFromDestination(
            command.destination,
            current.durationMinutes,
          );
          const changedDay = current.schedule.date !== null &&
            schedule.date !== null &&
            current.schedule.date !== schedule.date;
          updated = {
            ...current,
            autonomy: command.operation === "restoreMissedLesson"
              ? null
              : current.autonomy,
            missedReason: command.operation === "restoreMissedLesson"
              ? null
              : current.missedReason,
            moveCount: current.moveCount + (changedDay ? 1 : 0),
            order: command.order,
            result: command.operation === "restoreMissedLesson"
              ? null
              : current.result,
            schedule,
            status: command.operation === "moveLesson" &&
                current.status === "В процессе"
              ? "В процессе"
              : schedule.kind === "unscheduled"
              ? "Нераспределён"
              : "Запланирован",
            understanding: command.operation === "restoreMissedLesson"
              ? null
              : current.understanding,
          };
          break;
        }
        case "unscheduleLesson":
          updated = {
            ...current,
            order: command.order,
            schedule: {
              date: null,
              end: null,
              kind: "unscheduled",
              start: null,
            },
            status: "Нераспределён",
          };
          break;
        case "changeLessonDuration":
          updated = {
            ...current,
            durationMinutes: command.durationMinutes,
            schedule: current.schedule.kind === "timed"
              ? scheduleFromDestination(
                { kind: "timed", start: current.schedule.start },
                command.durationMinutes,
              )
              : current.schedule,
          };
          break;
        case "reorderLesson":
          updated = { ...current, order: command.order };
          break;
        case "requestCrossWeekMove":
          updated = {
            ...current,
            decisionRequest: "Перенос между неделями",
          };
          break;
        case "clearDecisionRequest":
          updated = { ...current, decisionRequest: null };
          break;
        default:
          throw new Error(`unexpected command ${command.operation}`);
      }
      lessons.set(current.id, updated);
      return Promise.resolve(updated);
    },
  };

  return {
    current: (lessonId: string) => lessons.get(lessonId)!,
    repository,
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

async function expectCode(
  action: () => Promise<unknown> | unknown,
  code: string,
): Promise<SchoolHttpError> {
  try {
    await action();
  } catch (error) {
    assert(error instanceof SchoolHttpError, "expected SchoolHttpError");
    assertEquals(error.code, code, "error code");
    return error;
  }
  throw new Error(`expected ${code}`);
}

if (typeof Deno !== "undefined") {
  Deno.test("timed move returns conflicts until overlap is explicitly allowed", async () => {
    const events: string[] = [];
    const state = repositoryState([
      lesson("target"),
      lesson("english", {
        subject: "English & IELTS",
        schedule: {
          date: "2026-08-03",
          end: "2026-08-03T15:15:00+05:00",
          kind: "timed",
          start: "2026-08-03T14:30:00+05:00",
        },
      }),
    ], events);
    const service = createScheduleService(
      state.repository,
      trackingLock(events),
    );
    const conflict = await expectCode(
      () =>
        service.moveLesson("owner", {
          destination: {
            kind: "timed",
            start: "2026-08-03T14:00:00+05:00",
          },
          lessonId: "target",
          operation: "moveLesson",
          order: 100,
        }),
      "LESSON_TIME_CONFLICT",
    );
    assertEquals(
      Array.isArray(conflict.details?.conflicts),
      true,
      "safe conflicts",
    );
    assertEquals(
      events.some((event) => event.startsWith("update:")),
      false,
      "no update before confirmation",
    );

    const moved = await service.moveLesson("owner", {
      allowOverlap: true,
      destination: {
        kind: "timed",
        start: "2026-08-03T14:00:00+05:00",
      },
      lessonId: "target",
      operation: "moveLesson",
      order: 100,
    });
    assertEquals(
      moved.schedule.end,
      "2026-08-03T14:45:00+05:00",
      "derived end",
    );
  });

  Deno.test("boundary touch and cancelled intervals never block a timed move", async () => {
    const events: string[] = [];
    const state = repositoryState([
      lesson("target"),
      lesson("touch", {
        schedule: {
          date: "2026-08-03",
          end: "2026-08-03T15:30:00+05:00",
          kind: "timed",
          start: "2026-08-03T14:45:00+05:00",
        },
      }),
      lesson("cancelled", {
        schedule: {
          date: "2026-08-03",
          end: "2026-08-03T15:00:00+05:00",
          kind: "timed",
          start: "2026-08-03T14:15:00+05:00",
        },
        status: "Отменён",
      }),
    ], events);
    const service = createScheduleService(
      state.repository,
      trackingLock(events),
    );

    const moved = await service.moveLesson("owner", {
      destination: {
        kind: "timed",
        start: "2026-08-03T14:00:00+05:00",
      },
      lessonId: "target",
      operation: "moveLesson",
      order: 100,
    });
    assertEquals(moved.schedule.start, "2026-08-03T14:00:00+05:00", "start");
  });

  Deno.test("duration is canonical for timed end and survives date-only scheduling", async () => {
    const events: string[] = [];
    const state = repositoryState([
      lesson("target", {
        durationMinutes: 60,
        schedule: {
          date: "2026-08-03",
          end: "2026-08-03T14:45:00+05:00",
          kind: "timed",
          start: "2026-08-03T14:00:00+05:00",
        },
      }),
    ], events);
    const service = createScheduleService(
      state.repository,
      trackingLock(events),
    );

    const changed = await service.changeLessonDuration("owner", {
      durationMinutes: 75,
      lessonId: "target",
      operation: "changeLessonDuration",
    });
    assertEquals(changed.schedule.end, "2026-08-03T15:15:00+05:00", "new end");

    const dateOnly = await service.moveLesson("owner", {
      destination: { date: "2026-08-04", kind: "date-only" },
      lessonId: "target",
      operation: "moveLesson",
      order: 100,
    });
    assertEquals(dateOnly.durationMinutes, 75, "preserved duration");
    assertEquals(dateOnly.schedule.kind, "date-only", "date-only schedule");
  });

  Deno.test("duration change rechecks overlap before saving the derived end", async () => {
    const events: string[] = [];
    const state = repositoryState([
      lesson("target", {
        schedule: {
          date: "2026-08-03",
          end: "2026-08-03T14:45:00+05:00",
          kind: "timed",
          start: "2026-08-03T14:00:00+05:00",
        },
      }),
      lesson("next", {
        schedule: {
          date: "2026-08-03",
          end: "2026-08-03T15:35:00+05:00",
          kind: "timed",
          start: "2026-08-03T14:50:00+05:00",
        },
      }),
    ], events);
    const service = createScheduleService(
      state.repository,
      trackingLock(events),
    );

    await expectCode(
      () =>
        service.changeLessonDuration("owner", {
          durationMinutes: 60,
          lessonId: "target",
          operation: "changeLessonDuration",
        }),
      "LESSON_TIME_CONFLICT",
    );
    assertEquals(
      events.includes("update:changeLessonDuration"),
      false,
      "blocked duration update",
    );
  });

  Deno.test("active lesson moves within one day without a lock but cross-day needs pause", async () => {
    const events: string[] = [];
    const state = repositoryState([
      lesson("active", {
        hasLearningEvidence: true,
        schedule: {
          date: "2026-08-03",
          end: "2026-08-03T14:45:00+05:00",
          kind: "timed",
          start: "2026-08-03T14:00:00+05:00",
        },
        status: "В процессе",
      }),
    ], events);
    const service = createScheduleService(
      state.repository,
      trackingLock(events),
    );

    const sameDay = await service.moveLesson("owner", {
      destination: {
        kind: "timed",
        start: "2026-08-03T15:00:00+05:00",
      },
      lessonId: "active",
      operation: "moveLesson",
      order: 100,
    });
    assertEquals(sameDay.status, "В процессе", "active status");
    assertEquals(events.includes("acquire"), false, "same-day lock");

    await expectCode(
      () =>
        service.moveLesson("owner", {
          destination: {
            kind: "timed",
            start: "2026-08-04T15:00:00+05:00",
          },
          lessonId: "active",
          operation: "moveLesson",
          order: 100,
        }),
      "LESSON_STATUS_TRANSITION_REQUIRED",
    );

    const paused = await service.pauseAndMoveLesson("owner", {
      destination: {
        kind: "timed",
        start: "2026-08-04T15:00:00+05:00",
      },
      lessonId: "active",
      operation: "pauseAndMoveLesson",
      order: 100,
    });
    assertEquals(paused.status, "Запланирован", "paused status");
    assertEquals(paused.moveCount, 1, "cross-day move count");
    assert(
      events.includes("acquire") && events.includes("release"),
      "pause lock",
    );
  });

  Deno.test("missed, finalized and cancelled lessons require their explicit transition commands", async () => {
    for (
      const item of [
        lesson("missed", { status: "Пропущен", isFinalized: true }),
        lesson("completed", { status: "Выполнен", isFinalized: true }),
        lesson("partial", {
          status: "Частично выполнен",
          isFinalized: true,
        }),
        lesson("cancelled", { status: "Отменён" }),
      ]
    ) {
      const events: string[] = [];
      const state = repositoryState([item], events);
      const service = createScheduleService(
        state.repository,
        trackingLock(events),
      );
      await expectCode(
        () =>
          service.moveLesson("owner", {
            destination: { date: "2026-08-04", kind: "date-only" },
            lessonId: item.id,
            operation: "moveLesson",
            order: 100,
          }),
        "LESSON_STATUS_TRANSITION_REQUIRED",
      );
    }
  });

  Deno.test("missed restore clears attendance assessment without creating a new lesson", async () => {
    const events: string[] = [];
    const state = repositoryState([
      lesson("missed", {
        autonomy: "A2",
        isFinalized: true,
        missedReason: "Низкая энергия",
        result: "Зачёт",
        status: "Пропущен",
        understanding: 3,
      }),
    ], events);
    const service = createScheduleService(
      state.repository,
      trackingLock(events),
    );

    const restored = await service.restoreMissedLesson("owner", {
      destination: { date: "2026-08-04", kind: "date-only" },
      lessonId: "missed",
      operation: "restoreMissedLesson",
      order: 200,
    });
    assertEquals(restored.status, "Запланирован", "restored status");
    assertEquals(restored.missedReason, null, "cleared reason");
    assertEquals(restored.result, null, "cleared result");
    assertEquals(restored.autonomy, null, "cleared autonomy");
    assertEquals(restored.understanding, null, "cleared understanding");
  });

  Deno.test("scheduled and unscheduled transitions preserve identity and custom duration", async () => {
    const events: string[] = [];
    const state = repositoryState([
      lesson("target", {
        durationMinutes: 60,
        schedule: {
          date: null,
          end: null,
          kind: "unscheduled",
          start: null,
        },
        status: "Нераспределён",
      }),
    ], events);
    const service = createScheduleService(
      state.repository,
      trackingLock(events),
    );

    const scheduled = await service.moveLesson("owner", {
      destination: { date: "2026-08-05", kind: "date-only" },
      lessonId: "target",
      operation: "moveLesson",
      order: 300,
    });
    assertEquals(scheduled.status, "Запланирован", "scheduled status");
    assertEquals(scheduled.durationMinutes, 60, "scheduled duration");

    const unscheduled = await service.unscheduleLesson("owner", {
      lessonId: "target",
      operation: "unscheduleLesson",
      order: 100,
    });
    assertEquals(unscheduled.id, "target", "same lesson");
    assertEquals(unscheduled.status, "Нераспределён", "unscheduled status");
    assertEquals(unscheduled.durationMinutes, 60, "unscheduled duration");
  });

  Deno.test("decision request and clear are idempotent and do not touch the comment", async () => {
    const events: string[] = [];
    const state = repositoryState([
      lesson("target", { comment: "keep me" }),
    ], events);
    const service = createScheduleService(
      state.repository,
      trackingLock(events),
    );

    await service.requestCrossWeekMove("owner", {
      lessonId: "target",
      operation: "requestCrossWeekMove",
    });
    await service.requestCrossWeekMove("owner", {
      lessonId: "target",
      operation: "requestCrossWeekMove",
    });
    assertEquals(
      events.filter((event) => event === "update:requestCrossWeekMove").length,
      1,
      "idempotent request",
    );
    assertEquals(state.current("target").comment, "keep me", "kept comment");

    await service.clearDecisionRequest("owner", {
      lessonId: "target",
      operation: "clearDecisionRequest",
    });
    await service.clearDecisionRequest("owner", {
      lessonId: "target",
      operation: "clearDecisionRequest",
    });
    assertEquals(
      events.filter((event) => event === "update:clearDecisionRequest").length,
      1,
      "idempotent clear",
    );
    assertEquals(state.current("target").comment, "keep me", "kept comment");
  });

  Deno.test("reordering changes neither date nor move counter", async () => {
    const events: string[] = [];
    const state = repositoryState([
      lesson("target", { moveCount: 2 }),
    ], events);
    const service = createScheduleService(
      state.repository,
      trackingLock(events),
    );

    const reordered = await service.reorderLesson("owner", {
      lessonId: "target",
      operation: "reorderLesson",
      order: 150,
    });
    assertEquals(reordered.order, 150, "new order");
    assertEquals(reordered.moveCount, 2, "move count");
    assertJsonEquals(
      reordered.schedule,
      lesson("target").schedule,
      "unchanged date",
    );
  });

  Deno.test("cross-week drag returns the review-specific conflict", async () => {
    await expectCode(
      () =>
        Promise.resolve(parseSchoolCommand({
          destination: { date: "2026-08-10", kind: "date-only" },
          lessonId: "target",
          operation: "moveLesson",
          order: 100,
        })),
      "CROSS_WEEK_MOVE_REQUIRES_REVIEW",
    );
  });

  Deno.test("schedule command router uses the mutation client without taking the active lock", async () => {
    const target = notionLessonPage({
      date: { end: null, start: "2026-08-03", time_zone: null },
      id: "target",
    });
    const moved = notionLessonPage({
      date: {
        end: "2026-08-03T14:45:00+05:00",
        start: "2026-08-03T14:00:00+05:00",
        time_zone: null,
      },
      id: "target",
    });
    let updateCount = 0;
    let rpcCount = 0;
    const client = {
      listBlockChildren: () => Promise.reject(new Error("unused")),
      queryDataSource: () => Promise.resolve(notionQueryResponse([])),
      retrievePage: () => Promise.resolve(target),
      updatePage: () => {
        updateCount += 1;
        return Promise.resolve(moved);
      },
    } satisfies SchoolNotionMutationClient;

    const response = await routeSchoolCommand(
      {
        destination: {
          kind: "timed",
          start: "2026-08-03T14:00:00+05:00",
        },
        lessonId: "target",
        operation: "moveLesson",
        order: 100,
      },
      {
        auth: {
          supabase: {},
          supabaseAdmin: {
            rpc() {
              rpcCount += 1;
              return Promise.resolve({ data: true, error: null });
            },
          },
          userClaims: { sub: "owner" },
          userId: "owner",
        },
        notionClient: client,
        notionDataSourceId: "server-only-data-source-id",
        requestId: "schedule-route",
        userId: "owner",
      },
    );

    assertEquals(response.status, 200, "route status");
    assertEquals(updateCount, 1, "notion update");
    assertEquals(rpcCount, 0, "no active lock");
  });
}
