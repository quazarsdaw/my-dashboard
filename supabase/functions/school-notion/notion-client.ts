import { Client } from "@notionhq/client";
import { SchoolHttpError } from "./errors.ts";
import type { SchoolEnvironment, SchoolNotionReadClient } from "./types.ts";

const notionVersion = "2026-03-11";

export function createSchoolNotionReadClient(
  env: SchoolEnvironment,
): SchoolNotionReadClient {
  if (!env.NOTION_TOKEN || !env.NOTION_DATA_SOURCE_ID) {
    throw new SchoolHttpError(
      500,
      "SERVER_MISCONFIGURED",
      "server configuration is invalid",
    );
  }

  const client = new Client({
    auth: env.NOTION_TOKEN,
    notionVersion,
  });

  const readClient: SchoolNotionReadClient = {
    queryDataSource: (input) =>
      client.dataSources.query({
        ...input,
        data_source_id: env.NOTION_DATA_SOURCE_ID,
      }),
    retrievePage: (pageId) =>
      client.pages.retrieve({
        page_id: pageId,
      }),
    listBlockChildren: (blockId, startCursor) =>
      client.blocks.children.list({
        block_id: blockId,
        page_size: 100,
        ...(startCursor ? { start_cursor: startCursor } : {}),
      }),
  };

  return Object.freeze(readClient);
}
