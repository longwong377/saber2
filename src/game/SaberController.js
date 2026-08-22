/**
 * BATTLEFRONT BORZ — blade control.
 *
 * This is the game. Everything else is scenery.
 *
 * The mouse drives a guard point on a sphere in front of the chest. The hands
 * follow it partway; the blade points from the hands through the guard point.
 * Neither the hands nor the blade get there instantly — both are integrated
 * through a spring-damper with real inertia, so the weapon lags a flick,
 * overshoots a snap, and hangs when you decelerate.
 *
 * Accels, decels, drags and feints are not moves. They are what happens when a
 * heavy object is attached to your wrist and you change your mind.
 */

import * as THREE from 'three';
import { clamp, lerp, damp, smoothstep, shortestArc, quatToRotVec, Ema, TAU } from '../engine/MathUtil.js';

const _v1 = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3();
const _v4 = new THREE.Vector3(), _v5 = new THREE.Vector3();
/** The roll's own axis. _v1.._v5 are all live across solveTargets. */
const _vRoll = new THREE.Vector3();
const _q1 = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _q3 = new THREE.Quaternion();
const _m = new THREE.Matrix4();
const UP = new THREE.Vector3(0, 1, 0);

/**
 * Guard travel limits, in units of max deflection. At maxYaw = 1.62 rad,
 * GX_MAX = 1 puts the guard at 93 deg off centre — the edge of what a pair of
 * arms can hold in front of the chest. The old 1.35 reached 125 deg, behind
 * the shoulder, where the only IK solution runs the arm through the ribs.
 */
/* EXPORTED, because the guard box is what every arc in this file is measured
 * as a fraction OF — `tools/checks/directional.mjs` holds the left cut to
 * crossing most of it, and a check that typed 1.0 instead would silently stop
 * meaning anything the day the box changed. */
export const GX_MAX = 1.0, GY_MAX = 1.05, GY_MIN = 1.0;
const YAXIS = new THREE.Vector3(0, 1, 0);

/**
 * How much warning the deflection assist works with, in seconds. Everything
 * about the assist is expressed against this: `DIFFICULTY.assist` is the share
 * of your aiming error it closes across one of these. 0.9 s is a little over
 * human reaction time, so the assist is finishing a movement you have started
 * rather than making one you never began.
 */
const ASSIST_LEAD = 0.9;

/**
 * THRUST envelope, in seconds. The old thrust was `this.thrust = 1` followed by
 * `damp(thrust, 0, 9, dt)` every frame — an instantaneous spike that had decayed
 * to 22% by 150 ms. The hands chase it through a spring whose own rise time is
 * ~400 ms (lin 118, linD 15 → ω 10.9 rad/s, ζ 0.69), so the target was gone
 * before the hands could get anywhere near it: a standing thrust moved the tip
 * 11.5 cm. That is not a stab, and it is exactly why "how do you stab when
 * standing still?" has no answer in the current build.
 *
 * A real envelope instead: drive to full in `rise`, HOLD there through `hold` so
 * the spring has time to arrive, then recover. The hold is the part that makes
 * it read as a lunge rather than a twitch.
 */
const THRUST = { rise: 0.07, hold: 0.13, fall: 0.20 };

/**
 * How far a thrust drives the hands and the guard point, in metres, at full
 * extension. 0.30/0.34 was the old pair and it was never reached; these are
 * reached, so they are the numbers that actually set the reach.
 *
 * A standing thrust gets the LONGER of the two: with no legs behind it the
 * whole lunge has to come from the arms and shoulders, and a stab you take from
 * a standstill should still cross the gap a walking one covers with its feet.
 */
const THRUST_REACH = { hand: 0.34, guard: 0.40, standing: 1.55 };

/**
 * The speed above which a lunge counts as having feet behind it, m/s. A quarter
 * of walking pace — genuinely planted, not merely slow.
 *
 * Exported because `Player` answers the same question from its own velocity
 * (see `ctx.moving` at the press) and two files deciding "is this body moving"
 * with two hand-written numbers is how they come to disagree. One constant,
 * both readers.
 */
export const THRUST_STANDING_SPEED = 1.2;

/**
 * FLOURISH — an idle twirl. Purely cosmetic: it drives roll and traces the
 * guard round a small circle, and it touches nothing that grades a contact.
 * 0.62 s is two full wrist rotations at a speed a hand can actually make.
 */
const FLOURISH = { dur: 0.62, turns: 2, radius: 0.30 };

/**
 * WHERE THE BLADE RESTS when you are not steering it, per view mode, in units
 * of max deflection. This table is the ONLY place these two numbers exist:
 * `readyX`/`readyY` are set from it and from nowhere else, and tools/checks/
 * feel.mjs fails the build if any other file assigns to them.
 *
 * That check is not paranoia. Commit 2e23892 lowered the third-person `y` from
 * 0.30 to 0.08 precisely to answer "the cursor feels way too high" — and
 * Player._applyViewMode set it straight back to 0.30 two lines of another file
 * away, so the fix shipped and was undone in the same build. Measured: 0.30 ×
 * maxPitch 1.28 rad = 22.0 deg above screen centre, which is where every
 * deflection had to start by dragging back down to the middle before you could
 * begin aiming.
 *
 *   third  0.08 → 5.9 deg up. A hint of high guard rather than a handicap; a
 *          guard IS carried high, but the blade cursor is what you aim with and
 *          it belongs near the middle of the screen.
 *   first  0.02 → 1.5 deg up. Over-the-shoulder height reads well in third
 *          person but leaves first person staring at the flat of the blade, so
 *          it drops further and crosses the lower view.
 *
 * `x` is the same story sideways: 0.30 × maxYaw 1.62 = 27.8 deg right, pulled
 * in slightly in first person because the weapon is nearer the lens.
 */
export const READY_GUARD = {
  third: { x: 0.30, y: 0.08 },
  /* THE FIRST-PERSON READY IS HIGHER THAN THE THIRD-PERSON ONE, which is the
   * opposite of what it was, and the reason is the WRIST rather than the blade.
   * A fist rolled round the shaft to where the palm faces across the body (see
   * FP_TUNE) sits 59 mm below the grip point instead of 27 mm, and at half a
   * metre from the lens those 32 mm are 3.7 degrees — enough to put the hand
   * off the bottom of a 30-degree half-field. The guard carries the hilt, the
   * hilt carries the fist, so the hold comes up rather than the grip being
   * compromised back toward the emitter. Measured, not guessed: the hand reads
   * 27.6 degrees down at y=0.02 and 23.2 at y=0.12, against a 26-degree bound
   * — and 23.2 frames the hold better than the 26.0 it shipped at. */
  first: { x: 0.26, y: 0.12 },
};

/* ══════════════════════════════════════════════════════════════════════ */
/*  DIRECTIONAL GUARD                                                     */
/* ══════════════════════════════════════════════════════════════════════ */

/**
 * Four zones and neutral, in the manner of Bannerlord's guard rose and
 * Chivalry 2's parry window.
 *
 * WHY THIS EXISTS. Free aim had the mouse doing two jobs at once: holding the
 * blade button froze the camera so the mouse could steer a continuous guard
 * POSITION. "I don't understand how you're supposed to block and also aim at an
 * enemy in the same motion because when you're moving the blade to specifically
 * deflect the cursor can't move." That is not tunable — it is the definition of
 * the scheme. A guard ZONE is a discrete STATE, set by a flick and then simply
 * held, so the mouse is never taken hostage and the camera is live at all times.
 *
 * The poses are not decoration. The zone's VOLUME is a rose sector about a fixed
 * bearing, and the pose is where the blade physically goes — if the two disagree
 * the player watches a bolt stop in mid-air beside a weapon that is somewhere
 * else. So the poses are chosen by measuring where the blade actually ends up,
 * not by writing down where it ought to. Settled on the real controller and read
 * at the blade's midpoint bearing off the chest:
 *
 *              pose            off the sightline   off its own zone axis
 *   HIGH   ( 0.00,  0.62)          49.8°                  3.4°
 *   LOW    ( 0.00, -0.72)          35.4°                 14.0°
 *   LEFT   (-0.49, -0.10)          46.9°                  4.6°
 *   RIGHT  ( 0.49, -0.15)          41.6°                  4.9°
 *
 * Two things in that table are not obvious and both were measured rather than
 * reasoned:
 *
 *   The lateral guards are carried BELOW the centre line, not on it. The hands
 *   sit 20 cm under the chest (GRIPS.two.offset), so a guard point at eye level
 *   tilts the blade up and off its own axis — LEFT at gy +0.10 lands 18.9° off,
 *   at -0.10 it lands 4.6° off. Dropping the guard point is what lays the blade
 *   level across the body.
 *
 *   LOW stops at -0.72 rather than going deeper. Lower is better for the zone
 *   (at -0.92 the blade is 51.5° off the sightline, well clear of the centre
 *   disc) but it eats the overhead: the arc clamps at GY_MIN, so a swing out of
 *   a -0.82 guard sweeps 1.13 units against the 1.23 a -0.72 guard gets. The
 *   guard and the attack share one axis and this is where they meet.
 *
 * They sit at ±45° off the sightline rather than at the edge of the guard's ±93°
 * travel because the four have to tile the rose evenly — a LEFT at the travel
 * limit would leave a hole between it and HIGH that no zone answers.
 */
export const ZONE = { NONE: 'none', HIGH: 'high', LEFT: 'left', LOW: 'low', RIGHT: 'right' };

/** The four live zones, in rose order (rose 0 is right, +90° is up). */
export const ZONE_ORDER = ['right', 'high', 'left', 'low'];
export const ZONE_ROSE = { right: 0, high: Math.PI / 2, left: Math.PI, low: -Math.PI / 2 };

export const ZONE_POSE = {
  high:  { x: 0.00, y: 0.62 },
  left:  { x: -0.49, y: -0.10 },
  low:   { x: 0.00, y: -0.72 },
  right: { x: 0.49, y: -0.15 },
};

/**
 * The guard volume, and why every number in it is the size it is.
 *
 * `radius` 1.4 m — where the blade is. Settled at the four poses and measured
 * off the CHEST, which is what this sphere is centred on (tools/_unify.mjs
 * --radius), the lit blade runs 0.52 m to 1.78 m out with its midpoint at
 * 1.09–1.21. So a bolt arrested at this sphere is arrested on the weapon, a
 * little past its middle, and not out in front of it. It used to be read as
 * "the midpoint sits 0.84–1.07 off the chest so the tip is at about 1.4", which
 * was the same claim about the shorter span the chest anchor gave; the anchor
 * moved 0.32 m up and 0.20 forward and 1.4 m came out nearer the middle of the
 * blade rather than off its end.
 *
 * `centre` 20° — THE ONE NUMBER THAT MAKES THIS PLAYABLE, and it was measured
 * rather than chosen. A bolt is classified by where its LINE crosses the guard
 * sphere, which for a shooter you are looking straight at is a function of how
 * far off your centreline the shot was placed: θ = asin(miss / radius). A bolt
 * that would actually hit your torso misses your chest by at most ~0.4 m, so it
 * arrives inside asin(0.4/1.4) = 16.6°. Every frontal shot that threatens you is
 * therefore inside a 20° disc — and inside that disc ANY guard answers, because
 * a blade held anywhere in front of your chest is across the line of a bolt
 * coming down your own sightline.
 *
 * Without that disc the mechanic is a lottery and not a skill. Enemy spread is
 * ±1.4–2.1° (Enemy.js `spread`), which at 20 m scatters bolts ±0.5 m around the
 * chest in a direction that is uniform on the rose — so a frontal shooter would
 * hand you a RANDOM zone on every bolt of a burst. Nothing you could learn.
 * With it, the rule is one sentence: your guard covers your centreline plus one
 * quadrant, and the quadrant is for the people shooting you from the side.
 *
 * `reach` 100° — the same shoulder line applyAssist already refuses to reach
 * past. You cannot bring a guard behind you.
 *
 * `sector` 45° — a quarter of the rose each, so the four tile it exactly and
 * every bolt outside the centre disc falls in exactly one zone.
 *
 * `tolerance` 90° — what a FULL difficulty assist buys on top of the sector.
 * 45 + 90 = 135° is the far edge of the adjacent quadrant and stops one degree
 * short of the opposite zone, so no tier ever forgives a guard held the wrong
 * way round. See zoneTolerance() in Combat.js.
 */
export const GUARD = {
  radius: 1.4,
  centre: 20 * Math.PI / 180,
  reach: 100 * Math.PI / 180,
  sector: 45 * Math.PI / 180,
  tolerance: 90 * Math.PI / 180,
};

/**
 * The flick that sets a zone, and the parry window that rewards one.
 *
 * `speed` 1400 px/s is the gate between aiming and flicking. The camera gain is
 * 0.0024 rad/px, so at 60 Hz an ordinary tracking correction of 6 px/frame is
 * 360 px/s and 23 px/frame — a fast track across a target — is 1380. A flick is
 * a deliberate throw of the wrist above that; below it the mouse is purely the
 * camera, which is the whole point of the scheme.
 *
 * `window` 0.20 s is Chivalry 2's parry window to the frame. Enter a zone and
 * meet a bolt inside it and the block is a PARRY: it earns the RETURN and the
 * bolt goes where you are looking. `perfect` 0.10 s is the tighter half.
 *
 * `cooldown` 0.28 s is what stops the window being held open by mashing. It is
 * longer than the window itself, so a parry window can never be back-to-back
 * with another one and the duty cycle of "parrying" tops out at 71%.
 *
 * `burst` 1.8 is the second half of the gate and it is not optional. A speed
 * threshold ALONE cannot tell a flick from a fast pan, because a fast pan spends
 * part of every sweep above any fixed threshold — measured, five seconds of
 * ordinary 2 Hz tracking produced this many unasked-for zone changes:
 *
 *   peak  600 px/s → 0      peak 1800 px/s → 20
 *   peak 1000 px/s → 0      peak 2400 px/s → 41
 *   peak 1400 px/s → 0      peak 3600 px/s → 41
 *
 * That is a guard flailing between zones every time the player makes a big turn,
 * which is exactly the situation the scheme exists to be good at. So a flick
 * must also be fast RELATIVE TO WHAT THE HAND HAS BEEN DOING: `mouseSpeed` is
 * the EMA this file already keeps, and a sinusoidal sweep sits at 1/0.64 = 1.56x
 * its own average at the peak, so 1.8x rejects sustained panning at ANY
 * amplitude while a real wrist-throw — 70 px in one frame is 4200 px/s — clears
 * it from any tracking speed a hand can hold.
 */
export const PARRY = { speed: 1400, burst: 1.8, window: 0.20, perfect: 0.10, cooldown: 0.28 };

/**
 * OVERHEAD, the attack that mirrors the rose upward.
 *
 * A scripted arc rather than a pose change: the guard target is driven from
 * above the head down through the centreline over `dur`, and the hands and the
 * blade chase it through their own spring. Driving the TARGET along the arc
 * rather than snapping it to the end is what makes this a swing — a snap from
 * HIGH to LOW peaks the blade at 7.9 m/s, which is under the 7.5 m/s the
 * RETURN grade wants with nothing to spare.
 */
export const OVERHEAD = { wind: 0.10, cut: 0.07, dur: 0.32, rise: 0.95, drop: 1.00, cooldown: 0.46 };

/**
 * SPIN, the attack that mirrors the rose SIDEWAYS.
 *
 * The same three-phase arc as the overhead with the axes exchanged: the guard
 * is wound to one side, driven across the centreline, and recovered. Because
 * `GX_MAX` is 1.0 against the overhead's 1.05/1.0 the two sweep almost exactly
 * the same distance, so a spin and an overhead peak the tip at the same speed
 * and neither is the strictly better button — which is the only thing that
 * makes having both a choice.
 *
 * WHAT MAKES IT A SPIN AND NOT A SLASH is `yaw`: the body turns through the
 * cut. A horizontal sweep with the feet planted is a slash and the controller
 * already has one (steer sideways and swing).
 *
 * `yaw` WAS 0.62 rad — 35 degrees — AND THAT IS NOT A SPIN, IT IS A GLANCE.
 * The player: "the spin attack needs to be like a whole body spin / directional
 * force spin thing". Measured on the real rig before the change, against the
 * overhead on the same bench:
 *
 *                     body turn   spine   girdle   shoulder joint   ring hit
 *     overhead              0°    37.9°    33.3°           187 mm      2 / 18
 *     spin               35.5°     7.1°     0.0°           102 mm      2 / 18
 *
 * Every column says the same thing: the spin had the fastest blade in the game
 * (11.0 m/s) and no BODY in it at all — less trunk than the overhead, no
 * shoulder girdle whatsoever, and a quarter turn. Standing in a ring of
 * eighteen it reached two of them, exactly what the overhead reaches, so the
 * one attack that exists to answer being surrounded answered it no better than
 * a downward chop.
 *
 * It is a full revolution now — `yaw: TAU` — spent over a `cut` lengthened from
 * 0.10 s to 0.30 s, which is 1200 deg/s: a hard pirouette, and readable. The
 * guard still sweeps across through it, so the blade covers the 360 the body
 * turns PLUS the 116 the arm crosses, and everything standing round you is
 * inside one pass.
 *
 * AND YOU STEER IT, which is the specific thing that was asked for. `drive` is
 * how fast the body travels while the turn runs and `steer` how quickly it
 * answers the stick; both are read by `Player._move`, which is the only place
 * that owns walking. The direction is taken in the frame the spin STARTED in
 * rather than the live camera frame — with the view going round once a third of
 * a second, camera-relative WASD would corkscrew and be unusable, which is the
 * whole reason a steerable spin needs a latched frame rather than a constant.
 * No stick, no travel: the spin pivots where you stand. That is the honest
 * answer to "does it move you or not" — it does what you ask it to, and being
 * able to ask is the feature.
 *
 * `side` is which way it goes and it is not a constant: it takes the sign of
 * whichever side the guard is already on, so the sweep starts from where your
 * hands are. A spin that always went left would be unusable half the time.
 */
/**
 * THE MISSILE SPIN — and it is the STAB and the SPIN, merged, because both of
 * them were asked to be deleted in the same breath.
 *
 *   "the spin attack just moves your camera and is mostly ineffective in
 *    battle, I've already told you what this needs to be multiple times"
 *
 *   "since your stab attack also currently sucks right now I want you to merge
 *    the spin and the stab together, so the spin/stab will be like you hold the
 *    saber out in front of you and spin like a missile for a short duration in
 *    any direction you choose you understand? the move was done plenty of times
 *    in the prequels"
 *
 * ── WHAT WAS THERE, AND WHY BOTH HALVES FAILED THE SAME WAY ─────────────
 *
 * The spin swept the guard ACROSS the body — the overhead's arc on its side —
 * and turned the carrier through one revolution while it did. So the blade was
 * a windmill at arm's length, the body turned, and the CAMERA turned with it,
 * which is the entire experience the player is describing: the view spun and
 * very little was cut. Standing in a ring of eighteen it reached two.
 *
 * The stab was a straight thrust with no body in it and nothing to answer.
 *
 * ── WHAT IT IS NOW ──────────────────────────────────────────────────────
 *
 * The blade goes OUT IN FRONT and STAYS THERE — that is the stab, and it is
 * held for the whole move rather than being a jab — and the body spins about
 * it while travelling. A drill, not a windmill. Everything the blade touches
 * on the way through is cut, because the blade is at the leading edge rather
 * than orbiting a metre off the hip.
 *
 * `turns` IS THE SPIN AND IT IS NOT THE CAMERA. The old move spent its whole
 * revolution on `cam.yaw`, so a quarter of a second of play was spent looking
 * at the sky and then the floor. The body rolls through `turns` revolutions and
 * the VIEW follows at `viewShare` of that — enough that you can feel yourself
 * turning, little enough that you can still see where you are going, which is
 * the difference between a move you aim and a move that happens to you.
 *
 * `drive` and `steer` are read by `Player._move`, which is the only thing that
 * owns walking, and the direction is taken in the frame the spin STARTED in —
 * see `_spinFrame`. With the view going round, camera-relative WASD would
 * corkscrew; a latched frame is what makes "in any direction you choose" true
 * for the whole duration rather than for the first frame of it.
 */
export const SPIN = {
  wind: 0.09, cut: 0.62, dur: 0.86, cooldown: 1.05,
  /** Revolutions of the BODY across the cut. */
  turns: 2.6,
  /** …and how much of that the view is given. See the note. */
  viewShare: 0.34,
  yaw: TAU, drive: 9.4, steer: 11,
  /** Where the blade is held: level, centred and forward. */
  level: 0.06,
  /** The thrust gain while it runs — the blade is OUT, not jabbing. */
  reach: 1.15,
};

/**
 * SLASH — the LEFT BUTTON, and it is the attack the player presses most.
 *
 * It was a THRUST and nothing else, and the player's words for that were "the
 * left click attacks barely do anything, like it's the slightest movement of
 * the saber". That is not an impression, it is what the instrument said. Driven
 * on the real rig (`tools/checks/duelling.mjs`, "the left button lands like a
 * cut"), the primary attack against the overhead the same player called "a lot
 * better, it feels real":
 *
 *                     tip path   tip peak   arc sweep   spine   girdle
 *     overhead          2.52 m   10.8 m/s        40°    37.9°    33.3°
 *     LMB (thrust)      1.39 m    5.9 m/s        13°    21.7°    21.5°
 *
 * 13 degrees of blade against 40, and 5.9 m/s against a game whose own cutting
 * model calls 8 m/s the speed at which "a swing does twice a press's work". By
 * the rules this project already ships, the primary attack did not qualify as a
 * swing at all. Everything else — the body drive, the reach, the lunge — was
 * already there and had nothing to carry.
 *
 * So the left button is now a CUT with the lunge still inside it: the same
 * three-phase arc as the overhead, run DIAGONALLY (`rise`/`drop` across,
 * `lift`/`fall` down) with the thrust envelope firing on the same press. A
 * fencer's cut travels forward through the target; separating the two would
 * have given the player a step OR a cut and the whole complaint is that neither
 * one alone lands.
 *
 * `side` ALTERNATES. Two presses are a left-to-right and then a right-to-left,
 * so mashing draws a figure eight rather than the same stroke twice — which is
 * the "graceful" half of "violent but graceful", and it is also why the cut is
 * effective across a line: consecutive strokes cover opposite sides.
 *
 * `cut` 0.085 s across 2.05 units of x and 1.34 of y is 28.8 guard-units a
 * second, against the overhead's 27.9 — deliberately the same order, because
 * the overhead IS the reference and a light attack that outran it would make
 * the heavy pointless.
 *
 * `cooldown` is the thrust's own 0.42 and the two are fired from ONE gate. Two
 * gates on one button is how you get a press that steps without cutting.
 */
export const SLASH = {
  wind: 0.075, cut: 0.115, dur: 0.315,
  /**
   * WIDE AND LEVEL, WHICH IS WHAT WAS ASKED FOR.
   *
   * The player: "the left click slash is better and more violent but it needs
   * to cut horizontally in a wide arc (without moving your camera)."
   *
   * It was a DESCENDING DIAGONAL: `rise 0.60 → drop 0.67` laterally, against
   * `lift 0.30 → fall 0.90` vertically. That is 1.27 units across and 1.20
   * DOWN — very nearly 45°, which is a chop, and it is why a horde in front of
   * you took one body a press. `GX_MAX` is 1.0, so the guard box is 2.0 units
   * wide and the old cut used 63% of it.
   *
   * It is a level sweep across most of the guard box now — see the width note
   * below for why it is 0.80/0.82 rather than the 0.98/1.00 this first became,
   * and what the difference buys.
   *
   * AND THE CAMERA DOES NOT MOVE. It never did on this attack — `_slX`/`_slY`
   * are guard offsets and only `overflowTurn` and the spin write `cam.yaw` —
   * but the clause is in the note because the arc being WIDE is what removes
   * the reason to sweep the mouse through the cut, which is what was actually
   * turning the view.
   */
  /**
   * …AND IT IS AIMED AT A MAN, NOT AT THE SKY — the half of "wide and level"
   * that the first pass got wrong.
   *
   * `lift 0.16 → fall 0.30` is a level sweep, and it was level at the WRONG
   * HEIGHT: the ready guard holds the blade pointing up, so a stroke that
   * leaves the pitch alone carries the tip over a standing man's head.
   * Measured on the rig, the lowest the tip ever reached through a full cut:
   *
   *     lift  0.16 / fall 0.30     tip bottoms at 2.15 m   ← over their heads
   *     lift -0.30 / fall 0.42                     1.97 m
   *     lift -0.55 / fall 0.65                     1.69 m
   *     lift -0.70 / fall 0.80                     1.48 m   ← through a chest
   *
   * A trooper's chest is about 1.4 m and its head is 1.7. So the shipped cut
   * passed cleanly above every body it was aimed at, which is a wide graceful
   * arc that hits nothing — the player's own complaint arriving by a different
   * road than the one it was fixed on.
   *
   * `-0.70 → 0.80` moves the WHOLE ARC DOWN and keeps it level: the vertical
   * span across the cut is 0.10 of a guard unit, so it is still a horizontal
   * sweep and not the descending diagonal this replaced.
   *
   * AND THE WIDTH PAYS FOR THE HEIGHT, which is the trade and is worth the
   * paragraph. Down at chest height the same guard travel is a LONGER path in
   * world space, so the blade comes out faster: at the full 0.98/1.00 the tip
   * peaked at 18.5 m/s, against a charged overhead's ~17.3, and damage in this
   * game IS blade speed — a light attack quicker than the charged heavy makes
   * the heavy a decoration, which `animation.mjs` holds a bound against for
   * exactly that reason. Measured across the width:
   *
   *     rise/drop 0.98/1.00   tip 18.5 m/s   1.94 units across   bottoms 1.48 m
   *     rise/drop 0.80/0.82       16.9        1.59               1.25 m
   *     rise/drop 0.65/0.67       13.2        1.29               0.99 m
   *
   * 0.80/0.82 is 1.59 units — 80% of everything the guard has, still a sweep
   * you can see from across the room — at a speed that leaves the charged
   * overhead the heaviest blade in the game, and it reaches a foot LOWER than
   * the widest version did.
   */
  rise: 0.80, drop: 0.82, lift: -0.70, fall: 0.80,
  lunge: 0.30, cooldown: 0.30,
  /**
   * THE CHAIN WINDOW. "obviously pressing it closely in succession will do like
   * an attack sequence of some sort, maybe like three clicks will be two light
   * attacks and then a heavy slash you can hold and release for more power."
   *
   * A press inside this many seconds of the last one ADVANCES the sequence;
   * outside it, the sequence starts again at one. It is longer than `cooldown`
   * on purpose — a player mashing at their own pace should chain, and a window
   * shorter than the recovery would be a combo only a metronome could reach.
   */
  chain: 0.55,
};

/**
 * THE THIRD PRESS — the heavy, and it is HELD.
 *
 * Two light cuts and then this, which is the shape the player described. It is
 * not a fourth attack and it is not the overhead's charge borrowed: it is the
 * lateral cut with a different envelope and a wind-up you can stand in.
 *
 *   `hold`     how long the blade chambers before any charge counts, so a
 *              player mashing three times gets a heavy at zero charge rather
 *              than accidentally holding one.
 *   `full`     the charge ceiling, in seconds of holding.
 *   `cut`      the fraction of the cut window a FULL charge keeps. 0.55 is the
 *              same trade the overhead's CHARGE makes and for the same reason
 *              written there: the blade genuinely moves faster through the same
 *              arc, so severance, stagger, the RETURN grade and the trail all
 *              see one thing — a faster blade — and none of them needs to know
 *              a charge exists.
 *   `rec`      and how much longer the recovery is, because the whole trade is
 *              that you are committed afterwards.
 *   `reach`    the heavy travels: a `lunge` scale of its own, past the light
 *              cut's 0.30, so the third hit closes the step the first two took.
 *   `drain`    stamina a second while chambered. Standing at full charge is not
 *              free, which is what stops the heavy being a state you live in.
 */
export const HEAVY = {
  wind: 0.10, cut: 0.125, dur: 0.50,
  /**
   * …AND IT COMES DOWN THROUGH A MAN, which the shipped pair did not.
   *
   * `lift 0.44 → fall 0.52` was the arc this attack was authored with, and it
   * is the exact defect SLASH's own note above measured and fixed on the light
   * cut ONE PRESS EARLIER in the same sequence: the ready guard points the
   * blade UP, so a stroke carried near the middle of the guard box passes over
   * a standing man's head. The light cut was moved to `-0.70 → 0.80` for that
   * reason and the third press of the same combination kept the old band —
   * HIGHER, in fact, than the `0.16 → 0.30` that note calls "over their heads".
   *
   * Measured on `tools/checks/animation.mjs`'s own ring of eighteen bodies
   * (0.9–1.7 m torsos at 1.4 m), the lowest the tip reaches through the whole
   * attack, and how many of the nine in front one pass crosses:
   *
   *     lift/fall     tap: low  front   charged: low  front   tap tip
   *     0.44 / 0.52       1.62   4/9           1.38   3/9      19.3 m/s
   *     0.30 / 0.75       1.18   5/9           0.87   3/9      22.0
   *     0.24 / 0.88       0.87   5/9           0.53   3/9      23.6
   *     0.00 / 1.00       0.51   6/9          -0.31   5/9      24.5
   *
   * The light cut on the same bench bottoms at 1.19 m and `animation.mjs`
   * holds it under 1.55; the heavy was at 1.62, so the payoff of the sequence
   * failed the bound its own first two presses pass. And against a REAL
   * acolyte's capsules in a real World, one tapped heavy at seven ranges from
   * 1.0 m to 2.2 m: the light cut reached the body at six of them, the heavy
   * at two, missing the whole 1.6–2.2 m band a duellist stands in by 7–25 cm.
   *
   * `0.30 / 0.75` puts the tip where the light cut already puts it and keeps
   * everything that makes this the heavy: `lift` is still ABOVE the ready
   * guard, so the chamber is genuinely overhead — the tip stands at 2.20 m
   * while the button is down — and the stroke still travels 2.0 units across
   * against 1.05 down, which is a diagonal that means it rather than a chop.
   */
  rise: 1.00, drop: 1.00, lift: 0.30, fall: 0.75,
  hold: 0.16, full: 0.80, cutScale: 0.55, rec: 1.7, reach: 0.52, drain: 0.20,
};

/**
 * THE CHARGED HEAVY, and it is not a fourth attack — it is the overhead with
 * its own clock run slower.
 *
 * Player note #15 asked for "a charged heavy". The honest way to build one in
 * a game whose damage is `bladeSpeed × sharpness / toughness` is NOT to attach
 * a damage multiplier to a button: it is to change the SWING, and let the same
 * contact solver read whatever the blade is then doing. Everything downstream
 * — severance, stagger, the RETURN grade, the trail, the hum — sees one thing,
 * a blade that is genuinely moving faster, and none of them needs to know a
 * charge exists.
 *
 * IT IS NOT A BIGGER ARC, and that was the first attempt. The guard's travel
 * is bounded — `clamp(gy + arc, -GY_MIN, GY_MAX)` — and the ordinary overhead
 * already saturates it, so a 1.55x amplitude measured out at 2.03 units
 * against the tap's 1.94: a 5% gain, entirely eaten by the clamp. A number
 * that cannot move the thing it multiplies is not a tuning value, it is a
 * comment.
 *
 * IT IS A FASTER CUT THROUGH THE SAME ARC, which is also what a real wind-up
 * buys: you hold the blade chambered, and when you let go the same distance is
 * covered in less time. `cut` is the fraction of the cut window a full charge
 * keeps — 0.62, so the tip crosses the centreline about 1.6x faster — and
 * `rec` is how much longer the recovery takes, because the whole trade is that
 * you are committed afterwards.
 *
 * `hold` is how long the blade has to stay chambered before any of it applies.
 * A player mashing the attack must never accidentally charge, so a tap
 * releases inside it and comes out at exactly the swing that shipped.
 *
 * `drain` is stamina per second while chambered. Standing at full charge is
 * not free, which is what stops the heavy from being a state you enter once
 * and swing out of forever.
 */
export const CHARGE = { hold: 0.28, full: 0.85, cut: 0.62, rec: 1.9, drain: 0.22 };

/**
 * How fast the guard point travels to a zone's pose, in e-folds per second.
 * The same order as `stanceRate` (9), doubled: a lateral guard is a stance you
 * settle into, a zone change is a flick you have already made with your hand
 * and the blade should be on its way before you have finished making it.
 */
export const ZONE_RATE = 18;

const _zv = new THREE.Vector3();
const _zq = new THREE.Quaternion();

/**
 * A world direction, in the guard's own polar coordinates.
 *
 * The transform is exactly the one applyAssist has always used to turn a threat
 * into a guard position — invert the aim, then yaw = atan2(x, -z) and
 * pitch = asin(y) — with two derived readings on top: `theta`, the angle off the
 * sightline, and `rose`, the bearing around it. Those two are the zone.
 */
export function aimAngles(dir, aimQuat, out = {}) {
  _zv.copy(dir).normalize().applyQuaternion(_zq.copy(aimQuat).invert());
  out.yaw = Math.atan2(_zv.x, -_zv.z);
  out.pitch = Math.asin(clamp(_zv.y, -1, 1));
  out.theta = Math.acos(clamp(-_zv.z, -1, 1));
  out.rose = Math.atan2(out.pitch, out.yaw);
  return out;
}

/** Shortest signed distance between two rose bearings, in (-π, π]. */
export function roseDelta(a, b) {
  let d = (a - b) % TAU;
  if (d > Math.PI) d -= TAU;
  if (d <= -Math.PI) d += TAU;
  return d;
}

/**
 * Which zone a rose bearing falls in. Exactly one, always — the four sectors
 * tile the circle, and a bearing exactly on a boundary is resolved by taking
 * the first in ZONE_ORDER, so there is no direction with two answers and none
 * with none.
 */
export function zoneOfRose(rose) {
  let best = ZONE_ORDER[0], bestD = Infinity;
  for (const z of ZONE_ORDER) {
    const d = Math.abs(roseDelta(rose, ZONE_ROSE[z]));
    if (d < bestD - 1e-12) { bestD = d; best = z; }
  }
  return best;
}

/** Which zone answers a world direction arriving at a body aimed by `aimQuat`. */
export function zoneOfDir(dir, aimQuat) {
  return zoneOfRose(aimAngles(dir, aimQuat).rose);
}

/**
 * The angular term integrates as  θ'' = (kP/I)·θ_err − kD·θ'.
 * Critical damping is therefore kD = 2·√(kP/I); everything here sits around a
 * damping ratio of 0.6, which is what gives the blade its weight — a flick
 * overshoots by roughly a tenth of the arc and swings back, exactly as a
 * metre of metal on the end of your wrist would.
 */
export const GRIPS = {
  two:  { kP: 156, kD: 15.0, inertia: 1.00, guardR: 0.60, handExtend: 0.29, offset: new THREE.Vector3(0.055, -0.20, 0.02), lin: 118, linD: 15 },
  one:  { kP: 118, kD: 13.6, inertia: 0.74, guardR: 0.72, handExtend: 0.36, offset: new THREE.Vector3(0.185, -0.13, 0.0), lin: 92,  linD: 13 },
  rev:  { kP: 132, kD: 14.4, inertia: 0.86, guardR: 0.58, handExtend: 0.26, offset: new THREE.Vector3(-0.14, -0.06, 0.03), lin: 104, linD: 14 },
};

export class SaberController {
  constructor(opts = {}) {
    // guard point, in units of max deflection (-1..1)
    this.gx = 0.18;
    this.gy = 0.12;
    this.maxYaw = 1.62;      // rad at |gx| = 1
    this.maxPitch = 1.28;
    this.roll = 0;
    this.rollVel = 0;

    /**
     * HOW LONG THIS WIELDER'S ARM IS, against the one every number in `GRIPS`
     * was authored for — 1 for a human, and set by the Player from its own rig
     * (see `limbScale` in Rig.js).
     *
     * `guardR`, `handExtend`, `offset`, the lateral split and both reach clamps
     * are all DISTANCES FROM THE CHEST TO THE HANDS. They are a body
     * measurement wearing the name of a tuning constant, and on a body that is
     * not 1.78 m they are simply the wrong body's. On the 0.66 m frame,
     * measured before this (tools/_stature.mjs), the hand target sat 1.35 times
     * the whole reach of the arm away from the shoulder — so the two-bone IK
     * could not arrive at ALL. It did what an IK does when it cannot reach:
     * straightened the arm, pointed it at the target, and stopped short. That
     * is both of the note's first two claims in one line — the hilt hangs in
     * the gap the hand could not close, and under a raised guard the target is
     * above the figure's own head, so both arms go up to point at it (68° and
     * 47° above their own shoulders, against a human's 40° and 19°).
     *
     * NOT `stature`. The chest these are measured FROM is already placed by
     * stature; what is measured from it is arm, and a species frame scales the
     * arm separately (`smallfolk` is `scale: 0.40` with `armLen: 1.06`).
     *
     * Everything the blade DOES is untouched — kP, kD, inertia and the two
     * linear gains are a weapon's character, not a body's, and a smaller Jedi
     * is not holding a lighter sword.
     */
    this.reachScale = opts.reachScale ?? 1;

    this.sensitivity = opts.sensitivity ?? 1;
    this.followStrength = opts.followStrength ?? 0;
    this.deadzone = 0.24;
    // 'directional' is what the game ships (Menu.DEFAULT_SETTINGS); 'hold' and
    // 'free' are the two continuous-aim schemes and both survive untouched.
    // The constructor keeps the conservative default because it is the one the
    // headless checks construct by hand, and a library default is not the same
    // claim as a shipped default.
    this.scheme = opts.scheme ?? 'hold';     // 'hold' | 'free' | 'directional'

    // Where the blade sits when you are not steering it. Releasing the mouse
    // returns to this, rather than leaving the blade wherever the last flick
    // abandoned it. Set from READY_GUARD and from nowhere else — call
    // setViewMode() to change it, never assign readyX/readyY directly.
    this.readyX = 0; this.readyY = 0;
    this.setViewMode(false);
    this.recentre = 5.5;     // rad/s of easing back to the ready guard
    // The camera does NOT move while you are steering the blade. A full
    // left-to-right slash has to fit INSIDE the cone, or every slash spills
    // over and spins the view — which is exactly what made horizontal slashing
    // while strafing impossible.
    this.overflowTurn = 0;
    // Blade travel is ~2.0 units corner to corner, so at this gain a full slash
    // is about 350px of mouse: one comfortable sweep, not an arm's length.
    this.bladeGain = 0.0057;
    this.camGain = 0.0024;
    this.steering = 0;       // 1 while the player is actually driving the blade

    this.grip = 'two';
    this.gripBlend = 1;

    // Integrated blade state. handLocal is the hand offset from the chest and
    // is what actually gets integrated: a spring chasing a world-space target
    // lags by v·kD/kP, which at a run is over half a metre — the blade trailed
    // behind the body like a windsock any time you moved.
    this.handLocal = new THREE.Vector3();
    this.handPos = new THREE.Vector3();
    this.handVel = new THREE.Vector3();
    this.quat = new THREE.Quaternion();
    this.angVel = new THREE.Vector3();
    this.initialised = false;

    // gesture analysis
    this.mouseSpeed = new Ema(18);
    this.mouseAccel = new Ema(12);
    this.swingEnergy = 0;
    this.commitment = 0;       // 0 = free to reverse, 1 = fully committed
    this.lastGestureDir = new THREE.Vector2();
    this.gestureDir = new THREE.Vector2();

    // thrust / lunge. `thrust` is the 0..1 envelope the solver reads; `thrustT`
    // is where we are along it in seconds, and `thrustStanding` is latched at
    // the press so a lunge that starts still stays a standing lunge even if you
    // begin walking halfway through it.
    this.thrust = 0;
    this.thrustT = -1;
    this.thrustStanding = 0;
    this.thrustCooldown = 0;

    // Flourish — an idle twirl with no combat effect at all. It is carried as an
    // ADDITIVE offset on the guard and the wrist (_flX/_flY/_flRoll), removed
    // and re-applied every frame, so starting one does not snap the guard to the
    // middle of the circle and finishing one does not snap it back.
    this.flourishT = -1;
    this.flourish = 0;
    this._flX = 0; this._flY = 0; this._flRoll = 0;

    /**
     * LATERAL GUARD. "How do I position the blade laterally? Imagine a guard
     * stance?" — you could not, and the reason was geometric rather than a
     * missing keybind. Both the hands and the guard point sit along the SAME
     * ray out of the chest, so the blade always pointed radially outward: it
     * could be aimed anywhere on the sphere but never laid ACROSS the body.
     * Measured over the whole reachable guard, the blade never once crossed the
     * player's own centreline.
     *
     * `stance` splits that ray. The hands go one way off it and the guard point
     * the other, so the blade lies across the chest — a horizontal guard you can
     * hold. -1 is hands-left/tip-right, +1 is the mirror.
     */
    this.stance = 0;
    this.stanceTarget = 0;
    this.stanceRate = 9;

    /**
     * Catch window. Set from outside (World) to the seconds left on a caught
     * bolt. While it is positive the camera comes BACK to the player even with
     * the blade button held, and the guard freezes where it is — it is holding
     * something.
     */
    this.catchHold = 0;
    this.bladeHeld = false;

    /**
     * DIRECTIONAL GUARD state. All of it is inert unless `scheme` is
     * 'directional', so the two continuous-aim schemes read exactly as they did.
     *
     * `zone` is the guard you are holding, `zoneAge` how long you have held it,
     * and `zoneCool` the lockout that stops the parry window being mashed open.
     * `lastZone` is remembered across a release so raising the guard again puts
     * you back where you were rather than in a zone you did not choose.
     */
    this.zone = ZONE.NONE;
    this.zoneAge = 0;
    this.zoneCool = 0;
    this.zoneParry = false;
    this.lastZone = ZONE.HIGH;
    this.zoneFlicks = 0;
    /**
     * The guard volume Bolts.update tests bolts against, republished every
     * frame by update(). `origin` is copied from the live chest and `inv` from
     * the live aim, so the guard travels with the body and turns with the head —
     * unlike the auto-guard cone, whose whole point is that it does NOT turn.
     */
    this.guard = {
      active: false, zone: ZONE.NONE, rose: 0, half: GUARD.sector,
      centre: GUARD.centre, reach: GUARD.reach, radius: GUARD.radius,
      parry: false, parryAge: 0,
      origin: new THREE.Vector3(), inv: new THREE.Quaternion(),
    };
    /** Extra rose forgiveness bought by the difficulty tier, in radians. */
    this.zoneTol = 0;

    // OVERHEAD attack envelope. Same additive-offset discipline as the
    // flourish: taken back off the guard before anything else touches it, so a
    // swing composes with a held zone instead of overwriting it.
    this.swingT = -1;
    this.swing = 0;
    this.swingCool = 0;
    this._swX = 0; this._swY = 0;
    /* SPIN — its own timer and its own cooldown, deliberately not shared with
     * the overhead's. Sharing one would make the pair a rotation you alternate
     * for free, and the whole point of the longer recovery is that a spin is a
     * commitment. `spinSide` is latched at the press so the sweep cannot
     * reverse mid-cut if the guard drifts across the centreline. */
    this.spinT = -1;
    this.spin = 0;
    this.spinCool = 0;
    this.spinSide = 1;
    this.spinYaw = 0;
    /* How far the BODY turns this frame, against `spinYaw`'s share of it that
     * reaches the camera. See SPIN's note on `viewShare`. */
    this.bodyYaw = 0;
    /* And how far out the blade is held while the drill runs — the STAB half
     * of the merged move, applied after the thrust envelope. */
    this._spinThrust = 0;
    /* The spin's VERTICAL half, kept out of `_swY` on purpose: the overhead
     * owns that one, and the two attacks are allowed to overlap. */
    this._spY = 0;
    /* SLASH — the left button. Its own timer and its own additive pair, for
     * the reason the spin's note gives: two attacks that shared one offset
     * could not overlap, and an overhead released during a slash is a
     * different cut rather than a cancelled one. `slashSide` ALTERNATES rather
     * than being latched from the guard — see SLASH's own note. */
    this.slashT = -1;
    /**
     * THE SEQUENCE. `comboStep` is which of the three the NEXT press fires —
     * 0 and 1 are the light lateral cuts and 2 is the held heavy — and
     * `comboTimer` is how long the window stays open. See `SLASH.chain`.
     *
     * `heavyArmed` is the state between pressing the third and letting go of
     * it: the blade is chambered, the charge is winding, and nothing has been
     * swung yet. It is a state and not a flag on `slashT` because the whole
     * point of it is that it has no duration — it lasts as long as the button
     * is down, up to `HEAVY.full`.
     */
    this.comboStep = 0;
    this.comboTimer = 0;
    this.heavyArmed = false;
    this.heavyHold = 0;
    this.heavyCharge = 0;
    this.isHeavy = false;
    this.slash = 0;
    this.slashCool = 0;
    this.slashSide = 1;
    this._slX = 0; this._slY = 0;
    /**
     * HOW MUCH OF A FULL STAB THE LIVE THRUST IS WORTH — 1 for the bare stab
     * on the wheel, `SLASH.lunge` for the step inside a cut.
     *
     * It is a scale and not a second envelope because there is only one lunge
     * in this file and it must stay that way: `THRUST` owns the timing, and
     * what a cut wants is the same shape, smaller. Measured, a cut carrying a
     * FULL stab peaked the tip at 17.8 m/s — 1.6x the overhead the player named
     * as the reference and above the charged heavy, so the light attack would
     * have been the best attack in the game. The arm is already extended and
     * already rotating; adding the whole lunge on top multiplies a lever that
     * is at full length.
     */
    this.thrustGain = 1;
    /* CHARGE — 0..1, how much of a heavy is wound up, and `charged` is what it
     * was AT THE RELEASE, which is the number the swing runs on. Reading the
     * live `charge` inside the envelope would let a swing get stronger after
     * it had already started. */
    this.charge = 0;
    this.charged = 0;
    /** `charged` is sampled once, at the release. See the note at the pin. */
    this.chargeLocked = false;

    /**
     * "Blade holds position": on release the blade stays where you left it
     * instead of easing back to the ready guard. Off by default, because the
     * recentre is what makes the blade cursor a cursor.
     */
    this.holdPosition = opts.holdPosition ?? false;

    // bind (blade lock) state
    this.bindContact = null;
    this.bindPush = 0;

    // strain from contacts — a blocked blade is physically pushed
    this.impulseAng = new THREE.Vector3();
    this.impulseLin = new THREE.Vector3();

    this.assist = 0;
    this.stamina = 1;
    this.flow = 0;
    this.locked = false;
  }

  /**
   * WHERE THE OVERHEAD IS IN ITS OWN ARC, in guard units: +0.95 at the top of
   * the wind-up, −1.08 at the bottom of the cut, 0 when nothing is swinging.
   *
   * Published because `Player._attackDrive` puts the SPINE and the SHOULDERS
   * behind the swing and has to be in phase with it, and the alternative is
   * Player recomputing the three phases from `swingT` against `OVERHEAD` — a
   * second copy of the envelope in another file, which is the exact shape
   * HANDOFF §2.4 is about. This is the arc itself, AFTER the clamp, so a swing
   * out of a guard already near its travel limit drives the body by exactly as
   * much as it drives the blade rather than by what it asked for.
   *
   * A getter over `_swY` rather than a second field: one value, one owner.
   */
  get swingArc() { return this._swY; }

  /**
   * WHERE THE LEFT BUTTON'S CUT IS IN ITS OWN ARC, the same contract and for
   * the same reason: `Player._attackDrive` puts the trunk and the shoulder
   * girdle behind this cut and has to be in phase with it, and the alternative
   * is a second copy of the envelope in another file.
   *
   * Two components because the cut is DIAGONAL — `slashAcross` is the lateral
   * half, which is what the torso twists on, and `slashArc` the vertical half,
   * which is what it folds on. Both are read AFTER the clamp.
   */
  get slashArc() { return this._slY; }

  get slashAcross() { return this._slX; }

  /**
   * THE LIVE LUNGE — the thrust envelope after `thrustGain`, and the number
   * every reader outside this file wants. `thrust` stays the raw envelope so
   * "the envelope closed" is still answerable; this is how far it is actually
   * driving the hands.
   */
  get lunge() { return this.thrust * this.thrustGain; }

  /** True while any part of the spin — wind, cut or recovery — is running. */
  get spinning() { return this.spinT >= 0; }

  reset(chest, aimQuat) {
    this.gx = this.readyX; this.gy = this.readyY; this.roll = 0;
    this.handVel.set(0, 0, 0); this.angVel.set(0, 0, 0);
    this.stance = 0; this.stanceTarget = 0;
    this.thrust = 0; this.thrustT = -1; this.thrustStanding = 0;
    /* AND THE COOLDOWNS, ALL FIVE OF THEM. `slashCool` and `swingCool` were
     * cleared here and `thrustCooldown` and `spinCool` were not, so two of the
     * five attack clocks survived a reset — and `thrustCooldown` is the one
     * that gates the LEFT BUTTON, so a controller reset mid-recovery refused
     * the whole sequence for up to `SLASH.cooldown × 1.5` afterwards.
     *
     * NOT A PLAYER-FACING DEFECT, and saying so is the honest half: `reset` has
     * no caller in src/ at all — every one is a check or verify.mjs, so what
     * this actually broke is instruments. It broke one immediately.
     * tools/checks/sequence.mjs read a tapped heavy as costing 0.0% of the
     * stamina bar and passed its ordering clause on that, and the press it
     * believed it was measuring had been refused by a cooldown the arm above
     * it left armed. There is no reading of a method called `reset` under
     * which some of the clocks belong to the old life and the rest do not. */
    this.thrustCooldown = 0;
    this.spinT = -1; this.spin = 0; this.spinYaw = 0; this.spinCool = 0; this._spY = 0;
    this.bodyYaw = 0; this._spinThrust = 0;
    this.slashT = -1; this.slash = 0; this.slashCool = 0;
    this.comboStep = 0; this.comboTimer = 0;
    this.heavyArmed = false; this.heavyHold = 0; this.heavyCharge = 0; this.isHeavy = false;
    this._slX = 0; this._slY = 0; this.thrustGain = 1;
    this.charge = 0; this.charged = 0; this.chargeLocked = false;
    this.flourish = 0; this.flourishT = -1;
    this._flX = 0; this._flY = 0; this._flRoll = 0;
    this.swing = 0; this.swingT = -1; this.swingCool = 0;
    this._swX = 0; this._swY = 0;
    // One door onto the zone state, so a reset cannot leave a stale parry flag
    // behind the way an open-coded version of this did. `lastZone` deliberately
    // survives: which guard you favour is a habit, not a piece of run state.
    this.zoneCool = 0;
    this._dropZone();
    this.catchHold = 0; this.bladeHeld = false;
    this.initialised = false;
    this.solveTargets(chest, aimQuat, 0);
    this.handLocal.subVectors(this._handTarget, chest);
    this.handPos.copy(this._handTarget);
    this.quat.copy(this._targetQuat);
    this.initialised = true;
  }

  setScheme(s) {
    this.scheme = s;
    if (s !== 'directional') this._dropZone();
    return this;
  }

  /* ── directional guard ─────────────────────────────────────────────── */

  /** Is the player holding a guard zone right now. */
  get guarding() { return this.scheme === 'directional' && this.zone !== ZONE.NONE; }

  /** The authored pose of a zone, in guard coordinates. */
  zonePose(zone) { return ZONE_POSE[zone] || { x: this.readyX, y: this.readyY }; }

  _dropZone() {
    this.zone = ZONE.NONE;
    this.zoneAge = 0;
    this.zoneParry = false;
    this.guard.active = false;
    this.guard.zone = ZONE.NONE;
    this.guard.parry = false;
  }

  /**
   * One frame of the guard rose.
   *
   * Everything the mouse did this frame has ALREADY been spent on the camera by
   * the caller. That is not an oversight, it is the design: a flick turns your
   * view a little AND sets your guard, and neither takes the other away.
   */
  _updateZone(dx, dy, dt, bladeHeld) {
    this.zoneCool = Math.max(0, this.zoneCool - dt);
    if (this.zone !== ZONE.NONE) this.zoneAge += dt;

    if (!bladeHeld) {
      if (this.zone !== ZONE.NONE) this._dropZone();
    } else if (this.zone === ZONE.NONE) {
      // Raising the guard puts you back in the zone you last held, and that
      // counts as entering it — tapping the button as a bolt lands IS the
      // parry input, which is exactly Chivalry's and exactly what `cooldown`
      // keeps from being mashed.
      this.zoneParry = this.setZone(this.lastZone, { force: true });
    } else {
      const want = this.flickZone(dx, dy, dt);
      // ASSIGN, never merely raise. A flick that lands inside the re-entry
      // cooldown gets the zone and NOT the window, and if this only ever set the
      // flag true, a mashed flick would inherit the last real parry's flag while
      // resetting the age it is measured against — measured, that held a parry
      // window open on 100% of frames against a 71% ceiling.
      if (want) this.zoneParry = this.setZone(want);
    }

    // Ease the guard point onto the zone's authored pose — or home, when the
    // guard is down and the player has not asked the blade to stay put.
    const pose = this.zone !== ZONE.NONE ? this.zonePose(this.zone)
      : (this.holdPosition ? null : { x: this.readyX, y: this.readyY });
    if (pose) {
      const k = clamp(dt * ZONE_RATE, 0, 1);
      this.gx = lerp(this.gx, pose.x, k);
      this.gy = lerp(this.gy, pose.y, k);
    }
  }

  /**
   * Enter a zone. Returns true if this opened a parry window.
   *
   * Re-entering the zone you are already in does nothing at all — otherwise a
   * player could hold the parry window open by flicking in place, which is the
   * same hold-to-win failure the auto-guard cone's "only a manual catch re-arms
   * it" rule exists to prevent, reached from a different direction.
   */
  setZone(zone, { force = false } = {}) {
    if (!ZONE_POSE[zone]) { this._dropZone(); return false; }
    if (zone === this.zone && !force) return false;
    this.zone = zone;
    this.lastZone = zone;
    this.zoneAge = 0;
    this.zoneFlicks++;
    if (this.zoneCool > 0) return false;         // mashed: guard yes, parry no
    this.zoneCool = PARRY.cooldown;
    return true;
  }

  /**
   * Which zone a flick of (dx, dy) mouse pixels asks for.
   *
   * Screen-space dy is positive DOWNWARD and the rose is positive UPWARD, so
   * the vertical term is negated — the same inversion the blade steering has
   * always applied to `gy`. Returns null for a movement that is not a flick.
   */
  flickZone(dx, dy, dt) {
    const speed = Math.hypot(dx, dy) / Math.max(dt, 1e-4);
    if (speed < PARRY.speed) return null;
    // …and fast relative to what the hand has been doing. `mouseSpeed` is pushed
    // further down applyInput, so what it holds here is the average THROUGH THE
    // PREVIOUS FRAME — the recent history, not including the movement being
    // judged. That is the only ordering in which this test means anything.
    if (speed < this.mouseSpeed.v * PARRY.burst) return null;
    return zoneOfRose(Math.atan2(-dy, dx));
  }

  /**
   * The blade cursor's resting place, chosen by view mode. The one door onto
   * readyX/readyY: a caller says WHICH POSE it wants, never what the numbers
   * are, so the pair can only ever be tuned in READY_GUARD above.
   */
  setViewMode(firstPerson) {
    const r = firstPerson ? READY_GUARD.first : READY_GUARD.third;
    this.readyX = r.x;
    this.readyY = r.y;
    return this;
  }

  /** Guard direction in world space. */
  guardDir(aimQuat, out = new THREE.Vector3()) {
    const yaw = this.gx * this.maxYaw;
    const pitch = this.gy * this.maxPitch;
    out.set(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch));
    return out.applyQuaternion(aimQuat).normalize();
  }

  /* ── input ─────────────────────────────────────────────────────────── */

  /**
   * Consume mouse motion. Returns the camera yaw/pitch delta the blade wants
   * the view to follow (Free Blade) — the caller applies it to the camera.
   *
   * The two actions this file reads that nothing else does — `stance` and
   * `flourish` — are ordinary entries in Bindings.js like every other control.
   * They used to be seeded onto KeyB and KeyN here at runtime behind a one-shot
   * flag, which meant they were absent from the ACTIONS table: not rebindable,
   * not listed in the options screen, and silently sharing their keys with the
   * stasis field, rend, and the dojo's own lesson navigation. A feature the
   * player cannot find does not exist.
   */
  applyInput(input, dt, ctx) {
    const cam = { yaw: 0, pitch: 0 };
    if (this.locked) return cam;

    // Three schemes, and what the blade button MEANS is the difference between
    // them. 'blade' is a rebindable action in all three, so the player can move
    // it off LMB.
    //
    //   hold / free   One control at a time. While the button is down the mouse
    //                 IS the blade and the camera does not move; let go and the
    //                 mouse is the camera again. Driving both at once, which is
    //                 what the old blade-leads-camera scheme did, makes neither
    //                 legible — but the price is that you cannot aim a return
    //                 while you are making one, which is the complaint that
    //                 produced the third scheme.
    //   directional   The button RAISES A GUARD. The mouse is never taken,
    //                 because a zone is a state and states do not need holding
    //                 in place; the same motion aims and picks the guard.
    const directional = this.scheme === 'directional';
    /* ONE BUTTON, ONE MEANING. `blade` is the guard in all three schemes now
     * that it is on RMB (see its row in Bindings.js) — and Free is the scheme
     * where the blade is ALREADY live, so its guard is the press that pins it.
     * That is why this reads the same action either way and only the sense
     * flips; it used to read a different action per scheme, which is how the
     * attack button ended up being the thing that pinned the blade. */
    const bladeHeld = this.scheme === 'free' ? !input.act('blade') : input.act('blade');
    this.bladeHeld = bladeHeld;
    // …except while a bolt is caught. Then the camera comes back immediately and
    // fully, button or no button, because the whole reason the bolt is stuck to
    // the blade is to give you the camera back long enough to aim the throw.
    // This is the one line that turns block-and-aim from simultaneous — which is
    // impossible — into sequential.
    // …and under DIRECTIONAL there is no such mode at all. The guard is a zone,
    // not a position, so there is nothing for the mouse to steer and no reason
    // to take it: the camera is live on every frame of a block. That single
    // `false` is the whole of the fix the rest of this file is arranged around.
    const bladeMode = !directional && bladeHeld && this.catchHold <= 0;
    // Two separate gains: the blade needs a full arc inside one sweep, the
    // camera needs shooter-normal turn rates. Sharing one number made the blade
    // sluggish or the camera twitchy, depending which you tuned for.
    const s = this.sensitivity * this.bladeGain;
    const cs = this.sensitivity * this.camGain;
    const dx = input.mouse.dx, dy = input.mouse.dy;

    // ── Take last frame's ADDITIVE OFFSETS — the flourish twirl and the
    // overhead arc — back off the guard and the wrist before anything else
    // touches them. The flourish's own comment has said "before anything else"
    // since it was written, and the code did it two thirds of the way down,
    // AFTER the steering and the recentre. That was survivable while the only
    // thing above it was a recentre toward a fixed pose, and it stopped being
    // survivable the moment a zone lerp appeared: the lerp pulled `gy` —
    // offset and all — toward the zone pose, so it ate 30% of the swing's own
    // amplitude every frame. Measured, an overhead out of the LOW guard swept
    // 0.91 units of a 1.33-unit arc and peaked the tip at 7.3 m/s instead of
    // 9-plus. The offsets belong outside every reader of the base guard.
    this.gx -= this._flX + this._swX + this._slX;
    this.gy -= this._flY + this._swY + this._slY + this._spY;
    this.roll -= this._flRoll;
    this._flX = 0; this._flY = 0; this._flRoll = 0;
    this._swX = 0; this._swY = 0; this._spY = 0;
    this._slX = 0; this._slY = 0;

    if (bladeMode) {
      this.steering = 1;
      // While you hold the button the mouse is purely the blade and the view
      // does not move at all. The cone is wide enough that a full left-to-right
      // slash fits inside it in one sweep, which is the whole point: an earlier
      // version let a push past the cone turn the camera, and since a real
      // slash overshoots the cone every time, every slash spun the view and
      // horizontal attacks while strafing were impossible. overflowTurn is kept
      // as a knob but ships at zero.
      // gx and gy are in units of their OWN max deflection, and those maxima are
      // not equal: yaw reaches 1.62 rad, pitch only 1.28. Sharing one gain
      // therefore turned one pixel of mouse into 1.27x more ANGLE sideways than
      // vertically, so a straight overhead pull curved off to the side under
      // nothing worse than normal hand wobble, and a diagonal never went where
      // it was aimed. Scaling the vertical term by the ratio makes a pixel mean
      // the same angle whichever way you move it.
      const wantX = this.gx + dx * s;
      const wantY = this.gy - dy * s * (this.maxYaw / this.maxPitch);
      this.gx = clamp(wantX, -GX_MAX, GX_MAX);
      this.gy = clamp(wantY, -GY_MIN, GY_MAX);
      cam.yaw -= (wantX - this.gx) * this.maxYaw * this.overflowTurn;
      cam.pitch += (wantY - this.gy) * this.maxPitch * this.overflowTurn * 0.7;

      // Optional, off by default: let the camera drift after a blade that has
      // left the deadzone, pulling the guard back by the same amount so the
      // blade stays put in the world while the view swings to meet it.
      const f = this.followStrength;
      if (f > 0.001) {
        const ox = Math.abs(this.gx) > this.deadzone ? (this.gx - Math.sign(this.gx) * this.deadzone) : 0;
        const oy = Math.abs(this.gy) > this.deadzone * 1.3 ? (this.gy - Math.sign(this.gy) * this.deadzone * 1.3) : 0;
        const rate = clamp(f * 7.5 * dt, 0, 0.6);
        const cy = ox * this.maxYaw * rate;
        const cp = oy * this.maxPitch * rate * 0.72;
        cam.yaw = -cy;
        cam.pitch = cp;
        this.gx -= cy / this.maxYaw;
        this.gy -= cp / this.maxPitch;
      }
    } else {
      this.steering = 0;
      // camera-only. The guard is body-relative, so it simply rides round with
      // the shoulders — it must NOT be counter-rotated to stay world-fixed, or
      // turning ninety degrees pins the blade against its own travel limit.
      cam.yaw = -dx * cs;
      cam.pitch = -dy * cs;
      // ── DIRECTIONAL. The same motion that just turned the camera also chooses
      // the guard, if it was fast enough to be a flick. Nothing is frozen and
      // nothing is shared: the camera gets every pixel, and the flick gets a
      // discrete state out of the DIRECTION of those pixels rather than out of
      // their accumulated position.
      if (directional) this._updateZone(dx, dy, dt, bladeHeld);
      // The blade does not drift home while it is holding a caught bolt, and it
      // does not drift home at all if the player asked it not to.
      else if (this.catchHold <= 0 && !this.holdPosition) {
        const k = clamp(dt * this.recentre, 0, 1);
        this.gx = lerp(this.gx, this.readyX, k);
        this.gy = lerp(this.gy, this.readyY, k);
      }
    }

    // ── WRIST ROLL. `rollInput += input.mouse.wheel * 0.55` used to sit here,
    // which was the last raw device read left in the blade: the wheel was not
    // in ACTIONS, so it could not be rebound, could not be listed and could not
    // be seen to collide — and it DID collide, with Player's grip distance,
    // which had to steal the wheel back frame by frame to get a notch of its
    // own. The wheel is now `attackOver` / `attackStab` like any other control
    // and the roll is the two rebindable keys it always also had.
    //
    // …AND SO WAS `input.padDown(4)` / `padDown(5)`, WHICH SAT HERE UNTIL THE
    // PAD JOINED THE TABLE. Two raw button INDICES, so the last two controls in
    // the game that no binding could move: not listed, not rebindable, and
    // invisible to findConflicts in exactly the way the wheel above was. They
    // also became actively wrong the moment the pad had a default map — button
    // 4 is LB, which is the Force modifier, so holding it to cast would have
    // rolled the wrist left. `rollL`/`rollR` carry the D-pad now and this reads
    // the actions, once, for every device.
    let rollInput = 0;
    if (input.act('rollL')) rollInput -= 1;
    if (input.act('rollR')) rollInput += 1;
    this.rollVel = damp(this.rollVel, rollInput * 5.4, 14, dt);
    this.roll += this.rollVel * dt;

    // ── LATERAL GUARD. Held, not toggled: a guard stance is a thing you stand
    // in. Which side leads comes from where the guard already is, so one binding
    // reaches both the left-lead and the right-lead horizontal guard — drift the
    // cursor across the centre and the blade turns over with you.
    if (input.act('stance')) {
      const side = Math.abs(this.gx) > 0.06 ? Math.sign(this.gx) : (this.stanceTarget || 1);
      this.stanceTarget = side;
    } else this.stanceTarget = 0;
    this.stance = damp(this.stance, this.stanceTarget, this.stanceRate, dt);

    // ── FLOURISH. No combat effect: it drives roll and the guard point and
    // nothing else, and any real intent — steering, stancing, stabbing —
    // cancels it on the spot.
    //
    // The twirl is decoration ON TOP of whatever the blade is already doing, so
    // it must never leave a residue: without the removal at the top of this
    // function, starting one snapped the guard to the centre of the circle and
    // cancelling one left the wrist wherever the twirl had got to.
    if (input.actHit('flourish') && this.flourishT < 0 && !bladeHeld) this.flourishT = 0;
    if (this.flourishT >= 0) {
      if (bladeHeld || this.stanceTarget || this.thrustT >= 0) this.flourishT = -1;
      else {
        this.flourishT += dt;
        if (this.flourishT >= FLOURISH.dur) this.flourishT = -1;
      }
    }
    // Ease in and out so the twirl grows out of the guard and settles back into
    // it rather than snapping onto a circle and snapping off it again.
    this.flourish = this.flourishT < 0 ? 0
      : Math.sin(Math.PI * clamp(this.flourishT / FLOURISH.dur, 0, 1));
    if (this.flourishT >= 0) {
      const ph = TAU * FLOURISH.turns * (this.flourishT / FLOURISH.dur);
      this._flRoll = ph;
      // Clamp the OFFSET rather than the result, so next frame's subtraction is
      // still exact and the guard cannot be twirled outside its own travel.
      this._flX = clamp(this.gx + Math.sin(ph) * FLOURISH.radius * this.flourish, -GX_MAX, GX_MAX) - this.gx;
      this._flY = clamp(this.gy + Math.cos(ph) * FLOURISH.radius * this.flourish, -GY_MIN, GY_MAX) - this.gy;
    }
    this.gx += this._flX; this.gy += this._flY; this.roll += this._flRoll;

    // ── OVERHEAD. The attack that mirrors the rose upward: wheel up.
    //
    // Same additive discipline as the flourish, and for the same reason — the
    // arc is an offset ON TOP of whatever guard you are holding, so swinging out
    // of a held zone must leave that zone exactly where it was when the swing
    // ends. An implementation that ASSIGNED the guard would drop your guard
    // every time you attacked, which is a thing you would feel and never be able
    // to name.
    // (The removal is at the top of this function, above every reader of the
    // base guard — see the note there.)
    this.swingCool = Math.max(0, this.swingCool - dt);
    if (input.actHit('attackOver') && this.swingT < 0 && this.swingCool <= 0 && ctx.stamina > 0.12) {
      this.swingT = 0;
      // The one offensive rate in the game, and until Cadence nothing could
      // move it: 0.46 s is 2.17 swings a second no matter what a run had drawn.
      // Divided, not multiplied — `attackRate` is swings per second, so a 1.33x
      // rate is a 0.75x recovery, and a card that raised it would otherwise
      // have made the player slower.
      this.swingCool = OVERHEAD.cooldown / Math.max(0.2, ctx.attackRate ?? 1);
      if (ctx.onSwing) ctx.onSwing();
    }
    /**
     * THE CHARGE IS A PAUSE AT THE TOP OF THE WIND-UP, and that is the whole
     * mechanism — nothing here is a second attack or a second timer.
     *
     * `actHit` fires the swing on the PRESS, so a light overhead still starts
     * the instant the button goes down and nothing about it has changed. What
     * the hold does is PIN `swingT` at the end of the wind-up: the blade
     * reaches the top of the arc and stays there, chambered, for as long as
     * the button is down. Let go and the clock runs on into the cut.
     *
     * That is why a tap is still a tap and needs no second binding: a press
     * released inside CHARGE.hold never pins for long enough to clear the
     * threshold and `charged` comes out 0.
     *
     * `chargeLocked` exists because `charged` must be sampled ONCE, at the
     * release. Reading the live `charge` inside the envelope below would let a
     * swing keep growing after the cut had already started.
     */
    if (this.swingT >= 0 && !this.chargeLocked) {
      const held = input.act('attackOver') && this.charge < CHARGE.full && ctx.stamina > 0.12;
      if (held && this.swingT >= OVERHEAD.wind) {
        this.swingT = OVERHEAD.wind;
        this.charge = Math.min(this.charge + dt, CHARGE.full);
        // Winding costs, so a full charge is a decision and not a resting state.
        if (this.charge > CHARGE.hold && ctx.onStrain) ctx.onStrain(CHARGE.drain * dt);
      } else if (!held && this.swingT >= OVERHEAD.wind) {
        this.chargeLocked = true;
        this.charged = this.charge <= CHARGE.hold ? 0
          : (this.charge - CHARGE.hold) / Math.max(1e-4, CHARGE.full - CHARGE.hold);
      }
    }
    if (this.swingT >= 0) {
      this.swingT += dt;
      /* ONE ENVELOPE, SCALED — not a second table for the heavy. A charged
       * overhead is the same three phases with a taller arc and a longer cut,
       * so every phase boundary below is derived from OVERHEAD and the charge
       * rather than typed twice. `wind` grows too: a heavier blade takes
       * longer to get above your head, and that wind-up is the tell an enemy
       * duellist reads to chamber you. */
      const c = this.charged;
      /* `wind` is NOT scaled: the wind-up's length IS the hold, and scaling it
       * as well would make the blade re-chamber after the player had already
       * let go. The cut shortens, the recovery lengthens, and `dur` is rebuilt
       * from its three parts rather than multiplied, so every phase boundary
       * below lands exactly where the arithmetic puts it. */
      const cut = OVERHEAD.cut * (1 + (CHARGE.cut - 1) * c);
      const rec = (OVERHEAD.dur - OVERHEAD.wind - OVERHEAD.cut) * (1 + (CHARGE.rec - 1) * c);
      const T = c > 0
        ? { wind: OVERHEAD.wind, cut, dur: OVERHEAD.wind + cut + rec,
            rise: OVERHEAD.rise, drop: OVERHEAD.drop }
        : OVERHEAD;
      if (this.swingT >= T.dur) {
        this.swingT = -1; this.swing = 0;
        this.charge = 0; this.charged = 0; this.chargeLocked = false;
      }
      else {
        // wind up, cut through, recover. Three phases rather than one lerp
        // because the cut is the only part that has to be FAST: a snap straight
        // from the high pose to the low one peaks the blade at 7.9 m/s, which is
        // barely over the 7.5 m/s a RETURN wants.
        let arc;
        if (this.swingT < T.wind) arc = T.rise * smoothstep(0, T.wind, this.swingT);
        else if (this.swingT < T.wind + T.cut) {
          arc = lerp(T.rise, -T.drop, smoothstep(T.wind, T.wind + T.cut, this.swingT));
        } else arc = -T.drop * (1 - smoothstep(T.wind + T.cut, T.dur, this.swingT));
        this.swing = smoothstep(0, T.wind, this.swingT)
          * (1 - smoothstep(T.wind + T.cut, T.dur, this.swingT));
        // Clamp the OFFSET, never the result, so next frame's subtraction is
        // still exact — the flourish learned this the hard way.
        this._swY = clamp(this.gy + arc, -GY_MIN, GY_MAX) - this.gy;
      }
    } else this.swing = 0;

    /**
     * ── SPIN. The overhead's arc, turned on its side, with the body going
     * round with it.
     *
     * Everything structural here is the overhead's and deliberately so: three
     * phases, an additive offset taken back at the top of this function, the
     * offset clamped rather than the result. What differs is the axis (`_swX`,
     * not `_swY`), the side (latched, so the sweep cannot reverse mid-cut) and
     * `spinYaw` — the carrier turn that makes it a spin rather than a
     * horizontal slash, handed to the caller through `cam.yaw` the same way
     * every other camera contribution in this function is.
     *
     * Both attacks write different components of the same offset pair, so the
     * two CAN overlap — an overhead released during a spin is a diagonal, and
     * it falls out of the arithmetic rather than being a case.
     */
    this.spinCool = Math.max(0, this.spinCool - dt);
    this.spinYaw = 0;
    /* BOTH KEYS, because the two moves are one move now. `attackStab` is the
     * wheel-down half of the rose and the pad's D-pad down; whichever the
     * player reaches for they get the drill. There is no bare stab left to
     * reach — that is what "merge the spin and the stab together" asks for. */
    if ((input.actHit('attackSpin') || input.actHit('attackStab'))
        && this.spinT < 0 && this.spinCool <= 0 && ctx.stamina > 0.2) {
      this.spinT = 0;
      // Which way the body rolls. From the side the guard is already on, so the
      // first quarter-turn is the one your hands were already making.
      this.spinSide = this.gx >= 0 ? 1 : -1;
      this.spinCool = SPIN.cooldown / Math.max(0.2, ctx.attackRate ?? 1);
      if (ctx.onSwing) ctx.onSwing();
      if (ctx.onSpin) ctx.onSpin();
    }
    if (this.spinT >= 0) {
      this.spinT += dt;
      const T = SPIN;
      if (this.spinT >= T.dur) { this.spinT = -1; this.spin = 0; this._spinThrust = 0; }
      else {
        this.spin = smoothstep(0, T.wind, this.spinT)
          * (1 - smoothstep(T.wind + T.cut, T.dur, this.spinT));
        /**
         * THE BLADE GOES TO THE CENTRELINE AND STAYS THERE.
         *
         * This used to be the overhead's arc laid on its side — the guard swept
         * from one shoulder to the other while the body turned, which is a
         * windmill at arm's length and is what reached two of eighteen. A drill
         * holds the blade STILL relative to the body and lets the body do the
         * moving, so the point is at the leading edge of a metre and a half of
         * travel rather than orbiting a hip.
         *
         * `gx → 0` is the centreline and `_spY` levels the guard; the thrust
         * below is what pushes it out in front. Between them the blade is a
         * lance, which is the shape the note is describing.
         */
        this._swX = (0 - this.gx) * this.spin;
        /**
         * AND IT COMES DOWN TO BODY HEIGHT, which is the difference between a
         * spin that clears a crowd and one that whistles over its heads.
         *
         * The ready guard points the blade UP: measured, at rest the hilt sits
         * at 1.55 m and the tip at 2.19 m, so a sweep that leaves `gy` alone
         * passes entirely above a standing man. That is exactly what the old
         * spin did — driven into a ring of eighteen bodies at 1.4 m it crossed
         * ONE, the one it was already resting on.
         *
         * `SPIN.level` is what levels it. THE NUMBER IN THIS PARAGRAPH USED TO
         * BE −0.42 AND THE CONSTANT HAS BEEN 0.06 SINCE THE MOVE BECAME A
         * DRILL (3051e3f): the windmill needed the guard dropped nearly to the
         * floor because the blade was orbiting a hip, and a drill holds it out
         * in front where a small level offset is enough. Measured on the
         * shipped move, driven through a real Player: the blade's LOWEST point
         * runs 1.38–1.44 m over the player's feet through the revolution —
         * chest height on a 1.7 m body — and one pass crosses 18 of the 18
         * bodies standing round it. The claim the old number was making is
         * still true; the number making it is this one.
         *
         * It is still a LATERAL sweep and the numbers keep it one: 0.14 units
         * of drop against 2.0 units across.
         */
        this._spY = (clamp(-T.level, -GY_MIN, GY_MAX) - this.gy) * this.spin;
        /**
         * AND THE BLADE IS OUT FOR THE WHOLE MOVE — this is the STAB half of
         * the merge, and it is written as a HOLD rather than as a re-triggered
         * envelope. `thrustT` runs a rise/hold/fall of its own and re-firing it
         * every frame would pin it at the rise; the solver reads `thrust` and
         * `thrustGain`, so those are what the drill sets. The value follows the
         * spin's own envelope, so the arm extends as the turn begins and comes
         * back as it ends rather than snapping out and in.
         */
        this._spinThrust = this.spin;
        /* The turn is spent over the CUT and nowhere else — winding up and
         * recovering must not move the view, or a spin would read as a shove
         * on the mouse. `dt / T.cut` distributes the whole `yaw` across
         * exactly that window however long a frame is. */
        /**
         * THE TURN IS THE DIFFERENCE OF AN INTEGRAL, not a rate times dt.
         *
         * `dt / T.cut` looks equivalent and is not: the cut window is entered
         * and left on frame boundaries, so the number of frames inside it is
         * `ceil(cut/dt)` and the sum overshoots by up to one frame's worth.
         * Measured at 60 Hz with a 0.38 s cut, a "full revolution" came out at
         * 6.34 rad — a degree and a half of overspin, every time, in the same
         * direction. Differencing a curve that is 0 at the start of the cut and
         * 1 at the end totals exactly `yaw` at any frame rate.
         *
         * And the curve is a smoothstep rather than a ramp, which is the half
         * of this the player feels: a body winds into a turn and unwinds out of
         * it. A constant rate starts and stops the whole view instantly, which
         * is the same complaint as the one this attack is being rebuilt for,
         * one level up.
         */
        const k0 = smoothstep(T.wind, T.wind + T.cut, this.spinT - dt);
        const k1 = smoothstep(T.wind, T.wind + T.cut, this.spinT);
        /* THE BODY TURNS `turns` TIMES AND THE VIEW TAKES A THIRD OF IT.
         * `bodyYaw` is what `Player` rolls the trunk by; `spinYaw` is what
         * reaches the camera. Spending the whole revolution on the camera is
         * the thing the player called "just moves your camera", and it is also
         * what made the move impossible to aim: for a quarter of a second you
         * were looking at the sky. */
        const step = T.yaw * T.turns * (k1 - k0);
        this.bodyYaw = -this.spinSide * step;
        this.spinYaw = this.bodyYaw * T.viewShare;
      }
    } else { this.spin = 0; this._spinThrust = 0; this.bodyYaw = 0; }
    cam.yaw += this.spinYaw;

    /**
     * ── SLASH. The left button, and the attack the player presses most.
     *
     * Structurally the overhead's, deliberately: three phases, an additive
     * offset taken back at the top of this function, the offset clamped rather
     * than the result. What differs is that it moves in BOTH axes at once —
     * a descending diagonal, which is the cut a body makes when it means it —
     * and that the side alternates, so a mashed left button draws a figure
     * eight instead of the same stroke twice.
     *
     * The press ALSO opens the thrust envelope, from this one gate. See
     * SLASH's note: a cut that does not travel forward is a wave, and a step
     * that does not cut is what the player already had.
     */
    this.slashCool = Math.max(0, this.slashCool - dt);
    this.comboTimer = Math.max(0, this.comboTimer - dt);
    if (this.comboTimer <= 0 && !this.heavyArmed && this.slashT < 0) this.comboStep = 0;
    if (this.slashT >= 0) {
      this.slashT += dt;
      const T = this.isHeavy ? HEAVY : SLASH;
      if (this.slashT >= T.dur * (this.isHeavy ? 1 + this.heavyCharge * 0.5 : 1)) {
        this.slashT = -1; this.slash = 0; this.isHeavy = false;
      }
      else {
        /**
         * ONE PHASE PARAMETER DRIVES BOTH AXES, so the cut is a straight
         * diagonal in guard space rather than two arcs that happen to overlap.
         *
         * AND THE ARC IS ABSOLUTE WHERE THE OVERHEAD'S IS RELATIVE, which is
         * the one structural difference between them worth a paragraph. An
         * overhead ADDED to the guard is right: it chambers from wherever your
         * hands are and lands below wherever they were. A LATERAL cut cannot
         * be, because `GX_MAX` is 1.0 and the ready guard already sits at
         * +0.30 — measured, an offset arc of ±1.0 about that rest pinned `gx`
         * at the clamp for five frames of a twelve-frame cut and threw a THIRD
         * of the sweep away. That is CHARGE's own lesson arriving a second
         * time: a number that cannot move the thing it multiplies is a
         * comment.
         *
         * Both ends of the envelope interpolate back to the LIVE guard, so the
         * offset is exactly zero at the first and last frame and the cut hands
         * the guard back the way the overhead hands it back — a slash out of a
         * held zone lands in that zone.
         */
        const side = this.slashSide;
        /* THE CHARGE IS A FASTER CUT THROUGH THE SAME ARC, which is also what a
         * real wind-up buys: the blade is held chambered and when it goes the
         * same distance is covered in less time. `cut` shrinks and the recovery
         * grows, so everything downstream sees a blade that is genuinely moving
         * faster and nothing has to be told a charge happened. */
        const c = this.isHeavy ? this.heavyCharge : 0;
        const cut = T.cut * (1 + (HEAVY.cutScale - 1) * c);
        const rec = (T.dur - T.wind - T.cut) * (1 + (HEAVY.rec - 1) * c);
        const end = T.wind + cut + rec;
        let tx, ty;
        if (this.slashT < T.wind) {
          const k = smoothstep(0, T.wind, this.slashT);
          tx = lerp(this.gx, side * T.rise, k);
          ty = lerp(this.gy, T.lift, k);
        } else if (this.slashT < T.wind + cut) {
          const k = smoothstep(T.wind, T.wind + cut, this.slashT);
          tx = lerp(side * T.rise, -side * T.drop, k);
          ty = lerp(T.lift, -T.fall, k);
        } else {
          const k = smoothstep(T.wind + cut, end, this.slashT);
          tx = lerp(-side * T.drop, this.gx, k);
          ty = lerp(-T.fall, this.gy, k);
        }
        this.slash = smoothstep(0, T.wind, this.slashT)
          * (1 - smoothstep(T.wind + cut, end, this.slashT));
        this._slX = clamp(tx, -GX_MAX, GX_MAX) - this.gx;
        this._slY = clamp(ty, -GY_MIN, GY_MAX) - this.gy;
      }
    } else this.slash = 0;

    // gesture signal
    const gspeed = Math.hypot(dx, dy) / Math.max(dt, 1e-4);
    this.mouseSpeed.push(gspeed, dt);
    if (gspeed > 1) {
      this.gestureDir.set(dx, dy).normalize();
      const dot = this.gestureDir.dot(this.lastGestureDir);
      // a reversal releases commitment: this is what makes feints real
      if (dot < -0.15) this.commitment *= 0.35;
      this.lastGestureDir.copy(this.gestureDir);
    }
    this.mouseAccel.push(Math.hypot(input.accel.x, input.accel.y), dt);

    // ── THRUST. A genuine forward drive of the hands along the blade, run off a
    // rise/hold/fall envelope rather than a spike, because the hands are on a
    // spring that takes ~400 ms to arrive and a spike is gone before they do.
    this.thrustCooldown = Math.max(0, this.thrustCooldown - dt);
    // `attackStab` is the wheel-down half of the rose and reaches the same
    // envelope in every scheme — a stab is a stab, not a directional feature.
    // …and `thrust` in EVERY scheme, with no condition left on it: LMB attacks.
    /**
     * ONE GATE FOR THE LEFT BUTTON. `thrust` opens the slash AND the lunge on
     * the same press and on the same cooldown; `attackStab` — the wheel-down
     * half of the rose, and the pad's D-pad down — is still the bare stab it
     * always was, which is what keeps a fencing thrust available as its own
     * answer rather than only as an ingredient of the cut.
     *
     * The cooldown is written to BOTH clocks so the two cannot come apart: a
     * rate boon that shortened one and not the other would give the player a
     * press that steps without cutting, which is the exact defect this button
     * was reported for.
     */
    /**
     * ── THE SEQUENCE. Two lights and a held heavy.
     *
     * "obviously pressing it closely in succession will do like an attack
     * sequence of some sort, maybe like three clicks will be two light attacks
     * and then a heavy slash you can hold and release for more power idk"
     *
     * Presses 1 and 2 are the ordinary lateral cut, alternating side so the
     * pair draws a figure eight rather than the same stroke twice. Press 3
     * CHAMBERS instead of swinging: the blade goes up and stays there for as
     * long as the button is down, and the cut fires on RELEASE.
     *
     * The chamber is what makes this a decision rather than a rhythm. You are
     * standing still with the blade up and nothing between you and the line,
     * paying stamina, and the longer you stand the faster the blade goes when
     * it finally moves — which is the trade `HEAVY.cutScale` and `HEAVY.rec`
     * spell out.
     *
     * A HEAVY THAT IS NEVER RELEASED STILL GOES. `HEAVY.full` is the ceiling on
     * the charge and holding past it simply stops paying; the swing waits for
     * the button because a heavy that fired itself would be a heavy you cannot
     * feint with, and feinting a chambered blade is the whole reason to have
     * one.
     */
    const lmb = input.actHit('thrust');
    const lmbHeld = input.act('thrust');

    if (this.heavyArmed) {
      /* CHAMBERED. The guard is driven to the wind-up pose and held there —
       * this is the one attack state in the file with no clock on it. */
      if (lmbHeld && this.heavyHold < HEAVY.full && ctx.stamina > 0.12) {
        this.heavyHold += dt;
        if (this.heavyHold > HEAVY.hold && ctx.onStrain) ctx.onStrain(HEAVY.drain * dt);
      }
      this.heavyCharge = this.heavyHold <= HEAVY.hold ? 0
        : clamp((this.heavyHold - HEAVY.hold) / Math.max(1e-4, HEAVY.full - HEAVY.hold), 0, 1);
      /* The chamber pose, written as an offset exactly as the swing is, so the
       * blade is genuinely up rather than the animation pretending it is. */
      const k = smoothstep(0, HEAVY.wind, Math.min(this.heavyHold, HEAVY.wind));
      this._slX = clamp(lerp(this.gx, this.slashSide * -HEAVY.rise, k), -GX_MAX, GX_MAX) - this.gx;
      this._slY = clamp(lerp(this.gy, HEAVY.lift, k), -GY_MIN, GY_MAX) - this.gy;
      /* AND IT GOES ON RELEASE, or when the arm gives out. */
      if (!lmbHeld || ctx.stamina <= 0.12) {
        this.heavyArmed = false;
        this.isHeavy = true;
        this.slashT = 0;
        this.slashSide = -this.slashSide;
        this.slashCool = (SLASH.cooldown * 1.5) / Math.max(0.2, ctx.attackRate ?? 1);
        this.thrustT = 0;
        this.thrustStanding = (ctx.moving ?? this.carrierSpeed > THRUST_STANDING_SPEED) ? 0 : 1;
        this.thrustGain = HEAVY.reach;
        this.thrustCooldown = this.slashCool;
        this.comboStep = 0;
        this.comboTimer = 0;
        if (ctx.onSwing) ctx.onSwing();
        if (ctx.onThrust) ctx.onThrust();
      }
    } else if (lmb && this.slashCool <= 0 && this.thrustCooldown <= 0 && ctx.stamina > 0.12) {
      /* Advance the sequence if the window is open, otherwise start it again. */
      this.comboStep = this.comboTimer > 0 ? (this.comboStep + 1) % 3 : 0;
      this.comboTimer = SLASH.chain + SLASH.dur;
      if (this.comboStep === 2) {
        /* THE THIRD. Nothing swings yet — see the branch above. */
        this.heavyArmed = true;
        this.heavyHold = 0;
        this.heavyCharge = 0;
        if (ctx.onChamber) ctx.onChamber();
      } else {
        this.slashT = 0;
        this.isHeavy = false;
        // Alternate. The stroke you get is the opposite of the last one, so the
        // pair reads as a combination rather than as one animation replayed.
        this.slashSide = -this.slashSide;
        this.slashCool = SLASH.cooldown / Math.max(0.2, ctx.attackRate ?? 1);
        if (ctx.onSwing) ctx.onSwing();
      }
    }
    /* THE STEP DOES NOT FIRE ON THE PRESS THAT CHAMBERS. `lmb` used to open the
     * lunge unconditionally, so pressing the third of the sequence lunged
     * forward with the blade still going up and then lunged again on release —
     * two steps for one attack, which reads as the body stuttering. The heavy
     * opens its own thrust when it swings, with `HEAVY.reach` rather than
     * `SLASH.lunge`, which is the branch above. */
    const stabPressed = input.actHit('attackStab') || (lmb && !this.heavyArmed && !this.isHeavy);
    if (stabPressed && this.thrustCooldown <= 0 && ctx.stamina > 0.12) {
      this.thrustT = 0;
      // A lunge with no feet behind it has to come entirely out of the arms, so
      // it gets more of them. The controller works this out from how fast the
      // chest anchor it is handed each frame is actually travelling — a quarter
      // of walking pace, i.e. genuinely planted. Callers may say so explicitly
      // with ctx.moving, and Player now does: `_attackDrive` puts the trunk
      // behind an attack by MOVING THE ANCHOR, which this inference reads as the
      // body walking. Measured, a standing overhead drives the anchor at up to
      // 2.6 m/s, so a stab pressed shortly after one would have been graded a
      // moving lunge and given 40% less reach for standing still. The fallback
      // stays for every other caller and is unchanged.
      this.thrustStanding = (ctx.moving ?? this.carrierSpeed > THRUST_STANDING_SPEED) ? 0 : 1;
      // Latched at the press, like `thrustStanding` and for the same reason.
      this.thrustGain = lmb ? SLASH.lunge : 1;
      this.thrustCooldown = lmb
        ? SLASH.cooldown / Math.max(0.2, ctx.attackRate ?? 1)
        : 0.42;
      if (ctx.onThrust) ctx.onThrust();
    }
    if (this.thrustT >= 0) {
      this.thrustT += dt;
      const T = THRUST;
      if (this.thrustT < T.rise) this.thrust = smoothstep(0, T.rise, this.thrustT);
      else if (this.thrustT < T.rise + T.hold) this.thrust = 1;
      else {
        this.thrust = 1 - smoothstep(T.rise + T.hold, T.rise + T.hold + T.fall, this.thrustT);
        if (this.thrustT >= T.rise + T.hold + T.fall) { this.thrust = 0; this.thrustT = -1; }
      }
    } else this.thrust = 0;
    /* THE DRILL'S OWN EXTENSION, applied after the envelope so it cannot be
     * stamped on by a thrust that finished mid-spin. `Math.max` rather than an
     * assignment because a lunge that was already running into the spin should
     * not be cut short by it. */
    if (this._spinThrust > 0) {
      this.thrust = Math.max(this.thrust, this._spinThrust);
      this.thrustGain = Math.max(this.thrustGain, SPIN.reach);
    }

    /**
     * ── PUT THE ATTACK OFFSETS BACK ON, and this is the LAST thing the frame
     * does with the guard.
     *
     * It used to sit above the sequence block, which is one line short of the
     * heavy's chamber and is therefore one line short of correct: the chamber
     * writes `_slX`/`_slY` (the pose the blade is held in while the third press
     * is down) and it writes them BELOW the old position of this line. So the
     * chamber offset was never added — and the removal at the top of the NEXT
     * frame subtracted it anyway.
     *
     * That is not "the pose does nothing". It is a POSITIVE FEEDBACK LOOP. With
     * the chamber settled, `_slX = clamp(±1) - gx`, and subtracting that gives
     * `gx' = 2·gx ∓ 1` — the guard doubles every frame, and the recentre's own
     * 15%/frame pull leaves a net 1.7x. Measured through the real Player, one
     * press held:
     *
     *     0.26 s   |gx| 7.7e5        (the travel box is 1.0)
     *     1.01 s        4.2e26
     *     5.00 s        1.0e137
     *
     * `guardDir` takes sin/cos of that, so for as long as the heavy is
     * chambered the blade points somewhere different and meaningless every
     * frame, and `slashArc`/`slashAcross` hand the same magnitudes to
     * `Player._attackDrive`, which drives the trunk with them: at 0.9 s of hold
     * the blade tip reads 7.6e22 m above the player's feet at 2.0e25 m/s. The
     * third press of the game's own advertised sequence — "two light attacks
     * and then a heavy slash you can hold" — destroys the weapon.
     *
     * Every reader of the base guard between the removal at the top of this
     * function and here wants the guard WITHOUT the attack offsets on it (that
     * is what the removal is for), and both the slash envelope and the chamber
     * interpolate FROM the live guard, so both must be read before this runs.
     * One line, at the bottom, after every writer.
     */
    this.gx += this._swX + this._slX;
    this.gy += this._swY + this._slY + this._spY;

    return cam;
  }

  /* ── targets ───────────────────────────────────────────────────────── */

  solveTargets(chest, aimQuat, dt, trunk = chest) {
    const g = GRIPS[this.grip];
    this._grip = g;

    // A standing stab gets THRUST_REACH.standing times the reach of a moving
    // one; a moving one has a body behind it already.
    const reach = this.lunge * lerp(1, THRUST_REACH.standing, this.thrustStanding);
    const gd = this.guardDir(aimQuat, _v1);
    // In a lateral guard the guard point comes back IN to the hands' own radius.
    // What is then left between hands and guard is almost purely the sideways
    // offset applied below — which is the difference between a blade angled
    // across you (64 deg, what a bare lateral offset gives) and a bar laid
    // across you (85 deg). 5 cm of forward gap is all that is kept, and only so
    // the blade still has a direction to point in.
    const sAbs = Math.abs(this.stance);
    // Every length from here down is chest-to-hand, i.e. arm — see reachScale.
    const R = this.reachScale;
    const guardR = (lerp(g.guardR, g.handExtend + 0.05, sAbs) + reach * THRUST_REACH.guard) * R;
    const guardWorld = _v2.copy(chest).addScaledVector(gd, guardR);

    // hands: partway along the guard direction, offset into the body
    _v3.copy(g.offset).multiplyScalar(R).applyQuaternion(aimQuat);
    const handTarget = _v4.copy(chest).add(_v3)
      .addScaledVector(gd, (g.handExtend + reach * THRUST_REACH.hand) * R);

    // ── LATERAL GUARD. Split the hands off the guard ray in one direction and
    // the guard point in the other, about an axis perpendicular to both the
    // guard direction and world up. That is what lays the blade across the body
    // instead of along a spoke out of it: at |stance| = 1 the hilt sits on one
    // side of your centreline and the tip on the other.
    //
    // 0.30 m of hand and 0.34 m of guard is the whole travel. Bigger and the
    // arms cross the ribs; smaller and the blade is merely tilted, not laid
    // across — measured, |stance| = 1 puts the blade 8.5 deg off horizontal.
    if (sAbs > 0.001) {
      _v3.crossVectors(gd, UP);
      if (_v3.lengthSq() < 1e-6) _v3.set(1, 0, 0).applyQuaternion(aimQuat);
      _v3.normalize();
      handTarget.addScaledVector(_v3, -this.stance * 0.30 * R);
      guardWorld.addScaledVector(_v3, this.stance * 0.34 * R);
      // A guard across the body is carried level. Without this the hands' own
      // 20 cm drop below the guard point tilts the bar 17 deg, and the blade
      // rides up with whatever elevation the cursor happened to have.
      guardWorld.y = handTarget.y + (guardWorld.y - handTarget.y) * (1 - sAbs * 0.85);
    }

    /**
     * Never let the hands leave arm's reach — except that a lunge is exactly the
     * move where the shoulder and the torso add to the arm, so the ceiling
     * lifts with the thrust rather than clipping the one action that needs it.
     *
     * FROM THE TRUNK, NOT FROM THE ANCHOR, and that distinction only appeared
     * when the anchor left the sternum. This is an ARM LENGTH: the arm hangs off
     * a shoulder on the ribcage, so 0.78 m is 0.78 m from the CHEST and always
     * was — it merely used to be the same point as the anchor. Measured off the
     * anchor once the anchor is 0.36 m from the chest it becomes 1.14 m
     * of arm, and the two-bone IK answers the only way it can: it straightens,
     * points, and stops short. Measured, the STANDING STAB's hand travel — the
     * one move whose whole point is reach — fell from 45.2 cm to 33.3, and the
     * tip with it, while the guard target went on being placed somewhere no arm
     * could follow.
     *
     * `trunk` is the chest plus whatever the BODY has committed to the attack
     * (`Player._attackDrive`'s shift), and not the bare chest, because the note
     * above is literally true: a lunge is the move where the torso adds to the
     * arm, and the torso adds by travelling. Clamping to the bare chest takes
     * that back and costs the standing stab 0.8 cm of hand on the old anchor,
     * where nothing else about it changes.
     */
    _v5.subVectors(handTarget, trunk);
    const armMax = (0.78 + this.thrust * 0.10) * R;
    if (_v5.length() > armMax) { _v5.setLength(armMax); handTarget.copy(trunk).add(_v5); }

    this._handTarget = this._handTarget || new THREE.Vector3();
    this._handTarget.copy(handTarget);

    /**
     * THE WRIST ROLL, WHICH USED TO BE INVISIBLE.
     *
     * `this.roll` reached the blade as `_q2.setFromAxisAngle(dir, this.roll)`
     * below — a rotation of the blade ABOUT ITS OWN AXIS. The blade is a
     * cylinder. Rotating a cylinder about its own axis changes nothing that can
     * be seen, so the only thing that moved was the hilt in the hand and, with
     * it, the hands and forearms. Reported exactly that way: "the wrist roll
     * rotates the hands but not the blade."
     *
     * A wrist rolls about the FOREARM, which runs out from the body along the
     * aim, so that is the axis — and what it has to turn is the blade's whole
     * pose about the hand, guard point included. Turning the direction alone
     * would tilt the drawn blade while every zone, the guard rose and the
     * deflection tests went on describing a guard that was somewhere else; they
     * all read `guardWorld`, so `guardWorld` is what moves. The blade sweeps
     * round the aim axis like a clock hand and everything downstream agrees
     * with it.
     *
     * It is a different control from `gx/gy`, which walk the guard around a
     * sphere centred on the CHEST and carry the hands with it. This pivots
     * about the HANDS, which is the joint a wrist actually is.
     */
    if (Math.abs(this.roll) > 1e-4) {
      _vRoll.set(0, 0, -1).applyQuaternion(aimQuat);
      guardWorld.sub(handTarget).applyAxisAngle(_vRoll, this.roll).add(handTarget);
    }

    // blade direction: hands → guard point
    const dir = _v5.subVectors(guardWorld, handTarget);
    if (dir.lengthSq() < 1e-6) dir.copy(gd);
    dir.normalize();
    this._bladeDir = this._bladeDir || new THREE.Vector3();
    this._bladeDir.copy(dir);

    // orientation: +Y along the blade, rolled about it
    _q1.setFromUnitVectors(YAXIS, dir);
    _q2.setFromAxisAngle(dir, this.roll);
    this._targetQuat = this._targetQuat || new THREE.Quaternion();
    this._targetQuat.copy(_q2).multiply(_q1);
    return this._targetQuat;
  }

  /* ── integration ───────────────────────────────────────────────────── */

  update(dt, chest, aimQuat, ctx = {}) {
    // How fast the body carrying the blade is moving. Read here rather than
    // asked for, so a standing thrust is detected without every caller having
    // to remember to say so.
    this._prevChest = this._prevChest || new THREE.Vector3().copy(chest);
    if (dt > 1e-5) {
      const v = _v1.subVectors(chest, this._prevChest).length() / dt;
      this.carrierSpeed = damp(this.carrierSpeed ?? 0, v, 12, dt);
    }
    this._prevChest.copy(chest);
    /* THE ROSE IS CENTRED ON THE BODY, NOT ON THE WEAPON — see _publishGuard.
     * `chest` here is the anchor the blade is SOLVED from, which since the
     * anchor was unified is 0.32 m above the sternum and 0.20 in front of it.
     * A caller that knows where its body actually is says so. */
    this._publishGuard(ctx.body || chest, aimQuat);

    this.solveTargets(chest, aimQuat, dt, ctx.trunk || chest);
    if (!this.initialised) {
      this.handLocal.subVectors(this._handTarget, chest);
      this.handPos.copy(this._handTarget);
      this.quat.copy(this._targetQuat);
      this.initialised = true;
      return;
    }

    const g = this._grip;
    this.stamina = ctx.stamina ?? 1;
    this.flow = ctx.flow ?? 0;

    // Stamina and Flow change the weapon's character: a tired arm is heavy and
    // sloppy, a Jedi in Flow holds a line that does not waver.
    const fatigue = lerp(0.52, 1, smoothstep(0.02, 0.5, this.stamina));
    const focus = 1 + this.flow * 0.30;
    const riposte = ctx.riposte ? 1.42 : 1;

    let kP = g.kP * fatigue * focus * riposte * (ctx.stiffnessScale ?? 1);
    let kD = g.kD * lerp(1.12, 0.9, this.flow) * (ctx.dampingScale ?? 1);

    // Commitment: while the blade carries momentum in a direction, it resists
    // being redirected. That resistance is what gives a swing follow-through
    // and what makes a genuine feint cost something.
    const wLen = this.angVel.length();
    this.swingEnergy = damp(this.swingEnergy, wLen, 10, dt);
    quatToRotVec(_q1.copy(this._targetQuat).multiply(_q2.copy(this.quat).invert()), _v1);
    const errLen = _v1.length();
    if (wLen > 3.2 && errLen > 0.35) {
      const align = _v1.dot(this.angVel) / (errLen * wLen + 1e-6);
      const against = clamp(-align, 0, 1);
      this.commitment = damp(this.commitment, against * clamp(wLen / 16, 0, 1), 9, dt);
      kP *= lerp(1, 0.42, this.commitment);
    } else {
      this.commitment = damp(this.commitment, 0, 6, dt);
    }

    // angular spring–damper with inertia
    const invI = 1 / (g.inertia * (ctx.inertiaScale ?? 1));
    _v2.copy(_v1).multiplyScalar(kP * invI).addScaledVector(this.angVel, -kD);
    _v2.add(this.impulseAng);
    this.impulseAng.multiplyScalar(Math.max(0, 1 - dt * 14));

    this.angVel.addScaledVector(_v2, dt);
    const maxW = 42;
    if (this.angVel.lengthSq() > maxW * maxW) this.angVel.setLength(maxW);

    // integrate the quaternion
    _q1.set(this.angVel.x * dt * 0.5, this.angVel.y * dt * 0.5, this.angVel.z * dt * 0.5, 0).multiply(this.quat);
    this.quat.x += _q1.x; this.quat.y += _q1.y; this.quat.z += _q1.z; this.quat.w += _q1.w;
    this.quat.normalize();

    // Linear spring for the hands, solved in the chest's frame. handVel is
    // therefore a velocity *relative to the body* — which is also exactly what
    // the spine lean and the blade-lock push want to read.
    _v5.subVectors(this._handTarget, chest);
    _v3.subVectors(_v5, this.handLocal).multiplyScalar(g.lin * fatigue);
    _v3.addScaledVector(this.handVel, -g.linD);
    _v3.add(this.impulseLin);
    this.impulseLin.multiplyScalar(Math.max(0, 1 - dt * 12));
    this.handVel.addScaledVector(_v3, dt);
    if (this.handVel.lengthSq() > 900) this.handVel.setLength(30);
    this.handLocal.addScaledVector(this.handVel, dt);

    // keep the hands within reach of the chest no matter what hit them — and
    // within THIS chest's reach: a parry impulse that flings a human's hands
    // 0.86 m out would put a 0.66 m figure's fists past the end of its arms.
    const maxReach = 0.86 * this.reachScale, minReach = 0.16 * this.reachScale;
    const rl = this.handLocal.length();
    if (rl > maxReach) { this.handLocal.setLength(maxReach); this.handVel.multiplyScalar(0.5); }
    else if (rl < minReach) this.handLocal.setLength(minReach);
    this.handPos.copy(chest).add(this.handLocal);
  }

  /**
   * Republish the guard volume Bolts.update tests bolts against.
   *
   * Origin and aim frame are COPIED from the live body and the live aim every
   * frame, not captured once: the guard is yours, it walks with you and it turns
   * with you. (The auto-guard cone deliberately does the opposite — it stays
   * pointing down the line the bolt came in on, because its whole job is to
   * cover you while you look somewhere else. Two guards, two rules, and the
   * difference is the mechanic.)
   *
   * ── THE ORIGIN IS THE BODY AND NOT THE ANCHOR, AND THAT WAS A REAL BUG ────
   *
   * This used to be handed whatever `update` was handed, which is the point the
   * blade is SOLVED from. In third person that was the sternum and the two were
   * the same point; in first person it has always been ~0.32 m above the chest,
   * so the rose the bolt was classified on was centred a foot over the player's
   * head. Measured through the real Player, a level shot fired at each height up
   * a standing figure and asked of the player's own published guard
   * (tools/_unify.mjs):
   *
   *                      third person        first person
   *     1.62 m (eye)     any guard           any guard
   *     1.34 m (chest)   any guard           any guard
   *     1.15 m           any guard           any guard
   *     1.00 m (gut)     any guard           LOW, and only LOW
   *
   * Same shot, same shooter, and whether you had to be holding a particular
   * guard depended on which camera you were using. Unifying the anchor would
   * have exported that to third person as well, silently — every check in
   * tools/checks/directional.mjs builds its guard descriptor by hand with the
   * origin AT the chest, so nothing in the suite could have seen it move.
   *
   * The centre disc is the reason it has to be the body. `GUARD.centre` is 20°
   * because "a bolt that would actually hit your torso misses your CHEST by at
   * most ~0.4 m, so it arrives inside asin(0.4/1.4) = 16.6°" — an argument about
   * the body being shot at, which is false about any other point. Off an origin
   * 0.32 m above the sternum the same gut shot arrives at asin(0.72/1.4) = 31°
   * and falls in a quadrant.
   *
   * `radius` still measures the blade and is still right, and it was re-read
   * rather than assumed (`--radius`): settled at each of the four zone poses the
   * lit blade spans 0.52 m to 1.78 m from the chest in third person and 0.57 to
   * 1.81 in first, with its MIDPOINT at 1.09–1.24 in both. A sphere of 1.4 m
   * about the chest is therefore crossed by the weapon at every guard, which is
   * the whole claim the number makes. On the old chest anchor the same reading
   * is 0.30–1.58 m with the midpoint at 0.84–1.04, which is where the 0.84–1.07
   * in the GUARD note above came from; the blade is further out now, and 1.4 m
   * sits nearer the middle of its span than it did.
   *
   * `zoneTol` is the difficulty tier's share of your zone error, computed here
   * rather than in applyAssist because Player only calls applyAssist on tiers
   * whose assist is above zero — so Grandmaster would never have run the line
   * that sets it, and would have inherited whatever the last tier left behind.
   */
  _publishGuard(chest, aimQuat) {
    const g = this.guard;
    this.zoneTol = clamp(this.assist, 0, 1) * GUARD.tolerance;
    g.active = this.guarding;
    if (!g.active) { g.zone = ZONE.NONE; g.parry = false; return; }
    g.zone = this.zone;
    g.rose = ZONE_ROSE[this.zone] ?? 0;
    g.half = GUARD.sector + this.zoneTol;
    g.centre = GUARD.centre;
    g.reach = GUARD.reach;
    g.radius = GUARD.radius;
    // Scaled by the tier, so a parry is genuinely more forgiving on Padawan and
    // genuinely tighter on Grandmaster. `deflectWindow` was four authored
    // numbers with no reader anywhere in the tree — see parryScale, and the
    // note in Combat's DIFFICULTY. `parryWindow` is set by the Player from its
    // world's difficulty; 1 when nobody has said otherwise.
    g.parry = this.zoneParry && this.zoneAge <= PARRY.window * (this.parryWindow ?? 1);
    g.parryAge = this.zoneAge;
    g.origin.copy(chest);
    g.inv.copy(aimQuat).invert();
  }

  /** External impulse on the blade — a parry, a bind, a bolt landing on it. */
  hitImpulse(worldPoint, impulse, angScale = 1) {
    _v1.subVectors(worldPoint, this.handPos);
    _v2.crossVectors(_v1, impulse).multiplyScalar(9.5 * angScale);
    this.impulseAng.add(_v2);
    this.impulseLin.addScaledVector(impulse, 5.5);
    this.commitment = 0;
  }

  /** Shove the guard point itself — used when a blade is physically blocked. */
  displaceGuard(dx, dy) {
    this.gx = clamp(this.gx + dx, -GX_MAX, GX_MAX);
    this.gy = clamp(this.gy + dy, -GY_MIN, GY_MAX);
  }

  /**
   * Difficulty assist: bias the guard toward an incoming threat. At Grandmaster
   * this is zero and the blade is entirely yours.
   *
   * `this.assist` is the FRACTION OF THE GUARD ERROR CLOSED over one full
   * ASSIST_LEAD of approach. 0.92 means a bolt you had 0.9 s of warning about
   * arrives with 8% of your original aiming error left. That is a number you can
   * reason about and tune against the ±12.5 cm capture window, which the old
   * formula was not: it was `assist · urgency · clamp(dt·5.5, 0, 0.4)`, which at
   * Knight closed 26% of the error over a whole flight and at Master 6%. The
   * tiers all claimed to guide your guard and none of them did.
   *
   * Two things were wrong beyond the gain, and both inverted the feature:
   *
   *   • Threats were SCORED BY ALIGNMENT WITH THE GUARD YOU ALREADY HAD, then
   *     vetoed outright on `bestScore <= 0`. So the further your guard was from
   *     the bolt — the only situation where assist is worth anything — the less
   *     it did, and past 123° off it switched itself off completely.
   *   • The engagement gate was 12 m of DISTANCE, which is 0.40 s of warning at
   *     Padawan's 30 m/s but only 0.19 s at Grandmaster's 63 m/s. Difficulty
   *     was silently shortening the assist window on top of everything else.
   *
   * Selection is now by time-to-impact among threats that are actually in front
   * of you, and the gate is in seconds, so every tier gets the same warning and
   * the tier number alone decides how much of the work is done for you.
   */
  applyAssist(threats, chest, aimQuat, dt) {
    // Under DIRECTIONAL the tier's assist is spent on ZONE TOLERANCE instead —
    // it forgives the share of your zone error it advertises, in _publishGuard.
    // It must not ALSO drag the guard, or the tier would be paid twice and the
    // one thing the player is being asked to choose would be chosen for them.
    if (this.scheme === 'directional') return;
    if (this.assist <= 0.001 || !threats.length || dt <= 0) return;

    // Forward is the AIM direction, never the guard direction — a bolt coming
    // at your face is equally your problem whichever way the blade is pointing.
    _v4.set(0, 0, -1).applyQuaternion(aimQuat);
    let best = null, bestEta = Infinity;
    for (const t of threats) {
      if (!(t.eta >= 0) || t.eta > ASSIST_LEAD || t.eta >= bestEta) continue;
      _v2.subVectors(t.point, chest);
      const d = _v2.length();
      if (d < 0.4) continue;                       // already on top of you
      // A bolt that has gone past is not a threat, whatever its eta says.
      // threatsNear() already drops these, but the guard is one line and this
      // function should not be able to chase a receding bolt because a caller
      // handed it a stale list.
      if (t.bolt && t.bolt.vel && _v2.dot(t.bolt.vel) > 0) continue;
      _v2.multiplyScalar(1 / d);
      // Nothing behind the shoulder line: you cannot bring a guard there, and
      // dragging toward it would only pull you off the bolts you can answer.
      if (_v2.dot(_v4) < -0.17) continue;          // 100° half-cone
      bestEta = t.eta;
      best = _v5.copy(_v2);
    }
    if (!best) return;

    // convert the threat direction into guard coordinates
    _v3.copy(best).applyQuaternion(_q1.copy(aimQuat).invert());
    const yaw = Math.atan2(_v3.x, -_v3.z);
    const pitch = Math.asin(clamp(_v3.y, -1, 1));
    const tx = clamp(yaw / this.maxYaw, -GX_MAX, GX_MAX);
    const ty = clamp(pitch / this.maxPitch, -GY_MIN, GY_MAX);

    // Exponential approach expressed so that a full ASSIST_LEAD of it closes
    // exactly `assist` of the error, whatever the frame rate: compounding
    // (1 − k) over ASSIST_LEAD/dt frames returns (1 − assist) by construction.
    const k = 1 - Math.pow(1 - clamp(this.assist, 0, 0.999), dt / ASSIST_LEAD);
    this.gx = lerp(this.gx, tx, k);
    this.gy = lerp(this.gy, ty, k);
  }

  /** Read-out used by the HUD to draw the blade cursor. */
  screenGuard(camera, chest, aimQuat, out = new THREE.Vector2()) {
    const gd = this.guardDir(aimQuat, _v1);
    _v2.copy(chest).addScaledVector(gd, this._grip ? this._grip.guardR : 0.6);
    _v2.project(camera);
    return out.set(_v2.x, _v2.y);
  }
}
