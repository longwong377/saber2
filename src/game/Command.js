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

import * as THREE from 'three';
import { ARCHETYPES, applyModifier, DREAD, FORCE_KINDS } from './Enemy.js';
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

/**
 * The stream every roll in this mode comes off.
 *
 * Its own, seeded by `CommandDirector` from the run's number exactly as
 * `seedWaves`, `enemyRng`, `duelRng` and `seedArrivals` are — five streams, one
 * number, so a Geonosis campaign is a shareable seed and the same seed musters
 * the same twelve men with the same twelve names.
 */
const rng = makeRng(0x5EED0C7);
export function seedCommand(seed) {
  const s = (Math.imul((seed | 0) ^ 0x2545F491, 0x9E3779B1) >>> 0) || 1;
  rng.seed(s);
  return s;
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
    /* A Jedi leads clones. The order IS the faction — see `sideForOrder`. */
    order: 'jedi',
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
    order: 'sith',
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
 * Which army a player of this order leads.
 *
 * DERIVED FROM `Order.js`, not asked as a second question. The player already
 * chooses Jedi / Sith / Grey in the forge, that choice already costs them
 * something real, and asking again on the deploy screen would let them be a
 * Jedi at the head of a droid army — which is not a build, it is a bug wearing
 * a menu. A Grey has no army of their own and is given the Republic's, because
 * somebody has to be at the head of the column; the mode says so on the card.
 */
export function sideForOrder(orderId) {
  const found = ARMY_IDS.find((k) => ARMIES[k].order === orderId);
  return ARMIES[found || 'republic'];
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
 * `hp`/`dmg`/`speed` are multipliers on the archetype, applied at spawn. They
 * compound with the rank BELOW them (a captain is not "a trooper × 1.30", it is
 * every rung multiplied), which is why the top rung is worth roughly twice the
 * bottom one and not five times it.
 */
export const RANKS = [
  { title: 'Trooper',    short: 'TRP', xp: 0,  color: null,     hp: 1.00, dmg: 1.00, speed: 1.00 },
  { title: 'Veteran',    short: 'VET', xp: 4,  color: 0xb4382c, hp: 1.14, dmg: 1.06, speed: 1.02 },
  { title: 'Sergeant',   short: 'SGT', xp: 10, color: 0x2f6fbe, hp: 1.30, dmg: 1.13, speed: 1.04 },
  { title: 'Captain',    short: 'CPT', xp: 20, color: 0x3f8f4a, hp: 1.50, dmg: 1.22, speed: 1.07 },
  { title: 'Commander',  short: 'CMD', xp: 36, color: 0xe8b028, hp: 1.78, dmg: 1.34, speed: 1.10 },
];

/** The rank index this much experience has earned. */
export function rankFor(xp) {
  let r = 0;
  for (let i = 0; i < RANKS.length; i++) if ((xp | 0) >= RANKS[i].xp) r = i;
  return r;
}

/** XP still owed before the next promotion, or null at the top of the ladder. */
export function toNextRank(xp) {
  const r = rankFor(xp);
  return r >= RANKS.length - 1 ? null : RANKS[r + 1].xp - (xp | 0);
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
function designate(army, taken) {
  for (let i = 0; i < 64; i++) {
    const s = army.id === 'republic'
      ? `CT-${1000 + Math.floor(rng() * 8999)}`
      : `${DROID_PREFIX[Math.floor(rng() * DROID_PREFIX.length)]}-${Math.floor(rng() * 90) + 10}`;
    if (!taken.has(s)) return s;
  }
  // 64 collisions in a row is not a draw, it is a broken stream; a suffix is
  // ugly and correct, and it can never loop forever.
  return `CT-${taken.size + 1}${Math.floor(rng() * 90) + 10}`;
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
export const FORMATIONS = {
  circle: {
    id: 'circle', name: 'Circle', key: 'Digit6',
    blurb: 'Ring around you, facing out. Nothing reaches you first.',
    leash: 1.0, advance: true, fire: 1,
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


/* ══════════════════════════════════════════════════════════════════════ */
/*  Morale, and who is in charge of whom                                  */
/* ══════════════════════════════════════════════════════════════════════ */

/**
 * WHAT MOVES A SQUAD'S NERVE, per event or per second.
 *
 * "Troops perform better when you're winning or aligned with their side.
 * Heavy losses, Dark-side excess, or abandoning them tanks morale — they can
 * break, refuse orders, or even turn on you."
 *
 * Every entry is an event the player can see happening and can choose to
 * cause or prevent, which is the whole test a morale term has to pass: a
 * number that moves for reasons the player cannot observe is a random number
 * generator wearing a name.
 *
 * The two `_NEAR` terms are what make a commander's PRESENCE worth something
 * mechanically, and they are deliberately the largest per-second terms in the
 * table: standing with your line is the cheapest thing a Jedi can do for it
 * and it should be worth doing.
 */
export const MORALE = {
  /** A squadmate goes down in front of them. */
  COMRADE_FELL: -0.16,
  /** …and their squad leader is worth more than a squadmate. */
  LEADER_FELL: -0.26,
  /** Somebody in the squad kills something. */
  SQUAD_KILL: 0.045,
  /** The wave is cleared. Everyone gets it. */
  WAVE_CLEAR: 0.34,
  /** An area is held. */
  AREA_HELD: 0.5,
  /** Their own health, per second, below a third. */
  WOUNDED: -0.10,
  /** Per second within `NEAR` of a living commander who is on their side. */
  LEADER_NEAR: 0.055,
  /** …and of the Jedi themselves, which is worth more. */
  JEDI_NEAR: 0.085,
  /** Per second with no friendly commander and no Jedi inside `NEAR`. */
  ALONE: -0.022,
  /** The Jedi used a Force power ON one of their own. Per use. */
  BETRAYED: -0.20,
  /** …and empowering one instead. Per use. */
  INSPIRED: 0.16,
  /** A commander reached into their nerve through the Force. Per use, and it
   *  is the one entry in this table an ENEMY commander causes. See `castForce`. */
  SHAKEN: -0.22,
  /** How close counts as near, in metres. */
  NEAR: 14,
  /** Below this a body breaks: it stops holding formation and falls back. */
  BREAK: 0.24,
  /** Below this it will not take an order at all. */
  REFUSE: 0.10,
  /** How fast a broken body recovers its nerve once it is out of contact. */
  RALLY_PER_S: 0.05,
  /**
   * WHAT SHARE OF A SQUAD HAS TO BREAK BEFORE THE REST GO WITH THEM.
   *
   * "they should fall back when a position is lost." Breaking is a MAN's
   * decision and the file already had it — below `BREAK` he stops holding
   * formation and runs to you. A position is a SQUAD's, and a squad does not
   * lose one man at a time: the two riflemen still steady when three of their
   * five have broken are not holding a position, they are the last two people
   * standing on a piece of ground nobody else is on.
   *
   * A half rather than a third or a whole, and the reason is that it has to
   * be a number the player can see coming. `census` and the roster feed both
   * show the squad, so "half of them are running" is a state you can read off
   * the screen and answer — which is the test every other number in this
   * table had to pass. At a third a squad withdraws while most of it is still
   * fighting; at a whole the rule never fires, because the last steady man in
   * a squad of five is precisely the one standing next to a commander whose
   * presence is holding him up.
   *
   * Strictly greater, so a two-man squad with one broken man is not a rout.
   */
  ROUT: 0.5,
};

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
    this.xp = opts.xp ?? 0;
    this.kills = 0;
    this.wounds = 0;              // times brought below a quarter and survived
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
    this.alive = true;
    this.diedIn = null;
    this.body = null;
  }

  get rank() { return rankFor(this.xp); }
  get rankRec() { return RANKS[this.rank]; }
  get label() { return ARCHETYPES[this.type]?.label ?? this.type; }

  /** What the roster screen prints. Designation always; nickname when earned. */
  get name() {
    return this.nickname ? `${this.designation} "${this.nickname}"` : this.designation;
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
   * The squads, as arrays of living troopers.
   *
   * Derived from the living list every time rather than stored, and that is the
   * whole reason squads survive permadeath gracefully: a squad is a SLICE, so
   * losing four of five men does not leave a squad object with one ghost in it —
   * the next call simply produces fewer, fuller squads. `SQUAD` is the only
   * number involved.
   */
  squads(size = SQUAD) {
    const out = [];
    const live = this.living;
    for (let i = 0; i < live.length; i += size) out.push(live.slice(i, i + size));
    return out;
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
      })),
    };
  }
}

/** How many bodies are one squad. Five is a fireteam and it fits one screen. */
export const SQUAD = 5;
/** The most bodies the mode will ever field for you at once. See `_muster`. */
export const MAX_STRENGTH = 24;
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
    versus: !!s.commandVersus && !!MODES[s.mode]?.meeting,
  };
}

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
    this.roster = new CommandRoster(this.army);
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
  /** Everything of this commander's still on its feet, the bodies alone. */
  get standing() {
    let n = 0;
    for (const t of this.roster.living) if (t.body && !t.body.dead) n++;
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
    this.commanders = [new Commander(this, {
      player: world?.player ?? null,
      side: opts.side ?? world?.partyTeam ?? 0,
      army: opts.army || sideForOrder(world?.settings?.order ?? world?.player?.order ?? 'jedi'),
      formation: cfg.formation,
    })];
    this.teamDamage = cfg.teamDamage;
    /** Two commanders on one field, rather than one against the composer. */
    this.versus = !!cfg.versus;
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
   * A SECOND PERSON WITH A SECOND ARMY.
   *
   * The one call that turns a campaign into a meeting. Idempotent per player,
   * because a session announces its roster more than once and two Commanders
   * for one body would be two rosters deploying into the same slots.
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
    const c = new Commander(this, { formation: this.commander.formation, ...opts });
    this.commanders.push(c);
    // The same ten strangers everybody starts with. Through the same call, so
    // there is no second idea anywhere of what an opening army is.
    if (opts.muster !== false) this._musterOpening(c);
    return c;
  }

  /** Whoever commands this body — its own commander, or mine if it has none. */
  commanderOf(e) { return (e && e.cmdr) || this.commander; }

  /* ── the campaign ──────────────────────────────────────────────────── */

  get area() { return AREAS[Math.min(this.areaIndex, AREAS.length - 1)]; }
  get areaNumber() { return this.areaIndex + 1; }
  get lastArea() { return this.areaIndex >= AREAS.length - 1; }

  /**
   * ONE SIDE'S POOL, OUT OF THE LEVEL'S TWO.
   *
   * The Geonosis level names BOTH armies in its pool, because the level is a
   * battle between them and a wave mode dropped into the middle of it should
   * meet both. In Command you are one of them, so the fill is filtered to the
   * other — and this is the ONLY override of the composer in the whole mode.
   *
   * Filtered off `ARMIES[...].tiers` rather than a second list, so a rung added
   * to the ladder appears in the enemy's fill on the same line it appears in
   * your muster. That is the hand-maintained-twin defect this repository has
   * been bitten by eight times, and the fix is always this one.
   */
  unlockedAt(wave) {
    const mine = new Set(this.army.tiers.map((t) => t.type));
    return super.unlockedAt(wave).filter((t) => !mine.has(t));
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
    return Math.floor(super.budgetFor(wave) * this.area.budget * this.allyScale());
  }

  /**
   * WHAT AN ARMY IS WORTH AS A MULTIPLIER ON THE WAVE.
   *
   * 0.055 per living body, which puts ten troopers at 1.55× and a full roster of
   * twenty-four at 2.3×. Derived rather than felt: a line trooper is threat 2
   * against a wave-10 budget of 61, so ten of them are worth about a third of
   * the wave on paper — and they are worth more than that in practice because
   * they split the horde's attention, which is the same argument
   * `WaveDirector.partySize` makes about a second player and prices at 0.72.
   *
   * Capped at 2.6 for the reason `HEAVY_CAP` is capped: past that the wave stops
   * being a fight and becomes a frame-rate question.
   */
  allyScale() {
    return Math.min(2.6, 1 + this.roster.strength * 0.055);
  }

  /** How hard this area leans on the heavy end, on top of the depth's own lean. */
  heavyBias(wave) {
    return clamp(super.heavyBias(wave) + this.area.heavy, 0, 1.3);
  }

  /* ── the muster ────────────────────────────────────────────────────── */

  /**
   * THE ARMY YOU START WITH.
   *
   * Ten bodies in two squads, all of them rung 1, all of them nameless numbers.
   * That is deliberate: the roster screen at the top of a campaign should be ten
   * identical strangers, so that the three names in it four areas later are
   * something the player earned rather than something the mode handed them.
   */
  _musterOpening(c = this.commander) {
    const first = c.army.tiers[0].type;
    for (let i = 0; i < OPENING_STRENGTH; i++) c.roster.enlist(first);
    c.roster.points = AREAS[0].muster;
  }

  /**
   * WHAT THE MUSTER CAN SELL RIGHT NOW.
   *
   * A rung is offered when the area has reached its `at` and the roster can
   * afford it. `have` is what you already field of that type, which is the
   * number the screen actually wants — the interesting question at a muster is
   * never "what exists", it is "should this be my third heavy or my first ARC".
   */
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
      next: AREAS[Math.min(this.areaIndex + 1, AREAS.length - 1)],
      points: c.roster.points,
      strength: c.roster.strength,
      max: MAX_STRENGTH,
      roster: c.roster.summary(),
      units: c.army.tiers
        // The AREA NUMBER, not a second column beside it. See AREAS.
        .filter((t) => t.at <= this.areaNumber)
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
    if (rung.at > this.areaNumber) { this.refused = `${ARCHETYPES[type]?.label ?? type} is not available until area ${rung.at} of the advance`; return null; }
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
      for (let guard = 0; guard < 40; guard++) {
        const affordable = this.musterOffer(c).units.filter((u) => u.afford);
        if (!affordable.length) break;
        affordable.sort((a, b) => b.cost - a.cost);
        if (!this.recruit(affordable[0].type, c)) break;
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
    const live = c.roster.living;
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
    /* OPT-IN, and the default is the instant placement this method has always
     * done. A ship is four seconds of flight and that is right for the ONE
     * moment the brief describes — the army coming down at the top of an area
     * — and wrong for everything else `deploy` answers, which is "this record
     * has no body and needs one now": a mid-wave replacement standing around
     * for four seconds is a hole in your line, not a cinematic. So
     * `closeMuster` and the meeting ask for ships and nothing else does. */
    const air = opts.byShip && this.arrivals?.enabled ? this.arrivals : null;
    let n = 0;
    for (let i = 0; i < live.length; i++) {
      const t = live[i];
      if (t.body && !t.body.dead) continue;
      const a = (i / Math.max(1, live.length)) * TAU + rng() * 0.4;
      const r = 4 + (i % 3) * 2.2;
      _v2.set(anchor.x + Math.sin(a) * r, 0, anchor.z + Math.cos(a) * r);
      if (w.terrain) {
        // Never off the edge of the world: a trooper deployed outside the
        // heightfield is exactly the unreachable body the wave watchdog exists
        // to catch, and putting one there on purpose is worse than catching it.
        if (!w.terrain.inBounds(_v2.x, _v2.z, 8)) _v2.set(anchor.x, 0, anchor.z);
        _v2.y = w.terrain.height(_v2.x, _v2.z);
      }
      /* THE COMMANDER'S SIDE, not the world's one constant. `world.partyTeam`
       * is the LOCAL player's side and there is one of it; a second army on it
       * would be an ally of the first, which is the whole question. */
      /* ALREADY ON A SHIP. `deploy` is called from three places and one of
       * them — `start`, whose guard is "does any living record lack a body" —
       * would otherwise re-order the whole army every frame of the four
       * seconds a gunship spends in the air, and land ten copies of it. A
       * record in the air has no body and is not missing one. */
      if (this._inbound.has(t)) continue;
      const enlist = (e) => {
        this._inbound.delete(t);
        enlistBody(e, t, { team: c.side, teamDamage: this.teamDamage, director: this, cmdr: c });
      };
      /* 18 m, and the check holds it under 30: a gunship that sets your line
       * down at the far edge of the spawn ring has not reinforced you, it has
       * started them on a walk. */
      if (air && air.request(t.type, null, null, Math.PI / 2, enlist, { kind: 'dropship', near: 18, cap: 6 })) {
        this._inbound.add(t); n++; continue;
      }
      const e = w.spawnEnemy(t.type, _v2);
      if (!e) continue;
      enlist(e);
      n++;
    }
    this._announceRoster();
    return n;
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
  recall(c = null) {
    if (!c) { let n = 0; for (const k of this.commanders) n += this.recall(k); return n; }
    /* Anything still in the air is not coming: `Waves.reset` empties the
     * staging list at an area boundary anyway, and a record left in this set
     * would never be deployed again. */
    for (const t of c.roster.all) this._inbound.delete(t);
    let n = 0;
    for (const t of c.roster.all) {
      const e = t.body;
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
  order(id, cmdr = null) {
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
    if (this._netShell) return this.world?.requestOrder?.(id) ?? false;
    const c = cmdr || this.commander;
    c.formation = id;
    // A formation that does not advance is planted where the commander was
    // STANDING when the order was given — see `_anchorFor`. So is one the
    // commander has told to HOLD, which is the same mechanism as a decision
    // rather than as a property of one order.
    c._planted = (F.advance && !c.holding) ? null : this._frame(c, new THREE.Vector3());
    // A new order is a new choice of cover. See `_coverSite`.
    this._coverEpoch = (this._coverEpoch | 0) + 1;
    this.log.push({ t: 'order', formation: id, area: this.areaNumber, wave: this.wave });
    if (c === this.commander) this.onOrder?.(F, c.roster.squads().length);
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
      if (e.trooper) this.shake(e.trooper, 'SHAKEN', this.commanderOf(e));
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
    if (c._heldYaw === null || c._heldYaw === undefined) c._heldYaw = headingOf(p);
    return { pos: outPos.clone(), yaw: c._heldYaw };
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
  _anchorFor(F, c = this.commander) {
    /* `c.holding` is the HOLD toggle and it applies to whatever formation is
     * up, which is what was asked for: "there should be an option where you
     * can tell your troops to get into a certain formation and hold it and
     * stay there regardless of where you are". `cover`'s `advance: false` is
     * the same mechanism authored into one order; this is the same mechanism
     * as a decision the player makes. */
    if ((!F.advance || c.holding) && c._planted) return c._planted;
    return this._frame(c, _v1);
  }

  /**
   * WHERE TROOPER `e` SHOULD BE STANDING, in world space.
   *
   * @returns the vector, or null if this formation has no slot (CHARGE).
   */
  slotFor(e, out = _slot) {
    /* THE BODY'S OWN COMMANDER, not the machine's. `e.cmdr` is written by
     * `enlistBody` at deploy, so a trooper solves its slot in the frame of the
     * person who deployed it — which is what makes two lines face each other
     * instead of both forming up on whoever is holding the mouse. */
    const cmdr = this.commanderOf(e);
    const F = FORMATIONS[cmdr.formation] || FORMATIONS[DEFAULT_FORMATION];
    const idx = e.cmdIndex | 0, n = e.cmdCount || 1, k = e.cmdSquad | 0;
    if (!F.slot(idx, n, k, out)) return null;
    const A = this._anchorFor(F, cmdr);
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
    if (F.seeksCover) this._coverSite(e, out, A, COVER_HUNT, this._coverEpoch | 0, 0);
    else if (e.underFire > 0) this._coverSite(e, out, A, COVER_LEAN, e._fireEpoch | 0, 1);
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
  _coverSite(e, out, A, hunt = COVER_HUNT, at = 0, mode = 0) {
    /* THE MISS IS CACHED TOO, and that is not tidiness. This walks every
     * static box on the level, and it is called once per trooper per frame
     * from `slotFor` — which `steer` and `targetFor` both call. Caching only
     * the HIT meant a squad standing in the open re-scanned the whole level
     * twenty-four times a frame forever, and the reactive caller made that the
     * common case rather than the rare one. A null is a decision: there was
     * nothing to get behind when this man last looked, and he looks again when
     * the order changes or the next burst arrives. */
    if (e._coverAt === at && e._coverFor === mode) {
      if (e._coverPt) out.copy(e._coverPt);
      return;
    }
    e._coverAt = at; e._coverFor = mode; e._coverPt = null;
    const boxes = this.world?.physics?.staticBoxes;
    if (!boxes || !boxes.length) return;
    /* Where the shooting is coming from, as one bearing for the whole army. */
    if (this._threatAt !== this._coverEpoch) {
      this._threatAt = this._coverEpoch;
      let tx = 0, tz = 0, n = 0;
      for (const h of this.world.enemies || []) {
        if (!h || h.dead || h.trooper) continue;
        tx += h.position.x - A.pos.x; tz += h.position.z - A.pos.z; n++;
      }
      const m = Math.hypot(tx, tz);
      this._threat = (n && m > 1e-3) ? { x: tx / m, z: tz / m }
        : { x: Math.sin(A.yaw), z: Math.cos(A.yaw) };
    }
    const T = this._threat;
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
    e._coverPt = out.clone();
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
      if (t.morale < MORALE.REFUSE) return;             // finished: nothing reaches them
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
        }
      }
      return;
    }
    const F = FORMATIONS[c.formation] || FORMATIONS[DEFAULT_FORMATION];
    const slot = this.slotFor(e);
    if (!slot) return;                                  // charge: no slot at all
    const dx = slot.x - e.position.x, dz = slot.z - e.position.z;
    const d = Math.hypot(dx, dz);
    e.cmdSlotDist = d;
    /* A live target it is allowed to engage buys it the whole leash; otherwise
     * it owes the mark. `e.target` is what `_think` set THIS frame off
     * `pickTarget`, which for a trooper is `targetFor` below — so the two
     * clauses are reading the same decision and cannot disagree about it. */
    const fighting = e.target && !e.target.dead && e.target.alive !== false;
    const limit = fighting ? this.leashFor(F, e) : FORM_TOLERANCE;
    if (d <= limit) return;
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
    const F = FORMATIONS[c.formation] || FORMATIONS[DEFAULT_FORMATION];
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
  targetFor(e, candidates) {
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
      if (c.roster.fall(t, this.areaNumber)) {
        this.log.push({ t: 'fell', name: t.name, unit: t.label, rank: t.rankRec.short,
                        area: this.areaNumber, wave: this.wave, xp: t.xp, kills: t.kills });
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
    this.world?.notify?.('CHECK YOUR FIRE', `${e.trooper.name} is one of yours`);
  }

  _announceRoster() { this.onRoster?.(this.roster.summary()); }

  /* ── the wave loop ─────────────────────────────────────────────────── */

  /**
   * A WAVE STARTED. Two things Command adds and the base does not:
   * the army goes down with you at the top of an area, and the wave's headline
   * is the AREA rather than the wave number, because the area is the thing the
   * player is crossing.
   */
  start(wave = 1) {
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
    if (this.roster.living.some((t) => (!t.body || t.body.dead) && !this._inbound.has(t))) this.deploy();
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
    const t = this.world?.terrain;
    const half = VERSUS_SEPARATION / 2;
    const n = Math.max(this.commanders.length, sides.length, players.length);
    for (let i = 0; i < n; i++) {
      const c = this.commanders[i] || this.enlistCommander({ player: players[i] ?? null });
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
    this._updateClosing(ctx);
    /* A meeting has no queue, no arrivals and no wave to clear — see `start`.
     * The army half of the frame is identical, which is the point: two players'
     * lines are steered by the same code one player's is. */
    if (this.versus) { this._troops(dt, ctx); return; }
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
    for (const c of this.commanders) {
      const s = c.side;
      standing[s] = standing[s] || 0;
      health[s] = health[s] || 0;
      if (c.player && Array.isArray(present) && !present.includes(c.player)) continue;
      for (const t of c.roster.living) {
        const b = t.body;
        if (!b || b.dead) continue;
        standing[s]++;
        health[s] += Math.max(0, b.hp || 0);
      }
      const p = c.player;
      if (p && p.alive !== false && !p.dead) { standing[s]++; health[s] += Math.max(0, p.hp || 0); }
    }
    return { standing, health };
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
   * WHO IS IN CHARGE OF THIS SQUAD — derived, never stored.
   *
   * "Troops should have a squad commander/hierarchy if they already don't,
   * certain roles are replaced if that person falls in combat, other's are
   * not."
   *
   * The leader of a squad is its highest-ranked living member, ties broken by
   * experience and then by enlistment order so the answer is stable frame to
   * frame. Deriving it is the whole of "replaced if that person falls": there
   * is no field to clear and no promotion to schedule — the moment a sergeant
   * goes down, the next man up IS the leader, on the next frame, because the
   * question is asked rather than remembered.
   *
   * The role that is NOT replaced is yours. A Jedi commanding is a person, not
   * a rung, and `_endCampaign` is what happens when that one falls.
   */
  leaderOf(squad) {
    let best = null;
    for (const t of squad) {
      if (!t.alive) continue;
      if (!best) { best = t; continue; }
      if (t.rank > best.rank) { best = t; continue; }
      if (t.rank === best.rank && t.xp > best.xp) best = t;
    }
    return best;
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
    const squads = c.roster.squads();
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
          let near = false;
          if (jedi?.position && dist2(e.position, jedi.position) < MORALE.NEAR * MORALE.NEAR) {
            d += MORALE.JEDI_NEAR; near = true;
          }
          if (lead && lead !== t && lead.body && !lead.body.dead
            && dist2(e.position, lead.body.position) < MORALE.NEAR * MORALE.NEAR) {
            d += MORALE.LEADER_NEAR; near = true;
          }
          if (!near) d += MORALE.ALONE;
          if (e.maxHp && e.hp < e.maxHp * 0.34) d += MORALE.WOUNDED;
        } else {
          // between areas, or waiting on a gunship: nerve comes back
          d += MORALE.RALLY_PER_S;
        }
        t.morale = clamp(t.morale + d * dt, 0, 1);
        /* THE ONE THING A BODY READS OFF ITS RECORD EVERY FRAME. `_pace` is
         * how much of its own speed a shaken body uses and `aimQuality`
         * already reads `trooper.morale` directly; keeping the broken flag
         * here means the three consumers cannot disagree about it. */
        t.broken = t.morale < MORALE.BREAK;
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
    const list = who ? (Array.isArray(who) ? who : [who]) : c.roster.living;
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
    /* Per commander, and the indices restart per army: `cmdIndex` is a position
     * in ONE roster's living list, and two armies sharing a numbering would
     * have the second one solving its slots against the first one's count. */
    for (const c of this.commanders) {
      this._slewFrame(c, dt);
      this._morale(dt, c);
      /* The commander's own Force, one clock per verb per army. Here rather
       * than in `update` because this is the loop that already runs once a
       * frame for every commander in the world, meeting or campaign. */
      if (c._castCd) for (const k in c._castCd) if (c._castCd[k] > 0) c._castCd[k] = Math.max(0, c._castCd[k] - dt);
      const F = FORMATIONS[c.formation] || FORMATIONS[DEFAULT_FORMATION];
      const squads = c.roster.squads();
      let i = 0;
      const n = c.roster.strength;
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
        const lead = this.leaderOf(squads[k]);
        const focus = (lead && lead.body && !lead.body.dead) ? lead.body.target : null;
        /* …AND THE LEADER DOES NOT FOLLOW HIMSELF. Stamping the focus on every
         * body of the squad including his own made his last pick his next
         * pick, every frame, for as long as it stayed in reach — a target lock
         * nobody asked for, on the one man whose job is to choose. Measured in
         * a meeting: both lines locked onto each other's front rank at first
         * contact and neither ever re-aimed. */
        for (const t of squads[k]) {
          const e = t.body;
          if (!e || e.dead) { i++; continue; }
          e.cmdIndex = i++;
          e.cmdCount = n;
          e.cmdSquad = k;
          e.cmdFocus = (focus && t !== lead) ? focus : null;
          /* UNDER FIRE decays here for the same reason the indices are
           * refreshed here: this is the one loop that touches every living
           * body of every army exactly once a frame. See UNDER_FIRE, and
           * `installTeamDamage` for what sets it. */
          if (e.underFire > 0) e.underFire = Math.max(0, e.underFire - dt);
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
          if (F.fire <= 0 && !this._closing) holdFire(e);
          this._clearBlade(e, c, dt);
        }
      }
    }
    this._frameDt = dt;
  }

  /**
   * GET OUT OF THE WAY OF THE BLADE.
   *
   * "in too many of the troop formations the troops are totally in the way of
   * your saber like they don't avoid it at all and crowd you."
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
      const p = t.award(1);
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
    if (this.areaWaves >= this.area.waves) this._areaClear();
    return fresh;
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
    for (const t of this.roster.living) {
      t.areas++;
      const p = t.award(2);
      if (p) this._promoteTrooper(t, t.body);
    }
    // Holding a whole area is the biggest thing that happens to a line's nerve.
    for (const c of this.commanders) this.shake(null, 'AREA_HELD', c);
    this.roster.points += this.area.muster;
    this.log.push({ t: 'area', area: this.areaNumber, name: this.area.name,
                    strength: this.roster.strength, fallen: this.roster.fallen.length });

    if (this.lastArea) { this._endCampaign(); return; }

    this.areaIndex++;
    this.areaWaves = 0;
    this.mustering = true;
    // The army comes off the field and is put down again around you at the top
    // of the next area — the gunships, which is what the first area's brief
    // says happens. See `recall`.
    this.recall();
    const offer = this.musterOffer();
    this.world?.notify?.(`${AREAS[this.areaIndex - 1].name.toUpperCase()} — HELD`,
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
    this.log.push({ t: 'won', area: this.areaNumber, strength, fallen: this.roster.fallen.length });
    // The survivors walk off the field. Every record is kept — the roster IS the
    // summary, and the fallen are most of what it is worth reading.
    this.recall();
    this.world?.notify?.('THE ADVANCE IS OVER', `${strength} of ${all} walked off Geonosis`);
    /* …and it makes a sound. The same call `World._endMeeting` makes, for the
     * same reason: the score's only ending was a death, and a campaign that is
     * WON is the other one. Always true here — a campaign that reaches this
     * line has been won by definition, where a meeting has to ask whose screen
     * it is. */
    audio.runWon?.(true);
    const w = this.world;
    if (!w) return true;
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
    w.onGameOver?.(w.runStats({ won: true }));
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
    // THE GUNSHIPS, which is what the mode's first brief has always said
    // happens and what the code never did. See `deploy`.
    this.deploy(this.commander, { byShip: true });
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
      areas: AREAS.length,
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
      squads: c.roster.squads().length,
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
    this.areaIndex = clamp((r.area | 0) - 1, 0, AREAS.length - 1);
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
