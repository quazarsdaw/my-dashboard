import * as THREE from './vendor/three/three.module.min.js';

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
  const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 70);
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
  let yaw = 0.42,
    pitch = 0.28,
    frame = 0,
    disposed = false,
    tween = null,
    pressed = null,
    resize;
  const pickables = [];
  function material(color, roughness = 0.8) {
    return new THREE.MeshStandardMaterial({ color, roughness });
  }
  function mesh(group, geometry, mat, x = 0, y = 0, z = 0) {
    const m = new THREE.Mesh(geometry, mat);
    m.position.set(x, y, z);
    m.castShadow = true;
    m.receiveShadow = true;
    group.add(m);
    return m;
  }
  function sphere(group, mat, x, y, z, sx, sy, sz) {
    const m = mesh(group, new THREE.SphereGeometry(1, 20, 14), mat, x, y, z);
    m.scale.set(sx, sy, sz);
    return m;
  }
  function box(group, mat, x, y, z, w, h, d) {
    return mesh(group, new THREE.BoxGeometry(w, h, d), mat, x, y, z);
  }
  function cylinder(group, mat, x, y, z, r, h) {
    return mesh(group, new THREE.CylinderGeometry(r, r, h, 24), mat, x, y, z);
  }
  function capsule(group, mat, x, y, z, r, length) {
    return mesh(
      group,
      new THREE.CapsuleGeometry(r, length, 5, 12),
      mat,
      x,
      y,
      z,
    );
  }
  function disposeTree(group) {
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
  function makePerson(stage) {
    const group = new THREE.Group();
    const skin = material(stage.avatar.skin, 0.93),
      hair = material(stage.avatar.hair),
      pants = material('#252e42'),
      shoe = material('#b9becb');
    const cloth = material('#637c8f'),
      shirt = material('#e8e5df'),
      eye = material('#242630'),
      mouth = material('#754b43');
    const body = new THREE.Group();
    group.add(body);
    body.position.y = 1.18;
    const torso = mesh(
      body,
      new THREE.CylinderGeometry(0.3, 0.27, 0.68, 12),
      cloth,
      0,
      0.27,
    );
    torso.scale.z = 0.66;
    sphere(body, cloth, 0, 0.6, 0, 0.31, 0.16, 0.21);
    cylinder(body, skin, 0, 0.72, 0, 0.105, 0.18);
    const head = new THREE.Group();
    body.add(head);
    head.position.set(0, 1.02, 0);
    sphere(head, skin, 0, 0, 0, 0.255, 0.32, 0.245);
    sphere(head, skin, -0.25, -0.015, 0, 0.055, 0.085, 0.06);
    sphere(head, skin, 0.25, -0.015, 0, 0.055, 0.085, 0.06);
    const cap = mesh(
      head,
      new THREE.SphereGeometry(1, 20, 12, 0, Math.PI * 2, 0, Math.PI * 0.51),
      hair,
      0,
      0.075,
      -0.01,
    );
    cap.scale.set(0.27, 0.27, 0.26);
    cap.rotation.x = -0.12;
    sphere(head, hair, -0.07, 0.235, 0.12, 0.21, 0.1, 0.16);
    sphere(head, eye, -0.09, 0.012, 0.231, 0.025, 0.032, 0.018);
    sphere(head, eye, 0.09, 0.012, 0.231, 0.025, 0.032, 0.018);
    const nose = sphere(head, skin, 0, -0.05, 0.245, 0.04, 0.055, 0.045);
    const smile = mesh(
      head,
      new THREE.TorusGeometry(0.068, 0.009, 5, 16, Math.PI * 0.7),
      mouth,
      0,
      -0.105,
      0.23,
    );
    smile.rotation.z = Math.PI * 1.15;
    const arms = [];
    [-1, 1].forEach((side) => {
      const arm = new THREE.Group();
      body.add(arm);
      arm.position.set(side * 0.32, 0.52, 0);
      capsule(arm, cloth, 0, -0.16, 0, 0.105, 0.22);
      capsule(arm, skin, 0, -0.43, 0.02, 0.075, 0.23);
      sphere(arm, skin, 0, -0.61, 0.04, 0.08, 0.1, 0.07);
      arms.push(arm);
      capsule(group, pants, side * 0.15, 0.63, 0, 0.125, 0.7);
      const foot = sphere(
        group,
        shoe,
        side * 0.15,
        0.12,
        0.09,
        0.14,
        0.1,
        0.23,
      );
      foot.rotation.y = side * 0.07;
    });
    const jacket = [];
    [-1, 1].forEach((side) => {
      const lapel = box(body, shirt, side * 0.09, 0.4, 0.203, 0.1, 0.37, 0.018);
      lapel.rotation.z = side * -0.22;
      jacket.push(lapel);
    });
    const zip = box(body, shirt, 0, 0.25, 0.205, 0.025, 0.5, 0.015);
    const shorts = box(group, cloth, 0, 0.98, 0, 0.53, 0.25, 0.3);
    shorts.visible = false;
    const badge = box(
      body,
      material('#f2c063'),
      0.18,
      0.44,
      0.21,
      0.045,
      0.045,
      0.018,
    );
    group.rotation.y = 0.1;
    return {
      group,
      body,
      head,
      arms,
      cloth,
      jacket,
      zip,
      shorts,
      badge,
      skin,
      hair,
      nose,
    };
  }
  function applyPerson(person, from, to, t) {
    const energy =
      (from.visual.energy + (to.visual.energy - from.visual.energy) * t) / 100;
    person.body.rotation.x = (1 - energy) * 0.14;
    person.head.rotation.x = (1 - energy) * 0.16;
    person.head.rotation.z = (1 - energy) * -0.06;
    person.arms.forEach((arm, i) => {
      arm.rotation.z = (i === 0 ? -1 : 1) * (0.025 + energy * 0.16);
      arm.rotation.x = -0.02 - energy * 0.08;
    });
    const palette = { casual: '#657d91', sport: '#6e9990', smart: '#454c65' };
    person.cloth.color
      .copy(new THREE.Color(palette[from.visual.outfit]))
      .lerp(new THREE.Color(palette[to.visual.outfit]), t);
    person.skin.color
      .copy(new THREE.Color(from.avatar.skin))
      .lerp(new THREE.Color(to.avatar.skin), t);
    person.hair.color
      .copy(new THREE.Color(from.avatar.hair))
      .lerp(new THREE.Color(to.avatar.hair), t);
    const outfit = t < 0.5 ? from.visual.outfit : to.visual.outfit;
    person.jacket.forEach((m) => {
      m.visible = outfit === 'smart';
    });
    person.zip.visible = outfit === 'sport';
    person.shorts.visible = outfit === 'sport';
    person.badge.visible = outfit === 'smart';
  }
  function makeProps(stage, group) {
    const props = new THREE.Group();
    group.add(props);
    if (stage.visual.scene === 'work') {
      const wood = material('#7a6858'),
        metal = material('#3e4653'),
        screen = material('#8bacc1');
      box(props, wood, 0.85, 0.83, -0.3, 0.9, 0.07, 0.55);
      [-1, 1].forEach((side) =>
        box(props, metal, 0.85 + side * 0.34, 0.41, -0.3, 0.05, 0.82, 0.05),
      );
      const display = box(props, metal, 0.85, 1.12, -0.41, 0.55, 0.36, 0.035);
      display.rotation.x = -0.1;
      box(props, screen, 0.85, 1.12, -0.385, 0.49, 0.29, 0.008);
      box(props, metal, 0.85, 0.88, -0.22, 0.56, 0.025, 0.29);
    }
    if (stage.visual.scene === 'graduate') {
      const stand = material('#606d7c'),
        paper = material('#dddbd3'),
        gold = material('#c8a66a');
      box(props, stand, 0.85, 0.45, -0.13, 0.55, 0.9, 0.38);
      box(props, paper, 0.85, 1.05, -0.13, 0.64, 0.32, 0.1);
      box(props, gold, 0.85, 1.05, -0.067, 0.54, 0.22, 0.018);
      const hat = box(props, material('#262a36'), 0, 2.61, 0, 0.6, 0.045, 0.6);
      hat.rotation.y = 0.5;
    }
    return props;
  }
  let currentProps = null,
    previousProps = null;
  function rebuild() {
    disposeTree(root);
    root.clear();
    pickables.length = 0;
    avatar = null;
    currentProps = null;
    previousProps = null;
    const start = Math.max(0, selectedIndex - 2),
      end = Math.min(items.length, selectedIndex + 3);
    for (let i = start; i < end; i++) {
      const v = items[i],
        relative = i - selectedIndex,
        x = relative * 2.25,
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
        2.12,
        1.73 + y,
        0.0 + 1.8,
      );
      block.userData.id = v.id;
      pickables.push(block);
      const slab = box(
        tile,
        material(selected ? '#c9a66a' : '#4d586a'),
        0,
        -0.055,
        0,
        2.14,
        0.11,
        1.82,
      );
      slab.userData.id = v.id;
      pickables.push(slab);
      if (selected) {
        const edges = new THREE.LineSegments(
          new THREE.EdgesGeometry(new THREE.BoxGeometry(2.15, 0.115, 1.83)),
          new THREE.LineBasicMaterial({ color: '#f2c063' }),
        );
        edges.position.y = -0.052;
        tile.add(edges);
      }
      const person = makePerson(v);
      tile.add(person.group);
      applyPerson(person, v, v, 1);
      if (!selected) {
        person.group.scale.setScalar(0.82);
        person.group.position.z = -0.1;
      }
      if (selected) {
        avatar = person;
        currentProps = makeProps(v, tile);
        previousProps = makeProps(items[Math.max(0, i - 1)], tile);
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
    camera.lookAt(0.2, 1, 0);
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
      yaw = 0.42;
      pitch = 0.28;
      tween = null;
    } else
      tween = {
        fromYaw: yaw,
        toYaw: 0.42,
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
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
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
