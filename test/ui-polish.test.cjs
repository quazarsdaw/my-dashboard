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

test('sphere list opens a colorful enlarged sphere view before editing', () => {
  const html = read('index.html');

  assert.ok(html.includes('sphereFocusOverlay'));
  assert.ok(html.includes('function openSphereFocus(id)'));
  assert.ok(html.includes('class="sphere-focus-art"'));
  assert.ok(html.includes('openSphereFocus(s.id)'));
  assert.ok(html.includes('sphereFocusEdit'));
});
