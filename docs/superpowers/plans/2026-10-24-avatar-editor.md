# план редактора внешности

> для исполнителя: superpowers:executing-plans; реализация в текущей изолированной ветке, tests-first и финальное независимое ревью.

**цель:** мультяшный взрослый персонаж и редактор с живым превью.
**архитектура:** нормализация в path-core; модель в path-avatar;
изолированные preview renderer и controller редактора.
**стек:** vanilla js/html/css, локальная three.js 0.180.0, node:test, chrome/playwright.
**спецификация:** docs/superpowers/specs/2026-10-24-avatar-editor-design.md.

## ограничения

без новых зависимостей и облачных таблиц. avatar дополнен совместимо с v1.
принятые snapshot не переписываются. текст github и коммитов на русском
в нижнем регистре, без соавторства. pr #62 обновить, не merge.

## фокус ревью

- старый snapshot без новых полей читается без записи — тест задачи 1;
- явные неизвестные enum/цвета отклоняются — тест задачи 1;
- цвета одежды не меняют глаза/кожу — тест задачи 2;
- закрытие во время import не создаёт оставшийся renderer — browser задачи 3;
- stale/quota не теряют черновик и не меняют историю — browser задачи 3.

### задача 1: совместимая модель настроек

файлы: path-core.js, test/path-core.test.cjs.
интерфейс: normalizeAvatar(value) возвращает валидный полный avatar;
evaluate возвращает нормализованный avatar, не меняя исходный path.

- [ ] написать тесты полей, неизвестных значений и старых snapshot;
- [ ] запустить `node --test test/path-core.test.cjs`, увидеть red;
- [ ] реализовать normalizeAvatar и совместимость чтения;
- [ ] получить green, закоммитить логический блок.

### задача 2: мультяшная взрослая модель

файлы: path-avatar.js, path-scene.js, test/path-scene.test.cjs.
интерфейс: makePerson(stage), applyPerson(person, from, to, t) сохраняются;
stage.avatar поступает нормализованным из задачи 1.

- [ ] тесты переключения геометрии, цветов, пропорций и выражения → red;
- [ ] реализовать стили и пропорции, обновить cache entrypoints;
- [ ] получить green и проверить dispose, закоммитить блок.

### задача 3: редактор и проверка

файлы: path-avatar-editor.js, path-avatar-preview.js, path.html, path.css,
path.js, scripts/verify-path-avatar.cjs, README.md, screenshots.
интерфейс: mount({ core, store, getPath, getStage, onSaved, message }) → dispose;
createAvatarPreview(container, stage) → setAvatar/dispose.

- [ ] browser-тесты черновика/отмены/сохранения/reload/stale/fallback → red;
- [ ] реализовать изолированный controller и on-demand preview;
- [ ] проверить desktop/mobile, screenshot, повторное открытие и dispose;
- [ ] полный suite, syntax/format/diff checks; финальное ревью;
- [ ] закоммитить, обновить pr #62 без merge.
