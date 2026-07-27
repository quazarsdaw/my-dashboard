import type {
  PageObjectResponse,
  QueryDataSourceResponse,
} from "@notionhq/client";
import { SchoolHttpError } from "./errors.ts";
import { mapNotionPageToLesson, READ_PROPERTY_NAMES } from "./notion-mapper.ts";
import type {
  Lesson,
  LessonFilter,
  LessonRepository,
  NotionPage,
  QueryLessonsInput,
  SchoolNotionReadClient,
} from "./types.ts";

function isFullPage(
  result: QueryDataSourceResponse["results"][number],
): result is PageObjectResponse {
  return result.object === "page" && "url" in result;
}

function buildFilter(filter: LessonFilter): QueryLessonsInput["filter"] {
  if (filter.week !== undefined) {
    return {
      property: "Неделя",
      select: { equals: filter.week },
    };
  }

  return {
    and: [
      {
        date: { on_or_after: filter.from },
        property: "Начало и окончание",
      },
      {
        date: { on_or_before: filter.to },
        property: "Начало и окончание",
      },
    ],
  };
}

export function createLessonRepository(
  client: SchoolNotionReadClient,
  notionDataSourceId?: string,
): LessonRepository {
  return Object.freeze({
    async assertSchoolLesson(pageId: string): Promise<NotionPage> {
      if (!notionDataSourceId) {
        throw new SchoolHttpError(
          500,
          "SERVER_MISCONFIGURED",
          "server configuration is invalid",
        );
      }

      const page = await client.retrievePage(pageId);
      if (
        page.object !== "page" ||
        !("url" in page) ||
        !("properties" in page)
      ) {
        throw new SchoolHttpError(
          502,
          "NOTION_SCHEMA_ERROR",
          "notion lesson schema is invalid",
        );
      }

      if (
        page.parent.type !== "data_source_id" ||
        page.parent.data_source_id !== notionDataSourceId ||
        page.in_trash ||
        page.archived ||
        page.is_archived
      ) {
        throw new SchoolHttpError(
          404,
          "LESSON_OUTSIDE_SCHOOL_DATABASE",
          "lesson is outside the school database",
        );
      }

      return page;
    },

    async listLessons(filter: LessonFilter): Promise<Lesson[]> {
      const lessons: Lesson[] = [];
      const notionFilter = buildFilter(filter);
      let startCursor: string | undefined;

      while (true) {
        const response = await client.queryDataSource({
          filter: notionFilter,
          filter_properties: [...READ_PROPERTY_NAMES],
          page_size: 100,
          result_type: "page",
          ...(startCursor === undefined ? {} : { start_cursor: startCursor }),
        });

        for (const result of response.results) {
          if (
            isFullPage(result) &&
            result.parent.type === "data_source_id" &&
            !result.in_trash &&
            !result.archived &&
            !result.is_archived
          ) {
            lessons.push(mapNotionPageToLesson(result));
          }
        }

        if (!response.has_more) {
          return lessons;
        }

        if (response.next_cursor === null) {
          throw new SchoolHttpError(
            502,
            "NOTION_PAGINATION_ERROR",
            "notion pagination response is invalid",
          );
        }

        startCursor = response.next_cursor;
      }
    },
  });
}
