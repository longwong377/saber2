/**
 * THE WRIST, SWEPT — how far the elbow may be turned by the hand, what it buys,
 * and what the SECOND HAND is worth on top of it.
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
 *   node --import ./tools/register.mjs tools/_wristsweep.mjs --one -0.015,0.0175,0.05
 *
 * ── HOW MANY HANDS, AND HOW IT IS ASKED FOR ────────────────────────────────
 *
 * It used to write `world.settings.fpHands`, which is gone: the hand count is
 * a fact about the body now (`Player.handsOnHilt`) and not an option, so the
 * only honest way to bench one hand is to do what a player does and HOLD THE
 * ONE-HAND KEY. `_readInput` reads `grip2` every frame and sets the blade's
 * grip model from it, so the bench gets the whole of the change — the arms,
 * the guard's own handExtend, all of it — instead of the arms alone. A stub
 * that answered the setting would have measured a state the game cannot enter.
 */
import './dom-shim.mjs';
import * as THREE from 'three';

const argv = process.argv.slice(2);
const flag = (n, d) => { const i = argv.indexOf('--' + n); return i >= 0 ? argv[i + 1] : d; };
const DEGS = flag('deg', '0,15,30,45,60,75,90,120,180').split(',').map(Number);
const RATES = flag('rate', '').split(',').filter(Boolean).map(Number);
const FPROLL = flag('fproll', '').split(',').filter(Boolean).map(Number);
const ONES = flag('one', '').split(',').filter(Boolean).map(Number);

const { Player, ELBOW, FP_TUNE, GRIP_AT } = await import('../src/game/Player.js');
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
function stubInput(oneHand) {
  return {
    keys: new Set(), buttons: [false, false, false],
    mouse: { dx: 0, dy: 0, wheel: 0 }, accel: { x: 0, y: 0 }, bindings: null,
    moveAxis: (out) => { out.x = 0; out.y = 0; return out; },
    /* `blade` is what puts the mouse on the guard rather than on the camera —
     * the stub in tools/_anchor.mjs has been bitten twice by leaving it out —
     * and `grip2` is the one-hand key, which is the whole of the hand count. */
    act: (id) => (id === 'blade' || (oneHand && id === 'grip2')), actHit: () => false,
  };
}

/** One run of the ratchet's bench; returns the arm numbers it watches. */
function bench({ firstPerson = false, oneHand = false } = {}) {
  const world = stubWorld();
  const p = new Player(world, { isLocal: true });
  if (firstPerson) { p.camera.firstPerson = true; p._applyViewMode(); }
  const input = stubInput(oneHand);
  const ctx = { input, terrain: null, physics: null, particles: null,
    camera: world.engine.camera, time: 0, groundColor: 0 };
  p.saber.ignite(); p.saber.ignition = 1;
  input.buttons[0] = true;

  const qf = new THREE.Quaternion();
  let worstWrist = 0, worstFore = 0, prev = null;
  const all = [];
  let above = 0, n = 0, upSum = 0, hands = 0, palmOut = 0, palmEye = 0;
  const palm = new THREE.Vector3();
  for (let i = 0; i < 260; i++) {
    ctx.time = world.time = i / 60;
    input.mouse.dx = Math.cos(i / 22) * -34;
    input.mouse.dy = Math.sin(i / 22) * -22;
    p.update(1 / 60, ctx);
    if (i < 90) continue;
    /* THE BENCH SAYS WHAT IT MEASURED rather than what it asked for: a run
     * that meant to be one-handed and was two would otherwise print a column
     * under the wrong heading, which is the whole class HANDOFF §2.4 is about. */
    hands = Math.max(hands, p.handsOnHilt());
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
    /* WHICH WAY THE PALM FACES, the quantity tools/_palm.mjs is named for and
     * the one the roll was originally chosen on. It is here as well because
     * the roll now has TWO values to choose — one hand and two — and choosing
     * the second one on the wrist alone would repeat the mistake the first one
     * was made to avoid: a wrist that is comfortable with the back of the
     * glove to the lens is still the back of the glove to the lens. */
    const hq = p.rig.worldQuat('handR', new THREE.Quaternion());
    palm.set(0, 0, 1).applyQuaternion(hq);
    palmOut += palm.dot(new THREE.Vector3(1, 0, 0).applyQuaternion(p.camera.aimQuat));
    palmEye += palm.dot(new THREE.Vector3(0, 0, 1).applyQuaternion(p.camera.aimQuat));
  }
  all.sort((a, b) => a - b);
  return { worst: worstWrist * D, med: all[Math.floor(all.length / 2)], fore: worstFore * D * 60,
    above: n ? above / n : 0, up: n ? upSum / n : 0, hands,
    palmOut: n ? palmOut / n : 0, palmEye: n ? palmEye / n : 0 };
}

const CONDS = [
  ['third person, two hands', { }],
  ['third person, one hand', { oneHand: true }],
  ['first person, two hands', { firstPerson: true }],
  ['first person, one hand', { firstPerson: true, oneHand: true }],
];
const all = (label) => [label, ...CONDS.map(([, o]) => bench(o))];

const was = ELBOW.swivel, wasRate = ELBOW.rate;
const rows = [];
let head = 'swivel';
if (ONES.length) {
  head = 'GRIP_AT.ONE';
  const wasOne = GRIP_AT.ONE;
  for (const at of ONES) { GRIP_AT.ONE = at; rows.push(all(at.toFixed(4))); }
  GRIP_AT.ONE = wasOne;
} else if (FPROLL.length) {
  head = 'FP roll';
  /* Both halves at once: each first-person column reads its OWN roll, so
   * setting the pair to the swept value is one knob per column and not two
   * knobs at once. */
  const wasRoll = { ...FP_TUNE.roll };
  for (const deg of FPROLL) {
    FP_TUNE.roll.one = FP_TUNE.roll.two = deg * Math.PI / 180;
    rows.push(all(`r${deg}°`));
  }
  Object.assign(FP_TUNE.roll, wasRoll);
} else if (RATES.length) {
  head = 'sw/rate';
  for (const r of RATES) { ELBOW.rate = r; rows.push(all(`${(was * D).toFixed(0)}/${r}`)); }
} else {
  for (const deg of DEGS) { ELBOW.swivel = deg * Math.PI / 180; rows.push(all(`${deg}°`)); }
}
ELBOW.swivel = was; ELBOW.rate = wasRate;

const W = 27;
console.log(' '.repeat(head.length + 4) + CONDS.map(([n]) => n.padEnd(W)).join(''));
console.log(`  ${head.padStart(head.length)}  ` + CONDS.map(() =>
  'worst   median   fore °/s'.padEnd(W)).join(''));
for (const [label, ...r] of rows) {
  const f = (x) => `${x.worst.toFixed(1).padStart(7)}${x.med.toFixed(1).padStart(9)}${x.fore.toFixed(0).padStart(9)}  `;
  console.log(`  ${String(label).padStart(head.length)}  ` + r.map(f).join(''));
}
/* The roll sweep gets the OTHER two columns as well, because the roll is
 * chosen on all three: a wrist that is not folded back, a fist that is not
 * hanging over the top of the hilt, and a palm turned across the body rather
 * than showing the lens its own knuckles. */
if (FPROLL.length) {
  console.log('\n                first person, two hands                   first person, one hand');
  console.log(`  ${head.padStart(head.length)}  wrist under grip  palm out   at eye    wrist under grip  palm out   at eye`);
  for (const [label, , , two, one] of rows) {
    const g = (x) => `${(x.up * 1000).toFixed(0).padStart(9)} mm${x.palmOut.toFixed(2).padStart(11)}${x.palmEye.toFixed(2).padStart(9)}   `;
    console.log(`  ${String(label).padStart(head.length)}  ` + g(two) + ' ' + g(one));
  }
}
const seen = rows[0].slice(1).map((x) => x.hands);
console.log(`\nhands on the hilt, as the run itself read them: ${CONDS.map(([n], i) => `${n} → ${seen[i]}`).join(', ')}`);
console.log(`shipped ELBOW.swivel = ${(was * D).toFixed(0)}°, ELBOW.rate = ${wasRate} rad/s, `
  + `GRIP_AT.ONE = ${GRIP_AT.ONE.toFixed(4)}, FP_TUNE.roll = ${(FP_TUNE.roll.two * D).toFixed(0)}° two `
  + `/ ${(FP_TUNE.roll.one * D).toFixed(0)}° one`);
console.log('the ratchet\'s bounds: wrist < 145°, forearm < 2700 °/s');
