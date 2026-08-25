/**
 * BATTLEFRONT BORZ — the player.
 *
 * A kinematic capsule for movement, a spring-arm camera, and a body whose arms
 * are IK'd to wherever the blade controller put the hilt. The character is not
 * playing an animation of holding a sword — the sword is solved first and the
 * body is solved to match it.
 */

import * as THREE from 'three';
import { Saber, SABER_COLORS } from './Saber.js';
import { SaberController, THRUST_STANDING_SPEED, SPIN } from './SaberController.js';
import { buildJedi, buildShieldBubble } from './Bodies.js';
import { SKIN_TONES, HAIR_COLORS } from '../ui/Menu.js';
import { speciesOf, hoodCut } from './Bodies.js';
import { Rig, BipedAnimator, aimY, limbScale } from './Rig.js';
import { dropSaber, hiltWithinReach, hiltDistanceSq, igniteHilt, hiltBlade,
         ageDropped } from './Dropped.js';
import { Crew, drivableNear, whyNotDrive, crewOf } from './Driving.js';
import { attachCloak, attachSkirt, attachHoodDrape } from './Cloth.js';
import { Body, LAYER, capsuleSpheres, capsule } from '../physics/RapierWorld.js';
import { supportHeight, topOfProps, ceilingHeight, STEP_UP, GROUND_SNAP, CLIMB_RATE } from '../physics/Support.js';
import { walkScale } from '../engine/Bindings.js';
import { RankSet, rankScale } from './Waves.js';
import { parryScale, TOUGHNESS, impactDamage, RETURN_CONE } from './Combat.js';
/* THE OTHER HALF OF THE FORCE CONTEST, IMPORTED RATHER THAN RE-DERIVED. The
 * three constants that decide what a point of pool buys live over
 * `forceResistance` in Enemy.js, and one contest read out of two rulebooks is
 * exactly the drift `Powers.js` exists to have ended (HANDOFF §2.3/§2.4).
 * Enemy.js imports nothing from this file, so the edge is one-way. */
import { forceResistance, gripClaim, gripHolders, gripRelease, gripSeize, heldMass, IMPULSE_AS_HP,
         limitBackpedal, addShove, newShoveFrame } from './Enemy.js';
import { POWER_COST, SENSE_DRAIN } from './Powers.js';
/* FLAGSHIP §7's BREAK verb, and both are leaves — see the header of each. */
import { MORALE } from './Morale.js';
import { shakeNerve } from './Nerve.js';
import { Stratagems, DIRS, DIR_ACTION } from './Stratagems.js';
import { bodyOf } from '../engine/Presence.js';
import { clamp, lerp, damp, smoothstep, dampVec, makeRng, TAU } from '../engine/MathUtil.js';
import { audio } from '../engine/Audio.js';
/* The player's own larynx, for the words a stratagem code is spoken in — see
 * `_sayCall`. `voiceAt` is the same reader `Announcer.voice` uses, so there is
 * one answer to "which of the five is this player". */
import { voiceAt } from '../engine/Voice.js';

/**
 * The skin tone at an index, on the rack that species actually has.
 *
 * A Twi'lek built from the shared human row is a beige Twi'lek — the rack
 * belongs to the species, and the indices are relative to it.
 */
function skinHex(species, i) {
  const sp = speciesOf(species);
  const rack = (sp && sp.skinTones && sp.skinTones.length) ? sp.skinTones : SKIN_TONES;
  return (rack[i ?? 0] || rack[0])?.hex;
}

const rng = makeRng(1212);
const _v1 = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3();
const _v4 = new THREE.Vector3(), _v5 = new THREE.Vector3(), _v6 = new THREE.Vector3();
const _q1 = new THREE.Quaternion(), _q2 = new THREE.Quaternion();
const _q3 = new THREE.Quaternion(), _q4 = new THREE.Quaternion();
/** The two wrist targets, which have to survive the whole arm solve, and their scratch. */
const _v7 = new THREE.Vector3(), _v8 = new THREE.Vector3(), _v9 = new THREE.Vector3();
/** One colour object for every `lightUp` request the channel posts — the pool
 *  reads it and does not keep it, so a fresh Color per frame is garbage. */
const _COL_LIGHT = new THREE.Color(0x9fd8ff);
/** _gripPole's own, so it cannot tread on the arm solve running around it. */
const _v10 = new THREE.Vector3(), _v11 = new THREE.Vector3();
const _v12 = new THREE.Vector3(), _v13 = new THREE.Vector3();
const _v12Q = new THREE.Quaternion(), _q5 = new THREE.Quaternion();
// The Force powers get scratch of their own. _v1.._v6 are threaded through the
// blade solve, the collide pass and the body pose in the same frame, and a
// gesture that borrowed one of them would corrupt whichever of those ran next —
// the exact class of bug that is invisible until an arm folds inside out.
const _g1 = new THREE.Vector3(), _g2 = new THREE.Vector3(), _g3 = new THREE.Vector3();
/* The flown blade's own three, and they are its own on purpose: `_cutWithHeld`
 * holds a segment across a loop that calls out to `Enemy.damage`, and every
 * shared scratch vector in this file is fair game for anything downstream. */
const _tk1 = new THREE.Vector3(), _tk2 = new THREE.Vector3(), _tk3 = new THREE.Vector3();
const _tkA = new THREE.Vector3();

/** Squared distance from a point to a segment. */
function segmentPointSq(p0, p1, pt) {
  _tkA.subVectors(p1, p0);
  const len = _tkA.lengthSq();
  if (len <= 1e-9) return p0.distanceToSquared(pt);
  let t = (pt.x - p0.x) * _tkA.x + (pt.y - p0.y) * _tkA.y + (pt.z - p0.z) * _tkA.z;
  t = clamp(t / len, 0, 1);
  return _tkA.multiplyScalar(t).add(p0).distanceToSquared(pt);
}
const _g4 = new THREE.Vector3(), _g5 = new THREE.Vector3();
/** Where a contested hold resolves to. Its own vector rather than one of the
 *  `_v` pool because `_updateGrip` is holding `hold` (_v1) live across the call
 *  and `_sweepHeld` borrows most of the rest. See `gripClaim` in Enemy.js. */
const _gc = new THREE.Vector3();
/** `applyKnockback` scales the shove when the pool blunts it, and the vector it
 *  is handed is somebody ELSE's scratch (`Enemy._castPower` passes its `_v2`) —
 *  so it copies into its own rather than writing through the caller's. Exactly
 *  the reason `Enemy.js` keeps a `_res` of its own. */
const _res = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);
const FWD = new THREE.Vector3(0, 0, -1);
/** Read-only stand-in for a missing pelvis offset. Never written to. */
const _ZERO = new THREE.Vector3();
/** Reused by syncAim, which runs twice a frame and must not allocate. */
const _eul = new THREE.Euler();

/* ══════════════════════════════════════════════════════════════════════ */
/*  The Force's one hard number                                           */
/* ══════════════════════════════════════════════════════════════════════ */

/**
 * How many kilograms a grip can hold at forcePower = 1, and how that scales.
 *
 * Before this there was no such number, and that was the bug. The grip wrote a
 * held body's VELOCITY directly, so — measured — a 900 kg pillar and a 22 kg
 * crate both travelled 5.01 m in the first second and a hurl launched every
 * mass in the game at exactly 26 m/s. Mass was invisible. The only real size
 * limit anywhere was Enemy.grippable (`!A.big && !A.boss`), a boolean no
 * setting could move: the 900 kg spider walker and the 1400 kg Acklay were
 * un-liftable at forcePower 4 exactly as they were at 0.25.
 *
 * 220 kg at 1x is read off the real mass table — it takes a droideka (210) and
 * a vaporator (180) but not a spire (500). The 1.5 exponent is read off the
 * ends of the slider: 0.25x lands at 27.5 kg, which is one crate and you feel
 * it; 4x lands at 1760 kg, which clears the heaviest body in the game with room
 * to spare. So the top of the slider genuinely moves genuinely large things,
 * and the middle of it is a progression rather than a switch.
 */
const LIFT_AT_ONE = 220;
const LIFT_EXPONENT = 1.5;

/**
 * WHAT HOLDING SOMETHING COSTS PER SECOND — and the one statement anywhere in
 * this file about what a PERSON costs over an object.
 *
 * `_updateGrip` charges `base + rise × (mass / capacity)` and has always
 * charged a living body more than a crate: 11 against 7 empty-handed, 20
 * against 13 at the cap. That difference is not decoration, it is the game's
 * own answer to "a person is not a crate", arrived at for exactly the act the
 * stasis field also performs — holding a thing still, per second.
 *
 * The field needs the RATIO rather than the table, because a field holds
 * whatever walked into it instead of one chosen mass. So it reads
 * `PERSON_OVER_PROP` off these two numbers. Typing 1.57 beside the field would
 * be the hand-written twin of a table five hundred lines away, and the twin is
 * this repository's signature defect.
 */
export const HOLD_COST = { prop: { base: 7, rise: 6 }, person: { base: 11, rise: 9 } };

/**
 * THE FORCE BARRIER — what it costs to hold and what it costs to be shot at.
 *
 * "did you already add the force shield/bubble in the game? i'd already asked
 *  for it but I could have missed it."
 *
 * They had not missed it: `POWER_COST` held eleven verbs and not one of them
 * shielded anything. This is the whole of the power's economy and every number
 * in it answers a way the obvious version is bad:
 *
 *   `hold`   6 a second. A barrier that cost nothing to keep up would be a
 *            barrier you never lower, and a player standing inside a permanent
 *            bubble is a player who has stopped playing this game. At 6 a full
 *            base pool holds it about sixteen seconds with nothing hitting it,
 *            which is long enough to cross a street under fire and far too
 *            short to live in.
 *   `bolt`   4 a bolt, and this is the interesting number. A single rifle is
 *            noise; a FIRING LINE is what a shield is for, and eight droids at
 *            a bolt a second each is 32 Force a second — the pool empties in
 *            three. So the barrier answers a volley and cannot outlast one,
 *            which is exactly the shape the player asked for when they asked
 *            for a Force resource that means something.
 *   `blunt`  what a blast keeps. An explosion is not stopped by it, it is
 *            SOFTENED — 0.35 of the damage still arrives — because a bubble
 *            that made you immune to the thing you called down on yourself
 *            would delete the one decision stratagems are made of.
 *   `radius` 2.1 m. Wide enough to cover somebody standing next to you, which
 *            is what makes it worth raising over a wounded man you are mending;
 *            narrow enough that a squad cannot shelter in it.
 */
export const SHIELD = { hold: 6, bolt: 4, blunt: 0.35, radius: 2.1, rise: 0.18, fall: 0.3 };

/**
 * THE SABER, OFF THE HAND — catching it, lighting it, and flying it.
 *
 * The player, at length:
 *
 *   "if you force picked up the saber off the ground and called it back to you
 *    even at the closest distance you could not pick it up in the air so I
 *    think it could be cool that once you bring it and retract it as close to
 *    yourself as possible you just pick it up from the air… in that same vein
 *    it should be possible to pick up the lightsaber with the force, turn it on
 *    or off using the force, and then with the force being able your
 *    turn/manipulate the saber anywhere you want on the battlefield within a
 *    certain distance (uses a lot of force power up etc. obviously)"
 *
 * Three separate things, and only the third of them is new machinery:
 *
 *   THE CATCH was a measurement bug and not a missing feature. The Force grip
 *   parks what it holds a floor of 1.4 m in FRONT of the chest and the pick-up
 *   test measured to `position`, which is the feet — 1.98 m against a 1.6 m
 *   reach, so the closest the Force could ever bring your own weapon was 38 cm
 *   outside your hand, silently, for ever. `Dropped.hiltDistanceSq` measures to
 *   the standing axis now, and `reach` here is a hand's reach off it.
 *
 *   LIGHTING IT is `Dropped.igniteHilt`, which was already most of the way
 *   there for the hilt a dying duellist drops still burning.
 *
 *   FLYING IT is the grip, which already moves a loose object anywhere inside
 *   `forceReach` and already charges for mass, distance and time. What a lit
 *   hilt adds is the CUT — a blade that goes through a droid is not a crate
 *   bumping into one — and the surcharge the note asks for: `lit` a second on
 *   top of whatever the hold already costs, which roughly triples the price of
 *   holding a hilt and makes a blade you are flying across the field the most
 *   expensive thing the Force can be doing.
 */
export const TK = {
  /** How far off the standing axis a hilt can be taken out of the air. */
  reach: 2.2,
  /** To strike a light at a distance, once. */
  ignite: 10,
  /** …and to keep it burning out there, a second, on top of the hold. */
  lit: 9,
  /** What the flying blade does to what it crosses, and how often it may. */
  cut: 34,
  cutGap: 0.4,
  /** Under this much stamina, a solid hit takes the weapon out of your hand. */
  staggerStamina: 12,
  /** …and not twice in a row: a disarm you cannot recover from is a death. */
  disarmGap: 6,
};
/**
 * 11 / 7 = 1.571 — a living body against an object, read off HOLD_COST.
 *
 * Exported so a check can ask the game what the ratio IS rather than typing
 * 1.571 into an assertion. An instrument that restates a rule eventually
 * disagrees with it, and it fails in the direction nobody checks.
 */
export const PERSON_OVER_PROP = HOLD_COST.person.base / HOLD_COST.prop.base;

/**
 * How long ONE refresh keeps an arrested body arrested, in seconds.
 *
 * The hold is a stun that `_updateStasis` renews every frame, and this is the
 * window between renewals — a leash, not a duration. Anything that stops the
 * update loop without releasing (a level torn down mid-hold, a host that
 * stopped sending, a throw) frees the body a fifth of a second later instead
 * of forever. `topple()` shows what forever looks like — `stun(9999)` — and it
 * is right there because a toppled walker has exactly one way back up; a field
 * has five ways to end and every one of them would have to remember.
 *
 * 0.2 s is twelve frames at 60 Hz, and deliberately shorter than
 * `DuelBrain.stagger`'s own 0.32 s floor, so the beat a released duellist
 * spends finding its guard is the stagger's number rather than a second one
 * competing with it.
 */
export const STASIS_GRACE = 0.2;

/**
 * Force gestures — the arm that reads the power.
 *
 * Every offset is in the AIM frame and in metres from the chest: `out` along
 * where you are looking, `side` to the player's right, `up` world up. `attack`
 * and `release` are seconds and are deliberately lopsided, because a Force
 * gesture is a snap and a settle; symmetric timing reads as a wave.
 *
 * `palm` rolls the hand from pointing at the target (0) to a flat palm facing
 * it (1). `lean` and `twist` are radians added to the spine, so the whole torso
 * commits instead of just the arm — a push you can only see in the forearm does
 * not look like it moved a crate.
 *
 * The saber lives in the right hand and the blade solve owns that arm outright,
 * so every gesture here is left-handed and pays for the rest of its read with
 * the spine, the head and the cloak.
 */
const GESTURES = {
  push:      { attack: 0.09, release: 0.40, out: 0.66, side: -0.04, up: 0.10, palm: 0.85, lean: 0.30, twist: -0.12 },
  pull:      { attack: 0.12, release: 0.46, out: -0.24, side: -0.36, up: 0.20, palm: 0.15, lean: -0.28, twist: 0.18 },
  grip:      { attack: 0.18, release: 0.26, out: 0.56, side: -0.14, up: 0.18, palm: 0.35, lean: 0.10, twist: -0.08, sustain: true, track: true },
  hurl:      { attack: 0.07, release: 0.36, out: 0.78, side: 0.02, up: 0.00, palm: 0.30, lean: 0.36, twist: -0.24 },
  stasis:    { attack: 0.13, release: 0.30, out: 0.50, side: -0.18, up: 0.36, palm: 1.00, lean: -0.10, twist: -0.06, sustain: true, track: true },
  unleash:   { attack: 0.06, release: 0.38, out: 0.74, side: 0.08, up: 0.12, palm: 0.55, lean: 0.32, twist: -0.26 },
  rend:      { attack: 0.22, release: 0.62, out: 0.48, side: -0.44, up: 0.28, palm: 0.60, lean: 0.06, twist: 0.30 },
  lightning: { attack: 0.08, release: 0.52, out: 0.70, side: -0.08, up: 0.14, palm: 0.70, lean: 0.24, twist: -0.14 },
  sense:     { attack: 0.26, release: 0.62, out: 0.10, side: -0.28, up: 0.42, palm: 0.00, lean: -0.12, twist: 0.10 },
  cast:      { attack: 0.06, release: 0.34, out: 0.58, side: -0.30, up: 0.04, palm: 0.20, lean: 0.30, twist: -0.26 },
  // Force heal is the one gesture that is not thrown at anything: the palm
  // comes IN to the chest and stays there for as long as the channel holds.
  mend:      { attack: 0.30, release: 0.45, out: 0.02, side: -0.16, up: -0.06, palm: 0.90, lean: -0.10, twist: 0.06, sustain: true },
  /**
   * THE COMM, and it is the only gesture here that is not the Force at all.
   *
   * Player note #31: *"imagine you begin the process of calling one in, you
   * hold up your wrist and speak into it, every keystroke a word"*. The hand
   * comes IN and UP — 0.30 up and 0.24 back toward the face, off the chest
   * frame every other row is written in — so the wrist ends up at the mouth
   * rather than out in front of the body. `palm` is high because the back of
   * the wrist has to face away from the speaker for the comm on it to be
   * pointing at them.
   *
   * The spine barely moves. Every other gesture here commits the torso because
   * it is throwing something; this one is a man talking into his sleeve while
   * trying to watch the field, and a lean would read as a bow.
   *
   * SUSTAINED, because the code takes as long as it takes. `_stratagemInput`
   * starts it when the key goes down and ends it when the call is away.
   */
  comm:      { attack: 0.16, release: 0.30, out: -0.24, side: -0.10, up: 0.30, palm: 0.85, lean: 0.04, twist: 0.10, sustain: true },
  /**
   * PAINTING THE TARGET. The arm goes OUT and stays out, pointing at the mark,
   * and it TRACKS — the beam follows the aim, so the hand has to as well.
   * Further out than a push (0.82 against 0.66) because nothing is being
   * thrown: the arm is extended to hold a designator on a thing, which is a
   * longer, stiller shape than a shove.
   */
  designate: { attack: 0.14, release: 0.28, out: 0.82, side: -0.06, up: 0.06, palm: 0.05, lean: 0.14, twist: -0.10, sustain: true, track: true },
};

/**
 * A pinned point in space that pretends to be a lit blade.
 *
 * BoltPool already knows how to arrest a bolt: while `bolt.held` is set it is
 * placed at `held.saber.pointAt(t)` every frame, it stops moving, it stops
 * ageing, it drops out of threatsNear so the aim assist ignores it, and it is
 * drawn as a fat, crackling, bleached version of itself instead of a streak.
 * That is the entire visual and behavioural vocabulary a Force-stopped bolt
 * wants; the only difference is that this anchor does not move. So the anchor
 * IS the blade interface, three members wide, and Force stop inherits all of it
 * rather than growing a second, subtly different copy.
 */
class StasisAnchor {
  constructor(p) { this.p = p.clone(); this.ignition = 1; this.coreWidth = 1; }
  pointAt(t, out) { return out.copy(this.p); }
}

/**
 * What can be taken apart. Flesh does not disassemble — an Acolyte or an Acklay
 * has to be cut, which is what the blade is for.
 *
 * DERIVED, NOT TYPED. This was
 *
 *     const MECHANICAL = /b1|b2|droid|deka|walker|remote|dummy/;
 *
 * — a hand-written list of type names, and the roster has fourteen. It did not
 * match `bodyguard`, so Force Rend silently refused on the IG general: a
 * 1050 hp droid, the one enemy in the game the power most obviously exists
 * for, and the refusal was a `continue` with no message. It was the FOURTH
 * copy of the same classification found in this audit — the Announcer's voice
 * map, Presence's body map and Enemy's spark test all had their own, all
 * missing the same three names, all written the same day the roster had eleven
 * entries in it.
 *
 * `bodyOf` answers from the archetype RECORD the enemy is carrying — its
 * `custom`, its `toughness`, whether it holds a blade — so a body added to
 * ARCHETYPES tomorrow is classified correctly without anyone remembering this
 * line exists.
 */
const isMechanical = (e) => bodyOf(e).droid;

/** Bones a droid still needs to be a droid. Never the first thing to come off. */
/**
 * THE FOUR HEIGHTS A FIGURE IS MEASURED AT, in metres, on a 1.78 m human.
 *
 * They were four literals typed into two expressions in `_updateBlade`, which
 * is exactly the shape that cannot be scaled by a species: there was no name
 * to multiply. Everything that reads them multiplies by `player.stature`.
 *
 * The crouch pair are not the standing pair times a constant — a crouch takes
 * more off the eye (0.40 m) than off the chest (0.34 m), because the spine
 * folds forward as well as down.
 */
const CHEST_H = 1.34, CHEST_H_CROUCH = 1.0;
const EYE_H = 1.62, EYE_H_CROUCH = 1.22;
/**
 * What all four of those are heights ON. `frame.stature` is authored in METRES
 * — the small-folk row says 0.66 and its own comment says "the figure comes
 * out 3.6 heads tall at 0.72 m" — so the ratio, not the field, is the
 * multiplier. A species that declares no stature is this tall.
 */
const HUMAN_H = 1.78;

/**
 * What is left of a pace that points behind you — see `_move`, and Enemy.js's
 * `limitBackpedal`, which is the law and is shared. The bodies use 0.5; this is
 * the player's share of the same rule and the number is argued where it is
 * spent.
 */
const PLAYER_BACKPEDAL = 0.72;

const CORE_BONE = /^(hips|spine|chest|body|core|pelvis)$/;

/** Anything it is standing on — see forceDisassemble for why these go last. */
const LEG_BONE = /thigh|shin|foot|femur|tibia|tarsus|^leg/;

/* ══════════════════════════════════════════════════════════════════════ */
/*  Camera                                                                */
/* ══════════════════════════════════════════════════════════════════════ */

/**
 * How much of the pelvis's own motion the first-person eye rides. ONE number,
 * applied to every axis, and it is 1 because a head is bolted to a spine.
 *
 * This used to be two numbers and neither of them said so. The pelvis takes the
 * full gait bob and the camera took `bob * 0.5`; the pelvis sways up to 30mm
 * laterally per step and the camera took none of it at all; and the pelvis
 * drops 41mm into a run and the eye did not move. Measured on the walk, with
 * the whole upper body expressed in the eye's own view space — which is what
 * the player is actually looking at:
 *
 *       standing   chest 22.9mm across, 6.0mm up    (idle sway, uncancelled)
 *       1.6 m/s    chest 29.2mm across, 26.4mm up
 *                  shoulder 20.1 / 32.3 / 17.3mm in x/y/z
 *       4.6 m/s    shoulder 5.4 / 71.2 / 21.9mm
 *
 * Seventy-one millimetres of your own shoulder sliding up and down the screen,
 * 27cm from the lens. That is not a gait, it is the body and the camera being
 * two separate simulations of the same person, and it is the largest single
 * source of the "jumbled mess" the player described. At a gain of 1 the number
 * is zero by construction, in every axis, at every speed.
 */
/* Exported with EYE_MAX_SPEED below so `viewmodel.mjs` proves the cap against
 * the game's own two numbers instead of retyping them beside the table that
 * owns them (HANDOFF §2.3). */
export const EYE_FOLLOW = 1;

/**
 * The fastest a neck is allowed to carry the eye, m/s.
 *
 * A rate cap and not a filter, deliberately: a damped follower that tracks the
 * 3 Hz bob closely enough to leave no residual swim (rate 60 leaves 4.7%) does
 * essentially nothing to a one-frame spike, and one slow enough to absorb the
 * spike puts 19% of the bob back on the screen as swim. A cap is exact in the
 * regime that matters and only engages where the body is already wrong.
 *
 * It has to engage at all only because the pelvis is still not smooth.
 * SWING_LAND in Rig.js took the worst single-frame pelvis travel from 69.6 mm
 * to 43.9 mm at a 4.6 m/s run and from 88.3 to 87.5 at a 7.4 m/s sprint, but
 * 87 mm in a 1/60 s frame is 5.2 m/s of pelvis and no neck does that. The
 * residue is the swing foot arriving at a measured 5.3 m/s with the reach clamp
 * chained to it — a defect in the gait, named where it lives in Rig.js rather
 * than hidden behind a filter here.
 *
 * 2.8 m/s and not 2.2: the game's ordinary forward speed IS 4.6 m/s, where the
 * pelvis peaks at 43.9 mm/frame = 2.63 m/s. A 2.2 cap trimmed 5.9 mm there —
 * a filter running during normal play, putting 5.9 mm of swim back on the
 * screen. 2.8 leaves the run untouched and still refuses 41 mm of the sprint.
 */
export const EYE_MAX_SPEED = 2.8;

/* ══════════════════════════════════════════════════════════════════════ */
/*  The first-person viewmodel                                            */
/* ══════════════════════════════════════════════════════════════════════ */

/**
 * WHERE THE WIELDER'S OWN SHOULDERS GO WHEN THEY ARE LOOKING OUT OF THEIR OWN
 * EYES — which, until now, was "wherever the third-person body happened to put
 * them", and that is not a place a camera can be.
 *
 * Measured on the built figure, the right shoulder joint in the eye's own view
 * space while standing still:
 *
 *       x  +0.153 m   (to the right)
 *       y  -0.224 m   (below the lens)
 *       z  +0.068 m   ← BEHIND THE LENS
 *
 * The near plane in first person is 0.045 m, so both upper arms began 6.8 cm
 * behind the camera and crossed the camera plane on their way to the hilt. The
 * rasteriser cannot draw that: it clips at the plane, so what reached the
 * screen was two forearms erupting out of the bottom corners with no visible
 * origin, sliced flat. That is the "jumbled mess", and no amount of tuning the
 * pose could have fixed it, because the problem was the ARM'S ROOT, not its
 * pose. The whole distance from the shoulder to the lens was 0.279 m.
 *
 * So the shoulders move to the view, which is what every first-person game
 * does. Three numbers, in the aim frame, in metres from the eye:
 *
 *   Z is IN FRONT and it has a hard floor. The deltoid is a tube of radius
 *   0.055 m about the joint, so anything closer than 0.045 + 0.055 = 0.10 m
 *   has its own shoulder sliced open by the near plane. 0.115 leaves 1.5 cm.
 *
 *   Y is how far below the lens, and it is deeper than anatomy (0.224) on
 *   purpose: the shoulders have to sit outside a 60-degree frustum at 0.115 m
 *   out, whose half-height there is only 0.066 m, or you are looking at your
 *   own deltoids all day.
 *
 *   X is the half-width of the shoulder line. 0.21 is a real one.
 */
const VM_SHOULDER_X = 0.21;
const VM_SHOULDER_Y = -0.32;
const VM_SHOULDER_Z = 0.115;
/** The clavicle's own slope, kept off the skeleton's rest so the deltoid sits right. */
const VM_CLAV_RISE = 0.18;
/** Body left is the camera's left: clavL points along -right. */
const VM_CLAV = [['clavL', -1], ['clavR', 1]];

/**
 * How far below the eye the first-person blade is solved from.
 *
 * This was 0.26 and the consequence is not visible in any still the project
 * could previously take: measured off tools/fpview.mjs, with the camera level,
 * the hilt sat 43 degrees off the view axis against a 30-degree half-frustum.
 * THIRTEEN DEGREES OFF THE BOTTOM OF THE SCREEN. Looking straight ahead, a
 * first-person player of a lightsaber game could see the blade and no part of
 * their own hands, gloves, bracers or hilt at all — which is a fair description
 * of what "the hands are a jumbled mess" feels like when the mess is invisible
 * and only its consequences are not.
 *
 * 0.15 is an 11 cm raise and it is measured, not chosen. Off the level-gaze
 * pose, angles below the centre of a 30-degree half-frustum:
 *
 *       hilt emitter   18.8 deg     on screen
 *       right wrist    27.2 deg     on screen
 *       hilt grip      29.8 deg     on the bottom edge, 0.2 deg inside
 *       left wrist     32.8 deg     still 2.8 deg off the bottom
 *
 * So the weapon and the sword hand are on screen and the off hand is not quite.
 * It stops at 11 cm because everything here is REAL: this anchor is where the
 * blade is SOLVED from, so raising it raises the blade in the world, and a
 * lightsaber whose base has climbed a foot is a different weapon, not a
 * different view. Going further wants the blade's own framing checked against
 * the top of the frame — tools/fpview.mjs, `--only 'level gaze'` — and that is
 * a picture, not an inequality.
 */
/**
 * How close the blade may come to the lens and still throw a heat haze.
 *
 * 0.55 m is the first-person hilt's own distance from the eye plus a margin:
 * the sword hand sits about 0.5 m out, so a held blade's midpoint is always
 * further than this and first person keeps its shimmer, while anything that
 * comes at the camera — a recalled saber, a blade knocked out of your hand —
 * stops smearing the lens on its way past.
 */
const HEAT_NEAR = 0.55;

/**
 * UNLEASH, as four numbers, each argued against `forcePush`'s in the method
 * that spends them. Named here rather than typed into the call so the HUD's
 * price list and tools/checks can read the same values the power uses.
 */
export const UNLEASH = { radius: 11, impulse: 34, damage: 30, stun: 1.6 };

/**
 * `_shockwave`'s own direction vector, and it may not be one of the shared
 * `_v*` scratches. See the note over that method: `applyKnockback` re-enters
 * code that borrows them, so a shared vector is clobbered part way through the
 * loop and every body after that point is thrown in the wrong direction.
 */
const _shockDir = new THREE.Vector3();

/**
 * How far in front of the chest a held body still counts as cover, and how much
 * of the bolt it takes on the player's behalf.
 *
 * The reach is what makes it a shield and not an aura — hold a crate behind
 * your shoulder and it stops nothing. The bite is what stops it being an
 * invulnerability window: what the shield blocks, the shield TAKES, so a droid
 * used as cover is being shot to pieces while you hold it. That is the bargain.
 */
const SHIELD_REACH = 3.2;
const SHIELD_BITE = 1.0;

/**
 * FORCE CHOKE's bite, as a fraction of the victim's own maximum health per
 * second: where it starts, and where it ramps to over three seconds. See the
 * note in _updateGrip for why it is a fraction and not a number.
 */
const CHOKE_RATE = 0.12;
const CHOKE_RATE_MAX = 0.30;

/**
 * WHERE A PULL PUTS THINGS, and how long they stay open when they land.
 *
 * PULL_TO is measured from the chest and is 2.2 m because that is inside the
 * blade's own reach — a 1.15 m blade held at arm's length covers about 2.4 m
 * from the chest — so the thing you pulled arrives already cuttable. Putting
 * it at 1.4 (the grip's minimum) drags bodies THROUGH the player, which reads
 * as a bug however correct the physics is.
 *
 * PULL_COAST is how far a knocked body actually travels per metre-per-second
 * of the speed it was given, READ OFF THE INTEGRATOR rather than guessed:
 * `applyKnockback(gentle)` sets knockTimer to 0.35 s during which Enemy._move
 * applies no horizontal damping at all, and after that it damps toward zero at
 * 6 s⁻¹, which carries a further v/6. So travel = v·(0.35 + 1/6) = 0.517·v and
 * the speed that closes a gap `g` is `g / 0.517`.
 *
 * The first cut of this used 6 m/s per metre — three times too much, because it
 * assumed the WALKING damp rate applied during the knock. Measured, a pull from
 * 4 m put its victim 18.4 m behind the player. The number is derived here
 * rather than tuned because a tuned constant would have to be re-tuned every
 * time either of those two numbers moved, and neither of them is in this file.
 *
 * PULL_MAX is scaled by heft at the call site, so mass shows itself as TIME:
 * a B1 crosses twelve metres in about a quarter of a second and a beast, at
 * the 0.28 floor of the heft curve, takes four times as long over the same
 * ground. Falling short is the wrong way to say "heavy" — the note asks for
 * things to arrive, and something that stops two thirds of the way just looks
 * like the power missed.
 *
 * PULL_OPEN is the window the arrival leaves — see `openness` in Combat.js.
 * A third of a second is about one swing at combat tempo, which is the point:
 * long enough to be a combo, short enough that it has to be intended.
 */
const PULL_TO = 2.2;
const PULL_COAST = 0.35 + 1 / 6;
const PULL_MAX = 70;
const PULL_OPEN = 0.34;

/**
 * THE AIR DODGE IS A FLIP, and one line decides which flip it is.
 *
 * The note asks for "a coordinated flip in the input direction", and the
 * temptation is a table: front flip on W, back flip on S, barrel roll on A
 * and D, and then four more entries for the diagonals that nobody writes, so
 * a dodge held forward-and-left does one of the four cardinal animations and
 * travels somewhere else. The axis of a somersault is always horizontal and
 * always perpendicular to the way you are going, which is `up × direction` —
 * one expression, exact for every direction including the diagonals, and it
 * degenerates correctly: dodging forward gives a front flip, sideways gives a
 * barrel roll, and forty-five degrees gives the corkscrew between them.
 *
 * It is applied to the RIG ROOT about the body's own centre, after the gait
 * has posed every bone in world space and before the blade and the arms are
 * solved. That ordering is the whole trick: the legs are IK'd to feet on the
 * ground during the gait, so rotating the hips alone would spin the torso off
 * a pair of legs still reaching for the floor. Rotating the root turns the
 * whole assembly rigidly, exactly as a body in the air does, and because
 * `_updateBlade` reads the chest's world position AFTER this, the blade and
 * both arms come round with it rather than being left behind in the air.
 *
 * 0.52 s is one full turn. Slower than that and it reads as a slow-motion
 * replay; faster and the figure is a blur with no readable pose at the top.
 * The camera does not turn with it — a first-person somersault is unplayable,
 * and in third person the shot is worth more than the gimmick.
 */
const FLIP_TIME = 0.52;
/**
 * THE DIVE, in three numbers. See `_tryDive` for why each is derived rather
 * than chosen.
 *
 * `DIVE_SPEED` clears `_land`'s 15 m/s shockwave threshold twice over and lands
 * at the `power` cap. `DIVE_CLEAR` is the height a dive has to start above the
 * ground to be one at all — below it there is nothing to fall from and it would
 * only cancel the jump you are in. `DIVE_STAMINA` is the dash's 18 again,
 * because it buys the same thing: one committed movement that cannot be spammed
 * through a fight.
 */
const DASH_STAMINA = 18;
/* Exported so the Codex card for the dive quotes these three rather than
 * retyping them beside the table that owns them — the drift this codebase
 * keeps finding (HANDOFF §2.3): the Codex's parry window was wrong on three of
 * four difficulties and the Colosseum's card claims 30 000 seats against a
 * measured 6 952, both from a number typed next to its source. */
export const DIVE_SPEED = 30, DIVE_CLEAR = 1.2, DIVE_STAMINA = DASH_STAMINA;
/**
 * SPRINTING USED TO COST NOTHING, and neither did dashing.
 *
 * The drain is 11/s while sprinting and `_regen` handed back
 * `(16 + 10*(1 - combatIntensity)) * staminaRegen` every frame unconditionally
 * — a FLOOR of 13.6/s at the worst order multiplier and full combat heat, a
 * ceiling of 26/s out of it. Measured on a default profile: 30 s of sprinting
 * from an EMPTY bar ended at 100.0 stamina having covered 222.8 m, and 20 s
 * ended at 100.0 over 148.7 m. The dash inherited it — 18 a dash against 26/s
 * of regen and a 0.55 s cooldown is a net 1.6 — so the two most committing
 * movements in the game were both free.
 *
 * The rule is the one every stamina bar has: it does not refill while it is
 * being spent, and not for a moment after. `STAMINA_HOLD` is longer than
 * `cooldowns.dash` (0.55) on purpose — a dash chained at its own cooldown
 * ceiling must not refund itself between dashes, which is exactly what made 27
 * dashes in 15 s possible without dropping below half a bar.
 *
 * `SPRINT_START` is hysteresis and it is not decoration. The sprint gate is
 * `stamina > SPRINT_FLOOR`, so with regen paused the bar lands on that line and
 * a single regen frame lifts it back over: the run would flicker on and off at
 * one frame in thirty-six, in the speed, the FOV and the gait at once. You
 * cannot break into a run on fumes; once you are running you may spend down to
 * the last of it.
 */
const SPRINT_DRAIN = 11, SPRINT_FLOOR = 4, SPRINT_START = 20, STAMINA_HOLD = 0.6;

/**
 * HOW FAST THE BLADE HAS TO MOVE BEFORE THE AIR NOTICES, in m/s.
 *
 * It was a literal 11 at its one call site and `NEXT.md` had the consequence
 * written down without the fix: "The overhead attack has never made a swing
 * sound. It peaks at 10.8 m/s against an 11 m/s whoosh threshold. One number."
 * The heaviest-looking attack in the game — the one the player singled out as
 * the one that feels real — was the only one that swung in silence.
 *
 * Measured on the shipped controller, every attack driven through a real
 * Player, peak `swingSpeed` in m/s:
 *
 *     walking with the blade out      0.03
 *     running with the blade out      0.02
 *     left click, one cut            14.34
 *     left click, three-hit combo    19.46
 *     overhead, tapped               10.79   ← silent at 11
 *     overhead, charged              17.20
 *     spin                           23.68
 *
 * `swingSpeed` is the blade's motion with the carrier's own velocity taken
 * out, which is why walking reads 0.03 and not 4: the number this threshold
 * separates from an attack is not a run, it is a body standing still. So the
 * bar was never doing the job the comment claimed and 11 was simply the
 * fastest attack of the day minus a little.
 *
 * 8.5 is set from the table rather than from feel: it is two hundred times the
 * fastest thing that is not a swing and a fifth below the slowest thing that
 * is, so every deliberate attack sounds and nothing else does. The 0.19 s
 * spacing beside it is what stops a combo becoming one long hiss.
 */
const SWING_WHOOSH = 8.5;

/** How much bigger a dive's landing is than the same speed arrived at by
 *  accident. Radius and impulse take it once, damage twice — the blade is what
 *  makes the difference and the blade is a damage term. */
const DIVE_LAND = 1.45;

/**
 * FORCE LIGHTNING, as an arc. See `forceLightning` and `_lightningArc`.
 *
 * `LIGHTNING_DAMAGE` is the 46 it always did, kept so the power's strength at
 * the first body is unchanged and only its REACH is new. `CHAIN` is hops past
 * that first body, `REACH` is how far a hop can find the next conductor, and
 * `FALLOFF` is what each hop keeps: three hops at 0.62 take 46 to 11, which is
 * a body that has plainly been hit and is plainly not the target.
 *
 * `STEPS_PER_M`, `WANDER` and `FORK` are the drawing, not the rule: samples per
 * metre of arc, how far one step of the walk may stray, and the chance a sample
 * throws a dead-end branch.
 */
const LIGHTNING_RANGE = 22, LIGHTNING_DAMAGE = 46;
const LIGHTNING_CHAIN = 3, LIGHTNING_REACH = 6.5, LIGHTNING_FALLOFF = 0.62;
/**
 * How far off the aim a body may stand and still be the thing the discharge
 * earths on, as a dot product. 0.955 is 17.3°.
 *
 * A NAME BECAUSE THE PROSE HAD ALREADY DRIFTED FROM IT. `_lightningEnd` carried
 * the number as a literal with a comment beside it reading "0.965 of a dot is
 * about 15°" — a claim about a value the line under it had stopped using. Small,
 * and exactly the shape §2.3 is a section about: the next person to widen this
 * cone reads the sentence, not the expression. One home, and the angle is
 * derived in the note rather than asserted twice.
 */
const LIGHTNING_CONE = 0.955;
const LIGHTNING_STEPS_PER_M = 3.2, LIGHTNING_WANDER = 0.41, LIGHTNING_FORK = 0.16;
/**
 * HOW FAST THE DISCHARGE CROSSES THE GAP, in metres per second.
 *
 * It used to cross it in no time at all: `_lightningEnd` resolves the endpoint
 * instantly every tick and the damage was applied in the same frame, so the
 * power was a hitscan wearing an arc. Reported as "make sure it isn't hitscan,
 * it needs travel time obviously (but small)".
 *
 * 120 m/s puts the front at the far end of `LIGHTNING_RANGE` in 0.18 s and at a
 * duellist's ten metres in 0.08 — long enough to see it leave your hands and
 * arrive, short enough that it never feels like a projectile you have to lead.
 * The BOLT is drawn to the front rather than to the target, so what you see is
 * the thing that has not got there yet; the damage waits for the same front.
 */
const LIGHTNING_SPEED = 120;
/**
 * IT IS A CHANNEL NOW, AND THAT IS THE FIX.
 *
 * The player, many times over: "force lightning needs to be fucking LIGHTNING
 * that comes out of your hands like I need to be able to fucking see the
 * lightning come out and travel to where I'm aiming… for the millionth time
 * it's nothing in the air right now like there's no VFX or anything".
 *
 * Three separate defects made that true and only one of them was the drawing:
 *
 *   IT ONLY DREW WHEN IT HIT. `forceLightning` gathered the enemies inside a
 *     0.8-dot cone at 16 m and drew one arc per body it found. With that list
 *     empty — aiming at a wall, at a line 20 m off, at a body two metres wide
 *     of the cone — the whole method ran to completion and drew NOTHING. That
 *     is exactly and literally "there's nothing in the air".
 *   IT LASTED ONE FRAME. Press, resolve, done. Nothing travelled and nothing
 *     could be swept across a line, which is the other half of the note.
 *   IT WAS DRAWN OUT OF THE SPARK RING, a shared pool of 6 cm point sprites
 *     sized for blade hits. Forty of them in a row is a dotted rule.
 *
 * So: `HOLD` seconds of continuous discharge while the key is down, `TICK`
 * seconds between damage applications, `DRAIN` Force a second on top of the
 * opening cost, and a bolt that is drawn EVERY frame from the hands to
 * whatever the aim ray reaches — a body, the ground, a wall, or the end of its
 * own range. `src/world/Lightning.js` is what draws it, and it draws ribbons
 * rather than particles.
 */
const LIGHTNING_HOLD = 2.4, LIGHTNING_TICK = 0.22, LIGHTNING_DRAIN = 14;
/**
 * …and how high above the feet it turns. 1.02 m on a 1.75 m figure is 58% of
 * standing height, which is where a tucked gymnast's centre of mass actually
 * sits — a little above the navel. The pelvis (0.95) is the obvious choice and
 * is wrong by enough to see: turning there swings the head through 0.86 m of
 * arc against the correct 0.79, and the extra reads as the figure being whirled
 * on the end of a rope rather than turning about itself.
 */
const FLIP_PIVOT = 1.02;

/**
 * FORCE COMPEL: what it costs, how long a turned mind stays turned, and how far
 * a turned unit will look for someone of its own to shoot.
 *
 * Six seconds is about two firing cycles for a B1 — long enough to watch it
 * work and to plan a flank around, short enough that a wave cannot be taken
 * apart by clicking through it. 14 m is a little over the spacing a wave
 * actually spawns at, so a unit in a squad always finds a neighbour and one
 * that has been driven off on its own does not.
 */
const COMPEL_COST = POWER_COST.compel;
const COMPEL_TIME = 6.0;
const COMPEL_SPREAD = 14;

/** FORCE HEAL: what it costs, how long you must stand still, and what it buys. */
const HEAL_COST = POWER_COST.heal;
/** Force Rend. Priced in the same table as every other power — see Powers.js. */
const REND_COST = POWER_COST.rend;
/**
 * HOW FAR A MEND REACHES AND HOW WIDE IT LOOKS, for healing somebody else.
 *
 * 15 m is a shout across a firing line rather than a touch: a commander should
 * not have to walk into the beaten zone to help the man in it, and anything
 * much longer would be healing people you cannot see. The cone is 0.94 —
 * about 20° — because a trooper is a small target at that range and this is a
 * mercy, not a shot.
 */
const MEND_REACH = 15, MEND_CONE = 0.94;
/** How much angle a man who is ON THE FLOOR is worth over one who is on his
 *  feet, when both are under the reticle. See `_mendTarget`: it is added to
 *  his own score and not taken off the cone, which is the bug it replaces. */
const MEND_LIMP_EDGE = 0.05;
const HEAL_TIME = 3.0;
const HEAL_FRACTION = 0.45;

/**
 * WHERE THE HILT HANGS. ONE PLACE, BOTH VIEWS.
 *
 * The offset from the CHEST to the point the blade is solved from, in the aim
 * frame, in metres of arm. `_updateBlade` applies it directly in third person
 * and off the eye with the eye-to-chest height taken back out in first, which
 * lands on the same point plus the eye's own ride.
 *
 * ── WHAT THIS REPLACED, AND WHAT THE OLD NOTE HAD WRONG ────────────────────
 *
 * It used to be two anchors — the chest in third person, chest + 0.32 up +
 * 0.16 forward in first — and the note here said that cost "27% more sword for
 * pressing the camera key", ratcheted in tools/checks/first-person.mjs. Both
 * halves of that were measured on a bench that never holds `blade`, so the
 * guard never left READY_GUARD and what the 27% compared was where the two
 * views PARK the blade. The sword's length is the ENVELOPE, and the envelope
 * was measured by holding the guard still at each point of a 9x9 grid over its
 * whole travel and reading the tip off the chest (tools/_unify.mjs), on the two
 * anchors as they then were:
 *
 *                          third    first     over
 *     tip from the chest    1.81 m   1.82 m    0.3%   <- the same weapon, always
 *     tip from the feet     1.59     1.73      9.1%
 *     tip along the aim     1.49     1.70     14.3%
 *     standing stab, feet   2.05     2.25      9.3%
 *
 * So the two views held the SAME weapon in two places, and the nine percent is
 * the translation, not the blade. That is what one anchor fixes; the ratchet is
 * a parity assertion on the envelope now rather than a bound on a parked pose.
 *
 * ── THE OLD NOTE ALSO SAID THE UNIFICATION WAS BLOCKED, AND ITS SWEEP IS WHY ─
 *
 * The block was a third-person forearm at up to 5159 deg/s against the 2700
 * ratchet in tools/checks/viewmodel.mjs, over a sweep that found no window
 * between "the hands are in the frame" and "the forearm is under its bound".
 * That sweep walked a 0.30 m offset round an ARC at fixed radius, on the
 * reasoning that the radius "is how far in front of the body the weapon is and
 * is not free". The radius is exactly what was free. Gridded on rise and
 * forward independently, with the first-person framing, the third-person arm
 * and the reach all read at once (tools/_unify.mjs --grid):
 *
 *     rise  fwd   hand   hilt  occ  frame    wrist   fore    reach 3/1
 *                 <26°  31/31 <35%  >10%     <145  <2700
 *     0.00  0.00   61.9   0/31 100%    —     140.0   2494    1.59/1.59
 *     0.32  0.13   24.7  31/31  35%   42%    157.0   2332    1.65/1.70
 *     0.32  0.16   23.2  31/31  32%   38%    160.3   2442    1.68/1.73
 *     0.32  0.20   21.4  31/31  32%   34%    114.4   2487    1.72/1.77   <-
 *     0.32  0.24   19.9  31/31  32%   31%    111.1   1581    1.76/1.81
 *
 * The first row is the old third-person anchor, and its first four columns are
 * what first person looks like from inside a chest: no hilt on screen at all.
 * 0.13 fails on OCCLUSION — 35% of the hilt behind the player's own fist — and
 * 0.13 and 0.16 both fail on a wrist past 145 degrees. 0.24 passes everything
 * in that table and fails two things that are not in it, both the same fact:
 * the arm cannot get there. `demand` in tools/checks/stature.mjs reads 0.97 of
 * the arm's whole reach against a 0.95 bound, and the overhead's hand travel
 * falls under its floor, because the two-bone IK straightens, points and stops
 * short.
 *
 * 0.32 / 0.20 is the window, and it is about four centimetres wide.
 *
 * THE WRIST COLUMN IS BISTABLE AND THAT IS WHY THE WINDOW HAS AN EDGE RATHER
 * THAN A SLOPE. 114 and 157 are not two points on a curve: they are the fist
 * ending up on one side of the shaft or the other early in the run and every
 * frame after it following. Swept over six mouse sweeps instead of the
 * ratchet's one, the worst is 2564 / 160.3 at fwd 0.16 and 8959 / 171.1 on the
 * old chest anchor, so both basins exist at every anchor and what the grid
 * above reports is which one the ratchet's own sweep lands in. It is the bench
 * the bound is written against, so it is the one this is chosen on — and the
 * next person to move this number should re-read the whole column rather than
 * interpolating it.
 *
 * WHAT IT COSTS is reach, in both views at once, which is the honest way to pay
 * for it: on the ground plane the third-person player goes 1.59 m to 1.72 and
 * the first-person player 1.73 to 1.77, so the two agree to 3% and the fight
 * gets 8% more third-person reach. See tools/balance.mjs, which measures the
 * blade from this anchor now instead of from a chest the game stopped using,
 * and `--anchor=0,0` there for the before.
 *
 * WHAT IT DOES NOT COST is the arm, which is the part the old note could not
 * see through its own sweep's noise. Both ratchets in tools/checks/viewmodel.mjs
 * come out BETTER than they went in — the forearm 2548 -> 2487 deg/s and the
 * wrist 140.0 -> 114.4, the latter being the largest single step that number
 * has taken since it was 179.7. Some of that is FOREARM, which repairs a
 * degeneracy that was live on the chest anchor too; most of it is that a hand
 * carried in front of the body is a hand a wrist can hold a sword with.
 * (The wrist column reads 89.4 now — see `Player._wristPole`, which came
 * later and by a different route. The 114.4 above is the anchor's own step and
 * is left as it was taken.)
 *
 * ── RISE 0.32, AND WHY IT IS NOT LOWER ─────────────────────────────────────
 *
 * The one-handed first-person grip (see GRIP_AT.FP) slides the fist to the
 * bottom of the shaft, and at rise 0.26 that put NINE of the hilt's thirty-one
 * sample points off the bottom of the frame — the whole pommel section, and the
 * fist with it at 30.7 degrees below the view axis against a 26 degree bound.
 * Measured on the bench tools/checks/first-person.mjs uses, at fwd 0.16:
 *
 *     rise    hilt on screen   behind the fist   handR down
 *     0.260      23/31              17%            30.7°
 *     0.308      29/31              34%            24.5°
 *     0.320      31/31              32%            24.8°
 *     0.340      31/31              39%            20.5°
 *
 * Pulling `fwd` IN to pay for the rise does not work, and the reason is worth
 * keeping: the frame is an ANGLE, so bringing the hilt nearer the lens narrows
 * the frame at the hilt's own depth faster than the lift raises it. Every row
 * with fwd reduced loses samples. Pushing it OUT is what the grid above does,
 * and it helps the framing as well as the arm.
 */
const HILT = { rise: 0.32, fwd: 0.20 };
/** Exported so tools/_anchor.mjs and tools/_unify.mjs can sweep it. */
export const HILT_ANCHOR = HILT;

/**
 * WHERE A HAND HOLDS A HILT — and it was nowhere near where the game put one.
 *
 * `solveIK('armR', 'foreR', gripR, poleR)` places the WRIST JOINT on the grip
 * point, and the grip point is on the hilt's own axis. So the hand bone's
 * origin sat exactly on the axis of the cylinder it was supposed to be
 * holding: measured, the grip point in hand space was (0, 0, 0) to four
 * decimals. The palm slab is 30 mm thick and centred on that origin, so the
 * hilt ran through the middle of the palm and out the back of the hand.
 *
 * And it ran the WRONG WAY. `buildHand` documents its own frame — "+Y runs
 * wrist → knuckles, +Z is the way the palm faces" — and the hand's world
 * quaternion was copied straight off the hilt, whose axis is its own +Y. So the
 * hilt was threaded from the wrist out through the knuckles, along the fingers,
 * when a hand grips a cylinder ACROSS the palm: the tunnel a closed hand makes
 * runs thumb-to-little-finger, which is this hand's X.
 *
 * The remarkable part is that the hand was already built to hold one. Replaying
 * buildHand's own finger construction to recover the joint positions the bake
 * throws away, the four phalanx joints of the middle finger sit at
 *
 *       (0.087, 0.005) (0.096, 0.033) (0.081, 0.052) (0.063, 0.057)
 *
 * in the hand's YZ plane — an arc about (0.075, 0.030) of radius 25 mm, and
 * taking off the 9.7 mm the finger itself is thick leaves a bore of about 15
 * mm. A lightsaber hilt is 17. Independently, the largest circle that fits in
 * the gap between the palm face and the returning fingers, found by search
 * rather than by construction, is at (0.060, 0.030) with 15.5 mm of clearance.
 * The fist has always closed on a hilt-sized hole in exactly the right place.
 * Nothing ever put a hilt in it.
 *
 * So: the bore, in hand space, at the scale buildHand is called with here.
 */
export const GRIP_BORE = new THREE.Vector3(0, 0.065, 0.030);

/**
 * HOW FAR THE WRIST LEANS OFF `-Y` — `atan2(bore.z, bore.y)`, 24.8°.
 *
 * Derived from GRIP_BORE and never typed, because it IS GRIP_BORE seen from
 * the other end: move the bore and this follows. See handPoseOnHilt, where it
 * is the whole of the correction.
 */
const BORE_LEAD = Math.atan2(GRIP_BORE.z, GRIP_BORE.y);

/**
 * THE HAND'S WORLD ORIENTATION, GIVEN THE HILT'S — and where the arm is.
 *
 * One axis is forced and one is free, and getting the free one wrong is what
 * makes a grip look like a prop stuck to a glove.
 *
 * FORCED: the bore's axis is the hand's X (see GRIP_BORE), and the bore has to
 * lie along the blade, so handX = ±hiltY. The sign is the thumb's: buildHand
 * puts it "on the +X side for a left hand", so a right hand's thumb is on -X,
 * and -X points up the blade because a sabre grip has the thumb toward the
 * emitter.
 *
 * FREE: everything left is a turn about that axis — WHERE ROUND THE HILT the
 * hand sits. It was a constant, and a constant cannot be right: the hand has to
 * be on the side the arm arrives from, and the arm arrives from a different
 * side every time the guard crosses the body. Pinned at zero it left the wrist
 * 176 degrees from its own rest — the singularity — and the forearm juddering
 * at 9912 deg/s. Swept as a constant the best value was 130 degrees, at 140/2746.
 *
 * Solved instead: the wrist has to end up on the shoulder's side of the hilt.
 * `grip - wrist` is the bore offset, mostly along the hand's +Y, so +Y is the
 * direction from the shoulder to the hilt with the blade's own component taken
 * out. No constant, nothing to tune, and it follows the guard round the body.
 *
 * @param side    'R' | 'L'
 * @param hiltQuat  the saber root's world quaternion
 * @param toward  the direction from the arm's shoulder to the grip point. Pass
 *                null for the fixed fallback, which is what a preview with no
 *                arm behind it wants.
 * @param outQuat receives the hand's world orientation
 * @param outWrist receives the offset from the grip point BACK to the wrist, in
 *                world space; add it to a point on the hilt's axis to get where
 *                the wrist joint belongs.
 * @param handScale  how big this figure's hand is against the reference one —
 *                `rig.scale`. See below; the default of 1 is a human.
 *
 * ── THE BORE IS A HAND-SPACE CONSTANT AND THE HAND IS NOT ALWAYS THAT SIZE ──
 *
 * `GRIP_BORE` says of itself that it is measured "at the scale buildHand is
 * called with here", which is 1. `Rig` bakes a figure's scale into the bone
 * lengths and leaves every bone Object3D at scale 1, so a hand-space offset
 * does NOT shrink with the figure when it is pushed through the hand's matrix —
 * it stays 72 mm on a fist that is 40 mm long.
 *
 * That is a fixed 43 mm error in exactly the direction reported: the arm is
 * told to hold its wrist 72 mm back from the hilt's axis, the hand is only 40
 * mm long, and the hilt ends up outside the fist. Measured on the shipped
 * small frame before this, in units of that figure's OWN hand
 * (tools/_stature.mjs): the metal sat 2.42 hands clear of the hole it is
 * supposed to be inside, against 0.00 for a human.
 *
 * Scaled here rather than at the call site because every caller has the same
 * problem and only one of them had noticed it.
 */
export function handPoseOnHilt(side, hiltQuat, toward, outQuat, outWrist, handScale = 1) {
  const L = side === 'L';
  const bore = _hp1.set(0, 1, 0).applyQuaternion(hiltQuat);      // the blade
  const x = _hp2.copy(bore).multiplyScalar(L ? 1 : -1);          // thumb to the emitter
  let ok = false;
  if (toward) {
    _hp3.copy(toward).addScaledVector(bore, -toward.dot(bore));  // across the blade
    ok = _hp3.lengthSq() > 1e-6;
  }
  if (ok) {
    /**
     * ── AND THE BORE'S OWN LEAN IS TAKEN OFF, WHICH IS THE FOURTH REPORT OF
     *    THE SAME THING AND THE FIRST TIME IT HAS BEEN A NUMBER.
     *
     * "the orientation is still janky af like i think the knuckles are facing
     *  out on both like that's not how you would hold a saber in 1 or even 2
     *  hands like you keep missing this over and over that's not how human
     *  hands contort"
     *
     * `toward` has always been documented as the direction the ARM arrives
     * from, and the wrist has never actually landed opposite it. The wrist is
     * one BORE offset back from the axis — `-(0.065·Y + 0.030·Z)` — and that
     * vector is not `-Y`: it leans 24.8° toward the back of the hand. Compose
     * that with `GRIP_TWIST`'s 35° and the wrist comes out 59.8° round the
     * shaft from where the caller asked for it.
     *
     * A CONSTANT BIAS ON ONE HAND IS INVISIBLE; ON TWO IT IS THE DEFECT. The
     * turn is taken about the hand's own X, and X is the THUMB axis, which
     * points opposite ways on the two hands — so the bias rolls the right hand
     * one way round the shaft and the left hand the other, 119.6° apart.
     * Measured on the shipped tree with `tools/_palm.mjs`, in both views:
     *
     *     third person   the two palms agree to −1.00
     *     first person   the two palms agree to −0.96
     *
     * Two hands on one hilt with their palms facing opposite ways round it.
     * That is not a grip a body can make, and it is exactly what the player
     * describes: whichever hand you look at, you are looking at the back of it.
     *
     * The cure is one rotation and it is DERIVED from `GRIP_BORE` rather than
     * swept: turn `y` back by `atan2(bore.z, bore.y)` so that after the bore
     * offset is applied the wrist lands exactly opposite `toward`. Then the
     * two hands are treated identically, each one's wrist goes to its own
     * arm's side of the shaft, and both palms come round onto the metal.
     *
     * NOTHING THE PLAYER HAS ALREADY APPROVED MOVES. `GRIP_TWIST` absorbs the
     * same angle (see its own note), so the RIGHT hand's world frame is
     * unchanged in both views to the second decimal, and `FP_TUNE.roll` stays
     * at the 60° a render picked. Only the off hand turns, by exactly the
     * 119.6° it was wrong by.
     */
    const y = _hp3.normalize()
      // The comfort roll, about the BLADE and not about the thumb. Its own note
      // swept it on a right hand; applied about `x` it turned the two hands
      // OPPOSITE ways round the shaft, which is half of the 119.6° split.
      .applyAxisAngle(bore, -GRIP_TWIST)
      // …and the bore's own lean taken off, so `toward` means what it has always
      // claimed to mean. This one is about `x` on purpose: the bore is a place
      // inside the hand and it genuinely mirrors with the hand.
      .applyAxisAngle(x, -BORE_LEAD);
    const z = _hp4.crossVectors(x, y).normalize();
    _hpM.makeBasis(x, y, z);
    outQuat.setFromRotationMatrix(_hpM);
  } else {
    // no arm to ask: the hilt's own frame, turned a quarter
    outQuat.copy(hiltQuat).multiply(L ? GRIP_ROLL_L : GRIP_ROLL_R);
  }
  if (outWrist) {
    outWrist.copy(GRIP_BORE).multiplyScalar(handScale).applyQuaternion(outQuat).negate();
  }
  return outQuat;
}

const _hp1 = new THREE.Vector3(), _hp2 = new THREE.Vector3();
const _hp3 = new THREE.Vector3(), _hp4 = new THREE.Vector3();
const _hpM = new THREE.Matrix4();

/**
 * Scratch for _rollForearm's twist alone. It runs inside the arm solve, which
 * is already holding _v10.._v12Q and _q4/_q5, so it may borrow none of them.
 */
const _fv1 = new THREE.Vector3(), _fv2 = new THREE.Vector3(), _fv3 = new THREE.Vector3();
const _fq1 = new THREE.Quaternion();

/** …and the same again for _wristPole, which runs in the same place. */
const _wp1 = new THREE.Vector3(), _wp2 = new THREE.Vector3(), _wp3 = new THREE.Vector3();
const _wp4 = new THREE.Vector3(), _wp5 = new THREE.Vector3(), _wp6 = new THREE.Vector3();
const _wpQ = new THREE.Quaternion(), _wpQ2 = new THREE.Quaternion();

/**
 * WHAT KEEPS THE FOREARM FROM SPINNING, and why it is one angle and not a
 * quaternion.
 *
 * `_rollForearm` takes the forearm pose the WRIST wants — the one that leaves
 * the hand at its own rest — and swings it onto the direction `solveIK` chose.
 * `setFromUnitVectors` is the minimal rotation between two directions and there
 * is no minimal rotation between ANTIPARALLEL ones: every axis perpendicular to
 * the bone turns one onto the other through 180 degrees, and three.js picks by
 * a fixed rule that flips as the pair crosses over. The pair is "the forearm
 * the wrist wants" against "the forearm the IK chose", so the singularity is a
 * wrist folded all the way back — and the ratchet in tools/checks/viewmodel.mjs
 * has been carrying that wrist at 140 degrees from rest for its whole life, a
 * hand's width from the flip.
 *
 * `rate`  is the cure. Once the direction is fixed the only freedom left is ONE
 *         SIGNED ANGLE about it, so carry the angle instead of rebuilding a
 *         quaternion from nothing: the reference is last frame's forearm swung
 *         onto today's direction — a swing of a few degrees, never degenerate —
 *         and the twist is measured off that and limited to what a forearm can
 *         actually pronate at. 40 rad/s is 2292 deg/s, which is at the top of
 *         what a human forearm does and an order under what the rig was asking.
 * `cone`  fades the target out where it stops being a direction at all, as the
 *         sine of the angle from antiparallel. Measured, it is worth NOTHING on
 *         top of the rate: `--robust` reads 2564 / 160.3 with both and 2564 /
 *         160.3 with the rate alone, to the digit. It is kept anyway, and that
 *         is a deliberate choice rather than an oversight — the rate limit only
 *         BOUNDS the flip, and this is the statement that is true about the
 *         geometry: a direction that does not exist cannot be followed. Delete
 *         it the day something measures it costing more than it says.
 *
 * MEASURED on the same mouse-driven slash the ratchet runs, worst forearm deg/s
 * and worst wrist degrees from rest, at the anchor as it ships and at the two
 * nearest anchors either side of it (tools/_unify.mjs --rate):
 *
 *     rate     fwd 0.16        fwd 0.20 (ships)     fwd 0.22
 *      off    9454 / 140.5      2883 / 114.4      1987 / 112.7
 *       60    3535 / 154.9      2883 / 114.4      1987 / 112.7
 *       50    2983 / 157.5      2883 / 114.4      1987 / 112.7
 *       45    2711 / 158.9      2751 / 114.4      1987 / 112.7
 *       40    2442 / 160.3      2487 / 114.4  <-  1987 / 112.7
 *       30    1917 / 163.2      1976 / 114.4      1890 / 112.7
 *
 * On the shipped anchor the rate buys 2883 -> 2487 deg/s and the wrist does not
 * move at all. On the anchor four centimetres nearer the body it buys 9454 ->
 * 2442 and the wrist goes 140.5 -> 160.3, which is the trade to know about:
 * the twist the blade demands has to sit in the forearm or in the wrist, and
 * where the pose is bad enough, taking it off one puts it on the other. The
 * shipped anchor is the one where it does not have to.
 *
 * AND THE BENCH IS ONE SAMPLE OF A SINGULARITY. Six sweeps of different
 * amplitude and period rather than the ratchet's one (`--robust`), worst of all
 * six, with this repair and without it:
 *
 *     anchor          with         without
 *     chest        8959 / 171.1   10723 / 169.5
 *     0.32 / 0.16  2564 / 160.3    9454 / 154.4
 *     0.32 / 0.24  2639 / 164.2   10361 / 149.1
 *
 * So the fault this repairs was live before the anchor moved — 10723 deg/s on
 * the shipped tree, on a sweep the ratchet does not run — it is simply not
 * reached by the bench that watches for it, and it is four times smaller now.
 *
 * THE WRIST COLUMN IS ANSWERED NOW AND IT WAS NOT THIS METHOD'S TO ANSWER —
 * that much this note had right. What it had wrong is where the cure was: it
 * and the ratchet's own note both said it had to be the CONTROLLER putting the
 * hands somewhere a wrist could hold that blade. It is the ELBOW. See
 * `Player._wristPole`: 114.4 -> 89.4 degrees worst, 83.6 -> 36.7 median, with
 * the forearm column going 2487 -> 2476 rather than paying for it.
 *
 * An object rather than two bare constants for the same reason FP_TUNE is one:
 * so tools/_unify.mjs can sweep them without an edit. The tables are its output.
 */
export const FOREARM = { cone: Math.sin(12 * Math.PI / 180), rate: 40 };

/**
 * HOW FAR THE WRIST MAY TURN THE ELBOW ROUND THE ARM'S OWN LINE, and how fast.
 * Radians and radians per second.
 *
 * The long form is on `Player._wristPole`, its only reader. An object rather
 * than two bare constants for the same reason `FOREARM` is one: so
 * `tools/_wristsweep.mjs` can sweep them without an edit, and the tables below
 * are that sweep's output rather than a taste. Worst and median wrist-from-rest
 * over the ratchet's own bench in tools/checks/viewmodel.mjs, with the OTHER
 * ratchet — the forearm's own angular speed — beside them, because this trades
 * one against the other and a fix that breaks the neighbour is not a fix.
 *
 *   swivel      third, two hands     third, one hand    first, two hands    first, one hand
 *   at rate 30  worst  med  fore    worst  med  fore   worst  med  fore   worst  med  fore
 *      0° (was) 114.4  83.6  2487   107.8  62.8  1221  131.1  88.6  1099  112.0  83.4  2747
 *     45         89.4  56.7  2476   107.4  23.9  1646  121.6  72.2  1605  106.9  81.1  2464
 *     75         89.4  43.5  2476   105.2  14.7  1528  121.6  68.0  1871  102.3  81.1  2429
 *    110         89.4  36.8  2476    80.6  14.7  1264  115.1  66.0  1591  101.4  76.7  2429
 *    120 <-ships 89.4  36.7  2476    79.0  14.7  1112  115.1  65.8  1605  102.3  76.7  2429
 *    180         89.4  36.7  2476    74.5  14.7  1112  115.1  65.8  1605  105.4  75.1  2429
 *
 * FOUR COLUMNS AND NOT TWO, AND THE OLD PAIR WAS NOT WHAT IT SAID. The column
 * headed "first person, one hand" used to be taken with the `fpHands` option,
 * which took the off hand off the arms and left the blade on `GRIPS.two` — a
 * guard no player can hold. Held for real, by the key, first person is the
 * worst arm of the four and one hand is worth 115.1 → 102.3 on the worst frame
 * while the median goes the other way, 65.8 → 76.7. In THIRD person the same
 * key is worth 89.4 → 79.0 worst and 36.7 → 14.7 median, which is the largest
 * single step in this table.
 *
 *   rate, at swivel 120     third person, two hands
 *      20 rad/s              97.9    36.7      2335
 *      30    <- ships        89.4    36.7      2476
 *      40                    84.3    36.7      2612
 *      no limit              80.5    36.7      3538
 *
 * THE RATE IS WHAT THE FOREARM COSTS. Unlimited it reaches the geometry's own
 * floor and takes the forearm to 3538 °/s — the elbow snapping through the
 * chest pole's side, which is `FOREARM.rate`'s lesson one joint up. 30 rad/s
 * (1719 °/s) is the largest value that leaves the forearm ratchet BETTER than
 * it was: 2476 against the 2487 this shipped with.
 *
 * The swivel saturates at about 110° because that is as far as the wrist ever
 * asks the elbow to go on this bench; it is left at 120 rather than trimmed to
 * the sample, since a cap tuned to one mouse sweep is a cap tuned to one mouse
 * sweep. A shoulder rotates internally and externally through rather more than
 * that.
 *
 * 120 survives the two columns that did not exist when it was chosen: it is
 * where three of the four saturate, and the fourth — third person, one hand —
 * would take another 4.5° of wrist at 180 and is the only one that would. A
 * cap chosen for one of four arms is the shape of mistake this whole file
 * keeps deleting, so it stays where the other three put it.
 */
export const ELBOW = { swivel: 120 * Math.PI / 180, rate: 30 };

/**
 * HOW FAST A FIST CAN ROLL ROUND THE SHAFT, in radians per second.
 *
 * The cone above says the free angle is undefined when the arm lies along the
 * blade. This says what it may do when it is defined but has just changed its
 * mind: as the arm crosses the blade's line the "shoulder's side of the hilt"
 * swaps ends, so the angle the geometry asks for jumps by up to 180 degrees in
 * one frame. A hand does not do that. It rolls round, over a few frames, and
 * the fingers stay in the bore the whole way — which is what a rate limit on
 * ONE angle buys and what no amount of smoothing on the whole quaternion can,
 * because smoothing the quaternion takes the hilt out of the palm.
 */


/**
 * HOW MUCH BODY GOES INTO AN ATTACK — player note 23. See `_attackDrive` for
 * what each of these buys and for the before/after measurement.
 *
 * Radians, and every one of them is applied ON TOP of whatever the blade and
 * the Force were already doing to the spine, never instead of it.
 *
 * `SPINE_OVER` is the big one: multiplied by the overhead's own arc, which runs
 * +0.95 chambered to −1.08 through the cut, it spends 0.32 rad arching back and
 * 0.37 folding forward — 38 degrees of trunk across the swing, against the 1.0
 * degree the swing used to have. It is set from what a body can actually do:
 * thoracolumbar extension is about 25 degrees and flexion about 60, so this
 * sits inside both with the arch as the tighter half.
 *
 * `CLAV_*` drive the shoulder girdle. The clavicle's rest direction is sideways
 * (`Rig.humanoidSkeleton` gives clavR rest [-1, 0.18, 0]), so X elevates and
 * depresses the shoulder and Y protracts it — which is why the overhead uses
 * the first and the lunge uses both. 0.30 rad of elevation carries the shoulder
 * JOINT about 19 cm through the swing, measured, against the 9 mm an idle body
 * breathes.
 */
const SPINE_OVER = 0.34, SPINE_LUNGE = 0.26, SPINE_LUNGE_TWIST = 0.22;
const CLAV_OVER = 0.30, CLAV_LUNGE = 0.16, CLAV_YAW = 0.34;
/**
 * AND THE SAME AGAIN FOR THE LEFT BUTTON'S CUT AND FOR THE SPIN, because both
 * of them were reported as "barely doing anything" and both of them measured
 * exactly that.
 *
 * A LATERAL cut is mostly TWIST where an overhead is mostly flexion — a body
 * throwing a cut across itself rotates about its own spine and drags the
 * shoulder girdle round after it. So `SPINE_SLASH_TWIST` is the big one here
 * and `SPINE_SLASH` (the fold, driven by the cut's vertical half) the smaller,
 * which is the mirror image of the overhead's split. 0.30 rad of axial
 * rotation is inside the ~35 degrees a thoracic spine actually has.
 *
 * `SPINE_SPIN` is the lean into a turn. A body spinning about its own axis
 * leans slightly INTO the turn and drops its trailing shoulder; without it the
 * figure reads as a statue on a turntable, which is what the spin measured at:
 * 7.1 degrees of trunk and 0.0 of shoulder girdle, less than the overhead has.
 */
const SPINE_SLASH = 0.26, SPINE_SLASH_TWIST = 0.40;
const CLAV_SLASH = 0.30;
const SPINE_SPIN = 0.20, SPINE_SPIN_TWIST = 0.34, CLAV_SPIN = 0.32;
/** Sword side first. The off shoulder answers at a fraction — one torso. */
const CLAV_DRIVE = [['clavR', 1], ['clavL', -0.45]];
const _eulA = new THREE.Euler();
/** _attackDrive's own scratch. _v1.._v6 are threaded through the Force powers
 *  (see the note at their declaration) and this runs inside the body pass. */
const _atkR = new THREE.Vector3();

/**
 * The last degree of freedom, and it is the hand's own rest pose.
 *
 * Pointing the hand's +Y from the shoulder to the hilt puts the wrist on the
 * side the arm arrives from, which is the geometry. It is not quite the whole
 * answer, because `handR.restQuat` — the pose a relaxed wrist holds — is not
 * square to that frame, so the solve lands a little off the pose the wrist can
 * hold cheapest. Swept against the real rig through a mouse-driven slash:
 *
 *       twist    wrist from rest    forearm peak
 *        -40         151.5           7355 deg/s
 *          0         157.8           6549
 *         20         143.8           3595
 *         35         140.0           2548     <-
 *         40         139.9           2711
 *         60         150.5           4029
 *        100         177.0           9983
 *
 * against 179.7 / 7052 with no correction at all. Both curves bottom in the
 * same place, which is what says this is one real quantity and not two knobs
 * fighting.
 *
 * ── AND `BORE_LEAD` IS ADDED TO IT, WHICH CHANGES NOTHING ABOUT THAT SWEEP.
 *
 * The sweep above was run on a RIGHT hand, and it was run against a frame
 * construction that leaned the wrist 24.8° round the shaft on its own (see
 * handPoseOnHilt). Taking that lean off is what makes the two hands agree, and
 * putting the same angle back here is what keeps the swept optimum where the
 * sweep found it: measured across the change, the right wrist's worst forearm
 * rate is 2487°/s before and 2487°/s after (tools/checks/viewmodel.mjs), and its palm in first person reads
 * (out −0.96, up 0.29, eye 0.01) in both. The LEFT hand moves 119.6°, which is
 * the entire point.
 */
const GRIP_TWIST = 35 * Math.PI / 180 + BORE_LEAD;

/** The fixed fallback turn, for a caller with no arm to point at. */
export const GRIP_ROLL_R = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), -Math.PI / 2);
export const GRIP_ROLL_L = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.PI / 2);

/**
 * WHERE ON THE SHAFT EACH FIST CLOSES — and why first person gets its own.
 *
 * `R`/`L` are the third-person grip and are unchanged: two fists straddling the
 * middle of a shaft whose metal spans −0.092 … +0.158, which is correct for a
 * two-handed sabre grip and invisible at 3.5 m from the lens.
 *
 * `FP` IS THE ONE-HANDED FIRST-PERSON GRIP, and it exists because at 0.5 m from
 * a lens those same two fists are the entire picture. Measured with
 * `tools/_fpgeom.mjs` before this:
 *
 *     hilt on screen        27.6% of frame height, 23 of 31 samples in frame
 *     of what was in frame, behind the player's own fists        91%
 *
 * A hilt that is a quarter of the frame and nine tenths hidden is not a hilt,
 * it is a pale smudge where the blade begins — which is what the player's
 * screenshot shows and what `assets/reference/first-person/` does not: there ONE
 * fist sits low on the grip with the entire emitter section standing clear above
 * it.
 *
 * Sliding both fists down was tried first and is refuted: 91% → 40%, and then
 * the raise needed to keep the OFF hand in frame brings elbowL inside the 100 mm
 * the deltoid needs against a 45 mm near plane. Swept as a pair over grip
 * −0.020 … −0.105 against rise +0 … +0.070, nothing satisfies both — the note in
 * tools/_fpgeom.mjs has the sweep. The second hand is the constraint, so the
 * second hand goes: see `twoHanded` in _updateBody.
 *
 * −0.062 rather than the −0.092 the metal bottoms out at, because the fist is
 * ~90 mm across and a grip point at the very end of the shaft hangs half the
 * hand off it. This puts the whole closed fist on metal with the pommel just
 * clear below it, which is the reference's own framing. Swept against the
 * finished anchor (rise 0.32), reading the hilt at a level gaze, looking up
 * 1.1 rad and looking down 1.2 rad — all three identical, because a viewmodel
 * holds its place in the frame:
 *
 *     grip     behind the fist    handR below the axis
 *     +0.050         71%                 15.9°       ← the third-person grip
 *     −0.040         45%                 21.5°
 *     −0.062         39%                 23.0°
 *     −0.075         32%                 24.8°       ← the Graflex, derived
 *     −0.085         29%                 26.3°       (past the 26° frame bound)
 *     −0.100         23%                 28.6°
 *
 * The two columns pull against each other and this is where they cross. ~39% is
 * the floor for a fist wholly ON a shaft that is wholly ON screen — a closed
 * hand is 90 mm across and the sampled shaft is 233 — so anything below that is
 * the fist hanging past the pommel, and past −0.085 it hangs out of the frame
 * as well. Note the first row: taking the off hand off the hilt and changing
 * nothing else is 91% → 71%. Both halves were needed.
 *
 * THIS TABLE IS THE GRAFLEX'S, and that is the whole of the correction below:
 * it was read as the game's. −0.075 is what `hiltFloor + FIST_CLEAR` now comes
 * to on a hilt whose metal bottoms out at −85 mm, so the row still stands — it
 * is derived per weapon rather than typed once, and the nine other hilts get
 * their own. See `fpGripOn`.
 */
const GRIP_PAIR = { R: 0.050, L: -0.015 };
/**
 * `ONE` IS WHERE A SINGLE FIST CLOSES, and it is the middle of the pair rather
 * than a fourth number, because that is what the pair is FOR: the leading hand
 * sits at the top of the grip section to leave a hand's width of it below for
 * the other one. Take the other one away and the reason to sit high goes with
 * it — a one-handed hold centres on the grip, and a fist parked at the emitter
 * end of it with 65 mm of bare metal underneath is the two-handed pose missing
 * a hand.
 *
 * Derived, so it cannot drift from the pair it is the middle of. What it buys
 * is measured in tools/_wristsweep.mjs (`--one`), against the wrist and the
 * forearm the whole arm solve is ratcheted on, with the one-hand key actually
 * held down:
 *
 *     GRIP_AT.ONE   third person, one hand on the hilt
 *                   worst   median   fore °/s
 *       −0.015       73.4     9.2      1554      (the pair's OFF grip)
 *        0.000       75.6    11.8      1107
 *        0.0175      79.0    14.7      1112      <- ships, the middle of the pair
 *        0.035       79.6    17.7      1117
 *        0.050       80.6    20.2      1122      (the pair's LEADING grip — what
 *                                                 one hand used to hold)
 *
 * IT IS A SMALL LEVER AND THE COLUMN IS MONOTONE, which is worth saying
 * plainly: the middle buys 1.6° of worst wrist and 5.5° of median over holding
 * the leading grip, and further down the shaft buys more of both until the
 * forearm starts paying for it at the pair's own bottom end (1554 °/s). What
 * moves this arm is the GRIP MODEL — one hand takes the third-person wrist
 * from 89.4/36.7 to 79.0/14.7 — and this is the last few degrees of it. The
 * middle is chosen because it is where the hand belongs rather than because it
 * won a sweep; the sweep is here to show it costs nothing.
 *
 * It moves the FIST along a shaft the controller has already placed, not the
 * shaft: `control.handPos` is the saber root's anchor and nothing here writes
 * it, so the blade reaches exactly as far as it did and only the arm's posture
 * under it changes.
 */
export const GRIP_AT = { ...GRIP_PAIR, FP: -0.075, ONE: (GRIP_PAIR.R + GRIP_PAIR.L) / 2 };

/**
 * …AND THE FIRST-PERSON GRIP IS THE HILT'S, NOT THE GAME'S.
 *
 * `GRIP_AT.FP` was one constant applied to ten hilts that do not agree about
 * where their metal stops: the Graflex bottoms out at −85 mm and the Shoto at
 * −54, because a pommel, a control box and a belt hook reach past whatever
 * `len` says. So there is no single number, and it is provable rather than a
 * matter of taste. Two checks bound it from opposite sides:
 *
 *   `hilts: the hands still close on the grip`   needs the point inside EVERY
 *       hilt's own extent with a margin → fp > −0.042, set by the Shoto.
 *   `first person: the hilt is ON SCREEN`        needs at most 35% of the hilt
 *       behind the fist → fp ≲ −0.070, set by the table above.
 *
 * −0.042 > fp > −0.070 is an empty interval. −0.075 shipped and hung the fist
 * off the Graflex's pommel; −0.062 was tried here and moved the same failure to
 * the Shoto while breaking the occlusion bound as well. Neither is a fix,
 * because a constant cannot be one — which is what §6.0's title has said all
 * along: the first-person grip is OVER-CONSTRAINED.
 *
 * AND IT IS STILL OVER-CONSTRAINED PER HILT, BY ABOUT TWO MILLIMETRES. On the
 * Graflex the derived point is −0.072, which is 11 of the occlusion check's 31
 * samples behind the glove — 35.5% against a `pct < 35` bound. Dropping it the
 * ~2 mm that would clear one more sample puts the fist back inside `hilts`'s
 * own 12 mm margin, so the two checks now disagree by one sample point rather
 * than by a design. Worth saying plainly: `pct < 35` on a 31-point grid can
 * only ever be satisfied at 10/31 = 32.3%, so the "35%" in that check's message
 * is not a number its measurement can produce, and the real bound is 32.3%.
 * Neither constant is touched here. Which of them gives is a question about how
 * the weapon should look in frame, and that belongs to whoever owns §6.0 — not
 * to the change that noticed they cannot both hold.
 *
 * `Saber.hiltFloor` is measured off the built meshes once per hilt, so each
 * weapon can be held at the bottom of ITS OWN grip. 13 mm of clearance is the
 * check's own margin (12 mm) plus a millimetre, because a hand exactly on a
 * bound is a hand the next hilt tips over it. `GRIP_AT.FP` stays as the answer
 * for a saber whose hilt has not been measured — a preview, a fixture, a
 * dropped weapon rebuilt from the wire — and is no longer what the game holds.
 */
export const FIST_CLEAR = 0.065;

/**
 * WHERE ROUND THE HILT THE FIRST-PERSON FIST SITS, as a lateral term on the
 * camera's own up vector. See the note at the call site in `_poseArms`.
 *
 * −0.05: a hair inboard of straight under the grip. It is a narrow window and
 * both walls of it are checks that used to be called unsatisfiable together
 * (HANDOFF §6.4 #1), so the sweep is kept:
 *
 *     side    hand below the axis     hilt behind the fist
 *     +0.42        29.6°  fail                10%
 *      0.00        26.2°  fail                19%
 *     −0.05        26.0°  PASS                26%
 *     −0.09        25.8°                      35%  fail
 *     −0.14        25.6°                      35%  fail
 *     −0.35        24.6°                      42%  fail
 *
 * Outboard clears the hilt and drops the hand out of the bottom of the frame;
 * inboard lifts it and puts the fist across the grip. The window exists at all
 * only because the grip point came UP the shaft at the same time — see
 * FIST_CLEAR, which went 0.013 → 0.065 once the fist stopped hanging over the
 * top of the hilt and stopped needing the pommel to hide behind.
 */
const FP_GRIP_SIDE = -0.05;
/** One fist down the shaft from the leading hand, in hilt metres. The
 *  third-person pair sit 0.065 apart (GRIP_AT.R − GRIP_AT.L) and that is the
 *  width of a closed hand on this hilt, so the same number holds here. */
const FP_HAND_GAP = 0.065;
/**
 * THE ROLL OF THE FIST ABOUT THE HILT — "still looks like the palms are facing
 * out", the report that survived the icepick fix.
 *
 * FP_GRIP_SIDE settles which SIDE of the hilt the fist comes up from and that
 * was the whole of the previous pass; it leaves the fist free to sit anywhere
 * on the circle about the shaft, and zero is not the right place on it.
 * Measured with `tools/_palm.mjs`, which reads the palm normal in the camera's
 * own frame — the palm is the hand's +Z, and `buildHand` settles that rather
 * than a guess: the finger roots carry `rotation.x = 1.24`, a positive turn
 * about X takes +Y toward +Z, so the fingers close toward +Z, and GRIP_BORE
 * agrees by putting the hilt's axis 30 mm out on the same side.
 *
 * At zero the right palm read (out −0.68, up −0.52, eye −0.52): turned away
 * from the lens, so what is on the screen is the BACK of the glove and the
 * little-finger edge — a smooth slab with the hilt behind it, which is what
 * "palms facing out" describes.
 *
 * `tools/_palmsweep.mjs` prints the whole circle. Three were rendered and
 * looked at, because the last two passes at this were argued and both were
 * wrong:
 *
 *     roll   palm (out  up  eye)      wrist below the grip   what it looks like
 *      0°        −0.68 −0.52 −0.52          27 mm            a brown slab
 *     60°        −0.95  0.31 −0.01          59 mm            four fingers round the grip
 *    120°        −0.27  0.82  0.50          33 mm            edge-on, arm across the body
 *    160°         0.40  0.71  0.58           7 mm            open palm, hilt lying on it
 *
 * 60° it is: the palm turned squarely across the body, which is where a real
 * one-handed sabre guard puts it, so the fingers wrap toward the lens and the
 * hilt sits inside the curl instead of behind a knuckle. It also puts the
 * wrist furthest below the grip point of any candidate, which is the anti-
 * icepick bound the previous pass was solving for — the two wants turned out
 * to agree.
 *
 * An object rather than a constant so a render can sweep it without an edit:
 * `tools/shot.mjs --pose` sets the value it is testing.
 *
 * ── AND THERE ARE TWO OF THEM, BECAUSE THERE ARE TWO GRIPS ─────────────────
 *
 * The table above was taken with the off hand off the hilt and the blade's
 * grip model still `GRIPS.two` — which is a state the game could reach only
 * through the `fpHands` option, because that option moved the ARMS and left
 * the weapon alone. It is gone (see `handsOnHilt`), and with it the pretence
 * that one first-person roll could serve both grips: a player who presses the
 * one-hand key gets `GRIPS.one`, whose hilt sits 185 mm outboard of the view
 * axis against 55 and reaches 0.36 from the anchor against 0.29, and the fist
 * has to come round the shaft from somewhere else entirely.
 *
 * Swept on the ratchet's own bench with the one-hand key actually held
 * (`tools/_wristsweep.mjs --fproll`), worst wrist / worst forearm, and beside
 * them the two readings the 60° above was chosen on:
 *
 *     roll      two hands on the hilt            one hand on the hilt
 *            wrist  fore°/s  under  out  eye   wrist  fore°/s  under  out  eye
 *       0°   111.8    6448   −22 mm −0.34 −0.03  108.8   2773  −31 mm −0.02 0.56
 *      15°   114.9    3852   −31    −0.37 −0.04  109.9   2382  −38    −0.04 0.62
 *      30°   116.6    1912   −38    −0.38 −0.06  102.3   2429  −43    −0.05 0.65  <- one
 *      45°   116.6    1719   −42    −0.36 −0.06  112.5   3520  −45    −0.07 0.63
 *      60°   115.1    1605   −44    −0.31 −0.07  167.6   3002  −46    −0.07 0.56  <- two
 *      90°   108.0    2225   −39    −0.16 −0.06  150.7   3621  −40    −0.07 0.33
 *
 * SIXTY IS THE WORST VALUE IN THE ONE-HANDED COLUMN — 167.6° is a wrist folded
 * further back than the 145 the ratchet allows and 3002 °/s is past its 2700,
 * and both were live and unmeasured, because no bench in this repo had ever
 * pressed the one-hand key. The three quantities do not fight over the fix:
 * 30° is simultaneously the best wrist, the highest `eye` (the palm turned
 * back at the lens, which is the inside of the wrist a real one-handed guard
 * shows), and 43 of the 46 mm of clearance the fist can get under the grip
 * point. It is one of only two rows in that column inside both ratchet bounds.
 *
 * 60° stays for two hands, where it is still the best forearm in the sweep and
 * the deepest under the grip. The two numbers being different is the whole
 * finding: a fist that shares a shaft with another fist and a fist alone on it
 * do not come round it the same way.
 */
export const FP_TUNE = { roll: { two: 60 * Math.PI / 180, one: 30 * Math.PI / 180 } };
export function fpGripOn(saber) {
  const lo = saber?.hiltFloor;
  return typeof lo === 'number' && Number.isFinite(lo) ? lo + FIST_CLEAR : GRIP_AT.FP;
}



// Scratch for the viewmodel alone. It runs in the middle of the arm solve,
// which is already holding _v1.._v6 AND _g1.._g5, so it may borrow neither.
const _m1 = new THREE.Vector3(), _m2 = new THREE.Vector3(), _m3 = new THREE.Vector3();
const _m4 = new THREE.Vector3(), _m5 = new THREE.Vector3(), _m6 = new THREE.Vector3();
const _m7 = new THREE.Vector3();

/**
 * Scratch for the camera rig's shoulder probe alone. It runs inside
 * CameraRig.update, which is already holding _v1.._v5 (forward, right, anchor,
 * the collision back-vector and the terrain probe), so it may borrow none of
 * them — and the probe is a raycast, so a shared temp aliased into a physics
 * call is a bug that only shows up against geometry.
 */
const _c1 = new THREE.Vector3(), _c2 = new THREE.Vector3(), _c3 = new THREE.Vector3();
const _c4 = new THREE.Vector3();

/**
 * WHAT THE BOOM HAS TO KEEP CLEAR, AND WHY ONE RAY DOES NOT DO IT.
 *
 * The near plane is a rectangle, not a point. At 60 degrees vertical and
 * 0.15 m it is 0.17 m tall and 0.31 m wide on a 16:9 frame, so its far CORNER
 * sits 0.232 m out from the camera along the diagonal. A single ray down the
 * boom's axis reports what the boom passes THROUGH and says nothing about a
 * trunk standing beside it — and beside it is exactly where a trunk fills the
 * screen with bark, because the corner reaches it first.
 *
 * Measured on The Drowned Wood, a player walked through the stand for ninety
 * seconds with the boom sweeping: the axis ray alone left the near plane
 * inside a DRAWN trunk on 159 of 5,400 frames (2.9%, one frame in thirty-four)
 * and the camera's own point inside one on 33 (0.6%), worst penetration
 * 0.182 m. That is the bug, and it is not a tuning number: no pull-back
 * distance fixes a probe that never saw the trunk.
 *
 * So the boom casts a FAN — the axis plus the four near-plane corners, all
 * parallel — and takes the nearest of the five. That is a box sweep at the
 * resolution the geometry needs: the thinnest trunk in the wood is 0.38 m
 * through (`Levels.js` plants radius 0.16 + t*0.46) and the widest gap between
 * adjacent rays is 0.31 m, so nothing that fits between them is wide enough to
 * hide.
 *
 * `BOOM_SKIN` is the second half, and it is about the COLLIDER rather than the
 * camera. `Trees.js` inscribes a trunk's box at 0.82 of the butt radius
 * (`SQUARE_FIT`, so a body brushing the corner of a square catches on
 * nothing), which leaves up to 0.18 r of drawn bark outside the thing the ray
 * can hit — 0.11 m on the widest trunk in the wood. The skin pays for that and
 * for the same slack in every other inscribed prop.
 *
 * The two together come to 0.35 m against the 0.34 m this used to subtract
 * blind, which is why nothing outside the wood moves: the old number was very
 * nearly right for a probe that could see, and wrong only about how much the
 * probe could see.
 */
const BOOM_SKIN = 0.12;
/** Fallback frame shape when the camera has not been sized yet (headless). */
const BOOM_ASPECT = 16 / 9;
/** How much reach the cast is given past where the camera wants to sit. */
const BOOM_LOOKAHEAD = 0.08;
/** Nearest the boom may be pulled before it gives up and sits in the head. */
const BOOM_FLOOR = 0.55;
/** The four corners of the near plane, as (right, up) signs. */
const BOOM_FAN = [[1, 1], [1, -1], [-1, 1], [-1, -1]];
/** What the boom is allowed to be stopped by. Hoisted: five casts a frame. */
const BOOM_SOLID = (b) => b.static || b.layer === LAYER.PROP;

export class CameraRig {
  constructor(camera) {
    this.camera = camera;
    this.yaw = 0;
    this.pitch = -0.06;
    this.distance = 3.05;
    this.targetDistance = 3.05;
    /** Where the boom ENDED UP last frame — see the write in `update`. */
    this.boom = 3.05;
    this.height = 1.52;
    this.shoulder = 0.46;
    this.firstPerson = false;
    this.pos = new THREE.Vector3();
    this.look = new THREE.Vector3();
    this.shake = 0;
    this.shakeSeed = rng() * 100;
    /**
     * The shake's own clock, in GAME seconds.
     *
     * It used to read `performance.now()`, which is wrong in three ways and was
     * only ever noticed as a flaky assertion:
     *
     *   · under a hitstop the world runs at 0.06× and the wall clock does not,
     *     so the camera buzzed at full rate through the one moment the shake
     *     exists for — the same class of bug as the per-frame damping in
     *     Cloth.js, and the same fix;
     *   · it keeps advancing while the game is paused, so unpausing resumed the
     *     shake at whatever phase real time had wandered to;
     *   · and it cannot be reproduced. In a headless run the wall clock advances
     *     by the time the frame took to COMPUTE rather than by 1/60, so the
     *     47 rad/s term moved 0.005 rad a frame instead of 0.79 and the shake
     *     was a frozen direction with a decaying magnitude. `controls: unticking
     *     Camera shake` measured whatever point of the sine the clock happened
     *     to be at and failed once at 0.238° against a typical 1.0–1.2°.
     */
    this.shakeT = 0;
    this.fov = 60;
    this.fovTarget = 60;
    this.roll = 0;
    this.rollTarget = 0;
    this.enabled = true;
    this.aimQuat = new THREE.Quaternion();
    this._smoothTarget = new THREE.Vector3();
    this._init = false;
    /** Where the eye currently sits relative to a neutral stance — see EYE_FOLLOW. */
    this.eyeOffset = new THREE.Vector3();
    /** How much of the pelvis the cap had to refuse this frame, metres. */
    this.eyeCapped = 0;
    /**
     * WHICH SIDE THE CAMERA STANDS ON, as a sign rather than a distance.
     *
     * `shoulder` is the offset and it was written once in this constructor and
     * never again by anything in the project, so the camera stood over the same
     * shoulder into every corner in the game. Splitting the sign off the
     * magnitude is what lets the swap be a smooth ease of one number rather
     * than a teleport, and it is what `_resolveShoulder` moves.
     */
    this.shoulderSide = 1;
    this.shoulderAt = this.shoulder;
    /** The death shot, or null. See beginDeathShot. */
    this.shot = null;
  }

  /**
   * A DEATH CAMERA — the worst 2.6 seconds in the game, framed.
   *
   * What happened before this: `_updateDead` pulled the boom to 4.4 m and eased
   * the pitch to -0.42, and that was the whole of it. The camera that had been
   * over your shoulder stayed over the shoulder of a corpse, at the yaw the
   * mouse happened to be at when you were hit, until the card arrived.
   *
   * The shot is a SCRIPT on the rig's own numbers rather than a second camera:
   * the boom rises and pulls back, the pitch eases down onto the body, the
   * shoulder offset unwinds to zero (there is nothing left to aim), and the
   * whole thing drifts a fifth of a radian around the body so the frame is
   * moving when the card lands. Written as targets and left to the rig's
   * existing damping, so it costs no new integrator and it cannot fight the
   * collision pull-in — a death against a wall still frames.
   *
   * It runs on the WORLD's clock, which by then is at a third speed, and that
   * is the point: the drift is authored at the rate it should read at 1.0 and
   * arrives slower because everything else has.
   */
  beginDeathShot(opts = {}) {
    this.shot = {
      t: 0,
      dur: clamp(opts.seconds ?? 3.4, 0.5, 12),
      /**
       * WHETHER THE SHOT MAY MOVE — and NOT whether it happens at all.
       *
       * The one line that gets a first-person lens out of the corpse lives in
       * `update`, and it lived inside `if (shot)`, and the shot was begun only
       * when `feelOn('shake') !== false` — an ordinary user checkbox. So a
       * player who had turned camera shake off died INSIDE THEIR OWN HEAD:
       * measured with shake off, shot NONE, `firstPerson` still true, the lens
       * 1.02 m from the ragdoll's middle, for the whole death.
       *
       * Coming off the body is not motion feedback, it is the difference
       * between watching a death and watching the inside of a skull, so the
       * shot is always taken and only its SCRIPT — the turn, the drift, the
       * boom, the lens — answers to the toggle. With motion off the still
       * frame in `_updateDead` owns the boom exactly as it did before.
       */
      motion: opts.motion !== false,
      // Away from whatever the body was facing, so the camera swings to look at
      // the front of it rather than following it down from behind.
      turn: (this.shoulderSide >= 0 ? 1 : -1) * (opts.turn ?? 0.62),
      yaw0: this.yaw,
      fov0: this.fovTarget,
      // Everything the shot commandeers, so ending it is a restore and not a
      // second table of defaults that can drift from the constructor's.
      fp0: this.firstPerson, dist0: this.targetDistance, height0: this.height,
    };
    return this.shot;
  }

  /**
   * A LENS KICK THAT EXPIRES ON THE GAME'S CLOCK. See the caller in _jump.
   *
   * The rig damps `fov` toward `fovTarget` at 7/s every frame already, so all
   * this owns is putting the target up and taking it down again — and taking it
   * down `seconds` of GAME time later, not of wall time. Whoever else is
   * writing `fovTarget` that frame (the speed FOV) wins the moment the kick
   * expires, because the kick restores what it found rather than a constant.
   */
  kickFov(degrees = 6, seconds = 0.18) {
    this.fovKick = { amp: degrees, left: clamp(seconds, 0.02, 3), dur: clamp(seconds, 0.02, 3) };
    return this.fovKick;
  }

  /**
   * How many degrees the kick is adding right now. Decays on the game clock.
   *
   * `k ** 0.6` starts at the full amplitude and eases out. It is applied on top
   * of the SMOOTHED fov rather than to the target it damps toward, because the
   * damp is 7/s and 6 degrees fed through it for 0.18 s reaches 1.97 — measured
   * — so a kick written as a target could never be the kick it says it is. A
   * lens kick is an impulse; the ease-out is its release.
   */
  _fovKickAmount(dt) {
    const k = this.fovKick;
    if (!k) return 0;
    k.left -= Math.max(dt, 0);
    if (k.left <= 0) { this.fovKick = null; return 0; }
    return k.amp * Math.pow(k.left / k.dur, 0.6);
  }

  /** Give the rig back. Idempotent — respawn and dispose may both call it. */
  endShot() {
    const s = this.shot;
    if (!s) return false;
    this.shot = null;
    this.firstPerson = s.fp0;
    this.targetDistance = s.dist0;
    this.height = s.height0;
    this.fovTarget = s.fov0;
    return true;
  }

  /**
   * Where the camera stands, and how far off the body's line it may be.
   *
   * TWO DEFECTS IN ONE NUMBER, and both of them are about a boom that has been
   * pulled in. `dist` collapses to as little as 0.55 m against a wall, and the
   * lateral offset did not collapse with it: at 0.55 m a fixed 0.46 m sideways
   * is 40 degrees off axis, which puts the player's own head and shoulder
   * across the middle of the frame — and screen centre is where the reticle is.
   * Scaling the offset by how much of the boom survived keeps the body at a
   * constant ANGLE instead of a constant distance, which is the thing the eye
   * actually reads.
   *
   * And the side is now a decision rather than a constant. If the wall is on
   * the right and not on the left, the camera steps to the left — the same
   * thing a player would do with a manual swap and the same thing every
   * third-person game has done for fifteen years. Hysteresis (the 0.6 m) stops
   * it flapping in a doorway.
   */
  _resolveShoulder(dt, base, fwd, right, ctx) {
    // The shot owns the frame; a corpse is not aiming past its own shoulder.
    if (this.shot) {
      this.shoulderAt = damp(this.shoulderAt, 0, 3.2, dt);
      return this.shoulderAt;
    }
    // Two extra raycasts a frame to answer a question that changes on the scale
    // of a doorway is waste; six frames is a tenth of a second and the ease
    // below is slower than that anyway.
    this._sideTick = (this._sideTick | 0) + 1;
    if (ctx.physics && this.shoulder > 0.01 && (this._sideTick % 6) === 0) {
      const reach = this.targetDistance + 0.42;
      const filter = (b) => b.static || b.layer === LAYER.PROP;
      _c2.copy(fwd).negate();
      let r = reach, l = reach;
      _c1.copy(base).addScaledVector(right, this.shoulder);
      const hr = ctx.physics.raycast(_c1, _c2, reach, filter);
      if (hr) r = hr.distance;
      _c1.copy(base).addScaledVector(right, -this.shoulder);
      const hl = ctx.physics.raycast(_c1, _c2, reach, filter);
      if (hl) l = hl.distance;
      if (this.shoulderSide > 0 && l > r + 0.6) this.shoulderSide = -1;
      else if (this.shoulderSide < 0 && r > l + 0.6) this.shoulderSide = 1;
    }
    this.shoulderAt = damp(this.shoulderAt, this.shoulder * this.shoulderSide, 5, dt);
    return this.shoulderAt;
  }

  /**
   * Advance the eye's ride on the pelvis. Called EXACTLY once a frame, by the
   * owner, immediately after the gait has been solved — never from update().
   *
   * The split exists because the first-person arms are hung off the eye and the
   * eye is hung off the pelvis, so all three have to be resolved in that order
   * inside one frame. When the camera advanced its own offset during update(),
   * which runs last, the arms could only ever be built against the PREVIOUS
   * frame's eye — a one-frame lag between a viewmodel and the view it is bolted
   * to, which is visible as judder the moment the player turns quickly.
   */
  advanceEye(dt, pelvis) {
    if (!this.firstPerson) { this.eyeOffset.set(0, 0, 0); this.eyeCapped = 0; return this.eyeOffset; }
    // THE EYE RIDES THE PELVIS. All of it, every axis — bob, sway, the run's
    // crouch, the landing dip and the reach clamp — because that is what a head
    // bolted to a spine does, and because any fraction less than all of it is
    // the body and the camera being two simulations of one person. See
    // EYE_FOLLOW; the cap is a statement about necks, see EYE_MAX_SPEED.
    _v5.copy(pelvis || _ZERO).multiplyScalar(EYE_FOLLOW).sub(this.eyeOffset);
    // VERTICAL ONLY. The lateral sway is a pure cosine of the gait clock with
    // nothing clamped on top of it, so it is smooth by construction, and capping
    // it can only open a gap for the body to slide through — measured, a
    // magnitude cap cost 4.9 mm of lateral weld at a sprint and bought nothing.
    // It is the vertical that has spikes, because that is where the reach clamp
    // is.
    const maxStep = EYE_MAX_SPEED * Math.max(dt, 1e-4);
    this.eyeCapped = Math.max(0, Math.abs(_v5.y) - maxStep);
    if (Math.abs(_v5.y) > maxStep) _v5.y = Math.sign(_v5.y) * maxStep;
    this.eyeOffset.add(_v5);
    return this.eyeOffset;
  }

  /**
   * Where the eye is. ONE function, and both callers that matter use it: the
   * camera itself, and the first-person arms that have to be welded to it.
   * Two copies of this arithmetic is precisely how the arms and the view came
   * to disagree in the first place.
   */
  eyePosition(target, eyeHeight, out) {
    out.copy(target).addScaledVector(UP, eyeHeight).add(this.eyeOffset);
    // Offset along the body's HORIZONTAL forward, not the view forward.
    // Following the view meant looking down also moved the eye downward and out
    // of the head, so the pivot drifted as you aimed.
    _v4.set(0, 0, -1).applyQuaternion(this.aimQuat).setY(0);
    if (_v4.lengthSq() > 1e-6) out.addScaledVector(_v4.normalize(), 0.07);
    return out;
  }

  /**
   * Rebuild the aim quaternion from the yaw and pitch the input just wrote.
   *
   * update() does this too, but update() runs LAST, so everything solved before
   * it — the blade, and now the arms welded to the view — was reading an aim
   * that was one frame old. On a 400 deg/s flick that is 6.7 degrees, which at
   * the 0.3 m the hands sit from the lens is 3.5 cm of viewmodel lagging behind
   * its own camera. Cheap enough to simply do twice.
   */
  syncAim() { this.aimQuat.setFromEuler(_eul.set(this.pitch, this.yaw, 0, 'YXZ')); return this.aimQuat; }

  addYaw(d) { this.yaw += d; }
  addPitch(d) { this.pitch = clamp(this.pitch + d, -1.28, 1.16); }

  aimDirection(out = new THREE.Vector3()) {
    return out.set(0, 0, -1).applyQuaternion(this.aimQuat);
  }

  update(dt, target, ctx = {}) {
    /**
     * THE SHOT DRIVES THE RIG, and it does it here — before syncAim — so the
     * yaw it writes is the yaw the aim quaternion, the boom and the collision
     * probe all read on the SAME frame. Written as an else-if on `firstPerson`
     * as well: a first-person death has to come out of the head, or the shot is
     * three seconds of the inside of your own skull.
     */
    const shot = this.shot;
    if (shot) {
      shot.t = Math.min(shot.dur, shot.t + Math.max(dt, 0));
      // OUT OF THE HEAD FIRST, and outside the script: a first-person death
      // has to come out of the head whether or not the camera is allowed to
      // move afterwards. See `motion` in beginDeathShot for the measurement.
      this.firstPerson = false;
    }
    if (shot && shot.motion) {
      const k = shot.t / shot.dur;
      // ease-out on everything, so the move is quick where it is informative
      // (getting off the shoulder and onto the body) and slow where it is not.
      const e = 1 - Math.pow(1 - k, 2.2);
      this.yaw = shot.yaw0 + shot.turn * e;
      this.pitch = lerp(this.pitch, -0.52, Math.min(1, dt * 2.4));
      this.targetDistance = lerp(3.05, 5.1, e);
      this.height = lerp(1.52, 2.15, e);
      // A wider lens as it settles: the frame opening up is what says the fight
      // is over, and it is the one FOV move in the game that is not a speed cue.
      this.fovTarget = shot.fov0 + 7 * e;
    }
    this.syncAim();

    if (!this._init) { this._smoothTarget.copy(target); this._init = true; }
    // First person locks the eye to the body with NO positional smoothing. Even
    // at a damping rate of 40 the eye trails the body by a couple of frames,
    // and in first person that reads as the entire world swimming behind your
    // own movement — the single largest source of first-person jank. Third
    // person still wants the lag; it is what makes the camera feel like a
    // camera rather than a rigid boom.
    if (this.firstPerson) this._smoothTarget.copy(target);
    else dampVec(this._smoothTarget, target, 16, dt);

    this.distance = damp(this.distance, this.targetDistance, 8, dt);
    /* THE KICK IS AN IMPULSE ON TOP, and that is the fix rather than a refinement.
     *
     * `_jump` wrote `camera.fovTarget = camera.fov + 6` and armed a
     * `setTimeout` to put it back 180 ms later. Two things wrong with it, and
     * the second is fatal: the timer is on the WALL clock, so inside a hitstop
     * or a Force Sense it expired before the jump had visibly started and
     * behind a pause card it expired behind the pause card — and
     * `Player._updateCamera` ASSIGNS `fovTarget` from the speed term on every
     * single frame, so the six degrees were overwritten on the very next one
     * and the kick the audit describes never reached the screen at all.
     * Additive, and decayed on the dt the rig is already handed. */
    this.fov = damp(this.fov, this.fovTarget, 7, dt);
    this.fovKickAt = this._fovKickAmount(dt);
    this.roll = damp(this.roll, this.rollTarget, 6, dt);

    const fwd = _v1.set(0, 0, -1).applyQuaternion(this.aimQuat);
    const right = _v2.set(1, 0, 0).applyQuaternion(this.aimQuat);

    if (this.firstPerson) {
      this.eyePosition(this._smoothTarget, ctx.eyeHeight ?? 1.62, this.pos);
      this.look.copy(this.pos).addScaledVector(fwd, 10);
    } else {
      this.eyeOffset.set(0, 0, 0);
      this.eyeCapped = 0;
      const anchor = _v3.copy(this._smoothTarget).addScaledVector(UP, this.height);
      // THE OFFSET IS SCALED BY HOW MUCH OF THE BOOM SURVIVED. See
      // _resolveShoulder: a pull-in to 0.55 m with a fixed 0.46 m sideways puts
      // the player's own head 40 degrees off axis and across the reticle.
      const side = this._resolveShoulder(dt, anchor, fwd, right, ctx)
        * clamp(this.distance / Math.max(this.targetDistance, 0.6), 0.3, 1);
      anchor.addScaledVector(right, side);
      let dist = this.distance;
      // pull in when the camera would clip geometry — see BOOM_SKIN for why
      // this is a fan of five rays and not the one it used to be
      if (ctx.physics) {
        const back = _v4.copy(fwd).negate();
        const cam = this.camera;
        const hh = (cam?.near ?? 0.15) * Math.tan(((cam?.fov ?? 60) * Math.PI / 180) / 2);
        const hw = hh * (cam?.aspect > 0.2 ? cam.aspect : BOOM_ASPECT);
        const corner = Math.hypot(cam?.near ?? 0.15, hh, hw);
        const margin = corner + BOOM_SKIN;
        const reach = dist + margin + BOOM_LOOKAHEAD;
        /* THE FRAME'S OWN UP, not the world's. The near plane tilts with the
         * pitch, so a fan spread along world up under-covers the sides of a
         * steeply angled boom and over-covers its top and bottom. right x fwd
         * is the camera's up for this basis and costs one cross product. */
        const up = _c4.crossVectors(right, fwd).normalize();
        let near = reach;
        const axisHit = ctx.physics.raycast(anchor, back, reach, BOOM_SOLID);
        if (axisHit) near = Math.min(near, axisHit.distance);
        for (const [sr, su] of BOOM_FAN) {
          /* THE CORNER RAYS RUN FROM THE ANCHOR'S OWN CORNERS, offset by the
           * same amount the camera's near plane is wide. Offsetting only the
           * far end would tilt them, and a tilted ray reports a distance along
           * itself rather than along the boom — the pull-in would then be off
           * by the cosine and would grow with the offset. Parallel keeps the
           * five distances comparable, which is the whole point of taking a
           * minimum over them. */
          const o = _c3.copy(anchor).addScaledVector(right, sr * hw).addScaledVector(up, su * hh);
          const h = ctx.physics.raycast(o, back, near, BOOM_SOLID);
          if (h && h.distance < near) near = h.distance;
        }
        if (near < reach) dist = Math.max(BOOM_FLOOR, near - margin);
        /* WHAT THE BOOM ACTUALLY CAME OUT AT, published for the probes.
         * `this.distance` is what the boom WANTS and is never written here, so
         * anything reading it to ask "how far back is the camera" gets the
         * answer for an empty field. */
        this.boom = dist;
      }
      if (ctx.terrain) {
        const p = _v5.copy(anchor).addScaledVector(fwd, -dist);
        const h = ctx.terrain.height(p.x, p.z) + 0.4;
        if (p.y < h) {
          const dy = h - p.y;
          anchor.y += dy * 0.6;
          dist = Math.max(0.7, dist - dy * 0.35);
        }
      }
      this.pos.copy(anchor).addScaledVector(fwd, -dist);
      this.look.copy(anchor).addScaledVector(fwd, 6);
    }

    // shake
    if (this.shake > 0.001) {
      this.shakeT += dt;
      const t = this.shakeT + this.shakeSeed;
      const amp = this.shake * (this.firstPerson ? 0.055 : 0.09);
      this.pos.x += Math.sin(t * 47.3) * amp;
      this.pos.y += Math.sin(t * 39.7 + 1.7) * amp;
      this.pos.z += Math.cos(t * 43.1 + 0.6) * amp;
      this.shake = damp(this.shake, 0, 5.5, dt);
    }

    this.camera.position.copy(this.pos);
    if (this.firstPerson) {
      // Take the orientation straight from aimQuat instead of re-deriving it
      // with lookAt(). lookAt rebuilds a basis against `up` every frame, which
      // at the pitch limits sits close to the view direction and goes unstable
      // — visible as the horizon twitching when you look far up or down. The
      // aim quaternion is already exact; roll is composed onto it.
      this.camera.quaternion.copy(this.aimQuat);
      if (Math.abs(this.roll) > 1e-5) {
        this.camera.quaternion.multiply(_q1.setFromAxisAngle(FWD, this.roll));
      }
      this.camera.up.set(0, 1, 0);
    } else {
      this.camera.up.set(Math.sin(this.roll), Math.cos(this.roll), 0).applyQuaternion(
        _q1.setFromAxisAngle(UP, this.yaw));
      this.camera.lookAt(this.look);
    }
    // The near plane has to be tighter in first person or your own hands and
    // the base of the blade clip through it.
    const near = this.firstPerson ? 0.045 : 0.15;
    if (this.camera.near !== near) { this.camera.near = near; this.camera.updateProjectionMatrix(); }
    // `fov` is where the lens is settling; `fovKickAt` is the impulse riding on
    // top of it. Only the sum is ever a real focal length.
    const shown = this.fov + (this.fovKickAt || 0);
    if (Math.abs(this.camera.fov - shown) > 0.01) {
      this.camera.fov = shown;
      this.camera.updateProjectionMatrix();
    }
  }

  addShake(v) { this.shake = Math.min(1.5, this.shake + v); }
}

/* ══════════════════════════════════════════════════════════════════════ */
/*  Sides, and who may harm whom                                          */
/* ══════════════════════════════════════════════════════════════════════ */

/**
 * A PLAYER COULD NOT FIGHT A PLAYER, AND `team` IS THE FIELD THAT SAID SO.
 *
 * `Player.team` was the literal `0`, written once in the constructor and read
 * only to compare a bolt against; `RemoteAvatar.team` was the literal `0`,
 * written once and read by NOTHING. Every damage path in the game therefore had
 * two answers available — "is this a player?" and "is this an enemy?" — and no
 * third, so there was no shape of fight in which the thing across the room was
 * both.
 *
 * MEASURED, before any of this existed, on two real Players in one arena
 * (tools/checks/pvp.mjs reproduces the whole paragraph):
 *
 *   · the second player's blade swept through the first one's chest for 3 s —
 *     180 frames of genuine contact — for 0.0 damage, and 0 of the blade
 *     target records built that frame were a player. `World._resolveBlades`
 *     assembles its list from `enemies`, `props` and `doors`, and a Player had
 *     no `capsules()` to offer it in the first place.
 *   · a force push aimed point-blank left the other player's velocity at
 *     0.000 m/s. Force lightning at 1.2 m took them 100 hp → 100 hp. Every one
 *     of those loops reads `ctx.enemies`, and `ctx.players` — which World has
 *     always put in the same object — was read by nothing in this file.
 *   · and the converse, which is the half nobody notices: an explicit
 *     `ally.damage(25, point, me, 'saber')` landed for 21.2, because nothing
 *     anywhere consulted a team before applying a number. Co-op was never
 *     "friendly fire is off". It was "no path exists that could deliver it",
 *     which is the same thing right up until the day one does.
 *
 * THE NUMBERS, and why they are these. `Enemy.team` is 1, `Bolt.team` defaults
 * to 1, and World's bolt hit test is written in terms of the literals 0 and 1
 * in six places. So the horde keeps 1 forever, the first player side keeps 0
 * forever — every existing comparison in the game stays exactly as true as it
 * was — and further player sides take the numbers above it. `SIDES` is the
 * whole of that decision and `sideTeam` is the only thing allowed to make one,
 * so nobody can hand out a player side of 1 and post half a duel to the horde's
 * ledger.
 *
 * This lives beside `Player.team` rather than in Combat.js because the meaning
 * of a side belongs next to the field that carries it, and because Net.js needs
 * the same rule for a RemoteAvatar and already depends on this direction.
 */
export const TEAM = { PARTY: 0, HORDE: 1 };

/**
 * The four player sides, in order. Four because four is the session cap (see
 * Net.js), so a free-for-all between the whole party is expressible and so is
 * 2v2 by handing out the first two.
 *
 * 1 is skipped, and that is the only interesting thing about this list.
 */
export const SIDES = [TEAM.PARTY, 2, 3, 4];

/** The team number for the i-th side, wrapping. Nothing else may invent one. */
export function sideTeam(i) {
  const n = SIDES.length;
  return SIDES[(((i | 0) % n) + n) % n];
}

/**
 * A team number somebody handed us, made safe. Anything that is not one of the
 * four player sides — undefined, a string off a settings blob, the horde's 1 —
 * becomes the party's side, which is the number every player already had. So
 * the worst a bad value can do is leave a body in co-op.
 */
export function asSide(v) {
  return SIDES.includes(v) ? v : TEAM.PARTY;
}

/**
 * THE SAME THING FOR A BODY RATHER THAN A PLAYER, AND IT FAILS THE OTHER WAY.
 *
 * `asSide` is for a PLAYER's side and lands a bad value in co-op, because the
 * worst thing that can happen to a player who could not be identified is that
 * they are on your team. A BODY off the wire is the opposite question: an enemy
 * record that arrived without a legible team is the horde, because that is what
 * every body on this wire was before the field existed, and answering it with
 * the party's 0 would hand a joining player a level full of allies that shoot
 * at nobody. So this accepts the horde's number as well as the four sides, and
 * anything else — undefined, a string, a 7 — is the horde.
 *
 * Two functions rather than one with a flag: the two callers want opposite
 * failure directions and a shared default would have to pick one of them.
 */
export function asTeam(v) {
  return v === TEAM.HORDE || SIDES.includes(v) ? v : TEAM.HORDE;
}

/**
 * Which side a thing is on, or `undefined` if it never said.
 *
 * `undefined` rather than a default, and it is worth the extra branch in
 * `canHarm`. Everything in the game that can be hurt or do hurting declares a
 * team — Player, Enemy, RemoteAvatar all set one in their constructors — but a
 * `source` reaching `damage()` can also be a prop, a destruction fragment, or
 * a stub in a check, and NONE of those are on a side. Handing them all one
 * shared default would make any two of them allies, which is how a gate turns
 * into silent invulnerability. See the branch that guards it.
 */
export function teamOf(entity) {
  return entity && entity.team !== undefined ? entity.team : undefined;
}

/**
 * THE RULES OF A FIGHT, AND WHY THERE IS ONE OBJECT FOR THEM.
 *
 * `friendlyFire` is one boolean and it wants one home, because the failure mode
 * of a rule like this is never that it is wrong — it is that it is right in
 * four call sites and absent from the fifth, and the fifth is the explosion at
 * a wave clear that kills the friend who just revived you. `canHarm` below is
 * the only code in the game permitted to answer the question and `world.rules`
 * is the only place the answer is configured.
 *
 * Frozen, so a caller that reaches for the default cannot quietly turn friendly
 * fire on for every co-op session in the process.
 */
export const CO_OP_RULES = Object.freeze({ pvp: false, friendlyFire: false });

/** The rules in force, with co-op's as the answer for a world that has none. */
export function harmRules(world) {
  return (world && world.rules) || CO_OP_RULES;
}

/**
 * MAY THIS THING HURT THAT THING? ONE GATE, ONE PLACE.
 *
 * Read the branches in order; each is a decision somebody would otherwise have
 * made slightly differently in each of five files:
 *
 *   no attacker       → YES. Falling, drowning, an explosion with nobody's name
 *                       on it. Every existing caller that passes `null` —
 *                       `Player.damage(…, 'fall')`, `World.onExplosion` — is
 *                       unchanged by this, deliberately: the environment is not
 *                       on a side.
 *   attacker is victim → YES. A bolt you deflected into your own feet still
 *                       hurts. That is today's behaviour; switching it off is a
 *                       separate change with its own argument.
 *   either has no side → YES, and this branch is load-bearing. A prop, a
 *                       destruction fragment or a hazard is not on a team, and
 *                       the first version of this gate defaulted them all to
 *                       the horde's — which made any two of them allies and
 *                       silently refused their damage. `tools/checks/vitals.mjs`
 *                       caught it within the hour, on a duellist stub with no
 *                       `team`: 20 hp took a lethal 23.8 and lived. THE GATE
 *                       FAILS OPEN, always. Its wrong answer must be the old
 *                       behaviour, never invulnerability — a hit that does not
 *                       land is silent, and `damage()`'s own NaN note is about
 *                       precisely that class of unrecoverable, unnoticeable bug.
 *   different sides   → YES.
 *   same side         → only if this fight has friendly fire.
 *
 * `rules` falls back to the VICTIM's world before the attacker's, because the
 * victim is the one whose health is about to move, and a peer's avatar carries
 * the world it was built in.
 */
export function canHarm(attacker, victim, rules = null) {
  if (!attacker) return true;
  if (attacker === victim) return true;
  const a = teamOf(attacker), v = teamOf(victim);
  if (a === undefined || v === undefined) return true;
  if (a !== v) return true;
  const R = rules || harmRules((victim && victim.world) || (attacker && attacker.world));
  return !!R.friendlyFire;
}

/**
 * Everyone `actor` is allowed to fight, out of a list of candidates.
 *
 * The horde's targeting question — "the opposing team, or all of them?" — is
 * this function with the horde as the actor, and it needs no mode branch: in
 * co-op every player is side 0 and every one of them is opposed to the horde's
 * 1, so all four come back and nothing about wave play changes. In a duel each
 * side is still opposed to the horde, so a wave running through a duel still
 * hunts everybody. Sorted by nothing — the caller picks nearest, as
 * `World.pickTarget` does.
 *
 * `into` so a caller with two lists to filter — every force power in this file
 * has exactly two, the horde and the players — pays for one array rather than
 * three. `Player._foes` is that caller and it is why this is not a function
 * with a single user waiting for a handover to land.
 */
export function hostileTo(actor, candidates, rules = null, into = null) {
  const out = into || [];
  for (const c of candidates || []) {
    if (!c || c.dead || c.alive === false) continue;
    if (c === actor) continue;
    if (canHarm(actor, c, rules)) out.push(c);
  }
  return out;
}

/**
 * The player bodies `holder`'s blade is allowed to find, as the target records
 * `BladeContactSolver.solve` takes directly.
 *
 * Exported so the one line World needs is a call rather than a second copy of
 * the rule with its own idea of what a duel is — this repository has been bitten
 * six times by a hand-typed twin of a generated table, and a targeting rule is a
 * table with one row. `capsules()` is asked for rather than assumed: a body that
 * has not got one is simply not a target, which is the pre-change behaviour and
 * a safe thing to land on mid-handover.
 */
export function bladeTargets(holder, players, rules = null) {
  const out = [];
  for (const p of players || []) {
    if (!p || p === holder || typeof p.capsules !== 'function') continue;
    if (p.alive === false) continue;
    if (!canHarm(holder, p, rules)) continue;
    out.push({ id: p.id, capsules: p.capsules(), player: p, dead: false });
  }
  return out;
}

/**
 * A POSED RIG, AS THE CAPSULES A BLADE CAN MEET.
 *
 * The bone walk — world matrix, bone axis, `length * cutT`, the 1.12 fat on the
 * radius — is `Enemy.capsules()`'s, lifted to a function both bodies call so
 * that a Jedi and an acolyte are the same shape to the same solver. What
 * DIFFERS between them is the two callbacks: what each bone is made of, and how
 * much of the body it is.
 *
 * `vital` is deliberately left undefined unless a caller supplies it, and the
 * handover this note used to ask for has landed: there is no `VITAL` table left
 * to copy. Enemy.js EXPORTS `severanceOf(bone)`, which prices a bone off the
 * role it declares in its own skeleton, so a caller that wants the game's own
 * lethality passes `vital: severanceOf` and cannot hold a stale second copy of
 * anything. That matters because `World._boltHitTest` scales bolt damage by
 * `lerp(0.6, 1.9, vital)`: two tables that disagreed would make a duel's
 * headshots and a wave's headshots different sizes. Nothing on the player's
 * path reads it yet — the contact solver never does, and World's bolt test uses
 * a single 0.36 m capsule for a player rather than this.
 *
 * `severed` and empty bones are skipped for the reason they always were: a rig
 * lists every joint it could have, and an arm already taken off is not standing
 * in the way of the next swing.
 */
const _rc1 = new THREE.Vector3(), _rc2 = new THREE.Vector3(), _rc3 = new THREE.Vector3();
const _rcq = new THREE.Quaternion();
export function rigCapsules(rig, opts = {}) {
  const out = opts.into || [];
  if (!rig) return out;
  const owner = opts.owner || null;
  const tough = opts.toughness;
  const vital = opts.vital;
  const fat = opts.fat ?? 1.12;
  for (const b of rig.list) {
    if (b.severed || !b.parts.length) continue;
    b.obj.updateMatrixWorld(false);
    _rc1.setFromMatrixPosition(b.obj.matrixWorld);
    _rcq.setFromRotationMatrix(b.obj.matrixWorld);
    _rc2.copy(_rc1).add(_rc3.set(0, b.length * b.cutT, 0).applyQuaternion(_rcq));
    const cap = {
      name: b.name, p0: _rc1.clone(), p1: _rc2.clone(), r: b.radius * fat,
      toughness: typeof tough === 'function' ? tough(b.name) : tough,
      player: owner, owner,
    };
    if (vital) cap.vital = typeof vital === 'function' ? vital(b.name) : vital;
    out.push(cap);
  }
  return out;
}

/* ══════════════════════════════════════════════════════════════════════ */
/*  A duel between players                                                */
/* ══════════════════════════════════════════════════════════════════════ */

/**
 * FREE DUELS WITH FRIENDS — THE PART THAT WAS NOT THERE AT ALL.
 *
 * `MODES.duel` exists and its blurb is honest about what it is: "Acolytes only.
 * No blasters, no crowd. Just blades." — a wave of `acolyte` archetypes, with
 * the player alone in it. The owner asked for something else: "Free duels with
 * friends: choose rounds, health, boons." Three settings and a winner, none of
 * which had anywhere to live. There is no ROUND in this game; there is a wave,
 * and a wave has no other side.
 *
 * So this is a small authoritative state machine, and it deliberately holds no
 * bodies, no scene and no physics. It is driven by facts — "this side has
 * nobody standing" — rather than by reading the arena, and that is what lets
 * the host own it, put it on the wire in ten fields, and have the far end agree
 * without simulating anything. It is also what lets it be tested headlessly to
 * the last transition, which the wave director cannot be.
 *
 * The four states:
 *
 *   'countdown'  bodies placed, blades cold, nobody may score. It exists
 *                because a round that begins the instant the last one ended
 *                hands the round to whoever happened to be mid-swing.
 *   'fighting'   the clock runs and a side can be eliminated.
 *   'round-over' someone took the round; `winner` is their side. Held for
 *                `PVP_INTERMISSION` so the announcement can be read.
 *   'match-over' someone reached the round target. `winner` is the match's.
 *
 * BEST-OF-N WITH THE TARGET DERIVED. `rounds: 5` means first to 3, and `need`
 * is `floor(rounds / 2) + 1` computed once here rather than configured beside
 * it, because two numbers that must agree are one number. An even `rounds` is
 * legal and simply means the match can be decided a round early — best of 4 is
 * still first to 3.
 */

/**
 * The three settings the owner named, and the range each is allowed.
 *
 * `health` spans one clean exchange to a long grind: at 100 the shipped saber
 * damage ends a round in a handful of passes. `rounds` is odd-friendly but does
 * not demand odd. `boons` is the whole of "with build synergies, or without" —
 * on, a duel is the roguelite kit against another player, which is what note 63
 * (healer, tank, synergies) is asking to be able to test; off, it is the five
 * forms and nothing else.
 */
export const PVP_LIMITS = {
  rounds: { min: 1, max: 9, def: 3 },
  health: { min: 50, max: 300, def: 100 },
  /** Seconds before a round with nobody dead is decided on remaining health. */
  roundTime: { min: 30, max: 300, def: 120 },
};

/** How long blades stay cold at the top of a round, and after one is decided. */
export const PVP_COUNTDOWN = 3;
export const PVP_INTERMISSION = 4;

const pvpLimit = (spec, v) => (Number.isFinite(v) ? clamp(Math.round(v), spec.min, spec.max) : spec.def);

/**
 * Read a duel's rules off a settings blob — the same shape `sandboxConfig` has
 * and for the same reason: a menu writes free-form numbers and exactly one
 * function decides what they mean.
 *
 * `friendlyFire` is DERIVED from `pvp`, not offered as its own switch. The
 * owner's note is "friendly fire as a rule, not an accident"; a duel in which
 * you cannot hit the other player is not a duel, and a co-op run in which you
 * can is the accident. One boolean, two consequences, and no way to set them
 * inconsistently.
 */
export function pvpRules(settings = {}) {
  const s = settings || {};
  const pvp = !!s.pvp;
  return {
    pvp,
    friendlyFire: pvp,
    rounds: pvpLimit(PVP_LIMITS.rounds, s.duelRounds),
    health: pvpLimit(PVP_LIMITS.health, s.duelHealth),
    roundTime: pvpLimit(PVP_LIMITS.roundTime, s.duelRoundTime),
    boons: s.duelBoons === undefined ? false : !!s.duelBoons,
  };
}

/**
 * Hand out sides.
 *
 * `teams: 2` is the duel proper — the roster alternates, so a four-player
 * session is 2v2 in roster order and a three-player one is 2v1 with the host on
 * the larger side. `teams: 0` is a free-for-all: everybody gets their own
 * number, which is what `SIDES` having four entries is for.
 *
 * Deterministic and pure, on purpose. It runs on the host and its result goes
 * out on the roster, but a client that recomputes it from the same roster must
 * reach the same answer or the two machines disagree about who may hit whom,
 * which is the worst possible disagreement for a rule that decides damage.
 */
export function assignSides(roster, teams = 2) {
  const n = teams > 0 ? Math.min(teams, SIDES.length) : SIDES.length;
  const out = new Map();
  (roster || []).forEach((r, i) => out.set(r.id, sideTeam(i % n)));
  return out;
}

export class DuelMatch {
  /**
   * @param rules  from pvpRules()
   * @param sides  the side numbers in play, e.g. [0, 2]
   */
  constructor(rules = null, sides = [SIDES[0], SIDES[1]]) {
    this.rules = rules || pvpRules({ pvp: true });
    this.sides = sides.slice();
    /** Rounds won, keyed by side. A plain object so it crosses the wire whole. */
    this.scores = {};
    for (const s of this.sides) this.scores[s] = 0;
    this.phase = 'countdown';
    this.round = 1;
    this.rounds = this.rules.rounds;
    /** Rounds needed to take the match. DERIVED — see the note above. */
    this.need = Math.floor(this.rounds / 2) + 1;
    this.health = this.rules.health;
    this.boons = this.rules.boons;
    this.clock = PVP_COUNTDOWN;
    /** The side that took the last round — or the match, once it is over. */
    this.winner = null;
    /** Written on every transition; the caller drains it. Cleared each update. */
    this.events = [];
  }

  get over() { return this.phase === 'match-over'; }
  get live() { return this.phase === 'fighting'; }
  /** True once the last round has been played out, whoever took it. */
  get spent() { return this.round >= this.rounds; }

  _emit(type, extra) { this.events.push({ type, round: this.round, ...extra }); }

  /** A fresh round: the clock, the phase, and a request for bodies to be reset. */
  beginRound() {
    this.phase = 'countdown';
    this.clock = PVP_COUNTDOWN;
    this.winner = null;
    this._emit('round-begin', { health: this.health });
    return this;
  }

  /**
   * Award the round, and decide whether that ends the match.
   *
   * A null side is a genuine draw — both fighters eliminated on the same frame,
   * which a mutual blade pass really does do — and it burns a round without
   * moving either score. Without that, two players who kill each other every
   * round play forever.
   */
  endRound(side) {
    if (this.phase === 'round-over' || this.phase === 'match-over') return this;
    this.winner = side ?? null;
    if (side !== null && side !== undefined) this.scores[side] = (this.scores[side] || 0) + 1;
    this._emit('round-end', { winner: this.winner, scores: { ...this.scores } });
    const champion = this._champion();
    if (champion !== undefined) {
      this.phase = 'match-over';
      this.winner = champion;
      this._emit('match-end', { winner: champion, scores: { ...this.scores } });
    } else {
      this.phase = 'round-over';
      this.clock = PVP_INTERMISSION;
    }
    return this;
  }

  /**
   * Who has taken the match — `undefined` for "nobody yet", which is not the
   * same value as `null` for "drawn". Two ways to win, and both are needed:
   * reach `need`, or be ahead when the last round is spent. The second is what
   * makes an even `rounds` — and a draw — terminate at all. Three draws in a
   * best-of-3 leaves nobody on `need` and no rounds left, and a match that
   * cannot end is worse than one decided on a tiebreak. Level at the end of the
   * last round is a DRAWN match, reported as null rather than invented for one
   * side.
   */
  _champion() {
    let best = null, bestN = -1, tied = false;
    for (const s of this.sides) {
      const n = this.scores[s] || 0;
      if (n > bestN) { bestN = n; best = s; tied = false; }
      else if (n === bestN) tied = true;
    }
    if (bestN >= this.need) return best;
    if (this.round >= this.rounds) return tied ? null : best;
    return undefined;
  }

  /**
   * One tick.
   *
   * @param standing side → how many of that side are still on their feet. The
   *                 caller counts bodies; this decides what the count means.
   *                 Passing a count rather than the players is what keeps the
   *                 match free of the world, and it is what lets the host send
   *                 a client the same record when the client has authority over
   *                 no body but its own.
   * @param health   side → total remaining health, for the clock tiebreak.
   */
  update(dt, standing = null, health = null) {
    this.events.length = 0;
    if (this.phase === 'match-over') return this.events;
    this.clock = Math.max(0, this.clock - dt);

    if (this.phase === 'countdown') {
      if (this.clock <= 0) {
        this.phase = 'fighting';
        this.clock = this.rules.roundTime;
        this._emit('fight');
      }
      return this.events;
    }

    if (this.phase === 'round-over') {
      if (this.clock <= 0) {
        if (this.spent) {
          this.phase = 'match-over';
          this.winner = this._champion() ?? null;
          this._emit('match-end', { winner: this.winner, scores: { ...this.scores } });
        } else { this.round++; this.beginRound(); }
      }
      return this.events;
    }

    // fighting
    if (standing) {
      const alive = this.sides.filter((s) => (standing[s] || 0) > 0);
      if (alive.length <= 1) { this.endRound(alive.length === 1 ? alive[0] : null); return this.events; }
    }
    if (this.clock <= 0) {
      // Decided on health rather than left drawn: a timed-out round in which one
      // fighter is at 12 hp and the other at 96 has a winner, and calling that a
      // draw rewards whoever ran away.
      this.endRound(health ? this._healthiest(health) : null);
    }
    return this.events;
  }

  _healthiest(health) {
    let best = null, bestH = -Infinity, tied = false;
    for (const s of this.sides) {
      const h = health[s] || 0;
      if (h > bestH) { bestH = h; best = s; tied = false; }
      else if (h === bestH) tied = true;
    }
    return tied ? null : best;
  }

  /**
   * THE MATCH, AS IT CROSSES THE WIRE — the field list, in ONE place.
   *
   * Net.js's `packMatch` and `readMatch` both loop this, so a field added here
   * arrives at the far end with no second edit, and there is no way to end up
   * with a reader that knows twelve slots meeting a packer that sends thirteen
   * — which this repository has already shipped once. Long names rather than
   * the snapshot's two-letter ones, deliberately: this message goes out on a
   * phase change, not at 18 Hz, so the whole record is under 150 bytes either
   * way and legibility is worth more than the difference.
   */
  static WIRE = ['phase', 'round', 'rounds', 'need', 'clock', 'scores', 'health', 'boons', 'winner', 'sides'];

  /** Overwrite from the host's record. A client owns none of this. */
  apply(rec) {
    if (!rec) return this;
    for (const k of DuelMatch.WIRE) if (rec[k] !== undefined) this[k] = rec[k];
    return this;
  }
}

/* ══════════════════════════════════════════════════════════════════════ */
/*  Player                                                                */
/* ══════════════════════════════════════════════════════════════════════ */

/**
 * Every key a boon, an order or an attunement is allowed to move.
 *
 * EXPORTED, and a function so each caller gets its own, because this list is a
 * CONTRACT and it had two copies: one here and a hand-written duplicate in the
 * "every boon applies without throwing" check. The duplicate went stale the
 * moment a card needed a key the copy did not have, and the check then failed
 * for the wrong reason — reporting a NaN that only existed inside the check's
 * own stub.
 *
 * Reading the real defaults makes that check exact instead of approximate: a
 * boon that writes a key which is not declared here now fails it, which is the
 * property actually worth pinning. `undefined * 1.33` is NaN, and a NaN in
 * `cutPower` is a blade that cuts nothing at all.
 */
export function defaultBoonMods() {
  return {
    deflectDamage: 1, cutPower: 1, forceCost: 1, staminaRegen: 1, moveSpeed: 1,
    jumpPower: 1, flowGain: 1, returnCone: RETURN_CONE, healOnKill: 0, lightning: false,
    repulse: false, throwPierce: false, doubleJump: false, lifesteal: 0,
    /** Swings per second, as a multiplier on OVERHEAD.cooldown. See Cadence. */
    attackRate: 1,
    /** Set by the conditional cards; each has a reader in the technique layer. */
    riposteWindow: 1, riposteCut: 1, forceRegen: 1, encircle: 0, ferocity: 0,
    conduit: 0, secondWind: 0, fury: 0, steadfast: 0, sunderShock: 0,
    guardRefund: 0, tempest: 0, sunderReach: 0, mend: 0, absorb: false,
    /**
     * The share of an incoming blow that gets through. A MULTIPLIER, so its
     * identity is 1 and not 0 like the additive rows above it.
     *
     * `Waves.wardGuard` reads it as `?? 1`, so the guard attunement worked
     * without this line — which is exactly why it needs one. Every other
     * conditional field here declares its own identity, and the one that does
     * not is the one that breaks the first time somebody iterates this table or
     * serialises it instead of reading the field by name. The header two
     * paragraphs up is about precisely that: a boon writing a key that is not
     * declared here, and `undefined * 1.33` being NaN.
     */
    ward: 1,
    /** Domination. Force compel refuses by name without it — see forceCompel. */
    compel: false,
    /* ══════════════════════════════════════════════════════════════════
     *  THE RULES, AS OPPOSED TO THE NUMBERS — PLAN.md §4.6
     * ══════════════════════════════════════════════════════════════════
     *
     * "Eight facets that change RULES rather than numbers… At least two of the
     * eight must change the QUORUM. Variance that cannot touch the keystone is
     * variance in a side pocket, and this is the difference between melded and
     * parallel."
     *
     * Every field below is a rule somebody else's system asks about, and every
     * one has its reader named beside it, because a card that promises a rule
     * nothing reads is the one defect this codebase keeps removing. They are
     * declared here rather than kept on the instance for the reason this
     * table's own header gives: `defaultBoonMods` is the closed contract, and
     * a key that is not in it is a key nothing can iterate or serialise. */

    /**
     * WHAT SHARE OF THE LIVING HAS TO BE STANDING WITH THE LINE for the ground
     * to be taken. `CommandDirector.lineGathered` is the reader, and it is the
     * keystone itself — half is the shipped rule and a third is Skirmish Order.
     */
    quorumShare: 0.5,
    /** …AND WHAT THAT COSTS: the muster's purse, scaled. Read by `_areaClear`. */
    musterShare: 1,
    /**
     * DOES A MAN ON THE GROUND STILL COUNT while somebody is standing over
     * him? `lineGathered` again — §4.9's bleed-out window and the quorum are in
     * direct tension by design, and Triage is the facet that changes which way
     * that tension pulls.
     */
    triage: false,
    /** How fast a squad turns ground into a position. Read by `_digTick`. */
    digRate: 1,
    /**
     * WHAT SHARE OF THE WEATHER YOUR OWN LINE HAS TO SEE THROUGH. 1 is the
     * storm as it stands; Storm Sense halves it for your side only. Read by
     * `Enemy._hasLineOfSight`, which is the one place that asks.
     */
    stormEyes: 1,
    /** Does breaking cover pay Insight? Read by `World.onPropBroken`. */
    salvage: false,
    /**
     * DOES A BROKEN MAN GO TO GROUND WHERE HE STANDS instead of walking home?
     * Read by `CommandDirector.steer`, which is where a rout is a destination.
     */
    standfast: false,
  };
}

export class Player {
  constructor(world, opts = {}) {
    this.world = world;
    this.id = opts.id ?? 'local';
    this.name = opts.name ?? 'Jedi';
    this.isLocal = opts.isLocal !== false;
    /**
     * The side this body fights for. Was the literal `0` — see the note above
     * TEAM for what that cost. Through `asSide` rather than taken raw, so
     * nothing can hand a player the horde's number and post half a duel to its
     * ledger; an absent option lands on the party's side, which IS 0, so every
     * existing caller and every co-op session is byte-for-byte unchanged.
     */
    this.team = asSide(opts.team);

    // ── body
    // skinColor and hairColor have been parameters of buildJedi since it was
    // written and nothing ever passed them, so every Jedi in the game wore the
    // one default face. The builder needed no change; this line was the feature.
    const built = buildJedi({
      robeIndex: opts.robeIndex ?? 0, scale: 1,
      skinColor: skinHex(opts.species, opts.skinIndex),
      hairColor: HAIR_COLORS[opts.hairIndex ?? 1]?.hex,
      build: opts.build, species: opts.species, face: opts.face,
      /**
       * THE HOOD, and it is read off the world's settings rather than off
       * `opts` — which is the ONE argument on this call that is.
       *
       * `World.spawnPlayer` composes `opts` and does not carry the wardrobe;
       * `respawn()` below reads every appearance value straight off
       * `world.settings` for exactly the same reason, so this is that file's
       * own idiom applied one line earlier. Reading both means a hood survives
       * a co-op revive as well as a deploy, which is the case the wardrobe
       * seam in ui/Menu.js cannot cover on its own: `applyWardrobe` runs when
       * the player changes something, and a body rebuilt mid-run by
       * `respawn()` is a body it was never told about.
       *
       * A hood is a BUILD argument and not a garment hung on afterwards
       * because it is rigid geometry parented to the head bone — see HOOD_CUTS
       * in Bodies.js. The default of every path is `'none'`, so a player who
       * has never opened the row gets exactly the head they always had.
       */
      hood: opts.hood ?? world.settings?.wardrobe?.hood,
    });
    /* What this body is actually wearing on its head, so the wardrobe seam can
     * tell whether a pick changed anything. See applyWardrobe in ui/Menu.js. */
    this.hood = opts.hood ?? world.settings?.wardrobe?.hood ?? 'none';
    this.rig = built.rig;
    this.palette = built.palette;
    this.built = built;
    this.robeCut = opts.robeCut;
    world.scene.add(this.rig.root);
    /*
     * THE RIG'S OWN SCALE, not 1.
     *
     * Enemy.js has always passed `A.scale` here for exactly this reason, and
     * the player did not — which was invisible while every player was 1.78 m.
     * A 0.66 m figure of Yoda's species has its ankle planted at 72 mm by a
     * gait solved for a human, and floats 43 mm off the floor.
     */
    this.animator = new BipedAnimator(this.rig, { scale: this.rig.scale ?? 1, hipHeight: 0.95 });
    this.animator.onFootstep = (p, speed) => this._footstep(p, speed);
    /**
     * STATURE — how tall this figure actually stands, as a fraction of a human,
     * and it had NO READER anywhere in src/.
     *
     * `SPECIES.smallfolk.frame.stature` has said 0.66 since the row was
     * written. Everything downstream of it used the constants below instead:
     * the chest at a flat 1.34 m and the eye at a flat 1.62. On a 0.66 m
     * figure that puts the guard point — which is where the HILT hangs and
     * therefore what the two-bone arm IK solves to — a clear 0.6 m above the
     * top of its own head. Both arms go up because that is where the weapon
     * is, and the weapon floats because nothing ever asked whether the hands
     * could reach it. Reported as "the blade floats above them, both their
     * arms in the air too", which is a precise description of an arm solver
     * doing its job against a target authored for somebody else.
     *
     * It is NOT `rig.scale`. The body scale is 0.40 and the standing height is
     * 0.66, because the head is authored at 0.74 and the legs at 0.80 of the
     * body — that is the whole point of the small-folk row, and it is why
     * these are two numbers rather than one. `rig.scale` is right for the
     * gait (it measures bones); `stature` is right for anything measured off
     * the FLOOR.
     */
    this.stature = (speciesOf(opts.species)?.frame?.stature ?? HUMAN_H) / HUMAN_H;
    /**
     * …AND STATURE IS ONLY ONE OF THREE SCALES. See `limbScale` in Rig.js.
     *
     * `stature` places things measured off the FLOOR. It is the wrong number
     * for anything measured off the CHEST — which is where the whole guard
     * model is measured from — because a species frame scales the arm
     * separately from the body, and it is the wrong number for a hem, which is
     * measured down a leg scaled separately again. Three scales, three readers,
     * each named at the point of use so the next one is not left guessing which
     * `S` was meant.
     */
    this.limbs = limbScale(this.rig);
    /* An eye is a height on a body, so it takes `stand` like the other three
     * (see the note over `st` in _updateBlade). Exactly 1 for every human-framed
     * species, so no camera in the game moves but the small one's. */
    this.eyeHeight = EYE_H * this.limbs.stand;
    this._makeCloak();

    // ── saber
    this.saber = new Saber(world.scene, {
      colorIndex: opts.colorIndex ?? 0,
      bladeLength: opts.bladeLength ?? 1.15,
      coreWidth: opts.coreWidth ?? 1,
      hiltStyle: opts.hiltStyle ?? 'Graflex',
      /**
       * THE FIRST BLADE IN THE SCENE PUBLISHES THE LIGHT POOL for every blade
       * built after it — see `resolveLightSink`. This is that blade: nothing in
       * a level is constructed before the player, and the alternative is a new
       * constructor argument in Enemy.js, Net.js and World.js, none of which
       * this pass owns.
       */
      engine: world.engine,
      /**
       * …and YOUR blade never loses a slot. Priority is the first term of the
       * pool's ranking, so a local player standing in a crowd of thirty keeps
       * both of their own lights whatever else is on the field. A remote
       * player's blade ranks on brightness and distance like anyone else's,
       * because from here it IS anyone else's.
       */
      lightPriority: opts.isLocal ? 1 : 0,
    });
    /* THE HILT IS SIZED BY THE HAND, not by the stature. It is an object held
     * IN a fist, and `buildHand` is called with the body scale — see
     * Saber.setGripScale for the measurement and for why it shrinks at all. */
    this.saber.setGripScale?.(this.limbs.torso);
    /** …and the same for each forearm's own twist. See _rollForearm. */
    this._foreRoll = { foreR: { q: new THREE.Quaternion(), have: false },
      foreL: { q: new THREE.Quaternion(), have: false } };
    /** …and each elbow's carried swivel. See _wristPole. */
    this._elbow = { armR: { phi: 0, have: false }, armL: { phi: 0, have: false } };
    this.control = new SaberController({
      sensitivity: opts.sensitivity ?? 1,
      followStrength: opts.followStrength ?? 0,
      scheme: opts.scheme ?? 'hold',
      /* The guard is held at arm's length, and the arm is this one's. Every
       * distance in GRIPS is chest-to-hand; see `reachScale` there for what
       * leaving it at a human's did to the small frame. */
      reachScale: this.limbs.arm,
    });
    this.hum = audio.createHum(this.saber.color.getHex());

    // ── movement state
    this.position = new THREE.Vector3(opts.spawn ? opts.spawn.x : 0, 0, opts.spawn ? opts.spawn.z : 6);
    this.position.y = world.terrain ? world.terrain.height(this.position.x, this.position.z) : 0;
    this.velocity = new THREE.Vector3();
    this.facing = 0;
    this.grounded = true;
    this.crouch = 0;
    this.radius = 0.34;
    this.height = 1.78;
    /** Colliders near enough to stand on, rebuilt once a frame by _gatherNear. */
    this._nearBoxes = [];
    this._nearProps = [];
    /**
     * Things you can stand on but not shove: the deck of a spider walker.
     * Kept apart from `_nearProps` because that list is fed to the push loop,
     * and a four-metre chassis is not a crate you barge out of the way.
     */
    this._nearDecks = [];
    /** The height of whatever the feet are over — terrain, rock or crate. */
    this.coyote = 0;
    this.jumpHeld = 0;
    this.dashTimer = 0;
    /** Seconds until stamina may refill again. See STAMINA_HOLD. */
    this.staminaHold = 0;
    /** Running last frame — the other half of SPRINT_START's hysteresis. */
    this._sprinting = false;
    /** Where the feet were at the top of this frame; _collide sweeps from it. */
    this._sweepFromY = this.position.y;
    /** Committed to a slam. Set by `_tryDive`, cleared by `_land`. */
    this.diving = false;
    /** Getting over something taller than a step — see CLIMB_RATE. */
    this.climbing = false;
    /** Who the mend channel is being spent on, or null for yourself. */
    this.healTarget = null;
    /**
     * THE BARRIER. `t` is how long it has been up, `power` is what the shader
     * draws (0 down, 1 up) and is eased so it never pops, and `stopped` counts
     * what it has eaten this raise — see `SHIELD` and `shieldSphere`.
     */
    this.shield = { up: false, t: 0, power: 0, stopped: 0, lastHit: -99 };
    /** The `Crew` this player is at the controls of, or null. See Driving.js. */
    this.driving = null;
    this.dashDir = new THREE.Vector3();
    /** Seconds left of an air dodge's somersault, and the horizontal axis it
     *  turns about. Zero on the ground: a dodge with a foot down is a step. */
    this.flipT = 0;
    this.flipAxis = new THREE.Vector3();
    /** Last frame's flip rotation, so the cape can be carried by the DELTA. */
    this._flipQ = new THREE.Quaternion();
    this.lastGroundY = 0;
    this.fallSpeed = 0;

    // ── stats
    this.maxHp = 100; this.hp = 100;
    this.maxForce = 100; this.force = 100;
    this.maxStamina = 100; this.stamina = 100;
    this.flow = 0;
    this.alive = true;
    this.invuln = 0;
    this.riposteTimer = 0;
    this.staggerTimer = 0;
    /* Death bookkeeping the dynamic Ragdoll import reads back — see die(). */
    this._deathGen = 0;
    this.disposed = false;
    this.combo = 0;
    this.comboTimer = 0;
    this.score = 0;
    this.kills = 0;
    this.deflects = 0;
    /**
     * STAMINA AND FORCE THIS BLADE HAS SPENT ANSWERING BOLTS, cumulative and
     * monotone. Written by `World._creditDeflect` off `Combat.guardCost`.
     *
     * It exists because FLAGSHIP §6's whole argument is about a RATE — 21.6
     * stamina a second against a 16/s regen — and a rate cannot be read off a
     * pool that four other things also spend. It is what
     * `tools/checks/suppression.mjs` measures the beaten zone with, and it is
     * what the Bastion boon hands back: "turning it aside costs you nothing"
     * is exactly true when the card refunds the counter's own delta rather
     * than a flat number that has to be kept in step with the cost table.
     */
    this.guardSpent = 0;
    this.guardForceSpent = 0;
    this.perfects = 0;
    this.limbsRemoved = 0;

    // ── force powers
    this.gripBody = null;
    this.gripEnemy = null;
    /** This hand's share of a contested hold, 0..1. 1 whenever nobody else has
     *  a hand on it, which is every grip in a single-player game. Read by
     *  `hurlGripped` — you can only throw what you own. See `gripClaim`. */
    this.gripShare = 1;
    /** null when not channelling a heal, otherwise seconds elapsed. */
    this.healing = null;
    this._healFrom = 0;
    this.gripDistance = 4;
    /** Where the lifted enemy is being walked to — see _updateGrip. */
    this._liftPoint = new THREE.Vector3();
    /** Why the last grip attempt was refused, so the refusal is measurable. */
    this.lastGripRefusal = null;
    this.senseActive = false;
    this.senseTimer = 0;
    this.saberThrown = false;
    /**
     * THE HAND IS EMPTY. See `disarmed` and `_dropSaber`.
     *
     * Declared here rather than materialising on the first drop, because
     * `disarmed` is read on every frame of `_updateBlade` and `_updateBody` and
     * an undefined that happens to be falsey is not a state, it is a coincidence.
     */
    this.saberDown = false;
    this.throwState = 'held';
    this.throwPos = new THREE.Vector3();
    this.throwVel = new THREE.Vector3();
    this.throwSpin = 0;
    this.throwTimer = 0;
    /** The arm gesture currently reading out whatever the Force is doing. */
    this.gesture = { kind: '', t: 0, env: 0, sustain: false, at: new THREE.Vector3(), hasAt: false };
    /**
     * How much of the BODY is currently in the attack — see `_attackDrive`.
     * `over` is the overhead's own arc, `lunge` the stab's envelope, and `shift`
     * the world-space offset both of them put on the anchor the blade is solved
     * from. Held here rather than recomputed by each reader, because
     * `_updateBlade` and `_updateBody` both need it and they must not disagree.
     */
    this.attack = { over: 0, lunge: 0, slash: 0, slashX: 0, spin: 0, spinSide: 1, shift: new THREE.Vector3() };
    /** The heading a spin was started in — see `_move`'s steering note. */
    this._spinFrame = 0; this._wasSpinning = false;
    /**
     * Force stop. `held` is what is frozen right now, `firing` is what has been
     * let go and is leaving in a ripple, and `bodies` is the membership test so
     * the per-frame capture sweep is not quadratic.
     */
    this.stasis = {
      active: false, timer: 0, radius: 0, fireT: 0, target: null, toOwner: false,
      held: [], firing: [], bodies: new Set(),
      centre: new THREE.Vector3(), point: new THREE.Vector3(), vfx: 0,
    };
    /**
     * Things we threw, and what they have already hit.
     *
     * This used to be the ONLY reason a thrown thing hurt anything: RapierWorld
     * stored `Body.onContact` and dispatched it nowhere, so the thrower had to
     * carry the consequence itself. Contacts are dispatched now
     * (`RapierWorld._dispatchContacts`) and a thrown PROP is hurt by the world
     * rather than by this list — see `_trackHurl`. What is left here is a
     * thrown BODY, which no contact can reach because a ragdoll and a living
     * enemy are not a collider pair, plus the attribution both kinds need.
     */
    this.hurled = [];
    this._wheel = 0;
    /* `shield` WAS NOT IN THIS OBJECT and the barrier worked anyway, which is
     * the only reason nobody noticed: `undefined > 0` is false, so the refusal
     * never fired on a fresh player, and `_endShield`'s assignment then CREATED
     * the key, after which `_tick`'s `for (const k in …)` counted it down like
     * any other. So the barrier's cooldown existed from the first time it came
     * down and not before — and anything that walks this table by name to clear
     * cooldowns (force-voice.mjs's `rearm`, force-economy.mjs's loop) silently
     * skipped it until then. Twelve powers have a cooldown; twelve keys.
     * `grip` has none by design — a hold you can re-take at once is what makes
     * the throw-and-catch reachable — and `sense` is a toggle. */
    this.cooldowns = { push: 0, pull: 0, throw: 0, sense: 0, dash: 0, lightning: 0, stasis: 0, rend: 0, heal: 0, compel: 0, unleash: 0, shield: 0 };
    /* The support calls. One per player, constructed here rather than lazily,
     * so `hud` and the checks can read the entry state on frame one instead of
     * guarding for its absence. */
    this.stratagems = new Stratagems(this);
    this.boons = new RankSet();
    this.boonMods = defaultBoonMods();
    this.airJumps = 0;

    // ── camera
    this.camera = new CameraRig(world.engine.camera);
    this.camera.yaw = Math.PI;
    this.eyeHeight = EYE_H;   // re-derived from the species below, once the rig exists

    /**
     * ── physics proxy so props, rubble and corpses collide with us
     *
     * THE MASK HAS TO NAME THEM. Rapier pairs two colliders iff
     * `(A.layer & B.mask) && (B.layer & A.mask)`, and this said `LAYER.WORLD`
     * — so a crate (`layer PROP`) failed the first conjunct, `PROP & WORLD`
     * being 0, and the capsule interacted with terrain and architecture and
     * NOTHING ELSE. Four call sites list `LAYER.PLAYER` in their own masks
     * believing the player is solid (Destruction.js, Props.js, Ragdoll.js ×3)
     * and all four were dead. Measured, dropped on the player's head, with the
     * capsule occupying y = 0.35 … 1.45:
     *
     *              was (mask WORLD)   now
     *     crate        rests y=0.35   2.20
     *     bone         rests y=0.30   2.15
     *     debris chunk rests y=0.20   2.05
     *
     * — three objects at rest INSIDE the player, on the floor, which is the
     * game's headline rule ("anything you can touch is a physical object")
     * failing on the one collider the player never stops touching.
     *
     * `_gatherNear`/`_collide` already shove props out of the way by hand and
     * that stays: this proxy is KINEMATIC, so Rapier moves the crate and never
     * the player, and the hand-rolled pass is what gives the player back the
     * share of the shove a kinematic body cannot receive. The direction that
     * was missing is the other one — a crate, a limb or a lump of wall meeting
     * the player and being stopped by them.
     *
     * ENEMY is not in the list: an enemy's proxy is kinematic too, and two
     * kinematic bodies generate no contact response in Rapier, so naming it
     * would read as a rule and do nothing.
     */
    this.body = new Body({
      position: this.position.clone().setY(this.position.y + 0.9),
      spheres: capsuleSpheres(0.55, this.radius, 'y', 3),
      shape: capsule(0.55, this.radius),
      mass: 78, kinematic: true, static: false, layer: LAYER.PLAYER,
      mask: LAYER.WORLD | LAYER.PROP | LAYER.DEBRIS | LAYER.RAGDOLL,
      allowSleep: false, gravityScale: 0,
    });
    this.body.userData.player = this;
    world.physics.add(this.body);

    this.chest = new THREE.Vector3();
    /**
     * Where the WEAPON hangs from — the body's chest in third person, a fixed
     * point in the aim frame in first. Separate from `chest` because `chest` is
     * what the rest of the game aims at. See _updateBlade.
     */
    this.gripAnchor = new THREE.Vector3();
    /** Where the arms hang from: the chest plus the trunk's own attack travel.
     *  See the armMax clamp in SaberController.solveTargets. */
    this.armRoot = new THREE.Vector3();
    this.headPos = new THREE.Vector3();
    this._prevChest = new THREE.Vector3();
    this.aimDir = new THREE.Vector3(0, 0, -1);
    this._stepTimer = 0;
    this._lastSwingSound = 0;
    this.hitFlash = 0;
    this.events = [];
  }

  _makeCloak() {
    this.cloak?.dispose();
    this.skirt?.dispose(); this.skirt = null;
    this.hoodDrape?.dispose(); this.hoodDrape = null;
    const mat = this.palette.outer.clone();
    mat.side = THREE.DoubleSide;
    /**
     * `scale` — and Enemy.js has passed it since capes existed.
     *
     * Cloth.js reads `opts.scale ?? 1`, so a cape ordered 0.86 m long was 0.86
     * m long on a 0.66 m figure: a garment longer than the character wearing
     * it, which is what "the clothes look really oversized and funny" is. The
     * numbers below are authored against a 1.78 m human and are multiplied
     * into the figure's own size here rather than restated per species.
     */
    const S = this.rig.scale ?? 1;
    this.cloak = attachCloak(this.world.scene, this.rig, {
      // narrow at the collar, flared at the hem, and stopping above the knee so
      // the legs still read — a floor-length sack hides the whole silhouette.
      scale: S,
      material: mat, width: 0.36, length: 0.86, cols: 9, rows: 11, flare: 1.0,
      cut: this.robeCut,
    });
    // THE ROBE BELOW THE BELT IS CLOTH NOW.
    //
    // It was three rigid lathes bolted to the hips bone, so a hem vertex
    // travelled 0.000 mm in the pelvis frame over seven seconds of walking
    // while the cape beside it travelled 217 mm. That contrast is what the
    // player saw and called "a hard cylinder" under the clothes.
    //
    // It REPLACES those 616 triangles rather than adding to them, so the
    // figure is 448 triangles cheaper with the simulation on than it was
    // without it.
    if (this.built?.robeSkirt) {
      const smat = (this.palette.over || this.palette.outer).clone();
      smat.side = THREE.DoubleSide;
      this.skirt = attachSkirt(this.world.scene, this.rig, {
        scale: S,
        material: smat, rigid: this.built.robeSkirt, cut: this.robeCut,
        // The belt's own two ends, which hang over this. Same material as the
        // obi they are tied in, because they are the same band of cloth.
        sashMaterial: this.palette.trim,
      });
      // The cape used to avoid the skirt via a fixed table of spheres sampled
      // off a standing figure. Now the skirt can move, so the cape follows the
      // real thing: live proxy in, table out.
      this.cloak.outer = this.skirt;
    }
    /* AND THE HOOD'S FALL, if the hood being worn has one. The shell stays
     * rigid on the head bone — see `hoodOn` — and this is the cloth hanging off
     * its hem, which is the half of "act as cloth" that no amount of shaping a
     * mesh can buy. Built from the same bolt as the cape so the two read as one
     * garment. */
    const HD = hoodCut(this.hood)?.drape;
    if (HD) {
      /* THE HEAD'S SCALE AND NOT THE BODY'S — `hoodOn` builds the shell at
       * `built.headScale`, and the two differ by 1.85 on the small-folk row.
       * A fall pinned at the body's scale starts half way up a shell built at
       * the head's. */
      this.hoodDrape = attachHoodDrape(this.world.scene, this.rig, {
        // the hood's own bolt; attachHoodDrape clones it and owns the copy
        scale: this.built?.headScale ?? S,
        material: this.palette.over || this.palette.outer, drape: HD,
      });
    }
  }

  /* ── convenience ─────────────────────────────────────────────────── */

  get difficulty() { return this.world.difficulty; }
  aimPoint(out = new THREE.Vector3()) { return out.copy(this.chest); }
  get dead() { return !this.alive; }

  /**
   * NOTHING IN THE HAND. The same name Enemy uses for the same condition, so
   * the two halves of note 61 read alike: a duellist that loses the sword arm
   * and a player who puts theirs down are in one state, not two.
   */
  get disarmed() { return !!this.saberDown; }

  /**
   * HOW MANY HANDS ARE ON THE HILT — 0, 1 or 2, and it is a FACT about the
   * body rather than a setting.
   *
   *   "Why the fuck would it be either or, both should be modeled and reflect
   *    how many hands you're holding it with"
   *
   * It used to be half a fact. `_poseArms` composed four true things — the
   * grip model, the throw state, whether a gesture had borrowed the off arm,
   * whether the hilt was on the floor — and then ANDed a fifth term onto them
   * that was neither about the hands nor about the weapon: which camera you
   * were in, through a `fpHands` option on the Interface panel. So the same
   * body, in the same state, had a different number of hands on its sword
   * depending on where the lens was, and the settings screen could put a
   * second fist onto a hilt the player had just taken a hand off.
   *
   * Every clause below is something the player DID, and each one is read from
   * the state that already carries it rather than restated here:
   *
   *   `saberDown`      the hilt is on the ground — nothing in either hand
   *   `driving`        both hands are on a machine's controls, and the blade
   *                    is on your belt (Driving.js's `Crew` retracts and hides
   *                    it without setting `saberDown`, because you have not
   *                    dropped it)
   *   `throwState`     anything but `held` is a blade in the air: thrown,
   *                    flown by the Force (`piloted`), or on its way home
   *   `control.grip`   the blade's own grip model, which `_readInput` sets to
   *                    'one' for the one-hand key, a live telekinetic grip on
   *                    a body or an enemy, a stasis field, and a thrown saber
   *   `gesture.kind`   the off arm is mid-cast — a push, a pull, a hurl, an
   *                    unleash, lightning, a rend, sense, heal, the stratagem
   *                    comm, a designator. Thirteen of them, and each takes
   *                    the hand off the hilt for as long as it runs
   *
   * ZERO IS NOT REACHABLE BY THE POSER TODAY and is still what this returns,
   * because it is what is true: `Player.update` hands the whole frame to
   * `Crew` and returns before `_updateBody` ever runs, so a man at the
   * controls keeps whatever pose he climbed in with. That is a defect in the
   * DRIVING pose and not in this answer, and writing 1 here to match the
   * pose would be the hand-maintained table beside its generated twin that
   * HANDOFF §2.3 is about.
   */
  handsOnHilt() {
    if (this.saberDown || this.driving || this.throwState !== 'held') return 0;
    if (this.control.grip !== 'two' || this.gesture.kind) return 1;
    return 2;
  }

  /**
   * THIS BODY, AS SOMETHING A BLADE CAN FIND.
   *
   * A Player had no `capsules()` at all, and that single absence is most of why
   * a player could not cut a player: `World._resolveBlades` builds its target
   * list out of `enemies`, `props` and `doors`, and a target record is
   * `{ id, capsules }`. Measured before this existed — 180 frames of a lit
   * blade swept through another player's chest, 0.0 damage, 0 target records
   * that were a player. There was nothing to hit, not a rule saying not to.
   *
   * `flesh` for every bone, and it is worth saying why rather than reaching for
   * the acolyte's `_boneToughness`: a Jedi wears cloth, not plate, and cloth
   * over flesh is `TOUGHNESS.flesh`. A duel between players should be decided
   * by the blade arriving, not by which robe somebody picked in the creator —
   * making a robe armour would make an appearance setting a combat setting,
   * which is a different feature and a worse one.
   *
   * `_caps` is reused between frames exactly as Enemy's is: this is called once
   * per player per swinging blade per frame and allocating twenty capsule
   * records each time is the kind of garbage that shows up as a stutter.
   */
  capsules() {
    const out = (this._caps ||= []);
    out.length = 0;
    if (!this.alive && !this.actor?.ragdolled) return out;
    return rigCapsules(this.rig, { into: out, owner: this, toughness: TOUGHNESS.flesh });
  }

  /**
   * KNOCKED ABOUT — the call shape `Enemy` has always had, and a Player did not.
   *
   * Every force power in this file ends in `e.applyKnockback(impulse, damage,
   * source)`, and the reason none of them could ever reach another player is
   * partly that `ctx.players` was never read and partly that a Player had no
   * such method to call. Giving it the enemy's signature is what lets the push
   * and the pull loops take one list rather than growing a second body of code
   * per power — the shape this codebase has twice had to un-duplicate.
   *
   * The damage goes through `damage()`, so it passes the friendly-fire gate
   * like everything else; the shove does not, because being pushed is not being
   * hurt and shoving your ally out of a firing line is a co-op move worth
   * keeping. `staggerTimer` rather than an `Enemy.stun`: a player is never
   * taken off the controls, which is a rule the whole game already keeps.
   */
  /**
   * SPEND THE POOL TO BLUNT AN INCOMING POWER — the player's half of the Force
   * contest, and the half that did not exist. Driven before this line: a Sith
   * shoving into your shove landed in full, and 50 hp of lightning delivered
   * the same 42.5 whether your bar was empty or brimming. The bar was a
   * spending account with no defensive side, so "answering a power with a
   * power" could only ever mean casting first.
   *
   * `forceResistance` is CALLED, not copied. It is exported from Enemy.js for
   * this exact caller and it carries the three numbers, the cap, the
   * beaten-guard discount and the list of kinds that are the Force at all — one
   * contest, one rulebook, both contestants reading it. A second copy here
   * would be free to disagree with the body on the other end of the push.
   *
   * `staggerTimer > 0` is the player's `_guardOpen()`: the same "your guard is
   * already beaten, so it defends less" rule the blade uses, expressed in the
   * one state a player has instead of a stun (this game never takes the
   * controls away, so there is no `stunTimer` to read).
   *
   * @returns hp of the blow taken off, having already spent the pool for it.
   */
  resistForce(amount, kind, source) {
    if (!this.alive) return 0;
    // …and never against yourself: a held power bills through the same door,
    // and a caster paying twice for one cast is not a contest.
    if (source === this) return 0;
    const r = forceResistance(this.force, amount, kind, this._guardOpen());
    this.force = Math.max(0, this.force - r.spend);
    return r.blunt;
  }

  /**
   * IS THIS PLAYER'S GUARD ALREADY BEATEN — one predicate, the mirror of
   * `Enemy._guardOpen`, and it exists for the reason that one does: two readers.
   *
   * The blow this player is resisting (`resistForce`, above) and the pull they
   * are resisting in a contested grip (`_updateGrip`) have to agree about
   * whether the guard is open, or "break his guard and the cap collapses to a
   * fifth" would be true of a shove and false of a tug-of-war over the same
   * crate in the same second. It was written inline here and would have been
   * written inline again there.
   *
   * `staggerTimer > 0` and not a stun: a player is never taken off the
   * controls, which is a rule the whole game already keeps, so a stagger is the
   * one open state a player has.
   */
  _guardOpen() { return this.staggerTimer > 0; }

  applyKnockback(impulse, damage = 0, source = null, gentle = false) {
    if (!this.alive) return false;
    /**
     * PUSHING INTO A PUSH IS A CONTEST — and this mirrors `Enemy.applyKnockback`
     * line for line, because it is the same contest seen from the other side.
     *
     * The blow is weighed ONCE, the shove priced alongside the damage in the
     * same currency (`IMPULSE_AS_HP`), and the fraction the pool buys back is
     * applied to both. Billing the two halves separately out of one pool would
     * charge twice for one blow; blunting only the damage would let a resisted
     * shove still take you the whole way. `preResisted` carries the decision
     * down into `damage()` so it does not answer the same blow again.
     */
    let dmg = damage || 0;
    const weight = dmg + (impulse ? impulse.length() * IMPULSE_AS_HP : 0);
    const blunt = this.resistForce(weight, 'force', source);
    if (blunt > 0) {
      const k = Math.max(0, 1 - blunt / weight);
      dmg *= k;
      if (impulse) impulse = _res.copy(impulse).multiplyScalar(k);
    }
    /* AND THE SHOVES DO NOT STACK — the rule, and the twenty-acolyte ring that
     * found it 718 m up, are written down over `addShove` in Enemy.js. It
     * lives there rather than here for the reason `forceResistance` does: this
     * is one contest seen from two sides, and the day the two copies disagree
     * is the day a shove means something different depending on who took it. */
    if (impulse) {
      addShove(this, impulse);
      this.grounded = false;
    }
    if (!gentle) this.staggerTimer = Math.max(this.staggerTimer, 0.22);
    return dmg > 0 ? this.damage(dmg, this.chest, source, 'force', true) : false;
  }

  setSaberColor(i) {
    this.saber.setColor(i);
    this.hum.dispose();
    this.hum = audio.createHum(this.saber.color.getHex());
    if (this.saber.lit) this.hum.ignite();
  }

  /* ── main update ─────────────────────────────────────────────────── */

  update(dt, ctx) {
    const input = ctx.input;
    // A new frame opens a new shove account. See `addShove` in Enemy.js.
    newShoveFrame(this);
    this.comboTimer -= dt;
    if (this.comboTimer <= 0 && this.combo > 0) { this.combo = 0; }
    for (const k in this.cooldowns) this.cooldowns[k] = Math.max(0, this.cooldowns[k] - dt);
    this.invuln = Math.max(0, this.invuln - dt);
    this.riposteTimer = Math.max(0, this.riposteTimer - dt);
    this.staggerTimer = Math.max(0, this.staggerTimer - dt);
    this.hitFlash = damp(this.hitFlash, 0, 5, dt);
    /* THE CHANNEL IS STEPPED HERE and not in `_move`, because it has to run
     * whether or not the body can walk — a commander channelling in a troop
     * bay, or one pinned by a stagger, is still discharging. Death ends it a
     * line below, through the same door a release does. */
    if (this.channel?.kind === 'lightning') this._lightningTick(ctx, dt);

    if (!this.alive) { this.endLightning?.(); this._updateDead(dt, ctx); return; }

    this._readInput(dt, ctx);
    // The aim the input just wrote, available to everything solved this frame
    // rather than only to the camera at the end of it — see syncAim.
    this.camera.syncAim();
    /**
     * AND IF YOU ARE DRIVING SOMETHING, THAT IS THE WHOLE FRAME.
     *
     * Everything below this line is a body on its feet — the walk, the Force,
     * the gait, the blade, the collision — and none of it applies to a man at
     * the controls of a tank. Placed after the input and the aim because the
     * crew READS both: the aim is where the gun goes and the move axis is the
     * throttle. See src/game/Driving.js.
     */
    if (this.driving) {
      if (this.driving.update(dt, ctx)) {
        this.saber.carrierVel = this.velocity;
        this._regen(dt);
        return;
      }
    }
    /* AFTER the aim and not before it: a stratagem aimed at the ground reads
     * `aimDir`, and a call placed on last frame's aim would land where you
     * were looking rather than where you are. */
    this.stratagems?.update(dt, ctx);
    this._move(dt, ctx);
    this._updateForce(dt, ctx);
    // ONE ORDER, AND IT IS A CHAIN OF DEPENDENCIES, NOT A HABIT.
    //
    // The gait moves the pelvis; the eye rides the pelvis; the blade is solved
    // from the eye in first person; the arms are IK'd to the blade and rooted
    // on the eye. Every arrow points forward, so all of it resolves inside one
    // frame. It used to run blade → body → camera, which put two of those
    // arrows backwards: the blade anchor was built from a stale eye and the
    // eye was advanced after everything that depended on it had already been
    // drawn. Measured on the walk, that alone was 97mm of hilt sliding up and
    // down the first-person frame, once per stride.
    this._poseGait(dt, ctx);
    this._updateBlade(dt, ctx);
    this._updateBody(dt, ctx);
    this._updateCamera(dt, ctx);
    this._regen(dt);
  }

  /* ── input ───────────────────────────────────────────────────────── */

  _readInput(dt, ctx) {
    const input = ctx.input;
    if (!this.isLocal) return;
    /**
     * A MAN AT THE CONTROLS OF A TANK HAS BOTH HANDS ON THEM.
     *
     * `update` runs this BEFORE it hands the frame to `Crew`, because the crew
     * reads the aim and the move axis this method writes — so without this line
     * every key below was live inside a hull: you could throw your saber out of
     * a driven AT-TE, raise a Force barrier in a cockpit, or grip a crate while
     * steering. Each of those is a body doing two things with the same hands,
     * and the throw is worse than silly — `_updateThrow` poses the saber at
     * `throwPos` and `Crew.ride` pins the player to the seat, so the blade and
     * the man it belongs to would be in two places.
     *
     * The camera and the aim are ABOVE this and still run: looking around is
     * how you lay the gun. The drive key itself is handled in `Crew`'s own
     * frame — see `takeControls`, which is a toggle — so the way out is never
     * a key this returns before reading.
     */
    if (this.driving) {
      this._wheel = input.mouse.wheel;
      input.mouse.wheel = 0;
      /* The look, through the same door it always goes through — the blade
       * controller owns the mouse and hands back the camera's share of it, and
       * a second reader of `mouse.dx` here would be the two-copies-of-one-rule
       * defect this file keeps deleting. `bladeHeld` false because there is no
       * blade in the hand to hold. */
      const look = this.control.applyInput(input, dt, {
        stamina: this.stamina / this.maxStamina,
        attackRate: this.boonMods.attackRate,
        grounded: true, moving: 0,
      });
      this.camera.addYaw(look.yaw);
      this.camera.addPitch(look.pitch);
      if (input.actHit('drive')) this.takeControls(ctx);
      if (input.actHit('view')) { this.camera.firstPerson = !this.camera.firstPerson; this._applyViewMode(); }
      return;
    }

    // ── the wheel belongs to whatever is actually being held.
    // SaberController spends it on wrist roll (`rollInput += mouse.wheel*0.55`)
    // and it runs first, so before this a single notch both rolled the blade
    // AND moved the gripped object — two answers to one gesture, which is why
    // distance control read to the player as "there isn't any". Claim it while
    // a grip or a stasis field is live and hand it straight back otherwise.
    this._wheel = 0;
    /* `piloted` is in this list for the same reason the grip is: the wheel is
     * how you push a held thing out and pull it in, and a blade you are flying
     * across the arena is a held thing. See `_updateThrow`. */
    if (this.gripBody || this.gripEnemy || this.stasis.active || this.throwState === 'piloted') {
      this._wheel = input.mouse.wheel;
      input.mouse.wheel = 0;
    }

    // blade → camera coupling
    const camDelta = this.control.applyInput(input, dt, {
      stamina: this.stamina / this.maxStamina,
      attackRate: this.boonMods.attackRate,
      onThrust: () => {
        this.stamina = Math.max(0, this.stamina - 6);
        audio.swing(16, this.saber.base);
      },
      /**
       * WHAT A SPIN COSTS, and it used to cost nothing at all.
       *
       * `SPIN`'s own note has always said "it is the reason this costs a third
       * more stamina and recovers half as fast", and the recovery was real —
       * `SPIN.cooldown` is 1.05 s against the overhead's 0.46, read off the
       * table rather than typed here, and it was 0.92 when this paragraph was
       * written — while the stamina half was never wired: `ctx.onSpin` was
       * called by the controller and no caller had ever supplied it. The only
       * price was whatever the whoosh drain happened to take.
       *
       * That was survivable while the spin was a 35° glance that crossed two
       * bodies. It stopped being survivable the moment it became a full
       * revolution that crosses seventeen of eighteen at 17 m/s — measured, one
       * pass now does about eight times an overhead's work, so a free one is
       * the answer to every fight in the game.
       *
       * 18 is the dash's price, deliberately: those are the two moves that get
       * you out of being surrounded, and they should compete rather than one
       * being free. Four in a row empties a full bar, which is the shape of
       * "this is the answer, and you cannot lean on it".
       */
      onSpin: () => {
        this.stamina = Math.max(0, this.stamina - 18);
        this.staminaHold = STAMINA_HOLD;
        audio.swing(26, this.saber.base);
      },
      /**
       * WHAT HOLDING A BLADE CHAMBERED COSTS — and it is the SAME defect the
       * spin's note above records, one attack over and still live.
       *
       * `CHARGE.drain` (0.22) and `HEAVY.drain` (0.20) are authored in
       * SaberController and spent through `ctx.onStrain`, and NO CALLER HAS
       * EVER SUPPLIED ONE — grep `onStrain` across src/ and tools/ and the
       * only hits are the two calls that raise it. Both notes there say the
       * same thing in the same words: "Standing at full charge is not free,
       * which is what stops the heavy from being a state you enter once and
       * swing out of forever." It was free, so it was exactly that state:
       * chamber the third press, walk around behind a full charge, and swing
       * a faster blade whenever you like at no price at all.
       *
       * The amount arrives as a FRACTION OF THE BAR PER SECOND, which is the
       * unit the controller already reads back (`ctx.stamina` is
       * `stamina / maxStamina`), so a full overhead charge costs
       * (0.85 − 0.28) × 0.22 = 12.5 of a 100 bar and a full heavy
       * (0.80 − 0.16) × 0.20 = 12.8. Both a little under a dash's 18, which is
       * the right order: chambering is a commitment, not a movement.
       *
       * `staminaHold` for the reason STAMINA_HOLD's own note gives — a bar
       * does not refill while it is being spent. Without it the regen (16/s
       * and up) simply outpaces a 22/s drain that only runs for half a second
       * and the price is a rounding error. It is deliberately NOT what
       * `guardCost` does: answering a bolt is something done TO you and its
       * whole arithmetic is a drain racing a live regen (see GUARD_COST), and
       * chambering is something you choose.
       */
      onStrain: (fraction) => {
        if (!(fraction > 0)) return;
        this.stamina = Math.max(0, this.stamina - fraction * this.maxStamina);
        this.staminaHold = STAMINA_HOLD;
      },
      /* WHETHER THE FEET ARE UNDER THE LUNGE, from the body's OWN velocity.
       * The controller can otherwise only infer it from how fast the anchor it
       * is handed is travelling, and `_attackDrive` now moves that anchor on
       * purpose — see the note at the read in SaberController. The threshold is
       * imported rather than repeated. */
      moving: Math.hypot(this.velocity.x, this.velocity.z) > THRUST_STANDING_SPEED,
    });
    this.camera.addYaw(camDelta.yaw);
    this.camera.addPitch(camDelta.pitch);

    // ignite / retract
    //
    // THE HOLE NOTE 39 CAME THROUGH. `toggle()` asks the Saber whether its
    // blade is lit; it cannot ask whether anybody is holding it. So after a
    // drop this one key lit a hilt lying six metres away, and the player was
    // armed again — "you still have one like you never actually lose it".
    // Measured: ignition 0.01 → 0.97 in half a second, from an empty hand.
    if (input.actHit('ignite')) {
      // …and NOT `return`: this sits above the view toggle, the grip and all
      // eleven powers, so an early exit here would make an empty hand cost the
      // player the rest of their controls for that frame.
      /* THE SAME KEY, FOR THE BLADE IN YOUR FORCE. Tried first, and it answers
       * only when the grip is actually holding a hilt — so this is not a mode
       * the player has to know about, it is the ignite key doing the obvious
       * thing with the only saber they are touching. */
      if (this.igniteHeldHilt(ctx)) { /* lit or doused at range */ }
      else if (this.saberDown) this._refuse('ignite', 'your hands are empty');
      else {
        this.saber.toggle();
        if (this.saber.lit) { this.hum.ignite(); audio.tone({ freq: 180, freqEnd: 900, dur: 0.4, gain: 0.22, type: 'sawtooth', pos: this.saber.base }); }
        else { this.hum.retract(); audio.tone({ freq: 900, freqEnd: 120, dur: 0.35, gain: 0.2, type: 'sawtooth', pos: this.saber.base }); }
      }
    }
    if (input.actHit('view')) {
      this.camera.firstPerson = !this.camera.firstPerson;
      this._applyViewMode();
    }

    // grip / one-hand.
    //
    // Only a SUSTAINED hold changes the blade's actual grip. GRIPS.two → one
    // moves handExtend 0.29 → 0.36 and guardR 0.60 → 0.72 with no blend of any
    // kind (SaberController.gripBlend is set once and never read), so switching
    // it for a 0.4 s push gesture would jump the hilt target 7 cm out and back
    // twice a second in the middle of a duel. Carrying a crate or holding a
    // stasis field is a decision that lasts, and the looser one-handed blade is
    // the honest price of it; a gesture only borrows the arm, which
    // _updateBody handles on its own.
    const wantOne = input.act('grip2') || this.saberThrown
      || !!this.gripBody || !!this.gripEnemy || this.stasis.active;
    this.control.grip = wantOne ? 'one' : 'two';

    // force powers
    if (input.actHit('push')) this.forcePush(ctx);
    if (input.actHit('pull')) this.forcePull(ctx);
    if (input.actHit('grip')) this.toggleGrip(ctx);
    if (input.actHit('throw')) this.throwOrRecall(ctx);
    if (input.actHit('sense')) this.toggleSense(ctx);
    /* PRESS OPENS IT, RELEASE CLOSES IT — see `forceLightning`. `actHit` is
     * the edge and `act` is the level, and both are needed: a channel that
     * only ever ended on its own clock could not be tapped. */
    if (input.actHit('lightning')) this.forceLightning(ctx);
    else if (this.channel?.kind === 'lightning' && !input.act('lightning')) this.endLightning();
    if (input.actHit('stasis')) this.toggleStasis(ctx);
    if (input.actHit('heal')) this.forceHeal(ctx);
    /* A TOGGLE, not a hold-to-keep. `forceShield` puts it up and puts it down
     * again on the second press — the same shape `stasis` and the mend already
     * use — because a barrier you must keep a finger on is a barrier you cannot
     * fight from, and everything else in this game is done with the same hand. */
    if (input.actHit('shield')) this.forceShield(ctx);
    if (input.actHit('rend')) this.forceDisassemble(ctx);
    if (input.actHit('compel')) this.forceCompel(ctx);
    if (input.actHit('unleash')) this.forceUnleash(ctx);
    if (input.actHit('swap')) this.swapSaber(ctx);
    /* IN, OR OUT — one key, decided by whether you are already at a set of
     * controls, for the same reason `swap` is one key: the state is on screen
     * and the player does not have to keep two of them straight. */
    if (input.actHit('drive')) this.takeControls(ctx);
    // One meaning for `hurl` whichever way the Force is currently full: send
    // what I am holding at what I am looking at. (It said "Mouse2" here until
    // the key moved off Mouse2 — which is why comments name the ACTION.)
    if (input.actHit('hurl')) {
      if (this.gripBody || this.gripEnemy) this.hurlGripped(ctx);
      else if (this.stasis.active) this.releaseStasis(ctx, true);
    }
    if (input.actHit('dash') && this.cooldowns.dash <= 0) this._tryDash(ctx);
    /* THE DIVE. An attack pressed with both feet off the ground is not a stab,
     * it is a slam — and it needs no binding of its own, because "attack, in
     * the air" is already an unambiguous input and a key nobody can find is a
     * feature nobody has. The controller runs its thrust envelope on the same
     * press, which is right: the blade leads the fall. */
    if (input.actHit('thrust')) this._tryDive(ctx);
    this._stratagemInput(input, ctx);
  }

  /**
   * SPELLING A SUPPORT CALL — the input half of src/game/Stratagems.js.
   *
   * It lives here rather than in that file because this is where the game
   * already asks the input layer questions, and Stratagems deliberately knows
   * nothing about `Input` — it is handed a DIRECTION and decides what that
   * means. See the note over `DIRS` for why that split is what lets a pad
   * spell the same codes.
   *
   * `actHit` and not `act`: a letter is a press. A held W while a code is
   * being spelled is one W, not sixty — which the axis read this replaced
   * would have made it.
   *
   * THE MOVEMENT IS NOT SUPPRESSED HERE and that is on purpose: `_move` reads
   * `stratagems.arming` for itself, so exactly one place decides that a player
   * spelling a code is standing still, and it is the place that owns walking.
   */
  /**
   * ARE YOU SPELLING A CODE RIGHT NOW?
   *
   * One reader for a rule that had one writer and three verbs that walked past
   * it. `_move` zeroed the move axis and nothing else did, so the lock the
   * whole mechanic is priced on — "you stop, in the open, for as long as the
   * code takes" — held for the run and not for the dash, the jump or the dive.
   * Measured: arming + run 0.00 m, arming + dash 3.87 m with 0.16 s of
   * invulnerability, arming + jump a 4.32 m apex. The WASD you are spelling
   * with doubles as the dash direction, so the escape was aimed.
   */
  _spelling() { return !!this.stratagems?.arming; }

  /**
   * ── AND EVERY KEYSTROKE IS A WORD, WHICH IS WHY THIS GREW ───────────────
   *
   * Player note #31 asks for the call to be a PERFORMANCE: the comm goes up,
   * the player speaks, and only then do they place the thing. All three beats
   * are here because all three are input, and each one is one line plus its
   * reason:
   *
   *  · THE COMM COMES UP with the key and goes down when the call is away, so
   *    the gesture and the mechanic have exactly one lifetime between them.
   *  · A LETTER SPEAKS ITS WORD. `Stratagems.wordAt` derives which word from
   *    the phrase and the entry (see `callPhrase`), and `audio.radio` says it
   *    — so the mouth and the HUD panel are reading the same derivation and
   *    cannot drift.
   *  · THE ARM GOES OUT when the code is done and the designation opens. That
   *    is the visible difference between "still spelling" and "choosing where",
   *    which is the state the player has to be able to read at a glance while
   *    something is shooting at them.
   *
   * The letters are still `actHit` and not `act`: a letter is a press. A held
   * W while a code is being spelled is one W, not sixty.
   */
  _stratagemInput(input, ctx) {
    const S = this.stratagems;
    if (!S) return;
    const was = S.arming, wasMarking = !!S.designating;
    S.setArming(input.act('stratagem'));
    if (S.arming && !was) this._gesture('comm');
    if (!S.arming) {
      if (was) { this._endGesture('comm'); this._endGesture('designate'); }
      return;
    }
    if (!S.designating) {
      for (const d of DIRS) {
        if (!input.actHit(DIR_ACTION[d])) continue;
        const word = S.wordAt(ctx, S.entry.length);
        const out = S.feed(d, ctx);
        /* SPOKEN ONLY FOR A LETTER THAT LANDED, and `false` is the one return
         * that means it did not: a direction that leads nowhere, or a code
         * completed onto a cooldown or an empty Force pool. Both get the
         * refusal sound instead — a word of a call that is not being made is
         * the player's own mouth lying to them. `null` (still spelling) and
         * the row (finished) are both letters that landed. */
        if (out !== false) this._sayCall(word);
      }
    }
    /* The arm swaps from the comm to the designator on the frame the phase
     * changes, in both directions — a designation that expires and sends
     * itself has to put the arm back too. */
    if (!!S.designating !== wasMarking) {
      if (S.designating) { this._endGesture('comm'); this._gesture('designate', S.designating.site); }
      else { this._endGesture('designate'); if (S.arming) this._gesture('comm'); }
    }
  }

  /**
   * SAY ONE WORD OF THE CALL.
   *
   * Straight at `audio.radio` and deliberately NOT through the Announcer: the
   * announcer owns the QUIP budget, which exists so that a squad wiped in one
   * second does not produce five simultaneous lines, and a phrase is the one
   * case where eight utterances in two seconds is the intended sound. See the
   * note over `AudioEngine.radio` for the whole of that argument.
   *
   * The larynx is the player's own, read off the same setting the announcer
   * reads, so the voice that spells a code is the voice that shouts on a kill.
   */
  _sayCall(word) {
    if (!word) return;
    const spec = voiceAt(this.world?.settings?.voiceIndex ?? 0);
    audio.radio(spec, word, { pos: this.chest ?? this.position });
  }

  /**
   * THE AERIAL DIVE — player note #15's "aerial dive attack".
   *
   * IT IS A VELOCITY AND NOTHING ELSE, and that is the whole design. The
   * landing shockwave, the crater, the stagger, the sand, the thud and the
   * fall damage are all already written and all already keyed off the speed a
   * body arrives at (`_land`, `impactSpeed > 15`). A dive that dealt its own
   * damage in its own radius would be a second copy of that rule which could
   * disagree with the first — so this drives the number the existing rule
   * reads, and everything downstream happens because the player genuinely came
   * down that fast.
   *
   * DIVE_SPEED is set from that threshold rather than picked: the landing
   * shockwave needs 15 m/s and gravity gives that after 1.15 s of fall, which
   * is longer than most jumps are in the air. 30 m/s clears it instantly and
   * lands at `power` 1.6, the cap, so a dive is always the biggest landing in
   * the game.
   *
   * THE FLOOR CLEARANCE is what stops it being a free stomp: a body 1.2 m off
   * the ground has nothing to gain and would only cancel its own jump, and a
   * dive off a kerb should not shake the field. `coyote` is not consulted —
   * that is for jumping, and this is the opposite question.
   *
   * The horizontal velocity is kept at a third rather than zeroed. A dive
   * that stopped you dead in the air reads as hitting a wall; keeping some of
   * the run carries the arc forward and lets a dive be aimed at something.
   */
  _tryDive(ctx) {
    if (this._spelling()) return this._refuse('dive', 'you are calling for support');
    if (this.grounded || this.diving || this.dashTimer > 0) return false;
    if (this.velocity.y > 2) return false;              // still going up: that is a jump
    const ground = ctx.terrain ? ctx.terrain.height(this.position.x, this.position.z) : 0;
    if (this.position.y - ground < DIVE_CLEAR) return false;
    if (this.stamina < DIVE_STAMINA) return this._refuse('dive', 'no stamina left to drive it');
    this.stamina -= DIVE_STAMINA;
    this.staminaHold = STAMINA_HOLD;
    this.diving = true;
    this.velocity.y = -DIVE_SPEED;
    this.velocity.x *= 0.34; this.velocity.z *= 0.34;
    this.cloak?.impulse(_v5.set(0, 1, 0), 2.4); this.skirt?.impulse(_v5.set(0, 1, 0), 2.4);
    audio.swing(18, this.chest);
    return true;
  }

  _applyViewMode() {
    const fp = this.camera.firstPerson;
    // The blade's emission profile is tuned in third person, where the weapon
    // is 3.5 m from the lens; in first it is 0.7 m, which is five times the
    // angular size against a bloom pass that works in screen space. See
    // Saber.FP_PINCH. This is the one place the view changes, so it is the one
    // place that tells the blade.
    if (this.saber) this.saber.firstPerson = fp;

    // Hide the MESHES, not the bones — scaling a bone enters matrixWorld, so a
    // 0.0001x head was silently seen by the sever code, the cloak colliders,
    // the ragdoll body sizes and every worldPos() call.
    //
    // And hide EVERY mesh under the bone, not bone.parts. `parts` holds only
    // the limb tube the rig built: the head bone carries fifteen meshes (jaw,
    // ears, nose, eyes, brows, mouth, hair, hood) and `parts` lists one. Hiding
    // just that left the whole face wrapped around the first-person camera,
    // which is why first person looked like being inside your own skull.
    // Traversing the NECK covers the head too, since head parents to it — and
    // stops short of the chest, so the arms stay visible holding the blade.
    const neck = this.rig.get('neck');
    if (neck) {
      neck.obj.scale.setScalar(1);
      const head = this.rig.get('head');
      if (head) head.obj.scale.setScalar(1);
      neck.obj.traverse((o) => { if (o.isMesh) o.visible = !fp; });
    }

    // The clavicles are the join between a torso that is still standing where
    // the body is and a pair of shoulders that have moved onto the camera, so
    // in first person they are a 13cm tube stretched between two places the
    // player is not meant to think about. Hide the tube; the bone still does
    // its job, which is to carry the arm.
    //
    // Restoring is not optional and not free: _anchorViewArms OVERWRITES the
    // clavicle's local position and rotation every frame it runs, so leaving
    // first person without putting the rest pose back leaves the third-person
    // figure with its shoulders frozen wherever the camera last was.
    for (const [name] of VM_CLAV) {
      const b = this.rig.get(name);
      if (!b) continue;
      b.obj.traverse((o) => { if (o.isMesh && o.parent === b.obj) o.visible = !fp; });
      if (!fp) { b.obj.position.copy(b.offset); b.obj.quaternion.copy(b.restQuat); }
    }

    // AND THE RIBCAGE, BECAUSE YOU ARE INSIDE IT.
    //
    // The chest lathe ends in a domed cap 16 cm across — the shoulder line,
    // which is the first thing a human silhouette is read by and is worth every
    // triangle in third person. In first person its top sits 16 cm below a lens
    // with a 4.5 cm near plane, so it is both inside the frustum and across the
    // camera plane. tools/fpview.mjs at 70 degrees down: a smooth brown dome
    // filling the bottom 60% of the frame, radial lathe seams and all, with the
    // player's own legs and boots behind it. Looking down at yourself showed you
    // the inside of your own chest.
    //
    // The spine and hips keep their robe, so looking down still finds a body
    // and a pair of legs where they belong — just not from inside the ribs.
    const chestBone = this.rig.get('chest');
    if (chestBone) {
      chestBone.obj.traverse((o) => { if (o.isMesh && o.parent === chestBone.obj) o.visible = !fp; });
    }

    this.camera.targetDistance = fp ? 0 : 3.05;
    // Say WHICH resting pose, never what it is. These two lines used to carry
    // their own copies of readyX/readyY, and the third-person one still said
    // 0.30 — the exact value commit 2e23892 had lowered to 0.08 to stop the
    // blade cursor resting 22 deg above screen centre. The fix landed in
    // SaberController and was undone from here every time the view mode was
    // applied, which includes every respawn. READY_GUARD owns the numbers now.
    this.control.setViewMode(fp);
  }

  /* ── locomotion ──────────────────────────────────────────────────── */

  _move(dt, ctx) {
    /**
     * YOU ARE A PASSENGER — src/game/Extraction.js.
     *
     * `riding` is set while the commander is stood in a transport's troop bay,
     * and it is the whole of what being aboard means to this class: the seat is
     * written by `ExtractionDirector._flyPassengers` at the TOP of the frame,
     * before any player is stepped, so by the time this runs the body is
     * already exactly where the aircraft says it is and every line below would
     * only fight it — gravity would pull it through the floor, the wish vector
     * would walk it out of the open door, and the terrain clamp would drop it
     * 90 m onto the ground going past.
     *
     * NOTHING ELSE IS SUPPRESSED, and that is the feature rather than an
     * oversight. `_readInput` has already run, so the camera is yours, the
     * blade is yours and you can stand at the door and look at the battlefield
     * — which is the reference plate the player pointed at. What you cannot do
     * is walk, and a bay at 90 m is the one place in the game where that is not
     * a thing being taken away from you.
     */
    if (this.riding) {
      this._sprinting = false;
      this.crouch = damp(this.crouch, 0, 12, dt);
      this.velocity.set(0, 0, 0);
      this.grounded = true;
      this.coyote = 0.14;
      this.airJumps = this.boonMods.doubleJump ? 2 : 1;
      /* The capsule goes where the body went. This is the last line of the
       * ordinary path too, and leaving it out would draw the commander in a
       * troop bay while everything that collides with them stayed on the
       * ground they lifted off — the same defect with a longer symptom that
       * `Arrivals.relocate` records. */
      this.body?.setTransform?.(_v1.set(this.position.x, this.position.y + 0.9, this.position.z), null);
      return;
    }
    const input = ctx.input;
    const terrain = ctx.terrain;
    const axis = this.isLocal ? input.moveAxis(_axis) : (this.netAxis || _axis0);
    /* SPELLING IS NOT WALKING. While the stratagem key is held, WASD is four
     * letters and not a direction, and this is the ONE place that says so —
     * `_stratagemInput` deliberately does not suppress movement itself, so
     * "a player entering a code is standing still" is decided by the code
     * that owns walking rather than in two places that could disagree.
     *
     * It is also the cost the whole mechanic is built on: you stop, in the
     * open, for as long as the code takes. See Stratagems.js. */
    if (this._spelling()) { axis.x = 0; axis.y = 0; }

    /* THE START IS DEARER THAN THE CONTINUATION — see SPRINT_START. */
    const sprintGate = this._sprinting ? SPRINT_FLOOR : SPRINT_START;
    const sprinting = this.isLocal && input.act('sprint') && axis.y > 0.2 && this.stamina > sprintGate;
    this._sprinting = sprinting;
    const crouching = this.isLocal && input.act('crouch');
    this.crouch = damp(this.crouch, crouching ? 1 : 0, 12, dt);

    const base = 4.6 * this.boonMods.moveSpeed;
    /* THE SLOW WALK, note 22's "slow walk / aura farm". A held key, not a
     * toggle, and a factor on the base rather than a fifth branch: the four
     * paces are then walk 1.56 / crouch 2.21 / ordinary 4.60 / sprint 7.45 m/s
     * — each about half again the one below, and the walk sits safely above
     * Rig.js's `0.35 * legRef` gait floor so the legs still cycle rather than
     * skating. Sprint OVERRIDES rather than multiplying: holding both is a
     * contradiction and the faster answer is the one a player meant. */
    let speed = base * (this.isLocal ? walkScale(input) : 1) * (sprinting ? 1.62 : 1) * lerp(1, 0.48, this.crouch);
    if (this.staggerTimer > 0) speed *= 0.35;
    if (this.senseActive) speed *= 1.18;

    /**
     * ── STEERING THE SPIN, and the reason it needs a frame of its own.
     *
     * The player: "the spin attack needs to be like a whole body spin /
     * directional force spin thing — you should be able to direct it as well
     * for the short time you're spinning."
     *
     * The spin turns the view through a full revolution in a third of a second.
     * Every other line in this function builds the walk direction out of the
     * LIVE `camera.yaw`, so during a spin "forward" would rotate 360° under the
     * player's thumb and W would trace a circle. That is not a steerable move,
     * it is a scrambled one — which is why a steerable spin needs a LATCHED
     * frame and not merely a bigger number.
     *
     * `_spinFrame` is the heading at the press. While the turn runs, the stick
     * is read against it, so W is the way you were facing when you hit the
     * button and A stays A for the whole revolution — and because it is read
     * EVERY frame rather than sampled once, changing your mind mid-spin
     * changes where you end up. That is the whole of the ask.
     *
     * No stick, no travel: the spin pivots where you stand. Both answers are
     * live and the player picks between them with the hand that is already on
     * the keys.
     */
    const spinning = this.control?.spinning === true;
    if (spinning && !this._wasSpinning) this._spinFrame = this.camera.yaw;
    this._wasSpinning = spinning;
    const heading = spinning ? this._spinFrame : this.camera.yaw;
    const fwd = _v1.set(Math.sin(heading), 0, Math.cos(heading)).negate();
    const right = _v2.set(fwd.z, 0, -fwd.x).negate();
    const wish = _v3.set(0, 0, 0).addScaledVector(fwd, axis.y).addScaledVector(right, axis.x);
    if (wish.lengthSq() > 1) wish.normalize();
    /* A spin CARRIES you. `SPIN.drive` overrides the walk outright rather than
     * multiplying it, so the pace is the same whether you were strolling or
     * sprinting into it — a directional force, which is the words that were
     * used — and `limitBackpedal` below is skipped for the same reason the
     * dash skips it: you are not walking. */
    if (spinning) speed = SPIN.drive;
    /**
     * NOBODY BACKPEDALS AS FAST AS THEY RUN — INCLUDING THE PLAYER.
     *
     * `limitBackpedal` is Enemy.js's, it is exported for the reason its own
     * note gives ("a numeric law, and numeric laws in this codebase get
     * measured, not eyeballed"), tools/checks/movement.mjs asserts it, and
     * every body in the game has obeyed it for as long as it has existed. The
     * player never did. So the one fighter on the field who could give ground
     * at a dead run, in the direction they are looking, for nothing, was the
     * one holding the camera — and holding one movement key was the strongest
     * answer in a duel because of it (see the FOOTWORK note in Duel.js).
     *
     * `fwd` is the body's own forward: `facing` is driven to `camera.yaw + PI`
     * and a body facing `f` looks along `(sin f, 0, cos f)`, which is this
     * vector exactly. So the law applied here is the one the enemies obey — the
     * component pointing BEHIND you is slowed and everything across that line
     * is untouched. A sidestep keeps its full pace, an advance is not touched
     * at all, and a diagonal retreat loses only the part of it that is retreat.
     *
     * NOT the bodies' 0.5. A player who has committed to a direction cannot
     * re-plant as freely as one who has not, but they are also the only fighter
     * on the field with a camera to turn: 0.72 leaves a straight walk backwards
     * at 3.31 m/s against a 4.60 m/s advance, which is a real retreat and no
     * longer a free one. The DASH is untouched — `targetV` is overwritten
     * wholesale below — because a dodge is the answer this is meant to leave
     * standing, and it is the one that costs 18 stamina.
     */
    if (!spinning) limitBackpedal(wish, fwd, PLAYER_BACKPEDAL);

    // acceleration: crisp on the ground, floaty in the air
    const accel = spinning ? SPIN.steer * 11 : (this.grounded ? 46 : 12);
    const targetV = _v4.copy(wish).multiplyScalar(speed);
    if (this.dashTimer > 0) {
      this.dashTimer -= dt;
      targetV.copy(this.dashDir).multiplyScalar(15.5);
    }
    this.velocity.x = damp(this.velocity.x, targetV.x, accel * 0.42, dt);
    this.velocity.z = damp(this.velocity.z, targetV.z, accel * 0.42, dt);

    // ── jump
    // Everyone gets the second jump — it is a Force jump, not an upgrade. The
    // boon grants a third.
    if (this.grounded) { this.coyote = 0.14; this.airJumps = this.boonMods.doubleJump ? 2 : 1; }
    else this.coyote = Math.max(0, this.coyote - dt);

    if (this.isLocal) {
      if (input.actHit('jump')) {
        /* A LEAP IS AN ESCAPE, AND THE LOCK IS THE PRICE OF THE CODE.
         * `_move` zeroes the move axis while a stratagem is being spelled and
         * its note calls that the cost the whole mechanic is built on — "you
         * stop, in the open, for as long as the code takes". The jump was not
         * in the lock at all: measured, arming + jump was a 4.70 m apex while
         * arming + run was 0.00 m of travel. */
        if (this._spelling()) this._refuse('jump', 'you are calling for support');
        else if (this.coyote > 0) {
          this.velocity.y = 7.4 * this.boonMods.jumpPower;
          this.grounded = false; this.coyote = 0;
          /* Note 22's longer force jump. Net upward acceleration while the
           * Force is being fed in is 20 - 24 = -4 m/s², so a longer window is
           * a higher leap and a larger bill: the ground leap goes 3.44 m ->
           * 4.32 m and costs 21 Force instead of 14, which is the trade the
           * comment below already describes rather than a new one. */
          this.jumpHeld = 0.62;
          audio.force(this.position, 'jump');
          if (ctx.particles) ctx.particles.sandPuff(this.position.clone(), 0.8, this.position.y, ctx.groundColor);
        } else if (this.airJumps > 0 && this._canSpend(12)) {
          this.airJumps--;
          this._spend(12);
          this.velocity.y = 6.9 * this.boonMods.jumpPower;
          this.jumpHeld = 0.50;   // the air leap, in the same proportion
          audio.force(this.position, 'jump');
          if (ctx.particles) {
            _v5.copy(this.position).setY(this.position.y + 0.4);
            ctx.particles.plasma.spawn(_v5, _v6.set(0, 0, 0), { life: 0.35, size: 1.6, drag: 1, gravity: 0, color: this._lightningColor(), alpha: 0.7 });
          }
        }
      }
      // holding jump feeds the Force into the leap — a real, controllable arc
      //
      // AND THE LIFT ONLY ARRIVES IF THE FORCE IS ACTUALLY BOUGHT. This was
      // `this._spend(34 * dt); this.velocity.y += 20 * dt;` with the spend's
      // answer dropped on the floor — and `_spend` deducts NOTHING when it
      // refuses, so below the tick price the impulse was simply free. Measured:
      // 0.4 Force bought the identical 4.32 m apex that 125 Force bought, and
      // the 7.5/s regen outran the bill, so the full force-jump was permanent
      // at an empty bar. `force > 0` was the only gate and it is not one: the
      // price is `34 * dt * forceDrain * forceCost`, which is what `_spend`
      // evaluates and why the test has to BE the spend rather than sit beside
      // it. Refusing also ends the window, so the arc stops where the Force
      // ran out instead of coasting on a silent refusal for the rest of it.
      if (input.act('jump') && this.jumpHeld > 0 && this.velocity.y > 0) {
        if (!this._spend(34 * dt)) {
          this.jumpHeld = 0;
        } else {
          this.velocity.y += 20 * dt;
          this.jumpHeld -= dt;
          if (ctx.particles && rng() < 0.5) {
            _v5.copy(this.position).setY(this.position.y + 0.1);
            ctx.particles.dust.spawn(_v5, _v6.set((rng() - .5) * 2, -1, (rng() - .5) * 2),
              { life: 0.6, size: 0.3, drag: 2, gravity: -1, color: 0xd8c8a8, alpha: 0.16, floor: this.position.y });
          }
        }
      } else this.jumpHeld = 0;
    }

    // ── gravity + integrate
    if (!this.grounded) this.velocity.y -= 24 * dt;
    this.fallSpeed = Math.min(this.fallSpeed, this.velocity.y);
    /* WHERE THE FEET STARTED THIS FRAME — read by _collide, which is a SWEEP
     * over the step and not a sample at the end of it. See _collide's own note
     * for the dive that went through a hangar roof AND the deck under it. */
    this._sweepFromY = this.position.y;
    this.position.addScaledVector(this.velocity, dt);

    // ── collide
    this._collide(dt, ctx);

    /**
     * ── FACING. Toward the blade in combat, toward movement otherwise — AND
     * THE BODY OWNS ITS OWN TURN DURING A DRILL.
     *
     * `bodyYaw` is `SaberController`'s: how far the trunk turns this frame,
     * against `spinYaw`'s much smaller share of it that reaches the camera. The
     * two are separate because of the player's verdict on the old spin — "the
     * spin attack just moves your camera and is mostly ineffective in battle" —
     * and the split is the fix: spending the whole revolution on `camera.yaw`
     * is what made a quarter of a second of play a look at the sky.
     *
     * Applied as an ADD rather than through the easing solve below, because the
     * easing is a spring toward the camera and the camera is deliberately NOT
     * where the body is going during the move. It is also why the solve is
     * skipped entirely while it runs: a spring pulling the trunk back to the
     * view every frame would eat the spin.
     */
    if (this.control?.bodyYaw) {
      this.facing += this.control.bodyYaw;
      while (this.facing > Math.PI) this.facing -= TAU;
      while (this.facing < -Math.PI) this.facing += TAU;
    } else {
      const wantFace = this.camera.yaw + Math.PI;
      let target = wantFace;
      if (!this.saber.lit && this.velocity.lengthSq() > 1.5) {
        target = Math.atan2(this.velocity.x, this.velocity.z);
      }
      let d = target - this.facing;
      while (d > Math.PI) d -= TAU;
      while (d < -Math.PI) d += TAU;
      this.facing += d * Math.min(1, dt * 13);
    }

    // stamina from sprinting — and the bar does not refill while it is going
    // out. See STAMINA_HOLD: without this the regen ceiling of 26/s paid the
    // 11/s drain twice over and a 30 s sprint from empty ENDED FULL.
    if (sprinting) {
      this.stamina = Math.max(0, this.stamina - SPRINT_DRAIN * dt);
      this.staminaHold = STAMINA_HOLD;
    }
  }

  /**
   * WHAT AM I STANDING ON? — the whole answer, in one place.
   *
   * Before this there were two answers and the wrong one won. A block in
   * `_collide` set `grounded = true` when the player landed on a box, and then
   * fifty lines further down an unguarded `else if` re-decided it from the
   * TERRAIN HEIGHTFIELD ALONE — which on top of a boulder is metres below you,
   * so `grounded` went false again on the very same frame, every frame. That
   * one line produced every symptom the player reported:
   *
   *   the repeated hop     gravity re-applies each frame, you sink into the
   *                        rock, the snap teleports you back out, ~5 Hz
   *   phasing into it      the collider was ONE SPHERE AT MID-BODY, 0.89 m
   *                        above the feet with a 0.36 m radius, so the top-snap
   *                        could not fire until the feet were 0.53 m inside
   *   sliding off          depenetration was horizontal-only (`_v5.y = 0`), so
   *                        near an edge the nearest face is a side and you get
   *                        shoved off it
   *   legs through the rock  the gait's `groundAt` sampled terrain only, so both
   *                        ankles were driven to y=0 under a pelvis at y=2
   *   footstep spam        `grounded` flickering makes Rig.js re-plant every
   *                        frame, and re-planting fires onFootstep
   *
   * It also meant air control (12 instead of 46) the whole time you stood on
   * anything, no coyote time so your jump silently became a Force-costing air
   * jump, no landing thud, and a stale `fallSpeed` that fired a bogus violent
   * landing the moment you stepped back onto sand.
   *
   * So: one query, every surface, highest wins. Terrain, static boxes and
   * dynamic props all answer the same question and the caller cannot tell them
   * apart — which is the point, because the player cannot either.
   *
   * `feetY` is where the feet are; a surface above `feetY + STEP_UP` is a wall,
   * not a floor, and is ignored so that jumping up past a ledge does not snap
   * you onto it.
   */
  _supportAt(ctx, x, z, feetY) {
    const floor = supportHeight(ctx.terrain, this._nearBoxes, this._nearProps,
      x, z, feetY, this.radius, STEP_UP);
    // …and the things you can stand on but not shove, raised above it.
    return topOfProps(this._nearDecks, x, z, feetY, this.radius, STEP_UP, floor);
  }

  /**
   * How far above the feet the top of the head is, right now.
   *
   * `height` is the standing figure; the crouch takes off exactly what it
   * takes off the eye line — EYE_H -> EYE_H_CROUCH, the same 0.40 m the chest
   * and the camera already move by — rather than a second number for how low a
   * crouch is. Scaled by the same stature the chest and eye heights are, so a
   * 0.66 m player ducks under things a 1.78 m one does not.
   */
  _crownHeight() {
    const st = this.limbs?.stand ?? this.stature ?? 1;
    return this.height * st - (EYE_H - lerp(EYE_H, EYE_H_CROUCH, this.crouch)) * st;
  }

  /** The short list of colliders near enough to matter, rebuilt once a frame. */
  _gatherNear(ctx) {
    const near = this._nearBoxes; near.length = 0;
    const props = this._nearProps; props.length = 0;
    const physics = ctx.physics;
    if (!physics) return;
    // Generous enough to cover both feet at full stride and the capsule's own
    // radius, small enough that the per-foot ground query below is a short scan
    // rather than a walk of every collider in the level.
    const R = 2.6;
    for (const box of physics.staticBoxes) {
      if (box.disabled) continue;
      const dx = box.center.x - this.position.x, dz = box.center.z - this.position.z;
      if (dx * dx + dz * dz < (box.radius + R) ** 2) near.push(box);
    }
    for (const b of physics.bodies) {
      if (b.invMass === 0 || b === this.body || !b.extent) continue;
      if (b.layer !== LAYER.PROP && b.layer !== LAYER.DEBRIS && b.layer !== LAYER.RAGDOLL) continue;
      const dx = b.position.x - this.position.x, dz = b.position.z - this.position.z;
      if (dx * dx + dz * dz < (b.boundingRadius + R) ** 2) props.push(b);
    }
    /**
     * AND THE THINGS BIG ENOUGH TO LAND ON.
     *
     * The loop above takes PROP, DEBRIS and RAGDOLL and skips everything else,
     * which meant LAYER.ENEMY never reached the support query and the player
     * fell straight through a four-metre spider walker. Reported exactly like
     * that. `Enemy.platform()` answers with the same `{position, extent}` shape
     * a crate does — see the note above it for why only `big` bodies have one —
     * so the query cannot tell a chassis from a rooftop, and neither can the
     * player, which is the point of Support.js.
     *
     * The reach is wider than R because these are wide: a walker's deck is
     * 2.4 m across and standing on its edge has to find it.
     */
    const decks = this._nearDecks; decks.length = 0;
    if (ctx.enemies) {
      const RR = R + 3;
      for (const e of ctx.enemies) {
        const dx = e.position.x - this.position.x, dz = e.position.z - this.position.z;
        if (dx * dx + dz * dz > RR * RR) continue;
        const plat = e.platform?.();
        if (plat) decks.push(plat);
      }
    }
  }

  _collide(dt, ctx) {
    const terrain = ctx.terrain;
    const physics = ctx.physics;
    const wasGrounded = this.grounded;
    this._gatherNear(ctx);

    // static boxes and props: push out horizontally
    if (physics) {
      for (let iter = 0; iter < 2; iter++) {
        for (const box of this._nearBoxes) {
          if (box.disabled) continue;
          /**
           * A LEDGE YOU CAN CLIMB IS NOT A WALL, and this is the line that
           * decides it. See `Support.js`'s `climb` note and `Trees.CLIMB_LOG`.
           *
           * Without it the two halves of the movement solver work against each
           * other and the log wins: the push-out resolves against the CHEST,
           * which for a metre-high log lying on the ground is a side face and
           * therefore a horizontal normal, so the body is held 0.42 m off the
           * timber — while `supportHeight` reaches only the standing radius,
           * 0.40 m, and so never sees the top it is supposed to lift you onto.
           * Two centimetres, and the player is stopped dead by a log they are
           * meant to walk over. Measured: 1.65 m of approach and then nothing,
           * for eight seconds.
           *
           * Skipping it hands the surface to the support query, which is where
           * every other floor in the game is resolved.
           */
          const climb = box.userData?.climb;
          if (climb > 0 && box.center.y + box.halfExtents.y <= this.position.y + climb) continue;
          _v1.set(this.position.x, this.position.y + this.height * 0.5, this.position.z);
          if (_v1.distanceToSquared(box.center) > (box.radius + 1.4) ** 2) continue;
          _v2.subVectors(_v1, box.center).applyQuaternion(box.invQuat);
          const h = box.halfExtents;
          const cx = clamp(_v2.x, -h.x, h.x), cy = clamp(_v2.y, -h.y, h.y), cz = clamp(_v2.z, -h.z, h.z);
          _v3.set(cx, cy, cz);
          _v4.subVectors(_v2, _v3);
          let d2 = _v4.lengthSq();
          const r = this.radius + 0.02;
          if (d2 > r * r) continue;
          if (d2 < 1e-8) {
            const dx = h.x - Math.abs(_v2.x), dy = h.y - Math.abs(_v2.y), dz = h.z - Math.abs(_v2.z);
            if (dx <= dy && dx <= dz) _v4.set(Math.sign(_v2.x) || 1, 0, 0);
            else if (dy <= dz) _v4.set(0, Math.sign(_v2.y) || 1, 0);
            else _v4.set(0, 0, Math.sign(_v2.z) || 1);
            d2 = 1e-4;
          }
          const d = Math.sqrt(d2);
          _v4.multiplyScalar(1 / d);
          const push = r - d;
          _v5.copy(_v4).applyQuaternion(box.quat);
          // An upward face is FLOOR, and floors are resolved by the support
          // query below, which knows about every surface at once. Resolving it
          // here as well is what used to fight it: this loop would shove the
          // body up while the terrain branch pulled it back down.
          if (_v5.y > 0.5) continue;
          _v5.y = 0;
          if (_v5.lengthSq() < 1e-6) continue;
          _v5.normalize();
          this.position.addScaledVector(_v5, push);
          const vn = this.velocity.dot(_v5);
          if (vn < 0) this.velocity.addScaledVector(_v5, -vn);
        }
      }
      /**
       * SHOVE DYNAMIC PROPS OUT OF THE WAY — AGAINST THE PROP'S OWN BOX, and
       * for a long time against a SPHERE THE SIZE OF ITS DIAGONAL instead.
       *
       * The loop's premise is right and is stated above it: a crate you are
       * standing on and a crate you are walking into are one object seen
       * twice. The support query resolves it as a box (`topOfProps` reads
       * `extent`); this half resolved it as a sphere of radius
       * `boundingRadius`, which `RapierWorld` documents as the HALF-DIAGONAL of
       * that same box — and its note there says exactly why that is not a
       * shape: "guessing it back out of the diagonal either floats you or
       * sinks you". So the two halves disagreed about what the object IS.
       *
       * On a crate the difference is centimetres. On a FELLED TRUNK it is the
       * whole of BACKLOG 8.1. A realised log is a 12-to-24 m prop, so its
       * half-diagonal is metres, and the sphere test made every log project a
       * repulsion bubble round its own middle: measured on the pinned deck,
       * three logs in the shove list at once with boundingRadius 5.83, 3.95 and
       * 5.36 m against a body standing ON one of them. The shove is
       * `(rr − d) · massRatio` per frame with nothing bounding it, so the body
       * settles where the shove balances the walk — 0.0552 m of walk against
       * 0.0551 m of shove, measured on the stalling frame — and stops dead six
       * metres from a log's centre with nothing there. That is the player's
       * "invisible walls… I think maybe only when you cut trees down", and it
       * is why a body that climbs onto a trunk then stalls on top of it: being
       * on the log is being deep inside its own bubble.
       *
       * Against the box the same body is pushed out of the WOOD and nothing
       * else, and standing on top now falls out for free rather than needing a
       * rule: the nearest point on the box is directly below the chest, the
       * offset is straight up, and `_v4.y = 0` leaves nothing to push with —
       * which is the same reasoning the static-box loop above spells as
       * `if (_v5.y > 0.5) continue`.
       *
       * `_q1` is free through the whole of `_collide`; the static boxes carry a
       * precomputed `invQuat` and a dynamic body does not.
       */
      for (const b of this._nearProps) {
        _v1.set(this.position.x, this.position.y + 0.9, this.position.z);
        const e = b.extent;
        _q1.copy(b.quaternion).invert();
        _v2.subVectors(_v1, b.position).applyQuaternion(_q1);
        _v3.set(clamp(_v2.x, -e.x, e.x), clamp(_v2.y, -e.y, e.y), clamp(_v2.z, -e.z, e.z));
        _v4.subVectors(_v2, _v3);
        let d2 = _v4.lengthSq();
        const rr = this.radius;
        if (d2 > rr * rr) continue;
        if (d2 < 1e-8) {
          // the chest is INSIDE the prop: leave by the nearest face, exactly as
          // the static-box loop does when it lands in the same place
          const dx = e.x - Math.abs(_v2.x), dy = e.y - Math.abs(_v2.y), dz = e.z - Math.abs(_v2.z);
          if (dx <= dy && dx <= dz) _v4.set(Math.sign(_v2.x) || 1, 0, 0);
          else if (dy <= dz) _v4.set(0, Math.sign(_v2.y) || 1, 0);
          else _v4.set(0, 0, Math.sign(_v2.z) || 1);
          d2 = 1e-4;
        }
        const d = Math.sqrt(d2);
        /* Outward, in the world: from the prop's surface toward the chest.
         * `normalize()` and not `multiplyScalar(1 / d)` — on the branch above,
         * `_v4` is ALREADY a unit face normal while `d` has been forced to
         * 0.01, so dividing would hand the impulse below a vector a hundred
         * times too long and fire a body across the level. The two spellings
         * agree everywhere else. */
        _v4.normalize().applyQuaternion(b.quaternion);
        b.wake();
        b.applyImpulse(_v5.copy(_v4).multiplyScalar(-Math.min(b.mass, 40) * (rr - d) * 2.4), _v1);
        _v4.y = 0;
        if (_v4.lengthSq() > 1e-6) {
          _v4.normalize();
          const massRatio = clamp(b.mass / 220, 0, 0.55);
          this.position.addScaledVector(_v4, (rr - d) * massRatio);
        }
      }
    }

    // ── the ground, whatever it happens to be made of
    /**
     * A face steeper than the walk limit is a WALL, and it is resolved here,
     * before the support query below can raise the body onto it. The slide at
     * the bottom of this method is 12.5 m/s² at its strongest against a walk
     * that pulls 89, so it was never a boundary: holding W walked the player up
     * the 74° shell of every interior in the game and out over its roof
     * (measured: intake y = 46 m at r = 107 m, deeps y = 44.8, alpine y = 55.7).
     * The rule, the probe that keeps ordinary lips and channel banks walkable,
     * and the numbers are all in Terrain.blockClimb.
     */
    terrain?.blockClimb?.(this.position, this.velocity);
    /**
     * THE QUERY COVERS THE WHOLE STEP, not the end of it.
     *
     * `supportHeight` only answers with a surface within STEP_UP (0.45) below
     * the feet, and the grounding window is GROUND_SNAP (0.12) above it — so a
     * frame that steps further than 0.57 m passes clean between the two and
     * the surface is never seen at all. That is 34.2 m/s at 1/60, and
     * DIVE_SPEED is 30 with gravity still adding: measured on a stub hangar,
     * the same column, a dive from 25 m rests on the roof at y=22.80 and a
     * dive from 60 m went through the roof AND the deck to y=0.00.
     *
     * Asking with the feet where they were at the TOP of the step closes it:
     * every surface crossed during the step is within STEP_UP of where the
     * feet were when the frame began, so it answers, and the clamp below puts
     * the body on it. Rising, `_sweepFromY` is BELOW the current position and
     * the max is the current position — which is the old behaviour exactly,
     * so a jump past a ledge still cannot be snatched onto it.
     */
    const gh = terrain ? terrain.height(this.position.x, this.position.z) : 0;
    const sweepFrom = Math.max(this.position.y, this._sweepFromY ?? this.position.y);
    let support = this._supportAt(ctx, this.position.x, this.position.z, sweepFrom);
    /**
     * A LOG IS CLIMBED, NOT TELEPORTED ONTO.
     *
     * `Support.js` now lets a box say it is climbable and a felled trunk says
     * so — see CLIMB_LOG, and the measurement that half the wood was a wall by
     * ten centimetres. But the line below plants the feet on whatever the query
     * answered, in one frame, and a 1.2 m trunk answered that way is the body
     * jumping a metre with no time passing: in third person it is a hitch and
     * in first person, where the eye copies the target exactly rather than
     * damping it, it is a jolt straight up.
     *
     * So anything more than an ordinary step is taken at a RATE. 3.4 m/s puts
     * the median log (0.55 m) under you in 0.16 s and the largest (1.26 m) in
     * 0.37 — long enough to read as clambering, short enough that it never
     * feels like being stuck on the thing. It only ever applies while the
     * surface is above the feet, so nothing about walking, falling or landing
     * changes.
     */
    /* ONCE IT HAS STARTED, IT FINISHES. `this.climbing` lowers the threshold to
     * nothing for as long as the body is on its way up, and without that the
     * last 0.42 m of a metre-high log is taken in ONE FRAME — the moment the
     * remaining rise drops under STEP_UP the ordinary snap claims it, so a
     * climb that is smooth for eight frames ends in exactly the jolt the rate
     * exists to remove. Measured on a 0.81 m log: 0.057, 0.057, …, 0.425. */
    /* A BODY THAT IS FALLING IS NOT CLIMBING, and this cost `standing`'s
     * fall-through check to find: a dive from 60 m crosses a roof at 30 m/s,
     * the support query answers with the roof, and rate-limiting that rise is
     * rate-limiting a LANDING — the body sinks past the roof at 5.7 cm a frame
     * while gravity takes it down at half a metre. Measured: a dive from 25 m
     * rested on the roof at 22.80 and one from 60 m went through it to 0.00.
     * `wasGrounded` is the whole distinction: a climb starts from the floor. */
    if (wasGrounded && support > gh + 0.05
        && support > this.position.y + (this.climbing ? 1e-3 : STEP_UP)) {
      /* FROM THE FEET, not from the feet plus a step: adding STEP_UP back in
       * would let the first frame of a climb take 0.45 m in one go, which is
       * the jolt this whole clause exists to remove. An ordinary step is
       * untouched — the branch is only entered for something TALLER than one. */
      const reach = this.position.y + CLIMB_RATE * dt;
      if (support > reach) support = Math.max(this.position.y, reach);
      this.climbing = true;
    } else this.climbing = false;
    // Never inside it: a body below the surface it is standing on is the
    // "phase into it" the player described, and it is unconditional.
    if (this.position.y < support) this.position.y = support;
    if (this.position.y <= support + GROUND_SNAP && this.velocity.y <= 0.1) {
      // ONE landing path, so a prop landing sounds and looks like a sand one.
      // `_land` and the `fallSpeed` reset used to live only on the terrain
      // branch, so landing on a rock was silent and kept a stale fall speed
      // that fired a bogus violent landing the moment you stepped off it.
      if (!wasGrounded && this.fallSpeed < -7) this._land(ctx, -this.fallSpeed);
      this.position.y = support;
      if (this.velocity.y < 0) this.velocity.y = 0;
      this.grounded = true;
      this.fallSpeed = 0;
      // Slide down steep faces — but only off the TERRAIN. A boulder's top is
      // flat by construction and the terrain normal underneath it is whatever
      // the hillside does, which would drag you off a rock you are standing on.
      if (terrain && support <= gh + GROUND_SNAP) {
        terrain.normalAt(this.position.x, this.position.z, _v1);
        const slope = 1 - _v1.y;
        if (slope > 0.52) {
          _v2.set(_v1.x, 0, _v1.z).normalize().multiplyScalar((slope - 0.52) * 26 * dt);
          this.velocity.add(_v2);
        }
      }
    } else if (this.position.y > support + 0.06) {
      this.grounded = false;
    }

    /**
     * AND THE THING OVER YOUR HEAD.
     *
     * There was no ceiling in this game. The loop above skips upward faces
     * because floors belong to the support query — correct — and then does
     * `_v5.y = 0`, which for a DOWNWARD face is the entire normal, so the
     * contact was found and discarded. Vertical resolution existed in one
     * direction only. Measured on a slab spanning y=3.5..4.5: the jump crossed
     * the underside at f38, was 0.5 m inside solid slab at f42, and STEP_UP
     * snapped the body out onto the ROOF at f57 — free entry to every interior
     * from below (11 roofs across the nine levels).
     *
     * The crown, not the collider's mid-body sphere: that sphere is 0.89 m up
     * with a 0.38 m reach, so resolving against it would leave half a metre of
     * head inside the slab. It drops with the crouch by exactly what the eyes
     * drop by — one rule for how far a crouch lowers you, not two — so
     * crouching does clear a beam the standing body will not.
     *
     * Clamped against `support` so a ceiling can never push the body below the
     * floor it is standing on: a slab too low to stand under stops the head
     * where the ceiling is and no further, which is a squeeze and not a
     * trapdoor.
     */
    const ceiling = ceilingHeight(this._nearBoxes, this.position.x, this.position.z,
      sweepFrom, this.radius, STEP_UP);
    if (ceiling < Infinity) {
      const crown = this.position.y + this._crownHeight();
      if (crown > ceiling) {
        this.position.y = Math.max(support, this.position.y - (crown - ceiling));
        if (this.velocity.y > 0) this.velocity.y = 0;
        this.jumpHeld = 0;     // the Force is not pushing you through a roof
      }
    }

    if (terrain && !terrain.inBounds(this.position.x, this.position.z, 6)) {
      const h = terrain.half - 6;
      this.position.x = clamp(this.position.x, -h, h);
      this.position.z = clamp(this.position.z, -h, h);
    }

    this.body.setTransform(_v1.set(this.position.x, this.position.y + 0.9, this.position.z), null);
  }

  _land(ctx, impactSpeed) {
    const power = clamp(impactSpeed / 18, 0.2, 1.6);
    this.cloak?.impulse(_v5.set(0, 1, 0), power * 2.2); this.skirt?.impulse(_v5.set(0, 1, 0), power * 2.2);
    this.camera.addShake(power * 0.5);
    audio.thud(this.position, power);
    if (ctx.particles) {
      ctx.particles.sandPuff(this.position.clone(), power * 1.9, this.position.y, ctx.groundColor);
    }
    /* A DIVE LANDS HARDER THAN A FALL, and it is one multiplier rather than a
     * second landing path: everything below already scales with `power`, so a
     * dive is a landing with more of it. The blade is in it — that is the
     * difference between arriving fast and arriving with a sword — which is
     * why the damage term takes the bigger share.
     *
     * `diving` is cleared HERE and nowhere else. It is set by an input and can
     * only be answered by an impact, so any other clear would be a second
     * owner of the same fact. */
    const dove = this.diving;
    this.diving = false;
    if (impactSpeed > 15) {
      // a Force landing cracks the ground and staggers everything near it
      if (ctx.terrain) ctx.terrain.crater(this.position.x, this.position.z, 1.8 + power, 0.42 * power);
      audio.explosion(this.position, 0.5);
      const k = dove ? DIVE_LAND : 1;
      this._shockwave(ctx, 5.4 * power * k, 11 * power * k, 14 * power * k * k);
      if (this.boonMods.repulse) this._shockwave(ctx, 8 * power, 20 * power, 26 * power);
    }
    // Four arguments, not three. The signature is (amount, point, source, kind)
    // and this shipped as (amount, null, 'fall') — so `source` got the string
    // 'fall' and `kind` got undefined. A fall that killed you then called
    // die('fall') → onPlayerDeath(player, 'fall'), i.e. a killer that is a
    // string where every other death hands over an entity, and the one
    // diagnostic that prints `kind` printed undefined. Enemy.js's identical
    // fall-damage line has always passed four. Nothing threw; the third
    // distinct bug this one method has produced.
    if (impactSpeed > 26) this.damage(clamp((impactSpeed - 26) * 2.6, 0, 45), null, null, 'fall');
  }

  /**
   * A RADIAL SHOVE — and the local vector on the first line is a bug fix, not
   * a style choice.
   *
   * This used the module scratch `_v1` for the direction and handed it
   * straight to `applyKnockback`. That call does `velocity.add(impulse)` and
   * then `this.damage(...)`, and damage re-enters a great deal of code — hit
   * reactions, the score, the announcer, anything watching a kill — some of
   * which reaches back into Player.js and takes `_v1` for its own use. So the
   * direction was being clobbered PART WAY THROUGH THE LOOP: every body after
   * whichever one first triggered a re-entrant path got whatever was left in
   * the scratch.
   *
   * HONESTY ABOUT WHAT THIS FIXED: nothing observed, yet. I wrote it while
   * chasing a ring of eight B1s in which five flew 7.7 m and three moved 0.25,
   * and I was sure this was the cause. It was not — the three were culled by
   * `sandboxCount: 5`, which is a default of the mode the probe booted, and
   * the change made no difference to that measurement at all. The hypothesis
   * is recorded as refuted rather than deleted, because the next person to see
   * an asymmetric shockwave will form it too.
   *
   * The change STAYS on its own merits: handing a shared module scratch to a
   * callee that re-enters this file is a hazard whether or not it has bitten,
   * and `Enemy.unstable`'s own call at line ~1798 has always passed
   * `_v2.clone()` for exactly this reason. It costs one vector.
   *
   * A dedicated vector rather than `.clone()` per body: this loop runs over
   * every enemy in the radius, and a clone per body is an allocation per body
   * in the one function whose whole job is to be called when the field is
   * full.
   */
  _shockwave(ctx, radius, force, damage) {
    const enemies = ctx.enemies || [];
    const dir = _shockDir;
    for (const e of enemies) {
      if (e.dead) continue;
      const d = e.position.distanceTo(this.position);
      if (d > radius) continue;
      const k = 1 - d / radius;
      dir.subVectors(e.position, this.position).setY(0.6).normalize();
      e.applyKnockback(dir.multiplyScalar(force * k), damage * k, this);
    }
    if (ctx.physics) {
      for (const b of ctx.physics.bodies) {
        if (b.invMass === 0) continue;
        const d = b.position.distanceTo(this.position);
        if (d > radius) continue;
        const k = 1 - d / radius;
        _v1.subVectors(b.position, this.position).setY(0.5).normalize();
        b.applyImpulse(_v1.multiplyScalar(force * k * b.mass * 0.5), b.position);
      }
    }
    if (ctx.particles) {
      for (let i = 0; i < 26; i++) {
        const a = (i / 26) * TAU;
        _v1.set(Math.cos(a), 0.2, Math.sin(a)).multiplyScalar(radius * 1.4);
        _v2.copy(this.position).setY(this.position.y + 0.1);
        ctx.particles.dust.spawn(_v2, _v1, { life: 1.1, size: 0.5, drag: 2.2, gravity: 0.6,
          color: ctx.groundColor ?? 0xd8c8a8, alpha: 0.22, floor: this.position.y });
      }
    }
    this.world.engine.setRadial?.(0.5);
  }

  _tryDash(ctx) {
    /**
     * THREE REFUSALS, AND ALL THREE SAY SO.
     *
     * `_refuse`'s own header is the rule — "a bound key that does nothing and
     * does not say why is the same lie as a dead checkbox" — and all twelve
     * Force powers obey it. The dash opened with a bare `return` on the
     * stamina.
     *
     * THE LOCK. `_move` zeroes the move axis while a stratagem is being
     * spelled; this method reads `moveAxis()` FRESH, past the zeroing, so the
     * one verb that could not be locked out was the one aimed by the very keys
     * the code is spelled with. Measured: 3.87 m of travel and 0.16 s of
     * invulnerability out of a lock that held a run to 0.00 m.
     *
     * THE DIVE. `_tryDive` refuses while `dashTimer > 0` and this had no
     * mirror clause, so the pair was only exclusive in one direction: a dive
     * could be dashed. Measured — a 31.6 m/s descent, steerable, wearing the
     * somersault, with 0.28 s of invulnerability, for 36 stamina. A commitment
     * you can steer out of is not one.
     */
    if (this._spelling()) return this._refuse('dash', 'you are calling for support');
    if (this.diving) return this._refuse('dash', 'committed to the dive');
    if (this.stamina < DASH_STAMINA) {
      return this._refuse('dash', `${DASH_STAMINA} stamina needed, you have ${Math.round(this.stamina)}`);
    }
    const axis = ctx.input.moveAxis(_axis);
    const fwd = _v1.set(Math.sin(this.camera.yaw), 0, Math.cos(this.camera.yaw)).negate();
    const right = _v2.set(fwd.z, 0, -fwd.x).negate();
    // Any direction, including pure strafe and pure backward — this used to
    // require a forward or back input, so you could not sidestep a bolt.
    this.dashDir.set(0, 0, 0).addScaledVector(fwd, axis.y).addScaledVector(right, axis.x);
    // No direction held means "get me out of here": dash backward, not into it.
    if (this.dashDir.lengthSq() < 0.01) this.dashDir.copy(fwd).negate();
    this.dashDir.normalize();
    /* 0.24 rather than 0.17 — note 22 asks for a longer dash in as many words.
     * At the same 15.5 m/s that is 2.3 m -> 3.4 m of travel, and it makes
     * `invuln = 0.16` EXACTLY the two thirds of the dash the somersault's own
     * comment already claims it is. `cooldowns.dash = 0.55` still gates it, so
     * the rate is unchanged and only the distance moves. */
    this.dashTimer = 0.24;
    this.stamina -= DASH_STAMINA;
    this.staminaHold = STAMINA_HOLD;   // and it does not refill between dashes
    this.cooldowns.dash = 0.55;
    this.invuln = Math.max(this.invuln, 0.16);
    /* AIRBORNE ONLY. A dodge with a foot on the ground is a sidestep and it
     * already looks like one; a somersault out of a standing start would put
     * the character's head through the sand. Being in the air is also what
     * makes the flip legible — there is nothing else going on to read it
     * against. The invulnerability stretches over the first two thirds of the
     * turn, so the thing that looks like a dodge is a dodge. */
    if (!this.grounded) {
      this.flipT = FLIP_TIME;
      this._flipQ.identity();
      this.flipAxis.crossVectors(UP, this.dashDir);
      if (this.flipAxis.lengthSq() < 1e-6) this.flipAxis.set(1, 0, 0);
      this.flipAxis.normalize();
      this.invuln = Math.max(this.invuln, FLIP_TIME * 0.66);
    }
    audio.force(this.position, 'jump');
    if (ctx.particles) ctx.particles.sandPuff(this.position.clone(), 0.9, this.position.y, ctx.groundColor);
    /**
     * THE LENS KICK, ON THE GAME'S CLOCK.
     *
     * This was `setTimeout(…, 180)`, which is the wall clock, and the wall
     * clock is not what the game is running on. Force-jump inside a hitstop or
     * a Force Sense and the world is at 0.06× or 0.42× while the timer counts
     * real milliseconds — so the kick came back before the jump had visibly
     * started. Pause the game and it came back behind the pause card. Alt-tab
     * and the browser throttles the timer to one a minute, so it did not come
     * back at all until you returned.
     *
     * `kickFov` is the same 6 degrees over the same 0.18 s, measured on the dt
     * the rig is already being handed, which is the only clock the rest of the
     * camera obeys.
     */
    this.camera.kickFov(6, 0.18);
  }

  _footstep(p, speed) {
    const ctx = this.world;
    const surface = ctx.terrain ? ctx.terrain.surfaceAt(p.x, p.z) : 'sand';
    audio.step(p, surface, speed > 5);
    if (ctx.particles && speed > 0.6) {
      if (surface === 'water') ctx.particles.splash(p.clone(), 0.4);
      else ctx.particles.sandPuff(p.clone(), clamp(speed * 0.09, 0.12, 0.5), p.y, ctx.groundColor);
    }
  }

  /* ── blade ───────────────────────────────────────────────────────── */

  _updateBlade(dt, ctx) {
    // Chest anchor: the frame the whole blade solve lives in.
    //
    // In first person this cannot be the real chest. The eye sits ~28cm above
    // it, so a blade solved from the sternum arrives at the lens from below and
    // to the side, a metre of it filling a quarter of the screen. Every first
    // person game solves this the same way: the weapon hangs off the VIEW, not
    // off the ribcage. So drop the anchor further below the eye and push it
    // back behind it, which both recedes the blade to a sane size and puts the
    // hilt where your hands would actually be if you were holding it up.
    // THE BODY'S CHEST, ALWAYS, IN BOTH VIEWS.
    //
    // Everything outside this file that asks the player where they are asks
    // `chest`: Enemy.js aims every bolt and every lunge at `target.chest`,
    // Duel.js builds the blade-lock midpoint from it, World.js searches for
    // threats near it, and a dozen Force powers use it as their origin and as
    // the position of their own sound. It is a place on a body.
    //
    // It used to be quietly redefined in first person as the point the WEAPON
    // hangs from, which is a different thing that merely happened to be at a
    // similar height. Making that point follow the aim — which the viewmodel
    // needs, so the hands stay in front of the lens when you look up — would
    // have carried all of the above with it: measured, looking straight up put
    // it 0.20 m ABOVE the player's own eye, so every droid in the level would
    // have been shooting over the head of a player who looked at the sky.
    // They are two points and they are now two fields.
    /**
     * `stand`, NOT `stature` — and this is the second half of "both arms in
     * the air".
     *
     * All four of these are heights on a body, and `stature` is a fraction of
     * total HEIGHT. Those are the same thing only on a figure whose parts are
     * all scaled alike, and `smallfolk` is deliberately not one: `legLen: 0.80`
     * against a torso at 0.40 puts its chest lower than its overall height
     * suggests. Measured (tools/_stature.mjs), stature reads 0.371 where the
     * bones put the chest at 0.340 — so the guard, and with it the hilt and
     * both arms, was solved from a point 4 cm too high on a figure whose whole
     * arm is 23 cm long. In arm-lengths: the anchor sat 0.01 ABOVE the small
     * frame's shoulder where a human's sits 0.11 BELOW it, and everything
     * hanging off it rode up by the difference.
     *
     * `limbScale` reads it off the bones, so it is the height the body actually
     * has rather than a second opinion about it (HANDOFF 2.3), and it is
     * exactly 1 for every human-framed species in the table — nothing that
     * ships today moves by a bit except the one this note is about.
     */
    const st = this.limbs?.stand ?? this.stature ?? 1;
    this.chest.copy(this.position).setY(this.position.y + lerp(CHEST_H, CHEST_H_CROUCH, this.crouch) * st);
    const chestH = lerp(CHEST_H, CHEST_H_CROUCH, this.crouch) * st,
          eyeH = lerp(EYE_H, EYE_H_CROUCH, this.crouch) * st;
    /**
     * ONE ANCHOR, BOTH VIEWS — and the eye is where it hangs FROM in first
     * person, never what it is measured from.
     *
     * `HILT` is one offset from the CHEST, in the aim frame, and both views now
     * take it. What still differs is only the point it hangs off: third person
     * uses the chest itself, first person uses the same eye the camera uses
     * with the eye-to-chest height taken straight back out, so the offset lands
     * on the same place plus the eye's own ride. That ride is the point of the
     * difference and not a rounding error — the hilt used to hang off
     * `position.y + eyeHeight`, which is the eye MINUS everything the eye does
     * (the pelvis bob, the lateral sway, the 7 cm forward set), and the wrist
     * travelled 97 mm up and down the frame per stride chasing a weapon that
     * was swimming under a shoulder already pinned to the lens.
     *
     * IN THE AIM FRAME, ALL OF IT, in both views. In first person that is what
     * makes the hands a viewmodel: flattened to horizontal, the forward term
     * left the hilt roughly where the BODY was while the view rotated off it,
     * and at 63 degrees of look-up the left elbow came within 8 mm of a 45 mm
     * near plane and was sliced in half. In third person it is what makes the
     * figure carry its sword in front of ITSELF rather than in front of due
     * north.
     *
     * WHY THE THIRD-PERSON ANCHOR MOVED, WHICH IS THE WHOLE OF THIS CHANGE.
     * These were two anchors — chest in third, chest + 0.32 up + 0.16 forward
     * in first — and the second is where the hands have to be for a lens that
     * sits above and behind them to see them at all. Two anchors is two
     * weapons: measured through the real Player over the guard's whole travel,
     * with the blade held still at each point of a 9x9 grid and the tip read
     * off the chest,
     *
     *                       third    first
     *     reach from feet    1.59 m   1.73 m   +9.1%
     *     reach along aim    1.49 m   1.70 m  +14.3%
     *     standing stab      2.05 m   2.25 m   +9.3%
     *
     * — nine percent of reach for pressing the camera key. (The 28% the ratchet
     * in tools/checks/first-person.mjs used to report is a different quantity
     * and it was measuring the RESTING pose: that stub never holds `blade`, so
     * the guard never leaves READY_GUARD and what it compared was where the two
     * views park the blade, not how far either can reach. The two numbers are
     * both real; only one of them is the sword's length.)
     *
     * Giving both views one offset makes those three rows agree to 3%, and what
     * it costs is that the third-person figure now holds its sword 12 cm above
     * and 18 cm in front of its own sternum instead of 20 cm below and 2 cm
     * behind it — which is where a held sword goes, and is very nearly the pose
     * the first-person view has been using all along. The offset that lands in
     * the window is 0.32 / 0.20 rather than first person's old 0.32 / 0.16;
     * HILT's own note has the grid and the four bounds it is threading.
     *
     * `HILT` takes the arm's scale like every other chest-to-hand length. A
     * human's is exactly 1 (`limbScale` divides the reference figure's arm by
     * itself), so nothing below a human moves the human.
     */
    const A = this.limbs.arm;
    const fp = this.camera.firstPerson;
    this.gripAnchor.copy(fp ? this.camera.eyePosition(this.position, eyeH, _v5) : this.chest)
      .addScaledVector(_v4.set(0, 1, 0).applyQuaternion(this.camera.aimQuat),
        HILT.rise * A - (fp ? eyeH - chestH : 0))
      .addScaledVector(_v4.set(0, 0, -1).applyQuaternion(this.camera.aimQuat), HILT.fwd * A);
    // The same two heights EYE_H/EYE_H_CROUCH already name, and on the same
    // body scale — they were typed again here, unscaled, which is the shape
    // HANDOFF 2.4 is about even on a field nothing currently reads.
    this.headPos.copy(this.position).setY(this.position.y + eyeH);
    this.camera.aimDirection(this.aimDir);

    /* THE BODY GOES WITH THE ATTACK — and it moves the anchor the blade is
     * SOLVED from, so the extra travel is real travel and not a decoration
     * layered over a blade that is somewhere else. See _attackDrive. */
    this._attackDrive(dt);
    this.gripAnchor.add(this.attack.shift);
    /* WHERE THE ARMS HANG FROM — the chest, plus whatever the trunk has
     * committed to the attack. It is the anchor minus HILT, and the two are
     * different points now: one is the weapon's, one is the body's. See the
     * armMax clamp in SaberController.solveTargets. */
    this.armRoot.copy(this.chest).add(this.attack.shift);

    // The tier's scale on the parry window. Set unconditionally, unlike assist:
    // Grandmaster has assist 0 and still declares the tightest window in the
    // table, so hanging this off the assist branch would leave the one tier
    // that most advertises it as the only tier without it.
    this.control.parryWindow = parryScale(this.difficulty);

    if (this.isLocal && this.difficulty && this.difficulty.assist > 0) {
      this.control.assist = this.difficulty.assist;
      // 34 m, not 26: the assist works to a fixed 0.9 s of warning, and at
      // Padawan's 30 m/s a 26 m search only ever handed it 0.87 s — so the one
      // tier that most needs the full lead was the one being clipped.
      const threats = ctx.bolts ? ctx.bolts.threatsNear(this.chest, 34) : [];
      this.control.applyAssist(threats.filter(t => t.bolt.team !== this.team), this.gripAnchor, this.camera.aimQuat, dt);
    } else this.control.assist = 0;

    this.control.update(dt, this.gripAnchor, this.camera.aimQuat, {
      /* WHERE THE BODY IS, as distinct from where the weapon hangs. The guard
       * VOLUME is a rose centred on the thing bolts are aimed at; the anchor
       * above it is where the blade is solved from. They were one argument
       * until the anchor was unified and left the sternum — see _publishGuard. */
      body: this.chest,
      /* …and where the ARMS hang from, which is the chest plus the trunk's own
       * commitment to an attack. `body` is a target, `trunk` is a shoulder. */
      trunk: this.armRoot,
      stamina: this.stamina / this.maxStamina,
      flow: this.flow,
      riposte: this.riposteTimer > 0,
      stiffnessScale: this.staggerTimer > 0 ? 0.45 : 1,
    });

    if (this.throwState === 'held') {
      /* THE UNCONDITIONAL `setVisible(true)` IS WHY A DROP DID NOTHING. It ran
       * every frame, so `_dropSaber` hiding the hilt would have lasted exactly
       * one frame. The hilt is drawn iff it is in the hand. */
      if (this.saberDown) this.saber.setVisible(false);
      else {
        this.saber.setHiltPose(this.control.handPos, this.control.quat);
        this.saber.setVisible(true);
      }
    } else {
      this._updateThrow(dt, ctx);
    }

    // The same vector, published as well as passed. Saber.update consumes it to
    // separate a swing from a walk for the whoosh and the stamina drain;
    // Combat.captureSnapshot needs it for the same reason one layer down, and
    // it is handed only the saber, so the saber is where it has to live. It is
    // kept by reference — this.velocity is a persistent vector — so the frame
    // is always current, and a blade nobody publishes one for reads as still.
    this.saber.carrierVel = this.velocity;
    this.saber.update(dt, ctx.time, this.velocity);
    const swing = this.saber.swingSpeed;
    this.hum.set(swing, this.saber.contactStrain);
    this.hum.move(this.saber.pointAt(0.5, _v1));

    // swing whoosh when the blade crosses a speed threshold
    const now = ctx.time;
    if (swing > SWING_WHOOSH && now - this._lastSwingSound > 0.19) {
      this._lastSwingSound = now;
      audio.swing(swing, this.saber.pointAt(0.7, _v1));
      this.world.report?.({ type: 'swing', speed: swing });
      this.stamina = Math.max(0, this.stamina - clamp(swing * 0.055, 0, 2.4) * (this.difficulty?.staminaDrain ?? 1));
    }

    /**
     * Heat haze off the blade — and three things it must not be.
     *
     * It must not be emitted AT REST: that parked a permanent refractive smear
     * over screen centre, where a third-person blade lives.
     *
     * It must not be emitted BY A THROWN BLADE. `swingSpeed` is the hilt's own
     * speed through the world, and a saber hurled at 30 m/s and recalled
     * through the camera reports far more of it than any swing does — so the
     * throw painted a haze at screen centre for the whole flight, and the
     * recall brought it straight at the lens and blew it up as it came. That
     * is the "condensation in front of the camera on throw and recall" the
     * player reported, and it is not heat off a blade, it is a projectile
     * flying through the shot. `throwState === 'held'` is the whole gate.
     *
     * And it must not be emitted CLOSE UP. The effect is a screen-space blob of
     * 70-120 mm of NDC; within about a metre of the lens the blade subtends
     * more than that, so the haze stops reading as air over a hot object and
     * starts reading as a dirty lens. HEAT_NEAR is where that line is.
     */
    if (this.throwState === 'held' && this.saber.ignition > 0.5
        && this.world.settings.bloom && swing > 9) {
      const at = this.saber.pointAt(0.5, _v2);
      if (at.distanceTo(ctx.camera.position) > HEAT_NEAR) {
        _v1.copy(at).project(ctx.camera);
        if (_v1.z < 1) {
          const heat = clamp((swing - 9) / 22, 0, 1);
          this.world.engine.addHeat((_v1.x * 0.5 + 0.5), (_v1.y * 0.5 + 0.5),
            0.07 + heat * 0.05, heat * 0.42);
        }
      }
    }
  }

  /**
   * THE WHOLE BODY BEHIND AN ATTACK — player note 23.
   *
   * "I want the arm movement for the overhead attack to be more pronounced,
   * right now it feels kind of weak like it's only a small movement that happens
   * at the elbows rather than a whole body overhead down attack. Same for the
   * stab — it's like a small wrist movement and the blade only goes a little
   * further out. Imagine how graceful and cool a fencing stab looks, I want to
   * see more of the body involved, more effective and cooler."
   *
   * HE IS DESCRIBING THE MEASUREMENT. Driven on the real Player and read at the
   * bones over the whole attack, third person, before this existed — hand and
   * tip are travel relative to the body, spine and shoulder are the total range
   * across the attack, and the last column is how far the shoulder JOINT moved:
   *
   *                 hand      tip      spine   shoulder   joint
   *     overhead    22 cm    113 cm     1.0°     0.0°      9 mm   <- 9 mm is idle breathing
   *     stab        32 cm     57 cm     1.6°     0.0°     22 mm
   *
   * A degree of spine and nothing at all at the shoulder. The 113 cm of tip is
   * the blade's own length acting as a lever on a wrist — which is exactly what
   * "only a small movement that happens at the elbows" means, and it is why the
   * tip number looked respectable while the attack did not.
   *
   * WHY THE FIX IS NOT IN SaberController. The controller owns the GUARD — where
   * the blade points, on a sphere about the anchor it is handed. Its overhead
   * already sweeps 2.03 of the 2.05 units that sphere HAS (`_swY` clamps at
   * GY_MIN/GY_MAX), so there is no more arc to give: raising OVERHEAD.rise/drop
   * buys nothing, because the clamp eats it. What is missing is not a bigger
   * arc, it is that the sphere's CENTRE never moved. A body swinging an axe
   * drops its chest and drives its shoulder through the cut; a body lunging
   * takes its whole trunk forward. That is this function, and it is Player's
   * because it is the body's.
   *
   * It publishes ONE thing — `attack.shift`, a world-space offset added to
   * `gripAnchor` — plus the two scalars `_updateBody` poses the spine and the
   * clavicles from. Everything downstream (the guard, the hands, the blade, the
   * volume a deflection is graded in) follows the anchor, so the body's
   * contribution cannot disagree with the weapon's.
   *
   * AFTER, same instrument, same run:
   *
   *                 hand      tip      spine   shoulder   joint
   *     overhead    33 cm    118 cm    37.9°    33.3°    187 mm
   *     stab        45 cm     73 cm    22.1°    21.5°    181 mm
   *
   * and the hand's peak speed 2.0 -> 5.9 m/s on the overhead, 2.8 -> 5.7 on the
   * stab, which is the part that reads as commitment rather than as reach.
   *
   * THE MAGNITUDES, and what each buys:
   *
   *   OVERHEAD, driven by `control.swingArc` (+0.95 wind -> -1.08 cut):
   *     · 0.13 m of anchor rise on the wind and fall through the cut — a real
   *       chambering, and the single biggest term;
   *     · 0.075 m back then forward, so the cut TRAVELS rather than pivots;
   *     · 0.34 rad of spine, arched on the wind and folded through the cut.
   *   STAB, driven by `control.lunge` (0 -> 1 -> 0 over 0.40 s; the raw
   *     envelope scaled by how much of a stab this press is worth — see
   *     SaberController.thrustGain):
   *     · 0.22 m of trunk along the AIM — the lunge itself. Along the aim and
   *       not the guard, because the legs and the trunk go where the fencer
   *       faces while the point goes where the guard is;
   *     · 0.26 rad of forward lean and 0.22 of twist onto the sword side.
   *
   * A STANDING stab gets the whole of it and a moving one 60%, following
   * THRUST_REACH.standing's own reasoning: with the feet already carrying you
   * forward the trunk has less left to give, and doubling up reads as a stumble.
   */
  _attackDrive(dt) {
    const a = this.attack;
    const c = this.control;
    // The two envelopes, straight off the controller. Neither is recomputed
    // here — see SaberController.swingArc for why that matters.
    const arc = c.swingArc || 0;
    const thrust = c.lunge ?? c.thrust ?? 0;
    // A moving lunge is already half-made by the legs. `thrustStanding` is
    // latched at the press by the controller, so this cannot flicker if the
    // player starts walking halfway through the stab.
    const lunge = thrust * lerp(0.6, 1, c.thrustStanding ?? 0);

    /* THE CUT AND THE SPIN, on the same terms and for the same reason. Both
     * are read straight off the controller's own envelopes — `slashArc` /
     * `slashAcross` are the two halves of the diagonal AFTER the clamp, and
     * `spin` is the turn's 0..1 window — so nothing here restates a phase. */
    a.over = arc;
    a.lunge = lunge;
    a.slash = c.slashArc || 0;
    a.slashX = c.slashAcross || 0;
    a.spin = c.spin || 0;
    a.spinSide = c.spinSide || 1;

    const up = _v3.set(0, 1, 0).applyQuaternion(this.camera.aimQuat);
    const fwd = _v4.set(0, 0, -1).applyQuaternion(this.camera.aimQuat);
    const right = _atkR.set(1, 0, 0).applyQuaternion(this.camera.aimQuat);
    a.shift.set(0, 0, 0)
      .addScaledVector(up, arc * 0.13)
      .addScaledVector(fwd, -arc * 0.075)
      .addScaledVector(fwd, lunge * 0.22)
      // A lunge drops a little as it goes out — a fencer's line is not level,
      // and without this the stab reads as the arm being extruded forwards.
      .addScaledVector(up, -lunge * 0.045)
      /* THE CUT TRAVELS SIDEWAYS, which is the whole difference between a cut
       * and a wave. The trunk goes with the blade — 11 cm of anchor across the
       * sweep, against the overhead's 13 cm of rise — and rises a little on
       * the chamber so the stroke has somewhere to fall from. */
      .addScaledVector(right, a.slashX * 0.11)
      .addScaledVector(up, a.slash * 0.075)
      .addScaledVector(fwd, -a.slash * 0.04)
      /* AND THE SPIN LEADS WITH THE SHOULDER it is turning toward. A turn
       * whose anchor stays on the centreline is a turntable; 8 cm of lateral
       * offset is what makes the body look like it is throwing itself round
       * rather than being rotated. */
      .addScaledVector(right, -a.spinSide * a.spin * 0.08);
    return a;
  }

  /**
   * Move the shoulders onto the camera, and return the torso point the elbow
   * poles hang off. This is the whole first-person viewmodel.
   *
   * It is a re-anchoring rather than a second set of arms on purpose. A
   * viewmodel built as its own mesh is a second copy of the sleeve, the glove,
   * the bracer, the palette and the cut geometry, and every one of them is then
   * a thing that can drift out of step with the body — including on a sever,
   * where the arm you are looking down is supposed to come off. Here there is
   * exactly one pair of arms in the game. All that changes in first person is
   * WHERE THEY START: the clavicle's tip is placed on a fixed point in the aim
   * frame instead of on the ribcage, and everything below it — the IK to the
   * hilt, the wrist taking the hilt's roll, the sever path, the ragdoll — is
   * the same code addressing the same bones.
   *
   * Consequences that are properties, not accidents:
   *   · the shoulder-to-eye vector is CONSTANT, so the arms cannot swim against
   *     the view no matter what the gait, the camera or the terrain does;
   *   · the whole arm is in front of the near plane, so nothing is sliced;
   *   · look up and the arms come with you, because they are in the aim frame.
   */
  _anchorViewArms(out) {
    const rig = this.rig;
    const q = this.camera.aimQuat;
    // The SAME eye the camera will use this frame, from the same function.
    const eye = this.camera.eyePosition(this.position, lerp(1.62, 1.22, this.crouch), _m1);
    const right = _m2.set(1, 0, 0).applyQuaternion(q);
    const up = _m3.set(0, 1, 0).applyQuaternion(q);
    const fwd = _m4.set(0, 0, -1).applyQuaternion(q);

    out.copy(eye).addScaledVector(up, VM_SHOULDER_Y).addScaledVector(fwd, VM_SHOULDER_Z);

    for (const [name, side] of VM_CLAV) {
      const b = rig.get(name);
      if (!b || !b.obj.parent) continue;
      // where the clavicle's TIP has to land: the shoulder joint
      const joint = _m5.copy(out).addScaledVector(right, side * VM_SHOULDER_X);
      // the clavicle keeps its own slope, so the deltoid sits as it was built
      const dir = _m6.copy(right).multiplyScalar(side).addScaledVector(up, VM_CLAV_RISE).normalize();
      // root = tip - length·dir, so the tip lands exactly on the joint rather
      // than merely near it — the arm's reach budget is measured from there.
      b.obj.parent.worldToLocal(_m7.copy(joint).addScaledVector(dir, -b.length));
      b.obj.position.copy(_m7);
      rig.aimBoneWorld(name, dir, fwd);
    }
    rig.updateMatrices();
    return out;
  }

  /* ── body pose ───────────────────────────────────────────────────── */

  /**
   * The gait, and the eye that rides it. Split out of _updateBody so that it
   * can run BEFORE the blade: in first person the hilt is anchored to the eye,
   * and the eye cannot be known until the pelvis is. See update().
   */
  _poseGait(dt, ctx) {
    const terrain = ctx.terrain;
    const speed = Math.hypot(this.velocity.x, this.velocity.z);
    this.animator.setFacing(this.facing);
    this.animator.update(dt, {
      position: this.position,
      facing: this.facing,
      velocity: this.velocity,
      grounded: this.grounded,
      // THE FEET STAND WHERE THE BODY STANDS. This was terrain-only, so with
      // the pelvis on a two-metre boulder both ankles were driven to y=0 and
      // the legs were drawn through the rock. It is the same query the body
      // uses, over the short list _gatherNear already built this frame.
      groundAt: (x, z) => this._supportAt(ctx, x, z, this.position.y),
      crouch: this.crouch,
      accelForward: clamp(speed / 8, 0, 1),
      accelStrafe: 0,
    });
    this.camera.advanceEye(dt, this.animator.pelvis);
    this._spinBody(dt);
  }

  /**
   * The somersault, applied to the whole posed figure at once.
   *
   * `world = R·local + (pivot − R·pivot)` is the standard rotate-about-a-point,
   * and it has to be written out because three.js composes a Group as
   * `R·local + position` with no pivot of its own. The pivot is the body's
   * centre of mass rather than the pelvis: a gymnast turns about a point a
   * little above the navel, and turning about the hips instead throws the head
   * through twice the arc it should and reads as being swung on a rope.
   *
   * A landing ENDS it. A flip cut off half way would leave the figure standing
   * on its head, so the last of the turn is spent in whatever time is left —
   * `min` of the two rates, so it can only ever finish sooner.
   */
  _spinBody(dt) {
    if (this.flipT <= 0) return;
    this.flipT = Math.max(0, this.flipT - (this.grounded ? dt * 3 : dt));
    const turn = (1 - this.flipT / FLIP_TIME) * TAU;
    const root = this.rig.root;
    const pivot = _v1.set(this.position.x,
      this.position.y + FLIP_PIVOT * (this.rig.scale ?? 1), this.position.z);

    /* THE CAPE COMES ROUND WITH THE BODY. A verlet sheet keeps its velocity as
     * `pos − prev` in world space, so a body that turns through a whole
     * revolution in half a second teleports the pinned collar to the far side
     * of the wearer while every free particle stays where it was; the solver
     * reads that as an enormous velocity and cannot pull the links back. The
     * first shot of this flip had the cloak as two rigid four-metre planks.
     * Carrying it by the frame's own delta leaves only the genuine lag to
     * simulate, and the lag is what billows. See Cloak.carry.
     *
     * The delta, not the absolute: applying the whole turn every frame would
     * spin the cloth n times faster than the body. */
    _q1.setFromAxisAngle(this.flipAxis, turn);
    _q2.copy(this._flipQ).invert().premultiply(_q1);
    this._flipQ.copy(_q1);
    this.cloak?.carry(_q2, pivot);
    this.hoodDrape?.carry(_q2, pivot);
    this.skirt?.carry(_q2, pivot);

    if (this.flipT <= 0) {
      // A full turn ends where it started, so this snap is a no-op in practice
      // — but only in practice, and a landing can cut the turn short.
      root.quaternion.identity(); root.position.set(0, 0, 0);
      this._flipQ.identity();
      this.rig.updateMatrices();
      return;
    }
    root.quaternion.copy(_q1);
    root.position.copy(pivot).sub(_v2.copy(pivot).applyQuaternion(root.quaternion));
    this.rig.updateMatrices();
  }

  /**
   * SOLVE THE ARM FROM THE GRIP'S ORIENTATION, NOT JUST ITS POSITION.
   *
   * The long note further down records two attempts at the wrist problem, both
   * measured and both thrown away, and ends by saying what the answer has to
   * be: "the arm has to be solved from the grip's ORIENTATION as well as its
   * position, so the forearm arrives already pointing somewhere a wrist can
   * finish from." This is that, and it is only possible now that the hand's
   * orientation is known BEFORE the IK runs rather than stamped on afterwards.
   *
   * The bug is one line in `solveIK`: the lower bone's roll comes from
   * `aimY(lowerDir, poleDir)`. The pole is a hint about which way the elbow
   * BENDS — a plane — and it is being asked to decide the forearm's TWIST as
   * well. Those are different questions with different right answers, and the
   * forearm was answering the wrong one: hence 6874 deg/s of spin on a hand
   * that is barely moving, and a wrist left to absorb the whole difference.
   *
   * (Aiming the pole itself at the grip was tried first and is worse — 8780
   * deg/s. It has to be: `aimY` substitutes a fixed reference whenever the
   * direction and the reference come within 10 degrees of parallel, and a pole
   * pointed along the arm is that degeneracy by construction.)
   *
   * So the roll is set here instead, off the hand the grip has already fixed.
   * The forearm keeps exactly the direction solveIK gave it — the elbow does
   * not move — and only turns about its own axis, until its X agrees with the
   * hand's. Pronation is a forearm motion; this is the bone that should be
   * doing it.
   */
  _rollForearm(foreName, handName, handQuat, dt = 1 / 60) {
    const bone = this.rig.get(foreName);
    const hand = this.rig.get(handName);
    if (!bone || !bone.obj.parent || !hand) return;
    bone.obj.updateMatrixWorld(true);
    bone.obj.getWorldQuaternion(_q4);
    // the direction solveIK chose, which must not change
    const dir = _v10.set(0, 1, 0).applyQuaternion(_q4);
    /*
     * The forearm the WRIST wants is the one that leaves the hand sitting at
     * its own rest pose: `hand.restQuat` is the local rotation a relaxed wrist
     * has, so the orientation that costs the wrist nothing is
     * `handWorld * restQuat^-1`. Call that Qd.
     *
     * Qd's own +Y will not be the direction the IK chose, so it is SWUNG onto
     * it — the minimal rotation from one to the other, pre-multiplied. That
     * keeps every bit of Qd's twist and changes only where the bone points,
     * which is the one thing this must not touch.
     *
     * Done as a swing rather than as `aimY(dir, someAxisOfQd)`, which was the
     * first spelling and is not continuous: aimY substitutes a fixed reference
     * whenever the two come within 10 degrees of parallel, so on the frames
     * where Qd's X lines up with the bone the roll jumped and the forearm
     * spun at 5496 deg/s — the very fault this method exists to remove.
     */
    _q5.copy(handQuat).multiply(_v12Q.copy(hand.restQuat).invert());
    const y = _v11.set(0, 1, 0).applyQuaternion(_q5);
    _q4.setFromUnitVectors(y, dir).multiply(_q5);

    /**
     * …AND THE SWING HAS A SINGULARITY OF ITS OWN, WHICH IS THE SECOND HALF.
     *
     * `setFromUnitVectors(y, dir)` is the minimal rotation carrying one
     * direction onto another, and when the two are ANTIPARALLEL there is no
     * minimal rotation: every axis perpendicular to `dir` turns y onto dir
     * through 180 degrees, and three.js picks one by a fixed rule that flips as
     * y crosses over. y is the forearm the WRIST wants and dir is the forearm
     * the IK chose, so y ≈ −dir is a wrist folded all the way back — which is
     * exactly the pose the ratchet in tools/checks/viewmodel.mjs has been
     * carrying forward at 140 degrees from rest, a hand's width from the flip.
     *
     * Measured on the same bench, over six mouse sweeps rather than the one the
     * ratchet runs, the forearm reaches 10723 deg/s on the CHEST anchor with
     * everything else as it shipped. That is not this pass's doing and it is
     * not reached by the bench; it is a live fault the bench happens to miss.
     *
     * The cure and its two numbers are FOREARM, and the note over it carries
     * the measurement: carry the ANGLE rather than rebuild the quaternion, take
     * the reference from last frame's forearm swung onto today's direction, and
     * limit how fast it may turn.
     */
    const st = this._foreRoll[foreName];
    if (st.have) {
      // last frame's pose, re-aimed at today's direction: the reference frame
      _fq1.setFromUnitVectors(_fv1.set(0, 1, 0).applyQuaternion(st.q), dir).multiply(st.q);
      // how far round `dir` the ideal sits from it
      _fv1.set(1, 0, 0).applyQuaternion(_fq1);
      _fv2.set(1, 0, 0).applyQuaternion(_q4);
      let phi = Math.atan2(_fv3.crossVectors(_fv1, _fv2).dot(dir), _fv1.dot(_fv2));
      // …and how well defined it is. Only the antiparallel end is degenerate:
      // y ≈ +dir is the identity swing and perfectly well behaved.
      const c = y.dot(dir);
      const w = c >= 0 ? 1
        : smoothstep(0, FOREARM.cone, Math.sqrt(Math.max(0, 1 - c * c)));
      const step = FOREARM.rate * dt;
      _q4.setFromAxisAngle(dir, clamp(w * phi, -step, step)).multiply(_fq1);
    }
    st.q.copy(_q4); st.have = true;

    bone.obj.parent.getWorldQuaternion(_v12Q);
    bone.obj.quaternion.copy(_v12Q.invert()).multiply(_q4);
    bone.obj.updateMatrixWorld(true);
  }

  /**
   * WHERE THE ELBOW GOES IS THE WRIST'S BUSINESS TOO — and nothing had ever
   * told it.
   *
   * This is the BEND half of the grip, the residue `_rollForearm`'s note and
   * the ratchet in tools/checks/viewmodel.mjs have both been carrying: "the
   * wrist reaches 114.4° from rest". A human wrist does not bend 114°; the
   * whole of flexion is about 80° and the whole of extension about 70°, and
   * every measurement of a *functional* range — the arc people actually use for
   * work — is well inside half of that. Whatever the number the check reads,
   * the pose was not one a body can make.
   *
   * MEASURED FIRST, because "the wrist is bent" is three different faults
   * wearing one number. On the ratchet's own bench, over its 170 sampled
   * frames:
   *
   *     wrist from rest      39.2 …  83.6 … 114.4°
   *     of which BEND        39.2 …  83.6 … 114.4     <- all of it
   *     of which twist        0.0 …   6.6 …  18.4     <- `_rollForearm` works
   *     hand's long axis to the blade   90.0 … 90.0 … 90.0
   *
   * So it is not roll, `_rollForearm` is doing its job, and the bend is one
   * angle: between the forearm the IK chose and the forearm the HAND wants —
   * `handWorld · restQuat⁻¹` pointed along its own +Y, which is the same
   * quantity `_rollForearm` already builds and swings.
   *
   * AND THE FREE PARAMETER THAT DECIDES IT WAS SPENT ON SOMETHING ELSE. Once
   * the shoulder and the wrist are both fixed — and they are, by the hilt — a
   * two-bone solve has exactly ONE degree of freedom left: the elbow's swivel
   * about the line between them. `solveIK` takes it from the pole, and the pole
   * above is built entirely out of where the hand is relative to the CHEST.
   * Nothing in it mentions the wrist. Swept through a whole turn at every frame
   * of the bench, through the shipped `solveIK`, the same wrist reads:
   *
   *                          worst      median
   *     shipped pole         114.4°      83.6°
   *     best swivel           77.9        36.7
   *
   * That is the headroom, and it is free: the hand does not move, the hilt does
   * not move, the blade's envelope does not move. Only the elbow does, and it
   * moves to where a real elbow goes — because in a real arm the elbow's
   * swivel IS driven by the hand's orientation. That is why you turn your
   * elbow out to pour from a jug.
   *
   * So the pole is a HINT and this bends it toward the wrist: `wrist − foreLen ·
   * wantDir` is the elbow a straight wrist implies, and the swivel between the
   * two poles is taken up to `ELBOW.swivel` and no further. The cap is what
   * keeps the note above this — "a pole pinned to the right of the chest folds
   * the right elbow straight through the ribs" — still true: the chest pole
   * still chooses the basin, and the wrist is allowed to argue within it.
   *
   * MEASURED, same bench, `ELBOW` carries the sweep the two numbers come from:
   *
   *                            worst          median        forearm
   *     third, two hands     114.4 →  89.4  83.6 → 36.7   2487 → 2476 °/s
   *     third, one hand      107.8 →  79.0  62.8 → 14.7   1221 → 1112
   *     first, two hands     131.1 → 115.1  88.6 → 65.8   1099 → 1605
   *     first, one hand      112.0 → 102.3  83.4 → 76.7   2747 → 2429
   *
   * (The one-hand rows are the state a player reaches by holding the one-hand
   * key. A row that read 124.2 → 115.8 stood here for "first person, 1 hand"
   * and was taken through the `fpHands` option instead, which moved the arms
   * and left the blade on `GRIPS.two` — see `handsOnHilt`. It is not the same
   * arm and the number is not comparable, so it is replaced rather than kept.)
   *
   * A wrist's own limits are about 80° of flexion and 70° of extension, with
   * 20-30° of deviation across them, so ~85° is the most a real one reaches at
   * either end and the arc it WORKS in is half that. The median is the number
   * that says how the arm reads for the other 169 frames, and it lands inside
   * the working arc; the worst lands at the anatomical end of the range.
   *
   * ── WHAT IS LEFT, AND THE ATTRACTIVE WRONG ANSWER ──────────────────────────
   *
   * The residue is not tunable, and the same probe says why. `handPoseOnHilt`
   * forces the hand's long axis EXACTLY perpendicular to the blade — measured,
   * 90.0° on every frame of every bench — so the smallest wrist any choice of
   * elbow can reach is |90° − θ|, where θ is the angle between the forearm and
   * the blade. The worst frame here is θ = 3.1°: the guard has the blade lying
   * along the arm, which is a THRUST, and a hand cannot hold a hammer grip
   * pointing down its own forearm. 89.4° is that frame's floor, not a slack
   * bound — the check's own note has said since it was written that the last of
   * this is the CONTROLLER's guard model and it is still right.
   *
   * The tempting cure is to say the tunnel a fist makes is OBLIQUE — real hands
   * do hold a hammer nearer their own axis than across it — and tilt
   * `GRIP_BORE`'s axis by 25-35°, which would take the floor with it. IT IS NOT
   * TRUE OF THIS HAND, and `tools/_bore.mjs` is the measurement rather than the
   * opinion: replaying `buildHand`'s finger construction and fitting the arc
   * each of the four fingers closes on gives bores at y 64.2 / 66.5 / 65.0 /
   * 61.7 mm across x +26.7 to −26.2, i.e. a tunnel tilted **2.9°** off the
   * hand's X toward the knuckles and 4.1° out of the palm. (The middle finger's
   * joints come out at (87,5) (96,33) (81,51) (63,57) mm, which is
   * `GRIP_BORE`'s own note to the millimetre, and the four-finger centre is
   * y 64.4 mm against the 65 it ships.) Three degrees is not thirty. Tilting
   * the grip axis would mean changing what `buildHand` BUILDS, and that is a
   * different job with a different owner.
   */
  _wristPole(upperName, foreName, handName, handQuat, wrist, pole, dt) {
    const st = this._elbow[upperName];
    if (!(ELBOW.swivel > 0) || !st) return pole;
    const fore = this.rig.get(foreName), hand = this.rig.get(handName);
    if (!fore || !hand) return pole;
    const shoulder = this.rig.worldPos(upperName, _wp1);
    // the forearm a wrist at rest would have, and the elbow it puts behind it
    _wpQ.copy(handQuat).multiply(_wpQ2.copy(hand.restQuat).invert());
    _wp2.set(0, 1, 0).applyQuaternion(_wpQ);
    _wp3.copy(wrist).addScaledVector(_wp2, -fore.length * fore.cutT);
    // both poles carry a swivel about the shoulder→wrist line and nothing else:
    // solveIK reads `cross(toTarget, poleDir)`, so only this component is seen
    _wp4.subVectors(wrist, shoulder);
    if (_wp4.lengthSq() < 1e-8) return pole;
    _wp4.normalize();
    _wp5.subVectors(pole, shoulder);
    _wp5.addScaledVector(_wp4, -_wp5.dot(_wp4));
    _wp6.subVectors(_wp3, shoulder);
    _wp6.addScaledVector(_wp4, -_wp6.dot(_wp4));
    const len = _wp5.length();
    if (len < 1e-4 || _wp6.lengthSq() < 1e-8) return pole;
    _wp5.multiplyScalar(1 / len); _wp6.normalize();
    let phi = clamp(Math.atan2(_wp2.crossVectors(_wp5, _wp6).dot(_wp4), _wp5.dot(_wp6)),
      -ELBOW.swivel, ELBOW.swivel);
    /**
     * …AND AN ELBOW DOES NOT TELEPORT ROUND THE ARM EITHER, which is the same
     * lesson `FOREARM.rate` is, one joint further up and found the same way.
     * Uncapped, this took the forearm ratchet from 2487 to 3538 °/s — the
     * wrist-implied elbow crosses the chest pole's own side and the whole limb
     * snaps through. The carried angle is the swivel this arm is holding
     * RELATIVE TO the chest pole, which is a well-defined quantity while the
     * chest pole moves; limiting how fast it changes is what makes the elbow
     * roll round rather than jump.
     */
    if (st.have) {
      let d = phi - st.phi;
      while (d > Math.PI) d -= 2 * Math.PI;
      while (d < -Math.PI) d += 2 * Math.PI;
      phi = st.phi + clamp(d, -ELBOW.rate * dt, ELBOW.rate * dt);
    }
    st.phi = phi; st.have = true;
    _wp5.applyAxisAngle(_wp4, phi);
    return pole.copy(shoulder).addScaledVector(_wp5, len);
  }

  _updateBody(dt, ctx) {
    const rig = this.rig;

    // Spine FIRST. It is an ancestor of chest -> clavicle -> arm, so rewriting
    // it after the arms have been IK'd to world-space grip points drags the
    // solved hands straight off the hilt — measured up to 18cm at the clamp
    // limits, on exactly the fast swings where this layer is most active.
    const spine = rig.get('spine');
    const A = this.attack;
    if (spine) {
      const w = this.control.angVel;
      let twist = clamp(-w.y * 0.026, -0.32, 0.32);
      let lean = clamp(this.control.handVel.dot(_v1.set(Math.sin(this.facing), 0, Math.cos(this.facing))) * 0.012, -0.2, 0.2);
      // A power moves the whole body, not just the arm. Added on top of the
      // blade's own lean rather than replacing it, so a push thrown mid-swing
      // keeps the swing's weight and gains the push's.
      const g = GESTURES[this.gesture.kind];
      if (g) { lean += g.lean * this.gesture.env; twist += g.twist * this.gesture.env; }
      /**
       * AND SO DOES AN ATTACK — note 23, and this is the half of it a camera
       * can see. Added the same way a gesture is, so a stab thrown out of a
       * swing keeps both.
       *
       * The overhead's arc is NEGATED: `swingArc` is positive when the blade is
       * chambered above the head, and a chambered body is arched BACK, so the
       * spine's forward lean runs opposite to it. Through the cut the arc goes
       * to −1.08 and the same term folds the trunk 21 degrees forward over the
       * blade. Measured across the whole swing: 1.0 degrees of spine before
       * this, 37.9 after.
       */
      lean += -A.over * SPINE_OVER + A.lunge * SPINE_LUNGE;
      twist += A.lunge * SPINE_LUNGE_TWIST;
      /* THE CUT AND THE TURN. A cut across the body is mostly axial rotation
       * and a little fold; a spin is a lean into the turn. Added the same way
       * everything else here is added, so a cut thrown out of a spin keeps
       * both — which is what makes the pair compose instead of switching. */
      lean += -A.slash * SPINE_SLASH + A.spin * SPINE_SPIN;
      twist += -A.slashX * SPINE_SLASH_TWIST - A.spinSide * A.spin * SPINE_SPIN_TWIST;
      spine.obj.quaternion.copy(spine.restQuat)
        .multiply(_q1.setFromEuler(_eulA.set(lean, twist, 0, 'XYZ')));
    }
    /**
     * THE SHOULDER, which had exactly zero degrees in it.
     *
     * A shoulder is most of what reads as commitment: an overhead chambers by
     * lifting the whole girdle and lands by driving it down and through, and a
     * fencing lunge is very largely scapular protraction — the sword shoulder
     * travelling forward is what makes the arm look long. Measured before this,
     * over the entire attack: 0.0 degrees of clavicle on both, and 9 mm of
     * shoulder-JOINT travel on the overhead against the 9 mm an idle body
     * breathes. After: 33.3 degrees and 187 mm.
     *
     * THIRD PERSON ONLY, and that is not laziness. In first person the
     * clavicles are the viewmodel's own weld — `_anchorViewArms` pins them to a
     * fixed point in the aim frame every frame precisely so the arms cannot
     * swim against the view, and it runs after this. Driving them there would
     * fight that solve and put the swim back; first person gets the body
     * through `attack.shift` on the anchor instead, which is what actually
     * moves in the frame you are looking down. Measured: the first-person
     * shoulder joint still travels 8 mm through an attack, i.e. the weld holds.
     *
     * The off shoulder counter-rotates at a fraction, because a torso is one
     * piece: the girdle turns about the spine rather than one end of it moving
     * on its own.
     *
     * Written EVERY third-person frame rather than only while an attack runs. A
     * conditional here leaves the girdle frozen at whatever the last frame of
     * the swing happened to be, because nothing else in the game writes a
     * clavicle — the skeleton gives them a rest direction and the animator
     * swings `armR`/`armL` below them. At zero drive `setFromEuler(0,0,0)` is
     * exactly the identity and `q.multiply(identity)` returns `q` bit for bit,
     * so an idle third-person figure is the same figure it was.
     */
    if (!this.camera.firstPerson) {
      /**
       * (While here: the Y term below is INERT, and nothing in the tree knew.
       * Measured on the real rig, 0.25 rad about a clavicle's local axes moves
       * the shoulder JOINT: X carries it 22 mm FORWARD, Z carries it 32 mm UP,
       * and Y moves it 0.000 m in every direction because Y runs ALONG the
       * bone. So `CLAV_YAW` has never moved anything, and the note over it has
       * the two live axes the wrong way round — it is X that protracts and Z
       * that elevates, not the other way about. Left in place rather than
       * deleted: removing it changes nothing that can be measured, and the
       * attack's read is somebody's next measurement rather than this one's.)
       */
      /* The cut and the spin drive the SAME axis the overhead and the lunge
       * drive — X, the one the paragraph above proves is protraction — because
       * a shoulder thrown across the body and a shoulder thrown round it are
       * the same joint doing the same thing. `slashX` is signed, so the girdle
       * leads the stroke one way and follows it back the other. */
      const drive = A.over * CLAV_OVER + A.lunge * CLAV_LUNGE
        - A.slashX * CLAV_SLASH - A.spinSide * A.spin * CLAV_SPIN;
      for (const [name, side] of CLAV_DRIVE) {
        const b = rig.get(name);
        if (!b) continue;
        b.obj.quaternion.copy(b.restQuat)
          .multiply(_q1.setFromEuler(_eulA.set(drive * side, A.lunge * CLAV_YAW * side, 0, 'XYZ')));
      }
    }
    rig.updateMatrices();

    // arms to the hilt
    // A gesture takes the off hand off the hilt without touching the blade's
    // grip model — see the note in _readInput on why those are separate.
    /**
     * THE POSE FOLLOWS THE HAND COUNT, AND THE HAND COUNT IS NOT THE CAMERA'S.
     *
     * `handsOnHilt` is the whole of the decision and it names every fact it
     * reads; there is no second copy of it here and there is no per-camera
     * boolean. What used to stand in this line was `… && (!firstPerson ||
     * settings.fpHands === 'two')`, so a player who was demonstrably holding
     * the hilt with both hands watched one of them let go when they pressed
     * the view key — and the options screen carried a card row that could put
     * a fist back onto a hilt the game had just taken a hand off.
     *
     * WHAT IT COSTS IN FIRST PERSON IS THE HILT, and it is measured rather
     * than argued (tools/checks/first-person.mjs, "how many hands are on the
     * hilt is what you see"): at half a metre from the lens ONE fist leaves
     * 32% of the shaft behind a glove and TWO leave 65%. That is not a defect
     * to be tuned out — two closed hands are 180 mm of the 233 mm of shaft
     * this samples, so 65% is most of what two fists on a hilt can possibly
     * leave visible. The player who wanted both grips modelled has the clear
     * view one keypress away, on the key that means what it does everywhere
     * else in the game: the one-hand grip.
     *
     * Nothing about the blade's grip MODEL is decided here — `control.grip` is
     * read and never written — so neither reach, stiffness nor inertia moves
     * with the arms. See GRIPS in SaberController.
     */
    const hands = this.handsOnHilt();
    const twoHanded = hands === 2;
    // In first person the arms hang off the VIEW, not off the ribcage, and
    // `chest` — which is the frame every elbow pole below is built in — becomes
    // the point midway between the two viewmodel shoulders. See _anchorViewArms.
    const chest = this.camera.firstPerson
      ? this._anchorViewArms(_v1) : rig.worldPos('chest', _v1);

    /* …and the same reader decides WHETHER there is a hilt in a hand at all,
     * rather than a second spelling of two of its clauses. It read
     * `throwState === 'held' && !saberDown` here, which is `handsOnHilt() > 0`
     * with the driving clause missing — HANDOFF §2.4. */
    if (hands > 0) {
      const fp = this.camera.firstPerson;
      /* GRIP_AT IS A PLACE ON THE HILT, so it moves with the hilt. The offsets
       * are in the saber ROOT's frame and `setGripScale` scales the hilt group
       * inside it, so an unscaled +0.050 on a hilt whose metal now ends at
       * +0.063 puts the fist on the emitter face. One multiply keeps the two
       * fists where the spec says they are — on the grip section — at any size,
       * and it is 1 for every full-sized wielder in the game. */
      const gs = this.saber.gripScale ?? 1;
      /* A SECOND FIST IN FIRST PERSON GOES BELOW THE FIRST, NOT ABOVE IT.
       * `fpGripOn` is the ONE place that knows where a viewmodel fist may sit
       * without hanging over the emitter (hilt floor + FIST_CLEAR), so the
       * two-handed variant keeps that as the LEADING hand and stacks the off
       * hand one fist-width further down the shaft — rather than reusing the
       * third-person pair, whose upper fist is 12 cm nearer the blade and put
       * a glove across the emitter at 0.5 m from the lens. */
      const fpPair = fp && twoHanded ? FP_HAND_GAP * 0.5 : 0;
      /* …AND THE THIRD-PERSON FIST MOVES TOO WHEN IT IS THE ONLY ONE. First
       * person already had a grip of its own for one hand and third person did
       * not: it held `GRIP_AT.R`, which is the top half of a two-handed pair,
       * with the whole lower grip section empty under it. See `GRIP_AT.ONE`. */
      const fpR = fp ? fpGripOn(this.saber) + fpPair : (twoHanded ? GRIP_AT.R : GRIP_AT.ONE);
      const gripR = this.saber.root.localToWorld(_v2.set(0, fpR * gs, 0));
      const gripL = this.saber.root.localToWorld(
        _v3.set(0, (fp ? fpR - FP_HAND_GAP : GRIP_AT.L) * gs, 0));
      /**
       * THE WRIST IS NOT THE GRIP. See GRIP_BORE.
       *
       * These two points are on the hilt's axis, which is where the BORE of the
       * closed hand has to land — not where the wrist joint goes. Solving the
       * arm straight to them put the wrist on the axis and the hilt through the
       * middle of the palm. The wrist is one bore-offset back from it, in the
       * hand's own frame, which is the hilt's frame turned a quarter about its
       * roll.
       */
      this.saber.root.getWorldQuaternion(_q1);
      // `rig.scale` and not `stature`: the bore is a place inside the HAND, and
      // buildHand is called with the body scale. See handPoseOnHilt.
      const hs = rig.scale ?? 1;
      /**
       * IN FIRST PERSON THE HAND GOES UNDER THE HILT, NOT IN FRONT OF IT.
       *
       * Note #10: "1st person pov hand gripping the saber it's like a really
       * weird reverse backwards grip it looks really dorky."
       *
       * `handPoseOnHilt`'s free axis — where round the hilt the fist sits — is
       * solved as "the side the arm arrives from", which is exactly right in
       * third person and is the whole defect here. In first person the arm
       * arrives from BEHIND THE LENS, so the solve dutifully puts the fist
       * between the camera and the weapon: measured with `tools/_fpgeom.mjs`,
       * the hand sits 87 mm nearer the eye than the hilt and hides 35% of it,
       * and what you are looking at is the back of your own glove with a grip
       * somewhere behind it. That reads as holding the thing backwards.
       *
       * A real one-handed sabre guard in your own eyeline is held from
       * UNDERNEATH and slightly outboard: you see the inside of the wrist, the
       * fingers wrapped round the grip, and the hilt clear above the fist.
       * That is a direction, so it is passed as one — down and to the sword
       * side, in the CAMERA's frame rather than the world's so it stays right
       * when you look up or down.
       *
       * Third person is untouched: the arm-direction solve is correct there
       * and has a sweep behind it (see `handPoseOnHilt`'s own note).
       */
      /**
       * IN FIRST PERSON THE HAND GOES UNDER THE HILT. Note #10: "1st person
       * pov hand gripping the saber it's like a really weird reverse backwards
       * grip it looks really dorky."
       *
       * MEASURED, because "reverse" is a claim about geometry and the thumb
       * turned out to be innocent. `handPoseOnHilt` forces the thumb up the
       * blade and it does: thumb·blade reads 1.00. What is reversed is the
       * FREE axis — where round the hilt the fist sits — and in first person
       * the shipped solve is the only orientation of eight that puts the wrist
       * ABOVE the grip point:
       *
       *     candidate        wrist relative to the grip, in camera space
       *                        right      up      toward the eye
       *     arm (shipped)      0.019   +0.055        0.042
       *     camera up          0.065   −0.030       −0.005
       *     camera up+right    0.043   −0.051       −0.025
       *     camera right      −0.035   −0.047       −0.041
       *
       * A hand hanging over the top of a hilt with the blade coming out of the
       * far side of the fist is an icepick grip. That is what "reverse
       * backwards" describes and it is what the numbers say.
       *
       * The cause is that the free axis is solved as "the side the arm arrives
       * from", which is right in third person and meaningless here: the
       * viewmodel shoulder is 32 cm below the LENS, so the direction from it
       * to a hilt held up in front of you points up and forward — and the
       * wrist is placed one bore-offset back along that, i.e. over the top.
       *
       * `up + right` in the CAMERA's frame instead, so a right hand comes up
       * under the grip from the outboard side: wrist 5 cm below the hilt and
       * 2.5 cm behind it, the fingers wrapping up and across, and the whole
       * emitter section standing clear above the fist. Third person is
       * untouched — the arm solve is correct there and has its own sweep
       * behind it.
       */
      /* …AND THE ROLL IS THE GRIP'S, NOT THE VIEW'S. One fist on a shaft and
       * two fists on it come round it from different places — see the sweep
       * over FP_TUNE, where the value that is best for two hands is the WORST
       * row in the one-handed column. */
      const fpRoll = FP_TUNE.roll[twoHanded ? 'two' : 'one'];
      if (fp) {
        _v10.set(FP_GRIP_SIDE, 1, 0).normalize().applyQuaternion(this.camera.aimQuat);
        /* …AND THEN ROLLED ROUND THE SHAFT. `toward` fixes where the fist sits
         * on the circle about the hilt, and up-and-inboard is only one point on
         * it. See FP_TUNE for the sweep this is picked from. */
        if (fpRoll) {
          _v10.applyAxisAngle(_v9.set(0, 1, 0).applyQuaternion(_q1), fpRoll);
        }
      } else {
        _v10.subVectors(gripR, rig.worldPos('armR', _v9));
      }
      handPoseOnHilt('R', _q1, _v10, _q2, _v9, hs);
      const wristR = _v7.copy(gripR).add(_v9);
      /* The off hand takes the SAME free axis in first person, mirrored: the
       * whole reason the shipped one-hand solve reads as an icepick is that
       * "the side the arm arrives from" is meaningless behind the lens, and
       * that is no less true of the left arm. Mirroring keeps both fists
       * coming up under the shaft from their own side instead of one of them
       * reaching over the top. */
      /* THE OFF HAND TAKES THE SAME ROLL AS THE LEADING ONE and always did
       * not: `FP_TUNE.roll` was applied to the right hand and skipped here, so
       * the two fists sat 60° apart round the shaft on top of the 119.6° the
       * frame construction was already splitting them by. Both halves of that
       * are gone — see handPoseOnHilt — and this reads the same knob the
       * leading hand reads, mirrored only in the side the arm comes from. */
      if (fp) {
        _v10.set(-FP_GRIP_SIDE, 1, 0).normalize().applyQuaternion(this.camera.aimQuat);
        if (fpRoll) {
          _v10.applyAxisAngle(_v9.set(0, 1, 0).applyQuaternion(_q1), fpRoll);
        }
      } else _v10.subVectors(gripL, rig.worldPos('armL', _v9));
      handPoseOnHilt('L', _q1, _v10, _q3, _v9, hs);
      const wristL = _v8.copy(gripL).add(_v9);
      const fwd = _v4.set(0, 0, -1).applyQuaternion(this.camera.aimQuat);
      const right = _v5.set(1, 0, 0).applyQuaternion(this.camera.aimQuat);

      // Elbow poles track which side of the body the hands are actually on. A
      // pole pinned to the right of the chest folds the right elbow straight
      // through the ribs the moment the guard crosses to the left — which is
      // most of what read as the body overlapping itself.
      /* AN ELBOW POLE IS AN ARM'S LENGTH FROM THE CHEST, so every constant from
       * here to the end of this block is one of the three scales — this one —
       * and not a free number. A pole 0.75 m out from a chest whose arm is
       * 0.23 m long is not "to the side of the shoulder", it is a point in the
       * next postcode, and solveIK aims the whole limb at it. See limbScale. */
      const A = this.limbs.arm;
      const side = clamp(_v6.subVectors(this.control.handPos, chest).dot(right) * 1.3, -0.62 * A, 0.62 * A);
      /**
       * ── THE LIFT COULD RISE FOUR TIMES FURTHER THAN IT COULD FALL ────────
       *
       * The clamp was `[-0.10A, +0.42A]`. With a 0.285 m upper arm that is
       * 12 cm of travel up against 3 cm down, so the elbow basin spent almost
       * all of its range climbing: at full lift `poleR` sits only 9 cm under
       * the chest, and a pole level with the shoulder is a pole `solveIK` aims
       * the whole upper arm at. That is the chicken wing — "the right
       * arm/shoulder when holding the lightsaber with 2 hands looks abnormal,
       * it's like you're constantly holding it up with your elbow raised".
       *
       * It is now `[-0.30A, +0.18A]` — still able to follow a high guard, but
       * the basin can drop for a low one instead of merely failing to rise, and
       * the top of the range no longer reaches shoulder height. A raised elbow
       * is a real pose a high parry wants; it was the RESTING pose that was
       * wrong.
       */
      const lift = clamp(_v6.subVectors(this.control.handPos, chest).dot(UP) * 0.5, -0.30 * A, 0.18 * A);

      /* AND A SECOND HAND ON THE HILT PULLS THE RIGHT ELBOW DOWN AND IN.
       *
       * Both poles were built from one basin, and `side`/`lift` are computed
       * from the PRIMARY hand — so in a two-handed grip the off arm was steered
       * by the right hand's position and the right arm got no acknowledgement
       * that it was no longer holding the weapon alone. Bringing a second hand
       * onto a hilt in front of your chest physically drops and tucks the
       * driving elbow; a quarter of an arm down and a fifth in is that, and it
       * is applied only while the grip is actually two-handed so the one-handed
       * pose is bit-for-bit what it was. */
      const tuck = twoHanded ? A : 0;
      const poleR = _v6.copy(chest).addScaledVector(right, 0.75 * A + side - 0.20 * tuck)
        .addScaledVector(UP, -0.75 * A + lift - 0.25 * tuck).addScaledVector(fwd, -0.2 * A);
      this._wristPole('armR', 'foreR', 'handR', _q2, wristR, poleR, dt);
      rig.solveIK('armR', 'foreR', wristR, poleR);
      this._rollForearm('foreR', 'handR', _q2, dt);
      if (twoHanded) {
        const poleL = _v6.copy(chest).addScaledVector(right, -0.62 * A + side)
          .addScaledVector(UP, -0.8 * A + lift).addScaledVector(fwd, -0.2 * A);
        this._wristPole('armL', 'foreL', 'handL', _q3, wristL, poleL, dt);
        rig.solveIK('armL', 'foreL', wristL, poleL);
        this._rollForearm('foreL', 'handL', _q3, dt);
      } else {
        // handL's local quaternion is force-set while two-handed; nothing put it
        // back, so switching to one hand left it frozen 167 degrees off rest.
        const hl = rig.get('handL');
        if (hl) hl.obj.quaternion.copy(hl.restQuat);
        // Rest is the hip. Everything the Force does moves the hand off it —
        // this used to be a single `gripBody ? 0.55 : -0.05` reach that only
        // applied while the one-hand key was ALSO held, so in practice no power
        // in the game had a visible arm.
        /**
         * …EXCEPT IN FIRST PERSON, WHERE THE HIP IS BEHIND THE CAMERA.
         *
         * The third-person rest drops the hand along WORLD up, and in first
         * person `chest` is the viewmodel anchor 0.115 m in front of the lens.
         * At a level gaze that already puts the wrist only 65 mm in front of a
         * 45 mm near plane; look UP 63 degrees and world-up acquires a −0.55 m
         * component along the view axis, so the whole off arm goes BEHIND the
         * eye and is sliced open by the camera. That is the elbowL failure the
         * two-handed grip was hiding, and it arrives the moment the off hand
         * stops being pinned to the hilt.
         *
         * So the off hand gets a rest expressed in the AIM frame, exactly like
         * every other part of the viewmodel: fixed in view space at every pitch,
         * low and to the left, and far enough forward that the whole chain
         * clears the near plane. Measured after: nearest arm joint 197 mm at a
         * level gaze and 174 mm looking up, against the 100 mm the deltoid
         * needs. It hangs below the frame the way the reference's does — the
         * off hand is not part of the picture, and that is the point.
         */
        const up = _v9.set(0, 1, 0).applyQuaternion(this.camera.aimQuat);
        /* THE OFF ARM IS HALF OF "BOTH ARMS IN THE AIR". Its rest is the hip,
         * expressed as a reach from the chest — so on the small frame an
         * unscaled 0.62 m drop is nearly three times the arm, the IK cannot get
         * there either, and the idle off hand stands out from the body pointing
         * at the floor instead of hanging by it. Scaled, it lands on the hip it
         * names. First person is a viewmodel and is scaled for the same reason:
         * `chest` is the view anchor and everything off it is this arm. */
        const rest = fp
          ? _v6.copy(chest).addScaledVector(right, -0.20 * A).addScaledVector(up, -0.30 * A)
            .addScaledVector(fwd, 0.20 * A)
          : _v6.copy(chest).addScaledVector(right, -0.34 * A).addScaledVector(UP, -0.62 * A)
            .addScaledVector(fwd, -0.05 * A);
        const poleL = fp
          ? _v2.copy(chest).addScaledVector(right, -0.62 * A).addScaledVector(up, -0.34 * A)
            .addScaledVector(fwd, 0.10 * A)
          : _v2.copy(chest).addScaledVector(right, -0.85 * A).addScaledVector(UP, -0.7 * A);
        const palm = this._gesturePose(rest, poleL, chest, fwd, right);
        rig.solveIK('armL', 'foreL', rest, poleL);
        // Wrist AFTER the IK: solveIK writes armL and foreL, and the hand hangs
        // off the end of both.
        if (palm) rig.aimBoneWorld('handL', palm, right);
      }
      // THE WRIST IS SET TO AN ARBITRARY ORIENTATION, AND THAT IS A REAL DEFECT.
      //
      // The hand's world quaternion is copied straight off the hilt, so the
      // wrist absorbs the entire difference between the roll solveIK gave the
      // forearm and the roll the blade wants. Measured through a real
      // mouse-driven slash: the wrist reaches 179.7 degrees from its own rest
      // pose. A human wrist bends about 80 and rolls about 30. At the extremes
      // of a swing this hand is folded completely backwards.
      //
      // Moving the roll onto the forearm — the anatomically right answer, since
      // pronation is a forearm motion and not a wrist one — was implemented,
      // MEASURED, AND REMOVED. It took the worst wrist deviation only from
      // 179.7 to 157.4 degrees, both of which are impossible, and it took the
      // forearm's own peak angular rate from 6874 deg/s to 10653: the required
      // twist passes +/-180, the swing-twist decomposition wraps there, and the
      // bone snapped between its anatomical limits frame to frame. Spinning
      // faster is not the fix.
      //
      // The 6874 deg/s the forearm ALREADY turns at is the other half of it and
      // is not the wrist's doing: solveIK rolls the lower bone with aimY against
      // the elbow pole, and aimY substitutes a fixed reference whenever the two
      // come within 10 degrees of parallel — which snaps the roll by up to 90
      // degrees in the middle of a swing. Measured: it fires on 7 frames of 210,
      // isolated spikes, and nothing below touches it.
      //
      // ── SECOND ATTEMPT, ALSO MEASURED, ALSO REMOVED ──────────────────────
      //
      // Redistributing the twist properly this time — decomposed in the
      // FOREARM's frame about the axis the roll actually turns about, twist-
      // first because a forearm roll arrives pre-multiplied, and unwrapped
      // against the previous frame so +/-180 cannot snap it. All three of those
      // were wrong or missing in the first attempt. Splitting the wrist's
      // deviation apart shows why it looked like the answer:
      //
      //        BEND   median 37.4  p90 110.4  max 145.6   past 80: 43/210
      //        ROLL   median 81.5  p90 151.9  max 179.7   past 30: 197/210
      //
      // Roll dominates, so pronation IS the right lever for it, and cancelling
      // all of it works: roll median 81.5 -> 6.0, total p90 164.8 -> 110.9,
      // max 179.7 -> 156.4, frames past 80 166 -> 121.
      //
      // It still does not ship, for two reasons that are the whole finding.
      // Cancelling all the roll needs 172 degrees of forearm pronation, and a
      // real forearm has about 150 through its ENTIRE range; at any anatomical
      // limit (75-120 deg) the result is WORSE than doing nothing, median 106
      // to 120 against 90.3, because a partly-cancelled roll adds to the bend
      // instead of opposing it. And with the roll gone entirely the BEND alone
      // is still past 80 degrees on 43 frames of 210.
      //
      // No amount of roll can change that bend. It is the angle between the
      // forearm's direction — which solveIK picks purely from where the grip
      // POINT is — and the hilt's axis. So the fix is not a limit and not a
      // redistribution: the arm has to be solved from the grip's ORIENTATION as
      // well as its position, so the forearm arrives already pointing somewhere
      // a wrist can finish from. That is a real solver change and it is worth
      // doing; what is written down here is that the two cheaper answers have
      // both now been measured and neither one is it.
      // …in the orientation handPoseOnHilt already worked out above, which is
      // the hilt's turned a quarter about its roll so the bore lies ALONG the
      // blade instead of the fingers pointing down it. See GRIP_BORE.
      for (const [h, want] of twoHanded ? [['handR', _q2], ['handL', _q3]] : [['handR', _q2]]) {
        const b = rig.get(h);
        if (!b || !b.obj.parent) continue;
        b.obj.parent.getWorldQuaternion(_q4);
        b.obj.quaternion.copy(_q4.invert()).multiply(want);
      }
    } else {
      // Either the saber is in flight — the throwing hand stays extended,
      // calling it back — or the hand is EMPTY, in which case it must not:
      // reaching out at nothing for as long as you are disarmed is the pose of
      // a player permanently recalling a blade they no longer own. An empty
      // sword hand rests where the off hand does, mirrored, and that is the
      // whole visual difference between armed and disarmed on the third-person
      // figure. See `disarmed`.
      const fwd = _v4.set(0, 0, -1).applyQuaternion(this.camera.aimQuat);
      const right = _v5.set(1, 0, 0).applyQuaternion(this.camera.aimQuat);
      const reach = this.saberDown
        ? _v6.copy(chest).addScaledVector(right, 0.32).addScaledVector(UP, -0.58).addScaledVector(fwd, 0.04)
        : _v6.copy(chest).addScaledVector(fwd, 0.55).addScaledVector(right, 0.22).addScaledVector(UP, 0.05);
      rig.solveIK('armR', 'foreR', reach, _v2.copy(chest).addScaledVector(right, 0.8).addScaledVector(UP, -0.6));
      if (this.saberDown) {
        // and the wrist goes back to its own rest, or it keeps whatever roll
        // the grip solve last forced on it — the same defect the one-hand
        // branch above records for handL.
        const hr = rig.get('handR');
        if (hr) hr.obj.quaternion.copy(hr.restQuat);
      }
      const rest = _v6.copy(chest).addScaledVector(right, -0.3).addScaledVector(UP, -0.6);
      const poleL = _v2.copy(chest).addScaledVector(right, -0.8).addScaledVector(UP, -0.7);
      // The off hand still answers to the Force with the blade away — and the
      // saber throw's own gesture lives here, since throwState leaves 'held' on
      // the frame it fires and this is the only branch that runs afterwards.
      const palm = this._gesturePose(rest, poleL, chest, fwd, right);
      rig.solveIK('armL', 'foreL', rest, poleL);
      if (palm) rig.aimBoneWorld('handL', palm, right);
    }

    // Both branches above turn the WRIST and nothing else. The fingers are the
    // other half of the gesture and they live here — see _openPalm.
    this._openPalm();

    // Head: a limited glance toward the aim, layered on the rest pose. The head
    // bone's +Y runs up through the skull and its face is +Z, so the old code —
    // which aimed +Y at the blade tip — laid the head over sideways every time
    // the blade moved. It read as a snapped neck, not a look.
    const head = rig.get('head');
    if (head && head.obj.parent) {
      head.obj.parent.getWorldQuaternion(_q1);
      _q1.multiply(head.restQuat);                      // rest orientation, in world
      _v1.copy(this.aimDir).applyQuaternion(_q1.invert());
      // Shortest arc, then clamp. Raw atan2 jumps +pi -> -pi when the aim
      // passes directly behind the head, which whipped the head 97 degrees
      // across the front every time facing diverged from the camera.
      let yaw = Math.atan2(_v1.x, _v1.z);
      let d = yaw - (this._headYaw ?? 0);
      while (d > Math.PI) d -= TAU;
      while (d < -Math.PI) d += TAU;
      yaw = clamp((this._headYaw ?? 0) + d, -0.85, 0.85);
      const pitch = clamp(Math.asin(clamp(_v1.y, -1, 1)), -0.5, 0.42);
      this._headYaw = damp(this._headYaw ?? 0, yaw, 11, dt);
      this._headPitch = damp(this._headPitch ?? 0, pitch, 11, dt);
      head.obj.quaternion.copy(head.restQuat)
        .multiply(_q2.setFromEuler(new THREE.Euler(-this._headPitch, this._headYaw, 0, 'YXZ')));
    }
    rig.updateMatrices();

    // the cloak hangs off the finished pose, and feels the wind and the run —
    // computed outside the branch because the hood's fall below reads it too
    _v1.set(0, 0, 0).addScaledVector(this.velocity, -0.85);
    _v1.x += Math.sin(ctx.time * 0.7) * 1.1;
    _v1.z += Math.cos(ctx.time * 0.53) * 1.1;
    if (this.cloak) {
      // SKIRT FIRST: the cape's collider proxy is the skirt's own particles, so
      // stepping the cape first would have it dodging where the skirt was last
      // frame.
      /**
       * FIRST PERSON KEEPS ITS ROBE, AND KEEPS IT AS CLOTH.
       *
       * This was `setVisible(!firstPerson)`, and the second thing that call
       * does is bring the RIGID layer back in the cloth's place — see the note
       * on it in Cloth.js. So the view the game is mostly played in was the
       * one view that still had the cone in it: four meshes, 904 triangles,
       * shown only in first person, with the under-robe's hem travelling
       * 0.0 mm across a jump while the knee travels 1474 mm. The first-person
       * mesh hide covers neck, head, chest and clavicles, so the legs are
       * drawn — behind it.
       *
       * The robe simply stays on. All 140 of its particles are below the eye
       * and the nearest sits 0.665 m from the camera against a 0.045 m near
       * plane, so it cannot clip the view, and one garment set is a fraction
       * of a millisecond. Looking down at your own moving robe is the correct
       * answer as well as the cheap one.
       *
       * The CAPE is different and stays hidden: it hangs behind the shoulders,
       * where a first-person camera cannot see it, so simulating it would be
       * paying for nothing. `false` for `standIn` is the whole point — hidden
       * means hidden, not swapped for a cylinder.
       */
      if (this.skirt) {
        this.skirt.setVisible(true);
        this.skirt.update(dt, this.skirt.refreshColliders(), _v1);
      }
      this.cloak.update(dt, this.cloak.refreshColliders(), _v1);
      this.cloak.setVisible(!this.camera.firstPerson, false);
    }
    /* THE HOOD'S FALL, on the same finished pose and the same wind. Hidden in
     * first person for the cape's reason and not the head's: it hangs behind
     * the shoulders where this camera cannot see it, so simulating it there is
     * paying for nothing. `_applyViewMode` already hides the rigid shell by
     * traversing the neck; this is not under that bone, so it needs its own. */
    if (this.hoodDrape) {
      if (this.camera.firstPerson) this.hoodDrape.setVisible(false);
      else {
        this.hoodDrape.setVisible(true);
        this.hoodDrape.update(dt, this.hoodDrape.refreshColliders(), _v1);
      }
    }
  }

  _updateCamera(dt, ctx) {
    const s = this.world.settings;
    this.camera.fovTarget = s.fov + clamp(Math.hypot(this.velocity.x, this.velocity.z) - 4.6, 0, 4) * 1.6
      + (this.dashTimer > 0 ? 7 : 0);
    this.camera.rollTarget = clamp(-this.control.angVel.y * 0.006, -0.05, 0.05);
    this.camera.update(dt, this.position, {
      physics: ctx.physics, terrain: ctx.terrain, eyeHeight: lerp(1.62, 1.22, this.crouch),
      // The whole pelvis, not the bob and not half of it. _updateBody runs
      // before this, so `pelvis` is this frame's, not last frame's.
      pelvis: this.animator?.pelvis,
    });
  }

  /**
   * Force economy, in one place.
   *
   * `forcePower` scales how hard every power hits; `forceDrain` scales what it
   * costs, and at 0 it costs nothing at all. Both are player-facing settings —
   * this is a power fantasy, and someone who wants to spend an afternoon
   * throwing rocks around should not have to fight a resource meter for it.
   */
  get forceScale() { return this.world.settings?.forcePower ?? 1; }
  _spend(cost, partial = false) {
    const drain = this.world.settings?.forceDrain ?? 1;
    if (drain <= 0) return true;                   // unlimited
    const c = cost * drain * this.boonMods.forceCost;
    if (this.force < c) {
      /* A SUSTAINED DRAIN TAKES WHAT IS LEFT AND SAYS SO, which a one-shot
       * must not: refusing a per-frame charge outright would let a channel run
       * for ever on the last 0.4 Force in the pool, because the frame's charge
       * is small enough to be refused for ever without the pool moving. Only
       * `Player._lightningTick` passes true, and this is the same shape
       * `_regen`'s Sense hold already uses. */
      if (!partial) return false;
      this.force = 0;
      return false;
    }
    this.force -= c;
    return true;
  }
  /**
   * WHY A FORCE KEY DID NOTHING.
   *
   * The player reported "force lightning does nothing when pressed", and it was
   * true, and the reason is one this codebase already has a name for: the key
   * is in ACTIONS, printed in the Codex, listed on the pause card — and
   * `forceLightning` opens with three silent `return`s. Not attuned, not enough
   * Force, still recovering: three different states, one indistinguishable
   * outcome, which is nothing at all happening. A bound key that does nothing
   * and does not say why is the same lie as a dead checkbox.
   *
   * The precedent is `TOO HEAVY` — a refused lift already names the mass, the
   * cap and the slider that moves it — and this is that everywhere else.
   *
   * Rate-limited per ability, because a held key is 60 refusals a second and a
   * notice that repeats is a notice that gets ignored.
   */
  _refuse(name, reason) {
    const now = this.world?.time ?? 0;
    const last = this._refusals || (this._refusals = new Map());
    if (now - (last.get(name) ?? -99) < 0.7) return false;
    last.set(name, now);
    this.world?.notify?.(name.toUpperCase(), reason);
    audio.ui('bad');
    return false;
  }

  /**
   * THE POWER SAYS SOMETHING — player note, 21 Aug, and it is the whole of it:
   *
   *   "the character should say something everytime he uses a particular force
   *    ability, perhaps he says the name of the attack, or maybe there's a pool
   *    of 3-4 things you can say for every force ability so it doesnt get stale
   *    and you hear the same thing over and over? i like the robotic voice
   *    sound things you do I never use the version where the computer says the
   *    actual words"
   *
   * ── WHERE THE CALL GOES, and it is not `audio.speak` ────────────────────
   *
   * Through the announcer, which already owns the budget that stops this game
   * babbling: one quip per QUIP_GAP whatever happens, and `say()` is the
   * FORCED door into it — a rate limit written to stop the game talking over
   * itself may not swallow a key the player pressed. It skips the gap and then
   * SETS it, so the kill line from whatever this power just threw waits its
   * turn instead of landing on top of the shout that threw it. `forceUnleash`
   * has taken exactly that route since it was written and its note says why;
   * this is that note applied to the other eleven powers.
   *
   * Under the announcer sits `AudioEngine.speak`'s own hard cap of three
   * concurrent utterances with the newest ducking the rest, and PRIO.critical,
   * which `opts.self` buys. Not one number of any of that is restated here.
   *
   * ── WHERE IT IS CALLED FROM, which is the part a refusal depends on ─────
   *
   * AFTER THE LAST REFUSAL, at every one of the twelve sites — one per entry
   * in `POWER_COST`, which is where tools/checks/force-voice.mjs derives its
   * census from — and that is the
   * whole of "a refused power must not produce a line". Every power in this
   * file opens with its refusals — not attuned, recovering, nothing in your
   * sights, too heavy, and `_refuse` quoting the price the gate really charges
   * — and each of them returns. The gate is `_spend` for the eight powers that
   * are billed and `_canSpend` for the three that are thresholds (sense, the
   * heal and the grip's first look), so this cannot be phrased as "after the
   * spend"; what it is, is after the last `return` in the method. A line
   * raised before one of those would be the player announcing something that
   * did not happen, which is worse than silence: it is the game lying about
   * its own state. Nothing at all is said on the OTHER half of a toggle — a
   * saber recalled, sense switched off, a grip let go, a stasis field fired —
   * for the same reason: none of them is a power going off.
   *
   * A HELD POWER SAYS IT ONCE. Lightning, the grip, the heal and the stasis
   * field are channels: they are OPENED here and then run from their own
   * per-frame tick, and the call is on the opening. `forceLightning` cannot
   * even be re-entered while its channel is up (`if (this.channel?.kind ===
   * 'lightning') return`), so "once per cast" is structural rather than a
   * timer — which is what stops a two-second channel being 120 lines.
   *
   * @returns true only if a line actually reached the engine.
   */
  _forceVoice(power) {
    /* THE SWITCH. Read live off the settings blob, like every other voice
     * control in the game, so unticking the box on the pause card is silent on
     * the very next power rather than on the next deploy. Default ON: the note
     * asked for this, and a feature the player asked for that ships off is a
     * feature they will never find. */
    if (this.world?.settings?.forceVoice === false) return false;
    const announcer = this.world?.hud?.announcer;
    if (!announcer) return false;
    /* WHICH of the pool, and never the one this power said last — the memory
     * is `AudioEngine.forceLine`, drawn off the one seeded stream the audio
     * engine keeps. See its note for why it is not in this file. */
    const line = audio.forceLine(power);
    return line ? announcer.say(this.world.settings, line, this.chest) === true : false;
  }

  /**
   * The colour the Force comes out at.
   *
   * One reader for three sites — the lightning arc, the plasma flash and the
   * stasis burst were three copies of `0x9fd8ff`, so a player who picked a
   * colour would have got it in one of the three and been left wondering about
   * the other two. That is the shape of bug this project keeps finding.
   */
  _lightningColor() { return this.world?.settings?.lightningColor ?? 0x9fd8ff; }

  _canSpend(cost) {
    const drain = this.world.settings?.forceDrain ?? 1;
    return drain <= 0 || this.force >= cost * drain * this.boonMods.forceCost;
  }

  /**
   * WHAT A POWER ACTUALLY COSTS HERE — the expression `_canSpend` evaluates.
   *
   * Eight refusals quoted the LIST price straight out of `POWER_COST`, and the
   * gate above charges `cost * forceDrain * boonMods.forceCost`. So the refusal
   * sentence disagreed with the refusal itself: on a default Jedi profile a
   * power priced at 20 is charged at 15.6 and the message still said 20, and at
   * Force Drain 2x the sentence reads "20 Force needed, you have 30" — a
   * refusal that looks like a bug in the arithmetic rather than a rule of the
   * game. Force lightning had already been fixed to do this by hand; this is
   * the same expression in one place, so the next power added cannot get it
   * wrong.
   */
  _priceOf(cost) {
    return Math.round(cost * (this.world.settings?.forceDrain ?? 1) * this.boonMods.forceCost);
  }

  /**
   * IS A CHANNEL HOLDING THE BAR OPEN — the one reader of the rule `_regen`
   * used to keep to itself.
   *
   * The rule is `_regen`'s own and its note says why it exists: a power that
   * refills the bar it is draining has no cost and therefore no decision in it.
   * It was a local `const` inside `_regen`, which made it a rule with exactly
   * one obeyer — and there are two writers of this pool's regeneration. The
   * other is `wellspringFlow` in src/game/Waves.js, a boon tick that adds
   * `7.5 × (forceRegen − 1)` a second and never asked. Measured on a real
   * World, net Force per second with a barrier up and nothing shooting:
   *
   *     no cards                      −4.25/s   (the price the power is made of)
   *     Wellspring                    −0.18/s   (96% of it cancelled, one common)
   *     Wellspring + Attunement ×4    +6.15/s   (a barrier that PAYS to hold)
   *     Attunement of the Force ×8    +6.26/s
   *
   * The last two are worse than the 2.82/s net gain the note above was written
   * to delete, and the same stack takes a held Force Sense — 22 a second, the
   * most expensive hold on the wheel — to +0.03/s, which is a power you leave
   * on for the rest of the run. Both cards are `stack: Infinity` epics offered
   * on every set-piece, so this is a late run rather than a corner.
   *
   * A getter rather than a second copy of the condition: the day a third
   * channel pauses regeneration, it is named here and every writer inherits it.
   */
  get forceChannelling() { return !!(this.senseActive || this.shield?.up); }

  _regen(dt) {
    const combatHot = this.world.combatIntensity ?? 0;
    /* THE BAR DOES NOT REFILL WHILE IT IS GOING OUT. See STAMINA_HOLD for the
     * 30 s sprint from empty that ended full, and for why the hold outlasts
     * the dash cooldown it is measured against. */
    if (this.staminaHold > 0) this.staminaHold = Math.max(0, this.staminaHold - dt);
    else this.stamina = Math.min(this.maxStamina, this.stamina + (16 + 10 * (1 - combatHot)) * dt * this.boonMods.staminaRegen);
    /* THE BARRIER PAUSES REGEN, exactly as Sense does, and it is not a second
     * price — it is what makes the first one real. Measured before this line
     * existed: a raised barrier with nothing shooting at it ran a NET GAIN of
     * 2.82 Force a second, because the 7.5 regen outran the 6 hold. A power
     * that refills the bar it is draining has no cost and therefore no
     * decision in it, and "how long can I afford to stand here" is the only
     * question this power asks. tools/checks/barrier.mjs measures the slope.
     * `forceChannelling` is the getter above; it was a local here, which is how
     * the boon that also writes this pool came to not know about it. */
    this.force = Math.min(this.maxForce, this.force + (this.forceChannelling ? 0 : 7.5) * dt);
    // Flow bleeds unless you keep earning it
    this.flow = clamp(this.flow - dt * 0.085, 0, 1);
    if (this.senseActive) {
      /**
       * THE POOL HAS A FLOOR AND THIS LINE WENT THROUGH IT. `force -= 22 * dt`
       * was unclamped and the shutdown below fires a frame AFTER the pool is
       * already under: measured -0.3333 at 1/60 from a full-price Sense, and a
       * 22-verb randomised fuzz across all nine levels turned up seven
       * negatives (-0.1405, -0.0110, -0.1170, -0.1529, -0.0721, -0.1038,
       * -0.0462). A negative pool is a HUD bar drawn below zero and a
       * `_canSpend` answered against a debt.
       *
       * …AND CLAMPING IT WAS HALF THE FIX. The clamp made the number legal; it
       * did not make it a PRICE. `Math.max(0, force - 22 * dt)` reads neither
       * the Force Drain slider nor `boonMods.forceCost`, so the one power in
       * `POWER_COST` whose bill is per-frame was the one power outside the
       * economy that gates it. Measured on a real World, holding Sense open
       * from a full bar under three different economies:
       *
       *     Force Drain 1 (default)           125 → 47.4, off at 5.67 s
       *     Force Drain 0 ("unlimited Force") 125 → 47.4, off at 5.67 s
       *     forceCost 0.05 (Tempest, flow 1)  125 → 47.4, off at 5.67 s
       *
       * Three economies, one answer. A player who sets Drain to 0 — the slider
       * whose own label in index.html reads "Drain at 0 is unlimited Force" —
       * gets eleven free powers and a Sense that still shuts itself off in
       * under six seconds, which reads as the toggle being broken rather than
       * as a rule. `_spend` with `partial` is what the lightning channel and
       * the barrier already do: it takes what is left and stops, it refuses to
       * overdraw, and at Drain 0 it charges nothing at all.
       */
      if (!this._spend(SENSE_DRAIN * dt, true)) this.toggleSense(this.world);
    }
  }

  addFlow(v) {
    this.flow = clamp(this.flow + v * this.boonMods.flowGain, 0, 1);
  }

  /* ── force powers: the shared laws ───────────────────────────────── */

  /**
   * The heaviest thing the Force can take hold of right now, in kilograms.
   * See LIFT_AT_ONE for why these two numbers are the numbers they are.
   */
  get liftCapacity() { return LIFT_AT_ONE * Math.pow(this.forceScale, LIFT_EXPONENT); }

  /** How far out the Force reaches to take hold of something, in metres. */
  get forceReach() { return 18 * Math.sqrt(this.forceScale); }

  /**
   * How briskly the Force moves a given mass: 1 for something it barely
   * notices, 0.28 for something right at the limit. Every lift, shove and throw
   * multiplies by this, and it is the whole reason mass is now visible at all.
   * It never reaches zero — a thing you can hold is a thing you can move, just
   * slowly, and a lift that stalls dead reads as a broken button.
   */
  _heft(mass) { return lerp(1, 0.28, clamp(Math.max(0, mass) / this.liftCapacity, 0, 1)); }

  /**
   * WHAT THIS THING WEIGHS IN FORCE, per second, before distance and wear.
   *
   * `HOLD_COST.base + rise × (mass / cap)` was typed out twice in `_updateGrip`
   * — once for a prop and once for a person, the only difference being which
   * half of `HOLD_COST` it read — and it is now needed a third and fourth time
   * by the contest, which must weigh a pull with the same number the bill is
   * built on or the two would drift. One expression, four readers.
   */
  _holdRate(mass, person) {
    const H = person ? HOLD_COST.person : HOLD_COST.prop;
    return H.base + H.rise * clamp(mass / this.liftCapacity, 0, 1);
  }

  /**
   * WHAT THIS HAND PULLS WITH, in the hp-per-second the whole Force contest is
   * priced in — the number `gripClaim` weighs against somebody else's. Two
   * terms, and neither of them is new.
   *
   *   THE MASS TERM is `_holdRate`: what the object weighs in Force. It is the
   *   same for both contestants, so it CANCELS out of the ratio between them
   *   and reaches the contest only through `forceResistance`'s
   *   `pool × RESIST_PER_FORCE` arm — a heavy thing drives both bars down
   *   towards where that arm starts binding, and the emptier bar slips first.
   *   Which is what fighting over a pillar ought to feel like.
   *
   *   `forceScale`, AND NOT `1/√forceScale`. The BILL divides by the root
   *   because a stronger Force user finds the same hold easier; a pull has to
   *   multiply, because he also pulls harder. Weighting a contest by what the
   *   hold COSTS — which is what reusing the bill's own `effort` would have
   *   done — hands every crate to whoever is weakest. Reach, capacity and the
   *   throw all read the slider this way round.
   *
   * The bill's distance and wear terms are deliberately absent. They are what a
   * hold costs YOU over time, and they already decide the contest through the
   * pool: hold it at arm's length for six seconds and yours is the bar that
   * empties. Folding them in as well would say that reeling an object towards
   * you makes you worse at holding it.
   */
  _gripPull(mass, person) { return this._holdRate(mass, person) * this.forceScale; }

  /**
   * Where an enemy's middle is, derived from its POSITION rather than from
   * Enemy.aimPoint.
   *
   * aimPoint reads the chest BONE's world matrix, which is (0,0,0) until that
   * enemy has been through one update — and the player runs before the enemies
   * do, so on the frame a wave spawns every Force power would have aimed at the
   * world origin. Position plus chest height is always true.
   *
   * THE HAZARD IS REAL AND THE SECOND OPINION WAS NOT THE ANSWER. This method
   * used to answer `position.y + 1.12 * A.scale`, a third statement of a height
   * the body already publishes — and it was `A.scale` rather than `bodyScale`,
   * which is precisely the bug `Enemy.chestY`'s own comment records: on a
   * smallfolk frame `A.scale` puts the chest 0.45 m above the top of the head.
   * So every Force power in the game reached for a point off the body of
   * anything whose rig rescaled it. `Enemy.chest` is the same position-derived
   * quantity, safe on the spawn frame for the same reason this note gives, and
   * `aimPoint` now falls back to it rather than answering from the origin — so
   * there is one number and no reader has to be careful.
   */
  /**
   * WHERE A HELD THING IS — bolt, loose body, or person.
   *
   * One expression, because there are two readers (the gesture's focus and the
   * field's own shimmer) and they went out of step the moment stasis learned to
   * hold people: the shimmer knew about `{enemy}` and the focus did not, and the
   * focus is the one on `world.update`'s path.
   */
  _heldPoint(h, out) {
    if (!h) return out.set(0, 0, 0);
    if (h.bolt) return out.copy(h.bolt.pos);
    if (h.enemy) return this._enemyPoint(h.enemy, out);
    return h.body ? out.copy(h.body.position) : out.set(0, 0, 0);
  }

  _enemyPoint(e, out) {
    return e.chest ? out.copy(e.chest) : out.copy(e.position);
  }

  /* ── gestures ────────────────────────────────────────────────────── */

  /**
   * Start an arm gesture. Sustained ones run until _endGesture.
   *
   * `at` is where the hand should point for a one-shot — captured NOW, because
   * a hurl's target has stopped existing as a held object by the time the arm
   * finishes travelling. Sustained gestures ignore it and track their subject
   * live instead; see GESTURES[].track.
   */
  _gesture(kind, at = null) {
    const g = GESTURES[kind];
    if (!g) return;
    this.gesture.kind = kind;
    this.gesture.t = 0;
    this.gesture.sustain = !!g.sustain;
    this.gesture.hasAt = !!at;
    if (at) this.gesture.at.copy(at);
  }

  /** Let a held gesture go; it falls back to rest over its own release time. */
  _endGesture(kind) {
    const G = this.gesture;
    if (!G.kind || (kind && G.kind !== kind) || !G.sustain) return;
    G.sustain = false;
    G.t = GESTURES[G.kind].attack;         // start the release from full extension
  }

  _advanceGesture(dt) {
    const G = this.gesture;
    const g = GESTURES[G.kind];
    if (!g) { G.env = 0; return; }
    G.t += dt;
    if (G.sustain || G.t <= g.attack) { G.env = smoothstep(0, g.attack, G.t); return; }
    G.env = 1 - smoothstep(g.attack, g.attack + g.release, G.t);
    if (G.t >= g.attack + g.release) { G.kind = ''; G.env = 0; }
  }

  /** What the current gesture is aimed AT, if it is aimed at anything. */
  _gestureFocus(out) {
    const g = GESTURES[this.gesture.kind];
    // A hold tracks its subject as it moves — the crate you are carrying does
    // not stay where it was when you picked it up.
    if (g && g.track) {
      if (this.gripBody) return out.copy(this.gripBody.position);
      if (this.gripEnemy) return this._enemyPoint(this.gripEnemy, out);
      if (this.stasis.active && this.stasis.held.length) {
        /* THREE KINDS OF HELD THING, NOT TWO. A held PERSON is `{enemy}` — it
         * has no `body`, so this read threw a TypeError out of `world.update`
         * on the first frame the field's first entry was a man, and `stasis`
         * is `track: true` so the gesture asks every frame. It is not even a
         * cast-time fault: in Command the field can be empty at the cast and a
         * trooper walks into it twenty-five frames later. The vfx loop in
         * `_updateStasis` already spells all three; this is that expression,
         * called rather than restated. */
        return this._heldPoint(this.stasis.held[0], out);
      }
    }
    return this.gesture.hasAt ? out.copy(this.gesture.at) : null;
  }

  /**
   * Open the off hand.
   *
   * `palm` used to reach exactly one place — aimBoneWorld, which writes a
   * QUATERNION and nothing else. So `stasis` at palm 1.0 correctly rolled the
   * wrist until the back of the hand faced the target and then presented it a
   * clenched fist, because the hand is one baked BufferGeometry built at
   * curl 0.95 and there is no bone, no morph and no retained transform inside
   * it that anything could address. Bodies.js now bakes a second, open build
   * of the same part list as morph target 0, so `palm × env` — a product this
   * function's caller already computes and smooths — is a continuous open and
   * close for one float per frame and no CPU work at all.
   *
   * LEFT HAND ONLY, and that is load-bearing rather than incidental: the saber
   * lives in the right hand, the blade solve owns that arm outright, and every
   * gesture in GESTURES is left-handed for exactly that reason. handR is never
   * touched here, so the grip cannot open mid-swing.
   */
  _openPalm() {
    const b = this.rig.get('handL');
    const m = b && b.primary;
    // droids, and anything else whose hand was not built with the morph
    if (!m || !m.morphTargetInfluences || !m.morphTargetInfluences.length) return;
    const g = GESTURES[this.gesture.kind];
    m.morphTargetInfluences[0] = g ? clamp(g.palm * this.gesture.env, 0, 1) : 0;
  }

  /**
   * Bend the free hand toward whatever the Force is doing, and hand back the
   * direction the palm should face.
   *
   * Blended by the gesture envelope rather than switched, so the hand travels
   * from the hip to the gesture and back instead of teleporting, and a power
   * fired mid-swing does not snap the arm across the body.
   */
  _gesturePose(target, pole, chest, fwd, right) {
    const g = GESTURES[this.gesture.kind];
    const env = this.gesture.env;
    if (!g || env <= 0.001) return null;

    // where the gesture wants the hand, in the aim frame
    _g1.copy(chest).addScaledVector(fwd, g.out).addScaledVector(right, g.side).addScaledVector(UP, g.up);

    // A grip or a hurl points at the THING, not at the crosshair — you cannot
    // read "he is holding that" off a hand aimed somewhere else.
    const reach = Math.hypot(g.out, g.side, g.up);
    const at = this._gestureFocus(_g2);
    _g4.copy(fwd);
    if (at) {
      _g3.subVectors(at, chest);
      const d = _g3.length();
      if (d > 0.3) {
        _g3.multiplyScalar(1 / d);
        _g1.copy(chest).addScaledVector(_g3, reach).addScaledVector(UP, 0.05);
        _g4.copy(_g3);
      }
    }
    target.lerp(_g1, env);

    // The elbow has to ride out with the hand or the forearm folds back through
    // the ribs — the same failure the hilt poles were fixed for.
    _g3.copy(chest).addScaledVector(right, -0.92).addScaledVector(UP, -0.40).addScaledVector(fwd, -0.12);
    pole.lerp(_g3, env);

    // Palm: 0 points the fingers at the target, 1 turns the hand flat to face
    // it. The hand bone's +Y runs out through the fingers, so rolling the palm
    // up IS rotating +Y toward world up.
    _g5.copy(_g4).lerp(UP, clamp(g.palm * env, 0, 0.98));
    if (_g5.lengthSq() < 1e-8) return null;
    return _g5.normalize();
  }

  /* ── force powers ────────────────────────────────────────────────── */

  /**
   * EVERY BODY THIS PLAYER IS ALLOWED TO FIGHT — one list, built once.
   *
   * Every force power in this file opened with `for (const e of ctx.enemies)`,
   * and World has put `players` in that same ctx object since the day co-op
   * landed. Nothing in this file had ever read it. That is the entire reason a
   * force push aimed point-blank at another player left their velocity at
   * 0.000 m/s and lightning at 1.2 m took them 100 hp → 100 hp: not a rule
   * against it, an iteration that could not see them.
   *
   * ONE helper rather than a second loop pasted into each power, because the
   * alternative is five copies of a targeting rule and this repository has
   * twice had to un-duplicate exactly that shape — see the note in
   * `World._resolveBlades` about the enemy blade test that existed twice and
   * disagreed with itself on five terms.
   *
   * IN CO-OP THIS APPENDS NOTHING. Every player is on side 0, `canHarm` says no
   * without friendly fire, and each power iterates precisely the list it always
   * did. That is the property to hold on to: PvP is not a branch through the
   * powers, it is a longer list going into the loop they already had.
   *
   * The array is retained between calls — a power is a button, but a held one
   * fires several times a second and this is a hot path in a crowd.
   *
   * Both lists go through `hostileTo`, which is the same rule World needs for
   * `pickTarget`. Filtering the horde through it costs one `canHarm` per body
   * and buys the property that matters: there is no list anywhere built from a
   * different idea of who is fighting whom.
   */
  /**
   * Everything this player's powers are allowed to reach.
   *
   * THE RULES COME FROM THE WORLD, not from `null`. Both calls passed `null`,
   * which makes `canHarm` fall back to its own defaults — and its defaults are
   * co-op's, because that is what every world was until duels existed. So a
   * duel's rules were consulted by `Player.damage` and by `bladeTargets` and
   * NOT by push, pull or lightning: a point-blank shove moved a rival at
   * 0.000 m/s while the same rival could be cut to pieces.
   *
   * It read as correct for as long as `world.rules` did not exist, which is
   * the whole hazard in a default that is also an answer: nothing is wrong
   * until the real value shows up, and then the call site that ignored it is
   * the last place anybody looks.
   */
  _foes(ctx) {
    const out = (this._foeList ||= []);
    out.length = 0;
    const rules = ctx.rules ?? this.world?.rules ?? null;
    hostileTo(this, ctx.enemies, rules, out);
    hostileTo(this, ctx.players, rules, out);
    return out;
  }

  forcePush(ctx) {
    if (this.cooldowns.push > 0) return this._refuse('force push', `recovering — ${this.cooldowns.push.toFixed(1)}s`);
    if (!this._spend(POWER_COST.push)) {
      return this._refuse('force push', `${this._priceOf(POWER_COST.push)} Force needed, you have ${Math.round(this.force)}`);
    }
    this.cooldowns.push = 0.55;
    this._gesture('push');
    this._forceVoice('push');
    audio.force(this.chest, 'push');
    this.camera.addShake(0.3);
    this.cloak?.impulse(_v5.copy(this.aimDir).negate().setY(0.4), 2.6); this.skirt?.impulse(_v5.copy(this.aimDir).negate().setY(0.4), 2.6);

    const origin = this.chest;
    const dir = this.aimDir;
    // forcePower scales reach and impulse together, so turning it up makes the
    // push genuinely bigger rather than just harder-hitting in the same cone.
    const P = this.forceScale;
    const range = 13 * Math.sqrt(P), halfAngle = 0.72;

    // `_foes`, not `ctx.enemies`: in co-op this is the same list it always was,
    // and in a duel it is the list with the other player in it. See _foes.
    for (const e of this._foes(ctx)) {
      if (e.dead) continue;
      _v1.subVectors(e.position, origin);
      const d = _v1.length();
      if (d > range) continue;
      _v1.multiplyScalar(1 / d);
      if (_v1.dot(dir) < Math.cos(halfAngle)) continue;
      const k = (1 - d / range);
      _v2.copy(dir).multiplyScalar(20 * k * P).setY((7 * k + 3) * P);
      e.applyKnockback(_v2, 8 * k * P, this);
    }
    for (const b of (ctx.physics ? ctx.physics.bodies : [])) {
      if (b.invMass === 0 || b === this.body) continue;
      _v1.subVectors(b.position, origin);
      const d = _v1.length();
      if (d > range) continue;
      _v1.multiplyScalar(1 / d);
      if (_v1.dot(dir) < Math.cos(halfAngle)) continue;
      const k = 1 - d / range;
      // Mass-proportional impulse cancels mass exactly, so every prop in the
      // game took the same 8.6 m/s off a default push — a 900 kg pillar left
      // like a 22 kg crate. `heft` puts the weight back: at forcePower 1 the
      // pillar gets a quarter of the crate's delta-v, at 4 it gets all of it.
      const heft = this._heft(b.mass);
      _v2.copy(dir).multiplyScalar(b.mass * 15 * k * P * heft).setY(b.mass * 6 * k * P * heft);
      b.applyImpulse(_v2, b.position);
    }
    // architecture: a push does not move a wall, it damages it (Destruction.js)
    this.world?.destruction?.forceBlast(origin, dir, range, P);
    // bolts get scattered
    if (ctx.bolts) {
      for (const bolt of ctx.bolts.bolts) {
        if (!bolt.active || bolt.team === this.team) continue;
        _v1.subVectors(bolt.pos, origin);
        const d = _v1.length();
        if (d > range || _v1.normalize().dot(dir) < Math.cos(halfAngle)) continue;
        bolt.vel.addScaledVector(dir, 40).setLength(bolt.speed);
        bolt.team = this.team;
      }
    }
    if (ctx.particles) {
      for (let i = 0; i < 30; i++) {
        _v1.copy(dir).multiplyScalar(9 + rng() * 12);
        _v1.x += (rng() - 0.5) * 7; _v1.y += (rng() - 0.5) * 5; _v1.z += (rng() - 0.5) * 7;
        _v2.copy(origin).addScaledVector(dir, 0.6);
        ctx.particles.dust.spawn(_v2, _v1, { life: 0.75, size: 0.4, drag: 2.6, gravity: 0.2,
          color: 0xe0e8f0, alpha: 0.12 });
      }
    }
    if (ctx.terrain) {
      _v1.copy(origin).addScaledVector(dir, 4.5);
      if (Math.abs(_v1.y - ctx.terrain.height(_v1.x, _v1.z)) < 1.6) {
        ctx.terrain.crater(_v1.x, _v1.z, 2.6, 0.22);
        ctx.particles?.sandPuff(_v1.setY(ctx.terrain.height(_v1.x, _v1.z)), 1.4, _v1.y, ctx.groundColor);
      }
    }
    this.world.engine.setRadial?.(0.35);
  }

  forcePull(ctx) {
    if (this.cooldowns.pull > 0) return this._refuse('force pull', `recovering — ${this.cooldowns.pull.toFixed(1)}s`);
    if (!this._spend(POWER_COST.pull)) {
      return this._refuse('force pull', `${this._priceOf(POWER_COST.pull)} Force needed, you have ${Math.round(this.force)}`);
    }
    this.cooldowns.pull = 0.6;
    this._gesture('pull');
    this._forceVoice('pull');
    audio.force(this.chest, 'pull');
    this.cloak?.impulse(_v5.copy(this.aimDir).setY(0.3), 1.8); this.skirt?.impulse(_v5.copy(this.aimDir).setY(0.3), 1.8);
    /**
     * AND YOU CAN SEE IT LEAVE YOUR HAND — which, alone of the aimed powers,
     * you could not.
     *
     * Driven through a real World with every emitter counted, one cast each:
     *
     *     push      3 sounds  45 particles  shake 0.30  1 radial
     *     unleash   7 sounds  26 particles  shake 0.62  2
     *     stasis    4 sounds  26 particles  shake 0.14  1
     *     rend     15 sounds  20 particles  shake 0.34  0
     *     compel    3 sounds  14 particles  shake 0.00  0
     *     pull      3 sounds   0 particles  shake 0.00  0
     *
     * A gesture, a grunt and a cloak — and if nothing happens to be inside the
     * cone, nothing at all. Its opposite number spends sixteen Force and throws
     * up a wall of dust, a crater and a lens squeeze, so the pair read as two
     * different KINDS of thing rather than as two directions of one thing.
     *
     * The shape is push's, reversed and smaller. The dust is spawned OUT along
     * the reach and given a velocity back toward the chest, so it reads as air
     * coming in rather than as an explosion; the shake is 0.18 against push's
     * 0.30, because a pull is a haul and not a blow; and the radial is 0.22
     * against 0.35 for the same reason. No crater: a pull does not drive
     * anything into the ground.
     */
    this.camera.addShake(0.18);
    if (ctx.particles) {
      const back = _v6.copy(this.aimDir).negate();
      for (let i = 0; i < 22; i++) {
        // out along the pull, scattered, then hauled home
        _v2.copy(this.chest).addScaledVector(this.aimDir, 2.5 + rng() * 7);
        _v2.x += (rng() - 0.5) * 3.2; _v2.y += (rng() - 0.5) * 2.2; _v2.z += (rng() - 0.5) * 3.2;
        _v1.copy(back).multiplyScalar(7 + rng() * 9);
        _v1.x += (rng() - 0.5) * 3; _v1.y += (rng() - 0.5) * 2 + 0.8; _v1.z += (rng() - 0.5) * 3;
        ctx.particles.dust.spawn(_v2, _v1, { life: 0.6, size: 0.32, drag: 3.2, gravity: 0.15,
          color: 0xe0e8f0, alpha: 0.11 });
      }
    }
    this.world.engine.setRadial?.(0.22);
    // Reach scales with the setting, same law as push and grip. A pull that
    // stayed at 17 m while the grip reached 36 was the odd one out.
    const P = this.forceScale;
    const origin = this.chest, dir = this.aimDir, range = 17 * Math.sqrt(P);
    /**
     * A PULL ENDS IN FRONT OF YOU, at the length of your own arm and blade.
     *
     * This used to be `-min(d * 3.2, 22)` along the line: an impulse that made
     * things move toward the player and had no idea where the player was. At
     * 4 m it overshot straight past and out the other side; at 16 it fell
     * three quarters short, so the only distance it worked at was the one it
     * was tuned at. The player's note is exact — "bring things fully to melee
     * range" — and that is a DESTINATION, not a shove.
     *
     * So the target is PULL_TO metres in front of the chest, and the impulse is
     * whatever covers the gap: the enemy's own damping (Enemy._move, rate 5-8
     * on the horizontal) means a body carries roughly `v/6` before it stops, so
     * the speed to close a gap `g` is about `6g`, capped so that a pull across
     * the whole arena is fast rather than instantaneous. The lift is a fixed
     * fraction of the closing speed instead of a constant, or a short pull
     * threw its victim over the player's head.
     */
    const want = _v8.copy(origin).addScaledVector(dir, PULL_TO);
    for (const e of this._foes(ctx)) {
      if (e.dead) continue;
      _v1.subVectors(e.position, origin);
      const d = _v1.length();
      if (d > range || d < 1.5) continue;
      _v1.multiplyScalar(1 / d);
      if (_v1.dot(dir) < 0.72) continue;
      // `A.mass` is the archetype's; a player has no archetype and the 80 kg
      // fallback was already here for exactly that class of body.
      const heft = this._heft(e.A ? e.A.mass : 80);
      // gap along the ground, because the vertical is the arc, not the aim
      _v2.subVectors(want, e.position).setY(0);
      const gap = _v2.length();
      const close = Math.min(gap / PULL_COAST, PULL_MAX * heft);
      // The lift is a fraction of the closing speed rather than a constant, or
      // a one-metre pull throws its victim over the player's head.
      _v2.multiplyScalar(gap > 1e-3 ? close / gap : 0).setY(close * 0.12 + 1.2);
      e.applyKnockback(_v2, 2, this, true);
      /* And it arrives OPEN. A body dragged off its feet cannot set itself, so
       * the window this opens is the whole point of pulling rather than
       * pushing — see `_saberDamageScale`, which is where it is spent. */
      e.yankT = PULL_OPEN;
    }
    for (const b of (ctx.physics ? ctx.physics.bodies : [])) {
      if (b.invMass === 0 || b === this.body) continue;
      _v1.subVectors(b.position, origin);
      const d = _v1.length();
      if (d > range || d < 1) continue;
      _v1.multiplyScalar(1 / d);
      if (_v1.dot(dir) < 0.72) continue;
      const heft = this._heft(b.mass);
      /* Same destination for a crate, but through an impulse rather than a
       * velocity, so it is mass-scaled. A rigid body has no damping term to
       * undo — it is a ballistic arc into whatever it lands on — so the speed
       * that covers a gap is set by the flight time instead: with the lift
       * below, a body is airborne for about 2·vy/g, and 0.45 of the walker's
       * coasting distance lands a crate at about the same place. */
      _v2.subVectors(want, b.position).setY(0);
      const gap = _v2.length();
      const close = Math.min(gap / (PULL_COAST * 2.2), PULL_MAX * heft);
      _v2.multiplyScalar(gap > 1e-3 ? b.mass * close / gap : 0).setY(b.mass * (close * 0.16 + 1.6));
      b.applyImpulse(_v2, b.position);
    }
  }

  /** Is this physics body something the Force is allowed to take hold of? */
  _grippableBody(b) {
    if (!b || b === this.body || b.dead) return false;
    // An enemy's movement proxy is KINEMATIC, so invMass is 0 and the old
    // filter could never see one. That is why gripping a droid only worked when
    // the ray hit nothing at all — a crate anywhere behind it won the pick.
    //
    // `Enemy.grippable` is the second field in this method's history to have
    // been written everywhere and read nowhere, and it now means what its
    // archetype says: a siege walker is not a heavy enemy, it is terrain that
    // shoots. See Vehicles.js. The refusal is NOT silent — `_forceSeen` keeps
    // the thing pickable so `toggleGrip` can say no in words.
    if (b.layer === LAYER.ENEMY) {
      const e = b.userData.enemy;
      return !!(e && !e.dead && e.grippable !== false);
    }
    // `grippable` was WRITTEN AND NEVER READ. Props.js sets it false on exactly
    // two things — the pillar and the spire — and Destruction's proxy sets it
    // false too, and not one line in src/ or tools/ ever looked at it. The only
    // real gate was mass, so at a high Force Power slider the 900 kg pillar the
    // author had explicitly excluded came out of the ground anyway, and the
    // proxy that stands in for every destructible structure in the level was
    // grippable in principle. An author's "no" now means no.
    if (b.userData && b.userData.prop && b.userData.prop.grippable === false) return false;
    return b.invMass > 0
      && (b.layer === LAYER.PROP || b.layer === LAYER.DEBRIS || b.layer === LAYER.RAGDOLL);
  }

  /**
   * Everything the Force OWES THE PLAYER AN ANSWER ABOUT: what it can hold,
   * plus the bodies it must refuse out loud.
   *
   * The two are not the same set, and collapsing them is how a power ends up
   * appearing to do nothing. If the AT-TE were simply dropped from the pick,
   * the aim ray would pass straight THROUGH thirteen metres of walker and grip
   * whatever stood behind it — so pointing at the biggest thing in the game and
   * pressing grip would either grab a battle droid forty metres away or return
   * null and play no sound at all. Both read as a broken button.
   *
   * So the ray and the cone see it, `toggleGrip` refuses it by name, and the
   * refusal carries the counter-play (its legs) rather than a number the player
   * cannot act on.
   */
  _forceSeen(b) {
    if (this._grippableBody(b)) return true;
    if (b && b.layer === LAYER.ENEMY) {
      const e = b.userData.enemy;
      return !!(e && !e.dead && e.grippable === false);
    }
    return false;
  }

  /**
   * Everything the Force could pick up, and how heavy it is.
   *
   * Three widenings on what this used to be, all of them asked for by name:
   *  · enemies are in the SAME search as props rather than a fallback that only
   *    ran when the ray hit literally nothing;
   *  · anything loose counts — crates, barrels, consoles, spires, pillars, cut
   *    prop halves, wall rubble from Destruction, corpses, severed limbs, and
   *    the enemies themselves. The only things left out are the terrain, the
   *    static architecture (a push damages that; see Destruction.forceBlast)
   *    and the player;
   *  · the crosshair does not have to be ON it. The ray is tried first because
   *    it is exact, and a cone around the aim catches everything else — pixel
   *    accuracy on a tumbling rock at 20 m is not a skill worth testing.
   */
  _pickGripTarget(ctx) {
    const reach = this.forceReach;
    // The ray leaves the CAMERA so it agrees with the crosshair, and in third
    // person that is ~3 m behind the head — so it has to run that much further
    // than the reach or the far end of the reach is unreachable.
    const lead = this.camera.pos.distanceTo(this.chest);
    const maxD = reach + lead;

    const hit = ctx.physics ? ctx.physics.raycast(this.camera.pos, this.aimDir, maxD,
      (b) => this._forceSeen(b)) : null;
    if (hit && hit.body && this._forceSeen(hit.body)) {
      const e = hit.body.userData.enemy;
      // The crosshair was ON it, so it is the answer whether or not the answer
      // is yes — see `_forceSeen`.
      return e ? { enemy: e, mass: heldMass(e), distance: hit.distance,
                   immovable: e.grippable === false }
               : { body: hit.body, mass: hit.body.mass, distance: hit.distance };
    }

    // Nothing under the crosshair. Take the best thing near it, but never
    // through the wall the ray just stopped on.
    const wall = hit ? hit.distance : maxD;
    let best = null, bestDot = 0.965;              // ≈15° cone
    /* TWO TIERS, NOT ONE SORT. A thing the Force cannot lift must never STEAL
     * the pick from one it can: off the crosshair the player is not pointing at
     * anything in particular, and an AT-TE filling half the sky behind a battle
     * droid would win every cone it appeared in on angle alone. Ranking them
     * together — even with a tie-break — gets that wrong whenever the immovable
     * body is the better-aligned of the two, which for something thirteen
     * metres wide is most of the time. So the liftable tier is resolved first
     * and the immovable one only answers a cone that held nothing else, which
     * is what keeps the refusal reachable without pixel-perfect aim. */
    let refuse = null, refuseDot = 0.965;
    const consider = (obj, point, mass, isEnemy, immovable = false) => {
      _g1.subVectors(point, this.camera.pos);
      const d = _g1.length();
      if (d > maxD || d < 0.6 || d > wall + 1.2) return;
      const dot = _g1.multiplyScalar(1 / d).dot(this.aimDir);
      if (immovable) {
        if (dot < refuseDot) return;
        refuseDot = dot;
        refuse = { enemy: obj, mass, distance: d, immovable: true };
        return;
      }
      if (dot < bestDot) return;
      bestDot = dot;
      best = isEnemy ? { enemy: obj, mass, distance: d } : { body: obj, mass, distance: d };
    };
    for (const b of (ctx.physics ? ctx.physics.bodies : [])) {
      if (!this._grippableBody(b) || b.layer === LAYER.ENEMY) continue;
      consider(b, b.position, b.mass, false);
    }
    for (const e of ctx.enemies || []) {
      if (e.dead) continue;
      consider(e, this._enemyPoint(e, _g2), heldMass(e), true, e.grippable === false);
    }
    return best || refuse;
  }

  /**
   * WHY THE FORCE WILL NOT TAKE HOLD OF THIS, in the words the player gets.
   *
   * Two gates, in this order: an author's outright `grippable: false` (the
   * AT-TE and the AAT — terrain that shoots, see Vehicles.js), then the mass
   * cap the Force Power slider moves. `toggleGrip` wrote both sentences inline
   * and the stasis field refuses bodies by exactly the same two gates, so a
   * second copy of the prose would be a second copy of the RULE: the day the
   * AAT stops being a repulsorlift, one of them would say so and the other
   * would go on telling the player to cut the legs off a hovering tank.
   *
   * The HEADLINE stays with each caller, because a grip that will not lift and
   * a field that will not hold are different sentences about the same fact.
   * What is shared is the part that carries information — the numbers, and the
   * counter-play read off the RIG rather than typed beside it.
   */
  _liftRefusal(target) {
    const cap = this.liftCapacity;
    const mass = target.mass;
    if (!target.immovable) {
      return { mass, cap, why: `${Math.round(mass)} kg against your ${Math.round(cap)} kg — raise Force Power` };
    }
    const e = target.enemy;
    const label = e && e.A ? e.A.label : 'it';
    const legged = !!(e && e.rig && [...e.rig.bones.keys()]
      .some((n) => /thigh|shin|foot|femur|tibia|tarsus/.test(n)));
    return { mass, cap, immovable: true, label, legged,
      why: `${(mass / 1000).toFixed(1)} tonnes — no Force Power moves it. `
        + (legged ? 'Cut its legs out from under it.' : 'Break its armour instead.') };
  }

  toggleGrip(ctx) {
    if (this.gripBody || this.gripEnemy) { this.releaseGrip(); return; }
    /* A BLADE IN THE AIR IS THE FIRST THING YOUR FORCE REACHES FOR. Tried
     * before the aim pick, because a player whose own saber is out there and
     * who presses grip means that saber — and the pick would otherwise hand
     * them whichever crate happened to be under the reticle. See `pilotThrown`. */
    if (this.throwState === 'flying' || this.throwState === 'piloted') {
      if (this.pilotThrown(ctx)) return;
    }
    /* AND IT SAYS SO. A bare `return` here was the second of the file's two
     * silent refusals — see `_refuse`'s own header, which all twelve powers
     * obey and this one did not. `_priceOf` rather than the list number,
     * because the gate below charges `cost * forceDrain * forceCost`. */
    if (!this._canSpend(POWER_COST.grip)) {
      return this._refuse('force grip', `${this._priceOf(POWER_COST.grip)} Force needed, you have ${Math.round(this.force)}`);
    }

    const target = this._pickGripTarget(ctx);
    this.lastGripRefusal = null;
    /* AND AN EMPTY HAND IS A REASON TOO. This was the third bare `return` in
     * the method, sitting two lines under the note that says a bare `return`
     * here is the bug — and it is the one a player meets most, because
     * `_pickGripTarget` answers null for "the cone held nothing" as well as for
     * "you are pointing at the sky". `forceCompel` has said exactly this
     * sentence for the same miss since it was written; there is no argument for
     * the two aimed holds answering the same question differently. */
    if (!target) {
      return this._refuse('force grip', 'nothing in your sights within reach');
    }

    const cap = this.liftCapacity;

    /* THE ONE THING THE SLIDER DOES NOT ANSWER, and it is a REFUSAL rather
     * than a silence.
     *
     * Everything else here is a mass gate: turn Force Power up far enough and a
     * spider walker, an Acklay or a hailfire droid comes off the ground. Two
     * bodies are outside that argument — the AT-TE at 3600 kg and the AAT at
     * 2400 — because they are not heavy enemies, they are terrain that shoots,
     * and Vehicles.js records why. A player who points at one and presses grip
     * must be TOLD that, in the same beat and with the same strain the mass
     * refusal plays; the alternative is a power that appears to do nothing,
     * which is the complaint this whole path exists to answer.
     *
     * The message names the COUNTER-PLAY instead of a number, because unlike
     * "too heavy" there is no setting that changes the answer, and a refusal
     * with no next move in it is still a dead end.
     *
     * Which counter-play is READ OFF THE BODY rather than typed beside it. The
     * AT-TE walks on six legs and `custom: 'walker'` drops the chassis at
     * `legsLost >= 3`, so the legs are the way in — but the AAT is a
     * repulsorlift built with `legs: 0`, and telling a player to cut the legs
     * off a hovering tank is the hand-written-table defect wearing a sentence.
     * `Enemy._loseLimbBehaviour` severs on bones matching thigh/shin/foot, so
     * the rig itself is the authority on whether this one has any. */
    if (target.immovable) {
      this.lastGripRefusal = { ...this._liftRefusal(target) };
      /* The record a refusal leaves: the mass, the cap it lost to, and — for a
       * body no Force Power will ever move — the counter-play in place of a
       * number. Read back out of the FIELD by name rather than off a local,
       * because a field with no reader is a comment with syntax, and this one
       * had no reader for as long as a refused lift was a groan with no
       * explanation. */
      const why = this.lastGripRefusal;
      this.world?.notify?.(`${String(why.label).toUpperCase()} WILL NOT LIFT`, why.why);
      this._gripStrain(ctx, target);
      return;
    }

    // The mass gate. Note this replaces the SIZE gate Enemy.grippable used to
    // be — a flat `!A.big && !A.boss` that no setting could reach, and precisely
    // the cap the player hit. A walker or an Acklay is now a question of how
    // far the Force slider is turned up, not a permanent no.
    if (target.mass > cap) {
      // Say WHY. This recorded the two numbers and nothing ever read them, so a
      // refused lift was a groan and a shudder and no explanation — which reads
      // as the Force being broken rather than as the thing being too heavy. The
      // player cannot see a mass, so the feedback has to carry it, and it has to
      // name the slider that moves the cap or the number is just a wall.
      this.lastGripRefusal = { ...this._liftRefusal(target) };
      // Read back out of the FIELD, by name, rather than off the locals. It
      // looks redundant and is not: writing these two numbers somewhere nothing
      // read them is exactly how a refused lift ended up being a groan with no
      // explanation, and a field with no reader is a comment with syntax. One
      // home, and the seam stays open for the HUD to show it too.
      const why = this.lastGripRefusal;
      this.world?.notify?.('TOO HEAVY', why.why);
      this._gripStrain(ctx, target);
      return;
    }

    /**
     * AND NOW IT IS PAID FOR.
     *
     * `POWER_COST.grip = 10` was CHECKED above and never charged: the only bill
     * was the per-second hold, so the HUD drew a price tag on a threshold and a
     * player watching the pool saw 100 Force go to 100 Force. Measured before
     * this line existed: grip at 100 Force left 100.00.
     *
     * Charged HERE and not at the gate, because everything between the two is a
     * refusal — no target, too heavy, or a body no Force Power will move — and
     * you are not billed for pointing at a wall. The gate stays where it is so
     * an empty pool is answered before a target is even looked for.
     */
    if (!this._spend(POWER_COST.grip)) {
      return this._refuse('force grip', `${this._priceOf(POWER_COST.grip)} Force needed, you have ${Math.round(this.force)}`);
    }
    this._gesture('grip');
    this._forceVoice('grip');
    const lead = this.camera.pos.distanceTo(this.chest);
    this.gripDistance = clamp(target.distance, lead + 1.4, lead + this.forceReach);
    if (target.enemy) {
      this.gripEnemy = target.enemy;
      /* THE LEASE, not the latch. See `Enemy.hold`: the hold is renewed every
       * frame by `_updateGrip` below, and a gripper that stops renewing —
       * because it died, because the level rotated, because the whole Player
       * was disposed — drops the body instead of stranding it. */
      target.enemy.hold();
      this._liftPoint.copy(target.enemy.position);
    } else {
      this.gripBody = target.body;
      target.body.gravityScale = 0;
      target.body.wake();
    }
    audio.force(this.chest, 'pull');
  }

  /**
   * Too heavy is a real answer and it has to SOUND like one, or the player
   * reads it as the button not working. A groan, a shudder, and dust off the
   * thing that would not come.
   */
  _gripStrain(ctx, target) {
    const p = target.enemy ? target.enemy.position : target.body.position;
    audio.tone({ freq: 96, freqEnd: 42, dur: 0.42, gain: 0.22, type: 'sawtooth', pos: p });
    audio.noise({ dur: 0.34, gain: 0.14, type: 'lowpass', freq: 420, freqEnd: 110, pos: p, pink: true });
    this.camera.addShake(0.12);
    if (ctx.particles) {
      for (let i = 0; i < 10; i++) {
        _g1.set((rng() - 0.5) * 2, rng() * 0.6, (rng() - 0.5) * 2);
        ctx.particles.dust.spawn(p, _g1, { life: 0.5, size: 0.3, drag: 3, gravity: 1.4,
          color: 0xc8c0b0, alpha: 0.2 });
      }
    }
  }

  /**
   * LET GO — of MY end of it, which is not the same as the thing being free.
   *
   * Both lines here used to end the hold outright: `gravityScale = 1` drops a
   * crate out of the air and `releaseHold()` clears `gripped` and `liftTarget`.
   * With two people on one body that is the first of them to let go dropping it
   * out of the other's hands — and the second one goes on paying per second for
   * a hold that has already ended, which is the worst version of the defect the
   * contest exists to fix.
   *
   * So the ending is conditional on being the LAST hand off it. `gripRelease`
   * answers how many claims remain, having first pruned any whose lease has
   * lapsed, so a gripper who died or disconnected cannot leave a crate hanging.
   */
  releaseGrip() {
    this._holdT = 0;
    const now = this.world?.time ?? 0;
    if (this.gripBody) {
      if (gripRelease(this.gripBody, this, now) === 0) this.gripBody.gravityScale = 1;
      this.gripBody = null;
    }
    if (this.gripEnemy) {
      if (gripRelease(this.gripEnemy, this, now) === 0) this.gripEnemy.releaseHold();
      this.gripEnemy = null;
    }
    this.gripShare = 1;
    this._endGesture('grip');
  }

  /**
   * The thing being held, as a capsule that can eat a bolt — or null.
   *
   * Read by World._boltHitTest before the player's own capsule. Two shapes go
   * through one interface: an enemy contributes its own body capsule, a physics
   * prop contributes its bounding sphere as a degenerate segment, and both
   * answer `take`, so the caller does not need to know which it got.
   *
   * The reach test is what makes it a SHIELD rather than an aura: the held
   * thing only covers you while it is actually between you and the world, so a
   * crate dangling behind your shoulder stops nothing.
   */
  shieldBody() {
    const e = this.gripEnemy, b = this.gripBody;
    if (!e && !b) return null;
    const pos = e ? this._enemyPoint(e, _v10) : b.position;
    if (pos.distanceToSquared(this.chest) > SHIELD_REACH * SHIELD_REACH) return null;
    if (e) {
      const r = (e.radius || 0.4) * 1.15;
      const lo = _v11.copy(e.position).setY(e.position.y + 0.2);
      const hi = _v12.copy(e.position).setY(e.position.y + (e.A?.big ? 2.6 : 1.7));
      return { p0: lo, p1: hi, r, victim: e,
        take: (dmg, at, from) => { e.damage(dmg * SHIELD_BITE, at, from, 'bolt'); } };
    }
    const r = Math.max(0.25, b.boundingRadius || 0.4);
    return { p0: b.position, p1: b.position, r, victim: b,
      take: (dmg, at) => {
        b.wake?.();
        // The prop's own destruction path, reached the way the blade reaches
        // it — through `body.userData.prop` — so a crate held as cover comes
        // apart on the same hp and shatters into the same chunks as one that
        // was cut. Its signature is (amount, point, dir), not the four-argument
        // one Player/Enemy share; `dir` is what the shatter throws the pieces
        // along, and a bolt's is the way it was travelling.
        const prop = b.userData?.prop;
        if (prop && typeof prop.damage === 'function') {
          prop.damage(dmg * SHIELD_BITE, at, _v13.subVectors(at, this.chest).normalize());
        }
      } };
  }

  /**
   * Where the player is actually pointing, as a world point, plus whoever is
   * standing on it.
   *
   * The old hurl aimed at `camera.pos + aim * 40`, which is a point in space
   * rather than a target: something held out to the left of the crosshair was
   * launched along the line from IT to that point, so it landed metres wide of
   * what the player was looking at, and the error grew with hold distance.
   */
  _aimTarget(ctx, out = new THREE.Vector3()) {
    const FAR = 110;
    let dist = FAR, enemy = null;
    const hit = ctx.physics ? ctx.physics.raycast(this.camera.pos, this.aimDir, FAR,
      (b) => b !== this.body && b !== this.gripBody) : null;
    if (hit) dist = hit.distance;
    // Someone standing near the aim line beats the wall behind them. This is
    // the "send them back towards whoever I want" half, and it has to be
    // forgiving or picking a target at 30 m is a coin flip.
    let bestDot = 0.985;                             // ≈10° cone
    for (const e of ctx.enemies || []) {
      if (e.dead) continue;
      _g1.subVectors(this._enemyPoint(e, _g2), this.camera.pos);
      const d = _g1.length();
      if (d < 1 || d > FAR) continue;
      const dot = _g1.multiplyScalar(1 / d).dot(this.aimDir);
      if (dot < bestDot) continue;
      bestDot = dot; enemy = e; dist = d;
    }
    out.copy(this.camera.pos).addScaledVector(this.aimDir, dist);
    if (enemy) this._enemyPoint(enemy, out);
    return { point: out, enemy };
  }

  hurlGripped(ctx) {
    if (!this.gripBody && !this.gripEnemy) return;
    /**
     * ── YOU CAN ONLY THROW WHAT YOU OWN ─────────────────────────────────
     *
     * §4.8: *"break his guard and the resistance cap collapses from a half to a
     * FIFTH, and it becomes a projectile with his name on it."* This line is
     * where that stops being a description and becomes the rule.
     *
     * Two guarded Force users on one crate resolve to 0.500 and 0.500 — dead
     * level, by construction, because each cancels `RESIST_CAP` of the other —
     * so NEITHER of them can throw it and the object hangs shuddering between
     * them for as long as both keep paying. Stagger him, and his `_guardOpen`
     * turns the cancellation he is doing into `RESIST_CAP × RESIST_BEATEN`; the
     * shares go 0.642 / 0.358 and the throw unlocks on the same frame. That is
     * one press behaving differently because of something the player did to the
     * man beside him, which is the only definition of a decision this codebase
     * accepts.
     *
     * A REFUSAL AND NOT A SILENCE, and it names the counter-play rather than a
     * number, for the reason `TOO HEAVY` does: there is no setting that answers
     * this one, so a bare `return` would read as the key being broken. The
     * strict `> 0.5` is deliberate — a tie is not a win.
     */
    const held = this.gripBody || this.gripEnemy;
    if (gripHolders(held, this.world?.time ?? 0) > 1 && !(this.gripShare > 0.5)) {
      return this._refuse('force hurl',
        `another hand has ${Math.round((1 - this.gripShare) * 100)}% of it — break his guard first`);
    }
    /* AND IT LEAVES EVERY HAND AT ONCE. `_updateGrip` renews the hold every
     * frame, so a loser still gripping would re-take a body in mid-flight on
     * his very next frame. See `gripSeize`. */
    gripSeize(held, this);
    const aim = this._aimTarget(ctx, _g3);
    const P = this.forceScale;
    const cap = this.liftCapacity;
    this._gesture('hurl', aim.point);
    this.cloak?.impulse(_v5.copy(this.aimDir).negate().setY(0.3), 2.4); this.skirt?.impulse(_v5.copy(this.aimDir).negate().setY(0.3), 2.4);
    this.camera.addShake(0.26);
    this.world?.addHitstop?.(0.035);

    if (this.gripBody) {
      const b = this.gripBody;
      const m = Math.max(1, b.mass);
      b.gravityScale = 1;
      _v2.subVectors(aim.point, b.position);
      if (_v2.lengthSq() < 1e-8) _v2.copy(this.aimDir);
      _v2.normalize();
      // Speed by mass. Before this every mass in the game left at exactly the
      // same 26 m/s (104 at forcePower 4), which is why a throw had no weight
      // at either end of the scale. Written as a velocity rather than an
      // impulse because that is what the number MEANS — an impulse of
      // mass × speed is the same statement with a cancellation hidden in it.
      const speed = 34 * Math.sqrt(P) * lerp(1.25, 0.45, clamp(m / cap, 0, 1));
      b.velocity.copy(_v2).multiplyScalar(speed);
      b.angularVelocity.set((rng() - .5) * 7, (rng() - .5) * 7, (rng() - .5) * 7);
      b.wake();
      this._trackHurl(b, speed);
      this._hurlVfx(ctx, b.position, _v2, Math.max(0.3, b.boundingRadius), speed);
      this.gripBody = null;
    } else {
      this._hurlBody(ctx, this.gripEnemy, aim.point);
      this.gripEnemy = null;
    }
    /* An empty hand owns all of nothing. `releaseGrip` is not the path a throw
     * takes out of a hold, so it says so here too — otherwise the next hold
     * would open reporting the share of the last contest until its first frame
     * of `_updateGrip` corrected it. */
    this.gripShare = 1;
    this._endGesture('grip');
    audio.force(this.chest, 'push');
  }

  /**
   * A PERSON LEAVES YOUR HAND — the one place a body is thrown, for the grip
   * and for the stasis field alike.
   *
   * This was `hurlGripped`'s inner half and had exactly one caller. The field's
   * volley wants every line of it and not one line different: the same speed
   * law by mass against the same cap, the same knockback, the same stun in the
   * direction it was thrown, and the same `_trackHurl(..., { body: true })`
   * that makes it a real projectile — note #9, *"if I pick up a trooper and
   * move him through a column of other men it doesnt hit them or move them
   * passively it's like not a real object"*. `bodyHurl` is a separate
   * coefficient from the crate's, because a body is three to ten times a
   * crate's mass and would otherwise sit on the 140 ceiling on every throw.
   *
   * A second copy for the field is how the crate and the man drift apart
   * again, and it is how the field's half would quietly miss the day that
   * coefficient is retuned.
   *
   * @param at  where it is being thrown, in world space.
   * @returns   the speed it left at, in m/s.
   */
  _hurlBody(ctx, e, at) {
    const P = this.forceScale;
    /* THE PAIR, IF THERE IS A PAIR. A man thrown with his mate still on him is
     * the heavier of the two throws and the speed law already knows what to do
     * about that — see `heldMass`. `releaseHold` one line down ends the grip,
     * and `stepGrab` lets go of a man the Force no longer has. */
    const m = heldMass(e);
    // Whichever hold had it, it does not have it any more. Both are cleared
    // because the volley throws bodies the FIELD held while the grip may hold
    // one of its own, and a body must not leave with a mark still on it.
    e.releaseHold();
    this._freeStasisEnemy(e);
    _v2.subVectors(at, e.position);
    if (_v2.lengthSq() < 1e-8) _v2.copy(this.aimDir);
    _v2.normalize();
    const speed = 30 * Math.sqrt(P) * lerp(1.2, 0.5, clamp(m / this.liftCapacity, 0, 1));
    e.applyKnockback(_v2.clone().multiplyScalar(speed), 8 + 14 * P, this);
    e.stun(0.9, _v2, 1.3);      // `_v2` is the direction it was hurled
    this._trackHurl(e, speed, { body: true });
    this._hurlVfx(ctx, e.position, _v2, 0.5, speed);
    return speed;
  }

  /** The visible half of a throw: a cone of exhaust behind it and a whoosh. */
  _hurlVfx(ctx, pos, dir, radius, speed) {
    audio.swing(clamp(speed * 0.7, 12, 40), pos);
    if (!ctx.particles) return;
    for (let i = 0; i < 18; i++) {
      _g1.copy(dir).multiplyScalar(-(2 + rng() * 6));
      _g1.x += (rng() - 0.5) * 5; _g1.y += (rng() - 0.5) * 4; _g1.z += (rng() - 0.5) * 5;
      ctx.particles.dust.spawn(pos, _g1, { life: 0.55, size: radius * 0.9, drag: 3,
        gravity: 0.3, color: 0xdce6f2, alpha: 0.16 });
    }
    ctx.particles.plasma.spawn(pos, _g2.set(0, 0, 0),
      { life: 0.22, size: radius * 3.2, drag: 1, gravity: 0, color: this._lightningColor(), alpha: 0.5 });
  }

  /**
   * Remember what we threw, so it can hurt what it hits.
   *
   * `userData.hurledBy` was set here since the beginning and read by nobody,
   * because RapierWorld stored Body.onContact and dispatched it nowhere. It is
   * read now — `Impact.kineticContact` uses it to decide whose kill a crate is
   * — so this is the field that makes a throw yours, and the timer below is
   * what makes the claim expire.
   *
   * IT TAKES A PROP *OR* A BODY. The two are different objects with different
   * shapes — a `Prop` has `mass`, `boundingRadius` and a live `velocity`; an
   * `Enemy` keeps its mass on its archetype and, while limp, gets its velocity
   * off its ragdoll's chest — so the record carries READERS rather than the
   * numbers, and `_updateHurled` does not know or care which it has.
   */
  _trackHurl(thing, speed, opts = {}) {
    const isBody = !!opts.body;
    if (!isBody) {
      thing.userData.hurledBy = this;
      thing.userData.hurlTimer = 2.6;
      /**
       * ONE HIT PER VICTIM PER THROW, and the contact channel needs telling.
       *
       * The sweep this replaced kept `rec.hit` and consulted it every frame. A
       * contact start is naturally once-per-meeting, which covers most of it —
       * but a crate that lands on a droid and settles against it raises several
       * starts as it comes to rest, and while `hurledBy` is set every one of
       * them is priced at the THROW's floor of 8. `force.mjs` has asserted
       * "the same throw could hit twice" since the sweep was written, and it is
       * the assertion that caught this.
       *
       * The record's own Set is handed to the body rather than copied, so the
       * throw has exactly one list of who it has already hit however the hit
       * arrives.
       */
      thing.userData.hurlHit = null;                 // filled in below
      /**
       * A THROWN PROP NO LONGER NEEDS THIS SWEEP, and that is the point of the
       * contact channel coming back.
       *
       * `Prop` arms its body with the kinetic law (src/game/Impact.js), and a
       * prop's collision mask names ENEMY and PLAYER, so a crate you throw now
       * meets a droid through Rapier's own narrowphase — against the real hull,
       * at the real contact, with continuous detection, rather than against a
       * sphere of `boundingRadius` swept by the THROWER once a frame. Keeping
       * both would bill one collision twice.
       *
       * The record below is still made, because the thrower still owns two
       * things the contact cannot know: how long the throw stays ATTRIBUTED to
       * the player, and when to let go of that claim. `_updateHurled` runs only
       * that half for a prop now.
       *
       * WHAT IS NOT RETIRED, and why, so nobody finishes the job blindly: a
       * thrown BODY still needs the sweep. `Ragdoll`'s mask does not name
       * ENEMY and `Enemy`'s does not name RAGDOLL — deliberately, see the note
       * at Enemy.js's body construction — so a corpse and a living droid are
       * not a collider pair at all and no contact between them will ever be
       * raised. Retiring the body branch means changing those masks first, and
       * that changes how every corpse in the game behaves.
       */
    }
    const rec = {
      thing, isBody, timer: 2.6, hit: new Set(), speed,
      /* A THROWN PERSON IS PRICED DIFFERENTLY FROM A THROWN CRATE, and the
       * reason is arithmetic rather than taste. The prop coefficient reads a
       * 22 kg crate at 40 m/s as 21 damage and saturates its own 140 ceiling
       * at about 240 kg·(m/s)²·10⁻³; a clone trooper is 80 kg and a super
       * battle droid is 210, so at any throw speed worth making, EVERY body
       * would land on the ceiling and one throw would clear a squad. A body
       * therefore pays two thirds of the crate's rate and carries a much lower
       * cap — an 80 kg trooper arriving at 25 m/s reads 20 and a 210 kg super
       * battle droid reads 52, against a crate's 140 ceiling. The floor is
       * HIGHER than the crate's, though, and that is the other half of the
       * shape: a person landing on you is never a nothing, so a slow throw
       * still reads 12 where a slow crate reads 8. */
      k: isBody ? 0.0004 : 0.0006,
      floor: isBody ? 12 : 8,
      cap: isBody ? 55 : 140,
      mass: isBody ? (thing.A ? thing.A.mass : 80) : Math.max(1, thing.mass),
      radius: isBody ? (thing.radius ?? 0.55) : thing.boundingRadius,
    };
    if (!isBody) thing.userData.hurlHit = rec.hit;
    this.hurled.push(rec);
    if (this.hurled.length > 12) this.hurled.shift();
  }

  /** Where a hurled thing is, whichever kind it is. */
  static _hurlPos(h, out) {
    if (!h.isBody) return out.copy(h.thing.position);
    const a = h.thing.actor;
    if (a?.ragdolled) return a.centre(out);
    return out.copy(h.thing.position);
  }

  /** How fast it is going, whichever kind it is. */
  static _hurlVel(h, out) {
    if (!h.isBody) return out.copy(h.thing.velocity);
    const a = h.thing.actor;
    const c = a?.ragdolled && (a.bodies.get('chest') || a.bodies.get('spine') || a.bodies.get('hips'));
    return out.copy(c ? c.velocity : h.thing.velocity);
  }

  _updateHurled(dt, ctx) {
    for (let i = this.hurled.length - 1; i >= 0; i--) {
      const h = this.hurled[i];
      h.timer -= dt;
      /**
       * A PROP'S RECORD IS NOW ONLY ITS CLAIM TICKET. The hit itself arrives
       * through the contact channel; what is left here is how long the kill
       * still counts as yours. Dropping the claim when the record expires is
       * what stops a crate you threw two minutes ago from being credited to
       * you when a collapse finally knocks it into somebody.
       */
      if (!h.isBody) {
        if (h.timer <= 0 || h.thing.dead) {
          if (h.thing.userData) {
            h.thing.userData.hurledBy = null;
            h.thing.userData.hurlTimer = 0;
            h.thing.userData.hurlHit = null;
          }
          this.hurled.splice(i, 1);
        } else if (h.thing.userData) {
          h.thing.userData.hurlTimer = h.timer;
        }
        continue;
      }
      Player._hurlVel(h, _g3);
      const speed = _g3.length();
      // Spent: out of time, gone, or slowed to something that could not hurt a
      // droid if it landed on one.
      if (h.timer <= 0 || h.thing.dead || speed < 7) { this.hurled.splice(i, 1); continue; }
      Player._hurlPos(h, _g4);
      for (const e of ctx.enemies || []) {
        if (e.dead || e === h.thing || h.hit.has(e.id)) continue;
        const r = h.radius + (e.radius ?? 0.4) + 0.25;
        _g1.copy(e.position).setY(e.position.y + (e.A && e.A.big ? 1.4 : 0.9));
        if (_g1.distanceToSquared(_g4) > r * r) continue;
        h.hit.add(e.id);
        // Kinetic energy, scaled to the damage numbers this game uses: a 22 kg
        // crate at 40 m/s reads 21, a 210 kg droideka body at 25 reads 79, and
        // the ceiling stops a pillar from one-shotting a boss. The record was
        // built carrying `k`, `floor` and `cap`, which is exactly the rule's
        // own signature — and `Forest._sweep` prices a falling trunk through
        // the same function rather than through a second copy of this line.
        const dmg = impactDamage(h.mass, speed, h);
        _g2.copy(_g3).multiplyScalar(1 / Math.max(1e-3, speed));
        e.applyKnockback(_g2.clone().multiplyScalar(clamp(speed * 0.5, 4, 22)).setY(4), dmg, this);
        /* BOTH BODIES TAKE A SHARE. A person thrown into a person hurts the
         * person who was thrown, and that is what makes a living projectile a
         * decision rather than a free crowd-clear: you are spending the body
         * you are holding. A crate takes nothing, because a crate has no
         * health and shattering it is `Prop`'s own business. */
        if (h.isBody && !h.thing.dead) {
          h.thing.damage?.(dmg * 0.55, e.position, this, 'impact');
          h.thing.stun?.(0.5, _g2, 1.0);
        }
        audio.thud(_g4, clamp(dmg / 60, 0.4, 1.4));
        this.camera.addShake(clamp(dmg / 220, 0.04, 0.3));
        ctx.particles?.sparkBurst(_g4, null, 14, { speed: 7 });
        // A throw sheds most of its momentum into whatever it hit.
        if (h.isBody) {
          const a = h.thing.actor;
          if (a?.ragdolled) for (const b of a.bodies.values()) b.velocity.multiplyScalar(0.4);
        } else {
          h.thing.velocity.multiplyScalar(0.35);
        }
      }
    }
  }

  /**
   * A HELD THING IS STILL A REAL OBJECT — the other half of note #9.
   *
   * "if I pick up a trooper and move him through a column of other men it
   * doesnt hit them or move them passively." A throw is one event and this is
   * the continuous one: whatever is in the grip sweeps against the field every
   * frame it is MOVING, and shoves what it crosses.
   *
   * It is a shove and not a throw, on purpose. Damage is a tenth of the
   * throw's rate and capped low, because the interesting thing about swinging
   * a body through a line is the LINE COMING APART — bodies staggering, losing
   * their guard and being pushed off their marks — and not the damage number.
   * Killing a squad by waving one droid at them would make the throw pointless
   * and make the grip the best weapon in the game.
   *
   * `_sweptHit` is a per-victim cooldown rather than a one-shot set, because
   * unlike a throw the grip is a thing you can hold: a set would let you sweep
   * a body through a rank once and never again, and a raw per-frame test would
   * bill sixty hits a second.
   */
  _sweepHeld(dt, ctx, pos, radius, vel) {
    const speed = vel.length();
    if (speed < 3.5) return;
    const cd = this._sweptHit || (this._sweptHit = new Map());
    for (const [id, t] of cd) { const n = t - dt; if (n <= 0) cd.delete(id); else cd.set(id, n); }
    const held = this.gripEnemy;
    for (const e of ctx.enemies || []) {
      if (e.dead || e === held || cd.has(e.id)) continue;
      const r = radius + (e.radius ?? 0.4) + 0.3;
      _g1.copy(e.position).setY(e.position.y + (e.A && e.A.big ? 1.4 : 0.9));
      if (_g1.distanceToSquared(pos) > r * r) continue;
      cd.set(e.id, 0.55);
      const mass = this.gripBody ? Math.max(1, this.gripBody.mass) : heldMass(held);
      const dmg = impactDamage(mass, speed, { k: 0.00004, floor: 3, cap: 18 });
      _g2.copy(vel).multiplyScalar(1 / Math.max(1e-3, speed));
      e.applyKnockback(_g2.clone().multiplyScalar(clamp(speed * 0.62, 5, 17)).setY(2.6), dmg, this);
      if (held && !held.dead) held.damage?.(dmg * 0.4, e.position, this, 'impact');
      audio.thud(pos, clamp(dmg / 40, 0.3, 0.9));
      ctx.particles?.sparkBurst(pos, null, 7, { speed: 5 });
    }
  }

  /**
   * THE HILT THE FORCE IS HOLDING, or null.
   *
   * One reader for a question four places ask, and it goes through the body's
   * own `userData.prop` — the same door the blade and the bolt test use to get
   * from a physics body back to the thing it belongs to — so there is no second
   * register of "which prop is which body" to fall out of step.
   */
  _grippedHilt() {
    const b = this.gripBody;
    const prop = b && b.userData ? b.userData.prop : null;
    return prop && !prop.dead && prop.saber ? prop : null;
  }

  /**
   * STRIKE A LIGHT AT A DISTANCE — *"turn it on or off using the force."*
   *
   * The ignite key already means "the blade in my hand"; this is the same key
   * meaning "the blade in my Force", and it is unambiguous because the two
   * cannot both be true — `_takeSaber` releases the grip and `swapSaber` takes
   * what the grip holds, so a hilt is either in the hand or in the air.
   *
   * A one-off price to strike it and a per-second one to keep it burning. That
   * split is the whole of what stops this being a free light switch: flicking
   * a blade on across the field is cheap, and LEAVING it on out there is what
   * the note means by "uses a lot of force power up".
   */
  igniteHeldHilt(ctx) {
    const prop = this._grippedHilt();
    if (!prop) return false;
    if (prop.saberLit) {
      igniteHilt(prop, false);
      audio.tone({ freq: 900, freqEnd: 120, dur: 0.35, gain: 0.18, type: 'sawtooth', pos: prop.body.position });
      return true;
    }
    if (!(prop.bladeLength > 0)) {
      this._refuse('ignite', 'that is a blade of metal — there is nothing to light');
      return false;
    }
    if (!this._spend(TK.ignite)) {
      this._refuse('ignite at range',
        `${this._priceOf(TK.ignite)} Force needed, you have ${Math.round(this.force)}`);
      return false;
    }
    igniteHilt(prop, true);
    audio.tone({ freq: 180, freqEnd: 900, dur: 0.4, gain: 0.2, type: 'sawtooth', pos: prop.body.position });
    this.world?.notify?.('LIT', 'the blade burns where you are holding it');
    return true;
  }

  /**
   * A BLADE FLYING ON THE FORCE CUTS WHAT IT CROSSES.
   *
   * `_sweepHeld` is the shove a held OBJECT gives, and it is deliberately
   * feeble — a tenth of a throw's rate, capped at 18 — because waving a droid
   * through a rank should stagger it rather than kill it. A lit hilt is not
   * that: it is a lightsabre, and a lightsabre that bumped people for 9 points
   * would be the least dangerous thing on the field while costing the most
   * Force in the game to fly.
   *
   * So this is its own pass, on the BLADE rather than on the hilt's bounding
   * sphere — `Dropped.hiltBlade` reads the two ends out of the mesh's own
   * transform — and it bills a per-victim gap for the same reason the sweep
   * does: a hold is a thing you can keep, and a raw per-frame test would charge
   * sixty cuts a second.
   *
   * IT DOES NOT NEED THE BLADE TO BE MOVING. A sweep is priced on speed because
   * a stationary crate is not hitting anybody; a plasma edge parked inside a
   * droid is.
   */
  _cutWithHeld(dt, ctx, prop) {
    if (!hiltBlade(prop, _tk1, _tk2)) return 0;
    const cd = this._tkCut || (this._tkCut = new Map());
    for (const [id, t] of cd) { const n = t - dt; if (n <= 0) cd.delete(id); else cd.set(id, n); }
    let hits = 0;
    for (const e of ctx.enemies || []) {
      if (e.dead || cd.has(e.id)) continue;
      /* The same "is this mine to hit" gate the blade in the hand consults —
       * one rule, one reader. A flown blade is still your blade. */
      if (!canHarm(this, e)) continue;
      const r = (e.radius ?? 0.4) + 0.24;
      _tk3.copy(e.position).setY(e.position.y + (e.A && e.A.big ? 1.4 : 0.9));
      if (segmentPointSq(_tk1, _tk2, _tk3) > r * r) continue;
      cd.set(e.id, TK.cutGap);
      hits++;
      const at = _tk3.clone();
      e.damage(TK.cut, at, this, 'saber');
      audio.clash(at, 0.5);
      ctx.particles?.sparkBurst(at, null, 12, { speed: 7, color: prop.bladeColor ?? 0xffd08a });
    }
    return hits;
  }

  _updateGrip(dt, ctx) {
    const cap = this.liftCapacity;

    // ── distance control.
    // The hold point is measured from the CAMERA, which in third person sits
    // ~3.05 m behind the head — so the old floor of 1.6 m parked the object
    // 1.45 m BEHIND the chest, inside the player. Everything here is therefore
    // done on the distance in front of the CHEST and converted back, which is
    // both the number the player perceives and the one worth clamping.
    const lead = this.camera.pos.distanceTo(this.chest);
    let out = this.gripDistance - lead;
    // One notch is a fixed 12% of the current distance rather than a fixed
    // 0.6 m. That makes it fine at arm's length (19 cm a notch at 1.4 m) and
    // fast across the arena (2.2 m a notch at 18), and it costs a comparable
    // number of notches to cross the whole reach at any setting — measured
    // 14 at forcePower 0.25, 19 at 1, 25 at 4 — where the fixed step took 13,
    // 27 and 57 for the same three ranges.
    if (this._wheel) out *= Math.pow(0.88, this._wheel);
    out = clamp(out, 1.4, this.forceReach);
    this.gripDistance = lead + out;
    const hold = _v1.copy(this.camera.pos).addScaledVector(this.aimDir, this.gripDistance);

    /**
     * WHAT A HOLD COSTS — mass, distance and time, and less of all three the
     * stronger you are.
     *
     * Mass was already in it. The other two were not, and their absence is what
     * made the grip the flattest power in the game: holding a B1 at arm's
     * length and holding one at thirty-six metres cost exactly the same, and
     * holding it for a tenth of a second cost the same per second as holding it
     * for a minute. So there was no reason ever to bring anything closer and no
     * moment at which a hold became a decision.
     *
     *   distance   0.70 at the chest to 1.60 at full reach. Measured against
     *              the reach rather than a fixed metre count, so a Force Power
     *              of 4 does not make every hold "near".
     *   time       1.00 rising to 1.75 over six seconds, and it does not reset
     *              until the hold ends. Six seconds is deliberately longer than
     *              the choke takes to become dangerous (three), so the ramp
     *              bites AFTER the interesting part rather than during it.
     *   power      ÷√forceScale, the same law reach and capacity already use.
     *              At forcePower 4 a hold is half the cost per second, which is
     *              what "it grows with power" has to mean if the top of the
     *              slider is to feel like mastery rather than a bigger number.
     *
     * `_holdT` is the hold's own clock, zeroed in `releaseGrip`.
     */
    // Only while something is actually held. This ran unconditionally in its
    // first form, and `_updateGrip` is called every frame the key is down
    // whether or not the pick found anything — so the wear clock advanced
    // while the player was holding nothing at all, and the next real grip
    // started already tired.
    if (this.gripBody || this.gripEnemy) this._holdT = (this._holdT || 0) + dt;
    const far = 0.70 + 0.90 * clamp((this.gripDistance - lead) / Math.max(this.forceReach, 1e-3), 0, 1);
    const wear = 1 + 0.75 * clamp(this._holdT / 6, 0, 1);
    const effort = far * wear / Math.sqrt(Math.max(this.forceScale, 0.05));

    if (this.gripBody) {
      const b = this.gripBody;
      if (b.dead || b.mass > cap) { this.releaseGrip(); return; }
      // Heavy things cost more to hold, which is what stops the top of the
      // slider from being free. Only drop it when the Force actually ran out —
      // with drain disabled the bar sits wherever it was and this must not fire.
      /**
       * WHAT THIS FRAME COSTS — the hold, and the blade if it is burning.
       *
       * A BURNING HILT IS THE THIRD OF THE THREE THINGS THE NOTE ASKS FOR and
       * the expensive one, and the two prices are weighed TOGETHER rather than
       * charged one after the other. Charged in sequence, a bar with enough for
       * the blade but not for both paid the surcharge and then failed the hold
       * — so the light went out and the hilt hit the floor on the same frame,
       * which tells the player nothing about which price they could not meet.
       *
       * Weighed together the failure is ordered and legible: the light is the
       * luxury and goes first, in mid-air, in front of you, with the hilt still
       * in your Force; the grip is the basic and only goes when even that
       * cannot be paid.
       */
      const hilt = this._grippedHilt();
      const holdCost = this._holdRate(b.mass, false) * effort * dt;
      const litCost = hilt && hilt.saberLit ? TK.lit * effort * dt : 0;
      if (litCost > 0 && !this._canSpend(holdCost + litCost)) {
        igniteHilt(hilt, false);
        this.world?.notify?.('BLADE OUT', 'not enough Force to keep it burning out there');
      } else if (litCost > 0) {
        this._spend(litCost);
      }
      if (!this._spend(holdCost)) { this.releaseGrip(); return; }
      /**
       * ── AND SOMEBODY ELSE MAY HAVE A HAND ON IT ──────────────────────────
       *
       * `gripClaim` is the whole of the contest and its arithmetic is
       * `forceResistance` — see the block over it in Enemy.js. Uncontested it
       * answers `share 1, drain 0` and the point that went in, so every hold in
       * a single-player game takes exactly the path it took before.
       *
       * Contested it answers the SHARED resolution, which both grippers compute
       * identically in the same frame, plus what this hand owes for resisting
       * the other's pull. That price goes through `_spend` like every other
       * Force price, so the Force Drain slider and the `forceCost` boons reach
       * it — and so running out ends the hold through the door it already ended
       * through. Losing a tug-of-war is not a new failure mode; it is the bar
       * emptying faster because two people are pulling.
       */
      const g = gripClaim(b, this, hold, this._gripPull(b.mass, false), {
        time: ctx.time || 0, pool: this.force, beaten: this._guardOpen(),
        radius: b.boundingRadius || 0.5, out: _gc,
      });
      this.gripShare = g.share;
      if (g.drain > 0 && !this._spend(g.drain * dt)) { this.releaseGrip(); return; }
      const heft = this._heft(b.mass);
      b.wake();
      _v2.subVectors(g.point, b.position);
      b.velocity.copy(_v2).multiplyScalar(9 * heft).clampLength(0, 28 * heft);
      b.angularVelocity.multiplyScalar(1 - dt * 2);
      b.angularVelocity.y += dt * 2.2 * heft;
      if (ctx.particles && rng() < 0.4) {
        ctx.particles.plasma.spawn(b.position, _v3.set(0, 0, 0),
          { life: 0.3, size: b.boundingRadius * 1.5, drag: 1, gravity: 0, color: 0x88bbff, alpha: 0.12 });
      }
      // …and while it moves it is a real object. See `_sweepHeld`.
      this._sweepHeld(dt, ctx, b.position, b.boundingRadius, b.velocity);
      if (hilt) {
        if (hilt.saberLit) this._cutWithHeld(dt, ctx, hilt);
        /**
         * AND IT COMES BACK TO THE HAND ON ITS OWN once you have reeled it in.
         *
         * *"once you bring it and retract it as close to yourself as possible
         * you just pick it up from the air."* Not a key: the player has already
         * spent one bringing it in, and asking for a second press at exactly
         * the moment the weapon is floating in front of their face is the shape
         * of thing that reads as the pick-up having failed. Only into an EMPTY
         * hand — with a blade already in it this would silently swap your
         * weapon for whatever you happened to reel past.
         */
        if (this.saberDown && hiltDistanceSq(hilt, this) < TK.reach * TK.reach) {
          this._takeSaber(hilt, ctx);
          return;
        }
      }
    } else if (this.gripEnemy) {
      const e = this.gripEnemy;
      /**
       * WHAT YOU ARE LIFTING, WHICH IS NOT ALWAYS ONE MAN — PLAN §4.8's second
       * bullet. `heldMass` is him plus whatever squadmate has hold of him, and
       * it is the ONLY thing this bullet changes on this side of the seam:
       * everything below reads `m` exactly as it did and every one of them now
       * answers a different question because the number did.
       *
       *   the gate below  a pair heavier than your cap is pulled out of your
       *                   hands, where the man alone was not
       *   `_holdRate`     the pair costs more Force per second than the man
       *   `_heft`         and moves more sluggishly at the end of your arm
       *   `_gripPull`     and weighs more in the two-Force-user contest, where
       *                   it cancels out of the ratio and reaches the shares
       *                   only through `forceResistance`'s pool arm — which is
       *                   what `_gripPull`'s own note predicts a heavy thing
       *                   does: it drives BOTH bars down and the emptier one
       *                   slips first.
       */
      const m = heldMass(e);
      /* AND BEING OUTWEIGHED IS AN ANSWER, NOT A SILENCE. This branch could
       * only ever fire on a cap that had changed underneath a hold; now the
       * MASS changes underneath it, and a body that leaves your hands the
       * instant his mate takes hold of him with nothing on screen reads as the
       * grip breaking. Same sentence `TOO HEAVY` already says at the pick,
       * through the same `_liftRefusal`, because it is the same fact. */
      if (!e.dead && m > cap) {
        this.lastGripRefusal = { ...this._liftRefusal({ mass: m, enemy: e }) };
        this.world?.notify?.('TOO HEAVY', this.lastGripRefusal.why);
      }
      if (e.dead || m > cap) { this.releaseGrip(); return; }
      /* SAY IT AGAIN, EVERY FRAME. This line is the whole of the lease: while
       * it runs the body stays held, and the frame it stops running for any
       * reason at all is the frame the body starts coming back. */
      e.hold();
      if (!this._spend(this._holdRate(m, true) * effort * dt)) { this.releaseGrip(); return; }
      // Enemy.update damps its own position toward liftTarget at a fixed rate,
      // so the only place a heavy body can be made to FEEL heavy from here is
      // the target: walk it toward the hold point at a speed the Force can
      // actually manage rather than teleporting it there every frame.
      dampVec(this._liftPoint, hold, 0.8 + 3.4 * this._heft(m), dt);
      /* THE SAME CONTEST AS THE CRATE ABOVE, and the note over it covers both.
       * THE CLAIM IS `_liftPoint` AND NOT `hold`: the mass-lagged point is where
       * this hand actually is, and the contest is between two hands rather than
       * between two crosshairs. `liftTarget` then gets a COPY of the shared
       * resolution rather than an alias of `_liftPoint`, because two grippers
       * aliasing one field is precisely the last-writer-wins the contest
       * exists to end — with the copy both write the same value and it does not
       * matter which of them ran last. */
      const g = gripClaim(e, this, this._liftPoint, this._gripPull(m, true), {
        time: ctx.time || 0, pool: this.force, beaten: this._guardOpen(),
        radius: e.radius ?? 0.55, out: _gc,
      });
      this.gripShare = g.share;
      if (g.drain > 0 && !this._spend(g.drain * dt)) { this.releaseGrip(); return; }
      /* Made on first use, the way `_refusals` is, because the checks hold up
       * Player-shaped stand-ins that never ran the constructor. */
      e.liftTarget = (this._contestPoint ||= new THREE.Vector3()).copy(g.point);
      /* A HELD BODY IS A REAL OBJECT TOO — note #9's other half. The velocity
       * is read off the ragdoll's own chest rather than off `e.velocity`,
       * which a limp body does not drive. See `_sweepHeld`. */
      {
        const chest = e.actor?.ragdolled && (e.actor.bodies.get('chest')
          || e.actor.bodies.get('spine') || e.actor.bodies.get('hips'));
        /* A body with no velocity of its own is not moving, which is a fact
         * and not a crash. `e.velocity` is always there on a real Enemy and is
         * not on the minimal stand-ins the checks hold up — and a sweep that
         * threw on one of those took the whole choke measurement with it. */
        const vel = (chest && chest.velocity) || e.velocity;
        this._sweepHeld(dt, ctx, e.position, e.radius ?? 0.55,
          vel ? _v4.copy(vel) : _v4.set(0, 0, 0));
      }

      /**
       * FORCE CHOKE, which is what holding a living thing off the ground IS.
       *
       * The grip could already lift an enemy, walk them about and hurl them,
       * and while it held them it did no harm at all — so the most cinematic
       * thing in the source material was a way to move a droid around. It did
       * not need a key of its own; it needed a consequence.
       *
       * The rate is a FRACTION OF MAX HP rather than a flat number, because
       * this roster spans 28 hp on a B1 and 900 on an Acklay and a flat rate is
       * either an instant kill or a joke depending on which one you grabbed.
       * 12% a second ramping to 30% over three seconds kills anything held from
       * full in about four and a half — which is a long time to stand still
       * with both hands full and no blade up, and that is the trade. Big bodies
       * take it at half rate so a boss cannot simply be held to death.
       *
       * `chokeT` is published for the enemy's own animation: hands to the
       * throat, feet off the floor. Enemy.js owns that half.
       */
      e.chokeT = (e.chokeT || 0) + dt;
      const ramp = CHOKE_RATE + (CHOKE_RATE_MAX - CHOKE_RATE) * clamp(e.chokeT / 3, 0, 1);
      const rate = ramp * (e.A?.big ? 0.5 : 1);
      e.damage(e.maxHp * rate * dt, this._enemyPoint(e, _v3), this, 'choke');
      if (!this._chokeSound || ctx.time - this._chokeSound > 0.9) {
        this._chokeSound = ctx.time;
        audio.tone({ freq: 150, freqEnd: 90, dur: 0.5, gain: 0.10, type: 'sawtooth',
          pos: this._enemyPoint(e, _v3) });
      }
      if (ctx.particles && rng() < 0.3) {
        ctx.particles.plasma.spawn(this._enemyPoint(e, _v3), _v4.set(0, 0, 0),
          { life: 0.3, size: 0.8, drag: 1, gravity: 0, color: 0x88bbff, alpha: 0.12 });
      }
    }
  }

  throwOrRecall(ctx) {
    if (this.throwState === 'held') {
      // An empty hand throws nothing. `!this.saber.lit` already caught this by
      // accident — a dropped blade is out — but only by accident, and the
      // silence was indistinguishable from a bug. Say so.
      if (this.saberDown) return this._refuse('saber throw', 'your hands are empty');
      /* THE OTHER TWO STATES, AND THEY WERE ONE BARE `return` BETWEEN THEM.
       * The comment above says the silence was indistinguishable from a bug and
       * then this line kept two more of it. An UNLIT blade is the one that
       * matters: a player who has just retracted the blade and presses throw is
       * holding a hilt, not a weapon, and there is nothing on screen to say so
       * — the arm does not even move. The cooldown is short (0.4 s) and the
       * refusal is rate-limited to one in 0.7 s anyway, so it costs at most one
       * line for a key held down. */
      if (!this.saber.lit) {
        return this._refuse('saber throw', 'the blade is out — ignite it first');
      }
      if (this.cooldowns.throw > 0) {
        return this._refuse('saber throw', `recovering — ${this.cooldowns.throw.toFixed(1)}s`);
      }
      /* Through `_spend`, not `this.force -= …`. The hand-rolled version
       * applied the boon multiplier and ignored the drain slider entirely, so
       * Force Drain at 0 — the setting whose own label reads "unlimited Force"
       * — freed six powers and kept charging for this one. */
      if (!this._spend(POWER_COST.throw)) {
        return this._refuse('saber throw', `${this._priceOf(POWER_COST.throw)} Force needed, you have ${Math.round(this.force)}`);
      }
      /**
       * NOT SET HERE ANY MORE — see the catch below.
       *
       * `cooldowns.throw = 0.4` at the moment of release was, measured against
       * the blade's own flight, DEAD CODE. The blade flies for up to
       * `throwTimer > 1.5` seconds before it even turns round, and then has to
       * fly back; the shortest possible round trip is longer than 0.4 s, so by
       * the time the saber is in your hand and `throwState` is `held` again the
       * cooldown has ALWAYS expired. Nothing was ever gated. The player:
       * "the lightsaber throw (R) needs a longer cooldown, it's a crazy
       * effective move with no significant cooldown so it makes sense to just
       * spam it rather than anything else."
       *
       * A cooldown that runs while the power is still going off is not a
       * cooldown, it is a decoration. It starts when the blade is back in the
       * hand, which is the only moment the throw is actually over.
       */
      this._gesture('cast');
      this._forceVoice('throw');
      this.throwState = 'flying';
      this.throwPos.copy(this.saber.base);
      this.throwVel.copy(this.aimDir).multiplyScalar(26);
      this.throwTimer = 0;
      this.throwSpin = 0;
      audio.force(this.saber.base, 'push');
      audio.swing(24, this.saber.base);
    } else {
      this.throwState = 'returning';
    }
  }

  /**
   * TAKE HOLD OF YOUR OWN BLADE IN MID-AIR — *"with the force being able your
   * turn/manipulate the saber anywhere you want on the battlefield within a
   * certain distance (uses a lot of force power up etc. obviously)."*
   *
   * A THIRD STATE IN A MACHINE THAT ALREADY HAD TWO, and not a new mechanic:
   * `flying` is a disc on a 1.5 s fuse and `returning` is it coming home. What
   * was missing between them is the blade STAYING where you sent it, and that
   * is what "manipulate it anywhere on the battlefield" means — it hangs at the
   * end of your sightline, spinning, cutting whatever wanders into it, for
   * exactly as long as you can pay for it.
   *
   * THE GRIP KEY, because the fiction is the mechanic: your Force is holding
   * it, and the key that means "my Force is holding that" is `grip`. It is also
   * the only free key at that moment — the blade is out, so `hurl` and `throw`
   * both already mean something.
   *
   * The recall is unchanged: `throw` brings it home from `piloted` exactly as
   * it does from `flying`, so the control a player already has never stops
   * working.
   */
  pilotThrown(ctx) {
    if (this.throwState === 'piloted') { this.throwState = 'flying'; this.throwTimer = 0; return true; }
    if (this.throwState !== 'flying') return false;
    if (!this._spend(POWER_COST.grip)) {
      this._refuse('hold the blade',
        `${this._priceOf(POWER_COST.grip)} Force needed, you have ${Math.round(this.force)}`);
      return false;
    }
    this.throwState = 'piloted';
    /* Where it is NOW, in front-of-the-chest terms, so taking hold of a blade
     * thirty metres out does not yank it to arm's length on the first frame.
     * The same conversion `_updateGrip` uses and for the same reason: the hold
     * point is measured from the CAMERA, which is not where the player is. */
    const lead = this.camera.pos.distanceTo(this.chest);
    this.throwDist = clamp(this.camera.pos.distanceTo(this.throwPos), lead + 1.4, lead + this.forceReach);
    this._gesture('grip');
    audio.force(this.throwPos, 'pull');
    this.world?.notify?.('BLADE HELD', 'your Force has it — steer with the reticle, throw to recall');
    return true;
  }

  _updateThrow(dt, ctx) {
    this.throwTimer += dt;
    this.throwSpin += dt * 27;

    if (this.throwState === 'piloted') {
      /**
       * WHAT IT COSTS, and it is meant to be the most expensive thing the Force
       * does. `TK.lit` is the burning-blade surcharge a Force-held hilt pays;
       * `HOLD_COST.prop.base` is what holding any object costs; and both are
       * scaled by DISTANCE, so parking your blade across the arena costs
       * roughly double parking it in front of you. Running out does not drop it
       * on the floor — it comes home, which is the failure a player can live
       * with in the middle of a fight.
       */
      const lead = this.camera.pos.distanceTo(this.chest);
      if (this._wheel) this.throwDist *= Math.pow(0.88, this._wheel);
      this.throwDist = clamp(this.throwDist, lead + 1.4, lead + this.forceReach);
      const far = 0.70 + 0.90 * clamp((this.throwDist - lead) / Math.max(this.forceReach, 1e-3), 0, 1);
      const effort = far / Math.sqrt(Math.max(this.forceScale, 0.05));
      if (!this._spend((TK.lit + HOLD_COST.prop.base) * effort * dt, true)) {
        this.throwState = 'returning';
        this.world?.notify?.('BLADE RECALLED', 'not enough Force to keep holding it out there');
      } else {
        _v1.copy(this.camera.pos).addScaledVector(this.aimDir, this.throwDist);
        /* Damped rather than snapped: a blade that teleports to the reticle is
         * a cursor, and the weight is the whole reason this reads as the Force
         * carrying something heavy rather than as a flying pointer. */
        _v2.subVectors(_v1, this.throwPos);
        this.throwVel.lerp(_v2.multiplyScalar(6), clamp(dt * 8, 0, 1));
        this.throwPos.addScaledVector(this.throwVel, dt);
        if (ctx.particles && rng() < 0.35) {
          ctx.particles.plasma.spawn(this.throwPos, _v3.set(0, 0, 0),
            { life: 0.3, size: 0.55, drag: 1, gravity: 0, color: 0x88bbff, alpha: 0.14 });
        }
      }
    } else if (this.throwState === 'flying') {
      // steerable: the blade drifts toward where you are looking
      _v1.copy(this.aimDir).multiplyScalar(26);
      this.throwVel.lerp(_v1, clamp(dt * 1.4, 0, 1));
      this.throwPos.addScaledVector(this.throwVel, dt);
      if (this.throwTimer > 1.5) this.throwState = 'returning';
    } else {
      _v1.subVectors(this.control.handPos, this.throwPos);
      const d = _v1.length();
      if (d < 0.45) {
        this.throwState = 'held';
        this.control.handPos.copy(this.throwPos);
        audio.clash(this.throwPos, 0.4);
        /**
         * THE RECOVERY, AND IT STARTS HERE BECAUSE HERE IS WHERE THE THROW
         * ENDS. See the note at `throwOrRecall`.
         *
         * 2.2 s, and the number is read off the table the rest of the powers
         * already form rather than picked. Every cooldown in this file:
         *
         *     throw 0.4(was)  dash 0.55  push 0.55  pull 0.6  lightning 1.1
         *     shield 1.2  stasis 1.4  rend 2.4  compel 7  unleash 9
         *
         * The throw was the SHORTEST in the game, under a dash — for a ranged
         * attack that hits everything along a steerable line, cannot be
         * blocked by a body, and costs 14 Force against push's 20. It belongs
         * beside `rend` at 2.4: a committed, high-value act you spend a beat
         * recovering from. A hair under it because the throw also leaves you
         * holding nothing while it is out, which `rend` does not.
         */
        this.cooldowns.throw = 2.2;
        return;
      }
      _v1.multiplyScalar(1 / d);
      this.throwVel.lerp(_v2.copy(_v1).multiplyScalar(clamp(d * 7, 12, 34)), clamp(dt * 7, 0, 1));
      this.throwPos.addScaledVector(this.throwVel, dt);
    }

    /**
     * AND IT DOES NOT GO UNDER THE FLOOR.
     *
     * `_updateThrow` had no terrain reference of any kind: the disc flew a
     * straight line from wherever it left the hand at whatever pitch, and the
     * ground was not in the simulation. The player's note 26 opens "thrown
     * saber vanishes into the ground", and it is not an edge case you have to
     * aim for — `Player.js`'s own default camera pitch is -0.06 rad, so at the
     * RESTING aim, with no deliberate downward throw at all, the blade spends
     * 125 of its 176 flight frames below the surface, up to 5.04 m down. At
     * -25 degrees it reaches 15.03 m.
     *
     * A disc that grazes the ground rides ALONG it rather than through it, and
     * the sparks and the cut line come for free: `Saber.update` already calls
     * `ground.scar(prevTip, tip)` on every lit frame, which is why the buried
     * blade was measured gouging a trench 8-34 times while invisible. The mark
     * was always right; the height was not.
     *
     * `clear` is the disc's own half-height plus the blade's glow, so it skims
     * with the emitter just proud of the surface instead of clipping into it.
     * Killing only the DOWNWARD velocity leaves the steering and the return
     * untouched — the blade still turns toward where you look, and a return
     * leg climbing to the hand is unaffected because it is already rising.
     */
    const terrain = ctx.terrain || this.world.terrain;
    if (terrain) {
      const clear = 0.34;
      const gh = terrain.height(this.throwPos.x, this.throwPos.z) + clear;
      if (this.throwPos.y < gh) {
        this.throwPos.y = gh;
        if (this.throwVel.y < 0) this.throwVel.y = 0;
      }
    }

    // the flying blade is a horizontal spinning disc
    _q1.setFromAxisAngle(UP, this.throwSpin);
    _q2.setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI / 2);
    this.saber.setHiltPose(this.throwPos, _q1.multiply(_q2));
    this.saber.setVisible(true);

    if (ctx.particles && rng() < 0.5) {
      ctx.particles.plasma.spawn(this.throwPos, _v3.set(0, 0, 0),
        { life: 0.2, size: 0.5, drag: 1, gravity: 0, color: this.saber.color.getHex(), alpha: 0.35 });
    }
  }

  toggleSense(ctx) {
    if (this.senseActive) {
      this.senseActive = false;
      this.world.setTimeScale(1);
      this.world.engine.setSense(0);
      return;
    }
    /* `_canSpend`, not `force < 25`: Sense is a THRESHOLD rather than a cost —
     * it takes nothing out of the bar, it stops the bar refilling while it is
     * on (see _regen) — so the fix is to ask the economy whether the threshold
     * applies at all, which it does not when the drain slider is at 0. */
    if (!this._canSpend(POWER_COST.sense)) {
      return this._refuse('force sense', `${this._priceOf(POWER_COST.sense)} Force needed, you have ${Math.round(this.force)}`);
    }
    this.senseActive = true;
    // A one-shot, not a hold. Sense is a mode you can leave running for a whole
    // fight, and a sustained gesture would have the off hand raised — and the
    // blade one-handed — for the entire duration of it.
    this._gesture('sense');
    this._forceVoice('sense');
    this.world.setTimeScale(0.42);
    this.world.engine.setSense(1);
    audio.force(this.chest, 'sense');
  }

  /**
   * FORCE LIGHTNING — pressed, and then HELD.
   *
   * This opens the channel. Everything that happens while it is open is
   * `_lightningTick`, which runs every frame from `_move`'s caller, and the
   * whole reason the power is split in two is the player's own note: the old
   * version resolved in one call, so there was nothing to see travel and
   * nothing to sweep. See LIGHTNING_HOLD.
   */
  forceLightning(ctx) {
    if (!this.boonMods.lightning) {
      return this._refuse('force lightning', 'not attuned — it comes from a boon, and the draft offers it');
    }
    if (this.cooldowns.lightning > 0) {
      return this._refuse('force lightning', `recovering — ${this.cooldowns.lightning.toFixed(1)}s`);
    }
    /* ALREADY RUNNING, AND SAY SO. This was a bare `return`, which is the
     * shape of silence the whole of `_refuse` exists to delete: three states
     * that all did nothing and looked identical from the keyboard. */
    if (this.channel?.kind === 'lightning') {
      return this._refuse('force lightning', 'already channelling — let go of the key first');
    }
    if (!this._spend(POWER_COST.lightning)) {
      return this._refuse('force lightning',
        `${this._priceOf(POWER_COST.lightning)} Force needed, you have ${Math.round(this.force)}`);
    }
    this._gesture('lightning');
    this._forceVoice('lightning');
    audio.force(this.chest, 'lightning');
    /** The live channel. `t` is how long it has been open, `tick` is the fuse
     *  on the next damage application, and `hit` is what has already been
     *  struck THIS TICK — a chain that could revisit is a loop with a damage
     *  multiplier, which is the note the old chain carried and is still true. */
    this.channel = { kind: 'lightning', t: 0, tick: 0, hits: 0 };
    this._lightningTick(ctx, 0);
  }

  /** Shut the channel and start the recovery. Idempotent. */
  endLightning() {
    if (this.channel?.kind !== 'lightning') return;
    this.channel = null;
    this.cooldowns.lightning = 1.1;
    this._endGesture?.('lightning');
    this.world?.lightning?.clear?.();
  }

  /**
   * WHERE THE DISCHARGE ENDS — and it ALWAYS ends somewhere.
   *
   * This is the single most important line of the whole rewrite. The old power
   * drew between the hand and each body it hit, so when it hit nothing it drew
   * nothing; the player pressed the key at an empty stretch of ground and the
   * game did not visibly respond. The answer is that lightning does not need a
   * victim to exist — it needs a PLACE TO EARTH.
   *
   * Four candidates, in order, and one of them is always true:
   *   a body inside the cone, which is the aim assist the power always had;
   *   whatever the physics ray hits, which is the wall or the crate;
   *   the ground under the ray, if the ray is heading down into it;
   *   and failing all three, the end of `LIGHTNING_RANGE` in the air, because
   *     a bolt into open sky is still a bolt and is still the answer to
   *     "I need to be able to see the lightning come out".
   */
  _lightningEnd(ctx, origin, out) {
    let best = null, bestD = Infinity;
    for (const e of this._foes(ctx)) {
      if (e.dead) continue;
      _v2.subVectors(this._enemyPoint(e, _v3), origin);
      const d = _v2.length();
      if (d > LIGHTNING_RANGE) continue;
      /* `LIGHTNING_CONE` is 17.3°, which is a generous but honest cone — the
       * old 0.8 was 37° and swallowed bodies the player was plainly not
       * pointing at, which is its own kind of "it does nothing". */
      if (_v2.normalize().dot(this.aimDir) < LIGHTNING_CONE) continue;
      if (d < bestD) { bestD = d; best = e; }
    }
    if (best) { this._enemyPoint(best, out); return best; }
    const to = _v3.copy(origin).addScaledVector(this.aimDir, LIGHTNING_RANGE);
    /* STATICS AND PROPS ONLY. A null filter earths the bolt on the FIRST
     * collider the ray meets, and at 35 cm in front of the chest that is
     * reliably the player's own capsule — measured at 2.5 m of reach against a
     * 22 m range, which looks exactly like the power being weak rather than the
     * ray being wrong. The same predicate the camera's own occlusion cast
     * uses, for the same reason. */
    const hit = ctx.physics?.raycast?.(origin, this.aimDir, LIGHTNING_RANGE,
      (b) => b.static || b.layer === LAYER.PROP);
    if (hit && hit.point) { out.copy(hit.point); return null; }
    if (ctx.terrain && this.aimDir.y < -0.02) {
      /* Walk the ray until it is under the ground, then take that point. Ten
       * samples over 22 m is a little over two metres of resolution, which is
       * inside the width of the bolt itself. */
      for (let i = 1; i <= 10; i++) {
        const t = (i / 10) * LIGHTNING_RANGE;
        _v4.copy(origin).addScaledVector(this.aimDir, t);
        const h = ctx.terrain.height(_v4.x, _v4.z);
        if (_v4.y <= h) { out.set(_v4.x, h + 0.05, _v4.z); return null; }
      }
    }
    out.copy(to);
    return null;
  }

  /**
   * THE CHANNEL, ONE FRAME OF IT.
   *
   * Drawn every frame and damaging every `LIGHTNING_TICK`, which is the split
   * that lets it look continuous and cost what it always cost. Both hands
   * throw, because the reference is two hands and because a bolt from one hand
   * reads as a gun.
   *
   * THE CHAIN IS UNCHANGED IN RULE and rebuilt every tick rather than once:
   * `LIGHTNING_CHAIN` hops of `LIGHTNING_REACH` metres, each keeping
   * `LIGHTNING_FALLOFF` of the last one's damage, so the fourth body in a line
   * is singed rather than killed. What is new is that the chain is re-found
   * every tick, so sweeping the channel across a line walks the discharge down
   * it — which is the thing a one-frame power could not do.
   */
  _lightningTick(ctx, dt) {
    const ch = this.channel;
    if (!ch || ch.kind !== 'lightning') return;
    ch.t += dt;
    if (ch.t >= LIGHTNING_HOLD) { this.endLightning(); return; }
    /* THE HOLD COSTS. `_spend` refuses rather than overdrawing, and a refusal
     * here is a channel that has run the pool dry — which ends it, with the
     * hands still up, exactly as running out of Force should. */
    if (dt > 0 && !this._spend(LIGHTNING_DRAIN * dt, true)) { this.endLightning(); return; }

    const vfx = this.world?.lightning;
    const origin = _v1.copy(this.chest).addScaledVector(this.aimDir, 0.35);
    const target = new THREE.Vector3();
    const struck = this._lightningEnd(ctx, origin, target);

    /* ── THE FRONT, which is what stops this being a hitscan ───────────
     *
     * `_lightningEnd` answers instantly and always did; what was missing was
     * anything between the answer and the consequence. `ch.reach` is how far
     * the discharge has actually got, growing at LIGHTNING_SPEED and surviving
     * across ticks, so sweeping the channel onto a NEARER body arrives at once
     * while swinging it out to a far one has to travel again.
     *
     * Clamped to the current distance rather than reset by it: a front that had
     * already crossed twelve metres has crossed them, and a target that steps
     * closer does not push the lightning back into your hands. */
    const dist = origin.distanceTo(target);
    ch.reach = Math.min(dist, (ch.reach ?? 0) + LIGHTNING_SPEED * dt);
    const arrived = ch.reach >= dist - 1e-3;
    /* Where the bolt is drawn TO. While the front is still crossing, this is a
     * point in mid-air and the arc genuinely stops short of the victim. */
    const tip = _v8.copy(origin)
      .addScaledVector(_v9.subVectors(target, origin).normalize(), Math.max(ch.reach, 0.05));

    /* ── the drawing ─────────────────────────────────────────────────── */
    if (vfx) {
      vfx.setColor?.(this._lightningColor());
      /* FROM THE HANDS. `handR`/`handL` are the rig's own bones, so the bolts
       * leave the palms wherever the gesture has actually put them rather than
       * from a point near the chest — which is the difference between "it comes
       * out of your hands" and a beam that starts inside your ribcage. */
      const rig = this.rig;
      for (const bone of ['handR', 'handL']) {
        const h = rig?.get?.(bone);
        const from = _v5;
        if (h?.obj) h.obj.getWorldPosition(from); else from.copy(origin);
        /* The two hands' bolts meet a little in front of the chest and then run
         * on as one, which is the shape of the reference: two arcs converging
         * into a single discharge. */
        vfx.strike(from, tip, { power: 1, life: 0.10, chaos: 1 });
        if (rng() < 0.5) {
          _v6.subVectors(tip, from);
          vfx.fork(_v7.lerpVectors(from, target, 0.3 + rng() * 0.5), _v6, 1.0 + rng() * 2.2, { power: 1 });
        }
      }
      /* AND IT LIGHTS THE WORLD. A discharge that leaves the ground unlit is a
       * decal; `Engine.lightUp` is the same eight-slot pool the blades use, so
       * this competes for a slot rather than recompiling every lit material. */
      this.world.engine?.lightUp?.(tip, _COL_LIGHT.setHex(this._lightningColor()),
        7.5 + Math.sin(ch.t * 40) * 2.5, 12, 2);
      this.world.engine?.lightUp?.(origin, _COL_LIGHT, 4.0, 7, 2);
    }
    /* THE CRACKLE, re-struck rather than looped: `audio.force` is a one-shot
     * and a channel that fired it once was silent for two seconds. */
    if (ch.t - (ch.said ?? -1) > 0.18) { ch.said = ch.t; audio.force?.(this.chest, 'lightning'); }

    /* ── the damage ──────────────────────────────────────────────────── */
    ch.tick -= dt;
    if (ch.tick > 0) return;
    /* AND A FRONT STILL CROSSING DOES NOT SPEND THE TICK.
     *
     * `forceLightning` opens the channel with `_lightningTick(ctx, 0)` so the
     * first jolt is on the press. With a travelling front and dt = 0 that frame
     * has reach 0 and cannot have arrived — correct, it has not left the hand
     * yet — but it was still consuming the tick on its way out, so the opening
     * jolt was cancelled AND the next one was pushed a full 0.22 s beyond the
     * flight time. Measured on two players 0.75 m apart: 7 damage on the press
     * before, and none at all in a whole second after.
     *
     * Held at zero rather than reset, so the clock is armed the moment the
     * front lands: press, 16 ms of flight at 120 m/s across a metre, jolt. The
     * travel is real and it is not a delay you can feel — which is the whole of
     * "it needs travel time obviously (but small)". */
    if (!arrived) { ch.tick = 0; return; }
    ch.tick = LIGHTNING_TICK;
    if (!struck) return;
    const scale = LIGHTNING_TICK / 0.55;      // per-tick share of a full jolt
    const hit = new Set();
    let from = target, node = struck, power = 1;
    for (let hop = 0; hop <= LIGHTNING_CHAIN && node; hop++) {
      if (hit.has(node)) break;
      hit.add(node);
      ch.hits++;
      if (hop > 0 && vfx) vfx.strike(from, this._enemyPoint(node, _v6), { power: power * 0.8, life: 0.12 });
      node.damage(LIGHTNING_DAMAGE * power * scale, node.position, this, 'lightning');
      node.stun?.(0.5 * power, _v2.subVectors(node.position, from).normalize(), 0.7 * power);
      from = this._enemyPoint(node, _v4).clone();
      power *= LIGHTNING_FALLOFF;
      let best = null, bestD = LIGHTNING_REACH * LIGHTNING_REACH;
      for (const e of this._foes(ctx)) {
        if (e.dead || hit.has(e)) continue;
        const dd = e.position.distanceToSquared(from);
        if (dd < bestD) { bestD = dd; best = e; }
      }
      node = best;
    }
  }

  /**
   * UNLEASH — the 360-degree "get off me".
   *
   * Asked for in these words: "one force power that is a 360 degree 'get off
   * me' type of ability, costs a lot of force but you like yell really loud
   * and raise both your arms out and push everything around you off (like in a
   * scenario where you're being overwhelmed)". Every clause of that is a
   * requirement and each is answered below.
   *
   * WHY IT IS NOT `boonMods.repulse`. That already existed and is a different
   * thing wearing a similar name: a passive that fires when you LAND from a
   * height, which you cannot use while standing in a ring of eleven droids —
   * the exact situation this is for. The passive stays; it is a landing, this
   * is a decision.
   *
   * 360 AND NOT A CONE. `forcePush` cones off `aimDir` and that is right for
   * it. This one deliberately does not read `aimDir` at all: being surrounded
   * means there is no direction to face, and a power that asked you to pick
   * one would be answering a different question.
   *
   * THE NUMBERS, and each is against `forcePush`'s so the comparison is the
   * argument. Push reaches 9 m in a cone at impulse 26; this reaches 11 m in a
   * full circle at 34 and lands 30 damage at the centre. So it is stronger
   * than push in every term — it costs 52 Force against push's 20 (the most
   * expensive power in the game, past heal) and holds a 9-second cooldown,
   * which is long enough that it cannot be a rotation and short enough that it
   * is there for the second time a wave collapses on you.
   *
   * THE STAGGER IS THE POINT, more than the damage. Everything it reaches is
   * stunned for 1.6 s on top of the knockback — that is what buys the room the
   * player pressed it for. A version that only threw bodies would have them
   * back inside your guard by the time you had turned round.
   */
  forceUnleash(ctx) {
    if (this.cooldowns.unleash > 0) {
      return this._refuse('unleash', `recovering — ${this.cooldowns.unleash.toFixed(1)}s`);
    }
    if (!this._spend(POWER_COST.unleash)) {
      const cost = POWER_COST.unleash * (this.world.settings?.forceDrain ?? 1) * this.boonMods.forceCost;
      return this._refuse('unleash', `${Math.round(cost)} Force needed, you have ${Math.round(this.force)}`);
    }
    this.cooldowns.unleash = 9;

    /* BOTH ARMS OUT. `unleash` is already in GESTURES — it was written for
     * this shape and had no caller — and `_gesture` with no `at` is the
     * two-handed version, because `_gesturePose` mirrors when nothing is being
     * pointed at. That is why this passes no target: a target would turn it
     * back into a one-armed shove. */
    this._gesture('unleash');

    /* THE YELL. Routed through the Announcer rather than straight at
     * `audio.speak` so it takes the quip budget with it — otherwise the kill
     * lines from everything this just threw land on top of the shout that
     * threw them. `force: true` because this one is never suppressed: the
     * player pressed a button and has to hear that it happened.
     *
     * IT SAYS ITS OWN LINE NOW AND NOT 'streak'. The killstreak contour was
     * borrowed here because it was the loudest thing in LINES and this power's
     * own note asks for "you like yell really loud" — but it is the line the
     * announcer says when you kill three men in one breath, so the loudest
     * moment in the game announced itself with somebody else's sentence, and a
     * player who heard it after a genuine streak heard the same three
     * syllables mean two different things. `unleash` has four contours of its
     * own now, and they are the longest and loudest in the table because that
     * is what this power is. See `_forceVoice`, and FORCE_LINES in
     * src/engine/Voice.js. */
    this._forceVoice('unleash');
    audio.force(this.chest, 'push');
    audio.explosion(this.position, 0.7);
    this.camera.addShake(0.62);
    /* The cloak and skirt take it OUTWARD in every direction, which they can
     * do because `impulse` is a direction and a magnitude and nothing here
     * has a facing: straight up, so the cloth blows off the body rather than
     * behind it. */
    this.cloak?.impulse(_v5.set(0, 1, 0), 4.2);
    this.skirt?.impulse(_v5.set(0, 1, 0), 4.2);

    this._shockwave(ctx, UNLEASH.radius, UNLEASH.impulse, UNLEASH.damage);
    /* …and the stagger, which `_shockwave` does not do — it knocks back and
     * damages. Applied here rather than inside it because the landing
     * shockwave and the repulse boon share that function and neither should
     * start stunning. */
    for (const e of this._foes(ctx)) {
      if (e.dead) continue;
      const d = e.position.distanceTo(this.position);
      if (d > UNLEASH.radius) continue;
      _v2.subVectors(e.position, this.position).setY(0.4).normalize();
      e.stun?.(UNLEASH.stun * (1 - 0.4 * d / UNLEASH.radius), _v2, 1.2);
      /**
       * …AND IT TAKES THEIR NERVE. FLAGSHIP §7's first verb names this power by
       * name — "`unleash`, `dread`, then stand there so `JEDI_NEAR` holds your
       * nerve while theirs goes" — and until the horde had a ledger there was
       * nothing for the first word of that sentence to write to.
       *
       * `MORALE.SHAKEN` and not a number of its own: it is the same event
       * `CommandDirector`'s DREAD verb causes, which is the table's one entry
       * for "somebody reached into this body's nerve through the Force", and
       * two constants for one sentence is the twin this repository keeps
       * deleting. `shakeNerve` leaves a body with a roster record alone — that
       * number is the director's — so in a meeting the other player's troopers
       * are thrown and stunned by this and their morale is not silently
       * rewritten from outside the one door that writes it.
       */
      shakeNerve(e, MORALE.SHAKEN);
    }
    /**
     * BOLTS ARE NOT TOUCHED, and that is a decision rather than an omission.
     *
     * I wrote `ctx.bolts?.scatter?.(…)` here first, on the reasoning that
     * being overwhelmed includes being shot at. BoltPool has no `scatter` —
     * its surface is fire/hold/release/update/threatsNear/clear — so the
     * optional chaining would have made that line a silent no-op that LOOKED
     * like a feature, which is this project's signature defect (see
     * HANDOFF 2.3: a missing thing answered with a plausible default).
     *
     * And on reflection it should not do it anyway. `release` and the deflect
     * grades are how a bolt is turned in this game, and every one of them is
     * something the player did with the blade. A power that also wiped the
     * air of incoming fire would be answering the one question the whole game
     * is about. This throws BODIES; the blade is still yours to move.
     */
    this.world.engine.setRadial?.(1.0);
  }

  /**
   * FORCE HEAL.
   *
   * A channel, not a button: `HEAL_TIME` of standing still with your hands
   * down, and it is interrupted by taking a hit. That is the entire design
   * question for a heal in a game about deflecting things — an instant one is
   * simply more health, while one you have to buy with three seconds of not
   * fighting is a decision you make about the room you are standing in.
   *
   * It restores a fraction of MAXIMUM health rather than a flat number so that
   * boons which raise the pool do not quietly make it worthless.
   */
  forceHeal(ctx) {
    if (this.healing) { this._endHeal(false); return; }
    /**
     * …AND THE SAME CHANNEL MENDS THE MAN IN FRONT OF YOU.
     *
     * The player: "remind me how to heal allies". They were right to ask and
     * the honest answer was that you could not, quite: the only thing in the
     * game that put a wounded trooper back on their feet was the Resupply
     * stratagem's `reviveNear` — a call you spell out on the WASD codes, fly
     * in, and land in a radius — and nothing you could do with your hands. A
     * commander who has to call an orbital pod to help one man is a commander
     * who does not help him.
     *
     * It is the SAME power rather than a new one, because the design question
     * it answers is already solved: three seconds of standing still with your
     * hands down is what a heal costs in a game about deflecting things, and
     * that cost is exactly as interesting spent on somebody else. Aim at a
     * hurt ally inside `MEND_REACH` and the channel goes to them; aim at
     * nothing and it goes to you, which is what it always did.
     */
    const ally = this._mendTarget(ctx);
    if (!ally && this.hp >= this.maxHp) return this._refuse('force heal', 'already whole');
    if (this.cooldowns.heal > 0) {
      return this._refuse('force heal', `recovering — ${this.cooldowns.heal.toFixed(1)}s`);
    }
    if (!this._canSpend(HEAL_COST)) {
      return this._refuse('force heal', `${this._priceOf(HEAL_COST)} Force needed, you have ${Math.round(this.force)}`);
    }
    this.healTarget = ally;
    this.healing = 0;
    this._healFrom = this.hp;
    this._mendFrom = ally ? ally.hp : this.hp;
    this._gesture('mend');
    this._forceVoice('heal');
    audio.force(this.chest, 'pull');
    if (ally) {
      this.world?.notify?.('MENDING', ally.trooper?.name || ally.A?.label || 'a wounded ally');
    }
  }

  /**
   * THE WOUNDED ALLY UNDER THE RETICLE, or null for "heal yourself".
   *
   * Under the RETICLE and not "the nearest hurt friend", because a heal that
   * picks its own patient is a heal you cannot aim at the man who needs it.
   * The cone is generous — `MEND_CONE` is about 20° — since a trooper is a
   * small thing at fifteen metres and this is a mercy rather than a shot.
   *
   * A body already at full health is not a target: without that clause,
   * standing in your own line and pressing the key would mend a whole man and
   * refuse to mend you. Downed men come first — see `_updateHeal`, which
   * stands a limp one up when the channel completes.
   */
  _mendTarget(ctx) {
    const list = ctx?.enemies || this.world?.enemies;
    if (!list) return null;
    const rules = ctx?.rules ?? this.world?.rules ?? null;
    let best = null, bestScore = -Infinity;
    for (const e of list) {
      if (!e || e.dead || e === this) continue;
      /* Friendly, by the same rule every other list in this file is built
       * from: anything the powers are allowed to HARM is not an ally. */
      if (canHarm(this, e, rules)) continue;
      if (!(e.hp < (e.maxHp ?? 0))) continue;
      _v1.subVectors(e.position, this.chest);
      const d = _v1.length();
      if (d > MEND_REACH || d < 1e-3) continue;
      const dot = _v1.divideScalar(d).dot(this.aimDir);
      /* THE CONE IS THE ADMISSION TEST AND IT IS NOT THE RANKING, and running
       * the two through one variable is what got this backwards.
       *
       * It used to be one number: `bestScore` started at `MEND_CONE`, every
       * candidate had to beat it, and the winner then wrote
       * `bestScore = dot - (ragdolled ? 0.05 : 0)`. Read as a ranking that is
       * the wrong sign — subtracting from the bar LOWERS it, so choosing the
       * limp man made him 0.05 EASIER for the next upright body to displace,
       * which is the exact opposite of the sentence above it.
       *
       * Measured: a limp trooper dead ahead at dot 0.9856, first in the list,
       * against an upright one at 0.9775 — a strictly worse angle — and the
       * upright one won. So the man lying on the floor could not be picked at
       * all while anybody standing was within 0.05 of him, and the ONE case
       * the preference exists for is the one where somebody else is standing
       * over the casualty.
       *
       * Two numbers now. `MEND_CONE` admits, `score` ranks, and the limp man's
       * edge is added to HIS score rather than taken off everyone else's bar —
       * so he wins a tie and wins by `MEND_LIMP_EDGE` of angle, and he still
       * has to be inside the cone the player aimed. `<=` keeps the first body
       * in the list on an exact tie, which is what the old test did. */
      if (dot < MEND_CONE) continue;
      /* A LIMP MAN OUTRANKS A HURT ONE at the same angle: he is the one who is
       * out of the fight entirely. */
      const score = dot + (e.actor?.ragdolled ? MEND_LIMP_EDGE : 0);
      if (score <= bestScore) continue;
      bestScore = score;
      best = e;
    }
    return best;
  }

  /**
   * THE FORCE BARRIER — raise it, hold it, and pay for what it stops.
   *
   * The player asked for this twice, the second time to check whether they had
   * simply missed it: "did you already add the force shield/bubble in the game?
   * i'd already asked for it but I could have missed it." They had not. There
   * were eleven Force verbs and none of them shielded anything.
   *
   * ── WHY IT IS A HELD BARRIER AND NOT A BUFF ─────────────────────────────
   *
   * The cheap version of this power is a timer: press it, take no damage for
   * four seconds, press it again in twenty. That is a cooldown wearing a
   * bubble, and it makes the fight worse — the player learns a rotation and
   * stops reading the room. This one is a CHANNEL, like the lightning and the
   * mend: it is up while you hold it, it drains while it is up, and every bolt
   * that dies on it costs you more (see `SHIELD`). So the question it asks is
   * the one a barrier should ask — how long can I afford to stand here — and
   * the answer changes with how many rifles are pointed at you.
   *
   * IT DOES NOT STOP A BLADE. Nothing here touches `bladeTargets` or the
   * contact solver: a lightsabre goes through it, and so does anything that
   * reaches you by walking — blunted by SHIELD.blunt in `damage` and no more
   * than that. A wall against everything is a wall against having to move, and
   * moving is the game.
   */
  forceShield(ctx) {
    if (this.shield.up) { this._endShield(); return; }
    if (this.cooldowns.shield > 0) {
      return this._refuse('force barrier', `recovering — ${this.cooldowns.shield.toFixed(1)}s`);
    }
    if (!this._spend(POWER_COST.shield)) {
      return this._refuse('force barrier',
        `${this._priceOf(POWER_COST.shield)} Force needed, you have ${Math.round(this.force)}`);
    }
    this.shield.up = true;
    this.shield.t = 0;
    this.shield.stopped = 0;
    this._gesture('guard');
    this._forceVoice?.('shield');
    audio.force(this.chest, 'pull');
    audio.tone({ freq: 180, freqEnd: 520, dur: 0.35, gain: 0.12, type: 'sine', pos: this.chest });
  }

  /** Down, however it ended. Idempotent. */
  _endShield(why = null) {
    if (!this.shield.up) return;
    this.shield.up = false;
    /* A SHORT RECOVERY AND NOT A LONG ONE. The cost of this power is the drain
     * while it is up, not a lockout after it: a cooldown long enough to matter
     * would turn "when do I lower it" — the only interesting question here —
     * into "it lowered itself". */
    this.cooldowns.shield = 1.2;
    this._endGesture('guard');
    if (why) this.world?.notify?.('BARRIER DOWN', why);
  }

  /**
   * WHERE THE BARRIER IS, for anything that has to test against it — or null.
   *
   * A sphere at the chest rather than at the feet, because that is what a body
   * shelters behind, and it is READ rather than stored so a moving player's
   * barrier moves with them exactly. `World._boltHitTest` is the one caller
   * that matters; it is deliberately the same shape of reader as `shieldBody`
   * one method up, which is the held-body cover this game already had.
   */
  shieldSphere() {
    if (!this.shield.up || this.shield.power < 0.25) return null;
    return { c: this.chest, r: SHIELD.radius };
  }

  /**
   * A BOLT DIED ON IT — called by the world's own hit test, which is the only
   * thing that knows a bolt was going to reach you.
   *
   * The Force is spent HERE rather than per second, because what a barrier
   * costs is what it is asked to do. Running the pool dry drops it, which is
   * the loud, legible failure a player can plan around: the bubble goes out
   * and the next round in the burst arrives.
   */
  shieldAbsorb(point) {
    if (!this.shield.up) return false;
    this.shield.stopped++;
    this.shield.lastHit = this.world?.time ?? 0;
    if (point) this._shieldFlash(point);
    if (!this._spend(SHIELD.bolt, true)) { this._endShield('the Force ran out'); return true; }
    return true;
  }

  _shieldFlash(point) {
    audio.tone({ freq: 900, freqEnd: 300, dur: 0.12, gain: 0.10, type: 'triangle', pos: point });
    const p = this.world?.particles;
    if (!p) return;
    for (let i = 0; i < 4; i++) {
      _g1.set((rng() - 0.5) * 2, (rng() - 0.5) * 2, (rng() - 0.5) * 2).normalize().multiplyScalar(1.6);
      p.plasma.spawn(point, _g1, { life: 0.22, size: 0.30, drag: 3, gravity: 0, color: 0x66ddff, alpha: 0.5 });
    }
  }

  /** One frame of it. Called from `update` while the barrier exists. */
  _updateShield(dt, ctx) {
    const S = this.shield;
    /* THE MESH IS BUILT ON FIRST USE, so a player who never raises one never
     * pays for the geometry — and it is the droideka's own bubble, from
     * `buildShieldBubble`, so the two cannot drift apart. */
    if (S.up && !this._shieldMesh && this.world?.scene) {
      const b = buildShieldBubble({ radius: SHIELD.radius, color: 0x8fd8ff });
      this._shieldMesh = b.mesh;
      this._shieldMat = b.mat;
      this.world.scene.add(b.mesh);
    }
    if (S.up) {
      S.t += dt;
      if (!this._spend(SHIELD.hold * dt, true)) { this._endShield('the Force ran out'); }
    }
    /* EASED BOTH WAYS. `rise` and `fall` are what stop it popping into
     * existence, and `shieldSphere` refuses to answer under a quarter power —
     * so the thing that stops bolts and the thing you can see agree. */
    const want = S.up ? 1 : 0;
    const rate = S.up ? 1 / SHIELD.rise : 1 / SHIELD.fall;
    S.power = want > S.power ? Math.min(1, S.power + dt * rate) : Math.max(0, S.power - dt * rate);
    if (this._shieldMesh) {
      const live = S.power > 0.002;
      this._shieldMesh.visible = live;
      if (live) {
        this._shieldMesh.position.copy(this.chest);
        const u = this._shieldMat.uniforms;
        u.uTime.value = ctx?.time ?? (u.uTime.value + dt);
        /* IT FLARES WHERE IT IS BEING HIT. A barrier that looked the same under
         * a volley as it does in silence would be telling the player nothing
         * about the one thing they are deciding. */
        const since = (this.world?.time ?? 0) - S.lastHit;
        u.uPower.value = S.power * (0.7 + 0.6 * Math.exp(-since * 6));
      }
    }
  }

  /**
   * FORCE COMPEL — turn a mind, not a body.
   *
   * Note 44: "make an enemy fire on itself or its allies." Every other power in
   * this file moves matter; this one is the only one that touches a decision,
   * and that is the whole reason to have it. It also does something no other
   * power does to a crowd: it removes a gun from the line AND adds one to your
   * side, so a wave of eight becomes seven against one for as long as it holds.
   *
   * WHO IT TURNS THEM ON, in order of preference:
   *
   *   1. the nearest living ally within COMPEL_SPREAD. This is the good
   *      outcome and it is what the ability is for.
   *   2. failing that, ITSELF. A lone droid with nobody left to shoot puts its
   *      own rifle under its chin, which is both the second half of the note
   *      and the correct answer to "there is nobody else here" — far better
   *      than the power silently doing nothing, which is exactly the class of
   *      bug tools/checks/force-feedback.mjs exists to prevent.
   *
   * Deliberately NOT included: turning them on the player's co-op partner. It
   * would be funny once and then it would be the reason nobody plays with you.
   *
   * A CLOCK, not a permanent conversion. Six seconds is about two firing
   * cycles for a B1 — long enough to see it work and to plan around, short
   * enough that a crowd cannot be dismantled by clicking through it. Bosses
   * are exempt: a boss whose mind can be taken is a boss fight that ends with
   * a keypress.
   */
  forceCompel(ctx) {
    if (!this.boonMods.compel) {
      return this._refuse('force compel', 'not attuned — draft Domination to reach a mind');
    }
    if (this.cooldowns.compel > 0) {
      return this._refuse('force compel', `recovering — ${this.cooldowns.compel.toFixed(1)}s`);
    }
    if (!this._canSpend(COMPEL_COST)) {
      return this._refuse('force compel', `${this._priceOf(COMPEL_COST)} Force needed, you have ${Math.round(this.force)}`);
    }

    // The unit under the crosshair, by the same cone-and-ray rule the grip
    // uses: pixel accuracy on a droid at twenty metres is not a skill worth
    // testing, and the two powers should feel like they are aimed the same way.
    const reach = this.forceReach;
    let best = null, bestScore = -1;
    for (const e of ctx.enemies || []) {
      if (e.dead || e === this) continue;
      _v1.subVectors(this._enemyPoint(e, _v2), this.chest);
      const d = _v1.length();
      if (d > reach || d < 0.5) continue;
      const dot = _v1.multiplyScalar(1 / d).dot(this.aimDir);
      if (dot < 0.90) continue;
      const score = dot * 2 - d / reach;
      if (score > bestScore) { bestScore = score; best = e; }
    }
    if (!best) return this._refuse('force compel', 'nothing in your sights within reach');
    if (best.A?.boss) return this._refuse('force compel', `${best.A.label ?? 'it'} is too strong to turn`);
    if (!best.A?.ranged) {
      return this._refuse('force compel', `${best.A?.label ?? 'it'} carries no blaster to turn`);
    }

    // …and who it turns them on.
    let victim = null, bestD = Infinity;
    for (const e of ctx.enemies || []) {
      if (e.dead || e === best || e.team !== best.team) continue;
      const d = e.position.distanceToSquared(best.position);
      if (d < bestD && d < COMPEL_SPREAD * COMPEL_SPREAD) { bestD = d; victim = e; }
    }
    victim = victim || best;

    this._spend(COMPEL_COST);
    this.cooldowns.compel = 7;
    this._gesture('reach');
    this._forceVoice('compel');
    best.compelled = { target: victim, t: COMPEL_TIME };
    // Whatever it was doing, it is not doing any more: the reload, the burst
    // counter and the cover crouch all belong to the fight it was in.
    best.stun?.(0.35);
    audio.force(this._enemyPoint(best, _v1), 'pull');
    this.world?.notify?.('COMPELLED',
      victim === best
        ? `${best.A?.label ?? 'it'} turns its blaster on itself`
        : `${best.A?.label ?? 'it'} opens fire on ${victim.A?.label ?? 'its own'}`);
    if (ctx.particles) {
      for (let i = 0; i < 14; i++) {
        _v1.set((rng() - 0.5) * 1.2, rng() * 1.6, (rng() - 0.5) * 1.2);
        ctx.particles.plasma.spawn(this._enemyPoint(best, _v2), _v1,
          { life: 0.45, size: 0.3, drag: 2.4, gravity: -0.1, color: this._lightningColor(), alpha: 0.3 });
      }
    }
    return true;
  }

  /**
   * PUT IT DOWN, AND PICK ONE UP.
   *
   * Note 61, and the two halves are one key: if there is a hilt within reach
   * you take it, otherwise you drop the one you are holding. That is a single
   * decision the player makes with their feet rather than two keys they have to
   * keep straight, and it is what makes taking a fallen acolyte's weapon a
   * thing you do in the middle of a fight instead of a menu.
   *
   * SWAPPING is the case worth being careful about: standing over a hilt with
   * one already in your hand puts yours down where you stand and takes theirs,
   * in that order, so nothing is ever destroyed and you can always get your own
   * back by pressing it again. `Dropped.PICKUP_DELAY` is what stops that second
   * press picking your own straight back up before you have seen it leave.
   */
  swapSaber(ctx) {
    if (!this.alive) return;
    /**
     * WHAT YOUR OWN FORCE IS HOLDING IS ALREADY IN YOUR HAND, as far as this
     * key is concerned, and at any distance.
     *
     * The reach test below is about ARMS. A hilt the Force has hold of is not
     * being reached for — it is being called, and a player who has gone to the
     * trouble of picking their weapon up off the ground from across the field
     * should not then have to walk to it. `_takeSaber` releases the grip, so
     * the two states cannot both be true afterwards.
     */
    const held = this._grippedHilt();
    if (held) return this._takeSaber(held, ctx);
    const near = hiltWithinReach(this.world, this, TK.reach);
    if (near) return this._takeSaber(near, ctx);
    if (this.throwState !== 'held') {
      return this._refuse('drop', 'your blade is not in your hand');
    }
    /**
     * YOU CANNOT DROP WHAT YOU ARE NOT HOLDING — note 39, and this is the half
     * of it that made hilts out of nothing.
     *
     * Measured on the real Player before this line existed: drop, walk clear of
     * the 1.6 m reach, press it again — and again. **Five presses made five
     * hilts**, every one of them carrying the same crystal, the same style and
     * the same order, all five of them pickable. `saberDown` was set on the
     * first drop and read by exactly one line in `_takeSaber`, so nothing here
     * ever asked whether there was still a weapon in the hand.
     *
     * That is the literal reading of "you still have one like you never
     * actually lose it": the game agreed you had dropped it, drew it in your
     * hand anyway, and would sell you another.
     */
    if (this.saberDown) {
      return this._refuse('drop', 'your hands are empty — find a hilt');
    }
    this._dropSaber(ctx);
    return true;
  }

  /**
   * TAKE THE CONTROLS OF THE MACHINE IN FRONT OF YOU, or leave the ones you
   * are at.
   *
   * The V5 note is one line — *"I think we should be able to drive the vehicles
   * it makes sense to drive"* — and the whole of the design is in which ones
   * those are. `Driving.isCrewed` answers it off the archetype's `crew` count,
   * so a droid tank is refused BY NAME rather than by silence: there is nobody
   * in a hailfire to displace, and being told that is the difference between a
   * rule and a bug.
   */
  takeControls(ctx) {
    if (this.driving) { this.driving.leave('you climbed down'); return true; }
    if (!this.alive) return false;
    const near = drivableNear(this.world, this);
    if (!near) {
      /* NOT SILENT WHEN THERE IS NOTHING THERE, and not silent when the only
       * thing there is a droid either — `drivableNear` deliberately does not
       * filter by crew, so this can say which of the two it was. */
      const any = (this.world?.enemies || []).find(e => !e.dead
        && e.position.distanceToSquared(this.position) < 36);
      return this._refuse('take the controls',
        any ? whyNotDrive(this.world, this, any) : 'nothing here to drive');
    }
    const why = whyNotDrive(this.world, this, near);
    if (why) return this._refuse('take the controls', why);
    new Crew(this, near);
    return true;
  }

  /** Let go of what is in the hand. */
  _dropSaber(ctx, opts = {}) {
    const s = this.saber;
    if (!s || this.saberDown) return null;
    const put = dropSaber(this.world, {
      position: _v1.copy(this.gripAnchor).addScaledVector(this.aimDir, 0.25),
      // Out of the hand and down, not thrown: a drop is a decision, and a hilt
      // that skitters six metres away is a drop the player did not make.
      velocity: _v2.copy(this.aimDir).multiplyScalar(1.1).setY(0.6).add(this.velocity),
      colorIndex: s.colorIndex,
      hiltStyle: s.hiltStyle,
      order: s._order ?? null,
      owner: this,
      ...opts,
    });
    /* A HILT THAT LEAVES YOUR HAND IS THE SAME OBJECT IT WAS IN IT. `dropSaber`
     * machines a fresh group from the style alone, at full size, so a small
     * wielder's shoto tripled in length the instant it hit the ground and shrank
     * again when anyone picked it up. Scaled here rather than in Dropped.js
     * because the size belongs to the WEAPON, and the weapon is the thing this
     * method is holding. `put` is the prop; its mesh is the whole hilt. */
    const gs = s.gripScale ?? 1;
    if (put?.mesh && gs !== 1) put.mesh.scale.setScalar(gs);
    s.retract();
    /**
     * AND THE HILT LEAVES THE HAND — which it did not.
     *
     * `retract()` puts the blade out and nothing else: the Saber object, its
     * root, and all nineteen machined pieces of the Graflex stayed parented to
     * the scene and were re-shown by `_updateBlade`'s unconditional
     * `setVisible(true)` on the very next frame. Measured on the bench: `lit`
     * false, `ignition` 0.01 — and 19 hilt meshes still drawn, in your hand.
     * Then one press of `ignite` lit them again (0.97 in half a second) and you
     * were armed, standing over your own hilt, with nothing having happened.
     *
     * So the state is `saberDown`, and every reader of it is a place the game
     * used to pretend the weapon was still there. It is not a `saber = null`
     * because sixty call sites outside this file dereference `player.saber`
     * without a guard — World's blade entries, the catch window, the HUD's heat
     * bar, Net's wire record — and a null there is a crash per frame in five
     * files I do not own. An empty hand is a STATE of the wielder, not the
     * absence of an object.
     */
    s.setVisible(false);
    this.saberDown = true;
    this.hum?.retract?.();
    this._gesture('cast');
    audio.thud?.(this.gripAnchor, 0.4);
    this.world?.notify?.('DROPPED', `${SABER_COLORS[s.colorIndex]?.name ?? 'your blade'} is on the ground`);
    return put;
  }

  /**
   * Take a hilt off the ground, whoever built it.
   *
   * The identity travels with the object, so a partner's weapon arrives with
   * their crystal AND their order's metals — see the note in Dropped.js. The
   * player's own saved identity is untouched: what changes is the Saber in
   * their hand, and dropping this one puts back exactly what they took.
   */
  _takeSaber(prop, ctx) {
    const id = prop.saber;
    if (!id) return false;
    /* IF THE FORCE WAS HOLDING THIS ONE, IT IS NOT ANY MORE. Without this the
     * grip goes on paying `HOLD_COST` every frame for a body that has been
     * destroyed two lines down, and `_updateGrip` only notices on the frame it
     * happens to read `b.dead`. */
    if (this._grippedHilt() === prop) this.releaseGrip();
    // yours goes down first, so a swap never destroys a weapon
    if (this.throwState === 'held' && !this.saberDown) this._dropSaber(ctx);
    const s = this.saber;
    s.hiltStyle = id.hiltStyle ?? s.hiltStyle;
    if (id.order !== undefined) s.setOrderTuning?.(id.order);
    s.setColor(id.colorIndex ?? 0);
    s.rebuildHilt?.();
    this.saberDown = false;
    /**
     * AND IT COMES UP LIT.
     *
     * The alternative — hand it back dark and let the player press ignite — was
     * written first and is wrong for one reason: this is a thing you do inside a
     * fight, one press, while something is swinging at you. A pick-up that hands
     * you an unlit hilt costs a second key at the exact moment the game is least
     * survivable, and reads as the pick-up having half-failed. `rebuildHilt`
     * above has already re-machined the blade group, so `ignite` here lights THIS
     * weapon's crystal and not the one you were carrying.
     */
    s.setVisible(true);
    s.ignite();
    prop.destroy ? prop.destroy() : (prop.dead = true);
    this.hum?.setColor?.(s.color.getHex());
    this.hum?.ignite?.();
    this._gesture('reach');
    audio.force(this.chest, 'pull');
    this.world?.notify?.('TAKEN', `${SABER_COLORS[s.colorIndex]?.name ?? 'a blade'}, ${s.hiltStyle}`);
    return true;
  }

  /** One frame of the channel. Called from update while `healing` is a number. */
  _updateHeal(dt, ctx) {
    if (this.healing === null) return;
    // Interrupted by damage — checked against the hp we started with, so a
    // single bolt ends it rather than being outrun by the heal itself. It is
    // YOUR concentration either way: a bolt that lands on you ends a heal you
    // were giving somebody else too.
    if (this.hp < this._healFrom - 0.01) { this._endHeal(false); return; }
    if (!this._spend(HEAL_COST / HEAL_TIME * dt)) { this._endHeal(false); return; }
    const T = this.healTarget;
    if (T) {
      /* THE THREE WAYS A MEND ENDS BADLY, and each is a thing the player can
       * see happening: he died, he was carried out of reach, or he was hit
       * again while you were working on him. */
      if (T.dead) { this._endHeal(false, 'they were killed'); return; }
      if (T.position.distanceTo(this.chest) > MEND_REACH + 3) { this._endHeal(false, 'out of reach'); return; }
      if (T.hp < this._mendFrom - 0.01) { this._endHeal(false, 'they were hit'); return; }
    }
    this.healing += dt;
    const body = T || this;
    body.hp = Math.min(body.maxHp, body.hp + body.maxHp * HEAL_FRACTION / HEAL_TIME * dt);
    if (T) this._mendFrom = T.hp; else this._healFrom = this.hp;
    if (ctx.particles && rng() < 0.5) {
      _v1.copy(T ? T.position : this.chest);
      if (T) _v1.y += (T.A?.hipHeight ?? 0.95) + 0.3;
      ctx.particles.plasma.spawn(_v1, _v2.set((rng() - 0.5) * 0.6, 0.8, (rng() - 0.5) * 0.6),
        { life: 0.5, size: 0.35, drag: 2, gravity: -0.2, color: 0x9fffd0, alpha: 0.35 });
    }
    if (this.healing >= HEAL_TIME) this._endHeal(true);
  }

  _endHeal(completed, why = 'you were hit') {
    const T = this.healTarget;
    this.healTarget = null;
    this.healing = null;
    this._endGesture('mend');
    this.cooldowns.heal = completed ? 9 : 3;
    if (!completed) this.world?.notify?.('HEAL BROKEN', why);
    else if (T) {
      /* AND A MAN WHO WAS LYING DOWN IS STANDING UP. `Enemy.recover` is the
       * one door for that — `_tickGetUp` is the other caller — and it is what
       * `Command.reviveNear` reaches for too, so a mend and a support pod put
       * a body back on its feet the same way. */
      if (T.actor?.ragdolled) T.recover?.();
      this.world?.notify?.('MENDED', T.trooper?.name || T.A?.label || 'an ally');
    }
  }

  /* ── force stop ──────────────────────────────────────────────────── */

  /**
   * FORCE STOP — freeze what is in flight, then decide where it goes.
   *
   * The marquee power, and the reason it earns that is the ORDER it puts things
   * in: the blade decides nothing here. A wall of blaster fire stops dead in
   * the air, the camera is entirely yours for as long as the field holds, and
   * where you are looking when you let go is where all of it goes at once.
   *
   * It reuses BoltPool's hold/release rather than reimplementing arrest — see
   * StasisAnchor for why that is not a hack but the point.
   */
  toggleStasis(ctx) {
    // Pressing the key again is RETURN TO SENDER — see releaseStasis. `hurl`
    // is the other half, and fires the whole field at whatever you are looking
    // at. Two answers to "and now what", on the two keys already involved.
    if (this.stasis.active) { this.releaseStasis(ctx, true, true); return; }
    if (this.cooldowns.stasis > 0) return this._refuse('force stop', `recovering — ${this.cooldowns.stasis.toFixed(1)}s`);
    if (!this._spend(POWER_COST.stasis)) {
      return this._refuse('force stop', `${this._priceOf(POWER_COST.stasis)} Force needed, you have ${Math.round(this.force)}`);
    }
    const S = this.stasis;
    const P = this.forceScale;
    S.active = true;
    // 9 m at 1x reaches across a firefight; 18 m at 4x swallows one whole.
    S.radius = 9 * Math.sqrt(P);
    S.timer = 3.2 + 1.6 * P;
    S.centre.copy(this.chest);
    S.target = null;
    S.vfx = 0;
    this._gesture('stasis');
    this._forceVoice('stasis');
    const refused = [];
    const taken = this._stasisCapture(ctx, refused);
    if (refused.length) this._refuseStasis(ctx, refused);
    audio.force(this.chest, 'sense');
    audio.tone({ freq: 220, freqEnd: 1500, dur: 0.5, gain: 0.18, type: 'triangle', pos: this.chest });
    this.world?.engine?.flash?.(0.05);
    this.camera.addShake(0.14);
    if (ctx.particles) {
      for (let i = 0; i < 26; i++) {
        const a = (i / 26) * TAU;
        _g1.set(Math.cos(a), 0.15, Math.sin(a)).multiplyScalar(S.radius * 0.9);
        ctx.particles.dust.spawn(this.chest, _g1, { life: 0.7, size: 0.5, drag: 3.4,
          gravity: 0, color: 0xbcd8ff, alpha: 0.14 });
      }
    }
    return taken;
  }

  /**
   * Sweep the field and arrest everything inside it the fight lets you fight.
   * Returns how many.
   *
   * Three subjects, in the order the eye reads them: the bolts in the air, the
   * loose objects already in flight, and — the thing the Codex card has always
   * promised and this method could not do — THE PEOPLE.
   *
   * A living enemy is not in `ctx.physics.bodies` in any form the second loop
   * could take. Its movement proxy is KINEMATIC, so `invMass === 0` drops it on
   * the first line, and `LAYER.ENEMY` is in none of the three layers on the
   * second. Measured on a real world before this existed — five living bodies
   * standing 3.0 to 8.5 m inside a 9.0 m field — `toggleStasis` returned **0**
   * and all five went on fighting through the hold: the acolyte closed 5.77 m
   * to melee range while it was supposedly frozen, and the three shooters walked
   * 2.0 to 2.7 m each to their preferred stand-off. "Freeze what is near you,
   * bolts included" described a bolt freezer with a crate-catcher attached.
   *
   * @param refusals  optional array; bodies the field would not take are
   *   pushed onto it so the CAST can say so once. The sweep runs every frame
   *   and a running commentary is not feedback — see `_refuseStasis`.
   */
  _stasisCapture(ctx, refusals = null) {
    const S = this.stasis;
    const r2 = S.radius * S.radius;
    let taken = 0;
    if (ctx.bolts) {
      for (const bolt of ctx.bolts.bolts) {
        if (!bolt.active || bolt.held || bolt.team === this.team) continue;
        if (bolt.pos.distanceToSquared(S.centre) > r2) continue;
        ctx.bolts.hold(bolt, new StasisAnchor(bolt.pos), 0.5);
        S.held.push({ bolt });
        taken++;
      }
    }
    const cap = this.liftCapacity;
    if (ctx.physics) {
      for (const b of ctx.physics.bodies) {
        if (b.invMass === 0 || b === this.body || b === this.gripBody || b.mass > cap) continue;
        if (b.layer !== LAYER.PROP && b.layer !== LAYER.DEBRIS && b.layer !== LAYER.RAGDOLL) continue;
        if (S.bodies.has(b) || b.position.distanceToSquared(S.centre) > r2) continue;
        // Only things actually IN FLIGHT. Freezing the crate you are standing
        // next to is not a moment, it is a bug report.
        if (b.velocity.lengthSq() < 4) continue;
        S.bodies.add(b);
        S.held.push({ body: b, grav: b.gravityScale });
        b.gravityScale = 0;
        taken++;
      }
    }

    /**
     * AND THE PEOPLE — which is what "what is near you" means in a fight.
     *
     * THE ARREST IS `Enemy.stun`, and it is a reuse rather than a new freeze.
     * That verb is what a parry, a chamber, a lost blade lock, a Force shove, a
     * heavy cut and `topple()` all already call, and every consumer of "can
     * this body act" already reads the `stunTimer` it sets: `_think` returns
     * without a wish, `_move`'s `canMove` refuses to walk, the facing solve
     * refuses to turn, `_sustain` drops a held power, `breakCast` breaks a
     * wind-up mid-flight, and `_guardOpen` opens the guard so the blade can
     * finish what the field started. A parallel freeze would have had to
     * restate every one of those and would have drifted from all of them.
     * `Enemy.stasisHeld` is the MARK that says which arrest this is; it buys
     * exactly two narrow things, both of them visible, and its own note in
     * Enemy.js says what they are.
     *
     * THERE IS NO `v² ≥ 4` HERE, AND THE ABSENCE IS THE RULE. The crate branch
     * takes only what is in flight because freezing the crate you are standing
     * next to is a bug report — but that rule was never about MOVEMENT, it was
     * about whether the thing is part of the fight, and a resting crate is
     * scenery. A hostile standing still and shooting you is the most
     * fight-shaped thing in the room. Gating people on speed would refuse
     * exactly the sniper, the cover-camper and the wind-up you most want to
     * stop, and would make the power fire differently depending on which foot
     * a walking man happened to be on.
     *
     * WHAT DOES GET REFUSED is what the grip refuses, by the same two gates in
     * the same order and against the same cap: an author's outright
     * `grippable: false` (the AT-TE and the AAT — terrain that shoots), then
     * `mass > liftCapacity`. A field stricter than the grip would be a second
     * rulebook for the same question.
     *
     * WHO IT MAY REACH IS `canHarm`'S QUESTION AND NOT THIS METHOD'S, and the
     * distinction is the whole of player note #29:
     *
     *   "your allies should be as real as the enemies like no difference — you
     *    can do damage to them and throw them and manipulate them so you need
     *    to be careful not to hurt them … but like obviously the force
     *    blaster-stop thing shouldn't affect your allies' blasters."
     *
     * Two clauses, and they are about two different subjects. Their SHOTS are
     * exempt: the bolt loop above skips `bolt.team === this.team`, which
     * Command.js and World.js both cite by name, and a bolt is an object in
     * flight with no allegiance of its own to consult — its team field IS the
     * whole question. Their BODIES are not exempt: a body has a rule attached
     * to it, the note asks for allies you can throw and manipulate and must be
     * careful with, and freezing one is a manipulation. So the field reaches
     * exactly what push, pull, grip, lightning, compel and rend reach, by
     * asking the same gate they ask.
     *
     * `hostileTo` is that gate — `canHarm` per body, against `ctx.rules` — and
     * routing through it is what stops a second rulebook: the day `rules` grows
     * a case, a hand-written team comparison here would be the one call site
     * that never heard about it. `tools/checks/pvp.mjs` forbids the comparison
     * outright for that reason, and it is right to.
     *
     * The list is `ctx.enemies` and NOT `_foes(ctx)`, which is the same filter
     * over the players as well. A rival player is not arrested by this, and the
     * reason is mechanical rather than political: the arrest is `Enemy.stun`
     * and a Player has no `stunTimer` to set — its own note in `_readInput`
     * says as much. Freezing a person who is holding the controls is a
     * different power with a different argument, and it is not this one.
     *
     * The array is retained for the reason `_foeList` is: the sweep runs every
     * frame the field is up, and this is a hot path in a crowd. It is a second
     * array rather than `_foeList` itself because a power iterating `_foes` can
     * be on the stack when the field sweeps.
     */
    const foes = (this._stasisFoes ||= []);
    foes.length = 0;
    hostileTo(this, ctx.enemies, ctx.rules ?? this.world?.rules ?? null, foes);
    for (const e of foes) {
      // Already ours, or the grip's — two holds on one body is two bills for
      // one arrest, and `_updateGrip` is the one that can also move it.
      if (e.stasisHeld || e.gripped || e === this.gripEnemy) continue;
      /* A body already LIMP is not a person walking into your field, it is a
       * set of parts — and the loop above owns parts. Taking it as a person
       * too would bill one subject twice and freeze it by two different rules,
       * one of which (`_move`) it is not even running any more. */
      if (e.actor?.ragdolled) continue;
      if (this._enemyPoint(e, _g5).distanceToSquared(S.centre) > r2) continue;
      const m = e.A ? e.A.mass : 80;
      if (e.grippable === false || m > cap) {
        refusals?.push({ enemy: e, mass: m, immovable: e.grippable === false });
        continue;
      }
      e.stasisHeld = true;
      e.stun(STASIS_GRACE);
      S.held.push({ enemy: e });
      taken++;
    }
    return taken;
  }

  /** Let go of one arrested body. Every one of the field's endings calls it. */
  _freeStasisEnemy(e) {
    if (!e) return;
    /* The stun is deliberately NOT cleared. It was laid with `Math.max` — the
     * rule `Enemy.stun` itself follows — so it cannot be told apart from
     * anybody else's, and a body toppled by a cut while it was frozen carries
     * `stun(9999)` that only `_getUp` may end. What is left is at most
     * STASIS_GRACE, which is the beat the body spends finding its feet. */
    e.stasisHeld = false;
  }

  /**
   * THE BODIES THE FIELD WOULD NOT TAKE, SAID OUT LOUD — once, on the cast.
   *
   * A crate too heavy is dropped from the sweep in silence and that is right; a
   * crate has no expectations. A PERSON left standing inside a field that
   * visibly stopped everyone around them is the "the power appears to do
   * nothing" complaint that `toggleGrip`'s refusal exists to answer, and it
   * gets the same answer out of the same rulebook — the counter-play for a body
   * no setting will ever move, the two numbers and the name of the slider for
   * one that a setting would.
   *
   * The heaviest refusal only. Six troopers behind an AT-TE should read as one
   * fact about the walker, not as six notifications.
   */
  _refuseStasis(ctx, refusals) {
    let worst = refusals[0];
    for (const r of refusals) if (r.mass > worst.mass) worst = r;
    const why = this._liftRefusal(worst);
    this.world?.notify?.(why.immovable
      ? `${String(why.label).toUpperCase()} STANDS THROUGH IT`
      : 'TOO HEAVY TO HOLD', why.why);
    this._gripStrain(ctx, worst);
  }

  _updateStasis(dt, ctx) {
    const S = this.stasis;
    if (S.firing.length) this._flushStasisFire(dt, ctx);
    if (!S.active) return;

    // The field is centred on YOU — you are the one being shot at — so walking
    // out of a firefight ends the capture, while anything already frozen stays
    // frozen wherever it stopped.
    S.centre.copy(this.chest);
    S.timer -= dt;
    this._stasisCapture(ctx);

    // Drop anything the world took back from under us — a bolt pool cleared by
    // a level change, a corpse culled, a prop shattered. Left in the list they
    // would go on charging Force for holding nothing.
    for (let i = S.held.length - 1; i >= 0; i--) {
      const h = S.held[i];
      /* A body leaves the field five ways, and four of them are somebody else's
       * doing: it DIED under the hold (a cut lands, and a held body's guard is
       * open, so this is the common one), it went LIMP — cut down, toppled,
       * ragdolled — and is a set of parts the loop in `_stasisCapture` owns
       * instead, the GRIP took it (one arrest, one bill, and the grip is the
       * hold that can also move it), or something else cleared the mark. The
       * fifth is the field letting go, which is `releaseStasis`.
       *
       * The limp clause is what stops one man being billed twice while he
       * comes apart: measured, a held trooper toppled inside the field turns
       * into TEN LAYER.RAGDOLL bodies, every one of them in flight and every
       * one of them taken by the sweep above. Ten hanging bones is the right
       * picture and the right price; ten bones plus the man is not. */
      const gone = h.bolt ? (!h.bolt.active || !h.bolt.held)
        : h.enemy ? (h.enemy.dead || h.enemy.actor?.ragdolled
                     || h.enemy === this.gripEnemy || !h.enemy.stasisHeld)
        : (!h.body || h.body.dead);
      if (!gone) continue;
      if (h.body) S.bodies.delete(h.body);
      if (h.enemy) this._freeStasisEnemy(h.enemy);
      S.held.splice(i, 1);
    }

    /**
     * Holding costs more the more you are holding — AND A PERSON IS NOT A
     * CRATE, which is the one thing this sum did not used to have to say.
     *
     * The weight is not chosen here. `_updateGrip` is the only place in the
     * game that prices a living body against an object for the same act, and it
     * charges 11 against 7 (`HOLD_COST`); `PERSON_OVER_PROP` is that ratio and
     * nothing else, so a tuning pass on the grip carries to the field instead
     * of leaving a stale 1.57 typed here. One arrested body therefore costs
     * 0.9 × 11/7 = 1.41 Force a second on top of the field's own 5.
     *
     * WHAT THAT BUYS, measured through `_updateStasis` AND `_regen` together on
     * a real world at the shipped Force Power, because the bar is what the
     * player reads and regen is 7.5/s of it. The cast is 26, the clock is
     * 4.82 s, the pool is 100, and the field FIRES at the end unless the bar
     * ran out first:
     *
     *      held   net Force/s   bar at the end
     *        0        -2.50          86.0        (an empty field pays for itself)
     *        1        -1.09          79.2
     *        2        +0.33          72.4
     *        3        +1.74          65.6
     *        5        +4.57          52.0        (half the bar for half a squad)
     *        8        +8.81          31.5
     *       12       +14.47           4.3
     *       13       +15.80           0.3        (DROPS at 4.67 s, 0.15 s short)
     *
     * So one or two is nearly free and a whole squad is the whole bar, which is
     * the shape a crowd power wants: the decision is HOW MANY, not whether.
     * The grip charges ~9.9/s gross for one body at arm's length and can also
     * walk him about, choke him and hold him up as a shield; the field is the
     * crowd answer and is priced under the single-target one per head.
     *
     * Running the bar dry DROPS the field; letting the clock run out FIRES it —
     * the two failures should not feel the same.
     */
    let n = 0;
    for (const h of S.held) n += h.enemy ? PERSON_OVER_PROP : 1;
    if (!this._spend((5 + 0.9 * n) * dt)) { this.releaseStasis(ctx, false); return; }
    if (S.timer <= 0) { this.releaseStasis(ctx, true); return; }

    for (const h of S.held) {
      if (h.enemy) {
        /* THE LEASH, RENEWED — see STASIS_GRACE for why the hold is a renewal
         * rather than one long stun. `Math.max` is `Enemy.stun`'s own rule, so
         * a renewal can never SHORTEN somebody else's arrest: a body toppled by
         * a cut while it hangs here keeps its `stun(9999)` and gets up by
         * `_getUp`, not by being let go of from a field. */
        h.enemy.stunTimer = Math.max(h.enemy.stunTimer, STASIS_GRACE);
        continue;
      }
      if (!h.body || h.body.dead) continue;
      h.body.velocity.set(0, 0, 0);
      h.body.angularVelocity.set(0, 0, 0);
      h.body.wake();
    }

    // 30 Hz, throttled per FIELD rather than per bolt — twenty arrested bolts
    // is exactly when the particle pool can least afford one burst each.
    S.vfx -= dt;
    if (ctx.particles && S.vfx <= 0) {
      S.vfx = 0.033;
      for (const h of S.held) {
        // A man-sized bubble on a man: 0.2 reads on a bolt and disappears on a
        // body, and the shimmer is how you tell an arrested trooper from one
        // who has merely stopped to aim.
        const p = this._heldPoint(h, _g4);
        ctx.particles.plasma.spawn(p, _g1.set(0, 0, 0),
          { life: 0.09, size: h.bolt ? 0.2 : h.enemy ? 1.2 : 0.7, drag: 1, gravity: 0, color: 0xa8d0ff, alpha: 0.5 });
      }
    }
  }

  /**
   * Let the field go. `fire` sends everything at the target; otherwise it all
   * just falls, which is what running out of Force in the middle looks like.
   */
  /**
   * @param toOwner  send every held bolt back to WHOEVER FIRED IT, instead of
   *   throwing the whole field at one target.
   *
   * The field always had one answer — everything at the thing under your
   * reticle — and that is the right one when a squad has walked into a crossfire
   * you can point somewhere. It is the wrong one when six of them have shot at
   * you from six directions, which is the situation the field is easiest to
   * catch. Return to sender answers that, and it is the more interesting power:
   * it kills the shooters rather than the target, and it scales with how badly
   * you were being flanked instead of with how well you aimed.
   *
   * Bolts already record their `owner` — BoltPool.fire takes one and nothing
   * had ever read it back — so the shooter is known and no bookkeeping is added
   * for this. A bolt whose owner has since died, or that came out of a turret
   * with nobody behind it, falls back to the aimed target rather than
   * evaporating.
   */
  releaseStasis(ctx, fire = true, toOwner = false) {
    const S = this.stasis;
    if (!S.active) return;
    S.active = false;
    this._endGesture('stasis');
    this.cooldowns.stasis = 1.4;

    if (!fire || !S.held.length) {
      for (const h of S.held) {
        if (h.bolt) { h.bolt.held = null; h.bolt.active = false; }
        else if (h.enemy) this._freeStasisEnemy(h.enemy);
        else if (h.body) h.body.gravityScale = h.grav;
      }
      S.held.length = 0;
      S.bodies.clear();
      /* THE FALLING NOTE IS FOR BOTH WAYS OF ENDING WITH NOTHING, and it used
       * to be for one. `!fire` is the field DROPPED — the bar ran out, or the
       * level was torn down. The other way into this branch is a field the
       * player fired that had caught nothing, and that made no sound at all:
       * you paid 26, stood in it, pressed the key and the game did not respond,
       * which is the same silence the whole of `_refuse` exists to delete. It
       * is the same note either way because it is the same fact — the field
       * ended and threw nothing — and a second sound for it would be a second
       * thing to learn about a non-event. */
      audio.tone({ freq: 400, freqEnd: 90, dur: 0.4, gain: 0.14, type: 'sine', pos: this.chest });
      /* And the DROP says why, as the barrier's does. Only the drop: a field
       * you emptied by pressing the key is a thing you did, and a notice for it
       * would be the game telling you what you just decided. */
      if (!fire) this.world?.notify?.('FIELD DOWN', 'the Force ran out');
      return;
    }

    const aim = this._aimTarget(ctx, S.point);
    S.target = aim.enemy;
    S.toOwner = toOwner;
    this._gesture('unleash', S.point);
    // Fired in a RIPPLE. Twenty bolts leaving on one frame is a single white
    // flash; 28 ms apart they read as a volley, which is the entire reason it
    // was worth stopping them.
    S.firing = S.held;
    S.held = [];
    S.fireT = 0;
    audio.force(this.chest, 'push');
    this.camera.addShake(0.3);
    this.cloak?.impulse(_g1.copy(this.aimDir).negate().setY(0.35), 2.6); this.skirt?.impulse(_g1.copy(this.aimDir).negate().setY(0.35), 2.6);
    this.world?.addHitstop?.(0.05);
  }

  _flushStasisFire(dt, ctx) {
    const S = this.stasis;
    S.fireT -= dt;
    let guard = 0;
    while (S.firing.length && S.fireT <= 0 && guard++ < 10) {
      S.fireT += 0.028;
      this._launchStasisItem(ctx, S.firing.shift());
    }
    if (!S.firing.length) S.bodies.clear();
  }

  _launchStasisItem(ctx, h) {
    const S = this.stasis;
    let target = S.target;
    // Return to sender: this bolt's own shooter, if it still has one standing.
    if (S.toOwner && h.bolt && h.bolt.owner && !h.bolt.owner.dead && h.bolt.owner !== this) {
      target = h.bolt.owner;
    }
    const live = target && !target.dead && target !== this;
    const at = live ? this._enemyPoint(target, _g1) : _g1.copy(S.point);
    const P = this.forceScale;

    if (h.bolt) {
      const b = h.bolt;
      if (!b.active) return;
      _g2.subVectors(at, b.pos);
      if (_g2.lengthSq() < 1e-8) _g2.copy(this.aimDir);
      _g2.normalize();
      ctx.bolts.release(b, _g2, Math.max(60, b.speed) * (0.9 + 0.35 * P));
      // team 0 AND deflected: World._boltHitTest only lets an enemy be hit by a
      // team-1 bolt if it was deflected, and only lets the player be hit by a
      // bolt that is not team 0. Both flags, or the volley passes through.
      b.team = this.team;
      b.deflected = true;
      b.deflector = this;
      b.owner = this;
      b.damage *= 1.2 + 0.3 * P;
      b.life = Math.max(b.life, 2.6);
      b.speed = b.vel.length();
      if (live) { b.homing = 2.4; b.target = at.clone(); }
      ctx.particles?.sparkBurst(b.pos, null, 5, { speed: 6, embers: false, color: 0xfff2c0 });
      return;
    }
    /* A HELD BODY IS PART OF THE VOLLEY. It leaves in the ripple with
     * everything else — 28 ms apart, so a field of four men and twelve bolts
     * reads as one thing being thrown rather than as a bolt volley with some
     * people in it — and it leaves through the grip's own thrower, so it hurts
     * what it lands on for the same reason a hurled trooper does. A body whose
     * hold ended between the release and its turn in the ripple is skipped:
     * `_launchStasisItem` is the only reader of `firing`, and a corpse is not
     * thrown. */
    if (h.enemy) {
      // A body that died between the release and its turn in the ripple is let
      // go rather than thrown — a corpse is not a projectile, and leaving the
      // mark on it is how a body ends up frozen with nothing holding it.
      if (h.enemy.dead) { this._freeStasisEnemy(h.enemy); return; }
      this._hurlBody(ctx, h.enemy, at);
      return;
    }
    const b = h.body;
    if (!b || b.dead) return;
    b.gravityScale = h.grav;
    _g2.subVectors(at, b.position);
    if (_g2.lengthSq() < 1e-8) _g2.copy(this.aimDir);
    _g2.normalize();
    const speed = 34 * Math.sqrt(P) * lerp(1.25, 0.45, clamp(b.mass / this.liftCapacity, 0, 1));
    b.velocity.copy(_g2).multiplyScalar(speed);
    b.angularVelocity.set((rng() - .5) * 7, (rng() - .5) * 7, (rng() - .5) * 7);
    b.wake();
    this._trackHurl(b, speed);
    this._hurlVfx(ctx, b.position, _g2, Math.max(0.3, b.boundingRadius), speed);
  }

  /* ── force disassemble ───────────────────────────────────────────── */

  /** The nearest mechanical thing under the aim, or null. */
  _pickMechanical(ctx) {
    const range = 14 * Math.sqrt(this.forceScale);
    let best = null, bestDot = 0.93;
    for (const e of ctx.enemies || []) {
      if (e.dead && !e.actor) continue;
      if (!isMechanical(e)) continue;
      _g1.subVectors(this._enemyPoint(e, _g2), this.chest);
      const d = _g1.length();
      if (d > range || d < 0.5) continue;
      const dot = _g1.multiplyScalar(1 / d).dot(this.aimDir);
      if (dot < bestDot) continue;
      bestDot = dot; best = e;
    }
    return best;
  }

  /**
   * FORCE DISASSEMBLE — take a droid apart at the joints.
   *
   * Deliberately routed through Enemy.takeCut with the REAL cap from
   * Enemy.capsules(), which is the same path a sabre cut takes. So every
   * consequence a cut has happens here for free and stays in one place: the
   * molten stub on the remaining limb, the detached piece becoming a jointed
   * physics body, the topple when the legs go, the disarm when the arms go, the
   * sever event the dojo grades, the droid spark burst. Not one line of that is
   * duplicated here — a second copy of it is how the two drift apart.
   *
   * Extremities first, core last: a droid coming apart from the hands inward
   * reads as disassembly, whereas going for the chest first reads as an
   * execution and is over before you can see it.
   */
  /**
   * …AND IT SAYS WHY NOT, WHICH IT DID NOT.
   *
   * `_refuse`'s own header is the rule the whole file obeys — "a bound key that
   * does nothing and does not say why is the same lie as a dead checkbox" — and
   * rend broke it four times over in a method that already imports `_refuse`
   * for its price. `tools/checks/force-feedback.mjs` lists `forceDisassemble`
   * among its spenders and passed anyway, because the property it tested was
   * "does this body contain `_refuse(` at all"; one of five gates having a
   * sentence is enough to satisfy that and is not enough for a player.
   *
   * The four that were silent, and what each looks like from the keyboard:
   *
   *   the COOLDOWN — 2.4 s, the longest recovery on any aimed power, and the
   *     one a player is most likely to press through. Push, pull, lightning,
   *     stasis, unleash, the mend and the barrier all count it down out loud.
   *   NOTHING MECHANICAL under the aim. Rend is the only power in the game
   *     restricted by what a body is MADE of (`isMechanical`, i.e. `A.droid`),
   *     so a player pointing at a clone trooper and pressing it gets the exact
   *     experience of a broken key — and there is no other way to learn the
   *     rule, because nothing on the wheel says "droids only".
   *   NOTHING LEFT to take off, which is a droid you have already rent.
   *   NOTHING CAME OFF — see the foot of the method, which is the one that had
   *     taken the Force first.
   */
  forceDisassemble(ctx) {
    if (this.cooldowns.rend > 0) {
      return this._refuse('rend apart', `recovering — ${this.cooldowns.rend.toFixed(1)}s`);
    }
    const e = this._pickMechanical(ctx);
    if (!e || !e.capsules) {
      /* The counter-play is in the sentence, for the same reason TOO HEAVY
       * carries the slider: "no" with nothing after it is a dead end, and the
       * answer here is a real one the player already owns. */
      return this._refuse('rend apart',
        'nothing mechanical in your sights — the Force pulls droids apart, not men');
    }

    const P = this.forceScale;
    const centre = this._enemyPoint(e, _g1).clone();
    const caps = e.capsules();
    // Bone DEPTH, used only to break ties — it keeps the order sane on the one
    // frame after a spawn when the rig has not been solved and every capsule is
    // sitting on top of every other.
    const depth = (name) => { let b = e.rig ? e.rig.get(name) : null, n = 0; while (b && b.parent) { b = b.parent; n++; } return n; };
    const live = caps
      // vital ≥ 0.15 drops the hands and the feet. They are not worth a joint
      // of the budget: a cut takes the whole subtree, so an elbow already
      // brings the hand with it, and spending the entire default budget on two
      // detached hands is not what "take it apart" looks like.
      /* No `?? 0.4` on the reads: every capsule the game emits is priced by
       * `Enemy.severance`, which throws rather than defaulting, so a fallback
       * here would only ever hide the one thing it was there to cover up. */
      .filter(c => !c.shield && c.vital >= 0.15 && c.vital < 0.7 && !CORE_BONE.test(c.name))
      .filter(c => !e.actor || !e.actor.isSevered(c.covers ?? c.name))
      .map(c => ({ c, d: _g2.lerpVectors(c.p0, c.p1, 0.5).distanceTo(centre), k: depth(c.name) }))
      .sort((a, b) => (b.d - a.d) || (b.k - a.k))
      .map(x => x.c);
    if (!live.length) {
      /* Every joint this body had is already on the floor, which is a fact
       * about a droid you already rent and not about the power. Named, because
       * "nothing happened" twice in a row is how a player concludes the key is
       * dead — and the price is NOT taken for it, same as every refusal above. */
      return this._refuse('rend apart',
        `${e.A?.label ?? 'it'} has nothing left to take off`);
    }
    /* `rend apart`, not `sundering`: Sundering is the name of an unrelated epic
     * boon (Waves.js), and a refusal naming the wrong thing sends a player to
     * look for a card they never took. REND_COST rather than a bare 38 twice
     * over, so the sentence and the charge cannot drift. */
    /* What the bar read before the charge, kept so the "nothing came away"
     * case at the foot of this method can hand it back EXACTLY rather than by
     * re-deriving `cost × drain × forceCost` — a second copy of `_spend`'s own
     * arithmetic is the twin this repository keeps deleting, and it would drift
     * the first time a boon touches the sum. Nothing runs between the two lines
     * that can move the pool. */
    const paid = this.force;
    if (!this._spend(REND_COST)) {
      return this._refuse('rend apart',
        `${this._priceOf(REND_COST)} Force needed, you have ${Math.round(this.force)}`);
    }

    this.cooldowns.rend = 2.4;
    /* The ARM goes out here and the LINE does not — see below. Reaching for a
     * chassis and having it hold is a thing that happened to you, and the
     * gesture is the reaching. */
    this._gesture('rend', centre);

    // How far it comes apart. round(1.6·P + 0.6) is 1 joint at 0.25x, 2 at 1x,
    // 4 at 2x and 7 at 4x — and seven joints off a humanoid frame is both arms
    // at the elbow, both at the shoulder, both clavicles and the head, i.e. the
    // top of the slider really does dismantle it.
    const budget = clamp(Math.round(1.6 * P + 0.6), 1, 8);

    // Legs LAST, whatever the geometry says. Enemy._loseLimbBehaviour topples
    // on the first leg lost, and topple() ragdolls the body — after which every
    // further cut is a broken joint rather than a detached piece with a molten
    // stub. Taking a foot first therefore turned a seven-joint disassembly into
    // one flying limb and a heap. Arms and head first, then it collapses.
    const legs = live.filter(c => LEG_BONE.test(c.name));
    const limbs = live.filter(c => !LEG_BONE.test(c.name));
    // The head goes after the arms and before the legs: vital 0.95 makes it a
    // lethal cut, so leading with it ends the show before it starts.
    if (budget >= 5) {
      const head = caps.find(c => c.name === 'head' && (!e.actor || !e.actor.isSevered('head')));
      if (head) limbs.push(head);
    }
    limbs.push(...legs);

    let cut = 0;
    for (const c of limbs) {
      if (cut >= budget) break;
      // Re-checked INSIDE the loop, not just when the list was built. A cut
      // takes the whole subtree below it, so severing an upper arm severs the
      // forearm and the hand too — and without this the next two iterations
      // spent budget on bones that were already gone, reported two sever
      // events the actor never made, and a forcePower-4 disassembly took
      // exactly one joint off.
      /* `c.covers ?? c.name` — a weak point's capsule is named for the GAP
       * (`femur0.tip`) and the thing that comes off is the BONE the gap is a
       * hole in, so asking the actor about the capsule's own name always
       * answers false and the rend spends a joint of its budget on a limb that
       * is already on the floor. `Enemy.takeCut` refuses the second cut, so
       * this was safe and wasteful rather than wrong. */
      if (e.actor && e.actor.isSevered(c.covers ?? c.name)) continue;
      _g3.lerpVectors(c.p0, c.p1, 0.5);
      _g4.subVectors(_g3, centre);
      _g4.y = _g4.y * 0.4 + 0.35;                       // bias the scatter upward
      if (_g4.lengthSq() < 1e-8) _g4.set(0, 1, 0);
      // Ragdoll scales this by 0.35 in takeCut and again by 0.34 in finalise,
      // so ~28 here is the 3 m/s of drift that makes a piece leave rather than
      // drop; the rest is what forcePower buys.
      _g4.normalize().multiplyScalar(18 + 14 * P);
      /* `force: true` — this is a joint pulled apart, not a blade drawn through
       * one, and `Enemy._turnCut` is the BLADE's guard. A heavy body turns a
       * killing edge with a plate or a hide; the answer to a Force power is the
       * Force pool (`resistForce`), which already runs on the enemy side. See
       * the note at `_turnCut`. */
      const outcome = e.takeCut({
        bone: c.name, cutT: 0.14, cap: c, point: _g3.clone(),
        impulse: _g4.clone(), normal: UP.clone(), speed: 18, force: true,
      }, this);
      // …and a pass that took nothing off is not a limb. World._applyBladeEvent
      // learnt this when the duellist guard landed and this site did not, so a
      // rend that a guard caught still credited the counter on the death card.
      if (outcome === 'turned') continue;
      this.limbsRemoved++;
      cut++;
    }
    /**
     * NOTHING CAME OFF — AND THIS IS THE ONE THAT HAD ALREADY TAKEN THE MONEY.
     *
     * Every other gate in this method returns before `_spend`. This one cannot:
     * whether a joint comes off is `Enemy.takeCut`'s answer and there is no way
     * to ask it without asking it. So the bare `return` here was the whole of
     * `POWER_COST.rend` — 38, the third most expensive thing the Force does —
     * plus a 2.4 s lockout, spent on a frame with no sound, no spark, no shake
     * and no sentence. A power that is priced and then does nothing is worse
     * than one that refuses, because the bar moved and the player watched it.
     *
     * Handed back rather than kept, and the lockout with it. `takeCut` returns
     * `'turned'` before it touches the actor (see its own note — the check is
     * `isSevered`, and `_turnCut` declines a `force: true` pass outright), so a
     * pass that took nothing changed nothing and there is no consequence to
     * unwind: the bar goes back to the reading it had, the 2.4 s never starts,
     * and the player is exactly where they were with a sentence explaining it.
     */
    if (!cut) {
      this.force = paid;
      this.cooldowns.rend = 0;
      return this._refuse('rend apart',
        `${e.A?.label ?? 'it'} held together — nothing came away`);
    }

    /* AND THE LINE IS SAID HERE, not at the top with the gesture, because the
     * gate above is a refusal and `_forceVoice`'s own header is exact about it:
     * every one of the twelve sites is AFTER the last `return` in its method,
     * and a line raised before one of them is the player announcing something
     * that did not happen. Rend is the only power whose last refusal is not at
     * the top, so it is the only one where that sentence means moving the call
     * rather than writing it in the obvious place. */
    this._forceVoice('rend');

    if (!e.dead) e.stun(1.6, this.aimDir, 1.4);
    this.score += 40 * cut;
    this.addFlow(0.08 * cut);
    audio.force(this.chest, 'pull');
    audio.noise({ dur: 0.5, gain: 0.26, type: 'bandpass', freq: 3200, freqEnd: 700, q: 1.6, pos: centre });
    audio.tone({ freq: 150, freqEnd: 48, dur: 0.55, gain: 0.22, type: 'sawtooth', pos: centre });
    this.camera.addShake(0.34);
    this.world?.addHitstop?.(0.07);
    this.cloak?.impulse(_g1.set(0, 1, 0), 2.0); this.skirt?.impulse(_g1.set(0, 1, 0), 2.0);
    ctx.particles?.sparkBurst(centre, null, 30 + 8 * cut, { speed: 11 });
  }

  _updateForce(dt, ctx) {
    this._advanceGesture(dt);
    if (this.gripBody || this.gripEnemy) this._updateGrip(dt, ctx);
    if (this.healing !== null) this._updateHeal(dt, ctx);
    /* Stepped whenever it EXISTS rather than only while it is up, so the fade
     * out finishes and the mesh is hidden — `power` is what the shader draws. */
    if (this.shield.up || this.shield.power > 0) this._updateShield(dt, ctx);
    if (this.stasis.active || this.stasis.firing.length) this._updateStasis(dt, ctx);
    if (this.hurled.length) this._updateHurled(dt, ctx);
  }

  /* ── damage & death ──────────────────────────────────────────────── */

  damage(amount, point, source, kind, preResisted = false) {
    if (!this.alive || this.invuln > 0) return false;
    /**
     * THE GATE, AND THIS IS THE ONLY PLACE A LOCAL PLAYER PASSES THROUGH IT.
     *
     * Not one caller in the game consulted a team before this line existed, so
     * "friendly fire is off in co-op" was true only because no code path had
     * been built that could deliver it — measured: an explicit
     * `ally.damage(25, point, me, 'saber')` landed for 21.2 hp. Putting the
     * rule at the sink rather than at each of the sources is the whole point:
     * a new power, a new hazard or a new wire message written next month
     * inherits it without knowing it exists.
     *
     * `source` is the attacker, and a null one is the environment, which is
     * never on a side — see canHarm. So falls, drowning and unattributed
     * explosions are untouched by this.
     */
    if (!canHarm(source, this)) return false;
    /**
     * A MAN INSIDE A TANK IS NOT SHOT AT — THE TANK IS.
     *
     * Everything that reaches a player goes through this method (see the note
     * above it), so this is the one line that has to know about driving, and
     * putting it here rather than at each of the sources is the same argument
     * the friendly-fire gate one line up makes: a new hazard written next month
     * inherits it without knowing it exists.
     *
     * It is a redirect and not an immunity. The hull takes the blow on its own
     * armour table, and when the hull is finished `Crew.update` puts you out on
     * the ground — so the trade for the armour is that you cannot heal it, you
     * cannot dodge in it, and everything on the field is now aiming at a
     * fourteen-metre target with you sitting on top of it.
     *
     * A FALL IS STILL YOURS. `Crew.ride` pins you to the seat, so a 'fall' that
     * arrives here while driving is the tank's landing being billed to the
     * driver twice — the hull already took it.
     */
    if (this.driving) {
      if (kind === 'fall') return false;
      this.driving.vehicle.damage?.(amount, point, source, kind);
      this.hitFlash = 1;
      return false;
    }
    /**
     * THE FORCE ANSWERS THE FORCE — one call, at the SINK, so a blow is blunted
     * exactly once however it was thrown. `Enemy.damage` carries the identical
     * line for the identical reason: every power in the game arrives through
     * either this method or `applyKnockback`, so one call in each is complete
     * coverage, and a new power written next month inherits the contest without
     * knowing it exists.
     *
     * `preResisted` is set by `applyKnockback`, which has already weighed the
     * whole blow — shove and damage together — and must not have the remainder
     * charged to the pool a second time here.
     *
     * BEFORE the difficulty scale, not after: `damageTaken` is how hard the
     * world hits, and what the pool answers is the power that was thrown at it.
     * The other order would make a Master's lightning cost more pool on Padawan
     * than on Knight for landing less.
     */
    /**
     * AND THE BARRIER TAKES ITS SHARE OF WHAT WALKS IN.
     *
     * A bolt never reaches this line while the bubble is up — `World.
     * _boltHitTest` kills it on the surface — so everything arriving here with
     * a barrier raised got here some other way: a blade, a blast, a body. The
     * barrier does not STOP any of those. It blunts them by SHIELD.blunt and
     * lets the rest through, because a wall against everything is a wall
     * against having to move, and moving is the game.
     *
     * A fall is not a blow, and a barrier is not a parachute.
     */
    if (this.shield.up && kind !== 'fall') amount *= 1 - SHIELD.blunt;
    if (!preResisted) amount = Math.max(0, amount - this.resistForce(amount, kind, source));
    const scale = this.difficulty ? this.difficulty.damageTaken : 1;
    const dmg = amount * scale;
    // A NaN here is unrecoverable and SILENT: hp becomes NaN, every later
    // `hp <= 0` is false, and the player is immortal with a blank health bar
    // for the rest of the run. It has happened — a caller passed Enemy's
    // damage() method where it meant attackDamage. Refuse the hit instead of
    // poisoning hp, and say so once, loudly, rather than throwing inside the
    // frame (a throw here abandons the rest of the update and freezes the game
    // while rAF keeps drawing — that has also happened).
    if (!Number.isFinite(dmg)) {
      if (!Player._warnedBadDamage) {
        Player._warnedBadDamage = true;
        console.error('Player.damage got a non-finite amount', amount, 'from', kind, source);
      }
      return false;
    }
    this.hp -= dmg;
    // the dojo promises nothing there can kill you, and means it
    if (this.world.training) this.hp = Math.max(this.hp, 1);
    this.invuln = 0.18;
    this.hitFlash = 1;
    this.flow = clamp(this.flow - 0.28, 0, 1);
    this.combo = 0;
    this.camera.addShake(clamp(dmg / 22, 0.12, 0.9));
    this.world.engine.hurt(clamp(dmg / 30, 0.2, 1));
    /* AND THE PAD. `grep vibrationActuator|hapticActuators|playEffect` returned
     * zero over the whole project, so a player on a controller took a blaster
     * bolt to the chest and felt nothing at all. Gated on the same toggle the
     * shake two lines up is gated on, and only for the body this machine is
     * looking through — a peer being shot is not your hands. */
    if (this.isLocal && this.world.feelOn?.('shake') !== false) {
      this.world.engine.rumble?.(clamp(dmg / 26, 0.2, 1), clamp(dmg / 60, 0.1, 0.5),
        Math.round(80 + clamp(dmg, 0, 60) * 3));
    }
    audio.boltHit(point || this.chest);
    if (dmg > 14) this.staggerTimer = Math.max(this.staggerTimer, 0.28);
    this._maybeDisarm(dmg, kind, point);
    if (this.hp <= 0) { this.hp = 0; this.die(source); return true; }
    return false;
  }

  /**
   * HIT WITH NOTHING LEFT, AND THE WEAPON GOES.
   *
   * The player's own suggestion, and it is the half of "dropping your saber"
   * that was never a thing the GAME did to you: *"maybe if you get hit when
   * you're out of stamina you get staggered and drop your lightsaber."* Before
   * this the only way a hilt left your hand was you pressing the key for it, so
   * every dropped-weapon mechanic in the build — the pick-up, the swap, the
   * Force catch, lighting one in mid-air — was reachable only on purpose.
   *
   * WHAT MAKES IT FAIR RATHER THAN INFURIATING, and each of the four is doing
   * work:
   *
   *   • it takes a real blow. A bolt that grazes you for four points with an
   *     empty bar is not a disarm; `dmg > 14` is the same bar the extra stagger
   *     two lines up is already set at.
   *   • it takes an EMPTY bar. Stamina under TK.staggerStamina is a state the
   *     player put themselves in by sprinting, dashing or diving, which is what
   *     makes this a consequence rather than a dice roll.
   *   • a fall is not a disarm. `kind` 'fall' is the ground, and nobody knocked
   *     the weapon out of your hand.
   *   • it cannot happen twice in a row. TK.disarmGap is longer than it takes
   *     to walk back to the hilt, because a disarm you cannot recover from is
   *     just a slower death.
   *
   * The hilt goes SIDEWAYS out of the hand and not forwards — a weapon knocked
   * loose is not a weapon put down, and it should land somewhere you have to
   * turn for.
   */
  _maybeDisarm(dmg, kind, point) {
    if (dmg <= 14 || kind === 'fall') return false;
    if (this.saberDown || this.throwState !== 'held') return false;
    if (this.stamina > TK.staggerStamina) return false;
    const now = this.world?.time ?? 0;
    if (this._lastDisarm !== undefined && now - this._lastDisarm < TK.disarmGap) return false;
    this._lastDisarm = now;
    this.staggerTimer = Math.max(this.staggerTimer, 0.55);
    _v3.crossVectors(this.aimDir, UP).normalize();
    if (!Number.isFinite(_v3.x)) _v3.set(1, 0, 0);
    this._dropSaber(null, {
      velocity: _v3.multiplyScalar(rng() < 0.5 ? 3.4 : -3.4).setY(2.2).add(this.velocity),
    });
    this.world?.notify?.('DISARMED', 'no strength left to hold it — your blade is on the ground');
    audio.clash(point || this.chest, 0.7);
    return true;
  }

  heal(v) { this.hp = Math.min(this.maxHp, this.hp + v); }

  /**
   * EVERYTHING THE FIELD IS TOUCHING, LET GO OF AT ONCE — the held and the
   * volley already leaving, in one place.
   *
   * `die()` and `dispose()` are the two endings nobody presses, and each kept
   * its own copy of this. They had already drifted: `die` deactivated the bolts
   * still pinned mid-ripple and `dispose` did not, so a level torn down during
   * a volley left bolts hanging on anchors that no longer had an owner. The
   * two differ in nothing that matters — a volley with no player behind it has
   * nowhere to go either way — and now they cannot differ at all.
   *
   * `firing` needs its own pass because `releaseStasis` only owns `held`: once
   * an item is in the ripple, `_flushStasisFire` is the only thing that would
   * ever have launched it, and `_updateForce` stops running the moment the
   * player is dead or gone.
   */
  _abandonStasis() {
    this.releaseStasis(this.world, false);
    for (const h of this.stasis.firing) {
      if (h.bolt) { h.bolt.held = null; h.bolt.active = false; }
      else if (h.enemy) this._freeStasisEnemy(h.enemy);
      else if (h.body) h.body.gravityScale = h.grav;
    }
    this.stasis.firing.length = 0;
    this.stasis.bodies.clear();
  }

  die(source) {
    if (!this.alive) return;
    this.alive = false;
    /* OUT OF THE TANK FIRST. `Crew.update` would notice on its next frame, but
     * `die` tears down the rig and the saber below and a corpse pinned to a
     * seat by `Crew.ride` is a body in two states. `leave` puts back the
     * machine's side and its pace, which must happen whoever is dying. */
    this.driving?.leave(null);
    this.releaseGrip();
    // A corpse is not holding a stasis field. Dropped rather than fired: the
    // bolts were never aimed, and a dying player should not get a free volley.
    this._abandonStasis();
    this.hurled.length = 0;
    this.gesture.kind = ''; this.gesture.env = 0; this.gesture.sustain = false; this.gesture.hasAt = false;
    if (this.senseActive) this.toggleSense(this.world);
    this.saber.retract();
    this.hum.retract();
    this.cloak?.dispose(); this.cloak = null;
    this.hoodDrape?.dispose(); this.hoodDrape = null;
    this.skirt?.dispose(); this.skirt = null;
    this.world.onPlayerDeath?.(this, source);
    /**
     * DYING HAS TO FEEL LIKE DYING, and it was `audio.ui('bad')` — the exact
     * sound the menu plays when you click a skill node you cannot afford.
     *
     * Four channels, and every one of them is gated the way §the feel funnel
     * gates the rest: `audio.death()` (a two-and-a-half-second drop, the room
     * closing, a ring and two slowing heartbeats, and the score ducked out from
     * under it), the colour draining out of the frame, the letterbox arriving,
     * and the world going to a third speed so the last two seconds are watched
     * rather than skipped.
     *
     * `isLocal` because a peer dying in co-op is their moment, not yours: their
     * body ragdolls on your screen and your world keeps its speed and its
     * colour.
     */
    if (this.isLocal) {
      audio.death();
      const w = this.world;
      /* The drain and the bars are deliberately NOT behind the feel toggles.
       * Everything else here is motion — the pad, the camera move, the clock —
       * and a player who has turned motion off must still be told, in the
       * frame, that the run has ended. Colour leaving and the frame narrowing
       * are the two cues that cost no movement at all. */
      w.engine?.setDrain?.(0.72);
      w.engine?.setBars?.(0.085);
      if (w.feelOn?.('shake') !== false) w.engine?.rumble?.(0.9, 0.5, 620);
      /* A death is the one moment the camera is allowed to take the frame over
       * — and it takes it either way. The `shake` toggle governs the SCRIPT
       * (the turn, the drift, the boom, the lens); what it must not govern is
       * whether a first-person lens leaves the corpse it is standing inside.
       * See `motion` in Camera.beginDeathShot. */
      this.camera.beginDeathShot?.({ motion: w.feelOn?.('shake') !== false });
      w.killTime?.(0.34, 2.4);
    } else audio.ui('bad');
    /**
     * COLLAPSE — AND ONLY IF THIS BODY IS STILL THE ONE THAT DIED.
     *
     * The import is DYNAMIC, so the Actor is built on the microtask queue
     * after the frame that killed you. Enemy.js imports Ragdoll.js statically,
     * so the module is always warm and the promise always lands exactly one
     * task later — a window of one frame, every single death.
     *
     * Inside that window the game can do three things, and two of them are
     * routine. `World._reviveDowned` runs on a wave clear, and the whole point
     * of it is to put a downed player back on their feet — die on the frame
     * the party clears the wave and the recorded call order inside ONE
     * `world.update()` is `Player.die` → `director.onWaveClear` →
     * `_reviveDowned`. Then one microtask later this callback ragdolls a
     * living body: measured at 100 hp, alive, and 0 of 64 meshes left under
     * `rig.root`, because `Actor` reparents them into its own holders. The
     * player stands there invisible until something rebuilds the rig.
     * `respawn()` and `dispose()` are the other two, and both guard on
     * `this.actor` — which is still null while the import is in flight, so
     * neither guard can see it coming.
     *
     * Three of Audit 3's eight dimensions found this independently.
     *
     * `_deathGen` is the fix and it is the standard one: stamp the generation
     * at death, capture it, and refuse if anything has moved the world on. Not
     * a flag, because a flag cannot tell "the same death" from "the next one"
     * — a player who dies, revives and dies again inside two frames must get
     * the SECOND ragdoll, not neither.
     */
    const gen = (this._deathGen = (this._deathGen | 0) + 1);
    import('./Ragdoll.js').then(({ Actor }) => {
      if (gen !== this._deathGen || this.alive || !this.rig || this.disposed) return;
      this.actor = new Actor(this.world.scene, this.world.physics, this.rig, {
        mass: 78, layer: LAYER.RAGDOLL, bladeColor: this.saber.color.getHex(),
      });
      this.actor.goRagdoll(this.velocity.clone().multiplyScalar(0.7), new THREE.Vector3(0, 2, 0));
    });
  }

  _updateDead(dt, ctx) {
    if (this.actor) this.actor.update(dt);
    // While the shot is running it owns the boom and the pitch; these two lines
    // are what the camera does for a death with the shot turned off (a peer's
    // body, or a player who has motion feedback off), and they are the reason
    // the shot is a script over the rig rather than a replacement for it.
    if (!this.camera.shot?.motion) {
      this.camera.targetDistance = 4.4;
      this.camera.pitch = damp(this.camera.pitch, -0.42, 2, dt);
    }
    // FRAME THE BODY, not the ground under it. The old target sat 0.6 m BELOW
    // the corpse's centre, which on a ragdoll lying flat is under the floor —
    // so the one shot in the game that is only ever about one object pointed
    // the camera past it. Half that, and only while the shot is not running.
    const t = this.actor ? this.actor.centre(_v1) : this.position;
    const drop = this.camera.shot ? 0.15 : 0.6;
    this.camera.update(dt, _v2.copy(t).setY(t.y - drop), { physics: ctx.physics, terrain: ctx.terrain });
    this.saber.update(dt, ctx.time);
  }

  respawn(pos) {
    /* THE FOREARM'S CARRIED TWIST IS RUN STATE. It is the previous frame's
     * pose, and after a respawn there is no previous frame — leaving it set
     * makes FOREARM.rate spend a fifth of a second walking the arm back from
     * wherever the corpse left it. See _rollForearm. */
    this._foreRoll.foreR.have = false; this._foreRoll.foreL.have = false;
    this._elbow.armR.have = false; this._elbow.armL.have = false;
    this.alive = true;
    /* Everything die() took over comes back here, and it has to be here rather
     * than on the death card: co-op's revive puts a player back on their feet
     * without any screen ever closing, and a revived Jedi playing on through a
     * grey letterboxed frame at a third speed is a worse bug than the one the
     * effects fix. */
    if (this.isLocal) {
      this.camera.endShot();
      this.world.engine?.setDrain?.(0);
      this.world.engine?.setBars?.(0);
      if (this.world._killTime) { this.world._killTime = null; this.world.setTimeScale(1); }
    }
    this.hp = this.maxHp; this.force = this.maxForce; this.stamina = this.maxStamina;
    this.flow = 0; this.combo = 0;
    this.velocity.set(0, 0, 0);
    /**
     * AND THE FALL YOU DIED IN DOES NOT ARRIVE AT THE PLACE YOU CAME BACK.
     *
     * `fallSpeed` is the most negative velocity.y since the last contact and
     * `diving` is a commitment that only an impact may answer — both are state
     * of a body that no longer exists, and this line reset neither. The next
     * frame `_collide` saw `!wasGrounded && fallSpeed < -7` and fired
     * `_land(ctx, 23.6)` AT THE REVIVE POINT, with `dove` true so the DIVE_LAND
     * multiplier was on it. Measured: a trooper 3 m from the spawn went 46 ->
     * 18.7 hp and was thrown at 14.8 m/s, the ground cratered, the camera shook
     * 0.55, and the player took none of it because `invuln` is 2.2 two lines
     * down. Reachable through `World._reviveDowned`, which is the co-op
     * wave-clear revive and runs once per death for the whole session.
     *
     * `_sweepFromY` goes with them: it is where the feet were last frame, and
     * after a respawn there is no last frame — leaving it at the height you
     * died at would make _collide's sweep look for floor along a line the body
     * never travelled.
     */
    this.fallSpeed = 0;
    this.diving = false;
    this.jumpHeld = 0;
    this._sweepFromY = pos ? pos.y : this.position.y;
    if (pos) this.position.copy(pos);
    this.invuln = 2.2;
    if (this.actor) { this.actor.dispose(); this.actor = null; }
    /**
     * AND THE OLD RIG GOES WITH IT.
     *
     * `die()` hands the body's meshes to a ragdoll Actor, and `Actor.dispose()`
     * removes its own HOLDERS from the scene — not the rig root those meshes
     * were reparented out of. So the root stayed in the scene, and the line
     * below adds a second one next to it. This never showed while `respawn()`
     * had no callers; co-op's revive is the first thing that runs it, and it
     * runs it once per death for the whole session.
     */
    if (this.rig) { this.world.scene.remove(this.rig.root); this.rig.dispose(); }
    const built = buildJedi({
      robeIndex: this.world.settings.robeIndex ?? 0,
      skinColor: skinHex(this.world.settings.species, this.world.settings.skinIndex),
      hairColor: HAIR_COLORS[this.world.settings.hairIndex ?? 1]?.hex,
      build: this.world.settings.build,
      species: this.world.settings.species, face: this.world.settings.face,
      // …and the hood, for the reason written at the constructor's copy of
      // this call: a body rebuilt by a revive has to come back wearing what
      // the player chose, and this is the only line that can say so.
      hood: this.world.settings.wardrobe?.hood,
    });
    this.hood = this.world.settings.wardrobe?.hood ?? 'none';
    this.rig = built.rig;
    this.palette = built.palette;
    this.built = built;          // _makeCloak needs robeSkirt on a respawn too
    this.world.scene.add(this.rig.root);
    /*
     * THE RIG'S OWN SCALE, not 1.
     *
     * Enemy.js has always passed `A.scale` here for exactly this reason, and
     * the player did not — which was invisible while every player was 1.78 m.
     * A 0.66 m figure of Yoda's species has its ankle planted at 72 mm by a
     * gait solved for a human, and floats 43 mm off the floor.
     */
    this.animator = new BipedAnimator(this.rig, { scale: this.rig.scale ?? 1, hipHeight: 0.95 });
    this.animator.onFootstep = (p, s) => this._footstep(p, s);
    /* A NEW BODY IS A NEW SET OF SCALES. Same species today, so these are the
     * same four numbers — but they are read off the rig, and the rig on the
     * line above is a different object from the one the constructor measured.
     * A field derived from a thing that has just been rebuilt and not rederived
     * beside it is the exact shape this file keeps finding bugs in. */
    this.limbs = limbScale(this.rig);
    this.eyeHeight = EYE_H * this.limbs.stand;
    this.saber.setGripScale?.(this.limbs.torso);
    this.control.reachScale = this.limbs.arm;
    this._makeCloak();
    this._applyViewMode();
    /* YOU COME BACK ARMED. `saberDown` survives a respawn otherwise, and the
     * hilt you dropped is on a floor two waves ago — so the revive would put a
     * player back on their feet permanently unable to ignite anything, and the
     * only tell would be a refusal message. A new body gets its weapon. */
    this.saberDown = false;
    this.saber.setVisible(true);
    this.saber.ignite();
    this.hum.ignite();
  }

  /* ── boons ───────────────────────────────────────────────────────── */

  /**
   * Take one rank of a boon.
   *
   * The rank comes from THIS PLAYER's own count, never from the draft that
   * offered the card: `World.spawnPlayer` re-applies a carried run's boons to a
   * freshly built body one at a time, so replaying `[vitality, vitality]` has
   * to land on ranks 1 and 2 and reach the same hp it had on the rung below.
   * A rank stamped on the card at draft time would replay as 2 and 2.
   */
  applyBoon(boon) {
    const rank = this.boons.take(boon.id);
    boon.apply(this, rankScale(rank));
  }

  dispose() {
    /* Terminal, and the in-flight ragdoll import consults it — see `_deathGen`
     * in die(). `dispose()` guards on `this.actor`, which is still null while
     * that import is on the microtask queue, so without this marker a body
     * disposed on the frame it died builds its Actor into a torn-down world
     * one task later. */
    this.disposed = true;
    // …and the same for a machine this body is at the controls of: a level
    // change with a driver still bound to a tank leaves the tank on the wrong
    // side, at a driver's pace, holding a reference to a disposed player.
    this.driving?.leave(null);
    // Anything the Force is holding has its gravity switched off and its bolt
    // pinned to an anchor. Leaving on a level change would strand both.
    this.releaseGrip();
    this._abandonStasis();
    this.hurled.length = 0;
    this.hum.dispose();
    this.cloak?.dispose(); this.cloak = null;
    this.hoodDrape?.dispose(); this.hoodDrape = null;
    /**
     * THE SKIRT TOO, and it was the only garment this line forgot.
     *
     * `die()` twenty lines up disposes both, and Enemy.dispose() disposes both;
     * this one disposed the cape and left the robe. The robe is not parented to
     * the rig — `new Cloak` does `scene.add(this.mesh)` — so removing the rig
     * root does not take it, and it is built `frustumCulled = false` with
     * `castShadow = true`. Measured across twelve deploys of main.js's own
     * buildWorld: 36 orphan meshes, exactly three per deploy (the skirt and the
     * belt's two sash straps), left standing at the PREVIOUS level's
     * coordinates, drawn every frame and casting into all three cascades.
     *
     * The check that covers the sash asserts `skirt.dispose()` removes it and
     * says "a garment leak per respawn" in its own failure message — and never
     * asked whether anything calls it. See tools/checks/lifecycle.mjs, which
     * now cycles a real World rather than reading one as text.
     */
    this.skirt?.dispose(); this.skirt = null;
    /* THE BARRIER'S BUBBLE. Built lazily into `world.scene` on the first raise
     * and parented to nothing, so removing the rig does not take it: the exact
     * shape of leak the skirt note above is about, written down before it could
     * happen a second time. */
    if (this._shieldMesh) {
      this.world.scene.remove(this._shieldMesh);
      this._shieldMesh.geometry?.dispose();
      this._shieldMat?.dispose();
      this._shieldMesh = null; this._shieldMat = null;
    }
    this.saber.dispose();
    if (this.actor) this.actor.dispose();
    else { this.world.scene.remove(this.rig.root); this.rig.dispose(); }
    this.world.physics.remove(this.body);
  }
}

const _axis = { x: 0, y: 0 };
const _axis0 = { x: 0, y: 0 };
