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
import { nudgeFromSwing, bladeClear, placementClear, SWING_REACH } from './Spawn.js';
import { MORALE } from './Morale.js';
import { applyLevy } from './Levy.js';
import { shakeNerve } from './Nerve.js';
import { findCasualty, startDrag } from './Reactions.js';
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
    /** Two commanders on one field, rather than one against the composer. */
    this.versus = !!cfg.versus;
    /** How many bodies the opening muster enlists. A campaign opens with
     *  `OPENING_STRENGTH`; a contingent opens with what the player asked for. */
    this.opening = clamp(opts.strength ?? OPENING_STRENGTH, 1, MAX_STRENGTH);
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
    this.unit = this.campaign ? 0 : (opts.unit ?? cfg.unit);
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
    return all.filter((_, i) => i % peers.length === mine);
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
    return Math.floor(super.budgetFor(wave) * area * this.allyScale());
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
    return applyLevy(super._composeUnder(wave, keys), this, wave);
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
  _musterOpening(c = this.commander) {
    const tiers = c.army.tiers;
    const cheapest = tiers[0].type;
    if (this.campaign) {
      /* `this.opening` and not `OPENING_STRENGTH`: a campaign's opening IS the
       * constant and says so in the constructor. One loop, one authority. */
      for (let i = 0; i < this.opening; i++) c.roster.enlist(cheapest);
      c.roster.points = this.stages[0].muster;
      c.lineup = c.roster.living.map((t) => t.type);
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
    c.roster.points = this.opening * musterCost(cheapest);
    const want = this.unit >= 0 ? tiers[Math.min(this.unit, tiers.length - 1)] : null;
    this._bulk = true;
    try {
      if (want && c.roster.points < want.cost) {
        /**
         * A REQUEST THAT CANNOT BE MET SAYS SO. The player asked for a
         * contingent of AT-TEs and set the size to one, which is 5 points
         * against 32: there is a right answer (the line) and there is no
         * honest way to hand it over in silence. Same law as `reinforce`'s NO
         * REINFORCEMENTS and `deploy`'s NO GROUND below — the three places
         * this mode can fail to give the player what they asked for are the
         * three places it says so out loud.
         */
        this.refused = `${ARCHETYPES[want.type]?.label ?? want.type} costs ${want.cost} points and `
          + `${this.opening} ${c.army.unit}${this.opening === 1 ? '' : 's'} buys ${c.roster.points}`;
        this.world?.notify?.('CONTINGENT UNCHANGED', this.refused);
      } else if (want) {
        while (this.recruit(want.type, c));
      }
      /**
       * THEN THE LINE, AND THEN THE BEST THING LEFT ON THE SHELF — which is
       * `autoMuster`'s two-phase spend, reached through the same
       * `_bestAffordable` it uses, because "spend a purse sensibly" is one
       * question and this file is not going to answer it twice.
       *
       * For a CHOSEN rung these two loops are what stops the remainder being
       * thrown away, and the machine is where it shows: ten Republic allies is
       * 50 points, one AT-TE is 32, and the 18 left over buy three clone
       * troopers to walk beside it. Without them the player would have asked
       * for ten men and been handed one walker and a dead 18 points.
       *
       * For `CONTINGENT_MIXED` they ARE the composition — half the purse on the
       * line, the rest on the heaviest rungs it will carry — measured, that is
       * five clone troopers, an officer and a jet trooper for 47 of 50 points
       * at ten Republic allies, and five B1s and a MagnaGuard for 29 of 30 at
       * ten Confederate ones.
       */
      const line = want ? this.opening : Math.max(1, Math.floor(this.opening / 2));
      for (let i = 0; i < line && this.recruit(cheapest, c); i++);
      for (let guard = 0; guard < MAX_STRENGTH; guard++) {
        const best = this._bestAffordable(c);
        if (!best || !this.recruit(best, c)) break;
      }
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
      next: this.stages[Math.min(this.areaIndex + 1, this.stages.length - 1)],
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
      if (air && air.request(t.type, null, null, Math.PI / 2, enlist, { kind: 'dropship', near: 18, cap: 6 })) {
        this._inbound.add(t); n++; continue;
      }
      const e = w.spawnEnemy(t.type, _v2);
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
    if (c === this.commander) this.onOrder?.(F, this.squadsOf(c).length);
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
    const F = FORMATIONS[c.formation] || FORMATIONS[DEFAULT_FORMATION];
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
    const F = FORMATIONS[c.formation] || FORMATIONS[DEFAULT_FORMATION];
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
    const limit = fighting ? this.leashFor(F, e) : FORM_TOLERANCE;
    if (d <= limit) {
      /* ON HIS MARK. Fighting from it is the whole job; NOT fighting from it is
       * a man standing in the open with nothing to do, and that is 54-63% of
       * the frames in every standing formation. See `_holdPost`. */
      if (fighting) { e.idleT = 0; this._crouch(e, dt, 0); }
      else this._holdPost(e, dt);
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
    /* THE FIRST ENGAGEMENT'S LEDGER OPENS HERE — the other door into one, the
     * first time round. `closeMuster` is the door for every area after it. */
    this._logAt = this.log.length;
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
    /* A SIDE WHOSE COMMANDER HAS GONE IS STILL A SIDE, AT ZERO. The paragraph
     * above is why, and `dismissCommander` is what fills this set — the
     * Commander itself is gone from the list, which is the whole point, so the
     * side it held has to be remembered somewhere else or it stops existing. */
    for (const s of this._departed) { standing[s] = standing[s] || 0; health[s] = health[s] || 0; }
    for (const c of this.commanders) {
      const s = c.side;
      standing[s] = standing[s] || 0;
      health[s] = health[s] || 0;
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
    const squads = this.squadsOf(c);
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
          let near = false, presence = 0;
          if (jedi?.position) {
            const w = share(dist2(e.position, jedi.position));
            if (w > 0) { presence += MORALE.JEDI_NEAR * w; near = true; }
          }
          if (lead && lead !== t && lead.body && !lead.body.dead) {
            const w = share(dist2(e.position, lead.body.position));
            if (w > 0) { presence += MORALE.LEADER_NEAR * w; near = true; }
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
          if (!near) d += MORALE.ALONE;
          if (e.maxHp && e.hp < e.maxHp * 0.34) d += MORALE.WOUNDED;
        } else {
          // between areas, or waiting on a gunship: nerve comes back
          d += MORALE.RALLY_PER_S;
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
      if (this.lineIsUp()) this._areaClear();
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
  lineIsUp(c = this.commander) {
    if (!this.lineAdvances) return true;
    const p = c?.player;
    /* No body to measure from — a headless director, or a commander who has
     * fallen — cannot hold the ground open. `census`'s note argues the same
     * for orders: losing your general costs you your orders, not the battle. */
    if (!p || !p.position) return true;
    const living = (c?.roster?.living) || [];
    let alive = 0, near = 0;
    const r2 = MORALE.NEAR * MORALE.NEAR;
    for (const t of living) {
      const e = t.body;
      if (!e || e.dead) continue;
      alive++;
      if (dist2(e.position, p.position) <= r2) near++;
    }
    /* An army that no longer exists cannot come up, and a run that waited for
     * it would hang instead of ending. `_checkLine` is the door for that. */
    if (!alive) return true;
    return near * 2 >= alive;
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
      const p = t.award(2);
      if (p) this._promoteTrooper(t, t.body);
    }
    // Holding a whole area is the biggest thing that happens to a line's nerve.
    for (const c of this.commanders) this.shake(null, 'AREA_HELD', c);
    this.roster.points += this.area.muster;
    /* HOLDING GROUND IS WHAT EARNS A FLEET'S ATTENTION. The largest single
     * credit on the table — see SUPPORT_EARN. */
    this.world?.support?.credit('area');
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
          /* The DEPLOYMENT seed, not the wave's: one ground, one sitting, one
           * seed — §5. `runSeed` is what the deploy card printed. */
          seed: w.runSeed ?? w.settings?.seed ?? 1,
          log: w.craterLog ?? null,
          air: w.smokeAir ?? null,
        });
        did += (out?.barrage | 0) + (out?.smoke | 0) + (out?.wrecks | 0);
      } catch (err) {
        /* A DRESSING THAT THREW MUST NOT TAKE THE ENGAGEMENT WITH IT. This runs
         * on the frame a muster closes and the next area opens; a level with no
         * terrain features to site a wreck on is a worse picture, not a broken
         * run. Reported once rather than swallowed, because a front that
         * silently stops advancing is the defect this whole system exists to
         * make visible. */
        if (!CommandDirector._warnedMarch) {
          CommandDirector._warnedMarch = true;
          console.error('marchFront failed for engagement', e, err);
        }
      }
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
      squads: this.squadsOf(c).length,
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
