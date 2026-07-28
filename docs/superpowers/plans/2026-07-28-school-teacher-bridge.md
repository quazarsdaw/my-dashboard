# план реализации моста школы и преподавателей chatgpt

> **для agentic workers:** выполнять задачи последовательно через tests-first,
> не менять backend, notion schema и реальные 18 уроков.

**цель:** добавить frontend-мост к постоянным chatgpt-диалогам преподавателей с
детерминированным импортом результата и явным сохранением через существующий
`completeLesson`.

**архитектура:** публичные ссылки находятся только в
`school-teacher-config.js`; pure umd-модуль `school-teacher-bridge.js` владеет
текстовым протоколом и validation; `school.js` отвечает только за dom,
clipboard, popup, preview и вызов существующей mutation.

**стек:** vanilla javascript, css, `node:test`, существующие supabase auth и
edge function без изменений.

## глобальные ограничения

- все шесть teacher url в итоговом коммите пустые;
- разрешены только `https://chatgpt.com` и `https://chat.openai.com`;
- parse/apply не выполняют network request и mutation;
- raw result block не передаётся в notion;
- комментарий — максимум 1000 unicode code points;
- artifact — только absolute https url, максимум 2048 символов;
- никакого openai/kimi api, iframe, oauth, нового backend или хранилища;
- popup создаётся синхронно, prompt не теряется при clipboard/popup ошибках;
- github commits и pr — на русском языке, в нижнем регистре, без co-author;
- pr остаётся draft и не merge-ится.

---

### задача 1: teacher config и pure url validation

**файлы:**
- создать: `school-teacher-config.js`
- создать: `school-teacher-bridge.js`
- создать: `test/school-teacher-bridge.test.cjs`

- [ ] написать failing tests для шести точных subject keys, пустых url,
  разрешённых hosts и отклонения других scheme/origin;
- [ ] запустить targeted red;
- [ ] реализовать минимальную неизменяемую конфигурацию и pure resolver;
- [ ] запустить targeted green.

### задача 2: стабильный lesson prompt

**файлы:**
- изменить: `school-teacher-bridge.js`
- изменить: `test/school-teacher-bridge.test.cjs`

- [ ] написать failing tests для metadata, `LESSON_REF`, непустых учебных
  секций, рекурсивных blocks и точного result contract;
- [ ] отдельно проверить отсутствие пустых секций, raw payload и секретных
  ключей;
- [ ] запустить targeted red;
- [ ] реализовать block-to-text и `buildLessonTeacherPrompt`;
- [ ] запустить targeted green.

### задача 3: детерминированный parser и status normalization

**файлы:**
- изменить: `school-teacher-bridge.js`
- изменить: `test/school-teacher-bridge.test.cjs`

- [ ] написать failing table-driven tests для completed, partial и missed;
- [ ] добавить failing cases: markers, lesson ref, duplicate/unknown keys,
  invalid enums, invalid integer, text outside markers;
- [ ] добавить boundaries для 1000 unicode code points и 2048-symbol https
  artifact;
- [ ] проверить, что html остаётся plain text;
- [ ] запустить targeted red;
- [ ] реализовать parser с независимыми `values`, `warnings`, `errors` и
  `canApply`;
- [ ] запустить targeted green и весь новый test file.

### задача 4: teacher section и prompt actions

**файлы:**
- изменить: `school.html`
- изменить: `school.js`
- изменить: `school.css`
- изменить: `test/school-ui.test.cjs`

- [ ] написать failing ui tests для порядка script tags, teacher section до
  старта, активного и финализированного урока;
- [ ] написать failing behavior tests для synchronous popup, clipboard success,
  blocked popup, invalid/empty url и fallback textarea;
- [ ] запустить targeted red;
- [ ] подключить config и bridge до `school.js`, добавить teacher dialog и
  school toast;
- [ ] кэшировать нормализованные content blocks текущего drawer;
- [ ] реализовать preview/copy/open actions без server mutation;
- [ ] запустить targeted green.

### задача 5: импорт, preview и применение к форме

**файлы:**
- изменить: `school.js`
- изменить: `school.css`
- изменить: `test/school-ui.test.cjs`

- [ ] написать failing tests: исходный textarea виден, parse показывает
  recognized/errors/warnings, parse не вызывает mutation;
- [ ] написать failing tests: apply заполняет controls, помечает их, не
  сохраняет и не блокирует ручное редактирование;
- [ ] написать failing test подтверждения artifact для missed;
- [ ] запустить targeted red;
- [ ] реализовать import и preview phases через безопасные dom nodes;
- [ ] реализовать apply-to-form и снятие отметки при ручном вводе;
- [ ] запустить targeted green.

### задача 6: явная финализация через существующий completeLesson

**файлы:**
- изменить: `school.js`
- изменить: `school.css`
- изменить: `test/school-ui.test.cjs`

- [ ] написать failing tests для editable final status и одного explicit save;
- [ ] подтвердить отдельным тестом, что final summary предшествует mutation;
- [ ] подтвердить whitelisted payload для completed, partial и missed;
- [ ] реализовать кнопку `Сохранить результат в дневник` через существующие
  `assessmentCommand` и `mutateWithDialogs`;
- [ ] сохранить reopen flow финализированных уроков;
- [ ] запустить targeted green и весь frontend suite.

### задача 7: документация и статические проверки

**файлы:**
- создать: `readme.md`
- изменить: `school.html`

- [ ] описать создание постоянных диалогов и заполнение url;
- [ ] описать allow-list hosts и cache-busting;
- [ ] поднять одну cache version для изменённых school assets;
- [ ] запустить `node --check` для изменённых browser js;
- [ ] запустить `node --test`;
- [ ] запустить `git diff --check`;
- [ ] проверить diff на token/jwt/service-role/private key patterns;
- [ ] подтвердить отсутствие изменений в `supabase/**` и notion schema.

### задача 8: browser qa и screenshots

- [ ] прочитать skill управления in-app browser;
- [ ] запустить локальный dashboard;
- [ ] проверить активный урок, пустой url, copy, completion request, import,
  preview, apply, manual edit, keyboard и clipboard fallback;
- [ ] проверить configured url через временную runtime-подмену без сохранения
  ссылки в git;
- [ ] снять screenshots desktop и mobile;
- [ ] не выполнять destructive mutations над реальными уроками;
- [ ] если нужна live mutation, создать и удалить только явно тестовую карточку;
- [ ] подтвердить, что осталось 18 реальных уроков.

### задача 9: публикация draft pr

- [ ] просмотреть полный diff и git status;
- [ ] коммитить завершённые логические блоки русскими lowercase subjects;
- [ ] push ветки;
- [ ] открыть draft pr с подробным русским lowercase описанием влияния,
  безопасности, тестов и ограничений;
- [ ] проверить опубликованный pr;
- [ ] не merge.

