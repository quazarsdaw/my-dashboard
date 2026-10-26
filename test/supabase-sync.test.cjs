const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

function makeStorage(initial = {}) {
  function Storage() {
    this.data = new Map(Object.entries(initial).map(([k, v]) => [k, String(v)]));
  }
  Storage.prototype.key = function key(index) {
    return Array.from(this.data.keys())[index] || null;
  };
  Storage.prototype.getItem = function getItem(key) {
    return this.data.has(key) ? this.data.get(key) : null;
  };
  Storage.prototype.setItem = function setItem(key, value) {
    this.data.set(key, String(value));
  };
  Storage.prototype.removeItem = function removeItem(key) {
    this.data.delete(key);
  };
  Object.defineProperty(Storage.prototype, 'length', {
    get() { return this.data.size; },
  });
  return { Storage, localStorage: new Storage() };
}

async function flushPromises() {
  for (let i = 0; i < 5; i++) await Promise.resolve();
  await new Promise((resolve) => setImmediate(resolve));
}

async function loadSupabaseSync(options = {}) {
  const { Storage, localStorage } = makeStorage(options.initialStorage || {});
  const timers = [];
  const listeners = {};
  const writes = { upserts: [], deletes: [] };
  const elements = {};
  const topbar = {
    firstChild: null,
    insertBefore(child) {
      this.firstChild = child;
      if (child.id) elements[child.id] = child;
    },
  };
  let postgresChangeHandler = null;
  let authChangeHandler = null;
  const reads = [];

  function setTimer(fn) {
    const timer = { fn, active: true };
    timers.push(timer);
    return timer;
  }

  function clearTimer(timer) {
    if (timer) timer.active = false;
  }

  function makeElement() {
    return {
      style: {},
      set id(value) {
        this._id = value;
        elements[value] = this;
      },
      get id() {
        return this._id;
      },
      setAttribute() {},
      addEventListener() {},
    };
  }

  function makeBuilder() {
    const query = { after: null, limit: Infinity, user: null };
    const builder = {
      select() { return builder; },
      eq(column, value) { if (column === 'user_id') query.user = value; return builder; },
      order() { return builder; },
      gt(_column,value) { query.after = value; return builder; },
      limit(value) { query.limit=value; return builder; },
      upsert(rows) {
        writes.upserts.push(rows);
        return Promise.resolve({ data: rows, error: null });
      },
      delete() {
        builder.isDelete = true;
        return builder;
      },
      then(resolve,reject) {
        if (builder.isDelete) {
          writes.deletes.push(true);
          return Promise.resolve(resolve({ data: null, error: null }));
        }
        reads.push({...query});
        if (options.read) return Promise.resolve().then(()=>options.read({...query})).then(resolve,reject);
        const rows=(options.cloudRows || []).filter(row=>!query.after||row.key>query.after).sort((a,b)=>a.key<b.key?-1:a.key>b.key?1:0).slice(0,Math.min(query.limit, options.serverLimit || Infinity));
        return Promise.resolve({ data: rows, error: null }).then(resolve,reject);
      },
      catch() { return builder; },
    };
    return builder;
  }

  const context = {
    console: { log() {}, warn() {}, error() {}, info() {}, debug() {} },
    CustomEvent: function CustomEvent(type, init) {
      this.type = type;
      this.detail = init && init.detail;
    },
    Date,
    Promise,
    localStorage,
    setTimeout(fn) {
      return setTimer(fn);
    },
    clearTimeout: clearTimer,
    window: {
      Storage,
      localStorage,
      location: { origin: 'https://example.test', pathname: '/index.html' },
      addEventListener(type, cb) {
        if (!listeners[type]) listeners[type] = [];
        listeners[type].push(cb);
      },
      dispatchEvent(event) {
        (listeners[event.type] || []).forEach((cb) => cb(event));
      },
      supabase: {
        createClient() {
          return {
            auth: {
              getSession() {
                return Promise.resolve({ data: { session: { user: { id: 'u1', email: 'u@test' } } } });
              },
              onAuthStateChange(cb) { authChangeHandler=cb; },
            },
            from() {
              return makeBuilder();
            },
            channel() {
              return {
                on(_event, _filter, cb) {
                  postgresChangeHandler = cb;
                  return this;
                },
                subscribe() { return this; },
              };
            },
            removeChannel() {},
          };
        },
      },
    },
    document: {
      readyState: 'complete',
      head: {
        appendChild(script) {
          script.onload();
        },
      },
      createElement() {
        return makeElement();
      },
      getElementById(id) {
        if (id === 'topbar') return topbar;
        return elements[id] || null;
      },
      addEventListener() {},
    },
  };
  context.window.CustomEvent = context.CustomEvent;
  context.window.setTimeout = context.setTimeout;
  context.window.clearTimeout = context.clearTimeout;

  vm.createContext(context);
  const source = fs.readFileSync(path.join(__dirname, '..', 'supabase-sync.js'), 'utf8');
  vm.runInContext(source, context);
  await flushPromises();

  return {
    context,
    localStorage,
    writes,
    reads,
    changeUser(user) { authChangeHandler('SIGNED_IN', user ? {user}:null); },
    runTimers: async function runTimers() {
      while (timers.length) {
        const timer = timers.shift();
        if (timer.active) timer.fn();
      }
      await flushPromises();
    },
    emitCloudChange(payload) {
      assert.ok(postgresChangeHandler, 'postgres change handler should be installed');
      postgresChangeHandler(payload);
    },
  };
}

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
