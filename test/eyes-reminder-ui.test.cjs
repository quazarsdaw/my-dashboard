const test = require('node:test'),
  assert = require('node:assert/strict'),
  crypto = require('node:crypto');
const UI = require('../eyes-reminder.js'),
  D = require('../eyes-data.js'),
  R = require('../eyes-reminder-core.js'),
  Store = require('../eyes-store.js'),
  Coord = require('../eyes-coordination.js');
const { harness } = require('./helpers/eyes-dom.cjs');
function group(enabled = true) {
  const m = new Map(),
    storage = {
      get length() {
        return m.size;
      },
      key: (i) => [...m.keys()][i],
      getItem: (k) => m.get(k) || null,
      setItem: (k, v) => m.set(k, v),
      removeItem: (k) => m.delete(k),
    };
  let n = 0,
    chain = Promise.resolve();
  const locks = {
    request(_name, _o, fn) {
      const p = chain.then(() => fn({}));
      chain = p.catch(() => {});
      return p;
    },
  };
  const store = Store.create({
    storage,
    uuid: crypto.randomUUID,
    now: () => new Date().toISOString(),
  });
  store.saveSettings({ reminderEnabled: enabled });
  function page(id) {
    const h = harness(),
      timers = new Set();
    h.window.setInterval = (fn) => {
      timers.add(fn);
      return fn;
    };
    h.window.clearInterval = (fn) => timers.delete(fn);
    const coordination = Coord.create({
      storage,
      locks,
      now: () => n,
      uuid: crypto.randomUUID,
      tabId: id,
    });
    const app = UI.create({
      window: h.window,
      document: h.document,
      data: D,
      core: R,
      store,
      coordination,
      storage,
      tabId: id,
      getOwner: () => 'local',
      uuid: crypto.randomUUID,
      now: () => n,
      mono: () => n,
    });
    return { ...h, app, timers };
  }
  return { page, store, m, time: (v) => (n = v) };
}
test('две страницы показывают одно напоминание и сохраняют текущий draft', async () => {
  const g = group(),
    a = g.page('a'),
    b = g.page('b');
  await a.app.start();
  await b.app.start();
  g.time(1200000);
  await Promise.all([a.app.tick(), b.app.tick()]);
  assert.equal(
    a.document.body.children.length + b.document.body.children.length,
    1,
  );
  a.app.destroy();
  b.app.destroy();
});
test('bfcache возвращает heartbeat и актуальное напоминание', async () => {
  const g = group(),
    a = g.page('a');
  await a.app.start();
  await a.emit('pagehide', { persisted: true });
  assert.equal(a.timers.size, 0);
  await a.emit('pageshow', { persisted: true });
  assert.ok(a.timers.size > 0);
  g.time(1200000);
  await a.app.tick();
  assert.equal(a.document.body.children.length, 1);
  a.app.destroy();
});
test('выключенное напоминание не создаёт heartbeat и не показывает баннер', async () => {
  const g = group(false),
    a = g.page('a');
  await a.app.start();
  assert.equal(a.timers.size, 0);
  g.time(99999999);
  await a.app.tick();
  assert.equal(a.document.body.children.length, 0);
  a.app.destroy();
});
test('перерыв сохраняется после 20 активных секунд и отодвигает новый срок', async () => {
  const g = group(),
    a = g.page('a');
  await a.app.start();
  g.time(1200000);
  await a.app.tick();
  await a.app.startDistance();
  g.time(1205000);
  await a.app.tick();
  a.document.hidden = true;
  await a.emit('visibilitychange');
  g.time(1280000);
  await a.app.tick();
  assert.equal(g.store.summary().sessions, 0);
  a.document.hidden = false;
  await a.app.resumeDistance();
  for (const n of [1285000, 1290000, 1295000]) {
    g.time(n);
    await a.app.tick();
  }
  assert.equal(g.store.summary().seconds, 20);
  await a.app.tick();
  assert.equal(g.store.summary().sessions, 1);
  a.app.destroy();
});
test('закрытие ошибки сохранения не запускает новую разминку', async () => {
  const g = group(),
    a = g.page('a');
  await a.app.start();
  g.time(1200000);
  await a.app.tick();
  await a.app.startDistance();
  g.store.recordCompletion = () => {
    throw Error('quota');
  };
  for (const n of [1205000, 1210000, 1215000, 1220000]) {
    g.time(n);
    await a.app.tick();
  }
  const banner = a.document.body.children[0],
    primary = banner.children[1].children[0];
  assert.equal(primary.textContent, 'Закрыть');
  await primary.fire('click');
  assert.equal(a.document.body.children.length, 0);
  a.app.destroy();
});
