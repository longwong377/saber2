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
 */

import * as THREE from 'three';
import { ARCHETYPES, applyModifier } from './Enemy.js';
import { buildTrooper, buildB1, buildB2, buildBodyguard } from './Bodies.js';
import { TOUGHNESS } from './Combat.js';
import { BOLT_COLORS } from './Bolts.js';
import { WaveDirector, holdFire, isHeavy } from './Waves.js';
import { clamp, lerp, makeRng, TAU } from '../engine/MathUtil.js';

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
 * by the people beside them rather than from a fantasy name generator. Droids do
 * not get nicknames — they get a COMMAND DESIGNATION, which is the same idea in
 * the other army's grammar: a numbered B1 that survives becomes OOM-9.
 */
const NICKNAMES = [
  'Ladder', 'Boil', 'Waxer', 'Hardcase', 'Kix', 'Jesse', 'Tup', 'Dogma', 'Hevy',
  'Echo', 'Droidbait', 'Cutup', 'Sinker', 'Comet', 'Wolffe', 'Boost', 'Gregor',
  'Crys', 'Longshot', 'Sketch', 'Chatterbox', 'Slick', 'Punch', 'Denal', 'Ringo',
  'Nub', 'Trap', 'Wooley', 'Attie', 'Switch', 'Charger', 'Coric', 'Vaughn',
];

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
 *   leash          how far from that slot a trooper may stray to engage. This
 *                  is the number that makes a formation a TACTIC rather than a
 *                  parade: a tight leash is a wall that will not chase, a loose
 *                  one is a screen that will.
 *   advance        whether the formation moves with you at all. COVER does not
 *                  — it plants where it was ordered, which is the only way "take
 *                  cover" can mean anything when the anchor is a moving player.
 *   fire           a multiplier on how eagerly the troops shoot, so HOLD is a
 *                  real order and not a slower CHARGE. 0 is `holdFire`.
 *
 * Six of them, and the six are not a taste: they are the six things you can ask
 * a body near you to do that produce visibly different battles. Anything else is
 * one of these with a different radius.
 */
export const FORMATIONS = {
  circle: {
    id: 'circle', name: 'Circle', key: 'Digit6',
    blurb: 'Ring around you, facing out. Nothing reaches you first.',
    leash: 6, advance: true, fire: 1,
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
    leash: 7, advance: true, fire: 1,
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
    leash: 10, advance: true, fire: 1,
    slot(i, n, k, out) {
      const across = (i % 4) - 1.5;
      const rank = Math.floor(i / 4);
      return out.set(across * 2.6, 0, 5.0 + rank * 3.0);
    },
  },
  line: {
    id: 'line', name: 'Line abreast', key: 'Digit9',
    blurb: 'One rank either side of you. Everything fires at once.',
    leash: 8, advance: true, fire: 1,
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
    leash: 5, advance: false, fire: 1,
    slot(i, n, k, out) {
      // A loose scatter rather than a shape — troops going to ground spread out,
      // and a tight ring under fire is a grenade's dream. Deterministic in `i`
      // so a trooper does not swap holes with the man beside him every frame.
      const a = (i * 2.399963) % TAU;              // golden angle: no clumps
      const r = 6 + (i % 5) * 1.9;
      return out.set(Math.sin(a) * r, 0, Math.cos(a) * r);
    },
  },
  charge: {
    id: 'charge', name: 'Charge', key: 'Minus',
    blurb: 'Break formation. Find something and kill it.',
    leash: Infinity, advance: true, fire: 1,
    slot() { return null; },
  },
};

export const FORMATION_IDS = Object.keys(FORMATIONS);
export const DEFAULT_FORMATION = 'behind';

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
 *   `tier`     the highest rung of your own roster the muster will sell here.
 *
 * The names are the ground, and the ground is the reference images: an open
 * ochre plain with enormous sightlines, dust, vertical smoke columns, distant
 * mesas and spires. You cross it. That is the campaign.
 */
export const AREAS = [
  {
    id: 'landing', name: 'The Landing Zone',
    brief: 'The gunships put you down in the open. Form up before the first line reaches you.',
    waves: 3, budget: 0.75, heavy: 0.0, muster: 11, tier: 1,
  },
  {
    id: 'plain', name: 'The Open Plain',
    brief: 'Two kilometres of flat ochre and nothing to hide behind. They can see you the whole way.',
    waves: 4, budget: 0.95, heavy: 0.15, muster: 14, tier: 2,
  },
  {
    id: 'hailfire', name: 'The Hailfire Line',
    brief: 'Armour on the ridge. Your line will not survive standing in the open here.',
    waves: 4, budget: 1.10, heavy: 0.35, muster: 17, tier: 2,
  },
  {
    id: 'spires', name: 'The Spire Approach',
    brief: 'Under the spires, in the smoke. Their elite are waiting where the sightlines close.',
    waves: 5, budget: 1.25, heavy: 0.30, muster: 26, tier: 4,
  },
  {
    id: 'foundry', name: 'The Core Ship',
    brief: 'The last ground before the ship. Everything they have left is between you and it.',
    waves: 5, budget: 1.45, heavy: 0.45, muster: 30, tier: 4,
  },
];

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
    this.type = type;
    this.designation = name;
    this.nickname = null;
    this.xp = opts.xp ?? 0;
    this.kills = 0;
    this.wounds = 0;              // times brought below a quarter and survived
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
    // A nickname is earned on the SECOND rung and never lost. See NICKNAMES.
    if (!this.nickname && now >= 2 && this.army === 'republic') {
      this.nickname = NICKNAMES[Math.floor(rng() * NICKNAMES.length)];
    }
    return RANKS[now];
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
    const t = new Trooper(this.army, type, name, opts);
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
  };
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
   * this only fired inside `_promote`. */
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
 */
export function installCommand(e) {
  if (!e || e._cmdMove) return false;
  const base = e._move;
  if (typeof base !== 'function') return false;
  e._cmdMove = true;
  e._move = function (dt, ctx) {
    const d = this.commandOf;
    if (d && !this.dead && !this.gripped && !this.toppled) d.steer(this, dt);
    return base.call(this, dt, ctx);
  };
  return true;
}

/**
 * TEAM DAMAGE, AND THE SCREAM.
 *
 * `Enemy.damage(amount, point, source, kind)` is the one door every injury goes
 * through — blade, bolt, explosion, fall, lightning — so wrapping it on the
 * instance catches all of them and cannot miss the fifth one somebody adds
 * later. That is the whole reason it is here and not spread across the four call
 * sites that hurt things.
 *
 * ONLY THE PLAYER'S OWN HITS ARE SCALED. A B1 shooting your sergeant does full
 * damage — obviously — and so does a Force push that throws him into a rock,
 * because the fall is nobody's fault. What is scaled is a hit whose `source` is
 * on your own side, which is exactly the hit the note is about.
 *
 * @returns whether the wrapper went on.
 */
export function installTeamDamage(e, scale) {
  if (!e || e._cmdDamage) return false;
  const base = e.damage;
  if (typeof base !== 'function') return false;
  e._cmdDamage = true;
  e.teamDamage = clamp(scale, 0, 1);
  e.damage = function (amount, point, source, kind) {
    let amt = amount;
    // `team` on the source, not `instanceof Player`: a co-op partner's blade and
    // a peer's avatar are as much your side as you are, and a bolt carries its
    // owner. A source with no team at all (a hazard, a falling crate) is nobody's
    // and pays full — the same fails-open rule `canHarm` states.
    if (source && source !== this && source.team !== undefined && source.team === this.team) {
      amt = amount * this.teamDamage;
      const d = this.commandOf;
      if (d && amt > 0) d.onFriendlyHit(this, amt, source);
      if (this.teamDamage <= 0) return false;
    }
    return base.call(this, amt, point, source, kind);
  };
  return true;
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
    super(world, { ...opts, mode: 'command' });
    const cfg = commandConfig(world?.settings);

    /** Which army the player leads, and therefore which one comes for them. */
    this.army = opts.army || sideForOrder(world?.settings?.order ?? world?.player?.order ?? 'jedi');
    this.foe = enemyOf(this.army);
    this.roster = new CommandRoster(this.army);
    this.teamDamage = cfg.teamDamage;
    this.formation = cfg.formation;
    /** The frame a non-advancing formation was planted in. See `_anchorFor`. */
    this._planted = null;
    this.areaIndex = 0;
    this.areaWaves = 0;
    /** Raised while the muster is open, so no wave starts under the screen. */
    this.mustering = false;
    /** Every promotion, death and order — the campaign's own log. */
    this.log = [];
    this.onRoster = null;         // (summary) => void      — the HUD's feed
    this.onMuster = null;         // (offer) => void        — the between-areas screen
    this.onOrder = null;          // (formation, squads) => void
    /* Its own stream off the run's number, exactly as the four in Waves.js. */
    if (this.seed !== null) seedCommand(this.seed ^ 0x6f4a1b3d);

    this._musterOpening();
  }

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
  _musterOpening() {
    const first = this.army.tiers[0].type;
    for (let i = 0; i < OPENING_STRENGTH; i++) this.roster.enlist(first);
    this.roster.points = AREAS[0].muster;
  }

  /**
   * WHAT THE MUSTER CAN SELL RIGHT NOW.
   *
   * A rung is offered when the area has reached its `at` and the roster can
   * afford it. `have` is what you already field of that type, which is the
   * number the screen actually wants — the interesting question at a muster is
   * never "what exists", it is "should this be my third heavy or my first ARC".
   */
  musterOffer() {
    const A = this.area;
    const have = new Map();
    for (const t of this.roster.living) have.set(t.type, (have.get(t.type) || 0) + 1);
    return {
      area: this.areaNumber,
      areaName: A.name,
      brief: A.brief,
      next: AREAS[Math.min(this.areaIndex + 1, AREAS.length - 1)],
      points: this.roster.points,
      strength: this.roster.strength,
      max: MAX_STRENGTH,
      roster: this.roster.summary(),
      units: this.army.tiers
        .filter((t) => t.at <= A.tier)
        .map((t) => ({
          type: t.type, cost: t.cost,
          label: ARCHETYPES[t.type]?.label ?? t.type,
          threat: ARCHETYPES[t.type]?.threat ?? 0,
          have: have.get(t.type) || 0,
          afford: this.roster.points >= t.cost && this.roster.strength < MAX_STRENGTH,
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
  recruit(type) {
    const rung = this.army.tiers.find((t) => t.type === type);
    this.refused = null;
    if (!rung) { this.refused = `${type} is not one of ${this.army.name}'s units`; return null; }
    if (rung.at > this.area.tier) { this.refused = `${ARCHETYPES[type]?.label ?? type} is not available until later in the advance`; return null; }
    if (this.roster.points < rung.cost) { this.refused = `${rung.cost} points needed, you have ${this.roster.points}`; return null; }
    if (this.roster.strength >= MAX_STRENGTH) { this.refused = `you cannot field more than ${MAX_STRENGTH}`; return null; }
    this.roster.points -= rung.cost;
    const t = this.roster.enlist(type, { joined: this.areaNumber });
    this.log.push({ t: 'enlist', name: t.name, unit: t.label, area: this.areaNumber });
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
  autoMuster() {
    let bought = 0;
    const want = Math.max(0, OPENING_STRENGTH - this.roster.strength);
    const cheapest = this.army.tiers[0].type;
    for (let i = 0; i < want; i++) if (this.recruit(cheapest)) bought++;
    // Then the best thing on the shelf, until nothing on it is affordable.
    for (let guard = 0; guard < 40; guard++) {
      const affordable = this.musterOffer().units.filter((u) => u.afford);
      if (!affordable.length) break;
      affordable.sort((a, b) => b.cost - a.cost);
      if (!this.recruit(affordable[0].type)) break;
      bought++;
    }
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
  deploy() {
    const w = this.world;
    if (!w || typeof w.spawnEnemy !== 'function') return 0;
    const anchor = w.player ? w.player.position : _v1.set(0, 0, 0);
    const live = this.roster.living;
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
      const e = w.spawnEnemy(t.type, _v2);
      if (!e) continue;
      enlistBody(e, t, { team: w.partyTeam ?? 0, teamDamage: this.teamDamage, director: this });
      n++;
    }
    this._announceRoster();
    return n;
  }

  /** Take the army off the field between areas, keeping every record. */
  recall() {
    for (const t of this.roster.all) {
      if (t.body && !t.body.dead) t.body.trooper = null;
      t.body = null;
    }
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
  order(id) {
    const F = FORMATIONS[id];
    if (!F) return false;
    this.formation = id;
    // A formation that does not advance is planted where the commander was
    // STANDING when the order was given — see `_anchorFor`.
    this._planted = F.advance ? null : this._frame(new THREE.Vector3(), { yaw: 0 });
    this.log.push({ t: 'order', formation: id, area: this.areaNumber, wave: this.wave });
    this.onOrder?.(F, this.roster.squads().length);
    return true;
  }

  /** The commander's frame: where they are and which way they are looking. */
  _frame(outPos, outYaw) {
    const p = this.world?.player;
    if (!p) { outPos.set(0, 0, 0); outYaw.yaw = 0; return { pos: outPos.clone(), yaw: 0 }; }
    outPos.copy(p.position);
    // `aimDir` rather than the camera yaw: the direction the commander is
    // FACING is where they are pointing the blade, and on a body that strafes
    // those are not the same thing.
    const d = p.aimDir;
    const yaw = d ? Math.atan2(d.x, d.z) : 0;
    return { pos: outPos.clone(), yaw };
  }

  /** The frame a formation is measured in — live, or frozen if it was planted. */
  _anchorFor(F) {
    if (!F.advance && this._planted) return this._planted;
    return this._frame(_v1, { yaw: 0 });
  }

  /**
   * WHERE TROOPER `e` SHOULD BE STANDING, in world space.
   *
   * @returns the vector, or null if this formation has no slot (CHARGE).
   */
  slotFor(e, out = _slot) {
    const F = FORMATIONS[this.formation] || FORMATIONS[DEFAULT_FORMATION];
    const idx = e.cmdIndex | 0, n = e.cmdCount || 1, k = e.cmdSquad | 0;
    if (!F.slot(idx, n, k, out)) return null;
    const A = this._anchorFor(F);
    // Rotate the formation-local slot into the commander's frame. +Z is forward.
    const s = Math.sin(A.yaw), c = Math.cos(A.yaw);
    const x = out.x * c + out.z * s;
    const z = -out.x * s + out.z * c;
    out.set(A.pos.x + x, 0, A.pos.z + z);
    if (this.world?.terrain) out.y = this.world.terrain.height(out.x, out.z);
    return out;
  }

  /**
   * THE STEER — one troop, one frame, between the brain and the feet.
   *
   * Two decisions and they are both about ONE number, the distance from the
   * slot:
   *
   *   inside the tolerance   leave the brain alone entirely. A trooper standing
   *                          where it was told to stand fights exactly as the
   *                          same body fights on the other team, which is the
   *                          property this whole mode rests on.
   *   outside it             overwrite `wish` with the direction home, and
   *                          overwrite `toTarget` with the same — because
   *                          `_move`'s backpedal limiter scales the component
   *                          pointing away from `toTarget`, so a trooper walking
   *                          BACK to its slot with a stale forward target would
   *                          do it at 40% pace and never arrive.
   *
   * The tolerance is not the leash. The leash decides what a trooper may SHOOT
   * (see `targetFor`); the tolerance decides what it may STAND ON, and it is
   * deliberately loose — 2.2 m — because a formation solved to the centimetre
   * reads as a parade and this is a battle.
   */
  steer(e, dt) {
    if (!e.trooper) return;
    const F = FORMATIONS[this.formation] || FORMATIONS[DEFAULT_FORMATION];
    const slot = this.slotFor(e);
    if (!slot) return;                                  // charge: no slot at all
    const dx = slot.x - e.position.x, dz = slot.z - e.position.z;
    const d = Math.hypot(dx, dz);
    e.cmdSlotDist = d;
    if (d < FORM_TOLERANCE) return;                     // in position; fight on
    const inv = 1 / (d || 1);
    if (!e.wish) e.wish = new THREE.Vector3();
    e.wish.set(dx * inv, 0, dz * inv);
    if (!e.toTarget) e.toTarget = new THREE.Vector3();
    e.toTarget.set(dx * inv, 0, dz * inv);
  }

  /**
   * WHO A TROOPER OF YOURS IS ALLOWED TO SHOOT.
   *
   * `World.pickTarget` delegates here for anything carrying a `trooper`. Two
   * rules, and between them they are the whole tactical content of a formation:
   *
   *   the nearest HOSTILE — which for an ally is the horde and for the horde is
   *     you, one function answering for both armies rather than two lists built
   *     from two ideas of who is fighting whom;
   *   within the formation's LEASH of the trooper's own slot, so a tight
   *     formation genuinely will not chase and a loose one genuinely will.
   *
   * Returning null is a legitimate answer and it is what makes the leash mean
   * something: `Enemy._think` sets `wish = null` on a null target, and `steer`
   * then supplies the walk home. Nothing has to be told to stop fighting.
   */
  targetFor(e, candidates) {
    const F = FORMATIONS[this.formation] || FORMATIONS[DEFAULT_FORMATION];
    const slot = F.leash === Infinity ? null : this.slotFor(e, _slot);
    const ax = slot ? slot.x : e.position.x;
    const az = slot ? slot.z : e.position.z;
    const leash2 = F.leash === Infinity ? Infinity : F.leash * F.leash;
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
    return best;
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
      if (this.roster.fall(t, this.areaNumber)) {
        this.log.push({ t: 'fell', name: t.name, unit: t.label, rank: t.rankRec.short,
                        area: this.areaNumber, wave: this.wave, xp: t.xp, kills: t.kills });
        this.world?.notify?.(`${t.rankRec.title.toUpperCase()} DOWN`,
          `${t.name} — ${t.kills} kill${t.kills === 1 ? '' : 's'}, ${this.roster.strength} still standing`);
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
    const promoted = t.award(1);
    if (promoted) this._promote(t, source);
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
  _promote(t, e) {
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

  /** The player hit one of their own. Told once, loudly, and never nagged. */
  onFriendlyHit(e, amount, source) {
    this._ffT = (this._ffT || 0);
    if (this._ffT > 0 || !e.trooper) return;
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
    super.start(wave);
    if (this.roster.living.some((t) => !t.body || t.body.dead)) this.deploy();
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
    if (this.mustering) { this.arrivals.update(dt, ctx); this._troops(dt, ctx); return; }
    super.update(dt, ctx);
    this._troops(dt, ctx);
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
  _troops(dt, ctx) {
    const F = FORMATIONS[this.formation] || FORMATIONS[DEFAULT_FORMATION];
    const squads = this.roster.squads();
    let i = 0;
    const n = this.roster.strength;
    for (let k = 0; k < squads.length; k++) {
      for (const t of squads[k]) {
        const e = t.body;
        if (!e || e.dead) { i++; continue; }
        e.cmdIndex = i++;
        e.cmdCount = n;
        e.cmdSquad = k;
        // Fire discipline. `holdFire` is Waves.js's own primitive — it pushes
        // the fuse back up without touching the brain, so a trooper ordered to
        // hold still takes cover, calls out and tracks you exactly as it did.
        if (F.fire <= 0) holdFire(e);
      }
    }
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
    if (!fresh) return fresh;
    this.areaWaves++;
    // Experience for living through it: a body that was on the field when the
    // wave cleared earned something even if it never fired.
    for (const t of this.roster.living) {
      const p = t.award(1);
      if (p) this._promote(t, t.body);
    }
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
    for (const t of this.roster.living) {
      t.areas++;
      const p = t.award(2);
      if (p) this._promote(t, t.body);
    }
    this.roster.points += this.area.muster;
    this.log.push({ t: 'area', area: this.areaNumber, name: this.area.name,
                    strength: this.roster.strength, fallen: this.roster.fallen.length });

    if (this.lastArea) {
      this.world?.notify?.('THE ADVANCE IS OVER', `${this.roster.strength} of ${this.roster.all.length} walked off Geonosis`);
      this.mustering = false;
      return;
    }

    this.areaIndex++;
    this.areaWaves = 0;
    this.mustering = true;
    const offer = this.musterOffer();
    this.world?.notify?.(`${AREAS[this.areaIndex - 1].name.toUpperCase()} — HELD`,
      `${this.roster.points} reinforcement points · ${this.roster.strength} standing`);
    if (this.onMuster) this.onMuster(offer);
    else {
      // No screen wired: muster for the player and press on, rather than
      // stopping a campaign on a UI that does not exist yet.
      this.autoMuster();
      this.closeMuster();
    }
  }

  /** The muster screen is done. Deploy the new roster and start the area. */
  closeMuster() {
    if (!this.mustering) return false;
    this.mustering = false;
    this.deploy();
    this.world?.notify?.(this.area.name.toUpperCase(), this.area.brief);
    this.intermission = 4.0;
    return true;
  }

  /**
   * WHAT THE CAMPAIGN LOOKS LIKE FROM OUTSIDE — the HUD's readout and the run
   * summary's, derived so the two cannot disagree.
   */
  readout() {
    const F = FORMATIONS[this.formation] || FORMATIONS[DEFAULT_FORMATION];
    return {
      army: this.army.name,
      foe: this.foe.name,
      area: this.areaNumber,
      areas: AREAS.length,
      areaName: this.area.name,
      waveInArea: this.areaWaves,
      areaWaves: this.area.waves,
      formation: F.id,
      formationName: F.name,
      mustering: this.mustering,
      teamDamage: this.teamDamage,
      ...this.roster.summary(),
    };
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
 * src/ui/HUD.js
 *   · THE ROSTER. `CommandDirector.readout()` is the whole feed: army, area,
 *     formation, and a `roll` of `{name, unit, rank, rankTitle, xp, kills,
 *     areas, alive, diedIn}`. It wants a column down one edge with the living
 *     above the fallen, the rank colour as a chip (RANKS[i].color), and the
 *     dead struck through — the casualty list is the point.
 *   · A FORMATION INDICATOR. `readout().formationName`, and the six ids are in
 *     `FORMATIONS`.
 *   · Hook: `world.director.onRoster = (summary) => hud.setRoster(summary)`.
 *
 * src/ui/Menu.js
 *   · A MODE CARD for `command`, off `MODES.command` — it already carries
 *     `fixedTheatre`, so the Theatre column will grey itself out with the
 *     mode's own sentence beside it (menu.mjs drives exactly this).
 *   · A TEAM DAMAGE slider writing `settings.teamDamage`, 0..1, default 0.35.
 *     `commandConfig` is the reader and is the only thing allowed to interpret
 *     it.
 *
 * src/ui/Screens.js
 *   · THE MUSTER. `director.onMuster = (offer) => screens.muster(offer)`, and
 *     the screen calls `director.recruit(type)` per purchase and
 *     `director.closeMuster()` when done. `musterOffer()` is already the exact
 *     shape a screen wants — units with cost, threat, how many you have and
 *     whether you can afford one. Until it exists the director musters for the
 *     player automatically, so nothing is blocked.
 *
 * src/engine/Bindings.js
 *   · SIX ORDER KEYS. `FORMATIONS[*].key` names the code each one wants
 *     (Digit6-Digit0 and Minus). They are read as raw key codes in main.js
 *     today, which means they are not rebindable and do not appear on the
 *     controls card. Six ACTIONS rows under a "Command" group, ids
 *     `form.circle` … `form.charge`, is the whole change.
 */
