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

// Каждая ступень — небольшая открытая комната. Детали определяются выбором
// пользователя, а не размером дохода, количеством галочек или статусом ступени.
export function makeEnvironment(stage, { compact = false } = {}) {
  const room = new THREE.Group();
  const level = stage.visual.setting ?? (stage.index === 0 ? 0 : 1);
  const wood = material('#8d7054'),
    oak = material('#b59a75'),
    metal = material('#424a53');
  const paper = material('#e4dbbd'),
    ivory = material('#d4c9af'),
    green = material('#6c8770');
  const clay = material('#b98065'),
    dark = material('#303f4c');
  const accent = {
    calm: '#708a7c',
    work: '#667e91',
    graduate: '#9c7656',
    fitness: '#668d85',
    creative: '#a88070',
  }[stage.visual.scene];
  const fabric = material(accent);
  const floor = box(room, material('#786c5b'), 0, 0.013, 0, 2.94, 0.026, 2.56);
  floor.name = 'room-floor';
  // Швы паркета читаются как фактура, без картинок и внешних текстур.
  for (let i = 0; i < 6; i++)
    box(room, oak, -1.22 + i * 0.48, 0.028, 0, 0.009, 0.002, 2.5);
  const scene = part(room, 'scene-' + stage.visual.scene);
  function books(parent, x, y, z, count = 4, horizontal = false) {
    const group = part(parent, 'books');
    const covers = ['#657d90', '#ae805f', '#809478', '#d4b77f', '#697185'];
    for (let i = 0; i < count; i++) {
      const h = 0.23 + (i % 3) * 0.055;
      const book = part(group, 'book');
      book.position.set(
        x + (horizontal ? 0 : i * 0.075),
        y + (horizontal ? i * 0.065 : h / 2),
        z,
      );
      if (horizontal) book.rotation.z = Math.PI / 2;
      box(book, material(covers[i % covers.length]), 0, 0, 0, 0.058, h, 0.19);
      box(book, paper, 0, 0, 0.101, 0.038, h * 0.86, 0.01);
      box(book, ivory, 0, -h * 0.3, 0.108, 0.045, 0.013, 0.01);
    }
    return group;
  }
  function plant(parent, x, z, size = 1) {
    const group = part(parent, 'plant');
    group.position.set(x, 0.03, z);
    group.scale.setScalar(size);
    cylinder(group, clay, 0, 0.17, 0, 0.16, 0.3, 0.19);
    cylinder(group, material('#493d32'), 0, 0.323, 0, 0.167, 0.015);
    cylinder(group, wood, 0, 0.56, 0, 0.018, 0.49);
    for (let i = 0; i < (compact ? 5 : 7); i++) {
      const angle = i * 2.4;
      const leaf = sphere(
        group,
        green,
        Math.cos(angle) * 0.105,
        0.52 + i * 0.047,
        Math.sin(angle) * 0.105,
        0.09,
        0.2,
        0.038,
      );
      leaf.rotation.set(Math.sin(angle) * 0.6, -angle, Math.cos(angle) * 0.7);
    }
    return group;
  }
  function mug(parent, x, y, z) {
    cylinder(parent, ivory, x, y + 0.06, z, 0.052, 0.12);
    cylinder(parent, material('#68513e'), x, y + 0.122, z, 0.042, 0.003);
    mesh(
      parent,
      new THREE.TorusGeometry(0.038, 0.012, 6, 12),
      ivory,
      x + 0.055,
      y + 0.064,
      z,
    );
  }
  function frame(parent, x, y, z, w = 0.46, h = 0.36, diploma = false) {
    box(parent, oak, x, y, z, w, h, 0.035);
    box(parent, paper, x, y, z + 0.021, w - 0.055, h - 0.055, 0.008);
    if (diploma) {
      for (let i = 0; i < 3; i++)
        box(
          parent,
          dark,
          x,
          y + 0.07 - i * 0.044,
          z + 0.03,
          w * (i === 0 ? 0.55 : 0.66),
          0.012,
          0.005,
        );
      cylinder(
        parent,
        clay,
        x + 0.1,
        y - 0.07,
        z + 0.03,
        0.035,
        0.009,
      ).rotation.x = Math.PI / 2;
    } else {
      box(
        parent,
        fabric,
        x - 0.05,
        y - 0.03,
        z + 0.029,
        w * 0.45,
        h * 0.58,
        0.006,
      ).rotation.z = -0.2;
      sphere(
        parent,
        clay,
        x + w * 0.16,
        y + h * 0.1,
        z + 0.033,
        0.07,
        0.07,
        0.008,
      );
    }
  }
  function desk(parent) {
    const group = part(parent, 'desk');
    box(group, oak, 0.72, 0.89, -0.61, 1.08, 0.075, 0.62);
    for (const x of [0.28, 1.16])
      for (const z of [-0.84, -0.38])
        box(group, metal, x, 0.45, z, 0.047, 0.85, 0.047);
    return group;
  }
  function laptop(parent, x, y, z) {
    box(parent, metal, x, y + 0.017, z + 0.08, 0.46, 0.027, 0.31);
    const lid = part(parent, 'laptop');
    lid.position.set(x, y + 0.19, z - 0.063);
    lid.rotation.x = -0.15;
    box(lid, metal, 0, 0, 0, 0.46, 0.3, 0.025);
    box(lid, material('#90b2b4'), 0, 0, 0.016, 0.41, 0.252, 0.006);
    for (let i = 0; i < 3; i++)
      box(
        lid,
        paper,
        -0.043,
        0.05 - i * 0.04,
        0.02,
        0.22 - i * 0.03,
        0.012,
        0.003,
      );
    return lid;
  }
  function chair(parent, x, z) {
    const group = part(parent, 'chair');
    box(group, fabric, x, 0.49, z, 0.4, 0.09, 0.38);
    const back = box(group, fabric, x, 0.76, z + 0.15, 0.39, 0.49, 0.065);
    back.rotation.x = 0.1;
    cylinder(group, metal, x, 0.255, z, 0.035, 0.41);
    for (let i = 0; i < 4; i++) {
      const a = (i * Math.PI) / 2;
      const leg = box(
        group,
        metal,
        x + Math.cos(a) * 0.11,
        0.06,
        z + Math.sin(a) * 0.11,
        0.29,
        0.032,
        0.032,
      );
      leg.rotation.y = -a;
    }
    return group;
  }
  // Даже простой уровень содержит относящиеся к выбранной жизни вещи.
  if (stage.visual.scene === 'calm') {
    const seat = part(scene, 'armchair');
    box(seat, fabric, 0.72, 0.31, -0.49, 0.66, 0.34, 0.65);
    box(seat, fabric, 0.72, 0.65, -0.77, 0.66, 0.5, 0.12);
    for (const x of [0.39, 1.05])
      box(seat, fabric, x, 0.48, -0.48, 0.12, 0.34, 0.66);
    box(seat, ivory, 0.76, 0.56, -0.67, 0.29, 0.28, 0.1).rotation.z = -0.16;
    for (const x of [0.47, 0.98])
      for (const z of [-0.7, -0.26])
        cylinder(seat, wood, x, 0.08, z, 0.027, 0.14);
  } else if (stage.visual.scene === 'work') {
    desk(scene);
    laptop(scene, 0.72, 0.932, -0.64);
  } else if (stage.visual.scene === 'graduate') {
    desk(scene);
    books(scene, 0.41, 0.93, -0.66, 4);
    frame(scene, 0.99, 1.13, -0.85, 0.38, 0.32, true);
    box(scene, paper, 0.94, 0.94, -0.47, 0.3, 0.013, 0.22);
  } else if (stage.visual.scene === 'fitness') {
    const mat = box(scene, fabric, 0.72, 0.048, -0.3, 0.67, 0.035, 1.47);
    mat.name = 'exercise-mat';
    for (const x of [0.53, 0.95]) {
      const dumbbell = part(scene, 'dumbbell');
      cylinder(dumbbell, metal, x, 0.13, -0.76, 0.027, 0.29).rotation.z =
        Math.PI / 2;
      for (const side of [-1, 1])
        cylinder(
          dumbbell,
          dark,
          x + side * 0.1,
          0.13,
          -0.76,
          0.095,
          0.05,
        ).rotation.z = Math.PI / 2;
    }
    cylinder(scene, ivory, 1.14, 0.19, -0.17, 0.056, 0.3);
    cylinder(scene, metal, 1.14, 0.35, -0.17, 0.043, 0.035);
  } else if (stage.visual.scene === 'creative') {
    const easel = part(scene, 'easel');
    for (const side of [-1, 1]) {
      const leg = box(
        easel,
        oak,
        0.72 + side * 0.24,
        0.67,
        -0.6,
        0.035,
        1.37,
        0.035,
      );
      leg.rotation.z = side * -0.11;
    }
    box(easel, oak, 0.72, 0.83, -0.58, 0.67, 0.047, 0.12);
    frame(easel, 0.72, 1.12, -0.63, 0.63, 0.7);
    cylinder(scene, wood, 1.13, 0.42, 0.04, 0.21, 0.06);
    for (const dx of [-0.12, 0.12])
      box(scene, wood, 1.13 + dx, 0.22, 0.04, 0.035, 0.4, 0.035);
  }
  if (level >= 1) {
    const furnishing = part(room, 'furnishing');
    box(
      furnishing,
      material('#54615c'),
      -0.26,
      0.034,
      0.46,
      1.43,
      0.012,
      1.04,
    ).name = 'rug';
    box(furnishing, material('#58615b'), 0, 0.75, -1.245, 2.92, 1.48, 0.035);
    box(furnishing, oak, 0, 0.08, -1.22, 2.91, 0.11, 0.018);
    plant(furnishing, -1.11, -0.79, 0.85);
    if (['work', 'graduate'].includes(stage.visual.scene))
      chair(furnishing, 0.79, 0.11);
    if (stage.visual.scene === 'calm') {
      cylinder(furnishing, oak, 0.9, 0.43, 0.33, 0.25, 0.045);
      cylinder(furnishing, wood, 0.9, 0.23, 0.33, 0.035, 0.38);
      mug(furnishing, 0.92, 0.455, 0.33);
      books(furnishing, 0.9, 0.08, 0.58, 2, true);
    }
    if (stage.visual.scene === 'fitness') {
      const towel = box(furnishing, paper, 0.72, 0.081, 0.24, 0.5, 0.03, 0.23);
      towel.rotation.y = 0.13;
      sphere(furnishing, clay, 1.05, 0.25, 0.74, 0.23, 0.23, 0.23);
    }
    if (stage.visual.scene === 'creative') {
      cylinder(furnishing, ivory, 1.12, 0.52, 0.04, 0.055, 0.14);
      for (let i = 0; i < 3; i++)
        cylinder(furnishing, wood, 1.09 + i * 0.025, 0.68, 0.04, 0.009, 0.25);
    }
  }
  if (level >= 2) {
    const details = part(room, 'personal-details');
    // Полка, тёплый свет, часы и мелочи объединяют разные версии комнаты.
    box(details, oak, -0.62, 1.15, -1.1, 1.05, 0.045, 0.24);
    books(details, -0.98, 1.174, -1.09, 5);
    cylinder(details, clay, -0.26, 1.25, -1.09, 0.065, 0.15);
    sphere(details, green, -0.26, 1.42, -1.09, 0.11, 0.12, 0.085);
    frame(
      details,
      0.84,
      1.16,
      -1.21,
      0.54,
      0.43,
      stage.visual.scene === 'graduate',
    );
    cylinder(details, metal, -1.12, 0.66, 0.43, 0.015, 1.25);
    cylinder(details, metal, -1.12, 0.05, 0.43, 0.15, 0.035);
    cylinder(details, paper, -1.12, 1.26, 0.43, 0.19, 0.25, 0.115);
    const lamp = sphere(
      details,
      material('#efc98a'),
      -1.12,
      1.15,
      0.43,
      0.06,
      0.025,
      0.06,
    );
    lamp.material.emissive.set('#c29148');
    lamp.material.emissiveIntensity = 0.6;
    if (['work', 'graduate'].includes(stage.visual.scene)) {
      mug(details, 1.08, 0.932, -0.46);
      box(details, fabric, 0.34, 0.944, -0.4, 0.17, 0.023, 0.22);
      box(details, paper, 0.34, 0.959, -0.4, 0.15, 0.005, 0.19);
      if (stage.visual.scene === 'work') {
        cylinder(details, metal, 0.76, 1.02, -0.93, 0.018, 0.16);
        box(details, metal, 0.76, 1.29, -0.98, 0.77, 0.43, 0.035);
        box(
          details,
          material('#8faeaa'),
          0.76,
          1.29,
          -0.957,
          0.71,
          0.37,
          0.009,
        );
      }
    }
    if (stage.visual.scene === 'fitness') {
      box(details, oak, 0.76, 0.35, -1.08, 0.85, 0.06, 0.27);
      box(details, ivory, 0.76, 0.4, -1.06, 0.46, 0.05, 0.22);
    }
    if (stage.visual.scene === 'creative')
      books(details, 0.77, 0.03, 0.67, 3, true);
  }
  return room;
}
