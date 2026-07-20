# план реализации отметок и навигации готовки

> **для агентных исполнителей:** обязательный навык при выполнении — `superpowers:executing-plans`. каждый блок выполняется последовательно через red-green-refactor.

**цель:** унифицировать отметки меню с главной, повысить читаемость календаря и добавить видимый ход активной готовки с безопасным возвратом последнего шага.

**архитектура:** общий фабричный helper в `nutrition.js` создаёт доступную отметку для рациона и закупки, а `menu.html` содержит локальную копию визуального паттерна главной без связи между страницами через css-классы. чистая функция `reopenLastResolvedStep` в `nutrition-cooking-core.js` проверяет инварианты сессии и возвращает новую копию; контроллер только сохраняет успешный результат и строит историю из существующих `actions` и `steps`.

**стек:** статические html/css, javascript es5-совместимого стиля проекта, `node:test`, локальное gamification storage, playwright для визуальной проверки.

**issues:** `#42` — отметки и читаемость меню; `#43` — история и возврат шага готовки.

## общие ограничения

- не добавлять зависимости и не менять формат сохранённых сессий;
- чекбокс повторяет паттерн `.goal-cb` главной: 22 px, скругление 7 px, зелёное свечение и `cbPop`;
- размер названия блюда в календаре — 15 px;
- не добавлять большие цветные заливки календаря;
- откатывать только последний завершённый или пропущенный шаг незавершённой сессии;
- не мержить pr без approve пользователя;
- весь текст github — на русском языке, с маленькой буквы.

---

### задача 1: унифицировать отметки и повысить читаемость календаря

**файлы:**

- изменить: `test/nutrition-ui.test.cjs`
- изменить: `nutrition.js:601-650`
- изменить: `nutrition.js:965-1021`
- изменить: `menu.html:94-170`
- изменить: `menu.html:250-260`

**интерфейсы:**

- создаёт `createCompletionCheck(className, ariaLabel, checked, onChange) -> { root, input }`;
- потребители: `createMealRow` и `renderShopping`;
- сохранение продолжает использовать `state.completions`, `state.shoppingChecks` и `saveState()`.

- [ ] **шаг 1: добавить падающий source-тест общего контрола и утверждённых стилей**

добавить в `test/nutrition-ui.test.cjs`:

```js
test('nutrition uses the dashboard completion control on the left of meals and shopping rows', () => {
  const html = read('menu.html');
  const js = read('nutrition.js');

  assert.ok(js.includes('function createCompletionCheck('));
  assert.ok(js.includes("createCompletionCheck('meal-complete'"));
  assert.ok(js.includes("createCompletionCheck('shopping-check'"));
  assert.ok(js.indexOf('row.appendChild(completion.root)') < js.indexOf("row.appendChild(createElement('div', 'meal-slot'"));
  assert.ok(html.includes('.completion-check-visual{width:22px;height:22px;border-radius:7px'));
  assert.ok(html.includes('@keyframes completionCheckPop'));
  assert.ok(html.includes('@media (prefers-reduced-motion:reduce)'));
  assert.ok(html.includes('.calendar-meal-title{display:block;margin-top:8px;font-size:15px'));
  assert.ok(html.includes('.batch-rail-item::before{content:\'\';position:absolute;left:10px;top:15px;width:4px;height:18px'));
});
```

- [ ] **шаг 2: запустить тест и подтвердить red**

команда:

```bash
node --test test/nutrition-ui.test.cjs
```

ожидание: fail в новом тесте, потому что `createCompletionCheck` и новые css-селекторы отсутствуют.

- [ ] **шаг 3: добавить фабрику доступной отметки**

рядом с `createMealDetails` в `nutrition.js` добавить:

```js
function createCompletionCheck(className, ariaLabel, checked, onChange) {
  var root = createElement('label', 'completion-check ' + className + '-wrap');
  var input = createElement('input', 'completion-check-input ' + className);
  var visual = createElement('span', 'completion-check-visual');
  input.type = 'checkbox';
  input.checked = checked === true;
  input.setAttribute('aria-label', ariaLabel);
  input.addEventListener('change', function () { onChange(input.checked); });
  appendChildren(root, [input, visual]);
  return { root: root, input: input };
}
```

в `createMealRow` создать контрол до слота и передать callback, который обновляет `state.completions`, сохраняет состояние и перерисовывает зависимые представления. действия должны содержать только `detailsButton` и `replaceButton`.

в `renderShopping` заменить прямой `input` на `createCompletionCheck('shopping-check', ...)`, а `completion.root` добавить первым дочерним элементом строки.

- [ ] **шаг 4: перенести визуальный паттерн главной и обновить сетки**

в `menu.html` добавить локальные классы:

```css
.completion-check{position:relative;width:22px;height:22px;display:block;flex:0 0 auto}
.completion-check-input{position:absolute;inset:0;width:100%;height:100%;opacity:0;cursor:pointer;z-index:1}
.completion-check-visual{width:22px;height:22px;border-radius:7px;border:1.5px solid rgba(255,255,255,.18);background:rgba(255,255,255,.07);display:flex;align-items:center;justify-content:center;transition:background .2s,border-color .2s,box-shadow .2s}
.completion-check-input:focus-visible + .completion-check-visual{outline:2px solid var(--accent);outline-offset:3px}
.completion-check-input:checked + .completion-check-visual{background:var(--success);border-color:var(--success);box-shadow:0 0 12px rgba(107,227,164,.4)}
.completion-check-input:checked + .completion-check-visual::after{content:'';display:block;width:6px;height:10px;border:solid #1C1E24;border-width:0 2px 2px 0;transform:rotate(45deg) translate(-1px,-1px);animation:completionCheckPop .28s cubic-bezier(.34,1.56,.64,1)}
@keyframes completionCheckPop{0%{transform:rotate(45deg) scale(.8);opacity:0}100%{transform:rotate(45deg) translate(-1px,-1px) scale(1);opacity:1}}
@media (prefers-reduced-motion:reduce){.completion-check-visual{transition:none}.completion-check-input:checked + .completion-check-visual::after{animation:none}}
```

обновить desktop-сетку рациона до `30px 110px minmax(0,1fr) auto`, а details — до `grid-column:3/5`. обновить mobile-сетку так, чтобы отметка занимала первый столбец, слот и данные — второй, а действия оставались справа или переносились отдельной строкой без наложений.

- [ ] **шаг 5: усилить только типографику и существующие маркеры календаря**

в `menu.html`:

```css
.calendar-meal-title{display:block;margin-top:8px;font-size:15px;font-weight:800;line-height:1.38;overflow-wrap:anywhere}
.batch-rail-item{padding:15px 8px 15px 24px}
.batch-rail-item::before{content:'';position:absolute;left:10px;top:15px;width:4px;height:18px;border-radius:3px;background:var(--batch-color)}
```

скорректировать только значения существующих `--batch-color` на более контрастные варианты, сохранив восемь текущих категорий и отсутствие цветной заливки ячеек.

- [ ] **шаг 6: запустить ui-тест и полный набор**

команды:

```bash
node --test test/nutrition-ui.test.cjs
node --test
```

ожидание: оба запуска pass.

- [ ] **шаг 7: закоммитить визуальный блок**

```bash
git add menu.html nutrition.js test/nutrition-ui.test.cjs
git commit -m "унифицировать отметки и повысить читаемость меню"
```

---

### задача 2: добавить безопасный возврат последнего шага

**файлы:**

- изменить: `test/nutrition-cooking-core.test.cjs`
- изменить: `nutrition-cooking-core.js:740-910`

**интерфейсы:**

- создаёт `reopenLastResolvedStep(session, actionId) -> { ok, session, error? }`;
- успешный результат сохраняет `actualMs`, ставит `status: 'pending'`, очищает `completedAt` и переводит сессию в `running`;
- ошибка возвращает клонированную неизменённую сессию и код `session-completed`, `step-not-resolved`, `active-step-running`, `not-last-resolved` или `resolved-dependent`.

- [ ] **шаг 1: добавить падающие unit-тесты возврата**

в `test/nutrition-cooking-core.test.cjs` добавить сценарии:

```js
test('reopens only the latest resolved step and preserves measured time', () => {
  let session = CookingCore.startSession(sessionPlan(), 0);
  session = CookingCore.startStep(session, 'prepare', 0).session;
  session = CookingCore.completeStep(session, 'prepare', 8 * 60 * 1000).session;

  const reopened = CookingCore.reopenLastResolvedStep(session, 'prepare');

  assert.equal(reopened.ok, true);
  assert.equal(reopened.session.steps.prepare.status, 'pending');
  assert.equal(reopened.session.steps.prepare.completedAt, null);
  assert.equal(reopened.session.steps.prepare.actualMs, 8 * 60 * 1000);
  assert.equal(reopened.session.status, 'running');
  assert.equal(session.steps.prepare.status, 'done');
});

test('blocks reopening while another step runs or a resolved dependent exists', () => {
  let running = CookingCore.startSession(sessionPlan(), 0);
  running = CookingCore.startStep(running, 'prepare', 0).session;
  running = CookingCore.completeStep(running, 'prepare', 1000).session;
  running = CookingCore.startStep(running, 'cook', 2000).session;
  assert.equal(CookingCore.reopenLastResolvedStep(running, 'prepare').error.code, 'active-step-running');

  let completed = CookingCore.completeStep(running, 'cook', 3000).session;
  completed.status = 'running';
  completed.completedAt = null;
  assert.equal(CookingCore.reopenLastResolvedStep(completed, 'prepare').error.code, 'not-last-resolved');
  assert.equal(CookingCore.reopenLastResolvedStep(completed, 'cook').error.code, 'resolved-dependent');
});
```

последняя проверка `resolved-dependent` должна использовать отдельный план из трёх действий, где последний по времени шаг имеет завершённую зависимую ветку; не изменять `sessionPlan()` для остальных тестов.

- [ ] **шаг 2: запустить core-тест и подтвердить red**

```bash
node --test test/nutrition-cooking-core.test.cjs
```

ожидание: fail с `CookingCore.reopenLastResolvedStep is not a function`.

- [ ] **шаг 3: реализовать чистую доменную операцию**

в `nutrition-cooking-core.js` добавить helpers определения последнего resolved-шага по `completedAt` и порядку `session.actions`, а затем:

```js
function reopenLastResolvedStep(inputSession, actionId) {
  var session = clone(inputSession);
  var step = session.steps && session.steps[actionId];
  if (session.status === 'completed' || isRecord(session.calibrationResult)) {
    return sessionResult(false, session, 'session-completed', 'завершённую сессию нельзя вернуть');
  }
  if (!step || (step.status !== 'done' && step.status !== 'skipped')) {
    return sessionResult(false, session, 'step-not-resolved', 'шаг ещё не завершён');
  }
  var active = Object.keys(session.steps).some(function (id) {
    return session.steps[id].status === 'running' || session.steps[id].status === 'paused';
  });
  if (active) return sessionResult(false, session, 'active-step-running', 'сначала останови текущий шаг');
  if (lastResolvedActionId(session) !== actionId) {
    return sessionResult(false, session, 'not-last-resolved', 'можно вернуть только последний шаг');
  }
  if (hasResolvedDependent(session, actionId)) {
    return sessionResult(false, session, 'resolved-dependent', 'после шага уже завершена зависимая работа');
  }
  step.status = 'pending';
  step.completedAt = null;
  step.lastStartedAt = null;
  session.status = 'running';
  session.completedAt = null;
  return sessionResult(true, session);
}
```

экспортировать функцию в публичном объекте модуля.

- [ ] **шаг 4: запустить core-тесты**

```bash
node --test test/nutrition-cooking-core.test.cjs
```

ожидание: pass.

- [ ] **шаг 5: закоммитить доменную операцию**

```bash
git add nutrition-cooking-core.js test/nutrition-cooking-core.test.cjs
git commit -m "добавить безопасный возврат шага готовки"
```

---

### задача 3: показать ход сессии и связать возврат с сохранением

**файлы:**

- изменить: `test/nutrition-ui.test.cjs`
- изменить: `nutrition.js:1495-1529`
- изменить: `nutrition.js:1713-1815`
- изменить: `menu.html:202-220`

**интерфейсы:**

- создаёт `runReopenSessionStep(plan, session, actionId) -> { ok, error? }`;
- вызывает `NutritionCookingCore.reopenLastResolvedStep`, затем `persistCookingSession` и `renderCooking`;
- `renderCookingSessionHistory(plan, session) -> HTMLElement` выводит шаги в порядке `plan.schedule`.

- [ ] **шаг 1: добавить падающий ui-тест истории и возврата**

в `test/nutrition-ui.test.cjs` расширить test api функциями `runReopenSessionStep` и `renderCookingNow`, затем добавить:

```js
test('cooking panel renders session history and persists a reopened step', () => {
  const html = read('menu.html');
  const js = read('nutrition.js');

  assert.ok(html.includes('.cooking-session-history'));
  assert.ok(html.includes('.cooking-session-step.current'));
  assert.ok(js.includes('function renderCookingSessionHistory('));
  assert.ok(js.includes('function runReopenSessionStep('));
  assert.ok(js.includes('NutritionCookingCore.reopenLastResolvedStep'));
  assert.ok(js.includes("createElement('button', 'cooking-step-reopen', 'вернуть')"));
});
```

- [ ] **шаг 2: запустить ui-тест и подтвердить red**

```bash
node --test test/nutrition-ui.test.cjs
```

ожидание: fail в новом тесте из-за отсутствующих функций и css.

- [ ] **шаг 3: реализовать историю сессии**

добавить в `nutrition.js` функцию, которая:

- вычисляет `currentActionId` через `nextSessionActionId`;
- проходит по `plan.schedule`, исключая дубли `actionId`;
- отображает статус, название и фактическое/плановое время;
- добавляет кнопку `вернуть` только последнему resolved-шагу, когда core-операция может быть успешной;
- на нажатие вызывает `runReopenSessionStep`.

функция сохранения:

```js
function runReopenSessionStep(plan, session, actionId) {
  var result = NutritionCookingCore.reopenLastResolvedStep(session, actionId);
  if (!result.ok) {
    cookingUiError[activeCookingPlanKey()] = result.error.message;
    renderCooking();
    return result;
  }
  persistCookingSession(result.session);
  cookingUiError[activeCookingPlanKey()] = '';
  renderCooking();
  return result;
}
```

в `renderCookingNow` вставить историю после блока текущего шага и до управляющих кнопок.

- [ ] **шаг 4: показывать только релевантные действия текущего шага**

- `pending`: `начать`, `пропустить`;
- `running`: `пауза`, `готово`, `пропустить`;
- `paused`: `продолжить`, `готово`, `пропустить`;
- не рендерить отключённые действия, если они не относятся к текущему статусу;
- сохранить подтверждение пропуска шага с зависимостями.

- [ ] **шаг 5: добавить стили истории и компактной панели действий**

в `menu.html` добавить `.cooking-session-history`, `.cooking-session-step`, `.cooking-session-step.current`, `.cooking-session-status`, `.cooking-step-reopen`. ограничить историю через `max-height` и `overflow-y:auto`, использовать существующий спокойный scrollbar. кнопки текущего шага должны иметь устойчивую минимальную ширину и переноситься, а не растягиваться на всю ширину страницы.

- [ ] **шаг 6: запустить ui и полный набор тестов**

```bash
node --test test/nutrition-ui.test.cjs
node --test
```

ожидание: pass.

- [ ] **шаг 7: закоммитить ui навигации готовки**

```bash
git add menu.html nutrition.js test/nutrition-ui.test.cjs
git commit -m "показать ход сессии готовки"
```

---

### задача 4: визуальная проверка и публикация

**файлы:**

- при необходимости изменить только: `menu.html`, `nutrition.js`, соответствующие тесты;
- обновить: описание pr через github cli.

- [ ] **шаг 1: запустить локальный сервер**

```bash
python3 -m http.server 8765 --bind 127.0.0.1
```

ожидание: `menu.html` доступен на `http://127.0.0.1:8765/menu.html`.

- [ ] **шаг 2: проверить сценарии в playwright**

- 1440 × 1000: рацион, календарь, закупка, готовка;
- 1024 × 900: внутренний scroll календаря и история готовки;
- 390 × 844: отметки не перекрывают текст и действия;
- включить отметку и убедиться, что состояние сохраняется после reload;
- завершить шаг, увидеть его в истории, вернуть и получить `pending` после reload;
- проверить отсутствие page-level horizontal overflow и текстовых обрезаний.

- [ ] **шаг 3: выполнить финальную верификацию**

```bash
git diff --check
node --test
git status --short
```

ожидание: `git diff --check` без вывода, все тесты pass, рабочее дерево содержит только намеренные изменения.

- [ ] **шаг 4: запушить ветку**

```bash
git push -u origin fix/nutrition-ui-cooking-navigation
```

- [ ] **шаг 5: открыть недрафтовый pr**

pr должен подробно описать:

- повторное использование паттерна отметки главной;
- изменения иерархии календаря и маркеров партий;
- инварианты безопасного возврата шага;
- влияние на сохранение фактического времени и калибровку;
- автоматические и визуальные проверки;
- `closes #42` и `closes #43`.
