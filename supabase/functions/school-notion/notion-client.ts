import { Client } from "@notionhq/client";
import { SchoolHttpError } from "./errors.ts";
import type {
  NotionUpdateProperties,
  SchoolEnvironment,
  SchoolNotionMutationClient,
  SchoolNotionReadClient,
} from "./types.ts";

const notionVersion = "2026-03-11";

function createClient(
  env: SchoolEnvironment,
): Client {
  if (!env.NOTION_TOKEN || !env.NOTION_DATA_SOURCE_ID) {
    throw new SchoolHttpError(
      500,
      "SERVER_MISCONFIGURED",
      "server configuration is invalid",
    );
  }

  return new Client({
    auth: env.NOTION_TOKEN,
    notionVersion,
  });
}

function createReadBoundary(
  client: Client,
  dataSourceId: string,
): SchoolNotionReadClient {
  const readClient: SchoolNotionReadClient = {
    queryDataSource: (input) =>
      client.dataSources.query({
        ...input,
        data_source_id: dataSourceId,
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

export function createSchoolNotionReadClient(
  env: SchoolEnvironment,
): SchoolNotionReadClient {
  return createReadBoundary(createClient(env), env.NOTION_DATA_SOURCE_ID);
}

export function createSchoolNotionMutationClient(
  env: SchoolEnvironment,
): SchoolNotionMutationClient {
  const client = createClient(env);
  const readClient = createReadBoundary(client, env.NOTION_DATA_SOURCE_ID);

  return Object.freeze({
    ...readClient,
    updatePage: (pageId: string, properties: NotionUpdateProperties) =>
      client.pages.update({
        page_id: pageId,
        properties,
      }),
  });
}
