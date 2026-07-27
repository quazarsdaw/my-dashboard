import {
  assertLessonBelongsToSchool,
  countUnicodeCodePoints,
  parseSchoolCommand,
  validateArtifactUrl,
} from "../validation.ts";
import { SchoolHttpError } from "../errors.ts";
import {
  LESSON_AUTONOMIES,
  LESSON_MISSED_REASONS,
  LESSON_RESULTS,
  LESSON_STATUSES,
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

function expectInvalidCommand(value: unknown): void {
  try {
    parseSchoolCommand(value);
  } catch (error) {
    assert(error instanceof SchoolHttpError, "expected SchoolHttpError");
    assertEquals(error.status, 400, "invalid command status");
    assertEquals(error.code, "INVALID_COMMAND", "invalid command code");
    return;
  }

  throw new Error("expected invalid command");
}

function completeCommand(
  overrides: Readonly<Record<string, unknown>> = {},
): Record<string, unknown> {
  return {
    autonomy: "A2",
    lessonId: "lesson-id",
    operation: "completeLesson",
    status: "Выполнен",
    understanding: 2,
    ...overrides,
  };
}

if (typeof Deno !== "undefined") {
  Deno.test("validation constants expose only the approved notion enum values", () => {
    assertJsonEquals(
      LESSON_STATUSES,
      [
        "Нераспределён",
        "Запланирован",
        "В процессе",
        "Выполнен",
        "Частично выполнен",
        "Пропущен",
        "Отменён",
      ],
      "lesson statuses",
    );
    assertJsonEquals(
      LESSON_RESULTS,
      ["Зачёт", "Незачёт", "Требует повторения"],
      "lesson results",
    );
    assertJsonEquals(
      LESSON_AUTONOMIES,
      ["A0", "A1", "A2", "A3"],
      "lesson autonomies",
    );
    assertEquals(LESSON_MISSED_REASONS.length, 6, "missed reason count");
  });

  Deno.test("completed command accepts every approved result and autonomy", () => {
    for (const result of LESSON_RESULTS) {
      for (const autonomy of LESSON_AUTONOMIES) {
        const command = parseSchoolCommand(
          completeCommand({ autonomy, result }),
        );
        assertEquals(command.operation, "completeLesson", "operation");
      }
    }

    expectInvalidCommand(completeCommand({ result: "Почти зачёт" }));
    expectInvalidCommand(completeCommand({ autonomy: "A4" }));
    expectInvalidCommand(completeCommand({ status: "Запланирован" }));
  });

  Deno.test("partial and missed commands enforce their distinct assessment semantics", () => {
    const partial = parseSchoolCommand(
      completeCommand({
        status: "Частично выполнен",
      }),
    );
    assertEquals(partial.operation, "completeLesson", "partial operation");

    for (const missedReason of LESSON_MISSED_REASONS) {
      const missed = parseSchoolCommand({
        lessonId: "lesson-id",
        missedReason,
        operation: "completeLesson",
        status: "Пропущен",
      });
      assertEquals(missed.operation, "completeLesson", "missed operation");
    }

    expectInvalidCommand({
      autonomy: "A1",
      lessonId: "lesson-id",
      missedReason: "Техническая проблема",
      operation: "completeLesson",
      status: "Пропущен",
    });
    expectInvalidCommand({
      lessonId: "lesson-id",
      missedReason: "Неизвестная причина",
      operation: "completeLesson",
      status: "Пропущен",
    });
  });

  Deno.test("understanding accepts only an integer from zero through three", () => {
    for (const understanding of [0, 1, 2, 3]) {
      const command = parseSchoolCommand(
        completeCommand({ understanding }),
      );
      assertEquals(command.operation, "completeLesson", "operation");
    }

    for (const understanding of [-1, 1.5, 4, "3", null]) {
      expectInvalidCommand(completeCommand({ understanding }));
    }
  });

  Deno.test("comment limit counts unicode code points and trims without truncating", () => {
    assertEquals(countUnicodeCodePoints("a😀"), 2, "unicode code points");
    const accepted = parseSchoolCommand(
      completeCommand({ comment: `  ${"😀".repeat(1000)}  ` }),
    );
    assert(
      "comment" in accepted && accepted.comment === "😀".repeat(1000),
      "trimmed 1000-code-point comment",
    );

    expectInvalidCommand(
      completeCommand({ comment: "😀".repeat(1001) }),
    );
  });

  Deno.test("artifact accepts only normalized absolute credential-free https urls", () => {
    assertEquals(validateArtifactUrl(null), null, "null artifact");
    assertEquals(
      validateArtifactUrl("https://example.com/setup"),
      "https://example.com/setup",
      "normalized https artifact",
    );
    assertEquals(
      validateArtifactUrl("https://example.com"),
      "https://example.com/",
      "normalized origin artifact",
    );

    for (
      const value of [
        "http://example.com",
        "file:///tmp/setup.md",
        "javascript:alert(1)",
        "data:text/plain,setup",
        "notion://page",
        "/relative",
        "https://user:password@example.com",
        `https://example.com/${"a".repeat(2049)}`,
      ]
    ) {
      expectInvalidCommand(completeCommand({ artifactUrl: value }));
    }
  });

  Deno.test("duration, order and allowOverlap accept only bounded domain values", () => {
    for (const durationMinutes of [15, 45, 180]) {
      const command = parseSchoolCommand({
        allowOverlap: false,
        durationMinutes,
        lessonId: "lesson-id",
        operation: "changeLessonDuration",
      });
      assertEquals(command.operation, "changeLessonDuration", "duration op");
    }

    for (const durationMinutes of [14, 15.5, 181, "45"]) {
      expectInvalidCommand({
        durationMinutes,
        lessonId: "lesson-id",
        operation: "changeLessonDuration",
      });
    }
    for (const allowOverlap of [0, "true", null]) {
      expectInvalidCommand({
        allowOverlap,
        durationMinutes: 45,
        lessonId: "lesson-id",
        operation: "changeLessonDuration",
      });
    }
    for (const order of [Number.NaN, Number.POSITIVE_INFINITY, "100"]) {
      expectInvalidCommand({
        lessonId: "lesson-id",
        operation: "reorderLesson",
        order,
      });
    }
  });

  Deno.test("move commands accept strict W01 dates and offset timestamps only", () => {
    const dateOnly = parseSchoolCommand({
      destination: { date: "2026-08-03", kind: "date-only" },
      lessonId: "lesson-id",
      operation: "moveLesson",
      order: 100,
    });
    assertEquals(dateOnly.operation, "moveLesson", "date-only move");

    const timed = parseSchoolCommand({
      allowOverlap: true,
      destination: {
        kind: "timed",
        start: "2026-08-09T14:15:00+05:00",
      },
      lessonId: "lesson-id",
      operation: "moveLesson",
      order: 100,
    });
    assertEquals(timed.operation, "moveLesson", "timed move");

    for (
      const destination of [
        { date: "2026-08-02", kind: "date-only" },
        { date: "2026-08-10", kind: "date-only" },
        { date: "2026-02-30", kind: "date-only" },
        { kind: "timed", start: "2026-08-03T14:15:00" },
        { kind: "timed", start: "2026-08-10T14:15:00+05:00" },
      ]
    ) {
      expectInvalidCommand({
        destination,
        lessonId: "lesson-id",
        operation: "moveLesson",
        order: 100,
      });
    }
  });

  Deno.test("every command rejects unknown fields and raw notion payloads", () => {
    expectInvalidCommand({
      lessonId: "lesson-id",
      operation: "startLesson",
      properties: {
        Статус: { select: { name: "В процессе" } },
      },
    });
    expectInvalidCommand({
      lessonId: "lesson-id",
      operation: "startLesson",
      status: "В процессе",
    });
    expectInvalidCommand({
      lessonId: "lesson-id",
      operation: "unknownOperation",
    });
    expectInvalidCommand({
      lessonId: " lesson-id ",
      operation: "startLesson",
    });
  });

  Deno.test("destructive evidence reset requires an exact explicit confirmation", () => {
    const command = parseSchoolCommand({
      confirm: true,
      lessonId: "lesson-id",
      operation: "clearLearningEvidence",
    });
    assertEquals(command.operation, "clearLearningEvidence", "clear op");

    expectInvalidCommand({
      confirm: false,
      lessonId: "lesson-id",
      operation: "clearLearningEvidence",
    });
    expectInvalidCommand({
      lessonId: "lesson-id",
      operation: "clearLearningEvidence",
    });
  });

  Deno.test("school membership accepts only active pages from the configured data source", () => {
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

    assertEquals(
      assertLessonBelongsToSchool(
        matchingPage as never,
        "school-data-source",
      ),
      matchingPage as never,
      "matching page",
    );

    for (
      const page of [
        {
          ...matchingPage,
          parent: {
            data_source_id: "other-data-source",
            type: "data_source_id",
          },
        },
        { ...matchingPage, in_trash: true },
        {
          id: "partial-page",
          object: "page",
        },
      ]
    ) {
      try {
        assertLessonBelongsToSchool(page as never, "school-data-source");
      } catch (error) {
        assert(error instanceof SchoolHttpError, "membership error type");
        assertEquals(
          error.code,
          "LESSON_OUTSIDE_SCHOOL_DATABASE",
          "membership error code",
        );
        continue;
      }

      throw new Error("expected membership rejection");
    }
  });
}
