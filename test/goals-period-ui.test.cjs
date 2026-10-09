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

  focus() {}
  setCustomValidity() {}
  reportValidity() { return true; }
}

class FixedDate extends Date {
  constructor(value) {
    super(value === undefined ? '2026-10-09T12:00:00.000Z' : value);
  }

  static now() {
    return new Date('2026-10-09T12:00:00.000Z').getTime();
  }
}

function normalizedGoal(overrides) {
  return {
    id: 'goal',
    title: 'Цель',
    horizon: 'month',
    periodKey: '2026-10',
    priority: 'p3',
    order: 100,
    type: 'check',
    target: 1,
    unit: '',
    current: 0,
    done: false,
    ...overrides
  };
}

function loadGoalsPage(initialData, initialSelection = {}) {
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
  let storedSelection = clone(initialSelection);
  let collapsed = {};
  const selectionWrites = [];
  const window = {
    GoalsCore,
    Gamification: {
      storeGet(key) {
        if (key === 'horizons_goals_v2') return clone(storedData);
        if (key === 'goals_period_selection_v1') return clone(storedSelection);
        if (key === 'goals_collapsed_v1') return clone(collapsed);
        return null;
      },
      storeSet(key, value) {
        if (key === 'horizons_goals_v2') storedData = clone(value);
        if (key === 'goals_period_selection_v1') {
          storedSelection = clone(value);
          selectionWrites.push(clone(value));
        }
        if (key === 'goals_collapsed_v1') collapsed = clone(value);
      },
      esc(value) { return String(value); }
    }
  };
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
  const context = {
    window,
    document,
    confirm() { return true; },
    console,
    Date: FixedDate,
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
    selectionWrites,
    window,
    getSelection() { return clone(storedSelection); },
    latestGoalCard() {
      return created.filter((element) => element.classList.contains('goal-card')).at(-1) || null;
    }
  };
}

test('разметка содержит доступные действия навигатора периода', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'goals.html'), 'utf8');

  assert.match(html, /data-period-action="previous"/);
  assert.match(html, /data-period-action="next"/);
  assert.match(html, /data-period-action="today"/);
  assert.match(html, /aria-label="Выбрать период/);
  assert.match(html, /Нет целей в выбранном периоде/);
});

test('выбор периода сохраняется и фильтрует цели одного горизонта', () => {
  const page = loadGoalsPage({
    schemaVersion: 3,
    goals: [
      normalizedGoal({ id: 'oct', title: 'Октябрь', periodKey: '2026-10' }),
      normalizedGoal({ id: 'nov', title: 'Ноябрь', periodKey: '2026-11' })
    ]
  }, { month: '2026-10' });

  assert.match(page.latestGoalCard().innerHTML, /Октябрь/);
  assert.equal(page.window.selectGoalPeriod('month', '2026-11'), true);
  assert.deepEqual(page.getSelection(), { month: '2026-11' });
  assert.match(page.latestGoalCard().innerHTML, /Ноябрь/);
  assert.equal(page.selectionWrites.length, 1);
});

test('стрелки и сегодня используют один сохранённый selection state', () => {
  const page = loadGoalsPage({ schemaVersion: 3, goals: [] }, { month: '2026-11' });

  assert.equal(page.window.shiftGoalPeriod('month', 1), true);
  assert.equal(page.getSelection().month, '2026-12');
  assert.equal(page.window.resetGoalPeriod('month'), true);
  assert.equal(page.getSelection().month, '2026-10');
});

test('месяц годового блока раскрывает месячный горизонт и выбирает его период', () => {
  const page = loadGoalsPage({ schemaVersion: 3, goals: [] }, { year: '2027' });

  assert.equal(page.window.selectGoalMonth(1), true);
  assert.equal(page.getSelection().month, '2027-02');
  assert.match(page.nodes.get('monthsGrid').innerHTML, /<button/);
});

test('годовой блок считает цели только выбранного года', () => {
  const page = loadGoalsPage({
    schemaVersion: 3,
    goals: [
      normalizedGoal({ id: 'year-2026', horizon: 'year', periodKey: '2026', done: false }),
      normalizedGoal({ id: 'year-2027', horizon: 'year', periodKey: '2027', done: true })
    ]
  }, { year: '2027' });

  assert.equal(page.nodes.get('yearStatusText').textContent, '2027 год');
  assert.equal(page.nodes.get('goalsProgressLabel').textContent, '1 из 1 целей выполнено');
});
