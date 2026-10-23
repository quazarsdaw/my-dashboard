// Запуск: NODE_PATH=<путь к playwright> node scripts/verify-path.cjs [origin] [output].
// Только изолированный browser context и синтетические данные; облако не используется.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { chromium } = require('playwright');
const origin = process.argv[2] || 'http://127.0.0.1:8766';
const output = process.argv[3] || '/private/tmp/my-dashboard-path-check';
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
    await page.goto(origin + '/path.html');
    await page
      .getByRole('button', { name: 'Создать мой путь', exact: true })
      .waitFor();
    assert.equal(
      await page.evaluate(() => localStorage.getItem('identity_path_v1')),
      null,
    );
    await page.screenshot({
      path: output + '/empty-desktop.png',
      fullPage: true,
    });
    await page
      .getByRole('button', { name: 'Создать мой путь', exact: true })
      .click();
    await page
      .locator('#stageDetail h2')
      .filter({ hasText: 'я сейчас' })
      .waitFor();
    await page.evaluate(() => {
      Gamification.storeSet('horizons_goals_v2', {
        schemaVersion: 3,
        goals: [
          {
            id: 'income',
            title: 'Доход 100 000 ₽',
            type: 'number',
            target: 100000,
            current: 100000,
            done: true,
            horizon: 'month',
            periodKey: '2026-10',
            priority: 'p2',
            order: 100,
          },
        ],
      });
      Gamification.storeSet('tracker_v1', {
        good: [{ id: 'sleep', name: 'Стабильный сон' }],
        bad: [],
        marks: {},
      });
    });
    async function addManual(title, scene = 'calm', outfit = 'hoodie') {
      await page.locator('#addStage').click();
      await page.locator('#stageTitle').fill(title);
      await page
        .locator('#stageDescription')
        .fill(
          'Собраннее, спокойнее и увереннее. Время на то, что для меня важно.',
        );
      await page.locator('#stageScene').selectOption(scene);
      await page.locator('#stageOutfit').selectOption(outfit);
      await page.locator('#stageSetting').selectOption('1');
      await page.locator('#addCriterion').click();
      await page
        .getByLabel('Что подтверждаю')
        .fill('Я выполнил условия этой версии');
      await page
        .getByRole('button', { name: 'Сохранить ступень', exact: true })
        .click();
      await page.locator('#stageDialog').waitFor({ state: 'hidden' });
    }
    await addManual('Стабильный режим');
    await page.locator('#addStage').click();
    await page.locator('#stageTitle').fill('Финансовая опора');
    await page
      .locator('#stageDescription')
      .fill(
        'Стабильный доход 100 000 ₽. Спокойное рабочее место и уверенность в завтрашнем дне.',
      );
    await page.locator('#stageEnergy').fill('85');
    await page.locator('#stageOutfit').selectOption('smart');
    await page.locator('#stageScene').selectOption('work');
    await page.locator('#stageSetting').selectOption('2');
    await page.locator('#addCriterion').click();
    await page.getByLabel('Тип условия').selectOption('goal');
    await page.getByLabel('Существующая цель').selectOption('income');
    await page
      .getByRole('button', { name: 'Сохранить ступень', exact: true })
      .click();
    await page.locator('#stageDialog').waitFor({ state: 'hidden' });
    assert.equal(await page.locator('.accept-button').isDisabled(), true);
    assert.match(
      await page.locator('#stageDetail').innerText(),
      /Готова заранее/,
    );
    await addManual('Университет завершён', 'graduate', 'coat');
    await page.locator('#addStage').click();
    await page.locator('#stageTitle').fill('Моя большая версия');
    await page.locator('#stageDestination').check();
    await page.locator('#stageEnergy').fill('95');
    await page.locator('#stageScene').selectOption('creative');
    await page.locator('#stageSetting').selectOption('2');
    await page.locator('#addCriterion').click();
    await page.getByLabel('Что подтверждаю').fill('Я живу так, как выбрал');
    await page
      .getByRole('button', { name: 'Сохранить ступень', exact: true })
      .click();
    await page.locator('#stageDialog').waitFor({ state: 'hidden' });
    assert.match(
      await page.locator('#stageNav .stage-stop').last().innerText(),
      /^Я/,
    );
    await page.getByRole('button', { name: /Б Стабильный режим/ }).click();
    assert.equal(await page.locator('.accept-button').isDisabled(), true);
    await page
      .getByRole('checkbox', { name: 'Я выполнил условия этой версии' })
      .check();
    await page.locator('.accept-button').waitFor({ state: 'visible' });
    assert.equal(await page.locator('.accept-button').isEnabled(), true);
    await page.locator('.accept-button').click();
    await page.getByRole('button', { name: 'Отмена', exact: true }).click();
    assert.equal(
      await page.evaluate(
        () =>
          JSON.parse(localStorage.getItem('identity_path_v1')).stages[1]
            .acceptedAt,
      ),
      undefined,
    );
    await page.locator('.accept-button').click();
    await page
      .getByRole('button', { name: 'Принять версию', exact: true })
      .click();
    await page
      .locator('#stageDetail .history-label')
      .waitFor({ state: 'visible' });
    const snapshot = await page.evaluate(
      () =>
        JSON.parse(localStorage.getItem('identity_path_v1')).stages[1].snapshot,
    );
    await page.reload();
    await page.getByRole('button', { name: /В Финансовая опора/ }).click();
    assert.deepEqual(
      await page.evaluate(
        () =>
          JSON.parse(localStorage.getItem('identity_path_v1')).stages[2].visual,
      ),
      {
        energy: 85,
        outfit: 'smart',
        scene: 'work',
        setting: 2,
      },
      'одежда и обустройство пережили reload',
    );
    assert.equal(await page.locator('.accept-button').isEnabled(), true);
    await page.locator('#scene canvas').waitFor();
    await page.waitForFunction(
      () =>
        document.querySelector('#scene canvas')?.width > 0 &&
        document.getElementById('sceneFallback').hidden,
    );
    await page.evaluate(() => scrollTo(0, 0));
    await page.screenshot({ path: output + '/desktop.png', fullPage: true });
    await page.locator('#compare').fill('0');
    await page.screenshot({ path: output + '/comparison.png', fullPage: true });
    await page.locator('#compare').fill('100');
    const before = await page.evaluate(
      () => JSON.parse(localStorage.getItem('identity_path_v1')).stages[2],
    );
    await page
      .getByRole('button', { name: 'Редактировать', exact: true })
      .click();
    assert.equal(await page.locator('#stageSetting').inputValue(), '2');
    await page.locator('#stageTitle').fill('Сохранённый черновик');
    await page.evaluate(() => {
      const p = JSON.parse(localStorage.getItem('identity_path_v1'));
      p.revision++;
      localStorage.setItem('identity_path_v1', JSON.stringify(p));
      window.dispatchEvent(new Event('dashboard-sync-applied'));
    });
    await page
      .getByRole('button', { name: 'Сохранить ступень', exact: true })
      .click();
    assert.match(
      await page.locator('#editorError').innerText(),
      /Черновик сохранён/,
    );
    assert.equal(
      await page.locator('#stageTitle').inputValue(),
      'Сохранённый черновик',
    );
    assert.equal(
      await page.evaluate(
        () =>
          JSON.parse(localStorage.getItem('identity_path_v1')).stages[2].title,
      ),
      before.title,
    );
    await page.locator('#cancelEditor').click();
    assert.deepEqual(
      await page.evaluate(
        () =>
          JSON.parse(localStorage.getItem('identity_path_v1')).stages[1]
            .snapshot,
      ),
      snapshot,
    );
    await page.setViewportSize({ width: 390, height: 844 });
    await page.evaluate(() => scrollTo(0, 0));
    await page.screenshot({ path: output + '/mobile.png', fullPage: true });
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      true,
      'нет горизонтального скролла страницы',
    );
    await page.locator('#addStage').click();
    await page.screenshot({
      path: output + '/mobile-editor.png',
      fullPage: true,
    });
    await page.locator('#cancelEditor').click();
    await page.locator('.accept-button').click();
    await page
      .getByRole('button', { name: 'Принять версию', exact: true })
      .click();
    await page.evaluate(() =>
      Gamification.storeSet('horizons_goals_v2', { goals: [] }),
    );
    assert.match(
      await page.locator('#stageDetail').innerText(),
      /Доход 100 000 ₽/,
    );
    await page.goto(origin + '/goals.html');
    assert.equal(await page.getByRole('link', { name: /Мой путь/ }).count(), 1);
    await page.goto(origin + '/profile.html');
    assert.equal(await page.getByRole('link', { name: /Мой путь/ }).count(), 1);
    assert.deepEqual(errors, [], 'нет необработанных browser ошибок');
    await context.close();
    const fallback = await browser.newContext({
      viewport: { width: 390, height: 844 },
    });
    await fallback.route('**/cdn.jsdelivr.net/**', (route) => route.abort());
    const p = await fallback.newPage();
    await p.addInitScript(() => {
      HTMLCanvasElement.prototype.getContext = function () {
        return null;
      };
    });
    await p.goto(origin + '/path.html');
    await p
      .getByRole('button', { name: 'Создать мой путь', exact: true })
      .click();
    await p
      .getByText(
        '3D недоступен в этом браузере. Все ступени и условия доступны ниже.',
        { exact: true },
      )
      .waitFor();
    await p.locator('#addStage').click();
    await p.locator('#stageTitle').fill('Без 3D');
    await p
      .getByRole('button', { name: 'Сохранить ступень', exact: true })
      .click();
    assert.equal(await p.locator('#stageDetail h2').innerText(), 'Без 3D');
    await fallback.close();
    console.log(
      'готово: создание, источники, готовность заранее, ручное принятие, история, reload, конфликт редактора, ссылки, desktop/mobile, webgl fallback',
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
