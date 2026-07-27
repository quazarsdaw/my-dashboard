import { SchoolHttpError } from "./errors.ts";
import type {
  ActiveLessonLease,
  ActiveLessonRepository,
  ActiveLessonService,
  Lesson,
  ReopenLessonCommand,
  ResolveActiveLessonsCommand,
  SchoolLockService,
  StartLessonCommand,
  SwitchActiveLessonCommand,
} from "./types.ts";

type SafeLogger = Readonly<{
  error(event: Readonly<Record<string, unknown>>): void;
}>;

const defaultLogger: SafeLogger = Object.freeze({
  error: (event) => {
    console.error(JSON.stringify(event));
  },
});

function lessonSummary(lesson: Lesson) {
  return Object.freeze({
    id: lesson.id,
    subject: lesson.subject,
    title: lesson.title,
  });
}

function inconsistentState(activeLessons: readonly Lesson[]): SchoolHttpError {
  return new SchoolHttpError(
    409,
    "ACTIVE_LESSON_STATE_INCONSISTENT",
    "active lesson state requires resolution",
    {
      activeLessons: activeLessons.map(lessonSummary),
    },
  );
}

function activeLessonExists(activeLesson: Lesson): SchoolHttpError {
  return new SchoolHttpError(
    409,
    "ACTIVE_LESSON_EXISTS",
    "another lesson is already active",
    {
      activeLesson: lessonSummary(activeLesson),
    },
  );
}

function transitionRequired(lesson: Lesson): SchoolHttpError {
  return new SchoolHttpError(
    409,
    "LESSON_STATUS_TRANSITION_REQUIRED",
    "lesson status transition is required",
    { status: lesson.status },
  );
}

function expectationFailed(): SchoolHttpError {
  return new SchoolHttpError(
    409,
    "ACTIVE_LESSON_EXPECTATION_FAILED",
    "active lesson state changed before the operation",
  );
}

async function step<T>(
  action: Promise<T>,
  lease: ActiveLessonLease,
): Promise<T> {
  const result = await action;
  await lease.renew();
  return result;
}

function assertAtMostOneActive(activeLessons: readonly Lesson[]): void {
  if (activeLessons.length > 1) {
    throw inconsistentState(activeLessons);
  }
}

function assertOnlyActive(
  activeLessons: readonly Lesson[],
  expectedLessonId: string,
): Lesson {
  if (
    activeLessons.length !== 1 ||
    activeLessons[0]?.id !== expectedLessonId
  ) {
    if (activeLessons.length > 1) {
      throw inconsistentState(activeLessons);
    }
    throw expectationFailed();
  }

  return activeLessons[0];
}

async function compensatePreviousLesson(
  repository: ActiveLessonRepository,
  lease: ActiveLessonLease,
  previousLesson: Lesson,
  logger: SafeLogger,
): Promise<void> {
  let compensationApplied = false;
  let activeCount: number | null = null;

  try {
    await repository.updateLesson(
      {
        lessonId: previousLesson.id,
        operation: "reopenLesson",
      },
      previousLesson,
    );
    compensationApplied = true;
    try {
      await lease.renew();
    } catch {
      // A lost lease is reported by the original operation after rechecking.
    }
  } catch {
    compensationApplied = false;
  }

  try {
    const activeLessons = await repository.listActiveLessons(
      () => lease.renew(),
    );
    activeCount = activeLessons.length;
    try {
      await lease.renew();
    } catch {
      // The re-read is still useful for the safe compensation audit event.
    }
  } catch {
    activeCount = null;
  }

  try {
    logger.error({
      activeCount,
      compensationApplied,
      event: "active_lesson_switch_compensation",
    });
  } catch {
    // Logging must not mask the normalized domain failure.
  }
}

export function createActiveLessonService(
  repository: ActiveLessonRepository,
  lockService: SchoolLockService,
  logger: SafeLogger = defaultLogger,
): ActiveLessonService {
  return Object.freeze({
    reopenLesson(
      ownerId: string,
      command: ReopenLessonCommand,
    ): Promise<Lesson> {
      return lockService.withActiveLessonLock(ownerId, async (lease) => {
        const activeLessons = await step(
          repository.listActiveLessons(() => lease.renew()),
          lease,
        );
        assertAtMostOneActive(activeLessons);

        if (activeLessons[0]?.id === command.lessonId) {
          return activeLessons[0];
        }
        if (activeLessons.length === 1) {
          throw activeLessonExists(activeLessons[0]);
        }

        const target = await step(
          repository.getLesson(command.lessonId),
          lease,
        );
        if (
          target.status !== "Выполнен" &&
          target.status !== "Частично выполнен"
        ) {
          throw transitionRequired(target);
        }

        await step(repository.updateLesson(command, target), lease);
        const verified = await step(
          repository.listActiveLessons(() => lease.renew()),
          lease,
        );
        return assertOnlyActive(verified, target.id);
      });
    },

    resolveActiveLessons(
      ownerId: string,
      command: ResolveActiveLessonsCommand,
    ) {
      return lockService.withActiveLessonLock(ownerId, async (lease) => {
        const activeLessons = await step(
          repository.listActiveLessons(() => lease.renew()),
          lease,
        );
        const selected = activeLessons.find((lesson) =>
          lesson.id === command.keepLessonId
        );
        if (!selected) {
          throw expectationFailed();
        }
        if (activeLessons.length === 1) {
          return {
            activeLesson: selected,
            pausedLessons: [],
          };
        }

        const verifiedActive: Lesson[] = [];
        for (const activeLesson of activeLessons) {
          const verified = await step(
            repository.getLesson(activeLesson.id),
            lease,
          );
          if (verified.status !== "В процессе") {
            throw expectationFailed();
          }
          verifiedActive.push(verified);
        }

        const pausedLessons: Lesson[] = [];
        for (const activeLesson of verifiedActive) {
          if (activeLesson.id === command.keepLessonId) {
            continue;
          }
          pausedLessons.push(
            await step(
              repository.updateLesson(command, activeLesson),
              lease,
            ),
          );
        }

        const finalActive = await step(
          repository.listActiveLessons(() => lease.renew()),
          lease,
        );
        return {
          activeLesson: assertOnlyActive(
            finalActive,
            command.keepLessonId,
          ),
          pausedLessons,
        };
      });
    },

    startLesson(
      ownerId: string,
      command: StartLessonCommand,
    ): Promise<Lesson> {
      return lockService.withActiveLessonLock(ownerId, async (lease) => {
        const activeLessons = await step(
          repository.listActiveLessons(() => lease.renew()),
          lease,
        );
        assertAtMostOneActive(activeLessons);

        if (activeLessons[0]?.id === command.lessonId) {
          return activeLessons[0];
        }
        if (activeLessons.length === 1) {
          throw activeLessonExists(activeLessons[0]);
        }

        const target = await step(
          repository.getLesson(command.lessonId),
          lease,
        );
        if (target.status !== "Запланирован") {
          throw transitionRequired(target);
        }

        await step(repository.updateLesson(command, target), lease);
        const verified = await step(
          repository.listActiveLessons(() => lease.renew()),
          lease,
        );
        return assertOnlyActive(verified, target.id);
      });
    },

    switchActiveLesson(
      ownerId: string,
      command: SwitchActiveLessonCommand,
    ) {
      return lockService.withActiveLessonLock(ownerId, async (lease) => {
        const activeLessons = await step(
          repository.listActiveLessons(() => lease.renew()),
          lease,
        );
        assertAtMostOneActive(activeLessons);
        if (
          activeLessons.length !== 1 ||
          activeLessons[0]?.id !== command.previousLessonId
        ) {
          throw expectationFailed();
        }

        const previousLesson = await step(
          repository.getLesson(command.previousLessonId),
          lease,
        );
        const newLesson = await step(
          repository.getLesson(command.newLessonId),
          lease,
        );
        if (previousLesson.status !== "В процессе") {
          throw expectationFailed();
        }
        if (
          newLesson.status !== "Запланирован" &&
          newLesson.status !== "Выполнен" &&
          newLesson.status !== "Частично выполнен"
        ) {
          throw transitionRequired(newLesson);
        }

        let previousUpdated: Lesson | null = null;
        let newUpdateCompleted = false;

        try {
          previousUpdated = await repository.updateLesson(
            command,
            previousLesson,
          );
          await lease.renew();

          await repository.updateLesson(command, newLesson);
          newUpdateCompleted = true;
          await lease.renew();

          const finalActive = await step(
            repository.listActiveLessons(() => lease.renew()),
            lease,
          );
          return {
            activeLesson: assertOnlyActive(
              finalActive,
              command.newLessonId,
            ),
            previousLesson: previousUpdated,
          };
        } catch (error) {
          if (previousUpdated && !newUpdateCompleted) {
            await compensatePreviousLesson(
              repository,
              lease,
              previousLesson,
              logger,
            );
          }

          if (
            error instanceof SchoolHttpError &&
            (
              error.code === "SCHOOL_LOCK_LOST" ||
              error.code === "ACTIVE_LESSON_STATE_INCONSISTENT"
            )
          ) {
            throw error;
          }

          throw new SchoolHttpError(
            502,
            "ACTIVE_LESSON_SWITCH_FAILED",
            "active lesson switch could not be completed",
          );
        }
      });
    },
  });
}
