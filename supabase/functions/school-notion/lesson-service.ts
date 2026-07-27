import { SchoolHttpError } from "./errors.ts";
import { LESSON_SUBJECTS } from "./types.ts";
import type {
  LessonListResult,
  LessonRepository,
  ListLessonsCommand,
} from "./types.ts";

export interface LessonService {
  listLessons(command: ListLessonsCommand): Promise<LessonListResult>;
}

export function createLessonService(
  repository: LessonRepository,
): LessonService {
  return Object.freeze({
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
