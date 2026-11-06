(function () {
  "use strict";
  var activeClose = null, notice = null;
  function element(tag, text, parent, className) {
    var node = document.createElement(tag);
    if (text !== undefined) node.textContent = text;
    if (className) node.className = className;
    if (parent) parent.appendChild(node);
    return node;
  }
  function open(review) {
    if (activeClose) activeClose();
    var previous = document.activeElement,
      dialog = element(
        "dialog",
        undefined,
        document.body,
        "dashboard-conflict",
      );
    dialog.setAttribute("aria-labelledby", "dashboard-conflict-title");
    var title = element("h2", "Правки разошлись", dialog);
    title.id = "dashboard-conflict-title";
    title.setAttribute("tabindex", "-1");
    title.autofocus = true;
    element(
      "p",
      "На этом устройстве и на сервере появились разные версии. Ни одна не заменена автоматически.",
      dialog,
    );
    element("p", "Аккаунт: " + review.owner, dialog, "dashboard-conflict-meta");
    element(
      "p",
      "Выбор применяется ко всем документам ниже вместе. Это сохраняет целостность переноса.",
      dialog,
    );
    review.documents.forEach(function (doc) {
      var section = element(
        "section",
        undefined,
        dialog,
        "dashboard-conflict-document",
      );
      element(
        "h3",
        doc.key === "horizons_goals_v2"
          ? "Цели"
          : "Задачи · " + doc.key.replace("goals:", ""),
        section,
      );
      var columns = element(
        "div",
        undefined,
        section,
        "dashboard-conflict-columns",
      );
      function version(label, value, info) {
        var column = element("div", undefined, columns);
        element("h4", label, column);
        element("p", info, column, "dashboard-conflict-meta");
        element(
          "pre",
          value === null ? "Запись удалена (null)" : value,
          column,
          "dashboard-conflict-value",
        );
      }
      version(
        "На этом устройстве",
        doc.local.valueText,
        "Ваши несохранённые правки",
      );
      version(
        "На сервере",
        doc.remote.valueText,
        "Версия " + doc.remote.revision +
          (doc.remote.updatedAt
            ? " · " + doc.remote.updatedAt
            : " · записи ещё нет"),
      );
      var base = element("details", undefined, section);
      element(
        "summary",
        "Общая исходная версия" +
          (doc.base ? " · " + doc.base.revision : " неизвестна"),
        base,
      );
      element(
        "pre",
        doc.base
          ? (doc.base.valueText === null ? "null" : doc.base.valueText)
          : "Исходная версия недоступна. Сравните обе версии выше.",
        base,
        "dashboard-conflict-value",
      );
    });
    var status = element(
      "p",
      review.message || "",
      dialog,
      "dashboard-conflict-status",
    );
    status.setAttribute("role", "status");
    var actions = element(
        "div",
        undefined,
        dialog,
        "dashboard-conflict-actions",
      ),
      busy = false,
      closed = false;
    var remote = element("button", "Использовать серверную версию", actions);
    var local = element(
      "button",
      "Сохранить просмотренную локальную версию",
      actions,
    );
    var cancel = element("button", "Отмена", actions);
    [remote, local, cancel].forEach(function (button) {
      button.type = "button";
    });
    function close(force) {
      if (closed || (busy && force !== true)) return;
      closed = true;
      dialog.close();
      dialog.remove();
      activeClose = null;
      if (previous && previous.focus) previous.focus();
    }
    async function choose(choice) {
      if (busy) return;
      busy = true;
      remote.disabled = local.disabled = cancel.disabled = true;
      status.textContent = "Проверяю актуальность версий…";
      var outcome;
      try {
        outcome = await review.onChoose(choice);
      } catch (_) {
        outcome = { ok: false };
      }
      if (closed) return;
      busy = false;
      cancel.disabled = false;
      if (outcome && outcome.ok) {
        close();
        refreshNotice();
        return;
      }
      if (
        outcome && outcome.error && outcome.error.code === "save_unavailable" &&
        review.onRefresh
      ) {
        var next = review.onRefresh();
        if (next) {
          close();
          open(
            Object.assign({}, next, {
              message:
                "Не удалось подтвердить запись. Сравните актуальные версии и повторите выбор. Автоматического повтора нет.",
            }),
          );
          return;
        }
      }
      if (
        outcome && outcome.error && outcome.error.code === "conflict_changed"
      ) {
        status.textContent =
          "Данные изменились после открытия. Закройте окно и заново просмотрите актуальные версии.";
      } else {
        remote.disabled = local.disabled = false;
        status.textContent =
          "Не удалось сохранить. Локальные правки сохранены на устройстве. Проверьте связь и повторите.";
      }
    }
    remote.addEventListener("click", function () {
      return choose("use_remote");
    });
    local.addEventListener("click", function () {
      return choose("apply_reviewed_local");
    });
    cancel.addEventListener("click", close);
    dialog.addEventListener("cancel", function (event) {
      event.preventDefault();
      close();
    });
    activeClose = function () {
      close(true);
    };
    dialog.showModal();
    title.focus({ preventScroll: true });
    dialog.scrollTop = 0;
    return activeClose;
  }
  function refreshNotice() {
    var api = window.DashboardSync,
      keys = api && api.listConflicts ? api.listConflicts() : [];
    if (!notice) {
      notice = element(
        "aside",
        undefined,
        document.body,
        "dashboard-conflict-notice",
      );
      notice.setAttribute("aria-label", "Конфликт синхронизации");
      element("span", "Есть несохранённые правки. Нужен ваш выбор.", notice);
      var button = element("button", "Сравнить версии", notice);
      button.type = "button";
      button.addEventListener("click", function () {
        var current = window.DashboardSync,
          list = current && current.listConflicts
            ? current.listConflicts()
            : [];
        var review = list.length && current.getConflict(list[0]);
        if (review) open(bindReview(current, review));
      });
    }
    notice.hidden = !keys.length;
  }
  function bindReview(api, review) {
    return Object.assign({}, review, {
      onChoose: function (choice) {
        return api.resolveConflict(review.key, choice, review.token);
      },
      onRefresh: function () {
        var next = api.getConflict(review.key);
        return next && bindReview(api, next);
      },
    });
  }
  window.DashboardSyncConflicts = { open: open };
  window.addEventListener("dashboard-sync-conflict", refreshNotice);
  window.addEventListener("dashboard-sync-owner-changed", function () {
    if (activeClose) activeClose();
    refreshNotice();
  });
})();
