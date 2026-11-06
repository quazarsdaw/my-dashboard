import {
  type DataRecord,
  type MutationEffect,
  WriteError,
} from "./contracts.ts";

const labels: Record<string, string> = {
  create_task: "создать задачу",
  update_task: "изменить задачу",
  move_task: "перенести задачу",
  create_goal: "создать цель",
  update_goal: "изменить цель",
  move_goal: "перенести цель",
  set_goal_progress: "изменить прогресс цели",
  complete_goal: "отметить цель выполненной",
  reopen_goal: "вернуть цель в работу",
  route_inbox_to_task: "перенести из входящих в задачи",
  route_inbox_to_goal: "перенести из входящих в цели",
};
const fields: Record<string, string> = {
  text: "текст",
  title: "название",
  date: "дата",
  horizon: "горизонт",
  periodKey: "период",
  priority: "приоритет",
  order: "порядок",
  type: "тип",
  target: "цель",
  current: "прогресс",
  unit: "единица",
  done: "выполнено",
  estimatedMin: "минут",
  sphere: "сектор",
  description: "описание",
  difficulty: "сложность",
  subtasks: "подзадачи",
  source: "источник",
};
function safe(value: unknown): string {
  return (JSON.stringify(value) ?? "—").replace(
    /[\p{Cc}\p{Cf}\u2028\u2029]/gu,
    (character) => {
      const point = character.codePointAt(0)!;
      const hex = point.toString(16);
      return point > 0xffff ? "\\u{" + hex + "}" : "\\u" + hex.padStart(4, "0");
    },
  );
}
function lines(value: DataRecord, keys: string[]) {
  return keys.map((key) => (fields[key] ?? key) + ": " + safe(value[key]));
}
export function boundedPreview(text: string): string {
  if (text.length > 2500) throw new WriteError("preview_too_large", 422);
  return text;
}
export function renderPreview(effect: MutationEffect): string {
  const title = effect.after.text ?? effect.after.title;
  const route = effect.operation.startsWith("route_inbox_");
  const preview = [
    "подтвердить: " + labels[effect.operation],
    "запись: " + safe(title),
  ];
  if (effect.sourceRef !== null) {
    preview.push("идентификатор исходной записи: " + safe(effect.sourceRef));
  }
  if (effect.before && !route) {
    const scope = ["date", "horizon", "periodKey"].filter((key) =>
      Object.hasOwn(effect.after, key) && !effect.changedFields.includes(key)
    );
    preview.push(...lines(effect.after, scope));
  }
  if (effect.before) {
    const keys = route ? Object.keys(effect.before) : effect.changedFields;
    preview.push("было:", ...lines(effect.before, keys));
  }
  const keys = !effect.before || route
    ? Object.keys(effect.after)
    : effect.changedFields;
  preview.push("будет:", ...lines(effect.after, keys));
  if (route) {
    preview.push(
      "исходная запись уйдёт из входящих только при успешном переносе.",
    );
  }
  if (effect.warnings.includes("duplicate_creation")) {
    preview.push(
      "внимание: похожая запись уже есть. подтверждение создаст ещё одну.",
    );
  }
  return boundedPreview(preview.join("\n"));
}
