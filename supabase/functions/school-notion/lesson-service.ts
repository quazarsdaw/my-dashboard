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
      const counts = Object.fromEntries(
        Object.entries(
          lessons.reduce<Record<string, number>>((result, lesson) => {
            if (lesson.subject) {
              result[lesson.subject] = (result[lesson.subject] ?? 0) + 1;
            }
            return result;
          }, {}),
        ).sort(([left], [right]) => left.localeCompare(right)),
      );

      return {
        counts: Object.freeze(counts),
        lessons,
        total: lessons.length,
      };
    },
  });
}
