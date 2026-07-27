import { SchoolHttpError } from "./errors.ts";
import type {
  ActiveLessonLease,
  ActiveLessonRepository,
  AssessmentService,
  CancelLessonCommand,
  ClearLearningEvidenceCommand,
  CompleteLessonCommand,
  CorrectMissedStatusCommand,
  Lesson,
  RestoreCancelledLessonCommand,
  SchoolCommand,
  SchoolLockService,
} from "./types.ts";

function transitionRequired(lesson: Lesson): SchoolHttpError {
  return new SchoolHttpError(
    409,
    "LESSON_STATUS_TRANSITION_REQUIRED",
    "lesson status transition is required",
    { status: lesson.status },
  );
}

function inconsistentActiveState(
  activeLessons: readonly Lesson[],
): SchoolHttpError {
  return new SchoolHttpError(
    409,
    "ACTIVE_LESSON_STATE_INCONSISTENT",
    "active lesson state requires resolution",
    {
      activeLessons: activeLessons.map((lesson) => ({
        id: lesson.id,
        subject: lesson.subject,
        title: lesson.title,
      })),
    },
  );
}

function expectationFailed(): SchoolHttpError {
  return new SchoolHttpError(
    409,
    "ACTIVE_LESSON_EXPECTATION_FAILED",
    "active lesson state changed before the operation",
  );
}

function finalizedReopenRequired(): SchoolHttpError {
  return new SchoolHttpError(
    409,
    "FINALIZED_LESSON_REOPEN_REQUIRED",
    "finalized lesson must be reopened before cancellation",
  );
}

function missedCorrectionRequired(): SchoolHttpError {
  return new SchoolHttpError(
    409,
    "MISSED_STATUS_CORRECTION_REQUIRED",
    "missed lesson status must be corrected before cancellation",
  );
}

function learningEvidenceConfirmationRequired(): SchoolHttpError {
  return new SchoolHttpError(
    409,
    "LEARNING_EVIDENCE_CONFIRMATION_REQUIRED",
    "lesson contains learning evidence and requires explicit confirmation",
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

function assertSingleExpectedActive(
  activeLessons: readonly Lesson[],
  lessonId: string,
): void {
  if (activeLessons.length > 1) {
    throw inconsistentActiveState(activeLessons);
  }
  if (
    activeLessons.length !== 1 ||
    activeLessons[0]?.id !== lessonId
  ) {
    throw expectationFailed();
  }
}

function assertNoActiveLessons(activeLessons: readonly Lesson[]): void {
  if (activeLessons.length !== 0) {
    throw inconsistentActiveState(activeLessons);
  }
}

function validateCompletionTransition(
  lesson: Lesson,
  command: CompleteLessonCommand,
): void {
  if (
    lesson.status === "Отменён" ||
    lesson.status === "Нераспределён"
  ) {
    throw transitionRequired(lesson);
  }

  if (
    lesson.status === "Выполнен" ||
    lesson.status === "Частично выполнен"
  ) {
    if (lesson.status !== command.status) {
      throw finalizedReopenRequired();
    }
    return;
  }

  if (lesson.status === "Пропущен" && command.status !== "Пропущен") {
    throw missedCorrectionRequired();
  }
}

function validateCancellation(
  lesson: Lesson,
  command: CancelLessonCommand,
): void {
  if (
    lesson.status === "Выполнен" ||
    lesson.status === "Частично выполнен"
  ) {
    throw finalizedReopenRequired();
  }
  if (lesson.status === "Пропущен") {
    throw missedCorrectionRequired();
  }
  if (
    lesson.hasLearningEvidence &&
    command.confirmLearningEvidence !== true
  ) {
    throw learningEvidenceConfirmationRequired();
  }
}

async function mutateActiveLesson(
  repository: ActiveLessonRepository,
  lockService: SchoolLockService,
  ownerId: string,
  command: CompleteLessonCommand | CancelLessonCommand,
  validate: (lesson: Lesson) => void,
): Promise<Lesson> {
  return await lockService.withActiveLessonLock(
    ownerId,
    async (lease) => {
      const activeLessons = await step(
        repository.listActiveLessons(() => lease.renew()),
        lease,
      );
      assertSingleExpectedActive(activeLessons, command.lessonId);

      const current = await step(
        repository.getLesson(command.lessonId),
        lease,
      );
      if (current.status !== "В процессе") {
        throw expectationFailed();
      }
      validate(current);

      const updated = await step(
        repository.updateLesson(command, current),
        lease,
      );
      const finalActive = await step(
        repository.listActiveLessons(() => lease.renew()),
        lease,
      );
      assertNoActiveLessons(finalActive);
      return updated;
    },
  );
}

async function updateNonActiveLesson(
  repository: ActiveLessonRepository,
  command: SchoolCommand,
  current: Lesson,
): Promise<Lesson> {
  return await repository.updateLesson(command, current);
}

function withCompletedResult(
  command: CompleteLessonCommand,
): CompleteLessonCommand {
  return command.status === "Выполнен"
    ? Object.freeze({
      ...command,
      result: command.result ?? "Зачёт",
    })
    : command;
}

export function createAssessmentService(
  repository: ActiveLessonRepository,
  lockService: SchoolLockService,
): AssessmentService {
  return Object.freeze({
    async cancelLesson(
      ownerId: string,
      command: CancelLessonCommand,
    ): Promise<Lesson> {
      const current = await repository.getLesson(command.lessonId);
      if (current.status === "Отменён") {
        return current;
      }
      validateCancellation(current, command);

      if (current.status === "В процессе") {
        return await mutateActiveLesson(
          repository,
          lockService,
          ownerId,
          command,
          (lesson) => validateCancellation(lesson, command),
        );
      }

      return await updateNonActiveLesson(repository, command, current);
    },

    async clearLearningEvidence(
      _ownerId: string,
      command: ClearLearningEvidenceCommand,
    ): Promise<Lesson> {
      const current = await repository.getLesson(command.lessonId);
      if (current.status !== "Запланирован") {
        throw transitionRequired(current);
      }
      return await updateNonActiveLesson(repository, command, current);
    },

    async completeLesson(
      ownerId: string,
      command: CompleteLessonCommand,
    ): Promise<Lesson> {
      const normalizedCommand = withCompletedResult(command);
      const current = await repository.getLesson(command.lessonId);
      validateCompletionTransition(current, normalizedCommand);

      if (current.status === "В процессе") {
        return await mutateActiveLesson(
          repository,
          lockService,
          ownerId,
          normalizedCommand,
          (lesson) => validateCompletionTransition(lesson, normalizedCommand),
        );
      }

      return await updateNonActiveLesson(
        repository,
        normalizedCommand,
        current,
      );
    },

    async correctMissedStatus(
      _ownerId: string,
      command: CorrectMissedStatusCommand,
    ): Promise<Lesson> {
      const current = await repository.getLesson(command.lessonId);
      if (current.status !== "Пропущен") {
        throw transitionRequired(current);
      }
      return await updateNonActiveLesson(repository, command, current);
    },

    async restoreCancelledLesson(
      _ownerId: string,
      command: RestoreCancelledLessonCommand,
    ): Promise<Lesson> {
      const current = await repository.getLesson(command.lessonId);
      if (current.status !== "Отменён") {
        throw transitionRequired(current);
      }
      return await updateNonActiveLesson(repository, command, current);
    },
  });
}
