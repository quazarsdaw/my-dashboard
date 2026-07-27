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
  code: "duration-mismatch";
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
  missedReason: string | null;
  module: string;
  moveCount: number;
  order: number;
  priority: LessonPriority;
  result: LessonResult;
  schedule: LessonSchedule;
  status: LessonStatus;
  subject: string;
  title: string;
  understanding: 0 | 1 | 2 | 3 | null;
  warnings: LessonWarning[];
  week: string;
}

export type LessonFilter =
  | Readonly<{ week: string; from?: never; to?: never }>
  | Readonly<{ from: string; to: string; week?: never }>;

export type ListLessonsCommand =
  & Readonly<{ operation: "listLessons" }>
  & LessonFilter;

export interface LessonListResult {
  counts: Readonly<Record<string, number>>;
  lessons: Lesson[];
  total: number;
}

export interface LessonRepository {
  listLessons(filter: LessonFilter): Promise<Lesson[]>;
}

export interface RouterContext {
  auth: AuthContext;
  notionClient?: SchoolNotionReadClient;
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
