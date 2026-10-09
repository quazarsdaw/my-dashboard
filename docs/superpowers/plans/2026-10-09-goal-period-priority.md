# Приоритеты и периоды целей — план реализации

> **Для исполнителей:** ОБЯЗАТЕЛЬНЫЙ ПОДНАВЫК: использовать `superpowers:subagent-driven-development` (рекомендуется) или `superpowers:executing-plans` и выполнять задачи по одной. Все шаги отмечаются чекбоксами.

**Цель:** добавить целям приоритеты, историю календарных периодов и безопасный перенос активных целей без потери существующих данных и синхронизации.

**Архитектура:** чистая календарная и миграционная логика выносится в `goals-core.js` с browser/CommonJS API, а `goals.html` остаётся контроллером и представлением. Источник истины не меняется: `horizons_goals_v2` продолжает сохраняться через `Gamification.storeSet`; UI-состояние выбранных периодов хранится отдельно.

**Стек:** vanilla HTML/CSS/JavaScript, `node:test`, существующие `Gamification.storeGet/storeSet`, существующий Firebase/Supabase sync.

**Спецификация:** `docs/superpowers/specs/2026-10-09-goal-period-priority-design.md`

## Глобальные ограничения

- календарные границы рассчитываются в `Asia/Yekaterinburg`;
- приоритеты: `p1`, `p2`, `p3`, `p4`, default `p3`;
- пятилетние блоки привязаны к `2026–2030`;
- выполненные цели нельзя переносить;
- активные цели можно переносить в прошлые и будущие периоды только своего горизонта;
- существующий ключ `horizons_goals_v2` и общий sync-path сохраняются;
- каждое изменение поведения проходит цикл RED → GREEN → REFACTOR;
- GitHub-тексты и commit message — по-русски, в нижнем регистре, без соавторства.

## Фокус ревью

- дата около полуночи и границы года должна давать период Екатеринбурга, а не локальный период устройства;
- неделя на стыке декабря и января должна сохранять понедельник как канонический ключ;
- повторная миграция уже нормализованных данных не должна менять порядок или создавать лишнюю запись;
- выполненная цель не должна перемещаться через UI или прямой вызов core API;
- неизвестные priority/period/order должны восстанавливаться без потери прогресса и названия.

---

### Task 1: календарная модель, нормализация и миграция

**Файлы:**
- создать: `goals-core.js`
- создать: `test/goals-core.test.cjs`

**Интерфейсы:**
- отдаёт `window.GoalsCore` и `module.exports` с функциями `currentPeriodKey(horizon, now)`, `shiftPeriodKey(horizon, periodKey, delta)`, `formatPeriodLabel(horizon, periodKey)`, `normalizeData(input, now)`, `sortGoals(goals)` и `moveGoal(data, command)`;
- `moveGoal` принимает `{ goalId, targetPeriodKey, targetPriority?, beforeGoalId? }` и всегда возвращает result: `{ ok: true, data }` либо `{ ok: false, error: 'GOAL_NOT_FOUND' | 'GOAL_COMPLETED' | 'INVALID_PERIOD' | 'INVALID_TARGET' }`;
- последующие задачи используют только этот публичный API.

- [ ] **Шаг 1: написать падающие тесты периодов**

  В `test/goals-core.test.cjs` проверить понедельник–воскресенье, стык года, месяцы, кварталы, блоки `2021–2025` / `2026–2030` / `2031–2035`, `life` и формат пользовательских подписей.

- [ ] **Шаг 2: запустить тест и подтвердить RED**

  Запуск: `node --test test/goals-core.test.cjs`

  Ожидание: FAIL, потому что `goals-core.js` ещё отсутствует.

- [ ] **Шаг 3: реализовать минимальные календарные функции**

  Использовать `Intl.DateTimeFormat` с `timeZone: 'Asia/Yekaterinburg'`; неделя хранит дату понедельника, а пятилетний период использует anchor `2026`.

- [ ] **Шаг 4: запустить тесты периодов и подтвердить GREEN**

  Запуск: `node --test test/goals-core.test.cjs`

  Ожидание: PASS.

- [ ] **Шаг 5: написать падающие тесты миграции и сортировки**

  Проверить default `p3`, текущий `periodKey`, порядок `100/200/...`, сохранение старых полей, идемпотентность, восстановление повреждённых значений и сортировку active P1→P4 с completed внизу.

- [ ] **Шаг 6: запустить новые тесты и подтвердить RED**

  Запуск: `node --test test/goals-core.test.cjs`

  Ожидание: FAIL на отсутствующей нормализации.

- [ ] **Шаг 7: реализовать `normalizeData` и `sortGoals`**

  Возвращать новый объект `{ schemaVersion: 3, goals }`, не мутировать вход; нормализовать order отдельно для каждой группы `horizon + periodKey + priority`.

- [ ] **Шаг 8: написать падающие тесты перемещения**

  Проверить перенос в прошлый/будущий период, изменение priority, вставку перед целью, перенумерацию только исходной/целевой группы и отказ для completed.

- [ ] **Шаг 9: реализовать `moveGoal` и получить GREEN**

  Запуск: `node --test test/goals-core.test.cjs`

  Ожидание: PASS без предупреждений.

- [ ] **Шаг 10: закоммитить логический блок**

  ```bash
  git add goals-core.js test/goals-core.test.cjs
  git commit -m "добавить календарную модель целей"
  ```

### Task 2: безопасное подключение новой схемы к странице

**Файлы:**
- изменить: `goals.html`
- изменить: `test/goals-editor.test.cjs`

**Интерфейсы:**
- использует `GoalsCore.normalizeData` при чтении;
- сохраняет нормализованную миграцию максимум один раз, затем использует существующий `setData`;
- отдаёт следующим задачам DOM-узлы навигаторов с `data-horizon` и выбранный period state из `goals_period_selection_v1`.

- [ ] **Шаг 1: расширить harness и написать падающие тесты миграции страницы**

  Проверить подключение `goals-core.js`, одну запись при фактической миграции, отсутствие повторной записи при следующем render и сохранение существующего редактирования названия/прогресса.

- [ ] **Шаг 2: запустить тест и подтвердить RED**

  Запуск: `node --test test/goals-editor.test.cjs`

  Ожидание: FAIL на отсутствующем core API/новой схеме.

- [ ] **Шаг 3: подключить core и обновить `getData`**

  Добавить `goals-core.js` перед inline-controller; сравнивать нормализованные данные с прочитанными и сохранять только при реальном отличии.

- [ ] **Шаг 4: добавить выбранные периоды как отдельное UI-состояние**

  Реализовать `getPeriodSelection`, `setPeriodSelection`, `selectedPeriodFor(horizon)` с default из `GoalsCore.currentPeriodKey`.

- [ ] **Шаг 5: подтвердить GREEN и отсутствие регрессии редактора**

  Запуск: `node --test test/goals-editor.test.cjs test/goals-core.test.cjs`

  Ожидание: PASS.

- [ ] **Шаг 6: закоммитить логический блок**

  ```bash
  git add goals.html test/goals-editor.test.cjs
  git commit -m "мигрировать цели на периоды и приоритеты"
  ```

### Task 3: навигаторы периодов и интерактивный годовой сводный блок

**Файлы:**
- изменить: `goals.html`
- создать: `test/goals-period-ui.test.cjs`

**Интерфейсы:**
- навигатор вызывает `selectPeriod(horizon, periodKey)` и `shiftSelectedPeriod(horizon, delta)`;
- месяц годового блока вызывает `selectPeriod('month', 'YYYY-MM')` и раскрывает `month`;
- render фильтрует цели по `horizon + selectedPeriod`.

- [ ] **Шаг 1: написать падающие структурные и поведенческие тесты навигатора**

  Проверить кнопки previous/next/today, подпись выбранного периода, сохранение selection state, фильтрацию списка и переход из месяца годового блока.

- [ ] **Шаг 2: запустить тест и подтвердить RED**

  Запуск: `node --test test/goals-period-ui.test.cjs`

  Ожидание: FAIL, потому что навигаторов и фильтрации ещё нет.

- [ ] **Шаг 3: реализовать семантическую разметку и поведение**

  Использовать `<button>` и `<select>` с доступными названиями; life показывает статичную подпись без бессмысленных стрелок.

- [ ] **Шаг 4: обновить годовой сводный блок**

  Год берётся из выбранного year period; месяцы — кнопки, а количество выполненных целей считается только для выбранного года.

- [ ] **Шаг 5: добавить пустое состояние выбранного периода**

  Текст должен объяснять, что новая цель будет создана именно в показанном периоде.

- [ ] **Шаг 6: подтвердить GREEN**

  Запуск: `node --test test/goals-period-ui.test.cjs test/goals-editor.test.cjs`

  Ожидание: PASS.

- [ ] **Шаг 7: закоммитить логический блок**

  ```bash
  git add goals.html test/goals-period-ui.test.cjs
  git commit -m "добавить навигацию по периодам целей"
  ```

### Task 4: приоритеты в карточках, создании и редакторе

**Файлы:**
- изменить: `goals.html`
- изменить: `test/goals-editor.test.cjs`
- изменить: `test/goals-period-ui.test.cjs`

**Интерфейсы:**
- новая цель получает `periodKey`, `priority` и `order` до первого сохранения;
- редактор меняет priority через `GoalsCore.moveGoal`, чтобы порядок группы оставался корректным;
- renderer использует `GoalsCore.sortGoals`.

- [ ] **Шаг 1: написать падающие тесты создания и редактирования priority**

  Проверить default P3, явно выбранный P1–P4, выбранный period, перенос в конец новой priority-группы и неизменность остальных полей.

- [ ] **Шаг 2: запустить тесты и подтвердить RED**

  Запуск: `node --test test/goals-editor.test.cjs test/goals-period-ui.test.cjs`

  Ожидание: FAIL на отсутствующих controls/полях.

- [ ] **Шаг 3: реализовать controls и карточки приоритетов**

  Добавить flag + text label, слабый исчезающий gradient, нейтральную progress-bar и отдельный muted стиль completed; не использовать боковую accent-полосу.

- [ ] **Шаг 4: реализовать сортировку и completed-секцию**

  Активные цели выводятся P1→P4 и по order; completed — отдельным нижним блоком выбранного периода.

- [ ] **Шаг 5: подтвердить GREEN**

  Запуск: `node --test test/goals-editor.test.cjs test/goals-period-ui.test.cjs test/goals-core.test.cjs`

  Ожидание: PASS.

- [ ] **Шаг 6: закоммитить логический блок**

  ```bash
  git add goals.html test/goals-editor.test.cjs test/goals-period-ui.test.cjs
  git commit -m "добавить приоритеты целей"
  ```

### Task 5: drag-and-drop, доступный перенос и ручной порядок

**Файлы:**
- изменить: `goals.html`
- изменить: `test/goals-period-ui.test.cjs`
- изменить: `test/goals-core.test.cjs`

**Интерфейсы:**
- desktop DnD формирует одну domain command для `GoalsCore.moveGoal`;
- кнопка «Перенести» использует тот же command path;
- completed card никогда не получает `draggable=true` и не принимает move command.

- [ ] **Шаг 1: написать падающие тесты матрицы переноса**

  Проверить reorder внутри priority, drop в предыдущий/следующий период, явный выбор далёкого периода, перенос в прошлое, completed lock и один `storeSet` на подтверждённое действие.

- [ ] **Шаг 2: запустить тесты и подтвердить RED**

  Запуск: `node --test test/goals-period-ui.test.cjs test/goals-core.test.cjs`

  Ожидание: FAIL на отсутствующих обработчиках.

- [ ] **Шаг 3: реализовать desktop DnD**

  Добавить визуальный preview и drop-зоны соседних периодов; reorder разрешить только внутри текущей priority-группы.

- [ ] **Шаг 4: реализовать доступный диалог «Перенести»**

  Использовать нативный `<dialog>`, выбор любого валидного периода того же горизонта, focus trap браузера и возврат фокуса на инициатор; completed действие скрыто/заблокировано.

- [ ] **Шаг 5: добавить `aria-live` результат**

  После успешного переноса объявлять название цели и новый период; отмена не записывает данные.

- [ ] **Шаг 6: подтвердить GREEN**

  Запуск: `node --test test/goals-period-ui.test.cjs test/goals-editor.test.cjs test/goals-core.test.cjs`

  Ожидание: PASS.

- [ ] **Шаг 7: закоммитить логический блок**

  ```bash
  git add goals.html test/goals-period-ui.test.cjs test/goals-core.test.cjs
  git commit -m "добавить перенос и порядок целей"
  ```

### Task 6: responsive-полировка и полная проверка

**Файлы:**
- изменить: `goals.html`
- изменить: `test/ui-polish.test.cjs`
- при необходимости изменить: `test/security-rendering.test.cjs`

**Интерфейсы:**
- не создаёт новых data APIs;
- фиксирует визуальный и accessibility contract страницы.

- [ ] **Шаг 1: написать падающие проверки responsive и accessibility contract**

  Проверить 44px touch-targets, `focus-visible`, `prefers-reduced-motion`, отсутствие горизонтального overflow, text labels приоритетов, безопасный text rendering и актуальную cache-version `goals-core.js`.

- [ ] **Шаг 2: запустить тесты и подтвердить RED**

  Запуск: `node --test test/ui-polish.test.cjs test/security-rendering.test.cjs`

  Ожидание: FAIL на отсутствующих новых правилах.

- [ ] **Шаг 3: довести desktop/mobile CSS до утверждённого макета**

  Сохранить центральный контейнер, аккордеоны и плотность дашборда; навигатор на mobile переводить в две строки, карточки не должны сжимать title/action.

- [ ] **Шаг 4: запустить все автоматические проверки**

  Запуск: `node --test test/*.test.cjs`

  Ожидание: все тесты PASS, без предупреждений и необработанных ошибок.

- [ ] **Шаг 5: выполнить визуальную проверку**

  Проверить локально минимум desktop `1440×900` и mobile `390×844`: текущий/прошлый/будущий период, P1–P4, completed history, empty state, editor, move dialog, drag preview и reduced-motion.

- [ ] **Шаг 6: выполнить self-review diff и проверку данных**

  Подтвердить, что не добавлены новые удалённые хранилища, секреты или небезопасный HTML; migration сохраняет исходные title/progress/type; unrelated files отсутствуют в diff.

- [ ] **Шаг 7: закоммитить финальную полировку**

  ```bash
  git add goals.html test/ui-polish.test.cjs test/security-rendering.test.cjs
  git commit -m "довести интерфейс периодов целей"
  ```

- [ ] **Шаг 8: подготовить подробный PR без merge**

  В описании на русском языке и в нижнем регистре указать модель данных, миграцию, влияние на sync/history, desktop/mobile проверку, полный список тестов и отсутствие автоматического merge.
