/**
 * BATTLEFRONT BORZ — the anchor sweep, and the trade it is a trade between.
 *
 * The blade is solved from one point. In first person that point has to be in
 * front of the lens or you cannot see your own hands; in third person the
 * shoulders stay on the ribcage, so the same point puts the arm at full stretch
 * and the forearm's roll flips frame to frame. Those are the two ends of one
 * number and there is no value that is free.
 *
 * THE FLIP LIVES JUST UNDER `solveIK`'s EXTENSION CLAMP AND NOT PAST IT, which
 * is the opposite of what this header used to say and is the whole reason the
 * `stuck` column had to be added. The elbow angle comes out of an `acos` whose
 * slope runs away as the chain approaches full extension, so the frames that
 * snap are the ones spent NEARLY straight; past the clamp the angle is frozen,
 * the bone goes quiet, and it goes quiet because it has stopped being solved.
 * Measured: the shipped anchor's worst frame, 2487°/s, is an UNCLAMPED one.
 *
 *   node --import ./tools/register.mjs tools/_anchor.mjs
 *
 * It mutates `HILT_ANCHOR` in place and re-measures, so every row is the real
 * controller solving a real fight at that anchor. The SHIPPED anchor is printed
 * as its own row, marked, and read out of `HILT_ANCHOR` rather than typed here
 * — a probe that names the number it is supposed to be checking is a probe that
 * agrees with itself. Seven columns, each with the bound that owns it:
 *
 *   ratio   how much further the blade reaches from the chest in first person
 *           than in third. 1.00 is one weapon. This is what the sweep exists
 *           for: the two views used to carry separate anchors and it read 1.27,
 *           which is a 27% longer sword the moment you press V.
 *   fore    worst forearm angular velocity in THIRD person, °/s — the ratchet
 *           in tools/checks/viewmodel.mjs, which stands at 2700. This is the
 *           forearm-roll flip. Worst-of over ONE mouse sweep, because that is
 *           the sweep the check drives; read it beside `stuck`, never alone.
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
 *   stuck   how many of the third-person bench's 170 measured frames the sword
 *           arm could not reach the grip on — a COUNT, and the column this file
 *           was missing. See the block below.
 *   demand  the worst distance from the shoulder to the grip the arm is sent
 *           to, in units of that arm's own reach — `demand` in
 *           tools/checks/stature.mjs, whose own bound is 0.95 because "an arm
 *           locked dead straight is not a pose". Flagged here at 1.00 and not
 *           at 0.95; the reason is at the print site and is not a relaxation.
 *
 * READ THE WHOLE ROW. Every column here is a different way for one anchor to be
 * wrong and no column is free: pulling the hilt in tightens `ratio` and drives
 * `elbow` back toward the lens, and raising it fixes `hand-down` at the cost of
 * `wrist`. There is no value that wins all seven, which is why this prints a
 * table rather than a recommendation — and the two that were added last are
 * why the first five could once be won all at the same time.
 *
 * ── AND FIVE COLUMNS WERE NOT ENOUGH: A ROW CAN WIN THEM ALL BY GIVING UP ───
 *
 * The five columns above once let the whole 0.42 m ring dominate the shipped
 * anchor — 0.38/0.18 read `ratio 1.044  fore 1027  wrist 101.4  hand-down 15.9
 * elbow 356` against the shipped `1.051 / 2487 / 114.4 / 21.4 / 358`, better on
 * every one. It is not an improvement, and the reason is the last two columns.
 *
 * `solveIK` clamps at 0.985 of the chain's own length. Past that the solver
 * straightens the arm, points it at the grip and STOPS SHORT, and a bone that
 * has run out of somewhere to go reports a low angular velocity for the same
 * reason a stuck needle reports a steady speed. Counted on this file's own
 * third-person bench:
 *
 *     anchor        stuck/170   demand   fore   fist off the hilt
 *     0.32 0.20 ←        0      0.983    2487       0.0 mm
 *     0.38 0.18         25      1.065    1027      43.4 mm
 *     0.33 0.26         20      1.037    1212      28.0 mm
 *     0.35 0.22         23      1.051    1403      36.0 mm
 *
 * The shipped anchor does not clamp on this bench AT ALL and every row that
 * beat it clamps on a seventh of its frames while asking for up to 107% of an
 * arm that is 100% long. The last column is what that costs and it is the thing
 * no column here could see: the blade is posed from `control.handPos`, not from
 * the rig, so a saturated solve never moves the sword — it leaves the FIST
 * BEHIND, 43 mm off a hilt it is supposed to be holding. `stature: the fist
 * closes on the hilt` reads that as 0.51 of the figure's own hands and fails.
 *
 * It is worse the more hands are on the weapon, which is the case this bench
 * does not drive: over the guard's whole travel held still (the grid
 * `tools/_unify.mjs` calls `envelope`), the first-person TWO-handed pair opens
 * from 65 mm on the shipped anchor to 110 mm at 0.38/0.18, and the off fist
 * from 42 to 69 — a grip that is not closed on anything.
 *
 * Confirmed causally and not by correlation: lengthen both sword-arm bones 30%
 * after the rig is built, so the anchor, the elbow poles and SaberController's
 * own `armMax` all keep the numbers they shipped with and the ONLY thing that
 * changes is how far the arm can get. Every r0.42 row's count falls to 0, and
 * the forearm it was hiding comes back — worst over the same 260 frames:
 *
 *     0.35 0.22   1403 → 4621 °/s      0.33 0.26   1212 → 2046
 *     0.38 0.18   1027 → 1431          0.39 0.14   1107 →  907
 *     0.32 0.20 ← 2487 → 3381  (0 stuck either way — this is the control)
 *
 * Read the control before the rows: a 30% longer arm is a bigger lever and
 * raises the shipped anchor too, on a bench where it never clamps at all. So
 * the experiment does not isolate the clamp perfectly and it does not have to.
 * Three of the four rows rise anyway, one of them THROUGH the 2700 ratchet the
 * unlengthened row was passing by 1300, and the fourth is 0.39/0.14 — which
 * the six-sweep table below puts through it at 2863 with no lengthening at all.
 *
 * WHAT THIS FILE STILL CANNOT TELL YOU, and the reason `stuck` is a count and
 * not a verdict: `fore` and `wrist` are ONE mouse sweep, because that is the
 * sweep tools/checks/viewmodel.mjs drives and these columns have to be the same
 * number the check reads. One sweep is a phase, not a property. Driven over the
 * six sweeps `tools/_unify.mjs --robust` carries, worst of each:
 *
 *     0.32 0.20 ←  2670 °/s / 165.8°      0.35 0.22   2556 / 160.3
 *     0.38 0.18    2633    / 170.0        0.30 0.29   2531 / 144.5
 *     0.33 0.26    2681    / 154.6        0.39 0.14   2863 / 172.2   ← past 2700
 *
 * Level, not 2.4x quieter, and two of the five are worse on the wrist. The
 * whole visible gap in this table's `fore` column is one bench's phase, and
 * 0.39/0.14 breaks the ratchet outright the moment it is asked twice.
 *
 * Those anchors were then put through the checks that own the bounds, by
 * moving `HILT_ANCHOR` rather than editing it. All of 0.38/0.18, 0.33/0.26 and
 * 0.35/0.22 pass `viewmodel` 14/14 — so `fore` and `wrist` are telling the
 * truth about themselves, and this was never a lie — and all three fail the
 * same four clauses that live outside this file:
 *
 *     stature: nobody is asked to reach past the end of their own arm
 *                                         0.99-1.01 of the arm, bound 0.95
 *     stature: the fist closes on the hilt
 *                                         0.47-0.53 of its own hands clear
 *     animation: the overhead ... moves the whole body
 *                                         hand travel 30 cm, floor 30.8
 *     first person: the hilt is ON SCREEN and not behind your own fist
 *                                         35-39% occluded against 32% and a 35% bound
 *
 * Which is the answer to "why not just take the better row": it is not better,
 * it is stuck, and the two columns that could see that are now printed.
 *
 * THREE THINGS THAT WERE CHECKED AND ARE NOT THE PROBLEM, kept because each one
 * is the obvious next suspicion and looking again costs an afternoon:
 *
 * - The blade still arrives where it was aimed. `Saber.setHiltPose` is driven
 *   from `control.handPos`/`quat`, and the OTHER clamp on this path —
 *   `armMax` in `SaberController.solveTargets`, which is the one that could
 *   move the weapon — never fires at any anchor on this ring: the hand target
 *   peaks 0.58 m from the trunk against a 0.78 m ceiling. Tip reach off the
 *   feet is 1.71 m shipped against 1.70-1.77 m on the ring.
 * - The third-person silhouette does not straighten into a zombie reach. The
 *   elbow's closest approach to locked-straight is 19.2° shipped and 17.9-18.1°
 *   on the ring, and no anchor on it puts the arm within 8° of straight on a
 *   single frame of the 770 the held-guard grid solves.
 * - It is not the guard model upstream. `demand` is measured from the SHOULDER,
 *   which is why an anchor can be inside `armMax`'s 0.78 m of chest and still
 *   past 100% of a 0.550 m arm.
 */
import './dom-shim.mjs';
import * as THREE from 'three';
import { Player, HILT_ANCHOR } from '../src/game/Player.js';
import { Rig } from '../src/game/Rig.js';

/**
 * DID THE ARM ARRIVE? — asked as an OUTCOME, never as a second copy of the rule.
 *
 * The tempting instrument is to recompute `solveIK`'s own test here: is the
 * grip further from the shoulder than `(l1 + l2) * softness`. That is HANDOFF
 * 2.4 exactly — an instrument that restates a rule eventually disagrees with
 * it, and this one would inherit a hard-coded 0.985 that the solver is free to
 * change. So the question asked is the one a player could see: the solver's
 * contract is that the tip of the lower bone ends up ON the target, so measure
 * where the tip ended up. Any residual at all means it could not get there,
 * whichever clamp stopped it — and the residual is also the answer in
 * millimetres to "how far off the hilt is the fist", which is what saturation
 * actually costs. `tipPos` is the rig's own accessor, so the +Y-and-length
 * convention is not restated here either.
 *
 * Only the SWORD arm, and only while `probe.on`: `reach` and `framing` drive
 * the same solver and the count has to belong to the bench the `fore` and
 * `wrist` columns are read on, or it is a count of something else.
 */
const probe = { on: false, stuck: 0, frames: 0, gap: 0, demand: 0 };
const _tip = new THREE.Vector3(), _sh = new THREE.Vector3();
const _solveIK = Rig.prototype.solveIK;
Rig.prototype.solveIK = function (upper, lower, target, pole, softness) {
  _solveIK.call(this, upper, lower, target, pole, softness);
  if (!probe.on || upper !== 'armR') return;
  const u = this.get(upper), l = this.get(lower);
  this.tipPos(lower, _tip); this.worldPos(upper, _sh);
  const miss = _tip.distanceTo(target);
  probe.frames++;
  if (miss > 1e-4) probe.stuck++;
  probe.gap = Math.max(probe.gap, miss);
  // The arm's own reach, read off the bones the way tools/checks/stature.mjs
  // and tools/_unify.mjs both read it, so `demand` here is their quantity.
  probe.demand = Math.max(probe.demand,
    target.distanceTo(_sh) / (u.length * u.cutT + l.length * l.cutT));
};

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

/**
 * The third-person arm: forearm velocity, wrist departure, and whether the arm
 * got where it was sent. The viewmodel.mjs way, and ONE run of it.
 *
 * `forearm` and `wrist` used to be two functions holding byte-identical benches
 * — same stub, same 260 frames, same mouse sweep — differing only in which bone
 * they took the worst of, so every row paid for the drive twice and the two
 * numbers were free to come from different runs of it. `stuck` and `demand`
 * would have made it four benches for four readings of one fight. Both printed
 * columns are unchanged to the digit by the merge, which is the check on it.
 */
function arm() {
  const world = stubWorld();
  world.terrain = null;                       // as tools/checks/viewmodel.mjs has it
  const p = new Player(world, { isLocal: true });
  p.position.set(0, 0, 0);
  const input = stubInput(true);
  const ctx = { input, terrain: null, physics: null, particles: null,
    camera: world.engine.camera, time: 0, groundColor: 0 };
  p.saber.ignite(); p.saber.ignition = 1;
  input.buttons[0] = true;
  let fore = 0, wrist = 0, prev = null;
  const qf = new THREE.Quaternion();
  probe.stuck = 0; probe.frames = 0; probe.gap = 0; probe.demand = 0;
  for (let i = 0; i < 260; i++) {
    ctx.time = world.time = i / 60;
    input.mouse.dx = Math.cos(i / 22) * -34;
    input.mouse.dy = Math.sin(i / 22) * -22;
    // The first 90 frames are the settle the two ratchets discard, so the count
    // covers exactly the frames the other two columns are worst-of.
    probe.on = i >= 90;
    p.update(1 / 60, ctx);
    if (i < 90) continue;
    p.rig.worldQuat('foreR', qf);
    if (prev) fore = Math.max(fore, qf.angleTo(prev));
    prev = qf.clone();
    const b = p.rig.get('handR');
    wrist = Math.max(wrist, b.obj.quaternion.angleTo(b.restQuat));
  }
  probe.on = false;
  return { fore: fore * (180 / Math.PI) * 60, wrist: wrist * 180 / Math.PI,
    stuck: probe.stuck, frames: probe.frames, gap: probe.gap * 1000, demand: probe.demand };
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

console.log('rise   fwd    ratio   fore(°/s)  wrist(°)  hand-down(°)  elbow(mm)  stuck  demand');
console.log('                <1.30      <2700      <145           <30        >45      0   <1.00');
/* THE DEMAND COLUMN IS FLAGGED AT 1.00 AND NOT AT stature.mjs's 0.95, and the
 * difference is not a relaxation. 0.95 is that check's bound on ITS bench — a
 * booted World, its own four poses — and this bench reads higher, so importing
 * the number would flag the shipped anchor (0.983) on the row the game
 * actually ships and teach the reader to ignore the mark. 1.00 is the one
 * bound no bench can disagree about: it is the arm's whole length, and past it
 * the solver cannot arrive from any pose at any calibration. Rows between the
 * two are caught by `stuck`, which needs no calibration either. */
const worstGap = { mm: 0, at: '' };
for (const [deg, r, tag] of grid) {
  const t = deg * Math.PI / 180;
  const rise = r * Math.sin(t), fwd = r * Math.cos(t);
  HILT_ANCHOR.rise = rise; HILT_ANCHOR.fwd = fwd;
  const third = reach(false), first = reach(true);
  const f = framing(0);
  const a = arm();
  /* A STUCK ROW IS MARKED, not left to be read off a number. `fore` and `wrist`
   * are worst-of, so a frame the arm spent pinned cannot raise either of them
   * and every frame it spends pinned is a frame it cannot: the two columns get
   * quieter the less the arm is allowed to move. The `!` is on the row, beside
   * the two numbers it is an explanation for. */
  console.log(`${rise.toFixed(2)}   ${fwd.toFixed(2)}   ${(first / third).toFixed(3)}   `
    + `${a.fore.toFixed(0).padStart(6)}    ${a.wrist.toFixed(1).padStart(6)}      `
    + `${f.down.toFixed(1).padStart(6)}     ${f.elbow.toFixed(0).padStart(6)}   `
    + `${String(a.stuck).padStart(4)}${a.stuck ? '!' : ' '} ${a.demand.toFixed(3)}${a.demand >= 1 ? '!' : ' '} `
    + `(${deg.toFixed(0)}° r${r.toFixed(2)})${tag}`);
  if (a.gap > worstGap.mm) { worstGap.mm = a.gap; worstGap.at = `${rise.toFixed(2)}/${fwd.toFixed(2)}`; }
}
/* `stuck` COUNTS the saturated frames and this SIZES them — one fact twice, so
 * it goes under the table rather than into a column of its own. What it sizes
 * is the gap between the fist and the hilt it is supposed to be holding, which
 * is what a saturated solve leaves behind and what `stature: the fist closes on
 * the hilt` fails on. Read off the grid's own rows rather than re-driving a
 * bench for it, so the line cannot quote an anchor the table does not contain. */
console.log(`\nworst fist-to-hilt gap in this grid: ${worstGap.mm.toFixed(1)} mm at ${worstGap.at}. `
  + `A row with a non-zero \`stuck\`\nis not quieter than the shipped one, it is holding still — `
  + `see the header, and run\ntools/_unify.mjs --robust before believing any single-sweep gap in \`fore\`.`);
/* PUT IT BACK. The module object is shared, so a probe that walks away from the
 * shipped anchor and leaves it there has changed the game for anything else in
 * the process — which is nothing today and is a debugging afternoon the first
 * time someone imports this from a larger script. */
HILT_ANCHOR.rise = SHIPPED.rise; HILT_ANCHOR.fwd = SHIPPED.fwd;
