const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const GoalsCore = require('../goals-core.js');

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

class FakeClassList {
  constructor(element) {
    this.element = element;
  }

  values() {
    return this.element.className.split(/\s+/).filter(Boolean);
  }

  add(name) {
    this.element.className = Array.from(new Set(this.values().concat(name))).join(' ');
  }

  remove(name) {
    this.element.className = this.values().filter((value) => value !== name).join(' ');
  }

  contains(name) {
    return this.values().includes(name);
  }
}

class FakeElement {
  constructor(tagName, created) {
    this.tagName = tagName.toUpperCase();
    this.created = created;
    this.className = '';
    this.classList = new FakeClassList(this);
    this.children = [];
    this.parentElement = null;
    this.style = {};
    this.textContent = '';
    this.value = '';
    this.focused = false;
    this.validationMessage = '';
    this.onclick = null;
    this.onchange = null;
    this._innerHTML = '';
  }

  appendChild(child) {
    child.parentElement = this;
    this.children.push(child);
    return child;
  }

  set innerHTML(value) {
    this._innerHTML = String(value);
    this.children = [];
    if (this._innerHTML.includes('horizon-content')) {
      const content = new FakeElement('div', this.created);
      content.className = 'horizon-content';
      this.appendChild(content);
      this.created.push(content);
    }
  }

  get innerHTML() {
    return this._innerHTML;
  }

  querySelector(selector) {
    if (selector === '.horizon-content') {
      return this.children.find((child) => child.classList.contains('horizon-content')) || null;
    }
    return null;
  }

  focus() {
    this.focused = true;
  }

  setCustomValidity(message) {
    this.validationMessage = String(message || '');
  }

  reportValidity() {
    return !this.validationMessage;
  }
}

function loadGoalsPage(initialData, options = {}) {
  const html = fs.readFileSync(path.join(__dirname, '..', 'goals.html'), 'utf8');
  const inlineScripts = Array.from(
    html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g),
    (match) => match[1]
  ).filter((source) => source.trim());
  const source = inlineScripts.at(-1);
  const created = [];
  const nodes = new Map();

  Array.from(html.matchAll(/<([a-z0-9-]+)\b[^>]*\bid="([^"]+)"[^>]*>/gi)).forEach((match) => {
    const element = new FakeElement(match[1], created);
    nodes.set(match[2], element);
    created.push(element);
  });
  const currentRow = new FakeElement('div', created);
  currentRow.appendChild(nodes.get('editCurrent'));

  let storedData = clone(initialData);
  let storedSelection = clone(options.selection || {});
  const writes = [];
  const selectionWrites = [];
  const document = {
    createElement(tagName) {
      const element = new FakeElement(tagName, created);
      created.push(element);
      return element;
    },
    getElementById(id) {
      return nodes.get(id) || null;
    }
  };
  const window = {
    GoalsCore,
    Gamification: {
      storeGet(key) {
        if (key === 'horizons_goals_v2') return clone(storedData);
        if (key === 'goals_collapsed_v1') return {};
        if (key === 'goals_period_selection_v1') return clone(storedSelection);
        return null;
      },
      storeSet(key, value) {
        if (key === 'horizons_goals_v2') {
          storedData = clone(value);
          writes.push(clone(value));
        }
        if (key === 'goals_period_selection_v1') {
          storedSelection = clone(value);
          selectionWrites.push(clone(value));
        }
      },
      esc(value) {
        return String(value);
      }
    }
  };
  const context = {
    window,
    document,
    confirm() {
      return true;
    },
    console,
    Date: options.Date || Date,
    Math,
    JSON,
    Object,
    Array,
    Number,
    String
  };
  vm.createContext(context);
  vm.runInContext(source, context);

  return {
    nodes,
    writes,
    selectionWrites,
    window,
    getData() {
      return clone(storedData);
    },
    firstGoalCard() {
      return created.find((element) => element.classList.contains('goal-card')) || null;
    }
  };
}

test('страница подключает календарное ядро до inline-контроллера', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'goals.html'), 'utf8');
  const coreIndex = html.indexOf('src="goals-core.js');
  const controllerIndex = html.lastIndexOf('<script>');

  assert.notEqual(coreIndex, -1);
  assert.ok(coreIndex < controllerIndex);
});

test('старая схема мигрирует один раз и повторный render не пишет её снова', () => {
  class FixedDate extends Date {
    constructor(value) {
      super(value === undefined ? '2026-10-09T12:00:00.000Z' : value);
    }

    static now() {
      return new Date('2026-10-09T12:00:00.000Z').getTime();
    }
  }
  const page = loadGoalsPage({
    goals: [{
      id: 'legacy',
      title: 'Старая цель',
      horizon: 'month',
      type: 'check',
      target: 1,
      unit: '',
      current: 0,
      done: false
    }]
  }, { Date: FixedDate });

  assert.equal(page.writes.length, 1);
  assert.deepEqual(page.getData().goals[0], {
    id: 'legacy',
    title: 'Старая цель',
    horizon: 'month',
    type: 'check',
    target: 1,
    unit: '',
    current: 0,
    done: false,
    periodKey: '2026-10',
    priority: 'p3',
    order: 100
  });

  page.window.toggleHorizon('month');
  assert.equal(page.writes.length, 1);
});

test('название цели-чекбокса редактируется, а отмена не меняет данные', () => {
  const originalGoal = {
    id: 'goal-1',
    title: 'Устроиться в адалт',
    horizon: 'month',
    type: 'check',
    target: 1,
    unit: '',
    current: 0,
    done: false,
    periodKey: '2026-10',
    priority: 'p3',
    order: 100
  };
  const page = loadGoalsPage({ schemaVersion: 3, goals: [originalGoal] });
  const card = page.firstGoalCard();
  const titleInput = page.nodes.get('editTitle');

  assert.ok(titleInput, 'в редакторе есть поле названия');
  card.onclick();
  assert.equal(titleInput.value, originalGoal.title);

  titleInput.value = '  Новая формулировка  ';
  page.nodes.get('closeBtn').onclick();
  assert.deepEqual(page.getData().goals[0], originalGoal);
  assert.equal(page.writes.length, 0);

  card.onclick();
  titleInput.value = '  Новая формулировка  ';
  page.nodes.get('saveBtn').onclick();

  assert.deepEqual(page.getData().goals[0], {
    ...originalGoal,
    title: 'Новая формулировка'
  });
  assert.equal(page.writes.length, 1);
});

test('пустое название оставляет редактор открытым и не перезаписывает цель', () => {
  const originalGoal = {
    id: 'goal-2',
    title: 'Технически доделать прометея',
    horizon: 'month',
    type: 'number',
    target: 100,
    unit: '%',
    current: 40,
    done: false,
    periodKey: '2026-10',
    priority: 'p3',
    order: 100
  };
  const page = loadGoalsPage({ schemaVersion: 3, goals: [originalGoal] });
  const card = page.firstGoalCard();
  const titleInput = page.nodes.get('editTitle');

  assert.ok(titleInput, 'в редакторе есть поле названия');
  card.onclick();
  titleInput.value = '   ';
  page.nodes.get('saveBtn').onclick();

  assert.deepEqual(page.getData().goals[0], originalGoal);
  assert.equal(page.writes.length, 0);
  assert.equal(page.nodes.get('editModal').classList.contains('show'), true);
  assert.notEqual(titleInput.validationMessage, '');
});

test('числовая цель сохраняет новое название вместе с явно изменённым прогрессом', () => {
  const originalGoal = {
    id: 'goal-3',
    title: '100 часов продуктивности',
    horizon: 'month',
    type: 'number',
    target: 100,
    unit: '%',
    current: 40,
    done: false,
    periodKey: '2026-10',
    priority: 'p3',
    order: 100
  };
  const page = loadGoalsPage({ schemaVersion: 3, goals: [originalGoal] });

  page.firstGoalCard().onclick();
  page.nodes.get('editTitle').value = 'Продуктивность за месяц';
  page.nodes.get('editCurrent').value = '65';
  page.nodes.get('saveBtn').onclick();

  assert.deepEqual(page.getData().goals[0], {
    ...originalGoal,
    title: 'Продуктивность за месяц',
    current: 65
  });
  assert.equal(page.writes.length, 1);
});
