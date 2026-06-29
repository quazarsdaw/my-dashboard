const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

function read(file) {
  return fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
}

test('custom sphere names are escaped in dashboard and profile HTML renderers', () => {
  const indexHtml = read('index.html');
  const profileHtml = read('profile.html');

  assert.ok(!indexHtml.includes("'<span class=\"radar-item-name\">' + s.name + '</span>'"));
  assert.ok(indexHtml.includes("'<span class=\"radar-item-name\">' + G.esc(s.name) + '</span>'"));
  assert.ok(!profileHtml.includes("'<div class=\"sphere-name-row\"><span class=\"sphere-name\">' + s.name + '</span>"));
  assert.ok(profileHtml.includes("'<div class=\"sphere-name-row\"><span class=\"sphere-name\">' + G.esc(s.name) + '</span>"));
});

test('profile history renderers escape synced text fields', () => {
  const profileHtml = read('profile.html');

  assert.ok(!profileHtml.includes("'<div class=\"coin-reason\">' + (h.reason || '') + '</div>'"));
  assert.ok(profileHtml.includes("'<div class=\"coin-reason\">' + G.esc(h.reason || '') + '</div>'"));
});

test('gym and finance renderers escape user controlled text and validate wishlist links', () => {
  const gymHtml = read('gym.html');
  const financeHtml = read('finance.html');

  assert.ok(!gymHtml.includes("'<div class=\"wdh-muscles\">'+day.muscles+'</div>'"));
  assert.ok(gymHtml.includes("'<div class=\"wdh-muscles\">'+G.esc(day.muscles)+'</div>'"));
  assert.ok(!financeHtml.includes("href=\"'+G.esc(w.link)+'\""));
  assert.ok(financeHtml.includes('safeUrl(w.link)'));
});

test('profile backup import only accepts application-owned storage keys', () => {
  const profileHtml = read('profile.html');

  assert.ok(profileHtml.includes('function isAppStorageKey(key)'));
  assert.ok(profileHtml.includes('keys.filter(isAppStorageKey)'));
  assert.ok(!profileHtml.includes('keys.forEach(function (key) {\n          localStorage.setItem(key, data[key]);'));
  assert.ok(profileHtml.includes("key.indexOf('openrouter_') === 0"));
  assert.ok(profileHtml.includes("key.indexOf('sb-') === 0"));
});
