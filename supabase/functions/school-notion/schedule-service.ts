import { SchoolHttpError } from "./errors.ts";
import type {
  ActiveLessonLease,
  ChangeLessonDurationCommand,
  ClearDecisionRequestCommand,
  Lesson,
  LessonDestination,
  MoveLessonCommand,
  PauseAndMoveLessonCommand,
  ReorderLessonCommand,
  RequestCrossWeekMoveCommand,
  RestoreMissedLessonCommand,
  ScheduleLessonRepository,
  ScheduleService,
  SchoolCommand,
  SchoolLockService,
  UnscheduleLessonCommand,
} from "./types.ts";

type OverlapCommand =
  | MoveLessonCommand
  | PauseAndMoveLessonCommand
  | RestoreMissedLessonCommand
  | ChangeLessonDurationCommand;

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

function invalidSchedule(): SchoolHttpError {
  return new SchoolHttpError(
    400,
    "INVALID_COMMAND",
    "command payload is invalid",
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

function addMinutesPreservingOffset(start: string, minutes: number): string {
  const timestamp = Date.parse(start);
  if (!Number.isFinite(timestamp)) {
    throw invalidSchedule();
  }
  if (start.endsWith("Z")) {
    const result = new Date(timestamp + minutes * 60_000).toISOString();
    if (result.slice(0, 10) !== start.slice(0, 10)) {
      throw invalidSchedule();
    }
    return result;
  }

  const match = start.match(/([+-])(\d{2}):(\d{2})$/);
  if (!match) {
    throw invalidSchedule();
  }
  const direction = match[1] === "+" ? 1 : -1;
  const offsetMinutes = direction *
    (Number(match[2]) * 60 + Number(match[3]));
  const local = new Date(
    timestamp + minutes * 60_000 + offsetMinutes * 60_000,
  ).toISOString().slice(0, 19);
  const result = `${local}${match[0]}`;
  if (result.slice(0, 10) !== start.slice(0, 10)) {
    throw invalidSchedule();
  }
  return result;
}

function scheduleForDestination(
  destination: LessonDestination,
  durationMinutes: number,
): Lesson["schedule"] {
  if (destination.kind === "unscheduled") {
    return {
      date: null,
      end: null,
      kind: "unscheduled",
      start: null,
    };
  }
  if (destination.kind === "date-only") {
    return {
      date: destination.date,
      end: null,
      kind: "date-only",
      start: null,
    };
  }
  return {
    date: destination.start.slice(0, 10),
    end: addMinutesPreservingOffset(destination.start, durationMinutes),
    kind: "timed",
    start: destination.start,
  };
}

function scheduleForCommand(
  lesson: Lesson,
  command: OverlapCommand,
): Lesson["schedule"] {
  if (command.operation === "changeLessonDuration") {
    if (lesson.schedule.kind !== "timed") {
      return lesson.schedule;
    }
    return scheduleForDestination(
      { kind: "timed", start: lesson.schedule.start },
      command.durationMinutes,
    );
  }
  return scheduleForDestination(
    command.destination,
    lesson.durationMinutes,
  );
}

function conflictSummary(lesson: Lesson) {
  if (lesson.schedule.kind !== "timed") {
    throw invalidSchedule();
  }
  return Object.freeze({
    end: lesson.schedule.end,
    id: lesson.id,
    start: lesson.schedule.start,
    subject: lesson.subject,
    title: lesson.title,
  });
}

function findConflicts(
  current: Lesson,
  candidateSchedule: Lesson["schedule"],
  lessons: readonly Lesson[],
): Lesson[] {
  if (candidateSchedule.kind !== "timed") {
    return [];
  }
  const candidateStart = Date.parse(candidateSchedule.start);
  const candidateEnd = Date.parse(candidateSchedule.end);
  return lessons.filter((lesson) => {
    if (
      lesson.id === current.id ||
      lesson.status === "Отменён" ||
      lesson.schedule.kind !== "timed" ||
      lesson.schedule.date !== candidateSchedule.date
    ) {
      return false;
    }
    const existingStart = Date.parse(lesson.schedule.start);
    const existingEnd = Date.parse(lesson.schedule.end);
    return candidateStart < existingEnd && candidateEnd > existingStart;
  }).sort((left, right) => {
    if (left.schedule.kind !== "timed" || right.schedule.kind !== "timed") {
      return left.id.localeCompare(right.id);
    }
    return left.schedule.start.localeCompare(right.schedule.start) ||
      left.order - right.order ||
      left.id.localeCompare(right.id);
  });
}

async function assertNoUnconfirmedOverlap(
  repository: ScheduleLessonRepository,
  current: Lesson,
  command: OverlapCommand,
  renewBeforeNextPage?: () => Promise<void>,
  renewAfterRead?: () => Promise<void>,
): Promise<void> {
  const candidateSchedule = scheduleForCommand(current, command);
  if (candidateSchedule.kind !== "timed") {
    return;
  }
  const lessons = await repository.listWeekLessons(renewBeforeNextPage);
  await renewAfterRead?.();
  const conflicts = findConflicts(current, candidateSchedule, lessons);
  if (conflicts.length > 0 && command.allowOverlap !== true) {
    throw new SchoolHttpError(
      409,
      "LESSON_TIME_CONFLICT",
      "lesson time overlaps another lesson",
      { conflicts: conflicts.map(conflictSummary) },
    );
  }
}

function assertMovable(lesson: Lesson): void {
  if (
    lesson.status !== "Нераспределён" &&
    lesson.status !== "Запланирован" &&
    lesson.status !== "В процессе"
  ) {
    throw transitionRequired(lesson);
  }
}

function assertNonActiveScheduleEdit(lesson: Lesson): void {
  if (
    lesson.status !== "Нераспределён" &&
    lesson.status !== "Запланирован"
  ) {
    throw transitionRequired(lesson);
  }
}

function destinationDate(destination: LessonDestination): string | null {
  if (destination.kind === "date-only") {
    return destination.date;
  }
  if (destination.kind === "timed") {
    return destination.start.slice(0, 10);
  }
  return null;
}

async function update(
  repository: ScheduleLessonRepository,
  command: SchoolCommand,
  current: Lesson,
): Promise<Lesson> {
  return await repository.updateLesson(command, current);
}

export function createScheduleService(
  repository: ScheduleLessonRepository,
  lockService: SchoolLockService,
): ScheduleService {
  return Object.freeze({
    async changeLessonDuration(
      _ownerId: string,
      command: ChangeLessonDurationCommand,
    ): Promise<Lesson> {
      const current = await repository.getLesson(command.lessonId);
      assertMovable(current);
      await assertNoUnconfirmedOverlap(repository, current, command);
      if (
        current.durationMinutes === command.durationMinutes &&
        !current.warnings.some((warning) =>
          warning.code === "duration-mismatch" ||
          warning.code === "invalid-duration"
        )
      ) {
        return current;
      }
      return await update(repository, command, current);
    },

    async clearDecisionRequest(
      _ownerId: string,
      command: ClearDecisionRequestCommand,
    ): Promise<Lesson> {
      const current = await repository.getLesson(command.lessonId);
      if (current.decisionRequest === null) {
        return current;
      }
      return await update(repository, command, current);
    },

    async moveLesson(
      _ownerId: string,
      command: MoveLessonCommand,
    ): Promise<Lesson> {
      const current = await repository.getLesson(command.lessonId);
      assertMovable(current);
      if (
        current.status === "В процессе" &&
        destinationDate(command.destination) !== current.schedule.date
      ) {
        throw transitionRequired(current);
      }
      await assertNoUnconfirmedOverlap(repository, current, command);
      return await update(repository, command, current);
    },

    async pauseAndMoveLesson(
      ownerId: string,
      command: PauseAndMoveLessonCommand,
    ): Promise<Lesson> {
      return await lockService.withActiveLessonLock(
        ownerId,
        async (lease) => {
          const activeLessons = await step(
            repository.listActiveLessons(() => lease.renew()),
            lease,
          );
          if (activeLessons.length > 1) {
            throw inconsistentActiveState(activeLessons);
          }
          if (
            activeLessons.length !== 1 ||
            activeLessons[0]?.id !== command.lessonId
          ) {
            throw expectationFailed();
          }

          const current = await step(
            repository.getLesson(command.lessonId),
            lease,
          );
          if (current.status !== "В процессе") {
            throw expectationFailed();
          }

          await assertNoUnconfirmedOverlap(
            repository,
            current,
            command,
            () => lease.renew(),
            () => lease.renew(),
          );
          const updated = await step(
            repository.updateLesson(command, current),
            lease,
          );
          const finalActive = await step(
            repository.listActiveLessons(() => lease.renew()),
            lease,
          );
          if (finalActive.length !== 0) {
            throw inconsistentActiveState(finalActive);
          }
          return updated;
        },
      );
    },

    async reorderLesson(
      _ownerId: string,
      command: ReorderLessonCommand,
    ): Promise<Lesson> {
      const current = await repository.getLesson(command.lessonId);
      assertMovable(current);
      if (current.order === command.order) {
        return current;
      }
      return await update(repository, command, current);
    },

    async requestCrossWeekMove(
      _ownerId: string,
      command: RequestCrossWeekMoveCommand,
    ): Promise<Lesson> {
      const current = await repository.getLesson(command.lessonId);
      if (current.status === "Отменён") {
        throw transitionRequired(current);
      }
      if (current.decisionRequest === "Перенос между неделями") {
        return current;
      }
      return await update(repository, command, current);
    },

    async restoreMissedLesson(
      _ownerId: string,
      command: RestoreMissedLessonCommand,
    ): Promise<Lesson> {
      const current = await repository.getLesson(command.lessonId);
      if (current.status !== "Пропущен") {
        throw transitionRequired(current);
      }
      await assertNoUnconfirmedOverlap(repository, current, command);
      return await update(repository, command, current);
    },

    async unscheduleLesson(
      _ownerId: string,
      command: UnscheduleLessonCommand,
    ): Promise<Lesson> {
      const current = await repository.getLesson(command.lessonId);
      assertNonActiveScheduleEdit(current);
      if (
        current.status === "Нераспределён" &&
        current.schedule.kind === "unscheduled" &&
        current.order === command.order
      ) {
        return current;
      }
      return await update(repository, command, current);
    },
  });
}
