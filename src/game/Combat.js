/**
 * BATTLEFRONT BORZ — combat resolution.
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
/* MORALE is a leaf table (it imports nothing at all — see its own header), so
 * this edge cannot be part of a cycle. SCREEN.reach reads `MORALE.NEAR` rather
 * than repeating it: one radius for "this Jedi is with these men". */
import { MORALE } from './Morale.js';

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
 *   Padawan 0.90 — ±126.0°. Both neighbours, nearly whole. Point roughly right.
 *   Knight  0.65 — ±103.5°. Your quadrant and most of either neighbour's half
 *                  nearest you; an adjacent zone's own centre is answered.
 *   Master  0.30 — ±72.0°. Your quadrant plus a lip; the adjacent centre is not.
 *   Grandmaster 0 — ±45.0°. Your quadrant, exactly. Every zone is yours.
 *
 * Steps of 22.5°, 31.5° and 27°, which used to be 19.8°, 36° and 27° — see the
 * note on the table below for what that uneven 36° step was doing.
 *
 * Under FREE AIM ('hold' and 'free') it is the share of your guard-AIMING error
 * the deflection assist closes across 0.9 s of approach (see ASSIST_LEAD in
 * SaberController). It is worth knowing what these buy, because the blade's
 * capture window is ±12.5 cm and the guard's travel is ±93°, so unaided you must
 * place the guard within about 13° of a bolt's line to touch it at all:
 *
 * Measured at the 34 m Player.js actually searches (tools/checks/deflection.mjs):
 *
 *   Padawan 0.90 — 40° off arrives about 4 cm out. Genuinely guides your guard.
 *   Knight  0.65 — 30° off arrives 12.0 cm out, just inside the window; past
 *                  30° you are on your own. Get roughly there and it finishes it.
 *   Master  0.30 — you must be within ~18° yourself.
 *   Grandmaster 0 — every bolt is yours.
 *
 * The old values (0.55/0.26/0.07/0) were on a formula that closed 53%/26%/6%/0%
 * of the error over a whole flight, so even Padawan — whose blurb promises the
 * assist guides your guard — missed a bolt you were 40° off. They are not
 * comparable to these and must not be read as a difficulty increase.
 */
/**
 * The four tiers — and why these numbers moved.
 *
 * MEASURED, by `tools/balance.mjs`, at three modelled skill levels. The old
 * ladder was correctly ORDERED and badly SPACED, and the spacing is what a
 * player actually experiences:
 *
 *   skill "sharp"   Padawan 26.0   Knight 26.0   Master 2.87   Grandmaster 1.13
 *
 * 26 is the model's ceiling, so a good player never died on either of the first
 * two tiers and died on wave three of the third. Four settings, two
 * experiences: "you cannot lose" and "you cannot play". There was no tier in
 * between, which is the one a difficulty menu exists to offer.
 *
 * The cause is not any single dial — each of the four climbs in even steps. It
 * is that they MULTIPLY. What actually reaches the player is
 *
 *     (share of bolts unanswered) x fireRate x accuracy x damageTaken
 *
 * and the first term is the violent one: 98% answered at Knight against 83% at
 * Master is an 8.5x increase in what gets through, which then meets a 2.3x
 * bigger hit. Nineteen times the damage, for one step of the menu.
 *
 * Two changes, both aimed at the compounding rather than at any one number:
 *
 *   THE ASSIST STEPS MORE EVENLY. 0.92/0.70/0.30/0 gave guard zones of
 *   127.8/108/72/45 degrees — steps of 19.8, 36 and 27, and that 36-degree step
 *   between Knight and Master was most of the cliff. It is now 0.90/0.65/0.30/0
 *   = 126/103.5/72/45, steps of 22.5, 31.5 and 27.
 *
 *   NOT the equal 27s that would be ideal, and the reason is worth recording:
 *   Knight cannot go below 0.65. Under free aim the same number buys forgiveness
 *   of a guard-AIMING error, and `assist: a badly placed guard still blocks on
 *   the forgiving tiers` requires a 30-degree-off Knight guard to land inside
 *   the blade's ±12.5 cm capture window. Measured: 0.60 misses by 13.6 cm, 0.63
 *   by 12.6, 0.65 by 12.0. So one number serves two schemes with different
 *   needs, and 0.65 is where they meet. Squaring that properly means giving the
 *   two schemes their own dial, which is a larger change than this.
 *
 *   Grandmaster keeps assist 0 exactly, because its blurb promises "zero
 *   assist" and a blurb is a contract.
 *
 *   THE DAMAGE PRODUCT GROWS MORE SLOWLY AT THE TOP. It stepped 2.97x, 2.28x,
 *   1.80x; the top two tiers were being punished twice for the same thing,
 *   since they already ask you to answer far more of it yourself.
 *
 * MEASURED AFTER, same harness, same seeds:
 *
 *   sharp       26.0   21.2   3.63   1.25     steps 1.2x, 5.8x, 2.9x (was 1.0, 9.1, 2.5)
 *   competent   22.6    5.7   1.50   0.64     steps 3.9x, 3.8x, 2.3x
 *
 * The competent ladder is now genuinely even. The sharp one still has a step at
 * Knight -> Master, halved but not gone, and it is not obvious it should be:
 * a player who answers 98% of bolts saturates the lower tiers by construction,
 * so any tier where they answer less looks violent by ratio. Tuning that number
 * further would be fitting to a model whose own header says not to read a row as
 * a prediction about a human. Knight is at least a fight now rather than a
 * formality — it was the ceiling at every skill level and is not.
 *
 * The ordering is unchanged and is checked — see tools/checks/balance.mjs, which
 * fails if any dial stops being monotonic across the four.
 */
export const DIFFICULTY = {
  padawan: {
    name: 'Padawan', blurb: 'The blade is forgiving. Assist guides your guard.',
    assist: 0.90, enemyAccuracy: 0.42, enemyAggression: 0.55, damageTaken: 0.55,
    deflectWindow: 1.6, boltSpeed: 0.34, fireRate: 0.5, staminaDrain: 0.7,
  },
  knight: {
    name: 'Knight', blurb: 'A fair fight. Light assist, honest bolts.',
    assist: 0.65, enemyAccuracy: 0.62, enemyAggression: 0.78, damageTaken: 0.85,
    deflectWindow: 1.25, boltSpeed: 0.46, fireRate: 0.65, staminaDrain: 0.9,
  },
  master: {
    name: 'Master', blurb: 'No hand on your wrist. They shoot to kill.',
    assist: 0.30, enemyAccuracy: 0.76, enemyAggression: 1.0, damageTaken: 1.05,
    deflectWindow: 1.0, boltSpeed: 0.63, fireRate: 0.80, staminaDrain: 1.0,
  },
  grandmaster: {
    name: 'Grandmaster', blurb: 'Zero assist. Every bolt is yours to answer.',
    assist: 0, enemyAccuracy: 0.88, enemyAggression: 1.25, damageTaken: 1.25,
    deflectWindow: 0.86, boltSpeed: 0.72, fireRate: 0.92, staminaDrain: 1.15,
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
 * A tier's scale on the parry window, clamped and defaulting to 1.
 *
 * Named here rather than read inline for the same reason `zoneTolerance` is:
 * two readers of one ladder drift, and this one already spent its whole life
 * with zero readers. The clamp is what stops a mistyped tier from making the
 * window either infinite or negative — at 0 every parry is late, which is
 * indistinguishable from the parry system being switched off.
 */
export function parryScale(difficulty) {
  const v = difficulty?.deflectWindow;
  return typeof v === 'number' && isFinite(v) ? clamp(v, 0.5, 2.5) : 1;
}

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
  /**
   * …and it must be met past this fraction of the blade, measured from the
   * emitter. NAMED, because it was the bare literal `0.42` inside gradeCaught
   * and `pickReturnTarget`'s default aim cone is ALSO 0.42 — two unrelated
   * gates in one function wearing the same number. Soresu's card text sold
   * itself as "deflection is forgiven further along the blade" while the thing
   * it moves is the aim cone, which is very hard to write by accident unless
   * the two numbers look identical on the screen. They no longer do.
   */
  returnBladeT: 0.42,
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
 * ══ WHAT A WEAK POINT IS MADE OF, AND WHY IT IS NOT A MULTIPLIER ══════════
 *
 * A big body's weak point — the bare hinge where a leg plate stops, the soft
 * underside of an animal, the intake in the back of a hull — is a place where
 * there is LESS MATERIAL BETWEEN THE EDGE AND THE INSIDE. That is a statement
 * about the substance at that spot and nothing else, so the only honest thing
 * for it to change is the substance: the capsule there is charged the NEXT
 * MATERIAL DOWN this table, and every other term in the model is untouched.
 *
 * The alternative — a `weakMultiplier` on damage — was rejected, and it is
 * worth saying why in the file that owns the cut model rather than in a commit
 * message. `cutNeed` is a budget of work; `dWork` is work done. A multiplier on
 * the OUTPUT would make the same hide part at the same rate and simply pay more
 * for it, which is not what a thin place is; a body would take the same number
 * of seconds to come apart and just die sooner, and the blade would feel
 * identical in the hand at the spot and away from it. Charging the material
 * instead means the blade goes THROUGH faster, which is the thing a player can
 * feel without being told, and it composes with everything else for free —
 * `rush`, `coverage`, `openness` and the grind's own `dWork / need` share all
 * keep their meaning, and `Destruction` (which grades its kerf off `cutNeed`)
 * never sees a term it does not know about.
 *
 * ── ONE RUNG, AND THE RUNG IS THE TABLE'S OWN ─────────────────────────────
 *
 * `thinner` takes the next value DOWN the sorted table rather than a fraction,
 * so there is no new number anywhere in this feature: the spacing of the ladder
 * above IS the game's existing statement about how far apart two materials are.
 * Measured on the shipped table, one rung buys
 *
 *     durasteel → heavy    42 → 14     3.00×
 *     heavy     → armour   14 → 4.5    3.11×
 *     armour    → droid    4.5 → 2.0   2.25×
 *     droid     → plastoid 2.0 → 1.5   1.33×
 *     plastoid  → flesh    1.5 → 0.9   1.67×
 *     flesh     → cloth    0.9 → 0.5   1.80×
 *
 * — a consistent 1.3–3.1×, which is the reward for aiming, and it is largest
 * exactly where the body is most armoured. `cloth` is the bottom of the ladder
 * and returns itself: there is nothing thinner than the thinnest thing.
 *
 * `Infinity` is filtered out for the obvious reason and one less obvious one: a
 * gap in something UNBREAKABLE would be the only place in the game a blade
 * could get through a wall, and `unbreakable` exists precisely to be the
 * material that has no such place.
 */
const LADDER = [...new Set(Object.values(TOUGHNESS))].filter(Number.isFinite).sort((a, b) => a - b);
export function thinner(tough) {
  for (let i = LADDER.length - 1; i > 0; i--) if (LADDER[i] <= tough) return LADDER[i - 1];
  return LADDER[0];
}

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
 * and coverage out, so a destructible wall carves at the rate it always did per
 * FRAME OF CONTACT. Bringing a building down is a patient-press mechanic whose
 * statics — flood fill, plan kerning, overturning — are calibrated against that
 * rate; speeding it up turned a 0.30 m notch into something that dropped a
 * whole column, and the destruction checks said so twice.
 *
 * "PER FRAME OF CONTACT" IS THE PART THAT WAS MISSING, and it is why the
 * exemption did not protect architecture from the sampler being replaced. A
 * structure frame is billed the whole of `speed * dt` however little of the
 * frame was spent inside the stone, so for a wall — and only for a wall — the
 * answer is decided by HOW MANY frames register a touch. Measured on the
 * shipped destruction scene, a blade held just onto a column face and swept:
 * 182 contact frames under the old five-sample sweep against 98 under this one,
 * for a press that lasts the same eight seconds either way. Phase-averaged the
 * work per frame is unchanged (0.98–0.99), so nothing here is a strength
 * change; what moved is the count.
 */
const SLASH_REF = 8;     // m/s at which a swing does twice a press's work
const SLASH_CAP = 8;     // ceiling: no speed may slash through a blast door
/**
 * WORK_RATE — AND WHY IT IS STILL 2.4 AFTER THE SAMPLER CHANGED UNDER IT.
 *
 * This line used to read "unchanged, so every authored TOUGHNESS keeps its
 * meaning", and that sentence was made false by the fix above it: the sampler
 * that decides how much of a frame counts as contact was replaced, so the
 * coverage every authored TOUGHNESS was calibrated against is not the coverage
 * they are measured against now. The right response looked obvious — measure
 * the ratio, divide it out here, keep the invariance and put the tuning point
 * back. It was measured, and there is no ratio to divide out.
 *
 * WHAT THE OLD SAMPLER ACTUALLY OVER-BILLED. Its first sample was `k = 0` —
 * the pose at the START of the frame, which is the same instant as the previous
 * frame's `k = 1`. Every contact instant lying on a frame boundary was billed
 * by both frames. So the surplus was proportional to the number of frame
 * BOUNDARIES a contact spanned, not to the work done, and it therefore differed
 * per contact by a factor of two:
 *
 *     marginal press (a blade held just onto a column face)   182 → 98 frames
 *     two-frame crossing (a B1 head at 11 m/s)                  3 → 2 frames
 *     glancing crossing (a torso at 14 m/s, phase-averaged)  0.75 → 0.55
 *
 * Measured at the frame: with the old sampler a B1's head severed on a frame
 * where the blade stood at x = 0.314 against a capsule of radius 0.137 — 0.18 m
 * clear of the body it was cutting.
 *
 * SO THE WORK PER PASS DID NOT MOVE BY A CONSTANT. Phase-averaged over the
 * sub-frame phase, ten reference capsules at 60 Hz, new ÷ old:
 *
 *     droid torso 0.50 · trooper torso 0.61 · beast femur 0.99 · walker hull
 *     1.00 · slow press 1.00 · B1 head 1.00 · flesh forearm 1.03 · B2 1.16
 *     · architecture 0.98–0.99
 *
 * A single multiplier cannot reproduce a surplus that ran from 0.50 to 1.16,
 * and the two suites that went red want it moved in OPPOSITE directions —
 * `destruction` wants a weaker blade at the column face, `balance` wants a
 * stronger one at a droid's neck. Swept end to end, at 60 Hz:
 *
 *     WORK_RATE     2.0     2.4      2.62     3.0     3.6
 *     destruction    ✗       ✗        ✓        ✗       ✗
 *     balance        ✗       ✗        ✗        ✓       ✓
 *     cutting        ✗       ✓        ✓        ✓       ✓
 *
 * No value carries both, and `destruction` is not even monotone in it — which
 * is the signature of a threshold being tripped rather than a strength being
 * tuned.
 *
 * AND THE DERIVED VALUE COSTS THE INVARIANCE, WHICH IS THE WHOLE PURCHASE.
 * The mean of the eight body rows is 0.91, so the rescale it asks for is
 * 2.4 / 0.91 = 2.63; the sweep above ran it at 2.62. At that value, the share of
 * sub-frame phases in which one identical 14 m/s pass parts a B2's armour:
 *
 *     240 Hz  144 Hz   60 Hz   30 Hz
 *     0%      0%       0%      0%      ← 2.4, this line
 *     67%     33%      33%     42%     ← 2.62
 *
 * Not because the model became rate-dependent — a scalar cannot do that — but
 * because a crossing that sits FAR from the sever threshold is invariant and
 * one that sits ON it is not. 2.62 moves the B2 pass onto the bar, and armour
 * starts parting at 14 m/s against an authored 26. That regression is invisible
 * to `cutting`, which tests 26 and 30 and not 14.
 *
 * So the constant stays, the two reds are calibration debt in the suites rather
 * than a number to move here, and the sentence that used to sit on this line is
 * replaced by the measurements that refuted it.
 */
const WORK_RATE = 2.4;

/** No contact for this long and accumulated cut work begins to fade. */
const PROGRESS_GRACE = 1.5;

/**
 * A BODY THAT CANNOT SET ITSELF PARTS FASTER — which is the whole reason to
 * pull something to you instead of just hitting it where it stands.
 *
 * The player asked for two things that sound like separate features and are
 * really one: "bring things fully to melee range" and "impale/cut them while
 * held". Bringing them close is a movement problem and it is solved in
 * `Player.forcePull`. What makes it WORTH doing is this: everything a fighter
 * does to survive a cut — turning with the blade, giving ground, dropping a
 * shoulder, tensing — needs feet on the ground and a moment's notice, and a
 * body in the air with a hand round its throat has neither.
 *
 * These are multipliers on cutting work, not on damage, so they shorten the
 * road to a SEVER rather than adding a damage number the model does not have.
 * The three states are deliberately different sizes:
 *
 *   held      3.0×  both feet off the floor and nothing to brace against. This
 *                   is the impale: an acolyte held at arm's length comes apart
 *                   in about a third of the passes it takes standing up.
 *   yanked    2.0×  dragged off balance in the last third of a second. It is a
 *                   window, not a state, and it is what makes pull→cut read as
 *                   one move instead of two.
 *   downed    1.5×  toppled or stunned. Smaller because it was already easier
 *                   in practice — a stunned enemy stops dodging — so a large
 *                   number here would be paying twice for the same advantage.
 *
 * Bosses take the held multiplier at a quarter, for the reason the choke rate
 * halves for them: a boss you can hold is a boss you can hold to death, and
 * "grab the boss" is not a fight.
 */
const OPEN_HELD = 3.0, OPEN_YANK = 2.0, OPEN_DOWN = 1.5;

/**
 * …AND THE PLAYER WAS NEVER TOLD ANY OF IT.
 *
 * Everything above is real, measured and load-bearing: hold a body and it comes
 * apart in a third of the passes. It is also, on screen, completely invisible.
 * Nothing draws a state, nothing names a multiplier, and the one sentence the
 * design rests on — "what makes pull→cut read as ONE MOVE instead of two" —
 * cannot be read as one move by a player who has no way of knowing the second
 * half is being paid for. A mechanic nobody can see is the same defect as a
 * label nothing implements, pointing the other way: the game does something it
 * never claims.
 *
 * So the three states are a TABLE with a name, a colour and a multiplier, and
 * `openness` is derived from it rather than being a second copy of it. Anything
 * that wants to say so on screen reads `openState(e)` for the state and
 * `openMul(state, e)` for what that state is worth ON THIS BODY — bosses take a
 * quarter of the held and yanked bonuses, and a readout that printed the table
 * value at a boss would be lying by exactly the factor the design intends.
 *
 * Deliberately allocation-free. `openness` is called once per capsule per blade
 * slice inside BladeContactSolver.solve — thousands of times a second in a
 * crowd — so `openState` returns the shared table row and never a fresh object.
 *
 * The order of this list IS the precedence: held beats yanked beats downed, and
 * a body that is both held and stunned is billed as held. That was already true
 * of the if-chain this replaces; it is now true because the list says so.
 */
export const OPEN_STATES = [
  { key: 'held', label: 'HELD', colour: '#8fd8ff',
    mul: OPEN_HELD, bigShare: 0.25, test: (e) => !!e.gripped,
    why: 'both feet off the floor and nothing to brace against' },
  { key: 'yanked', label: 'PULLED', colour: '#a9ffd0',
    mul: OPEN_YANK, bigShare: 0.25, test: (e) => e.yankT > 0,
    why: 'dragged off balance — cut now and the pull was one move' },
  /**
   * …AND `ragdolled` IS THE THIRD CAUSE OF THE SAME CONDITION, which this row
   * did not test and which is the largest of the three.
   *
   * `toppled` is a walker whose legs went. `stunTimer` is a body standing
   * still. Neither of them is a body LYING IN THE SAND, and that is the state
   * a dropped grip, a hurled body and a Force wave all leave behind: `gripped`
   * false, `toppled` false, `stunTimer` zero, and the whole of `GET_UP` (1.35 s
   * of lying still) before `recover` fires and stuns it for its 1.1 s beat. For
   * that window a limp body was priced at 1.00x — the same as one standing in
   * cover shooting back — while the blade above pays 1.5x for the stun that
   * follows it.
   *
   * That is one condition written down three times and the list was short by
   * the biggest term. It is also why FLAGSHIP §7's third verb could not reach
   * a battle: every ROUTE the Force has to putting bodies on the ground ends
   * in a ragdoll, and the multiplier stopped at the door.
   */
  { key: 'downed', label: 'DOWNED', colour: '#ffd88a',
    mul: OPEN_DOWN, bigShare: 1,
    test: (e) => !!e.toppled || e.stunTimer > 0 || !!e.actor?.ragdolled,
    why: 'toppled, stunned or limp in the sand, and not turning with the blade' },
];

/** Which open state a body is in right now, or null. The shared row, not a copy. */
export function openState(e) {
  if (!e || e.dead) return null;
  for (const s of OPEN_STATES) if (s.test(e)) return s;
  return null;
}

/** What that state is worth on THIS body — a boss takes a quarter of it. */
export function openMul(s, e) {
  if (!s) return 1;
  return (e?.A?.big || e?.A?.boss) && s.bigShare < 1
    ? 1 + (s.mul - 1) * s.bigShare
    : s.mul;
}

export function openness(e) {
  const s = openState(e);
  return s ? openMul(s, e) : 1;
}
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

/**
 * WHAT A MOVING THING DOES WHEN IT ARRIVES — ONE RULE, THREE CALLERS.
 *
 * `Player._updateHurled` has priced a thrown crate and a thrown body as
 * `mass · v² · k`, clamped, since the Force could throw anything: kinetic
 * energy in the currency the rest of the game bills in, with a floor so a slow
 * arrival is never a nothing and a ceiling so a pillar cannot one-shot a boss.
 * `_sweepHeld` uses the same shape at a tenth of the rate for a body swung
 * rather than thrown.
 *
 * A FALLING TREE WAS THE ONE THING THAT DID NOT. `Forest._sweep` billed a flat
 * 46 to anything under the trunk regardless of the trunk's size or how fast the
 * wood was travelling when it got there, which is note #31: "trees instakill
 * you when they fall instead of doing damage relative to their size or speed."
 * Two of those flat hits is a dead player, from a sapling brushing past at
 * walking pace as readily as from twenty metres of hardwood landing square.
 *
 * The arithmetic moved here rather than being copied a third time, for the
 * reason HANDOFF §2.4 gives: an instrument — or a second call site — that
 * RESTATES a rule eventually disagrees with it. Retune `k` and every mass that
 * arrives anywhere in the game moves together.
 *
 * @param mass   kilogrammes of whatever arrived.
 * @param speed  metres per second it was travelling when it did.
 * @param k      damage per kg·(m/s)². 0.0006 is the thrown-crate rate.
 * @param floor  a hit that lands at all is never a nothing.
 * @param cap    …and never the whole of anybody's health bar.
 */
export function impactDamage(mass, speed, { k = 0.0006, floor = 8, cap = 140 } = {}) {
  const e = Math.max(0, mass) * speed * speed * k;
  return Math.min(cap, Math.max(floor, e));
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
    /* HOW FAR FROM THE CHEST THE SCREEN TOOK IT, in metres, or 0 for every
     * contact that is not a screen. It is a DISTANCE and not a flag because
     * the price is a distance (see SCREEN) — a flag would need the geometry
     * fetched again at billing time, off a body that has moved since. */
    screen: hit.screen > 0 ? hit.screen : 0,
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
/**
 * WHAT EACH RUNG PAYS, indexed by GRADE.
 *
 * It was two literals on one line inside `gradeCaught`, which meant the Codex
 * — the page that teaches deflection — could state every GATE on the ladder
 * and not one PAYOFF, because there was nothing to read. `GRADE_NAME` is
 * already the parallel array; this is its other column, and a fifth grade that
 * forgets a row here is caught by `GRADE_DAMAGE.length === GRADE_NAME.length`.
 */
export const GRADE_DAMAGE = [1.0, 1.0, 1.5, 2.5];

/**
 * WHAT ANSWERING A BOLT COSTS THE GUARD — FLAGSHIP §6, and it is the answer to
 * Jedi-versus-infantry.
 *
 * ── THE PROBLEM, MEASURED BEFORE ANY OF THIS EXISTED ────────────────────
 *
 * One B1 does 2.17 dps to a moving player: forty-six seconds to kill you.
 * Wave 20 does 353.8 raw dps: 0.28 seconds. There is no middle, and deflection
 * is a PERCENTAGE, so it scales the problem instead of solving it — a wall of
 * fire that 90% deflection turns into a survivable trickle at twenty rifles is
 * still lethal at two hundred, and the tuning knob has no setting that makes
 * both interesting.
 *
 * So a bolt does not cost the HEALTH. It costs the GUARD.
 *
 *   BLOCK    1.2 stamina   the blade was nearly still; you got it in the way
 *   DEFLECT  0.4           the blade was driven at it
 *   RETURN   0             you met it properly
 *   PERFECT  0
 *
 * Twenty B1s fire about 18 bolts a second. At 1.2 that is 21.6 stamina/s
 * against a 16/s regen and a 100 pool — underwater in roughly twelve seconds,
 * and at zero stamina there is no dash (18), no dive (18) and no sprint. The
 * crowd does not kill you; it nails your feet to the floor, and then the B2s
 * do. VOLUME OF FIRE BECOMES TERRAIN: a beaten zone is a place you cannot
 * stand, which is what a battlefield is.
 *
 * Every rung of the ladder is fully answerable by skill — a PERFECT costs
 * nothing at all, so a good player is never suppressed by fire they can meet —
 * and it is legible, because the bar it spends is already on the screen.
 *
 * ── WHY THE REGEN IS NOT PAUSED, WHICH IS THE WHOLE ARITHMETIC ──────────
 *
 * `Player`'s dash, dive and sprint all set `staminaHold`, so the bar stops
 * refilling for 0.6 s after they are spent. Answering a bolt deliberately does
 * NOT: the design above is a drain of 21.6/s racing a regen of 16/s, and a
 * guard cost that also switched the regen off would be 21.6 against nothing —
 * a bar that empties in under five seconds and can never come back while
 * anybody is shooting. The margin between the two rates IS the mechanic, and
 * pausing the regen deletes it.
 *
 * ── AND THE FOURTH ROW IS NOT STAMINA AT ALL ────────────────────────────
 *
 * A bolt that arrives inside the auto-guard cone off a parked blade was
 * answered by the SYSTEM and not by the player — `CATCH.autoGuard` exists so
 * the follow-up shots of a burst you already answered do not kill you while
 * your wrist is committed. It was free. Free is what makes a stream of fire
 * answerable by one good deflect and then nothing, which is the failure
 * `CATCH.autoGuard`'s own comment says the cone must not become.
 *
 * It costs FORCE instead of stamina, and that is a different sentence rather
 * than a smaller number: the cone is the Force keeping you alive while your
 * hands are busy, so it spends the pool that every other version of that
 * sentence spends. It also means the two bars drain in different fights — a
 * player meeting fire head-on spends stamina, a player working through it with
 * their back half-turned spends Force — and a player with neither left is a
 * player who has to leave.
 *
 * `unanswered` is charged only when the blade was NOT driven at the bolt
 * (`snap.driven`), so a player who turned and met a bolt the cone happened to
 * cover pays the ordinary grade for it and not both.
 */
export const GUARD_COST = {
  /** Stamina, indexed by GRADE. Parallel to GRADE_DAMAGE and GRADE_NAME. */
  stamina: [1.2, 0.4, 0, 0],
  /** Force, for a bolt the auto-guard cone answered off a blade you did not drive. */
  unanswered: 0.5,
};

/**
 * ── THE SCREEN: THE OTHER HALF OF §6, AND THE ANSWER TO §7's FAILURE ─────
 *
 * Everything above prices a bolt that was coming for YOU. `NEXT.md` measures
 * what that is worth to the line and the answer is nothing: five seeds, four
 * arms, the outcome IDENTICAL in all of them — same three waves, same area,
 * the same 37 enemies dead — while a Jedi standing in the formation makes the
 * fight half again as long and gets seven of your men killed. The fourth arm
 * settles what the seven are: a Jedi holding station a HUNDRED METRES OFF
 * costs the line the same 6.33 men, so it is not presence that kills them, it
 * is a player existing on the field for the horde to walk toward. Standing
 * with your own line was, on those numbers, strictly worse than fighting away
 * from it.
 *
 * A Jedi in a rank could answer exactly one bolt in the whole battle: the one
 * aimed at his own chest. The men either side of him were on their own.
 * **That is the defect.** It is what a Jedi in a line is FOR, it is the picture
 * every frame of the reference material is made of, and nothing in the tree
 * implemented it.
 *
 * So: a bolt on its way into one of your own men, crossing the ground you are
 * standing on, inside the arc you can bring a blade through, is a bolt you can
 * take. FLAGSHIP §8 already has the playstyle — the Sentinel, "guard + bond,
 * 5-25 m, spends the guard flick, job: TURN" — and this is the mechanic that
 * playstyle was a description of.
 *
 * ── WHY IT IS NOT AN AURA, WHICH IS THE ONE THING IT MUST NOT BE ────────
 *
 * Four gates, and a bolt has to pass all four:
 *
 *   · it must actually be about to hit one of your men. A bolt that would have
 *     missed him is not screened, so the mechanic never touches fire that was
 *     never going to cost anything. This is measured against the body's own
 *     bolt bound — the same sphere `World._boltHitTest` rejects on — and not
 *     against a radius round a name.
 *   · it must cross ground you are standing on, inside `reach`.
 *   · it must arrive inside the arc a guard covers. You cannot bring a guard
 *     behind you, and you cannot screen behind you either.
 *   · YOU MUST BE ABLE TO PAY FOR IT, and the price is by the metre.
 *
 * ── THE PRICE IS PER METRE, AND IT IS DERIVED ───────────────────────────
 *
 * `GUARD_COST.unanswered` already prices one bolt the Force answered for you
 * off a blade you never drove, at the auto-guard's own radius of
 * `CATCH.autoRadius`. A screened bolt is the same event further out — the
 * Force reaching for something your hands cannot get to — so it is the same
 * price BY THE METRE and not a new number:
 *
 *     perMetre = GUARD_COST.unanswered / CATCH.autoRadius = 0.4 Force / m
 *
 * That is the whole economy, and three things fall out of it that a flat price
 * would not have given:
 *
 *   · The man at your shoulder is nearly free and the man at fourteen metres
 *     costs 5.6. Standing WITH your line is cheaper than gesturing at it from
 *     the flank, which is precisely the behaviour §7 wants and the `far` arm
 *     proves the game did not previously reward.
 *   · Your reach is bought, not granted. `screenReach` is this formula solved
 *     the other way: the screen is exactly as wide as the Force in the bar,
 *     capped at `SCREEN.reach`, so it COLLAPSES TOWARD YOU as the bar empties
 *     and comes back as it refills. Nothing new is on the HUD; the Force bar
 *     that was already there is the readout.
 *   · Volume of fire is still terrain. At a 7.5/s regen a player can hold a
 *     screen over about 1.3 bolts a second at the rim and six at his shoulder,
 *     and a heavier beaten zone than that empties the bar and shrinks the
 *     screen to nothing — the same sentence §6 makes about stamina, in the
 *     other bar.
 *
 * ── AND THE REACH IS `MORALE.NEAR`, WHICH IS NOT A NEW NUMBER EITHER ────
 *
 * The game already owns a radius for "this Jedi is with these men": it is what
 * `MORALE.JEDI_NEAR` pays out to and what `CommandDirector` measures presence
 * on. A screen with its own radius would be the twin this repository keeps
 * deleting (HANDOFF §2.3) — two numbers for one fact, drifting apart the first
 * time either is tuned. If a man is near enough for your presence to steady
 * him, he is near enough for you to take a bolt for him.
 */
export const SCREEN = {
  /** The furthest a full bar can cover, in metres. One radius, not two. */
  reach: MORALE.NEAR,
  /** Force per metre of reach, derived above rather than chosen. */
  perMetre: GUARD_COST.unanswered / CATCH.autoRadius,
  /**
   * HOW WIDE OF THE MAN A BOLT MAY BE AND STILL COUNT AS ON ITS WAY INTO HIM.
   *
   * Zero: the test is against the body's own measured bolt bound and nothing
   * is added to it. A margin here would be the aura the gates above exist to
   * prevent — every near miss in the battle would become a bolt you "saved"
   * somebody from, and the mechanic would pay for fire that was never going to
   * land. The bound is already generous in the honest direction: it wraps what
   * the body actually presents, so a bolt inside it would have hit a bone or
   * grazed one.
   */
  margin: 0,
};

/** What one screened bolt costs, in Force, taken `dist` metres from the chest. */
export function screenForce(dist) { return Math.max(0, dist) * SCREEN.perMetre; }

/**
 * …AND THE SAME RULE READ THE OTHER WAY: how far out this much Force can cover.
 *
 * The inverse of `screenForce` and deliberately written as one, so the reach a
 * player is granted and the price they are charged cannot disagree. A screen
 * wider than the bar can pay for would refuse bolts at the moment of billing
 * instead — a rule that fires in one place and is enforced in another, which
 * is HANDOFF §2.4's defect with the two halves swapped.
 */
export function screenReach(force, cap = SCREEN.reach) {
  return Math.min(cap, Math.max(0, force || 0) / SCREEN.perMetre);
}

/**
 * What one bolt costs a fighter, given the grade it was answered at and the
 * contact that produced it.
 *
 * ONE FUNCTION SO THERE IS ONE RULE. The block path and the catch-and-throw
 * path bill at different moments in the frame — a caught bolt is graded up to
 * 250 ms after it landed — and two call sites reading the table separately is
 * two places for a fifth grade or a changed row to be missed.
 *
 * @param grade  a value of GRADE
 * @param snap   the frozen contact (`captureSnapshot`), or null
 * @returns { stamina, force }
 */
export function guardCost(grade, snap = null) {
  /* A SCREENED BOLT IS PAID FOR IN FORCE AND IN NOTHING ELSE, and that is the
   * same sentence the `unanswered` row makes rather than a second one: your
   * blade never met this bolt, the Force did, so the Force pays. Charging the
   * stamina rung as well would bill one event twice and would make the reach
   * scale with the wrong bar — a player screening a rank would run out of dash
   * rather than out of Force, and the readout on the screen would be the one
   * that is not moving. First, because it is the more specific claim: a
   * screened bolt can also be one the cone happened to cover. */
  if (snap && snap.screen > 0) return { stamina: 0, force: screenForce(snap.screen) };
  if (snap && snap.auto === true && !snap.driven) return { stamina: 0, force: GUARD_COST.unanswered };
  return { stamina: GUARD_COST.stamina[grade] ?? 0, force: 0 };
}

export function gradeCaught(snap, ctx) {
  const { bladeT, bladeSpeed, closing, boltDir } = snap;
  const _v4 = snap.normal;
  // The parry's two rungs. Entering a guard zone inside PARRY_GRADE.window of
  // the bolt arriving earns the RETURN a fast tip earns; inside the tighter
  // `perfect` half it earns the PERFECT. Nothing else about the ladder moves —
  // there is one ladder, and this is a second way onto it.
  const parry = snap.parry || null;
  // `deflectWindow` is the tier's scale on how long you have. It was a column of
  // DIFFICULTY with NO READER ANYWHERE — four hand-authored numbers, printed in
  // the difficulty table, promising a wider window on Padawan and a tighter one
  // on Grandmaster, and identical in the code on all four. `tools/balance.mjs`
  // reports columns like that as dead, and a tier is a promise about the fight:
  // a column of that promise with no reader is the same lie as a checkbox with
  // no onChange.
  const sharp = !!parry && parry.age <= PARRY_GRADE.perfect * parryScale(ctx.difficulty);

  let grade = snap.caught ? GRADE.DEFLECT : GRADE.BLOCK;

  // Return: a fast tip, and somewhere worth sending it
  const mode = ctx.aimMode || 'reticle';
  const thrown = !!(ctx.caught && snap.caught);
  let target = null;
  const tipZone = bladeT > SPEED_GRADE.returnBladeT;
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

  const damageMul = GRADE_DAMAGE[grade];
  return { grade, dir: out, damageMul, target, bladeSpeed, normal: _v4.clone(), bladeT };
}

/**
 * WHERE A BODY IS AIMED AT. One reader, for every shooter in the game.
 *
 * It lives here because this is the file that already had to answer the
 * question — `pickReturnTarget` below has asked it since a returned bolt first
 * needed somewhere to go — and because it is a leaf: THREE, Physics, MathUtil,
 * Bolts and Morale, none of which reaches back to a shooter.
 *
 * `aimPoint` first, because a body that publishes one is a body that has an
 * opinion about its own centre of mass: `Enemy` walks its rig for a torso bone
 * and falls back to `chest`, `Player` and a remote player answer with their own
 * `chest` field, and a driven vehicle answers with the point its gun is laid
 * on. `chest` second, so that a duck-typed target — the object `Driving.fire`
 * hands the machine, the fixtures in half the checks — is read the same way.
 * `position` last, and it is now only ever reached by something with no body
 * at all: it is at the FEET, and aiming there is the defect this function was
 * written to end.
 *
 * NO DEFAULT `out`. Two shooters resolving their aim in one expression through
 * a module-scope scratch is the aliasing bug this repository has already paid
 * for once in `World._bolt4`; the caller owns the vector.
 */
export function aimAt(body, out) {
  if (!body) return null;
  if (body.aimPoint) return body.aimPoint(out);
  if (body.chest) return out.copy(body.chest);
  return body.position ? out.copy(body.position) : null;
}

/** Nearest valid enemy inside the aim cone. */
export function pickReturnTarget(origin, aimDir, candidates, cone = 0.42) {
  let best = null, bestScore = -1;
  for (const c of candidates) {
    if (!c || c.dead) continue;
    const p = aimAt(c, _v6);
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
    /* `activeCuts` USED TO BE HERE, and it was a lie with a clone in it.
     *
     *     this.activeCuts = [];   // for slag VFX on heavy materials
     *     …
     *     this.activeCuts.push({ point: hit.point.clone(), progress, cap, target });
     *
     * A comment naming a consumer, a per-contact `Vector3.clone()` in the
     * hottest loop in the game, and — grepped across src/, tools/ and
     * index.html — NOT ONE READER anywhere in the tree, in any commit since the
     * file was written. No slag VFX ever read it. It is the same defect as a
     * label with no mechanic behind it, wearing the other costume: a mechanism
     * with nothing on the other end, paid for every frame a blade is in a body.
     *
     * Anything that wants to know what the blade is working on reads the events
     * `solve` returns, which every real caller already does. */
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
    if (saber.ignition < 0.7) return events;

    /* HOW FINELY THE FRAME'S SWEEP IS SAMPLED — a travel-relative number, not
     * a fixed one, and this is `Enemy._saberStrike`'s rule (Enemy.js) applied
     * to the player's blade, which is the side a player actually feels.
     *
     * It was `const SLICES = 4` — five samples across the frame whatever the
     * frame cost. At `main.js`'s 0.1 s dt clamp a 10 m/s blade covers a metre
     * and those samples sit 0.25 m apart, so a 0.07 m forearm falls clean
     * between two and the swing passes through a body without touching it.
     * Measured over a swept first-frame phase, one identical pass through a
     * droid torso severed in 100% of phases at 240 Hz and 38% at 10 Hz.
     *
     * The travel is measured here, once a frame; the sample count is per
     * CAPSULE, below, because spacing is a fraction of the capsule's own radius
     * rather than a constant: what has to be resolved is the body, not the
     * metre, and the spacing that is wasted work on a walker's flank is still
     * too coarse for a wrist. */
    const travel = Math.max(saber.base.distanceTo(saber.prevBase),
                            saber.tip.distanceTo(saber.prevTip));
    /**
     * A GAP AND THE PLATE AROUND IT ARE ONE PIECE OF BODY, AND MUST BE BILLED
     * ONCE.
     *
     * `Enemy.capsules()` publishes a weak point as its own capsule — its own
     * progress budget, its own thinner material — sitting INSIDE the capsule of
     * the bone it is a gap in. That is the only way it can have its own `need`
     * (a moving goalpost inside one budget is not a budget), and it means a
     * blade in the gap is geometrically inside both. Without this, one pass
     * through an acklay's stifle would raise a grind event for the joint AND a
     * grind event for the femur on the same frame and bill the same flesh
     * twice — and, once both budgets filled, sever the same bone twice.
     *
     * So a weak point that is HIT claims the bone it covers for the rest of
     * this target's loop. `capsules()` pushes the gaps ahead of the bones for
     * exactly this reason, and `tools/checks/severance.mjs` asserts that order
     * rather than trusting it.
     *
     * Reused across frames and cleared per target: allocation-free, and the
     * list is at most a handful of names on the biggest body in the game, so
     * `includes` beats a Set that has to be built to be asked once.
     */
    const taken = this._taken || (this._taken = []);
    for (const target of targets) {
      if (!target || target.dead) continue;
      const caps = target.capsules;
      if (!caps || !caps.length) continue;
      taken.length = 0;

      for (const cap of caps) {
        if (taken.length && taken.includes(cap.name)) continue;
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
        //
        // Sampled at sub-interval MIDPOINTS, `(i + 0.5) / SLICES`, and divided
        // by SLICES rather than SLICES + 1: each sample then stands for an
        // equal slice of the frame and `touching / SLICES` is an unbiased
        // estimate of the fraction of the frame spent inside this capsule.
        // Sampling both endpoints instead counts one sample too many on every
        // frame that touches at all, which is a systematic bonus to whoever
        // renders the most frames — the very bias this scaling exists to
        // remove.
        //
        // Broad phase first, one test in place of SLICES of them. Every point
        // of the blade moves at most `travel` this frame — base and tip each
        // do, and the points between are a lerp of the two — so a capsule
        // further than `travel` from the blade's start pose cannot be reached
        // before the end of it. It is what pays for the finer sampling:
        // measured over 20 000 frames against four 18-capsule bodies with one
        // in reach and three across the room, 34.8 us/frame against 45.7 for
        // the old fixed five samples; with all four bodies on the blade at
        // once, the worst case there is, 87.6 against 74.9.
        if (!segmentCapsule(saber.prevBase, saber.prevTip, cap.p0, cap.p1, cap.r + travel)) continue;

        // Spacing is 0.15 of this capsule's radius, floored at 8 samples so a
        // 240 Hz frame (0.04 m of travel) does not resolve to one sample and
        // lose the contact fraction, and capped at 64 to bound the worst
        // frame's cost. `Math.max` on the divisor because a capsule with r = 0
        // would otherwise ask for Infinity samples.
        const SLICES = clamp(Math.ceil(travel / Math.max(1e-3, cap.r * 0.15)), 8, 64);
        let hit = null, touching = 0;
        for (let i = 0; i < SLICES; i++) {
          const k = (i + 0.5) / SLICES;
          _v1.lerpVectors(saber.prevBase, saber.base, k);
          _v2.lerpVectors(saber.prevTip, saber.tip, k);
          const h = segmentCapsule(_v1, _v2, cap.p0, cap.p1, cap.r);
          if (h) { touching++; if (!hit) hit = h; }
        }
        if (!hit) continue;
        // The gap has the bone now — see `taken` above. Recorded on contact and
        // not on a completed cut, because the double-bill this prevents is the
        // GRIND's, which happens on every frame of contact and long before
        // anything is severed.
        if (cap.covers) taken.push(cap.covers);
        const coverage = touching / SLICES;

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
        //
        // THE PARAGRAPH ABOVE DESCRIBED CODE THAT WAS NOT HERE. It is now — see
        // `advance` below — and until it was, this was the single loudest thing
        // the frame rate decided: swept over the phase of the first frame, one
        // identical 14 m/s pass through a B2's arm severed in 0% of phases at
        // 240 Hz, 17% at 60 Hz and 50% at 30 Hz. A 30 fps player took an arm
        // off with a swing a 144 fps player could not land.
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
        // Architecture is exempt from openness for the same reason it is exempt
        // from speed: a wall is never off balance.
        const slash = cap.structure ? 1
          : Math.min(SLASH_CAP, 1 + rush) * openness(target.enemy);
        /* How far through the material this frame got, in metres. Coverage
         * turns the frame's travel into the part of it that was inside the
         * body; the chord cap is the other half of the same idea, and it is the
         * half that bites when one frame swallows the whole crossing — a 0.1 s
         * frame crosses a 0.36 m torso and 0.64 m of air, and without the cap
         * it banked all of it. Architecture keeps the raw press: a wall's
         * statics are tuned against the rate a blade carves stone, and a kerf
         * has no chord to be capped at. */
        const advance = cap.structure ? speed * dt
          : Math.min(speed * dt * coverage, 2 * cap.r);
        const dWork = advance * WORK_RATE * slash;
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
        //
        // Two different questions once a capsule can be a GAP rather than a
        // bone. `capT` is where along this capsule the blade crossed, which is
        // where the flare and the molten cap go; `cutT` is where along the BONE
        // that is, which is what `Actor.cut` splits at. For a bone capsule they
        // are the same number and this costs nothing. For a gap they are not:
        // an acklay's stifle occupies the top third of its femur, so a cut in
        // the middle of the gap is a cut at 0.83 of the bone, and passing the
        // gap's own 0.5 would take the leg off at the thigh.
        const capT = clamp(hit.t, 0.06, 0.94);
        _v3.subVectors(cap.p1, cap.p0);
        const cutPoint = _v4.copy(cap.p0).addScaledVector(_v3, capT);
        const cutT = cap.covers && cap.at0 != null
          ? clamp(lerp(cap.at0, cap.at1, capT), 0.06, 0.94) : capT;

        // the cut plane is the plane the blade swept
        const dirImpulse = _v5.lerpVectors(saber.baseVelocity, saber.tipVelocity, bladeT).clone();
        /* `cap.covers` AND NOT `cap.name`, because a weak point is not a bone.
         * A gap capsule is its own progress budget under its own name, and the
         * thing that comes off when that budget fills is the BONE the gap is
         * in. Everything downstream of this event — `Actor.cut`, the ragdoll
         * joint, `_loseLimbBehaviour`, the topple count, `World.applyClaim`'s
         * re-run on the host — is keyed on a bone the rig actually has, and
         * handing any of them 'femur0.tip' is a silent no-op rather than an
         * error (`Actor.cut` returns false for a name it cannot find). */
        events.push({
          type: 'cut', target, cap, bone: cap.covers ?? cap.name, cutT, bladeT, speed,
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
 * How close two blades have to come to be touching.
 *
 * Named and exported because two systems now have to agree on it: World's
 * clash resolution, and the enemy blade's own body hit test, which must stand
 * DOWN when the blades are in contact so that meeting steel always beats
 * cutting flesh. When that number lived only inside resolveBladeClash the
 * second caller had no way to ask the question without also paying for the
 * answer, and the obvious workaround — a slightly different radius — is
 * exactly how a blade ends up cutting through a block.
 */
export const CLASH_RADIUS = 0.10;

/** Are these two blades in contact? The cheap half of resolveBladeClash. */
export function bladesTouching(a, b, r = CLASH_RADIUS) {
  if (!a || !b || a.ignition < 0.6 || b.ignition < 0.6) return false;
  return segmentSegment(a.base, a.tip, b.base, b.tip, _a, _b).distSq <= r * r;
}

/**
 * @returns null | { type:'chamber'|'parry'|'bind'|'clash', point, winner, power }
 */
export function resolveBladeClash(a, b, ctxA, ctxB) {
  if (a.ignition < 0.6 || b.ignition < 0.6) return null;
  const res = segmentSegment(a.base, a.tip, b.base, b.tip, _a, _b);
  const r = CLASH_RADIUS;
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
