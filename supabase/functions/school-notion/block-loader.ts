import { mapBlock } from "./block-mapper.ts";
import { SchoolHttpError } from "./errors.ts";
import type { LessonContentBlock, SchoolNotionReadClient } from "./types.ts";

type UnknownRecord = Record<string, unknown>;

export interface BlockLoadLimits {
  maxBlocks?: number;
  maxDepth?: number;
}

const hardMaxBlocks = 1000;
const hardMaxDepth = 10;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function contentTooLarge(): never {
  throw new SchoolHttpError(
    413,
    "LESSON_CONTENT_TOO_LARGE",
    "lesson content exceeds safe limits",
  );
}

function invalidBlockResponse(): never {
  throw new SchoolHttpError(
    502,
    "NOTION_BLOCK_RESPONSE_INVALID",
    "notion block response is invalid",
  );
}

function paginationError(): never {
  throw new SchoolHttpError(
    502,
    "NOTION_PAGINATION_ERROR",
    "notion pagination response is invalid",
  );
}

function boundedLimit(
  value: number | undefined,
  hardMaximum: number,
): number {
  return Number.isSafeInteger(value) && Number(value) > 0
    ? Math.min(Number(value), hardMaximum)
    : hardMaximum;
}

function validateBlock(value: unknown): UnknownRecord {
  if (
    !isRecord(value) ||
    value.object !== "block" ||
    typeof value.id !== "string" ||
    value.id.length === 0 ||
    typeof value.type !== "string" ||
    !/^[a-z][a-z0-9_]{0,63}$/.test(value.type) ||
    typeof value.has_children !== "boolean" ||
    typeof value.in_trash !== "boolean" ||
    !isRecord(value[value.type])
  ) {
    return invalidBlockResponse();
  }

  return value;
}

export async function loadBlockChildren(
  rootId: string,
  client: SchoolNotionReadClient,
  limits: BlockLoadLimits = {},
): Promise<LessonContentBlock[]> {
  const maxBlocks = boundedLimit(limits.maxBlocks, hardMaxBlocks);
  const maxDepth = boundedLimit(limits.maxDepth, hardMaxDepth);
  const visitedBlockIds = new Set<string>();
  let normalizedBlockCount = 0;

  async function loadParent(
    parentId: string,
    childDepth: number,
  ): Promise<LessonContentBlock[]> {
    if (childDepth > maxDepth) {
      return contentTooLarge();
    }

    const rawChildren: UnknownRecord[] = [];
    const seenCursors = new Set<string>();
    let startCursor: string | undefined;

    while (true) {
      const response = await client.listBlockChildren(parentId, startCursor);
      if (
        !isRecord(response) ||
        response.object !== "list" ||
        typeof response.has_more !== "boolean" ||
        !Array.isArray(response.results)
      ) {
        return invalidBlockResponse();
      }

      for (const rawBlock of response.results) {
        const validated = validateBlock(rawBlock);
        if (validated.in_trash) {
          continue;
        }

        const blockId = validated.id as string;
        if (visitedBlockIds.has(blockId)) {
          continue;
        }

        visitedBlockIds.add(blockId);
        normalizedBlockCount += 1;
        if (normalizedBlockCount > maxBlocks) {
          return contentTooLarge();
        }
        rawChildren.push(validated);
      }

      if (!response.has_more) {
        break;
      }

      const nextCursor = response.next_cursor;
      if (
        typeof nextCursor !== "string" ||
        nextCursor.length === 0 ||
        seenCursors.has(nextCursor)
      ) {
        return paginationError();
      }

      seenCursors.add(nextCursor);
      startCursor = nextCursor;
    }

    const normalized: LessonContentBlock[] = [];

    for (const rawBlock of rawChildren) {
      const blockId = rawBlock.id as string;
      const children = rawBlock.has_children
        ? await loadParent(blockId, childDepth + 1)
        : [];
      normalized.push(mapBlock(rawBlock, children));
    }

    return normalized;
  }

  if (typeof rootId !== "string" || rootId.length === 0) {
    return invalidBlockResponse();
  }

  return await loadParent(rootId, 1);
}
