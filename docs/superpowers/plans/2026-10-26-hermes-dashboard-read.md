# план read-only подключения hermes

> для исполнителя: использовать superpowers:executing-plans и regression-first; задачи исполняются последовательно, одно независимое review всей ветки перед pr.

**цель:** дать существующему windows hermes только чтение задач, целей и трекера.

**архитектура:** python stdio mcp вызывает ограниченный edge api. owner и credential hash фиксированы в edge; доступ к другим ключам и записи отсутствует.

**стек:** python 3.10+ stdlib, deno/typescript, native fetch, существующий supabase rest; без новых npm/pip зависимостей.

**спецификация:** `docs/superpowers/specs/2026-10-26-hermes-dashboard-read-design.md`.

## ограничения

- не менять frontend, существующий sync, школу, данные, auth/rls и монеты.
- не мержить новый pr и не разворачивать функцию без отдельного подтверждения.
- https, фиксированный owner uuid, hash 256-bit connector token, expiry 90 дней по умолчанию, gateway verify_jwt=true.
- 4096-byte request, 4-mib upstream, 1-mib response, 31 день, страницы 50 по умолчанию / максимум 100.
- timezone Asia/Yekaterinburg; задачи меняют активный день в 06:00, tracker использует календарный день.

## фокус review

1. token/owner/keys невозможно подменить через tool arguments; ни один метод не пишет данные.
2. незагруженный или повреждённый источник не превращается в ноль выполнений.
3. дата на границе 06:00, неделя пн–вс, прошлые периоды и 0.5 привычки не меняют смысл.
4. ошибки/redirect/oversized payload не раскрывают credentials и не возвращают частичный успешный snapshot.
5. stdio не печатает лишний текст, windows path проходит без shell, неизвестные параметры отклоняются.

### Task 1: ограниченный api и проекция данных

**файлы:** создать `supabase/functions/dashboard-read/{data.ts,handler.ts,index.ts,deno.json,test/read_test.ts}`, дополнить только function section `supabase/config.toml`.

**интерфейсы:** `parseCommand(raw, now): command`, `readDashboard(command, rows, now): response`; `handleRead(request, {env, fetch, now}): Promise<Response>`. входные rows имеют key/value/updated_at; наружу только нормализованные domain fields.

- [ ] написать failing tests для нормализации, дат/периодов, pagination/missing/corrupt и auth/owner/keys/no-write/лимитов.
- [ ] запустить `deno test test/read_test.ts`, убедиться в red из-за отсутствующей реализации.
- [ ] реализовать whitelist операций, bounded json, фиксированный owner, проверку hash/expiry и bounded rest get; wrapper читает env только на сервере.
- [ ] прогнать deno test/check/lint; проверить отсутствие новых миграций и изменений school/sync.
- [ ] закоммитить api и тесты логическим блоком.

### Task 2: windows-compatible stdio коннектор и установка

**файлы:** создать `integrations/hermes/dashboard_mcp.py`, `integrations/hermes/test_dashboard_mcp.py`, `docs/hermes-dashboard.md`.

**интерфейсы:** mcp initialize/ping/tools/list/tools/call; 5 инструментов спецификации. `--configure` создаёт config/env/yaml вне git через exclusive creation. обычный запуск `--config <absolute path>` не использует shell и не изменяет конфиги.

- [ ] failing unittest для config validation, https/redirect/secret-redaction, tool schemas и stdio subprocess protocol.
- [ ] убедиться в red, реализовать python stdlib adapter с bounded io и timeout.
- [ ] проверить setup без перезаписи, jsonrpc negotiation и настоящий http client через контролируемую transport boundary.
- [ ] документировать windows пути пользователя, добавление yaml snippet без замены существующего конфига, deployment/rotation/revocation и provider privacy.
- [ ] прогнать python unittest, полный node suite, новый и прежний deno suites/check/lint, diff-check; закоммитить.

### Task 3: review и передача

- [ ] независимое whole-branch review по фокусу выше; critical/important исправить tests-first.
- [ ] отчёт: проверки, границы, что не развёрнуто/не подключено, без секретов.
- [ ] открыть подробный pr на русском в нижнем регистре; приложить к чату, не мержить.
