# план реализации магнитного preview расписания школы

> **для agentic workers:** обязательный sub-skill: использовать `superpowers:subagent-driven-development` или `superpowers:executing-plans` для выполнения плана по задачам. шаги отслеживаются checkbox-отметками.

**цель:** сделать визуальное положение перетаскиваемой карточки идентичным округлённому временному слоту, который будет сохранён после drop.

**архитектура:** существующий html5 drag-and-drop сохраняется. чистый helper в `school.js` строит destination, schedule и геометрию preview из активного масштаба; controller показывает один dom-preview в текущей временной колонке и использует сохранённый destination при drop. системный drag-image заменяется прозрачным узлом.

**стек:** vanilla javascript, html5 drag-and-drop, css, `node:test`.

## глобальные ограничения

- шаг preview равен шагу активного масштаба: 15, 10 или 5 минут.
- preview и drop используют один и тот же destination.
- продолжительность берётся из `lesson.durationMinutes`.
- правила статусов, конфликтов, переносов и очередь mutations не меняются.
- edge function, notion schema и реальные уроки не изменяются.
- посторонние незапрошенные файлы рабочей директории не изменяются.

---

### задача 1: чистая модель магнитного preview

**файлы:**
- изменить: `school.js:377-390`
- изменить: `school.js:2290-2310`
- тест: `test/school-ui.test.cjs:322-350`

**интерфейсы:**
- использует: `timelineDestination(core, day, clientY, rect, bounds, zoomLevel)`
- создаёт: `timelineDragPreview(core, lesson, day, clientY, rect, bounds, zoomLevel) -> { destination, schedule, top, height }`

- [ ] **шаг 1: написать падающий unit-тест**

```javascript
test('timeline drag preview snaps geometry and schedule to the active zoom step', () => {
  const lesson = {
    durationMinutes: 45
  };
  const preview = SchoolUi.timelineDragPreview(
    SchoolCore,
    lesson,
    '2026-08-03',
    137,
    { top: 10 },
    { startHour: 9 },
    { pixelsPerHour: 120, snapMinutes: 5 }
  );

  assert.equal(preview.destination.start, '2026-08-03T10:05:00+05:00');
  assert.equal(preview.schedule.end, '2026-08-03T10:50:00+05:00');
  assert.equal(preview.top, 130);
  assert.equal(preview.height, 90);
});
```

- [ ] **шаг 2: запустить тест и подтвердить правильное падение**

команда:

```bash
node --test --test-name-pattern="timeline drag preview" test/school-ui.test.cjs
```

ожидаемый результат: `fail`, потому что `schoolui.timelinedragpreview` ещё не экспортирован.

- [ ] **шаг 3: реализовать минимальный helper**

```javascript
function timelineDragPreview(core, lesson, day, clientY, rect, bounds, zoomLevel) {
  var destination = timelineDestination(core, day, clientY, rect, bounds, zoomLevel);
  var schedule = core.scheduleForDestination(destination, lesson.durationMinutes);
  var start = timeMinutes(schedule.start);
  var end = timeMinutes(schedule.end);
  var startMinute = bounds.startHour * 60;
  return {
    destination: destination,
    schedule: schedule,
    top: Math.max(0, core.timelineYForMinute(start, startMinute, zoomLevel.pixelsPerHour)),
    height: Math.max(44, core.timelineYForMinute(end, start, zoomLevel.pixelsPerHour))
  };
}
```

добавить `timelineDragPreview` в публичный frozen export рядом с `timelineDestination`.

- [ ] **шаг 4: запустить точечный тест**

команда:

```bash
node --test --test-name-pattern="timeline drag preview" test/school-ui.test.cjs
```

ожидаемый результат: `pass`.

- [ ] **шаг 5: закоммитить законченный helper**

```bash
git add school.js test/school-ui.test.cjs
git commit -m "добавить геометрию магнитного preview школы"
```

---

### задача 2: привязанный dom-preview и единый destination drop

**файлы:**
- изменить: `school.js:647-652`
- изменить: `school.js:1690-1770`
- изменить: `school.css:387-400`
- изменить: `school.css:610-665`
- тест: `test/school-ui.test.cjs:1272-1295`

**интерфейсы:**
- использует: `timelineDragPreview(...)`
- создаёт: `makeTimelineDragPreviewNodes(documentRef, lesson, preview) -> { previewNode, lineNode }`
- создаёт: `setTransparentDragImage(event, dragImageNode) -> boolean`
- создаёт: `renderTimelineDragPreview(node, lesson, day, clientY, rect, bounds, zoomLevel)`
- создаёт: `clearTimelineDragPreview()`
- сохраняет: `activeTimelineDragPreview = { node, lessonId, destination }`

- [ ] **шаг 1: написать падающие regression-тесты видимого результата**

```javascript
test('builds a snapped preview card and line from the destination shown to the user', () => {
  const documentRef = fakeDocument();
  const lesson = {
    title: 'technical reading baseline',
    subject: 'english & ielts'
  };
  const nodes = SchoolUi.makeTimelineDragPreviewNodes(documentRef, lesson, {
    top: 130,
    height: 90,
    schedule: {
      start: '2026-08-03T10:05:00+05:00',
      end: '2026-08-03T10:50:00+05:00'
    }
  });

  assert.equal(nodes.previewNode.className, 'school-time-drag-preview');
  assert.equal(nodes.previewNode.style.top, '130px');
  assert.equal(nodes.previewNode.style.height, '90px');
  assert.equal(nodes.previewNode.children[0].textContent, 'english & ielts');
  assert.equal(nodes.previewNode.children[1].textContent, 'technical reading baseline');
  assert.equal(nodes.previewNode.children[2].textContent, '10:05–10:50');
  assert.equal(nodes.lineNode.className, 'school-time-snap-line');
  assert.equal(nodes.lineNode.style.top, '130px');
});

test('passes a transparent element to the browser drag image contract', () => {
  const dragImageNode = {};
  let received = null;
  const applied = SchoolUi.setTransparentDragImage({
    dataTransfer: {
      setDragImage(node, x, y) {
        received = { node, x, y };
      }
    }
  }, dragImageNode);

  assert.equal(applied, true);
  assert.deepEqual(received, { node: dragImageNode, x: 0, y: 0 });
});
```

- [ ] **шаг 2: запустить тест и подтвердить правильное падение**

команда:

```bash
node --test --test-name-pattern="snapped preview card|transparent element" test/school-ui.test.cjs
```

ожидаемый результат: `fail`, потому что оба behavior-helper ещё отсутствуют.

- [ ] **шаг 3: добавить controller-состояние и очистку**

```javascript
var draggedLessonId = null;
var activeTimelineDragPreview = null;
var transparentDragImage = null;

function clearTimelineDragPreview() {
  if (activeTimelineDragPreview && activeTimelineDragPreview.previewNode) {
    activeTimelineDragPreview.previewNode.remove();
  }
  if (activeTimelineDragPreview && activeTimelineDragPreview.lineNode) {
    activeTimelineDragPreview.lineNode.remove();
  }
  activeTimelineDragPreview = null;
}
```

при реализации использовать совместимую с текущими fake-dom тестами очистку через `parentNode.removeChild`, если `remove()` недоступен.

- [ ] **шаг 4: добавить прозрачный drag-image**

на `dragstart` создать один скрытый `span.school-drag-image`, добавить его в
`document.body`, вызвать:

```javascript
event.dataTransfer.setDragImage(transparentDragImage, 0, 0);
```

если `setDragImage` отсутствует, перенос продолжает работать с системным
fallback.

- [ ] **шаг 5: отрисовать preview из чистой модели**

`renderTimelineDragPreview`:

1. вызывает `timelineDragPreview`;
2. очищает предыдущий preview только при смене колонки или слота;
3. вызывает протестированный `makeTimelineDragPreviewNodes`;
4. добавляет `previewNode` и `lineNode` в активную колонку;
5. сохраняет использованный `destination` в `activeTimelineDragPreview`.

в `drop` использовать `activeTimelineDragPreview.destination`, только если
совпадают текущая колонка и `lessonId`; иначе безопасно пересчитать через
`timelineDestination`.

- [ ] **шаг 6: гарантировать очистку во всех выходах**

вызвать `clearTimelineDragPreview()` из:

- `dragleave` активной временной колонки;
- `drop` любой разрешённой зоны;
- `dragend`;
- начала нового drag.

- [ ] **шаг 7: добавить стили магнитного состояния**

```css
.school-time-drag-preview {
  position: absolute;
  left: 5px;
  right: 5px;
  z-index: 4;
  pointer-events: none;
  border: 1px solid var(--school-accent);
  border-radius: 8px;
  background: rgba(41, 45, 53, 0.94);
  box-shadow: 0 0 0 2px rgba(125, 211, 252, 0.14);
}

.school-time-snap-line {
  position: absolute;
  left: 0;
  right: 0;
  z-index: 3;
  pointer-events: none;
  border-top: 2px solid var(--school-accent);
}

.school-time-card.is-dragging,
.school-lesson-card.is-dragging {
  opacity: 0.38;
}
```

- [ ] **шаг 8: запустить точечные и все ui-тесты**

команды:

```bash
node --test --test-name-pattern="timeline drag preview|snapped preview card|transparent element" test/school-ui.test.cjs
node --test test/school-ui.test.cjs
```

ожидаемый результат: оба запуска `pass`.

- [ ] **шаг 9: закоммитить dom-preview**

```bash
git add school.js school.css test/school-ui.test.cjs
git commit -m "показать магнитный preview переноса урока"
```

---

### задача 3: полная и визуальная проверка

**файлы:**
- изменяемые файлы отсутствуют, если проверка не обнаружит дефект
- проверка: `test/*.test.cjs`

**интерфейсы:**
- использует: готовый frontend школы
- создаёт: проверенный результат без mutation реальных уроков

- [ ] **шаг 1: прогнать полный frontend-набор**

команды:

```bash
node --test
git diff --check
```

ожидаемый результат: все тесты проходят, whitespace-ошибок нет.

- [ ] **шаг 2: проверить локальный desktop preview**

на `http://127.0.0.1:8765/school.html#`:

1. начать перенос урока и не отпускать мышь;
2. подтвердить прыжки preview по 15 минут на ×1;
3. приблизить шкалу и подтвердить шаги 10 и 5 минут;
4. подтвердить совпадение preview и позиции после drop;
5. отменить drag вне колонки и убедиться, что preview исчез;
6. не менять реальные уроки без отдельной временной тестовой карточки.

- [ ] **шаг 3: проверить git и обновить существующий pr**

```bash
git status --short
git log -5 --oneline
git push origin feature/school-dashboard
```

обновить существующий draft pr подробным нижнерегистровым русским описанием:
причина дефекта, единая геометрия preview/drop, тесты и отсутствие изменений
notion. pr не мержить.
