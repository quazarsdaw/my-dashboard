const test = require('node:test');
const assert = require('node:assert/strict');
const P = require('../path-core.js');
const load = (file) => import('../' + file);
const stage = (outfit = 'casual', scene = 'work', setting = 1) => ({
  index: 1,
  visual: { outfit, scene, setting, energy: 70 },
  avatar: P.normalizeAvatar({ skin: '#c99572', hair: '#29221f' }),
});
test('редактор переключает волосы бороду очки и выражение на существующей модели', async () => {
  const { makePerson, applyPerson } = await load('path-avatar.js');
  const person = makePerson(stage());
  for (const [key, groupKey, values] of [
    ['hairStyle', 'hairstyles', ['swept', 'short', 'curls', 'buzz', 'bald']],
    ['facialHair', 'beards', ['none', 'stubble', 'beard']],
    ['glasses', 'glasses', ['none', 'round', 'square']],
    ['expression', 'expressions', ['softSmile', 'confident', 'calm']],
  ]) {
    for (const value of values) {
      const target = {
        ...stage(),
        avatar: { ...stage().avatar, [key]: value },
      };
      applyPerson(person, stage(), target, 1);
      assert.ok(person[groupKey], groupKey);
      for (const [variant, group] of Object.entries(person[groupKey]))
        assert.equal(group.visible, variant === value);
    }
  }
});
test('цвета одежды не перекрашивают глаза кожу и детали обуви', async () => {
  const { makePerson, applyPerson } = await load('path-avatar.js');
  const person = makePerson(stage());
  const target = {
    ...stage(),
    avatar: {
      ...stage().avatar,
      topColor: '#ee8833',
      pantsColor: '#aa4455',
      shoesColor: '#3399bb',
    },
  };
  applyPerson(person, stage(), target, 1);
  assert.equal(person.cloth.color.getHexString(), 'ee8833');
  assert.equal(person.pants.color.getHexString(), 'aa4455');
  assert.equal(person.shoes.color.getHexString(), '3399bb');
  assert.equal(
    person.group.getObjectByName('eye-white').material.color.getHexString(),
    'e8e5db',
  );
  assert.equal(person.skin.color.getHexString(), 'c99572');
  applyPerson(person, target, stage(), 1);
  assert.equal(person.pants.color.getHexString(), '263343');
});
test('лицо и телосложение меняются независимо, геометрия освобождается один раз', async () => {
  const { makePerson, applyPerson } = await load('path-avatar.js');
  const { disposeTree } = await load('path-mesh.js');
  const THREE = await load('vendor/three/three.module.min.js');
  const person = makePerson(stage());
  applyPerson(person, stage(), stage(), 1);
  const baseHead = new THREE.Vector3();
  person.group.updateMatrixWorld(true);
  person.head.getWorldScale(baseHead);
  const target = {
    ...stage(),
    avatar: { ...stage().avatar, bodyType: 'broad' },
  };
  applyPerson(person, stage(), target, 1);
  person.group.updateMatrixWorld(true);
  const broadHead = new THREE.Vector3();
  person.head.getWorldScale(broadHead);
  assert.ok(person.body.scale.x > 1);
  assert.ok(
    Math.abs(baseHead.x - broadHead.x) < 0.00001,
    'телосложение не раздувает лицо',
  );
  applyPerson(
    person,
    stage(),
    { ...stage(), avatar: { ...stage().avatar, faceShape: 'round' } },
    1,
  );
  assert.ok(person.head.scale.x > baseHead.x);
  const resources = new Map();
  person.group.traverse((o) => {
    for (const r of [
      o.geometry,
      ...(o.material ? [o.material].flat() : []),
    ].filter(Boolean)) {
      if (!resources.has(r)) {
        resources.set(r, 0);
        r.addEventListener('dispose', () =>
          resources.set(r, resources.get(r) + 1),
        );
      }
    }
  });
  disposeTree(person.group);
  assert.ok(resources.size > 20);
  assert.ok([...resources.values()].every((n) => n === 1));
});
test('каждая сцена содержит предметы даже на соседней ступени и помещается на площадке', async () => {
  const { makeEnvironment } = await load('path-environment.js');
  const THREE = await load('vendor/three/three.module.min.js');
  for (const scene of ['calm', 'work', 'graduate', 'fitness', 'creative']) {
    const group = makeEnvironment(stage('casual', scene, 2), { compact: true });
    assert.ok(group.getObjectByName('room-floor'));
    assert.ok(group.getObjectByName('personal-details'));
    const bounds = new THREE.Box3().setFromObject(group);
    assert.ok(
      bounds.min.x >= -1.51 && bounds.max.x <= 1.51,
      scene + ': ширина',
    );
    assert.ok(
      bounds.min.z >= -1.36 && bounds.max.z <= 1.36,
      scene + ': глубина',
    );
    group.traverse((o) => {
      if (o.isMesh) assert.ok(o.geometry.getAttribute('position').count > 0);
    });
  }
});
test('обустройство добавляет реальные предметы, не подменяя выбранную сцену', async () => {
  const { makeEnvironment } = await load('path-environment.js');
  for (const scene of ['calm', 'work', 'graduate', 'fitness', 'creative']) {
    const simple = makeEnvironment(stage('casual', scene, 0));
    const rich = makeEnvironment(stage('casual', scene, 2));
    assert.ok(simple.getObjectByName('scene-' + scene));
    assert.ok(rich.getObjectByName('scene-' + scene));
    assert.equal(simple.getObjectByName('personal-details'), undefined);
    assert.ok(rich.getObjectByName('personal-details'));
    assert.ok(rich.getObjectByName('plant'));
  }
});
test('сравнение меняет силуэт одежды и позу без пересоздания персонажа', async () => {
  const { makePerson, applyPerson } = await load('path-avatar.js');
  const person = makePerson(stage());
  const group = person.group;
  for (const outfit of ['casual', 'sport', 'smart', 'hoodie', 'coat']) {
    applyPerson(person, stage('casual'), stage(outfit), 1);
    assert.equal(person.group, group);
    for (const [key, clothes] of Object.entries(person.outfits)) {
      assert.equal(clothes.visible, key === outfit);
    }
  }
  applyPerson(
    person,
    { ...stage(), visual: { ...stage().visual, energy: 0 } },
    stage('smart'),
    0,
  );
  const tired = person.body.rotation.x;
  applyPerson(
    person,
    stage(),
    { ...stage('smart'), visual: { ...stage('smart').visual, energy: 100 } },
    1,
  );
  assert.ok(person.body.rotation.x < tired);
  assert.ok(person.group.getObjectByName('shoe-laces'));
  assert.ok(person.group.getObjectByName('hair-locks'));
});
