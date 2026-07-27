import {
  mapNotionPageToLesson,
  normalizeNotionDate,
} from "../notion-mapper.ts";
import { notionLessonPage } from "./fixtures/notion-lessons.ts";

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

if (typeof Deno !== "undefined") {
  Deno.test("mapper converts the 17 whitelisted notion properties into one lesson", () => {
    const page = notionLessonPage({
      artifactUrl: "https://example.com/artifact",
      autonomy: "A2",
      comment: "готово",
      date: {
        end: "2026-08-03T10:45:00+05:00",
        start: "2026-08-03T10:00:00+05:00",
        time_zone: null,
      },
      decisionRequest: "Перенос между неделями",
      durationMinutes: 45,
      id: "lesson-domain-id",
      missedReason: "болезнь",
      module: "модуль 1",
      moveCount: 2,
      order: 300,
      priority: "Should",
      result: "Зачёт",
      status: "Выполнен",
      subject: "Mathematics",
      title: "линейная алгебра",
      understanding: 3,
    });

    const lesson = mapNotionPageToLesson(page);

    assertEquals(lesson, {
      artifactUrl: "https://example.com/artifact",
      autonomy: "A2",
      comment: "готово",
      decisionRequest: "Перенос между неделями",
      durationMinutes: 45,
      hasLearningEvidence: true,
      id: "lesson-domain-id",
      isFinalized: true,
      missedReason: "болезнь",
      module: "модуль 1",
      moveCount: 2,
      order: 300,
      priority: "Should",
      result: "Зачёт",
      schedule: {
        date: "2026-08-03",
        end: "2026-08-03T10:45:00+05:00",
        kind: "timed",
        start: "2026-08-03T10:00:00+05:00",
      },
      status: "Выполнен",
      subject: "Mathematics",
      title: "линейная алгебра",
      understanding: 3,
      warnings: [],
      week: "W01 · 3–9 августа 2026",
    }, "mapped lesson");

    const serialized = JSON.stringify(lesson);
    assert(
      !serialized.includes("property-title-id"),
      "raw notion property id leaked",
    );
    assert(
      !serialized.includes("server-only-data-source-id"),
      "raw notion parent leaked",
    );
    assert(
      !("properties" in lesson),
      "raw notion properties leaked",
    );
  });

  Deno.test("mapper preserves nullable values without notion placeholders", () => {
    const lesson = mapNotionPageToLesson(notionLessonPage({
      artifactUrl: null,
      autonomy: null,
      comment: "",
      date: null,
      decisionRequest: null,
      durationMinutes: null,
      missedReason: null,
      result: null,
      status: null,
      understanding: null,
    }));

    assertEquals({
      artifactUrl: lesson.artifactUrl,
      autonomy: lesson.autonomy,
      comment: lesson.comment,
      decisionRequest: lesson.decisionRequest,
      durationMinutes: lesson.durationMinutes,
      missedReason: lesson.missedReason,
      result: lesson.result,
      schedule: lesson.schedule,
      understanding: lesson.understanding,
    }, {
      artifactUrl: null,
      autonomy: null,
      comment: "",
      decisionRequest: null,
      durationMinutes: 45,
      missedReason: null,
      result: null,
      schedule: {
        date: null,
        end: null,
        kind: "unscheduled",
        start: null,
      },
      understanding: null,
    }, "nullable fields");
  });

  Deno.test("date normalization distinguishes date-only, timed and unscheduled schedules", () => {
    assertEquals(
      normalizeNotionDate(
        { date: null, id: "date-id", type: "date" },
        { id: "duration-id", number: 45, type: "number" },
      ),
      { date: null, end: null, kind: "unscheduled", start: null },
      "unscheduled",
    );
    assertEquals(
      normalizeNotionDate(
        {
          date: {
            end: null,
            start: "2026-08-04",
            time_zone: null,
          },
          id: "date-id",
          type: "date",
        },
        { id: "duration-id", number: 60, type: "number" },
      ),
      {
        date: "2026-08-04",
        end: null,
        kind: "date-only",
        start: null,
      },
      "date-only",
    );
    assertEquals(
      normalizeNotionDate(
        {
          date: {
            end: "2026-08-04T12:00:00+05:00",
            start: "2026-08-04T11:00:00+05:00",
            time_zone: null,
          },
          id: "date-id",
          type: "date",
        },
        { id: "duration-id", number: 60, type: "number" },
      ),
      {
        date: "2026-08-04",
        end: "2026-08-04T12:00:00+05:00",
        kind: "timed",
        start: "2026-08-04T11:00:00+05:00",
      },
      "timed",
    );
  });

  Deno.test("canonical duration controls timed end and legacy records use bounded fallback", () => {
    const canonical = mapNotionPageToLesson(notionLessonPage({
      date: {
        end: "2026-08-05T10:45:00+05:00",
        start: "2026-08-05T10:00:00+05:00",
        time_zone: null,
      },
      durationMinutes: 60,
    }));
    const legacyTimed = mapNotionPageToLesson(notionLessonPage({
      date: {
        end: "2026-08-05T12:30:00+05:00",
        start: "2026-08-05T11:00:00+05:00",
        time_zone: null,
      },
      durationMinutes: null,
    }));
    const legacyDateOnly = mapNotionPageToLesson(notionLessonPage({
      date: {
        end: null,
        start: "2026-08-05",
        time_zone: null,
      },
      durationMinutes: null,
    }));

    assertEquals(canonical.durationMinutes, 60, "canonical duration");
    assertEquals(
      canonical.schedule.end,
      "2026-08-05T11:00:00+05:00",
      "canonical end",
    );
    assertEquals(
      canonical.warnings,
      [{ code: "duration-mismatch" }],
      "duration warning",
    );
    assertEquals(legacyTimed.durationMinutes, 90, "timed legacy duration");
    assertEquals(
      legacyDateOnly.durationMinutes,
      45,
      "date-only legacy duration",
    );
  });

  Deno.test("learning evidence comes only from status and assessment properties", () => {
    const pageWithInstructionBody = {
      ...notionLessonPage({
        artifactUrl: null,
        autonomy: null,
        comment: "",
        result: null,
        status: "Запланирован",
        understanding: null,
      }),
      body: [{
        paragraph: "цель, задание и критерии находятся в содержимом страницы",
      }],
    };

    assertEquals(
      mapNotionPageToLesson(pageWithInstructionBody).hasLearningEvidence,
      false,
      "page body is not evidence",
    );
    assertEquals(
      mapNotionPageToLesson(notionLessonPage({
        comment: "есть результат",
        status: "Запланирован",
      })).hasLearningEvidence,
      true,
      "assessment property is evidence",
    );
  });

  Deno.test("only completed, partial and missed statuses are finalized", () => {
    const statuses = [
      "Нераспределён",
      "Запланирован",
      "В процессе",
      "Выполнен",
      "Частично выполнен",
      "Пропущен",
      "Отменён",
    ];

    assertEquals(
      statuses.map((status) => [
        status,
        mapNotionPageToLesson(notionLessonPage({ status })).isFinalized,
      ]),
      [
        ["Нераспределён", false],
        ["Запланирован", false],
        ["В процессе", false],
        ["Выполнен", true],
        ["Частично выполнен", true],
        ["Пропущен", true],
        ["Отменён", false],
      ],
      "finalized status table",
    );
  });
}
