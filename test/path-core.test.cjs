const test = require('node:test');
const assert = require('node:assert/strict');
const P = require('../path-core.js');
const NOW = '2026-10-23T12:00:00.000Z';
const avatarOptions = {
  skin: '#c99572',
  hair: '#29221f',
  hairStyle: 'curls',
  facialHair: 'beard',
  glasses: 'round',
  faceShape: 'angular',
  bodyType: 'broad',
  expression: 'confident',
  topColor: '#f0a050',
  pantsColor: '#445566',
  shoesColor: '#eeeeee',
};
const stage = (
  id,
  criteria = [
    { id: 'm', type: 'manual', title: 'готов', done: false, required: true },
  ],
) => ({
  id,
  title: id,
  description: '',
  criteria,
  visual: { energy: 70, outfit: 'casual', scene: 'calm' },
  targetDate: '',
});
function fixture() {
  return P.upsertStage(
    P.upsertStage(P.createPath(NOW), stage('b')),
    stage('v'),
  );
}
test('создание пути фиксирует только исходную точку без выдуманных целей', () => {
  const p = P.createPath(NOW);
  assert.equal(p.stages.length, 1);
  assert.equal(p.stages[0].acceptedAt, NOW);
  assert.equal(P.evaluate(p, {}, NOW)[0].state, 'completed');
});
test('редактор сохраняет все настройки внешности и фиксирует их при принятии', () => {
  let p = P.updateAvatar(fixture(), avatarOptions);
  assert.deepEqual(p.avatar, avatarOptions);
  p = P.setManualCriterion(p, 'b', 'm', true);
  p = P.acceptStage(p, 'b', {}, NOW);
  assert.deepEqual(p.stages[1].snapshot.avatar, avatarOptions);
  const snapshot = JSON.stringify(p.stages[1].snapshot);
  const updated = P.updateAvatar(p, {
    ...avatarOptions,
    hairStyle: 'bald',
    topColor: null,
  });
  assert.equal(JSON.stringify(updated.stages[1].snapshot), snapshot);
  assert.equal(P.evaluate(updated, {}, NOW)[1].avatar.hairStyle, 'curls');
  assert.equal(P.evaluate(updated, {}, NOW)[2].avatar.hairStyle, 'bald');
});
test('старый avatar нормализуется только для чтения, не переписывая путь', () => {
  const p = fixture();
  p.avatar = { skin: '#c99572', hair: '#29221f' };
  p.stages[0].snapshot.avatar = { skin: '#bbaa99', hair: '#112233' };
  const raw = JSON.stringify(p);
  const v = P.evaluate(p, {}, NOW);
  assert.equal(v[0].avatar.hairStyle, 'swept');
  assert.equal(v[0].avatar.facialHair, 'none');
  assert.equal(v[0].avatar.topColor, null);
  assert.equal(v[0].avatar.skin, '#bbaa99');
  assert.equal(JSON.stringify(p), raw);
});
test('неизвестные параметры внешности и небезопасные цвета отклоняются', () => {
  for (const [key, value] of [
    ['hairStyle', 'unknown'],
    ['facialHair', 'unknown'],
    ['glasses', null],
    ['faceShape', 'unknown'],
    ['bodyType', 9],
    ['expression', 'unknown'],
    ['topColor', 'red'],
    ['pantsColor', '#fff'],
    ['shoesColor', 'url(secret)'],
  ]) {
    assert.throws(
      () => P.updateAvatar(fixture(), { ...avatarOptions, [key]: value }),
      { code: 'INVALID_DATA' },
      key,
    );
  }
});
test('обустройство и новые стили сохраняются в версии и принятом снимке', () => {
  let p = P.createPath(NOW);
  assert.equal(p.stages[0].visual.setting, 0);
  p = P.upsertStage(p, {
    ...stage('b'),
    visual: { energy: 85, outfit: 'hoodie', scene: 'fitness', setting: 2 },
  });
  p = P.setManualCriterion(p, 'b', 'm', true);
  p = P.acceptStage(p, 'b', {}, NOW);
  assert.deepEqual(
    P.evaluate(JSON.parse(JSON.stringify(p)), {}, NOW)[1].visual,
    {
      energy: 85,
      outfit: 'hoodie',
      scene: 'fitness',
      setting: 2,
    },
  );
  assert.deepEqual(p.stages[1].snapshot.visual, p.stages[1].visual);
});
test('старый путь без обустройства остаётся валидным без перезаписи истории', () => {
  const p = fixture();
  for (const s of p.stages) {
    delete s.visual.setting;
    if (s.snapshot) delete s.snapshot.visual.setting;
  }
  const raw = JSON.stringify(p);
  P.validatePath(p);
  P.evaluate(p, {}, NOW);
  assert.equal(JSON.stringify(p), raw);
  const updated = P.upsertStage(p, {
    ...stage('b'),
    visual: { energy: 70, outfit: 'coat', scene: 'creative', setting: 1 },
  });
  assert.equal(updated.stages[1].visual.setting, 1);
  assert.equal(JSON.stringify(updated.stages[0]), JSON.stringify(p.stages[0]));
});
test('неизвестное обустройство не обрезается и не сбрасывается молча', () => {
  for (const setting of [-1, 3, 1.5, '2', null]) {
    assert.throws(
      () =>
        P.upsertStage(P.createPath(NOW), {
          ...stage('b'),
          visual: { energy: 70, outfit: 'casual', scene: 'calm', setting },
        }),
      { code: 'INVALID_DATA' },
    );
  }
});
test('будущая ступень готова заранее, но принятие не перескакивает текущую', () => {
  let p = P.setManualCriterion(fixture(), 'v', 'm', true);
  assert.deepEqual(
    P.evaluate(p, {}, NOW).map((x) => x.state),
    ['completed', 'active', 'ready'],
  );
  assert.throws(() => P.acceptStage(p, 'v', {}, NOW), {
    code: 'PREVIOUS_STAGE_REQUIRED',
  });
  assert.equal(p.stages[2].acceptedAt, undefined);
});
test('готовность не принимает ступень автоматически; принятие создаёт неизменный снимок', () => {
  let p = P.setManualCriterion(fixture(), 'b', 'm', true);
  assert.equal(P.evaluate(p, {}, NOW)[1].state, 'ready');
  assert.equal(p.stages[1].acceptedAt, undefined);
  const accepted = P.acceptStage(p, 'b', {}, NOW);
  assert.equal(accepted.stages[1].acceptedAt, NOW);
  assert.equal(accepted.stages[1].snapshot.criteria[0].done, true);
  assert.equal(p.stages[1].acceptedAt, undefined);
  assert.deepEqual(P.acceptStage(accepted, 'b', {}, NOW), accepted);
  assert.throws(
    () => P.upsertStage(accepted, { ...stage('b'), title: 'переписать' }),
    { code: 'STAGE_ACCEPTED' },
  );
  assert.throws(() => P.removeStage(accepted, 'b'), { code: 'STAGE_ACCEPTED' });
});
test('незавершённая или пустая ступень не принимается', () => {
  assert.throws(() => P.acceptStage(fixture(), 'b', {}, NOW), {
    code: 'CRITERIA_NOT_MET',
  });
  const p = P.upsertStage(P.createPath(NOW), stage('b', []));
  assert.equal(P.evaluate(p, {}, NOW)[1].ready, false);
  assert.throws(() => P.acceptStage(p, 'b', {}, NOW), {
    code: 'CRITERIA_NOT_MET',
  });
});
test('цель читается по id, числовая цель учитывает target, исчезнувший источник предупреждает', () => {
  const p = P.upsertStage(
    P.createPath(NOW),
    stage('b', [
      {
        id: 'g',
        type: 'goal',
        goalId: 'income',
        title: 'доход',
        required: true,
      },
    ]),
  );
  assert.equal(
    P.evaluate(
      p,
      {
        goals: [
          {
            id: 'income',
            type: 'number',
            current: 80,
            target: 100,
            done: false,
          },
        ],
      },
      NOW,
    )[1].progress,
    80,
  );
  assert.equal(
    P.evaluate(
      p,
      {
        goals: [
          {
            id: 'income',
            type: 'number',
            current: 100,
            target: 100,
            done: false,
          },
        ],
      },
      NOW,
    )[1].ready,
    true,
  );
  const missing = P.evaluate(p, { goals: [] }, NOW)[1];
  assert.equal(missing.ready, false);
  assert.equal(missing.criteria[0].warning, 'SOURCE_MISSING');
});
test('история принятой цели сохраняется после её удаления или сброса', () => {
  let p = P.upsertStage(
    P.createPath(NOW),
    stage('b', [
      {
        id: 'g',
        type: 'goal',
        goalId: 'uni',
        title: 'университет',
        required: true,
      },
    ]),
  );
  p = P.acceptStage(
    p,
    'b',
    { goals: [{ id: 'uni', type: 'check', done: true }] },
    NOW,
  );
  const state = P.evaluate(p, { goals: [] }, NOW)[1];
  assert.equal(state.state, 'completed');
  assert.equal(state.criteria[0].done, true);
  assert.equal(state.criteria[0].warning, null);
});
test('привычка считает полные отметки начиная с даты, без будущего и половинных дней', () => {
  const p = P.upsertStage(
    P.createPath(NOW),
    stage('b', [
      {
        id: 'h',
        type: 'habit',
        habitId: 'sleep',
        title: 'сон',
        since: '2026-10-20',
        target: 3,
        required: true,
      },
    ]),
  );
  const tracker = {
    good: [{ id: 'sleep', name: 'сон' }],
    bad: [],
    marks: {
      'sleep:2026-10-19': 1,
      'sleep:2026-10-20': 1,
      'sleep:2026-10-21': 0.5,
      'sleep:2026-10-22': 1,
      'sleep:2026-10-23': 1,
      'sleep:2026-10-24': 1,
    },
  };
  assert.equal(
    P.evaluate(p, { tracker }, '2026-10-22T18:59:59Z')[1].criteria[0].current,
    2,
  );
  assert.equal(
    P.evaluate(p, { tracker }, '2026-10-22T19:00:00Z')[1].criteria[0].current,
    3,
  );
  assert.equal(P.evaluate(p, { tracker }, NOW)[1].ready, true);
});
test('необязательное условие не блокирует, но одно обязательное нужно', () => {
  const criteria = [
    {
      id: 'm',
      type: 'manual',
      title: 'обязательно',
      done: true,
      required: true,
    },
    { id: 'o', type: 'manual', title: 'ещё', done: false, required: false },
  ];
  let p = P.upsertStage(P.createPath(NOW), stage('b', criteria));
  assert.equal(P.evaluate(p, {}, NOW)[1].ready, true);
  p = P.upsertStage(P.createPath(NOW), stage('b', [criteria[1]]));
  assert.equal(P.evaluate(p, {}, NOW)[1].ready, false);
});
test('перестановка ограничена будущими ступенями и не меняет их условия', () => {
  const p = fixture();
  const moved = P.moveStage(p, 'v', -1);
  assert.deepEqual(
    moved.stages.map((x) => x.id),
    ['origin', 'v', 'b'],
  );
  assert.deepEqual(
    p.stages.map((x) => x.id),
    ['origin', 'b', 'v'],
  );
  assert.throws(() => P.moveStage(p, 'b', -1), { code: 'STAGE_ACCEPTED' });
  assert.deepEqual(
    P.removeStage(p, 'v').stages.map((x) => x.id),
    ['origin', 'b'],
  );
});
test('неизвестная версия, дубли id и некорректные условия не нормализуются молча', () => {
  assert.throws(() => P.validatePath({ ...fixture(), schemaVersion: 99 }), {
    code: 'UNSUPPORTED_VERSION',
  });
  const p = fixture();
  p.stages[2].id = 'b';
  assert.throws(() => P.validatePath(p), { code: 'INVALID_DATA' });
  assert.throws(
    () =>
      P.upsertStage(
        P.createPath(NOW),
        stage('b', [
          {
            id: 'h',
            type: 'habit',
            habitId: 'x',
            title: 'x',
            since: '2026-02-30',
            target: 3,
          },
        ]),
      ),
    { code: 'INVALID_DATA' },
  );
  assert.throws(
    () =>
      P.upsertStage(P.createPath(NOW), {
        ...stage('b'),
        visual: { energy: 200 },
      }),
    { code: 'INVALID_DATA' },
  );
  assert.throws(
    () =>
      P.upsertStage(
        P.createPath(NOW),
        stage('b', [{ id: 'x', type: 'sql', title: 'x' }]),
      ),
    { code: 'INVALID_DATA' },
  );
});
test('повреждённые списки источников не завершают условия и не ломают страницу', () => {
  const p = P.upsertStage(
    P.createPath(NOW),
    stage('b', [
      { id: 'g', type: 'goal', goalId: 'x', title: 'цель' },
      {
        id: 'h',
        type: 'habit',
        habitId: 'x',
        title: 'сон',
        target: 3,
        since: '2026-10-20',
      },
    ]),
  );
  const v = P.evaluate(p, { goals: [null], tracker: { good: 'oops' } }, NOW)[1];
  assert.equal(v.ready, false);
  assert.deepEqual(
    v.criteria.map((c) => c.warning),
    ['SOURCE_MISSING', 'SOURCE_MISSING'],
  );
});
test('дальний ориентир я остаётся последним, обычные ступени добавляются перед ним', () => {
  let p = P.upsertStage(fixture(), {
    ...stage('destination'),
    destination: true,
  });
  p = P.upsertStage(p, stage('g'));
  assert.deepEqual(
    p.stages.map((s) => s.id),
    ['origin', 'b', 'v', 'g', 'destination'],
  );
  assert.equal(P.evaluate(p, {}, NOW).at(-1).destination, true);
  assert.throws(() => P.moveStage(p, 'g', 1), { code: 'DESTINATION_LAST' });
  assert.throws(
    () => P.upsertStage(p, { ...stage('second-end'), destination: true }),
    { code: 'DESTINATION_EXISTS' },
  );
});
test('полное допустимое название цели сохраняется в условии без обрезания', () => {
  const title = 'ц'.repeat(200);
  const p = P.upsertStage(
    P.createPath(NOW),
    stage('b', [{ id: 'g', type: 'goal', goalId: 'long', title }]),
  );
  assert.equal(p.stages[1].criteria[0].title, title);
});
test('неполные сохранённые visual и avatar отклоняются до вычисления состояния', () => {
  for (const [object, field] of [
    ['snapshot', 'avatar'],
    ['snapshot', 'visual'],
    ['stage', 'visual'],
    ['path', 'avatar'],
  ]) {
    const p = P.createPath(NOW);
    const target =
      object === 'snapshot'
        ? p.stages[0].snapshot
        : object === 'stage'
          ? p.stages[0]
          : p;
    delete target[field];
    assert.throws(
      () => P.validatePath(p),
      { code: 'INVALID_DATA' },
      object + '.' + field,
    );
  }
  const partial = P.createPath(NOW);
  delete partial.stages[0].snapshot.visual.energy;
  assert.throws(() => P.validatePath(partial), { code: 'INVALID_DATA' });
});
