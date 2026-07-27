# план реализации масштабирования таймлайна школы

> **для агентных исполнителей:** обязательный поднавык: использовать `superpowers:subagent-driven-development` или `superpowers:executing-plans` и выполнять задачи по порядку. шаги отслеживать чекбоксами `- [ ]`.

**цель:** добавить wheel zoom с точностью до 5 минут, убрать глобальную блокировку после drop и сразу показывать каркас школы во время внешнего чтения notion.

**архитектура:** чистая геометрия масштаба живёт в `school-core.js`. последовательность сетевых mutations изолируется в новом `school-mutation-queue.js`, а `school.js` хранит подтверждённый список уроков и поверх него повторно применяет ещё не подтверждённые optimistic reducers. начальная загрузка не кеширует уроки: html-каркас и skeleton видны сразу, затем одно авторизованное чтение notion заменяет их реальными данными.

**стек:** vanilla javascript в формате umd, html, css, `node:test`, существующий supabase client и edge function `school-notion`.

## глобальные ограничения

- notion остаётся единственным источником школьных данных.
- кеш уроков в supabase database, `localstorage` или `sessionstorage` не добавляется.
- уровни масштаба: ×1 = 60 px/час и 15 минут; ×1.5 = 90 px/час и 10 минут; ×2 = 120 px/час и 5 минут; ×3 = 180 px/час и 5 минут.
- текстовые подписи времени остаются только у целых часов.
- wheel zoom работает только над временной сеткой и сохраняет время под курсором на прежней экранной координате.
- на границе масштаба движение колеса в недоступную сторону не перехватывается.
- мобильное и клавиатурное управление выполняется кнопками `−` и `+`.
- изменение масштаба не вызывает notion mutation.
- same-day перенос не увеличивает `количество переносов`; cross-day перенос увеличивает его ровно на один.
- одна неудачная mutation откатывает только относящийся к ней optimistic слой.
- после серии mutations выполняется одна итоговая revalidation.
- jwt, `school_owner_user_id`, cors и серверные проверки не изменяются.
- реальные 18 уроков не используются для destructive-тестов.
- не добавлять стороннюю календарную библиотеку.
- не мержить и не публиковать github pages без отдельного подтверждения пользователя.

## структура файлов

- `school-core.js` — только чистая математика масштаба, snap и координат времени.
- `school-mutation-queue.js` — только fifo-выполнение команд, pending keys и единый callback после серии.
- `school.js` — controller, optimistic слои, rendering, wheel/drag события и error copy.
- `school.html` — script order, controls масштаба и статический skeleton.
- `school.css` — плотность линий, zoom controls, pending-карточка и loading shell.
- `test/school-core.test.cjs` — чистые уровни, координаты и округление.
- `test/school-mutation-queue.test.cjs` — последовательность, изоляция ошибок и единая revalidation.
- `test/school-ui.test.cjs` — html/css-контракты, controller optimistic state и initial shell.

---

### задача 1: чистая модель масштаба и координат времени

**файлы:**

- изменить: `school-core.js:20-21,75-80,350-370`
- изменить: `test/school-core.test.cjs`

**интерфейсы:**

- потребляет: число минут, индекс уровня масштаба, координату `y`.
- производит:
  - `timelineZoomLevel(index) -> { index, label, pixelsPerHour, snapMinutes }`
  - `nextTimelineZoomIndex(index, direction) -> number`
  - `timelineYForMinute(minute, startMinute, pixelsPerHour) -> number`
  - `timelineMinuteAtY(y, startMinute, pixelsPerHour, snapMinutes) -> number`
  - `snapMinuteOfDay(value, stepMinutes?) -> number`

- [ ] **шаг 1: написать падающие тесты уровней и snap**

добавить в `test/school-core.test.cjs`:

```js
test('exposes the four approved timeline zoom levels', () => {
  assert.deepEqual(
    [0, 1, 2, 3].map(SchoolCore.timelineZoomLevel),
    [
      { index: 0, label: '×1 · шаг 15 минут', pixelsPerHour: 60, snapMinutes: 15 },
      { index: 1, label: '×1.5 · шаг 10 минут', pixelsPerHour: 90, snapMinutes: 10 },
      { index: 2, label: '×2 · шаг 5 минут', pixelsPerHour: 120, snapMinutes: 5 },
      { index: 3, label: '×3 · шаг 5 минут', pixelsPerHour: 180, snapMinutes: 5 }
    ]
  );
});

test('snaps timeline minutes with the active zoom precision', () => {
  assert.equal(SchoolCore.snapMinuteOfDay(14 * 60 + 7, 15), 14 * 60);
  assert.equal(SchoolCore.snapMinuteOfDay(14 * 60 + 7, 10), 14 * 60 + 10);
  assert.equal(SchoolCore.snapMinuteOfDay(14 * 60 + 7, 5), 14 * 60 + 5);
});

test('converts minutes and vertical coordinates without losing the anchor', () => {
  const y = SchoolCore.timelineYForMinute(14 * 60 + 5, 9 * 60, 120);
  assert.equal(y, 610);
  assert.equal(
    SchoolCore.timelineMinuteAtY(y, 9 * 60, 120, 5),
    14 * 60 + 5
  );
});

test('clamps wheel zoom to the supported range', () => {
  assert.equal(SchoolCore.nextTimelineZoomIndex(0, -1), 0);
  assert.equal(SchoolCore.nextTimelineZoomIndex(0, 1), 1);
  assert.equal(SchoolCore.nextTimelineZoomIndex(3, 1), 3);
});
```

- [ ] **шаг 2: подтвердить red**

запустить:

```bash
node --test test/school-core.test.cjs
```

ожидаемый результат: новые тесты падают, потому что четыре функции ещё не экспортированы, а `snapMinuteOfDay` игнорирует переданный шаг.

- [ ] **шаг 3: реализовать минимальную чистую модель**

добавить в `school-core.js`:

```js
var TIMELINE_ZOOM_LEVELS = Object.freeze([
  Object.freeze({ index: 0, label: '×1 · шаг 15 минут', pixelsPerHour: 60, snapMinutes: 15 }),
  Object.freeze({ index: 1, label: '×1.5 · шаг 10 минут', pixelsPerHour: 90, snapMinutes: 10 }),
  Object.freeze({ index: 2, label: '×2 · шаг 5 минут', pixelsPerHour: 120, snapMinutes: 5 }),
  Object.freeze({ index: 3, label: '×3 · шаг 5 минут', pixelsPerHour: 180, snapMinutes: 5 })
]);

function timelineZoomLevel(index) {
  var normalized = Number.isInteger(index) ? index : 0;
  return TIMELINE_ZOOM_LEVELS[Math.max(0, Math.min(TIMELINE_ZOOM_LEVELS.length - 1, normalized))];
}

function nextTimelineZoomIndex(index, direction) {
  return timelineZoomLevel(Number(index) + (direction > 0 ? 1 : -1)).index;
}

function timelineYForMinute(minute, startMinute, pixelsPerHour) {
  return (Number(minute) - Number(startMinute)) / 60 * Number(pixelsPerHour);
}

function timelineMinuteAtY(y, startMinute, pixelsPerHour, snapMinutes) {
  return snapMinuteOfDay(
    Number(startMinute) + Number(y) / Number(pixelsPerHour) * 60,
    snapMinutes
  );
}

function snapMinuteOfDay(value, stepMinutes) {
  var minutes = Number(value);
  var step = Number.isInteger(stepMinutes) && stepMinutes > 0 ? stepMinutes : DRAG_SNAP_MINUTES;
  if (!Number.isFinite(minutes)) return 0;
  return Math.max(0, Math.min(24 * 60 - step, Math.round(minutes / step) * step));
}
```

экспортировать новые функции через существующий `Object.freeze`.

- [ ] **шаг 4: подтвердить green**

запустить:

```bash
node --test test/school-core.test.cjs
```

ожидаемый результат: все тесты файла проходят.

- [ ] **шаг 5: закоммитить чистую модель**

```bash
git add school-core.js test/school-core.test.cjs
git commit -m "добавить геометрию масштаба школы"
```

### задача 2: wheel zoom, визуальные деления и доступные кнопки

**файлы:**

- изменить: `school.html:12-19,63-72`
- изменить: `school.js:600-618,850-930,1458-1511`
- изменить: `school.css:480-575,930-1010`
- изменить: `test/school-ui.test.cjs`

**интерфейсы:**

- потребляет функции задачи 1.
- производит:
  - состояние `timelineZoomIndex` внутри controller;
  - `setTimelineZoom(nextIndex, anchor)` для wheel и кнопок;
  - `timelineDestination(core, day, clientY, rect, bounds, zoomLevel)` для preview и drop;
  - html-элементы `schoolZoomOut`, `schoolZoomLabel`, `schoolZoomIn`.

- [ ] **шаг 1: написать падающие ui-контракты**

добавить в `test/school-ui.test.cjs` проверки:

```js
test('school week exposes accessible timeline zoom controls', () => {
  const html = read('school.html');
  assert.ok(html.includes('id="schoolZoomOut"'));
  assert.ok(html.includes('aria-label="Уменьшить масштаб времени"'));
  assert.ok(html.includes('id="schoolZoomLabel"'));
  assert.ok(html.includes('id="schoolZoomIn"'));
  assert.ok(html.includes('aria-label="Увеличить масштаб времени"'));
});

test('timeline destination uses the active zoom step', () => {
  assert.deepEqual(
    SchoolUi.timelineDestination(
      SchoolCore,
      '2026-08-03',
      130,
      { top: 10 },
      { startHour: 9 },
      { pixelsPerHour: 120, snapMinutes: 5 }
    ),
    { kind: 'timed', start: '2026-08-03T10:00:00+05:00' }
  );
});

test('school styles distinguish quarter ten and five minute lines', () => {
  const css = read('school.css');
  assert.ok(css.includes('.school-time-line.is-quarter'));
  assert.ok(css.includes('.school-time-line.is-ten'));
  assert.ok(css.includes('.school-time-line.is-five'));
  assert.ok(css.includes('.school-zoom-controls'));
});
```

- [ ] **шаг 2: подтвердить red**

```bash
node --test test/school-ui.test.cjs
```

ожидаемый результат: отсутствуют элементы управления, экспорт `timelineDestination` и новые css-классы.

- [ ] **шаг 3: добавить разметку и cache-busting**

в `school.html`:

```html
<link rel="stylesheet" href="school.css?v=4">
```

в header недельной секции рядом с `schoolWeekTimeMeta`:

```html
<div class="school-week-tools">
  <span class="school-section-meta" id="schoolWeekTimeMeta">09:00–20:00 · Asia/Yekaterinburg</span>
  <div class="school-zoom-controls" aria-label="Масштаб времени">
    <button id="schoolZoomOut" type="button" aria-label="Уменьшить масштаб времени">−</button>
    <output id="schoolZoomLabel">×1 · шаг 15 минут</output>
    <button id="schoolZoomIn" type="button" aria-label="Увеличить масштаб времени">+</button>
  </div>
</div>
```

обновить query suffix для `school-core.js` и `school.js`, чтобы preview и github pages не удерживали старые скрипты.

- [ ] **шаг 4: заменить фиксированные пиксели геометрией уровня**

в `school.js` вычислять:

```js
var zoomLevel = core.timelineZoomLevel(timelineZoomIndex);
var startMinute = bounds.startHour * 60;
var endMinute = bounds.endHour * 60;
var timelineHeight = core.timelineYForMinute(endMinute, startMinute, zoomLevel.pixelsPerHour);
```

позиции подписей, линий и карточек вычислять через `timelineYForMinute`. рисовать линии с интервалом `zoomLevel.snapMinutes`: 15 минут на ×1, 10 минут на ×1.5 и 5 минут на ×2/×3. назначать `is-hour`, `is-half`, `is-quarter`, `is-ten` или `is-five`.

добавить чистый helper:

```js
function timelineDestination(core, day, clientY, rect, bounds, zoomLevel) {
  var minute = core.timelineMinuteAtY(
    clientY - rect.top,
    bounds.startHour * 60,
    zoomLevel.pixelsPerHour,
    zoomLevel.snapMinutes
  );
  return {
    kind: 'timed',
    start: day + 'T' + String(Math.floor(minute / 60)).padStart(2, '0') +
      ':' + String(minute % 60).padStart(2, '0') + ':00+05:00'
  };
}
```

использовать один helper и для drag preview, и для drop, передавая controller dependency `core`.

- [ ] **шаг 5: добавить wheel anchor и кнопки**

при wheel:

```js
function handleTimelineWheel(event, timeShell, bounds) {
  var direction = event.deltaY < 0 ? 1 : -1;
  var nextIndex = core.nextTimelineZoomIndex(timelineZoomIndex, direction);
  if (nextIndex === timelineZoomIndex) return;

  event.preventDefault();
  var rect = timeShell.getBoundingClientRect();
  var current = core.timelineZoomLevel(timelineZoomIndex);
  var anchorMinute = bounds.startHour * 60 +
    (event.clientY - rect.top) / current.pixelsPerHour * 60;
  timelineZoomIndex = nextIndex;
  buildModel();
  restoreTimelineAnchor(anchorMinute, event.clientY, bounds);
}

function restoreTimelineAnchor(anchorMinute, clientY, bounds) {
  if (!root || typeof root.requestAnimationFrame !== 'function') return;
  root.requestAnimationFrame(function () {
    var nextShell = byId('schoolTimeShell');
    if (!nextShell || typeof nextShell.getBoundingClientRect !== 'function') return;
    var nextLevel = core.timelineZoomLevel(timelineZoomIndex);
    var nextRect = nextShell.getBoundingClientRect();
    var nextY = core.timelineYForMinute(
      anchorMinute,
      bounds.startHour * 60,
      nextLevel.pixelsPerHour
    );
    if (typeof root.scrollBy === 'function') {
      root.scrollBy(0, nextRect.top + nextY - clientY);
    }
  });
}
```

назначить динамическому `timeShell.id = 'schoolTimeShell'`. кнопки вызывают тот же переход с центром видимой части сетки. wheel listener регистрировать с `{ passive: false }`.

- [ ] **шаг 6: добавить css-состояния**

добавить контраст у четвертей и показывать пятиминутные линии только при создании соответствующих элементов:

```css
.school-time-line.is-quarter { border-top-color: rgba(255, 255, 255, 0.035); }
.school-time-line.is-ten { border-top-color: rgba(255, 255, 255, 0.028); }
.school-time-line.is-five { border-top-color: rgba(255, 255, 255, 0.018); }
.school-zoom-controls {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
.school-zoom-controls button { min-width: 44px; min-height: 44px; }
.school-time-shell.is-zooming .school-time-card {
  transition: top 120ms ease, height 120ms ease;
}
.school-time-card.is-dragging { transition: none; }
```

- [ ] **шаг 7: подтвердить ui green**

```bash
node --test test/school-core.test.cjs test/school-ui.test.cjs
```

ожидаемый результат: оба файла проходят.

- [ ] **шаг 8: закоммитить wheel zoom**

```bash
git add school.html school.css school.js test/school-ui.test.cjs
git commit -m "добавить wheel zoom расписания школы"
```

### задача 3: изолированная очередь mutations без глобальной блокировки

**файлы:**

- создать: `school-mutation-queue.js`
- создать: `test/school-mutation-queue.test.cjs`
- изменить: `school.html:17-20`
- изменить: `school.js:600-618,1022-1066,1068-1135`
- изменить: `school.css:38-44,290-325,523-575`
- изменить: `test/school-ui.test.cjs`

**интерфейсы:**

- производит `SchoolMutationQueue.create(options)`.
- `options.execute(entry) -> promise`.
- `options.afterBatch() -> promise`.
- `options.onPendingChange(keys)`.
- `enqueue({ id, keys, command }) -> promise`.
- `isPending(key) -> boolean`.
- `whenIdle() -> promise`.

- [ ] **шаг 1: написать падающие unit-тесты очереди**

создать `test/school-mutation-queue.test.cjs`:

```js
const assert = require('node:assert/strict');
const test = require('node:test');
const SchoolMutationQueue = require('../school-mutation-queue.js');

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

test('executes rapid mutations sequentially and revalidates once', async () => {
  const first = deferred();
  const calls = [];
  const queue = SchoolMutationQueue.create({
    execute(entry) {
      calls.push(entry.command.operation);
      return entry.id === 'a' ? first.promise : Promise.resolve(entry.id);
    },
    async afterBatch() {
      calls.push('revalidate');
    }
  });

  const a = queue.enqueue({ id: 'a', keys: ['lesson-a'], command: { operation: 'moveLesson' } });
  const b = queue.enqueue({ id: 'b', keys: ['lesson-b'], command: { operation: 'moveLesson' } });
  assert.deepEqual(calls, ['moveLesson']);
  first.resolve('a');
  await Promise.all([a, b]);
  await queue.whenIdle();
  assert.deepEqual(calls, ['moveLesson', 'moveLesson', 'revalidate']);
});

test('keeps processing after one mutation fails', async () => {
  const calls = [];
  const queue = SchoolMutationQueue.create({
    execute(entry) {
      calls.push(entry.id);
      return entry.id === 'bad' ? Promise.reject(new Error('notion failed')) : Promise.resolve(entry.id);
    },
    async afterBatch() {
      calls.push('revalidate');
    }
  });

  const bad = queue.enqueue({ id: 'bad', keys: ['lesson-a'], command: {} });
  const good = queue.enqueue({ id: 'good', keys: ['lesson-b'], command: {} });
  await assert.rejects(bad, /notion failed/);
  assert.equal(await good, 'good');
  await queue.whenIdle();
  assert.deepEqual(calls, ['bad', 'good', 'revalidate']);
});
```

- [ ] **шаг 2: подтвердить red**

```bash
node --test test/school-mutation-queue.test.cjs
```

ожидаемый результат: модуль ещё отсутствует.

- [ ] **шаг 3: реализовать scheduler**

создать umd-модуль с одной внутренней fifo-очередью. основа реализации:

```js
(function (root, factory) {
  'use strict';
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.SchoolMutationQueue = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  function create(options) {
    var items = [];
    var pendingCounts = new Map();
    var processing = false;
    var idleWaiters = [];

    function pendingKeys() {
      return new Set([...pendingCounts.keys()].filter(function (key) {
        return pendingCounts.get(key) > 0;
      }));
    }

    function emitPending() {
      if (typeof options.onPendingChange === 'function') {
        options.onPendingChange(pendingKeys());
      }
    }

    function changeKeys(keys, delta) {
      (keys || []).forEach(function (key) {
        var next = (pendingCounts.get(key) || 0) + delta;
        if (next > 0) pendingCounts.set(key, next);
        else pendingCounts.delete(key);
      });
      emitPending();
    }

    function settleIdle(error) {
      var waiters = idleWaiters.splice(0);
      waiters.forEach(function (waiter) {
        if (error) waiter.reject(error);
        else waiter.resolve();
      });
    }

    async function drain() {
      if (processing) return;
      processing = true;
      var idleError = null;
      try {
        do {
          while (items.length) {
            var item = items.shift();
            try {
              item.resolve(await options.execute(item.entry));
            } catch (error) {
              item.reject(error);
            } finally {
              changeKeys(item.entry.keys, -1);
            }
          }
          try {
            await options.afterBatch();
            idleError = null;
          } catch (error) {
            idleError = error;
            if (typeof options.onAfterBatchError === 'function') {
              options.onAfterBatchError(error);
            }
          }
        } while (items.length);
      } finally {
        processing = false;
        settleIdle(idleError);
        if (items.length) drain();
      }
    }

    function enqueue(entry) {
      changeKeys(entry.keys, 1);
      return new Promise(function (resolve, reject) {
        items.push({ entry: entry, resolve: resolve, reject: reject });
        drain();
      });
    }

    function whenIdle() {
      if (!processing && items.length === 0) return Promise.resolve();
      return new Promise(function (resolve, reject) {
        idleWaiters.push({ resolve: resolve, reject: reject });
      });
    }

    return Object.freeze({
      enqueue: enqueue,
      isPending: function (key) { return pendingCounts.has(key); },
      whenIdle: whenIdle
    });
  }

  return Object.freeze({ create: create });
});
```

`enqueue` сразу добавляет ключи в pending counts, запускает `drain`, но не запускает второй `drain` параллельно. ошибка отдельного элемента отклоняет только его promise. ошибка итогового чтения отклоняет `whenIdle`, но не меняет результаты уже успешных mutations.

- [ ] **шаг 4: подтвердить unit green**

```bash
node --test test/school-mutation-queue.test.cjs
```

- [ ] **шаг 5: написать падающие controller-тесты optimistic слоёв**

в `test/school-ui.test.cjs` заменить старое ожидание глобального запрета и добавить:

```js
test('loads mutation queue before the school controller', () => {
  const html = read('school.html');
  assert.ok(
    html.indexOf('school-mutation-queue.js') < html.indexOf('school.js'),
    'queue must load before the controller'
  );
});

test('controller keeps a second optimistic drop while the first mutation is pending', async () => {
  const first = deferred();
  const calls = [];
  const controller = createQueueController({
    mutate(command) {
      calls.push(command.lessonId);
      return command.lessonId === 'a' ? first.promise : Promise.resolve({ id: 'b' });
    }
  });

  await controller.load();
  const a = controller.runMutation(moveCommand('a', '10:00'), optimisticMove);
  const b = controller.runMutation(moveCommand('b', '11:00'), optimisticMove);
  assert.deepEqual(controller.getLessons().map((lesson) => lesson.schedule.start.slice(11, 16)), ['10:00', '11:00']);
  first.resolve({ id: 'a' });
  await Promise.all([a, b]);
  await controller.whenMutationsIdle();
  assert.deepEqual(calls, ['a', 'b']);
});

test('failed queued mutation removes only its optimistic layer', async () => {
  const controller = createQueueController({
    mutate(command) {
      return command.lessonId === 'a'
        ? Promise.reject(new Error('failed a'))
        : Promise.resolve({ id: 'b' });
    }
  });

  await controller.load();
  const a = controller.runMutation(moveCommand('a', '10:00'), optimisticMove);
  const b = controller.runMutation(moveCommand('b', '11:00'), optimisticMove);
  await assert.rejects(a, /failed a/);
  await b;
  assert.equal(controller.getLessons().find((lesson) => lesson.id === 'a').schedule.start.slice(11, 16), '09:00');
  assert.equal(controller.getLessons().find((lesson) => lesson.id === 'b').schedule.start.slice(11, 16), '11:00');
});
```

helper `createQueueController` должен передавать реальный `SchoolMutationQueue` в `createController`.

- [ ] **шаг 6: заменить `mutationPending` подтверждённым состоянием и optimistic слоями**

в controller хранить:

```js
var confirmedLessons = [];
var optimisticMutations = [];
var pendingLessonIds = new Set();
```

видимый список строить так:

```js
function rebuildVisibleLessons() {
  lessons = optimisticMutations.reduce(function (items, entry) {
    return entry.reducer(cloneLessons(items));
  }, cloneLessons(confirmedLessons));
  return buildModel();
}
```

создать scheduler через dependency `options.mutationQueue || root.SchoolMutationQueue`:

```js
var mutationSequence = 0;
var queue = queueApi.create({
  async execute(entry) {
    try {
      var result = await api.mutate(entry.command);
      confirmedLessons = entry.reducer(cloneLessons(confirmedLessons));
      optimisticMutations = optimisticMutations.filter(function (item) {
        return item.id !== entry.id;
      });
      rebuildVisibleLessons();
      return result;
    } catch (error) {
      optimisticMutations = optimisticMutations.filter(function (item) {
        return item.id !== entry.id;
      });
      rebuildVisibleLessons();
      throw error;
    }
  },
  async afterBatch() {
    confirmedLessons = await api.listLessons({ week: ACTIVE_WEEK });
    rebuildVisibleLessons();
  },
  onPendingChange(keys) {
    pendingLessonIds = keys;
    if (readModel) buildModel();
  },
  onAfterBatchError() {
    setMutationMessage('Изменения сохранены, но контрольное чтение не удалось.');
  }
});

function runMutation(command, optimisticReducer) {
  var entry = {
    id: 'school-mutation-' + (++mutationSequence),
    keys: affectedLessonIds(command),
    command: command,
    reducer: optimisticReducer
  };
  optimisticMutations.push(entry);
  rebuildVisibleLessons();
  return queue.enqueue(entry);
}
```

при успешной mutation reducer этого entry применяется к `confirmedLessons`, затем удаляется только соответствующий optimistic entry и повторно применяются оставшиеся. это сохраняет ожидаемое состояние, даже если итоговое чтение временно упало, и не зависит от разных форм response у `switchActiveLesson` и `resolveActiveLessons`. при ошибке удаляется только failed entry. в `afterBatch` одно `listLessons` заменяет `confirmedLessons`, после чего повторно накладываются mutations, которые успели прийти во время revalidation. экспортировать controller method `whenMutationsIdle`, делегирующий `queue.whenIdle`.

- [ ] **шаг 7: отметить только сохраняемые карточки**

`affectedLessonIds(command)` возвращает `lessonId`, обе стороны `switchActiveLesson` или все затронутые id `resolveActiveLessons`. render добавляет:

```js
card.classList.toggle('is-saving', pendingLessonIds.has(lesson.id));
card.setAttribute('aria-busy', pendingLessonIds.has(lesson.id) ? 'true' : 'false');
```

сохраняемую карточку не делать draggable. удалить css с глобальным `cursor: progress` и `pointer-events: none`. добавить компактный текст `сохраняется` в signals только для pending-карточки.

- [ ] **шаг 8: подтвердить интеграционный green**

```bash
node --test test/school-mutation-queue.test.cjs test/school-ui.test.cjs test/school-api.test.cjs
```

ожидаемый результат: очередь последовательна, revalidation одна, rollback локальный, api whitelist не изменён.

- [ ] **шаг 9: закоммитить очередь**

```bash
git add school-mutation-queue.js school.html school.js school.css test/school-mutation-queue.test.cjs test/school-ui.test.cjs
git commit -m "ускорить сохранение расписания школы"
```

### задача 4: мгновенный каркас начальной загрузки

**файлы:**

- изменить: `school.html:43-84`
- изменить: `school.js:624-636,1885-1900`
- изменить: `school.css:110-180`
- изменить: `test/school-ui.test.cjs`

**интерфейсы:**

- производит `setLoadingShell(visible, message)`.
- не меняет `SchoolApi.listLessons`.

- [ ] **шаг 1: написать падающие тесты initial shell**

расширить `interactiveDocument` узлами `schoolReady`, `schoolState`, `schoolLoadingSkeleton`, `schoolLoadingText`.

```js
test('shows the school shell before the initial notion read resolves', async () => {
  const pending = deferred();
  const ui = interactiveDocument();
  const controller = SchoolUi.createController({
    api: { listLessons: () => pending.promise },
    core: fakeCore(),
    document: ui.document
  });

  const loading = controller.load();
  assert.equal(ui.nodes.get('schoolReady').hidden, false);
  assert.equal(ui.nodes.get('schoolLoadingSkeleton').hidden, false);
  assert.equal(ui.nodes.get('schoolApp').attributes['aria-busy'], 'true');
  pending.resolve([lesson()]);
  await loading;
  assert.equal(ui.nodes.get('schoolLoadingSkeleton').hidden, true);
  assert.equal(ui.nodes.get('schoolApp').attributes['aria-busy'], 'false');
});

test('replaces the loading shell with a normalized auth error', async () => {
  const ui = interactiveDocument();
  const controller = SchoolUi.createController({
    api: { listLessons: () => Promise.reject(Object.assign(new Error(), { status: 401 })) },
    core: fakeCore(),
    document: ui.document
  });

  await controller.load();
  assert.equal(ui.nodes.get('schoolLoadingSkeleton').hidden, true);
  assert.equal(ui.nodes.get('schoolReady').hidden, true);
  assert.equal(ui.nodes.get('schoolStateTitle').textContent, 'Нужно войти');
});
```

- [ ] **шаг 2: подтвердить red**

```bash
node --test test/school-ui.test.cjs
```

- [ ] **шаг 3: добавить skeleton-каркас**

внутри `schoolReady` добавить `schoolLoadingSkeleton` с тремя нейтральными skeleton-карточками и `schoolLoadingText`. на `loading` показывать `schoolReady` и skeleton, на `ready` скрывать skeleton, на `empty/unauthenticated/forbidden/unavailable` скрывать `schoolReady` и показывать существующий state.

не копировать последние уроки в browser storage и не менять auth timeout.

```html
<section class="school-loading-skeleton" id="schoolLoadingSkeleton" aria-live="polite">
  <span id="schoolLoadingText">Загружаю уроки из notion…</span>
  <div class="school-skeleton-card"></div>
  <div class="school-skeleton-card"></div>
  <div class="school-skeleton-card"></div>
</section>
```

```js
function setLoadingShell(visible, message) {
  var skeleton = byId('schoolLoadingSkeleton');
  var loadingText = byId('schoolLoadingText');
  if (skeleton) skeleton.hidden = !visible;
  if (loadingText) loadingText.textContent = message || 'Загружаю уроки из notion…';
}
```

- [ ] **шаг 4: добавить спокойную анимацию**

css должен использовать opacity pulse, отключённый при `prefers-reduced-motion: reduce`. skeleton не должен менять размеры layout после загрузки.

```css
.school-skeleton-card {
  min-height: 72px;
  border: 1px solid var(--school-line);
  border-radius: 12px;
  background: var(--school-surface);
  animation: school-skeleton-pulse 1.2s ease-in-out infinite alternate;
}
@keyframes school-skeleton-pulse {
  from { opacity: 0.42; }
  to { opacity: 0.78; }
}
@media (prefers-reduced-motion: reduce) {
  .school-skeleton-card { animation: none; }
}
```

- [ ] **шаг 5: подтвердить green**

```bash
node --test test/school-ui.test.cjs test/school-api.test.cjs
```

- [ ] **шаг 6: закоммитить initial shell**

```bash
git add school.html school.js school.css test/school-ui.test.cjs
git commit -m "показать каркас школы до загрузки notion"
```

### задача 5: полная проверка, live smoke и обновление draft pr

**файлы:**

- изменить только regression-тесты школы, если ручная проверка выявила неподтверждённый сценарий из этой спецификации.
- не изменять edge function, notion schema и реальные 18 уроков.

**интерфейсы:**

- потребляет все предыдущие задачи.
- производит проверенный локальный результат и обновлённый draft pr без merge.

- [ ] **шаг 1: прогнать frontend-набор**

```bash
node --test test/school-core.test.cjs test/school-api.test.cjs test/school-mutation-queue.test.cjs test/school-ui.test.cjs
node --test
```

ожидаемый результат: все тесты проходят.

- [ ] **шаг 2: подтвердить отсутствие edge-регрессий**

из `supabase/functions/school-notion`:

```bash
deno task check
deno task lint
deno task test
```

ожидаемый результат: check, lint и все deno tests проходят.

- [ ] **шаг 3: проверить desktop preview**

открыть локальную школу владельцем и подтвердить:

- ×1 → ×1.5 → ×2 → ×3 колесом;
- на ×2 и ×3 preview и drop попадают в `:05`, `:10`, `:15` и далее;
- время под курсором не прыгает при zoom;
- на границе масштаба страница продолжает прокручиваться;
- два разных тестовых урока можно быстро поставить в очередь;
- только сохраняемая карточка показывает pending;
- после idle выполняется одно контрольное чтение;
- reload сохраняет подтверждённое время.

- [ ] **шаг 4: проверить mobile preview**

на ширине 390 px подтвердить:

- кнопки `−/+` доступны и имеют touch target не меньше 44 px;
- пятиминутный масштаб читаем;
- горизонтального overflow нет;
- skeleton не сдвигает нижнюю навигацию.

- [ ] **шаг 5: выполнить безопасный live smoke**

создать только две временные карточки `[тест A] wheel zoom` и `[тест B] очередь сохранения`, выполнить same-day переносы через ×2, дождаться контрольного чтения, подтвердить сохранённые start/end и удалить обе карточки. повторно запросить notion и подтвердить:

- тестовых карточек нет;
- осталось ровно 18 активных уроков;
- распределение предметов осталось 9/2/3/2/1/1;
- реальные уроки не изменялись.

- [ ] **шаг 6: сохранить desktop и mobile screenshots**

сохранить изображения в локальный артефакт проверки, показать пользователю и не менять production до подтверждения.

- [ ] **шаг 7: проверить diff и рабочее дерево**

```bash
git diff --check
git status --short
git log --oneline --decorate -8
```

не добавлять `docs/superpowers/.DS_Store` и `.superpowers/`.

- [ ] **шаг 8: отправить ветку и обновить draft pr**

```bash
git push origin feature/school-dashboard
```

дополнить draft pr #48 подробным русским описанием в нижнем регистре:

- wheel zoom и шаги 15/10/5 минут;
- причина старой задержки source → impact;
- очередь, локальный rollback и одна revalidation;
- initial skeleton без второго source of truth;
- полный список пройденных тестов;
- результаты desktop/mobile и live smoke;
- ссылка на issue #47.

не мержить pr и не публиковать github pages.
