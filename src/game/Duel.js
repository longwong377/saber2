/**
 * BATTLEFRONT BORZ — duelling.
 *
 * V1 gave duellists a swing on a timer. You could parry one, but only by luck,
 * because nothing about the attack was legible before it landed. A skill
 * ceiling you cannot see is not a skill ceiling.
 *
 * So every attack here is a declared arc with a wind-up you can read: the blade
 * traces a ghost of where it is about to go, colour-coded by what answers it,
 * and there is a window near the end of the wind-up where a counter-swing
 * chambers. Duellists fight in *forms* with distinct rhythms, so a player
 * learns "that is Djem So, it commits hard, punish the recovery" rather than
 * "something is happening again".
 *
 * The arcs live in the duellist's local frame with −Z forward, matching the
 * guard-sphere the player's own blade uses.
 */

import * as THREE from 'three';
import { clamp, lerp, damp, smoothstep, makeRng, TAU } from '../engine/MathUtil.js';
import { audio } from '../engine/Audio.js';

/**
 * The duel stream, EXPORTED so a fight can be made reproducible.
 *
 * Every DuelBrain in the process draws from it, which is what stops two
 * acolytes fighting identically — and it is also what makes a measurement of a
 * form depend on how many duels happened before it. `rng.seed(n)` puts it back;
 * tools/checks/duelling.mjs calls it before each form so that "does this form's
 * blade land" is one question asked five times rather than five different
 * questions.
 */
export const duelRng = makeRng(8123);
const rng = duelRng;
const _v1 = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3();
const _q1 = new THREE.Quaternion();
const UP = new THREE.Vector3(0, 1, 0);

const D = (x, y, z) => new THREE.Vector3(x, y, z).normalize();

/* ══════════════════════════════════════════════════════════════════════ */
/*  Guard space → world, and the 180° that made every duel free           */
/* ══════════════════════════════════════════════════════════════════════ */

/**
 * THE BUG THIS FUNCTION EXISTS TO KILL.
 *
 * Guard space is −Z forward, +X right, +Y up — the file header says so, and
 * the arcs above are all written in it. A duellist's heading, however, is a
 * yaw where FORWARD IS +Z: Enemy._move sets `facing = atan2(toTarget.x,
 * toTarget.z)` and everything that draws a body reads `(sin f, 0, cos f)` as
 * the way it is looking.
 *
 * Three places converted between the two with a bare
 *
 *     q.setFromAxisAngle(UP, facing)
 *
 * which takes local −Z to `(−sin f, 0, −cos f)` — exactly BEHIND the duellist.
 * So every acolyte in the game held its blade over its own back, telegraphed
 * its arcs behind itself, and swung at the empty air on the far side of its
 * body. Measured on a real Enemy driven at a real Player for 30 s at 1.6 m:
 *
 *     hilt offset · toPlayer   −0.71     (the hands were behind the body)
 *     blade direction · toPlayer −0.84
 *     closest tip → player      2.18 m   (the test needs 0.44 m)
 *     closest blade → blade     1.25 m   (a clash needs 0.10 m)
 *     hits landed               0
 *
 * That is the whole of "enemy lightsabers do no damage" and the whole of
 * "blade-on-blade contact has never been observed": both hit tests were real,
 * both were correct, and neither could ever fire because the weapon was
 * pointing the wrong way. The conversion lives here now, once, so a body, its
 * telegraph and its chamber test cannot disagree about which way is forward.
 *
 * +π is the whole fix: it takes local −Z to `(sin f, 0, cos f)` and local +X
 * to `fwd × up`, which is the duellist's actual right hand.
 */
export function guardQuat(yaw, spin = 0, out = new THREE.Quaternion()) {
  return out.setFromAxisAngle(UP, yaw + spin + Math.PI);
}

/** A guard-space direction, in world space, for a body facing `yaw`. */
export function guardToWorld(dir, yaw, spin = 0, out = new THREE.Vector3()) {
  return out.copy(dir).applyQuaternion(guardQuat(yaw, spin, _qg)).normalize();
}
const _qg = new THREE.Quaternion();

/** How an attack must be answered — and what colour says so. */
export const TIER = {
  light:       { colour: 0x9fd8ff, label: 'parry or chamber', chamberable: true,  parryable: true,  guardBreak: 0.6 },
  heavy:       { colour: 0xffb03a, label: 'chamber or evade', chamberable: true,  parryable: false, guardBreak: 1.9 },
  unblockable: { colour: 0xff3a46, label: 'evade',            chamberable: false, parryable: false, guardBreak: 3.2 },
};

/* ── the moves ───────────────────────────────────────────────────────── */

/**
 * Exported so a check can drive `chambersWith` against every authored attack
 * rather than a copy of the table. `spin` shipped with `to === from`, which
 * made it unchamberable, and nothing could see that because nothing outside
 * this file could enumerate the attacks.
 */
export const ATTACKS = {
  overhead:   { label: 'overhead',   from: D(0.05, 1.0, -0.35),  to: D(0, -0.55, -0.95), tier: 'heavy', damage: 1.35, reach: 0.06 },
  cleave:     { label: 'cleave',     from: D(0.95, 0.75, -0.4),  to: D(-0.8, -0.5, -0.8), tier: 'heavy', damage: 1.3, reach: 0.05 },
  slashR:     { label: 'slash',      from: D(0.95, 0.3, -0.55),  to: D(-0.85, 0.05, -0.6), tier: 'light', damage: 1.0 },
  slashL:     { label: 'slash',      from: D(-0.95, 0.3, -0.55), to: D(0.85, 0.05, -0.6), tier: 'light', damage: 1.0 },
  riposteCut: { label: 'wrist cut',  from: D(0.5, 0.55, -0.75),  to: D(-0.3, -0.2, -0.95), tier: 'light', damage: 0.85 },
  rising:     { label: 'rising cut', from: D(0.35, -0.8, -0.6),  to: D(-0.25, 0.85, -0.6), tier: 'light', damage: 1.05 },
  /* THE TWO THAT DREW A SPOKE, AND IT IS THE `spin` DEFECT ONE STEP SHORT OF
   * TOTAL. `Telegraph.shape` slerps from `from` to `to`; the note below records
   * what `to === from` does, and these two were 8.5° and 12.5° apart. Measured
   * as the arc the shipped Telegraph actually draws, against the width of the
   * same ribbon — the blade's own length, which is what the ghost is thick in:
   *
   *     attack      span     drawn arc   ribbon width   arc/width
   *     thrust       8.5°      0.29 m       1.19 m        0.25
   *     lunge       12.5°      0.43 m       1.19 m        0.36
   *     riposteCut  65.1°      2.11 m       1.19 m        1.77     ← narrowest real arc
   *     spin       154.8°      4.99 m       1.19 m        4.18
   *
   * A shape five times wider than it is long is not an arc, it is a spoke — the
   * exact word the `spin` note uses for the picture `to === from` drew. Two
   * spokes 4° apart are also indistinguishable FROM EACH OTHER, and `thrust` is
   * 33% of a Jedi Master's declared attacks and 27% of a Sentinel's, so a third
   * of everything the game's two most-fought duellists throw arrived as the
   * same unreadable line. `answerable.mjs` passed it because `chambersWith`
   * normalises the travel, which is the maths; the player reads the picture.
   *
   * A THRUST IS STILL A THRUST. What makes one is not a short arc — it is where
   * the point ENDS (dead on the centre line, where every cut in this table ends
   * somewhere off it), the `reach` that drives the hands out past a slash's, and
   * the `lunge` that carries the body behind it. All three are untouched. What
   * changed is the PREPARATION, which is the half the telegraph is drawing: the
   * blade is chambered off the line and comes to the centre, which is what a
   * thrust does with a real arm. High inside line for the thrust, low outside
   * for the lunge — 55.9° and 53.0°, arc/width 1.52 and 1.44 — so the two no
   * longer draw the same picture as each other either. The two corners were
   * picked by measuring: the closest pair of same-tier ghosts on the roster
   * went from 0.97 blade-widths apart to 1.05, so nothing else in the table was
   * crowded to make room for these. */
  thrust:     { label: 'thrust',     from: D(-0.62, 0.62, -0.55), to: D(0, 0.05, -1.0), tier: 'light', damage: 1.15, reach: 0.42, lunge: 3.4 },
  lunge:      { label: 'lunge',      from: D(0.34, -0.72, -0.6), to: D(0, 0.0, -1.0), tier: 'unblockable', damage: 1.6, reach: 0.5, lunge: 7.5 },
  /* THE SPIN CUT'S `to` USED TO EQUAL ITS `from`, and that made the one heavy
   * attack in the game impossible to answer. `chambersWith` builds the attack's
   * travel as `to − from`, which was the zero vector; three's `normalize()`
   * leaves that at zero, the dot product is 0, and `0 < -0.55` is never true.
   * Ataru and Juyo both draw it, and it is telegraphed with everything the game
   * has for "counter this now" — an orange arc, a pulsing fill, a rising
   * chamber tone — while the counter could not fire at any swing direction.
   * Sampling 200 000 uniform swing directions against it found zero that
   * chambered. The player who did exactly what the colour told them fell
   * through to the guard-break branch and took the hit.
   *
   * The body really does rotate through the strike (`spin: true` drives
   * `DuelBrain.spin` at 26 rad/s, and `guardQuat` carries the blade with it), so
   * the blade sweeps horizontally across: out to the right, through, and out to
   * the left. A chamber is a swing INTO that travel, which is now what the dot
   * product measures. It also gives Telegraph.shape two distinct endpoints to
   * draw an arc between — with them identical it was drawing a single radial
   * spoke. */
  spin:       { label: 'spin cut',   from: D(1.0, 0.1, -0.2),    to: D(-1.0, 0.1, -0.2), tier: 'heavy', damage: 1.25, spin: true },
  smash:      { label: 'guard break', from: D(0, 1.05, -0.2),    to: D(0, -0.7, -0.75), tier: 'unblockable', damage: 1.5, reach: 0.08 },
};

/* ══════════════════════════════════════════════════════════════════════ */
/*  FOOTWORK — the ground a declared attack has to cover                  */
/* ══════════════════════════════════════════════════════════════════════ */

/**
 * THE ANSWER THAT COST NOTHING, AND BEAT EVERYTHING.
 *
 * This whole file is built on one promise, written at the top of it: every
 * attack is DECLARED, with a wind-up you can read and an answer the colour
 * names — parry it, chamber it, or get out of the way. That is the contract,
 * and the player is meant to pay something for each of those three answers: a
 * parry needs the blade on the line, a chamber needs a swing into the travel
 * inside a window, and evading needs ground and the stamina to cover it.
 *
 * Evading was free, and it was total. Measured, driving a real Player against
 * a real acolyte through all five forms at two difficulties, 30 s each:
 *
 *                            hp/s taken   strikes thrown   stamina spent
 *     standing still            2.3–16.6      9–38             0
 *     holding S (walk back)     0.00          0–7              0
 *
 * Not reduced. ZERO, in nine of the ten form×difficulty cells, and in the
 * tenth every strike thrown whiffed. And it cost nothing whatever: `sprint`
 * is gated on `axis.y > 0.2` in Player._move so it cannot even be spent going
 * backwards, and walking has no drain at all. The single most valuable thing
 * a player could do in a duel was hold one key, forever, for free.
 *
 * WHY, precisely — and it is not the movement speed. A player walks at 4.6 m/s
 * and an acolyte runs at 5.0, so a duellist that simply chased would catch one.
 * It does not chase while it is attacking: `Enemy._move` gives a non-mobile
 * melee body a forward bias of 0.35 against a lateral term of 1.0, so a
 * committed duellist circles at about 1.6 m/s of closing and the player opens
 * the gap at 3 m/s while the arc it declared is still being drawn. Eight of the
 * ten attacks in ATTACKS carry no gap-closing at all; only `thrust` and `lunge`
 * had a `lunge` value, which is why those two are the only attacks that ever
 * landed on a retreating player.
 *
 * So the fix is not "make the attacks faster" or "make the tracking tighter" —
 * both of those take the answer away instead of pricing it. It is FOOTWORK: a
 * fighter who has committed to a cut steps into it. While an attack is declared
 * the duellist closes toward its own form's near spacing, and stops dead the
 * moment it is there.
 *
 *   IT IS A CLOSED LOOP, not a per-attack constant. `_closing` is proportional
 *   to the ground still to cover, so it does not need to know Enemy.js's
 *   `velocity += toTarget * lungeSpeed * dt * 9` or the rate the locomotion
 *   damps that back out — it keeps asking until the gap is shut. A copied
 *   constant on this side of that seam is the defect this codebase keeps
 *   having; a controller cannot drift out of agreement with the thing it
 *   watches.
 *
 *   THE TARGET COMES FROM `form.spacing[0]`, which is already the authored
 *   answer to "how close does this form fight" — Enemy._move reads the same
 *   number as the inner edge of the band it holds. The attack's own `reach`
 *   extends it, because a thrust really does land from further out. One table,
 *   read twice, rather than a second number meaning the same thing.
 *
 *   AND IT IS CAPPED, which is the half that keeps the attack answerable.
 *   CLOSE_CAP is a little over what a walk can outrun and far under what a dash
 *   can: a player who spends the 18 stamina on a dash still leaves the arc
 *   entirely, a player who sidesteps still makes it miss, and a parry and a
 *   chamber are untouched. What no longer works is standing off at walking pace
 *   and letting the wind-up expire — which is exactly the answer that was never
 *   supposed to be one.
 *
 * Measured after, same fixtures: see tools/checks/footwork.mjs, which drives
 * all four answers — still, walk back, dash back, sidestep — through every form
 * and holds the ORDER between them rather than any one number.
 */

/**
 * THE DEADLOCK THE LOOP ABOVE COULD NOT BREAK — and the six bodies it shut out.
 *
 * `_closing` is written for a duellist that has DECLARED, and it is right to
 * be: a body that presses forward with no arc on screen is a body walking into
 * you with nothing to read. But it returns 0 unless `phase` is `windup` or
 * `strike`, and a duellist only ever enters `windup` from the guard branch's
 * `inRange = dist < reachOut`. So the two halves lock:
 *
 *     you must be attacking to be allowed to close
 *     you cannot attack because you are not close
 *
 * A body whose own top speed is under the player's walk can never break that
 * on its own. `Enemy._move` drives straight down the line whenever `dist > far`
 * — full speed, no circling — and full speed is 4.4 m/s for a Temple Guardian
 * and 4.6 for a Sentinel against a 4.6 m/s walk. The gap does not shrink, so
 * the trigger never fires, so the loop that exists to fix exactly this never
 * runs. Measured, real Player against a real body, knife range, 30 s, Knight —
 * hp/s dealt standing still, then walking backwards, and attacks DECLARED
 * while the player backed away:
 *
 *     sentinel   4.6   2.26 → 0.11    0 declared
 *     guardian   4.4   3.56 → 0.11    0
 *     sparring   3.4   0.48 → 0.00    0
 *     master     5.2  10.11 → 0.57    8
 *     magna      4.8   3.33 → 2.10    8
 *     bodyguard  4.4   5.31 → 6.61   19        ← a 1050 hp BOSS
 *
 * Three of the roster's nine sabered bodies declared NOTHING for thirty
 * seconds, which is the same shutout the note above this one is about, arrived
 * at by a different route: there it was a scale factor, here it is a footrace
 * the body cannot win.
 *
 * So there are two presses and they answer two different questions.
 *
 *   `_closing`  I have committed to an arc and there is ground between it and
 *               the body it was declared against. Capped at CLOSE_CAP.
 *   `_chase`    the body I am fighting is running, and I am keeping my measure.
 *               Gated on the target's own retreat, capped at CHASE_CAP, and it
 *               stops dead at `spacing[0]` — the distance the form fights at.
 *
 * The property `_closing` was written to protect survives that intact, and it
 * is worth stating in the form it now takes: THE ONLY THING THAT CAN TAKE A
 * DUELLIST INSIDE THE BAND ITS FORM FIGHTS AT IS A DECLARED ATTACK. A body that
 * has drawn no arc can close ground it has been given and no more; it cannot
 * walk into your face, and it cannot press at all unless you are the one making
 * the ground. That is a fencer keeping measure, which is what every one of the
 * five tells describes, and it is the thing this file promised and never did.
 */

/**
 * How hard the duellist presses per metre of ground still to cover, in the
 * same units as an attack's authored `lunge`. Chosen so that the loop shuts a
 * one-metre gap over a wind-up rather than teleporting through it.
 */
const CLOSE_GAIN = 3.4;

/**
 * The ceiling on that press, and the reason a dash is still an answer.
 *
 * Enemy.js turns `lungeSpeed` into about 1.1× its value in extra closing speed
 * once its own locomotion damping has had its say, so this is roughly 5 m/s on
 * top of the ~1.6 m/s a circling duellist already makes — comfortably past a
 * 4.6 m/s walk and nowhere near a 15.5 m/s dash. It is deliberately BELOW the
 * 7.5 authored on `lunge`, so the one attack in the game that is supposed to
 * cover a room still out-runs ordinary footwork.
 */
const CLOSE_CAP = 4.4;

/**
 * The chase, per metre of ground between the blade and the near edge of the
 * band the form fights in. Gentler than CLOSE_GAIN: a committed lunge is a
 * step and this is a run, so it builds over a metre rather than over a
 * hand's breadth.
 */
const CHASE_GAIN = 1.9;

/**
 * The ceiling on the chase, and it is the whole reason a dash is still an exit.
 *
 * Enemy.js turns this into about 1.1× its value of extra closing speed, so a
 * 4.6 m/s Sentinel chasing flat out makes 7.5 m/s against a 4.6 m/s walk and
 * shuts a metre of gap in a little under half a second. A dash is 15.5 m/s for
 * 0.24 s on a 0.55 s cooldown — about 9.3 m/s averaged over a player spending
 * 18 stamina every half second to keep it up — so a player who pays for the
 * exit still opens ground, and a player who holds one key no longer does.
 *
 * It is deliberately well UNDER CLOSE_CAP. Being chased down is not supposed to
 * feel like being lunged at: the lunge is the declared thing, it is what the
 * arc on screen is promising, and ordinary footwork must never be able to
 * reach it.
 */
const CHASE_CAP = 2.6;

/**
 * How fast the target has to be opening the distance, along the line between
 * the two bodies, before a duellist reads it as running away.
 *
 * Under a fifth of a walk. It is here so that the two answers that are supposed
 * to stay free stay free: a SIDESTEP has no component along that line at all,
 * and two bodies circling each other drift by a few tenths. Everything a player
 * does deliberately to open ground — walking back, dashing back, a diagonal
 * retreat — is well over it, including a slow walk backwards.
 */
const FLEE_MIN = 0.9;

/**
 * The floor under the chamber window, in SECONDS — see the windup branch, where
 * the measurements are. `chamberWindow` is a share of a wind-up, so the forms
 * that read fastest had the smallest window twice over and the shortest of them
 * was three frames at 60 Hz. This is roughly the spread of a practised human on
 * an event they can see coming, which is what the arc's fill makes this.
 */
const CHAMBER_MIN = 0.18;

/**
 * How far ahead of the window the chamber cue is sounded, in seconds.
 *
 * A little over a simple auditory reaction time. The tone used to fire at the
 * instant the window OPENED, which is a cue whose only possible message is that
 * you have already missed; sounding it this far ahead means a player who
 * answers it at human speed arrives while the window is still open.
 */
const CHAMBER_LEAD = 0.22;

/**
 * How far past the hilt's wind-up radius the ghost is drawn, in body scales.
 *
 * The hands do not sit still through a strike — `Enemy._poseSaber` hangs them
 * 0.08·S below the guard line and then sweeps the guard from the attack's
 * `from` to its `to`, so the hilt's distance from the chest moves by up to that
 * offset AFTER the arc has been drawn. The ghost is a promise about where the
 * blade will be, so it has to be a BOUND on that sweep rather than a snapshot
 * of one frame of it. See the measurements in `_drawTelegraph`.
 */
const TELE_PAD = 0.07;

/* ── the forms ───────────────────────────────────────────────────────── */

/**
 * How much of a form's move order survives when nothing is breaking it — see
 * `_pick`. Not 1: a duellist you can recite is a duellist you never have to
 * look at. Not 0: that is where this started, and it is why the five forms
 * were statistically the same fighter wearing different wind-up times.
 */
const RHYTHM = 0.72;

/**
 * MAKASHI AND SORESU WERE ONE FIGHT AT TWO VOLUMES.
 *
 * Measured on one body with the kit off, three seeds × 60 s each, against a
 * real Player standing still:
 *
 *     form      atk/s  hp/s   light% heavy% unbl%  spacing p10..p90
 *     makashi   0.78   8.82   100     0      0     1.65 .. 1.98
 *     soresu    0.18   1.60   100     0      0     1.75 .. 1.84
 *     ataru     1.32  20.09    80    20      0     1.17 .. 2.45
 *     juyo      0.93  10.76    30    56     14     1.46 .. 1.79
 *     djemSo    0.44   3.74     0    70     30     1.56 .. 1.76
 *
 * On the profile a player actually answers — what share must be parried, what
 * share can only be chambered, what share must be evaded, how far out it fights
 * and how fast — makashi↔soresu was the closest pair on the roster and each was
 * the other's nearest neighbour. Both 100% parryable, both standing 7 cm apart,
 * both drawing three of the same five moves. They differed in how OFTEN and how
 * HARD, which is a volume knob, and the two most iconic defensive forms in the
 * source material deserve better than being one fighter at two settings.
 *
 * They are now separated on three axes rather than one, and every one of them
 * is a thing the player has to answer differently:
 *
 *   WHAT IT THROWS. Makashi picks: the thrust and the wrist cut you parry, and
 *   a LUNGE at one move in five that your blade is no answer to at all. Soresu
 *   stays 100% parryable on purpose — everything it offers can be met with
 *   steel, and that is the point of it. Evade-share 20% against 0%.
 *
 *   WHERE IT STANDS. `standAt` below. Makashi fights at the far end of its own
 *   band and steps in only behind a declared point; Soresu holds one distance
 *   and does not chase. Against a moving player that is 0.7 m of daylight
 *   between two forms that used to stand 7 cm apart.
 *
 *   WHEN IT COMES. `defensive` is now a magnitude rather than a flag — see the
 *   guard branch. Soresu's rate swings by a factor of six on whether the player
 *   has committed to a swing, so the form is genuinely waiting for you rather
 *   than merely slow, and `punishRecovery` finishes what that opens.
 */
export const FORMS = {
  makashi: {
    name: 'Makashi', numeral: 'II',
    tell: 'economical, blade-tip precise — it fights at the end of the blade and lunges the moment you overcommit',
    windup: 0.34, strike: 0.13, recover: 0.24, chamberWindow: 0.42,
    aggression: 0.9, spacing: [1.7, 2.9], standAt: 0.82, chain: [1, 2],
    moves: ['thrust', 'riposteCut', 'lunge', 'slashR', 'thrust'],
    feint: 0.30, punishRecovery: 0.85,
  },
  djemSo: {
    name: 'Djem So', numeral: 'V',
    tell: 'heavy and committed — long wind-ups, longer recoveries',
    windup: 0.68, strike: 0.19, recover: 0.58, chamberWindow: 0.34,
    aggression: 0.7, spacing: [1.5, 3.2], standAt: 0.05, chain: [1, 1],
    moves: ['overhead', 'cleave', 'smash', 'overhead'],
    feint: 0.10, punishRecovery: 0.3, strength: 1.8,
  },
  ataru: {
    name: 'Ataru', numeral: 'IV',
    tell: 'acrobatic flurries — it will not stop at one',
    windup: 0.24, strike: 0.11, recover: 0.17, chamberWindow: 0.5,
    aggression: 1.3, spacing: [1.4, 3.6], standAt: 0, chain: [2, 4],
    moves: ['slashR', 'slashL', 'rising', 'spin', 'riposteCut'],
    feint: 0.22, punishRecovery: 0.6, mobile: true,
  },
  soresu: {
    name: 'Soresu', numeral: 'III',
    tell: 'gives you nothing — it is waiting for you to swing first',
    windup: 0.40, strike: 0.14, recover: 0.26, chamberWindow: 0.45,
    /* `standAt: 0` — IT WILL NOT BE DRAWN OUT. Soresu holds the one distance
     * its form fights at and no other: run and it follows you to exactly that
     * measure and stops, where Makashi at 0.82 refuses to let you inside the
     * point and works the far edge of a band that is nearly as wide. The two
     * were 7 cm apart in a stand-up fight and are 0.84 m apart the moment
     * anybody moves. The band itself is untouched — where a form PARKS against
     * a player who never moves is `Enemy._move`'s, and this lane does not own
     * that file. */
    aggression: 0.42, spacing: [1.8, 3.0], standAt: 0, chain: [1, 2],
    moves: ['slashR', 'riposteCut', 'slashL'],
    feint: 0.14, punishRecovery: 1.6, defensive: 2.4,
  },
  juyo: {
    name: 'Juyo', numeral: 'VII',
    tell: 'erratic — the rhythm is the trap',
    windup: 0.30, strike: 0.13, recover: 0.22, chamberWindow: 0.36,
    aggression: 1.15, spacing: [1.4, 3.2], standAt: 0.18, chain: [1, 3],
    moves: ['cleave', 'slashL', 'lunge', 'rising', 'overhead', 'spin'],
    feint: 0.42, punishRecovery: 0.75, erratic: 0.55,
  },
};

export const FORM_KEYS = Object.keys(FORMS);

/**
 * THE PHASES, in a stable order, so one can be named by index on the wire.
 *
 * One table, in the module that owns the phases. It was briefly two — one in
 * src/net/Net.js and one in src/game/Enemy.js — which is the copied-table
 * defect this codebase has now been bitten by five times: a HUD price list, a
 * form's spacing, a wave-boundary rule, a check's regex, and this. Two copies
 * of an ORDERING are worse than two copies of a number, because they disagree
 * silently and the symptom is a client drawing the wrong swing.
 */
export const DUEL_PHASES = ['guard', 'windup', 'strike', 'recover', 'feint', 'stagger'];

/**
 * The attacks in a stable order, so one can be named by index on the wire.
 * `Object.keys` of a literal is insertion order in every engine this ships to,
 * and a client that resolves the wrong index draws the wrong arc — so if a new
 * attack is ever added it goes at the END of ATTACKS, not in the middle.
 */
export const ATTACK_KEYS = Object.keys(ATTACKS);

/* ══════════════════════════════════════════════════════════════════════ */
/*  Telegraph — the ghost of the swing that is coming                     */
/* ══════════════════════════════════════════════════════════════════════ */

const TELE_VERT = /* glsl */`
  attribute float aT;
  attribute float aSide;
  varying float vT; varying float vSide;
  void main(){
    vT = aT; vSide = aSide;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;
const TELE_FRAG = /* glsl */`
  precision highp float;
  uniform vec3 uColour; uniform float uFill; uniform float uAlpha; uniform float uPulse;
  varying float vT; varying float vSide;
  void main(){
    // the arc fills from its start toward its end as the strike approaches
    float lead = smoothstep(uFill + 0.16, uFill - 0.02, vT);
    float edge = 1.0 - abs(vSide * 2.0 - 1.0);
    float head = smoothstep(uFill - 0.22, uFill, vT) * lead;
    float a = (edge * 0.5 + 0.5) * lead * uAlpha;
    a *= 0.35 + head * 1.5;
    a *= uPulse;
    if(a < 0.004) discard;
    gl_FragColor = vec4(uColour * (1.0 + head * 2.2), a);
  }
`;

export class Telegraph {
  constructor(scene, segments = 18) {
    this.n = segments;
    const geo = new THREE.BufferGeometry();
    this.pos = new Float32Array(this.n * 2 * 3);
    const aT = new Float32Array(this.n * 2);
    const aSide = new Float32Array(this.n * 2);
    const idx = [];
    for (let i = 0; i < this.n; i++) {
      aT[i * 2] = aT[i * 2 + 1] = i / (this.n - 1);
      aSide[i * 2] = 0; aSide[i * 2 + 1] = 1;
      if (i < this.n - 1) {
        const a = i * 2, b = i * 2 + 1, c = (i + 1) * 2, d = (i + 1) * 2 + 1;
        idx.push(a, b, c, b, d, c);
      }
    }
    geo.setIndex(idx);
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('aT', new THREE.BufferAttribute(aT, 1));
    geo.setAttribute('aSide', new THREE.BufferAttribute(aSide, 1));

    this.mat = new THREE.ShaderMaterial({
      uniforms: {
        uColour: { value: new THREE.Color(0x9fd8ff) },
        uFill: { value: 0 },
        uAlpha: { value: 0 },
        uPulse: { value: 1 },
      },
      vertexShader: TELE_VERT, fragmentShader: TELE_FRAG,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide, toneMapped: false,
    });
    this.mesh = new THREE.Mesh(geo, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 10;
    this.mesh.visible = false;
    scene.add(this.mesh);
    this.scene = scene;
  }

  /**
   * @param origin  chest position in world space
   * @param yaw     duellist facing
   * @param from,to arc endpoints in local guard space
   * @param inner   distance from chest to the hands
   * @param outer   distance from chest to the blade tip
   */
  shape(origin, yaw, from, to, inner, outer) {
    // guardQuat, not a bare yaw: the ghost has to be drawn where the blade will
    // actually go, and for four months it was drawn behind the duellist.
    guardQuat(yaw, 0, _q1);
    for (let i = 0; i < this.n; i++) {
      const t = i / (this.n - 1);
      // slerp-ish: normalise the lerp so the arc bows the way a swing does
      _v1.copy(from).lerp(to, t).normalize().applyQuaternion(_q1);
      const i6 = i * 6;
      this.pos[i6] = origin.x + _v1.x * inner;
      this.pos[i6 + 1] = origin.y + _v1.y * inner;
      this.pos[i6 + 2] = origin.z + _v1.z * inner;
      this.pos[i6 + 3] = origin.x + _v1.x * outer;
      this.pos[i6 + 4] = origin.y + _v1.y * outer;
      this.pos[i6 + 5] = origin.z + _v1.z * outer;
    }
    this.mesh.geometry.attributes.position.needsUpdate = true;
  }

  set(colour, fill, alpha, pulse = 1) {
    this.mat.uniforms.uColour.value.setHex(colour);
    this.mat.uniforms.uFill.value = fill;
    this.mat.uniforms.uAlpha.value = alpha;
    this.mat.uniforms.uPulse.value = pulse;
    this.mesh.visible = alpha > 0.005;
  }

  hide() { this.mesh.visible = false; this.mat.uniforms.uAlpha.value = 0; }

  dispose() {
    this.scene.remove(this.mesh);
    this.mesh.geometry.dispose();
    this.mat.dispose();
  }
}

/* ══════════════════════════════════════════════════════════════════════ */
/*  The duellist brain                                                    */
/* ══════════════════════════════════════════════════════════════════════ */

export class DuelBrain {
  /**
   * Phases: guard → windup → strike → recover → guard.
   * `feint` sits between guard and windup and aborts back to guard.
   *
   * Phase and timer live on the enemy so the rest of the game can interrupt a
   * duellist simply by writing to them — a parry does exactly that.
   */
  constructor(enemy, opts = {}) {
    this.e = enemy;
    this.formKey = opts.form || FORM_KEYS[Math.floor(rng() * FORM_KEYS.length)];
    this.form = FORMS[this.formKey];
    this.telegraph = opts.telegraph ?? null;

    this.guardDir = new THREE.Vector3(0.4, 0.35, -0.85).normalize();
    this.restDir = this.guardDir.clone();
    this.attack = null;
    this.attackKey = null;
    this.chainLeft = 0;
    this.trackSpeed = 7;
    this.lungeSpeed = 0;
    this.chamberOpen = false;
    this.readTimer = 0.4 + rng() * 0.5;
    this.spin = 0;
    this._cued = false;
    this.lastPhase = 'guard';
    this.timeScale = 1;      // < 1 slows the whole form down, for sparring
    /** Where the guard was driven when the blade was beaten aside. */
    this.staggerDir = null;
    /** How many follow-ups this duellist has taken off one connected hit. */
    this.followUps = 0;

    enemy.saberPhase = 'guard';
    enemy.saberTimer = 0.35 + rng() * 0.5;
  }

  get phase() { return this.e.saberPhase; }
  set phase(v) { this.e.saberPhase = v; }
  get timer() { return this.e.saberTimer; }
  set timer(v) { this.e.saberTimer = v; }

  /**
   * Force back to a neutral guard — used by parries, staggers and hitstop.
   *
   * AND IT WILL NOT SHORTEN A STAGGER. `_finish('player')` — winning a blade
   * lock, the single largest opening the game offers — ran
   *
   *     e.stun(1.15);          // → duel.stagger(1.15): phase = 'stagger'
   *     e.duel?.interrupt(1.0) // → phase = 'recover'
   *
   * two lines apart, so the guard it had just thrown wide was put straight
   * back on line and the reward for overpowering a lock was a duellist
   * standing at rest. World's chamber and parry paths happen to interrupt
   * BEFORE they stun and so were unaffected, which is why this never showed
   * up anywhere but the lock. A stagger is strictly stronger than a recover —
   * it has already cleared the attack, the chain and the chamber and hidden
   * the telegraph — so there is never a reason to trade one for the other.
   */
  interrupt(recoverTime = 0.4) {
    if (this.staggered) return;
    this.attack = null;
    this.chainLeft = 0;
    this.chamberOpen = false;
    this.phase = 'recover';
    this.timer = recoverTime;
    this.telegraph?.hide();
  }

  /** True while the blade is out of line and nothing can be thrown from it. */
  get staggered() { return this.phase === 'stagger'; }

  /**
   * THE BLADE BEATEN ASIDE.
   *
   * `interrupt` was the only thing a parry could do to a duellist, and all it
   * does is start the recovery early — the guard slides back to rest, the body
   * keeps circling, and 0.45 s later the same attack comes again. There was no
   * way to SEE that you had won the exchange, so beating a blade aside felt
   * like nothing and the fight had no rhythm above "swing until it dies".
   *
   * A stagger is a phase of its own because it has to be three things at once:
   *   • legible   — the guard is driven wide and low, off the body's line, and
   *                 held there. You can see the opening from across the room.
   *   • punishing — no attack, no chamber, no telegraph, for `seconds`.
   *   • directional — beaten from the left, it opens to the right.
   *
   * `power` scales how far the guard is thrown and how long it stays there, so
   * a light parry is a beat and a won blade-lock is an invitation.
   *
   * @param seconds  how long the duellist is out of line
   * @param worldDir the direction the blade was driven, in WORLD space
   * @param power    0..1+, how hard
   */
  stagger(seconds = 0.55, worldDir = null, power = 1) {
    // A FLOOR, and it is the whole reason this reads on screen. World's parry
    // path stuns for 0.18 s — three frames at 60 Hz, which is a body twitching,
    // not a body beaten. Being unable to MOVE and having your guard OUT OF LINE
    // are different lengths of time; this is the second one, and it is long
    // enough to be an invitation. Capped at 2.2 s so `stun(9999)` on a toppled
    // body does not leave a permanent stagger behind.
    const t = clamp(Math.max(seconds, 0.42) * clamp(power, 0.6, 1.4), 0.32, 2.2);
    // Never shorten an existing stagger: two parries in a row must not read as
    // one, and `Math.max` is the same rule Enemy.stun already follows.
    if (this.staggered && this.timer > t) return;
    this.attack = null;
    this.attackKey = null;
    this.chainLeft = 0;
    this.followUps = 0;
    this.chamberOpen = false;
    this.telegraph?.hide();
    this.phase = 'stagger';
    this.timer = t;
    this._staggerLen = t;

    // Which side the guard is thrown to, in the duellist's own frame. The
    // world direction is taken back into guard space so the opening is on the
    // side the blade was actually driven, whatever way the body happens to be
    // pointing.
    let side = this.guardDir.x >= 0 ? -1 : 1;
    if (worldDir) {
      _v1.copy(worldDir).applyQuaternion(guardQuat(this.e.facing, 0, _q1).invert());
      if (Math.abs(_v1.x) > 1e-4) side = Math.sign(_v1.x);
    }
    this.staggerDir = (this.staggerDir || new THREE.Vector3())
      .set(side * lerp(0.9, 1.5, clamp(power, 0, 1)), -0.45, -0.3).normalize();
  }

  /**
   * A LANDED HIT IS PRESSURE, NOT A FULL STOP.
   *
   * The one thing World did after an enemy blade connected was
   * `e.duel.interrupt(0.45)` — the duellist landed a cut and then politely
   * stepped back and reset. So the only thing that ever punished a mistake was
   * the mistake itself; there was no reason to disengage after being hit,
   * because being hit bought you half a second of quiet.
   *
   * Now a connected hit shortens the recovery and chambers exactly one chained
   * attack, so the answer to taking a cut is to MOVE. Capped at one — a hit
   * must not be able to loop into a stunlock, and `followUps` resets the
   * moment the duellist returns to guard.
   */
  followUp(max = 1) {
    if (this.followUps >= max) { this.interrupt(0.45); return false; }
    this.followUps++;
    const sp = this._speed();
    this.attack = null;
    this.chamberOpen = false;
    this.telegraph?.hide();
    this.chainLeft = Math.max(this.chainLeft, 1);
    this.phase = 'recover';
    this.timer = this.form.recover * sp * 0.5;
    this._recoverLen = this.timer;
    return true;
  }

  /** Speeds scale with difficulty so Grandmaster genuinely reads faster. */
  _speed() {
    const diff = this.e.world.difficulty;
    const base = diff ? lerp(1.35, 0.78, clamp(diff.enemyAggression / 1.3, 0, 1)) : 1;
    return base / clamp(this.timeScale, 0.2, 3);
  }

  /**
   * THE BAND THE BODY HOLDS, AND THE BAND THE BRAIN SWINGS IN, IN ONE UNIT.
   *
   * `FORMS[*].spacing` is read in two places. `Enemy._move` holds the body
   * inside `[spacing[0] * scale, spacing[1] * scale]` — scaled, because a big
   * duellist keeps its reach, and there is a whole note there saying so. The
   * duel brain then decided whether to attack at all with a bare
   *
   *     const inRange = dist < F.spacing[1];
   *
   * UNSCALED. So for every melee body in the game whose scale is not exactly 1
   * — which is every one of them; an acolyte is 1.04 and the elite variants go
   * higher — the distance the body chooses to stand at is OUTSIDE the distance
   * its own brain will swing from. Makashi parks at 3.02 m and refuses to
   * attack past 2.90.
   *
   * Standing still it barely shows, because the yield band pulls the duellist
   * well inside `far` and it attacks from in there. It shows completely against
   * a retreating player, which is the case this whole footwork note is about:
   * the duellist chases at 5.0 m/s against a 4.6 m/s walk, gains 0.4 m/s until
   * it reaches the outer edge of its band, and then stops — parked 4% outside
   * its own trigger, forever. Measured, 30 s per form: 0 attacks declared, 0
   * strikes, 0.00 hp/s, in four of the five forms.
   *
   * One number, two readers, two different scalings — the sixth instance of
   * this codebase's oldest defect. It is derived once here now and both call
   * sites in this file read it.
   */
  get reachOut() { return this.form.spacing[1] * (this.e.A?.scale ?? 1); }

  /**
   * How hard this duellist should be pressing forward right now, in the units
   * an attack's `lunge` is authored in. See the FOOTWORK note above.
   *
   * Zero unless an attack has actually been DECLARED — a duellist at guard
   * keeps its form's spacing through `Enemy._move`'s band and must not be
   * shoved into the player's face by this, and a feint that closed ground
   * would be a free approach rather than a bait.
   */
  _closing(dist) {
    const a = this.attack;
    if (!a || !(dist > 0)) return 0;
    if (this.phase !== 'windup' && this.phase !== 'strike') return 0;
    // The form's own near spacing, scaled by the body exactly as Enemy._move
    // scales it, plus whatever this particular attack's reach buys.
    const sc = this.e.A?.scale ?? 1;
    const gap = dist - (this.form.spacing[0] * sc + (a.reach ?? 0));
    if (!(gap > 0)) return 0;
    return clamp(gap * CLOSE_GAIN, 0, CLOSE_CAP);
  }

  /**
   * How hard this duellist should be RUNNING right now — the other press, and
   * the one that breaks the deadlock. See the note above CLOSE_GAIN.
   *
   * IT ANSWERS FOOTWORK WITH FOOTWORK, and that is the whole gate: it is alive
   * only while the BODY IT IS FIGHTING is opening the distance under its own
   * power. Not while the gap merely grows — a mobile form breaking out of its
   * own band opens the gap too, and a chase that could not tell the difference
   * would cancel Ataru's whole character. `target.velocity · e.toTarget` is the
   * same projection `Enemy._forceBrain` reads for its `fleeing` situation, off
   * the same two shipped fields, so "the player is running" means one thing in
   * this file and in that one.
   *
   * WHAT IT MAY NEVER DO is press inside the distance the form fights at. That
   * is `standAt`, and it is THE FOOTWORK READER `spacing[1]` NEVER HAD: the
   * band is authored 1.2 to 2.2 m wide on every form and, outside Ataru's
   * `mobile`, the only thing that had ever read the outer number was an "am I
   * close enough to swing" gate — so four of the five forms lived in the inner
   * 30 cm of their own band and the far edge described nothing. `standAt` is
   * where in its own band a form holds when the fight is MOVING: Makashi at
   * 0.82 fights at the end of the blade and steps in only behind a declared
   * point, Djem So at 0.05 wants to be on top of you. Scaled by the body
   * exactly as `Enemy._move` scales the same two numbers.
   *
   * So a duellist maintains its measure against a retreating player and stops
   * dead at the distance it wants to fight from; the only thing in this file
   * that can take it closer than that is a DECLARED attack, which is
   * `_closing`, which draws an arc on screen before it moves. A stagger stops
   * this too, because a blade that has been beaten aside has something else to
   * do with the next half second.
   */
  _chase(dist) {
    if (!(dist > 0) || this.phase === 'stagger') return 0;
    const t = this.e.target, to = this.e.toTarget;
    if (!t || !to || !t.velocity) return 0;
    const flee = t.velocity.x * to.x + t.velocity.z * to.z;
    if (!(flee > FLEE_MIN)) return 0;
    const gap = dist - this.standOff;
    if (!(gap > 0)) return 0;
    return clamp(gap * CHASE_GAIN, 0, CHASE_CAP);
  }

  /**
   * The distance this form wants between the two bodies, in metres, on this
   * body. `standAt` is a fraction of its own authored band and 0 is the near
   * edge, so a form that declares nothing keeps the behaviour it had.
   */
  get standOff() {
    const sp = this.form.spacing;
    return lerp(sp[0], sp[1], clamp(this.form.standAt ?? 0, 0, 1)) * (this.e.A?.scale ?? 1);
  }

  update(dt, ctx, dist) {
    const F = this.form;
    const sp = this._speed();
    this.timer -= dt;
    /* The authored lunge still decays exactly as it did — `thrust` and `lunge`
     * are single explosive steps and must stay that shape — but it can never
     * fall below what the footwork loop is asking for while there is still
     * ground between this blade and the body it was declared against. When the
     * gap is shut the floor is 0 and this line is what it always was. */
    this.lungeSpeed = Math.max(this._closing(dist), this._chase(dist),
      damp(this.lungeSpeed, 0, 8, dt));
    this.spin = this.phase === 'strike' && this.attack?.spin ? this.spin + dt * 26 : 0;

    const target = this.e.target;
    // Soresu and friends watch what you are doing and answer it
    const playerCommitted = target && target.control
      ? target.control.angVel.length() > 7.5 : false;
    const playerRecovering = target && target.control
      ? (target.staggerTimer > 0 || target.stamina < target.maxStamina * 0.22) : false;

    switch (this.phase) {
      case 'guard': {
        this.trackSpeed = 7;
        this.chamberOpen = false;
        this.readTimer -= dt;
        if (this.readTimer <= 0) {
          this.readTimer = 0.35 + rng() * 0.55;
          // drift the guard so the duellist never reads as idle
          this.restDir.set((rng() - 0.5) * 1.25, rng() * 0.75 - 0.05, -0.85).normalize();
        }
        this.guardTargetDir = this.restDir;

        const inRange = dist < this.reachOut;
        /**
         * `defensive` IS A MAGNITUDE NOW, AND IT WAS AUTHORED AS ONE.
         *
         * It shipped as `F.defensive && !playerCommitted ? 0.35 : 1` — a
         * TRUTHINESS test against a field authored `1.7`, so the number meant
         * nothing and the whole of "it is waiting for you to swing first" was
         * one hard-coded 0.35 that would have read the same if the field said
         * `true`. That is this codebase's oldest defect in miniature: a value
         * beside a reader that does not read it.
         *
         * It cuts both ways now, which is what makes it a wait rather than a
         * slowness: a defensive form asks for LESS than its own aggression
         * while the player's blade is quiet and MORE than it the moment the
         * player commits. Soresu at 2.4 swings by a factor of six across that
         * line, which is the difference between a form you can walk up to and
         * a form that answers the first thing you throw.
         */
        const want = F.aggression * (playerRecovering ? 1 + F.punishRecovery : 1)
                   * (F.defensive ? (playerCommitted ? F.defensive : 1 / F.defensive) : 1);
        // The decision happens when the pause between attacks runs out — once,
        // not every frame. Rolling per-frame made aggression depend on the
        // player's framerate and left duellists idling for seconds at a time.
        if (this.timer <= 0) {
          if (inRange && rng() < clamp(want * 0.62, 0.1, 0.94)) {
            if (rng() < F.feint) this._beginFeint(sp);
            else this._beginAttack(sp);
          } else {
            this.timer = (0.2 + rng() * 0.45) / clamp(F.aggression, 0.45, 1.6);
          }
        }
        break;
      }

      case 'feint': {
        // show the arc, then abandon it — the whole point is to bait a chamber
        this.trackSpeed = 16;
        const k = 1 - clamp(this.timer / this._feintLen, 0, 1);
        this.guardTargetDir = this.attack.from;
        this._drawTelegraph(k * 0.45, 0.5, 1);
        if (this.timer <= 0) {
          this.telegraph?.hide();
          this.phase = 'guard';
          this.timer = 0.16 + rng() * 0.2;
          this.attack = null;
          this.e.world.notifyFloating?.(this.e.aimPoint(_v2), 'FEINT', '#c8b0ff');
        }
        break;
      }

      case 'windup': {
        this.trackSpeed = 13;
        this.guardTargetDir = this.attack.from;
        const k = 1 - clamp(this.timer / this._windupLen, 0, 1);
        /**
         * THE CHAMBER WINDOW, IN SECONDS, AND WHETHER A HUMAN CAN REACH IT.
         *
         * It was a share of the wind-up and nothing else — `k > 1 -
         * chamberWindow` — so a form that reads faster also gets a shorter
         * window, twice over. Measured through the shipped brain, per attack,
         * as the wall-clock time `chamberOpen` is true:
         *
         *               Knight   Grandmaster   chained, Grandmaster
         *     djemSo     0.233 s    0.185 s          0.133 s
         *     soresu     0.181      0.144            0.104
         *     makashi    0.144      0.114            0.082
         *     ataru      0.121      0.096            0.069
         *     juyo       0.109      0.087            0.049   (erratic jitter)
         *
         * Two things are wrong with that and only one of them is the number.
         *
         * THE CUE FIRED AT THE START OF THE WINDOW. A 2100→2600 Hz tone that
         * begins at the instant the window opens is a cue you cannot react to:
         * simple auditory reaction time is ~160 ms and a chamber is not a
         * simple reaction — it is a swing, in a chosen direction, that has to
         * arrive with the blade already moving at 5.5 m/s. Every one of the
         * numbers above is shorter than the reaction the cue was asking for, so
         * the cue could only ever say "you have just missed it". It leads the
         * window by CHAMBER_LEAD now, which is the whole of the change: the
         * sound means the same thing it always meant and it arrives while there
         * is still time to answer it. A wind-up too short to hold the lead
         * fires it as the arc goes up, which is the earliest there is.
         *
         * AND THE FLOOR. 49 ms is three frames at 60 Hz. A practised human
         * timing a PREDICTED event — which is what the arc's fill makes this,
         * since the cue can only ever be a reminder — lands inside about
         * ±90 ms, so a window under ~0.18 s is one nobody can hold, and the
         * fastest forms had the smallest one. CHAMBER_MIN is that floor, in
         * seconds, and it is stated rather than folded into the share: djemSo
         * and soresu keep the windows they authored at every difficulty, and
         * the three fast forms stop being unanswerable on the ninth frame.
         */
        const tier = TIER[this.attack.tier];
        const win = Math.max(F.chamberWindow * this._windupLen, CHAMBER_MIN);
        this.chamberOpen = tier.chamberable && this.timer <= win;
        if (tier.chamberable && !this._cued && this.timer <= win + CHAMBER_LEAD) {
          this._cued = true;
          audio.tone({ freq: 2100, freqEnd: 2600, dur: 0.07, gain: 0.05, type: 'sine', pos: this.e.position });
        }
        this._drawTelegraph(k, 0.28 + k * 0.72, this.chamberOpen ? 1.5 + Math.sin(k * 60) * 0.4 : 1);
        if (this.timer <= 0) {
          this.phase = 'strike';
          this.timer = this.attack.strike ?? (F.strike * sp);
          this._strikeLen = this.timer;
          this.lungeSpeed = this.attack.lunge ?? 0;
          audio.swing(this.attack.tier === 'light' ? 16 : 26, this.e.saber.base);
          this.telegraph?.hide();
        }
        break;
      }

      case 'strike': {
        this.trackSpeed = this.attack.tier === 'light' ? 30 : 22;
        const k = 1 - clamp(this.timer / this._strikeLen, 0, 1);
        this.guardTargetDir = _v1.copy(this.attack.from).lerp(this.attack.to, k).normalize();
        this.chamberOpen = false;
        if (this.timer <= 0) {
          this.phase = 'recover';
          this.timer = (this.attack.recover ?? F.recover) * sp;
          this._recoverLen = this.timer;
        }
        break;
      }

      case 'recover': {
        this.trackSpeed = 6;
        this.chamberOpen = false;
        this.guardTargetDir = this.attack
          ? _v1.copy(this.attack.to).lerp(this.restDir, 0.45).normalize()
          : this.restDir;
        if (this.timer <= 0) {
          if (this.chainLeft > 0 && dist < this.reachOut + 0.5) {
            this.chainLeft--;
            this._beginAttack(sp, true);
          } else {
            this.phase = 'guard';
            this.attack = null;
            this.followUps = 0;
            this.timer = 0.16 + rng() * 0.34;
          }
        }
        break;
      }

      case 'stagger': {
        // Out of line and staying there. The guard is DRIVEN to the opening
        // rather than eased to it — a beaten blade travels, it does not drift —
        // and it comes back on the last third so the window has a visible end.
        const k = 1 - clamp(this.timer / (this._staggerLen || 0.5), 0, 1);
        this.trackSpeed = k < 0.66 ? 22 : 7;
        this.chamberOpen = false;
        this.guardTargetDir = k < 0.66
          ? (this.staggerDir || this.restDir)
          : _v1.copy(this.staggerDir || this.restDir).lerp(this.restDir, (k - 0.66) * 3).normalize();
        if (this.timer <= 0) {
          this.phase = 'guard';
          this.attack = null;
          this.followUps = 0;
          // `staggerDir` is deliberately kept rather than nulled: the next
          // parry writes into the same vector instead of allocating one.
          // A beaten duellist does not attack on the frame it recovers.
          this.timer = 0.18 + rng() * 0.26;
        }
        break;
      }

      default:
        this.phase = 'guard';
        this.timer = 0.3;
    }

    this.lastPhase = this.phase;
    // move the actual guard toward wherever the phase wants it
    if (this.guardTargetDir) {
      this.guardDir.lerp(this.guardTargetDir, clamp(dt * this.trackSpeed, 0, 1)).normalize();
    }
  }

  /**
   * WHICH ATTACK COMES NEXT — AND WHETHER YOU CAN LEARN IT.
   *
   * What was here:
   *
   *     let key = F.moves[Math.floor(rng() * F.moves.length)];
   *     // Juyo deliberately breaks its own rhythm
   *     if (F.erratic && rng() < F.erratic * 0.4) key = F.moves[Math.floor(rng() * F.moves.length)];
   *
   * — a uniform draw, and then sometimes ANOTHER uniform draw from the same
   * list. The second line is the identity function: re-rolling a uniform
   * variable gives back the same distribution, exactly. `erratic` is authored
   * on one form, Juyo, whose tell reads "erratic — the rhythm is the trap",
   * and it changed nothing whatsoever: Juyo and Soresu chose their attacks in
   * statistically indistinguishable ways, and neither had a rhythm to break
   * because every form drew uniformly and independently every single time.
   *
   * A rhythm is a CONDITIONAL distribution — what comes next given what just
   * came — so it cannot exist in a table of independent draws. A disciplined
   * form now WALKS its own move list, which is what makes Makashi's
   * thrust → riposte → slash → slash → thrust something a player can read
   * three exchanges in, and it is why the lists have repeats in them.
   * `erratic` is the chance of leaving that walk; and when it leaves it goes
   * anywhere EXCEPT the move the rhythm just promised, because a break that
   * might play the expected move is not a break.
   *
   * Measured over 20 000 attacks per form — P(next attack is the one this
   * form's order implies), where the old uniform draw scores exactly 1/len:
   *
   *     makashi  73.9%   (was 20.0%)      soresu  72.4%   (was 33.3%)
   *     djemSo   75.2%   (was 25.0%)      juyo    32.7%   (was 16.7%)
   *     ataru    72.4%   (was 20.0%)
   *
   * Juyo is the only form that will not hold a line, and — this is the part
   * the tell promises — it is still twice as likely as chance to play the
   * move you are braced for. It offers a rhythm; it is not made of one.
   */
  _pick() {
    const F = this.form;
    const moves = F.moves;
    if (moves.length < 2) return (this._lastKey = moves[0]);
    // Where the walk stands. `indexOf` rather than a stored index because the
    // lists repeat deliberately and the first match is as good as any: the
    // point is that the SEQUENCE is stable, not which copy of `thrust` it is.
    const i = this._lastKey != null ? moves.indexOf(this._lastKey) : -1;
    const expected = i >= 0 ? (i + 1) % moves.length : -1;
    // RHYTHM is what is left of a form's discipline once `erratic` is spent.
    if (expected >= 0 && rng() < RHYTHM * (1 - clamp(F.erratic ?? 0, 0, 1))) {
      return (this._lastKey = moves[expected]);
    }
    let j = Math.floor(rng() * (moves.length - (expected >= 0 ? 1 : 0)));
    if (expected >= 0 && j >= expected) j++;
    return (this._lastKey = moves[j]);
  }

  _beginAttack(sp, chained = false) {
    const F = this.form;
    this.attackKey = this._pick();
    this.attack = { ...ATTACKS[this.attackKey] };
    if (!chained) this.chainLeft = Math.floor(lerp(F.chain[0], F.chain[1] + 0.99, rng())) - 1;
    // erratic forms vary the wind-up so you cannot metronome them
    const jitter = F.erratic ? lerp(0.7, 1.4, rng()) : lerp(0.92, 1.08, rng());
    this.phase = 'windup';
    this.timer = F.windup * sp * jitter * (chained ? 0.72 : 1);
    this._windupLen = this.timer;
    this._cued = false;
  }

  _beginFeint(sp) {
    this.attackKey = this._pick();
    this.attack = { ...ATTACKS[this.attackKey] };
    this.phase = 'feint';
    this.timer = this.form.windup * sp * 0.55;
    this._feintLen = this.timer;
    this._cued = false;
  }

  /**
   * THE GHOST WAS DRAWN SHORT OF THE BLADE. EVERY ATTACK. ALWAYS.
   *
   * This file's first paragraph is the promise the whole duel rests on: "the
   * blade traces a ghost of where it is about to go". The radii it traced it at
   * were `0.34 * S` and `(0.34 + 1.12) * S` — two constants, the same for every
   * attack in the table, and both of them wrong:
   *
   *   THE ATTACK'S OWN `reach` WAS IGNORED. `Enemy._poseSaber` puts the hands
   *   at `(0.34 + attack.reach) * S`, so a thrust holds its hilt 0.42 further
   *   out than a slash and a lunge 0.5. The ghost drew both at the slash's
   *   radius. Those are precisely the two attacks a player answers by BACKING
   *   OUT OF THE ARC, and the arc they were shown was a half-metre short of the
   *   blade that was coming.
   *
   *   AND THE BLADE'S LENGTH WAS SCALED BY THE BODY, which it is not: an
   *   enemy's saber is a flat 1.12 m whatever size the wielder is. On a big
   *   duellist that drew a longer ghost than the blade; on a small one, shorter.
   *
   * Measured on a real acolyte, an invulnerable target, and the shipped
   * Telegraph — outer radius drawn against the furthest the tip actually
   * reached from the chest during the strike:
   *
   *     attack       ghost    blade    ghost was
   *     slashL       1.518    1.573    0.054 m short
   *     overhead     1.518    1.627    0.108 m short
   *     rising       1.518    1.866    0.347 m short
   *     thrust       1.518    2.058    0.539 m short
   *     lunge        1.518    2.142    0.624 m short
   *
   * Ten attacks out of ten, none of them contained by the shape that claims to
   * contain them. A telegraph you can stand just outside of and still be cut is
   * worse than no telegraph, because it teaches the wrong distance — and it is
   * the distance answer the whole footwork note above is about.
   *
   * IT IS READ OFF THE BLADE NOW, not recomputed beside it. `saber.base` is
   * where the light actually starts this frame and `saber.bladeLength` is how
   * far it goes, both taken about the SAME chest bone `Enemy._poseSaber` poses
   * the weapon about — so the ghost cannot drift from the weapon the way a
   * second copy of `0.34 + 1.12` did, and it picks up `reach` for free because
   * the pose has already spent it. TELE_PAD is the only term that cannot be
   * read off anything, and it is there to keep the shape a BOUND rather than an
   * estimate: the guard sweeps on after the arc is drawn.
   *
   * After, same fixture, at all four difficulties — every attack, every tier,
   * the ghost now CONTAINS the sweep by 0.056 to 0.164 m:
   *
   *     attack       ghost    blade    margin
   *     rising       1.789    1.702    +0.087   (worst case, +0.056 at Knight)
   *     slashL       1.735    1.606    +0.129
   *     thrust       2.170    2.054    +0.116
   *     lunge        2.257    2.141    +0.116
   *     smash        1.850    1.654    +0.195   (widest, on the guard break)
   */
  _drawTelegraph(fill, alpha, pulse) {
    const t = this.telegraph;
    if (!t || !this.attack) return;
    const e = this.e;
    const S = e.A.scale;
    /* THE SAME CHEST THE BLADE IS POSED ABOUT. `Enemy._pose` hands
     * `_poseSaber` the rig's animated chest bone; this drew its arc about
     * `position + 1.34 * S` instead, which is a fixed point on a body that
     * leans, breathes and steps. Two origins for one arc is the same defect as
     * two copies of a table: they agree when the body is standing still and
     * nowhere else. Measured on a mid-strike acolyte the two are up to 0.19 m
     * apart, which is most of the residual the padding below used to have to
     * cover. */
    if (!(e.rig && e.rig.worldPos && e.rig.worldPos('chest', _v3))) {
      _v3.copy(e.position).setY(e.position.y + 1.34 * S);
    }
    const blade = e.saber?.bladeLength ?? 1.12;
    // The emitter, not the hand: the blade starts 0.15 m past the fist and the
    // ghost's inner edge is supposed to be where the light begins.
    const start = Math.max(e.saber?.base ? e.saber.base.distanceTo(_v3) : 0, 0.34 * S);
    t.shape(_v3, e.facing, this.attack.from, this.attack.to, start, start + blade + TELE_PAD * S);
    t.set(TIER[this.attack.tier].colour, fill, alpha * (this.e.lod > 1 ? 0 : 1), pulse);
  }

  /** Does a swing in this direction chamber the current attack? */
  chambersWith(worldSwingDir) {
    if (!this.chamberOpen || !this.attack) return false;
    guardQuat(this.e.facing, 0, _q1);
    _v1.copy(this.attack.to).sub(this.attack.from).applyQuaternion(_q1).normalize();
    return _v1.dot(_v2.copy(worldSwingDir).normalize()) < -0.55;
  }

  get damageScale() { return this.attack ? this.attack.damage : 1; }
  get tier() { return this.attack ? TIER[this.attack.tier] : TIER.light; }

  describe() {
    return `${this.form.name} ${this.form.numeral}`;
  }
}

/* ══════════════════════════════════════════════════════════════════════ */
/*  Blade lock — the contest when two blades meet slowly                  */
/* ══════════════════════════════════════════════════════════════════════ */

export class BladeLock {
  /**
   * A held bind. Both fighters push; the player pushes by driving the mouse,
   * which is the same verb that moves the blade — so winning a lock is still
   * about the wrist, not a button.
   */
  constructor(player, enemy, point) {
    this.player = player;
    this.enemy = enemy;
    this.point = point.clone();
    this.pressure = 0;          // −1 = player losing, +1 = player winning
    this.time = 0;
    this.done = false;
    this.result = null;
    this.strength = (enemy.duel?.form.strength ?? 1) * (enemy.A.scale);
    audio.clash(point, 0.7);
    audio.noise({ dur: 1.4, gain: 0.16, type: 'bandpass', freq: 900, q: 1.2, pos: point });
  }

  update(dt, ctx) {
    this.time += dt;
    const p = this.player, e = this.enemy;
    if (!p.alive || e.dead) { this._finish(e.dead ? 'player' : 'enemy'); return; }

    // hold the two blades together at the contact point
    const mid = _v1.lerpVectors(p.chest, e.aimPoint(_v2), 0.5).setY(
      lerp(p.chest.y, e.chestY, 0.5) + 0.25);
    this.point.lerp(mid, clamp(dt * 6, 0, 1));

    // the player's push is how hard they are actually driving the blade
    const drive = p.control.angVel.length() * 0.055 + p.control.handVel.length() * 0.22;
    const stam = clamp(p.stamina / p.maxStamina, 0, 1);
    const push = drive * lerp(0.45, 1.25, stam) * (p.boonMods.cutPower ?? 1);

    // the duellist leans in on a curve, so a lock has a rhythm to fight
    const lean = (0.55 + Math.sin(this.time * 3.1 + this.strength) * 0.4) * this.strength;

    this.pressure = clamp(this.pressure + (push - lean) * dt * 0.85, -1.2, 1.2);
    p.stamina = Math.max(0, p.stamina - 13 * dt);

    if (ctx.particles && Math.random() < 0.6) {
      ctx.particles.sparkBurst(this.point, null, 3, { speed: 5, embers: false });
    }
    p.saber.strain(0.55);
    e.saber?.strain(0.55);
    p.camera.addShake(0.02);

    if (this.pressure >= 1) this._finish('player');
    else if (this.pressure <= -1 || this.time > 4.5) this._finish('enemy');
  }

  /**
   * SHOVED APART — a Force power big enough to move a body ends the bind.
   *
   * `Enemy._meleeBrain` runs a duellist's kit through a lock now (it used to
   * return before `_forceBrain` and switch the Force off for the 29–41% of a
   * long duel that is spent locked), and the one verb that means anything with
   * two blades crossed is "get off me". This exists so `_castPower` does not
   * have to reach into a private method to say so — and so that a shove ends
   * the bind rather than trying to knock back a body the lock is pinning.
   */
  forceBreak(winner = 'enemy') { this._finish(winner); }

  _finish(winner) {
    if (this.done) return;
    this.done = true;
    this.result = winner;
    const p = this.player, e = this.enemy;
    if (winner === 'player') {
      /* The direction the losing blade was driven, so the guard opens on the
       * side it actually lost. The tip's own travel, not the line between the
       * two bodies: a lock is won by driving ACROSS, and two fighters standing
       * nose to nose have no side between them at all. */
      if (p.saber?.tipVelocity) _v3.copy(p.saber.tipVelocity); else _v3.set(0, 0, 0);
      if (_v3.lengthSq() < 1) _v3.subVectors(e.position, p.position);
      e.stun(1.15, _v3, 1.4);
      e.duel?.interrupt(1.0);
      _v1.subVectors(e.position, p.position).setY(0.35).normalize().multiplyScalar(13);
      e.applyKnockback(_v1, 6, p);
      p.riposteTimer = Math.max(p.riposteTimer, 0.75);
      p.addFlow(0.26);
      p.score += 180;
      audio.ui('good');
    } else {
      p.staggerTimer = 0.75;
      p.stamina = Math.max(0, p.stamina - 26);
      _v1.subVectors(p.position, e.position).setY(0.25).normalize().multiplyScalar(9);
      p.velocity.add(_v1);
      p.camera.addShake(0.5);
      p.damage(6, this.point, e, 'lock');
      audio.ui('bad');
    }
  }
}
