/**
 * BATTLEFRONT BORZ — V20 lane 3: GESTURES.
 *
 * The player's 2.0 item 5: *"Bodies that lean on rails, drink, argue with
 * hands."* The station's residents already stand, turn, shuffle, walk and sit
 * (`StationLife.posture` / `stepStanding`, `Rig.poseSeated`), and between
 * those poses they do NOTHING with their arms: a hall of people all holding
 * the same idle sway. This is the layer that gives a standing body something
 * to do with its hands for a few seconds at a time.
 *
 * ── WHERE IT SITS IN THE FRAME ───────────────────────────────────────────
 *
 * Exactly where `Greetings.poseWave` sits, and for the same reason: the
 * enemies' gait runs at World.update step 2 and the station's own step runs at
 * step 8, so anything written on a bone HERE lands on top of the gait that was
 * solved this frame and is thrown away by the next solve — nothing
 * accumulates, and no gesture has to be undone. One hook, at the bottom of
 * `StationLife.stepStanding`.
 *
 * ── WHAT A GESTURE IS ────────────────────────────────────────────────────
 *
 * A row in `GESTURES`: an id, a duration, and a `run(P, g)` that writes a
 * handful of bones through the rig's own verbs (`solveIK` on `arm`/`fore`,
 * `aimBoneWorld` on the hand, the local quaternions of spine/chest/neck/head,
 * the pelvis's world position). Every row is applied through `layer()`, which
 * photographs the bones the layer may touch, runs the row at FULL strength,
 * and then slerps everything back toward the photograph by `1 − k` — so
 * `BLEND` seconds of ease in, the hold, and `BLEND` seconds out come from one
 * number and no row has to think about blending at all.
 *
 * Targets are written in the CHARACTER FRAME the meditation and the seat use
 * (x to the figure's left, y up from the FEET, z the way it faces, reference
 * metres), so a small species gestures on its own scale.
 *
 * ── WHO GESTURES ─────────────────────────────────────────────────────────
 *
 * A standing resident, and nobody else: a walker (`wayR`) is walking, a body
 * on a chair is `Rig.poseSeated`'s and layering a second pose on it is two
 * poses fighting, a guard (`stationGuard`) is working, a mission walker is
 * leading you somewhere, and `__stationTouched` is the flag that says the
 * player has made this body something other than furniture. A VORLON does
 * none of it — §3.3's encounter suit stands in #37 and does not fidget.
 *
 * ── DETERMINISM AND COST ─────────────────────────────────────────────────
 *
 * Nothing rolls: every choice is `h2(seed, n)` off the body's place, slot and
 * its own gesture count, which is `StationLife.posture`'s own seeding. Two
 * machines watching the same room see the same person scratch their neck at
 * the same second.
 *
 * The per-frame cost is one pass over the pool doing integer arithmetic, plus
 * the pose itself for the handful of bodies mid-gesture and near enough to be
 * read. The scans that are not per-frame: the rail/wall probe is one
 * `physics.nearBoxes` per body per gesture (not per frame), and the pair scan
 * that starts an argument or a beckon runs on a `PAIR_EVERY` beat. Measured by
 * `tools/checks/gestures.mjs` clause (f) against 0.15 ms with forty bodies.
 */
import * as THREE from '../../vendor/three/three.module.js';
import { homeFor } from './StationCast.js';
import { isBar, makeCup, cupInHand } from './Bars.js';
import { PLACE } from './StationPlan.js';
import { clamp } from '../engine/MathUtil.js';
import { REF_ARM } from './Rig.js';

/** Seconds of ease in, and of ease out, on every gesture. */
export const BLEND = 0.3;
/** A body this far from a rail's top edge can put its forearms on it. */
export const RAIL_REACH = 0.8;
/** A body this far from a wall can put a shoulder on it. */
export const WALL_REACH = 0.5;
/** Two bodies this close, facing, may argue. */
export const ARGUE_REACH = 1.6;
/** A friend passing this close is worth waving over. */
export const BECKON_REACH = 3.4;
/** How often the pair scan looks for an argument or a passing friend. */
export const PAIR_EVERY = 0.5;
/** The gap between one gesture and the next, seconds. */
export const GAP = { min: 4.0, span: 9.0 };
/** The drinker's clock: the first sip, and the ones after it. */
export const SIP = { first: { min: 2.0, span: 4.0 }, every: { min: 8.0, span: 6.0 }, dur: 2.2 };
/**
 * Past this from the camera nobody can read a wrist, so nobody is posed — the
 * clock still runs, so a body walked up to is mid-gesture and not restarting.
 * At 24 m a forearm is a couple of pixels; the cup is smaller again.
 */
export const POSE_RANGE = 20;
export const CUP_RANGE = 11;
/** How many standing drinkers a world hands cups to. */
export const CUP_CAP = 6;
/**
 * And a ceiling on how many bodies are posed on one frame, whatever the crowd
 * does. `life.live` iterates in insertion order, so the same bodies win it —
 * a cap that is stable rather than a flicker between two halves of a room.
 */
export const POSE_CAP = 20;
/** …and nothing inside this is ever skipped: the cap sheds range, not faces. */
export const POSE_CLOSE = 10;
/** A rail's top stands this high over the floor; a wall is taller than this. */
export const RAIL_TOP = { min: 0.86, max: 1.28 };
/** How wide a horizontal box may be and still be something you lean ON. */
export const RAIL_THIN = 0.35;

/**
 * THE STEP'S OWN CLOCK, and it is not `process.cpuUsage`.
 *
 * `StationLife.stepStationLife` measures itself with `cpuUsage`, which is
 * right for a region that costs milliseconds. This one costs tens of
 * MICROseconds, and the kernel accounts CPU time on a tick: two reads inside
 * one tick differ by zero, and a region that happens to be open when a tick
 * lands is charged the whole tick — a millisecond of somebody else's work.
 * Measured on the budget clause, both clocks in the same run: `cpuUsage` said
 * 0.196 ms a frame on a frame that posed four bodies, which is forty
 * microseconds of arithmetic. `hrtime` has nanosecond resolution and needs no
 * such argument.
 */
const HRT = typeof process !== 'undefined' && process.hrtime && typeof process.hrtime.bigint === 'function'
  ? () => Number(process.hrtime.bigint()) / 1e6
  : typeof performance !== 'undefined' ? () => performance.now() : null;

/** StationLife's own stable 0..1 from two integers. Nothing here allocates. */
function h2(a, b) {
  let h = Math.imul(a * 374761393 + b * 668265263, 1) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

const wrapPi = (a) => Math.atan2(Math.sin(a), Math.cos(a));

/* ══════════════════════════════════════════════════════════════════════════ */
/*  SCRATCH — the whole file allocates nothing per frame                      */
/* ══════════════════════════════════════════════════════════════════════════ */

const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3();
const _d = new THREE.Vector3(), _e = new THREE.Vector3(), _f = new THREE.Vector3();
const _ankleL = new THREE.Vector3(), _ankleR = new THREE.Vector3();
const _sc = new THREE.Vector3(), _sd = new THREE.Vector3();
const _q = new THREE.Quaternion(), _eu = new THREE.Euler();
const _boxes = [];

/** The bones a gesture may write. Photographed and slerped back as one set. */
const TOUCH = ['spine', 'chest', 'neck', 'head',
  'armL', 'foreL', 'handL', 'armR', 'foreR', 'handR',
  'thighL', 'shinL', 'thighR', 'shinR'];
const _snap = TOUCH.map(() => new THREE.Quaternion());
const _snapHip = new THREE.Vector3();

/* ══════════════════════════════════════════════════════════════════════════ */
/*  THE POSE PRIMITIVES                                                       */
/* ══════════════════════════════════════════════════════════════════════════ */

/** The character frame, off a body's feet and facing. Filled once per pose. */
const P = {
  rig: null, body: null, s: 1, t: 0, k: 1, time: 0,
  ox: 0, oy: 0, oz: 0, fx: 0, fz: 1, lx: 1, lz: 0,
};

function frameOf(rig, body, t, k, time) {
  const f = body.facing || 0;
  P.rig = rig; P.body = body; P.s = rig.scale ?? 1; P.t = t; P.k = k; P.time = time;
  P.ox = body.position.x; P.oy = body.position.y; P.oz = body.position.z;
  P.fx = Math.sin(f); P.fz = Math.cos(f);
  P.lx = Math.cos(f); P.lz = -Math.sin(f);
  return P;
}

/** A point in the character frame, in world metres. */
function at(x, y, z, out) {
  return out.set(P.ox + (P.lx * x + P.fx * z) * P.s, P.oy + y * P.s, P.oz + (P.lz * x + P.fz * z) * P.s);
}

/** A direction in the character frame, normalised. */
function dirOf(x, y, z, out) {
  return out.set(P.lx * x + P.fx * z, y, P.lz * x + P.fz * z).normalize();
}

/**
 * One arm, IK'd to a wrist in the character frame with an elbow pole. `hand`
 * is an optional character-frame direction for the palm's own bone.
 */
function arm(side, wx, wy, wz, px, py, pz, hx, hy, hz) {
  const rig = P.rig;
  if (!rig.get('arm' + side) || !rig.get('fore' + side)) return;
  rig.solveIK('arm' + side, 'fore' + side, at(wx, wy, wz, _a), at(px, py, pz, _b));
  if (hx !== undefined && rig.get('hand' + side)) {
    rig.aimBoneWorld('hand' + side, dirOf(hx, hy, hz, _c), dirOf(0, 0, 1, _d));
  }
}

/** The same, for a target that is a place in the WORLD — a rail, a friend. */
function armWorld(side, target, pole) {
  const rig = P.rig;
  if (!rig.get('arm' + side) || !rig.get('fore' + side)) return;
  rig.solveIK('arm' + side, 'fore' + side, target, pole);
}

/** Head and neck: yaw is positive to the body's LEFT, pitch positive is down. */
function look(yaw, pitch) {
  const rig = P.rig;
  const neck = rig.get('neck'), head = rig.get('head');
  if (neck) neck.obj.quaternion.copy(neck.restQuat).multiply(_q.setFromEuler(_eu.set(pitch * 0.4, yaw * 0.4, 0, 'XYZ')));
  if (head) head.obj.quaternion.copy(head.restQuat).multiply(_q.setFromEuler(_eu.set(pitch * 0.6, yaw * 0.6, 0, 'XYZ')));
}

/** The trunk: a forward lean and a roll onto one hip, split spine/chest. */
function trunk(pitch, roll) {
  const rig = P.rig;
  const spine = rig.get('spine'), chest = rig.get('chest');
  if (spine) spine.obj.quaternion.copy(spine.restQuat).multiply(_q.setFromEuler(_eu.set(pitch * 0.55, 0, roll * 0.55, 'XYZ')));
  if (chest) chest.obj.quaternion.copy(chest.restQuat).multiply(_q.setFromEuler(_eu.set(pitch * 0.45, 0, roll * 0.45, 'XYZ')));
}

/** The far end of a bone, with its own ancestry pulled — no whole-tree walk. */
function tipFresh(rig, name, out) {
  const b = rig.get(name);
  if (!b) return out.set(0, 0, 0);
  b.obj.updateWorldMatrix(true, false);
  return out.set(0, b.length * b.cutT, 0).applyMatrix4(b.obj.matrixWorld);
}

/**
 * Move the pelvis, and keep the FEET where they are.
 *
 * The gait writes the pelvis in world coordinates onto a bone whose parent is
 * an identity root (see `Enemy._pose`'s note), so a hip shift is three adds —
 * but a body whose hips move and whose legs do not is a body sliding through
 * its own shoes. So the ankles are read BEFORE the shift and the legs are
 * re-solved to them after it: the feet stay planted, the knees take up the
 * difference, and a weight shift or a crouch is a real one.
 */
function shift(dx, dy, dz) {
  const rig = P.rig;
  const hips = rig.hipsBone?.obj;
  if (!hips) return;
  tipFresh(rig, 'shinL', _ankleL); tipFresh(rig, 'shinR', _ankleR);
  hips.position.x += (P.lx * dx + P.fx * dz) * P.s;
  hips.position.z += (P.lz * dx + P.fz * dz) * P.s;
  hips.position.y += dy * P.s;
  for (const side of ['L', 'R']) {
    if (!rig.get('thigh' + side)) continue;
    const ankle = side === 'L' ? _ankleL : _ankleR;
    _e.copy(ankle).addScaledVector(_f.set(P.fx, 0, P.fz), 0.55 * P.s);
    _e.y = ankle.y + 0.55 * P.s;
    rig.solveIK('thigh' + side, 'shin' + side, ankle, _e);
  }
}

/**
 * Run one gesture's pose at `k` of full strength.
 *
 * The photograph-and-slerp-back is `Rig.applySolvedPose`'s own blend, kept to
 * the fourteen bones a gesture is allowed to write so that a layer costs
 * fourteen quaternion copies rather than a walk of the whole skeleton. Bones
 * the row did not touch slerp toward a photograph of themselves, which is a
 * no-op by construction.
 */
function layer(rig, body, g, k, time) {
  /* The fourteen bones, resolved ONCE per rig — `rig.get` is a Map lookup and
   * this is twenty-eight of them on every posed body on every frame. */
  let touch = rig.__gestureBones;
  if (!touch) {
    touch = rig.__gestureBones = [];
    for (const name of TOUCH) touch.push(rig.get(name) || null);
  }
  const hips = rig.hipsBone?.obj;
  const partial = k < 1;
  if (partial) {
    for (let i = 0; i < touch.length; i++) if (touch[i]) _snap[i].copy(touch[i].obj.quaternion);
    if (hips) _snapHip.copy(hips.position);
  }
  frameOf(rig, body, g.t, k, time);
  g.row.run(P, g);
  if (partial) {
    for (let i = 0; i < touch.length; i++) if (touch[i]) touch[i].obj.quaternion.slerp(_snap[i], 1 - k);
    if (hips) hips.position.lerp(_snapHip, 1 - k);
  }
  rig.touchMatrices?.();
}

/* ══════════════════════════════════════════════════════════════════════════ */
/*  THE TABLE — fifteen things to do with your hands                          */
/* ══════════════════════════════════════════════════════════════════════════ */

/** Arms hanging, a touch away from the body: what most rows leave alone. */
const LOW = 1.02;

/**
 * Each row: `id`, the label the ledger prints, `dur` (min + span, seconds),
 * `weight` in the generic roll (0 = context only, never rolled for), the
 * species it is restricted to (or null), and `hold: true` when the row wants
 * the body to stand still and keep facing where the gesture put it.
 */
export const GESTURES = [
  /* ── CONTEXT ─────────────────────────────────────────────────────────── */
  {
    id: 'railLean', label: 'leans on the rail', dur: [6, 8], weight: 0, hold: true,
    run: (Q, g) => {
      const d = g.railD;
      const lean = clamp(0.22 + (d - 0.30) * 0.9, 0.15, 0.7);
      trunk(lean, 0.09);
      shift(0.05, -0.05, Math.min(0.26, Math.max(0, d - 0.30)));
      /**
       * AND FAR ENOUGH FORWARD TO ACTUALLY GET THERE.
       *
       * The lean above is a curve fitted to the reference figure, and the
       * pool is not all reference figures: a shorter species at the same
       * 0.6 m off the rail was 0.27 m short with the elbow locked, which
       * reads as a man pawing at a rail he cannot touch. So the shortfall is
       * MEASURED off the shoulder that was just posed and paid for with more
       * hip — the one thing a body leaning on something has plenty of.
       */
      const rig = Q.rig, s = Q.s;
      const sh = rig.freshPos('armR', _sc);
      const want = _sd.copy(g.railP).setY(g.railY + 0.04);
      const over = sh.distanceTo(want) - REF_ARM * s * 0.94;
      if (over > 0.01) shift(0, -0.02, Math.min(0.30, over / s + 0.03));
      /* Both forearms laid along the top: the wrists a hand apart on it, the
       * elbow poles back along the rail at the same height, so the forearm
       * lies on the rail rather than reaching down at it. */
      for (const side of ['L', 'R']) {
        const sx = side === 'L' ? 1 : -1;
        _a.copy(g.railP).addScaledVector(g.railT, sx * 0.20).setY(g.railY + 0.04);
        _b.copy(_a).addScaledVector(g.railN, -0.34).addScaledVector(g.railT, sx * 0.22).setY(g.railY + 0.02);
        armWorld(side, _a, _b);
      }
      look(0, 0.08 + 0.02 * Math.sin(Q.time * 0.7));
    },
  },
  {
    id: 'wallLean', label: 'leans a shoulder on the wall', dur: [6, 8], weight: 0, hold: true,
    run: (Q, g) => {
      const sx = g.wallSide;                       // +1 the wall is on the left
      trunk(0.04, -0.16 * sx);
      shift(sx * 0.09, -0.03, 0);
      arm(sx > 0 ? 'L' : 'R', sx * 0.26, LOW - 0.06, -0.04, sx * 0.52, 1.16, -0.20);
      arm(sx > 0 ? 'R' : 'L', -sx * 0.02, 1.12, 0.18, -sx * 0.46, 1.20, 0.02);
      look(-sx * 0.25, 0.05);
    },
  },
  {
    id: 'sip', label: 'takes a sip', dur: [SIP.dur, 0], weight: 0,
    run: (Q, g) => {
      const rise = Math.sin(clamp(Q.t / g.dur, 0, 1) * Math.PI) ** 0.5;
      const y = 1.06 + rise * 0.40;
      const z = 0.22 - rise * 0.08;
      arm('R', -0.18 + rise * 0.11, y, z, -0.56, 1.02, -0.02, -0.2, -0.9, 0.35);
      look(0, rise * 0.12);
    },
  },
  {
    id: 'argue', label: 'argues with the hands', dur: [6, 4], weight: 0, hold: true,
    run: (Q, g) => argueHands(Q, g, 0),
  },
  {
    id: 'squareUp', label: 'squares up, chest out', dur: [6, 4], weight: 0, hold: true,
    run: (Q, g) => {
      /* §3.3's Drazi settles everything by standing closer than you want him
       * to: chest out, weight forward, hands wider. */
      trunk(-0.16, 0);
      shift(0, 0.01, 0.05);
      argueHands(Q, g, 0.10);
    },
  },
  {
    id: 'point', label: 'points something out', dur: [2.4, 0.8], weight: 1.0,
    run: (Q, g) => {
      const side = g.pointSide, sx = side === 'L' ? 1 : -1;
      const k = Math.sin(clamp(Q.t / g.dur, 0, 1) * Math.PI) ** 0.4;
      const yaw = g.pointYaw, pitch = g.pointPitch;
      /* The arm out along the bearing, at four fifths of its own reach. */
      const r = 0.46 * k;
      arm(side,
        sx * 0.13 + Math.sin(yaw) * r, 1.32 - pitch * r, Math.cos(yaw) * r,
        sx * 0.42, 1.12, 0.05,
        Math.sin(yaw), -pitch, Math.cos(yaw));
      look(yaw * 0.8, pitch * 0.6);
    },
  },
  {
    id: 'beckon', label: 'waves a friend over', dur: [2.0, 0.6], weight: 0,
    run: (Q, g) => {
      const side = g.beckonSide, sx = side === 'L' ? 1 : -1;
      /* Up, and then twice in toward the chest — the whole of "come here". */
      const sweep = 0.5 + 0.5 * Math.cos(Q.t * 7.0);
      arm(side, sx * (0.10 + 0.26 * sweep), 1.44, 0.20 + 0.10 * sweep, sx * 0.62, 1.06, -0.12,
        sx * 0.2, -0.5, 0.84);
      look(g.beckonYaw * 0.8, -0.05);
    },
  },
  /* ── THE GENERIC ROLL ────────────────────────────────────────────────── */
  {
    id: 'scratch', label: 'scratches the neck', dur: [2.2, 0.8], weight: 1.0,
    run: (Q) => {
      const k = Math.sin(clamp(Q.t / 2.6, 0, 1) * Math.PI) ** 0.4;
      arm('R', -0.10 - 0.02 * k, 1.30 + 0.24 * k, -0.02 - 0.10 * k, -0.60, 1.30, -0.10,
        0.1, 0.4, -0.9);
      look(-0.12 * k, 0.16 * k + 0.02 * Math.sin(Q.time * 9));
    },
  },
  {
    id: 'wrist', label: 'checks a wrist', dur: [2.4, 0.8], weight: 1.0,
    run: (Q) => {
      arm('L', 0.08, 1.24, 0.26, 0.52, 1.02, 0.06, -0.4, 0.2, 0.9);
      arm('R', -0.04, 1.19, 0.30, -0.50, 1.02, 0.06, 0.5, 0.1, 0.85);
      look(0.14, 0.40);
    },
  },
  {
    id: 'crossArms', label: 'crosses the arms', dur: [5, 4], weight: 1.4,
    run: () => {
      arm('L', -0.09, 1.19, 0.19, 0.50, 1.06, -0.06);
      arm('R', 0.09, 1.14, 0.19, -0.50, 1.02, -0.06);
      trunk(0.03, 0);
    },
  },
  {
    id: 'handsHips', label: 'hands on hips', dur: [5, 4], weight: 1.2,
    run: () => {
      arm('L', 0.21, 1.00, -0.01, 0.60, 1.12, -0.34);
      arm('R', -0.21, 1.00, -0.01, -0.60, 1.12, -0.34);
      trunk(-0.04, 0);
    },
  },
  {
    id: 'lookUp', label: 'looks up at the soffit', dur: [2.6, 1.0], weight: 0.9,
    run: (Q) => {
      look(0.10 * Math.sin(Q.time * 0.6), -0.46);
      trunk(-0.10, 0);
    },
  },
  {
    id: 'shiftWeight', label: 'shifts foot to foot', dur: [3.0, 1.2], weight: 1.6,
    run: (Q, g) => {
      const s = Math.sin(Q.t * 1.9 + g.phase);
      trunk(0, 0.07 * s);
      shift(0.07 * s, -0.012 * Math.abs(s), 0);
      arm('L', 0.20, LOW - 0.05, 0.02, 0.52, 1.12, -0.16);
      arm('R', -0.20, LOW - 0.05, 0.02, -0.52, 1.12, -0.16);
    },
  },
  {
    id: 'crouch', label: 'crouches to pick something up', dur: [2.0, 0], weight: 0.8,
    run: (Q) => {
      /* Down over one second, a beat on the floor, and up with it. */
      const k = Q.t < 0.9 ? Q.t / 0.9 : Q.t > 1.4 ? 1 - (Q.t - 1.4) / 0.6 : 1;
      const down = clamp(k, 0, 1);
      trunk(0.42 * down, 0);
      shift(0, -0.40 * down, 0.04 * down);
      arm('R', -0.13, 1.00 - 0.86 * down, 0.16 + 0.20 * down, -0.46, 0.90, 0.36, 0, -0.9, 0.3);
      arm('L', 0.17, LOW - 0.12 * down, 0.02, 0.50, 1.08, -0.14);
      look(0, 0.36 * down);
    },
  },
  {
    id: 'holdCup', label: 'holds a drink', dur: [0, 0], weight: 0,
    run: () => {
      /* Not a gesture so much as a posture: the hand a cup is in does not
       * swing at the side, it rides at the belt. Applied at full strength
       * whenever a drinker is between gestures — see `stepGestures`. */
      arm('R', -0.19, 1.06, 0.22, -0.56, 1.02, -0.06, -0.15, -0.85, 0.5);
    },
  },
  {
    id: 'sniff', label: 'sniffs the air', dur: [2.4, 0.8], weight: 2.2, species: 'pakmara',
    run: (Q) => {
      /* The Pak'ma'ra reads a room with its face. Three short bobs. */
      const bob = Math.sin(Q.t * 8.5) * 0.06;
      look(0.06 * Math.sin(Q.t * 2.1), 0.22 + bob);
      trunk(0.10, 0);
      arm('R', -0.13, 1.26, 0.24, -0.52, 1.10, 0.02, 0.2, 0.3, 0.9);
    },
  },
];

const BY_ID = new Map(GESTURES.map((g) => [g.id, g]));

/** The one shared record the cup hold is applied through — it has no clock. */
const HOLD = { id: 'holdCup', row: null, t: 0, dur: 1, phase: 0, hold: false };

/** The generic roll's rows, in the table's own order — weight > 0 only. */
const ROLLED = GESTURES.filter((g) => g.weight > 0);

/**
 * The hands of an argument. Both partners run this; the beat is shared and the
 * PHASE is not, so one talks while the other listens with its hands down —
 * which is what `tools/checks/gestures.mjs` clause (c) reads off the wrists.
 * `wide` opens the stance for a Drazi.
 */
function argueHands(Q, g, wide) {
  const beat = (Q.t / 1.2) + g.phase;
  const mine = (Math.floor(beat) % 2) === 0;          // my turn to talk
  const swing = Math.sin(clamp(beat % 1, 0, 1) * Math.PI);
  const kind = Math.floor(beat) % 3;                  // open hand, chop, point
  look(g.argueYaw * 0.7, -0.02);
  if (!mine) {
    /* Listening: hands down and a little in, and still turned to him. */
    arm('L', 0.19 + wide, LOW - 0.02, 0.10, 0.52, 1.10, -0.10);
    arm('R', -0.19 - wide, LOW - 0.02, 0.10, -0.52, 1.10, -0.10);
    return;
  }
  const up = 0.22 + 0.40 * swing;
  if (kind === 0) {
    /* Open hands, palms up, held out: "what do you want me to say".  */
    arm('L', 0.24 + wide, 1.02 + up, 0.30, 0.62, 1.06, -0.02, 0.2, 0.85, 0.5);
    arm('R', -0.24 - wide, 1.02 + up * 0.8, 0.30, -0.62, 1.06, -0.02, -0.2, 0.85, 0.5);
  } else if (kind === 1) {
    /* The chop: one hand up and down on the beat, the other at the belt. */
    arm('R', -0.10, 1.06 + up, 0.30, -0.58, 1.20, 0.00, 0.15, -0.9, 0.4);
    arm('L', 0.20 + wide, LOW, 0.10, 0.54, 1.10, -0.10);
  } else {
    /* The finger, at his chest. */
    arm('R', -0.06, 1.24 + up * 0.4, 0.30 + 0.16 * swing, -0.54, 1.10, 0.06, 0, -0.1, 1);
    arm('L', 0.20 + wide, LOW, 0.06, 0.54, 1.10, -0.14);
  }
}

/* ══════════════════════════════════════════════════════════════════════════ */
/*  THE STATE                                                                 */
/* ══════════════════════════════════════════════════════════════════════════ */

function state(world) {
  return world._gestures || (world._gestures = {
    time: 0, scan: 0, ms: 0,
    /** body → the cup a standing drinker is holding. */
    cups: new Map(),
    /** The ledger the checks and the HUD read. */
    started: 0, counts: new Map(), longest: 0, longestId: null,
    active: 0, posed: 0, last: null,
    state: () => gesturesState(world),
  });
}

const alive = (b) => b && !b.dead && b.alive !== false && !b.disposed && b.position;

/** The seed StationLife.posture uses, so a body's gestures ride its own slot. */
const seedOf = (b) => (b.stationPlace | 0) * 97 + (b.stationSlot | 0) * 7 + 29;

/**
 * Is this body one of the pool's standing residents — the only kind that
 * gestures? The list is the note's, in its order.
 */
function eligible(body) {
  if (!alive(body) || !body.rig?.get) return false;
  if (body.standX === undefined) return false;          // never a standing body
  if (body.wayR || body.wayMission) return false;       // walking, or leading you
  if (body.seat) return false;                          // Rig.poseSeated's
  if (body.__stationTouched || body.stationGuard) return false;
  if (body.stationSpecies === 'vorlon') return false;   // §3.3: he does not fidget
  return true;
}

/* ══════════════════════════════════════════════════════════════════════════ */
/*  THE RAIL AND THE WALL                                                     */
/* ══════════════════════════════════════════════════════════════════════════ */

/**
 * The nearest thing at hand height a body could put its forearms on, and the
 * nearest wall it could put a shoulder on, off the physics broad phase.
 *
 * A RAIL is a box whose TOP stands between `RAIL_TOP.min` and `.max` over this
 * body's feet and which is thin in one horizontal axis — the atrium's
 * balustrade (a 1.05 m panel), `StationKit`'s M.wing handrails (a 0.1 m slab
 * at 1.02), the queue rail in a shop, the rail round the Command pit. A WALL
 * is a box taller than a rail whose face is within `WALL_REACH`.
 *
 * Paid once per gesture chosen, never per frame — see the file's cost note.
 */
function probe(world, body, out) {
  out.rail = false; out.wall = false;
  const ph = world.physics;
  if (!ph?.nearBoxes) return out;
  _boxes.length = 0;
  ph.nearBoxes(body.position.x, body.position.z, 1.6, _boxes);
  const feet = body.position.y;
  let bestR = Infinity, bestW = Infinity;
  for (let i = 0; i < _boxes.length; i++) {
    const box = _boxes[i];
    if (box.disabled) continue;
    const he = box.halfExtents, c = box.center;
    /* Into the box's own frame: the two horizontal half-extents and the
     * body's offset from the centre. */
    _a.set(body.position.x - c.x, 0, body.position.z - c.z);
    if (box.invQuat) _a.applyQuaternion(box.invQuat);
    const top = c.y + he.y - feet;
    const thin = Math.min(he.x, he.z), long = Math.max(he.x, he.z);
    const dx = Math.abs(_a.x) - he.x, dz = Math.abs(_a.z) - he.z;
    const d = Math.hypot(Math.max(0, dx), Math.max(0, dz));
    if (top >= RAIL_TOP.min && top <= RAIL_TOP.max && thin <= RAIL_THIN && long >= 0.22) {
      if (d <= RAIL_REACH && d < bestR) {
        bestR = d;
        out.rail = true; out.railD = Math.max(0.18, d);
        /* The long axis is the rail's run; the short one points across it. */
        const alongX = he.x >= he.z ? 1 : 0;
        out.railT.set(alongX, 0, 1 - alongX);
        out.railN.set(1 - alongX, 0, alongX);
        if (box.quat) { out.railT.applyQuaternion(box.quat); out.railN.applyQuaternion(box.quat); }
        /* The nearest point on the top face, in the world. */
        const lx = clamp(_a.x, -he.x, he.x), lz = clamp(_a.z, -he.z, he.z);
        out.railP.set(lx, 0, lz);
        if (box.quat) out.railP.applyQuaternion(box.quat);
        out.railP.set(c.x + out.railP.x, c.y + he.y, c.z + out.railP.z);
        out.railY = out.railP.y;
        /* Face out over it, and put the left hand on the left. */
        _b.set(out.railP.x - body.position.x, 0, out.railP.z - body.position.z);
        out.railYaw = _b.lengthSq() > 1e-6 ? Math.atan2(_b.x, _b.z) : (body.facing || 0);
        if (out.railN.dot(_b) < 0) out.railN.negate();
        _c.set(Math.cos(out.railYaw), 0, -Math.sin(out.railYaw));   // the body's left
        if (out.railT.dot(_c) < 0) out.railT.negate();
      }
    } else if (he.y >= 0.9 && c.y + he.y - feet >= 1.5 && d <= WALL_REACH && d < bestW) {
      bestW = d;
      out.wall = true;
      /* WHICH FACE. The gaps are signed — negative means the body is inside
       * that axis's span — so the face the body is standing off is the axis
       * with the LARGER gap, not the larger magnitude. A body halfway along a
       * four-metre wall has dx = −2 and dz = +0.3, and the magnitude test
       * picked the end of the wall. */
      const useX = dx > dz;
      _b.set(useX ? Math.sign(_a.x) || 1 : 0, 0, useX ? 0 : Math.sign(_a.z) || 1);
      if (box.quat) _b.applyQuaternion(box.quat);
      /* `_b` points from the wall to the body: the body stands side-on to it,
       * turned toward whichever quarter is nearer its current facing. */
      const outward = Math.atan2(_b.x, _b.z);
      const f = body.facing || 0;
      const plus = Math.abs(wrapPi(outward + Math.PI / 2 - f));
      const minus = Math.abs(wrapPi(outward - Math.PI / 2 - f));
      out.wallSide = plus <= minus ? 1 : -1;          // +1: the wall is on the left
      out.wallYaw = outward + out.wallSide * Math.PI / 2;
    }
  }
  _boxes.length = 0;
  return out;
}

/* ══════════════════════════════════════════════════════════════════════════ */
/*  CHOOSING                                                                  */
/* ══════════════════════════════════════════════════════════════════════════ */

function record(body) {
  return body.__gesture || (body.__gesture = {
    n: 0, wait: 0, g: null, sipAt: -1, probeAt: -1e9, px: 0, pz: 0,
    near: { rail: false, wall: false, railD: 0, railY: 0, railYaw: 0, wallSide: 1, wallYaw: 0,
      railP: new THREE.Vector3(), railT: new THREE.Vector3(), railN: new THREE.Vector3() },
  });
}

/** Begin one gesture on a body. Returns the live record, or null. */
function begin(world, G, body, rec, id, dur, fill) {
  const row = BY_ID.get(id);
  if (!row) return null;
  const g = { id, row, t: 0, dur, phase: 0, hold: !!row.hold };
  if (fill) fill(g);
  rec.g = g;
  G.started++;
  G.counts.set(id, (G.counts.get(id) || 0) + 1);
  if (dur > G.longest) { G.longest = dur; G.longestId = id; }
  G.last = { id, who: body.stationName || '?', at: G.time, dur };
  return g;
}

/** The duration a row asks for, seeded. */
function durOf(row, a, n) {
  return row.dur[0] + h2(a, n * 11 + 5) * row.dur[1];
}

/**
 * The next thing this body does with its hands. Seeded on its slot and on its
 * own gesture count, exactly as `StationLife.posture` is seeded on its slot and
 * its posture count — so this is a second, slower hand on the same clock.
 */
function choose(world, G, body, rec) {
  const a = seedOf(body);
  const n = rec.n = (rec.n | 0) + 1;
  const roll = h2(a, n * 11 + 1);
  const cup = G.cups.get(body);
  /* THE DRINKER'S CLOCK OWNS HIM. A sip is due every 8–15 s and everything
   * else has to fit between two of them, so a gesture is only started when it
   * finishes clear of the next one. */
  if (cup) {
    if (G.time >= rec.sipAt) {
      rec.sipAt = G.time + SIP.every.min + h2(a, n * 11 + 2) * SIP.every.span;
      return begin(world, G, body, rec, 'sip', SIP.dur + BLEND);
    }
  }
  const room = rec.sipAt > 0 ? rec.sipAt - G.time - 0.6 : Infinity;

  /* ── CONTEXT: the rail, then the wall. The probe is cached per gesture. */
  if (G.time - rec.probeAt > 5 || Math.abs(body.position.x - rec.px) + Math.abs(body.position.z - rec.pz) > 0.35) {
    rec.probeAt = G.time; rec.px = body.position.x; rec.pz = body.position.z;
    probe(world, body, rec.near);
  }
  const N = rec.near;
  if (N.rail && roll < 0.85) {
    const row = BY_ID.get('railLean');
    const dur = Math.min(durOf(row, a, n), room);
    if (dur > 2) {
      body.standFace = N.railYaw;
      return begin(world, G, body, rec, 'railLean', dur, (g) => {
        g.faceYaw = N.railYaw;
        g.railD = N.railD; g.railY = N.railY;
        g.railP = N.railP.clone(); g.railT = N.railT.clone(); g.railN = N.railN.clone();
      });
    }
  }
  if (N.wall && h2(a, n * 11 + 3) < 0.6) {
    const row = BY_ID.get('wallLean');
    const dur = Math.min(durOf(row, a, n), room);
    if (dur > 2) {
      body.standFace = N.wallYaw;
      return begin(world, G, body, rec, 'wallLean', dur, (g) => { g.faceYaw = N.wallYaw; g.wallSide = N.wallSide; });
    }
  }

  /* ── THE GENERIC ROLL, weighted, with the species rows filtered out. */
  let total = 0;
  for (const row of ROLLED) if (!row.species || row.species === body.stationSpecies) total += row.weight;
  let pickAt = h2(a, n * 11 + 4) * total;
  for (const row of ROLLED) {
    if (row.species && row.species !== body.stationSpecies) continue;
    pickAt -= row.weight;
    if (pickAt > 0) continue;
    const dur = Math.min(durOf(row, a, n), room);
    if (dur < 1.2) return null;
    if (row.id === 'point') {
      const aim = pointAt(world, body, a, n);
      if (!aim) return null;
      return begin(world, G, body, rec, 'point', dur, (g) => {
        g.pointYaw = aim.yaw; g.pointPitch = aim.pitch;
        g.pointSide = aim.yaw > 0 ? 'L' : 'R';
      });
    }
    return begin(world, G, body, rec, row.id, dur, (g) => { g.phase = h2(a, n * 11 + 6) * 6.283; });
  }
  return null;
}

/**
 * Something worth pointing at: a screen or board in the room, the atrium, or
 * whoever is standing nearest. Returned as a bearing in the body's own frame,
 * so the arm and the head are one number apart.
 */
function pointAt(world, body, a, n) {
  const place = PLACE.get(body.stationPlace);
  const roll = h2(a, n * 11 + 7);
  let tx, ty, tz;
  if (roll < 0.34 && place) {
    /* The room's own far wall, where its screen and its board live. */
    tx = place.x - Math.sin(place.yaw || 0) * (place.d / 2 - 0.3);
    tz = place.z - Math.cos(place.yaw || 0) * (place.d / 2 - 0.3);
    ty = body.position.y + 2.1;
  } else if (roll < 0.67) {
    /* The atrium, which is the one thing on the station everybody looks at. */
    tx = 0; tz = 0; ty = body.position.y + 4.0;
  } else {
    const other = nearestBody(world, body, 6);
    if (!other) return null;
    tx = other.position.x; tz = other.position.z; ty = other.position.y + 1.5;
  }
  const dx = tx - body.position.x, dz = tz - body.position.z;
  const d = Math.hypot(dx, dz);
  if (d < 0.4) return null;
  return {
    yaw: clamp(wrapPi(Math.atan2(dx, dz) - (body.facing || 0)), -1.1, 1.1),
    pitch: clamp(-(ty - (body.position.y + 1.35)) / Math.max(1, d), -0.8, 0.8),
  };
}

function nearestBody(world, body, reach) {
  const life = world._stationLife;
  if (!life) return null;
  let best = null, bd = reach * reach;
  for (const o of life.live.values()) {
    if (o === body || !alive(o)) continue;
    const dx = o.position.x - body.position.x, dz = o.position.z - body.position.z;
    if (Math.abs(o.position.y - body.position.y) > 2) continue;
    const d2 = dx * dx + dz * dz;
    if (d2 < bd) { bd = d2; best = o; }
  }
  return best;
}

/* ══════════════════════════════════════════════════════════════════════════ */
/*  THE PAIR SCAN — an argument, and a friend waved over                      */
/* ══════════════════════════════════════════════════════════════════════════ */

/** The quarter a body belongs to — `Greetings`' own reading of the cast. */
function homeOf(body) {
  try { return homeFor(body.stationSpecies || 'human', body.stationRole || 'visitor'); } catch { return 38; }
}

/**
 * Two standing bodies close enough and turned enough toward each other to be
 * in a conversation get one; a WALKER of the same quarter passing a standing
 * body gets waved over. One of each per scan, so a full room does not all
 * start shouting on the same frame.
 */
function pairScan(world, G, life) {
  const bodies = [];
  for (const b of life.live.values()) {
    if (!eligible(b)) continue;
    const rec = b.__gesture;
    if (rec?.g) continue;
    bodies.push(b);
  }
  for (let i = 0; i < bodies.length; i++) {
    const A = bodies[i];
    for (let j = i + 1; j < bodies.length; j++) {
      const B = bodies[j];
      const dx = B.position.x - A.position.x, dz = B.position.z - A.position.z;
      const d2 = dx * dx + dz * dz;
      if (d2 > ARGUE_REACH * ARGUE_REACH || Math.abs(A.position.y - B.position.y) > 1.5) continue;
      const bearing = Math.atan2(dx, dz);
      /* Facing: each within a right angle of the other. */
      if (Math.abs(wrapPi(bearing - (A.facing || 0))) > 1.3) continue;
      if (Math.abs(wrapPi(bearing + Math.PI - (B.facing || 0))) > 1.3) continue;
      const key = seedOf(A) * 31 + seedOf(B);
      const turn = (record(A).n | 0) + (record(B).n | 0);
      if (h2(key, turn * 3 + 1) > 0.55) continue;
      const dur = 6 + h2(key, turn * 3 + 2) * 4;
      start(A, B, bearing, 0);
      start(B, A, bearing + Math.PI, 1);
      return;

      function start(me, other, faceYaw, phase) {
        const rec = record(me);
        rec.n = (rec.n | 0) + 1;
        rec.wait = dur + GAP.min;
        me.standFace = faceYaw;
        const id = me.stationSpecies === 'drazi' ? 'squareUp' : 'argue';
        begin(world, G, me, rec, id, dur, (g) => {
          g.phase = phase;
          g.faceYaw = faceYaw;
          g.argueYaw = 0.12 * (phase ? -1 : 1);
          g.other = other;
        });
      }
    }
  }
  /* THE FRIEND WHO PASSES. A walker of the same quarter, inside `BECKON_REACH`
   * of somebody standing, gets a hand raised at them. */
  for (const A of bodies) {
    if (A.__gesture?.g) continue;
    const home = homeOf(A);
    for (const w of life.live.values()) {
      if (!w?.wayR || !alive(w) || w.wayDwell > 0) continue;
      const dx = w.position.x - A.position.x, dz = w.position.z - A.position.z;
      if (dx * dx + dz * dz > BECKON_REACH * BECKON_REACH) continue;
      if (Math.abs(w.position.y - A.position.y) > 1.5) continue;
      if (homeOf(w) !== home) continue;
      const rec = record(A);
      const key = seedOf(A) * 31 + (w.stationSlot | 0);
      if (h2(key, rec.n * 3 + 1) > 0.5) continue;
      rec.n = (rec.n | 0) + 1;
      const yaw = clamp(wrapPi(Math.atan2(dx, dz) - (A.facing || 0)), -1.1, 1.1);
      begin(world, G, A, rec, 'beckon', 2.0 + h2(key, rec.n * 3 + 2) * 0.6, (g) => {
        g.beckonYaw = yaw; g.beckonSide = yaw > 0 ? 'L' : 'R';
      });
      return;
    }
  }
}

/* ══════════════════════════════════════════════════════════════════════════ */
/*  THE CUPS — a standing body in a bar is holding a drink                    */
/* ══════════════════════════════════════════════════════════════════════════ */

/**
 * `Bars` hands a SEATED body a cup; a room full of people standing at a bar
 * with nothing in their hands is the other half of *"drink"*. A standing
 * resident in a bar gets one, it rides the right hand every frame, and it goes
 * back when the body walks, sits, is touched or is put away.
 */
function stepCups(world, G, life, cx, cy, cz) {
  const cups = G.cups;
  for (const [body, cup] of cups) {
    if (eligible(body) && isBar(body.stationPlace)) {
      /* Past `CUP_RANGE` the hand is not being posed, so the cup would hang
       * in the air where the hand last was: it is hidden rather than left
       * there, and comes back the frame the drinker is worth drawing. */
      const seen = near(body, cx, cy, cz, CUP_RANGE);
      if (seen) cupInHand(cup, body.rig, 'R');
      if (cup.visible !== seen) cup.visible = seen;
      continue;
    }
    cup.parent?.remove(cup);
    cups.delete(body);
  }
}

/** Give one out, at most one a scan, so nothing is built in a burst. */
function offerCup(world, G, body) {
  if (G.cups.has(body) || G.cups.size >= CUP_CAP || !isBar(body.stationPlace)) return;
  if (body.stationRole === 'barman') return;
  const rec = record(body);
  if (h2(seedOf(body), 3) > 0.7) return;              // not everybody is drinking
  const cup = makeCup();
  world.scene.add(cup);
  G.cups.set(body, cup);
  rec.sipAt = G.time + SIP.first.min + h2(seedOf(body), 5) * SIP.first.span;
}

/* ══════════════════════════════════════════════════════════════════════════ */
/*  THE STEP                                                                  */
/* ══════════════════════════════════════════════════════════════════════════ */

/**
 * ONE FRAME OF EVERYBODY'S HANDS. Called by `StationLife.stepStanding`, after
 * its own loop, so the facing and the feet this reads are this frame's.
 */
export function stepGestures(world, life, dt) {
  if (!world || !life?.live || !(dt > 0)) return;
  const G = state(world);
  const t0 = HRT ? HRT() : 0;
  G.time += dt;

  /* The pair scan, on its own beat. */
  G.scan += dt;
  const scanning = G.scan >= PAIR_EVERY;
  if (scanning) { G.scan = 0; pairScan(world, G, life); }

  const cam = world.player?.camera?.obj?.position || world.player?.position;
  const cx = cam ? cam.x : 0, cy = cam ? cam.y : 0, cz = cam ? cam.z : 0;
  let active = 0, posed = 0;
  for (const body of life.live.values()) {
    if (!eligible(body)) {
      /* A body that has walked off, sat down or been touched drops whatever it
       * was doing — the gait owns it again on the next frame. */
      if (body?.__gesture?.g) { body.__gesture.g = null; body.__gesture.wait = GAP.min; }
      continue;
    }
    const rec = record(body);
    if (scanning) offerCup(world, G, body);
    const dx = body.position.x - cx, dy = body.position.y - cy, dz = body.position.z - cz;
    const d2 = dx * dx + dy * dy + dz * dz;
    /* THE CAP SHEDS RANGE AND NOT FACES: a body inside `POSE_CLOSE` is posed
     * whatever the crowd is doing, and the cap only decides how far out the
     * hands go on a frame. */
    const room = d2 <= POSE_CLOSE * POSE_CLOSE || posed < POSE_CAP;
    const g = rec.g;
    if (!g) {
      /* A drinker between sips still has the cup in its hand. */
      if (G.cups.has(body) && room && d2 <= CUP_RANGE * CUP_RANGE) {
        HOLD.row = HOLD.row || BY_ID.get('holdCup');
        layer(body.rig, body, HOLD, 1, G.time);
        posed++;
      }
      /* THE SIP DOES NOT QUEUE. Everything else waits its turn in the gap;
       * a drink that came due while the body was between gestures would
       * otherwise sit behind up to `GAP.span` of doing nothing, which is how
       * an 8–15 s clock became a 28 s one. */
      rec.wait -= dt;
      if (rec.wait <= 0 || (G.cups.has(body) && G.time >= rec.sipAt)) {
        const seed = seedOf(body);
        rec.wait = GAP.min + h2(seed, rec.n * 11 + 9) * GAP.span;
        choose(world, G, body, rec);
      }
      continue;
    }
    g.t += dt;
    if (g.t >= g.dur) {
      rec.g = null;
      rec.wait = GAP.min + h2(seedOf(body), rec.n * 11 + 9) * GAP.span;
      continue;
    }
    active++;
    /* A gesture that wants the body to STAND STILL keeps re-asserting its
     * post: `posture` may re-roll under it, and this is the frame after that
     * roll, so the overwrite is the last word. Nothing is done to `standIn` —
     * the sit verb's own clock is not this lane's to slow down. */
    if (g.hold) {
      body.standTx = body.standCx; body.standTz = body.standCz;
      if (g.faceYaw !== undefined) body.standFace = g.faceYaw;
    }
    if (!room || d2 > POSE_RANGE * POSE_RANGE) continue;
    const k = clamp(Math.min(g.t / BLEND, (g.dur - g.t) / BLEND), 0, 1);
    if (k <= 0) continue;
    layer(body.rig, body, g, k, G.time);
    posed++;
  }
  G.active = active; G.posed = posed;

  stepCups(world, G, life, cx, cy, cz);

  if (t0) G.ms = HRT() - t0;
}

/**
 * ONE GESTURE, APPLIED BY HAND — the seam the checks measure the poses
 * through, and the one a future lane can reuse to put a named gesture on a
 * body it owns (the player, a cutscene). `over` fills the record the row
 * reads: `t` for where in the gesture it is, and whatever context the row
 * wants (`railP`, `wallSide`, `argueYaw`).
 */
export function poseGesture(rig, body, id, k = 1, time = 0, over = null) {
  const row = BY_ID.get(id);
  if (!row || !rig?.hipsBone) return null;
  const g = { id, row, t: 0, dur: row.dur[0] || 2, phase: 0, hold: !!row.hold };
  if (over) Object.assign(g, over);
  layer(rig, body, g, clamp(k, 0, 1), time);
  return g;
}

/** Near enough to the eye that a wrist is worth solving. */
function near(body, cx, cy, cz, reach = POSE_RANGE) {
  const dx = body.position.x - cx, dy = body.position.y - cy, dz = body.position.z - cz;
  return dx * dx + dy * dy + dz * dz <= reach * reach;
}

/** For the checks and the HUD — `world._gestures.state()`. */
function gesturesState(world) {
  const G = world?._gestures;
  if (!G) return null;
  const counts = {};
  for (const [k, v] of G.counts) counts[k] = v;
  return {
    time: G.time, started: G.started, counts, distinct: G.counts.size,
    active: G.active, posed: G.posed, cups: G.cups.size,
    longest: G.longest, longestId: G.longestId, last: G.last, ms: G.ms,
  };
}

/** Everything this lane made, put down. */
export function undressGestures(world) {
  const G = world?._gestures;
  if (!G) return;
  for (const [, cup] of G.cups) cup.parent?.remove(cup);
  G.cups.clear();
  world._gestures = null;
}
