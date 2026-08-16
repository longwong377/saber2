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
import { buildB1, buildB2, buildTrooper, buildAcolyte, buildDroideka, buildWalker, buildBeast, buildBlaster, plateGeo,
  buildJedi, SPECIES, HAIR_STYLES, BEARD_STYLES, ROBE_COLORS } from './Bodies.js';
import { Saber } from './Saber.js';
import { dropSaber } from './Dropped.js';
import { DuelBrain, Telegraph, FORMS, FORM_KEYS, TIER, ATTACKS, ATTACK_KEYS,
  DUEL_PHASES, guardQuat } from './Duel.js';
import { buildRemote } from './Dojo.js';
import { attachCloak, attachSkirt } from './Cloth.js';
import { LAYER, Body, capsuleSpheres, capsule } from '../physics/RapierWorld.js';
import { supportHeight, STEP_UP, GROUND_SNAP } from '../physics/Support.js';
import { TOUGHNESS, bladesTouching } from './Combat.js';
import { segmentSegment } from '../physics/Physics.js';
import { BOLT_COLORS } from './Bolts.js';
import { clamp, lerp, damp, smoothstep, makeRng, TAU, dampVec } from '../engine/MathUtil.js';
import { POWER_COST } from './Powers.js';
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
const _q1 = new THREE.Quaternion(), _q2 = new THREE.Quaternion();
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
 *   charge     100%    100%     100%     100%     nothing: it commits and hits
 *   SLAM       100%    100%     100%       0%     ONLY distance
 *   POUNCE     100%      0%      95%       0%     only a LATE break
 *
 * — which is the property the note asks for, stated as a table: a player who
 * has learned to circle a claw at knife range is caught by every slam, and a
 * player who has learned to break early on a telegraph is caught by every
 * pounce. Two creatures on the sand at once cannot be answered with one habit.
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
  charge: {
    unlock: 3, aim: 'drive', aimUntil: 0.65, plant: 0.65,
    drive: [0.65, 1.9, 30], dust: true, hit: [0.65, 1.9], done: 1.9,
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
   */
  slam: {
    unlock: 2, aim: 'self', plant: 0.95, hit: [0.95, 1.15], done: 1.7,
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
  gore: {
    unlock: 1, aim: 'drive', aimUntil: 0.5, plant: 0.5,
    drive: [0.5, 1.5, 36], dust: true, hit: [0.6, 1.5], done: 1.6,
    reach: 0.9, damage: 1.35, lift: 1.0, roar: 1.0, call: 'GORE', callColor: '#ff8a3a',
    // head DOWN and body low through the wind-up, then it runs
    pose: { rise: -0.70, up: 0.50, fall: 0.45, pitch: -0.72 },
  },
  toss: {
    unlock: 2, aim: 'windup', plant: 0.35, hit: [0.70, 1.00], done: 1.35,
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
    unlock: 2, aim: 'windup', plant: 0.45, hit: [0.68, 0.92], done: 1.20,
    reach: 0.80, damage: 1.25, lift: 0.25, pull: true, shake: 0.9, roar: 0.8,
    call: 'SNATCH', callColor: '#ff6a52',
    // ducks, then throws the head forward — the mirror of the toss
    pose: { rise: -0.95, up: 0.45, fall: 0.22, pitch: 0.34 },
  },

  /**
   * THE POUNCE — twelve metres, off the ground, and it commits at the LAUNCH.
   *
   * The charge already answers a runner, but it answers by being unanswerable:
   * it re-aims and resolves on the same frame, which measured 100% against
   * every evasion the harness has. The pounce commits its landing point at
   * 0.55 s and does not arrive until 0.95, so there IS a window — 0.4 s of it —
   * and it is at the END of the telegraph rather than the beginning. A player
   * who breaks on the first frame of the wind-up has been standing still again
   * by the time this lands.
   */
  pounce: {
    unlock: 1, aim: 'launch', aimUntil: 0.55, plant: 0.55,
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
    armored: true, hipHeight: 1.1,
  },
  trooper: {
    label: 'Clone Trooper', build: buildTrooper, scale: 1.0, hp: 46, mass: 78,
    speed: 4.1, toughness: TOUGHNESS.plastoid, ranged: true, weapon: 'dc15',
    fireRate: 1.35, burst: 3, burstGap: 0.11, spread: 0.045, damage: 12,
    preferred: [9, 19], boltColor: BOLT_COLORS.blue, score: 180, threat: 2,
    grenades: true, hipHeight: 0.95,
  },
  sniper: {
    label: 'Marksman', build: buildTrooper, scale: 1.0, hp: 38, mass: 76,
    speed: 3.6, toughness: TOUGHNESS.plastoid, ranged: true, weapon: 'dc15',
    fireRate: 3.4, burst: 1, spread: 0.004, damage: 34, telegraph: 1.0,
    preferred: [22, 42], boltColor: BOLT_COLORS.gold, score: 320, threat: 3,
    trooperColor: 0x2c3038, accent: 0xff9a20, hipHeight: 0.95,
  },
  acolyte: {
    label: 'Sith Acolyte', build: buildAcolyte, scale: 1.04, hp: 130, mass: 82,
    speed: 5.0, toughness: TOUGHNESS.flesh, melee: true, saber: true,
    saberColor: 4, damage: 26, preferred: [1.6, 3.4], score: 700, threat: 6,
    hipHeight: 0.97,
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
    preferred: [8, 16], boltColor: 0x66ff99, score: 550, threat: 5, shield: true,
  },
  walker: {
    label: 'Spider Walker', build: buildWalker, scale: 2.4, hp: 620, mass: 900,
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
  },

  beast: {
    label: 'Acklay', build: buildBeast, scale: 2.9, hp: 900, mass: 1400,
    speed: 4.6, toughness: TOUGHNESS.flesh, melee: true, custom: 'beast',
    damage: 42, preferred: [2.5, 5], score: 2400, threat: 16, boss: true,
  },
};

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
const RESIST_PER_FORCE = 1.4;
const RESIST_CAP = 0.55;
const RESIST_BEATEN = 0.35;
/** The kinds that are the Force, and are therefore answerable by it. */
const FORCE_KINDS = /^(force|lightning|choke|grip|rend)$/;
/**
 * A shove's speed, priced in the same currency as its damage, so ONE call to
 * `resistForce` answers a whole blow rather than billing its two halves
 * separately out of the same pool.
 */
const IMPULSE_AS_HP = 1.2;

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
const CAST_FLINCH_FLOOR = 8;
const CAST_FLINCH_FRAC = 0.05;

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
const TURNED_CUT = 0.24;
/** Seconds to win one turned pass back, and only while the guard is not beaten. */
const GUARD_REFRESH = 6.0;

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
  lightning: {
    cost: POWER_COST.lightning, cd: 8.5, band: [4.5, 18], want: 'ranged',
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
    allow: (A) => A.ranged && !A.custom && !A.telegraph && !A.training,
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
    this.dying = 0;
    this.grippable = !A.big && !A.boss;
    this.gripped = false;
    this.liftTarget = null;
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
    /** Fight-ending cuts this body can still turn aside. See the note on
     *  GUARD_PER_HP and `_turnCut`; 0 for anything that is not a duellist. */
    this.guardMax = (A.saber && !A.training && !A.inert)
      ? Math.max(1, Math.ceil(A.hp * GUARD_PER_HP)) : 0;
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
      mask: LAYER.WORLD, allowSleep: false, gravityScale: 0,
    });
    this.body.userData.enemy = this;
    world.physics.add(this.body);

    this._caps = [];
    this._capsDirty = true;
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
   */
  _applyLod(lod) {
    if (!this.rig || !this._lodParts) return;
    const showDetail = lod === 0;
    for (const m of this._lodParts) m.visible = showDetail;
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
    const opts = { scale: A.scale };
    if (this.type === 'sniper') { opts.color = A.trooperColor; opts.accent = A.accent; }
    const built = A.build(opts);
    this.built = built;

    if (built.rig) {
      this.rig = built.rig;
      this.world.scene.add(this.rig.root);
      this.actor = new Actor(this.world.scene, this.world.physics, this.rig, {
        mass: A.mass, layer: LAYER.RAGDOLL, bladeColor: 0x57c9ff,
        onSever: (bone, point) => this._onSever(bone, point),
      });
      this.humanoid = !A.custom || A.custom === 'humanoid';
      if (this.humanoid) {
        this.animator = new BipedAnimator(this.rig, { scale: A.scale, hipHeight: A.hipHeight ?? 0.95 });
        this.animator.onFootstep = (p) => {
          if (this.lod > 1) return;
          audio.step(p, this.world.terrain ? this.world.terrain.surfaceAt(p.x, p.z) : 'sand');
          this.world.particles?.sandPuff(p.clone(), 0.16, p.y, this.world.groundColor);
        };
      } else {
        this.walkPhase = rng();
        this.legTargets = [];
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
     *   · `distToTarget` is a 3-D length, so every range test in
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

    // weapon
    if (A.weapon) {
      this.weapon = buildBlaster(A.weapon);
      const hand = this.rig?.get('handR');
      if (hand) { hand.obj.add(this.weapon); this.weapon.position.set(0, 0.06 * A.scale, 0.02); this.weapon.rotation.x = -0.2; }
    }
    if (A.saber) {
      this.saber = new Saber(this.world.scene, {
        colorIndex: A.saberColor ?? 4, bladeLength: 1.12, hiltStyle: A.hilt ?? 'Sentinel',
      });
      this.saber.ignite();
      this.hum = audio.createHum(this.saber.color.getHex());
      this.hum.ignite();
      this.telegraphArc = new Telegraph(this.world.scene);
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
          scale: A.scale, width: 0.34, length: 0.82, cols: 7, rows: 9, flare: 1.0,
          color: robeHex ?? (this.type === 'sparring' ? 0x2c3742 : 0x14151a),
        });
      }
      // The robe below the belt, simulated rather than three lathes welded to
      // the pelvis — see Player._makeCloak. It replaces the rigid meshes, so it
      // costs the character fewer triangles than it saves.
      if (built.robeSkirt && A.simSkirt && this.cloak) {
        this.skirt = attachSkirt(this.world.scene, this.rig, {
          scale: A.scale, rigid: built.robeSkirt,
          // …and the same for the skirt it replaces: the simulated cloth has to
          // come out the colour of the rigid panels it is swapped for, or the
          // body changes colour at LOD range when attachSkirt hands them back.
          color: robeHex ?? (this.type === 'sparring' ? 0x2c3742 : 0x14151a),
          // The belt's two ends take the BELT's material, not the recoloured
          // robe's — the obi they are tied in is still the built one.
          sashMaterial: built.palette.trim,
        });
        this.cloak.outer = this.skirt;
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
   */
  aimPoint(out = new THREE.Vector3()) {
    if (this.rig && !this.actor?.ragdolled) {
      for (const name of ['chest', 'body', 'spine', 'hips']) {
        if (this.rig.get(name)) return this.rig.worldPos(name, out);
      }
    }
    if (this.group) return out.copy(this.group.position).addScaledVector(UP, 0.8 * this.A.scale);
    return out.copy(this.position).setY(this.position.y + 1.1 * this.A.scale);
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
    const S = this.A.scale ?? 1;
    // 1.75·S puts it on a walker's chassis (which _poseWalker holds at 1.6·S
    // above the ground) and 1.02·S on a humanoid's chest. Measured against the
    // posed rigs, not guessed: a bubble half a metre below the body reads as a
    // bug rather than as a shield.
    return out.set(this.position.x, this.position.y + (this.A.big ? 1.75 : 1.02) * S, this.position.z);
  }

  get chestY() { return this.position.y + 1.15 * this.A.scale; }

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
      for (const b of this.rig.list) {
        if (b.severed || !b.parts.length) continue;
        if (this.actor?.ragdolled) {
          const body = this.actor.bodies.get(b.name);
          if (!body) continue;
          const len = b.length * b.cutT;
          _v1.set(0, -len / 2, 0).applyQuaternion(body.quaternion).add(body.position);
          _v2.set(0, len / 2, 0).applyQuaternion(body.quaternion).add(body.position);
        } else {
          b.obj.updateMatrixWorld(false);
          _v1.setFromMatrixPosition(b.obj.matrixWorld);
          _q1.setFromRotationMatrix(b.obj.matrixWorld);
          _v2.copy(_v1).add(_v3.set(0, b.length * b.cutT, 0).applyQuaternion(_q1));
        }
        out.push({
          name: b.name, p0: _v1.clone(), p1: _v2.clone(), r: b.radius * 1.12,
          toughness: this._boneToughness(b.name), enemy: this, vital: VITAL[b.name] ?? 0.4,
        });
      }
    } else if (this.group && this.A.custom === 'remote') {
      const c = _v1.copy(this.group.position);
      out.push({ name: 'core', p0: c.clone(), p1: c.clone(), r: 0.14 * this.A.scale,
        toughness: this.A.toughness, enemy: this, vital: 1 });
    } else if (this.group) {
      // droideka: shield first, then the core
      const c = _v1.copy(this.group.position).addScaledVector(UP, 0.62 * this.A.scale);
      if (this.shieldUp) {
        out.push({ name: 'shield', p0: c.clone(), p1: c.clone(),
          r: 1.15 * this.A.scale, toughness: TOUGHNESS.heavy, enemy: this, shield: true });
      }
      out.push({ name: 'core', p0: c.clone(), p1: c.clone().setY(c.y + 0.3 * this.A.scale),
        r: 0.34 * this.A.scale, toughness: this.A.toughness, enemy: this, vital: 1 });
      for (const leg of (this.built.legs || [])) {
        leg.leg.getWorldPosition(_v2);
        leg.lower.getWorldPosition(_v3);
        out.push({ name: 'leg' + this.built.legs.indexOf(leg), p0: _v2.clone(), p1: _v3.clone(),
          r: 0.12 * this.A.scale, toughness: this.A.toughness, enemy: this, vital: 0.2 });
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
    if (this.A.boss || this.A.custom === 'beast') this.recentDamage = (this.recentDamage || 0) + amount;
    if (this.hp <= 0) { this.die(point, source, kind); return true; }
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

  /** A blade crossed a limb. */
  takeCut(ev, source) {
    if (this.dead && !this.actor) return;
    const bone = ev.bone;
    const vital = ev.cap.vital ?? 0.4;

    if (ev.cap.shield) { this.dropShield(); return; }
    // BEFORE anything is severed: a turned cut is a cut that did not land, and
    // a body that "turned" a pass while losing the limb would be nonsense.
    if (this._turnCut(ev, bone, vital, source)) return;

    if (this.actor) {
      const impulse = _v1.copy(ev.impulse).multiplyScalar(0.35);
      if (this.actor.ragdolled) this.actor.cutRagdoll(bone, impulse);
      else this.actor.cut(bone, ev.cutT, impulse, ev.point, { spin: 1.2 });
      this.world.onLimbSevered?.(this, bone, ev.point, source);
    } else if (this.group) {
      this._cutDroideka(bone, ev, source);
    }

    const lethal = vital >= 0.9 || (vital >= 0.7 && this.hp < this.maxHp * 0.55);
    const dmg = lethal ? this.maxHp * 2 : this.maxHp * vital * 1.15;
    this.hp -= dmg;
    /* …and a CUT winds a beast, which is the whole point of the window. This
     * path subtracts from `hp` directly rather than going through `damage()`,
     * so severing a limb — the thing the winded comment says the window exists
     * for — accrued nothing at all and could never open it. */
    if (this.A.boss || this.A.custom === 'beast') this.recentDamage = (this.recentDamage || 0) + dmg;
    if (this.hp <= 0) this.die(ev.point, source, 'cut');
    else {
      // The cut carries its own line — `ev.impulse` is the direction the blade
      // drove through the limb — and losing a piece is worth more than a beat.
      this.stun(0.4, ev.impulse ?? this._blowDir(ev.point, source), 1.25);
      this._loseLimbBehaviour(bone, ev.point);
    }
  }

  /**
   * Would this pass END the fight? Two ways, and the second is the one nobody
   * counts: `takeCut`'s own lethality gate, and the fact that
   * `_loseLimbBehaviour` disarms a blade-user on the FIRST arm it loses. One
   * arm is a kill in every way that matters to a duel.
   */
  _fightEnding(bone, vital) {
    if (vital >= 0.9) return true;
    if (vital >= 0.7 && this.hp < this.maxHp * 0.55) return true;
    if (this.A.saber && !this.disarmed && /arm|fore|hand/.test(bone)) return true;
    return false;
  }

  /**
   * THE GUARD TURNS A KILLING PASS ASIDE — see the note on GUARD_PER_HP for the
   * whole argument and the measurements it comes from.
   *
   * Three gates, and each is here so that this is a duel rather than a wall:
   *
   *   · only a FIGHT-ENDING pass is turned. A duellist still bleeds from every
   *     ordinary cut at exactly the rate it always did, and still loses legs.
   *   · only while the guard is UP. Everything the player earns — a parry, a
   *     chamber, a won blade lock, a Force shove, a heavy blow, a topple, a
   *     grip, a severed arm — opens it, and the killing pass lands at once.
   *   · it is NOT free. A turned pass costs a quarter of maximum health and
   *     leaves the body staggered, so the ceiling on how long any of this can
   *     last is `1 / TURNED_CUT` passes no matter how deep the guard is.
   *
   * The stagger is the important part of the feel: the answer to a turned cut
   * is to keep swinging, because you just beat the guard you failed to get
   * through.
   */
  _turnCut(ev, bone, vital, source) {
    if (this.guard <= 0 || this.dead) return false;
    if (this._guardOpen()) return false;
    if (!this._fightEnding(bone, vital)) return false;

    this.guard--;
    this.guardT = GUARD_REFRESH;
    this.hp -= this.maxHp * TURNED_CUT;
    if (this.A.boss || this.A.custom === 'beast') this.recentDamage = (this.recentDamage || 0) + this.maxHp * TURNED_CUT;
    if (this.hp <= 0) { this.die(ev.point, source, 'cut'); return true; }

    // It reads as what it is: steel stopping steel, and a guard thrown wide.
    this.stun(0.42, ev.impulse ?? this._blowDir(ev.point, source), 1.15);
    audio.clash(ev.point ?? this.position, 0.6);
    this.world.particles?.sparkBurst?.(ev.point ?? this.position, null, 16, { speed: 9 });
    this.world.notifyFloating?.(this.aimPoint(_v1), 'TURNED', '#cfe4ff');
    return true;
  }

  /** @param point where the blade crossed, so a dropped hilt starts there. */
  _loseLimbBehaviour(bone, point) {
    // walking on a severed leg does not work
    if (/thigh|shin|foot|femur|tibia|tarsus/.test(bone)) {
      this.legsLost = (this.legsLost || 0) + 1;
      if (this.legsLost >= (this.A.custom === 'walker' || this.A.custom === 'beast' ? 3 : 1)) {
        this.topple();
      }
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
    audio.cut(point, this.A.big);
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
    if (impulse) this.velocity.add(impulse);
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
    if (this.dead || this._netRemote) return false;
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
    if (this.cloak) { this.cloak.dispose(); this.cloak = null; }
    if (this.skirt) { this.skirt.dispose(); this.skirt = null; }
    if (this.saber) {
      // the blade falls with them, then goes out
      this.saber.retract();
      setTimeout(() => this.saber && this.saber.setVisible(false), 900);
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
    const point = (this.actor?.ragdolled ? this.actor.centre(_v1) : this.aimPoint(_v1)).clone();
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
    // A new frame: whatever short list of static boxes we hold was built
    // before destruction had its turn, so the first query of the frame
    // rebuilds it. See NEAR_REACH.
    this._nearStale = true;
    this._updateElite(dt, ctx);
    if (this.rallyTimer > 0) this.rallyTimer = Math.max(0, this.rallyTimer - dt);
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
    const lod = camDist > 62 ? 2 : camDist > 30 ? 1 : 0;
    if (lod !== this.lod) { this.lod = lod; this._applyLod(lod); }
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

    this._think(dt, ctx);
    this._move(dt, ctx);
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
    this.distToTarget = dist;
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
    if (this.stunTimer > 0 || this.toppled) {
      this.wish = null;
      // A beaten guard has to TRAVEL while the body is reeling. The brain is
      // otherwise frozen for the length of the stun, so the blade would sit
      // exactly where it was parried and only fly wide afterwards — the
      // reaction would play late, after the window it is advertising has half
      // gone. Only the stagger phase runs here; a stunned duellist still
      // cannot think, aim or attack.
      if (this.duel?.staggered && !this.toppled) this.duel.update(dt, ctx, dist);
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

    if (A.melee) this._meleeBrain(dt, ctx, dist);
    else this._rangedBrain(dt, ctx, dist);
  }

  _rangedBrain(dt, ctx, dist) {
    if (this.disarmed || this.blinded) return;
    const A = this.A;
    const diff = this.world.difficulty;

    if (A.shield) {
      this.deployTimer = Math.max(0, this.deployTimer - dt);
      const wantShield = dist < 22 && this.deployTimer <= 0 && this.shieldHp > 0;
      if (wantShield && !this.shieldUp && this.stateTime > 1.2) {
        this.shieldUp = true;
        this.built.shield.visible = true;
        this.shieldHp = this.shieldMax;
        audio.tone({ freq: 220, freqEnd: 700, dur: 0.5, gain: 0.16, type: 'sine', pos: this.position });
      }
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
      }
      return;
    }
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

  _beginTelegraph(ctx) {
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
    _v6.subVectors(this.target.chest ?? this.target.position, from);
    const d = _v6.length();
    _v6.multiplyScalar(1 / d);
    const hit = ctx.physics.raycast(from, _v6, d - 0.6, (b) => b.static || b.layer === LAYER.PROP);
    if (hit) return false;
    if (ctx.terrain) {
      const t = ctx.terrain.raycast(from, _v6, d - 0.6, _v1, _v2);
      if (t !== null) return false;
    }
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
    const aimAt = _v2.copy(target.chest ?? target.position);
    /* SHOOTING ITSELF is aimed at the chest like everything else, but the
     * muzzle is already past it — a rifle held at the shoulder has its barrel
     * end a good half metre in FRONT of the ribs — so `aimAt - from` points
     * backwards and the shot goes over the droid's shoulder into the sky. The
     * bolt has to start behind the chest and travel through it. Dropping the
     * muzzle to the hip and aiming up under the chin is the pose a unit turning
     * its own weapon on itself actually takes, and it is the only special case
     * compulsion needs anywhere in this file. */
    if (target === this) {
      from.set(this.position.x, this.position.y + 0.55 * (A.scale ?? 1), this.position.z)
        .addScaledVector(_v5.set(Math.sin(this.facing), 0, Math.cos(this.facing)), 0.26 * (A.scale ?? 1));
      aimAt.set(this.position.x, this.position.y + 1.35 * (A.scale ?? 1), this.position.z);
    }

    const diff = this.world.difficulty;
    const acc = diff ? diff.enemyAccuracy : 0.7;
    // lead the shot, then throw it off by however good this difficulty is
    const speed = 88 * (diff ? diff.boltSpeed : 1) * (A.big ? 1.2 : 1);
    const tof = from.distanceTo(aimAt) / speed;
    if (target.velocity) aimAt.addScaledVector(target.velocity, tof * acc);

    _v3.subVectors(aimAt, from).normalize();
    const spread = (A.spread ?? 0.06) * (2 - acc);
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
   *                  nothing. `pressed` means a blade is inside its guard and
   *                  the exchange is going against it; `fleeing` means the
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
    this.force = Math.min(this.forceMax, this.force + FORCE_REGEN * dt);
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
      ranged: dist > this.A.preferred[1] + 2.0,
      cornered: hpFrac < 0.34 && dist < 6,
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
      this._castTimer = 0.45;
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
    if (!(amount > 0) || this.dead) return 0;
    if (!this.powers || !(this.force > 0)) return 0;
    if (!FORCE_KINDS.test(kind ?? '')) return 0;
    // …and never against itself: a body's own held power bills through the same
    // door, and a caster paying twice for one cast is not a contest.
    if (source === this) return 0;
    const composure = this._guardOpen() ? RESIST_BEATEN : 1;
    const blunt = Math.min(amount * RESIST_CAP * composure, this.force * RESIST_PER_FORCE);
    this.force = Math.max(0, this.force - blunt / RESIST_PER_FORCE);
    return blunt;
  }

  /**
   * Is this body's guard already beaten? One predicate, two readers — the blade
   * (`_turnCut`) and the Force (`resistForce`) — so "the opening you earned" is
   * one rule rather than two that drift.
   */
  _guardOpen() {
    return this.dead || this.toppled || this.gripped || this.disarmed
      || this.stunTimer > 0 || !!this.duel?.staggered || !!this.lock;
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
      _v2.copy(dir).multiplyScalar(17 * k).setY(6.5 * k);
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
    if (rng() < 0.35) {
      this.world.particles?.sparkBurst?.(t.chest ?? t.position, 2,
        this.casting === 'lightning' ? 0x9fd8ff : 0xff6a6a);
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
    _v1.copy(t.chest ?? t.position);
    _v3.subVectors(_v1, this.offHand).setY(0);
    const d = _v3.length();
    if (d > reach) return;
    // the cone is measured off the BODY, not the hand: an off blade held wide
    // still swings at whatever the wielder is facing.
    _v4.set(Math.sin(this.facing), 0, Math.cos(this.facing));
    if (d > 0.05 && _v3.divideScalar(d).dot(_v4) < Math.cos(1.0)) return;
    _v1.copy(t.chest ?? t.position);
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
    this.windTimer = Math.max(0, (this.windTimer || 0) - dt);
    this.recentDamage = Math.max(0, (this.recentDamage || 0) - dt * this.maxHp * 0.12);
    if (this.recentDamage > this.maxHp * 0.14 && this.windTimer <= 0 && this.state !== 'winded') {
      this.recentDamage = 0;
      this.state = 'winded';
      this.stateTime = 0;
      this.windTimer = 7;
      this.world.notifyFloating?.(this.aimPoint(_v1), 'WINDED', '#ffd88a');
      audio.explosion(this.position, 0.7);
    }
    if (this.state === 'winded') {
      this.wish = null;
      if (this.stateTime > 2.4) { this.state = 'approach'; }
      return;
    }

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
    const boxes = physics.staticBoxes;
    const reach = this.radius + NEAR_REACH;
    for (let i = 0; i < boxes.length; i++) {
      const box = boxes[i];
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
          this.actor.centre(this.position);
          this.velocity.set(0, 0, 0);
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

    const canMove = this.stunTimer <= 0 && this.knockTimer <= 0 && !this.gripped;
    if (canMove && this.wish) {
      const speed = this.speed * (this.legsLost ? 0.45 : 1) * (this.rallyTimer > 0 ? RALLY.speed : 1);
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
      if (this._wallT > 0 && this._wallN.lengthSq() > 1e-6) {
        _v6.copy(this._wallN).setY(0);
        if (_v6.lengthSq() > 1e-6) {
          _v6.normalize();
          const into = this.wish.dot(_v6);
          if (into < 0) this.wish.addScaledVector(_v6, -into);
        }
      }
      if (this._stuckT > 0.5) {
        _v6.set(-this.wish.z, 0, this.wish.x).multiplyScalar(this.strafeDir || 1);
        this.wish.addScaledVector(_v6, 1.0);
      }
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
    const support = this._groundAt(ctx, this.position.x, this.position.z);
    this.supportY = support;
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
    if (this.toTarget && this.stunTimer <= 0) want = Math.atan2(this.toTarget.x, this.toTarget.z);
    else if (this.velocity.lengthSq() > 1) want = Math.atan2(this.velocity.x, this.velocity.z);
    let d = want - this.facing;
    while (d > Math.PI) d -= TAU;
    while (d < -Math.PI) d += TAU;
    this.facing += d * Math.min(1, dt * (this.A.big ? 3.2 : 8));

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

    if (this.animator) {
      // the feet stand where the body stands — see src/physics/Support.js, and
      // NEAR_REACH for why this is a short list rather than the whole level
      this._gatherNear(ctx);
      const groundAt = (x, z) => this._groundAt(ctx, x, z);
      this.animator.setFacing(this.facing);
      this.animator.update(dt, {
        position: this.position, facing: this.facing, velocity: this.velocity,
        grounded: this.grounded, groundAt, crouch: 0,
        accelForward: clamp(this.velocity.length() / 5, 0, 1),
      });
      this._poseArms(dt, ctx);
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
      _v2.subVectors(this.target.chest ?? this.target.position, from);
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
    // both hands to the weapon, weapon pointed at the target
    const aim = this.target ? _v4.copy(this.target.chest ?? this.target.position).sub(chest).normalize()
                            : _v4.copy(fwd);
    const holdR = _v5.copy(chest).addScaledVector(aim, 0.34 * S).addScaledVector(right, 0.16 * S).addScaledVector(UP, -0.13 * S);
    const poleR = _v6.copy(chest).addScaledVector(right, 0.8).addScaledVector(UP, -0.7);
    rig.solveIK('armR', 'foreR', holdR, poleR);
    if (!this.A.custom) {
      const holdL = _v5.copy(chest).addScaledVector(aim, 0.5 * S).addScaledVector(right, -0.02 * S).addScaledVector(UP, -0.1 * S);
      const poleL = _v6.copy(chest).addScaledVector(right, -0.8).addScaledVector(UP, -0.7);
      rig.solveIK('armL', 'foreL', holdL, poleL);
    }
    // point the weapon down the aim line
    const hand = rig.get('handR');
    if (hand && hand.obj.parent) {
      aimY(_v5.copy(aim).lerp(UP, 0.42).normalize(), null, _q1);
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
    this._rear = rise;
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
      _v3.subVectors(this.target.chest ?? this.target.position, rig.worldPos('head', _v4));
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
      _v1.subVectors(this.target.chest ?? this.target.position, b.headG.getWorldPosition(_v2));
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

  dispose() {
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

/** How lethal losing each bone is. */
const VITAL = {
  head: 0.95, neck: 1.0, chest: 1.0, spine: 1.0, hips: 1.0, body: 1.0,
  clavL: 0.5, clavR: 0.5, armL: 0.35, armR: 0.35, foreL: 0.22, foreR: 0.22,
  handL: 0.1, handR: 0.1, thighL: 0.55, thighR: 0.55, shinL: 0.3, shinR: 0.3,
  footL: 0.12, footR: 0.12,
};
