import { mapBlock, safeExternalUrl } from "../block-mapper.ts";
import type { LessonContentBlock } from "../types.ts";

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

function richText(
  plainText: string,
  options: {
    color?: string;
    href?: unknown;
  } = {},
): Record<string, unknown> {
  return {
    annotations: {
      bold: true,
      code: false,
      color: options.color ?? "blue",
      italic: true,
      strikethrough: false,
      underline: true,
    },
    href: options.href ?? "https://example.com/lesson",
    plain_text: plainText,
    text: {
      content: `<img src=x onerror="${plainText}">`,
      link: options.href === undefined
        ? { url: "https://example.com/lesson" }
        : null,
    },
    type: "text",
  };
}

function notionBlock(
  type: string,
  payload: Record<string, unknown>,
  options: {
    hasChildren?: boolean;
    id?: string;
    inTrash?: boolean;
  } = {},
): Record<string, unknown> {
  return {
    archived: false,
    created_by: { id: "raw-creator-id", object: "user" },
    created_time: "2026-07-27T00:00:00.000Z",
    has_children: options.hasChildren ?? false,
    id: options.id ?? `raw-${type}-id`,
    in_trash: options.inTrash ?? false,
    last_edited_by: { id: "raw-editor-id", object: "user" },
    last_edited_time: "2026-07-27T00:00:00.000Z",
    object: "block",
    parent: { page_id: "raw-page-id", type: "page_id" },
    type,
    [type]: payload,
  };
}

const nestedChildren: LessonContentBlock[] = [
  { children: [], type: "divider" },
];

if (typeof Deno !== "undefined") {
  Deno.test("safeExternalUrl accepts only absolute credential-free https urls", () => {
    assertEquals(
      safeExternalUrl("https://example.com/a?b=1#c"),
      "https://example.com/a?b=1#c",
      "valid https url",
    );

    for (
      const unsafe of [
        null,
        undefined,
        "",
        "/relative",
        "http://example.com",
        "javascript:alert(1)",
        "data:text/html,<script>alert(1)</script>",
        "https://user:password@example.com/private",
        " https://example.com/space ",
      ]
    ) {
      assertEquals(safeExternalUrl(unsafe), null, `unsafe url: ${unsafe}`);
    }
  });

  Deno.test("mapper normalizes every supported rich-text block and nested children", () => {
    const richTextTypes = [
      "paragraph",
      "heading_1",
      "heading_2",
      "heading_3",
      "heading_4",
      "bulleted_list_item",
      "numbered_list_item",
      "toggle",
      "quote",
      "callout",
    ] as const;

    for (const type of richTextTypes) {
      const mapped = mapBlock(
        notionBlock(type, {
          color: "blue",
          rich_text: [
            richText("безопасный текст"),
            richText("опасная ссылка", {
              color: "future_color",
              href: "javascript:alert(1)",
            }),
          ],
        }),
        nestedChildren,
      );

      assertEquals(mapped, {
        children: nestedChildren,
        spans: [
          {
            annotations: {
              bold: true,
              code: false,
              color: "blue",
              italic: true,
              strikethrough: false,
              underline: true,
            },
            link: "https://example.com/lesson",
            text: "безопасный текст",
          },
          {
            annotations: {
              bold: true,
              code: false,
              color: "default",
              italic: true,
              strikethrough: false,
              underline: true,
            },
            link: null,
            text: "опасная ссылка",
          },
        ],
        type,
      }, `mapped ${type}`);

      const serialized = JSON.stringify(mapped);
      assert(!serialized.includes("<img"), `${type} rendered html`);
      assert(!serialized.includes("onerror"), `${type} leaked event handler`);
      assert(!serialized.includes("raw-page-id"), `${type} leaked parent`);
      assert(!serialized.includes(`raw-${type}-id`), `${type} leaked id`);
    }
  });

  Deno.test("mapper preserves to-do state, code language/caption and equations", () => {
    assertEquals(
      mapBlock(
        notionBlock("to_do", {
          checked: true,
          color: "default",
          rich_text: [richText("проверить")],
        }),
        nestedChildren,
      ),
      {
        checked: true,
        children: nestedChildren,
        spans: [{
          annotations: {
            bold: true,
            code: false,
            color: "blue",
            italic: true,
            strikethrough: false,
            underline: true,
          },
          link: "https://example.com/lesson",
          text: "проверить",
        }],
        type: "to_do",
      },
      "to-do block",
    );
    assertEquals(
      mapBlock(
        notionBlock("code", {
          caption: [richText("пример")],
          language: "typescript",
          rich_text: [richText("<script>не html</script>")],
        }),
        [],
      ),
      {
        caption: [{
          annotations: {
            bold: true,
            code: false,
            color: "blue",
            italic: true,
            strikethrough: false,
            underline: true,
          },
          link: "https://example.com/lesson",
          text: "пример",
        }],
        children: [],
        language: "typescript",
        spans: [{
          annotations: {
            bold: true,
            code: false,
            color: "blue",
            italic: true,
            strikethrough: false,
            underline: true,
          },
          link: "https://example.com/lesson",
          text: "<script>не html</script>",
        }],
        type: "code",
      },
      "code block",
    );
    assertEquals(
      mapBlock(
        notionBlock("equation", { expression: "E = mc^2" }),
        [],
      ),
      { children: [], expression: "E = mc^2", type: "equation" },
      "equation block",
    );
  });

  Deno.test("mapper normalizes divider, table rows and layout containers", () => {
    assertEquals(
      mapBlock(notionBlock("divider", {}), []),
      { children: [], type: "divider" },
      "divider block",
    );
    assertEquals(
      mapBlock(
        notionBlock("table", {
          has_column_header: true,
          has_row_header: false,
          table_width: 2,
        }),
        nestedChildren,
      ),
      {
        children: nestedChildren,
        hasColumnHeader: true,
        hasRowHeader: false,
        tableWidth: 2,
        type: "table",
      },
      "table block",
    );
    assertEquals(
      mapBlock(
        notionBlock("table_row", {
          cells: [[richText("a")], [richText("b")]],
        }),
        [],
      ),
      {
        cells: [
          [{
            annotations: {
              bold: true,
              code: false,
              color: "blue",
              italic: true,
              strikethrough: false,
              underline: true,
            },
            link: "https://example.com/lesson",
            text: "a",
          }],
          [{
            annotations: {
              bold: true,
              code: false,
              color: "blue",
              italic: true,
              strikethrough: false,
              underline: true,
            },
            link: "https://example.com/lesson",
            text: "b",
          }],
        ],
        children: [],
        type: "table_row",
      },
      "table row block",
    );

    for (const type of ["column_list", "column", "synced_block"] as const) {
      assertEquals(
        mapBlock(
          notionBlock(
            type,
            type === "synced_block"
              ? {
                synced_from: {
                  block_id: "raw-original-block-id",
                  type: "block_id",
                },
              }
              : {},
          ),
          nestedChildren,
        ),
        { children: nestedChildren, type },
        `${type} container`,
      );
    }
  });

  Deno.test("mapper returns inert media and reference metadata without expiry or raw payload", () => {
    const cases = [
      {
        payload: {
          caption: [richText("закладка")],
          url: "https://example.com/bookmark",
        },
        type: "bookmark",
        url: "https://example.com/bookmark",
      },
      {
        payload: { url: "https://example.com/preview" },
        type: "link_preview",
        url: "https://example.com/preview",
      },
      {
        payload: {
          caption: [richText("изображение")],
          file: {
            expiry_time: "2026-07-27T01:00:00.000Z",
            url: "https://files.example/image.png",
          },
          type: "file",
        },
        type: "image",
        url: "https://files.example/image.png",
      },
      {
        payload: {
          caption: [richText("файл")],
          external: { url: "https://example.com/file.zip" },
          type: "external",
        },
        type: "file",
        url: "https://example.com/file.zip",
      },
      {
        payload: {
          caption: [richText("pdf")],
          external: { url: "http://example.com/unsafe.pdf" },
          type: "external",
        },
        type: "pdf",
        url: null,
      },
      {
        payload: {
          caption: [richText("видео")],
          external: { url: "https://example.com/video.mp4" },
          type: "external",
        },
        type: "video",
        url: "https://example.com/video.mp4",
      },
      {
        payload: {
          caption: [richText("аудио")],
          external: { url: "https://example.com/audio.mp3" },
          type: "external",
        },
        type: "audio",
        url: "https://example.com/audio.mp3",
      },
      {
        payload: {
          caption: [richText("встраивание")],
          url: "data:text/html,<script>alert(1)</script>",
        },
        type: "embed",
        url: null,
      },
    ];

    for (const testCase of cases) {
      const mapped = mapBlock(
        notionBlock(testCase.type, testCase.payload),
        nestedChildren,
      );
      const record = mapped as unknown as Record<string, unknown>;
      const caption = testCase.payload.caption === undefined ? [] : [{
        annotations: {
          bold: true,
          code: false,
          color: "blue",
          italic: true,
          strikethrough: false,
          underline: true,
        },
        link: "https://example.com/lesson",
        text: testCase.payload.caption[0].plain_text,
      }];

      assertEquals(record.type, testCase.type, `${testCase.type} type`);
      assertEquals(record.url, testCase.url, `${testCase.type} url`);
      assertEquals(record.caption, caption, `${testCase.type} caption`);
      assert(
        typeof record.label === "string" && record.label.length > 0,
        `${testCase.type} label`,
      );
      assertEquals(
        record.children,
        nestedChildren,
        `${testCase.type} children`,
      );

      const serialized = JSON.stringify(mapped);
      assert(!serialized.includes("expiry_time"), "file expiry leaked");
      assert(!serialized.includes("raw-page-id"), "reference parent leaked");
      assert(!serialized.includes("data:text/html"), "unsafe media url leaked");
    }
  });

  Deno.test("mapper normalizes known, future and api-unsupported block types to a safe fallback", () => {
    const unsupportedCases = [
      ["child_page", "child_page"],
      ["child_database", "child_database"],
      ["template", "template"],
      ["breadcrumb", "breadcrumb"],
      ["table_of_contents", "table_of_contents"],
      ["link_to_page", "link_to_page"],
      ["meeting_notes", "meeting_notes"],
      ["transcription", "transcription"],
      ["tab", "tab"],
      ["future_widget", "future_widget"],
      ["unsupported", "form"],
    ];

    for (const [type, sourceType] of unsupportedCases) {
      const payload = type === "unsupported"
        ? { block_type: sourceType, secret: "raw unsupported payload" }
        : { title: "raw private title" };
      const mapped = mapBlock(notionBlock(type, payload), nestedChildren);

      assertEquals(mapped, {
        label: `unsupported notion block (${sourceType})`,
        sourceType,
        type: "unsupported",
      }, `unsupported ${type}`);

      const serialized = JSON.stringify(mapped);
      assert(!serialized.includes("raw private title"), "raw title leaked");
      assert(
        !serialized.includes("raw unsupported payload"),
        "unsupported payload leaked",
      );
      assert(!serialized.includes("raw-page-id"), "unsupported parent leaked");
    }

    assertEquals(
      mapBlock(
        notionBlock("unsupported", {
          block_type: "<script>unsafe future type</script>",
        }),
        [],
      ),
      {
        label: "unsupported notion block (unsupported)",
        sourceType: "unsupported",
        type: "unsupported",
      },
      "malformed unsupported source type",
    );
  });
}
