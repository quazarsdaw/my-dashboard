# read-only подключение hermes: результат

## сделано

- отдельная ветка от main после squash-merge pr #65, без переноса school/frontend изменений в новый pr.
- edge api только для задач, целей и трекера: фиксированный owner uuid, случайный connector token с server-side hash/expiry, public anon jwt для неизменённого gateway verify_jwt. service-role key остаётся только в edge.
- пять mcp инструментов, python 3.10+ stdlib без новых пакетов/docker/node, stdio jsonrpc и готовый windows yaml snippet.
- setup создаёт только новые credential/env/yaml файлы вне git, ничего автоматически не добавляет в существующий config.yaml.
- лимиты, запрет redirect, строгая проекция, проверка полной выдачи count/content-range, missing/empty/corrupt и cloud metadata.
- числовые current/target сохраняют допустимый знак как в штатном редакторе; минуты и порядок по-прежнему неотрицательны.

## свежие проверки

| проверка | результат |
| --- | --- |
| `node --test test/*.test.cjs` | 537/537, skipped 0 |
| прежний backend `deno task test` | 108/108 |
| новый api `deno test supabase/functions/dashboard-read/test` | 14/14 |
| python `python3 -m unittest discover -s integrations/hermes -p 'test_*.py'` | 10/10 |
| новый/прежний deno check/lint, новый fmt check | успешно |
| python 3.10 grammar, toml / gateway jwt gates | успешно |
| production-equivalent импорт edge entrypoint с synthetic env | 401 до database fetch |
| `git diff --check` | успешно |

новые модули отсутствовали на первом red. дополнительные поведенческие red→green: усечённый upstream ошибочно принимался за missing; некорректный jsonrpc id отражался массивом; signed-цель из редактора ошибочно ломала все read-запросы. проверяются настоящий python http client на контролируемой сетевой границе и subprocess stdio; живой llm/provider и реальная база не вызывались.

## независимое review

source review диапазона `843f7e4..0dc2acc`: critical 0, important 1 (#68), minor 1 (#69). important воспроизведён тестом до исправления; после signed-number фикса весь разумный suite повторно зелёный. новый фикс проверен автором regression-first, без второго независимого review.

отложенный minor [#69](https://github.com/quazarsdaw/my-dashboard/issues/69): объединённый набор свыше 10000 задач может вернуть неприменимый nextCursor. workaround — запросы по одному дню, не бесконечный retry. это ограничение чтения экстремальных объёмов, не изменение/потеря записей.

## решения исполнителя и цена

1. только чтение первым этапом: безопасная запись требует доменных команд/наград/concurrency, поэтому telegram пока ничего не создаёт и не редактирует.
2. один owner/token через edge env вместо новой таблицы: отзыв/ротация администратором через secrets, без self-service ui; default expiry 90 дней.
3. python stdlib вместо нового runtime: существующего venv достаточно; реализован только нужный stdio subset, без resources/prompts/http mcp.
4. после «газ делай» работа выполнена inline по предложенному подходу: технические детали выбраны исполнителем и записаны в spec, новый merge и deployment не выполнялись.
5. exact upstream count обязателен: нестандартный proxy, удаляющий content-range, даёт безопасную ошибку вместо частичного результата.
6. production jwt/secrets/rls требуют отдельной live-проверки после deployment: локальные тесты не означают, что telegram уже подключён.
7. реальный windows/gateway/telegram allowlist недоступен: активный config и acl предстоит проверить владельцу, установка не объявляется завершённой.
8. credential не защищён от локального администратора/terminal-tool той же учётки: mcp не os sandbox; gateway, другие каналы и инструменты надо ограничить отдельно.
9. retention провайдера и реакция модели на инструкции в пользовательских текстах внешние: reader маркирует записи как данные, но не гарантирует поведение llm.

## что не делалось

не развёрнута новая edge function, не создавались настоящие connector credentials, не менялись server secrets, auth/rls, таблицы или миграции, реальные задачи/цели/трекер/монеты. windows компьютер пользователя не доступен; ssh host из known_hosts не использовался. полный sdk-to-installed-hermes и live telegram round-trip не проверен. новых ui нет, поэтому screenshot acceptance к этому api pr не применяется.

проверка схемы/миграций ограничена отсутствием их изменений; remote security advisor не запускался, его состояние не объявляется проверенным. библиотечных зависимостей не добавлено. app credentials не читались и не попадали в git; тесты используют только явно synthetic значения.

## отдельно: глаза

[pr #65](https://github.com/quazarsdaw/my-dashboard/pull/65) замержен по явному запросу пользователя: `843f7e4bad9581202feb54aff3a27b42f58843ba`. premerge review обнаружило reload-lease #67; исправлено red→green, browser acceptance с web locks/indexeddb и 537 frontend + 108 backend зелёные. issue #67 закрыт. github pages по https отдаёт eyes.js v3, coordination v2 и retireSession. это подтверждает публикацию assets, не live-приёмку реального аккаунта.

инструкция владельцу: [подключение на windows](../../hermes-dashboard.md). следующий шаг — review/approve нового pr, затем отдельно deployment api и подключение локального mcp с проверкой telegram allowlist.
