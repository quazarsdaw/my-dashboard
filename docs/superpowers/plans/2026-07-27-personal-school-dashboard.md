# план реализации личной школы

> **для agentic workers:** обязательный sub-skill: использовать `superpowers:subagent-driven-development` или `superpowers:executing-plans`, выполнять задачи строго по порядку и останавливаться на контрольной точке после read-only ui.

**цель:** добавить в существующий dashboard отдельную вкладку `школа`, безопасно читать уроки и содержимое из notion через supabase edge function, а после отдельного пользовательского подтверждения подключить строго ограниченные mutations без копирования школьных данных в supabase.

**архитектура:** `school.html`, `school.css`, `school-core.js`, `school-api.js` и `school.js` образуют изолированный frontend-модуль и переиспользуют существующие topbar, profile theme и supabase auth. одна edge function `school-notion` проверяет jwt, owner id и cors, преобразует notion responses в доменную модель и принимает только явно перечисленные команды. notion остаётся единственным источником уроков; postgres хранит только 60-секундный coordination lock для операций с глобальным активным уроком.

**технологии:** vanilla javascript, css, `node:test`, supabase auth, supabase edge functions, deno, `@supabase/server@1.4.1`, проверяемый `@notionhq/client@5.23.2`, notion api `2026-03-11`, postgresql rpc, playwright/chromium.

## глобальные ограничения

- production dashboard origin: `https://quazarsdaw.github.io`;
- production page: `https://quazarsdaw.github.io/my-dashboard/school.html`;
- notion является единственным source of truth для уроков, расписания, статусов, оценок, порядка и отметок;
- frontend не получает `NOTION_TOKEN`, service-role key, raw notion payload или server-side ids;
- secrets хранятся только в supabase: `NOTION_TOKEN`, `NOTION_DATA_SOURCE_ID`, `NOTION_DATABASE_PAGE_ID`, `NOTION_SCHOOL_PAGE_ID`, `SCHOOL_OWNER_USER_ID`, `DASHBOARD_ORIGIN`;
- edge function всегда разворачивается с проверкой jwt; режим `auth: none` запрещён;
- запрос разрешён только владельцу, чей session user id совпадает с `SCHOOL_OWNER_USER_ID`;
- cors в production отвечает только origin `https://quazarsdaw.github.io`; localhost разрешается только локально при `SCHOOL_ENV=development`;
- notion sdk фиксируется как `npm:@notionhq/client@5.23.2`; при доказанной несовместимости edge runtime используется server-side fetch с тем же внутренним интерфейсом;
- `Краткий комментарий` ограничен 1000 unicode code points;
- artifact принимает только абсолютный `https://` url длиной не более 2048 символов;
- lock lease равен ровно 60 секундам и продлевается после каждого успешного notion read/update внутри locked operation;
- production logs не содержат notion token, authorization header, service-role key или raw notion response;
- никакие реальные 18 уроков не изменяются в unit/integration/live mutation-тестах;
- live mutation verification использует только две временные страницы `[тест A] school-notion live verification` и `[тест B] school-notion live verification`;
- после задачи 7 действует обязательная остановка: задачи 8–16 запрещено начинать без явного подтверждения desktop/mobile screenshots пользователем;
- все тексты интерфейса, коммиты, issue и pr оформляются на русском языке с маленькой буквы;
- pr содержит подробное описание влияния и проверок и никогда не merge-ится автоматически;
- существующий незапрошенный `docs/superpowers/.DS_Store` не изменять и не добавлять в git.

## основные интерфейсы

frontend domain:

```js
Lesson = {
  id, title, subject, module,
  schedule: { kind, date, start, end },
  status, priority, week, result, autonomy, understanding,
  artifactUrl, comment, missedReason, moveCount,
  durationMinutes, order, decisionRequest,
  hasLearningEvidence, isFinalized, warnings
}

SchoolCore.buildReadModel(lessons, {
  now,
  timeZone: 'Asia/Yekaterinburg',
  activeWeek
}) -> {
  today, weekDays, diary, progress, activeLessons,
  persistedDecisions, runtimeIssues
}
```

edge transport:

```ts
type SchoolReadCommand =
  | { operation: 'listLessons'; from?: string; to?: string; week?: string }
  | { operation: 'getLessonContent'; lessonId: string }

type SchoolSuccess<T> = {
  ok: true
  data: T
  requestId: string
}

type SchoolFailure = {
  ok: false
  error: string
  message: string
  requestId: string
  details?: Record<string, unknown>
}
```

notion boundary:

```ts
interface SchoolNotionReadClient {
  queryDataSource(input: QueryLessonsInput): Promise<NotionQueryResponse>
  retrievePage(pageId: string): Promise<NotionPage>
  listBlockChildren(blockId: string, startCursor?: string): Promise<NotionBlockPage>
}

interface SchoolNotionMutationClient extends SchoolNotionReadClient {
  updatePage(pageId: string, properties: WhitelistedProperties): Promise<NotionPage>
}

interface LessonRepository {
  listLessons(filter: LessonFilter): Promise<Lesson[]>
  getLesson(lessonId: string): Promise<Lesson>
  getLessonContent(lessonId: string): Promise<LessonContentBlock[]>
  updateLesson(command: RepositoryMutation): Promise<Lesson>
}
```

---

## часть i: read-only реализация

### задача 1: тестовый каркас и чистая модель школы

**файлы:**

- создать: `school-core.js`;
- создать: `test/school-core.test.cjs`.

**интерфейсы:**

- `normalizeLesson(raw) -> Lesson`;
- `getLessonDayKey(lesson, timeZone) -> string | null`;
- `sortLessonsForDay(lessons) -> Lesson[]`;
- `computeWeeklyProgress(lessons) -> { completed, total, partial, missed }`;
- `selectDiaryLessons(lessons) -> Lesson[]`;
- `selectNextLesson(lessons, now, timeZone) -> Lesson | null`;
- `computeRuntimeIssues(lessons, now, timeZone) -> RuntimeIssue[]`;
- `buildReadModel(lessons, context) -> SchoolReadModel`.

- [ ] **шаг 1: написать падающие тесты недельной модели**

покрыть fixture из 18 уроков и проверить:

```js
assert.deepEqual(SchoolCore.countSubjects(lessons), {
  'Software Engineering': 9,
  'DevOps & Infrastructure': 2,
  'English & IELTS': 3,
  Mathematics: 2,
  University: 1,
  'Director & Assessment': 1
});

assert.deepEqual(
  SchoolCore.computeWeeklyProgress([
    lesson({ status: 'Выполнен' }),
    lesson({ status: 'Частично выполнен' }),
    lesson({ status: 'Пропущен' }),
    lesson({ status: 'Отменён' })
  ]),
  { completed: 1, total: 3, partial: 1, missed: 1 }
);
```

добавить отдельные тесты:

- активный урок всегда первый на экране `сегодня`;
- diary включает `Выполнен`, `Частично выполнен`, `Пропущен`, но исключает `Отменён`;
- date-only урок становится просроченным только после конца дня в `Asia/Yekaterinburg`;
- canceled lesson не участвует в next lesson, progress, overlap и active decision queue;
- persisted decision request и derived issues возвращаются отдельными массивами;
- одинаковый `Порядок` в одном дне создаёт runtime issue;
- `Запланирован` с оценочными данными создаёт runtime issue;
- несколько `В процессе` создают одну глобальную runtime issue.

- [ ] **шаг 2: подтвердить red**

```bash
node --test test/school-core.test.cjs
```

ожидаемый результат: `fail`, потому что `school-core.js` и его exports отсутствуют.

- [ ] **шаг 3: реализовать минимальную чистую модель**

использовать совместимый с browser и commonjs wrapper. не обращаться к dom, notion, supabase, `localStorage` или текущему времени напрямую; `now` и `timeZone` всегда передавать аргументами.

- [ ] **шаг 4: довести тесты до green и проверить syntax**

```bash
node --check school-core.js
node --test test/school-core.test.cjs
```

- [ ] **шаг 5: зафиксировать логический блок**

```bash
git add school-core.js test/school-core.test.cjs
git commit -m "добавить модель данных личной школы"
```

---

### задача 2: защищённый edge transport и совместимость notion sdk

**файлы:**

- создать: `supabase/config.toml`;
- создать через cli: `supabase/.gitignore`;
- создать: `supabase/functions/school-notion/deno.json`;
- создать: `supabase/functions/school-notion/index.ts`;
- создать: `supabase/functions/school-notion/auth.ts`;
- создать: `supabase/functions/school-notion/cors.ts`;
- создать: `supabase/functions/school-notion/errors.ts`;
- создать: `supabase/functions/school-notion/router.ts`;
- создать: `supabase/functions/school-notion/notion-client.ts`;
- создать: `supabase/functions/school-notion/types.ts`;
- создать: `supabase/functions/school-notion/test/auth_test.ts`;
- создать: `supabase/functions/school-notion/test/notion_sdk_compatibility_test.ts`.

**интерфейсы:**

- `authorizeRequest(request, env, createUserClient) -> Promise<AuthContext>`;
- `buildCorsHeaders(requestOrigin, env) -> Headers`;
- `normalizeError(error, requestId) -> Response`;
- `createSchoolNotionReadClient(env) -> SchoolNotionReadClient`;
- `handleRequest(request, dependencies) -> Promise<Response>`.

- [ ] **шаг 1: проверить доступный cli перед созданием структуры**

```bash
npx supabase --help
npx supabase init
npx supabase functions new school-notion
```

сохранить структуру, созданную cli; не придумывать служебные файлы supabase вручную. проверить, что local env исключён в `supabase/.gitignore`, затем заменить только содержимое функции через `apply_patch`.

- [ ] **шаг 2: зафиксировать exact imports**

`deno.json` должен содержать:

```json
{
  "imports": {
    "@supabase/server": "npm:@supabase/server@1.4.1",
    "@notionhq/client": "npm:@notionhq/client@5.23.2"
  },
  "tasks": {
    "check": "deno check index.ts test/*.ts",
    "lint": "deno lint",
    "test": "deno test --allow-env test"
  }
}
```

- [ ] **шаг 3: написать падающие transport tests**

проверить:

- `OPTIONS` от разрешённого origin возвращает 204 до auth;
- origin вне allowlist возвращает `ORIGIN_NOT_ALLOWED`;
- отсутствующая или недействительная сессия возвращает 401;
- действующий не-owner возвращает 403;
- owner достигает router и получает 200;
- error body не содержит authorization header, token, stack или env values;
- allowed headers ограничены `authorization`, `apikey`, `content-type`, `x-client-info`.

- [ ] **шаг 4: написать compatibility test sdk**

тест обязан импортировать именно `@notionhq/client`, создать `Client` с test token и подтвердить доступность методов query/retrieve/list/update без сетевого вызова. production wrapper до read-only gate реализует только `SchoolNotionReadClient`; `updatePage` в него не добавляется. затем:

```bash
cd supabase/functions/school-notion
deno task check
deno test test/notion_sdk_compatibility_test.ts
```

если import, typecheck или локальный runtime ломается, сохранить интерфейс `SchoolNotionReadClient`, убрать sdk из production path и реализовать официальный `fetch` только для read endpoints с `Notion-Version: 2026-03-11`. отдельный backend не создавать. `PATCH` не добавлять до прохождения read-only gate.

- [ ] **шаг 5: реализовать auth, owner check, cors и безопасные ошибки**

порядок handler:

1. создать `requestId`;
2. проверить method и origin;
3. обработать `OPTIONS`;
4. создать request-scoped supabase context;
5. получить user из действующей сессии;
6. сравнить user id с `SCHOOL_OWNER_USER_ID`;
7. разобрать json body;
8. передать только нормализованный command в router.

- [ ] **шаг 6: запустить локальные проверки**

```bash
cd supabase/functions/school-notion
deno task check
deno task lint
deno task test
```

- [ ] **шаг 7: зафиксировать логический блок**

```bash
git add supabase/config.toml supabase/.gitignore supabase/functions/school-notion
git commit -m "добавить защищённый transport школы"
```

---

### задача 3: notion mapper и read-only listLessons

**файлы:**

- создать: `supabase/functions/school-notion/notion-mapper.ts`;
- создать: `supabase/functions/school-notion/lesson-repository.ts`;
- создать: `supabase/functions/school-notion/lesson-service.ts`;
- изменить: `supabase/functions/school-notion/router.ts`;
- изменить: `supabase/functions/school-notion/types.ts`;
- создать: `supabase/functions/school-notion/test/notion-mapper_test.ts`;
- создать: `supabase/functions/school-notion/test/list-lessons_test.ts`;
- создать: `supabase/functions/school-notion/test/fixtures/notion-lessons.ts`.

**интерфейсы:**

- `mapNotionPageToLesson(page) -> Lesson`;
- `normalizeNotionDate(dateProperty, durationProperty) -> LessonSchedule`;
- `repository.listLessons({ from, to, week }) -> Promise<Lesson[]>`;
- `service.listLessons(command) -> Promise<{ lessons, counts, total }>`;
- whitelist read schema содержит ровно 17 согласованных свойств notion.

- [ ] **шаг 1: написать падающие mapper tests**

проверить:

- title, select, rich text, number, url и nullable поля;
- date-only, timed и unscheduled schedule;
- duration fallback: разница start/end для старой timed записи, иначе 45;
- canonical duration остаётся `Продолжительность, мин`;
- `hasLearningEvidence` не зависит от содержимого страницы;
- `isFinalized` истинен только для completed/partial/missed;
- raw property ids и raw notion body не попадают в `Lesson`.

- [ ] **шаг 2: написать падающие repository tests**

mock client должен вернуть две страницы notion pagination и подтвердить, что:

- `next_cursor` передаётся без преобразования;
- query продолжает работу до `has_more = false`;
- фильтр week/range строится только server-side;
- archived/in_trash pages исключаются;
- fixture даёт ровно 18 уроков и распределение `9 / 2 / 3 / 2 / 1 / 1`.

- [ ] **шаг 3: реализовать mapper, repository и route**

разрешить только:

```json
{ "operation": "listLessons", "week": "W01 · 3–9 августа 2026" }
```

или ISO range внутри server limits. неизвестные keys не превращать в notion filter.

- [ ] **шаг 4: выполнить unit tests**

```bash
cd supabase/functions/school-notion
deno test test/notion-mapper_test.ts test/list-lessons_test.ts
deno task check
deno task lint
```

- [ ] **шаг 5: зафиксировать чтение уроков**

```bash
git add supabase/functions/school-notion
git commit -m "добавить чтение уроков notion"
```

---

### задача 4: полное и безопасное чтение содержимого урока

**файлы:**

- создать: `supabase/functions/school-notion/block-mapper.ts`;
- создать: `supabase/functions/school-notion/block-loader.ts`;
- изменить: `supabase/functions/school-notion/lesson-repository.ts`;
- изменить: `supabase/functions/school-notion/lesson-service.ts`;
- изменить: `supabase/functions/school-notion/router.ts`;
- изменить: `supabase/functions/school-notion/types.ts`;
- создать: `supabase/functions/school-notion/test/block-mapper_test.ts`;
- создать: `supabase/functions/school-notion/test/block-loader_test.ts`.

**поддерживаемые block types:**

- text: `paragraph`, `heading_1`, `heading_2`, `heading_3`, `heading_4`;
- list: `bulleted_list_item`, `numbered_list_item`, `to_do`;
- emphasis: `toggle`, `quote`, `callout`, `code`, `divider`, `equation`;
- containers: `table`, `table_row`, `column_list`, `column`, `synced_block`;
- references: `bookmark`, `link_preview`, `image`, `file`, `pdf`, `video`, `audio`, `embed`;
- fallback: любой другой type становится `{ type: 'unsupported', sourceType, label }`.

**интерфейсы:**

- `mapBlock(block, children) -> LessonContentBlock`;
- `loadBlockChildren(rootId, client, limits) -> Promise<LessonContentBlock[]>`;
- `repository.assertSchoolLesson(pageId) -> Promise<NotionPage>`;
- `service.getLessonContent(lessonId) -> Promise<{ lesson, blocks }>`;
- `safeExternalUrl(value) -> string | null`.

- [ ] **шаг 1: написать mapper tests для каждого поддерживаемого типа**

проверить rich text spans, annotations, safe links, checked state, code language, table rows, captions и nested children. media/embed возвращают только подпись и безопасную ссылку; html не рендерится.

- [ ] **шаг 2: написать pagination и recursion tests**

зафиксировать:

- `page_size = 100`;
- `next_cursor` передаётся как opaque `start_cursor`;
- каждый parent загружается до `has_more = false`;
- recursion выполняется только для `has_children = true`;
- `visitedBlockIds` предотвращает повторный обход;
- max depth = 10;
- max normalized blocks = 1000;
- превышение возвращает `LESSON_CONTENT_TOO_LARGE`, не partial response.

- [ ] **шаг 3: написать membership test**

до чтения content получить page и проверить:

```ts
page.parent.type === 'data_source_id'
page.parent.data_source_id === env.NOTION_DATA_SOURCE_ID
```

иначе вернуть `LESSON_OUTSIDE_SCHOOL_DATABASE` без list children.

- [ ] **шаг 4: реализовать loader и route**

разрешить только:

```json
{ "operation": "getLessonContent", "lessonId": "notion-page-id" }
```

raw blocks, file expiry metadata и notion property ids клиенту не передавать.

- [ ] **шаг 5: запустить проверки**

```bash
cd supabase/functions/school-notion
deno test test/block-mapper_test.ts test/block-loader_test.ts
deno task check
deno task lint
```

- [ ] **шаг 6: зафиксировать чтение content**

```bash
git add supabase/functions/school-notion
git commit -m "добавить чтение содержимого уроков"
```

---

### задача 5: frontend adapter к существующей supabase session

**файлы:**

- создать: `school-api.js`;
- создать: `test/school-api.test.cjs`;
- изменить: `school-core.js`;
- изменить: `test/school-core.test.cjs`.

**интерфейсы:**

- `SchoolApi.waitForAuth() -> Promise<{ client, user }>`;
- `SchoolApi.listLessons({ week, from, to }) -> Promise<Lesson[]>`;
- `SchoolApi.getLessonContent(lessonId) -> Promise<LessonContent>`;
- `SchoolApi.invoke(command) -> Promise<SchoolSuccess>`;
- `SchoolApi.toSchoolError(functionError, response) -> SchoolClientError`.

- [ ] **шаг 1: написать падающие adapter tests**

через stub `window.SupabaseSync` проверить:

- отсутствие session не вызывает edge function;
- текущая session используется существующим `client.functions.invoke`;
- notion token и server ids не появляются в body;
- 401/403/409/503 превращаются в нормализованные client errors;
- list и content принимают только whitelisted arguments.

- [ ] **шаг 2: реализовать adapter без нового supabase client**

не импортировать anon key повторно и не читать auth token вручную. использовать только `window.SupabaseSync.client` и текущую session.

- [ ] **шаг 3: выполнить tests**

```bash
node --check school-api.js
node --test test/school-api.test.cjs test/school-core.test.cjs
```

- [ ] **шаг 4: зафиксировать adapter**

```bash
git add school-api.js school-core.js test/school-api.test.cjs test/school-core.test.cjs
git commit -m "подключить read-only api школы"
```

---

### задача 6: навигация и утверждённый read-only интерфейс

**файлы:**

- создать: `school.html`;
- создать: `school.css`;
- создать: `school.js`;
- изменить: `topbar.js`;
- создать: `test/school-ui.test.cjs`;
- изменить: `test/ui-polish.test.cjs`.

**интерфейсы:**

- `SchoolController.load()`;
- `SchoolController.selectView('today' | 'week' | 'diary')`;
- `SchoolController.openLesson(lessonId)`;
- `SchoolController.render(readModel)`;
- dom states: loading, unauthenticated, forbidden, unavailable, empty, ready;
- bottom nav order: `главная → входящие → трекер → школа → меню → цели → магазин → профиль`.

- [ ] **шаг 1: написать падающие static/dom tests**

проверить:

- `school.html` подключает существующие theme/topbar/supabase scripts и новые school scripts в корректном порядке;
- страница имеет `data-page="school"`;
- пункт `школа` расположен после `трекер` и до `меню`;
- `.bottombar` использует восемь колонок;
- доступны вкладки `сегодня`, `неделя`, `дневник`;
- progress подписан `выполнено X из Y`;
- lesson drawer/dialog имеет focus management и закрытие по escape;
- read-only интерфейс не содержит mutation controls, drag listeners или optimistic state;
- content renderer создаёт dom nodes через text content и безопасные attributes, не использует raw `innerHTML` из notion.

- [ ] **шаг 2: реализовать desktop layout**

сохранить утверждённое направление:

- минималистичный тёмный интерфейс существующего dashboard;
- недельная колонная сетка;
- date-only зона над временной сеткой;
- hourly labels и optional слабая half-hour line;
- compact status/subject labels;
- today focus card;
- diary rows по запланированной дате;
- section `требует решения` с отдельными persisted/derived группами;
- canceled cards приглушены и не попадают в diary.

- [ ] **шаг 3: реализовать mobile layout**

на ширине 390 px:

- переключатель вкладок остаётся доступным;
- week переходит в горизонтально прокручиваемые дни или последовательные day panels без обрезки текста;
- bottom nav остаётся рабочей;
- drawer lesson content занимает доступную ширину;
- interactive targets не меньше 44 px;
- основной документ не получает горизонтальный overflow.

- [ ] **шаг 4: подключить только read-only controller**

controller может вызывать только `listLessons` и `getLessonContent`. server router на этом этапе также не содержит mutation routes.

- [ ] **шаг 5: выполнить tests**

```bash
node --check school.js
node --check school-api.js
node --check school-core.js
node --test test/school-core.test.cjs test/school-api.test.cjs test/school-ui.test.cjs
node --test
```

- [ ] **шаг 6: зафиксировать read-only ui**

```bash
git add school.html school.css school.js topbar.js test/school-ui.test.cjs test/ui-polish.test.cjs
git commit -m "добавить read-only интерфейс личной школы"
```

перед commit проверить `git diff --cached --name-only` и убрать из index любые незапрошенные файлы.

---

### задача 7: live read-only проверка, screenshots и обязательная остановка

**файлы:**

- код не изменять;
- screenshots сохранять во временную директорию вне git;
- при необходимости использовать untracked local env, который уже исключён из git.

- [ ] **шаг 1: настроить только server-side secrets**

проверить наличие всех шести secret names без вывода значений. production `DASHBOARD_ORIGIN` должен быть ровно `https://quazarsdaw.github.io`. не добавлять secrets в frontend или tracked env.

- [ ] **шаг 2: запустить edge function локально**

сначала проверить команды текущего cli через `--help`, затем запустить `school-notion` с jwt verification и local development origin. выполнить:

- request без session → 401;
- request другого authenticated fixture user → 403;
- request owner → 200;
- `listLessons` → ровно 18;
- subject counts → `9 / 2 / 3 / 2 / 1 / 1`;
- `getLessonContent` → полное содержимое одного реального урока без mutation.

- [ ] **шаг 3: выполнить read-only production smoke**

развернуть только read-only версию `school-notion` с `verify_jwt = true`. mutation routes на этой стадии физически отсутствуют.

- [ ] **шаг 4: запустить dashboard preview**

использовать фактический local origin из development config. проверить authenticated owner flow и отсутствие запросов notion при unauthenticated state.

- [ ] **шаг 5: провести visual qa**

снять:

- desktop screenshot: viewport 1440 × 1000;
- mobile screenshot: viewport 390 × 844.

на обеих проверить:

- вкладку `школа` в нижней навигации;
- today/week/diary;
- progress;
- карточки со временем и без времени;
- canceled visual state;
- `требует решения`;
- открытие content одного урока;
- loading/error/empty states;
- отсутствие горизонтального overflow;
- keyboard focus и escape.

- [ ] **шаг 6: показать пользователю screenshots и остановиться**

в сообщении дать:

- desktop screenshot;
- mobile screenshot;
- результат `node --test`;
- результат deno check/lint/test;
- подтверждение 18 lessons и subject distribution;
- результат 401/403/200;
- ссылку на read-only production page, если она уже доступна.

**обязательный gate:** не создавать migration lock, не добавлять mutation routes, не менять реальные уроки и не начинать задачу 8 до явного сообщения пользователя, что screenshots утверждены и write stage разрешён.

---

## часть ii: mutations — выполнять только после явного подтверждения задачи 7

### задача 8: coordination-only lock migration и rpc

**файлы:**

- создать через cli: `supabase/migrations/*_school_mutation_locks.sql`;
- создать: `supabase/rollback/school_mutation_locks.sql`;
- создать: `supabase/tests/school_mutation_locks.sql`;
- создать: `supabase/functions/school-notion/lock-service.ts`;
- создать: `supabase/functions/school-notion/test/lock-service_test.ts`.

**интерфейсы:**

- `acquire_school_mutation_lock(lock_key, lock_token, ttl_seconds) returns boolean`;
- `renew_school_mutation_lock(lock_key, lock_token, ttl_seconds) returns boolean`;
- `release_school_mutation_lock(lock_key, lock_token) returns boolean`;
- `withActiveLessonLock(ownerId, operation) -> Promise<T>`;
- ttl constant: `SCHOOL_LOCK_TTL_SECONDS = 60`.

- [ ] **шаг 1: создать migration только через cli**

```bash
npx supabase migration new school_mutation_locks
```

сразу найти созданный конкретный path через `git status --short supabase/migrations` и использовать его во всех последующих командах.

- [ ] **шаг 2: написать падающие postgres tests**

проверить:

- первый token получает lock;
- параллельный второй token получает false;
- release работает только с совпавшим token;
- expired lease можно перехватить;
- acquire/renew с ttl не равным 60 отклоняются;
- renew продлевает только действующий совпавший lease;
- expired/foreign token не продлевает lease;
- anon/authenticated/public не имеют table или function access;
- service_role имеет execute только на три rpc.

- [ ] **шаг 3: реализовать atomic sql**

`acquire` выполняется одной `insert ... on conflict ... do update ... where locked_until < now()`. `renew` выполняется одним conditional `update` при совпадении key/token и неистёкшем lease. `release` удаляет только совпавший key/token.

таблица включает только:

```sql
lock_key text primary key,
lock_token uuid not null,
locked_until timestamptz not null,
created_at timestamptz not null default now(),
updated_at timestamptz not null default now()
```

- [ ] **шаг 4: добавить rollback**

rollback удаляет grants, три rpc и таблицу в обратном порядке. он не затрагивает auth, user data или notion.

- [ ] **шаг 5: написать lock-service tests**

mock rpc проверяет максимум три попытки с коротким jitter, `finally` release и отсутствие token в logs. `renew()` вызывается явно после каждого успешного notion step.

- [ ] **шаг 6: выполнить db и deno проверки**

использовать команды текущего supabase cli, предварительно проверенные через `supabase test db --help` и `supabase db reset --help`.

- [ ] **шаг 7: зафиксировать migration**

```bash
git add supabase/migrations supabase/rollback supabase/tests supabase/functions/school-notion
git commit -m "добавить блокировку изменений активного урока"
```

---

### задача 9: validation, property whitelist и command router

**файлы:**

- создать: `supabase/functions/school-notion/validation.ts`;
- создать: `supabase/functions/school-notion/notion-properties.ts`;
- изменить: `supabase/functions/school-notion/router.ts`;
- изменить: `supabase/functions/school-notion/types.ts`;
- создать: `supabase/functions/school-notion/test/validation_test.ts`;
- создать: `supabase/functions/school-notion/test/property-whitelist_test.ts`.

**интерфейсы:**

- `parseSchoolCommand(value) -> SchoolCommand`;
- `countUnicodeCodePoints(value) -> number`;
- `validateArtifactUrl(value) -> string | null`;
- `buildWhitelistedProperties(command, currentLesson) -> WhitelistedProperties`;
- `assertLessonBelongsToSchool(page)`.
- `createSchoolNotionMutationClient(env) -> SchoolNotionMutationClient`, расширяющий уже проверенный read client методом `updatePage`.

- [ ] **шаг 1: написать падающие validation tests**

покрыть:

- все enum values и отклонение неизвестных;
- understanding только integer 0–3;
- duration integer 15–180;
- comment 1000 unicode code points проходит, 1001 отклоняется, surrogate pair считается одной code point;
- artifact только absolute https и максимум 2048;
- unknown request/property fields не проходят;
- `allowOverlap` только boolean;
- обычная дата move только внутри W01;
- page membership проверяется перед каждым update.

- [ ] **шаг 2: реализовать explicit command schemas**

не принимать raw notion property names, arbitrary status string, raw filter или raw update body. mapper command → properties должен перечислять каждое разрешённое поле.

на этом шаге впервые добавить `PATCH /v1/pages/{id}` в fetch fallback либо `pages.update` в sdk wrapper. до этого commit history production-кода не должна содержать notion update path.

- [ ] **шаг 3: выполнить tests и commit**

```bash
cd supabase/functions/school-notion
deno test test/validation_test.ts test/property-whitelist_test.ts
deno task check
deno task lint
git add supabase/functions/school-notion
git commit -m "добавить валидацию команд школы"
```

---

### задача 10: глобальный активный урок и lease renewal

**файлы:**

- создать: `supabase/functions/school-notion/active-lesson-service.ts`;
- изменить: `supabase/functions/school-notion/lesson-repository.ts`;
- изменить: `supabase/functions/school-notion/lesson-service.ts`;
- изменить: `supabase/functions/school-notion/router.ts`;
- создать: `supabase/functions/school-notion/test/active-lesson-service_test.ts`;
- создать: `supabase/functions/school-notion/test/active-lesson-concurrency_test.ts`.

**команды:**

- `startLesson`;
- `switchActiveLesson`;
- `resolveActiveLessonState`;
- `reopenLesson`.

- [ ] **шаг 1: написать падающие state tests**

проверить idempotent start, `ACTIVE_LESSON_EXISTS`, несколько active → `ACTIVE_LESSON_STATE_INCONSISTENT`, reopen final lesson и owner-only access.

- [ ] **шаг 2: написать lease sequence tests**

для `switchActiveLesson` проверить точную последовательность:

1. acquire;
2. notion read active;
3. renew;
4. notion read old/new pages;
5. renew после каждого read;
6. update previous → `Запланирован`;
7. renew;
8. update new → `В процессе`;
9. renew;
10. re-read active;
11. renew;
12. assert exactly one;
13. release in `finally`.

если renew вернул false, следующий notion step запрещён и возвращается `SCHOOL_LOCK_LOST`.

- [ ] **шаг 3: написать compensation test**

если второй update падает после изменения предыдущего:

- вернуть предыдущий в `В процессе`;
- renew после успешной компенсации;
- повторно прочитать active state;
- записать безопасный compensation outcome;
- вернуть нормализованную ошибку.

- [ ] **шаг 4: реализовать service и выполнить tests**

```bash
cd supabase/functions/school-notion
deno test test/active-lesson-service_test.ts test/active-lesson-concurrency_test.ts
deno task check
deno task lint
```

- [ ] **шаг 5: зафиксировать active commands**

```bash
git add supabase/functions/school-notion
git commit -m "добавить управление активным уроком"
```

---

### задача 11: завершение, пропуск, отмена и сохранение истории

**файлы:**

- создать: `supabase/functions/school-notion/assessment-service.ts`;
- изменить: `supabase/functions/school-notion/lesson-service.ts`;
- изменить: `supabase/functions/school-notion/router.ts`;
- создать: `supabase/functions/school-notion/test/assessment-service_test.ts`;
- создать: `supabase/functions/school-notion/test/cancellation-service_test.ts`.

**команды:**

- `completeLesson`;
- `cancelLesson`;
- `restoreLesson`;
- `resetLessonEvidence`.

- [ ] **шаг 1: написать status semantics tests**

проверить:

- completed требует autonomy и understanding, result default `Зачёт` редактируем;
- partial требует autonomy и understanding, result всегда `Требует повторения`;
- missed требует missed reason и очищает result/autonomy/understanding;
- canceled не получает новые оценки и сохраняет существующие данные;
- finalized completed/partial нельзя напрямую cancel;
- missed нельзя одним действием превратить в canceled;
- reopen сохраняет evidence;
- `resetLessonEvidence` очищает только после отдельной явной команды.

- [ ] **шаг 2: проверить lock use**

active lesson completion/partial/missed/cancel выполняются через global lock и renew после каждого notion step. не-active assessment не захватывает lock без необходимости.

- [ ] **шаг 3: реализовать, проверить и commit**

```bash
cd supabase/functions/school-notion
deno test test/assessment-service_test.ts test/cancellation-service_test.ts
deno task check
deno task lint
git add supabase/functions/school-notion
git commit -m "добавить завершение и историю уроков"
```

---

### задача 12: расписание, duration, order, overlaps и decision request

**файлы:**

- создать: `supabase/functions/school-notion/schedule-service.ts`;
- изменить: `supabase/functions/school-notion/lesson-service.ts`;
- изменить: `supabase/functions/school-notion/router.ts`;
- изменить: `school-core.js`;
- изменить: `test/school-core.test.cjs`;
- создать: `supabase/functions/school-notion/test/schedule-service_test.ts`.

**команды:**

- `moveLesson`;
- `unscheduleLesson`;
- `changeLessonDuration`;
- `reorderLesson`;
- `markDecisionRequest`;
- `clearDecisionRequest`;
- `restoreMissedLesson`;
- `pauseAndMoveActiveLesson`.

- [ ] **шаг 1: написать core tests**

покрыть:

- drag snap 15 минут;
- duration step 5 минут;
- canonical end = start + duration;
- date-only сохраняет custom duration;
- возврат timed после reload использует сохранённую duration;
- move within same day не меняет move count;
- move between days увеличивает move count ровно на один;
- order midpoint, prepend, append и локальная renumber;
- overlap formula с boundary touch;
- short break меньше 5 минут;
- active week config не размазан по ui.

- [ ] **шаг 2: написать server transition tests**

проверить матрицу drag/status, W01 boundary, `CROSS_WEEK_MOVE_REQUIRES_REVIEW`, persisted decision idempotency, overlap 409 без `allowOverlap`, разрешённый overlap с true, canceled exclusion.

- [ ] **шаг 3: реализовать server revalidation**

перед timed update повторно прочитать уроки дня. при конфликте вернуть:

```json
{
  "error": "LESSON_TIME_CONFLICT",
  "conflicts": []
}
```

не изменять другие уроки. `Поставить после него` вычисляется доменной командой и повторно валидируется.

- [ ] **шаг 4: выполнить tests и commit**

```bash
node --test test/school-core.test.cjs
cd supabase/functions/school-notion
deno test test/schedule-service_test.ts
deno task check
deno task lint
git add school-core.js test/school-core.test.cjs supabase/functions/school-notion
git commit -m "добавить изменения расписания школы"
```

---

### задача 13: frontend mutations, dialogs и rollback

**файлы:**

- изменить: `school-api.js`;
- изменить: `school-core.js`;
- изменить: `school.js`;
- изменить: `school.css`;
- изменить: `school.html`;
- изменить: `test/school-api.test.cjs`;
- изменить: `test/school-core.test.cjs`;
- изменить: `test/school-ui.test.cjs`.

**интерфейсы:**

- `SchoolApi.mutate(command)`;
- `SchoolController.runMutation(command, optimisticReducer)`;
- `SchoolController.revalidateAfterMutation()`;
- dialogs: active conflict, overlap, current lesson move, missed restore, finalized reopen, cancel evidence, cross-week review.

- [ ] **шаг 1: написать падающие optimistic rollback tests**

проверить snapshot, optimistic update, rollback на error, full revalidation на success и active count recheck после active mutation.

- [ ] **шаг 2: написать ui transition tests**

проверить:

- finalized/canceled cards не начинают drag;
- active same-day move разрешён;
- active cross-day move требует pause;
- missed drop требует restore confirmation;
- overlap 409 открывает dialog и повторяет request только с `allowOverlap: true`;
- global active 409 показывает текущий урок;
- `SCHOOL_MUTATION_IN_PROGRESS` временно блокирует повторное нажатие;
- keyboard/touch fallback выполняет те же команды.

- [ ] **шаг 3: реализовать interactions**

drag preview показывает `14:15–15:00`, snapping выполняется по 15 минут, duration меняется по 5. frontend conflict preview не заменяет server revalidation.

- [ ] **шаг 4: выполнить tests и commit**

```bash
node --check school.js
node --check school-api.js
node --check school-core.js
node --test test/school-core.test.cjs test/school-api.test.cjs test/school-ui.test.cjs
node --test
git add school.html school.css school.js school-api.js school-core.js test/school-api.test.cjs test/school-core.test.cjs test/school-ui.test.cjs
git commit -m "подключить изменения уроков в интерфейсе"
```

---

### задача 14: live verification только на двух временных карточках

**файлы:**

- production code не менять без обнаруженного дефекта;
- автоматизированные destructive tests продолжают использовать mock notion client.

- [ ] **шаг 1: создать `[тест A]` и `[тест B]`**

обе страницы создать в существующем school data source, явно пометить названиями и заполнить только валидными тестовыми значениями W01.

- [ ] **шаг 2: проверить read/write matrix**

на A/B проверить:

- list и content;
- start, active conflict, switch;
- параллельные start не создают два active;
- timed/date-only/unscheduled;
- duration update и reload persistence;
- reorder;
- overlap 409 и explicit allow;
- complete, partial, missed;
- cancel/restore;
- decision mark/clear;
- lock renew и compensation через mock-induced failure.

- [ ] **шаг 3: удалить обе test pages**

переместить `[тест A]` и `[тест B]` в notion trash. не удалять и не изменять реальные уроки.

- [ ] **шаг 4: повторно проверить source of truth**

runtime query обязан вернуть:

- ровно 18 active pages;
- subject counts `9 / 2 / 3 / 2 / 1 / 1`;
- duration 45 у всех реальных уроков;
- уникальный order внутри каждого дня;
- ни одной активной test page.

если cleanup не подтверждён, release запрещён.

---

### задача 15: полная проверка и production deployment

**файлы:**

- изменить только фактические deployment/cache-busting файлы, если это требуется существующей схемой проекта.

- [ ] **шаг 1: выполнить полный frontend gate**

```bash
node --check school-core.js
node --check school-api.js
node --check school.js
node --test
```

ожидаемый результат: все существующие 189 и новые tests проходят.

- [ ] **шаг 2: выполнить полный edge gate**

```bash
cd supabase/functions/school-notion
deno task check
deno task lint
deno task test
```

- [ ] **шаг 3: выполнить postgres/security gate**

проверить migration up, rollback, repeated up, postgres tests, rls/grants и supabase security advisors. frontend roles не должны читать lock table или вызывать rpc.

- [ ] **шаг 4: production deploy**

развернуть `school-notion` с jwt verification. выполнить 401, 403, owner 200 и owner mutation smoke только на временной test page, затем удалить её и снова подтвердить 18 реальных уроков.

- [ ] **шаг 5: visual regression**

повторить desktop 1440 × 1000, tablet 834 × 1112 и mobile 390 × 844; проверить mouse, touch и keyboard flows.

- [ ] **шаг 6: проверить git scope**

```bash
git status --short
git diff --stat origin/main...HEAD
git log --oneline origin/main..HEAD
```

не добавлять `.DS_Store`, local env, screenshots с secrets или unrelated changes.

---

### задача 16: подробный pr без merge

- [ ] **шаг 1: push feature branch**

```bash
git push -u origin feature/school-dashboard
```

- [ ] **шаг 2: открыть pr**

title и весь body — на русском языке с маленькой буквы. body подробно описывает:

- read-only архитектуру и notion source of truth;
- auth, owner check и cors;
- block pagination/recursion и безопасный renderer;
- mutation whitelist и status semantics;
- 60-second lease, renew и compensation;
- frontend optimistic rollback;
- две test pages и подтверждённый cleanup;
- влияние на данные, доступы и существующий dashboard;
- все выполненные node/deno/postgres/live/visual проверки;
- отсутствие автоматического merge.

- [ ] **шаг 3: проверить pr**

убедиться, что branch/head/base корректны, checks запущены, unrelated files отсутствуют. после этого остановиться и ждать review/approve пользователя.

## итоговый порядок исполнения

1. выполнить задачи 1–6;
2. выполнить задачу 7 и показать desktop/mobile screenshots;
3. остановиться до явного пользовательского подтверждения;
4. только после подтверждения выполнить задачи 8–15;
5. открыть подробный pr по задаче 16;
6. не merge-ить pr.
