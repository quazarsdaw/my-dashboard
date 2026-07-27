import type {
  PageObjectResponse,
  QueryDataSourceResponse,
  RichTextItemResponse,
} from "@notionhq/client";

export const ACTIVE_WEEK = Object.freeze({
  endDate: "2026-08-09",
  notionValue: "W01 · 3–9 августа 2026",
  startDate: "2026-08-03",
});

const subjects = [
  ...Array(9).fill("Software Engineering"),
  ...Array(2).fill("DevOps & Infrastructure"),
  ...Array(3).fill("English & IELTS"),
  ...Array(2).fill("Mathematics"),
  "University",
  "Director & Assessment",
] as const;

const annotations = Object.freeze({
  bold: false,
  code: false,
  color: "default" as const,
  italic: false,
  strikethrough: false,
  underline: false,
});

function richText(content: string): RichTextItemResponse[] {
  return content
    ? [{
      annotations: { ...annotations },
      href: null,
      plain_text: content,
      text: { content, link: null },
      type: "text",
    }]
    : [];
}

type LessonPageOptions = Readonly<{
  archived?: boolean;
  artifactUrl?: string | null;
  autonomy?: string | null;
  comment?: string;
  date?:
    | Readonly<{
      end: string | null;
      start: string;
      time_zone: string | null;
    }>
    | null;
  decisionRequest?: string | null;
  durationMinutes?: number | null;
  id?: string;
  inTrash?: boolean;
  missedReason?: string | null;
  module?: string;
  moveCount?: number | null;
  order?: number | null;
  priority?: string | null;
  result?: string | null;
  status?: string | null;
  subject?: string | null;
  title?: string;
  understanding?: number | null;
  week?: string | null;
}>;

function selectProperty(
  propertyId: string,
  name: string | null,
): PageObjectResponse["properties"][string] {
  return {
    id: propertyId,
    select: name
      ? { color: "default", id: `option-${propertyId}`, name }
      : null,
    type: "select",
  };
}

export function notionLessonPage(
  options: LessonPageOptions = {},
): PageObjectResponse {
  const id = options.id ?? "lesson-page-01";
  const date = options.date === undefined
    ? {
      end: "2026-08-03T10:45:00+05:00",
      start: "2026-08-03T10:00:00+05:00",
      time_zone: null,
    }
    : options.date;

  return {
    archived: options.archived ?? false,
    cover: null,
    created_by: { id: "notion-user-id", object: "user" },
    created_time: "2026-07-27T00:00:00.000Z",
    icon: null,
    id,
    in_trash: options.inTrash ?? false,
    is_archived: options.archived ?? false,
    is_locked: false,
    last_edited_by: { id: "notion-user-id", object: "user" },
    last_edited_time: "2026-07-27T00:00:00.000Z",
    object: "page",
    parent: {
      data_source_id: "server-only-data-source-id",
      database_id: "server-only-database-id",
      type: "data_source_id",
    },
    properties: {
      "Автономность": selectProperty(
        "property-autonomy-id",
        options.autonomy ?? null,
      ),
      "Артефакт": {
        id: "property-artifact-id",
        type: "url",
        url: options.artifactUrl ?? null,
      },
      "Количество переносов": {
        id: "property-move-count-id",
        number: options.moveCount ?? 0,
        type: "number",
      },
      "Краткий комментарий": {
        id: "property-comment-id",
        rich_text: richText(options.comment ?? ""),
        type: "rich_text",
      },
      "Модуль": {
        id: "property-module-id",
        rich_text: richText(options.module ?? "модуль W01"),
        type: "rich_text",
      },
      "Начало и окончание": {
        date,
        id: "property-schedule-id",
        type: "date",
      },
      "Неделя": selectProperty(
        "property-week-id",
        options.week === undefined ? ACTIVE_WEEK.notionValue : options.week,
      ),
      "Понимание": {
        id: "property-understanding-id",
        number: options.understanding ?? null,
        type: "number",
      },
      "Порядок": {
        id: "property-order-id",
        number: options.order ?? 100,
        type: "number",
      },
      "Предмет": selectProperty(
        "property-subject-id",
        options.subject === undefined
          ? "Software Engineering"
          : options.subject,
      ),
      "Приоритет": selectProperty(
        "property-priority-id",
        options.priority === undefined ? "Must" : options.priority,
      ),
      "Причина пропуска": selectProperty(
        "property-missed-reason-id",
        options.missedReason ?? null,
      ),
      "Продолжительность, мин": {
        id: "property-duration-id",
        number: options.durationMinutes === undefined
          ? 45
          : options.durationMinutes,
        type: "number",
      },
      "Результат": selectProperty(
        "property-result-id",
        options.result ?? null,
      ),
      "Статус": selectProperty(
        "property-status-id",
        options.status === undefined ? "Запланирован" : options.status,
      ),
      "Требует решения": selectProperty(
        "property-decision-id",
        options.decisionRequest ?? null,
      ),
      "Урок": {
        id: "property-title-id",
        title: richText(options.title ?? `урок ${id}`),
        type: "title",
      },
    },
    public_url: null,
    url: `https://www.notion.so/${id}`,
  };
}

export const notionLessonPages = Object.freeze(
  subjects.map((subject, index) =>
    notionLessonPage({
      date: {
        end: null,
        start: `2026-08-0${3 + (index % 7)}`,
        time_zone: null,
      },
      id: `lesson-${String(index + 1).padStart(2, "0")}`,
      order: 100 + (index % 3) * 100,
      subject,
      title: `урок ${index + 1}`,
    })
  ),
);

export function notionQueryResponse(
  results: QueryDataSourceResponse["results"],
  options: Readonly<{
    hasMore?: boolean;
    nextCursor?: string | null;
  }> = {},
): QueryDataSourceResponse {
  return {
    has_more: options.hasMore ?? false,
    next_cursor: options.nextCursor ?? null,
    object: "list",
    page_or_data_source: {},
    request_status: { type: "complete" },
    results,
    type: "page_or_data_source",
  };
}
