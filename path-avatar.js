import * as THREE from './vendor/three/three.module.min.js';
import {
  material,
  mesh,
  box,
  sphere,
  cylinder,
  capsule,
  part,
} from './path-mesh.js';

// Небольшая скульптурная фигурка. Силуэты одежды отдельные, лицо и тело общие.
export function makePerson(stage) {
  const group = new THREE.Group();
  const skin = material(stage.avatar.skin, 0.93),
    hair = material(stage.avatar.hair);
  const ivory = material('#e8e5db'),
    dark = material('#263343');
  const cloth = material('#748e9d'),
    sole = material('#d7d4c9'),
    leather = material('#3a3434');
  const body = part(group, 'body');
  body.position.y = 1.12;
  // Плавный сужающийся силуэт вместо составленного из шаров корпуса.
  const profile = [
    [0.235, -0.02],
    [0.27, 0.08],
    [0.29, 0.38],
    [0.32, 0.57],
    [0.27, 0.67],
    [0.13, 0.71],
  ];
  const torsoGeometry = new THREE.LatheGeometry(
    profile.map(([x, y]) => new THREE.Vector2(x, y)),
    24,
  );
  const torso = mesh(body, torsoGeometry, cloth);
  torso.scale.z = 0.64;
  cylinder(body, skin, 0, 0.76, 0, 0.103, 0.22);
  const head = part(body, 'face');
  head.position.set(0, 1.06, 0);
  const face = sphere(head, skin, 0, 0, 0, 0.245, 0.31, 0.225);
  // Более узкая челюсть сохраняет читаемый подбородок даже в маленькой сцене.
  const pos = face.geometry.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    if (pos.getY(i) < -0.1) pos.setX(i, pos.getX(i) * (1 + pos.getY(i) * 0.18));
  }
  face.geometry.computeVertexNormals();
  for (const side of [-1, 1]) {
    sphere(head, skin, side * 0.238, -0.025, -0.005, 0.046, 0.073, 0.045);
    sphere(
      head,
      material('#ac755d'),
      side * 0.263,
      -0.025,
      0.008,
      0.014,
      0.038,
      0.025,
    );
    sphere(head, ivory, side * 0.086, 0.015, 0.203, 0.039, 0.022, 0.018);
    sphere(head, dark, side * 0.081, 0.016, 0.22, 0.017, 0.02, 0.009);
    sphere(head, ivory, side * 0.075, 0.024, 0.228, 0.005, 0.006, 0.003);
    const brow = capsule(head, hair, side * 0.087, 0.081, 0.207, 0.012, 0.052);
    brow.rotation.z = Math.PI / 2 + side * 0.09;
  }
  sphere(head, skin, 0, -0.035, 0.221, 0.031, 0.063, 0.032);
  sphere(head, skin, 0, -0.058, 0.24, 0.038, 0.03, 0.032);
  const smile = mesh(
    head,
    new THREE.TorusGeometry(0.052, 0.007, 6, 16, Math.PI * 0.72),
    material('#80564d'),
    0,
    -0.115,
    0.211,
  );
  smile.rotation.z = Math.PI * 1.14;
  const hairGroup = part(head, 'hair-locks');
  const cap = mesh(
    hairGroup,
    new THREE.SphereGeometry(1, 24, 16, 0, Math.PI * 2, 0, Math.PI * 0.58),
    hair,
    0,
    0.07,
    -0.025,
  );
  cap.scale.set(0.256, 0.263, 0.232);
  cap.rotation.x = -0.2;
  // Направленные пряди, виски и затылок дают стрижке отдельный силуэт.
  for (let i = 0; i < 5; i++) {
    const lock = sphere(
      hairGroup,
      hair,
      -0.15 + i * 0.067,
      0.22 + Math.sin(i) * 0.018,
      0.105,
      0.072,
      0.105,
      0.12,
    );
    lock.rotation.z = -0.5;
    lock.rotation.x = -0.3;
  }
  for (const side of [-1, 1])
    sphere(hairGroup, hair, side * 0.216, 0.065, -0.03, 0.037, 0.11, 0.12);
  const arms = [];
  for (const side of [-1, 1]) {
    const arm = part(body, 'arm');
    arm.position.set(side * 0.305, 0.57, 0);
    capsule(arm, cloth, 0, -0.115, 0, 0.096, 0.21);
    capsule(arm, skin, 0, -0.4, 0.012, 0.066, 0.25);
    sphere(arm, skin, 0, -0.585, 0.025, 0.067, 0.093, 0.052);
    sphere(arm, skin, -side * 0.051, -0.566, 0.048, 0.025, 0.047, 0.025);
    arms.push(arm);
    capsule(group, dark, side * 0.145, 0.61, 0, 0.118, 0.72);
    const foot = part(group, 'shoe');
    foot.position.set(side * 0.145, 0, 0.035);
    foot.rotation.y = side * 0.07;
    sphere(foot, sole, 0, 0.068, 0.055, 0.135, 0.055, 0.225);
    sphere(foot, ivory, 0, 0.119, 0.055, 0.124, 0.077, 0.204);
    box(foot, cloth, 0, 0.155, -0.01, 0.14, 0.065, 0.16);
    const laces = part(foot, 'shoe-laces');
    for (let i = 0; i < 3; i++)
      box(
        laces,
        sole,
        0,
        0.193 - i * 0.009,
        0.025 + i * 0.035,
        0.1,
        0.012,
        0.012,
      );
  }
  const outfits = {};
  for (const name of ['casual', 'sport', 'smart', 'hoodie', 'coat']) {
    const details = part(body, 'outfit-' + name);
    outfits[name] = details;
    details.visible = false;
    if (name === 'casual') {
      // Ворот футболки, шов и неброский нагрудный карман.
      const collar = mesh(
        details,
        new THREE.TorusGeometry(0.105, 0.018, 6, 24),
        ivory,
        0,
        0.67,
        0.015,
      );
      collar.rotation.x = Math.PI / 2;
      box(details, cloth, 0.14, 0.42, 0.193, 0.095, 0.105, 0.015);
      box(details, ivory, 0.14, 0.467, 0.204, 0.087, 0.008, 0.008);
    }
    if (name === 'sport') {
      box(details, ivory, 0, 0.31, 0.199, 0.018, 0.59, 0.014);
      for (const side of [-1, 1]) {
        box(details, ivory, side * 0.24, 0.37, 0.13, 0.022, 0.44, 0.022);
        box(details, ivory, side * 0.08, 0.2, 0.195, 0.085, 0.012, 0.014);
      }
    }
    if (name === 'smart' || name === 'coat') {
      const jacket = mesh(
        details,
        torsoGeometry.clone(),
        cloth,
        0,
        name === 'coat' ? -0.12 : -0.015,
        -0.005,
      );
      jacket.scale.set(1.08, name === 'coat' ? 1.47 : 1.03, 0.71);
      box(details, ivory, 0, 0.4, 0.212, 0.17, 0.47, 0.018);
      for (const side of [-1, 1]) {
        const lapel = box(
          details,
          cloth,
          side * 0.095,
          0.46,
          0.232,
          0.092,
          0.37,
          0.024,
        );
        lapel.rotation.z = side * -0.27;
        box(details, leather, side * 0.19, 0.16, 0.218, 0.105, 0.016, 0.012);
      }
      const tie = box(
        details,
        material('#b48464'),
        0,
        0.43,
        0.237,
        0.039,
        0.27,
        0.016,
      );
      tie.rotation.z = -0.025;
      for (let i = 0; i < 3; i++)
        sphere(
          details,
          leather,
          0.047,
          0.24 - i * 0.1,
          0.235,
          0.013,
          0.013,
          0.012,
        );
    }
    if (name === 'hoodie') {
      const hood = mesh(
        details,
        new THREE.TorusGeometry(0.17, 0.075, 10, 24, Math.PI * 1.6),
        cloth,
        0,
        0.72,
        -0.03,
      );
      hood.rotation.x = 0.46;
      hood.rotation.z = Math.PI * 0.7;
      sphere(details, cloth, 0, 0.15, 0.182, 0.18, 0.105, 0.035);
      box(details, ivory, 0, 0.025, 0.176, 0.43, 0.055, 0.035);
      for (const side of [-1, 1]) {
        const cord = capsule(
          details,
          ivory,
          side * 0.07,
          0.51,
          0.205,
          0.009,
          0.2,
        );
        cord.rotation.z = side * 0.12;
      }
    }
  }
  // Длинные рукава следуют за руками, а не остаются висеть у корпуса.
  const sleeves = arms.map((arm) => {
    const sleeve = part(arm, 'long-sleeve');
    capsule(sleeve, cloth, 0, -0.36, 0.01, 0.082, 0.29);
    cylinder(sleeve, ivory, 0, -0.53, 0.016, 0.079, 0.045);
    return sleeve;
  });
  group.rotation.y = -0.08;
  return { group, body, head, arms, cloth, skin, hair, outfits, sleeves };
}

export function applyPerson(person, from, to, t) {
  const mix = Math.max(0, Math.min(1, t));
  const energy =
    (from.visual.energy + (to.visual.energy - from.visual.energy) * mix) / 100;
  person.body.rotation.x = (1 - energy) * 0.16;
  person.head.rotation.x = (1 - energy) * 0.13;
  person.head.rotation.z = (1 - energy) * -0.055;
  person.arms.forEach((arm, i) => {
    arm.rotation.z = (i === 0 ? -1 : 1) * (0.035 + energy * 0.12);
    arm.rotation.x = -0.03 - energy * 0.06;
  });
  const palette = {
    casual: '#748e9d',
    sport: '#558d80',
    smart: '#414e66',
    hoodie: '#b38262',
    coat: '#8f7c69',
  };
  person.cloth.color
    .copy(new THREE.Color(palette[from.visual.outfit]))
    .lerp(new THREE.Color(palette[to.visual.outfit]), mix);
  person.skin.color
    .copy(new THREE.Color(from.avatar.skin))
    .lerp(new THREE.Color(to.avatar.skin), mix);
  person.hair.color
    .copy(new THREE.Color(from.avatar.hair))
    .lerp(new THREE.Color(to.avatar.hair), mix);
  const outfit = mix < 0.5 ? from.visual.outfit : to.visual.outfit;
  Object.entries(person.outfits).forEach(([key, group]) => {
    group.visible = key === outfit;
  });
  person.sleeves.forEach((sleeve) => {
    sleeve.visible = outfit !== 'casual';
  });
}
