import type { Client } from "@notionhq/client";

export interface SchoolEnvironment {
  DASHBOARD_ORIGIN: string;
  NOTION_DATA_SOURCE_ID: string;
  NOTION_TOKEN: string;
  SCHOOL_ENV?: string;
  SCHOOL_OWNER_USER_ID: string;
}

export interface SupabaseContextResult {
  data?: unknown;
  error?: unknown;
}

export type CreateUserClient = (
  request: Request,
  options: { auth: "user" },
) => Promise<SupabaseContextResult>;

export interface AuthContext {
  supabase: unknown;
  supabaseAdmin?: unknown;
  userClaims: Readonly<Record<string, unknown>>;
  userId: string;
}

export type QueryLessonsInput = Omit<
  Parameters<Client["dataSources"]["query"]>[0],
  "data_source_id"
>;

export type NotionQueryResponse = Awaited<
  ReturnType<Client["dataSources"]["query"]>
>;

export type NotionPage = Awaited<ReturnType<Client["pages"]["retrieve"]>>;

export type NotionUpdateProperties = NonNullable<
  Parameters<Client["pages"]["update"]>[0]["properties"]
>;

export type NotionPageUpdateResponse = Awaited<
  ReturnType<Client["pages"]["update"]>
>;

export type NotionBlockPage = Awaited<
  ReturnType<Client["blocks"]["children"]["list"]>
>;

export interface SchoolNotionReadClient {
  queryDataSource(input: QueryLessonsInput): Promise<NotionQueryResponse>;
  retrievePage(pageId: string): Promise<NotionPage>;
  listBlockChildren(
    blockId: string,
    startCursor?: string,
  ): Promise<NotionBlockPage>;
}

export interface SchoolNotionMutationClient extends SchoolNotionReadClient {
  updatePage(
    pageId: string,
    properties: NotionUpdateProperties,
  ): Promise<NotionPageUpdateResponse>;
}

export type SchoolLockRpcResult = Readonly<{
  data: unknown;
  error: unknown;
}>;

export interface SchoolLockRpcClient {
  rpc(
    name: string,
    args: Readonly<Record<string, unknown>>,
  ): Promise<SchoolLockRpcResult>;
}

export interface ActiveLessonLease {
  renew(): Promise<void>;
}

export interface SchoolLockService {
  withActiveLessonLock<T>(
    ownerId: string,
    operation: (lease: ActiveLessonLease) => T | Promise<T>,
  ): Promise<T>;
}

export const LESSON_STATUSES = Object.freeze(
  [
    "Нераспределён",
    "Запланирован",
    "В процессе",
    "Выполнен",
    "Частично выполнен",
    "Пропущен",
    "Отменён",
  ] as const,
);

export type LessonStatus = (typeof LESSON_STATUSES)[number];

export const LESSON_PRIORITIES = Object.freeze(
  ["Must", "Should", "Could"] as const,
);

export type LessonPriority = (typeof LESSON_PRIORITIES)[number];

export const LESSON_SUBJECTS = Object.freeze(
  [
    "Software Engineering",
    "DevOps & Infrastructure",
    "English & IELTS",
    "Mathematics",
    "University",
    "Director & Assessment",
  ] as const,
);

export type LessonSubject = (typeof LESSON_SUBJECTS)[number];

export const ACTIVE_LESSON_WEEK = "W01 · 3–9 августа 2026" as const;

export const LESSON_DECISION_REQUESTS = Object.freeze(
  ["Перенос между неделями"] as const,
);

export type LessonDecisionRequest = (typeof LESSON_DECISION_REQUESTS)[number];

export const LESSON_MISSED_REASONS = Object.freeze(
  [
    "Внешние обстоятельства",
    "Ошибка планирования",
    "Низкая энергия",
    "Избегание сложной задачи",
    "Задача слишком большая",
    "Техническая проблема",
  ] as const,
);

export type LessonMissedReason = (typeof LESSON_MISSED_REASONS)[number] | null;

export const LESSON_RESULTS = Object.freeze(
  ["Зачёт", "Незачёт", "Требует повторения"] as const,
);

export type LessonResult = (typeof LESSON_RESULTS)[number] | null;

export const LESSON_AUTONOMIES = Object.freeze(
  ["A0", "A1", "A2", "A3"] as const,
);

export type LessonAutonomy = (typeof LESSON_AUTONOMIES)[number] | null;

export type LessonSchedule =
  | Readonly<{
    date: null;
    end: null;
    kind: "unscheduled";
    start: null;
  }>
  | Readonly<{
    date: string;
    end: null;
    kind: "date-only";
    start: null;
  }>
  | Readonly<{
    date: string;
    end: string;
    kind: "timed";
    start: string;
  }>;

export type LessonWarning = Readonly<{
  code: "duration-mismatch" | "invalid-duration";
}>;

export interface Lesson {
  artifactUrl: string | null;
  autonomy: LessonAutonomy;
  comment: string;
  decisionRequest: LessonDecisionRequest | null;
  durationMinutes: number;
  hasLearningEvidence: boolean;
  id: string;
  isFinalized: boolean;
  missedReason: LessonMissedReason;
  module: string;
  moveCount: number;
  order: number;
  priority: LessonPriority;
  result: LessonResult;
  schedule: LessonSchedule;
  status: LessonStatus;
  subject: LessonSubject;
  title: string;
  understanding: 0 | 1 | 2 | 3 | null;
  warnings: LessonWarning[];
  week: typeof ACTIVE_LESSON_WEEK;
}

export type LessonContentColor =
  | "default"
  | "gray"
  | "brown"
  | "orange"
  | "yellow"
  | "green"
  | "blue"
  | "purple"
  | "pink"
  | "red"
  | "gray_background"
  | "brown_background"
  | "orange_background"
  | "yellow_background"
  | "green_background"
  | "blue_background"
  | "purple_background"
  | "pink_background"
  | "red_background";

export interface LessonContentAnnotations {
  bold: boolean;
  code: boolean;
  color: LessonContentColor;
  italic: boolean;
  strikethrough: boolean;
  underline: boolean;
}

export interface LessonContentSpan {
  annotations: LessonContentAnnotations;
  link: string | null;
  text: string;
}

type RichTextLessonBlockType =
  | "paragraph"
  | "heading_1"
  | "heading_2"
  | "heading_3"
  | "heading_4"
  | "bulleted_list_item"
  | "numbered_list_item"
  | "toggle"
  | "quote"
  | "callout";

type ContainerLessonBlockType =
  | "column_list"
  | "column"
  | "synced_block";

type ReferenceLessonBlockType =
  | "bookmark"
  | "link_preview"
  | "image"
  | "file"
  | "pdf"
  | "video"
  | "audio"
  | "embed";

export type LessonContentBlock =
  | Readonly<{
    children: LessonContentBlock[];
    spans: LessonContentSpan[];
    type: RichTextLessonBlockType;
  }>
  | Readonly<{
    checked: boolean;
    children: LessonContentBlock[];
    spans: LessonContentSpan[];
    type: "to_do";
  }>
  | Readonly<{
    caption: LessonContentSpan[];
    children: LessonContentBlock[];
    language: string;
    spans: LessonContentSpan[];
    type: "code";
  }>
  | Readonly<{
    children: LessonContentBlock[];
    expression: string;
    type: "equation";
  }>
  | Readonly<{
    children: LessonContentBlock[];
    type: "divider";
  }>
  | Readonly<{
    children: LessonContentBlock[];
    hasColumnHeader: boolean;
    hasRowHeader: boolean;
    tableWidth: number;
    type: "table";
  }>
  | Readonly<{
    cells: LessonContentSpan[][];
    children: LessonContentBlock[];
    type: "table_row";
  }>
  | Readonly<{
    children: LessonContentBlock[];
    type: ContainerLessonBlockType;
  }>
  | Readonly<{
    caption: LessonContentSpan[];
    children: LessonContentBlock[];
    label: string;
    type: ReferenceLessonBlockType;
    url: string | null;
  }>
  | Readonly<{
    label: string;
    sourceType: string;
    type: "unsupported";
  }>;

export type LessonFilter =
  | Readonly<{ week: string; from?: never; to?: never }>
  | Readonly<{ from: string; to: string; week?: never }>;

export type ListLessonsCommand =
  & Readonly<{ operation: "listLessons" }>
  & LessonFilter;

export type GetLessonContentCommand = Readonly<{
  lessonId: string;
  operation: "getLessonContent";
}>;

export type LessonDestination =
  | Readonly<{
    date: string;
    kind: "date-only";
  }>
  | Readonly<{
    kind: "timed";
    start: string;
  }>
  | Readonly<{
    kind: "unscheduled";
  }>;

type ScheduledDestination = Exclude<
  LessonDestination,
  Readonly<{ kind: "unscheduled" }>
>;

export type MoveLessonCommand = Readonly<{
  allowOverlap?: boolean;
  destination: ScheduledDestination;
  lessonId: string;
  operation: "moveLesson";
  order: number;
}>;

export type UnscheduleLessonCommand = Readonly<{
  lessonId: string;
  operation: "unscheduleLesson";
  order: number;
}>;

export type ChangeLessonDurationCommand = Readonly<{
  allowOverlap?: boolean;
  durationMinutes: number;
  lessonId: string;
  operation: "changeLessonDuration";
}>;

export type ReorderLessonCommand = Readonly<{
  lessonId: string;
  operation: "reorderLesson";
  order: number;
}>;

export type PauseAndMoveLessonCommand = Readonly<{
  allowOverlap?: boolean;
  destination: LessonDestination;
  lessonId: string;
  operation: "pauseAndMoveLesson";
  order: number;
}>;

export type RestoreMissedLessonCommand = Readonly<{
  allowOverlap?: boolean;
  destination: ScheduledDestination;
  lessonId: string;
  operation: "restoreMissedLesson";
  order: number;
}>;

export type StartLessonCommand = Readonly<{
  lessonId: string;
  operation: "startLesson";
}>;

export type SwitchActiveLessonCommand = Readonly<{
  newLessonId: string;
  operation: "switchActiveLesson";
  previousLessonId: string;
}>;

export type ResolveActiveLessonsCommand = Readonly<{
  keepLessonId: string;
  operation: "resolveActiveLessons";
}>;

export type ReopenLessonCommand = Readonly<{
  lessonId: string;
  operation: "reopenLesson";
}>;

type AssessmentCommon = Readonly<{
  artifactUrl?: string | null;
  comment?: string;
  lessonId: string;
  operation: "completeLesson";
}>;

export type CompleteLessonCommand =
  | (
    & AssessmentCommon
    & Readonly<{
      autonomy: Exclude<LessonAutonomy, null>;
      result?: Exclude<LessonResult, null>;
      status: "Выполнен";
      understanding: 0 | 1 | 2 | 3;
    }>
  )
  | (
    & AssessmentCommon
    & Readonly<{
      autonomy: Exclude<LessonAutonomy, null>;
      status: "Частично выполнен";
      understanding: 0 | 1 | 2 | 3;
    }>
  )
  | Readonly<{
    comment?: string;
    lessonId: string;
    missedReason: Exclude<LessonMissedReason, null>;
    operation: "completeLesson";
    status: "Пропущен";
  }>;

export type CancelLessonCommand = Readonly<{
  confirmLearningEvidence?: boolean;
  lessonId: string;
  operation: "cancelLesson";
}>;

export type RestoreCancelledLessonCommand = Readonly<{
  lessonId: string;
  operation: "restoreCancelledLesson";
}>;

export type CorrectMissedStatusCommand = Readonly<{
  lessonId: string;
  operation: "correctMissedStatus";
}>;

export type ClearLearningEvidenceCommand = Readonly<{
  confirm: true;
  lessonId: string;
  operation: "clearLearningEvidence";
}>;

export type RequestCrossWeekMoveCommand = Readonly<{
  lessonId: string;
  operation: "requestCrossWeekMove";
}>;

export type ClearDecisionRequestCommand = Readonly<{
  lessonId: string;
  operation: "clearDecisionRequest";
}>;

export type SchoolCommand =
  | ListLessonsCommand
  | GetLessonContentCommand
  | MoveLessonCommand
  | UnscheduleLessonCommand
  | ChangeLessonDurationCommand
  | ReorderLessonCommand
  | PauseAndMoveLessonCommand
  | RestoreMissedLessonCommand
  | StartLessonCommand
  | SwitchActiveLessonCommand
  | ResolveActiveLessonsCommand
  | ReopenLessonCommand
  | CompleteLessonCommand
  | CancelLessonCommand
  | RestoreCancelledLessonCommand
  | CorrectMissedStatusCommand
  | ClearLearningEvidenceCommand
  | RequestCrossWeekMoveCommand
  | ClearDecisionRequestCommand;

export interface ActiveLessonRepository {
  getLesson(lessonId: string): Promise<Lesson>;
  listActiveLessons(
    renewBeforeNextPage?: () => Promise<void>,
  ): Promise<Lesson[]>;
  updateLesson(
    command: SchoolCommand,
    currentLesson: Lesson,
  ): Promise<Lesson>;
}

export interface ActiveLessonService {
  reopenLesson(
    ownerId: string,
    command: ReopenLessonCommand,
  ): Promise<Lesson>;
  resolveActiveLessons(
    ownerId: string,
    command: ResolveActiveLessonsCommand,
  ): Promise<
    Readonly<{
      activeLesson: Lesson;
      pausedLessons: Lesson[];
    }>
  >;
  startLesson(
    ownerId: string,
    command: StartLessonCommand,
  ): Promise<Lesson>;
  switchActiveLesson(
    ownerId: string,
    command: SwitchActiveLessonCommand,
  ): Promise<
    Readonly<{
      activeLesson: Lesson;
      previousLesson: Lesson;
    }>
  >;
}

export interface AssessmentService {
  cancelLesson(
    ownerId: string,
    command: CancelLessonCommand,
  ): Promise<Lesson>;
  clearLearningEvidence(
    ownerId: string,
    command: ClearLearningEvidenceCommand,
  ): Promise<Lesson>;
  completeLesson(
    ownerId: string,
    command: CompleteLessonCommand,
  ): Promise<Lesson>;
  correctMissedStatus(
    ownerId: string,
    command: CorrectMissedStatusCommand,
  ): Promise<Lesson>;
  restoreCancelledLesson(
    ownerId: string,
    command: RestoreCancelledLessonCommand,
  ): Promise<Lesson>;
}

export interface ScheduleLessonRepository extends ActiveLessonRepository {
  listWeekLessons(
    renewBeforeNextPage?: () => Promise<void>,
  ): Promise<Lesson[]>;
}

export interface ScheduleService {
  changeLessonDuration(
    ownerId: string,
    command: ChangeLessonDurationCommand,
  ): Promise<Lesson>;
  clearDecisionRequest(
    ownerId: string,
    command: ClearDecisionRequestCommand,
  ): Promise<Lesson>;
  moveLesson(
    ownerId: string,
    command: MoveLessonCommand,
  ): Promise<Lesson>;
  pauseAndMoveLesson(
    ownerId: string,
    command: PauseAndMoveLessonCommand,
  ): Promise<Lesson>;
  reorderLesson(
    ownerId: string,
    command: ReorderLessonCommand,
  ): Promise<Lesson>;
  requestCrossWeekMove(
    ownerId: string,
    command: RequestCrossWeekMoveCommand,
  ): Promise<Lesson>;
  restoreMissedLesson(
    ownerId: string,
    command: RestoreMissedLessonCommand,
  ): Promise<Lesson>;
  unscheduleLesson(
    ownerId: string,
    command: UnscheduleLessonCommand,
  ): Promise<Lesson>;
}

export interface LessonListResult {
  counts: Readonly<Record<string, number>>;
  lessons: Lesson[];
  total: number;
}

export interface LessonContentResult {
  blocks: LessonContentBlock[];
  lesson: Lesson;
}

export interface LessonRepository {
  assertSchoolLesson(pageId: string): Promise<NotionPage>;
  listLessons(
    filter: LessonFilter,
    renewBeforeNextPage?: () => Promise<void>,
  ): Promise<Lesson[]>;
}

export interface RouterContext {
  auth: AuthContext;
  notionClient?: SchoolNotionReadClient;
  notionDataSourceId?: string;
  requestId: string;
  userId: string;
}

export type SchoolRouter = (
  command: SchoolCommand,
  context: RouterContext,
) => Promise<Response>;

export interface HandlerDependencies {
  createRequestId?: () => string;
  createUserClient: CreateUserClient;
  env: SchoolEnvironment;
  router?: SchoolRouter;
}
