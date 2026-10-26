(function () {
  "use strict";
  var nativeFetch = fetch,
    append = document.head.appendChild.bind(document.head),
    owner = "fixture-user-a",
    authChanged = null;
  var offline = false, failNextSave = false, signedIn = true;
  function safeFetch(url, options) {
    var parsed = new URL(url, location.origin);
    if (parsed.origin !== location.origin) {
      throw new Error("external_network_forbidden");
    }
    if (offline) return Promise.reject(new Error("synthetic_offline"));
    return nativeFetch(parsed.href, options);
  }
  window.fetch = safeFetch;
  // global fetch is window.fetch in a real browser. tests also verify the wrapper.
  fetch = safeFetch;
  function post(route, data) {
    return safeFetch(route, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(Object.assign({ owner: owner }, data)),
    }).then(function (r) {
      return r.json();
    });
  }
  document.head.appendChild = function (node) {
    if (
      node.src &&
      node.src.indexOf(
          "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@",
        ) === 0
    ) {
      queueMicrotask(function () {
        if (node.onload) node.onload();
      });
      return node;
    }
    return append(node);
  };
  function user() {
    return { id: owner, email: owner + "@synthetic.invalid" };
  }
  window.supabase = {
    createClient: function () {
      return {
        auth: {
          getSession: function () {
            return Promise.resolve({
              data: { session: signedIn ? { user: user() } : null },
            });
          },
          onAuthStateChange: function (cb) {
            authChanged = cb;
          },
          signOut: function () {
            signedIn = false;
            if (authChanged) authChanged("SIGNED_OUT", null);
            return Promise.resolve();
          },
        },
        rpc: function (name, args) {
          if (name === "dashboard_save_documents" && failNextSave) {
            failNextSave = false;
            return Promise.resolve({
              data: null,
              error: { code: "synthetic_network_error" },
            });
          }
          return post("/__fixture/rpc", { name: name, args: args });
        },
        from: function () {
          var b = {
            select: function () {
              return b;
            },
            eq: function () {
              return b;
            },
            order: function () {
              return b;
            },
            gt: function () {
              return b;
            },
            limit: function () {
              return b;
            },
            upsert: function () {
              return Promise.resolve({ data: [], error: null });
            },
            delete: function () {
              throw Error("fixture_delete_forbidden");
            },
            then: function (r, j) {
              return Promise.resolve({ data: [], error: null }).then(r, j);
            },
          };
          return b;
        },
        channel: function () {
          return {
            on: function () {
              return this;
            },
            subscribe: function () {
              return this;
            },
            unsubscribe: function () {},
          };
        },
        removeChannel: function () {},
      };
    },
  };
  window.DashboardFixture = {
    remote: function (key) {
      return post("/__fixture/remote", { key: key }).then(function () {
        return window.SupabaseSync.pullNow();
      });
    },
    local: function () {
      var key = "horizons_goals_v2",
        value = JSON.parse(localStorage.getItem(key));
      value.goals[0].title = "Локально: сохранить подробный план";
      value.goals[0].description = "Полная локальная версия " +
        "важная деталь ".repeat(180);
      localStorage.setItem(key, JSON.stringify(value));
      window.dispatchEvent(
        new CustomEvent("dashboard-sync-applied", {
          detail: { changedKeys: [key] },
        }),
      );
    },
    offline: function (value) {
      offline = value;
    },
    switchOwner: function () {
      owner = owner === "fixture-user-a" ? "fixture-user-b" : "fixture-user-a";
      signedIn = true;
      if (authChanged) authChanged("SIGNED_IN", { user: user() });
    },
    mount: function () {
      // keep test controls inside the visible part of a clipped desktop panel.
      var controls = document.getElementById("fixtureControls");
      controls.style.left = "12px";
      controls.style.right = "auto";
      function control(label, action) {
        var button = document.createElement("button");
        button.type = "button";
        button.textContent = label;
        button.onclick = action;
        document.getElementById("fixtureControls").appendChild(button);
      }
      control("ошибка следующей записи", function () {
        failNextSave = true;
      });
      control("выйти из аккаунта", function () {
        signedIn = false;
        if (authChanged) authChanged("SIGNED_OUT", null);
      });
      control("обновить задачи через 3 с", function () {
        setTimeout(function () {
          window.DashboardFixture.remote(
            "goals:" + window.DashboardTasksCore.dateKey(new Date()),
          );
        }, 3000);
      });
      document.getElementById("fixtureLocal").onclick =
        window.DashboardFixture.local;
      document.getElementById("fixtureRemote").onclick = function () {
        return window.DashboardFixture.remote();
      };
      document.getElementById("fixturePull").onclick = function () {
        return window.SupabaseSync.pullNow();
      };
      document.getElementById("fixtureOffline").onclick = function () {
        offline = !offline;
        this.textContent = offline ? "сеть: offline" : "сеть: online";
      };
      document.getElementById("fixtureOwner").onclick =
        window.DashboardFixture.switchOwner;
    },
  };
})();
