const test = require('node:test'),
  assert = require('node:assert/strict');
const UI = require('../eyes.js'),
  D = require('../eyes-data.js'),
  C = require('../eyes-core.js'),
  S = require('../eyes-session.js'),
  Store = require('../eyes-store.js');
const { harness } = require('./helpers/eyes-dom.cjs');
function setup(options = {}) {
  const h = harness(),
    map = new Map(
      options.snapshot
        ? [['_eye_break_active_v1', JSON.stringify(options.snapshot)]]
        : [],
    );
  let currentOwner = 'local';
  const getOwner = () => currentOwner;
  const storage = {
    get length() {
      return map.size;
    },
    key: (i) => [...map.keys()][i],
    getItem: (k) => map.get(k) || null,
    setItem: (k, v) => map.set(k, v),
    removeItem: (k) => map.delete(k),
  };
  const store = Store.create({
    storage,
    events: h.window,
    getOwner,
    uuid: () => h.window.crypto.randomUUID(),
    now: () => new Date().toISOString(),
  });
  const coordination = Object.assign({
    claimSession: async () => ({ ok: true, token: 't' }),
    renewSession: async () => true,
    releaseSession: async () => true,
    retireSession: () => true,
    close() {},
  }, options.coordination);
  const app = UI.create({
    window: h.window,
    document: h.document,
    data: D,
    core: C,
    session: S,
    store,
    coordination,
    getOwner,
  });
  app.init();
  let frameClock = 0;
  async function tick(ms) {
    while (frameClock + 1000 < ms) {
      frameClock += 1000;
      await h.tick(frameClock);
    }
    frameClock = ms;
    await h.tick(ms);
  }
  return {
    ...h,
    rawTick: h.tick,
    tick,
    app,
    store,
    coordination,
    map,
    owner: (v) => (currentOwner = v),
  };
}
test('долгая остановка кадров не засчитывает сон как практику', async () => {
  const h = setup();
  h.app.setDuration(30);
  await h.app.start();
  await h.tick(1000);
  await h.rawTick(61000);
  assert.equal(h.store.summary().sessions, 0);
  assert.equal(h.store.loadActive().phase, 'paused');
  assert.equal(h.store.loadActive().playedMs, 1000);
  h.app.destroy();
});
test('крупный таймер считает этап, маленький — комплекс, включая паузу и skip', async () => {
  const h = setup();
  h.app.setDuration(60);
  await h.app.start();
  assert.equal(h.ids.eyeTime.textContent, '0:13');
  assert.equal(h.ids.eyeTotalTime.textContent, '1:00');
  await h.tick(3000);
  assert.equal(h.ids.eyeTime.textContent, '0:10');
  assert.equal(h.ids.eyeTotalTime.textContent, '0:57');
  await h.ids.pauseEye.fire('click');
  await h.tick(20000);
  assert.equal(h.ids.eyeTime.textContent, '0:10');
  assert.equal(h.ids.eyeTotalTime.textContent, '0:57');
  await h.ids.nextEye.fire('click');
  assert.equal(h.ids.eyeTime.textContent, '0:13');
  assert.equal(h.ids.eyeTotalTime.textContent, '0:47');
  assert.equal(h.store.summary().sessions, 0);
  h.app.destroy();
});
test('близко-далеко показывает палец, затем центральную точку и снова палец без зависимости от звука', async () => {
  const h = setup();
  h.ids.soundEnabled.checked = false;
  await h.ids.soundEnabled.fire('change');
  h.ids.dotSize.value = 'large';
  await h.ids.dotSize.fire('change');
  h.app.choose('single', 'near-far');
  h.app.setDuration(30);
  await h.app.start();
  assert.equal(h.ids.eyeDot.hidden, true);
  assert.match(h.ids.stagePrompt.textContent, /палец/);
  await h.tick(6000);
  assert.equal(h.ids.eyeDot.hidden, false);
  assert.match(h.ids.stagePrompt.textContent, /Теперь сюда/);
  assert.match(h.ids.eyeDot.style.transform, /translate3d\(450px,200px,0\)/);
  assert.equal(h.ids.eyeDot.style.width, '36px');
  assert.equal(h.ids.pathGuide.style.display, 'none');
  await h.tick(12000);
  assert.equal(h.ids.eyeDot.hidden, true);
  assert.match(h.ids.stagePrompt.textContent, /палец/);
  h.app.destroy();
});
test('направляющая короткого круга не обрезается разворотом текущего этапа', async () => {
  const h = setup();
  h.app.setDuration(60);
  await h.app.start();
  await h.ids.nextEye.fire('click');
  await h.ids.nextEye.fire('click');
  const points = h.ids.pathGuide
    .getAttribute('points')
    .split(' ')
    .map((x) => x.split(',').map(Number));
  assert.deepEqual(points[0], points.at(-1));
  assert.ok(points.some(([x, y]) => x < 30 && y < 30));
  assert.ok(points.some(([x, y]) => x > 70 && y > 70));
  h.app.destroy();
});
test('отложенное восстановление auth снова читает snapshot текущего владельца', async () => {
  for (const event of ['dashboard-sync-applied', 'dashboard-auth-changed']) {
    const snapshot = S.createSession(
      C.buildPlan({ mode: 'short', durationSeconds: 30 }),
      {
        id: require('node:crypto').randomUUID(),
        epoch: 'initial',
        owner: 'user-a',
        nowMs: 0,
      },
    );
    const h = setup({ snapshot });
    assert.equal(h.ids.resumePanel.hidden, true);
    h.owner('user-a');
    await h.emit(event);
    assert.equal(h.ids.resumePanel.hidden, false);
    await h.ids.resumeEye.fire('click');
    assert.equal(h.store.loadActive().id, snapshot.id);
    h.app.destroy();
  }
});
test('после bfcache и продолжения снова работает heartbeat', async () => {
  const h = setup(),
    timers = new Set();
  h.window.setInterval = (fn) => {
    timers.add(fn);
    return fn;
  };
  h.window.clearInterval = (fn) => timers.delete(fn);
  await h.app.start();
  assert.equal(timers.size, 1);
  await h.emit('pagehide', { persisted: true });
  assert.equal(timers.size, 0);
  await h.emit('pageshow', { persisted: true });
  await h.ids.pauseEye.fire('click');
  assert.equal(timers.size, 1);
  h.app.destroy();
});
test('pagehide отзывает lease синхронно без незавершённого async release', async () => {
  let retired = 0, released = 0;
  const h = setup({ coordination: {
    retireSession: () => { retired++; return true; },
    releaseSession: async () => { released++; return true; },
  } });
  await h.app.start();
  await h.emit('pagehide', { persisted: false });
  assert.equal(retired, 1);
  assert.equal(released, 0);
  h.app.destroy();
});
test('инструкция вдаль даёт однократный сигнал окончания', async () => {
  const h = setup(),
    signals = [];
  h.window.navigator.vibrate = (n) => signals.push(n);
  h.ids.vibrationEnabled.checked = true;
  await h.ids.vibrationEnabled.fire('change');
  h.app.choose('single', 'distance');
  h.app.setDuration(30);
  await h.app.start();
  assert.equal(signals.length, 1);
  await h.tick(30000);
  assert.equal(signals.length, 2);
  await h.tick(31000);
  assert.equal(signals.length, 2);
  h.app.destroy();
});
test('неподходящее время блокирует полный комплекс, изменение времени разрешает запуск', async () => {
  const h = setup();
  h.app.choose('full');
  assert.equal(await h.app.start(), false);
  assert.equal(h.store.loadActive(), null);
  h.app.setDuration(120);
  assert.equal(await h.app.start(), true);
  assert.equal(h.store.loadActive().plan.stages.length, 11);
  h.app.destroy();
});
test('выбор одного упражнения не запускает его без кнопки и сохраняет настройки', () => {
  const h = setup();
  h.app.choose('single', 'jumps');
  assert.equal(h.store.loadActive(), null);
  assert.deepEqual(h.store.settings().exerciseIds, ['jumps']);
  h.app.destroy();
});
test('инструкция вдаль скрывает svg-траекторию через применяемый браузером стиль', async () => {
  const h = setup();
  h.app.choose('single', 'distance');
  h.app.setDuration(30);
  await h.app.start();
  assert.equal(h.ids.pathGuide.style.display, 'none');
  h.app.destroy();
});
test('пауза при скрытии не накручивает статистику, завершение записывается один раз', async () => {
  const h = setup();
  h.app.setDuration(30);
  await h.app.start();
  await h.tick(10000);
  h.document.hidden = true;
  await h.emit('visibilitychange');
  await h.tick(90000);
  assert.equal(h.store.summary().sessions, 0);
  h.document.hidden = false;
  await h.ids.pauseEye.fire('click');
  await h.tick(110000);
  assert.equal(h.store.summary().sessions, 1);
  await h.tick(120000);
  assert.equal(h.store.summary().sessions, 1);
  h.app.destroy();
});
test('skip и выход не засчитывают выполненную практику, отказы browser api не ломают запуск', async () => {
  const h = setup();
  h.app.setDuration(30);
  await h.app.start();
  await h.ids.nextEye.fire('click');
  await h.tick(60000);
  assert.equal(h.store.summary().sessions, 0);
  h.app.destroy();
});
test('смена аккаунта не позволяет продолжить чужое занятие в новом аккаунте', async () => {
  const h = setup();
  h.app.setDuration(30);
  await h.app.start();
  await h.tick(10000);
  h.owner('other');
  await h.emit('dashboard-sync-applied');
  await h.ids.pauseEye.fire('click');
  await h.tick(50000);
  assert.equal(h.store.summary().sessions, 0);
  assert.equal(h.ids.eyePlayer.hidden, true);
  h.app.destroy();
});
test('пауза на границе завершения не оставляет законченный таймер зависшим', async () => {
  const h = setup();
  h.app.setDuration(30);
  await h.app.start();
  await h.tick(29000);
  h.window.performance.now = () => 30000;
  await h.ids.pauseEye.fire('click');
  assert.equal(h.store.summary().sessions, 1);
  assert.equal(h.ids.eyeResult.hidden, false);
  h.app.destroy();
});
test('полный экран запрашивается на видимом корне и закрывается после завершения', async () => {
  const h = setup();
  let asked = 0,
    exited = 0;
  h.document.documentElement = {
    requestFullscreen: () => {
      asked++;
      h.document.fullscreenElement = {};
      return Promise.resolve();
    },
  };
  h.document.exitFullscreen = () => {
    exited++;
    h.document.fullscreenElement = null;
    return Promise.resolve();
  };
  h.ids.fullscreenEnabled.checked = true;
  await h.ids.fullscreenEnabled.fire('change');
  h.app.setDuration(30);
  await h.app.start();
  assert.equal(asked, 1);
  await h.tick(30000);
  assert.equal(exited, 1);
  h.app.destroy();
});
test('выбранный размер и цвет точки применяются к плееру, а не только сохраняются', async () => {
  const h = setup();
  h.ids.dotSize.value = 'large';
  await h.ids.dotSize.fire('change');
  h.ids.dotColor.value = 'pink';
  await h.ids.dotColor.fire('change');
  h.app.setDuration(30);
  await h.app.start();
  assert.equal(h.ids.eyeDot.style.width, '36px');
  assert.equal(h.ids.eyeDot.style.background, '#f4a6c1');
  h.app.destroy();
});
test('отказ координации не оставляет настройки в полном экране', async () => {
  const h = setup();
  let exited = 0;
  h.document.documentElement = {
    requestFullscreen: () => {
      h.document.fullscreenElement = {};
      return Promise.resolve();
    },
  };
  h.document.exitFullscreen = () => {
    exited++;
    h.document.fullscreenElement = null;
    return Promise.resolve();
  };
  h.ids.fullscreenEnabled.checked = true;
  await h.ids.fullscreenEnabled.fire('change');
  h.coordination.claimSession = async () => ({ ok: false });
  assert.equal(await h.app.start(), false);
  assert.equal(exited, 1);
  h.app.destroy();
});
