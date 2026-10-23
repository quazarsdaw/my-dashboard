import * as THREE from './vendor/three/three.module.min.js';
import { material, box, disposeTree } from './path-mesh.js';
import { makePerson, applyPerson } from './path-avatar.js';
import { makeEnvironment } from './path-environment.js';

// Сцена получает готовые состояния и никогда не меняет данные пути.
export function createScene(container, onSelect) {
  const renderer = new THREE.WebGLRenderer({
    antialias: true,
    alpha: false,
    powerPreference: 'low-power',
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.6));
  renderer.setClearColor('#20232b');
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.3;
  const canvas = renderer.domElement;
  canvas.setAttribute('aria-hidden', 'true');
  container.append(canvas);
  const world = new THREE.Scene();
  world.fog = new THREE.Fog('#20232b', 13, 32);
  const camera = new THREE.OrthographicCamera(-6, 6, 3.5, -3.5, 0.1, 70);
  const hemi = new THREE.HemisphereLight('#d4e2ff', '#4d4351', 2.5);
  world.add(hemi);
  const key = new THREE.DirectionalLight('#fff0d4', 4);
  key.position.set(-3, 8, 6);
  key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024);
  key.shadow.camera.left = -12;
  key.shadow.camera.right = 12;
  key.shadow.camera.top = 12;
  key.shadow.camera.bottom = -12;
  key.shadow.bias = -0.001;
  world.add(key);
  const rim = new THREE.DirectionalLight('#a9caff', 2);
  rim.position.set(5, 4, -5);
  world.add(rim);
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(100, 100),
    new THREE.MeshStandardMaterial({ color: '#20232b', roughness: 1 }),
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -1.8;
  floor.receiveShadow = true;
  world.add(floor);
  const root = new THREE.Group();
  world.add(root);
  const raycaster = new THREE.Raycaster(),
    pointer = new THREE.Vector2();
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)');
  let items = [],
    selectedIndex = 0,
    selectionId = null,
    avatar = null,
    preview = null,
    previous = null;
  let yaw = 0.3,
    pitch = 0.28,
    frame = 0,
    disposed = false,
    tween = null,
    pressed = null,
    resize;
  let compact = container.clientWidth < 600;
  const pickables = [];
  let currentProps = null,
    previousProps = null;
  function rebuild() {
    disposeTree(root);
    root.clear();
    pickables.length = 0;
    avatar = null;
    currentProps = null;
    previousProps = null;
    const neighbours = 1;
    const start = Math.max(0, selectedIndex - neighbours),
      end = Math.min(items.length, selectedIndex + neighbours + 1);
    for (let i = start; i < end; i++) {
      const v = items[i],
        relative = i - selectedIndex,
        x = relative * 3.25,
        y = relative * 0.57;
      const tile = new THREE.Group();
      tile.position.set(x, y, 0);
      root.add(tile);
      const selected = i === selectedIndex;
      const mat = material(
        selected ? '#7a6744' : v.state === 'completed' ? '#3e5554' : '#353d4b',
      );
      const block = box(
        tile,
        mat,
        0,
        (-1.73 - y) / 2 - 0.07,
        0,
        2.98,
        1.73 + y,
        2.65,
      );
      block.userData.id = v.id;
      pickables.push(block);
      const slab = box(
        tile,
        material(selected ? '#c9a66a' : '#4d586a'),
        0,
        -0.055,
        0,
        3,
        0.11,
        2.67,
      );
      slab.userData.id = v.id;
      pickables.push(slab);
      if (selected) {
        const edges = new THREE.LineSegments(
          new THREE.EdgesGeometry(new THREE.BoxGeometry(3.01, 0.115, 2.68)),
          new THREE.LineBasicMaterial({ color: '#f2c063' }),
        );
        edges.position.y = -0.052;
        tile.add(edges);
      }
      const person = makePerson(v);
      tile.add(person.group);
      applyPerson(person, v, v, 1);
      person.group.position.set(-0.48, 0.03, 0.4);
      const environment = makeEnvironment(v, { compact: !selected || compact });
      tile.add(environment);
      if (selected) {
        avatar = person;
        currentProps = environment;
        previousProps = makeEnvironment(items[Math.max(0, i - 1)], { compact });
        tile.add(previousProps);
        previousProps.visible = false;
      }
      // Скрытые будущие ступени показываются навигатором, а не бесконечной сценой.
    }
    previous = items[Math.max(0, selectedIndex - 1)];
    preview = items[selectedIndex];
    invalidate();
  }
  function poseCamera() {
    const radius = 9;
    camera.position.set(
      Math.sin(yaw) * radius,
      3.8 + pitch * 3,
      Math.cos(yaw) * radius,
    );
    camera.lookAt(0, 1, 0);
  }
  function draw(now) {
    frame = 0;
    if (disposed || document.hidden) return;
    if (tween) {
      const t = Math.min(1, (now - tween.start) / 240),
        e = 1 - Math.pow(1 - t, 4);
      yaw = tween.fromYaw + (tween.toYaw - tween.fromYaw) * e;
      pitch = tween.fromPitch + (tween.toPitch - tween.fromPitch) * e;
      if (t === 1) tween = null;
    }
    poseCamera();
    renderer.render(world, camera);
    if (tween) invalidate();
  }
  function invalidate() {
    if (!frame && !disposed) frame = requestAnimationFrame(draw);
  }
  function resetCamera() {
    if (reduce.matches) {
      yaw = 0.3;
      pitch = 0.28;
      tween = null;
    } else
      tween = {
        fromYaw: yaw,
        toYaw: 0.3,
        fromPitch: pitch,
        toPitch: 0.28,
        start: performance.now(),
      };
    invalidate();
  }
  const down = (e) => {
    if (e.button !== 0) return;
    pressed = { x: e.clientX, y: e.clientY, last: e.clientX, moved: false };
  };
  const move = (e) => {
    if (!pressed) return;
    const delta = e.clientX - pressed.last;
    if (Math.abs(e.clientX - pressed.x) > 6) pressed.moved = true;
    if (pressed.moved) {
      yaw = Math.max(-1.05, Math.min(1.05, yaw + delta * 0.006));
      tween = null;
      pressed.last = e.clientX;
      invalidate();
    }
  };
  const up = (e) => {
    if (!pressed) return;
    const click = !pressed.moved;
    pressed = null;
    if (!click) return;
    const rect = canvas.getBoundingClientRect();
    if (
      e.clientX < rect.left ||
      e.clientX > rect.right ||
      e.clientY < rect.top ||
      e.clientY > rect.bottom
    )
      return;
    pointer.set(
      ((e.clientX - rect.left) / rect.width) * 2 - 1,
      -((e.clientY - rect.top) / rect.height) * 2 + 1,
    );
    raycaster.setFromCamera(pointer, camera);
    const hit = raycaster.intersectObjects(pickables, false)[0];
    if (hit) onSelect(hit.object.userData.id);
  };
  const cancel = () => {
    pressed = null;
  };
  const visibility = () => {
    if (!document.hidden) invalidate();
  };
  const lost = (e) => {
    e.preventDefault();
    canvas.hidden = true;
    container.dispatchEvent(new CustomEvent('scene-unavailable'));
  };
  canvas.addEventListener('pointerdown', down);
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', up);
  window.addEventListener('pointercancel', cancel);
  canvas.addEventListener('webglcontextlost', lost);
  document.addEventListener('visibilitychange', visibility);
  resize = new ResizeObserver(() => {
    const { width, height } = container.getBoundingClientRect();
    if (!width || !height) return;
    renderer.setSize(width, height, false);
    camera.left = -(width / height) * 3.5;
    camera.right = (width / height) * 3.5;
    camera.updateProjectionMatrix();
    const nextCompact = width < 600;
    if (nextCompact !== compact && items.length) {
      compact = nextCompact;
      rebuild();
    }
    invalidate();
  });
  resize.observe(container);
  return {
    setStages(next, id) {
      const changed =
        JSON.stringify(next) !== JSON.stringify(items) || selectionId !== id;
      if (!changed) return;
      items = next;
      selectionId = id;
      selectedIndex = Math.max(
        0,
        items.findIndex((s) => s.id === id),
      );
      rebuild();
    },
    compare(t) {
      if (!avatar) return;
      applyPerson(avatar, previous, preview, t);
      if (currentProps) currentProps.visible = t >= 0.5;
      if (previousProps) previousProps.visible = t < 0.5;
      invalidate();
    },
    resetCamera,
    dispose() {
      disposed = true;
      cancelAnimationFrame(frame);
      resize.disconnect();
      canvas.removeEventListener('pointerdown', down);
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', cancel);
      canvas.removeEventListener('webglcontextlost', lost);
      document.removeEventListener('visibilitychange', visibility);
      disposeTree(world);
      renderer.dispose();
      canvas.remove();
    },
  };
}
