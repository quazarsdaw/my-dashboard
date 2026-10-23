const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const P = require('../path-core.js');
const origin = process.argv[2] || 'http://127.0.0.1:8766';
function pathWith(criteria) {
  return P.upsertStage(P.createPath(), {
    id: 'b',
    title: 'режим',
    description: '',
    criteria,
    visual: { energy: 70, outfit: 'casual', scene: 'calm' },
  });
}
async function run() {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  let failures = 0;
  async function check(name, values, verify) {
    const context = await browser.newContext({
      viewport: { width: 1200, height: 900 },
    });
    try {
      await context.route('**/cdn.jsdelivr.net/**', (route) => route.abort());
      const page = await context.newPage();
      await page.addInitScript((values) => {
        for (const [key, value] of Object.entries(values))
          localStorage.setItem(key, JSON.stringify(value));
      }, values);
      await page.goto(origin + '/path.html');
      await verify(page);
      console.log('pass: ' + name);
    } catch (e) {
      failures++;
      console.error('fail: ' + name + ' — ' + e.message);
    } finally {
      await context.close();
    }
  }
  const manual = pathWith([
    { id: 'm', type: 'manual', title: 'режим налажен', done: false },
  ]);
  await check(
    'ошибка записи откатывает ручную галочку',
    { identity_path_v1: manual },
    async (page) => {
      await page.getByRole('checkbox', { name: 'режим налажен' }).waitFor();
      await page.evaluate(() => {
        const original = Storage.prototype.setItem;
        Storage.prototype.setItem = function (k, v) {
          if (k === 'identity_path_v1')
            throw new DOMException('quota', 'QuotaExceededError');
          return original.call(this, k, v);
        };
      });
      await page.getByRole('checkbox', { name: 'режим налажен' }).click();
      assert.equal(
        await page.getByRole('checkbox', { name: 'режим налажен' }).isChecked(),
        false,
      );
      assert.equal(
        await page.evaluate(
          () =>
            JSON.parse(localStorage.getItem('identity_path_v1')).stages[1]
              .criteria[0].done,
        ),
        false,
      );
    },
  );
  await check(
    'перерисовка сохраняет выбранное сравнение',
    { identity_path_v1: manual },
    async (page) => {
      await page.locator('#compare').fill('0');
      await page.evaluate(() =>
        window.dispatchEvent(new Event('gamification-update')),
      );
      assert.equal(await page.locator('#compare').inputValue(), '0');
    },
  );
  const broken = P.createPath();
  delete broken.stages[0].snapshot.avatar;
  await check(
    'повреждённый снимок сообщает ошибку и сохраняет json',
    { identity_path_v1: broken },
    async (page) => {
      await page
        .locator('#notice')
        .waitFor({ state: 'visible', timeout: 3000 });
      assert.equal(await page.locator('#createPath').isVisible(), false);
      assert.deepEqual(
        await page.evaluate(() =>
          JSON.parse(localStorage.getItem('identity_path_v1')),
        ),
        broken,
      );
    },
  );
  const longTitle = 'ц'.repeat(200);
  const goalPath = pathWith([
    { id: 'g', type: 'goal', goalId: 'g1', title: 'цель' },
  ]);
  await check(
    'редактор сохраняет связь с длинной целью',
    {
      identity_path_v1: goalPath,
      horizons_goals_v2: {
        goals: [{ id: 'g1', title: longTitle, type: 'check', done: false }],
      },
    },
    async (page) => {
      await page
        .getByRole('button', { name: 'Редактировать', exact: true })
        .click();
      await page
        .getByRole('button', { name: 'Сохранить ступень', exact: true })
        .click();
      await page
        .locator('#stageDialog')
        .waitFor({ state: 'hidden', timeout: 3000 });
      assert.equal(
        await page.evaluate(
          () =>
            JSON.parse(localStorage.getItem('identity_path_v1')).stages[1]
              .criteria[0].title,
        ),
        longTitle,
      );
    },
  );
  await check(
    'повреждённый список целей не блокирует редактор',
    { identity_path_v1: goalPath, horizons_goals_v2: { goals: [null] } },
    async (page) => {
      await page
        .getByRole('button', { name: 'Редактировать', exact: true })
        .click();
      await page
        .locator('#stageDialog')
        .waitFor({ state: 'visible', timeout: 3000 });
      assert.match(
        await page.locator('#criteriaEditor').innerText(),
        /источник недоступен/,
      );
    },
  );
  const habitPath = pathWith([
    {
      id: 'h',
      type: 'habit',
      habitId: 'h1',
      title: 'сон',
      since: '2026-10-01',
      target: 30,
    },
  ]);
  await check(
    'повреждённый список привычек не блокирует редактор',
    { identity_path_v1: habitPath, tracker_v1: { good: 'oops', marks: {} } },
    async (page) => {
      await page
        .getByRole('button', { name: 'Редактировать', exact: true })
        .click();
      await page
        .locator('#stageDialog')
        .waitFor({ state: 'visible', timeout: 3000 });
      assert.match(
        await page.locator('#criteriaEditor').innerText(),
        /источник недоступен/,
      );
    },
  );
  await browser.close();
  if (failures) throw new Error(failures + ' regression failures');
}
run().catch((e) => {
  console.error(e.message);
  process.exitCode = 1;
});
