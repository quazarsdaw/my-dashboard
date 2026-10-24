// изолированная приёмка: локальные синтетические данные, внешняя сеть заблокирована.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict'),
  fs = require('node:fs'),
  path = require('node:path'),
  http = require('node:http');
const root = path.resolve(__dirname, '..'),
  out = path.join(root, 'docs/screenshots/eye-breaks');
const mime = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
};
const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://local');
  if (!url.pathname.startsWith('/my-dashboard/')) {
    res.writeHead(404).end();
    return;
  }
  const file = path.resolve(
    root,
    decodeURIComponent(url.pathname.slice(14)) || 'index.html',
  );
  if (
    !file.startsWith(root + path.sep) ||
    path
      .relative(root, file)
      .split(path.sep)
      .some((x) => x.startsWith('.'))
  ) {
    res.writeHead(403).end();
    return;
  }
  fs.readFile(file, (err, body) => {
    if (err) {
      res.writeHead(404).end();
      return;
    }
    res
      .writeHead(200, {
        'content-type': mime[path.extname(file)] || 'application/octet-stream',
        'cache-control': 'no-store',
      })
      .end(body);
  });
});
(async () => {
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const origin = 'http://127.0.0.1:' + server.address().port,
    base = origin + '/my-dashboard/';
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const errors = [],
    localFailures = [];
  try {
    async function context(options = {}) {
      const c = await browser.newContext(options);
      await c.route('**/*', (r) =>
        new URL(r.request().url()).origin === origin ? r.continue() : r.abort(),
      );
      c.on('page', (p) => {
        p.on('pageerror', (e) => errors.push(e.message));
        p.on('response', (r) => {
          if (r.url().startsWith(origin) && r.status() >= 400)
            localFailures.push(r.url());
        });
      });
      return c;
    }
    const desktop = await context({ viewport: { width: 1440, height: 1000 } }),
      page = await desktop.newPage();
    await page.goto(base + 'eyes.html');
    await page.locator('[data-exercise]').first().waitFor();
    assert.equal(await page.locator('[data-exercise]').count(), 11);
    await page.screenshot({ path: out + '/desktop.png' });
    await page.locator('details summary').click();
    await page.locator('details').scrollIntoViewIfNeeded();
    await page.screenshot({ path: out + '/settings-desktop.png' });
    await page.locator('details summary').click();
    await page.locator('[data-duration="30"]').click();
    await page.locator('#startEye').click();
    await page.locator('#eyePlayer').waitFor({ state: 'visible' });
    await page.waitForTimeout(350);
    await page.screenshot({ path: out + '/player-desktop.png' });
    const started = Date.now();
    await page
      .locator('#eyeResult')
      .waitFor({ state: 'visible', timeout: 35000 });
    assert.ok(
      Date.now() - started >= 28000,
      'real timer was not advanced by fake clock',
    );
    assert.equal(await page.locator('#statsSessions').innerText(), '1');
    assert.match(await page.locator('#statsMinutes').innerText(), /0[,.]5/);
    await page.reload();
    await page.locator('#statsSessions').waitFor();
    assert.equal(await page.locator('#statsSessions').innerText(), '1');
    await page.locator('.eye-habit').scrollIntoViewIfNeeded();
    await page.screenshot({ path: out + '/stats-desktop.png' });
    console.log(
      '30 секунд в реальном времени + reload: 1 занятие / 0,5 минуты',
    );
    await page.locator('#reminderEnabled').check();
    await page.waitForFunction(
      () =>
        window.EyesReminder && localStorage.getItem('_eye_break_runtime_v1'),
    );
    const due = await page.evaluate(
      () => JSON.parse(localStorage.getItem('_eye_break_runtime_v1')).dueAt,
    );
    await page.goto(base + 'index.html');
    await page.locator('.eye-entry').waitFor();
    await page.waitForTimeout(400);
    assert.equal(
      await page.evaluate(
        () => JSON.parse(localStorage.getItem('_eye_break_runtime_v1')).dueAt,
      ),
      due,
    );
    await page.screenshot({ path: out + '/home-desktop.png' });
    await page.evaluate(() => {
      const s = JSON.parse(localStorage.getItem('_eye_break_runtime_v1'));
      s.dueAt = Date.now() - 1;
      localStorage.setItem('_eye_break_runtime_v1', JSON.stringify(s));
    });
    await page
      .locator('.eye-reminder')
      .waitFor({ state: 'visible', timeout: 7000 });
    await page.screenshot({ path: out + '/reminder-desktop.png' });
    await page
      .locator('.eye-reminder button')
      .filter({ hasText: 'Позже' })
      .click();
    assert.ok(
      await page.evaluate(
        () =>
          JSON.parse(localStorage.getItem('_eye_break_runtime_v1')).dueAt -
            Date.now() >
          290000,
      ),
    );
    console.log(
      '20 минут смоделированы дедлайном; навигация сохраняет срок; позже = 5 минут',
    );
    // indexeddb fallback проверяется без Web Locks в двух реальных вкладках.
    const fallback = await context();
    await fallback.addInitScript(() =>
      Object.defineProperty(navigator, 'locks', {
        value: undefined,
        configurable: true,
      }),
    );
    const a = await fallback.newPage(),
      b = await fallback.newPage();
    await Promise.all([a.goto(base + 'eyes.html'), b.goto(base + 'eyes.html')]);
    await a.locator('#startEye').click();
    await b.locator('#startEye').click();
    await b.locator('#eyeError').waitFor({ state: 'visible' });
    assert.match(await b.locator('#eyeError').innerText(), /другой вкладке/);
    await fallback.close();
    console.log('indexeddb fallback: два окна не запускают две разминки');
    async function checkExercisePolish(viewport, isMobile) {
      const c = await context({ viewport, isMobile, hasTouch: isMobile }),
        p = await c.newPage(),
        suffix = isMobile ? 'mobile' : 'desktop';
      await p.clock.install({ time: new Date('2026-10-24T10:00:00Z') });
      await p.goto(base + 'eyes.html');
      await p.locator('[data-exercise]').first().waitFor();
      await p.clock.pauseAt(new Date('2026-10-24T10:01:00Z'));
      p.on('dialog', (d) => d.accept());
      await p.locator('#startEye').click();
      await p.locator('#eyePlayer').waitFor({ state: 'visible' });
      assert.equal(await p.locator('#eyeTime').innerText(), '0:13');
      assert.equal(await p.locator('#eyeTotalTime').innerText(), '1:00');
      assert.ok(
        (await p
          .locator('#eyeTime')
          .evaluate((e) => parseFloat(getComputedStyle(e).fontSize))) >= 46,
      );
      assert.ok(
        (await p
          .locator('.eye-total-clock')
          .evaluate((e) => parseFloat(getComputedStyle(e).fontSize))) <= 13,
      );
      await p.clock.runFor(3100);
      assert.equal(await p.locator('#eyeTime').innerText(), '0:10');
      assert.equal(await p.locator('#eyeTotalTime').innerText(), '0:57');
      await p.locator('#nextEye').click();
      await p.locator('#nextEye').click();
      assert.equal(await p.locator('#stageTitle').innerText(), 'Круг');
      const points = await p
        .locator('#pathGuide')
        .evaluate((e) => [...e.points].map((p) => [p.x, p.y]));
      assert.deepEqual(points[0], points.at(-1));
      assert.ok(points.some(([x, y]) => x < 30 && y < 30));
      assert.ok(points.some(([x, y]) => x > 70 && y > 70));
      await p.clock.runFor(1500);
      await p.screenshot({ path: out + '/circle-' + suffix + '.png' });
      await p.locator('#nextEye').click();
      assert.equal(await p.locator('#stageTitle').innerText(), 'Взгляд вдаль');
      assert.equal(await p.locator('#eyeTime').innerText(), '0:10');
      assert.equal(await p.locator('#eyeTotalTime').innerText(), '0:22');
      await p.clock.runFor(10050);
      assert.equal(await p.locator('#stageTitle').innerText(), 'Моргание');
      await p.locator('#exitEye').click();
      await p.locator('[data-duration="30"]').click();
      await p
        .locator('[data-exercise="near-far"]')
        .locator('..')
        .locator('..')
        .getByRole('button')
        .click();
      await p.locator('#startEye').click();
      await p.locator('#eyePlayer').waitFor({ state: 'visible' });
      assert.equal(await p.locator('#eyeDot').isVisible(), false);
      assert.match(await p.locator('#stagePrompt').innerText(), /палец/);
      await p.screenshot({ path: out + '/near-finger-' + suffix + '.png' });
      await p.clock.runFor(6100);
      assert.equal(await p.locator('#eyeDot').isVisible(), true);
      assert.match(await p.locator('#stagePrompt').innerText(), /Теперь сюда/);
      const target = await p.locator('#eyeDot').boundingBox(),
        area = await p.locator('#motionArea').boundingBox(),
        caption = await p.locator('#stagePrompt').boundingBox();
      assert.ok(
        Math.abs(target.x + target.width / 2 - area.x - area.width / 2) < 2,
      );
      assert.ok(
        Math.abs(target.y + target.height / 2 - area.y - area.height / 2) < 2,
      );
      assert.ok(caption.y > target.y + target.height + 8);
      assert.ok(
        await p.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      );
      await p.screenshot({ path: out + '/near-screen-' + suffix + '.png' });
      await p.clock.runFor(6000);
      assert.equal(await p.locator('#eyeDot').isVisible(), false);
      assert.match(await p.locator('#stagePrompt').innerText(), /палец/);
      if (isMobile) {
        await p.setViewportSize({ width: 844, height: 390 });
        assert.ok(
          await p.evaluate(() => document.documentElement.scrollWidth <= 844),
        );
        await p.clock.runFor(6000);
        const dot = await p.locator('#eyeDot').boundingBox(),
          text = await p.locator('#stagePrompt').boundingBox();
        assert.ok(text.y > dot.y + dot.height + 8);
      }
      await c.close();
    }
    await checkExercisePolish({ width: 1440, height: 1000 }, false);
    await checkExercisePolish({ width: 390, height: 844 }, true);
    console.log(
      'управляемые часы: stage/total, замкнутый круг, ровно 10с вдаль, палец ↔ центр; desktop/mobile/landscape без перекрытий',
    );
    const mobile = await context({
      viewport: { width: 390, height: 844 },
      isMobile: true,
      hasTouch: true,
    });
    const phone = await mobile.newPage();
    await phone.goto(base + 'eyes.html');
    await phone.locator('[data-exercise]').first().waitFor();
    assert.ok(
      await phone.evaluate(() => document.documentElement.scrollWidth <= 390),
    );
    await phone.screenshot({ path: out + '/mobile.png', fullPage: true });
    await phone.locator('[data-duration="30"]').click();
    await phone.locator('#startEye').click();
    await phone.waitForTimeout(300);
    await phone.screenshot({ path: out + '/player-mobile.png' });
    phone.on('dialog', (d) => d.accept());
    await phone.locator('#exitEye').click();
    await phone
      .locator('[data-exercise="distance"]')
      .locator('..')
      .locator('..')
      .getByRole('button')
      .click();
    await phone.locator('#startEye').click();
    await phone.locator('#eyePlayer').waitFor({ state: 'visible' });
    assert.equal(
      await phone
        .locator('#pathGuide')
        .evaluate((e) => getComputedStyle(e).display),
      'none',
    );
    await phone.screenshot({ path: out + '/instruction-mobile.png' });
    await phone.locator('#exitEye').click();
    await phone.setViewportSize({ width: 844, height: 390 });
    assert.ok(
      await phone.evaluate(() => document.documentElement.scrollWidth <= 844),
    );
    await mobile.close();
    const reduced = await context({
      viewport: { width: 720, height: 500 },
      deviceScaleFactor: 2,
      reducedMotion: 'reduce',
    });
    const small = await reduced.newPage();
    await small.goto(base + 'eyes.html');
    assert.equal(await small.locator('#speedSelect').inputValue(), 'slow');
    small.on('dialog', (d) => d.dismiss());
    await small.locator('#startEye').click();
    assert.equal(await small.locator('#eyePlayer').isVisible(), false);
    // 1440px desktop при масштабе 200% даёт layout viewport 720 CSS px.
    assert.ok(
      await small.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    );
    await small.locator('.eye-back').focus();
    assert.equal(
      await small.evaluate(() => document.activeElement.tagName),
      'A',
    );
    await reduced.close();
    const tracker = await desktop.newPage();
    await tracker.goto(base + 'tracker.html');
    const date = await tracker
      .locator('#goodTable .habit-dot')
      .last()
      .getAttribute('data-date');
    await tracker.evaluate((date) => {
      localStorage.setItem(
        'tracker_v1',
        JSON.stringify({
          good: [{ id: 'synthetic', name: 'Тестовая привычка' }],
          bad: [{ id: 'bad', name: 'Тестовый штраф', severity: 'medium' }],
          marks: { ['synthetic:' + date]: 1 },
        }),
      );
      localStorage.setItem(
        'coins_v1',
        JSON.stringify({ balance: 0, earned: 0, spent: 0, history: [] }),
      );
    }, date);
    await tracker.reload();
    const good = tracker.locator('#goodTable .habit-dot').last(),
      bad = tracker.locator('#badTable .habit-dot').last();
    const balance = () =>
      tracker.evaluate(() => Gamification.getCoins().balance);
    assert.equal(await balance(), 0);
    await good.click();
    await tracker.waitForFunction(() => Gamification.getCoins().balance === 1);
    assert.ok(await good.getAttribute('class').then((x) => x.includes('half')));
    await good.click();
    await tracker.waitForFunction(() => Gamification.getCoins().balance === 0);
    await good.click();
    await tracker.waitForFunction(() => Gamification.getCoins().balance === 2);
    await tracker.screenshot({ path: out + '/tracker-desktop.png' });
    await bad.click();
    await tracker.waitForFunction(() => Gamification.getCoins().balance === -8);
    await good.click();
    await tracker.waitForFunction(() => Gamification.getCoins().balance === -9);
    assert.equal(
      await tracker.evaluate(() => Gamification.getCoins().spent),
      10,
    );
    await tracker.reload();
    assert.equal(await balance(), -9);
    await tracker.goto(base + 'profile.html');
    await tracker.locator('#coinHistory .coin-row').first().waitFor();
    await tracker.locator('#coinHistory').scrollIntoViewIfNeeded();
    assert.match(await tracker.locator('#coinHistory').innerText(), /-1/);
    await tracker.screenshot({ path: out + '/history-desktop.png' });
    console.log(
      'монеты: legacy +1, снятие -1, новая +2, штраф -10, коррекция -1; reload без повторной выплаты',
    );
    // Все html entrypoints сохраняют рабочие локальные js/css по project Pages prefix.
    for (const file of fs
      .readdirSync(root)
      .filter((x) => x.endsWith('.html'))) {
      const html = fs.readFileSync(path.join(root, file), 'utf8');
      for (const match of html.matchAll(
        /(?:src|href)=["']([^"']+\.(?:js|css)(?:\?[^"']*)?)["']/g,
      )) {
        if (/^(?:https?:|\/\/)/.test(match[1])) continue;
        const response = await desktop.request.get(
          new URL(match[1], base + file).href,
        );
        assert.equal(response.status(), 200, file + ' ' + match[1]);
      }
    }
    assert.deepEqual(localFailures, []);
    assert.deepEqual(errors, []);
    console.log(
      '/my-dashboard/: локальные ресурсы доступны, desktop/mobile/landscape/zoom/reduced-motion без pageerror; внешние запросы заблокированы',
    );
    await desktop.close();
  } finally {
    await browser.close();
    await new Promise((r) => server.close(r));
  }
})().catch((e) => {
  console.error(e);
  server.close();
  process.exitCode = 1;
});
