const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

function read(file) {
  return fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
}

function exists(file) {
  return fs.existsSync(path.join(__dirname, '..', file));
}

test('topbar uses a lighter grouped layout for balance, water and add controls', () => {
  const topbar = read('topbar.js');

  assert.ok(topbar.includes('.topbar-water-wrap'));
  assert.ok(topbar.includes('rgba(255,255,255,0.055)'));
  assert.ok(topbar.includes('width: 38px; height: 38px'));
  assert.ok(topbar.includes('aria-label="Добавить воду"'));
});

test('main page uses the shared polished topbar implementation', () => {
  const html = read('index.html');

  assert.ok(html.includes('<script src="topbar.js?v=401" defer></script>'));
  assert.ok(!html.includes('topbar_v405.js'));
});

test('sphere list opens a colorful enlarged sphere view before editing', () => {
  const html = read('index.html');

  assert.ok(html.includes('sphereFocusOverlay'));
  assert.ok(html.includes('function openSphereFocus(id)'));
  assert.ok(html.includes('class="sphere-focus-art"'));
  assert.ok(html.includes('openSphereFocus(s.id)'));
  assert.ok(html.includes('sphereFocusEdit'));
});

test('radar field opens an enlarged all-spheres overview while points stay clickable', () => {
  const html = read('index.html');

  assert.ok(html.includes('function openSphereOverview()'));
  assert.ok(html.includes('data-radar-overview="1"'));
  assert.ok(html.includes('openSphereOverview();'));
  assert.ok(html.includes('data-sphere-id='));
  assert.ok(html.includes('window.PointerEvent'));
  assert.ok(!html.includes("addEventListener('touchstart'"));
});

test('dashboard keeps radar labels inside the visible chart area', () => {
  const html = read('index.html');

  assert.ok(html.includes('viewBox="-44 -30 288 260"'));
  assert.ok(html.includes('function shortenRadarLabel(name)'));
  assert.ok(html.includes('function clampRadarLabelX(x, anchor)'));
  assert.ok(html.includes('textLength="58"'));
});

test('topbar and bottom navigation use balanced hit areas for short labels', () => {
  const topbar = read('topbar.js');

  assert.ok(topbar.includes('min-width: 104px'));
  assert.ok(topbar.includes('height: 38px; min-width: 122px'));
  assert.ok(topbar.includes('display: grid; grid-template-columns: repeat(6, minmax(0, 1fr));'));
  assert.ok(topbar.includes('class="bottombar-tab-shell"'));
  assert.ok(topbar.includes('.bottombar-tab-shell'));
  assert.ok(topbar.includes('width: min(112px, calc(100% - 8px))'));
  assert.ok(topbar.includes('class="bottombar-tab-label"'));
  assert.ok(topbar.includes('.bottombar-tab-label'));
  assert.ok(topbar.includes('min-width: 78px'));
});

test('day ring exposes an editable local sleep schedule with live preview', () => {
  const html = read('index.html');

  assert.ok(html.includes('sleepScheduleOverlay'));
  assert.ok(html.includes('function getSleepSchedule()'));
  assert.ok(html.includes('function setSleepSchedule(schedule)'));
  assert.ok(html.includes('id="sleepWakeInput"'));
  assert.ok(html.includes('id="sleepBedInput"'));
  assert.ok(html.includes('function updateSleepPreview()'));
  assert.ok(html.includes('id="ringRange"'));
});

test('sleep editor uses readable day timeline markers instead of clock hands', () => {
  const html = read('index.html');

  assert.ok(html.includes('class="sleep-day-preview"'));
  assert.ok(html.includes('id="sleepWakeMarker"'));
  assert.ok(html.includes('id="sleepBedMarker"'));
  assert.ok(html.includes('function setSleepMarker'));
  assert.ok(!html.includes('sleep-clock-hand'));
});

test('sleep editor has spacious desktop layout for the timeline and controls', () => {
  const html = read('index.html');

  assert.ok(html.includes('width: min(760px, calc(100vw - 48px))'));
  assert.ok(html.includes('grid-template-columns: 288px minmax(280px, 1fr)'));
  assert.ok(html.includes('.sleep-day-preview { width: 288px'));
  assert.ok(html.includes('.sleep-day-rail { position: relative; height: 150px'));
  assert.ok(html.includes('.sleep-schedule-actions { display: flex; gap: 16px; margin-top: 26px; }'));
});

test('today card offers a compact clear all action beside the streak', () => {
  const html = read('index.html');

  assert.ok(html.includes('class="gm-header-actions"'));
  assert.ok(html.includes('id="gmClearAllBtn"'));
  assert.ok(html.includes('удалить все'));
  assert.ok(html.includes('function clearTodayGoals()'));
  assert.ok(html.includes("confirm('удалить все задачи на сегодня?')"));
});

test('dashboard title can be edited and persisted locally', () => {
  const html = read('index.html');

  assert.ok(html.includes("DASHBOARD_TITLE_KEY = 'dashboard_title_v1'"));
  assert.ok(html.includes('id="dashboardTitle"'));
  assert.ok(html.includes('id="dashboardTitleInput"'));
  assert.ok(html.includes('id="dashboardTitleEdit"'));
  assert.ok(html.includes('function getDashboardTitle()'));
  assert.ok(html.includes('function setDashboardTitle(title)'));
  assert.ok(html.includes('function wireDashboardTitleEditor()'));
  assert.ok(html.includes('keys.indexOf(DASHBOARD_TITLE_KEY)'));
});

test('dashboard title draft survives refresh and flushes through sync', () => {
  const html = read('index.html');

  assert.ok(html.includes("input.addEventListener('input'"));
  assert.ok(html.includes("window.addEventListener('pagehide'"));
  assert.ok(html.includes('syncDashboardTitle'));
  assert.ok(html.includes('DashboardSync.forceSync(DASHBOARD_TITLE_KEY)'));
});

test('tracker sticky habit column masks the scroll gutter', () => {
  const html = read('tracker.html');

  assert.ok(html.includes('box-shadow:-16px 0 0 #1C1E24'));
});

test('tracker asks before deleting a habit', () => {
  const html = read('tracker.html');

  const confirmIndex = html.indexOf("confirm('Удалить привычку «' + habit.name + '»?')");
  const spliceIndex = html.indexOf('arr.splice(parseInt(btn.dataset.idx, 10), 1)');

  assert.ok(confirmIndex !== -1);
  assert.ok(spliceIndex !== -1);
  assert.ok(confirmIndex < spliceIndex);
});

test('tracker supports inline habit renaming without replacing its id', () => {
  const html = read('tracker.html');

  assert.ok(html.includes('class="habit-name-wrap"'));
  assert.ok(html.includes('class="habit-name-text"'));
  assert.ok(html.includes('class="habit-edit"'));
  assert.ok(html.includes('function startHabitNameEdit'));
  assert.ok(html.includes('habit.name = nextName'));
  assert.ok(html.includes('.habit-name-wrap{display:flex;align-items:center;min-width:0;width:100%}'));
  assert.ok(html.includes('width:22px;height:22px;flex:0 0 22px'));
  assert.ok(html.includes('.habit-edit{opacity:0.55}'));
  assert.ok(!html.includes('habit.id ='));
});

test('profile editor offers persisted gradient choices', () => {
  const html = read('profile.html');

  assert.ok(html.includes('id="gradientPicker"'));
  assert.ok(html.includes('window.ProfileTheme.list'));
  assert.ok(!html.includes('var PROFILE_GRADIENTS = ['));
  assert.ok(exists('profile-theme.js'));

  const shared = read('profile-theme.js');
  assert.ok(shared.includes('window.ProfileTheme'));
  assert.ok(shared.includes('function applyProfileTheme'));
  assert.ok(shared.includes('function applyProfileHero'));
  assert.ok(shared.includes('--app-theme-glow-primary'));
  assert.ok(shared.includes('--app-theme-chrome-border'));
  assert.ok(shared.includes('softGlowPrimary'));

  const gradientCount = (shared.match(/id: 'grad-/g) || []).length;
  assert.ok(gradientCount >= 15 && gradientCount <= 20);
  assert.ok(html.includes('function applyProfileGradient'));
  assert.ok(html.includes('gradientId'));
});

test('all primary pages load the soft profile theme before topbar', () => {
  const pages = [
    'index.html',
    'inbox.html',
    'tracker.html',
    'goals.html',
    'store.html',
    'profile.html',
    'health.html',
    'gym.html',
    'finance.html',
  ];

  pages.forEach((file) => {
    const html = read(file);
    const themeScript = '<script src="profile-theme.js?v=401"></script>';
    const topbarScript = '<script src="topbar.js?v=401" defer></script>';
    const themeIndex = html.indexOf(themeScript);
    const topbarIndex = html.indexOf(topbarScript);

    assert.ok(themeIndex !== -1, `${file} loads shared profile theme`);
    assert.ok(topbarIndex !== -1, `${file} loads topbar`);
    assert.ok(themeIndex < topbarIndex, `${file} loads theme before topbar`);
    assert.ok(html.includes('var(--app-theme-glow-primary'), `${file} keeps local glow with theme hook`);
    assert.ok(html.includes('var(--app-theme-glow-secondary'), `${file} keeps secondary glow with theme hook`);
  });
});

test('topbar uses soft theme variables without owning page background', () => {
  const topbar = read('topbar.js');

  assert.ok(topbar.includes('function applyStoredProfileTheme'));
  assert.ok(topbar.includes('window.ProfileTheme.applyStored'));
  assert.ok(topbar.includes('var(--app-theme-chrome-border'));
  assert.ok(topbar.includes('var(--app-theme-nav-active'));
  assert.ok(!topbar.includes('body::before'));
  assert.ok(!topbar.includes('--profile-hero-bg'));
});
