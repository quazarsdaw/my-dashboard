# личная школа: недельный dashboard и защищённый notion adapter

## контекст

в существующем dashboard нужен отдельный рабочий раздел `школа`, доступный из общей нижней навигации. интерфейс должен показывать утверждённую учебную неделю, открывать содержание уроков и выполнять ограниченный набор изменений, не копируя учебные данные в локальное хранилище или отдельную таблицу supabase.

на момент фиксации дизайна проверено:

- production dashboard работает по адресу `https://quazarsdaw.github.io/my-dashboard`;
- production origin для cors: `https://quazarsdaw.github.io`;
- dashboard является статическим многостраничным приложением;
- общий `topbar.js` формирует верхнюю и нижнюю навигацию;
- `supabase-sync.js` уже создаёт клиент supabase, восстанавливает пользовательскую сессию и предоставляет его через `window.SupabaseSync.client`;
- существующий supabase project `yiuiiixovxmoqifsdsuf` активен;
- в проекте пока нет edge functions и migration history;
- все 189 существующих тестов проходят;
- официальный notion mcp подключён к workspace `quazar cryptov’s space`;
- корневая страница `личная школа` и база `уроки` существуют;
- runtime-запрос notion возвращает ровно 18 активных уроков.

проверенное распределение уроков:

- `Software Engineering` — 9;
- `DevOps & Infrastructure` — 2;
- `English & IELTS` — 3;
- `Mathematics` — 2;
- `University` — 1;
- `Director & Assessment` — 1.

## выбранное направление

выбран гибрид:

- notion остаётся единственным источником истины для уроков, расписания, статусов, оценок, порядка и управленческих отметок;
- dashboard получает и изменяет уроки только через одну защищённую supabase edge function `school-notion`;
- существующая supabase auth подтверждает сессию;
- `SCHOOL_OWNER_USER_ID` дополнительно ограничивает доступ владельцем dashboard;
- одна служебная таблица supabase хранит только краткоживущий distributed mutex для операций с глобальным активным уроком;
- frontend не получает notion token, service-role key или raw notion payload.

отдельный node.js-сервис, отдельный процесс за caddy и таблица-копия уроков не создаются.

## границы первой версии

### входит

- отдельная страница `school.html`;
- новый пункт `школа` в нижней навигации после `трекер` и перед `меню`;
- экраны `сегодня`, `неделя`, `дневник`;
- чтение всех 18 уроков W01;
- чтение блоков страницы отдельного урока;
- изменение времени, дня, длительности и порядка;
- перенос в `без времени` и `нераспределённые`;
- запуск, переключение, завершение, частичное выполнение и фиксация пропуска;
- отмена и восстановление с защитой истории;
- очередь `требует решения`;
- проверка пересечений и коротких перерывов;
- desktop, tablet и mobile layout;
- keyboard-доступные резервные действия вместо обязательного drag-and-drop.

### не входит

- автоматическое распределение времени;
- автоматическое создание W02;
- обычный drag-and-drop между учебными неделями;
- графики, xp, геймификация и декоративные блоки;
- дополнительная база данных с уроками;
- автоматическое удаление уроков или учебных результатов;
- автоматическая отметка просроченного урока как пропущенного;
- изменение содержимого учебного задания из dashboard;
- произвольное редактирование raw notion properties.

## существующая notion-модель

корневая страница:

- `личная школа`;
- page id хранится только в server-side secret `NOTION_SCHOOL_PAGE_ID`.

база:

- `уроки`;
- database page id хранится только в `NOTION_DATABASE_PAGE_ID`;
- data source id хранится только в `NOTION_DATA_SOURCE_ID`.

актуальные свойства:

- `Урок` — title;
- `Предмет` — select;
- `Модуль` — text;
- `Начало и окончание` — date;
- `Статус` — select;
- `Приоритет` — select;
- `Неделя` — select;
- `Результат` — select;
- `Автономность` — select;
- `Понимание` — number;
- `Артефакт` — url;
- `Краткий комментарий` — text;
- `Причина пропуска` — select;
- `Количество переносов` — number;
- `Продолжительность, мин` — number;
- `Порядок` — number;
- `Требует решения` — select.

в `Требует решения` на первом этапе существует только значение `Перенос между неделями`.

все 18 уроков уже имеют:

- `Неделя = W01 · 3–9 августа 2026`;
- `Продолжительность, мин = 45`;
- уникальный внутри дня `Порядок` со значениями `100`, `200`, `300`.

## внутренняя модель lesson

notion mapper возвращает frontend только нормализованную доменную модель:

```ts
type LessonStatus =
  | 'Нераспределён'
  | 'Запланирован'
  | 'В процессе'
  | 'Выполнен'
  | 'Частично выполнен'
  | 'Пропущен'
  | 'Отменён'

type Lesson = {
  id: string
  title: string
  subject: string
  module: string
  schedule: {
    kind: 'unscheduled' | 'date-only' | 'timed'
    date: string | null
    start: string | null
    end: string | null
  }
  status: LessonStatus
  priority: 'Must' | 'Should' | 'Could'
  week: string
  result: 'Зачёт' | 'Незачёт' | 'Требует повторения' | null
  autonomy: 'A0' | 'A1' | 'A2' | 'A3' | null
  understanding: 0 | 1 | 2 | 3 | null
  artifactUrl: string | null
  comment: string
  missedReason: string | null
  moveCount: number
  durationMinutes: number
  order: number
  decisionRequest: 'Перенос между неделями' | null
  hasLearningEvidence: boolean
  isFinalized: boolean
  warnings: RuntimeIssue[]
}
```

id берётся из notion page id. raw notion response и внутренние property ids клиенту не передаются.

## информационная архитектура frontend

### общая навигация

в `topbar.js` добавляется восьмой пункт:

`главная → входящие → трекер → школа → меню → цели → магазин → профиль`.

для `school.html` общий helper должен определить `data-page="school"` и подсветить пункт `школа`.

### страница школы

страница использует существующие:

- тёмную тему;
- profile theme variables;
- topbar;
- supabase auth;
- общую плотность и типографику dashboard.

школьный код разделяется:

- `school.html` — семантический каркас;
- `school.css` — layout, responsive states и визуальные состояния;
- `school-core.js` — чистая предметная логика;
- `school-api.js` — вызов `school-notion` через существующий supabase client;
- `school.js` — controller, rendering, dialogs, drag-and-drop и revalidation.

данные школы не записываются в `localStorage` и не проходят через таблицу `user_data`.

### верхняя область

показывает:

- заголовок `личная школа`;
- переключатель `сегодня / неделя / дневник`;
- выбранную неделю `W01 · 3–9 августа 2026`;
- явный прогресс `выполнено X из Y`;
- вторичную строку `N частично · M пропущено`, когда значения ненулевые.

### экран `сегодня`

если существует урок `В процессе`, он всегда показывается первым:

- индикатор `в процессе`;
- основная кнопка `продолжить урок`;
- переход к содержимому текущего урока.

иначе следующий урок определяется так:

1. ближайший незавершённый timed-урок по start time;
2. первый date-only урок по `Порядок`;
3. отменённые уроки не участвуют.

для date-only урока показывается `в течение дня · N минут`. время не придумывается.

ниже показываются остальные уроки дня в порядке:

- timed — по start time, затем по `Порядок`;
- date-only — по `Порядок`.

кнопка `начать урок` у полностью нераспределённой карточки сначала открывает выбор дня W01. сегодняшний день автоматически не назначается.

### экран `неделя`

desktop:

- семь колонок дней;
- верхняя зона `без времени` в каждом дне;
- общая временная сетка;
- основные линии и подписи каждый час;
- при необходимости более слабые линии на 30-й минуте;
- логические drop-slots через 15 минут;
- подписи `09:15` и `09:45` не выводятся;
- сетка начинается диапазоном `09:00–20:00` и может расширяться по фактическим урокам;
- ниже расположена сворачиваемая зона `нераспределённые`.

mobile:

- горизонтальный выбор дня;
- после выбора показывается один день;
- сначала `без времени`;
- затем вертикальное расписание;
- всегда доступно резервное действие `перенести`, даже если touch drag работает.

drag preview показывает итоговый интервал, например `14:15–15:00`. запрос в notion отправляется только после подтверждённого drop.

### карточка урока

обычная карточка показывает только:

- предмет;
- название;
- `без времени · N минут` либо точный интервал;
- статус;
- приоритет;
- `в процессе`, если урок активен;
- warning о временном конфликте;
- `переносился N раза`, только когда `N >= 2`;
- `запрошен перенос в другую неделю`, если установлена отметка.

на карточке не показываются:

- автономность;
- понимание;
- артефакт;
- итоговый комментарий;
- причина пропуска;
- технические id;
- пустые значения.

отменённая карточка остаётся в календаре, но:

- приглушена;
- название перечёркнуто;
- имеет label `отменён`;
- не draggable;
- не участвует в следующем уроке, конфликтах и активной очереди решений.

### экран `дневник`

дневник включает только:

- `Выполнен`;
- `Частично выполнен`;
- `Пропущен`.

записи группируются по актуальной запланированной дате урока. отдельное поле фактического завершения в mvp не добавляется.

для выполненного или частичного урока показываются:

- дата;
- предмет;
- урок;
- результат;
- автономность;
- понимание.

для пропущенного урока показываются статус `пропущен` и причина. пустой результат не выводится как `—`.

`Отменён` в дневник не попадает.

## длительность и время

`Продолжительность, мин` является каноническим источником длительности.

правила:

- значение по умолчанию — 45;
- допустимый диапазон — 15–180;
- изменение в интерфейсе — шаг 5 минут;
- drag snap — 15 минут;
- end всегда вычисляется как `start + duration`;
- изменение duration не меняет start;
- date-only хранит дату без времени и сохранённую duration;
- возврат из timed в date-only удаляет время start/end, но сохраняет duration;
- повторное назначение времени использует сохранённую duration;
- перенос между днями duration не сбрасывает.

для старой записи без duration:

- timed-урок получает разницу между start и end;
- date-only и unscheduled получают 45;
- вычисленное значение сохраняется при первой mutation.

если end расходится с duration:

- в чтении duration считается канонической;
- frontend получает runtime warning;
- при следующей mutation end пересчитывается.

## порядок внутри дня

`Порядок` локален для конкретного дня и может повторяться в разные дни.

правила:

- основной порядок timed-уроков задаёт start time;
- при одинаковом start используется `Порядок`;
- date-only уроки сортируются по `Порядок`;
- вставка между `100` и `200` использует `150`;
- вставка в начало использует число меньше первого, например `50`;
- вставка в конец использует `lastOrder + 100`;
- перестановка в одном дне не меняет дату и move count;
- при переносе в другой день назначается порядок места drop;
- без точного места урок помещается в конец;
- unscheduled имеет отдельный порядок внутри своей зоны.

если интервалы стали слишком малы или появились дубли, перенумеровываются только карточки затронутого дня: `100`, `200`, `300` и далее.

## границы активной недели

конфигурация активной недели хранится в одном frontend/server config:

```ts
{
  id: 'W01',
  notionValue: 'W01 · 3–9 августа 2026',
  startDate: '2026-08-03',
  endDate: '2026-08-09',
  timeZone: 'Asia/Yekaterinburg'
}
```

в mvp разрешены переносы только между 3 и 9 августа 2026 года.

попытка переноса за границу:

- не сохраняется;
- optimistic state откатывается;
- показывает сообщение `перенос между учебными неделями пока выполняется через недельную ревизию`;
- предлагает `вернуть обратно` или `отметить для переноса`.

`отметить для переноса` меняет только:

`Требует решения = Перенос между неделями`.

дата, время, неделя, статус, порядок, move count и результаты остаются неизменными. повторное действие идемпотентно.

`снять отметку` очищает только `Требует решения`.

## прогресс недели

основной показатель называется:

`выполнено X из Y`.

числитель:

- только статус `Выполнен`.

знаменатель:

- все уроки недели;
- `Отменён` исключается;
- `Пропущен` и `Частично выполнен` остаются.

рядом отдельно показываются partial и missed counts.

внутренний `resolvedCount` может учитывать `Выполнен + Частично выполнен + Пропущен + Отменён`, но не заменяет учебный прогресс.

## evidence и финализация

```ts
isFinalized =
  status in ['Выполнен', 'Частично выполнен', 'Пропущен']

hasLearningEvidence =
  status in ['В процессе', 'Частично выполнен', 'Выполнен']
  || result != null
  || autonomy != null
  || understanding != null
  || nonEmpty(comment)
  || nonEmpty(artifactUrl)
```

блоки страницы notion с целью, заданием и критериями не являются evidence: это инструкция, а не результат ученика.

## переходы статусов

### нераспределён

drag разрешён.

- drop на день: date-only, `Запланирован`, новый order;
- drop на слот: start/end, `Запланирован`;
- время автоматически не выбирается.

### запланирован

drag разрешён внутри W01:

- между днями;
- между слотами;
- в `без времени`;
- в `нераспределённые`;
- для изменения order.

move count увеличивается только при изменении календарного дня.

### в процессе

изменение времени внутри текущего календарного дня разрешено, статус сохраняется.

перенос на другой день, в unscheduled или на прошедшую дату требует команды `приостановить и перенести`:

- статус становится `Запланирован`;
- дата/зона меняется;
- оценочные данные не создаются;
- move count увеличивается только при смене дня.

урок не может остаться `В процессе` на другом дне.

### пропущен

обычный drop не меняет историю молча. после подтверждения `перенести и вернуть`:

- статус становится `Запланирован`;
- missed reason очищается;
- result, autonomy и understanding остаются пустыми;
- обновляется schedule;
- move count увеличивается при смене дня;
- новая notion page не создаётся.

### выполнен и частично выполнен

обычный drag запрещён и визуально не начинается.

сначала требуется `вернуть к редактированию`:

- статус становится `В процессе`;
- прежние result, autonomy, understanding, comment и artifact сохраняются;
- применяется глобальный инвариант одного активного урока.

### отменён

обычный drag запрещён. `вернуть в расписание`:

- устанавливает `Запланирован`;
- сохраняет прежние дату и время, если пользователь не выбрал новые;
- не увеличивает move count без смены дня;
- не очищает прежние данные;
- показывает предупреждение, если evidence сохранился.

## запуск и единственный активный урок

глобально у владельца может быть только один урок `В процессе`.

`startLesson`:

- повторный запуск уже активного урока идемпотентен;
- после получения lock повторно читает все активные уроки notion;
- если активен другой урок, возвращает `409 ACTIVE_LESSON_EXISTS`;
- frontend показывает:
  - `продолжить текущий`;
  - `приостановить и начать новый`;
  - `отмена`.

`switchActiveLesson`:

1. получает lock;
2. повторно читает notion;
3. подтверждает, что предыдущий урок действительно `В процессе`;
4. меняет предыдущий на `Запланирован`;
5. меняет новый на `В процессе`;
6. повторно читает notion;
7. проверяет, что активен ровно один урок;
8. освобождает lock.

если второй notion update не прошёл, service пытается компенсирующим запросом вернуть предыдущий урок в `В процессе`, повторно проверяет состояние и пишет server log без секретов.

если активны несколько уроков, система не выбирает один молча и возвращает `ACTIVE_LESSON_STATE_INCONSISTENT`.

frontend показывает одну общую runtime-проблему и позволяет выбрать урок, который останется активным. остальные после подтверждения возвращаются в `Запланирован`.

## завершение и оценка

### выполнен

- result по умолчанию `Зачёт`;
- пользователь видит и может заменить result на `Незачёт` или `Требует повторения`;
- autonomy обязательна;
- understanding обязательно и является целым 0–3;
- comment и artifact необязательны.

### частично выполнен

- result всегда `Требует повторения`;
- autonomy обязательна;
- understanding обязательно;
- comment и artifact необязательны.

### пропущен

- missed reason обязательна;
- result очищается;
- autonomy очищается;
- understanding очищается;
- comment необязателен.

`Незачёт` применяется только к реально выполнявшейся работе, которая не достигла критерия.

## отмена и сохранение истории

### пустой запланированный урок

`Нераспределён` или `Запланирован` без evidence отменяется после обычного подтверждения.

### начатая работа

`В процессе` или другой урок с evidence показывает:

- `продолжить урок`;
- `сохранить как частично выполненный`;
- `всё равно отменить`;
- `назад`.

`всё равно отменить` требует второго явного подтверждения.

### финализированные события

- `Выполнен` и `Частично выполнен` нельзя прямо отменить;
- сначала нужен возврат к редактированию;
- `Пропущен` нельзя превратить в `Отменён` одним действием;
- для пропущенного доступны `перенести`, `исправить статус`, `оставить пропущенным`;
- `исправить статус` возвращает `Запланирован` и очищает missed reason.

### сохранённые данные

при отмене:

- изменяется только status;
- новые оценки не создаются;
- прежние result, autonomy, understanding, comment и artifact не очищаются;
- notion page и её блоки не удаляются.

в отменённой карточке эти значения показываются только в сворачиваемой секции `данные, сохранённые до отмены`.

после восстановления:

- evidence остаётся;
- показывается `у урока сохранились результаты предыдущей работы`;
- доступны `продолжить с сохранёнными данными` и `начать заново`.

`начать заново` является отдельной destructive-командой с подтверждением и очищает только:

- result;
- autonomy;
- understanding;
- comment;
- artifact.

автоматическая очистка из-за смены статуса запрещена.

## временные конфликты

конфликт проверяется только для:

- timed-уроков;
- одного календарного дня;
- статуса не `Отменён`.

формула:

```text
newStart < existingEnd
and
newEnd > existingStart
```

интервалы `14:00–14:45` и `14:45–15:30` не конфликтуют.

проверка выполняется:

- во frontend для preview;
- повторно на server непосредственно перед mutation.

если конфликт найден без `allowOverlap: true`, server возвращает:

```json
{
  "error": "LESSON_TIME_CONFLICT",
  "conflicts": []
}
```

frontend предлагает:

- `выбрать другое время`;
- `поставить после него`;
- `всё равно сохранить`.

`поставить после него` использует end конфликтующего урока как новый start, пересчитывает end по duration и снова проверяет конфликты.

`всё равно сохранить` повторяет mutation с `allowOverlap: true`. другой урок не изменяется. обе карточки получают warning.

если между последовательными уроками меньше пяти минут, показывается мягкое предупреждение `между уроками нет запланированного перерыва`. подтверждение не требуется.

## секция `требует решения`

это одна ui-секция с двумя раздельными источниками.

### запрошенные действия

источник — notion property `Требует решения`.

фильтр:

```text
Требует решения не пусто
and
Статус != Отменён
```

в mvp поддерживается только `Перенос между неделями`.

### обнаруженные проблемы

вычисляются после загрузки и не записываются в notion select:

- несколько active lessons;
- status `Запланирован` при заполненных оценочных полях;
- status `Пропущен` при заполненных autonomy или understanding;
- duration вне диапазона;
- duration расходится с start/end;
- некорректная дата;
- дубли order внутри дня;
- просроченный `Запланирован`.

date-only становится просроченным только после окончания соответствующей локальной даты в `Asia/Yekaterinburg`.

порядок:

1. несколько active lessons;
2. данные, способные повредить историю;
3. persisted cross-week request;
4. overdue lessons;
5. мягкие предупреждения.

счётчик:

`persistedDecisionCount + runtimeIssueCount`.

пустое состояние:

`всё в порядке — решений не требуется`.

## edge function `school-notion`

одна edge function принимает `POST` с envelope:

```ts
type SchoolCommand = {
  operation: SchoolOperation
  payload: unknown
}
```

raw notion properties и arbitrary endpoint/path не принимаются.

внутренняя структура:

```text
supabase/functions/school-notion/
  index.ts
  auth.ts
  cors.ts
  errors.ts
  validation.ts
  mapper.ts
  notion-client.ts
  repository.ts
  service.ts
  router.ts
  types.ts
  deno.json
```

ответственность:

- `auth` — валидная пользовательская сессия и owner check;
- `cors` — точный production origin и локальный dev origin;
- `notion-client` — typed boundary официального notion api;
- `mapper` — notion page → `Lesson`;
- `repository` — query/retrieve/update только настроенного data source;
- `service` — доменные переходы, конфликты, компенсация и lock;
- `validation` — allow-list операций и значений;
- `router` — json envelope, http statuses и нормализованные ошибки.

## разрешённые server-команды

read-only:

- `listLessons` — диапазон дат или выбранная неделя;
- `getLessonContent` — нормализованные blocks одной lesson page.

расписание:

- `moveLesson`;
- `unscheduleLesson`;
- `changeLessonDuration`;
- `reorderLesson`;
- `pauseAndMoveLesson`;
- `restoreMissedLesson`;

активный урок:

- `startLesson`;
- `switchActiveLesson`;
- `resolveActiveLessons`;
- `reopenLesson`;

финализация:

- `completeLesson`;
- `cancelLesson`;
- `restoreCancelledLesson`;
- `correctMissedStatus`;
- `clearLearningEvidence`;

управленческая отметка:

- `requestCrossWeekMove`;
- `clearDecisionRequest`.

каждая команда имеет отдельную validation schema и обновляет только заранее перечисленные properties.

## auth, owner check и cors

используется `npm:@supabase/server@1.4.1`, зафиксированный точной версией.

поток запроса:

1. `OPTIONS` обрабатывается до чтения body;
2. origin сравнивается с точным `DASHBOARD_ORIGIN`;
3. supabase gateway развёрнут с `verify_jwt = true`;
4. `createSupabaseContext(..., { auth: 'user' })` подтверждает пользовательский jwt;
5. user id сравнивается с `SCHOOL_OWNER_USER_ID`;
6. без сессии возвращается 401;
7. другой authenticated user получает 403;
8. только после этого выполняется router.

production:

`DASHBOARD_ORIGIN=https://quazarsdaw.github.io`.

локально `http://127.0.0.1:8765` разрешается только при явно выставленном `SCHOOL_ENV=development` в некоммитящемся local env. hosted function не включает локальный origin.

allowed cors headers:

- `authorization`;
- `apikey`;
- `content-type`;
- `x-client-info`.

credentials cookie не используются.

## secrets

в supabase secrets:

- `NOTION_TOKEN`;
- `NOTION_DATA_SOURCE_ID`;
- `NOTION_DATABASE_PAGE_ID`;
- `NOTION_SCHOOL_PAGE_ID`;
- `SCHOOL_OWNER_USER_ID`;
- `DASHBOARD_ORIGIN`.

значения не записываются:

- во frontend;
- в tracked env;
- в logs;
- в error response;
- в public env-prefixes.

`NOTION_TOKEN` и `Authorization` никогда не логируются.

## notion client

используется notion api version `2026-03-11`.

перед реализацией проверено, что фиксированная официальная версия `@notionhq/client@5.23.2` опубликована в npm. официальный sdk требует node 18+ и не заявляет supabase edge runtime как прямую целевую среду. поэтому реализация начинается с изолированного compatibility test:

- exact import `npm:@notionhq/client@5.23.2`;
- deno typecheck;
- локальный запуск edge function;
- query configured data source;
- retrieve page;
- retrieve block children;
- update temporary test page.

если sdk проходит этот тест, версия фиксируется в `deno.json`. если возникает runtime incompatibility, `notion-client.ts` сохраняет тот же интерфейс, но использует обычный server-side `fetch` к официальным endpoints:

- `POST /v1/data_sources/{id}/query`;
- `GET /v1/pages/{id}`;
- `PATCH /v1/pages/{id}`;
- `GET /v1/blocks/{id}/children`.

добавление отдельного backend из-за sdk запрещено.

### чтение блоков страницы

`getLessonContent` поддерживает следующие notion block types:

- текст: `paragraph`, `heading_1`, `heading_2`, `heading_3`, `heading_4`;
- списки: `bulleted_list_item`, `numbered_list_item`, `to_do`;
- выделения: `toggle`, `quote`, `callout`, `code`, `divider`, `equation`;
- таблицы и layout containers: `table`, `table_row`, `column_list`, `column`, `synced_block`;
- ссылки и media references: `bookmark`, `link_preview`, `image`, `file`, `pdf`, `video`, `audio`, `embed`.

media и embed не исполняются внутри dashboard: mapper возвращает безопасную ссылку и подпись, а frontend открывает её отдельным явным действием. arbitrary html из notion не рендерится.

неподдерживаемые типы, включая `child_page`, `child_database`, `template`, `breadcrumb`, `table_of_contents`, `link_to_page` и `meeting_notes`, нормализуются в:

```ts
{
  type: 'unsupported'
  sourceType: string
  label: string
}
```

raw block payload клиенту не передаётся.

pagination выполняется отдельно для каждого parent block:

- `page_size = 100`;
- `next_cursor` считается opaque string и без преобразований передаётся как `start_cursor`;
- загрузка продолжается, пока `has_more = false`;
- любой block с `has_children = true` загружается рекурсивно;
- `visitedBlockIds` защищает от повторного обхода;
- максимальная глубина — 10;
- максимальное число нормализованных blocks одной lesson page — 1000;
- при превышении границы возвращается `LESSON_CONTENT_TOO_LARGE`, а не частично выглядящий как полный результат.

inline rich text нормализуется в plain text spans с допустимыми annotations и безопасными links. script, html и event attributes не принимаются.

перед любой mutation repository:

1. получает page;
2. проверяет `parent.type === data_source_id`;
3. сравнивает parent id с `NOTION_DATA_SOURCE_ID`;
4. при несовпадении возвращает 404/forbidden domain error без update.

## validation и property whitelist

допустимые enum values задаются server constants:

- statuses — семь существующих notion options;
- results — `Зачёт`, `Незачёт`, `Требует повторения`;
- autonomy — `A0`, `A1`, `A2`, `A3`;
- missed reasons — шесть существующих options;
- priority, subject, week и decision request — только существующие options.

ограничения:

- understanding — только integer 0–3;
- duration — integer 15–180;
- move count — неотрицательное целое;
- order — конечное число;
- comment — trim и ограничение 1000 unicode code points;
- artifact — только абсолютный `https://` url, максимум 2048 символов;
- `http`, `file`, `javascript`, `data`, `notion` и другие schemes отклоняются;
- url не обрезается автоматически;
- date/time должны попадать в W01 для обычных move-команд;
- `allowOverlap` принимается только как boolean.

server никогда не принимает property name от клиента. mapping command → notion property создаётся в server code.

## coordination-only lock

таблица:

```sql
school_mutation_locks (
  lock_key text primary key,
  lock_token uuid not null,
  locked_until timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
)
```

единственный логический ключ:

`active-lesson:<SCHOOL_OWNER_USER_ID>`.

rpc:

- `acquire_school_mutation_lock(p_lock_key text, p_lock_token uuid, p_ttl_seconds integer) returns boolean`;
- `renew_school_mutation_lock(p_lock_key text, p_lock_token uuid, p_ttl_seconds integer) returns boolean`;
- `release_school_mutation_lock(p_lock_key text, p_lock_token uuid) returns boolean`.

acquire выполняется одной sql operation:

`insert ... on conflict ... do update ... where locked_until < now()`.

renew выполняется одной условной sql operation:

`update ... set locked_until = now() + interval '60 seconds' ... where lock_key = p_lock_key and lock_token = p_lock_token and locked_until >= now()`.

правила:

- lease ttl — ровно 60 секунд;
- acquire и renew отклоняют другое значение ttl;
- отдельный uuid token на запрос;
- максимум три короткие попытки с jitter;
- lock освобождается в `finally`;
- чужой token не освобождает lock;
- после crash lock становится доступен по ttl;
- постоянный interval heartbeat не добавляется;
- после каждого успешного notion read или update внутри locked operation вызывается `renew_school_mutation_lock`;
- renew продлевает `locked_until` только когда совпадают `lock_key`, `lock_token` и lease ещё действует;
- если renew вернул false, операция не начинает следующий notion-step;
- если до потери lease уже выполнен update, service запускает предусмотренную для команды компенсацию, повторно читает notion и возвращает `SCHOOL_LOCK_LOST`.

lock применяется только когда mutation меняет глобальный active state:

- start;
- switch;
- resolve multiple active;
- reopen;
- complete active;
- partial active;
- missed active;
- cancel active;
- pause active before moving.

обычные move, time change, reorder и comment update lock не используют.

при занятом lock:

```json
{
  "error": "SCHOOL_MUTATION_IN_PROGRESS",
  "message": "другая операция с активным уроком ещё выполняется"
}
```

таблица:

- не хранит lesson id, status, schedule или assessment;
- имеет rls;
- не имеет policy для anon/authenticated;
- лишена прямых grants для `public`, `anon`, `authenticated`;
- rpc лишены default `public execute`;
- execute выдаётся только `service_role`;
- edge function вызывает rpc через admin client только после owner check.

миграция сопровождается отдельным rollback sql, удаляющим rpc и таблицу в обратном порядке.

## frontend data flow

### загрузка

1. `school.js` ждёт готовности `window.SupabaseSync.client`;
2. если сессии нет, показывает встроенное состояние входа без обращения к notion;
3. `school-api.js` вызывает `client.functions.invoke('school-notion', ...)`;
4. edge function возвращает нормализованные lessons;
5. `school-core.js` вычисляет views, progress, active state, conflicts и runtime issues;
6. controller рендерит текущую вкладку.

### mutation

1. frontend валидирует действие для быстрого feedback;
2. сохраняет snapshot затронутых lessons;
3. применяет optimistic update;
4. отправляет доменную команду;
5. при success выполняет повторное `listLessons` или точечную revalidation;
6. при error восстанавливает snapshot;
7. 409 открывает соответствующий понятный dialog;
8. после active mutation повторно проверяется глобальное число active lessons.

notion token никогда не передаётся.

## нормализованные ошибки

минимальный набор кодов:

- `UNAUTHORIZED` — 401;
- `FORBIDDEN` — 403;
- `METHOD_NOT_ALLOWED` — 405;
- `ORIGIN_NOT_ALLOWED` — 403;
- `VALIDATION_ERROR` — 400;
- `LESSON_NOT_FOUND` — 404;
- `LESSON_OUTSIDE_SCHOOL_DATABASE` — 404;
- `LESSON_STATUS_TRANSITION_REQUIRED` — 409;
- `ACTIVE_LESSON_EXISTS` — 409;
- `ACTIVE_LESSON_STATE_INCONSISTENT` — 409;
- `SCHOOL_MUTATION_IN_PROGRESS` — 409;
- `SCHOOL_LOCK_LOST` — 409;
- `LESSON_TIME_CONFLICT` — 409;
- `CROSS_WEEK_MOVE_REQUIRES_REVIEW` — 409;
- `NOTION_RATE_LIMITED` — 503 с безопасным retry hint;
- `UPSTREAM_UNAVAILABLE` — 503;
- `INTERNAL_ERROR` — 500.

response не содержит stack, token, auth header, notion raw body или внутренние ids конфигурации.

server logs могут содержать:

- request id;
- operation;
- безопасный lesson page id;
- phase;
- notion request id;
- compensation outcome.

## тестирование

### frontend unit tests

`school-core.js` покрывается node tests:

- 18 lessons и распределение по предметам;
- вычисление progress;
- diary filter;
- next lesson;
- date-only overdue в `Asia/Yekaterinburg`;
- duration fallback и canonical end;
- 15-minute snap;
- 5-minute duration step;
- order insertion и локальная renumber;
- overlap formula и boundary touch;
- short break;
- hasLearningEvidence и isFinalized;
- status transition matrix;
- persisted и derived decision groups;
- canceled exclusions.

### edge unit tests

deno tests покрывают:

- notion mapper;
- recursive block mapper для всех поддерживаемых типов;
- unsupported block fallback без raw payload;
- opaque cursor pagination до `has_more = false`;
- recursive children loading с depth/block limits;
- validation enums;
- integer understanding;
- duration bounds;
- comment limit;
- https-only artifact;
- property whitelist;
- page membership;
- 401;
- 403;
- owner 200;
- active conflict;
- idempotent start;
- status transition guards;
- overlap confirmation;
- cross-week rejection;
- partial completion result;
- missed field clearing;
- canceled preservation.

для destructive paths используется mock notion client.

### postgres tests

- первый request получает lock;
- второй параллельный request не получает;
- владелец освобождает;
- чужой token не освобождает;
- expired lock перехватывается;
- ttl, отличный от 60, отклоняется;
- действующий owner lease продлевается renew-вызовом;
- чужой или истёкший token не продлевает lease;
- anon и authenticated не имеют прямого доступа;
- service role может вызвать rpc.

### concurrency tests

- два параллельных `startLesson` не создают два active lessons;
- `switchActiveLesson` компенсирует ошибку второго notion update;
- после успешной active mutation ровно один урок `В процессе`;
- exception освобождает lock либо lock истекает.

### live verification

после mock tests создаются две временные notion-карточки:

- `[тест A] school-notion live verification`;
- `[тест B] school-notion live verification`.

реальные 18 уроков не изменяются. две карточки нужны для проверки active switch, конкурентных start-команд, overlap и компенсации без использования реальных уроков.

на двух тестовых карточках проверяются:

- list/read content;
- start;
- switch/active guard;
- move date-only;
- move timed;
- duration update;
- return to date-only;
- reload persistence;
- reorder;
- unschedule;
- overlap response;
- complete;
- partial;
- missed;
- cancel/restore;
- decision mark/clear.

после проверки обе тестовые карточки перемещаются в trash. затем runtime notion query обязан снова вернуть:

- 18 активных уроков;
- распределение `9 / 2 / 3 / 2 / 1 / 1`;
- duration 45 у реальных уроков;
- уникальный order внутри каждого дня.

### общая проверка

- `node --test`;
- `node --check` для новых browser js;
- deno typecheck;
- deno lint;
- deno test;
- локальный edge serve;
- 401 без session;
- 403 для другого authenticated user в integration fixture;
- 200 для owner fixture;
- production deploy с `verify_jwt = true`;
- production owner smoke test;
- supabase security advisors;
- visual qa desktop/tablet/mobile;
- keyboard и touch fallback.

## этапы реализации

### этап 1: read-only

- isolated frontend shell;
- auth readiness;
- edge function auth/owner/cors;
- notion adapter;
- `listLessons`;
- подтверждение 18 lessons и subject distribution;
- `getLessonContent`;
- today/week/diary read-only rendering;
- recursive block loading и pagination;
- screenshots desktop и mobile;
- обязательная остановка и пользовательское подтверждение read-only ui.

### этап 2: безопасные mutations

этот этап запрещено начинать до явного подтверждения screenshots пользователем.

- migration lock table и rpc;
- domain validation;
- active lesson commands;
- completion;
- cancellation/history rules;
- server revalidation.

### этап 3: расписание

- move/date-only/timed/unscheduled;
- duration;
- order;
- overlap confirmation;
- cross-week flag;
- optimistic rollback.

### этап 4: live verification и release

- две временные test pages `[тест A]` и `[тест B]`;
- удаление обеих test pages;
- повторное подтверждение 18 lessons;
- production deployment;
- smoke test;
- подробный pr без merge.

## критерии приёмки

- нижняя навигация содержит отдельную вкладку `школа`;
- страница выглядит как часть существующего dashboard и не перегружена декором;
- read-only загрузка показывает ровно 18 реальных lessons;
- содержимое отдельного урока открывается;
- notion blocks загружаются рекурсивно и полностью по pagination;
- после read-only ui показаны desktop/mobile screenshots и получено явное подтверждение до начала mutations;
- notion является единственным источником школьных данных;
- frontend не содержит notion token, service role или ids secrets;
- без сессии edge function возвращает 401;
- другой user получает 403;
- owner получает данные;
- cors разрешает production origin и не отражает произвольный origin;
- global active invariant защищён server lock;
- 60-секундный lease продлевается после каждого успешного notion-step;
- все status transitions соответствуют матрице;
- custom duration переживает date-only и reload;
- move count меняется только при смене дня;
- overlap требует явного подтверждения, но может быть сохранён;
- дневник не включает canceled lessons;
- weekly progress считает только completed lessons;
- persisted decision request не смешивается с derived issues;
- реальные 18 lessons не используются для destructive tests;
- live verification использует только `[тест A]` и `[тест B]`;
- после live test остаются ровно 18 реальных lessons;
- existing 189 tests и все новые tests проходят;
- edge function развёрнута с `verify_jwt = true`;
- pr создаётся с подробным русским описанием и не merge-ится автоматически.
