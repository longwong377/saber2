/* TEMPORARY diagnostic probe — the control.
 *
 * The same walk the budget check drives, with a FIXED workload timed beside
 * `_prepare` on every frame. The control does exactly the same arithmetic every
 * frame, so anything it reports above its own floor is the box and not the
 * game. If the control's outliers are the same size and land on the same frames
 * as `_prepare`'s, the wall clock is measuring the machine. */
import * as THREE from 'three';
import { snapshotShared, restoreShared } from './_shared.mjs';

function stubEngine(THREE) {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(60, 16 / 9, 0.045, 900);
  const sun = new THREE.DirectionalLight(0xffffff, 1);
  sun.shadow.camera.updateProjectionMatrix();
  const hemi = new THREE.HemisphereLight(0x88aaff, 0x886644, 1);
  scene.add(sun, hemi);
  return {
    scene, camera, sun, hemi,
    sunDir: new THREE.Vector3(0.4, 0.7, 0.5).normalize(),
    renderer: { info: { render: { calls: 0, triangles: 0 }, memory: { geometries: 0, textures: 0 } } },
    profiler: { begin() {}, end() {}, beginDraw() {}, endDraw() {}, dispose() {} },
    applyAtmosphere() {}, fitShadows() {}, flash() {}, hurt() {}, addHeat() {},
    setFocus() {}, setRadial() {}, setGrain() {}, setBloom() {}, setSense() {},
    setQuality() {}, setResolutionScale() {}, render() {},
  };
}

const idleInput = () => ({
  act: () => false, actHit: () => false, actDown: () => false,
  moveAxis: (o) => { if (o) { o.x = 0; o.y = 0; return o; } return { x: 0, y: 0 }; },
  mouse: { dx: 0, dy: 0, wheel: 0, left: false, right: false },
  delta: { x: 0, y: 0 }, accel: { x: 0, y: 0 }, end() {},
});

async function loadWorld(THREE, level) {
  const { World } = await import('../../src/game/World.js');
  const { DEFAULT_SETTINGS } = await import('../../src/ui/Menu.js');
  const world = new World(stubEngine(THREE), { ...DEFAULT_SETTINGS, quality: 'high' });
  await world.loadLevel(level);
  world.spawnPlayer?.();
  return world;
}


/** A fixed lump of float work, about a millisecond, identical every call. */
function control() {
  let a = 0;
  for (let i = 1; i < 260000; i++) a += Math.sqrt(i) * 0.5 - a * 1e-9;
  return a;
}

export async function run({ check }) {
  const { initPhysics } = await import('../../src/physics/Rapier.js');
  await initPhysics();

  check('_prepare against a fixed control, frame by frame', async () => {
    const shared = await snapshotShared();
    const world = await loadWorld(THREE, 'colosseum');
    const D = world.destruction;
    const manager = Object.getPrototypeOf(D);
    const prepOrig = manager._prepare;
    const spend = [];
    manager._prepare = function (f) {
      const t = performance.now();
      try { return prepOrig.call(this, f); } finally { spend.push(performance.now() - t); }
    };
    try {
      const p = world.player, c = p.position.clone();
      const input = idleInput();
      for (let f = 0; f < 30; f++) { world.update(1 / 60, input); control(); }
      spend.length = 0;
      const ctl = [], upd = [];
      for (let f = 0; f < 1800; f++) {
        const a = (f / 60) * (5 / 22);
        p.position.set(c.x + Math.cos(a) * 22, p.position.y, c.z + Math.sin(a) * 22);
        const t0 = performance.now();
        world.update(1 / 60, input);
        const t1 = performance.now();
        control();
        ctl.push(performance.now() - t1);
        upd.push(t1 - t0);
      }
      const q = (arr) => { const s = [...arr].sort((x, y) => x - y);
        return `min ${s[0].toFixed(2)} med ${s[s.length >> 1].toFixed(2)} p99 ${s[Math.floor(s.length * 0.99)].toFixed(2)} max ${s[s.length - 1].toFixed(2)}`; };
      const fired = spend.filter((x) => x > 0.05);
      const over = ctl.filter((x) => x > ctl.slice().sort((a, b) => a - b)[ctl.length >> 1] * 3).length;
      return `\n  _prepare (${fired.length} frames did work): ${q(fired)}`
        + `\n  CONTROL, identical work every frame: ${q(ctl)}   — ${over} frames over 3x its own median`
        + `\n  world.update whole frame:            ${q(upd)}`;
    } finally { manager._prepare = prepOrig; restoreShared(shared); }
  });
}
