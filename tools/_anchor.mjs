/**
 * BATTLEFRONT BORZ — the anchor sweep, and the trade it is a trade between.
 *
 * The blade is solved from one point. In first person that point has to be in
 * front of the lens or you cannot see your own hands; in third person the
 * shoulders stay on the ribcage, so the same point puts the arm at full stretch
 * and `solveIK`'s extension clamp makes the forearm's roll flip frame to frame.
 * Those are the two ends of one number and there is no value that is free.
 *
 *   node --import ./tools/register.mjs tools/_anchor.mjs
 *
 * It mutates `HILT_ANCHOR` in place and re-measures, so every row is the real
 * controller solving a real fight at that anchor. The SHIPPED anchor is printed
 * as its own row, marked, and read out of `HILT_ANCHOR` rather than typed here
 * — a probe that names the number it is supposed to be checking is a probe that
 * agrees with itself. Five columns, each with the bound that owns it:
 *
 *   ratio   how much further the blade reaches from the chest in first person
 *           than in third. 1.00 is one weapon. This is what the sweep exists
 *           for: the two views used to carry separate anchors and it read 1.27,
 *           which is a 27% longer sword the moment you press V.
 *   fore    worst forearm angular velocity in THIRD person, °/s — the ratchet
 *           in tools/checks/viewmodel.mjs, which stands at 2700. This is the
 *           forearm-roll flip: past the extension clamp `solveIK` has no
 *           continuous answer and the bone snaps frame to frame.
 *   wrist   worst departure of the hand from its rest pose, third person, in
 *           degrees. tools/checks/viewmodel.mjs bounds it at 145.
 *   hand-   how far below the view axis the SWORD hand sits, in degrees, first
 *   down    person. Past about 30 it leaves the bottom of the frame; see the
 *           frustum arithmetic over the anchor in Player.js. The off hand is
 *           deliberately outside the frame and is not this number — see the
 *           note over `framing`.
 *   elbow   how far in front of the eye the sword forearm sits, in mm, first
 *           person. Under about 45 the arm is behind the near plane and you are
 *           looking at the inside of your own limb.
 *
 * READ THE WHOLE ROW. Every column here is a different way for one anchor to be
 * wrong and no column is free: pulling the hilt in tightens `ratio` and drives
 * `elbow` back toward the lens, and raising it fixes `hand-down` at the cost of
 * `wrist`. There is no value that wins all five, which is why this prints a
 * table rather than a recommendation.
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
  /* THE SWORD HAND, NOT THE WORST HAND.
   *
   * This took `Math.max` over both, which reports the OFF hand — and
   * tools/checks/first-person.mjs, which owns the bound in the header, has
   * decided the off hand belongs OUT of the frame ("the SWORD hand is in the
   * frame, and the off hand is out of it": 21.4° down against 63.1°). So every
   * row of the sweep printed the same 63.1 and the same 184 mm, a pair of
   * numbers that do not move with the anchor, under a column headed <30. Two
   * dead columns are worse than no columns: they read as "no anchor in this
   * grid frames the hands", which is not what they were measuring at all. */
  return { down: at('handR').down, elbow: at('foreR').fwd * 1000, off: at('handL').down };
}

/* THE SHIPPED ANCHOR IS THE ORIGIN OF THE SWEEP, not a row typed beside it.
 *
 * This used to walk a fixed 0.30 m radius on the argument that the radius is
 * "how far in front of the body the weapon is" and only the angle was in play.
 * That argument was written when the two views carried separate anchors; the
 * one that shipped after they were unified is r 0.38 at 58°, so the whole old
 * grid measured a neighbourhood the game had left, and the table's header line
 * about what "shipped" was two anchors out of date. Reading the live values
 * keeps that from happening a third time: the sweep is now a ring around
 * wherever `HILT_ANCHOR` currently is, plus one row of the anchor itself. */
const SHIPPED = { rise: HILT_ANCHOR.rise, fwd: HILT_ANCHOR.fwd };
const R0 = Math.hypot(SHIPPED.rise, SHIPPED.fwd);
const A0 = Math.atan2(SHIPPED.rise, SHIPPED.fwd) * 180 / Math.PI;

const grid = [[A0, R0, ' ← shipped']];
for (const dr of [-0.04, 0, 0.04]) {
  for (const da of [-12, -6, 6, 12]) grid.push([A0 + da, R0 + dr, '']);
}
if (Math.abs(0) === 0) grid.splice(1, 0, [A0, R0 - 0.04, ''], [A0, R0 + 0.04, '']);

console.log('rise   fwd    ratio   fore(°/s)  wrist(°)  hand-down(°)  elbow(mm)');
console.log('                <1.30      <2700      <145           <30        >45');
for (const [deg, r, tag] of grid) {
  const t = deg * Math.PI / 180;
  const rise = r * Math.sin(t), fwd = r * Math.cos(t);
  HILT_ANCHOR.rise = rise; HILT_ANCHOR.fwd = fwd;
  const third = reach(false), first = reach(true);
  const f = framing(0);
  console.log(`${rise.toFixed(2)}   ${fwd.toFixed(2)}   ${(first / third).toFixed(3)}   `
    + `${forearm().toFixed(0).padStart(6)}    ${wrist().toFixed(1).padStart(6)}      `
    + `${f.down.toFixed(1).padStart(6)}     ${f.elbow.toFixed(0).padStart(6)}   `
    + `(${deg.toFixed(0)}° r${r.toFixed(2)})${tag}`);
}
/* PUT IT BACK. The module object is shared, so a probe that walks away from the
 * shipped anchor and leaves it there has changed the game for anything else in
 * the process — which is nothing today and is a debugging afternoon the first
 * time someone imports this from a larger script. */
HILT_ANCHOR.rise = SHIPPED.rise; HILT_ANCHOR.fwd = SHIPPED.fwd;
