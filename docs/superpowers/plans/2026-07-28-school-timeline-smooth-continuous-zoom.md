# план реализации плавного непрерывного приближения школы

> **для agentic workers:** обязательный sub-skill: использовать `superpowers:subagent-driven-development` или `superpowers:executing-plans` для выполнения плана по задачам. шаги отслеживаются checkbox-отметками.

**цель:** заменить резкие переходы `×1/×1.5/×2/×3` на wheel zoom с шагом `×0.1` и плавным 160-миллисекундным обновлением существующей геометрии.

**архитектура:** чистые функции в `school-core.js` нормализуют scale, wheel accumulator, snap и landmark. `school.js` хранит один animation loop и registry уже созданных dom-узлов; каждый frame обновляет только height/top карточек, линий и подписей, сохраняя anchor под курсором. все пятиминутные линии создаются один раз, а css меняет их opacity по текущему snap.

**стек:** vanilla javascript, requestanimationframe, css, `node:test`.

## глобальные ограничения

- диапазон scale — `1.0–3.0`, wheel step — `0.1`.
- один frame применяет максимум `0.2` накопленного wheel target.
- snap: `1.0–1.2` — 15 минут, `1.3–1.7` — 10 минут, `1.8–3.0` — 5 минут.
- landmark-кнопки: `×1`, `×1.5`, `×2`, `×3`.
- easing длится примерно `160 ms`; reduced motion применяет target сразу.
- wheel zoom не вызывает `buildModel`, mutation, notion read или supabase write.
- магнитный drag-preview и drop используют завершённый target scale.
- реальные уроки и серверная часть не изменяются.
- посторонние `.superpowers/` и `.ds_store` не изменяются.

---

### задача 1: чистая математика continuous zoom

**файлы:**
- изменить: `school-core.js:12-30`
- изменить: `school-core.js:80-105`
- изменить: `school-core.js:380-400`
- тест: `test/school-core.test.cjs:265-315`

**интерфейсы:**
- создаёт: `clampTimelineScale(value) -> number`
- создаёт: `normalizeTimelineScale(value) -> number`
- создаёт: `timelinePixelsPerHour(scale) -> number`
- создаёт: `timelineSnapMinutesForScale(scale) -> 15|10|5`
- создаёт: `timelineZoomLabel(scale) -> string`
- создаёт: `accumulateTimelineWheel(current, delta) -> number`
- создаёт: `consumeTimelineWheel(current) -> { steps, remainder }`
- создаёт: `nextTimelineLandmark(scale, direction) -> number`
- создаёт: `easeOutTimelineZoom(progress) -> number`

- [ ] **шаг 1: написать падающие тесты чистой модели**

```javascript
test('normalizes continuous timeline scale and derives snap thresholds', () => {
  assert.equal(SchoolCore.normalizeTimelineScale('broken'), 1);
  assert.equal(SchoolCore.normalizeTimelineScale(0.4), 1);
  assert.equal(SchoolCore.normalizeTimelineScale(1.26), 1.3);
  assert.equal(SchoolCore.normalizeTimelineScale(4), 3);
  assert.equal(SchoolCore.timelinePixelsPerHour(1.345), 80.7);
  assert.equal(SchoolCore.timelineSnapMinutesForScale(1.2), 15);
  assert.equal(SchoolCore.timelineSnapMinutesForScale(1.3), 10);
  assert.equal(SchoolCore.timelineSnapMinutesForScale(1.7), 10);
  assert.equal(SchoolCore.timelineSnapMinutesForScale(1.8), 5);
  assert.equal(SchoolCore.timelineZoomLabel(1.4), '×1.4 · шаг 10 минут');
});

test('accumulates wheel direction and consumes at most two scale steps', () => {
  assert.equal(SchoolCore.accumulateTimelineWheel(40, -20), -20);
  assert.deepEqual(
    SchoolCore.consumeTimelineWheel(190),
    { steps: 2, remainder: 70 }
  );
  assert.deepEqual(
    SchoolCore.consumeTimelineWheel(-130),
    { steps: -2, remainder: -10 }
  );
});

test('selects landmark buttons and bounded easing', () => {
  assert.equal(SchoolCore.nextTimelineLandmark(1, 1), 1.5);
  assert.equal(SchoolCore.nextTimelineLandmark(1.4, 1), 1.5);
  assert.equal(SchoolCore.nextTimelineLandmark(1.5, -1), 1);
  assert.equal(SchoolCore.nextTimelineLandmark(3, 1), 3);
  assert.equal(SchoolCore.easeOutTimelineZoom(0), 0);
  assert.equal(SchoolCore.easeOutTimelineZoom(1), 1);
  assert.ok(SchoolCore.easeOutTimelineZoom(0.5) > 0.5);
});
```

- [ ] **шаг 2: запустить red**

```bash
node --test --test-name-pattern="continuous timeline scale|accumulates wheel|landmark buttons" test/school-core.test.cjs
```

ожидается `fail`: новые exports отсутствуют.

- [ ] **шаг 3: реализовать минимальные pure helpers**

```javascript
function clampTimelineScale(value) {
  var numeric = Number(value);
  if (!Number.isFinite(numeric)) return 1;
  return Math.max(1, Math.min(3, numeric));
}

function normalizeTimelineScale(value) {
  return Math.round(clampTimelineScale(value) * 10) / 10;
}

function timelinePixelsPerHour(scale) {
  return clampTimelineScale(scale) * 60;
}

function timelineSnapMinutesForScale(scale) {
  var normalized = normalizeTimelineScale(scale);
  if (normalized >= 1.8) return 5;
  if (normalized >= 1.3) return 10;
  return 15;
}

function accumulateTimelineWheel(current, delta) {
  var previous = Number(current) || 0;
  var next = Number(delta) || 0;
  if (previous && next && Math.sign(previous) !== Math.sign(next)) return next;
  return previous + next;
}

function consumeTimelineWheel(current) {
  var value = Number(current) || 0;
  var direction = Math.sign(value);
  var steps = direction * Math.min(2, Math.floor(Math.abs(value) / 60));
  return { steps: steps, remainder: value - steps * 60 };
}
```

добавить literal landmark `[1, 1.5, 2, 3]`, label и cubic ease-out, затем
экспортировать все функции.

- [ ] **шаг 4: запустить green и весь core**

```bash
node --test --test-name-pattern="continuous timeline scale|accumulates wheel|landmark buttons" test/school-core.test.cjs
node --test test/school-core.test.cjs
```

ожидается `pass`.

- [ ] **шаг 5: закоммитить pure model**

```bash
git add school-core.js test/school-core.test.cjs
git commit -m "добавить модель плавного приближения школы"
```

---

### задача 2: registry и обновление геометрии без rendering

**файлы:**
- изменить: `school.js:370-470`
- изменить: `school.js:930-1070`
- изменить: `school.css:595-625`
- тест: `test/school-ui.test.cjs:320-455`

**интерфейсы:**
- использует: `timelinePixelsPerHour`, `timelineSnapMinutesForScale`
- создаёт: `applyTimelineGeometry(core, registry, scale) -> { pixelsPerHour, snapMinutes, height }`
- registry: `{ shell, columns, startMinute, endMinute, labels, lines, cards }`
- line entry: `{ node, minute }`
- card entry: `{ node, startMinute, visualEndMinute }`

- [ ] **шаг 1: написать падающий behavior-тест registry**

```javascript
test('applies continuous geometry to existing timeline nodes without rebuilding them', () => {
  const styleNode = () => ({ style: {}, setAttribute(name, value) { this[name] = String(value); } });
  const registry = {
    shell: styleNode(),
    columns: styleNode(),
    startMinute: 9 * 60,
    endMinute: 20 * 60,
    labels: [{ node: styleNode(), minute: 10 * 60 }],
    lines: [{ node: styleNode(), minute: 9 * 60 + 30 }],
    cards: [{ node: styleNode(), startMinute: 14 * 60, visualEndMinute: 14 * 60 + 45 }]
  };

  const result = SchoolUi.applyTimelineGeometry(SchoolCore, registry, 1.4);

  assert.deepEqual(result, { pixelsPerHour: 84, snapMinutes: 10, height: 924 });
  assert.equal(registry.labels[0].node.style.top, '84px');
  assert.equal(registry.lines[0].node.style.top, '42px');
  assert.equal(registry.cards[0].node.style.top, '420px');
  assert.equal(registry.cards[0].node.style.height, '63px');
  assert.equal(registry.shell['data-school-snap'], '10');
});
```

- [ ] **шаг 2: запустить red**

```bash
node --test --test-name-pattern="applies continuous geometry" test/school-ui.test.cjs
```

ожидается `fail`: `applyTimelineGeometry` отсутствует.

- [ ] **шаг 3: реализовать helper и registry**

`applyTimelineGeometry` вычисляет density, задаёт
`--school-time-height`, обновляет top/height всех entries и
`data-school-snap`.

в `renderWeek`:

- создавать линии каждые 5 минут;
- присваивать линии классы `is-hour`, `is-half`, `is-quarter`, `is-ten`,
  `is-five`;
- сохранять node/minute в registry;
- сохранять start/visualEnd timed-карточек;
- после построения вызвать `applyTimelineGeometry` с текущим scale.

- [ ] **шаг 4: добавить css density**

```css
.school-time-line { opacity: 0; transition: opacity 120ms ease; }
.school-time-shell[data-school-snap="15"] .school-time-line.is-hour,
.school-time-shell[data-school-snap="15"] .school-time-line.is-half,
.school-time-shell[data-school-snap="15"] .school-time-line.is-quarter { opacity: 1; }
.school-time-shell[data-school-snap="10"] .school-time-line.is-hour,
.school-time-shell[data-school-snap="10"] .school-time-line.is-half,
.school-time-shell[data-school-snap="10"] .school-time-line.is-ten { opacity: 1; }
.school-time-shell[data-school-snap="5"] .school-time-line { opacity: 1; }
```

часовые линии остаются сильнее остальных через border color, а при
`prefers-reduced-motion: reduce` opacity transition отключается.

- [ ] **шаг 5: запустить ui green**

```bash
node --test --test-name-pattern="applies continuous geometry|timeline drag preview|short lesson cards" test/school-ui.test.cjs
node --test test/school-ui.test.cjs
```

ожидается `pass`.

- [ ] **шаг 6: закоммитить in-place geometry**

```bash
git add school.js school.css test/school-ui.test.cjs
git commit -m "обновлять геометрию школы без полной перерисовки"
```

---

### задача 3: один animation loop для wheel и кнопок

**файлы:**
- изменить: `school.js:640-670`
- изменить: `school.js:1210-1340`
- изменить: `school.js:1695-1745`
- тест: `test/school-ui.test.cjs:448-535`

**интерфейсы:**
- использует: core wheel helpers, easing, landmark и `applyTimelineGeometry`
- controller хранит: `timelineScale`, `timelineTargetScale`, `timelineWheelAccumulator`, `timelineZoomFrame`, `timelineAnimationStartScale`, `timelineAnimationStartedAt`, `timelineZoomAnchor`
- создаёт controller methods для тестов: `finishTimelineZoom`, `getTimelineZoomState`

- [ ] **шаг 1: заменить старый тест падающим тестом animation loop**

тестовый runtime хранит callbacks `requestAnimationFrame`, timestamps,
`scrollBy` и `matchMedia`.

проверить:

```javascript
const wheel = makeWheel(-60);
controller.handleTimelineWheel(wheel, shell, bounds);
assert.equal(wheel.prevented, true);
assert.equal(frames.size, 1);

runFrame(0);
runFrame(80);
const middle = controller.getTimelineZoomState();
assert.ok(middle.currentScale > 1 && middle.currentScale < 1.1);
assert.equal(middle.targetScale, 1.1);

runFrame(160);
assert.equal(controller.getTimelineZoomState().currentScale, 1.1);
assert.equal(buildModelCalls, 0);
assert.equal(mutationCalls, 0);
assert.equal(frames.size, 0);
```

отдельно проверить:

- два wheel events до frame оставляют один callback;
- outward wheel на `×1` не вызывает preventdefault;
- `matchMedia('(prefers-reduced-motion: reduce)')` применяет `1.1` сразу;
- `finishTimelineZoom()` синхронно применяет target перед dragstart;
- anchor вызывает `scrollBy` на промежуточном и финальном frame.

- [ ] **шаг 2: запустить red**

```bash
node --test --test-name-pattern="continuous wheel zoom|reduced motion|finishes zoom before drag" test/school-ui.test.cjs
```

ожидается `fail`: controller ещё использует index и полный `buildModel`.

- [ ] **шаг 3: реализовать единый raf loop**

`handleTimelineWheel`:

1. не работает при активном drag;
2. нормализует `deltaY` по `deltaMode`;
3. не перехватывает outward scroll на границе;
4. сохраняет anchor и добавляет `-delta` в accumulator;
5. вызывает `requestTimelineZoomFrame`.

frame:

1. потребляет максимум два шага;
2. retarget начинает новую 160-миллисекундную интерполяцию от current scale;
3. применяет eased scale через `applyTimelineGeometry`;
4. после каждого применения восстанавливает anchor;
5. планирует следующий frame только при незавершённой анимации или полном
   wheel step в accumulator.

- [ ] **шаг 4: перевести кнопки и drag**

- кнопки используют `nextTimelineLandmark`;
- label показывает target с одним знаком;
- disabled определяется границами target;
- `configureDraggable` вызывает `finishTimelineZoom()` до установки
  `draggedLessonId`;
- `timelineDestination` получает pixels/snap завершённого target;
- старые `timelineZoomIndex`, `setTimelineZoom`, `restoreTimelineAnchor` и
  css transition top/height удаляются.

- [ ] **шаг 5: запустить green и ui suite**

```bash
node --test --test-name-pattern="continuous wheel zoom|reduced motion|finishes zoom before drag" test/school-ui.test.cjs
node --test test/school-ui.test.cjs
```

ожидается `pass`.

- [ ] **шаг 6: закоммитить animation loop**

```bash
git add school.js test/school-ui.test.cjs
git commit -m "сделать приближение школы плавным"
```

---

### задача 4: cache-busting, полная проверка и pr

**файлы:**
- изменить: `school.html:12-20`
- изменить: `test/school-ui.test.cjs:275-290`

**интерфейсы:**
- использует: готовый continuous zoom
- создаёт: загрузку новых `school-core.js`, `school.js` и `school.css`

- [ ] **шаг 1: написать падающий cache-тест**

```javascript
test('school page cache-busts continuous zoom assets together', () => {
  const html = read('school.html');
  assert.ok(html.includes('school-core.js?v=5'));
  assert.ok(html.includes('school.css?v=8'));
  assert.ok(html.includes('school.js?v=8'));
});
```

- [ ] **шаг 2: запустить red и поднять версии**

```bash
node --test --test-name-pattern="cache-busts continuous zoom" test/school-ui.test.cjs
```

после подтверждённого `fail` изменить только три asset url и повторить тест.

- [ ] **шаг 3: полная локальная проверка**

```bash
node --check school-core.js
node --check school.js
node --test
git diff --check
```

ожидается весь suite без failures.

- [ ] **шаг 4: desktop qa без mutations**

на `http://127.0.0.1:8765/school.html?qa=smooth-zoom#`:

- wheel медленно проходит `×1.0 → ×1.1 → ×1.2`;
- быстрый trackpad догоняет target без нескольких animation loops;
- anchor не уплывает;
- линии меняют density на `×1.3` и `×1.8`;
- кнопки выбирают landmarks;
- после zoom magnetic preview использует правильный snap;
- console errors отсутствуют;
- счётчик остаётся `0 из 18`, реальные уроки не изменяются.

- [ ] **шаг 5: закоммитить cache-bump**

```bash
git add school.html test/school-ui.test.cjs
git commit -m "обновить версии плавного приближения школы"
```

- [ ] **шаг 6: push и обновление draft pr**

```bash
git push origin feature/school-dashboard
```

добавить в существующий draft pr подробное описание алгоритма, влияния,
результатов тестов и ссылки на issue. merge и deployment не выполнять.
