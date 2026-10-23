import * as THREE from './vendor/three/three.module.min.js';
import { material, mesh, box, sphere, capsule, part } from './path-mesh.js';

export function addHeadFeatures(head, { skin, hair }) {
  const ivory = material('#e8e5db'),
    ink = material('#263343');
  const brows = [],
    eyes = [];
  for (const side of [-1, 1]) {
    sphere(head, skin, side * 0.238, -0.025, -0.005, 0.046, 0.073, 0.045);
    const eye = part(head, 'eye');
    eye.position.set(side * 0.087, 0.019, 0.205);
    sphere(eye, ivory, 0, 0, 0, 0.049, 0.032, 0.022).name = 'eye-white';
    sphere(eye, ink, -side * 0.004, 0, 0.02, 0.023, 0.029, 0.012);
    sphere(eye, ivory, -side * 0.01, 0.009, 0.031, 0.007, 0.008, 0.004);
    eyes.push(eye);
    const brow = capsule(head, hair, side * 0.09, 0.086, 0.208, 0.014, 0.058);
    brows.push(brow);
  }
  sphere(head, skin, 0, -0.035, 0.221, 0.031, 0.061, 0.032);
  sphere(head, skin, 0, -0.058, 0.24, 0.038, 0.03, 0.032);
  const hairstyles = {},
    hairRoot = part(head, 'hair-locks');
  for (const name of ['swept', 'short', 'curls', 'buzz', 'bald']) {
    const group = part(hairRoot, 'hair-' + name);
    hairstyles[name] = group;
    if (name === 'bald') continue;
    const buzz = name === 'buzz';
    const cap = mesh(
      group,
      new THREE.SphereGeometry(1, 24, 16, 0, Math.PI * 2, 0, Math.PI * 0.57),
      hair,
      0,
      buzz ? 0.05 : 0.07,
      -0.025,
    );
    cap.scale.set(
      buzz ? 0.248 : 0.26,
      buzz ? 0.257 : 0.265,
      buzz ? 0.228 : 0.235,
    );
    cap.rotation.x = -0.19;
    if (name === 'curls') {
      for (let i = 0; i < 16; i++) {
        const angle = i * 2.4,
          ring = i < 8 ? 0.19 : 0.11;
        sphere(
          group,
          hair,
          Math.cos(angle) * ring,
          i < 8 ? 0.23 : 0.31,
          Math.sin(angle) * ring - 0.02,
          0.078,
          0.075,
          0.078,
        );
      }
    } else if (!buzz) {
      for (let i = 0; i < 5; i++) {
        const lock = sphere(
          group,
          hair,
          -0.15 + i * 0.067,
          0.23 + Math.sin(i) * 0.018,
          0.105,
          0.072,
          name === 'short' ? 0.052 : 0.105,
          0.115,
        );
        lock.rotation.z = name === 'short' ? -0.15 : -0.5;
        lock.rotation.x = -0.3;
      }
    }
    if (!buzz)
      for (const side of [-1, 1])
        sphere(group, hair, side * 0.216, 0.065, -0.03, 0.037, 0.11, 0.12);
  }
  const beards = {},
    stubble = material('#665145');
  for (const name of ['none', 'stubble', 'beard']) {
    const group = part(head, 'beard-' + name);
    beards[name] = group;
    if (name === 'none') continue;
    const beard = mesh(
      group,
      new THREE.SphereGeometry(
        1,
        24,
        14,
        0,
        Math.PI * 2,
        Math.PI * 0.61,
        Math.PI * 0.39,
      ),
      name === 'stubble' ? stubble : hair,
      0,
      name === 'beard' ? -0.018 : 0,
      0.006,
    );
    beard.scale.set(0.245, name === 'beard' ? 0.38 : 0.312, 0.23);
    if (name === 'beard')
      for (const side of [-1, 1]) {
        const moustache = sphere(
          group,
          hair,
          side * 0.043,
          -0.102,
          0.239,
          0.056,
          0.018,
          0.026,
        );
        moustache.rotation.z = side * -0.15;
      }
  }
  const glasses = {};
  for (const name of ['none', 'round', 'square']) {
    const group = part(head, 'glasses-' + name);
    glasses[name] = group;
    if (name === 'none') continue;
    for (const side of [-1, 1]) {
      let geometry;
      if (name === 'round')
        geometry = new THREE.TorusGeometry(0.065, 0.009, 7, 24);
      else {
        const pts = [
          [-0.061, -0.039],
          [-0.072, 0],
          [-0.061, 0.041],
          [0, 0.045],
          [0.061, 0.041],
          [0.072, 0],
          [0.061, -0.039],
          [0, -0.043],
        ];
        geometry = new THREE.TubeGeometry(
          new THREE.CatmullRomCurve3(
            pts.map(([x, y]) => new THREE.Vector3(x, y, 0)),
            true,
          ),
          32,
          0.009,
          6,
          true,
        );
      }
      mesh(group, geometry, ink, side * 0.09, 0.022, 0.251);
      box(group, ink, side * 0.16, 0.025, 0.114, 0.014, 0.015, 0.26);
    }
    box(group, ink, 0, 0.036, 0.252, 0.054, 0.012, 0.012);
  }
  const expressions = {};
  for (const name of ['softSmile', 'confident', 'calm']) {
    const group = part(head, 'expression-' + name);
    expressions[name] = group;
    const lip = material('#82544b');
    if (name === 'calm') {
      const mouth = capsule(group, lip, 0, -0.125, 0.247, 0.007, 0.056);
      mouth.rotation.z = Math.PI / 2;
    } else {
      const smile = mesh(
        group,
        new THREE.TorusGeometry(
          name === 'confident' ? 0.061 : 0.052,
          0.008,
          6,
          20,
          Math.PI * 0.76,
        ),
        lip,
        0,
        -0.113,
        0.249,
      );
      smile.rotation.z = Math.PI * 1.12;
      if (name === 'confident')
        box(group, ivory, 0, -0.133, 0.251, 0.071, 0.014, 0.008);
    }
  }
  return { hairstyles, beards, glasses, expressions, brows, eyes, stubble };
}
