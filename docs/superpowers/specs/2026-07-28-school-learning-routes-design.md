# маршрутизация уроков по кабинетам и преподавателям

## статус документа

документ описывает три последовательных stacked pr поверх teacher bridge из
pr #52. реализация не начинается до отдельного подтверждения этой письменной
спецификации.

tdd implementation plan для pr 1 также готовится только после финального
подтверждения этого design doc. до подтверждения разрешены только изменения
самого документа и его self-review.

утверждённые решения:

- кабинет и преподаватель являются разными сущностями;
- постоянные кабинеты определяются только во frontend-конфигурации;
- notion хранит только override конкретного урока;
- `Кабинет` и `Преподаватель` хранят стабильные ключи в rich text;
- `Формат урока` хранится в select с фиксированным allow-list;
- `Ресурс урока` хранится как url;
- пустой override означает subject default;
- явно неизвестный override не подменяется default;
- глобальный fallback — `self-study`;
- codex в mvp не имеет url и запускается инструкцией открыть desktop-приложение;
- результат урока остаётся единым блоком `LESSON RESULT`;
- нового ai api, oauth, iframe, backend-приложения или supabase-таблицы нет.

## аудит исходной архитектуры

исходной точкой является ветка `agent/school-teacher-bridge` из pr #52.

teacher bridge уже содержит:

- `school-teacher-config.js` с шестью subject-specific chatgpt url;
- чистую функцию `buildLessonTeacherPrompt`;
- чистый детерминированный parser `parseLessonResultBlock`;
- popup и clipboard fallbacks;
- preview и ручное редактирование assessment;
- явное сохранение через существующий `completeLesson`;
- browser и unit tests.

текущие ограничения:

- frontend-конфиг связывает предмет напрямую с преподавателем и url;
- понятия кабинета, преподавателя, формата и ресурса не разделены;
- `Lesson` не содержит route override;
- school-notion mapper требует строгую схему из семнадцати notion properties;
- school-notion принимает только явно перечисленные domain commands;
- `startLesson` изменяет только статус и ничего не знает о внешнем кабинете;
- `school.js` уже велик, поэтому platform logic нельзя добавлять одним switch.

## цели

1. разрешать маршрут урока через subject defaults и lesson overrides;
2. показывать кабинет, преподавателя, model hint, формат и ресурс;
3. хранить постоянные url в одном frontend-конфиге;
4. хранить в notion только четыре nullable override;
5. запускать внешний кабинет только после успешного `startLesson`;
6. использовать разные педагогические стратегии без разных result formats;
7. предоставлять subject chatgpt reviewer после внешнего или самостоятельного
   этапа;
8. сохранить все существующие active-lesson, assessment и scheduling
   invariants.

## не входит в scope

- openai api;
- kimi api;
- автоматический выбор модели в chatgpt, codex, cursor или kimi;
- чтение истории внешнего диалога;
- iframe;
- oauth для внешних кабинетов;
- новая таблица supabase;
- копирование постоянных url в notion;
- автоматическое завершение после просмотра видео или чтения;
- изменение `LESSON RESULT`;
- межнедельные изменения;
- ai-анализ свободного текста;
- изменение маршрута как перенос расписания.

## терминология

### кабинет

кабинет — среда, где фактически проходит урок. кабинет определяет platform,
kind, способ запуска и url-политику.

### преподаватель

преподаватель — модель, человек или педагогический профиль внутри кабинета.
преподаватель определяет label и model hint, но dashboard не утверждает, что
модель уже выбрана.

### постоянный кабинет

постоянный кабинет имеет стабильный key и обновляемый url в
`school-teacher-config.js`. изменение url автоматически применяется ко всем
урокам, использующим этот key, без notion mutation.

### временный кабинет

временный кабинет выбирается lesson override. его type известен конфигурации,
а конкретный url хранится в `Ресурс урока`.

### проверяющий

проверяющий — subject default chatgpt route, который проверяет понимание после
youtube, книги, документации, терминала или самостоятельной практики.
отдельное notion property для проверяющего не создаётся.

## конфигурация

файл сохраняет имя `school-teacher-config.js`, но экспортирует:

```javascript
window.SchoolLearningConfig = Object.freeze({
  cabinets: Object.freeze({}),
  teachers: Object.freeze({}),
  defaultsBySubject: Object.freeze({}),
  globalFallback: Object.freeze({}),
  lessonFormats: Object.freeze([])
});
```

вложенные records и entries также замораживаются.

### переход с teacher bridge config

в pr 1 существующий `window.SchoolTeacherConfig` заменяется единым
`window.SchoolLearningConfig`. второго параллельного источника постоянных url
не остаётся.

controller и teacher bridge получают уже resolved route через явную
dependency. существующие subject-specific действия продолжают работать через
этот route, поэтому замена формы config не меняет текущий result flow.

`school.html` подключает в таком порядке:

1. `school-teacher-config.js`;
2. `school-learning-route.js`;
3. `school-teacher-bridge.js`;
4. остальные school modules и `school.js`.

cache-busting version изменяется одновременно с формой config.

### постоянные кабинеты

| key | label | platform | kind | url |
|---|---|---|---|---|
| `chatgpt-software` | ChatGPT · Software Engineering | `ChatGPT` | `permanent` | пусто |
| `chatgpt-devops` | ChatGPT · DevOps | `ChatGPT` | `permanent` | пусто |
| `chatgpt-mathematics` | ChatGPT · Mathematics | `ChatGPT` | `permanent` | пусто |
| `chatgpt-english` | ChatGPT · English & IELTS | `ChatGPT` | `permanent` | пусто |
| `chatgpt-university` | ChatGPT · University | `ChatGPT` | `permanent` | пусто |
| `chatgpt-director` | ChatGPT · Director | `ChatGPT` | `permanent` | пусто |
| `codex-main` | Codex | `Codex` | `permanent` | пусто |
| `cursor-main` | Cursor | `Cursor` | `permanent` | пусто |
| `terminal-local` | терминал | `Terminal` | `permanent` | пусто |

### временные типы кабинетов

| key | label | platform | kind | url source |
|---|---|---|---|---|
| `kimi-temporary` | Kimi · временный чат | `Kimi` | `temporary` | lesson resource |
| `youtube` | YouTube | `YouTube` | `temporary` | lesson resource |
| `book-pdf` | книга или pdf | `Book` | `temporary` | lesson resource |
| `documentation` | документация | `Documentation` | `temporary` | lesson resource |
| `self-study` | самостоятельная практика | `None` | `temporary` | отсутствует |

config хранит descriptor временного type, но не url конкретного материала.

### преподаватели

| key | label | platform | model hint |
|---|---|---|---|
| `chatgpt-main` | ChatGPT · основной преподаватель | `ChatGPT` | выберите основную модель вручную |
| `chatgpt-deep` | ChatGPT · глубокое рассуждение | `ChatGPT` | выберите сильную reasoning-модель вручную |
| `chatgpt-fast` | ChatGPT · быстрый преподаватель | `ChatGPT` | выберите быструю модель вручную |
| `codex-main` | Codex · coding agent | `Codex` | выберите coding-модель вручную |
| `kimi-k3` | Kimi K3 | `Kimi` | выберите Kimi K3 вручную |
| `material-author` | автор материала | `External` | пусто |
| `self-study` | самостоятельная работа | `None` | пусто |

model hint является только инструкцией. dashboard не меняет модель и не
подтверждает её фактический выбор.

### subject defaults

| subject | cabinet | teacher | format |
|---|---|---|---|
| Software Engineering | `chatgpt-software` | `chatgpt-main` | Сократовский урок |
| DevOps & Infrastructure | `chatgpt-devops` | `chatgpt-main` | Практическая лаборатория |
| Mathematics | `chatgpt-mathematics` | `chatgpt-deep` | Сократовский урок |
| English & IELTS | `chatgpt-english` | `chatgpt-main` | Диалоговый урок |
| University | `chatgpt-university` | `chatgpt-main` | Разбор материала |
| Director & Assessment | `chatgpt-director` | `chatgpt-deep` | Недельная ревизия |

### global fallback

```javascript
{
  cabinetId: 'self-study',
  teacherId: 'self-study',
  format: 'Самостоятельная практика'
}
```

fallback применяется только при отсутствии subject default. он не заменяет
явно неизвестный lesson override.

### форматы урока

фиксированный select allow-list:

- `Сократовский урок`;
- `Сократовская диагностика`;
- `Практическая лаборатория`;
- `Диалоговый урок`;
- `Разбор материала`;
- `Большой контекст`;
- `Видео + retrieval`;
- `Чтение + retrieval`;
- `Самостоятельная практика`;
- `Недельная ревизия`.

## notion properties

четыре свойства создаются пустыми:

| notion property | type | normalized value |
|---|---|---|
| `Кабинет` | rich text | cabinet key или `null` |
| `Преподаватель` | rich text | teacher key или `null` |
| `Формат урока` | select | allow-listed label или `null` |
| `Ресурс урока` | url | absolute https url или `null` |

существующие 18 уроков не backfill-ятся. пустые поля разрешаются через subject
defaults.

стабильные keys:

- содержат только lowercase latin letters, digits и `-`;
- начинаются и заканчиваются буквой или цифрой;
- имеют длину от 1 до 64 unicode code points.

resource url:

- абсолютный;
- только `https:`;
- без username и password;
- не длиннее 2048 unicode code points;
- нормализуется на сервере;
- не обрезается.

## внутренняя модель

backend `Lesson` получает:

```typescript
type LessonRouteOverride = Readonly<{
  cabinetId: string | null;
  teacherId: string | null;
  format: string | null;
  resourceUrl: string | null;
}>;
```

frontend resolver принимает отсутствие `routeOverride` как четыре `null`.
это позволяет pr 1 работать до изменения notion schema в pr 2.

read model сохраняет неизвестный format как строку, чтобы интерфейс мог
показать источник несогласованности. write command принимает только
allow-listed `LessonFormat`.

результат resolver:

```typescript
type LessonRoute = Readonly<{
  cabinetId: string;
  cabinetLabel: string;
  platform: string;
  cabinetKind: 'permanent' | 'temporary';
  cabinetUrl: string | null;
  teacherId: string;
  teacherLabel: string;
  modelHint: string | null;
  format: string;
  resourceUrl: string | null;
  usesDefaultCabinet: boolean;
  usesDefaultTeacher: boolean;
  canOpenCabinet: boolean;
  warnings: RouteWarning[];
  reviewer: LessonReviewer | null;
}>;
```

`LessonReviewer` содержит resolved subject-default chatgpt cabinet, teacher и
url. reviewer отсутствует для обычного chatgpt, codex, cursor и kimi lesson
flow и вычисляется для youtube, book/pdf, documentation, terminal и
self-study.

## разрешение маршрута

чистая функция:

```javascript
resolveLessonRoute(lesson, learningConfig)
```

### приоритет

1. непустой lesson override;
2. subject default;
3. global fallback.

приоритет применяется отдельно к cabinet, teacher и format.

### null

`null`, пустая строка и отсутствующее поле означают использование default.

### неизвестный override

если lesson явно содержит неизвестный cabinet key:

- key сохраняется в resolved route;
- default cabinet не подставляется;
- `cabinetUrl = null`;
- `canOpenCabinet = false`;
- добавляется warning `unknown-cabinet`;
- prompt можно скопировать.

для неизвестного teacher применяется аналогичное правило с warning
`unknown-teacher`, `canOpenCabinet = false` и открытие блокируется. dashboard
не показывает другого преподавателя как фактически назначенного.

если lesson явно содержит неизвестный format:

- raw label сохраняется для отображения;
- default format не подставляется;
- добавляется warning `unknown-format`;
- `canOpenCabinet = false`;
- prompt можно только скопировать.

таким образом любой неизвестный explicit override использует fail-safe режим:
warning и только копирование prompt без внешней navigation.

### ресурс

для постоянного кабинета `resourceUrl` является дополнительным материалом.
он включается в prompt, но не заменяет `cabinetUrl` из config.
дополнительный permanent resource принимает любой credential-free absolute
https url в пределах 2048 unicode code points.

для `kimi-temporary`, `youtube`, `book-pdf` и `documentation` resource является
url запуска временного кабинета. если resource отсутствует или не проходит
platform allow-list, открытие блокируется, но prompt остаётся доступен.

### reviewer

reviewer вычисляется из `defaultsBySubject[lesson.subject]`.

reviewer создаётся только если subject default cabinet существует и имеет
platform `ChatGPT`. пустой reviewer url не ломает review prompt: интерфейс
показывает configuration warning и позволяет ручное копирование.

## url policy

все hostname сравниваются после `new URL`, в lowercase и без доверия к
display label.

| platform | allowed hostname |
|---|---|
| chatgpt | `chatgpt.com`, `chat.openai.com` |
| kimi | `kimi.com`, `www.kimi.com` |
| youtube | `youtube.com`, `www.youtube.com`, `youtu.be` |
| cursor | `cursor.com`, `www.cursor.com` |
| book/pdf | любой credential-free absolute https url |
| documentation | любой credential-free absolute https url |
| codex | url не поддерживается в mvp |
| terminal | url отсутствует |
| self-study | url отсутствует |

url никогда не вставляется через `innerHTML`.

`school.html` задаёт `referrer` policy `no-referrer`. fallback anchors получают
`rel="noopener noreferrer"`. это сохраняет отсутствие referrer и для ручного
fallback, и для `location.replace` из предварительно открытого `about:blank`.

## prompt

`buildLessonTeacherPrompt` получает resolved route и добавляет:

```text
CABINET: ...
TEACHER: ...
MODEL_HINT: ...
LESSON_FORMAT: ...
RESOURCE: ...
```

пустые `MODEL_HINT` и `RESOURCE` не выводятся.

`LESSON_REF` и единый result contract не меняются.

platform-specific педагогические правила добавляются в pr 3:

- ai teacher — самостоятельная попытка, минимальная подсказка, повторная
  проверка;
- coding agent — сначала гипотеза, запрет немедленного полного fix, маленькие
  patches, объяснение diff, tests как доказательство;
- video/book/documentation — не пересказывать материал заранее, retrieval
  после изучения, требовать применение, не завершать по факту просмотра;
- terminal — не выполнять команды автоматически;
- self-study — не открывать чат до самостоятельной попытки.

## ui

### маленькая карточка

desktop показывает одну строку:

```text
Codex · coding agent
```

mobile показывает только platform:

```text
Codex
```

строка не вытесняет title, time и status.

### drawer

существующая teacher section расширяется и переименовывается в
`Где проходит урок`.

read-only часть показывает:

- кабинет;
- `постоянный` или `временный`;
- преподавателя;
- model hint с явным словом `вручную`;
- формат;
- ресурс;
- проверяющего;
- warnings;
- инструкцию запуска.

pr 1 показывает resolved defaults без notion mutation.

pr 2 добавляет route editor:

- cabinet select из известных keys;
- teacher select из известных keys;
- format select из allow-list;
- resource url input;
- действие `Использовать предметные defaults`;
- summary перед сохранением.

если notion содержит неизвестный cabinet или teacher key, editor показывает
raw key отдельной недоступной для повторного выбора option и warning. он не
выбирает default молча. сохранение возможно только после явного выбора
известного key либо очистки поля до `null`.

неизвестный format показывается по тому же принципу: raw label виден, но не
становится новой allow-listed option.

### статусная матрица route editor

| status | поведение |
|---|---|
| `Нераспределён` | разрешить |
| `Запланирован` | разрешить |
| `В процессе` | потребовать усиленное подтверждение |
| `Выполнен` | заблокировать до возврата к редактированию |
| `Частично выполнен` | заблокировать до возврата к редактированию |
| `Пропущен` | заблокировать до исправления статуса |
| `Отменён` | заблокировать до возврата в расписание |

после существующего `reopenLesson` status становится `В процессе`, поэтому
route change доступен только через усиленное подтверждение.

## domain command

pr 2 добавляет одну команду:

```typescript
type UpdateLessonRouteCommand = Readonly<{
  operation: 'updateLessonRoute';
  lessonId: string;
  cabinetId: string | null;
  teacherId: string | null;
  format: LessonFormat | null;
  resourceUrl: string | null;
  confirmActiveRouteChange?: true;
}>;
```

команда всегда содержит все четыре route properties. `null` очищает
соответствующее notion property и возвращает resolution к default.

server:

1. проверяет session и `SCHOOL_OWNER_USER_ID` существующим auth boundary;
2. валидирует exact command shape;
3. повторно получает lesson;
4. проверяет membership в `NOTION_DATA_SOURCE_ID`;
5. проверяет status matrix;
6. строит только четыре whitelisted properties;
7. выполняет один notion page update;
8. повторно получает lesson и возвращает нормализованный результат.

это один notion request на обновление properties, но не транзакция postgres.
global active-lesson lock не используется, потому что status и active
invariant не изменяются.

для `В процессе` требуется `confirmActiveRouteChange: true`. для
финализированных и отменённого сервер возвращает http 409:

```json
{
  "error": "LESSON_STATUS_TRANSITION_REQUIRED",
  "status": "Выполнен"
}
```

route mutation никогда не меняет:

- status;
- schedule;
- duration;
- order;
- move count;
- assessment;
- decision request;
- page content.

## platform launch architecture

pr 3 добавляет изолированный strategy module. `school.js` не содержит большой
platform switch.

чистый dispatcher возвращает launch plan:

```typescript
type LessonLaunchPlan = Readonly<{
  kind: 'external-url' | 'instruction-only' | 'self-study';
  prompt: string;
  url: string | null;
  instruction: string;
  reviewerRequired: boolean;
}>;
```

handlers:

- `launchChatGptLesson`;
- `launchCodingLesson`;
- `launchExternalResourceLesson`;
- `launchTerminalLesson`;
- `launchSelfStudyLesson`.

handlers не выполняют browser side effects. они создают launch plan. popup,
clipboard, toast и server mutation оркестрирует controller.

границы файлов:

- `school-learning-route.js` — config validation, route resolution, reviewer и
  compact labels;
- `school-learning-strategies.js` — launch plans, platform pedagogy и reviewer
  prompt;
- `school-teacher-bridge.js` — lesson prompt и неизменный result parser;
- `school.js` — только dom rendering, user actions и orchestration;
- `supabase/functions/school-notion/route-service.ts` — server status policy и
  route update;
- `supabase/functions/school-notion/notion-properties.ts` — единственный
  builder whitelisted notion properties.

### chatgpt

- использует permanent cabinet url;
- показывает teacher и model hint;
- не пытается переключить модель.

### codex

- url отсутствует;
- prompt копируется;
- показывается инструкция открыть codex desktop;
- prompt запрещает немедленный полный fix до гипотезы и самостоятельной
  попытки.

### cursor

- использует configured `cursor.com` url;
- при пустом url копирует prompt и показывает инструкцию.

### kimi

- доступен только через явный `kimi-temporary` override;
- использует lesson resource url;
- показывает `kimi k3` как ручную рекомендацию.

### youtube

- открывает lesson resource;
- просмотр не завершает урок;
- после просмотра доступен reviewer prompt.

### книга, pdf и документация

- открывают lesson resource;
- prompt содержит заданный раздел из lesson content;
- после чтения доступен reviewer prompt.

### терминал

- не открывает url;
- копирует laboratory prompt;
- не выполняет команды.

### самостоятельная практика

- не открывает чат автоматически;
- показывает задачу;
- после попытки доступен reviewer.

## безопасный pre-open flow

для внешнего кабинета используется обязательная последовательность:

1. непосредственно внутри пользовательского click синхронно выполнить
   `window.open('about:blank', '_blank')`;
2. сохранить window handle;
3. не передавать prompt, lesson id, resource или другие внутренние данные через
   url, query, fragment или window name;
4. выполнить существующий `startLesson`;
5. только после успешного server response сформировать актуальный prompt;
6. скопировать prompt через clipboard или показать существующий manual
   fallback;
7. повторно разрешить route из актуального lesson state;
8. повторно провалидировать destination url по platform allow-list;
9. установить `popup.opener = null`;
10. выполнить `popup.location.replace(validatedUrl)`;
11. при любом исключении до успешной navigation попытаться закрыть popup;
12. если popup заблокирован и handle равен `null`, всё равно завершить
    `startLesson`, сохранить prompt и показать обычную безопасную ссылку.

до navigation blank document не получает untrusted html или script. controller
может установить `popup.opener = null` сразу после получения handle как
defense-in-depth, но обязан повторить это непосредственно перед
`location.replace`.

если `startLesson` возвращает active lesson conflict:

- blank popup закрывается;
- существующий conflict dialog остаётся источником решения;
- новая navigation выполняется только из нового подтверждённого user action.

для уже активного урока `Продолжить` не вызывает `startLesson`, но использует
тот же synchronous pre-open и повторную url validation.

## reviewer flow

для youtube, book/pdf, documentation, terminal и self-study drawer показывает
`Открыть проверяющего`.

действие:

1. строит отдельный retrieval/review prompt с тем же `LESSON_REF`;
2. синхронно pre-open-ит reviewer popup;
3. копирует prompt;
4. повторно валидирует subject chatgpt url;
5. использует `opener = null` и `location.replace`;
6. не меняет status;
7. не считает открытие reviewer завершением.

reviewer требует:

- проверить понимание;
- запросить применение;
- оценить фактическую работу;
- вернуть исходный единый `LESSON RESULT`.

## обработка ошибок

| ситуация | результат |
|---|---|
| unknown cabinet | warning, prompt copy, opening blocked |
| unknown teacher | warning, реальный key показан, prompt copy, opening blocked |
| unknown format | warning, raw label показан, prompt copy, opening blocked |
| пустой permanent url | configuration warning, prompt copy |
| invalid resource url | validation warning, opening blocked |
| popup blocked | prompt не теряется, manual link показывается |
| clipboard denied | textarea fallback с выделенным prompt |
| `startLesson` failed | popup закрывается, route не запускается |
| active lesson conflict | popup закрывается, существующий 409 flow |
| active route update без confirm | 409, notion не изменяется |
| finalized route update | 409, notion не изменяется |
| notion update failed | optimistic ui rollback и normalized error |
| reload | route повторно разрешается из config и notion overrides |

## безопасность и приватность

- prompt содержит только текущий normalized lesson, открытые blocks,
  resolved route и педагогические правила;
- supabase jwt, notion token, service-role key, environment variables и raw
  notion payload не передаются;
- prompt и result block не логируются;
- url не строится из prompt;
- internal data не передаётся через query parameters;
- url открывается только после повторной validation;
- popup теряет opener до external navigation;
- user-provided values рендерятся через text nodes;
- route mutation использует exact keys и property whitelist;
- membership проверяется перед write;
- frontend не получает server secrets;
- никаких новых analytics.

## stacked branches и pr lifecycle

точная цепочка:

1. pr 1:
   - branch `agent/school-learning-routes-readonly`;
   - base branch `agent/school-teacher-bridge` из pr #52;
2. pr 2:
   - branch `agent/school-learning-route-overrides`;
   - base branch `agent/school-learning-routes-readonly`;
3. pr 3:
   - branch `agent/school-learning-launch-strategies`;
   - base branch `agent/school-learning-route-overrides`.

каждый pr остаётся draft до своих проверок и пользовательского review.

после merge нижележащего pr:

1. получить актуальный `origin/main`;
2. retarget следующий pr на `main`;
3. rebase его branch на `origin/main`, исключив уже merged commits
   нижележащего pr;
4. проверить, что diff содержит только scope текущего pr;
5. повторно запустить полный relevant test gate;
6. повторить secret scan и browser smoke для затронутого слоя;
7. обновить pr body фактическими результатами;
8. не merge автоматически.

pr 2 не открывается с base `main`, пока pr 1 не merge-нут. pr 3 не открывается
с base `main`, пока pr 2 не merge-нут.

## этап 1: config, resolver и read-only ui

scope pr 1:

- расширить `school-teacher-config.js`;
- добавить pure route resolver и url validation;
- расширить prompt route metadata без изменения result contract;
- показывать route line на карточках;
- показывать read-only route section в drawer;
- показывать warnings и reviewer metadata;
- обновить readme;
- добавить unit и frontend rendering tests.

существующие teacher bridge actions в pr 1 используют resolved url только для
subject-default chatgpt routes. synthetic non-chatgpt route можно увидеть и
скопировать в prompt, но platform-specific запуск до pr 3 не выполняется.

pr 1 не меняет:

- notion schema;
- backend types;
- school-notion commands;
- реальные lesson records;
- launch behavior существующей кнопки teacher bridge.

## этап 2: notion overrides

scope pr 2:

- создать четыре пустых properties в notion;
- расширить strict read schema и `Lesson`;
- добавить `updateLessonRoute`;
- добавить server validator, whitelist, repository/service/router;
- добавить frontend transport whitelist;
- добавить route editor и status guards;
- проверить live mutation на `[тест маршрут]`;
- удалить test page;
- повторно подтвердить 18 реальных уроков.

перед реализацией pr 2 проверяются актуальные supabase changelog и документация
edge functions. schema inspect/update выполняется через подключённый официальный
notion mcp: сначала read schema, затем create missing properties один раз, затем
повторный read schema.

notion schema создаётся до deployment backend, потому что текущий mapper
игнорирует дополнительные properties, а новый mapper fail-closed требует их
наличия. такой schema-first rollout не ломает текущую production function.

## этап 3: launch strategies и reviewer

scope pr 3:

- добавить pure platform strategies;
- расширить route-aware pedagogy;
- объединить start и launch без обхода server invariants;
- реализовать secure pre-open;
- реализовать reviewer;
- выполнить desktop/mobile browser qa;
- проверить popup blocker и clipboard fallback;
- сделать screenshots.

## тестовая стратегия

### pr 1

- default cabinet по каждому subject;
- default teacher по каждому subject;
- global fallback;
- cabinet override;
- teacher override;
- temporary resource;
- permanent url update без lesson mutation;
- unknown cabinet fail-safe;
- unknown teacher warning;
- unknown format fail-safe;
- reviewer resolution;
- route metadata в prompt;
- неизменный `LESSON RESULT`;
- platform url allow-lists;
- compact desktop/mobile labels;
- read-only drawer rendering.

### pr 2

- четыре notion properties имеют точные types;
- null override нормализуется;
- invalid key и url отклоняются;
- mapper fail-closed при missing/wrong type;
- command принимает только exact keys;
- properties обновляются одним whitelist payload;
- planned и unscheduled разрешены;
- active требует confirm;
- finalized и cancelled отклоняются;
- schedule, status, order, move count и assessment не изменяются;
- page outside school database не обновляется;
- frontend не отправляет raw notion payload;
- optimistic rollback;
- live temporary page удалена;
- после live test остаётся 18 реальных уроков.

### pr 3

- chatgpt strategy;
- codex instruction-only strategy;
- cursor strategy;
- explicit kimi strategy;
- youtube strategy;
- book/pdf strategy;
- documentation strategy;
- terminal strategy;
- self-study strategy;
- reviewer prompt;
- video opening не завершает lesson;
- model hint не считается выбранной моделью;
- `window.open` вызывается синхронно;
- prompt не попадает в url;
- referrer policy не раскрывает dashboard url;
- `startLesson` завершается до navigation;
- url валидируется повторно;
- `opener` обнуляется;
- `location.replace` используется вместо assignment;
- popup закрывается при server/validation/navigation error;
- blocked popup не теряет prompt;
- active conflict закрывает blank popup;
- desktop real-browser popup behavior;
- mobile popup/blocker behavior;
- clipboard fallback;
- keyboard navigation.

## live verification

реальные 18 уроков не используются для destructive route tests.

в pr 2:

1. создать `[тест маршрут]`;
2. проверить default resolution;
3. записать четыре overrides;
4. прочитать lesson повторно;
5. очистить overrides через четыре `null`;
6. проверить возврат к defaults;
7. удалить test page;
8. запросить data source;
9. подтвердить 18 реальных уроков и отсутствие test page.

в pr 3 browser mutation smoke может использовать mock либо новую временную
test page, удаляемую по той же политике.

## документация постоянных ссылок

readme объясняет:

1. найти permanent cabinet key в `school-teacher-config.js`;
2. заменить только его `url`;
3. проверить `https`, hostname и отсутствие credentials;
4. обновить cache-busting version;
5. выполнить smoke test копирования и открытия;
6. не обновлять notion lessons.

изменение permanent url не меняет `LESSON_REF`, result parser или историю.

## известные ограничения mvp

- dashboard не может доказать выбранную внешнюю модель;
- codex desktop не открывается через https url;
- route update использует last-write-wins notion semantics;
- постоянные url являются публичной frontend-конфигурацией;
- временные resource urls ограничены одним полем;
- reviewer не имеет отдельного notion property;
- статистика 80–95% permanent, 5–20% temporary и 1–5% kimi может вычисляться
  чистой функцией, но не выводится в основном ui этого цикла;
- существующее ограничение pr #52 по новому artifact у статуса `Пропущен` не
  расширяется этой серией pr и рассматривается отдельно.

## self-review gate design doc

перед передачей документа на финальное подтверждение проверяются:

1. соответствие исходному routing тз и всем последующим ответам;
2. отсутствие второго source of truth для permanent urls;
3. fail-safe поведение любого неизвестного explicit override;
4. неизменность `LESSON RESULT` и существующих active-lesson invariants;
5. точная последовательность secure pre-open без prompt в url;
6. popup privacy для automatic и manual fallback;
7. точная stacked branch chain и обязательный rebase после merge основания;
8. отсутствие implementation changes в commit design doc;
9. отсутствие секретов, placeholder credentials и реальных lesson mutations.

## критерии приёмки всей серии

1. кабинет и преподаватель разделены;
2. permanent urls обновляются в одном месте;
3. subject defaults работают без backfill;
4. temporary route хранит только override и resource;
5. unknown override не открывает неправильный url;
6. route metadata видна в cards и drawer;
7. route mutation не меняет schedule и move count;
8. finalized lesson защищён status transition;
9. external launch происходит только после успешного `startLesson`;
10. popup использует обязательный secure pre-open flow;
11. codex остаётся instruction-only;
12. kimi требует explicit override;
13. external material имеет subject reviewer;
14. `LESSON RESULT` не изменён;
15. notion остаётся source of truth для overrides;
16. secrets не попадают во frontend или prompt;
17. desktop/mobile qa и automated tests проходят;
18. pr остаются stacked и не merge-ятся автоматически.
