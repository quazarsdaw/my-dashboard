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
    this.ondragstart = null;
    this.ondragover = null;
    this.ondragleave = null;
    this.ondrop = null;
    this.ondragend = null;
    this.draggable = false;
    this.open = false;
    this.focusCount = 0;
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

  focus() { this.focusCount += 1; }
  showModal() { this.open = true; }
  close() { this.open = false; }
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
  const dataWrites = [];
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
        if (key === 'horizons_goals_v2') {
          storedData = clone(value);
          dataWrites.push(clone(value));
        }
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
    dataWrites,
    window,
    getData() { return clone(storedData); },
    getSelection() { return clone(storedSelection); },
    latestGoalCard() {
      return created.filter((element) => element.classList.contains('goal-card')).at(-1) || null;
    },
    goalCards() {
      return created.filter((element) => element.classList.contains('goal-card'));
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

test('карточки показывают приоритет сортируют активные и отделяют выполненные', () => {
  const page = loadGoalsPage({
    schemaVersion: 3,
    goals: [
      normalizedGoal({ id: 'done', title: 'Готово', priority: 'p1', order: 50, done: true }),
      normalizedGoal({ id: 'p4', title: 'Зелёная', priority: 'p4', order: 100 }),
      normalizedGoal({ id: 'p1-second', title: 'Красная вторая', priority: 'p1', order: 200 }),
      normalizedGoal({ id: 'p1-first', title: 'Красная первая', priority: 'p1', order: 100 })
    ]
  }, { month: '2026-10' });
  const cards = page.goalCards();

  assert.match(cards[0].innerHTML, /Красная первая/);
  assert.match(cards[1].innerHTML, /Красная вторая/);
  assert.match(cards[2].innerHTML, /Зелёная/);
  assert.match(cards[3].innerHTML, /Готово/);
  assert.match(cards[0].innerHTML, /priority-flag/);
  assert.match(cards[0].innerHTML, />P1</);
  assert.equal(cards[3].classList.contains('completed'), true);
});

test('стили приоритета используют флаг и затухающий фон отдельно от прогресса', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'goals.html'), 'utf8');

  assert.match(html, /\.priority-flag/);
  assert.match(html, /\.goal-card\.priority-p1/);
  assert.match(html, /\.goal-card\.priority-p4/);
  assert.match(html, /\.completed-group-label/);
  assert.doesNotMatch(html, /goal-card[^}]*border-left\s*:/);
});

test('активные карточки доступны для drag и переноса, а выполненные заблокированы', () => {
  const page = loadGoalsPage({
    schemaVersion: 3,
    goals: [
      normalizedGoal({ id: 'active', title: 'Активная', priority: 'p1' }),
      normalizedGoal({ id: 'done', title: 'Готовая', priority: 'p1', order: 200, done: true })
    ]
  }, { month: '2026-10' });
  const cards = page.goalCards();

  assert.equal(cards[0].draggable, true);
  assert.equal(typeof cards[0].ondragstart, 'function');
  assert.match(cards[0].innerHTML, /Перенести/);
  assert.equal(cards[1].draggable, false);
  assert.doesNotMatch(cards[1].innerHTML, /Перенести/);
  assert.equal(page.window.openGoalMoveDialog('done', cards[1]), false);
  assert.equal(page.dataWrites.length, 0);
});

test('доступный диалог переносит активную цель в далёкий прошлый период одной записью', () => {
  const page = loadGoalsPage({
    schemaVersion: 3,
    goals: [normalizedGoal({ id: 'moving', title: 'Переезд' })]
  }, { month: '2026-10' });
  const trigger = page.goalCards()[0];

  assert.equal(page.window.openGoalMoveDialog('moving', trigger), true);
  assert.equal(page.nodes.get('moveDialog').open, true);
  page.nodes.get('movePeriod').value = '2025-03';
  page.nodes.get('movePriority').value = 'p2';
  page.nodes.get('confirmMoveBtn').onclick();

  const moved = page.getData().goals[0];
  assert.deepEqual([moved.periodKey, moved.priority, moved.order], ['2025-03', 'p2', 100]);
  assert.equal(page.dataWrites.length, 1);
  assert.match(page.nodes.get('goalsLive').textContent, /Переезд/);
  assert.match(page.nodes.get('goalsLive').textContent, /Март 2025/);
  assert.equal(page.nodes.get('moveDialog').open, false);
  assert.equal(trigger.focusCount, 1);
});

test('отмена диалога не записывает данные и возвращает фокус', () => {
  const page = loadGoalsPage({
    schemaVersion: 3,
    goals: [normalizedGoal({ id: 'moving', title: 'Не двигать' })]
  }, { month: '2026-10' });
  const trigger = page.goalCards()[0];

  page.window.openGoalMoveDialog('moving', trigger);
  page.nodes.get('cancelMoveBtn').onclick();

  assert.equal(page.dataWrites.length, 0);
  assert.equal(page.nodes.get('moveDialog').open, false);
  assert.equal(trigger.focusCount, 1);
});

test('drag-and-drop меняет ручной порядок только внутри одной priority-группы', () => {
  const page = loadGoalsPage({
    schemaVersion: 3,
    goals: [
      normalizedGoal({ id: 'first', title: 'Первая', priority: 'p1', order: 100 }),
      normalizedGoal({ id: 'second', title: 'Вторая', priority: 'p1', order: 200 }),
      normalizedGoal({ id: 'other', title: 'Другая', priority: 'p2', order: 777 })
    ]
  }, { month: '2026-10' });
  const event = {
    preventDefault() {},
    dataTransfer: { effectAllowed: '', dropEffect: '', setData() {} }
  };

  assert.equal(page.window.startGoalDrag(event, 'second'), true);
  assert.equal(page.window.dropGoalBefore(event, 'first'), true);

  assert.deepEqual(page.getData().goals.map((goal) => [goal.id, goal.order]), [
    ['first', 200],
    ['second', 100],
    ['other', 777]
  ]);
  assert.equal(page.dataWrites.length, 1);
});

test('drop в соседний период использует тот же command path', () => {
  const page = loadGoalsPage({
    schemaVersion: 3,
    goals: [normalizedGoal({ id: 'moving', title: 'На ноябрь', priority: 'p4' })]
  }, { month: '2026-10' });
  const event = {
    preventDefault() {},
    dataTransfer: { effectAllowed: '', dropEffect: '', setData() {} }
  };

  page.window.startGoalDrag(event, 'moving');
  assert.equal(page.window.dropGoalInAdjacentPeriod(event, 'month', 1), true);

  assert.equal(page.getData().goals[0].periodKey, '2026-11');
  assert.equal(page.getData().goals[0].priority, 'p4');
  assert.equal(page.dataWrites.length, 1);
});

test('разметка переноса использует native dialog, aria-live и preview drop-зон', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'goals.html'), 'utf8');

  assert.match(html, /<dialog[^>]+id="moveDialog"/);
  assert.match(html, /id="goalsLive"[^>]+aria-live="polite"/);
  assert.match(html, /period-drop-zone/);
  assert.match(html, /goal-card\.dragging/);
  assert.match(html, /goal-card\.drop-before/);
});
