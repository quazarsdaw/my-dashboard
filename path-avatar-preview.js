import * as THREE from './vendor/three/three.module.min.js';
import { makePerson, applyPerson } from './path-avatar.js?v=3';
import { material, cylinder, disposeTree } from './path-mesh.js';

export function createAvatarPreview(container, stage) {
  const renderer = new THREE.WebGLRenderer({
    antialias: true,
    powerPreference: 'low-power',
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.6));
  renderer.setClearColor('#20242c');
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.25;
  const canvas = renderer.domElement;
  canvas.setAttribute('aria-hidden', 'true');
  canvas.style.touchAction = 'pan-y';
  container.append(canvas);
  const world = new THREE.Scene();
  world.add(new THREE.HemisphereLight('#dce8ff', '#554b43', 2.5));
  const key = new THREE.DirectionalLight('#ffedcf', 3.5);
  key.position.set(-3, 5, 6);
  world.add(key);
  const rim = new THREE.DirectionalLight('#b3caff', 2);
  rim.position.set(3, 3, -3);
  world.add(rim);
  const person = makePerson(stage);
  world.add(person.group);
  cylinder(world, material('#525b59'), 0, -0.055, 0, 0.7, 0.11);
  const camera = new THREE.OrthographicCamera(-1.8, 1.8, 1.8, -1.8, 0.1, 30);
  camera.position.set(1.5, 2.55, 6);
  camera.lookAt(0, 1.3, 0);
  let frame = 0,
    disposed = false,
    lost = false,
    pointer = null;
  const draw = () => {
    frame = 0;
    if (!disposed && !lost) renderer.render(world, camera);
  };
  const invalidate = () => {
    if (!frame && !disposed && !lost) frame = requestAnimationFrame(draw);
  };
  const resize = new ResizeObserver(() => {
    const { width, height } = container.getBoundingClientRect();
    if (!width || !height) return;
    renderer.setSize(width, height, false);
    camera.left = (-1.8 * width) / height;
    camera.right = (1.8 * width) / height;
    camera.updateProjectionMatrix();
    invalidate();
  });
  resize.observe(container);
  const down = (e) => {
    if (e.button === 0) pointer = e.clientX;
  };
  const move = (e) => {
    if (pointer === null) return;
    person.group.rotation.y += (e.clientX - pointer) * 0.012;
    pointer = e.clientX;
    invalidate();
  };
  const up = () => {
    pointer = null;
  };
  const onLost = (e) => {
    e.preventDefault();
    lost = true;
    canvas.hidden = true;
    container.dispatchEvent(new CustomEvent('avatar-preview-unavailable'));
  };
  canvas.addEventListener('pointerdown', down);
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', up);
  window.addEventListener('pointercancel', up);
  canvas.addEventListener('webglcontextlost', onLost);
  applyPerson(person, stage, stage, 1);
  invalidate();
  return {
    setAvatar(avatar) {
      if (disposed) return;
      const next = { ...stage, avatar };
      applyPerson(person, next, next, 1);
      invalidate();
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      cancelAnimationFrame(frame);
      resize.disconnect();
      canvas.removeEventListener('pointerdown', down);
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      canvas.removeEventListener('webglcontextlost', onLost);
      disposeTree(world);
      renderer.dispose();
      renderer.forceContextLoss();
      canvas.remove();
    },
  };
}
