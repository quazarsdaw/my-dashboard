const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

function read(file) {
  return fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
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
  assert.ok(topbar.includes('justify-content: center'));
  assert.ok(topbar.includes('min-width: 64px'));
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
