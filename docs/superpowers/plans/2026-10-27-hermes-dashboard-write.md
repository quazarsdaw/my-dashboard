# план реализации подтверждаемой записи через hermes

> для исполнителя: обязательный навык — `superpowers:executing-plans` для реализации в текущем чате либо `superpowers:subagent-driven-development` после явного выбора такого способа пользователем. исполнять задачи последовательно, по checkbox-шагам, tests-first, с логическими коммитами. этот документ — план, не разрешение начинать реализацию или deployment.

**цель:** дать существующему windows/telegram hermes подтверждаемое создание и редактирование задач и целей без потери правок сайта, повторных записей и доступа к другим разделам.

**архитектура:** новые команды проходят `prepare → mcp elicitation → commit`; сервер хранит неизменяемый draft, проверяет owner, отдельный write token, версии и хеши. browser cas и серверный commit используют один postgres guard; старые вкладки после его включения не могут выполнять неверсированные записи. читатель остаётся отдельным коннектором.

**стек:** существующие javascript/umd и node:test, deno/typescript/native fetch, postgres rpc, python 3.10+ stdlib/sqlite/json-rpc. новых npm/pip runtime-зависимостей нет. на mac проверены node 24.14.1, deno 2.9.4, postgres tooling 18.4; production major — 17, поэтому отдельная проверка postgres 17 обязательна. docker нужен только изолированному ci при выборе контейнерного запуска, не windows hermes.

**спецификация:** [утверждённый дизайн](../specs/2026-10-27-hermes-dashboard-write-design.md), содержимое согласовано в коммите `2bbeaf37e5723a426a2782624e110e478c4f5874`; статус обновлён после явного утверждения.

## глобальные ограничения

- выполняются `1а, 2а, 3а`: каждое действие после подтверждения; задачи без выполнения/наград; цели с прогрессом/выполнением/возвратом. удаления, school/tracker/finance/coins/xp/store writes нет.
- фиксированный owner; `verify_jwt=true`; отдельный случайный 256-bit write token, sha256 в edge, срок по умолчанию 30 дней. исходный read token не расширяется.
- immutable draft на 5 минут; ожидание пользователя до 300 секунд; `mcp_servers.dashboard_write.timeout: 360`, `elicitation.enabled: true`, `elicitation.timeout: 300`.
- preview целиком до 2500 utf-16 code units; text/description/subtask limits — unicode code points по спецификации. обрезание запрещено.
- 32 kib внешнего request; 4 mib на защищённый документ; browser batch до 64 документов и 4 mib суммарно; одна сущность на write tool call, максимум два изменяемых документа для move task.
- серверные пределы: 20 активных drafts, 120 новых prepares и 60 первых commits за скользящие 10 минут на owner; идемпотентные повторы квоту не расходуют.
- `user_data.value` остаётся text; revision bigint передаётся строкой; исходные значения в миграции не пересериализуются. unknown поля не теряются.
- день задач меняется в 06:00 `Asia/Yekaterinburg`; неделя пн–вс, пятилетки с якорем 2026. legacy/невалидный период не подставляется текущим при записи.
- подробные payload очищаются в течение суток, receipts/audit через 30 дней; минимальный реестр request ids живёт до удаления аккаунта.
- никакого blind replay/rename/repair миграций. pending `20260728220641_harden_user_data_rls.sql` сначала сравнивается с фактической схемой/history.
- github issue/pr/коммиты и новые пояснения — на русском, в нижнем регистре; машинные идентификаторы сохраняют точное написание. co-authorship не добавлять.
- никаких production migrations/deploys, credentials, live mutations, установки расширений, включения прав или merge без отдельных разрешений. результаты mocks/local/ci не объявляются telegram/production acceptance.

## фокус проверки

1. локальная правка после отправки предыдущей: запоздалый ack/realtime не должен удалить новый dirty state или примениться после смены аккаунта — задачи 3 и 5.
2. offline/stale редактор с прежним индексом: сохранение не должно изменить соседнюю задачу после переноса/remote update — задачи 2 и 4.
3. emoji, bidi и длинные descriptions: разные единицы длины, полный читаемый preview, безопасный отказ вместо скрытого truncation — задачи 6 и 10.
4. очищенный receipt и неизвестный commit после restart: прежний request id не становится новым действием, подготовленный статус не выдаётся за доказательство отсутствия позднего commit — задачи 7 и 9–10.
5. сектор/период/числа на границах: изменившиеся definitions инвалидируют preview; неизвестный сектор, отрицательные current/target, понедельник и граница 06:00 не подменяются defaults — задачи 6 и 8.

## разбиение и зависимости pr

| pr | задачи | результат без включения writer |
| --- | --- | --- |
| 1: `feature/hermes-dashboard-versioned-sync` | 1–5 | серверные версии, совместимый read api, защищённая синхронизация/редакторы и conflict ui; guard выключен |
| 2: `feature/hermes-dashboard-write-api` | 6–8 | typed api, drafts/ledger/rates/cleanup; запись выключена |
| 3: `feature/hermes-dashboard-write-mcp` | 9–11 | отдельный windows-коннектор, elicitation, recovery и release candidate; production activation отдельно |

pr #70 сейчас открыт: head `cc74d37acfca58c610b257176ec6ffbc8bd82cde`, base `main`. pr 1 основывается на `feature/hermes-dashboard-read`, pr 2 — на pr 1, pr 3 — на pr 2. ветка дизайна содержит только документы и используется как локальная исходная точка pr 1. перед началом снова проверить состояние #70: если уже merged, перенести только документы/свои изменения на свежий main. после merge нижележащего pr следующий retarget/rebase на main, проверить чистый diff и повторить полный релевантный набор тестов. не мержить зависимости самостоятельно.

это один связанный проект, а не независимые сервисы: writer нельзя включать без первого pr. три pr дают отдельные проверяемые поставки, не три независимо активируемых режима записи.

## структура файлов и общие интерфейсы

существующие entrypoints, `Gamification.storeGet/storeSet`, ключи и пять read tools сохраняются. не превращать `index.html` или `supabase-sync.js` в полную переписанную версию приложения.

- postgres: новые migrations с суффиксами `dashboard_document_versions`, `dashboard_write_ledger`, `dashboard_write_cleanup`; **timestamp выдаёт только `supabase migration new`**, полученные точные имена записать в progress report. внутренние таблицы — `private.dashboard_write_accounts`, `private.dashboard_write_requests`, `private.dashboard_write_drafts`, `private.dashboard_write_receipts`, `private.dashboard_write_audit`.
- тестовая db: `supabase/tests/pg_harness.py`, `supabase/tests/fixtures/dashboard_bootstrap.sql`, `supabase/tests/test_document_versions.py`, `supabase/tests/test_write_ledger.py`, `scripts/test-dashboard-db.py`, `.github/workflows/dashboard-write-tests.yml`.
- frontend: `dashboard-sync-core.js`, `dashboard-sync-conflicts.js`, `dashboard-sync-conflicts.css`, `dashboard-tasks-core.js`; integration в существующих `supabase-sync.js`, `index.html`, `goals.html`, `profile.html`, минимальное дополнение `goals-core.js`.
- html с общим sync: `index.html`, `goals.html`, `profile.html`, `inbox.html`, `tracker.html`, `health.html`, `gym.html`, `finance.html`, `menu.html`, `store.html`, `school.html`, `path.html`, `eyes.html`; новые core/conflict assets загружаются перед sync, с согласованными cache versions.
- shared domain: `supabase/functions/_shared/dashboard-write/{contracts,commands,documents,tasks,goals,preview}.ts`; каждый файл — одна ответственность, без browser globals и env.
- edge: `supabase/functions/dashboard-write/{index,handler,auth,repository,service,errors}.ts`, `deno.json`, `test/{domain,handler,service}_test.ts`; изменить только новую function section в `supabase/config.toml`. reader отдельно: `supabase/functions/dashboard-read/{data,handler}.ts` и его tests.
- python: `integrations/hermes/dashboard_write_mcp.py`, `dashboard_write_client.py`, `dashboard_write_outbox.py`, `dashboard_write_protocol.py`, `test_dashboard_write_*.py`; существующий `dashboard_mcp.py` не становится writer.
- поставка: `scripts/package-dashboard-write.py`, `scripts/check-dashboard-write-contracts.py`, `scripts/serve-dashboard-write-fixture.cjs`, `test/fixtures/dashboard-write/`, `supabase/ops/{enable,disable}_dashboard_write.sql`, `supabase/ops/enable_dashboard_write_cleanup.sql`, `docs/hermes-dashboard-write.md`, `docs/superpowers/reports/2026-10-27-hermes-dashboard-write.md`.

общие типы в `contracts.ts` и их одноимённые js/python эквиваленты:

```typescript
type Revision = string; // десятичная строка; "0" означает отсутствующую строку
type Snapshot = { key: string; exists: boolean; valueText: string | null; revision: Revision; updatedAt: string | null };
type Change = { key: string; expectedRevision: Revision; valueText: string | null };
type Target = { id: string; expectedRevision: Revision } | { reference: string; expectedRevision: Revision };
type TaskTarget = Target & { date: string };
type Versions = Record<string, Revision>;
type RpcOutcome<T> = { ok: true; data: T } | { ok: false; error: { code: string; status: number }; current?: Snapshot[] };
type Prepared = { requestId: string; draftId: string; previewText: string; expiresAt: string };
type Receipt = { requestId: string; draftId: string; outcome: "committed"; operation: string; targetId: string; versions: Versions; committedAt: string };
type PrepareOutcome = { state: "prepared"; draft: Prepared } | { state: "committed"; receipt: Receipt };
type ResolvedMutation = Mutation & { context: { effectiveDate: string | null; targetId: string } };
type MutationEffect = { changes: Change[]; dependencies: { key: string; expectedRevision: Revision }[]; targetId: string; before: Record<string, unknown> | null; after: Record<string, unknown>; warnings: string[]; afterHashes: Record<string, string> };
```

`Snapshot.exists=false` отличается от `exists=true,valueText=null` (tombstone). jsonb используется для rpc envelopes, не вместо text-столбца. revisions не преобразуются в javascript number ни при read, ни при compare.

`Mutation` — закрытый discriminated union по таблице команд задачи 6; `operation` и `arguments` не теряют связь при narrowing. `ResolvedMutation` хранит нормализованную команду с defaults и однажды вычисленный context: commit не вызывает часы/uuid заново; fingerprint исходной команды рассчитывается до defaults. `MutationEffect.before/after` содержит только разрешённые поля выбранной сущности для preview, а не полный документ. dependencies включают изменяемые ключи и прочитанные определения; afterHashes содержат sha256 точных будущих utf-8 value texts по изменяемым ключам.

фиксированные rpc:

- `dashboard_sync_capabilities()` → `{protocol:2,guardEnabled,writeEnabled}`; owner из `auth.uid()`.
- `dashboard_read_user_data(p_after_key text,p_limit integer)` → строки с `revision::text`, owner из `auth.uid()`, limit 1–500, pagination по key.
- `dashboard_save_documents(p_changes jsonb)` → `RpcOutcome<Snapshot[]>`; только защищённые ключи текущего authenticated owner.
- `dashboard_read_agent_documents(p_owner uuid,p_keys text[])` → `Snapshot[]`; service-only, whitelist daily/goals/tracker/sector definitions; edge всегда фиксирует owner/keys.
- `dashboard_agent_prepare(p_owner uuid,p_credential text,p_request uuid,p_command_hash text,p_payload jsonb)` → `RpcOutcome<PrepareOutcome>`; повтор уже завершённого запроса возвращает receipt, не повторное подтверждение.
- `dashboard_agent_load(p_owner uuid,p_credential text,p_request uuid,p_draft uuid)` → immutable draft для восстановления commit; service-only, payload не возвращается модели.
- `dashboard_agent_commit(p_owner uuid,p_credential text,p_request uuid,p_draft uuid,p_documents jsonb)` → `RpcOutcome<Receipt>`.
- `dashboard_agent_status(p_owner uuid,p_credential text,p_request uuid)` и `dashboard_agent_cancel(p_owner uuid,p_credential text,p_request uuid,p_draft uuid)` → bounded статус/receipt, без draft payload.

все rpc `security invoker`; owner policies сохраняются. accounts хранит только owner/flags, без credentials: authenticated получает только owner-filtered select нужных flags в private schema для capability rpc, без update/insert/delete. остальные private таблицы — только service role. trigger читает флаг через узкий helper с пустым search_path и без прямого execute для внешних ролей. ни одна private schema не добавляется в exposed schemas.

обычный conflict/domain outcome возвращается как `ok:false`, не исключением после изменения draft: исключение откатило бы и состояние `conflicted`. техническое исключение откатывает всю транзакцию. edge не передаёт наружу postgres messages.

## pr 1 — версии и синхронизация

### задача 1: воспроизводимая db-проверка и атомарный cas

**файлы:** создать db harness/fixtures/test runner/workflow из карты; migration `dashboard_document_versions`; дополнить progress report. исходные migration files не менять.

**интерфейсы:** `PgHarness.start()/close()`, `sql(statement,role=None,claims=None)`, `rpc(name,args,owner)`, `parallel(calls)`; первые четыре rpc списка выше. `private.dashboard_write_accounts(owner_id,guard_enabled=false,write_enabled=false)` с rls.

- [ ] **сначала зафиксировать проблему:** проверить branch/head/dirty/remote #70; найти дубликат issue, затем оформить один issue «защитить задачи и цели от потери правок при одновременной записи сайта и hermes». описать source→impact, отсутствие cas и pending hardening, сценарий двух клиентов, риск потери данных, критерии исправления и файлы. не публиковать account/token/реальные записи. записать issue url в report.
- [ ] **red:** написать реальные postgres tests: stale update, два insert с base `0`, tombstone против старой вставки, multi-key rollback, другой owner/anon, old upsert/physical delete после guard и отсутствие изменений raw text при migration. опорная проверка:

```python
first = db.rpc("dashboard_save_documents", {"p_changes": [change(key, "0", "[]")]}, owner)
stale = db.rpc("dashboard_save_documents", {"p_changes": [change(key, "0", "[1]")]}, owner)
assert first["ok"] is True
assert stale["error"]["code"] == "conflict"
assert db.read(owner, key)["valueText"] == "[]"
```

  `change(key,revision,valueText)` и `db.read(owner,key)` определить в harness как thin wrappers над зафиксированными rpc. запустить `python3 scripts/test-dashboard-db.py --suite versions`; до реализации ожидается red из-за отсутствующих rpc/версий, не из-за неправильного подключения.
- [ ] **реализация:** runner создаёт свой `tempfile` cluster/database, использует только локальный unix socket, не читает `.env` и не принимает production url. отдельный `--ci` принимает только explicit test env, loopback и имя `dashboard_write_test_*`; проверяет synthetic marker, иначе abort. bootstrap создаёт роли/auth stubs, не эмулирует cas/rls. применить существующие migrations по порядку; новую создать штатным cli после `--help` (cli пока не установлен в PATH; offline npm cache не считается доступным). trigger проверяет base и очищает его, повышает revision, запрещает owner/key change и guarded delete; rpc сначала валидирует/блокирует весь batch по `(owner,key)`, только потом пишет. никакой подстановки актуальной версии вместо ожидаемой.
- [ ] **green:** новая suite на локальном pg18; в ci — pg17 и существующие pgTAP sql suites. закрепить реальный официальный image/actions digest после проверки источника, не оставлять `latest`/placeholder. отсутствие pgTAP/pg17 — явно неполная проверка, не green. для локальной новой suite pgTAP не нужен: проверки через настоящий sql и unittest; pgTAP запускается в отдельном совместимом окружении. подтвердить guard=false/write=false и неизменные values.
- [ ] **коммит:** `добавить серверные версии и атомарное сохранение документов`. независимо проверить grants, no-public-execute, конкурентные sessions и отказ runner на любом нетестовом endpoint.

### задача 2: добавить версии в читатель без расширения его прав

**файлы:** изменить `supabase/functions/dashboard-read/{data,handler}.ts`, `test/read_test.ts`; дополнить db tests для service read rpc. python reader не переписывать.

**интерфейсы:** дополнить `Row` полями `revision?: string`, `exists?: boolean`, разрешить `updated_at:string|null`; `Source.revision: string|null`. существующие root keys/meta/operations сохранены. task item получает `id:string|null`; legacy reference остаётся `${date}:${index}`; legacy goal без id получает reference `goal:${index}`, bound revision и warning, а не произвольный id.

- [ ] **red:** tests `revision_above_safe_integer_is_a_string`, `legacy_reference_is_snapshot_bound`, `reader_still_rejects_writes_and_other_keys`. опорные assertions: `source.revision === '9007199254740993'`, `task.id === null` для legacy, прежние summary/пагинация/negative goals не меняются.
- [ ] **проверить red:** из каталога `supabase/functions/dashboard-read` выполнить `deno task test`; падение именно на новых assertions.
- [ ] **реализация:** читать через `dashboard_read_agent_documents`, который сериализует revision в sql как text; mapper `Snapshot → Row` сохраняет text без parse/stringify, переводит `valueText` в прежнее `value`, не отбрасывая exists/revision. фиксированный owner и старый command key whitelist не меняются. новые metadata не попадают в произвольный raw ответ. отсутствующая строка и tombstone получают revision `0` и реальную revision соответственно. не выдавать фиктивную revision старым fixtures без неё.
- [ ] **green:** `deno task test`, `deno task check`, `deno task lint` в reader; `python3 -m unittest discover -s integrations/hermes -p 'test_dashboard_mcp.py'`; db read isolation tests. публикация обновлённого reader возможна только после migration, старый deployed reader до этого не трогать.
- [ ] **коммит:** `дополнить чтение версиями и устойчивыми ссылками на записи`.

### задача 3: состояние синхронизации без потери локальных правок

**файлы:** создать `dashboard-sync-core.js`, `test/dashboard-sync-core.test.cjs`, `test/helpers/supabase-sync.cjs`; изменить `supabase-sync.js`, `test/supabase-sync.test.cjs`.

**интерфейсы:** umd `DashboardSyncCore.reduce(state,event) -> {state,effects}`; события `local_edit`, `remote`, `push_started`, `push_ok`, `push_failed`, `resolve`, `account_changed`. state per owner/key: base snapshot, dirty value/epoch, in-flight snapshot, conflict. `DashboardSync.getDocumentToken(key)` и `canApplyDocumentToken(token)` добавляются без удаления `forceSync`; token содержит owner/key/baseRevision/localEpoch.

- [ ] **red:** assertions для `late_ack_keeps_next_edit`, `own_echo_is_not_a_conflict`, `remote_does_not_overwrite_dirty`, `logout_discards_late_callbacks_not_pending_owner_data`, `unknown_base_requires_resolution`, `clock_skew_does_not_win_over_revision`. пример: отправить локальное `b`, затем изменить на `c`, получить ack `b`; base становится `b`, dirty остаётся `c`.
- [ ] **проверить red:** `node --test test/dashboard-sync-core.test.cjs test/supabase-sync.test.cjs`.
- [ ] **реализация:** чистый reducer без io; adapter хранит state под `_sync_cas_v2:<owner>`, исключает prefix из общего sync/export, serializes per-owner pushes. capability v2 выбирает cas для защищённых ключей даже до включения guard; legacy прочие keys сохраняют прежний маршрут. fallback к v1 разрешён только на точно отсутствующую capability rpc, не на auth/network error. pull пагинируется через `dashboard_read_user_data`; no timestamp arbitration для v2. protected batch целиком cas, без chunking одного переноса; при превышении лимита сохранить pending и явно отказать. mixed legacy writes независимы, но весь batch не объявлять атомарным.
- [ ] **green:** targeted и весь `node --test test/*.test.cjs`; tests удерживают promises в разном порядке, перезапускают vm с сохранённым state, переключают owner. `pushNow/forceSync` при conflict возвращают явный outcome, а не success; готовая local-only копия не получает последнюю revision «для повторной отправки».
- [ ] **коммит:** `сохранить локальные правки при версионной синхронизации`.

### задача 4: устойчивые id и защита открытых редакторов

**файлы:** создать `dashboard-tasks-core.js`, `test/dashboard-tasks-core.test.cjs`, `test/tasks-editor.test.cjs`; изменить `index.html`, `goals.html`, `goals-core.js`, `test/goals-editor.test.cjs`, `test/goals-period-ui.test.cjs`.

**интерфейсы:** `DashboardTasksCore.createTask(fields,uuidFn)`, `patchTask(tasks,target,patch)`, `moveTask(source,destination,target)` — возвращают новые массивы и сохраняют unknown fields. ui target связывает id (или legacy index) с document token из задачи 3. browser uuid создаётся `crypto.randomUUID()` один раз и остаётся тем же после ack/offline/reload.

- [ ] **red:** `remote_reorder_cannot_redirect_editor_save`, `cloud_update_invalidates_legacy_index`, `offline_uuid_survives_sync`, `move_keeps_description_subtasks_and_unknown_fields`, `copy_gets_new_id`. открытый редактор первой задачи после remote insert перед ней не меняет новую первую запись.
- [ ] **проверить red:** `node --test test/dashboard-tasks-core.test.cjs test/tasks-editor.test.cjs test/goals-editor.test.cjs`.
- [ ] **реализация:** привязать inline title, sphere picker, modal, delete/reorder на сайте к актуальному id/token; при устаревании остановить действие и предложить открыть заново. проверить добавление, завтра, перенос, rollover/copy, screenshot import и batch actions; реальные копии получают новый id, переносы сохраняют. не массово выдавать id старым сущностям и не менять semantics браузерных наград. `Date.now()` больше не источник id новых задач/целей.
- [ ] **green:** targeted + весь frontend suite; отдельный test на отсутствие crypto отклоняет создание без fallback-id. проверки выполненной задачи на сайте/возврата работают как раньше; ограничение hermes не отключает обычный ui.
- [ ] **коммит:** `закрепить идентификаторы и защитить редакторы от устаревших данных`.

### задача 5: видимое разрешение конфликтов и безопасный импорт

**файлы:** создать `dashboard-sync-conflicts.js/.css`, `test/dashboard-sync-conflicts.test.cjs`, `test/sync-assets.test.cjs`, `scripts/serve-dashboard-write-fixture.cjs`, `test/fixtures/dashboard-write/`, `test/dashboard-write-fixture.test.cjs`; изменить `supabase-sync.js`, `profile.html` и script/style references в 13 html из карты. product test bypass не добавлять.

**интерфейсы:** `DashboardSyncConflicts.open({local,remote,base,onChoose}) -> close`; `DashboardSync.resolveConflict(key,choice,token): Promise<outcome>`, choice — `use_remote` или `apply_reviewed_local`. этот локальный ui API не экспортируется в hermes. fixture server — только loopback, synthetic users/data и sdk в генерируемом тестовом html; без live sdk/network и без изменения production assets.

- [ ] **red:** assertions: local+remote показаны полностью через text nodes; escape/отмена не сохраняют; новый remote revision между показом и click снова даёт conflict; restore/reset не удаляет cas state до подтверждённого исхода. отдельно `protected_reset_failure_keeps_local_data`, `import_cannot_supply_sync_metadata_or_revision`, `all_pages_load_core_before_sync`.
- [ ] **проверить red:** `node --test test/dashboard-sync-conflicts.test.cjs test/supabase-sync.test.cjs test/sync-assets.test.cjs test/eyes-backup.test.cjs`.
- [ ] **реализация:** фокусируемый dialog с scrollable двумя версиями, account/key/date и явными кнопками; без html из данных, без автоматического «оставить мои». resolve token связан с owner/base/remote revision/local epoch. импорт app values не импортирует `_sync_*`, tokens или revisions; конфликтное состояние переживает reload. защищённый общий reset явно блокируется до отдельного контролируемого решения, не продолжает `localStorage.clear()` после отказа облака. добавить core/conflict assets с одной cache version до `supabase-sync.js`; UI влияет только на конфликтующие documents. fixture server подменяет sdk до старта sync только в тестовом html response; regression test запрещает исходящие обращения к настоящему supabase.
- [ ] **green:** весь frontend и обе edge suites; через штатный computer-use инструмент проверить synthetic desktop/mobile: два клиента, stale modal, offline/reload, отмена, полные обе версии и смена аккаунта. сохранить screenshots до открытия pr 1, без зависимости от задач будущих pr. оформить подробный pr 1 с issue reference, влиянием на старые вкладки и guard=false, приложить к чату, не мержить.
- [ ] **коммит:** `показать конфликты синхронизации без потери локальных данных`.

## pr 2 — ограниченная серверная запись

### задача 6: закрытые команды, чистые преобразования и точный preview

**файлы:** создать шесть shared domain modules из карты и `dashboard-write/test/domain_test.ts`, `deno.json` с tasks `test/check/lint`. конфигурация entrypoint добавляется в задаче 8.

**интерфейсы:** `parseMutation(operation,args): Mutation` без вычисления текущего дня; `fingerprintMutation(command): Promise<string>` по canonical исходным arguments; `resolveMutation(command,{now,newUuid}): ResolvedMutation` фиксирует defaults/id; `applyMutation(resolved,snapshots,options): MutationEffect`; `renderPreview(effect): string`. effect содержит changes, read dependencies, target id, before/after разрешённых полей, warnings и sha256 будущих текстовых values.

точные model аргументы:

| tool | arguments |
| --- | --- |
| create_task | text; optional description/date/estimatedMin/sphere/difficulty/subtasks:[{text}] |
| update_task | target:TaskTarget; optional patch с text/description/estimatedMin/sphere/difficulty, subtaskEdits:[{index,text}], appendSubtasks:[{text}]; хотя бы одно непустое изменение |
| move_task | target:TaskTarget, toDate |
| create_goal | title,horizon,periodKey,type; optional priority/target/unit/current |
| update_goal | target:Target, patch с title/priority/target/unit |
| move_goal | target:Target,toHorizon,toPeriodKey; optional priority |
| set_goal_progress | target:Target,current |
| complete_goal | target:Target |
| reopen_goal | target:Target; current обязателен для number и ниже target |
| get_edit_options | пустой object, read-only |

- [ ] **red:** table-driven assertions всех правил §5–6 дизайна, неизвестных полей, done-task отказа, отсутствующего/дублирующегося target, сохранения unknown fields. числа `current=-20,target=-10` после complete становятся `-10,true`, reopen без current отклоняется; target `0` не подменяется `1`. на границе `2026-10-27T01:00:00Z` default task date — `2026-10-27`; до неё — предыдущая. legacy goal period не нормализуется молча. raw документ с unknown числом `9007199254740993` при правке text отклоняется без изменения исходных bytes, если преобразование не гарантирует сохранность числа; обычный json parse/stringify с округлением недопустим.
- [ ] **проверить red:** из `supabase/functions/dashboard-write` выполнить `deno test test/domain_test.ts`.
- [ ] **реализация:** разделить validation/defaults от pure task/goal transforms. fingerprint сохраняет отсутствие optional date до defaults: повтор request id после 06:00 обязан вернуть первый draft, не новый день. canonical serialization/hash детерминированы; повреждённый json/unsafe legacy числа не переписываются с потерей точности. preview безопасно показывает control/bidi и все побочные эффекты; `😀` считается одним code point и двумя utf-16 units. длинный before/after отклоняется целиком; duplicate creation имеет явное предупреждение в новом preview без silent dedup.
- [ ] **green:** domain suite; property assertions original snapshots не изменены, затронут только target, move затрагивает ровно два key; preview ровно 2500 units принимается, 2501 отвергается, 500 emoji в task title принимаются, 501 — нет; get_edit_options возвращает только id/name/icon без xp/balance.
- [ ] **коммит:** `описать закрытые команды задач и целей с точным предпросмотром`.

### задача 7: долговечный ledger, атомарный commit и очистка

**файлы:** migrations `dashboard_write_ledger`, `dashboard_write_cleanup`; `supabase/tests/test_write_ledger.py`; `supabase/ops/enable_dashboard_write_cleanup.sql`; дополнить runner/workflow.

**интерфейсы:** оставшиеся service-only rpc из общего списка. requests — уникальность `(owner_id,request_id)`, fingerprint/generation/terminal outcome/target/versions/timestamps; drafts — resolved command/preview/base versions/after hashes/dependencies, ttl 300 секунд; подробные receipts/audit отделены от минимального ledger. `private.dashboard_write_cleanup(): jsonb` только для postgres job.

- [ ] **red:** настоящие concurrent db tests `same_request_commits_once`, `different_payload_same_id_rejected`, `conflict_persists_terminal_state`, `move_rolls_back_both_documents`, `retired_request_never_recreates`, `rate_window_is_rolling`, `replays_do_not_consume_quota`, `cleanup_keeps_minimal_ledger`. после purge подробного receipt prepare/commit дают 410, status содержит terminal outcome+`receipt_expired`, прежний id не записывает ничего.
- [ ] **проверить red:** `python3 scripts/test-dashboard-db.py --suite writer`; падения на отсутствующих объектах/контрактах, не подключении к production.
- [ ] **реализация:** owner account row сериализует quota/prepare; сначала повтор/request mismatch, затем квоты. rolling counts по серверному времени и индексам `(owner_id,prepared_at)/(owner_id,committed_at)`, не in-memory edge. commit блокирует draft и все dependencies в постоянном порядке, сверяет owner/generation/guard/write/ttl/versions/hashes до записей; helper guard из задачи 1 обязателен. обычный конфликт сохраняет `conflicted` и возвращает outcome; изменение документов и receipt/terminal ledger атомарны. отдельно private hourly cleanup без сетевых calls, сырого текста в audit и очистки requests registry.
- [ ] **green:** limits: 20/21 drafts, 120/121 prepares, 60/61 commits за 600 секунд и boundary окна; переключение flags/rotation/expiry между prepare/commit; concurrent first-insert/move. schema cleanup function тестируется напрямую в изолированной db. ops script после отдельного разрешения включает `pg_cron` и ровно один job `dashboard-write-cleanup` с `0 * * * *`; повторный запуск не создаёт второй job. сейчас pg_cron доступен 1.6.4, но не установлен: план не заявляет, что job уже работает. receipts удаляются с учётом срока, payload scrubbing не затрагивает texts в user_data.
- [ ] **коммит:** `сделать подтверждённые изменения атомарными и идемпотентными`.

### задача 8: edge api с отдельной авторизацией и выключателем

**файлы:** создать `dashboard-write/{index,handler,auth,repository,service,errors}.ts`, tests `handler_test.ts/service_test.ts`; добавить новую section config; существующую школу не менять.

**интерфейсы:** `handleWrite(request,{env,fetch,now}): Promise<Response>`; env — штатные supabase credentials, фиксированный `DASHBOARD_AGENT_USER_ID`, только новые WRITE_TOKEN_SHA256/WRITE_EXPIRES_AT. `Repository.read(keys)`, `prepare(...)`, `load(...)`, `commit(...)`, `status(...)`, `cancel(...)` вызывают только зафиксированные rpc.

маршруты только post: `/prepare` с `{requestId,operation,arguments}`, `/commit` и `/cancel` с `{requestId,draftId}`, `/status` с `{requestId}`, `/options` с `{}`. root endpoint валиден только как база для фиксированных suffix, лишние path/query и browser origin отклоняются; никакого универсального rpc proxy.

- [ ] **red:** auth/expiry/origin/no-owner/no-force/no-extra-field/size tests; после prepare с последующей сменой source revision commit=409; смена sphere definitions тоже 409; token rotation/write disable=401/403 без записи. commit с новым patch=422, body/private provider errors не проходят наружу.
- [ ] **проверить red:** `deno task test` в writer; before implementation должны отсутствовать handler/repository.
- [ ] **реализация:** перед любым чтением — auth; для mutations оба flags guard/write. schema и hash исходной команды до вычисления defaults; rpc authoritative повтор возвращает первый draft даже при гонке/смене дня. commit загружает immutable draft, читает нужные snapshots и восстанавливает те же changes через задачу 6, db окончательно проверяет хеши/версии. read dependencies могут включать sectors, writes — только daily/goals. external request 32768 bytes; internal response bounded отдельно с учётом шестикратного json escaping до 64 mib для двух документов по 4 mib, decoded limit каждого обязателен; headers no-store/nosniff, tls/no-redirect/timeouts. wrapper env не попадает в domain/test fixtures.
- [ ] **green:** deno test/check/lint writer+reader+school; db writer suite и config/import/whitelist checks; tests закрытого сайта выполняют полный service flow через controlled rpc boundary, но не объявляются real telegram. оформить pr 2 с base pr 1, точными grants/disabled состоянием и тестами; attach к чату, не merge/deploy.
- [ ] **коммит:** `добавить отключённый по умолчанию api подтверждаемой записи`.

## pr 3 — windows mcp и release candidate

### задача 9: отдельный writer config, transport и persistent outbox

**файлы:** создать `dashboard_write_client.py`, `dashboard_write_outbox.py`, `dashboard_write_mcp.py`, tests `test_dashboard_write_client.py/test_dashboard_write_outbox.py`; документацию установки начать в `docs/hermes-dashboard-write.md`.

**интерфейсы:** `WriteClient.prepare(request_id,operation,args)`, `commit(request_id,draft_id)`, `status(request_id)`, `cancel(request_id,draft_id)`, `options()`; `Outbox.allocate(operation,args)->request_id`, `mark_prepared(...)`, `mark_commit_sent(...)`, `mark_terminal(...)`, `unresolved()->list`. `configure_write(directory,project_url,anon_key,owner_id,now=None)` создаёт `dashboard-write.json`, `dashboard-write.env`, `dashboard-write.hermes.yaml`, `dashboard-write-outbox.sqlite3` в новом каталоге, не редактирует read config.

- [ ] **red:** exclusive setup/outside-git/no-admin-key/no-token-stdout, windows paths без shell, 30-day expiry; sqlite survives crash; `commit_sent` сохраняется до io; generation/hash mismatch не продолжает старое действие. reader credentials/env/yaml остаются побайтово прежними.
- [ ] **проверить red:** `python3 -m unittest discover -s integrations/hermes -p 'test_dashboard_write_*.py'`.
- [ ] **реализация:** python stdlib https с фиксированным endpoint/suffix, без redirects/proxy url из tool args и безопасными кодами. request limit 32768 bytes, response limit 1048576 bytes до json decode, network timeout 20 секунд; oversized response не читается целиком в память. `--configure-write <absolute new directory>` и `--config <absolute writer json>`; новый token 32 random bytes, expiry 30 дней. raw token только в приватном `dashboard-write.json` вне git; env содержит его hash/expiry для edge, yaml — пути запуска, outbox — никакого raw token. разрешён только role=anon jwt, не service-role. sqlite transactions durable before network; лог не содержит credentials или содержимое соседних сущностей. setup не перезаписывает config и не меняет gateway автоматически.
- [ ] **green:** mock http boundary + реальный sqlite/tempdir; crash до/после commit POST, плохие json/oversized responses, revoked credential, wrong endpoint, same request across restart. AST grammar `feature_version=(3,10)` плюс фактический unittest; windows ntfs acl отдельно проверит владелец, posix 0600 не выдаётся за её замену.
- [ ] **коммит:** `добавить отдельный writer и журнал восстановления запросов`.

### задача 10: обязательное подтверждение внутри full-duplex mcp

**файлы:** создать `dashboard_write_protocol.py`, `test_dashboard_write_protocol.py`; дополнить writer entrypoint. reader protocol не расширять writes.

**интерфейсы:** `serve_writer(client,outbox,incoming,outgoing,clock)->None`; 2025-06-18 protocol с client form-elicitation capability; 9 write tools и get_edit_options. write tools `readOnlyHint=false`, get_edit_options true; все schemas closed. commit/prepare/status не model-facing tools.

- [ ] **red:** subprocess/in-memory transcripts `no_commit_before_matching_accept`, `accept_empty_content_is_valid`, `wrong_or_late_id_does_not_approve`, `decline_cancel_disconnect_do_not_write`, `missing_capability_fails_closed`, `new_mutation_is_busy`, `ping_and_cancel_remain_responsive`. никакой bool `confirmed`/`approved` в arguments не запускает commit.
- [ ] **проверить red:** `python3 -m unittest discover -s integrations/hermes -p 'test_dashboard_write_protocol.py'`.
- [ ] **реализация:** один stdin reader thread и queue максимум 64 frames, не `select()` на windows pipe; отдельный random reverse id; notifications/cancellation связаны с ожидающим tool call. входной frame до 65536 bytes, строка сверх лимита дренируется ограниченными блоками до newline без накопления; следующий frame остаётся читаемым. malformed/oversized frame не становится accept, это проверяется перед последующим ping и корректным ответом. серверный preview передаётся как plain message в form elicitation, requestedSchema — пустой object без подтверждающего bool; только action accept с matched id вызывает internal commit. deadline использует monotonic clock, не системные часы; максимальные 300 секунд не продлеваются ping/retry. stdout только protocol json, stderr redacted.
- [ ] **green:** следующий новый tool call снова запрашивает elicitation; нет remembered approval даже если прошлый клиент вернул accept. идемпотентный повтор с уже выданным receipt возвращает только прежний результат без второго commit. после restart recovery только status: `prepared` после отправленного commit остаётся неопределённым до terminal outcome/истечения, не объявляется «ничего не сохранено» и не пересоздаётся. после conflict/draft_expired новое действие возможно только по новому запросу пользователя с новым draft/кнопкой; `request_retired` не запускает автоматический prepare. interrupted/wrong-session late replies игнорируются. тесты запускаются stdlib subprocess без настоящего token/telegram.
- [ ] **коммит:** `потребовать отдельное подтверждение каждого изменения в hermes`.

### задача 11: совместимость, переносимый комплект и итоговая проверка

**файлы:** создать schema parity/package scripts и их tests `test_dashboard_write_artifact.py`; расширить synthetic browser fixture/server и `test/dashboard-write-fixture.test.cjs` из задачи 5 сценариями writer; закончить `docs/hermes-dashboard-write.md`, progress report, ops enable/disable scripts и workflow. обновить `docs/hermes-dashboard.md` только ссылкой на отдельный writer, не обещанием общего write scope.

**интерфейсы:** `package-dashboard-write.py --output <new zip>` кладёт только writer modules и readme, не credentials/outbox/env; `check-dashboard-write-contracts.py` сравнивает exported TS command schema с python catalog, включая required/enums/lengths и readOnly annotations. fixture server — только loopback, только synthetic users/data, без live sdk/network; никаких test bypass flags в production assets.

- [ ] **red:** parity на все 10 tools, zip allowlist без symlinks/credentials, fixture никогда не вызывает настоящий supabase, импорт не восстанавливает metadata; разный owner не получает pending данные прежнего. package script отказывается заменять существующий output.
- [ ] **проверить red:** `python3 -m unittest discover -s integrations/hermes -p 'test_dashboard_write_artifact.py'` и `node --test test/dashboard-write-fixture.test.cjs`.
- [ ] **реализация:** mcp contract dump только схемы без env; bundle проверенного exact head для переноса пользователем. fixture server подменяет sdk в генерируемом тестовом html response до старта sync; продуктовые файлы не получают подмену. ops enable проверяет expected owner, guard=true, подготовленный ключ, активный единственный cleanup job и отсутствие неразрешённых migration gaps; disable сначала выключает write, guard сохраняет. эти scripts не выполняются в ходе разработки.
- [ ] **green:** выполнить матрицу ниже; через штатный computer-use инструмент проверить synthetic desktop/mobile: inline edits, открытая stale modal, два клиента, offline/reload, cancel и полные обе версии. сохранить screenshots. реальные telegram desktop/mobile проверки остаются отдельным gate с пользователем; отсутствие реального gateway не скрывать fake acceptance. аудит всей ветки, важные findings через issue→regression-first, подробный pr 3 и attach; не merge.
- [ ] **коммит:** `подготовить проверяемый комплект writer и порядок безопасного включения`.

## матрица проверок и передача release candidate

исполнитель запускает команды из корня checkout, кроме явно указанных каталогов:

```text
node --test test/*.test.cjs
python3 -m unittest discover -s integrations/hermes -p 'test_*.py'
python3 scripts/test-dashboard-db.py --suite versions
python3 scripts/test-dashboard-db.py --suite writer
python3 scripts/check-dashboard-write-contracts.py
```

в **каждом** из `supabase/functions/dashboard-read`, `supabase/functions/dashboard-write`, `supabase/functions/school-notion`: отдельно `deno task test`, `deno task check`, `deno task lint`; writer/shared ещё `deno fmt --check`. старый общий `deno test` из корня не использовать вместо отдельных import maps.

ci pg17: `python3 scripts/test-dashboard-db.py --ci --suite all --require-pgtap` с только synthetic test connection; применить migrations с нуля, выполнить существующие `user_data_rls.sql` и `school_mutation_locks.sql` и новые concurrent db tests. auth stubs не считаются проверкой реального jwt gateway: это отдельный predeploy/live-negative gate. отсутствие запущенных ci steps/pg17/pgTAP — incomplete, не green.

static production-equivalent check: все relative imports включены в edge bundle, config `verify_jwt=true`, json/env читаются только на нужной стороне; все 13 html с согласованными asset versions и прежней навигацией. secret scan всего diff/zip/report, `git diff --check`; не печатать совпадения, содержащие реальные credentials. frontend не содержит service-role/write token; windows writer config не содержит service-role, его raw write token хранится только вне git и поставочного zip.

после каждого pr: независимое review, проверки из его задач, отдельный русский подробный pr text: причина, что изменено, влияние на данные/старые вкладки, результаты/пропуски тестов, issue, выключенные flags, rollback. не закрывать issue, пока нужная защита только в плане/непоставленном коде. текущая запись в плане не является результатом выполненной проверки.

## отдельные эксплуатационные gates — пока не разрешены

- [ ] перед каждым production действием заново прочитать state/history/sql; pending hardening не объявлять применённым. если фактический diff изменился — остановиться и согласовать корректировку, не `migration repair`.
- [ ] после отдельного разрешения применить согласованные migrations с guard/write=false, затем опубликованный frontend и обновлённый reader; проверить реальные asset hashes/вход и отсутствие конфликтующего pending state.
- [ ] отдельно разрешить `pg_cron` и один cleanup job; до включения writer проверить успешный запуск и отсутствие лишних jobs. новые расширения не устанавливать автоматически из обычного application migration.
- [ ] отдельно разрешить deployment `dashboard-write`, пока disabled; проверить jwt/missing/wrong-token/origin/method negative cases без реальных reads/writes.
- [ ] передать проверенный zip, пользователь на windows запускает мастер в новом каталоге, объединяет yaml с existing config и проверяет telegram allowlist/ntfs acl. secrets json и raw token не пересылает; hash/expiry добавляет в supabase отдельно.
- [ ] перед включением снова проверить guard=true, совместимый frontend, отдельный token/expiry и cleanup; только после явного разрешения включить write для одного owner.
- [ ] отдельно разрешённая live acceptance: только помеченные временные задача и цель, каждый раз с видимым preview и user click; desktop/mobile, отказ/timeout/restart/повтор. никаких проверок на реальных текущих целях. административную очистку согласовать отдельно и подтвердить сохранение исходных real ids/counts.
- [ ] откат: выключить write, отозвать write token, закрыть drafts; читатель и cas guard остаются. возврат legacy frontend/снятие guard — новая контролируемая операция с backup, не автоматический rollback.

## self-review плана

перед фиксацией плана проверить и отразить результат:

- [x] §1–6 спецификации покрыты задачами 2, 4, 6, 8–9; все 9 writes и отдельный read options имеют closed arguments и отдельные тесты.
- [x] §7–8 покрыты задачами 7–10; exact preview, per-call approval, owner/generation/ttl, timeout и honest trust boundary не заменены bool arguments.
- [x] §9 покрыт задачами 1–5; проверяются stale/dirty/ack/account/first-insert/tombstone/move/backup/reset и физическая защита старых клиентов.
- [x] §10–11 покрыты задачами 7–10; grants/rls, долговечный минимальный ledger, очистка, rolling quotas, recovery и безопасные ошибки.
- [x] §12–14 покрыты тремя pr, задачей 11 и отдельными gates; windows/production не выданы за локальные тесты; решения не расширяют утверждённый scope.
- [x] типы/имена rpc, модели tool arguments и связи consumed/produced совпадают; все пять пунктов review focus имеют owning tests; каждый шаг даёт проверяемый результат без полноценных тел реализации в плане. устранена обратная зависимость: fixture и ui acceptance входят в pr 1, а не откладываются до pr 3.

режим исполнения ещё не выбран для этого этапа. рекомендация — последовательно в текущем чате через `executing-plans`, с review каждого pr и общей независимой проверкой перед выпуском: интерфейсы тесно связаны, а отдельные агенты на каждый маленький шаг добавят повторную загрузку контекста. это предложение для пользователя, не разрешение автоматически запускать реализацию.
