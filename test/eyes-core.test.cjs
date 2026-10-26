const test = require('node:test');
const assert = require('node:assert/strict');
const D = require('../eyes-data.js');
const C = require('../eyes-core.js');

test('в многокомпонентных программах вдаль ровно 10 секунд без потери общего бюджета', () => {
  for (const [mode, durationSeconds, exerciseIds] of [
    ['short', 60],
    ['short', 120],
    ['short', 180],
    ['full', 120],
    ['full', 180],
    ['custom', 30, ['horizontal', 'distance']],
    ['custom', 60, ['circle', 'near-far', 'distance']],
  ]) {
    const p = C.buildPlan({ mode, durationSeconds, exerciseIds });
    assert.equal(p.ok, true);
    assert.equal(
      p.stages.find((s) => s.exerciseId === 'distance').durationSeconds,
      10,
    );
    assert.equal(
      p.stages.reduce((n, s) => n + s.durationSeconds, 0),
      durationSeconds,
    );
  }
  assert.deepEqual(
    C.buildPlan({ mode: 'short', durationSeconds: 60 }).stages.map(
      (s) => s.durationSeconds,
    ),
    [13, 13, 12, 10, 12],
  );
  for (const mode of ['single', 'custom'])
    for (const durationSeconds of [30, 60, 120, 180])
      assert.equal(
        C.buildPlan({ mode, durationSeconds, exerciseIds: ['distance'] })
          .stages[0].durationSeconds,
        durationSeconds,
      );
});
test('круг завершает целые обороты до разворота при любом темпе и коротком этапе', () => {
  for (const stageDurationMs of [8000, 10000, 15000, 30000])
    for (const speed of ['slow', 'normal', 'fast']) {
      const sample = (t) =>
        C.positionAt({
          exerciseId: 'circle',
          elapsedMs: t,
          stageDurationMs,
          speed,
        });
      function turn(from, to) {
        let last = Math.atan2(sample(from).y - 0.5, sample(from).x - 0.5),
          sum = 0;
        for (let i = 1; i <= 400; i++) {
          const p = sample(from + ((to - from) * i) / 400),
            a = Math.atan2(p.y - 0.5, p.x - 0.5);
          let diff = a - last;
          if (diff > Math.PI) diff -= 2 * Math.PI;
          if (diff < -Math.PI) diff += 2 * Math.PI;
          sum += diff;
          last = a;
        }
        return sum / (2 * Math.PI);
      }
      const forward = turn(0, stageDurationMs / 2),
        backward = turn(stageDurationMs / 2, stageDurationMs);
      assert.ok(forward >= 1 - 1e-8);
      assert.ok(Math.abs(forward - Math.round(forward)) < 1e-8);
      assert.ok(Math.abs(forward + backward) < 1e-8);
      const a = sample(stageDurationMs / 2 - 1),
        b = sample(stageDurationMs / 2 + 1);
      assert.ok(Math.hypot(a.x - b.x, a.y - b.y) < 0.01);
    }
});
test('направляющая круга замкнута и покрывает четыре четверти независимо от таймера', () => {
  const points = C.guidePoints('circle');
  assert.deepEqual(points[0], points.at(-1));
  for (const [x, y] of [
    [1, 1],
    [1, -1],
    [-1, 1],
    [-1, -1],
  ])
    assert.ok(
      points.some((p) => (p.x - 0.5) * x > 0.1 && (p.y - 0.5) * y > 0.1),
    );
  assert.deepEqual(C.guidePoints('unknown'), []);
});

test('короткая программа точно укладывается в бюджет и не теряет минимумы', () => {
  assert.equal(D.CATALOG.length, 11);
  for (const seconds of [30, 60, 120, 180]) {
    const p = C.buildPlan({ mode: 'short', durationSeconds: seconds });
    assert.equal(p.ok, true);
    assert.equal(
      p.stages.reduce((n, s) => n + s.durationSeconds, 0),
      seconds,
    );
    for (const s of p.stages)
      assert.ok(
        s.durationSeconds >=
          D.CATALOG.find((x) => x.id === s.exerciseId).minSeconds,
      );
  }
  assert.deepEqual(
    C.buildPlan({ mode: 'short', durationSeconds: 30 }).stages.map(
      (x) => x.exerciseId,
    ),
    ['horizontal', 'vertical', 'blinking'],
  );
});
test('полный комплекс не сжимается молча, а собственный проверяет выбор', () => {
  assert.equal(
    C.buildPlan({ mode: 'full', durationSeconds: 60 }).error,
    'DURATION_TOO_SHORT',
  );
  assert.equal(
    C.buildPlan({ mode: 'full', durationSeconds: 120 }).stages.length,
    11,
  );
  for (const exerciseIds of [[], ['bad'], ['horizontal', 'horizontal']])
    assert.equal(
      C.buildPlan({ mode: 'custom', durationSeconds: 30, exerciseIds }).ok,
      false,
    );
  assert.equal(
    C.buildPlan({
      mode: 'single',
      durationSeconds: 60,
      exerciseIds: ['circle'],
    }).stages[0].durationSeconds,
    60,
  );
  assert.equal(C.buildPlan({ mode: 'short', durationSeconds: 300 }).ok, false);
});
test('настройки не принимают произвольные стили и не переписывают явный темп', () => {
  assert.equal(
    D.normalizeSettings(null, { reducedMotion: true }).speed,
    'slow',
  );
  const s = D.normalizeSettings(
    {
      speed: 'fast',
      durationSeconds: 300,
      dotColor: 'url(evil)',
      exerciseIds: ['rest', 'bad'],
    },
    { reducedMotion: true },
  );
  assert.equal(s.speed, 'fast');
  assert.equal(s.durationSeconds, 60);
  assert.equal(s.dotColor, 'amber');
  assert.deepEqual(s.exerciseIds, ['rest']);
});
test('плавные траектории ограничены и непрерывны, скачки имеют фиксированную паузу', () => {
  for (const exerciseId of [
    'horizontal',
    'vertical',
    'diagonal-left',
    'diagonal-right',
    'circle',
    'figure-eight',
    'jumps',
  ]) {
    for (const speed of ['slow', 'normal', 'fast'])
      for (let elapsedMs = 0; elapsedMs <= 30000; elapsedMs += 97) {
        const p = C.positionAt({
          exerciseId,
          speed,
          elapsedMs,
          stageDurationMs: 30000,
        });
        assert.ok(
          p.x >= 0.08 - 1e-9 &&
            p.x <= 0.92 + 1e-9 &&
            p.y >= 0.08 - 1e-9 &&
            p.y <= 0.92 + 1e-9,
        );
        if (exerciseId !== 'jumps') {
          const q = C.positionAt({
            exerciseId,
            speed,
            elapsedMs: elapsedMs + 1,
            stageDurationMs: 30000,
          });
          assert.ok(Math.hypot(q.x - p.x, q.y - p.y) < 0.01);
        }
      }
  }
  const at = (elapsedMs) =>
    C.positionAt({
      exerciseId: 'jumps',
      speed: 'normal',
      elapsedMs,
      stageDurationMs: 30000,
    });
  assert.deepEqual(at(0), at(1199));
  assert.notDeepEqual(at(1199), at(1200));
  const c = (t) =>
    C.positionAt({
      exerciseId: 'circle',
      speed: 'fast',
      elapsedMs: t,
      stageDurationMs: 30000,
    });
  assert.ok(
    Math.hypot(c(15001).x - c(14999).x, c(15001).y - c(14999).y) < 0.01,
  );
});
test('инструкции для отдыха дают стабильные звуковые этапы вместо оценки взгляда', () => {
  assert.equal(
    C.instructionAt({ exerciseId: 'near-far', elapsedMs: 0 }).cueId,
    C.instructionAt({ exerciseId: 'near-far', elapsedMs: 1 }).cueId,
  );
  assert.notEqual(
    C.instructionAt({ exerciseId: 'near-far', elapsedMs: 0 }).cueId,
    C.instructionAt({ exerciseId: 'near-far', elapsedMs: 6000 }).cueId,
  );
  assert.match(
    C.instructionAt({ exerciseId: 'rest', elapsedMs: 0 }).text,
    /давите|давления/,
  );
});
