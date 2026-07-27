import type {
  LessonContentBlock,
  LessonContentColor,
  LessonContentSpan,
} from "./types.ts";

type UnknownRecord = Record<string, unknown>;

const safeColors = new Set<LessonContentColor>([
  "default",
  "gray",
  "brown",
  "orange",
  "yellow",
  "green",
  "blue",
  "purple",
  "pink",
  "red",
  "gray_background",
  "brown_background",
  "orange_background",
  "yellow_background",
  "green_background",
  "blue_background",
  "purple_background",
  "pink_background",
  "red_background",
]);

const richTextBlockTypes = new Set([
  "paragraph",
  "heading_1",
  "heading_2",
  "heading_3",
  "heading_4",
  "bulleted_list_item",
  "numbered_list_item",
  "toggle",
  "quote",
  "callout",
]);

const containerBlockTypes = new Set([
  "column_list",
  "column",
  "synced_block",
]);

const referenceLabels = Object.freeze(
  {
    audio: "аудио",
    bookmark: "закладка",
    embed: "внешний материал",
    file: "файл",
    image: "изображение",
    link_preview: "предпросмотр ссылки",
    pdf: "pdf",
    video: "видео",
  } as const,
);

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function booleanValue(value: unknown): boolean {
  return typeof value === "boolean" ? value : false;
}

function safeColor(value: unknown): LessonContentColor {
  return typeof value === "string" &&
      safeColors.has(value as LessonContentColor)
    ? value as LessonContentColor
    : "default";
}

function mapRichText(value: unknown): LessonContentSpan[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const spans: LessonContentSpan[] = [];

  for (const rawSpan of value) {
    if (!isRecord(rawSpan) || typeof rawSpan.plain_text !== "string") {
      continue;
    }

    const annotations = isRecord(rawSpan.annotations)
      ? rawSpan.annotations
      : {};

    spans.push({
      annotations: {
        bold: booleanValue(annotations.bold),
        code: booleanValue(annotations.code),
        color: safeColor(annotations.color),
        italic: booleanValue(annotations.italic),
        strikethrough: booleanValue(annotations.strikethrough),
        underline: booleanValue(annotations.underline),
      },
      link: safeExternalUrl(rawSpan.href),
      text: rawSpan.plain_text,
    });
  }

  return spans;
}

function safeSourceType(value: unknown): string {
  return typeof value === "string" &&
      /^[a-z][a-z0-9_]{0,63}$/.test(value)
    ? value
    : "unsupported";
}

function unsupportedBlock(block: UnknownRecord): LessonContentBlock {
  const apiUnsupported = block.type === "unsupported" &&
      isRecord(block.unsupported)
    ? block.unsupported.block_type
    : block.type;
  const sourceType = safeSourceType(apiUnsupported);

  return {
    label: `unsupported notion block (${sourceType})`,
    sourceType,
    type: "unsupported",
  };
}

function blockPayload(
  block: UnknownRecord,
  type: string,
): UnknownRecord | undefined {
  const value = block[type];
  return isRecord(value) ? value : undefined;
}

function extractReferenceUrl(payload: UnknownRecord): string | null {
  if ("url" in payload) {
    return safeExternalUrl(payload.url);
  }

  const fileType = payload.type;
  if (
    (fileType === "file" || fileType === "external") &&
    isRecord(payload[fileType])
  ) {
    return safeExternalUrl(payload[fileType].url);
  }

  return null;
}

function captionLabel(
  caption: LessonContentSpan[],
  type: keyof typeof referenceLabels,
): string {
  const text = caption.map((span) => span.text).join("").trim();
  return text || referenceLabels[type];
}

export function safeExternalUrl(value: unknown): string | null {
  if (
    typeof value !== "string" || value.length === 0 || value.trim() !== value
  ) {
    return null;
  }

  try {
    const parsed = new URL(value);
    if (
      parsed.protocol !== "https:" ||
      parsed.hostname.length === 0 ||
      parsed.username.length > 0 ||
      parsed.password.length > 0
    ) {
      return null;
    }
    return value;
  } catch {
    return null;
  }
}

export function mapBlock(
  block: unknown,
  children: LessonContentBlock[],
): LessonContentBlock {
  if (!isRecord(block) || typeof block.type !== "string") {
    return {
      label: "unsupported notion block (unsupported)",
      sourceType: "unsupported",
      type: "unsupported",
    };
  }

  const type = block.type;
  const payload = blockPayload(block, type);

  if (richTextBlockTypes.has(type) && payload) {
    return {
      children,
      spans: mapRichText(payload.rich_text),
      type,
    } as LessonContentBlock;
  }

  if (type === "to_do" && payload) {
    return {
      checked: booleanValue(payload.checked),
      children,
      spans: mapRichText(payload.rich_text),
      type,
    };
  }

  if (type === "code" && payload) {
    return {
      caption: mapRichText(payload.caption),
      children,
      language: typeof payload.language === "string"
        ? payload.language
        : "plain text",
      spans: mapRichText(payload.rich_text),
      type,
    };
  }

  if (type === "divider" && payload) {
    return { children, type };
  }

  if (type === "equation" && payload) {
    return {
      children,
      expression: typeof payload.expression === "string"
        ? payload.expression
        : "",
      type,
    };
  }

  if (type === "table" && payload) {
    return {
      children,
      hasColumnHeader: booleanValue(payload.has_column_header),
      hasRowHeader: booleanValue(payload.has_row_header),
      tableWidth: Number.isSafeInteger(payload.table_width) &&
          Number(payload.table_width) > 0
        ? Number(payload.table_width)
        : 0,
      type,
    };
  }

  if (type === "table_row" && payload) {
    const cells = Array.isArray(payload.cells)
      ? payload.cells.map((cell) => mapRichText(cell))
      : [];
    return { cells, children, type };
  }

  if (containerBlockTypes.has(type) && payload) {
    return { children, type } as LessonContentBlock;
  }

  if (Object.hasOwn(referenceLabels, type) && payload) {
    const referenceType = type as keyof typeof referenceLabels;
    const caption = mapRichText(payload.caption);
    return {
      caption,
      children,
      label: captionLabel(caption, referenceType),
      type: referenceType,
      url: extractReferenceUrl(payload),
    };
  }

  return unsupportedBlock(block);
}
