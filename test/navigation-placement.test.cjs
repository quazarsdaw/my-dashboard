const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

function read(file) {
  return fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
}

function renderBottomNavigation(pathname) {
  const source = read('topbar.js');
  const links = [];
  let domReady = null;

  const document = {
    readyState: 'loading',
    head: { appendChild() {} },
    body: {
      classList: { add() {} },
      insertAdjacentHTML(position, html) {
        if (position !== 'beforeend') return;
        for (const match of html.matchAll(/<a href="([^"]+)" class="bottombar-tab" data-page="([^"]+)"/g)) {
          const classes = new Set();
          links.push({
            href: match[1],
            page: match[2],
            classList: { add(name) { classes.add(name); } },
            getAttribute(name) { return name === 'data-page' ? match[2] : null; },
            isActive() { return classes.has('active'); }
          });
        }
      }
    },
    addEventListener(type, handler) {
      if (type === 'DOMContentLoaded') domReady = handler;
    },
    createElement() {
      return { textContent: '' };
    },
    getElementById() {
      return null;
    },
    querySelectorAll(selector) {
      return selector === '.bottombar-tab' ? links : [];
    }
  };
  const window = {
    location: { pathname },
    addEventListener() {}
  };
  window.self = window;
  window.top = window;

  vm.runInNewContext(source, {
    window,
    document,
    localStorage: { getItem() { return null; }, setItem() {} },
    setInterval() {},
    setTimeout() {},
    clearTimeout() {},
    Date,
    Math,
    JSON
  });
  domReady();
  return links;
}

function extractFunction(source, name) {
  const start = source.indexOf('function ' + name + '(');
  assert.notEqual(start, -1, 'функция ' + name + ' найдена');
  const bodyStart = source.indexOf('{', start);
  let depth = 0;
  for (let index = bodyStart; index < source.length; index += 1) {
    if (source[index] === '{') depth += 1;
    if (source[index] === '}') depth -= 1;
    if (depth === 0) return source.slice(start, index + 1);
  }
  throw new Error('не удалось извлечь функцию ' + name);
}

function renderProfileCards() {
  const html = read('profile.html');
  const source = html.match(/<script>([\s\S]*?)<\/script>/)?.[1] || '';
  const renderStats = extractFunction(source, 'renderStats');
  const grid = {
    children: [],
    innerHTML: '',
    appendChild(child) {
      this.children.push(child);
    }
  };
  const document = {
    createElement(tagName) {
      return { tagName, href: '', className: '', innerHTML: '' };
    },
    getElementById(id) {
      return id === 'statsGrid' ? grid : null;
    }
  };
  const G = {
    ACHIEVEMENT_DEFS: [],
    getTotalStats() { return { totalTasks: 0, totalMinutes: 0, totalDays: 0 }; },
    getCoins() { return { earned: 0, spent: 0, balance: 0 }; },
    getAchievements() { return { unlocked: {} }; },
    getActivityLog() { return []; }
  };

  vm.runInNewContext(renderStats + '\nrenderStats();', {
    document,
    G,
    Object,
    pluralMinutes() { return '0 мин'; },
    pluralDays() { return '0 дней'; },
    formatNum(value) { return String(value); }
  });
  return grid.children;
}

test('нижняя навигация содержит только пять основных разделов', () => {
  const links = renderBottomNavigation('/index.html');

  assert.deepEqual(
    links.map((link) => link.page),
    ['main', 'inbox', 'tracker', 'goals', 'profile']
  );
});

test('вложенные разделы школы, меню и магазина подсвечивают профиль', () => {
  for (const pathname of ['/school.html', '/menu.html', '/store.html']) {
    const links = renderBottomNavigation(pathname);
    const active = links.filter((link) => link.isActive()).map((link) => link.page);
    assert.deepEqual(active, ['profile'], pathname);
  }
});

test('профиль показывает школу, меню и магазин вторым рядом основных плиток', () => {
  const links = renderProfileCards().filter((card) => card.tagName === 'a');

  assert.deepEqual(
    links.slice(0, 6).map((card) => ({ href: card.href, html: card.innerHTML })),
    [
      { href: 'health.html', html: '<div class="stat-value">💧</div><div class="stat-label">Здоровье</div>' },
      { href: 'gym.html', html: '<div class="stat-value">💪</div><div class="stat-label">Спорт</div>' },
      { href: 'finance.html', html: '<div class="stat-value">💳</div><div class="stat-label">Финансы</div>' },
      { href: 'school.html', html: '<div class="stat-value">🎓</div><div class="stat-label">Школа</div>' },
      { href: 'menu.html', html: '<div class="stat-value">🍽️</div><div class="stat-label">Меню</div>' },
      { href: 'store.html', html: '<div class="stat-value">🏪</div><div class="stat-label">Магазин</div>' }
    ]
  );
});

test('все основные страницы загружают одну новую версию общей навигации', () => {
  const pages = [
    'index.html',
    'inbox.html',
    'tracker.html',
    'school.html',
    'menu.html',
    'goals.html',
    'store.html',
    'profile.html',
    'health.html',
    'gym.html',
    'finance.html'
  ];

  for (const page of pages) {
    assert.match(read(page), /<script src="topbar\.js\?v=404" defer><\/script>/, page);
  }
});
