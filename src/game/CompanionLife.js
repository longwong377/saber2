/**
 * ══════════════════════════════════════════════════════════════════════════
 *  BATTLEFRONT BORZ — THE COMPANION, BETWEEN THE ACTIONS
 * ══════════════════════════════════════════════════════════════════════════
 *
 * "these companions need to look incredible, they're going to be on the screen
 *  a lot … they have to look incredibly detailed and different and unique and
 *  fleshed out and LIVING"
 *
 * ── WHAT WAS MISSING, MEASURED RATHER THAN ASSERTED ───────────────────────
 *
 * The bodies are built and the gait solver walks them. What a companion did
 * NOT have was anything at all between a walk cycle and an attack. Grep the
 * tree before this file: the entire idle inventory of the feature was
 * `CompanionDeck.fig.sit`, one eased blend that folds the haunches. On the
 * FIELD there was nothing — `Enemy._poseWalker` is a leg solve, an attack
 * curve read off `BEAST_MOVES`, and eleven lines of head track that run **only
 * while `this.target` is set**. So a companion standing beside you with
 * nothing to fight is, frame for frame, a statue with its feet cycling at the
 * 0.1 phase floor.
 *
 * Worse, and this is a defect and not only an absence: those eleven lines
 * write the head bone when there IS a target and never write it back. A
 * companion whose target dies keeps its skull cranked to the last bearing it
 * saw it on — up to the clamp, 40° — for the rest of the level. Nothing else
 * in the game notices because a wild acklay has a player in front of it from
 * spawn to death; a companion is the first body in this game that is routinely
 * idle, which is the same sentence `CompanionPack.update` already carries
 * about the state machine.
 *
 * ── WHERE THIS RUNS, AND WHY IT IS A LAYER AND NOT A POSE PATH ────────────
 *
 * TWO CALL SITES, both one line:
 *
 *   `CompanionPack.update`  (Companions.js) — world update order 6, props,
 *   which runs AFTER enemies (2). So every companion has already been thought,
 *   moved and POSED by the time this sees it: the gait owns the legs and the
 *   hips, `_poseWalker` owns the head while there is a target, and this owns
 *   everything that is left. Nothing here re-solves anything.
 *
 *   `stepCompanionDeck`     (CompanionDeck.js) — the hangar body, which has no
 *   `Enemy` behind it at all and therefore no gait, no target and no LOD. On
 *   the deck this file is the ONLY thing that moves the animal's bones.
 *
 * A LAYER MEANS IT ADDS AND NEVER ASSIGNS, and the mechanism is worth stating
 * because it is the one thing that makes two owners of one bone safe. Every
 * bone this file writes it writes as
 *
 *     if (nothing else wrote it since I did) reset it to its rest pose
 *     bone.quaternion.multiply(my offset)
 *     remember what I left
 *
 * and "nothing else wrote it" is a MEASUREMENT — `dot(current, what I left) ≈
 * 1` — rather than a restatement of which pose path owns which bone. That
 * matters both ways round. `BipedAnimator` rewrites `chest` and `neck` from
 * their rest quaternions every single frame, so a droid companion's offsets
 * must be post-multiplied or they are erased; `_poseWalker` writes `head` only
 * while a target lives, so a creature companion's offsets must be reset or
 * they integrate and the head spins. One test, both cases, and no clause here
 * knows the name of the thing on the other side of it.
 *
 * ── IT COSTS NOTHING WHEN NOBODY IS LOOKING ───────────────────────────────
 *
 * `Enemy.update` writes `this.lod` off the camera distance — 0 under 30 m, 1
 * to 62 m, 2 to `L3_AT`, 3 beyond — and `_poseWalker` itself returns at
 * `lod > 1`, because past 62 m the body draws through `MergedSkin` and nothing
 * reads a bone. This uses THAT NUMBER and does not invent a second one: past
 * the same fence the whole layer is one comparison and a return. The bolt scan
 * — the only part of this that walks a pool — additionally runs on
 * `BEHAVIOUR.roll.scan`, Reactions.js's own clock, for Reactions.js's own
 * reason.
 *
 * ── EVERY KIND DIFFERENT, AND NOT ONE OF THEM BY NAME ─────────────────────
 *
 * `CompanionKinds.js` opens with the rule: a kind is a ROW, and nothing may
 * compare `kind === 'massiff'`. This file obeys it and goes one further —
 * almost nothing here is authored per kind at all. What makes a tooka read
 * differently from a blurrg is DERIVED from rows that already exist:
 *
 *   breathing rate   allometric, off the archetype's own `mass`. Respiratory
 *                    rate scales as mass^(-1/4) in every mammal anyone has
 *                    measured, and the constant is set so the 110 kg massiff
 *                    lands on 18/min. That puts the 3 kg tooka at 44/min (a
 *                    cat is 25, a kitten more) and the 640 kg blurrg at
 *                    12/min (a horse is 12). Nobody typed those two numbers.
 *   what it watches  `K.ward`. A kind with a ward radius is a kind whose job
 *                    is meeting what comes near you, and it looks OUTWARD:
 *                    hostiles inside its ward outrank its owner for its
 *                    attention. A kind at ward 0 — the tooka, the astromech,
 *                    the medic, two of the three mounts — cannot fight at all,
 *                    so it looks at YOU. That one field turns the gaze ladder
 *                    upside down and it is the biggest visible difference
 *                    between two animals standing in the same field.
 *   how hard it      `K.frag`, the area-damage multiplier. A body that a
 *   flinches         thermal kills is a body that jumps at a near miss; the
 *                    rancor pup at 0.7 barely twitches, the tooka at 2.4
 *                    throws itself sideways. Same field, same meaning.
 *   how fast its     `K.pace`. A quick animal turns its head quickly.
 *   head turns
 *   how far its      the PLAN's own `tail[1]` — the tail's reach in metres —
 *   tail carries     so a whip-tailed tooka swings further than a stub-tailed
 *                    massiff without either being written down twice.
 *   which idle       the parts the body actually has, intersected with the
 *   beats it has     beat table's own requirements. A machine does not sniff
 *                    the ground and an animal does not re-seat its servos; an
 *                    animal standing on two legs does not lift one of them to
 *                    scratch; a wingless body never preens. See `BEATS`.
 *
 * ── AND THE APPENDAGES IT HAS, WHICH IS NOT WHAT YOU WOULD GUESS ──────────
 *
 * The brief asks for ears back under fire and a tail that sways. **No rig in
 * this game has an ear bone or a tail bone, and this was checked rather than
 * assumed** — `creatureSkeleton` emits `hips`, `body`, `head` and four bones
 * per limb, `humanoidSkeleton` emits a spine and four limbs, and Bodies.js
 * says so in as many words where it builds the tail: "THE TAIL, on the body
 * bone because the skeleton has no tail chain". The ears, where an animal has
 * them, are merged into the head's own single-material mesh by `Kit.bake`.
 *
 * Adding those bones was rejected, and the reason is not squeamishness: a bone
 * needs a `BONE_ROLES` role, `Rig._measureLimbs` prices severance off the role
 * counts, and `Enemy.severanceOf` spends that price — so two new roles on
 * every creature in the roster changes what it costs to cut the leg off a
 * reek. That is a body-plan change wearing an idle animation's clothes.
 *
 * So the appendage channel is resolved against the REAL rig — `partsOf` looks
 * for `ear*`, `tail*` and `wing*` bones and drives them when a rig has them,
 * which is how a hawk's wings will mantle the day that body lands — and where
 * the part does not exist the signal is carried by the bone the part is
 * WELDED TO, which is a substitution and is described as one:
 *
 *   THE TAIL IS THE TRUNK. It is merged into the `body` bone, and the limbs
 *   hang off `hips`, not off `body` — so yawing `body` swings the spine and
 *   the tail while all four feet stay planted. That is what a dog wagging
 *   actually does. The head is a child of `body`, so it is counter-rotated by
 *   the same angle and stays on its mark: the animal wags, it does not shake
 *   its head.
 *
 *   THE EARS ARE THE CARRIAGE. A dog with its ears back has its whole head
 *   down and drawn in; a dog with its ears up has it lifted and craning. Both
 *   halves of that are the head bone, and the head bone is real.
 *
 * ── WHAT IT WILL NOT DO ───────────────────────────────────────────────────
 *
 * It invents no simulation. Every input is a field the body already carries —
 * `hp`, `maxHp`, `underFire`, `state`, `target`, `velocity`, `_cmpDuty`,
 * `_cmpOwner`, the kind row and the archetype row — and every input the deck
 * body has is `fig.sit`, the player and the record. There is no new timer that
 * the rest of the game cannot see, and nothing here can change where a body
 * is, what it is fighting or whether it lives.
 */

import * as THREE from '../../vendor/three/three.module.js';
import { clamp, damp, lerp, TAU } from '../engine/MathUtil.js';
import { COMPANION_KINDS } from './CompanionKinds.js';
/* The material ladder, for the one split that is not a matter of degree: a
 * thing made of droid does not breathe and a thing made of flesh does not
 * re-seat its servos. Read off `A.toughness`, which every archetype declares,
 * rather than off `custom: 'beast'` — a wookiee is flesh and is not a beast. */
import { TOUGHNESS } from './Combat.js';
/* The under-fire window, so "how pinned is it" is a fraction of the SAME
 * three and a half seconds the cover hunt and the director's decay use. */
import { UNDER_FIRE } from './Command.js';
/* Reactions.js's own near-bolt read and its own scan clock. `senseBolt` asks
 * `BoltPool.threatsNear` on `BEHAVIOUR.roll.scan` because that call walks the
 * pool; this asks the same question of the same pool on the same clock, and
 * the numbers come from there so the two can never drift apart. */
import { BEHAVIOUR } from './Reactions.js';

/* ══════════════════════════════════════════════════════════════════════════ */
/*  The dial                                                                  */
/* ══════════════════════════════════════════════════════════════════════════ */

/**
 * ONE TABLE, AND EVERY NUMBER IN IT IS READ SOMEWHERE BELOW.
 *
 * The amplitudes are all small on purpose. This layer is competing with a gait
 * that already moves the whole animal, and the failure mode of an idle system
 * is not "too subtle" — it is a dog that bobs like a novelty toy.
 *
 * Two of them were changed by a measurement rather than by taste, and both say
 * so on their own line: `sway.cap` (a stub tail was buying its travel in 12.8°
 * of spine) and `look.idle` (a player who has not touched the mouse is not
 * aiming). The rest are first values, and the numbers that are NOT taste at
 * all — the breathing rate, the nerve, the poise, the tail's lever arm — are
 * derived per body and are not in this table.
 */
export const LIFE = Object.freeze({
  /**
   * THE GAZE.
   *
   * `yaw` and `pitch` are deliberately TIGHTER than the combat head track's
   * ±0.7 / ±0.5 in `_poseWalker`, and they are a different rule rather than a
   * second copy of that one: an animal locked onto prey cranes its neck to the
   * stop, an animal glancing at something does not. The two never both apply —
   * with a target the gait owns the aim and this adds only the life offsets.
   *
   * `slew` is the base rate the gaze eases at, in `damp` lambda; `poise`
   * multiplies it by the kind's own pace.
   *
   * `dwell` AND `idle` ARE A WINDOW AND NOT A THRESHOLD, and the second half
   * was added because the first half alone is wrong in the one case a check
   * catches immediately: a player who has not touched the mouse for a minute
   * has an aim that has been held perfectly still for a minute, and by a bare
   * `held > dwell` test he is aiming harder than anyone has ever aimed. He is
   * not aiming; he is standing there. So the aim counts for four seconds after
   * it settles and then stops counting, and the animal looks back at HIM —
   * which is also the right read: a dog watches where you point, and then it
   * watches you.
   */
  /**
   * AND `reach` IS THE ONE THAT MAKES `yaw` AND `pitch` A NECK RATHER THAN A
   * CLAMP, which is a defect that shipped and was measured on the commonest
   * thing a player ever sees.
   *
   * At heel, on the flat, with the player standing still, the gaze channel sat
   * at exactly 0.620 rad — `look.yaw`, to three decimals — on 899 of 899
   * frames. That is not a head tracking its owner. It is a head jammed against
   * its own stop, held there for as long as anybody watches, because the owner
   * of a companion at heel stands BEHIND it: measured on the colosseum
   * fixture, 1.812 rad round (103.8°) against a 0.62 rad neck. The old ladder
   * picked him anyway and `clamp` did the rest.
   *
   * So the envelope moved from the END of the solve to the FRONT of it: a rung
   * is only taken if the head can actually rest on it, and what cannot be
   * reached is passed over for the next thing that can — a hostile in front of
   * it, or nothing at all and the animal looks ahead. `reach` is the fraction
   * of the stop a NEW thing has to be inside before the animal will turn to
   * it, and the band between `reach` and the stop itself is hysteresis: once
   * it IS watching something it will follow it all the way out to the stop and
   * only then let go, so a body drifting across the boundary does not make the
   * head flicker on and off at frame rate. 0.85 of 0.62 is 0.53 rad, which is
   * a 5° band — wider than anything walking pace crosses in a frame.
   *
   * THE YAW CLAMP IS GONE, and that is the point rather than a side effect.
   * With the envelope on the front, a `clamp` on `yaw` at the back could never
   * bite again, and a line that cannot bite is HANDOFF §2.3b whatever it is
   * guarding. `pitch` is NOT in the envelope and its clamp is still live and
   * still bites — the argument for the split is on `gazeFor`, and it is the
   * difference between a stop a body can walk its way out of and one it
   * cannot.
   */
  look: { yaw: 0.62, pitch: 0.36, reach: 0.85, slew: 3.6, dwell: 0.40, idle: 4.0, near: 8, range: 30, scan: 0.20 },
  /**
   * THE BREATH. `rate` is cycles a second for a body of `ref` kilograms and
   * the exponent is the allometric one — see the header for the three real
   * animals this lands on. `amp` is the fraction the ribcage swells by; 3% is
   * about what a resting mammal's chest does and it is visible at 4 m and
   * invisible at 30, which is the right place for it to disappear.
   */
  breath: { rate: 0.30, ref: 110, exp: 0.25, amp: 0.030, sag: 0.55 },
  /** What multiplies that rate. `winded` and `hurt` are the two the brief
   *  names; `effort` is speed, so an animal that has been running is puffing
   *  when it arrives. Hurt is applied over the bottom half of the bar. */
  rate: { winded: 2.4, hurt: 1.7, effort: 0.9 },
  /** A machine does not breathe: it settles. Fast, tiny, and on the chassis. */
  servo: { rate: 2.6, amp: 0.008 },
  /**
   * THE CARRIAGE — the ears, on the bone the ears are welded to.
   * `pin` is how far the head drops and draws in under fire (negative is
   * down), `alert` how far it lifts and cranes with something to watch, and
   * `hurt` the droop of an animal at the bottom of its hit points.
   */
  carriage: { pin: -0.26, alert: 0.15, hurt: -0.20, ease: 4.5 },
  /**
   * THE SWAY — the tail, on the bone the tail is welded to. `amp` is METRES
   * of travel at the tail tip, converted to an angle through the plan's own
   * reach, so a long tail swings further for the same number. `alert` and
   * `hurt` are what is left of it when the animal is watching something and
   * when it is hurt: a stiff tail and a tucked one.
   */
  /* AND A CAP, WHICH THE FIRST CUT DID NOT HAVE. The angle is metres over the
   * tail's own reach, so a SHORT tail buys its travel in trunk rotation: the
   * massiff's 0.38 m stub asked for 0.22 rad — 12.8° of spine, measured, which
   * is a dog wagging its whole hindquarters and reads as a wobble rather than
   * as a tail. The cap costs the stub-tailed animals some tip travel and is
   * invisible on the long-tailed ones, which is the right way round: a short
   * tail SHOULD move less. */
  sway: { rate: 0.42, amp: 0.070, cap: 0.11, alert: 0.18, hurt: 0.25, ease: 3.0 },
  /**
   * THE IDLE BEATS. `every` is the window between them in seconds, scaled by
   * the animal's nerve — a jumpy kind fidgets at the short end. `settle` is
   * how long after anything happens before it will start another one, and
   * `ease` is how fast a beat is abandoned when something does.
   */
  beat: { every: [6, 17], settle: 2.2, ease: 6.0 },
  /**
   * THE FLINCH. One spring, three triggers, one channel. `duck` is the head
   * drop at nerve 1, `turn` the yaw away from whatever it was, `decay` the
   * lambda it comes back on, and `again` the refractory window that stops a
   * burst of six bolts producing six flinches.
   */
  flinch: { duck: 0.40, turn: 0.34, brace: 0.10, decay: 6.5, again: 0.45,
    hit: 1.0, near: 0.6, owner: 1.0 },
  /** The nerve band, off `K.frag`. Clamped so no row can produce a body that
   *  either never reacts or shakes itself apart. */
  nerve: { min: 0.55, max: 1.6 },
});

/**
 * ══════════════════════════════════════════════════════════════════════════
 *  THE IDLE BEATS
 * ══════════════════════════════════════════════════════════════════════════
 *
 * "Occasional idle beats … a shake-off, a sniff at the ground, a head-scratch,
 *  a stretch. Cheap, short, and interrupted the instant anything happens."
 *
 * EACH ROW DECLARES WHAT IT NEEDS AND NOTHING KNOWS A KIND'S NAME. `parts` is
 * the part keys `partsOf` must have resolved, `legs` the number of leg chains
 * the body must have, `made` the material it is for — 'flesh', 'droid' or
 * absent for either — and `mount` whether the kind is one a player gets off.
 * The menu a body gets is the rows it satisfies, so the difference between a
 * massiff's idle and an astromech's is a property of their bodies rather than
 * of a switch.
 *
 * AND `legs` IS ON EXACTLY ONE ROW, WHICH IS THE HONEST NUMBER. The first cut
 * put `legs: 4` on all four animal beats on the reasoning that a two-legged
 * body does not shake itself off like a wet dog — and measured, that silently
 * emptied the menu of the rancor pup (2 legs and 2 arms), the tauntaun and the
 * blurrg (both bipedal), which is three of the eight bodies standing perfectly
 * still for ever. A biped shakes, sniffs, stretches and grazes; what it cannot
 * do is stand on the rest of its legs while it lifts one to SCRATCH.
 *
 * `drive(o, u, s)` writes into the frame's channel accumulator: `u` runs 0→1
 * through the beat and `s` is the ±1 side drawn when the beat STARTED, off the
 * individual and the row's own `id` together — so two massiffs scratch
 * different ears and one massiff does not sweep its head to the same side
 * every time it does anything. No row touches a bone; a row that names a part the
 * body does not have is never selected, and a row that misspells one is
 * selected never — which is why `companions.mjs` asserts the menu is non-empty
 * for every kind that has a body.
 *
 * `env` is the same rise-and-fall envelope every row uses, so no beat can pop
 * on or off: it starts at zero, ends at zero, and the whole beat is therefore
 * abandonable at any point by easing its weight out.
 */
const env = (u) => Math.sin(clamp(u, 0, 1) * Math.PI);

export const BEATS = {
  /** A wet dog. The whole spine oscillates and the head counter-whips. */
  shake: {
    id: 'shake', parts: ['chest', 'head'], made: 'flesh', dur: 0.85, weight: 1.0,
    drive(o, u) {
      const e = env(u), w = Math.sin(u * TAU * 4.5);
      o.sway += w * 0.26 * e;
      o.roll += -w * 0.55 * e;
      o.pitch += Math.sin(u * TAU * 9) * 0.10 * e;
    },
  },
  /** Nose to the ground, three short takes of it, and up again. */
  /* AND NOT WHILE IT IS ON YOUR SHOULDER — see `pickBeat`. A nose on the
   * ground is a pair of eyes off the field. */
  sniff: {
    id: 'sniff', parts: ['head'], made: 'flesh', duty: false, dur: 1.7, weight: 1.2,
    drive(o, u) {
      const e = env(u);
      o.pitch -= (0.46 + Math.sin(u * TAU * 5) * 0.07) * e;
      o.yaw += Math.sin(u * TAU * 1.5) * 0.16 * e;
      o.lean += 0.06 * e;
    },
  },
  /** A hind foot at an ear. The gait owns the legs, so what shows is the head
   *  going to meet it — which is the half a player reads anyway. */
  scratch: {
    id: 'scratch', parts: ['head', 'chest'], legs: 3, made: 'flesh', dur: 1.15, weight: 0.9,
    drive(o, u, s) {
      const e = env(u), j = Math.sin(u * TAU * 7);
      o.roll += s * (0.42 + j * 0.12) * e;
      o.pitch -= 0.20 * e;
      o.sway += s * 0.10 * e;
    },
  },
  /** A long bow: front down, head out, and a slow recovery. */
  stretch: {
    id: 'stretch', parts: ['chest', 'head'], made: 'flesh', dur: 2.1, weight: 0.7,
    drive(o, u) {
      const e = env(u);
      o.lean += 0.20 * e;
      o.pitch += 0.16 * e;
      o.rib += 0.6 * e;
    },
  },
  /** A mount crops the ground when you are not on it. The one beat that reads
   *  a kind ROW rather than the body — `mount` is the field that says a player
   *  gets off this animal, and an animal you get off grazes. */
  graze: {
    id: 'graze', parts: ['head'], made: 'flesh', mount: true, duty: false, dur: 3.2, weight: 1.4,
    drive(o, u) {
      const e = Math.min(1, env(u) * 2.2);
      o.pitch -= 0.62 * e;
      o.yaw += Math.sin(u * TAU * 2.2) * 0.22 * e;
    },
  },
  /**
   * A LOOK ROUND. Head off to one side, a moment there, and back.
   *
   * ADDED WITH THE GAZE ENVELOPE AND FOR THE SAME MEASUREMENT. Once a head
   * that cannot reach its owner stops cranking itself onto the stop, it rests
   * dead ahead — and measured over sixty-five calm seconds at heel, that left
   * the head bone at exactly its rest quaternion for every frame that was not
   * inside one of the three beats the timer fired. "Not jammed" is not the
   * same thing as "alive", and the fix for the second half is the mechanism
   * this file already has for "it does something for a moment".
   *
   * It is the one beat that is RIGHT while on duty, which is the whole of what
   * a standing order should look like from outside: an animal on your shoulder
   * with nothing yet to meet looks about, and does not put its nose down.
   */
  glance: {
    id: 'glance', parts: ['head'], made: 'flesh', dur: 1.4, weight: 1.3,
    drive(o, u, s) {
      const e = env(u);
      o.yaw += s * 0.45 * e;
      o.pitch += 0.08 * e;
      o.roll += s * 0.07 * e;
    },
  },
  /** A sensor sweep. Machines get this and animals do not. */
  swivel: {
    id: 'swivel', parts: ['head'], made: 'droid', dur: 2.3, weight: 1.0,
    drive(o, u, s) {
      const e = env(u);
      o.yaw += s * Math.sin(u * TAU) * 0.72 * e;
      o.pitch -= 0.06 * e;
    },
  },
  /** A servo re-seat: a snap and a settle, on the chassis rather than the head. */
  settle: {
    id: 'settle', parts: ['chest'], made: 'droid', dur: 0.55, weight: 0.8,
    drive(o, u, s) {
      const e = env(u);
      o.sway += s * 0.14 * e;
      o.lean += -0.05 * e;
      o.roll += s * 0.10 * e;
    },
  },
  /** A wing shaken out and folded back. Nothing in the roster has wings yet;
   *  `partsOf` will find them the day a body does. */
  preen: {
    id: 'preen', parts: ['head', 'wings'], dur: 1.6, weight: 1.1,
    drive(o, u, s) {
      const e = env(u);
      o.wing += Math.sin(u * TAU * 2) * 0.5 * e;
      o.roll += s * 0.30 * e;
      o.pitch -= 0.30 * e;
    },
  },
};

/* ══════════════════════════════════════════════════════════════════════════ */
/*  Identity                                                                  */
/* ══════════════════════════════════════════════════════════════════════════ */

/**
 * A NUMBER IN [0,1) THAT IS THIS ANIMAL'S AND NOBODY ELSE'S, FOREVER.
 *
 * "seed a per-body phase and small scale/rate jitter off the body's own
 *  identity, deterministic (same body, same look every time)".
 *
 * NOT `Reactions.dieOf`, and the reason is that it is a STREAM: it increments
 * `body._dieN` on every call, so reading it here would silently shift which
 * side a companion rolls under a bolt for the rest of its life. A seed has to
 * be a pure function of who the animal is.
 *
 * NOT `Reactions.jitterOf` either, which hashes the SPAWN POSITION. That is
 * right for a trooper who arrives wherever the formation put him and wrong
 * here for a measured reason: `fieldCompanion` places every companion at the
 * same point off its owner's back quarter, so a position hash makes every
 * massiff you ever field the same individual — the one thing this is for.
 *
 * The identity is the Kennel record's own id when there is one — `c3f9k2ab`,
 * assigned once at adoption and saved, so the animal you keep for twenty runs
 * breathes on the same phase every time you deploy it — and the body's own id
 * otherwise, which is what the sandbox, the dojo and a check get.
 *
 * FNV-1a, which is what the two hashes in Reactions.js already are; a hash is
 * a primitive rather than a rule, and there is nothing here to call.
 */
export function seedOf(id, salt = 0) {
  const s = `${id ?? 'x'}:${salt}`;
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return ((h >>> 0) % 1000003) / 1000003;
}

/** The identity string for a fielded body: its record if it has one, else itself. */
const idOf = (e) => e?._cmpRec?.id || e?.id || null;

/* ══════════════════════════════════════════════════════════════════════════ */
/*  What this body actually has                                               */
/* ══════════════════════════════════════════════════════════════════════════ */

/**
 * THE PARTS, READ OFF THE RIG AND NEVER OFF THE KIND.
 *
 * A `null` for a part is the whole absent-bone story: every consumer below
 * either tests for it or is a beat row that named it in `parts` and so was
 * never selected. There is no path in this file that can reach a bone the
 * body does not have, which is what "a missing bone is a no-op, never a throw"
 * means in code rather than in a comment.
 *
 *   head   `head` on both skeletons. The one part everything else needs.
 *   neck   humanoid only. When it exists the gaze is split across it, because
 *          a droid that turns its whole skull and no neck reads as a turret.
 *   chest  `chest` on a humanoid, `body` on a creature. The thing the ribs
 *          hang on and the thing the tail is welded to.
 *   ribs   the merged meshes ON that bone. Scaling the MESH and not the BONE
 *          is the whole of "amplitude on the ribcage, not on the whole body":
 *          the bone carries the head and the arms, the mesh carries the hide.
 *   ears / tail / wings — real bones, if a rig ever has them. Today none does;
 *          `companions.mjs` drives this resolver against a rig built with all
 *          three so the code is proven rather than merely present.
 *   legs   leg CHAINS, read off the rig's own published `roleOf` rather than
 *          a name regex — 2 on a B1, 4 on a massiff, 6 on a varactyl. A
 *          rancor pup comes out at 2, because its forelimbs are declared
 *          `role: 'arm'` and it stands on two.
 */
export function partsOf(rig) {
  if (!rig?.bones) return null;
  const get = (n) => rig.get(n) || null;
  const head = get('head');
  const chest = get('chest') || get('body');
  const ears = [], tail = [], wings = [];
  let legs = 0;
  for (const b of rig.list || []) {
    const n = b.name || '';
    if (/^ear/i.test(n)) ears.push(b);
    else if (/^tail/i.test(n)) tail.push(b);
    else if (/^wing/i.test(n)) wings.push(b);
    /* THE COUNT IS THE RIG'S OWN, NOT A SECOND WAY OF COUNTING IT.
     * `Rig._measureLimbs` already walks the skeleton and writes `roleOf` — how
     * many chains of this KIND the body has, counted off limb roots — and it
     * is the number `Enemy.severanceOf` prices a lost leg against. Re-deriving
     * "a leg root is a bone whose parent is not a leg" here would be the same
     * rule written twice, which is HANDOFF §2.4 in four lines. */
    if (!legs && b.role === 'leg') legs = b.roleOf || 0;
  }
  /**
   * THE RIBS, AND WHICH WAY ROUND THEY GO — MEASURED, NOT GUESSED.
   *
   * A breath is girth: the chest gets wider and deeper and it does NOT get
   * longer. Which of the mesh's three local axes is "longer" is not the same
   * on the two skeletons and cannot be assumed from the bone. A creature's
   * trunk is a lathe laid along the BODY BONE'S +Z by `trunkRot`, while the
   * bone's own +Y points up; a humanoid's chest is built up its bone's +Y.
   * Writing either one down would be right for half the roster.
   *
   * So the geometry is asked: the longest axis of the merged mesh's own
   * bounding box is the one along the body, and the other two are the girth.
   * Measured once, at resolve time, off a box the builder has usually already
   * computed. Nothing here has to know which builder made the mesh.
   */
  const ribs = [];
  if (chest?.obj) {
    for (const c of chest.obj.children) {
      if (!c.isMesh || !c.geometry) continue;
      if (!c.geometry.boundingBox) c.geometry.computeBoundingBox();
      const bb = c.geometry.boundingBox;
      const d = [bb.max.x - bb.min.x, bb.max.y - bb.min.y, bb.max.z - bb.min.z];
      let along = 0;
      if (d[1] > d[along]) along = 1;
      if (d[2] > d[along]) along = 2;
      ribs.push({ mesh: c, along });
    }
  }
  return {
    head, neck: get('neck'), chest, hips: get('hips') || rig.hipsBone || null,
    ribs, ears, tail, wings, legs,
  };
}

/**
 * THE CONSTANTS FOR ONE INDIVIDUAL — derived, seeded, and computed once.
 *
 * `A` is the archetype row (mass, toughness), `K` the kind row (ward, frag,
 * pace, mount), `plan` the creature plan when there is one (the tail's reach).
 * A body with no kind row — a check's bare massiff, a future kind whose row
 * has not landed — still gets a life; it gets the defaults, which is the
 * honest answer rather than a throw.
 */
export function lifeFor(id, rig, A = null, K = null, plan = null) {
  const parts = partsOf(rig);
  if (!parts?.head && !parts?.chest) return null;

  const mass = Math.max(1, Number(A?.mass) || LIFE.breath.ref);
  const droid = (Number(A?.toughness) || TOUGHNESS.flesh) >= TOUGHNESS.droid;
  /* THE JITTER. Two independent draws, ±6% on the rate and ±14% on the
   * amplitude — enough that two animals of one kind are never in step and
   * small enough that neither of them looks wrong. */
  const rJit = 1 + (seedOf(id, 3) - 0.5) * 0.12;
  const aJit = 1 + (seedOf(id, 4) - 0.5) * 0.28;

  /* NERVE off `frag`, the area-damage multiplier: a body a thermal kills is a
   * body that jumps. Clamped, because a row is a hand-edited thing. */
  const nerve = clamp(Math.sqrt(Number(K?.frag) || 1), LIFE.nerve.min, LIFE.nerve.max);
  /* POISE off `pace`: a quick animal turns its head quickly. */
  const poise = clamp(0.6 + (Number(K?.pace) || 0.6), 0.7, 1.8);
  /* THE TAIL'S LEVER ARM. `plan.tail` is [segments, reach, r0, pitch, curl] and
   * the reach is in plan units, so it is scaled the same way the geometry is.
   * No plan (a droid, a humanoid) means no tail and no sway. */
  const tailReach = (Number(plan?.tail?.[1]) || 0) * (Number(A?.scale) || 1);

  const menu = [];
  for (const b of Object.values(BEATS)) {
    if (b.made === 'droid' && !droid) continue;
    if (b.made === 'flesh' && droid) continue;
    if (b.mount && !K?.mount) continue;
    if ((b.legs || 0) > parts.legs) continue;
    let ok = true;
    for (const p of b.parts) {
      const v = parts[p];
      if (!v || (Array.isArray(v) && !v.length)) { ok = false; break; }
    }
    if (ok) menu.push(b);
  }

  return {
    id, parts, menu, droid, nerve, poise, tailReach,
    /** Cycles a second at rest. See the header for the three animals it lands on. */
    breath: LIFE.breath.rate * (LIFE.breath.ref / mass) ** LIFE.breath.exp * rJit,
    amp: aJit,
    /** Does this one watch the field or watch you? See `K.ward`. */
    ward: Math.max(0, Number(K?.ward) || 0),
    /* The four phases, so nothing about two of a kind is ever in step. */
    tBreath: seedOf(id, 0) * TAU,
    tSway: seedOf(id, 1) * TAU,
    side: seedOf(id, 2) < 0.5 ? 1 : -1,
    /* Live state. */
    beat: null, beatT: 0, beatW: 0, beatSide: 0, next: 0, calm: 0,
    /** Is the gaze committed to something — the one bit `gazeFor`'s envelope
     *  widens on. See `LIFE.look.reach`. */
    watch: 0,
    yaw: 0, pitch: 0, carriage: 0, swayA: 1,
    fl: 0, flYaw: 0, flCd: 0,
    scan: 0, seen: null,
    /* What was left on each bone last frame — see the header's "it adds and
     * never assigns". `null` until the first write. */
    mHead: new THREE.Quaternion(), mChest: new THREE.Quaternion(), mNeck: new THREE.Quaternion(),
    wrote: false,
  };
}

/* ══════════════════════════════════════════════════════════════════════════ */
/*  The layer                                                                 */
/* ══════════════════════════════════════════════════════════════════════════ */

const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _q1 = new THREE.Quaternion();
const _e1 = new THREE.Euler();
const _threats = [];

/**
 * WRITE ONE BONE WITHOUT FIGHTING WHOEVER ELSE WRITES IT.
 *
 * See the header. `mem` is what this layer left on the bone last frame; if the
 * bone still holds it, nobody else has touched it since and the rest pose has
 * to be restored before the new offset goes on, or the offsets integrate. If
 * it does NOT hold it, something authoritative has written the bone this frame
 * and the offset simply rides on top of that.
 *
 * The test is `|dot| > 1 - 1e-9` rather than `equals`, because a quaternion
 * and its negation are the same rotation and nothing guarantees which one a
 * writer produced.
 */
function layerBone(bone, mem, wrote, off) {
  if (!bone?.obj) return;
  const q = bone.obj.quaternion;
  if (wrote && Math.abs(q.dot(mem)) > 1 - 1e-9) q.copy(bone.restQuat);
  q.multiply(off);
  mem.copy(q);
}

/**
 * WHAT IT IS LOOKING AT — the ladder, in the order the brief gives it.
 *
 * "toward its target when it has one, toward the nearest hostile when it does
 *  not, toward the OWNER when the owner is close and nothing is happening, and
 *  toward where the owner is looking when the owner is aiming."
 *
 * Returns a world point, or null for "straight ahead". `sense` is whatever the
 * caller could see; both adapters fill in what they have and leave the rest
 * undefined, which is why every rung tests before it reads.
 *
 * THE WARD FIELD REORDERS TWO OF THE RUNGS, and that is the single biggest
 * visible difference between two companions standing in one field. A kind with
 * a ward is a kind whose standing job is meeting what comes near you, and it
 * watches the field: a hostile inside its ward radius outranks its owner. A
 * kind at ward 0 cannot fight at all — the tooka, the astromech, the medic —
 * and it watches YOU. Neither branch names a kind.
 *
 * "THE OWNER IS AIMING" IS A MEASUREMENT AND NOT A FLAG, because there is no
 * flag: a player is always pointing somewhere. What separates aiming from
 * looking round is that the aim HOLDS — so the adapter tracks how long
 * `owner.aimDir` has been steady and this reads that clock against the
 * `dwell`…`idle` window (see `LIFE.look`, which records what a bare threshold
 * got wrong). Nothing else in the tree owns that question, so nothing is being
 * restated.
 */
export function gazeFor(L, s, out) {
  /* 1. WHAT IT IS FIGHTING. Handed in rather than looked up: on the field this
   *    is `e.target`, which the aim wrap has already decided this frame.
   *
   *    NOT REACH-TESTED, AND IT IS THE ONE RUNG THAT MUST NOT BE. With a
   *    target the gait owns the aim and this layer's gaze channel is zero
   *    (see `stepLife`), so the point is returned for the sake of anyone
   *    asking this function what the animal is watching, and nothing here
   *    turns a bone with it. */
  if (s.target?.position && !s.target.dead) return out.copy(s.target.position).setY(aimY(s.target));

  const owner = s.owner;
  const near = owner?.position && s.at
    ? owner.position.distanceTo(s.at) <= LIFE.look.near : false;
  const foe = s.foe;
  const wardHit = foe && L.ward > 0 && owner?.position
    && foe.position.distanceToSquared(owner.position) <= L.ward * L.ward;

  /**
   * CAN THE HEAD ACTUALLY REST ON IT — the envelope, and the reason it is here
   * rather than at the end of the solve is written out on `LIFE.look.reach`.
   *
   * `L.watch` is one bit of memory: was it watching something last frame. It
   * widens the envelope from `reach` to the whole stop, which is the whole of
   * the hysteresis — a thing you have committed to following is followed out
   * to the stop, a thing you have not is only taken if it is comfortably
   * inside it.
   *
   * YAW ONLY, AND PITCH IS STILL A CLAMP — the two stops are not the same kind
   * of thing and treating them alike breaks the small end of the roster. A
   * body has somewhere else to go in yaw: it turns round, which is why a head
   * held at the yaw stop for a minute and a half reads as a jam rather than as
   * an animal. Up and down there is nowhere else to go, and a cat looking up
   * at a man standing two metres away with its head as far back as its neck
   * goes is not jammed, it is looking up at him. Gating on pitch as well was
   * tried and it is a measurement, not a preference: a tooka's eye is about
   * 0.3 m off the plates and a player's chest is 1.3, so at the 3.5 m heel it
   * asks 0.28 rad of a 0.36 stop and at 2 m it asks 0.46 — the ward-0 kinds,
   * whose whole job is watching YOU, would have given up on you for standing
   * too close.
   */
  const lim = LIFE.look.yaw * (L.watch ? 1 : LIFE.look.reach);
  /* `holds` IS MODULE-LEVEL AND THE COMMITS ARE WRITTEN OUT RATHER THAN
   * CLOSED OVER: `stepLife` runs once a frame for every companion on the field
   * and again for the deck body, and `deck life: a step allocates nothing` is
   * a shipped check that this rung would otherwise be paying into. */
  /* 2/3. THE FIELD OR THE OWNER, in the order `ward` puts them. */
  if (wardHit && holds(s, out.copy(foe.position).setY(aimY(foe)), lim)) { L.watch = 1; return out; }

  if (near && owner) {
    /* THE OWNER'S AIM BEATS THE OWNER'S FACE, FOR A WHILE. A companion that
     * looks where you are looking is doing the one thing that makes a player
     * feel accompanied; one that only ever stares at you is a pet in a
     * photograph. `s.aiming` is a WINDOW — see `LIFE.look`. */
    if (s.aiming && owner.aimDir) {
      const from = owner.chest || owner.position;
      if (holds(s, out.copy(from).addScaledVector(owner.aimDir, LIFE.look.range), lim)) { L.watch = 1; return out; }
    }
    if (holds(s, out.copy(owner.chest || owner.position), lim)) { L.watch = 1; return out; }
  }
  /* 4/5. AND WHAT IS LEFT — the nearest hostile, then the owner from further
   *      off. A rung passed over above for being out of the neck's reach is
   *      passed over here for the same reason, which is what makes the
   *      fall-through mean "look at the nearest thing you CAN" rather than
   *      "look at the same thing again". */
  if (foe && holds(s, out.copy(foe.position).setY(aimY(foe)), lim)) { L.watch = 1; return out; }
  if (owner && holds(s, out.copy(owner.chest || owner.position), lim)) { L.watch = 1; return out; }
  /* NOTHING IT CAN SEE WITHOUT CRANKING ITS NECK OVER: it looks ahead. An
   * animal standing at your heel while you face away is not straining round
   * at you for a minute and a half; it is standing there, breathing, and
   * every so often shaking itself off — which is the rest of this file. */
  L.watch = 0;
  return null;
}

/**
 * WHERE A POINT IS, IN THE HEAD'S OWN FRAME — yaw and pitch off the body's
 * facing and the height of its eye, wrapped to ±π.
 *
 * ONE FUNCTION, TWO CALLERS, AND THAT IS THE WHOLE REASON IT EXISTS. The
 * envelope above decides whether the head can rest on a point and `stepLife`
 * turns the chosen point into the two angles it eases toward. Those are the
 * same arithmetic, and two spellings of it is HANDOFF §2.4 — the second
 * spelling is the one that goes wrong, and here it would go wrong in the worst
 * possible way: an envelope that says yes and a solve that then asks for
 * something outside it puts the head straight back on the stop.
 */
const _bear = { yaw: 0, pitch: 0 };
/** Can the neck come round to this point at all, inside `lim` radians of yaw. */
const holds = (s, pt, lim) => Math.abs(bearingTo(s, pt).yaw) <= lim;
export function bearingTo(s, pt, out = _bear) {
  out.yaw = 0; out.pitch = 0;
  if (!pt || !s?.at) return out;
  const dx = pt.x - s.at.x, dz = pt.z - s.at.z;
  const dy = pt.y - s.at.y - (s.eye ?? 0);
  const flat = Math.hypot(dx, dz);
  if (flat < 1e-4 && Math.abs(dy) < 1e-4) return out;
  out.yaw = ((Math.atan2(dx, dz) - (s.facing || 0) + Math.PI * 3) % TAU) - Math.PI;
  out.pitch = Math.atan2(dy, flat);
  return out;
}

/** Where on a body a look lands: the chest if it publishes one, else the middle. */
const aimY = (b) => (b?.chest?.y ?? b?.position?.y ?? 0);

/**
 * THE ONE STEP. Everything above is data; this is the whole of the behaviour.
 *
 * `s` — the senses, filled in by whichever adapter called:
 *   at        where the body is (Vector3, required)
 *   facing    its yaw in radians (required)
 *   target    what it is fighting, or null
 *   foe       the nearest hostile it can SEE, or null. Looking is not
 *             fighting: this is deliberately unfiltered by the duty, because
 *             an animal under an AWAY order still watches the thing it has
 *             been told not to touch, and that is most of what AWAY looks like
 *             from outside.
 *   owner     the player it belongs to, or null
 *   aiming    has the owner's aim been held still for between `LIFE.look.dwell`
 *             and `LIFE.look.idle` — settled, but not abandoned
 *   hurt      0..1, 1 - hp/maxHp
 *   pinned    0..1, `underFire / UNDER_FIRE`
 *   effort    0..1, speed over its own top speed
 *   winded    is it in the winded window
 *   moving    is it going anywhere
 *   busy      is anything happening at all — an idle beat is abandoned on it
 *   duty      is a standing order in force. NOT the same question as `busy`,
 *             and running the two together is the defect the field note in
 *             `stepCompanionLife` records: on duty is ALERT, so it narrows
 *             which beats the animal will do rather than stopping all of them
 */
export function stepLife(L, dt, s) {
  if (!L || !(dt > 0)) return L;
  const P = L.parts;

  /* ── 1. THE GAZE ─────────────────────────────────────────────────────
   * Eased in the body's own frame, so a companion that turns round does not
   * whip its head to keep a bearing it was holding in world space. */
  let wantYaw = 0, wantPitch = 0;
  const look = gazeFor(L, s, _v1);
  if (look && P.head) {
    /* AND NO YAW CLAMP. `gazeFor` only ever hands back a point the neck can
     * come round to, so the yaw below is inside the stop by construction — see
     * `LIFE.look.reach` for the 899-of-899 frames that were not, and for why
     * pitch is the one of the two that is still clamped here. */
    const b = bearingTo(s, look);
    wantYaw = b.yaw;
    wantPitch = clamp(b.pitch, -LIFE.look.pitch, LIFE.look.pitch);
  }
  /* WITH A TARGET THE GAIT ALREADY OWNS THE AIM. `_poseWalker` aims the head
   * at `this.target` and this layer must not aim it a second time — so the
   * gaze channel goes to zero and only the life offsets ride on top. The test
   * is this ladder's own rung 1, not a restatement of the gait's condition. */
  if (s.target) { wantYaw = 0; wantPitch = 0; }
  const slew = LIFE.look.slew * L.poise;
  L.yaw = damp(L.yaw, wantYaw, slew, dt);
  L.pitch = damp(L.pitch, wantPitch, slew, dt);

  /* ── 2. THE BREATH ───────────────────────────────────────────────────
   * The rate is the state; the amplitude is not. A winded animal breathes
   * FASTER, not deeper — a chest that swells 9% is a balloon. */
  let f = 1;
  if (s.winded) f *= LIFE.rate.winded;
  f *= 1 + LIFE.rate.hurt * Math.max(0, (s.hurt ?? 0) - 0.5) * 2;
  f *= 1 + LIFE.rate.effort * (s.effort ?? 0);
  const rate = L.droid ? LIFE.servo.rate : L.breath * f;
  L.tBreath = (L.tBreath + dt * rate * TAU) % TAU;
  const base = L.droid ? LIFE.servo.amp : LIFE.breath.amp;
  /* A HURT ANIMAL'S CHEST IS SHALLOWER AS WELL AS FASTER, which is what makes
   * the two read as different states rather than as one dial. */
  const breath = Math.sin(L.tBreath) * base * L.amp * (1 - LIFE.breath.sag * (s.hurt ?? 0));

  /* ── 3. THE CARRIAGE — the ears, on the head ─────────────────────────
   * Under fire it goes down and in; with something to watch it lifts and
   * cranes; hurt, it droops. One channel, eased, so the three never fight. */
  let carr = 0;
  carr += LIFE.carriage.pin * clamp(s.pinned ?? 0, 0, 1);
  carr += LIFE.carriage.alert * (s.target || s.foe ? 1 : 0);
  carr += LIFE.carriage.hurt * clamp(((s.hurt ?? 0) - 0.4) / 0.6, 0, 1);
  L.carriage = damp(L.carriage, carr, LIFE.carriage.ease, dt);

  /* ── 4. THE SWAY — the tail, on the trunk ────────────────────────────
   * Loose at rest, stiff when it is watching something, tucked when it is
   * hurt. The amplitude is metres at the tip converted through the plan's own
   * reach, so nothing here knows how long any animal's tail is. */
  let swayWant = 1;
  if (s.target || s.foe) swayWant = LIFE.sway.alert;
  if ((s.hurt ?? 0) > 0.5) swayWant = Math.min(swayWant, LIFE.sway.hurt);
  if (s.moving) swayWant *= 0.45;
  L.swayA = damp(L.swayA, swayWant, LIFE.sway.ease, dt);
  L.tSway = (L.tSway + dt * LIFE.sway.rate * TAU * (1 + (s.effort ?? 0))) % TAU;
  const arm = Math.max(0.12, L.tailReach);
  const swing = Math.min(LIFE.sway.cap, LIFE.sway.amp / arm);
  const sway = Math.sin(L.tSway) * swing * L.swayA * L.amp * (L.tailReach > 0 ? 1 : 0);

  /* ── 5. THE FLINCH ───────────────────────────────────────────────────
   * A decaying impulse, driven by the adapters through `flinch()`. */
  L.flCd = Math.max(0, L.flCd - dt);
  L.fl = damp(L.fl, 0, LIFE.flinch.decay, dt);
  if (L.fl < 1e-4) L.fl = 0;

  /* ── 6. THE IDLE BEATS ───────────────────────────────────────────────
   * "interrupted the instant anything happens" — `busy` is the instant, and
   * the weight eases out rather than cutting, because a beat that vanishes
   * mid-frame is a pop. */
  const busy = !!(s.busy || s.target || s.moving || (s.pinned ?? 0) > 0 || L.fl > 0.05);
  L.calm = busy ? 0 : L.calm + dt;
  if (busy) {
    L.beatW = damp(L.beatW, 0, LIFE.beat.ease, dt);
    if (L.beatW < 0.02) { L.beat = null; L.beatW = 0; }
    L.next = Math.max(L.next, LIFE.beat.settle);
  } else if (L.beat) {
    L.beatT += dt;
    L.beatW = Math.min(1, L.beatW + dt * LIFE.beat.ease);
    if (L.beatT >= L.beat.dur) { L.beat = null; L.beatW = 0; L.next = beatGap(L); }
  } else if (L.menu.length) {
    L.next -= dt;
    if (L.next <= 0 && L.calm > LIFE.beat.settle) {
      L.beat = pickBeat(L, !!s.duty);
      L.beatT = 0; L.beatW = 0;
      L.next = beatGap(L);
      /* WHICH SIDE, AND IT IS THE BEAT'S AS WELL AS THE BODY'S. Drawn once
       * when the beat starts rather than per frame, and salted with the row's
       * own `id`, so the ear an animal scratches is not forced to be the same
       * side its head sweeps to — one `side` for the whole individual made
       * every beat it owns lean the same way, which reads as a limp. */
      if (L.beat) L.beatSide = L.side * (seedOf(`${L.id}:${L.beat.id}`, 8) < 0.5 ? 1 : -1);
    }
  }

  /* ── 7. EVERYTHING INTO ONE ACCUMULATOR, THEN ONTO THE BONES ─────────
   * Nothing above touched a bone. This is the only place that does, so the
   * absent-part guard is written once instead of eleven times. */
  const o = { yaw: 0, pitch: 0, roll: 0, sway: 0, lean: 0, rib: 0, wing: 0 };
  if (L.beat && L.beatW > 0) {
    L.beat.drive(o, L.beatT / L.beat.dur, L.beatSide ?? L.side);
    /* THE WEIGHT IS APPLIED HERE AND NOT INSIDE THE ROWS, so no beat can
     * forget to fade and none of them has to know it is being interrupted. */
    const w = L.beatW;
    o.yaw *= w; o.pitch *= w; o.roll *= w; o.sway *= w; o.lean *= w; o.rib *= w; o.wing *= w;
  }
  /* The flinch: a duck, a turn away and a brace through the trunk. */
  if (L.fl > 0) {
    o.pitch -= LIFE.flinch.duck * L.fl * L.nerve;
    o.yaw += LIFE.flinch.turn * L.fl * L.nerve * L.flYaw;
    o.lean += LIFE.flinch.brace * L.fl * L.nerve;
  }

  applyLife(L, o, breath, sway);
  return L;
}

/** How long until the next beat, off the individual's nerve and its own die. */
function beatGap(L) {
  const [lo, hi] = LIFE.beat.every;
  const r = seedOf(L.id, 5 + ((L.beatN = (L.beatN | 0) + 1) % 97));
  return lerp(lo, hi, r) / L.nerve;
}

/**
 * WHICH BEAT, off the same die, weighted by the row's own `weight` — and
 * narrowed by whether the animal is on duty.
 *
 * "A WARDING ANIMAL IS ALERT, NOT FROZEN" IS TWO CLAIMS AND THIS IS THE
 * SECOND. The first is that it beats at all, which is `busy` above. The second
 * is that it does not beat as though it were off duty: a dog standing your
 * ward does shift its weight, shake itself off and stretch, and it does not
 * put its nose on the ground and graze. `duty: false` is the row saying which
 * of the two it is — the field is on the two rows that take the animal's eyes
 * off the field and its head to the floor, and nothing here knows an order's
 * name, only whether one is standing.
 *
 * `null` IF THE NARROWING LEAVES NOTHING, AND IT FALLS OUT RATHER THAN BEING
 * GUARDED. A `total` of zero makes `r` zero, the loop skips every row and
 * `last` is still null — so the empty case is the same three lines as the full
 * one, and there is no `if (total <= 0)` branch that no shipped body could
 * ever reach. It is not reachable today: `glance` and the droid rows carry no
 * `duty` mark, so every body with a head keeps something. The caller treats
 * null as "not this time", re-arms the timer and asks again.
 */
function pickBeat(L, duty) {
  const may = (b) => !(duty && b.duty === false);
  let total = 0;
  for (const b of L.menu) if (may(b)) total += b.weight || 1;
  let r = seedOf(L.id, 200 + ((L.pickN = (L.pickN | 0) + 1) % 97)) * total;
  let last = null;
  for (const b of L.menu) {
    if (!may(b)) continue;
    last = b;
    r -= b.weight || 1;
    if (r <= 0) return b;
  }
  return last;
}

/**
 * THE BONES. Every write is guarded on the part existing, and every rotation
 * goes through `layerBone`.
 *
 * THE HEAD IS COUNTER-SWUNG. The head is a child of the trunk, so the trunk's
 * yaw carries it: without the `- sway` the animal would shake its head every
 * time it wagged, which is the one thing that would make this read as a bug
 * rather than as an animal. A neck, where there is one, takes a third of the
 * gaze — a droid that turns its whole skull and no neck is a turret.
 */
function applyLife(L, o, breath, sway) {
  const P = L.parts;
  const neckShare = P.neck ? 0.35 : 0;
  /**
   * AND THE SUBSTITUTION IS EXCLUSIVE, WHICH IT HAS TO BE.
   *
   * The trunk carries the wag because the tail is welded to it. A rig that
   * HAS a tail chain does not need that and must not get it: an animal whose
   * tail swings AND whose whole spine swings under it is wagging twice, and
   * the head counter-rotation written for the substitute would then be
   * cancelling a rotation that never happened. So the moment a real tail
   * turns up, the trunk stops doing its job for it.
   */
  const trunk = P.tail.length ? 0 : sway;

  if (P.chest) {
    _e1.set(o.lean, trunk + o.sway, o.roll * 0.25, 'YXZ');
    layerBone(P.chest, L.mChest, L.wrote, _q1.setFromEuler(_e1));
  }
  if (P.neck) {
    _e1.set((L.pitch + o.pitch) * neckShare, (L.yaw + o.yaw) * neckShare, 0, 'YXZ');
    layerBone(P.neck, L.mNeck, L.wrote, _q1.setFromEuler(_e1));
  }
  if (P.head) {
    const k = 1 - neckShare;
    _e1.set((L.pitch + o.pitch) * k + L.carriage,
      (L.yaw + o.yaw) * k - trunk - o.sway, o.roll, 'YXZ');
    layerBone(P.head, L.mHead, L.wrote, _q1.setFromEuler(_e1));
  }
  L.wrote = true;

  /* THE RIBS. The MESH and not the bone — the bone carries the head and the
   * limbs, the mesh carries the hide, and only one of those two is supposed to
   * swell. The axis the body is LONG along was measured at resolve time and is
   * left alone; the other two take the girth, the second at 0.6 of the first
   * so the section stays a section and does not go circular. */
  const g = breath + o.rib * LIFE.breath.amp;
  const s0 = 1 + g, s1 = 1 + g * 0.6;
  for (const r of P.ribs) {
    if (r.along === 0) r.mesh.scale.set(1, s0, s1);
    else if (r.along === 1) r.mesh.scale.set(s0, 1, s1);
    else r.mesh.scale.set(s0, s1, 1);
  }

  /* ── THE PARTS NO SHIPPED RIG HAS YET ───────────────────────────────
   * Real ear, tail and wing bones, driven the day a body publishes them. The
   * ears take the carriage they are the reason for — back and down under fire,
   * pricked forward with something to watch — and the tail chain takes the
   * sway with the amplitude climbing along it, so the tip travels furthest.
   * `companions.mjs` builds a rig that HAS all three and drives this, because
   * a branch nothing exercises is a branch that is not there. */
  if (P.ears.length) {
    const pin = clamp(-L.carriage / -LIFE.carriage.pin, -1, 1);
    for (let i = 0; i < P.ears.length; i++) {
      const b = P.ears[i];
      const side = /r$/i.test(b.name) ? -1 : 1;
      _e1.set(-pin * 0.9, side * pin * 0.5, side * pin * 0.35, 'YXZ');
      b.obj.quaternion.copy(b.restQuat).multiply(_q1.setFromEuler(_e1));
    }
  }
  if (P.tail.length) {
    const n = P.tail.length;
    for (let i = 0; i < n; i++) {
      const b = P.tail[i];
      const t = (i + 1) / n;
      _e1.set(-L.carriage * 0.6 * t, sway * 6 * t, 0, 'YXZ');
      b.obj.quaternion.copy(b.restQuat).multiply(_q1.setFromEuler(_e1));
    }
  }
  if (P.wings.length && o.wing) {
    for (const b of P.wings) {
      const side = /r$|R$/.test(b.name) ? -1 : 1;
      _e1.set(0, 0, side * o.wing, 'YXZ');
      b.obj.quaternion.copy(b.restQuat).multiply(_q1.setFromEuler(_e1));
    }
  }
}

/**
 * SOMETHING JUST HAPPENED TO IT.
 *
 * `amount` is the trigger's own share of `LIFE.flinch`, `away` is the world
 * direction it should shy FROM (or null for straight back), and the refractory
 * window is what stops a burst of six bolts producing six flinches — the same
 * shape `BEHAVIOUR.roll.again` gives a trooper's roll, for the same reason.
 */
export function flinch(L, amount, facing = 0, away = null) {
  if (!L || L.flCd > 0) return false;
  L.flCd = LIFE.flinch.again;
  L.fl = Math.min(1.4, L.fl + amount);
  if (away) {
    let y = Math.atan2(away.x, away.z) - facing;
    y = ((y + Math.PI * 3) % TAU) - Math.PI;
    /* AWAY FROM IT: the sign is the opposite of the bearing, so a bolt down
     * the left side turns the head right. */
    L.flYaw = clamp(-y, -1, 1);
  } else L.flYaw = L.side * 0.4;
  return true;
}

/* ══════════════════════════════════════════════════════════════════════════ */
/*  Adapter 1 — the field body                                                */
/* ══════════════════════════════════════════════════════════════════════════ */

/**
 * ONE LINE IN `CompanionPack.update`, AND THIS IS EVERYTHING BEHIND IT.
 *
 * THE FENCE IS `e.lod` AND NOT A DISTANCE OF ITS OWN. `Enemy.update` writes it
 * every frame off the camera and `_poseWalker` returns on the same `> 1`,
 * because past 62 m the body draws through `MergedSkin` and nothing reads a
 * bone. A second distance test here would be a second answer to a question
 * that already has one, and it would drift.
 */
export function stepCompanionLife(e, dt, world) {
  if (!e || e.dead || e.disposed || !e.rig) return null;
  if ((e.lod | 0) > 1) return e._life || null;

  let L = e._life;
  if (L === undefined || L === null) {
    const K = COMPANION_KINDS[e._cmpKind] || null;
    L = e._life = lifeFor(idOf(e), e.rig, e.A, K, e.built?.plan) || false;
  }
  if (!L) return null;

  const owner = e._cmpOwner || null;
  /* ── THE SENSES ──────────────────────────────────────────────────────
   * Every one of them is a READ of a field the body already carries. */
  const speed = Math.hypot(e.velocity?.x || 0, e.velocity?.z || 0);
  const s = {
    at: e.position,
    facing: e.facing || 0,
    /* Where its eyes are, so a look at your chest is level and not a look at
     * your boots. The head bone's height above its own feet is the honest
     * number and it is already solved. */
    eye: e.rig.get('head')?.obj ? headHeight(e) : 0,
    target: e.target && !e.target.dead ? e.target : null,
    foe: null,
    owner,
    aiming: false,
    hurt: clamp(1 - (e.hp ?? 1) / Math.max(1, e.maxHp || 1), 0, 1),
    pinned: clamp((e.underFire || 0) / UNDER_FIRE, 0, 1),
    effort: clamp(speed / Math.max(0.5, e.speed || 4), 0, 1),
    winded: e.state === 'winded',
    moving: speed > 0.35,
    /**
     * AN ORDER IS NOT SOMETHING HAPPENING, AND FOR ONE ROUND THIS FILE SAID IT
     * WAS. `busy` used to read `_cmpDuty.standing` — true for five of the six
     * orders — and that switched the entire idle layer off under every one of
     * them. Measured on the colosseum floor with the field cleared and the
     * player standing still: under WARD, 0 idle beats in 70 seconds, `calm`
     * pinned at 0.0 s on every frame. WARD is the protector order, one of the
     * two the player named by name, and it is the order a companion spends
     * most of a level under.
     *
     * IT WAS DELIBERATE AND IT WAS WRONG. A warding animal is ALERT, not
     * frozen: it is standing on your shoulder waiting for something to come,
     * which is a dog's whole life and is full of shifting weight, shaking off
     * and looking about. HOLD and AWAY are the same shape — a place to stand
     * and a thing not to do.
     *
     * WHAT IS ACTUALLY WORK IS ALREADY READ, and reading it a second time
     * through the duty was the mistake. An animal charging a body it was sent
     * at is `moving`; one that has reached it has a `target`; one being shot
     * at is `pinned`; one mid-reaction has `reaction`. The only thing left
     * that the other senses cannot see is the VERB — the one order that hands
     * the animal a job of its own with a per-frame tick behind it, and the
     * only one that can have it standing perfectly still doing something:
     * slicing a door, staunching a man, holding a line in front of you. That
     * is what stays. (`id` is an ORDER's id, not a kind's — `stationFor` and
     * `dutyAllows` both branch on the same field, and the kind rule the check
     * enforces is about `COMPANION_KINDS` rows.)
     */
    busy: e._cmpDuty?.id === 'verb' || e.state === 'winded'
      || !!(e.reaction) || !!e.riding,
    /* AND `standing` SURVIVES WITH THE MEANING IT SHOULD HAVE HAD: not "stop
     * moving", but "you are on duty". It narrows the beat menu rather than
     * emptying it — see `pickBeat`. */
    duty: !!(e._cmpDuty && e._cmpDuty.standing),
  };

  /* THE NEAREST HOSTILE IT CAN SEE — on a clock, because it walks a list.
   * `world._hostilesFor` is the same unconditional door the aim wrap uses;
   * this is deliberately NOT filtered by `dutyAllows`, because looking is not
   * fighting and an animal told to break off still watches what it was told to
   * break off from. */
  L.scan -= dt;
  if (L.scan <= 0) {
    L.scan = LIFE.look.scan;
    L.seen = nearestSeen(world, e);
  }
  if (L.seen && (L.seen.dead || L.seen.disposed)) L.seen = null;
  s.foe = L.seen;

  /* IS THE OWNER AIMING — the dwell, measured on the owner and cached on it so
   * the answer costs one subtraction however many companions ask. */
  if (owner?.aimDir) {
    const prev = owner._cmpAimWas || (owner._cmpAimWas = owner.aimDir.clone());
    const moved = 1 - clamp(prev.dot(owner.aimDir), -1, 1);
    owner._cmpAimHeld = moved < 2e-4 ? (owner._cmpAimHeld || 0) + dt : 0;
    prev.copy(owner.aimDir);
    const held = owner._cmpAimHeld || 0;
    s.aiming = held > LIFE.look.dwell && held < LIFE.look.idle;
  }

  /* ── THE THREE FLINCHES ──────────────────────────────────────────────
   * "A bolt passing near, taking a hit, or the owner going down." */
  const hp = e.hp ?? 0;
  if (L.hpWas === undefined) L.hpWas = hp;
  if (hp < L.hpWas - 1e-6) {
    flinch(L, LIFE.flinch.hit, s.facing, null);
    L.hpWas = hp;
  } else if (hp > L.hpWas) L.hpWas = hp;

  const down = !!(owner && (owner.dead || owner.downed || (owner.alive === false)));
  if (down && !L.ownerDown) flinch(L, LIFE.flinch.owner, s.facing, owner.position);
  L.ownerDown = down;

  /* THE BOLT. `BoltPool.threatsNear` is the shipped read — the same one
   * `Reactions.senseBolt` and the player's Focus use — and it is asked on
   * `BEHAVIOUR.roll.scan`, that file's own clock, because it walks the pool.
   * A companion does not ROLL: it is an animal, not a trooper, and there is no
   * reflex attribute behind it. What it does is start. */
  L.bolt = (L.bolt ?? seedOf(L.id, 6) * BEHAVIOUR.roll.scan) - dt;
  if (L.bolt <= 0) {
    L.bolt = BEHAVIOUR.roll.scan;
    const pool = world?.bolts;
    if (pool?.threatsNear) {
      const list = pool.threatsNear(e.chest ?? e.position, BEHAVIOUR.roll.look, _threats);
      for (const th of list) {
        if (th.bolt.team === e.team && !th.bolt.turned) continue;
        if (th.eta > BEHAVIOUR.roll.eta[1]) continue;
        flinch(L, LIFE.flinch.near, s.facing, th.bolt.pos);
        break;
      }
      _threats.length = 0;
    }
  }

  stepLife(L, dt, s);
  /* The world matrices are one behind now. `touchMatrices` is the lazy half of
   * `Rig.updateMatrices`: a reader that turns up gets one walk, and a body
   * nobody reads pays nothing — which is the argument that file already makes
   * for the gait's own closing call. */
  e.rig.touchMatrices?.();
  return L;
}

/** The head bone's height above the body's feet, for a level look. */
function headHeight(e) {
  const h = e.rig.worldPos('head', _v2).y - e.position.y;
  return Number.isFinite(h) ? h : 0;
}

/** The nearest thing it is opposed to, within sight. Looking, not fighting. */
function nearestSeen(world, e) {
  if (!world?._hostilesFor) return null;
  let best = null, bestD = LIFE.look.range * LIFE.look.range;
  for (const o of world._hostilesFor(e)) {
    if (!o || o.dead || !o.position) continue;
    const d = o.position.distanceToSquared(e.position);
    if (d < bestD) { bestD = d; best = o; }
  }
  return best;
}

/* ══════════════════════════════════════════════════════════════════════════ */
/*  Adapter 2 — the deck body                                                 */
/* ══════════════════════════════════════════════════════════════════════════ */

/**
 * ONE LINE AT THE FOOT OF `stepCompanionDeck`, AND THE ROOM WHERE IT MATTERS
 * MOST.
 *
 * The hangar body is deliberately NOT an `Enemy` — CompanionDeck.js spends a
 * page on why — so it has no brain, no target and no LOD.
 *
 * ── AND FOR ONE WHOLE ROUND IT HAD NO GAIT EITHER ─────────────────────────
 *
 * This paragraph used to say the deck animal did not move a single bone
 * except through this file, and that CompanionDeck's own claim to be "walked
 * by a small gait follower off the plan's own published `stance`" was untrue
 * because `fig.phase` was written every frame and read nowhere. **That was
 * right, and it has been fixed in the file that owned it.** `stepCompanionDeck
 * ` now calls `Enemy.prototype._poseWalker` on a duck-typed subject (or
 * `BipedAnimator`, on the three humanoid kinds) with `fig.phase` bound to the
 * solver's own `walkPhase`, so the legs are solved by the same code the field
 * uses and the sit folds hip, femur and shank rather than sinking the root.
 *
 * WHAT THAT CHANGES HERE IS THE ORDER AND NOTHING ELSE, and the order was
 * already right: the gait runs first and this runs last, which is the same
 * relationship this file has with `_poseWalker` on the field. The one thing
 * it does change is that `head` now has a second writer on the deck as well
 * as on the field — `_poseWalker`'s target track — and the "reset if nothing
 * else wrote it" measurement above covers that case by construction rather
 * than by knowing about it.
 *
 * What is this file's is everything above the legs, and it is measured in
 * `companions.mjs`: the head 0.71 rad, the trunk 0.36, the ribs 7.5% at
 * 17.6 breaths a minute, three idle beats in forty seconds, from a baseline of
 * exactly zero on every one of them. And the deck is the room a player stands
 * in for minutes at a time looking at it.
 *
 * NO DISTANCE FENCE HERE, AND THAT IS NOT AN OVERSIGHT. There is exactly one
 * deck body, it holds a station 2.2 m off your back quarter by construction,
 * and it is never further from the camera than the length of the lift ride. A
 * fence that can never close is `HANDOFF §2.3b` — a check that cannot fail
 * wearing a performance argument. The fence that IS load-bearing is the field
 * one, on `e.lod`, and `companions.mjs` proves that one closes.
 */
export function stepCompanionDeckLife(fig, dt, world) {
  if (!fig?.built?.rig) return null;
  let L = fig._life;
  if (L === undefined || L === null) {
    const K = fig.kind || COMPANION_KINDS[fig.rec?.kind] || null;
    /* THE ARCHETYPE IS NOT ON THE FIG, so mass comes off what the builder was
     * handed: `built.scale`, and the plan. A deck body with no archetype row
     * still gets a life — it gets the reference mass, which is the honest
     * default and not a throw. */
    const A = { mass: fig.built.mass ?? massFromPlan(fig.built), scale: fig.built.scale ?? 1,
      toughness: TOUGHNESS.flesh };
    L = fig._life = lifeFor(fig.rec?.id || 'deck', fig.built.rig, A, K, fig.built.plan) || false;
  }
  if (!L) return null;

  const p = world?.player || null;
  const sat = clamp(fig.sit ?? 0, 0, 1);
  const s = {
    /* WHERE THE ANIMAL IS, AND IT IS NO LONGER THE ROOT. Both deck solvers
     * write the pelvis in WORLD coordinates onto a bone parented to
     * `rig.root`, which is only correct while that root is identity — so
     * CompanionDeck.js zeroes it and keeps the ground point on `fig.pos`.
     * Reading `fig.root.position` here would hand this layer the origin. */
    at: fig.pos || fig.root.position,
    facing: fig.facing || 0,
    /* HOW HIGH ITS EYE IS, MEASURED RATHER THAN GUESSED WHERE IT CAN BE.
     * The plan's `hip` is the right answer for a creature and there is no
     * plan at all on the three humanoid bodies (`buildB1`, `buildWookiee`,
     * `buildMedic` publish none), so `?? 0.5` stood a 2.22 m wookiee's eye
     * half a metre off the plates and it looked at your shins. The head bone
     * knows: it is the same reading `headHeight` takes on the field body. */
    eye: deckEye(fig),
    target: null,
    foe: null,
    owner: p,
    aiming: false,
    hurt: 0,
    pinned: 0,
    effort: 0,
    winded: false,
    /* SAT IS THE OPPOSITE OF MOVING, and it is the room's own number: the deck
     * stepper eases `sit` 0→1 and it is already the answer to "has this animal
     * settled". Nothing here re-derives it from the position. */
    moving: sat < 0.5,
    busy: false,
    /* NOTHING ON THE DECK IS UNDER AN ORDER. There is no wheel in the hangar
     * and no `_cmpDuty` on a fig — the animal is off duty by construction, and
     * saying so is the honest reading rather than a field left undefined. */
    duty: false,
  };
  if (p?.aimDir) {
    const prev = p._cmpAimWas || (p._cmpAimWas = p.aimDir.clone());
    const moved = 1 - clamp(prev.dot(p.aimDir), -1, 1);
    p._cmpAimHeld = moved < 2e-4 ? (p._cmpAimHeld || 0) + dt : 0;
    prev.copy(p.aimDir);
    const held = p._cmpAimHeld || 0;
    s.aiming = held > LIFE.look.dwell && held < LIFE.look.idle;
  }
  stepLife(L, dt, s);
  fig.built.rig.touchMatrices?.();
  return L;
}

/**
 * THE EYE HEIGHT OF A DECK BODY, OFF THE SKELETON WHERE THERE IS ONE.
 *
 * `rig.worldPos('head')` is where the head bone actually is this frame, and
 * `fig.pos` is the ground under it, so the difference is the height the gaze
 * ladder should aim from — the same subtraction `headHeight` makes on the
 * field body, and the reason it is a measurement is that three of the twelve
 * kinds publish no plan for a `hip` to be read out of.
 *
 * The plan's own hip is the fallback and not the other way round, because the
 * measurement is only available once the body has been posed at least once:
 * on the very first frame the bones are still at the bind pose about the
 * origin and the subtraction would be a large negative number.
 */
function deckEye(fig) {
  const P = fig.built?.plan;
  const fallback = (P?.hip ?? 0.5) * (fig.built?.scale ?? 1);
  const at = fig.pos || fig.root?.position;
  if (!at) return fallback;
  const h = fig.built.rig.worldPos('head', _v2).y - at.y;
  return h > 0.05 ? h : fallback;
}

/**
 * A DECK BODY'S MASS, WHEN NOBODY HANDED ONE OVER.
 *
 * `callTheCompanion` builds through `ARCHETYPES[K.archetype].build` and keeps
 * only what the builder returns, which does not include the archetype's `mass`
 * — so the breath rate would otherwise be the reference for every kind and a
 * tooka would breathe like a massiff on the one screen where you can watch it
 * do it. The plan's own girth and trunk length are what the geometry is made
 * of: a lathe of radius r and length L at roughly the density of an animal.
 * It is an estimate and it is stated as one; what it has to get right is the
 * ORDER, and 3 kg against 640 is three and a half doublings of the fourth
 * root, which no rounding here can close.
 */
function massFromPlan(built) {
  const P = built?.plan;
  const S = built?.scale ?? 1;
  if (!P?.girth || !P?.trunk) return LIFE.breath.ref;
  const r = P.girth * S, len = (P.trunk[2] || 1) * S;
  return Math.max(1, Math.PI * r * r * len * 1000 * 0.55);
}
