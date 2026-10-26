const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const vm = require('node:vm');
const Tasks = require('../dashboard-tasks-core.js');

class Element {
  constructor(tag = 'div') {
    this.tagName = tag.toUpperCase(); this.children = []; this.listeners = {}; this.value = ''; this.textContent = ''; this.style = {}; this.className = '';
    this.classList = { add: n => { if (!this.className.split(' ').includes(n)) this.className += ' ' + n; }, remove: n => { this.className = this.className.split(' ').filter(x => x !== n).join(' '); } };
  }
  set innerHTML(html) {
    this.children = []; this._html = html;
    for (const m of String(html).matchAll(/<([a-z]+)\b[^>]*class="([^"]+)"[^>]*>/g)) {
      const el = new Element(m[1]); el.className = m[2]; el.value = /value="([^"]*)"/.exec(m[0])?.[1] || ''; this.appendChild(el);
    }
  }
  get innerHTML() { return this._html || ''; }
  appendChild(el) { this.children.push(el); el.parentNode = this; return el; }
  insertBefore(el, before) { const index = this.children.indexOf(before); this.children.splice(index < 0 ? this.children.length : index, 0, el); el.parentNode = this; }
  remove() { if (this.parentNode) this.parentNode.children = this.parentNode.children.filter(x => x !== this); }
  querySelector(selector) {
    for (const el of this.children) { if (selector[0] === '.' && el.className.split(' ').includes(selector.slice(1))) return el; const found = el.querySelector(selector); if (found) return found; }
    return null;
  }
  addEventListener(type, fn) { (this.listeners[type] ||= []).push(fn); }
  async fire(type, props = {}) { for (const fn of this.listeners[type] || []) await fn.call(this, { target: this, stopPropagation() {}, preventDefault() {}, ...props }); }
  focus() {}
  blur() { return this.fire('blur'); }
}

const key = 'goals:2026-10-27';
const clone = value => JSON.parse(JSON.stringify(value));
function page(initial, options = {}) {
  const html = fs.readFileSync(require('node:path').join(__dirname, '..', 'index.html'), 'utf8');
  const nodes = new Map([...html.matchAll(/\bid="([^"]+)"/g)].map(m => [m[1], new Element()]));
  const { localStorage } = require('./helpers/supabase-sync.cjs').makeStorage(Object.fromEntries(Object.entries({ [key]: initial, ...options.documents }).map(([k, v]) => [k, JSON.stringify(v)])));
  let picker;
  const get = k => JSON.parse(localStorage.getItem(k) || 'null');
  const warnings = [], writes = [], rewards = [], order = [];
  const window = { DashboardTasksCore: Tasks, crypto: options.noCrypto ? null : require('node:crypto'), getSelection: () => ({ removeAllRanges() {}, addRange() {} }) };
  const context = { window, Tasks, localStorage, document: { getElementById: id => nodes.get(id), createElement: tag => new Element(tag), createRange: () => ({ selectNodeContents() {}, collapse() {} }) },
    storeGet: get,
    storeSet: (k, value) => { localStorage.setItem(k, JSON.stringify(value)); writes.push(clone(value)); order.push('local'); },
    getActiveDateString: () => '2026-10-27', getTomorrowDateString: () => '2026-10-28',
    loadToday() {}, loadTomorrow() {}, renderRadar() {}, getSphereById: () => null,
    NO_SPHERE_ICON: '', NO_SPHERE_LABEL: 'без сектора',
    openSpherePicker: fn => { picker = fn; }, confirm: () => true, alert: message => warnings.push(message), console,
    G: { DIFFICULTY_LABELS: {}, DIFFICULTY_COIN_MULT: { medium: 1 }, completeTask: (...args) => { rewards.push(args); order.push('reward'); } },
  };
  context.G.storeSet = context.storeSet;
  context.G.storeGet = context.storeGet;
  if (options.sync) window.DashboardSync = { forceSync: async () => { order.push('cloud'); return { ok: true }; } };
  vm.createContext(context);
  const details = html.slice(html.indexOf('  // --- Task Details Modal Logic ---'), html.indexOf('  // --- Screenshot Import Logic ---'));
  const row = html.slice(html.indexOf('  function buildGoalRow('), html.indexOf('  function loadToday('));
  const remove = html.slice(html.indexOf('  async function removeGoalWithSync('), html.indexOf('  function openScreenshotModal('));
  const clear = html.slice(html.indexOf('  async function clearTodayGoals('), html.indexOf('  function buildGoalRow('));
  vm.runInContext(details + '\n' + row + '\n' + remove + '\n' + clear, context);
  context.tick = () => {};
  if (options.wire) vm.runInContext(html.slice(html.indexOf('  // --- Add ---'), html.indexOf('\n  loadToday(); loadTomorrow();')), context);
  if (options.rollover) vm.runInContext(html.slice(html.indexOf('  // --- Rollover'), html.indexOf('  // --- Streak ---')), context);
  if (options.import) {
    context.ssAddBtn = nodes.get('screenshotAddBtn'); context.ssClose = null;
    const fields = { '.proposal-cb': { checked: true }, '.proposal-text': { value: 'из скриншота' }, '.proposal-input-min': { value: '25' }, '.proposal-sphere': { value: '' }, '.proposal-diff': { value: 'medium' } };
    context.ssResults = { querySelectorAll: () => [{ querySelector: selector => fields[selector] }] };
    vm.runInContext(html.slice(html.indexOf('  if (ssAddBtn) {'), html.lastIndexOf('})();')), context);
  }
  context.openTaskModal = (...args) => window.openTaskModal(...args);
  return { context, window, nodes, warnings, writes, rewards, order,
    data: (k = key) => get(k), remote: value => { localStorage.setItem(key, JSON.stringify(value)); },
    row: index => context.buildGoalRow(get(key)[index], index, key, false),
    chooseSphere: value => picker(value) };
}

test('task modal после remote insert не сохраняет description в соседнюю запись', async () => {
  for (const id of ['stable-id', undefined]) {
    const task = { ...(id ? { id } : {}), text: 'задача', done: false, description: 'раньше' };
    const app = page([task]);
    app.window.openTaskModal(task, 0, key);
    const remote = [{ id: 'other', text: 'другая', done: false, description: 'не трогать' }, task];
    app.remote(remote);
    app.nodes.get('modalTaskDesc').value = 'старая правка';
    await app.nodes.get('modalTaskDesc').fire('blur');
    assert.deepEqual(app.data(), remote);
    assert.equal(app.writes.length, 0);
    assert.ok(app.warnings.length);
  }
});

test('inline title и отложенный sphere picker привязаны к снимку и id', async () => {
  for (const mode of ['title', 'sphere']) {
    const task = { id: 'stable', text: 'задача', done: false, sphere: '' };
    const app = page([task]);
    const row = app.row(0);
    if (mode === 'title') await row.querySelector('.goal-text').fire('click');
    else await row.querySelector('.goal-sphere-badge').fire('click');
    const remote = [{ id: 'new', text: 'другая', done: false, sphere: '' }, task];
    app.remote(remote);
    if (mode === 'title') { row.querySelector('.goal-text').textContent = 'старая правка'; await row.querySelector('.goal-text').fire('blur'); }
    else app.chooseSphere('career');
    assert.deepEqual(app.data(), remote);
    assert.equal(app.writes.length, 0);
  }
});

test('stale подтверждение выполнения не отмечает соседа и не начисляет награду', async () => {
  const task = { id: 'a', text: 'задача', done: false, sphere: '', difficulty: 'medium', estimatedMin: 15 };
  const app = page([task]);
  const row = app.row(0), cb = row.querySelector('.goal-cb');
  cb.checked = true; await cb.fire('change');
  const remote = [{ id: 'b', text: 'другая', done: false }, task]; app.remote(remote);
  await row.querySelector('.goal-confirm-btn').fire('click');
  assert.deepEqual(app.data(), remote);
  assert.equal(app.rewards.length, 0);
});

test('обычное выполнение задачи сохраняет прежний порядок local → reward → cloud', async () => {
  const task = { id: 'a', text: 'задача', done: false, sphere: '', difficulty: 'medium', estimatedMin: 15 };
  const app = page([task], { sync: true });
  const row = app.row(0), cb = row.querySelector('.goal-cb'); cb.checked = true; await cb.fire('change');
  row.querySelector('.goal-actual-input').value = '20';
  await row.querySelector('.goal-confirm-btn').fire('click');
  assert.equal(app.data()[0].done, true);
  assert.equal(app.data()[0].actualMin, 20);
  assert.deepEqual(app.rewards, [['', 'medium', 20]]);
  assert.deepEqual(app.order, ['local', 'reward', 'cloud']);
});

test('stale delete и drag не удаляют и не переставляют соседнюю запись', async () => {
  for (const action of ['delete', 'drag']) {
    const a = { id: 'a', text: 'а', done: false }, b = { id: 'b', text: 'б', done: false };
    const app = page([a, b]), row = app.row(0), target = app.row(1);
    const transfer = { value: '', setData(_type, value) { this.value = value; }, getData() { return this.value; } };
    if (action === 'drag') await row.fire('dragstart', { dataTransfer: transfer });
    const remote = [{ id: 'new', text: 'новая', done: false }, a, b]; app.remote(remote);
    if (action === 'delete') await row.querySelector('.goal-delete').fire('click');
    else await target.fire('drop', { dataTransfer: transfer });
    assert.deepEqual(app.data(), remote);
    assert.equal(app.writes.length, 0);
  }
});

test('создание из формы получает uuid, а без crypto ничего не добавляет', async () => {
  for (const noCrypto of [false, true]) {
    const app = page([], { wire: true, noCrypto });
    app.nodes.get('goalInput').value = 'новая задача';
    await app.nodes.get('goalAddBtn').fire('click');
    if (noCrypto) assert.deepEqual(app.data(), []);
    else assert.match(app.data()[0].id, /^[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/);
  }
});

test('перенос всех задач сохраняет id и содержимое, одинаковое название не удаляет задачу', async () => {
  const source = { id: 'source', text: 'одно имя', done: false, description: 'описание', subtasks: [{ text: 'этап', done: true }], custom: 42 };
  const destination = { id: 'other', text: 'одно имя', done: false };
  const app = page([source], { wire: true, documents: { 'goals:2026-10-28': [destination] } });
  await app.nodes.get('gmPushBtn').fire('click');
  assert.deepEqual(app.data(), []);
  assert.deepEqual(app.data('goals:2026-10-28'), [destination, source]);
});

test('rollover делает копию с новым uuid и сохраняет детали без изменения исходного архива', () => {
  const source = { id: 'old', text: 'перенести', done: false, description: 'описание', subtasks: [{ text: 'этап', done: true }], custom: 'сохранить' };
  const app = page([], { rollover: true, documents: { 'goals:2026-10-26': [source] } });
  assert.equal(app.data()[0].description, 'описание');
  assert.equal(app.data()[0].custom, 'сохранить');
  assert.notEqual(app.data()[0].id, 'old');
  assert.match(app.data()[0].id, /^[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/);
  assert.deepEqual(app.data('goals:2026-10-26'), [source]);
});

test('очистка списка отклоняется, если он поменялся во время подтверждения', async () => {
  const task = { id: 'a', text: 'задача', done: false }, fresh = { id: 'new', text: 'новая', done: false };
  const app = page([task]);
  app.context.confirm = () => { app.remote([task, fresh]); return true; };
  await app.context.clearTodayGoals();
  assert.deepEqual(app.data(), [task, fresh]);
  assert.equal(app.writes.length, 0);
});

test('импорт готового распознавания выдаёт uuid без вызова модели', () => {
  const app = page([], { import: true });
  app.nodes.get('screenshotAddBtn').onclick();
  assert.match(app.data()[0].id, /^[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/);
  assert.equal(app.data()[0].text, 'из скриншота');
});

function inboxPage(noCrypto = false) {
  const html = fs.readFileSync(require('node:path').join(__dirname, '..', 'inbox.html'), 'utf8');
  const nodes = new Map([...html.matchAll(/\bid="([^"]+)"/g)].map(m => [m[1], new Element()]));
  const stored = new Map([['inbox_v1', [{ id: 'item', text: 'из входящих' }]]]);
  class FixedDate extends Date { constructor(value) { super(value === undefined ? '2026-10-27T00:30:00Z' : value); } }
  const window = { DashboardTasksCore: Tasks, GoalsCore: require('../goals-core.js'), crypto: noCrypto ? null : require('node:crypto'), Gamification: {
    storeGet: key => stored.has(key) ? clone(stored.get(key)) : null,
    storeSet: (key, value) => stored.set(key, clone(value)), esc: value => value,
  } };
  const context = { window, document: { getElementById: id => nodes.get(id), createElement: tag => new Element(tag), querySelectorAll: () => [] }, Date: FixedDate, alert() {} };
  vm.createContext(context);
  const source = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)].map(m => m[1]).filter(s => s.trim()).at(-1);
  vm.runInContext(source, context);
  context.closeModals = () => window.closeModals();
  return { window, stored };
}

test('входящие создают задачи/цели с uuid, явным периодом и активным днём 06:00', () => {
  const goals = inboxPage(); goals.window.prepareMove('item', 'goal'); goals.window.moveToGoal('month');
  const goal = goals.stored.get('horizons_goals_v2').goals[0];
  assert.match(goal.id, /^[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/);
  assert.equal(goal.periodKey, '2026-10'); assert.equal(goal.priority, 'p3');
  const tasks = inboxPage(); tasks.window.prepareMove('item', 'task'); tasks.window.moveToTask('today');
  assert.ok(tasks.stored.has('goals:2026-10-26'));
  assert.match(tasks.stored.get('goals:2026-10-26')[0].id, /^[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/);
  const unavailable = inboxPage(true); unavailable.window.prepareMove('item', 'task'); unavailable.window.moveToTask('today');
  assert.equal(unavailable.stored.get('inbox_v1').length, 1);
  assert.equal([...unavailable.stored.keys()].some(k => k.startsWith('goals:')), false);
});
