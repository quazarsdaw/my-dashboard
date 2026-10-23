import * as THREE from './vendor/three/three.module.min.js';
import { addHeadFeatures } from './path-avatar-features.js?v=3';
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
    pants = material('#263343'),
    shoes = material('#e8e5db');
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
  const headAnchor = part(body, 'head-anchor');
  const head = part(headAnchor, 'face');
  head.position.set(0, 1.06, 0);
  const face = sphere(head, skin, 0, 0, 0, 0.245, 0.31, 0.225);
  // Более узкая челюсть сохраняет читаемый подбородок даже в маленькой сцене.
  const pos = face.geometry.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    if (pos.getY(i) < -0.1) pos.setX(i, pos.getX(i) * (1 + pos.getY(i) * 0.18));
  }
  face.geometry.computeVertexNormals();
  const features = addHeadFeatures(head, { skin, hair });
  const arms = [];
  const lower = part(group, 'lower-body');
  for (const side of [-1, 1]) {
    const arm = part(body, 'arm');
    arm.position.set(side * 0.305, 0.57, 0);
    capsule(arm, cloth, 0, -0.115, 0, 0.096, 0.21);
    capsule(arm, skin, 0, -0.4, 0.012, 0.066, 0.25);
    sphere(arm, skin, 0, -0.585, 0.025, 0.067, 0.093, 0.052);
    sphere(arm, skin, -side * 0.051, -0.566, 0.048, 0.025, 0.047, 0.025);
    arms.push(arm);
    capsule(lower, pants, side * 0.145, 0.61, 0, 0.118, 0.72);
    const foot = part(lower, 'shoe');
    foot.position.set(side * 0.145, 0, 0.035);
    foot.rotation.y = side * 0.07;
    sphere(foot, sole, 0, 0.068, 0.055, 0.135, 0.055, 0.225);
    sphere(foot, shoes, 0, 0.119, 0.055, 0.124, 0.077, 0.204);
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
  return {
    group,
    body,
    headAnchor,
    head,
    arms,
    lower,
    cloth,
    pants,
    shoes,
    skin,
    hair,
    outfits,
    sleeves,
    ...features,
  };
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
    .copy(new THREE.Color(from.avatar.topColor || palette[from.visual.outfit]))
    .lerp(
      new THREE.Color(to.avatar.topColor || palette[to.visual.outfit]),
      mix,
    );
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
  const appearance = mix < 0.5 ? from.avatar : to.avatar;
  const select = (groups, choice) =>
    Object.entries(groups).forEach(([name, node]) => {
      node.visible = name === choice;
    });
  select(person.hairstyles, appearance.hairStyle || 'swept');
  select(person.beards, appearance.facialHair || 'none');
  select(person.glasses, appearance.glasses || 'none');
  select(person.expressions, appearance.expression || 'softSmile');
  person.stubble.color.copy(person.hair.color).lerp(person.skin.color, 0.5);
  const build = { standard: 1, lean: 0.9, broad: 1.15 }[
    appearance.bodyType || 'standard'
  ];
  const face = { oval: [1, 1], round: [1.12, 0.95], angular: [1.035, 1.04] }[
    appearance.faceShape || 'oval'
  ];
  person.body.scale.x = build;
  person.lower.scale.x = build;
  person.headAnchor.scale.x = 1 / build;
  person.head.scale.set(1.16 * face[0], 1.1 * face[1], 1.12);
  person.brows.forEach((brow, i) => {
    brow.rotation.z =
      Math.PI / 2 +
      (i === 0 ? -1 : 1) *
        (appearance.expression === 'confident' ? -0.1 : 0.09);
  });
  person.eyes.forEach((eye) => {
    eye.scale.y = appearance.expression === 'calm' ? 0.82 : 1;
  });
  person.pants.color
    .copy(new THREE.Color(from.avatar.pantsColor || '#263343'))
    .lerp(new THREE.Color(to.avatar.pantsColor || '#263343'), mix);
  person.shoes.color
    .copy(new THREE.Color(from.avatar.shoesColor || '#e8e5db'))
    .lerp(new THREE.Color(to.avatar.shoesColor || '#e8e5db'), mix);
}
