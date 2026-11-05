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
    /[\p{Cc}\u061c\u200e\u200f\u2028-\u202e\u2066-\u2069]/gu,
    (character) =>
      "\\u" + character.charCodeAt(0).toString(16).padStart(4, "0"),
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
    "Подтвердить: " + labels[effect.operation],
    "Запись: " + safe(title),
  ];
  if (effect.before) {
    const keys = route ? Object.keys(effect.before) : effect.changedFields;
    preview.push("Было:", ...lines(effect.before, keys));
  }
  const keys = !effect.before || route
    ? Object.keys(effect.after)
    : effect.changedFields;
  preview.push("Будет:", ...lines(effect.after, keys));
  if (route) {
    preview.push(
      "Исходная запись уйдёт из входящих только при успешном переносе.",
    );
  }
  if (effect.warnings.includes("duplicate_creation")) {
    preview.push(
      "Внимание: похожая запись уже есть. Подтверждение создаст ещё одну.",
    );
  }
  return boundedPreview(preview.join("\n"));
}
