import assert from "node:assert/strict";
import {
  fingerprintMutation,
  parseMutation,
  resolveMutation,
} from "../../_shared/dashboard-write/commands.ts";
import {
  applyMutation,
  editOptions,
} from "../../_shared/dashboard-write/documents.ts";
import {
  boundedPreview,
  renderPreview,
} from "../../_shared/dashboard-write/preview.ts";

const id = "11111111-1111-4111-8111-111111111111";
const date = "2026-10-27";
const key = "goals:" + date;
const goals = "horizons_goals_v2";
const inbox = "inbox_v1";
const now = new Date("2026-10-27T01:00:00Z");
const clock = { now, newUuid: () => id };
const task = {
  id: "task-a",
  text: "старая",
  done: false,
  estimatedMin: 25,
  difficulty: "hard",
  sphere: "",
  subtasks: [{ text: "шаг", done: true }],
  unknown: { keep: true },
};
const goal = {
  id: "goal-a",
  title: "цель",
  horizon: "month",
  periodKey: "2026-10",
  priority: "p2",
  order: 100,
  type: "number",
  current: -20,
  target: -10,
  unit: "шт",
  done: false,
  legacy: true,
};
function snap(key: string, value: unknown, revision = "1") {
  return {
    key,
    exists: true,
    valueText: JSON.stringify(value),
    revision,
    updatedAt: now.toISOString(),
  };
}
function missing(key: string) {
  return {
    key,
    exists: false,
    valueText: null,
    revision: "0",
    updatedAt: null,
  };
}
const taskTarget = { id: "task-a", date, expectedRevision: "1" };

Deno.test("перестановка полей draft в jsonb не меняет ожидаемый хеш документа", async () => {
  const rows = [snap(key, [{ id: "task-a", text: "задача", done: false }])];
  const first = await effect("update_task", {
    target: taskTarget,
    patch: { description: "описание", estimatedMin: 25 },
  }, rows);
  const loaded = await effect("update_task", {
    target: taskTarget,
    patch: { estimatedMin: 25, description: "описание" },
  }, rows);
  assert.deepEqual(first.afterHashes, loaded.afterHashes);
});
const goalTarget = { id: "goal-a", expectedRevision: "1" };
const inboxTarget = { id: "in_1", expectedRevision: "1" };
const source = snap(inbox, [{
  ...inboxTarget,
  text: "разобрать письма",
  date: now.toISOString(),
}, { id: "in_2", text: "оставить", date: now.toISOString() }]);
const storeGoals = (value = goal) =>
  snap(goals, { schemaVersion: 3, goals: [value], other: "сохранить" });
function effect(
  operation: string,
  args: unknown,
  rows:
    | ReturnType<typeof snap>[]
    | (ReturnType<typeof snap> | ReturnType<typeof missing>)[],
) {
  return applyMutation(
    resolveMutation(parseMutation(operation, args), clock),
    rows,
  );
}

Deno.test("команды закрыты, лимиты считают unicode code points, а не utf-16", () => {
  for (
    const [op, args] of [
      ["complete_task", { target: taskTarget }],
      ["update_task", { target: taskTarget, patch: { done: true } }],
      ["create_task", { text: "а", owner: id }],
      ["create_task", { text: "а", date: "2026-02-30" }],
      ["create_task", { text: "а", estimatedMin: 0 }],
      ["create_task", { text: "😀".repeat(501) }],
      ["update_task", { target: taskTarget, patch: {} }],
      ["route_inbox_to_goal", {
        target: inboxTarget,
        horizon: "week",
        periodKey: "2026-10-27",
      }],
      ["route_inbox_to_task", { target: { id: "in_1" }, date }],
      ["move_goal", {
        target: goalTarget,
        toHorizon: "year",
        toPeriodKey: "2026",
        confirmed: true,
      }],
    ]
  ) {
    assert.throws(() => parseMutation(op as string, args), {
      message: "invalid_change",
    });
  }
  assert.doesNotThrow(() =>
    parseMutation("create_task", { text: "😀".repeat(500) })
  );
});

Deno.test("дата по умолчанию фиксируется на 06:00, fingerprint до defaults", async () => {
  const command = parseMutation("create_task", { text: "задача" });
  assert.equal(resolveMutation(command, clock).context.effectiveDate, date);
  assert.equal(
    resolveMutation(command, { ...clock, now: new Date(now.getTime() - 1) })
      .context.effectiveDate,
    "2026-10-26",
  );
  assert.equal(
    await fingerprintMutation(command),
    await fingerprintMutation(parseMutation("create_task", { text: "задача" })),
  );
  assert.notEqual(
    await fingerprintMutation(command),
    await fingerprintMutation(
      parseMutation("create_task", { date, text: "задача" }),
    ),
  );
});

Deno.test("задача получает uuid, текущий день и defaults без наград", async () => {
  const result = await effect("create_task", { text: "  новая  " }, [
    missing(key),
  ]);
  assert.deepEqual(JSON.parse(result.changes[0].valueText!), [{
    id,
    text: "новая",
    done: false,
    estimatedMin: 15,
    sphere: "",
    difficulty: "medium",
    createdAt: now.toISOString(),
    subtasks: [],
  }]);
  assert.equal(result.changes[0].expectedRevision, "0");
  assert.match(result.afterHashes[key], /^[a-f0-9]{64}$/);
  assert.match(renderPreview(result), /новая/);
});

Deno.test("редактирование меняет только выбранную задачу и сохраняет отметку подзадачи", async () => {
  const row = snap(key, [task, { text: "сосед", done: false, custom: 42 }]);
  const original = row.valueText;
  const result = await effect("update_task", {
    target: taskTarget,
    patch: { text: "новая" },
    subtaskEdits: [{ index: 0, text: "шаг новый" }],
    appendSubtasks: [{ text: "добавить" }],
  }, [row]);
  assert.deepEqual(JSON.parse(result.changes[0].valueText!), [
    {
      ...task,
      text: "новая",
      subtasks: [{ text: "шаг новый", done: true }, {
        text: "добавить",
        done: false,
      }],
    },
    { text: "сосед", done: false, custom: 42 },
  ]);
  assert.equal(row.valueText, original);
  assert.match(renderPreview(result), /шаг новый/);
});

Deno.test("завершённая, дублирующаяся, отсутствующая и устаревшая задачи не редактируются", async () => {
  const args = { target: taskTarget, patch: { text: "новая" } };
  for (
    const row of [
      snap(key, [{ ...task, done: true }]),
      snap(key, [task, task]),
      snap(key, []),
    ]
  ) {
    await assert.rejects(effect("update_task", args, [row]), {
      message: "invalid_change",
    });
  }
  await assert.rejects(effect("update_task", args, [snap(key, [task], "2")]), {
    message: "conflict",
  });
});

Deno.test("перенос сохраняет содержимое, версию назначения и устойчивый id", async () => {
  const targetKey = "goals:2026-10-29";
  const result = await effect("move_task", {
    target: taskTarget,
    toDate: "2026-10-29",
  }, [
    snap(key, [task]),
    snap(targetKey, [{ text: "сосед", done: false }], "4"),
  ]);
  assert.equal(result.changes.length, 2);
  assert.equal(result.changes.find((c) => c.key === key)?.valueText, "[]");
  const destination = result.changes.find((c) => c.key === targetKey)!;
  assert.equal(destination.expectedRevision, "4");
  assert.deepEqual(JSON.parse(destination.valueText!)[1], task);
  assert.match(renderPreview(result), /2026-10-29/);
});

Deno.test("legacy ссылка привязана к версии и выдаёт uuid только выбранной записи", async () => {
  const args = {
    target: { date, reference: date + ":1", expectedRevision: "1" },
    patch: { text: "изменено" },
  };
  const rows = [{ text: "без id", done: false }, {
    text: "выбрана",
    done: false,
  }];
  await assert.rejects(effect("update_task", args, [snap(key, rows, "2")]), {
    message: "conflict",
  });
  const result = await effect("update_task", args, [snap(key, rows)]);
  assert.deepEqual(JSON.parse(result.changes[0].valueText!), [rows[0], {
    ...rows[1],
    id,
    text: "изменено",
  }]);
});

Deno.test("опасные числа в неизвестных полях не пересохраняются с округлением", async () => {
  for (const number of ["9007199254740993", "0.1234567890123456789", "1e400"]) {
    const row = {
      ...snap(key, []),
      valueText: '[{"id":"task-a","text":"текст","done":false,"extra":' +
        number + "}]",
    };
    await assert.rejects(
      effect("update_task", { target: taskTarget, patch: { text: "новый" } }, [
        row,
      ]),
      { message: "invalid_change" },
    );
    assert.ok(row.valueText.includes(number));
  }
});

Deno.test("числовые цели сохраняют знак, ноль и явно возвращаются к прогрессу ниже цели", async () => {
  const complete = await effect("complete_goal", { target: goalTarget }, [
    storeGoals(),
  ]);
  const out = JSON.parse(complete.changes[0].valueText!);
  assert.equal(out.other, "сохранить");
  assert.deepEqual(out.goals[0], { ...goal, current: -10, done: true });
  await assert.rejects(
    effect("reopen_goal", { target: goalTarget }, [storeGoals(out.goals[0])]),
    { message: "invalid_change" },
  );
  const reopened = await effect("reopen_goal", {
    target: goalTarget,
    current: -11,
  }, [storeGoals(out.goals[0])]);
  assert.equal(reopened.after.current, -11);
  assert.equal(reopened.after.done, false);
  const zero = await effect("update_goal", {
    target: goalTarget,
    patch: { target: 0 },
  }, [storeGoals()]);
  assert.equal(zero.after.target, 0);
});

Deno.test("завершённая цель не переезжает, неверный legacy период не заменяется текущим", async () => {
  const move = {
    target: goalTarget,
    toHorizon: "month",
    toPeriodKey: "2026-11",
  };
  await assert.rejects(
    effect("move_goal", move, [
      storeGoals({ ...goal, current: -10, done: true }),
    ]),
    { message: "invalid_change" },
  );
  await assert.rejects(
    effect("update_goal", { target: goalTarget, patch: { title: "новая" } }, [
      storeGoals({ ...goal, periodKey: "legacy" }),
    ]),
    { message: "invalid_change" },
  );
  const result = await effect("move_goal", move, [storeGoals()]);
  assert.equal(result.after.periodKey, "2026-11");
});

Deno.test("входящее переносится в задачу, бэклог или цель двумя изменениями", async () => {
  for (
    const [op, args, destination] of [
      ["route_inbox_to_task", { target: inboxTarget, date }, key],
      [
        "route_inbox_to_task",
        { target: inboxTarget, date: "backlog" },
        "backlog_tasks_v1",
      ],
      ["route_inbox_to_goal", {
        target: inboxTarget,
        horizon: "month",
        periodKey: "2026-11",
      }, goals],
    ] as const
  ) {
    const result = await effect(op, args, [source, missing(destination)]);
    assert.equal(result.changes.length, 2);
    assert.deepEqual(
      JSON.parse(result.changes.find((c) => c.key === inbox)!.valueText!).map((
        item: { id: string },
      ) => item.id),
      ["in_2"],
    );
    const out = JSON.parse(
      result.changes.find((c) => c.key === destination)!.valueText!,
    );
    assert.equal(
      op === "route_inbox_to_goal" ? out.goals[0].title : out[0].text,
      "разобрать письма",
    );
    assert.equal(result.before?.text, "разобрать письма");
    assert.match(renderPreview(result), /входящих/);
  }
  await assert.rejects(
    effect("route_inbox_to_task", { target: inboxTarget, date }, [{
      ...source,
      revision: "2",
    }, missing(key)]),
    { message: "conflict" },
  );
  assert.ok(source.valueText.includes("разобрать письма"));
});

Deno.test("дубликат предупреждает, точный preview не режет текст и экранирует bidi", async () => {
  const result = await effect("create_task", { text: "старая" }, [
    snap(key, [{
      ...task,
      estimatedMin: 15,
      difficulty: "medium",
      subtasks: [],
    }]),
  ]);
  assert.ok(result.warnings.includes("duplicate_creation"));
  const bidi = await effect("create_task", { text: "abc\u202Edef" }, [
    missing(key),
  ]);
  assert.equal(renderPreview(bidi).includes("\u202E"), false);
  assert.match(renderPreview(bidi), /\\u202e/i);
  assert.equal(boundedPreview("😀".repeat(1250)).length, 2500);
  assert.throws(() => boundedPreview("😀".repeat(1250) + "a"), {
    message: "preview_too_large",
  });
});

Deno.test("опции не раскрывают xp и неизвестный сектор не записывается", async () => {
  const definitions = snap("sphere_defs_v1", [{
    id: "x",
    name: "сектор",
    icon: "x",
    xp: 500,
    balance: 20,
  }]);
  assert.deepEqual(editOptions(definitions).spheres, [{
    id: "x",
    name: "сектор",
    icon: "x",
  }]);
  await assert.rejects(
    effect("create_task", { text: "новая", sphere: "unknown" }, [
      missing(key),
      definitions,
    ]),
    { message: "invalid_change" },
  );
  const result = await effect("create_task", { text: "новая", sphere: "x" }, [
    missing(key),
    definitions,
  ]);
  assert.ok(
    result.dependencies.some((d) =>
      d.key === definitions.key && d.expectedRevision === "1"
    ),
  );
});
