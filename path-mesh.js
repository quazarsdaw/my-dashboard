import * as THREE from './vendor/three/three.module.min.js';

export const material = (color, roughness = 0.78) =>
  new THREE.MeshStandardMaterial({ color, roughness });

export function mesh(group, geometry, mat, x = 0, y = 0, z = 0) {
  const item = new THREE.Mesh(geometry, mat);
  item.position.set(x, y, z);
  item.castShadow = true;
  item.receiveShadow = true;
  group.add(item);
  return item;
}
export function box(group, mat, x, y, z, w, h, d) {
  return mesh(group, new THREE.BoxGeometry(w, h, d), mat, x, y, z);
}
export function sphere(group, mat, x, y, z, sx, sy, sz) {
  const item = mesh(group, new THREE.SphereGeometry(1, 20, 14), mat, x, y, z);
  item.scale.set(sx, sy, sz);
  return item;
}
export function cylinder(group, mat, x, y, z, r, h, top = r) {
  return mesh(group, new THREE.CylinderGeometry(top, r, h, 20), mat, x, y, z);
}
export function capsule(group, mat, x, y, z, r, length) {
  return mesh(group, new THREE.CapsuleGeometry(r, length, 5, 12), mat, x, y, z);
}
export function part(parent, name) {
  const group = new THREE.Group();
  group.name = name;
  parent.add(group);
  return group;
}
export function disposeTree(group) {
  const geometries = new Set(),
    materials = new Set();
  group.traverse((o) => {
    if (o.geometry) geometries.add(o.geometry);
    if (o.material)
      (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) =>
        materials.add(m),
      );
  });
  geometries.forEach((g) => g.dispose());
  materials.forEach((m) => {
    if (m.map) m.map.dispose();
    m.dispose();
  });
}
