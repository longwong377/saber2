/**
 * SABER — combat resolution.
 *
 * Deflections are graded, never rolled. Cuts are geometric, never tagged. The
 * difference between a bolt scattering off your guard and a bolt going back
 * through the chest of the droid that fired it is entirely a question of how
 * fast the blade was moving, where along its length the bolt landed, and
 * whether you were looking at anything worth sending it to.
 */

import * as THREE from 'three';
import { segmentSegment } from '../physics/Physics.js';
import { clamp, lerp, smoothstep } from '../engine/MathUtil.js';
import { segmentCapsule } from './Bolts.js';

const _v1 = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3();
const _v4 = new THREE.Vector3(), _v5 = new THREE.Vector3(), _v6 = new THREE.Vector3();
const _a = new THREE.Vector3(), _b = new THREE.Vector3();
const _c1 = new THREE.Vector3(), _c2 = new THREE.Vector3();
/** The carrier velocity of a blade nobody has told us is being carried. */
const _STILL = new THREE.Vector3();

export const GRADE = { BLOCK: 0, DEFLECT: 1, RETURN: 2, PERFECT: 3 };
export const GRADE_NAME = ['BLOCK', 'DEFLECT', 'RETURN', 'PERFECT RETURN'];

/**
 * Difficulty.
 *
 * `boltSpeed` and `fireRate` are the two numbers that decide whether blocking
 * is learnable at all. At the old values a Knight-tier bolt crossed the last
 * ten metres in 0.13s, which is inside human reaction time — you could not
 * block, only guess. The tiers now span genuinely learnable to genuinely
 * brutal, and the ramp across a run does the rest.
 *
 * `assist` is THE SHARE OF YOUR ERROR THE TIER FORGIVES, and it means that in
 * both control schemes — but the error it forgives is a different error, because
 * the two schemes ask you for different things.
 *
 * Under DIRECTIONAL (the shipped scheme) you are not aiming a guard, you are
 * choosing one of four. So the tier buys ZONE TOLERANCE: how far round the
 * guard rose a bolt may arrive and still be answered by the zone you picked.
 * The base sector is 45° (a quarter of the rose each, so they tile it exactly)
 * and a full assist buys another 90°, which is the far edge of the adjacent
 * quadrant — see zoneTolerance() below. It stops one degree short of the
 * opposite zone at every tier, so no difficulty ever forgives a guard held the
 * wrong way round:
 *
 *   Padawan 0.92 — ±127.8°. Both neighbours, nearly whole. Point roughly right.
 *   Knight  0.70 — ±108.0°. Your quadrant and the whole of either neighbour's
 *                  half nearest you; an adjacent zone's own centre is answered.
 *   Master  0.30 — ±72.0°. Your quadrant plus a lip; the adjacent centre is not.
 *   Grandmaster 0 — ±45.0°. Your quadrant, exactly. Every zone is yours.
 *
 * Under FREE AIM ('hold' and 'free') it is the share of your guard-AIMING error
 * the deflection assist closes across 0.9 s of approach (see ASSIST_LEAD in
 * SaberController). It is worth knowing what these buy, because the blade's
 * capture window is ±12.5 cm and the guard's travel is ±93°, so unaided you must
 * place the guard within about 13° of a bolt's line to touch it at all:
 *
 * Measured at the 34 m Player.js actually searches (tools/checks/deflection.mjs):
 *
 *   Padawan 0.92 — 40° off arrives 3.5 cm out. Genuinely guides your guard.
 *   Knight  0.70 — 30° off arrives 10.5 cm out; past about 33° you are on your
 *                  own. Get roughly there and the assist finishes it.
 *   Master  0.30 — you must be within ~18° yourself.
 *   Grandmaster 0 — every bolt is yours.
 *
 * The old values (0.55/0.26/0.07/0) were on a formula that closed 53%/26%/6%/0%
 * of the error over a whole flight, so even Padawan — whose blurb promises the
 * assist guides your guard — missed a bolt you were 40° off. They are not
 * comparable to these and must not be read as a difficulty increase.
 */
export const DIFFICULTY = {
  padawan: {
    name: 'Padawan', blurb: 'The blade is forgiving. Assist guides your guard.',
    assist: 0.92, enemyAccuracy: 0.42, enemyAggression: 0.55, damageTaken: 0.55,
    deflectWindow: 1.6, boltSpeed: 0.34, fireRate: 0.5, chamberWindow: 0.22, staminaDrain: 0.7,
  },
  knight: {
    name: 'Knight', blurb: 'A fair fight. Light assist, honest bolts.',
    assist: 0.70, enemyAccuracy: 0.62, enemyAggression: 0.78, damageTaken: 0.85,
    deflectWindow: 1.25, boltSpeed: 0.46, fireRate: 0.65, chamberWindow: 0.17, staminaDrain: 0.9,
  },
  master: {
    name: 'Master', blurb: 'No hand on your wrist. They shoot to kill.',
    assist: 0.30, enemyAccuracy: 0.8, enemyAggression: 1.0, damageTaken: 1.15,
    deflectWindow: 1.0, boltSpeed: 0.63, fireRate: 0.85, chamberWindow: 0.14, staminaDrain: 1.0,
  },
  grandmaster: {
    name: 'Grandmaster', blurb: 'Zero assist. Every bolt is yours to answer.',
    assist: 0, enemyAccuracy: 0.94, enemyAggression: 1.25, damageTaken: 1.5,
    deflectWindow: 0.86, boltSpeed: 0.72, fireRate: 1.0, chamberWindow: 0.11, staminaDrain: 1.15,
  },
};

/**
 * The parry window, in seconds, and the tighter half of it that is worth a
 * PERFECT.
 *
 * 0.20 s is Chivalry 2's parry window. It is deliberately the same order as
 * CATCH.hold (0.25 s) and shorter than the 0.22 s worst-case gap inside an
 * enemy burst, so parrying every bolt of a burst means re-entering a zone for
 * every bolt of it and cannot be done by holding anything.
 *
 * The zone's own re-entry cooldown (PARRY.cooldown, 0.28 s in SaberController)
 * is longer than this window on purpose: two parry windows can never touch, so
 * the fraction of the time a player can be inside one tops out at 0.20/0.28 =
 * 71% however fast they mash.
 */
export const PARRY_GRADE = { window: 0.20, perfect: 0.10 };

/**
 * THE SPEED LADDER — the three blade speeds that decide what a contact is worth.
 *
 * These were four literals scattered through `captureSnapshot` and
 * `gradeCaught`, and `tools/balance.mjs` restated all three to grade its own
 * trace. So the harness could not tell you the gates were wrong: it was reading
 * from the same guess.
 *
 * WHY `perfect` MOVED, 15 -> 9.4. The harness drives the real SaberController
 * through the real authored overhead into a real Saber and reads the real tip
 * velocity at 240 Hz. It peaks at **10.97 m/s**. The old PERFECT gate was 15 —
 * about 1.37x a speed the blade cannot reach — so the top rung of the
 * deflection ladder could not be climbed by swinging at all, and the measured
 * grade mix over that trace was 51% BLOCK / 36% DEFLECT / 13% RETURN / 0%
 * PERFECT. Deflection is the most-used verb in this game and its best answer
 * was unreachable.
 *
 * 9.4 is 0.86 of the measured peak. It is deliberately NOT a number that a
 * decent swing clears: `gradeCaught` also demands `closing > 5` and
 * `bladeT > 0.55`, and because `bladeSpeed` is `speedAt(bladeT)` — a lerp from
 * a near-stationary base out to the tip — 9.4 at bladeT 0.55 means the TIP was
 * far above 9.4. So this is the last third of a committed cut, met near the
 * point, driving into the bolt. Rare, and now possible.
 *
 * It is expressed as a fraction of the measured peak in the check rather than
 * as an absolute, so that anything which changes how fast the blade moves — a
 * new attack, a grip spring, a boon that buys tip speed — is checked against
 * this ladder instead of silently walking away from it. See
 * tools/checks/balance.mjs.
 *
 * The parry route to PERFECT (`PARRY_GRADE.perfect`) is unchanged and always
 * worked; this is the other way up, the one for players who answer with the
 * blade rather than with the guard.
 */
export const SPEED_GRADE = {
  /** Below this and it is a BLOCK: the blade was carried, not driven. */
  driven: 3.2,
  /** …or this much closing speed, which is the same claim made another way. */
  closing: 1.6,
  /** A RETURN is aimed, so it needs a tip that was actually going somewhere. */
  return: 7.5,
  /** The top rung. See above — measured against the blade, not asserted at it. */
  perfect: 9.4,
  /** A PERFECT must also be driving INTO the bolt this hard… */
  perfectClosing: 5,
  /** …and be met this far along the blade. */
  perfectBladeT: 0.55,
};

/**
 * Did this contact earn a PERFECT on the blade alone?
 *
 * One function because there were two copies of the condition — the reticle
 * path and the physical/sweep path — and they were separate literals that had
 * to be kept in step by hand.
 */
export function bySpeed(bladeSpeed, closing, bladeT) {
  return bladeSpeed > SPEED_GRADE.perfect
    && closing > SPEED_GRADE.perfectClosing
    && bladeT > SPEED_GRADE.perfectBladeT;
}

/**
 * A tier's `assist`, as radians of extra rose forgiveness on a guard zone.
 *
 * One function so the ladder cannot drift: SaberController multiplies by
 * GUARD.tolerance and adds GUARD.sector, and this is the same arithmetic named
 * once. `base` and `full` are passed in rather than imported to keep Combat
 * free of a dependency on the controller — tools/checks/directional.mjs fails
 * the build if the two ever disagree.
 */
export function zoneTolerance(assist, base = 45 * Math.PI / 180, full = 90 * Math.PI / 180) {
  return base + clamp(assist ?? 0, 0, 1) * full;
}

/** Material toughness — how much blade speed·second it takes to part it. */
export const TOUGHNESS = {
  flesh: 0.9, cloth: 0.5, plastoid: 1.5, droid: 2.0, armour: 4.5,
  heavy: 14, durasteel: 42, blastdoor: 110, unbreakable: Infinity,
};

/**
 * A slash and a press are not the same act, and the old model could not tell
 * them apart.
 *
 * Work accrued as `speed * dt * 2.4`, which makes the criterion "cumulative
 * blade travel >= toughness / 2.4 metres": 0.375 m for flesh, 0.625 m for
 * plastoid, 0.83 m for a droid limb, 1.88 m for armour. But a slash only ever
 * travels about the chord of what it passes through — a trooper's torso is
 * r 0.18, so 0.36 m. Nothing above flesh could be severed by slashing AT ALL,
 * only by holding the blade against it, and every pass that failed emitted a
 * `grind`, which was pure VFX with no damage attached. That is the whole of
 * "you slash them and it appears to do nothing".
 *
 * Three terms fix it, and the patient-blast-door model survives all three:
 *
 *   rush      efficiency rising with the SQUARE of blade speed, so a committed
 *             swing parts what a lean cannot. At rest it is 1 and the model is
 *             exactly the old one.
 *   softness  but not against everything. Speed buys much less against `heavy`
 *             and above, or a thrown saber picks up enough efficiency to saw
 *             through a walker — which it did, and it made the Cleaving Throw
 *             boon buy nothing because the stock throw already went through all
 *             six test bodies.
 *   coverage  the share of the frame's sweep actually inside the capsule. A
 *             glancing frame used to bank its whole travel, so the same 14 m/s
 *             pass banked 2.42 at 60 Hz and 1.68 at 144 Hz — a 1.44x advantage
 *             to the slower machine. With coverage it is 1.78 and 1.76, 1.01x.
 *
 * Measured outcomes (tools/checks/cutting.mjs), one pass, severed or not:
 *
 *      flesh forearm  12 m/s  CUT        plastoid  3 m/s   grinds
 *      trooper torso  14 m/s  CUT        heavy    30 m/s   grinds
 *      droid torso    16 m/s  CUT        blastdoor 40 m/s  grinds
 *      B2 torso       26 m/s  CUT
 *
 * ARCHITECTURE IS EXEMPT FROM ALL OF IT. `cap.structure` takes rush, softness
 * and coverage out, so a destructible wall carves at exactly the rate it always
 * did. Bringing a building down is a patient-press mechanic whose statics —
 * flood fill, plan kerning, overturning — are calibrated against that rate;
 * speeding it up turned a 0.30 m notch into something that dropped a whole
 * column, and the destruction checks said so twice.
 */
const SLASH_REF = 8;     // m/s at which a swing does twice a press's work
const SLASH_CAP = 8;     // ceiling: no speed may slash through a blast door
const WORK_RATE = 2.4;   // unchanged, so every authored TOUGHNESS keeps its meaning

/** No contact for this long and accumulated cut work begins to fade. */
const PROGRESS_GRACE = 1.5;
const PROGRESS_FADE = 0.8;   // e-folds per second after the grace

/**
 * How much work it takes to get through a given capsule.
 *
 * Just the material's toughness: the budget is absolute, not per-metre. An
 * earlier version of this change scaled it by the capsule's chord so a wrist
 * would cost less than a wall, which is the more physical model — but it
 * retuned every destructible structure in the game at the same time, and the
 * statics behind them (flood fill, plan kerning, overturning) are calibrated
 * against the rate a blade carves stone. Two destruction checks failed
 * immediately and correctly. The chord model is the right one to come back to,
 * with the statics re-tuned alongside it; it is not something to slip in under
 * a combat fix.
 *
 * Exported because Destruction grades its own kerf and stress off the same
 * ratio, and the two must never drift apart.
 */
export function cutNeed(cap) {
  const tough = cap.toughness ?? TOUGHNESS.flesh;
  return tough < Infinity ? tough : Infinity;
}

/* ══════════════════════════════════════════════════════════════════════ */
/*  Catch and throw                                                       */
/* ══════════════════════════════════════════════════════════════════════ */

/**
 * The contradiction this exists to remove.
 *
 * The control scheme says: hold the button and the mouse IS the blade, the
 * camera is frozen. The deflection model says: where you LOOK decides where a
 * deflected bolt goes. Together they demanded that you aim with the camera at
 * the exact moment the game had taken the camera away from you — "I don't
 * understand how you're supposed to block and also aim at an enemy in the same
 * motion because when you're moving the blade to specifically deflect the
 * cursor can't move." No amount of tuning fixes that; the two halves have to
 * stop being simultaneous.
 *
 * So a bolt that meets the blade does not leave. It STICKS for `hold`, visibly
 * caught, and for exactly that long the camera comes back to the player even
 * with the blade button still down. Where you are looking when you let go — or
 * when the window expires — is where every bolt you are holding goes.
 *
 *   hold      0.25 s. The camera gain is 0.0024 rad per pixel, so an ordinary
 *             400 px flick inside that window swings the reticle 55° — right
 *             across the screen and past it. Anything shorter and you would be
 *             aiming at what happened to be in front of you already.
 *
 *             Note what it is NOT longer than: the gap inside an enemy burst is
 *             0.07–0.22 s (Enemy.js, `burstGap`), so the next bolt of the same
 *             burst WILL arrive while you are still holding this one and unable
 *             to steer the blade. That is not an oversight — it is exactly the
 *             shot the auto-guard cone below exists to take.
 *   maxOpen   0.60 s. A stack refreshes `hold` on every new catch, and without
 *             a ceiling a dense enough stream would keep the camera unlocked
 *             forever. 0.60 s caps it at roughly two refreshes.
 *   maxHeld   6 bolts. Past that the blade is a bouquet and nothing reads.
 */
export const CATCH = {
  hold: 0.25,
  maxOpen: 0.60,
  maxHeld: 6,

  /**
   * The auto-guard: the answer to "what about the shot arriving while I'm
   * mid-deflect". A MANUAL catch opens a cone in front of you for `autoGuard`
   * seconds, and anything arriving inside it is caught for free.
   *
   * cone is a HALF-angle: 20° here, so a 40° cone. Narrow on purpose. A shooter
   * 20 m away has to stand within 20·tan20° = 7.3 m of the one you just
   * answered to qualify — that is "the rest of this volley", not "the field".
   *
   * autoGuard is 0.40 s: comfortably over the 0.22 s worst-case gap inside a
   * burst, so it covers the follow-up shots of the burst you just answered, and
   * under the 0.40–3.5 s every archetype takes between bursts at the most
   * aggressive tier, so it has almost always shut again before the next one
   * starts. And crucially an AUTO catch does not re-open it: only a manual one
   * does. Without that rule a single good deflect chains through a stream
   * forever and the whole mechanic becomes hold-to-win.
   */
  autoGuard: 0.40,
  autoCone: 20 * Math.PI / 180,
  autoRadius: 1.25,
};

/**
 * One catch window per fighter. Holds the bolts, owns the two timers, and
 * decides when the throw happens.
 *
 * `heldAtCatch` is why letting go fires the throw only when the button was
 * actually down at the moment of the catch: a bolt caught with the mouse
 * already released has nothing to release, and must simply expire.
 */
export class CatchWindow {
  constructor() {
    this.held = [];
    this.t = 0;             // seconds left in the hold
    this.age = 0;           // seconds this window has been open
    this.auto = 0;          // seconds left on the auto-guard cone
    this.heldAtCatch = false;
    this.origin = new THREE.Vector3();
    // The chest the cone hangs off, KEPT BY REFERENCE rather than copied, so it
    // is wherever the body is now. See _followBody.
    this.anchor = null;
    this.axis = new THREE.Vector3(0, 0, -1);
    this.caught = 0;        // lifetime counters, for the HUD and for tests
    this.autoCaught = 0;
    this.vfx = 0;           // crackle throttle, drained by the owner
  }

  get open() { return this.t > 0; }
  get count() { return this.held.length; }

  /**
   * Bring the cone's origin back onto the body. The cone is a 1.25 m sphere
   * around your chest, and the chest moves: pinning the origin at the position
   * you happened to be standing in when the catch landed left the guard behind
   * in the world and you walked out of it. Measured, sprinting for the cone's
   * own 0.40 s lifetime: the origin ended up 2.98 m behind the chest — more
   * than twice the sphere's radius — and 14 of the next 24 bolts arriving
   * head-on at the actual chest fell outside a cone that was still nominally
   * open. The AXIS is a different matter and deliberately does not follow: it
   * points back down the line the bolt came in on and stays there, because the
   * whole point of the window is that you turn to look somewhere else.
   */
  _followBody() { if (this.anchor) this.origin.copy(this.anchor); }

  /** A guard descriptor for guardIntercept, or null when the cone is shut. */
  guard() {
    if (this.auto <= 0) return null;
    this._followBody();
    // origin and axis are handed over live, so a descriptor cached for the
    // frame keeps tracking the body for the rest of it.
    return { origin: this.origin, axis: this.axis, cone: CATCH.autoCone, radius: CATCH.autoRadius };
  }

  /**
   * Add a bolt. `manual` means the player put the blade on it themselves, which
   * is the only thing that opens (or re-opens) the auto-guard cone.
   *
   * …except that `manual` is not actually that claim. Callers set it from which
   * MECHANISM intercepted the bolt — `manual: !hit.auto`, i.e. "the blade sweep
   * found this one, not the cone" — and the rule the design leans on is about
   * whether the player DROVE the blade at it. Those came apart badly: with the
   * gate reading world-frame speed, a completely rigid wrist carried along at
   * walking pace answered 19 bolts by "hand" in ten seconds and held the cone
   * open for 64% of them, off a wrist that never moved. One deflect chaining
   * through a stream forever is the exact failure autoGuard's comment says the
   * rule exists to prevent, and it was reachable by walking.
   *
   * So when the contact itself is available — World passes the snapshot in as
   * `entry.snap` — the window checks it instead of taking the caller's word.
   * `snap.driven` is the blade half alone, so an auto-guard catch off a parked
   * blade cannot re-arm the cone and neither can a bolt that merely met a blade
   * being carried past it. Without a snapshot (hand-built entries in the
   * checks) the stated flag still decides.
   */
  add(entry, { manual = true, bladeHeld = false, chest = null, incoming = null } = {}) {
    if (this.held.length >= CATCH.maxHeld) return false;
    if (!this.open) { this.age = 0; this.heldAtCatch = bladeHeld; }
    this.held.push(entry);
    // Refresh the hold, but never past the ceiling on the whole window.
    this.t = Math.max(this.t, Math.min(CATCH.hold, Math.max(0, CATCH.maxOpen - this.age)));
    this.caught++;
    const snap = entry && entry.snap;
    const drove = snap && typeof snap.driven === 'boolean' ? snap.driven && snap.auto !== true : manual;
    if (manual && drove) {
      if (chest && incoming) {
        // Hold the chest itself, not a copy of where it was — see _followBody.
        this.anchor = chest;
        this.origin.copy(chest);
        // The cone points back down the line the bolt came in on, and it stays
        // there. It cannot follow the camera: the entire point of the window is
        // that you turn to look somewhere else, and a cone that turned with you
        // would evaporate exactly when the mechanic asks you to look away.
        this.axis.copy(incoming).negate().normalize();
      }
      this.auto = CATCH.autoGuard;
    } else if (!manual) this.autoCaught++;
    return true;
  }

  /** @returns true on the frame the throw should happen. */
  update(dt, bladeHeld) {
    if (this.auto > 0) { this.auto = Math.max(0, this.auto - dt); this._followBody(); }
    if (!this.open) return false;
    this.age += dt;
    this.t -= dt;
    if (this.heldAtCatch && !bladeHeld) { this.t = 0; return true; }
    if (this.t <= 0) { this.t = 0; return true; }
    if (this.age >= CATCH.maxOpen) { this.t = 0; return true; }
    return false;
  }

  // clear() ends the HOLD, not the cone — the cone is 0.40 s off the catch that
  // opened it and outlives the throw on purpose — so the anchor stays too.
  clear() { this.held.length = 0; this.t = 0; this.age = 0; this.heldAtCatch = false; }
  reset() { this.clear(); this.auto = 0; this.anchor = null; this.caught = 0; this.autoCaught = 0; }
}

/* ══════════════════════════════════════════════════════════════════════ */
/*  Deflection                                                            */
/* ══════════════════════════════════════════════════════════════════════ */

/**
 * Freeze everything about a contact that depends on the blade, at the instant
 * the blade and the bolt met.
 *
 * This is a separate step because of the catch window: a caught bolt is thrown
 * up to 250 ms later, by which time the blade may be parked and the camera has
 * moved. The blade half of the grade has to be the blade you actually hit with,
 * and the aim half has to be the aim you actually have on release.
 *
 * `caught` is the gate: only a driven blade takes hold of a bolt. A blade you
 * merely got in the way still BLOCKS, and a block scatters immediately as it
 * always has. That is what stops catch-and-throw becoming hold-to-win — a
 * parked blade cannot catch anything at all.
 *
 * EVERY BLADE NUMBER HERE IS MEASURED IN THE BODY'S FRAME, not the world's.
 * `saber.carrierVel` is the velocity of the body carrying the blade, published
 * by whoever holds it (Player does it beside the saber.update that already
 * takes the same vector for swingSpeed); absent, it is zero and this is the
 * plain world-frame reading it always was.
 *
 * This is not a refinement, it was the difference between a mechanic and a
 * bug. Measured on a completely rigid wrist — no mouse input at all — with the
 * gate reading world speed:
 *
 *   standing     0.00 m/s  closing 0.00  → not caught.   Correct.
 *   crouch-walk  2.21 m/s  closing 2.21  → CAUGHT.       Nothing moved but the feet.
 *   walk         4.60 m/s  closing 4.60  → CAUGHT.
 *   sprint       7.45 m/s  closing 7.45  → CAUGHT.
 *
 * The thresholds are 3.2 m/s and 1.6 m/s and ordinary walking is 4.6, so every
 * gait above a crouch cleared them on translation alone. Saber.js had already
 * learned this once for swingSpeed — "sprinting moves the tip at 7 m/s while
 * the wrist is perfectly still" — and the grade never got the same treatment.
 */
export function captureSnapshot(bolt, saber, hit) {
  const bladeT = clamp(hit.bladeT, 0, 1);
  const carrier = saber.carrierVel || _STILL;
  _c1.subVectors(saber.baseVelocity, carrier);
  _c2.subVectors(saber.tipVelocity, carrier);
  // Same shape as saber.speedAt(), one frame down: lerp of the two END speeds
  // rather than the speed of the lerped velocity, so with no carrier this is
  // bit-for-bit the number it used to be.
  const bladeSpeed = hit.bladeSpeed ?? lerp(_c1.length(), _c2.length(), bladeT);
  const boltDir = new THREE.Vector3().copy(bolt.vel).normalize();

  // surface normal: radial from the blade axis out toward the bolt
  _v2.subVectors(hit.point, saber.base);
  const along = _v2.dot(saber.axis);
  _v3.copy(saber.base).addScaledVector(saber.axis, along);
  const normal = new THREE.Vector3().subVectors(hit.point, _v3);
  if (normal.lengthSq() < 1e-8) normal.copy(boltDir).negate().projectOnPlane(saber.axis);
  if (normal.lengthSq() < 1e-8) normal.set(1, 0, 0);
  normal.normalize();
  if (normal.dot(boltDir) > 0) normal.negate();     // normal must face the bolt

  // blade velocity at the contact point, again in the body's frame
  const bladeVel = new THREE.Vector3().lerpVectors(_c1, _c2, bladeT);
  const closing = -bladeVel.dot(boltDir);           // >0 means driving into the bolt

  // `driven` is the blade half of the claim on its own, and it is deliberately
  // NOT the same thing as `caught`: the auto-guard cone catches off a parked
  // blade — that is what it is for — so `caught` is true there and `driven` is
  // false. The catch window needs them apart, because the rule that keeps the
  // cone from chaining forever is about which catches the player DROVE, and a
  // bolt that merely met a blade being carried past it is not one of them.
  const driven = bladeSpeed > SPEED_GRADE.driven || closing > SPEED_GRADE.closing;

  // A PARRY is the directional guard's own claim on this contact, stamped onto
  // the bolt by Bolts.update because World rebuilds the hit descriptor from
  // three fields on its way here and anything else would be dropped in transit.
  //
  // It exists as a SEPARATE claim from `driven` because the two measure
  // different things and the numbers say so. Measured, snapping the guard from
  // one authored zone pose to another and reading the blade at bladeT 0.62:
  //
  //   ready → RIGHT  1.8 m/s      HIGH → LOW    7.9 m/s
  //   ready → HIGH   3.9 m/s      LEFT → RIGHT  8.1 m/s
  //   ready → LOW    6.0 m/s      (the RETURN gate is 7.5)
  //
  // So a zone flick does NOT reliably drive the blade hard enough to earn a
  // RETURN by speed, and half of them never would. Timing is what a directional
  // parry is made of, not force: it is a second way to EARN the same grade, not
  // a second grade. See gradeCaught.
  const gz = bolt.guardZone;
  const parry = gz && gz.parry ? { zone: gz.zone, age: gz.age ?? 0 } : null;

  return {
    bladeT, bladeSpeed, closing, boltDir, normal, bladeVel, driven, parry,
    point: new THREE.Vector3().copy(hit.point),
    caught: hit.auto === true || driven,
    auto: hit.auto === true,
  };
}

/**
 * @param bolt      the incoming bolt
 * @param saber     the blade it met
 * @param hit       { bladeT, point } from intersectBladeSweep
 * @param ctx       { aimOrigin, aimDir, candidates, flow, difficulty, skillBias }
 * @returns { grade, dir, damageMul, target }
 */
export function gradeDeflection(bolt, saber, hit, ctx) {
  return gradeCaught(captureSnapshot(bolt, saber, hit), ctx);
}

/**
 * Turn a frozen contact into an outgoing bolt, using the aim you have NOW.
 *
 * `ctx.caught` says the bolt was held and is being thrown deliberately, which
 * changes exactly one thing and it is the whole point: the direction is your
 * sightline, not a compromise between your sightline and a mirror. You caught
 * it, you looked somewhere, it goes there.
 */
export function gradeCaught(snap, ctx) {
  const { bladeT, bladeSpeed, closing, boltDir } = snap;
  const _v4 = snap.normal;
  // The parry's two rungs. Entering a guard zone inside PARRY_GRADE.window of
  // the bolt arriving earns the RETURN a fast tip earns; inside the tighter
  // `perfect` half it earns the PERFECT. Nothing else about the ladder moves —
  // there is one ladder, and this is a second way onto it.
  const parry = snap.parry || null;
  const sharp = !!parry && parry.age <= PARRY_GRADE.perfect;

  let grade = snap.caught ? GRADE.DEFLECT : GRADE.BLOCK;

  // Return: a fast tip, and somewhere worth sending it
  const mode = ctx.aimMode || 'reticle';
  const thrown = !!(ctx.caught && snap.caught);
  let target = null;
  const tipZone = bladeT > 0.42;
  // A thrown bolt always LOOKS for the victim under the reticle, because that
  // is the promise the window made. What it does not get for free is the RETURN
  // grade: the tip-speed gate is unchanged, so the 1.5x still has to be earned
  // by meeting the bolt properly. An auto-guard catch off a parked blade is
  // aimed and worth 1.0x — help, not a reward.
  //
  // Only the reticle model promotes a deflect to a RETURN by finding a victim;
  // under the physical and sweep models a bolt reaches an enemy because you
  // pointed the blade at them, not because the game looked for one.
  if ((mode === 'reticle' || thrown) && grade === GRADE.DEFLECT && ctx.candidates
      && (thrown || parry || (bladeSpeed > SPEED_GRADE.return && tipZone))) {
    target = pickReturnTarget(ctx.aimOrigin, ctx.aimDir, ctx.candidates, ctx.returnCone ?? 0.42);
    if (target && (parry || (bladeSpeed > SPEED_GRADE.return && tipZone))) grade = GRADE.RETURN;
  }
  if (grade === GRADE.RETURN && (sharp || bySpeed(bladeSpeed, closing, bladeT))) {
    grade = GRADE.PERFECT;
  }

  // ── outgoing direction: three models, chosen by ctx.aimMode
  const out = new THREE.Vector3();
  const mirror = _a.copy(boltDir).reflect(_v4).normalize();

  if (thrown) {
    // CAUGHT — held on the blade, then thrown. The camera has been yours for
    // the whole window, so there is no excuse left and no compromise: straight
    // at the victim under the reticle, or straight down the sightline.
    if (target) out.subVectors(target.point, snap.point).normalize();
    else if (ctx.aimDir) out.copy(ctx.aimDir).normalize();
    else out.copy(mirror);
    const jitter = (1 - clamp(ctx.flow ?? 0, 0, 1)) * (grade === GRADE.PERFECT ? 0.006 : 0.018);
    out.x += (Math.random() - 0.5) * jitter;
    out.y += (Math.random() - 0.5) * jitter;
    out.z += (Math.random() - 0.5) * jitter;
    out.normalize();
  } else if (grade === GRADE.BLOCK) {
    // A block is not aimed under any model — you got the blade in the way and
    // the bolt went somewhere. That is the whole difference from a deflect.
    out.copy(mirror);
    const scatter = 0.55;
    out.x += (Math.random() - 0.5) * scatter;
    out.y += (Math.random() - 0.5) * scatter + 0.12;
    out.z += (Math.random() - 0.5) * scatter;
    out.normalize();
  } else if (mode === 'physical') {
    // PHYSICAL — the bolt mirrors off the blade's real surface and nothing
    // else. Completely honest, completely unforgiving: to place a bolt you
    // must set the blade's angle in three dimensions inside the contact
    // window. You will hit things, but mostly by accident.
    out.copy(mirror).addScaledVector(snap.bladeVel, 0.018).normalize();
  } else if (mode === 'sweep') {
    // SWEEP — the bolt goes where you SWUNG. Drag the blade left and it flies
    // left. Very physical to read, and it uses the motion you were already
    // making, but it welds aiming to the same input that does the blocking:
    // the swing that blocks best is not the swing that aims best.
    if (snap.bladeVel.lengthSq() > 1e-6) {
      out.copy(snap.bladeVel).normalize().multiplyScalar(clamp(bladeSpeed / 14, 0.25, 1));
      out.addScaledVector(mirror, 0.55).normalize();
    } else out.copy(mirror);
  } else {
    // RETICLE (default) — where you LOOK decides where it goes; the blade
    // decides IF it goes. Two independent skills, which is what makes this
    // feel like mastery instead of luck: time the contact with the blade, pick
    // the victim with the camera. Meet the bolt cleanly with nothing under the
    // crosshair and you still get an honest mirror.
    if (target) {
      out.subVectors(target.point, snap.point).normalize();
      const jitter = (1 - clamp(ctx.flow ?? 0, 0, 1)) * (grade === GRADE.PERFECT ? 0.008 : 0.028);
      out.x += (Math.random() - 0.5) * jitter;
      out.y += (Math.random() - 0.5) * jitter;
      out.z += (Math.random() - 0.5) * jitter;
      out.normalize();
    } else if (ctx.aimDir) {
      // no victim, but a clean deflect still throws it down your sightline
      out.copy(mirror).lerp(ctx.aimDir, 0.55).normalize();
    } else {
      out.copy(mirror);
    }
  }

  // Under the physical and sweep models nothing has claimed a target yet, so
  // check whether the bolt we just produced is actually going to reach one —
  // earning the same RETURN credit by aim rather than by assist.
  if (mode !== 'reticle' && !thrown && grade === GRADE.DEFLECT && ctx.candidates) {
    const hitting = pickReturnTarget(snap.point, out, ctx.candidates, 0.06);
    if (hitting) {
      target = hitting;
      grade = bySpeed(bladeSpeed, closing, bladeT) ? GRADE.PERFECT : GRADE.RETURN;
    }
  }

  const damageMul = grade === GRADE.PERFECT ? 2.5 : grade === GRADE.RETURN ? 1.5 : 1.0;
  return { grade, dir: out, damageMul, target, bladeSpeed, normal: _v4.clone(), bladeT };
}

/** Nearest valid enemy inside the aim cone. */
export function pickReturnTarget(origin, aimDir, candidates, cone = 0.42) {
  let best = null, bestScore = -1;
  for (const c of candidates) {
    if (!c || c.dead) continue;
    const p = c.aimPoint ? c.aimPoint(_v6) : (c.position ? _v6.copy(c.position) : null);
    if (!p) continue;
    _v1.subVectors(p, origin);
    const dist = _v1.length();
    if (dist < 1.2 || dist > 90) continue;
    _v1.multiplyScalar(1 / dist);
    const dot = _v1.dot(aimDir);
    if (dot < 1 - cone) continue;
    const score = dot * 2 + (1 - clamp(dist / 90, 0, 1));
    if (score > bestScore) { bestScore = score; best = { entity: c, point: p.clone(), dist }; }
  }
  return best;
}

/* ══════════════════════════════════════════════════════════════════════ */
/*  Blade vs bodies                                                       */
/* ══════════════════════════════════════════════════════════════════════ */

export class BladeContactSolver {
  constructor() {
    this.progress = new Map();      // "actorId:bone" → accumulated cut work
    this.touched = new Map();       // …and when that work was last added to
    this.cooldown = new Map();
    this.time = 0;
    this.activeCuts = [];           // for slag VFX on heavy materials
  }

  /**
   * @param saber        the blade doing the cutting
   * @param targets      [{ id, capsules:[{name,p0,p1,r,toughness,vital}], onCut, onGraze, team }]
   * @param opts.power   damage multiplier from boons
   * @returns array of events
   */
  solve(saber, targets, dt, opts = {}) {
    this.time += dt;
    const events = [];
    this.activeCuts.length = 0;
    if (saber.ignition < 0.7) return events;

    const SLICES = 4;
    for (const target of targets) {
      if (!target || target.dead) continue;
      const caps = target.capsules;
      if (!caps || !caps.length) continue;

      for (const cap of caps) {
        const key = target.id + ':' + cap.name;
        const cd = this.cooldown.get(key) || 0;
        if (cd > this.time) continue;

        // Sweep the blade across the frame so a fast slash cannot skip a limb.
        //
        // Every sub-sample is tested, not just up to the first hit, because the
        // COUNT of them is the frame's contact coverage — and crediting a whole
        // frame's travel for a glancing touch is what made cut work depend on
        // refresh rate. Measured on one 14 m/s pass through a 0.18 m capsule:
        // 60 Hz banked 2.42 and 144 Hz banked 1.68, a 1.44x advantage to the
        // slower machine. Scaling by coverage is what closes that.
        let hit = null, touching = 0;
        for (let i = 0; i <= SLICES; i++) {
          const k = i / SLICES;
          _v1.lerpVectors(saber.prevBase, saber.base, k);
          _v2.lerpVectors(saber.prevTip, saber.tip, k);
          const h = segmentCapsule(_v1, _v2, cap.p0, cap.p1, cap.r);
          if (h) { touching++; if (!hit) hit = h; }
        }
        if (!hit) continue;
        const coverage = touching / (SLICES + 1);

        const bladeT = clamp(hit.s, 0, 1);
        const speed = saber.speedAt(bladeT) * (opts.power ?? 1);
        const tough = cap.toughness ?? TOUGHNESS.flesh;

        if (tough === Infinity) {
          events.push({ type: 'clang', target, cap, point: hit.point.clone(), bladeT });
          saber.strain(0.8);
          this.cooldown.set(key, this.time + 0.12);
          continue;
        }

        // You cannot do more cutting work than the material you actually passed
        // through, so the credit is capped at the capsule's own chord. That cap
        // is what makes this frame-rate independent: at 60 Hz a fast swing
        // covers 0.33 m in one frame and used to bank all of it for a glancing
        // touch, while at 144 Hz the same swing banked 0.139 m over the two or
        // three frames it overlapped. Same swing, 2.4x the work, purely because
        // of refresh rate. Both now converge on the chord.
        // Speed helps, but not against everything. Swinging harder parts flesh
        // and plate; it does not get you through a walker's belly armour or a
        // blast door, and without the softness term it did — a thrown saber
        // picked up enough efficiency to saw through six bodies including two
        // `heavy` ones, which made the Cleaving Throw boon buy nothing because
        // the stock throw already went through everything.
        const softness = clamp(TOUGHNESS.armour / tough, 0.25, 1);
        const rush = (speed / SLASH_REF) * (speed / SLASH_REF) * softness;
        // Architecture is exempt, deliberately. Bringing a wall down is a
        // patient-press mechanic whose statics — flood fill, plan kerning,
        // overturning — are tuned against the rate a blade carves stone, and
        // speeding that up carved a 0.30 m notch into something that dropped a
        // whole column. The complaint this whole change answers is about things
        // that bleed and things you can pick up, so that is where it applies.
        const slash = cap.structure ? 1 : coverage * Math.min(SLASH_CAP, 1 + rush);
        const dWork = speed * dt * WORK_RATE * slash;
        const need = cutNeed(cap);

        // Work fades once the blade leaves, so nothing is whittled down by a
        // hundred incidental touches over a fight.
        let prior = this.progress.get(key) || 0;
        const gap = this.time - (this.touched.get(key) ?? this.time);
        // A kerf cut into stone does not heal, and Destruction paints a
        // widening mark at fixed fractions of it, so structures never fade. A
        // body does, or a fight-long accumulation of incidental touches would
        // eventually take a limb off by itself. The grace has to outlast a
        // slashing RHYTHM rather than a single frame: at 0.4 s it was shorter
        // than the gap between passes of a blade sweeping at 1.1 Hz, so a
        // column being worked on healed faster than it was being cut.
        if (prior > 0 && !cap.structure && gap > PROGRESS_GRACE) {
          prior *= Math.exp(-(gap - PROGRESS_GRACE) * PROGRESS_FADE);
        }
        this.touched.set(key, this.time);

        const work = prior + dWork;
        if (work < need) {
          this.progress.set(key, work);
          saber.strain(clamp(0.25 + tough / 60, 0, 1));
          this.activeCuts.push({ point: hit.point.clone(), progress: work / need, cap, target });
          // `dWork` and `tough` ride along because a grind has to HURT. It used
          // to be particles and nothing else, so every slash that failed to
          // sever was cosmetic and the player read it as the blade doing
          // nothing at all.
          events.push({ type: 'grind', target, cap, point: hit.point.clone(), bladeT,
            progress: work / need, speed, dWork, need });
          continue;
        }
        this.progress.delete(key);
        this.touched.delete(key);

        // where along the limb did the blade cross?
        const cutT = clamp(hit.t, 0.06, 0.94);
        _v3.subVectors(cap.p1, cap.p0);
        const cutPoint = _v4.copy(cap.p0).addScaledVector(_v3, cutT);

        // the cut plane is the plane the blade swept
        const dirImpulse = _v5.lerpVectors(saber.baseVelocity, saber.tipVelocity, bladeT).clone();
        events.push({
          type: 'cut', target, cap, bone: cap.name, cutT, bladeT, speed,
          point: cutPoint.clone(), impulse: dirImpulse, normal: saber.sweepNormal.clone(),
        });
        saber.strain(0.5);
        this.cooldown.set(key, this.time + 0.14);
      }
    }
    return events;
  }

  /**
   * Forget accumulated work.
   *
   * `capName` matters more than it looks. Every destructible structure in a
   * level — every column, every wall, every cell of every one of them — reaches
   * the solver through ONE DestructionProxy sharing ONE id. So the prefix sweep,
   * called on each successful cut, was wiping the grind progress on every other
   * cell in the level every time one cell parted. Pass the capsule when only
   * that capsule is gone; pass nothing when the whole target is (a real Prop
   * gets replaced by its halves, which carry new ids).
   */
  clearTarget(id, capName = null) {
    if (capName != null) {
      const k = id + ':' + capName;
      this.progress.delete(k); this.touched.delete(k); this.cooldown.delete(k);
      return;
    }
    for (const k of [...this.progress.keys()]) if (k.startsWith(id + ':')) { this.progress.delete(k); this.touched.delete(k); }
    for (const k of [...this.cooldown.keys()]) if (k.startsWith(id + ':')) this.cooldown.delete(k);
  }

  reset() { this.progress.clear(); this.touched.clear(); this.cooldown.clear(); }
}

/* ══════════════════════════════════════════════════════════════════════ */
/*  Blade vs blade                                                        */
/* ══════════════════════════════════════════════════════════════════════ */

/**
 * @returns null | { type:'chamber'|'parry'|'bind'|'clash', point, winner, power }
 */
export function resolveBladeClash(a, b, ctxA, ctxB) {
  if (a.ignition < 0.6 || b.ignition < 0.6) return null;
  const res = segmentSegment(a.base, a.tip, b.base, b.tip, _a, _b);
  const r = 0.10;
  if (res.distSq > r * r) return null;

  const point = _a.clone().lerp(_b, 0.5);
  const ta = clamp(res.s, 0, 1), tb = clamp(res.t, 0, 1);

  _v1.lerpVectors(a.baseVelocity, a.tipVelocity, ta);
  _v2.lerpVectors(b.baseVelocity, b.tipVelocity, tb);
  const sa = _v1.length(), sb = _v2.length();

  // are the blades driving into each other, or resting together?
  _v3.subVectors(_v1, _v2);
  const closing = _v3.length();

  let type;
  if (closing < 2.6 && sa < 4 && sb < 4) type = 'bind';
  else if (sa > 6 && sb > 6) type = 'clash';
  else type = 'parry';

  // chamber: the defender's blade is moving directly against the attacker's arc
  const attacker = sa > sb ? 'a' : 'b';
  const atkV = attacker === 'a' ? _v1 : _v2;
  const defV = attacker === 'a' ? _v2 : _v1;
  const atkSpeed = attacker === 'a' ? sa : sb;
  const defSpeed = attacker === 'a' ? sb : sa;
  let chambered = null;
  if (atkSpeed > 5.5 && defSpeed > 4.0) {
    const align = -_v4.copy(defV).normalize().dot(_v5.copy(atkV).normalize());
    if (align > 0.72) { type = 'chamber'; chambered = attacker === 'a' ? 'b' : 'a'; }
  }

  const power = clamp((sa + sb) / 28, 0.2, 1.6);
  const winner = type === 'chamber' ? chambered : (sa > sb ? 'a' : 'b');
  return { type, point, winner, power, sa, sb, ta, tb, closing };
}
