import { createActiveLessonService } from "../active-lesson-service.ts";
import { SchoolHttpError } from "../errors.ts";
import { createActiveLessonRepository } from "../lesson-repository.ts";
import { routeSchoolCommand } from "../router.ts";
import {
  ACTIVE_LESSON_WEEK,
  type ActiveLessonRepository,
  type Lesson,
  type SchoolCommand,
  type SchoolLockService,
  type SchoolNotionMutationClient,
} from "../types.ts";
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
    id,
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
    title: `lesson ${id}`,
    understanding: null,
    warnings: [],
    week: ACTIVE_LESSON_WEEK,
    ...overrides,
  };
}

function immediateLock(events: string[]): SchoolLockService {
  return {
    async withActiveLessonLock<T>(
      ownerId: string,
      operation: Parameters<
        SchoolLockService["withActiveLessonLock"]
      >[1],
    ): Promise<T> {
      events.push(`acquire:${ownerId}`);
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

function expectSchoolError(
  action: () => Promise<unknown>,
  code: string,
): Promise<SchoolHttpError> {
  return action().then(
    () => {
      throw new Error(`expected ${code}`);
    },
    (error: unknown) => {
      assert(error instanceof SchoolHttpError, "expected SchoolHttpError");
      assertEquals(error.code, code, "error code");
      return error;
    },
  );
}

if (typeof Deno !== "undefined") {
  Deno.test("starting the already active lesson is idempotent and performs no write", async () => {
    const events: string[] = [];
    const active = lesson("active", "В процессе");
    const repository: ActiveLessonRepository = {
      getLesson: () => {
        throw new Error("idempotent start must not retrieve again");
      },
      listActiveLessons: () => {
        events.push("read:active");
        return Promise.resolve([active]);
      },
      updateLesson: () => {
        throw new Error("idempotent start must not update");
      },
    };
    const service = createActiveLessonService(
      repository,
      immediateLock(events),
    );

    const result = await service.startLesson("owner", {
      lessonId: "active",
      operation: "startLesson",
    });

    assertEquals(result.id, "active", "active lesson id");
    assertJsonEquals(
      events,
      ["acquire:owner", "read:active", "renew", "release"],
      "idempotent sequence",
    );
  });

  Deno.test("starting another lesson returns the current active lesson without mutation", async () => {
    const events: string[] = [];
    const active = lesson("active", "В процессе");
    const repository: ActiveLessonRepository = {
      getLesson: () => Promise.reject(new Error("must not retrieve target")),
      listActiveLessons: () => Promise.resolve([active]),
      updateLesson: () => Promise.reject(new Error("must not update")),
    };
    const service = createActiveLessonService(
      repository,
      immediateLock(events),
    );

    const error = await expectSchoolError(
      () =>
        service.startLesson("owner", {
          lessonId: "new",
          operation: "startLesson",
        }),
      "ACTIVE_LESSON_EXISTS",
    );

    assertEquals(error.status, 409, "conflict status");
    assertJsonEquals(
      error.details,
      {
        activeLesson: {
          id: "active",
          subject: "Software Engineering",
          title: "lesson active",
        },
      },
      "active lesson details",
    );
  });

  Deno.test("several active lessons return one global inconsistent-state error", async () => {
    const events: string[] = [];
    const activeLessons = [
      lesson("active-a", "В процессе"),
      lesson("active-b", "В процессе"),
    ];
    const repository: ActiveLessonRepository = {
      getLesson: () => Promise.reject(new Error("must not retrieve target")),
      listActiveLessons: () => Promise.resolve(activeLessons),
      updateLesson: () => Promise.reject(new Error("must not update")),
    };
    const service = createActiveLessonService(
      repository,
      immediateLock(events),
    );

    const error = await expectSchoolError(
      () =>
        service.startLesson("owner", {
          lessonId: "new",
          operation: "startLesson",
        }),
      "ACTIVE_LESSON_STATE_INCONSISTENT",
    );

    assertEquals(error.status, 409, "inconsistent state status");
    assertEquals(
      (error.details?.activeLessons as unknown[])?.length,
      2,
      "active lesson detail count",
    );
  });

  Deno.test("scheduled lesson starts and is rechecked under one lease", async () => {
    const events: string[] = [];
    const scheduled = lesson("new");
    const active = lesson("new", "В процессе");
    let activeReads = 0;
    const repository: ActiveLessonRepository = {
      getLesson: (lessonId) => {
        events.push(`read:${lessonId}`);
        return Promise.resolve(scheduled);
      },
      listActiveLessons: () => {
        events.push("read:active");
        activeReads += 1;
        return Promise.resolve(activeReads === 1 ? [] : [active]);
      },
      updateLesson: (command, currentLesson) => {
        events.push(`update:${currentLesson.id}:${command.operation}`);
        return Promise.resolve(active);
      },
    };
    const service = createActiveLessonService(
      repository,
      immediateLock(events),
    );

    const result = await service.startLesson("owner", {
      lessonId: "new",
      operation: "startLesson",
    });

    assertEquals(result.status, "В процессе", "started status");
    assertJsonEquals(
      events,
      [
        "acquire:owner",
        "read:active",
        "renew",
        "read:new",
        "renew",
        "update:new:startLesson",
        "renew",
        "read:active",
        "renew",
        "release",
      ],
      "start sequence",
    );
  });

  Deno.test("reopen preserves assessment evidence while making the lesson active", async () => {
    const events: string[] = [];
    const completed = lesson("done", "Выполнен", {
      artifactUrl: "https://example.com/result",
      autonomy: "A2",
      comment: "saved",
      result: "Зачёт",
      understanding: 3,
    });
    const reopened = lesson("done", "В процессе", {
      artifactUrl: completed.artifactUrl,
      autonomy: completed.autonomy,
      comment: completed.comment,
      result: completed.result,
      understanding: completed.understanding,
    });
    let activeReads = 0;
    const repository: ActiveLessonRepository = {
      getLesson: () => Promise.resolve(completed),
      listActiveLessons: () => {
        activeReads += 1;
        return Promise.resolve(activeReads === 1 ? [] : [reopened]);
      },
      updateLesson: (_command, currentLesson) => {
        assertEquals(currentLesson.id, "done", "reopened lesson");
        return Promise.resolve(reopened);
      },
    };
    const service = createActiveLessonService(
      repository,
      immediateLock(events),
    );

    const result = await service.reopenLesson("owner", {
      lessonId: "done",
      operation: "reopenLesson",
    });

    assertEquals(result.status, "В процессе", "reopened status");
    assertEquals(result.result, "Зачёт", "preserved result");
    assertEquals(result.autonomy, "A2", "preserved autonomy");
    assertEquals(result.understanding, 3, "preserved understanding");
    assertEquals(result.comment, "saved", "preserved comment");
    assertEquals(
      result.artifactUrl,
      "https://example.com/result",
      "preserved artifact",
    );
  });

  Deno.test("resolve active state keeps the selected lesson and pauses all others", async () => {
    const events: string[] = [];
    const first = lesson("first", "В процессе");
    const second = lesson("second", "В процессе");
    let activeReads = 0;
    const repository: ActiveLessonRepository = {
      getLesson: (lessonId) => {
        events.push(`read:${lessonId}`);
        return Promise.resolve(lessonId === "first" ? first : second);
      },
      listActiveLessons: () => {
        activeReads += 1;
        return Promise.resolve(
          activeReads === 1 ? [first, second] : [second],
        );
      },
      updateLesson: (
        command: SchoolCommand,
        currentLesson: Lesson,
      ) => {
        events.push(`update:${currentLesson.id}`);
        assertEquals(
          command.operation,
          "resolveActiveLessons",
          "resolve command",
        );
        return Promise.resolve(
          lesson(
            currentLesson.id,
            currentLesson.id === "second" ? "В процессе" : "Запланирован",
          ),
        );
      },
    };
    const service = createActiveLessonService(
      repository,
      immediateLock(events),
    );

    const result = await service.resolveActiveLessons("owner", {
      keepLessonId: "second",
      operation: "resolveActiveLessons",
    });

    assertEquals(result.activeLesson.id, "second", "kept lesson");
    assertJsonEquals(
      result.pausedLessons.map((item) => item.id),
      ["first"],
      "paused lesson ids",
    );
  });

  Deno.test("active command router uses the admin rpc client only after owner auth context", async () => {
    const scheduledPage = notionLessonPage({
      id: "lesson-id",
      status: "Запланирован",
    });
    const activePage = notionLessonPage({
      id: "lesson-id",
      status: "В процессе",
    });
    let activeReads = 0;
    let updateCount = 0;
    const rpcNames: string[] = [];
    const client = {
      listBlockChildren: () => Promise.reject(new Error("unused")),
      queryDataSource: () => {
        activeReads += 1;
        return Promise.resolve(
          notionQueryResponse(activeReads === 1 ? [] : [activePage]),
        );
      },
      retrievePage: () => Promise.resolve(scheduledPage),
      updatePage: () => {
        updateCount += 1;
        return Promise.resolve(activePage);
      },
    } satisfies SchoolNotionMutationClient;

    const response = await routeSchoolCommand(
      { lessonId: "lesson-id", operation: "startLesson" },
      {
        auth: {
          supabase: {},
          supabaseAdmin: {
            rpc(name: string) {
              rpcNames.push(name);
              return Promise.resolve({ data: true, error: null });
            },
          },
          userClaims: { sub: "owner-id" },
          userId: "owner-id",
        },
        notionClient: client,
        notionDataSourceId: "server-only-data-source-id",
        requestId: "active-route-request",
        userId: "owner-id",
      },
    );
    const body = await response.json() as Record<string, unknown>;

    assertEquals(response.status, 200, "active route status");
    assertEquals(body.ok, true, "active route success");
    assertEquals(updateCount, 1, "notion update count");
    assertEquals(
      rpcNames[0],
      "acquire_school_mutation_lock",
      "first lock rpc",
    );
    assertEquals(
      rpcNames.at(-1),
      "release_school_mutation_lock",
      "last lock rpc",
    );
  });

  Deno.test("active repository renews the lease before every pagination read", async () => {
    const first = notionLessonPage({
      id: "active-a",
      status: "В процессе",
    });
    const second = notionLessonPage({
      id: "active-b",
      status: "В процессе",
    });
    const cursors: Array<string | undefined> = [];
    const responses = [
      notionQueryResponse([first], {
        hasMore: true,
        nextCursor: "opaque-active-cursor",
      }),
      notionQueryResponse([second]),
    ];
    const client = {
      listBlockChildren: () => Promise.reject(new Error("unused")),
      queryDataSource: (input: { start_cursor?: string }) => {
        cursors.push(input.start_cursor);
        return Promise.resolve(responses.shift()!);
      },
      retrievePage: () => Promise.reject(new Error("unused")),
      updatePage: () => Promise.reject(new Error("unused")),
    } as unknown as SchoolNotionMutationClient;
    let intermediateRenewals = 0;
    const repository = createActiveLessonRepository(
      client,
      "server-only-data-source-id",
    );

    const activeLessons = await repository.listActiveLessons(() => {
      intermediateRenewals += 1;
      return Promise.resolve();
    });

    assertEquals(activeLessons.length, 2, "paginated active lessons");
    assertEquals(intermediateRenewals, 1, "intermediate renewal count");
    assertJsonEquals(
      cursors,
      [undefined, "opaque-active-cursor"],
      "active pagination cursors",
    );
  });
}
