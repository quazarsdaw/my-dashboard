# мост между уроком школы и внешним преподавателем chatgpt

## цель

добавить в существующий drawer урока лёгкий frontend-мост к постоянному
chatgpt-диалогу преподавателя:

- dashboard формирует стабильный стартовый промт из уже нормализованных данных
  одного урока;
- пользователь копирует промт и открывает настроенный диалог;
- преподаватель возвращает строго ограниченный текстовый блок результата;
- dashboard детерминированно разбирает блок, показывает preview и заполняет
  существующую форму;
- запись в notion выполняется только после отдельного явного подтверждения через
  существующий `completeLesson`.

chatgpt проводит занятие, dashboard управляет состоянием, notion остаётся
единственным источником школьных данных.

## подтверждённый существующий flow

- `renderLessonControls` создаёт действие начала урока.
- `mutateWithDialogs` и `runMutation` передают доменную команду в
  `SchoolMutationQueue`.
- `SchoolApi.mutate` вызывает существующую edge function `school-notion`.
- после успешной mutation список перечитывается из notion, активный урок
  проверяется повторно, а drawer обновляется.
- `openLesson` загружает нормализованные blocks через `getLessonContent`.
- `assessmentCommand` уже формирует whitelisted `completeLesson`.
- server validation уже поддерживает статусы `Выполнен`,
  `Частично выполнен`, `Пропущен` и необходимые оценочные поля.
- drawer, action dialog, focus trap, loading/error states и dark theme уже
  существуют и переиспользуются.

backend, supabase schema, notion schema и набор реальных уроков менять не нужно.

## выбранная архитектура

### `school-teacher-config.js`

публичный неизменяемый frontend-конфиг содержит ровно шесть ключей текущего
notion select `Предмет`. у каждого ключа есть подпись и изначально пустой url.

url считается пригодным для открытия, только если это абсолютный `https` url с
hostname `chatgpt.com` или `chat.openai.com`. ссылки не копируются в
localstorage, notion, supabase или environment variables.

### `school-teacher-bridge.js`

отдельный pure umd-модуль отделяет протокол обмена от большого controller:

- валидирует и разрешает конфигурацию преподавателя;
- преобразует нормализованные content blocks в читаемые секции;
- строит стартовый промт;
- строит короткий запрос на итог;
- детерминированно разбирает `lesson result`;
- нормализует значения preview;
- считает unicode code points и валидирует комментарий и artifact.

модуль не читает dom, не вызывает clipboard, не открывает вкладки и не выполняет
mutation.

### интеграция в `school.js`

controller хранит загруженные blocks текущего drawer, поэтому промт строится из
тех же данных, которые пользователь видит на экране. teacher section
рендерится:

- до начала — как preview промта без возможности молча завершить урок;
- после успешного `startLesson` — с действиями копирования, открытия и импорта;
- после финализации — с возможностью открыть диалог, но новый импорт требует
  существующего возврата к редактированию.

отдельный teacher dialog имеет три режима:

1. ручной clipboard fallback с выделяемым textarea;
2. ввод исходного `lesson result`;
3. preview распознанных значений, warnings и errors.

`Применить к форме` меняет только controls открытого drawer. сохранение выполняет
отдельная кнопка `Сохранить результат в дневник`, которая показывает final
summary и затем вызывает существующую mutation.

## конфигурация преподавателей

поддерживаются точные ключи:

- `Software Engineering`;
- `DevOps & Infrastructure`;
- `Mathematics`;
- `English & IELTS`;
- `University`;
- `Director & Assessment`.

пустой или некорректный url не блокирует старт и копирование. интерфейс сообщает,
какой ключ нужно заполнить в `school-teacher-config.js`.

## протокол стартового промта

`buildLessonTeacherPrompt(lesson, contentBlocks)` возвращает стабильный plain
text:

- markers `personal school lesson`;
- `LESSON_REF`, предмет, название, модуль, длительность, расписание и приоритет;
- только непустые учебные секции из нормализованных blocks;
- педагогические правила;
- шкалы автономности и понимания;
- точный контракт результата;
- closing marker.

промт не содержит raw notion payload, token, jwt, service-role key,
environment variables или данные других уроков.

blocks преобразуются рекурсивно. поддерживаются уже нормализованные типы:
headings, paragraph, bulleted/numbered list, toggle, quote, callout, to-do, code,
equation, table, container, reference и safe placeholder для unsupported.
пустые секции не выводятся.

## протокол результата

парсер читает только текст между:

```text
=== LESSON RESULT ===
=== END LESSON RESULT ===
```

поддерживаются ключи:

- `LESSON_REF`;
- `STATUS`;
- `RESULT`;
- `AUTONOMY`;
- `UNDERSTANDING`;
- `COMMENT`;
- `ARTIFACT`;
- `MISSED_REASON`.

строка делится по первому двоеточию, ключи регистронезависимы, а enum-значения
проверяются строго. duplicate key — ошибка. unknown key и текст вне markers —
warning и не применяются. `LESSON_REF` обязателен и должен точно совпадать с
открытым уроком.

парсер возвращает plain data. html и markdown не интерпретируются, а UI выводит
значения только через `textContent` и свойства form controls.

## нормализация по статусам

### выполнен

- результат, автономность и понимание обязательны;
- отсутствующий результат предлагается как `Зачёт` с видимым warning;
- причина пропуска очищается.

### частично выполнен

- результат всегда `Требует повторения`;
- другое присланное значение заменяется с warning;
- автономность и понимание обязательны;
- причина пропуска очищается.

### пропущен

- причина пропуска обязательна;
- результат, автономность и понимание очищаются;
- комментарий можно сохранить;
- artifact применяется только после отдельного явного подтверждения в preview.

комментарий ограничен 1000 unicode code points и не обрезается. artifact может
быть пустым либо абсолютным `https` url длиной не более 2048 символов.

## preview и ручное редактирование

разбор никогда не выполняет mutation. preview показывает:

- распознанные значения;
- применённые status-specific defaults;
- warnings;
- ошибки конкретных полей;
- отдельное подтверждение artifact для пропущенного урока.

частично корректный результат не применяется автоматически. пользователь явно
нажимает `Применить к форме`, после чего заполненные controls получают мягкую
визуальную отметку. любое ручное изменение снимает отметку с соответствующего
поля и остаётся возможным до сохранения.

## clipboard и popup

комбинированное действие:

1. синхронно создаёт пустую вкладку из click handler;
2. изолирует её от opener;
3. пытается записать промт через `navigator.clipboard.writeText`;
4. после попытки копирования переводит вкладку на проверенный teacher url.

если popup заблокирован, промт всё равно копируется и показывается безопасная
кликабельная ссылка. если clipboard недоступен или отклонён, полный текст
остаётся в fallback textarea для ручного копирования. пустой url закрывает
созданную пустую вкладку и не мешает копированию.

внешняя ссылка открывается с `noopener,noreferrer`. содержимое промта и результата
не логируется.

## визуальная интеграция

teacher section использует текущую карточку drawer, кнопки, типографику,
spacing, focus styles и dialog/backdrop. добавляется компактный school toast с
`aria-live`, потому что существующий topbar toast относится к достижениям и не
соответствует школьным действиям.

на desktop дополнительные действия располагаются компактно, на mobile —
вертикально с текущим размером touch targets.

## файлы

новые:

- `school-teacher-config.js`;
- `school-teacher-bridge.js`;
- `test/school-teacher-bridge.test.cjs`;
- `readme.md`.

изменяемые:

- `school.html`;
- `school.js`;
- `school.css`;
- `test/school-ui.test.cjs`.

не изменяются:

- `school-api.js`;
- `school-core.js`;
- `school-mutation-queue.js`;
- `supabase/functions/school-notion/**`;
- `supabase/migrations/**`;
- notion schema.

## проверка

unit tests покрывают prompt, block conversion, конфигурацию, parser, status
rules, unicode/comment/url boundaries и отсутствие mutation. ui tests
подтверждают, что:

- teacher section появляется в правильных состояниях;
- parse и apply не сохраняют данные;
- применённые controls остаются редактируемыми;
- explicit save использует текущий `completeLesson`;
- clipboard и popup fallbacks не теряют промт.

после автоматических проверок выполняется desktop/mobile browser qa со
screenshots. destructive smoke не использует реальные 18 уроков: при
необходимости используется временная явно тестовая карточка и затем
проверяется её удаление.

