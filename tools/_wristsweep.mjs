/**
 * THE WRIST, SWEPT — how far the elbow may be turned by the hand, and what it
 * buys.
 *
 * `Player._wristPole` bends the elbow pole toward the elbow a straight wrist
 * implies, up to `ELBOW.swivel` and no further. This is the sweep that number
 * is chosen from, and it is the same bench the ratchet in
 * tools/checks/viewmodel.mjs runs: a real Player, ignited, blade held, driven
 * by the same mouse circle for the same 260 frames, sampled from frame 90.
 *
 * It reports the two quantities the ratchet reads — worst wrist-from-rest and
 * worst forearm angular speed — plus the median wrist, because a worst case
 * over 170 frames says nothing about how the arm reads for the other 169.
 *
 *   node --import ./tools/register.mjs tools/_wristsweep.mjs
 *   node --import ./tools/register.mjs tools/_wristsweep.mjs --deg 0,30,60,75,90,180
 */
import './dom-shim.mjs';
import * as THREE from 'three';

const argv = process.argv.slice(2);
const flag = (n, d) => { const i = argv.indexOf('--' + n); return i >= 0 ? argv[i + 1] : d; };
const DEGS = flag('deg', '0,15,30,45,60,75,90,120,180').split(',').map(Number);
const RATES = flag('rate', '').split(',').filter(Boolean).map(Number);
const FPROLL = flag('fproll', '').split(',').filter(Boolean).map(Number);

const { Player, ELBOW, FP_TUNE } = await import('../src/game/Player.js');
const D = 180 / Math.PI;

function stubWorld() {
  return {
    scene: new THREE.Scene(),
    settings: { fov: 60, bloom: false, forcePower: 1, forceDrain: 1 },
    terrain: null, particles: null, bolts: null, time: 0, combatIntensity: 0,
    physics: { add() {}, remove() {}, raycast: () => null, bodies: [] },
    engine: { addHeat() {}, camera: new THREE.PerspectiveCamera(60, 16 / 9, 0.045, 1000) },
    report() {},
  };
}
function stubInput() {
  return {
    keys: new Set(), buttons: [false, false, false],
    mouse: { dx: 0, dy: 0, wheel: 0 }, accel: { x: 0, y: 0 }, bindings: null,
    moveAxis: (out) => { out.x = 0; out.y = 0; return out; },
    act: (id) => (id === 'blade'), actHit: () => false,
  };
}

/** One run of the ratchet's bench; returns the arm numbers it watches. */
function bench({ firstPerson = false, fpHands = null } = {}) {
  const world = stubWorld();
  if (fpHands) world.settings.fpHands = fpHands;
  const p = new Player(world, { isLocal: true });
  if (firstPerson) { p.camera.firstPerson = true; p._applyViewMode(); }
  const input = stubInput();
  const ctx = { input, terrain: null, physics: null, particles: null,
    camera: world.engine.camera, time: 0, groundColor: 0 };
  p.saber.ignite(); p.saber.ignition = 1;
  input.buttons[0] = true;

  const qf = new THREE.Quaternion();
  let worstWrist = 0, worstFore = 0, prev = null;
  const all = [];
  let above = 0, n = 0, upSum = 0;
  for (let i = 0; i < 260; i++) {
    ctx.time = world.time = i / 60;
    input.mouse.dx = Math.cos(i / 22) * -34;
    input.mouse.dy = Math.sin(i / 22) * -22;
    p.update(1 / 60, ctx);
    if (i < 90) continue;
    const b = p.rig.get('handR');
    const w = b.obj.quaternion.angleTo(b.restQuat);
    worstWrist = Math.max(worstWrist, w);
    all.push(w * D);
    p.rig.worldQuat('foreR', qf);
    if (prev) worstFore = Math.max(worstFore, qf.angleTo(prev));
    prev = qf.clone();
    /* THE ANTI-ICEPICK PROPERTY, note #10: the wrist has to sit BELOW the grip
     * point in camera space, or the hand hangs over the top of the hilt. */
    const wristP = p.rig.worldPos('handR', new THREE.Vector3());
    const grip = p.saber.root.localToWorld(new THREE.Vector3(0, 0, 0));
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(p.camera.aimQuat);
    const dv = wristP.sub(grip).dot(up);
    upSum += dv; n++; if (dv > 0) above++;
  }
  all.sort((a, b) => a - b);
  return { worst: worstWrist * D, med: all[Math.floor(all.length / 2)], fore: worstFore * D * 60,
    above: n ? above / n : 0, up: n ? upSum / n : 0 };
}

const was = ELBOW.swivel, wasRate = ELBOW.rate;
const rows = [];
if (FPROLL.length) {
  const wasRoll = FP_TUNE.roll;
  for (const deg of FPROLL) {
    FP_TUNE.roll = deg * Math.PI / 180;
    rows.push([`r${deg}°`, bench(), bench({ firstPerson: true }), bench({ firstPerson: true, fpHands: 'two' })]);
  }
  FP_TUNE.roll = wasRoll;
} else if (RATES.length) {
  for (const r of RATES) {
    ELBOW.rate = r;
    rows.push([`${(was * D).toFixed(0)}/${r}`, bench(), bench({ firstPerson: true }), bench({ firstPerson: true, fpHands: 'two' })]);
  }
} else {
  for (const deg of DEGS) {
    ELBOW.swivel = deg * Math.PI / 180;
    rows.push([`${deg}°`, bench(), bench({ firstPerson: true }), bench({ firstPerson: true, fpHands: 'two' })]);
  }
}
ELBOW.swivel = was; ELBOW.rate = wasRate;

console.log('                third person, two hands      first person, one hand      first person, two hands');
console.log('  swivel    worst   median   fore °/s     worst   median   fore °/s     worst   median   fore °/s');
for (const [deg, a, b, c] of rows) {
  const f = (r) => `${r.worst.toFixed(1).padStart(7)}${r.med.toFixed(1).padStart(9)}${r.fore.toFixed(0).padStart(11)}`;
  console.log(`  ${String(deg).padStart(5)}  ${f(a)}   ${f(b)}   ${f(c)}`
    + (FPROLL.length ? `   wrist ${(b.up * 1000).toFixed(0)} mm under the grip, above on ${(b.above * 100).toFixed(0)}% of frames` : ''));
}
console.log(`\nshipped ELBOW.swivel = ${(was * D).toFixed(0)}°, ELBOW.rate = ${wasRate} rad/s`);
console.log('the ratchet\'s bounds: wrist < 145°, forearm < 2700 °/s');
