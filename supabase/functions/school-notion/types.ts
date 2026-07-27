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
