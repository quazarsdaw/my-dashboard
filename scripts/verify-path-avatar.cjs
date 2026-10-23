// Изолированный chrome и синтетические данные, без аккаунта и облачных writes.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { chromium } = require('playwright');
const P = require('../path-core.js');
const origin = process.argv[2] || 'http://127.0.0.1:8766';
const output = process.argv[3] || '/private/tmp/dashboard-avatar';
const fixture = P.upsertStage(P.createPath('2026-10-24T12:00:00Z'), {
  id: 'b',
  title: 'Мой новый ритм',
  description: '',
  criteria: [],
  visual: { energy: 85, outfit: 'hoodie', scene: 'work', setting: 2 },
});
async function setup(browser, options = {}) {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    reducedMotion: 'reduce',
    ...options,
  });
  await context.route('**/cdn.jsdelivr.net/**', (r) => r.abort());
  await context.addInitScript((value) => {
    if (!localStorage.getItem('identity_path_v1'))
      localStorage.setItem('identity_path_v1', JSON.stringify(value));
  }, fixture);
  return context;
}
const read = (page) =>
  page.evaluate(() => JSON.parse(localStorage.getItem('identity_path_v1')));
const open = async (page) => {
  try {
    await page.locator('#editAvatar').click({ timeout: 15000 });
  } catch (err) {
    console.error(
      'состояние перед открытием:',
      await page.locator('#notice').textContent(),
      'контент:',
      await page.locator('#pathContent').isVisible(),
    );
    throw err;
  }
};
async function run() {
  fs.mkdirSync(output, { recursive: true });
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const context = await setup(browser),
      page = await context.newPage(),
      errors = [];
    page.setDefaultTimeout(5000);
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(origin + '/path.html');
    const before = await read(page);
    await open(page);
    await page.locator('#avatarHairStyle').selectOption('curls');
    await page.locator('#avatarPreview canvas').waitFor();
    const first = await page.locator('#avatarPreview').screenshot();
    await page.locator('#avatarFacialHair').selectOption('beard');
    await page.locator('#avatarGlasses').selectOption('round');
    await page.locator('#avatarFaceShape').selectOption('angular');
    await page.locator('#avatarBodyType').selectOption('broad');
    await page.locator('#avatarExpression').selectOption('confident');
    await page.locator('#avatarTopAuto').uncheck();
    await page.locator('#avatarTopColor').fill('#c06542');
    const second = await page.locator('#avatarPreview').screenshot();
    assert.equal(first.equals(second), false, 'живое превью меняется');
    assert.deepEqual(await read(page), before, 'превью не пишет данные');
    await page.locator('.avatar-fields').evaluate((node) => {
      node.scrollTop = 0;
    });
    await page
      .locator('#avatarDialog')
      .screenshot({ path: output + '/editor-desktop.png' });
    await page.locator('#cancelAvatar').click();
    assert.deepEqual(await read(page), before);
    await page.locator('#avatarPreview canvas').waitFor({ state: 'detached' });
    assert.equal(await page.locator('#avatarPreview canvas').count(), 0);
    await open(page);
    assert.equal(await page.locator('#avatarHairStyle').inputValue(), 'swept');
    await page.locator('#avatarHairStyle').selectOption('short');
    await page.keyboard.press('Escape');
    assert.deepEqual(await read(page), before);
    await open(page);
    await page.locator('#avatarHairStyle').selectOption('curls');
    await page.locator('#avatarFacialHair').selectOption('stubble');
    await page.locator('#avatarGlasses').selectOption('square');
    await page.locator('#avatarExpression').selectOption('confident');
    await page.locator('#avatarTopAuto').uncheck();
    await page.locator('#avatarTopColor').fill('#c06542');
    await page.locator('#saveAvatar').click();
    const saved = await read(page);
    assert.equal(saved.revision, before.revision + 1, 'ровно одна запись');
    assert.equal(saved.avatar.hairStyle, 'curls');
    assert.equal(saved.avatar.topColor, '#c06542');
    assert.deepEqual(saved.stages[0].snapshot, before.stages[0].snapshot);
    await page.reload();
    await open(page);
    assert.equal(await page.locator('#avatarHairStyle').inputValue(), 'curls');
    assert.equal(await page.locator('#avatarTopColor').inputValue(), '#c06542');
    await page.locator('#avatarHairStyle').selectOption('bald');
    await page.evaluate(() => {
      const p = JSON.parse(localStorage.getItem('identity_path_v1'));
      p.revision++;
      localStorage.setItem('identity_path_v1', JSON.stringify(p));
      dispatchEvent(new Event('dashboard-sync-applied'));
    });
    await page.locator('#saveAvatar').click();
    assert.match(
      await page.locator('#avatarError').innerText(),
      /Путь изменился/,
    );
    assert.equal(await page.locator('#avatarHairStyle').inputValue(), 'bald');
    assert.equal((await read(page)).avatar.hairStyle, 'curls');
    await page.locator('#cancelAvatar').click();
    await open(page);
    await page.locator('#avatarHairStyle').selectOption('short');
    await page.evaluate(() => {
      window.avatarTestSetItem = Storage.prototype.setItem;
      Storage.prototype.setItem = function (key, value) {
        if (key === 'identity_path_v1')
          throw new DOMException('quota', 'QuotaExceededError');
        return window.avatarTestSetItem.call(this, key, value);
      };
    });
    await page.locator('#saveAvatar').click();
    assert.equal(await page.locator('#avatarDialog').isVisible(), true);
    assert.equal(await page.locator('#avatarHairStyle').inputValue(), 'short');
    assert.equal((await read(page)).avatar.hairStyle, 'curls');
    await page.evaluate(() => {
      Storage.prototype.setItem = window.avatarTestSetItem;
    });
    await page.locator('#cancelAvatar').click();
    await page.setViewportSize({ width: 390, height: 844 });
    await open(page);
    await page.locator('#avatarPreview canvas').waitFor();
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      true,
    );
    await page
      .locator('#avatarDialog')
      .screenshot({ path: output + '/editor-mobile.png' });
    await page.locator('#avatarHairStyle').scrollIntoViewIfNeeded();
    await page
      .locator('#avatarDialog')
      .screenshot({ path: output + '/editor-mobile-details.png' });
    await page.locator('#cancelAvatar').click();
    await page.screenshot({
      path: output + '/path-mobile.png',
      fullPage: true,
    });
    assert.deepEqual(errors, []);
    await context.close();
    const fallback = await setup(browser),
      f = await fallback.newPage();
    await f.addInitScript(() => {
      HTMLCanvasElement.prototype.getContext = function () {
        return null;
      };
    });
    await f.goto(origin + '/path.html');
    await open(f);
    await f
      .getByText('3D-превью недоступно. Настройки можно сохранить.', {
        exact: true,
      })
      .waitFor();
    await f.locator('#avatarHairStyle').selectOption('bald');
    await f.locator('#saveAvatar').click();
    assert.equal((await read(f)).avatar.hairStyle, 'bald');
    await fallback.close();
    const delayed = await setup(browser),
      d = await delayed.newPage();
    let release;
    const gate = new Promise((resolve) => {
      release = resolve;
    });
    await d.route('**/path-avatar-preview.js*', async (route) => {
      await gate;
      await route.continue();
    });
    await d.goto(origin + '/path.html');
    await open(d);
    await d.locator('#cancelAvatar').click();
    release();
    await d.waitForResponse((r) => r.url().includes('path-avatar-preview.js'));
    await open(d);
    await d.locator('#avatarPreview canvas').waitFor();
    assert.equal(await d.locator('#avatarPreview canvas').count(), 1);
    await d.locator('#cancelAvatar').click();
    await d.locator('#avatarPreview canvas').waitFor({ state: 'detached' });
    assert.equal(await d.locator('#avatarPreview canvas').count(), 0);
    await delayed.close();
    console.log(
      'готово: живое превью без записи, отмена/escape, save/reload, snapshot, stale/quota, mobile, webgl fallback, закрытие во время import',
    );
    console.log('screenshots: ' + output);
  } finally {
    await browser.close();
  }
}
run().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
