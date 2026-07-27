import { loadBlockChildren } from "./block-loader.ts";
import { SchoolHttpError } from "./errors.ts";
import { mapNotionPageToLesson } from "./notion-mapper.ts";
import { LESSON_SUBJECTS } from "./types.ts";
import type {
  GetLessonContentCommand,
  LessonContentResult,
  LessonListResult,
  LessonRepository,
  ListLessonsCommand,
  SchoolNotionReadClient,
} from "./types.ts";

export interface LessonService {
  getLessonContent(
    lessonId: GetLessonContentCommand["lessonId"],
  ): Promise<LessonContentResult>;
  listLessons(command: ListLessonsCommand): Promise<LessonListResult>;
}

export function createLessonService(
  repository: LessonRepository,
  client?: SchoolNotionReadClient,
): LessonService {
  return Object.freeze({
    async getLessonContent(lessonId: string): Promise<LessonContentResult> {
      if (!client) {
        throw new SchoolHttpError(
          500,
          "SERVER_MISCONFIGURED",
          "server configuration is invalid",
        );
      }

      const page = await repository.assertSchoolLesson(lessonId);
      if (
        page.object !== "page" ||
        !("url" in page) ||
        !("properties" in page)
      ) {
        throw new SchoolHttpError(
          502,
          "NOTION_SCHEMA_ERROR",
          "notion lesson schema is invalid",
        );
      }

      const blocks = await loadBlockChildren(lessonId, client);
      return {
        blocks,
        lesson: mapNotionPageToLesson(page),
      };
    },

    async listLessons(command: ListLessonsCommand): Promise<LessonListResult> {
      const lessons = await repository.listLessons(
        command.week !== undefined
          ? { week: command.week }
          : { from: command.from, to: command.to },
      );
      const subjectCounts = new Map<string, number>(
        LESSON_SUBJECTS.map((subject) => [subject, 0]),
      );

      for (const lesson of lessons) {
        const current = subjectCounts.get(lesson.subject);
        if (current === undefined) {
          throw new SchoolHttpError(
            502,
            "NOTION_SCHEMA_ERROR",
            "notion lesson schema is invalid",
          );
        }
        subjectCounts.set(lesson.subject, current + 1);
      }

      const counts = Object.fromEntries(
        [...subjectCounts.entries()]
          .filter(([, count]) => count > 0)
          .sort(([left], [right]) => left.localeCompare(right)),
      );

      return {
        counts: Object.freeze(counts),
        lessons,
        total: lessons.length,
      };
    },
  });
}
