/**
 * BATTLEFRONT BORZ — COMMAND. You are not a lone blade any more; you have an army.
 *
 * Player note #21, in their own words: "a mode or setting where you command and
 * lead your own troops, can either be a Sith leading droids or a Jedi leading
 * clone troopers … your troops when dead will permanently die unless they are
 * replaced, you should be able to order and command them … every ally has a
 * unique name you can see which makes the gameplay more interesting because you
 * can see who lived or who died, maybe one particular one lasts longer than the
 * others and you protect him … the specific troopers that survive get more
 * experience as they live and get stronger themselves too … I want to hear their
 * screams and cheers."
 *
 * Plus #29 (allies are as real as enemies), #30 (formations) and #31 (jet
 * troopers), which are the same feature seen from three sides.
 *
 * ── WHAT THIS FILE IS, AND WHAT IT DELIBERATELY IS NOT ──────────────────
 *
 * It is NOT a second AI. Everything that walks, shoots, takes cover, calls out,
 * duels, bleeds and ragdolls on this battlefield is an `Enemy` — the same class,
 * the same brain, the same body — and the ONLY things that make one of them
 * yours are a team number and six fields hung off it. That is the whole design,
 * and it is what makes note #29 true by construction rather than by effort: an
 * ally is as real as an enemy because it IS one, and a Force push cannot fail to
 * throw it, because there is no code path anywhere that knows the difference.
 *
 * Three seams carry the whole mode, and each one already existed:
 *
 *   TEAM        `Enemy.team` is 1 in the constructor and read by `canHarm`,
 *               `Bolt.team`, `World._boltHitTest` and `Player._stasisCapture`.
 *               Setting it to `TEAM.PARTY` after spawn turns a droid into a
 *               trooper of yours in every one of those places at once — which
 *               is also, for free, why the bolt-stop does not freeze your own
 *               army's fire: `_stasisCapture` skips `bolt.team === this.team`,
 *               and that line was written years before this mode.
 *   pickTarget  `World.pickTarget` is what an Enemy asks "who am I fighting".
 *               It is one function and it now answers for both armies.
 *   _move       the one frame-accurate seam between "the brain decided where to
 *               walk" and "the body walked there". A formation is an overwrite
 *               of `wish` in that gap, and nothing else. See `installCommand`.
 *
 * The alternative — a parallel `Ally` class — was considered and refused in one
 * line: it would be a second body, a second brain, a second ragdoll and a second
 * set of everything this repository has spent its whole life de-duplicating, and
 * the first thing to drift would be exactly the thing the player asked for.
 *
 * ── WHAT MAKES IT HURT ──────────────────────────────────────────────────
 *
 * Permadeath alone is not the feeling the note describes. The feeling is "the
 * one npc that's somehow survived from the beginning is now quite strong as
 * they've been promoted", and that needs three things at once: a NAME you can
 * read, a RANK you can see across a hundred metres of dust, and numbers that
 * actually moved. So a promotion repaints the armour — and it repaints it in the
 * colours the battlefield really uses, which is the one thing every reference
 * image of this fight agrees on: rank is legible BY COLOUR on the helmet crest,
 * the shoulder bells and the torso. Plain white is a trooper, yellow is a
 * commander. See RANKS.
 *
 * ── AND WHAT A FORCE USER IS WORTH TO AN ARMY ───────────────────────────
 *
 * The nine powers in `Powers.js` are a duellist's. Every one of them is about
 * one body, which is the right shape for the game this repository started as
 * and the wrong shape for a general: a Jedi's contribution to a battle was
 * never that they could throw one soldier further than another soldier could.
 * So this file adds two verbs of its own — `COMMAND_FORCE`, RALLY and DREAD,
 * one aimed at your line and one at theirs — and they are expressed in morale
 * and in physics rather than in damage, because a commander power that killed
 * would just be a worse Force lightning.
 *
 * The squad half of the same idea is that a line REACTS. Four things it does
 * that no order has to be given for, all of them derived from state this file
 * already kept:
 *
 *   under fire      it uses the ground it is standing on (`COVER_LEAN`),
 *                   bounded by the formation's own tolerance so the shape
 *                   survives the first bolt;
 *   concentration   a squad shoots at what its leader is shooting at, when
 *                   that is inside its own leash (`targetFor`);
 *   the rout        a squad that has mostly broken withdraws TOGETHER, and
 *                   the steady men go with it (`MORALE.ROUT`);
 *   the callout     which is already true and is not this file's — every body
 *                   in the game raises `alarm`, `scream`, `cheer` and `panic`
 *                   through `Enemy.cry`, and `src/ui/Announcer.js` decides
 *                   which throat says it. An ally is an Enemy, so an ally
 *                   already calls contacts and already cheers its kills.
 */

import * as THREE from '../../vendor/three/three.module.js';
import { ARCHETYPES, applyModifier, DREAD, FORCE_KINDS } from './Enemy.js';
import { rollSoldier, kindOfArmy, attrOf, scaleOf, hasFlag, shedTraits, ATTR_IDS } from './Attributes.js';
import { buildTrooper, buildB1, buildB2, buildBodyguard } from './Bodies.js';
import { TOUGHNESS } from './Combat.js';
import { BOLT_COLORS } from './Bolts.js';
import { MODES, WaveDirector, holdFire, isHeavy } from './Waves.js';
import { clamp, lerp, makeRng, TAU } from '../engine/MathUtil.js';
/* The score's ending. `_endCampaign` is one of the two places in this game a run
 * can be WON rather than survived, and until this import existed the other one
 * — `World._endMeeting` — was the only one that could say so out loud. Same
 * direction as MathUtil above: game reaches into engine, never the reverse. */
import { audio } from '../engine/Audio.js';
import { nudgeFromSwing, bladeClear, placementClear, SWING_REACH } from './Spawn.js';
import { MORALE, HURT_AT } from './Morale.js';
import { applyLevy } from './Levy.js';
import { applyArmour } from './Armour.js';
import { shakeNerve } from './Nerve.js';
import { findCasualty, startDrag, braveryOf } from './Reactions.js';
import { marchFront } from '../world/Front.js';
/* THE SHAPE OF ONE SITTING — how long it is and which ground it crosses.
 * A leaf: Session.js imports nothing from here, which is what lets the
 * constructor below call into it. See its header. */
import { rollSession, planStages, interludeBeats, DEFAULT_PLAN } from './Session.js';
import { armyForOrder, factionOf } from './Databank.js';

/**
 * The stream every roll in this mode comes off.
 *
 * Its own, seeded by `CommandDirector` from the run's number exactly as
 * `seedWaves`, `enemyRng`, `duelRng` and `seedArrivals` are — five streams, one
 * number, so a Geonosis campaign is a shareable seed and the same seed musters
 * the same twelve men with the same twelve names.
 */
/**
 * EXPORTED, LIKE `enemyRng` AND `duelRng`, AND FOR THE SAME REASON.
 *
 * `tools/checks/_shared.mjs` restores every module-scope stream a suite is
 * about to move, and it can only restore what it can name. This one was not on
 * its list, so a suite's checks each left the phase wherever they finished and
 * the next boot mustered a different roster: `theline.21` reported "8 of 9" on
 * one run of its own suite and "9 of 10" on the next, and `theline.16` — whose
 * whole subject is whether a quorum of the living is near the commander —
 * passed three of three ALONE and failed inside the suite. Nothing was wrong
 * with the rule; the two runs had different armies.
 *
 * The name is what makes it fixable. `clocked` reseeds it now.
 */
export const commandRng = makeRng(0x5EED0C7);
const rng = commandRng;
export function seedCommand(seed) {
  const s = (Math.imul((seed | 0) ^ 0x2545F491, 0x9E3779B1) >>> 0) || 1;
  rng.seed(s);
  musterSalt = s;
  return s;
}

/**
 * ── WHY A MAN'S PROFILE IS HASHED AND NOT DRAWN ─────────────────────────
 *
 * `rollSoldier` needs randomness and the obvious source is `commandRng`. It is
 * the wrong one, and `command-pvp.mjs` is where that shows: a stream gives the
 * SAME man different numbers depending on when he was mustered, so two machines
 * building the same army in a different order build two different armies. The
 * client's mirror of a trooper then has a different maxHp from the host's, its
 * copy goes down on a round the host's survives, and `_reconcileClaims` bills
 * the host for a body that is still standing. Measured before this: 0.4 hp
 * across 2 claims from a guest holding an idle input — and it came and went
 * with machine LOAD, because the suite's async checks interleave at their
 * awaits and the interleave decided the draw order.
 *
 * A hash of who he is has none of that. The same designation in the same army
 * on the same run is the same soldier on every machine, in any order, however
 * many times he is built — and `musterSalt` moves with the run seed, so two
 * campaigns do not hand you the same twelve men.
 */
let musterSalt = 0x5EED0C7;

function musterRng(army, type, designation) {
  let h = musterSalt >>> 0;
  const key = `${army || ''}/${type || ''}/${designation || ''}`;
  for (let i = 0; i < key.length; i++) h = Math.imul(h ^ key.charCodeAt(i), 0x01000193) >>> 0;
  return makeRng(h || 1);
}

/* ══════════════════════════════════════════════════════════════════════ */
/*  The roster of bodies                                                  */
/* ══════════════════════════════════════════════════════════════════════ */

/**
 * SEVEN NEW BODIES, AND WHY THEY ARE THESE SEVEN.
 *
 * The player pasted the whole prequel roster into their notes — eight Republic
 * classes and eight CIS ones. Building sixteen would have produced sixteen
 * things that fight identically, because what makes a class distinct in this
 * game is its `preferred` band, its cadence and its toughness, and there are not
 * sixteen distinguishable answers to that. So the ladder is FIVE RUNGS A SIDE,
 * four of which already existed, and each new rung is a different QUESTION:
 *
 *   RUNG   Republic              CIS                  the question it asks
 *   1      trooper (existing)    b1 (existing)        numbers
 *   2      heavy / sniper*       rocket / b2*         suppression vs reach
 *   3      jet                   droideka (existing)  it is above you / it is
 *                                                     behind a shield
 *   4      arc                   bx                   it fights like you
 *   5      officer               magna                it makes the others worse
 *
 *   (* `sniper` and `b2` already exist and are the second rung's other half —
 *      the ladder is not one file's invention, it is the roster the game has.)
 *
 * SYMMETRIC ON PURPOSE. Both armies are playable (a Jedi leads the Republic, a
 * Sith leads the CIS) and both are also the enemy, so an asymmetry here would be
 * a difficulty setting hiding inside a faction choice. Threat numbers are paired
 * rung for rung and the checks assert it.
 *
 * BUILT FROM THE BUILDERS THAT EXIST. `src/game/Bodies.js` is owned elsewhere
 * and is not edited by this mode. `buildTrooper` already takes `color` and
 * `accent` — the accent lands on exactly the three pieces the reference images
 * paint (crest, shoulder bells, knees) — and `buildB1` takes `color`,
 * `markColor` and `eyeColor`. That is enough for every rung here to read
 * differently at fifty metres, and it is why RANKS below can repaint a body
 * without touching a mesh.
 *
 * WHAT IS MISSING, STATED RATHER THAN QUIETLY ABSENT: the jet trooper has no
 * jetpack geometry and the BX has no vibrosword. Both are `Bodies.js` work — see
 * the handover note at the foot of this file. They are distinguishable today by
 * silhouette colour, scale and behaviour; they are not yet distinguishable by
 * hardware.
 */
export const COMMAND_UNITS = {
  /* ── Republic ───────────────────────────────────────────────────────── */

  /**
   * The suppression rung. A Z-6 is not a rifle that hits harder, it is a rifle
   * that does not stop — nine rounds at 0.07 s against the line trooper's three
   * at 0.11 — so what it changes about a firefight is that you cannot cross the
   * open while one is looking at you. Slower and heavier to pay for it: 2.9 m/s
   * against 4.1 means a heavy that has picked a spot has committed to it.
   */
  heavy: {
    label: 'Clone Heavy Gunner', build: (o) => buildTrooper({ ...o, accent: o.accent ?? 0x8a8f98 }),
    scale: 1.06, hp: 78, mass: 96,
    speed: 2.9, toughness: TOUGHNESS.plastoid, ranged: true, weapon: 'dc15',
    fireRate: 2.6, burst: 9, burstGap: 0.07, spread: 0.09, damage: 9,
    preferred: [11, 22], boltColor: BOLT_COLORS.blue, score: 300, threat: 3,
    hipHeight: 0.95, unlockAt: 3,
  },

  /**
   * NOTE #31, VERBATIM: "there should be jet troopers."
   *
   * `float` is the field the training remote uses to hover, and it is the whole
   * of the flight model — this game has no flying brain and inventing one for a
   * trooper would be a different project. What `float: 1.35` buys is real
   * though: the body sits a metre and a third off the deck, which puts it over
   * cover, over the crowd, and inside your blade's arc from an angle nothing
   * else in the roster attacks from. Fast (6.2) and thin (54 hp) because a
   * jump-pack trooper is a raider, not a line unit.
   */
  jet: {
    label: 'Jet Trooper', build: (o) => buildTrooper({ ...o, accent: o.accent ?? 0xc85a22 }),
    scale: 0.98, hp: 54, mass: 70,
    speed: 6.2, toughness: TOUGHNESS.plastoid, ranged: true, weapon: 'dc15',
    fireRate: 2.2, burst: 2, burstGap: 0.16, spread: 0.06, damage: 17, float: 1.35,
    preferred: [8, 17], boltColor: BOLT_COLORS.blue, score: 420, threat: 4,
    hipHeight: 0.95, unlockAt: 5,
  },

  /**
   * The rung that fights like you do. An ARC has the line trooper's rifle and
   * twice its cadence, half again its health, and — the part that matters —
   * `preferred: [4, 11]`, which is INSIDE the range every other shooter is
   * trying to keep. An ARC closes. Blue, a pauldron and a kama in every
   * reference image; the blue is what the accent carries here.
   */
  arc: {
    label: 'ARC Trooper', build: (o) => buildTrooper({ ...o, accent: o.accent ?? 0x2f6fbe }),
    scale: 1.02, hp: 130, mass: 84,
    speed: 5.0, toughness: TOUGHNESS.plastoid, ranged: true, weapon: 'dc15',
    fireRate: 0.95, burst: 3, burstGap: 0.09, spread: 0.035, damage: 15,
    preferred: [4, 11], boltColor: BOLT_COLORS.blue, score: 900, threat: 6,
    /* AN ARC THROWS ONE AND LANDS IT. `threat: 6` divides the scatter hardest
     * of anything on either roster, which is the whole content of "he is
     * better at it" — see `Enemy._maybeGrenade`. */
    grenades: true,
    hipHeight: 0.95, unlockAt: 7,
  },

  /**
   * The rung that makes the others better — and the only body in this mode
   * whose value is not its own numbers.
   *
   * It spawns wearing the `leader` MODIFIER, which is the game's existing rally
   * aura: everything inside RALLY.radius fires faster, hits harder and moves
   * quicker while the officer lives, and there is a ring on the ground saying
   * so. Killing the enemy's officer is therefore a real tactical act, and losing
   * yours is felt across the whole line rather than as one body fewer. Yellow,
   * because every reference image of this battle agrees that yellow is what a
   * commander wears.
   */
  officer: {
    label: 'Clone Commander', build: (o) => buildTrooper({ ...o, accent: o.accent ?? 0xe8b028 }),
    scale: 1.03, hp: 150, mass: 84,
    speed: 4.4, toughness: TOUGHNESS.plastoid, ranged: true, weapon: 'dc15',
    fireRate: 1.15, burst: 2, burstGap: 0.12, spread: 0.05, damage: 14,
    preferred: [9, 18], boltColor: BOLT_COLORS.blue, score: 1200, threat: 7,
    hipHeight: 0.95, unlockAt: 9, commandAura: 'leader',
  },

  /* ── Separatist ─────────────────────────────────────────────────────── */

  /**
   * The CIS's answer to the heavy, and it is the opposite answer: one slow,
   * heavy, telegraphed round instead of a stream. 44 damage at 3.4 s means a
   * rocket droid is a thing you have to WATCH rather than a thing you have to
   * hide from, which is the distinction that stops the two second-rung units
   * being one unit twice.
   *
   * Dark plastoid over the B1 chassis with a cold eye, so the silhouette is the
   * B1's — that is the point, it is a B1 with a tube — and the read is the
   * colour.
   */
  rocket: {
    label: 'Rocket Battle Droid',
    build: (o) => buildB1({ ...o, color: 0x6d6455, markColor: o.markColor ?? 0x9e3524, eyeColor: 0xff8a20 }),
    scale: 1.04, hp: 34, mass: 56,
    speed: 3.1, toughness: TOUGHNESS.droid, ranged: true, weapon: 'e5',
    fireRate: 3.4, burst: 1, spread: 0.03, damage: 44, telegraph: 0.9,
    preferred: [14, 28], boltColor: 0xff7a2a, score: 320, threat: 3,
    hipHeight: 0.96, unlockAt: 3,
  },

  /**
   * The droid that fights like you do — the mirror of the ARC, and the one CIS
   * body with a blade.
   *
   * `melee: true, saber: true` puts it through `DuelBrain`, which is the whole
   * point: a BX is the unit that makes a Jedi's own game unsafe. Gunmetal over
   * the B1 chassis with a white photoreceptor, which is exactly how the
   * reference plates distinguish one — same skeleton, different metal.
   *
   * The blade is `saberColor: 5` (the cold violet-white end of the crystal
   * table) for the reason `bodyguard` uses it: it is an ARC weapon rather than a
   * lightsaber, and the player must never have to read a face to know which way
   * to swing.
   */
  bx: {
    label: 'BX Commando Droid',
    build: (o) => buildB1({ ...o, color: 0x53565c, markColor: o.markColor ?? 0x2a2d33, eyeColor: 0xd8f0ff }),
    scale: 1.06, hp: 120, mass: 74,
    speed: 5.6, toughness: TOUGHNESS.droid, melee: true, saber: true,
    /* NO CAPE, and it is not a taste. `Enemy._build` gives every `saber: true`
     * body an `attachCloak` unless the archetype says otherwise — a rule written
     * when the only sabered bodies were a hooded acolyte and its sparring twin —
     * and a BX commando droid is a bare metal skeleton in every reference plate
     * there is. It is also real per-body cost in exactly the crowds this mode
     * builds: cloth is the most expensive per-character system in the game, and
     * `tools/checks/cloth-cost.mjs` sizes the whole column on how many bodies
     * wear it. It caught these two at 5 of 27 against a budget of 3. */
    cape: false,
    /* A VIBROSWORD, and this row is where the note above `bx` stops being an
     * admission and becomes the thing that ships. `weaponStyle: 'vibro'` draws
     * ground alloy instead of plasma, posts no light, plays no hum and lays no
     * trail; `saber: true` above it still routes the body through DuelBrain,
     * which is what a BX is for. See Saber._buildPhysicalBlade. */
    weaponStyle: 'vibro', bladeLength: 0.98,
    saberColor: 5, hilt: 'Sentinel', form: 'juyo',
    damage: 23, preferred: [1.6, 3.4], score: 900, threat: 6,
    hipHeight: 0.96, unlockAt: 7,
  },

  /**
   * The CIS officer. Same job as the clone commander — it carries the aura —
   * and a completely different fight: an IG-100 is a duellist with an
   * electrostaff, so where the Republic's rung 5 stands back and improves the
   * line, this one walks INTO the line and improves it from there.
   *
   * `buildBodyguard` is the IG chassis the Foundry's 1050-hp general already
   * uses; at scale 1.18 and 260 hp this is the same machine at the size it
   * actually is in the reference plates, and the general remains the boss.
   */
  magna: {
    label: 'MagnaGuard', build: buildBodyguard, scale: 1.18, hp: 260, mass: 140,
    speed: 4.8, toughness: TOUGHNESS.armour, melee: true, saber: true,
    /* No cape — see the note on `bx`. An IG-100's cloak in the source material
     * is a tabard hanging off the chassis, not a simulated garment, and the
     * Foundry's IG general already declines one for the same reason. */
    cape: false,
    /* AN ELECTROSTAFF — double-ended, dark shaft, the charge only at the two
     * claws. It is the weapon the label has always named and the one thing an
     * IG-100 is recognised by; a violet plasma blade was neither. */
    weaponStyle: 'staff', bladeLength: 1.05,
    saberColor: 5, hilt: 'Sentinel', form: 'djemSo',
    damage: 28, preferred: [1.8, 3.6], score: 1400, threat: 7,
    hipHeight: 1.05, unlockAt: 9, commandAura: 'leader',
  },
};

/* ══════════════════════════════════════════════════════════════════════ */
/*  The two armies                                                        */
/* ══════════════════════════════════════════════════════════════════════ */

/**
 * WHO YOU CAN BE, AND WHAT COMES WITH YOU.
 *
 * `tiers` is the ladder in order and it is the ONE list: the muster prices off
 * it, the enemy fill draws from it, the reinforcement offer walks it, and the
 * checks read it. A rung is `{ type, cost, at }` — `at` is the area from which
 * it can be bought at all, so the campaign teaches its own roster: area 1 is
 * line infantry, and a droideka or a jet trooper is something you EARN the
 * right to buy.
 *
 * The two rosters are paired rung for rung by threat (1/2/3/4/6/7 both sides),
 * which is what makes the mirror match fair and is asserted in the checks.
 */
/**
 * WHAT ONE BODY COSTS AT THE MUSTER — DERIVED FROM ITS THREAT, NOT TYPED.
 *
 * The first draft of `tiers` carried a hand-written `cost` beside every rung,
 * and `tools/checks/command.mjs` caught it on the first run: the Republic's
 * threat-2 line trooper and the Confederacy's threat-1 B1 were both priced at
 * 3, which makes a clone 1.5 points of threat per point spent and a B1 exactly
 * 1. Over a five-area campaign that is not a rounding difference, it is one army
 * being 50% better value than the other — and nothing on screen prints a threat
 * number, so no player could ever have seen it.
 *
 * That is the hand-maintained-table-beside-its-generated-twin defect for the
 * ninth time in this repository, in its purest form: a price beside the thing
 * that decides what the price should be. `A.threat` is the game's own single
 * currency for "how much fight is this" — the wave director spends a budget in
 * it — so the muster spends the same currency at a fixed exchange rate.
 *
 * 1 + 1.8 × threat: the +1 is a per-BODY charge, so two cheap bodies cost more
 * than one twice as good, which is what stops a campaign from being twenty-four
 * B1s. At the extremes: a B1 is 3, a MagnaGuard is 14, and both ladders total
 * 51 — asserted, not hoped.
 */
export function musterCost(type) {
  const t = ARCHETYPES[type]?.threat ?? 0;
  return 1 + Math.round(t * 1.8);
}

/** A rung, priced. The `at` is the area from which it can be bought at all. */
const rung = (type, at) => ({ type, at, get cost() { return musterCost(type); } });

export const ARMIES = {
  republic: {
    id: 'republic',
    name: 'The Republic',
    /* A Jedi leads clones — and WHICH order leads which army is declared in
     * `Databank.FACTIONS` rather than here, because `Waves.js` has to ask the
     * same question and cannot import this file (Command imports Waves). See
     * `sideForOrder` below, which reads it from there. */
    leader: 'Jedi General',
    /* What the muster calls one of your people, and what a squad is called. */
    unit: 'trooper',
    squadWord: 'Squad',
    /* The armour a plain body wears before rank paints it. Bone white, matte,
     * with the dust of the plain already on it. */
    plate: 0xe8e9ec,
    /* Which builder option carries the rank colour on this side. A clone's rank
     * is on painted armour panels (`accent`); a droid's is a printed marking
     * (`markColor`). One field name each, so RANKS can stay one table. */
    paint: 'accent',
    tiers: [
      rung('trooper', 1), rung('heavy', 1), rung('sniper', 2),
      rung('jet', 2), rung('arc', 3), rung('officer', 3),
      /* THE MACHINE, and one apiece. See the note above `ARMIES` about why the
       * two ladders' TOTALS are held close and their hardware is not: an AT-TE
       * is a six-legged 1500 hp gun platform and an AAT is a hover tank, and
       * making them threat-identical would be making one army the other with a
       * repaint. `musterCost` keeps the exchange rate honest — 0.53 threat per
       * point against 0.54 — which is the fairness property that actually
       * matters. Area 4, because a machine is what the back half of the advance
       * is FOR. */
      rung('atte', 4),
    ],
  },
  separatist: {
    id: 'separatist',
    name: 'The Confederacy',
    leader: 'Dark Lord',
    unit: 'droid',
    squadWord: 'Unit',
    plate: 0xb9a077,
    paint: 'markColor',
    tiers: [
      rung('b1', 1), rung('b2', 1), rung('rocket', 2),
      rung('droideka', 2), rung('bx', 3), rung('magna', 3),
      rung('aat', 4),
    ],
  },
};

export const ARMY_IDS = Object.keys(ARMIES);

/**
 * HOW MANY RUNGS A PLAYER MAY POINT AT, and it is the SHORTER ladder's length.
 *
 * The contingent's composition is chosen before the army is known — the setting
 * is a slider on the options screen and the army follows the player's order, or
 * the ground, or their own answer (see `armyToLead`). So a rung is picked by
 * INDEX and the index has to be valid in whichever ladder it lands in. Both
 * ladders are seven long today and their totals are held close on purpose (83
 * against 75 points, 0.53 threat per point against 0.54), but nothing forces
 * them to stay the same length, and the day one grows an eighth rung a player
 * who had picked it would silently get the top of the other army's ladder
 * instead. The minimum is the honest ceiling.
 */
export const LADDER_RUNGS = Math.min(...ARMY_IDS.map((id) => ARMIES[id].tiers.length));

/**
 * The rung index that means "no single rung — spend the purse on a mixed line".
 * Below zero rather than past the top so that the slider's travel reads as a
 * ladder with one extra notch at the bottom: mixed, then line, then upward.
 */
export const CONTINGENT_MIXED = -1;

/**
 * WHOSE MEN THESE ARE.
 *
 * ── THE DEFECT, AND IT IS ONE THE AUDIT NAMED RATHER THAN THE PLAYER ──
 *
 * A contingent is allied troops dropped into a mode that never had any, on any
 * of the seven grounds. Measured before this, on all seven, under all three
 * orders: a Jedi got a Republic clone platoon on the Ember Shelf, in the Wood,
 * on the Drifts and in the Colosseum; a Sith got a droid platoon on the same
 * seven; a GREY got the Republic on all seven, because the line below used to
 * read `armyForOrder(orderId) || 'republic'` and the `|| 'republic'` was the
 * whole of the answer for a commander who leads neither army. Twenty-one worlds,
 * one question asked, and the ground never got to say anything.
 *
 * ── "LET THE LEVEL SAY" WAS THE OBVIOUS FIX AND THE DATA REFUSES IT ──
 *
 * `muster.mjs`'s own header proposed it: "allies drawn from the LEVEL's own pool
 * would fit the ground". So the pools were counted. Every one of the seven
 * shipped levels names bodies from BOTH armies in its pool — scoria 6
 * Confederate and 2 Republic, mustafar 7 and 2, colosseum 3 and 1 under six
 * beasts, wood 6 and 2, drifts 7 and 2, alpine 4 and 2, geonosis 13 and 9 — so
 * the pool cannot answer "whose troops garrison this place", only "what fights
 * here". And `level.armies`, the field that IS a declaration, is authored on
 * ONE ground out of seven. A rule that answers for 14% of the game and silently
 * falls through to the order for the rest is the defect with a branch on it,
 * not a fix.
 *
 * ── SO: THE ORDER IS THE DEFAULT, THE PLAYER HAS THE LAST WORD, AND THE
 *    GROUND DECIDES FOR THE COMMANDER WHO BELONGS TO NEITHER SIDE ──
 *
 * Three clauses, in this order, and each one is answering a different reader:
 *
 * 1. A CHOICE, if the player made one — and this is a CONTINGENT'S privilege
 *    only. The note that used to stand here is right about the campaign: "a
 *    Jedi at the head of a droid army is not a build, it is a bug wearing a
 *    menu", and Command, a skirmish and a campaign never pass a choice in (see
 *    the constructor: `this.campaign ? null : cfg.allyArmy`). Their army IS the
 *    mode's fiction. A contingent is not that fiction and its own card says so
 *    — "It is not a campaign — there are no areas, no muster screen and no
 *    victory card" — it is troops the player asked for, in a mode that never
 *    had any, on ground that has no opinion. Who they are is the same kind of
 *    choice as how many of them there are, and that has been a slider since the
 *    feature shipped.
 *
 * 2. THE ORDER, which is what everybody who does not touch the control gets,
 *    unchanged, on every ground. `armyForOrder` stays the one statement of the
 *    mapping — see its note in Databank.js and the seven-of-seven measurement
 *    that put it there.
 *
 * 3. THE GROUND, for a Grey, who leads neither and was handed the Republic by
 *    a hard-coded string. This is the one place a level's own declaration can
 *    decide something a person has not already decided, so it is the one place
 *    it is asked. Geonosis declares `['republic', 'separatist']` and a Grey
 *    lands with the Republic there — the same answer as before, arrived at by
 *    reading the level instead of by typing it — and the day a second ground
 *    declares its garrison the other way round, a Grey's contingent follows it
 *    with no further edit. `'republic'` survives as the floor for the six
 *    grounds that declare nothing, because somebody has to be at the head of
 *    the column.
 */
export function armyToLead(orderId, opts = {}) {
  const chosen = opts.choice;
  if (chosen && ARMIES[chosen]) return ARMIES[chosen];
  const own = armyForOrder(orderId);
  if (own) return ARMIES[own];
  const ground = Array.isArray(opts.ground) ? opts.ground.filter((id) => ARMIES[id]) : [];
  return ARMIES[ground[0] || 'republic'];
}

/**
 * Which army a player of this order leads, with nothing else consulted.
 *
 * The three-clause rule above with both of its optional clauses left out, kept
 * as a name because eleven callers and a dozen checks ask exactly this question
 * — and kept as a DELEGATION rather than a second copy of the lookup, which is
 * the twin this repository has now paid for nine times (§2.3).
 */
export function sideForOrder(orderId) {
  return armyToLead(orderId);
}

/** The army opposing this one. Two of them, so this cannot be a lookup table. */
export function enemyOf(army) {
  return ARMIES[army.id === 'republic' ? 'separatist' : 'republic'];
}

/* ══════════════════════════════════════════════════════════════════════ */
/*  Rank                                                                  */
/* ══════════════════════════════════════════════════════════════════════ */

/**
 * THE PROMOTION LADDER, AND WHY IT IS A COLOUR BEFORE IT IS A NUMBER.
 *
 * The player's note is about a body they RECOGNISE — "one particular one lasts
 * longer than the others and you protect him". A stat block cannot do that at
 * the range this battlefield is fought at. What can, and what every reference
 * image of Geonosis is built on, is paint: rank is legible by colour on the
 * helmet crest, the shoulder bells and the torso, and it is legible from the far
 * side of a dust plain. Plain white is a trooper; yellow is a commander. The CIS
 * marks the same ladder on the same principle — a plain tan B1, a marked one, a
 * command droid.
 *
 * So a promotion is: a title you can read in the roster, a COLOUR you can read
 * on the field, and numbers that moved. All three or none — a rank that only
 * exists in a list is the thing this codebase keeps deleting.
 *
 * THE XP GATES ARE DERIVED FROM THE CAMPAIGN, not chosen. An area is worth 2 XP
 * for surviving it and a body is worth 1 for killing it; a trooper that lives
 * through the whole five-area advance and pulls its weight lands around 30-40.
 * The gates are 0/4/10/20/36, so the ladder is climbable in one campaign and
 * only just — the last rung is for the one who lived through all of it, which is
 * exactly the body the note is about.
 *
 * `hp`/`dmg`/`speed` are multipliers on the archetype, applied at spawn — and
 * they are DELIBERATELY SMALL. See the note over `DUTIES`: a ladder whose top
 * rung is twice the bottom one makes a returning company strictly stronger and
 * makes every fresh recruit furniture, so the numbers were compressed and what
 * a rank actually buys moved to the LICENCE.
 */
/**
 * WHAT EACH UNIT TYPE IS DRAWN TOWARDS, in attribute points.
 *
 * A lean on the roll, never a replacement for it — see `rollSoldier`. An ARC is
 * drawn better on the things an ARC is for and is still allowed to come out a
 * poor shot, because "the good unit is simply the good unit" is the rank ladder
 * again and a roster with no bad ARCs in it has one fewer decision in it.
 *
 * The two armies lean opposite ways on purpose. A clone line is drawn towards
 * nerve and discipline; a droid line towards cadence and protocol and away from
 * stability, which is the source material and is also what makes the two
 * rosters play differently rather than reskin each other.
 */
export const ARCHETYPE_BIAS = {
  /* Republic */
  trooper:  { nerve: 4, discipline: 4 },
  heavy:    { grit: 12, cadence: 8, pace: -10, aim: -6 },
  sniper:   { aim: 20, reflex: 6, cadence: -16, grit: -8 },
  jet:      { pace: 18, reflex: 10, grit: -10, discipline: -6 },
  arc:      { aim: 12, reflex: 12, nerve: 10, discipline: 6 },
  officer:  { bond: 16, discipline: 14, nerve: 10, pace: -6 },
  /* Confederacy */
  b1:       { cadence: 6, nerve: -10, aim: -8, bond: 8 },
  b2:       { grit: 14, cadence: 6, pace: -8, reflex: -6 },
  rocket:   { aim: 10, cadence: -12, grit: -6 },
  droideka: { grit: 20, cadence: 16, pace: -14, bond: -8 },
  bx:       { aim: 16, reflex: 16, pace: 8, grit: -8 },
  magna:    { grit: 12, discipline: 14, reflex: 8, cadence: -10 },
};

/* The per-soldier spread that makes two men of one rank two different men.
 * See src/game/Attributes.js for why a ladder alone was not enough. */
export const RANKS = [
  { title: 'Trooper',    short: 'TRP', xp: 0,  color: null,     hp: 1.00, dmg: 1.00, speed: 1.00,
    duty: 'STANDS', licence: 'Takes his orders and stands in the line. Every man holds this.' },
  { title: 'Veteran',    short: 'VET', xp: 4,  color: 0xb4382c, hp: 1.05, dmg: 1.03, speed: 1.01,
    duty: 'HOLDS',  licence: 'His squad keeps the ground it was given when the man leading it falls.' },
  { title: 'Sergeant',   short: 'SGT', xp: 10, color: 0x2f6fbe, hp: 1.10, dmg: 1.06, speed: 1.02,
    duty: 'LEADS',  licence: 'May be given a squad\u2019s post \u2014 he leads it whatever the roll would have said.' },
  { title: 'Captain',    short: 'CPT', xp: 20, color: 0x3f8f4a, hp: 1.15, dmg: 1.09, speed: 1.03,
    duty: 'CREWS',  licence: 'Digs a position on his own, where a lone man cannot.' },
  { title: 'Commander',  short: 'CMD', xp: 36, color: 0xe8b028, hp: 1.20, dmg: 1.12, speed: 1.04,
    duty: 'RELAYS', licence: 'Steadies any of your men standing near him, in his squad or not.' },
];

/**
 * ── THE LICENCE ─────────────────────────────────────────────────────────
 *
 * WHAT A RANK IS FOR, once it has stopped being a health bar.
 *
 * The numbers above used to run 1.00 → 1.78 health across five rungs, and a
 * roll where the top rung is worth almost twice the bottom one is a roll where
 * the answer to every question is "field the veterans". That is a ratchet
 * wearing a ladder's clothes: it makes a returning company strictly stronger,
 * which is the one direction `Company.js`'s own header refuses, and it makes
 * the fresh men on the slate furniture. So the spread is compressed to
 * 1.00 → 1.20 health, 1.12 damage, 1.04 pace — still worth having, no longer
 * worth restarting a run over — and what a rank buys instead is a LICENCE.
 *
 * A duty is a thing this man may DO that the man below him may not. Cumulative:
 * a rung grants its own duty and every duty under it, so a Sergeant STANDS,
 * HOLDS and LEADS. There is exactly one table — this one — and exactly one
 * reader, `holds()`. Every consumer asks that function; nothing anywhere
 * compares a rank index to a magic number, because the second place that knows
 * "2 means he can lead" is the place that drifts.
 *
 * ── EVERY `licence` STRING HERE DESCRIBES A CONSUMER THAT EXISTS ───────────
 *
 * This panel is printed on a man's page and read as a promise, so the wording
 * is held to what the code does rather than to what the design wants next.
 * The first draft of it promised that an order needs a rung to be TAKEN and
 * that a standing order needs one to be GIVEN, and neither is true: `order()`
 * has no rank test anywhere, and gating one would take a shipped, asked-for
 * feature away from every fresh company on its first night. So `STANDS` says
 * what it is — the floor every man holds — and the four above it name their
 * actual readers:
 *
 *   HOLDS   `_vacancy`  — the plant survives its leader only if somebody
 *                         licensed is still standing in the squad.
 *   LEADS   `leadOf`    — the post the player names, in front of the rule.
 *   CREWS   `_digTick`  — one licensed man on the position is a crew.
 *   RELAYS  `_morale`   — the only presence term that crosses a squad line.
 *
 * `licence.mjs` drives all four on a real director. A rung that gains a
 * consumer changes this sentence in the same commit.
 *
 * The order matters and is the order of the rungs: index i in this list is the
 * duty granted at rung i.
 */
export const DUTIES = RANKS.map((r) => r.duty);

/**
 * DOES THIS MAN HOLD THIS LICENCE?
 *
 * Takes whatever the caller has in hand — a `Trooper`, an `Enemy` wearing one,
 * or a bare rank index — because the fight holds bodies, the tab holds records
 * and the tests hold numbers, and a licence that could only be asked one of
 * those three ways would grow a second copy in the other two.
 *
 * A dead man holds nothing. That is not a nicety: the whole point of the post
 * and the vacancy is that a capability leaves the field when its holder does,
 * and a `holds()` that answered for a corpse would keep the company able to do
 * something nobody alive can do.
 */
export function holds(who, duty) {
  const i = DUTIES.indexOf(duty);
  if (i < 0) return false;
  let rank = null;
  if (typeof who === 'number') rank = who;
  else if (who && typeof who === 'object') {
    const t = who.trooper && typeof who.trooper === 'object' ? who.trooper : who;
    if (t.alive === false || t.dead === true) return false;
    rank = typeof t.rank === 'number' ? t.rank : null;
  }
  /* `Number.isInteger`, not `rank >= 0`: `null >= 0` is TRUE in JavaScript, so
   * the loose test handed every licence to `holds(undefined, 'STANDS')` — a
   * question with no man in it answering yes. */
  if (!Number.isInteger(rank)) return false;
  return rank >= i;
}

/**
 * ══ WHICH SQUAD EACH MAN ENDS UP IN — the deal, as a pure answer ═══════════
 *
 * A man with a squad keeps it; a man with none is dropped into the first squad
 * that is not full. That is the whole rule and it has been `assignSquads`'s
 * rule since squads became a field, but it lived inside a method that MUTATES
 * a live roster — so the Company tab, which wants to show the player the shape
 * their company will actually form, had nothing to ask.
 *
 * Showing it matters now that a seat can be named: an order of battle that
 * printed only the men the player had assigned by hand would say "eight of
 * your ten are unassigned" about a company the field is about to deal into two
 * tidy squads. So the deal is a function, it is handed the men, and it returns
 * pairs rather than writing anything — the roster writes, the screen reads,
 * and neither has its own opinion about where a man goes.
 *
 * @returns `[man, squadIndex][]`, in the order handed in.
 */
export function squadPlan(men, size = SQUAD) {
  const list = Array.isArray(men) ? men : [];
  const counts = new Map();
  for (const t of list) {
    if (!Number.isInteger(t?.squad)) continue;
    counts.set(t.squad, (counts.get(t.squad) || 0) + 1);
  }
  const out = [];
  for (const t of list) {
    if (Number.isInteger(t?.squad)) { out.push([t, t.squad]); continue; }
    let pick = 0;
    while ((counts.get(pick) || 0) >= size) pick++;
    counts.set(pick, (counts.get(pick) || 0) + 1);
    out.push([t, pick]);
  }
  return out;
}

/** Every licence this rank carries, cheapest first — what a man's page prints. */
export function dutiesAt(rank) {
  return DUTIES.slice(0, Math.max(0, Math.min(DUTIES.length, (rank | 0) + 1)));
}

/**
 * ══ WHO IS IN CHARGE OF THIS SQUAD — derived, never stored ═════════════════
 *
 * "Troops should have a squad commander/hierarchy if they already don't,
 *  certain roles are replaced if that person falls in combat, other's are not."
 *
 * ── THE POST COMES FIRST, AND THE DERIVATION IS STILL THE ANSWER ───────────
 *
 * A player who named a man to this squad's seat gets that man, alive and
 * licensed. Everyone else gets the rule below it: the highest-ranked living
 * member, ties broken by experience and then by enlistment order so the answer
 * is stable frame to frame.
 *
 * Deriving it is the whole of "replaced if that person falls" — there is no
 * field to clear and no promotion to schedule, because the question is asked
 * rather than remembered. That is also why the post sits in FRONT of the
 * derivation rather than being a field the derivation reads: when the seat's
 * holder dies this function has already answered, on the same frame, and
 * `onDeath` only has to say so out loud.
 *
 * ── A FUNCTION AND NOT A METHOD, because the SCREEN asks it too ────────────
 *
 * The order of battle on the Company tab shows who leads each squad off the
 * saved roll, where there is no director and no live `Trooper` — just records
 * off disk. A second copy of this rule over there is the hand-maintained twin
 * this file has deleted eight of, and it is the worst possible one to have:
 * the tab would name a man and the fight would obey another.
 *
 * So it takes anything with the four fields, and both callers hand it what
 * they have. A record has `xp` and no `rank` getter, so the rung is derived
 * here when it is absent; a record off disk has no `alive` either, and absent
 * means alive, because a fallen man is not on the roll at all.
 *
 * The role that is NOT replaced is yours. A Jedi commanding is a person, not a
 * rung, and `_endCampaign` is what happens when that one falls.
 */
export function leadOf(men) {
  const list = Array.isArray(men) ? men : [];
  const up = (t) => t && t.alive !== false;
  const rungOf = (t) => (typeof t.rank === 'number' ? t.rank : rankFor(t.xp | 0));
  for (const t of list) if (up(t) && t.post && holds(rungOf(t), 'LEADS')) return t;
  let best = null;
  for (const t of list) {
    if (!up(t)) continue;
    if (!best) { best = t; continue; }
    if (rungOf(t) > rungOf(best)) { best = t; continue; }
    if (rungOf(t) === rungOf(best) && (t.xp | 0) > (best.xp | 0)) best = t;
  }
  return best;
}

/**
 * THE PERSONAL MARKINGS A PLAYER MAY PAINT ON ONE OF THEIR OWN.
 *
 * "Maybe you can even customise certain parts of their appearance … kind of
 *  like keeping track of companions/pets."
 *
 * COSMETIC, AND THAT WORD IS DOING REAL WORK HERE. Not one of these changes a
 * number: `enlistBody` applies the rank multipliers off `RANKS` and then paints
 * this on top, and `Company.js`'s header refuses cross-run power for the same
 * reason `Progress.js` refuses currency. What a mark buys is the ability to
 * pick one man out of a line of ten at forty metres, which is the whole of what
 * a player wants from it and is worth having on its own.
 *
 * IT IS NOT THE RANK COLOUR AND IT DOES NOT SIT WHERE THE RANK COLOUR SITS.
 * `repaint` bolts the rank onto the head crest and both pauldrons and that
 * language has to stay unambiguous — a player reads the line's shape off it.
 * `markUp` puts the personal flash on the SHINS, low and on the outside, where
 * nothing else in this game paints.
 *
 * Deliberately few, deliberately far apart in hue, and every one of them chosen
 * to be legible against BOTH armies' plate — bone white for the Republic and
 * the Confederacy's dull metal — under this game's flat outdoor light.
 */
export const MARKS = [
  { id: 'none',   name: 'None',    color: null },
  { id: 'blood',  name: 'Blood',   color: 0xb4382c },
  { id: 'sky',    name: 'Sky',     color: 0x3a86c8 },
  { id: 'jungle', name: 'Jungle',  color: 0x3f8f4a },
  { id: 'sun',    name: 'Sun',     color: 0xe8b028 },
  { id: 'ash',    name: 'Ash',     color: 0x8e8e96 },
  { id: 'plum',   name: 'Plum',    color: 0x7a4a9c },
  { id: 'rust',   name: 'Rust',    color: 0xc0682a },
  { id: 'ice',    name: 'Ice',     color: 0x9fd8e6 },
];
/** A mark id, made safe. Anything unknown is no mark, which is the default. */
export function markById(id) {
  return MARKS.find((m) => m.id === id) || MARKS[0];
}

/** The rank index this much experience has earned. */
export function rankFor(xp) {
  let r = 0;
  for (let i = 0; i < RANKS.length; i++) if ((xp | 0) >= RANKS[i].xp) r = i;
  return r;
}

/* ══════════════════════════════════════════════════════════════════════ */
/*  Names                                                                 */
/* ══════════════════════════════════════════════════════════════════════ */

/**
 * "every ally has a unique name you can see."
 *
 * A DESIGNATION FIRST, A NAME EARNED. A fresh clone is a number, because that is
 * what the fiction says and because it is also what makes the promotion mean
 * something: the trooper who reaches Sergeant stops being CT-4471 and becomes
 * CT-4471 "Ladder". You do not learn a nickname for the ones who die in the
 * first area, and that asymmetry is the mechanic — the roster screen fills up
 * with numbers and the two or three names in it are the ones you have been
 * protecting.
 *
 * The nicknames are one-syllable, blunt and drawn from what a soldier is called
 * by the people beside them rather than from a fantasy name generator.
 *
 * BOTH ARMIES EARN ONE, AND ONLY ONE OF THEM USED TO.
 *
 * This paragraph read "Droids do not get nicknames — they get a COMMAND
 * DESIGNATION, which is the same idea in the other army's grammar: a numbered B1
 * that survives becomes OOM-9", and `award()` implemented that as
 * `this.army === 'republic'`. What it actually implemented was NOTHING for the
 * other side: there was no second table, no designation change, no branch. A
 * Sith's droids could not earn a name at any rank, ever — so the single most
 * legible half of note #21 ("every ally has a unique name you can see … you can
 * see who lived or who died") was missing from one of the two armies the same
 * note names, and the mirror match was not a mirror.
 *
 * The idea in that paragraph was also wrong on its own terms: a promoted droid
 * whose nickname is another serial prints as `OOM-42 "OOM-9"`, which is not a
 * name you learn, it is a second number. What a battle droid that keeps coming
 * back gets called is what the ones beside it call it, and they are machines, so
 * the words are machine words. Same mechanic, same rung, same permanence, other
 * army's grammar.
 */
const NICKNAMES = [
  'Ladder', 'Boil', 'Waxer', 'Hardcase', 'Kix', 'Jesse', 'Tup', 'Dogma', 'Hevy',
  'Echo', 'Droidbait', 'Cutup', 'Sinker', 'Comet', 'Wolffe', 'Boost', 'Gregor',
  'Crys', 'Longshot', 'Sketch', 'Chatterbox', 'Slick', 'Punch', 'Denal', 'Ringo',
  'Nub', 'Trap', 'Wooley', 'Attie', 'Switch', 'Charger', 'Coric', 'Vaughn',
];

const DROID_NICKNAMES = [
  'Clank', 'Rattle', 'Rivet', 'Sparks', 'Cog', 'Scrap', 'Static', 'Bolts',
  'Ratchet', 'Crank', 'Pincer', 'Grind', 'Shear', 'Prong', 'Solder', 'Flux',
  'Dent', 'Weld', 'Spool', 'Gasket', 'Vane', 'Piston', 'Torque', 'Shunt',
  'Relay', 'Circuit', 'Ohm', 'Anvil', 'Tinny', 'Wedge', 'Slug', 'Ninety',
];

/** The nickname table this army's promotions draw from. One lookup, two armies. */
const nicknamesFor = (armyId) => (armyId === 'separatist' ? DROID_NICKNAMES : NICKNAMES);

const DROID_PREFIX = ['OOM', 'TC', 'PK', 'BX', 'DFS', 'OM'];

/**
 * A designation nobody in this roster already has.
 *
 * Loops rather than trusting the draw, because the whole promise is "unique" and
 * a four-digit number collides at 12 bodies about 1.6% of the time — which is
 * small, and would still eventually put two identical names in the one list the
 * player is meant to read. `taken` is a Set of the strings already issued.
 */
/**
 * HIS NUMBER IS A FUNCTION OF HIS PLACE IN THE LINE, not a draw.
 *
 * This pulled one or two values off `commandRng` per man for a long time, and
 * that was survivable while a name was only a name. It stopped being
 * survivable the day a man's ATTRIBUTES were hashed off his designation
 * (`musterRng`): two machines mustering the same army pull from the same
 * stream, so anything that advanced it between them handed the second machine
 * different names — and now different soldiers. The client's mirror of a
 * trooper came out with a different maxHp, its copy went down on a round the
 * host's survived, and `_reconcileClaims` billed the host for a body that was
 * still standing. `command-pvp.mjs` measures it at 0.4 hp from a guest holding
 * an idle input.
 *
 * The ordinal is the same on both machines because the muster composition and
 * its order are. It is hashed rather than used directly so the roll still
 * reads as a company and not as CT-1000 through CT-1011, and `musterSalt`
 * moves it with the run seed so two campaigns are two different companies.
 */
/**
 * …AND THE SAME HASH UNDER A CALLER'S OWN SALT. `Muster.js` mints the next
 * run's recruits at MENU time, when `musterSalt` belongs to whatever run last
 * seeded it — so it hands its own salt in rather than reading state that is
 * not about its men. The format strings live here and ONLY here: a second
 * copy of the CT-/OOM- grammar in another file is the hand-maintained twin
 * this repository keeps removing.
 */
export function designateWith(salt, army, taken) {
  const ord = taken.size;
  for (let i = 0; i < 64; i++) {
    let h = salt >>> 0;
    for (const v of [ord, i, army.id === 'republic' ? 1 : 2]) {
      h = Math.imul(h ^ (v + 0x9E3779B1), 0x01000193) >>> 0;
    }
    const s = army.id === 'republic'
      ? `CT-${1000 + (h % 8999)}`
      : `${DROID_PREFIX[h % DROID_PREFIX.length]}-${((h >>> 8) % 90) + 10}`;
    if (!taken.has(s)) return s;
  }
  /* 64 collisions in a row means the space is full, not that the hash is bad;
   * a suffix is ugly and correct, and it can never loop forever. */
  return `CT-${taken.size + 1}${(salt % 90) + 10}`;
}

function designate(army, taken) {
  return designateWith(musterSalt, army, taken);
}

/* ══════════════════════════════════════════════════════════════════════ */
/*  Formations                                                            */
/* ══════════════════════════════════════════════════════════════════════ */

/**
 * NOTE #30: "you can order your troops into different formations, circle around
 * you, behind you, in front idk you know better than me."
 *
 * A formation is exactly three numbers and one function:
 *
 *   slot(i, n, k)  where trooper `i` of `n` in squad `k` should stand, in a
 *                  frame whose +Z is the direction the commander is facing and
 *                  whose origin is the commander. Returning `null` means "no
 *                  slot" — the troop is free, which is what CHARGE is.
 *   leash          how far from that slot a trooper may stray to engage, AS A
 *                  MULTIPLE OF ITS OWN REACH. See `leashFor`.
 *   advance        whether the formation moves with you at all. COVER does not
 *                  — it plants where it was ordered, which is the only way "take
 *                  cover" can mean anything when the anchor is a moving player.
 *   fire           a multiplier on how eagerly the troops shoot, so HOLD FIRE
 *                  is a real order and not a slower CHARGE. 0 is `holdFire`.
 *
 * Seven of them, and the seven are not a taste: they are the seven things you
 * can ask a body near you to do that produce visibly different battles.
 * Anything else is one of these with a different radius.
 *
 * ── AND THE SEVENTH IS THE ONE THAT TURNS `fire` ────────────────────────
 *
 * `fire` was declared, documented in the line above, read by `_troops` — and
 * every one of the first six records set it to 1, so `if (F.fire <= 0)` could
 * not be reached by any order the game could give and the field was a knob
 * nothing turned. That is HANDOFF §2.3's close relative: a design number with
 * no caller reads as shipped, and the note over `_castDread` was already
 * describing `holdFire` as "the same one a HOLD order uses" about an order
 * that did not exist.
 *
 * `holdfire` is that order, and the reason it is worth having rather than
 * deleting is that it is the only thing in this table that is about the SHOT.
 * The other six are all shape and footing — where a man stands, how far he
 * strays, whether he comes with you — and every one of them ends in a rifle
 * going off. A commander who wants the rifles quiet (walking into a melee
 * their own line would be firing into, holding a position without announcing
 * it) has no way to say so, and no arrangement of the other six says it: a
 * tight CIRCLE is still twelve men shooting.
 *
 * MEASURED, one fresh Geonosis world per order, `enemyRng` seeded the same
 * way for each, 1800 frames of `world.update` at 1/30 (60 game-seconds), army
 * bolts counted at `bolts.fire` by whether the owner carries a roster record
 * (`tools/checks/command.mjs` holds the same drive at 45 s):
 *
 *     circle 219   column 291   vanguard 276   line 304   cover 241
 *     charge 195   HOLD FIRE 0
 *
 * The zero is not a low rate, it is silence — `_troops` pushes the fuse back
 * up every frame through Waves.js's own primitive. And the held line was the
 * most shot at of the seven — 193 incoming bolts against 104-174 for the six
 * that answer — with all ten men still standing and `_closing` never raised.
 * It was in a firefight and did not fire, which is the order rather than a
 * quiet corner of the map.
 *
 * IT IS NOT THE `hold` TOGGLE AND THE TWO ARE DELIBERATELY DIFFERENT WORDS.
 * `hold()` below holds the GROUND — a toggle over whatever formation is up,
 * which is what note #30's "hold it and stay there" asked for. This holds the
 * FIRE. They compose: an army can be told to hold fire and then told to hold
 * the ground it is holding fire on.
 *
 * ── WHY THE LEASH IS A MULTIPLE AND NOT A DISTANCE ──────────────────────
 *
 * It used to be metres: 5 for cover, 6 for a circle, 7 for a column, 8 for a
 * line, 10 for a vanguard. Every one of those numbers is INSIDE the band the
 * bodies wearing them are built to fight from — a B1 wants 7-15 m, a clone
 * trooper 9-19, a marksman 22-42 — and `targetFor` requires the target to be
 * within the leash OF THE TROOPER'S SLOT. So the order "circle around me" told
 * ten troopers to stand in a ring and refuse every target their rifles could
 * actually reach. Driven, ten troopers over 70 s produced 0 kills and 72 damage;
 * swept, the kill count tracked the leash number monotonically (5→0, 6→0, 7→1,
 * 8→5, 10→8) and did not respond to the SHAPE at all. That is not a formation
 * system, it is one slider with six labels on it.
 *
 * A body's own `preferred[1]` is the game's existing statement of how far it
 * fights from — the liveness watchdog already reads exactly that field to decide
 * whether a body can reach the fight from where it stands — so the leash is a
 * multiplier on it. 1.0 means "engage anything your weapon was built to engage,
 * and not one metre further"; 1.7 is a screen that will go and get it. The
 * ordering of them is preserved, so the tactic each name promises is the
 * tactic it delivers, and the numbers now mean something in a roster where one
 * body's reach is six times another's.
 */
/**
 * How far ahead of the commander `rank` stands, in metres. Derived rather than
 * chosen — see the note on `FORMATIONS.rank`: it is the largest stand that
 * keeps every man of a ten-man rank inside `MORALE.NEAR` (14 m), which caps it
 * at 8.9, and at 8.6 the whole rank is 42.9° off the camera against a
 * half-frame of 45.7°.
 */
export const RANK_STAND = 8.6;

export const FORMATIONS = {
  circle: {
    id: 'circle', name: 'Circle', key: 'Digit6',
    blurb: 'Ring around you, facing out. Nothing reaches you first. They always hear this one.',
    leash: 1.0, advance: true, fire: 1,
    /**
     * ══ FALL BACK TO ME — the one order that is never out of reach ═════════
     *
     * COMPANY.md's Warning #1 names four mitigations real-time permadeath
     * needs and says three exist and this one does not: "It is one order and
     * it belongs here, where the rally point is your body." It does not need
     * to be a new verb. CIRCLE already means *form on me* — every slot in it
     * is solved as an offset from the commander's own frame — so the order
     * whose destination IS the man giving it is the order that cannot be out
     * of earshot of him. You are not telling them where to go; you are
     * standing where they are to go.
     *
     * `always` skips the REACH test and only the reach test. Fear, isolation
     * and a leaderless squad still refuse it, because a man who will not
     * advance into fire will not sprint across it to you either — and if
     * every refusal were skipped this would be the one button that makes the
     * other three ignorable.
     *
     * WHAT IT COSTS is that it is the worst fighting shape in the table: a
     * ring facing outward at 4.2 m has no frontage, no concentration and no
     * cover, and `leash: 1.0` is the shortest in the file. So the escape
     * hatch is real and it is not free — you get your company back and you
     * give up the engagement to do it.
     */
    always: true,
    slot(i, n, k, out) {
      // Spread over the WHOLE roster rather than per squad, or two squads of
      // five make two arcs of five and leave two holes you can be shot through.
      const a = (i / Math.max(1, n)) * TAU;
      const r = 4.2 + (k % 2) * 1.6;
      return out.set(Math.sin(a) * r, 0, Math.cos(a) * r);
    },
  },
  behind: {
    id: 'behind', name: 'Column', key: 'Digit7',
    blurb: 'In column behind you. You are the point of the spear.',
    leash: 1.2, advance: true, fire: 1,
    slot(i, n, k, out) {
      // Two files, so a column of twelve is six deep rather than twelve — a
      // twelve-deep file is 26 m long and the back half is in another fight.
      const file = i % 2 ? 1 : -1;
      const rank = Math.floor(i / 2);
      return out.set(file * (1.6 + k * 0.5), 0, -(3.0 + rank * 2.2));
    },
  },
  front: {
    id: 'front', name: 'Vanguard', key: 'Digit8',
    blurb: 'A screen in front of you. They take it first.',
    leash: 1.7, advance: true, fire: 1,
    slot(i, n, k, out) {
      const across = (i % 4) - 1.5;
      const rank = Math.floor(i / 4);
      return out.set(across * 2.6, 0, 5.0 + rank * 3.0);
    },
  },
  line: {
    id: 'line', name: 'Line abreast', key: 'Digit9',
    blurb: 'One rank either side of you. Everything fires at once.',
    leash: 1.35, advance: true, fire: 1,
    slot(i, n, k, out) {
      // Centred on the commander: an odd roster puts one more man on the left,
      // which is what a line does rather than leaving a gap where you stand.
      const off = i - (n - 1) / 2;
      return out.set(off * 2.4, 0, (k % 2) * -1.8);
    },
  },
  /**
   * RANK AHEAD — the order the mode this game is named for could not give.
   *
   * ── WHAT THE FIRST PLATES OF THE LINE SHOWED ────────────────────────────
   *
   * The roster panel reading TEN STANDING over empty ground with not one
   * trooper in shot. Measured against the RENDERER'S OWN frustum
   * (`tools/_linelook.mjs`) on the first stepped frame after Drop, seed 5,
   * geonosis: all ten alive, 4.0–8.4 m away, LOD 0, rigs parented, none merged
   * and none cohorted — and every one of them between 83° and 180° off the
   * camera's centre line. **Zero in frame.** Nothing is missing and nothing is
   * culled. They are behind you.
   *
   * That is `DEFAULT_FORMATION` doing exactly what its blurb says. `behind`
   * seats every man at `z = -(3.0 + rank·2.2)`; the formation's frame is the
   * commander's held BODY heading, not the aim; and `Player` opens its rig at
   * `yaw = Math.PI` with nothing on the solo path writing it again. So at 0:00
   * the arc the column occupies is the arc the camera does not cover. Half the
   * horizontal frame is 45.7° at the shipped `fov: 60` on 16:9.
   *
   * ── AND NO SHIPPED ORDER FIXED IT, WHICH WAS MEASURED RATHER THAN ASSUMED
   *
   * Every formation in this table, one world, the wave emptied so the shape is
   * the only variable, six game-seconds to walk to the new slots. |bearing|
   * off the camera's centre line, ten men:
   *
   *     circle    19–179°       behind*  125–179°      front     6–74°
   *     line       2–146°       cover     56–179°      charge   64–147°
   *     holdfire  61–138°
   *
   * `line` is the closest in spirit and wraps to 146°, because "one rank
   * EITHER SIDE of you" is 21.6 m of frontage centred ON the commander. `front`
   * reads, and its premise is the opposite of this mode's: "a screen in front
   * of you, they take it first" is the men shielding the Jedi, and §1 of
   * FLAGSHIP.md is "your job is to be the reason the line is still standing".
   *
   * ── SO: THE SAME RANK, MOVED BODILY FORWARD ─────────────────────────────
   *
   * `line`'s 2.4 m spacing, standing `STAND` metres ahead, with the commander
   * behind its centre. Two numbers decide `STAND` and they pull opposite ways:
   *
   *   IT MUST FIT THE FRAME. Ten men at 2.4 m is 21.6 m of frontage, so the
   *     outermost man is 10.8 m across. The camera sits `distance` 3.05 m
   *     behind the player, so the bearing that matters is atan(10.8 / (STAND +
   *     3.05)) and it has to stay under 45.7°.
   *   AS MANY MEN AS POSSIBLE INSIDE `MORALE.NEAR`. 14 m, and it is what
   *     `JEDI_NEAR` pays through — a rank whose ends are outside it is a rank
   *     the Jedi is only half standing with. hypot(10.8, STAND) ≤ 14 gives
   *     STAND ≤ 8.9 for the slot, and the slot is not where a man ends up.
   *
   * 8.6 is the answer, and the SLOT arithmetic says 42.9° from the camera and
   * 13.8 m to the furthest man. MEASURED on the ground rather than trusted —
   * `tools/_linelook.mjs`, seed 5, ten seconds after the drop — the rank comes
   * out at 11.1–15.6 m and −60°…+41°, **ten of ten inside the renderer's own
   * frustum** against zero for the column. So the framing claim holds with room
   * and the morale claim holds for eight of the ten: `_clearBlade`, the terrain
   * and the walk itself move a man off his slot by a metre or two, and the ends
   * of the rank sit just outside 14 m. Stating it that way round rather than
   * quoting the slot, because the slot is not where anybody stands.
   *
   * The second squad stands 1.6 m nearer so two squads are not one machined
   * row, which is the same argument `line`'s own stagger makes.
   *
   * A roster grown to `MAX_STRENGTH` is 55 m of frontage and ±72°, which is a
   * real line seen from the middle of it and not a defect: the order says one
   * rank, and one rank of 24 men is that wide.
   *
   * `Semicolon` AND NOT THE NEXT KEY ALONG THE RUN, because there is no next
   * key along the run. `holdfire`'s own note is the record: the orders are
   * Digit6…Minus and Equal "so the seven are one unbroken run under the left
   * hand", and the eighth has nowhere on that row to go — `BracketLeft` is
   * `lessonBack`, `BracketRight` and `Backslash` are taken, and Digit1–Digit5
   * are not the order row's. `;` is free, it is under the right hand, and the
   * cost is stated rather than hidden: this is the order a run OPENS on and the
   * least likely of the eight to be re-given mid-fight. `registerOrders` deals
   * everything else off this row — the options screen, the pad slot, the label
   * — so nothing below this line is typed twice.
   *
   * ── WHAT IT COSTS THE LINE, WHICH IS THE QUESTION THAT DECIDES IT ──────
   *
   * A rank standing 8.6 m in FRONT of the commander is a rank eating fire the
   * column was not in the path of, and attrition was tuned to its target the
   * commit before this one. Measured rather than argued: `tools/_linehold.mjs`,
   * mode `theline`, geonosis, engagement 1, the IDLE arm, six seeds, both arms
   * from FRESH PROCESSES on trees identical but for this table (HANDOFF §2.5b).
   *
   *     seed        1    2    3    5    7   11     mean   cleared
   *     behind      6    0    5    0    7    0      3.0     3 of 6
   *     rank        0    0    6    0    5    2      2.2     3 of 6
   *     Δ          -6    0   +1    0   -2   +2     -0.8
   *
   * **−0.8 of ten, standard error 1.17 — unmeasured.** §2.5b prices five seeds
   * at a standard error near 1.3 on a ten-man roster and says to treat anything
   * under about 1.5 men as unmeasured; this is under it, both arms clear the
   * same three engagements of six, and the two distributions have the same
   * shape. It is not evidence that the shape is free and it is not evidence
   * that it costs the target. Six seeds is what the box would give; twenty
   * would carry about 0.65 and is what settling it needs.
   *
   * `leash: 1.5` — and it is NOT `line`'s 1.35, for a reason that is a rule
   * rather than a taste. `command: the leashes spread across the table` wants
   * distinct leashes on at least 80% of the formations, so an eighth entry
   * repeating an existing number takes the spread from 6-of-7 to 6-of-8 and
   * fails a check that is measuring something real. 1.5 is also the honest
   * number for the shape: a rank told to hold ground ahead of you engages what
   * its weapons reach and half again, and does not go and get it.
   */
  rank: {
    id: 'rank', name: 'Rank ahead', key: 'Semicolon',
    blurb: 'One rank across your front. You stand behind the line you are holding up.',
    leash: 1.5, advance: true, fire: 1,
    slot(i, n, k, out) {
      /* Centred on the commander ACROSS and ahead of them along, so an odd
       * roster puts one more man on the left exactly as `line` does. */
      const off = i - (n - 1) / 2;
      return out.set(off * 2.4, 0, RANK_STAND - (k % 2) * 1.6);
    },
  },
  cover: {
    id: 'cover', name: 'Take cover', key: 'Digit0',
    blurb: 'Go to ground where you stand and hold. They will not follow you.',
    // The one formation with no slot function at all: `advance: false` means the
    // anchor is FROZEN at the moment the order was given, and the slot is
    // computed against that frozen frame. See `_anchorFor`.
    /* AND IT IS THE ONE ORDER THAT IS RUN. `urgency` multiplies the walk-home
     * pace and its ceiling — see `followSpeed` — because on this order the
     * speed IS the content: cover you reach in four seconds is not cover. */
    leash: 1.1, advance: false, fire: 1, urgency: 1.85,
    slot(i, n, k, out) {
      // A loose scatter rather than a shape — troops going to ground spread out,
      // and a tight ring under fire is a grenade's dream. Deterministic in `i`
      // so a trooper does not swap holes with the man beside him every frame.
      const a = (i * 2.399963) % TAU;              // golden angle: no clumps
      const r = 6 + (i % 5) * 1.9;
      return out.set(Math.sin(a) * r, 0, Math.cos(a) * r);
    },
    /* …AND IT GOES TO SOMETHING. See `_coverSite`: the scatter above is where
     * a man goes when there is nothing to get behind, and every slot that has
     * a real object within reach is moved to the lee of it instead. An order
     * called TAKE COVER that ignores the cover on the level is a scatter with
     * a good name. */
    seeksCover: true,
  },
  /**
   * DIG IN — PLAN.md §4.7, and it is the only thing in this game that makes
   * cover where there was none.
   *
   * *"The ground remembers visually, and `Dig In` is what makes it cover. A
   * sapper turning a crater into a real position is the only thing that
   * produces defilade, because artillery measurably does not."*
   *
   * Both halves of that are MEASURED, on a real world at the shipped low
   * quality tier, with the real body heights (`aimAt` reads a chest at 1.17 m;
   * the median of 666 bolts fired in a live fight leaves the muzzle at 1.15 m).
   * Twelve rays — three ranges by four bearings — from a shooter's muzzle to
   * the chest of a man standing on the spot:
   *
   *     flat ground                         0 of 12 blocked
   *     a shell crater (2.6 m, 0.22 deep)   2 of 12
   *     a dug position (this row's numbers) 12 of 12
   *
   * That is the section's own claim, in one table: shelling the ground does
   * not make cover, and digging it does.
   *
   * ── AND THE DEFILADE IS SYMMETRIC, WHICH IS THE WHOLE TRADE ────────────
   *
   * The same twelve rays fired OUT of the position are blocked 11 of 12. That
   * is not a defect to be tuned away: a chest and a muzzle are within two
   * centimetres of each other on every body in this game, so a berm that stops
   * a bolt coming in stops the one going out, and any parapet that did not
   * would be a wall a player could shoot through. **A position is for holding
   * ground, not for winning a firefight.** A dug-in squad stops trading fire
   * at range and becomes very hard to kill until somebody closes — and what
   * closes is what the Jedi is for. Stated here because a player will find it
   * in about ninety seconds and has to be able to tell it from a bug.
   *
   * ── WHAT IT COSTS ──────────────────────────────────────────────────────
   *
   * `DIG_SECONDS` with their hands full: a digging squad holds its fire, on
   * ground it cannot leave, while the battle goes on around it. That is the
   * price, and it is why this is an order and not a passive.
   */
  digin: {
    /* QUOTE, and it is the last key in the orders' own cluster rather than a
     * free letter: the digit row from 6 to 0, Minus, Equal and Semicolon are
     * the eight orders already, Semicolon's neighbour is where a ninth goes,
     * and there is no free letter left on the board at all (KeyK went to the
     * fire mission). Nothing types it here — `registerOrders` deals it into
     * ACTIONS off this row, and `controls.mjs` re-derives the pair. */
    id: 'digin', name: 'Dig in', key: 'Quote',
    blurb: 'Turn this ground into a position. Their hands are full while they work, and then it is cover.',
    /* `leash: 1.05` — as tight as the rules allow with the width of his own
     * parapet added. `leashFor` floors every order at the body's own band
     * (×1.0), because "do not chase" is a legal order and "do not shoot" is
     * not; a man in a position is the least mobile body on the field, so it is
     * the floor plus a twentieth — 0.95 m at a trooper's 19 m band, which is
     * about the thickness of the berm he is standing behind, so he may always
     * engage something that has climbed onto his own lip. */
    leash: 1.05, advance: false, fire: 1, digs: true,
    slot(i, n, k, out) {
      /* INSIDE THE SCRAPE. The men have to end up under the berm they are
       * throwing up or the position protects nothing, so the shape is a tight
       * ring well inside `DIG_R` rather than the loose scatter TAKE COVER
       * uses — that one is looking for something to get behind and this one is
       * making the thing. Deterministic in `i`, for the same reason. */
      const a = (i * 2.399963) % TAU;
      const r = 1.8 + (i % 3) * 1.4;
      return out.set(Math.sin(a) * r, 0, Math.cos(a) * r);
    },
  },
  charge: {
    id: 'charge', name: 'Charge', key: 'Minus',
    blurb: 'Break formation. Find something and kill it.',
    leash: Infinity, advance: true, fire: 1,
    slot() { return null; },
  },
  /**
   * HOLD FIRE — the one order in the table that is about the trigger.
   *
   * `fire: 0` is the whole of it, and `_troops` is the only reader: it calls
   * `holdFire`, which is Waves.js's own primitive and NOT a second copy of
   * one. That matters more here than anywhere else in this file, because
   * "stop shooting" has four separate mechanisms behind it — the burst that
   * is already queued, the fuse counting down to the next one, a marksman's
   * charged telegraph, and a droideka's six rounds in the air — and a
   * hand-rolled version would silence three of them.
   *
   * `Equal` because the six orders are Digit6…Minus and `=` is the next key
   * along that row, so the seven are one unbroken run under the left hand.
   * It is free in `defaultBindings` and `controls.mjs` re-derives every order
   * row from this table, so nothing here is typed twice.
   *
   * ── WHY THIS SHAPE ─────────────────────────────────────────────────────
   *
   * The tightest footprint in the table, and that is an argument rather than
   * a taste. A line that may not shoot has exactly one remaining use — being
   * bodies between you and them — and every metre of frontage it spreads over
   * is a metre of men standing in a firefight they are not allowed to answer.
   * So two files at the commander's shoulders, one rank deep per pair, at
   * 3.4 m: outside `BLADE_ROOM` by 0.4 m so `_clearBlade` is not shoving the
   * whole order out of shape every frame, and inside every other formation's
   * inner rank (`circle` 4.2, `behind` 3.0 back, `front` 5.0 forward).
   *
   * `leash: 1.0` — THE TIGHTEST THE RULES ALLOW, and the first draft of this
   * order got that wrong in a way worth recording. 0.6 was written here to
   * mean "stay close, you are not shooting anyway", and
   * `command: no order may forbid a body from fighting at its own range`
   * refused it on the spot: a leash under 1.0 leashes a clone trooper to
   * 11.4 m of its slot against a 19 m weapon band, so the order would have
   * stopped the shooting a SECOND time, silently, by starving `targetFor`.
   * That check's own note is the argument — "a formation is allowed to say do
   * not chase; it is not allowed to say do not shoot" — and the whole point of
   * this order is that `fire` is the field that says it, out loud, where one
   * reader acts on it. 1.0 is `circle`'s number: engage anything your weapon
   * was built to engage, and not one metre further.
   *
   * `advance: true`, because this is an order you give while moving — the
   * whole point is that they come with you and stay quiet. Telling them to
   * hold the ground as well is `hold()`, which composes with any formation.
   */
  holdfire: {
    id: 'holdfire', name: 'Hold fire', key: 'Equal',
    blurb: 'Weapons down, close on me. Nobody shoots until you say otherwise.',
    leash: 1.0, advance: true, fire: 0,
    slot(i, n, k, out) {
      const file = i % 2 ? 1 : -1;
      const rank = Math.floor(i / 2);
      return out.set(file * (3.4 + (k % 2) * 1.1), 0, 1.2 - rank * 2.0);
    },
  },
};

export const FORMATION_IDS = Object.keys(FORMATIONS);
export const DEFAULT_FORMATION = 'behind';
/**
 * …AND THE ONE A MEETING OPENS ON, which is a different question.
 *
 * `behind` is right for a campaign and wrong for two commanders at opposite
 * ends of a plain: every formation but this one is solved in its commander's
 * own frame, so two idle commanders hold two idle armies. `charge` is the only
 * order with `leash: Infinity` and no slot — it sends a body to find something
 * rather than to stand somewhere relative to a person. See `enlistCommander`
 * for the measurement that put it here.
 */
export const MEETING_FORMATION = 'charge';

/**
 * …AND THE ONE THE CROSSING OPENS ON, which is a third question again.
 *
 * `behind` is right for a campaign in the abstract and wrong for the opening
 * frame of the mode that is NAMED after its line: measured against the
 * renderer's frustum, it puts 0 of 10 troopers on screen at the moment the
 * player first sees the game. See `FORMATIONS.rank` for the plates, the sweep
 * of every other order, and the arithmetic that picked the stand.
 *
 * It is the OPENING and not an override — see `_openOnRank`, which gives it
 * only when the player has not already ordered something of their own, and
 * gives it through `order()` so the planting, the log entry and the HUD
 * indicator all happen the way they do for a key press.
 */
export const CROSSING_FORMATION = 'rank';

/* ══════════════════════════════════════════════════════════════════════ */
/*  The commander's own Force — what a Jedi does for an ARMY              */
/* ══════════════════════════════════════════════════════════════════════ */

/**
 * TWO VERBS, ONE EACH WAY, AND THE COUNT IS THE DESIGN.
 *
 * The nine powers in `src/game/Powers.js` are a DUELLIST's kit. Every one of
 * them answers a question about one body — this droid is inside my guard, that
 * acolyte is backing off to heal, that crate would hurt if it landed on
 * something. None of them answers the question this mode is actually about,
 * which is what a Force user is worth to two hundred men who cannot lift a
 * rock: a Jedi general's contribution to a battle was never that they could
 * throw one soldier further than another soldier could.
 *
 * So there are exactly two, they are directed at LINES rather than at bodies,
 * and they are the two directions a commander can push:
 *
 *   RALLY   yours. Nerve, and the fighting that comes back with it.
 *   DREAD   theirs. Nerve taken away, and the footing with it.
 *
 * A third was drafted and cut. Every candidate — a barrier that turns bolts, a
 * wave that flattens the enemy rank, a pull that drags a line off its ground —
 * turned out to be `push`, `stasis` or `unleash` with a bigger radius, and a
 * power whose only novelty is its radius is a slider with a name on it. That
 * is the same argument FORMATIONS makes about its six: these are not a taste,
 * they are the things you can ask the Force to do to a formation that are not
 * each other.
 *
 * ── NOTHING HERE DEALS DAMAGE ──────────────────────────────────────────
 *
 * Deliberately, and it is the whole reason the pair is worth having beside a
 * kit that already contains lightning. DREAD's entire output is a body that
 * cannot shoot straight, has lost the burst it was in the middle of, has been
 * knocked off its line and is shouting about it; the damage number is zero and
 * `castForce` passes a literal 0 into `applyKnockback` to say so. A commander
 * power that killed would be measured against lightning, lose, and be a worse
 * lightning; measured against what it actually does — a firing line that stops
 * firing for four seconds while yours walks into it — it is a different game.
 *
 * ── WHY NO KEY, AND WHY THAT IS NOT THE KeyB/KeyN DISEASE ──────────────
 *
 * Every other control in this game carries a `keys` row in ACTIONS, and the
 * two bugs this repository has written the longest notes about are controls
 * that did not (stasis and rend read raw KeyB/KeyN inside Player.js; the six
 * order keys were read raw off FORMATIONS). Neither of those is this. Those
 * were keys that WORKED and that nothing could see — unrebindable, absent from
 * the options screen, invisible to `findConflicts`. These records carry no key
 * at all, which `registerOrders` reads correctly as "not a keyboard action"
 * and skips, so `ACTIONS` is unchanged and there is nothing to collide with.
 *
 * They live on the ORDER WHEEL, which is the input device note #18 asked for
 * in as many words — "commanding your troops takes up too many buttons so it
 * needs to be a small popup mousewheel sort of thing" — and every letter
 * within reach of WASD is already spoken for (see the note over `unleash` in
 * Bindings.js, which had to go hunting as far as U). A commander verb is a
 * deliberate act with a twelve-second cooldown on it, which is exactly the
 * kind of thing a wheel is for and exactly the kind of thing a reflex key is
 * not. Adding `key: 'KeyX'` to a record below is all it would take to change
 * that answer, and it would be bound, listed and conflict-checked the same
 * day — which is the property the two old bugs did not have.
 */
export const COMMAND_FORCE = {
  rally: {
    id: 'rally', name: 'Rally', force: true,
    blurb: 'Steady your line. Anyone still listening stands up and fires faster.',
    /**
     * 26, between `push` at 20 and `lightning` at 30, and the placement is the
     * argument: this is worth more than shoving one body and less than killing
     * one. The pool is 100 and regenerates at 7.5/s, so a rally is three and a
     * half seconds of standing still — you cannot open every engagement with
     * it and still have a jump in the bank.
     */
    cost: 26,
    /** Long enough that it is a decision. Two rallies inside one wave, not ten. */
    cd: 12,
    /**
     * 22 m, against MORALE.NEAR's 14. Presence already pays a line for standing
     * with it out to 14 m; a verb that reached no further would be a button
     * that does what walking does. 22 takes in a line abreast of twelve at
     * 2.4 m spacing from the middle of it, which is the shape this is for.
     */
    radius: 22,
    /**
     * 8 s of `RALLY` on the bodies it reaches — the same aura the Leader
     * modifier carries, granted by the Force instead of by a standard. The
     * modifier refreshes at RALLY.refresh (0.25 s) every frame it is in range;
     * this hands out eight seconds at once and lets Enemy's own timer drain
     * it, so there is one implementation of what a rallied body does and this
     * verb is only a different way of switching it on.
     */
    seconds: 8,
    /** What the notice says once it knows how many it reached. */
    reached: (n) => `${n} of your own steady, and firing faster`,
    /* A RISING sweep, which is what `pull` is (180 → 1400 Hz) and what a line
     * being drawn back together should sound like. `push` is the falling one
     * and it belongs to the verb below. Named on the record rather than typed
     * into `castForce` for the same reason `slot` is named on a formation. */
    sound: 'pull',
    /**
     * WHAT THE VERB DOES, ON THE RECORD.
     *
     * `castForce` used to branch on the id — `id === 'rally' ? … : …` — which
     * is a rule restated beside the table that owns it (HANDOFF §2.4) and it
     * means a third verb is an edit in two places, one of which nothing would
     * remind you about. A formation is "three numbers and one function"; so is
     * this. The function is handed the director because the work belongs to
     * the army, not to the row.
     */
    cast: (d, P, c, A) => d.rallyNear(A.pos, P.radius, c, P.seconds),
  },
  dread: {
    id: 'dread', name: 'Dread', force: true,
    blurb: 'Reach into the line in front of you. They lose the shot and their feet.',
    /** 32, past lightning's 30: it reaches a whole rank rather than one body. */
    cost: 32,
    cd: 16,
    /** Further than RALLY, because it is thrown at a line you are not standing in. */
    radius: 26,
    /**
     * ±60° of the commander's own heading. Not a radius, because "the enemy in
     * front of you" is the sentence this verb has to keep — a 360° version
     * would take the flank you cannot see and the men behind you would watch a
     * fight they were not in. 1.05 rad is a frontage you can aim by turning
     * your body, and `headingOf` is what it is measured against, so it follows
     * the blade rather than the camera.
     */
    arc: 1.05,
    /**
     * 6 s. Shorter than RALLY's 8 on purpose: the effect is on bodies you do
     * not own and cannot see the state of, and a debuff you cannot read the
     * end of should not outlast the advance it buys.
     */
    seconds: 6,
    reached: (n) => `${n} of theirs off the trigger and off their line`,
    /** The falling one: a rank going backwards. See `rally.sound`. */
    sound: 'push',
    cast: (d, P, c, A) => d._castDread(P, c, A),
  },
};

/**
 * EVERYTHING A COMMANDER CAN ORDER, formations and Force alike, in one table.
 *
 * This is what the order wheel and the bindings registry should be handed, and
 * it is the reason `order()` below answers for both kinds: an order is an
 * order, and a player holding the wheel open is choosing between "form a line"
 * and "steady them" in the same gesture, not between two systems.
 *
 * `FORMATIONS` stays exactly what it was and is still the authority on what a
 * formation is — `commandConfig`'s standing-order setting, `_troops`, `steer`
 * and `slotFor` all read it and none of them may ever be handed a verb. The
 * union is built here, once, rather than by each consumer doing its own spread,
 * so there is one statement of what the full set is.
 */
export const ORDERS = { ...FORMATIONS, ...COMMAND_FORCE };
export const ORDER_IDS = Object.keys(ORDERS);

/**
 * ══ HOW FAR AN ORDER CARRIES — the cost that exists in every mode ══════════
 *
 * COMPANY.md PHASE 2, and the sentence it opens with was a measurement:
 * "`order()` has no distance test and no rank test of any kind — verified. An
 * order reaches every man on the roll, anywhere, instantly." So the command
 * interface was a set of buttons that always worked, and every capability
 * built on top of it — a squad's own ground, a licence, a billet — was
 * expensive against nothing. SCOPE calls fixing this the highest-leverage of
 * its three capability mechanisms, and the argument is that REACH IS A COST
 * THAT EXISTS EVERYWHERE, because every mode has your body in it. A quorum
 * does not travel; a distance does.
 *
 * 34 m, and the number is read off the shapes the orders themselves make.
 * `line`'s frontage at full strength is about 26 m and `MORALE.NEAR` is 14, so
 * a reach under about 30 would refuse an order to the far end of your own line
 * abreast — a rule that fires on a formation the player did nothing wrong to
 * form. 34 takes in the whole of every formation in the table with a little
 * room, and stops at about the distance a squad sent to hold a flank ends up
 * from the man who sent it. What it costs is exactly the thing the mode is
 * about: send a squad away and you stop being able to talk to it.
 */
export const ORDER_REACH = 34;

/**
 * …AND HOW FAR IT CARRIES FROM SOMEBODY ELSE'S MOUTH — RELAYS' second consumer.
 *
 * `RANKS[4].licence` promises a Commander "steadies any of your men standing
 * near him, in his squad or not", and `MORALE.RELAY_NEAR` was the whole of it:
 * a presence term worth 0.035/s. A licence whose only effect is a morale
 * trickle is a line of text. This is the other half — a man licensed to RELAY
 * who is himself inside your reach becomes a SECOND SOURCE of the order, and
 * everything within 20 m of him hears it.
 *
 * Shorter than yours, because he is passing on what he was told rather than
 * giving it: 20 m is a squad's own frontage, which is the honest span of one
 * sergeant's voice. Two of them chain — his relay is not a voice for a third —
 * deliberately: an order that hops indefinitely is an order with no reach at
 * all, and the point of the mechanism is that the map has places you cannot
 * talk to. One hop is a capability; unlimited hops is the old bug with extra
 * steps.
 */
export const RELAY_REACH = 20;

/**
 * WHERE FEAR STOPS A MAN ADVANCING — and it is `braveryOf` and nothing new.
 *
 * COMPANY.md is explicit that compliance is rolled "against a per-man value
 * built from existing terms (`Reactions.braveryOf`, presence `share`,
 * discipline) — no dice, no new attribute". `braveryOf` is already
 * `morale*0.72 + rank/4*0.28 + rally`, so it carries the whole ladder and the
 * whole morale table, and a shaken man is a man his own numbers say is shaken.
 *
 * 0.30, and the asymmetry beneath it is the design: fear refuses an ADVANCE
 * and never refuses cover. A model where a frightened man ignores "take
 * cover" is a model that has never met a frightened man, and it would make the
 * mechanic read as the game breaking rather than as the men behaving. So the
 * only orders fear can stop are the ones that ask a man to walk toward the
 * thing shooting at him.
 */
export const SHAKEN_AT = 0.30;

/**
 * …AND HOW CLOSE A FRIEND HAS TO BE FOR HIM NOT TO BE ALONE.
 *
 * The second refusal, and it is the one that gives a wiped-out squad a voice.
 * A lone survivor ordered to charge is being ordered to charge by himself, and
 * *alone* is the reason. 12 m is inside `MORALE.NEAR`'s 14 — a man who is
 * close enough to steady you is close enough to advance with.
 */
export const ALONE_NEAR = 12;

/**
 * ── THE RUNNER ────────────────────────────────────────────────────────────
 *
 * "Press the same order again inside a short window and a named man leaves the
 * line to CARRY it. He can be killed on the way, and then the order dies with
 * him and the log says so."
 *
 * 6 seconds is the window: long enough to be a deliberate second press and
 * short enough that pressing the same order twice in one engagement, thirty
 * seconds apart, is not read as a dispatch. He has 30 s to get there — past
 * that he has failed and rejoins, because a runner who never times out is a
 * man permanently out of the line. And he delivers at 8 m, which is inside
 * `RELAY_REACH` and outside a body's own leash: he has to actually arrive.
 */
export const RUNNER_WINDOW = 6;
export const RUNNER_LIFE = 30;
export const RUNNER_DELIVER = 8;

/**
 * EVERY REASON AN ORDER CAN BE REFUSED, in the words the player is shown.
 *
 * `SCOPE.md:78-81`: "Every refusal needs a visible reason." A list rather than
 * four string literals scattered through `_ask`, so a check can assert that
 * the set the player can be shown is the set the code can produce — the same
 * reason `DUTIES` is derived from `RANKS` rather than typed twice.
 */
export const REFUSALS = ['out of reach', 'shaken', 'alone', 'unled'];

/**
 * THE SHORTEST LEASH ANY BODY IS EVER GIVEN, in metres.
 *
 * `preferred[1]` is 3.4 m for a BX commando droid and 3.6 for a MagnaGuard,
 * because a duellist's engagement band is the length of its arm. Multiplying
 * that by a formation's 1.0 would leash a melee trooper to a circle barely
 * wider than the slot it is standing in, and an ally that cannot take one step
 * toward the thing in front of it is not a soldier. The floor is what makes the
 * leash a statement about the FORMATION for a body whose own reach is smaller
 * than any formation's shape.
 */
export const LEASH_FLOOR = 10;

/**
 * HOW FAR THE COMMANDER MAY TURN BEFORE THE FORMATION TURNS WITH THEM, in
 * radians, and how fast it follows once it does. See `_frame`.
 *
 * 40° is a quadrant either side: it covers looking about, checking a flank and
 * tracking a target across the front without the line moving at all. 1.1 rad/s
 * is a little slower than a person turns on the spot, so committing to a new
 * direction is something the squad visibly answers rather than something it
 * mirrors.
 */
const FRAME_DEADBAND = 0.70;
const FRAME_SLEW = 1.1;

/** Which way a commander's BODY is pointing — not what they are aiming at. */
function headingOf(p) {
  if (p.facing !== undefined && p.facing !== null) return p.facing;
  return p.aimDir ? Math.atan2(p.aimDir.x, p.aimDir.z) : 0;
}
const wrapPi = (a) => Math.atan2(Math.sin(a), Math.cos(a));

/**
 * THE RING NOBODY MAY STAND IN, in metres — the commander's own blade.
 *
 * "in too many of the troop formations the troops are totally in the way of
 * your saber like they don't avoid it at all and crowd you."
 *
 * A lightsaber is a 1.15 m blade on a 0.6 m reach swung from a 0.55 m guard
 * sphere, so the working volume is about 2.3 m of radius and everything inside
 * it is something you are about to cut in half. The `circle` formation put its
 * inner rank at 4.2 m, which is clear — but a formation is a TARGET and a
 * trooper walking to it, fighting from it, or shoved into you by a blast is
 * not at it. So the clearance is enforced on the body rather than on the slot:
 * see `_clearBlade`.
 *
 * 3.0 rather than 2.3: the margin is a step, because a trooper that is exactly
 * at the edge of the swing is one the player has to think about.
 */
const BLADE_ROOM = 3.0;

/**
 * How wide the fan a deploying line forms up in, centred on the commander's
 * BACK. 240°: everything except the 120° in front of them.
 *
 * It is deliberately wider than `Spawn.SWING_HALF_ARC`'s 160° wedge is narrow —
 * the two do not have to agree, and it would be worse if they did. The fan is a
 * SHAPE and the wedge is a LAW: a fan that exactly complemented the wedge would
 * put every deployment's outermost man precisely on the boundary the law is
 * about, which is the same defect as placing a body at the edge of
 * `BLADE_ROOM`. 240° leaves 20° of daylight either side of the swing before
 * the nudge has anything to do.
 */
const REAR_FAN = 4.19;

/**
 * HOW FAR A REFUSED DEPLOYMENT LOOKS NEXT, and how many times.
 *
 * 2.6 m is one clone trooper's step-and-a-bit and it is a little more than the
 * gap between the shipped ring's own radii (4 → 6.2 → 8.4 is 2.2 apart),
 * rounded up so that a retry clears the object that refused the first try
 * rather than sliding along its face. Six tries puts the last ring at
 * 8.4 + 5 × 2.6 = 21.4 m, and that ceiling is not a taste: `command.mjs`
 * asserts the furthest trooper of a deployment lands inside 30 m of the
 * commander, because a line set down at the far edge of the spawn ring has not
 * reinforced you, it has started them on a walk.
 *
 * Six is also enough. Measured across the seven grounds, 5.0% of placements
 * were on ground `spawnClear` refuses; a retry at a re-jittered angle and a
 * wider radius is a nearly independent draw, so six of them leave a residue far
 * below the rate at which any of this is visible. See `_standingRoom`.
 */
const DEPLOY_WIDEN = 2.6;
const DEPLOY_TRIES = 6;

/** How far a trooper taking cover will go looking for something to get behind. */
const COVER_HUNT = 16;

/**
 * …AND HOW FAR ONE WHO IS MERELY BEING SHOT AT WILL GO, which is a different
 * number because it answers a different question.
 *
 * "they should take cover when under fire" is not the same order as TAKE
 * COVER, and answering it with the same 16 m hunt would delete every other
 * formation in the game: the first bolt into a line abreast would send twelve
 * men off to twelve crates and the shape would never come back. What infantry
 * actually do on a position they have been told to hold is use the ground
 * WITHIN it — a step and a half to put a drum between you and the muzzle — so
 * the reactive hunt is bounded by `FORM_TOLERANCE`, the same slack the
 * formation already allows a body that is standing still.
 *
 * 2.2 m of tolerance and a 4.5 m hunt: a trooper will take anything it can
 * reach in about a second, and the line it is standing in is still a line.
 */
export const COVER_LEAN = 4.5;

/**
 * HOW LONG A BODY COUNTS AS BEING UNDER FIRE after it is hit, in seconds.
 *
 * The signal is a hit rather than a bolt passing close, and that is a choice
 * with a cost that is worth stating: near-misses live in `World._boltHitTest`
 * and a trooper ducking for them would be the better simulation. What is here
 * is the signal this file can read without a second pass over every bolt in
 * the air — `installTeamDamage` already wraps `damage` on every enlisted body
 * for the friendly-fire notice, so the hit is in hand and costs nothing.
 *
 * 3.5 s, because it has to outlast the gap between two bursts of the same
 * rifle (a clone trooper's `fireRate` is under a second) or a man would stand
 * up between them, and it has to be short enough that a squad walks out of
 * cover once the shooting genuinely stops rather than hugging a crate for the
 * rest of the area.
 */
export const UNDER_FIRE = 3.5;

/**
 * NOBODY IN THIS ARMY STANDS IN THE OPEN DOING NOTHING.
 *
 * The player: "your allies shouldn't just freeze in place when they're
 * uninspired or whatever, it makes for looking bad … them frozen still looks
 * like a bug almost and it happens everywhere."
 *
 * They were right, and it was not one bug. Driven on Geonosis with a real
 * army, a real wave and a fixed seed, the share of allied body-frames spent
 * MOTIONLESS, UPRIGHT AND NOT FIRING:
 *
 *     circle 62.3%   behind 63.2%   front 17.2%   line 20.5%
 *     cover  62.6%   charge  0.2%   holdfire 54.3%
 *     morale forced to 0.15 (broken)    45.9%
 *     morale forced to 0.05 (refusing) 100.0%   ← every man, every frame
 *
 * Three code paths produced it and all three were the same omission — a
 * `return` with nothing on the other side of it:
 *
 *   `steer`'s REFUSE gate returned before it did anything at all, and
 *     `targetFor` returns null on the same test, so a man below `REFUSE` had
 *     no wish, no target and no pose. That is the 100%: not a frightened
 *     soldier, a stopped one.
 *   `steer`'s BROKEN branch walks home and then returns once it is within 5 m,
 *     so a squad that fell back arrived and became furniture.
 *   `steer` returns when a body is inside its slot tolerance with nothing to
 *     shoot, which is most of a fight in the standing formations.
 *
 * What replaces each of them is BELOW in `_goToGround` and `_holdPost`, and the
 * design rule they share is the one the player asked for: whatever a man does
 * instead has to read as FEAR or as WATCHFULNESS from thirty metres, and it must
 * not make him better at fighting. Going to ground costs the line his gun and
 * his place in the formation; it does not buy him a new attack.
 */
/** How long a body may stand on its mark with nothing to shoot before it stops
 *  standing. Under a second, because "for more than a moment" is the bar. */
export const IDLE_GRACE = 0.6;

/** How fast a man who has decided to be somewhere else moves. Above `CATCH_UP`
 *  is deliberate — this is the one pace that is not a walk home. */
export const PANIC_URGE = 1.45;

/** A cower is a rhythm, not a state: this long still, then `SCUTTLE_FOR`
 *  seconds of giving ground, over and over. A man who backs away continuously
 *  reads as a unit withdrawing; one who goes in rushes reads as frightened. */
export const SCUTTLE_EVERY = 1.4;
export const SCUTTLE_FOR = 0.55;

/**
 * HOW FAR BEHIND HIS COMMANDER A FRIGHTENED MAN IS ALLOWED TO GET.
 *
 * Without it the scuttle is unbounded: morale below `REFUSE` never recovers
 * while a body is alive and out of contact (`_morale` pays `ALONE` and nothing
 * else), so a man giving ground once a second walks off the level and the
 * player never gets the chance the whole design is built around — "get to them,
 * or lose them". Past this he turns and runs for his commander instead, which
 * is the direction the BROKEN branch has always sent people and for the reason
 * stated there: a man running to you is a man you can stand in front of.
 */
export const FEAR_LEASH = 18;

/**
 * HOW MUCH FURTHER THE SQUAD'S TARGET MAY BE THAN A MAN'S OWN, as a SQUARED
 * ratio — `targetFor` compares squared distances and a square root per trooper
 * per frame to make one comparison prettier is a square root per trooper per
 * frame.
 *
 * 2.25 is 1.5×. A line abreast is 2.4 m between men and engages from 9-19 m, so
 * one and a half times the nearest range covers every target the squad beside
 * you can see and does not cover the one that has walked into your own guard.
 * At 1.0 the rule almost never fires (the leader's pick has to be the nearest
 * anyway, which it usually already is) and past about 2× a trooper will turn
 * his back on something at four metres.
 */
export const FOCUS_SLACK = 2.25;

/** The plan half-extent of a static box — how wide a thing is to hide behind. */
function h2(b) { return Math.max(b.halfExtents.x, b.halfExtents.z); }

/** Squared plan distance between two positions. */
function dist2(a, b) { const dx = a.x - b.x, dz = a.z - b.z; return dx * dx + dz * dz; }

/**
 * The most a body may exceed its own `speed` while walking back into position.
 *
 * 1.8, because 4.1 × 1.8 = 7.4 m/s is exactly the commander's SPRINT (Player.js
 * `4.6 × 1.62`) — a trooper at full effort can just hold a sprinting Jedi and
 * cannot gain on one, which is the right answer, and a Clone Heavy Gunner at
 * 2.9 lands on 5.2 and still cannot. See `followSpeed`.
 */
export const CATCH_UP = 1.8;

/**
 * How few of the horde may be left before every order becomes "finish it".
 *
 * Four, because that is under a fifth of the smallest wave this mode composes
 * and it is the size at which a "battle line" is no longer describing anything.
 * See `_updateClosing`.
 */
export const CLOSE_OUT = 4;

/* ══════════════════════════════════════════════════════════════════════ */
/*  The campaign                                                          */
/* ══════════════════════════════════════════════════════════════════════ */

/**
 * "we start with a Geonosis map where you progress further and further on the
 * map with your troops, between rounds or areas on the map you get stronger and
 * upgrade your troops or bring in more troops."
 *
 * FIVE AREAS, and each one is a different SHAPE of fight rather than the same
 * fight with a bigger number — that distinction is the whole reason this is a
 * list of five records and not a loop with a multiplier:
 *
 *   `waves`    how many waves the area is. Short at the front, long at the back.
 *   `budget`   a multiplier on the ordinary wave budget. Areas 1-2 are UNDER 1:
 *              the escalation curve in Waves.js is tuned for a lone Jedi, and a
 *              lone Jedi with ten troopers is worth more than a lone Jedi. See
 *              `partyScale` — allies are counted there too.
 *   `heavy`    the share of the enemy budget that must go to the heavy end. This
 *              is what makes area 3 the Hailfire line and area 5 the walkers,
 *              out of the same pool.
 *   `muster`   the reinforcement points the area pays out on being cleared.
 *
 * THERE USED TO BE A SIXTH FIELD, `tier`, AND IT WAS THE NINTH INSTANCE OF THE
 * DEFECT THIS REPOSITORY KEEPS FINDING (HANDOFF §2.3).
 *
 * A rung declares the area it becomes available in — `rung('arc', 3)` is "you
 * can buy an ARC from area three" and reads as exactly that. The muster then
 * compared that number against `AREAS[i].tier`, a SECOND hand-written column
 * that ran 1, 2, 2, 4, 4. So `at: 3` was not satisfied by area 3 (tier 2); it
 * was satisfied by area 4. Every rung-4 and rung-5 body on both ladders — the
 * ARC, the Clone Commander, the BX and the MagnaGuard — arrived one whole area
 * later than the ladder said, and the two areas the campaign is longest in were
 * the two you could not spend on. Nothing on screen prints a tier, so no player
 * could have seen the off-by-one; it read as "the good units never show up".
 *
 * The fix is the one it always is: the hand-written thing stops being the
 * authority. There is no second column. `at` IS the area number, `areaNumber`
 * is what it is compared against, and the two tables cannot disagree because
 * there is only one.
 *
 * The names are the ground, and the ground is the reference images: an open
 * ochre plain with enormous sightlines, dust, vertical smoke columns, distant
 * mesas and spires. You cross it. That is the campaign.
 */
export const AREAS = [
  {
    id: 'landing', name: 'The Landing Zone',
    brief: 'The gunships put you down in the open. Form up before the first line reaches you.',
    waves: 3, budget: 0.75, heavy: 0.0, muster: 11,
  },
  {
    id: 'plain', name: 'The Open Plain',
    brief: 'Two kilometres of flat ochre and nothing to hide behind. They can see you the whole way.',
    waves: 4, budget: 0.95, heavy: 0.15, muster: 14,
  },
  {
    id: 'hailfire', name: 'The Hailfire Line',
    brief: 'Armour on the ridge. Your line will not survive standing in the open here.',
    waves: 4, budget: 1.10, heavy: 0.35, muster: 17,
  },
  {
    id: 'spires', name: 'The Spire Approach',
    brief: 'Under the spires, in the smoke. Their elite are waiting where the sightlines close.',
    waves: 5, budget: 1.25, heavy: 0.30, muster: 26,
  },
  {
    id: 'foundry', name: 'The Core Ship',
    brief: 'The last ground before the ship. Everything they have left is between you and it.',
    waves: 5, budget: 1.45, heavy: 0.45, muster: 30,
  },
];


/**
 * HOW HEAVY THE GARRISON ON A GROUND IS, SAID IN WORDS — PLAN.md §4.6.
 *
 * "A branching route over the five Command areas that already exist, with
 * partial information: you see the ground, the weather and the garrison weight,
 * not the contents." The last clause is the whole point of this function: the
 * fork has to be answerable and it must not be SOLVABLE. `budget` and `heavy`
 * printed raw would be solvable — 1.10/0.35 against 1.25/0.30 is arithmetic,
 * and a player with a wiki would take the same road every time. A band is the
 * same fact at the resolution a commander actually has before they land.
 *
 * ONE READING OUT OF BOTH DIALS, because they are one quantity seen twice:
 * `budget` is the size of the wave's threat purse and `heavy` is the share of
 * that purse spent at the heavy end, so `budget × (1 + heavy)` is "the purse,
 * weighted by how much of it arrives as weight". It introduces no constant —
 * that is the only reason it is written this way rather than as a sum with two
 * coefficients somebody would have to defend. Monotone on the shipped table:
 *
 *     landing 0.75 · plain 1.09 · hailfire 1.49 · spires 1.63 · foundry 2.10
 *
 * and the two that matter are hailfire and spires, because they are the two
 * grounds the one real fork in the mode chooses between (see `routeChoices`).
 * They are 9% apart and they land in different bands, which is the property
 * §7's guardrail asks for: an element that reads the same for both candidates
 * changes no decision and should not be on the card.
 *
 * THE BAND IS A RANK, NOT A THRESHOLD. Nothing here is compared against a
 * number: an area's position in the sorted column of every area's weight is
 * mapped onto this vocabulary. Add a sixth area, or re-tune `budget`, and the
 * words re-deal themselves — there is no second table to keep in step, which
 * is HANDOFF §2.3 and the same argument `AREAS`' own note makes about `tier`.
 */
export const GARRISON_BANDS = [
  'a screen', 'a line', 'a heavy line', 'a massed line', 'everything they have left',
];

/** `budget × (1 + heavy)`. See `GARRISON_BANDS`; not exported, because a
 *  caller that wanted the scalar would be a caller printing the numbers. */
const garrisonWeight = (a) => (a?.budget || 0) * (1 + (a?.heavy || 0));

/**
 * The band a ground falls in, out of every ground the mode has.
 *
 * Ranked by COUNTING the areas lighter than this one rather than by
 * `indexOf`, so a record that is not one of `AREAS` — a stage list a check
 * drove in, a sixth area added later — still lands somewhere honest instead of
 * falling off the end.
 */
export function garrisonBand(area) {
  const w = garrisonWeight(area);
  const all = [...new Set(AREAS.map(garrisonWeight))].sort((x, y) => x - y);
  if (all.length < 2) return GARRISON_BANDS[0];
  const rank = all.filter((v) => v < w).length;
  const i = Math.round((rank / (all.length - 1)) * (GARRISON_BANDS.length - 1));
  return GARRISON_BANDS[Math.max(0, Math.min(GARRISON_BANDS.length - 1, i))];
}


/* ══════════════════════════════════════════════════════════════════════ */
/*  Morale, and who is in charge of whom                                  */
/* ══════════════════════════════════════════════════════════════════════ */

/** How long before the same soldier will go back for somebody again, in
 *  seconds. Long, because a rifleman who spends the battle carrying people is
 *  a rifleman who is not shooting, and the point of the behaviour is that it
 *  costs the line something. */
const DRAG_AGAIN = 26;

/**
 * THE TABLE ITSELF MOVED TO A LEAF — src/game/Morale.js — and is re-exported
 * here so every existing importer is untouched.
 *
 * It had to: `Enemy.aimQuality` reads `MORALE.PRESENCE_CAP` to anchor its own
 * curve on the point a line actually rests at, and this file already imports
 * Enemy.js at its top. Enemy → Command is a cycle, and a constant read through
 * one is a constant that is `undefined` on the frame the module happens to
 * evaluate in the wrong order. Same argument, same shape and the same last
 * clause as `POWER_COST` living in Powers.js rather than in Player.js: one
 * table, one owner, and the owner is a leaf.
 */
export { MORALE };



/* ══════════════════════════════════════════════════════════════════════ */
/*  One soldier                                                           */
/* ══════════════════════════════════════════════════════════════════════ */

/**
 * A ROSTER RECORD, WHICH OUTLIVES THE BODY.
 *
 * This is the object with the name on it. It is created at the muster, it
 * survives every area, it accumulates kills and experience, and when it dies it
 * is marked dead and is NEVER created again — that is what "permanently die
 * unless they are replaced" means, and it is why the record is separate from the
 * Enemy: the Enemy is disposed at the end of every area and rebuilt at the start
 * of the next one, and if the name lived on the body the name would die with it
 * at every area boundary.
 *
 * `body` is the live Enemy or null between areas. Nothing except the director is
 * allowed to write it.
 */
export class Trooper {
  constructor(army, type, name, opts = {}) {
    this.id = opts.id ?? ('t' + (Trooper._n = (Trooper._n | 0) + 1));
    this.army = army.id;
    /** The roll this record belongs to, so a nickname can be unique across it.
     *  Optional: a Trooper built loose in a check has none and still promotes. */
    this.roster = opts.roster ?? null;
    this.type = type;
    this.designation = name;
    this.nickname = null;
    /**
     * WHICH SQUAD THIS MAN IS IN, and it is a fact about him rather than about
     * where he sits in an array. `CommandRoster.squads()` groups by this; see
     * the long note there for why the old positional slice made per-squad
     * orders impossible. Null until `assignSquads` deals it, which happens
     * lazily the first time anybody asks for the squads.
     */
    this.squad = opts.squad ?? null;
    /** …and whether he has been pulled out of it to take his own orders. */
    this.detached = false;
    /**
     * ── THE POST ────────────────────────────────────────────────────────
     *
     * HE HOLDS HIS SQUAD'S SEAT, and it is the one thing on this record the
     * player writes by hand rather than earns.
     *
     * `leaderOf` derives a squad's leader from rank and then experience, which
     * is a fine rule and is nobody's decision. The post is the player naming a
     * man: *this one has the squad*. It sits in FRONT of the derivation and
     * the derivation stays behind it as the fallback, so there is nothing to
     * clear when he dies — the moment he stops being alive the rule takes over
     * again and somebody is already leading.
     *
     * IT BUYS NO NUMBERS AND CANNOT. A post-holder is not tougher, faster or a
     * better shot; what he is, is the man whose death costs the squad its
     * standing order and prints a sentence about it. He also has to be
     * LICENSED for it — `holds(t, 'LEADS')`, the Sergeant rung — so the seat
     * is something a man becomes eligible for by surviving, and naming him is
     * a decision rather than a formality.
     *
     * Persisted, because a company that forgets who had the squad between runs
     * is a company you have to re-appoint every time you press play.
     */
    this.post = !!opts.post;
    this.xp = opts.xp ?? 0;
    this.kills = 0;
    this.wounds = 0;              // times he went down and was helped back up
                                  // — written by Enemy._getUpFromDown, worn as
                                  // scars by `scorchUp`, and persisted.
    /**
     * MORALE, 0..1, and it lives on the RECORD rather than on the body for the
     * same reason the name does: it is the thing about this soldier that
     * outlives the Enemy they are currently wearing. A squad that was broken
     * in the spires is a squad that arrives at the core ship shaken.
     *
     * 0.72 at the muster, not 1: a fresh trooper is steady, not fearless, and
     * a ladder with no room above the start has nothing for winning to buy.
     */
    this.morale = opts.morale ?? 0.72;
    /** Below `MORALE.BREAK`: this man has stopped holding the line. Written by
     *  `_morale` and `shake`, read by `steer`, `targetFor` and the HUD. */
    this.broken = false;
    /** …and his SQUAD has. Written by `_morale`, read by `steer`. See
     *  `MORALE.ROUT` for why a steady man in a broken squad goes back too. */
    this.rout = false;
    this.areas = 0;               // areas survived
    this.joined = opts.joined ?? 1;
    /**
     * WHO HE IS, as opposed to how good he is.
     *
     * `rank` is the ladder and it only ever goes up; this is the SPREAD, rolled
     * once at muster and carried for life. Two Sergeants are two different
     * soldiers now — see src/game/Attributes.js for the whole argument, and for
     * why a clone and a droid are rolled from different tables.
     *
     * Restored rather than re-rolled when `opts.attrs` is handed in, because a
     * company that comes back from a run with different men in it is not a
     * company. `Company.js` persists both fields.
     */
    this.kind = opts.kind || kindOfArmy(this.army);
    if (opts.attrs) {
      /* …AND HE MAY HAVE GROWN OUT OF SOMETHING SINCE. `shedTraits` drops a
       * trait whose condition has lapsed and hands back the points it cost —
       * a man is not green after his third area, and the Nerve it took off him
       * comes back with the trait. It is a no-op for everyone else. */
      const shed = shedTraits({ ...opts, attrs: opts.attrs, traits: opts.traits || [] });
      this.attrs = { ...shed.attrs };
      this.traits = shed.traits.slice();
    } else {
      /* HASHED FROM WHO HE IS, never drawn from a stream. See `musterRng` — a
       * stream makes the same man depend on the order he was built in, and two
       * machines building one army in different orders build two armies. */
      const rolled = rollSoldier(
        opts.rng || musterRng(this.army?.id ?? this.army, this.type, this.designation), this.kind,
        { bias: ARCHETYPE_BIAS[this.type] || null });
      this.attrs = rolled.attrs;
      this.traits = rolled.traits;
    }
    /**
     * …AND WHO HE HAS SERVED WITH. A tally per partner, off the record and not
     * re-derived: `Company.settleBonds` owns the arithmetic and this only has
     * to carry it, because `Company.manOf` reads `t.bonds` on the way back out
     * and a Trooper that dropped them would lose every bond on the roll on the
     * first run a man survived. Empty for a fresh recruit, which is right — a
     * bond is a thing you earn by coming home together.
     */
    this.bonds = Array.isArray(opts.bonds) ? opts.bonds.map((b) => ({ ...b })) : [];
    this.alive = true;
    this.diedIn = null;
    this.body = null;
  }

  get rank() { return rankFor(this.xp); }
  /** One attribute, 0..100. See Attributes.js. */
  attr(id) { return attrOf(this, id); }
  /** …and the multiplier it buys on the sim quantity it names. */
  scale(id) { return scaleOf(this, id); }
  get rankRec() { return RANKS[this.rank]; }
  get label() { return ARCHETYPES[this.type]?.label ?? this.type; }

  /** What the roster screen prints. Designation always; nickname when earned. */
  /**
   * What the roster screen prints. Designation always; the name he answers to
   * when he has one.
   *
   * THE PLAYER'S CALLSIGN OUTRANKS THE EARNED NICKNAME, and that is the point
   * of letting them type one. `_earnNickname` draws from a table and the draw
   * is the game's; a callsign is the player saying "this is the one who has
   * been covering my left since Geonosis", which is the whole of what the
   * Company tab is for. The earned nickname is not deleted by it — it is still
   * on the record and the tab still shows it — so clearing the callsign gives
   * him his old name back rather than nothing.
   */
  get name() {
    const called = this.look?.callsign || this.nickname;
    return called ? `${this.designation} "${called}"` : this.designation;
  }

  /**
   * Earn experience, and promote if it crosses a gate.
   *
   * @returns the new RANKS record if this promoted, else null. The caller wants
   *          to know, because a promotion is an announcement and a repaint.
   */
  award(n) {
    if (!this.alive || !(n > 0)) return null;
    const was = this.rank;
    this.xp += n;
    const now = this.rank;
    if (now <= was) return null;
    // A nickname is earned on the SECOND rung and never lost, on BOTH sides.
    // See NICKNAMES.
    if (!this.nickname && now >= 2) this.nickname = this._earnNickname();
    return RANKS[now];
  }

  /**
   * A name nobody on this roll already answers to.
   *
   * UNIQUE, for the same reason `designate` loops: the promise is "every ally
   * has a unique name you can SEE", and the whole point of a nickname is that
   * the two or three of them in a casualty list are the bodies you have been
   * protecting. Two Ladders in one list is one fewer body you can tell apart —
   * and at the rate this ladder promotes, a 33-entry table drawn blind collides
   * about a third of the time over a full campaign's promotions.
   *
   * Falls back to the blind draw when the table is exhausted or there is no
   * roster to ask, because a duplicate name is worth more than no name.
   */
  _earnNickname() {
    const pool = nicknamesFor(this.army);
    const taken = new Set((this.roster?.all || []).map((t) => t.nickname).filter(Boolean));
    const free = pool.filter((s) => !taken.has(s));
    const from = free.length ? free : pool;
    return from[Math.floor(rng() * from.length)];
  }
}

/* ══════════════════════════════════════════════════════════════════════ */
/*  The roster                                                            */
/* ══════════════════════════════════════════════════════════════════════ */

/**
 * EVERY NAME IN THE CAMPAIGN, LIVING AND DEAD.
 *
 * The dead are kept. That is not sentiment, it is the feature: the roster screen
 * is a casualty list, and a list you can only read the survivors off does not
 * make you careful. `fallen` is what the muster screen shows above the
 * reinforcements you are about to buy.
 */
export class CommandRoster {
  constructor(army) {
    this.army = army;
    this.all = [];
    this.taken = new Set();
    /** Reinforcement points. Spent at the muster; earned by clearing an area. */
    this.points = 0;
  }

  get living() { return this.all.filter((t) => t.alive); }
  get fallen() { return this.all.filter((t) => !t.alive); }
  get strength() { return this.living.length; }

  /** Enlist one body of `type`, with a designation nobody else has. */
  enlist(type, opts = {}) {
    const name = designate(this.army, this.taken);
    this.taken.add(name);
    const t = new Trooper(this.army, type, name, { ...opts, roster: this });
    this.all.push(t);
    return t;
  }

  /**
   * ENLIST A MAN WHO HAS SERVED BEFORE — the one door a saved roll comes back
   * through, and the reason it is here rather than in Company.js.
   *
   * `Trooper` has four getters every screen and half the fight read (`rank`,
   * `rankRec`, `label`, `name`), so a stored record cannot simply be pushed
   * onto `all`: a plain object with the right fields answers `undefined` to all
   * four. It has to go through the constructor, and the constructor lives in
   * this file — which Company.js imports and which must not import Company.js
   * back. So the field copy is written ONCE, here, and Company.js re-exports
   * it. A second copy over there is the twin this codebase has removed eight
   * of.
   *
   * THE DESIGNATION IS CLAIMED, which is what makes a mixed roll safe: a
   * company of six veterans and four fresh bodies draws the four through
   * `designate` against a `taken` set that already holds the six, so nothing
   * new can collide with a name the player has been reading for nine runs.
   * A record whose designation is already on this roll is refused rather than
   * renamed — two men with one name is worse than one man missing, and the
   * caller is a muster that can simply enlist somebody else.
   *
   * WHAT IS DELIBERATELY NOT CARRIED: `broken`, `rout` and `detached`. All
   * three are about a fight that is over. A man who walked up the ramp shaken
   * walks off the next one steady, and that is the one place the persistence
   * layer is allowed to be kind — stated here rather than left as an omission
   * somebody later reads as an oversight.
   */
  enlistRecord(m) {
    if (!m || typeof m.type !== 'string' || typeof m.designation !== 'string') return null;
    if (this.taken.has(m.designation)) return null;
    this.taken.add(m.designation);
    const army = ARMIES[m.army] || ARMIES[this.army?.id] || this.army;
    /**
     * ── AND THE MAN HIMSELF, WHICH THIS DOOR WAS THROWING AWAY ───────────
     *
     * `attrs`, `traits`, `kind` and `bonds` were not on this list, and this
     * method's own header calls itself "the one door a saved roll comes back
     * through". So every veteran was re-rolled at muster: `opts.attrs` arrived
     * undefined, the `Trooper` constructor took its `else` branch, and the
     * profile on the record — the ten attributes, the traits he was dealt, the
     * traits he had EARNED — was discarded and replaced by a fresh
     * `musterRng(army, type, designation)` draw.
     *
     * It hid for a long time because that draw is a hash of who he is, so the
     * re-roll reproduces the same BASE man and nothing looked wrong. What it
     * cannot reproduce is anything that happened to him since:
     *
     *   MEASURED, two men with five shared grounds, through the real
     *   `keep()` → `load()` → `trooperOf()`:
     *     stored   traits ['devoted','bonded']  bond 65  nerve 48  resolve 35
     *     fielded  traits ['devoted']           bond 49  nerve 62  resolve 43
     *
     * So a bond was a card decoration, `shedTraits` was dead on the only path a
     * saved man actually takes — "Green wears off" was a promise nothing kept —
     * and the whole persisted profile was ornamental. The constructor's restore
     * branch was correct and unreachable.
     *
     * Sanitised on the way in by `Company.readMan` already; passed through here
     * rather than re-validated, for the reason that file gives at length.
     */
    const t = new Trooper(army && army.id ? army : { id: m.army }, m.type, m.designation, {
      id: m.id ?? undefined, roster: this, squad: Number.isInteger(m.squad) ? m.squad : null,
      xp: Math.max(0, m.xp | 0),
      morale: Math.min(1, Math.max(0, Number.isFinite(m.morale) ? m.morale : 0.72)),
      joined: Math.max(1, m.joined | 0),
      kind: m.kind, attrs: m.attrs || null, traits: m.traits,
      /* `shedTraits` reads these off the man to decide what he has grown out
       * of, so they have to be in the bag the constructor sees rather than
       * assigned afterwards. */
      areas: Math.max(0, m.areas | 0), runs: Math.max(0, m.runs | 0),
      bonds: m.bonds,
    });
    t.nickname = typeof m.nickname === 'string' ? m.nickname : null;
    t.kills = Math.max(0, m.kills | 0);
    t.wounds = Math.max(0, m.wounds | 0);
    t.areas = Math.max(0, m.areas | 0);
    /* The three fields that only exist for a man who has been kept. They are
     * read by the Company tab and by nothing that fights. */
    t.runs = Math.max(0, m.runs | 0);
    t.since = typeof m.since === 'string' ? m.since : null;
    t.story = Array.isArray(m.story) ? m.story.slice() : [];
    t.look = m.look && typeof m.look === 'object' ? { ...m.look } : null;
    this.all.push(t);
    /**
     * THE SEAT, AND IT GOES ON THROUGH THE ONE DOOR THAT WRITES ONE.
     *
     * `appoint` is where the rule lives — licensed, alive, one seat per squad
     * — and this used to set `t.post` by hand with only the licence half of
     * it. That left the exclusivity clause with no caller on the fighting side
     * at all: a store holding two seated men in one squad put both of them on
     * the roll, and `leadOf` then answered with whichever came first in an
     * array whose order is nobody's decision.
     *
     * A stored post is a stored post for ever and a rank is not — nothing
     * demotes today, but the store is a JSON blob in the player's own browser
     * — so the licence is re-tested here rather than trusted, which `appoint`
     * does as its first act. Pushed before the call because `appoint` refuses
     * a man who is not on the roll, which is the guard that makes it safe
     * everywhere else.
     */
    if (m.post) this.appoint(t, true);
    return t;
  }

  /**
   * ══ THE LINE CROSSES THE GROUND WITH YOU — the men themselves, not copies ══
   *
   * The player: "we get in the extraction ship and go to the next map, at some
   * point the troops that got on were cleared off the ship and a new set of
   * troops came in… the promoted guy wasn't in the game anymore but he still
   * was on the troop list."
   *
   * Both halves of that are one cause. `World.loadLevel` builds a NEW
   * `CommandDirector` — a ground change goes through it — and the constructor
   * ends on `_musterOpening()`, so the incoming ground raises a fresh roll
   * while the outgoing one, ranks and casualty list and all, is dropped with
   * the director that owned it. `_beforeRotate` recalls the army first, which
   * is what keeps twelve withdrawals from being twelve deaths, and that recall
   * was preserving records for a roster nobody carried across.
   *
   * SO THE `Trooper` OBJECTS THEMSELVES MOVE, and that is the whole method.
   * There is a record round-trip in this file already — `enlistRecord`, the
   * door a SAVED man comes back through — and using it here would be the wrong
   * tool twice over: it is a field list, so anything added to a man tomorrow
   * and not added to that list is silently dropped on every ground change; and
   * a man crossing a ground inside one run has not been serialised, so there
   * is nothing to reconstruct. A `Trooper` holds no reference to the world or
   * to the level — `body` is the only live edge and `recall` has already cut
   * it — so he can simply be handed to the next roll intact.
   *
   * THE THREE FIELDS THAT DO NOT CROSS are the three `enlistRecord` refuses
   * for the same reason, and the sentence there is the rule here: `broken`,
   * `rout` and `detached` are about a fight that is over. A man who walked up
   * the ramp shaken walks off the next one steady.
   *
   * @returns how many were taken on.
   */
  adopt(men) {
    if (!Array.isArray(men)) return 0;
    let n = 0;
    for (const t of men) {
      if (!t || typeof t.designation !== 'string') continue;
      /* One name, one man — the same refusal `enlistRecord` makes, and here it
       * is what stops a double rotation putting a man on his own roll twice. */
      if (this.taken.has(t.designation)) continue;
      this.taken.add(t.designation);
      t.roster = this;
      t.body = null;
      t.broken = false; t.rout = false; t.detached = false;
      this.all.push(t);
      n++;
    }
    return n;
  }

  /**
   * The squads, as arrays of living troopers.
   *
   * Derived from the living list every time rather than stored, and that is the
   * whole reason squads survive permadeath gracefully: a squad is a SLICE, so
   * losing four of five men does not leave a squad object with one ghost in it —
   * the next call simply produces fewer, fuller squads. `SQUAD` is the only
   * number involved.
   */
  /**
   * ── GIVE ONE MAN HIS SQUAD'S SEAT, OR TAKE IT BACK ──────────────────────
   *
   * The only writer of `Trooper.post`, and it is on the ROSTER rather than on
   * the man because the rule that matters is a rule about the squad: one seat,
   * one holder. A setter on the Trooper would be a setter with no way to see
   * the other nine men, and the second post in a squad would be silent — two
   * men "leading", `leaderOf` returning whichever came first in an array whose
   * order is nobody's decision.
   *
   * REFUSES RATHER THAN ASSUMES, and says which of the three reasons it was,
   * because this is a control on a screen and a control that goes dead with no
   * sentence is the thing this whole tab was rebuilt to stop being.
   *
   * @returns { ok, reason, was } — `was` is the man who held it before, so the
   *          caller can say "you took it off him" without asking twice.
   */
  appoint(t, on = true) {
    if (!t || !this.all.includes(t)) return { ok: false, reason: 'not on this roll', was: null };
    if (!on) { const was = t.post; t.post = false; return { ok: true, reason: null, was: was ? t : null }; }
    if (!t.alive) return { ok: false, reason: 'he is dead', was: null };
    if (!holds(t, 'LEADS')) {
      return { ok: false, was: null,
        reason: `a ${t.rankRec.title.toLowerCase()} does not hold a squad's post — `
          + `${RANKS[DUTIES.indexOf('LEADS')].title} is the rung that does` };
    }
    /* ONE SEAT PER SQUAD. A man with no squad dealt to him yet is his own
     * case and takes the seat unopposed; everyone else displaces whoever was
     * sitting in it, which is the whole of what the player meant by clicking. */
    let was = null;
    for (const other of this.all) {
      if (other === t || !other.post) continue;
      /**
       * TWO UNDEALT MEN DO CONTEND, and a guard that said otherwise put the
       * defect back.
       *
       * `null === null` is true, and for one turn that read like a bug: two
       * men with no squad are "in no squad", so why should one displace the
       * other? Because `squadPlan` deals every undealt man into the FIRST
       * bucket that is under strength — measured, two posted men at `squad:
       * null` came out of `assignSquads` both in squad 0, both still holding
       * the seat, which is exactly the two-holders state this method exists to
       * prevent. And it is reachable without touching the store: the man
       * page's squad picker offers a dashed "—" chip that writes null.
       *
       * So a null squad is not "no squad", it is "wherever the muster deals
       * him" — and two men bound for the same deal are two men in the same
       * squad as far as a seat is concerned. The conservative answer is the
       * correct one.
       */
      if (other.squad === t.squad) { other.post = false; was = other; }
    }
    t.post = true;
    return { ok: true, reason: null, was };
  }

  squads(size = SQUAD) {
    /**
     * ── GROUPED BY A STABLE ASSIGNMENT, NOT SLICED BY POSITION ────────────
     *
     * This used to be `live.slice(i, i + size)` — squads derived from wherever
     * a man happened to sit in the living list. That survives permadeath very
     * gracefully and makes per-squad ORDERS impossible, because "2nd Squad" was
     * not a thing that existed between one frame and the next: one casualty
     * anywhere in the roster re-dealt every man into a different squad. Asked
     * for: "are we able to separately order squads? Sometimes it'll say 2
     * squads but they get ordered as one… I should be able to order separate
     * squads or all squads at once depending on my choosing."
     *
     * So the assignment is a FIELD, handed out at enlistment and never moved,
     * and this groups the LIVING by it. The graceful half is kept exactly:
     * nothing is stored per squad, so losing four of five men leaves no squad
     * object with a ghost in it — it leaves a squad of one, which is what a
     * squad of one actually is and what the roll should say.
     *
     * `size` still means what it meant. It is the size `assignSquads` deals to,
     * and it is passed through so a caller asking for a different grouping gets
     * one rather than being quietly ignored.
     */
    const live = this.living;
    for (const t of live) if (t.squad == null) this.assignSquads(size);
    /**
     * ── AND THE INDEX IS THE SQUAD NUMBER, NOT A POSITION IN A LIST ───────
     *
     * This returned a COMPACTED array — the groups that had men in them, in
     * order — so `squads()[0]` was "the lowest-numbered squad still standing"
     * rather than "1st Squad". Wipe out 1st Squad and the survivors of 2nd
     * became index 0, and every index-keyed thing followed them onto a
     * different body of men: `squadPlanted` and `squadOrders` keys, the ground
     * they had been given, `selectedSquad`, and the NAME the player gave them.
     * 2nd Squad became 1st Squad mid-fight, holding ground it was never sent
     * to, called something it was never called.
     *
     * That is squad identity leaking, and it is the whole of what "I should be
     * able to name my squads" is asking for. So the array is indexed BY THE
     * NUMBER: `squads()[1]` is 1st-index squad whether or not squad 0 has
     * anybody left in it, and a wiped squad is an empty array rather than a
     * hole in the numbering. Every caller that walks the list already skips a
     * squad with nobody in it — `leaderOf` answers null, `_digTick` finds no
     * crew, `slotFor` is never asked — so an empty entry costs a loop
     * iteration and nothing else.
     *
     * The detached keep their own groups, appended past the numbered ones so
     * their indices can never collide with a squad number.
     */
    const by = new Map();
    let top = -1;
    const solo = [];
    for (const t of live) {
      // A man pulled out of the line answers only to himself — see `detach`.
      if (t.detached) { solo.push([t]); continue; }
      const k = t.squad | 0;
      if (!by.has(k)) by.set(k, []);
      by.get(k).push(t);
      if (k > top) top = k;
    }
    const out = [];
    for (let k = 0; k <= top; k++) out.push(by.get(k) || []);
    /**
     * …AND A DETACHED MAN'S INDEX IS PAST EVERY SQUAD NUMBER THERE CAN BE.
     *
     * Appending them after the last LIVE squad put the identity leak straight
     * back for the men it is easiest to lose track of: wipe the top squad and
     * every detached man shifts down one index, taking `squadOrders`,
     * `squadPlanted`, `selectedSquad` — and the NAME — with him. Measured, the
     * game announced "REAPER HAS THE GROUND — trooper CT-7200, 1 man": a lone
     * detached trooper wearing the name the player typed for 3rd Squad.
     *
     * `SQUAD_SLOTS` is the ceiling a line can actually form, so a solo index
     * can never collide with a squad number and never moves because somebody
     * else died. `squadLabel` reads the same ceiling and calls them what they
     * are.
     */
    while (out.length < SQUAD_SLOTS) out.push([]);
    for (const one of solo) out.push(one);
    return out;
  }

  /**
   * Deal every unassigned living man a squad number, filling existing squads
   * that are under strength before opening a new one.
   *
   * Called lazily from `squads()` and directly by the muster, so a
   * reinforcement joins the thinnest squad rather than always starting a new
   * one — which is what keeps a roster of 24 from ending up as eight squads of
   * three after a bad area.
   */
  assignSquads(size = SQUAD) {
    const dealt = squadPlan(this.all.filter((t) => t.alive), size);
    for (const [t, n] of dealt) t.squad = n;
    return this;
  }

  /**
   * Pull one man out of his squad, or put him back.
   *
   * "You should be able to take an npc out of their squad and individually
   * assign them things — maybe you single out one dude to follow you — but you
   * should be able to reverse it and put them back in with their squads."
   *
   * `detached` rather than clearing `squad`, so putting him back is one flag
   * and he returns to the squad he came from rather than to whichever one has
   * room at the time. A detached man is his own group in `squads()`, which is
   * what makes him separately orderable without any new machinery.
   */
  detach(t, on = true) {
    if (!t || !t.alive) return false;
    if (!!t.detached === !!on) return false;
    t.detached = !!on;
    return true;
  }

  /** Kill a record. Idempotent, because a body can be reported dead twice. */
  fall(t, area) {
    if (!t || !t.alive) return false;
    t.alive = false;
    t.diedIn = area;
    t.body = null;
    return true;
  }

  /** A compact record for the HUD, the summary and the checks. */
  summary() {
    return {
      army: this.army.id,
      strength: this.strength,
      fallen: this.fallen.length,
      points: this.points,
      roll: this.all.map((t) => ({
        id: t.id, name: t.name, unit: t.label, rank: t.rankRec.short,
        rankTitle: t.rankRec.title, xp: t.xp, kills: t.kills, areas: t.areas,
        alive: t.alive, diedIn: t.diedIn,
        /**
         * …AND WHICH SQUAD HE IS IN, which was the one fact this record did
         * not carry and the reason nothing on the HUD could group by squad.
         *
         * "I should be able to separately view my squads in an actual game."
         * The roster panel, the nameplates and the minimap all read this
         * summary, and not one of them could have told you who was in 2nd
         * Squad because the answer was not in it. `detached` with it, because
         * a man pulled out of the line is not in any squad and a column that
         * filed him under one would be lying about the one thing detaching
         * is for.
         */
        squad: Number.isInteger(t.squad) ? t.squad : null,
        detached: !!t.detached,
        post: !!t.post,
      })),
    };
  }
}

/**
 * WHAT TO CALL WHOEVER DID IT, for the after-action report.
 *
 * A name where the thing has one — a named man on the other roll, an archetype
 * otherwise — and null where there is nothing to name. Not a reference: see the
 * note at the `fell` record for why the log must not hold a body.
 */
export function killerName(source) {
  if (!source) return null;
  if (typeof source === 'string') return source;
  if (source.trooper?.name) return source.trooper.name;
  if (source.isPlayer || source.aimDir) return 'you';
  /**
   * AND THE NAME IS THE ONE THE GAME SAYS OUT LOUD, not the key it files it
   * under. This read `source.A?.name`, and an archetype has no `name` — the
   * field is `label`, which is what the sandbox picker, the databank and the
   * HUD all print — so the expression was ALWAYS undefined and every death in
   * every report in the game has been attributed to `b2` and `droideka`
   * instead of to a Super Battle Droid and a Droideka. A report written in the
   * spawn table's internal keys is a report that reads as debug output, which
   * is a different way of being the mystery §4.9 exists to remove.
   *
   * `type` survives as the fallback for a body with no archetype record (the
   * flight modes build their own), and it is the only thing that can be said
   * about one.
   */
  return source.A?.label || ARCHETYPES[source.type]?.label || source.type || null;
}

/* ══════════════════════════════════════════════════════════════════════ */
/*  Digging in — PLAN.md §4.7                                             */
/* ══════════════════════════════════════════════════════════════════════ */

/**
 * HOW LONG A SQUAD TAKES TO MAKE A POSITION, in seconds of at least
 * `DIG_CREW` men standing on the ground they were given.
 *
 * Twenty-two, which is one wave's worth of shooting given up. It has to be
 * long enough that digging is a decision about the next two minutes rather
 * than a thing you do on the way past, and short enough that a player who
 * chooses it gets to see it finish inside the engagement he chose it in. It is
 * the same order as the blast door's measured 18.8 s breach and the objective
 * take timer's 12 s, deliberately: this game's "hold a thing while the fight
 * goes on around you" beats are all one length.
 */
export const DIG_SECONDS = 22;

/** How many living men it takes to be digging at all. Two is a working party. */
export const DIG_CREW = 2;

/**
 * THE POSITION, in metres — and every one of these is a measurement rather
 * than a taste.
 *
 * The heightfield's cell is 3.39 m at the shipped LOW tier and 2.48 m at high,
 * and `Terrain.crater` widens anything under 1.35 cells to what the grid can
 * represent — so a foxhole is not a thing this engine can hold, and a SQUAD
 * POSITION is. At 8 m the scrape is two and a half cells across at the coarsest
 * tier, which is the smallest earthwork the ground can actually carry.
 *
 * The depth and the rim were swept against the twelve-ray test in the `digin`
 * row's own note: at 0.7/1.6 the position blocked 10 of 12, at 0.9/1.6 it
 * blocks 12 of 12, and it is the second one because a position that is cover
 * from three bearings of four is a position a player cannot trust. Measured
 * profile at low quality: a floor 0.83 m below the ground it was cut into and a
 * berm 0.76 m above it, at 0.9 of the radius.
 */
export const DIG_R = 8, DIG_DEPTH = 0.9, DIG_RIM = 1.6;

/** How far from the middle a man counts as working on it. */
export const DIG_WORK_R = DIG_R + 2;

/**
 * HOW CLOSE A LIVING MAN HAS TO BE TO COUNT AS STANDING OVER A CASUALTY, in
 * metres — PLAN.md §4.6's Triage.
 *
 * Three, which is inside a body's own footprint plus a step: it has to mean
 * "he is with him", not "he is in the same field". `MORALE.NEAR` is 14 and
 * would have made every casualty inside a formed-up squad count, which is the
 * card paying for nothing.
 */
export const TRIAGE_REACH = 3;

/** How many bodies are one squad. Five is a fireteam and it fits one screen. */
export const SQUAD = 5;

/** The most bodies the mode will ever field for you at once. See `_muster`. */
/**
 * WHAT SURVIVING SOMETHING IS WORTH, IN EXPERIENCE — and both numbers were
 * typed at the one site that awards them.
 *
 * A man who was on the field when a wave cleared earns one; a man who was there
 * when a whole area was held earns two. They are named here because a THIRD
 * thing now pays experience — §4.4's commendation, bought out of the muster
 * purse — and its price is derived from this rate rather than chosen. A number
 * that decides both what fighting is worth and what buying it costs cannot be
 * typed twice: the day one moves without the other, a commendation is either
 * free or unaffordable and nothing says which.
 */
export const XP_PER_WAVE = 1;
export const XP_PER_AREA = 2;

export const MAX_STRENGTH = 24;
/**
 * HOW MANY NUMBERED SQUADS A LINE CAN FORM — the biggest line the game fields,
 * in squads. `Company.SQUADS_MAX` is the same arithmetic on the same two
 * numbers and is what the tab's squad pickers offer; this is the one the FIGHT
 * uses, and it is what keeps a detached man's index from ever being a squad's.
 */
export const SQUAD_SLOTS = Math.ceil(MAX_STRENGTH / SQUAD);
/** What you march in with. Two squads. */
export const OPENING_STRENGTH = 10;

/* ══════════════════════════════════════════════════════════════════════ */
/*  Team damage                                                           */
/* ══════════════════════════════════════════════════════════════════════ */

/**
 * NOTE #29: "your allies should be as real as the enemies like no difference —
 * you can do damage to them and throw them and manipulate them so you need to be
 * careful not to hurt them, maybe there's a setting for how much team damage you
 * do."
 *
 * THE PHYSICS IS NEVER SCALED. A push throws your own sergeant exactly as far as
 * it throws a B1, a grip lifts him, a compel turns him, and the blade goes
 * through him. Scaling any of that would make an ally a different KIND of object
 * and the note is explicitly about them not being one.
 *
 * What the setting scales is DAMAGE, and only damage the player themselves
 * caused. 0 is a mode where you can still ragdoll your whole line into the air
 * and lose nobody; 1 is a mode where a careless sweep costs you a name off the
 * roster. The default is 0.35 — enough that hitting your own line is a real
 * mistake with a real price, low enough that it is not a mode you can lose to by
 * accident in the first ten seconds.
 *
 * Shaped exactly like `sandboxConfig` and `pvpRules`: a menu writes free-form
 * numbers and exactly one function decides what they mean.
 */
export const TEAM_DAMAGE_DEFAULT = 0.35;

/**
 * IS THERE A SECOND COMMANDER TO FIGHT, OR COULD THERE BE ONE?
 *
 * A meeting needs somebody on the other side of it. Two things count and
 * nothing else does: a live net endpoint — a host waiting on a peer is still a
 * session, because the second commander is on the way — or a second player
 * already on the field.
 *
 * Asked of the WORLD and not of the settings, because "am I in a session" is
 * not a thing a menu can know at the moment the box is ticked; it is a fact
 * about the run, and it exists only once the run does. A world that has not
 * been handed in answers FALSE, and that default is deliberate: an empty field
 * is the failure this gate exists to prevent, so a path that forgot to pass a
 * world must fall back to a real battle rather than to a meeting with nobody.
 *
 * ── AND IT MAY NOT BE ASKED FROM `commandConfig`, WHICH IS WHERE IT LOOKS ──
 * ── LIKE IT BELONGS. ──────────────────────────────────────────────────────
 *
 * That function runs inside `CommandDirector`'s constructor, which
 * `World._loadSteps` runs DURING THE LOAD, and `main.js` calls `attachNet` and
 * `spawnPlayer` only after `loadLevelAsync` has returned. So at that moment
 * `world.net` is null, `world.netMode` is undefined and `world.players` is
 * EMPTY — on a host in a real session exactly as on a solo player. Measured by
 * gating the flag there: 8 of the 20 command-pvp checks went red, including
 * "two commanders meet on Geonosis" with `beginVersus produced 0 commanders`.
 * A gate there can only ever answer "alone", so it does not answer the question
 * at all — it turns the feature off.
 *
 * It is asked instead from `CommandDirector.meetingOpposed`, at the two moments
 * that can answer: `formUp` and `start`, both reached through
 * `World.beginVersus`, which `main.js` calls once the net is attached and the
 * player is standing.
 */
export function meetable(world) {
  if (!world) return false;
  if (world.net?.connected) return true;
  if (world.netMode === 'host' || world.netMode === 'client') return true;
  return (world.players?.length ?? 0) > 1;
}

export function commandConfig(settings) {
  const s = settings || {};
  const td = s.teamDamage;
  const f = s.commandFormation;
  return {
    teamDamage: clamp(Number.isFinite(td) ? td : TEAM_DAMAGE_DEFAULT, 0, 1),
    formation: FORMATIONS[f] ? f : DEFAULT_FORMATION,
    /**
     * TWO COMMANDERS, TWO ARMIES, ONE FIELD — and it is a setting on Command
     * rather than a mode of its own.
     *
     * `MODES` lives in Waves.js and a second Command entry there would be a
     * second copy of `level: 'geonosis'`, `fixedTheatre` and the mode card, all
     * to describe the same campaign with a different opponent in it. What
     * actually differs is one question — is the other army a person's or the
     * composer's — so it is one flag, read here, where `teamDamage` and the
     * opening formation are already read. The same shape `sandboxConfig` and
     * `pvpRules` have: a menu writes a free-form value and exactly one function
     * decides what it means.
     *
     * AND THE MODE HAS TO BE ABLE TO HOLD ONE. The box is a global setting and
     * this function runs for every mode that leads an army — `World.loadLevel`
     * builds a CommandDirector for `command`, `skirmish` and `campaign` — so a
     * player who ticked it here and then started a Skirmish got a battle with
     * no opposing army at all: the opening spawn queue on geonosis goes 8
     * bodies to 0 in all three, because `start` declines to compose a wave when
     * the other side is supposed to be a person's. `MODES.command.meeting` is
     * where that fact lives; the mode table is asked rather than a list of mode
     * names being kept here, so the next mode that leads an army declines the
     * meeting by saying nothing.
     */
    /**
     * ── AND THERE HAS TO BE SOMEBODY TO MEET, WHICH IS ASKED ELSEWHERE ──
     *
     * `commandVersus` is a PERSISTED GLOBAL — a box in Options that stays
     * ticked between sessions — so a player who tried a meeting once and moved
     * on carried it into every solo Command run afterwards, and `start`
     * declines to compose a wave when the other side is supposed to be a
     * person's. `formUp` then builds `Math.max(commanders, sides, players)` = 1
     * commander, so no opposing army is ever deployed either.
     *
     * The result is the player's report, verbatim and across several sessions:
     * *"in the mode I was playing it said 0 hostiles the entire time"*, and,
     * when asked, *"it was in command mode not versus"*. They were right about
     * the mode. The versus flag was on underneath and said nothing.
     *
     * It survived one investigation that could not reproduce it, because the
     * harness booted with a clean settings object and the box was never ticked.
     * A sticky global is exactly the class of bug a fresh fixture cannot find.
     *
     * WHAT THIS LINE STAYS IS THE PLAYER'S ANSWER AND THE MODE'S. Whether there
     * is anybody to meet is not knowable here — see the second half of
     * `meetable`'s note, and the 8 red command-pvp checks measured when it was
     * asked here — so it is asked by `meetingOpposed` at the moment the field
     * opens, and `standDownMeeting` clears this flag when the answer is no.
     */
    /* `alwaysVersus` IS NOT THE SAME STATEMENT AS `meeting`, and the meeting
     * mode needs both. `meeting` says a mode MAY hold one — Command says it
     * too, because Command is playable either way and the tick box is what
     * chooses. `alwaysVersus` says the mode IS one, so `MODES.versus` cannot be
     * deployed with the switch off: a card named Commander Battle that fights
     * a composed wave because a checkbox on another panel was never ticked is
     * the defect this mode exists to end. */
    versus: !!MODES[s.mode]?.alwaysVersus
      || (!!s.commandVersus && !!MODES[s.mode]?.meeting),
    /**
     * AN ARMY IN A MODE THAT NEVER HAD ONE.
     *
     * The player: "I should be able to choose to spawn in allied troops on any
     * map in any mode if I so wish." Allies were a property of the MODE —
     * `World.loadLevel` built a `CommandDirector` for `command`, `skirmish` and
     * `campaign` and a bare `WaveDirector` for everything else — so the answer
     * to "can I have troops here" was decided by a menu column the player had
     * already left.
     *
     * It is a NUMBER and not a tick, because the size is the whole decision:
     * two men beside you is an escort, twenty-four is the mode. And it is read
     * HERE, where `teamDamage`, the opening formation and the meeting flag are
     * already read, for the reason stated over `versus` — a menu writes a
     * free-form value and exactly one function decides what it means.
     *
     * ZERO IS OFF and is the default, so every mode is exactly what it was
     * until the player asks for something else. `MODES.command`, `skirmish` and
     * `campaign` lead an army whatever this says: their army is the mode.
     */
    contingent: clamp(Math.round(Number(s.allies) || 0), 0, MAX_STRENGTH),
    /**
     * WHAT THE CONTINGENT IS MADE OF, as an index into the army's own ladder.
     *
     * The audit's first gap, verbatim: "the player cannot compose the
     * contingent. It is `opening` bodies of the cheapest rung and nothing
     * else." Measured on `waves`/`scoria` with eight allies asked, before this:
     * `{"trooper":8}` — eight of one type, every run, on every ground, in every
     * mode, and `musterOffer()` came back offering `trooper@5 heavy@6` with a
     * purse of 0 while `recruit('arc')` answered "ARC Trooper is not available
     * until area 3 of the advance" on a world that has no areas at all.
     *
     * AN INDEX AND NOT A TYPE NAME, because the ladder the index lands in is
     * not known when the choice is made: `trooper` is meaningless to a Sith and
     * `b1` to a Jedi, and a setting that stores one of them would be wrong for
     * half the players the moment they changed order. Index 2 is "the third
     * rung of whichever ladder I end up leading" — a marksman either way — and
     * `LADDER_RUNGS` is the ceiling that keeps it valid in both.
     *
     * `CONTINGENT_MIXED` (−1) is a real answer and not an absence: it spends
     * the purse the way `autoMuster` does, line first and then the heaviest
     * thing left affordable. The DEFAULT is 0, the cheapest rung, because 0 is
     * exactly what shipped — a player who never finds this control gets the
     * platoon they already had, body for body.
     */
    unit: clamp(Math.round(Number(s.allyUnit) || 0), CONTINGENT_MIXED, LADDER_RUNGS - 1),
    /**
     * WHOSE MEN, and `null` means "the one my order leads" — see `armyToLead`
     * for the three-clause rule and for why a campaign is never allowed to ask
     * this question. Stored as an index into `ARMY_IDS` for the reason `unit`
     * above is an index: the alternative is a second copy of the two army ids
     * living in a save file, and `factions.mjs` already asserts that those two
     * words are the same word in all three places they appear.
     */
    allyArmy: ARMY_IDS[Math.round(Number(s.allyArmy))] ?? null,
  };
}

/* ═══════════════════════════════════════════════════════════════════════ */
/*  The commander battle — MODES.versus                                    */
/* ═══════════════════════════════════════════════════════════════════════ */

/** How a meeting can be decided. See `versusCommandConfig`. */
export const VERSUS_WINS = {
  /**
   * FIGHT TO THE DEATH — the player's own words, and the default. A side is
   * out when nothing of it is standing: not its commanders, not its men. No
   * clock, so a battle cannot be won by running away and waiting.
   */
  annihilation: {
    label: 'To the last man',
    blurb: 'A side is beaten when nothing of it is left standing — the commanders and every man.',
    counts: 'standing', clock: false,
  },
  /**
   * KILL THE GENERAL. The armies still fight and still matter — they are what
   * stands between you and the other commander — but the battle is decided by
   * the two of you. Much shorter, and it makes the line a shield rather than
   * the objective.
   */
  commanders: {
    label: 'Cut down the commanders',
    blurb: 'The army is the wall. A side falls when its commanders are down, whatever is still standing.',
    counts: 'generals', clock: false,
  },
  /**
   * ON THE CLOCK, decided on remaining health if nobody has been wiped out —
   * which is what a meeting already did, because `pvpRules` gives it
   * `roundTime`. Kept as a named choice rather than left as the silent default
   * it used to be: a battle that ends in a draw on a timer nobody was told
   * about is the version of this mode the player was handed first.
   */
  rounds: {
    label: 'On the clock',
    blurb: 'Best of three, each round on a timer, decided on health if nobody has been wiped out.',
    counts: 'standing', clock: true,
  },
};
/** Bodies a side may bring, and how often reinforcements may come. */
export const VERSUS_LIMITS = {
  strength: { min: SQUAD, max: MAX_STRENGTH, def: 20 },
  /** Seconds between reinforcement waves. 0 is off — a standing battle. */
  reinforce: { min: 0, max: 180, def: 0 },
};

/**
 * READ THE MEETING'S PICKS OFF A SETTINGS BLOB — one reader, the same shape
 * `commandConfig`, `sandboxConfig` and `pvpRules` have.
 *
 * ── WHY STRENGTH IS PER SIDE AND NOT PER COMMANDER ──────────────────────
 *
 * A meeting shares one roster per SIDE (see `_rosterFor`), opens it at
 * `OPENING_STRENGTH` and adds a squad for every commander past the first —
 * §9's rule, and the right one for co-op Command, where every player is on the
 * same side and a bigger table should field a bigger company.
 *
 * It is the wrong rule for a battle BETWEEN sides, and three players is where
 * that stops being theoretical. Driven on the shipped build with three
 * commanders: sides 0/2/0, and the rosters came out **15 against 10** — the
 * pair outnumbering the lone commander by half again, on top of being two
 * people. Four players is 2v2 and even by luck; three is not, and the mode is
 * for however many friends are in the room.
 *
 * So a side brings `strength` men whoever leads them. Two allies split one army
 * of twenty rather than bringing ten each, which is also the sentence the mode
 * is about: two armies meet, and how many commanders one of them happens to
 * have is a question about command, not about how many rifles are on the field.
 *
 * ── AND THE SIDES ARE THE HOST'S ────────────────────────────────────────
 *
 * `teams` is peer id → side, written by the host in the lobby. Empty is the
 * default and the default is `assignSides`' alternation, which is what every
 * session has always done. It is deliberately a stated map rather than a rule:
 * "you and your friends can choose to be either allies or enemy commanders" is
 * a choice, and a choice that can only be made by re-ordering who joined first
 * is not one.
 */
export function versusCommandConfig(settings) {
  const s = settings || {};
  const L = VERSUS_LIMITS;
  const n = (spec, v) => (Number.isFinite(Number(v))
    ? clamp(Math.round(Number(v)), spec.min, spec.max) : spec.def);
  const w = s.versusWin;
  const teams = (s.versusTeams && typeof s.versusTeams === 'object') ? s.versusTeams : null;
  const seats = new Map();
  if (teams) {
    for (const [id, side] of Object.entries(teams)) {
      const v = Math.round(Number(side));
      /* An index into SIDES, not a raw team number: the lobby offers "side 1 or
       * side 2" and `sideTeam` is the one place that says what those are. A
       * stored number out of range is dropped rather than trusted — this blob
       * is localStorage and crosses versions. */
      if (Number.isFinite(v) && v >= 0 && v < ARMY_IDS.length) seats.set(String(id), v);
    }
  }
  return {
    strength: n(L.strength, s.versusStrength),
    reinforce: n(L.reinforce, s.versusReinforce),
    win: VERSUS_WINS[w] ? w : 'annihilation',
    rule: VERSUS_WINS[w] || VERSUS_WINS.annihilation,
    /** peer id → index into SIDES. Empty means "alternate down the roster". */
    seats,
  };
}

/**
 * WHO THE NEXT RUN WILL FIELD FROM THE PLAYER'S SETTINGS — army and size — or
 * null for a run with no army of yours in it.
 *
 * ONE RESOLVER, TWO SCREENS AND THE DEPLOY PATH. `main.js`'s `veteransToField`
 * asks it before every deploy, and the Company tab asks it to say who is being
 * taken in — and the whole reason it exists is that the two used to disagree
 * with `World.loadLevel`. main.js gated the company on `picksCampaign`, which
 * is true for exactly ONE of the five army modes, while `loadLevel`'s own rule
 * for "leads an army" has been `crossing || battles` since the mode-name test
 * was deleted. So in Command, The Line, The Front and Skirmish the men a
 * player got out NEVER FIELDED AGAIN unless the unrelated allies slider was
 * set — and then at the slider's size, which those modes ignore in favour of
 * `OPENING_STRENGTH`. The company read as a graveyard: the roll only ever
 * gained fallen, because the living were never taken back in.
 *
 * The three clauses are `loadLevel`'s, restated once and imported everywhere:
 * an army mode (`crossing || battles`) fields `OPENING_STRENGTH` whatever the
 * slider says; any other mode fields the contingent the slider asked for, or
 * nothing; and the army is `armyToLead`'s answer, with the contingent's
 * `allyArmy` choice honoured only where a contingent is what is being built
 * (an army mode passes null, which keeps `sideForOrder`'s veto intact).
 *
 * `groundArmies` is `LEVELS[key]?.armies` from whoever knows the ground —
 * this file does not import Levels.js and is not going to for a tiebreak that
 * only decides for a commander whose order leads neither army.
 */
/**
 * WHAT A CONTINGENT'S PURSE ACTUALLY BUYS — as a pure list of types.
 *
 * The contingent is not a headcount, it is a SPEND: the purse is priced in
 * cheapest-rung bodies (`opening − vets` of them) and then spent on the rung
 * the player chose, so ten troopers' worth of points buys rather fewer
 * droidekas. That arithmetic decides the composition of every non-campaign
 * army, and it used to live only inside `_musterOpening`'s loops — which meant
 * the barracks could not name a contingent's men in advance without growing a
 * second copy of a spend, and a second copy of a spend is exactly the
 * hand-maintained twin this repository keeps deleting.
 *
 * So it is here, once, with no roster and no side effects. `_musterOpening`
 * drives the result through `recruit()` exactly as it drove its own loops, and
 * the barracks asks the same question — which is the only reason a pre-rolled
 * contingent cannot out-buy the muster it is standing in for.
 *
 * @returns `{ types, refused }` — the types in the order they are bought, and
 *          the sentence to say when the chosen rung is beyond the purse.
 */
/**
 * ══ WHAT IS ON THE SHELF — the rungs a muster may actually buy ═════════════
 *
 * `unlockAt` is the director's method and it is one line: a campaign gates a
 * rung on the ground you are standing on, and anything else sells the whole
 * ladder. That is exactly the rule the BARRACKS needs too, to compose the same
 * line the muster is about to compose — and the barracks has no director.
 *
 * So the rule is a function of the two facts it depends on, and both callers
 * hand it what they have. `composeContingent` was given an `allow` set after a
 * meeting composed `10 troopers + an AT-TE + an officer` and `recruit` refused
 * both of the last two on the unlock; this is where that set comes from, once,
 * so the tab and the ground cannot end up gating differently.
 *
 * @param campaign  whether unlocks apply at all — `crossing || battles`.
 * @param areaRung  the ground being stood on, 1-based. Ignored when not a
 *                  campaign, which is why the barracks may leave it out.
 * @returns a Set of type names, or null for "the whole ladder" — which is what
 *          `composeContingent` reads as no gate at all.
 */
export function shelfFor(army, campaign, areaRung = 1) {
  if (!campaign) return null;
  /* AN ID OR A RECORD. Callers hold one or the other — `musterPlan` has an id
   * on a plan, the director has `c.army` — and a function that silently
   * answered "nothing is for sale" to one of them is worse than one that
   * throws: `composeContingent` reads an empty shelf as an empty ladder and
   * composes NOBODY, in silence. Measured: `shelfFor('republic', true, 1)`
   * came back as an empty Set. */
  const A = typeof army === 'string' ? ARMIES[army] : army;
  return new Set((A?.tiers || [])
    .filter((t) => (t.at ?? 1) <= areaRung).map((t) => t.type));
}

export function composeContingent(army, opening, standing = [], unit = CONTINGENT_MIXED,
                                  allow = null) {
  /**
   * ── AND ONLY WHAT IS ACTUALLY ON THE SHELF ─────────────────────────────
   *
   * `allow` is the set of rung types the caller's own gate permits, or null
   * for "all of them". It exists because this composer has TWO callers whose
   * shelves are not the same shelf, and the first version of it assumed they
   * were: a contingent in a wave mode gates nothing (`unlockAt` returns 1 when
   * `campaign` is false, so the whole ladder is for sale from the first
   * second), and a MEETING is `battles`, which is `campaign`, so its shelf is
   * gated on `areaRung` — 1, at the opening, which is every rung above the
   * third off it.
   *
   * MEASURED, and it is exactly the class of defect this function was lifted
   * out of `_musterOpening` to prevent: composed unaware of the gate, a
   * twenty-man meeting came out `10 troopers + 1 AT-TE + 1 officer`, `recruit`
   * refused both of the last two on the unlock, and the side that was supposed
   * to be a composed army took the field as ten identical clone troopers.
   *
   * The gate is the CALLER's because the gate is the caller's — `unlockAt` is
   * a method on the director and depends on which ground it is standing on.
   * What this function owns is the arithmetic, and the arithmetic is now told
   * what it may spend on rather than guessing.
   */
  const ladder = army?.tiers || [];
  if (!ladder.length) return { types: [], refused: null };
  /* THE INDEX IS INTO THE WHOLE LADDER and the SPEND is out of what is on the
   * shelf, and those are two different lists the moment a gate exists. `unit`
   * is "the third rung of whichever ladder I end up leading" — see `musterPlan`
   * — so resolving it against a filtered list would silently re-point a
   * player's saved choice at a different unit the day a rung is gated. */
  const tiers = allow ? ladder.filter((t) => allow.has(t.type)) : ladder;
  if (!tiers.length) return { types: [], refused: null };
  /* Priced off the LADDER's first rung, not the shelf's: the slider's meaning
   * ("eight allies is what eight troopers cost") must not move because
   * something above it happens to be gated. */
  const cheapest = ladder[0].type;
  /**
   * THE PURSE IS POINTS, AND EVERYTHING ON THE LINE COSTS FROM IT.
   *
   * It used to be priced by HEADCOUNT — `(opening − vets) × cost(cheapest)` —
   * and that is not the same arithmetic as the spend it pays for, so the two
   * disagreed the moment anybody arrived already composed: a line pre-raised
   * to the full purse still read as "six of eight bodies", left two
   * cheapest-rung units of change on the counter, and the muster spent it
   * again. Priced in POINTS the sum is self-consistent, so composing a
   * contingent and then composing it again buys nothing the second time.
   *
   * It is also more honest about veterans: a returning ARC has always been
   * worth more to a line than a returning trooper, and now he costs the purse
   * what he is worth instead of what the cheapest man is worth.
   */
  const list = Array.isArray(standing) ? standing : [];
  const spent = list.reduce((a, t) => a + musterCost(typeof t === 'string' ? t : t?.type), 0);
  /* THE WHOLE PURSE, and what is LEFT of it. Both are needed and they answer
   * different questions: the spend is out of what is left, and the REFUSAL is
   * about the whole — see the note over the refusal below. */
  const purse = (opening | 0) * musterCost(cheapest);
  let points = Math.max(0, purse - spent);
  let strength = list.length;
  const types = [];
  const spend = (type) => {
    /* Off the SHELF, so a type nobody may buy cannot be bought by name. */
    const rung = tiers.find((t) => t.type === type);
    if (!rung || points < rung.cost || strength >= MAX_STRENGTH) return false;
    points -= rung.cost;
    strength++;
    types.push(type);
    return true;
  };
  const want = unit >= 0 ? ladder[Math.min(unit, ladder.length - 1)] : null;
  /* A RUNG THAT IS NOT ON THE SHELF IS A REFUSAL WITH ITS OWN SENTENCE, and
   * not a silent fall-through to the line: the player picked a unit and is
   * owed the reason they did not get it. */
  if (want && allow && !allow.has(want.type)) {
    return {
      types,
      refused: `${ARCHETYPES[want.type]?.label ?? want.type} is not on the shelf here`,
    };
  }
  /**
   * ── A REFUSAL IS ABOUT THE REQUEST, NOT ABOUT THE CHANGE IN THE PURSE ───
   *
   * This tested the REMAINDER — `points`, after the standing line's cost had
   * been taken off — and that is the wrong question the moment anybody is
   * already standing. `_musterOpening` runs AFTER `_musterVeterans` has
   * enlisted the whole line the barracks composed, so the purse it hands in is
   * a purse that has already been spent on exactly what was asked for: every
   * ordinary contingent run opened with
   *
   *     CONTINGENT UNCHANGED — Clone Trooper costs 5 points and 10 troopers buys 0
   *
   * on top of a contingent that had been delivered precisely as asked. That is
   * the loudest of this mode's three "say it out loud" refusals firing on the
   * success path, which teaches the player to look away from it — and then the
   * real one, a purse that genuinely cannot afford the rung, goes past unread.
   *
   * So the test is against the WHOLE purse. "Six allies cannot buy an AT-TE"
   * is a true and useful sentence about a slider setting; "the men you already
   * have used up the money" is not a refusal at all, it is the system working.
   */
  if (want && want.cost > purse) {
    return {
      types,
      refused: `${ARCHETYPES[want.type]?.label ?? want.type} costs ${want.cost} points and `
        + `${opening} ${army.unit}${opening === 1 ? '' : 's'} buys ${purse}`,
    };
  }
  /**
   * …AND A PURSE THE STANDING LINE HAS ALREADY EATEN IS ALSO A REFUSAL, IF
   * NOBODY STANDING IS THE THING THAT WAS ASKED FOR.
   *
   * Testing the whole purse killed the false alarm and opened a quieter hole
   * in the other direction: a player with four returning ARCs who sets the
   * contingent to AT-TEs has a purse of 50 that COULD have bought one and 2
   * left after the veterans, so the composer bought nothing, said nothing, and
   * the muster came up empty. Measured, `opening 10, 4 ARCs standing, want
   * AT-TE` → `{}` with `refused: null`.
   *
   * The honest question is whether the player got what they asked for. If the
   * requested rung is standing already, they did — the purse was spent on it
   * last run and there is nothing to say. If it is not standing and the
   * remainder cannot buy one, they did not, and the sentence names the reason
   * that is actually true: the line you brought back is what spent it.
   */
  if (want && points < want.cost
      && !list.some((t) => (typeof t === 'string' ? t : t?.type) === want.type)) {
    return {
      types,
      refused: `${ARCHETYPES[want.type]?.label ?? want.type} costs ${want.cost} points and the `
        + `${list.length} ${army.unit}${list.length === 1 ? '' : 's'} already standing leave `
        + `${points} of ${purse}`,
    };
  }
  if (want) { while (spend(want.type)); }
  const room = Math.max(0, (opening | 0) - list.length);
  const line = want ? room : Math.max(room ? 1 : 0, Math.floor(room / 2));
  for (let i = 0; i < line && spend(cheapest); i++);
  /* THEN THE BEST THING LEFT ON THE SHELF — `_bestAffordable`'s rule, on
   * whatever `allow` left standing. This is what stops a remainder being
   * thrown away: ten Republic allies is 50 points, one AT-TE is 32, and the 18
   * left over buy three of the line. */
  for (let guard = 0; guard < MAX_STRENGTH; guard++) {
    const best = tiers.filter((t) => t.cost <= points).sort((a, b) => b.cost - a.cost)[0];
    if (!best || !spend(best.type)) break;
  }
  return { types, refused: null };
}

export function musterPlan(settings, groundArmies = null) {
  const s = settings || {};
  const armyMode = !!(MODES[s.mode]?.crossing || MODES[s.mode]?.battles);
  const cfg = commandConfig(s);
  const contingent = armyMode ? 0 : cfg.contingent;
  /* A LESSON FIELDS NOBODY, whatever the slider says. `MODES.training` builds
   * a `DojoDirector`, which has no roster at all — so a plan here would offer
   * the barracks ten named men for a run that can never deploy them, and the
   * tab would mint and save a line that does not exist. Read off the mode's
   * own declaration rather than off its name; see `dojo` in Waves.js. */
  if (MODES[s.mode]?.dojo) return null;
  if (!armyMode && !(contingent > 0)) return null;
  const army = armyToLead(s.order, {
    choice: armyMode ? null : cfg.allyArmy,
    ground: groundArmies,
  })?.id;
  if (!army) return null;
  return {
    army,
    want: armyMode ? OPENING_STRENGTH : contingent,
    armyMode,
    /* WHICH RUNG A CONTINGENT'S PURSE IS POINTED AT, so the barracks can ask
     * `composeContingent` what it buys without reaching for the settings blob
     * a second time. Null on an army mode, whose opening is rung-0 strangers
     * by design and has no rung to choose. */
    unit: armyMode ? null : cfg.unit,
    /**
     * …AND WHETHER UNLOCKS APPLY, which is the one term `shelfFor` needs and
     * the only one this plan can honestly supply.
     *
     * The first version of this carried a computed `shelf` and it was wrong
     * twice: `army` here is an ID and `shelfFor` wanted a record, so every
     * plan carried an EMPTY set; and it pinned the area to 1 while the
     * director gates on the ground it is standing on, so a crossing that ever
     * took a contingent would have had the tab gating at area 1 and the ground
     * at area N — the same disagreement, reintroduced from the other side.
     *
     * So the plan carries the FACT and the reader does the arithmetic.
     * `campaign` is `crossing || battles`, which is exactly `armyMode`, and
     * `World.loadLevel` computes the director's from the same two flags —
     * `Muster.ensure` only ever composes for a contingent, where it is false
     * and the whole ladder is for sale.
     */
    campaign: armyMode,
  };
}

/**
 * WHAT ONE CLEARED WAVE IS WORTH TO A CONTINGENT'S PURSE, in muster points.
 *
 * A campaign reinforces at an AREA boundary, on a screen, out of a purse the
 * area pays (`AREAS[*].muster`). A contingent has no areas and no screen — see
 * `payWave` — so it needs a cadence of its own, and it is stated as a NUMBER OF
 * CLEARED WAVES rather than as points, because points are `musterCost`'s
 * business and a constant here in points would be a second price list that
 * drifts the day a trooper's threat moves (§2.3). `_reinforce` divides the
 * cheapest rung's own price by this.
 *
 * Two, and slow on purpose. `_reinforce` will never take a contingent past the
 * strength the player deployed with, so the only thing this decides is how long
 * a hole in the line stays a hole — and a loss made good by the next wave clear
 * is not a loss. Two waves is long enough to be felt and short enough that a
 * thirty-wave run does not end with the player alone.
 */
export const CONTINGENT_WAVES_PER_BODY = 2;

/**
 * WHAT ONE MUSTER POINT OF ARMY IS WORTH AS A MULTIPLIER ON THE WAVE.
 *
 * 0.011, and it is 0.055 ÷ 5 rather than a number somebody liked: `allyScale`
 * charged 0.055 for a BODY and a line trooper costs 5 points, so pricing the
 * army in the currency it was bought in leaves the Republic's ladder exactly
 * where it was — ten troopers 1.55×, a full twenty-four 2.32×, to the decimal —
 * and fixes two things a head count could not.
 *
 * ONE: composition would otherwise be free power. The moment the muster shelf
 * opens to a contingent (`unlockAt`), fifty points buys one AT-TE and three
 * troopers instead of ten troopers, and a head count prices those four bodies
 * at 1.22× against the platoon's 1.55× — a heavier army meeting a smaller wave,
 * which is the exploit that would have arrived with the feature. In points both
 * come to 47-50 and both meet the same fight. COMPOSITION CHANGES THE SHAPE OF
 * THE BATTLE AND NOT ITS DIFFICULTY, which is the property that makes the
 * choice interesting instead of optimal.
 *
 * TWO: the Confederacy was overcharged. Ten B1s are threat 10 against ten clone
 * troopers' threat 20, and the old rule priced both at 1.55×; in points they
 * are 30 against 50, so a droid platoon now meets 1.33×. The `ARMIES` note is
 * explicit that the two ladders' TOTALS are held close and their per-body
 * hardware deliberately is not — this is the reader that was contradicting it.
 *
 * The +1-per-body inside `musterCost` carries `allyScale`'s own argument for
 * free: two cheap bodies cost more than one twice as good, because they split
 * the horde's attention — the same claim `WaveDirector.partySize` makes about a
 * second player and prices at 0.72.
 */
export const ALLY_POINT = 0.011;

/**
 * HOW FAR APART TWO ARMIES START, in metres.
 *
 * Derived from the roster rather than picked: the longest reach any unit in
 * this mode has is the marksman's 42 m, and two lines that begin inside each
 * other's range are not a meeting engagement, they are an ambush that both
 * sides walked into. 120 m is a little under three of those, which is about
 * fifteen seconds of advance at a trooper's 4.1 m/s — long enough for an order
 * to mean something before contact and short enough that the battle is the
 * event rather than the walk. Geonosis is a 620 m plain, so both anchors and
 * the whole approach sit well inside it.
 */
export const VERSUS_SEPARATION = 120;

/**
 * HOW FAST THE FRONT MOVES when one side is gathered and forward and the other
 * is not, as a fraction of half the field a second. See `CommandDirector._front`.
 *
 * 0.035 puts an unopposed push from the middle to a baseline in **29 seconds**,
 * and across the whole field in 57. That is slow enough that a lapse costs
 * ground rather than the battle — you can leave your line for fifteen seconds,
 * come back, and win the ground again — and fast enough that a side which has
 * genuinely broken the other is not made to grind. It is the one number that
 * sets how long a meeting lasts, so it is here and not inside the method.
 */
export const FRONT_PUSH = 0.035;

/**
 * HOW FAR APART TWO ALLIED COMMANDERS STAND ON THE SAME END OF THE FIELD.
 *
 * Only reached in a 2v2 and above, and DERIVED from the deployment ring rather
 * than picked: `deploy` puts a roster at `4 + (i % 3) * 2.2` metres around its
 * commander, so the widest body of an army sits 8.4 m out and two armies need
 * more than 16.8 m between their anchors not to interleave. Two allied lines
 * that deploy through one another are one crowd on the frame the battle starts,
 * and an order given to either of them is unreadable. 20 m leaves them three
 * metres clear and still reads as one line rather than two separate battles on
 * the same plain.
 */
export const PAIR_SPACING = 20;

/**
 * WHICH ARMY EACH COMMANDER LEADS, and this is the fix for two Jedi both
 * leading the Republic.
 *
 * `sideForOrder` derives the army from the player's Jedi/Sith choice, and its
 * own note explains why that is right: a Jedi at the head of a droid army "is
 * not a build, it is a bug wearing a menu". That reasoning is entirely sound
 * for ONE commander and it has no answer at all for two — two Jedi hosting each
 * other both got the Republic, so the meeting was the Republic against itself,
 * with identical bodies in identical armour and no way to tell whose line was
 * whose.
 *
 * So the order still picks FIRST, and the conflict is what is resolved: a
 * commander whose army is already taken gets the free one. Two Jedi are the
 * Republic and the Confederacy in roster order; a Jedi and a Sith get exactly
 * what they chose, whichever order they joined in.
 *
 * Pure and deterministic over the roster, for the same reason `assignSides` is:
 * it runs on the host and the answer goes out on the wire, and a client that
 * recomputes it must reach the same one or the two machines disagree about who
 * is wearing which colour.
 *
 * WITH MORE COMMANDERS THAN ARMIES — a 2v2 — THE EXTRAS SHARE, and `sides` is
 * what makes that sharing mean something. This note used to end by saying the
 * extras share "which is correct: the ARMY decides the units and the paint, the
 * SIDE decides who may hurt whom, and they are deliberately different
 * questions". Both halves of that are true and the conclusion did not follow.
 * Driven at four commanders, before `sides` existed: `taken` is full after the
 * second, so every commander past it fell to `ARMY_IDS[i % 2]` — which pairs
 * with the JOIN ORDER and not with the side. Four Jedi came out
 * republic/separatist/republic/separatist, which is right by luck; a Sith
 * hosting three Jedi came out separatist/republic/republic/separatist, so the
 * two allies on side 0 stood on one anchor in opposing colours, one of them
 * fielding the enemy's units, and neither the player nor the enemy could read
 * the field. Paint that does not track the side is worse than no paint.
 *
 * So an army belongs to a SIDE, not to a commander: the first commander on a
 * side picks it (their order still choosing first, the conflict still resolved
 * against what is already taken) and everybody who joins that side leads it
 * with them. Omit `sides` and every commander is their own side, which is the
 * one-army-each meeting and is byte for byte what this returned before.
 *
 * @param sides one side number per commander, in the same order — from
 *              `World.beginVersus`, which is the only thing that hands them out.
 */
export function assignArmies(orders = [], sides = null) {
  const out = [];
  const taken = new Set();
  /** side → the army that side is fielding. The whole of "allies share". */
  const bySide = new Map();
  for (let i = 0; i < orders.length; i++) {
    const side = sides && sides[i] !== undefined ? sides[i] : `#${i}`;
    if (bySide.has(side)) { out.push(ARMIES[bySide.get(side)]); continue; }
    const want = sideForOrder(orders[i]).id;
    const free = ARMY_IDS.find((k) => !taken.has(k));
    const id = !taken.has(want) ? want : (free ?? ARMY_IDS[i % ARMY_IDS.length]);
    taken.add(id);
    bySide.set(side, id);
    out.push(ARMIES[id]);
  }
  return out;
}

/**
 * THE RULES THE PLAYER'S POWERS ARE READ THROUGH — and the one line that makes
 * note #29 work.
 *
 * `Player._foes` builds the list every force power iterates, and it reads
 * `ctx.rules ?? this.world.rules`. `ctx.rules` had no writer anywhere in the
 * tree; World builds the ctx and World is where this goes. Handing the POWERS a
 * friendly-fire rule while the WORLD keeps co-op's is not a fudge, it is the
 * exact distinction the note draws:
 *
 *   the player's push, pull, grip, lightning, compel and rend reach their own
 *     troops, because a Force power does not check a uniform;
 *   an ally's BLASTER does not reach the player or another ally, because a
 *     trooper does check, and `_boltHitTest` and `bladeTargets` both go through
 *     `world.rules`, which is untouched.
 *
 * Frozen for the same reason `CO_OP_RULES` is: a caller that reaches for this
 * must not be able to turn it into something else for everybody.
 */
export const COMMAND_POWER_RULES = Object.freeze({ pvp: false, friendlyFire: true });

/* ══════════════════════════════════════════════════════════════════════ */
/*  Turning a body into one of yours                                      */
/* ══════════════════════════════════════════════════════════════════════ */

const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _slot = new THREE.Vector3();
/* The fear site: `_goToGround` solves it into this and never keeps it. */
const _hide = new THREE.Vector3();

/**
 * The rank insignia, as two shared geometries.
 *
 * SHARED, and that is the whole reason they are module-level constants rather
 * than built per body: `installPlates` allocates a fresh `plateGeo` for every
 * plate on every elite and disposes none of them, which is a pre-existing leak
 * this mode declines to copy. A campaign promotes a dozen bodies five times
 * each; sixty geometries for two shapes is sixty geometries too many.
 *
 * The crest is a thin fin along the crown — the shape the helmet already has,
 * in the rank's colour, standing a few millimetres proud. The bell is a shallow
 * cap over the shoulder. Both are LOW POLY on purpose: they are 4-8 triangles
 * apiece against a body of 11 342, and they exist to be a colour at ninety
 * metres rather than a shape at two.
 */
const CREST_GEO = new THREE.BoxGeometry(0.026, 0.052, 0.150);
/** A man's own stripe — see `MARKS`. Wider than it is tall, and shallow. */
const MARK_GEO = new THREE.BoxGeometry(0.030, 0.110, 0.075);
/** The second place a mark can go — a ring's worth of band on a forearm. */
const BAND_GEO = new THREE.BoxGeometry(0.062, 0.052, 0.062);
/** A wound made visible: a shallow scorch chip on the chest plate. */
const SCORCH_GEO = new THREE.BoxGeometry(0.075, 0.055, 0.020);
const BELL_GEO = (() => {
  const g = new THREE.SphereGeometry(0.088, 8, 4, 0, TAU, 0, Math.PI * 0.42);
  g.scale(1.15, 0.8, 1.05);
  return g;
})();

/**
 * ENLIST A SPAWNED BODY.
 *
 * Six fields and two wrappers, and that is the entire difference between an
 * enemy and one of your troops.
 *
 *   team          `TEAM.PARTY`. Passed IN rather than imported, because
 *                 `Player.js` imports `Waves.js` and this file imports it too —
 *                 a static edge from here to Player.js closes a cycle through a
 *                 module that is 5 000 lines of physics. The caller (World) has
 *                 the constant in hand already.
 *   cmd           the command record: the Trooper, its squad, its slot.
 *   _move         wrapped, to steer. See `steer`.
 *   damage        wrapped, to scale the player's own hits by `teamDamage` and to
 *                 raise the scream. See below.
 *
 * The RANK REPAINT happens here too, and it happens by rebuilding the body with
 * a different `accent`. That sounds expensive and is not: `spawnEnemy` has
 * already built one, and this only fires when the rank is above 0 — so a
 * campaign of twelve troopers repaints two or three bodies per area, once each,
 * at the moment they arrive.
 */
export function enlistBody(e, trooper, opts = {}) {
  if (!e || !trooper) return null;
  const teamDamage = opts.teamDamage ?? TEAM_DAMAGE_DEFAULT;
  e.team = opts.team ?? 0;
  e.commandOf = opts.director ?? null;
  /**
   * …AND WHICH OF THEM COMMANDS IT, which is a different question the moment
   * there are two people on the field with armies.
   *
   * `commandOf` is the DIRECTOR — the rules, one per world, and what
   * `installCommand`'s wrapper calls into. `cmdr` is the COMMANDER — the state:
   * whose roster this name is on, whose formation it forms up in, whose frame
   * its slot is solved in and whose measured pace it walks home at. Every one
   * of those used to be the local player's by construction.
   */
  e.cmdr = opts.cmdr ?? null;
  e.trooper = trooper;
  trooper.body = e;

  /* The rank's numbers. Multipliers on what the archetype already gave it, so a
   * promoted heavy is still a heavy — the ladder makes a body better at what it
   * is and never turns it into a different unit. */
  const R = trooper.rankRec;
  e.maxHp *= R.hp;
  e.hp = e.maxHp;
  e.attackDamage *= R.dmg;
  e.speed *= R.speed;

  /**
   * …AND THE MAN'S OWN SPREAD, ON TOP OF THE LADDER.
   *
   * The rank says how good he has become. This says what he is: two Sergeants
   * are no longer the same soldier. Multipliers, applied after the rank for the
   * same reason the rank is applied after the archetype — each layer says
   * something the one under it cannot, and none of them replaces another. A
   * fast Commander is still a Commander.
   *
   * Every line below is the ONLY consumer of its attribute, which is what
   * `attributes.mjs` asserts: a stat nothing reads is a number on a card, and
   * this file is written against exactly that.
   */
  e.maxHp *= scaleOf(trooper, 'grit');
  e.hp = e.maxHp;
  e.speed *= scaleOf(trooper, 'pace');
  /**
   * …AND IT HAS TO BE HIS OWN COPY FIRST.
   *
   * `e.A` is `ARCHETYPES[type]` — the SHARED table — unless `applyModifier`
   * has already cloned it for an elite. That comment used to claim the clone
   * was always there and it was wrong, so for one build every line below wrote
   * onto the table itself: the first trooper mustered multiplied every
   * trooper's spread, the second multiplied it again, and the army's cone
   * compounded through the whole roll. `attributes.mjs` caught it as a
   * marksman and a poor shot reading a spread ratio of exactly 1.000 — the
   * signature of two bodies sharing one object.
   *
   * Cloned by identity rather than by a flag, so this is a no-op on a body
   * `applyModifier` already gave its own copy to and never a second layer.
   */
  if (e.A && e.A === ARCHETYPES[e.type]) e.A = { ...e.A };
  const A = e.A;
  if (A) {
    /* Spread is a CONE, so a poor shot MULTIPLIES it up — `attrScale` returns
     * 1.30 at zero Marksmanship and 0.74 at a hundred, which is the one
     * attribute in the table whose `lo` is above its `hi`. */
    if (A.spread != null) A.spread *= scaleOf(trooper, 'aim');
    const cad = scaleOf(trooper, 'cadence');
    if (A.fireRate != null) A.fireRate *= cad;
    /* …and the gap INSIDE a burst shortens as the rate rises, or a fast
     * trigger would fire the same burst at the same speed and only wait less
     * between them, which is not what a cadence is. */
    if (A.burstGap != null) A.burstGap /= cad;
    /**
     * ── THE TWO THINGS A NUMBER CANNOT SAY ──────────────────────────────
     *
     * A trait's `flag` is a BEHAVIOUR, and both of these move the one field
     * that decides where a body wants to stand: `preferred`, its stand-off
     * band. Point swings make a man better or worse at his job; these two make
     * him do a different job, which is the whole reason the flag exists beside
     * the deltas rather than instead of them.
     *
     * RECKLESS closes. He wants to be at 62% of the range he was built for, so
     * he walks out of the line towards whatever is shooting and you watch him
     * do it. CAREFUL stands off at 128% and — see `slotFor` — hunts cover
     * whether or not anyone is shooting at him yet.
     *
     * Neither is an upgrade. A reckless heavy gunner dies in the open and a
     * careful sniper never takes the ground; `Attributes.js` pairs both flags
     * with a real point cost for the same reason.
     */
    if (Array.isArray(A.preferred) && A.preferred.length === 2) {
      const band = hasFlag(trooper, 'pushes') ? 0.62 : hasFlag(trooper, 'holds') ? 1.28 : 1;
      if (band !== 1) A.preferred = [A.preferred[0] * band, A.preferred[1] * band];
    }
  }
  /* The muster morale he arrives at. `Trooper.morale` is 0.72 for a fresh man;
   * Nerve moves where his own floor sits, so a jumpy soldier begins a battle
   * closer to breaking and a stubborn one has further to fall. */
  trooper.morale = clamp(trooper.morale * scaleOf(trooper, 'nerve'), 0, 1);

  /* The aura the fifth rung carries, and the one place this mode reaches for an
   * existing MODIFIER rather than inventing a field. `leader` is the rally ring
   * — faster fire, harder hits, quicker feet for everything inside it — and it
   * is drawn on the ground, so an officer is visibly the reason the line is
   * holding. */
  const aura = ARCHETYPES[trooper.type]?.commandAura;
  if (aura) applyModifier(e, aura);

  /* …and the rank goes ON THE BODY at deploy, not only at the moment of
   * promotion. A campaign rebuilds every body at every area boundary, so a
   * sergeant who was painted in area 2 would walk into area 3 as a stranger if
   * this only fired inside `_promoteTrooper`. */
  if (R.color != null && opts.director) {
    e.rankColor = R.color;
    opts.director.repaint(e, R.color);
  }
  /* …AND THE MARK THE PLAYER PAINTED ON HIM, on the same line and for the same
   * reason: a campaign rebuilds every body at every area boundary, so a mark
   * applied only at the moment it was chosen would last exactly one area. See
   * `MARKS` for why it is a second material low on the legs and not a recolour
   * of the rank. */
  const mark = markById(trooper.look?.mark)?.color;
  if (mark != null && opts.director) {
    e.markColor = mark;
    opts.director.markUp(e, mark);
  }
  /* …AND THE BAND, the same sentence one bone over. Optional-called because a
   * check's stub director carries only the two methods it is checking, and a
   * band must never be the reason an enlistment throws. */
  const band = markById(trooper.look?.band)?.color;
  if (band != null && opts.director) {
    e.bandColor = band;
    opts.director.bandUp?.(e, band);
  }
  /* …AND HIS SCARS, which nobody chose. See `scorchUp` — `wounds` is written
   * by the game and rendered here, and a man with none wears none. */
  if ((trooper.wounds | 0) > 0 && opts.director) {
    opts.director.scorchUp?.(e, trooper.wounds | 0);
  }

  installCommand(e);
  installTeamDamage(e, teamDamage);
  return e;
}

/**
 * THE ONE SEAM A FORMATION NEEDS, AND IT IS THE ONLY ONE THERE IS.
 *
 * `Enemy.update` runs `_think` (which sets `this.wish` from `this.target`) and
 * then `_move` (which consumes it). Nothing sits between them — so a formation
 * has to BE the thing between them, and the only way to get there without
 * editing Enemy.js is to wrap `_move` on the instance. This is the same
 * "a behaviour installs something on the instance" seam `Waves.cleavingThrow`
 * uses for the pierce and `Order.liveMod` uses for the Grey's temper, and
 * `tools/checks/command.mjs` pins the method name for exactly the reason
 * `controls.mjs` pins `_updateThrow`: rename it in Enemy.js and the check fails
 * rather than every formation in the game quietly becoming a charge.
 *
 * NOTE THE ORDER. The wrapper steers FIRST and then calls the original, so the
 * wish it writes is the one `_move` reads — and everything `_move` does with it
 * afterwards (the wall slide, the stuck commit, the backpedal limit, the
 * acceleration ramp) applies to a formation move exactly as it applies to a
 * charge. A formation is not a different movement model; it is a different
 * destination for the same one.
 *
 * AND IT PUTS `speed` BACK. `_move` reads `this.speed` once per frame, so the
 * catch-up pace a trooper walks home at (see `followSpeed`) is a write that
 * lasts exactly the length of the call that wanted it. Leaving it on the body
 * would compound with the rank multipliers `enlistBody` applies — a Commander is
 * already ×1.10 — and a promotion would silently become a permanent sprint.
 */
export function installCommand(e) {
  if (!e || e._cmdMove) return false;
  const base = e._move;
  if (typeof base !== 'function') return false;
  e._cmdMove = true;
  /* Variadic for the reason `installTeamDamage` below is: `dt` is the only
   * argument this wrapper has an opinion about, and a wrapper that names the
   * rest of the list has taken a position on a signature it does not own. */
  e._move = function (dt, ...rest) {
    const d = this.commandOf;
    const was = this.speed;
    if (d && !this.dead && !this.gripped && !this.toppled) d.steer(this, dt);
    try { return base.call(this, dt, ...rest); }
    finally { this.speed = was; }
  };
  return true;
}

/**
 * TEAM DAMAGE, AND THE SCREAM.
 *
 * `Enemy.damage` is the one door every injury goes through — blade, bolt,
 * explosion, fall, lightning — so wrapping it on the instance catches all of
 * them and cannot miss the fifth one somebody adds later. That is the whole
 * reason it is here and not spread across the four call sites that hurt things.
 *
 * ONLY THE PLAYER'S OWN HITS ARE SCALED. A B1 shooting your sergeant does full
 * damage — obviously — and so does a Force push that throws him into a rock,
 * because the fall is nobody's fault. What is scaled is a hit whose `source` is
 * on your own side, which is exactly the hit the note is about.
 *
 * VARIADIC, AND THAT IS THE LOAD-BEARING PART OF THE WRAPPER.
 *
 * It used to name four parameters and forward four, and this note used to say
 * so out loud — `Enemy.damage(amount, point, source, kind)` — which is the tell:
 * a wrapper that restates a signature has taken a position on an argument list
 * it has no opinion about, and it goes silently wrong the day that list grows.
 * It did. `damage` gained a fifth, `preResisted`, when the enemy's Force
 * resistance shipped: the flag that says this blow has already paid at the
 * other door. Dropping it charges the body's Force pool TWICE for one blow.
 *
 * Four wrappers in this tree had the same shape and two of them were live game
 * code (`Waves.js boonGuard`, in front of the player the moment any card is
 * drafted; `Injury.js armInjury`, always). The fifth was in an INSTRUMENT, and
 * it manufactured a finding that looked entirely real. So the amount is the
 * only argument this function has an opinion on, and everything after it is
 * forwarded untouched and uncounted.
 *
 * @returns whether the wrapper went on.
 */
export function installTeamDamage(e, scale) {
  if (!e || e._cmdDamage) return false;
  const base = e.damage;
  if (typeof base !== 'function') return false;
  e._cmdDamage = true;
  e.teamDamage = clamp(scale, 0, 1);
  e.damage = function (amount, ...rest) {
    // `rest[1]` is `source` and `rest[2]` is `kind`, by position, because those
    // are the two arguments this wrapper reads. Named out of the list rather
    // than declared, so the list itself stays the callee's business — and
    // `preResisted`, which grew onto the end of that list after this wrapper
    // was written, is still forwarded without this file having an opinion on
    // it. That is the whole reason the forward is variadic; see the note above.
    const source = rest[1], kind = rest[2];
    let amt = amount;
    /**
     * SOMEBODY IS SHOOTING AT THIS MAN. Recorded here because this is the one
     * door every injury already comes through — blade, bolt, blast, fall — so
     * it cannot miss the kind somebody adds next, and it costs one compare on
     * a path that was already running.
     *
     * Hostile fire only: a stray shot from your own line is a reason to shout
     * (below), not a reason for the man it hit to go to ground behind a crate
     * — a squad that took cover from each other would spend a battle behind
     * the nearest drum. `_fireEpoch` counts the SPELL rather than the hits, so
     * a man pinned again after his line has moved picks the ground he is on
     * now instead of walking back to the crate he liked last time. See
     * UNDER_FIRE and `_coverSite`.
     */
    if (amount > 0 && (!source || source.team !== this.team)) {
      if (!(this.underFire > 0)) this._fireEpoch = (this._fireEpoch | 0) + 1;
      this.underFire = UNDER_FIRE;
    }
    // `team` on the source, not `instanceof Player`: a co-op partner's blade and
    // a peer's avatar are as much your side as you are, and a bolt carries its
    // owner. A source with no team at all (a hazard, a falling crate) is nobody's
    // and pays full — the same fails-open rule `canHarm` states.
    if (source && source !== this && source.team !== undefined && source.team === this.team) {
      amt = amount * this.teamDamage;
      const d = this.commandOf;
      if (d && amt > 0) d.onFriendlyHit(this, amt, source, kind);
      if (this.teamDamage <= 0) return false;
    }
    return base.call(this, amt, ...rest);
  };
  return true;
}

/* ══════════════════════════════════════════════════════════════════════ */
/*  A commander                                                           */
/* ══════════════════════════════════════════════════════════════════════ */

/**
 * ONE PERSON AND THE ARMY THEY LEAD.
 *
 * THE OWNER'S QUESTION IS "can two sides command two different armies and meet
 * on the battlefield?", and the answer was no for one structural reason: every
 * piece of state an army has lived on the DIRECTOR, and the director keyed all
 * of it to `world.player`. One roster, one formation, one army, one measured
 * leader pace, one planted frame — nine methods reached for `this.world.player`
 * and there is exactly one of those on a machine.
 *
 * So this object is the split, and the line it is drawn on is worth stating
 * because it is the whole design: **the commander is the STATE, the director is
 * the RULES.** A formation's geometry, a leash's arithmetic, the promotion
 * ladder, the muster's prices and the wave composer are the same for everybody
 * on the field and stay where they are; who is standing where, what they are
 * called, which army they belong to and what order is in force are per-person
 * and live here.
 *
 * That is why the methods did NOT move. `steer`, `slotFor`, `targetFor` and
 * `followSpeed` still belong to the director and now read their state off the
 * commander the body belongs to (`e.cmdr`), which means there is still exactly
 * one implementation of every rule — two armies fight by the same physics, and
 * a second copy of `slotFor` for the second commander is precisely the twin
 * defect this codebase has paid for eight times.
 *
 * `side` is passed IN as a number rather than derived here, for the reason
 * `enlistBody`'s `team` is: a static import edge from this file to Player.js
 * closes a cycle through Waves.js, and Player.js is where `SIDES` and
 * `sideTeam` live. World has the number in hand.
 */
export class Commander {
  constructor(director, opts = {}) {
    this.director = director;
    /** The Player or RemoteAvatar giving the orders. */
    this.player = opts.player ?? null;
    /** Their side, from `sideTeam` — the number every body of theirs wears. */
    this.side = opts.side ?? 0;
    this.army = opts.army || ARMIES.republic;
    this.foe = enemyOf(this.army);
    /**
     * ONE ROSTER, FOUR SQUADS — FLAGSHIP §9, and this line used to be `new
     * CommandRoster(this.army)` with no way to say otherwise.
     *
     * A roster per commander is four private armies, and driving it produced
     * both of the defects §9 names. The first is the one that matters in the
     * mode whose whole subject is names you recognise: `CommandRoster.taken` is
     * the set that makes `designate` unique, it is PER ROSTER, and four of them
     * mint out of one seeded stream — so two commanders on the same side field
     * two men with the same designation and the roll you are asked to care
     * about has a duplicate in it.
     *
     * The fix is not a smarter `designate`, it is one roster: the director owns
     * one per SIDE and army (`_rosterFor`) and hands it in here. Uniqueness
     * stops being a property somebody has to maintain and becomes a fact about
     * there being one set. The shared purse §9 asks for — "a Heavy for your
     * squad or an ARC for mine" — is the same object being shared, not a second
     * feature; and a departing player's men have somewhere to go, because they
     * were never his in the first place.
     *
     * `null` means "your own", which is every Commander built loose in a check
     * and every opposed commander in a meeting — two armies facing each other
     * are two rosters and must be.
     */
    this.roster = opts.roster || new CommandRoster(this.army);
    this.formation = FORMATIONS[opts.formation] ? opts.formation : DEFAULT_FORMATION;
    /** The frame a non-advancing formation was planted in. See `_anchorFor`. */
    this._planted = null;
    /** HOLD THIS GROUND, over whatever formation is up. See `hold`. */
    this.holding = false;
    /** The heading the formation is solved in — slewed, not the live aim. */
    this._heldYaw = null;
    /** This commander's own measured pace. See `_trackLeader`/`followSpeed`. */
    this._leaderSpeed = 0;
    this._leaderPos = null;
    /**
     * WHERE THIS ARMY COMES DOWN, when there is no commander standing there to
     * come down around.
     *
     * `deploy` puts the roster in a ring around its commander, which is right
     * for a campaign — they arrived with you. Two armies meeting need two
     * anchors 620 m apart on a plain, and the second one may belong to a peer
     * whose body has not been built on this machine yet. Null means "around the
     * commander", which is every existing caller.
     */
    this.anchor = opts.anchor ? opts.anchor.clone() : null;
    /** Which way this army faces when it is planted on an anchor. */
    this.facing = opts.facing ?? 0;
  }

  get world() { return this.director?.world ?? null; }
  get name() { return this.player?.name ?? this.army.leader; }
  /** Everything of this commander's still on its feet, the bodies alone.
   *  THE SQUADS THIS ONE LEADS, not the whole roster: with one roster shared
   *  between four players, `roster.living` is everybody's line. */
  get standing() {
    let n = 0;
    for (const t of (this.director?.led(this) ?? this.roster.living)) if (t.body && !t.body.dead) n++;
    return n;
  }
}

/* ══════════════════════════════════════════════════════════════════════ */
/*  The director                                                          */
/* ══════════════════════════════════════════════════════════════════════ */

/**
 * COMMAND'S WAVE DIRECTOR.
 *
 * A `WaveDirector` subclass rather than a rewrite, and that is the load-bearing
 * decision in this file. Everything the escalation is — the budget curve, the
 * body cap, the heavy limit, the modifier ladder, the set-piece share, the
 * arrivals, the liveness watchdog — is tuned, measured and pinned by four
 * checks, and Command wants ALL of it. What it adds is:
 *
 *   · a second army, which is `_muster` and `steer` and nothing in the composer;
 *   · an AREA above the wave, which is `_areaClear`;
 *   · a pool filtered to ONE side, which is `unlockedAt`'s one override.
 *
 * The composer itself is untouched. A Geonosis wave is composed by exactly the
 * arithmetic that composes a Colosseum wave, which is why it is already balanced.
 */
export class CommandDirector extends WaveDirector {
  constructor(world, opts = {}) {
    /**
     * THE MODE IT REPORTS IS THE MODE THE GAME IS IN — it used to be the string
     * `'command'` on every world this class runs, and this class runs three.
     *
     * `World.loadLevel` builds a `CommandDirector` for `command`, for
     * `skirmish` and for `campaign` (`leadsArmy`), which is right: all three
     * lead an army through the same director. Hard-coding the mode on the way
     * past made the director lie to everything that reads one. Measured on
     * three real Worlds, one per mode, all on Geonosis:
     *
     *     settings.mode  command   skirmish  campaign
     *     director.mode  command   command   command      ← before
     *     director.mode  command   skirmish  campaign     ← after
     *
     * The reader that shows it is `Menu`'s codex: `MODES[director.mode].name`,
     * printed as "These are the numbers for <b>Command</b>, chosen under
     * Deploy" — on the page a Skirmish player opens, above a purse table that
     * is the Skirmish's. `settings.mode` is the one authority and it is read
     * here rather than restated, so a fourth mode that leads an army reports
     * itself on the day it is added.
     *
     * `opts.mode` still wins, because a harness composing a wave without a
     * World is the caller `WaveDirector`'s own `opts.pool`/`opts.armies` exist
     * for; the world's settings are next; `'command'` is the floor, so a
     * director built with no world at all is what it always was.
     *
     * THE RULE THAT WAS RIDING ON THE STRING IS NOW STATED WHERE IT LIVES —
     * see `sideFor` below. Nothing else keyed on it: `sandbox` and the duel
     * branch of `_compose` cannot match any of the three, and `DRAFT_MODES`
     * holds none of them, so `drafts` is false before and after (measured).
     */
    super(world, { ...opts, mode: opts.mode ?? world?.settings?.mode ?? 'command' });
    const cfg = commandConfig(world?.settings);

    /**
     * EVERY PERSON ON THIS FIELD WITH AN ARMY, and there used to be room for
     * exactly one.
     *
     * The local player's is built here so that a solo campaign is the list with
     * one entry in it and nothing about it is a special case. A second
     * commander is added by `enlist` below when a session has one — that is the
     * whole of "two sides command two different armies".
     */
    /**
     * WHETHER THIS DIRECTOR RUNS THE FIVE-AREA CROSSING ABOVE THE WAVE.
     *
     * True for the three modes that ARE an army — Command, a skirmish and a
     * campaign — and false for a CONTINGENT, which is the same roster, the same
     * ranks, the same permadeath and the same orders dropped into a mode that
     * has its own escalation and its own ending already. See `commandConfig`'s
     * `contingent` and the readers below: `payWave`, `budgetFor`, `heavyBias`,
     * `unlockAt` and `_musterOpening`. Nothing else in this class knows.
     *
     * It is a FIELD and not a mode-name test for the reason `MODES.skirmish`'s
     * `battles` is one: `waves`, `roguelite`, `duel` and `sandbox` can all
     * carry a contingent today and the next mode will too.
     *
     * READ BEFORE THE COMMANDERS ARE BUILT, and that is not a tidy-up: the army
     * a commander is handed depends on it. A campaign's army is its fiction and
     * is never the player's to override; a contingent's is. See `armyToLead`.
     */
    this.campaign = opts.campaign ?? true;
    /**
     * IS THIS RUN THE CROSSING — the thing §5 calls a session.
     *
     * Three modes build this director and only one of them is a sitting that
     * walks across one ground: Command. A skirmish and a campaign lead the same
     * army with the same ranks and the same permadeath, and both of them use
     * `AREAS` as a PRESSURE DIAL rather than as a route — `World.beginSkirmish`
     * writes `d.areaIndex = sk.pressure` and never advances it, and a campaign
     * is one battle per ground with its own ending. A length rolled over their
     * heads would re-point the dial: at pressure 2 under a two-stage plan the
     * budget curve, the heavy bias and the muster shelf would all read the
     * FIFTH area's numbers, which is a difficulty change nobody asked for.
     *
     * `MODES[...].battles` is the field that already draws exactly this line —
     * "a bounded battle with an army under you", set on `skirmish` and
     * `campaign` and absent from `command` — and `World.beginSkirmish` and
     * `main.js` both branch on it already. Asked rather than restated, for the
     * reason its own note gives: a list of mode names here is the twin defect.
     */
    this.crossing = this.campaign && !MODES[this.mode]?.battles;
    /**
     * HOW LONG THIS SITTING IS, AND IT IS A ROLL OFF THE SEED — FLAGSHIP §5.
     *
     * "Length is itself a seed roll: Raid (2 engagements, 10–15 min) · Push
     * (3, 18–25) · Grind (5, 30–45)." The mode promised 20–40 minutes and had
     * one length in it — five areas, 30–45 on its own — so it could only ever
     * deliver the top of its own range.
     *
     * `stages` is the route, not a second copy of the ground: every record in
     * it is one of `AREAS`, chosen by `planStages`, first and last always
     * included. Everything downstream reads `this.stages` instead of the
     * literal, so `lastArea` is still "the end of the list" and `_endCampaign`
     * is still one door.
     *
     * A run with no seed is a Grind, which is the five areas unchanged — see
     * `rollSession`. That is every headless check that builds a director by
     * hand, and it is why this is not a behaviour change anywhere except in
     * the one mode that states a seed.
     */
    this.plan = this.crossing ? rollSession(this.seed) : DEFAULT_PLAN;
    this.stages = this.crossing ? planStages(this.plan, AREAS) : AREAS;
    /**
     * WHETHER THE LINE IS THE WIN CONDITION — `MODES.theline.holdTheLine`.
     *
     * FLAGSHIP §2, which is the whole design in one sentence: "a run that
     * kills three hundred droids and loses the squad is a loss." Nothing read
     * that. `_endCampaign` asserted `won: true` off having reached the last
     * area and never looked at the roster, so the mode whose subject is an
     * army scored a crossing finished alone as a victory — and there was no
     * path at all by which a wiped roster ended anything, because the run ends
     * on `_checkWipe`, which counts PLAYERS. A Jedi standing over ten graves
     * kept fighting, took the ridge, and got the same card as a Jedi who
     * brought their men home.
     *
     * Two lines follow from it and both are below: `_checkLine` ends a run
     * whose army is gone, and `_endCampaign` computes its verdict instead of
     * declaring it. It is read off the mode's own field rather than off the
     * mode's name, so Command keeps the ground-is-the-win rule it shipped with
     * and a second mode that wants this one takes the field.
     */
    this.holdTheLine = !!MODES[this.mode]?.holdTheLine;
    /**
     * WHETHER THE GROUND IS TAKEN BY THE LINE OR BY THE KILL COUNT — see
     * `lineIsUp`, which is where the whole argument is.
     *
     * A second field rather than reading `holdTheLine`, because they are two
     * different rules and a mode may want either: one is about how a run is
     * SCORED and the other about how it ADVANCES. Command declares neither and
     * is untouched by both.
     */
    this.lineAdvances = !!MODES[this.mode]?.lineAdvances;
    /* A NAMED MAN GOES DOWN BEFORE HE DIES — see `MODES.theline.downed` and
     * `Enemy._mayGoDown`. Read off the mode here, once, so `Enemy` asks the
     * director rather than reaching through it into the mode table. */
    this.downedMen = !!MODES[this.mode]?.downed;
    /**
     * THE ROSTERS THIS DIRECTOR KEEPS — one per side-and-army. See `_rosterFor`
     * and `Commander.roster`.
     * @type {Map<string, CommandRoster>}
     */
    this._rosters = new Map();
    /**
     * SIDES WHOSE COMMANDER HAS LEFT THE SESSION. See `dismissCommander` and
     * the note in `census` — a beaten side and a side that was never there are
     * different states to `DuelMatch`, and only one of them ends the round.
     * @type {Set<number>}
     */
    this._departed = new Set();
    const side0 = opts.side ?? world?.partyTeam ?? 0;
    /* THE CHOICE IS PASSED ONLY BY A CONTINGENT. `cfg.allyArmy` is the
     * player's answer off the options screen and `null` is "no answer";
     * handing a campaign `null` is what keeps `sideForOrder`'s veto intact in
     * the three modes whose whole subject is that war. The GROUND is passed
     * always, because it only ever decides for a commander whose order leads
     * neither army — see the third clause of `armyToLead`. */
    const army0 = opts.army || armyToLead(world?.settings?.order ?? world?.player?.order ?? 'jedi', {
      choice: this.campaign ? null : cfg.allyArmy,
      ground: world?.level?.armies,
    });
    this.commanders = [new Commander(this, {
      player: world?.player ?? null,
      side: side0,
      army: army0,
      roster: this._rosterFor(side0, army0),
      formation: cfg.formation,
    })];
    this.teamDamage = cfg.teamDamage;
    /**
     * Two commanders on one field, rather than one against the composer — and
     * it is a WISH at this point rather than a fact. Nothing here can know
     * whether the second commander exists; see `meetingOpposed`, which is asked
     * at the two moments that can.
     */
    this.versus = !!cfg.versus;
    /**
     * THE MEETING'S OWN PICKS, read once — `versusCommandConfig` is the only
     * thing allowed to say what the four settings mean, and this is its only
     * caller. Read whether or not `versus` is true, because it is one object
     * with defaults in it and a director that stands its meeting down still has
     * to have a coherent answer for anything that asks.
     */
    this.meetingPlan = versusCommandConfig(world?.settings ?? opts.settings ?? null);
    /**
     * HOW MANY MEN A SIDE BRINGS — see `versusCommandConfig` for why this is
     * per SIDE and not per commander, and for the three-commander measurement
     * that made it so. Zero outside a meeting, which is the flag every reader
     * uses to fall back to `this.opening` and the §9 join rule.
     */
    this.sideStrength = this.versus ? this.meetingPlan.strength : 0;
    /** Seconds between reinforcement waves, or 0 for a standing battle. */
    this.reinforceEvery = this.versus ? this.meetingPlan.reinforce : 0;
    this._reinforceIn = this.reinforceEvery;
    /**
     * THE RULES THIS WORLD HAD BEFORE THE MEETING REWROTE THEM, or null.
     *
     * `World._loadSteps` swaps `world.rules` for `pvpRules({pvp: true,
     * duelRounds: 1})` when the director it has just built says `versus` — six
     * lines AFTER this constructor runs, which is why the object still on the
     * world here is the one the World's own constructor derived from the
     * player's settings. Measured on a solo Command deploy with the meeting box
     * ticked: `{pvp:true,friendlyFire:true}` on a field with one player on it,
     * so the player's own troopers' bolts could hit him and each other for the
     * whole run, with nothing anywhere having asked for that.
     *
     * Kept rather than re-derived because `pvpRules` lives in Player.js and a
     * static edge from this file to that one closes a cycle (see `enlistBody`).
     * Handing the world back the object it already had restates nothing.
     */
    this._preMeeting = this.versus ? (world?.rules ?? null) : null;
    /** How many bodies the opening muster enlists. A campaign opens with
     *  `OPENING_STRENGTH`; a contingent opens with what the player asked for. */
    this.opening = clamp(opts.strength ?? OPENING_STRENGTH, 1, MAX_STRENGTH);
    /**
     * THE SAVED ROLL THIS RUN IS FIELDING, or null. Stored records, not
     * `Trooper`s — `_musterVeterans` puts them back on the roster through
     * `enlistRecord`, which is the one door. Injected rather than read, so
     * nothing in this file touches localStorage; see the note there.
     */
    this.veterans = Array.isArray(opts.veterans) ? opts.veterans : null;
    /**
     * ── WHAT THE PLAYER CALLS THEIR SQUADS ────────────────────────────────
     *
     * "I should be able to name my squads before starting a game."
     *
     * An array of strings by squad index, handed in exactly the way the
     * veterans are and for the same reason: the names live in `Company.js`,
     * which is a localStorage module, and this file has never been one. Whoever
     * builds the World reads `Company.squadNames()` and hands it over; the
     * director prints what it is given. A run with none prints the numbers,
     * which is what every squad is called until somebody names it.
     */
    this.squadNames = Array.isArray(opts.squadNames) ? opts.squadNames.slice() : null;
    /**
     * WHICH RUNG THE CONTINGENT IS BUILT ON, or `CONTINGENT_MIXED`.
     *
     * A campaign is pinned to rung 0 whatever the options screen says, and that
     * is `_musterOpening`'s oldest sentence rather than a new restriction:
     * "the roster screen at the top of a campaign should be ten identical
     * strangers, so that the three names in it four areas later are something
     * the player earned". The campaign composes its army at the muster screen,
     * between areas, out of a purse an area paid — that IS its composition, and
     * a slider that pre-composed it would take the mode's own decision away.
     */
    /**
     * …AND A MEETING COMPOSES ITS ARMY, which is the half of the player's ask
     * that the campaign rule was swallowing.
     *
     * "at the beginning you choose the number and mixup of each of your
     * armies/the field."
     *
     * A CAMPAIGN is forced to rung 0 for a good reason, written out under
     * `_musterOpening`: the roll at the top of a crossing is "ten identical
     * strangers, so that the three names in it four areas later are something
     * the player earned", and the composition is what the muster screen between
     * areas is FOR. A meeting has no areas and no muster screen — it is one
     * battle — so under that rule it fielded twenty identical clone troopers
     * against twenty identical B1s and a purse with nowhere to spend it.
     *
     * So a meeting reads the contingent's own composition control, which is the
     * shelf this game already has for "what is my army made of": a rung of the
     * ladder, or `CONTINGENT_MIXED` for the line-then-the-heaviest-affordable
     * spend `autoMuster` uses. It is already on `SESSION_KEYS`, so it is the
     * host's answer for the table like everything else about the battle.
     */
    this.unit = (this.campaign && !cfg.versus) ? 0 : (opts.unit ?? cfg.unit);
    this.areaIndex = 0;
    this.areaWaves = 0;
    /** Raised once, when the last area is behind you. See `_endCampaign`. */
    this.done = false;
    /** Raised while the muster is open, so no wave starts under the screen. */
    this.mustering = false;
    /** Trooper records currently riding a gunship in. See `deploy`. */
    this._inbound = new Set();
    /** Every promotion, death and order — the campaign's own log. */
    this.log = [];
    /**
     * WHERE THIS ENGAGEMENT'S ENTRIES START — one integer, and it is the whole
     * of the state the interlude adds.
     *
     * §5's quiet between engagements has to be REAL: "points in, bodies out,
     * the roll of who lived, who was promoted, and who is on the fallen list."
     * Every one of those is already written to `this.log` as it happens, by the
     * code that makes it happen — `fell` by `_deathOf`, `promote` by
     * `_promoteTrooper`, `steps-up` when a squad loses its sergeant. So the
     * interlude reads the ledger rather than keeping a second tally beside it,
     * and the only thing it needs is a mark for where the last one ended.
     * Moved by `start` and by `closeMuster`, which are the two doors into an
     * engagement. See `Session.interludeBeats`.
     */
    this._logAt = 0;
    /** The beats of the muster that is open, or null. Published on the offer so
     *  a peer's screen tells the same story as the host's. */
    this._interlude = null;
    /**
     * THE FORK THAT IS OPEN, FROZEN THE MOMENT THE MUSTER OPENS.
     *
     * `routeChoices()` derives the pair off `stages`, and `takeRoute` REWRITES
     * `stages` — so a fork re-derived on every read would deal a different
     * alternative the instant the player took one. (Take the spires over the
     * hailfire line on a Push and the freshly-derived pair becomes spires vs
     * the open plain; the card would swap a button under the cursor.) So it is
     * dealt once, in `_areaClear`, held here for as long as the card is up, and
     * dropped by `closeMuster` — exactly the lifetime `_interlude` has, for
     * exactly the reason its own note gives about being the same object every
     * call. Empty array when this boundary has no fork; null between musters.
     */
    this._fork = null;
    this.onRoster = null;         // (summary) => void      — the HUD's feed
    this.onMuster = null;         // (offer) => void        — the between-areas screen
    /**
     * THE MUSTER CARD COMES DOWN, and only a machine that is not holding the
     * army needs telling.
     *
     * On the host the card is dismissed by the button that dismissed it. On
     * every other machine the muster ends when the HOST's player presses Done,
     * which is a fact that arrives over the wire and has nowhere else to land —
     * without this a joining commander sits on an open card, with the world
     * stopped behind it, through the whole of the next area. See
     * `applyMusterNet`.
     */
    this.onMusterClose = null;    // () => void
    this.onOrder = null;          // (formation, squads) => void
    /** Which squad the next order is for; null is the whole army. See cycleSquad. */
    this.selectedSquad = null;
    /* Its own stream off the run's number, exactly as the four in Waves.js. */
    if (this.seed !== null) seedCommand(this.seed ^ 0x6f4a1b3d);

    this._musterOpening();
  }

  /* ── the local commander, and the surface every existing caller uses ── */

  /**
   * THE COMMANDER THIS MACHINE IS PLAYING.
   *
   * Every reader that predates two armies — the HUD, the muster screen, the run
   * summary, twenty-six checks — asks the DIRECTOR for `roster`, `army`,
   * `formation`. All of them mean "mine", and all of them keep working because
   * these forward. That is deliberate rather than transitional: on a machine
   * there is one person holding the mouse, and "the army I am leading" is a
   * real thing to be able to ask for by name.
   */
  get commander() { return this.commanders[0]; }
  get roster() { return this.commander.roster; }
  get army() { return this.commander.army; }
  get foe() { return this.commander.foe; }
  get formation() { return this.commander.formation; }
  set formation(id) { this.commander.formation = id; }

  /**
   * ONE ROSTER PER SIDE-AND-ARMY — FLAGSHIP §9's headline, as one lookup.
   *
   * "Four players take four squads out of one roster of up to 24."
   *
   * The key is the pair and not either half of it. SIDE alone would put two
   * armies on one roll the day a mode fields allies of different factions;
   * ARMY alone would merge the two ends of a meeting, which is the one case
   * that must stay two rolls — a Republic line and a Confederate one are not
   * one another's reinforcements and their purses are not one purse.
   *
   * WHAT IT FIXES BY CONSTRUCTION, rather than by care:
   *
   *   THE DUPLICATE NAME. `designate` loops against `roster.taken` and the
   *     promise it is keeping is "every ally has a unique name you can see".
   *     With a Set per commander the promise held inside each army and not
   *     across the side, so two commanders drew the same `CT-8479` out of the
   *     one seeded stream. There is one Set now, so there is nothing to keep
   *     in step.
   *   THE PURSE. `roster.points` is one number, so "a Heavy for your squad or
   *     an ARC for mine" is a conversation at every muster instead of two
   *     people shopping in separate shops.
   *   THE ORPHAN. A commander who leaves has no army of his own to strand —
   *     see `dismissCommander`.
   */
  _rosterFor(side, army) {
    const key = `${side | 0}|${army?.id ?? 'none'}`;
    let r = this._rosters.get(key);
    if (!r) { r = new CommandRoster(army); this._rosters.set(key, r); }
    return r;
  }

  /** The commanders sharing one roster, in the order they joined it. */
  peersOn(roster) { return this.commanders.filter((c) => c.roster === roster); }

  /**
   * THE SQUADS ONE COMMANDER LEADS — the "four squads" half of §9.
   *
   * `CommandRoster.squads()` already slices the living list into fives and
   * `SQUAD` is already the unit; all this adds is WHO EACH SLICE ANSWERS TO.
   * Dealt round-robin rather than in blocks, and that is the property that
   * matters under permadeath: `squads()` is derived from the living list every
   * call, so as men fall the slices reshape and a round-robin deal keeps every
   * commander holding roughly the same share of what is left. A block deal
   * would empty the last commander first and then hand them nothing.
   *
   * IDENTICAL TO `roster.squads()` WHENEVER ONE COMMANDER HOLDS THE ROSTER —
   * which is every campaign, every skirmish, every contingent and both ends of
   * a two-player meeting. Nothing that existed before co-op changes shape.
   */
  squadsOf(c) {
    const all = c.roster.squads();
    const peers = this.peersOn(c.roster);
    if (peers.length <= 1) return all;
    const mine = Math.max(0, peers.indexOf(c));
    /* EMPTIED, NOT FILTERED. `squads()` is indexed by the squad NUMBER now —
     * see the note there — so removing entries would renumber every squad
     * below the one that went, which is the identity leak this file just
     * stopped having. A commander who does not have 2nd Squad sees 2nd Squad
     * empty, and 3rd Squad is still 3rd. */
    return all.map((sq, i) => (i % peers.length === mine ? sq : []));
  }

  /**
   * WHICH SQUAD THE NEXT ORDER IS FOR — null means the whole army.
   *
   * Cycled from the order wheel's TARGET slot. Walks 1st, 2nd, … and then back
   * to all, and clamps itself the moment the squad it named stops existing:
   * casualties merge the line, so a player who selected 4th Squad and then lost
   * it must not be left issuing orders into a number nobody answers to.
   */
  cycleSquad(cmdr = null) {
    const c = cmdr || this.commander;
    /**
     * ── A JOINING PLAYER CYCLES THE HOST'S COUNT ──────────────────────────
     *
     * `netShell` empties the roster by design — a client holds no men — so
     * `squadsOf` is `[]`, every squad is "not live", and the target slot could
     * never move off null. The wire carrying the squad index was inert:
     * measured, three presses and it still sent `s: null`.
     *
     * The one thing a client DOES have is the host's own `readout()`, which
     * carries the live squad count off `liveSquads`. So a client steps
     * `0 … n-1` and back to the line, exactly as the host does, and the index
     * it sends means the same thing at the other end because both sides read
     * the same number.
     */
    if (this._netShell) {
      const n = this.readout(c)?.squads | 0;
      if (n <= 1) { this.selectedSquad = null; this.onTarget?.(null, null); return null; }
      const cur = this.selectedSquad;
      this.selectedSquad = cur == null ? 0 : (cur + 1 >= n ? null : cur + 1);
      const k = this.selectedSquad;
      this.onTarget?.(k == null ? null : this.squadLabel(k, c), k);
      this.world?.notify?.(k == null ? 'THE WHOLE LINE' : `${this.squadLabel(k, c).toUpperCase()} HAS YOUR EAR`,
        k == null ? `${n} squads — the next order is for all of them`
          : 'the next order is theirs alone');
      return this.selectedSquad;
    }
    /* THE SQUADS THAT HAVE ANYBODY IN THEM — see `liveSquads`. A target slot
     * that stepped onto a wiped squad would be a selection nobody can answer. */
    const live = this.liveSquads(c);
    const n = live.length;
    if (n <= 1) {
      /* AND THE PANEL IS TOLD. This dropped the selection in silence, so a
       * player whose army fell to one squad kept reading "▸ Havoc" on the
       * order panel while every order went to the whole line. */
      const had = this.selectedSquad;
      this.selectedSquad = null;
      if (had != null && c === this.commander) this.onTarget?.(null, null);
      return null;
    }
    /* AND A SELECTION THAT HAS STOPPED EXISTING IS NOT A SELECTION. This
     * clamped only when the army was down to one squad, so a player who picked
     * 3rd Squad and then lost it kept a `selectedSquad` of 2 against two live
     * squads — and `order(id, c, 2)` then wrote a plant nobody reads, fired
     * `onOrder` so the HUD repainted as though it had landed, and did nothing
     * at all. An order that vanishes silently is worse than one that is
     * refused. */
    if (this.selectedSquad != null && !live.includes(this.selectedSquad)) {
      this.selectedSquad = null;
      if (c === this.commander) this.onTarget?.(null, null);
    }
    const cur = this.selectedSquad;
    const at = cur == null ? -1 : live.indexOf(cur);
    this.selectedSquad = at + 1 >= n ? null : live[at + 1];
    /**
     * …AND THE PLAYER IS TOLD WHO THEY ARE TALKING TO.
     *
     * "the troop management menu says 2 squads sometimes but for all intents
     *  and purposes it's just one squad."
     *
     * It was two squads and the selection was a field nobody printed: the
     * player pressed the target slot, `selectedSquad` moved from null to 0 to
     * 1 to null, and NOTHING on screen changed until an order was given —
     * which is a mode switch with no indicator, and is indistinguishable from
     * the control doing nothing. So the cycle says out loud who has the next
     * order, by the squad's own NAME where it has one, and how many men are in
     * it, which is the other half of "I should be able to view my squads".
     */
    if (c === this.commander) {
      const k = this.selectedSquad;
      /* …AND IT IS HELD ON SCREEN, not only announced. A toast fades in two
       * and a bit seconds; the selection does not, and a mode whose only
       * indicator has gone is a mode you lose track of. */
      this.onTarget?.(k == null ? null : this.squadLabel(k, c), k);
      if (k == null) {
        this.world?.notify?.('THE WHOLE LINE',
          `${n} ${c?.army?.squadWord?.toLowerCase() || 'squad'}s — the next order is `
          + 'for all of them');
      } else {
        const men = this.squadsOf(c)[k] || [];
        const lead = this.leaderOf(men);
        const alive = men.filter((t) => t.alive !== false).length;
        this.world?.notify?.(`${this.squadLabel(k, c).toUpperCase()} HAS YOUR EAR`,
          `${alive} ${alive === 1 ? 'man' : 'men'}`
          + `${lead ? `, ${lead.rankRec.title.toLowerCase()} ${lead.name}` : ''}`
          + ' — the next order is theirs alone');
      }
    }
    return this.selectedSquad;
  }

  /** The living trooper of yours standing closest to the commander's body. */
  nearestTrooper(cmdr = null) {
    const c = cmdr || this.commander;
    const from = this.world?.player?.position;
    if (!from) return null;
    let best = null, bestD = Infinity;
    for (const t of this.led(c)) {
      const b = t.body;
      if (!b || b.dead || !b.position) continue;
      const d = b.position.distanceToSquared(from);
      if (d < bestD) { bestD = d; best = t; }
    }
    return best;
  }

  /**
   * Pull the nearest man out of his squad, or send him back. Toggling, so the
   * same slot on the wheel is both halves of the request — "you should be able
   * to reverse it and put them back in with their squads".
   */
  detachNearest(cmdr = null) {
    const c = cmdr || this.commander;
    const t = this.nearestTrooper(c);
    if (!t) return null;
    const on = !t.detached;
    if (!c.roster?.detach?.(t, on)) return null;
    /* The selection is an INDEX into a list this has just reshaped, so it
     * cannot be trusted across the change. Back to the whole army, which is the
     * one target that is always valid — AND THE PANEL IS TOLD, or it goes on
     * naming a squad the next order will not go to. */
    const had = this.selectedSquad;
    this.selectedSquad = null;
    if (had != null && c === this.commander) this.onTarget?.(null, null);
    this.world?.notify?.(on ? 'DETACHED' : 'BACK IN LINE',
      on ? `${t.designation} takes his own orders` : `${t.designation} rejoins his squad`);
    return t;
  }

  /**
   * The formation a given squad is actually under.
   *
   * One reader, so a squad's own order and the army's cannot be answered
   * differently in two places. `key` is the squad's index in `squadsOf`, which
   * is what the HUD numbers and what `order(id, cmdr, key)` is given.
   */
  formationFor(c, key = null, t = null) {
    /**
     * ── AND A MAN WHO WAS NEVER TOLD IS STILL DOING THE LAST THING HE WAS ──
     *
     * `t.order` is the one place a refusal has any consequence. An order that
     * does not reach a man does not stop him soldiering; it leaves him under
     * the order he already had, which is what "the order did not land" means
     * on a field. `_ask` writes it onto the refusers and clears it on the men
     * who took the order, so it is only ever set on men who are OUT OF STEP
     * with their unit — and a company that has never refused anything reads
     * exactly as it did before this existed.
     *
     * FIRST, ahead of the squad's order and the army's, because it is the
     * narrowest statement about this particular man and the other two are
     * statements about a unit he did not hear addressed.
     */
    if (t && t.order && FORMATIONS[t.order]) return t.order;
    const own = key != null && c?.squadOrders?.get(String(key));
    return own || c?.formation || DEFAULT_FORMATION;
  }

  /**
   * ══ EVERY MOUTH THIS ORDER CAN COME OUT OF ════════════════════════════════
   *
   * You, plus every man licensed to RELAY who is standing close enough to have
   * heard you. Returned as circles — a position and a radius — because that is
   * all the reach test needs and it keeps the two radii (`ORDER_REACH` and
   * `RELAY_REACH`) attached to the mouths they belong to rather than branching
   * at the point of use.
   *
   * THE COMMANDER'S OWN POSITION IS `player ?? anchor`, which is exactly what
   * `_frame` reads and for the same reason: a Commander built loose in a check
   * and an AI commander in a meeting both have an anchor and no body, and a
   * reach test that returned nothing for them would silently refuse every
   * order the other army ever gave itself.
   *
   * ONE HOP. A relay is not itself a source for a further relay — see
   * `RELAY_REACH`. So this list is built in one pass off the commander and is
   * not iterated to a fixed point.
   */
  _voices(c) {
    /* THE RUNNER IS THE MOUTH WHILE HE IS SPEAKING. `_runnerTick` sets this
     * around the one `order()` call it makes, so the order he delivers reaches
     * from where HE is standing and not from where you are — which is the
     * whole point of having sent him, and the reason the delivery can still
     * fail to reach a man who has since walked further off. */
    const at = this._carrying?.position || c?.player?.position || c?.anchor || null;
    if (!at) return [];
    const out = [{ pos: at, r: ORDER_REACH, from: null }];
    const r2 = ORDER_REACH * ORDER_REACH;
    for (const t of this.led(c)) {
      if (t.alive === false || !holds(t, 'RELAYS')) continue;
      const e = t.body;
      if (!e || e.dead || !e.position) continue;
      if (e.position.distanceToSquared(at) > r2) continue;
      out.push({ pos: e.position, r: RELAY_REACH, from: t });
    }
    return out;
  }

  /** Whether any of those mouths reaches this man. Null body = not landed yet. */
  _inReach(t, voices) {
    const e = t?.body;
    if (!e || e.dead || !e.position) return true;
    for (const v of voices) {
      if (!v.pos) continue;
      if (e.position.distanceToSquared(v.pos) <= v.r * v.r) return true;
    }
    return false;
  }

  /**
   * ══ ASK THESE MEN TO DO THIS — and get a reason for every one who will not ═
   *
   * The whole of PHASE 2's compliance rule, in one place, so an order given by
   * a key, by the wheel and over the wire is refused identically. It answers
   * `{ took, refused }` and WRITES NOTHING: `order()` decides what to do with
   * the answer, which is what lets a check ask the question without moving the
   * army.
   *
   * ── THE FOUR TERMS, IN THE ORDER THEY ARE ASKED ──────────────────────────
   *
   * OUT OF REACH first, because it is the only one that is about the order
   *   rather than about the man, and because a man who never heard it cannot
   *   be said to have been frightened of it. `F.always` skips this and only
   *   this — see `circle`.
   *
   * UNLED next, and it is the squad's refusal rather than any man's. "An
   *   unsupervised hold needs `HOLDS`" — a standing order plants a squad on
   *   ground and walks away from it, and a squad with nobody in it licensed to
   *   keep that ground is a squad that will not be there when you get back.
   *   Only for a per-squad order, only for a non-advancing one: the army's
   *   order is given with you standing in it, and an advance is not a post.
   *
   * SHAKEN and ALONE last and only against an ADVANCE, for the reason
   *   `SHAKEN_AT` gives: fear and isolation stop a man walking toward the
   *   muzzle, and neither has ever stopped anybody getting behind a rock.
   *
   * NO DICE. Every term is a threshold on a number the game already keeps, so
   * the same company on the same ground refuses the same order twice — which
   * is what makes a refusal a thing the player can DO something about instead
   * of a thing that happens to them.
   */
  _ask(F, c, men, squadKey = null) {
    const took = [];
    const refused = [];
    if (!F || !c) return { took: men ? [...men] : [], refused };
    const voices = this._voices(c);
    /* NO BODY, NO DISTANCE. An AI commander in a meeting and a Commander built
     * loose in a check both have no player and may have no anchor either, and
     * reach is a distance FROM SOMETHING. Measuring it from nowhere would
     * refuse every order the other army ever gave itself and stop the enemy
     * line forming up at all — a rule firing hardest on the one commander the
     * player cannot see is the worst possible failure of a visible mechanic. */
    if (!voices.length) return { took: men.filter((t) => t.alive !== false), refused };
    /* THE SQUAD'S OWN TEST, ANSWERED ONCE — see `_supervised`. */
    const unled = squadKey != null && !F.advance && !this._supervised(c, men);
    for (const t of men) {
      if (t.alive === false) continue;
      const e = t.body;
      if (!F.always && !this._inReach(t, voices)) { refused.push({ t, why: 'out of reach' }); continue; }
      if (unled) { refused.push({ t, why: 'unled' }); continue; }
      if (F.advance && e && !e.dead) {
        if (braveryOf(e) < SHAKEN_AT) { refused.push({ t, why: 'shaken' }); continue; }
        if (!this._friendNear(e, c)) { refused.push({ t, why: 'alone' }); continue; }
      }
      took.push(t);
    }
    return { took, refused };
  }

  /**
   * ══ DID IT LAND — and what the men who did not take it are doing instead ═══
   *
   * NOT `_landed`, which is already a field on this director meaning "the army
   * has arrived on this ground" — the two words collide and the collision was
   * silent: an instance field shadows a prototype method, so `order()` threw
   * `this._landed is not a function` the first time an army was asked anything.
   *
   * Called from `order()` between deciding who was asked and writing anything,
   * because both halves of the answer are needed there: a refusal has to abort
   * the write, and a PARTIAL refusal has to pin the refusers to what they were
   * doing a moment ago, which is only knowable before the new order is stored.
   *
   * ── NOBODY TOOK IT: THE ORDER DOES NOT EXIST ─────────────────────────────
   *
   * `order()` returns false and nothing is written — no `c.formation`, no
   * `squadOrders`, no plant, no `_coverEpoch`. That matters more than it
   * looks: a HUD that lit "Take cover" over a line that never heard it is the
   * exact failure the per-squad branch was already fixed for, and this is the
   * same class of lie at a different range.
   *
   * ── SOME TOOK IT: THE REST KEEP WHAT THEY HAD ────────────────────────────
   *
   * `t.order` is the man's own standing order and `formationFor` reads it
   * first. Set on the refusers, CLEARED on the takers — clearing is the half
   * that is easy to miss and it is what stops a refusal being permanent: a man
   * who refused a charge at forty metres and is then reached again, or who is
   * next given an order he will take, is back in step with his unit and stops
   * carrying a private one.
   *
   * ── AND THE WINDOW OPENS ─────────────────────────────────────────────────
   *
   * Anything refused for distance arms the runner (`RUNNER_WINDOW`). The same
   * order again, at the same unit, inside six seconds, sends a man with it.
   */
  _takeUp(ask, F, c, id, squad, total) {
    const line = this._refusalLine(ask.refused, total);
    const mine = c === this.commander;
    /* WHAT THEY WERE DOING, TAKEN NOW. After `order()` writes, this question
     * has a different answer for every man on the roll. */
    const before = new Map();
    for (const r of ask.refused) {
      before.set(r.t, this.formationFor(c, this._squadKeyOf(r.t, c), r.t));
    }
    /**
     * ── AND IT IS NOT `this.refused` ──────────────────────────────────────
     *
     * `refused` is the MUSTER's channel — `recruit`, `road` and the contingent
     * composer all write it and `main.js` hands it to the muster screen beside
     * `musterOffer()` three times. An order refusal written there would put
     * "Line abreast — 3 men — out of reach" on a screen about which unit to
     * buy, on the frame the player opened it. Two different refusals, two
     * fields, and the collision is the reason this one is named.
     */
    if (line) {
      this.log.push({ t: 'refused', formation: id, why: line.why, n: line.all,
                      squad: squad == null ? null : Number(squad) | 0,
                      area: this.areaNumber, wave: this.wave });
      /* THE WINDOW IS ARMED ON DISTANCE AND ON NOTHING ELSE. A runner carries
       * an order to men who did not hear it; he cannot carry courage. */
      /* ON THE COMMANDER AND NOT ON THE DIRECTOR, because a director holds
       * every commander in the session. A window on `this` would let a joining
       * player's refused order arm the host's next press, and would give a
       * joining player no window of their own — so the one player who most
       * needs a runner (their line is wherever the host's is not) is the one
       * who could never send one. The notify below is still the local screen's
       * and stays gated on the player's own commander. */
      if (line.why === 'out of reach') {
        c._pending = { id, squad: squad == null ? null : Number(squad) | 0,
                       at: this.world?.time || 0 };
      }
    }
    if (!ask.took.length) {
      this.orderRefused = line
        ? `${F.name} — ${line.text}`
        : `${F.name} — nobody left to take it`;
      if (mine) {
        this.world?.notify?.('NOT TAKEN', this.orderRefused
          + (line?.why === 'out of reach' ? '. Press it again to send a runner.' : ''));
      }
      return false;
    }
    for (const t of ask.took) t.order = null;
    for (const r of ask.refused) r.t.order = before.get(r.t) || null;
    if (line && mine) {
      this.orderRefused = `${F.name} — ${line.text}`;
      this.world?.notify?.(`${ask.took.length} OF ${total} TOOK IT`, this.orderRefused
        + (line.why === 'out of reach' ? '. Press it again to send a runner.' : ''));
    } else if (mine) {
      this.orderRefused = null;
    }
    return true;
  }

  /**
   * ══ SEND A MAN WITH IT ═════════════════════════════════════════════════════
   *
   * "Press the same order again inside a short window and a named man leaves
   * the line to CARRY it. He can be killed on the way, and then the order dies
   * with him and the log says so."
   *
   * WHY THIS IS THE ANSWER TO REACH AND NOT A WAY ROUND IT. A reach rule with
   * no remedy is a rule that tells the player their button is broken; a remedy
   * that always works is the old bug. A runner is the third thing: it works,
   * it takes time, and it can fail — and when it fails it fails as a NAME,
   * which is the mode's whole subject. The cost of talking to a squad you sent
   * away is a man out of the line for the length of the crossing and, some of
   * the time, that man.
   *
   * WHO GOES, and the rule is the one a company would use: the JUNIOREST man
   * who heard the order, and never the squad's leader. You do not send your
   * sergeant with a message — his squad is what he is for, and `leaderOf` is
   * derived so this is the same man `onDeath` announces a succession for.
   * Among equals the nearest to where he is going, so the crossing is the
   * shortest one available.
   *
   * WHERE HE GOES is the centroid of the men who did not hear it. Not one
   * man's position: he is carrying it to a UNIT, and `RUNNER_DELIVER` is wide
   * enough that arriving at the middle of a squad is arriving at the squad.
   */
  _sendRunner(id, squad, c) {
    const F = FORMATIONS[id];
    if (!F || !c) return false;
    const men = squad == null
      ? this.led(c).filter((t) => t.alive !== false)
      : (this.squadsOf(c)[Number(squad) | 0] || []);
    if (!men.length) return false;
    const ask = this._ask(F, c, men, squad);
    const deaf = ask.refused.filter((r) => r.why === 'out of reach' && r.t.body && !r.t.body.dead);
    if (!deaf.length) return false;
    let x = 0, z = 0;
    for (const r of deaf) { x += r.t.body.position.x; z += r.t.body.position.z; }
    const to = { x: x / deaf.length, z: z / deaf.length };
    /* HE IS DRAWN FROM THE WHOLE ARMY AND NOT FROM THE SQUAD BEING SENT TO,
     * because the squad being sent to is the one that cannot hear you. Anybody
     * of yours who DID hear can carry it. */
    /* THE VOICES ONCE, not once per man. `_voices` walks the whole roll to find
     * the licensed relays in it, so asking it inside this loop made choosing a
     * runner quadratic in the size of the company — 576 passes at
     * `MAX_STRENGTH`, on a frame the player is already being told something. */
    const voices = this._voices(c);
    const pool = [];
    for (const t of this.led(c)) {
      if (t.alive === false || t.runner) continue;
      const e = t.body;
      if (!e || e.dead) continue;
      if (!this._inReach(t, voices)) continue;
      if (this.leaderOf(this.squadOf(t, c)) === t) continue;
      pool.push(t);
    }
    if (!pool.length) return false;
    pool.sort((a, b) => (a.rank | 0) - (b.rank | 0)
      || (Math.hypot(a.body.position.x - to.x, a.body.position.z - to.z)
        - Math.hypot(b.body.position.x - to.x, b.body.position.z - to.z)));
    const man = pool[0];
    man.runner = { id, squad: squad == null ? null : Number(squad) | 0, to,
                   until: (this.world?.time || 0) + RUNNER_LIFE };
    /* HIS OWN ORDER GOES WITH HIM. `formationFor` reads `t.order` first, so a
     * runner pinned to whatever he was doing keeps his slot solved in the
     * right frame the moment he arrives and stops running — and `slotFor`'s
     * runner branch is what overrides it in the meantime. */
    this.log.push({ t: 'runner', name: man.name, formation: id,
                    squad: squad == null ? null : Number(squad) | 0, n: deaf.length,
                    area: this.areaNumber, wave: this.wave });
    if (c === this.commander) {
      this.world?.notify?.('RUNNER AWAY',
        `${man.rankRec.title.toLowerCase()} ${man.name} is carrying ${F.name.toLowerCase()} to `
        + `${squad == null ? 'the line' : this.squadLabel(Number(squad) | 0, c).toLowerCase()} `
        + `— ${deaf.length} ${deaf.length === 1 ? 'man' : 'men'} who never heard you`);
    }
    /* WHEN, so a caller that also prints a line about the order can tell that
     * what just happened was a DISPATCH and not the order landing. `main.js`
     * reads it either side of its `order()` call: without it the key loop
     * would print "CHARGE — 2nd Squad" over a squad that is still standing
     * where it was, with a runner halfway there. */
    this.runnerAt = this.world?.time ?? 0;
    this.onRunner?.(man, F, squad);
    return true;
  }

  /**
   * HE ARRIVES, HE RUNS OUT OF TIME, OR HE IS KILLED — stepped once a frame in
   * the loop that already touches every living body once a frame.
   *
   * ARRIVAL IS A DISTANCE AND NOT A TIMER, so a runner shot in the leg and
   * limping still delivers if he gets there, and one who is pinned behind a
   * rock for twenty seconds does not. `RUNNER_DELIVER` is measured from the
   * point he was sent to rather than from any man, for the reason
   * `_sendRunner` gives: he is carrying it to a unit.
   *
   * ON ARRIVAL THE ORDER IS GIVEN AGAIN, THROUGH `order()`, from where he is
   * standing — `_carrying` makes his own body the mouth for that one call, so
   * the men around him hear it and men fifty metres past them still do not.
   * That is the honest version: he delivered it where he arrived. Giving it a
   * private write into `squadOrders` would be a second door into the thing
   * this whole phase exists to put one door on.
   */
  _runnerTick(t, dt) {
    const R = t.runner;
    const e = t.body;
    if (!R) return;
    if (!e || e.dead) { t.runner = null; return; }
    const now = this.world?.time || 0;
    const d = Math.hypot(e.position.x - R.to.x, e.position.z - R.to.z);
    if (d <= RUNNER_DELIVER) {
      t.runner = null;
      const c = this.commanderOf(e) || this.commander;
      this._carrying = e;
      let ok = false;
      try { ok = this.order(R.id, c, R.squad); } finally { this._carrying = null; }
      if (c === this.commander) {
        const F = FORMATIONS[R.id];
        this.world?.notify?.(ok ? 'ORDER DELIVERED' : 'HE GOT THERE AND THEY WOULD NOT',
          `${t.name} — ${F ? F.name.toLowerCase() : R.id}`
          + (ok ? '' : `, ${this.orderRefused || 'refused'}`));
      }
      this.log.push({ t: 'delivered', name: t.name, formation: R.id, ok,
                      squad: R.squad, area: this.areaNumber, wave: this.wave });
      return;
    }
    if (now >= R.until) {
      t.runner = null;
      if (this.commanderOf(e) === this.commander) {
        this.world?.notify?.('HE NEVER GOT THERE',
          `${t.name} turned back — the order is dead`);
      }
      this.log.push({ t: 'lostorder', name: t.name, formation: R.id, why: 'time',
                      squad: R.squad, area: this.areaNumber, wave: this.wave });
    }
  }

  /**
   * ══ IS ANYBODY IN CHARGE OF THIS POST ══════════════════════════════════════
   *
   * The licence half of PHASE 2, and it applies to exactly one thing: a
   * PER-SQUAD order that does not advance. `cover` and `digin` are the only
   * two in the table, and both of them mean *hold this piece of ground* — an
   * order that writes `squadPlanted`, gives the squad its own frame and lets
   * the general walk away from it. That is a POST, and `RANKS[2].licence` is
   * the sentence this enforces: "May be given a squad's post — he leads it
   * whatever the roll would have said."
   *
   * TWO WAYS TO SATISFY IT, and having two is what stops the rule being a wall
   * on a fresh company. A muster deals TEN TROOPERS AT RANK 0 — measured — so
   * a licence-only test would make delegation unreachable until the first
   * promotion, on a mechanic the player was specifically told they had.
   *
   *   A MAN WHO CAN BE LEFT — anybody still standing in the squad licensed to
   *     LEAD. This is what a promotion buys, and it is the only version that
   *     lets you actually leave.
   *
   *   OR YOU, STANDING THERE. Supervision is a fact about the ground, not a
   *     rank: a general inside `RELAY_REACH` of the squad's own centre is the
   *     supervision. So the fresh company's answer to "they will not hold this
   *     on their own" is to go and hold it with them — which costs the thing
   *     the mode is about, your attention, and is a real choice rather than a
   *     locked button.
   *
   * The centroid rather than any one man, for the same reason `_sendRunner`
   * uses one: the order is to a unit.
   */
  _supervised(c, men) {
    const live = men.filter((t) => t.alive !== false && t.body && !t.body.dead);
    if (!live.length) return false;
    if (live.some((t) => holds(t, 'LEADS'))) return true;
    const at = c?.player?.position || c?.anchor;
    if (!at) return true;
    let x = 0, z = 0;
    for (const t of live) { x += t.body.position.x; z += t.body.position.z; }
    x /= live.length; z /= live.length;
    return Math.hypot(at.x - x, at.z - z) <= RELAY_REACH;
  }

  /** Anybody of his own still standing inside `ALONE_NEAR` — his commander counts. */
  _friendNear(e, c) {
    const at = c?.player?.position || c?.anchor;
    const r2 = ALONE_NEAR * ALONE_NEAR;
    if (at && e.position.distanceToSquared(at) <= r2) return true;
    for (const o of (this.world?.enemies || [])) {
      if (o === e || o.dead || o.team !== e.team) continue;
      if (o.position.distanceToSquared(e.position) <= r2) return true;
    }
    return false;
  }

  /**
   * WHAT TO SAY ABOUT A REFUSAL — the largest group and the term that failed.
   *
   * One sentence, because four reasons printed at once is a paragraph nobody
   * reads mid-fight, and the largest group is the one that explains why the
   * order looked like it did nothing.
   */
  _refusalLine(refused, total) {
    if (!refused.length) return null;
    const by = new Map();
    for (const r of refused) by.set(r.why, (by.get(r.why) | 0) + 1);
    let why = null, n = 0;
    for (const [k, v] of by) if (v > n) { why = k; n = v; }
    const who = n === 1 ? (refused.find((r) => r.why === why)?.t?.name || 'one man') : `${n} men`;
    return { why, n, text: `${who} — ${why}`, all: refused.length, total };
  }

  /** Everything this commander leads, flat — his squads' troopers in order. */
  led(c) {
    if (!c) return [];
    const peers = this.peersOn(c.roster);
    if (peers.length <= 1) return c.roster.living;
    const out = [];
    for (const sq of this.squadsOf(c)) for (const t of sq) out.push(t);
    return out;
  }

  /**
   * A COMMANDER HAS LEFT THE SESSION — §9's second defect, and it was live.
   *
   * "`peer-left` removes the RemoteAvatar and nothing removes its `Commander`,
   * so its army goes on being steered off a disposed body."
   *
   * `main.js` disposes the avatar and splices it out of `world.players`, and
   * the Commander went on sitting in `this.commanders`: `_troops` solved a
   * formation in its frame every frame, `_trackLeader` measured the pace of a
   * body nothing updates any more, and ten men held a slot relative to a
   * corpse of a drawing. `census` had a guard against the one visible
   * consequence — a departed general's army could WIN the match — and that
   * guard is the shape of the bug rather than the fix.
   *
   * WHAT HAPPENS TO THE MEN IS THE WHOLE QUESTION, and one roster answers it:
   *
   *   IF SOMEBODY IS STILL ON THAT ROSTER, nothing happens to them at all.
   *     `squadsOf` re-deals on the next call, so the squads the departed player
   *     was leading are held by the players who are left, on the frame after
   *     the tab closed. That is co-op's answer and it needs no code here.
   *   IF NOBODY IS, the army has no commander. It is recalled — taken off the
   *     field the way an area boundary takes it off — rather than left
   *     wandering, and the SIDE IS REMEMBERED as departed so `census` can go on
   *     reporting it at zero. That distinction is `census`' own and it is
   *     load-bearing: a side that has been beaten ends a round and a side that
   *     was never there does not.
   *
   * NEVER THE LOCAL COMMANDER. `commanders[0]` is the person holding the mouse
   * on this machine and every reader that predates two armies forwards to it;
   * removing it would leave `this.roster` undefined for the whole front end.
   *
   * @returns the Commander that was dismissed, or null.
   */
  dismissCommander(player) {
    if (!player) return null;
    const i = this.commanders.findIndex((c) => c.player === player);
    if (i <= 0) return null;
    const c = this.commanders[i];
    this.commanders.splice(i, 1);
    c.player = null;
    const peers = this.peersOn(c.roster);
    if (!peers.length) {
      /* Nobody left to lead them. Off the field through the one door that
       * takes an army off it, and the side stays in the census at zero. */
      this._departed.add(c.side);
      this.recall(c);
    } else {
      /* THE BODIES CHANGE HANDS. `e.cmdr` is what `commanderOf` answers with —
       * a death routes through it to find the roll the name is on — so a body
       * still pointing at a dismissed Commander would report its casualty to
       * an object nothing else can reach. The record's new commander is
       * whichever peer `squadsOf` has just dealt it to. */
      this._reseat(c.roster);
    }
    return c;
  }

  /**
   * A SECOND PERSON WITH AN ARMY.
   *
   * The one call that turns a campaign into a meeting — and, since §9, the one
   * call that seats a second player on the SAME side. Idempotent per player,
   * because a session announces its roster more than once and two Commanders
   * for one body would be two commanders deploying into the same slots.
   */
  enlistCommander(opts = {}) {
    const found = opts.player && this.commanders.find((c) => c.player === opts.player);
    if (found) return found;
    /*
     * A MEETING OPENS ON AN ORDER THAT ADVANCES, and it did not.
     *
     * `DEFAULT_FORMATION` is `behind`, which is the right opening for the
     * CAMPAIGN — the army arrived with you, you are the point of the spear, and
     * a column that walks where you walk is what a player expects to start
     * with. A meeting is the opposite shape: two commanders 120 m apart, each
     * with ten bodies leashed to a body that is standing still. Every formation
     * but one is solved in its commander's own frame, so if neither commander
     * walks, neither army does.
     *
     * Measured on a real host/client pair with the default order and both
     * commanders idle: 124 seconds, `10 v 10 -> 10 v 10`, the lines closed from
     * 120 m to 111 m, and the match ended a DRAW ON THE CLOCK. A meeting is one
     * 120-second round, so that was the whole session. Nothing advances an army
     * on its own and nothing tells the player to press the charge key — so the
     * mode's first impression was that it does not work.
     *
     * `charge` is the one order with `leash: Infinity` and no slot: it sends
     * bodies to find something rather than to stand somewhere relative to a
     * commander. Ordered on both sides, the same pair reads `9v9 -> 0v7` with
     * casualties off both name lists and a winner both machines agree on.
     *
     * Only if the host has not already given an order of their own — this is
     * the opening state, not an override. And through `order()` rather than by
     * assignment, so the planting, the log entry and the HUD indicator all
     * happen the way they do for a key press.
     */
    const meeting = this.commanders.length === 1;
    if (meeting && this.commander.formation === DEFAULT_FORMATION) {
      this.order(MEETING_FORMATION, this.commander);
    }
    /**
     * THE ROSTER IS THE DIRECTOR'S, NOT THE COMMANDER'S — §9.
     *
     * Looked up by side and army, so a second commander on the SAME side joins
     * the roll that is already there and one on the other side gets his own.
     * The side and the army have to be known HERE rather than assigned after
     * the fact, which is what `formUp` used to do: it built the commander with
     * the defaults, `_musterOpening` enlisted ten Republic troopers into a
     * Republic roster, and only then was `c.army` reassigned to the
     * Confederacy — so the second army of every meeting was ten clone troopers
     * wearing the other side's name. See `formUp`, which passes both now.
     */
    const side = opts.side ?? this.commander.side;
    const army = opts.army || this.commander.army;
    const roster = opts.roster || this._rosterFor(side, army);
    const c = new Commander(this, { formation: this.commander.formation, ...opts, side, army, roster });
    this.commanders.push(c);
    /**
     * The same ten strangers everybody starts with. Through the same call, so
     * there is no second idea anywhere of what an opening army is.
     *
     * ONLY IF THE ROLL IS EMPTY. Four players on one side share ONE roster of
     * up to 24 and take a squad each — mustering ten more for every joiner
     * would be four private armies again, with the shared purse spent four
     * times over and `MAX_STRENGTH` reached by the third player.
     */
    if (opts.muster !== false && !roster.all.length) this._musterOpening(c);
    else if (opts.muster !== false) this._musterJoin(c);
    else if (!c.lineup) c.lineup = this.commander.lineup;
    /* THE BODIES ALREADY ON THE FIELD CHANGE HANDS. A player joining a line
     * that is already standing takes squads that already have bodies in them,
     * and `e.cmdr` — what `commanderOf` answers with — was stamped at enlist
     * time. Re-dealt here rather than every frame: `_troops` re-solves the
     * indices off `squadsOf` sixty times a second and does not read this. */
    this._reseat(roster);
    return c;
  }

  /**
   * A PLAYER JOINS A LINE THAT IS ALREADY STANDING — one squad more.
   *
   * §9: "Four players take four squads out of one roster of up to 24." The two
   * ends of that sentence are `SQUAD` and `MAX_STRENGTH`, both of which already
   * exist, and the rule between them is the only thing this adds: **the line
   * opens at `OPENING_STRENGTH` and grows by one squad for every commander
   * beyond the first.** One player marches in with ten (two squads); a fourth
   * arrives to twenty-five asked for and twenty-four allowed, which is the cap
   * §9 quotes and `recruit`'s own refusal rather than a second bound written
   * here.
   *
   * The alternatives were both worse and both were tried. Mustering NOTHING
   * for a joiner splits ten men four ways and hands the third and fourth
   * players nothing at all — measured on a 2v2, 5/5/5/5 bodies where the mode
   * fields ten a side. Mustering a full opening EACH is four private armies
   * again, which is the arrangement §9 exists to delete.
   *
   * FREE, like the opening ten, and for the same reason: `_musterOpening`'s own
   * note says the roll at the top of a campaign is "ten identical strangers"
   * handed to you rather than bought, because the composition is what the purse
   * between areas is FOR. A player joining is more strangers, not a purchase —
   * and charging the shared purse for them would take the first muster's
   * decision away from everybody at the table.
   *
   * Through `roster.enlist`, which is where a designation comes from, so the
   * new squad is named out of the same `taken` set as the rest of the roll.
   */
  _musterJoin(c) {
    /**
     * …AND IN A MEETING A JOINER BRINGS NOBODY.
     *
     * §9's rule — the line opens at `OPENING_STRENGTH` and grows by one squad
     * for every commander beyond the first — is exactly right for co-op
     * Command, where every player is on the same side and a bigger table should
     * field a bigger company. It is exactly wrong for a battle BETWEEN sides,
     * and three players is where that shows: two allies against one commander
     * came out 15 against 10, which is the pair outnumbering the lone player by
     * half again on top of being two people.
     *
     * So the side brings what the host said it brings and an ally takes a squad
     * out of it. `_reseat`, which the caller runs next, is what actually deals
     * the existing bodies to the new commander — this method never had to put
     * men on the field for a joiner to have some, only to add them.
     */
    if (this.versus && this.sideStrength > 0) {
      c.lineup = c.roster.living.map((t) => t.type);
      return 0;
    }
    const cheapest = c.army.tiers[0].type;
    let n = 0;
    for (let i = 0; i < SQUAD && c.roster.strength < MAX_STRENGTH; i++) {
      c.roster.enlist(cheapest, { joined: this.areaNumber });
      n++;
    }
    /* The SHAPE the line is kept at — `_reinforce` reads it to decide what a
     * replacement should be. It is the roster's, so it grows with the roster. */
    c.lineup = c.roster.living.map((t) => t.type);
    for (const p of this.peersOn(c.roster)) p.lineup = c.lineup;
    /* The squad a joining player brings is enlisted here and nowhere else, so
     * this is the only place their names can reach the ledger. See `_logRoll`. */
    this._logRoll(c);
    return n;
  }

  /** Point every body on a roster at whichever peer `squadsOf` now deals it to. */
  _reseat(roster) {
    for (const p of this.peersOn(roster)) for (const t of this.led(p)) if (t.body) t.body.cmdr = p;
  }

  /** Whoever commands this body — its own commander, or mine if it has none. */
  commanderOf(e) { return (e && e.cmdr) || this.commander; }

  /* ── the campaign ──────────────────────────────────────────────────── */

  get area() { return this.stages[Math.min(this.areaIndex, this.stages.length - 1)]; }
  get areaNumber() { return this.areaIndex + 1; }
  get lastArea() { return this.areaIndex >= this.stages.length - 1; }

  /**
   * WHICH RUNG OF THE FULL LADDER THE GROUND YOU ARE STANDING ON IS.
   *
   * `areaNumber` is how many engagements in you are and `rung.at` is a position
   * in `AREAS` — the same number for a Grind and two different numbers for
   * anything shorter. A Raid crosses the landing zone and the Core Ship, so its
   * second engagement is `areaNumber` 2 and ladder rung 5: gating the shelf on
   * the count would sell you a marksman on the ground the walkers are on, which
   * is the off-by-one AREAS' own note describes arriving from the other side.
   *
   * The GROUND earns the rung, not the counter. Identical to `areaNumber`
   * whenever `stages` is `AREAS`, which is a Grind, a skirmish, a campaign and
   * a contingent — every caller that existed before the length was rolled.
   */
  get areaRung() { const i = AREAS.indexOf(this.area); return i < 0 ? this.areaNumber : i + 1; }

  /**
   * HOW MUCH GROUND IS BEHIND YOU — the "Areas taken" row of the victory card.
   *
   * `areaNumber` is where you ARE and is one ahead of what you have taken for
   * the whole of every area; reporting it on the card would credit a campaign
   * abandoned in area three with three areas. So this counts the boundaries
   * actually crossed, off the ledger `_areaClear` writes as it crosses them —
   * a derived count rather than a second tally kept beside the first (§2.3).
   * The last area logs its entry before `_endCampaign` runs, so a won crossing
   * reports all five.
   */
  get areasTaken() { return this.log.reduce((n, e) => n + (e.t === 'area' ? 1 : 0), 0); }

  /**
   * ONE SIDE'S POOL, OUT OF THE LEVEL'S TWO.
   *
   * The Geonosis level names BOTH armies in its pool, because the level is a
   * battle between them and a wave mode dropped into the middle of it should
   * meet both. In Command you are one of them, so the fill is filtered to the
   * other — and this is the ONLY override of the composer in the whole mode.
   *
   * ── AND IT IS FILTERED BY FACTION, NOT BY THE MUSTER LADDER ──────────────
   *
   * It used to be `new Set(this.army.tiers.map(t => t.type))` — the seven rungs
   * you can BUY — which is a different set from the bodies that belong to your
   * side, and the difference is exactly the bug the player reported in note 1.2
   * ("when you're playing as the republic you shouldnt be fighting against
   * things that are canonically on your side"). `Waves.sideFor` is the base
   * class's answer to that and this class declines it (see `sideFor` directly
   * below), so on a contingent world the ladder filter was the ONLY thing
   * standing between the player and their own hardware.
   *
   * Measured through the shipped `unlockedAt`, twenty waves on each of the
   * seven grounds, before this line changed:
   *
   *     allies 0 · jedi   0 own-army bodies fielded against you   (19 kinds)
   *     allies 0 · sith   0                                       (15 kinds)
   *     allies 6 · jedi   0                                       (19 kinds)
   *     allies 6 · sith  10 — acolyte on five grounds, walker on
   *                          three, dwarfspider and hailfire on
   *                          Geonosis                             (19 kinds)
   *
   * Turning allies on is what broke it: a Sith with a contingent met their own
   * Confederacy on six of seven grounds, and the same player with the same
   * order and the slider at zero met none of it. `acolyte`, `walker`,
   * `dwarfspider` and `hailfire` are Confederate bodies that are not rungs of
   * the muster ladder, so the ladder filter could not see them. The Republic
   * escaped only by luck of authoring — its two pool bodies on those levels
   * happen to be `trooper` and `heavy`, which ARE rungs.
   *
   * `factionOf` is the same one statement `Waves.unlockedAt` and
   * `Databank.armyForOrder` read, so a body's side is declared once and the
   * enemy fill follows it — which is what the note above was reaching for when
   * it said the fix is always this one. It is stricter than the old rule in
   * every case (a rung is a body of its faction), so nothing that was filtered
   * before is admitted now.
   *
   * A FILTER NEVER EMPTIES THE FIELD — `Waves._shapeUnder`'s law — AND IT MUST
   * NOT FALL BACK ONTO YOUR OWN MEN, which is `Waves.unlockedAt`'s own second
   * clause and is exactly the mistake the first cut of this made. Measured: a
   * Jedi leading a Confederate contingent on the Wood, where the ladder has
   * opened one rung at wave 1, filtered to nothing and the fallback handed back
   * the unfiltered set — the player's own battle droids charging the player, on
   * the opening wave.
   *
   * So the fallback WIDENS THE DEPTH rather than dropping the rule, in the same
   * words and for the same reason the base class states them: the whole pool is
   * searched for anything that is not yours and the lightest of those by threat
   * is fielded. A body arriving a wave or two before the ladder meant it is a
   * smaller wrong than an army fighting itself, and it is bounded by the pool
   * the level authored. Only a level whose ENTIRE pool is one army reaches the
   * last line, which is an authoring error rather than a runtime one, and
   * `factions.mjs` asserts there is no such level.
   */
  unlockedAt(wave) {
    const mine = this.army.id;
    const open = super.unlockedAt(wave);
    const theirs = open.filter((t) => factionOf(t) !== mine);
    if (theirs.length) return theirs;
    const anywhere = [...new Set(this.pool.filter((t) => factionOf(t) !== mine))];
    if (!anywhere.length) return open;
    anywhere.sort((a, b) => (ARCHETYPES[a]?.threat ?? 9) - (ARCHETYPES[b]?.threat ?? 9));
    return [anywhere[0]];
  }

  /**
   * …AND THIS DIRECTOR NEVER ALTERNATES THE LEVEL'S TWO ARMIES, because the
   * method directly above has already answered the question once.
   *
   * `WaveDirector.sideFor` gives one wave to each army in turn on a level that
   * declares two, and its own note says what a second answer costs here: this
   * class's `unlockedAt` has already narrowed the pool to the army you are NOT
   * leading, so a wave the rotation hands to YOUR side comes back empty.
   *
   * It was spelled `this.mode === 'command'` inside `sideFor`, in Waves.js —
   * which is the whole reason the constructor above used to hard-code the mode
   * string, and therefore the reason a skirmish reported itself as a campaign.
   * A rule about THIS CLASS written as a test on one of the three mode strings
   * the class runs under is a rule that breaks when a fourth arrives. It is an
   * override now: the subclass that filters the pool is the subclass that
   * declines the rotation, and the mode string is free to be true.
   *
   * Measured on Geonosis (`armies: ['republic','separatist']`), all three
   * modes, waves 1-4: `sideFor` null throughout and `unlockedAt(6)` 10 types,
   * identical before and after — the behaviour is unchanged, only where it is
   * stated has moved.
   */
  sideFor() { return null; }

  /**
   * THE AREA'S OWN PRESSURE, ON TOP OF THE WAVE'S.
   *
   * Two multipliers, and they compose with the ramp rather than replacing it:
   * the area's `budget` (0.75 at the landing zone, 1.45 at the core ship) and
   * the strength of the army standing beside you. The second is the one that
   * matters — ten troopers is not a cosmetic, it is roughly a second and third
   * blade, and a wave composed as though you were alone is a wave you walk
   * through. `partyScale` already exists for exactly this question and already
   * knows how to answer it super-linearly; allies are counted into it at a
   * discount because a trooper is not a Jedi.
   */
  budgetFor(wave) {
    /* THE AREA'S PRESSURE IS THE CAMPAIGN'S. A contingent is dropped into a
     * mode whose own ramp is already the escalation — charging it the Core
     * Ship's 1.45 as well would be two curves multiplied. `allyScale` is NOT
     * conditional: the wave is priced against the army standing in it wherever
     * that army came from, which is the whole reason allies do not trivialise
     * a mode that never had them. */
    const area = this.campaign ? this.area.budget : 1;
    return Math.floor(super.budgetFor(this.rampWave(wave)) * area * this.allyScale());
  }

  /**
   * ══ WHICH WAVE OF THE ADVANCE THIS IS, AND IT IS NOT THE RUN'S COUNTER ══
   *
   * **A fresh ten-man line was wiped out in one wave at engagement 3.** 0 of 10
   * on five seeds and on twenty, in about 110 seconds, before and after every
   * attrition constant this mode has been tuned with — and tuning engagement 1
   * cannot reach it, because what is wrong is not a constant. It is this line.
   *
   * `WaveDirector.budgetFor` is `4 + 2.6w + 0.65 · w^1.62`, and `w` was the
   * RUN's wave counter. That curve is the roguelite's, and it is honest there
   * for a stated reason: the Trial of Waves drafts a card every other wave, so
   * a player at wave 8 is a different player from the one at wave 1 and the
   * wave has to grow with them. **A crossing drafts nothing.** Its army grows
   * by `AREAS[*].muster` — eleven points, then fourteen, then seventeen: two
   * or three bodies an area against a ceiling of `MAX_STRENGTH` — and its
   * player grows not at all.
   *
   * So the two curves were multiplied. Measured on the shipped numbers with a
   * full ten-man line standing (`allyScale` 1.55):
   *
   *     area 1, wave 1     base 7.25 × 0.75 × 1.55 =   8
   *     area 3, wave 8     base 43.7 × 1.10 × 1.55 =  74
   *     area 5, wave 21    base 148.8 × 1.45 × 1.55 = 334
   *
   * **Forty-two times the opening wave, against the same ten men.** That is
   * also what `tools/_linewave.mjs` was reading from the other end when it
   * timed an opening wave at 81 s and wave 8 at 606 — one lever, seen twice
   * (NEXT.md: "both are driven by the same quantity, how many bodies a late
   * wave puts on the field").
   *
   * ── THE RAMP IS THE ADVANCE'S, SO THE COUNTER IS THE ADVANCE'S ──────────
   *
   * An area is an engagement: a fresh line forms up, fights its three to five
   * waves and musters. So the wave curve runs WITHIN the area — a stage builds
   * from its first wave to its last — and the escalation BETWEEN areas is the
   * two dials `AREAS` already declares for it, `budget` (0.75 → 1.45) and
   * `heavy` (0.0 → 0.45), plus the areas getting longer (3, 4, 4, 5, 5). The
   * same shipped numbers under this rule:
   *
   *     area 1, wave 3 of 3      18        area 3, wave 4 of 4      35
   *     area 2, wave 4 of 4      30        area 5, wave 5 of 5      58
   *
   * — a sawtooth that resets a little lower and climbs a little higher every
   * area, which is what a five-engagement advance is, against a monotone climb
   * to 334 that only ever described a Jedi holding twenty boon cards.
   *
   * `AREAS[*].budget`'s own note calls itself "a multiplier on the ordinary
   * wave budget… the escalation curve in Waves.js is tuned for a lone Jedi",
   * which is the correction it was written as. This makes it the ramp instead,
   * and that is the point: TWO AUTHORITIES FOR ONE QUANTITY is HANDOFF §2.3,
   * and here the two were not merely disagreeing, they were multiplying.
   *
   * DERIVED FROM THE PLAN AND NOT FROM `areaWaves`, which is the counter that
   * would have been easy and wrong. `budgetFor` is asked about waves that are
   * not the one being fought — `bodyLimit` asks it about `BODY_KNEE`,
   * `conditionCost` about the wave it is pricing — so an answer that ignored
   * its argument would make those two comparisons identities. This walks the
   * same sum `payWave` walks one clear at a time, so a plan with fewer stages
   * (`planStages` runs a Raid at two and a Grind at five) maps correctly and
   * no second table exists to drift.
   *
   * A CONTINGENT IS UNCHANGED. It has no areas — `payWave` says so at length —
   * so `stages` is not its ledger and the run's own counter is the only ramp it
   * has. `theline` and `command` are the crossings.
   */
  rampWave(wave) {
    if (!this.campaign) return wave;
    let w = Math.max(1, Math.round(wave));
    for (const st of this.stages) {
      if (w <= st.waves) return w;
      w -= st.waves;
    }
    /* Past the last stage. A crossing normally ends there, but an area whose
     * line is not up does not clear (`_awaitLine`), so the last stage is
     * allowed to keep climbing rather than wrapping back to its first wave. */
    return w + this.stages[this.stages.length - 1].waves;
  }

  /**
   * WHAT AN ARMY IS WORTH AS A MULTIPLIER ON THE WAVE.
   *
   * `ALLY_POINT` per muster point of living army, which puts ten clone troopers
   * at 1.55× and a full Republic roster of twenty-four at 2.32×. Derived rather
   * than felt: a line trooper is threat 2 against a wave-10 budget of 61, so ten
   * of them are worth about a third of the wave on paper — and they are worth
   * more than that in practice because they split the horde's attention.
   *
   * IN MUSTER POINTS AND NOT IN BODIES, and the two lines above are unchanged
   * numbers arrived at a different way. See `ALLY_POINT` for the derivation
   * (0.055 a body ÷ the 5 points a line trooper costs) and for the two things a
   * head count got wrong the moment the muster shelf opened to a contingent: a
   * composed army would have bought heavier bodies and a SMALLER wave, and a
   * droid platoon was priced as though a B1 were a clone trooper.
   *
   * Per LIVING body rather than per record, which is what `strength` already
   * meant: a line that has lost two men is charged for the eight standing.
   *
   * Capped at 2.6 for the reason `HEAVY_CAP` is capped: past that the wave stops
   * being a fight and becomes a frame-rate question.
   */
  allyScale() {
    let points = 0;
    for (const t of this.roster.living) points += musterCost(t.type);
    return Math.min(2.6, 1 + points * ALLY_POINT);
  }

  /** How hard this area leans on the heavy end, on top of the depth's own lean. */
  heavyBias(wave) {
    return clamp(super.heavyBias(wave) + (this.campaign ? this.area.heavy : 0), 0, 1.3);
  }

  /**
   * …AND THE LEVY GOES IN BEHIND EVERY ONE OF THEM. FLAGSHIP §6.
   *
   * "Forty conscripts that pay nothing are weather." The rule, the argument for
   * why the levy is free of the threat budget, and the pace correction that
   * keeps the paying bodies arriving at the rate the composer meant, are all in
   * src/game/Levy.js — a leaf, for the reason `MORALE` is one: `_composeUnder`
   * is the base director's arithmetic and this class has no business restating
   * any of it.
   *
   * IT WRAPS `_composeUnder` AND NOT `_compose`, which is the whole of why this
   * is two lines. `_compose` re-composes in a loop, reading `left` to decide
   * whether the wave can afford another condition; a levy applied once at the
   * end of `_compose` would be applied to the last recomposition only, and a
   * levy that charged the budget would change how many conditions a wave buys.
   * Applied here it rides every recomposition and moves neither number.
   */
  _composeUnder(wave, keys) {
    /* ARMOUR BEFORE THE LEVY, and the order is the arrival order. `applyLevy`
     * appends forty conscripts behind the shuffle; a walker dealt after that
     * mass would be the slowest body in the queue arriving last, forty entries
     * after the fight it belongs to. See src/game/Armour.js. */
    return applyLevy(applyArmour(super._composeUnder(wave, keys), this), this, wave);
  }

  /* ── the muster ────────────────────────────────────────────────────── */

  /**
   * THE ARMY YOU START WITH — and it is two different questions now.
   *
   * A CAMPAIGN opens with ten bodies in two squads, all of them rung 1, all of
   * them nameless numbers. That is deliberate: the roster screen at the top of
   * a campaign should be ten identical strangers, so that the three names in it
   * four areas later are something the player earned rather than something the
   * mode handed them. The campaign composes its army at the muster screen,
   * between areas, out of a purse an area paid — that IS its composition, and
   * it is why the branch below is a contingent's alone.
   *
   * A CONTINGENT opens with a purse and the shape the player asked for. See
   * the note on the branch.
   */
  /**
   * THE MEN WHO CAME BACK LAST TIME, PUT BACK ON THE ROLL.
   *
   * `this.veterans` is a list of stored records — `Company.fieldable()`'s
   * output — handed in by whoever built this director. It is INJECTED and
   * never read from storage here, for the same split `Progress.js` keeps:
   * `main.js` owns localStorage, the game owns the game, and a check can hand
   * this director six veterans without a browser anywhere in the room.
   *
   * @returns how many were enlisted, which the caller subtracts from both the
   *          body count and the purse.
   *
   * BOUNDED BY `opening`, and that bound is the design. A company of forty men
   * does not deploy forty into a contingent the player set to ten; it deploys
   * its ten best (`Company.fieldable` sorts by rank, then service, then kills)
   * and the rest wait. The alternative — a roll that grows the army it fields —
   * is cross-run power, which the persistence layer's own note refuses.
   *
   * A RECORD THIS ROLL ALREADY HOLDS IS SKIPPED SILENTLY. `enlistRecord`
   * refuses a duplicate designation and returns null, and a muster that
   * counted the null would deploy one man short for a reason nobody could see.
   */
  _musterVeterans(c = this.commander) {
    const list = this.veterans;
    if (!Array.isArray(list) || !list.length || !c?.roster) return 0;
    const army = c.army?.id;
    let n = 0;
    for (const m of list) {
      if (n >= this.opening) break;
      /* ONE ROLL PER ARMY. A droid who served under a Jedi general is not a
       * thing this game says, and the two sides draw designations from
       * different tables — so a record from the other army is dropped here
       * rather than renamed into this one. */
      if (m?.army && army && m.army !== army) continue;
      if (c.roster.enlistRecord(m)) n++;
    }
    if (n) {
      this.log?.push?.({ t: 'veterans', n });
      this.world?.notify?.('THE COMPANY IS BACK',
        `${n} ${c.army?.unit ?? 'trooper'}${n === 1 ? '' : 's'} who have done this before`);
    }
    return n;
  }

  /**
   * THE ROLL, ONTO THE LEDGER — one entry, all the names.
   *
   * `recruit` logs an `enlist` and it is the only thing that does, so the men
   * BOUGHT between areas were on the ledger and the ten a campaign is HANDED
   * were not: `_musterOpening` calls `roster.enlist` directly, `_musterVeterans`
   * logs a count and no names, and `_musterJoin` enlists a squad in silence.
   *
   * That is invisible until something asks the ledger who is on your side, and
   * `Session.runReport` does: an opening trooper who kills his own mate in area
   * one was not on any entry yet, so the census filed the death among the
   * droids and reported nought by your own side. It is the one death §4.9 is
   * sharpest about, missed for the first man to do it.
   *
   * ONE ENTRY AND NOT TEN, because it is one event — a company handed to you —
   * and ten would read as ten purchases in a report that already distinguishes
   * those. `mine` for the reason the `fell` entry carries it: in a meeting both
   * armies muster into this same log.
   */
  _logRoll(c) {
    if (!c?.roster) return;
    this.log.push({ t: 'muster', area: this.areaNumber, mine: c === this.commander,
                    names: c.roster.living.map((t) => t.name) });
  }

  /**
   * HOW MANY MEN THIS COMMANDER'S ROSTER OPENS WITH.
   *
   * `this.opening` everywhere except a meeting, which is every mode that had
   * one before: a campaign opens with `OPENING_STRENGTH`, a contingent with
   * what the player asked for.
   *
   * IN A MEETING IT IS THE SIDE'S, not the commander's, and the note on
   * `versusCommandConfig` carries the three-player measurement that decided it:
   * one roster per side, opened at `OPENING_STRENGTH` and grown a squad per
   * extra commander, made a 2v1 into **15 against 10**. A side brings what the
   * host said it brings, and how many people are leading it is a question about
   * command rather than about rifles.
   */
  openingFor(c = this.commander) {
    return this.versus && this.sideStrength > 0
      ? clamp(this.sideStrength, 1, MAX_STRENGTH)
      : this.opening;
  }

  _musterOpening(c = this.commander) {
    const tiers = c.army.tiers;
    const cheapest = tiers[0].type;
    /* THE MEN WHO CAME BACK LAST TIME GO OUT FIRST. See `_musterVeterans`. */
    const vets = this._musterVeterans(c);
    /* THE CROSSING'S RULE, AND NOT THE MEETING'S — see `this.unit` in the
     * constructor for the whole argument. A campaign opens with identical
     * strangers and composes at the muster screen between areas; a meeting is
     * one battle with no screen between anything, so it composes here or it
     * never composes at all. */
    if (this.campaign && !this.versus) {
      /* `this.opening` and not `OPENING_STRENGTH`: a campaign's opening IS the
       * constant and says so in the constructor. One loop, one authority.
       * `vets` are already on the roll and are part of that count — a company
       * of ten deploys ten, not twenty. */
      for (let i = vets; i < this.openingFor(c); i++) c.roster.enlist(cheapest);
      c.roster.points = this.stages[0].muster;
      c.lineup = c.roster.living.map((t) => t.type);
      this._logRoll(c);
      return;
    }
    /**
     * ── A CONTINGENT IS A PURSE, AND THE PLAYER SAYS WHAT IT BUYS ──────────
     *
     * The audit's first gap: "you cannot compose the contingent — it is
     * `opening` bodies of the cheapest rung." Driven on `waves`/`scoria` with
     * eight allies asked, this method used to produce `{"trooper": 8}` and a
     * purse of zero, with the other six rungs of the ladder gated behind an
     * area a contingent will never reach.
     *
     * THE BUDGET IS WHAT THE SLIDER ALREADY MEANT, PRICED. `opening ×
     * musterCost(cheapest)` — eight allies is forty Republic points, which is
     * to the point exactly what eight clone troopers cost. So the number on the
     * control keeps its old meaning for anybody who never touches the new one
     * (`unit` defaults to rung 0 and buys the same eight bodies), and gains a
     * second one for anybody who does: eight allies is also two ARC troopers
     * and three of the line, or one AT-TE and a man to walk beside it. The
     * exchange rate is `musterCost`, which is the game's own single currency
     * for "how much fight is this", so a heavier contingent is a SMALLER one
     * and `allyScale` charges the same wave for either — see `ALLY_POINT`.
     *
     * `recruit` is the one door, exactly as it is for the campaign's muster
     * screen and for `reinforce`: it prices, it guards, it enlists and it logs.
     * A second spend written here would be the twin this file has already
     * deleted eight of. `_bulk` suppresses the per-purchase network publish for
     * the same reason `autoMuster` does — there is nobody to tell yet.
     */
    /**
     * THE PURSE IS WHAT THE VETERANS DID NOT ALREADY FILL.
     *
     * `opening × musterCost(cheapest)` is the slider's meaning priced, and a
     * company that fielded six of the ten has already spent six of those men.
     * Paying the full purse on top of them would make a veteran roll a bigger
     * army rather than a better one — which is the "cross-run power" that
     * `Company.js`'s own note refuses at the top of its file. What a returning
     * company buys is rank, not headcount.
     */
    const opening = this.openingFor(c);
    /* THE PURSE, IN POINTS — see `composeContingent`. Everything already on
     * the roll (a returning company, a contingent the barracks composed in
     * advance) has spent what it is worth, so the muster cannot buy it twice. */
    const standing = c.roster.all.map((t) => t.type);
    c.roster.points = Math.max(0, opening * musterCost(cheapest)
      - standing.reduce((a, type) => a + musterCost(type), 0));
    /**
     * ── A CONTINGENT IS A PURSE, AND THE SPEND LIVES IN ONE PLACE ────────
     *
     * The budget is what the slider already meant, priced: `opening ×
     * musterCost(cheapest)`, so eight allies is exactly what eight clone
     * troopers cost, and a heavier contingent is a SMALLER one. Which rungs
     * that buys — the chosen rung first, then the line, then the heaviest
     * thing still affordable so no remainder is thrown away — is
     * `composeContingent`, CALLED here rather than restated.
     *
     * It moved out of these loops so that the barracks can ask what a
     * contingent will be made of BEFORE the run and get the answer this
     * muster is about to act on. A second copy of a spend is the
     * hand-maintained twin this repository keeps deleting, and the tab
     * showing men the ground then disagrees with is the defect the whole
     * troop tab was rebuilt to kill. `recruit` still does the spending, the
     * logging, the unlock gate and the refusals; only the arithmetic left.
     */
    /* WHAT IS ON THE SHELF HERE — `shelfFor`, which is `unlockAt`'s rule as a
     * function so the barracks can ask it too. Handed to the composer rather
     * than left for it to guess: see the `allow` note over `composeContingent`
     * for the meeting that came out as ten identical troopers when it was left
     * out. */
    const shelf = shelfFor(c.army, this.campaign, this.areaRung);
    const { types, refused } = composeContingent(c.army, opening, standing, this.unit, shelf);
    this._bulk = true;
    try {
      /* A REQUEST THAT CANNOT BE MET SAYS SO — the player asked for a
       * contingent of AT-TEs and set the size to one, which is 5 points
       * against 32. Same law as `reinforce`'s NO REINFORCEMENTS and
       * `deploy`'s NO GROUND: the places this mode cannot give the player
       * what they asked for are the places it says so out loud. */
      if (refused) {
        this.refused = refused;
        this.world?.notify?.('CONTINGENT UNCHANGED', this.refused);
      }
      /**
       * EVERY TYPE IS OFFERED, AND A REFUSAL DOES NOT END THE LINE.
       *
       * This used to `break` on the first `recruit` that came back null, which
       * is a reasonable-looking way to stop spending a purse that has run out
       * and is a silent catastrophe when the refusal is anything else.
       * Measured: a twenty-man meeting composed `10 troopers + AT-TE +
       * officer`, `recruit` refused the AT-TE on the area unlock, and the
       * break threw the officer away too — the side took the field as ten
       * identical clone troopers, which is precisely the "one kind twice" this
       * mode's own check exists to catch.
       *
       * The gate is handed to the composer now so the two should never
       * disagree again; this is what happens if they ever do. `recruit` guards
       * the purse, the unlock and `MAX_STRENGTH` itself, so offering it a type
       * it will refuse costs one comparison and never over-buys.
       */
      for (const type of types) this.recruit(type, c);
    } finally { this._bulk = false; }
    /**
     * THE SHAPE THE REPLACEMENTS PUT BACK. `_reinforce` used to refill toward a
     * body COUNT, which was the same thing as the shape while every body was a
     * clone trooper and stops being it the moment a contingent is composed: a
     * fallen ARC would have been replaced by a trooper, and a line of four ARCs
     * would have drifted into a line of eight troopers over a long run without
     * anything anywhere reporting it. The roll the opening muster actually
     * bought is what a replacement is measured against.
     */
    c.lineup = c.roster.living.map((t) => t.type);
    this._logRoll(c);
  }

  /**
   * THE MOST EXPENSIVE RUNG THIS PURSE CAN STILL AFFORD, or null.
   *
   * Off `musterOffer` rather than off `army.tiers`, which is what makes it one
   * answer and not two: the offer is where `unlockAt`, the price, the purse and
   * the `MAX_STRENGTH` ceiling are already combined into `afford`, and a
   * second walk of the ladder here would be a second opinion about what is for
   * sale. Used by the opening muster above and by `autoMuster` below.
   */
  _bestAffordable(c = this.commander) {
    const units = this.musterOffer(c).units.filter((u) => u.afford);
    if (!units.length) return null;
    units.sort((a, b) => b.cost - a.cost);
    return units[0].type;
  }

  /**
   * WHAT THE MUSTER CAN SELL RIGHT NOW.
   *
   * A rung is offered when the area has reached its `at` and the roster can
   * afford it. `have` is what you already field of that type, which is the
   * number the screen actually wants — the interesting question at a muster is
   * never "what exists", it is "should this be my third heavy or my first ARC".
   */
  /**
   * WHEN A RUNG COMES ON SALE, and there is now one statement of it.
   *
   * `rung.at` is an AREA number — 1 for the line and the heavy, 2 for the
   * marksman and the jet, 3 for the ARC and the officer, 4 for the machine —
   * and it is a good ladder for the thing it was written for: a five-area
   * crossing where the back half of the advance is what a walker is FOR.
   *
   * A CONTINGENT HAS NO AREAS. `areaNumber` is 1 for the whole of a run that
   * never advances one, so five of the seven rungs were unreachable forever,
   * and the refusal a player actually met was `recruit`'s: "ARC Trooper is not
   * available until area 3 of the advance", in the Trial of Waves, which has no
   * advance. That is the audit's first gap in one sentence — the shelf that
   * sells the other six is gated on an area a contingent does not have.
   *
   * So the gate is stated once, here, and it is a different question in the two
   * modes: a campaign EARNS a rung by crossing ground, and a contingent BUYS
   * one out of a purse the player already paid for with the size of their own
   * line. The purse is the only gate a contingent needs — see `ALLY_POINT` for
   * why a heavier body has to be a smaller army rather than a stronger one.
   *
   * Both readers call it. It used to be written twice, as a filter in
   * `musterOffer` and as a guard in `recruit`, which is the shape §2.3 keeps
   * catching: two copies of a rule that can only ever drift apart.
   */
  unlockAt(rung) {
    return this.campaign ? rung.at : 1;
  }

  /**
   * ══ THE BRANCHING ROUTE — PLAN.md §4.6, and what it can and cannot be ══
   *
   * "A branching route over the five Command areas that already exist, with
   * partial information: you see the ground, the weather and the garrison
   * weight, not the contents."
   *
   * THE LENGTH IS NOT NEGOTIABLE. `SESSION_PLANS` prints a duration on the
   * deploy card at 0:00 — "3 engagements · 18–25 min" — and that card is the
   * one promise the mode makes before a player commits a sitting to it. So a
   * fork changes WHICH ground fills a slot and never HOW MANY slots there are:
   * `stages.length` is fixed at the constructor and every branch taken here
   * writes a route of exactly the same length. What a player trades is the
   * ground, not the evening.
   *
   * TWO CLAUSES CARRY OVER FROM `planStages` UNCHANGED, and they are what make
   * the route a route rather than a shuffle:
   *
   *   IT ONLY GOES FORWARD. Every stage is a strictly higher rung of `AREAS`
   *     than the one before it. `areaRung` gates the muster shelf on the
   *     ground you are standing on, so a route that doubled back would take
   *     the ARC off the shelf between two areas.
   *   IT ENDS ON THE LAST GROUND. §5's "the last stage is always the last" —
   *     a crossing that stopped at the spires would end on somebody else's
   *     brief and call it a victory, and `lastArea` would stop being "the end
   *     of the list".
   *
   * ── SO MOST PLANS HAVE NO FORK, AND THAT IS ARITHMETIC ──────────────────
   *
   * With the ends pinned and the rungs strictly increasing, the slack in a
   * route of `n` stages over `AREAS.length` grounds is `AREAS.length - n`:
   *
   *   A GRIND is five stages over five rungs. Every slot is spoken for, there
   *     is no fork anywhere in it, and that is CORRECT rather than a gap —
   *     the Grind's own blurb is "the whole crossing", and a whole crossing
   *     with a ground left out would be a different promise.
   *   A RAID is two stages, and both of them are ends. Also no fork.
   *   A PUSH is three: the landing, ONE FREE SLOT, the Core Ship. That slot
   *     has three legal grounds (rungs 2, 3, 4) and it is the only real
   *     branch the mode has. It is also the plan half of all seeds draw.
   *
   * ── WHY TWO CANDIDATES AND NOT THREE ────────────────────────────────────
   *
   * The planned ground is always the first, because it is the answer with no
   * screen wired: `_areaClear` opens a muster, `autoMuster` spends the purse
   * and `closeMuster` advances onto `stages[areaIndex]` without this method
   * ever being asked. Every headless check, every mode that is not a crossing
   * and every run on a front end that has no fork on its card takes the route
   * `planStages` dealt, byte for byte.
   *
   * The second is the legal ground whose MUSTER is furthest from the planned
   * one's, and the reason is the guardrail rather than taste: a fork between
   * two grounds three reinforcement points apart is a fork below the noise of
   * one casualty, which is an element that changes no decision. On the shipped
   * table the Push's planned middle is the Hailfire Line at 17 and the far
   * candidate is the Spire Approach at 26 — half again the purse, a heavier
   * garrison, a fifth wave to survive, and the rung-4 shelf one engagement
   * early. That is a decision.
   *
   * ── AND THE TAIL IS NEVER UNDECIDED ─────────────────────────────────────
   *
   * `stages` always holds a COMPLETE route — the one the run takes if the
   * player presses Advance and chooses nothing. That matters because
   * `rampWave` walks `stages` to place a wave inside its area and `budgetFor`
   * asks it about waves that have not been fought (`bodyLimit` asks about
   * `BODY_KNEE`), so a route with a hole in it would price the present off a
   * future that does not exist yet. Stages BEHIND `areaIndex` are never
   * rewritten, so nothing already fought is re-priced.
   *
   * A branch does move the run's total WAVE count — a Push is 3+4+5 = 12
   * through the hailfire line and 3+5+5 = 13 through the spires. Nothing
   * asserts on that sum and nothing should: what the deploy card promises is
   * a count of ENGAGEMENTS and a band of minutes, and `AREAS` has run 3/4/4/5/5
   * since it was written precisely so that a later area is a longer one. The
   * extra wave is the price on the ticket, not a drift in it.
   *
   * @returns {object[]} the candidate `AREAS` records, planned first, or `[]`
   *          when this boundary has no slack.
   */
  routeChoices() {
    /* `AREAS` IS A PRESSURE DIAL IN THE OTHER TWO MODES and not a route at all
     * — `World.beginSkirmish` writes `areaIndex = sk.pressure` and never
     * advances it. Branching a dial would move the budget curve, the heavy bias
     * and the shelf together, which is a difficulty change nobody asked for.
     * Same field `this.stages` is guarded by in the constructor, asked once. */
    if (!this.crossing) return [];
    const i = this.areaIndex;
    /* The landing is where you come down and the last ground is where it ends;
     * neither is anybody's to choose. Both are `planStages`' clauses, restated
     * as bounds rather than re-derived. */
    if (i <= 0 || i >= this.stages.length - 1) return [];
    const from = AREAS.indexOf(this.stages[i - 1]);
    const planned = AREAS.indexOf(this.stages[i]);
    if (from < 0 || planned < 0) return [];
    /* How many grounds still have to fit after this one, the last of which is
     * `AREAS`' last. So the highest rung this slot may take is the one that
     * still leaves a distinct rung for each of them. */
    const tail = this.stages.length - 1 - i;
    const lo = from + 1, hi = AREAS.length - 1 - tail;
    if (hi <= lo || planned < lo || planned > hi) return [];
    let alt = -1, far = -1;
    for (let k = lo; k <= hi; k++) {
      if (k === planned) continue;
      const d = Math.abs(AREAS[k].muster - AREAS[planned].muster);
      /* Ties go to the heavier ground: a fork whose two roads pay the same is
       * a fork about what you will meet, and the heavier one is the one with
       * something to meet. Unreachable on the shipped table — `muster` is
       * strictly increasing — and written so that it stays answerable if it
       * stops being. */
      if (d > far || (d === far && k > alt)) { far = d; alt = k; }
    }
    return alt < 0 ? [] : [AREAS[planned], AREAS[alt]];
  }

  /**
   * TAKE ONE OF THEM, AND KEEP THE ROUTE A ROUTE.
   *
   * The tail is not patched, it is RE-PLANNED, through `planStages` itself over
   * the grounds that are still ahead. That is the whole of why this is four
   * lines: `planStages` already knows that a route starts where it starts, ends
   * on the last ground and spreads whatever is between evenly, and a second
   * implementation of those three clauses here is the hand-maintained twin this
   * repository has paid for eight times (HANDOFF §2.3). Taking the PLANNED
   * ground therefore reproduces the existing tail exactly, which is what makes
   * "choose nothing" and "choose the default" the same run.
   *
   * A COMMANDER WHO IS NOT HOLDING THE ARMY CAN ONLY ASK, the same shape
   * `recruit` and `closeMuster` have and for the same reason: the route is a
   * fact about the run, one machine owns the run, and a client that rewrote its
   * own `stages` would fight a different crossing from the one the host is
   * composing waves for. Nothing is written locally; the host's answer arrives
   * as the next offer.
   *
   * @param {string} id the `AREAS` id of the ground to take.
   * @returns {boolean} whether the route actually moved.
   */
  takeRoute(id) {
    /* `refused` is the one field the muster screen prints a sentence out of,
     * and it is cleared on the way in for the reason `recruit` clears it: a
     * road taken after a purchase was refused must not leave the price of a
     * body on the screen as though it were an answer about the ground. */
    this.refused = null;
    if (this._netShell) return this.world?.requestRoute?.(id) ?? false;
    /* Only while the card is up. The fork is a muster's decision — outside one
     * there is no `_fork`, and a route rewritten mid-area would move the ground
     * under a line already standing on it. */
    if (!this.mustering || !this._fork?.length) { this.refused = 'there is no road to choose here'; return false; }
    const pick = this._fork.find((a) => a.id === id);
    if (!pick) { this.refused = `${id} is not one of the roads on offer`; return false; }
    /* The road you are already on. Refused because the route did not MOVE, and
     * silently because it is not a refusal a player needs told about — it is
     * the answer "yes, that is where you are going". */
    if (pick === this.stages[this.areaIndex]) return false;
    const i = this.areaIndex;
    const rest = planStages({ engagements: this.stages.length - i }, AREAS.slice(AREAS.indexOf(pick)));
    /* THE LENGTH IS THE PROMISE. `routeChoices` only offers grounds that leave
     * room for the tail, so this cannot fail — and it is checked rather than
     * trusted, because the one failure mode of this whole feature is a card
     * that said three engagements and delivered two. */
    if (rest.length !== this.stages.length - i) { this.refused = `${pick.name} leaves no room for the rest of the crossing`; return false; }
    this.stages = [...this.stages.slice(0, i), ...rest];
    /* THE OFFER MOVED, so every screen showing it is now wrong — the brief, the
     * band, the muster the next ground pays. Published here for the reason
     * `recruit` publishes: this is the one place a route changes, and a publish
     * per caller is a chance to forget one. */
    this.world?.publishMuster?.();
    return true;
  }

  musterOffer(c = this.commander) {
    /**
     * A SHELL SAYS WHAT IT WAS TOLD, VERBATIM — the same rule `readout` states,
     * and it is load-bearing for a different reason here.
     *
     * Every number a muster screen draws is a fact about a purse this machine
     * does not hold: `points` is the balance, `afford` is the balance against a
     * price, `have` is what is already on the field, and `roster` is the roll
     * the reinforcements join. A client computing them from its own shell would
     * offer every unit in the army at zero points and call none of them
     * affordable. So the host's own `musterOffer()` crosses whole and comes back
     * out of here unchanged — one authority, no twin.
     *
     * `null` until the host says the muster is open, which is exactly what
     * `mustering` already means and what a screen must not open without.
     */
    if (this._netShell) return this._netOffer;
    const A = this.area;
    const have = new Map();
    for (const t of c.roster.living) have.set(t.type, (have.get(t.type) || 0) + 1);
    return {
      area: this.areaNumber,
      areaName: A.name,
      brief: A.brief,
      /* WHAT THE PLAYER CALLS THEIR SQUADS, and the army's own word for one —
       * so the muster card that opens seconds after an engagement groups the
       * roll under the same headings the fight's own column just used. */
      squadNames: this.squadNames ? this.squadNames.slice() : null,
      squadWord: c.army?.squadWord || 'Squad',
      /**
       * THE GROUND JUST TAKEN — and it was missing, which cost the card its
       * header.
       *
       * `_areaClear` advances `areaIndex` BEFORE it builds this offer, so `A`
       * is the ground you are walking INTO and every field above it says so.
       * The muster screen had nothing else to reach for and stamped
       * `"${areaName} — held"` across the top of itself: on a Push it announced
       * that the Hailfire Line had been held at the moment the player finished
       * the landing zone and was being offered the road to it. The interlude
       * running three centimetres below said `THE LANDING ZONE — HELD`, off
       * `Session.interludeBeats`, which is handed the right record — so the two
       * halves of one card named two different grounds as the one just taken.
       *
       * Same record `_areaClear` hands the interlude, read the same way, so the
       * stamp and the report cannot drift. Null outside a muster, which is
       * every other caller of this method (`_bestAffordable`, the opening) and
       * is the honest answer there: nothing has been held yet.
       */
      held: this.areaIndex > 0 ? this.stages[this.areaIndex - 1] : null,
      /** …and the ground after the one you are walking into, which is what
       *  makes a fork readable: both roads rejoin here. Clamped to the last
       *  stage, so it is never undefined on the final approach. */
      next: this.stages[Math.min(this.areaIndex + 1, this.stages.length - 1)],
      /**
       * THE FORK, AND WHAT IT IS ALLOWED TO SAY — PLAN.md §4.6's "partial
       * information: you see the ground, the weather and the garrison weight,
       * NOT THE CONTENTS."
       *
       * Four readings per candidate and every one of them is a property of the
       * GROUND rather than of the wave that will be composed on it:
       *
       *   the ground     `name` and `brief`, the same two strings the deploy
       *                  card and the muster's own header already print, so no
       *                  third description of a place can drift from them.
       *   the rung       where it sits on the `AREAS` ladder, which is the
       *                  number `areaRung` gates the shelf on — taking the
       *                  higher road opens the rung-4 bodies an engagement
       *                  early, and that is the sharpest consequence on the
       *                  card.
       *   how long       `waves`. An engagement is 3 to 5 waves and the whole
       *                  of what a longer one costs is attrition against the
       *                  same ten men.
       *   what it pays   `muster`, in points and not in a band, deliberately:
       *                  it is the currency the decision trades in, the purse
       *                  is printed two rows below it in the same units, and a
       *                  band there would make the comparison unaskable.
       *   the weight     `garrisonBand`, which is `budget` and `heavy` at the
       *                  resolution a briefing has. See `GARRISON_BANDS`.
       *
       * WHAT IS NOT HERE IS THE CONTENTS: no `budget`, no `heavy`, no
       * archetype and no condition. `_compose` deals those when the area
       * starts, off a budget that also depends on how many men are standing by
       * then — so they are not merely withheld, they do not exist yet.
       *
       * AND THERE IS NO WEATHER ON IT, WHICH IS THE HONEST ANSWER RATHER THAN
       * AN OMISSION. §4.6 asks for one and PLAN.md §4.7 answers it in the same
       * document: "There is no `Weather.js`… **Weather is entirely unbuilt**."
       * What exists is `Scenery.weather`, ONE squall scheduler configured once
       * per LEVEL out of `level.dust.weather` — and a crossing is one level for
       * its whole length (§3's first convergence, one ground), so every
       * candidate on this card would carry the same squall, the same period and
       * the same peak. §7's guardrail is that an element has to change a
       * decision; a column that is identical on both roads changes none, and
       * printing it would only teach the player that the fork has a dial in it
       * that does nothing. `waves` is the true thing in its place: it is
       * per-ground, it differs between the two candidates the Push actually
       * offers (4 against 5), and it is what the player is really asking when
       * they ask about the sky.
       */
      route: (this._fork || []).map((a) => ({
        id: a.id, name: a.name, brief: a.brief,
        rung: AREAS.indexOf(a) + 1,
        waves: a.waves,
        muster: a.muster,
        garrison: garrisonBand(a),
        /** Which road the run is on right now — the planned one until the
         *  player moves it. The card draws the selection off this rather than
         *  keeping its own, for the reason it keeps no copy of the points. */
        taken: a === this.stages[this.areaIndex],
      })),
      points: c.roster.points,
      strength: c.roster.strength,
      max: MAX_STRENGTH,
      roster: c.roster.summary(),
      /* THE QUIET, and it crosses the wire with the rest of the offer for the
       * reason the note above gives: a peer that assembled its own beats out
       * of a log it does not keep would tell a different story about the same
       * engagement. Same object every call — `recruit` re-reads the offer after
       * every purchase, and a reveal that restarted itself each time you bought
       * a trooper would never finish. */
      interlude: this._interlude,
      /**
       * WHO CAN BE COMMENDED, AND WHAT IT COSTS — PLAN §4.4's third option.
       *
       * The living, with the rank each holds and how far off the next one is,
       * so the card can show what the points would BUY rather than only what
       * they cost. `to` is null for a man already at the top of the ladder,
       * which is what `commend` refuses on — a row that offered it and then was
       * refused is the picker being randomly broken (see `_syncRules`).
       *
       * `afford` is computed here beside the purse and not in the screen, for
       * the reason at the head of this method: a client that worked out its own
       * affordability would offer every man at zero points.
       */
      commend: {
        cost: this.commendCost(),
        men: c.roster.living.map((t) => ({
          name: t.name, unit: t.label, rank: RANKS[t.rank].short, title: RANKS[t.rank].title,
          xp: t.xp, to: t.rank < RANKS.length - 1 ? RANKS[t.rank + 1].title : null,
          need: t.rank < RANKS.length - 1 ? RANKS[t.rank + 1].xp - t.xp : null,
          afford: c.roster.points >= this.commendCost() && t.rank < RANKS.length - 1,
        })),
      },
      units: c.army.tiers
        // The AREA NUMBER, not a second column beside it. See AREAS — and see
        // `unlockAt`, which is where a contingent's answer to the same question
        // lives, because a mode with no areas cannot wait for the third one.
        .filter((t) => this.unlockAt(t) <= this.areaRung)
        .map((t) => ({
          type: t.type, cost: t.cost,
          label: ARCHETYPES[t.type]?.label ?? t.type,
          threat: ARCHETYPES[t.type]?.threat ?? 0,
          have: have.get(t.type) || 0,
          afford: c.roster.points >= t.cost && c.roster.strength < MAX_STRENGTH,
        })),
    };
  }

  /**
   * Buy one. Returns the new Trooper, or null with a reason on `this.refused`.
   *
   * Guarded rather than trusting the UI, because the same call is made by the
   * auto-muster below with no screen involved at all, and a mode that silently
   * over-spends is a mode whose roster screen lies.
   */
  recruit(type, c = this.commander) {
    /**
     * A COMMANDER WHO IS NOT HOLDING THE PURSE CAN ONLY ASK TO SPEND IT.
     *
     * The same shape as `order` below, for the same reason and with the same
     * refusal to write anything locally: the request goes to the host, the host
     * runs THIS method against the roster it is actually keeping, and the
     * screen's numbers move when the host's answer arrives (see
     * `World.applyMuster` and `applyMusterNet`). A client that decremented its
     * own copy of the points would disagree with the host the first time it was
     * told no — and a muster whose totals lie is worse than no muster at all,
     * which is the same sentence main.js already writes about a screen keeping
     * its own points.
     *
     * WHAT CROSSES IS THE UNIT, and nothing else. Not the cost, not the
     * balance, not the strength: every one of those is derived below from the
     * roster the host holds, so there is no claim a peer can make about its own
     * purse that anything reads.
     */
    if (this._netShell) { this.refused = null; this.world?.requestMuster?.(type); return null; }
    const rung = c.army.tiers.find((t) => t.type === type);
    this.refused = null;
    if (!rung) { this.refused = `${type} is not one of ${c.army.name}'s units`; return null; }
    if (this.unlockAt(rung) > this.areaRung) { this.refused = `${ARCHETYPES[type]?.label ?? type} is not available until area ${rung.at} of the advance`; return null; }
    if (c.roster.points < rung.cost) { this.refused = `${rung.cost} points needed, you have ${c.roster.points}`; return null; }
    if (c.roster.strength >= MAX_STRENGTH) { this.refused = `you cannot field more than ${MAX_STRENGTH}`; return null; }
    c.roster.points -= rung.cost;
    const t = c.roster.enlist(type, { joined: this.areaNumber });
    this.log.push({ t: 'enlist', name: t.name, unit: t.label, area: this.areaNumber });
    /* THE PURSE MOVED, so anybody looking at a screen of it is now wrong. Here
     * rather than at the two callers because this is the ONE place a
     * reinforcement is bought — the host's own screen reaches it through
     * main.js, a peer's through `World.applyMuster`, and the fallback through
     * `autoMuster` above — and a publish per caller is three chances to forget
     * one. No-op outside a session; `_bulk` is the fallback's own suppression. */
    if (this.mustering && !this._bulk) this.world?.publishMuster?.(c);
    return t;
  }

  /**
   * WHAT ONE COMMENDATION COSTS — PLAN §4.4, and the rate is the run's own.
   *
   * §4.4 asks the muster to be "a decision at the Company screen:
   * **replacements, or promote a survivor, or bank the purse.**" Two of those
   * three already worked: `recruit` buys replacements, and banking is what
   * closing the muster without spending has always done — the purse is never
   * cleared, so points survive to the next ground. Promotion was the missing
   * one.
   *
   * ── AND IT BUYS EXPERIENCE, NOT RANK ─────────────────────────────────────
   *
   * A rank in this mode is a fact about `xp` crossing a gate in `RANKS`, and
   * `Trooper.award` is the one door it comes through — every promotion in the
   * game is announced by that method returning a record. So a commendation pays
   * `XP_PER_WAVE` into the same door rather than writing a rank, and a man is
   * promoted only if that carries him over his gate. Nothing about promotion is
   * bypassed; what the purse buys is the fighting he did not have to do.
   *
   * ── THE PRICE IS DERIVED AND NOT CHOSEN ──────────────────────────────────
   *
   * Holding an area awards `XP_PER_AREA` and pays `area.muster` points — that
   * pair IS the run's exchange rate between blood and money, stated by the two
   * lines that hand them out. So a commendation costs what the ground that
   * would have earned it pays: `muster / XP_PER_AREA`. The landing zone pays 11
   * and charges 6; the Core Ship pays 30 and charges 15. The price rising with
   * the purse is the point — a flat price would be free by area five, and the
   * DECISION has to stay live at every boundary.
   *
   * Against a body at 5 points that is roughly one replacement per commendation,
   * which is the trade §4.4 wants put to the player: another man, or one of the
   * men you already have made better. And at `MAX_STRENGTH` the shelf refuses
   * every body, so this is the only thing left to spend on — a full line is
   * where a purse used to have nowhere to go.
   */
  commendCost() { return Math.max(1, Math.ceil((this.area?.muster ?? 0) / XP_PER_AREA)); }

  /**
   * Commend one man by name. Returns the RANKS record if it promoted him, or
   * `true` if the experience landed without crossing a gate; null on refusal
   * with the reason on `this.refused`.
   *
   * BY NAME AND NOT BY INDEX, for `recruit`'s reason: the same call is made by
   * a screen the host owns and by a peer over the wire, and a roster index
   * means two different men the moment somebody dies between the click and the
   * arrival. A designation is unique on the roll by construction — see
   * `designate`.
   */
  commend(name, c = this.commander) {
    /* A COMMANDER WHO IS NOT HOLDING THE PURSE CAN ONLY ASK. Same shape as
     * `recruit` and for the same reason: nothing is written locally, the host
     * runs this against the roster it actually keeps, and the screen's numbers
     * move when the answer arrives. */
    if (this._netShell) { this.refused = null; this.world?.requestCommend?.(name); return null; }
    this.refused = null;
    const t = (c.roster?.living || []).find((x) => x.name === name);
    if (!t) { this.refused = `${name} is not standing on this roll`; return null; }
    const cost = this.commendCost();
    if (c.roster.points < cost) { this.refused = `${cost} points needed, you have ${c.roster.points}`; return null; }
    if (t.rank >= RANKS.length - 1) { this.refused = `${t.name} already holds ${RANKS[t.rank].title}`; return null; }
    c.roster.points -= cost;
    const rose = t.award(XP_PER_WAVE);
    if (rose) this._promoteTrooper(t, t.body);
    /* The log carries it for the same reason it carries an enlistment: the
     * interlude and the after-action report read this ledger and nothing else,
     * so a promotion the player PAID for has to be in it or the report is a
     * story about a different run. */
    this.log.push({ t: 'commend', name: t.name, unit: t.label, rank: RANKS[t.rank].short,
                    area: this.areaNumber, cost });
    if (this.mustering && !this._bulk) this.world?.publishMuster?.(c);
    return rose || true;
  }

  /**
   * SPEND WHAT IS LEFT, SENSIBLY — the muster with nobody watching.
   *
   * There is no muster SCREEN yet (see the handover at the foot of this file),
   * and a mode that cannot be played without a screen that does not exist is a
   * mode that does not exist. So the director musters for itself: it replaces
   * losses first, because a campaign that thins to four men is over, and spends
   * the remainder on the heaviest rung it can afford, because that is what the
   * points are for. When a screen arrives it calls `recruit` and this never runs.
   *
   * REPLACEMENTS COST WHAT THEY COST. There is no discount for being down to
   * three men — the note's whole premise is that a loss is permanent and has to
   * be PAID for, and a mode that quietly refills the line for free has removed
   * the thing it was asked to add.
   */
  autoMuster(c = this.commander) {
    /**
     * A SHELL SPENDS NOTHING, and this is the refusal the whole muster wire was
     * missing rather than a guard against a caller that will not come.
     *
     * `main.js` falls back to `autoMuster()` whenever the muster screen cannot
     * be raised, and every client in a session runs that same main.js. Without
     * this line a joining commander whose card failed to draw would walk the
     * host's shelf and send one purchase intent per affordable rung — up to
     * forty of them, spending a purse it cannot see, for a player who was never
     * shown a choice. Which is the defect this method's own header describes
     * ("the muster with nobody watching") arriving over the wire.
     */
    if (this._netShell) return 0;
    let bought = 0;
    const want = Math.max(0, OPENING_STRENGTH - c.roster.strength);
    const cheapest = c.army.tiers[0].type;
    /* One message at the end rather than one per purchase: `recruit` publishes
     * the new offer to the peers sharing this purse, and forty of them for a
     * fallback nobody is watching would cost more than the roster does. */
    this._bulk = true;
    try {
      for (let i = 0; i < want; i++) if (this.recruit(cheapest, c)) bought++;
      // Then the best thing on the shelf, until nothing on it is affordable.
      // Through `_bestAffordable`, which is the same walk the opening muster
      // makes and was written out twice until a contingent needed it too.
      for (let guard = 0; guard < 40; guard++) {
        const best = this._bestAffordable(c);
        if (!best || !this.recruit(best, c)) break;
        bought++;
      }
    } finally { this._bulk = false; }
    if (bought) this.world?.publishMuster?.(c);
    return bought;
  }

  /* ── deployment ────────────────────────────────────────────────────── */

  /**
   * PUT THE LIVING ROSTER ON THE FIELD.
   *
   * Called at the top of every area. Bodies are built through `world.spawnEnemy`
   * — the same one door the wave director uses — and then enlisted, so a trooper
   * is an Enemy that has been handed a name and a team and nothing else has been
   * special-cased anywhere.
   *
   * They come down AROUND YOU rather than at the level's spawn ring, because
   * they arrived with you; the enemy is the thing that has to be announced from
   * a distance, and `Arrivals.js` already owns that.
   */
  deploy(c = this.commander, opts = {}) {
    const w = this.world;
    if (!w || typeof w.spawnEnemy !== 'function' || !c) return 0;
    /**
     * WHERE THE ARMY COMES DOWN, and it is the commander's own ground now.
     *
     * `w.player.position` was right when there was one commander and is the
     * whole of why two armies could not be put on a field: both rosters would
     * have landed in the same ring around the same body. The commander's own
     * `anchor` wins when it has one — that is opposed deployment, two lines
     * facing each other across a plain — and falls back to their body, which
     * is every campaign caller and is unchanged by this.
     */
    const anchor = c.anchor || c.player?.position || w.player?.position || _v1.set(0, 0, 0);
    /* THE SQUADS THIS COMMANDER LEADS, not the whole roll. One roster shared
     * by four players would otherwise have the first commander put all twenty
     * bodies down around themselves and the other three find nothing missing.
     * Identical to `roster.living` for a single commander, which is every
     * campaign and both ends of a meeting. See `led`. */
    const live = this.led(c);
    /**
     * AND THEY COME IN ON SHIPS, which the mode's own first brief has always
     * claimed and the code never did: "The gunships put you down in the open."
     * Ten troopers appearing out of nothing in a ring around you is the same
     * event as a wave spawning, and the player asked whether it was even
     * happening — "the new troops arrive (hopefully via ship I haven't
     * confirmed that)".
     *
     * `ArrivalDirector` already flies the gunship, opens the doors, drops the
     * squad the last few metres and makes the landing puff, and it already
     * carries four bodies a flight so a squad rides in together. All it was
     * missing was a way to weld the trooper RECORD to the body it puts down —
     * `onBody`, one seam, used by nothing else.
     *
     * It falls back to placing them by hand whenever arrivals are off: the
     * sandbox, the training dojo and every headless check turn them off, and a
     * campaign that cannot deploy without a ship is a campaign that cannot be
     * tested.
     */
    /**
     * OPT-IN, and the default is the instant placement this method has always
     * done. A ship is four seconds of flight and that is right for the ONE
     * moment the brief describes — the army coming down at the top of an area
     * — and wrong for everything else `deploy` answers, which is "this record
     * has no body and needs one now": a mid-wave replacement standing around
     * for four seconds is a hole in your line, not a cinematic. So
     * `closeMuster` and the meeting ask for ships and nothing else does.
     *
     * ── AND THIS IS WHERE THE PLAYER'S SECOND COMPLAINT IS *NOT* ANSWERED ──
     *
     * "your reinforcements still teleport in next to you, they don't arrive via
     * transport." The obvious reading is that this default is the defect, and
     * flipping it was tried: it costs SIXTEEN checks in tools/checks/command.mjs
     * (measured: 27 passed / 16 failed, almost all of them "only 0 bodies
     * deployed") and, much worse, it fixes nothing — both callers that
     * reinforce a LIVE battle already pass `byShip: true` and have since the
     * seam existed. Your mid-battle reinforcements were already flying in.
     *
     * The body the player was watching appear was deployed by `start`, at a
     * GROUND CHANGE — `_afterRotate` runs `beginMission`, which starts this
     * director, which puts the whole roster down around the commander on the
     * new planet, one frame after the old one vanished. That is answered where
     * it happens, in src/game/Extraction.js: those bodies are lifted into the
     * transport's bay by `_reboard` and walk off its ramp by `_release`, so the
     * placement `start` does is never something the player sees at all.
     *
     * The lesson is HANDOFF §2.4's arriving from the other side: the rule this
     * default states was right, and the call site that looked like it was
     * breaking it was not the one the player was looking at.
     */
    const air = opts.byShip && this.arrivals?.enabled ? this.arrivals : null;
    let n = 0, unplaced = 0;
    for (let i = 0; i < live.length; i++) {
      const t = live[i];
      if (t.body && !t.body.dead) continue;
      /* ALREADY ON A SHIP. `deploy` is called from three places and one of
       * them — `start`, whose guard is "does any living record lack a body" —
       * would otherwise re-order the whole army every frame of the four
       * seconds a gunship spends in the air, and land ten copies of it. A
       * record in the air has no body and is not missing one.
       *
       * ASKED BEFORE THE GROUND SEARCH RATHER THAN AFTER IT, which is where it
       * used to sit: a record in the air would otherwise pay for up to six
       * `placementClear` sweeps of the collider list, every frame of its own
       * flight, to answer a question that was already no. */
      if (this._inbound.has(t)) continue;
      /**
       * BEHIND YOU AND BESIDE YOU, NEVER IN FRONT OF YOU.
       *
       * The player: "you spawn with your allies in front of your saber so you
       * end up killing them." This ONE line was most of it — `(i / n) * TAU` is
       * a full circle at 4 to 8.4 m, so a thirteen-man roster put two or three
       * bodies in the wedge a lightsaber sweeps through, every single time,
       * with the commander's blade already lit from the fight that just ended.
       *
       * The fan is 240° centred on the commander's back, which is where a line
       * forming up on its officer belongs anyway; `nudgeFromSwing` is the
       * backstop for the case the fan cannot cover, which is a commander who
       * has no facing yet on the frame after `spawnPlayer`. Both halves are in
       * Spawn.js beside `spawnClear`, because "is this somewhere a body can
       * arrive" is one question and it now has two clauses.
       */
      /**
       * WHOSE BACK — AND THE ANSWER IS "THE PERSON HOLDING THE CAMERA", ONLY.
       *
       * The fan is a shape built around a LIGHTSABER, so it belongs to the one
       * commander who is swinging one on this machine. Two earlier drafts were
       * both wrong and both were caught by driving:
       *
       *   `w.player.facing` as a fallback fanned an AI commander's army behind
       *     the LOCAL player's back — a body on neither side — which deforms
       *     both lines of an opposed meeting around a spectator.
       *   `c.player` alone fanned the enemy commander's army behind the enemy
       *     commander, i.e. directly away from the fight. Measured: the second
       *     army in tools/checks/command.mjs's DREAD case landed entirely
       *     outside a 26 m radius that used to contain several of it.
       *
       * So: local player, or the full circle this method has always used.
       * `nudgeFromSwing` below is unconditional and remains the law in every
       * case — it is the clause that cannot be got wrong by a shaping choice.
       */
      const face = c.player && c.player.isLocal && c.player.alive !== false ? c.player : null;
      const spread = live.length > 1 ? (i / (live.length - 1) - 0.5) : 0;
      if (!this._standingRoom(w, anchor, face, i, live.length, spread, _v2)) { unplaced++; continue; }
      /* THE COMMANDER'S SIDE, not the world's one constant. `world.partyTeam`
       * is the LOCAL player's side and there is one of it; a second army on it
       * would be an ally of the first, which is the whole question. */
      const enlist = (e) => {
        this._inbound.delete(t);
        enlistBody(e, t, { team: c.side, teamDamage: this.teamDamage, director: this, cmdr: c });
      };
      /* 18 m, and the check holds it under 30: a gunship that sets your line
       * down at the far edge of the spawn ring has not reinforced you, it has
       * started them on a walk. */
      /* WHAT HE CHOSE TO WEAR, handed over with the request. A kit is
       * geometry, so it has to be in hand when the body is BUILT — `enlist`
       * below runs after that and can only paint. Both doors take it, because
       * a man who arrives by gunship is the same man. */
      const worn = t.look ? { look: t.look, kind: t.kind } : null;
      if (air && air.request(t.type, null, null, Math.PI / 2, enlist,
        { kind: 'dropship', near: 18, cap: 6, look: worn })) {
        this._inbound.add(t); n++; continue;
      }
      const e = w.spawnEnemy(t.type, _v2, worn);
      if (!e) { unplaced++; continue; }
      enlist(e);
      n++;
    }
    /**
     * ── AND IF THE GROUND WOULD NOT TAKE THEM, IT SAYS SO ─────────────────
     *
     * The audit's third gap, and the reason it is worth a paragraph is that it
     * was a SILENT one: the loop above ended `if (!e) continue;` and a record
     * that could not be put down simply stayed bodyless while the roster panel
     * went on printing its name. `reinforce` has said NO REINFORCEMENTS out
     * loud since it was written, for the same reason `Player._refuse` exists —
     * the caller has already spent something to get here — and a deployment
     * that quietly delivers six of ten men is the same failure with nobody
     * paying attention to it.
     *
     * Local commander only, exactly as `reinforce` does it: a peer's army
     * failing to find ground is not this player's banner to lose.
     *
     * `undeployed` is left on the director rather than being only a banner,
     * because a banner is not something a check or a HUD can read. It is the
     * count from the LAST call, which is what "could the army be put down where
     * it is standing now" means.
     */
    this.undeployed = unplaced;
    if (unplaced && c === this.commander) {
      this.world?.notify?.('NO GROUND FOR THE LINE',
        `${unplaced} of ${live.length} could not be set down — move off the wall`);
    }
    this._announceRoster();
    /* THE WITNESS THAT AN ARMY EXISTED. `_checkLine` needs to tell "the roster
     * has been wiped out" from "the roster has not landed yet", and both read
     * `strength === 0`. A count of bodies actually put on the ground is the
     * honest difference; a timer or a frame count is a guess about how long a
     * gunship takes. Here rather than in `deployAll`, because four of the five
     * callers in this file call `deploy` directly. */
    if (n > 0) this._landed = true;
    return n;
  }

  /**
   * WHERE ONE BODY CAN ACTUALLY STAND — writes into `out` and returns whether
   * it found anywhere.
   *
   * ── THE DEFECT, MEASURED ──────────────────────────────────────────────
   *
   * `deploy` fanned the roster onto a fixed three-radius ring — 4, 6.2 and 8.4
   * m behind the commander — and tested exactly two things about the result:
   * that it was inside the heightfield, and that it was not in the arc the
   * player's blade sweeps. It never asked the question the rest of the game
   * asks about every body it places, which is `spawnClear`: is this point
   * inside a collider, or under the level's own water?
   *
   * Driven over the seven shipped grounds, a 24-body contingent deployed from
   * eight anchors on each, 1,344 placements, every body's chest point tested
   * against the level's enabled static boxes and water sheet:
   *
   *     scoria     16 / 192   8.3%
   *     mustafar   13 / 192   6.8%
   *     colosseum  16 / 192   8.3%
   *     wood       14 / 192   7.3%      ← the ankle-deep channels
   *     drifts      1 / 192   0.5%
   *     alpine      6 / 192   3.1%
   *     geonosis    1 / 192   0.5%
   *                67 / 1344  5.0%
   *
   * One trooper in twenty arrived inside a rock, a wall, a wreck or a stream.
   * `Spawn.js`'s own header records the same class of bug being found in
   * `World.pickSpawn` and `Arrivals._sitePoint` and fixed in both; the muster
   * was the third caller and it was missed.
   *
   * ── WHAT THE AUDIT SAID, AND WHY IT IS WORTH CORRECTING IN PLACE ───────
   *
   * `muster.mjs`'s header states this gap as "on small ground `deploy` silently
   * drops men… four allies asked put TWO on the field" on the Colosseum. Driven
   * again, that is not what happens: `deploy()` returns 4, four bodies stand
   * up, and by twenty-two seconds two of them are dead — killed by the duel's
   * acolyte, with `roster.fallen` naming both. The count was read off a live
   * fight and attributed to placement. It is HANDOFF §2.4 arriving from the
   * other side: the diagnosis named a real number and the wrong mechanism, and
   * the real mechanism — a placement predicate that was never called — is
   * quieter and worse, because a body inside a wall is not a body you can see
   * is missing.
   *
   * ── THE SEARCH ────────────────────────────────────────────────────────
   *
   * The first try is the shipped ring, angle for angle, so the nineteen bodies
   * in twenty that were already standing on good ground do not move by a
   * centimetre and consume exactly one draw from `rng` as they always did. Only
   * a rejected point pays for a retry, and a retry widens: `DEPLOY_WIDEN` a
   * ring at a time, with the angle re-jittered inside the same rear fan, so a
   * line pressed against a wall walks out into the open rather than around the
   * commander's front. `DEPLOY_TRIES` at `DEPLOY_WIDEN` puts the last ring at
   * 21.4 m, which is inside the 30 m `command.mjs` holds a deployment to.
   *
   * `placementClear` is both halves at once — `spawnClear` and `bladeClear` —
   * because "is this somewhere a body can arrive" already has two clauses and
   * this caller needs both. `nudgeFromSwing` still runs first and is still
   * unconditional: it is the reflection that cannot fail, and testing after it
   * is what makes the blade clause a check rather than a hope.
   */
  _standingRoom(w, anchor, face, i, count, spread, out) {
    for (let k = 0; k < DEPLOY_TRIES; k++) {
      const a = face
        ? (face.facing ?? 0) + Math.PI + spread * REAR_FAN
          + (rng() - 0.5) * (k ? REAR_FAN * 0.5 : 0.22)
        : (i / Math.max(1, count)) * TAU + rng() * (k ? 1.4 : 0.4);
      const r = 4 + (i % 3) * 2.2 + k * DEPLOY_WIDEN;
      out.set(anchor.x + Math.sin(a) * r, 0, anchor.z + Math.cos(a) * r);
      nudgeFromSwing(w, out);
      if (w.terrain) {
        // Never off the edge of the world: a trooper deployed outside the
        // heightfield is exactly the unreachable body the wave watchdog exists
        // to catch, and putting one there on purpose is worse than catching it.
        // A rejection now, rather than the anchor itself: falling back to the
        // commander's own feet put the whole line inside one another on a
        // ground whose edge the ring had reached.
        if (!w.terrain.inBounds(out.x, out.z, 8)) continue;
        out.y = w.terrain.height(out.x, out.z);
      }
      if (placementClear(w, out.x, out.y, out.z)) return true;
    }
    return false;
  }

  /** Every commander's army onto the field at once. Returns the total. */
  deployAll(opts = {}) {
    let n = 0;
    for (const c of this.commanders) n += this.deploy(c, opts);
    return n;
  }

  /**
   * TAKE THE ARMY OFF THE FIELD BETWEEN AREAS, KEEPING EVERY RECORD.
   *
   * The header of `Trooper` says "the Enemy is disposed at the end of every area
   * and rebuilt at the start of the next one", and that sentence was a claim
   * about a method WITH NO CALLER ANYWHERE IN THE TREE — `grep -rn 'recall'
   * src/` found the definition and nothing else. So the army never came off the
   * field: survivors stayed scattered wherever the last wave left them, up to
   * eighty metres out, and the next area opened with your line already broken
   * and no gunship having brought it in.
   *
   * It also could not have been called safely as it stood. It nulled `t.body`
   * and left the BODY standing — a live, party-team Enemy with no name on it —
   * and `deploy()` builds a fresh body for every record whose `body` is null. One
   * call would have doubled the army, and the second copy would have been
   * nameless, unpromotable and immortal to the roster.
   *
   * So the withdrawal is a real one. The trooper is detached FIRST, because
   * `onDeath` reads `e.trooper` to decide whether a death is a casualty or a
   * kill — a body coming off the field at an area boundary is neither, and the
   * record it belonged to must stay alive. Then it leaves by the same door every
   * other body leaves by (see `Waves._retire`), so the corpse ledger frees it.
   *
   * @returns how many bodies were withdrawn.
   */
  /**
   * ══ AND BACK ONTO THE NEXT GROUND — the other half of `recall` ══
   *
   * `recall` takes the army off the field so the records survive the bodies,
   * and for a ground change those records then had nowhere to go: `loadLevel`
   * builds a NEW director and its constructor musters a fresh roll, so the
   * line the player had just walked up a ramp with was replaced by strangers
   * between one map and the next. The player saw both halves of it — "the
   * troops that got on were cleared off the ship and a new set of troops came
   * in… the promoted guy wasn't in the game anymore but he still was on the
   * troop list."
   *
   * THE FRESH ROLL IS DROPPED, NOT MERGED. Those men were mustered by a
   * constructor that had not been told a line already existed; keeping them
   * would double the army on every crossing. Nothing has been built for them
   * yet — `deploy()` has not run — so there is nothing on the field to clean
   * up, and the purse the muster set is left alone because it belongs to the
   * area rather than to the roll.
   *
   * TOPPING UP IS SOMEBODY ELSE'S JOB and deliberately so: `World._musterSkirmish`
   * recruits up to the battle's strength and `_musterOpening` fills a campaign's
   * opening, and both count what is already on the roster. So a line of six
   * that crosses arrives as six and is topped up to ten by the caller — which
   * is the behaviour asked for, "I want those guys to stay with me when other
   * troops get added".
   *
   * @returns how many men crossed.
   */
  reinstate(men, c = this.commander) {
    if (!c?.roster || !Array.isArray(men) || !men.length) return 0;
    c.roster.all.length = 0;
    c.roster.taken.clear();
    const n = c.roster.adopt(men);
    /* The lineup is what the muster screen and `_musterJoin` read as "what this
     * army is made of", and it was written from the roll this call just
     * replaced. */
    c.lineup = c.roster.living.map((t) => t.type);
    return n;
  }

  recall(c = null, opts = {}) {
    if (!c) { let n = 0; for (const k of this.commanders) n += this.recall(k, opts); return n; }
    /* Anything still in the air is not coming: `Waves.reset` empties the
     * staging list at an area boundary anyway, and a record left in this set
     * would never be deployed again. */
    for (const t of c.roster.all) this._inbound.delete(t);
    let n = 0;
    for (const t of c.roster.all) {
      const e = t.body;
      /* A WITHDRAWAL ENDS EVERY PRIVATE ORDER. `t.order` is a man out of step
       * with his unit and `t.runner` is a man crossing ground that is about to
       * stop existing; both are facts about an engagement, and the company
       * that lands in the next area forms up as a company. */
      t.order = null;
      t.runner = null;
      /**
       * ══ AND THE MEN WHO ARE STILL STANDING STAY STANDING ══════════════════
       *
       * The player, on the area boundary: "after finishing a round and calling
       * in reinforcements you leave that menu and you're now by yourself until
       * a couple seconds later the reinforcement ships come in and drop your
       * new troops off — however for sake of immersion it would make more
       * sense if the troops that survived stayed with you on the ground and
       * the only troopers coming in with the ships would be new troopers.
       * Right now your surviving troops get off the transport with the new
       * troops."
       *
       * They did, and this was the line that did it. `_areaClear` withdrew the
       * WHOLE roll — the six men who had just held the ground along with the
       * four who were about to be bought — so the muster opened over an empty
       * field and closed on a flight of gunships carrying men who had never
       * left. A survivor riding in on the transport that is supposed to be
       * bringing his replacements is the mode telling you its own casualty
       * list does not mean anything.
       *
       * `deploy` has always skipped a record that already has a live body
       * (`if (t.body && !t.body.dead) continue`), so keeping the body is the
       * whole fix: the ships then carry exactly the men with no body, which is
       * the dead being replaced and nobody else. What re-forms the survivors
       * is the thing that always re-forms them — they are under a formation
       * solved against the commander's frame, so they walk back in on their
       * own feet while the ships come down, which is the picture the player is
       * asking for and not a second mechanism.
       *
       * ONLY WHERE IT IS ASKED FOR. The end of a campaign and a departing
       * commander's army both still take every body off the field, because
       * there is no next area for anybody to be standing in.
       */
      if (opts.keepStanding && e && !e.dead) continue;
      t.body = null;
      if (!e) continue;
      e.trooper = null;
      if (e.dead) continue;
      e.dead = true;
      /**
       * `dying` IS THE EXIT, AND IT WAS 0 — WHICH IS THE WHOLE OF NOTE #5.
       *
       * "every time you select additional reinforcements in command mode the
       * new troops arrive but the issue is that the previous surviving troops
       * become frozen and totally inanimate and are lost essentially."
       *
       * They were. `World`'s enemy loop disposes a body when `update` returns
       * falsy, and for a dead one that is `this.dying < 40` — forty seconds.
       * And `Enemy.update` on a dead body poses NOTHING: it advances the
       * dying clock, steps the actor and returns. A body killed in combat
       * looks right through that window because its death ragdolled it; a body
       * WITHDRAWN never went limp, so what stands there is a soldier in a walk
       * pose, perfectly still, for forty seconds — while the muster screen
       * opens over the top of it and the replacements land alongside.
       *
       * A withdrawal is not a death and it is not a corpse. `dying` past the
       * ceiling makes the body leave on the very next frame through the door
       * every other body leaves by, which is also what keeps `Corpses` from
       * spending any of its budget on ten men who walked away.
       */
      e.dying = 1e6;
      /* AND IT LEAVES THE FRAME LIKE SOMETHING LEFT. A withdrawal with no
       * mark on it reads as a body deleted, which is the other half of "lost
       * essentially" — so the same dust a hard landing makes, at the feet of
       * everyone getting on the ship. */
      this.world?.particles?.sandPuff?.(e.position.clone(), 1.6,
        this.world.terrain?.height(e.position.x, e.position.z) ?? e.position.y,
        this.world.groundColor);
      // No score, no kill, no casualty: `World.onEnemyKilled` returns before it
      // pays anything for a body that is not on team 1, and `onDeath` sees no
      // trooper on it.
      this.world?.onEnemyKilled?.(e, null, 'recall');
      n++;
    }
    return n;
  }

  /* ── orders ────────────────────────────────────────────────────────── */

  /**
   * GIVE AN ORDER.
   *
   * The whole of the command interface is this one call plus `FORMATIONS`. It
   * is deliberately not a state machine: a formation is a standing order that
   * holds until the next one, which is how an order works and also the only
   * design that survives the player being busy with a lightsaber.
   */
  order(id, cmdr = null, squad = null) {
    /**
     * THREE KINDS OF ORDER THROUGH ONE DOOR, and the door is not widened by
     * restating what each kind is anywhere else.
     *
     * `main.js`'s key loop, the order wheel and `World.applyOrder` all call
     * exactly this, so a verb that is reachable here is reachable from a key,
     * from the wheel and from a joining commander's machine at the same
     * moment, with no second dispatch to keep in step. `ORDERS` is the
     * membership test for all three.
     *
     * HOLD CAME IN THROUGH THIS DOOR AND FELL STRAIGHT THROUGH IT. `hold()`
     * on a client sends `requestOrder('hold')`; the host answers it by calling
     * this method, which tested `FORMATIONS['hold']`, found nothing and
     * returned false. A joining commander could not hold ground — the one
     * order in the mode that is a toggle was the one order that did not cross
     * the wire — and nothing could see it, because both halves were doing
     * exactly what they said. It is answered here, where the id arrives, and
     * by CALLING `hold` rather than by repeating what it does.
     */
    if (id === 'hold' || id === 'hold:off') {
      /* `hold` is the TOGGLE and `hold:off` is the explicit release, because
       * that is what the two spellings already mean on the sending side: the
       * shell sends `hold:off` only when a caller passed `false`, and every
       * other press — the wheel's, which takes no argument — arrives as
       * `hold`. Reading `hold` as "on" instead would give a joining commander
       * a switch that cannot be switched back. */
      this.hold(id === 'hold:off' ? false : null, cmdr);
      return true;
    }
    const P = COMMAND_FORCE[id];
    if (P) return this.castForce(id, cmdr);
    const F = FORMATIONS[id];
    if (!F) return false;
    /**
     * A COMMANDER WHO IS NOT HOLDING THE ARMY CAN ONLY ASK FOR IT.
     *
     * `main.js` binds the order keys to this method on whichever machine
     * pressed them, and the bodies exist on the host alone — so on a joining
     * player's machine this used to re-pose ten troopers that were never
     * deployed and the real line did not move a metre. There was no path from
     * that key to a body anywhere in the tree.
     *
     * The request goes to the host and NOTHING is written here, deliberately:
     * the indicator must not read `wedge` while the army is still in line. It
     * updates when the host's next `army` message says the order was taken,
     * which is the same round trip the roster and the casualty list already
     * make, and it is the only version of this that cannot lie.
     */
    /* …AND THE SQUAD GOES WITH IT. A shell that asked for the formation alone
     * threw the joining player's own selection away at the wire: their Target
     * slot moved a field nobody transmitted, and every order they gave went
     * army-wide. */
    if (this._netShell) return this.world?.requestOrder?.(id, squad) ?? false;
    const c = cmdr || this.commander;
    /**
     * ── THE SECOND PRESS SENDS A MAN ─────────────────────────────────────
     *
     * `_takeUp` arms `c._pending` when an order is refused FOR DISTANCE, and
     * only then. The same order, at the same unit, inside `RUNNER_WINDOW` is
     * read as "then take it to them" — which is what a player does with a
     * button that just told them nobody heard it.
     *
     * It returns TRUE and writes nothing. The order has not landed; it is on
     * its way, and saying so is the honest answer to "did that do anything".
     * The write happens in `_runnerTick` when he arrives, through this same
     * method, with his own body as the mouth.
     *
     * NOT WHILE HE IS DELIVERING (`_carrying`), or the delivery would re-arm
     * the window off its own refusal and dispatch a runner to carry the order
     * the runner just carried.
     */
    if (!this._carrying && c._pending) {
      const P = c._pending;
      const key = squad == null ? null : Number(squad) | 0;
      const now = this.world?.time || 0;
      if (P.id === id && P.squad === key && now - P.at <= RUNNER_WINDOW) {
        c._pending = null;
        if (this._sendRunner(id, squad, c)) return true;
      }
    }
    /**
     * ── ONE SQUAD, OR ALL OF THEM ────────────────────────────────────────
     *
     * `formation` was a property of the COMMANDER and nothing else, so every
     * squad he led always did the same thing and the count in `onOrder(F, n)`
     * was only ever how many squads were about to do it together. The player
     * spotted it exactly: "sometimes it'll say 2 squads but they get ordered as
     * one."
     *
     * `squad` names one to move; null moves the army, which is the old
     * behaviour and stays the default so every existing caller — the wheel,
     * the key bindings, the net shell — keeps working untouched. A per-squad
     * order is remembered in `c.squadOrders` and read by `_formationFor`; an
     * army-wide order CLEARS those, because "everyone form wedge" has to mean
     * everyone and not "everyone who has not been told otherwise". */
    if (squad != null) {
      /**
       * …AND A SQUAD NOBODY ANSWERS TO IS NOT A SQUAD.
       *
       * `cycleSquad` clamps the selection when the player presses Target, and
       * that is the only moment it clamped — so selecting 2nd Squad, losing
       * 2nd Squad and then pressing an order key wrote `squadOrders['1']` and
       * a plant on nobody, fired `onOrder` so the panel printed "Squad 2 —
       * take cover", toasted it, and did nothing whatever on the field. An
       * order that vanishes silently is worse than one that is refused, and
       * this is the door every path goes through: the keys, the wheel and the
       * wire.
       *
       * It also pushed a `delegate` row with `name: null, n: 0`, which the
       * interlude renders as "held the ground on their own — 0 men".
       */
      const men = this.squadsOf(c)[Number(squad) | 0];
      if (!men || !men.some((t) => t.alive !== false)) {
        this.orderRefused = `${this.squadLabel(Number(squad) | 0, c)} has nobody left to take it`;
        if (c === this.commander) {
          this.world?.notify?.('NOBODY ANSWERS', this.orderRefused);
          /* …and the selection goes with them, so the next order is the
           * army's rather than another one into an empty number. */
          if (this.selectedSquad === (Number(squad) | 0)) {
            this.selectedSquad = null;
            this.onTarget?.(null, null);
          }
        }
        return false;
      }
      const ask = this._ask(F, c, men, squad);
      if (!this._takeUp(ask, F, c, id, squad, men.length)) return false;
      const key = String(squad);
      (c.squadOrders || (c.squadOrders = new Map())).set(key, id);
      /**
       * ── AND THE SQUAD IS GIVEN ITS OWN GROUND, WHICH IS THE DELEGATION ──
       *
       * `c._planted` is ONE frame per commander. So a squad told to hold a
       * ridge was planted on wherever the GENERAL happened to be standing when
       * the order left his mouth, and a second squad told to hold a gate
       * overwrote the first's ground with the general's position again. Two
       * squads could be given two orders and never two places, which is the
       * whole of what "delegation" has to mean and the reason PLAN.md §6 puts
       * this ahead of density: a command interface that cannot put a squad
       * somewhere is a command interface that does not scale past one line
       * around one body.
       *
       * The ground is taken from the SQUAD and not from the commander — the
       * centroid of its living men, facing where its leader is facing. That is
       * the sentence a player means by "hold here": here is where THEY are, not
       * where I am, and it is what lets the general give the order and walk
       * away, which is the only test of a standing order that matters.
       *
       * An ADVANCING order clears it, for the same reason `c._planted` is
       * nulled below: a squad told to charge is not holding anything, and a
       * stale plant would quietly re-anchor it the next time the army held.
       */
      const sp = (c.squadPlanted || (c.squadPlanted = new Map()));
      if (!F.advance || c.holding) sp.set(key, this._squadFrame(c, squad));
      else sp.delete(key);
      /* A NEW ORDER ABANDONS A HALF-DUG POSITION. The hole in the ground is
       * permanent once it is finished — it is terrain — but the work is not
       * banked: a squad pulled off a scrape and sent back to it starts again,
       * which is what stops "dig in, charge, dig in" being a way to have the
       * position without ever standing still for it. See `_digTick`. */
      c.digs?.delete(key);
    } else {
      const all = this.led(c).filter((t) => t.alive !== false);
      const ask = this._ask(F, c, all, null);
      if (!this._takeUp(ask, F, c, id, null, all.length)) return false;
      c.squadOrders?.clear();
      /* An army-wide order takes every squad's private ground back with its
       * private order, for the reason the clause above gives about `squadOrders`
       * itself: "everyone form wedge" has to mean everyone. */
      c.squadPlanted?.clear();
      c.digs?.clear();
      c.formation = id;
    }
    // A formation that does not advance is planted where the commander was
    // STANDING when the order was given — see `_anchorFor`. So is one the
    // commander has told to HOLD, which is the same mechanism as a decision
    // rather than as a property of one order.
    /**
     * …AND ONE SQUAD'S ORDER DOES NOT MOVE THE ARMY'S GROUND.
     *
     * `c._planted` is the ARMY's frozen frame, and this line ran on both
     * branches with `F` bound to whichever formation was just given. So
     * ordering 2nd Squad to CHARGE — an advancing formation — nulled the
     * army's plant, and every OTHER squad, which was holding cover on ground
     * it had been given, silently snapped back to following the commander.
     * One squad's order un-planted the rest of the line.
     *
     * A per-squad order writes a per-squad plant (above) and nothing else. The
     * army's ground is the army's, and only an army-wide order moves it.
     */
    if (squad == null) {
      c._planted = (F.advance && !c.holding) ? null : this._frame(c, new THREE.Vector3());
    }
    // A new order is a new choice of cover. See `_coverSite`.
    this._coverEpoch = (this._coverEpoch | 0) + 1;
    this.log.push({ t: 'order', formation: id, area: this.areaNumber, wave: this.wave });
    /**
     * …AND THE HUD IS TOLD WHICH ORDER IT IS.
     *
     * `onOrder` repaints the one persistent order display on screen, and it
     * fired for a per-squad order too — while the per-squad branch above
     * deliberately does NOT set `c.formation`. So ordering 2nd Squad to take
     * cover lit "Take cover" across the army's panel while the army was still
     * in line abreast: the only always-visible statement of what your men are
     * doing, saying something no squad was doing.
     *
     * The squad index goes with it, so a HUD that wants to say "2nd Squad —
     * take cover" can, and one that only understands the army's order can test
     * for null.
     */
    if (c === this.commander) {
      this.onOrder?.(F, this.liveSquads(c).length,
        squad == null ? null : { squad: Number(squad) | 0, name: this.squadLabel(Number(squad) | 0, c) });
    }
    /**
     * AND A STANDING ORDER IS SAID IN THE NAME OF THE MAN WHO NOW HAS IT.
     *
     * A squad given its own ground is a squad the general is no longer
     * responsible for, and the only thing that makes that legible is knowing
     * WHO is responsible instead. `leaderOf` is derived from rank, so this is
     * the same man `onDeath` announces the succession of — one sergeant, named
     * the same way in both places, which is what turns a roster row into
     * somebody the player recognises when he is the one still standing.
     *
     * Only for the player's own commander and only for a squad that was
     * actually given ground: an advancing order is not a standing one, and
     * saying so would make the announcement noise on every wheel press.
     */
    if (c === this.commander && squad != null && c.squadPlanted?.has(String(squad))) {
      const men = this.squadsOf(c)[Number(squad) | 0] || [];
      const lead = this.leaderOf(men);
      const n = men.filter((t) => t.alive !== false).length;
      if (lead) {
        this.world?.notify?.(
          `${this.squadLabel(Number(squad) | 0, c).toUpperCase()} HAS THE GROUND`,
          `${lead.rankRec.title.toLowerCase()} ${lead.name} — ${F.name.toLowerCase()}, `
          + `${n} ${n === 1 ? 'man' : 'men'}, and they stay there without you`);
      }
      this.log.push({ t: 'delegate', formation: id, squad: Number(squad) | 0,
                      name: lead?.name || null, n, area: this.areaNumber, wave: this.wave });
    }
    return true;
  }

  /**
   * HOLD THIS GROUND — and let go of it. A toggle over whatever formation is
   * up, and NOT the HOLD FIRE order.
   *
   * Two different things wearing one word, so both spellings are used out
   * loud: this holds the GROUND (a modifier on any formation), `holdfire`
   * holds the FIRE (a formation, because it is what the line is doing rather
   * than where). They compose — hold fire, then hold the ground you are
   * holding fire on — and each is useless as a version of the other.
   *
   * "there should be an option where you can tell your troops to get into a
   * certain formation and hold it and stay there regardless of where you are,
   * like obviously they should still be able to turn and fight new enemies
   * from different angles but they would just hold their position."
   *
   * Every clause of that falls out of planting the FRAME and changing nothing
   * else: the shape is solved against the planted anchor so it stays where it
   * was put; the leash is unchanged so a body still steps out to fight; and
   * `Enemy` faces whatever it is shooting at, which was never a function of
   * the formation. What is held is the ground, not the heads.
   *
   * @returns the new state.
   */
  hold(on = null, cmdr = null) {
    const c = cmdr || this.commander;
    if (this._netShell) { this.world?.requestOrder?.(on === false ? 'hold:off' : 'hold'); return c.holding; }
    const want = on === null ? !c.holding : !!on;
    c.holding = want;
    const F = FORMATIONS[c.formation] || FORMATIONS[DEFAULT_FORMATION];
    c._planted = (F.advance && !want) ? null : this._frame(c, new THREE.Vector3());
    /**
     * ON ME MEANS ON ME, INCLUDING THE SQUADS THAT WERE ONLY STANDING STILL
     * BECAUSE THE ARMY WAS.
     *
     * A squad carrying an ADVANCING order sits still while the army holds —
     * `_anchorFor` reads the hold before it reads the order — and it is
     * planted at the moment the hold lands so it holds where it is rather than
     * teleporting to wherever the general was. Releasing the hold has to give
     * that ground back, or the release is a lie for exactly the squads that
     * were told to move.
     *
     * A squad whose OWN order does not advance keeps its ground through both,
     * which is the point of having given it one: "hold the gate" outlives "on
     * me". Letting go of that ground is a second order to that squad.
     */
    for (const [k, id] of (c.squadOrders || [])) {
      const SF = FORMATIONS[id];
      if (!SF) continue;
      const sp = (c.squadPlanted || (c.squadPlanted = new Map()));
      if (!SF.advance) continue;
      if (want) sp.set(k, this._squadFrame(c, k));
      else sp.delete(k);
    }
    this.log.push({ t: 'hold', on: want, area: this.areaNumber, wave: this.wave });
    if (c === this.commander) {
      this.world?.notify?.(want ? 'HOLD THIS GROUND' : 'ON ME',
        want ? `${F.name.toLowerCase()}, and they stay where you put them`
          : `${F.name.toLowerCase()}, and they come with you`);
    }
    return want;
  }

  /* ── the commander's own Force ─────────────────────────────────────── */

  /**
   * IS THIS VERB READY, AND IF NOT WHY NOT — one rule, three readers.
   *
   * `castForce` asks it before it spends anything, a check asks it to prove
   * the cooldown exists, and a HUD that greys a wheel slot should ask it too
   * rather than deciding for itself what "ready" means. That last one is the
   * reason it returns a REASON and not a boolean: every refusal in this game
   * says what it wants (see `Player._refuse`, and the note over it about a
   * bound key that does nothing being the same lie as a dead checkbox).
   *
   * @returns null when it is ready, else the sentence to say.
   */
  castReady(id, c = this.commander) {
    const P = COMMAND_FORCE[id];
    if (!P) return 'no such order';
    const left = (c._castCd && c._castCd[id]) || 0;
    if (left > 0) return `recovering — ${left.toFixed(1)}s`;
    const p = c.player;
    /* An army with no living commander has nobody to reach through the Force,
     * which is the same statement `_frame` makes when it falls back to the
     * anchor: a leaderless line holds the ground it was on. */
    if (!p || p.alive === false || p.dead) return 'you are not there to give it';
    /* PRICED BY THE PLAYER, NEVER HERE. `_canSpend` is the expression the Force
     * Drain slider and the `forceCost` boons both live in, and `_priceOf` is
     * the one that renders it — quoting `P.cost` in this sentence instead is
     * exactly the defect the note over `Player._priceOf` records, where eight
     * refusals named a list price the game does not charge. A commander with
     * no Force economy at all (a RemoteAvatar, a stub in a check) pays
     * nothing, which is the same fails-open rule the rest of this file uses. */
    if (typeof p._canSpend === 'function' && !p._canSpend(P.cost)) {
      const price = typeof p._priceOf === 'function' ? p._priceOf(P.cost) : P.cost;
      return `${price} Force needed, you have ${Math.round(p.force ?? 0)}`;
    }
    return null;
  }

  /**
   * CAST ONE OF THE TWO — see COMMAND_FORCE for what they are and why two.
   *
   * Structured the way every power in `Player.js` is, and in the same order,
   * because a power that pays before it checks is a power that can charge you
   * for nothing: ask, refuse out loud, spend, then act. What is different is
   * only what "act" means — this reaches a LIST rather than a body, and it
   * ends in state that already existed on the far side (`Enemy.rallyTimer`,
   * `Enemy.dread`, `Waves.holdFire`, `MORALE`) rather than in anything new.
   *
   * @returns whether it actually went off.
   */
  castForce(id, cmdr = null) {
    const P = COMMAND_FORCE[id];
    if (!P) return false;
    /* THE SAME ASK EVERY OTHER ORDER MAKES. A client holds no bodies, so a
     * verb cast there would light no one — the request goes to the host and
     * comes back as the roster feed, exactly as `order` and `recruit` do. */
    if (this._netShell) return this.world?.requestOrder?.(id) ?? false;
    const c = cmdr || this.commander;
    const why = this.castReady(id, c);
    if (why) {
      c.player?._refuse?.(P.name, why);
      return false;
    }
    const p = c.player;
    if (typeof p._spend === 'function' && !p._spend(P.cost)) return false;
    (c._castCd || (c._castCd = {}))[id] = P.cd;

    const A = this._frame(c, _v1);
    const n = P.cast(this, P, c, A) | 0;
    this.log.push({ t: 'force', id, reached: n, area: this.areaNumber, wave: this.wave });
    /* The same door every power in Player.js ends in, and the record names
     * which of its five voices this one has. Audio.js is not this file's to
     * extend, so the choice is between what already exists rather than a new
     * synthesis nobody would hear until it shipped. */
    audio.force?.(A.pos, P.sound);
    if (c === this.commander) {
      this.world?.notify?.(P.name.toUpperCase(),
        n ? P.reached(n) : 'nothing was in reach of it');
    }
    return true;
  }

  /* ── what the army can be asked for, by anything ───────────────────── */

  /**
   * THE THREE VERBS THAT ARE NOT ORDERS, and why they are methods rather than
   * order ids.
   *
   * `rallyNear`, `reinforce` and `reviveNear` are the effects a caller OUTSIDE
   * this file needs on an army: `src/game/Stratagems.js` — the support-call
   * system, entered as a WASD code — reaches for all three by name and guards
   * on their absence, so until they existed its Rally, its Reinforcements and
   * the second half of its Resupply were dead calls that spent Force and did
   * nothing. They are implemented here because this is the file that owns a
   * roster, a muster purse, an anchor and a gunship, and a second answer to
   * "put four more men on the field" would be the twin this repository keeps
   * deleting.
   *
   * `rallyNear` is also what `castForce('rally')` runs, which is the point: the
   * order wheel and a stratagem code are two ways to say one thing, not two
   * things that happen to look alike. What differs is only what each pays —
   * the wheel pays `COMMAND_FORCE.rally.cost` through the Player's own spender,
   * the stratagem pays its own — and neither of them decides what a rally IS.
   */

  /**
   * STEADY EVERY MAN OF THIS ARMY WITHIN `radius` OF `at`.
   *
   * `INSPIRED` is 0.16 and `BREAK` is 0.24, so a rally lifts any man whose
   * nerve is still above 0.08 back over the line: every soldier who has not
   * already stopped answering, and nobody who has. That is not a threshold
   * this method picked — it is two numbers in the MORALE table multiplied
   * out, and it is the property worth having, because "get to them, or lose
   * them" needs a version of getting to them that is not standing next to
   * them for eleven seconds.
   *
   * The FIGHTING comes back through `Enemy.rallyTimer`, which is the aura the
   * Leader modifier already grants and which `_shoot`, `_move` and the duel
   * brain already read. Nothing here decides what a rallied body does.
   *
   * @returns how many were in earshot.
   */
  rallyNear(at, radius, c = this.commander, seconds = COMMAND_FORCE.rally.seconds) {
    if (!at || !c) return 0;
    const r2 = radius * radius;
    const list = [];
    for (const t of c.roster.living) {
      const e = t.body;
      if (!e || e.dead) continue;
      if (dist2(e.position, at) > r2) continue;
      list.push(t);
      e.rallyTimer = Math.max(e.rallyTimer || 0, seconds);
      e.cry?.('cheer', 1.4);
    }
    /* A man who was running stops running THIS frame rather than at the top of
     * the next one: `steer` reads `t.broken`, `shake` rewrites it, and the
     * order of those two is what decides whether the rally you can hear is the
     * rally you can see. */
    this.shake(list, 'INSPIRED', c);
    return list.length;
  }

  /**
   * MORE OF YOURS, NOW, WITHOUT WAITING FOR THE MUSTER SCREEN.
   *
   * AND IT IS PAID FOR, which is the whole design and the reason this is not a
   * free respawn wearing a gunship. Note #21's premise is that a loss is
   * permanent and a replacement has to be BOUGHT — `autoMuster`'s own header
   * says so in as many words — so a mid-battle reinforcement spends exactly
   * what a reinforcement at the muster spends, out of the same purse, at the
   * same prices, through the same `recruit`. What the call actually buys is
   * TIMING: the points you were saving for the next area, landed beside you in
   * the fight you are losing now.
   *
   * The cheapest rung, deliberately. A support call that let a player buy four
   * ARC troopers the moment they could afford them would make the muster
   * screen — where the choice of WHICH body is the entire decision — the slow
   * way to do the same thing.
   *
   * @returns how many actually came.
   */
  reinforce(n = 4, opts = {}, c = this.commander) {
    if (this._netShell || !c) return 0;
    const cheapest = c.army.tiers[0].type;
    let bought = 0;
    this._bulk = true;
    try {
      for (let i = 0; i < n; i++) if (this.recruit(cheapest, c)) bought++;
    } finally { this._bulk = false; }
    if (!bought) {
      /* Silent refusal is the thing `Player._refuse` exists to stop. The
       * caller has already spent something to get here. */
      if (c === this.commander) {
        this.world?.notify?.('NO REINFORCEMENTS',
          this.refused || `${c.roster.points} reinforcement points left`);
      }
      return 0;
    }
    this.world?.publishMuster?.(c);
    /* `byShip` by default: this is the one moment the mode's brief describes —
     * men coming off a ramp — and unlike `deploy`'s mid-wave replacements the
     * four seconds of flight is the point rather than a hole in the line. The
     * caller may still turn it off, and every headless check does. */
    this.deploy(c, { byShip: opts.byShip !== false });
    this.log.push({ t: 'reinforce', n: bought, area: this.areaNumber, wave: this.wave });
    return bought;
  }

  /**
   * THE WOUNDED BACK ONTO THEIR FEET — heal, and un-ragdoll.
   *
   * Two different states and both of them are what a player means by "down":
   * a trooper on a fifth of its health, and a trooper lying limp after a blast
   * that did not kill it. `Enemy.recover` is the one door for the second — it
   * is what `_tickGetUp` calls after a body has been still long enough — so
   * this asks for it early rather than reimplementing a stand-up.
   *
   * A HALF OF MAXIMUM, NOT A FULL HEAL. A support pod that undid a firefight
   * would make the firefight not matter; what it does is take a squad that
   * cannot survive the next volley and make it able to.
   *
   * @returns how many it reached.
   */
  reviveNear(at, radius, c = this.commander) {
    if (!at || !c) return 0;
    const r2 = radius * radius;
    let n = 0;
    for (const t of c.roster.living) {
      const e = t.body;
      if (!e || e.dead) continue;
      if (dist2(e.position, at) > r2) continue;
      const want = (e.maxHp || 0) * 0.5;
      if (e.hp < want) e.hp = Math.min(e.maxHp, want);
      if (e.actor?.ragdolled) e.recover?.();
      n++;
    }
    return n;
  }

  /**
   * DREAD — the line in front of you, and it is deliberately not a weapon.
   *
   * Four things happen to every body it reaches and not one of them is a
   * damage number:
   *
   *   the SHOT      `holdFire` — Waves.js's own primitive, the same one the
   *                 HOLD FIRE order uses. The burst it was in the middle of is
   *                 gone and the fuse goes back up. (That sentence was written
   *                 before the order was, and was false for as long as every
   *                 formation declared `fire: 1` — see the note above
   *                 FORMATIONS. It is true now and a check holds it.)
   *   the AIM       `Enemy.dread`, read by `aimQuality` beside morale. See the
   *                 DREAD record in Enemy.js for why the term is there rather
   *                 than here: a campaign's enemy carries no roster record, so
   *                 a verb that only lowered morale would do nothing at all in
   *                 the mode it was written for.
   *   the FOOTING   a shove with a literal 0 of damage, through the same
   *                 `applyKnockback` every Force power in the game ends in —
   *                 so it is answered by the target's own Force pool, it
   *                 breaks whatever they were casting, and it is under the
   *                 12 m/s that would knock them off their feet, because this
   *                 is a line recoiling and not a line being thrown.
   *   the NERVE     `SHAKEN`, but only where there is a record to shake. In a
   *                 meeting that is the other player's roster and it is the
   *                 whole point; in a campaign there is none and the three
   *                 above are the entire effect.
   *
   * ONLY THE HORDE AND OTHER ARMIES, never a player. A human on the other end
   * of a meeting is not a body this verb is allowed to reach into: the state
   * it hands out is unreadable from inside — you would be shooting worse for
   * six seconds with nothing on your own screen to say so — and every other
   * power in this game announces itself to the person it lands on by moving
   * them. `world.enemies` is the list, which is that rule expressed as the
   * only list it walks.
   */
  _castDread(P, c, A) {
    const r2 = P.radius * P.radius;
    /**
     * THE LIVE HEADING, NOT THE FORMATION'S.
     *
     * `_frame` returns the SLEWED yaw, and that is exactly right for what it
     * is for: a formation should not swing around the player every time they
     * look somewhere, so it holds inside a 40° deadband and turns at 1.1 rad/s
     * afterwards (see FRAME_DEADBAND). A power is the other kind of thing. It
     * is thrown at what you are pointing at in the moment you throw it, and a
     * cone that lagged the mouse by up to a quadrant would be a verb that
     * missed the rank you were plainly aiming at. Position from the frame,
     * bearing from the body — which is the same split `Player`'s own powers
     * make between where you stand and where you aim.
     */
    const yaw = c.player ? headingOf(c.player) : A.yaw;
    const fx = Math.sin(yaw), fz = Math.cos(yaw);
    const cosArc = Math.cos(P.arc);
    let n = 0;
    for (const e of this.world?.enemies || []) {
      if (!e || e.dead || e.alive === false) continue;
      if (e.team === c.side) continue;
      const dx = e.position.x - A.pos.x, dz = e.position.z - A.pos.z;
      const d2 = dx * dx + dz * dz;
      if (d2 > r2 || d2 < 1e-6) continue;
      const d = Math.sqrt(d2);
      if ((dx * fx + dz * fz) / d < cosArc) continue;
      n++;
      e.dread = Math.max(e.dread || 0, P.seconds);
      holdFire(e);
      _v2.set(dx / d, 0.18, dz / d).multiplyScalar(DREAD.recoil);
      if (e.applyKnockback) e.applyKnockback(_v2, 0, c.player);
      else e.breakCast?.();
      e.cry?.('panic', 1.2);
      /* …and where the body is somebody's soldier rather than the composer's,
       * the same event goes on the record through the one door that writes
       * morale. `commanderOf` answers for whichever army it belongs to. */
      /* …AND WHERE THERE IS NO RECORD, THE BODY'S OWN LEDGER. The note above
       * used to end "in a campaign there is none and the three above are the
       * entire effect", which is FLAGSHIP §7's complaint about this verb
       * stated by the verb itself: DREAD could not break a horde because a
       * horde had no nerve. It has one now (src/game/Nerve.js) and `shakeNerve`
       * writes it — leaving a body WITH a record to `shake` above, which is
       * still the one door that writes a name on a roll. */
      if (e.trooper) this.shake(e.trooper, 'SHAKEN', this.commanderOf(e));
      else shakeNerve(e, MORALE.SHAKEN);
    }
    return n;
  }

  /**
   * A COMMANDER'S FRAME: where they are and which way they are looking.
   *
   * `aimDir` rather than the camera yaw: the direction the commander is FACING
   * is where they are pointing the blade, and on a body that strafes those are
   * not the same thing.
   *
   * TWO FALLBACKS, AND BOTH ARE LOAD-BEARING FOR A SECOND COMMANDER. A
   * `RemoteAvatar` has no `aimDir` at all — it is a drawing of a body on
   * another machine, and what crosses the wire is `facing` — so a peer leading
   * an army would have had every formation solved against a yaw of zero and
   * pointed their whole line due north for the length of the match. And a
   * commander with no body on this machine yet falls back to the ANCHOR their
   * army was deployed on, which is a real place rather than the origin.
   */
  _frame(c, outPos) {
    const p = c?.player;
    if (!p || !p.position) {
      const a = c?.anchor;
      if (a) { outPos.copy(a); return { pos: outPos.clone(), yaw: c.facing || 0 }; }
      outPos.set(0, 0, 0);
      return { pos: outPos.clone(), yaw: 0 };
    }
    outPos.copy(p.position);
    /**
     * THE FRAME'S YAW IS THE COMMANDER'S HELD HEADING, NOT WHERE THEY ARE
     * LOOKING — and this line read `p.aimDir`.
     *
     * "it's really strange it's like your troops are locked into the direction
     * you're facing like if you were to spin they would rotate around you like
     * a clock." Exactly that, and the mechanism is one dereference: the whole
     * formation is solved in a frame whose yaw was the AIM direction, sampled
     * fresh every frame, so a flick of the mouse swung a twelve-man line
     * bodily around the player. Nothing about a formation should move when you
     * look somewhere; a squad forms up on where its commander is GOING.
     *
     * Two changes and both are needed. The source is the body heading, which
     * is the thing that means "the way I am facing" rather than "the thing I
     * am aiming at". And it is SLEWED with a deadband: inside 40° the held
     * heading does not move at all, and past it, it turns at 1.1 rad/s. That
     * is what makes the shape a shape — it holds while you fight and re-forms
     * when you commit to a new direction, instead of tracking you continuously
     * like a turret ring.
     */
    /* A PURE READER. The slew itself is advanced ONCE PER FRAME PER COMMANDER
     * in `_slewFrame`, not here: `_frame` is called from `slotFor`, which is
     * called once per trooper per frame and again from `targetFor` — so
     * stepping the turn in here would multiply the slew rate by the size of
     * the army, and a twelve-man line would track the commander twelve times
     * faster than a four-man one. */
    /**
     * …AND THE POSITION IS THE LINE'S, NOT THE PLAYER'S — FLAGSHIP §6.
     *
     *   "The objective advances at the pace of the slowest friendly inside
     *    14 m. You can sprint 200 m into their rear; the line does not come
     *    with you, and you arrive alone on an empty bar. Killing stays fast and
     *    fun and advances nothing. Measured, and nobody designed it: walking
     *    35 m forward drags the whole formation with you and costs 4 of 10
     *    men."
     *
     * `outPos.copy(p.position)` above is that accident, in one line: the frame
     * every slot is solved in WAS the player, live, at whatever pace the player
     * chose, so a Jedi at a sprint handed twelve men a destination they could
     * not reach and they strung out behind it in the open, one at a time, until
     * four of them were dead. Nobody designed that; it fell out of a
     * dereference.
     *
     * `_paceAnchor` is the same point with a speed limit on it, stepped once a
     * frame in `_advanceAnchor` at `advancePace(c)` metres a second. It is a
     * RULE now: your line moves at the pace of its slowest man, the objective
     * moves with your line, and outrunning both is a thing you may do and gain
     * nothing by.
     */
    if (c._heldYaw === null || c._heldYaw === undefined) c._heldYaw = headingOf(p);
    if (c._paceAnchor) outPos.copy(c._paceAnchor);
    return { pos: outPos.clone(), yaw: c._heldYaw };
  }

  /**
   * HOW FAST THIS COMMANDER'S LINE MAY ADVANCE, in metres a second.
   *
   * The slowest LIVING friendly inside `MORALE.NEAR` of the commander, which is
   * the same radius presence pays through — deliberately, because it is the
   * same claim from two sides: a man close enough for your presence to steady
   * him is a man close enough to be part of your advance.
   *
   * `e.speed` and not the body's measured velocity. A man who has stopped to
   * shoot has a velocity of zero and has not stopped being able to walk, so
   * pacing an advance on observed speed would freeze the line every time it
   * fired. This is a CAPABILITY: a heavy gunner's 3.0 against an ARC's 4.6, as
   * the rank multipliers left them.
   *
   * TWO DEGENERATE CASES, and each is a decision:
   *
   *   NOBODY LEFT ALIVE — the line does not exist, so nothing paces the
   *     objective and it keeps up with the player. A rule that froze a lone
   *     survivor in place would be punishing them for the deaths.
   *   NOBODY INSIDE THE RADIUS — zero. This is the whole of §6: you have
   *     outrun your line and the advance stops until you are back among them.
   *     It cannot deadlock, because the anchor stops where the men are, so
   *     walking back toward them is always available and always restarts it.
   */
  advancePace(c = this.commander) {
    const p = c?.player;
    if (!p || !p.position) return Infinity;
    const living = c.roster?.living || [];
    const r2 = MORALE.NEAR * MORALE.NEAR;
    let slowest = Infinity, anyAlive = false;
    for (const t of living) {
      const e = t.body;
      if (!e || e.dead) continue;
      anyAlive = true;
      /* A MAN ON THE GROUND DOES NOT PACE THE ADVANCE, he stops it — and he
       * stops it through the quorum (`lineGathered` does not count him) rather
       * than through this. Pacing an advance on a casualty's walking speed
       * would be an advance that carried on at a bleeding man's pace, which is
       * the one reading of §4.9 that makes recovering him optional. */
      if (e.downed) continue;
      if (dist2(e.position, p.position) > r2) continue;
      const v = e.speed || 0;
      if (v < slowest) slowest = v;
    }
    if (!anyAlive) return Infinity;
    return slowest === Infinity ? 0 : slowest;
  }

  /**
   * Step one commander's formation anchor toward them, at `advancePace`.
   *
   * ONCE A FRAME PER COMMANDER, beside `_slewFrame`, and for the identical
   * reason its own note gives: `_frame` is a pure reader called once per
   * trooper per frame, so stepping the chase in there would multiply the pace
   * by the size of the army and a twelve-man line would advance twelve times
   * faster than a four-man one.
   */
  _advanceAnchor(c, dt) {
    const p = c?.player;
    if (!p || !p.position) return;
    if (!c._paceAnchor) { c._paceAnchor = p.position.clone(); return; }
    /* The height is the player's outright. Only x and z are paced: a formation
     * anchor is a place on the ground, and `slotFor` re-solves the standing
     * height off the terrain anyway. Lagging the y would put the whole line
     * underground on a slope. */
    c._paceAnchor.y = p.position.y;
    const dx = p.position.x - c._paceAnchor.x, dz = p.position.z - c._paceAnchor.z;
    const d = Math.hypot(dx, dz);
    if (d < 1e-4) return;
    const step = this.advancePace(c) * dt;
    if (!(step > 0)) return;
    if (step >= d) { c._paceAnchor.x = p.position.x; c._paceAnchor.z = p.position.z; return; }
    c._paceAnchor.x += dx / d * step;
    c._paceAnchor.z += dz / d * step;
  }

  /**
   * Advance one commander's held heading toward where they are actually
   * facing. Once a frame, from `_troops`. See `_frame` and FRAME_DEADBAND.
   */
  _slewFrame(c, dt) {
    const p = c?.player;
    if (!p) return;
    const live = headingOf(p);
    if (c._heldYaw === null || c._heldYaw === undefined) { c._heldYaw = live; return; }
    const err = wrapPi(live - c._heldYaw);
    if (Math.abs(err) <= FRAME_DEADBAND) return;
    const room = Math.abs(err) - FRAME_DEADBAND * 0.6;
    c._heldYaw = wrapPi(c._heldYaw + Math.sign(err) * Math.min(room, FRAME_SLEW * dt));
  }

  /** The frame a formation is measured in — live, or frozen if it was planted. */
  _anchorFor(F, c = this.commander, squad = null) {
    /* `c.holding` is the HOLD toggle and it applies to whatever formation is
     * up, which is what was asked for: "there should be an option where you
     * can tell your troops to get into a certain formation and hold it and
     * stay there regardless of where you are". `cover`'s `advance: false` is
     * the same mechanism authored into one order; this is the same mechanism
     * as a decision the player makes. */
    /**
     * THE SQUAD'S OWN GROUND FIRST, IF IT HAS BEEN GIVEN ONE.
     *
     * This is where delegation actually happens: a squad with a planted frame
     * of its own solves its shape around THAT, so the general can be anywhere
     * on the field — or dead — and the squad is still standing where it was
     * put. Without this line, `order(id, cmdr, squad)` was three separate
     * squads all forming up on one body, which is one line wearing three names.
     */
    if (squad != null) {
      const own = c.squadPlanted?.get(String(squad));
      if (own && (!F.advance || c.holding)) return own;
      /**
       * …AND A SQUAD ADVANCING UNDER ITS OWN ORDER ADVANCES FROM WHERE IT IS.
       *
       * An advancing formation writes no plant, so a delegated squad fell
       * through to the commander's frame — and two squads both told to
       * advance solved the same shape around the same point. Measured: order
       * 1st Squad Vanguard, then 2nd Squad Vanguard, and all ten men landed on
       * five slots, five stacked pairs, because `front`'s slot ignores the
       * squad index entirely.
       *
       * A squad you sent forward on its own goes forward from its own ground.
       * That is also the sentence the order means: "you, go" is not "you, come
       * and stand where I am and then go".
       */
      if (c.squadOrders?.has(String(squad))) return this._squadFrame(c, squad);
    }
    if ((!F.advance || c.holding) && c._planted) return c._planted;
    return this._frame(c, _v1);
  }

  /**
   * A SQUAD'S OWN FRAME: where its men are, facing where its leader faces.
   *
   * Not the commander's position, which is the whole point — see the note in
   * `order`. Not the LEADER's position either, and that is the subtler half: a
   * shape solved around the sergeant's body puts the sergeant's own slot at an
   * offset from himself, so he walks, so the frame walks, so he walks again. A
   * centroid is fixed under the shape it anchors.
   *
   * The yaw is the leader's held heading, because a squad faces where the man
   * in charge of it is facing and there is nothing else on a squad that means
   * "forward". A squad with nobody left to lead it falls back to the
   * commander's frame, which is the old behaviour and the right one: an empty
   * squad has no ground to hold.
   */
  _squadFrame(c, squad, out = new THREE.Vector3()) {
    const men = this.squadsOf(c)[Number(squad) | 0] || [];
    let n = 0, x = 0, z = 0;
    for (const t of men) {
      const e = t.body;
      if (!e || e.dead) continue;
      x += e.position.x; z += e.position.z; n++;
    }
    if (!n) return this._frame(c, out);
    const lead = this.leaderOf(men);
    const yaw = lead?.body ? (lead.body.facing ?? 0) : (c._heldYaw ?? c.facing ?? 0);
    out.set(x / n, 0, z / n);
    return { pos: out.clone(), yaw };
  }

  /**
   * WHERE TROOPER `e` SHOULD BE STANDING, in world space.
   *
   * @returns the vector, or null if this formation has no slot (CHARGE).
   */
  slotFor(e, out = _slot) {
    /**
     * ── A MAN CARRYING AN ORDER IS NOT IN THE FORMATION ──────────────────
     *
     * This is the whole of what a runner IS on the field: one branch, at the
     * one place in the file that answers "where is this body trying to be".
     * Everything else about him — the walk, the pace, the cover he takes on
     * the way, the bolt that kills him — is the shipped soldier doing what he
     * always does toward a different point.
     *
     * That is deliberate and it is the reason he can be killed. A runner
     * implemented as a state machine of his own would need its own pathing,
     * its own reaction to fire and its own death, and the third one is the
     * mechanic. See `_sendRunner`.
     */
    const RUN = e.trooper?.runner;
    if (RUN && RUN.to) return out.set(RUN.to.x, 0, RUN.to.z);
    /* THE BODY'S OWN COMMANDER, not the machine's. `e.cmdr` is written by
     * `enlistBody` at deploy, so a trooper solves its slot in the frame of the
     * person who deployed it — which is what makes two lines face each other
     * instead of both forming up on whoever is holding the mouse. */
    const cmdr = this.commanderOf(e);
    /* The squad's OWN order if it has been given one, else the army's. See
     * `formationFor` and the note in `order`. `cmdSquad` is the index into
     * `squadsOf`, refreshed once a frame in the same loop that stamps it. */
    const F = FORMATIONS[this.formationFor(cmdr, e.cmdSquad, e.trooper)] || FORMATIONS[DEFAULT_FORMATION];
    const idx = e.cmdIndex | 0, n = e.cmdCount || 1, k = e.cmdSquad | 0;
    if (!F.slot(idx, n, k, out)) return null;
    const A = this._anchorFor(F, cmdr, e.cmdSquad);
    // Rotate the formation-local slot into the commander's frame. +Z is forward.
    const s = Math.sin(A.yaw), c = Math.cos(A.yaw);
    const x = out.x * c + out.z * s;
    const z = -out.x * s + out.z * c;
    out.set(A.pos.x + x, 0, A.pos.z + z);
    /**
     * …AND THE GROUND IT IS STANDING ON. Two callers, one hunt, and the only
     * difference between them is how far a man is allowed to walk for it.
     *
     * TAKE COVER is an ORDER and it re-solves when the order is given, so it
     * gets `COVER_HUNT` and the whole level to look through. Being SHOT AT is
     * not an order — "they should take cover when under fire" is a thing a
     * soldier does inside whatever he was already told to do — so it gets
     * `COVER_LEAN`, which is bounded by the formation's own tolerance and
     * therefore cannot turn a line abreast into twelve men behind twelve
     * crates. See both constants.
     *
     * The cache key is the epoch for the ordered hunt and the body's own fire
     * count for the reactive one, which is what makes the second re-choose
     * per BURST rather than per order: a man pinned again after the line has
     * moved picks the ground he is on now, and a man nobody is shooting at
     * falls back onto his slot the moment `underFire` lapses.
     */
    /* …AND A CAREFUL MAN IS ALWAYS LOOKING FOR SOMETHING TO GET BEHIND, which
     * is what "will not leave cover for a shot he does not like" means on the
     * ground. The REACTIVE hunt and not the ordered one: bounded by the
     * formation's own tolerance, so he finds the nearest lee INSIDE his slot
     * rather than turning a line abreast into twelve men behind twelve crates
     * — the exact failure `COVER_LEAN` exists to prevent. */
    const careful = e.trooper && hasFlag(e.trooper, 'holds');
    if (F.seeksCover) this._coverSite(e, out, A, COVER_HUNT, this._coverEpoch | 0, 0);
    else if (e.underFire > 0 || careful) this._coverSite(e, out, A, COVER_LEAN, e._fireEpoch | 0, 1);
    if (this.world?.terrain) out.y = this.world.terrain.height(out.x, out.z);
    return out;
  }

  /**
   * MOVE A SLOT TO THE LEE OF SOMETHING SOLID.
   *
   * The scatter `cover` computes is where a man goes when there is nothing to
   * get behind. Where there IS something, he gets behind it — and this level
   * is full of crates, drums, hull plates and outcrops, every one of which is
   * already a static box the physics world can be asked about.
   *
   * "Behind" is relative to the THREAT, and the honest bearing for that is the
   * mean direction of whatever is currently hostile — one vector for the whole
   * squad, so a line does not take cover on both sides of the same crate. With
   * nothing hostile on the field it falls back to the commander's own heading,
   * which is where the next thing is going to come from.
   *
   * CACHED PER BODY AND STICKY. Re-solving every frame would have a trooper
   * swapping crates as the horde moved, which is both wrong and unwatchable —
   * a man who has chosen a rock stays behind it. The choice is re-made when
   * the order is re-given, which is what `_coverEpoch` counts.
   */
  /**
   * @param cache  where the sticky answer is kept. Defaults to the BODY, which
   *   is what the two `slotFor` callers have always used. `_goToGround` passes
   *   its own object instead: a frightened man's rock and the cover his slot is
   *   leaning on are two different decisions with two different lifetimes, and
   *   one pair of fields for both would have each of them re-scanning every
   *   static box on the level on every frame the other one asked. */
  _coverSite(e, out, A, hunt = COVER_HUNT, at = 0, mode = 0, cache = null) {
    const K = cache || e;
    /* THE MISS IS CACHED TOO, and that is not tidiness. This walks every
     * static box on the level, and it is called once per trooper per frame
     * from `slotFor` — which `steer` and `targetFor` both call. Caching only
     * the HIT meant a squad standing in the open re-scanned the whole level
     * twenty-four times a frame forever, and the reactive caller made that the
     * common case rather than the rare one. A null is a decision: there was
     * nothing to get behind when this man last looked, and he looks again when
     * the order changes or the next burst arrives. */
    if (K._coverAt === at && K._coverFor === mode) {
      if (K._coverPt) out.copy(K._coverPt);
      return;
    }
    K._coverAt = at; K._coverFor = mode; K._coverPt = null;
    const boxes = this.world?.physics?.staticBoxes;
    if (!boxes || !boxes.length) return;
    const T = this._threatBearing(A);
    let best = null, bestD = Infinity;
    for (const b of boxes) {
      if (b.disabled) continue;
      const h = b.halfExtents;
      // A thing you can get behind: at least chest high and wide enough to hide
      // a man. A kerb is not cover and neither is a post.
      if (h.y < 0.55 || Math.max(h.x, h.z) < 0.5) continue;
      const dx = b.center.x - out.x, dz = b.center.z - out.z;
      const d2 = dx * dx + dz * dz;
      if (d2 > hunt * hunt || d2 > bestD) continue;
      bestD = d2; best = b;
    }
    if (!best) return;
    // …and stand on the far side of it from the threat, a body's width clear.
    const r = Math.max(h2(best), 0.5) + 0.85;
    out.set(best.center.x - T.x * r, 0, best.center.z - T.z * r);
    K._coverPt = out.clone();
  }

  /**
   * WHERE THE SHOOTING IS COMING FROM, as ONE bearing for the whole army.
   *
   * Lifted out of `_coverSite` unchanged when `_goToGround` became a second
   * caller. It was already cached against `_coverEpoch` and already fell back
   * to the commander's own heading with nothing hostile on the field; the only
   * thing that has moved is where it is written, and it is written once
   * because two answers to "which way is the enemy" is how a line ends up
   * taking cover on both sides of the same crate.
   *
   * `_troops` clears the mark once a second, which is what makes the reactive
   * callers honest — see the note there.
   */
  _threatBearing(A) {
    /* `!this._threat` LEADS, and it is not belt-and-braces. Both `_threatAt`
     * and `_coverEpoch` start `undefined`, so on a director that has never had
     * an order given the epoch test READS AS A CACHE HIT and hands back the
     * bearing that was never solved. `_coverSite` survived that because its own
     * `staticBoxes` guard returns first on a bare fixture; `_goToGround` asks
     * for the bearing whether there is cover or not, and a frightened man with
     * no direction to be frightened of is a crash. */
    if (!this._threat || this._threatAt !== this._coverEpoch) {
      this._threatAt = this._coverEpoch;
      let tx = 0, tz = 0, n = 0;
      for (const h of this.world?.enemies || []) {
        if (!h || h.dead || h.trooper) continue;
        tx += h.position.x - A.pos.x; tz += h.position.z - A.pos.z; n++;
      }
      const m = Math.hypot(tx, tz);
      this._threat = (n && m > 1e-3) ? { x: tx / m, z: tz / m }
        : { x: Math.sin(A.yaw), z: Math.cos(A.yaw) };
    }
    return this._threat;
  }

  /**
   * A FRIGHTENED MAN GOES TO GROUND. He does not stand there.
   *
   * This is the whole of the player's note — "your allies shouldn't just freeze
   * in place when they're uninspired or whatever … them frozen still looks like
   * a bug almost" — and the design constraint on it is stated over `IDLE_GRACE`:
   * it has to READ as fear rather than as a different attack pattern, and it
   * must not make a broken man better at fighting.
   *
   * So it is three acts, in the order a person does them, and not one of them
   * is a new capability:
   *
   *   FIND SOMETHING AND RUN FOR IT. `_coverSite` already hunts the level's
   *     static boxes and already knows which side of one is away from the
   *     shooting. What is different from TAKE COVER is only that the search
   *     starts from where this man is STANDING rather than from a slot in a
   *     formation he has stopped believing in, and that he does it at
   *     `PANIC_URGE` rather than at the pace of an order.
   *   GET DOWN BEHIND IT. `crouch` is the rig's own float and the pose is a
   *     man kneeling with his head below the top of the rock. He stays there;
   *     stillness behind cover is what cover is FOR, and it is the one place
   *     stillness does not read as a crash.
   *   AND IF THERE IS NOTHING — give ground. See `_scuttle`.
   *
   * WHAT IT DOES NOT DO is shoot better, move faster in a fight, or take a
   * different target. `targetFor` still returns null below `REFUSE`, morale
   * still costs him 1.65× on his spread through `Enemy.aimQuality`, and he has
   * left his slot — so the line has lost his gun and the ground he was on,
   * which is what breaking is supposed to cost. The crouch does shorten the
   * capsule an enemy BLADE sweeps against (`Enemy._saberStrike`), and that is
   * the correct answer for a man who is kneeling behind a rock.
   *
   * @param finished  below `REFUSE` — he is not coming back on his own.
   */
  _goToGround(e, dt, c, finished) {
    /* The squad's OWN order if it has been given one, else the army's. See
     * `formationFor` and the note in `order`. `cmdSquad` is the index into
     * `squadsOf`, refreshed once a frame in the same loop that stamps it. */
    const F = FORMATIONS[this.formationFor(c, e?.cmdSquad, e?.trooper)] || FORMATIONS[DEFAULT_FORMATION];
    const A = this._anchorFor(F, c);
    const T = this._threatBearing(A);
    /* He watches the thing he is frightened of. `Enemy._move` turns a body to
     * face `toTarget` when it has one, so this is the whole of "he keeps his
     * eyes on it" and it costs a vector. */
    if (!e.toTarget) e.toTarget = new THREE.Vector3();
    e.toTarget.set(T.x, 0, T.z);
    /* ONE ROCK PER FRIGHT, not a new one every frame — the same argument
     * `_coverSite`'s own cache note makes, in the body's own cache slot so the
     * two decisions cannot evict each other. `_fearEpoch` is bumped by
     * `_morale` the frame a man breaks, so a second scare re-chooses. */
    const K = e._fear || (e._fear = {});
    _hide.copy(e.position);
    this._coverSite(e, _hide, A, COVER_HUNT, e._fearEpoch | 0, 2, K);
    if (K._coverPt) {
      const dx = _hide.x - e.position.x, dz = _hide.z - e.position.z;
      const d = Math.hypot(dx, dz);
      if (d > 1.2) {
        if (!e.wish) e.wish = new THREE.Vector3();
        e.wish.set(dx / d, 0, dz / d);
        e.toTarget.copy(e.wish);
        const want = (e.speed || 4) * PANIC_URGE;
        if (want > e.speed) e.speed = want;
        // low as he runs, and all the way down once he is there
        this._crouch(e, dt, 0.45);
        return;
      }
      this._crouch(e, dt, 1);
      return;
    }
    this._scuttle(e, dt, c, T, finished);
  }

  /**
   * NOTHING TO GET BEHIND, so he gives ground — in rushes, with a look between
   * them.
   *
   * A man backing away CONTINUOUSLY reads as a unit withdrawing under orders,
   * which is a different sentence from the one this is trying to say. Short
   * bursts with a pause between them is what fear looks like, and it is also
   * what makes the behaviour cheap: he is moving about a quarter of the time,
   * so the line does not evaporate the moment two men wobble.
   *
   * AND IT IS BOUNDED, which is the part that took a measurement to get right.
   * Morale below `REFUSE` does not come back while a body is alive and out of
   * contact — `_morale` pays `ALONE` and nothing else — so an unbounded retreat
   * is a man who walks off the level and is never seen again. Past `FEAR_LEASH`
   * he turns and runs for his commander, which is where the BROKEN branch has
   * always sent people and for the reason stated there: "get to them, or lose
   * them" only means something if they are still on the field.
   */
  _scuttle(e, dt, c, T, finished) {
    this._crouch(e, dt, 0.8);
    e._scuttleT = (e._scuttleT || 0) + dt;
    if ((e._scuttleT % (SCUTTLE_EVERY + SCUTTLE_FOR)) <= SCUTTLE_EVERY) return;
    const home = c.player?.position || c.anchor;
    let ax = -T.x, az = -T.z;
    if (home) {
      const hx = home.x - e.position.x, hz = home.z - e.position.z;
      const hd = Math.hypot(hx, hz);
      if (hd > FEAR_LEASH) { ax = hx / hd; az = hz / hd; }
    }
    /* A lateral wobble off his own index, so ten frightened men do not fall
     * back down ten parallel lines like a drill. */
    const j = (((e.cmdIndex | 0) % 5) - 2) * 0.35;
    if (!e.wish) e.wish = new THREE.Vector3();
    e.wish.set(ax - az * j, 0, az + ax * j);
    if (e.wish.lengthSq() > 1e-6) e.wish.normalize();
    const want = (e.speed || 4) * (finished ? 0.9 : 1.2);
    if (want > e.speed) e.speed = want;
  }

  /**
   * A STEADY MAN ON HIS MARK WITH NOTHING TO SHOOT TAKES A KNEE.
   *
   * The second half of the player's "it happens everywhere", and the larger
   * half by frame count: 54-63% of allied frames in `circle`, `behind`, `cover`
   * and `holdfire` were a body inside its slot tolerance with no target inside
   * its leash. `steer` returned, `Enemy._think` had already set `wish = null` on
   * the null target, and the result is a rank of men standing to attention in
   * the middle of a battle.
   *
   * A knee is the whole answer and it is deliberately the SMALLEST one. He is
   * at his post and the order says hold it, so he must not wander: anything
   * that moved him would be arguing with the formation the player chose, and
   * `FORM_TOLERANCE` exists precisely so that a line reads as a line. What
   * changes is his POSE — hip down, spine forward, weapon up — and it changes
   * back the moment `targetFor` hands him something, because the branch of
   * `steer` that a fighting man takes asks `_crouch` for 0 on the same frame.
   *
   * `IDLE_GRACE` before it starts, so a man who is between targets for a third
   * of a second does not bob up and down.
   */
  _holdPost(e, dt) {
    e.idleT = (e.idleT || 0) + dt;
    this._crouch(e, dt, e.idleT < IDLE_GRACE ? 0 : 1);
  }

  /**
   * THE ONE WRITER OF `crouch`, and it is a damp rather than an assignment.
   *
   * The first version decayed the float once at the top of `steer` and let each
   * branch add to it, which is two authorities over one number: the decay ran
   * first on every frame and was larger than every rise, so `crouch` never left
   * zero and the whole pose was dead code. Measured that way, `circle` still
   * read 66.5% of allied frames motionless AND upright with the knee wired in.
   *
   * So every branch of `steer` states what it wants and this is the only place
   * the number moves. Down faster than up — a man stands to fight in about a
   * third of a second and takes a knee in half of one.
   */
  _crouch(e, dt, want) {
    const now = e.crouch || 0;
    e.crouch = now + (want - now) * Math.min(1, dt * (want > now ? 2.6 : 3.6));
  }

  /**
   * HOW FAR FROM ITS SLOT THIS BODY MAY RANGE, in metres — the one statement of
   * the leash, called by `steer` and by `targetFor` so the thing a trooper may
   * SHOOT and the thing it may WALK TO cannot disagree.
   *
   * Three terms and each answers a different question:
   *
   *   the FORMATION's multiplier   how far past its own reach this order sends
   *                                it. See the note above FORMATIONS.
   *   the BODY's `preferred[1]`    how far it fights from at all. A marksman's
   *                                42 m and a B1's 15 m are not the same leash
   *                                and never were; one number for both is what
   *                                made the formations a parade.
   *   LEASH_FLOOR                  so a duellist whose band is 3.4 m is still
   *                                allowed to take a step.
   *
   * AND THE LAST FEW BODIES OPEN IT COMPLETELY. See `_closing`.
   */
  leashFor(F, e) {
    /* A RUNNER FIGHTS AT ARM'S LENGTH AND NOTHING FURTHER. He is not on the
     * line; he is crossing it. The floor is the shortest leash any body is
     * ever given, so he still shoots what walks into him — a man who cannot
     * defend himself at all is a delivery animation with a health bar — and
     * he will not chase anything a metre out of his way. */
    if (e?.trooper?.runner) return LEASH_FLOOR;
    if (F.leash === Infinity || this._closing) return Infinity;
    return Math.max(LEASH_FLOOR, this.reachOf(e) * F.leash);
  }

  /**
   * HOW FAR THIS BODY FIGHTS FROM, in metres — its own `preferred[1]`.
   *
   * One expression, two readers: the leash above multiplies it by the
   * formation's number, and `targetFor`'s concentration rule bounds itself by
   * it flat. It was written out twice for about ten minutes and that is
   * exactly long enough for a marksman's 42 and a B1's 15 to start meaning
   * different things in the two places.
   *
   * The fallback chain is the body's live archetype first — an elite carries
   * its OWN copy of `A`, patched by its modifier, and a Marksman's band is
   * 20-38 where the base body's is not — then the roster record's type, for a
   * record whose body has not been built yet, and 12 for neither.
   */
  reachOf(e) {
    return e?.A?.preferred?.[1] ?? ARCHETYPES[e?.trooper?.type]?.preferred?.[1] ?? 12;
  }

  /**
   * CLOSING OUT: the wave is down to its last few and every order is off.
   *
   * A driven idle run stalled from t≈711 s to t=3535 s — FORTY-SEVEN
   * game-minutes — with exactly two horde bodies alive that the army would not
   * walk to. Neither side was wrong on its own terms: the droids were holding
   * their own `preferred` band off the player, the troops were holding a
   * formation, and the leash between them meant no trooper was ever handed a
   * target. Nothing was stuck, so the liveness watchdog had nothing to say. The
   * run simply could not end, and the only exit was Abandon.
   *
   * Two conditions, and both are needed. `delivered` — the director's own
   * statement that nothing more is coming, which is the same state the watchdog
   * treats as terminal — is true for most of a wave once the queue drains, so it
   * cannot be the whole rule or a formation would only hold for the first twenty
   * seconds of every fight. `CLOSE_OUT` is the other half: while there is a wave
   * left to fight, an order is an order. When there are four bodies left it is
   * not a battle any more, it is a wave that will not close, and the army goes
   * and closes it — including a squad told to take cover, which breaks it, kills
   * them and walks back.
   *
   * Computed once per frame rather than inside `leashFor`, which runs per troop
   * per frame and would otherwise walk the whole enemy list twenty-four times.
   */
  _updateClosing(ctx) {
    if (!this.active || !this.delivered) { this._closing = false; return false; }
    const list = ctx?.enemies || this.world?.enemies || [];
    let n = 0;
    for (const e of list) if (this.blocksWaveEnd(e) && ++n > CLOSE_OUT) break;
    this._closing = n <= CLOSE_OUT;
    return this._closing;
  }

  /**
   * THE STEER — one troop, one frame, between the brain and the feet.
   *
   * Three decisions, and they are all about ONE number, the distance from the
   * slot:
   *
   *   inside the LEASH with a fight on   leave the brain alone entirely. A
   *                          trooper standing where it was told to stand fights
   *                          exactly as the same body fights on the other team,
   *                          which is the property this whole mode rests on —
   *                          and a trooper CLOSING on something it is allowed to
   *                          engage is doing what the order said, not breaking
   *                          it. This clause is new and it is the difference
   *                          between a formation and a parade: the leash used to
   *                          decide what a body could shoot while the tolerance
   *                          held it 2.2 m from its slot, so an ally could be
   *                          handed a target it was then physically prevented
   *                          from walking to.
   *   inside the tolerance   the same, with nothing to fight. A body idles on
   *                          its mark.
   *   outside               overwrite `wish` with the direction home, and
   *                          overwrite `toTarget` with the same — because
   *                          `_move`'s backpedal limiter scales the component
   *                          pointing away from `toTarget`, so a trooper walking
   *                          BACK to its slot with a stale forward target would
   *                          do it at 40% pace and never arrive.
   *
   * The tolerance is not the leash. The leash is how far a trooper may RANGE to
   * fight; the tolerance is how close it must get when it has nothing to do, and
   * it is deliberately loose — 2.2 m — because a formation solved to the
   * centimetre reads as a parade and this is a battle.
   */
  steer(e, dt) {
    if (!e.trooper) return;
    /**
     * A MAN DEALING WITH A GRENADE IS NOT HOLDING A FORMATION.
     *
     * `Enemy.update` runs `stepReaction` before the brain and this is the other
     * half of the same rule: everything below writes `wish`, `speed` and
     * `crouch` from the slot he is supposed to be standing in, and a body that
     * has just thrown itself flat would be walked back into the line while it
     * lay there. One frame of that is a man sliding along the ground; a second
     * of it is the reaction not existing at all.
     *
     * See src/game/Reactions.js. Dragging a casualty comes through here too —
     * that one is not an emergency, it is a job, and a squad that keeps
     * dressing the line while a man is being pulled out of it is the picture
     * the player asked us to replace.
     */
    if (e.reaction) return;
    const c = this.commanderOf(e);
    /**
     * A BROKEN MAN DOES NOT HOLD THE LINE — the first of morale's two
     * consequences, and the reason the whole system is worth having.
     *
     * "they can break, refuse orders, or even turn on you." Below `BREAK` a
     * body stops answering the formation and falls back toward its commander;
     * below `REFUSE` it stops answering anything, which is the difference
     * between a man who is frightened and a man who is finished. Both are
     * read off the record here rather than being separate states on the body,
     * so there is one authority and `aimQuality` and the HUD are reading it
     * too.
     *
     * FALLING BACK TOWARD THE COMMANDER and not away from the enemy: a rout
     * that scatters is one the player can do nothing about, and the note asks
     * for troops that can be SAVED — "get to them, or lose them". A man
     * running to you is a man you can stand in front of.
     *
     * ── AND NEITHER OF THEM IS ALLOWED TO STAND THERE ──
     *
     * Both of those sentences used to end in a body that stopped: a refusing
     * man returned from the top of this method having done nothing, and a
     * broken one arrived within five metres of his commander and did nothing
     * from then on. Measured, that was 100.0% and 45.9% of their frames spent
     * motionless, upright and silent, and the player's whole note is about
     * exactly that picture. `_goToGround` is what happens instead, and
     * `_holdPost` is the same omission answered for a man who is perfectly
     * steady and simply has nothing to shoot. Every branch below now says what
     * it wants of `crouch`; `_crouch` is the only writer.
     */
    const t = e.trooper;
    /**
     * …AND THE SQUAD FALLS BACK WITH HIM. `t.rout` is `_morale`'s statement
     * that most of this squad has broken, and a man who is personally steady
     * inside one goes home too — see the note over it. Same destination and
     * the same pace as a break, because "fall back" is one act however many
     * people decided on it, and the man who is still steady is the one you
     * can actually see leading the others out.
     */
    if (t.broken || t.rout) {
      /**
       * …AND SOME ARMIES DO NOT RUN — PLAN.md §4.6's Stand Fast.
       *
       * A rout is a DESTINATION below — the man walks back to his general — and
       * this makes it a place instead: he goes to ground where he is standing.
       * Better and worse at once, which is the card: he keeps the ground he was
       * given and stays inside the quorum, and he does it lying in the open
       * with whatever broke him still there. `_goToGround` is the same call the
       * refusing branch below already makes, so this adds no behaviour — it
       * changes which of two shipped ones a broken man gets.
       */
      if (this.world?.player?.boonMods?.standfast) { this._goToGround(e, dt, c, true); return; }
      /**
       * FINISHED IS NOT STOPPED. This line used to be
       * `if (t.morale < MORALE.REFUSE) return;`, and with `targetFor`
       * refusing on the same test it left a man below `REFUSE` inert:
       * measured, 100.0% of his frames motionless, upright and silent. No
       * ORDER reaches him still — that is what the threshold is for and it is
       * untouched — but he acts on his own account. See `_goToGround`.
       */
      if (t.morale < MORALE.REFUSE) { this._goToGround(e, dt, c, true); return; }
      const home = c.player?.position || c.anchor;
      if (home) {
        const dx = home.x - e.position.x, dz = home.z - e.position.z;
        const d = Math.hypot(dx, dz);
        if (d > 5) {
          if (!e.wish) e.wish = new THREE.Vector3();
          e.wish.set(dx / d, 0, dz / d);
          if (!e.toTarget) e.toTarget = new THREE.Vector3();
          e.toTarget.copy(e.wish);
          const want = (e.speed || 4) * 1.5;
          if (want > e.speed) e.speed = want;
          this._crouch(e, dt, 0.2);            // running, and running low
          return;
        }
      }
      /* …AND HE HAS ARRIVED, WHICH USED TO BE THE END OF IT: a squad that fell
       * back to its commander then stood around him at attention. It gets
       * behind something instead, and stays low while it is there. */
      this._goToGround(e, dt, c, false);
      return;
    }
    /**
     * A MAN DOWN IN FRONT OF HIM — "or dragging their friends to safety".
     *
     * Below the two break branches on purpose: a soldier who has lost his nerve
     * is not the one who goes back for somebody, and a squad in rout is not
     * dragging anybody anywhere. Above the formation for the same reason a
     * grenade is: this is a job that takes him out of the line, and a line that
     * kept dressing itself around him would make it invisible.
     *
     * A casualty here is a body that is LIMP AND ALIVE — the state
     * `Enemy._tickGetUp` stands up after a second and a third of lying still,
     * which is what a man who has been blasted, shoved or thrown spends that
     * second in. Until now every soldier beside him carried on shooting past
     * him. `beingDragged` on the casualty is the claim, so ten men do not all
     * grab the same one.
     *
     * ONE AT A TIME AND NOT EVERYBODY: `_dragCd` keeps a squad from emptying
     * itself into a rescue, and the nerve gate means the man who goes is a man
     * the player could have picked out from his nameplate. Both are the same
     * shape as the smother gate in Reactions.js and for the same reason.
     */
    e._dragCd = Math.max(0, (e._dragCd ?? 0) - dt);
    if (!e.reaction && e._dragCd <= 0 && t.morale > MORALE.BREAK + 0.12) {
      const hurt = findCasualty(e, this.world?._frameCtx);
      if (hurt && startDrag(e, hurt, this.world?._frameCtx)) {
        e._dragCd = DRAG_AGAIN;
        this.world?.notifyFloating?.(e.position, 'MAN DOWN', 0x9bb862);
        return;
      }
      /* A refused attempt still costs him the look, or every frame is a scan
       * of the whole field. */
      if (!hurt) e._dragCd = 0.8;
    }
    /* The squad's own order if it has one — see `formationFor`. */
    const F = FORMATIONS[this.formationFor(c, e?.cmdSquad, e?.trooper)] || FORMATIONS[DEFAULT_FORMATION];
    /* A live target it is allowed to engage buys it the whole leash; otherwise
     * it owes the mark. `e.target` is what `_think` set THIS frame off
     * `pickTarget`, which for a trooper is `targetFor` below — so the two
     * readers are the same decision and cannot disagree about it. Read HERE
     * rather than beside the leash because the CHARGE branch needs it too: a
     * man running an order down with somebody in front of him is not idle, and
     * taking a knee mid-charge is exactly the wrong picture. */
    const fighting = e.target && !e.target.dead && e.target.alive !== false;
    const slot = this.slotFor(e);
    /* CHARGE: no slot at all — so there is nothing to walk to, and a body with
     * no target either is the same statue reached by a different route. */
    if (!slot) {
      if (fighting) { e.idleT = 0; this._crouch(e, dt, 0); } else this._holdPost(e, dt);
      return;
    }
    const dx = slot.x - e.position.x, dz = slot.z - e.position.z;
    const d = Math.hypot(dx, dz);
    e.cmdSlotDist = d;
    /* …AND HOW TIGHTLY HE HOLDS IT. Discipline's first consumer: a slack man
     * gets more slop before he is walked back to his mark and a tight one gets
     * less, so a disciplined line is visibly a LINE and a poor one is a smear
     * of men roughly where they were told. Divided, because a higher score is
     * a smaller tolerance. */
    const disc = e.trooper?.scale ? e.trooper.scale('discipline') : 1;
    const limit = (fighting ? this.leashFor(F, e) : FORM_TOLERANCE) / disc;
    if (d <= limit) {
      /* ON HIS MARK. Fighting from it is the whole job; NOT fighting from it is
       * a man standing in the open with nothing to do, and that is 54-63% of
       * the frames in every standing formation. See `_holdPost`. */
      if (fighting) { e.idleT = 0; this._crouch(e, dt, 0); }
      else this._holdPost(e, dt);
      return;
    }
    /**
     * …AND HE HAS TO HAVE TAKEN THE ORDER IN. See `ORDER_LAG`.
     *
     * THE SLOT IS NOT WHAT LAGS — `slotFor` still answers where the order says
     * he belongs, because that is a fact about the order and every other
     * reader of it wants the truth. What lags is HIM: for the first beat after
     * a new order he is still standing where the old one put him, and the
     * sharp men in the line move before the slow ones do. An order used to
     * pivot twenty-four bodies on a single frame, which is a spreadsheet
     * moving rather than an army.
     *
     * A man with something in front of him is exempt: he is already fighting,
     * and freezing him mid-firefight because the formation changed would be a
     * worse picture than the one this is here to fix.
     *
     * SO IS A MAN WHO IS BADLY OUT OF POSITION. The beat models taking an
     * order in, never refusing to move — and without the distance gate a
     * trooper fifty-five metres behind his line stood still holding a pose,
     * which `command.mjs` caught as "given no direction to walk in". Three
     * times his own leash is the width of a formation: inside it, the new
     * order is a pivot and a pivot can wait; outside it, he was already
     * walking and nothing about a new order says stop.
     */
    if (!fighting && d < limit * 3 && e.cmdOrder != null
      && e.cmdOrder !== this.formationFor(this.commanderOf(e), e.cmdSquad, e.trooper)) {
      this._holdPost(e, dt);
      return;
    }
    e.idleT = 0;
    this._crouch(e, dt, 0);                    // walking: on his feet
    const inv = 1 / (d || 1);
    if (!e.wish) e.wish = new THREE.Vector3();
    e.wish.set(dx * inv, 0, dz * inv);
    if (!e.toTarget) e.toTarget = new THREE.Vector3();
    e.toTarget.set(dx * inv, 0, dz * inv);
    /* …AND FAST ENOUGH TO ARRIVE. See `followSpeed`. Written onto the body for
     * exactly one `_move` call — `installCommand` puts it back afterwards — so
     * the rank multipliers on `speed` are never compounded and a boost can never
     * survive the frame that asked for it. */
    const want = this.followSpeed(e, d);
    if (want > e.speed) e.speed = want;
  }

  /**
   * HOW FAST A TROOPER WALKING BACK TO ITS SLOT IS ALLOWED TO MOVE.
   *
   * A commander walks at 4.60 m/s and sprints at 7.45 (Player.js: `base = 4.6`,
   * ×1.62). A Clone Trooper's `speed` is 4.1 and a Clone Heavy Gunner's is 2.9.
   * So an army ordered to follow could not follow: driven, troops were out of
   * position 98-100% of the time for as long as the player kept moving, and the
   * whole formation system was a shape that only existed while you stood still.
   *
   * The archetype speed is NOT raised. A heavy that has picked a spot has
   * committed to it, and making one as quick as an ARC would delete the
   * distinction the roster is built out of. What is raised is the pace of the
   * WALK HOME, which is a different act from fighting — it is the double a
   * soldier moves at when they are out of position and know it.
   *
   *   the commander's own measured pace, so the follow tracks a sprint rather
   *     than a constant somebody typed;
   *   plus a term in the gap, so a body adrift CLOSES rather than trailing at
   *     exactly the speed of the thing it is chasing forever. 0.30 m/s per
   *     metre, swept: at 0.09 the line held a 4.9 m mean gap on a commander
   *     walking a continuous circle, at 0.20 3.6 m, at 0.30 3.0 m and at 0.45
   *     2.6 m for a fleet permanently at the cap. 0.30 is where the straggling
   *     stops (bodies more than 6 m off their mark: 70.6% of samples under the
   *     old rule, 33.4% at 0.09, 0.9% here) and past it the return is buying
   *     nothing but a jog that never lets up;
   *   capped at CATCH_UP × its own speed, so the ladder still means something —
   *     a heavy at 1.8× is 5.2 m/s and STILL cannot match a sprinting Jedi, and
   *     that is the correct answer for a heavy.
   *
   * IT DOES NOT SOLVE IT COMPLETELY AND IT CANNOT. A body chasing a commander
   * who never stops moving is never standing exactly on its mark: measured over
   * a 45 s continuous circle it is outside the 2.2 m tolerance 88.9% of the time
   * against 98.6% before. What changed is the SIZE of the miss — a line 3 m
   * behind you is a formation, a line 8.6 m behind you is a crowd.
   */
  followSpeed(e, gap) {
    const own = e.speed || 1;
    /* Its OWN commander's measured pace: two armies chasing two people who are
     * running at different speeds is two different follow speeds. */
    const c = this.commanderOf(e);
    const want = c._leaderSpeed * 1.05 + Math.min(gap, 24) * 0.30;
    /**
     * …AND AN URGENT ORDER IS RUN, NOT WALKED.
     *
     * "when I order take cover they don't really run for their lives." They
     * did not: every order shared one pace, and that pace is derived from how
     * fast the COMMANDER is going — so ordering a stationary squad to ground
     * asked them to amble to it at their own walk. A man told to get down
     * behind something moves at everything he has, and it is the only order
     * where the SPEED is the content: cover you reach in four seconds is not
     * cover.
     *
     * The multiplier is on the ceiling as well as on the want, because the
     * ceiling is what was actually binding — `CATCH_UP` exists to stop a heavy
     * outrunning an ARC, and for the two seconds of a sprint to cover that
     * distinction is not the thing being protected.
     */
    /* The squad's own order if it has one — see `formationFor`. A squad told to
     * advance while the rest of the line holds must carry that formation's
     * urgency, or it walks at the army's pace to a place the army is not
     * going. */
    const F = FORMATIONS[this.formationFor(c, e?.cmdSquad, e?.trooper)] || FORMATIONS[DEFAULT_FORMATION];
    const urge = F.urgency ?? 1;
    return Math.min(own * CATCH_UP * urge, Math.max(own, want * urge));
  }

  /**
   * WHO A TROOPER OF YOURS IS ALLOWED TO SHOOT.
   *
   * `World.pickTarget` delegates here for anything carrying a `trooper`. Three
   * rules, and between them they are the whole tactical content of a formation:
   *
   *   the nearest HOSTILE — which for an ally is the horde and for the horde is
   *     you, one function answering for both armies rather than two lists built
   *     from two ideas of who is fighting whom;
   *   within the formation's LEASH of the trooper's own slot, so a tight
   *     formation genuinely will not chase and a loose one genuinely will;
   *   …and WHAT THE SQUAD LEADER IS FIGHTING in preference to the nearest, when
   *     it passes the leash, is inside this body's own weapon band, and is not
   *     much further off than the nearest would have been. See the note on
   *     `focus` below for what each of those three bounds is stopping.
   *
   * Returning null is a legitimate answer and it is what makes the leash mean
   * something: `Enemy._think` sets `wish = null` on a null target, and `steer`
   * then supplies the walk home. Nothing has to be told to stop fighting.
   */
  targetFor(e, candidates, index = null) {
    const F = FORMATIONS[this.commanderOf(e).formation] || FORMATIONS[DEFAULT_FORMATION];
    /* MORALE'S SECOND CONSEQUENCE. A body that has given up does not pick a
     * target, which is the same door `Enemy._think` already reads — it sets
     * `wish = null` on a null target and `steer` supplies whatever is left. */
    if (e.trooper && e.trooper.morale < MORALE.REFUSE) return null;
    const leash = this.leashFor(F, e);
    const slot = leash === Infinity ? null : this.slotFor(e, _slot);
    const ax = slot ? slot.x : e.position.x;
    const az = slot ? slot.z : e.position.z;
    const leash2 = leash === Infinity ? Infinity : leash * leash;
    /**
     * WHAT IS EVEN WORTH TESTING — a disc round the slot, and not the army.
     *
     * Every line below this rejects a candidate that is farther from the slot
     * than the leash, and a leash is 14–34 m on a field two kilometres across.
     * So the list handed in was, in a real Command wave, forty droids of which
     * three could possibly survive the first `continue` — built fresh once per
     * trooper per frame, which is the second of the two squares `World.
     * pickTarget`'s note counts.
     *
     * The index answers the same question by cells. It returns a SUPERSET of
     * the disc, so nothing below changes: the leash test is still the only
     * thing that decides membership, and it is now being asked of a handful of
     * bodies instead of an army.
     *
     * Two cases keep the old path, and both are the honest answer rather than a
     * fallback: an Infinity leash is a CHARGE order, which really does mean
     * "anything on the field", and no index at all is a hand-built fixture —
     * several checks call this with an array of two.
     *
     * The PLAYERS are appended by hand. The index holds `world.enemies`, and a
     * trooper in a versus meeting is opposed to a person as much as to a droid;
     * there are at most four of them, so a loop is cheaper than a second index.
     */
    if (!candidates) {
      if (index && leash2 !== Infinity) {
        const near = (this._targetScratch ||= []);
        near.length = 0;
        index.within(ax, az, leash, near);
        const ps = this.world?.players;
        if (ps) for (let i = 0; i < ps.length; i++) near.push(ps[i]);
        candidates = near;
      } else candidates = this.world?._hostilesFor?.(e) || [];
    }
    /**
     * THE SQUAD SHOOTS AT WHAT ITS LEADER IS SHOOTING AT — the third rule, and
     * it is a PREFERENCE inside the other two rather than a rule beside them.
     *
     * "concentrate fire on what their leader is fighting." Written as an
     * override it would be a squad that ignores the droid at its elbow to fire
     * across the field at whatever the sergeant found, which is not
     * concentration, it is a squad walking past a fight. So the leader's pick
     * has to pass exactly the same test every other candidate passes — alive,
     * hostile, and inside this trooper's own leash of its own slot — and the
     * nearest-hostile rule below is what answers when it does not.
     *
     * What it buys is the thing a firing line is for: five rifles that all
     * kill the same B2 in one second instead of five rifles chipping five B2s
     * for five. It is also the one place in this file where a body's decision
     * depends on another body's, which is why the focus is READ off a field
     * `_troops` stamped rather than looked up here — see the note there for
     * the frame of latency that buys and why it is the right trade.
     */
    let best = null, bestD = Infinity;
    for (const c of candidates) {
      if (!c || c.dead || c.alive === false) continue;
      if (c === e) continue;
      if (c.team === e.team) continue;
      const dx = c.position.x - ax, dz = c.position.z - az;
      const fromSlot = dx * dx + dz * dz;
      if (fromSlot > leash2) continue;
      const d = c.position.distanceToSquared(e.position);
      if (d < bestD) { bestD = d; best = c; }
    }
    /**
     * THE CONCENTRATION, AND IT IS DECIDED AGAINST THE NEAREST RATHER THAN
     * INSTEAD OF IT.
     *
     * Written as an override — "take the leader's target whenever it is legal"
     * — it produced a line that ignored the droid at its elbow to answer a
     * call across the field, which is not concentration. Two bounds hold it
     * to what a firing line actually does:
     *
     *   the GRASP    the trooper's own weapon band (`reachOf`, floored at
     *                LEASH_FLOOR so a duellist can still be told where the
     *                fight is). CHARGE has a leash of Infinity, so without
     *                this the leash test alone means "every rifle in the squad
     *                fires at whatever the sergeant found, anywhere on the
     *                map".
     *   the SLACK    and it may be no more than half again as far as whatever
     *                this man would have shot at anyway. That is the clause
     *                that makes it a PREFERENCE: a squad all engaging the same
     *                rank concentrates, and a man with something inside his
     *                guard deals with it.
     *
     * `bestD` and the focus distance are both measured from the BODY, not from
     * the slot — the slot is what decides whether a target is allowed at all
     * (the leash, above), and this is a question about which of two allowed
     * targets a rifle is actually pointing at.
     */
    const focus = e.cmdFocus;
    if (!focus || focus.dead || focus.alive === false || focus.team === e.team) return best;
    const fx = focus.position.x - ax, fz = focus.position.z - az;
    if (fx * fx + fz * fz > leash2) return best;
    const grasp = Math.max(LEASH_FLOOR, this.reachOf(e));
    const focusD = focus.position.distanceToSquared(e.position);
    if (focusD > grasp * grasp) return best;
    return (best === null || focusD <= bestD * FOCUS_SLACK) ? focus : best;
  }

  /* ── the campaign's own bookkeeping ────────────────────────────────── */

  /**
   * A BODY DIED. Route it: yours is a name off the roll, theirs is experience.
   *
   * Called by World from `onEnemyKilled`, which is the one place a death is
   * visible centrally — the same argument `Corpses.take` is wired there for.
   */
  onDeath(e, source) {
    if (!e) return;
    if (e.trooper) {
      const t = e.trooper;
      /* Off the BODY's roster, not the machine's: a name only comes off the
       * roll it was ever on, and with two armies on the field the wrong roll
       * would silently keep a dead man standing and lose a living one. */
      const c = this.commanderOf(e);
      /* WHO WATCHED IT HAPPEN, and whether he was in charge of them. Taken
       * BEFORE `fall`, because both questions are about the squad this man was
       * still a member of a frame ago — `squads()` is a slice of the LIVING
       * list, so asking after he is dead asks about a different squad. */
      const squad = this.squadOf(t, c);
      const wasLeader = this.leaderOf(squad) === t;
      /* …AND WHICH SQUAD IT WAS, BY NUMBER, taken here for the same reason and
       * it is the sharper one: `squadsOf` slices the LIVING list, so the
       * moment `fall` runs this man is in no squad at all and the key can no
       * longer be found. `_vacancy` needs it to reach `squadPlanted`. */
      const squadKey = this._squadKeyOf(t, c);
      /**
       * ══ AND THE ORDER DIES WITH HIM ═══════════════════════════════════════
       *
       * COMPANY.md, on the runner: "He can be killed on the way, and then the
       * order dies with him and the log says so." This is the sentence the
       * whole mechanic exists to produce, and it is why the runner is a body
       * on the field rather than a timer — a message that cannot be
       * intercepted is not a message, it is a function call with a delay on
       * it.
       *
       * Before `fall`, like the two questions above it, because the same call
       * clears him out of the living list and the name has to be said while
       * there is still a man attached to it.
       */
      if (t.runner) {
        const F = FORMATIONS[t.runner.id];
        this.log.push({ t: 'lostorder', name: t.name, formation: t.runner.id, why: 'killed',
                        squad: t.runner.squad, area: this.areaNumber, wave: this.wave });
        if (c === this.commander) {
          this.world?.notify?.('THE ORDER DIED WITH HIM',
            `${t.name} was carrying ${F ? F.name.toLowerCase() : t.runner.id} and never got there`);
        }
        t.runner = null;
      }
      if (c.roster.fall(t, this.areaNumber)) {
        /**
         * ── WHO KILLED HIM, FROM WHERE, AND WHEN — PLAN.md §4.9 ────────────
         *
         * "The after-action report — who killed whom, from what direction, at
         * what minute. No death is mysterious, so no death is the AI's fault."
         *
         * That is a property of the RECORD, not of a screen: a report can only
         * say what the log knows, and this log knew a name and an area number.
         * So the three facts are written where the death happens, in the units
         * the report will read them in — the killer's own name where there is
         * one, the bearing in degrees from the man to whatever killed him, and
         * the minute of the run.
         *
         * `killer` is a NAME and not a reference: the log outlives the body,
         * and holding an Enemy in it would keep a whole rig and ragdoll alive
         * for the length of the run. A death with no source (a fall, a bleed-
         * out with nothing near) records null and the report says so, which is
         * the honest answer and not a mystery.
         */
        const from = source?.position || source?.body?.position || null;
        const bearing = from && e?.position
          ? Math.round((Math.atan2(from.x - e.position.x, from.z - e.position.z) * 180 / Math.PI + 360)) % 360
          : null;
        this.log.push({ t: 'fell', name: t.name, unit: t.label, rank: t.rankRec.short,
                        area: this.areaNumber, wave: this.wave, xp: t.xp, kills: t.kills,
                        killer: killerName(source), bearing,
                        /**
                         * AND WHOSE MAN HE WAS. `onDeath` routes EVERY
                         * commander's dead into this one log, and `formUp`
                         * builds a second commander for the other army — so in
                         * a meeting the ledger holds both rolls, and a report
                         * reading it flat counts the enemy's dead as yours and
                         * calls an enemy trooper who kills one of your men
                         * "your own side". One boolean, written where the death
                         * happens, because only here is `c` still in hand.
                         */
                        mine: c === this.commander,
                        at: Math.round((this.world?.time || 0) * 10) / 10 });
        /**
         * …AND THE GROUND KEEPS HIM — PLAN.md §4.7.
         *
         * The same three facts the log just took, standing on the spot he took
         * them on: `src/world/Graves.js` holds the record and draws a rifle in
         * the dirt for it, and a player who fights back over this ground in the
         * next engagement walks through his own casualty list. Off the same
         * `fell` values rather than re-derived, so the marker and the report
         * can never say two different things.
         */
        this.world?.graves?.mark?.({
          name: t.name, rank: t.rankRec.short, unit: t.label,
          killer: killerName(source),
          at: Math.round((this.world?.time || 0) * 10) / 10,
          x: e.position.x, y: e.position.y, z: e.position.z,
        });
        this.world?.notify?.(`${t.rankRec.title.toUpperCase()} DOWN`,
          `${t.name} — ${t.kills} kill${t.kills === 1 ? '' : 's'}, ${c.roster.strength} still standing`);
        this.shake(squad, wasLeader ? 'LEADER_FELL' : 'COMRADE_FELL', c);
        /* AND SOMEBODY TAKES OVER. `leaderOf` is derived, so the successor is
         * already the leader by the time this line runs — what this does is
         * SAY so, which is the half a player can act on, and pay the field
         * promotion that makes taking over worth something. */
        if (wasLeader) {
          const heir = this.leaderOf(squad);
          if (heir) {
            const rose = heir.award(1);
            if (rose) this._promoteTrooper(heir, heir.body);
            this.log.push({ t: 'steps-up', name: heir.name, after: t.name, area: this.areaNumber });
            if (c === this.commander) {
              this.world?.notify?.(`${heir.name} HAS THE SQUAD`,
                `${t.name} is down — ${heir.rankRec.title.toLowerCase()}, ${squad.filter((x) => x.alive).length} left in it`);
            }
          }
        }
        this._vacancy(t, squad, c, wasLeader, squadKey);
        this._announceRoster();
      }
      e.trooper = null;
      return;
    }
    // One of theirs. Whoever killed it earns, and a trooper's own kill is the
    // only thing on this battlefield that promotes anybody.
    const t = source && source.trooper ? source.trooper : null;
    if (!t) return;
    t.kills++;
    // A squad that is winning knows it. See the MORALE table.
    this.shake(this.squadOf(t, this.commanderOf(source)), 'SQUAD_KILL', this.commanderOf(source));
    const promoted = t.award(1);
    if (promoted) this._promoteTrooper(t, source);
  }

  /**
   * ══ WHAT THE COMPANY CAN NO LONGER DO ══════════════════════════════════
   *
   * "THE GLASS IS DOWN. Nobody reads a mark but you."
   *
   * A casualty line already says a man is down and who has the squad now. Both
   * are sentences about PEOPLE, and neither one is a sentence a player can act
   * on — the roster is one shorter, which they could see, and somebody is
   * leading, which they assumed. What was missing is the only line that costs
   * anything to read: *this company has stopped being able to do a thing it
   * could do a second ago.*
   *
   * So this is the vacancy, and it is deliberately narrow. It speaks ONLY when
   * a licence has actually left the field — never on an ordinary death, never
   * twice for one man, and never about a duty somebody else in the squad still
   * holds. A notification that fires on every casualty is a notification the
   * player learns to look away from, and then the one that mattered goes past
   * unread.
   *
   * THREE THINGS CAN GO, and they are checked in the order they cost:
   *
   *   THE GROUND. `HOLDS` — the licence to keep a planted order after you have
   *     gone. If this squad was standing on ground of its own and nobody left
   *     in it holds that, the plant is DROPPED here, on this frame, and they
   *     come back to whatever the army is doing. That is a real loss the
   *     player can undo by walking over and giving the order again, which is
   *     the shape a punishment should have.
   *   THE SEAT. He was the man the player NAMED to this squad. `leaderOf` has
   *     already handed it to the derivation, so nothing has to be repaired —
   *     what is owed is the acknowledgement that a decision the player made
   *     has been undone by the other side.
   *   THE VOICE. `RELAYS` — the presence term in `_morale` that crosses squad
   *     boundaries. When the last man licensed to it is gone, every squad that
   *     was standing near him loses it on the same frame.
   *
   * Only for the player's own commander: the other army's licences are its own
   * business and announcing them would be reading the enemy's roster out loud.
   */
  _vacancy(t, squad, c, wasLeader, key) {
    if (!t || c !== this.commander) return;
    const living = (squad || []).filter((x) => x.alive && x !== t);

    /* ── THE GROUND ────────────────────────────────────────────────────── */
    const planted = key != null && c.squadPlanted?.has(key);
    if (planted && wasLeader && !this.licensedIn(living, 'HOLDS').length) {
      c.squadPlanted.delete(key);
      c.squadOrders?.delete(key);
      c.digs?.delete(key);
      /* …AND THE PANEL LOSES THE LINE WITH IT. The subtitle carries a squad's
       * own order until it is told otherwise, and this is one of the two
       * places the director takes one away. A null name is the drop — see
       * `HUD.setOrder`. */
      this.onOrder?.({ id: null, name: null }, this.liveSquads(c).length,
        { squad: Number(key) | 0, name: null });
      this.log.push({ t: 'ground-lost', squad: Number(key) | 0, after: t.name,
                      area: this.areaNumber, wave: this.wave });
      this.world?.notify?.(`${this.squadLabel(Number(key) | 0, c).toUpperCase()} GIVES UP THE GROUND`,
        living.length
          ? `${t.name} was holding it — nobody left in the squad is licensed to, and they are `
            + 'coming back to you'
          : `${t.name} was the last of them, and the position is nobody's`);
    }

    /* ── THE SEAT ──────────────────────────────────────────────────────── */
    if (t.post) {
      t.post = false;
      const heir = living.length ? this.leaderOf(living) : null;
      this.log.push({ t: 'post-lost', name: t.name, to: heir?.name || null, area: this.areaNumber });
      this.world?.notify?.(`${t.name} HELD THE POST`,
        heir
          ? `you gave him the squad — it falls to ${heir.rankRec.title.toLowerCase()} `
            + `${heir.name} until you name somebody`
          : 'and there is nobody left in it to give it to');
    }

    /* ── THE VOICE ─────────────────────────────────────────────────────── */
    if (holds(t.rank, 'RELAYS') && !this.relaysOf(c).length) {
      this.log.push({ t: 'voice-lost', name: t.name, area: this.areaNumber, wave: this.wave });
      this.world?.notify?.('THE VOICE IS GONE',
        `${t.name} was the last man who could steady a squad you are not standing in — `
        + 'from here the whole company leans on you');
    }
  }

  /**
   * ══ THE SQUADS THAT HAVE ANYBODY IN THEM ═══════════════════════════════
   *
   * `squadsOf` is indexed by the squad NUMBER, so a wiped squad is an empty
   * entry and `.length` is a count of SLOTS. Every surface that says "2
   * squads" wants the live count instead, and the two readings drifting apart
   * is the owner's original complaint made worse: wipe 1st Squad and the panel
   * said "2 squads" for the rest of the run while the target slot, which
   * filters, found one and did nothing when pressed.
   *
   * @returns the indices of the squads with a living man in them.
   */
  liveSquads(c = this.commander) {
    const out = [];
    const squads = this.squadsOf(c);
    for (let i = 0; i < squads.length; i++) {
      if (squads[i].some((t) => t.alive !== false)) out.push(i);
    }
    return out;
  }

  /**
   * ══ WHAT SQUAD `k` IS CALLED ═══════════════════════════════════════════
   *
   * The name the player gave it, or the army's own word and the number. ONE
   * READER, because a squad the menu calls Havoc and the HUD calls 2nd is two
   * squads as far as the player is concerned — which is the whole complaint
   * this answers.
   *
   * `squadWord` is the army's, so a Confederate 2nd Squad is 2nd Unit and a
   * named one is whatever it was named either way.
   */
  squadLabel(k, c = this.commander) {
    const i = k | 0;
    /* A DETACHED MAN IS NOT A SQUAD. `squads()` puts solo groups past
     * `SQUAD_SLOTS` precisely so their index can never be a squad's, and a
     * name typed for 3rd Squad must never end up over one man who was pulled
     * out of the line. */
    if (i >= SQUAD_SLOTS) {
      const one = this.squadsOf(c)[i]?.[0];
      return one ? `${one.name} (detached)` : 'Detached';
    }
    const named = (this.squadNames || [])[i];
    if (named) return named;
    return `${c?.army?.squadWord || 'Squad'} ${i + 1}`;
  }

  /** Which squad key `t` belongs to for `c`, as `squadPlanted` spells it. */
  _squadKeyOf(t, c = this.commander) {
    const squads = this.squadsOf(c);
    for (let i = 0; i < squads.length; i++) if (squads[i].includes(t)) return String(i);
    return null;
  }

  /**
   * A PROMOTION, WHICH IS THREE THINGS AT ONCE.
   *
   * The title, the numbers, and — the one that makes it visible from a hundred
   * metres away — the PAINT. The body is repainted by rebuilding it with the
   * rank's colour on the field the army carries rank on: an `accent` for a
   * clone (crest, shoulder bells, knees), a `markColor` for a droid.
   *
   * This is the only place in the mode that touches a mesh, and it does it
   * through the archetype's own `build` option rather than by reaching into the
   * rig — so a body that changes shape in Bodies.js still promotes correctly and
   * the promotion does not have to know what a shoulder bell is.
   */
  _promoteTrooper(t, e) {
    const R = t.rankRec;
    this.log.push({ t: 'promote', name: t.name, rank: R.short, area: this.areaNumber, wave: this.wave });
    if (e && !e.dead) {
      // The numbers, on the body already standing there. Ratios against the rank
      // below, so a promotion mid-area is worth exactly what it is worth at a
      // muster and cannot be farmed by dying at the right moment.
      const prev = RANKS[Math.max(0, t.rank - 1)];
      e.maxHp *= R.hp / prev.hp;
      e.hp = Math.min(e.maxHp, e.hp + (e.maxHp * (R.hp / prev.hp - 1)));
      e.attackDamage *= R.dmg / prev.dmg;
      e.speed *= R.speed / prev.speed;
      e.rankColor = R.color;
      this.repaint(e, R.color);
    }
    this.world?.notify?.(`${R.title.toUpperCase()} ${t.name}`, `promoted in the field — ${t.kills} kills`);
    this._announceRoster();
  }

  /**
   * PUT THE RANK ON THE BODY.
   *
   * THE OBVIOUS VERSION DOES NOT WORK, and the reason is worth recording rather
   * than discovering twice. `buildTrooper` returns `{ rig, palette: { plate,
   * under, accent, … } }`, and `accent` is precisely the material that lands on
   * the crest, the shoulder bells and the knees — the three pieces every
   * reference plate of this battle paints a unit colour onto. So "recolour
   * `palette.accent`" is the right instinct. But `Enemy._build` does not keep
   * the palette: `const built = A.build(opts)` is a local, and only
   * `built.palette.robe` is ever read back out of it. There is no handle on the
   * accent material from outside Bodies.js, and Bodies.js is not this mode's to
   * edit. (The one-word fix is in the handover at the foot of this file.)
   *
   * The second instinct — recolour every material whose hex happens to equal the
   * archetype's authored accent — needs a table of "what colour is each
   * archetype's accent", beside the builders that actually decide it. That is
   * the hand-maintained-twin defect this repository has been bitten by eight
   * times, and it would be wrong the first time somebody retunes a swatch.
   *
   * So the rank is BOLTED ON instead, in exactly the way `MODIFIERS` already
   * bolts a standard onto a leader and plates onto an armoured body: shared
   * geometry, one material per body pushed to `_modMaterials` (which
   * `Enemy.dispose` frees), parented to bones. Three pieces, and they are the
   * three the references use:
   *
   *   the CREST     a flash along the crown of the helmet — the single most
   *                 legible rank mark in every clone plate, because it is the
   *                 part of the silhouette that is against the sky.
   *   the BELLS     a cap over each shoulder. Two of them, so the mark survives
   *                 the body being seen from either side.
   *
   * A body with no `head`/`clav` bones (a droideka is a baked group, a walker
   * has no clavicles) gets a band at the top of whatever bone it does have, so
   * every rung of both ladders can wear a rank.
   *
   * @returns true if the insignia actually went on.
   */
  repaint(e, color) {
    if (!e || color == null) return false;
    if (e._cmdPaint) { e._cmdPaint.color.setHex(color); e._cmdPaint.emissive?.setHex(color); return true; }
    const rig = e.rig;
    const S = e.A?.scale ?? 1;
    const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.42, metalness: 0.2 });
    // Faintly self-lit, because this has to read across a dust plain at ninety
    // metres in the flat light this level is authored for, and a matte chip in
    // shadow reads as dirt. 0.22 is under the emissive floor anything in this
    // game glows at — it is legibility, not a light source.
    mat.emissive = new THREE.Color(color);
    mat.emissiveIntensity = 0.22;
    e._cmdPaint = mat;
    (e._modMaterials || (e._modMaterials = [])).push(mat);
    const meshes = e._modMeshes || (e._modMeshes = []);
    let on = 0;
    const bolt = (boneName, geo, y, z, scale) => {
      const b = rig?.get?.(boneName);
      if (!b) return;
      const m = new THREE.Mesh(geo, mat);
      m.scale.setScalar(S * (scale ?? 1));
      m.position.set(0, y * (b.length || 0.2), z * S);
      m.castShadow = true;
      b.obj.add(m);
      meshes.push(m);
      on++;
    };
    bolt('head', CREST_GEO, 0.86, -0.02, 1);
    bolt('clavL', BELL_GEO, 0.55, 0, 1);
    bolt('clavR', BELL_GEO, 0.55, 0, 1);
    if (!on) {
      // Nothing humanoid to hang it on. The chest, the spine, or — for a baked
      // group like a droideka — the group itself, so the rank is never invisible
      // just because the chassis is unusual.
      bolt('chest', BELL_GEO, 0.62, 0.06, 1.6);
      if (!on && e.group) {
        const m = new THREE.Mesh(BELL_GEO, mat);
        m.scale.setScalar(S * 2.0);
        m.position.set(0, 1.1 * S, 0);
        e.group.add(m);
        meshes.push(m);
        on++;
      }
    }
    return on > 0;
  }

  /**
   * A MAN'S OWN MARK, painted low where nothing else is.
   *
   * See `MARKS` for what this is and what it deliberately is not. The one thing
   * worth restating at the call site: it is a SECOND material and a second pair
   * of meshes, never a recolour of `_cmdPaint`. A mark that overwrote the rank
   * paint would make a Captain the player had marked blue read as a Sergeant at
   * every distance the rank is legible at, and the rank is the more important
   * of the two sentences.
   *
   * Both meshes go on `_modMeshes`/`_modMaterials`, which is what the body's
   * own teardown walks — a mark that outlived its Enemy would be a leak of one
   * material and two meshes per man per area boundary.
   */
  markUp(e, color) {
    if (!e || color == null) return false;
    if (e._cmdMark) { e._cmdMark.color.setHex(color); e._cmdMark.emissive?.setHex(color); return true; }
    const rig = e.rig;
    const S = e.A?.scale ?? 1;
    /* The same 0.22 the rank paint carries, and for the same reason its note
     * gives: a matte chip in shadow reads as dirt at ninety metres in this
     * game's flat light. It is legibility and not a light source. */
    const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.5, metalness: 0.15 });
    mat.emissive = new THREE.Color(color);
    mat.emissiveIntensity = 0.22;
    e._cmdMark = mat;
    (e._modMaterials || (e._modMaterials = [])).push(mat);
    const meshes = e._modMeshes || (e._modMeshes = []);
    let on = 0;
    const band = (boneName, side) => {
      const b = rig?.get?.(boneName);
      if (!b) return;
      const m = new THREE.Mesh(MARK_GEO, mat);
      m.scale.setScalar(S);
      /* Half way down the bone and proud of its outside face — a stripe you
       * can see from the side and from behind, which is where a commander sees
       * their own line from. POSITIVE y, because a bone's local +y runs ALONG
       * it toward its child (`rest: [0,-1,…]` is the world-space rest
       * direction, not the local axis) — the same sign `repaint` uses to put a
       * pauldron above the clavicle. Negative here would bury both stripes in
       * the thighs. */
      m.position.set(side * 0.055 * S, 0.5 * (b.length || 0.4), 0);
      m.castShadow = false;
      b.obj.add(m);
      meshes.push(m);
      on++;
    };
    band('shinL', -1);
    band('shinR', 1);
    if (!on) {
      /* Nothing with shins on it — a droideka, a walker. The mark goes on the
       * chest instead rather than being silently dropped: a man the player
       * marked and cannot find is the defect this feature exists to fix. */
      const b = rig?.get?.('chest');
      if (b) {
        const m = new THREE.Mesh(MARK_GEO, mat);
        m.scale.setScalar(S * 1.4);
        m.position.set(0, 0.1, 0.09 * S);
        b.obj.add(m); meshes.push(m); on++;
      } else if (e.group) {
        const m = new THREE.Mesh(MARK_GEO, mat);
        m.scale.setScalar(S * 2.2);
        m.position.set(0, 0.55 * S, 0);
        e.group.add(m); meshes.push(m); on++;
      }
    }
    return on > 0;
  }

  /**
   * THE SECOND MARK — a band on the right forearm, from the same palette.
   *
   * `markUp`'s rules verbatim, one bone over: its own material and mesh, never
   * a recolour of the rank paint or the shin mark, registered on
   * `_modMeshes`/`_modMaterials` so the body's own teardown frees it, and
   * re-applied at every area boundary because bodies are rebuilt. The forearm
   * because it is the one paintable site the reserved language does not use —
   * the crest and bells are the rank's, the shins are the mark's — and because
   * an arm is what a commander sees raised when a man is firing.
   */
  bandUp(e, color) {
    if (!e || color == null) return false;
    if (e._cmdBand) { e._cmdBand.color.setHex(color); e._cmdBand.emissive?.setHex(color); return true; }
    const rig = e.rig;
    const S = e.A?.scale ?? 1;
    const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.5, metalness: 0.15 });
    mat.emissive = new THREE.Color(color);
    mat.emissiveIntensity = 0.22;
    e._cmdBand = mat;
    (e._modMaterials || (e._modMaterials = [])).push(mat);
    const meshes = e._modMeshes || (e._modMeshes = []);
    let on = 0;
    const b = rig?.get?.('foreR');
    if (b) {
      const m = new THREE.Mesh(BAND_GEO, mat);
      m.scale.setScalar(S);
      /* A third of the way down the forearm — clear of the vambrace plate and
       * of the hand, and positive y for `markUp`'s reason: a bone's local +y
       * runs along it toward its child. */
      m.position.set(0, 0.35 * (b.length || 0.3), 0);
      m.castShadow = false;
      b.obj.add(m);
      meshes.push(m);
      on++;
    }
    if (!on) {
      /* No forearm — a droideka, a walker. The chest, then the group, exactly
       * as the shin mark falls back: a man the player painted and cannot find
       * is the defect both of these exist to fix. */
      const c = rig?.get?.('chest');
      if (c) {
        const m = new THREE.Mesh(BAND_GEO, mat);
        m.scale.setScalar(S * 1.3);
        m.position.set(0.09 * S, 0.3 * (c.length || 0.3), 0.06 * S);
        c.obj.add(m); meshes.push(m); on++;
      } else if (e.group) {
        const m = new THREE.Mesh(BAND_GEO, mat);
        m.scale.setScalar(S * 2.0);
        m.position.set(0.3 * S, 0.7 * S, 0);
        e.group.add(m); meshes.push(m); on++;
      }
    }
    return on > 0;
  }

  /**
   * WHAT SURVIVING LOOKS LIKE. One shallow scorch chip on the chest plate per
   * time this man went down and was helped back up, capped at three.
   *
   * Nobody paints these on purpose and nothing pays for them: `Trooper.wounds`
   * is written by `Enemy._getUpFromDown` and this only renders the count. The
   * chips are dark and matte — deliberately NOT from the mark palette and NOT
   * emissive, because they are history rather than signal, and a scar that
   * glowed would read as a third rank language at forty metres.
   */
  scorchUp(e, n) {
    if (!e || !(n > 0)) return false;
    if (e._cmdScorch) return true;
    const rig = e.rig;
    const S = e.A?.scale ?? 1;
    const mat = new THREE.MeshStandardMaterial({ color: 0x241f1a, roughness: 0.92, metalness: 0.04 });
    e._cmdScorch = mat;
    (e._modMaterials || (e._modMaterials = [])).push(mat);
    const meshes = e._modMeshes || (e._modMeshes = []);
    const count = Math.min(3, n | 0);
    /* Fixed offsets, not a roll: the same man carries the same scars on every
     * ground, and nothing here may draw from a stream at deploy time. */
    const AT = [[0.07, 0.46, 1], [-0.09, 0.30, 0.85], [0.02, 0.16, 0.7]];
    let on = 0;
    const host = rig?.get?.('chest') || rig?.get?.('spine') || null;
    for (let i = 0; i < count; i++) {
      const m = new THREE.Mesh(SCORCH_GEO, mat);
      const [x, y, sc] = AT[i];
      if (host) {
        m.scale.setScalar(S * sc);
        m.position.set(x * S, y * (host.length || 0.3), 0.105 * S);
        host.obj.add(m);
      } else if (e.group) {
        m.scale.setScalar(S * sc * 1.6);
        m.position.set(x * 2 * S, (0.5 + y) * S, 0.2 * S);
        e.group.add(m);
      } else { continue; }
      m.castShadow = false;
      meshes.push(m);
      on++;
    }
    return on > 0;
  }

  /**
   * The player hit one of their own. Told once, loudly, and never nagged —
   * and if it was the FORCE that did it, the line remembers.
   *
   * `MORALE.BETRAYED` has read "the Jedi used a Force power ON one of their
   * own, per use" since the table was written and nothing has ever called it.
   * It is the "Dark-side excess" half of note #36 — "Heavy losses, Dark-side
   * excess, or abandoning them tanks morale" — the other two halves of which
   * (`COMRADE_FELL`, `ALONE`) have been live all along, so the sentence the
   * table makes was two thirds true.
   *
   * FORCE ONLY, and the distinction is the design rather than pedantry. A
   * clumsy sweep of the blade through the man beside you is an accident in a
   * melee and this mode already prices it, in health, through `teamDamage`.
   * Reaching out and throwing one of your own soldiers into a wall is a
   * DECISION, it takes a Force pool to make, and it is the one the squad reads
   * as something about you. `FORCE_KINDS` is Enemy.js's own list of what
   * counts and it is called rather than restated.
   *
   * The whole squad takes it, not the man: what shakes a line is watching it
   * happen, and the man it happened to is the only one who could not see it.
   */
  onFriendlyHit(e, amount, source, kind = null) {
    if (!e.trooper) return;
    const c = this.commanderOf(e);
    if (FORCE_KINDS.test(kind ?? '')) {
      this._btT = (this._btT || 0);
      if (this._btT <= 0) {
        this._btT = 1.5;
        this.shake(this.squadOf(e.trooper, c), 'BETRAYED', c);
      }
    }
    this._ffT = (this._ffT || 0);
    if (this._ffT > 0) return;
    this._ffT = 6;
    this.world?.notify?.('CHECK YOUR FIRE', `${e.trooper.name} is one of yours`, 'alarm');
  }

  /**
   * THE ROSTER PANEL'S FEED — and it carries who can hear you.
   *
   * `CommandRoster.summary()` is a statement about the ROLL and knows nothing
   * about a world, a body or a distance, which is right and is why the reach
   * is stamped on the way past rather than inside it. The panel is the only
   * in-game view of a squad, so it is the one surface where "they cannot hear
   * you" belongs BEFORE the press rather than as a toast after it — a rule the
   * player can only discover by having an order fail is a rule that reads as
   * the game being broken.
   *
   * Per MAN, not per squad, because a squad straddling the edge is the case
   * that matters: five men, two of whom will take it.
   */
  _announceRoster() {
    const r = this.roster.summary();
    const c = this.commander;
    if (r && c) {
      const voices = this._voices(c);
      const by = new Map();
      for (const t of this.led(c)) by.set(t.id, this._inReach(t, voices));
      for (const row of r.roll) if (by.has(row.id)) row.heard = by.get(row.id);
    }
    this.onRoster?.(r);
  }

  /* ── the meeting, and whether there is one ─────────────────────────── */

  /**
   * IS THERE ANYBODY TO MEET? — and until this existed, nothing asked.
   *
   * The player, reporting it as a mode that does nothing: "no in the mode I was
   * playing it said 0 hostiles the entire time / it was in command mode not
   * versus". Measured on the shipped build, a solo `command` deploy with
   * `opt-command-versus` ticked: opening spawn queue 0 bodies, `hostilesLeft`
   * 0 at 30 s and 0 at 60 s, forever. The FLAG was correct the whole time —
   * `commandConfig` said versus, `MODES.command.meeting` said the mode may hold
   * one — and the consequence was an empty plain, because a meeting's opposing
   * army is deployed by a PERSON and there was no person.
   *
   * ASKED HERE AND NOT WHERE THE FLAG IS DECIDED, for the reason the second
   * half of `meetable`'s note gives with the measurement: at `commandConfig`
   * time the world has no net and no players yet, on a host in a real session
   * exactly as on a solo player. `formUp` and `start` are the two moments that
   * can answer, and both are reached through `World.beginVersus`.
   *
   * A SESSION COUNTS EVEN WHILE IT IS EMPTY. A host who ignited a session and is waiting for a friend is
   * deliberately alone for a few seconds — `World.beginVersus` already tells
   * them so and prints the code to share — and standing their meeting down
   * under them would be the same silent override this method exists to end.
   *
   * @param census how many commanders the caller is about to seat, when it
   *               knows better than the world does — `formUp` is handed the
   *               list before anybody is enlisted off it.
   */
  meetingOpposed(census = 0) {
    /* `meetable` is the rule and it is CALLED rather than restated (HANDOFF
     * §2.4) — a second copy of "what counts as a session" would eventually
     * disagree with the first. All this adds is the count the caller is holding
     * and has not seated yet. */
    return Math.max(census | 0, this.commanders.length) > 1 || meetable(this.world);
  }

  /**
   * NO OPPONENT AND NO SESSION TO BRING ONE — SO FIGHT THE CAMPAIGN INSTEAD.
   *
   * The flag is CLEARED rather than worked around, because `versus` is read in
   * nine places and every one of them wants the same answer: `update` skips the
   * whole wave loop on it (so a wave composed under a live flag would never
   * drain its queue), the HUD prints a front instead of a hostile count,
   * `World.beginVersus` refuses to seat anybody, and `main.js` chooses between
   * `beginVersus()` and `director.start(1)` on it. One field, one truth.
   *
   * …AND THE WORLD GETS ITS RULES BACK. See `_preMeeting`: `_loadSteps` has
   * already swapped in `pvpRules({pvp: true})` on the strength of the flag, and
   * a solo run left under them has friendly fire on for every blaster on the
   * field. Restoring the object the world was carrying before is exact — that
   * IS the rule set a Command run without a meeting has.
   *
   * Said out loud, ONCE. `this.versus` is the guard: it can only be true the
   * first time. The player's whole complaint was that a sticky global changed
   * the mode and nothing anywhere said so.
   */
  standDownMeeting() {
    if (!this.versus) return false;
    this.versus = false;
    if (this._preMeeting && this.world) this.world.rules = this._preMeeting;
    this._preMeeting = null;
    this.world?.notify?.('THE MEETING STANDS DOWN',
      'no second commander — fighting the composed wave instead', 'alarm');
    return true;
  }

  /* ── the wave loop ─────────────────────────────────────────────────── */

  /**
   * A WAVE STARTED. Two things Command adds and the base does not:
   * the army goes down with you at the top of an area, and the wave's headline
   * is the AREA rather than the wave number, because the area is the thing the
   * player is crossing.
   */
  start(wave = 1) {
    /* THE FIRST ENGAGEMENT'S LEDGER OPENS HERE — the other door into one, the
     * first time round. `closeMuster` is the door for every area after it. */
    this._logAt = this.log.length;
    /* NEVER OPEN A FIELD WITH NOBODY ON THE OTHER SIDE OF IT. The last gate
     * before the wave is composed or declined — `formUp` catches the same fact
     * a moment earlier when `World.beginVersus` runs, and this catches the
     * callers that reach `start` without it (`World.restartWave`, the direct
     * `director.start(1)` in the check suites, and a landing that opens a new
     * area). See `meetingOpposed`. */
    if (this.versus && !this.meetingOpposed()) this.standDownMeeting();
    /**
     * A MEETING HAS NO WAVE TO COMPOSE, and that is the whole of what versus
     * changes about this class.
     *
     * `CommandDirector` subclasses `WaveDirector` because a campaign wants all
     * of the escalation — the budget curve, the body cap, the heavy limit, the
     * arrivals. In a meeting the other army is a PERSON'S, deployed rather than
     * composed, so `super.start` has nothing to buy: it would fill the field
     * with a third force nobody asked for and price it against one commander's
     * strength. So the wave is never started at all and everything else about
     * the mode — the roster, the ranks, permadeath, the formations, the leash,
     * the muster — is untouched.
     */
    if (this.versus) {
      /* `wave` is on the wire (packSnapshot) and on the HUD, so it is written
       * even though nothing composes one: a meeting is one engagement and it
       * says so rather than leaving the field at whatever the constructor put
       * there for a joining player to print. */
      this.wave = wave;
      this.active = true;
      this.spawnQueue.length = 0;
      this.deployAll();
      return;
    }
    super.start(wave);
    /* AND THE LINE IS IN FRONT OF YOU BEFORE A BODY IS PLACED. Before
     * `deploy()`, not after: the slots are solved from the formation, so an
     * order given afterwards would place ten men in column and walk them round
     * over the next few seconds — and the frame this is about is the first
     * one. See `_openOnRank`. */
    this._openOnRank();
    /* NO SHIP HERE, AND THAT IS NOT AN OVERSIGHT — see `deploy`'s own note.
     * `start` is the battle OPENING: either the level has just loaded, or
     * `_afterRotate` has just run inside an extraction flight and the commander
     * is stood in a troop bay 90 m up. In the first case the line was already
     * with you before the camera opened; in the second the bodies placed here
     * are lifted straight into the bay by `Extraction._reboard` and come down
     * the ramp with you, so a gunship queued for them would be a second
     * aircraft delivering passengers who are already aboard the first. */
    if (this.roster.living.some((t) => (!t.body || t.body.dead) && !this._inbound.has(t))) this.deploy();
    /* AND THE GROUND SHOWS ENGAGEMENT ONE. §5's 0:24 — "you can see the front"
     * — is a fact about the ground the moment the camera opens, not something
     * that appears after the first muster. See `marchTo`. */
    this.marchTo(this.areaNumber);
  }

  /**
   * THE CROSSING OPENS ON A RANK, NOT A COLUMN.
   *
   * `CROSSING_FORMATION` carries the argument and `FORMATIONS.rank` carries the
   * measurements. This is the wiring, and every clause in it is deliberate:
   *
   *   OFF THE MODE'S OWN FIELD, not its name. `holdTheLine` is what separates
   *     this mode from Command, and it is already the field `_endCampaign` and
   *     `_checkLine` read. A campaign, a skirmish and a contingent keep the
   *     column they were designed around.
   *   AT THE OPENING ONLY. `start` runs at the top of every engagement, and a
   *     clause that fired at each of them would take the order back off a
   *     player who had chosen the column on purpose in area 3.
   *   ONLY IF NOTHING HAS BEEN ORDERED. `DEFAULT_FORMATION` is the untouched
   *     state; anything else is a decision somebody made.
   *   THROUGH `order()`. Exactly as `enlistCommander`'s meeting clause does,
   *     and for the same reason: the planting, the log entry and the HUD
   *     indicator all happen the way they do for a key press. An assignment to
   *     `commander.formation` would move the men and tell nobody.
   */
  _openOnRank() {
    if (!this.holdTheLine || this.areaNumber !== 1) return false;
    const c = this.commander;
    if (!c || c.formation !== DEFAULT_FORMATION || !FORMATIONS[CROSSING_FORMATION]) return false;
    this.order(CROSSING_FORMATION, c);
    return true;
  }

  /**
   * TWO ARMIES, PLACED FACING EACH OTHER.
   *
   * The anchors are the only geometry a meeting adds. `pickSpawn` and the
   * arrival ring both assume one player at the centre of the world, which is
   * correct for a horde arriving around you and meaningless for two lines that
   * have to start apart and walk toward one another.
   *
   * Laid out along +Z through the middle of the plain, half the separation
   * each way, each commander facing the other. Symmetric on purpose — a
   * meeting engagement is the one fight in this game where neither side is
   * entitled to the better ground, and any asymmetry here would be a balance
   * decision smuggled in as a spawn point.
   *
   * @param sides the side number for each commander, in order, from `sideTeam`
   *              — passed in for the same reason `enlistBody`'s team is (a
   *              static edge from this file to Player.js closes a cycle).
   * @param armies from `assignArmies`, so two Jedi are not both the Republic.
   */
  formUp(sides = [], armies = null, players = []) {
    /**
     * …AND THERE HAS TO BE SOMEBODY AT THE OTHER END OF THE LINE.
     *
     * BEFORE the anchors, not after, and that is the whole reason the gate is
     * here as well as in `start`. `World.beginVersus` copies `c.anchor` onto the
     * player's body — so a commander who has been formed up and then stood down
     * is a solo player teleported 60 m up the plain from the ground the level
     * put them on, with their army's formation solved around a point nobody
     * chose. Refusing before the anchor is assigned leaves `c.anchor` undefined
     * and `beginVersus`' own `if (p.position && c?.anchor)` declines to move
     * anybody, which is exactly right.
     *
     * The census is the list the CALLER is holding: `beginVersus` hands over
     * every player in the session before a second commander has been enlisted
     * off it, so `this.commanders.length` is still 1 at this line in a real
     * two-player meeting too.
     */
    const n = Math.max(this.commanders.length, sides.length, players.length);
    if (this.versus && !this.meetingOpposed(n)) { this.standDownMeeting(); return this.commanders; }
    const t = this.world?.terrain;
    const half = VERSUS_SEPARATION / 2;
    for (let i = 0; i < n; i++) {
      /**
       * THE SIDE AND THE ARMY GO IN, RATHER THAN BEING PAINTED ON AFTERWARDS.
       *
       * This used to be `enlistCommander({ player })` followed by three
       * assignments, and the ordering was a real defect rather than an
       * untidiness: `enlistCommander` musters the opening ten, so the second
       * commander of every meeting enlisted ten of the FIRST army's bodies —
       * `army.tiers[0].type` is `trooper` for the Republic and `b1` for the
       * Confederacy — and was then relabelled. Driven on a real meeting: both
       * armies fielded `Clone Trooper` and both rolls read `CT-####`.
       *
       * It also has to be this way round now that the roster is looked up by
       * side and army (§9): a commander whose army is assigned after the fact
       * is a commander holding the wrong roster.
       */
      const c = this.commanders[i] || this.enlistCommander({
        player: players[i] ?? null,
        side: sides[i],
        army: (armies && armies[i]) || undefined,
      });
      if (players[i]) c.player = players[i];
      if (sides[i] !== undefined) c.side = sides[i];
      if (armies && armies[i]) {
        c.army = armies[i];
        c.foe = enemyOf(c.army);
        c.roster.army = c.army;
      }
      /* Alternating ends of one line through the origin. With two commanders
       * that is exactly ±half; with four it is 2v2, two commanders to an end,
       * standing `PAIR_SPACING` apart along the line rather than on top of each
       * other. The lateral step is `floor(i/2)` and not a table of four cases:
       * the old `i < 2 ? 0 : (i % 2 ? 14 : -14)` gave the fifth and sixth
       * commanders the SAME ground as the third and fourth, so a 3v3 deployed
       * two armies inside one another. Identical for i < 4. */
      const z = (i % 2 === 0 ? -half : half);
      const x = Math.floor(i / 2) * PAIR_SPACING * (i % 2 === 0 ? -1 : 1);
      c.anchor = new THREE.Vector3(x, t ? t.height(x, z) : 0, z);
      // Facing the other end of the line. `_frame` uses this when there is no
      // body to read a heading off — which is every frame before the peer's
      // avatar has arrived, and every frame after their commander has fallen.
      c.facing = i % 2 === 0 ? 0 : Math.PI;
    }
    return this.commanders;
  }

  /**
   * ONE FRAME.
   *
   * The base director does the whole of the wave; this adds the three things
   * that are the army's rather than the wave's — the fire discipline a formation
   * implies, the officer's aura reaching the line, and the area boundary.
   */
  update(dt, ctx) {
    if (this._ffT > 0) this._ffT -= dt;
    /* The BETRAYED gate, on its own clock and a much shorter one: the notice
     * above is a nag if it repeats, where a Force power that throws four of
     * your own men is four separate things the line watched you do. 1.5 s is
     * long enough that ONE push through a squad is one betrayal. */
    if (this._btT > 0) this._btT -= dt;
    this._trackLeader(dt);
    /* THE ADVANCE IS OVER AND THIS DIRECTOR IS INERT. `world.over` already stops
     * World from calling this at all, and that is the load-bearing guard — this
     * one is for every other caller: `update` sets `intermission = 5.5` AFTER
     * `payWave` returns, so a director that was not told it had finished would
     * start wave 22 five and a half seconds after the campaign ended. */
    if (this.done) return;
    if (this._checkLine()) return;
    /* THE GROUND IS TAKEN THE MOMENT THE LINE ARRIVES, and not at the next
     * wave — `payWave` is the only other caller of `_areaClear` and it does not
     * run again until a wave is composed and cleared, so without this the
     * player would stand on won ground waiting for a fight that is over. */
    if (this.awaitingLine && this.lineIsUp()) { this.awaitingLine = false; this._areaClear(); return; }
    this._updateClosing(ctx);
    /* A meeting has no queue, no arrivals and no wave to clear — see `start`.
     * The army half of the frame is identical, which is the point: two players'
     * lines are steered by the same code one player's is.
     *
     * …AND IT HAS A FRONT NOW. See `_front`. */
    if (this.versus) { this._reinforceTick(dt); this._front(dt); this._troops(dt, ctx); return; }
    if (this.mustering) { this.arrivals.update(dt, ctx); this._troops(dt, ctx); return; }
    super.update(dt, ctx);
    this._troops(dt, ctx);
  }

  /**
   * WHAT EACH SIDE HAS LEFT, as the two maps `DuelMatch.update` takes.
   *
   * The match model is `DuelMatch`, UNCHANGED and not subclassed, and that is
   * worth stating because it is the reason a meeting has a win condition at
   * all. Its `update(dt, standing, health)` already takes side → count and
   * side → health rather than reading the arena — its own note says passing a
   * count "is what keeps the match free of the world" — so an army-vs-army
   * round is the same state machine as a duel with a different census. Rounds,
   * the countdown, the health tiebreak on the clock, the draw when both sides
   * fall together, and `packMatch`/`readMatch` on the wire all come free.
   *
   * THE COMMANDER COUNTS AS ONE OF THE STANDING. A side is out when it has
   * nothing left at all — the general down AND the last of the army with them.
   * The alternative, ending it the moment a Jedi falls, makes the armies
   * decoration in the one mode that is about them; this way losing your
   * general costs you your orders (`_frame` falls back to the anchor, so a
   * leaderless line holds the ground it was on) and not the battle.
   */
  census() {
    const standing = {}, health = {};
    /*
     * …BUT A COMMANDER WHO HAS LEFT THE SESSION IS NOT A SIDE AT ALL, and
     * leaving used to WIN.
     *
     * The paragraph above is about a general who FALLS, and it is right: their
     * army holds the ground it was on and the battle goes on without them.
     * A player who closes the tab is a different event and was being treated as
     * the same one. `main.js` disposes their avatar and takes it out of
     * `world.players`, but nothing takes their Commander out of `commanders` —
     * so their ten bodies kept their standing order, kept fighting, and kept
     * counting. Measured on a real pair: the peer removed at 5 v 9, their
     * leaderless army wiped the host's line and TOOK THE FIELD. `match-over`,
     * winner = the side of the player who had quit, and the host was told
     * `won: false`. Quitting a meeting was the strongest move in it.
     *
     * Presence in `world.players` is the signal, because it is exactly the
     * difference between the two cases: a dead general is still in that list
     * with `alive === false`, and a departed one is not in it at all. The
     * side is kept in the census at zero rather than dropped from it, so the
     * match sees a side that has been beaten rather than a side that was never
     * there — those are different states to `DuelMatch` and only one of them
     * ends the round.
     */
    const present = this.world?.players;
    /* Commanders still on their feet, per side. Zero-filled with `standing` so
     * a side that has been beaten is a side AT ZERO rather than a side that was
     * never there — `DuelMatch` tells those two apart and only one of them ends
     * the round. */
    const generals = {};
    /* A SIDE WHOSE COMMANDER HAS GONE IS STILL A SIDE, AT ZERO. The paragraph
     * above is why, and `dismissCommander` is what fills this set — the
     * Commander itself is gone from the list, which is the whole point, so the
     * side it held has to be remembered somewhere else or it stops existing. */
    for (const s of this._departed) {
      standing[s] = standing[s] || 0; health[s] = health[s] || 0; generals[s] = generals[s] || 0;
    }
    for (const c of this.commanders) {
      const s = c.side;
      standing[s] = standing[s] || 0;
      health[s] = health[s] || 0;
      generals[s] = generals[s] || 0;
      if (c.player && Array.isArray(present) && !present.includes(c.player)) continue;
      /* THIS COMMANDER'S OWN SQUADS. With one roster shared by four players
       * `roster.living` is everybody's line, so counting it per commander
       * would report a side of ten as a side of forty. See `led`. */
      for (const t of this.led(c)) {
        const b = t.body;
        if (!b || b.dead) continue;
        standing[s]++;
        health[s] += Math.max(0, b.hp || 0);
      }
      const p = c.player;
      if (p && p.alive !== false && !p.dead) {
        standing[s]++;
        health[s] += Math.max(0, p.hp || 0);
        /* THE GENERALS, COUNTED SEPARATELY — the tally `VERSUS_WINS.commanders`
         * is decided on. It is the same walk and the same "is this body still
         * in the fight" test as the line above it, because a win condition that
         * disagreed with the census about whether a commander is standing would
         * be a battle that ends twice or not at all. */
        generals[s]++;
      }
    }
    return { standing, health, generals };
  }

  /**
   * HOW FAST THE COMMANDER IS ACTUALLY MOVING, measured off their position.
   *
   * Off the POSITION rather than off `Player.velocity` or the four constants in
   * `Player._updateMove`, because every one of those is a rule this file would
   * then be restating (HANDOFF §2.4) and the quantity the follow needs is the
   * one thing none of them is: the ground speed of the body the troops are
   * chasing, after the crouch scale, the sprint multiplier, the walk axis, a
   * slope and whatever a boon did to `moveSpeed`.
   *
   * Damped at 6/s, because a single physics frame is noisy and a follow speed
   * that flickers is twenty-four bodies stuttering at once.
   */
  _trackLeader(dt) {
    if (!(dt > 0)) return;
    for (const c of this.commanders) {
      const p = c.player?.position;
      if (!p) continue;
      if (!c._leaderPos) { c._leaderPos = new THREE.Vector3().copy(p); continue; }
      const v = Math.hypot(p.x - c._leaderPos.x, p.z - c._leaderPos.z) / dt;
      c._leaderPos.set(p.x, p.y, p.z);
      c._leaderSpeed += (v - c._leaderSpeed) * Math.min(1, dt * 6);
    }
  }

  /**
   * THE ARMY'S OWN FRAME.
   *
   * `cmdIndex`/`cmdCount`/`cmdSquad` are refreshed here rather than at spawn,
   * and that is the whole reason permadeath does not leave holes in a formation:
   * the indices are positions in the LIVING list, so the moment a man falls
   * everyone behind him closes up. A stored index would leave a gap in the
   * circle exactly where the casualty was.
   */
  /**
   * WHO IS IN CHARGE OF THIS SQUAD — the module's `leadOf`, under the name
   * every caller in this class already uses. The rule itself moved out because
   * the Company tab's order of battle asks the same question of records off
   * disk, where there is no director; see the long note over `leadOf` for why
   * a second copy of it would be the worst twin in the file.
   */
  leaderOf(squad) { return leadOf(squad); }

  /**
   * ── WHO IN THIS SQUAD IS LICENSED TO `duty` ────────────────────────────
   *
   * The living, highest first, so the caller can both ask "can anybody?" and
   * take the answer. One reader for every licence question the fight asks; see
   * `holds()` and the `DUTIES` note for why there is exactly one.
   */
  licensedIn(squad, duty) {
    const out = [];
    for (const t of (squad || [])) if (t.alive && holds(t, duty)) out.push(t);
    out.sort((a, b) => (b.rank - a.rank) || (b.xp - a.xp));
    return out;
  }

  /**
   * …AND ACROSS THE WHOLE ARMY, which is the one licence that does not stop at
   * a squad boundary. See `MORALE.RELAY_NEAR`.
   */
  relaysOf(c = this.commander) {
    const out = [];
    for (const t of (c?.roster?.all || [])) {
      if (t.alive && holds(t, 'RELAYS') && t.body && !t.body.dead) out.push(t);
    }
    return out;
  }

  /**
   * MORALE, once a frame, for every living record in every army.
   *
   * The table above is the design; this is the arithmetic. Three shapes:
   * per-second drifts that depend on where a body is standing, one-shot
   * events pushed in from elsewhere (`shake`, `cheer`), and the two
   * CONSEQUENCES — breaking and refusing — which are read back out by
   * `_troops` and `targetFor` rather than being applied here.
   *
   * WHY IT IS NOT ON THE BODY. A squad broken in the spires should arrive at
   * the core ship shaken, and the Enemy is disposed at every area boundary.
   * The record is the thing that crosses.
   */
  _morale(dt, c) {
    const jedi = c.player;
    const squads = this.squadsOf(c);
    /* THE VOICE, ONCE PER FRAME FOR THE WHOLE ARMY — see `MORALE.RELAY_NEAR`.
     * Every man licensed to RELAY, wherever he is standing, because that
     * licence is the one presence term that crosses a squad boundary. Gathered
     * out here rather than per squad: it is the same handful of men for all of
     * them, and asking twenty-four times a frame for one answer is how a
     * presence term becomes a profiler entry. */
    const voices = this.relaysOf(c);
    for (const squad of squads) {
      const lead = this.leaderOf(squad);
      let living = 0, broke = 0;
      for (const t of squad) {
        if (!t.alive) continue;
        const e = t.body;
        let d = 0;
        if (e && !e.dead) {
          /* PRESENCE. The Jedi is worth more than a sergeant, and a body with
           * neither in reach is a body on its own. */
          /* HOW MUCH OF A PRESENCE TERM A MAN AT `d²` GETS — full at the
           * shoulder, `MORALE.EDGE` at the rim, nothing beyond it. See `EDGE`:
           * this was a step, and a step has one value where the channel needs
           * a range. */
          const share = (d2) => {
            if (d2 >= MORALE.NEAR * MORALE.NEAR) return 0;
            const k = Math.sqrt(d2) / MORALE.NEAR;
            return 1 - (1 - MORALE.EDGE) * k;
          };
          /**
           * HOW MUCH THIS SOLDIER LEANS ON SOMEBODY BEING THERE — and it is the
           * axis where the two armies stop being a reskin of each other.
           *
           * `bond` is Loyalty on a man and Uplink on a machine, and it scales
           * both presence terms. A Devoted clone at 1.70 fights well above
           * himself with his General beside him and comes apart the moment you
           * walk away; a Lone wolf at 0.55 gains almost nothing from you and
           * does not care when you go. That makes WHERE YOU STAND a command
           * decision every second of a fight rather than only a combat one.
           *
           * The same number reads differently on a droid, which is the point:
           * a Slaved unit is formidable while its node lives and degrades hard
           * when the officer beside it dies. One army is managed by being
           * present; the other is managed by cutting a link. See Attributes.js.
           */
          const lean = scaleOf(t, 'bond');
          let near = false, presence = 0;
          if (jedi?.position) {
            const w = share(dist2(e.position, jedi.position));
            if (w > 0) { presence += MORALE.JEDI_NEAR * w * lean; near = true; }
          }
          if (lead && lead !== t && lead.body && !lead.body.dead) {
            const w = share(dist2(e.position, lead.body.position));
            if (w > 0) { presence += MORALE.LEADER_NEAR * w * lean; near = true; }
          }
          /* …AND WHOEVER CARRIES THE COMPANY'S VOICE, from any squad. The
           * BEST of them and not the sum: two Commanders standing together is
           * two men, not twice the reassurance, and summing would make a
           * top-heavy roll pin the channel again — which is the exact defect
           * `PRESENCE_CAP` was added to undo. */
          if (voices.length) {
            let best = 0;
            for (const v of voices) {
              if (v === t || !v.body || v.body.dead) continue;
              const w = share(dist2(e.position, v.body.position));
              if (w > best) best = w;
            }
            if (best > 0) { presence += MORALE.RELAY_NEAR * best * lean; near = true; }
          }
          /* AND THEY EASE OFF AT THE CEILING — see `MORALE.PRESENCE_CAP` for
           * the 1.000 this is here to unpin. A taper and not a switch, because
           * a term that turns off on one frame reads as the number twitching;
           * the band is the same idiom `_move`'s grade falloff uses. */
          if (presence > 0) {
            const over = (t.morale - (MORALE.PRESENCE_CAP - MORALE.PRESENCE_BAND))
              / MORALE.PRESENCE_BAND;
            presence *= 1 - clamp(over, 0, 1);
          }
          d += presence;
          /* …AND THE SAME NUMBER IS THE FALL. `MORALE.ALONE` is a negative
           * drift, so scaling it by `lean` is the second half of the sentence
           * the attribute's own blurb makes: "how far he falls when you are
           * not". Without this line, Loyalty was pure upside — a bonus that
           * appears when you walk over and simply is not there when you do
           * not — and a devoted man cost nothing to field. Now he genuinely
           * comes apart on his own and a lone wolf genuinely does not care,
           * which is the trade the roster screen is showing you. */
          if (!near) d += MORALE.ALONE * lean;
          if (e.maxHp && e.hp < e.maxHp * HURT_AT) d += MORALE.WOUNDED;
        } else {
          // between areas, or waiting on a gunship: nerve comes back
          /* …AT HIS OWN RATE. Resolve on a man, Reset on a droid: how much of
           * himself he gets back between areas. This is the axis that makes a
           * roster a CAMPAIGN decision rather than a squad-picker — a man who
           * never recovers is fine today and a liability three fights from
           * now, and there is nothing on the field that will tell you. */
          d += MORALE.RALLY_PER_S * scaleOf(t, 'resolve');
        }
        /**
         * ELATION WEARS OFF — above the cap only, and at a FLAT rate.
         *
         * The first version scaled the settle by how far over the ceiling the
         * record was, which is zero exactly AT the ceiling — so there was no
         * restoring force at the one point that matters and the equilibrium
         * sat a hair above it (measured: 0.843 against a 0.84 cap, which is
         * 1.9% of a comrade falling still eaten by the clamp). Flat, the
         * settle and the presence taper meet at the cap: presence has reached
         * zero, the settle switches off, and a line resting beside its Jedi
         * sits exactly on the ceiling with a full knock of room above it.
         */
        if (t.morale > MORALE.PRESENCE_CAP) d -= MORALE.SETTLE;
        t.morale = clamp(t.morale + d * dt, 0, 1);
        /* THE ONE THING A BODY READS OFF ITS RECORD EVERY FRAME. `_pace` is
         * how much of its own speed a shaken body uses and `aimQuality`
         * already reads `trooper.morale` directly; keeping the broken flag
         * here means the three consumers cannot disagree about it. */
        t.broken = t.morale < MORALE.BREAK;
        /* A NEW FRIGHT PICKS A NEW ROCK. `_goToGround` caches the thing a man
         * is running for against this counter for the reason `_coverSite`'s own
         * note gives — a body that re-solved every frame would swap cover as
         * the horde moved, which is unwatchable — so the counter has to move
         * exactly when he breaks. Latched on the RECORD and not on the body,
         * because `shake` can break a man from outside this loop and the record
         * is the thing both of them write. */
        if (t.broken !== !!t._fearMark) {
          t._fearMark = t.broken;
          if (t.broken && e) e._fearEpoch = (e._fearEpoch | 0) + 1;
        }
        living++;
        if (t.broken) broke++;
      }
      /**
       * …AND THE SQUAD'S OWN ANSWER TO THE SAME QUESTION.
       *
       * "they should fall back when a position is lost." Breaking is what one
       * man does; a rout is what a squad does, and it is the same fact counted
       * one level up — `MORALE.ROUT` of them broken and the ground they were
       * holding is no longer being held by anybody. The men who are still
       * steady go back with them, which is the part that makes it a WITHDRAWAL
       * rather than three separate men running: a squad that leaves its two
       * bravest riflemen standing on a lost position has not fallen back, it
       * has been destroyed in detail.
       *
       * Written on the RECORD beside `broken` and derived from it, so there is
       * no second state to clear: the moment enough nerve comes back — a rally,
       * a commander walking over, the wave clearing — the count falls under the
       * fraction and the squad re-forms with no event anywhere. `steer` is the
       * only reader.
       */
      const rout = living > 0 && broke > living * MORALE.ROUT;
      for (const t of squad) if (t.alive) t.rout = rout;
    }
  }

  /**
   * A THING HAPPENED TO THIS SQUAD. One entry point for every event in the
   * MORALE table that is not a per-second drift, so the table is the only
   * place the numbers live.
   *
   * @param who    a Trooper, an array of them, or null for the whole army
   * @param key    a key of MORALE
   */
  shake(who, key, c = this.commander) {
    const amount = MORALE[key];
    if (amount === undefined) return 0;
    /* "the whole army" is THIS COMMANDER'S — one roster shared by four players
     * would otherwise be shaken once per player for one wave cleared. */
    const list = who ? (Array.isArray(who) ? who : [who]) : this.led(c);
    let n = 0;
    for (const t of list) {
      if (!t || !t.alive) continue;
      const was = t.morale;
      t.morale = clamp(t.morale + amount, 0, 1);
      t.broken = t.morale < MORALE.BREAK;
      if (was >= MORALE.BREAK && t.broken) {
        this.log.push({ t: 'broke', name: t.name, area: this.areaNumber });
        if (c === this.commander) {
          this.world?.notify?.(`${t.name} IS BREAKING`, 'get to them, or lose them');
        }
      }
      n++;
    }
    return n;
  }

  /** The squad a record belongs to, as an array. Derived like everything else. */
  squadOf(t, c = this.commander) {
    for (const sq of c.roster.squads()) if (sq.includes(t)) return sq;
    return [t];
  }

  _troops(dt, ctx) {
    /**
     * WHERE THE SHOOTING IS COMING FROM GOES STALE, and it used to go stale
     * for a whole order.
     *
     * `_coverSite` solves one threat bearing for the whole army and caches it
     * against `_coverEpoch`, which only moves when an order is given. That is
     * right for TAKE COVER — the order is the moment of choosing — and it is
     * wrong for a man leaning behind a drum in the middle of a fight, who
     * should be putting it between himself and the muzzle that is firing at
     * him NOW. Clearing the mark once a second is what makes the second
     * caller honest; a second bearing computed a second way would be the
     * thing this file keeps deleting.
     */
    this._threatT = (this._threatT || 0) + dt;
    if (this._threatT >= 1) { this._threatT = 0; this._threatAt = -1; }
    /**
     * ── AND WHO CAN HEAR YOU, WHICH CHANGES BECAUSE YOU WALKED ─────────────
     *
     * `_announceRoster` is EVENT-DRIVEN — a death, a deploy, a start — and
     * every one of those events is something happening to the ROLL. The
     * earshot readout it now carries is not about the roll at all; it is about
     * where you are standing, and it changes on a frame where nothing has
     * happened to anybody. So a panel refreshed only on those events would
     * have told the player "2nd Squad — out of reach" for the whole of the
     * next engagement after they walked back to it.
     *
     * FOUR TIMES A SECOND AND ONLY ON A CHANGE. The signature is the deaf set,
     * so a player standing still repaints nothing and a player crossing the
     * boundary repaints once. The cost when nothing changes is one walk of the
     * roll per quarter second, against `_troops`'s own walk of it every frame.
     */
    this._earT = (this._earT || 0) + dt;
    if (this._earT >= 0.25) {
      this._earT = 0;
      const c0 = this.commander;
      if (c0 && this.onRoster) {
        const voices = this._voices(c0);
        let sig = '';
        for (const t of this.led(c0)) if (!this._inReach(t, voices)) sig += t.id + ',';
        if (sig !== this._earSig) { this._earSig = sig; this._announceRoster(); }
      }
    }
    /* Per commander, and the indices restart per army: `cmdIndex` is a position
     * in ONE roster's living list, and two armies sharing a numbering would
     * have the second one solving its slots against the first one's count. */
    for (const c of this.commanders) {
      this._slewFrame(c, dt);
      this._advanceAnchor(c, dt);
      this._morale(dt, c);
      /* The commander's own Force, one clock per verb per army. Here rather
       * than in `update` because this is the loop that already runs once a
       * frame for every commander in the world, meeting or campaign. */
      if (c._castCd) for (const k in c._castCd) if (c._castCd[k] > 0) c._castCd[k] = Math.max(0, c._castCd[k] - dt);
      const F = FORMATIONS[c.formation] || FORMATIONS[DEFAULT_FORMATION];
      /* THIS COMMANDER'S SQUADS AND THIS COMMANDER'S COUNT. `slot(i, n, k)` is
       * solved in ONE commander's frame — `i` is a position in the line they
       * are leading and `n` is how long that line is — so with a roster shared
       * between four players both have to be the share, not the whole. Four
       * players each solving a twenty-man circle would put every man in four
       * different places and hand the frame to whichever loop ran last. */
      const squads = this.squadsOf(c);
      this._gravesFelt(dt, c);
      let i = 0;
      let n = 0;
      for (const sq of squads) n += sq.length;
      for (let k = 0; k < squads.length; k++) {
        /**
         * WHAT THE MAN IN CHARGE IS FIGHTING — read once per squad, not once
         * per trooper, and stamped on the bodies for `targetFor` to prefer.
         *
         * "concentrate fire on what their leader is fighting." The leader is
         * already derived (`leaderOf`), so nothing new is stored anywhere: the
         * squad's focus is whatever its highest-ranked living member picked
         * this frame, and the moment he falls the next man's pick becomes the
         * squad's on the following frame — the same property that makes the
         * hierarchy work at all.
         *
         * ONE FRAME LATE, ON PURPOSE AND STATED. `_think` runs inside
         * `world.enemies`' own update and this runs after it, so the focus a
         * trooper reads is the target its leader had last frame. Refreshing it
         * inside `targetFor` instead would cost a `squadOf` walk per trooper
         * per frame — twenty-four rosters scanned twenty-four times — to buy
         * one frame of latency on a decision that is re-made sixty times a
         * second. It is not worth it and it would be the slower answer.
         */
        /* THE SQUAD'S OWN ORDER, and the fire gate reads it now.
         *
         * `F` above is the ARMY's formation, and it was what decided whether a
         * body held its fire — so a single squad told to HOLD FIRE went on
         * shooting, because the army had not been. `formationFor` is the one
         * derivation of "what is this squad under" and `slotFor` has always
         * used it; this is the same question asked in the one other place that
         * was answering it with the army's answer. */
        const Fk = FORMATIONS[this.formationFor(c, k)] || F;
        const digging = Fk.digs ? this._digTick(dt, c, k, squads[k]) : false;
        const lead = this.leaderOf(squads[k]);
        const focus = (lead && lead.body && !lead.body.dead) ? lead.body.target : null;
        /* …AND THE LEADER DOES NOT FOLLOW HIMSELF. Stamping the focus on every
         * body of the squad including his own made his last pick his next
         * pick, every frame, for as long as it stayed in reach — a target lock
         * nobody asked for, on the one man whose job is to choose. Measured in
         * a meeting: both lines locked onto each other's front rank at first
         * contact and neither ever re-aimed. */
        /**
         * ── A DELEGATED SQUAD FORMS A WHOLE SHAPE, NOT A FRAGMENT OF ONE ────
         *
         * `slot(idx, n, k)` lays a formation out by a man's index within a
         * COUNT, and both were the ARMY's: `i` ran globally across every squad
         * and `n` was the whole living line. So a second squad of five ordered
         * into a circle got `slot(5..9, 10)` — `a = (i/n) * TAU` — and stood in
         * the arc from 180° to 324°. A half ring. Ordered into a line it took
         * one wing of a rank and left the other empty.
         *
         * That is the owner's complaint arriving as geometry: "it says 2
         * squads but for all intents and purposes it's just one squad". Both
         * squads really were on two anchors under two orders, and each one was
         * drawing a slice of a shape meant for ten men.
         *
         * SO A SQUAD UNDER ITS OWN ORDER IS LAID OUT AS ITS OWN LINE — index
         * within the squad, count of the squad. A squad still under the ARMY's
         * order keeps the army's index and count, because there the shape IS
         * the army's and slicing it would break the one formation that is
         * supposed to span everybody.
         */
        /**
         * …AND ONLY WHERE THE SQUAD HAS AN ORDER OF ITS OWN.
         *
         * A squad under the ARMY's order keeps the army's index and count,
         * because there the shape IS the army's and slicing it would break the
         * one formation that is supposed to span everybody.
         *
         * THE OTHER HALF OF THIS IS IN `_anchorFor`, and it took a measurement
         * to find: an ADVANCING order writes no plant, so two squads both told
         * to advance both fell through to the commander's frame and solved the
         * same shape around the same point — ten men on five slots, five
         * stacked pairs, because `front`'s slot ignores the squad index. A
         * squad sent forward on its own goes forward from its own ground now,
         * so its own numbering lands somewhere of its own.
         */
        const own = c.squadOrders?.has(String(k));
        const live = own ? squads[k].filter((t) => t.body && !t.body.dead).length : n;
        let j = 0;
        for (const t of squads[k]) {
          const e = t.body;
          if (!e || e.dead) { i++; continue; }
          e.cmdIndex = own ? j++ : i;
          i++;
          e.cmdCount = own ? Math.max(1, live) : n;
          e.cmdSquad = k;
          e.cmdFocus = (focus && t !== lead) ? focus : null;
          /* UNDER FIRE decays here for the same reason the indices are
           * refreshed here: this is the one loop that touches every living
           * body of every army exactly once a frame. See UNDER_FIRE, and
           * `installTeamDamage` for what sets it. */
          if (e.underFire > 0) e.underFire = Math.max(0, e.underFire - dt);
          /**
           * ── THE WOUND YOU CAN SEE, IN EVERY MODE ────────────────────────
           *
           * `Trooper.wounds` is persisted, printed on the dossier, phrased in
           * the story line, celebrated in the orders of the day, and PAINTED
           * ON THE PLATE by `scorchUp` at the next deploy. It had exactly one
           * writer — `Enemy._getUpFromDown` — and that writer only fires where
           * `MODES.downed` is declared, which is The Line and nowhere else. So
           * in Command, in skirmish, in the wave modes — every mode a company
           * actually lives in — the scars were unreachable. A feature that is
           * shipped, saved, displayed and impossible to earn.
           *
           * The second writer is here, in the one loop that touches every
           * living body of every army exactly once a frame: a man whose body
           * drops under `HURT_AT` — the same third `_morale` reads — is a man
           * who was nearly killed, and if he walks off the ground he wears it.
           *
           * ONE PER MAN PER RUN, and `_getUpFromDown` respects the same flag —
           * so `wounds` means "runs he nearly died in" rather than "times a
           * bolt got through", which is the number a roster wants and the one
           * a scar can honestly stand for. `_hurtRun` is on the record and not
           * on the body because the body is disposed at every area boundary
           * and the man crosses.
           *
           * IT BUYS NOTHING. A scar is a mesh; `enlistBody` applies the rank
           * and the profile and paints this on top, exactly as a mark is.
           */
          if (!t._hurtRun && e.maxHp > 0 && e.hp <= e.maxHp * HURT_AT) {
            t._hurtRun = true;
            t.wounds = (t.wounds | 0) + 1;
          }
          /* …AND THE MAN CARRYING AN ORDER, in the same loop and for the same
           * reason: it is the one that touches every living body of every army
           * exactly once a frame. See `_runnerTick`. */
          if (t.runner) this._runnerTick(t, dt);
          /**
           * …AND SO DOES THE ORDER HE IS ACTUALLY ACTING ON. See `ORDER_LAG`.
           *
           * `Fk.id` is what the squad has been TOLD; `e.cmdOrder` is what this
           * man is doing about it yet. They are the same thing for a body that
           * has had a moment, and for the first second after a new order they
           * are not — which is the whole of Reflex on the field.
           *
           * Here, in the one loop that touches every living body once a frame,
           * for the same reason `underFire` decays here: `slotFor` is called
           * more than once a frame by more than one caller and has no `dt`, so
           * a clock inside it would run at whatever rate it happened to be
           * asked. Both readers read the answer; neither computes it.
           */
          /* …AND A MAN WHO REFUSED IT IS NOT LAGGING BEHIND IT. `Fk` is what
           * the SQUAD was told; a refuser is under an order of his own
           * (`formationFor`'s first clause) and reading the squad's here would
           * hand him a target he never took, then time him into it. */
          const Fm = FORMATIONS[this.formationFor(c, k, t)] || Fk;
          if (e.cmdOrder == null) e.cmdOrder = Fm.id;
          else if (e.cmdOrder !== Fm.id) {
            e.cmdOrderT = (e.cmdOrderT || 0) + dt;
            if (e.cmdOrderT >= ORDER_LAG * (t.scale ? t.scale('reflex') : 1)) {
              e.cmdOrder = Fm.id;
              e.cmdOrderT = 0;
            }
          } else e.cmdOrderT = 0;
          /* Fire discipline. `holdFire` is Waves.js's own primitive — it pushes
           * the fuse back up without touching the brain, so a trooper ordered to
           * hold still takes cover, calls out and tracks you exactly as it did.
           *
           * …AND THE CLOSE-OUT LIFTS IT, which is not a second rule: `_closing`
           * is this file's existing statement that a wave with four bodies left
           * is not a battle any more and every order is off. It already opens
           * the leash so a squad told to take cover breaks it and goes; a line
           * that kept its guns down through that would reproduce the exact
           * failure that note was written for — a driven run stuck from t≈711 s
           * to t=3535 s with two bodies alive and no way out but Abandon —
           * except that this time the army would be standing next to them. */
          /* …AND A MAN WITH A SHOVEL IN HIS HANDS IS NOT SHOOTING. That is the
           * whole price of a position (PLAN.md §4.7): a squad gives up its
           * fire for `DIG_SECONDS` on ground it has already been told it
           * cannot leave. It lifts the moment the position is finished, and
           * `_closing` lifts it early for the reason it lifts every order. */
          /* …AND A POORLY DISCIPLINED MAN BREAKS IT. See `HOLD_BREAK`. The
           * break is on the BODY and not on the order, so a squad told to hold
           * still holds — it is one man in it who did not, which is what the
           * player is being asked to notice about him. */
          /* THE ORDER HE HAS TAKEN IN, which for the gun is the whole point:
           * you call HOLD FIRE and the slow men in the line are still firing
           * for a beat. `Fk` is what the squad was told; `e.cmdOrder` is what
           * this man is doing about it yet. */
          const Fe = FORMATIONS[e.cmdOrder] || Fk;
          if ((Fe.fire <= 0 || digging) && !this._closing) {
            /**
             * …AND A POORLY DISCIPLINED MAN BREAKS IT WHEN HE IS BEING SHOT AT.
             *
             * `underFire` gates it, and that gate is the design rather than a
             * softening. A break at empty air would ruin the one thing HOLD
             * FIRE is for — walking a line into position without giving it
             * away — and the player could neither see who did it nor do
             * anything about it. Under fire it is the opposite: a man with
             * rounds landing on him returns them, you can see exactly which
             * man, and where you put him was your decision. An ambush is still
             * silent; a poor line pinned in the open is not.
             */
            /* NO DICE. A per-body accumulator rather than a roll per frame:
             * `Math.random()` in the update loop is a divergence between a
             * host and a guest running the same second (`command-pvp.mjs`
             * caught exactly that in the muster), and drawing from
             * `commandRng` here would advance the army's shared stream at
             * frame rate and make everything else that reads it depend on the
             * frame time. A man can take so much and then he answers: the poor
             * one breaks first, every time, which is also the more legible
             * rule. */
            const disc = t.scale ? t.scale('discipline') : 1;
            if (e.cmdBreak > 0) e.cmdBreak -= dt;
            else {
              if (disc < 1 && e.underFire > 0) {
                e.cmdHold = (e.cmdHold || 0) + dt * (1 - disc) * HOLD_BREAK / 0.28;
                if (e.cmdHold >= 1) { e.cmdHold = 0; e.cmdBreak = BREAK_FOR; }
              }
              holdFire(e);
            }
          } else { e.cmdBreak = 0; e.cmdHold = 0; }
          this._clearBlade(e, c, dt);
        }
      }
    }
  }

  /**
   * THEY ARE WALKING PAST THEIR OWN DEAD — PLAN.md §4.8's third bullet.
   *
   * "A marker where each man of the company fell, on that ground, in later
   * runs, with the surviving squad's morale reacting when they walk past it."
   * `src/world/Graves.js` is the first half and this is the second: the ground
   * remembering and the men minding are one mechanism, which is what that
   * bullet means by "one system with §4.7's ground memory, not two".
   *
   * ── ONE MAN A FRAME, AND THAT IS THE WHOLE COST ────────────────────────
   *
   * Every living body against every marker is 24 × 64 distance tests a frame in
   * a mode whose frame budget PLAN.md §4.3 is entirely about. So this walks
   * ONE man per commander per frame, round-robin: at 30 Hz a twelve-man line is
   * sampled two and a half times a second, which is four times finer than the
   * cooldown the reaction is rate-limited by. A man cannot walk past a grave
   * without being asked, and nothing is asked twice.
   */
  _gravesFelt(dt, c) {
    const graves = this.world?.graves?.entries;
    if (!graves?.length) return;
    const living = c?.roster?.living || [];
    if (!living.length) return;
    const k = (c._graveCursor = ((c._graveCursor | 0) + 1) % living.length);
    const t = living[k];
    const e = t?.body;
    if (!e || e.dead || e.downed) return;
    t._graveT = Math.max(0, (t._graveT || 0) - dt * living.length);
    if (t._graveT > 0) return;
    const r2 = MORALE.GRAVE_FELT * MORALE.GRAVE_FELT;
    for (const g of graves) {
      const dx = g.x - e.position.x, dz = g.z - e.position.z;
      if (dx * dx + dz * dz > r2) continue;
      /* HIS OWN, and never his own marker: a man cannot walk past the place he
       * himself fell, but a roster that reuses a name across a campaign could
       * hand him one. The name is the only identity a grave keeps. */
      if (g.name === t.name) continue;
      t._graveT = MORALE.GRAVE_COOLDOWN;
      this.shake(t, 'PASSED_GRAVE', c);
      return;
    }
  }

  /**
   * ONE SQUAD, ONE POSITION — PLAN.md §4.7's Dig In.
   *
   * @returns whether these men currently have their hands full, which is what
   *          the fire gate above reads.
   *
   * ── WHY THE STATE IS PER SQUAD AND NOT PER MAN ─────────────────────────
   *
   * The engine's heightfield cell is 2.5–3.4 m, so five individual scrapes are
   * five craters the ground cannot tell apart — see `DIG_R`. What a squad digs
   * is ONE position, and that is also the right unit for the design: the
   * delegation that shipped for §4.4 gives a squad its own ground, and this is
   * what a squad does with ground it has been given.
   *
   * ── AND IT IS DUG THROUGH THE ONE DOOR THAT BREAKS GROUND ──────────────
   *
   * `Terrain.crater` with a deep bowl and a heavy rim, which is exactly what a
   * scrape and its spoil are. Nothing here reaches into the heightfield: the
   * crater is the game's only verb for moving earth, `CraterLog` wraps it, and
   * so a position dug in engagement two is still there in engagement three
   * without this file knowing that persistence exists. It costs one call.
   *
   * The soot the crater lays with it is honest rather than unfortunate — the
   * ground has been turned over, and a fresh earthwork on a dust plain reads
   * dark. What says "position" rather than "shell hole" is the shape: a berm
   * 0.76 m proud of the ground all the way round, which no shell in this game
   * can make.
   */
  _digTick(dt, c, k, squad) {
    const key = String(k);
    const digs = (c.digs || (c.digs = new Map()));
    let rec = digs.get(key);
    /* WHERE THEY WERE TOLD TO STAND, which is the squad's own planted ground
     * when it has one and the army's frozen frame otherwise. Taken ONCE, at
     * the first tick: a position that followed the anchor would be a hole that
     * moved while it was being dug. */
    if (!rec) {
      const A = this._anchorFor(FORMATIONS.digin, c, k);
      if (!A?.pos) return false;
      rec = { x: A.pos.x, z: A.pos.z, t: 0, done: false };
      digs.set(key, rec);
    }
    if (rec.done) return false;
    /* WHO IS ACTUALLY ON IT. A man running back to the position is not digging
     * it, and a man on the ground is not either — the same clause that keeps a
     * casualty out of the quorum keeps him off the shovel. */
    let crew = 0;
    /**
     * ── …AND A LICENSED MAN IS A CREW ON HIS OWN ───────────────────────────
     *
     * `CREWS` — "counts as a crew with no commander present", the Captain's
     * rung. `DIG_CREW` men have to be standing on the spot before earth moves,
     * which is the right rule for a line of troopers and is exactly the rule
     * that a Captain, who has done this in four campaigns, should be allowed
     * to break. So one licensed man on the position digs it alone.
     *
     * ADDITIVE, and that word is load-bearing: nothing that could be dug
     * before can be dug less easily now. What this buys is a position a
     * three-man remnant could not have had — and it goes away with him, which
     * is the whole point of the ladder.
     */
    let licensed = false;
    for (const t of squad) {
      const e = t.body;
      if (!e || e.dead || e.downed) continue;
      const dx = e.position.x - rec.x, dz = e.position.z - rec.z;
      if (dx * dx + dz * dz > DIG_WORK_R * DIG_WORK_R) continue;
      crew++;
      if (holds(t, 'CREWS')) licensed = true;
    }
    if (crew < DIG_CREW && !licensed) return false;
    /* AND SOME LINES KNOW HOW TO USE A SHOVEL — PLAN.md §4.6's Field
     * Engineering, which is a rule about what your ARMY can do rather than a
     * number on the player. */
    rec.t += dt * clamp(this.world?.player?.boonMods?.digRate ?? 1, 0.25, 4);
    if (rec.t < DIG_SECONDS) return true;
    rec.done = true;
    this.digs = (this.digs | 0) + 1;
    const T = this.world?.terrain;
    if (T?.crater) T.crater(rec.x, rec.z, DIG_R, DIG_DEPTH, DIG_RIM);
    this.log.push({ t: 'dug', squad: k, area: this.areaNumber, wave: this.wave,
                    at: Math.round((this.world?.time || 0) * 10) / 10 });
    if (c === this.commander) {
      const lead = this.leaderOf(squad);
      this.world?.notify?.(`${this.squadLabel(k, c).toUpperCase()} — DUG IN`,
        lead ? `${lead.name} has a position now, and it is cover from anything at range`
             : 'the ground is a position now, and it is cover from anything at range');
    }
    return false;
  }

  /**
   * GET OUT OF THE WAY OF THE BLADE.
   *
   * "in too many of the troop formations the troops are totally in the way of
   * your saber like they don't avoid it at all and crowd you.""
   *
   * Nothing in the formation solver knew the commander was holding a weapon.
   * The slots are all clear of one — `circle`'s inner rank is at 4.2 m against
   * a 2.3 m working volume — but a slot is a TARGET, and a trooper walking to
   * it, fighting from it, backing off something, or shoved into you by a blast
   * is not standing at it. What crowds you is the traffic, not the shape.
   *
   * So the clearance is enforced on the BODY, every frame, and it is a shove
   * rather than a refusal: a trooper inside `BLADE_ROOM` is pushed radially
   * out at a pace that gets it clear in about a third of a second and its
   * `wish` is overridden for that frame, so it stops walking into you. Radial
   * and not tangential, because the shortest way out of a swing is straight
   * away from the person swinging.
   *
   * IT DOES NOT APPLY TO A TROOPER THAT IS FIGHTING SOMETHING WITHIN THE RING.
   * If an acolyte has closed on the commander, the trooper going in after it
   * is doing its job, and pushing it out would be the mode refusing to help.
   * The test is its own target's distance from the commander, not its own.
   */
  _clearBlade(e, c, dt) {
    const p = c.player;
    if (!p || !p.position || e.dead) return;
    const dx = e.position.x - p.position.x, dz = e.position.z - p.position.z;
    const d2 = dx * dx + dz * dz;
    if (d2 >= BLADE_ROOM * BLADE_ROOM || d2 < 1e-6) return;
    const tgt = e.target;
    if (tgt && !tgt.dead) {
      const tx = tgt.position.x - p.position.x, tz = tgt.position.z - p.position.z;
      if (tx * tx + tz * tz < (BLADE_ROOM + 1.5) * (BLADE_ROOM + 1.5)) return;
    }
    const d = Math.sqrt(d2), inv = 1 / d;
    const nx = dx * inv, nz = dz * inv;
    /* Written onto `wish` AND onto the position, and both are needed: `wish`
     * is what `_move` integrates and stops the body walking back in this
     * frame, and the direct nudge is what gets a body that is stunned,
     * knocked or braced out of the swing at all — a trooper on the floor has
     * no wish and is exactly the one you cut in half by accident. */
    if (!e.wish) e.wish = new THREE.Vector3();
    e.wish.set(nx, 0, nz);
    if (!e.toTarget) e.toTarget = new THREE.Vector3();
    e.toTarget.set(nx, 0, nz);
    const push = Math.min(BLADE_ROOM - d, 9 * dt);
    e.position.x += nx * push; e.position.z += nz * push;
    if (this.world?.terrain) e.position.y = this.world.terrain.height(e.position.x, e.position.z);
    e._syncBody?.();
  }

  /**
   * THE WAVE CLEARED — and possibly the AREA with it.
   *
   * Hung off the base director's own clear path rather than duplicated: the base
   * fires `onWaveClear`, World's handler pays the score and the Insight, and
   * this decides whether that was the last wave of an area. `fresh` rides along
   * for the same reason it does there — a restarted wave must not pay a muster.
   */
  payWave(wave) {
    const fresh = super.payWave(wave);
    if (!fresh || this.done) return fresh;
    this.areaWaves++;
    // Experience for living through it: a body that was on the field when the
    // wave cleared earned something even if it never fired.
    for (const t of this.roster.living) {
      const p = t.award(XP_PER_WAVE);
      if (p) this._promoteTrooper(t, t.body);
    }
    /**
     * …AND THE NERVE THAT COMES WITH SURVIVING ONE.
     *
     * `MORALE.WAVE_CLEAR` has been in the table since it was written, at 0.34
     * — the second largest event in it, behind only holding a whole area — and
     * nothing ever called it. So a line that had just beaten a wave off got
     * nothing for it, and the only thing that could lift a shaken squad
     * between areas was standing next to it. "Troops perform better when
     * you're winning" was the first sentence of the note the table implements
     * and it was the one clause with no arithmetic behind it.
     *
     * Every army on the field, not only the player's: in a campaign there is
     * one, and in a meeting there is no wave to clear, so the loop is what the
     * sentence means rather than a hedge.
     */
    for (const c of this.commanders) this.shake(null, 'WAVE_CLEAR', c);
    /**
     * …AND A CONTINGENT HAS NO AREAS TO CLEAR.
     *
     * `_areaClear` opens a muster screen, recalls the line onto gunships,
     * advances `areaIndex` and — five areas in — calls `_endCampaign`, which
     * fires `onGameOver` with a victory. Every one of those is right for a
     * crossing of Geonosis and wrong for ten men the player asked for in the
     * Trial of Waves: it would END AN ENDLESS MODE on wave 21 and call it a
     * win. So the area ledger is the campaign's and the replacements are the
     * contingent's, and neither mode runs the other's.
     */
    if (!this.campaign) { this._reinforce(); return fresh; }
    /* THE GROUND IS TAKEN BY THE LINE, NOT BY THE KILL COUNT — see
     * `lineIsUp` and `MODES.theline.lineAdvances`. In Command this is `true`
     * every time and the line below is the sentence it always was. */
    if (this.areaWaves >= this.area.waves) {
      /**
       * AN ARMY THAT NO LONGER EXISTS DID NOT TAKE THIS GROUND.
       *
       * `lineIsUp` answers TRUE for an empty roster, and it has to: a rule that
       * waited for a line that cannot come is a rule that hangs the run. But
       * `payWave` calls `_areaClear` synchronously, and `_checkLine` — the door
       * that ends a run whose army is gone — does not get its frame until the
       * next `update`. So the last wave paid by a dead line logged an `area`
       * record on the way out, and `areasTaken` reads that log: the defeat card
       * would credit the player with ground their army was not alive to hold.
       *
       * Doing nothing here is right rather than lazy. The run is over, the very
       * next frame ends it, and the only question was whether it ends with an
       * honest ledger.
       */
      if (this.holdTheLine && this._landed && this.roster.strength === 0) {
        /* over — `_checkLine` ends it next frame */
      } else if (this.lineIsUp()) this._areaClear();
      else this._awaitLine();
    }
    return fresh;
  }

  /**
   * IS THE LINE UP? — and this method is the answer to `FLAGSHIP.md` §7's
   * central claim, which was measured FALSE and stayed false through four
   * attempts to fix it somewhere else.
   *
   * ── WHAT WAS ACTUALLY WRONG ──────────────────────────────────────────
   *
   * §1: "your job is not to kill everything — it is to be the reason the line
   * is still standing when it takes the ridge." §6 says how that is supposed to
   * hold: "the objective advances at the pace of the slowest friendly inside
   * 14 m. You can sprint 200 m into their rear; the line does not come with
   * you… **Killing stays fast and fun and advances nothing.**"
   *
   * That last sentence was never implemented. `payWave` took the ground when
   * `areaWaves >= area.waves` — a count of cleared waves, and nothing else.
   * So killing everything, alone, two hundred metres in front of your men,
   * TOOK THE AREA. `advancePace` was built and is correct and moves the
   * formation anchor at the slowest man's speed, but the anchor decided where
   * the line stood, not whether the run advanced.
   *
   * Four mechanisms were built to make a Jedi worth something to his line —
   * presence as a morale term, `openness` as a multiplier on other people's
   * guns, a bolt screen for the man beside you, and the attrition tuning — and
   * every one of them measured as not paying. The diagnosis in `NEXT.md` is
   * that each was a local good handed to the one body on the field that does
   * not stay local: measured, the line holds together to about seven metres and
   * **the player is the one who leaves**, up to 26 m ahead of his own men.
   *
   * A fifth local good would have failed the same way. What was missing is not
   * a reward for standing still; it is that **standing with the line was not
   * how the run advanced**. Killing was.
   *
   * ── THE RULE ─────────────────────────────────────────────────────────
   *
   * A quorum of the living inside `MORALE.NEAR` — the same radius presence,
   * the pace rule and the nerve ledger already use, so a player learns one
   * distance and not four. Half, because a line that has lost men is still a
   * line and a rule that wanted all of them would make one straggler a wall.
   *
   * It needs no new number, no new HUD element and no new verb. It makes every
   * one of those four mechanisms pay at once, because each of them keeps men
   * alive and near you and that is now the thing that advances the run.
   *
   * NOT a timer, and not a walk-back penalty: both punish the player for
   * having left. This does not punish anything. It declines to advance until
   * the army that is supposed to be taking this ground is standing on it,
   * which is what "the line takes the ridge" means.
   */
  /* AND NOT AGAINST THE FRONT, which is the obvious-looking alternative and is
   * refuted by measurement — see the note over `Front.engagementFront`. The
   * line stands 165–200 m behind the engagement's front on every seed, because
   * the front is the war closing `FRONT_STEP` at a time and not the ground this
   * squad is standing on. A quorum inside `MORALE.NEAR` of it is unreachable at
   * every engagement a sitting contains, so that rule would never take an area
   * at all. */
  /**
   * ══ THE FRONT — two lines, one piece of ground, and it moves ═══════════
   *
   * `lineIsUp` decides whether ONE commander's army is standing on the ground
   * it is taking. It has always taken a commander argument and nothing ever
   * passed one. A meeting has two commanders, and asking the same question of
   * both of them is the whole of a moving front.
   *
   * The state is one scalar, `front`, in [-1, +1]: 0 is the middle of the
   * field, +1 is side 0's own baseline and -1 is side 1's. A side wins by
   * driving it to the other's baseline.
   *
   * ── WHY THE RULE IS "UP AND FORWARD" AND NOT "UP" ─────────────────────
   *
   * A commander pushes when two things are true at once, and the second is
   * what makes this a battle rather than a race:
   *
   *   HIS LINE IS UP. `lineIsUp(c)` — half his living men inside `MORALE.NEAR`
   *     of him. This is the same quorum the crossing uses, so a player learns
   *     one rule and not two, and it is the reason a general who has run out
   *     ahead of his own army moves nothing.
   *   HIS LINE IS PAST THE FRONT. The centroid of his living men has to be on
   *     the far side of the line he is trying to move. A quorum standing on
   *     ground it already holds is holding, not advancing.
   *
   * So the front moves toward whichever side is BOTH gathered and forward, at
   * `FRONT_PUSH` of the field a second, and it stalls when both sides are or
   * neither is. That produces the push and the counter-push out of one number
   * without a script: you take ground while your men are with you, and you give
   * it back the moment you leave them to go and fight somewhere interesting.
   *
   * IT MOVES AT THE SLOWER OF THE TWO, deliberately. Subtracting one side's
   * push from the other's would let a broken army still slow a good one merely
   * by existing; taking the difference of two booleans means a contested front
   * simply stops, which is what a stalemate looks like and what the men on it
   * are for.
   */
  /**
   * THE FRONTLINE VARIANT — reinforcements, in waves, to both sides.
   *
   * "maybe also a mode where reinforcements come in waves so imagine like two
   * armies meeting and a frontline."
   *
   * A meeting without this is one army against one army: whatever you brought
   * is what you have, and the battle is a single collision that resolves in a
   * couple of minutes. With it the field stops being a collision and becomes a
   * LINE — men keep arriving behind you, the middle of the plain is where they
   * meet, and holding ground starts to mean something because the ground is
   * what decides whose reinforcements reach the fight first.
   *
   * BOTH SIDES, ON ONE CLOCK, AND THAT IS THE WHOLE FAIRNESS ARGUMENT. A timer
   * per side would drift apart the moment one of them was interrupted, and a
   * battle where one army's replacements arrive a beat sooner every cycle is
   * decided by the timer rather than by the fight. One clock, one wave, both
   * ends of the field.
   *
   * ONE ROSTER PER SIDE, NOT ONE PER COMMANDER. `_rosterFor` already shares a
   * roster between allies, so reinforcing every commander would pay a side with
   * three players three times — a 3v1 that is also 3× the replacements is not a
   * battle. The set is what makes it once per side however many people are
   * leading it, which is the same sentence `openingFor` is.
   *
   * `SQUAD` a side a wave, through `reinforce` — the one door that prices,
   * guards, enlists, logs and flies them in. The purse is what stops this being
   * infinite: a roster's points run out, `reinforce` returns 0, and the side
   * that spent better lasts longer.
   */
  _reinforceTick(dt) {
    if (!(this.reinforceEvery > 0) || this._netShell) return;
    this._reinforceIn -= dt;
    if (this._reinforceIn > 0) return;
    this._reinforceIn = this.reinforceEvery;
    const done = new Set();
    let sent = 0;
    for (const c of this.commanders) {
      if (done.has(c.roster)) continue;
      done.add(c.roster);
      sent += this.reinforce(SQUAD, { byShip: true }, c);
    }
    if (sent) {
      this.log.push({ t: 'reinforce-wave', n: sent, wave: this.wave });
      this.world?.notify?.('REINFORCEMENTS', `${sent} more on the ramp — both lines`);
    }
    return sent;
  }

  _front(dt) {
    if (!this.versus) return;
    const cs = this.commanders || [];
    if (cs.length < 2) return;
    if (this.front === undefined) this.front = 0;

    const half = VERSUS_SEPARATION / 2;
    let push = 0;
    for (const c of cs) {
      /* `sign` is the direction this commander pushes the front: side 0 drives
       * it toward -1 (into side 1's ground) and side 1 toward +1. */
      const sign = c.side === 0 ? -1 : 1;
      const men = c.roster?.living || [];
      let n = 0, z = 0;
      for (const t of men) {
        const b = t.body;
        if (!b || b.dead) continue;
        z += b.position.z; n++;
      }
      if (!n) continue;                       // an army that does not exist takes nothing
      if (!this.lineGathered(c)) continue;    // …and neither does one that is scattered
      const centroid = z / n;
      /* Is his line past the line he is moving? `front` is in field units, so
       * it is scaled to metres against the separation the meeting deploys at. */
      const frontZ = this.front * half;
      const ahead = sign < 0 ? centroid < frontZ : centroid > frontZ;
      if (ahead) push += sign;
    }

    /* Both pushing, or neither: the front holds. That is a contested front and
     * it is the state this mode should spend most of its time in. */
    if (push === 0) return;
    this.front = clamp(this.front + Math.sign(push) * FRONT_PUSH * dt, -1, 1);

    if (Math.abs(this.front) >= 1 && !this.done) {
      /* The front reached a baseline. The side that drove it there holds the
       * field, and `World._endMeeting` is the one door that ends a meeting —
       * the same one a wipe reaches, so a win and a wipe end the same way. */
      const winner = this.front > 0 ? 1 : 0;
      this.done = true;
      this.world?._endMeeting?.(winner);
    }
  }

  /**
   * IS THIS COMMANDER'S LINE GATHERED ON HIM? Half the living inside
   * `MORALE.NEAR`, and no mode gate on it at all.
   *
   * SPLIT OUT OF `lineIsUp`, AND THAT SPLIT IS A BUG FIX. `lineIsUp` opens
   * with `if (!this.lineAdvances) return true`, which is right for what it is
   * asked — whether the ground the CAMPAIGN is taking may be credited, a
   * question only The Line asks. `_front` was calling the same method for a
   * different question, and Command deliberately does not set `lineAdvances`
   * (`theline.mjs` asserts it does not, so that a rule written for one mode
   * cannot change a mode people have already played). So in every meeting
   * that has ever run, this returned true for both commanders and the
   * gathered clause was dead: a scattered army strung out down the field
   * pushed the front exactly as hard as a formed-up one, and the two pushes
   * cancelled. The front never moved and the mode could only end on a wipe.
   *
   * One quantity, one owner (HANDOFF 2.3): the quorum lives here, `lineIsUp`
   * is that quorum behind the campaign's gate, and `_front` asks for the
   * quorum because the quorum is what it means.
   */
  lineGathered(c = this.commander) {
    const p = c?.player;
    /* No body to measure from — a headless director, or a commander who has
     * fallen — cannot hold the ground open. `census`'s note argues the same
     * for orders: losing your general costs you your orders, not the battle. */
    if (!p || !p.position) return true;
    const living = (c?.roster?.living) || [];
    let alive = 0, near = 0;
    const r2 = MORALE.NEAR * MORALE.NEAR;
    /**
     * ── NEAR WHAT HE WAS TOLD TO BE NEAR, NOT NEAR YOU ──────────────────
     *
     * This measured every living man against `c.player.position`, full stop.
     * That is the right rule for an army that forms up on its general and the
     * WRONG one the moment a general can put a squad somewhere: a squad
     * ordered to hold a gate two hundred metres away was, by this test,
     * scattered — so a player who used delegation lost the quorum, could not
     * take ground, and was taught by the game not to delegate. PLAN.md §6 puts
     * the generalisation ahead of density for exactly this reason: "without
     * this the quorum breaks the moment density arrives".
     *
     * So the quorum is "half the living are where they were told to be". For
     * most men that is still the general's body, because that is where an
     * un-delegated squad forms. For a squad holding its own ground it is that
     * ground. The rule is unchanged in every run that never gives a squad an
     * order of its own, which is every run played before this line existed.
     *
     * `MORALE.NEAR` is the radius in both cases, deliberately: it is the same
     * claim from both sides, the distance presence steadies a man at and the
     * distance a man counts as being with his line at, and splitting it into
     * two numbers would be two answers to one question (HANDOFF §2.3).
     */
    const sp = c.squadPlanted;
    /**
     * ── AND A MAN ON A GUN IS NOT WITH HIS LINE ────────────────────────
     *
     * PLAN.md §4.2's welding clause, and the reason that section does not read
     * identically with `lineIsUp` deleted: "crewing a gun takes those men OUT
     * OF THE QUORUM… every objective you hold is ground you cannot advance
     * onto, because the men holding it are not standing with the line."
     *
     * He is still counted ALIVE — he is one of yours and losing him is losing
     * him — and he is not counted NEAR. So an objective is bought with exactly
     * the currency movement is bought with, and the decision every minute is
     * which of the two you need. A field with no objectives on it (every mode
     * but this one, and this one before a site is placed) has an empty set here
     * and the rule is the one it always was.
     */
    const crew = this.world?.objectives?.crewIds?.();
    let manned = 0, down = 0;
    for (const t of living) {
      const e = t.body;
      if (!e || e.dead) continue;
      alive++;
      if (crew && crew.has(e.id)) { manned++; continue; }
      /**
       * …AND NEITHER IS A MAN ON THE GROUND — PLAN.md §4.9's second clause.
       *
       * "If a bleeding man still counted, dragging would be optional and the
       * bleed-out window would be decoration. He does not count — so the quorum
       * rule and the bleed-out window are in direct tension, and that tension
       * is the game: to advance you must physically recover your wounded, under
       * fire, while the thing that wounded them is still there."
       *
       * He is still ALIVE, exactly as a man on a gun is: losing him is losing
       * him, and the roster has not written him off. What he is not is standing.
       */
      /**
       * …UNLESS SOMEBODY IS STANDING OVER HIM — PLAN.md §4.6's Triage, and it
       * is one of the two facets that section requires to move the KEYSTONE.
       *
       * The rule above is what makes the bleed-out window cost something; this
       * card changes which way the tension pulls, so a player who takes it
       * spends men on holding casualties rather than on holding ground. The
       * medic is any living man of the same side inside `TRIAGE_REACH` — a
       * body, not a role, because this game has no medics and inventing one
       * would be a second system to make a card true.
       */
      if (e.downed) {
        down++;
        if (this.world?.player?.boonMods?.triage && this._overHim(e, living)) near++;
        continue;
      }
      const own = sp?.get(String(e.cmdSquad | 0));
      const at = own ? own.pos : p.position;
      if (dist2(e.position, at) <= r2) near++;
    }
    void manned; void down;
    /* An army that no longer exists cannot come up, and a run that waited for
     * it would hang instead of ending. `_checkLine` is the door for that. */
    if (!alive) return true;
    /**
     * HALF, UNLESS A FACET SAYS OTHERWISE — PLAN.md §4.6's Skirmish Order.
     *
     * The share is the keystone itself, so this is the one line in the game a
     * card is allowed to move: at a third the ground comes faster and the
     * muster that pays for the men who took it is halved (`_areaClear`). It is
     * read off the player rather than off a director flag because it is the
     * PLAYER's build, and a run with no player at all — a headless bench, a
     * client — reads the shipped half.
     */
    const share = clamp(this.world?.player?.boonMods?.quorumShare ?? 0.5, 0.2, 1);
    return near >= alive * share;
  }

  /**
   * IS SOMEBODY STANDING OVER THIS MAN? See the Triage clause in
   * `lineGathered`.
   *
   * Any living body on his own side inside `TRIAGE_REACH`, and never himself.
   * A downed man beside another downed man is two casualties, not a casualty
   * and a medic.
   */
  _overHim(e, living) {
    const r2 = TRIAGE_REACH * TRIAGE_REACH;
    for (const t of living) {
      const o = t.body;
      if (!o || o === e || o.dead || o.downed) continue;
      if (dist2(o.position, e.position) <= r2) return true;
    }
    return false;
  }

  lineIsUp(c = this.commander) {
    if (!this.lineAdvances) return true;
    return this.lineGathered(c);
  }

  /**
   * The ground is won and the line is not on it yet. Said once, and then the
   * frame keeps asking — see `update`.
   */
  _awaitLine() {
    if (this.awaitingLine) return;
    this.awaitingLine = true;
    this.world?.notify?.('THE LINE IS COMING UP',
      'the ground is not yours until your men are standing on it');
  }

  /**
   * REPLACEMENTS, WITHOUT A SCREEN — what a contingent has instead of a muster.
   *
   * Three properties, and the third is the one that keeps the feature honest:
   *
   *   THE PURSE IS PAID BY THE WAVE, at `CONTINGENT_WAVE_MUSTER` a clear, so
   *     the cadence is derived from the price of a body rather than typed.
   *   THE REPLACEMENTS ARE NAMELESS STRANGERS, because `roster.enlist` is the
   *     same call the opening muster makes: the man who died is still gone, and
   *     the record with his kills on it is still on the fallen list. That is
   *     Command's whole subject and a contingent does not get to opt out of it.
   *   IT NEVER GROWS. `this.opening` is a ceiling and not a target — a player
   *     who asked for four men has four men for the whole run, and the only
   *     thing the purse can buy is the ground back.
   *
   * Every army on the field, not only the player's, for the reason the morale
   * loop above gives: a second commander with a contingent is a commander with
   * a contingent.
   */
  _reinforce() {
    let any = false;
    for (const c of this.commanders) {
      /**
       * WHAT IS MISSING FROM THE LINE, BY TYPE — not how many bodies short it
       * is.
       *
       * This used to be `c.roster.strength < this.opening` and a `recruit` of
       * the cheapest rung, which was the same statement as long as every
       * contingent was ten identical clone troopers. The moment the player can
       * compose one it stops being: a line of four ARC troopers that loses one
       * would have been refilled with a clone trooper — and then, over a long
       * run, refilled again and again until four ARCs had become eight troopers
       * with nothing anywhere reporting the drift. The opening muster records
       * what it bought (`c.lineup`) and a replacement is measured against that
       * roll, so a fallen ARC is replaced by an ARC at an ARC's price or not at
       * all.
       *
       * A multiset difference and not a per-slot one: the roster is a bag of
       * records, the man who died is gone for good and the record with his
       * kills on it stays on the fallen list, so what a replacement restores is
       * the SHAPE and never the man.
       */
      const short = new Map();
      for (const type of (c.lineup || [])) short.set(type, (short.get(type) || 0) + 1);
      for (const t of c.roster.living) {
        const n = short.get(t.type);
        if (n) short.set(t.type, n - 1);
      }
      /* THE CHEAPEST HOLE FIRST, so a line missing a trooper and an ARC gets
       * the trooper back first: a body on the field beats a better body in
       * eleven waves' time, and the purse below is paid against whatever is
       * being waited for. */
      const wanted = [...short.entries()].filter(([, n]) => n > 0)
        .map(([type]) => type).sort((a, b) => musterCost(a) - musterCost(b));
      /* PAID ONLY WHILE THE LINE IS SHORT, and that is not a saving. A purse
       * that accrues through a full roster is a purse that buys the NEXT
       * casualty back on the frame it happens — measured, sixty clears at full
       * strength banked thirty points and two men lost were replaced before
       * either body hit the ground, which is the opposite of "they permanently
       * die unless they are replaced". You are paid for the replacements you
       * need, when you need them.
       *
       * AND AT THE PRICE OF THE BODY YOU ARE WAITING FOR. The rate is stated as
       * a number of cleared WAVES (`CONTINGENT_WAVES_PER_BODY`) and turned into
       * points by dividing that body's own `musterCost`, so a clone trooper is
       * still two clears and an ARC is five — the same cadence per point of
       * army, applied to whatever the player chose to field. A flat
       * cheapest-rung accrual would have made a composed line cheaper to
       * rebuild than it was to raise. */
      if (wanted.length) {
        c.roster.points += musterCost(wanted[0]) / CONTINGENT_WAVES_PER_BODY;
      }
      /**
       * ── AND THE FOUNDRY MAKES ONE OF THEM HEAVY — PLAN.md §4.2.
       *
       * "Held: your replacements come up heavy. Lost: theirs do."
       *
       * ONE OF THEM, not all of them, and the cheapest hole is the one that is
       * upgraded — which is the same argument the ordering above makes. A
       * foundry that turned every replacement into an ARC would make the
       * objective a difficulty switch; one that sends up a better man than the
       * one you were owed, once a muster, is a reason to hold a building.
       *
       * The upgrade is one rung along this army's OWN ladder, so it is priced
       * by `musterCost` like everything else and neither army gets a body the
       * other cannot answer. A hole already at the top of the ladder is left
       * alone: there is nothing above an ARC to send.
       */
      if (wanted.length && this.world?.objectives?.heavyReplacements?.(c.side ?? 0)) {
        const tiers = (ARMIES[c.army]?.tiers || []).map((r) => r.type);
        const i = tiers.indexOf(wanted[0]);
        const up = i >= 0 && i + 1 < tiers.length ? tiers[i + 1] : null;
        if (up && (short.get(wanted[0]) || 0) > 0) {
          short.set(wanted[0], short.get(wanted[0]) - 1);
          short.set(up, (short.get(up) || 0) + 1);
          c.roster.points += musterCost(up) - musterCost(wanted[0]);
          wanted.unshift(up);
          this.log.push({ t: 'foundry', from: tiers[i], to: up, area: this.areaNumber, wave: this.wave });
          if (c === this.commander) {
            /* `.label` AND NOT `.name`, which is the same defect `killerName`
             * carried: an archetype has no `name`, so this banner had always
             * fallen through to the spawn table's internal key and told the
             * player who had just held a building that "the next one up is a
             * arc". Every other read of this table in the tree asks for
             * `.threat` or `.label`; this was the one `.name` in `src/`. */
            this.world?.notify?.('THE FOUNDRY', `the next one up is a ${ARCHETYPES[up]?.label || up}`);
          }
        }
      }
      /* `recruit` is the one door — it prices, it enlists, it publishes, and it
       * refuses a roster already at `MAX_STRENGTH`. The extra ceiling here is
       * the player's own line, which is smaller. */
      for (const type of wanted) {
        while ((short.get(type) || 0) > 0 && this.recruit(type, c)) {
          short.set(type, short.get(type) - 1);
          any = true;
        }
      }
    }
    /* …AND THEY COME IN ON A SHIP. `deploy`'s note says `byShip` is for the
     * moment an army ARRIVES, and a replacement walking out of a gunship in the
     * middle of a run is exactly that moment — it is the one thing the player
     * sees of this whole method. */
    if (any || this.roster.living.some((t) => (!t.body || t.body.dead) && !this._inbound.has(t))) {
      for (const c of this.commanders) this.deploy(c, { byShip: true });
    }
  }

  /**
   * AN AREA IS BEHIND YOU.
   *
   * The muster opens, the survivors are credited, and — the part that is the
   * point of the whole mode — the roster is carried forward with every name on
   * it, living and dead.
   */
  _areaClear() {
    if (this.done) return;
    this.awaitingLine = false;
    for (const t of this.roster.living) {
      t.areas++;
      const p = t.award(XP_PER_AREA);
      if (p) this._promoteTrooper(t, t.body);
    }
    // Holding a whole area is the biggest thing that happens to a line's nerve.
    for (const c of this.commanders) this.shake(null, 'AREA_HELD', c);
    /* THE PURSE, SCALED BY WHATEVER RULE THE RUN IS UNDER — PLAN.md §4.6.
     * Skirmish Order is the only thing that moves it: taking ground with a
     * third of your men costs you half the men you are paid for taking it
     * with, which is what makes that card a decision rather than a discount. */
    this.roster.points += this.area.muster * (this.world?.player?.boonMods?.musterShare ?? 1);
    /* HOLDING GROUND IS WHAT EARNS A FLEET'S ATTENTION. The largest single
     * credit on the table — see SUPPORT_EARN. */
    this.world?.support?.credit('area');
    this.log.push({ t: 'area', area: this.areaNumber, name: this.area.name,
                    strength: this.roster.strength, fallen: this.roster.fallen.length });

    if (this.lastArea) { this._endCampaign(); return; }

    this.areaIndex++;
    this.areaWaves = 0;
    this.mustering = true;
    /**
     * THE DEAD COME OFF THE ROLL AND THE LIVING STAY ON THE GROUND.
     *
     * `keepStanding` is the player's note about the transports, answered in
     * `recall` where the withdrawal happens. What is still withdrawn here is
     * everything with no body under it — a man killed in the last wave, and a
     * man still in a gunship that is not going to finish its flight — so
     * `deploy` at the bottom of `closeMuster` puts down the replacements and
     * only the replacements.
     */
    this.recall(null, { keepStanding: true });
    /**
     * …AND THE GROUND EVERY SQUAD WAS HOLDING IS GIVEN BACK.
     *
     * This is the other half of keeping the bodies, and it did not exist
     * before because there were no bodies to keep. A squad told to hold a
     * ridge is planted on that ridge (`squadPlanted`), the front then MOVES —
     * `marchTo`, the mode's one-way visible variable — and a squad still
     * holding the ground the last engagement was fought on would sit out the
     * next one a hundred metres behind the line, under an order the player
     * gave about a piece of ground that is now behind them.
     *
     * The FORMATION is kept: "form line" is a statement about the shape the
     * company fights in and it survives an area. What does not survive is a
     * particular piece of dirt, and neither does a half-dug scrape on it.
     */
    for (const c of this.commanders) {
      c._planted = null;
      c.holding = false;
      c.squadOrders?.clear();
      c.squadPlanted?.clear();
      c.digs?.clear();
      c._pending = null;
    }
    /**
     * THE INTERLUDE, BUILT BEFORE THE OFFER IT RIDES ON.
     *
     * Everything it reports has already happened by this line: the xp and the
     * promotions above, the casualties during the fight, the points the ground
     * paid. It is read off `this.log` from the mark `closeMuster` left, so
     * there is no second ledger to disagree with the roll — see `_logAt`.
     *
     * `held` is the stage just taken, which is `areaIndex - 1` now that the
     * index has moved on. `got` is what that ground paid, off the same record
     * the credit above came from, rather than a difference of two purses:
     * `recruit` can also move `points`, and a muster that opened mid-purchase
     * would otherwise report the wrong number.
     */
    const held = this.stages[this.areaIndex - 1];
    this._interlude = interludeBeats(this.log, this._logAt, held, {
      got: held.muster, points: this.roster.points,
      strength: this.roster.strength, max: MAX_STRENGTH,
    });
    /* AND THE FORK, DEALT ONCE — before the offer, because the offer carries it.
     * `routeChoices` reads `stages` and `takeRoute` rewrites `stages`, so this
     * is the only moment at which the pair is the pair the player was first
     * shown. See `_fork`. */
    this._fork = this.routeChoices();
    const offer = this.musterOffer();
    this.world?.notify?.(`${this.stages[this.areaIndex - 1].name.toUpperCase()} — HELD`,
      `${this.roster.points} reinforcement points · ${this.roster.strength} standing`);
    /* …AND ON EVERY OTHER MACHINE IN THE SESSION. `onMuster` raises the card on
     * the machine holding the army; this raises it on the machines that are not,
     * which is where the whole defect was — a joining commander was told
     * `mustering: true` on the roster feed and given nothing to spend, so the
     * only muster that ever happened was somebody else's. */
    this.world?.publishMuster?.();
    if (this.onMuster) this.onMuster(offer);
    else {
      // No screen wired: muster for the player and press on, rather than
      // stopping a campaign on a UI that does not exist yet.
      this.autoMuster();
      this.closeMuster();
    }
  }

  /**
   * THE ADVANCE IS OVER — ONCE.
   *
   * This branch used to be three lines: notify, `mustering = false`, return. It
   * did not raise a flag, did not stop the director, and — the part that turned
   * a finished campaign into a broken one — DID NOT RESET `areaWaves`. `area` is
   * `AREAS[min(areaIndex, 4)]`, so on the last area `areaWaves` stayed at or
   * above `area.waves` forever and `payWave` re-entered `_areaClear` ON EVERY
   * SUBSEQUENT WAVE CLEAR, for as long as the player kept playing: another
   * "THE ADVANCE IS OVER", another +2 xp to every living body, another +30
   * reinforcement points — uncapped — and another entry on `this.log`, which is
   * an array nothing ever trims. A five-area campaign degenerated into an
   * endless roguelite that announced its own ending every ninety seconds.
   *
   * So the campaign ends the way a run ends, through the door the game already
   * has. `world.over` is the flag World reads to stop stepping the director
   * (World.js: `if (netMode !== 'client' && !this.over) this.director.update`),
   * and `onGameOver` is the one event that releases the pointer, shows the card
   * and writes the record. Setting `over` first is also what stops `_checkWipe`
   * firing a second one if the player is killed by the last bolt in the air:
   * that method returns immediately on `this.over`.
   *
   * `won: true` IS THE ONLY ONE IN THE TREE. `Progress.recordRun` has always had
   * `if (summary.won) p.wins++` and a `crowned` list beside it, and nothing
   * anywhere ever passed the field — both were structurally dead storage. They
   * are reachable now because this is the first mode with a WIN in it, which is
   * also why `RECORDED` in Progress.js had to learn the word `command`.
   *
   * THE STATS BLOCK WAS A TWIN OF `World._checkWipe`'s AND IT IS GONE.
   * World assembled the same six fields when the party died and this one
   * assembled them again; `tools/checks/command.mjs` kept the two key sets
   * identical because nothing else could. `World.runStats()` — asked for in
   * the handover at the foot of this file — exists now, and this calls it.
   */
  _endCampaign() {
    this.done = true;
    this.mustering = false;
    this.active = false;
    this.areaWaves = 0;
    const strength = this.roster.strength, all = this.roster.all.length;
    /**
     * THE VERDICT IS COMPUTED, NOT ASSERTED — see `holdTheLine`.
     *
     * In Command this is `true` and the line below is the sentence it always
     * was: the ground is the win, and reaching the far end of it wins. In THE
     * LINE the ridge is not the win — the men on it are — so a crossing
     * completed with nobody left is logged and scored as a loss, and the run
     * ends the same way it ends when the army is wiped mid-crossing.
     *
     * `strength > 0` and not a threshold. A rule that wanted six of ten home
     * would need a number nothing in the design states, and the design does
     * state this one: §1's job is "to be the reason the line is still standing
     * when it takes the ridge", and a line with a man in it is standing.
     */
    const won = !this.holdTheLine || strength > 0;
    /* WHY, and not only WHETHER. A crossing walked end to end and lost anyway
     * is a different sentence from a Jedi killed on wave three, and `main.js`
     * has exactly one field to tell them apart with — see `ended` there. */
    const ended = won ? null : 'line';
    this.log.push({ t: won ? 'won' : 'lost', area: this.areaNumber, strength,
                    fallen: this.roster.fallen.length,
                    ...(won ? {} : { why: 'the line did not survive the crossing' }) });
    // The survivors walk off the field. Every record is kept — the roster IS the
    // summary, and the fallen are most of what it is worth reading.
    this.recall();
    const w = this.world;
    if (!w) return true;
    /* THE SURVIVORS WALK OFF A CROSSING THEY WON — `World.sealManifest` says
     * why, and says it once. After `recall`, deliberately: recall takes the
     * bodies off the field and leaves every record standing, which is exactly
     * the list this seals. */
    w.sealManifest?.(won);
    /**
     * SAID BY THE ONE THING THAT SAYS HOW A RUN ENDED — and this is the half
     * that was missing rather than wrong.
     *
     * These two lines used to be a `notify` and an `audio.runWon(true)` right
     * here, and they were the ONLY announcement the advance had: the losing
     * half did not exist, because losing goes through `World._checkWipe` and
     * that method knew nothing about a campaign. Driven, a player who went down
     * leading the army in area 1 read "WAVE 1 · 8 contacts inbound" as the last
     * line of their run, with `audio.runWon` firing zero times.
     *
     * `World._announceBattle` is the sentence and the cue for all three bounded
     * plans in the game — the campaign, the skirmish and this — and both of
     * this one's verdicts now come out of it. Which is also what deletes the
     * level name that was typed into this line: it said "walked off Geonosis"
     * from a file that is holding the level, and World reads the ground off the
     * ground. Same words today; right words the day Command's ground moves.
     */
    w._announceBattle(won);
    w.over = true;
    /**
     * THROUGH `World.runStats()` — the third assembly of one object, deleted.
     *
     * This built the six numbers by hand beside `_checkWipe`'s and
     * `_endSkirmish`'s, and the note under it has asked for exactly this since
     * the mode was written; `tools/checks/command.mjs` has been holding the two
     * key sets identical because nothing else could. Two things fall out of
     * calling it rather than restating it: the drift is now impossible instead
     * of merely detected, and the campaign's own casualty count reaches the
     * card. `runStats` carries `fallen` and `taken`, and main.js's victory card
     * was inventing both — "Areas taken 5" was a LITERAL, and "Troops lost 0"
     * was printed on the mode that names its dead. `this.wave` is what
     * `runStats` reads off `world.director.wave`, which is this director.
     */
    w.onGameOver?.(w.runStats({ won, ended }));
    return true;
  }

  /**
   * THE RUN ENDS WHEN THE ARMY DOES — `MODES.theline.holdTheLine`.
   *
   * The only ending this director had was `_endCampaign`, reached by clearing
   * the last area, and the only other ending in the game is `World._checkWipe`,
   * which asks whether every PLAYER is down. Neither of them can see an army
   * that has ceased to exist. So in the mode whose entire subject is a roster,
   * losing the roster was not an event: the muster after it deployed nobody,
   * the next area opened with a Jedi alone against a composed wave, and the run
   * went on until the Jedi died or the ridge was taken.
   *
   * WHY IT IS GATED ON HAVING DEPLOYED. `strength` is zero before the first
   * gunship lifts — the roster is enlisted and the men are not on the field —
   * so an ungated test ends the run on frame one of every session. `_landed`
   * is raised by the first deployment rather than by a timer, because the
   * question this asks is "did an army that existed stop existing", and the
   * only honest witness to the first half of that is the deployment itself.
   *
   * NOT `_endCampaign`. That method is the end of a CROSSING and logs the area
   * it finished on, awards the muster, promotes the living and recalls the
   * survivors — every one of which is a lie about a run that ended because
   * there are no survivors. This is a second door, and it is the second door
   * on purpose: two endings that mean different things should not share one.
   */
  _checkLine() {
    if (!this.holdTheLine || this.done || !this._landed) return false;
    if (this.roster.strength > 0) return false;
    /* A muster is the one state where an empty field is correct: the army is
     * off the ground being paid for and re-deployed, and `closeMuster` is what
     * puts it back. Ending here would end every Raid at its first interlude. */
    if (this.mustering) return false;
    this.done = true;
    this.active = false;
    this.areaWaves = 0;
    this.log.push({ t: 'lost', area: this.areaNumber, strength: 0,
                    fallen: this.roster.fallen.length, why: 'the line was wiped out' });
    const w = this.world;
    if (!w) return true;
    w._announceBattle(false);
    w.over = true;
    w.onGameOver?.(w.runStats({ won: false, ended: 'line' }));
    return true;
  }

  /** The muster screen is done. Deploy the new roster and start the area. */
  closeMuster() {
    if (!this.mustering) return false;
    /* A commander who is not holding the army cannot start the next area
     * either — the same ask `recruit` and `order` make, through the same door.
     * Nothing is written here: `mustering` goes false when the host's next
     * `muster` message says the card is down, which is the only version of this
     * that cannot leave a client playing an area the host has not begun. */
    if (this._netShell) return this.world?.requestMuster?.(null, true) ?? false;
    this.mustering = false;
    /* A NEW ENGAGEMENT STARTS HERE, so the ledger's mark moves and the story
     * just told is forgotten. Both in one place because they are one fact:
     * everything after this line belongs to the next interlude. */
    this._logAt = this.log.length;
    this._interlude = null;
    /* The road is taken. Dropping it here rather than in `_areaClear` is what
     * makes `takeRoute` refuse outside a muster instead of quietly moving the
     * ground under a line that is already standing on it. */
    this._fork = null;
    /* THE GUNSHIPS, which is what the mode's first brief has always said
     * happens and what the code never did. See `deploy`.
     *
     * EVERY COMMANDER, not only mine: with one roster and four players the
     * next area opens with three quarters of the line still in the sky. This
     * is `deployAll` and not a second loop over `commanders`, and it is
     * identical for the one-commander campaign it was written for. */
    this.deployAll({ byShip: true });
    /* AND THE FRONT HAS MOVED. This is the one frame in a run where the ground
     * changes under a player who is standing on it, which is §1's fifth line
     * and the mode's one-way visible variable. See `marchTo`. */
    this.marchTo(this.areaNumber);
    /* The card comes down on every OTHER machine too, and this is the half a
     * client cannot do for itself: the host's player pressing Done is the only
     * thing that ends the muster, so a peer sitting on an open card would sit
     * there through the first wave of the next area. */
    this.world?.publishMuster?.();
    this.world?.notify?.(this.area.name.toUpperCase(), this.area.brief);
    this.intermission = 4.0;
    return true;
  }

  /**
   * THE FRONT MOVES ACROSS THE GROUND YOU ARE STANDING ON.
   *
   * `FLAGSHIP.md` §1's fifth line, and until this method existed the ground
   * did not know a campaign was happening on it. `Front.marchFront` was built,
   * measured and plated — the engagement plates go 20.5% / 28.8% / 45.2% of
   * pixels moved between 1↔3, 3↔5 and 1↔5 — and its own lane's report ended
   * "`marchFront` is still the debug path only — no mode calls it". This is the
   * mode calling it.
   *
   * ── ADDITIVE, AND CALLED FOR EVERY ENGAGEMENT IN ORDER ──────────────────
   *
   * `marchFront`'s contract says so in its own header: "calling this for 1, 2,
   * 3… in order is what a session does; calling it once for 4 would give
   * ground that has the fourth engagement's front on it and none of the first
   * three's history". So this is called once per engagement and never
   * catches up — `_marched` is the high-water mark, and a client that receives
   * an area change it did not compute walks the same ladder rather than
   * jumping to the end of it.
   *
   * ── WHY THE HOST ONLY, AND WHY IT IS STILL RIGHT ON A CLIENT ────────────
   *
   * The dressing is a pure function of the seed and the engagement number.
   * Both ends compute the same ground from the same two numbers without a byte
   * crossing the wire — which is the same argument `CraterLog` makes for
   * replaying a log rather than shipping a heightfield, and the reason a front
   * is affordable in co-op at all.
   *
   * ── AND THE LEVEL OWNS ITS OWN AIR ─────────────────────────────────────
   *
   * `world.smokeAir` is published by the level beside its own
   * `addSmokeColumns` call, so the columns this raises dissolve into the same
   * fog the level's do. A second copy of those five numbers here is HANDOFF
   * §2.3 with a rendering change behind it.
   */
  marchTo(n) {
    const w = this.world;
    if (!w?.terrain || w.frontOff) return 0;
    const want = Math.max(1, n | 0);
    if ((this._marched | 0) >= want) return 0;
    let did = 0;
    for (let e = (this._marched | 0) + 1; e <= want; e++) {
      try {
        const out = marchFront(w, {
          engagement: e,
          /**
           * THE HULLS — the one mark of the five the mode never laid, and then
           * laid on exactly one ground.
           *
           * `Front.marchFront` grows wreck clusters only when it is handed the
           * function that builds them, and this caller never passed it: the
           * barrage, the burn, the smoke and the fallen all landed and the
           * hulls did not. §12.4 names them specifically — "wrecks belong on
           * the fighting line" — and prices them as the biggest line item on
           * Geonosis at 112 of 225 draw calls, so they are the mark that
           * carries the picture rather than a garnish.
           *
           * IT WAS THEN PASSED AND WAS STILL NULL ON SIX GROUNDS OF SEVEN.
           * `world.strewWrecks` was published by Geonosis' own `dress` and by
           * nothing else, and THE LINE rolls its theatre off the run seed — so
           * "the mode lays hulls now" was a sentence about one seventh of the
           * mode's rolls. `Levels.beginDressing` publishes it for every ground
           * now, the same door the water hazard is attached through and for the
           * same reason; that note carries the per-level draw-call price.
           *
           * READ OFF THE WORLD, and that is not laziness — it is the only
           * direction that does not close a cycle. `Front.js` is a leaf and
           * cannot import `Levels.js`; and THIS file cannot either, because
           * `Levels.js` imports `COMMAND_UNITS` from here. A static import in
           * either direction is the initialisation cycle that threw
           * `Cannot access 'COMMAND_UNITS' before initialization` for every
           * entry point reaching Command.js first, earlier in this same
           * session.
           */
          strewWrecks: w.strewWrecks ?? null,
          /* The DEPLOYMENT seed, not the wave's: one ground, one sitting, one
           * seed — §5. `runSeed` is what the deploy card printed. */
          seed: w.runSeed ?? w.settings?.seed ?? 1,
          log: w.craterLog ?? null,
          air: w.smokeAir ?? null,
        });
        did += (out?.barrage | 0) + (out?.smoke | 0) + (out?.wrecks | 0);
        /* WHAT THE LAST MARCH ACTUALLY LAID, published on the director.
         *
         * `marchFailures` and `marchErrors` are already here because "a console
         * line is not something a check can assert on"; the same argument
         * applies to a march that SUCCEEDED and laid nothing. A front that came
         * up with no smoke on it is not an error and throws nothing, and the
         * only symptom is a mesh count in a browser probe that can say "there
         * is one column" and nothing about which half of the picture is
         * missing. This is the counts, per engagement, in the order they were
         * marched. */
        (this.marched ||= []).push({ e, ...out });
      } catch (err) {
        /* A DRESSING THAT THREW MUST NOT TAKE THE ENGAGEMENT WITH IT. This runs
         * on the frame a muster closes and the next area opens; a level with no
         * terrain features to site a wreck on is a worse picture, not a broken
         * run.
         *
         * ── ONCE PER PROCESS WAS TOO QUIET, AND IT COST A WHOLE FRONT ──────
         *
         * This used to warn behind a static `_warnedMarch` flag: the FIRST
         * failure in the process printed and every one after it was silent.
         * Measured on `runrules.mjs`, whose rule-drive builds a real
         * `CommandDirector` on a hand-made world with no `statics` list: nine
         * modes × every rule, each losing its front on every engagement, and
         * the whole of it was one line about `push` from inside `Smoke.js`. A
         * guard that logs once and continues is how a mode silently loses its
         * front — which is the thing this system exists to make visible.
         *
         * So: one line per ENGAGEMENT, and a count on the director, because a
         * console line is not something a check can assert on and this is the
         * one failure in the mode with no other symptom. `marchFront` names the
         * missing field at its own door now, so the line says what to fix. */
        this.marchFailures = (this.marchFailures | 0) + 1;
        (this.marchErrors ||= []).push(`engagement ${e}: ${err.message}`);
        console.error(`marchFront failed for engagement ${e}: ${err.message}`);
      }
      /* ADVANCED EVEN ON A FAILURE, deliberately: `_marched` is a high-water
       * mark and not a success count, so a ground that cannot be dressed does
       * not re-throw once a frame for the rest of the run. `marchFailures` is
       * what says it happened. */
      this._marched = e;
    }
    return did;
  }

  /**
   * WHAT THE CAMPAIGN LOOKS LIKE FROM OUTSIDE — the HUD's readout and the run
   * summary's, derived so the two cannot disagree.
   */
  readout(cmdr = null) {
    /**
     * A SHELL SAYS WHAT IT WAS TOLD, VERBATIM, AND INVENTS NOTHING.
     *
     * The received object IS a `readout()` — the host's own, off the same
     * method — so there is exactly one authority for what a campaign looks
     * like from outside and no second assembly of the same fields to drift
     * from it. `null` until the first message arrives, which falls through to
     * the honest local answer: an empty roster in area 1.
     *
     * See `netShell` and `applyNet` below for why a client holds nothing.
     */
    if (this._netShell && this._netReadout) return this._netReadout;
    /* A named commander, or mine. Two armies on one field are two readouts,
     * and the host sends each machine the one describing ITS army — see
     * World._armyTick. */
    const c = cmdr || this.commander;
    const F = FORMATIONS[c.formation] || FORMATIONS[DEFAULT_FORMATION];
    return {
      /**
       * THE ROLL FIRST, AND THE MODE'S OWN FIELDS OVER THE TOP OF IT.
       *
       * It used to be the other way round, and `roster.summary()` carries an
       * `army` of its own — so `army: this.army.name` was written and then
       * silently overwritten by `this.army.id`. The object promised
       * "The Republic" beside a `foe` of "The Confederacy" and delivered
       * "republic" beside "The Confederacy", which is the kind of defect that
       * survives review because both halves look right on their own line. The
       * Command HUD hit it and worked around it by looking the id back up in
       * `ARMIES`; that workaround should not have had to exist.
       *
       * `roster.summary().army` stays the ID. That is right for what it is —
       * a record the roster panel keys on, and HUD.js already indexes `ARMIES`
       * with it — so the two objects say different things on purpose and both
       * of them now say what their field names claim. `armyId` is here so a
       * caller that wants the key off THIS object does not have to reach for
       * the other one.
       */
      ...c.roster.summary(),
      army: c.army.name,
      armyId: c.army.id,
      foe: c.foe.name,
      foeId: c.foe.id,
      area: this.areaNumber,
      areas: this.stages.length,
      areaName: this.area.name,
      waveInArea: this.areaWaves,
      areaWaves: this.area.waves,
      formation: F.id,
      formationName: F.name,
      /* HOLD is a state of the ARMY and not of the order, so it rides here
       * beside the formation rather than being inferred from `_planted` —
       * which a joining commander cannot see. */
      holding: !!c.holding,
      /* The formation indicator prints this beside the name, and main.js used
       * to fetch it separately off `roster.squads().length` — which is a second
       * caller deriving a number this object already had everything for, and it
       * is unanswerable on a machine whose roster is a wire record rather than a
       * list of Troopers. Derived here, once, from the same roll. */
      /* THE LIVE ONES. `squadsOf` is indexed by squad number now, so its
       * length counts SLOTS — including the ones that have been wiped out. */
      squads: this.liveSquads(c).length,
      /**
       * THE COMMANDER'S OWN FORCE, in the same object as everything else the
       * outside is allowed to know — plain data, no functions and no live
       * Commander, because this object crosses the wire verbatim (see
       * `netShell`/`applyNet`) and a joining commander's wheel has to be able
       * to grey a slot the host says is not ready.
       *
       * DERIVED FROM `castReady`, which is the same rule `castForce` refuses
       * on. A HUD that decided for itself what "ready" means is precisely the
       * defect the note over `Powers.js` records — the wheel greyed a power
       * the player could afford and lit one they could not — and the fix there
       * was the one taken here: one authority, two readers.
       */
      force: Object.values(COMMAND_FORCE).map((P) => ({
        id: P.id,
        name: P.name,
        ready: this.castReady(P.id, c) === null,
        cd: Math.round(((c._castCd && c._castCd[P.id]) || 0) * 10) / 10,
      })),
      mustering: this.mustering,
      /** The advance is behind you. The HUD's cue that this is a finished run. */
      done: this.done,
      teamDamage: this.teamDamage,
    };
  }

  /* ── the joining player's copy ─────────────────────────────────────── */

  /**
   * THIS DIRECTOR IS NOT HOLDING THE ARMY — SO IT STOPS PRETENDING TO.
   *
   * `World.loadLevel` builds a `CommandDirector` off the mode string alone, on
   * every machine in the session, and the constructor's last line is
   * `_musterOpening()`. So a joining player's director enlisted TEN TROOPERS OF
   * ITS OWN — ten designations off its own stream, ten records, thirty
   * reinforcement points — and then never deployed one of them, because
   * `main.js` only calls `director.start` when `netMode !== 'client'`.
   *
   * Measured on two real Worlds in Command mode: the host's opening ten were
   * `CT-1500 CT-2794 CT-5111 …` and the joining player's were
   * `CT-4213 CT-2321 CT-9050 …`. Two disjoint armies, one of which does not
   * exist. The roster panel down the side of that player's screen was ten
   * strangers who could never take a casualty, while the ten real names dying
   * three metres in front of them were never named anywhere.
   *
   * A shell holds NOTHING it was not told. The roster is emptied rather than
   * left half-true, because a stale name is worse than a blank panel: the panel
   * fills the moment the first `army` message lands, and until then the honest
   * answer is that this machine does not yet know who is on the field.
   *
   * The same shape as `World._netDirector`, which does this to `remaining` for
   * the base director and for the same reason — and it is called from there.
   */
  netShell() {
    this._netShell = true;
    this._netReadout = null;
    /** The host's muster offer, or null for "no muster is open". See below. */
    this._netOffer = null;
    for (const c of this.commanders) {
      c.roster.all.length = 0;
      c.roster.taken.clear();
      c.roster.points = 0;
    }
    return true;
  }

  /**
   * THE HOST'S CAMPAIGN, AS THIS MACHINE NOW KNOWS IT.
   *
   * @param r the host's `readout()`, verbatim off the wire. See World's `army`
   *          message: the object is sent whole rather than as a diff, because a
   *          roster is a hundred-odd small fields that change together and a
   *          diff of it is a second encoder that can disagree with its decoder.
   *
   * The scalars are mirrored onto the instance as well as kept whole, because
   * `area`, `areaNumber` and `lastArea` are GETTERS over `areaIndex` and there
   * are readers of all three (main.js's level line, the HUD). Everything the
   * roll carries is left in the received object alone — nothing here rebuilds a
   * `Trooper`, and that is deliberate: a reconstruction would be a second
   * implementation of the promotion ladder and the naming rules, which is the
   * hand-maintained-twin defect this codebase has paid for eight times.
   */
  applyNet(r) {
    if (!r || typeof r !== 'object') return false;
    this._netShell = true;
    const was = this._netReadout?.formation;
    this._netReadout = r;
    this.areaIndex = clamp((r.area | 0) - 1, 0, this.stages.length - 1);
    this.areaWaves = r.waveInArea | 0;
    if (FORMATIONS[r.formation]) this.formation = r.formation;
    if (r.holding !== undefined) this.commander.holding = !!r.holding;
    this.mustering = !!r.mustering;
    this.done = !!r.done;
    this.roster.points = r.points | 0;
    this.onRoster?.(r);
    // Only on a change: `onOrder` is an ANNOUNCEMENT, and one that fired twice
    // a second would be an indicator flashing for a formation nobody ordered.
    if (r.formation !== was) this.onOrder?.(FORMATIONS[r.formation] || FORMATIONS[DEFAULT_FORMATION], r.squads | 0);
    return true;
  }

  /**
   * THE HOST'S MUSTER, AS THIS MACHINE NOW KNOWS IT — and the reason a client
   * can spend its own reinforcement points at all.
   *
   * `applyNet` already carried `mustering` and `points`, so a joining commander
   * knew perfectly well that a muster was open and how much was in the purse,
   * and had no shelf to spend it on and no way to say what it wanted. The
   * screen was raised on the host alone, so either the host's player chose that
   * army's reinforcements for both of them or — with no screen wired at all —
   * `autoMuster` did. Neither of those is the player deciding.
   *
   * @param o the host's `musterOffer()` for THIS machine's commander, verbatim
   *          off the wire, or null when the muster has closed. Verbatim for the
   *          reason `applyNet` takes a whole `readout()`: the offer is the
   *          points, the shelf, what each rung costs, how many you already
   *          field and whether you can afford one — all derived from a roster
   *          this machine does not hold, and every one of them wrong if it
   *          reassembled them.
   *
   * @param no the host's reason for refusing the last purchase, or nothing.
   *           `recruit` guards five cases and puts the sentence on `refused`,
   *           which is what the screen prints — and every one of those guards
   *           runs on the machine holding the purse, so on a client the field
   *           can only be filled from here. It rides the same message as the
   *           fresh offer because they are one answer to one ask: this is what
   *           you may not have, and this is what you still can.
   *
   * `mustering` is written from the message rather than left to the roster feed
   * because the two arrive at different times and the card must not be able to
   * be up while the flag says no muster is open. `_areaClear` publishes before
   * it raises its own card, so this lands first on every other machine.
   */
  applyMusterNet(o, no = null) {
    this._netShell = true;
    const had = this._netOffer;
    this._netOffer = o || null;
    this.mustering = !!o;
    this.refused = no || null;
    if (o) this.onMuster?.(o);
    /* Only on a transition, for the reason `applyNet` fires `onOrder` only on a
     * change: a close is an ANNOUNCEMENT, and one raised every time the host
     * mentions that no muster is open would tear down a card nobody opened. */
    else if (had) this.onMusterClose?.();
    return true;
  }
}

/** How far off its slot a trooper may drift before the steer takes over. */
export const FORM_TOLERANCE = 2.2;

/**
 * HOW LONG A MAN TAKES TO ACT ON AN ORDER HE HAS JUST BEEN GIVEN.
 *
 * Reflex's one consumer, and the reason it is worth having on a roster. An
 * order used to be instantaneous: the player pressed a key and twenty-four
 * bodies pivoted on the same frame, which is a spreadsheet moving and not an
 * army. Now the sharp men go first and the slow ones are still in the old shape
 * for the better part of a second — so a line changing formation under fire has
 * a MOMENT in it, and who you put on the flank matters.
 *
 * Scaled by `reflex`, which is the one other attribute whose `lo` is above its
 * `hi`: 1.21 s at nothing, 0.63 s at a hundred. Under a second at every point
 * on the scale, because this is a lag the player should FEEL and never wait on.
 */
export const ORDER_LAG = 0.9;

/**
 * …AND HOW OFTEN A BADLY DISCIPLINED MAN FIRES ANYWAY.
 *
 * Discipline's second consumer. HOLD FIRE is an order, and an order a man
 * cannot break is not discipline — it is a switch on a machine. So a soldier
 * below the middle looses a burst on his own now and then, `BREAK_FOR` seconds
 * of it, and a squad of poor men told to hold gives the position away.
 *
 * Rolled per body per second rather than per frame, so the rate is the rate
 * whatever the frame time is. At zero Discipline that is a break about every
 * three seconds; at the middle it is nothing at all, and above it, less.
 */
export const HOLD_BREAK = 0.34;
export const BREAK_FOR = 0.8;

/*
 * ── HANDOVER: what this mode needs from files it does not own ───────────
 *
 * Written here rather than in a report that will be lost, because every one of
 * these is a real absence and each one is small.
 *
 * src/game/Bodies.js
 *   · A JETPACK. `jet` is a trooper with `float: 1.35` and no hardware — it
 *     hovers, but nothing on the model says why. `buildTrooper` wants an
 *     `opts.pack` that bolts a two-nozzle pack to the `chest` bone; the four
 *     reference plates in assets/reference/units/clones show it sitting between
 *     the shoulder bells with the nozzles below the belt line.
 *   · A VIBROSWORD for `bx`. It is `melee: true, saber: true` today, which puts
 *     a glowing blade in a commando droid's hand. `buildB1` wants an
 *     `opts.blade: 'vibro'` that swaps the emissive blade for a dull metal one.
 *   · A KAMA and PAULDRON for `arc` and `officer`. Both are `buildTrooper` with
 *     an accent, so at range they read as rank and at three metres they read as
 *     the same body. `attachSkirt` already exists in Cloth.js and is what a kama
 *     is; the pauldron is one plate on `clavL`.
 *   · A PALETTE HANDLE. `repaint()` above needs the builder's accent material to
 *     be reachable from the Enemy — `buildTrooper` already returns it in
 *     `palette.accent` and `buildB1` in `palette.mark`. If Enemy stops keeping
 *     the palette, promotion stops being visible and nothing will say so.
 *
 * src/game/World.js
 *   · `runStats()` — LANDED, and `_endCampaign` calls it. What is still owed
 *     there is the two fields main.js's victory card reads: `fallen` (this
 *     file logs `roster.fallen.length` one line above its own summary) and
 *     `taken`. The card printed "Areas taken 5" — a literal — and "Troops lost
 *     0" until they arrive. The patch is in the lane report; the card omits a
 *     row it has no number for rather than inventing one.
 *   · A VICTORY that is not a death. `_endCampaign` fires `onGameOver` with
 *     `won: true` on it, because that is the one event in the tree that stops
 *     the director, releases the pointer, shows a card and writes the record.
 *     Everything about that is right except the card's title.
 *
 * src/ui/HUD.js
 *   · THE ROSTER. `CommandDirector.readout()` is the whole feed: army, area,
 *     formation, and a `roll` of `{name, unit, rank, rankTitle, xp, kills,
 *     areas, alive, diedIn}`. It wants a column down one edge with the living
 *     above the fallen, the rank colour as a chip (RANKS[i].color), and the
 *     dead struck through — the casualty list is the point.
 *   · A FORMATION INDICATOR. `readout().formationName`, and the ids are in
 *     `FORMATIONS`. NOTE THE UNITS: `FORMATIONS[*].leash` is a MULTIPLE of the
 *     body's own reach now, not metres — printing it raw gives "1.2". The metres
 *     for a given body are `director.leashFor(F, body)`.
 *   · `readout()` also carries `done`, raised the moment the advance is over.
 *   · Hook: `world.director.onRoster = (summary) => hud.setRoster(summary)`.
 *
 * src/ui/Menu.js
 *   · A MODE CARD for `command`, off `MODES.command` — it already carries
 *     `fixedTheatre`, so the Theatre column will grey itself out with the
 *     mode's own sentence beside it (menu.mjs drives exactly this).
 *   · A TEAM DAMAGE slider writing `settings.teamDamage`, 0..1, default 0.35.
 *     `commandConfig` is the reader and is the only thing allowed to interpret
 *     it.
 *   · A MEETING SWITCH writing `settings.commandVersus`, a boolean, default
 *     false — the whole of "two sides command two different armies and meet".
 *     `commandConfig` reads it and is the only thing allowed to interpret it,
 *     exactly as it is for the two above. It belongs beside the session code
 *     rather than in the mode list: a meeting needs two people, and a host who
 *     turns it on alone should be told so rather than deployed onto an empty
 *     plain. `World.beginVersus` is what the button ultimately reaches, and it
 *     is idempotent — the second commander is given an army the moment their
 *     body arrives.
 *
 * src/ui/Screens.js
 *   · A VICTORY CARD. `readout().done` is raised the moment the last area is
 *     behind you, and the stats object `onGameOver` hands over carries
 *     `won: true`. `Menu.showDeath(stats, title)` already takes a title —
 *     "THE ADVANCE IS OVER" over the roster is the whole card.
 *   · `musterOffer().next` no longer carries a `tier` field, because AREAS no
 *     longer has one: a rung's `at` IS the area number now. Nothing in src/ read
 *     it, but a screen written against the old shape would find it undefined.
 *   · THE MUSTER. `director.onMuster = (offer) => screens.muster(offer)`, and
 *     the screen calls `director.recruit(type)` per purchase and
 *     `director.closeMuster()` when done. `musterOffer()` is already the exact
 *     shape a screen wants — units with cost, threat, how many you have and
 *     whether you can afford one. Until it exists the director musters for the
 *     player automatically, so nothing is blocked.
 *
 * src/engine/Bindings.js
 *   · THE ORDER KEYS — LANDED, and this entry is kept because the shape of
 *     the fix is the reusable part. `FORMATIONS[*].key` names the code each
 *     order wants (Digit6-Digit0, Minus, Equal); they were read as raw key
 *     codes in main.js, so they were not rebindable, on no controls card and
 *     invisible to `findConflicts`. The fix is NOT a row per order in
 *     `ACTIONS` — that is HANDOFF §2.3, a hand table beside its generated
 *     twin — it is `registerOrders(FORMATIONS)`, called once from ui/Menu.js,
 *     which is the module allowed to see both halves. A formation authored
 *     here is bound, listed, printed and conflict-checked the day it lands.
 */
