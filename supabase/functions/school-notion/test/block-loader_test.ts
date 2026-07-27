import { loadBlockChildren } from "../block-loader.ts";
import { createLessonRepository } from "../lesson-repository.ts";
import { createLessonService } from "../lesson-service.ts";
import { routeSchoolCommand } from "../router.ts";
import type { NotionBlockPage, SchoolNotionReadClient } from "../types.ts";
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
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(
      `${message}: expected ${JSON.stringify(expected)}, got ${
        JSON.stringify(actual)
      }`,
    );
  }
}

async function captureError(action: () => Promise<unknown>): Promise<unknown> {
  try {
    await action();
  } catch (error) {
    return error;
  }
  return undefined;
}

function block(
  id: string,
  type = "paragraph",
  hasChildren = false,
): Record<string, unknown> {
  const payload = type === "divider" ? {} : {
    color: "default",
    rich_text: [{
      annotations: {
        bold: false,
        code: false,
        color: "default",
        italic: false,
        strikethrough: false,
        underline: false,
      },
      href: null,
      plain_text: id,
      text: { content: id, link: null },
      type: "text",
    }],
  };

  return {
    archived: false,
    created_by: { id: "raw-user-id", object: "user" },
    created_time: "2026-07-27T00:00:00.000Z",
    has_children: hasChildren,
    id,
    in_trash: false,
    last_edited_by: { id: "raw-user-id", object: "user" },
    last_edited_time: "2026-07-27T00:00:00.000Z",
    object: "block",
    parent: { page_id: "raw-page-id", type: "page_id" },
    type,
    [type]: payload,
  };
}

function blockPage(
  results: Record<string, unknown>[],
  options: {
    hasMore?: boolean;
    nextCursor?: string | null;
  } = {},
): NotionBlockPage {
  return {
    block: {},
    has_more: options.hasMore ?? false,
    next_cursor: options.nextCursor ?? null,
    object: "list",
    results,
    type: "block",
  } as never;
}

function fakeClient(options: {
  listBlockChildren?: SchoolNotionReadClient["listBlockChildren"];
  retrievePage?: SchoolNotionReadClient["retrievePage"];
} = {}): SchoolNotionReadClient {
  return {
    listBlockChildren: options.listBlockChildren ??
      (() => Promise.resolve(blockPage([]))),
    queryDataSource: () => Promise.resolve(notionQueryResponse([])),
    retrievePage: options.retrievePage ??
      (() => Promise.resolve(notionLessonPage() as never)),
  };
}

if (typeof Deno !== "undefined") {
  Deno.test("loader fully paginates each parent before recursively loading only declared children", async () => {
    const opaqueCursor = "opaque:/cursor?keep=%2Bunchanged";
    const calls: Array<[string, string | undefined]> = [];
    const responses = new Map<string, NotionBlockPage>([
      [
        "lesson-root:",
        blockPage([
          block("plain-no-children"),
          block("nested-toggle", "toggle", true),
        ], { hasMore: true, nextCursor: opaqueCursor }),
      ],
      [
        `lesson-root:${opaqueCursor}`,
        blockPage([block("root-divider", "divider")]),
      ],
      [
        "nested-toggle:",
        blockPage([block("nested-paragraph")], {
          hasMore: true,
          nextCursor: "nested-opaque-cursor",
        }),
      ],
      [
        "nested-toggle:nested-opaque-cursor",
        blockPage([block("nested-divider", "divider")]),
      ],
    ]);
    const client = fakeClient({
      listBlockChildren(blockId, startCursor) {
        calls.push([blockId, startCursor]);
        const response = responses.get(`${blockId}:${startCursor ?? ""}`);
        if (!response) {
          throw new Error(`unexpected list call ${blockId}:${startCursor}`);
        }
        return Promise.resolve(response);
      },
    });

    const result = await loadBlockChildren("lesson-root", client);

    assertEquals(calls, [
      ["lesson-root", undefined],
      ["lesson-root", opaqueCursor],
      ["nested-toggle", undefined],
      ["nested-toggle", "nested-opaque-cursor"],
    ], "pagination and recursion order");
    assertEquals(result.length, 3, "root block count");
    assertEquals(result[1], {
      children: [
        {
          children: [],
          spans: [{
            annotations: {
              bold: false,
              code: false,
              color: "default",
              italic: false,
              strikethrough: false,
              underline: false,
            },
            link: null,
            text: "nested-paragraph",
          }],
          type: "paragraph",
        },
        { children: [], type: "divider" },
      ],
      spans: [{
        annotations: {
          bold: false,
          code: false,
          color: "default",
          italic: false,
          strikethrough: false,
          underline: false,
        },
        link: null,
        text: "nested-toggle",
      }],
      type: "toggle",
    }, "nested block");
    assert(
      calls.every(([id]) => id !== "plain-no-children"),
      "loader recursed into has_children=false",
    );
  });

  Deno.test("loader rejects missing, empty and repeated opaque cursors without returning partial content", async () => {
    const cases: Array<[string, Array<string | null>]> = [
      ["missing", [null]],
      ["empty", [""]],
      ["repeated", ["same-cursor", "same-cursor"]],
    ];

    for (const [name, cursors] of cases) {
      let callIndex = 0;
      const client = fakeClient({
        listBlockChildren() {
          const cursor = cursors[Math.min(callIndex, cursors.length - 1)];
          callIndex += 1;
          return Promise.resolve(
            blockPage([block(`${name}-${callIndex}`)], {
              hasMore: true,
              nextCursor: cursor,
            }),
          );
        },
      });

      const error = await captureError(() =>
        loadBlockChildren("lesson-root", client)
      );
      assert(
        error instanceof Error &&
          "code" in error &&
          error.code === "NOTION_PAGINATION_ERROR",
        `${name} cursor was accepted`,
      );
      assert(callIndex <= 2, `${name} cursor caused an unbounded loop`);
    }
  });

  Deno.test("loader uses visited ids to prevent duplicate traversal and cycles", async () => {
    const calls: string[] = [];
    const client = fakeClient({
      listBlockChildren(blockId) {
        calls.push(blockId);
        if (blockId === "lesson-root") {
          return Promise.resolve(
            blockPage([
              block("cycle-a", "toggle", true),
              block("cycle-a", "toggle", true),
            ]),
          );
        }
        if (blockId === "cycle-a") {
          return Promise.resolve(
            blockPage([block("cycle-a", "toggle", true)]),
          );
        }
        throw new Error(`unexpected traversal ${blockId}`);
      },
    });

    const result = await loadBlockChildren("lesson-root", client);

    assertEquals(calls, ["lesson-root", "cycle-a"], "cycle-safe calls");
    assertEquals(result.length, 1, "duplicate normalized block count");
    assertEquals(
      (result[0] as { children: unknown[] }).children,
      [],
      "cyclic child omitted",
    );
  });

  Deno.test("loader permits depth 10 and fails closed before depth 11", async () => {
    function depthClient(terminalDepth: number): SchoolNotionReadClient {
      return fakeClient({
        listBlockChildren(blockId) {
          const currentDepth = blockId === "lesson-root"
            ? 0
            : Number(blockId.slice("depth-".length));
          const nextDepth = currentDepth + 1;
          return Promise.resolve(
            blockPage([
              block(
                `depth-${nextDepth}`,
                "toggle",
                nextDepth < terminalDepth,
              ),
            ]),
          );
        },
      });
    }

    const allowed = await loadBlockChildren("lesson-root", depthClient(10));
    assertEquals(allowed.length, 1, "depth 10 root result");

    const error = await captureError(() =>
      loadBlockChildren("lesson-root", depthClient(11))
    );
    assert(
      error instanceof Error &&
        "code" in error &&
        error.code === "LESSON_CONTENT_TOO_LARGE",
      "depth 11 was accepted",
    );
  });

  Deno.test("loader allows exactly 1000 normalized blocks and rejects block 1001", async () => {
    const exactly1000 = Array.from(
      { length: 1000 },
      (_, index) => block(`block-${index + 1}`, "divider"),
    );
    const allowed = await loadBlockChildren(
      "lesson-root",
      fakeClient({
        listBlockChildren: () => Promise.resolve(blockPage(exactly1000)),
      }),
    );
    assertEquals(allowed.length, 1000, "inclusive block limit");

    const error = await captureError(() =>
      loadBlockChildren(
        "lesson-root",
        fakeClient({
          listBlockChildren: () =>
            Promise.resolve(
              blockPage([...exactly1000, block("block-1001", "divider")]),
            ),
        }),
      )
    );
    assert(
      error instanceof Error &&
        "code" in error &&
        error.code === "LESSON_CONTENT_TOO_LARGE",
      "block 1001 was accepted",
    );
  });

  Deno.test("loader fails closed for partial or invalid blocks and omits trashed blocks", async () => {
    const trashed = block("trashed-private-id");
    trashed.in_trash = true;
    const result = await loadBlockChildren(
      "lesson-root",
      fakeClient({
        listBlockChildren: () =>
          Promise.resolve(blockPage([trashed, block("visible", "divider")])),
      }),
    );
    assertEquals(result, [{ children: [], type: "divider" }], "trashed block");

    for (
      const invalid of [
        { id: "partial-only-id", object: "block" },
        { ...block("missing-payload"), paragraph: undefined },
        { ...block("invalid-id"), id: "" },
        { ...block("invalid-children"), has_children: "yes" },
      ]
    ) {
      const error = await captureError(() =>
        loadBlockChildren(
          "lesson-root",
          fakeClient({
            listBlockChildren: () => Promise.resolve(blockPage([invalid])),
          }),
        )
      );
      assert(
        error instanceof Error &&
          "code" in error &&
          error.code === "NOTION_BLOCK_RESPONSE_INVALID",
        `invalid block was accepted: ${JSON.stringify(invalid)}`,
      );
    }
  });

  Deno.test("repository verifies exact school data-source membership before any block request", async () => {
    let calls: string[] = [];
    const outsidePage = notionLessonPage({ id: "outside-page" });
    outsidePage.parent = {
      database_id: "outside-database",
      data_source_id: "another-data-source",
      type: "data_source_id",
    };
    const outsideClient = fakeClient({
      listBlockChildren() {
        calls.push("list");
        return Promise.resolve(blockPage([]));
      },
      retrievePage() {
        calls.push("retrieve");
        return Promise.resolve(outsidePage as never);
      },
    });
    const outsideRepository = createLessonRepository(
      outsideClient,
      "server-only-data-source-id",
    );
    const outsideService = createLessonService(
      outsideRepository,
      outsideClient,
    );

    const error = await captureError(() =>
      outsideService.getLessonContent("outside-page")
    );
    assert(
      error instanceof Error &&
        "status" in error &&
        error.status === 404 &&
        "code" in error &&
        error.code === "LESSON_OUTSIDE_SCHOOL_DATABASE",
      "outside lesson was accepted",
    );
    assertEquals(calls, ["retrieve"], "outside lesson call order");

    calls = [];
    const schoolPage = notionLessonPage({ id: "school-page" });
    const schoolClient = fakeClient({
      listBlockChildren(blockId) {
        calls.push(`list:${blockId}`);
        return Promise.resolve(blockPage([block("safe-divider", "divider")]));
      },
      retrievePage(pageId) {
        calls.push(`retrieve:${pageId}`);
        return Promise.resolve(schoolPage as never);
      },
    });
    const schoolService = createLessonService(
      createLessonRepository(schoolClient, "server-only-data-source-id"),
      schoolClient,
    );
    const content = await schoolService.getLessonContent("school-page");

    assertEquals(calls, [
      "retrieve:school-page",
      "list:school-page",
    ], "school lesson call order");
    assertEquals(content.lesson.id, "school-page", "mapped lesson");
    assertEquals(content.blocks, [
      { children: [], type: "divider" },
    ], "mapped content");
  });

  Deno.test("membership fails closed for trashed and partial page responses", async () => {
    const trashed = notionLessonPage({ id: "trashed-page", inTrash: true });
    const partial = { id: "partial-page", object: "page" };

    for (const page of [trashed, partial]) {
      let listCount = 0;
      const client = fakeClient({
        listBlockChildren() {
          listCount += 1;
          return Promise.resolve(blockPage([]));
        },
        retrievePage: () => Promise.resolve(page as never),
      });
      const service = createLessonService(
        createLessonRepository(client, "server-only-data-source-id"),
        client,
      );
      const error = await captureError(() =>
        service.getLessonContent(String(page.id))
      );

      assert(
        error instanceof Error &&
          "code" in error &&
          (
            error.code === "LESSON_OUTSIDE_SCHOOL_DATABASE" ||
            error.code === "NOTION_SCHEMA_ERROR"
          ),
        "invalid page response was accepted",
      );
      assertEquals(listCount, 0, "invalid page block calls");
    }
  });

  Deno.test("getLessonContent route accepts only the exact read-only shape and returns no raw notion metadata", async () => {
    const page = notionLessonPage({ id: "route-lesson" });
    const media = {
      ...block("media-id", "image"),
      image: {
        caption: [],
        file: {
          expiry_time: "2026-07-27T01:00:00.000Z",
          url: "https://files.example/media.png",
        },
        type: "file",
      },
    };
    let notionCalls = 0;
    const client = fakeClient({
      listBlockChildren: () => {
        notionCalls += 1;
        return Promise.resolve(blockPage([media]));
      },
      retrievePage: () => {
        notionCalls += 1;
        return Promise.resolve(page as never);
      },
    });
    const context = {
      auth: {
        supabase: {},
        userClaims: { sub: "owner-id" },
        userId: "owner-id",
      },
      notionClient: client,
      notionDataSourceId: "server-only-data-source-id",
      requestId: "content-request-id",
      userId: "owner-id",
    };

    const response = await routeSchoolCommand(
      { lessonId: "route-lesson", operation: "getLessonContent" },
      context,
    );
    const body = await response.json() as Record<string, unknown>;
    const serialized = JSON.stringify(body);

    assertEquals(response.status, 200, "content route status");
    assertEquals(body.ok, true, "content route success");
    assertEquals(body.requestId, "content-request-id", "content request id");
    assertEquals(notionCalls, 2, "content notion calls");
    for (
      const secret of [
        "property-title-id",
        "server-only-data-source-id",
        "media-id",
        "expiry_time",
        "raw-user-id",
      ]
    ) {
      assert(!serialized.includes(secret), `raw notion data leaked: ${secret}`);
    }

    for (
      const invalid of [
        { operation: "getLessonContent" },
        { lessonId: "", operation: "getLessonContent" },
        { lessonId: " route-lesson ", operation: "getLessonContent" },
        {
          lessonId: "route-lesson",
          operation: "getLessonContent",
          properties: { "Статус": "Выполнен" },
        },
        { lessonId: 42, operation: "getLessonContent" },
        { lessonId: "route-lesson", operation: "updateLesson" },
      ]
    ) {
      const before = notionCalls;
      const error = await captureError(() =>
        routeSchoolCommand(invalid, context)
      );
      assert(
        error instanceof Error &&
          "code" in error &&
          error.code === "INVALID_COMMAND",
        `invalid content command accepted: ${JSON.stringify(invalid)}`,
      );
      assertEquals(notionCalls, before, "invalid command notion calls");
    }
  });
}
