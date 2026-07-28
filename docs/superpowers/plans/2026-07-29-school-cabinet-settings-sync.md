# синхронизация настроек предметных кабинетов — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** добавить в «Личную школу» боковую панель для настройки шести предметных ChatGPT-кабинетов с аккаунтной синхронизацией через существующую таблицу Supabase `public.user_data`.

**Architecture:** чистый `school-cabinet-settings.js` валидирует и накладывает пользовательские URL на неизменяемый статический config. Отдельный `school-cabinet-settings-store.js` читает и сохраняет одну user-scoped строку Supabase, ведёт cache с `user_id` и публикует нормализованные события; `school.js` отвечает только за runtime integration и UI drawer. Общий localStorage-sync явно игнорирует remote key и cache prefix, чтобы данные одного аккаунта не переносились в другой.

**Tech Stack:** browser JavaScript в существующем UMD/IIFE стиле, Supabase JS client из `supabase-sync.js`, Postgres RLS, pgTAP, Node.js `node:test`, статические HTML/CSS assets.

## глобальные ограничения

- base ветки — `agent/school-learning-routes-readonly` из PR #53.
- feature-ветка — `agent/school-cabinet-settings`.
- не менять Notion schema, Edge Function `school-notion`, 18 реальных уроков или их содержимое.
- редактировать только шесть кабинетов: `chatgpt-software`, `chatgpt-devops`, `chatgpt-mathematics`, `chatgpt-english`, `chatgpt-university`, `chatgpt-director`.
- не добавлять настройки Codex, Cursor, Kimi, YouTube, книг, PDF или документации.
- remote source of truth — одна строка `public.user_data` с key `school_cabinet_urls_v1`.
- `public.user_data.value` имеет тип `text`; сохранять только `JSON.stringify(...)`, не raw object.
- production-таблица `user_data` уже существует, но её создания нет в локальной
  migration history; hardening migration сначала выполняет подтверждённый
  `create table if not exists` для воспроизводимого local reset и не создаёт
  вторую production-таблицу.
- локальный cache — `school_cabinet_urls_cache_v1:<auth user id>`; cache не является source of truth.
- remote key и cache prefix не участвуют в общем localStorage-sync.
- URL: только абсолютный HTTPS, exact hostname `chatgpt.com` или `chat.openai.com`, без username/password, максимум 2048 Unicode code points.
- query и fragment пользователя разрешены, но приложение не добавляет в URL prompt или сведения урока.
- сохранение возможно только при действующей Supabase-сессии.
- static `SchoolLearningConfig` не мутируется и остаётся fallback.
- неизвестная версия, неизвестный cabinet id и повреждённый JSON не применяются.
- save failure сохраняет draft только в форме и не выдаётся за cloud success.
- входящий remote update не перезаписывает dirty draft без выбора пользователя.
- никаких новых runtime dependencies.
- все новые browser values рендерить через `textContent`, `value` или text nodes, не через `innerHTML`.
- commit subjects, GitHub issue и PR body — на русском языке, в нижнем регистре, без co-authorship.
- PR остаётся Draft до отдельного разрешения; merge запрещён.

## подтверждённый security preflight

read-only проверка production-проекта `yiuiiixovxmoqifsdsuf` перед составлением плана показала:

- `public.user_data` существует;
- primary key — `(user_id, key)`;
- `user_id uuid not null` с foreign key на `auth.users(id)`;
- `value text`;
- RLS включён;
- текущая policy: `ALL`, roles `{public}`, `using (auth.uid() = user_id)`, explicit `with_check` отсутствует;
- `anon` и `authenticated` имеют широкие table grants;
- Security Advisor не сообщил отдельный finding по `user_data`, но текущая конфигурация расходится с утверждённой least-privilege моделью;
- несвязанные Advisor warnings: публичный `security definer` `public.rls_auto_enable()` и отключённая leaked-password protection.

это не является доказательством текущего cross-user чтения: `user_id` не nullable, а ownership predicate включён. Однако feature начинает активно хранить новую пользовательскую настройку в этой таблице, поэтому роли и операции должны быть ограничены явно.

## карта файлов

### создать

- `school-cabinet-settings.js` — allowlist, URL policy, codec, cache key и immutable config overlay.
- `school-cabinet-settings-store.js` — auth wait, Supabase repository, realtime, cache и lifecycle.
- `test/school-cabinet-settings.test.cjs` — pure module tests.
- `test/school-cabinet-settings-store.test.cjs` — repository/cache/realtime tests.
- `supabase/tests/user_data_rls.sql` — pgTAP contract для grants и policies.
- generated migration с suffix `_harden_user_data_rls.sql` — создаётся только через pinned Supabase CLI command.

### изменить

- `supabase-sync.js:58-78` — исключить remote key и cache prefix из общего sync.
- `test/supabase-sync.test.cjs` — regression на отсутствие cross-account queueing.
- `school.html:13-23, 25-37, 112-114` — script order, settings button и drawer markup.
- `school.js:1118-1172, 1705-1725, 3615-3655` — effective config, store lifecycle и settings UI.
- `school.css:70-130, 892-970, 1490-1540` — header action, drawer form и mobile layout.
- `test/school-ui.test.cjs` — asset, controller и drawer behavior.
- `README.md:3-38` — заменить static-only инструкцию на account override → static fallback.

---

### task 0: issue-first hardening для `public.user_data`

**Files:**

- Create: GitHub issue, без изменения кода.
- Create: output файла команды `npx --yes supabase@2.110.0 migration new harden_user_data_rls`.
- Create: `supabase/tests/user_data_rls.sql`

**Interfaces:**

- Consumes: существующая таблица `public.user_data(user_id uuid, key text, value text, updated_at timestamptz)`.
- Produces: воспроизводимый local schema baseline, явные CRUD grants только для `authenticated` и четыре ownership policies с `(select auth.uid()) = user_id`.

- [ ] **step 1: повторить read-only preflight и сохранить evidence**

Через Supabase MCP выполнить:

```sql
select c.relrowsecurity, c.relforcerowsecurity
from pg_class as c
join pg_namespace as n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relname = 'user_data';

select policyname, roles, cmd, qual, with_check
from pg_policies
where schemaname = 'public' and tablename = 'user_data'
order by policyname;

select grantee, privilege_type
from information_schema.role_table_grants
where table_schema = 'public'
  and table_name = 'user_data'
  and grantee in ('anon', 'authenticated')
order by grantee, privilege_type;
```

Expected: подтвердить фактическое состояние из раздела preflight; если оно изменилось, обновить issue и SQL plan до любых writes.

- [ ] **step 2: оформить GitHub issue до исправления**

Issue title:

```text
сузить прямой доступ к user_data до аккаунтных crud-операций
```

Issue body должен содержать:

```markdown
## проблема

таблица public.user_data защищена ownership-предикатом, но текущая policy
применяется к роли public для всех операций, а anon имеет широкие table grants.

## причина

доступ создавался общим правилом all без явного разделения select, insert,
update и delete и без отдельного with check для update.

## риск

текущий auth.uid() = user_id ограничивает строки, однако конфигурация шире
фактически нужного доступа и повышает риск регрессии при будущих изменениях
схемы или auth-модели.

## критерии исправления

- anon не имеет прямых privileges на public.user_data;
- authenticated имеет только select, insert, update, delete;
- каждая операция имеет отдельную ownership policy;
- update содержит using и with check;
- rls остаётся включённым;
- pgTAP и security advisor проходят.

## предполагаемые области

- supabase migration harden_user_data_rls;
- supabase/tests/user_data_rls.sql.
```

Не создавать issue повторно, если поиск GitHub уже находит эквивалентное открытое issue.

- [ ] **step 3: проверить pinned CLI и сгенерировать migration path**

Run:

```bash
npx --yes supabase@2.110.0 --version
npx --yes supabase@2.110.0 migration new --help
npx --yes supabase@2.110.0 migration new harden_user_data_rls
```

Expected: CLI сообщает `2.110.0` и создаёт один новый migration file с suffix `_harden_user_data_rls.sql`. Не переименовывать файл вручную. Версия `2.101.0` не используется: она не распознаёт уже существующий блок `[local_smtp]` в `supabase/config.toml`.

- [ ] **step 4: сначала написать failing pgTAP contract**

В `supabase/tests/user_data_rls.sql` записать:

```sql
begin;

create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public;

select plan(17);

select has_table(
  'public',
  'user_data',
  'user_data table exists'
);
select col_type_is(
  'public',
  'user_data',
  'user_id',
  'uuid',
  'user id uses uuid'
);
select col_type_is(
  'public',
  'user_data',
  'key',
  'text',
  'key uses text'
);
select col_type_is(
  'public',
  'user_data',
  'value',
  'text',
  'value uses text'
);
select col_type_is(
  'public',
  'user_data',
  'updated_at',
  'timestamp with time zone',
  'updated at is timezone-aware'
);

select ok(
  (select relrowsecurity from pg_class where oid = 'public.user_data'::regclass),
  'user_data has rls enabled'
);

select ok(
  not has_table_privilege('anon', 'public.user_data', 'select,insert,update,delete'),
  'anon has no direct crud privileges'
);

select ok(
  has_table_privilege('authenticated', 'public.user_data', 'select'),
  'authenticated can select'
);
select ok(
  has_table_privilege('authenticated', 'public.user_data', 'insert'),
  'authenticated can insert'
);
select ok(
  has_table_privilege('authenticated', 'public.user_data', 'update'),
  'authenticated can update'
);
select ok(
  has_table_privilege('authenticated', 'public.user_data', 'delete'),
  'authenticated can delete'
);

select is(
  (select count(*)::integer from pg_policies
   where schemaname = 'public' and tablename = 'user_data'),
  4,
  'user_data has four explicit policies'
);

select is(
  (select roles::text from pg_policies
   where schemaname = 'public' and tablename = 'user_data' and cmd = 'SELECT'),
  '{authenticated}',
  'select policy targets authenticated'
);
select ok(
  (select qual is not null from pg_policies
   where schemaname = 'public' and tablename = 'user_data' and cmd = 'SELECT'),
  'select policy has ownership predicate'
);
select ok(
  (select with_check is not null from pg_policies
   where schemaname = 'public' and tablename = 'user_data' and cmd = 'INSERT'),
  'insert policy has with check'
);
select ok(
  (select qual is not null and with_check is not null from pg_policies
   where schemaname = 'public' and tablename = 'user_data' and cmd = 'UPDATE'),
  'update policy has using and with check'
);
select ok(
  (select qual is not null from pg_policies
   where schemaname = 'public' and tablename = 'user_data' and cmd = 'DELETE'),
  'delete policy has ownership predicate'
);

select * from finish();
rollback;
```

- [ ] **step 5: запустить pgTAP и подтвердить RED**

Run:

```bash
npx --yes supabase@2.110.0 test db supabase/tests/user_data_rls.sql
```

Expected: FAIL из-за отсутствующей local table либо на anon grants, количестве policies или explicit `WITH CHECK`. Если local Supabase ещё не запущен, сначала выполнить `npx --yes supabase@2.110.0 start`, затем повторить тест.

- [ ] **step 6: записать минимальную migration**

В сгенерированный `_harden_user_data_rls.sql` записать:

```sql
create table if not exists public.user_data (
  user_id uuid not null references auth.users(id),
  key text not null,
  value text,
  updated_at timestamptz default now(),
  primary key (user_id, key)
);

alter table public.user_data enable row level security;

drop policy if exists "Users can manage their own data" on public.user_data;

revoke all privileges on table public.user_data from anon;
revoke all privileges on table public.user_data from authenticated;
grant select, insert, update, delete on table public.user_data to authenticated;

create policy user_data_select_own
on public.user_data
for select
to authenticated
using ((select auth.uid()) = user_id);

create policy user_data_insert_own
on public.user_data
for insert
to authenticated
with check ((select auth.uid()) = user_id);

create policy user_data_update_own
on public.user_data
for update
to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

create policy user_data_delete_own
on public.user_data
for delete
to authenticated
using ((select auth.uid()) = user_id);
```

Не менять columns, primary key, foreign key или существующие строки.

- [ ] **step 7: применить локально и подтвердить GREEN**

Run:

```bash
npx --yes supabase@2.110.0 db reset
npx --yes supabase@2.110.0 test db supabase/tests/user_data_rls.sql
```

Expected: migration применяется; 17 pgTAP assertions PASS. На production
`create table if not exists` является no-op только после повторного schema
preflight; расхождение columns/constraints блокирует remote apply.

- [ ] **step 8: повторить advisors и проверить связанные findings**

Через Supabase MCP вызвать Security Advisor после применения migration в согласованной среде.

Expected:

- нет finding для `user_data`;
- существующие warnings про `rls_auto_enable()` и leaked-password protection перечислены отдельно как несвязанные;
- production migration не применять без отдельного подтверждения пользователя.

- [ ] **step 9: commit security block**

```bash
git add supabase/migrations/*_harden_user_data_rls.sql supabase/tests/user_data_rls.sql
git commit -m "сузить доступ к аккаунтным данным"
```

Commit body или PR body должен ссылаться на созданное issue. Не закрывать issue до production verification.

---

### task 1: чистая модель настроек, URL policy и config overlay

**Files:**

- Create: `school-cabinet-settings.js`
- Create: `test/school-cabinet-settings.test.cjs`

**Interfaces:**

- Consumes: raw stored string/object, draft `{ [cabinetId]: string }`, frozen `SchoolLearningConfig`.
- Produces:
  - `SchoolCabinetSettings.REMOTE_KEY`;
  - `SchoolCabinetSettings.CACHE_PREFIX`;
  - `SchoolCabinetSettings.CABINET_IDS`;
  - `SchoolCabinetSettings.parseStoredValue(raw)` → `{ settings, warning }`;
  - `SchoolCabinetSettings.validateDraft(draft)`;
  - `SchoolCabinetSettings.serialize(settings)`;
  - `SchoolCabinetSettings.cacheKeyForUser(userId)`;
  - `SchoolCabinetSettings.applyToConfig(baseConfig, settings)`.

- [ ] **step 1: написать failing tests allowlist и codec**

Создать `test/school-cabinet-settings.test.cjs`:

```javascript
const assert = require('node:assert/strict');
const test = require('node:test');
const SchoolCabinetSettings = require('../school-cabinet-settings.js');

test('normalizes exactly six subject cabinet urls', () => {
  const result = SchoolCabinetSettings.validateDraft({
    'chatgpt-software': 'https://chatgpt.com/g/software',
    'chatgpt-director': 'https://chat.openai.com/g/director',
    'codex-main': 'https://chatgpt.com/g/ignored'
  });

  assert.equal(result.valid, true);
  assert.deepEqual(result.settings, {
    version: 1,
    cabinets: {
      'chatgpt-software': 'https://chatgpt.com/g/software',
      'chatgpt-director': 'https://chat.openai.com/g/director'
    }
  });
});

test('rejects unsafe urls without truncating them', () => {
  const cases = [
    'http://chatgpt.com/g/x',
    'https://user:pass@chatgpt.com/g/x',
    'https://chatgpt.com.attacker.example/g/x',
    'javascript:alert(1)',
    `https://chatgpt.com/${'a'.repeat(2049)}`
  ];

  cases.forEach((url) => {
    const result = SchoolCabinetSettings.validateDraft({
      'chatgpt-software': url
    });
    assert.equal(result.valid, false, url.slice(0, 80));
    assert.equal(result.settings.cabinets['chatgpt-software'], undefined);
  });
});

test('damaged json and unknown versions fail closed with a warning', () => {
  const damaged = SchoolCabinetSettings.parseStoredValue('{bad json');
  const future = SchoolCabinetSettings.parseStoredValue(JSON.stringify({
    version: 2,
    cabinets: { 'chatgpt-software': 'https://chatgpt.com/g/future' }
  }));

  assert.deepEqual(damaged.settings, { version: 1, cabinets: {} });
  assert.equal(damaged.warning.code, 'DAMAGED_SETTINGS');
  assert.deepEqual(future.settings, { version: 1, cabinets: {} });
  assert.equal(future.warning.code, 'UNSUPPORTED_VERSION');
});
```

- [ ] **step 2: запустить test и подтвердить RED**

Run:

```bash
node --test test/school-cabinet-settings.test.cjs
```

Expected: FAIL с `MODULE_NOT_FOUND`.

- [ ] **step 3: реализовать constants, code-point limit и codec**

Создать UMD/CommonJS module с ядром:

```javascript
var REMOTE_KEY = 'school_cabinet_urls_v1';
var CACHE_PREFIX = 'school_cabinet_urls_cache_v1:';
var CABINET_IDS = Object.freeze([
  'chatgpt-software',
  'chatgpt-devops',
  'chatgpt-mathematics',
  'chatgpt-english',
  'chatgpt-university',
  'chatgpt-director'
]);

function normalizeUrl(value) {
  var raw = typeof value === 'string' ? value.trim() : '';
  if (!raw) return { valid: true, value: null };
  if (Array.from(raw).length > 2048) {
    return { valid: false, value: null, code: 'URL_TOO_LONG' };
  }
  try {
    var parsed = new URL(raw);
    if (
      parsed.protocol !== 'https:' ||
      parsed.username ||
      parsed.password ||
      ['chatgpt.com', 'chat.openai.com'].indexOf(parsed.hostname.toLowerCase()) === -1
    ) {
      return { valid: false, value: null, code: 'INVALID_URL' };
    }
    return { valid: true, value: parsed.href };
  } catch (_error) {
    return { valid: false, value: null, code: 'INVALID_URL' };
  }
}
```

`parseStoredValue` принимает `text` из Supabase, проверяет `version === 1`,
фильтрует allowlist и возвращает `{ settings, warning }`. При повреждении или
неизвестной версии `settings` содержит пустой versioned object, а `warning`
получает безопасный код без raw value.

- [ ] **step 4: добавить failing tests immutable overlay**

```javascript
test('applies valid overrides without mutating frozen config', () => {
  const base = Object.freeze({
    cabinets: Object.freeze({
      'chatgpt-software': Object.freeze({
        label: 'software',
        platform: 'ChatGPT',
        kind: 'permanent',
        url: ''
      }),
      'codex-main': Object.freeze({
        label: 'codex',
        platform: 'Codex',
        kind: 'permanent',
        url: ''
      })
    }),
    marker: 'base'
  });

  const next = SchoolCabinetSettings.applyToConfig(base, {
    version: 1,
    cabinets: {
      'chatgpt-software': 'https://chatgpt.com/g/software',
      'codex-main': 'https://chatgpt.com/g/ignored'
    }
  });

  assert.notEqual(next, base);
  assert.equal(base.cabinets['chatgpt-software'].url, '');
  assert.equal(next.cabinets['chatgpt-software'].url, 'https://chatgpt.com/g/software');
  assert.equal(next.cabinets['codex-main'].url, '');
  assert.equal(next.marker, 'base');
});
```

- [ ] **step 5: реализовать overlay и cache key**

`applyToConfig` должен:

```javascript
function applyToConfig(baseConfig, settings) {
  var cabinets = Object.assign({}, baseConfig.cabinets || {});
  var normalized = normalizeSettings(settings);

  CABINET_IDS.forEach(function (cabinetId) {
    var baseCabinet = cabinets[cabinetId];
    var overrideUrl = normalized.cabinets[cabinetId];
    if (!baseCabinet || !overrideUrl) return;
    cabinets[cabinetId] = Object.freeze(
      Object.assign({}, baseCabinet, { url: overrideUrl })
    );
  });

  return Object.freeze(Object.assign({}, baseConfig, {
    cabinets: Object.freeze(cabinets)
  }));
}
```

`cacheKeyForUser(userId)` отклоняет пустой id и возвращает `CACHE_PREFIX + userId`.

- [ ] **step 6: focused GREEN и commit**

Run:

```bash
node --check school-cabinet-settings.js
node --test test/school-cabinet-settings.test.cjs
```

Expected: syntax exit 0; all new pure tests PASS.

Commit:

```bash
git add school-cabinet-settings.js test/school-cabinet-settings.test.cjs
git commit -m "добавить модель предметных кабинетов"
```

---

### task 2: исключить настройки кабинетов из общего localStorage-sync

**Files:**

- Modify: `supabase-sync.js:58-78`
- Modify: `test/supabase-sync.test.cjs`

**Interfaces:**

- Consumes: `REMOTE_KEY` literal и `CACHE_PREFIX`.
- Produces: `shouldSkipStorageKey(key) === true` для remote key и любого user-scoped cache key.

- [ ] **step 1: написать failing regression test**

Добавить:

```javascript
test('generic sync never uploads cabinet settings or account caches', async () => {
  const app = await loadSupabaseSync({
    initialStorage: {
      school_cabinet_urls_v1: JSON.stringify({ version: 1, cabinets: {} }),
      'school_cabinet_urls_cache_v1:u1': JSON.stringify({
        version: 1,
        cabinets: { 'chatgpt-software': 'https://chatgpt.com/g/u1' }
      }),
      store_v2: JSON.stringify({ rewards: [] })
    }
  });

  await app.runTimers();

  const keys = app.writes.upserts.flat().map((row) => row.key);
  assert.equal(keys.includes('school_cabinet_urls_v1'), false);
  assert.equal(keys.some((key) => key.startsWith('school_cabinet_urls_cache_v1:')), false);
  assert.equal(keys.includes('store_v2'), true);
});
```

- [ ] **step 2: запустить test и подтвердить RED**

Run:

```bash
node --test --test-name-pattern="generic sync never uploads" test/supabase-sync.test.cjs
```

Expected: FAIL, remote key или cache попадает в `writes.upserts`.

- [ ] **step 3: добавить минимальное skip-правило**

В `supabase-sync.js`:

```javascript
var SCHOOL_CABINET_REMOTE_KEY = 'school_cabinet_urls_v1';
var SCHOOL_CABINET_CACHE_PREFIX = 'school_cabinet_urls_cache_v1:';

function shouldSkipStorageKey(key) {
  if (!key) return true;
  if (SKIP_KEYS.indexOf(key) !== -1) return true;
  if (key === SCHOOL_CABINET_REMOTE_KEY) return true;
  if (key.indexOf(SCHOOL_CABINET_CACHE_PREFIX) === 0) return true;
  // existing rules remain unchanged
}
```

Не менять поведение остальных dashboard keys.

- [ ] **step 4: GREEN, full sync regression и commit**

Run:

```bash
node --check supabase-sync.js
node --test test/supabase-sync.test.cjs
node --test test/firebase-sync.test.cjs test/supabase-sync.test.cjs
```

Expected: all sync tests PASS.

Commit:

```bash
git add supabase-sync.js test/supabase-sync.test.cjs
git commit -m "изолировать настройки школы от общего sync"
```

---

### task 3: user-scoped Supabase repository, cache и realtime

**Files:**

- Create: `school-cabinet-settings-store.js`
- Create: `test/school-cabinet-settings-store.test.cjs`

**Interfaces:**

- Consumes:
  - `SchoolCabinetSettings`;
  - dynamic `SupabaseSync` object с `client`, `getUser()` и `isSignedIn()`;
  - `localStorage`;
  - EventTarget.
- Produces:
  - `SchoolCabinetSettingsStore.create(options)`;
  - store methods `load()`, `save(draft)`, `refresh()`, `getState()`, `subscribe(listener)`, `destroy()`;
  - event `school-cabinet-settings-applied`.

State contract:

```javascript
{
  status: 'idle' | 'loading' | 'ready' | 'saving' | 'error',
  userId: string | null,
  settings: { version: 1, cabinets: Record<string, string> },
  updatedAt: string | null,
  source: 'empty' | 'cache' | 'remote' | 'save' | 'realtime',
  warning: null | { code: string, message: string },
  error: null | { code: string, message: string }
}
```

- [ ] **step 1: написать failing repository tests**

Создать mock Supabase builder и tests:

```javascript
test('load scopes remote row and cache to current auth user', async () => {
  const app = makeStore({
    user: { id: 'u1' },
    remoteRow: {
      value: JSON.stringify({
        version: 1,
        cabinets: { 'chatgpt-software': 'https://chatgpt.com/g/u1' }
      }),
      updated_at: '2026-07-29T00:00:00.000Z'
    },
    storage: {
      'school_cabinet_urls_cache_v1:u2': JSON.stringify({
        version: 1,
        cabinets: { 'chatgpt-software': 'https://chatgpt.com/g/u2' }
      })
    }
  });

  const state = await app.store.load();

  assert.equal(state.userId, 'u1');
  assert.equal(state.settings.cabinets['chatgpt-software'], 'https://chatgpt.com/g/u1');
  assert.deepEqual(app.selectFilters, [
    ['user_id', 'u1'],
    ['key', 'school_cabinet_urls_v1']
  ]);
  assert.equal(app.storageReads.includes('school_cabinet_urls_cache_v1:u2'), false);
});

test('save writes serialized text and never accepts a foreign user id', async () => {
  const app = makeStore({ user: { id: 'u1' } });

  await app.store.save({
    'chatgpt-mathematics': 'https://chatgpt.com/g/math'
  });

  assert.equal(app.upserts.length, 1);
  assert.equal(app.upserts[0].user_id, 'u1');
  assert.equal(app.upserts[0].key, 'school_cabinet_urls_v1');
  assert.equal(typeof app.upserts[0].value, 'string');
  assert.equal(JSON.parse(app.upserts[0].value).version, 1);
  assert.equal('user_id' in JSON.parse(app.upserts[0].value), false);
});
```

- [ ] **step 2: подтвердить RED**

Run:

```bash
node --test test/school-cabinet-settings-store.test.cjs
```

Expected: FAIL с `MODULE_NOT_FOUND`.

- [ ] **step 3: реализовать auth wait и load**

Store должен:

```javascript
async function authContext() {
  var startedAt = Date.now();
  while (Date.now() - startedAt <= 5000) {
    var sync = getSync();
    var client = sync && sync.client;
    if (client && client.auth && typeof client.auth.getSession === 'function') {
      var result = await client.auth.getSession();
      var session = result && result.data && result.data.session;
      if (result && result.error) {
        throw storeError('AUTH_UNAVAILABLE', 'не удалось проверить аккаунт');
      }
      if (session && session.user && session.user.id) {
        return { client: client, user: session.user };
      }
      if (session === null) {
        throw storeError('UNAUTHORIZED', 'для сохранения необходимо войти');
      }
    }
    await delay(10);
  }
  throw storeError('AUTH_UNAVAILABLE', 'не удалось определить аккаунт');
}
```

После получения user:

1. прочитать только `cacheKeyForUser(user.id)`;
2. применить валидный cache как `source: 'cache'`;
3. выполнить:

```javascript
client
  .from('user_data')
  .select('value, updated_at')
  .eq('user_id', user.id)
  .eq('key', settings.REMOTE_KEY)
  .maybeSingle();
```

4. перед применением response повторно сравнить текущий auth user id с request user id;
5. сохранить валидный remote result в cache и state.

- [ ] **step 4: добавить failing tests save failure и auth switch**

```javascript
test('failed cloud save keeps confirmed state and draft outside store', async () => {
  const app = makeStore({
    user: { id: 'u1' },
    remoteRow: {
      value: JSON.stringify({ version: 1, cabinets: {} }),
      updated_at: '2026-07-29T00:00:00.000Z'
    },
    upsertError: { message: 'network unavailable' }
  });
  await app.store.load();

  await assert.rejects(
    app.store.save({ 'chatgpt-software': 'https://chatgpt.com/g/new' }),
    (error) => error.code === 'SAVE_FAILED'
  );

  assert.deepEqual(app.store.getState().settings.cabinets, {});
  assert.equal(app.storageWrites.length, 0);
});

test('response from previous auth user is discarded', async () => {
  const pending = deferred();
  const app = makeStore({ user: { id: 'u1' }, selectPromise: pending.promise });
  const loadPromise = app.store.load();
  app.setUser({ id: 'u2' });
  pending.resolve({
    data: {
      value: JSON.stringify({
        version: 1,
        cabinets: { 'chatgpt-software': 'https://chatgpt.com/g/u1' }
      }),
      updated_at: '2026-07-29T00:00:00.000Z'
    },
    error: null
  });

  await assert.rejects(loadPromise, (error) => error.code === 'AUTH_CHANGED');
  assert.equal(app.store.getState().userId, null);
});
```

- [ ] **step 5: реализовать save и cache-after-success**

`save(draft)`:

```javascript
var validation = settings.validateDraft(draft);
if (!validation.valid) throw storeError('VALIDATION_ERROR', 'проверьте ссылки');

var row = {
  user_id: auth.user.id,
  key: settings.REMOTE_KEY,
  value: settings.serialize(validation.settings),
  updated_at: new Date().toISOString()
};

var result = await auth.client
  .from('user_data')
  .upsert(row, { onConflict: 'user_id,key' })
  .select('value, updated_at')
  .single();
```

Cache и state обновляются только после успешного response и повторной auth check.

- [ ] **step 6: добавить failing realtime tests**

Проверить:

```javascript
test('realtime applies only the current user settings key', async () => {
  const app = makeStore({ user: { id: 'u1' } });
  await app.store.load();
  app.events.length = 0;

  app.emitRealtime({
    eventType: 'UPDATE',
    new: {
      user_id: 'u1',
      key: 'school_cabinet_urls_v1',
      value: JSON.stringify({
        version: 1,
        cabinets: { 'chatgpt-english': 'https://chatgpt.com/g/english' }
      }),
      updated_at: '2026-07-29T01:00:00.000Z'
    }
  });

  assert.equal(
    app.store.getState().settings.cabinets['chatgpt-english'],
    'https://chatgpt.com/g/english'
  );

  app.emitRealtime({
    eventType: 'UPDATE',
    new: { user_id: 'u1', key: 'store_v2', value: '{}', updated_at: '2026-07-29T02:00:00Z' }
  });
  assert.equal(app.events.length, 1);
});
```

Также проверить DELETE remote row → пустые settings; `destroy()` вызывает `removeChannel`.

- [ ] **step 7: реализовать realtime lifecycle**

Channel:

```javascript
client
  .channel('school-cabinet-settings:' + user.id)
  .on('postgres_changes', {
    event: '*',
    schema: 'public',
    table: 'user_data',
    filter: 'user_id=eq.' + user.id
  }, handleRealtime)
  .subscribe();
```

Handler отдельно проверяет `payload.new/old.key === REMOTE_KEY` и current user id. При применении публикуется только нормализованный state:

```javascript
eventTarget.dispatchEvent(new CustomEvent(
  'school-cabinet-settings-applied',
  { detail: cloneState(state) }
));
```

Не логировать raw URL, session или Authorization.

Incoming state применяется только если его валидный `updated_at` новее
текущего state. Stale SELECT/realtime response игнорируется. DELETE принимается
для текущей строки и сбрасывает settings в пустой versioned object.

- [ ] **step 8: добавить stale-response regression**

```javascript
test('older realtime rows cannot overwrite newer confirmed settings', async () => {
  const app = makeStore({
    user: { id: 'u1' },
    remoteRow: {
      value: JSON.stringify({
        version: 1,
        cabinets: { 'chatgpt-software': 'https://chatgpt.com/g/new' }
      }),
      updated_at: '2026-07-29T02:00:00.000Z'
    }
  });
  await app.store.load();

  app.emitRealtime({
    eventType: 'UPDATE',
    new: {
      user_id: 'u1',
      key: 'school_cabinet_urls_v1',
      value: JSON.stringify({
        version: 1,
        cabinets: { 'chatgpt-software': 'https://chatgpt.com/g/old' }
      }),
      updated_at: '2026-07-29T01:00:00.000Z'
    }
  });

  assert.equal(
    app.store.getState().settings.cabinets['chatgpt-software'],
    'https://chatgpt.com/g/new'
  );
});
```

- [ ] **step 9: focused GREEN и commit**

Run:

```bash
node --check school-cabinet-settings-store.js
node --test test/school-cabinet-settings.test.cjs test/school-cabinet-settings-store.test.cjs
```

Expected: all settings model/store tests PASS.

Commit:

```bash
git add school-cabinet-settings-store.js test/school-cabinet-settings-store.test.cjs
git commit -m "добавить аккаунтное хранение кабинетов"
```

---

### task 4: runtime overlay в школьном controller

**Files:**

- Modify: `school.js:1118-1172, 1705-1725, 3615-3655`
- Modify: `test/school-ui.test.cjs`

**Interfaces:**

- Consumes: `cabinetSettingsCore.applyToConfig`, store state и static `learningConfig`.
- Produces:
  - controller method `applyCabinetSettings(state)`;
  - controller method `getCabinetSettingsState()`;
  - route resolution через effective config.

- [ ] **step 1: написать failing controller test**

```javascript
test('controller overlays synced cabinet settings without mutating static config', async () => {
  const staticConfig = {
    cabinets: {
      'chatgpt-software': {
        label: 'software',
        platform: 'ChatGPT',
        kind: 'permanent',
        url: ''
      }
    }
  };
  const resolvedConfigs = [];
  const controller = SchoolUi.createController({
    api: { listLessons: async () => [{
      id: 'lesson-1',
      subject: 'Software Engineering',
      status: 'Запланирован'
    }] },
    core: loadingCore(),
    document: null,
    learningConfig: staticConfig,
    cabinetSettingsCore: {
      applyToConfig(base, settings) {
        return {
          ...base,
          cabinets: {
            ...base.cabinets,
            'chatgpt-software': {
              ...base.cabinets['chatgpt-software'],
              url: settings.cabinets['chatgpt-software'] || ''
            }
          }
        };
      }
    },
    learningRoute: {
      resolveLessonRoute(_lesson, config) {
        resolvedConfigs.push(config);
        return { cabinetUrl: config.cabinets['chatgpt-software'].url };
      },
      compactRouteLabels: () => ({ desktop: 'ChatGPT', mobile: 'ChatGPT' })
    }
  });

  await controller.load();
  controller.applyCabinetSettings({
    status: 'ready',
    settings: {
      version: 1,
      cabinets: { 'chatgpt-software': 'https://chatgpt.com/g/software' }
    }
  });

  assert.equal(controller.getCurrentLessonRoute(), null);
  await controller.openLesson('lesson-1');
  assert.equal(controller.getCurrentLessonRoute().cabinetUrl, 'https://chatgpt.com/g/software');
  assert.equal(staticConfig.cabinets['chatgpt-software'].url, '');
  assert.ok(resolvedConfigs.length > 0);
});
```

- [ ] **step 2: подтвердить RED**

Run:

```bash
node --test --test-name-pattern="controller overlays synced" test/school-ui.test.cjs
```

Expected: FAIL, method `applyCabinetSettings` отсутствует.

- [ ] **step 3: реализовать effective config**

В `createController`:

```javascript
var cabinetSettingsCore = options.cabinetSettingsCore ||
  (root && root.SchoolCabinetSettings);
var baseLearningConfig = options.learningConfig ||
  (root && root.SchoolLearningConfig) || {};
var cabinetSettingsState = null;
var effectiveLearningConfig = baseLearningConfig;

function applyCabinetSettings(nextState) {
  cabinetSettingsState = nextState || null;
  effectiveLearningConfig = cabinetSettingsCore &&
    typeof cabinetSettingsCore.applyToConfig === 'function'
      ? cabinetSettingsCore.applyToConfig(
          baseLearningConfig,
          nextState && nextState.settings
        )
      : baseLearningConfig;
  if (readModel) render(readModel);
}
```

`routeForLesson` использует только `effectiveLearningConfig`.

Expose:

```javascript
applyCabinetSettings: applyCabinetSettings,
getCabinetSettingsState: function () {
  return cabinetSettingsState ? JSON.parse(JSON.stringify(cabinetSettingsState)) : null;
}
```

- [ ] **step 4: проверить текущий prompt/pre-open contract**

Добавить regression assertion: после overlay `getCurrentTeacherPrompt()` использует разрешённый route, но URL не появляется в prompt/query; существующий `copyPromptAndOpen` остаётся единственной launch path.

- [ ] **step 5: GREEN и commit**

Run:

```bash
node --check school.js
node --test test/school-learning-route.test.cjs test/school-teacher-bridge.test.cjs test/school-ui.test.cjs
```

Expected: all focused route/UI tests PASS.

Commit:

```bash
git add school.js test/school-ui.test.cjs
git commit -m "подключить настройки к маршрутам уроков"
```

---

### task 5: доступная разметка drawer и asset order

**Files:**

- Modify: `school.html:13-23, 25-37, 112-114`
- Modify: `test/school-ui.test.cjs`

**Interfaces:**

- Consumes: новые browser modules и IDs controller.
- Produces: settings open button, form, six fields, error nodes, remote conflict banner и save status.

- [ ] **step 1: расширить failing asset/markup contract**

В `assertSchoolAssetContract` ожидать scripts перед `school.js`:

```javascript
'school-teacher-config.js?v=3',
'school-learning-route.js?v=1',
'school-cabinet-settings.js?v=1',
'school-cabinet-settings-store.js?v=1',
'school-teacher-bridge.js?v=2'
```

Добавить assertions:

```javascript
assert.ok(html.includes('id="schoolSettingsOpen"'));
assert.ok(html.includes('aria-label="Настройки школы"'));
assert.ok(html.includes('id="schoolSettingsDialog"'));
assert.ok(html.includes('id="schoolSettingsForm"'));
assert.equal(
  Array.from(html.matchAll(/data-school-cabinet-id=/g)).length,
  12
);
```

Число 12 означает шесть inputs и шесть reset buttons.

- [ ] **step 2: подтвердить RED**

Run:

```bash
node --test --test-name-pattern="school page loads|asset contract" test/school-ui.test.cjs
```

Expected: FAIL на отсутствующих assets/IDs.

- [ ] **step 3: добавить script order и кнопку**

В header:

```html
<div class="school-head-actions">
  <button class="school-settings-open" id="schoolSettingsOpen" type="button"
    aria-label="Настройки школы" aria-haspopup="dialog"
    aria-controls="schoolSettingsDialog">⚙</button>
  <div class="school-progress" aria-live="polite">
    <!-- existing progress -->
  </div>
</div>
```

Подключить `school-cabinet-settings.js` и `school-cabinet-settings-store.js` после static config и до `school.js`.

- [ ] **step 4: добавить drawer form с шестью строками**

Разметка каждой строки:

```html
<div class="school-settings-row">
  <label for="schoolCabinetSoftware">Software Engineering</label>
  <input id="schoolCabinetSoftware" type="url" inputmode="url"
    autocomplete="url" maxlength="2048"
    data-school-cabinet-id="chatgpt-software"
    aria-describedby="schoolCabinetSoftwareState">
  <span id="schoolCabinetSoftwareState" class="school-settings-field-state"></span>
  <button type="button" data-school-cabinet-reset
    data-school-cabinet-id="chatgpt-software">Сбросить</button>
</div>
```

Повторить literal markup для остальных пяти IDs. Добавить:

- `schoolSettingsClose`;
- `schoolSettingsRemoteNotice`, hidden;
- `schoolSettingsUseRemote`;
- `schoolSettingsKeepDraft`;
- `schoolSettingsStatus`, `aria-live="polite"`;
- `schoolSettingsSave`;
- `schoolSettingsCancel`.

- [ ] **step 5: GREEN и commit**

Run:

```bash
node --test --test-name-pattern="school page loads|asset contract" test/school-ui.test.cjs
```

Expected: asset/markup contract PASS.

Commit:

```bash
git add school.html test/school-ui.test.cjs
git commit -m "добавить панель предметных кабинетов"
```

---

### task 6: drawer behavior, validation, dirty draft и remote conflict

**Files:**

- Modify: `school.js:1118-1210, 3200-3420, 3615-3655`
- Modify: `test/school-ui.test.cjs`

**Interfaces:**

- Consumes: settings store, settings core, drawer DOM.
- Produces: open/close/save/reset/conflict behavior и store-to-controller binding.

- [ ] **step 1: написать failing pure UI-state tests**

Экспортировать и протестировать:

```javascript
test('cabinet settings draft reports field errors without mutating confirmed settings', () => {
  const confirmed = {
    version: 1,
    cabinets: { 'chatgpt-software': 'https://chatgpt.com/g/old' }
  };
  const draft = SchoolUi.cabinetSettingsDraft(
    confirmed,
    { 'chatgpt-software': 'https://evil.example/g/new' },
    SchoolCabinetSettings
  );

  assert.equal(draft.dirty, true);
  assert.equal(draft.valid, false);
  assert.equal(draft.errors['chatgpt-software'], 'Проверьте ссылку');
  assert.equal(confirmed.cabinets['chatgpt-software'], 'https://chatgpt.com/g/old');
});

test('incoming remote settings preserve a dirty draft until explicit choice', () => {
  const result = SchoolUi.mergeCabinetSettingsState({
    dirty: true,
    draft: { 'chatgpt-software': 'https://chatgpt.com/g/local' }
  }, {
    settings: {
      version: 1,
      cabinets: { 'chatgpt-software': 'https://chatgpt.com/g/remote' }
    }
  });

  assert.equal(result.showRemoteNotice, true);
  assert.equal(result.draft['chatgpt-software'], 'https://chatgpt.com/g/local');
  assert.equal(
    result.pendingRemote.settings.cabinets['chatgpt-software'],
    'https://chatgpt.com/g/remote'
  );
});
```

- [ ] **step 2: подтвердить RED**

Run:

```bash
node --test --test-name-pattern="cabinet settings draft|incoming remote settings" test/school-ui.test.cjs
```

Expected: FAIL, helper functions отсутствуют.

- [ ] **step 3: реализовать pure UI-state helpers**

`cabinetSettingsDraft`:

- строит draft только по `CABINET_IDS`;
- вызывает `validateDraft`;
- возвращает `{ draft, errors, dirty, valid }`;
- использует `Array.from(value).length`, не только HTML `maxlength`.

Field state copy фиксирована:

- пусто → «не настроено»;
- валидный URL → «готово»;
- ошибка URL/длины → «проверьте ссылку».

Reset очищает только значение в draft. Supabase write выполняется один раз
после общей кнопки «Сохранить».

`mergeCabinetSettingsState`:

- применяет incoming state сразу только если draft clean;
- при dirty сохраняет draft и запоминает `pendingRemote`;
- не пишет в store.

- [ ] **step 4: написать failing DOM behavior tests**

Через расширенный fake DOM проверить:

- click `schoolSettingsOpen` заполняет поля confirmed values;
- reset очищает только одну строку и делает draft dirty;
- invalid input выключает Save и связывает error через `aria-describedby`;
- Save вызывает `store.save()` один раз с allowlisted draft;
- failed save оставляет drawer открытым и draft неизменным;
- successful save показывает «Сохранено в аккаунте»;
- `Escape` и close при dirty вызывают существующее подтверждение;
- remote notice actions либо применяют remote, либо сохраняют current draft;
- focus возвращается на `schoolSettingsOpen`.

Пример save assertion:

```javascript
assert.deepEqual(store.savedDrafts, [{
  'chatgpt-software': 'https://chatgpt.com/g/software',
  'chatgpt-devops': '',
  'chatgpt-mathematics': '',
  'chatgpt-english': '',
  'chatgpt-university': '',
  'chatgpt-director': ''
}]);
```

- [ ] **step 5: реализовать drawer lifecycle**

Добавить в controller:

```javascript
function openSettings() {
  settingsPreviousFocus = documentRef.activeElement;
  settingsUiState = draftFromConfirmed(cabinetSettingsState);
  renderSettingsForm();
  settingsDialog.hidden = false;
  settingsDialog.setAttribute('aria-hidden', 'false');
  setDialogInert(true);
  settingsDialog.querySelector('input').focus();
}
```

`closeSettings()`:

- при dirty запрашивает подтверждение через существующий action dialog;
- очищает pending remote только после выбора;
- снимает body lock, если другие dialogs закрыты;
- возвращает focus.

`saveSettings()`:

- блокирует повторный click;
- повторно валидирует все поля;
- вызывает store `save`;
- после success вызывает `controller.applyCabinetSettings`;
- на failure не закрывает drawer и показывает нормализованное сообщение без internal details.

- [ ] **step 6: связать store lifecycle в boot**

В `boot()`:

```javascript
var settingsStore = root.SchoolCabinetSettingsStore.create({
  settings: root.SchoolCabinetSettings,
  getSync: function () { return root.SupabaseSync; },
  storage: root.localStorage,
  eventTarget: root
});

var controller = createController({
  // existing dependencies
  cabinetSettingsCore: root.SchoolCabinetSettings,
  cabinetSettingsStore: settingsStore
});

settingsStore.subscribe(function (state) {
  controller.applyCabinetSettings(state);
  controller.receiveCabinetSettingsState(state);
});

settingsStore.load().catch(function () {
  controller.receiveCabinetSettingsState(settingsStore.getState());
});
```

Не блокировать загрузку уроков на settings load; static config работает сразу.

- [ ] **step 7: focused GREEN и commit**

Run:

```bash
node --check school.js
node --test test/school-cabinet-settings.test.cjs test/school-cabinet-settings-store.test.cjs test/school-ui.test.cjs
```

Expected: settings UI/controller tests PASS; existing school UI tests remain green.

Commit:

```bash
git add school.js test/school-ui.test.cjs
git commit -m "подключить редактирование кабинетов школы"
```

---

### task 7: responsive styling и accessibility regression

**Files:**

- Modify: `school.css:70-130, 892-970, 1490-1540`
- Modify: `test/school-ui.test.cjs`
- Modify: `test/ui-polish.test.cjs`

**Interfaces:**

- Consumes: settings markup.
- Produces: desktop right drawer, mobile sheet/fullscreen layout, visible focus/errors и 44×44 touch targets.

- [ ] **step 1: написать failing static CSS contract**

Добавить assertions:

```javascript
const css = read('school.css');
assert.match(css, /\.school-settings-open[\s\S]*min-width:\s*44px/);
assert.match(css, /\.school-settings-drawer/);
assert.match(css, /\.school-settings-row/);
assert.match(css, /\.school-settings-field-state\.is-error/);
assert.match(css, /@media\s*\(max-width:\s*640px\)[\s\S]*\.school-settings-drawer/);
assert.doesNotMatch(css, /\.school-settings-row[^}]*overflow-x:\s*visible/);
```

- [ ] **step 2: подтвердить RED**

Run:

```bash
node --test --test-name-pattern="school settings|settings drawer" test/school-ui.test.cjs test/ui-polish.test.cjs
```

Expected: FAIL на отсутствующих selectors.

- [ ] **step 3: реализовать desktop styling**

Требования:

```css
.school-head-actions {
  display: flex;
  align-items: center;
  gap: 12px;
}

.school-settings-open {
  min-width: 44px;
  min-height: 44px;
}

.school-settings-drawer {
  width: min(560px, calc(100vw - 32px));
}

.school-settings-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 8px;
}

.school-settings-row input {
  min-width: 0;
  width: 100%;
}
```

Добавить заметные `:focus-visible`, error color без зависимости только от цвета и status line.

- [ ] **step 4: реализовать mobile layout**

При `max-width: 640px`:

- drawer занимает доступную ширину/высоту с safe-area paddings;
- каждая строка становится одной колонкой;
- Save/Cancel остаются видимыми и имеют touch targets ≥44px;
- URL input не создаёт horizontal overflow;
- header progress и gear не перекрываются.

- [ ] **step 5: GREEN и commit**

Run:

```bash
node --test test/school-ui.test.cjs test/ui-polish.test.cjs
```

Expected: UI and polish tests PASS.

Commit:

```bash
git add school.css test/school-ui.test.cjs test/ui-polish.test.cjs
git commit -m "оформить настройки кабинетов на всех экранах"
```

---

### task 8: документация, полный verification gate и Draft PR

**Files:**

- Modify: `README.md:3-38`
- Modify: `school.html` только если cache versions изменились после последних code edits.
- No Notion or Edge Function production changes.

**Interfaces:**

- Consumes: завершённые tasks 0–7.
- Produces: проверенная stacked-ветка и подробный Draft PR поверх PR #53.

- [ ] **step 1: обновить README source precedence**

Заменить утверждение «единственный источник» на:

```markdown
URL шести предметных ChatGPT-кабинетов разрешаются в порядке:

1. аккаунтная настройка `school_cabinet_urls_v1` из Supabase `user_data`;
2. статический URL из `SchoolLearningConfig.cabinets`;
3. безопасный fallback с копированием промта без открытия кабинета.

настройка выполняется через кнопку «Настройки школы». URL являются обычными
пользовательскими ссылками и не должны содержать token, jwt, service-role key
или другие секреты. Notion не хранит эти настройки.
```

Описать exact hosts и cache isolation.

- [ ] **step 2: focused frontend gate**

Run:

```bash
node --check school-cabinet-settings.js
node --check school-cabinet-settings-store.js
node --check supabase-sync.js
node --check school-learning-route.js
node --check school.js
node --test test/school-cabinet-settings.test.cjs \
  test/school-cabinet-settings-store.test.cjs \
  test/supabase-sync.test.cjs \
  test/school-learning-route.test.cjs \
  test/school-teacher-bridge.test.cjs \
  test/school-ui.test.cjs \
  test/ui-polish.test.cjs
```

Expected: syntax checks exit 0; all focused tests PASS.

- [ ] **step 3: полный frontend/backend gate**

Run:

```bash
node --test
cd supabase/functions/school-notion
deno task check
deno task lint
deno task test
```

Expected:

- frontend suite превышает baseline 365 tests и полностью PASS;
- Deno check/lint exit 0;
- backend suite не меньше baseline 108 tests и полностью PASS.

- [ ] **step 4: migration и security gate**

Run from repository root:

```bash
npx --yes supabase@2.110.0 db reset
npx --yes supabase@2.110.0 test db supabase/tests/user_data_rls.sql
npx --yes supabase@2.110.0 migration list --local
```

Через Supabase MCP повторно проверить production migration history и Security Advisor перед любым remote apply.

Expected:

- local pgTAP PASS;
- migration history не имеет случайных переигрываний/переименований;
- remote apply выполняется только после отдельного подтверждения пользователя;
- warnings, не относящиеся к этому PR, перечислены отдельно.

- [ ] **step 5: secret и scope checks**

Run:

```bash
git diff --check agent/school-learning-routes-readonly..HEAD
git diff --name-only agent/school-learning-routes-readonly..HEAD
git grep -nE 'ntn_[A-Za-z0-9]|sb_secret_[A-Za-z0-9]|service_role.*[=:].*[A-Za-z0-9]' -- \
  school-cabinet-settings.js school-cabinet-settings-store.js supabase-sync.js \
  school.js school.html README.md test supabase
git status --short --branch
```

Expected:

- diff check exit 0;
- только заявленные settings/RLS/docs files;
- секреты отсутствуют;
- Notion lessons/schema и Edge Function не изменены;
- working tree clean после финального documentation commit.

- [ ] **step 6: browser QA desktop**

Запустить static preview:

```bash
python3 -m http.server 8765 --bind 127.0.0.1
```

На `http://127.0.0.1:8765/school.html` с действующей сессией проверить:

- gear открывает drawer и фокус попадает в первое поле;
- заполнение только Software Engineering сохраняется;
- reload использует сохранённый URL;
- начало урока использует secure pre-open flow;
- prompt не появляется в URL;
- reset + save возвращает static/copy-only fallback;
- invalid host блокирует Save;
- cloud error не показывает ложный success;
- dirty draft не затирается входящим remote update;
- закрытие по Escape и focus return работают;
- уроки и Notion не мутируются в ходе проверки URL settings.

Сделать screenshots header, drawer valid state и validation error.

- [ ] **step 7: browser QA mobile и cross-device sync**

Проверить viewport `390×844`:

- drawer не имеет horizontal overflow;
- keyboard не закрывает Save/Cancel без возможности прокрутки;
- touch targets ≥44px;
- длинный валидный URL остаётся внутри поля;
- настройка, сохранённая в одном browser context, появляется во втором context того же аккаунта;
- другой auth user не получает cache или remote row владельца.

Для проверки другого пользователя использовать local/test Supabase auth, не production-аккаунт третьего лица.

Сделать mobile screenshots.

- [ ] **step 8: read-only school integrity check**

Не создавая тестовых уроков и не выполняя lesson mutations, повторно открыть школу и подтвердить:

- отображаются 18 реальных уроков;
- распределение остаётся `9 / 2 / 3 / 2 / 1 / 1`;
- настройки кабинетов не появились в Notion;
- test cards отсутствуют.

- [ ] **step 9: final documentation commit**

```bash
git add README.md school.html
git commit -m "документировать синхронизацию кабинетов"
```

Если `school.html` не менялся после task 5, не добавлять его искусственно.

- [ ] **step 10: открыть подробный Draft PR**

Перед публикацией:

```bash
git status --short --branch
git merge-base --is-ancestor agent/school-learning-routes-readonly HEAD
git log --oneline agent/school-learning-routes-readonly..HEAD
git push -u origin agent/school-cabinet-settings
```

PR base: `agent/school-learning-routes-readonly`.

PR title:

```text
добавить синхронизацию предметных кабинетов школы
```

PR body должен подробно описать:

- UI для шести предметных кабинетов;
- remote source of truth и аккаунтный cache;
- почему общий localStorage-sync исключает settings keys;
- RLS hardening и связанное issue;
- URL policy и отсутствие prompt в URL;
- влияние на static fallback и lesson routes;
- отсутствие изменений Notion/18 уроков/Edge Function;
- все фактические test commands и counts;
- desktop/mobile/cross-device evidence;
- связанные и несвязанные Security Advisor warnings;
- base PR #53 и порядок retarget/rebase после его merge.

Оставить PR в Draft. Не merge и не переводить в Ready без отдельного разрешения.

## итоговый self-review checklist

- [ ] каждый критерий design doc покрыт конкретным task;
- [ ] нет новых таблиц, Edge Functions или Notion properties;
- [ ] remote `value` всегда сериализуется в text;
- [ ] общий sync не видит remote key/cache prefix;
- [ ] response предыдущего auth user отбрасывается;
- [ ] static config не мутируется;
- [ ] dirty draft защищён от remote overwrite;
- [ ] URL повторно проверяется перед pre-open;
- [ ] prompt не добавляется в URL;
- [ ] RLS hardening оформлен issue-first и протестирован;
- [ ] migration создана CLI, а не выдуманным filename;
- [ ] commit/issue/PR тексты русские, в нижнем регистре;
- [ ] PR stacked на #53, Draft и не merge.
