import { createLessonRepository } from "../lesson-repository.ts";
import { createLessonService } from "../lesson-service.ts";
import { handleRequest, routeSchoolCommand } from "../router.ts";
import type { QueryLessonsInput, SchoolNotionReadClient } from "../types.ts";
import {
  ACTIVE_WEEK,
  notionLessonPage,
  notionLessonPages,
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
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(
      `${message}: expected ${JSON.stringify(expected)}, got ${
        JSON.stringify(actual)
      }`,
    );
  }
}

function fakeClient(
  queryDataSource: SchoolNotionReadClient["queryDataSource"],
): SchoolNotionReadClient {
  return {
    listBlockChildren: () => {
      throw new Error("listLessons must not load page blocks");
    },
    queryDataSource,
    retrievePage: () => {
      throw new Error("listLessons must not retrieve individual pages");
    },
  };
}

if (typeof Deno !== "undefined") {
  Deno.test("repository paginates all active pages with an opaque cursor and exact read whitelist", async () => {
    const calls: QueryLessonsInput[] = [];
    const opaqueCursor = "opaque:/cursor?value=%2Bkeep-this-unchanged";
    const archived = notionLessonPage({
      archived: true,
      id: "archived-page",
    });
    const inTrash = notionLessonPage({
      id: "trashed-page",
      inTrash: true,
    });
    const responses = [
      notionQueryResponse([...notionLessonPages.slice(0, 8), archived], {
        hasMore: true,
        nextCursor: opaqueCursor,
      }),
      notionQueryResponse([...notionLessonPages.slice(8), inTrash]),
    ];
    const client = fakeClient((input) => {
      calls.push(input);
      const response = responses.shift();
      if (!response) {
        throw new Error("unexpected third query");
      }
      return Promise.resolve(response);
    });
    const repository = createLessonRepository(client);

    const lessons = await repository.listLessons({
      filter: { property: "Урок", title: { contains: "caller-controlled" } },
      sorts: [{ direction: "descending", property: "Статус" }],
      week: ACTIVE_WEEK.notionValue,
    } as never);

    assertEquals(lessons.length, 18, "active lesson count");
    assertEquals(calls.length, 2, "query count");
    assertEquals(calls[0].page_size, 100, "page size");
    assertEquals(calls[0].result_type, "page", "result type");
    assertEquals(calls[0].start_cursor, undefined, "first cursor");
    assertEquals(calls[1].start_cursor, opaqueCursor, "opaque second cursor");
    assertEquals(calls[0].filter, {
      property: "Неделя",
      select: { equals: ACTIVE_WEEK.notionValue },
    }, "server-side week filter");
    assertEquals(calls[1].filter, calls[0].filter, "stable filter");
    assertEquals(calls[0].filter_properties, [
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
    ], "read property whitelist");
    assert(
      JSON.stringify(calls).includes("caller-controlled") === false,
      "caller filter reached notion",
    );
    assert(
      JSON.stringify(calls).includes('"direction":"descending"') === false,
      "caller sorts reached notion",
    );
  });

  Deno.test("repository builds an inclusive ISO range only from validated fields", async () => {
    const calls: QueryLessonsInput[] = [];
    const repository = createLessonRepository(fakeClient((input) => {
      calls.push(input);
      return Promise.resolve(notionQueryResponse([]));
    }));

    await repository.listLessons({
      from: "2026-08-04",
      to: "2026-08-06",
    });

    assertEquals(calls[0].filter, {
      and: [
        {
          date: { on_or_after: "2026-08-04" },
          property: "Начало и окончание",
        },
        {
          date: { on_or_before: "2026-08-06" },
          property: "Начало и окончание",
        },
      ],
    }, "server-side range filter");
  });

  Deno.test("service returns 18 lessons with hand-derived subject counts", async () => {
    const repository = createLessonRepository(
      fakeClient(() =>
        Promise.resolve(notionQueryResponse([...notionLessonPages]))
      ),
    );
    const service = createLessonService(repository);

    const result = await service.listLessons({
      operation: "listLessons",
      week: ACTIVE_WEEK.notionValue,
    });

    assertEquals(result.total, 18, "total");
    assertEquals(result.counts, {
      "DevOps & Infrastructure": 2,
      "Director & Assessment": 1,
      "English & IELTS": 3,
      "Mathematics": 2,
      "Software Engineering": 9,
      "University": 1,
    }, "subject distribution");
    assertEquals(result.lessons.length, 18, "lesson result count");
  });

  Deno.test("schema defects abort the whole response without partial lessons or counts", async () => {
    const missingProperty = notionLessonPage({ id: "missing-property-page" });
    delete missingProperty.properties["Урок"];
    const wrongType = notionLessonPage({ id: "wrong-type-page" });
    wrongType.properties["Продолжительность, мин"] =
      wrongType.properties["Модуль"];
    const unknownSubject = notionLessonPage({
      id: "unknown-subject-page",
      subject: "__proto__",
    });

    for (
      const defectivePage of [
        missingProperty,
        wrongType,
        unknownSubject,
      ]
    ) {
      const client = fakeClient(() =>
        Promise.resolve(
          notionQueryResponse([
            notionLessonPage({ id: "valid-page-before-defect" }),
            defectivePage,
          ]),
        )
      );
      const request = new Request(
        "https://edge.example/functions/v1/school-notion",
        {
          body: JSON.stringify({
            operation: "listLessons",
            week: ACTIVE_WEEK.notionValue,
          }),
          headers: {
            authorization: "Bearer owner-session",
            "content-type": "application/json",
            origin: "https://dashboard.example",
          },
          method: "POST",
        },
      );
      const response = await handleRequest(request, {
        createRequestId: () => "schema-request-id",
        createUserClient: () =>
          Promise.resolve({
            data: {
              supabase: {},
              userClaims: { sub: "owner-id" },
            },
            error: null,
          }),
        env: {
          DASHBOARD_ORIGIN: "https://dashboard.example",
          NOTION_DATA_SOURCE_ID: "server-only-source",
          NOTION_TOKEN: "server-only-token",
          SCHOOL_OWNER_USER_ID: "owner-id",
        },
        router: (command, context) =>
          routeSchoolCommand(command, {
            ...context,
            notionClient: client,
          }),
      });
      const body = await response.json() as Record<string, unknown>;
      const serialized = JSON.stringify(body);

      assertEquals(response.status, 502, "schema response status");
      assertEquals(body.ok, false, "schema response success flag");
      assertEquals(body.error, "NOTION_SCHEMA_ERROR", "schema error code");
      assertEquals(
        body.message,
        "notion lesson schema is invalid",
        "schema error message",
      );
      assertEquals(body.requestId, "schema-request-id", "schema request id");
      assert(!("data" in body), "partial data returned");
      assert(
        !serialized.includes("valid-page-before-defect"),
        "partial lesson leaked",
      );
      assert(
        !serialized.includes(defectivePage.id),
        "defective page id leaked",
      );
      assert(!serialized.includes("property-"), "property id leaked");
      assert(!serialized.includes("__proto__"), "unknown subject leaked");
    }
  });

  Deno.test("listLessons route returns a normalized envelope without raw notion objects", async () => {
    const client = fakeClient(() =>
      Promise.resolve(notionQueryResponse([...notionLessonPages]))
    );

    const response = await routeSchoolCommand(
      {
        operation: "listLessons",
        week: ACTIVE_WEEK.notionValue,
      },
      {
        auth: {
          supabase: {},
          userClaims: { sub: "owner-id" },
          userId: "owner-id",
        },
        notionClient: client,
        requestId: "request-list-lessons",
        userId: "owner-id",
      },
    );
    const body = await response.json() as Record<string, unknown>;
    const serialized = JSON.stringify(body);

    assertEquals(response.status, 200, "route status");
    assertEquals(body.ok, true, "success flag");
    assertEquals(body.requestId, "request-list-lessons", "request id");
    assert(
      !serialized.includes("property-title-id"),
      "property ids leaked from route",
    );
    assert(
      !serialized.includes("server-only-data-source-id"),
      "notion parent leaked from route",
    );
  });

  Deno.test("route rejects unknown keys, mixed filters and out-of-bounds dates before notion", async () => {
    let queryCount = 0;
    const client = fakeClient(() => {
      queryCount += 1;
      return Promise.resolve(notionQueryResponse([]));
    });
    const context = {
      auth: {
        supabase: {},
        userClaims: { sub: "owner-id" },
        userId: "owner-id",
      },
      notionClient: client,
      requestId: "request-invalid",
      userId: "owner-id",
    };
    const invalidCommands = [
      {
        filter: { property: "Статус", select: { equals: "Выполнен" } },
        operation: "listLessons",
        week: ACTIVE_WEEK.notionValue,
      },
      {
        from: ACTIVE_WEEK.startDate,
        operation: "listLessons",
        to: ACTIVE_WEEK.endDate,
        week: ACTIVE_WEEK.notionValue,
      },
      {
        from: "2026-08-02",
        operation: "listLessons",
        to: ACTIVE_WEEK.endDate,
      },
      {
        from: ACTIVE_WEEK.startDate,
        operation: "listLessons",
        to: "2026-08-10",
      },
    ];

    for (const command of invalidCommands) {
      let error: unknown;
      try {
        await routeSchoolCommand(command, context);
      } catch (caught) {
        error = caught;
      }
      assert(
        error instanceof Error &&
          "code" in error &&
          error.code === "INVALID_COMMAND",
        `invalid command was accepted: ${JSON.stringify(command)}`,
      );
    }

    assertEquals(queryCount, 0, "notion query count");
  });
}
