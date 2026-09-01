/**
 * BATTLEFRONT BORZ — THE PARADE: what a soldier does when nobody is shooting.
 *
 * ── WHY THIS IS NOT THE GAIT SOLVER ───────────────────────────────────────
 *
 * `BipedAnimator` (src/game/Rig.js) answers one question — where do the feet
 * go while the body is travelling — and it answers it beautifully. Handed zero
 * velocity it settles into ONE stance: `stanceWidth` apart, toes out `0.13`,
 * arms hanging, which is `standPreviewFigure`'s "attention-ish" and is the
 * only thing every figure in the Company tab has ever done. Ten men in that
 * stance are one man drawn ten times.
 *
 * A man standing to be looked at is a different problem. His feet do not
 * travel, so there is nothing to solve; what there is instead is a set of
 * AUTHORED positions — heels together at attention, a stride apart at ease,
 * the rifle on the centreline — and the difference between a formation and a
 * shop-window display is the two centimetres of drift on top of them.
 *
 * So this file is a set of pure functions over a rig, in the shape
 * `poseSaberArm` (src/ui/Menu.js) established: pick the world targets, hand
 * them to `rig.solveIK` with an explicit pole, aim the terminal bones. Nothing
 * here integrates, nothing here damps, and nothing here holds a frame's state:
 * `poseParade(man, t)` is a function of `t` alone, so a figure jumped to
 * t = 90 s looks exactly like one stepped there sixty times a second. That is
 * not a purity fetish — it is what lets `tools/checks` measure a pose at all,
 * and it is why the merged skin (src/game/MergedSkin.js `mergeFigure`) can be
 * baked on whatever frame the budget allows without the pose caring.
 *
 * ── THE FIGURES CARRY NO RIFLE, AND THAT IS NOT THIS FILE'S DOING ─────────
 *
 * `buildTrooper` builds a soldier; `Enemy._build` is what hangs the blaster
 * off his hand (src/game/Bodies.js, above `blasterModel`), and the parade path
 * — `Menu.buildParadeFigure` — does not run it. So every hand pose here is
 * authored as a GRIP and published as one: `gripFrame(man, out)` returns the
 * world line the two fists are closed around, which is where a rifle goes if
 * the caller has one. The hands read correctly with or without it, which is
 * the same bet `poseSaberArm` makes about a hilt.
 *
 * ── EVERY NUMBER WITH A UNIT IS SCALED, AND BY WHICH OF THE THREE ─────────
 *
 * `limbScale` (src/game/Rig.js) exists because a species frame carries three
 * scales and a metre typed against the reference figure is only right on
 * another figure once it is multiplied by the scale of the LIMB it belongs to.
 * `poseSaberArm`'s note is the long version. Here: `m.s` for anything on the
 * ground or in the torso, `m.arm` for every chest-to-hand distance and every
 * elbow pole, and the gait solver's OWN measurements — `ankleY`, `standHip`,
 * `footHeel`, `stanceWidth`, `kneeIn` — read off a `BipedAnimator` instance
 * rather than copied out of it, so a change to the walk moves the parade with
 * it instead of leaving a stale twin behind.
 */

import * as THREE from '../../vendor/three/three.module.js';
import { BipedAnimator, limbScale, SOLE_BIAS } from './Rig.js';
import { smoothstep, TAU } from '../engine/MathUtil.js';

const UP = new THREE.Vector3(0, 1, 0);
/* Scratch, module-level and reused, for the reason Rig.js gives over its own:
 * these run once per figure per frame across two dozen figures, and an
 * allocation per vector per call is the whole cost of the pose. */
const _fwd = new THREE.Vector3();
const _left = new THREE.Vector3();
const _toe = new THREE.Vector3();
const _pole = new THREE.Vector3();
const _hip = new THREE.Vector3();
const _ank = new THREE.Vector3();
const _d = new THREE.Vector3();
const _chest = new THREE.Vector3();
const _head = new THREE.Vector3();
const _hand = new THREE.Vector3();
const _hand2 = new THREE.Vector3();
const _axis = new THREE.Vector3();
const _back = new THREE.Vector3();
const _e = new THREE.Euler();
const _q = new THREE.Quaternion();
const _qa = new THREE.Quaternion();
const _qb = new THREE.Quaternion();
const _qc = new THREE.Quaternion();

/* ── the man, and what varies between men ─────────────────────────────── */

/**
 * A STABLE NUMBER FROM A MAN'S NAME.
 *
 * Every per-figure variation in this file — his breathing rate, which hip he
 * rests on at ease, when he glances left, whether he is the one adjusting his
 * grip — is drawn off this and nothing else. FNV-1a over the DESIGNATION,
 * because that is the one field of a man that is minted once and never
 * changes: `Company.js` keys the whole roster on it and `Muster.js` mints it
 * before the man exists. Seeded off an index into the formation instead, a man
 * would change his habits every time somebody ahead of him was promoted; off
 * `Math.random`, he would change them on every reload, which is the defect
 * `tools/register.mjs` exists to stop the checks having.
 */
export function seedOf(name) {
  let h = 0x811c9dc5;
  const s = String(name ?? '');
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h >>> 0;
}

/**
 * The k-th independent 0..1 draw from a seed. A hash, not a stream: a stream
 * has a position, a position is state, and state is the thing this file has
 * promised not to keep. Two calls with the same (seed, k) are the same number
 * forever, which is what makes a man's habits survive a reload.
 */
export function draw(seed, k) {
  let h = Math.imul(seed ^ Math.imul(k + 1, 0x9e3779b1), 0x85ebca6b) >>> 0;
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** A signed draw in [-1, 1]. */
const draw2 = (seed, k) => draw(seed, k) * 2 - 1;

/**
 * The handle a pose is applied through: the figure's own measurements, its
 * seed, where it is standing and what it is currently doing.
 *
 * The measurements come off a `BipedAnimator` built on this rig and then
 * thrown away. That looks wasteful and is the point: the constructor is where
 * the gait solver works out `ankleY`, `standHip`, `footHeel`, `stanceWidth`
 * and `kneeIn` FROM THE SKELETON IT WAS HANDED, and asking it is the only way
 * to get those numbers without typing a second copy of them beside the first.
 * It costs one object and one hull of the boot's vertices, once per figure.
 *
 * `facing` is a yaw in the rig's own frame — the figure faces +Z at 0, which
 * is `poseSaberArm`'s convention and `BipedAnimator.setFacing(0)`'s. The
 * figure's WORLD placement is the caller's holder, exactly as it is on the
 * Company tab's stage, and nothing in this file reads or writes it.
 */
export function paradeMan(rig, opts = {}) {
  const s = opts.scale ?? rig?.scale ?? 1;
  /* A chassis with no biped rig — a droideka a contingent run banked — stands
   * as it was built. `buildParadeFigure` already refuses to throw over an
   * exotic veteran and neither may this: every field below is still answered,
   * `poseParade` returns without touching anything, and the man is in the
   * line. */
  const anim = rig?.get?.('thighL')
    ? new BipedAnimator(rig, { scale: s, hipHeight: opts.hipHeight ?? 0.95 })
    : { ankleY: 0, standHip: 0, legLen: 0, footHeel: 0, footLen: 0, stanceWidth: 0, kneeIn: 0 };
  const L = limbScale(rig);
  return {
    rig: rig?.get?.('hips') ? rig : null,
    seed: seedOf(opts.designation ?? opts.seed ?? ''),
    s,
    /* the gait solver's own, never retyped — see the note above */
    ankleY: anim.ankleY,
    hip: anim.standHip,
    legLen: anim.legLen,
    heel: anim.footHeel,
    footLen: anim.footLen,
    track: anim.stanceWidth,
    kneeIn: anim.kneeIn,
    /* `limbScale`'s, for everything measured from the chest outward */
    arm: L.arm,
    stand: L.stand,
    facing: opts.facing ?? 0,
    stance: opts.stance ?? 'attention',
    /** Seconds at which a salute began, or null. See `salute`. */
    saluteAt: null,
    /** `{ at, yaw }` for a turn in progress, or null. See `turnTo`. */
    turn: null,
    /** Where the fists are closed, world-ish; written by every pose. */
    grip: { pos: new THREE.Vector3(), dir: new THREE.Vector3(0, 1, 0) },
    /** Deferred matrices unless the caller says it is going to read bones. */
    readback: !!opts.readback,
  };
}

/* ── the timed sequences ──────────────────────────────────────────────── */

/**
 * A salute is a SHAPE IN TIME and the shape is most of what says "soldier".
 * The hand goes up fast and stops dead — a hand that eases into the brow reads
 * as a wave — holds long enough to be seen and acknowledged, and comes down
 * slower than it went up. British and American drill both count the hold in
 * whole seconds; 1.7 is what a passing inspection gets.
 */
export const SALUTE = { up: 0.34, hold: 1.7, down: 0.52 };
SALUTE.total = SALUTE.up + SALUTE.hold + SALUTE.down;

/**
 * A turn is FOUR moves and they overlap: the head leaves first, the shoulders
 * follow it, the feet pivot under them, and the whole thing unwinds. `lead` is
 * how far ahead of the body the head is, and it is the entire difference
 * between a man looking at something and a mannequin on a turntable.
 */
export const TURN = { lead: 0.16, swing: 0.46, hold: 1.35, back: 0.62 };
TURN.total = TURN.swing + TURN.hold + TURN.back;

/** Begin a salute at time `at`. Idempotent; a second call re-starts it. */
export function salute(man, at) { man.saluteAt = at; return man; }

/**
 * Break attention, turn toward a point in the rig's own frame, and come back.
 *
 * The point is resolved to a yaw HERE, once, rather than every frame: a target
 * that moves while a man is turning to it drags his feet round with it, which
 * is the ice-skate the whole file is written to avoid.
 */
export function turnTo(man, point, at) {
  const yaw = Math.atan2(point.x ?? 0, point.z ?? 0);
  man.turn = { at, yaw };
  return man;
}

/** How far into a salute, 0..1, with the drill's own hold. */
function saluteAmount(man, t) {
  if (man.saluteAt == null) return 0;
  const u = t - man.saluteAt;
  if (u <= 0 || u >= SALUTE.total) return 0;
  if (u < SALUTE.up) return smoothstep(0, SALUTE.up, u);
  if (u < SALUTE.up + SALUTE.hold) return 1;
  return 1 - smoothstep(SALUTE.up + SALUTE.hold, SALUTE.total, u);
}

/**
 * The yaw the body is at, and how far ahead of it the head is looking.
 *
 * `smoothstep` on the way out and on the way back, with the head running the
 * same curve shifted `TURN.lead` earlier — so on the way out the head is ahead
 * of the shoulders and on the way back it is the last thing to let go, which
 * is the order a real neck does it in.
 */
function turnState(man, t, out) {
  out.yaw = man.facing;
  out.head = 0;
  const T = man.turn;
  if (!T) return out;
  const u = t - T.at;
  if (u <= 0 || u >= TURN.total + TURN.lead) return out;
  const ramp = (x) => (x < TURN.swing ? smoothstep(0, TURN.swing, x)
    : x < TURN.swing + TURN.hold ? 1
      : 1 - smoothstep(TURN.swing + TURN.hold, TURN.total, x));
  const body = ramp(u);
  const head = ramp(u + TURN.lead);
  let d = (T.yaw - man.facing) % TAU;
  if (d > Math.PI) d -= TAU; else if (d < -Math.PI) d += TAU;
  out.yaw = man.facing + d * body;
  out.head = d * (head - body);
  return out;
}

/* ── the micro-motion ─────────────────────────────────────────────────── */

/**
 * ── THE TWO CENTIMETRES THAT SELL IT ──────────────────────────────────────
 *
 * Ten men holding an identical authored pose read as ten copies of a prop, and
 * no amount of work on the pose itself fixes that — the failure is that they
 * are IDENTICAL, not that the pose is wrong. What breaks it is four motions,
 * none of them larger than a couple of centimetres:
 *
 *   BREATH   the chest lifts and the pelvis rides a few millimetres with it.
 *            `BipedAnimator` already breathes a standing figure at 0.23 Hz
 *            (`breathPhase`, ~4.3 s a cycle, which is a resting adult's
 *            12-14 a minute) and puts 0.006·s of it into the pelvis and 0.016
 *            rad into the chest; those are the amplitudes here.
 *   WEIGHT   the body drifts from one foot to the other. Again the gait's own
 *            number: 0.115 Hz — 8.7 s — and 0.018·s of lateral pelvis.
 *   GLANCE   every ten to twenty seconds the helmet turns, holds a beat and
 *            comes back. This is the one a viewer actually catches, and it is
 *            the reason a line reads as men rather than as a texture.
 *   GRIP     rarer still, and only ever one man at a time by construction: a
 *            shoulder rolls, the hands resettle, the head dips.
 *
 * AND THEY MUST NOT BE IN STEP. A phase offset alone is not enough — two men
 * at the same RATE stay exactly as far apart as they started, forever, so a
 * line offset but not spread still pulses as one organism at the shared
 * frequency. Each man's rates are therefore spread ±12% off his seed as well,
 * which puts two neighbours half a breath apart inside forty seconds and never
 * lets them come back into step for longer than anybody watches.
 *
 * The two EVENTS are pure functions of `t` with no stored state at all: `t`
 * divided by the man's own period gives a slot number, the slot number is
 * hashed to decide whether that slot fires and how big it is, and the
 * remainder is the position within it. Nothing accumulates, so a figure that
 * has been off screen for a minute is in exactly the state it would have been
 * had it been drawn every frame — which is what `mergeFigure`'s deferred bake
 * needs to be free to happen whenever the budget allows.
 */
const BREATH_HZ = 0.23;
const SWAY_HZ = 0.115;
/** ±12%: see the note above about a line that is offset but not spread. */
const RATE_SPREAD = 0.12;

/**
 * One pulse of a discrete idle event, as a pure function of time.
 *
 * `period` seconds a slot, `rise`/`fall` the envelope's shoulders, `hold` the
 * beat at the top, `odds` how many slots actually fire. Returns 0..1 and a
 * signed size on `out`, both stable for a given (seed, k, t).
 */
function pulse(seed, k, t, period, rise, hold, fall, odds, out) {
  const x = t / period + draw(seed, k);
  const slot = Math.floor(x);
  const g = draw(seed ^ (slot * 0x9e3779b1), k + 64);
  if (g >= odds) { out.k = 0; out.size = 0; return out; }
  const u = (x - slot) * period;
  const span = rise + hold + fall;
  out.size = draw2(seed ^ (slot * 0x85ebca6b), k + 128);
  out.k = u >= span ? 0
    : u < rise ? smoothstep(0, rise, u)
      : u < rise + hold ? 1
        : 1 - smoothstep(rise + hold, span, u);
  return out;
}

const _glance = { k: 0, size: 0 };
const _fidget = { k: 0, size: 0 };

/**
 * The whole of one man's idle at time `t`. Exported because a check that
 * cannot read the motion separately from the pose can only assert that
 * something moved, which is the assertion that passes on a bug.
 */
export function idleOf(man, t, out = {}) {
  const seed = man.seed, s = man.s;
  const bHz = BREATH_HZ * (1 + draw2(seed, 0) * RATE_SPREAD);
  const wHz = SWAY_HZ * (1 + draw2(seed, 1) * RATE_SPREAD);
  out.breath = Math.sin((t * bHz + draw(seed, 2)) * TAU);
  out.sway = Math.sin((t * wHz + draw(seed, 3)) * TAU);
  /* 11-20 s between glances and two in five slots fire, so a man looks about
   * every half minute and no two of ten do it together. */
  pulse(seed, 4, t, 11 + draw(seed, 5) * 9, 0.38, 0.9, 0.55, 0.4, _glance);
  out.glance = _glance.k;
  /* The size is the man's, not the slot's, past a point: a soldier who checks
   * the whole line and a soldier who flicks his eyes are two different men. */
  out.glanceYaw = _glance.size * (0.26 + draw(seed, 6) * 0.30);
  /* Rarer, and one in six slots — over ten men that is roughly one man
   * adjusting himself at any moment, which is what a real line looks like. */
  pulse(seed, 7, t, 26 + draw(seed, 8) * 16, 0.5, 0.7, 0.9, 0.17, _fidget);
  out.fidget = _fidget.k;
  out.fidgetSide = _fidget.size >= 0 ? 1 : -1;
  /* Millimetres, and the gait's own: pelvis bob, pelvis sway, chest pitch. */
  out.bob = out.breath * 0.006 * s;
  out.lateral = out.sway * 0.018 * s;
  out.chestPitch = out.breath * 0.016;
  return out;
}

/* ── the primitives every pose is built out of ────────────────────────── */

/** The man's own axes at a yaw: `_fwd` is where he looks, `_left` his left. */
function axes(yaw) {
  _fwd.set(Math.sin(yaw), 0, Math.cos(yaw));
  _left.set(Math.cos(yaw), 0, -Math.sin(yaw));
}

/**
 * Plant one foot flat on y = 0, ankle over `(x, z)`, toes along `yaw`.
 *
 * This is `BipedAnimator`'s own leg block with the gait taken out of it: the
 * knee is poled a third of a metre along the FOOT's heading at hip height,
 * then pulled laterally under the hip and `kneeIn` inboard of it because a
 * femur adducts — the note over that pole in Rig.js is the one to read, and it
 * is the difference between a soldier and a cowboy. The ankle sits `ankleY`
 * above the contact point, and the sole takes the same `SOLE_BIAS` a walking
 * boot takes at the top of its roll.
 */
function plantFoot(rig, m, side, x, z, yaw) {
  const upper = side > 0 ? 'thighL' : 'thighR';
  const lower = side > 0 ? 'shinL' : 'shinR';
  const foot = side > 0 ? 'footL' : 'footR';
  if (!rig.get(upper) || !rig.get(lower)) return;
  _toe.set(Math.sin(yaw), 0, Math.cos(yaw));
  _pole.set(x, 0.46 * m.s, z).addScaledVector(_toe, 0.34 * m.s);
  rig.freshPos(upper, _hip);
  _pole.addScaledVector(_left, -_d.subVectors(_pole, _hip).dot(_left) - side * m.kneeIn);
  _ank.set(x, m.ankleY, z);
  rig.solveIK(upper, lower, _ank, _pole);
  if (!rig.get(foot)) return;
  /* The sole's bias is a rotation about the axis across the foot, which for a
   * level deck is `up × toe`. Level ground has no other tilt in it, so the
   * animator's contact-plane projection collapses to this one line. */
  _axis.crossVectors(UP, _toe).normalize();
  _toe.applyAxisAngle(_axis, SOLE_BIAS);
  rig.aimBoneWorld(foot, _toe, UP);
}

/**
 * Pelvis and spine. `y` is the hip height above the deck; the three Eulers are
 * this pose's lean, twist and list on top of the rest pose.
 *
 * The composition is the gait's — `hips` takes a pure yaw times the Euler and
 * everything above it takes its own `restQuat` times one — because the pose is
 * a DEVIATION from the figure the skeleton was built as, and a bone written
 * absolutely would lose whatever the species frame put into its rest.
 */
function poseTorso(rig, yaw, o) {
  const hips = rig.hipsBone?.obj;
  if (hips) {
    hips.position.set(o.x, o.y, o.z);
    hips.quaternion.setFromAxisAngle(UP, yaw)
      .multiply(_q.setFromEuler(_e.set(o.hipPitch, o.hipYaw, o.hipRoll, 'XYZ')));
  }
  bend(rig, 'spine', o.spinePitch, o.spineYaw, o.spineRoll);
  bend(rig, 'chest', o.chestPitch, o.chestYaw, o.chestRoll);
  bend(rig, 'neck', o.neckPitch, o.neckYaw, o.neckRoll);
  bend(rig, 'head', o.headPitch, o.headYaw, 0);
}

/** One bone, its own rest pose times a small Euler. See `poseTorso`. */
function bend(rig, name, px, py, pz) {
  const b = rig.get(name);
  if (b) b.obj.quaternion.copy(b.restQuat).multiply(_q.setFromEuler(_e.set(px, py, pz, 'XYZ')));
}

/**
 * Hang one arm by DIRECTION rather than by target — `swingArms`' idiom, and
 * the right one whenever the hand is not going anywhere in particular. Two
 * `aimBoneWorld` calls and no IK: a hanging arm has no reach constraint to
 * satisfy, and solving one to a target invents an elbow the pose never asked
 * for.
 *
 * `out` and `flex` are in the man's own frame — +x is his LEFT, +z is where he
 * faces — and are rotated onto his yaw here, so every call site reads as a
 * body part instead of as world coordinates.
 */
function hangArm(rig, side, yaw, out, flex, o = {}) {
  const arm = side > 0 ? 'armL' : 'armR';
  const fore = side > 0 ? 'foreL' : 'foreR';
  if (!rig.get(arm)) return;
  _d.set(side * out, -1, o.back ?? 0).normalize().applyAxisAngle(UP, yaw);
  rig.aimBoneWorld(arm, _d, null);
  if (!rig.get(fore)) return;
  _d.set(side * (o.foreOut ?? out * 0.55), -1, flex).normalize().applyAxisAngle(UP, yaw);
  rig.aimBoneWorld(fore, _d, null);
}

/**
 * Reach one hand to a world point with the elbow poled explicitly — the whole
 * of `poseSaberArm`'s construction, minus the hilt. `wrist` is the point the
 * FOREARM'S TIP arrives at, which is the wrist joint and not the palm;
 * `finger` is where the hand's own +Y is then aimed, or null to leave the hand
 * at whatever the forearm gave it.
 */
function reachArm(rig, side, wrist, pole, finger) {
  const arm = side > 0 ? 'armL' : 'armR';
  const fore = side > 0 ? 'foreL' : 'foreR';
  const hand = side > 0 ? 'handL' : 'handR';
  if (!rig.get(arm) || !rig.get(fore)) return;
  rig.solveIK(arm, fore, wrist, pole);
  if (finger && rig.get(hand)) rig.aimBoneWorld(hand, finger, null);
}

/** Where the chest is, once the torso has been written. */
function chestAt(m, out) {
  return m.rig.get('chest') ? m.rig.freshPos('chest', out) : out.set(0, m.hip + 0.42 * m.s, 0);
}

/* ── the stances ──────────────────────────────────────────────────────── */

/**
 * The angle each boot is turned out at attention.
 *
 * Drill puts the feet at 45° BETWEEN them; halved, that is 0.3927 rad a side,
 * and the heels touch. Which means the two ANKLES are not together — each one
 * sits `footHeel` back along its own boot from the shared heel point, so they
 * end up `2·footHeel·sin(24°)` apart and both a heel's length forward of it.
 * Derived here rather than typed, so a boot re-authored in Bodies.js moves the
 * stance with it.
 */
const TOE_OUT = Math.PI / 8;

/**
 * ATTENTION. Heels together, toes out, weight even, the body stacked.
 *
 * The knees are locked, which in this rig means the hips ride at the gait's
 * own `standHip` — 96.5% of leg reach, and no higher: `solveIK` softens at
 * 98.5% and `tools/checks/animation.mjs` forbids a pose past it, because past
 * that the drawn foot leaves the point it is standing on. The stiffness comes
 * from the torso instead, where it belongs: the chest is up, the shoulders are
 * back, and the chin is in.
 *
 * `arms` is `'sides'` — thumbs on the trouser seam, which is the drill for a
 * man not carrying — or `'port'`, the rifle diagonally across the chest. See
 * the header for why the rifle itself is the caller's.
 */
export function attention(man, p) {
  const rig = man.rig, m = man;
  const yaw = p.yaw;
  axes(yaw);
  const idle = p.idle;
  /* Heels together at the origin; the ankles come out of the boot's own
   * geometry rather than being placed. */
  const dL = yaw + TOE_OUT, dR = yaw - TOE_OUT;
  const lx = Math.sin(dL) * m.heel, lz = Math.cos(dL) * m.heel;
  const rx = Math.sin(dR) * m.heel, rz = Math.cos(dR) * m.heel;
  /* The body stands over the mean of the two ankles, not over the heels: a
   * pelvis 5 cm behind the joints carrying it is a man leaning back. */
  const cx = (lx + rx) / 2 + _left.x * idle.lateral * 0.45;
  const cz = (lz + rz) / 2 + _left.z * idle.lateral * 0.45;
  poseTorso(rig, yaw, {
    x: cx, y: m.hip + idle.bob, z: cz,
    hipPitch: 0, hipYaw: 0, hipRoll: idle.sway * 0.010,
    spinePitch: -0.030, spineYaw: 0, spineRoll: idle.sway * 0.008,
    /* chest up and shoulders back: the whole read of "at attention" is here */
    chestPitch: -0.055 + idle.chestPitch - idle.fidget * 0.030,
    chestYaw: p.head * 0.30 + idle.glance * idle.glanceYaw * 0.22,
    chestRoll: -idle.sway * 0.012,
    neckPitch: 0.026, neckYaw: p.head * 0.34, neckRoll: 0,
    /* chin in — a helmet tipped a couple of degrees down is the difference
     * between looking ahead and staring at the sky */
    headPitch: 0.030 + idle.fidget * 0.045,
    headYaw: p.head * 0.36 + idle.glance * idle.glanceYaw,
  });
  plantFoot(rig, m, 1, lx, lz, dL);
  plantFoot(rig, m, -1, rx, rz, dR);
  if (p.arms === 'port') portArms(man, p);
  else {
    /* Arms straight down and IN — a soldier at attention is narrower than a
     * soldier walking, and `swingArms` hangs at 0.20 out. The forearm carries
     * a few degrees of flex because a locked elbow reads as a mannequin. */
    for (const side of [1, -1]) {
      const f = side === idle.fidgetSide ? idle.fidget : 0;
      hangArm(rig, side, yaw, 0.085 + f * 0.055, 0.055 + f * 0.16, { back: -0.015 });
    }
    /* No rifle: the fists are closed at the seams, and that is where a caller
     * hanging a sidearm would put it. */
    if (rig.get('handR')) rig.freshPos('handR', man.grip.pos);
    man.grip.dir.set(0, -1, 0);
  }
  return man;
}

/**
 * PORT ARMS — the rifle held diagonally across the body, left hand on the
 * handguard by the left shoulder, right hand on the small of the stock at the
 * right hip. It is the pose a man with a weapon stands in, and it is the one
 * that makes an empty hand read as an empty hand rather than as an oversight.
 */
function portArms(man, p) {
  const rig = man.rig, A = man.arm;
  chestAt(man, _chest);
  const yaw = p.yaw;
  axes(yaw);
  /* The weapon's line: up and across, from the right hip to the left
   * shoulder. Both fists sit on it, which is what makes the hands agree. */
  _hand.copy(_chest).addScaledVector(_left, 0.19 * A)
    .addScaledVector(UP, 0.13 * A).addScaledVector(_fwd, 0.20 * A);
  _hand2.copy(_chest).addScaledVector(_left, -0.15 * A)
    .addScaledVector(UP, -0.29 * A).addScaledVector(_fwd, 0.20 * A);
  man.grip.pos.copy(_hand2);
  man.grip.dir.subVectors(_hand, _hand2).normalize();
  /* Elbows down and a little out — a rifle carried with the elbows winged is
   * a rifle nobody is holding. */
  _pole.copy(_chest).addScaledVector(_left, 0.62 * A).addScaledVector(UP, -0.72 * A);
  reachArm(rig, 1, _hand, _pole, _d.copy(man.grip.dir).negate());
  _pole.copy(_chest).addScaledVector(_left, -0.66 * A).addScaledVector(UP, -0.68 * A)
    .addScaledVector(_fwd, -0.10 * A);
  reachArm(rig, -1, _hand2, _pole, _d.copy(man.grip.dir).negate());
}

/**
 * AT EASE. Feet a stride apart, hands clasped in the small of the back, the
 * weight on one hip.
 *
 * WHICH hip is the man's own — off his seed, not off his index in the line —
 * because a rank of ten all resting on the left leg is a rank of ten copies,
 * and it is the single most visible thing about a line at ease. The loaded leg
 * goes straight and the unloaded one softens, which comes out of the geometry
 * for free: move the pelvis toward one foot and the far leg has further to
 * reach, so the hip drops on the unloaded side exactly as a real one does.
 */
export function atEase(man, p) {
  const rig = man.rig, m = man, A = m.arm;
  const yaw = p.yaw;
  axes(yaw);
  const idle = p.idle;
  /* Drill's twelve inches, in this figure's own units: `stanceWidth` is the
   * gait's hip-width rest track, and at ease is a stride outside it. */
  const sep = m.track * 1.62;
  const toe = 0.16;
  /* The man's own resting side, and a slow drift between the two on top of it
   * — nobody holds one hip for a whole parade. */
  const rest = draw(m.seed, 9) < 0.5 ? 1 : -1;
  const shift = rest * 0.62 + idle.sway * 0.38;
  const cx = _left.x * shift * 0.055 * m.s;
  const cz = _left.z * shift * 0.055 * m.s;
  poseTorso(rig, yaw, {
    x: cx, y: m.hip * 0.982 + idle.bob, z: cz,
    hipPitch: 0.012, hipYaw: -shift * 0.045, hipRoll: shift * 0.075,
    spinePitch: 0.020, spineYaw: shift * 0.020, spineRoll: -shift * 0.030,
    chestPitch: 0.030 + idle.chestPitch,
    chestYaw: p.head * 0.30 + idle.glance * idle.glanceYaw * 0.26 - shift * 0.020,
    chestRoll: -shift * 0.028,
    neckPitch: -0.010, neckYaw: p.head * 0.34, neckRoll: 0,
    headPitch: 0.020 + idle.fidget * 0.060,
    headYaw: p.head * 0.36 + idle.glance * idle.glanceYaw,
  });
  plantFoot(rig, m, 1, _left.x * sep, _left.z * sep, yaw + toe);
  plantFoot(rig, m, -1, -_left.x * sep, -_left.z * sep, yaw - toe);
  /* Hands behind the back: the right closes over the left wrist, both of them
   * on the belt line at the sacrum. They are two points 4 cm apart rather than
   * one, or the two arms solve to the same place and the forearms cross. */
  chestAt(man, _chest);
  _back.copy(_chest).addScaledVector(_fwd, -0.20 * A).addScaledVector(UP, -0.40 * A);
  _hand.copy(_back).addScaledVector(_left, 0.022 * A + idle.fidget * 0.05 * A);
  _hand2.copy(_back).addScaledVector(_left, -0.022 * A);
  man.grip.pos.copy(_back);
  man.grip.dir.copy(_left);
  /* Elbows out and back, hanging under the shoulders — poled outboard so the
   * forearms clear the hips rather than folding through them. */
  _pole.copy(_chest).addScaledVector(_left, 0.80 * A).addScaledVector(UP, -0.62 * A)
    .addScaledVector(_fwd, -0.24 * A);
  reachArm(rig, 1, _hand, _pole, null);
  _pole.copy(_chest).addScaledVector(_left, -0.80 * A).addScaledVector(UP, -0.62 * A)
    .addScaledVector(_fwd, -0.24 * A);
  reachArm(rig, -1, _hand2, _pole, null);
  return man;
}

/**
 * PRESENT ARMS. The rifle vertical on the centreline, muzzle up: the left hand
 * on the handguard at about chin height, the right at the small of the stock
 * on the belt line, both fists ON THE MIDLINE and both elbows tucked down.
 *
 * The centreline is the whole of it — the pose fails the instant either hand
 * drifts off it, because "vertical and centred" is the only thing a viewer
 * checks. So both targets are built from the chest with zero lateral term and
 * the poles are what carry the elbows out of the way.
 */
export function presentArms(man, p) {
  const rig = man.rig, m = man, A = m.arm;
  const yaw = p.yaw;
  axes(yaw);
  const idle = p.idle;
  const dL = yaw + TOE_OUT, dR = yaw - TOE_OUT;
  const lx = Math.sin(dL) * m.heel, lz = Math.cos(dL) * m.heel;
  const rx = Math.sin(dR) * m.heel, rz = Math.cos(dR) * m.heel;
  poseTorso(rig, yaw, {
    x: (lx + rx) / 2, y: m.hip + idle.bob, z: (lz + rz) / 2,
    hipPitch: 0, hipYaw: 0, hipRoll: 0,
    spinePitch: -0.034, spineYaw: 0, spineRoll: 0,
    chestPitch: -0.060 + idle.chestPitch, chestYaw: p.head * 0.22, chestRoll: 0,
    neckPitch: 0.020, neckYaw: p.head * 0.30, neckRoll: 0,
    headPitch: 0.022, headYaw: p.head * 0.34,
  });
  plantFoot(rig, m, 1, lx, lz, dL);
  plantFoot(rig, m, -1, rx, rz, dR);
  chestAt(man, _chest);
  /* One vertical line, one hand-breadth in front of the breastplate. */
  const fwdOff = 0.23 * A;
  _hand.copy(_chest).addScaledVector(_fwd, fwdOff).addScaledVector(UP, 0.16 * A);
  _hand2.copy(_chest).addScaledVector(_fwd, fwdOff).addScaledVector(UP, -0.34 * A);
  man.grip.pos.copy(_hand2);
  man.grip.dir.set(0, 1, 0);
  _pole.copy(_chest).addScaledVector(_left, 0.72 * A).addScaledVector(UP, -0.70 * A);
  reachArm(rig, 1, _hand, _pole, _d.set(0, -1, 0));
  _pole.copy(_chest).addScaledVector(_left, -0.72 * A).addScaledVector(UP, -0.70 * A);
  reachArm(rig, -1, _hand2, _pole, _d.set(0, -1, 0));
  return man;
}

export const STANCES = { attention, ease: atEase, present: presentArms };

/* ── the salute, over whatever he was doing ───────────────────────────── */

/**
 * Blend the right arm from the stance it is already in into a salute.
 *
 * Written as a BLEND rather than as a pose of its own for the reason the
 * timing note gives: the interesting part of a salute is the transit, and the
 * only way to get a transit that starts from at-ease as convincingly as from
 * attention is to interpolate out of whatever the stance left behind. The
 * three quaternions are captured, the salute is solved on top, and each bone
 * is slerped back toward what it was by `1 - k`.
 *
 * The hand is aimed at the BROW rather than placed there: the fingertips touch
 * the helmet and the wrist is a hand-length below and outboard of them, which
 * is the same "the grip point is not the wrist joint" correction
 * `handPoseOnHilt` makes for a hilt.
 */
function applySalute(man, p, k) {
  const rig = man.rig, A = man.arm;
  const armR = rig.get('armR'), foreR = rig.get('foreR'), handR = rig.get('handR');
  if (!armR || !foreR) return;
  _qa.copy(armR.obj.quaternion);
  _qb.copy(foreR.obj.quaternion);
  if (handR) _qc.copy(handR.obj.quaternion);
  axes(p.yaw);
  chestAt(man, _chest);
  if (rig.get('head')) rig.freshPos('head', _head);
  else _head.copy(_chest).addScaledVector(UP, 0.32 * A);
  /* The brow of the helmet, on the right side of it. */
  _hand.copy(_head).addScaledVector(_left, -0.085 * A)
    .addScaledVector(_fwd, 0.085 * A).addScaledVector(UP, 0.055 * A);
  /* The wrist hangs a hand below and outboard: the fingers run up and in. */
  _d.set(0, 0, 0).addScaledVector(_left, 0.30).addScaledVector(UP, 0.94).normalize();
  _hand2.copy(_hand).addScaledVector(_d, -0.115 * A);
  /* The elbow is OUT and level with the shoulder and slightly forward, which
   * is the drill and is also the only pole that keeps the forearm and the hand
   * in one straight line. */
  _pole.copy(_chest).addScaledVector(_left, -1.05 * A)
    .addScaledVector(UP, 0.14 * A).addScaledVector(_fwd, 0.34 * A);
  reachArm(rig, -1, _hand2, _pole, _d);
  armR.obj.quaternion.slerp(_qa, 1 - k);
  foreR.obj.quaternion.slerp(_qb, 1 - k);
  if (handR) handR.obj.quaternion.slerp(_qc, 1 - k);
  /* The chest lifts into it and the chin comes up a hair. Small: a salute that
   * moves the whole body is a bow. */
  const chest = rig.get('chest');
  if (chest) chest.obj.quaternion.multiply(_q.setFromEuler(_e.set(-0.026 * k, 0, 0, 'XYZ')));
  const head = rig.get('head');
  if (head) head.obj.quaternion.multiply(_q.setFromEuler(_e.set(-0.034 * k, 0, 0, 'XYZ')));
}

/* ── the one call a caller makes ──────────────────────────────────────── */

const _turn = { yaw: 0, head: 0 };
const _idle = {};

/**
 * Pose one man at time `t`.
 *
 * A function of `(man, t)` and nothing else, which is the contract the header
 * makes: the only fields of `man` that are not measurements are `stance`,
 * `facing`, `saluteAt` and `turn`, and all four are decisions rather than
 * accumulators. Step it at 60 Hz, at 6 Hz, or once at t = 400 and the figure
 * is in the same place.
 *
 * The matrices are TOUCHED, not walked, unless the man was built with
 * `readback`. `Rig.updateMatrices` costs a forced walk of every object a body
 * owns — 3.74 ms at 120 bodies, the largest single line in the game — and for
 * a merged parade figure the only consumer of those matrices is the renderer's
 * own `scene.updateMatrixWorld`, which runs whether this did or not. The
 * solvers inside the pose pull their own ancestry, exactly as `solveIK`'s note
 * says they do, so nothing here reads a stale matrix either.
 */
export function poseParade(man, t, opts = {}) {
  const rig = man.rig;
  if (!rig) return man;
  turnState(man, t, _turn);
  idleOf(man, t, _idle);
  const p = {
    t,
    yaw: _turn.yaw,
    head: _turn.head,
    idle: _idle,
    arms: opts.arms ?? man.arms ?? 'sides',
  };
  (STANCES[man.stance] ?? attention)(man, p);
  const k = saluteAmount(man, t);
  if (k > 0) applySalute(man, p, k);
  if (man.readback || opts.readback) rig.updateMatrices(); else rig.touchMatrices();
  return man;
}

/**
 * Where a weapon would be, in the rig's own frame — the fists' line, written
 * by whichever stance last ran. `pos` is the lower hand, `dir` the way the
 * barrel points.
 */
export function gripFrame(man, out = {}) {
  out.pos = (out.pos || new THREE.Vector3()).copy(man.grip.pos);
  out.dir = (out.dir || new THREE.Vector3()).copy(man.grip.dir);
  return out;
}

/**
 * Stagger a formation so it does not start life in step.
 *
 * The rates are already spread per man, but every man's clock starting at zero
 * on the frame the room opens means the first ten seconds are the one window
 * where they ARE together — which is precisely the window somebody walking in
 * is looking at. An offset drawn off each man's own seed costs nothing and
 * removes it.
 */
export function stagger(man) { return draw(man.seed, 11) * 40; }
