# подключение hermes к дашборду

## что готово и что не подключено автоматически

коннектор читает задачи, цели и привычки твоего аккаунта из последнего cloud sync. школа, финансы, монеты, магазин, произвольные ключи и любые изменения недоступны. сайт может быть закрыт; ещё не отправленные локальные правки агент не увидит. метаданные ответа показывают время синхронизации каждого источника; это не атомарный снимок всех ключей.

код рассчитан на обычную windows-установку hermes v0.21.3 (upstream 98f758ae), python 3.10+ и mcp stdio. новых pip/npm-пакетов и docker нет. локальная проверка протокола не означает, что telegram уже подключён: нужны deployment функции и локальная настройка на windows.

## 1. файлы на windows

после проверки нового pr возьми файл `integrations/hermes/dashboard_mcp.py` из соответствующего коммита репозитория. сохрани, например, в `C:\Users\serv\.hermes\dashboard-connector\dashboard_mcp.py`. не скачивай случайную latest-версию из чужих репозиториев.

запусти в powershell существующий python hermes:

```powershell
& 'C:\Users\serv\AppData\Local\hermes\hermes-agent\venv\Scripts\python.exe' `
  'C:\Users\serv\.hermes\dashboard-connector\dashboard_mcp.py' `
  --configure 'C:\Users\serv\.hermes\dashboard-credentials'
```

мастер локально спросит сразу три значения:

- project url из supabase settings/data api, вида `https://<project-ref>.supabase.co`, без пути/слеша;
- **публичный legacy anon jwt** из api keys, не `service_role`, не `sb_secret_`, не токен сессии. ключ с другой ролью будет отклонён; publishable key нового формата в этой версии не поддерживается, потому что gateway verify_jwt остаётся включённым;
- uuid твоего пользователя из supabase → authentication → users. это аккаунт, которым ты входишь в дашборд; email или telegram id вместо uuid не подходят.

мастер создаст только новые файлы и не заменит существующие:

- `dashboard-read.json` — endpoint, публичный anon key и случайный connector token; хранить только на windows, не отправлять в чат/github;
- `dashboard-read.env` — только owner uuid, hash token и срок действия (90 дней); для secrets edge;
- `hermes-dashboard.yaml` — готовый блок с абсолютными путями и пятью разрешёнными инструментами, без самих credentials.

credential-каталог должен быть вне любого git checkout. на windows унаследованные ntfs acl могут разрешать чтение другим пользователям: проверь свойства папки → безопасность или `icacls 'C:\Users\serv\.hermes\dashboard-credentials'`; оставь доступ только необходимым учёткам владельца/system/администраторов. posix mode 0600 не заменяет windows acl. передача token в url, командной строке или telegram запрещена.

## 2. deployment edge — отдельное действие администратора

функция: `supabase/functions/dashboard-read`. новых таблиц и миграций нет. `verify_jwt = true` нельзя выключать для устранения 401.

администратор проверяет команды установленного cli через `supabase --help`, `supabase secrets set --help` и `supabase functions deploy --help`, затем после отдельного разрешения:

```powershell
supabase secrets set --project-ref <project-ref> --env-file 'C:\Users\serv\.hermes\dashboard-credentials\dashboard-read.env'
supabase functions deploy dashboard-read --project-ref <project-ref>
```

это примеры для выполнения на машине с cli, авторизованной в нужном проекте, из проверенного checkout. cli и docker устанавливать на машине hermes не требуется: администратор может добавить три значения из env через supabase dashboard и развернуть функцию со своей машины. сам `dashboard-read.json` никуда переносить не нужно. не делай `db push`, не разворачивай другие функции и не меняй school secrets.

`SUPABASE_URL` и `SUPABASE_SERVICE_ROLE_KEY` используются только внутри edge как штатные server-side credentials. в каждом чтении обязательны фиксированный owner uuid и whitelist ключей. service-role key никогда не должен попасть на windows в конфиг hermes, в frontend или в ответы модели.

## 3. подключение к существующему hermes

до включения коннектора проверь активную настройку `TELEGRAM_ALLOWED_USERS`: там должен быть только твой числовой telegram user id, не username. не делай бота общедоступным и не используй личный коннектор в общих групповых сессиях. api фиксирует аккаунт дашборда, но не проверяет telegram id — это обязанность gateway. другие каналы того же hermes тоже должны быть закрыты для посторонних.

найди активный `config.yaml`: обычно это `C:\Users\serv\.hermes\config.yaml`; если задан `HERMES_HOME`, используй его. сделай резервную копию и **объедини** блок из `hermes-dashboard.yaml` с существующим `mcp_servers`. не заменяй весь файл и не создавай второй корневой `mcp_servers`.

блок содержит command на python твоего venv, args на скрипт и credential-файл, `tools.include` ровно из пяти имён, `resources: false`, `prompts: false`. секреты не нужно вставлять в yaml или сообщения агенту.

после изменения безопасно перезапусти свой gateway привычным способом либо используй поддерживаемый `/reload-mcp`, затем новую telegram-сессию при необходимости. способ запуска gateway здесь не угадывается: systemd/docker к этому windows-компьютеру не относятся.

проверочные запросы:

- «покажи задачи активного дня и время последней синхронизации»;
- «какие цели на октябрь 2026 с приоритетами?»;
- «покажи привычки за 19–25 октября, различай половину и полную отметку»;
- «добавь задачу» — агент должен сообщить, что запись недоступна, а не притвориться, что сохранил её.

## инструменты и лимиты

| инструмент | аргументы |
| --- | --- |
| `get_today_tasks` | необязательные limit/cursor; активный день меняется в 06:00 Asia/Yekaterinburg |
| `list_tasks` | from/to, до 31 дня включительно; limit/cursor |
| `get_goals` | horizon, periodKey (только с horizon), includeDone, limit/cursor |
| `get_tracker` | from/to, до 31 календарного дня; страницы привычек limit/cursor |
| `get_dashboard_summary` | без аргументов |

страница — 50 записей по умолчанию, максимум 100. при `nextCursor` запроси следующую страницу с теми же фильтрами; concurrent sync может изменить состав страниц, это не frozen snapshot. периоды: пн YYYY-MM-DD; месяц YYYY-MM; квартал YYYY-Q1…Q4; год YYYY; пятилетки 2021/2026/2031; life. выполненные цели не удаляются. legacy period выдаётся как null с warning, а не назначается на текущий месяц.

tracker: null — отметки нет, не доказательство невыполнения; 0 — явно записанный ноль; 0.5 — половина полезной привычки; 1 — полная отметка (у bad означает зафиксированный срыв). монеты из этого ответа не вычисляются и не меняются. missing отличается от available с пустым списком; corrupt/недоступный источник даёт ошибку, а не «всё выполнено».

## отзыв, ошибки и приватность

для немедленного отзыва администратор заменяет `DASHBOARD_AGENT_TOKEN_SHA256`, убирает его или устанавливает прошедший `DASHBOARD_AGENT_EXPIRES_AT`. простое удаление локального конфига не отзывает украденный token на сервере. для ротации заново запусти мастер в **новом** credential-каталоге, обнови server secrets, затем args в yaml. старый token перестанет работать; автоматического renewal нет.

401: проверь действительный публичный anon jwt нужного проекта, соответствие hash и срок. не отключай jwt/rls и не подставляй service-role key. 503: серверные настройки отсутствуют. 502: база недоступна, источник повреждён или превышен лимит; не выдавай результат за пустые данные. redirect, http и посторонние домены запрещены. ошибочные provider body и credentials не выводятся.

данные tool-ответов передаются выбранному в hermes llm-провайдеру, могут сохраняться в его истории/логах. свой windows gateway не делает cloud-модель локальной. пользовательские тексты — недоверенные данные, не команды. коннектор ограничивает доступ к дашборду, но не является os sandbox: агент с terminal/file-доступом той же учётки и локальный администратор могут прочитать credential-файл. telegram allowlist и права остальных инструментов hermes нужно проверить отдельно, не расширяя их ради этого подключения.

## проверки разработчика

```text
python3 -m unittest discover -s integrations/hermes -p 'test_*.py'
deno test supabase/functions/dashboard-read/test
deno check supabase/functions/dashboard-read/index.ts supabase/functions/dashboard-read/test/*.ts
node --test test/*.test.cjs
```

windows/telegram, реальный аккаунт и production edge не проверяются этими локальными тестами. новый pr нужно проверить и утвердить отдельно от уже замерженного pr #65 с глазами.

источники: [mcp на коммите hermes пользователя](https://github.com/NousResearch/hermes-agent/blob/98f758ae7e8db83c2bb9214c3b35adf41df15f03/website/docs/user-guide/features/mcp.md), [авторизация edge](https://supabase.com/docs/guides/functions/auth), [rls](https://supabase.com/docs/guides/database/postgres/row-level-security), [cli](https://supabase.com/docs/reference/cli/introduction).
