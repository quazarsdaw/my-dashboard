// Только отдельный browser context, синтетический путь и локальные модули.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { chromium } = require('playwright');
const P = require('../path-core.js');
const origin = process.argv[2] || 'http://127.0.0.1:8766';
const output = process.argv[3] || '/private/tmp/dashboard-dioramas';

async function run() {
  fs.mkdirSync(output, { recursive: true });
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const context = await browser.newContext({
      viewport: { width: 1440, height: 1000 },
      reducedMotion: 'reduce',
    });
    await context.route('**/cdn.jsdelivr.net/**', (route) => route.abort());
    const page = await context.newPage(),
      errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    const cases = [
      ['calm', 'hoodie', 'Спокойствие и свой ритм'],
      ['work', 'smart', 'Моё рабочее пространство'],
      ['graduate', 'coat', 'Место для новых знаний'],
      ['fitness', 'sport', 'Движение каждый день'],
      ['creative', 'casual', 'Время создавать'],
    ];
    await page.goto(origin + '/path.html');
    for (const [scene, outfit, title] of cases) {
      const fixture = P.upsertStage(P.createPath('2026-10-23T12:00:00Z'), {
        id: 'b',
        title,
        description: 'Демонстрация оформления, не данные аккаунта.',
        criteria: [],
        visual: { energy: 90, outfit, scene, setting: 2 },
      });
      await page.evaluate((value) => {
        localStorage.setItem('identity_path_v1', JSON.stringify(value));
        dispatchEvent(new Event('dashboard-sync-applied'));
      }, fixture);
      await page.getByRole('heading', { name: title, exact: true }).waitFor();
      await page.locator('#scene canvas').waitFor();
      await page.waitForFunction(
        () =>
          document.querySelector('#scene canvas')?.width > 0 &&
          document.getElementById('sceneFallback').hidden,
      );
      await page
        .locator('.world')
        .screenshot({ path: output + '/' + scene + '.png' });
      await page.locator('#compare').fill('0');
      const before = await page.locator('#scene').screenshot();
      await page.locator('#compare').fill('100');
      const after = await page.locator('#scene').screenshot();
      assert.equal(
        before.equals(after),
        false,
        'сравнение меняет отрисованную сцену ' + scene,
      );
    }
    const sceneBox = await page.locator('#scene').boundingBox();
    await page.mouse.move(
      sceneBox.x + sceneBox.width / 2,
      sceneBox.y + sceneBox.height / 2,
    );
    await page.mouse.down();
    await page.mouse.move(
      sceneBox.x + sceneBox.width / 2 + 80,
      sceneBox.y + sceneBox.height / 2,
      { steps: 8 },
    );
    await page.mouse.up();
    await page.locator('#resetCamera').click();
    await page.setViewportSize({ width: 768, height: 1024 });
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      true,
    );
    await page.locator('.world').screenshot({ path: output + '/tablet.png' });
    assert.deepEqual(errors, []);
    await context.close();
    console.log(
      'готово: пять окружений и силуэтов, сравнение, поворот и сброс камеры, tablet без переполнения',
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
