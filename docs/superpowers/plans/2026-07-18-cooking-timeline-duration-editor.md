# план реализации редактирования длительности готовки

> **для agentic workers:** обязательный sub-skill: использовать `superpowers:subagent-driven-development` или `superpowers:executing-plans` и выполнять задачи по порядку. прогресс отмечать checkbox.

**цель:** добавить точное редактирование длительности действий готовки через поле минут и drag-resize, сохранить поправки для будущих планов и заменить светлые системные полосы прокрутки на сдержанные внутренние.

**архитектура:** чистая модель в `nutrition-cooking-core.js` строит стабильный ключ из блюда, категории и текста шага, нормализует `durationOverrides` и применяет точное значение после общей калибровки. `nutrition.js` хранит только состояние выбора и drag-preview, а после сохранения обновляет профиль, инвалидирует планы недели и запускает существующий планировщик. `menu.html` отвечает за знакомые ручки ресайза, встроенный инспектор и кроссбраузерные стили scrollbar.

**технологии:** vanilla javascript, css, localstorage, `node:test`, playwright с chromium.

## глобальные ограничения

- ручная поправка действует только для такого же шага того же блюда;
- допустимы только целые значения от 1 до 720 минут;
- сохраняется длительность, но не абсолютная позиция карточки;
- после сохранения расписание полностью пересобирается с учетом зависимостей, оборудования и розеток;
- во время активной сессии редактируются только шаги со статусом `pending`;
- выполняющиеся и завершенные шаги используют существующую фиксацию фактического времени;
- кнопка `сбросить темп` не удаляет точные поправки;
- страница не получает горизонтальную прокрутку, прокручивается только внутренний календарь или таймлайн;
- свободное перемещение действий и ручной выбор ресурсов не входят в объем;
- все тексты интерфейса, коммиты, issue и pr оформляются на русском языке с маленькой буквы.

---

### задача 1: модель точных длительностей

**файлы:**
- изменить: `nutrition-cooking-core.js:63-110`
- изменить: `nutrition-cooking-core.js:560-619`
- изменить: `nutrition-cooking-core.js:884-930`
- тест: `test/nutrition-cooking-core.test.cjs`

**интерфейсы:**
- принимает: `action`, массив `batches`, нормализованный профиль кухни;
- создает: `getActionDurationKey(action, batches) -> string`, `setActionDurationOverride(profile, action, batches, minutes) -> { ok, profile, key, error }`, `clearActionDurationOverride(profile, action, batches) -> { ok, profile, key, error }`, `canEditActionDuration(session, actionId) -> boolean`;
- расширяет: `applyCalibrationToActions(actions, profile, batches) -> actions`;
- хранит: `profile.calibration.durationOverrides[key] = integer`.

- [ ] **шаг 1: написать падающие тесты нормализации и точного совпадения**

добавить тесты, которые задают валидную и поврежденную карту, сохраняют значение для шага блюда `meal-rice`, а затем проверяют изоляцию от такого же текста у `meal-fish`:

```js
test('normalizes exact cooking duration overrides', () => {
  const profile = CookingCore.normalizeKitchenProfile({
    calibration: {
      durationOverrides: {
        'meal-rice::prep::отвари рис': 18,
        broken: 0,
        huge: 900
      }
    }
  });

  assert.deepEqual(profile.calibration.durationOverrides, {
    'meal-rice::prep::отвари рис': 18
  });
});

test('applies an exact duration only to the same action and meal', () => {
  const batches = [
    { id: 'rice-batch', mealId: 'meal-rice' },
    { id: 'fish-batch', mealId: 'meal-fish' }
  ];
  const rice = { id: 'rice-step', batchId: 'rice-batch', title: ' Отвари  рис ', category: 'prep', mode: 'active', durationMinutes: 10 };
  const fish = { id: 'fish-step', batchId: 'fish-batch', title: 'отвари рис', category: 'prep', mode: 'active', durationMinutes: 10 };
  const saved = CookingCore.setActionDurationOverride(
    CookingCore.createDefaultKitchenProfile(), rice, batches, 18
  );
  const adjusted = CookingCore.applyCalibrationToActions([rice, fish], saved.profile, batches);

  assert.equal(saved.ok, true);
  assert.equal(adjusted[0].durationMinutes, 18);
  assert.notEqual(adjusted[1].durationMinutes, 18);
});
```

- [ ] **шаг 2: запустить тест и подтвердить правильное падение**

запустить:

```bash
node --test test/nutrition-cooking-core.test.cjs
```

ожидаемый результат: `fail` из-за отсутствующих `durationOverrides` и `setActionDurationOverride`.

- [ ] **шаг 3: реализовать нормализацию, ключ и применение поправки**

добавить в профиль `durationOverrides: {}`. нормализовать текст через trim, lowercase и схлопывание пробелов. ключ строить только при найденном `batch.mealId`:

```js
function normalizeActionTitle(value) {
  return String(value || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

function getActionDurationKey(action, batches) {
  var batch = (batches || []).find(function (item) { return item.id === action.batchId; });
  var mealId = batch && batch.mealId;
  var title = normalizeActionTitle(action && action.title);
  var category = normalizeActionTitle(action && action.category);
  return mealId && title && category ? [mealId, category, title].join('::') : '';
}
```

в `applyCalibrationToActions` сначала применять общий коэффициент, затем заменять результат точным значением. в `buildFallbackActions` применять точную поправку к уже рассчитанным действиям до возврата массива.

- [ ] **шаг 4: добавить тесты удаления, fingerprint и активной сессии**

```js
test('clears an exact duration without resetting pace calibration', () => {
  const batches = [{ id: 'rice-batch', mealId: 'meal-rice' }];
  const action = { id: 'rice-step', batchId: 'rice-batch', title: 'отвари рис', category: 'prep', mode: 'active', durationMinutes: 10 };
  let profile = CookingCore.createDefaultKitchenProfile();
  profile.calibration.factors.prep = 1.8;
  profile = CookingCore.setActionDurationOverride(profile, action, batches, 18).profile;
  profile = CookingCore.clearActionDurationOverride(profile, action, batches).profile;

  assert.equal(profile.calibration.factors.prep, 1.8);
  assert.deepEqual(profile.calibration.durationOverrides, {});
});

test('allows duration edits only for pending actions in an active session', () => {
  assert.equal(CookingCore.canEditActionDuration(null, 'step'), true);
  assert.equal(CookingCore.canEditActionDuration({ steps: { step: { status: 'pending' } } }, 'step'), true);
  assert.equal(CookingCore.canEditActionDuration({ steps: { step: { status: 'running' } } }, 'step'), false);
  assert.equal(CookingCore.canEditActionDuration({ steps: { step: { status: 'done' } } }, 'step'), false);
});
```

проверить отдельно, что `createPlanFingerprint` меняется после сохранения точного значения.

- [ ] **шаг 5: запустить модульные тесты и довести их до green**

```bash
node --test test/nutrition-cooking-core.test.cjs
```

ожидаемый результат: все тесты файла проходят без warning.

- [ ] **шаг 6: зафиксировать логический блок**

```bash
git add nutrition-cooking-core.js test/nutrition-cooking-core.test.cjs
git commit -m "добавить точные длительности действий готовки"
```

---

### задача 2: контроллер сохранения и пересборки плана

**файлы:**
- изменить: `nutrition.js:240-330`
- изменить: `nutrition.js:1044-1180`
- изменить: `nutrition.js:1174-1280`
- тест: `test/nutrition-ui.test.cjs`

**интерфейсы:**
- использует: `getActionDurationKey`, `setActionDurationOverride`, `clearActionDurationOverride`, `canEditActionDuration` из задачи 1;
- создает: `selectedCookingActionId`, `getSelectedCookingEntry(plan)`, `saveCookingActionDuration(plan, actionId, minutes)`, `resetCookingActionDuration(plan, actionId)`, `rebuildCookingPlanAfterDurationChange(plan)`;
- обновляет: вызов `applyCalibrationToActions(result.value.actions, kitchenProfile, demand.batches)` для ai-плана.

- [ ] **шаг 1: написать падающий статический тест контроллера**

```js
test('nutrition controller edits and persists planned cooking durations', () => {
  const js = read('nutrition.js');

  assert.ok(js.includes('selectedCookingActionId'));
  assert.ok(js.includes('NutritionCookingCore.setActionDurationOverride'));
  assert.ok(js.includes('NutritionCookingCore.clearActionDurationOverride'));
  assert.ok(js.includes('NutritionCookingCore.canEditActionDuration'));
  assert.ok(js.includes('function saveCookingActionDuration('));
  assert.ok(js.includes('function resetCookingActionDuration('));
  assert.ok(js.includes('NutritionCookingCore.invalidateWeek'));
  assert.ok(js.includes('applyCalibrationToActions(result.value.actions, kitchenProfile, demand.batches)'));
});
```

- [ ] **шаг 2: запустить тест и подтвердить red**

```bash
node --test test/nutrition-ui.test.cjs
```

ожидаемый результат: `fail` на первом отсутствующем интерфейсе.

- [ ] **шаг 3: реализовать атомарное сохранение и откат**

`saveCookingActionDuration` должен:

1. найти действие и активную сессию;
2. проверить `canEditActionDuration`;
3. получить новый профиль через core;
4. сохранить профиль;
5. инвалидировать оба плана выбранной недели;
6. очистить выбранный action, если он исчез после пересборки;
7. вызвать `ensureCookingPlan(cookingWeek, cookingSessionKind, { force: true })` и `renderCooking()`;
8. при ошибке вернуть прежние `kitchenProfile` и `cookingStore`.

`resetCookingActionDuration` использует тот же путь, но удаляет только точную поправку. `resetCalibration` не очищает `durationOverrides`.

- [ ] **шаг 4: запустить тесты контроллера и полного core**

```bash
node --test test/nutrition-ui.test.cjs test/nutrition-cooking-core.test.cjs
```

ожидаемый результат: оба файла проходят.

- [ ] **шаг 5: зафиксировать контроллер**

```bash
git add nutrition.js test/nutrition-ui.test.cjs
git commit -m "сохранять поправки таймлайна готовки"
```

---

### задача 3: инспектор, ручки и аккуратная прокрутка

**файлы:**
- изменить: `menu.html:150-235`
- изменить: `nutrition.js:1106-1280`
- изменить: `nutrition-core.js:220-266`
- тест: `test/nutrition-ui.test.cjs`
- тест: `test/nutrition-core.test.cjs`

**интерфейсы:**
- использует: функции сохранения и сброса из задачи 2;
- создает: `minuteAt(pixel)`, `renderCookingDurationEditor(plan, entry, container)`, `attachCookingResizeHandle(handle, plan, entry, edge, block, timelineScale)`;
- css-классы: `.timeline-block-selected`, `.timeline-resize-handle`, `.timeline-resize-handle.start`, `.timeline-resize-handle.end`, `.cooking-duration-editor`, `.internal-scroll`.

- [ ] **шаг 1: написать падающий тест разметки и стилей**

```js
test('cooking timeline exposes resize handles, duration editor and quiet scrollbars', () => {
  const html = read('menu.html');
  const js = read('nutrition.js');

  assert.ok(html.includes('.timeline-resize-handle'));
  assert.ok(html.includes('cursor:ew-resize'));
  assert.ok(html.includes('scrollbar-width:thin'));
  assert.ok(html.includes('::-webkit-scrollbar-thumb'));
  assert.ok(js.includes("setAttribute('role', 'slider')"));
  assert.ok(js.includes('renderCookingDurationEditor'));
  assert.ok(js.includes('attachCookingResizeHandle'));
  assert.ok(js.includes("createElement('input', 'field-control cooking-duration-input')"));
  assert.ok(js.includes("input.type = 'number'"));
});
```

- [ ] **шаг 2: запустить тест и подтвердить red**

```bash
node --test test/nutrition-ui.test.cjs
```

ожидаемый результат: `fail` из-за отсутствующих классов и функций.

- [ ] **шаг 3: добавить сдержанные внутренние scrollbar**

применить общий класс к `.cycle-scroll` и `.timeline-shell`:

```css
.cycle-scroll,.timeline-shell{
  scrollbar-width:thin;
  scrollbar-color:#555B66 transparent;
}
.cycle-scroll::-webkit-scrollbar,.timeline-shell::-webkit-scrollbar{height:9px}
.cycle-scroll::-webkit-scrollbar-track,.timeline-shell::-webkit-scrollbar-track{background:transparent}
.cycle-scroll::-webkit-scrollbar-thumb,.timeline-shell::-webkit-scrollbar-thumb{
  min-width:48px;
  border:2px solid transparent;
  border-radius:999px;
  background:#555B66;
  background-clip:padding-box;
}
.cycle-scroll::-webkit-scrollbar-thumb:hover,.timeline-shell::-webkit-scrollbar-thumb:hover{background:#6A7280;background-clip:padding-box}
```

- [ ] **шаг 4: добавить выбор действия и встроенный инспектор**

заменить внешнюю карточку с вложенными интерактивными ручками на `div` с `role="button"` и `tabindex="0"`. клик и `enter` выбирают действие, но не запускают его. инспектор отображается перед блоком текущего шага и содержит:

```js
var input = createElement('input', 'field-control cooking-duration-input');
input.type = 'number';
input.min = '1';
input.max = '720';
input.step = '1';
input.value = String(entry.durationMinutes);
```

`сохранить` вызывает `saveCookingActionDuration`, `вернуть расчетное` вызывает `resetCookingActionDuration`. текущее рабочее действие остается ниже инспектора и не исчезает.

- [ ] **шаг 5: реализовать drag-resize и клавиатуру**

сначала добавить падающий тест обратного преобразования шкалы:

```js
test('maps timeline pixels back to minutes for resizing', () => {
  const scale = NutritionCore.buildTimelineScale([
    { startMinute: 0, endMinute: 4 },
    { startMinute: 6, endMinute: 10 }
  ], 10, 7, 220);

  assert.equal(scale.minuteAt(0), 0);
  assert.equal(scale.minuteAt(110), 2);
  assert.equal(scale.minuteAt(330), 5);
  assert.equal(scale.minuteAt(scale.width), 10);
});
```

после подтвержденного падения расширить результат `buildTimelineScale`:

```js
minuteAt: function (pixelValue) {
  var pixel = Math.max(0, Math.min(offset, Number(pixelValue) || 0));
  if (pixel >= offset) return duration;
  for (var segmentIndex = 0; segmentIndex < segments.length; segmentIndex += 1) {
    var segment = segments[segmentIndex];
    if (pixel <= segment.offset + segment.width) {
      var ratio = (pixel - segment.offset) / Math.max(1, segment.width);
      return segment.start + (segment.end - segment.start) * Math.max(0, Math.min(1, ratio));
    }
  }
  return duration;
}
```

для каждой ручки:

- сохранить исходную границу и длительность на `pointerdown`;
- захватить pointer через `setPointerCapture`;
- получить минуту указателя через обратное преобразование шкалы;
- показывать preview без записи на `pointermove`;
- на `pointerup` округлить значение и вызвать `saveCookingActionDuration`;
- на `pointercancel` вернуть исходный размер;
- стрелки меняют значение на 1 минуту, `shift + стрелка` на 5 минут;
- `aria-valuemin`, `aria-valuemax`, `aria-valuenow` обновляются вместе с preview.

- [ ] **шаг 6: запустить ui и core тесты**

```bash
node --test test/nutrition-ui.test.cjs test/nutrition-core.test.cjs test/nutrition-cooking-core.test.cjs
```

ожидаемый результат: все тесты проходят.

- [ ] **шаг 7: зафиксировать интерфейс**

```bash
git add menu.html nutrition.js nutrition-core.js test/nutrition-ui.test.cjs test/nutrition-core.test.cjs
git commit -m "добавить редактор окон готовки"
```

---

### задача 4: браузерная регрессия и публикация

**файлы:**
- проверить: `menu.html`
- проверить: `nutrition.js`
- изменить при найденной регрессии: файлы задачи 3 и соответствующие тесты;
- обновить: pr #36 и issue #38.

**интерфейсы:**
- проверяет итоговый пользовательский поток без новых production api.

- [ ] **шаг 1: прогнать полный набор тестов**

```bash
node --test
```

ожидаемый результат: все тесты проходят, stderr пуст.

- [ ] **шаг 2: проверить desktop в chromium**

открыть `http://127.0.0.1:8765/menu.html#cooking` при viewport `1440x1000` и проверить:

- `document.documentElement.scrollWidth === document.documentElement.clientWidth`;
- `.timeline-shell.scrollWidth > .timeline-shell.clientWidth`;
- scrollbar не имеет белой дорожки;
- полный текст карточек читаем;
- выбор карточки открывает инспектор;
- ввод минут переживает reload;
- перетаскивание каждого края меняет минуты и пересобирает карточки всех дорожек;
- после сброса возвращается расчетное значение.

- [ ] **шаг 3: проверить mobile и reduced motion**

повторить основной поток при viewport `390x844`, включить `prefers-reduced-motion: reduce` и подтвердить:

- нет горизонтального переполнения страницы;
- внутренний таймлайн прокручивается;
- поле и команды доступны без наложения на нижнюю навигацию;
- ручки доступны через фокус и клавиатуру.

- [ ] **шаг 4: проверить diff и опубликовать ветку**

```bash
git diff --check origin/main...HEAD
git status --short
git push origin HEAD
```

ожидаемый результат: diff без whitespace-ошибок, рабочее дерево чистое, push успешен.

- [ ] **шаг 5: обновить pr и issue**

добавить в pr #36 подробное описание:

- точные поправки и их приоритет;
- правила активной сессии;
- пересборка ресурсов;
- drag-resize, числовой ввод и scrollbar;
- результаты `node --test` и браузерной проверки;
- `closes #38`.

добавить в issue #38 комментарий с результатами тестов и ссылкой на pr. pr не мержить.
