# план подготовки release candidate личной школы

> **для agentic workers:** выполнять задачи последовательно через tests-first и не переводить pr в ready до прохождения всех rc-гейтов.

**цель:** завершить два оставшихся поведения школы, подтвердить корректность supabase/notion и подготовить pr #48 к review без merge и без ai-интеграций.

**архитектура:** ручная перестановка date-only карточек использует существующее поле `Порядок` и серверную команду `reorderLesson`; перенос между зонами продолжает проходить через утверждённую матрицу переходов. предупреждение о перерыве вычисляется как derived runtime issue и не записывается в notion. lock-объекты и migration history проверяются по фактическому live sql перед любым исправлением.

**технологии:** vanilla javascript, css, `node:test`, deno, supabase edge functions, postgresql rpc, notion api, browser qa.

## глобальные ограничения

- ai/kimi-функции не добавлять;
- notion остаётся единственным источником школьных данных;
- реальные уроки не изменять для rc-проверок;
- secrets не выводить, не копировать во frontend и не добавлять в git;
- незапрошенные `.superpowers/` и `docs/superpowers/.DS_Store` не изменять;
- pr не merge-ить и не переводить в ready до полного зелёного rc-гейта.

---

### задача 1: ручной порядок в зоне «без времени»

**файлы:**

- изменить: `school.js`;
- изменить: `school.css`;
- изменить: `test/school-ui.test.cjs`.

**интерфейсы:**

- `allDayDropPlacement(rect, clientY) -> 'before' | 'after'`;
- `allDayDropOrder(core, lessons, date, draggedLessonId, targetLessonId, placement) -> number`;
- `commandForAllDayDrop(lesson, date, order) -> DropTransition`.

- [x] написать тесты вычисления позиции до/после карточки;
- [x] подтвердить red из-за отсутствующих exports;
- [x] написать тесты `reorderLesson` для перестановки внутри того же дня и обычного `moveLesson` для другого дня;
- [x] реализовать минимальные pure helpers;
- [x] подключить card-level drag preview и drop;
- [x] проверить, что optimistic reducer сохраняет `Порядок`, а дата и счётчик переносов не меняются;
- [x] прогнать целевые и все frontend-тесты.

### задача 2: предупреждение о коротком перерыве

**файлы:**

- изменить: `school-core.js`;
- изменить: `school.js`;
- изменить: `test/school-core.test.cjs`;
- изменить: `test/school-ui.test.cjs`.

**интерфейсы:**

- `computeRuntimeIssues(...)` возвращает `short-break` только для положительного интервала меньше пяти минут;
- `lessonSignalLabels(...)` показывает предупреждение на обеих связанных карточках.

- [x] написать падающий тест включения `short-break` в read model;
- [x] написать падающий ui-тест текста предупреждения;
- [x] подтвердить red;
- [x] подключить существующий `findShortBreaks` к runtime issues;
- [x] передать warning ids в недельные карточки и очередь решений;
- [x] прогнать целевые и все frontend-тесты.

### задача 3: migration history и security advisor

**файлы:**

- проверить: `supabase/migrations/20260727122817_school_mutation_locks.sql`;
- проверить: `supabase/rollback/school_mutation_locks.sql`;
- при доказанной необходимости создать миграцию только через supabase cli.

- [x] получить live migration history и определения таблицы/rpc;
- [x] сравнить нормализованный локальный и live sql;
- [x] определить причину несовпадения version без слепого rename/replay;
- [x] проверить grants, rls, execute privileges и advisor;
- [x] исправить только замечания, относящиеся к `school_*`;
- [x] отдельно перечислить старые несвязанные предупреждения.

### задача 4: полный rc-гейт

- [x] frontend tests;
- [x] backend tests;
- [x] deno typecheck и lint;
- [x] production-equivalent static/build check;
- [x] migration/security checks;
- [x] secret scan по tracked frontend/git;
- [x] live notion read: ровно 18 уроков, без тестовых карточек, распределение `9 / 2 / 3 / 2 / 1 / 1`;
- [x] desktop/mobile browser qa;
- [x] сохранить итоговые screenshots;
- [x] проверить git diff и отсутствие посторонних файлов;
- [ ] закоммитить и запушить завершённые логические блоки;
- [ ] обновить подробное описание pr #48;
- [ ] только после всех успешных проверок перевести pr #48 из draft в ready.
