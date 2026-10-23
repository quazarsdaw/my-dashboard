const test = require('node:test');
const assert = require('node:assert/strict');
const load = (file) => import('../' + file);
const stage = (outfit = 'casual', scene = 'work', setting = 1) => ({
  index: 1,
  visual: { outfit, scene, setting, energy: 70 },
  avatar: { skin: '#c99572', hair: '#29221f' },
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
