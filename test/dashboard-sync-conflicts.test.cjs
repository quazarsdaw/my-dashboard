const { test } = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs"),
  path = require("node:path"),
  vm = require("node:vm");
const { harness } = require("./helpers/eyes-dom.cjs");
function load() {
  const h = harness(), create = h.document.createElement;
  h.document.activeElement = create("button");
  h.document.createElement = (t) => {
    const e = create(t);
    e.textContent = "";
    Object.defineProperty(e, "innerHTML", {
      set() {
        throw Error("данные не должны исполняться как html");
      },
    });
    e.showModal = function () {
      this.open = true;
    };
    e.close = function () {
      this.open = false;
    };
    return e;
  };
  vm.runInNewContext(
    fs.readFileSync(
      path.join(__dirname, "../dashboard-sync-conflicts.js"),
      "utf8",
    ),
    { window: h.window, document: h.document },
  );
  return h;
}
function all(e) {
  return [e, ...e.children.flatMap(all)];
}
function review() {
  return {
    owner: "synthetic-user",
    documents: [{
      key: "goals:2026-10-27",
      base: { valueText: "base", revision: "1" },
      local: {
        valueText: "<img onerror=alert(1)>" + "полный текст ".repeat(4000),
      },
      remote: {
        valueText: "сервер " + "без обрезки ".repeat(4000),
        revision: "2",
        updatedAt: "2026-10-27T00:00:00Z",
      },
    }],
  };
}
test("полные обе версии показаны текстом, отмена и escape не вызывают onChoose", async () => {
  const h = load(), r = review(), choices = [];
  let close = h.window.DashboardSyncConflicts.open({
    ...r,
    onChoose: (c) => choices.push(c),
  });
  let dialog = h.document.body.children.find((e) => e.tagName === "DIALOG");
  assert.equal(dialog.open, true);
  const nodes = all(dialog);
  assert.ok(
    nodes.some((n) => n.textContent === r.documents[0].local.valueText),
  );
  assert.ok(
    nodes.some((n) => n.textContent === r.documents[0].remote.valueText),
  );
  assert.ok(nodes.some((n) => n.textContent.includes("synthetic-user")));
  assert.equal(
    dialog.attributes["aria-labelledby"],
    "dashboard-conflict-title",
  );
  assert.equal(nodes.find((n) => n.tagName === "H2").focused, true);
  await nodes.find((n) => n.textContent === "Отмена").fire("click");
  assert.equal(choices.length, 0);
  close = h.window.DashboardSyncConflicts.open({
    ...r,
    onChoose: (c) => choices.push(c),
  });
  dialog = h.document.body.children.find((e) => e.tagName === "DIALOG");
  await dialog.fire("cancel");
  assert.equal(choices.length, 0);
  close();
});
test("смена аккаунта закрывает даже выполняющийся review без применения нового выбора", async () => {
  const h = load();
  let release;
  h.window.DashboardSyncConflicts.open({
    ...review(),
    onChoose: () => new Promise((r) => release = r),
  });
  const dialog = h.document.body.children.find((e) => e.tagName === "DIALOG");
  const pending = all(dialog).find((n) =>
    n.textContent === "Использовать серверную версию"
  ).fire("click");
  await h.emit("dashboard-sync-owner-changed");
  assert.equal(dialog.open, false);
  release({ ok: true });
  await pending;
});
test("обе явные кнопки различаются и ошибка не закрывает окно", async () => {
  const h = load(), choices = [];
  h.window.DashboardSyncConflicts.open({
    ...review(),
    onChoose: async (c) => {
      choices.push(c);
      return { ok: false, error: { code: "conflict_changed" } };
    },
  });
  const dialog = h.document.body.children.find((e) => e.tagName === "DIALOG");
  await all(dialog).find((n) =>
    n.textContent === "Сохранить просмотренную локальную версию"
  ).fire("click");
  assert.deepEqual(choices, ["apply_reviewed_local"]);
  assert.equal(dialog.open, true);
  assert.ok(all(dialog).some((n) => n.textContent.includes("изменились")));
});
test("после network error доступен новый review, retry не выполняется без нового click", async () => {
  const h = load();
  let calls = 0;
  const fresh = {
    ...review(),
    onChoose: async () => {
      calls++;
      return { ok: true };
    },
  };
  h.window.DashboardSyncConflicts.open({
    ...review(),
    onChoose: async () => {
      calls++;
      return { ok: false, error: { code: "save_unavailable" } };
    },
    onRefresh: () => fresh,
  });
  let dialog = h.document.body.children.find((e) => e.tagName === "DIALOG");
  await all(dialog).find((n) =>
    n.textContent === "Сохранить просмотренную локальную версию"
  ).fire("click");
  assert.equal(calls, 1);
  dialog = h.document.body.children.find((e) => e.tagName === "DIALOG");
  await all(dialog).find((n) =>
    n.textContent === "Сохранить просмотренную локальную версию"
  ).fire("click");
  assert.equal(calls, 2);
  assert.equal(dialog.open, false);
});
