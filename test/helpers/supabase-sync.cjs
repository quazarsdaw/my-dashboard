const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
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
  const rpcs = [];
  let activeUser = Object.hasOwn(options, 'user') ? options.user : { id: 'u1', email: 'u@test' };

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
    TextEncoder,
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
                return Promise.resolve({ data: { session: activeUser ? { user: activeUser } : null } });
              },
              onAuthStateChange(cb) { authChangeHandler=cb; },
            },
            from() {
              return makeBuilder();
            },
            rpc(name, args) {
              rpcs.push({ name, args, user: activeUser && activeUser.id });
              return Promise.resolve().then(() => options.rpc ? options.rpc(name, args, activeUser && activeUser.id) :
                { data: null, error: { code: 'PGRST202', message: 'Could not find the function public.dashboard_sync_capabilities without parameters in the schema cache' } });
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
  if (options.loadCore !== false) vm.runInContext(fs.readFileSync(path.join(__dirname, '..', '..', 'dashboard-sync-core.js'), 'utf8'), context);
  const source = fs.readFileSync(path.join(__dirname, '..', '..', 'supabase-sync.js'), 'utf8');
  vm.runInContext(source, context);
  await flushPromises();

  return {
    context,
    localStorage,
    writes,
    reads,
    rpcs,
    changeUser(user) { activeUser = user; authChangeHandler('SIGNED_IN', user ? {user}:null); },
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

module.exports = { makeStorage, flushPromises, loadSupabaseSync };
