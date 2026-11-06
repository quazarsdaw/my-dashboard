import {
  type DataRecord,
  type GoalFields,
  type GoalPeriod,
  invalid,
  priorities,
  type Priority,
  validPeriod,
} from "./contracts.ts";
import { asInteger, asText, selectFields } from "./tasks.ts";

export function makeGoal(
  input: Pick<GoalFields, "title"> & Partial<GoalFields> & GoalPeriod & {
    type: "check" | "number";
    current?: number;
  },
  id: string,
  createdAt: string,
): DataRecord {
  const target = input.target ?? 1, current = input.current ?? 0;
  return {
    id,
    title: asText(input.title, 200, true),
    horizon: input.horizon,
    periodKey: input.periodKey,
    priority: input.priority ?? "p3",
    type: input.type,
    target,
    unit: input.unit ?? "",
    current,
    done: input.type === "number" && current >= target,
    createdAt,
  };
}
export function goalProjection(value: DataRecord): DataRecord {
  return selectFields(value, [
    "title",
    "horizon",
    "periodKey",
    "priority",
    "order",
    "type",
    "target",
    "unit",
    "current",
    "done",
  ]);
}
export function checkGoal(value: DataRecord): void {
  asText(value.title, 200, true);
  asText(value.unit, 100);
  if (
    !validPeriod(value.horizon, value.periodKey) ||
    !priorities.includes(value.priority as Priority) ||
    typeof value.done !== "boolean" ||
    (value.type !== "number" && value.type !== "check")
  ) invalid();
  asInteger(value.current);
  asInteger(value.target);
  if (
    value.type === "check" &&
    (value.target !== 1 || value.current !== (value.done ? 1 : 0))
  ) invalid();
}
export function endOrder(
  goals: DataRecord[],
  target: DataRecord,
  excluded?: number,
): number {
  let maximum = 0;
  for (const [index, goal] of goals.entries()) {
    if (
      index !== excluded && goal.horizon === target.horizon &&
      goal.periodKey === target.periodKey && goal.priority === target.priority
    ) {
      maximum = Math.max(maximum, asInteger(goal.order, 0));
    }
  }
  return asInteger(maximum + 100);
}
