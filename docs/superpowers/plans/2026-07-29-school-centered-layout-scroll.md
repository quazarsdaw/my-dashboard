# Central School Layout and Timeline Scroll Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** центрировать страницу школы в области шириной до `1100 px` и перенести длинную временную сетку в отдельный вертикальный viewport без поломки zoom, drag-and-drop и мобильного режима.

**Architecture:** статические заголовки недели и зона «без времени» остаются непосредственными дочерними элементами `.school-week-shell`, а существующий `.school-time-shell` получает единственную новую обёртку `.school-time-scroll`. Геометрия таймлайна не меняется; zoom сохраняет точку под курсором изменением `scrollTop` внутреннего viewport вместо `window.scrollBy`.

**Tech Stack:** статические html/css, javascript без сборщика, node test runner, локальный http preview, browser visual qa.

## Global Constraints

- основная область школы на desktop ограничена `1100 px` и центрирована.
- высота внутреннего временного viewport на desktop/tablet равна `clamp(520px, 68dvh, 760px)`.
- `.school-week-head` и `.school-all-day-grid` находятся вне вертикально прокручиваемого viewport.
- при ширине до `620 px` вложенная вертикальная прокрутка отключается и сохраняется обычный document scroll.
- `.topbar`, `.bottombar` и другие страницы дашборда не изменяются.
- zoom корректирует только `schoolTimeScroll.scrollTop`; `window.scrollBy` для timeline anchor не используется.
- drag snap, preview, mutation queue, статусы и счётчик переносов не меняются.
- edge function, supabase, notion schema и реальные 18 уроков не изменяются.
- новые зависимости не добавляются.
- visual qa выполняется read-only: не переносить и не изменять реальные уроки.
- весь текст github и commit messages — на русском языке, с маленькой буквы, без co-author.
- PR открывается отдельно на `main`, остаётся без merge и закрывает issue #56 только после merge.

---

## File Structure

- `school.css` — владеет шириной страницы, desktop/tablet scroll viewport, quiet scrollbar и mobile override.
- `school.js` — создаёт `.school-time-scroll`, вычисляет видимый центр таймлайна и восстанавливает zoom anchor через внутренний `scrollTop`.
- `school.html` — меняет только cache version файлов `school.css` и `school.js`.
- `test/school-ui.test.cjs` — содержит source-contract и behavioral regression tests layout/zoom.
- `docs/superpowers/specs/2026-07-29-school-centered-layout-scroll-design.md` — утверждённая спецификация, не меняется без нового решения пользователя.

---

### Task 1: Центральный контейнер и внутренний scroll-shell

**Files:**
- Modify: `test/school-ui.test.cjs:629-653`
- Modify: `school.css:63-66`
- Modify: `school.css:524-677`
- Modify: `school.css:1150-1230`
- Modify: `school.js:1156-1284`

**Interfaces:**
- Consumes: существующие `.school-week-shell`, `.school-week-head`, `.school-all-day-grid`, `.school-time-shell`.
- Produces: dom-узел `div.school-time-scroll#schoolTimeScroll`, содержащий только `.school-time-shell`.
- Produces: css-контракт desktop/tablet internal scroll и mobile natural document scroll.

- [ ] **Step 1: Write the failing layout regression tests**

Добавить рядом с существующим тестом `school layout keeps mobile targets accessible and document overflow contained`:

```js
test('school centers the desktop page and scrolls only the timed week grid', () => {
  const css = read('school.css');
  const source = read('school.js');
  const headAppend = source.indexOf('shell.appendChild(head)');
  const allDayAppend = source.indexOf('shell.appendChild(allDayGrid)');
  const scrollCreate = source.indexOf(
    "var timeScroll = element(documentRef, 'div', 'school-time-scroll')"
  );
  const scrollAppend = source.indexOf('timeScroll.appendChild(timeShell)');
  const shellAppend = source.indexOf('shell.appendChild(timeScroll)');

  assert.match(
    css,
    /\.school-page\s*\{[^}]*width:\s*min\(1100px,\s*100%\)/s
  );
  assert.match(
    css,
    /\.school-time-scroll\s*\{[^}]*height:\s*clamp\(520px,\s*68dvh,\s*760px\)[^}]*overflow-y:\s*auto/s
  );
  assert.ok(scrollCreate !== -1);
  assert.ok(headAppend < scrollCreate, 'day headings stay outside the scroll viewport');
  assert.ok(allDayAppend < scrollCreate, 'all-day lessons stay outside the scroll viewport');
  assert.ok(scrollCreate < scrollAppend);
  assert.ok(scrollAppend < shellAppend);
});

test('school timeline returns to document scrolling on mobile', () => {
  const css = read('school.css');
  const mobile = css.slice(css.indexOf('@media (max-width: 620px)'));

  assert.match(
    mobile,
    /\.school-time-scroll\s*\{[^}]*height:\s*auto[^}]*overflow-y:\s*visible/s
  );
});
```

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```bash
node --test --test-name-pattern='school centers|returns to document scrolling' test/school-ui.test.cjs
```

Expected: FAIL because `.school-page` still uses `1720px` and `.school-time-scroll` does not exist.

- [ ] **Step 3: Add the minimal scroll wrapper in `renderWeek`**

В `school.js`, сразу перед созданием `timeShell`, создать wrapper:

```js
var timeScroll = element(documentRef, 'div', 'school-time-scroll');
timeScroll.id = 'schoolTimeScroll';
var timeShell = element(documentRef, 'div', 'school-time-shell');
timeShell.id = 'schoolTimeShell';
```

В конце построения таймлайна заменить:

```js
shell.appendChild(timeShell);
```

на:

```js
timeScroll.appendChild(timeShell);
shell.appendChild(timeScroll);
```

Не переносить в `timeScroll`:

- `school-week-head`;
- `school-all-day-label`;
- `school-all-day-grid`.

- [ ] **Step 4: Implement the desktop/tablet layout contract**

В `school.css` заменить ширину:

```css
.school-page {
  width: min(1100px, 100%);
  margin: 0 auto;
  padding: 16px 14px 24px;
}
```

Добавить перед `.school-time-shell`:

```css
.school-time-scroll {
  width: 100%;
  min-width: 0;
  height: clamp(520px, 68dvh, 760px);
  overflow-x: hidden;
  overflow-y: auto;
  overscroll-behavior-y: contain;
  scrollbar-color: rgba(125, 131, 145, 0.58) transparent;
  scrollbar-gutter: stable;
  scrollbar-width: thin;
}

.school-time-scroll::-webkit-scrollbar {
  width: 9px;
}

.school-time-scroll::-webkit-scrollbar-track {
  background: transparent;
}

.school-time-scroll::-webkit-scrollbar-thumb {
  min-height: 48px;
  border: 2px solid transparent;
  border-radius: 999px;
  background: rgba(125, 131, 145, 0.58);
  background-clip: padding-box;
}

.school-time-scroll:hover::-webkit-scrollbar-thumb,
.school-time-scroll:focus-within::-webkit-scrollbar-thumb {
  background: rgba(145, 152, 166, 0.72);
  background-clip: padding-box;
}
```

Внутри существующего `@media (max-width: 620px)` добавить:

```css
.school-time-scroll {
  height: auto;
  overflow-y: visible;
  overscroll-behavior-y: auto;
  scrollbar-gutter: auto;
}
```

Не добавлять `max-height` к `.school-week-shell`: ограничителем должна быть
только `.school-time-scroll`.

- [ ] **Step 5: Run layout regressions and the complete school ui suite**

Run:

```bash
node --test --test-name-pattern='school centers|returns to document scrolling' test/school-ui.test.cjs
node --test test/school-ui.test.cjs
```

Expected:

- new tests PASS;
- all existing `school-ui` tests PASS;
- no test expects a changed timeline height or snap value.

- [ ] **Step 6: Review and commit Task 1**

Run:

```bash
git diff --check
git diff -- school.css school.js test/school-ui.test.cjs
git status --short
```

Confirm only the three Task 1 files changed, then:

```bash
git add school.css school.js test/school-ui.test.cjs
git commit -m "сузить школу и добавить прокрутку расписания"
```

---

### Task 2: Zoom-anchor внутри scroll viewport

**Files:**
- Modify: `test/school-ui.test.cjs:482-627`
- Modify: `school.js:1389-1582`
- Modify: `school.js:2799-2827`

**Interfaces:**
- Consumes: `#schoolTimeScroll`, `#schoolTimeShell`, `anchor.minute`, `anchor.clientY`, `anchor.bounds`.
- Produces: `visibleTimelineClientY(timeRect, viewportRect) -> number`.
- Produces: `restoreTimelineAnchor(anchor)` that mutates only `schoolTimeScroll.scrollTop`.
- Produces: exported `SchoolUi.visibleTimelineClientY` for deterministic unit tests.

- [ ] **Step 1: Replace the window-scroll zoom test with an internal-scroll regression**

В тесте `small wheel deltas accumulate into a smooth cursor-anchored zoom`
заменить `runtime.scrollBy`-модель на внутренний viewport:

```js
let nextFrame = 0;
const frames = new Map();
let windowScrollCalls = 0;
const viewport = {
  scrollTop: 100,
  getBoundingClientRect() {
    return { top: 10, bottom: 610, height: 600 };
  }
};
const shell = {
  classList: { add() {}, remove() {} },
  getBoundingClientRect() {
    const top = 10 - viewport.scrollTop;
    return { top, bottom: top + 660, height: 660 };
  }
};
const runtime = {
  requestAnimationFrame(callback) {
    const id = ++nextFrame;
    frames.set(id, callback);
    return id;
  },
  cancelAnimationFrame(id) {
    frames.delete(id);
  },
  scrollBy() {
    windowScrollCalls += 1;
  }
};
const document = {
  getElementById(id) {
    if (id === 'schoolTimeShell') return shell;
    if (id === 'schoolTimeScroll') return viewport;
    return null;
  }
};
```

Сохранить существующие wheel assertions, а финальное assertion заменить:

```js
assert.ok(Math.abs(viewport.scrollTop - 116) < 0.001);
assert.equal(windowScrollCalls, 0);
```

Начальные `100 px` scroll и `clientY = 70` соответствуют anchor на `160`
минутах от начала шкалы. При переходе `60 -> 66 px/hour` нужная компенсация
равна `16 px`.

- [ ] **Step 2: Add a failing pure test for the button zoom viewport**

Добавить перед behavioral zoom tests:

```js
test('timeline button zoom centers the visible part of the internal viewport', () => {
  assert.equal(
    SchoolUi.visibleTimelineClientY(
      { top: -100, bottom: 680, height: 780 },
      { top: 100, bottom: 500, height: 400 }
    ),
    300
  );
  assert.equal(
    SchoolUi.visibleTimelineClientY(
      { top: 700, bottom: 1480, height: 780 },
      { top: 100, bottom: 500, height: 400 }
    ),
    1090
  );
});
```

Первый case использует центр пересечения `100..500`. Второй case не имеет
пересечения и безопасно возвращает центр полного time shell.

- [ ] **Step 3: Run zoom tests and verify RED**

Run:

```bash
node --test --test-name-pattern='small wheel|timeline button zoom|reduced motion' test/school-ui.test.cjs
```

Expected:

- `visibleTimelineClientY is not a function`;
- wheel test не меняет `viewport.scrollTop`, потому что production code ещё
  вызывает `runtime.scrollBy`.

- [ ] **Step 4: Add the pure visible-center helper**

Разместить рядом с существующими timeline helpers верхнего уровня:

```js
function visibleTimelineClientY(timeRect, viewportRect) {
  if (!timeRect) return null;
  if (!viewportRect) {
    return timeRect.top + Math.max(0, Number(timeRect.height) || 0) / 2;
  }
  var visibleTop = Math.max(timeRect.top, viewportRect.top);
  var visibleBottom = Math.min(timeRect.bottom, viewportRect.bottom);
  if (visibleBottom > visibleTop) return (visibleTop + visibleBottom) / 2;
  return timeRect.top + Math.max(0, Number(timeRect.height) || 0) / 2;
}
```

Добавить в финальный public export:

```js
visibleTimelineClientY: visibleTimelineClientY
```

- [ ] **Step 5: Restore zoom anchor through `scrollTop`**

Заменить `restoreTimelineAnchor`:

```js
function restoreTimelineAnchor(anchor) {
  if (!anchor) return;
  var shell = byId('schoolTimeShell');
  var viewport = byId('schoolTimeScroll');
  if (
    !shell ||
    !viewport ||
    typeof shell.getBoundingClientRect !== 'function'
  ) return;
  var rect = shell.getBoundingClientRect();
  var nextY = core.timelineYForMinute(
    anchor.minute,
    anchor.bounds.startHour * 60,
    core.timelinePixelsPerHour(timelineScale)
  );
  var delta = rect.top + nextY - anchor.clientY;
  if (Math.abs(delta) > 0.001) {
    viewport.scrollTop = (Number(viewport.scrollTop) || 0) + delta;
  }
}
```

Не оставлять fallback на `runtime.scrollBy`: новый dom-контракт всегда
создаёт viewport, а отсутствие узла должно завершать операцию без page jump.

- [ ] **Step 6: Use the viewport intersection for button zoom**

В `zoomTimelineFromButton` заменить расчёт `visibleTop/visibleBottom`:

```js
var rect = timeShell.getBoundingClientRect();
var viewport = byId('schoolTimeScroll');
var viewportRect = viewport && typeof viewport.getBoundingClientRect === 'function'
  ? viewport.getBoundingClientRect()
  : null;
if (!viewportRect) {
  var viewportHeight = runtime && Number.isFinite(runtime.innerHeight)
    ? runtime.innerHeight
    : rect.bottom;
  viewportRect = { top: 0, bottom: viewportHeight, height: viewportHeight };
}
var clientY = visibleTimelineClientY(rect, viewportRect);
```

Если helper вернул `null`, передать `null` anchor:

```js
setTimelineZoomTarget(
  nextScale,
  clientY === null ? null : createTimelineAnchor(timeShell, bounds, clientY)
);
```

- [ ] **Step 7: Make reduced-motion coverage use the same viewport contract**

В существующем тесте `reduced motion applies zoom immediately and drag
finalization cancels animation` добавить `schoolTimeScroll` в fake document:

```js
const viewport = {
  scrollTop: 100,
  getBoundingClientRect() {
    return { top: 10, bottom: 610, height: 600 };
  }
};
const document = {
  getElementById(id) {
    if (id === 'schoolTimeShell') return shell;
    if (id === 'schoolTimeScroll') return viewport;
    return null;
  }
};
```

Перед reduced-motion веткой вернуть `viewport.scrollTop = 100`. После
немедленного zoom проверить:

```js
assert.ok(viewport.scrollTop > 100);
```

`runtime.scrollBy` оставить как throwing spy:

```js
scrollBy() {
  throw new Error('timeline zoom must not scroll the window');
}
```

- [ ] **Step 8: Run focused and full frontend tests**

Run:

```bash
node --test --test-name-pattern='small wheel|timeline button zoom|reduced motion|timeline drag preview|drop reuses' test/school-ui.test.cjs
node --test test/school-ui.test.cjs
node --test
```

Expected:

- all focused tests PASS;
- all `school-ui` tests PASS;
- full suite remains at least the baseline `305` passing tests with zero
  failures.

- [ ] **Step 9: Review and commit Task 2**

Run:

```bash
git diff --check
git diff HEAD^ -- school.js test/school-ui.test.cjs
git status --short
```

Confirm:

- `window.scrollBy` no longer appears in timeline anchor production code;
- `viewport.scrollTop` is the only zoom compensation sink;
- drag destination functions are unchanged.

Commit:

```bash
git add school.js test/school-ui.test.cjs
git commit -m "удерживать время внутри прокрутки календаря"
```

---

### Task 3: Cache contract and visual QA

**Files:**
- Modify: `test/school-ui.test.cjs:280-285`
- Modify: `school.html:12-20`
- Create outside git: `/private/tmp/school-layout-scroll-qa/desktop-week-top-1440x900.png`
- Create outside git: `/private/tmp/school-layout-scroll-qa/desktop-week-scrolled-1440x900.png`
- Create outside git: `/private/tmp/school-layout-scroll-qa/mobile-week-top-390x844.png`
- Create outside git: `/private/tmp/school-layout-scroll-qa/mobile-week-scrolled-390x844.png`

**Interfaces:**
- Consumes: finalized `school.css` and `school.js`.
- Produces: matching cache version `v=10` for both changed assets.
- Produces: read-only visual evidence for desktop and mobile.

- [ ] **Step 1: Write the failing cache-version regression**

Изменить существующий тест:

```js
test('school page cache-busts release candidate assets together', () => {
  const html = read('school.html');
  assert.ok(html.includes('school-core.js?v=6'));
  assert.ok(html.includes('school.css?v=10'));
  assert.ok(html.includes('school.js?v=10'));
});
```

- [ ] **Step 2: Run the cache test and verify RED**

Run:

```bash
node --test --test-name-pattern='cache-busts release candidate assets together' test/school-ui.test.cjs
```

Expected: FAIL because html still uses `school.css?v=9` and `school.js?v=9`.

- [ ] **Step 3: Bump only changed school assets**

В `school.html` установить:

```html
<link rel="stylesheet" href="school.css?v=10">
```

и:

```html
<script src="school.js?v=10" defer></script>
```

Не менять версии `school-core.js`, `school-api.js`,
`school-mutation-queue.js`, shared theme или navigation.

- [ ] **Step 4: Run the focused test and commit cache contract**

Run:

```bash
node --test --test-name-pattern='cache-busts release candidate assets together' test/school-ui.test.cjs
git diff --check
```

Expected: PASS.

Commit:

```bash
git add school.html test/school-ui.test.cjs
git commit -m "обновить версии ресурсов школы"
```

- [ ] **Step 5: Start a local production-equivalent static preview**

Run in the repository root:

```bash
python3 -m http.server 8765 --bind 127.0.0.1
```

Open:

```text
http://127.0.0.1:8765/school.html
```

Use the existing authenticated dashboard session. Do not expose access tokens
in screenshots, logs or URLs shown to the user.

- [ ] **Step 6: Perform read-only desktop QA at `1440×900`**

Check:

1. school content is centered at approximately the same width as home/tracker;
2. topbar and bottombar remain full inset width;
3. day headings and «без времени» stay visible while hours scroll internally;
4. the document does not grow to the full zoomed timeline height;
5. wheel zoom keeps the minute under the cursor and does not move the page;
6. `−` and `+` use the visible center of the internal viewport;
7. scroll to late hours works with mouse wheel and trackpad;
8. start a drag near a viewport edge, observe native internal autoscroll, then
   cancel without drop and confirm that no mutation request was sent;
9. if loaded data contains overlap lanes, two or three lessons remain
   readable; otherwise rely on the existing deterministic overlap regression
   and do not create or move a real lesson for the screenshot;
10. browser console has no new errors.

Do not drop or mutate real lesson cards. Verify drag geometry only through the
already covered automated tests.

Save:

```text
/private/tmp/school-layout-scroll-qa/desktop-week-top-1440x900.png
/private/tmp/school-layout-scroll-qa/desktop-week-scrolled-1440x900.png
```

- [ ] **Step 7: Perform read-only mobile QA at `390×844`**

Check:

1. only the selected day is displayed;
2. day picker remains horizontally scrollable;
3. time grid uses document scroll rather than a trapped nested vertical scroll;
4. page has no horizontal overflow;
5. zoom buttons and lesson open controls remain usable;
6. bottom navigation does not cover the last useful content;
7. browser console has no new errors.

Save:

```text
/private/tmp/school-layout-scroll-qa/mobile-week-top-390x844.png
/private/tmp/school-layout-scroll-qa/mobile-week-scrolled-390x844.png
```

- [ ] **Step 8: Show all four screenshots to the user**

Render the four absolute paths in the Codex response. Report any visual
limitation explicitly. Do not claim desktop/mobile approval until the user
has seen the screenshots.

---

### Task 4: Final verification and draft PR

**Files:**
- Verify: `docs/superpowers/specs/2026-07-29-school-centered-layout-scroll-design.md`
- Verify: `docs/superpowers/plans/2026-07-29-school-centered-layout-scroll.md`
- Verify: `school.css`
- Verify: `school.js`
- Verify: `school.html`
- Verify: `test/school-ui.test.cjs`

**Interfaces:**
- Consumes: Tasks 1–3 and user-visible screenshots.
- Produces: one clean branch and one detailed draft PR to `main`.

- [ ] **Step 1: Run the final automated verification**

Run:

```bash
node --test test/school-ui.test.cjs
node --test
node --check school.js
git diff --check origin/main...HEAD
```

Expected:

- `school-ui` suite PASS;
- full suite has zero failures;
- javascript syntax PASS;
- diff check produces no output.

- [ ] **Step 2: Verify scope and repository hygiene**

Run:

```bash
git diff --name-only origin/main...HEAD
git status --short --branch
git log --oneline --decorate origin/main..HEAD
git grep -nE 'NOTION_TOKEN|SUPABASE_SERVICE_ROLE_KEY|SCHOOL_OWNER_USER_ID' -- \
  school.html school.css school.js test docs || true
```

Expected changed tracked files:

```text
docs/superpowers/plans/2026-07-29-school-centered-layout-scroll.md
docs/superpowers/specs/2026-07-29-school-centered-layout-scroll-design.md
school.css
school.html
school.js
test/school-ui.test.cjs
```

Confirm:

- no screenshot is tracked;
- no secret value is present;
- no backend, migration, notion data or unrelated page changed;
- working tree is clean.

- [ ] **Step 3: Push the isolated branch**

Run:

```bash
git push -u origin fix/school-layout-scroll
```

Expected: branch is published without modifying `main`.

- [ ] **Step 4: Open a detailed draft PR**

Run:

```bash
gh pr create \
  --draft \
  --base main \
  --head fix/school-layout-scroll \
  --title "сузить школу и локализовать прокрутку расписания" \
  --body "## что сделано

- основная область школы выровнена с главной и трекером по ширине 1100 px
- временная сетка перенесена во внутренний вертикальный viewport
- заголовки дней и зона «без времени» остаются видимыми над часами
- zoom сохраняет время под курсором через внутренний scrolltop и не двигает страницу
- мобильный однодневный режим сохраняет обычную прокрутку документа
- версии изменённых школьных ресурсов обновлены согласованно

## почему это важно

раньше недельный календарь занимал почти всю ширину экрана и увеличивал высоту всего документа от ранних до поздних часов. это выбивалось из общей композиции дашборда и усложняло навигацию, масштабирование и просмотр расписания.

## влияние на проект

изменение касается только frontend-компоновки школы. notion, supabase, авторизация, реальные уроки, mutation queue и бизнес-правила не меняются. общие верхняя и нижняя панели также не затрагиваются.

## проверки

- node school ui tests: пройдено
- полный node test suite: пройдено
- node syntax check: пройдено
- desktop 1440×900 visual qa: пройдено
- mobile 390×844 visual qa: пройдено
- секреты и посторонние файлы в diff: отсутствуют

closes #56"
```

Не добавлять co-author и не переводить PR в ready автоматически.

- [ ] **Step 5: Verify the published PR**

Run:

```bash
gh pr view --json number,state,isDraft,baseRefName,headRefName,title,body,url
gh pr checks
```

Expected:

- state `open`;
- `isDraft: true`;
- base `main`;
- head `fix/school-layout-scroll`;
- title and body are Russian, lowercase and detailed;
- no merge action is performed.

- [ ] **Step 6: Final report**

Report:

- issue #56 link;
- branch and commit list;
- draft PR link;
- exact test counts;
- desktop/mobile screenshot paths;
- any CI check still pending;
- explicit statement that PR was not merged and real lessons were not changed.
