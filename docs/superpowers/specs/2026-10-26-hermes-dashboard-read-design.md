# hermes: чтение личного дашборда

## задача и границы

подключить существующий telegram hermes на windows, а не создавать второго бота. пользователь сообщил hermes v0.21.3, upstream 98f758ae, обычный git checkout и venv в `C:\Users\serv\AppData\Local\hermes\hermes-agent`. docker и ssh-доступ к этому компьютеру не предполагаются. upstream mcp-документация проверена на указанном коммите.

первый этап — только чтение задач, целей и трекера. школа, финансы, магазин, награды, произвольный sql, raw user_data, auth и изменения данных недоступны. изменения через подтверждение — отдельный следующий этап: существующий json sync не даёт безопасной серверной команды записи.

## подходы и выбранное решение

- браузерная автоматизация требует открытого сайта и доступа к сессии; не подходит для постоянного чтения.
- прямой database/admin mcp даёт слишком широкие права и раскрывает модель хранения; не подходит.
- выбран предложенный ранее ограниченный api + mcp-коннектор. python stdlib подходит к существующему windows venv, не требует node/docker и не меняет hermes.

пользователь попросил «газ делай». технические детали ниже выбраны исполнителем для минимального read-only этапа; это не разрешение на merge нового pr, production deployment или изменение windows-конфига без доступа к нему.

## архитектура и авторизация

`telegram → hermes → локальный python stdio mcp → dashboard-read edge function → фиксированный аккаунт user_data`.

edge использует служебный supabase key только внутри функции, с обязательными фиксированными owner и whitelist ключей в каждом запросе. этот key никогда не передаётся python, модели или frontend. отдельный случайный 256-bit connector token хранится только в локальном конфиге python; edge хранит sha256 token, owner uuid и срок действия. срок по умолчанию 90 дней, замена hash сразу отзывает прежний token. это один аккаунт/один коннектор, без новой таблицы и миграций.

gateway jwt verification остаётся включённой: python передаёт публичный legacy anon jwt в authorization/apikey и connector token в отдельном заголовке. anon jwt сам не является авторизацией данных. функция требует connector token и проверяет его hash/expiry до чтения данных; не принимает owner, raw keys или sql от клиента. локальная настройка отклоняет jwt с ролью не anon, чтобы случайно не сохранить service-role key.

строго https на официальном `<project-ref>.supabase.co`, запрет redirect и query/fragment/userinfo; никакого token в url/argv/logs. origin из браузера не поддерживается, cors не разрешается. request до 4096 байт, upstream до 4 mib, response до 1 mib, таймауты, безопасные коды ошибок без provider body/credentials. backend deployment и live-проверка требуют отдельного подключения/разрешения; до них интеграция не объявляется рабочей в telegram.

## инструменты и данные

- `get_today_tasks`: активный день с границей 06:00 по екатеринбургу.
- `list_tasks`: явный интервал до 31 дня; дата, snapshot reference, текст, выполнение, плановые минуты, сектор/сложность и подзадачи. позиция не выдаётся за постоянный id.
- `get_goals`: периоды week/month/quarter/year/5year/life, p1–p4, тип, прогресс, done; фильтры и страницы по 50, максимум 100. неделя пн–вс. legacy/некорректный период не назначается молча на текущий.
- `get_tracker`: good/bad, названия, отметки только указанного интервала до 31 дня. 0/0.5/1 сохраняют смысл; пропущенная отметка не считается подтверждённым невыполнением.
- `get_dashboard_summary`: количества задач активного дня, целей текущих периодов и отметок привычек календарного дня. не финансовый отчёт.

все ответы маркированы `last_synced_cloud`, содержат время чтения, timezone и состояние/updatedAt каждого источника. отсутствующие и повреждённые данные отличаются от пустого списка. неизвестные поля не проходят проекцию. тексты пользовательских записей — недоверенные данные, а не инструкции агенту. cloud snapshot не включает ещё не синхронизированные правки; несколько ключей не объявляются атомарным снимком.

## установка и проверка

python setup интерактивно создаёт config, env с hash и готовый yaml snippet в отдельной папке вне git, без перезаписи существующих файлов. конфиг hermes автоматически не меняется; секреты не печатаются. windows acl проверяет владелец перед подключением; локальный администратор и агент с terminal/file-доступом той же учётки могут прочитать конфиг — mcp не является os sandbox.

tests-first: нормализация реальных форматов json/text, фильтры и даты, pagination, missing/corrupt, auth/expiry/owner/whitelist/no writes, лимиты, redirect и secret redaction. python transport проверяется subprocess initialize/list/call/unknown/malformed. отдельно существующие frontend/backend tests, deno check/lint и production-equivalent import/config check. живой windows/telegram и production данные не подменяются mock-проверкой.

источники: [hermes на нужном коммите](https://github.com/NousResearch/hermes-agent/blob/98f758ae7e8db83c2bb9214c3b35adf41df15f03/website/docs/user-guide/features/mcp.md), [supabase auth](https://supabase.com/docs/guides/functions/auth), [rls и service role](https://supabase.com/docs/guides/database/postgres/row-level-security), [stdio mcp](https://modelcontextprotocol.io/specification/2025-06-18/basic/transports). changelog проверен; отключение старых tls cbc suites не требует ослабления ssl — используем штатную проверку сертификатов.
