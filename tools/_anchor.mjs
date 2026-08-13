/**
 * SABER — the anchor sweep, and the trade it is a trade between.
 *
 * The blade is solved from one point. In first person that point has to be in
 * front of the lens or you cannot see your own hands; in third person the
 * shoulders stay on the ribcage, so the same point puts the arm at full stretch
 * and `solveIK`'s extension clamp makes the forearm's roll flip frame to frame.
 * Those are the two ends of one number and there is no value that is free.
 *
 *   node --import ./tools/register.mjs tools/_anchor.mjs
 *
 * Prints, for a grid of (rise, forward) offsets from the chest:
 *   ratio   how much further the blade reaches from the chest in first person
 *           than in third. 1.00 is one weapon; 1.27 is what shipped.
 *   fore    worst forearm angular velocity in THIRD person, °/s. The ratchet in
 *           tools/checks/viewmodel.mjs stands at 2700 and the solved grip
 *           achieves 2548.
 *   drop    how far below the eye the first-person hilt ends up, in cm. Positive
 *           is below. Past about 30 cm the hands leave the bottom of the frame
 *           (see the frustum arithmetic over the anchor in Player.js).
 */
import './dom-shim.mjs';
import * as THREE from 'three';
import { Player, HILT_ANCHOR } from '../src/game/Player.js';

function stubWorld() {
  return {
    scene: new THREE.Scene(),
    settings: { fov: 60, bloom: false, forcePower: 1, forceDrain: 1 },
    terrain: { height: () => 0, normalAt: (x, z, o) => o.set(0, 1, 0), inBounds: () => true,
      half: 200, crater() {}, surfaceAt: () => 'sand', raycast: () => null },
    particles: null, bolts: null, time: 0, combatIntensity: 0,
    physics: { add() {}, remove() {}, raycast: () => null, bodies: [], staticBoxes: [] },
    engine: { addHeat() {}, camera: new THREE.PerspectiveCamera(60, 16 / 9, 0.045, 1000) },
    notify() {}, report() {},
  };
}
/**
 * The stub, and `act('blade')` MUST answer true.
 *
 * This is the second time that has bitten. A stub whose `act` returns false for
 * everything never puts the guard up, so the controller is solving a resting
 * arm and the numbers come back four to eight times better than the game's.
 * tools/checks/viewmodel.mjs holds `blade` and tools/checks/first-person.mjs
 * does not — which is why the two measurements below use different ones, each
 * matching the check it has to be comparable with.
 */
function stubInput(holdBlade = false) {
  const keys = new Set();
  return {
    keys, buttons: [false, false, false],
    mouse: { dx: 0, dy: 0, wheel: 0 }, accel: { x: 0, y: 0 }, bindings: null,
    moveAxis: (out) => { out.x = 0; out.y = 0; return out; },
    act: (id) => (holdBlade && id === 'blade'),
    actHit: () => false,
  };
}

/** Blade reach from the chest, sweeping the guard the way a fight does. */
function reach(firstPerson) {
  const world = stubWorld();
  const p = new Player(world, { isLocal: true });
  p.position.set(0, 0, 0);
  if (firstPerson) { p.camera.firstPerson = true; p._applyViewMode(); }
  p.saber.ignite(); p.saber.ignition = 1;
  const input = stubInput();
  const ctx = { input, terrain: world.terrain, physics: world.physics, particles: null,
    camera: world.engine.camera, time: 0, groundColor: 0, enemies: [] };
  let far = 0;
  const tip = new THREE.Vector3();
  for (let i = 0; i < 420; i++) {
    ctx.time = world.time = i / 60;
    input.mouse.dx = Math.cos(i / 19) * -38;
    input.mouse.dy = Math.sin(i / 13) * -26;
    input.buttons[0] = (i % 130) < 80;
    p.update(1 / 60, ctx);
    if (i < 120) continue;
    p.saber.pointAt(1, tip);
    far = Math.max(far, tip.distanceTo(p.chest));
  }
  return far;
}

/** Worst forearm angular velocity in third person, the viewmodel.mjs way. */
function forearm() {
  const world = stubWorld();
  world.terrain = null;                       // as tools/checks/viewmodel.mjs has it
  const p = new Player(world, { isLocal: true });
  p.position.set(0, 0, 0);
  const input = stubInput(true);
  const ctx = { input, terrain: null, physics: null, particles: null,
    camera: world.engine.camera, time: 0, groundColor: 0 };
  p.saber.ignite(); p.saber.ignition = 1;
  input.buttons[0] = true;
  let worst = 0, prev = null;
  const qf = new THREE.Quaternion();
  for (let i = 0; i < 260; i++) {
    ctx.time = world.time = i / 60;
    input.mouse.dx = Math.cos(i / 22) * -34;
    input.mouse.dy = Math.sin(i / 22) * -22;
    p.update(1 / 60, ctx);
    if (i < 90) continue;
    p.rig.worldQuat('foreR', qf);
    if (prev) worst = Math.max(worst, qf.angleTo(prev));
    prev = qf.clone();
  }
  return worst * (180 / Math.PI) * 60;
}

/** The wrist's worst departure from rest, third person. Bound: 145°. */
function wrist() {
  const world = stubWorld();
  world.terrain = null;
  const p = new Player(world, { isLocal: true });
  p.position.set(0, 0, 0);
  const input = stubInput(true);
  const ctx = { input, terrain: null, physics: null, particles: null,
    camera: world.engine.camera, time: 0, groundColor: 0 };
  p.saber.ignite(); p.saber.ignition = 1;
  input.buttons[0] = true;
  let worst = 0;
  for (let i = 0; i < 260; i++) {
    ctx.time = world.time = i / 60;
    input.mouse.dx = Math.cos(i / 22) * -34;
    input.mouse.dy = Math.sin(i / 22) * -22;
    p.update(1 / 60, ctx);
    if (i < 90) continue;
    const b = p.rig.get('handR');
    worst = Math.max(worst, b.obj.quaternion.angleTo(b.restQuat));
  }
  return worst * 180 / Math.PI;
}

/** First person: how far below the view axis the lower hand hangs. Bound: 30°. */
function framing(pitch = 0) {
  const world = stubWorld();
  const p = new Player(world, { isLocal: true });
  p.position.set(0, 0, 0);
  p.velocity.set(0, 0, 0);
  p.camera.firstPerson = true;
  p._applyViewMode();
  p.saber.ignite(); p.saber.ignition = 1;
  const input = stubInput();
  const ctx = { input, terrain: world.terrain, physics: world.physics, particles: null,
    camera: world.engine.camera, time: 0, groundColor: 0, enemies: [] };
  for (let i = 0; i < 90; i++) { ctx.time = world.time = i / 60; p.camera.pitch = pitch; p.update(1 / 60, ctx); }
  const cam = world.engine.camera;
  cam.updateMatrixWorld(true);
  p.rig.updateMatrices(); p.rig.root.updateMatrixWorld(true);
  const eye = new THREE.Vector3().setFromMatrixPosition(cam.matrixWorld);
  const inv = cam.getWorldQuaternion(new THREE.Quaternion()).invert();
  const at = (name) => {
    const b = p.rig.get(name);
    const local = new THREE.Vector3().setFromMatrixPosition(b.obj.matrixWorld).sub(eye).applyQuaternion(inv);
    return { down: Math.atan2(-local.y, Math.max(1e-6, -local.z)) * 180 / Math.PI, fwd: -local.z };
  };
  return {
    down: Math.max(at('handR').down, at('handL').down),
    elbow: Math.min(at('foreR').fwd, at('foreL').fwd) * 1000,
  };
}

console.log('rise   fwd    ratio   fore(°/s)  wrist(°)  hand-down(°)  elbow(mm)');
console.log('                <1.30      <2700      <145           <30        >45');
// A FIXED 0.30 m OFFSET, ROTATED. That radius is not free to change — it is how
// far in front of the body the weapon is, and the note in first-person.mjs
// spends the whole of its argument on rotating it rather than lengthening it.
// So the sweep walks the ANGLE.
for (const [deg, r] of [[30, 0.30], [33, 0.30], [36, 0.30], [39, 0.30],
                        [33, 0.32], [36, 0.32], [30, 0.33], [36, 0.34]]) {
  const t = deg * Math.PI / 180;
  const rise = r * Math.sin(t), fwd = r * Math.cos(t);
  HILT_ANCHOR.rise = rise; HILT_ANCHOR.fwd = fwd;
  const third = reach(false), first = reach(true);
  const f = framing(0);
  console.log(`${rise.toFixed(2)}   ${fwd.toFixed(2)}   ${(first / third).toFixed(3)}   `
    + `${forearm().toFixed(0).padStart(6)}    ${wrist().toFixed(1).padStart(6)}      `
    + `${f.down.toFixed(1).padStart(6)}     ${f.elbow.toFixed(0).padStart(6)}   (${deg}° r${r})`);
}
