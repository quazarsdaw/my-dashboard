import type {
  PageObjectResponse,
  QueryDataSourceResponse,
} from "@notionhq/client";
import { SchoolHttpError } from "./errors.ts";
import {
  lessonHasCanonicalDuration,
  mapNotionPageToLesson,
  READ_PROPERTY_NAMES,
} from "./notion-mapper.ts";
import { buildWhitelistedProperties } from "./notion-properties.ts";
import { assertLessonBelongsToSchool } from "./validation.ts";
import type {
  ActiveLessonRepository,
  Lesson,
  LessonFilter,
  LessonRepository,
  NotionPage,
  QueryLessonsInput,
  ScheduleLessonRepository,
  SchoolCommand,
  SchoolNotionMutationClient,
  SchoolNotionReadClient,
} from "./types.ts";
import { ACTIVE_LESSON_WEEK } from "./types.ts";

function isFullPage(
  result: QueryDataSourceResponse["results"][number],
): result is PageObjectResponse {
  return result.object === "page" && "url" in result;
}

function fullSchoolPage(
  page: NotionPage,
  notionDataSourceId: string,
): PageObjectResponse {
  assertLessonBelongsToSchool(page, notionDataSourceId);
  if (!("url" in page) || !("properties" in page)) {
    throw new SchoolHttpError(
      502,
      "NOTION_SCHEMA_ERROR",
      "notion lesson schema is invalid",
    );
  }
  return page;
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
      return fullSchoolPage(page, notionDataSourceId);
    },

    async listLessons(
      filter: LessonFilter,
      renewBeforeNextPage?: () => Promise<void>,
    ): Promise<Lesson[]> {
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
            result.parent.data_source_id === notionDataSourceId &&
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

        await renewBeforeNextPage?.();
        startCursor = response.next_cursor;
      }
    },
  });
}

export function createScheduleLessonRepository(
  client: SchoolNotionMutationClient,
  notionDataSourceId?: string,
): ScheduleLessonRepository {
  const activeRepository = createActiveLessonRepository(
    client,
    notionDataSourceId,
  );
  const lessonRepository = createLessonRepository(
    client,
    notionDataSourceId,
  );

  return Object.freeze({
    ...activeRepository,
    listWeekLessons: (renewBeforeNextPage?: () => Promise<void>) =>
      lessonRepository.listLessons(
        { week: ACTIVE_LESSON_WEEK },
        renewBeforeNextPage,
      ),
  });
}

export function createActiveLessonRepository(
  client: SchoolNotionMutationClient,
  notionDataSourceId?: string,
): ActiveLessonRepository {
  if (!notionDataSourceId) {
    throw new SchoolHttpError(
      500,
      "SERVER_MISCONFIGURED",
      "server configuration is invalid",
    );
  }

  return Object.freeze({
    async getLesson(pageId: string): Promise<Lesson> {
      const page = await client.retrievePage(pageId);
      return mapNotionPageToLesson(
        fullSchoolPage(page, notionDataSourceId),
      );
    },

    async listActiveLessons(
      renewBeforeNextPage?: () => Promise<void>,
    ): Promise<Lesson[]> {
      const lessons: Lesson[] = [];
      let startCursor: string | undefined;

      while (true) {
        const response = await client.queryDataSource({
          filter: {
            property: "Статус",
            select: { equals: "В процессе" },
          },
          filter_properties: [...READ_PROPERTY_NAMES],
          page_size: 100,
          result_type: "page",
          ...(startCursor === undefined ? {} : { start_cursor: startCursor }),
        });

        for (const result of response.results) {
          if (
            isFullPage(result) &&
            result.parent.type === "data_source_id" &&
            result.parent.data_source_id === notionDataSourceId &&
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
        await renewBeforeNextPage?.();
        startCursor = response.next_cursor;
      }
    },

    async updateLesson(
      command: SchoolCommand,
      currentLesson: Lesson,
    ): Promise<Lesson> {
      let properties = buildWhitelistedProperties(
        command,
        currentLesson,
      );
      if (
        !lessonHasCanonicalDuration(currentLesson) &&
        !("Продолжительность, мин" in properties)
      ) {
        properties = {
          ...properties,
          "Продолжительность, мин": {
            number: currentLesson.durationMinutes,
          },
        };
      }
      const response = await client.updatePage(
        currentLesson.id,
        properties,
      );
      return mapNotionPageToLesson(
        fullSchoolPage(response, notionDataSourceId),
      );
    },
  });
}
