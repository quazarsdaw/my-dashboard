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
  userClaims: Readonly<Record<string, unknown>>;
  userId: string;
}

export type SchoolCommand = Readonly<{
  operation: string;
  [key: string]: unknown;
}>;

export type QueryLessonsInput = Omit<
  Parameters<Client["dataSources"]["query"]>[0],
  "data_source_id"
>;

export type NotionQueryResponse = Awaited<
  ReturnType<Client["dataSources"]["query"]>
>;

export type NotionPage = Awaited<ReturnType<Client["pages"]["retrieve"]>>;

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

export type LessonStatus =
  | "Нераспределён"
  | "Запланирован"
  | "В процессе"
  | "Выполнен"
  | "Частично выполнен"
  | "Пропущен"
  | "Отменён";

export type LessonPriority = "Must" | "Should" | "Could";

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

export type LessonResult =
  | "Зачёт"
  | "Незачёт"
  | "Требует повторения"
  | null;

export type LessonAutonomy = "A0" | "A1" | "A2" | "A3" | null;

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
  decisionRequest: "Перенос между неделями" | null;
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
  listLessons(filter: LessonFilter): Promise<Lesson[]>;
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
