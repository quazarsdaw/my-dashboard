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
): LessonRepository {
  return Object.freeze({
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
