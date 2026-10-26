const assert = require('node:assert/strict');
const test = require('node:test');
const { loadSupabaseSync, flushPromises } = require('./helpers/supabase-sync.cjs');

test('initial push does not sync sensitive OpenRouter settings', async () => {
  const app = await loadSupabaseSync({
    initialStorage: {
      openrouter_settings_v1: JSON.stringify({ key: 'sk-secret', model: 'x' }),
      nutrition_kitchen_profile_v1: JSON.stringify({ activeMode: 'extended' }),
      nutrition_cooking_plans_v1: JSON.stringify({ version: 1 }),
      store_v2: JSON.stringify({ rewards: [] }),
    },
  });

  await app.runTimers();

  const pushedKeys = app.writes.upserts.flat().map((row) => row.key);
  assert.ok(pushedKeys.includes('store_v2'));
  assert.ok(pushedKeys.includes('nutrition_kitchen_profile_v1'));
  assert.ok(pushedKeys.includes('nutrition_cooking_plans_v1'));
  assert.ok(!pushedKeys.includes('openrouter_settings_v1'));
});

test('полная загрузка проходит несколько серверных страниц даже при меньшем лимите сервера', async()=>{
  const rows=Array.from({length:1201},(_,i)=>({key:'eye_break_session_v1:'+String(i).padStart(4,'0'),value:{i},updated_at:new Date().toISOString()}));
  const app=await loadSupabaseSync({cloudRows:rows,serverLimit:100});
  await app.context.window.SupabaseSync.pullNow();
  assert.deepEqual(JSON.parse(app.localStorage.getItem('eye_break_session_v1:1200')),{i:1200});
  assert.ok(app.reads.some(q=>q.after==='eye_break_session_v1:1199'));
  assert.ok(app.reads.every(q=>q.user==='u1'));
});
test('ошибка промежуточной страницы не применяет неполный снимок',async()=>{
 const options={cloudRows:[]};const app=await loadSupabaseSync(options);
 options.read=q=>q.after?{data:null,error:{message:'page failed'}}:{data:[{key:'eye_break_settings_v1',value:{speed:'fast'},updated_at:new Date().toISOString()}],error:null};
 await assert.rejects(app.context.window.SupabaseSync.pullNow());
 assert.equal(app.localStorage.getItem('eye_break_settings_v1'),null);
});
test('поздний снимок предыдущего аккаунта или поколения не применяется',async()=>{
 const options={cloudRows:[]};const app=await loadSupabaseSync(options);let resolve;
 options.read=()=>new Promise(r=>resolve=r);
 const old=app.context.window.SupabaseSync.pullNow();await flushPromises();
 options.read=()=>({data:[],error:null});app.changeUser({id:'u2',email:'u2@test'});
 resolve({data:[{key:'eye_break_settings_v1',value:{speed:'fast'},updated_at:new Date().toISOString()}],error:null});await old;
 assert.equal(app.localStorage.getItem('eye_break_settings_v1'),null);
 assert.equal(app.context.window.SupabaseSync.getUser().id,'u2');
});
test('служебные состояния глаз и монет не попадают в облако',async()=>{
 const ledger={balance:2,earned:2,spent:0,history:[],habitRewardsV1:{mark:{paid:2}},habitRewardOperationsV1:{accepted:['local','h','2026-10-24',0,1]}};
 const app=await loadSupabaseSync({initialStorage:{_eye_break_active_v1:'{}',_eye_break_runtime_v1:'{}','_habit_reward_tx_v1:user-a':'{}',eye_break_settings_v1:'{}',coins_v1:JSON.stringify(ledger)}});await app.runTimers();
 const keys=app.writes.upserts.flat().map(r=>r.key);assert.ok(keys.includes('eye_break_settings_v1'));assert.ok(!keys.some(k=>k.startsWith('_eye_break_')||k.startsWith('_habit_reward_')));
 assert.deepEqual(JSON.parse(JSON.stringify(app.writes.upserts.flat().find(r=>r.key==='coins_v1').value)),ledger);
});

test('путь синхронизируется существующим каналом аккаунта и применяет обновление из облака', async () => {
  const P=require('../path-core.js');
  const first=P.createPath('2026-10-23T12:00:00Z');
  const app=await loadSupabaseSync({initialStorage:{identity_path_v1:JSON.stringify(first)}});
  await app.runTimers();
  const row=app.writes.upserts.flat().find(row=>row.key==='identity_path_v1');
  assert.equal(row.user_id,'u1');
  assert.equal(JSON.stringify(row.value),JSON.stringify(first));
  const second=P.updateAvatar(first,{skin:'#ffffff',hair:'#111111'});
  const reader=await loadSupabaseSync({initialStorage:{_sync_init_v1:'1'},cloudRows:[{key:'identity_path_v1',value:first,updated_at:new Date().toISOString()}]});
  reader.emitCloudChange({eventType:'UPDATE',new:{user_id:'u1',key:'identity_path_v1',value:second,updated_at:new Date(Date.now()+10000).toISOString()}});
  assert.deepEqual(JSON.parse(reader.localStorage.getItem('identity_path_v1')),second);
});

test('generic sync never uploads cabinet settings or account caches', async () => {
  const app = await loadSupabaseSync({
    initialStorage: {
      school_cabinet_urls_v1: JSON.stringify({ version: 1, cabinets: {} }),
      'school_cabinet_urls_cache_v1:u1': JSON.stringify({
        version: 1,
        cabinets: {
          'chatgpt-software': 'https://chatgpt.com/g/u1',
        },
      }),
      store_v2: JSON.stringify({ rewards: [] }),
    },
  });

  await app.runTimers();

  const keys = app.writes.upserts.flat().map((row) => row.key);
  assert.equal(keys.includes('school_cabinet_urls_v1'), false);
  assert.equal(
    keys.some((key) => key.startsWith('school_cabinet_urls_cache_v1:')),
    false
  );
  assert.equal(keys.includes('store_v2'), true);
});

test('removing a local key deletes the cloud row instead of upserting null', async () => {
  const app = await loadSupabaseSync({
    initialStorage: {
      store_v2: JSON.stringify({ rewards: [{ id: 'r1' }] }),
    },
  });

  app.localStorage.removeItem('store_v2');
  await app.context.window.DashboardSync.forceSync('store_v2');

  assert.equal(app.writes.deletes.length, 1);
  assert.equal(app.writes.upserts.flat().some((row) => row.key === 'store_v2'), false);
});

test('cloud delete events remove local keys and notify listeners', async () => {
  const app = await loadSupabaseSync({
    initialStorage: {
      store_v2: JSON.stringify({ rewards: [{ id: 'r1' }] }),
    },
  });
  const applied = [];
  app.context.window.addEventListener('dashboard-sync-applied', (event) => {
    applied.push(event.detail.changedKeys);
  });

  app.emitCloudChange({
    eventType: 'DELETE',
    old: { key: 'store_v2', updated_at: new Date(Date.now() + 1000).toISOString() },
  });

  assert.equal(app.localStorage.getItem('store_v2'), null);
  assert.equal(JSON.stringify(applied), JSON.stringify([['store_v2']]));
});

const protectedKey = 'goals:2026-10-27';
function versionedBackend(initial = 'a') {
  const documents = new Map([[protectedKey, { key: protectedKey, exists: true, valueText: initial, revision: '1', updatedAt: '2026-10-26T00:00:00Z' }]]);
  const spaces = new Map([['u1', documents]]);
  const options = {};
  options.rpc = async (name, args, owner) => {
    if (name === 'dashboard_sync_capabilities') return { data: { protocol: 2, guardEnabled: false, writeEnabled: false }, error: null };
    const space = spaces.get(owner) || new Map();
    if (name === 'dashboard_read_user_data') return { data: [...space.values()].filter(row => !args.p_after_key || row.key > args.p_after_key).sort((a,b) => a.key.localeCompare(b.key)).slice(0, options.pageSize || args.p_limit), error: null };
    if (name !== 'dashboard_save_documents') throw Error('неизвестный rpc');
    if (args.p_expected_owner !== owner) return { data: { ok: false, error: { code: 'owner_changed', status: 403 } }, error: null };
    if (options.save) return options.save(args, owner);
    return save(args, owner);
  };
  function save(args, owner = 'u1') {
    const space = spaces.get(owner) || new Map();
    const current = args.p_changes.map(c => space.get(c.key) || { key: c.key, exists: false, valueText: null, revision: '0', updatedAt: null });
    if (current.some((r,i) => r.revision !== args.p_changes[i].expectedRevision)) return { data: { ok: false, error: { code: 'conflict', status: 409 }, current }, error: null };
    const data = args.p_changes.map((c,i) => ({ key: c.key, exists: true, valueText: c.valueText, revision: String(BigInt(current[i].revision) + 1n), updatedAt: '2026-10-27T00:00:00Z' }));
    data.forEach(r => space.set(r.key, r)); spaces.set(owner, space);
    return { data: { ok: true, data }, error: null };
  }
  return { options, documents, spaces, save };
}

test('v2 отправляет защищённый ключ только через cas с ожидаемыми owner/revision', async () => {
  const backend = versionedBackend('[]');
  const app = await loadSupabaseSync(backend.options);
  app.localStorage.setItem(protectedKey, '[1]');
  const result = await app.context.window.DashboardSync.forceSync(protectedKey);
  assert.equal(result.ok, true);
  assert.equal(backend.documents.get(protectedKey).valueText, '[1]');
  const call = app.rpcs.find(r => r.name === 'dashboard_save_documents');
  assert.equal(call.args.p_expected_owner, 'u1');
  assert.equal(call.args.p_changes[0].expectedRevision, '1');
  assert.equal(app.writes.upserts.flat().some(r => r.key === protectedKey), false);
  assert.equal(app.context.window.DashboardSync.getDocumentToken(protectedKey).baseRevision, '2');
});

test('v2 неизвестная локальная база остаётся для явного решения, не first-push', async () => {
  const backend = versionedBackend('remote');
  const app = await loadSupabaseSync({ ...backend.options, initialStorage: { [protectedKey]: 'offline' } });
  assert.equal(app.localStorage.getItem(protectedKey), 'offline');
  const result = await app.context.window.DashboardSync.forceSync(protectedKey);
  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'conflict');
  assert.equal(backend.documents.get(protectedKey).valueText, 'remote');
  assert.equal(app.rpcs.some(r => r.name === 'dashboard_save_documents'), false);
});

test('v2 сериализует pushes и поздний ack не теряет следующую правку', async () => {
  const backend = versionedBackend();
  const app = await loadSupabaseSync(backend.options);
  let release, firstArgs;
  backend.options.save = args => new Promise(resolve => { firstArgs = args; release = () => resolve(backend.save(args)); });
  app.localStorage.setItem(protectedKey, 'b');
  const first = app.context.window.DashboardSync.forceSync(protectedKey);
  await flushPromises();
  app.localStorage.setItem(protectedKey, 'c');
  const second = app.context.window.DashboardSync.forceSync(protectedKey);
  assert.equal(firstArgs.p_changes[0].valueText, 'b');
  backend.options.save = null;
  release();
  await first; await second;
  assert.equal(app.localStorage.getItem(protectedKey), 'c');
  assert.equal(backend.documents.get(protectedKey).valueText, 'c');
  assert.equal(backend.documents.get(protectedKey).revision, '3');
});

test('v2 dirty переживает reload после ошибки, служебный cache не отправляется', async () => {
  const backend = versionedBackend();
  const app = await loadSupabaseSync(backend.options);
  backend.options.save = () => ({ data: null, error: { code: 'network' } });
  app.localStorage.setItem(protectedKey, 'offline');
  assert.equal((await app.context.window.DashboardSync.forceSync(protectedKey)).ok, false);
  const initialStorage = Object.fromEntries(app.localStorage.data);
  backend.options.save = null;
  const restored = await loadSupabaseSync({ ...backend.options, initialStorage });
  assert.equal(restored.localStorage.getItem(protectedKey), 'offline');
  assert.equal((await restored.context.window.DashboardSync.forceSync(protectedKey)).ok, true);
  assert.equal(backend.documents.get(protectedKey).valueText, 'offline');
  assert.equal(restored.writes.upserts.flat().some(r => r.key.startsWith('_sync_cas_')), false);
});

test('v2 смена аккаунта не применяет старый ack и не отправляет ему чужой pending', async () => {
  const backend = versionedBackend();
  const app = await loadSupabaseSync(backend.options);
  let release;
  backend.options.save = args => new Promise(resolve => { release = () => resolve(backend.save(args)); });
  app.localStorage.setItem(protectedKey, 'pending-a');
  const pending = app.context.window.DashboardSync.forceSync(protectedKey);
  await flushPromises();
  app.changeUser({ id: 'u2' });
  await flushPromises();
  release(); await pending;
  assert.equal(app.localStorage.getItem(protectedKey), null);
  assert.equal(backend.spaces.get('u2')?.has(protectedKey) || false, false);
  assert.ok(app.localStorage.getItem('_sync_cas_v2:u1').includes('pending-a'));
});

test('v2 auth/network capability error не включает fallback к неверсированному upsert', async () => {
  const backend = versionedBackend();
  const app = await loadSupabaseSync({ initialStorage: { [protectedKey]: 'local' }, rpc: () => ({ data: null, error: { code: '401', message: 'auth error' } }) });
  await assert.rejects(app.context.window.SupabaseSync.pullNow());
  await app.context.window.DashboardSync.forceSync(protectedKey);
  assert.equal(app.writes.upserts.length, 0);
  assert.equal(backend.documents.get(protectedKey).valueText, 'a');
});

test('v2 realtime не игнорируется три секунды и не затирает dirty', async () => {
  const backend = versionedBackend();
  const app = await loadSupabaseSync(backend.options);
  const token = app.context.window.DashboardSync.getDocumentToken(protectedKey);
  app.localStorage.setItem(protectedKey, 'local');
  const newer = { key: protectedKey, exists: true, valueText: 'remote', revision: '2', updatedAt: '2000-01-01T00:00:00Z' };
  backend.documents.set(protectedKey, newer);
  app.emitCloudChange({ eventType: 'UPDATE', new: { user_id: 'u1', key: protectedKey, value: 'remote', revision: 2, updated_at: newer.updatedAt } });
  await flushPromises();
  assert.equal(app.localStorage.getItem(protectedKey), 'local');
  assert.equal((await app.context.window.DashboardSync.forceSync(protectedKey)).error.code, 'conflict');
  assert.equal(app.context.window.DashboardSync.canApplyDocumentToken(token), false);
});

test('v2 замечает правку другой вкладки до её storage event и не затирает её pull', async () => {
  const backend = versionedBackend();
  const app = await loadSupabaseSync(backend.options);
  app.localStorage.data.set(protectedKey, 'другая вкладка');
  backend.documents.set(protectedKey, { ...backend.documents.get(protectedKey), valueText: 'сервер', revision: '2' });
  await app.context.window.SupabaseSync.pullNow();
  assert.equal(app.localStorage.getItem(protectedKey), 'другая вкладка');
  assert.equal((await app.context.window.DashboardSync.forceSync(protectedKey)).error.code, 'conflict');
});

test('v2 точное совпадение всех документов после потерянного ack не создаёт ложный conflict', async () => {
  const backend = versionedBackend();
  const app = await loadSupabaseSync(backend.options);
  app.localStorage.setItem(protectedKey, 'b');
  backend.documents.set(protectedKey, { ...backend.documents.get(protectedKey), valueText: 'b', revision: '2' });
  const result = await app.context.window.DashboardSync.forceSync(protectedKey);
  assert.equal(result.ok, true);
  assert.equal(app.context.window.DashboardSync.getDocumentToken(protectedKey).baseRevision, '2');
  assert.equal(backend.documents.get(protectedKey).revision, '2');
});
