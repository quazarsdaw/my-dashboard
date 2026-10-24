const test = require('node:test'),
  assert = require('node:assert/strict');
const S = require('../eyes-session.js'),
  C = require('../eyes-core.js');
function start() {
  return S.createSession(C.buildPlan({ mode: 'short', durationSeconds: 30 }), {
    id: '11111111-1111-4111-8111-111111111111',
    epoch: 'initial',
    owner: 'local',
    nowMs: 0,
  });
}
test('остаток этапа независим от общего времени на старте, паузе и границе', () => {
  let s = S.createSession(C.buildPlan({ mode: 'short', durationSeconds: 60 }), {
    id: '11111111-1111-4111-8111-111111111111',
    epoch: 'initial',
    owner: 'local',
    nowMs: 0,
  });
  assert.equal(S.sessionView(s).stageRemainingMs, 13000);
  assert.equal(S.sessionView(s).remainingMs, 60000);
  s = S.pauseSession(s, 3000);
  assert.equal(S.sessionView(s).stageRemainingMs, 10000);
  assert.equal(S.sessionView(s).remainingMs, 57000);
  s = S.resumeSession(s, 5000);
  s = S.advanceSession(s, 15000);
  assert.equal(S.sessionView(s).exerciseId, 'vertical');
  assert.equal(S.sessionView(s).stageRemainingMs, 13000);
  assert.equal(S.sessionView(s).remainingMs, 47000);
});
test('старый frozen snapshot сохраняет прежние этапы, неизвестная версия не принимается', () => {
  const plan = {
    ok: true,
    mode: 'short',
    durationSeconds: 60,
    requiredSeconds: 52,
    stages: [
      ['horizontal', 10],
      ['vertical', 10],
      ['circle', 10],
      ['distance', 21],
      ['blinking', 9],
    ].map(([exerciseId, durationSeconds]) => ({ exerciseId, durationSeconds })),
  };
  const raw = S.createSession(plan, {
    id: '11111111-1111-4111-8111-111111111111',
    epoch: 'initial',
    owner: 'local',
    nowMs: 0,
  });
  const restored = S.restoreSession(raw, { owner: 'local', nowMs: 10000 });
  assert.deepEqual(restored.plan, plan);
  assert.equal(restored.phase, 'paused');
  assert.equal(
    S.restoreSession(
      { ...raw, plan: { ...plan, timingVersion: 999 } },
      { owner: 'local', nowMs: 10000 },
    ),
    null,
  );
  const damaged = structuredClone(raw);
  damaged.plan.stages[0].durationSeconds = 11;
  assert.equal(
    S.restoreSession(damaged, { owner: 'local', nowMs: 10000 }),
    null,
  );
});
test('пауза и редкие кадры не меняют активные 30 секунд', () => {
  let s = start();
  s = S.pauseSession(s, 10000);
  assert.equal(S.sessionView(s).remainingMs, 20000);
  s = S.advanceSession(s, 70000);
  assert.equal(S.sessionView(s).remainingMs, 20000);
  s = S.resumeSession(s, 70000);
  s = S.advanceSession(s, 90000);
  assert.equal(s.phase, 'completed');
  assert.equal(
    S.completionRecord(s, '2026-10-24T12:00:00Z').durationSeconds,
    30,
  );
  assert.deepEqual(S.advanceSession(s, 999999), s);
  let dense = start();
  for (let n = 0; n <= 30000; n += 10) dense = S.advanceSession(dense, n);
  assert.equal(S.sessionView(dense).progress, 1);
});
test('пропуск и отмена не дают запись завершённого комплекса', () => {
  let s = S.skipStage(start(), 1000);
  s = S.advanceSession(s, 40000);
  assert.equal(S.completionRecord(s, '2026-10-24T12:00:00Z'), null);
  assert.equal(
    S.completionRecord(S.cancelSession(start(), 4000), '2026-10-24T12:00:00Z'),
    null,
  );
});
test('reload восстанавливает только валидное своё занятие в паузе', () => {
  const s = S.advanceSession(start(), 10000),
    raw = JSON.parse(JSON.stringify(s));
  const restored = S.restoreSession(raw, { owner: 'local', nowMs: 90000 });
  assert.equal(restored.phase, 'paused');
  assert.equal(S.sessionView(restored).remainingMs, 20000);
  assert.equal(S.restoreSession(raw, { owner: 'other', nowMs: 0 }), null);
  assert.equal(
    S.restoreSession({ ...raw, playedMs: -1 }, { owner: 'local', nowMs: 0 }),
    null,
  );
  assert.equal(
    S.restoreSession({ bad: true }, { owner: 'local', nowMs: 0 }),
    null,
  );
});
test('обратный tick не начисляет время дважды и не мутирует вход', () => {
  const first = start(),
    json = JSON.stringify(first);
  const s = S.advanceSession(first, 10000);
  assert.equal(JSON.stringify(first), json);
  assert.equal(S.advanceSession(s, 9999).playedMs, 10000);
  assert.equal(
    S.advanceSession(S.advanceSession(s, 9999), 11000).playedMs,
    11000,
  );
});
