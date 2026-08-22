/**
 * BATTLEFRONT BORZ — enemies.
 *
 * Everything here respects the same rules the player does: real limbs on a
 * real skeleton, real ragdolls, real cuts wherever the blade crossed. A droid
 * whose leg comes off falls over because it has no leg, not because it played
 * the falling-over animation.
 */

import * as THREE from 'three';
import { Actor } from './Ragdoll.js';
import { Rig, BipedAnimator, aimY } from './Rig.js';
import { applyBodyLod, undarken, L3_AT } from './Cohorts.js';
import { buildB1, buildB2, buildTrooper, buildAcolyte, buildDroideka, buildWalker, buildBeast, buildBlaster, plateGeo,
  buildJedi, bodyOptsFor, weakSpotsOf, coverSpotOf, SPECIES, HAIR_STYLES, BEARD_STYLES, ROBE_COLORS } from './Bodies.js';
import { Saber } from './Saber.js';
import { dropSaber } from './Dropped.js';
import { DuelBrain, Telegraph, FORMS, FORM_KEYS, TIER, ATTACKS, ATTACK_KEYS,
  DUEL_PHASES, guardQuat } from './Duel.js';
import { buildRemote } from './Dojo.js';
import { attachCloak, attachSkirt } from './Cloth.js';
import { LAYER, Body, capsuleSpheres, capsule } from '../physics/RapierWorld.js';
import { supportHeight, STEP_UP, GROUND_SNAP, CLIMB_RATE } from '../physics/Support.js';
import { TOUGHNESS, thinner, bladesTouching, aimAt } from './Combat.js';
import { seeThrough } from './Smoke.js';
import { segmentSegment } from '../physics/Physics.js';
import { BOLT_COLORS } from './Bolts.js';
/* The one weather every system reads — see its own note in Scenery.js. Used by
 * `aimQuality` and by nothing else in this file. */
import { weather } from '../world/Scenery.js';
import { clamp, lerp, damp, smoothstep, makeRng, TAU, dampVec } from '../engine/MathUtil.js';
import { MORALE } from './Morale.js';
/* THE HORDE'S HALF OF THE SAME LEDGER — FLAGSHIP §7's BREAK verb. A leaf, for
 * the reason Morale.js's own header gives: Command.js imports this file, so
 * anything this file imports may not reach Command. */
import { NERVE, nerveAim, nerveBroken, nerveRefusing } from './Nerve.js';
import { POWER_COST } from './Powers.js';
/* `findCasualty` and `startDrag` are NOT imported here: the drag is a
 * commander's decision and `CommandDirector.steer` is where it is taken. They
 * were on this line for a while and called by nothing in the file, which is the
 * dead field this session put back on the clone trooper for the opposite
 * reason — see `_maybeGrenade`. */
import { senseDanger, stepReaction, GRENADE } from './Reactions.js';
import { audio } from '../engine/Audio.js';

/**
 * The file's shared stream, seedable.
 *
 * Every enemy built in this process draws its speed, its facing, its first
 * attack timer, its strafe direction and its duel FORM from here, which is
 * right for the game — two waves should not play out identically — and is
 * exactly what makes a measurement of one enemy depend on how many enemies ran
 * before it. `tools/checks/held.mjs` measured a 1.77x ratio alone and a passing
 * one inside the full suite, on the same code, purely because the acolyte drew
 * a different form. A harness that wants the same duellist twice says so with
 * `enemyRng.seed(n)`; see `duelRng` in Duel.js, which is the same fix for the
 * same reason.
 */
export const enemyRng = makeRng(4711);
const rng = enemyRng;

/**
 * How fast a body gives ground, as a share of its forward speed. Sprinters
 * backpedal at roughly half their forward pace and fighters rather less, since
 * they are also keeping their guard up. At 1.0 — which is what this was, by
 * omission — an enemy retreated as fast as it charged, and that reads as
 * unnatural at any approach speed.
 */
const BACKPEDAL = 0.5;

/**
 * How much wider than the body a blade's contact is.
 *
 * A lightsaber's core is 3 cm and it burns rather than bruises, so touching a
 * body at all is a cut — but a hit test that demands the blade's centreline
 * come inside the torso's own radius misses every glancing pass and reads as
 * the blade going through you. The player's own solver takes the capsule
 * radius plus the blade's, and this is the same allowance for the one capsule
 * the player presents.
 */
const BLADE_BITE = 0.10;

/**
 * The same allowance as a MULTIPLE, for the capsules `capsules()` emits.
 *
 * It was the literal `1.12` sitting on one line, and it is now on two — the
 * bone's capsule and a weak point's — so it is named rather than copied. A gap
 * in a plate has to carry the same contact tolerance the plate does or it would
 * be harder to hit than the geometry it is a hole in, which is precisely
 * backwards.
 */
const CAP_BITE = 1.12;

/**
 * HOW FAR FROM THE BODY THE SHORT LIST OF STATIC BOXES IS GUARANTEED TO ANSWER.
 *
 * `supportHeight` has no spatial index and no reject of its own — it walks
 * every static box in the level and pays two quaternion rotations per box
 * before it looks at the distance (src/physics/Support.js:35-42), so a box
 * 400 m away costs exactly what one underfoot does. The PLAYER never paid
 * that: `Player._gatherNear` has built a short list once a frame for as long
 * as it has existed and hands that to the same function, which is why the
 * doc comment on `supportHeight`'s `boxes` parameter reads "pass a
 * pre-filtered short list if you have one". The enemies did not have one.
 *
 * Measured, headless, temple, 18 acolytes + the player, `high`: 51,061
 * static-box tests per frame — 212 sweeps of the level's 241-box array, ~11.7
 * per character, because the gait solver asks about the ground about eleven
 * times per character per frame (Rig.js `_normalAt` alone is four, plus the
 * plant, the slope probe and the swing aim). Cost, measured the one way that
 * changes no RESULT — padding the array with clones of the level's own
 * records displaced 400 m so only the LENGTH of the loop moves, 4 interleaved
 * rounds x 120 frames: 241 boxes 6.61 ms, 353 7.03, 477 8.57, 595 8.93, 900
 * 11.64. Linear, 7.63 us per extra box per frame, which attributes 1.84 ms of
 * `world.update` to the level's own 241.
 *
 * And the array GROWS as the level is fought in: cutting masonry converts a
 * monolithic structure into per-chunk static colliders, so four minutes of an
 * ordinary temple fight takes 241 to 377 with the player never cutting
 * anything deliberately. The cost is linear in that number, so the frame gets
 * worse the longer the session runs — which is the player's own first bug
 * report, quoted at src/engine/Profiler.js:7-9.
 *
 * The list below is gathered once a frame with one subtraction, one dot and
 * one compare per box, and the eleven gait queries then sweep the dozen boxes
 * it holds instead of the level's 241 — a median of 9 across five levels and
 * fifty-six bodies, 11 to 14 on the temple. Counted on the same fight, the
 * `boxTopAt` calls per frame go from ~46,700 to 2,646, and the marginal cost
 * of an extra static box from 7.63 us to 0.27.
 *
 * NEAR_REACH is the radius, measured from the point the list was gathered at,
 * inside which the short list is a provable SUPERSET of what the full array
 * would have contributed. A box can only raise the floor under (x, z) if its
 * bounding sphere reaches that column — `boxTopAt` clamps into the box and
 * rejects anything farther than the body's radius — so gathering at
 * `|centre - here| <= box.radius + bodyRadius + NEAR_REACH` catches every box
 * that any query within NEAR_REACH of `here` could possibly have used. A
 * query outside that disc falls back to the full array, so the optimisation
 * cannot be WRONG, only occasionally slow: `_groundAt` below carries that
 * guard, and tools/checks/gait-support.mjs drives every archetype on every
 * level and asserts zero divergence over ~700k real queries.
 *
 * 2.6 m is the reach `Player._gatherNear` has always used. Measured over
 * 312,706 real gait queries across five levels and thirteen archetypes the
 * farthest any of them asks from its own body is 2.102 m (a bodyguard's
 * planted foot mid-stride), median 0.209 — so the fallback is dead code in
 * practice and there for the day a stride, a scale or a new animator makes it
 * not be.
 */
const NEAR_REACH = 2.6;

/**
 * The broad phase's answer, borrowed for the length of one gather.
 *
 * Module scope and not per-body: `_gatherNear` fills it, sweeps it and is done
 * with it inside one call, so one array serves every body on the field and the
 * per-frame allocation it replaces was one array per body per gather.
 */
const _nearScratch = [];

/**
 * Slow the part of a desired velocity that points AWAY from `toTarget`, leaving
 * everything across that line alone. Exported because it is a numeric law and
 * numeric laws in this codebase get measured, not eyeballed: a sidestep must
 * keep its full pace while a retreat loses half of it, and the only way to know
 * that is still true is to assert it.
 */
export function limitBackpedal(vel, toTarget, factor = BACKPEDAL) {
  const away = -(vel.x * toTarget.x + vel.y * toTarget.y + vel.z * toTarget.z);
  if (away > 0) vel.addScaledVector(toTarget, away * (1 - factor));
  return vel;
}
const _v1 = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3();
const _v4 = new THREE.Vector3(), _v5 = new THREE.Vector3(), _v6 = new THREE.Vector3();
/* Where a suspended body's centre was LAST frame — see the held branch of
 * `_move`. Its own vector and not one of the six above: the line between the
 * two reads is `Ragdoll.centre`, and handing a shared scratch to a method that
 * may one day want one is the defect World.js's `_bolt4` note already paid for
 * once (5,585 of 13,320 fanned bolts changed their answer). */
const _wasAt = new THREE.Vector3();
const _v7 = new THREE.Vector3();

/** The object a rig's pose hangs off, or null. Used only by the hover lean. */
function rigRootOf(e) { return e.rig?.root || null; }
const _q1 = new THREE.Quaternion(), _q2 = new THREE.Quaternion();
const _m1 = new THREE.Matrix4();
/**
 * How far the wrist has to pitch DOWN for the bore to land on the aim.
 *
 * Not derivable from the -0.2 the weapon carries in `_build` alone, because
 * the hand bone has a rest orientation of its own that the basis below is
 * composed against. It is MEASURED: `tools/checks/characters.mjs` drives a
 * real trooper at a real target and asserts the angle between the bore and
 * the aim, so this number cannot drift without something saying so.
 * Shipped reading: 0.4 degrees, from 77.6.
 */
const WEAPON_PITCH = 0.26;
const _box = new THREE.Box3(), _box2 = new THREE.Box3();
/** The off-hand pose's own scratch — see _poseOffhand for why it needs it. */
const _o1 = new THREE.Vector3(), _o2 = new THREE.Vector3(), _o3 = new THREE.Vector3();
const _o4 = new THREE.Vector3(), _o5 = new THREE.Vector3(), _o6 = new THREE.Vector3();
const _o7 = new THREE.Vector3();
/** The closest point the blade came to a body this frame — see _saberStrike. */
const _hit = new THREE.Vector3();
/* Its own temp, so a stagger direction can be built inside damage() and
 * takeCut() without stepping on whatever _v1 was holding for the caller. */
const _stag = new THREE.Vector3();
/** `applyKnockback` scales the caller's impulse when the body resists it, and
 *  the caller's vector is usually somebody else's scratch — so it copies into
 *  its own rather than writing through a Player's `_v2`. */
const _res = new THREE.Vector3();
const _oq = new THREE.Quaternion();
/**
 * WHERE A BODY IS AIMED AT — its own scratch, because the callers below hold
 * the answer across a terrain raycast that borrows `_v1` and `_v2`.
 */
const _aim = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);
/** The pitch axis for a body already yawed to `facing` — see _poseWalker. */
const RIGHT = new THREE.Vector3(1, 0, 0);

let _enemyId = 1;

/* ══════════════════════════════════════════════════════════════════════ */
/*  What a large creature can do                                          */
/* ══════════════════════════════════════════════════════════════════════ */

/**
 * THE MOVE SET, AS DATA — and what each move demands of the player.
 *
 * "A wave of unique large creatures each fought differently." What shipped was
 * three creatures sharing one move set of three attacks, hard-coded as a ladder
 * of `if`s inside `_beastBrain`, so the ONLY axis two animals could differ on
 * was how fast they burned through the health that gates the phases. The
 * colosseum's own check said as much in its pass line: three fights of 5/14/10
 * seconds, which is one fight at three speeds.
 *
 * Every field below is read by `_beastBrain` and by `_poseWalker`, so a move
 * cannot exist in the brain without a wind-up on the body — which is the defect
 * this file already has a note about: "a sweep, a lunge and a charge were all
 * the same animal walking".
 *
 *   unlock   the phase (1/2/3 by health) at which the move enters the rotation.
 *   plant    seconds at the start during which the animal stops walking.
 *   drive    [from, to, accel] — the window it powers across ground in.
 *   aim      WHERE the blow lands, and this is the whole of the counter-play:
 *              'windup'  a point remembered at the top of the wind-up
 *              'drive'   re-read until the drive begins (`aimUntil`)
 *              'launch'  re-read until the leap begins, and it lands much later
 *              'self'    no remembered point at all: the animal's own feet
 *   hit      [from, to] — the window the blow resolves in, once.
 *   reach    the footprint radius, in multiples of the creature's `scale`.
 *   damage   a multiple of `attackDamage`.
 *   pose     what the body does: `rise` (signed, peak), `up` (seconds to it),
 *            `fall` (seconds back to rest, 0 = drops instantly), `pitch`
 *            (multiplier on rise, applied to the chest). See `_poseWalker` —
 *            the three shipped curves are reproduced by this exactly.
 *
 * The two new moves are new ANSWERS rather than new numbers. Measured, over
 * 90-second fights against a target evading four ways (tools/checks/beasts.mjs):
 *
 *              stand   strafe   dodge   retreat
 *   sweep      100%      0%       0%       0%     footwork, any direction
 *   lunge      100%      0%       0%       0%     footwork, any direction
 *   charge     100%      0%     100%       0%     break AT the commit
 *   SLAM       100%    100%     100%       0%     ONLY distance
 *   POUNCE     100%      0%      95%       0%     only a LATE break
 *
 * — which is the property the note asks for, stated as a table: a player who
 * has learned to circle a claw at knife range is caught by every slam, and a
 * player who has learned to break early on a telegraph is caught by every
 * pounce. Two creatures on the sand at once cannot be answered with one habit.
 *
 * ── AND EVERY ROW OF IT HAS TO HAVE A NUMBER UNDER 100%. The charge's row read
 * `100% 100% 100% 100%`, captioned "nothing: it commits and hits", and the gore
 * was the same blow with a tell on it — 100% at every speed a player can
 * produce, up to 30 m/s. An attack no input answers is not difficulty; it is
 * the 11.5 m sphere this whole table was written to replace, wearing the
 * telegraph of the thing that replaced it. The rule those two now obey, and the
 * only rule the shapes above are measured against, is that the interval between
 * the LAST aim update (`aimUntil`, or the top of the wind-up) and the resolve
 * (`hit[0]`) has to be long enough for movement the player actually has to
 * carry them out of `reach × scale` — walk 4.6 m/s, sprint 7.45, dash 15.5 for
 * 0.24 s. `tools/checks/dodgeable.mjs` derives that from this table, from the
 * archetypes that own each move, and from a real Player it drives to find those
 * three paces; it does not transcribe any of them.
 */
export const BEAST_MOVES = {
  lunge: {
    unlock: 1, aim: 'windup', drive: [0, 0.5, 42], hit: [0.5, 0.85], done: 0.85,
    reach: 0.75, damage: 1.0, lift: 0.5,
    // the crouch is the tell: it gathers, then drives
    pose: { rise: -0.55, up: 0.5, fall: 0, pitch: -0.30 },
  },
  sweep: {
    unlock: 2, aim: 'windup', hit: [0.55, 0.95], done: 1.15,
    reach: 1.15, damage: 0.85, lift: 0.9,
    pose: { rise: 1.0, up: 0.55, fall: 0.30, pitch: -0.42 },
  },
  /**
   * THE CHARGE — and it used to resolve on the frame it aimed.
   *
   * `aimUntil: 0.65` beside `hit: [0.65, …]` is a ZERO-SECOND window: the point
   * is fixed and the horn arrives on the same frame, so there is no interval in
   * which any movement can carry a body out of a 2.04 m footprint. Measured
   * end to end through `_beastBrain` against a target breaking away on the
   * first frame of the wind-up: 100% at every speed from a standstill to
   * 30 m/s. The table above described that as "nothing: it commits and hits",
   * which is a defect with a caption on it — the game draws a plant, a roar,
   * a body wind-up and a floating CHARGE for a blow no input answers.
   *
   * The re-aim is the point of the move and it is KEPT: run away during the
   * telegraph and the charge simply follows you, which is what makes it the
   * answer to a runner and not a second claw. What it has now is half a second
   * between the commit and the impact — the horn lands when the RUN arrives,
   * about 3.7 m into the drive, instead of 0.18 m into it, so the moment the
   * animal reaches you is also the moment it hurts you. A player who breaks
   * when the drive begins clears the footprint at a walk; one who broke early
   * and stopped is exactly who it is for. See `tools/checks/dodgeable.mjs`.
   */
  charge: {
    unlock: 3, aim: 'drive', aimUntil: 0.65, plant: 0.65,
    drive: [0.65, 1.9, 30], dust: true, hit: [1.15, 1.9], done: 1.9,
    reach: 0.85, damage: 1.3, lift: 0.8, roar: 0.9, call: 'CHARGE',
    pose: { rise: 0.7, up: 0.65, fall: 0.35, pitch: -0.34 },
  },

  /**
   * THE SLAM — both forelimbs into the ground, and the ground answers.
   *
   * `aim: 'self'` is the entire design. Every other attack in the file asks
   * "were you where I swung", which a sidestep answers; this one asks "were you
   * NEAR ME", which a sidestep does not. The reach is 2.05 of scale — 7.0 m on
   * a 3.4-scale brute — which is wider than its own engagement band, so the
   * only way out of it is out. A 0.95 s wind-up is the longest in the file and
   * it has to be: at a sprint that is about eight metres of ground, and an
   * escape that is not achievable is not an escape.
   *
   * `unlock: 1`, AND THE ARCHETYPE ALREADY SAID SO. src/game/Levels.js states
   * it in its own words — "`slam` unlocks at phase 1 — it is not a reward for
   * hurting the animal, it is the first thing it does and the thing the player
   * has to learn" — and this line said 2, so a Rancor at full health declared
   * 10 lunges and zero slams over 30 s. The move the whole archetype is built
   * around could not be seen until a third of a 2200 hp animal was gone.
   */
  slam: {
    unlock: 1, aim: 'self', plant: 0.95, hit: [0.95, 1.15], done: 1.7,
    reach: 2.05, damage: 1.15, lift: 1.5, shake: 1.0, roar: 1.1, quake: true,
    call: 'SLAM', callColor: '#ffb03a',
    // rears its whole front end up, then throws it down — the biggest travel
    // any of these put on the chest, because it is the one you have to read
    // from further away than a claw.
    pose: { rise: 1.5, up: 0.95, fall: 0.14, pitch: -0.55 },
  },

  /**
   * ── THE FIVE VERBS THE BODY PLANS ADDED ──────────────────────────────
   *
   * "They all attack the same way", and the table said so: of the five
   * creatures, THREE (the acklay, the reek, the nexu) declared no move set at
   * all and took `DEFAULT_BEAST_MOVES` — the same lunge, sweep and charge —
   * and the other two shared `lunge` with them. Five animals, three verbs,
   * one of them on all five.
   *
   * Each of the five below is a verb some ANATOMY affords, which is why they
   * are declared beside the body plan that performs them (CREATURE_PLANS in
   * src/game/Bodies.js) rather than beside the health bar:
   *
   *   GORE     a metre of horn carried in front of the eyes, driven at you in
   *            a committed run. Like the charge it aims when the drive
   *            begins, so running does not answer it; unlike the charge it
   *            drops its head first, which is a tell you can read from behind.
   *   TOSS     the same horn hooking UNDER you. The only attack in the game
   *            whose answer to "I am in front of it" is height rather than
   *            damage: `lift` 2.4 against everything else's 0.5–1.5, so the
   *            impulse is almost vertical and where you land is your problem.
   *   RAKE     a cat's forepaw, twice. The shortest wind-up in the file at
   *            0.32 s against the sweep's 0.55, for two thirds of the damage:
   *            what makes it dangerous is that it arrives before you have
   *            finished reading it, and it comes round again fastest.
   *   STAB     a spindly foreleg driven out from 3.8 m — further than
   *            anything else can reach and further than the player's own
   *            blade, which is the acklay's whole problem statement.
   *   SNATCH   mandibles closing and DRAGGING. `pull` makes the impulse point
   *            at the animal instead of away from it, and it is the only one
   *            in the file that does: every other blow in the game solves the
   *            player's problem by putting distance between you.
   */
  /**
   * THE GORE — sold as the answerable one, and it was not.
   *
   * `aimUntil: 0.5` against `hit: [0.6, …]` left a tenth of a second to leave a
   * 2.16 m footprint: 21.6 m/s of sustained movement, where the player's walk
   * is 4.6, the sprint 7.45 and the dash 15.5 for a quarter of a second.
   * Measured through `_beastBrain` against a target breaking away on the first
   * frame of the wind-up, it landed 100% at 0, 4.6, 7.45, 11 and 15.5 m/s —
   * and a Reek dealt the SAME 18.73 hp/s to a stationary, a retreating, a
   * strafing and a dashing player, to two decimals. Gore is the Reek's only
   * phase-1 move, so it is the first thing a Colosseum player ever meets.
   *
   * The tell was never the problem: the head drops, the body goes low, a roar
   * plays and GORE floats over it. What was missing is the INTERVAL the tell is
   * advertising. The impact is at 1.0 s now — half a second after the aim is
   * fixed, half a second into a 36 m/s² run — so the horn arrives with the
   * animal instead of before it has moved, and the half second is walkable.
   */
  gore: {
    unlock: 1, aim: 'drive', aimUntil: 0.5, plant: 0.5,
    drive: [0.5, 1.5, 36], dust: true, hit: [1.0, 1.5], done: 1.6,
    reach: 0.9, damage: 1.35, lift: 1.0, roar: 1.0, call: 'GORE', callColor: '#ff8a3a',
    // head DOWN and body low through the wind-up, then it runs
    pose: { rise: -0.70, up: 0.50, fall: 0.45, pitch: -0.72 },
  },
  toss: {
    /* Phase 1 beside the gore. The Reek's whole first phase was ONE move on a
     * 2.4 s loop — measured, 11 gores and nothing else over 30 s at full health
     * — and phase 1 is the longest phase of the fight. The pair is chosen for
     * having different answers rather than for filling a slot: the gore fixes
     * its aim when the drive begins, so it is answered by breaking AT the
     * commit, and the toss fixes its aim at the top of the wind-up, so it is
     * answered by footwork DURING the telegraph. Two verbs, two moments. */
    unlock: 1, aim: 'windup', plant: 0.35, hit: [0.70, 1.00], done: 1.35,
    reach: 1.00, damage: 0.85, lift: 2.4, shake: 1.1, roar: 0.85,
    call: 'TOSS', callColor: '#ffd24a',
    // hooks upward: the longest rise of anything that is not the slam
    pose: { rise: 1.25, up: 0.70, fall: 0.16, pitch: -0.50 },
  },
  rake: {
    unlock: 1, aim: 'windup', plant: 0.18, hit: [0.32, 0.55], done: 0.75,
    reach: 0.72, damage: 0.62, lift: 0.35,
    /* It DROPS rather than rears, which is a cat gathering its shoulders, and
     * it has to: a rake that rose would be the charge's curve at 6/7 the
     * height — measured 79 mm apart at their widest against the 80 the wind-up
     * check requires, which is two attacks with one telegraph. */
    pose: { rise: -0.45, up: 0.32, fall: 0.10, pitch: -0.33 },
  },
  stab: {
    unlock: 1, aim: 'windup', plant: 0.30, hit: [0.62, 0.85], done: 1.05,
    reach: 1.30, damage: 1.10, lift: 0.5, roar: 0.7, call: 'STAB', callColor: '#8affc4',
    /* Short and early: the body gathers, drops back to rest, and THEN the leg
     * goes out. Against the sweep's slow full rear over the same window the
     * two were 75 mm apart, and a spear that looks like a claw is not a
     * different attack. */
    pose: { rise: 0.55, up: 0.40, fall: 0.10, pitch: -0.26 },
  },
  snatch: {
    /* Phase 1 beside the stab, for the reason the toss is: the Acklay declared
     * 11 stabs and nothing else over 30 s at full health. The pair is a RANGE
     * pair rather than a timing one — the stab reaches 3.77 m, further than the
     * player's own blade, and the snatch reaches 2.32 m and DRAGS you in, so
     * the two want opposite standing distances and the animal punishes whichever
     * one you have settled into. The sweep is still what phase 2 buys. */
    unlock: 1, aim: 'windup', plant: 0.45, hit: [0.68, 0.92], done: 1.20,
    reach: 0.80, damage: 1.25, lift: 0.25, pull: true, shake: 0.9, roar: 0.8,
    call: 'SNATCH', callColor: '#ff6a52',
    // ducks, then throws the head forward — the mirror of the toss
    pose: { rise: -0.95, up: 0.45, fall: 0.22, pitch: 0.34 },
  },

  /**
   * THE POUNCE — twelve metres, off the ground, and it commits at the LAUNCH.
   *
   * The charge answers a runner by re-aiming until its drive begins. The pounce
   * commits its landing point as it gathers to leave the ground and does not
   * arrive until 0.95, so the window is at the END of the telegraph rather than
   * the beginning: a player who breaks on the first frame of the wind-up has
   * been standing still again by the time this lands.
   *
   * THE COMMIT IS AT 0.50 AND NOT 0.55, which is 50 ms and the difference
   * between a window and a claim of one. At 0.55 the interval was 0.40 s — 1.84 m
   * of walking against the Gundark's own 2.00 m footprint — so the late break
   * this move exists to teach only worked at a sprint, while the note here said
   * a window existed. It is 0.45 s now, which a walk clears with 7 cm to spare
   * and a sprint clears by half again. Measured in `tools/checks/dodgeable.mjs`
   * against the real player pace, not asserted here.
   */
  pounce: {
    unlock: 1, aim: 'launch', aimUntil: 0.50, plant: 0.55,
    drive: [0.55, 0.95, 58], hit: [0.95, 1.15], done: 1.45,
    reach: 1.0, damage: 1.25, lift: 1.1, roar: 0.8, call: 'POUNCE', callColor: '#ff9a3a',
    // coils right down, then extends: the deepest crouch of any of them
    pose: { rise: -0.9, up: 0.55, fall: 0.30, pitch: -0.42 },
  },
};

/** What a creature with neither a declared set nor a body plan can do. */
export const DEFAULT_BEAST_MOVES = ['lunge', 'sweep', 'charge'];

/**
 * WHICH ATTACKS THIS CREATURE HAS — one function, and everything calls it.
 *
 * There are two authorities and they are ordered, not merged:
 *
 *   1. the ARCHETYPE. `A.moves` is a level designer saying what this creature
 *      does; the rancor's slam and the gundark's pounce are argued for in
 *      src/game/Levels.js and win here.
 *   2. the BODY PLAN. A creature that declares none gets the verbs its
 *      ANATOMY affords — `built.moves`, off CREATURE_PLANS in
 *      src/game/Bodies.js, beside the horns and the mandibles that make them
 *      possible. That is how the reek, the nexu and the acklay stop sharing
 *      one move set without their archetypes being touched.
 *
 * `DEFAULT_BEAST_MOVES` is the floor under both, and after this pass nothing
 * in the shipped roster reaches it.
 *
 * It is exported because the checks need the same answer the brain gets, and
 * a check that recomputes `A.moves || DEFAULT` is HANDOFF §2.4's defect:
 * tools/checks/beasts.mjs and tools/checks/colosseum.mjs both had that line,
 * and both would have gone on measuring the move set the creatures used to
 * have. They call this instead.
 */
export function beastMoveSet(A, built = null) {
  return (A && A.moves) || (built && built.moves) || DEFAULT_BEAST_MOVES;
}

/* ══════════════════════════════════════════════════════════════════════ */
/*  The Jedi                                                              */
/* ══════════════════════════════════════════════════════════════════════ */

/**
 * A FACE, A SPECIES AND A HAIRCUT, DRAWN PER BODY.
 *
 * The level called "the Jedi Temple" was garrisoned by Sith. Not as a
 * placeholder with a note on it — Levels.js said so in its own header: "this
 * game has exactly one sabered humanoid archetype, `acolyte`, and no Jedi
 * body". Measured on the shipped pool: five of the temple's eight pool slots
 * are `acolyte`, and over waves 1-12 on a seeded director 32 of 115 spawned
 * bodies are Sith acolytes and ZERO are Jedi, because zero Jedi exist.
 *
 * The body is `buildJedi` — the one the PLAYER is built from — and that is the
 * whole argument for it rather than a recoloured acolyte. The two silhouettes
 * were authored against each other and the acolyte's own comment says so:
 * "these two and the Jedi share one skeleton and one standing height, so the
 * only thing that can separate them at range is mass distribution: the acolyte
 * is narrow through the chest and the limbs and carries all of its width low,
 * in a coat that flares to 46 cm at the hem." A Jedi is the other half of that
 * sentence — square through the shoulders, layered tabards over an under-robe,
 * a bare face with hair on it, and no hood at all. Recolouring the acolyte
 * would have produced a Sith in beige.
 *
 * AND EVERY ONE OF THEM IS A DIFFERENT PERSON. buildJedi already takes the
 * whole character sheet the creator screen drives — species, face preset,
 * frame, muscle, years, cut, beard, robe — so a hall of Jedi costs nothing
 * extra to make individual, and a hall of identical Jedi would read as one
 * asset stamped eight times. Everything below is drawn from `enemyRng`, which
 * means `enemyRng.seed(n)` reproduces the same eight faces: a harness that
 * measures a garrison gets the same garrison twice.
 *
 * WHAT IS DELIBERATELY NOT DRAWN: the robe is `dark`-weighted rather than
 * uniform, because a temple full of ivory robes against cream stone is a
 * legibility problem before it is an aesthetic one — the level's own dressing
 * note calls the hall "cream stone, and a cold city haze". Ash, Umber and
 * Night are 60% of the draw so a body reads against the wall behind it.
 */
const JEDI_ROBES = [1, 2, 4, 0, 5, 3];      // umber, ash, night first; ivory last
function jediLook(seed = null) {
  const r = seed || rng;
  const pick = (a) => a[Math.floor(r() * a.length)];
  return {
    species: pick(SPECIES).id,
    // The robe draw is weighted toward the dark end by the ORDER of the list
    // above plus a squared roll, which puts 58% of bodies in the first three.
    robeIndex: JEDI_ROBES[Math.floor(r() * r() * JEDI_ROBES.length)],
    hair: pick(HAIR_STYLES).id,
    beard: pick(BEARD_STYLES).id,
    age: r() * r(),                          // most of an order is not old
    build: 0.5 + (r() - 0.5) * 0.7,
    muscle: 0.35 + r() * 0.5,
    face: { preset: null },
  };
}

/**
 * WHAT MAKES FOUR JEDI FOUR FIGHTS: the forms, which already existed.
 *
 * `FORMS` in Duel.js has five entries and they are genuinely distinct — that is
 * measured, not asserted. Every attack carries a TIER, and the tier is the
 * whole of the counter-play: `light` is parryable, `heavy` must be chambered or
 * evaded, `unblockable` must be evaded. Run each form's `moves` list through
 * `ATTACKS[k].tier`:
 *
 *   Makashi  5 light of 5           100% parryable, aggression 0.9,  chain 1-2
 *   Soresu   3 light of 3           100% parryable, aggression 0.42, chain 1-2
 *   Ataru    4 light + 1 heavy       80% parryable, aggression 1.3,  chain 2-4
 *   Juyo     2 light of 6            33% parryable, aggression 1.15, chain 1-3
 *   Djem So  3 heavy + 1 unblockable  0% parryable, aggression 0.7,  chain 1-1
 *
 * And NOTHING IN THE GAME USED THEM ON PURPOSE. `DuelBrain`'s constructor takes
 * `opts.form` and `Enemy._build` passes `A.form || FORM_KEYS[floor(rng() * 5)]`
 * — and measured across the whole roster, 0 of 14 archetypes declared a `form`.
 * Every duellist in every level rolled a die. So the player could not learn
 * "that is Djem So, it commits hard, punish the recovery", which is the exact
 * sentence Duel.js's own header says the system exists to make true: the same
 * body wearing the same robe fought a different way every time it spawned.
 *
 * The four Jedi below each DECLARE a form, and the four are chosen to span the
 * axis that matters — what answers them:
 *
 *   SENTINEL   Soresu.  Gives you nothing and waits. `defensive: 1.7` and
 *              aggression 0.42, so it will not walk onto your blade; every
 *              opening it gives you it gives you on purpose, and its
 *              `punishRecovery: 1.0` is the highest in the table. The answer is
 *              patience — bait a swing, then take the recovery.
 *   KNIGHT     Ataru.  Flurries of two to four, `mobile: true` (which
 *              `_moveMelee` reads as a 1.9x circling term), the shortest
 *              wind-up in the game at 0.24 s. The answer is to hold a parry
 *              rhythm through a chain instead of trading one for one.
 *   GUARDIAN   Djem So. 0% parryable. A parry-shaped answer does not exist for
 *              this one at all — the guard breaks at 1.9-3.2 — and the 0.58 s
 *              recovery is the longest window the roster offers. The answer is
 *              footwork and the counter-swing, and it is the temple's teacher
 *              for both.
 *   MASTER     Makashi. 100% parryable, and that is not a weakness: `feint`
 *              0.30 and `punishRecovery` 0.85 mean it is reading YOU, and the
 *              thrust arrives the moment you overcommit. The answer is to stop
 *              swinging first.
 *
 * Juyo is left to the Sith acolyte, which still draws at random. That is a
 * statement rather than an omission — the erratic form is the one whose header
 * says "the rhythm is the trap".
 *
 * THE BLADES. Cerulean, Verdant and Amethyst are the three the order is drawn
 * with, and Gold is the crystal SABER_COLORS itself annotates as "the Temple
 * Guard yellow" — the only slot on the rack authored for a body that did not
 * exist until now. Against `acolyte`'s Crimson (index 4, flagged `dark`) the
 * separation is the point: in a hall where both sides carry a blade, the blade
 * IS the identification, and a player must never have to read a face to know
 * which way to swing.
 */
const JEDI_BASE = {
  toughness: TOUGHNESS.flesh, melee: true, saber: true,
  hipHeight: 0.95, jedi: true,
  /**
   * NO SIMULATED SKIRT — WRITTEN DOWN, because until this line the flag had NO
   * WRITER AT ALL.
   *
   * `grep -rn simSkirt src/ tools/` returned exactly ONE line, the reader in
   * `_build`, so `A.simSkirt` was `undefined` for all 31 archetypes and the
   * `attachSkirt` branch on the enemy path was unreachable code that read as a
   * feature. A flag whose only possible value is `undefined` is HANDOFF 2.3's
   * close relative: an omission wearing a decision's clothes. These four are
   * the only bodies that publish a `robeSkirt` for it to act on, so this is
   * where the decision belongs.
   *
   * AND IT IS `false` ON A MEASUREMENT, not on caution. Measured on a built
   * Master: the simulated skirt is 970 links against a cape's 300 — 3.2 capes
   * on one body, and 66% of the PLAYER's entire four-garment set. Engine.js
   * sizes `QUALITY.cloth` on "every enemy wearing exactly one cape" and
   * `cloth-cost.mjs` holds every archetype to `g.n === 1` in a census that
   * counts the skirt's two sash straps as garments of their own — so a
   * simulated skirt is structurally THREE by that count and no body can carry
   * one while that assertion stands, whatever the body is.
   *
   * Turning it on is therefore a cloth-budget decision and not a costume one.
   * The Master is the candidate — `setPieceOnly`, one per level, gated the way
   * the warship's general is, capeless like every Jedi here, and the body the
   * player spends longest looking at — and it needs exactly two lines: this
   * field to `true` on the master's own row, and `cloth-cost.mjs` counting a
   * GARMENT rather than a cloth object.
   */
  simSkirt: false,
  /* NO CAPE. A Jedi takes the outer robe off to fight, which is both the image
   * the source material is most consistent about and the thing that separates
   * these four from the hooded, caped acolyte at silhouette range — and it is
   * what keeps the cloth column sized the way Engine.js says it is. See the
   * long note at the `A.cape` gate in `_build`. */
  cape: false,
};

/* ── archetypes ──────────────────────────────────────────────────────── */

export const ARCHETYPES = {
  b1: {
    label: 'B1 Battle Droid', build: buildB1, scale: 1.02, hp: 28, mass: 52,
    speed: 3.5, toughness: TOUGHNESS.droid, ranged: true, weapon: 'e5',
    fireRate: 1.5, burst: 3, burstGap: 0.13, spread: 0.075, damage: 9,
    preferred: [7, 15], boltColor: BOLT_COLORS.red, score: 100, threat: 1,
    hipHeight: 0.96,
  },
  b2: {
    label: 'B2 Super Battle Droid', build: buildB2, scale: 1.18, hp: 96, mass: 130,
    speed: 2.6, toughness: TOUGHNESS.armour, ranged: true, weapon: null,
    fireRate: 1.9, burst: 4, burstGap: 0.1, spread: 0.05, damage: 13,
    preferred: [6, 13], boltColor: BOLT_COLORS.red, score: 300, threat: 3,
    /* THE WRIST LAUNCHER, which is the B2's one piece of source-material kit
     * and the reason it is the droid line's grenadier rather than the B1: a
     * wave with nobody in it who can throw one is a wave your troops never
     * have to react to, and the reactions in src/game/Reactions.js are a
     * feature of the ARMY rather than of the clones. Its `threat` of 3 divides
     * `GRENADE_SPREAD` into a wide throw — see `_maybeGrenade` — so a droid
     * lands one near you and a clone veteran lands one on you. */
    grenades: true,
    armored: true, hipHeight: 1.1,
  },
  /**
   * THE THIRD BODY CLASS — FLAGSHIP §6's CONSCRIPT.
   *
   * "6 hp, 1.4 dps, one pass, worth 0 score and 0 Insight. The lawnmower is
   * only a lawnmower when mowing pays. Forty conscripts that pay nothing are
   * weather."
   *
   * The roster had two classes of body and no third: something you fight (a
   * B1, 28 hp, worth 100) and something you fight harder (a B2, 96 hp, worth
   * 300). Both PAY, so a hundred of either is a hundred rewards and the honest
   * player answer to a crowd is to mow it. §7's four verbs all describe things
   * you do INSTEAD of killing everything, and none of them can compete with a
   * body that hands you score for walking through it.
   *
   * So this one hands you nothing at all. `score: 0` is not a small number, it
   * is the whole design: `World.onEnemyKilled` derives the entire payout —
   * score, flow, combo and war support — off `score > 0`, so a conscript is
   * the one thing on the field that killing does not advance. What it can
   * still do is stand between you and somewhere, shoot at you while you are
   * busy, and cost your guard a bolt at a time. It is TERRAIN with legs, which
   * is the same sentence §6 makes about volume of fire.
   *
   * WHY IT IS A DROID AND WHY IT IS THIS ONE. The Databank's own line about
   * the Confederacy is "it does not lose a droid, it spends one" — a conscript
   * is the cheapest thing it spends. Built on `buildB1` at a smaller scale
   * with the paint left off and a dim eye, so it reads at a glance as a B1
   * that came off the line unfinished rather than as a new silhouette to
   * learn: a player must be able to tell in one look that this one is not
   * worth their time.
   *
   * EVERY NUMBER HERE IS DERIVED FROM THE B1'S, so the class is a RATIO and
   * not a second set of authored constants:
   *
   *   hp 6          §6's figure, and `guardFor` gives anything this light zero
   *                 turned passes, so it dies to one pass exactly as stated.
   *   1.4 dps       MEASURED, not derived from the table. §6 prices a B1 at
   *                 2.17 dps against a moving player and a conscript at 1.4,
   *                 which is 0.645 of it — a ratio, so it can be checked
   *                 without reproducing "a moving player". Driven through
   *                 `tools/_beaten.mjs class`, one shooter, blade down, real
   *                 frames on the same ground at the same range. A gun is
   *                 stochastic, so two sample lengths, and the spread between
   *                 them is what `tools/checks/conscript.mjs`'s band is sized
   *                 on rather than a tolerance picked to fit:
   *
   *                     150 s   b1 3.468   conscript 2.380   0.686 of it
   *                      90 s   b1 3.485   conscript 2.172   0.623 of it
   *
   *                 which puts the conscript between 1.35 and 1.49 dps on §6's
   *                 own scale, against the 1.4 it asked for.
   *
   *                 AND THAT PAIR IS THE WEAKER INSTRUMENT, because it is two
   *                 WORLDS. The same B1 arm read 3.485, 3.468 and 2.805 hp/s
   *                 over three runs of the identical call — a 24% spread on the
   *                 CONTROL, larger than the difference being measured, because
   *                 two boots are two dressings, two prop layouts and two
   *                 skies. `tools/_beaten.mjs mixed` stands four of each on ONE
   *                 arc and attributes every blow to the body that fired it,
   *                 and it is stable to two per cent:
   *
   *                      90 s   b1 1.998   conscript 1.440   0.721
   *                     150 s   b1 2.065   conscript 1.459   0.707
   *
   *                 So the honest figure is 0.71 of a B1 against §6's 0.645 —
   *                 a little hotter than asked. The cadence is not the dial
   *                 that would move it: at twelve bodies on one arc it is line
   *                 of sight and not the fire timer that decides how often a
   *                 rifle speaks, and the same run repeated reads 1.459 and
   *                 1.473 without anything changing at all.
   *
   *                 THE AUTHORED NUMBERS THAT GET THERE ARE THE B1'S, minus
   *                 one round a burst: same rifle, same spread, same band, two
   *                 bolts instead of three. Four earlier attempts made it a
   *                 slow inaccurate single-shot body — spread 0.19, one round
   *                 every 2.85 s — and measured 0.17 hp/s, a twentieth of a
   *                 B1 rather than two thirds. §6 does NOT ask for a harmless
   *                 body: at 1.4 each, forty conscripts are a real threat and
   *                 the thing that makes them weather is that killing them
   *                 pays nothing, not that they cannot hurt you.
   *   spread 0.075  the B1's, exactly. It shoots as well as a B1 and there is
   *                 a third less of it.
   *   threat 0.5    the floor `_openTypes` weighs against, so a wave that
   *                 fields these pays something for them and cannot field an
   *                 unbounded number for free.
   */
  conscript: {
    label: 'Conscript Droid', build: (o) => buildB1({
      ...o,
      /* Unpainted foundry shell, no unit flash, and an eye that has not been
       * brought up to full charge. Not a new mesh — see the note above. */
      color: o.color ?? 0x8f8574, markColor: o.markColor ?? 0x6d6355, eyeColor: o.eyeColor ?? 0xc0421f,
    }),
    scale: 0.96, hp: 6, mass: 44,
    speed: 3.2, toughness: TOUGHNESS.droid, ranged: true, weapon: 'e5',
    fireRate: 1.45, burst: 2, burstGap: 0.13, spread: 0.075,
    /**
     * ── SUPERSEDED IN PART — THE CONTROLLED NUMBER IS AT THE TOP ─────────────
     *
     * Every figure in the note below was taken ACROSS PROCESSES and is therefore
     * not a comparison. `World.js` had no reseeder for its module-level `rng`
     * when they were taken — it has `seedWorld` now — so two runs differing in
     * any earlier draw diverge completely, and `theline` and `command` differ in
     * one because a crossing rolls a session plan and Command does not. The same
     * change read 5.4 and 3.0 of ten on that alone.
     *
     * RE-TAKEN PROPERLY. Both arms from fresh processes, identical module-init
     * phase, `LEVELS.geonosis.battlefield` pinned off in both, the only
     * difference being the two constants this session moved, 20 seeds apiece:
     *
     *     as shipped before this session   1.35 of 10   (sd 1.73)
     *     with both halved                 2.80 of 10   (sd 2.33)
     *                                      +1.45, se 0.65, z 2.24
     *
     * So the lever is real and it is SMALL — and **the target is not met**. The
     * player asked for an engagement fought without the Jedi to cost about half
     * a ten-man line; it costs 7.2 of 10. What the figures below are still good
     * for is the RANKING they establish, which the controlled run does not
     * contradict: the two sources of fire the wave's threat budget never pays
     * for are the two that move this number at all. No single figure in them
     * should be quoted.
     *
     * `damage` 2, HALVED AND HALVED AGAIN — AND IT IS ABOUT THE LINE, NOT
     * ABOUT YOU.
     *
     * ── THE SECOND HALVING IS THE CHEST'S BILL ────────────────────────────
     *
     * `Enemy._shoot` led its aim on `target.chest ?? target.position`, and only
     * `Player` had a `chest`, so until this session every round the levy fired
     * at one of your named men was aimed at his BOOTS. The 5 above was chosen
     * against that. With the aim corrected, forty free rifles land on forty
     * chests, and the arithmetic is the same argument arriving twice as hard.
     *
     * MEASURED, twenty seeds an arm, fresh processes at an identical phase, the
     * only difference being the aim: an engagement fought with no Jedi on the
     * field went from **5.10 of ten survivors to 1.65**, and hostile fire into
     * the line from 1.18 to 1.71 hp a second. Six seeds apiece on this one
     * constant, everything else held: the round at 5 leaves 1.17 of ten
     * standing, at 2.5 it leaves 2.50, at 2.0 it leaves 2.83, and taking it to
     * zero leaves 3.50 — so the levy alone is worth about 2.3 of the eight and
     * a half names an engagement was costing. 2 is the setting that, beside the
     * emplacement's own re-paid cadence, lands the engagement on the target the
     * player set.
     *
     * The old argument is unchanged and is below; it is only that the number it
     * argued for was measured against a levy that could not hit anybody.
     *
     * FLAGSHIP §6 prices this gun at "1.4 dps AGAINST A MOVING PLAYER" — a
     * player with a guard, a dash and a dive — and src/game/Levy.js says what
     * that leaves out in one sentence: "a clone trooper has none of those: he
     * has 46 hit points and a slot to stand in." Until this session it did not
     * matter, because `World._boltHitTest` skipped its whole enemy loop for
     * hostile bolts and your own troopers live in that array (FLAGSHIP §16.3),
     * so no rifle on the other side could touch your army at all. It can now,
     * and forty free rifles are forty free rifles.
     *
     * MEASURED over a whole engagement rather than a window — area 1 of the
     * flagship mode on Geonosis, held open at the muster, no player on the
     * field, five seeds (`tools/_linehold.mjs`): taking the levy off the field
     * moves the survivors from **1.8 of 10 to 4.0 of 10**. Two of the eight
     * names an engagement costs are the weather's. §6's own sentence is that
     * "forty conscripts that pay nothing are weather"; weather that takes a
     * fifth of your line is a second wave you were not charged for, and the
     * levy is charged nothing by design — Levy.js argues its exemption from
     * the threat budget at length, and every word of that argument is about
     * the PLAYER's two ledgers.
     *
     * WHAT THE HALVING DOES NOT TOUCH IS WHAT THE LEVY IS FOR. §6's answer to
     * a crowd is suppression, and suppression is billed PER BOLT: `GUARD.stamina`
     * is `[1.2, 0.4, 0, 0]` by grade and the unanswered bolt costs Force, and
     * not one of those four numbers reads `damage`. So the round comes down
     * and the beaten zone does not: the same forty bodies arrive, at the same
     * cadence, firing the same number of bolts, draining the same guard. What
     * moves is only what an unblockable round does to a man who cannot block.
     *
     * The round WAS 10 against a B1's 9 — the body that is supposed to be
     * worth nothing carried the heaviest small-arms round on the Confederate
     * roster, reaching §6's dps ratio by firing fewer, bigger rounds. That is
     * the wrong shape for weather twice over: fewer bolts is less suppression
     * and a bigger round is more killing.
     */
    damage: 2,
    preferred: [7, 15], boltColor: BOLT_COLORS.red,
    /** THE FIELD THE WHOLE CLASS IS. See the note above and `World.paysOut`. */
    score: 0, threat: 0.5,
    hipHeight: 0.92, unlockAt: 1,
  },
  trooper: {
    label: 'Clone Trooper', build: buildTrooper, scale: 1.0, hp: 46, mass: 78,
    speed: 4.1, toughness: TOUGHNESS.plastoid, ranged: true, weapon: 'dc15',
    fireRate: 1.35, burst: 3, burstGap: 0.11, spread: 0.045, damage: 12,
    preferred: [9, 19], boltColor: BOLT_COLORS.blue, score: 180, threat: 2,
    /**
     * AND NOW HE HAS THEM, WHICH IS THE END OF A LONG STORY ABOUT THIS FIELD.
     *
     * `grenades: true` sat on this archetype for the whole of its life with no
     * reader anywhere in src/ — written once, read never, and indistinguishable
     * in a diff from a feature. It was deleted with a note that said what it
     * would take to earn it back: "A trooper grenade is a real thing to build —
     * `Stratagems.blast` is the primitive and `dodgeable.mjs` is the bar it
     * would have to clear — and it is a feature, not a field."
     *
     * `Enemy._maybeGrenade` is the reader and `src/game/Reactions.js` is the
     * feature: a live object with a fuse, and four things a soldier can do
     * about one. The Databank's clone page has been selling "grenades, cover,
     * and the judgement to use both" for a very long time; two thirds of that
     * sentence is now true.
     */
    grenades: true,
    hipHeight: 0.95,
  },
  sniper: {
    label: 'Marksman', build: buildTrooper, scale: 1.0, hp: 38, mass: 76,
    speed: 3.6, toughness: TOUGHNESS.plastoid, ranged: true, weapon: 'dc15',
    fireRate: 3.4, burst: 1, spread: 0.004, damage: 34, telegraph: 1.0,
    preferred: [22, 42], boltColor: BOLT_COLORS.gold, score: 320, threat: 3,
    trooperColor: 0x2c3038, accent: 0xff9a20, hipHeight: 0.95,
  },
  acolyte: {
    /* DARK ACOLYTE, not "Sith Acolyte". There are two Sith and the game fields
     * this one twelve at a time; the name for a dark-side duellist who is not
     * one of the two is the one the source material already uses for Dooku's
     * students, and it costs a string. */
    label: 'Dark Acolyte', build: buildAcolyte, scale: 1.04, hp: 130, mass: 82,
    speed: 5.0, toughness: TOUGHNESS.flesh, melee: true, saber: true,
    saberColor: 4, damage: 26, preferred: [1.6, 3.4], score: 700, threat: 6,
    hipHeight: 0.97,
    /**
     * MAKASHI, DECLARED — AND IT WAS A DIE ROLL.
     *
     * `Enemy._build` falls back to `FORM_KEYS[floor(rng() * 5)]` for a body
     * that declares no form, and this one declared none: the acolyte is 12 of
     * 101 pool slots across the ten levels and the only duellist on seven of
     * them, so the enemy the player meets most fought a different way every
     * time it spawned. The note over JEDI_BASE names that exact defect as the
     * reason the four Jedi declare theirs — "the player could not learn 'that
     * is Djem So, it commits hard, punish the recovery'" — and the fix reached
     * only the six archetypes written after it.
     *
     * Makashi for two reasons that agree. It is the form Dooku taught his
     * acolytes, which is who these are; and it is the form whose whole content
     * is the PARRY — 5 light attacks of 5, chain 1-2, `punishRecovery` 0.85 —
     * so the duellist a player meets on seven levels is the one that teaches
     * the fundamental of the duelling game rather than the exception to it.
     * The Master (also Makashi) is a set-piece on one level with 460 hp and
     * four powers; nobody is going to mistake one for the other, and sharing a
     * form is sharing a LESSON, which is what forms are for.
     */
    form: 'makashi',
    /* THE SITH TAKES WHAT THE JEDI WILL NOT. Lightning and the choke are the
     * two powers `Powers.js` gates behind an attunement for the player and the
     * two the source material is most consistent about being the dark side's;
     * giving them to the roster's one Sith is what separates fighting him from
     * fighting a Jedi at the same threat. 62 of pool buys the lightning twice
     * or a choke and a push, and then he is a fencer again. */
    force: 62, powers: ['lightning', 'choke', 'push'],
  },

  /* ── the order ──
   * Four bodies, four declared forms, four blades. See JEDI_BASE above for the
   * whole argument; the numbers here are the part that has to be balanced.
   *
   * PRICED AGAINST THE ACOLYTE, which is the roster's other duellist at 130 hp
   * and threat 6. A Jedi is not "an acolyte that costs more": each of the four
   * trades in a different direction, and the direction is the form.
   *   knight    faster and lighter than an acolyte — Ataru is chain 2-4, so the
   *             danger is the flurry rather than the body.
   *   sentinel  half again the health at 0.85 the pace. Soresu attacks at 0.42
   *             aggression, so a sentinel that could be rushed down would never
   *             get to be a sentinel; the health IS the form.
   *   guardian  the heaviest hitter of the four and the slowest, because Djem
   *             So's 0.58 s recovery is the longest opening in the game and a
   *             body that could not be punished in it would be a wall.
   *   master    a set-piece, gated the way the warship's general is. */
  jedi: {
    ...JEDI_BASE,
    label: 'Jedi Knight', build: (o) => buildJedi({ ...o, ...jediLook() }),
    scale: 1.0, hp: 140, mass: 78, speed: 5.4,
    saberColor: 1, hilt: 'Graflex', form: 'ataru',
    damage: 24, preferred: [1.5, 3.4], score: 800, threat: 6, unlockAt: 1,
    /* Ataru is the acrobatic form and its danger is the flurry, so the knight
     * gets the power that RESETS distance in its favour: 44 is two pulls, and
     * a pull puts you back inside a chain-of-four it had already started. */
    force: 44, powers: ['pull', 'push'],
  },
  sentinel: {
    ...JEDI_BASE,
    label: 'Jedi Sentinel', build: (o) => buildJedi({ ...o, ...jediLook() }),
    scale: 1.02, hp: 200, mass: 84, speed: 4.6,
    saberColor: 0, hilt: 'Sentinel', form: 'soresu',
    damage: 22, preferred: [1.8, 3.0], score: 950, threat: 7, unlockAt: 1,
    /* Soresu attacks at 0.42 aggression and wins by outlasting, so it gets the
     * one power that buys it SPACE and nothing that buys it damage. One verb,
     * and it is the defensive one. */
    force: 40, powers: ['push'],
  },
  guardian: {
    ...JEDI_BASE,
    label: 'Temple Guardian', build: (o) => buildJedi({ ...o, ...jediLook() }),
    scale: 1.05, hp: 250, mass: 92, speed: 4.4,
    /* Gold — the crystal SABER_COLORS annotates, in the table itself, as "the
     * Temple Guard yellow". It was added for a body that did not exist. */
    saberColor: 10, hilt: 'Guardian', form: 'djemSo',
    damage: 34, preferred: [1.5, 3.2], score: 1300, threat: 9, unlockAt: 4,
    /* Djem So hits hardest and recovers slowest, which is an opening you take
     * by backing off. The pull is the answer to that habit and it is the
     * SIGNATURE: it drags you back into the 34-damage swing you just stepped
     * out of.
     *
     * IT WAS ALSO, FOR A WHOLE SESSION, THE ENTIRE KIT — AND A ONE-VERB KIT
     * WHOSE VERB ANSWERS A HABIT THE PLAYER MAY NEVER SHOW IS NOT A KIT.
     * Driven for 25 s against a player who stood and fought, a Temple Guardian
     * cast NOTHING: `pull` wants `fleeing`, and in a stand-up fight at a
     * measured p50 of 1.6 m nobody is fleeing, ever. `pressed` is the only
     * situation a stand-up fight satisfies at all, so a body with no `pressed`
     * verb is a body with no Force, which is exactly the complaint. The shove
     * is the one that fits the form rather than a second favour: Djem So's
     * 0.58 s recovery is the longest opening in the game, and a body that
     * cannot clear its own guard during it is a free hit every cycle. 48 of
     * pool is two of them, or a shove and the pull that follows it. */
    force: 48, powers: ['pull', 'push'],
  },
  master: {
    ...JEDI_BASE,
    label: 'Jedi Master', build: (o) => buildJedi({ ...o, ...jediLook() }),
    scale: 1.03, hp: 460, mass: 86, speed: 5.2,
    /* The Temple's set-piece, and it says so rather than being kept out of the
     * fill by not appearing on a list. See the note on the IG Bodyguard. */
    setPieceOnly: true,
    saberColor: 2, hilt: 'Duelist', form: 'makashi',
    damage: 30, preferred: [1.7, 3.4], score: 2800, threat: 12, boss: true,
    /* The set-piece gets four of the five and the only UNLEASH on the roster,
     * which fires once, below a third of its health, with a blade inside its
     * guard — the same moment the player's own costs 52 for. 150 of pool is
     * roughly three exchanges' worth; it is a boss, and it is meant to make you
     * spend the whole fight reacting rather than trading. */
    force: 150, powers: ['unleash', 'lightning', 'pull', 'push'],
  },

  droideka: {
    label: 'Droideka', build: buildDroideka, scale: 1.5, hp: 170, mass: 210,
    speed: 3.0, toughness: TOUGHNESS.armour, ranged: true, custom: 'droideka',
    fireRate: 0.72, burst: 6, burstGap: 0.07, spread: 0.055, damage: 8,
    /* RED, like every other Trade Federation weapon on the field. The twin
     * blaster cannons on a destroyer droid fire the same bolt a B1's E-5 does;
     * the `0x66ff99` this carried was a mint green that belongs to nothing in
     * the source material and made the one droid that shoots continuously read
     * as a different faction from the ones beside it. `shield` is its tell and
     * it does not need a second one. */
    preferred: [8, 16], boltColor: BOLT_COLORS.red, score: 550, threat: 5, shield: true,
  },
  walker: {
    /* Its real name. The Geonosis pool's own note identifies this body as
     * "exactly the OG-9 homing spider droid of the reference plates: a sphere
     * on four very tall thin legs with a single beam off the top" — so the
     * research was done and the label said something generic anyway. */
    label: 'OG-9 Homing Spider Droid', build: buildWalker, scale: 2.4, hp: 620, mass: 900,
    speed: 2.4, toughness: TOUGHNESS.heavy, ranged: true, custom: 'walker',
    fireRate: 2.6, burst: 2, burstGap: 0.22, spread: 0.03, damage: 26, big: true,
    preferred: [12, 26], boltColor: BOLT_COLORS.gold, score: 1600, threat: 12,
  },
  /* ── dojo only ── */
  remote: {
    label: 'Training Remote', build: buildRemote, scale: 1.0, hp: 4, mass: 3,
    speed: 2.6, toughness: TOUGHNESS.plastoid, ranged: true, custom: 'remote',
    fireRate: 2.0, burst: 1, spread: 0.02, damage: 3, float: 1.55,
    preferred: [4.5, 7.5], boltColor: 0xffc040, score: 0, threat: 0, training: true,
  },
  dummy: {
    label: 'Training Droid', build: buildB1, scale: 1.02, hp: 999, mass: 52,
    speed: 0, toughness: TOUGHNESS.droid, inert: true,
    preferred: [0, 0], score: 0, threat: 0, training: true,
  },
  sparring: {
    label: 'Sparring Partner', build: buildAcolyte, scale: 1.04, hp: 400, mass: 82,
    speed: 3.4, toughness: TOUGHNESS.flesh, melee: true, saber: true,
    saberColor: 1, hilt: 'Guardian', damage: 3, preferred: [1.6, 3.2],
    score: 0, threat: 0, training: true,
    /* SORESU, because this one is a lesson and a lesson cannot be a die roll.
     * The dojo partner rolled a random form per spawn like every other
     * undeclared duellist, so the room built to teach the blade taught a
     * different blade each visit. Soresu is 3 light attacks of 3 — everything
     * it throws is parryable — at aggression 0.42, the lowest in the table, so
     * it waits instead of rushing and every exchange happens when the student
     * is ready for it. `punishRecovery: 1.0` is the highest, which is the other
     * half of the lesson: swing wildly at it and it takes the opening. */
    form: 'soresu',
  },

  beast: {
    label: 'Acklay', build: buildBeast, scale: 2.9, hp: 900, mass: 1400,
    speed: 4.6, toughness: TOUGHNESS.flesh, melee: true, custom: 'beast',
    damage: 42, preferred: [2.5, 5], score: 2400, threat: 16, boss: true,
  },
};

/**
 * WHETHER KILLING THIS BODY IS WORTH ANYTHING — FLAGSHIP §6's third class.
 *
 * The conscript is "worth 0 score and 0 Insight", and the point of it is that
 * a crowd which pays nothing cannot be answered by mowing it. That is one
 * question about a roster row, so it is one function and one field, called by
 * `World.onEnemyKilled`, by `Levy` and by a check.
 *
 * A missing `score` reads as unpaid rather than as a plausible default, which
 * is the other half of HANDOFF §2.3: an archetype that forgot to say what it
 * is worth should be visibly worth nothing, not quietly worth something.
 *
 * ── AND IT LIVES BESIDE THE TABLE IT ASKS ABOUT, WHICH IT DID NOT ───────
 *
 * It was `World.paysOut`, and `Levy.js` — reached from `Command.js` — imported
 * it from there. That closed a cycle nobody could see until it fired:
 * Command → Levy → World → Player → ui/Menu → Command, and importing
 * `Command.js`, `Levels.js` or `tools/_flagship.mjs` as the FIRST module of a
 * process then threw `Cannot access 'FORMATIONS' before initialization` at
 * Menu.js:174 — the very line whose own comment records having measured that
 * all eight entry points evaluate clean, because "Command imports Enemy,
 * Bodies, Combat, Bolts, Waves and MathUtil, and none of those reaches back
 * into ui/". Levy did, one hop further on.
 *
 * The rule this is an instance of: a predicate about a TABLE belongs in the
 * module that owns the table. `World.js` re-exports it, so every existing
 * reader is unchanged.
 */
export function paysOut(A) { return (A?.score ?? 0) > 0; }


/* ══════════════════════════════════════════════════════════════════════ */
/*  The other side's Force                                                */
/* ══════════════════════════════════════════════════════════════════════ */

/**
 * "PERHAPS THE ENEMY FORCE/SABER USERS SHOULD HAVE THE SAME FORCE POWERS YOU
 * DO… I FEEL LIKE THEY DIE TOO EASILY AND ARE TOO INEFFECTIVE."
 *
 * They had none. `grep -n "force" src/game/Enemy.js` returned the word only in
 * `forceScale` on incoming damage — every sabered body in the game (the
 * acolyte, the four Jedi, the sparring partner, the IG bodyguard) was a fencer
 * with exactly one verb, so a duel was one exchange repeated until somebody ran
 * out of health. The player is right and it is not a numbers problem: raising
 * their health makes the same fight longer, which is the opposite of the note.
 *
 * ── WHAT IS SHARED AND WHAT IS NOT.
 *
 * `POWER_COST` (src/game/Powers.js) is imported, not copied. That module exists
 * precisely because its table had already been duplicated once and drifted —
 * the HUD greyed out a power the player could afford — and an enemy paying a
 * different price for the same power is the same defect with a new reader. So a
 * Sith's push costs the twenty a player's push costs.
 *
 * The EFFECTS cannot be shared, and this is worth writing down rather than
 * apologising for. `Player.forcePush` is 78 lines that reach `this.cooldowns`,
 * `_spend`, `_refuse`, `_gesture`, `this.cloak`, `camera.addShake`,
 * `world.destruction`, `ctx.bolts` and `forceScale`, and none of those exist on
 * an Enemy. What IS shared is the thing that matters for consistency: the blow
 * lands through `target.applyKnockback(impulse, damage, source)` — the exact
 * call every one of the player's own powers ends in, and the reason Player.js
 * grew that method in the first place — so being pushed by a Sith and being
 * pushed by a player go through one path, one damage gate, one stagger rule.
 *
 * ── WHY THESE FIVE, AND WHY THEY ARE HANDED OUT UNEVENLY.
 *
 * A kit that every duellist carries is one duellist wearing five faces, which
 * is the defect this same session fixed in the menagerie. Each power answers a
 * different player HABIT, and an archetype gets the ones its form already
 * argues for:
 *
 *   PUSH       answers standing inside their guard. Fired when the player is
 *              close AND the enemy is losing the exchange, so it reads as "get
 *              off me" rather than as an opener.
 *   PULL       answers backing off to heal or to wait out a recovery. It drags
 *              you to blade range and the swing is already coming.
 *   CHOKE      answers nothing you can do while it is on: 35% movement speed
 *              (`Player.staggerTimer`) and damage a second, held for as long as
 *              they can pay. Its cost is 10 and its DRAIN is the balance — a
 *              choke ends because the pool ran out.
 *   LIGHTNING  answers hanging back at range, which is what the whole roster of
 *              ranged enemies teaches you to do to a melee one.
 *   UNLEASH    the 360 the player got last session, at the one moment it is
 *              earned: a master below a third of its health, with a blade
 *              inside its guard.
 *
 * Balanced by POOL rather than by damage. `force` is small — a knight can pay
 * for two pushes and then it has to fight — and it regenerates at
 * `FORCE_REGEN` a second, so a duellist that opens with everything is a
 * duellist with nothing at the end. Nobody's health or damage moved.
 */
/**
 * …and the regen is the whole balance, so it is measured rather than picked.
 *
 * At 5.5 a second the pool was never the limit: 4352 of the 4384 frames on
 * which an acolyte was otherwise free to cast were refused by a COOLDOWN and
 * none by the price, so a duellist pushed every 4.6 s forever and the kit read
 * as a tic rather than as a resource. At 3.0 the push's 20 costs more than the
 * 19.5 its cooldown regenerates, so the pool falls: the opening exchange buys
 * two or three powers and everything after it is fought with the blade, which
 * is the shape the note asks for ("more dangerous", not "unanswerable").
 */
export const FORCE_REGEN = 3.0;

/**
 * …AND THE SAME LIMIT SCALED TO THE BODY, which is the player's other half.
 *
 * "they need to be subject to the same force resources and limitations that
 *  effect me based on how strong they are"
 *
 * They were subject to the resources — a pool, a price per verb, a cooldown, a
 * telegraph, and `resistForce` billing them for every blow they answer — but
 * not to them AS A FUNCTION OF STRENGTH, because the regen was one flat number
 * for the whole roster. Measured across the five force users as shipped, time
 * to refill an empty pool at 3.0/s:
 *
 *     sentinel   40 force    13 s
 *     jedi       44          15 s
 *     guardian   48          16 s
 *     acolyte    62          21 s
 *     master    150          50 s
 *
 * which is backwards. The strongest body in the game had the LONGEST road back
 * to being able to act, so a Master emptied by its own opening was the most
 * limited thing on the field for the next minute — and the difference between
 * a sentinel and a Master, from the outside, was how long the quiet part
 * lasted rather than what they could do with what they had.
 *
 * A FRACTION OF THEIR OWN POOL puts every one of them on the same clock: 5.5%
 * a second is a little over eighteen seconds from empty to full whoever you
 * are. Strength then means exactly one thing — how much you can spend before
 * that clock starts — which is the thing the player can see, plan against and
 * bait out. The floor keeps the smallest pools from being a trickle and the
 * flat rate is kept as the floor's own value, so nothing that was quick before
 * became slow.
 */
export const FORCE_REGEN_FRAC = 0.055;

/** What a body's pool recovers per second: the larger of the flat rate and its
 *  own share. See FORCE_REGEN_FRAC. */
export function forceRegenFor(forceMax) {
  return Math.max(FORCE_REGEN, (forceMax || 0) * FORCE_REGEN_FRAC);
}

/** How long a held power's drain accumulates before it is billed. Slightly
 * longer than `Player.invuln` (0.18 s), so no tick is ever refused — see
 * `_sustain`, where a per-frame bill was losing 55 of every 60 payments. */
const SUSTAIN_TICK = 0.20;

/**
 * ── ANSWERING A POWER WITH A POWER ─────────────────────────────────────
 *
 * Driven before this existed: 50 damage of kind `force`, `lightning`, `blaster`
 * and `saber` all delivered **identically** into a Jedi Master, and a player's
 * lightning moved its Force pool **150 → 150**. It spent nothing defending
 * itself because no code path could. Two Force users pushing at each other both
 * landed in full. The pool was a spending account with no defensive side at
 * all, so "the enemies that use the force" could only ever mean "the enemies
 * that fire powers at you", never "the enemies you have a Force fight with".
 *
 * `resistForce` is the way in. A body that holds a pool spends it to blunt an
 * incoming power, and the three numbers below are the whole balance:
 *
 *   RESIST_PER_FORCE  what a point of pool buys, in hp of blunting. Above 1 so
 *                     that defending is CHEAPER than casting — a duel of pools
 *                     that the defender always loses is not a duel.
 *   RESIST_CAP        the most of one blow a full pool may ever take off. Not
 *                     1.0, deliberately: a power that can be refused outright
 *                     teaches the player to stop using powers, which is the
 *                     opposite of the note this whole file answers.
 *   RESIST_BEATEN     what is left of that while the guard is already beaten —
 *                     stunned, staggered, gripped, toppled. This is the reason
 *                     to break their guard BEFORE you spend 30 on lightning,
 *                     and it is the same rule `_turnCut` uses for the blade.
 */
/* EXPORTED because the Codex teaches them. The page that explains how to fight
 * a Force user has to quote the real numbers or it is a hand-written twin of
 * this table (HANDOFF §2.3), and the one thing worse than a player who does not
 * know the counter is a player taught a counter the game no longer has. */
export const RESIST_PER_FORCE = 1.4;
export const RESIST_CAP = 0.55;
export const RESIST_BEATEN = 0.35;
/** The kinds that are the Force, and are therefore answerable by it. */
export const FORCE_KINDS = /^(force|lightning|choke|grip|rend)$/;

/** How long a living body lies still before it picks itself up, in seconds.
 *
 *  1.35 rather than something snappier, and the number is a READ rather than a
 *  feel: a body that springs up the instant it stops sliding reads as a bug in
 *  the other direction, and the whole value of a Force throw is the second in
 *  which the thing you threw is out of the fight. Long enough to be worth
 *  doing, short enough that a squad you shoved does not stay shoved. */
/**
 * HOW OFTEN A BODY THAT CARRIES GRENADES USES ONE, in seconds, and how far it
 * can throw.
 *
 * `first` is a lead-in so a wave does not open with eight grenades in the air
 * — the thing that makes them frightening is that they are occasional. `every`
 * against a 2.6 s fuse means a grenadier is a rifleman who interrupts himself
 * about twice a minute, which is what a soldier with two on his belt is.
 *
 * 26 m is a hard throw and it is under every ranged archetype's own reach, so
 * a grenade is what a rifleman does when the rifle is not working rather than a
 * second, longer weapon.
 */
const GRENADE_CD = { first: 9, every: 22 };
const GRENADE_THROW = 26;
/** How wide a hurried throw scatters, in metres, before the thrower's quality
 *  divides it. A B1 puts one four metres wide and a commando lands it. */
const GRENADE_SPREAD = 5.2;
/** How long a body that decided AGAINST throwing one waits before deciding
 *  again, in seconds. See the note in `_maybeGrenade` and the 167x it is
 *  there to stop. */
const GRENADE_LOOK = 0.25;

/** How often a dead duellist's blade is still burning when it hits the floor.
 *  See `die` — the player asked for both, and two in five is enough of one to
 *  be a sight on a cleared field without every corpse glowing. */
const DEAD_BLADE_LIT = 0.4;

const GET_UP = 1.35;

/**
 * HOW LONG A HOLD SURVIVES ITS HOLDER — the lease on `gripped`.
 *
 * "troops go completely invisible a lot like I see their names above their
 *  heads but they're invisible, I can still throw them around though."
 *
 * `gripped` was a LATCH, and it was written true in three places and false in
 * one: `Player.releaseGrip`. Everything else that can end a hold — the gripper
 * dying with a body in the air, a level rotating under it, a co-op peer's
 * `Player` being disposed, a power interrupted between the two halves of a
 * frame — left it true FOR EVER, and a body carrying it is:
 *
 *   out of its brain          `_think` returns on `gripped`
 *   out of `_tickGetUp`       so it is limp for the rest of the level
 *   still suspended           `_move`'s held branch damps it at `liftTarget`,
 *                             which is the gripper's own live `_liftPoint`
 *                             vector, so it follows the NEXT thing that player
 *                             lifts around the field
 *   still a body              the capsule is in the physics world, so it can
 *                             still be shot, shoved and thrown
 *   still on the roster       `roster.living` has it, so its nameplate is
 *                             drawn over it wherever the capsule has got to
 *
 * which is every symptom in that sentence at once.
 *
 * A LEASE RATHER THAN ANOTHER `= false`, because the defect is the shape and
 * not any one of its call sites: adding `releaseGrip()` to `Player.die` fixes
 * a death and not a disposal, and the next way to abandon a hold would arrive
 * with nobody having thought to clear it. A holder now has to keep SAYING it
 * is holding — `Enemy.hold()`, called from the grip's own update — and a hold
 * nobody is asserting expires on its own. `World._netGripLeases` already had
 * exactly this reasoning for a peer that goes quiet ("a held body is the one
 * state a lost connection can strand"); this is the same rule applied to the
 * machine the hold is running on.
 *
 * 0.55 s: comfortably longer than a dropped frame or a hitch (`main.js` clamps
 * dt at 0.1 s) and short enough that a body whose holder has genuinely gone is
 * back on its feet inside `GET_UP` of the moment it should have been.
 */
const GRIP_LEASE = 0.55;

/** How often a body is asked whether it is drawing anything. See
 *  `Enemy._auditVisible` — three times a second is far more often than a
 *  player could notice a body missing, and cheap enough not to matter. */
const AUDIT_EVERY = 0.33;

/** Rolling phase for the audit above, so bodies do not audit in lockstep. */
let _auditPhase = 0;

/**
 * What a rank is worth to a soldier's AIM, as a multiplier on their own spread.
 *
 * Derived from RANKS' shape rather than authored beside it: the ladder buys
 * about 78% more health from bottom to top, and this is the same climb applied
 * to the one thing a rank obviously should buy and did not. A Commander shoots
 * at 0.68 of a raw trooper's spread, which over a 30 m shot is the difference
 * between a hit and a near miss and is visible in one firefight.
 */
const AIM_BY_RANK = [1.00, 0.92, 0.84, 0.76, 0.68];

/**
 * THE RULE ITSELF, AS ONE FUNCTION — and it is exported so that the other half
 * of this contest is three lines rather than a second copy of it.
 *
 * **BOTH HALVES ARE IN NOW.** This note used to end "the player cannot yet
 * answer a power with a power, and that is the one thing this file could not
 * fix", because `Player.applyKnockback` and `Player.damage` — the two doors an
 * enemy's push, pull, choke and lightning arrive through — were in a file that
 * work did not own. `Player.resistForce` calls THIS function through those two
 * doors, so the contest is symmetric: measured on a Knight-difficulty player
 * taking 50 hp of an authored power, force / lightning / choke land for 19.1 hp
 * against a full pool and 42.5 against an empty one, and a blade or a bolt
 * takes the bar not at all.
 *
 * Keeping the arithmetic here rather than writing it twice is the point: this
 * project has un-duplicated the same kind of table three times (`POWER_COST`,
 * the HUD price list, the announcer voice map) and the note over `Powers.js`
 * is about what happens when the two copies drift. It is also why `RESIST_CAP`
 * cannot quietly be re-tuned for one side: `1 - RESIST_CAP` is the factor a
 * deep pool scales an incoming SHOVE by, so it sets how far the enemy's push
 * carries a braced player, which is what `PUSH_SPEED` is sized against.
 *
 * ── WHAT A DEEP POOL BUYS DEFENSIVELY, MEASURED: NOTHING PAST 19.64.
 *
 * The `min` saturates. For a 50 hp blow the first term is `50 × 0.55` = 27.50
 * and the second is `pool × 1.4`, so every pool at or above **19.64** blunts
 * exactly 27.50 and spends exactly 19.64 — measured at 25, 50, 100 and 150 and
 * identical at all four. A 460 hp Master carrying 150 of pool and a 200 hp
 * Sentinel carrying 40 therefore defend the same, and the archetype `force:`
 * numbers are a SPENDING budget and nothing else.
 *
 * That is recorded rather than changed, and deliberately. Making depth defend —
 * scaling `RESIST_CAP` by the fraction of pool the blow costs — is a balance
 * decision, it is symmetric (the player is the other caller), and `1 -
 * RESIST_CAP` is what `PUSH_SPEED` was sized against, so it would move how far
 * every shove in the game carries a braced body. It wants its own pass with its
 * own measurements on both sides of the contest, not a line changed in passing.
 *
 * @param pool    the defender's Force, whatever it is called on that class
 * @param beaten  is the guard already broken — stunned, staggered, gripped
 * @returns `{ blunt, spend }`: hp taken off the blow, and pool it cost.
 */
export function forceResistance(pool, amount, kind, beaten) {
  if (!(amount > 0) || !(pool > 0) || !FORCE_KINDS.test(kind ?? '')) return { blunt: 0, spend: 0 };
  const blunt = Math.min(amount * RESIST_CAP * (beaten ? RESIST_BEATEN : 1), pool * RESIST_PER_FORCE);
  return { blunt, spend: blunt / RESIST_PER_FORCE };
}
/**
 * A shove's speed, priced in the same currency as its damage, so ONE call to
 * `resistForce` answers a whole blow rather than billing its two halves
 * separately out of the same pool.
 */
export const IMPULSE_AS_HP = 1.2;

/**
 * ── A CROWD OF SHOVES IS STILL ONE SHOVE ──────────────────────────────────
 *
 * `velocity.add(impulse)` is what both `applyKnockback`s did and it is
 * unbounded, so N shoves landing together are N times the shove. The
 * population that finds that out is a RING, which the game fields every wave.
 *
 * MEASURED, on the colosseum, twenty acolytes spawned together against a
 * player standing still: twenty identical bodies run one brain in lockstep, so
 * they all reach `pressed` on the same frame and nineteen pushes land inside
 * frame 166. The ring is symmetric, its horizontal halves cancel exactly, and
 * its `PUSH_LIFT` halves ADD — 19 x 10 m/s of pure lift, out at 190 m/s, apex
 * **718 m**, twelve seconds of fall away from the fight it was standing in.
 * tools/checks/cloth-cost.mjs met it as "0 of 20 enemies inside the cloth cut"
 * and two sessions went into blaming the harness for holding two Worlds.
 *
 * It is not a fixture's population. `PUSH_SPEED`'s own note sizes the shove so
 * that an unbraced target flies 6.84 m and argues that number from the push's
 * band: "6.84 m sits inside it, so even an unbraced target lands somewhere the
 * caster can still reach." TWO shoves from one side already broke it at 13.7 m.
 *
 * THE RULE, and it is one sentence with two halves because a ring answers the
 * first half for free:
 *
 *   · SPEED. The shoves that land in one frame carry the body no faster than
 *     the hardest single one of them. On its own this fixes the firing line
 *     and barely touches the ring — a symmetric ring has nothing left to spend
 *     its length on but UP, so 190 m/s survived the clamp as 27.9 m/s of lift
 *     and a 16 m launch off a move whose whole apex is 2.10 m.
 *   · LIFT. So the vertical share is bounded the same way and separately.
 *     Clamping `velocity.y` was in fact the answer tried FIRST, and alone it
 *     is the symptom this particular ring produces rather than the defect: a
 *     ring cancels its horizontals and a firing line does not.
 *
 * AND IT BOUNDS THE CROWD'S CONTRIBUTION, NOT THE BODY'S OWN MOTION — which is
 * the second wrong answer, and it was wrong in a way that only a full run
 * showed. Clamping the whole velocity against `max(what it was doing, this
 * shove)` reads correctly and quietly re-prices every shove landing on a body
 * that was already moving: a player walking away at 4.6 m/s took 27.9 m/s
 * instead of 30.6. `footwork: retreating is priced, not removed` inverted on
 * it (still 8.15 hp/s against a walk's 8.83, where the whole design is
 * still > walk > dash) and `physicality` lost two tree colliders to the
 * knock-on. So the account is kept per body per FRAME and the body's own
 * velocity is never in it: `sub(applied).add(want)` re-applies the bounded
 * crowd on top of whatever the body was doing, and a single shove is
 * arithmetically identical to `velocity.add(impulse)` — sum is the impulse,
 * both bounds are no-ops, and every figure in `PUSH_SPEED`'s note still holds.
 *
 * The frame is the boundary because that is what "at once" means to a body:
 * shoves a frame apart still stack, which is two pushes doing what two pushes
 * should.
 */
const _shoveWant = new THREE.Vector3();
export function addShove(body, impulse) {
  const s = body._shove || (body._shove = {
    sum: new THREE.Vector3(), applied: new THREE.Vector3(), up: 0, down: 0, top: 0,
  });
  s.sum.add(impulse);
  s.top = Math.max(s.top, impulse.length());
  s.up = Math.max(s.up, impulse.y);
  s.down = Math.min(s.down, impulse.y);
  const want = _shoveWant.copy(s.sum).clampLength(0, s.top);
  want.y = Math.min(Math.max(want.y, s.down), s.up);
  body.velocity.sub(s.applied).add(want);
  s.applied.copy(want);
}

/**
 * A new frame opens a new account. Called at the top of both `update`s rather
 * than off a clock, because `applyKnockback` is reached from a dozen places
 * and none of them is handed the time.
 */
export function newShoveFrame(body) {
  const s = body._shove;
  if (!s) return;
  s.sum.set(0, 0, 0); s.applied.set(0, 0, 0);
  s.up = 0; s.down = 0; s.top = 0;
}

/**
 * ── HOW HARD YOU HAVE TO HIT TO BREAK A CAST ───────────────────────────
 *
 * Anything that beats the guard (`stun`, a grip, a real shove) breaks a cast
 * outright. A plain blow has to be worth flinching at, or a single stray bolt
 * cancels every power the roster has and the telegraph becomes a joke in the
 * other direction. `max(8, 5% of maxHp)` puts a lightsaber (24–34) through a
 * Jedi's concentration and a blaster bolt (9–13) through nobody's but a
 * B1-tier body's, which is the right shape: the blade is the answer.
 */
/**
 * THE TELEGRAPH, in seconds — how long a power is visible before it lands.
 *
 * Exported, and it was a literal at its one call site until the Codex needed
 * to teach it. This is the window the player's counter lives in: 0.45 s is
 * about one blade swing at the reach a duellist casts from, so "hit them while
 * the call is over their head" is an instruction that can actually be followed
 * rather than a reflex test.
 */
export const CAST_WIND = 0.45;
const CAST_FLINCH_FLOOR = 8;
const CAST_FLINCH_FRAC = 0.05;
/**
 * HOW MUCH OF A SIGHTLINE HAS TO SURVIVE THE SMOKE for a body to shoot down it.
 *
 * `seeThrough` is transmittance — 1 in clear air, falling exponentially with
 * the depth of cloud on the line — and this is where a shooter gives up. 0.30
 * is roughly a metre and a half through the middle of a full bank: enough that
 * the fringe of a cloud is cover you are gambling on rather than cover you are
 * behind, and little enough that walking into the middle of one genuinely
 * breaks contact. The bolt model reads the same integral, so the round that
 * does get thrown at you through the edge is already the weaker one.
 */
const SMOKE_SEE = 0.30;
/** How much of a body's own health a blow has to take before it says so. See
 *  the note at the call site for why this is a fraction and not a floor. */
const HURT_CRY_FRAC = 0.085;

/**
 * ── THE GUARD, AND WHY "THEY DIE TOO EASILY" IS NOT A HEALTH NUMBER ────
 *
 * `takeCut` makes any capsule with `vital >= 0.9` — head 0.95, neck, chest,
 * spine and hips all 1.0 — instantly lethal at `maxHp * 2`, and the FIRST arm
 * lost sets `disarmed` on anything holding a blade. So a 460 hp Jedi Master and
 * a 130 hp Sith acolyte died to exactly the same single torso pass, and raising
 * anybody's health could never have changed that by one frame. Measured
 * time-to-kill with a blade sweeping: acolyte 3.1 s, knight 4.5 s.
 *
 * The fix is not more hp and it is not invulnerability. It is a GUARD: a
 * duellist turns a fight-ending cut aside while its guard is up, and the counter
 * -play is the duel game this file already has. Every one of the openings the
 * player earns — a parry, a chamber, a won blade lock, a Force shove, a heavy
 * blow, a topple, a grip, a severed arm — sets `stunTimer`, `duel.staggered`,
 * `toppled`, `gripped` or `disarmed`, and every one of them makes the killing
 * pass land immediately (`_guardOpen`). So the answer to "how do I kill a Jedi"
 * stops being "swing at its chest" and becomes "beat its guard, then swing at
 * its chest", which is the fight the rest of Duel.js was built for.
 *
 * It is DERIVED and not authored — HANDOFF 2.3, no hand-maintained table beside
 * its generated twin. 90 hp per turned pass is two thirds of the lightest
 * duellist on the roster (acolyte 130, knight 140), so the count rises with
 * health without anybody having to keep a second column in step:
 *
 *     acolyte 2 · knight 2 · sentinel 3 · guardian 3 · master 6 · bodyguard 12
 *
 * …and the last two never spend all of it, because a turned pass is NOT free.
 * It costs `TURNED_CUT` of maximum health and leaves the body staggered, so the
 * real ceiling is `1 / TURNED_CUT` passes however deep the guard is — five for
 * everything. Health and guard multiply up to that ceiling and no further,
 * which is what stops this from being the wall the note is not asking for.
 *
 * Training bodies are excluded: the dojo's sparring partner exists to be hit.
 */
const GUARD_PER_HP = 1 / 90;
export const TURNED_CUT = 0.24;
/** Seconds to win one turned pass back, and only while the guard is not beaten. */
const GUARD_REFRESH = 6.0;

/**
 * WINDED — the opening a big body has instead of a stagger, and for two of them
 * it was BOOKKEEPING WITH NO READER.
 *
 * `recentDamage` is written at three sites — `damage()`, `takeCut()` and the
 * turned pass — behind `A.boss || A.custom === 'beast'`, and it was read at
 * exactly ONE, inside `_beastBrain`. `master` and `bodyguard` are `boss` and
 * neither runs the beast brain, so on those two the number accumulated forever
 * and nothing ever looked at it: **the WINDED opening did not exist for the two
 * duellist bosses**, while `_guardOpen` — the one predicate the blade and the
 * Force both read — lists `state === 'winded'` as an opening every body has.
 *
 * What that costs is not subtle. The IG Bodyguard has 1050 hp, a durasteel
 * torso and TWELVE turned passes, so the pass that ends the fight is refused
 * twelve times unless the guard is beaten first — and the one opening its own
 * mechanic offered was unreachable. Measured against a player who walks
 * backwards: 0.00 hp/s in either direction.
 *
 * So the rule lives here, once, and every brain that owns a body with the tally
 * calls `_windTick`. The three numbers are the ones the creatures were already
 * tuned with — take 14% of your maximum health faster than 12% of it decays per
 * second and you are open for 2.4 s, once every 7 — because a window that means
 * one thing on a Rancor and another on a droid general is two mechanics sharing
 * a name.
 */
const WIND_TAKE = 0.14;      // share of max health inside the window that opens it
const WIND_DECAY = 0.12;     // share of max health the tally sheds per second
const WIND_OPEN = 2.4;       // seconds the body is open for
const WIND_GAP = 7;          // seconds before it can be opened again
/** Does this body keep a `recentDamage` tally at all? One predicate, four readers. */
const keepsWind = (A) => !!(A.boss || A.custom === 'beast');

/**
 * HOW MANY LEGS A BODY LOSES BEFORE IT GOES DOWN, off the body's own bones.
 *
 * A free function rather than a method, and exported, because `tools/balance.mjs`
 * needs the same answer to predict what a pass is worth and had its own copy of
 * it — `/thigh|shin|foot|femur|tibia|tarsus/` plus a flat 3-or-1 — which stopped
 * agreeing with the game the day the rule moved to `bone.role`. That is
 * HANDOFF §2.4: the model restated the rule instead of calling it, and then the
 * rule changed. One reader now, in both places.
 *
 * `chains - 1` is the cap and it is the whole of the interesting part: a body
 * cannot be required to lose more legs than it has minus one, or a two-legged
 * animal and a two-wheeled machine are asked for three and can never fall over
 * at all. It is why a Rancor goes down on one leg — a Rancor with one leg is a
 * Rancor on the sand — and why a Hailfire goes down on its first wheel, which
 * `Rig.js` had already said in as many words ("losing one is losing the pair").
 */
/**
 * ── AND A MACHINE MAY STATE ITS OWN NUMBER, WHICH THREE OF THEM HAVE TO ───
 *
 * `3 for a walker, 1 for everything else` is the right default and it is wrong
 * at both ends of the roster the giants added. It is derived from a body plan
 * nobody declared — four to six legs, lose half of them — and it does not
 * survive a leg count of three or of twelve:
 *
 *   OCTUPTARRA MAGNA TRI-DROID. Three legs, and the reference is explicit that
 *     this is the machine's defect rather than a balance choice: "its
 *     three-legged design was its primary weakness, as if one was damaged, the
 *     entire droid would topple over." The clamp would have asked for two,
 *     which is a tripod standing on one leg — a pose that cannot exist.
 *   SPHA. TWELVE legs under a gun platform. Three of twelve is a quarter of
 *     the machine's support and it would fall over; five is a load path that
 *     has actually failed, and it is still by far the cheapest kill on the
 *     roster measured in metres of leg.
 *   NR-N99 SNAIL TANK. ONE tread. `chains - 1` is zero there and the `max(1,…)`
 *     already rescued it, so the field changes nothing for this body — it is
 *     named here because it is the case that proves the clamp is a floor and
 *     not a rule, and because a reader who finds `toppleAt: 1` on the tri-droid
 *     will want to know why the tank does not carry one.
 *
 * The clamp stays and is applied to the declared number as well, because the
 * reason it exists is unchanged: nothing may be asked for more legs than it
 * has. A machine that declares five and grows a sixth leg tomorrow is asked
 * for five; one that declares five and loses six of its twelve to a redesign
 * is asked for five and not for a number it can never reach.
 */
export function toppleAt(A, rig) {
  const authored = A?.toppleAt ?? (A?.custom === 'walker' || A?.custom === 'beast' ? 3 : 1);
  let chains = 0;
  for (const b of (rig?.list ?? [])) {
    if (b.role === 'leg' && b.parent?.role !== 'leg') chains++;
  }
  return chains > 0 ? Math.max(1, Math.min(authored, chains - 1)) : authored;
}

/**
 * ── AND THE SAME ARGUMENT FOR EVERYTHING WITHOUT A BLADE ───────────────
 *
 * The note above fixed duellists and left the other twenty-four bodies exactly
 * where they were, which the harness then measured: a 28 hp B1, a 420 kg Nexu,
 * a 1250 hp Reek, a 900 hp Acklay and a 2200 hp Rancor ALL fell to one pass in
 * 0.64 s, because `takeCut` makes any `vital >= 0.9` capsule instantly lethal
 * and nothing that is not a duellist defends itself. The player's own words for
 * it were "the large creatures all look the same… they all attack the same
 * way"; the measurement adds the half nobody had said out loud, which is that
 * they also DIE like nothing. Modelled through the Colosseum's wave-1 opener —
 * the largest body in the game — a fresh player paid 0.0 hp for it.
 *
 * A duellist turns a killing pass with a blade. A body with no blade turns one
 * with ITSELF, and how many it turns is a question of how much of it there is.
 * A lightsaber ends a fight by reaching something vital in one pass; whether it
 * can is set by how much animal is between the edge and the spine.
 *
 * MASS IS THE MEASURE, and it is deliberately not `toughness`. Toughness is
 * already doing this job one layer down — it is the work-to-cut term inside
 * BladeContactSolver, which is what makes a durasteel hull slow to part — and
 * spending it twice would price a 520 kg dwarf spider like a 3600 kg AT-TE
 * (14 × 520 against 14 × 3600 is the same ratio as the masses, but multiplied
 * by a toughness that has already been charged for). Mass is the axis that is
 * NOT yet spent, it is declared on every archetype, and it is the one the
 * player can see.
 *
 * 300 kg per turned pass, and the boundary is what the number is for: nothing
 * man-sized turns anything (a fully armoured clone trooper is 78 kg, a B2 is
 * 130, a droideka 210 — all zero), and the lightest body that turns one is the
 * 420 kg Nexu. Above that it rises with the animal:
 *
 *     nexu 1 · gundark 1 · dwarf spider 1 · spider walker 3 · acklay 4
 *     hailfire 5 · reek 5 · rancor 5 · AAT 8 · AT-TE 12
 *
 * …and everything from the hailfire up is the SAME fight, because `TURNED_CUT`
 * caps the real ceiling at five for every body in the game. That cap is the
 * reason this is not a wall, and it is why the AT-TE's twelve is harmless.
 *
 * THE OPENINGS ARE THE ONES THE GAME ALREADY HAD, which is the whole reason
 * this is derived rather than built. `_guardOpen` turns off the guard for a
 * topple, a grip, a stagger, a stun — and now for WINDED, the state
 * `_beastBrain` already enters when it takes 14% of its health quickly and
 * which its own comment already calls "the only safe time to go for a leg".
 * So against an animal the loop becomes: pressure it until it is winded, then
 * take the killing pass or a leg. Against a machine it is the legs first —
 * `_loseLimbBehaviour` topples a `walker` or a `beast` at three — and a topple
 * opens the guard. Both of those were built and neither meant anything,
 * because nothing was standing between the player and the neck.
 */
const HIDE_PER_KG = 1 / 300;

/**
 * How many fight-ending passes a body of this archetype can turn aside.
 *
 * THE SINGLE AUTHORITY. The constructor reads it and so does `tools/balance.mjs`
 * — the harness imports this function rather than re-deriving `hp / 90`, so it
 * measures the shipped rule instead of a second copy of it that can disagree
 * with the game (HANDOFF §2.4: never restate a rule, call it).
 */
export function guardFor(A) {
  if (!A || A.training || A.inert) return 0;
  if (A.saber) return Math.max(1, Math.ceil((A.hp || 0) * GUARD_PER_HP));
  return Math.floor((A.mass || 0) * HIDE_PER_KG);
}

/**
 * ── AND THE SAME BOUNDARY, ONE AXIS ROUND: WHICH BODIES HAVE A PLACE THE HIDE
 *    IS NOT ────────────────────────────────────────────────────────────────
 *
 * Player note #35 — "big bodies need weak points" — is the spatial half of the
 * note the guard above answers in time. The guard says a big body turns a
 * killing pass aside until you EARN an opening; the note says there should also
 * be a place on it worth AIMING at. Both are the same sentence about the same
 * thing, said about two different axes, so they are gated on the same
 * predicate rather than on a new one:
 *
 *   · `guardFor(A) > 0` — there has to be a hide before there can be a gap in
 *     it. Everything under 300 kg turns nothing and needs nothing: measured on
 *     the shipped bodies, a B1's neck, a trooper's hips and a B2's head are all
 *     one pass already, and a soft spot on a body that dies to the first cut
 *     anywhere is a mechanic with nothing on the other end.
 *   · `!A.saber` — a duellist's guard is a BLADE, not bulk. `GUARD_PER_HP`
 *     derives it from health and `_turnCut` plays a steel-on-steel clash for
 *     it; a blade has no thin place, and the counter-play to one is the duel
 *     game, which this file already has. The IG Bodyguard (240 kg, twelve
 *     turns, an electrostaff) is on the wrong side of a mass test and the right
 *     side of this one.
 *
 * That leaves exactly the ten `big` bodies on the roster, which is the list the
 * note names. `tools/checks/severance.mjs` holds the two sets against each
 * other so neither can drift.
 */
export function hasWeakPoints(A) {
  return !!A && !A.saber && guardFor(A) > 0;
}

/**
 * ── A SHOVE HAS TO BUY THE RANGE THE NEXT BEAT NEEDS ───────────────────
 *
 * This roster has exactly one two-beat in it and it was one metre short of
 * existing. `pressed` is the only situation a stand-up fight satisfies, so the
 * push is the only opener any of these bodies has; and `lightning` wants
 * `ranged`, which is `preferred[1] + 2.0` — 5.4 m for a Master. Measured, with
 * the shoving body held still so the number is what the SHOVE bought and not
 * what the chase gave back:
 *
 *     17.0 / 6.5   1.95 m → peak 5.00 m      lightning unreachable, by 0.4 m
 *     20.4 / 7.8   1.95 m → peak 5.71 m      it opens
 *     23.8 / 9.1   1.95 m → peak 6.39 m
 *
 * So the shove was sized at the second row and the combo was readable: he shoves
 * you off him, and while you are still travelling he is already reaching.
 *
 * ── AND THEN THE PLAYER LEARNED TO BRACE, WHICH RE-OPENS ALL OF IT ─────
 *
 * Every row above was measured against a target that could not answer a power
 * with a power. `Player.resistForce` exists now, it mirrors `Enemy`'s, and it
 * blunts the SHOVE as well as the harm — one blow, weighed once, both halves
 * scaled by what the pool bought back. So a shove no longer buys a distance; it
 * buys a RANGE of distances, and which end of it you get is a thing the player
 * decides by what is left in their bar. Re-measured, same fixture, the shoving
 * body still pinned:
 *
 *                     braced (100 Force)      empty bar
 *     20.4 / 7.8      peak 3.28 m             peak 5.71 m
 *     26.0 / 10.0     peak 3.86 m             peak 6.84 m
 *
 * THE 45% IS STRUCTURAL AND NO SIZING GETS AROUND IT. `RESIST_CAP` is 0.55 of
 * the blow, so a deep pool always scales a shove to 0.45 of itself — the factor
 * does not depend on how big the shove is. Reaching `ranged` (5.4 m) through a
 * full pool therefore needs 2.2× the impulse, and 45 / 17 throws an EMPTY-bar
 * player 14 m: past the far edge of the push's own band, so the caster shoves
 * its target out of its own next cast. Driven rather than reasoned — the
 * Master's own brain, run on after the shove with `push` taken off it so the
 * peak is one shove's and not two:
 *
 *                     braced                        empty bar
 *     20.4 / 7.8      choke only                    lightning, pull, choke
 *     26.0 / 10.0     pull @0.62s, choke @0.52s     lightning, pull, choke
 *     40.0 / 15.0     pull, choke (peak 5.20 m)     all three, and a 10.4 m fly
 *
 * So the shove is re-sized to the middle row, and the two-beat is now a
 * CONTEST rather than a certainty. Braced, you deny him the lightning and eat
 * the pull or the choke instead — the shove clears the pull's 3.2 m band by
 * 0.66 m where before it cleared it by 0.08, which was a coincidence and not a
 * margin. Empty-bar, you fly 6.84 m and the whole kit opens on you. That is
 * what spending 16.7 Force to brace is FOR, and it is a better two-beat than
 * the deterministic one: which second beat arrives is now something the player
 * bought.
 *
 * The ceiling on the other side is the push's own band, [0, 7.5]. 6.84 m sits
 * inside it, so even an unbraced target lands somewhere the caster can still
 * reach — the property `unleash`, at 1.55× this pair, deliberately gives up.
 *
 * The pair keeps its ANGLE. 17.0/6.5 and 20.4/7.8 are the same vector at two
 * magnitudes (both 0.382 lift-to-speed), and this is the same vector again a
 * shade over a quarter larger; a shove that changed the direction you were
 * thrown would be a different move, not a re-tune.
 */
export const PUSH_SPEED = 26.0;
export const PUSH_LIFT = 10.0;

export const ENEMY_POWERS = {
  push: {
    cost: POWER_COST.push, cd: 6.5, band: [0, 7.5], want: 'pressed',
    label: 'FORCE PUSH', color: '#8ad8ff', sound: 'push',
  },
  /**
   * BANDED AT 3.2 AND NOT 6.5, because 6.5 was outside the fight.
   *
   * A pull is authored to answer "backing off to heal or to wait out a
   * recovery" — the moment the gap OPENS — and it banded from 6.5 m, which is
   * more than twice the widest duelling band on the roster. Measured stand-off
   * over 25 s fights against a real player: p50 1.6 m, p90 1.7 m. So the power
   * could only ever fire at somebody who had already fully disengaged, by
   * which point "drags you back into the swing you just stepped out of" is not
   * what it does. 3.2 is the far edge of the widest melee band (`bodyguard`
   * 3.8, `master` 3.4) plus nothing: it is the first metre at which the target
   * is genuinely OUT rather than merely circling.
   */
  pull: {
    cost: POWER_COST.pull, cd: 5.4, band: [3.2, 20], want: 'fleeing',
    label: 'FORCE PULL', color: '#8affc4', sound: 'pull',
  },
  /* Held rather than fired: `hold` is the seconds it may run for and it is
   * paid per second, so the pool is the real limit. `cost` is the price of
   * opening it, exactly as `Player.forceGrip` charges to take hold and then
   * bills per second while it lifts. */
  choke: {
    cost: POWER_COST.grip, cd: 9.0, band: [2.5, 16], want: 'fleeing',
    hold: 2.4, drain: 9, dps: 7,
    label: 'CHOKE', color: '#ff6a6a', sound: 'grip',
  },
  /**
   * BANDED AT 2.8 AND NOT 4.5, for the reason the pull is banded at 3.2.
   *
   * 4.5 m is further than any duellist on the roster stands (the widest band is
   * the bodyguard's 3.8) and further than its own shove throws — a braced
   * player lands at 3.86 m — so the two-beat this power exists for could not
   * complete: shove, then burn. Measured over five real 45-second duels, one
   * per Force archetype: 22 casts, 20 push, 2 pull, and lightning fired ZERO
   * times on any body that has it, including the Sith whose signature it is.
   *
   * 2.4 is inside where the shove lands and outside where a blade fights, and
   * the gap is smaller than it sounds because THE CASTER WALKS IN BEHIND ITS
   * OWN SHOVE: measured peak separation over the 1.2 s after a push, with the
   * duel brain closing at the same time, is 2.89 m on a Temple Guardian and
   * 3.49 m on a Knight — against a resting stand-off of 1.6 m. So the beam is
   * reachable exactly in the gap the push opens and not while the two of them
   * are nose to nose. The `ranged` situation is the other half of the same fix
   * — see `_forceBrain`.
   */
  lightning: {
    cost: POWER_COST.lightning, cd: 8.5, band: [2.4, 18], want: 'ranged',
    hold: 1.6, drain: 6, dps: 22,
    label: 'LIGHTNING', color: '#c8e8ff', sound: 'lightning',
  },
  unleash: {
    cost: POWER_COST.unleash, cd: 22, band: [0, 9], want: 'cornered',
    label: 'UNLEASH', color: '#ffd24a', sound: 'push',
  },
};

/* ══════════════════════════════════════════════════════════════════════ */
/*  Modifiers — the same eight bodies, at depth                           */
/* ══════════════════════════════════════════════════════════════════════ */

/**
 * A wave-20 trooper used to be a wave-2 trooper with more friends. Escalation
 * was one number — the director's budget — so depth bought QUANTITY and never
 * anything else, and the fight you learned at wave 5 was the fight you were
 * still having at wave 25.
 *
 * A modifier is an elite variant applied on spawn. Three rules hold it honest:
 *
 * 1. IT IS DATA. A modifier is a patch on the archetype (`scale` multiplies,
 *    `set` replaces) plus an optional `install` for the parts that are meshes
 *    and behaviour. `applyModifier` copies the archetype before patching, so an
 *    elite carries its own `A` and nothing an elite does can leak back into the
 *    shared table and follow the player into their next run. Anything headless —
 *    the balance harness, the checks below — can read the whole escalation model
 *    off this object without executing a frame.
 *
 * 2. IT IS PAID FOR. `modifierThreat` is what the wave director spends, and it
 *    is a function of the BASE archetype: a shielded droid and a shielded
 *    droideka are not the same purchase. An elite wave costs the same threat as
 *    a plain one, so depth changes the SHAPE of a wave rather than secretly
 *    tripling it. `tools/checks/escalation.mjs` asserts the queue never spends
 *    more than the budget.
 *
 * 3. IT READS AT ENGAGEMENT RANGE. Every modifier below names the tell it puts
 *    on the body, and each tell is either on a bone's PRIMARY mesh — which the
 *    LOD never culls, because it is the silhouette — or a mesh added after the
 *    constructor's `_collectLodParts` ran, which is therefore not in `_lodParts`
 *    and never hidden either. A difficulty you cannot see coming is not
 *    difficulty, it is a surprise.
 *
 * And everything here survives being cut apart, because everything in this game
 * is cut apart. Geometry a modifier adds is parented to a BONE, so `Actor.cut`
 * hands it to the DetachedPiece with the limb it was sitting past, and
 * `Actor.goRagdoll` re-homes it onto that bone's holder — the same two paths
 * every rivet and armour plate in Bodies.js already travels. Nothing is
 * parented to `rig.root`, where it would be orphaned the moment the body fell.
 */

/** How much of a leader's aura a nearby ally gets, and how far it reaches. */
export const RALLY = { radius: 9.5, speed: 1.15, damage: 1.25, rate: 0.78, refresh: 0.25 };

/**
 * WHAT DREAD DOES TO ONE BODY — the other end of `Command.js`'s DREAD verb.
 *
 * It is here rather than there for the same reason `RALLY` is: this file owns
 * what a state does to a body, and Command.js owns what it costs, how far it
 * reaches and who is allowed to cast it. Two numbers in two files with one
 * meaning between them is the defect this repository keeps deleting; a state's
 * CONSEQUENCE and a verb's PRICE are two different facts.
 *
 * `aim` is the only figure that needed measuring. `RALLY.rate` is 0.78 — a
 * leader makes a rifle 22% quicker — and morale's own gunnery term already
 * spans lerp(1.65, 0.9), so a body's aim is worth between 0.9 and 1.65 of its
 * stated spread across the whole range of nerve a soldier can have. 1.45 sits
 * inside that band deliberately: a droid that has just had its footing taken
 * from it shoots about as badly as a man who is frightened, and no worse,
 * because a power that simply switched the enemy's guns off would not be a
 * disruption, it would be a stun with a story.
 *
 * `recoil` is the physics face of it, in metres per second of shove, and it
 * carries NO damage: see `CommandDirector.castForce`.
 */
export const DREAD = { aim: 1.45, recoil: 4.2 };

/** The unstable core: how long the fuse burns, and what the blast is worth. */
export const UNSTABLE = { fuse: 0.85, radius: 5.0, damage: 34, impulse: 15 };

/**
 * What an elite deflector holds, as a share of the body's own health — bounded
 * at both ends. Unbounded it read `maxHp * 2.2`, which is 62 on a B1 (a rounding
 * error) and 1364 on a walker (more than everything else in the wave put
 * together). The droideka's own generator carries 260; an elite's sits either
 * side of it.
 */
function shieldPool(maxHp) { return clamp(maxHp * 1.6, 90, 300); }

export const MODIFIERS = {
  frenzied: {
    label: 'Frenzied',
    // The tell is MOTION first — it arrives while its wave is still walking —
    // backed by a hot rim on the limb tubes so a still one still reads.
    tell: 'half again as fast as everything around it, and lit from the inside',
    since: 3,
    threat: { mul: 0.95, flat: 1.4 },
    allow: (A) => !A.boss && !A.big && !A.inert && !A.training && A.speed > 0,
    scale: { hp: 0.58, speed: 1.5, fireRate: 0.68, score: 1.4 },
    install: (e) => tintBones(e, 0xff3a12, 1.5),
  },

  shielded: {
    label: 'Shielded',
    tell: 'a deflector bubble a metre across, lit and rippling',
    since: 6,
    threat: { mul: 1.0, flat: 3.2 },
    // A droideka already has one; a second is not a modifier, it is a typo.
    allow: (A) => !A.boss && !A.inert && !A.training && !A.shield,
    scale: { speed: 0.94, score: 1.6 },
    install: installShield,
  },

  marksman: {
    label: 'Marksman',
    // The red targeting line and its rising tone: 0.9 s of warning, drawn from
    // the muzzle to your chest, which is the whole of the counter-play.
    tell: 'a red targeting line on your chest, and most of a second to leave it',
    since: 7,
    threat: { mul: 0.9, flat: 2.8 },
    /**
     * …AND NOT ON ANYTHING THAT FLIES, which is `!A.flight`.
     *
     * The whole content of this modifier is the STAND-OFF: `preferred: [20, 38]`
     * plus a targeting line you are meant to walk out of. Both halves fail on a
     * flyer, and they fail in opposite directions.
     *
     * The band is overwritten. `Flight.flightStep` writes `A.preferred` every
     * frame — the cycle's whole point is that the body closes when it stoops —
     * so this `set` would be a field written at promotion and never read again,
     * which is HANDOFF §2.3's close relative wearing an elite's colours.
     *
     * And if it were not overwritten it would be worse: a sniper holding 38 m
     * at five and a half metres of altitude is the one body in the game with no
     * counter at all, which is the "weather" this roster's newest archetype was
     * built specifically to avoid being.
     *
     * `escalation: every modifier is charged for at least the pressure it adds`
     * agrees from the pricing side — a marksman Geonosian came out at 0.89× of
     * what it is worth, the only undercharge on the roster.
     */
    allow: (A) => A.ranged && !A.custom && !A.telegraph && !A.training && !A.flight,
    scale: { damage: 2.4, fireRate: 1.4, score: 1.5 },
    set: { telegraph: 0.9, burst: 1, spread: 0.006, boltColor: BOLT_COLORS.gold, preferred: [20, 38] },
    install: (e) => { tintBones(e, 0xff8a10, 0.45); addScope(e); },
  },

  unstable: {
    label: 'Unstable',
    tell: 'a reactor core pulsing through the chest, and a fuse you can hear',
    since: 5,
    threat: { mul: 0.85, flat: 1.8 },
    allow: (A) => !A.boss && !A.inert && !A.training,
    scale: { hp: 0.75, score: 1.3 },
    install: installCore,
  },

  armoured: {
    label: 'Armoured',
    tell: 'plated shoulders, chest and thighs, and a dead metal finish',
    since: 8,
    // The dearest modifier on a heavy chassis, and it should be: a durasteel
    // torso takes the blade's fastest route away entirely, so an armoured
    // acolyte is not 1.5 acolytes, it is nearer three. Priced against that
    // measurement rather than against how the number looks.
    threat: { mul: 2.0, flat: 2.6 },
    // Rig-built humanoids only: the plates are authored against a humanoid
    // skeleton and a walker has no clavicles to hang them from.
    allow: (A) => !A.custom && !A.boss && !A.inert && !A.training,
    scale: { hp: 1.5, speed: 0.86, score: 1.7 },
    // `armorPlus` is read by _boneToughness: the TORSO goes to durasteel, the
    // limbs do not. The counter-play is that the legs are still legs.
    set: { armorPlus: true },
    install: installPlates,
  },

  dualist: {
    label: 'Dual-Wielding',
    tell: 'two lit blades — the brightest thing in the wave, at any range',
    since: 9,
    threat: { mul: 1.25, flat: 3.6 },
    allow: (A) => !!A.saber && !!A.melee && !A.boss && !A.training,
    scale: { damage: 1.12, score: 1.8 },
    install: installOffhand,
  },

  leader: {
    label: 'Leader',
    tell: 'a standard burning on its back, and a ring on the ground showing exactly who it is helping',
    since: 11,
    threat: { mul: 1.4, flat: 5.0 },
    allow: (A) => !A.boss && !A.big && !A.inert && !A.training,
    scale: { hp: 1.5, score: 2.2 },
    install: installStandard,
  },
};

export const MODIFIER_KEYS = Object.keys(MODIFIERS);

/**
 * What the director pays for one elite, in the same currency as `A.threat`.
 *
 * A function of the BASE archetype rather than a flat surcharge, because
 * "shielded" is worth more bolted to a droideka than to a B1 and a flat number
 * would make elite B1s the cheapest threat in the game.
 */
export function modifierThreat(type, key) {
  const A = ARCHETYPES[type];
  if (!A) return 0;
  const M = MODIFIERS[key];
  if (!M) return A.threat;
  return A.threat * M.threat.mul + M.threat.flat;
}

/** Which modifiers this archetype can wear at all. */
export function modifiersFor(type) {
  const A = ARCHETYPES[type];
  if (!A) return [];
  return MODIFIER_KEYS.filter(k => MODIFIERS[k].allow(A));
}

/**
 * Promote a freshly spawned enemy to an elite.
 *
 * Post-construction because `World.spawnEnemy(type, pos)` is the only door in
 * and it takes no options — so the numbers the constructor read off the shared
 * archetype are re-derived here rather than being read twice. Health is reset
 * outright (a spawn is at full), while speed and damage are SCALED so the
 * per-body jitter and the difficulty factor the constructor rolled survive.
 *
 * @returns {boolean} whether the modifier actually went on.
 */
export function applyModifier(e, key) {
  const M = MODIFIERS[key];
  if (!e || !M || e.mod || e.dead) return false;
  const base = e.A;
  if (!M.allow(base)) return false;

  const A = { ...base };
  for (const [k, v] of Object.entries(M.scale || {})) {
    if (typeof A[k] === 'number') A[k] *= v;
  }
  Object.assign(A, M.set || {});
  A.label = `${M.label} ${base.label}`;
  A.threat = modifierThreat(e.type, key);
  A.elite = key;
  e.A = A;
  e.mod = key;
  e.modLabel = M.label;

  e.maxHp = A.hp * (e.world.hpScale ?? 1);
  e.hp = e.maxHp;
  e.speed *= M.scale?.speed ?? 1;
  e.attackDamage *= M.scale?.damage ?? 1;
  // The duel brain reads timeScale as "how fast this form runs"; a frenzied
  // duellist has to actually swing faster, not merely walk faster.
  if (e.duel && M.scale?.fireRate) e.duel.timeScale /= M.scale.fireRate;

  M.install?.(e);
  return true;
}

/* ── the tells ───────────────────────────────────────────────────────── */

const _tintTarget = new THREE.Color();

/**
 * Recolour the bone PRIMARIES — the limb tubes — and nothing else.
 *
 * The primaries are the one part of a body the LOD never culls (see
 * `_applyLod`: `keep` is exactly `bone.primary`), so a tint on them is the only
 * colour signal that survives out to the 56 m spawn ring. Materials are CLONED
 * first: Bodies.js hands every B1 in the wave the same MeshStandardMaterial
 * instance, and tinting it in place would turn the whole army red.
 */
function tintBones(e, hex, strength = 1) {
  _tintTarget.setHex(hex);
  const cloned = e._modMaterials || (e._modMaterials = []);
  const paint = (m) => {
    if (!m || !m.material || Array.isArray(m.material)) return;
    const mat = m.material.clone();
    if (mat.emissive) {
      mat.emissive.copy(_tintTarget);
      mat.emissiveIntensity = strength;
    }
    if (mat.color) mat.color.lerp(_tintTarget, Math.min(0.35 * strength, 0.55));
    m.material = mat;
    cloned.push(mat);
  };
  if (e.rig) {
    for (const b of e.rig.list) paint(b.primary);
    return;
  }
  // A droideka is a baked group rather than a bone rig, and it can wear the
  // same modifiers. Its meshes ARE its silhouette — Kit bakes them down to a
  // handful — so painting them all is the same claim on the same channel, not
  // a second implementation of the tell.
  if (e.group) e.group.traverse((o) => { if (o.isMesh) paint(o); });
}

/** The shell material for an elite deflector — the droideka's, standalone. */
function eliteShieldMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: { uColor: { value: new THREE.Color(0x7fe6ff) }, uTime: { value: 0 }, uPower: { value: 0.85 } },
    vertexShader: `varying vec3 vN; varying vec3 vV; varying vec3 vP;
      void main(){ vec4 mv = modelViewMatrix*vec4(position,1.); vN = normalize(normalMatrix*normal);
        vV = normalize(-mv.xyz); vP = position; gl_Position = projectionMatrix*mv; }`,
    fragmentShader: `uniform vec3 uColor; uniform float uTime; uniform float uPower;
      varying vec3 vN; varying vec3 vV; varying vec3 vP;
      void main(){
        float fres = pow(1.0-abs(dot(normalize(vN),normalize(vV))), 2.2);
        float hexes = sin(vP.x*22.0)*sin(vP.y*22.0)*sin(vP.z*22.0);
        float ripple = 0.5+0.5*sin(vP.y*12.0 - uTime*3.4);
        float a = (fres*0.9 + max(hexes,0.0)*0.16 + ripple*0.06) * uPower;
        gl_FragColor = vec4(uColor*(a*2.4), a);
      }`,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
  });
}

/**
 * A deflector bubble on a body that was not built with one.
 *
 * Scene-parented rather than bone-parented, and driven from `aimPoint` every
 * frame: a bubble hung off the chest bone would ride the ragdoll and leave a
 * corpse glowing, and one hung off `rig.root` would not move at all, because
 * this rig's bones are posed in world space under a root that never leaves the
 * origin. `die()` hides it, `dispose()` frees it.
 */
function installShield(e) {
  const S = e.A.scale ?? 1;
  // A humanoid's bubble wraps the whole body; a walker's deliberately does NOT
  // reach its feet. `1.9 * S` on a 2.4-scale chassis is a four-and-a-half metre
  // sphere with the legs inside it and no way past, and "no way past" is not a
  // modifier, it is an invulnerability. Chassis covered, legs exposed — the same
  // bargain Armoured strikes with its durasteel torso.
  const r = e.A.big ? 2.6 : 1.05 * S;
  const mat = eliteShieldMaterial();
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(r, 20, 14), mat);
  mesh.frustumCulled = false;
  mesh.position.copy(e.shieldCentre());
  e.world.scene.add(mesh);
  e.shieldMesh = mesh;
  e.shieldMat = mat;
  e.shieldRadius = r;
  e.shieldMax = shieldPool(e.maxHp);
  e.shieldHp = e.shieldMax;
  e.shieldUp = true;
  e.deployTimer = 0;
}

/**
 * A reactor that is about to stop being one.
 *
 * Parented to the chest bone so it goes where the chest goes: severed with the
 * torso it rides the DetachedPiece, and on a ragdoll `goRagdoll` re-homes it
 * onto the chest's holder. Both paths force `visible = true`, which is why this
 * is a mesh on a bone and not a sprite bolted to the scene.
 */
function installCore(e) {
  const S = e.A.scale ?? 1;
  const mat = new THREE.MeshBasicMaterial({ color: 0xff5a20, toneMapped: false,
    transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(0.12 * S, 10, 8), mat);
  const host = e.rig?.get('chest') || e.rig?.get('spine') || e.rig?.get('body');
  if (host) { mesh.position.set(0, host.length * 0.5, 0.1 * S); host.obj.add(mesh); }
  else if (e.group) { mesh.position.y = 0.6 * S; e.group.add(mesh); }
  else return;
  e.coreMesh = mesh;
  (e._modMaterials || (e._modMaterials = [])).push(mat);
  e.fuse = 0;
}

/**
 * Plate the torso and the big limbs.
 *
 * Every plate is a child of the bone it armours, which is what makes it behave:
 * cut the thigh and the thigh plate leaves with the leg, because `Actor.cut`
 * adopts any child sitting past the cut into the piece; cut above it and it
 * stays on the stub. `noDetach` is deliberately NOT set — an armour plate is
 * part of the limb, not part of the body.
 */
function installPlates(e) {
  if (!e.rig) return;
  const S = e.A.scale ?? 1;
  const mat = new THREE.MeshStandardMaterial({ color: 0x30343c, roughness: 0.42, metalness: 0.85 });
  (e._modMaterials || (e._modMaterials = [])).push(mat);
  const plates = e._modMeshes || (e._modMeshes = []);
  const bolt = (boneName, w, h, d, y, z = 0) => {
    const b = e.rig.get(boneName);
    if (!b) return;
    const m = new THREE.Mesh(plateGeo(w * S, h * S, d * S, 0.01 * S, 1), mat);
    m.position.set(0, y * b.length, z * S);
    m.castShadow = true;
    b.obj.add(m);
    plates.push(m);
  };
  bolt('chest', 0.40, 0.30, 0.30, 0.5, 0.03);
  bolt('spine', 0.36, 0.22, 0.28, 0.5, 0.02);
  bolt('armL', 0.20, 0.16, 0.20, 0.16);
  bolt('armR', 0.20, 0.16, 0.20, 0.16);
  bolt('thighL', 0.17, 0.26, 0.17, 0.42);
  bolt('thighR', 0.17, 0.26, 0.17, 0.42);
  tintBones(e, 0x3a4048, 0.12);
}

/** A long optic on the blaster, so the shooter reads before the laser does. */
function addScope(e) {
  if (!e.weapon) return;
  const S = e.A.scale ?? 1;
  const mat = new THREE.MeshStandardMaterial({ color: 0x1a1d22, roughness: 0.5, metalness: 0.7 });
  const glass = new THREE.MeshBasicMaterial({ color: 0xff8a10, toneMapped: false });
  (e._modMaterials || (e._modMaterials = [])).push(mat, glass);
  const tube = new THREE.Mesh(new THREE.CylinderGeometry(0.017 * S, 0.017 * S, 0.26 * S, 8), mat);
  tube.rotation.x = Math.PI / 2;
  tube.position.set(0, 0.055 * S, 0.10 * S);
  e.weapon.add(tube);
  const lens = new THREE.Mesh(new THREE.CircleGeometry(0.016 * S, 8), glass);
  lens.position.set(0, 0.055 * S, -0.072 * S);
  lens.rotation.y = Math.PI;
  e.weapon.add(lens);
  (e._modMeshes || (e._modMeshes = [])).push(tube, lens);
}

/**
 * A second blade in the off hand.
 *
 * It is a real Saber, posed every frame from the left hand, and it is the
 * loudest tell in the game — a lit blade is emissive and self-luminous, so it
 * reads at the far end of the spawn ring where a colour tint would not. It also
 * has an answer: `_loseLimbBehaviour` retracts it the moment the left arm comes
 * off, so taking the arm takes the weapon, exactly as it does for the main one.
 */
function installOffhand(e) {
  if (!e.saber || !e.rig) return;
  e.offSaber = new Saber(e.world.scene, {
    colorIndex: e.A.saberColor ?? 4, bladeLength: 1.04, hiltStyle: e.A.hilt ?? 'Sentinel',
  });
  e.offSaber.ignite();
  e.offHand = new THREE.Vector3();
  e.offQuat = new THREE.Quaternion();
  e._offPhase = null;
}

/**
 * A standard on the leader's back, and a ring on the ground under it.
 *
 * The ring is not decoration: it is drawn at exactly `RALLY.radius`, so what
 * the player sees is the literal set of enemies being buffed. The standard is a
 * chest child, so it falls with the body and is gone the moment the leader is.
 */
function installStandard(e) {
  const S = e.A.scale ?? 1;
  const pole = new THREE.MeshStandardMaterial({ color: 0x241f18, roughness: 0.8 });
  const flame = new THREE.MeshBasicMaterial({ color: 0xffc24a, toneMapped: false,
    transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false });
  (e._modMaterials || (e._modMaterials = [])).push(pole, flame);
  const host = e.rig?.get('chest') || e.rig?.get('spine') || e.rig?.get('body');
  // A bone if there is one — so the standard falls with the body and rides the
  // piece it was mounted on — and the baked group otherwise, which is what a
  // droideka has instead of a skeleton.
  const parent = host ? host.obj : e.group;
  if (parent) {
    const base = host ? host.length * 0.35 : 0.55 * S;
    const staff = new THREE.Mesh(new THREE.CylinderGeometry(0.022 * S, 0.026 * S, 1.15 * S, 6), pole);
    staff.position.set(0.13 * S, base, -0.16 * S);
    parent.add(staff);
    const beacon = new THREE.Mesh(new THREE.SphereGeometry(0.10 * S, 10, 8), flame);
    beacon.position.set(0.13 * S, base + 0.60 * S, -0.16 * S);
    parent.add(beacon);
    e.beacon = beacon;
    (e._modMeshes || (e._modMeshes = [])).push(staff, beacon);
  }
  const ringMat = new THREE.MeshBasicMaterial({ color: 0xffb03a, toneMapped: false,
    transparent: true, opacity: 0.28, blending: THREE.AdditiveBlending,
    depthWrite: false, side: THREE.DoubleSide });
  (e._modMaterials || (e._modMaterials = [])).push(ringMat);
  const ring = new THREE.Mesh(new THREE.RingGeometry(RALLY.radius - 0.28, RALLY.radius, 48), ringMat);
  ring.rotation.x = -Math.PI / 2;
  ring.frustumCulled = false;
  e.world.scene.add(ring);
  e.rallyRing = ring;
}

/* ══════════════════════════════════════════════════════════════════════ */
/*  Enemy                                                                 */
/* ══════════════════════════════════════════════════════════════════════ */

export class Enemy {
  constructor(world, type, spawn) {
    const A = ARCHETYPES[type] || ARCHETYPES.b1;
    this.id = 'e' + (_enemyId++);
    this.type = type;
    this.A = A;
    this.world = world;
    this.team = 1;
    this.dead = false;
    /** Torn down. Read by `Corpses.update`; written only by `dispose()`. */
    this.disposed = false;
    this.dying = 0;
    /**
     * Can the Force take hold of this at all?
     *
     * This was `!A.big && !A.boss` — a flat size limit that no setting could
     * reach, written before the lift cap existed and left standing after the
     * cap replaced it. It was WRITTEN AND NEVER READ for the whole of that
     * time: the mass gate in `Player.toggleGrip` was the only thing deciding,
     * so the field said "an Acklay can never be lifted" while the game happily
     * lifted one at Force Power 4. Both halves of that were wrong — the rule
     * had been overturned, and it was inert anyway.
     *
     * It is now the ARCHETYPE'S declaration, and it has a reader:
     * `Player._grippableBody`. Default is yes; `Vehicles.js` says no on the
     * AT-TE and the AAT and explains why there. Size does not come into it —
     * the walker, the Acklay and the hailfire droid are all `big` and all
     * liftable, at a price in Force Power.
     */
    this.grippable = A.grippable !== false;
    /**
     * THE SIZE THIS BODY *IS*, WHICH IS NOT ALWAYS THE SIZE IT WAS ASKED TO BE.
     *
     * `A.scale` is a request. `jediLook()` draws a species uniformly from the
     * seven rows of `SPECIES`, one of which is `smallfolk` at `frame.scale`
     * 0.40, and `buildJedi` honours it: a 1.05-scale Temple Guardian comes back
     * as a 0.42-scale rig. Everything downstream that sized itself off `A.scale`
     * was therefore sizing a 0.42 body with a 1.05 number. Measured over 40
     * guardian spawns at seed 4711 before this field existed: 6 of 40 smallfolk
     * (15%), drawn 0.727 m tall against a human's 1.79, standing with the sole
     * 46 mm clear of the floor — 6% of the figure's own height, and it walks on
     * that — and `chestY` 0.45 m ABOVE the top of its own head, which is where
     * the aim assist, every floating notice and the deflector bubble all go.
     * With this field: 0 mm of air under the boot, chest inside the chest.
     *
     * `_build` overwrites this from the rig the builder actually returned, so
     * the authority is the geometry and not the table beside it (HANDOFF 2.3).
     * It is initialised here because `_build` is not the only thing that runs
     * before it — a body with no rig at all (droideka, remote) keeps the
     * archetype's number, which for those is also the truth.
     *
     * WHAT DELIBERATELY STAYS ON `A.scale`: the COMBAT numbers — melee reach,
     * the duel's spacing band, the off-blade cone. That is the same call
     * `Saber.setGripScale` already makes in as many words — "a smaller wielder
     * is not carrying a shorter sword" — and a species roll is not allowed to
     * decide a fight's distances (HANDOFF 6.2). This field is the body's
     * ANATOMY: where its chest is, how wide it stands, how long its cape is.
     */
    this.bodyScale = A.scale ?? 1;
    /* Jittered so a wave that spawns together does not audit together — off a
     * counter and NOT off `rng()`, which is the seeded stream every composed
     * wave, form roll and gait phase in the game is drawn from. One extra call
     * per body constructed would shift all of it, and the failure that
     * produces is a check somewhere else disagreeing about a number nobody
     * touched (HANDOFF §2.4, and `held.mjs` has the same note in full). */
    this._auditT = (_auditPhase = (_auditPhase + 0.137) % AUDIT_EVERY);
    /** On its way up something taller than a step — see CLIMB_RATE. */
    this.climbing = false;
    this.gripped = false;
    /** The `Crew` at this machine's controls, or null. See src/game/Driving.js. */
    this.driven = null;
    /** Seconds of hold left before the lease lapses. See GRIP_LEASE. */
    this.gripLease = 0;
    this.liftTarget = null;
    /**
     * ARRESTED BY A FORCE STOP — the field has this body, and this is the only
     * thing on the class that says so.
     *
     * It is a MARK, not a second freeze. The arrest itself is `stun()`, which
     * is what a parry, a chamber, a lost blade lock, a shove and `topple()` all
     * call and what `_think`, `_move`, `_faceTarget`, `_sustain`, `breakCast`
     * and `_guardOpen` already read — so a frozen body cannot think, walk,
     * turn, shoot, hold a power or keep its guard, and not one of those rules
     * is restated here. What the mark buys is the two things a stun on its own
     * does not say, and both of them are what the player SEES:
     *
     *   `_move`  a stun still carries residual velocity and still falls, so a
     *            body caught mid-air would drift down out of the field. Held,
     *            it hangs exactly where it was caught, the way an arrested bolt
     *            and an arrested crate do.
     *   `_pose`  a stunned body still ANIMATES — it stands there breathing, and
     *            a breathing statue is not a time-stop. Held, the whole solve
     *            is skipped, so the rig, the blade and the robes keep the pose
     *            they were in on the frame of capture and resume from it.
     *
     * Cleared by `Player._freeStasisEnemy`, which every one of the field's
     * endings goes through. See Player._stasisCapture.
     */
    this.stasisHeld = false;
    /** Seconds left of the "just dragged off my feet" window a Force pull
     *  opens. Read by Combat.openness; decayed in update. */
    this.yankT = 0;
    /**
     * FORCE COMPEL: who this one is fighting for, and for how long.
     *
     * `{ target, t }`, or null for a mind of its own. The target is an Enemy —
     * possibly THIS enemy — and while it is set, `_think` uses it in place of
     * whatever `ctx.pickTarget` would have said. Everything else about the
     * brain is untouched on purpose: a compelled droid advances, takes cover,
     * leads its shots and calls out exactly as it always did, at the wrong
     * people. A separate "compelled" behaviour would have been a second AI to
     * maintain and would have looked like a different unit.
     */
    this.compelled = null;

    const diff = world.difficulty;
    this.hp = A.hp * (world.hpScale ?? 1);
    this.maxHp = this.hp;
    this.speed = A.speed * (0.9 + rng() * 0.2) * (diff ? lerp(0.86, 1.12, diff.enemyAggression / 1.25) : 1);
    // NOT `damage`: Enemy also has a damage() METHOD, and an instance property
    // of the same name shadows it. That collision silently broke every way of
    // hurting an enemy except the blade — see the note on damage() below.
    this.attackDamage = A.damage * (world.dmgScale ?? 1);

    this.position = spawn.clone();
    this.position.y = world.terrain ? world.terrain.height(spawn.x, spawn.z) : 0;
    this.velocity = new THREE.Vector3();
    this.facing = rng() * TAU;
    this.grounded = true;
    this.knockTimer = 0;
    this.stunTimer = 0;
    this.attackTimer = rng() * 1.2;
    this.burstLeft = 0;
    this.burstTimer = 0;
    this.aimCharge = 0;
    /** Where the aimed shot is going, fixed when the red line goes up and read
     *  by both the line and the bolt. Null when nothing is being aimed. */
    this.telegraphAim = null;
    this.state = 'approach';

    /* THE OTHER SIDE'S FORCE — see ENEMY_POWERS. `powers` is null for every
     * body that is not a Force user, and `_meleeBrain` tests exactly that, so
     * a droid pays nothing for the feature existing. The pool starts FULL:
     * a duellist that had to stand around regenerating before it could do
     * anything would spend the first exchange — the only one some of them get
     * — being the fencer this is meant to stop them being. */
    this.powers = A.powers && A.powers.length ? A.powers : null;
    this.forceMax = A.force ?? 0;
    this.force = this.forceMax;
    this.powerCd = {};
    if (this.powers) for (const k of this.powers) this.powerCd[k] = 0;
    this._castTimer = 0;
    this._castKey = null;
    this.casting = null;
    this.castLeft = 0;
    this._sustainDebt = 0;
    /** Fight-ending cuts this body can still turn aside — with a blade if it
     *  has one, with its own bulk if it does not. See the notes on
     *  GUARD_PER_HP and HIDE_PER_KG, and `guardFor`, which is the authority. */
    this.guardMax = guardFor(A);
    this.guard = this.guardMax;
    this.guardT = GUARD_REFRESH;
    this.stateTime = 0;
    this.bossPhase = 1;
    this.recentDamage = 0;
    this.windTimer = 0;
    this.strafeDir = rng() < 0.5 ? 1 : -1;
    this.strafeTimer = rng() * 2;
    /**
     * WHAT THE FEET LEARNED LAST FRAME.
     *
     * `_wallN` is the outward normal of whatever the body was pushed off, held
     * for `_wallT` seconds so the wish can be slid along the face instead of
     * pressed into it; `_stuckT` counts how long the body has WANTED to move
     * and not moved. Between them they are the whole of this enemy's
     * navigation, and until they existed there was none at all: an acolyte
     * walked the straight line to the player and ground against the first wall
     * on it for the rest of the fight.
     */
    this._wallN = new THREE.Vector3();
    this._wallT = 0;
    this._stuckT = 0;
    this._prevPos = new THREE.Vector3();
    /** Time left on a Leader's aura. Refreshed by whoever is leading. */
    this.rallyTimer = 0;
    /**
     * Time left on the DREAD a commander put on this body. Same shape as
     * `rallyTimer` on purpose — a timer that drains in `update` and is read as
     * a boolean wherever it bites — because a second idiom for "a battlefield
     * state with a clock on it" is a second thing to keep in step. See DREAD.
     */
    this.dread = 0;
    /**
     * THIS BODY'S OWN NERVE, 0..1 — FLAGSHIP §7's BREAK verb, for a body with
     * no roster record to keep one on.
     *
     * `aimQuality`'s own comment used to end "bodies with no morale (the horde)
     * read 1", which was true and was the whole problem: §7's first verb is
     * "walk into the front of a formation and it comes apart", and outside a
     * meeting between two human commanders there was no formation with a nerve
     * in it to come apart. See src/game/Nerve.js, which owns the table, the
     * routing and the two thresholds — both of them MORALE's, because a
     * soldier losing his nerve is one event.
     *
     * Starts at 1 and drifts back to 1, so nothing in the shipped game moves
     * until a player is standing in the rank.
     */
    this.nerve = NERVE.START;
    /** Which modifier this body wears, if any — see MODIFIERS. */
    this.mod = null;
    this.fuse = 0;
    this.target = null;
    this.lastSeen = 0;
    this.lod = 0;
    /**
     * The static boxes near enough to stand on, rebuilt once a frame by
     * `_gatherNear` — the enemy's half of what `Player._nearBoxes` has always
     * been. `_nearAt` is where it was gathered and `_nearStale` forces the
     * first rebuild of each frame, so a box that destruction added or removed
     * since the last one is picked up. See NEAR_REACH.
     */
    this._nearBoxes = [];
    this._nearAt = new THREE.Vector3();
    this._nearStale = true;
    /** Queries the short list could not answer for, so they took the whole
     *  array. Expected to stay at zero; the gait check reports it, and drives
     *  the fallback deliberately because nothing else ever reaches it. */
    this._nearMisses = 0;

    this._build();

    /**
     * Movement proxy so bodies and players collide with a living enemy.
     *
     * ONE SHAPE FOR EVERY HEAVY WAS THE DEFECT. `capsule(0.9, 1.1)` for
     * anything `big` is right for a droideka and wrong for a thirteen-metre
     * walker: measured by tools/_vehicle.mjs, a player met **0% of an AT-TE's
     * hull** and 27% of an AAT's, because the proxy is a 2.2 m column at the
     * centre while the AT-TE's hull starts 2.3 m up and runs 6.4 m fore and aft
     * of it. You walked through the machine.
     *
     * That is player note #8 in its own words — "the majority of objects are
     * still not physical, like you just fall through them" — so a builder may
     * now publish `built.proxy`, a sphere chain GENERATED off the hull it just
     * built rather than typed into the archetype table beside it (HANDOFF 2.3:
     * a hand-written collider next to a procedural hull drifts silently the
     * first time somebody moves a plate). `Body` already accepts an arbitrary
     * sphere list and the contact solver already walks it, so nothing below
     * changes. Bodies that publish nothing keep the capsule exactly as before.
     */
    const P = this.built?.proxy;
    const r = P?.radius ?? (A.big ? 1.1 : 0.36);
    this.radius = r;
    this.body = new Body({
      position: this.position.clone().setY(this.position.y + (P?.y ?? (A.big ? 1.4 : 0.9))),
      spheres: P?.spheres ?? capsuleSpheres(A.big ? 0.9 : 0.55, r, 'y', 3),
      shape: capsule(A.big ? 0.9 : 0.55, r),
      mass: A.mass, kinematic: true, layer: LAYER.ENEMY,
      /* Same defect and same measurement as the player's proxy — see the note
       * over `this.body` in Player.js. `LAYER.WORLD` alone meant a crate, a
       * chunk of a broken wall or a rolling barrel passed straight through
       * every living enemy in the game and came to rest on the floor inside
       * them, while Props.js and Destruction.js both name `LAYER.ENEMY` in
       * their masks on the understanding that it does not. RAGDOLL is absent
       * because the corpse's own mask (Ragdoll.js) does not name ENEMY, so it
       * would be half a pair and therefore inert. */
      mask: LAYER.WORLD | LAYER.PROP | LAYER.DEBRIS,
      allowSleep: false, gravityScale: 0,
    });
    this.body.userData.enemy = this;
    world.physics.add(this.body);

    this._caps = [];
    this._collectLodParts();
  }

  /**
   * Rendering LOD.
   *
   * These models carry a lot of small detail — panel lines, rivets, vents,
   * fasteners — and each of those pieces is a draw call. An acolyte is 56
   * meshes and a spider walker 66, so twenty of them on screen is over a
   * thousand draw calls before the shadow pass doubles it. None of that detail
   * is resolvable past about thirty metres.
   *
   * So the detail is CULLED by distance, not just skipped in the solve. The
   * limb tubes the rig builds (bone.primary) always stay, because they are the
   * silhouette and the silhouette is what you fight by; everything else goes.
   * Measured on an acolyte: 56 meshes at LOD 0, 20 at LOD 1, 20 at LOD 2.
   *
   * …AND AT LOD 2 THE SURVIVORS ARE ONE MESH. See src/game/MergedSkin.js: the
   * kept set is baked into one SkinnedMesh per material bin, weight 1.0 per
   * vertex, which is the rigid parenting the scene graph was already doing
   * written as a draw call instead of twenty-six.
   *
   * …AND AT LOD 3 THE BODY STOPS DRAWING ITSELF ALTOGETHER. See
   * src/game/Cohorts.js: past the distance the ink prepass reaches, every body
   * of one kind is an instance in one shared mesh, so the cost stops depending
   * on how many of them there are. `undarken` is first here because the cohort
   * is the only thing that hides a body wholesale, and every rung below it has
   * to start from a body that owns its own meshes again.
   *
   * Measured on a `high` World on geonosis, the same 42 bodies at each rung:
   *
   *     LOD 1 / 2 cull only     1064 draw calls
   *     LOD 2 merged skins       194
   *     LOD 3 cohorts             27
   */
  _applyLod(lod) {
    if (!this.rig || !this._lodParts) return;
    const showDetail = lod === 0;
    undarken(this);
    for (const m of this._lodParts) m.visible = showDetail;
    applyBodyLod(this, lod);
    // far away, drop the shadow pass too — a 60m silhouette contributes
    // nothing to a shadow map that covers 34m
    if (this._lodShadow !== (lod < 2)) {
      this._lodShadow = lod < 2;
      this.rig.root.traverse((o) => { if (o.isMesh) o.castShadow = this._lodShadow; });
    }
  }

  /**
   * Collect the meshes that are decoration rather than silhouette.
   *
   * …AND `userData.silhouette` IS THE OTHER HALF OF "SPHERE WITH SOME LEGS".
   *
   * One primary per bone is right for a droid, whose outline really is its
   * limb tubes and whose rivets really are noise. It is catastrophic for an
   * animal: a reek's horns, a nexu's mane, an acklay's crest and every tail in
   * the game were Kit detail, so past thirty metres the whole menagerie was
   * its trunk plus its legs and nothing else — which is exactly the sentence
   * the player used. Bodies.js tags the merged outline pieces (see
   * `markSilhouette`) and they are kept at every range. It is at most two
   * extra draw calls per creature, on bodies there are never more than a
   * handful of, against the thing they are recognised BY.
   */
  _collectLodParts() {
    if (!this.rig) return;
    const keep = new Set();
    for (const b of this.rig.list) { if (b.primary) keep.add(b.primary); }
    this._lodParts = [];
    this.rig.root.traverse((o) => {
      if (o.isMesh && !keep.has(o) && !o.userData.silhouette) this._lodParts.push(o);
    });
    this._lodShadow = true;
  }

  _build() {
    const A = this.A;
    /* THE ARCHETYPE'S OWN IDENTITY REACHES THE BUILDER. Without the spread this
     * was `{ scale: A.scale }` and a one-line special case for the marksman's
     * paint, so every kit table in Bodies.js — the trooper hardware, the Jedi
     * ranks, the B1 and acolyte and bodyguard rungs — was reachable, measured,
     * and worn by nothing that ever spawned. `BODY_KITS` is the authority and
     * `bodyOptsFor` is its only reader; see the long note over it. Measured in
     * the shipped roster: trooper/sniper and acolyte/sparring sat at 1.000
     * flank IoU — identical silhouettes at 30 m — and the roster's worst pair
     * drops to 0.895 with this line in. */
    const opts = { scale: A.scale, ...(bodyOptsFor(this.type) || {}) };
    if (this.type === 'sniper') { opts.color = A.trooperColor; opts.accent = A.accent; }
    const built = A.build(opts);
    this.built = built;

    if (built.rig) {
      this.rig = built.rig;
      // The builder is the authority on how big this body came out — see the
      // note on `bodyScale` in the constructor. `Rig` records the scale it was
      // laid out at, so this is a read of the geometry and not a second guess
      // at it.
      this.bodyScale = this.rig.scale ?? this.bodyScale;
      this.world.scene.add(this.rig.root);
      this.actor = new Actor(this.world.scene, this.world.physics, this.rig, {
        mass: A.mass, layer: LAYER.RAGDOLL, bladeColor: 0x57c9ff,
        onSever: (bone, point) => this._onSever(bone, point),
      });
      this.humanoid = !A.custom || A.custom === 'humanoid';
      if (this.humanoid) {
        /* `this.bodyScale`, not `A.scale`. BipedAnimator takes ankleY, footLen,
         * stanceWidth, kneeIn and stepTrigger all from this one argument, so a
         * 0.42-scale smallfolk Jedi was being planted on a 1.05 ankle — 74 mm
         * of air under the boot on average and 232 mm at worst. `hipHeight` is
         * scaled by the same argument inside the animator, so it stays a
         * fraction and not a metre count. */
        this.animator = new BipedAnimator(this.rig, { scale: this.bodyScale, hipHeight: A.hipHeight ?? 0.95 });
        this.animator.onFootstep = (p) => {
          if (this.lod > 1) return;
          audio.step(p, this.world.terrain ? this.world.terrain.surfaceAt(p.x, p.z) : 'sand');
          this.world.particles?.sandPuff(p.clone(), 0.16, p.y, this.world.groundColor);
        };
      } else {
        this.walkPhase = rng();
      }
    } else {
      // droideka / training remote: a bespoke group rather than a bone rig
      this.group = built.group;
      this.world.scene.add(this.group);
      if (A.custom === 'remote') {
        /* DRAW ORDER IS LOAD-BEARING. These two `rng()` calls were originally
         * hover-then-orbit, and moving the hover draw out of this branch
         * silently swapped them — same number of draws, different values, and
         * every seeded remote in the dojo landed somewhere new. It surfaced as
         * a training lesson placing its body in the wrong spot. The generic
         * `float` initialiser below is written not to take a draw when this
         * branch has already taken one. */
        this.hoverPhase = rng() * TAU;
        this.orbitPhase = rng() * TAU;
      }
    }

    /**
     * ANYTHING THAT HOVERS NEEDS A PHASE, and this used to be initialised in
     * exactly one branch of the wrong `if`.
     *
     * `hoverPhase` lived inside the `else` above — the branch for bodies built
     * as a bare `group` — and was gated further on `custom === 'remote'`. The
     * Jet Trooper (note #31) is a RIGGED HUMANOID with `float: 1.35`, so it
     * takes the `built.rig` branch and never got the field. Its first frame
     * then ran `this.hoverPhase += dt` on `undefined`, which is NaN, and NaN
     * propagates:
     *
     *   · the hover target is NaN, so `position.y` is NaN from frame 0;
     *   · the range to the target is a 3-D length, so every test in
     *     `_rangedBrain` is false and the body NEVER FIRES — measured, 0 shots
     *     in 45 s against a trooper's 33;
     *   · `positionIsValid` (Waves.js) rejects non-finite y, so the liveness
     *     watchdog rescues it twice and then RETIRES it.
     *
     * Every jet trooper ever spawned was teleported twice and deleted without
     * taking a shot. It is in the geonosis pool and is a purchasable Command
     * rung, so the player paid for it.
     *
     * It is set here, unconditionally, for anything that declares `float` —
     * keyed off the DATUM that makes a body hover rather than off which
     * builder it happened to use, which is the distinction the old gate got
     * wrong. `remote` keeps its own `orbitPhase` above because only it orbits.
     */
    if (A.float && this.hoverPhase === undefined) this.hoverPhase = rng() * TAU;

    /**
     * …AND THE SAME HOLE SWALLOWED THE DROIDEKA'S LEGS.
     *
     * `walkPhase` was initialised in the rigged-but-not-biped branch only, and
     * a droideka is neither: it is the `else` above, a bespoke group. So
     * `_poseDroideka` ran `(undefined + dt * …) % 1` on its first frame, and
     * NaN sticks — it feeds back into itself every frame after. The visible
     * end of it is in `capsules()`, which reads the leg bones' world
     * positions: every droideka in the game presented THREE LEG CAPSULES WITH
     * A NON-FINITE ENDPOINT, and `segmentNear` answers a NaN segment with a
     * miss. Its legs could not be shot off and could not be cut off, so the
     * topple at two legs lost (`legsLost >= 2`) was unreachable and the only
     * way to stop one was its core.
     *
     * Keyed off having the field rather than off which builder ran, for the
     * reason the note above gives.
     */
    if (this.walkPhase === undefined) this.walkPhase = rng();

    // weapon
    if (A.weapon) {
      this.weapon = buildBlaster(A.weapon);
      const hand = this.rig?.get('handR');
      if (hand) { hand.obj.add(this.weapon); this.weapon.position.set(0, 0.06 * this.bodyScale, 0.02); this.weapon.rotation.x = -0.2; }
    }
    if (A.saber) {
      /**
       * …AND IT IS NOT ALWAYS A LIGHTSABRE. The player: "sometimes I see my
       * own troops and they have light sabers and I don't know why, unless
       * they are other jedi or sith that are helping you it doesn't make sense
       * for a fucking droid to be holding a lightsaber."
       *
       * They were reading the roster correctly. `bx` and `magna` are both
       * rungs of the SEPARATIST ladder, so a Sith player's own line carries
       * them, and both were `saber: true` — which is the flag that routes a
       * body through `DuelBrain`, and which was ALSO deciding what the weapon
       * looked like. Their own archetype notes had already admitted the gap:
       * Command.js calls the BX's weapon "a VIBROSWORD… which puts a glowing
       * blade in a commando droid's hand", and Bodies.js builds the scabbard
       * for it down the chassis's spine.
       *
       * `weapon` is the look and `saber` stays the brain. Everything the fight
       * reads — length, sweep, `cutPowerAt`, the clash, the duel — is
       * identical, so a BX cuts exactly as hard as it did and no longer glows.
       */
      this.saber = new Saber(this.world.scene, {
        colorIndex: A.saberColor ?? 4, bladeLength: A.bladeLength ?? 1.12,
        hiltStyle: A.hilt ?? 'Sentinel', weaponStyle: A.weaponStyle ?? null,
      });
      this.saber.ignite();
      /* A SWORD DOES NOT HUM. `createHum` is the plasma loop, and thirty
       * commando droids each running one is also thirty oscillators in a mode
       * built to field thirty of them. */
      if (!this.saber.physical) {
        this.hum = audio.createHum(this.saber.color.getHex());
        this.hum.ignite();
      }
      this.telegraphArc = new Telegraph(this.world.scene);
      /**
       * THE DIE ROLL IS NOW UNREACHABLE FROM THE SHIPPED ROSTER, and it was
       * reached by the three commonest sabered bodies in the game.
       *
       * `A.form || FORM_KEYS[floor(rng() * 5)]` is the line the note over
       * JEDI_BASE describes as the reason a player "could not learn 'that is
       * Djem So, it commits hard, punish the recovery'". Six archetypes were
       * given a declared form when that was written and three were not: the
       * ACOLYTE (12 of 101 pool slots and the only duellist on seven levels),
       * the SPARRING PARTNER (the dojo, whose entire job is to be learnable)
       * and the IG BODYGUARD (a boss). All three declare one now.
       *
       * The fallback stays because a level or a mode may spawn a sabered body
       * that no archetype table owns, and a duellist with no form at all cannot
       * fight. `tools/checks/duelling.mjs` holds the roster to declaring one.
       */
      this.duel = new DuelBrain(this, {
        form: A.form || FORM_KEYS[Math.floor(rng() * FORM_KEYS.length)],
        telegraph: this.telegraphArc,
      });
      this.formName = this.duel.describe();
      this.saberHand = new THREE.Vector3();
      this.saberQuat = new THREE.Quaternion();
      /**
       * THE CAPE IS THE COLOUR OF THE ROBE THAT WAS ACTUALLY BUILT.
       *
       * This read `this.type === 'sparring' ? 0x2c3742 : 0x14151a` — a
       * two-branch list of archetype KEYS, which is the copied-table defect
       * this file already carries a note about, and it answered BLACK for every
       * body that was not the sparring partner. That was invisible while the
       * only caped enemy was an acolyte in a black coat. The Jedi draw a robe
       * per body out of ROBE_COLORS, so the same line would have put an
       * acolyte's black cape over a sand robe on 5 of every 6 of them.
       *
       * `built.palette.robe` is the ROBE_COLORS ROW the builder chose for THIS
       * body — buildJedi has returned it all along — so the cape is derived
       * from the garment under it rather than from a number typed beside a
       * type name, and a robe added to that table tomorrow is caped correctly
       * without this line being touched. Anything with no robe row (the
       * acolyte, whose coat is authored black in Bodies.js) keeps exactly the
       * colour it had.
       */
      const robeHex = built.palette?.robe?.outer;
      /**
       * …AND WHETHER THERE IS A CAPE AT ALL IS THE ARCHETYPE'S TO SAY.
       *
       * Every sabered body used to get one, which was fine while the sabered
       * bodies were an acolyte, its sparring twin and the IG droid. It stops
       * being fine at the temple: Engine.js sizes the whole cloth column on
       * "every enemy wearing exactly one cape", `tools/checks/cloth-cost.mjs`
       * holds that to the letter, and four more caped archetypes with a
       * SIMULATED SKIRT under the cape as well — which `buildJedi` publishes
       * and `buildAcolyte` does not — would have been two garments a body on a
       * body type the level fields in double figures.
       *
       * It is also the right picture, which is what makes it a decision rather
       * than a budget dodge. A Jedi takes the outer robe OFF to fight; it is
       * one of the most consistent images in the source material, and it is
       * exactly what separates these four from the hooded, caped, black-coated
       * acolyte at silhouette range. What they wear is the layered tabard set
       * `buildJedi` builds — which is a lot of cloth-looking geometry, all of
       * it rigid — over the rigid robe below the belt that every other enemy in
       * the game also wears.
       *
       * Both defaults are ON, so nothing that shipped moves: an archetype has
       * to ask NOT to have a cape, and has to ask to have its skirt simulated.
       */
      if (A.cape !== false) {
        this.cloak = attachCloak(this.world.scene, this.rig, {
          // The cape is cut from the BODY's scale. A human's 0.86 m cape on a
          // 0.75 m smallfolk hangs its hem through the floor — the same defect
          // HANDOFF 6.1b measured at 280 mm on the creator's preview figure,
          // alive on the enemy path because this line read the request.
          scale: this.bodyScale, width: 0.34, length: 0.82, cols: 7, rows: 9, flare: 1.0,
          color: robeHex ?? (this.type === 'sparring' ? 0x2c3742 : 0x14151a),
        });
      }
      /**
       * The robe below the belt, simulated rather than three lathes welded to
       * the pelvis — see Player._makeCloak. It replaces the rigid meshes, so it
       * costs the character fewer triangles than it saves.
       *
       * THE `this.cloak` TERM WAS THE THIRD OF THREE GATES AND IT IS GONE.
       * With `cape: false` on JEDI_BASE it could never be true for the only
       * four bodies that publish a `robeSkirt`, so the skirt was reachable only
       * by a body that had both — of which there are none and, given the note
       * above, never will be. A skirt does not need a cape over it; what needed
       * the cape was the `outer` link, which is now made only when there is one
       * to make.
       */
      if (built.robeSkirt && A.simSkirt) {
        this.skirt = attachSkirt(this.world.scene, this.rig, {
          scale: this.bodyScale, rigid: built.robeSkirt,
          // …and the same for the skirt it replaces: the simulated cloth has to
          // come out the colour of the rigid panels it is swapped for, or the
          // body changes colour at LOD range when attachSkirt hands them back.
          color: robeHex ?? (this.type === 'sparring' ? 0x2c3742 : 0x14151a),
          // The belt's two ends take the BELT's material, not the recoloured
          // robe's — the obi they are tied in is still the built one.
          sashMaterial: built.palette.trim,
        });
        if (this.cloak) this.cloak.outer = this.skirt;
      }
    }
    if (A.shield) {
      this.shieldUp = false;
      this.shieldHp = 260;
      this.shieldMax = 260;
      this.deployTimer = 0;
    }
    this._measurePlatform();
  }

  /**
   * THE TOP OF A SPIDER WALKER, AND WHY YOU USED TO FALL THROUGH IT.
   *
   * `Player._supportAt` asks one question of every surface at once — terrain,
   * static boxes, dynamic props — and the comment above it says so: "one query,
   * every surface, highest wins." Enemies were not in the list. `_gatherNear`
   * takes bodies on the PROP, DEBRIS and RAGDOLL layers and skips everything
   * else, so LAYER.ENEMY never reached the query and the player dropped
   * straight through a four-metre chassis as if it were fog. Reported as
   * falling through the giant spiders instead of landing on them.
   *
   * A humanoid gets no platform — landing on a B1's head is not a mechanic, it
   * is a bug with a nicer name. `big` bodies are the walker and the Acklay, and
   * both of them are large enough that leaping onto one and cutting down
   * through it is exactly what the shape of the thing invites.
   *
   * Measured off the built geometry rather than guessed, and measured over the
   * MIDDLE of the hull rather than at its highest point. The bounding box's top
   * is a turret or an antenna at the edge — on the walker that is 0.35 m above
   * the deck, and a player standing there floats over a sloped glacis. So the
   * height is the highest vertex inside the central 60% of the hull's own
   * footprint, which is the flat part you would actually stand on: 1.39 m above
   * the hips bone on a walker, 2.78 on an Acklay.
   *
   * `_poseWalker` puts that bone at `position.y + 1.6·scale` and bobs it with
   * the gait, so the platform bobs too — which is right, and is what makes
   * riding one read as standing on a machine rather than on an invisible shelf.
   */
  _measurePlatform() {
    this.platformTop = 0;
    this.platformRadius = 0;
    if (!this.A.big || !this.rig) return;
    const bone = this.rig.get('body') || this.rig.hipsBone;
    const hips = this.rig.hipsBone;
    if (!bone?.parts?.length || !hips) return;
    this.rig.updateMatrices();
    this.rig.root.updateMatrixWorld(true);
    const hipsY = _v6.setFromMatrixPosition(hips.obj.matrixWorld).y;

    const box = _box.makeEmpty();
    for (const m of bone.parts) if (m.geometry) box.union(_box2.setFromObject(m));
    if (box.isEmpty()) return;
    const halfX = (box.max.x - box.min.x) * 0.5, halfZ = (box.max.z - box.min.z) * 0.5;
    const cx = (box.max.x + box.min.x) * 0.5, cz = (box.max.z + box.min.z) * 0.5;

    const CORE = 0.6;
    let top = -Infinity;
    for (const m of bone.parts) {
      const pos = m.geometry?.attributes?.position;
      if (!pos) continue;
      m.updateWorldMatrix(true, false);
      for (let i = 0; i < pos.count; i++) {
        _v5.fromBufferAttribute(pos, i).applyMatrix4(m.matrixWorld);
        if (Math.abs(_v5.x - cx) > halfX * CORE || Math.abs(_v5.z - cz) > halfZ * CORE) continue;
        if (_v5.y > top) top = _v5.y;
      }
    }
    if (!isFinite(top)) return;
    this.platformTop = top - hipsY;
    // The NARROWER of the two half-spans: a deck you can stand on the corner of
    // is a deck you fall off, and erring narrow means the player has to land on
    // the thing rather than beside it.
    this.platformRadius = Math.min(halfX, halfZ);
  }

  /**
   * The deck, in world units, or null if this body has none.
   *
   * Shaped as `{ position, extent }` because that is what `supportHeight`'s
   * dynamic-prop branch already reads, so a rideable enemy is answered by the
   * same query as a crate and the player cannot tell them apart — which is the
   * whole point of Support.js.
   */
  platform() {
    if (!this.platformRadius || this.dead || this.toppled) return null;
    const hips = this.rig?.hipsBone?.obj;
    if (!hips) return null;
    const p = this._plat || (this._plat = { position: new THREE.Vector3(), extent: new THREE.Vector3() });
    p.position.copy(this.position);
    p.extent.set(this.platformRadius, (hips.position.y + this.platformTop) - this.position.y, this.platformRadius);
    return p;
  }

  /* ── queries ─────────────────────────────────────────────────────── */

  /**
   * Where this body is aimed at, floated over and centred on.
   *
   * `rig.worldPos('chest')` alone was wrong for a third of the roster: `Rig`
   * answers a name it does not know with (0, 0, 0), and neither the walker nor
   * the acklay has a chest — their torso bone is called `body`. So every
   * floating notice over an acklay ("WINDED", "CHARGE", a phase banner) was
   * being drawn at the world origin. The chain ends at the body's own position
   * rather than at a bone, so a rig with no torso at all still lands somewhere
   * real.
   *
   * ── AND A BONE THAT HAS NOT BEEN POSED ANSWERS FROM THE WORLD ORIGIN ─────
   *
   * `Rig.worldPos` reads `bone.obj.matrixWorld`, which is the IDENTITY until
   * something has updated the body — so on the frame a wave spawns, every one
   * of these bones is at (0, 0, 0) and a query about a droid standing 90 m out
   * answers with the middle of the map. `Player._enemyPoint` carries a whole
   * paragraph about that hazard and dodges it by keeping a THIRD opinion of
   * where a chest is (`1.12 · A.scale`), which is HANDOFF §2.3's defect wearing
   * its usual coat: the way to have one answer is to make the one answer safe.
   *
   * So the bone is used only when it is ON THE BODY. `chest` below is
   * `position` plus `1.15 · bodyScale`, so a torso bone more than
   * `3 · bodyScale + 1` metres from this body's own feet is not this body's
   * torso — it is an unposed matrix — and the derived point is the honest
   * answer. Everything that aims, leads, floats a notice or asks for a centre
   * of mass now goes through here or through `chest`, and the two cannot
   * disagree by more than the animation between them.
   */
  aimPoint(out = new THREE.Vector3()) {
    /* ON THE BODY, OR IT IS NOT THIS BODY'S ANSWER. `chestY` is
     * 1.15 · bodyScale above the feet, so anything past three of those plus a
     * metre is outside any pose this roster can strike. Both branches below are
     * guarded by it and NOT just the rig one: the droideka has no torso bone
     * and takes the `group` branch, and a group's `position` is (0,0,0) until
     * `_pose` puts it on the body — measured, `stature.mjs` caught it on this
     * guard's first run, answering 80.3 m away from a body it had been handed. */
    const reach = 3 * this.bodyScale + 1;
    const onBody = () => out.distanceToSquared(this.position) <= reach * reach;
    /**
     * ── AND A BODY LYING IN THE SAND IS AIMED AT WHERE IT IS LYING ────────
     *
     * `aimAt` is the ONE reader every shooter in this game resolves its aim
     * through — the rifle, the telegraphed line, the sight test, the rifle
     * pose, both turret head-tracks — and it asks this method first. The rig
     * branch below is deliberately switched off while the body is limp (a
     * ragdolled rig's bones are driven by the solver and were not trusted
     * here), and what it fell through to is `chest`: `position.y + 1.15 ·
     * bodyScale`. While a body is limp `_move` writes `position` from the
     * RAGDOLL'S OWN CENTRE, so `chest` is a metre and a bit of empty air
     * directly above a man on the floor.
     *
     * MEASURED — `tools/_prone.mjs`, eight B1s in a ring at 12 m on one B1,
     * 60 game-seconds an arm, everything else held identical:
     *
     *     standing   453 shots   131 hits   28.9%    aim 0.66 m BELOW the top
     *     limp       477 shots    10 hits    2.1%    aim 0.92 m ABOVE the top
     *
     * A fourteenfold collapse, and the geometry says why rather than the rate:
     * the point every gun on the field was laying on sat 0.92 m over the
     * highest thing the body actually presents to a bolt. A felled enemy was
     * very nearly immune to gunfire.
     *
     * That is the exact opposite of what the design says a downed body is
     * worth. `Combat.OPEN_STATES` prices `downed` — "toppled, stunned or limp
     * in the sand" — at ×1.5 on every bolt that lands, and FLAGSHIP §7's third
     * verb is "the Force is a multiplier on other people's guns". The
     * multiplier was being applied to a stream of bolts that had been aimed
     * into the air above the target. It went unseen until `knockFlat` started
     * FELLING bodies instead of stunning them upright, which turned a rare
     * state into a common one and made the OPEN lane's landed-damage share
     * move the wrong way (8.2% → 3.7%).
     *
     * A prone body is still a smaller target and still harder to hit — that is
     * honest, it is 0.3 m of silhouette against 1.7 — but it is now shot AT.
     *
     * `Actor.centre` is the same answer `_move`'s LIMP branch and `capsules()`
     * already use for a limp body, so this adds no second opinion about where
     * a ragdoll is; it stops this method being the one reader that had none.
     * `onBody` still guards it, so an actor whose bodies have not been placed
     * yet falls through to the chain below exactly as before.
     */
    if (this.actor?.ragdolled) {
      this.actor.centre(out);
      if (onBody()) return out;
    }
    if (this.rig && !this.actor?.ragdolled) {
      for (const name of ['chest', 'body', 'spine', 'hips']) {
        if (!this.rig.get(name)) continue;
        this.rig.worldPos(name, out);
        return onBody() ? out : out.copy(this.chest);
      }
    }
    if (this.group) {
      out.copy(this.group.position).addScaledVector(UP, 0.8 * this.bodyScale);
      return onBody() ? out : out.copy(this.chest);
    }
    return out.copy(this.chest);
  }

  /**
   * The centre a deflector bubble sits on — geometry, not a bone.
   *
   * Deliberately independent of `aimPoint`: the bubble has to be in the same
   * place on the frame the enemy spawns (before anything has posed the rig) and
   * on the frame it dies, and it has to be right on a chassis whose bones are
   * named nothing in particular.
   */
  shieldCentre(out = new THREE.Vector3()) {
    const S = this.bodyScale;
    // 1.75·S puts it on a walker's chassis (which _poseWalker holds at 1.6·S
    // above the ground) and 1.02·S on a humanoid's chest. Measured against the
    // posed rigs, not guessed: a bubble half a metre below the body reads as a
    // bug rather than as a shield.
    return out.set(this.position.x, this.position.y + (this.A.big ? 1.75 : 1.02) * S, this.position.z);
  }

  /* 1.15 of the BODY's own scale. On `A.scale` this put a smallfolk Jedi's
   * chest 0.45 m above the top of its head — the point every floating notice,
   * every aim assist and every "centre of mass" query in the game reads. */
  get chestY() { return this.position.y + 1.15 * this.bodyScale; }

  /**
   * ── EVERY BODY IN THE GAME HAS A CHEST NOW, AND ONLY THE PLAYER DID ──────
   *
   * `Enemy._shoot` leads its aim on `target.chest ?? target.position`, and so
   * do `_beginTelegraph`, `_hasLineOfSight`, the off blade, the laser, the
   * rifle pose and both turret head-tracks. `Player.chest` is a real field;
   * NOTHING ELSE HAD ONE. So every one of those fell through to `position` —
   * which is at the FEET — for your named troopers, for the horde, and for
   * every body on the field except the one the player is standing in.
   *
   * It was found from the wrong end. A "men crouch under fire" lever measured
   * WORSE THAN NOTHING — 0.6 survivors against 1.8 — because crouching pulls a
   * man DOWN, which on a shooter aiming at his boots is walking into the shot.
   *
   * The quantity was already here: `chestY` above, and its own comment calls it
   * "the point every aim assist and every centre-of-mass query in the game
   * reads". The shooter was the one reader not using it. This is that number in
   * a vector, so that a body is asked where its chest is in exactly the way a
   * Player is asked, and no call site has to know which of the two it holds.
   *
   * ITS OWN VECTOR PER BODY, and derived on every read rather than written once
   * a frame. A module-scope scratch would alias the moment two bodies' chests
   * were read into one expression (`lerpVectors(a.chest, b.chest, …)` is
   * already in Duel.js). A field updated in `update()` would be stale on the
   * frame a wave spawns — which is the exact hazard the note on `aimPoint`
   * above is about, and this is the reader that is safe from it: `position` is
   * true from the moment a body is placed.
   */
  get chest() {
    return (this._chest ??= new THREE.Vector3())
      .set(this.position.x, this.chestY, this.position.z);
  }

  /** Capsules the blade solver tests against — one per living bone. */
  capsules() {
    const out = this._caps;
    out.length = 0;
    if (this.dead && !this.actor?.ragdolled) return out;

    // An elite deflector is a sphere around the whole body, so it is in front of
    // every bone and the blade meets it first — which is the point. `takeCut`
    // reads `cap.shield` and drops the bubble instead of the limb, so one clean
    // pass costs the shield and nothing else. Pushed before the bones for the
    // same reason the droideka pushes it before its core.
    if (this.shieldUp && this.shieldMesh && !this.dead) {
      const c = this.shieldCentre(_v4);
      out.push({ name: 'shield', p0: c.clone(), p1: c.clone(),
        r: this.shieldRadius, toughness: TOUGHNESS.heavy, enemy: this, shield: true });
    }

    if (this.rig) {
      const gaps = hasWeakPoints(this.A);
      for (const b of this.rig.list) {
        if (b.severed || !b.parts.length) continue;
        const live = b.length * b.cutT;
        if (this.actor?.ragdolled) {
          const body = this.actor.bodies.get(b.name);
          if (!body) continue;
          /* A ragdoll body is centred on its bone, so the bone's ORIGIN is half
           * a length back along the body's own axis. `_q1` is set here as well
           * as in the posed branch because the weak points below need a frame
           * and not two endpoints — a gap round a hinge is a capsule in the
           * bone's local space, and half of them do not lie on its axis. */
          _q1.copy(body.quaternion);
          _v1.set(0, -live / 2, 0).applyQuaternion(_q1).add(body.position);
          _v2.set(0, live / 2, 0).applyQuaternion(_q1).add(body.position);
        } else {
          b.obj.updateMatrixWorld(false);
          _v1.setFromMatrixPosition(b.obj.matrixWorld);
          _q1.setFromRotationMatrix(b.obj.matrixWorld);
          _v2.copy(_v1).add(_v3.set(0, live, 0).applyQuaternion(_q1));
        }
        /**
         * ── THE GAPS FIRST, AND THEY GO IN AHEAD OF THE BONE ON PURPOSE ────
         *
         * A weak point is a place the body's own cover does not reach — see the
         * long note over `weakSpotsOf` in Bodies.js for how each one is derived
         * from the plate that leaves it bare, and why it is derived there
         * rather than typed beside the roster.
         *
         * Three things are decided here and nowhere else, because this is where
         * a spot stops being geometry and becomes something a blade can meet:
         *
         *  1. WHICH BODIES HAVE ANY. `hasWeakPoints` — a hide guard and no
         *     blade. That is not a taste boundary, it is the same predicate
         *     that decides a body is big enough to turn a cut aside at all, so
         *     the SPATIAL opening exists on exactly the bodies the TEMPORAL one
         *     does. A B1 needs no soft spot; it comes apart on the first pass
         *     anywhere, and `guardFor` already says so by giving it nothing.
         *
         *  2. WHAT IT IS MADE OF. `thinner()` — one rung down the TOUGHNESS
         *     ladder from whatever the bone is charged, measured at 1.3–3.1×
         *     depending on the material. Not a multiplier on damage: see the
         *     note over `thinner` in Combat.js for the argument, which is that
         *     a thin place has to make the blade go through FASTER or it is not
         *     a thin place, it is a bonus.
         *
         *  3. WHETHER THE HIDE CAN STILL TURN IT. `AXIAL_ROLES` is CALLED, not
         *     restated: the roles priced flat by `SEVERANCE` are exactly the
         *     ones where "reaching them ends it wherever along them you reach",
         *     which is the trunk and the head. `_turnCut`'s whole argument is
         *     that the guard is the body's own bulk — "how much animal is
         *     between the edge and the spine" — so a gap in a LIMB has nothing
         *     behind it to turn a blade and a gap in a trunk has the entire
         *     animal behind it. A belly makes the pass quicker; only a joint
         *     makes it land. Without that split a single stifle pass would take
         *     the acklay's neck, because a core capsule is `vital` 1.0 and
         *     `takeCut` kills outright at 0.9.
         */
        const spots = gaps ? weakSpotsOf(b) : null;
        if (spots) {
          const opens = !AXIAL_ROLES.includes(b.role);
          /* …AND NEVER TOUGHER THAN WHAT THE BODY IS MADE OF, which one rung
           * on its own gets wrong on every creature in the menagerie.
           *
           * `_boneToughness` charges a beast's `body` bone `TOUGHNESS.heavy`
           * for its shell — scutes, a bony frill, a chitin ridge — while the
           * archetype's own material is `flesh`. One rung down from heavy is
           * `armour`, so the belly the builder describes as "the one place a
           * blade meets flesh" came out at 4.5: FIVE TIMES tougher than the
           * animal's own leg, on the softest part of it. A gap in a cover
           * exposes what is under the cover, and `A.toughness` is the game's
           * statement about what this body is under everything. Measured, the
           * floor bites on the five creatures (armour 4.5 → flesh 0.9) and on
           * nothing else: every machine's `A.toughness` is `heavy` or above, so
           * a walker's knee stays at `armour` and its intake at `heavy`. */
          const tough = Math.min(thinner(this._boneToughness(b.name)),
            this.A.toughness ?? TOUGHNESS.flesh);
          const vital = severanceOf(b);
          for (const s of spots) {
            // A limb chopped short takes its own far joint with it: `cutT` is
            // what is LEFT of the bone, and a knee past the stub is not there.
            if (s.at0 * b.length > live) continue;
            out.push({
              name: b.name + '.' + s.key, covers: b.name, weak: s, opens,
              p0: _v4.set(s.p0[0], s.p0[1], s.p0[2]).applyQuaternion(_q1).add(_v1).clone(),
              p1: _v5.set(s.p1[0], s.p1[1], s.p1[2]).applyQuaternion(_q1).add(_v1).clone(),
              r: s.r * CAP_BITE, at0: s.at0, at1: s.at1,
              toughness: tough, enemy: this, vital,
            });
          }
        }
        out.push({
          name: b.name, p0: _v1.clone(), p1: _v2.clone(), r: b.radius * CAP_BITE,
          toughness: this._boneToughness(b.name), enemy: this, vital: severanceOf(b),
        });
        /**
         * …AND THE PART OF THE DRAWN BODY THE LINE ABOVE DOES NOT REACH.
         *
         * The capsule above is the bone's own axis at the bone's own radius,
         * which describes a limb and does not describe a head that runs
         * sideways out of its socket or a tank hull that is a slab. Measured
         * over the whole roster against the drawn mesh: the acklay's head 63%
         * outside its capsule and 2.91 m out at worst, the AAT 57% of its whole
         * surface, the AT-TE's six tarsi 70% each. A blade through any of them
         * met nothing, on the bodies whose only counter-play is their feet.
         *
         * It carries NO `covers` field. `covers` is what marks a capsule as a
         * GAP in the cover — thinner than the plate, offered ahead of it,
         * billed against a host — and this is the opposite thing: the cover
         * itself, in the places the bone's own axis does not describe it.
         * `weakpoints.mjs` reads `covers` to find the gaps and would have taken
         * every one of these for one.
         *
         * `coverSpotOf` is the same read of the geometry that `weakSpotsOf` is,
         * and returns null for every bone already covered — which is all 19
         * humanoids — so this line costs those bodies one function call that
         * returns a cached null. It carries the BONE'S OWN name, toughness and
         * severance value, because meeting it IS meeting the bone.
         *
         * Suppressed on a shortened bone: `cutT < 1` means the far half of this
         * limb is on the floor, and a cover fitted to the whole drawn mesh
         * would still be standing where the mesh no longer is.
         */
        const cover = b.cutT > 0.999 ? coverSpotOf(b) : null;
        if (cover) {
          out.push({
            name: b.name, cover: true,
            p0: _v4.set(cover.p0[0], cover.p0[1], cover.p0[2]).applyQuaternion(_q1).add(_v1).clone(),
            p1: _v5.set(cover.p1[0], cover.p1[1], cover.p1[2]).applyQuaternion(_q1).add(_v1).clone(),
            r: cover.r * CAP_BITE,
            toughness: this._boneToughness(b.name), enemy: this, vital: severanceOf(b),
          });
        }
      }
    } else if (this.group && this.A.custom === 'remote') {
      const c = _v1.copy(this.group.position);
      out.push({ name: 'core', p0: c.clone(), p1: c.clone(), r: 0.14 * this.A.scale,
        toughness: this.A.toughness, enemy: this, vital: severance('core') });
    } else if (this.group) {
      /* THE TWO BODIES WITH NO RIG GO THROUGH THE SAME PRICE, and they used to
       * carry two literals instead. `vital: 1` for the core happened to agree
       * with it; `vital: 0.2` for a leg did not, and there was nothing to say
       * which of the two numbers a third body should copy. A droideka has THREE
       * legs, so `severance` divides a leg's worth by three and prices one at
       * 0.37 — losing all three kills it, where at 0.2 it could lose all three
       * and keep two thirds of its health. It is spelt out here because these
       * capsules are synthesised rather than walked off a rig: there is no bone
       * to carry the role, so the call site says it. */
      const c = _v1.copy(this.group.position).addScaledVector(UP, 0.62 * this.A.scale);
      if (this.shieldUp) {
        out.push({ name: 'shield', p0: c.clone(), p1: c.clone(),
          r: 1.15 * this.A.scale, toughness: TOUGHNESS.heavy, enemy: this, shield: true });
      }
      out.push({ name: 'core', p0: c.clone(), p1: c.clone().setY(c.y + 0.3 * this.A.scale),
        r: 0.34 * this.A.scale, toughness: this.A.toughness, enemy: this, vital: severance('core') });
      const legs = this.built.legs || [];
      for (const leg of legs) {
        leg.leg.getWorldPosition(_v2);
        leg.lower.getWorldPosition(_v3);
        out.push({ name: 'leg' + legs.indexOf(leg), p0: _v2.clone(), p1: _v3.clone(),
          r: 0.12 * this.A.scale, toughness: this.A.toughness, enemy: this,
          vital: severance('leg', 1, legs.length) });
      }
    }
    return out;
  }

  _boneToughness(name) {
    const A = this.A;
    // The Armoured modifier plates the TORSO to durasteel and leaves the limbs
    // where they were: the counter-play to a body you cannot cut through is the
    // legs it is standing on.
    if (A.armorPlus && /^(chest|spine|hips|neck|head)$/.test(name)) return TOUGHNESS.durasteel;
    if (A.armored && (name === 'chest' || name === 'spine' || name === 'hips')) return TOUGHNESS.heavy;
    if (A.custom === 'walker' && (name === 'body' || name === 'hips')) return TOUGHNESS.durasteel;
    if (A.custom === 'beast' && name === 'body') return TOUGHNESS.heavy;
    return A.toughness;
  }

  /* ── damage ──────────────────────────────────────────────────────── */

  /**
   * Take damage. The attack damage this enemy DEALS is `attackDamage`, and the
   * two must never share a name again: `this.damage = <number>` in the
   * constructor shadowed this method on every instance, so `e.damage(...)`
   * threw "e.damage is not a function" everywhere it was called — deflected
   * bolts, Force lightning, fall damage, net damage. Only the blade could kill
   * anything, and the throw aborted the rest of world.update() on every frame
   * a bolt reached an enemy, which is what made a run degrade until it froze.
   * Nothing failed loudly: the exception surfaced as a console error behind a
   * requestAnimationFrame that had already been scheduled.
   */
  damage(amount, point, source, kind, preResisted = false) {
    if (this.dead) return false;
    if (this.invincible) return false;
    if (this.shieldUp && kind !== 'melee') {
      this.shieldHp -= amount;
      // Two kinds of body carry a bubble now — the droideka, which was built
      // with one, and anything the Shielded modifier promoted — so the flash
      // goes through whichever material is actually there rather than assuming
      // `built.shieldMat` exists.
      const mat = this.shieldMat || this.built?.shieldMat;
      if (mat) mat.uniforms.uPower.value = 1.4;
      if (this.shieldHp <= 0) this.dropShield();
      return false;
    }
    /**
     * THE FORCE ANSWERS THE FORCE — one call, at the sink, so a blow is blunted
     * exactly once however it was thrown. `preResisted` is set by
     * `applyKnockback`, which has already answered the whole blow (shove and
     * damage together) so that the two halves do not bill the pool twice.
     *
     * `incoming` is deliberately the PRE-resist figure for the two tests below
     * it: what breaks a body's concentration and what throws its guard aside is
     * the blow that arrived, not what was left of it after it paid to survive.
     */
    const incoming = amount;
    if (!preResisted) amount = Math.max(0, amount - this.resistForce(amount, kind, source));
    // A power lands, a power answers it, and the answer costs the caster the
    // cast it was in the middle of. Chip damage does not — see CAST_FLINCH_FLOOR.
    if (this._castTimer > 0 || this.casting) {
      const flinch = Math.max(CAST_FLINCH_FLOOR, this.maxHp * CAST_FLINCH_FRAC);
      if (incoming >= flinch || FORCE_KINDS.test(kind ?? '')) this.breakCast();
    }
    this.hp -= amount;
    /**
     * NOT `if (this.A.boss)`. The winded window — "the only safe time to go for
     * a leg", per the comment that opens it — is a BEAST mechanic, and only the
     * acklay carries `boss`. The Reek and the Nexu (Levels.js gives both
     * `custom: 'beast'` with no `boss`) could not accrue a single point of it,
     * so neither could ever be winded: measured over nine 90-second fights,
     * `winded` fired 0 times. The gate is on the creature that HAS the window,
     * which is anything running the beast brain.
     */
    if (keepsWind(this.A)) this.recentDamage = (this.recentDamage || 0) + amount;
    if (this.hp <= 0) { this.die(point, source, kind); return true; }
    /**
     * IT HURT. Player note #17 asked for pain and death sounds, and of the two
     * only the death had one: a body screamed when it lost a limb, when it was
     * flung and when it died, and took a rifle burst to the chest in complete
     * silence. That is the most common thing that happens in a firefight and it
     * was the one thing with no voice.
     *
     * `hurt` and not `scream`. The contour table already separates them and the
     * difference is the whole point — `scream` is two long syllables that FALL
     * and reads as something ending, which is why the dismemberment and death
     * calls use it. `hurt` is a clipped rise and drop, a quarter of the length,
     * and reads as a body that is still standing. Using the death contour for
     * a flesh wound would make every exchange sound like a kill.
     *
     * THE THRESHOLD IS A FRACTION, not a number of hit points, so a B1 losing
     * a fifth of itself and an acklay losing a fifth of itself both say so —
     * an absolute floor would have the horde grunting at every bolt and the
     * boss silent through a whole duel.
     *
     * The gap is long relative to the rate hits land (`cry` refuses inside
     * it), which is deliberate: the announcer's shared budget is what stops
     * five bodies talking at once, and this is what stops ONE body narrating
     * every bolt of a burst. Without it a squad under sustained fire is a wall
     * of grunting, and the deaths — which take the same budget — never get a
     * word in.
     */
    if (amount >= this.maxHp * HURT_CRY_FRAC) this.cry('hurt', 2.2);
    // A heavy blow throws the guard AWAY from whoever landed it, and how far
    // scales with how heavy. Both arguments used to be omitted here, so every
    // hit in the game beat the blade to the same side by the same amount.
    if (amount > this.maxHp * 0.22) {
      this.stun(0.28, this._blowDir(point, source), clamp(amount / (this.maxHp * 0.34), 0.7, 1.4));
    }
    return false;
  }

  /**
   * The world-space line a blow travelled, for `DuelBrain.stagger`.
   *
   * Prefers the attacker's own position — that is the line the blade actually
   * came down — and falls back to the impact point when the blow has no body
   * behind it (a bolt, a blast, fall damage). Returns null when neither is
   * known, which is what `stagger` already treats as "no side to this one".
   */
  _blowDir(point, source) {
    const from = source?.position ?? (point && point !== this.position ? point : null);
    if (!from) return null;
    _stag.subVectors(this.position, from).setY(0);
    return _stag.lengthSq() > 1e-6 ? _stag : null;
  }

  /**
   * A blade crossed a limb.
   *
   * @returns `'turned'` when the guard stopped it and nothing came off, so a
   * caller can tell a parry from a sever. `World._applyBladeEvent` READS IT —
   * it used to credit `limbsRemoved++`, a combo, 60 score, lifesteal and an
   * `onHitmark(…, 'cut')` for a pass that was blocked, and now returns after
   * the shake. (This note said the fix was still owed. It is not, and it
   * matters more than it did: the guard is no longer only a duellist's, so
   * every big body in the game would otherwise have paid a false reward.)
   *
   * It also means NOTHING CAME OFF for the one other reason that can happen —
   * a caller offering a bone the actor has already lost. Both readers act on
   * the same sentence, "do not pay for a limb", and there is no third reader
   * that needs to tell the two apart; a second return value would be a
   * distinction nobody consumes. See the `isSevered` guard below.
   */
  takeCut(ev, source) {
    if (this.dead && !this.actor) return;
    /* THE CAPSULE IS THE AUTHORITY ON WHICH BONE THIS WAS, not the event.
     *
     * `BladeContactSolver` already writes `cap.covers ?? cap.name` into
     * `ev.bone`, so for the blade the two agree. This reads the capsule first
     * anyway, because three other callers build a cut event out of a capsule
     * they picked themselves — `Player.forceDisassemble`, the Sunder boon's
     * `sunderThrough` and `World.applyClaim` — and every one of them writes
     * `bone: cap.name`. A weak point's name is not a bone (`femur0.tip`), and
     * routing one of those to `Actor.cut` would silently take nothing off. */
    const bone = ev.cap?.covers ?? ev.bone;
    /* THE SHIELD FIRST, AND IT IS NOT A BONE. A bubble carries no `vital` on
     * purpose — nothing is severed and nothing is billed, the pass costs the
     * shield and stops — so it has to be answered before anything asks what
     * losing it is worth. Putting the price check above this line is a real
     * mistake somebody has now made: `escalation: an elite comes apart like
     * everything else does` threw on the Shielded elite's first pass. */
    if (ev.cap.shield) { this.dropShield(); return; }
    /**
     * …AND A BONE THAT IS ALREADY GONE IS NOT CUT TWICE.
     *
     * `capsules()` never offers a severed bone, so for the blade this cannot
     * happen — but `Player.forceDisassemble` builds its list ONCE and walks it,
     * and its own re-check is `actor.isSevered(cap.name)`, which answers false
     * for a weak point's name because `femur0.tip` is not a bone the rig has.
     * Without this a rend that took `femur0` off spends a second joint of its
     * budget on the gap in the same femur: `Actor.cut` correctly refuses
     * (`bone.severed`) and the sever price below is billed anyway, so one leg
     * costs the body two limbs' worth of health.
     *
     * `isSevered` walks the parent chain, and it is deliberately not
     * `bone.severed`: a LEAF bone is SHORTENED rather than severed, and chopping
     * the same stub again is a real thing the game lets you do (severance.mjs
     * measures a Rancor dying to nine chops of one toe).
     *
     * `'turned'` AND NOT A BARE RETURN, and the difference is a green check.
     * The documented meaning of the return value is the one every caller acts
     * on — "nothing came off, do not pay for a limb" — and both of them do
     * exactly the right thing with it here: `World._applyBladeEvent` shakes the
     * camera and returns without crediting a sever, and `forceDisassemble`
     * skips the joint without spending its budget. Returning nothing instead
     * let `forceDisassemble` count a limb the actor never removed, which is the
     * false reward that branch's own note is about; `force: a droid comes apart`
     * caught it on the walker within the hour.
     */
    if (this.actor && this.actor.isSevered(bone)) return 'turned';
    /* NO `?? 0.4` HERE EITHER. Every BONE capsule this game emits is priced by
     * `severance`, which throws rather than guessing, so a missing `vital` is
     * a capsule from somewhere that has not been through it — and answering
     * that with the number that used to hide the whole defect is how it would
     * come back. A synthetic capsule in a fixture must say what it is worth. */
    const vital = ev.cap.vital;
    if (typeof vital !== 'number') {
      throw new Error(`Enemy.takeCut: capsule '${ev.cap?.name ?? bone}' carries no \`vital\`. `
        + 'Capsules are priced by `severance` at the point they are built.');
    }

    // BEFORE anything is severed: a turned cut is a cut that did not land, and
    // a body that "turned" a pass while losing the limb would be nonsense.
    if (this._turnCut(ev, bone, vital, source)) return 'turned';

    /**
     * …AND IF IT WENT THROUGH THE GAP, THE GAME SAYS SO. Note #35's other half:
     * "a spot nobody can find is not a mechanic."
     *
     * This is deliberately the SAME CHANNEL, in the same shape, as the three
     * lines `_turnCut` already writes when a pass lands anywhere else on a big
     * body — 'HIDE TURNS IT', 'PLATE HOLDS', 'TURNED'. Those are the game
     * teaching a player that this body refuses cuts; without a sentence for the
     * other outcome the lesson has no second half and the only way to learn a
     * weak point is to notice a fight ending sooner. Now the pair reads:
     *
     *     cut the shoulder  →  HIDE TURNS IT   and nothing comes off
     *     cut the stifle    →  JOINT           and the leg does
     *
     * The label is the spot's own, declared in Bodies.js beside the geometry it
     * names, so it cannot describe a place that is not there. Both halves of
     * the feedback go through `world.notifyFloating`, which HUD.js already
     * anchors to a world point — a floating word at the impact is what makes
     * this a property of a PLACE rather than a number in a corner.
     *
     * `notifyFloating` and not the audio bank, and one call and not a burst per
     * frame: the grind that leads up to this fires on every frame of contact
     * and the sever fires once. This is the once.
     */
    if (ev.cap.weak) {
      this.world?.notifyFloating?.(ev.point ?? this.position, ev.cap.weak.label, '#ffd0a0');
      audio.cut(ev.point ?? this.position, false);
    }

    if (this.actor) {
      const impulse = _v1.copy(ev.impulse).multiplyScalar(0.35);
      if (this.actor.ragdolled) this.actor.cutRagdoll(bone, impulse);
      else this.actor.cut(bone, ev.cutT, impulse, ev.point, { spin: 1.2 });
      this.world.onLimbSevered?.(this, bone, ev.point, source);
    } else if (this.group) {
      this._cutDroideka(bone, ev, source);
    }

    const lethal = vital >= 0.9 || (vital >= 0.7 && this.hp < this.maxHp * 0.55);
    const dmg = lethal ? this.maxHp * 2 : this.maxHp * vital * SEVER_LETHALITY;
    this.hp -= dmg;
    /* …and a CUT winds a beast, which is the whole point of the window. This
     * path subtracts from `hp` directly rather than going through `damage()`,
     * so severing a limb — the thing the winded comment says the window exists
     * for — accrued nothing at all and could never open it. */
    if (keepsWind(this.A)) this.recentDamage = (this.recentDamage || 0) + dmg;
    if (this.hp <= 0) this.die(ev.point, source, 'cut');
    else {
      // The cut carries its own line — `ev.impulse` is the direction the blade
      // drove through the limb — and losing a piece is worth more than a beat.
      this.stun(0.4, ev.impulse ?? this._blowDir(ev.point, source), 1.25);
      this._loseLimbBehaviour(bone, ev.point);
    }
  }

  /**
   * Would this pass END the fight? Three ways, and only the first is obvious:
   * `takeCut`'s own lethality gate; the fact that `_loseLimbBehaviour` disarms
   * a blade-user on the FIRST arm it loses, so one arm is a kill in every way
   * that matters to a duel; and — for a body with no blade — the sever itself.
   *
   * ── WHY A SEVER ENDS A CREATURE'S FIGHT, MEASURED ─────────────────────
   *
   * `takeCut` charges `maxHp * vital * 1.15` for a severed limb: a SHARE OF
   * MAXIMUM HEALTH, not a fixed wound. So how many limbs a body can lose is a
   * property of the vital table and nothing else, and its health does not enter
   * into it — which is the same defect as "a 460 hp Master dies as fast as a
   * 28 hp B1", one layer down and hiding.
   *
   * **AND THE TABLE WAS NINETEEN HUMANOID NAMES OVER A ROSTER OF QUADRUPEDS AND
   * MACHINES.** Read as `VITAL[name] ?? 0.4`, so a Rancor's `tarsus0` — and 33
   * other names — came out at 0.4: 46% of a 2200 hp animal, exactly as much as
   * its hip, three toes to kill it out of the four it has. Measured with the
   * guard open, brute, charger, acklay, gundark and nexu ALL died in 1.28 s
   * through a toe, five bodies spanning 420 to 2200 hp on one number.
   *
   * That is fixed at the source: see `SEVERANCE`/`severance` at the foot of this
   * file. A bone declares its ROLE beside its length in the skeleton that
   * generates it, the price is that role divided by how many of the limb the
   * body has and scaled by how much of it comes off, and an unpriced role
   * throws. A Rancor's toe is 0.101 now against its hip's 0.55, so it takes
   * NINE toe-severs to kill an animal that has four; the acklay and the reek
   * need 24 against six and four, the nexu 26, the gundark 11, the walker 20
   * and the AT-TE 36. **No body on the roster can now be killed by taking its
   * extremities off, and eight of them could.**
   *
   * That is why the first version of the hide guard bought nothing. It turned
   * the pass at the neck and the model simply went round it to a leg — which is
   * the right instinct and the reason the leg route exists, but a leg cannot be
   * BOTH the way in and free. So for a body with no blade, coming apart is what
   * losing looks like, and the hide turns that pass too. In the player's words
   * it is a hide that needs the same place hit twice: the first pass skids off,
   * the second parts it.
   *
   * It is not a wall and it cannot become one. `_turnCut` returns false at
   * `guard <= 0`, and `guardFor` gives 0 to everything under 300 kg — a B1, a
   * trooper, a B2, a droideka all still come apart on the first pass — and a
   * turned pass costs `TURNED_CUT` of maximum health, so five of them kill the
   * body whatever its guard was.
   */
  _fightEnding(bone, vital) {
    if (vital >= 0.9) return true;
    if (vital >= 0.7 && this.hp < this.maxHp * 0.55) return true;
    if (this.A.saber) return !this.disarmed && /arm|fore|hand/.test(bone);
    return true;
  }

  /**
   * THE GUARD TURNS A KILLING PASS ASIDE — see the notes on GUARD_PER_HP (a
   * duellist's blade) and HIDE_PER_KG (everything else's own bulk) for the whole
   * argument and the measurements both come from.
   *
   * Three gates, and each is here so that this is a duel rather than a wall:
   *
   *   · only a FIGHT-ENDING pass is turned. A duellist still bleeds from every
   *     ordinary cut at exactly the rate it always did, and still loses legs.
   *     `_fightEnding` is where the two kinds of body differ, and it says why.
   *   · only while the guard is UP. Everything the player earns — a parry, a
   *     chamber, a won blade lock, a Force shove, a heavy blow, a topple, a
   *     grip, a severed arm — opens it, and the killing pass lands at once.
   *   · it is NOT free. A turned pass costs a quarter of maximum health and
   *     leaves the body staggered, so the ceiling on how long any of this can
   *     last is `1 / TURNED_CUT` passes no matter how deep the guard is.
   *
   * AND A TURNED CUT MUST NOT ITSELF OPEN THE GUARD, which is the one thing
   * that made the first version of this worth almost nothing. It called
   * `stun()`, which is what every other beaten-guard path calls — and `stun`
   * sets `stunTimer`, which `_guardOpen` reads, so the pass immediately after
   * a turn always landed. Measured: a 460 hp Master and a 130 hp acolyte both
   * died in exactly 2 torso passes, and the whole guard was worth 0.42 s.
   * A successful defence cannot be the thing that hands over the next one.
   *
   * So it goes through `DuelBrain.interrupt` instead, which Duel.js's own note
   * describes as strictly WEAKER than a stagger: the blade is driven back to a
   * neutral guard and no attack comes out of it for a beat. That is a real
   * consequence — it lost its tempo, and it lost a quarter of its health —
   * without being the opening. The openings stay the ones the player earns.
   */
  _turnCut(ev, bone, vital, source) {
    if (this.guard <= 0 || this.dead) return false;
    /* THE FORCE IS A DIFFERENT CONTEST AND IT ALREADY HAS ONE. `ev.force` marks
     * a joint torn off by Force Rend rather than a pass of a blade, and this is
     * the blade's guard: a plate turns an EDGE, and nothing about a hide
     * explains a limb being pulled out of its socket from the inside. The Force
     * half is `resistForce`, which spends the body's own pool against the
     * power, and charging a Force rend for both would be one act billed twice.
     *
     * It is also the difference between a heavy that is hard to cut and a power
     * that appears to do nothing, which is the complaint this session has
     * already answered once: with the walker's guard eating rend passes,
     * `force: a droid comes apart, and how far scales with the setting` went
     * red on a walker whose joints stopped coming off while the score, the
     * shake and the sound all still fired. */
    if (ev && ev.force) return false;
    if (this._guardOpen()) return false;
    /**
     * ── AND A SPATIAL OPENING SITS BESIDE THE TEMPORAL ONE, NOT INSTEAD OF IT
     *
     * The line above is every opening the player EARNS IN TIME — a parry, a
     * chamber, a won lock, a shove, a topple, a grip, the winded window. This
     * one is the opening they earn IN SPACE, and it is deliberately the very
     * next line so that the two read as what they are: two ways of arriving at
     * the same sentence, `return false`, and nothing about either that touches
     * the other. A weak point does not open the guard for the next pass (only
     * `_guardOpen`'s states do that, and none of them is set here), and an open
     * guard does not make a plate thin. They compose because a player can have
     * both, and a player with both is a player who took a leg off a spider
     * walker while it was still down from the last one.
     *
     * WHY IT IS `cap.opens` AND NOT `cap.weak`. `capsules()` sets `opens` off
     * `AXIAL_ROLES`, so a gap in a LIMB lets the pass through and a soft place
     * on a TRUNK does not. This function's own argument is the reason: the
     * guard is the body's own bulk, "how much animal is between the edge and
     * the spine". Behind a bare hinge there is a hinge; behind an animal's
     * belly there is the animal. Measured on the shipped bodies, dropping that
     * distinction makes one stifle pass an instant kill on every creature in
     * the menagerie, because a core capsule is `vital` 1.0 and `takeCut` kills
     * outright at 0.9 — the guard would not have been composed with, it would
     * have been deleted.
     */
    if (ev && ev.cap && ev.cap.opens) return false;
    if (!this._fightEnding(bone, vital)) return false;

    this.guard--;
    this.guardT = GUARD_REFRESH;
    this.hp -= this.maxHp * TURNED_CUT;
    if (keepsWind(this.A)) this.recentDamage = (this.recentDamage || 0) + this.maxHp * TURNED_CUT;
    if (this.hp <= 0) { this.die(ev.point, source, 'cut'); return true; }

    /* THE TEMPO COST, AND IT IS NOT THE SAME EVENT FOR EVERY BODY.
     *
     * A duellist loses the beat through `DuelBrain.interrupt` — Duel.js's own
     * note calls that strictly weaker than a stagger, which is the point: a
     * real consequence that is not itself the opening. A creature and a machine
     * have no DuelBrain, so `this.duel?.` was silently nothing for them and the
     * turn would have been free. `attackTimer` is the beat all three brains
     * actually run on (`_rangedBrain`, `_beastBrain` and the training loop each
     * count it down), so pushing it is the same consequence spelt in the
     * vocabulary the body has. It is a DELAY and not a stun: `stunTimer` is
     * read by `_guardOpen`, and a successful defence that opens the next pass
     * is the bug the note above records costing the whole guard 0.42 s.
     */
    if (this.duel) this.duel.interrupt(0.35);
    else this.attackTimer = Math.max(this.attackTimer || 0, 0.35);
    this.breakCast();

    /* AND IT READS AS WHAT IT IS. Steel stopping steel is a specific sound and
     * a specific shower of sparks, and playing it off a Rancor's hide would be
     * the loudest wrong note in the game — the player's complaint that started
     * this work is that the big creatures are indistinguishable, and a blade
     * skidding off two tonnes of animal is one of the few moments that can say
     * otherwise. Which one is read off the body: `A.saber` for a blade,
     * `TOUGHNESS.heavy` and up for a plated machine, everything else is hide. */
    const at = ev.point ?? this.position;
    const armour = (this.A.toughness ?? TOUGHNESS.flesh) >= TOUGHNESS.heavy;
    if (this.A.saber || armour) {
      audio.clash(at, armour ? 0.5 : 0.6);
      this.world.particles?.sparkBurst?.(at, null, armour ? 22 : 16, { speed: armour ? 7 : 9 });
      this.world.notifyFloating?.(this.aimPoint(_v1),
        this.A.saber ? 'TURNED' : 'PLATE HOLDS', '#cfe4ff');
    } else {
      // Hide: a dull heavy slap with no ring in it, and no sparks at all —
      // `spatter` is the pool the game already throws for a cut into flesh.
      audio.thud(at, 0.9);
      audio.noise({ dur: 0.13, gain: 0.16, type: 'lowpass', freq: 900, freqEnd: 260, pos: at });
      this.world.particles?.spatter?.(at, null, 8, 0x7a2418, { speed: 3.0 });
      this.world.notifyFloating?.(this.aimPoint(_v1), 'HIDE TURNS IT', '#e0b48a');
    }
    return true;
  }

  /** @param point where the blade crossed, so a dropped hilt starts there. */
  _loseLimbBehaviour(bone, point) {
    /**
     * WALKING ON A SEVERED LEG DOES NOT WORK — AND THE BIGGEST LEG BONE ON
     * EVERY MULTI-LEGGED BODY DID NOT COUNT AS ONE.
     *
     * This asked `/thigh|shin|foot|femur|tibia|tarsus/.test(bone)`: the leg
     * vocabulary of a HUMANOID, spelled out, against a roster whose quadrupeds
     * name their bones `hipL0`, `femur0`, `tibia0`, `tarsus0` and whose
     * hailfire names them `wheelL` and `rimL`. `hipL#` is on none of those
     * lists. Severing a bone also takes its whole subtree (Ragdoll.cut) while
     * reporting only the CUT bone's name, so cutting a Spider Walker at the HIP
     * removed the entire leg and incremented `legsLost` by ZERO, while cutting
     * the toe of that same leg counted. Measured across the roster:
     *
     *   walker 12 of 16 leg bones counted, 4 × hipL# uncounted (0.275 each,
     *   the most expensive leg bone it has, against a tarsus at 0.045)
     *   acklay 18 of 24 · charger 12 of 16 · stalker 12 of 16
     *   brute 6 of 8 · pouncer 6 of 8 · HAILFIRE 0 of 4
     *
     * What a player saw: a Spider Walker losing three of its four legs at the
     * hip — 588 of its 620 hp — with `legsLost === 0`, still upright and still
     * moving at full speed, because `_move` reads the same counter. And a
     * Hailfire had no bone in its body that could ever increment it, so
     * `topple()` was unreachable for that machine entirely.
     *
     * `Rig.js` gave every bone a `role` and `severanceOf` already prices off
     * it; this was the older reader, and Rig.js's own note names it as "the
     * next thing to route through `bone.role`". Now it is. A body plan added
     * tomorrow is counted the day it is authored, in the same place its bones
     * declare what they are.
     */
    if (this.rig?.get(bone)?.role === 'leg') {
      this.legsLost = (this.legsLost || 0) + 1;
      if (this.legsLost >= this._toppleAt()) this.topple();
    }
    // The off hand holds a real weapon, so losing it loses the weapon. Checked
    // before the general arm rule, which only knows about the main one.
    if (this.offSaber && /L$/.test(bone) && /arm|fore|hand|clav/.test(bone)) {
      this.offSaber.retract();
      this.offDisarmed = true;
    }
    if (/arm|fore|hand/.test(bone)) {
      this.armsLost = (this.armsLost || 0) + 1;
      if (this.armsLost >= 1 && (this.A.ranged || this.A.saber)) {
        this.disarmed = true;
        if (this.weapon) { this.weapon.parent?.remove(this.weapon); this.weapon = null; }
        if (this.saber) {
          /* THE HILT FALLS. It used to simply cease to exist: the most legible
           * thing that can happen in a swordfight — one of you losing your
           * sword — produced nothing you could walk over and pick up. It leaves
           * the severed hand travelling, which is where it was, and note 61's
           * other half is `Player.swapSaber` walking over and taking it. */
          dropSaber(this.world, {
            position: point ? _v1.copy(point) : _v1.copy(this.position).setY(this.position.y + 1.1),
            velocity: _v2.set((rng() - 0.5) * 3, 2.2, (rng() - 0.5) * 3).add(this.velocity),
            colorIndex: this.saber.colorIndex,
            hiltStyle: this.saber.hiltStyle,
            order: this.saber._order ?? null,
            owner: this,
          });
          this.saber.retract();
        }
      }
    }
    if (bone === 'head' || bone === 'neck') { this.blinded = true; this.hp = Math.min(this.hp, this.maxHp * 0.1); }
  }

  _onSever(bone, point) {
    const p = this.world.particles;
    if (p) {
      p.cutFlare(point, null, 0x57c9ff, this.A.big ? 44 : 26);
      if (/droid|b1|b2|walker|droideka/.test(this.type)) p.sparkBurst(point, null, 22, { speed: 8 });
    }
    /**
     * A LIMB COMING OFF HAS ITS OWN SOUND NOW, and it needed one.
     *
     * This was `audio.cut(point, this.A.big)` — the identical call a contact
     * that severs NOTHING makes (`World._applyBladeEvent` plays
     * `audio.cut(ev.point, false)`), and on the 22 of 31 bodies whose `A.big`
     * is falsy the two are the same two layers at the same 0.380 of delivered
     * gain. Dismemberment is the mechanic this game is named for and a graze
     * and a severance were byte-identical.
     *
     * `sever` plays the graze and then three layers over it — see the note on
     * it in Audio.js — so the two are still the same event with the same
     * opening, which is what they are.
     */
    audio.sever(point, this.A.big);
    // Losing a limb and living through it. `cry` decides nothing about what
    // comes out of the throat — see the note there — only that there is
    // something to say, and a droid's version of a scream is that it powers
    // down, which is the announcer's call to make.
    if (!this.dead) this.cry('scream', 0.7);
  }

  _cutDroideka(name, ev, source) {
    const idx = parseInt(name.replace('leg', ''), 10);
    if (!isNaN(idx) && this.built.legs[idx] && !this.built.legs[idx].gone) {
      const leg = this.built.legs[idx];
      leg.gone = true;
      leg.leg.getWorldPosition(_v1);
      const mesh = leg.leg;
      mesh.parent.remove(mesh);
      this.world.spawnDebrisGroup(mesh, _v1, ev.impulse.clone().multiplyScalar(0.3), 0.4);
      this.legsLost = (this.legsLost || 0) + 1;
      if (this.legsLost >= 2) this.topple();
    }
  }

  /**
   * How many leg cuts put this body on the ground.
   *
   * The authored number is 3 for a walker or a creature and 1 for everything
   * else, and it is CAPPED BY THE ANATOMY: you cannot ask for more legs than
   * the body has, and a body standing on its last leg is on the ground whatever
   * the number says. A leg CHAIN is counted off the rig — a bone with role
   * 'leg' whose parent is not one — so it is 4 on a Spider Walker, 6 on an
   * Acklay, 2 on the two bipeds and 2 on a Hailfire.
   *
   * THE HAILFIRE IS WHY THIS IS DERIVED. `Rig.js` says outright that its wheels
   * are legs — "two of them, weight-bearing, and losing one is losing the pair"
   * — and it carries `custom: 'walker'`, so the flat 3 was a threshold its four
   * leg bones could never reach: `wheelL` takes `rimL` with it, so there are
   * exactly two cuts available and three were required. One wheel now puts it
   * over, which is what a two-wheeled machine does when it loses a wheel.
   *
   * The two bipedal creatures move with it, from 3 to 1, and that is the same
   * sentence: a Rancor has two legs, and a Rancor with one leg is a Rancor on
   * the sand. Reaching it is not cheap — a severing pass has to beat five
   * turned passes or catch the animal WINDED first, and it costs
   * `maxHp × vital × SEVER_LETHALITY` on the way through.
   */
  _toppleAt() {
    if (this._toppleNeed === undefined) this._toppleNeed = toppleAt(this.A, this.rig);
    return this._toppleNeed;
  }

  topple() {
    if (this.toppled || this.dead) return;
    this.toppled = true;
    // No direction, deliberately: nothing pushed it over, its own legs went.
    // `stagger` caps at 2.2 s so this cannot leave a permanent guard behind.
    this.stun(9999);
    if (this.actor && !this.actor.ragdolled) {
      this.actor.goRagdoll(this.velocity.clone(), _v1.set((rng() - .5) * 4, 0, (rng() - .5) * 4));
      this.world.physics.remove(this.body);
      this.bodyRemoved = true;
    }
  }

  /**
   * SHOVED OFF ITS FEET — and until this existed the comment in
   * `applyKnockback` was the only place it happened.
   *
   * ── THE LINE THAT SAID IT AND DID NOT DO IT ────────────────────────────
   *
   * `applyKnockback` has carried `// hit hard enough to leave its feet` over
   * `this.stun(1.2, impulse, 1.4)` for as long as the shove contest has
   * existed. A stun is a body STANDING STILL. So an eleven-metre Force wave at
   * impulse 34 threw a dozen droids through the air and every one of them
   * landed upright, frozen for 1.2 s, and then walked on — which is the
   * repository's signature defect (a label nothing implements) applied to the
   * most cinematic thing in the game.
   *
   * ── WHY IT IS THE ONE CHANGE THAT MOVES FLAGSHIP §7's THIRD VERB ───────
   *
   * §7 says "the Force is a multiplier on other people's guns", and
   * `openness()` pays that multiplier — 3.0x held, 2.0x yanked, 1.5x downed.
   * Measured on a real Command battle with a Jedi gripping continuously it
   * reached **0.5-1.0% of enemy body-seconds**, and the reason is arithmetic
   * rather than tuning: twenty-six hostile bodies stand on that field, one
   * pair of hands holds ONE of them, and the choke kills it in four and a half
   * seconds. The bar is already fully committed — 657 Force spent in 82 game-
   * seconds against an income of 7.5/s — so the verb cannot be bought more of.
   * What can move is the EXCHANGE RATE, and the numbers say where:
   *
   *     grip     10 Force + the hold drain, 1 body,  ~4.5 s   0.05 open-s/Force
   *     push     20 Force,        ~3 bodies, 1.2 s of stun    0.18
   *     push     20 Force,        ~3 bodies, ~3.5 s on the floor
   *     unleash  52 Force,       ~8 bodies, 1.6 s of stun     0.25
   *     unleash  52 Force,       ~8 bodies, ~3.5 s on the floor
   *
   * A body on the floor is limp for its flight, then `GET_UP` (1.35 s of lying
   * still), then `recover`'s 1.1 s beat — three times the window a stun opens,
   * over three to eight bodies at once instead of one. That is the same Force,
   * spent the same way, buying an order of magnitude more of the thing §7 is
   * about. It is not a new power, not an aura, and not a local good: what it
   * buys is paid to whoever is shooting the body, from wherever they stand.
   *
   * ── WHAT IT WILL AND WILL NOT PUT DOWN ─────────────────────────────────
   *
   * Exactly the population `applyKnockback` already stuns — past impulse 12,
   * never a boss — MINUS anything `big`. A shove that staggers a spider droid
   * does not put it on its back, for the same reason `openMul` pays a big body
   * a quarter of the held bonus: "grab the boss" is not a fight.
   *
   * A body already limp, held, or in stasis is left alone: `goRagdoll` on a
   * ragdoll is a second set of holders, and re-ragdolling a body somebody is
   * carrying takes it out of their hands.
   *
   * The physics capsule goes with it, exactly as in `topple()` above — a body
   * walking with no collider is the bug from the other side, and `recover()`
   * is the one place that puts it back.
   */
  knockFlat(impulse, source) {
    if (this.dead || this.gripped || this.stasisHeld || this.beingDragged) return false;
    if (this.A.boss || this.A.big) return false;
    if (!this.actor || this.actor.ragdolled) return false;
    /**
     * A SHOVE FROM YOUR OWN SIDE ROCKS YOU AND DOES NOT PUT YOU DOWN.
     *
     * `Player._shockwave` iterates `ctx.enemies` with NO team test — a Force
     * wave is physics and does not aim, which is right and is why `unleash`'s
     * knockback reaches your own rank while the stagger loop beside it filters
     * through `_foes`. In Command your line stands in `world.enemies` on your
     * team, so without this clause a panic button pressed every few seconds
     * would put your own men on the floor for five seconds at a time — and the
     * mode is about the line still being on its feet when it takes the ridge.
     *
     * The existing 1.2 s stun still reaches them, unchanged. This is about the
     * DIFFERENCE the knockdown adds, and it is the difference between a shove
     * that shoves your men and one that fells them.
     */
    if (source && source.team !== undefined && source.team === this.team) return false;
    /**
     * ── AND A FALL BELONGS TO THE MACHINE THAT OWNS THE BODY ─────────────
     *
     * TWO RAGDOLLS CANNOT AGREE, and it is not a tuning problem. `goRagdoll`
     * builds its bodies out of `bone.obj.matrixWorld` — THE POSE THE BODY IS
     * STANDING IN at the instant it goes limp — and a host and a guest run
     * independent gait clocks for the same trooper. Same position, same
     * velocity, same impulse, different arms and legs, and from there two
     * chaotic solves go their own ways. Measured on a host/client pair off one
     * push: **4.13 m of flight on the host against 10.06 m on the guest**, with
     * the guest's copy still in the air at 2.3 m while the host's was down and
     * sliding. `coop.mjs` calls that "the two machines are simulating different
     * blows", and it is right.
     *
     * So a fall is taken only where the body lives:
     *
     *   `netDriven` — a guest's mirror never fells itself. Its position is the
     *   host's, damped in by `World._stepNetEnemies`, and a local ragdoll would
     *   be a second simulation fighting that stream.
     *   `source.isRemote` — a shove that arrived as an `imp` claim is a blow
     *   the thrower is already drawing on their own machine. The host bills it
     *   in full (the impulse, the damage, the 1.2 s stun, the scream); it does
     *   not also fell, because the guest could not follow that fall.
     *
     * WHAT IT COSTS, stated rather than hidden: in co-op a guest's push rocks a
     * body where the host's fells it, so §7's OPEN verb is weaker for everyone
     * who is not hosting. Closing that needs the FALL on the wire as an event —
     * `World.onExplosion`'s "the client draws it and the host bills it" — plus
     * a guest's ragdoll pinned to the host's position rather than free. That is
     * a protocol change and it is written up in NEXT.md rather than smuggled in
     * behind a physics fix.
     */
    if (this.netDriven || source?.isRemote) return false;
    /**
     * ── AND IT GOES LIMP ON THE NEXT STEP, NOT INSIDE THE BLOW ────────────
     *
     * This called `goRagdoll` here, and that put nineteen fresh dynamic bodies
     * into `world.physics` IN THE MIDDLE OF THE SWEEP THAT FELLED IT.
     * `Player.forcePush` and `_shockwave` both answer the bodies first and then
     * walk `ctx.physics.bodies` to shove loose furniture — so the same press
     * hit the same body twice: once as a body, then once per bone, at
     * `mass * 15 * k * P` each.
     *
     * Measured on a host/client pair, one push, the same 15.98 impulse landing
     * at both ends: the chest launched at **15.86 m/s on the host and 26.64 on
     * the guest**, and the guest's copy climbed instead of falling and never
     * decelerated — 18.16 m of flight against the host's 4.17 m. The two ends
     * differed because the host receives the shove as an `imp` claim, which is
     * `applyKnockback` ALONE with no furniture sweep behind it, while the guest
     * ran the whole power locally. Two checks in `coop.mjs` caught it.
     *
     * So the fall is RECORDED here and taken in `_move`, which is the one
     * function both machines run for this body — `Enemy.update` on the owner
     * and `World._stepNetEnemies` on a guest inside its authority window. By
     * then the sweep is over and there is nothing loose to double-bill.
     *
     * THE TUMBLE IS THE BLOW, NOT A DIE ROLL. `topple()` spins its ragdoll out
     * of `rng()`, which is right for a machine whose legs went and wrong here:
     * `rng()` is a module stream, so a host and a guest launching the same body
     * off the same impulse drew DIFFERENT spins and two chaotic solves went
     * their own ways. Crossing the impulse with the vertical gives a tumble
     * about the axis the shove actually turns the body around, and it is the
     * same on every machine that saw the same blow.
     */
    this._flatten = (this._flatten || new THREE.Vector3()).copy(impulse);
    return true;
  }

  /**
   * Take the fall `knockFlat` recorded, once the blow that caused it is over.
   * Called from `_move` on every machine that steps this body.
   */
  _takeFall() {
    const launch = this._flatten;
    this._flatten = null;
    if (!launch) return false;
    if (this.dead || this.gripped || this.stasisHeld) return false;
    if (!this.actor || this.actor.ragdolled) return false;
    /* THE SHOVE IS THE LAUNCH. `addShove` has already put the impulse into
     * `velocity`, so handing the ragdoll the body's own velocity sends it the
     * way it was thrown rather than dropping it where it stood. */
    _v1.crossVectors(launch, UP);
    const spin = _v1.lengthSq() > 1e-6 ? _v1.normalize().multiplyScalar(2.4) : _v1.set(0, 0, 0);
    this.actor.goRagdoll(this.velocity.clone(), spin);
    /* The physics capsule goes with it, exactly as in `topple()` — a body
     * walking with no collider is the bug from the other side, and `recover()`
     * is the one place that puts it back. */
    if (!this.bodyRemoved) {
      this.world.physics.remove(this.body);
      this.bodyRemoved = true;
    }
    return true;
  }

  /**
   * GET UP — the other half of `Actor.recover`, and the whole of note #6.
   *
   * A living body that has been ragdolled (gripped and released, thrown,
   * toppled by a blast) puts itself back together, stands where the ragdoll
   * came to rest, and spends `beat` seconds on the floor first.
   *
   * THREE THINGS HAVE TO HAPPEN TOGETHER or the body is worse off than it was:
   *
   *  1. the visuals come back onto the rig (`Actor.recover`),
   *  2. the walking capsule goes back into the world — `topple` and the death
   *     path both REMOVE it, and a body walking with no collider is the bug
   *     from the other side,
   *  3. the position is taken from where the ragdoll LANDED. Everything else
   *     in this class reads `this.position`, which has been frozen at the spot
   *     the body left the ground since the moment it went limp, so recovering
   *     without this line teleports the character back across the room.
   *
   * The get-up beat is a `stun`, which is the natural window: the body is
   * already on the floor, `stun` already breaks whatever it was casting, and
   * every consumer of "can this act" already reads `stunTimer`.
   */
  recover(beat = 1.1) {
    if (this.dead || !this.actor?.ragdolled) return false;
    const at = this.actor.recover();
    if (at) {
      const ground = this.world?.terrain ? this.world.terrain.height(at.x, at.z) : at.y;
      this.position.set(at.x, Math.max(ground, at.y - (this.A.big ? 1.2 : 0.7)), at.z);
      this.velocity.set(0, 0, 0);
      this.grounded = true;
    }
    if (this.bodyRemoved && this.body && this.world?.physics) {
      this.world.physics.add(this.body);
      this.bodyRemoved = false;
    }
    /* `toppled` is a walker losing its legs and is NOT recoverable — a spider
     * droid on its back stays on its back. Only clear it if the legs are still
     * there, which is the condition `topple` itself is about. */
    if (this.toppled && !this.legsLost) { this.toppled = false; this.stunTimer = 0; }
    this._syncBody();
    this.stun(beat);
    this._recoverAt = 0;
    return true;
  }

  /**
   * A LIVING BODY DOES NOT STAY DOWN. Called every frame from `update`.
   *
   * The rule is one line and its subject is everything that can put a body on
   * the floor: if it is alive, limp, and nothing is holding it, it gets up
   * after `GET_UP` seconds of lying still. Written as a countdown started by
   * the CONDITION rather than by each of the four call sites that can cause
   * it, because a fifth will be added and would not have known to arm a timer.
   */
  /**
   * SOMEBODY IS HOLDING THIS, AND IS STILL SAYING SO. See GRIP_LEASE.
   *
   * The one door into `gripped`. Called every frame by whatever has the body —
   * `Player._updateGrip` locally, `World.applyClaim` for a peer's lift — and
   * the flag lapses on its own the moment those stop calling, whatever the
   * reason they stopped.
   *
   * `Math.max` rather than an assignment so two holders cannot shorten each
   * other's lease, and so a caller that renews at less than frame rate (the
   * net path claims at the snapshot tick) is not fighting one that renews
   * every frame.
   */
  hold(seconds = GRIP_LEASE) {
    this.gripped = true;
    this.gripLease = Math.max(this.gripLease, seconds);
  }

  /** Let go, from either end. Idempotent, and it is the only way out. */
  releaseHold() {
    if (!this.gripped && !this.liftTarget) return false;
    this.gripped = false;
    this.gripLease = 0;
    this.liftTarget = null;
    this.chokeT = 0;
    return true;
  }

  /**
   * IS THERE ANYTHING OF THIS BODY ON SCREEN? — the ghost audit.
   *
   * "troops go completely invisible a lot like I see their names above their
   *  heads but they're invisible, I can still throw them around though."
   *
   * The grip lease above is one road to that; it is not the only one, and the
   * report has come back across builds in which each individual road was
   * closed. A body's visibility is written by six systems that do not know
   * about each other — the ragdoll swaps the rig for holders and back, the LOD
   * hides detail by range, a cut hides a severed subtree, `Corpses.fade` turns
   * every material transparent and winds its opacity to zero, `Ink`'s prepass
   * hides transparent objects for one render and shows them again, and first
   * person hides parts of a body you are inside — and EVERY ONE of them is a
   * hide with a matching show somewhere else in the file. A missed show is
   * therefore not one bug, it is a shape of bug, and the sixth of them will be
   * written by somebody who has not read this comment.
   *
   * So the invariant is checked rather than argued: A LIVING BODY DRAWS
   * SOMETHING. Nothing else in this method has an opinion about which meshes
   * should be visible — that is exactly the mistake that would break LOD and
   * un-sever severed limbs — it asks only whether the total is zero, and only
   * then puts back the minimum that makes the body exist: the bone primaries,
   * which are the silhouette (`_collectLodParts` keeps them at every range),
   * skipping any bone that has genuinely been cut off.
   *
   * Three repairs, in the order the causes actually happen:
   *
   *   THE ROOT'S OWN SWITCH. `rig.root.visible` belongs to the ragdoll and is
   *     `!ragdolled`, always. A body limp with the switch left down is the
   *     invisible half of the player's sentence, and the capsule that is
   *     "still throwable" is the other half.
   *   AN ORPHANED SUBTREE. A root or a holder with no parent draws nothing
   *     wherever its own flags are. Re-added to the scene it was built for.
   *   A FADE NOBODY FINISHED. `Corpses.fade` writes `transparent` and an
   *     opacity on a body's own materials and has no inverse; anything that
   *     hands a body back to the living after that leaves it a clear pane.
   *
   * COST. `AUDIT_EVERY` seconds per body, jittered at construction so twenty
   * of them do not land on one frame, and the traverse stops at the first
   * visible mesh it finds — which for a healthy body is the first bone it
   * looks at. Measured on a 42-body field: under 0.05 ms a frame.
   */
  _auditVisible(dt) {
    if (this.dead || !this.rig?.root) return;
    this._auditT -= dt;
    if (this._auditT > 0) return;
    this._auditT = AUDIT_EVERY;

    const ragdolled = !!this.actor?.ragdolled;
    let fixed = false;
    /* 1. THE SWITCH. Cheap, and on its own it is most of the defect. */
    if (this.rig.root.visible === ragdolled) { this.rig.root.visible = !ragdolled; fixed = true; }
    /* 2. ORPHANS. */
    const scene = this.world?.scene;
    if (scene && !this.rig.root.parent) { scene.add(this.rig.root); fixed = true; }
    if (scene && ragdolled && this.actor?.holders) {
      for (const h of this.actor.holders.values()) if (!h.parent) { scene.add(h); fixed = true; }
    }
    /* 3. NOTHING IS DRAWING AT ALL. Put the silhouette back. One traverse,
     * after the two cheap repairs above, because either of them may already
     * have been the reason nothing was drawing. */
    if (!this._anyVisibleMesh()) {
      for (const b of this.rig.list) {
        if (b.severed || !b.primary) continue;
        b.primary.visible = true;
        for (let o = b.primary.parent; o && o !== scene; o = o.parent) o.visible = true;
        const mats = Array.isArray(b.primary.material) ? b.primary.material : [b.primary.material];
        for (const m of mats) { if (m && m.transparent && m.opacity < 0.999) m.opacity = 1; }
      }
      fixed = true;
    }
    if (fixed && this.world) this.world.ghostFixes = (this.world.ghostFixes || 0) + 1;
  }

  /** The first drawn triangle wins — see `_auditVisible`. */
  _anyVisibleMesh() {
    /* AN INSTANCE IS DRAWING. Past L3_AT this body's own meshes are all hidden
     * on purpose and its triangles are submitted by a shared InstancedMesh
     * (src/game/Cohorts.js) — so the audit below would find nothing, put the
     * bone primaries back, and draw the body twice. */
    if (this._l3) return true;
    const drawn = (o) => {
      if (!o.visible) return false;
      if (o.isMesh && o.geometry) {
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        /* A mesh at zero opacity is a mesh nobody can see. The player is not
         * making a distinction between "hidden" and "clear" and neither is
         * this. */
        if (mats.some((m) => m && (!m.transparent || m.opacity > 0.02))) return true;
      }
      for (const c of o.children) if (drawn(c)) return true;
      return false;
    };
    if (this.rig?.root?.parent && drawn(this.rig.root)) return true;
    if (this.actor?.holders) {
      for (const h of this.actor.holders.values()) if (h.parent && drawn(h)) return true;
    }
    return false;
  }

  /**
   * STOP SHOOTING, NOW — the body's own answer, and the only implementation.
   *
   * `Waves.holdFire` is the name the rest of the game calls this by (the HOLD
   * FIRE order, the arrival walk-in, the slider that switches a training remote
   * off) and it delegates here. It lives on the body because Enemy.js cannot
   * import Waves.js — Waves imports Enemy — and a second copy of these four
   * lines is exactly the twin this repository keeps deleting.
   *
   * Zeroing `burstLeft` is the load-bearing part: a droideka with six rounds
   * queued would otherwise finish them out of a body that has just thrown
   * itself flat.
   */
  stopFiring() {
    this.burstLeft = 0;
    this.burstTimer = 0;
    if (!(this.attackTimer > 0.5)) this.attackTimer = 0.5;
    if (this.aimCharge > 0) { this.aimCharge = 0; this._endTelegraph?.(); }
  }

  _tickGetUp(dt) {
    /* THE LEASE FIRST, and outside the ragdoll guard: a body can be marked
     * held without having been ragdolled yet (`_move` does that on its next
     * frame), and one abandoned in that window would keep the flag with
     * nothing here ever looking at it again. */
    if (this.gripped) {
      this.gripLease -= dt;
      if (this.gripLease <= 0) this.releaseHold();
    }
    /* AND THE SAME RULE FOR A MAN SOMEBODY IS CARRYING. `Reactions.startDrag`
     * claims a casualty so ten men do not grab one; the claim is renewed every
     * frame by `stepDrag` and lapses here if the man doing it stops — because
     * he died, because a grenade landed next to him, or because anything else
     * replaced his reaction. A casualty nobody can ever help again is worse
     * than one nobody helped. */
    if (this.beingDragged) {
      this.dragLease = (this.dragLease ?? 0) - dt;
      if (this.dragLease <= 0) { this.beingDragged = null; this.dragLease = 0; }
    }
    if (this.dead || !this.actor?.ragdolled) { this._recoverAt = 0; return; }
    if (this.gripped || (this.toppled && this.legsLost)) { this._recoverAt = 0; return; }
    /* Wait for it to be still first. Getting up mid-flight is the other
     * comedy — a body two metres in the air snapping upright — so the timer
     * only runs while the ragdoll's own chest is slow. */
    const b = this.actor.bodies.get('chest') || this.actor.bodies.get('spine')
      || this.actor.bodies.get('hips');
    if (b && b.velocity.lengthSq() > 4) { this._recoverAt = 0; return; }
    this._recoverAt = (this._recoverAt || 0) + dt;
    if (this._recoverAt >= GET_UP) this.recover();
  }

  /**
   * HOW WELL THIS BODY IS SHOOTING RIGHT NOW — a multiplier on its own spread,
   * where 1 is its archetype's stated best and larger is worse.
   *
   * "weather should effect ability of enemies and allies to aim like they
   * shouldn't have perfect aim, aim should be a skill like better enemies or
   * allies do it better you know what I mean?"
   *
   * Before this, the only thing between an archetype's `spread` and the bolt
   * was the DIFFICULTY setting — one number for the whole roster, identical
   * for a raw B1 and a veteran ARC, identical standing still and at a dead
   * run, and identical in clear air and in a whiteout that has cut sight to
   * forty metres. A sandstorm changed the look of a fight and nothing about
   * it, which is what `ROADMAP.md` records too: "Enemy.js has no fog or
   * visibility term, so a whiteout cutting sight to 47 m changes nothing".
   *
   * FIVE TERMS, and every one of them is a thing the player can see and act
   * on. That is the test each had to pass: a hidden accuracy modifier is a
   * random number generator with extra steps.
   *
   *   WEATHER    the storm's own `visibility()`, which is the metres at which
   *              half the light survives. Past it you are shooting at a shape,
   *              and the term is the ratio — so at the edge of sight a shot is
   *              twice as loose and at three times the range it is four times.
   *              This is also the term that makes a whiteout worth standing in.
   *   SKILL      the body's own. A rank is a soldier who has done this before,
   *              so the promotion ladder buys accuracy as well as health, and
   *              `elite` buys it too. Falls out of RANKS rather than adding a
   *              second table beside it.
   *   MORALE     a shaken body does not shoot straight. Squad morale is
   *              Command's, and the whole of the effect it has on gunnery is
   *              this line. Bodies with no morale (the horde) read 1.
   *   DREAD      …and a body a commander has just reached through the Force
   *              has had its nerve taken from it for a few seconds whether or
   *              not it owns any. This is the term that lets the disruption
   *              verb bite a HORDE — the enemy in a campaign carries no roster
   *              record, so it has no morale to lower, and a verb that only
   *              worked in a two-player meeting would be a verb that does
   *              nothing in the mode it was written for. See DREAD.
   *   MOVEMENT   a body running is not aiming. This is the one term with a
   *              tactical instruction inside it — troops that stop shoot
   *              better — and it is why HOLD and TAKE COVER are worth giving.
   *   RANGE      past the archetype's own `preferred` band, its weapon is
   *              being asked to do something it was not sighted for.
   *
   * Bounded at both ends: nothing shoots better than 0.55 of its stated
   * spread, because a perfect shot is the thing the player asked to remove,
   * and nothing shoots worse than 4.5, because past that a firing line is
   * decoration.
   */
  aimQuality(range = 20) {
    const A = this.A;
    let q = 1;

    // ── weather
    if (this.world?.level?.atmosphere && weather.intensity > 0.02) {
      const vis = weather.visibility(this.world.level.atmosphere.fogDensity ?? 0.004);
      if (range > vis * 0.6) q *= 1 + clamp((range - vis * 0.6) / Math.max(8, vis), 0, 2.6);
    }

    // ── skill: the rank ladder, and elites
    const r = this.trooper ? this.trooper.rank : 0;
    q *= AIM_BY_RANK[Math.min(r, AIM_BY_RANK.length - 1)];
    /* `A.elite`, NOT `this.elite`, AND THAT ONE WORD WAS THE WHOLE TERM.
     * `applyModifier` writes the promotion onto the CLONED archetype
     * (`A.elite = key`) and onto the body as `e.mod`; nothing anywhere in the
     * tree ever writes `e.elite`, so this read was `undefined` on every
     * promoted body the game has ever fielded and the line above it — "a rank
     * is a soldier who has done this before … and `elite` buys it too" —
     * described a term that never fired. Measured on a real Enemy through
     * `applyModifier`: aimQuality 1.2333 → 1.2333 for frenzied, shielded,
     * unstable, armoured and leader alike, six of the seven modifiers at
     * exactly 1.000×. What it is worth, over 200 000 shots of the same
     * arithmetic `_shoot` uses, against a 0.35 m torso at each body's own mid
     * band on Knight: an elite B1 lands 42.7% of its bolts where it should land
     * 57.2%, and an elite trooper 68.7% against 84.0% — 1.34× and 1.22× of the
     * fire the wave's budget has already been charged for. */
    if (A.elite) q *= 0.86;

    /**
     * ── morale, ANCHORED ON THE RESTING POINT AND NOT ON THE CLAMP
     *
     * This was `lerp(1.65, 0.9, morale)` — 0.90 at the top of the scale — and
     * it was written when every record in a winning line sat pinned at 1.000
     * (see `MORALE.PRESENCE_CAP`, and NEXT.md on the Dead Jedi table). So 0.90
     * was in practice a CONSTANT: it is what every allied trooper in the game
     * has always shot at.
     *
     * Unpinning morale would have quietly moved it. A line now settles at the
     * presence ceiling instead of the clamp, and read off the old curve that is
     * a 12.5% worse spread on every soldier on your side — a balance change
     * nobody asked for, arriving as a side effect of a bug fix.
     *
     * So the curve is anchored where the line actually rests: `PRESENCE_CAP`
     * maps to the same 0.90 it always did, 0 maps to the same 1.65, and the
     * band ABOVE the ceiling — which only exists for a few seconds after a wave
     * is cleared or an area taken — buys a little more. That is the elation
     * this game did not previously have anywhere to put.
     */
    if (this.trooper && this.trooper.morale !== undefined) {
      const m = clamp(this.trooper.morale, 0, 1);
      const cap = MORALE.PRESENCE_CAP;
      q *= m <= cap
        ? lerp(1.65, 0.9, m / Math.max(cap, 1e-3))
        : lerp(0.9, 0.82, (m - cap) / Math.max(1 - cap, 1e-3));
    }

    /**
     * ── …AND THE BODY'S OWN NERVE, WHICH IS THE HORDE'S HALF OF THE TERM ABOVE
     *
     * The morale clause is gated on `this.trooper`, so it has always been the
     * ROSTER's number and this line used to be the whole of what a body without
     * a record had. `nerveAim` is the identity for a body that has one — the
     * clause above already ran — and for the horde it is the same curve
     * anchored at 1, so a full-nerve droid is exactly as accurate as it was
     * before this shipped and a broken one is as bad as a broken trooper.
     */
    q *= nerveAim(this);

    // ── dread: the same effect, from outside, on a body that has no record
    if (this.dread > 0) q *= DREAD.aim;

    // ── movement: measured off the body, not off an intent
    const v = this.velocity ? this.velocity.length() : 0;
    q *= 1 + clamp(v / Math.max(1.5, this.speed || 4), 0, 1.4) * 0.55;

    // ── range against its own band
    const far = A.preferred?.[1] ?? 24;
    if (range > far) q *= 1 + clamp((range - far) / far, 0, 1.5) * 0.7;

    return clamp(q, 0.55, 4.5);
  }

  /**
   * THE ENGINES: a plume, some exhaust, and a noise. Note #33.
   *
   * "they need to have actual jetpacks and exhaust and engines that fire and
   * thrust and makes sounds like you know what I mean?" Three things, and the
   * body had none of them — the pack was a shape on a back and the man
   * hovered in silence.
   *
   * @param power 0..1.6 — how hard the engines are working right now.
   */
  _jetFx(dt, ctx, power) {
    const jets = this.rig?.jets;
    if (!jets || !jets.length) return;
    /* THE FLAME IS A LENGTH. Scaled on Y only, so the cone stays the width of
     * the bell it comes out of and grows out of it — a flame that gets fatter
     * as it gets longer is a fire, and this is a nozzle. */
    const want = clamp(power, 0, 1.6);
    this._jetShow = damp(this._jetShow ?? 0, want, 11, dt);
    /* Flicker, per engine and out of phase, because two perfectly matched
     * plumes read as one object drawn twice. */
    for (let i = 0; i < jets.length; i++) {
      const f = 0.86 + Math.sin(this.hoverPhase * 9 + i * 2.1) * 0.10 + rng() * 0.08;
      const L = Math.max(0.001, this._jetShow * f);
      jets[i].scale.set(0.72 + this._jetShow * 0.34, L, 0.72 + this._jetShow * 0.34);
      const m = jets[i].material;
      if (m) m.opacity = clamp(0.30 + this._jetShow * 0.55, 0, 0.95);
    }
    if (!ctx) return;
    /* THE EXHAUST, and it comes off the bells rather than off the body: two
     * emitters at the real nozzle positions, so a trooper banking away leaves
     * two trails and not one. Rate-limited on the same clock the flame uses —
     * a hovering man makes a wisp and a climbing one makes a column. */
    const P = ctx.particles;
    this._jetPuff = (this._jetPuff || 0) - dt * (2 + this._jetShow * 26);
    if (P && this._jetPuff <= 0) {
      this._jetPuff = 1;
      for (const j of jets) {
        j.getWorldPosition(_v6);
        _v7.set((rng() - 0.5) * 0.5, -2.4 - this._jetShow * 3.6, (rng() - 0.5) * 0.5);
        P.smoke?.spawn?.(_v6, _v7, { life: 0.5 + rng() * 0.4, size: 0.16 + this._jetShow * 0.14,
          drag: 1.6, gravity: 0.4, color: 0x9aa6b4, alpha: 0.16 });
        P.plasma?.spawn?.(_v6, _v7, { life: 0.14, size: 0.10 + this._jetShow * 0.10,
          drag: 2.2, gravity: 0, color: 0x9fd0ff, alpha: 0.5 });
      }
    }
    /* AND IT IS AUDIBLE. `audio.jet` is a positional loop that follows the
     * body; it is started once and told how hard it is working after that, so
     * twelve jet troopers are twelve voices rather than twelve retriggers a
     * frame. */
    audio.jet?.(this.position, this._jetShow, this.id);
  }

  applyKnockback(impulse, damage, source, gentle) {
    if (this.dead) {
      // `impulse` is legitimately null — `_sustain` bills damage with no shove
      // behind it — and this line dereferenced it, so a held power that outlived
      // its victim threw inside world.update(). Latent, but reachable.
      if (this.actor?.ragdolled && impulse) {
        for (const b of this.actor.bodies.values()) b.applyImpulse(_v1.copy(impulse).multiplyScalar(b.mass * 0.4), b.position);
      }
      return;
    }
    /**
     * PUSHING INTO A PUSH IS A CONTEST. Measured before this existed: two Force
     * users shoving at each other both landed in full, and a Master with 150 of
     * pool was moved exactly as far as one with none.
     *
     * The blow is weighed ONCE — the shove priced alongside the damage, see
     * IMPULSE_AS_HP — and the fraction the pool buys back is applied to both,
     * so a body cannot be billed twice for one blow and cannot blunt the harm
     * while taking the whole ride. `preResisted` carries that decision down
     * into `damage()`.
     */
    let dmg = damage || 0;
    const weight = dmg + (impulse ? impulse.length() * IMPULSE_AS_HP : 0);
    const blunt = this.resistForce(weight, 'force', source);
    if (blunt > 0) {
      const k = Math.max(0, 1 - blunt / weight);
      dmg *= k;
      if (impulse) impulse = _res.copy(impulse).multiplyScalar(k);
    }
    /* AND THE SHOVES DO NOT STACK — see `addShove` above, which is where the
     * rule and the 718 m measurement behind it are written down. It is on this
     * side of the contest as well as the player's because the contest IS
     * symmetric and a body the player's army surrounds stands in the same ring:
     * `unleash` alone puts every body inside 9 m through this door on one
     * frame. */
    if (impulse) addShove(this, impulse);
    this.knockTimer = gentle ? 0.35 : 0.7;
    this.grounded = false;
    // A real shove beats a guard, so it beats whatever that guard was holding
    // together. `stun` below only fires past 12 m/s and never on a boss, which
    // is why this cannot be left to it.
    if (!gentle) this.breakCast();
    if (dmg > 0) this.damage(dmg, this.position, source, 'force', true);
    if (!gentle && impulse && impulse.length() > 12 && this.actor && !this.A.boss) {
      // hit hard enough to leave its feet — and the impulse IS the direction
      this.stun(1.2, impulse, 1.4);
      /* …AND THE COMMENT ABOVE WAS THE WHOLE OF IT. See `knockFlat`: the line
       * said the body leaves its feet and the code left it standing. */
      this.knockFlat(impulse, source);
    }
    // "I want to hear the enemies scream as they get force thrown" — the throw
    // is the impulse, so the trigger belongs exactly here rather than in
    // whichever power happened to produce it.
    if (!gentle && impulse && impulse.length() > 10) this.cry('scream', 0.9);
  }

  /**
   * SAY SOMETHING — player note #21, "I want to hear their screams".
   *
   * WHAT THIS FILE DECIDES IS *WHEN*, AND NOTHING ELSE. It does not pick a
   * larynx and it does not call `audio.speak`, for two reasons that are both
   * about not making a second copy of a rule:
   *
   *  · WHICH VOICE a body has is derived from `bodyOf` (src/engine/Presence.js)
   *    and mapped to a spec by `Announcer._enemySpec` — one classifier, and the
   *    note over it explains at length what happened the last time that mapping
   *    was written down twice (the Reek and the Nexu died with a human throat).
   *  · HOW OFTEN the room may speak is the announcer's shared enemy budget,
   *    which exists so a squad wiped in one second does not produce five
   *    simultaneous deaths. A body that spoke directly would be outside it.
   *
   * So this raises an EVENT — the same `world.onXxx` shape `onHitmark`,
   * `onKillFeed` and `onDeflectFeedback` already use, wired in src/main.js —
   * and the announcer, which owns both of those rules, decides what comes out.
   * `kind` is one of Voice.js's ENEMY_LINES: 'scream', 'panic', 'alarm',
   * 'chatter'.
   *
   * The per-body gap is here rather than in the announcer because it is a
   * different rule from the room's: it stops ONE body from screaming twice in
   * a second while being knocked down a slope, which no shared budget can see.
   */
  cry(kind, gap = 1.2) {
    /* `this._netRemote` USED TO BE THE SECOND CLAUSE HERE, and nothing in the
     * tree has ever written it — one read, no writer, so the guard was inert on
     * every body in every session. It is deleted rather than wired, and which
     * way round that goes is the part worth recording: the obvious repair is
     * `this.netDriven`, and it would be a regression. Enemy voices are NOT on
     * the wire (grep `onEnemyVoice`; `Net.js` carries no voice packet), so on a
     * guest the local `cry` is the ONLY source of them — suppressing it would
     * hand a joining player a battlefield in which nothing screams. A dead
     * guard that would break the game if somebody made it live is worse than
     * no guard, because it reads as an oversight. */
    if (this.dead) return false;
    const t = this.world?.time ?? 0;
    if (t < (this._cryAt ?? -99) + gap) return false;
    this._cryAt = t;
    this.world?.onEnemyVoice?.(this, kind);
    return true;
  }

  /**
   * Stunned — and, if it is holding a blade, visibly beaten.
   *
   * Every caller that stuns a duellist has already decided that its guard lost:
   * a parry, a chamber, a lost blade lock, a Force shove, a heavy cut. All of
   * them used to produce a body that stood still for a moment with its guard
   * exactly where it was, which is why "the enemy reacts to being parried" was
   * a thing the code did and not a thing you could see. Routing it through the
   * duel brain gives the same event a blade that is thrown out of line and
   * stays there — see DuelBrain.stagger.
   */
  stun(t, fromDir = null, power = 1) {
    this.stunTimer = Math.max(this.stunTimer, t);
    // …AND IT BREAKS WHATEVER THE BODY WAS REACHING FOR. Every caller of this
    // method has already decided the guard lost, and a guard that lost cannot
    // be holding a power together. See `breakCast` for what used to happen
    // instead, which was that the wind-up FROZE and arrived afterwards.
    this.breakCast();
    if (this.duel && !this.dead) this.duel.stagger(t, fromDir, power);
  }

  dropShield() {
    if (!this.shieldUp) return;
    this.shieldUp = false;
    if (this.built?.shield) this.built.shield.visible = false;
    if (this.shieldMesh) this.shieldMesh.visible = false;
    this.shieldHp = 0;
    // A droideka's own generator cycles back up; an elite's bubble does not.
    // Bringing it back would make the one clean pass that broke it worth
    // nothing, and the whole counter-play is that the pass is worth something.
    this.deployTimer = this.mod === 'shielded' ? Infinity : 4.5;
    audio.explosion(this.position, 0.4);
    this.world.particles?.sparkBurst(this.aimPoint(_v1), null, 30, { speed: 12, color: 0x88ffcc });
  }

  die(point, source, kind) {
    if (this.dead) return;
    this.dead = true;
    this.dying = 0;
    this.world.onEnemyKilled?.(this, source, kind);

    /* THE ONE WHO SAW IT, and this is the half the announcer cannot do.
     *
     * `Announcer._enemies` already breaks a squad after three deaths inside
     * three and a half seconds — a WAVE-level rule, and a good one — but it
     * speaks through whichever body is nearest the PLAYER, which on a wide
     * field is regularly somebody who was not there. A death is witnessed by
     * whoever is standing next to it: 14 m, one of them, and it is the nearest
     * because that is the one the player can also see falling.
     *
     * The gap is deliberately long. A wave cleared body by body would
     * otherwise produce a running commentary, and panic that never stops is
     * not panic. */
    let saw = null, sawD = 14 * 14;
    for (const o of (this.world.enemies || [])) {
      if (o === this || o.dead || !o.position || o.team !== this.team) continue;
      const d2 = o.position.distanceToSquared(this.position);
      if (d2 < sawD) { sawD = d2; saw = o; }
    }
    saw?.cry('panic', 6.0);

    // Retire the hum with the body. dispose() only runs 40s later, when the
    // corpse is cleaned up, and retract() merely fades the gain — so a cleared
    // wave of twelve duellists carried twelve full oscillator stacks and twelve
    // HRTF panners into the next wave. That is what overloads the audio thread.
    if (this.hum) {
      const h = this.hum; this.hum = null;
      h.retract();
      setTimeout(() => { try { h.dispose(); } catch {} }, 400);
    }
    // The elite fittings go with the body: a corpse is not shielded, does not
    // lead, and — for exactly UNSTABLE.fuse seconds — is still a bomb.
    if (this.shieldMesh) { this.shieldUp = false; this.shieldMesh.visible = false; }
    if (this.rallyRing) this.rallyRing.visible = false;
    if (this.offSaber) {
      this.offSaber.retract();
      setTimeout(() => this.offSaber && this.offSaber.setVisible(false), 900);
    }
    if (this.mod === 'unstable' && !this._detonated) {
      this.fuse = UNSTABLE.fuse;
      audio.tone({ freq: 700, freqEnd: 2600, dur: UNSTABLE.fuse, gain: 0.12, type: 'square', pos: this.position });
      this.world.notifyFloating?.(this.aimPoint(_v3), 'UNSTABLE', '#ff8a40');
    }
    if (this.telegraphArc) this.telegraphArc.hide();
    /**
     * AND THE JETPACK STOPS, which is the one voice in the engine with a
     * MANUALLY MANAGED LIFETIME and the one nothing was managing.
     *
     * `audio.jet(pos, power, id)` opens a continuous positional voice and
     * releases it only on a later call with `power <= 0.02`. That call comes
     * from `_move`, which `update` returns above the moment `this.dead` — so a
     * dead jet trooper's roar was held open at the spot it fell, forever.
     * Measured: five seconds after death `audio._jets` still held 1; after
     * `dispose()` it still held 1; only `unload()` cleared it. Eight troopers
     * dying takes `_jets` to its cap of 6 — six live panners and six of the
     * thirty world-band voices gone — and a NINTH, ALIVE trooper 1.7 m from the
     * listener then got no voice at all, because the cap was full of corpses.
     *
     * Here rather than in `dispose()` because `dispose()` runs forty seconds
     * later when the corpse is cleaned up, and a corpse should not be roaring
     * for forty seconds. The same argument the hum above is retired on.
     * `dispose()` gets the line too, for a body that is removed without dying.
     */
    audio.jet?.(this.position, 0, this.id);
    if (this.cloak) { this.cloak.dispose(); this.cloak = null; }
    if (this.skirt) { this.skirt.dispose(); this.skirt = null; }
    if (this.saber) {
      /**
       * THE BLADE LEAVES THE HAND — and it used to be DELETED instead.
       *
       * The player, on the last build: "when lightsaber having enemies died
       * their sabers would stay suspended on and in the air, they should fall
       * to the ground their user is dead, sometimes retracting automatically,
       * sometimes staying on and on the floor."
       *
       * What shipped was `retract()` and then `setVisible(false)` on a 900 ms
       * `setTimeout`: the blade went out and the HILT CEASED TO EXIST, which is
       * the same complaint from the other side — a Jedi's weapon, the one
       * object in this game a player would cross a field for, evaporating on
       * the frame its owner fell. `Dropped.js` has existed the whole time for
       * exactly this ("drop and pick up sabers, including a friend's") and
       * `Enemy.cut` already reaches for it when an arm comes off; a death did
       * not.
       *
       * And a `setTimeout` was doing gameplay. It does not stop for the pause
       * menu, it does not stop for a level unload, and it fires into a world
       * that may no longer exist — the hilt is a prop now and the world's own
       * clock owns it.
       *
       * SOMETIMES IT GOES OUT AND SOMETIMES IT DOES NOT, which is the player's
       * own sentence and is worth more than either rule on its own: a field
       * after a duel has a couple of blades still burning on it and the rest
       * gone dark, so walking up to one is a decision rather than a formality.
       * Two in five stay lit — enough to be a sight, few enough to stay one.
       */
      const lit = !this.saber.physical && rng() < DEAD_BLADE_LIT;
      const hand = this.actor?.bodies?.get('handR') || this.actor?.bodies?.get('foreR');
      _v1.copy(hand?.position || this.saber.base || this.position);
      _v2.copy(this.velocity).multiplyScalar(0.5);
      _v2.x += (rng() - 0.5) * 1.6; _v2.y += 1.1; _v2.z += (rng() - 0.5) * 1.6;
      dropSaber(this.world, {
        position: _v1,
        velocity: _v2,
        colorIndex: this.saber.colorIndex,
        hiltStyle: this.saber.hiltStyle,
        order: this.saber._order ?? null,
        owner: this,
        lit,
        weaponStyle: this.A.weaponStyle ?? null,
      });
      this.saber.retract();
      this.saber.setVisible(false);
    }
    if (this.actor && !this.actor.ragdolled) {
      _v1.copy(this.velocity).multiplyScalar(0.6);
      if (point && source) {
        _v2.subVectors(this.position, source.position ?? point).setY(0.4).normalize().multiplyScalar(2.2);
        _v1.add(_v2);
      }
      this.actor.goRagdoll(_v1, _v3.set((rng() - .5) * 6, (rng() - .5) * 4, (rng() - .5) * 6));
    }
    if (this.group) {
      this.world.particles?.explosion(this.aimPoint(_v1), 0.9);
      audio.explosion(this.position, 0.8);
      this.world.spawnDebrisGroup(this.group, this.position.clone(), _v2.set(0, 3, 0), 0.9);
      this.group = null;
    }
    if (!this.bodyRemoved) { this.world.physics.remove(this.body); this.bodyRemoved = true; }
    /**
     * ── THE FAR RUNGS HAVE TO GIVE THE BODY BACK, AND `update` CAN NO LONGER
     *    ASK THEM TO ─────────────────────────────────────────────────────
     *
     * `applyBodyLod` is called from exactly two places, `_applyLod` and
     * `update`, and BOTH of them sit below `update`'s `if (this.dead) … return
     * this.dying < 40`. So the last word either rung hears about a body is the
     * one it heard while the body was alive.
     *
     * Both rungs already say a corpse is not theirs — `applyCohort`'s `fit` is
     * `lod >= 3 && !owner.dead && !owner.actor?.ragdolled`, and
     * `applyMergedSkin`'s `want` carries the same ragdoll clause — and neither
     * was ever asked again. What that costs, measured with
     * `tools/_cohortleak.mjs` on geonosis, twelve B1s stood at 163 m (L3_AT is
     * 137.8) and killed where they stood:
     *
     *     all 12 dead        members=9  deadMembers=6  instances=9
     *     45 s later         members=6  deadMembers=6  instances=6   ← disposed
     *
     * Six bodies that no longer exist, still members of a cohort, still drawn
     * as STANDING SOLDIERS by a shared InstancedMesh at the spot they fell —
     * while their ragdolls lay invisible underneath, because `darken()` had
     * hidden every mesh they own. And the slot is never handed back: `leave`
     * is the only thing that pushes to `c.free`, so `c.high` climbs with every
     * distant kill and `_grow` doubles the instance buffer to hold ghosts.
     *
     * One call, here, once the ragdoll exists so both rungs see `ragdolled`
     * and refuse: the cohort releases the slot, `undarken` gives the body its
     * own meshes back, and the merged skin puts the originals back on. The
     * guard is the same one `update` uses, so a body that was never past 62 m
     * pays nothing.
     */
    if (this._l2 || this._l2Wait || this._l3 || this._l3Wait) applyBodyLod(this, this.lod ?? 0);
    audio.thud(this.position, 1);
  }

  /* ── update ──────────────────────────────────────────────────────── */

  /* ── elites ──────────────────────────────────────────────────────── */

  /**
   * Everything a modifier has to do every frame, in one place.
   *
   * Runs for the living and the dead alike, because a fuse burns on a corpse
   * and a bubble has to be taken off one.
   */
  _updateElite(dt, ctx) {
    if (this.shieldMesh) {
      if (this.dead || !this.shieldUp) this.shieldMesh.visible = false;
      else {
        this.shieldMesh.visible = true;
        this.shieldMesh.position.copy(this.shieldCentre(_v5));
        const u = this.shieldMat.uniforms;
        u.uTime.value += dt;
        u.uPower.value = damp(u.uPower.value, clamp(this.shieldHp / this.shieldMax, 0, 1) * 0.9, 4, dt);
      }
    }
    if (this.rallyRing) {
      const live = !this.dead && !this.toppled;
      this.rallyRing.visible = live;
      if (live) {
        const gy = ctx.terrain ? ctx.terrain.height(this.position.x, this.position.z) : this.position.y;
        this.rallyRing.position.set(this.position.x, gy + 0.06, this.position.z);
        this.rallyRing.material.opacity = 0.20 + Math.sin(ctx.time * 2.4) * 0.06;
      }
      if (this.beacon) this.beacon.scale.setScalar(live ? 1 + Math.sin(ctx.time * 5) * 0.14 : 0.001);
    }
    // A LEADER IS A MULTIPLIER, AND IT SHOWS YOU EXACTLY WHOM IT MULTIPLIES.
    // The ring above is drawn at RALLY.radius, so the set of bodies inside it
    // is the set of bodies getting the buff — no guessing, and one obvious
    // target if you would rather not fight the buffed version of the wave.
    if (this.mod === 'leader' && !this.dead && !this.toppled) {
      const r2 = RALLY.radius * RALLY.radius;
      for (const other of ctx.enemies) {
        if (other === this || other.dead) continue;
        if (other.position.distanceToSquared(this.position) > r2) continue;
        other.rallyTimer = RALLY.refresh;
      }
    }
    if (this.fuse > 0) {
      this.fuse -= dt;
      if (this.coreMesh) {
        const k = clamp(1 - this.fuse / UNSTABLE.fuse, 0, 1);
        this.coreMesh.scale.setScalar(1 + k * 2.6);
        this.coreMesh.material.opacity = 0.55 + 0.45 * Math.abs(Math.sin(k * 26));
      }
      if (this.fuse <= 0) this._detonate();
    }
  }

  /**
   * The unstable core going off — after a fuse, never on the frame of death.
   *
   * The delay is the whole fairness argument: the core has been pulsing on its
   * chest since it walked in, it screams for 0.85 s once it dies, and only then
   * does it take the ground it is standing on. Long enough to walk out of,
   * short enough that you cannot ignore where you killed it. It hurts EVERYONE
   * inside the radius, which makes a bomb droid something you can aim.
   */
  _detonate() {
    this.fuse = 0;
    if (this._detonated) return;
    this._detonated = true;
    // The corpse's own centre if it has fallen, its torso if it has not — and
    // never a bone name this chassis might not have, which is what aimPoint's
    // fallback chain is for.
    /* `aimPoint` KNOWS ABOUT RAGDOLLS NOW — see the note there. This line used
     * to carry its own `actor?.ragdolled ? actor.centre(…)` clause, which is
     * the same rule written down twice and was the only call site that had it
     * right. One reader. */
    const point = this.aimPoint(_v1).clone();
    this.world.particles?.explosion(point, 1.6);
    this.world.onExplosion?.(point, 1.4);
    audio.explosion(point, 1.3);
    this.world.engine?.flash(0.09);
    if (this.coreMesh) this.coreMesh.visible = false;

    const R = UNSTABLE.radius;
    const hurt = (t) => {
      if (!t || t === this) return;
      const pos = t.position;
      if (!pos) return;
      const d = pos.distanceTo(point);
      if (d > R) return;
      const k = 1 - d / R;
      _v2.subVectors(pos, point).setY(0.55).normalize().multiplyScalar(UNSTABLE.impulse * k);
      if (t.applyKnockback) t.applyKnockback(_v2.clone(), UNSTABLE.damage * k, this, false);
      else {
        t.damage?.(UNSTABLE.damage * k, point, this, 'explosion');
        t.velocity?.add(_v2);
        t.camera?.addShake(0.5 * k);
      }
    };
    for (const p of (this.world.players || [])) hurt(p);
    for (const e of (this.world.enemies || [])) if (!e.dead) hurt(e);
  }

  update(dt, ctx) {
    /**
     * A BODY SOMEBODY ELSE HAS ALREADY TORN DOWN IS NOT SOMETHING TO STEP.
     *
     * There are two owners of a corpse and they do not talk to each other:
     * `Corpses` retires one by worth and calls `dispose()` on it, and THIS
     * method's own `return this.dying < 40` is what takes it out of
     * `world.enemies`. So a corpse the ledger spent at four seconds was still
     * stepped for another thirty-six — `actor.update` syncing bones that had
     * been removed from the physics world onto holders that had been removed
     * from the scene, and `saber.setHiltPose` posing a disposed blade.
     *
     * Returning false is the sentence `World.update` already knows how to
     * read: it disposes (a no-op now — see `dispose`) and splices, on the very
     * next frame.
     */
    if (this.disposed) return false;
    // A new frame: whatever short list of static boxes we hold was built
    // before destruction had its turn, so the first query of the frame
    // rebuilds it. See NEAR_REACH.
    this._nearStale = true;
    // …and a new frame opens a new shove account. See `addShove`.
    newShoveFrame(this);
    this._updateElite(dt, ctx);
    if (this.rallyTimer > 0) this.rallyTimer = Math.max(0, this.rallyTimer - dt);
    if (this.dread > 0) this.dread = Math.max(0, this.dread - dt);
    if (this.dead) {
      this.dying += dt;
      if (this.actor) this.actor.update(dt);
      if (this.saber && this.actor?.ragdolled) {
        const hand = this.actor.bodies.get('handR') || this.actor.bodies.get('foreR');
        if (hand) this.saber.setHiltPose(hand.position, hand.quaternion);
        this.saber.update(dt, ctx.time, this.velocity);
      }
      return this.dying < 40;
    }

    this.stateTime += dt;
    // A living body that is limp and still puts itself back together. See
    // `_tickGetUp`; before this, nothing in the game ever un-ragdolled.
    this._tickGetUp(dt);
    // …and a living body draws something. See `_auditVisible`.
    this._auditVisible(dt);
    this.stunTimer = Math.max(0, this.stunTimer - dt);
    this.knockTimer = Math.max(0, this.knockTimer - dt);
    this.yankT = Math.max(0, this.yankT - dt);
    /* A guard is won back by COMPOSING yourself, so the clock does not run while
     * the body is stunned, staggered, toppled, gripped or locked. That is what
     * makes pressure worth keeping up: a player who backs off to heal is handing
     * the duellist its guard back, and one who stays on it is not. */
    if (this.guard < this.guardMax && !this._guardOpen()) {
      this.guardT -= dt;
      if (this.guardT <= 0) { this.guard++; this.guardT = GUARD_REFRESH; }
    }
    if (this.compelled) {
      this.compelled.t -= dt;
      // It ends when the clock runs out, when the victim dies (there is nothing
      // left to be turned against), or when the compelled unit dies itself.
      if (this.compelled.t <= 0 || this.compelled.target?.dead || this.dead) this.compelled = null;
    }
    if (this.actor) this.actor.update(dt);

    // level of detail: distant enemies skip the expensive solves
    const camDist = ctx.camera.position.distanceTo(this.position);
    const lod = camDist > L3_AT ? 3 : camDist > 62 ? 2 : camDist > 30 ? 1 : 0;
    if (lod !== this.lod) { this.lod = lod; this._applyLod(lod); }
    /* …and the merged skin and the cohort are asked EVERY frame, because the
     * things they answer to do not move on a LOD edge and `_applyLod` is
     * edge-triggered. A cohort member's steady state is one matrix write.
     *
     * A DEFERRED BAKE needs a retry: MergedSkin.js caps the bake at one body a
     * frame because forty at once is 116 ms, so a body refused the budget on
     * its one edge would wait for an edge that never comes. Measured before
     * this line existed — 42 bodies deployed past 62 m, stepped 300 frames,
     * exactly ONE of them ever merged.
     *
     * And a body CUT or RAGDOLLED while it is merged has to give the skin back
     * on the frame it happens: the bake is a photograph of a rig with all its
     * bones, so until it is dropped the body walks around still wearing the arm
     * the player just took off it, for as long as it stays in this band. */
    else if (this._l2 || this._l2Wait || this._l3 || this._l3Wait) applyBodyLod(this, lod);
    /**
     * …and cloth gets its own cut, from the quality tier.
     *
     * It used to ride on `lod > 1`, which is 62 m — above the 60 m the farthest
     * level ever spawns anything at, so in an ordinary fight the most expensive
     * thing a character owns was never switched off by anything. See the note
     * over QUALITY.cloth in Engine.js for what it costs.
     */
    this.clothOn = camDist < (this.world.clothCut ?? 30);

    if (this.netDriven) {
      // a client's copy: the host owns where this thing is, we own how it looks
      if (this.netTarget) {
        _v1.subVectors(this.netTarget, this.position);
        this.velocity.copy(_v1).multiplyScalar(dt > 0 ? Math.min(1 / dt, 18) : 0);
        dampVec(this.position, this.netTarget, 14, dt);
      }
      let d = (this.netFacing ?? this.facing) - this.facing;
      while (d > Math.PI) d -= TAU;
      while (d < -Math.PI) d += TAU;
      this.facing += d * Math.min(1, dt * 10);
      this.target = ctx.pickTarget(this);
      if (this.target) this.toTarget = _v2.subVectors(this.target.position, this.position).setY(0).normalize().clone();
      this._applyNetDuel();
      this._syncBody();
      this._pose(dt, ctx);
      return true;
    }

    /**
     * SOMETHING IS ROLLING TOWARD HIM — and it comes before the brain, because
     * a man diving away from a grenade is not also holding a formation.
     *
     * `senseDanger` is one distance test against the nearest live grenade and
     * nothing at all when the field is empty, which is every frame of every
     * fight that does not have one in it. `stepReaction` owns the body while it
     * returns true: the brain is skipped, the steering is skipped (see
     * `CommandDirector.steer`, which defers to `reaction` at its own top), and
     * `_move` and `_pose` still run so the body travels and animates.
     *
     * See src/game/Reactions.js for the four answers and who gives which.
     */
    /**
     * `speed` IS A WISH FOR ONE FRAME HERE, AND IT HAS TO BE PUT BACK.
     *
     * `this.speed` is not a per-frame field: the constructor rolls it once
     * (archetype speed × a 0.9–1.1 shake × the difficulty's aggression) and
     * nothing writes it again for the body's whole life except an elite
     * changing phase. Everything that wants to move at a different pace for a
     * moment writes it, uses it and hands it back — `Command.installCommand`
     * wraps `_move` to do exactly that, with the note "leaving it on the body
     * would compound … a promotion would silently become a permanent sprint".
     *
     * `stepReaction` is OUTSIDE that wrapper's window, because it runs before
     * `_move` and the wrapper captures its `was` on the way in. So a reaction's
     * pace was captured as the body's own and restored on top of itself:
     * `stepDrag` writes `A.speed × 0.34` and `installCommand` faithfully put
     * `× 0.34` back. Measured on a trooper who pulled one casualty out — 4.465
     * m/s before, 1.394 after, and it never came back, so a man who went back
     * for a mate once walked at a third of a walk for the rest of the level.
     * The throw-back has the same shape in the other direction (×1.35, kept).
     *
     * The save is here rather than inside Reactions.js because the reaction is
     * not the only thing in the span that may want a pace for one frame, and a
     * restore that lives with the writer is a restore every future writer has
     * to remember. This one is the same idiom one level out.
     */
    /**
     * SOMEBODY IS DRIVING THIS ONE — and then the brain does not run at all.
     *
     * `Crew.update` has already set `wish`, `speed` and `facing` from the
     * player's controls by the time this frame reaches here, so all this has to
     * do is not overwrite them. `_move` and `_pose` still run below, which is
     * the whole design: a driven AT-TE walks on its own legs, takes its own
     * grade limit, loses them to a blade at three, and dies its own death. See
     * src/game/Driving.js.
     *
     * A grenade under a tank is not a thing the tank dives away from, so
     * `senseDanger` is skipped with the brain rather than beside it.
     */
    const paceWas = this.speed;
    if (this.driven) {
      this.stopFiring();
      this._move(dt, ctx);
      this._pose(dt, ctx);
      /* …AND THE DRIVER RIDES, here rather than in `Player.update`. Players are
       * step 1 of World's frame and enemies are step 2, so a seat written on
       * the player's own tick is a seat one frame behind the hull it is bolted
       * to — which at a Juggernaut's 7.2 m/s is 12 cm of the driver hanging off
       * the back at every speed change. */
      this.driven.ride();
      return true;
    }
    senseDanger(this, dt, ctx);
    const reacting = stepReaction(this, dt, ctx);
    if (!reacting) {
      this._think(dt, ctx);
    } else {
      /* A reaction drives `wish`, `speed` and `crouch` itself and must not be
       * overwritten by the brain's own idea of where to stand. Firing stops for
       * the same reason a man on his face is not shooting — through `holdFire`,
       * through `stopFiring`, which is the body's own and the same door the
       * HOLD FIRE order and the arrival walk-in reach through `Waves.holdFire`
       * — so a burst in flight is dropped rather than finished a second later
       * out of a body that is lying on its face. */
      this.stopFiring();
    }
    this._move(dt, ctx);
    /* ONLY WHEN A REACTION DROVE THE FRAME, and the narrowness is the point: a
     * kill landed inside `_think` can promote this body, and `promote` writes
     * `e.speed *= R.speed / prev.speed` on the spot. An unconditional restore
     * here would wipe a rank the man had just earned. A body that is diving,
     * dragging or carrying a live grenade is not shooting — `stopFiring` above
     * is that same sentence — so it cannot have made a kill in this span, and
     * `CommandDirector.steer` returns at its own top on `e.reaction`. Nothing
     * else in the span writes `speed`. */
    if (reacting) this.speed = paceWas;
    this._pose(dt, ctx);
    return true;
  }

  /**
   * THE BLADE, ON A MACHINE THAT DOES NOT RUN THE BRAIN.
   *
   * `DuelBrain.update` runs on the host alone, so a client's duellists held the
   * guard their constructor gave them and never swung — every acolyte in a
   * joining player's level stood in one pose for the session. `_poseSaber`
   * reads exactly four things off the duel: `guardDir`, `phase` (only for
   * `=== 'strike'`), `spin` and `attack.reach`. Those, plus how far through the
   * phase it is, are what `packDuel` sends and what this writes.
   *
   * IT POSES AND DOES NOT RESOLVE. `_saberStrike` refuses on a netDriven body
   * — a blade that both animates locally and bills damage locally would hit
   * twice, and the host already bills sabers over `hit`.
   */
  _applyNetDuel() {
    const d = this.duel, n = this.netDuel;
    if (!d) return;
    if (!n) { d.telegraph?.hide(); return; }
    const [ph, ak, k, gx, gy, gz, spin] = n;
    d.phase = DUEL_PHASES[ph] || 'guard';
    d.attackKey = ak >= 0 ? ATTACK_KEYS[ak] : null;
    d.attack = d.attackKey ? ATTACKS[d.attackKey] : null;
    d.guardDir.set(gx, gy, gz);
    if (d.guardDir.lengthSq() > 1e-8) d.guardDir.normalize();
    d.spin = spin || 0;
    /* The telegraph, which is the fairness contract of the melee game exactly
     * as the marksman's laser is of the ranged one. Drawn with the host's own
     * fill so it reads as a warning that FILLS rather than an arc that blinks. */
    if (d.phase === 'windup' && d.attack) d._drawTelegraph(k, 0.28 + k * 0.72, 1);
    else d.telegraph?.hide();
  }

  _think(dt, ctx) {
    const A = this.A;
    // A compelled unit's target REPLACES the world's pick. `_shoot`, the cover
    // logic and the melee brain all read `this.target`, so one substitution
    // here turns the whole unit rather than only its trigger finger.
    const target = this.target = this.compelled?.target ?? ctx.pickTarget(this);
    if (!target) { this.wish = null; return; }

    _v1.subVectors(target.position, this.position);
    const dist = _v1.length();
    _v1.y = 0;
    if (_v1.lengthSq() > 1e-6) _v1.normalize();
    this.toTarget = _v1.clone();

    if (this.gripped) {
      // held off the ground by something it cannot see. `cry` is gapped, so
      // holding one up for six seconds is one cry rather than 360.
      this.cry('scream', 2.5);
      // A body off its feet is not casting. This return is ABOVE `_meleeBrain`,
      // so the identical test inside `_forceBrain` was never reachable and a
      // grip froze a wind-up rather than breaking it — see `breakCast`.
      this.breakCast();
      this.wish = null;
      return;
    }
    /**
     * …AND A BODY LYING IN THE SAND IS NOT SHOOTING EITHER.
     *
     * `ragdolled` belongs on this line for the same reason it belongs in
     * `OPEN_STATES` (see Combat.js): limp is the third cause of the condition
     * the other two name, and it is the one the list kept missing. A dropped
     * grip leaves a body with `stunTimer` at zero and `toppled` false for the
     * whole of `GET_UP`, and this brain went on aiming and firing through it —
     * from `this.position`, which `_move`'s LIMP branch parks on the ragdoll's
     * centre, so the bolts came out of a chest lying face down.
     *
     * Latent before `knockFlat` and not after it: a shove now leaves bodies
     * limp for about three seconds against a 1.2 s stun, so the window this
     * closes went from a rounding error to most of it.
     */
    if (this.stunTimer > 0 || this.toppled || this.actor?.ragdolled) {
      this.wish = null;
      /* Nothing limp keeps a trigger held down. `stopFiring` is the body's own
       * door — the same one the reaction path above uses for "a man on his
       * face is not shooting". */
      if (this.actor?.ragdolled) this.stopFiring();
      // A beaten guard has to TRAVEL while the body is reeling. The brain is
      // otherwise frozen for the length of the stun, so the blade would sit
      // exactly where it was parried and only fly wide afterwards — the
      // reaction would play late, after the window it is advertising has half
      // gone. Only the stagger phase runs here; a stunned duellist still
      // cannot think, aim or attack.
      //
      // …EXCEPT INSIDE A FORCE STOP, and that is the one exception the clause
      // has. The whole promise of the field is that nothing moves; a blade
      // still travelling to the end of its stagger is a moving thing, and it
      // would also spend the reel DURING the hold, so a released body would
      // come out composed instead of out of line. Frozen, the stagger waits
      // its turn — which is what makes holding someone worth the Force.
      if (this.duel?.staggered && !this.toppled && !this.stasisHeld) this.duel.update(dt, ctx, dist);
      return;
    }
    if (A.inert) { this.wish = null; return; }
    if (A.custom === 'remote') { this._remoteBrain(dt, ctx, dist); return; }

    /**
     * THE FORM OWNS A DUELLIST'S FOOTWORK — WHICH NOTHING EVER READ.
     *
     * `FORMS[*].spacing` is authored five different ways — Makashi holds the
     * tip's range at [1.7, 2.9], Ataru works in and out across [1.4, 3.6],
     * Soresu sits back at [1.8, 3.0] — and the only reader in the tree was
     * `dist < F.spacing[1]` in DuelBrain, an "am I close enough to swing"
     * gate. `spacing[0]` had no reader at all. Every duellist stood in its
     * ARCHETYPE's `preferred` band instead, which is one band shared by every
     * acolyte regardless of form, so all five forms fought at one distance
     * and the tells that describe their distance — "economical, blade-tip
     * precise", "acrobatic", "waiting for you to swing first" — described
     * something the feet never did.
     *
     * Measured — mean stand-off over a 60 s fight, and the band it worked in:
     *
     *                  before                    after
     *     makashi   1.59 m  1.21–1.75      1.70 m  1.34–1.73    (authored 1.7)
     *     djemSo    1.62 m  1.43–2.05      1.61 m  1.40–2.05    (authored 1.5)
     *     ataru     1.62 m  1.43–2.05      1.72 m  1.00–3.79    (authored 1.4–3.6)
     *     soresu    1.61 m  1.41–2.05      1.79 m  1.61–1.93    (authored 1.8)
     *     juyo      1.59 m  1.21–2.05      1.54 m  1.11–2.05    (authored 1.4)
     *
     * Five forms, one distance, to within 3 cm of each other.
     *
     * Scaled by the body, so a big duellist keeps its reach.
     */
    const spacing = A.melee ? this.duel?.form?.spacing : null;
    const sc = A.scale ?? 1;

    /* `mobile` is authored on Ataru alone — the acrobatic form — and had no
     * reader anywhere in the tree either. It changes line about twice as
     * often, carries more lateral through the blend, and above all does not
     * HOLD a distance: it presses to the near edge of its band, flurries, and
     * breaks back out to the far edge. That is what "acrobatic flurries — it
     * will not stop at one" describes, and it is the only thing that spends
     * `spacing[1]` as footwork rather than as a range check. The wish is
     * normalised below, so the lateral term buys circling at the cost of
     * closing rather than buying speed. */
    const mob = this.duel?.form?.mobile ? 1.9 : 1;
    this.strafeTimer -= dt;
    if (this.strafeTimer <= 0) {
      this.strafeTimer = (1.1 + rng() * 2.2) / mob;
      this.strafeDir = rng() < 0.5 ? 1 : -1;
      this.pressIn = !this.pressIn;
    }

    const near = spacing ? spacing[0] * sc : A.preferred[0];
    const far = spacing ? spacing[1] * sc : A.preferred[1];
    /* How much of the wish points down the line to the target. A mobile form
     * alternates driving in and breaking off on the same timer that changes
     * its line; everything else holds a steady bias and lets the yield term
     * below do the rest.
     *
     * It does NOT break off through its own attack. Left free to, Ataru spent
     * half of every fight at the far edge of its band with a wind-up already
     * committed, and landed 0 of 8 strikes in six seconds on an unarmed,
     * motionless player at knife range. A form that backs away mid-swing is
     * not acrobatic, it is missing. */
    const committed = this.duel && (this.duel.phase === 'windup' || this.duel.phase === 'strike');
    const drive = A.melee ? (mob > 1 ? (this.pressIn || committed ? 1.15 : -0.6) : 0.35) : 0.08;
    const side = _v2.set(-this.toTarget.z, 0, this.toTarget.x)
      .multiplyScalar(this.strafeDir * (1 + (mob - 1) * 0.4));
    const wish = _v3.set(0, 0, 0);

    // Giving ground is a BAND, not a threshold. The old form was
    //     dist < near  ->  wish = -toTarget
    // which flipped the wish through 180 degrees on the single frame the player
    // crossed `near`, pointed it exactly back down the line they came in on, and
    // ran it at full forward speed. Three separate tells, and together they read
    // as the enemy being shoved rather than choosing to retreat.
    //
    // Now the circling wish and the yielding wish are blended over the inner
    // half of the preferred band, so the enemy eases out of holding its line;
    // and because the lateral term survives the blend, ground is given at an
    // angle the way a real fighter backs off, not straight away from the camera.
    const yieldAmt = smoothstep(near, near * 0.55, dist);
    if (dist > far) wish.copy(this.toTarget);
    else {
      wish.copy(side).addScaledVector(this.toTarget, drive);
      if (yieldAmt > 0) wish.addScaledVector(this.toTarget, -yieldAmt * 1.35);
    }

    // spread out — a horde that clumps looks like a bug
    for (const other of ctx.enemies) {
      if (other === this || other.dead) continue;
      _v4.subVectors(this.position, other.position);
      const d2 = _v4.lengthSq();
      const want = (this.radius + other.radius) * 2.4;
      if (d2 > want * want || d2 < 1e-6) continue;
      const d = Math.sqrt(d2);
      wish.addScaledVector(_v4.multiplyScalar(1 / d), (1 - d / want) * 1.5);
    }
    if (wish.lengthSq() > 1) wish.normalize();
    this.wish = wish.clone();

    /**
     * ── AND A BODY THAT HAS LOST ITS NERVE STOPS HOLDING THE LINE ──────────
     *
     * FLAGSHIP §7's first verb, and it is the only place in this file where the
     * ledger changes what a body DOES rather than how well it shoots:
     *
     *   "BREAK — walk into the front of a formation and it comes apart."
     *
     * TWO THRESHOLDS, BOTH `MORALE`'s, and they are the two `CommandDirector.
     * steer` already uses on the other side of the field: below `BREAK` a body
     * gives ground, and below `REFUSE` it has stopped answering altogether.
     * One rulebook for both armies, which is what makes a Sith leading the
     * Confederacy and a Jedi leading the Republic the same game.
     *
     * `!this.trooper` GATES IT, and that is not a duplicate of `nerveBroken`'s
     * own routing. A body with a record is steered by `CommandDirector.steer`
     * — which runs INSIDE `_move`, after this — and it has its own answer to
     * being broken: it goes to ground behind something and keeps shooting from
     * there. Letting this clause also fire would give one body two retreats,
     * and the one that lost would be whichever ran second.
     *
     * IT GIVES GROUND AT AN ANGLE, for the reason the yielding band twenty
     * lines above gives: a wish pointed exactly back down the line the player
     * came in on reads as a body being shoved rather than one choosing to
     * leave. The lateral term is the one it was already circling on, so a rank
     * that breaks peels rather than reversing.
     */
    if (!this.trooper && nerveBroken(this)) {
      _v3.copy(this.toTarget).multiplyScalar(-1).addScaledVector(side, 0.45);
      if (_v3.lengthSq() > 1e-6) _v3.normalize();
      this.wish = _v3.clone();
      /* A body that will not take an order will not take a shot either. Above
       * `REFUSE` it is still firing — badly, because `nerveAim` is reading the
       * same number — which is what a line falling back while shooting looks
       * like, and it is the difference between breaking a formation and
       * switching it off. */
      if (nerveRefusing(this)) return;
      if (A.melee) return;
      this._rangedBrain(dt, ctx, dist);
      return;
    }

    if (A.melee) this._meleeBrain(dt, ctx, dist);
    else this._rangedBrain(dt, ctx, dist);
  }

  _rangedBrain(dt, ctx, dist) {
    if (this.disarmed || this.blinded) return;
    const A = this.A;
    const diff = this.world.difficulty;

    /* A GRENADE IS A DIFFERENT DECISION FROM A RIFLE and it is taken first,
     * because the reason to throw one is that shooting is not working. See
     * `_maybeGrenade`. */
    if (A.grenades) this._maybeGrenade(dt, ctx, dist);

    /**
     * ── THE GENERATOR CYCLES BACK UP, AND IT COULD NOT ────────────────────
     *
     * `dropShield`'s own comment states the rule this block is supposed to
     * carry: "A droideka's own generator cycles back up; an elite's bubble does
     * not." It sets `deployTimer = 4.5` to say how long that takes — and it
     * also sets `shieldHp = 0`, which this line then tested. `shieldHp > 0` is
     * false for ever after a drop, so the branch was unreachable from the only
     * state that leads to it, the 4.5 was a tuning constant nothing consumed,
     * and a droideka that lost its bubble once was a 170 hp body for the rest
     * of its life.
     *
     * Measured before the fix — one droideka, shield dropped at t=2 s, 30 s of
     * world: `deployTimer` counted 4.5 → 0 by t=8 s and then sat at 0 for
     * twenty-two seconds with `shieldUp` false and `shieldHp` 0. The timer ran,
     * expired, and nothing was waiting on it.
     *
     * `shieldMax` is the right question — "does this chassis have a generator"
     * — and it is written once, by `_build`, and never zeroed. The 4.5 s is
     * what makes the droideka a body you have to keep pressure on rather than
     * one you chip once: break the bubble and you have four and a half seconds
     * before it is back, which is the counter-play the archetype was authored
     * around and is also why a blade (which the bubble does not stop —
     * `damage` only spends it on `kind !== 'melee'`) is the answer to one.
     *
     * THE ELITE'S BUBBLE IS STILL A ONE-SHOT, and now by construction rather
     * than by the `Infinity` in `dropShield`: `MODIFIERS.shielded.allow`
     * refuses any archetype that already declares `A.shield`, so a promoted
     * body never enters this block at all. The `Infinity` stays as the belt to
     * that brace.
     */
    if (A.shield) {
      this.deployTimer = Math.max(0, this.deployTimer - dt);
      const wantShield = dist < 22 && this.deployTimer <= 0 && this.shieldMax > 0;
      if (wantShield && !this.shieldUp && this.stateTime > 1.2) {
        this.shieldUp = true;
        if (this.built?.shield) this.built.shield.visible = true;
        this.shieldHp = this.shieldMax;
        audio.tone({ freq: 220, freqEnd: 700, dur: 0.5, gain: 0.16, type: 'sine', pos: this.position });
      }
    }

    /**
     * ── A SIEGE GUN HAS TO STOP TO SHOOT, AND STAYING STOPPED IS THE WHOLE
     *    OF WHAT MAKES IT A DIFFERENT ENEMY ───────────────────────────────
     *
     * The reference for the SPHA is unusually specific about this and it is the
     * only interesting thing about how the machine moves: it "only used its
     * twelve legs when maneuvering between firing positions; when attacking an
     * enemy target, a SPHA-T remained motionless to give its gunners added
     * precision". So the artillery does not walk and shoot. It walks, it stops,
     * it settles, it charges, it fires, and only then does it walk again.
     *
     * Three states out of two fields, and every one of them is something the
     * player can see from across the field:
     *
     *   `plant`  seconds of stillness the machine must bank before it is
     *            allowed to begin its telegraph. Wander inside that window and
     *            the tally resets — which is what makes shoving one, gripping
     *            one or simply making it re-path a real defensive act rather
     *            than a scratch on a health bar.
     *   `planted` 0 → 1, smoothed, read by `_poseWalker` (it squats onto its
     *            legs) and by nothing else. It is the tell.
     *
     * AND IT HOLDS STATION THROUGH THE SHOT. `wish = null` while the charge is
     * running or the shell is in the queue: the brain above has already decided
     * where it would like to be and this overrides it, because a two-and-a-half
     * second wind-up that the machine strolls through is a wind-up that does
     * not mean anything. It is the same statement `BEAST_MOVES`' `plant` makes
     * to an animal mid-lunge, made to a gun instead.
     *
     * The counter-play this buys is stated once, here, because it is the
     * answer to a body a player otherwise cannot reach: a planted SPHA is a
     * stationary target with a fixed elevation and twelve legs at ground level,
     * and the charge is a two-and-a-half-second window in which the largest
     * machine on the field does not move at all.
     */
    if (A.plant) {
      /* IN BAND AND IN SIGHT IS THE WHOLE CONDITION, and it is what makes the
       * duty cycle measurable rather than rhetorical: a siege gun that can see
       * its target stops, and one that cannot walks. Circling was the first
       * version and it does not work — the brain above hands every ranged body
       * a lateral wish inside its own band, so a machine that must be still to
       * shoot would have strolled sideways at its full pace resetting its own
       * plant tally forever, and fired nothing. Measured that way: 0 shells in
       * sixty seconds against a stationary target 60 m away.
       *
       * `_hasLineOfSight` in the condition is the other half and it is the
       * reposition the reference describes. Break the line — a spire, a
       * revetment, the far side of a ridge — and the machine gets up, walks,
       * and has to bank its stillness again from zero at the other end. */
      const settle = this.aimCharge > 0 || this.burstLeft > 0
        || (dist < A.preferred[1] && this._hasLineOfSight(ctx));
      if (settle) this.wish = null;
      const moving = Math.hypot(this.velocity.x, this.velocity.z) > this.speed * 0.2;
      this.plantTimer = moving ? 0 : (this.plantTimer || 0) + dt;
      this.planted = damp(this.planted ?? 0, settle && this.plantTimer >= A.plant * 0.5 ? 1 : 0, 3.2, dt);
    }

    this.attackTimer -= dt;
    // A rallied shooter reloads faster; the leader's ring is what tells you so.
    const rally = this.rallyTimer > 0 ? RALLY.rate : 1;
    if (this.burstLeft > 0) {
      this.burstTimer -= dt;
      if (this.burstTimer <= 0) {
        this._shoot(ctx);
        this.burstLeft--;
        this.burstTimer = (A.burstGap ?? 0.12) * rally;
        // The committed ray outlives the burst it was drawn for and nothing
        // else: once the shot is away the next one aims fresh.
        if (this.burstLeft <= 0) this.telegraphAim = null;
      }
      return;
    }
    /* …and the plant is a condition on OPENING fire, not on continuing it: a
     * machine that has already begun its charge finishes it, because the
     * clause above has stopped it moving and rescinding permission mid-charge
     * would leave the gun cycling silently forever. */
    if (A.plant && this.aimCharge <= 0 && (this.plantTimer || 0) < A.plant) return;
    if (this.attackTimer <= 0 && dist < (A.preferred[1] + 12) && this._hasLineOfSight(ctx)) {
      if (A.telegraph) {
        if (this.aimCharge <= 0) {
          this.aimCharge = A.telegraph;
          this._beginTelegraph(ctx);
        }
        this.aimCharge -= dt;
        if (this.aimCharge <= 0) {
          this._endTelegraph();
          this.burstLeft = A.burst ?? 1;
          this.burstTimer = 0;
          this.attackTimer = rally * A.fireRate * (0.75 + rng() * 0.5) / (diff ? diff.enemyAggression * (diff.fireRate ?? 1) : 1);
        }
      } else {
        this.burstLeft = A.burst ?? 1;
        this.burstTimer = 0;
        this.attackTimer = rally * A.fireRate * (0.7 + rng() * 0.6) / (diff ? diff.enemyAggression * (diff.fireRate ?? 1) : 1);
      }
    }
  }

  /**
   * THROW ONE — and the archetype field that says a body can was DELETED from
   * this file once for being read by nothing.
   *
   * `trooper` carried `grenades: true` for the whole of its life with no reader
   * anywhere in src/, and the note that removed it said, in as many words: "A
   * trooper grenade is a real thing to build — `Stratagems.blast` is the
   * primitive and `dodgeable.mjs` is the bar it would have to clear — and it is
   * a feature, not a field." This is the feature. The field is back, and this
   * method is what reads it.
   *
   * ── WHEN A SOLDIER REACHES FOR ONE, and none of these is a die roll ──────
   *
   *   THE TARGET IS IN COVER OR HULLED DOWN — a rifle is not answering, which
   *     is the whole reason grenades exist. Expressed as line of sight: no
   *     sight, no bullets, so try the thing that goes over.
   *   THEY ARE CLUMPED — two or more inside a blast is what makes it worth a
   *     grenade rather than a magazine, and it is the same test a player makes
   *     by eye.
   *   AND NOT TOO CLOSE. `GRENADE.radius` plus a margin, because a body that
   *     lobs one at its own feet is a comedy and this roster has enough of
   *     those. Under that range it fights with what it is holding.
   *
   * The aim is deliberately imperfect and the error is the thrower's own
   * quality: a clone veteran lands one at the feet of the man he wants and a B1
   * puts it four metres wide, which is what makes the reaction system have
   * anything to do. `world.grenades` owns the object from here on.
   */
  _maybeGrenade(dt, ctx, dist) {
    this.grenadeCd = Math.max(0, (this.grenadeCd ?? GRENADE_CD.first) - dt);
    if (this.grenadeCd > 0 || this.dead || this.reaction) return;
    const field = this.world?.grenades;
    const t = this.target;
    if (!field || !t || !t.alive && t.dead) return;
    if (dist < GRENADE.radius + 3 || dist > GRENADE_THROW) return;
    /* WORTH IT? Either they are behind something, or there are several of them
     * standing together — and the CHEAP ONE IS ASKED FIRST.
     *
     * `_hasLineOfSight` is a physics raycast, a terrain raycast and a smoke
     * integral; the clump test is a squared distance per body. Asking for
     * sight first meant every grenadier bought the expensive answer even in
     * the case that does not need it, which is the case a fight is mostly
     * made of. */
    let clumped = 0;
    const r2 = (GRENADE.radius * 0.8) ** 2;
    for (const o of (ctx.enemies || [])) {
      if (o.dead || o.team === this.team) continue;
      if (o.position.distanceToSquared(t.position) <= r2) clumped++;
    }
    const p = this.world?.player;
    if (p && p.alive && p.team !== this.team
        && p.position.distanceToSquared(t.position) <= r2) clumped++;
    if (clumped < 2 && this._hasLineOfSight(ctx)) {
      /**
       * HE LOOKED, AND THE ANSWER WAS NO — AND THAT HAS TO COST HIM THE LOOK.
       *
       * `grenadeCd` at 0 is "ready", not "asked", so a body whose target is
       * alone and in the open re-took this entire decision — the enemy scan
       * AND the two raycasts — on EVERY FRAME, for as long as it stood in the
       * 9.5-26 m band. Measured on twelve troopers ringing a lone target:
       * 0.930 sight raycasts per body per frame against 0.006 with the
       * cooldown held, a 167x multiplier on the one query in this class that
       * costs real work. The rifle's own sight test at `attackTimer <= 0` is
       * where that 0.006 comes from; it asks about once a fire cycle, which is
       * what a body deciding something ought to cost.
       *
       * `GRENADE_LOOK` is the interval between looks. It is short enough that a
       * squad bunching up in front of him is answered inside a quarter of a
       * second — far quicker than the 2.6 s a grenade takes to matter — and it
       * is the same answer `CommandDirector.steer` gives for the same shape:
       * "a refused attempt still costs him the look, or every frame is a scan
       * of the whole field".
       */
      this.grenadeCd = GRENADE_LOOK;
      return;
    }

    /* THE THROW. Aimed at where they are, not where they will be — a soldier
     * leading a target with a grenade is a soldier with a computer — and
     * scattered by his own quality. */
    const err = GRENADE_SPREAD * (this.rallyTimer > 0 ? 0.7 : 1) / Math.max(0.5, (this.A.threat ?? 2) * 0.5);
    const to = _v1.copy(t.position);
    to.x += (rng() - 0.5) * err;
    to.z += (rng() - 0.5) * err;
    if (ctx.terrain) to.y = ctx.terrain.height(to.x, to.z);
    const from = _v2.copy(this.position);
    from.y += (this.A.hipHeight ?? 0.95) + 0.4;
    field.throw(from, to, { owner: this, team: this.team });
    this.grenadeCd = GRENADE_CD.every * (0.7 + rng() * 0.6);
    this.attackTimer = Math.max(this.attackTimer, 0.6);   // he is not also firing
    this.world?.notifyFloating?.(this.position, 'GRENADE', 0xffb347);
  }

  _remoteBrain(dt, ctx, dist) {
    // circle the student at a polite distance and fire slowly
    this.orbitPhase += dt * 0.55;
    const side = _v2.set(-this.toTarget.z, 0, this.toTarget.x);
    const want = _v3.copy(side).multiplyScalar(Math.sin(this.orbitPhase) > 0 ? 1 : -1);
    if (dist > this.A.preferred[1]) want.add(this.toTarget);
    else if (dist < this.A.preferred[0]) want.sub(this.toTarget);
    this.wish = want.normalize().clone();

    this.attackTimer -= dt;
    if (this.attackTimer <= 0) {
      this.attackTimer = (this.trainingFireRate ?? this.A.fireRate) * (0.8 + rng() * 0.4);
      this._shoot(ctx);
    }
  }

  /**
   * THE RED LINE MEANS WHAT IT SAYS, AND IT DID NOT.
   *
   * `sniper` (1.0 s), `rocket` (0.9 s), the AT-TE (1.1 s) and the `marksman`
   * elite (0.9 s) draw a line from the muzzle to the player's chest and hold it
   * there for most of a second. The modifier's own text calls that the whole of
   * the counter-play — "a red targeting line on your chest, and most of a
   * second to leave it" — and leaving it was the one thing that did nothing:
   * `_pose` re-pointed the line at `target.chest` EVERY FRAME and `_shoot`
   * computed its aim from `target.chest` at the moment of firing, so the line
   * followed you and the shot was aimed when it left rather than when the
   * warning went up. The player who did exactly what the tell told them to do
   * was hit anyway, which teaches them the telegraph is a lie.
   *
   * The point is committed HERE, at the top of the telegraph, and both the line
   * and the bolt read it. Step off it and the shot goes where you were.
   */
  _beginTelegraph(ctx) {
    const t = this.target;
    if (t) {
      this.telegraphAim = aimAt(t, this.telegraphAim || new THREE.Vector3());
    }
    if (!this.laser) {
      const g = new THREE.CylinderGeometry(0.006, 0.006, 1, 4);
      g.translate(0, 0.5, 0);
      g.rotateX(Math.PI / 2);
      this.laser = new THREE.Mesh(g, new THREE.MeshBasicMaterial({
        color: 0xff3020, transparent: true, opacity: 0.6, toneMapped: false, blending: THREE.AdditiveBlending, depthWrite: false }));
      this.world.scene.add(this.laser);
    }
    this.laser.visible = true;
    audio.tone({ freq: 1400, freqEnd: 2200, dur: 0.9, gain: 0.07, type: 'sine', pos: this.position });
  }
  _endTelegraph() { if (this.laser) this.laser.visible = false; }

  _hasLineOfSight(ctx) {
    if (!this.target) return false;
    const from = this._muzzleWorld(_v5);
    const at = aimAt(this.target, _aim);
    _v6.subVectors(at, from);
    const d = _v6.length();
    _v6.multiplyScalar(1 / d);
    const hit = ctx.physics.raycast(from, _v6, d - 0.6, (b) => b.static || b.layer === LAYER.PROP);
    if (hit) return false;
    if (ctx.terrain) {
      const t = ctx.terrain.raycast(from, _v6, d - 0.6, _v1, _v2);
      if (t !== null) return false;
    }
    /**
     * …AND SMOKE, which is the half of the smoke screen that was missing.
     *
     * `Stratagems.smoke`'s card says "Nothing on either side can shoot what it
     * cannot see", and until now the cloud only degraded the BOLT — a shooter
     * standing in front of a wall of smoke still picked its target, still
     * aimed and still fired, and the screen was a damage filter rather than a
     * screen. This is the one place in the game that asks "can I see it", so
     * it is the one place that has to know.
     *
     * NOT A HARD WALL, and the same integral the bolt reads (`seeThrough` in
     * src/game/Smoke.js — one model, so a shooter's answer and a bolt's answer
     * cannot disagree). Transmittance is 1 in clear air and falls off with the
     * depth of cloud on the line, and a body loses sight when less than
     * `SMOKE_SEE` of the line survives. A threshold rather than a chance,
     * because a shooter that flickered between seeing and not seeing at the
     * edge of a bank would be an enemy the player cannot read.
     *
     * SYMMETRIC BY CONSTRUCTION, like everything else in that file: this runs
     * on every body with a weapon, and the allies in Command mode are Enemy
     * instances too. Your own line cannot shoot through your own smoke either,
     * which is what makes laying one a decision.
     */
    if (seeThrough(from, at) < SMOKE_SEE) return false;
    return true;
  }

  _muzzleWorld(out) {
    if (this.built?.muzzles?.length) {
      // a remote fires from whichever emitter is facing the student
      const m = this.built.muzzles[(this._armToggle = ((this._armToggle || 0) + 1) % this.built.muzzles.length)];
      return m.getWorldPosition(out);
    }
    if (this.weapon && this.weapon.userData.muzzle) {
      return out.copy(this.weapon.userData.muzzle).applyMatrix4(this.weapon.matrixWorld);
    }
    if (this.built?.arms?.length) {
      const a = this.built.arms[(this._armToggle = 1 - (this._armToggle || 0))];
      return a.muzzle.getWorldPosition(out);
    }
    if (this.built?.cannons?.length) {
      const c = this.built.cannons[(this._armToggle = 1 - (this._armToggle || 0))];
      return c.muzzle.getWorldPosition(out);
    }
    if (this.rig) {
      const f = this.rig.get('foreR');
      if (f) return this.rig.tipPos('foreR', out);
    }
    return out.copy(this.position).setY(this.chestY);
  }

  _shoot(ctx) {
    const A = this.A;
    const target = this.target;
    if (!target) return;
    const from = this._muzzleWorld(_v1).clone();
    // Down the committed ray if one was drawn — see `_beginTelegraph`. A shot
    // the player was given a second to leave has to leave from where the line
    // was, not from where they ended up.
    const aimed = !!this.telegraphAim;
    const at = aimed ? _v2.copy(this.telegraphAim) : aimAt(target, _v2);
    /* SHOOTING ITSELF is aimed at the chest like everything else, but the
     * muzzle is already past it — a rifle held at the shoulder has its barrel
     * end a good half metre in FRONT of the ribs — so `at - from` points
     * backwards and the shot goes over the droid's shoulder into the sky. The
     * bolt has to start behind the chest and travel through it. Dropping the
     * muzzle to the hip and aiming up under the chin is the pose a unit turning
     * its own weapon on itself actually takes, and it is the only special case
     * compulsion needs anywhere in this file. */
    if (target === this) {
      from.set(this.position.x, this.position.y + 0.55 * (A.scale ?? 1), this.position.z)
        .addScaledVector(_v5.set(Math.sin(this.facing), 0, Math.cos(this.facing)), 0.26 * (A.scale ?? 1));
      at.set(this.position.x, this.position.y + 1.35 * (A.scale ?? 1), this.position.z);
    }

    const diff = this.world.difficulty;
    const acc = diff ? diff.enemyAccuracy : 0.7;
    // lead the shot, then throw it off by however good this difficulty is
    const speed = 88 * (diff ? diff.boltSpeed : 1) * (A.big ? 1.2 : 1);
    const tof = from.distanceTo(at) / speed;
    /* …and a committed shot does not lead. Leading a fixed point by the
     * target's CURRENT velocity would put the bolt back on the player and off
     * the line that was drawn, which is the same defect one layer down. */
    if (target.velocity && !aimed) at.addScaledVector(target.velocity, tof * acc);

    _v3.subVectors(at, from).normalize();
    /* AIM IS A SKILL AND A CIRCUMSTANCE, not a difficulty slider. See
     * `aimQuality` — the whole of note #20 goes through this one multiply. */
    /**
     * …AND HALF-BLIND IS NOT THE SAME AS BLIND.
     *
     * The player: "the smoke screen needs to be way bigger and more useful, it
     * should effect your allies and your enemies ability to aim obviously if it
     * does not right now." It did not. `_canSee` gates ACQUISITION at
     * `SMOKE_SEE` — below that transmittance you cannot pick a target at all —
     * and the bolt loses damage on the way through. Between those two there was
     * nothing: a shooter looking through a thinning bank, or clipping the edge
     * of one, aimed exactly as well as one in clear air right up to the moment
     * it could not see at all.
     *
     * So the same integral both of those already read now widens the CONE. A
     * shooter with half the light getting through shoots at twice the spread;
     * one at the acquisition threshold shoots at four times it and is spraying.
     * `seeThrough` is transmittance, so `1/see` is the natural scale and the
     * clamp is what stops a body at the very edge of the gate from firing into
     * the next postcode.
     *
     * SYMMETRIC, like everything else about the cloud: this runs on every body
     * with a weapon, and in Command your own line are Enemy instances too.
     */
    const see = seeThrough(from, at);
    const murk = clamp(1 / Math.max(see, 0.02), 1, 4.5);
    const spread = (A.spread ?? 0.06) * (2 - acc) * this.aimQuality(from.distanceTo(at)) * murk;
    _v3.x += (rng() - 0.5) * spread; _v3.y += (rng() - 0.5) * spread * 0.7; _v3.z += (rng() - 0.5) * spread;
    _v3.normalize();

    ctx.bolts.fire(from, _v3, {
      speed: this.trainingBoltSpeed ?? speed,
      damage: this.attackDamage * (this.rallyTimer > 0 ? RALLY.damage : 1),
      color: A.boltColor ?? BOLT_COLORS.red,
      owner: this, team: this.team, big: !!A.big,
      length: A.big ? 2.4 : 1.15, radius: A.big ? 0.1 : 0.05,
      /* The flag the hit test needs. A bolt is normally sorted by TEAM, and a
       * compelled droid is still on the droids' team — it has not changed
       * sides, it has been made to point the wrong way — so without this its
       * shots pass harmlessly through the ally it is aiming at and the whole
       * ability is a droid doing an impression. `turned` is read beside
       * `deflected` in World._boltHitTest, which is the existing seam for "a
       * bolt that may hurt the side that fired it". */
      turned: !!this.compelled,
    });
    audio.blaster(from, !!A.big);
    this.world.particles?.plasma.spawn(from, _v4.set(0, 0, 0), {
      life: 0.07, size: A.big ? 0.9 : 0.42, drag: 1, gravity: 0, color: A.boltColor ?? 0xff3020, alpha: 1 });
    this.muzzleFlash = 0.06;
  }

  _meleeBrain(dt, ctx, dist) {
    if (!this.saber) { this._beastBrain(dt, ctx, dist); return; }
    if (this.lock) {
      /**
       * A BLADE LOCK PINS THE FEET AND THE BLADE. IT DOES NOT SWITCH OFF THE
       * FORCE — AND IT USED TO.
       *
       * This was one line — `this.wish = null; return;` — placed above the call
       * to `_forceBrain`, so the whole kit was disabled for the duration of
       * every bind. Measured share of a 25 s duel spent locked: Sentinel 41%,
       * Master 29%. Which means the archetypes that survive long enough to USE
       * a kit were exactly the ones whose kit was off for a third to a half of
       * the fight, and it was off during the one moment a shove means the most:
       * two blades crossed, nose to nose, nothing else either of you can do.
       * Every film this game is made of answers that moment with a hand.
       *
       * The feet stay pinned — the lock owns those — and `_castPower` resolves
       * the bind when the shove lands.
       */
      this.wish = null;
      if (this.powers) this._forceBrain(dt, ctx, dist);
      return;
    }
    /* WINDED, for the two duellist bosses — see `_windTick` and WIND_TAKE. The
     * tally was being written for them and read for nobody, so a boss with
     * twelve turned passes had no window in which the thirteenth would land.
     * The blade is out of line for the duration (the stagger the tick opens),
     * so this only keeps the FEET and the kit still. */
    if (this._windTick(dt)) {
      this.wish = null;
      if (this.duel.staggered) this.duel.update(dt, ctx, dist);
      return;
    }
    if (this.trainingSpeed) this.duel.timeScale = this.trainingSpeed;
    // The leader's aura reaches the duel brain as tempo, which is what the form
    // actually spends: shorter guards, shorter recoveries, the same attacks.
    if (this.rallyTimer > 0) {
      this._duelBase = this._duelBase ?? this.duel.timeScale;
      this.duel.timeScale = this._duelBase / RALLY.rate;
    } else if (this._duelBase !== undefined) {
      this.duel.timeScale = this._duelBase;
      this._duelBase = undefined;
    }
    this.duel.update(dt, ctx, dist);
    // a lunging attack actually carries the duellist forward
    if (this.duel.lungeSpeed > 0.01 && this.toTarget) {
      this.velocity.addScaledVector(this.toTarget, this.duel.lungeSpeed * dt * 9);
    }
    if (this.powers) this._forceBrain(dt, ctx, dist);
    if (this.offSaber && !this.offDisarmed) this._offhandStrike(dt, ctx);
  }

  /**
   * WHEN A DUELLIST REACHES FOR THE FORCE — see ENEMY_POWERS for what and why.
   *
   * Three gates, in this order, and each is here to stop a different kind of
   * bad fight:
   *
   *   AFFORDABILITY  the pool, off the same POWER_COST table the player pays.
   *                  This is the balance: a knight can pay for two pulls, and
   *                  a duellist that opens with everything is a fencer for the
   *                  next eight seconds.
   *   SITUATION      `want`. A push fired at nothing is not a threat, it is
   *                  noise, and it teaches the player that the tell means
   *                  nothing. `pressed` means a blade is inside the band it
   *                  wants to fight at — and it used to mean that AND "it is
   *                  losing on health", which made the whole feature invisible;
   *                  see the note on the object itself. `fleeing` means the
   *                  target is opening the distance; `ranged` means they have
   *                  already opened it; `cornered` is the boss's last third.
   *   TELEGRAPH      `_castTimer`. The cast is a 0.45 s wind-up with a floating
   *                  call over the body, because everything else this game does
   *                  to the player is readable and a power that arrives with no
   *                  frame of warning is the 11.5 m sphere the beasts check has
   *                  a note about.
   *
   * It never casts through its own strike — `phase === 'strike'` — so a power
   * cannot arrive on the same frame as a blade and make an exchange
   * unanswerable.
   *
   * ── AND NOTHING HERE TOUCHES THE FEET. That is the one regression this
   * feature caused and both wrong answers are worth recording.
   *
   * The first version set `this.wish = null` through a cast — 0.45 s of wind-up
   * plus up to 2.4 s of held choke on a 9 s cooldown, so a third of the fight
   * was spent standing still. `tools/checks/footwork.mjs` failed immediately
   * and it failed on the thing the player actually reported (note #7, "the
   * enemies are unreachable, the wave won't progress"): a duellist that stops
   * to cast at somebody walking backwards never closes, and walking backwards
   * went back to being a shutout — 10.50 hp/s standing still against 0.20
   * walking away.
   *
   * The second version scaled the wish to 0.55 instead of nulling it, which
   * fixed that and broke a different check for a better reason: `wish` is a
   * DIRECTION, not a speed. `footwork: the band a duellist holds is inside the
   * band it swings from` finds the band edge by sweeping in and watching for
   * `wish.dot(toTarget) > 0.999`, so a wish scaled to 0.55 reads as a body that
   * has stopped driving straight in at 6 m — outside its own trigger, which is
   * the copied-spacing defect that check exists for.
   *
   * So a cast costs no ground at all. Its commitment is already three things:
   * the price out of a pool that does not refill fast enough, the cooldown, and
   * a 0.45 s telegraph with a call over the body. The player casts while moving
   * too.
   */
  _forceBrain(dt, ctx, dist) {
    const t = this.target;
    this.force = Math.min(this.forceMax, this.force + forceRegenFor(this.forceMax) * dt);
    for (const k in this.powerCd) this.powerCd[k] = Math.max(0, this.powerCd[k] - dt);

    // a power already running — pay for it by the second, or it stops
    if (this.casting) { this._sustain(dt, ctx, dist); return; }

    if (this._castTimer > 0) {
      this._castTimer -= dt;
      if (this._castTimer <= 0) this._castPower(this._castKey, ctx, dist);
      return;
    }
    if (!t || !t.alive || this.duel.phase === 'strike' || this.duel.staggered) return;
    if (this.stunTimer > 0 || this.gripped) return;

    const closing = this.toTarget && t.velocity
      ? t.velocity.x * this.toTarget.x + t.velocity.z * this.toTarget.z : 0;
    const hpFrac = this.hp / this.maxHp;
    const situation = {
      /**
       * A BLADE INSIDE THE BAND IT WANTS TO FIGHT AT. That used to read
       * `&& hpFrac < 0.72`, and that clause is why the whole feature was
       * invisible: a duellist at full health could never OPEN with a shove, and
       * `pressed` is the ONLY one of these four that a stand-up fight ever
       * satisfies. Driven 25 s each, 1v1, against a real player with a sweeping
       * blade, every archetype on the roster cast nothing at all and every pool
       * finished on its maximum — acolyte 62/62, knight 44/44, sentinel 40/40,
       * guardian 48/48, master 150/150. A Sentinel, whose entire kit is this
       * one verb, cast zero powers across 75 s and three behaviours.
       *
       * So the shove goes back to being what its own header calls it, "get off
       * me", and the thing that stops it being a tic is what was always meant
       * to: a 6.5 s cooldown and a pool that regenerates slower than it spends
       * (FORCE_REGEN 3.0/s against a 20 price). It is also the first beat of
       * the only two-beat this roster has — see `_castPower`, where the push is
       * sized to buy the distance that `ranged` (and therefore lightning, and
       * therefore the pull) needs to become reachable at all.
       */
      pressed: dist < this.A.preferred[1] + 0.8,
      // opening the distance: `closing` is positive when they move away from it
      fleeing: closing > 1.6 || dist > this.A.preferred[1] + 3.5,
      /**
       * OUTSIDE THE RANGE THIS BODY FIGHTS AT — and it used to be two metres
       * outside it, which is a place the fight never went.
       *
       * `+ 2.0` is 5.4 m on a Master. Measured stand-off in a real 1v1 duel:
       * ~1.6 m. And the shove that is supposed to CREATE the opening — the
       * first beat of the only two-beat this roster has — lands a braced player
       * at 3.86 m, still under the floor. So the situation was unreachable in
       * both of the ways it could be reached, and the consequence was measured
       * across five archetypes over 45 s each: 22 casts, 20 of them `push`, 2
       * `pull`, and ZERO lightning — the Sith acolyte's signature power, the
       * thing that is supposed to separate fighting him from fighting a Jedi.
       * A five-power roster that plays as one power.
       *
       * PAST THE MIDDLE OF THE BAND THIS BODY FIGHTS IN, and that is derived
       * rather than picked: the shove has to be able to reach it and the
       * resting stand-off must not. Measured, both halves — a duel sits at
       * ~1.6 m, and the peak separation in the 1.2 s after a push is 2.89 to
       * 3.49 m, because the caster is walking in behind its own shove while the
       * player is still travelling. `preferred` mid-points are 2.35 to 2.55, so
       * the gap the shove opens clears it and the fight standing still does
       * not. `lightning`'s own band floor comes down to meet it — see
       * ENEMY_POWERS.
       */
      ranged: dist > (this.A.preferred[0] + this.A.preferred[1]) * 0.5,
      /* Half health, not a third. `unleash` is the only one in the roster and
       * it fired zero times in the same measurement: a duel that reaches 34% of
       * a Master's 460 hp is a duel that is nearly over, so the one power the
       * boss has that nothing else does was authored into the last few seconds
       * of a fight most players end before it. Half is a beat you can lose to
       * and come back from. */
      cornered: hpFrac < 0.5 && dist < 6,
    };

    for (const key of this.powers) {
      const P = ENEMY_POWERS[key];
      if (!P || this.powerCd[key] > 0 || this.force < P.cost) continue;
      if (dist < P.band[0] || dist > P.band[1]) continue;
      if (!situation[P.want]) continue;
      if (!this._hasLineOfSight(ctx)) continue;
      /**
       * THE PRICE IS PAID WHEN THE BODY COMMITS, NOT WHEN THE BLOW ARRIVES.
       *
       * Both halves used to be charged inside `_castPower`, at the far end of
       * the 0.45 s wind-up, so a wind-up that never landed cost the caster
       * nothing at all: no pool, no cooldown, and it could be started again on
       * the very next frame. Once casts became breakable (see `breakCast`) that
       * would have made every telegraph a free bluff and every interrupt
       * worthless — the player would learn to ignore the tell, which is the
       * exact failure the telegraph exists to prevent.
       *
       * Charging here makes an interrupt worth reaching for and it makes the
       * pool move on the screen at the moment the player can see why.
       */
      this.force -= P.cost;
      this.powerCd[key] = P.cd;
      this._castKey = key;
      this._castTimer = CAST_WIND;
      this.world.notifyFloating?.(this.aimPoint(_v1), P.label, P.color);
      audio.tone({ freq: 180, freqEnd: 900, dur: 0.45, gain: 0.10, type: 'sine', pos: this.position });
      return;
    }
  }

  /**
   * BREAK A CAST — the thing nothing in the game could do.
   *
   * `_forceBrain` checks `_castTimer` before every situational test and returns,
   * and `_think` returns EARLIER still on `stunTimer > 0 || this.gripped` — so
   * being stunned or gripped mid-wind-up never reached the two interrupt clauses
   * inside `_forceBrain` at all. They were unreachable dead code, and what a
   * stun actually did was FREEZE the wind-up: the timer stopped, the body stood
   * there, and the cast arrived the moment it could think again. Driven against
   * a mid-wind-up Jedi Master with five different counters — a parry-strength
   * stun, a push, a grip, lightning and unleash — the cast arrived five times
   * out of five.
   *
   * The same freeze applied one layer down. `_sustain` already refuses to keep
   * a held power running while `stunTimer > 0 || this.gripped`, and `_think`
   * returned before it could: a choke survived a stagger with its full duration
   * intact and resumed afterwards.
   *
   * So there is one verb for it, it is called from the places that BEAT a guard
   * rather than from the brain that would like to keep casting, and the price
   * is already spent by the time it runs.
   *
   * @returns the key of whatever was broken, or null.
   */
  breakCast() {
    let broke = null;
    if (this._castTimer > 0) { broke = this._castKey; this._castTimer = 0; this._castKey = null; }
    if (this.casting) { broke = broke ?? this.casting; this._endSustain(); }
    return broke;
  }

  /** A held power stops. Separate from `breakCast` because a hold that simply
   *  runs out of seconds has arrears to settle and a broken one does not. */
  _endSustain() {
    this.casting = null;
    this.castLeft = 0;
    /* AND THE ARREARS GO WITH IT. `_sustainDebt` is per-body state that nothing
     * cleared when a cast ended, so a hold that stopped part-way through a tick
     * handed its unpaid remainder to whatever power ran next — including one
     * with a completely different `dps`. Small, silent, and the sort of thing
     * that makes a later measurement of a different power inexplicable. */
    this._sustainDebt = 0;
  }

  /**
   * SPEND THE POOL TO BLUNT AN INCOMING POWER — the defensive half of the Force,
   * which did not exist. See the note on RESIST_PER_FORCE for the argument and
   * the measurements.
   *
   * Consulted by the SINK and by nothing else: `damage()` and `applyKnockback`
   * are the two doors every power in the game comes through, so one call each
   * means a blow is answered exactly once however it was thrown. A body with no
   * pool returns 0 and pays nothing for the feature existing.
   *
   * @returns hp of the blow taken off, having already spent the pool for it.
   */
  resistForce(amount, kind, source) {
    if (this.dead || !this.powers) return 0;
    // …and never against itself: a body's own held power bills through the same
    // door, and a caster paying twice for one cast is not a contest.
    if (source === this) return 0;
    const r = forceResistance(this.force, amount, kind, this._guardOpen());
    this.force = Math.max(0, this.force - r.spend);
    return r.blunt;
  }

  /**
   * Is this body's guard already beaten? One predicate, two readers — the blade
   * (`_turnCut`) and the Force (`resistForce`) — so "the opening you earned" is
   * one rule rather than two that drift.
   */
  _guardOpen() {
    return this.dead || this.toppled || this.gripped || this.disarmed
      || this.stunTimer > 0 || !!this.duel?.staggered || !!this.lock
      /* WINDED IS AN OPENING, and it is the one an animal has instead of a
       * stagger. `_beastBrain` already enters this state when it takes 14% of
       * its health inside its own decay window, already prints WINDED over its
       * head for 2.4 s, and its own comment already calls it "the only safe
       * time to go for a leg". Until the hide could turn a killing pass there
       * was nothing for that window to be safe FROM — every pass landed. It is
       * listed here rather than given its own gate in `_turnCut` because this
       * predicate is the one rule both the blade and the Force read, and an
       * opening the blade honours and the Force does not is two rules. */
      || this.state === 'winded';
  }

  /**
   * The winded window, for every body that keeps the tally — see WIND_TAKE.
   *
   * Called by `_beastBrain` for the creatures and by `_meleeBrain` for the two
   * duellist bosses, and it is the same rule in both places rather than a
   * second one that reads similar. Returns true while the body is open, which
   * is the caller's cue to stop it doing anything.
   *
   * WHAT A DUELLIST DOES WITH IT that an animal does not: the guard goes with
   * it. `duel.stagger` is how every other earned opening in the game is SHOWN —
   * the blade driven wide and low and held there — so a boss that has been hurt
   * faster than it can absorb reads exactly like one that has been parried,
   * from across the room, and `_guardOpen` is true either way. An animal has no
   * blade to throw and gets the floating call and the roar it always had.
   */
  _windTick(dt) {
    if (!keepsWind(this.A)) return false;
    this.windTimer = Math.max(0, (this.windTimer || 0) - dt);
    this.recentDamage = Math.max(0, (this.recentDamage || 0) - dt * this.maxHp * WIND_DECAY);
    if (this.recentDamage > this.maxHp * WIND_TAKE && this.windTimer <= 0 && this.state !== 'winded') {
      this.recentDamage = 0;
      this.state = 'winded';
      this.stateTime = 0;
      this.windTimer = WIND_GAP;
      this.world.notifyFloating?.(this.aimPoint(_v1), 'WINDED', '#ffd88a');
      audio.explosion(this.position, 0.7);
      // A body with a blade shows it with the blade. `stagger` clears the
      // attack, the chain and the chamber and hides the telegraph, so the
      // window cannot be spent on a swing that was already in flight.
      this.duel?.stagger(WIND_OPEN, null, 1.4);
    }
    if (this.state === 'winded') {
      if (this.stateTime > WIND_OPEN) { this.state = 'approach'; return false; }
      return true;
    }
    return false;
  }

  /** The cast lands. Everything that hits goes through `applyKnockback`. */
  _castPower(key, ctx, dist) {
    const P = ENEMY_POWERS[key];
    const t = this.target;
    this._castKey = null;
    // The price and the cooldown were taken when the body committed — see the
    // note in `_forceBrain`. Nothing is charged here, and a cast that reaches
    // this line has already been paid for.
    if (!P || !t || !t.alive) return;
    audio.force(this.position, P.sound);
    this.world.engine?.setRadial?.(0.22);

    if (P.hold) { this.casting = key; this.castLeft = P.hold; this._sustainDebt = 0; return; }

    const dir = _v1.subVectors(t.position, this.position).setY(0);
    const d = dir.length() || 1;
    dir.multiplyScalar(1 / d);
    if (key === 'push' || key === 'unleash') {
      /* A SHOVE ENDS A BIND. `_meleeBrain` runs the kit through a blade lock
       * now (see the note there), and the one verb that means anything with two
       * blades crossed is "get off me" — so it does that, rather than shoving a
       * body the lock is holding in place. The lock resolves the enemy's way,
       * which is what winning a shove IS; it has already cost the pool and the
       * cooldown, and the player's answer is the same one the lock always had. */
      if (this.lock) this.lock.forceBreak?.('enemy');
      /* The 360 is the 360: `unleash` takes everything inside its band whatever
       * side of the body it is on, which is the property that makes it the
       * answer to being surrounded rather than a bigger push. Reach and
       * impulse are the push's, times the ratio the two costs stand in. */
      const k = key === 'unleash' ? 1.55 : 1.0;
      _v2.copy(dir).multiplyScalar(PUSH_SPEED * k).setY(PUSH_LIFT * k);
      t.applyKnockback?.(_v2, 9 * k, this);
      this.world.particles?.sandPuff(this.position.clone().addScaledVector(dir, 1.2),
        2.0 * k, this.world.terrain?.height(this.position.x, this.position.z), this.world.groundColor);
      if (key === 'unleash') {
        // …and it moves the furniture, which is what says "everything around me"
        for (const b of (ctx.physics ? ctx.physics.bodies : [])) {
          if (b.invMass === 0 || b === this.body) continue;
          _v3.subVectors(b.position, this.position);
          const bd = _v3.length();
          if (bd > 9 || bd < 0.01) continue;
          b.applyImpulse(_v3.multiplyScalar(b.mass * 9 * (1 - bd / 9) / bd).setY(b.mass * 4), b.position);
        }
      }
    } else if (key === 'pull') {
      /* A PULL ENDS IN FRONT OF THE PULLER, which is the note Player.forcePull
       * carries: an impulse "toward me" overshoots at 4 m and falls short at
       * 16, so the target is a DESTINATION — blade range — and the speed is
       * whatever covers the gap against the damping the body already has. */
      const want = Math.max(0, d - this.A.preferred[0]);
      _v2.copy(dir).multiplyScalar(-Math.min(want * 6, 26)).setY(2.5);
      t.applyKnockback?.(_v2, 0, this, true);
    }
  }

  /** A held power, billed by the second. It ends when the pool does. */
  _sustain(dt, ctx, dist) {
    const P = ENEMY_POWERS[this.casting];
    const t = this.target;
    this.castLeft -= dt;
    const pay = P.drain * dt;
    const lost = !t || !t.alive || dist > P.band[1] + 2 || this.duel.staggered
      || this.stunTimer > 0 || this.gripped;
    if (this.castLeft <= 0 || this.force < pay || lost) {
      /**
       * AND THE LAST TICK IS PAID, WHICH IT WAS NOT.
       *
       * The audit reported lightning delivering 45.88 hp against an authored
       * 35.2 (130%) and asked whether the tick overpays. **It does not, and the
       * 130% does not reproduce.** Driven against a real Player whose own
       * `update` is running — the part the earlier probe was missing, so
       * `invuln` never decayed and every tick after the first was refused —
       * lightning delivers 28.36 hp against an authored 29.92 at Knight's
       * `damageTaken` of 0.85. That is 94.8%, an UNDER-pay, and the missing
       * 5.2% is exactly the arrears standing in `_sustainDebt` when `castLeft`
       * ran out mid-tick and the hold returned without settling them.
       *
       * A hold that runs its course pays what it accrued. One that is BROKEN —
       * staggered, gripped, out of range — does not, because that is the whole
       * point of breaking it.
       */
      if (!lost && this._sustainDebt > 0 && t?.alive) {
        t.applyKnockback?.(null, this._sustainDebt, this, true);
      }
      this._endSustain();
      return;
    }
    this.force -= pay;

    /**
     * BILL ON A TICK CLOCK, NOT PER FRAME — the enemy's held powers were
     * delivering 8% of their authored damage.
     *
     * `Player.damage` sets `invuln = 0.18` on every hit and refuses while it
     * holds. A per-frame drain therefore offered 60 payments a second into a
     * sink that accepts about five, and the other 55 were silently dropped.
     * Measured on a real player: choke authored 7 dps × 2.4 s = 16.8 hp,
     * delivered **1.39**; lightning authored 35.2 hp, delivered **2.81**.
     *
     * The asymmetry was total, because `Enemy.damage` has no such window: the
     * player's own choke kills a Jedi Knight in 5.0 s while the Sith's does
     * 1.4 hp over its whole duration. That is the largest single gap between
     * what the archetype table promises and what the player feels, and it is
     * why "the enemies that use the Force" never seemed to.
     *
     * So the drain accumulates and is spent in whole ticks slightly longer
     * than the i-frame. No authored number changes — `dps` still means dps —
     * the payments simply stop being thrown away.
     */
    this._sustainDebt = (this._sustainDebt ?? 0) + P.dps * dt;
    if (this._sustainDebt >= P.dps * SUSTAIN_TICK) {
      t.applyKnockback?.(null, this._sustainDebt, this, true);
      this._sustainDebt = 0;
    }

    /**
     * …AND THE SLOW THE FILE ALREADY CLAIMS. The choke's own note promises
     * "35% movement speed (`Player.staggerTimer`)", but `_sustain` passes
     * `gentle = true` and `applyKnockback` writes `staggerTimer` only when
     * `!gentle` — measured through a full choke: 0.00 s. The velocity scale
     * below is undone by the movement integrator on the very next frame, so
     * the documented mechanic had no implementation at all.
     */
    if (this.casting === 'choke' && t.velocity) {
      t.velocity.multiplyScalar(0.86);
      if (t.staggerTimer !== undefined) t.staggerTimer = Math.max(t.staggerTimer, 0.12);
    }
    /*
     * THREE ARGUMENTS INTO A SIGNATURE OF FOUR, and it stopped the game.
     *
     * This was `sparkBurst(chest, 2, 0x9fd8ff)` against
     * `sparkBurst(pos, normal, count, opts)`. So `2` landed in `normal` — and
     * `_v.lerp(normal, …)` on a number gives NaN, spreading every spark in
     * those bursts in no direction at all — while the COLOUR landed in
     * `count`, asking for 10 467 583 sparks, 17.8 million spawns after the
     * recipe's multiplier, each paying an sRGB→linear conversion.
     *
     * It ran on 35% of frames for every enemy holding a power. Measured
     * headless with 20 acolytes: frames 1-20 cost 10-15 ms, and from frame 30
     * — the first held lightning or choke — 71 to 134 SECONDS each, with 96%
     * of a 439 s profile on this one path. In the shipped game that is a
     * multi-second freeze every time an enemy casts, on the feature that was
     * added so enemies would cast at all. It also ran the `cloth-cost` suite
     * past forty minutes six times without it ever being seen to finish, which
     * is how it was finally found.
     *
     * `Particles.sparkBurst` now bounds a burst by its own pool capacity, and
     * that bound is not this fix — a ring buffer cannot show more than it
     * holds, so the surplus was invisible work, but the arguments were still
     * in the wrong slots. This is the fix. The count matches the other
     * per-frame sustained effect in the game, which is guarded by the same
     * 35% roll: three sparks, no embers.
     */
    if (rng() < 0.35) {
      this.world.particles?.sparkBurst?.(aimAt(t, _aim), null, 3,
        { speed: 5, embers: false, color: this.casting === 'lightning' ? 0x9fd8ff : 0xff6a6a });
    }
  }

  /**
   * The second blade's own hit, and why it is here rather than in World.
   *
   * World tests exactly one blade per duellist — `e.saber.prevTip → e.saber.tip`
   * against the player's capsule — and it owns the clash resolution for that
   * blade. A second weapon that only LOOKED like a weapon would be the same lie
   * the boon table has a note about, so the off blade swings for itself.
   *
   * It is deliberately the FOLLOW-UP, not a duplicate: it lands in the back half
   * of the strike, once per attack, for a fraction of the damage. So the
   * telegraph you already read still tells you when to move, and the answer to a
   * dual-wielder is to be gone by the second beat rather than to parry twice.
   */
  _offhandStrike(dt, ctx) {
    const duel = this.duel;
    const phase = duel.phase;
    if (phase !== 'strike') { this._offPhase = phase; return; }
    if (this._offPhase !== 'strike') { this._offPhase = 'strike'; this._offSwung = false; }
    if (this._offSwung) return;
    // the back half of the arc — the main blade has already gone through
    if (duel.timer > (duel._strikeLen ?? 0.2) * 0.5) return;
    this._offSwung = true;

    const t = this.target;
    if (!t || !t.position) return;
    if (t.invuln > 0) return;
    /**
     * THE OFF BLADE STANDS DOWN ON STEEL, AND SWINGS AT A CONE.
     *
     * This was one line — `if (this.offHand.distanceTo(t.chest) > reach) return;`
     * at a reach of `1.15 * scale + 0.9`, which is 2.10 m for an acolyte. No
     * arc, no facing, and no stand-down when the player's own blade is on it.
     * Against `_saberStrike` fifty lines down, which sweeps the REAL blade
     * against the player's capsule in eight sub-steps and stands down at
     * `bladesTouching`. Measured over 45-second fights with the strike phases
     * counted: 164 strike phases, 18 main-blade hits (11%), and 148 off-hand
     * hits out of 148 windows — A 100% CONNECT RATE — for 2628 hp against the
     * answerable blade's 577. Four and a half times the damage, from the half
     * of the elite with no answer at all.
     *
     * A SWEPT TEST WAS TRIED FIRST and it is the wrong shape here, which is
     * worth recording: the off blade's pose mirrors the guard about the body's
     * right axis, so its tip travels sideways rather than at the target — the
     * closest it brought its tip to a body at duelling range was 1.80 m.
     * Swapping the proximity test for `segmentSegment` therefore took the
     * off-hand from 148 hits to 0, which is not a fix, it is a deletion.
     *
     * So it keeps a distance test and gains the two things it was missing:
     *
     *   STEEL ON STEEL STANDS IT DOWN, exactly as the main blade does. The
     *   header above promises "the answer to a dual-wielder is to be gone by
     *   the second beat"; parrying the blade you can see is the other half of
     *   an answer, and it did nothing at all to this one.
     *
     *   AND IT IS A CONE IN FRONT, at the off blade's own reach rather than a
     *   sphere at 2.10 m. Backing out of the second beat is now a thing that
     *   works — and, unlike the sphere, so is being behind the wielder.
     */
    if (t.saber && this.offSaber && bladesTouching(t.saber, this.offSaber)) return;
    const reach = 1.05 * (this.A.scale ?? 1) + 0.55;
    aimAt(t, _v1);
    _v3.subVectors(_v1, this.offHand).setY(0);
    const d = _v3.length();
    if (d > reach) return;
    // the cone is measured off the BODY, not the hand: an off blade held wide
    // still swings at whatever the wielder is facing.
    _v4.set(Math.sin(this.facing), 0, Math.cos(this.facing));
    if (d > 0.05 && _v3.divideScalar(d).dot(_v4) < Math.cos(1.0)) return;
    aimAt(t, _v1);
    t.damage?.(this.attackDamage * 0.55 * duel.damageScale, _v1.clone(), this, 'saber');
    _v2.subVectors(t.position, this.position).setY(0.25).normalize().multiplyScalar(4.5);
    t.velocity?.add(_v2);
    t.camera?.addShake(0.16);
    audio.swing(18, this.offSaber.base);
  }

  /* ══════════════════════════════════════════════════════════════════ */
  /*  The main blade's hit                                              */
  /* ══════════════════════════════════════════════════════════════════ */

  /**
   * WHY THE DUELLIST'S OWN BLADE TESTS ITSELF.
   *
   * World had a test for this blade and it was written correctly — the tip's
   * sweep against the player's spine capsule, gated on the strike phase. It
   * never fired, because the blade was 180° out (see guardQuat in Duel.js) and
   * the tip's closest approach over thirty seconds of duelling was 2.18 m.
   *
   * Once the blade points the right way that test starts landing, and its two
   * remaining weaknesses become the difference between "sometimes hits" and
   * "cuts you the way you cut it":
   *
   *  1. IT IS A TIP TEST. Only `prevTip → tip` is checked, so the middle of a
   *     1.12 m blade passes through a body for free. The player's blade is a
   *     swept QUAD against capsules — the whole edge cuts — and this is the
   *     same test in the same spirit: the blade is sampled along its length as
   *     well as through the frame.
   *  2. IT TAKES A SINGLE SAMPLE PER FRAME. A strike phase is 0.11–0.19 s and
   *     the tip covers ~2 m in it; one sample per frame at 30 fps steps 0.7 m
   *     at a time and tunnels straight through a 0.8 m-wide body.
   *
   * Contact of steel on steel outranks contact of steel on flesh, exactly as
   * World's own ordering says, so this stands down whenever the player's blade
   * is on this one — the clash a few lines later in the frame is the answer,
   * and a hit here would be a blade cutting through a block.
   *
   * Runs from _poseSaber, AFTER the blade has been posed and updated, so the
   * prev→cur sweep it reads is this frame's. Enemies update before
   * World._resolveBlades, and a hit here interrupts the strike phase, so the
   * older tip test cannot fire a second time on the same swing.
   */
  _saberStrike(ctx, target = this.target) {
    const duel = this.duel;
    // The host owns this hit. A client poses the same swing off the wire (see
    // _applyNetDuel) and must not also bill it, or a saber lands twice.
    if (this.netDriven) return false;
    if (!duel || !this.saber || this.saber.ignition < 0.6 || this.lock) return false;
    if (duel.phase !== 'strike') { this._strikePhase = duel.phase; return false; }
    // once per strike, and the phase edge is what defines "once"
    if (this._strikePhase !== 'strike') { this._strikePhase = 'strike'; this._struck = false; }
    if (this._struck) return false;

    const t = target;
    if (!t || !t.position || t.alive === false || !t.damage) return false;
    if (t.invuln > 0) return false;
    // steel on steel wins: leave it to the clash
    if (t.saber && bladesTouching(t.saber, this.saber)) return false;

    // The body, as one capsule from the shins to the crown. `crouch` shortens
    // it because a crouching player really is a smaller target.
    const crouch = clamp(t.crouch ?? 0, 0, 1);
    const p0 = _v1.copy(t.position).setY(t.position.y + 0.35);
    const p1 = _v2.copy(t.position).setY(t.position.y + lerp(1.72, 1.26, crouch));
    const rad = (t.radius ?? 0.34) + BLADE_BITE;

    // Enough samples that the fastest tip in the game cannot step past a body:
    // the tip covers up to ~0.9 m in a 30 fps frame and the body is 0.8 m wide.
    const travel = this.saber.tip.distanceTo(this.saber.prevTip);
    const steps = clamp(Math.ceil(travel / 0.16), 1, 8);
    let bestD = Infinity;
    for (let i = 1; i <= steps; i++) {
      const k = i / steps;
      _v3.lerpVectors(this.saber.prevBase, this.saber.base, k);
      _v4.lerpVectors(this.saber.prevTip, this.saber.tip, k);
      const res = segmentSegment(_v3, _v4, p0, p1, _v5, _v6);
      // `_hit` rather than a clone per sample: this runs eight times a frame
      // for every duellist in a strike, and a Vector3 per sample is garbage
      // for the eight frames in a row that a swing lasts.
      if (res.distSq < bestD) { bestD = res.distSq; _hit.copy(_v5); }
      if (res.distSq <= rad * rad) break;
    }
    if (bestD > rad * rad) return false;

    // one clone, once a hit is real: it is handed to damage(), the particles
    // and the floating label, all of which may hold on to it
    const best = _hit.clone();
    this._struck = true;
    const dmg = this.attackDamage * duel.damageScale * (this.rallyTimer > 0 ? RALLY.damage : 1);
    t.damage(dmg, best, this, 'saber');

    // shoved off the line, not merely dinged
    _v3.subVectors(t.position, this.position).setY(0.3);
    if (_v3.lengthSq() < 1e-6) _v3.set(0, 0.3, 0);
    _v3.normalize().multiplyScalar(6);
    t.velocity?.add(_v3);
    t.camera?.addShake(0.28);
    this.world.particles?.cutFlare(best, null, this.saber.color.getHex(), 20);
    this.world.notifyFloating?.(best, duel.attack?.label?.toUpperCase() ?? 'HIT', '#ff8a6a');
    audio.cut(best, false);
    this.world.addHitstop?.(0.05);
    this.saber.strain(0.7);

    // …and it presses. See DuelBrain.followUp.
    duel.followUp();
    return true;
  }

  /**
   * A boss should not be one move repeated. The acklay works through three
   * phases as it loses health — stalking, then sweeping, then enraged — and
   * every heavy attack leaves it winded, which is the window to take a leg.
   * Three legs and it goes down, physically, because it has three legs left.
   */
  _beastBrain(dt, ctx, dist) {
    const A = this.A;
    const hpFrac = clamp(this.hp / this.maxHp, 0, 1);
    const phase = hpFrac > 0.66 ? 1 : hpFrac > 0.33 ? 2 : 3;
    if (phase !== this.bossPhase) {
      this.bossPhase = phase;
      this.speed = A.speed * (1 + (phase - 1) * 0.22);
      if (phase > 1) {
        this.world.notify?.(`${A.label.toUpperCase()} — PHASE ${phase}`, phase === 3 ? 'it has stopped being careful' : 'it is angry now');
        audio.explosion(this.position, 1.2);
        this.stun(0.6);
        this.world.particles?.sandPuff(this.position.clone(), 3.2,
          this.world.terrain?.height(this.position.x, this.position.z), this.world.groundColor);
        this.world.engine?.flash(0.1);
      }
    }

    // being hurt fast enough winds it — the only safe time to go for a leg
    if (this._windTick(dt)) { this.wish = null; return; }

    this.attackTimer -= dt;
    if (dist < A.preferred[1] + 2.5 && this.attackTimer <= 0 && this.state === 'approach') {
      /**
       * WHICH ATTACK, AND WHY IT IS A LIST RATHER THAN A LADDER OF `if`s.
       *
       * This was three hard-coded branches on one roll — `canCharge && roll <
       * 0.34 ? 'charge' : canSweep && roll < 0.66 ? 'sweep' : 'lunge'` — so
       * every creature in the game had exactly the same three attacks, and the
       * only thing that could differ between two animals was how fast it burnt
       * through the health that gates them. Three creatures, one move set.
       *
       * `beastMoves()` is the archetype's own list filtered by the phase, and
       * the pick is uniform across whatever is unlocked. Measured against the
       * branch it replaces: at phase 3 the old roll gave 34/32/34 across
       * lunge/sweep/charge and uniform gives 33/33/33; at phase 2 it gave
       * 34/66 lunge/sweep and uniform gives 50/50. The phase-2 shift is the
       * only behavioural change and it is in the harmless direction — the
       * sweep is the move with the widest footprint, so seeing fewer of them
       * cannot make the animal easier to read.
       */
      const moves = this.beastMoves(phase);
      this.state = moves[Math.floor(rng() * moves.length)] || 'lunge';
      const M = BEAST_MOVES[this.state];
      this.attackTimer = lerp(2.4, 1.15, (phase - 1) / 2) + rng() * 1.1;
      this.stateTime = 0;
      this._swiped = false;
      // where the claw is aimed — the target's place at the wind-up, not a
      // direction and not a live read. See hitTarget.
      this.swingAt = this.target ? this.target.position.clone() : null;
      this.lungeDir = this.toTarget.clone();
      audio.explosion(this.position, M.roar ?? 0.5);
      if (M.call) this.world.notifyFloating?.(this.aimPoint(_v1), M.call, M.callColor ?? '#ff6a52');
    }

    /**
     * A CLAW LANDS WHERE IT WAS AIMED.
     *
     * This was `t.position.distanceTo(this.position) < radius` — no facing, no
     * arc, no aim, no limb — at radii of `6.6 * scale * 0.6`, which for the
     * acklay (scale 2.9) is an 11.48 m ball centred on a creature whose
     * preferred fighting band is 2.5-5 m. Measured against a real player over
     * 90-second fights: standing still, 39 of 39 sweeps landed; SPRINTING
     * DIRECTLY AWAY, 38 of 38; sprinting sideways, 40 of 40. Across three
     * beasts and three evasions, 348 of 350. There was nothing to dodge,
     * because there was no shape to be outside of.
     *
     * Three shapes were tried before this one, and the two that failed are
     * worth writing down because each fails in an instructive direction:
     *
     *   a forward CONE off the live `this.facing` changes nothing, because
     *   facing tracks the target every frame — the cone follows you round and
     *   a sidestep is not a sidestep. 79-100% still landed.
     *
     *   a cone off a direction committed at the wind-up over-corrects the other
     *   way: the animal is still MOVING through its wind-up (a lunge adds
     *   42 m/s² for half a second), so the ray it committed no longer passes
     *   through a player who has not moved at all. Standing perfectly still was
     *   missed 84% of the time, and not moving is the one thing that has to be
     *   punished.
     *
     * What a telegraphed melee attack actually is: the animal AIMS AT A PLACE,
     * and then the claw arrives there. `swingAt` is the target's position on
     * the frame the wind-up begins, and the test is the claw's own footprint
     * about that point. Stand still and it lands on you. Break out of it during
     * the telegraph — which is what the telegraph is for — and it lands where
     * you were.
     *
     * The footprints below are fractions of `scale` so they are the animal's
     * own reach rather than a number nobody can place: 1.15 for the sweep
     * (3.3 m of claw on a 2.9-scale acklay), 0.75 for the lunge, 0.85 for the
     * charge. The vertical is deliberately not tested — a beast that misses
     * because the player is on a crate reads as broken.
     *
     * AND THE THREE ATTACKS AIM AT DIFFERENT MOMENTS, which is what stops the
     * whole set having one answer. Sweep and lunge aim at the top of the
     * wind-up, so footwork during the telegraph beats them. The CHARGE aims
     * when its drive begins, two thirds of a second later — it is the animal's
     * answer to a player who is simply running, and a run that beats a claw
     * should not also beat a charge. Measured: a sustained sprint-strafe takes
     * 0% of sweeps and lunges and 63% of charges; standing still takes all
     * three.
     */
    /**
     * …AND `centre` IS WHAT MAKES TWO CREATURES TWO FIGHTS.
     *
     * The three original attacks all resolve about `swingAt` — a point the
     * animal remembered — so every one of them is answered by the same verb:
     * be somewhere else by the time the claw arrives. Measured on the shipped
     * three, that is exactly what the numbers say: 0 of 108 sweeps and 0 of 94
     * lunges land on a player who breaks sideways, and 100% of all three land
     * on one who does not move. One answer, three attacks, three animals.
     *
     * `aim` is now a property of the MOVE, and the two new values are chosen to
     * need the opposite verbs:
     *
     *   'self'  the footprint is centred on the ANIMAL at the moment of
     *           impact, not on a remembered point. Sidestepping inside the
     *           ring does nothing at all — you have to leave it. This is the
     *           slam, and it is the answer to a player who has learned that
     *           circling at knife range beats everything, which on the shipped
     *           roster it does.
     *   'launch' the point is committed part-way through, as the animal leaves
     *           the ground, and the landing is a long time after — so footwork
     *           during the EARLY telegraph is wasted and the break has to be
     *           late. This is the pounce, and it inverts WHEN rather than
     *           WHERE.
     *
     * 'windup' (sweep, lunge) and 'drive' (charge) are the two the shipped
     * creatures use and they behave exactly as they did.
     */
    const hitTarget = (M) => {
      if (this._swiped) return;
      this._swiped = true;
      const t = this.target;
      const reach = M.reach * A.scale;
      // where the blow actually lands. A live read for the moves that do not
      // remember a point; `swingAt` for the ones that do.
      const at = M.aim === 'self' ? _v2.copy(this.position) : this.swingAt;
      if (t && at && t.position.distanceTo(at) < reach) {
        // `pull` reverses the impulse: the snatch DRAGS you in, which is the
        // one blow on the field that does not solve your problem for you by
        // putting distance between the two of you.
        if (M.pull) _v1.subVectors(this.position, t.position);
        else _v1.subVectors(t.position, this.position);
        _v1.setY(M.lift).normalize().multiplyScalar(16);
        t.damage?.(this.attackDamage * M.damage, this.position, this);
        t.velocity?.add(_v1);
        t.camera?.addShake(M.shake ?? 0.7);
      }
      this.world.particles?.sandPuff(
        M.aim === 'self' ? this.position.clone()
                         : this.position.clone().addScaledVector(this.toTarget, 3),
        M.aim === 'self' ? reach * 0.7 : 2.4,
        this.world.terrain?.height(this.position.x, this.position.z), this.world.groundColor);
      if (M.quake) this.world.engine?.flash?.(0.06);
    };

    const M = BEAST_MOVES[this.state];
    if (M) {
      const st = this.stateTime;
      // The plant: a move that commits its feet stands still through its own
      // wind-up rather than walking into its swing.
      if (M.plant && st < M.plant) this.wish = null;
      // The drive, which is what carries a lunge and a charge across ground.
      if (M.drive && st >= M.drive[0] && st < M.drive[1]) {
        this.velocity.addScaledVector(this.lungeDir, M.drive[2] * dt);
        if (M.dust && rng() < 0.4) this.world.particles?.sandPuff(this.position.clone(), 1.4,
          this.world.terrain?.height(this.position.x, this.position.z), this.world.groundColor);
      }
      // Re-aim, for the moves that commit late. `aimUntil` is the moment the
      // point is fixed; before it the animal is still reading the target.
      if (M.aimUntil !== undefined && st < M.aimUntil) {
        this.swingAt = this.target ? this.target.position.clone() : null;
        this.lungeDir = this.toTarget.clone();
      }
      if (st >= M.hit[0] && st < M.hit[1]) hitTarget(M);
      else if (st >= M.done) { this.state = 'approach'; this._swiped = false; this.swingAt = null; }
    }
  }

  /**
   * Which of this creature's attacks the phase has unlocked.
   *
   * A creature is defined by what it can DO rather than by how much health it
   * has — see BEAST_MOVES — and what it can do comes off `beastMoveSet`, which
   * is the archetype's declaration if it made one and its body plan's
   * otherwise. Nothing restates that here; this only filters by phase.
   */
  beastMoves(phase = this.bossPhase || 1) {
    const list = beastMoveSet(this.A, this.built);
    return list.filter((k) => BEAST_MOVES[k] && phase >= BEAST_MOVES[k].unlock);
  }

  /* ── motion ──────────────────────────────────────────────────────── */

  /**
   * The short list of static boxes near enough to be standable, rebuilt at
   * most once a frame and again if the body has since walked out of the disc
   * it was built for. See the note over NEAR_REACH for what it is worth and
   * why the radius is what it is.
   *
   * The test is deliberately `<=` and deliberately in the XZ plane only: it
   * has to be a superset of what `boxTopAt` would accept, and that function's
   * own reject is a horizontal one against the same `box.radius` this reads.
   */
  _gatherNear(ctx) {
    const near = this._nearBoxes;
    const physics = ctx.physics;
    if (!physics) { near.length = 0; return near; }
    const p = this.position;
    if (!this._nearStale) {
      const mx = p.x - this._nearAt.x, mz = p.z - this._nearAt.z;
      // Half a metre of drift since the gather. Correctness does not depend on
      // this — `_groundAt`'s guard is measured from `_nearAt`, not from here,
      // so a stale centre only costs coverage — it is here so that the push
      // and the pose in the same frame do not each pay for a rebuild.
      if (mx * mx + mz * mz <= 0.25) return near;
    }
    this._nearStale = false;
    this._nearAt.copy(p);
    near.length = 0;
    const reach = this.radius + NEAR_REACH;
    /**
     * THROUGH THE BROAD PHASE, AND THE TEST BELOW IS UNCHANGED.
     *
     * This loop used to run over `physics.staticBoxes` in full — every box in
     * the level, once per body, every frame. The note over NEAR_REACH already
     * measured what that costs and what it grows to (241 boxes on the temple,
     * 377 after four minutes of fighting in it, 7.63 us per extra box per
     * frame), and Trees.js measured the same curve from the other end: 76
     * boxes 3.18 ms/frame, 1800 boxes 14.09.
     *
     * `nearBoxes` answers with a SUPERSET of the array — see the correctness
     * argument in src/physics/BoxIndex.js — so the distance test that follows
     * is the same test on a shorter list and the short list that comes out is
     * identical. `tools/checks/frame-budget.mjs` asserts that identity against
     * the exhaustive sweep on every level rather than taking it on trust, and
     * counts the box records touched, which is the machine-independent half of
     * what this is worth.
     *
     * The fallback is the old loop, so a physics world without an index — the
     * hand-built stubs several checks stand bodies on — behaves exactly as it
     * did.
     */
    _nearScratch.length = 0;
    const cand = physics.nearBoxes
      ? physics.nearBoxes(p.x, p.z, reach, _nearScratch)
      : physics.staticBoxes;
    for (let i = 0; i < cand.length; i++) {
      const box = cand[i];
      if (box.disabled) continue;
      const dx = box.center.x - p.x, dz = box.center.z - p.z;
      const rr = box.radius + reach;
      if (dx * dx + dz * dz <= rr * rr) near.push(box);
    }
    return near;
  }

  /**
   * What is under (x, z), answered off the short list when the short list can
   * prove it knows, and off the whole array when it cannot.
   *
   * The guard is the whole reason this is safe to do at all. `_nearBoxes`
   * holds every box whose bounding sphere reaches within `radius + NEAR_REACH`
   * of `_nearAt`; a column farther than NEAR_REACH from `_nearAt` may be
   * standing on something the gather never looked at, so it pays for the full
   * sweep rather than answering wrong. Measured over 312,706 real gait queries
   * the farthest one ever lands is 2.102 m against a 2.6 m reach, so in
   * practice the fallback never runs — `_nearMisses` counts it so that stays a
   * measured fact rather than a hope.
   */
  _groundAt(ctx, x, z) {
    const dx = x - this._nearAt.x, dz = z - this._nearAt.z;
    let boxes = this._nearBoxes;
    if (dx * dx + dz * dz > NEAR_REACH * NEAR_REACH) {
      boxes = ctx.physics?.staticBoxes;
      this._nearMisses++;
    }
    return supportHeight(ctx.terrain, boxes, null,
      x, z, this.position.y, this.radius, STEP_UP);
  }

  _move(dt, ctx) {
    const terrain = ctx.terrain;
    const A = this.A;

    /* THE FALL `knockFlat` RECORDED, taken here because this is the one step
     * both machines run for this body and because the sweep that caused it is
     * over by now. See knockFlat. */
    if (this._flatten) this._takeFall();

    if (this.gripped && this.liftTarget) {
      /**
       * HELD BODIES HANG. Note 48.
       *
       * This used to be the whole of it: damp the position toward the hold
       * point and let the animator go on walking. A droid lifted off the floor
       * slid through the air in a jogging pose, which is the least cinematic
       * possible reading of the most cinematic thing in the source material.
       *
       * A body held off the ground is ragdolled and SUSPENDED by the chest —
       * see Ragdoll.suspend — so the arms fall, the head lolls, the legs trail
       * and swinging the mouse swings a real joint solve. `position` follows
       * the ragdoll's own centre rather than driving it, so everything that
       * asks where this enemy is still gets an answer.
       *
       * Anything without an actor to ragdoll (a stub, a droideka mid-transform)
       * falls back to the old rigid path rather than losing the grip.
       */
      if (this.actor && !this.dead) {
        if (!this.actor.ragdolled) this.actor.goRagdoll(this.velocity, null);
        if (this.actor.suspend?.(this.liftTarget, dt)) {
          /**
           * …AND HOW FAST IT IS BEING DRAGGED. This branch answered `0, 0, 0`.
           *
           * The LIMP branch forty lines down — a ragdolled body nobody is
           * holding — answers the same question with the ragdoll's own chest
           * velocity. Two branches of one method, opposite answers to "how fast
           * is this body moving", and the held one was a flat lie: measured
           * over a Geonosis Command wave with a Jedi gripping continuously, a
           * held body travels 4.75 m/s while `velocity` read 0.00. `Enemy.
           * _shoot` leads its aim by `target.velocity * tof`, so a held body
           * was the one target on the field nobody in either army led.
           *
           * IT IS THE DISPLACEMENT AND NOT THE CHEST'S VELOCITY, and that is
           * the whole content of this note. Copying the chest the way the limp
           * branch does was tried first and is a second lie in the other
           * direction: `Ragdoll.suspend` COMMANDS that body at `(target − pos)
           * × 12` every frame, and a hanging body sits at a steady sag under
           * that command — measured on a stationary hold point, the chest
           * carries 2.01 m/s while the body's centre moves 0.09. A lead built
           * on it aims two metres past a body that is not going anywhere.
           *
           * So: where the centre was, where it is now, over dt. It is the
           * definition of the quantity rather than any solver's idea of it, and
           * it costs one vector subtract on the at-most-four bodies a pair of
           * hands can hold.
           *
           * The line's hit rate on a held body is 4.1% against 4.8% on a body
           * that is not, so this is NOT what starves FLAGSHIP §7's third verb —
           * see NEXT.md for what does. It is fixed because a field that reports
           * 0.00 for a body crossing the field at five metres a second is wrong
           * whatever happens to read it.
           */
          _wasAt.copy(this.position);
          this.actor.centre(this.position);
          if (dt > 0) this.velocity.subVectors(this.position, _wasAt).multiplyScalar(1 / dt);
          else this.velocity.set(0, 0, 0);
          this.grounded = false;
          this._syncBody();
          return;
        }
      }
      dampVec(this.position, this.liftTarget, 8, dt);
      this.velocity.set(0, 0, 0);
      this.grounded = false;
      this._syncBody();
      return;
    }
    if (this.toppled) { this._syncBody(); return; }

    /**
     * HELD BY A FORCE STOP — it hangs where it was caught.
     *
     * The stun the field lays on this body already stops it WALKING (`canMove`
     * below reads `stunTimer`), and that is not the same as stopping. Past that
     * gate the method still applies gravity and still integrates whatever
     * velocity the body had, so a jet trooper caught mid-hop, or anyone caught
     * mid-knockback, would go on sinking and sliding inside a field that had
     * visibly stopped every bolt in the air around them.
     *
     * Zeroing the velocity here is the same statement `_updateStasis` makes to
     * an arrested crate one line apart — `velocity.set(0,0,0)` — and the same
     * one `StasisAnchor` makes to an arrested bolt. One field, one answer.
     */
    if (this.stasisHeld) {
      this.velocity.set(0, 0, 0);
      this._syncBody();
      return;
    }

    /**
     * LIMP. A living body whose actor is ragdolled is not walking anywhere,
     * and — the part that was actually broken — its `position` has to follow
     * the ragdoll rather than stay where the body left the ground.
     *
     * Everything in this class reads `this.position`: the AI, the spawner's
     * spacing, the wave's alive test, the blade's broad phase and every Force
     * power's range test. While a released body was limp, all of them were
     * reading the spot it was standing on before it was picked up — so a droid
     * thrown thirty metres was still, as far as the game was concerned, right
     * in front of you. This is the other half of note #6 and it is why the
     * released body looked "lost": it was in two places at once.
     */
    if (this.actor?.ragdolled) {
      this.actor.centre(this.position);
      const chest = this.actor.bodies.get('chest') || this.actor.bodies.get('spine')
        || this.actor.bodies.get('hips');
      if (chest) this.velocity.copy(chest.velocity);
      this.grounded = false;
      this._syncBody();
      return;
    }

    const canMove = this.stunTimer <= 0 && this.knockTimer <= 0 && !this.gripped;
    if (canMove && this.wish) {
      /**
       * ── WHAT THE GROUND UNDER IT COSTS, WHICH FOR MOST OF THE ROSTER IS
       *    NOTHING AND FOR A WHEEL IS THE WHOLE FIGHT ────────────────────
       *
       * Every body in this game climbs identically: `slopeAt` is read by the
       * spawner, by Arrivals and by the extraction's landing-site search, and
       * by NOTHING that moves a body once it is on the field. So a ten-wheeled
       * 25-metre transport took a one-in-two bank at the same pace an acklay
       * did, and an AT-TE — whose one famous feature is that its footpads are
       * MAGNETISED and it climbs vertical rock with them — took it at the same
       * pace as the wheels.
       *
       * `grade` is the steepest ground the machine is built for, in `slopeAt`'s
       * own units (1 − n.y, so 0 is a table and 1 is a wall). Pace falls off
       * over the top 45% of it rather than at a threshold, for the reason the
       * yielding band in `_brain` gives: a number that switches on one frame
       * reads as the machine being shoved rather than as it labouring.
       *
       * IT IS OPT-IN AND THE DEFAULT IS THE OLD BEHAVIOUR. A body that declares
       * no grade is a body nothing about this changed, which is twenty-nine of
       * the thirty-six archetypes and every measurement anybody has taken of
       * them.
       */
      let speed = this.speed * (this.legsLost ? 0.45 : 1) * (this.rallyTimer > 0 ? RALLY.speed : 1);
      if (A.grade != null && terrain?.slopeAt) {
        const s = terrain.slopeAt(this.position.x, this.position.z);
        speed *= 1 - smoothstep(A.grade * 0.55, A.grade, s);
      }
      /**
       * NAVIGATION, SUCH AS IT IS — AND THERE WAS NONE.
       *
       * `wish` is a direction toward the target with a circling term on it and
       * nothing between it and the geometry. So an acolyte walked the straight
       * line to the player, met the first wall on it, and pressed into that
       * wall for the rest of the fight: measured on the temple and the
       * warship, 3 and 2 of twelve never came within 6 m of a stationary
       * player in forty seconds, with closest approaches of 12–15 m. On a
       * level made of rooms that is a quarter of the wave standing in a
       * corridor.
       *
       * Two terms, both cheap, and neither of them a path-finder:
       *
       *   SLIDE. `_wallN` is the outward normal of whatever the body was
       *   pushed off last frame. Removing the component of the wish that
       *   points into it turns "press the wall" into "walk along the wall",
       *   which resolves every doorway and every pillar on its own.
       *
       *   COMMIT. A slide alone deadlocks in a corner — two faces, each
       *   removing the other's escape — so `_stuckT` counts how long the body
       *   has wanted to move and not moved, and past half a second the wish
       *   swings hard to one side and holds there. Which side is `strafeDir`,
       *   and it flips at 2.5 s so a body that picked the wrong way round a
       *   room eventually tries the other.
       */
      /**
       * …AND A WISH SQUARE INTO A FACE SURVIVED NEITHER TERM.
       *
       * The slide REMOVES the into-wall component, and a body walking straight
       * at a flat face has no other component: the wish came out (0, 0, 0).
       * That is not "walk along the wall", it is stop — and it then disabled
       * the COMMIT term twice over, because the lateral below is derived from
       * the wish that the slide had just emptied, and `_stuckT` (five hundred
       * lines down) only counts while `wish.lengthSq() > 0.25`. So a body
       * pressed exactly square into geometry could never be stuck by its own
       * measure and could never swing out of it.
       *
       * Measured on Geonosis with a real army: a broken trooper walled against
       * a spire on the way back to its commander stood motionless for 6.6 s
       * with `wish` at (-0.00, 0.00) and `_wallT` alight the whole time.
       *
       * The lateral is captured BEFORE the slide, and used as the wish outright
       * when the slide leaves nothing behind — which is the sentence the slide's
       * own note already makes: along the face, not into it.
       */
      _v7.set(-this.wish.z, 0, this.wish.x).multiplyScalar(this.strafeDir || 1);
      if (this._wallT > 0 && this._wallN.lengthSq() > 1e-6) {
        _v6.copy(this._wallN).setY(0);
        if (_v6.lengthSq() > 1e-6) {
          _v6.normalize();
          const into = this.wish.dot(_v6);
          if (into < 0) this.wish.addScaledVector(_v6, -into);
          if (this.wish.lengthSq() < 0.04 && _v7.lengthSq() > 1e-6) this.wish.copy(_v7);
        }
      }
      if (this._stuckT > 0.5) this.wish.addScaledVector(_v7, 1.0);
      if (this.wish.lengthSq() > 1e-6) this.wish.normalize();
      _v1.copy(this.wish).multiplyScalar(speed);
      // Nobody backpedals as fast as they run. Only the component pointing AWAY
      // from the target is scaled, so a sidestep keeps its full pace and only
      // the retreat slows — which is both what a body does and what makes a
      // retreat legible instead of looking like the enemy is on rails.
      if (this.toTarget) limitBackpedal(_v1, this.toTarget);
      // Reversing is slower to build than pressing forward: pushing off the back
      // foot cannot produce the acceleration that pushing off the front one does,
      // and an instant reversal is the single biggest "unnatural" tell there is.
      const rate = (this.velocity.x * _v1.x + this.velocity.z * _v1.z) < 0 ? 5.0 : 8;
      this.velocity.x = damp(this.velocity.x, _v1.x, rate, dt);
      this.velocity.z = damp(this.velocity.z, _v1.z, rate, dt);
    } else if (this.knockTimer <= 0) {
      this.velocity.x = damp(this.velocity.x, 0, 6, dt);
      this.velocity.z = damp(this.velocity.z, 0, 6, dt);
    }

    /* The two counters the navigation above runs on. `_wallN` decays rather
     * than being cleared, so a body brushing a face every few frames keeps a
     * usable normal; `_stuckT` is measured against the ground actually
     * covered, because velocity can be healthy while the collision loop puts
     * the body straight back where it was. */
    this._wallT -= dt;
    if (this._wallT <= 0) this._wallN.set(0, 0, 0);
    if (canMove && this.wish && this.wish.lengthSq() > 0.25) {
      const moved = Math.hypot(this.position.x - this._prevPos.x, this.position.z - this._prevPos.z);
      if (moved < this.speed * dt * 0.3) this._stuckT += dt;
      else this._stuckT = Math.max(0, this._stuckT - dt * 3);
      // Long enough to have tried one way round the room; try the other.
      if (this._stuckT > 2.5) { this._stuckT = 0; this.strafeDir = -(this.strafeDir || 1); }
    } else this._stuckT = 0;
    this._prevPos.set(this.position.x, this.position.y, this.position.z);

    if (this.A.float) {
      // hover: hold a height above the ground with a slow bob
      const gh = terrain ? terrain.height(this.position.x, this.position.z) : 0;
      this.hoverPhase += dt * 1.7;
      const want = gh + this.A.float + Math.sin(this.hoverPhase) * 0.16;
      this.velocity.y = damp(this.velocity.y, (want - this.position.y) * 4.5, 8, dt);
      this.position.addScaledVector(this.velocity, dt);
      this.grounded = false;
      /**
       * A MAN UNDER THRUST LEANS INTO IT. Note #33's first clause — "it's like
       * they're magically sitting in the air" — is as much about the POSE as
       * about the pack: a body held upright at a fixed height with a sine on
       * it is a body being levitated, and a body on a jetpack is a body being
       * PUSHED, which means it is tilted away from where it is going and it
       * moves in arcs rather than on rails.
       *
       * `jetLean` is read by the poser. Forward pitch off the horizontal
       * speed, roll off the turn — the two things a real pack rider does, and
       * the two the eye reads as "under power" without being told.
       */
      const sp = Math.hypot(this.velocity.x, this.velocity.z);
      const pitch = clamp(sp * 0.055, 0, 0.34);
      const turn = clamp((this.velocity.x * Math.cos(this.facing) - this.velocity.z * Math.sin(this.facing)) * 0.05, -0.30, 0.30);
      this.jetLean = damp(this.jetLean ?? 0, pitch, 6, dt);
      this.jetRoll = damp(this.jetRoll ?? 0, turn, 6, dt);
      /* THE ENGINES ANSWER WHAT THE BODY IS DOING, which is the whole read.
       * Climbing hard is a long white plume; holding station is a pilot
       * flame. `_jetFx` also owns the noise. */
      this._jetFx(dt, ctx, clamp(0.22 + Math.max(0, this.velocity.y) * 0.42 + sp * 0.05, 0, 1.6));
      this._syncBody();
      return;
    }

    if (!this.grounded) this.velocity.y -= 24 * dt;
    this.position.addScaledVector(this.velocity, dt);

    // THE SAME GROUND THE PLAYER STANDS ON. This sampled the terrain heightfield
    // alone, and the box loop below has no top-landing branch at all — its
    // resolution is `_v4.y = 0`, horizontal, always. So an enemy could not stand
    // on a rock, a crate or a piece of its own ruined architecture: it sank
    // through and stood on the sand underneath, or hopped on the spot the way
    // the player's did. See src/physics/Support.js.
    const gh = terrain ? terrain.height(this.position.x, this.position.z) : 0;
    this._gatherNear(ctx);
    let support = this._groundAt(ctx, this.position.x, this.position.z);
    /* AND A DROID CLIMBS A LOG THE WAY THE PLAYER DOES. See CLIMB_RATE: the
     * support query answers with a felled trunk's top now, and taking it in one
     * frame would stand a trooper on top of a log with no time passing. The
     * animator's own foot query goes through the same `_groundAt`, so the feet
     * find the wood while the body is still coming up over it.
     *
     * NOT THE GROUND ITSELF, and this cost a run of Command's own suite to
     * find: `supportHeight` caps what a BOX may raise you by and does not cap
     * the terrain, so a body walking up anything steep gets a support well
     * above its feet every frame — and rate-limiting that is rate-limiting
     * walking uphill. Measured as two watchdog rescues of a line standing
     * exactly where it was ordered to stand. */
    /* …AND ONLY FROM THE FLOOR. A body falling onto a surface is LANDING, and
     * a landing taken at a climb's rate sinks through what it landed on. See
     * the same guard in `Player._collide`. */
    if (this.grounded && support > gh + 0.05
        && support > this.position.y + (this.climbing ? 1e-3 : STEP_UP)) {
      /**
       * …AND A WHEEL DOES NOT CLIMB, which is the second half of `grade` and
       * the half a slope term cannot express.
       *
       * The condition guarding this branch already says the support is above
       * the terrain — that is what `support > gh + 0.05` means — so what is
       * being climbed here is always a PROP: a crate, a felled trunk, a slab of
       * ruined architecture. Walking up the ground itself never reaches this
       * line and is priced by the pace term above instead, which is the split
       * that keeps a machine from being stranded on a hill by a rule about
       * logs.
       *
       * A body built for anything under a vertical face refuses the step
       * outright rather than climbing it slowly. It then walks into the thing,
       * fails to move, and `_stuckT` swings it round the side within half a
       * second — the navigation this class already has, answering the question
       * it was written for. Going ROUND is the correct behaviour for a
       * ten-wheeled transport and it is the behaviour the player can see.
       *
       * `grade >= 1` is the one value that means "anything", and exactly one
       * body in the game declares it: the AT-TE, whose magnetised footpads are
       * the single most quoted fact about the machine and which had until now
       * climbed a crate at precisely the rate a battle droid does.
       */
      if (A.grade != null && A.grade < 1) {
        support = Math.max(gh, this.position.y);
        this.climbing = false;
      } else {
        support = Math.max(this.position.y, Math.min(support, this.position.y + CLIMB_RATE * dt));
        this.climbing = true;
      }
    } else this.climbing = false;
    if (this.position.y < support) this.position.y = support;
    if (this.position.y <= support + GROUND_SNAP && this.velocity.y <= 0.1) {
      if (this.velocity.y < -9) {
        ctx.particles?.sandPuff(this.position.clone(), 0.8, support, this.world.groundColor);
        audio.thud(this.position, 0.6);
        if (this.velocity.y < -20 && !this.A.boss) this.damage(clamp(-this.velocity.y - 20, 0, 60), this.position, null, 'fall');
      }
      this.position.y = support;
      if (this.velocity.y < 0) this.velocity.y = 0;
      this.grounded = true;
    } else if (this.position.y > support + 0.06) this.grounded = false;

    // stay inside the arena
    if (terrain && !terrain.inBounds(this.position.x, this.position.z, 4)) {
      const h = terrain.half - 4;
      this.position.x = clamp(this.position.x, -h, h);
      this.position.z = clamp(this.position.z, -h, h);
    }

    // static geometry
    for (const box of ctx.physics.staticBoxes) {
      if (box.disabled) continue;
      _v1.set(this.position.x, this.position.y + 0.9, this.position.z);
      if (_v1.distanceToSquared(box.center) > (box.radius + 1.6) ** 2) continue;
      _v2.subVectors(_v1, box.center).applyQuaternion(box.invQuat);
      const h = box.halfExtents;
      _v3.set(clamp(_v2.x, -h.x, h.x), clamp(_v2.y, -h.y, h.y), clamp(_v2.z, -h.z, h.z));
      _v4.subVectors(_v2, _v3);
      let d2 = _v4.lengthSq();
      const r = this.radius;
      if (d2 > r * r) continue;
      /**
       * A BODY STRICTLY INSIDE THE BOX WAS NEVER PUSHED OUT.
       *
       * `_v3` is the chest point clamped into the box, so when the chest is
       * inside, `_v3 === _v2` and the separation vector is exactly zero — and
       * the guard here read `|| d2 < 1e-8) continue`. The one case that most
       * needs resolving was the one case skipped, so an enemy that got a
       * shoulder inside a wall stayed inside it for the rest of the fight.
       * Player._collide has had the answer for as long as it has existed:
       * leave by the SHALLOWEST face, which is the shortest way out and the
       * only choice that cannot push a body through the far side.
       */
      if (d2 < 1e-8) {
        const px = h.x - Math.abs(_v2.x), py = h.y - Math.abs(_v2.y), pz = h.z - Math.abs(_v2.z);
        if (px <= py && px <= pz) _v4.set(Math.sign(_v2.x) || 1, 0, 0);
        else if (py <= pz) _v4.set(0, Math.sign(_v2.y) || 1, 0);
        else _v4.set(0, 0, Math.sign(_v2.z) || 1);
        d2 = 1e-4;
      }
      const d = Math.sqrt(d2);
      _v4.multiplyScalar(1 / d).applyQuaternion(box.quat);
      // an upward face is floor, and the support query above owns floors
      if (_v4.y > 0.5) continue;
      _v4.y = 0;
      if (_v4.lengthSq() < 1e-6) continue;
      _v4.normalize();
      this.position.addScaledVector(_v4, r - d);
      // …and remember which way out it was, so next frame's wish can go ALONG
      // the face rather than back into it. See _wallN in the constructor.
      this._wallN.add(_v4);
      this._wallT = 0.3;
    }

    // face the target while fighting, face travel otherwise
    let want = this.facing;
    /**
     * …AND NEITHER, IF SOMEBODY IS DRIVING. `Crew.update` writes `facing`
     * directly from the steering axis, and this block was quietly undoing it:
     * `toTarget` is whatever the brain last wanted to look at and survives the
     * brain being switched off, so a driver hauling on the stick was fighting
     * the machine's own idea of where to point. Measured before this line: a
     * full second of full steer swung an AAT 0.24 rad against the 0.90 the
     * driver's own rate asks for — a quarter of the turn, for no reason a
     * player could see. See src/game/Driving.js.
     */
    if (this.driven) { /* the driver owns the heading */ }
    else if (this.toTarget && this.stunTimer <= 0) want = Math.atan2(this.toTarget.x, this.toTarget.z);
    else if (this.velocity.lengthSq() > 1) want = Math.atan2(this.velocity.x, this.velocity.z);
    let d = want - this.facing;
    while (d > Math.PI) d -= TAU;
    while (d < -Math.PI) d += TAU;
    /**
     * HOW FAST A THING CAN COME ABOUT, and until the giants it was two numbers
     * for the whole game: 8 for a man, 3.2 for anything flagged `big`.
     *
     * That is one gain shared by a 2.8 m dwarf spider droid, a 13.5 m
     * six-legged walker and an 11 m tank carried on a SINGLE central tread, and
     * it is the field where the difference is most visible and cost nothing to
     * state. A snail tank that pivots like a spider droid is a spider droid
     * with a different hull on it — which is player note 26 wearing a new coat,
     * and this time in the axis the note is actually about ("they all attack
     * the same way" is half of it; the other half is that they all MOVE the
     * same way).
     *
     * It is an exponential gain and not a rate cap, so the honest way to read
     * it is in seconds to come about: `dt * gain` is the fraction of the
     * remaining error closed per frame, and half a turn is closed to within a
     * degree in roughly `5.2 / gain` seconds. Measured on the shipped bodies
     * through `tools/checks/giants.mjs`, which prints the number per machine
     * every run rather than restating this arithmetic.
     *
     *     8.0   a man                          0.65 s
     *     3.2   the default heavy              1.6 s
     *     0.90  ten wheels on a 25 m wheelbase 5.8 s
     *     0.45  one tread                      11.6 s
     *     9.0   three legs on a rotating hub   0.58 s — faster than a man, and
     *           it is the one number on the tri-droid taken straight out of the
     *           reference: "their rotating multi-jointed assemblies allowed
     *           them to change facing almost instantly".
     *
     * The default is unchanged for every body that does not declare one, so
     * nothing in the roster moved when this line did.
     */
    this.facing += d * Math.min(1, dt * (this.A.turnRate ?? (this.A.big ? 3.2 : 8)));

    this._syncBody();
  }

  _syncBody() {
    if (this.bodyRemoved) return;
    this.body.setTransform(_v1.set(this.position.x, this.position.y + (this.A.big ? 1.4 : 0.9), this.position.z), null);
  }

  /* ── pose ────────────────────────────────────────────────────────── */

  _pose(dt, ctx) {
    const A = this.A;
    if (this.actor?.ragdolled) return;
    /**
     * AND A HELD BODY DOES NOT ANIMATE. This is the whole visible half of a
     * Force stop and it costs one line.
     *
     * Without it a frozen enemy stands in place and goes on breathing, blinking
     * its idle, settling its cape and swinging its blade back to guard — a
     * body that has stopped WALKING, which is what "he only stopped shooting"
     * looks like from two metres away. Returning here leaves the rig, the IK'd
     * arms, the sabre pose and the cloth (which `_poseArms` steps) exactly as
     * they were on the frame of capture: caught mid-stride, arm still up, robe
     * still mid-swing. The animator's own clock does not advance either, so the
     * body resumes the same stride when the field lets go rather than snapping
     * to a new one.
     */
    if (this.stasisHeld) return;

    if (this.animator) {
      // the feet stand where the body stands — see src/physics/Support.js, and
      // NEAR_REACH for why this is a short list rather than the whole level
      this._gatherNear(ctx);
      const groundAt = (x, z) => this._groundAt(ctx, x, z);
      this.animator.setFacing(this.facing);
      this.animator.update(dt, {
        position: this.position, facing: this.facing, velocity: this.velocity,
        /**
         * AND THE CROUCH IS NO LONGER A HARD ZERO.
         *
         * `Rig.update` has always taken this float — it drops the hip to 0.68
         * of standing and leans the spine into it — and every enemy in the game
         * handed it a literal `0`, so the one pose that says "this man has gone
         * to ground" was built, tested by `character-gait.mjs`, and unreachable.
         * `CommandDirector.steer` is the writer: a frightened trooper kneeling
         * behind a rock and a steady one taking a knee at his post are both
         * this number. Anything without a writer still reads exactly 0.
         */
        grounded: this.grounded, groundAt, crouch: clamp(this.crouch || 0, 0, 1),
        accelForward: clamp(this.velocity.length() / 5, 0, 1),
      });
      this._poseArms(dt, ctx);
      /**
       * AND A MAN UNDER THRUST IS TILTED. Note #33's first clause.
       *
       * The animator solves a WALK — hips level, feet reaching for ground —
       * and a body that is not standing on anything gets the same solve with
       * the ground moved. That is the whole of "it's like they're magically
       * sitting in the air": nothing about the pose says the man is being
       * pushed.
       *
       * Applied to the rig ROOT and after the animator has run, because it is
       * an attitude and not a gait: the legs still trail correctly under it,
       * the arms are still IK'd to the weapon, and the body leans into its own
       * acceleration the way anything on a pack does. `_move` derives the two
       * angles; this only spends them.
       */
      /**
       * …AND THE LEAN HAS TO PIVOT ON THE BODY, WHICH IT DID NOT.
       *
       * `BipedAnimator.update` writes the pelvis in WORLD coordinates
       * (`hips.position.set(hipX, hipY, hipZ)`, src/game/Rig.js) onto a bone
       * that is a child of this root — which is correct only while the root is
       * an identity transform. Rotating it turns the whole skeleton about the
       * WORLD ORIGIN instead of about the man, so the drawn body swings away
       * from its own `position` by roughly the distance to the origin times the
       * angle, and everything that reads `position` — the muzzle, the brain's
       * range, a Force grip's pick, `Waves.positionIsValid` — is then talking
       * about a place the body is not.
       *
       * Measured on the SHIPPED Jet Trooper before this, three spawns, worst
       * horizontal gap between the drawn pelvis and `position` over eight
       * seconds: 1.83 m at x=2, 1.36 m at x=14, 1.79 m at x=30. It was
       * invisible because `jet` is the only rigged body in the roster that
       * floats and it is usually within a few metres of a player who is
       * themselves near the origin; on a body that cruises at five and a half
       * metres of altitude it is metres of altitude, which is how it was found.
       *
       * The fix is the standard pivot: rotate about P by translating the root
       * to `P - R·P`, so the point P maps to itself and everything near it
       * turns about it. The attitude is unchanged — the same two angles, the
       * same order — and nothing else in the frame moves.
       */
      if (A.float && rigRootOf(this)) {
        const root = rigRootOf(this);
        root.rotation.x = this.jetLean ?? 0;
        root.rotation.z = this.jetRoll ?? 0;
        /* `root.quaternion` is already the euler above — Object3D keeps the two
         * in step through `rotation`'s own change callback — so this is a read
         * of what was just written and not a second way of writing it. */
        root.position.copy(this.position)
          .sub(_v4.copy(this.position).applyQuaternion(root.quaternion));
      }
    } else if (this.rig) {
      this._poseWalker(dt, ctx);
    } else if (this.group && A.custom === 'remote') {
      this.group.position.copy(this.position);
      this.group.rotation.y += dt * 1.2;
      if (this.built.halo) this.built.halo.intensity = 1.1 + Math.sin(ctx.time * 6 + this.hoverPhase) * 0.5;
    } else if (this.group) {
      this._poseDroideka(dt, ctx);
    }

    if (this.laser && this.laser.visible && this.target) {
      const from = this._muzzleWorld(_v1);
      // The COMMITTED point, not a live read of the chest. This line used to
      // track the player, which made "leave the line" impossible: the line went
      // with them. See `_beginTelegraph`.
      _v2.subVectors(this.telegraphAim ?? aimAt(this.target, _aim), from);
      const len = _v2.length();
      this.laser.position.copy(from);
      this.laser.quaternion.setFromUnitVectors(_v3.set(0, 0, 1), _v2.normalize());
      this.laser.scale.set(1, 1, len);
    }
    if (this.muzzleFlash > 0) this.muzzleFlash -= dt;
  }

  _poseArms(dt, ctx) {
    const rig = this.rig;
    if (!rig || this.lod > 1) return;
    const chest = rig.worldPos('chest', _v1);
    const fwd = _v2.set(Math.sin(this.facing), 0, Math.cos(this.facing));
    const right = _v3.set(fwd.z, 0, -fwd.x);
    const S = this.A.scale;

    if (this.saber) {
      this._poseSaber(dt, ctx, chest, fwd, right);
      return;
    }
    if (this.disarmed || !this.weapon) {
      this.animator?.swingArms(dt, this.velocity.length(), 1);
      return;
    }
    /**
     * BOTH HANDS ON THE BORE, AND THE BORE ON THE AIM. Note #32: "the troopers
     * (at least the clones but probably others too tbh) hold their weapons
     * really awkwardly like it's really bad, kind of takes you out of it."
     *
     * Measured on a shipped clone trooper aiming at a target twenty metres
     * dead ahead: **the barrel pointed 77.6 degrees away from the aim** — very
     * nearly across the body — because the hand was oriented by putting its
     * +Y up the aim line while the blaster's barrel is its own +Z. The two
     * axes are perpendicular, so aiming one aimed nothing.
     *
     * `assets/reference/units/clones/trooper holding … DC-15A blaster
     * rifle.webp` is what the pose should be, and it is three things: the bore
     * level and along the line of sight; both hands ON that line, the trigger
     * hand in close under the chin and the support hand well forward; and both
     * elbows DOWN. What was here had the two hands on opposite sides of the
     * centreline, which is why the weapon lay across the chest.
     */
    const aim = this.target ? aimAt(this.target, _v4).sub(chest).normalize()
                            : _v4.copy(fwd);
    /* The bore line: offset to the shooting side and just under the chin, so
     * both hands hang off ONE line instead of straddling the body. */
    const boreAt = (t, out) => out.copy(chest)
      .addScaledVector(aim, t * S).addScaledVector(right, 0.125 * S).addScaledVector(UP, -0.045 * S);
    const holdR = boreAt(0.25, _v5);
    // elbow DOWN and back, which is where a trigger arm's is — it was out to
    // the side at shoulder height, which is a pose for holding a tray
    const poleR = _v6.copy(chest).addScaledVector(right, 0.55).addScaledVector(UP, -1.05).addScaledVector(aim, -0.35);
    rig.solveIK('armR', 'foreR', holdR, poleR);
    if (!this.A.custom) {
      const holdL = boreAt(0.62, _v5);
      const poleL = _v6.copy(chest).addScaledVector(right, -0.35).addScaledVector(UP, -1.1).addScaledVector(aim, 0.1);
      rig.solveIK('armL', 'foreL', holdL, poleL);
    }
    /**
     * AND THE WRIST PUTS THE BARREL ON THE LINE.
     *
     * A basis rather than a single-axis aim, because a weapon needs both a
     * direction and a ROLL: `aimY` fixes one axis and leaves the other two to
     * whatever its own convention picks, which is how a rifle ends up on its
     * side. +Z down the aim, +Y up, +X across — and the whole thing pitched by
     * the 0.2 rad the weapon carries in its own local rotation (see where it
     * is parented in `_build`), so the BORE lands on the aim rather than the
     * hand.
     */
    const hand = rig.get('handR');
    if (hand && hand.obj.parent) {
      const f = _v5.copy(aim).applyAxisAngle(right, WEAPON_PITCH).normalize();
      const rr = _v6.crossVectors(UP, f).normalize();
      if (rr.lengthSq() < 1e-6) rr.copy(right);
      const uu = _v7.crossVectors(f, rr).normalize();
      _m1.makeBasis(rr, uu, f);
      _q1.setFromRotationMatrix(_m1);
      hand.obj.parent.getWorldQuaternion(_q2);
      hand.obj.quaternion.copy(_q2.invert()).multiply(_q1);
    }
    rig.updateMatrices();
  }

  _poseSaber(dt, ctx, chest, fwd, right) {
    const rig = this.rig;
    const S = this.A.scale;

    // the duel brain owns where the guard wants to be
    const guard = this.duel.guardDir;
    const fast = this.duel.phase === 'strike';

    // Guard space is −Z forward; `facing` is a +Z-forward yaw. guardQuat owns
    // the half turn between them — see the note on it in Duel.js. With a bare
    // yaw here the hands sat BEHIND the body and the blade swung backwards,
    // which is why no duellist had ever hit anything.
    guardQuat(this.facing, this.duel.spin, _q1);
    const dirWorld = _v5.copy(guard).applyQuaternion(_q1).normalize();
    const reach = 0.34 + (this.duel.attack?.reach ?? 0);
    const handTarget = _v6.copy(chest).addScaledVector(dirWorld, reach * S).addScaledVector(UP, -0.08 * S);
    const guardPoint = _v1.copy(chest).addScaledVector(dirWorld, (reach + 0.61) * S);

    if (!this._saberHandInit) { this.saberHand.copy(handTarget); this._saberHandInit = true; }
    dampVec(this.saberHand, handTarget, fast ? 30 : 12, dt);

    _v2.subVectors(guardPoint, this.saberHand).normalize();
    aimY(_v2, null, _q2);
    this.saberQuat.slerp(_q2, clamp(dt * (fast ? 26 : 10), 0, 1));

    this.saber.setHiltPose(this.saberHand, this.saberQuat);
    this.saber.update(dt, ctx.time, this.velocity);
    // HERE, and not in _meleeBrain, because the blade's prev→cur sweep only
    // exists once it has been posed: think() runs before pose(), so a hit test
    // up there would be reading where the blade was LAST frame.
    this._saberStrike(ctx);
    // set() issues nine AudioParam automations and move() three more, per hum,
    // per frame. Twenty duellists at 60fps is 14,400 events/second queued onto
    // parameter timelines — so distant blades update at a coarser cadence.
    if (this.hum && (this.lod === 0 || (this._humTick = (this._humTick | 0) + 1) % 4 === 0)) {
      this.hum.set(this.saber.swingSpeed, this.saber.contactStrain);
      this.hum.move(this.saber.pointAt(0.5, _v3));
    }

    // arms follow the hilt, exactly like the player's do
    const poleR = _v3.copy(chest).addScaledVector(right, 0.8 * S).addScaledVector(UP, -0.75 * S);
    rig.solveIK('armR', 'foreR', this.saberHand, poleR);
    const poleL = _v3.copy(chest).addScaledVector(right, -0.7 * S).addScaledVector(UP, -0.8 * S);
    if (this.offSaber) this._poseOffhand(dt, ctx, poleL, fast, S);
    else rig.solveIK('armL', 'foreL', _v2.copy(this.saberHand).addScaledVector(right, -0.06 * S).addScaledVector(UP, -0.06 * S), poleL);
    rig.updateMatrices();

    // close duellists get simulated robes; distant ones do not need them
    if (this.cloak) {
      if (!this.clothOn) {
        this.cloak.setVisible(false); this.skirt?.setVisible(false);
        this._clothWasOn = false;
      } else {
        /* Coming back inside the cut, the garment holds the pose it had when it
         * left — which was a different place on the map and, after a long chase,
         * a different facing. Laying it out again under its live anchors costs
         * one frame's reset and is the difference between a robe settling and a
         * robe snapping across the body. */
        if (this._clothWasOn === false) {
          if (this.skirt?.initialised) this.skirt.reset();
          if (this.cloak.initialised) this.cloak.reset();
        }
        this._clothWasOn = true;
        _v3.copy(this.velocity).multiplyScalar(-0.8).setY(0);
        // skirt first: the cape's proxy is the skirt's own particles
        if (this.skirt) {
          this.skirt.setVisible(true);
          this.skirt.update(dt, this.skirt.refreshColliders(), _v3);
        }
        this.cloak.setVisible(true);
        this.cloak.update(dt, this.cloak.refreshColliders(), _v3);
      }
    }
  }

  /**
   * The off hand, when it is holding a blade rather than steadying one.
   *
   * The guard direction is MIRRORED across the fighter's centre line and lagged
   * behind the main blade, which is what makes two blades read as two blades: a
   * pair that tracked the same target with the same damping would look like one
   * weapon drawn twice. The lag is also honest about the timing — the off blade
   * really does arrive after the main one, which is what `_offhandStrike` hits
   * on.
   */
  _poseOffhand(dt, ctx, poleL, fast, S) {
    const rig = this.rig;
    const arm = rig.get('armL');
    if (this.offDisarmed || !arm || arm.severed) {
      rig.solveIK('armL', 'foreL', _o1.copy(this.saberHand).addScaledVector(UP, -0.06 * S), poleL);
      return;
    }
    // Its OWN temporaries, re-read from the rig. The chest and right-axis
    // vectors _poseSaber hands round are module scratch that the pole targets
    // above have already written over by the time this runs; borrowing them
    // would make the second blade's guard a function of whatever happened to be
    // left in _v1.
    const chest = rig.worldPos('chest', _o1);
    const fwd = _o2.set(Math.sin(this.facing), 0, Math.cos(this.facing));
    const right = _o3.set(fwd.z, 0, -fwd.x);
    guardQuat(this.facing, this.duel.spin, _oq);
    const dir = _o4.copy(this.duel.guardDir).applyQuaternion(_oq).normalize();

    /**
     * THE SECOND BEAT IS A SWING, not a guard that follows the first one.
     *
     * This used to mirror `duel.guardDir` and nothing else, so the off blade
     * TRACKED the guard for the whole strike and never swept an arc through
     * anything. That is why `_offhandStrike` was a proximity test: a blade that
     * does not move cannot be given a swept hit, and the two defects held each
     * other up — the strike was a distance check because the pose was a guard,
     * and the pose could stay a guard because nothing swept it.
     *
     * Now the back half of the strike drives the off blade along the attack's
     * OWN arc, mirrored: `from` to `to` over `lag`, which is zero until the
     * main blade is a third of the way through and one at the end. So the two
     * blades arrive on two beats, which is what the header above
     * `_offhandStrike` has always claimed, and the arc is a real sweep that
     * `segmentSegment` can be run against.
     */
    let lag = 0;
    const atk = this.duel.attack;
    if (this.duel.phase === 'strike' && atk) {
      const len = this.duel._strikeLen || 0.2;
      const u = clamp(1 - this.duel.timer / len, 0, 1);
      lag = clamp((u - 0.35) / 0.65, 0, 1);
      if (lag > 0) {
        _o7.copy(atk.from).lerp(atk.to, lag).applyQuaternion(_oq).normalize();
        dir.lerp(_o7, lag).normalize();
      }
    }

    // mirror the guard about the body's own right axis, then drop it a little:
    // a second blade is carried low, ready to come up under the first.
    const mirrored = dir.addScaledVector(right, -2 * dir.dot(right)).addScaledVector(UP, -0.28 * (1 - lag)).normalize();
    // …and it DRIVES on the second beat. A blade held at guard reach cannot
    // touch a body at duelling distance; the extension is what makes the swing
    // a swing rather than a pose that happens to be nearer.
    const reach = 0.32 + (atk?.reach ?? 0) * 0.6 + 0.62 * lag;
    const handTarget = _o5.copy(chest).addScaledVector(mirrored, reach * S).addScaledVector(UP, -0.14 * S);
    const guardPoint = _o6.copy(chest).addScaledVector(mirrored, (reach + 0.58) * S);

    if (!this._offHandInit) { this.offHand.copy(handTarget); this._offHandInit = true; }
    dampVec(this.offHand, handTarget, fast ? 18 : 8, dt);
    guardPoint.sub(this.offHand).normalize();
    aimY(guardPoint, null, _oq);
    this.offQuat.slerp(_oq, clamp(dt * (fast ? 16 : 7), 0, 1));
    this.offSaber.setHiltPose(this.offHand, this.offQuat);
    this.offSaber.update(dt, ctx.time, this.velocity);
    rig.solveIK('armL', 'foreL', this.offHand, poleL);
  }

  /**
   * THE STANCE THIS BODY ACTUALLY STANDS IN.
   *
   * `nLegs` was `this.A.custom === 'beast' ? 6 : 4`, which is HANDOFF §2.4's
   * defect exactly — a rule restated away from the thing that owns it — and it
   * had been wrong the whole time: the reek, the nexu, the rancor and the
   * gundark all declare `custom: 'beast'` and all four have FOUR legs, so the
   * solver ran a six-leg layout over them. `femur4`/`femur5` came back
   * undefined and were skipped, which hid the bug, but the row arithmetic did
   * not: `(row - (nLegs / 2 - 1) / 2)` with nLegs 6 puts the front pair's foot
   * target at z = 0 and the rear pair's at −0.62·S, so every quadruped in the
   * game planted both pairs of feet BEHIND its own hips, bunched under the
   * middle. A sphere with some legs under it.
   *
   * Nothing is restated now. The leg count is counted off the rig, and
   * everything else — where each foot plants, how high the ankle rides, which
   * way the joint bends, stride, lift, hip height — comes off the `stance` the
   * builder publishes with the body it built (see CREATURE_PLANS in
   * src/game/Bodies.js). The fallback below is the shipped walker's own
   * numbers, unchanged to the digit, because the spider walker is the one body
   * that reaches this function without a plan.
   */
  _stance() {
    if (this._stanceCache) return this._stanceCache;
    const S = this.A.scale;
    const st = this.built?.stance;
    if (st) return (this._stanceCache = st);
    let n = 0;
    while (this.rig?.get(`femur${n}`)) n++;
    const limbs = [];
    for (let i = 0; i < n; i++) {
      const side = i % 2 === 0 ? 1 : -1;
      const row = Math.floor(i / 2);
      limbs.push({
        arm: false, x: side * 1.35 * S, z: (row - (n / 2 - 1) / 2) * 0.62 * S,
        // 0: the walker's ankle target has always been the floor itself.
        ankle: 0, toe: 0.30, pole: [side * 1.4 * S, 1.5 * S, 0], hand: null,
      });
    }
    return (this._stanceCache = {
      hipHeight: 1.6 * S, step: 1.0 * S, lift: 0.42 * S, rear: 0.48 * S, bob: 0.05 * S, limbs,
    });
  }

  _poseWalker(dt, ctx) {
    const rig = this.rig;
    const S = this.A.scale;
    const ST = this._stance();
    const speed = Math.hypot(this.velocity.x, this.velocity.z);
    this.walkPhase = (this.walkPhase + dt * clamp(speed / (1.1 * S), 0.1, 2.4)) % 1;

    /**
     * THE BODY READS THE ATTACK, which it did not before.
     *
     * This function never looked at `this.state`. It was a walk cycle and a
     * head track, so a sweep, a lunge and a charge were all the same animal
     * walking — the only cue any of them had was a sound, and the charge's
     * floating label. A player cannot answer a wind-up they cannot see, and
     * the beast is the one enemy whose whole answer is footwork.
     *
     * `rear` is the rise-and-drop the attack states drive: the chest lifts and
     * pitches back through the wind-up, then throws forward through the strike.
     * It is one number and it moves the hips, so every leg follows it through
     * the IK below without a second pose path. Timings are the same ones the
     * hit windows use, so the throw and the claw land together.
     */
    let rise = 0, pitch = 0;
    const st = this.stateTime || 0;
    /**
     * …AND THE CURVE COMES OFF THE SAME TABLE THE ATTACK DOES.
     *
     * This was three hand-written curves, one per state, sitting fifty lines
     * away from the three hand-written hit windows they had to agree with — so
     * a fourth attack meant a fourth branch here, and a wind-up that silently
     * disagreed with its own claw was one edit away at all times. `BEAST_MOVES`
     * carries both, so a move cannot be added to the brain without a body to
     * read it on.
     *
     * The formula reproduces all three shipped curves EXACTLY: a quarter-sine
     * ramp to the peak over `up`, then a linear fall over `fall` (or straight
     * to rest when `fall` is 0, which is what the lunge did), with the chest
     * pitch a fixed multiple of the rise. The charge's old `max(0, 0.7 - (st -
     * 0.65) * 2)` is 0.7 x max(0, 1 - (st - 0.65) / 0.35), which is this with
     * fall = 0.35.
     */
    const P = BEAST_MOVES[this.state]?.pose;
    if (P) {
      rise = st < P.up
        ? P.rise * Math.sin((st / P.up) * Math.PI * 0.5)
        : (P.fall > 0 ? P.rise * Math.max(0, 1 - (st - P.up) / P.fall) : 0);
      pitch = P.pitch * rise;
    } else if (this.state === 'winded') {
      // …and being winded reads as being winded: the head drops to the floor.
      rise = -0.5; pitch = 0.5;
    }
    /**
     * A PLANTED GUN SITS DOWN ON ITS LEGS, and this one line is the entire
     * visible half of `plant`.
     *
     * `planted` runs 0 → 1 in `_rangedBrain` and is read here and nowhere else.
     * A machine settling before it fires drops onto its supports — the legs
     * take the recoil rather than the hip actuators — and a machine that gets
     * up to walk rises again. Without it a SPHA holding station through a
     * two-and-a-half-second charge is a SPHA standing still, which is
     * indistinguishable at a hundred metres from a SPHA that has lost its
     * target.
     *
     * It rides on `rear`, which is metres of hip travel per unit of rise and is
     * already the channel every wind-up in this function uses, so a body that
     * plants and a body that rears use one code path and cannot disagree about
     * where the hips are. Negative, because settling is the opposite of rearing.
     */
    if (this.planted) rise -= this.planted;
    /* The hip height and the rear-up are the ANIMAL's, not a constant times
     * its scale. A reek stands at 0.88 of scale and a rancor at 1.15, where
     * both used to stand at 1.5; `rear` is metres of hip travel per unit of
     * rise, so the low animals still telegraph as far as the tall ones
     * instead of in proportion to how short they are. */
    const bodyH = ST.hipHeight;
    const hips = rig.hipsBone.obj;
    const gh = ctx.terrain ? ctx.terrain.height(this.position.x, this.position.z) : 0;
    hips.position.set(this.position.x,
      Math.max(this.position.y, gh) + bodyH + ST.rear * rise + Math.sin(this.walkPhase * TAU * 2) * ST.bob,
      this.position.z);
    hips.quaternion.setFromAxisAngle(UP, this.facing);
    if (pitch) hips.quaternion.multiply(_q1.setFromAxisAngle(RIGHT, pitch));
    rig.updateMatrices();

    if (this.lod > 1) return;
    const fwd = _v1.set(Math.sin(this.facing), 0, Math.cos(this.facing));
    const right = _v2.set(fwd.z, 0, -fwd.x);

    for (let i = 0; i < ST.limbs.length; i++) {
      const femur = rig.get(`femur${i}`);
      if (!femur || femur.severed) continue;
      const L = ST.limbs[i];

      /* AN ARM IS NOT A LEG, and until there were arms nothing here knew the
       * difference. The rancor's and the gundark's forelimbs are mounted on
       * the trunk and never touch the ground: they hang at a home point that
       * swings against the gait, and an attack's `rise` throws them forward
       * and down — so the wind-up the brain commits to is on the limb that
       * makes the blow as well as on the chest. */
      if (L.arm && L.hand) {
        const swing = Math.sin((this.walkPhase + (i % 2) * 0.5) * TAU) * 0.16 * S;
        const hand = _v3.copy(this.position)
          .addScaledVector(right, L.hand[0])
          .addScaledVector(fwd, L.hand[2] + swing - rise * 0.55 * S)
          .setY(Math.max(this.position.y, gh) + bodyH + L.hand[1] + rise * 0.42 * S);
        const pole = _v4.copy(hand).addScaledVector(right, L.pole[0]).addScaledVector(fwd, L.pole[2])
          .setY(hand.y + L.pole[1]);
        rig.solveIK(`femur${i}`, `tibia${i}`, hand, pole);
        if (rig.get(`tarsus${i}`)) {
          _v5.copy(fwd).multiplyScalar(0.55).setY(-0.8).normalize();
          rig.aimBoneWorld(`tarsus${i}`, _v5, null);
        }
        continue;
      }

      const ph = (this.walkPhase + (i % 2) * 0.5 + Math.floor(i / 2) * 0.18) % 1;
      const stance = ph < 0.5;
      const t = stance ? 0 : (ph - 0.5) * 2;

      const foot = _v3.copy(this.position)
        .addScaledVector(right, L.x)
        .addScaledVector(fwd, L.z + (stance ? -0.3 * ST.step : lerp(-0.3, 0.7, t) * ST.step));
      // …plus the ankle offset, so the toe lands on the floor rather than the
      // ankle landing on it and the whole foot going under. See `stanceOf`.
      foot.y = (ctx.terrain ? ctx.terrain.height(foot.x, foot.z) : 0)
        + L.ankle + (stance ? 0 : Math.sin(t * Math.PI) * ST.lift);

      const knee = _v4.copy(foot).addScaledVector(right, L.pole[0]).addScaledVector(fwd, L.pole[2])
        .setY(foot.y + L.pole[1]);
      rig.solveIK(`femur${i}`, `tibia${i}`, foot, knee);
      const tarsus = rig.get(`tarsus${i}`);
      if (tarsus) {
        _v5.copy(fwd).multiplyScalar(L.toe).setY(-(1 - L.toe)).normalize();
        rig.aimBoneWorld(`tarsus${i}`, _v5, null);
      }
    }
    // head tracks the target — a yaw/pitch, since the chassis geometry is
    // authored facing +Z rather than along the bone axis
    const headBone = rig.get('head');
    if (this.target && headBone && !headBone.severed) {
      _v3.subVectors(aimAt(this.target, _aim), rig.worldPos('head', _v4));
      /**
       * `atan2(x, z) - facing` IS the local bearing. The `- Math.PI` that used
       * to close this line put it half a turn out, and the symptom was hidden
       * by the clamp two lines down rather than by anything looking wrong:
       * wrapped into range, a target dead ahead asked for ±π, the ±0.7 clamp
       * saturated, and the turret sat 40° off — flipping sign as the target
       * crossed the centreline. Measured on the shipped Spider Walker with
       * tools/_vehicle.mjs: 43.8° of error, which is the clamp, not the aim.
       *
       * It never affected damage — `_shoot` aims from the target, not the
       * muzzle — so nothing that measured hits could see it. It is a five-metre
       * gun barrel pointing somewhere the machine is not shooting, and it went
       * unnoticed until an AT-TE gave it a barrel long enough to read at range.
       */
      const localYaw = Math.atan2(_v3.x, _v3.z) - this.facing;
      headBone.obj.quaternion.copy(headBone.restQuat).multiply(
        _q1.setFromEuler(new THREE.Euler(clamp(Math.atan2(_v3.y, Math.hypot(_v3.x, _v3.z)), -0.5, 0.5),
          clamp(((localYaw + Math.PI * 3) % (Math.PI * 2)) - Math.PI, -0.7, 0.7), 0, 'YXZ')));
    }
    rig.updateMatrices();
  }

  _poseDroideka(dt, ctx) {
    if (!this.group) return;
    const b = this.built;
    const gh = ctx.terrain ? ctx.terrain.height(this.position.x, this.position.z) : 0;
    this.group.position.set(this.position.x, Math.max(this.position.y, gh), this.position.z);
    this.group.quaternion.setFromAxisAngle(UP, this.facing);

    const speed = Math.hypot(this.velocity.x, this.velocity.z);
    this.walkPhase = (this.walkPhase + dt * clamp(speed / 1.2, 0.05, 3)) % 1;
    b.legs.forEach((leg, i) => {
      if (leg.gone) return;
      const ph = (this.walkPhase + i / 3) % 1;
      leg.leg.rotation.x = Math.sin(ph * TAU) * 0.22;
      leg.lower.rotation.x = -0.2 + Math.cos(ph * TAU) * 0.2;
    });
    if (this.target) {
      _v1.subVectors(aimAt(this.target, _aim), b.headG.getWorldPosition(_v2));
      const pitch = Math.atan2(_v1.y, Math.hypot(_v1.x, _v1.z));
      b.headG.rotation.x = clamp(-pitch, -0.5, 0.5);
      for (const arm of b.arms) arm.arm.rotation.x = clamp(-pitch * 0.6, -0.5, 0.5);
    }
    if (b.shield.visible) {
      b.shieldMat.uniforms.uTime.value += dt;
      const u = b.shieldMat.uniforms.uPower;
      u.value = damp(u.value, clamp(this.shieldHp / this.shieldMax, 0, 1) * 0.85, 4, dt);
    }
  }

  /**
   * ── TERMINAL, AND IT HAS TO SAY SO ────────────────────────────────────
   *
   * `this.disposed` is not decoration and it is not new: `Corpses.update`
   * guards every entry on `!e.disposed`, and `World.restartWave`'s own note
   * says so in as many words — "The ledger has an escape hatch for exactly
   * this and it was dead code: `Corpses.update` guards on `e.disposed`, and
   * `Enemy.dispose` never wrote it — only `Player` does. Both halves are
   * fixed, because either alone leaves the other reader wrong." **ONE HALF
   * WAS FIXED.** `grep -rn '\.disposed' src/` found the reader in Corpses.js,
   * the writer in Player.js, and nothing here.
   *
   * What the missing line costs, and it is not the wave reset the note was
   * about — it is ORDINARY PLAY. `update` returns `this.dying < 40`, so
   * `World.update` disposes every corpse forty seconds after it fell and
   * splices it out of `world.enemies`. The ledger holds it regardless: `dead`
   * is still true and `disposed` was undefined, so the entry is immortal.
   * Measured on colosseum/waves, one scripted Jedi, 900 game-seconds:
   *
   *     t=120s   20 corpses,  7 ghosts
   *     t=240s   20 corpses, 17 ghosts
   *     t=420s   20 corpses, 20 GHOSTS   — and it never moves again
   *
   * Seven minutes in, EVERY slot of a twenty-corpse budget is a body that has
   * already been torn down. `live.length > this.budget` is then false forever,
   * so nothing sinks, and each new corpse arrives into a ledger that is
   * already full: the field a player fights on keeps no dead at all, which is
   * the exact complaint the budget was built to answer ("bodies vanishing
   * under your blade" — see Corpses.js's own note on RECENCY). Twenty whole
   * Enemy graphs — rig, actor, bodies map, saber, garments — are retained
   * behind them until the level unloads, and every one is `worth()`-ranked
   * against real corpses on every frame.
   *
   * IDEMPOTENT, TOO, because the sink path ends in `e.dispose?.()` and a ghost
   * that got there had already been disposed once. Everything below either
   * nulls what it frees or is safe twice, but "safe by inspection at eleven
   * call sites" is not a contract — this is.
   */
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    /* …and the grind ledger, which is keyed on this body's id and nothing
     * else. `BladeContactSolver` holds `progress`, `touched` and `cooldown`
     * for every capsule a blade has ever grazed, and only a COMPLETED cut
     * clears them (World._applyBladeEvent) — so every bone the player started
     * on and did not finish is a key that outlives the body. `Waves`'s room
     * cull already calls this on a body it retires; a body that dies does not
     * go through that path. */
    this.world?.bladeSolver?.clearTarget?.(this.id);
    /* …and the cohort's instance slot, for a body torn down WITHOUT dying —
     * `World.restartWave` and `Waves`'s room cull both dispose living bodies,
     * and neither goes through `die()`. `leave` is a no-op on a body that was
     * never in one. */
    if (this._l3) this.world?.cohorts?.leave?.(this);
    // Modifier fittings first. The bone-parented ones (plates, core, standard)
    // are freed by the rig's own traverse — they are children of bones — so
    // only the scene-parented ones and the cloned materials are ours to undo.
    if (this.shieldMesh) {
      this.world.scene.remove(this.shieldMesh);
      this.shieldMesh.geometry.dispose();
      this.shieldMat?.dispose();
      this.shieldMesh = null;
    }
    if (this.rallyRing) {
      this.world.scene.remove(this.rallyRing);
      this.rallyRing.geometry.dispose();
      this.rallyRing.material.dispose();
      this.rallyRing = null;
    }
    if (this.offSaber) { this.offSaber.dispose(); this.offSaber = null; }
    if (this._modMaterials) { for (const m of this._modMaterials) m.dispose(); this._modMaterials = null; }
    if (this.saber) this.saber.dispose();
    if (this.hum) this.hum.dispose();
    // Belt and braces on the jetpack loop: `die()` retires it, and a body torn
    // down without dying (a level unload, a wave reset) never went through
    // `die()`. Idempotent — `jet(pos, 0, id)` on an id with no voice is a Map
    // miss and a return.
    audio.jet?.(this.position, 0, this.id);
    if (this.cloak) this.cloak.dispose();
    if (this.skirt) this.skirt.dispose();
    if (this.telegraphArc) this.telegraphArc.dispose();
    if (this.laser) { this.world.scene.remove(this.laser); this.laser.geometry.dispose(); this.laser.material.dispose(); }
    if (this.actor) this.actor.dispose();
    else if (this.rig) { this.world.scene.remove(this.rig.root); this.rig.dispose(); }
    if (this.group) this.world.scene.remove(this.group);
    if (!this.bodyRemoved) this.world.physics.remove(this.body);
  }
}

/**
 * ══ HOW LETHAL LOSING A BONE IS ═══════════════════════════════════════════
 *
 * `takeCut` charges `maxHp * vital * 1.15` for a severed limb — a SHARE OF
 * MAXIMUM HEALTH, not a fixed wound — so how many pieces a body can lose is a
 * property of these six numbers and NOTHING ELSE. Its health does not enter
 * into it. That sentence is the whole reason this is derived rather than typed.
 *
 * ── WHAT WAS HERE, AND WHAT IT COST ───────────────────────────────────────
 *
 * A `VITAL` object of nineteen HUMANOID bone names, read as `VITAL[b.name] ??
 * 0.4`. The roster is 31 bodies and 54 distinct bone names; 34 of them — every
 * bone a quadruped, a hexapod, a tank or a hailfire droid has — hit the
 * default. Measured on the shipped table:
 *
 *   a Rancor's TOE       0.400, the same as its hip, 46% of a 2200 hp animal
 *   three of its four toes killed it, and it has nothing else in blade reach
 *   acklay, reek, nexu, gundark and rancor ALL died in 1.28 s through a toe
 *   once the guard was open — five bodies from 420 to 2200 hp, one number
 *
 * A hand-written table beside a GENERATED skeleton is HANDOFF §2.3's signature
 * defect, and a missing entry answered with a plausible default is the close
 * relative it names in the same paragraph. Both, in one line, for the roster's
 * whole non-humanoid half.
 *
 * ── WHAT IT IS NOW ────────────────────────────────────────────────────────
 *
 * The bone says what it IS (`Rig.BONE_ROLES`, declared in the skeleton beside
 * the bone's own length), and the price is that role against the body's own
 * shape. Six numbers, and every one of them is a statement about anatomy:
 *
 *   core 1.00  cutting the trunk is cutting the body in two.
 *   neck 1.00  severing the neck IS decapitation.
 *   head 0.95  under 1.0 only so that `takeCut`'s "already under 55%" clause
 *              has something to be about; still over the 0.9 that makes a pass
 *              fight-ending, which is load-bearing in `_fightEnding`.
 *   hull 1.00  SHARED between the segments: an AT-TE's prow and stern are half
 *              each, so taking both ends off kills it and taking one wounds it.
 *   leg  1.10  the whole leg SET is worth 1.10 bodies, so a biped's thigh is
 *              0.55 — which is the number the old table had, arrived at from
 *              the other end.
 *   arm  1.00  likewise: a humanoid's clavicle comes out at 0.50, the old
 *              table's number, and the rest of the chain follows from the
 *              bones instead of being typed under it.
 *
 * Two divisors turn those into a bone's price and both are read off the rig:
 *
 *   ÷ roleOf     how many of that limb the body HAS. This is the part a name
 *                table can never express — `femur0` on a six-legged acklay and
 *                `femur0` on a four-legged reek are spelt identically and are
 *                not the same fraction of an animal. One of six legs is 0.18
 *                where one of two is 0.55.
 *   × roleShare  how much of its own limb comes off with it, in bone length.
 *                A cut at the thigh takes the shin and the foot; a cut at the
 *                foot takes a foot. So core > proximal > distal > extremity
 *                holds on every body without anyone maintaining an order.
 *
 * Measured against the nineteen numbers it replaces, on the human frame:
 * thigh 0.55 → 0.55, clav 0.50 → 0.50, shin 0.30 → 0.32, fore 0.22 → 0.23,
 * arm 0.35 → 0.42, hand 0.10 → 0.06, foot 0.12 → 0.10. It lands on the
 * considered numbers, which is the argument that the derivation is the right
 * one; where it differs it differs because the bones say so.
 *
 * And a Rancor's toe is 0.101 against its hip's 0.55, so it takes nine toes to
 * kill an animal that has four.
 *
 * ── WHAT THIS DOES NOT REACH, AND IT IS THE BIGGER HALF OF THE TOE ────────
 *
 * A sever is not what a pass costs. `World._applyBladeEvent` pays the grind
 * that LEADS UP to it at `(dWork / need) * maxHp * GRIND_LETHALITY`, and
 * `need` is the total work the capsule takes — so completing a sever anywhere
 * on a body has already dealt **0.55 of its maximum health**, the same 0.55
 * for a toe as for a torso. Measured, one completed pass:
 *
 *   Rancor toe   grind 55.0% + sever 11.6% = 66.6% of a 2200 hp animal
 *   Acklay toe   grind 55.0% + sever  4.2% = 59.2%
 *   AT-TE toe    grind 55.0% + sever  2.8% = 57.8%
 *
 * So TWO completed passes still kill anything, and the second half of that sum
 * is the only half this file decides. `GRIND_LETHALITY`'s own note argues the
 * share correctly for a body — "what stops a failed pass from being free" —
 * and never asks whether a toe is a body. It is the same shape as the defect
 * above, one module to the side, and it is not fixed: it lives in World.js.
 */
/**
 * What TAKING the bone costs, as a multiple of what the bone is worth.
 *
 * A completed pass bills twice — `World._applyBladeEvent` pays the grind that
 * leads up to the sever at `GRIND_LETHALITY × severance`, and `takeCut` pays
 * this for the sever itself. Over 1.0 because parting a limb is meant to be
 * worth more than the work of getting there.
 *
 * Named rather than left as a literal because it is now READ from outside: a
 * check that wanted to know how many passes a body survives had to have this
 * number, and the choice was to export it or to let the check keep a second
 * copy — which is the hand-maintained twin that this whole area of the code
 * exists to be rid of.
 */
export const SEVER_LETHALITY = 1.15;

const SEVERANCE = {
  core: { axial: 1.00 },
  neck: { axial: 1.00 },
  head: { axial: 0.95 },
  hull: { budget: 1.00 },
  leg: { budget: 1.10 },
  arm: { budget: 1.00 },
  /**
   * A WING, AND IT IS PRICED UNDER AN ARM ON PURPOSE.
   *
   * `budget` is what the whole PAIR is worth, divided by how many of them the
   * body has, so 0.80 says two wings together are four fifths of what two legs
   * are — a wing is a spar and a membrane, not a load path. What makes taking
   * one worth more than the number is that it is not only damage: the body it
   * belongs to cannot fly on one, and everything a flyer is good for is in the
   * air. See src/game/Flight.js, which owns that consequence; this table owns
   * only the health.
   *
   * A role with no price throws (see `severance`), which is why this line was
   * written on the same day the first winged body was, and not after it.
   */
  wing: { budget: 0.80 },
};

/**
 * The price of losing one bone, and the ONLY way to get one.
 *
 * IT THROWS, and that is the feature. The bug this replaces was not the numbers
 * in a table, it was the `?? 0.4` beneath them: a body plan nobody had thought
 * about got an answer that looked like an answer, and it looked like one for
 * the entire life of the project. A role with no price must stop the game on
 * the first body that carries it, loudly, with the role in the message.
 *
 * @param role   one of Rig.BONE_ROLES
 * @param share  how much of its own limb comes off with it — `bone.roleShare`
 * @param of     how many of that limb the body has — `bone.roleOf`
 */
export function severance(role, share = 1, of = 1) {
  const S = SEVERANCE[role];
  if (!S) {
    throw new Error(`Enemy.severance: bone role ${JSON.stringify(role)} has no price. `
      + `Priced roles are ${Object.keys(SEVERANCE).join(', ')}. `
      + 'A role with no price is not 0.4 and is not the average of the others; '
      + 'the whole point of this function is that it refuses to guess.');
  }
  if (S.axial !== undefined) return S.axial;
  return S.budget * share / Math.max(1, of);
}

/** The same, for a bone that has been through `Rig._measureLimbs`. */
export function severanceOf(bone) { return severance(bone.role, bone.roleShare, bone.roleOf); }

/** The roles that have a price, so a check can hold it against BONE_ROLES. */
export const PRICED_ROLES = Object.keys(SEVERANCE);
/**
 * …and which of them are AXIAL — priced flat, because reaching the trunk or the
 * head ends it wherever along them you reach.
 *
 * Derived from the table rather than listed beside it, for the reason the whole
 * of this section exists: `tools/checks/severance.mjs` needs to know which roles
 * are a limb and which are the body, and a second list spelling `core, neck,
 * head` would be a hand-maintained twin of a generated thing inside the very
 * check written to keep that shape out.
 */
export const AXIAL_ROLES = PRICED_ROLES.filter((r) => SEVERANCE[r].axial !== undefined);
