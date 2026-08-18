/**
 * BATTLEFRONT BORZ — wave director and run boons.
 *
 * Waves are budgeted, not scripted: the director spends a threat budget on
 * whatever the level allows, so the composition changes every run and the
 * pressure curve stays honest. Every other wave the Force offers a choice —
 * runs are built, not saved.
 *
 * ── depth, not breadth ────────────────────────────────────────────────────
 *
 * Escalation used to be one number. `budgetFor` grew, a fixed unlock ladder
 * added a type every few waves and then stopped at wave 12, and that was all
 * depth ever changed — so a wave-25 trooper was a wave-2 trooper and wave 25
 * was wave 10 with more bodies. Three things carry it now, and each one has a
 * derivation written next to it rather than a number that felt right:
 *
 *   MODIFIERS   Enemy.MODIFIERS — elite variants applied on spawn, unlocking
 *               with depth and PAID FOR out of the same budget, so an elite
 *               wave is a wave of fewer, nastier bodies rather than a wave that
 *               is secretly three times the threat. See `_promote`.
 *   A BODY CAP  `bodyCap` — the count saturates around wave 18 and everything
 *               the budget can still afford goes on quality instead. At wave 30
 *               the budget is twenty-eight times wave 2's and a wave is 15-43
 *               bodies depending on what the theatre charges for one, against a
 *               wave-18 count of 11-29 on the same ten theatres.
 *               (This sentence used to say "the body count is eight", and the
 *               shipped composer fielded 38-54. It was not a rounding error: the
 *               cap it describes never bound at any depth a player reaches. See
 *               BODY_COUNT_SHARE, which is the fix and the measurement.)
 *   A LADDER    `isBossWave` is a modulus, not a Set that ended at 30, and the
 *               set-piece is a share of the wave rather than one fixed unit.
 *   RUN RULES   …and the player sets the terms. The six conditions below were
 *               dealt to 27% of waves, one at a time, never in combination
 *               before wave ~92. They are also a choice made before Ignite now,
 *               in force from wave 1 and never charged. See the RUN RULES block.
 *
 * And the player grows with it: forty boons drafted every second wave, weighted
 * by rarity that moves with depth, with six masteries gated on already having
 * committed to an axis. `budgetFor`'s one constant is derived from that draft
 * rate, because the two are one decision.
 *
 * (Those two counts said "twenty-nine" and "five" for a long time while the
 * table grew to forty and six. A count written in prose beside a list is the
 * same defect as a card that promises what it does not do, and it is the one
 * this codebase keeps having — so tools/checks/claims.mjs now reads these two
 * sentences and counts the arrays, and they cannot drift apart again.)
 */

import * as THREE from 'three';
import { ARCHETYPES, MODIFIERS, MODIFIER_KEYS, modifierThreat, modifiersFor, applyModifier, enemyRng } from './Enemy.js';
import { duelRng } from './Duel.js';
import { segmentSegment } from '../physics/Physics.js';
import { ArrivalDirector, seedArrivals } from './Arrivals.js';
/* The one table in the game that says which side a body fights for. It imports
 * nothing, deliberately — see its header — so this edge costs no cycle and no
 * canvas. */
import { FACTIONS, factionOf } from './Databank.js';
import { makeRng, clamp, lerp, TAU } from '../engine/MathUtil.js';

const rng = makeRng((Math.random() * 1e9) | 0);

/**
 * Put the wave stream on a stated number.
 *
 * `Run.seed` says of itself "the seed EVERYTHING random in this run derives
 * from, so a run is a shareable number rather than an unrepeatable accident",
 * and nothing read it: the field was generated, carried across every landing
 * and handed to `summary()`, while the only construction of a wave stream in
 * the game was the `Math.random()` above, drawn once at module load. Two runs
 * on the same seed composed different waves, which makes the stated property
 * false rather than merely unimplemented.
 *
 * PER RUNG, not per run, and that is the whole subtlety: a rung builds a fresh
 * World and a fresh director, so seeding with the run's number alone would
 * replay the intake's waves in the foundry, in the cut and in the deeps. The
 * rung index is mixed in with the golden-ratio constant Knuth's multiplicative
 * hash uses, so four rungs of one run are four decorrelated streams and the
 * whole descent is still one number.
 *
 * @returns the 32-bit state actually installed, so a caller can record it.
 */
export function seedWaves(seed, rung = 0) {
  const s = (Math.imul((seed | 0) ^ Math.imul(rung | 0, 0x9E3779B9), 0x85EBCA6B) >>> 0) || 1;
  rng.seed(s);
  return s;
}

export const MODES = {
  /**
   * THE TRIAL OF WAVES WAS PATH OF THE BLADE WITH THE REWARD LOOP DELETED.
   *
   * Measured with a fresh RNG stream per mode, ten seeds over forty waves:
   * **0 of 400 waves differed.** `_compose` never read the mode except in the
   * duel branch, so the only thing that told the two apart was `DRAFT_MODES`,
   * which takes the cards AWAY. A mode whose entire content is the absence of
   * another mode's content is a menu entry, not a game.
   *
   * Two things make it a mode now, and both are DERIVED rather than declared:
   *
   *   THE RAMP IS SMALLER, because `budgetFor`'s exponent is derived from the
   *   draft rate — its own note says BOON_POWER and DRAFT_EVERY "are not
   *   independent, and moving one without the other is how a difficulty curve
   *   drifts". A mode that drafts NOTHING was being charged ×1.27 at wave 30
   *   for cards it never got. `budgetFor` reads `this.drafts` now, so the
   *   correction is the existing rule being called rather than a second curve.
   *
   *   THE CONDITIONS ARRIVE EARLY AND OFTEN, because they are what this mode
   *   has instead of a build. Path of the Blade escalates by making the PLAYER
   *   bigger; the Trial escalates by changing the QUESTION, from wave 4 rather
   *   than wave 13 and every other wave rather than every third. See TRIAL.
   *
   * The Insight and the Living Force are untouched and were never gated on the
   * draft: `World._earnInsight` hangs off the wave-clear signal in every mode,
   * so the tree is the Trial's whole progression and always has been.
   */
  waves: {
    name: 'Trial of Waves',
    blurb: 'Endless escalation, and no cards to soften it. The Force sets the terms of every second wave; '
      + 'what you build, you build in the Holocron.',
  },
  roguelite: { name: 'Path of the Blade', blurb: 'Waves, boons and a run that ends when you do.' },
  /**
   * THE BLURB IS A CLAIM, AND IT USED TO BE THE ONLY TRUE THING HERE.
   *
   * "Acolytes only" was accurate: `_compose`'s duel branch pushed
   * `min(1 + floor(w/2), 6)` acolytes and nothing else, forever. Sixty waves
   * over twelve seeds produced fifteen distinct compositions and one enemy
   * type, while `Duel.js` sat there with five authored forms and a thousand
   * lines of blade-lock nothing in the mode ever asked for. See
   * `WaveDirector.duelRoster` for what replaced it and why the ladder is
   * derived from the roster rather than typed.
   *
   * The sentence now names the SHAPE — a ladder, a new form every DUEL_RUNG,
   * a boss at the top — because `tools/checks/claims.mjs` parses this string
   * and holds the mode to it, and a claim about one archetype is not a claim
   * anybody can keep once the mode has eight.
   */
  duel: {
    name: 'Duel',
    blurb: 'No blasters, no crowd. A ladder of duellists — a new form every 3 waves, and a master at the top.',
  },
  // THE DESCENT IS GONE, and the reason is not that the ladder was broken —
  // it worked. Three of its four rungs were the three interiors the player
  // named as the worst rooms in the game, so the mode's whole content was the
  // content being deleted. A ladder is only as good as the rooms on it.
  sandbox: { name: 'Sandbox', blurb: 'You set the numbers. However many droids you say, firing as slowly as you say — including none of either.' },
  /**
   * TRAINING WAS PINNED TO ONE ROOM.
   *
   * The eleven lessons are the only way this game teaches its control scheme,
   * and the only way to reach them was to pick the level called "The Dojo" —
   * an octagonal hangar with a flat floor. So you could learn to return a bolt
   * indoors and had no way at all to practise it on a dune face, in a blizzard,
   * or on the slope you actually keep dying on. The lessons never needed the
   * room: `DojoDirector` places its remotes, dummies and sparring partner
   * relative to the PLAYER, spawns through the world's own `spawnEnemy`, and
   * reads nothing whatever off the level.
   *
   * So training is a MODE now, and the level list beside it is live: every
   * theatre in the game can be a dojo. World.loadLevel takes this branch
   * exactly as it takes the level's own `training` flag — see the wiring note
   * there. (The dojo itself has since been deleted, which this paragraph used
   * to describe as still present. Nothing was lost with it: the room was the
   * one thing the lessons never read.)
   */
  training: { name: 'Training', blurb: 'The eleven lessons, in whatever theatre you choose. Nothing here can kill you.' },
  /**
   * COMMAND — the one mode where you are not alone.
   *
   * Player note #21: "a mode or setting where you command and lead your own
   * troops … a Sith leading droids or a Jedi leading clone troopers." The whole
   * of it lives in src/game/Command.js; what belongs HERE is the two things the
   * front end reads off a mode, and one of them is load-bearing.
   *
   * `fixedTheatre` IS THE LOAD-BEARING ONE. This mode owns its ground — there is
   * one Geonosis and the campaign is a crossing of it — and the Theatre column
   * in the menu is therefore not the player's to choose. The Descent was the
   * last mode with that property and it did not declare it: all thirteen level
   * cards stayed live, wrote `settings.level`, saved it, and the write LEAKED
   * into the next run of another mode, so the level the player picked turned up
   * somewhere they did not. `Menu._syncTheatre` reads this field and greys the
   * column with this exact sentence beside it; `tools/checks/menu.mjs` drives
   * the real front end through a mode carrying one, and its own note names
   * Command as the mode that would otherwise walk straight back into it.
   *
   * The DIRECTOR is not named here. `World.loadLevel` picks `CommandDirector`
   * off the mode string, and Command.js imports this file — so a reference in
   * the other direction would close a cycle through Enemy.js, Dojo.js and
   * Player.js, all of which already import Waves.js. See the header of
   * Command.js for the full trace.
   */
  command: {
    name: 'Command',
    blurb: 'Lead an army across Geonosis. Your troops have names, they earn rank, and when they die they are gone.',
    fixedTheatre: 'Command is fought on Geonosis: five areas, one crossing, and the ground does not change.',
    /**
     * THE ONLY MODE THAT CAN BE A MEETING — and this field is what stopped a
     * Command option from emptying two other modes.
     *
     * `commandConfig`'s `versus` says "the other army is a PERSON's, deployed
     * rather than composed", and `CommandDirector.start` implements that by not
     * composing a wave at all. `World.loadLevel` builds a CommandDirector for
     * `command`, `skirmish` AND `campaign`, and `commandConfig` reads a global
     * settings key, so a player who ticked the meeting box in Command and then
     * started a Skirmish got a battle with no opposing army: measured on
     * geonosis, the opening spawn queue goes 8 bodies → 0 in all three modes.
     * A campaign mission with nothing in it clears itself.
     *
     * A meeting needs a second COMMANDER, and only this mode has one. That is a
     * fact about the mode, so it is written on the mode rather than as a list
     * of mode names inside `commandConfig` — the fourth mode that leads an army
     * then declines the meeting by saying nothing, which is the safe way round.
     */
    meeting: true,
    /**
     * THE GROUND, AS A FIELD SOMETHING CAN READ.
     *
     * `fixedTheatre` above is PROSE. The menu greys the Theatre column and
     * prints that sentence, and for the whole life of this mode nothing on the
     * load side read it — `deploy()` took the player's last-picked level and
     * `World.loadLevel` honoured it. `DEFAULT_SETTINGS.level` is `'scoria'`, so
     * the default path (fresh profile → Command → Ignite) **deployed the army
     * onto the Ember Shelf while the menu said Geonosis**, and the HUD printed
     * "The Ember Shelf — The Landing Zone".
     *
     * It was not only wrong scenery. `CommandDirector` is constructed with the
     * loaded level's own pool, so the Geonosis roster — all seven Command units
     * and all four machines — was replaced by scoria's twelve Jedi and droids.
     * The mode's entire reason to exist was unreachable by any normal route.
     *
     * A mode that owns its ground now SAYS SO in a field, and `deploy()` reads
     * it. Prose is for the player; this is for the code.
     */
    level: 'geonosis',
  },
  /**
   * SKIRMISH — the one run in this game that can be WON, anywhere.
   *
   * Player note #46: "a mode where you pick the map, the sides, the army sizes
   * and the rules, and fight a self-contained battle that ends in a win or a
   * loss — as opposed to the endless wave survival". Every word of that is a
   * thing the shipped game did not have, and the reason is worth stating
   * because it decides what this mode is ALLOWED to be:
   *
   *   THE ENDLESS MODES CANNOT BE WON BY CONSTRUCTION. `roguelite` and `waves`
   *     end when `_checkWipe` finds every player down. `won` is a field
   *     `Progress.recordRun` has always read and that nothing in the tree ever
   *     set until Command's campaign arrived.
   *   COMMAND CAN BE WON AND OWNS ITS GROUND. `fixedTheatre` above is not
   *     decoration — the campaign is a crossing of one planet, its five AREAS
   *     are Geonosis by name and brief, and `_endCampaign` says so out loud.
   *     So "a battle you can win, on the map you picked" cannot be a Command
   *     setting; it is the mode Command is not.
   *   THE DUEL IS ONE BODY AGAINST ONE BODY. It is a ladder, not a battle.
   *
   * SO: A SKIRMISH IS A COMMAND ENGAGEMENT WITH THE CAMPAIGN TAKEN OFF IT. You
   * lead an army — the same `CommandRoster`, the same ranks, the same
   * permadeath, the same formations and orders — against a force the ordinary
   * composer builds out of the level's own pool at a stated pressure, under the
   * run's chosen CONDITIONS. It is a stated number of engagements long, it ends
   * in a win when the last one is cleared, and it ends in a loss the way every
   * other mode does.
   *
   * NOTHING HERE IS A SECOND COPY OF ANYTHING. The army is Command's, the
   * pressure ladder is Command's `AREAS`, the wave is the composer's, the rules
   * are `CONDITIONS`, the ground list is `LEVEL_ORDER`, the defeat is
   * `_checkWipe`'s and the report is `onGameOver`'s. What this mode adds is the
   * three decisions none of them makes: how long, how big, and where — and
   * `where` is a list rather than a single answer, which is `rotates` below.
   *
   * `rotates` IS THE MACHINE-READABLE HALF OF "THE GROUND CHANGES", in exactly
   * the sense `MODES.command.level` is the machine-readable half of
   * `fixedTheatre`. That note records what it cost to have the sentence and not
   * the field: the menu said Geonosis and the army deployed onto the Ember
   * Shelf. So a mode whose ground moves says so in a field that `World` reads,
   * and the Theatre column stays live because the player's pick is still real —
   * it is round one, and `Levels.levelRotation`'s `first` is what makes it so.
   */
  skirmish: {
    name: 'Skirmish',
    blurb: 'One battle, fought over changing ground. You lead an army, they field one, '
      + 'and it ends in a victory or a defeat — not in a high score.',
    rotates: true,
    /* THE MACHINE-READABLE HALF OF "IT ENDS". `World.update` opens a bounded
     * battle on the first frame for any mode carrying this, so the mode is
     * playable through a front end that has never heard of it — the same
     * position `CommandDirector._areaClear` takes about its muster screen, and
     * for the same reason. It is a field rather than a mode-name test because
     * `campaign` below is the second mode with the property and there will be
     * more; a list of mode names in World.js is the twin defect. */
    battles: true,
  },
  /**
   * CAMPAIGN — the same battle, in an order somebody chose.
   *
   * Player notes #21 and #47 ask for two campaigns, and the second sentence of
   * each is the same question: what makes a sequence of fights a campaign
   * rather than a playlist. `Levels.CAMPAIGNS` is the answer and its own note
   * gives it in three parts — the order is authored, every ground carries a
   * brief, and the shape of the battle is part of the mission rather than a
   * multiplier over it.
   *
   * WHAT THIS MODE IS NOT is the more useful half. It is not Command: Command
   * is FIVE AREAS ON ONE GROUND, declares `level: 'geonosis'`, and its whole
   * subject is a roster of named people who die permanently across a crossing.
   * A campaign is ONE BATTLE ON EACH OF SEVERAL GROUNDS, and its line is raised
   * for each — because names that persist are Command's idea and a second copy
   * of it here would make the two modes the same mode with different map
   * lists. What DOES carry between missions is the RUN: the build, the Insight,
   * the score and the wave the escalation has reached, all of it through
   * `World.rotateTo`, which is the same door the skirmish rotation uses.
   *
   * NO `fixedTheatre` AND NO `level`, and that is load-bearing rather than an
   * omission. The Theatre column IS the campaign picker: a campaign opens on a
   * ground, the player already picks a ground, and `Levels.campaignAt` maps one
   * to the other. Greying the column would leave the mode with two campaigns
   * and no way to say which.
   */
  campaign: {
    name: 'Campaign',
    blurb: 'A named sequence of battles on chosen ground, with a brief on each and an ending. '
      + 'The theatre you pick is the campaign you play.',
    rotates: true,
    battles: true,
  },
};

/* ══════════════════════════════════════════════════════════════════════ */
/*  Sandbox                                                               */
/* ══════════════════════════════════════════════════════════════════════ */

/**
 * Practice was impossible because nothing in the game let you turn the horde
 * DOWN. The lowest difficulty still opens with a wave budget and every unit in
 * it shooting at its archetype cadence, so there was no way to stand in front
 * of one B1 and learn what a returned bolt feels like.
 *
 * The sandbox replaces the wave director's budget with two numbers the player
 * owns: how many enemies are alive, and how fast they shoot. Both go to zero,
 * because an empty arena to move around in is a legitimate practice setting and
 * so is a room full of droids that never pull a trigger.
 */
export const SANDBOX_MAX_ENEMIES = 40;

/**
 * How far out the sandbox drops a new opponent.
 *
 * Close enough to be fighting seconds after moving the slider, far enough that
 * a droideka does not materialise inside your guard. A training droid does not
 * come to you at all — speed 0 — so it goes where you can reach it.
 */
const SANDBOX_RING = [11, 19];
const SANDBOX_RING_INERT = [4.5, 8];

/**
 * A PREFERENCE ORDER, NOT A GUEST LIST — and it used to be the second thing.
 *
 * `sandboxUnits` says of itself, twenty lines down, that it is "built from
 * ARCHETYPES rather than typed again, so a new droid shows up here the day it
 * is added instead of the day someone remembers this list exists". It then
 * filtered ARCHETYPES through this array, which makes this array the membership
 * test and the sentence false. Nobody remembered the list existed: it was
 * already missing `bodyguard`, `charger` and `stalker`, and the roster has
 * since grown from fourteen archetypes to twenty, so NINE OF TWENTY enemies
 * could not be spawned in the one mode whose entire purpose is spawning an
 * enemy of your choosing and practising against it.
 *
 * This is the seventh time this codebase has been bitten by a hand-maintained
 * table beside a generated one — a HUD price list, an announcer voice map, this
 * same list, a level card's unit count, a garment length, a wire record and now
 * this. The shape of the fix is always the same: the hand-written thing must
 * stop being the authority. It is a SORT KEY now. Everything authored here
 * keeps the order it was authored in — the practice dummies first, then the
 * things that hurt — and anything registered later is appended by its own
 * threat, so a new body lands in the list on the day it is added and lands in
 * roughly the right place too.
 */
const SANDBOX_ORDER = ['remote', 'dummy', 'sparring', 'b1', 'trooper', 'b2', 'sniper', 'droideka', 'acolyte', 'walker', 'beast'];

/**
 * Every archetype, authored ones first and the rest by threat. Lazy for the
 * same temporal-dead-zone reason `sandboxUnits` is — see the note there.
 */
function sandboxKeys() {
  return [
    ...SANDBOX_ORDER.filter((k) => ARCHETYPES[k]),
    ...Object.keys(ARCHETYPES).filter((k) => !SANDBOX_ORDER.includes(k))
      .sort((a, b) => (ARCHETYPES[a].threat ?? 0) - (ARCHETYPES[b].threat ?? 0)),
  ];
}

/** What the dojo's "mixed" room rotates through — one of each, then repeat. */
export const DOJO_MIX = ['remote', 'dummy', 'sparring'];

function unitBlurb(A) {
  const how = A.inert ? 'stands still and takes it'
    : A.melee ? 'blade'
    : A.custom === 'remote' ? 'one slow bolt at a time'
    : 'blaster';
  return `${how} · ${A.hp} hp · threat ${A.threat}`;
}

/**
 * The archetype picker's rows. Built from ARCHETYPES rather than typed again,
 * so a new droid shows up here the day it is added instead of the day someone
 * remembers this list exists.
 *
 * Lazy, and that is not a style choice. Enemy.js imports Dojo.js (for the
 * remote's body) and Dojo.js imports this file, so whenever Enemy.js is the
 * module that starts the cycle — which is what World.js does, importing
 * Enemy.js one line before Waves.js — this file finishes evaluating while
 * ARCHETYPES is still in its temporal dead zone. Reading it at the top level
 * here is a ReferenceError on boot, not a warning.
 */
let _units = null;
export function sandboxUnits() {
  if (_units) return _units;
  _units = [
    { key: 'mixed', name: 'Mixed', blurb: 'Whatever this theatre fields, in the proportions it fields it.' },
    ...sandboxKeys().map(k => ({
      key: k, name: ARCHETYPES[k].label, blurb: unitBlurb(ARCHETYPES[k]),
    })),
  ];
  return _units;
}

/**
 * DOES THIS PLAYER WANT BODIES TO SIMPLY APPEAR?
 *
 * The one reader of the one setting, so "should this spawn be announced" has a
 * single answer in the whole tree rather than a `settings.instantSpawn` test at
 * each of the three places that spawn something. Defaults FALSE — see the note
 * on `arrivals.enabled` in the director's constructor.
 */
export function instantSpawn(settings) {
  return !!(settings && settings.instantSpawn);
}

/** Read the practice knobs off a settings blob, clamped and defaulted. */
export function sandboxConfig(settings) {
  const s = settings || {};
  const raw = s.sandboxCount;
  const count = clamp(Math.round(typeof raw === 'number' && isFinite(raw) ? raw : 5), 0, SANDBOX_MAX_ENEMIES);
  const f = s.sandboxFire;
  const fire = clamp(typeof f === 'number' && isFinite(f) ? f : 1, 0, 2);
  const t = s.sandboxType;
  return { count, fire, type: (t === 'mixed' || ARCHETYPES[t]) ? t : 'mixed' };
}

/* ═══════════════════════════════════════════════════════════════════════ */
/*  Skirmish                                                              */
/* ═══════════════════════════════════════════════════════════════════════ */

/**
 * HOW LONG A BATTLE IS, AND HOW BIG.
 *
 * Only the numbers this module can honestly own are here, and the split is
 * forced rather than chosen: `Command.js` imports this file for `WaveDirector`,
 * so this file may not import `Command.js` — the edge would close a cycle and
 * run `ARCHETYPES`' consumers inside its own temporal dead zone (the header of
 * Command.js records that being tried). `MAX_STRENGTH`, `OPENING_STRENGTH`,
 * `musterCost` and `AREAS` therefore cannot be seen from here, and the clamps
 * that need them are applied by the one caller that can see them,
 * `World.beginSkirmish`. `MODES.command.level` already lives with the same
 * split for the same reason.
 *
 * `engagements` — how many waves the battle is. 1 is a single stand-up fight;
 *   the ceiling is 9 because past that a "self-contained battle" is an endless
 *   mode with a stopping rule bolted on, which is the thing this mode exists
 *   instead of. Three is the default because three grounds is enough for the
 *   rotation to be the point and short enough to finish in one sitting.
 *
 * `strength` — the size of YOUR line, in bodies. Clamped here only against
 *   zero; `World` clamps it against Command's own `OPENING_STRENGTH` floor and
 *   `MAX_STRENGTH` ceiling, which are the numbers the muster is actually built
 *   around. The default is 0, meaning "whatever the campaign opens with", so a
 *   battle nobody sized fields the line Command gives them.
 *
 * `pressure` — which rung of Command's own advance this battle is fought at,
 *   as an index into `AREAS`. That table already carries a budget multiplier, a
 *   heavy bias, a length and a reinforcement purse per rung, all of them tuned;
 *   inventing a second difficulty ladder beside it is the defect this file has
 *   a section of HANDOFF about. Clamped in `World` against `AREAS.length`.
 *
 * The RULES are not a pick at all, and that is the point: a skirmish is fought
 * under the run's own rules — the same CONDITION keys every other run is fought
 * under, read off the settings by `WaveDirector`'s constructor through
 * `legalRuleSet`, a path that predates this mode and needed no line. There is nothing for this function to add — and because a
 * skirmish COMPOSES its opposing force rather than mustering it, every one of
 * those conditions bites here exactly as it bites in the Trial.
 */
export const SKIRMISH = {
  engagements: { min: 1, max: 9, def: 3 },
};

/**
 * Read the battle's shape off a set of picks, clamped and defaulted.
 *
 * IT TAKES THE PICKS, NOT THE SETTINGS BLOB, and that is the one place this
 * differs in shape from `sandboxConfig`, `commandConfig` and `pvpRules`. Two
 * reasons, and the second is the load-bearing one:
 *
 *   A BATTLE IS STARTED WITH A PLAN. `World.beginSkirmish(picks)` is the only
 *     door into the mode, and a plan handed to it can come from the Deploy
 *     panel, from a check driving a world by hand, from four numbers a player
 *     shares, or one day off the wire. Reading four globals instead would make
 *     the menu the only thing in the game that can ever state one.
 *   A SETTING READ WITH NO DEFAULT IS INVISIBLE TO EVERY OTHER GUARD.
 *     `tools/checks/controls.mjs` scans `src/` for what the shipped code reads
 *     and demands a key in `DEFAULT_SETTINGS` for each — in its own words, "a
 *     guard keyed on the list of things you remembered to declare cannot find
 *     the thing you forgot to declare". The Deploy panel's four controls, their
 *     defaults and their reader declarations are ONE commit across `Menu.js`
 *     and `index.html`; a read here before that commit is an orphan the guard
 *     is right to name. The menu normalises its blob into these four names at
 *     the single call site, which is where the line between a PREFERENCE and a
 *     PLAN belongs anyway.
 *
 * Every field is optional and every default is a real answer, so
 * `skirmishConfig()` with nothing at all describes the shipped battle.
 */
export function skirmishConfig(picks) {
  const p = picks || {};
  const n = (v, d) => (typeof v === 'number' && isFinite(v) ? v : d);
  return {
    engagements: clamp(Math.round(n(p.engagements, SKIRMISH.engagements.def)),
      SKIRMISH.engagements.min, SKIRMISH.engagements.max),
    strength: Math.max(0, Math.round(n(p.strength, 0))),
    pressure: Math.max(0, Math.round(n(p.pressure, 0))),
    /* THE GROUND MOVES UNLESS THE PLAYER SAYS OTHERWISE, and the default is the
     * feature: note #48 is a complaint that it never did. Off is a real thing
     * to want — a player learning one map, or measuring one — so it is a pick
     * and not a law, but the answer to an absent one is yes. */
    rotate: p.rotate !== false,
  };
}

/**
 * Stop an enemy shooting without touching its brain.
 *
 * Every ranged archetype decides to fire the same way — `attackTimer` counts
 * down, hits zero, and queues a burst — so pushing the fuse back up each frame
 * silences a B1, a sniper mid-telegraph, a droideka mid-burst and a training
 * remote with one rule. Zeroing burstLeft matters: a droideka that had six
 * rounds queued when you moved the slider would otherwise finish them.
 */
export function holdFire(e) {
  if (!e) return;
  e.burstLeft = 0;
  e.burstTimer = 0;
  if (!(e.attackTimer > 0.5)) e.attackTimer = 0.5;
  if (e.aimCharge > 0) { e.aimCharge = 0; e._endTelegraph?.(); }
}

/**
 * ARRIVE ON FOOT, THEN TAKE UP A POSITION — note #17's other half.
 *
 * "even in training mode or in any mode, the enemies should not materialize in
 * front of you they should arrive from somewhere not teleport behind you."
 *
 * `ArrivalDirector` answers that for a WAVE: a body is bought, a ship or a gate
 * or a long walk brings it, and `deliveryIsAnnounced` is the property. It cannot
 * answer it for the DOJO, because a lesson needs its remote at a taught distance
 * — "stand six metres from a remote and return one bolt" is the lesson, and an
 * arrival that puts the remote wherever the terrain allowed is a different one.
 *
 * So the body is spawned OUT PAST THE RING and walks to the post the lesson
 * chose. The lesson's geometry is exactly what it was; what changes is that you
 * watch the thing come to you.
 *
 * The seam is `_move`, which is the one frame-accurate gap between "the brain
 * decided where to walk" and "the body walked there" — the same seam
 * `Command.installCommand` steers a formation through, and it is here rather
 * than there because Dojo.js imports this file and importing Command.js would
 * close a cycle through Enemy.js. See the header of Command.js.
 *
 * @param post  a Vector3-shaped destination
 * @param opts.speed  a multiplier while walking in — 1.35 by default, because a
 *              body crossing 40 m of empty ground at its combat pace is eleven
 *              seconds of nothing.
 * @param opts.rest  the speed to restore on arrival. Defaults to the body's own,
 *              and exists for the one case where that is a lie: a training dummy
 *              is `speed: 0`, which means "does not move once it is standing
 *              where it was put" and NOT "cannot walk to its post". It is lent a
 *              pace for the crossing and handed nothing back.
 * @returns true if the walk actually went on.
 */
export function walkIn(e, post, opts = {}) {
  if (!e || !post || e._walkIn) return false;
  const base = e._move;
  if (typeof base !== 'function') return false;
  const tol = opts.tolerance ?? 1.6;
  const boost = opts.speed ?? 1.35;
  const rest = opts.rest ?? e.speed;
  const cruise = e.speed * boost;
  e._walkIn = { post, done: false };
  e._move = function (dt, ctx) {
    const w = this._walkIn;
    if (w && !w.done) {
      const dx = w.post.x - this.position.x, dz = w.post.z - this.position.z;
      const d = Math.hypot(dx, dz);
      if (d <= tol) {
        w.done = true;
        this.speed = rest;
        this.wish = null;
      } else {
        const inv = 1 / (d || 1);
        if (!this.wish) this.wish = new THREE.Vector3();
        this.wish.set(dx * inv, 0, dz * inv);
        // `toTarget` too, or `limitBackpedal` scales the walk-in down to 40%
        // whenever the lesson post happens to sit behind the body's target.
        if (!this.toTarget) this.toTarget = new THREE.Vector3();
        this.toTarget.set(dx * inv, 0, dz * inv);
        this.speed = cruise;
        // Nothing fires on the way in. A remote that opens up at forty metres
        // while it is still crossing is not the lesson either.
        holdFire(this);
      }
    }
    return base.call(this, dt, ctx);
  };
  return true;
}

/** Has this body finished walking in? True for anything that never had to. */
export function arrived(e) { return !e?._walkIn || e._walkIn.done; }

/**
 * Slow an enemy down without silencing it.
 *
 * `DIFFICULTY.fireRate` already divides every ranged archetype's cooldown, so
 * the sandbox scales THAT rather than inventing a parallel cadence — bursts,
 * telegraphs and burst gaps all keep their character, only the gaps between
 * volleys stretch. The training remote is the one brain that reads its own
 * `trainingFireRate` instead of the difficulty, so it gets the same factor
 * applied to its period by hand.
 */
export function tuneFireRate(e, fire) {
  if (!e || fire <= 0) return;
  const A = e.A;
  if (A && A.custom === 'remote') e.trainingFireRate = (A.fireRate ?? 2.0) / fire;
}

/* ══════════════════════════════════════════════════════════════════════ */
/*  The ramp                                                              */
/* ══════════════════════════════════════════════════════════════════════ */

/**
 * The five numbers the escalation is made of, all in one place because they
 * are one decision. See `WaveDirector.budgetFor` for the arithmetic that ties
 * BOON_POWER to DRAFT_EVERY — they are not independent, and moving one without
 * the other is how a difficulty curve drifts.
 */
/** What one average card is worth as a throughput multiplier. */
export const BOON_POWER = 1.05;
/** A draft every this many waves. Was 3; see the note above BOONS. */
export const DRAFT_EVERY = 2;
/**
 * The draft rate the BASE budget polynomial was fitted against.
 *
 * `budgetFor`'s note says it outright: `4 + 2.6w + 0.65w^1.62` was tuned for a
 * run that drew a card every third wave, and `BOON_POWER^((w-1)/6)` is the
 * correction for the extra w/6 cards that moving to DRAFT_EVERY = 2 added. So
 * the curve EVERY mode faces — including the ones that get no multiplier —
 * already assumes a player who has picked up w/3 growth events by wave w.
 *
 * Named because a second reward channel has to be sized against it. The Living
 * Force reads it to derive what the Holocron pays in a mode with no draft at
 * all; see TRIAL_INSIGHT_PER_WAVE.
 */
export const RAMP_CARDS_EVERY = 3;

/**
 * The ceiling on heavy bodies at once, whatever the budget says.
 *
 * A walker is 66 meshes and an acklay is a 2.9-scale rig; this is the one
 * number between a deep wave and a scene the renderer cannot hold, so it is a
 * frame-rate limit rather than a difficulty one and it does not scale with
 * anything.  clamps to it after the party scale.
 */
export const HEAVY_CAP = 10;
/** A set-piece every this many waves — forever, not for the first thirty. */
export const BOSS_EVERY = 5;
/** The modes that hand out boons. See `WaveDirector.drafts`. */
export const DRAFT_MODES = ['roguelite'];
/** How much of a boss wave's budget the set-piece itself is worth. */
export const BOSS_SHARE = 0.28;
/** From here on, the set-piece arrives promoted. */
export const CHAMPION_FROM = 15;

/**
 * The duel ladder's three numbers. See `WaveDirector.duelRoster`.
 *
 * `DUEL_RUNG` is the teaching rate: a new form every three waves, which gives a
 * player two clears to learn what answers the one they just met before the next
 * arrives. `DUEL_PAIR` is far slower because a second blade is a much bigger
 * step than a new form — `DuelBrain` runs per body, so two duellists is two
 * independent parry rhythms — and `DUEL_MAX` is four because past that it stops
 * being a duel and becomes the horde with sabers.
 */
export const DUEL_RUNG = 3;
export const DUEL_PAIR = 6;
export const DUEL_MAX = 4;
/** Where a duellist starts arriving promoted. */
export const DUEL_ELITE_FROM = 8;

/**
 * How wide "one bearing" is, and how hard the director tries to hit it.
 *
 * A quarter of the compass (90°) rather than a line: a wave that arrives on a
 * single ray is a queue, and the point of a front is that it is wide enough to
 * be flanked around. Eight tries because `pickSpawn` draws uniformly, so the
 * chance of missing a 90° window eight times running is (3/4)^8 ≈ 10%, and the
 * best of what was seen is kept in that case rather than nothing.
 */
export const BEARING_ARC = Math.PI / 2;
export const BEARING_TRIES = 8;
/** How many bodies break per frame when a wave's leader falls. See `_rout`. */
export const ROUT_PER_FRAME = 8;
/** Where the body count stops being the escalation. See `bodyCap`. */
export const BODY_MAX = 42;
export const BODY_KNEE = 18;
/**
 * What share of the budget ADDED past the knee may go on more bodies.
 *
 * This replaces `BODY_CREEP = 1.6`, which was 1.6 more BODIES per wave — and
 * the two are not the same kind of thing, which is the whole defect.
 * `bodyCap`'s own note defended the constant with "it creeps at about one body
 * a wave against a budget growing by twelve, which is the whole statement: the
 * extra pressure lands on quality". One body a wave is not one threat a wave:
 * at wave 30 a body costs 8-11 threat, so 1.6 of them is 11-18 threat against a
 * marginal budget of 17.0. Measured through the shipped composer on every level
 * in LEVEL_ORDER plus the checks' own full pool, share of the marginal budget
 * that went on COUNT rather than quality:
 *
 *     foundry 67% · kamino 66% · alpine 70% · colosseum 73% · wood 75%
 *     full pool 79% · drifts 80% · mustafar 85% · geonosis 85%
 *     scoria 96% · temple 108%
 *
 * So the second of the three things this file's header names as carrying depth
 * — "the count saturates around wave 18 and everything the budget can still
 * afford goes on quality instead" — was not happening on any level, and the
 * body cap was not even the binding constraint: composed at waves 12 to 30, the
 * cap was reached on 0-27% of rolls, because the fill ran out of BUDGET long
 * before it ran out of allowance. Wave 30 was wave 12 with four times the crowd
 * exactly as the complaint said, and the guard could not see it because its
 * fixture pool opened cheaper than any shipped level's.
 *
 * A share, not a count, so the constant is in the same currency as the thing it
 * is a share OF and cannot silently mean something else when the roster gets
 * more expensive. A third, because the budget past the knee has three places to
 * go — more bodies, better bodies, and a harder question (`CONDITIONS`) — and
 * the count is the one this file exists to stop being the answer. What the
 * check pins is the PROPERTY, on every real level: the count takes a minority.
 */
export const BODY_COUNT_SHARE = 1 / 3;

/* ══════════════════════════════════════════════════════════════════════ */
/*  The liveness watchdog                                                 */
/* ══════════════════════════════════════════════════════════════════════ */

/**
 * THE WORST BUG ON THE PLAYER'S LIST — note #7, and it ends runs.
 *
 * "a lot of times I was not able to finish a wave because the enemy would not be
 * on the map, like the radar would say I'm right on them but idk maybe they're
 * inside the map but it would keep you from progressing."
 *
 * `update` ends a wave on `!spawnQueue.length && !arrivals.pending && alive ===
 * 0`, so ONE body that cannot be reached and cannot reach you is a run that
 * never advances again. There is no way out of it from inside the game: the
 * contact is on the radar, the wave will not clear, and the only exit is
 * Abandon.
 *
 * ── WHY THE EXISTING HANDLING DOES NOT COVER IT ─────────────────────────
 *
 * `Enemy._move` already has real stuck handling — `_wallN` slides the wish
 * along a face, `_stuckT` commits hard to one side past half a second, and the
 * commit flips at 2.5 s so a body that went the wrong way round a room
 * eventually tries the other. That is LOCAL and it is correct: it resolves a
 * body pressing a doorway, which is what it was written for.
 *
 * It cannot resolve a body that is INSIDE geometry (no face to slide along, no
 * direction that is not into something), one that has fallen THROUGH the world
 * (nothing to walk on, and `_stuckT` never even accumulates because the body is
 * moving — downward), or one outside the heightfield entirely. Those are the
 * three states this report describes, and each of them is an INVALID state
 * rather than a difficult one: there is no legitimate reading of the game in
 * which a live body is 2 m under the terrain.
 *
 * ── WHY IT LIVES IN THE DIRECTOR ────────────────────────────────────────
 *
 * Because the property is the DIRECTOR'S: "a wave that has been paid for must be
 * clearable". An enemy cannot know that its own immobility is blocking a wave —
 * it does not know there is a wave — and the thing that ends waves is the only
 * thing that can be answerable for them ending. It is also the level at which
 * the fix is available: the director owns `arrivals`, which already knows how to
 * put a body somewhere legitimate and is watchable while it does.
 *
 * ── THE LADDER, AND WHY IT IS A LADDER ──────────────────────────────────
 *
 *   RESCUE first, and only then RETIRE. Deleting the body is the easy fix and it
 *   is the wrong first move: it silently removes something the player paid
 *   attention to, and if the cause is a level's geometry it will do it every
 *   wave, forever, invisibly. A rescue puts the body back on ground the level
 *   itself says is valid and lets the fight happen.
 *
 *   NOTHING IS SILENT. Every intervention lands in `this.rescues`, which the
 *   checks read and `tools/trace.mjs` can print. A watchdog that fires without
 *   saying so is a watchdog that hides the defect it exists to survive.
 *
 * The two clocks: a body gets STALL_RESCUE of making no progress and taking no
 * damage before it is moved, and STALL_RETIRE before it is removed. They are
 * long — a real fight has plenty of thirty-second standoffs at a sniper's 42 m
 * preferred range, and a watchdog that teleports a marksman who is doing its job
 * correctly is worse than the bug. An INVALID position skips both clocks, since
 * there is no length of time for which being underground is fine.
 */
/** Seconds of no progress and no damage before a body is put back. */
export const STALL_RESCUE = 14;
/** …and before it is removed so the wave can end. */
export const STALL_RETIRE = 26;
/** Closing this much on the nearest player counts as progress. */
export const STALL_PROGRESS = 1.5;
/** How many times one body may be rescued before it is simply retired. */
export const STALL_RESCUES = 2;

/**
 * IS THIS BODY SOMEWHERE THE GAME CAN LEGITIMATELY PUT IT?
 *
 * Three tests, and each one is an assertion rather than a heuristic:
 *
 *   under the ground   the terrain is a heightfield and every body in this game
 *                      stands on it. 2 m of tolerance for a ragdoll settling
 *                      into a slope, a floating archetype's own `float`, and
 *                      the fact that `height()` is bilinear over a 1.5 m grid.
 *   outside the field  `inBounds` is the level's own answer. A body outside it
 *                      is outside the world; nothing can reach it and it can
 *                      reach nothing.
 *   not a number       a NaN position propagates silently into every distance
 *                      test in the game and makes all of them false, which is
 *                      indistinguishable from "far away" everywhere except here.
 *
 * Exported because it is the property, and a property that only exists inside a
 * check is a property the game does not have — the same argument
 * `Arrivals.deliveryIsAnnounced` makes.
 */
export function positionIsValid(world, e) {
  const p = e?.position;
  if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.y) || !Number.isFinite(p.z)) return false;
  const t = world?.terrain;
  if (!t) return true;
  if (typeof t.inBounds === 'function' && !t.inBounds(p.x, p.z, 0)) return false;
  if (typeof t.height === 'function') {
    const float = e.A?.float ?? 0;
    if (p.y < t.height(p.x, p.z) - 2.0 - float) return false;
  }
  return true;
}

/**
 * The set-piece ladder, and the depth each rung needs.
 *
 * These are the old director's three hand-written branches — acklay at 20,
 * walker at 10, two acolytes otherwise — written as data so a fourth rung is a
 * line rather than another `else if`, and so a level's `pool` can veto one.
 */
export const SET_PIECE = [
  { type: 'beast', from: 20 },
  { type: 'walker', from: 10 },
  { type: 'droideka', from: 6 },
  { type: 'acolyte', from: 1 },
];

/**
 * Is this archetype one of the big ones?
 *
 * `big` and `boss` are separate flags — a walker is big, an acklay is a boss
 * and is not flagged big — and every rule that wants to limit the number of
 * enormous bodies on the field wants BOTH. Reading only `big` is what let a
 * wave field three acklays under a heavy limit of four.
 */
export function isHeavy(type) {
  const A = ARCHETYPES[type];
  return !!A && (!!A.big || !!A.boss);
}

/** Indices 0..n-1 in a random order — used to pick a queue slot to improve. */
function shuffledOrder(n) {
  const a = Array.from({ length: n }, (_, i) => i);
  for (let i = n - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

/* ══════════════════════════════════════════════════════════════════════ */
/*  Wave conditions — the ladder that does not stop                       */
/* ══════════════════════════════════════════════════════════════════════ */

/**
 * WHAT A WAVE IS, AS OPPOSED TO HOW MUCH OF IT THERE IS.
 *
 * ── the hole, measured ─────────────────────────────────────────────────
 *
 * Everything above this block escalates by BUYING: a bigger budget buys more
 * bodies, then better bodies, then bodies wearing modifiers. Every one of those
 * ladders has a last rung and all three are climbed by wave 12:
 *
 *     last archetype introduced   wave 5 on six of ten levels, 11-12 on the rest
 *     last elite modifier         wave 11 (`leader`)
 *     body count saturates        wave 18 (`bodyCap`)
 *
 * Past there the only thing depth changes is the size of the crowd, and the
 * crowd has a ceiling too. Composed through the shipped director on kamino,
 * eight seeds a wave:
 *
 *     wave   bodies   threat/body   elite%   distinct entries   budget stranded
 *       20     31.5       5.13        40%          37                  0%
 *       40     76.0       6.56        67%          38                  0%
 *       70    125.0      10.65       100%           7                  9%
 *      100    173.0      10.65       100%           7                 41%
 *      140    237.0      10.40       100%          30                 65%
 *
 * At wave 70 every body is an elite acolyte, because `_upgrade` trades every
 * light body for the heaviest the level fields and then promotes all of them —
 * so the composer CONVERGES. Threat-per-body is frozen from there on, and by
 * wave 140 two thirds of the budget is thrown away because there is nothing in
 * the roster left to spend it on. The endless mode stops escalating at about
 * wave 55 and nobody could see it, because the body count keeps climbing.
 *
 * ── why a condition and not an eighth modifier ─────────────────────────
 *
 * A modifier makes ONE BODY worse. Seven of them exist, all unlocked by wave 11,
 * and adding an eighth would buy one more rung on a ladder that has already been
 * climbed — and it would land on the same wave-70 fixed point, because
 * `_upgrade` would simply converge on the new one instead.
 *
 * A condition changes THE WAVE'S QUESTION, and it does it out of content that
 * already exists: no archetype, no modifier, no art. "Everything in this wave
 * closes to the blade" and "nothing in this wave will come near you" are the
 * same roster asking two opposite things of the player, and neither of them is
 * "there are more of them".
 *
 * ── and it is PAID FOR, which is the whole reason it is safe ───────────
 *
 * Exactly the argument `_promote` makes for modifiers: a condition costs
 * `worth` of the wave's own budget, so a conditioned wave is a SMALLER wave
 * asked differently rather than a wave that is secretly 30% over the ramp.
 * `tools/checks/escalation.mjs` prices the total.
 *
 * That pricing is also what fixes the stranding above, and it is the part worth
 * reading twice. The director keeps buying conditions while the budget it could
 * not turn into bodies would pay for another one — so the surplus that used to
 * be discarded at wave 100 is now the thing that makes wave 100 a different
 * fight from wave 70. The escalation cannot flatten again while the roster has
 * a ceiling, because the ceiling is now what funds the next condition.
 */

/** The first wave that can carry one — where the modifier ladder stopped. */
export const CONDITION_FROM = 13;
/** A conditioned wave every this many from there, so a plain wave still exists. */
export const CONDITION_EVERY = 3;
/**
 * …AND THE TRIAL OF WAVES IS THE MODE THE CONDITIONS ARE FOR.
 *
 * A mode with no draft has no build, so it cannot escalate by making the player
 * bigger and there is nothing left for depth to mean except the crowd — which
 * is the whole complaint this file is answering. The Trial gets its ladder in
 * the QUESTION instead: from wave 4, and every other wave. See MODES.waves.
 */
export const TRIAL = { from: 4, every: 2 };
/**
 * Never more than this at once.
 *
 * It was three, on the feeling that three questions is a wave and four is
 * noise, and the measurement disagreed. Stranded budget on kamino/colosseum/
 * the full pool, at three against four:
 *
 *     wave     no conditions      max 3        max 4
 *      100      39-48%          12-24%        10-18%
 *      140      64-69%          19-32%        10-18%
 *      200      84-86%          31-41%        16-22%
 *
 * A fourth is only ever reached by the surplus loop, which cannot fire before
 * about wave 95 — so the choice at the depths where it happens is not "a
 * simpler wave or a busier one", it is "a busier wave or a fifth of the ramp
 * thrown away". The scheduled path still gives exactly one.
 */
export const CONDITION_MAX = 4;

/**
 * Every condition, and what each one costs.
 *
 * `worth` is the share of the wave's budget the condition is charged. They are
 * working figures in the same sense BOON_POWER is one, and each carries its
 * reasoning rather than a number that felt right.
 *
 * The hooks are all optional and each one is read in exactly one place:
 *
 *   `types(list)`  narrows what the fill may draw from. Never allowed to empty
 *                  the field — `_composeUnder` falls back to the full list.
 *   `allow(mods)`  narrows which modifiers the fill may promote with.
 *   `capScale`     multiplies `bodyCap`.
 *   `heavyScale`   multiplies `heavyLimit` — a frame-rate number, so this is
 *                  the one hook with a hard ceiling behind it (`HEAVY_CAP`).
 *   `eliteScale`   multiplies `eliteChance` — how much of the FILL arrives
 *                  promoted. Declared by `elites` and by nothing else, which is
 *                  the point of it: see that entry.
 *   `aliveScale`   multiplies `maxAlive` — how much of the wave stands at once.
 *   `paceScale`    multiplies the gap between spawns.
 *   `bearing`      the whole wave arrives from one quarter of the compass.
 *   `head`         one body is the wave's leader and killing it ends the wave.
 *   `excludes`     the other conditions this one may never be held with. Read
 *                  in `_pickCondition` and in `legalRuleSet`, both directions —
 *                  declaring it on one of a pair is enough.
 *
 * `needs(types, d)` is how a level vetoes one: the Ember Shelf has no heavy in
 * its pool and can never field the Heavy Guard, and that is the pool being
 * honest rather than a condition being broken. **The second argument is the
 * DIRECTOR**, and it is not optional decoration — `vanguard` dereferences
 * `d.modifiersAt(d.wave)` and throws if it is called with the types alone. This
 * doc block said `needs(types)` for a long time while three call sites passed
 * the pair; a signature written down wrongly beside the thing it describes is
 * the same defect as a price list beside a price.
 *
 * `unmet` is the other half of `needs`: the one line a player is shown when the
 * theatre they picked vetoes the rule they picked. It says what the ROSTER
 * lacks rather than restating the predicate, and `escalation.mjs` holds every
 * `needs` to having one.
 */
export const CONDITIONS = {
  /**
   * The wave has a head. Kill it and the rest break.
   *
   * The one condition that changes what WINNING a wave is: every other wave in
   * this game is cleared by killing all of it. Priced low and positive rather
   * than as a refund — the leader's own aura (see MODIFIERS.leader, which
   * multiplies everything inside its ring) is a real tax while it lives, and it
   * is deliberately placed deep in the queue so the shortcut has to be cut to.
   */
  vanguard: {
    label: 'A HEAD TO CUT OFF',
    tell: 'one of them is leading. Kill it and the rest will break.',
    since: CONDITION_FROM, worth: 0.08,
    head: true,
    // Exactly one leader, or "the leader" is not a thing the player can find.
    allow: (mods) => mods.filter((k) => k !== 'leader'),
    needs: (types, d) => d.modifiersAt(d.wave).includes('leader'),
    unmet: 'nothing this deep can carry a standard yet',
  },

  /**
   * Nothing in it will shoot at you.
   *
   * A saber player's damage is half deflection: `deflectDamage` is the one
   * defensive axis that scales, returned bolts are free kills, and a wave with
   * no bolts in it takes both away at once. What is left is footwork.
   */
  silence: {
    label: 'NO GUNS',
    tell: 'every one of them means to reach you. Nothing to turn, nothing to send back.',
    since: 14, worth: 0.18,
    excludes: ['fusillade'],
    types: (list) => list.filter((t) => !ARCHETYPES[t]?.ranged),
    // TWO, not one, and the number is the difference between a condition and a
    // monotony: kamino's only melee archetype is the acolyte, so a one-type
    // gate turned NO GUNS into "six identical acolytes" on that level. A wave
    // asked a different question still has to be a wave.
    needs: (types) => new Set(types.filter((t) => !ARCHETYPES[t]?.ranged)).size >= 2,
    unmet: 'only one kind of body here closes to reach you',
  },

  /**
   * Nothing in it will come near you.
   *
   * The mirror, and the reason both exist: a roster of shooters that holds its
   * preferred band is a wave you have to CLOSE, one bolt-line at a time, and
   * the crowd-control half of the kit does nothing at all.
   */
  fusillade: {
    label: 'NOTHING WITHIN REACH',
    tell: 'they will hold their distance. Close it, or turn every bolt.',
    since: 16, worth: 0.18,
    excludes: ['silence'],
    types: (list) => list.filter((t) => ARCHETYPES[t]?.ranged),
    needs: (types) => new Set(types.filter((t) => ARCHETYPES[t]?.ranged)).size >= 2,
    unmet: 'only one kind of body here carries a gun',
  },

  /**
   * All of it from one quarter.
   *
   * The field gets a FRONT, which it has never had: `pickSpawn` draws a uniform
   * bearing and every wave in the game therefore surrounds you by construction.
   * A wave with a front can be held at a doorway, backed away from, or flanked
   * around — three plays that do not exist in any other wave.
   */
  hammer: {
    label: 'ONE BEARING',
    tell: 'they are all coming from the same quarter. The field has a front.',
    since: 15, worth: 0.14,
    bearing: true,
  },

  /**
   * The whole wave at once, instead of fed in.
   *
   * `maxAlive` is 26 and the spawn gap is up to 0.85 s, so a hundred-body wave
   * is normally a conveyor: twenty-six standing and a queue behind them. Lift
   * both and the same hundred bodies are a single problem. The most expensive
   * condition in the table because it is the largest multiplier on a crowd
   * anything here can apply — and `capScale` pulls the count DOWN to pay for it,
   * so it is a denser wave rather than a bigger one.
   */
  deluge: {
    label: 'ALL AT ONCE',
    tell: 'no second rank. They are all here already.',
    since: 17, worth: 0.30,
    aliveScale: 2.4, paceScale: 0.22, capScale: 0.8,
  },

  /**
   * The enormous ones, and one kind of escort.
   *
   * `heavyLimit` exists because a walker is 66 meshes, so this hook is the one
   * with a real ceiling behind it: `HEAVY_CAP` still clamps the answer.
   *
   * ── AND THAT CEILING IS WHY IT IS NOT "HEAVIES ONLY" ──────────────────
   *
   * The first version of this narrowed the fill to `isHeavy` alone, and it was
   * the one condition in the table that could not spend its wave. Measured
   * across forty waves and twenty-five rolls each, worst unspent budget by
   * condition set: titans+vanguard+hammer 25%, titans+hammer 18%, titans alone
   * 17% — and every other condition in the table under 2%. The cause is
   * arithmetic and not tuning: ten walkers is 120 threat against a wave-40
   * budget of 499, `HEAVY_CAP` will not allow an eleventh, and a wave that
   * cannot spend its budget is the exact defect this whole file is about.
   *
   * So the heavies are the BULK and one light archetype — the heaviest the
   * level fields — is the escort. `_pickType` gives a heavy zero weight the
   * moment `bigLeft` hits zero, so the shape is "as many enormous bodies as the
   * renderer will hold, and then their guard", which is what the Heavy Guard
   * should have been in the first place.
   */
  titans: {
    label: 'THE HEAVY GUARD',
    tell: 'few, and enormous, and what walks with them.',
    since: 18, worth: 0.22,
    excludes: ['silence', 'fusillade'],
    types: (list) => {
      const heavy = list.filter((t) => isHeavy(t));
      if (!heavy.length) return list;
      const rest = [...new Set(list.filter((t) => !isHeavy(t)))]
        .sort((a, b) => ARCHETYPES[b].threat - ARCHETYPES[a].threat);
      return rest.length ? heavy.concat(rest[0]) : heavy;
    },
    heavyScale: 2.0, capScale: 0.75,
    needs: (types) => types.some((t) => isHeavy(t)),
    unmet: 'nothing enormous is stationed here',
  },

  /**
   * Every one of them arrives promoted.
   *
   * `eliteScale` was a documented hook that NO condition declared — the doc
   * block above listed it, `_shapeUnder` read it at line ~1790, and the answer
   * was `chance × 1` forever. That is this codebase's other standing defect (a
   * field written and never read; see `Enemy.grippable` in HANDOFF §6.1c), and
   * a hook with no declarer is indistinguishable from a hook that does not
   * work.
   *
   * It is a condition rather than a deletion because it is the one thing the
   * elite ladder deliberately refuses to do on its own. `eliteChance` is capped
   * at 0.40 with its reason written next to it — "an elite is a body you have
   * to fight DIFFERENTLY, and while a wave is still mostly about crowd control,
   * most of it should be crowd". A wave where that is FALSE is a different
   * question and not a bigger number: there is no crowd to control, every body
   * on the field wants a different answer, and the wave is small because the
   * budget went into the modifiers.
   *
   * 2.5 is the smallest scale that reaches 1.0 from the 0.40 ceiling, so the
   * hook's value is derived from the number it is lifting rather than picked.
   * `worth` sits between the head (0.08) and the front (0.14): the promotions
   * themselves are already paid for body by body out of the same budget — this
   * charges only for the SHAPE, the way ALL AT ONCE is charged for density it
   * does not otherwise pay for.
   *
   * `needs` asks for two modifiers and not one, on `silence`'s argument: one
   * modifier on every body is a monotony wearing a condition's label.
   */
  elites: {
    label: 'NO RANK AND FILE',
    tell: 'every one of them is somebody. There is no crowd here to work through.',
    since: 19, worth: 0.12,
    eliteScale: 2.5,
    needs: (types, d) => d.modifiersAt(d.wave).length >= 2,
    unmet: 'too shallow for two kinds of champion',
  },
};

export const CONDITION_KEYS = Object.keys(CONDITIONS);

/* ══════════════════════════════════════════════════════════════════════ */
/*  RUN RULES — the same six, chosen before Ignite instead of dealt        */
/* ══════════════════════════════════════════════════════════════════════ */

/**
 * WHY THE CONDITIONS BECOME A CHOICE, AND WHY THAT IS THE REPLAYABILITY FIX.
 *
 * Measured on the shipped composer: a run stops adding anything NEW at wave 18.
 * The last archetype unlocks at 10 on the Ember Shelf and at 5 on Kamino, the
 * last modifier at 17, the last scheduled condition at 18 — and the cosine
 * similarity of a wave's composition against wave 30 is 0.956 at wave 18, 0.977
 * at 25, 0.990 at 35 and 0.994 at 60. Wave 30 is 94% the same fight as wave 12.
 * A run therefore contains about six minutes of new material and then repeats,
 * and — worse — RUN TWO IS RUN ONE. There is no seed, no unlock, no ascension:
 * nothing at all differs between the first run and the hundredth.
 *
 * The conditions are the only things in this game that change the QUESTION
 * rather than the number. `silence` deletes deflection, which is half a saber
 * player's damage; `fusillade` deletes crowd control; `vanguard` changes what
 * winning a wave IS; `hammer` gives the field a front, which no other wave in
 * the game has. And they were reaching 27% of roguelite waves, one at a time,
 * never in combination before about wave 92 — because `CONDITION_MAX` is only
 * ever approached through the surplus loop, and the surplus does not exist
 * until the roster has stopped being able to absorb the budget.
 *
 * So they are also RULES: chosen on the Deploy panel, in force from wave 1, and
 * unioned into every wave's condition set at the top of `_compose`. Nothing
 * about the machinery changes — `_shapeUnder` has always merged an arbitrary
 * list, `_composeUnder` has always composed under one, `_pickCondition` already
 * honours `excludes`, and `needs` is already how a theatre vetoes one. What
 * changes is WHO PICKS.
 *
 * ── AND A RULE IS NOT CHARGED FOR ──────────────────────────────────────────
 *
 * `conditionCost` skips anything in `this.rules`, and that one line is the
 * whole difference between a harder run and a cheaper one. A dealt condition is
 * compensation — the director took a share of the wave's budget to buy it, so
 * the wave is smaller in exchange for being strange. A rule is a handicap the
 * player asked for: they get the strangeness AND the full wave. Charge for it
 * and NO GUNS becomes the way to make wave 30 easier, which is the exact
 * opposite of what it is for.
 *
 * ── AND IT IS NOT A META-PROGRESSION ───────────────────────────────────────
 *
 * Nothing is unlocked by playing, nothing is carried between runs and no rule
 * makes the player stronger. `Progress.byRule` records how deep you have been
 * under a rule set for the same reason `byMode` records how deep you have been
 * in a mode — see the head of Progress.js, which forbids currency and cross-run
 * power and explicitly keeps "how deep you have been, what you did it with".
 */

/**
 * The depth at which every condition and every elite modifier has come due.
 *
 * A run rule is in force from wave 1, so "can this theatre be fought under this
 * rule" has to be asked at a depth where the answer is about the ROSTER rather
 * than about how shallow the question was asked. Derived from the two tables
 * rather than typed, so a condition or a modifier added later moves it.
 *
 * A FUNCTION AND NOT A CONSTANT, because `MODIFIER_KEYS` comes from Enemy.js
 * and Enemy.js imports this file back. Evaluated at module scope it read the
 * other half of that cycle while it was still initialising and threw
 * `ReferenceError: Cannot access 'MODIFIER_KEYS' before initialization` for any
 * entry point that reached Enemy.js first — which is most of them. Computed on
 * the first call instead, by which time both halves are up, and memoised
 * because it is asked once per rule per repaint of the Deploy panel.
 */
let _ruleDepth = 0;
export function ruleDepth() {
  if (!_ruleDepth) {
    _ruleDepth = Math.max(
      ...CONDITION_KEYS.map((k) => CONDITIONS[k].since ?? 1),
      ...MODIFIER_KEYS.map((k) => MODIFIERS[k].since ?? 1),
    );
  }
  return _ruleDepth;
}

/** Does either of these two conditions forbid the other? Both directions. */
export function rulesConflict(a, b) {
  return !!(CONDITIONS[a]?.excludes?.includes(b) || CONDITIONS[b]?.excludes?.includes(a));
}

/* ══════════════════════════════════════════════════════════════════════ */
/*  Spawn entries                                                         */
/* ══════════════════════════════════════════════════════════════════════ */

/**
 * A queued spawn is `"trooper"` or `"trooper|marksman"`.
 *
 * A string rather than a `{type, mod}` pair on purpose. Everything that looks
 * at a composed wave — the checks, a `console.log`, `new Set(spawnQueue)` —
 * gets something it can read and compare; a queue of objects turns "is this
 * wave monotonous?" into a question about object identity, which is always
 * false and therefore always passes. `"b1"` and `"b1|frenzied"` are two
 * different things to fight, and the encoding says so.
 */
export function spawnType(entry) {
  const i = entry.indexOf('|');
  return i < 0 ? entry : entry.slice(0, i);
}
export function spawnMod(entry) {
  const i = entry.indexOf('|');
  return i < 0 ? null : entry.slice(i + 1);
}
/** What one queued body costs the director, elite or not. */
export function spawnCost(entry) {
  const type = spawnType(entry), mod = spawnMod(entry);
  if (mod) return modifierThreat(type, mod);
  return ARCHETYPES[type]?.threat ?? 0;
}

export class WaveDirector {
  constructor(world, opts = {}) {
    this.world = world;
    this.wave = 0;
    this.active = false;
    this.pending = 0;
    this.spawnQueue = [];
    this.spawnTimer = 0;
    this.intermission = 0;
    this.mode = opts.mode ?? 'roguelite';
    this.pool = opts.pool || ['b1', 'b1', 'b1', 'trooper', 'b2', 'sniper', 'droideka', 'acolyte'];
    /* THE ARMIES ON THIS FIELD — see `levelArmies`. Off the level in the game,
     * because `World` hands this director a pool and not a level; overridable
     * from opts so a harness can compose a two-army wave without building a
     * World, exactly as `pool` is. */
    this._armies = Array.isArray(opts.armies) ? opts.armies : null;
    this.maxAlive = opts.maxAlive ?? 26;
    /**
     * THE RULES THIS RUN IS FOUGHT UNDER — see the RUN RULES block above.
     *
     * Filtered ONCE, here, rather than per wave: a theatre's veto and a pair's
     * mutual exclusion are both facts about the run, and asking them every wave
     * would let a rule the player chose blink in and out with the depth. The
     * menu asks the same question through the same method before it lights a
     * card, so what the player is shown and what the director honours are one
     * answer.
     */
    /**
     * …AND IT IS RESOLVED ON FIRST READ, NOT HERE. This used to be
     *
     *     this.rules = [];
     *     this.rules = this.legalRuleSet(opts.rules ?? world?.settings?.rules ?? []);
     *
     * and it CRASHED COMMAND MODE ON DEPLOY for five of the seven run rules.
     *
     * `legalRuleSet` asks `ruleVeto`, which asks `this.unlockedAt(at)`, which
     * is overridden — `CommandDirector.unlockedAt` filters the level's roster
     * down to the army you are NOT leading, and reads `this.commanders[0]` to
     * find out which one that is. A subclass's constructor body runs AFTER
     * `super()` returns, by specification, so `this.commanders` provably does
     * not exist at this line. A base constructor that calls an overridable
     * method is calling into a subclass that has not been built yet.
     *
     * Measured on a real `bootWorld`, geonosis, mode `command`, one rule each:
     *
     *     vanguard  THROWS      silence   THROWS      titans    THROWS
     *     elites    THROWS      fusillade THROWS      deluge    ok
     *     hammer    ok          (no rules at all)     ok
     *
     * The five that throw are the five whose `needs(types, d)` predicate reads
     * the type list `unlockedAt` produces. `deploy()` catches the TypeError and
     * puts the menu back with "Could not deploy: Cannot read properties of
     * undefined (reading '0')", so the mode is simply unreachable with those
     * rules picked and the message says nothing about rules. Every other mode
     * is fine, because `WaveDirector.unlockedAt` reads only `this.pool`, which
     * is set eight lines up.
     *
     * Deferring the resolution to the first READ fixes it for every subclass
     * there will ever be rather than for the one that exists, and it changes
     * nothing about WHEN the answer is used: the first reader is `_compose`,
     * `ruleLabel` or the menu, all of them long after any constructor has run.
     * The empty array before the call is kept as a re-entrancy guard for the
     * same reason it was written the first time — a `needs` predicate is handed
     * the director and may ask it anything, including this.
     */
    this._ruleAsk = opts.rules ?? world?.settings?.rules ?? [];
    this._rules = null;
    /**
     * THE RUN'S OWN NUMBER, ON THE STREAM THAT COMPOSES ITS WAVES.
     *
     * Read here rather than in `start` because a run is one director for its
     * whole life, and reseeding at the top of every wave would hand wave 2 the
     * same draw wave 1 got.
     *
     * IT USED TO READ `world.run`, WHICH NOTHING HAS ASSIGNED SINCE `Run.js`
     * WAS DELETED WITH THE DESCENT. So `this.seed` was null in every mode,
     * `seedWaves` was called by nothing in the game, `record()` passed no seed,
     * `Progress.recent[].seed` was always null and the `· seed N` clause in
     * `progressLines` was unreachable — the whole apparatus for making a run a
     * shareable number was wired to a field that no longer exists. It reads
     * `world.runSeed` now, which `main.js` assigns on every deploy.
     *
     * Still null in the modes that are not a run — the sandbox is a room with a
     * slider and training is a lesson — and those keep the module's load-time
     * `Math.random()` seed.
     */
    this.seed = opts.seed ?? world?.runSeed ?? null;
    if (this.seed !== null) {
      seedWaves(this.seed);
      /**
       * …AND THE THREE STREAMS THAT DECIDE WHAT THE WAVE DOES ONCE IT IS THERE.
       *
       * Seeding the composition alone gets you a run that fields the same
       * bodies in the same order and then plays out completely differently:
       * `enemyRng` chooses modifiers, strafe sides and spawn jitter, and
       * `duelRng` chooses forms, attacks, feints and every wind-up length in
       * the game. Both were built from `Math.random()` at module load.
       *
       * Offset per stream so a run does not hand three different systems the
       * same sequence of draws.
       *
       * The `tier` term every one of these lines used to carry was the Descent's
       * rung index, so that rung 2 of one seed was not rung 2 of another. The
       * Descent is deleted, `world.run` with it, and the term was `0` at every
       * call site left in the game.
       */
      enemyRng.seed(this.seed ^ 0x9e3779b9);
      duelRng.seed(this.seed ^ 0xc2b2ae35);
      /* …and how they ARRIVE. Which craft comes, where it sets down, the
       * bearing it flies in on and how the squad spills out were the last
       * stream still on a module-load constant — so a seeded run replayed its
       * waves and its choreography and then had different things fly in. And
       * only on the first run after a page load, because a module-level stream
       * is never reset and each later run inherits the last one's position. */
      seedArrivals(this.seed ^ 0x165667b1);
    }
    this.onWaveStart = null;
    this.onWaveClear = null;
    this.onDraft = null;
    this.totalSpawned = 0;
    /**
     * THE HIGHEST WAVE THIS LADDER HAS ALREADY PAID FOR — see `payWave`.
     *
     * Zero rather than `floor`, because `floor` is read off the run and a
     * director outlives nothing: `start()` clamps the first wave to `floor + 1`
     * anyway, so the first clear on any rung is above this and pays.
     */
    this._paid = 0;
    // sandbox bookkeeping — see _sandboxUpdate
    this._fireApplied = null;
    this._diffBase = null;

    /**
     * HOW A BODY GETS INTO THE WORLD.
     *
     * It used to be `ctx.spawnEnemy(type, ctx.pickSpawn(type))` right here, on
     * a timer, and that single line is the whole of "enemies pop into
     * existence". Now the request goes to something that has to bring them —
     * a ship, a gate, or a long walk in from the edge — and `spawnEnemy` is
     * called by THAT, at the moment and place the arrival delivers. See
     * src/game/Arrivals.js.
     *
     * The sandbox keeps the direct path: it is a debug room whose whole
     * purpose is putting twenty bodies in front of you in three seconds.
     */
    this.arrivals = new ArrivalDirector(world, (type, mod, pos) => {
      const e = world.spawnEnemy(type, pos);
      if (e && mod) applyModifier(e, mod);
      return e;
    }, ARCHETYPES);
    /**
     * …AND THE SANDBOX ARRIVES TOO, WHICH IT DID NOT.
     *
     * This line was `this.arrivals.enabled = !this.sandbox`, and the comment
     * above the direct path defended it: "it is a debug room whose whole purpose
     * is putting twenty bodies in front of you in three seconds". Player note
     * #17 disagrees, and names the room: "even in training mode or in ANY MODE,
     * the enemies should not materialize in front of you they should arrive from
     * somewhere not teleport behind you."
     *
     * They are right and the defence was wrong in its own terms. The sandbox is
     * where a player spends the longest looking at how bodies enter the world —
     * it is the mode you sit in and dial the count up and down — so it is the
     * worst possible place for the one path that pops them into existence at
     * eleven metres.
     *
     * THE FAST PATH IS KEPT AND IS NOW A CHOICE. `settings.instantSpawn` turns
     * it back on for anybody who really is using the room to put twenty bodies
     * down in three seconds, which is a legitimate thing to want. It is opt-in
     * rather than the default, which is the whole of the change: the default
     * behaviour of the game is that things arrive from somewhere.
     */
    this.arrivals.enabled = !instantSpawn(world?.settings);
  }

  get sandbox() { return this.mode === 'sandbox'; }

  /**
   * WHERE THIS LADDER ALREADY STANDS — the fix for the Descent's sawtooth.
   *
   * `main.js` calls `world.director.start(1)` on every deploy, and a landing
   * re-enters deploy. So the only mode in the game with a run restarted its
   * wave counter at 1 four times: the composed budgets ran 7,11,15 · 7,11,15,21
   * · 7,11,15,21 · 7,11,15,21,26, which is a difficulty curve that DROPS 53%
   * and then 67% and then 67% at the exact three moments the fiction says you
   * went deeper. Everything the escalation is made of reads the wave number, so
   * the whole ladder above wave 5 was stranded with it: `unlockedAt` never
   * reached the droideka (6), the acolyte (7) or the walker (12), `eliteChance`
   * topped out at 0.066 of its 0.40 ceiling, `heavyBias` at 0.035 of 0.9, and
   * the bottom of a sixteen-wave descent fielded B1s and B2s.
   *
   * `wave` is therefore the wave number OF THE RUN — 1..16 down the Descent,
   * 1..∞ everywhere else — which is also the number every reader outside this
   * file already wanted: the HUD banner, the death card's "Wave reached", the
   * pause card, the depth the Holocron gates its facets on, and the number
   * a co-op host puts on the wire. What is rung-local is `onWaveClear`'s
   * argument (see the wave-clear block in `update`), because that is the one
   * consumer — World's `run.wave >= rung.waves` — asking about THIS rung.
   */
  get floor() {
    const run = this.world?.run;
    if (!run || run.done) return 0;
    const f = run.floor;
    return Number.isFinite(f) && f > 0 ? f : 0;
  }

  /** Waves cleared on the current rung, which is what `run.wave` means. */
  get rungWave() { return Math.max(0, this.wave - this.floor); }

  /**
   * THE RAMP, RE-DERIVED — and the derivation is one line of arithmetic, not a
   * feeling about how wave 20 ought to go.
   *
   * The old curve, `4 + 2.6w + 0.65·w^1.62`, was tuned against a run that drew
   * boons every THIRD wave, so a player at wave w held about w/3 of them. The
   * draft now runs every DRAFT_EVERY = 2 waves (see `isDraftWave`, and the note
   * on BOONS about why 10 cards in 30 waves is not a build system), so the same
   * player holds w/2 — that is w/6 extra cards, every one of them multiplying
   * something.
   *
   * BOON_POWER is what one average card is worth as a throughput multiplier.
   * 1.08 is the working figure: the median card in BOONS is a single ~1.2–1.5×
   * on one of cutPower / deflectDamage / moveSpeed / staminaRegen, and no card
   * multiplies more than one axis of the same fight at once, so a run's power
   * compounds far more slowly than its face values suggest. It is stated HERE,
   * as one constant with a name, so that when tools/balance.mjs measures the
   * real per-card value the ramp moves by editing one number rather than by
   * re-tuning a polynomial.
   *
   * ── AND IT HAS NOW MEASURED, AND THIS DID NOT MOVE. Read before changing it,
   * because the obvious derivation is wrong.
   *
   * What the harness produces is a paired MODEL-DEPTH difference: the median
   * modelled card is worth Δ0.372 waves, the best (The Dark Side — a mastery,
   * gated on three dark cards, costing a third of your health) Δ2.413. Those
   * are waves, not throughput, and balance.mjs's own header says an absolute
   * depth "is NOT a prediction of a human" and moves by a factor of three
   * across its three skill settings. Converting Δwaves into a multiplier on a
   * threat budget needs a conversion this project does not have and would have
   * to invent — and a number invented to look derived is worse than one
   * honestly labelled a working figure. So it stays 1.05, and stays labelled.
   *
   * What the measurement IS good for is what it was asked for: the SPREAD. It
   * was 12.1x the median at the top with five cards measuring below zero; it is
   * 6.5x with one, and that one is a gated mastery that costs health. That is
   * the finding, and it was acted on in the cards rather than here.
   *
   * Note too that ranks and ATTUNEMENTS now add player growth this exponent
   * never accounted for, and attunements deliberately do not converge — so no
   * fixed exponent can answer them. The budget curve and the attunement ladder
   * are two curves racing, and that race is what the endless mode IS. Folding
   * the attunements in here would end the race by construction.
   *
   * Multiply, do not re-fit: the opening is already tuned and 1.08^0 = 1 leaves
   * wave 1 exactly where it was. The extra pressure lands where the extra cards
   * do — ×1.15 at wave 10, ×1.31 at 20, ×1.47 at 30.
   */
  budgetFor(wave) {
    const base = 4 + wave * 2.6 + Math.pow(wave, 1.62) * 0.65;
    /**
     * …AND A MODE THAT DRAFTS NOTHING IS NOT CHARGED FOR CARDS IT NEVER GOT.
     *
     * The multiplier above this line exists for exactly one reason, stated in
     * the note: the draft runs every DRAFT_EVERY waves, so a player at wave w
     * holds w/2 cards and the budget is raised to match. `DRAFT_MODES` is the
     * list of modes that is true of, and the Trial of Waves is deliberately not
     * on it — so for its whole life the Trial faced a curve raised ×1.15 at
     * wave 10 and ×1.27 at wave 30 for a build it structurally cannot have.
     *
     * The correction is `this.drafts`, which is the shipped statement of the
     * same fact. Nothing about the roguelite moves: 1.05^n with n>0 is exactly
     * what it was, and `tools/checks/escalation.mjs` pins both branches.
     */
    const growth = this.drafts ? Math.pow(BOON_POWER, (wave - 1) / 6) : 1;
    // `partyScale` is exactly 1 on every level that does not declare a `party`
    // share, so this line is a no-op for all of them — see partyScale.
    return Math.floor(base * growth * this.partyScale());
  }

  /**
   * Set-pieces every fifth wave, FOREVER.
   *
   * This was a literal `Set([5,10,15,20,25,30])` in a mode whose whole promise
   * is "endless escalation" — so wave 35 and everything past it had no boss at
   * all, and the ladder the player had been climbing simply stopped having
   * rungs. A modulus cannot run out.
   */
  isBossWave(wave) { return wave > 0 && wave % BOSS_EVERY === 0; }

  /**
   * A draft every other wave — AND after every set-piece, which is the half of
   * this rule that was written down and not implemented.
   *
   * The comment on the draft call in `update` says "a set-piece cleared is
   * worth more than a wave cleared: the boss draft is one card wider AND cannot
   * be three commons", and `draftSize` returns 4 on a boss wave and the call
   * passes `floor: 'rare'`. None of it could ever run. Set-pieces land on
   * multiples of BOSS_EVERY (5) and drafts on multiples of DRAFT_EVERY (2), so
   * the two coincided only every tenth wave — and every tenth wave is an
   * ATTUNEMENT draft, which discards `n` and `floor` entirely. Measured over
   * forty waves: drafts at 2,4,…,40, boss drafts at 10,20,30,40, all four of
   * them the five attunements, ZERO drafts ever laid out at draftSize 4, and
   * the set-pieces at 5, 15, 25 and 35 paid nothing at all beyond the ordinary
   * 5.5 s intermission.
   *
   * Clearing a set-piece now always pays a draft. That is +3 drafts in thirty
   * waves (one card draft at wave 5 and two attunement drafts at 15 and 25),
   * which is inside every bound `tools/checks/escalation.mjs` holds the cadence
   * to and leaves DRAFT_EVERY — the constant `budgetFor`'s ramp is derived
   * from — untouched.
   */
  isDraftWave(wave) { return wave > 0 && (wave % DRAFT_EVERY === 0 || this.isBossWave(wave)); }
  draftSize(wave) { return this.isBossWave(wave) ? 4 : 3; }

  /**
   * Does this mode hand out cards at all?
   *
   * It was `this.mode === 'roguelite'`, written when that was the only mode
   * with boons in it — and THE DESCENT, the one mode in the game that owns a
   * Run, that carries boons across a landing, that replays them into a freshly
   * built player and that ends in a crown, is `gauntlet`. It fell on the wrong
   * side of that equality for its whole life: measured over twenty-four waves a
   * roguelite drafted twelve times and a gauntlet drafted zero, so the flagship
   * run mode's entire reward loop was the Holocron and nothing else.
   *
   * A LIST, so the next mode that wants a run declares itself here rather than
   * being caught by an `===` somebody has to remember to widen. `waves` and
   * `duel` are deliberately absent: the Trial of Waves is the undecorated
   * escalation and a duel is a duel.
   */
  get drafts() { return DRAFT_MODES.includes(this.mode); }

  /**
   * Does clearing the wave now on the field hand the player to a landing?
   *
   * A rung's last wave ends in the landing card, and the ladder's last wave
   * ends in the crown. `main.js` raises both through the same `Screens.take` a
   * draft goes through, and `take` REPLACES what is on the screen — so a draft
   * offered on that same frame covers the card that was about to carry the run
   * down a rung, and at the bottom it covers the crown with a card whose answer
   * calls `resume()` on a run that is already over. The landing IS that wave's
   * reward, and the boons cross it anyway.
   *
   * Only reachable at all because the Descent drafts now; it is stated here
   * rather than left to the two rung lengths happening not to line up with
   * DRAFT_EVERY, which is how a ladder retuned in Run.js strands a player on a
   * card they cannot spend.
   */
  get rungEnds() {
    const run = this.world?.run;
    if (!run || run.done) return false;
    return this.rungWave >= (run.rung?.waves ?? Infinity);
  }

  /**
   * WHEN EACH BODY IS FIRST TAUGHT — one table, read in one place.
   *
   * These seven used to be seven `if (wave >= n) list.push(...)` lines ABOVE the
   * derived loop below, and four of them could never be the binding constraint:
   * the loop's own default fired first and let the body in earlier. Measured by
   * calling the shipped `unlockedAt` over waves 1-20 on the Ember Shelf pool,
   * first wave each type could appear against what the ladder claimed —
   * sniper 3 against 4, droideka 5 against 6, acolyte 5 against 7, walker 11
   * against 12. So the first sabered body a new player ever meets arrived two
   * waves before the teaching order said it would, and the four lines saying
   * otherwise were decoration. HANDOFF §2.3 exactly: a hand-written table beside
   * its generated twin, with the twin quietly winning.
   *
   * THE LADDER WINS WHERE IT SPEAKS, and the derivation covers everything else.
   * That is the choice rather than deleting the four dead lines, and the reason
   * is that they are not equivalent: deleting them hands waves 3-7 — the window
   * a player is learning the controls in — to a formula that was written to make
   * a level's POOL honest, not to set the teaching order. `threat × 0.9` is a
   * reasonable default for a body nobody has placed on the ladder and a poor
   * authority for the first two minutes of the game.
   */
  static LADDER = { b1: 1, trooper: 2, b2: 3, sniper: 4, droideka: 6, acolyte: 7, walker: 12 };

  /* ── two armies ──────────────────────────────────────────────────── */

  /**
   * THE ARMIES THIS LEVEL HAS, IF IT HAS MORE THAN ONE.
   *
   * ── the defect, measured ───────────────────────────────────────────────
   *
   * Composed through this director on the shipped Geonosis pool, wave 3 read
   * `5xb1 2xb2 2xtrooper`: five battle droids, two super battle droids and two
   * clone troopers, arriving together, walking at the player shoulder to
   * shoulder, on the field of the First Battle of Geonosis. Over twenty waves
   * nineteen of them fielded Republic and Confederate bodies at once. The level
   * names both armies in its pool deliberately — `CommandDirector.unlockedAt`
   * filters them apart, and that filter is the only thing in the game that ever
   * knew there were two — so in every mode that is not Command the two rosters
   * were one horde. `grep -in faction src/game/Waves.js` returned nothing.
   *
   * ── what is built ─────────────────────────────────────────────────────
   *
   * A WAVE IS ONE ARMY'S PUSH, and the sides trade them. That is the smaller of
   * the two shapes this could take — the other is both armies on the field
   * fighting each other as well as you — and the reason it is this one is
   * recorded rather than assumed: the second needs `World.pickTarget` to
   * consider cross-team bodies outside Command mode, and that gate
   * (`if (this.command)`, World.js) is one condition in a file this pass does
   * not own. Everything else it would need already works — `Enemy.team`,
   * `canHarm`, `blocksWaveEnd` — so it is one line away and it is written up in
   * the handover rather than half-built here.
   *
   * IT IS OPT-IN PER LEVEL, exactly as `partyScale` is and for the same stated
   * reason: the rotation moves a level's whole composition, and nine of the ten
   * shipped levels mix a Republic body into a droid pool because their own notes
   * say the thing coming at you is a HORDE ("what comes out of a ship is a
   * boarding party", "the garrison is the Order, and one acolyte because
   * something turned this hall"). One level's blurb says "two armies on it".
   * That is the level that declares `armies`, and turning another one on is one
   * line in Levels.js plus the measurement in `tools/checks/factions.mjs`.
   */
  levelArmies() {
    const declared = this._armies ?? this.world?.level?.armies ?? null;
    if (!Array.isArray(declared) || declared.length < 2) return [];
    return declared.filter((id) => FACTIONS[id]?.army);
  }

  /**
   * WHICH ARMY THIS WAVE IS, or null on a level that has only one.
   *
   * STRICT ALTERNATION, not a coin toss, and that is the design decision here.
   * A random draw can hand a player five Confederate waves in a row, which on a
   * level whose premise is two armies means one of them is content that shipped
   * and was not met; alternation makes "you meet both inside any two waves" a
   * property rather than a probability. It is also learnable, which is what this
   * game asks of everything else it makes a rule out of — the droids came last
   * time, so bring the answer to clone rifles.
   *
   * WHICH SIDE OPENS is folded out of the run's seed rather than drawn from the
   * wave stream. Drawing would advance a stream four other systems share and
   * move the composition of every level in the game by one step; a fold of a
   * number that is already fixed for the run gives the same variety for free.
   *
   * A SIDE THAT CANNOT FIELD ANYTHING DOES NOT GET THE WAVE. At wave 1 the
   * Republic's lightest body is a clone trooper, and the ladder opens that at
   * wave 2 — so a Republic wave 1 would compose EMPTY and clear itself the frame
   * it started. `open` is the roster this depth has actually earned, and a side
   * with nothing in it is skipped rather than fielded; if neither side has
   * anything the whole pool is used and the level behaves exactly as it did.
   * That is the same law `_shapeUnder` states about conditions — "a condition
   * never empties the field" — and it is what makes a stall impossible.
   */
  sideFor(wave, open = null) {
    const armies = this.levelArmies();
    if (armies.length < 2) return null;
    /* The class that filters the pool is the class that declines this — see
     * `CommandDirector.sideFor`. It used to be a `this.mode === 'command'` test
     * right here, which is a rule about a SUBCLASS written as a test on one of
     * the three mode strings that subclass runs under, and it is the reason the
     * subclass hard-coded its mode and a skirmish reported itself as Command. */
    const types = open || this._openTypes(wave);
    const live = armies.filter((id) => types.some((t) => factionOf(t) === id));
    if (live.length < 2) return live[0] ?? null;
    const opening = this.seed === null ? 0 : (Math.abs(this.seed >> 3) & 1);
    return live[(wave - 1 + opening) % live.length];
  }

  /** Is this body allowed on the field this wave, given whose push it is? */
  _sideAllows(type, wave) {
    const side = this.sideFor(wave);
    return !side || factionOf(type) === side;
  }

  unlockedAt(wave) {
    const open = this._openTypes(wave);
    const side = this.sideFor(wave, open);
    if (!side) return open;
    const mine = open.filter((t) => factionOf(t) === side);
    return mine.length ? mine : open;
  }

  /** Every pool member this depth has earned, both armies and all. */
  _openTypes(wave) {
    /**
     * EVERY POOL MEMBER, AT THE LADDER'S DEPTH OR AT ONE DERIVED FROM ITS THREAT.
     *
     * This loop used to say that anything not on the ladder had to declare
     * `unlockAt` or it was a set-piece — "the safe default". Measured, that
     * default was not safe, it was silence: `beast` (the Colosseum's headline
     * monster, on a level whose entire premise is exotic creatures),
     * `bodyguard` (the Warship's only elite) and `master` (the Jedi Master, on
     * the level about fighting Jedi) declare no `unlockAt`, so none of them
     * could ever appear in an ordinary wave. The beast reached the field ONCE in
     * twenty waves and five times in forty, every one of them through
     * `_setPiece`.
     *
     * A level naming a body in its pool means it wants that body. Deriving the
     * depth from threat keeps the teaching order the ladder was written for —
     * light things early, heavy things late — without a list somebody has to
     * remember to update. `heavyLimit` still caps how many big ones land at
     * once, so this cannot flood a wave; it only makes the pool honest.
     *
     * A body that genuinely belongs to a boss and nowhere else says so with
     * `setPieceOnly`, which is a STATED default rather than an accident of not
     * being on a list that stopped being maintained.
     */
    const list = [];
    for (const t of this.pool) {
      const A = ARCHETYPES[t];
      if (!A || A.setPieceOnly || list.includes(t)) continue;
      const at = WaveDirector.LADDER[t]
        ?? A.unlockAt ?? Math.max(1, Math.min(12, Math.round(A.threat * 0.9)));
      if (wave >= at) list.push(t);
    }
    // The ladder's own weighting, kept: a second B1 from wave 2, which is what
    // the seven `push` lines used to encode and what `_pickType` weighs.
    if (wave >= WaveDirector.LADDER.trooper && list.includes('b1')) list.push('b1');
    const live = list;

    /**
     * AND A POOL'S REPEATS ARE WEIGHTS, WHICH THEY HAD NEVER ONCE BEEN.
     *
     * `_pickType` sums a weight per ENTRY, so a type listed twice is drawn
     * twice as often — the ladder above uses exactly that trick, pushing 'b1' a
     * second time at wave 2. Every level pool in the game is written the same
     * way and means the same thing: the Ember Shelf lists `acolyte` three times and
     * `b1` once, which reads unmistakably as "this is the acolyte level". The
     * Drowned Wood doubles `b1`; Kamino doubles `trooper`.
     *
     * None of it did anything. The pool was only ever a membership FILTER —
     * `list` was built from the ladder and then intersected with the pool — so
     * the repeats never reached the array `_pickType` weighs. Measured: six of
     * the thirteen levels resolve to the identical six archetypes and produce
     * byte-identical twenty-wave runs. the Ember Shelf declares eight pool entries and
     * Alpine six; deduped they are the same six, so lava, swamp, ocean, meadow,
     * snowfield and smelter were one fight with six skyboxes.
     *
     * Eighth time in this codebase that a hand-authored table sat beside a
     * consumer that ignored it. Honouring the repeats costs one loop and turns
     * thirteen pools into thirteen different fights, out of content that
     * already exists and is already tuned.
     */
    const seen = new Set();
    const out = [];
    for (const t of this.pool) {
      if (!live.includes(t)) continue;
      // The first occurrence carries the ladder's own weighting with it; every
      // later one is the author asking for more of this body on this level.
      if (!seen.has(t)) { seen.add(t); out.push(...live.filter(x => x === t)); }
      else out.push(t);
    }
    return out.length ? out : live;
  }

  /**
   * HOW MANY BLADES THE WAVE IS BEING COMPOSED FOR.
   *
   * Co-op in this game is real — see `tools/checks/coop.mjs` — and until now
   * the wave director did not know it existed: two players got exactly the
   * wave one player got, which is the same fight at half the difficulty and
   * twice the cover. Nothing in the ramp accounted for it because nothing
   * asked.
   *
   * IT IS OPT-IN PER LEVEL, and that is deliberate rather than timid. The
   * budget curve above is tuned, measured and pinned by four checks; making
   * every level in the game scale would move all of them at once, for a
   * property only one level has been asked to have. A level declares `party`
   * as the share of a full extra budget each additional blade is worth, and
   * every level that does not declare one gets `1` — the identical number,
   * to the floor, that it gets today.
   *
   * 1.0 would be "each player brings their own wave", which is wrong: two
   * players are worth more than two players fighting separately, because they
   * cover each other's back and a horde that has to split its attention is
   * worth less per body. The colosseum authors 0.72, and states why there.
   */
  partySize() {
    const ps = this.world && this.world.players;
    return Array.isArray(ps) && ps.length ? clamp(ps.length, 1, 8) : 1;
  }

  partyScale() {
    const k = this.world?.level?.party ?? 0;
    return k > 0 ? 1 + k * (this.partySize() - 1) : 1;
  }

  /**
   * Which elite variants the depth has earned, and how often one shows up.
   *
   * This governs the FILL — the bodies the budget buys outright — and it is
   * capped well under half on purpose: an elite is a body you have to fight
   * DIFFERENTLY, and while a wave is still mostly about crowd control, most of
   * it should be crowd. Past the body cap (`bodyCap`, biting around wave 18)
   * `_upgrade` promotes on top of this, because at that point promotion is the
   * only thing left to spend on — so the measured elite share climbs from 0 at
   * wave 2 through ~45% at wave 20 to nearly all of it past wave 35. That is
   * the intended shape: late waves are not larger crowds, they are elite ones.
   */
  modifiersAt(wave) {
    return MODIFIER_KEYS.filter(k => wave >= MODIFIERS[k].since);
  }
  eliteChance(wave) { return clamp((wave - 2) * 0.022, 0, 0.40); }

  /**
   * HOW MANY BODIES A WAVE MAY BE, AND WHY THAT IS NOT THE BUDGET.
   *
   * The old director spent its whole budget on bodies, so escalation had
   * exactly one shape: more of them. Wave 30 was 58 units and wave 40 would
   * have been 121 — and `maxAlive` is 26, so past about forty queued the wave
   * stops being a fight and becomes a conveyor: twenty-six on the field and a
   * queue behind them feeding in one at a time for half a minute.
   *
   * So the count SATURATES at BODY_MAX — about 1.6 times what can be alive at
   * once, which is one full field plus a relief wave — and everything the
   * budget can still afford past that point is spent on QUALITY instead:
   * `_upgrade` promotes plain bodies to elites and trades light archetypes for
   * heavy ones until the budget is gone.
   *
   * The crossover lands around wave 18, which is where it should: up to there a
   * run is learning to handle a crowd, and after it the crowd stops growing and
   * starts getting better.
   *
   * ── AND FOR A LONG TIME IT DID NOT SATURATE AT ALL ────────────────────────
   *
   * Past the knee this added `BODY_CREEP = 1.6` more bodies per wave, forever,
   * so the "cap" read 58 at wave 30, 76 at 40 and 173 at 100 against a BODY_MAX
   * of 42 — and it was not the binding constraint at any of those depths, so
   * the whole second half of this note described something that was not
   * happening. See BODY_COUNT_SHARE for the measurement and for why a share of
   * the budget is the only kind of constant that can state this rule.
   *
   * A wave's own PRICE is what converts the two: the same allowance buys a
   * Kamino wave more bodies than a Jedi Temple wave, because a Kamino body is
   * cheaper, and that is right — the cap is an allowance in threat, not a taste
   * about crowds.
   */
  bodyCap(wave, types = null) {
    const curve = (w) => BODY_MAX - (BODY_MAX - 6) * Math.exp(-w / 12);
    if (wave <= BODY_KNEE) return Math.round(curve(wave));
    /**
     * Past the knee the count still creeps, because an endless mode must be
     * able to absorb an endless budget: threat per body is bounded by the
     * roster (nothing costs more than a shielded walker), so if the count
     * stopped dead the difficulty would stop with it and a run would never end.
     * It creeps by a MINORITY of the budget added since the knee, which is the
     * whole statement: the extra pressure lands on quality.
     *
     * ── AND IT CREEPS FROM THE WAVE THE PLAYER ACTUALLY MET AT THE KNEE ──────
     *
     * The curve above is a ceiling in BODIES and the budget is a ceiling in
     * THREAT, and the wave a player meets is the shorter of the two. On a level
     * whose bodies are expensive they are nowhere near each other: the Jedi
     * Temple's wave 18 is 17 bodies against a curve reading 34, so a cap
     * anchored on the curve sits at twice the length of the wave it is capping
     * and cannot bind at any depth — measured, the cap was reached on 0% of
     * rolls at wave 30 and 7% at wave 40, which is the whole "past the cap the
     * wave stops growing and starts improving" mechanism being inert.
     *
     * Anchored on the shorter of the two, the cap binds by construction: the
     * fill's own length is `atKnee + Δbudget/price` and this is `atKnee +
     * SHARE·Δbudget/price`, so whatever the roster costs, a minority of the
     * added budget goes on more bodies and the rest has nowhere to go but
     * quality — `_upgrade`, and past that the conditions.
     *
     * THE ALLOWANCE IS PER BLADE AND THE ANSWER IS SCALED, which is exactly the
     * shape `heavyLimit` settled on and for the same reason. The arithmetic is
     * done on one blade's share of the budget — otherwise a four-player party
     * would be compared against a one-player knee and the curve would mean
     * nothing — and the party multiplies the result, so a second blade on a
     * level that scales with the party buys a longer wave as well as a heavier
     * one. Dividing out and NOT multiplying back was measured and is wrong:
     * `colosseum.mjs` reported wave 20 fielding ten creatures for two blades
     * and seven for four, because the extra budget had nowhere to go but
     * per-body quality and traded bodies away to get it.
     */
    const scale = this.partyScale();
    const atKnee = Math.min(curve(BODY_KNEE),
      this.budgetFor(BODY_KNEE) / scale / this.meanBodyThreat(BODY_KNEE, types));
    const added = (this.budgetFor(wave) - this.budgetFor(BODY_KNEE)) / scale;
    const perBlade = atKnee + BODY_COUNT_SHARE * added / this.meanBodyThreat(wave, types);
    return Math.max(1, Math.round(perBlade * scale));
  }

  /**
   * What one body off THIS wave's own draw costs, on average.
   *
   * Through `_typeWeights`, which is `_pickType`'s weighting factored out
   * rather than copied: a second statement of "how likely is this archetype"
   * would eventually disagree with the draw it is meant to describe, and would
   * do it silently, in the direction that makes the cap wrong (§2.4).
   */
  meanBodyThreat(wave, only = null) {
    /**
     * AT THE PRICE OF THE BODIES THE WAVE WILL ACTUALLY FIELD.
     *
     * `only` is the condition-narrowed roster (`_shapeUnder`'s `types`), and
     * passing it is not a refinement — it is the difference between the cap
     * meaning what it says and not. The cap is an allowance in THREAT converted
     * to bodies at a price; priced off the whole roster, a wave narrowed to the
     * cheap half gets the allowance of the expensive half and strands the rest.
     * Measured on the Ember Shelf at wave 40, NOTHING WITHIN REACH — whose
     * shooters are the cheapest bodies the level has — the field carried 64% of
     * the threat the unnarrowed wave did, so the condition was silently a
     * DISCOUNT on top of being a different question.
     */
    const types = only?.length ? only : this.unlockedAt(wave);
    const { w, total } = this._typeWeights(types, wave);
    if (!(total > 0)) return 1;
    /**
     * …AND WHAT THE FILL PAYS ON TOP, which is not optional detail: the fill
     * promotes a share `eliteChance(wave)` of what it buys and pays
     * `modifierThreat` for it, so a body at wave 30 costs half again what its
     * archetype's `threat` says. Priced off the roster alone the cap would
     * allow half as many threat as it meant to, and the count would go on
     * carrying the escalation on exactly the levels with the cheapest chaff —
     * measured, kamino/wood/alpine/foundry at 68-75% of the marginal budget
     * against 40-48% everywhere else.
     */
    const allowed = this.modifiersAt(wave);
    let plain = 0, mods = 0, pairs = 0;
    for (let i = 0; i < types.length; i++) {
      const t = types[i];
      const base = ARCHETYPES[t]?.threat ?? 0;
      plain += w[i] * base;
      if (!base) continue;
      for (const m of allowed) {
        if (!modifiersFor(t).includes(m)) continue;
        mods += w[i] * modifierThreat(t, m); pairs += w[i];
      }
    }
    const flat = plain / total;
    if (!pairs) return Math.max(0.5, flat);
    const promoted = mods / pairs;
    const chance = this.eliteChance(wave);
    return Math.max(0.5, flat * (1 - chance) + promoted * chance);
  }

  /**
   * How hard the type pick leans on the heavy end of the roster.
   *
   * Type UNLOCKS stop at wave 12 — nothing new is ever fielded again — so
   * without this the mix at wave 30 is the mix at wave 12 and the only thing
   * depth changes is the count. Weighting each archetype by `threat^bias` with
   * a bias that climbs from 0 turns the same roster into a different army: at
   * wave 5 the field is B1s and troopers with the occasional heavy, at wave 25
   * it is droidekas, acolytes and walkers with the occasional B1.
   */
  heavyBias(wave) { return clamp((wave - 4) * 0.035, 0, 0.9); }

  /** How many `big` units a wave may field — a walker is 66 meshes. */
  /* One heavy, plus one per ten waves — and per party, on a level that scales
   * with it. A second blade in the arena does not want a bigger crowd of the
   * same droids, it wants the second creature that the first player cannot
   * also be watching. */
  /**
   * …AND IT RIDES THE BUDGET, because on wave count alone the elites thin out.
   *
   * It was `1 + floor(wave / 10)`, which is linear, against a body count that
   * is not. Measured on the Colosseum through this director, actual heavies
   * against this cap:
   *
   *     wave   bodies  threat  threat/body   heavy
   *       5       8      26       3.25        1/1   12.5%
   *      20      30     126       4.20        3/3   10.0%
   *      40      76     314       4.13        5/5    6.6%
   *
   * Two things fall out of that table. The heavy SHARE halves across the run,
   * so the late game is proportionally more trash than the early game. And
   * threat-per-body never moves — 3.0 to 4.3 across every wave measured — so
   * the whole of the escalation from wave 12 on is body count. Wave 40 is wave
   * 12 with four times the crowd, which is more of the same input rather than a
   * new question, and no amount of budget could fix it while the cap on the
   * interesting bodies grew linearly.
   *
   * Off the budget instead, which is the thing that actually grows with depth,
   * so surplus can buy quality rather than only quantity. The divisor is set so
   * the early waves are unchanged — wave 5's budget of 26 still gives 1, wave
   * 10's 61 still gives 2 — and the late game stops thinning: wave 40's 499
   * gives 9 against the 5 it gave before.
   *
   * STILL CAPPED, and the cap is a frame-rate number rather than a taste one: a
   * walker is 66 meshes, and `_pickType` refuses a heavy the moment `bigLeft`
   * hits zero, so this is the one line standing between a deep wave and a
   * scene the renderer cannot hold.
   */
  heavyLimit(wave) {
    /* The cap is on the PER-BLADE term, not on the answer. Clamping the total
     * made a four-player wave 20 field exactly what a two-player one did — both
     * hit the ceiling — and `colosseum.mjs` caught it: what a second blade buys
     * on that level is a second creature, and the growth in the party is
     * deliberately super-linear. The renderer limit belongs to what one screen
     * is asked to hold before the party is counted. */
    const perBlade = Math.min(HEAVY_CAP, 1 + Math.floor(this.budgetFor(wave) / 55));
    return Math.max(1, Math.round(perBlade * this.partyScale()));
  }

  /** How likely each entry is to be drawn. One statement, two readers. */
  _typeWeights(types, wave, bigLeft = Infinity) {
    const bias = this.heavyBias(wave);
    let total = 0;
    const w = types.map((t) => {
      const A = ARCHETYPES[t];
      if (!A || (isHeavy(t) && bigLeft <= 0)) return 0;
      const x = Math.pow(Math.max(A.threat, 0.5), bias);
      total += x;
      return x;
    });
    return { w, total };
  }

  _pickType(types, wave, bigLeft) {
    const { w, total } = this._typeWeights(types, wave, bigLeft);
    if (total <= 0) return null;
    let r = rng() * total;
    for (let i = 0; i < types.length; i++) { r -= w[i]; if (r <= 0) return types[i]; }
    return types[types.length - 1];
  }

  /**
   * Spend what the body cap left over on making the bodies worse.
   *
   * Two moves, tried in that order: promote a plain body to an elite, or trade
   * a light archetype for the heaviest one that fits. Both keep the queue the
   * same LENGTH — that is the whole point — and both cost exactly the threat
   * difference, so the wave's total spend still cannot exceed its budget.
   *
   * @returns the budget left after upgrading, which is stranded on purpose:
   *          it is what the wave could not turn into anything worth fighting.
   */
  _upgrade(queue, budget, wave, allowed, shape = null) {
    let guard = 0;
    while (budget > 0 && guard++ < 300) {
      const spent = this._promoteOne(queue, budget, wave, allowed)
        || this._heavierOne(queue, budget, wave, shape);
      /**
       * A MOVE THAT DOES NOT COST ANYTHING IS NOT AN UPGRADE.
       *
       * `!spent` let a NEGATIVE through, and there are real negatives:
       * `MODIFIERS.unstable` is priced `0.85 × threat + 1.8`, which is cheaper
       * than the body it promotes for anything over 12 threat — a charger, a
       * brute, a walker, an AT-TE. So this loop could "spend" −0.3, hand the
       * budget back, and go round again. Measured on the Colosseum at wave 5:
       * the fill stopped correctly with 2.80 left, the upgrade pass promoted a
       * charger to `charger|unstable`, the budget came back up to 3.10 — over
       * the 3.0 a B2 costs — and the wave ended two bodies long with a body it
       * could still afford. `_heavierOne` has always refused a trade that
       * refunds; this is the same rule for the other half of the pass.
       */
      if (!(spent > 0)) break;
      budget -= spent;
    }
    return budget;
  }

  _promoteOne(queue, budget, wave, allowed) {
    if (!allowed.length) return 0;
    for (const i of shuffledOrder(queue.length)) {
      if (spawnMod(queue[i])) continue;
      const t = spawnType(queue[i]);
      const p = this._promote(t, budget, wave, allowed);
      // …and the same rule one level down, so a refunding promotion does not
      // stop the pass looking for one that is an upgrade.
      if (p && p.extra > 0) { queue[i] = `${t}|${p.mod}`; return p.extra; }
    }
    return 0;
  }

  /**
   * `shape` is the condition-scoped view of the roster — see `_composeUnder`.
   * Without it this method would upgrade a No-Guns wave back into a wave with
   * guns in it, which is the §2.4 defect exactly: the fill would honour the
   * condition and the upgrade pass would quietly undo it.
   */
  _heavierOne(queue, budget, wave, shape = null) {
    const types = [...new Set(shape?.types || this.unlockedAt(wave))]
      .sort((a, b) => ARCHETYPES[b].threat - ARCHETYPES[a].threat);
    const bigLeft = (shape?.heavy ?? this.heavyLimit(wave))
      - queue.filter(e => isHeavy(spawnType(e))).length;
    for (const i of shuffledOrder(queue.length)) {
      const entry = queue[i];
      const t = spawnType(entry), mod = spawnMod(entry);
      const now = spawnCost(entry);
      /**
       * EVERY HEAVIER BODY THAT FITS, DRAWN THE WAY THE FILL DRAWS — not the
       * single heaviest one.
       *
       * `break` on the first type that is not heavier, then take it: sorted
       * descending, that is "always trade up to the top of the roster", and it
       * is exactly why `_upgrade` CONVERGES. Every deep wave ended up as N
       * copies of the heaviest thing the level fields, which is the complaint
       * the conditions were built to answer — and once `bodyCap` began to bind
       * there were fewer bodies for it to do that to, so it converged faster
       * and a deep Colosseum wave composed FEWER distinct shapes than a shallow
       * one over the same twelve seeds.
       *
       * The candidates are still only bodies that are heavier and that fit, so
       * this cannot make a wave cheaper or lighter; which of them is taken is
       * drawn through `_pickType`, whose `heavyBias` already leans harder on
       * the heavy end as the run deepens. So depth still pulls upward — it just
       * stops arriving at one answer.
       */
      const up = types.filter((k) => {
        const A = ARCHETYPES[k];
        if (!A || A.threat <= ARCHETYPES[t].threat) return false;
        if (isHeavy(k) && !isHeavy(t) && bigLeft <= 0) return false;
        // A modifier only survives a swap if the new chassis can wear it;
        // dropping one would REFUND threat, which is not an upgrade.
        if (mod && !modifiersFor(k).includes(mod)) return false;
        return (mod ? modifierThreat(k, mod) : A.threat) - now <= budget;
      });
      if (!up.length) continue;
      const k = this._pickType(up, wave, bigLeft) || up[0];
      const next = mod ? modifierThreat(k, mod) : ARCHETYPES[k].threat;
      queue[i] = mod ? `${k}|${mod}` : k;
      return next - now;
    }
    return 0;
  }

  start(wave = 1) {
    if (this.sandbox) {
      // No composition, no budget, no banner: the room is whatever the player
      // last dialled in, and it stays that way until they change it.
      this.wave = 1;
      this.spawnQueue.length = 0;
      this.pending = 0;
      this.active = true;
      this.intermission = 0;
      return;
    }
    /**
     * A RUNG IS NOT A NEW LADDER. `main.js` says `start(1)` on every deploy,
     * including the one a landing re-enters, and it means "the first wave of
     * this level" — which on the third rung of the Descent is wave 8 of the
     * run. Clamping to the floor is what makes those two readings the same
     * number. Everything that legitimately names an absolute wave — the
     * escalation's own `start(this.wave + 1)`, `restartWave`'s
     * `start(director.wave)` — is already above the floor and passes through
     * untouched.
     */
    this.wave = Math.max(wave, this.floor + 1);
    this._compose();
    this.active = true;
    this.intermission = 0;
    /**
     * THE CONDITION IS SAID OUT LOUD, and that is not decoration.
     *
     * Every one of them changes what the player should DO — hold a doorway,
     * stop waiting for bolts to return, go and find the leader — and a rule the
     * player has to infer from being killed by it is a rule they will read as
     * the game being inconsistent. Same argument as the watchdog's notification
     * and `openness()`'s readout: a mechanic nothing announces is a mechanic the
     * player is entitled to think is a bug.
     *
     * Through `world.notify`, which is the one channel this file already uses,
     * so nothing outside it has to know conditions exist to ship them.
     */
    this._head = null;
    this._routed = false;
    for (const c of this.conditionCards) this.world?.notify?.(c.label, c.tell);
    // Per-wave boon charges come back here rather than on wave CLEAR, so a run
    // reloaded mid-ladder still starts its wave with them — see Second Wind.
    refreshWaveBoons(this.world);
    if (this.onWaveStart) this.onWaveStart(this.wave, this.pending);
  }

  /**
   * HAS THIS WAVE ALREADY BEEN PAID FOR?
   *
   * Everything a cleared wave is worth used to hang off the clear SIGNAL, which
   * is fired every time the last body of a wave falls — and `restartWave` (the
   * pause card's own button, reachable in every mode and at any moment) hands
   * the director the same wave number back: `this.director.start(Math.max(1,
   * this.director.wave))`. So the wave was re-composed, re-fought and re-paid,
   * for as many times as the player cared to press it.
   *
   * Measured on a real world, arena/roguelite/knight, seeded, with the player
   * pinned unkillable and drafts answered exactly as main.js's pick callback
   * answers them: reaching wave 2 legitimately gives 1 draft, 1 boon, 3,260
   * score and 2 Insight. Ten restarts of that same wave, each fought to a real
   * clear, gave 11 drafts, 9 boons, 23,660 score and 12 Insight — +10 drafts,
   * +8 boons, +20,400 score, +10 Insight — and `director.wave` read 2 at every
   * single step. World.js's own note on Insight says surviving a wave is the
   * only thing that earns it and that there is nothing here to farm; this was
   * the thing to farm.
   *
   * Highest-paid rather than a set of wave numbers because the ladder only ever
   * goes up: `start()` clamps to `floor + 1`, the escalation asks for
   * `this.wave + 1`, and `restartWave` asks for a number it has already had. A
   * `>` against the high-water mark is the whole rule.
   *
   * NOT reset by `restartWave`, and that is the point — re-composing the wave
   * is what a restart is FOR, and it still does that. What it no longer does is
   * pay for it twice.
   *
   * @returns {boolean} true the first time this wave number is cleared.
   */
  payWave(wave) {
    if (!(wave > this._paid)) return false;
    this._paid = wave;
    return true;
  }

  /**
   * Try to promote one queued body to an elite, if the budget can carry it.
   *
   * The surcharge comes out of the SAME budget the plain bodies are bought
   * with, which is the whole reason modifiers are safe to add: an elite wave is
   * a wave with fewer, nastier bodies in it, not a wave that is secretly three
   * times the intended threat. `tools/checks/escalation.mjs` asserts the total.
   *
   * Weighted by DEPTH, not uniform: a modifier is picked in proportion to the
   * wave it unlocked at, so a run that has earned Leaders sees Leaders rather
   * than being handed the wave-3 Frenzied it has been fighting for twenty
   * waves. Uniform would make the newest, most expensive variant the rarest
   * thing in the wave that just unlocked it.
   *
   * @returns `{mod, extra}`, or 0 when nothing affordable will go on.
   */
  _promote(type, budget, wave, allowed) {
    const options = modifiersFor(type).filter(k => allowed.includes(k));
    if (!options.length) return 0;
    let total = 0;
    for (const k of options) total += MODIFIERS[k].since;
    let r = rng() * total;
    let pick = options[options.length - 1];
    for (const k of options) { r -= MODIFIERS[k].since; if (r <= 0) { pick = k; break; } }
    const extra = modifierThreat(type, pick) - (ARCHETYPES[type]?.threat ?? 0);
    if (extra > budget) return 0;
    return { mod: pick, extra };
  }

  /**
   * The set-piece, as a SHARE of the wave rather than a fixed body.
   *
   * A walker cost 12 out of wave 10's budget of 65 — a fifth of the wave, which
   * is what a boss should feel like. The same walker at wave 30 is 12 out of
   * 353, which is a rounding error wearing a health bar. So the set-piece takes
   * BOSS_SHARE of the budget and keeps buying the heaviest thing the level
   * fields until it has spent it, and from wave 15 the heavies come promoted —
   * a champion, not merely another walker.
   */
  _setPiece(wave, budget, allowed) {
    const out = [];
    let spend = budget * BOSS_SHARE;
    // The old gates, kept: an acklay at wave 5 is not a set-piece, it is the
    // end of the run. Two acolytes, then a walker, then the acklay.
    //
    // …EXCEPT ON THE RUNG THAT CALLS ITSELF THE BOSS RUNG, which is the reader
    // `DESCENT[3].boss` never had. The acklay's rung is written for wave 20 and
    // the whole Descent is sixteen waves long, so the climax of the only mode
    // in the game with an ending was the same pair of acolytes wave 5 opens
    // with — on a level whose pool names `beast` and `walker` explicitly. A
    // rung that declares itself the bottom fields everything its level brought.
    const bottom = !!this.world?.run?.rung?.boss && !this.world.run.done;
    /* …AND IT IS THE WAVE'S OWN SIDE'S LADDER on a level with two armies.
     *
     * Without the third clause a Republic push on Geonosis would be crowned by
     * an OG-9 spider droid and a droideka, which is the mixed field this whole
     * rotation exists to end — and worse on a boss wave than anywhere, because
     * the set-piece is the body the wave is named after. `_sideAllows` answers
     * `true` for every level that declares no armies and in Command mode, so
     * every existing set-piece ladder is untouched.
     *
     * The cost is stated rather than hidden: SET_PIECE holds no Republic body,
     * so a Republic boss wave has no rung to climb and spends the whole
     * set-piece share on the fill instead. That is not a new behaviour — it is
     * what the IG bodyguard's own note records happening on the foundry before
     * wave 10 ("what wave 5 gets instead is the whole budget spent on bodies")
     * — and on a 620 m plain a clone assault two dozen bodies deep is a
     * legitimate climax. Adding an AT-TE rung would fix it and would ALSO put an
     * AT-TE in front of a player who is commanding the Republic, because
     * `_setPiece` is not filtered by side in Command mode; that is Command's
     * lane and it is written up in the handover. */
    const ladder = SET_PIECE.filter(s => (bottom || wave >= s.from)
      && this.pool.includes(s.type) && this._sideAllows(s.type, wave))
      .map(s => s.type);
    if (!ladder.length) return out;
    /* ONE OF EACH RUNG, heaviest first — not N copies of the heaviest. Two
     * acklays is not an escalation of one acklay, it is the same fight twice at
     * once; an acklay with a walker behind it is a different problem.
     *
     * …AND THE PARTY MOVES IT, which it did not. `budgetFor` scales by
     * `partyScale()` and so does `heavyLimit`; this cap was the one number in
     * the set-piece path that did not, so the extra threat four blades bought
     * had nowhere to go but the ordinary fill. Measured through the real
     * composer: one, two and four players all fielded exactly TWO set-piece
     * bodies at waves 10 and 20, and at four blades 143 of 513 threat went to
     * the crowd instead of to the thing the wave is named after. A co-op boss
     * wave was a solo boss wave with more droids around it. */
    const most = Math.round((wave >= CHAMPION_FROM ? 3 : 2) * this.partyScale());
    // Never less than two of the lightest rung: at wave 5 that is exactly the
    // pair of acolytes the hand-written branch used to push, for exactly the
    // 12 threat it used to subtract.
    spend = Math.max(spend, ARCHETYPES[ladder[ladder.length - 1]].threat * 2);
    let bigLeft = this.heavyLimit(wave);
    for (const t of ladder) {
      if (out.length >= most) break;
      if (ARCHETYPES[t].threat > spend) continue;
      if (isHeavy(t) && bigLeft <= 0) continue;
      let cost = ARCHETYPES[t].threat;
      let entry = t;
      if (wave >= CHAMPION_FROM) {
        const p = this._promote(t, spend - cost, wave, allowed);
        if (p) { entry = `${t}|${p.mod}`; cost += p.extra; }
      }
      if (isHeavy(t)) bigLeft--;
      out.push(entry);
      spend -= cost;
    }
    // The earliest boss waves have only one rung to climb, so it comes twice.
    const last = ladder[ladder.length - 1];
    if (out.length === 1 && ladder.length === 1 && ARCHETYPES[last].threat <= spend) out.push(last);
    return out;
  }

  /* ── conditions ──────────────────────────────────────────────────── */

  /**
   * How deep a condition unlocks — and it is the SAME LADDER in both modes,
   * started earlier in the one that has nothing else.
   *
   * `CONDITIONS[k].since` is authored against Path of the Blade, where the
   * ladder resumes at CONDITION_FROM because that is where the modifier ladder
   * stopped. The Trial of Waves has no cards at all, so its ladder starts at
   * TRIAL.from and every rung shifts with it rather than being typed twice —
   * a second `sinceTrial` column beside this one is §2.3's defect exactly.
   */
  conditionSince(key) {
    const shift = this.drafts ? 0 : (CONDITION_FROM - TRIAL.from);
    return Math.max(1, (CONDITIONS[key]?.since ?? Infinity) - shift);
  }

  /** Which conditions this depth has earned. Mirrors `modifiersAt`. */
  conditionsAt(wave) {
    return CONDITION_KEYS.filter((k) => wave >= this.conditionSince(k));
  }

  /**
   * Does the cadence put one on this wave at all?
   *
   * A wave every CONDITION_EVERY, so two thirds of them stay plain and a
   * condition still reads as a change. Deep waves get theirs a second way —
   * see the surplus loop in `_compose` — which is why this is only the FLOOR.
   */
  scheduledCondition(wave) {
    // A mode with no card draft runs the Trial's cadence: it is what that mode
    // has instead of a build. `drafts` is the existing statement of which modes
    // those are, called rather than restated (§2.4).
    const { from, every } = this.drafts ? { from: CONDITION_FROM, every: CONDITION_EVERY } : TRIAL;
    return wave >= from && (wave - from) % every === 0;
  }

  /* ── run rules ───────────────────────────────────────────────────── */

  /**
   * Why this theatre cannot be fought under this rule, or null when it can.
   *
   * The veto is `needs`, which already exists and is already the authority —
   * this only asks it at a depth where the answer is about the theatre's
   * roster and not about how shallow the question was (see `ruleDepth`), and
   * turns the boolean into the line the Deploy panel prints.
   *
   * `needs(types, d)` reads `d.wave` — `vanguard`'s asks whether the standard
   * has unlocked — so the depth is installed on the director for the length of
   * the call rather than passed as a third argument nothing else would use.
   */
  ruleVeto(key) {
    const C = CONDITIONS[key];
    if (!C) return 'no such rule';
    if (!C.needs) return null;
    const at = ruleDepth();
    const was = this.wave;
    this.wave = at;
    let ok = false;
    try { ok = !!C.needs(this.unlockedAt(at), this); } finally { this.wave = was; }
    return ok ? null : (C.unmet || 'this theatre cannot field it');
  }

  /**
   * The rules this theatre will actually be fought under, given what was asked.
   *
   * Three filters, all of them rules that already existed for the dealt path:
   * the theatre's veto, the pair exclusions, and CONDITION_MAX. Order is the
   * player's, and a rule dropped here is dropped because the menu should never
   * have offered it — which is why the menu asks the same two methods.
   */
  legalRuleSet(keys) {
    const out = [];
    for (const k of keys || []) {
      if (!CONDITIONS[k] || out.includes(k)) continue;
      if (out.length >= CONDITION_MAX) break;
      if (this.ruleVeto(k)) continue;
      if (out.some((h) => rulesConflict(h, k))) continue;
      out.push(k);
    }
    return out;
  }

  /**
   * The rules in force, resolved once and cached. See the constructor.
   *
   * A pair rather than a field because `Menu._syncRules` writes it — the panel
   * re-legalises the player's picks against the theatre they have just chosen
   * and hands the answer straight back — and because a lazily resolved value
   * that could be overwritten by a plain assignment would resolve itself again
   * on the next read and throw the write away.
   */
  get rules() {
    if (this._rules) return this._rules;
    this._rules = [];
    this._rules = this.legalRuleSet(this._ruleAsk);
    return this._rules;
  }

  set rules(v) { this._rules = Array.isArray(v) ? v.slice() : []; }

  /** What the Deploy panel prints, and what `Progress.byRule` is keyed on. */
  get ruleLabel() {
    if (!this.rules.length) return '';
    return this.rules.map((k) => CONDITIONS[k].label).join(' + ');
  }

  /**
   * What a set of conditions is charged against this wave's budget.
   *
   * A RUN RULE IS FREE, and that is the one line that decides whether rules are
   * a handicap or a discount. See the RUN RULES block: a dealt condition takes
   * a share of the wave's budget, so the wave is smaller in exchange for being
   * strange; a rule the player asked for buys the strangeness on top of the
   * whole wave. Charged, NO GUNS would be the cheapest way to reach wave 40.
   */
  conditionCost(wave, keys) {
    let s = 0;
    for (const k of keys || []) {
      if (this.rules.includes(k)) continue;
      s += (CONDITIONS[k]?.worth ?? 0);
    }
    return s * this.budgetFor(wave);
  }

  /**
   * One more condition, or null.
   *
   * Weighted by DEPTH exactly as `_promote` weights modifiers, and for the same
   * reason: a run that has earned the Heavy Guard should meet it rather than be
   * handed the No-Guns it has been fighting since wave 14.
   */
  _pickCondition(wave, taken, types, purse = Infinity) {
    const held = new Set(taken);
    const options = this.conditionsAt(wave).filter((k) => {
      if (held.has(k)) return false;
      const C = CONDITIONS[k];
      // WHAT THE SURPLUS CAN ACTUALLY BUY. Without this the loop would draw a
      // condition, find it unaffordable and stop — measured, that left 22% of
      // wave 140's budget stranded because the one option left was the most
      // expensive in the table and 1500 threat of surplus could not reach it.
      if (C.worth * this.budgetFor(wave) > purse) return false;
      if (C.excludes && C.excludes.some((x) => held.has(x))) return false;
      for (const h of held) if (CONDITIONS[h].excludes?.includes(k)) return false;
      return !C.needs || C.needs(types, this);
    });
    if (!options.length) return null;
    let total = 0;
    for (const k of options) total += this.conditionSince(k);
    let r = rng() * total;
    for (const k of options) { r -= this.conditionSince(k); if (r <= 0) return k; }
    return options[options.length - 1];
  }

  /**
   * The roster and the caps AS THIS WAVE'S CONDITIONS LEAVE THEM.
   *
   * One place, because three consumers need the same answer — the fill loop,
   * `_heavierOne` and the spawn cadence in `update` — and three copies of it is
   * how a No-Guns wave ends up with guns in it.
   */
  _shapeUnder(wave, keys) {
    const cs = (keys || []).map((k) => CONDITIONS[k]).filter(Boolean);
    let types = this.unlockedAt(wave);
    let allowed = this.modifiersAt(wave);
    let heavy = this.heavyLimit(wave);
    let capScale = 1;
    let chance = this.eliteChance(wave), alive = this.maxAlive, pace = 1;
    for (const c of cs) {
      if (c.types) {
        const narrowed = c.types(types, this, wave);
        // A condition never empties the field: a level whose pool cannot
        // satisfy it keeps the wave it would otherwise have had.
        if (narrowed.length) types = narrowed;
      }
      if (c.allow) allowed = c.allow(allowed, this, wave);
      capScale = capScale * (c.capScale ?? 1);
      heavy = heavy * (c.heavyScale ?? 1);
      chance = chance * (c.eliteScale ?? 1);
      alive = alive * (c.aliveScale ?? 1);
      pace = pace * (c.paceScale ?? 1);
    }
    // AFTER the narrowing, not before it: the cap is an allowance in threat and
    // `bodyCap` converts it at the price of the roster it is handed. Computed
    // first, it would price a No-Guns wave off bodies that wave cannot field.
    const cap = this.bodyCap(wave, types) * capScale;
    return {
      types, allowed,
      cap: Math.max(1, Math.round(cap)),
      // Still `HEAVY_CAP` at the top, and it is still a frame-rate number.
      heavy: Math.max(1, Math.min(Math.round(HEAVY_CAP * this.partyScale()), Math.round(heavy))),
      chance: clamp(chance, 0, 1),
      alive: Math.max(4, Math.round(alive)), pace,
      bearing: cs.some((c) => c.bearing),
      head: cs.some((c) => c.head),
    };
  }

  /**
   * Compose one wave under a stated set of conditions.
   *
   * Split out of `_compose` so the same arithmetic can be run more than once —
   * see the surplus loop there — and so nothing has to PREDICT what the wave
   * will strand. The stranding is measured by composing, which is the rule
   * itself rather than a model of it.
   *
   * @returns {{queue: string[], left: number, shape: object}} `left` is the
   *          budget the roster could not absorb, which is what buys the next
   *          condition.
   */
  _composeUnder(wave, keys) {
    const w = wave;
    const shape = this._shapeUnder(w, keys);
    // Charged up front and out of the same budget the bodies are bought with,
    // exactly as `_promote` charges a modifier. See CONDITIONS.
    let budget = this.budgetFor(w) - this.conditionCost(w, keys);
    const queue = [];

    if (this.isBossWave(w)) {
      for (const entry of this._setPiece(w, budget, shape.allowed)) {
        queue.push(entry);
        budget -= spawnCost(entry);
      }
    }

    /**
     * THE HEAD IS BOUGHT BEFORE THE FILL, not after it.
     *
     * It was bought last, out of whatever the wave had left, and the check
     * written for it caught the consequence on its first run: **twelve
     * vanguard waves produced zero leaders.** `_upgrade` spends the budget down
     * to nothing by construction — that is its entire job — so a head paid for
     * afterwards can never be afforded, and A HEAD TO CUT OFF was a banner over
     * an ordinary wave. A condition that silently does not happen is worse than
     * one that is too strong: the player is told a rule and then the rule is
     * not there.
     *
     * So it is reserved first, exactly as the set-piece is, and moved into
     * position after the shuffle. The heaviest chassis in the wave's own
     * roster, so the head is worth cutting to.
     */
    if (shape.head) {
      const wearable = [...new Set(shape.types)]
        .filter((t) => modifiersFor(t).includes('leader'))
        .sort((a, b) => ARCHETYPES[b].threat - ARCHETYPES[a].threat);
      for (const t of wearable) {
        const cost = modifierThreat(t, 'leader');
        if (cost > budget) continue;
        queue.push(`${t}|leader`);
        budget -= cost;
        break;
      }
    }

    let guard = 0;
    while (budget > 0 && queue.length < shape.cap && guard++ < 400) {
      const bigLeft = shape.heavy - queue.filter(e => isHeavy(spawnType(e))).length;
      /**
       * DRAW FROM WHAT IS STILL AFFORDABLE, not from the whole roster.
       *
       * This drew from `shape.types` and broke the moment the draw came back
       * unaffordable, so a wave stopped composing on the first expensive body
       * it happened to roll rather than when its budget was gone. It only shows
       * up where the roster's spread is wide against a small budget, which is
       * exactly the shallow waves of the levels with the richest pools: measured
       * on the Ember Shelf, wave 1 stranded 43% and wave 2 36% of their budget,
       * because a Jedi costs 6 against a wave-1 budget of 7 and one unlucky draw
       * ended the wave. Nothing caught it because the checks composed on a
       * fixture pool of B1s.
       *
       * THE FIRST BODY IS EXEMPT, AND WHEN IT IS EXEMPT IT IS THE CHEAPEST ONE.
       *
       * A wave has to have something in it even when the cheapest thing the
       * theatre still fields costs more than the whole budget — which never
       * happened while conditions arrived no earlier than wave 13, and happens
       * the moment a RUN RULE narrows the roster on wave 1. Measured: the
       * Colosseum under NO GUNS at wave 1 drew a brute and spent 14 against a
       * budget of 7, doubling the opening wave of the game. Drawing at random
       * from the whole narrowed roster made the size of that overspend a matter
       * of luck; taking the cheapest makes it the smallest it can possibly be,
       * which is the only honest amount to be over by.
       */
      /* EPS because `budget` is a running subtraction of fractional threats:
       * measured on the Drowned Wood at wave 10, a wave with exactly 1.0 left
       * and a B1 costing exactly 1 held 0.9999999999999964 and refused it. An
       * exact `<=` on an accumulated float is a coin toss, not a rule. */
      const EPS = 1e-9;
      const affordable = shape.types.filter((t) => (ARCHETYPES[t]?.threat ?? Infinity) <= budget + EPS);
      let t;
      if (affordable.length) t = this._pickType(affordable, w, bigLeft);
      else if (queue.length) break;
      else {
        t = shape.types.slice()
          .sort((a, b) => (ARCHETYPES[a]?.threat ?? Infinity) - (ARCHETYPES[b]?.threat ?? Infinity))[0];
      }
      if (!t) break;
      let cost = ARCHETYPES[t].threat;
      if (cost > budget + EPS && queue.length > 0) break;
      let entry = t;
      if (shape.allowed.length && rng() < shape.chance) {
        const p = this._promote(t, budget - cost, w, shape.allowed);
        if (p) { entry = `${t}|${p.mod}`; cost += p.extra; }
      }
      queue.push(entry);
      budget -= cost;
    }
    // Past the body cap the wave stops growing and starts improving.
    budget = this._upgrade(queue, budget, w, shape.allowed, shape);

    // shuffle so the dangerous ones aren't all last
    for (let i = queue.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [queue[i], queue[j]] = [queue[j], queue[i]];
    }

    /**
     * …AND THE HEAD IS PUT BACK DEEP IN THE QUEUE.
     *
     * The whole value of "kill the leader and it ends" is that the leader is
     * BEHIND the wave, so the shortcut has to be cut to rather than sniped off
     * the front rank. Found by looking for the `leader` entry rather than by
     * remembering an index, because `_heavierOne` may have swapped its chassis
     * for a heavier one in between — and because that is the same way `update`
     * finds the body once it is standing. The modifier is out of `allowed` for
     * the fill (see CONDITIONS.vanguard), so there is exactly one.
     */
    if (shape.head && queue.length > 1) {
      const i = queue.findIndex((e) => spawnMod(e) === 'leader');
      if (i >= 0) {
        const at = Math.min(queue.length - 1, Math.floor(queue.length * 0.65));
        const [head] = queue.splice(i, 1);
        queue.splice(at, 0, head);
      }
    }

    return { queue, left: budget, shape };
  }

  _compose() {
    const w = this.wave;

    if (this.mode === 'duel') { this._composeDuel(w); return; }

    /**
     * THE CONDITIONS, BOUGHT THE WAY EVERYTHING ELSE IN THIS FILE IS BOUGHT.
     *
     * One from the cadence, and then as many more as the budget the ROSTER
     * CANNOT ABSORB will pay for. That second clause is the load-bearing one:
     * measured on kamino, wave 70 strands 9% of its budget, wave 100 strands
     * 41% and wave 140 strands 65% — because `_upgrade` converges on the
     * heaviest body the level fields and there is nothing else to buy. That
     * surplus used to be discarded and the escalation flattened with it. It is
     * now the thing that makes a deep wave a different question.
     *
     * The loop RE-COMPOSES rather than predicting the surplus, because the only
     * honest statement of what a wave can absorb is composing one (HANDOFF
     * §2.4: an instrument that restates a rule will eventually disagree with
     * it). Composition is arithmetic over at most a few hundred entries, and
     * this runs once per wave.
     */
    /**
     * THE RUN'S RULES ARE IN THE SET BEFORE ANYTHING IS DRAWN.
     *
     * Unioned at the top rather than merged afterwards, so everything below
     * this line — the cadence draw, the exclusions, the surplus loop and
     * CONDITION_MAX — sees them as conditions the wave is already carrying.
     * `_pickCondition` will therefore not draw one the rules exclude, and a run
     * fought under four rules is simply a wave whose set is already full.
     */
    const conditions = this.rules.slice(0, CONDITION_MAX);
    const types = this.unlockedAt(w);
    if (this.scheduledCondition(w) && conditions.length < CONDITION_MAX) {
      const k = this._pickCondition(w, conditions, types);
      if (k) conditions.push(k);
    }
    let out = this._composeUnder(w, conditions);
    while (conditions.length < CONDITION_MAX) {
      const k = this._pickCondition(w, conditions, types, out.left);
      if (!k) break;
      conditions.push(k);
      out = this._composeUnder(w, conditions);
    }

    this.conditions = conditions;
    this.shape = out.shape;
    // Drawn here rather than at the first spawn so the whole wave shares one
    // quarter however it is delivered, and so it is part of the seeded stream:
    // a seed is a run, and a run's fronts have to be the same fronts.
    this._bearingAt = out.shape.bearing ? rng() * TAU : null;
    this.spawnQueue = out.queue;
    this.pending = out.queue.length;
  }

  /** What the banner and the checks read: this wave's conditions, as cards. */
  get conditionCards() {
    return (this.conditions || []).map((k) => ({ key: k, ...CONDITIONS[k] }));
  }

  /* ── the duel ladder ─────────────────────────────────────────────── */

  /**
   * THE DUEL FOUGHT ONE BODY, AND THE MACHINERY FOR SIX WAS ALREADY BUILT.
   *
   * The old composition was `min(1 + floor(w/2), 6)` acolytes and nothing else.
   * Measured over sixty waves and twelve seeds: **fifteen distinct
   * compositions, one enemy type**, saturating at six bodies by wave 10. So the
   * mode called Duel escalated by adding a seventh identical opponent and then
   * stopped.
   *
   * What makes that worth fixing rather than merely tuning is what it was
   * refusing to use. `Duel.js` is a thousand lines of blade-lock, chambering,
   * parry windows and five authored FORMS, and Enemy.js's own note says in as
   * many words that the four Jedi were given declared forms so that a player
   * could learn "that is Djem So, it commits hard, punish the recovery". Every
   * one of them — Soresu, Ataru, Djem So, Juyo, Makashi — has a different
   * ANSWER, written down beside it, and the duel mode fielded none of them.
   *
   * So the ladder is the roster, DERIVED rather than typed: every archetype
   * that carries a saber, in threat order, one new one every DUEL_RUNG waves.
   * A duellist added to the game joins the ladder on the day it is added, which
   * is the property `SANDBOX_ORDER` had to be rewritten to get (§2.3), and the
   * bosses — the Jedi Master and the Magnaguard captain, both `setPieceOnly` —
   * are the top rung rather than a seventh acolyte.
   *
   * Lazy, like `sandboxKeys`: Levels.js registers seventeen more archetypes
   * after this module finishes evaluating.
   */
  duelRoster() {
    const all = Object.keys(ARCHETYPES)
      .filter((k) => ARCHETYPES[k].saber && !ARCHETYPES[k].inert && (ARCHETYPES[k].threat ?? 0) > 0)
      .sort((a, b) => (ARCHETYPES[a].threat - ARCHETYPES[b].threat) || (a < b ? -1 : 1));
    return {
      rungs: all.filter((k) => !ARCHETYPES[k].boss),
      bosses: all.filter((k) => ARCHETYPES[k].boss),
    };
  }

  /** How many rungs of the ladder this depth has opened. */
  duelTier(wave) {
    const { rungs } = this.duelRoster();
    return clamp(1 + Math.floor(Math.max(0, wave - 1) / DUEL_RUNG), 1, Math.max(1, rungs.length));
  }

  /** How many blades stand against you. A duel stays a duel. */
  duelSize(wave) {
    return clamp(1 + Math.floor(Math.max(0, wave - 1) / DUEL_PAIR), 1, DUEL_MAX);
  }

  _composeDuel(w) {
    const { rungs, bosses } = this.duelRoster();
    const open = rungs.slice(0, this.duelTier(w));
    const allowed = this.modifiersAt(w);
    const queue = [];

    /**
     * THE BOSS RUNG. Every BOSS_EVERY waves the thing you meet is not on the
     * ladder at all — and the two alternate, so the fifth wave and the tenth
     * are different fights rather than the same body twice.
     */
    if (this.isBossWave(w) && bosses.length) {
      const b = bosses[(Math.floor(w / BOSS_EVERY) - 1) % bosses.length];
      const p = w >= CHAMPION_FROM && allowed.length ? this._promote(b, Infinity, w, allowed) : 0;
      queue.push(p ? `${b}|${p.mod}` : b);
    }

    /**
     * The rest, drawn from the open rungs with the same threat weighting the
     * horde uses — so the newest rung is the one you meet most, and the acolyte
     * you have been beating since wave 1 becomes the escort rather than the
     * fight. `heavyBias` is deliberately reused rather than restated: it IS the
     * "lean on the heavy end as depth grows" rule (§2.4).
     */
    const want = this.duelSize(w) - queue.length;
    // A duel has no budget to spend, so the elites are gated on depth alone.
    let elites = w < DUEL_ELITE_FROM ? 0 : 1 + Math.floor((w - DUEL_ELITE_FROM) / 20);
    for (const e of queue) if (spawnMod(e)) elites--;
    for (let i = 0; i < want; i++) {
      const t = this._pickType(open, w, DUEL_MAX) || open[open.length - 1];
      let entry = t;
      if (elites > 0 && allowed.length) {
        const p = this._promote(t, Infinity, w, allowed);
        if (p) { entry = `${t}|${p.mod}`; elites--; }
      }
      queue.push(entry);
    }

    this.conditions = [];
    this.shape = null;
    this.spawnQueue = queue;
    this.pending = queue.length;
  }

  /* ── sandbox ─────────────────────────────────────────────────────── */

  /** Uniform pick from the level's pool, which is already weighted by repeats. */
  _sandboxType(cfg) {
    if (cfg.type !== 'mixed') return cfg.type;
    if (!this.pool.length) return 'b1';
    return this.pool[Math.floor(rng() * this.pool.length)];
  }

  /**
   * Somewhere on a ring you can walk to.
   *
   * `pickSpawn` uses the LEVEL's ring — 34 to 56 m on the dunes — which is
   * right for a wave marching in and wrong for practice, where the point is to
   * be fighting within a couple of seconds of moving the slider. Terrain bounds
   * and slope are still respected, and the level's own ring is the fallback.
   */
  _sandboxSpawn(ctx, type) {
    const t = this.world.terrain;
    const anchor = this.world.player ? this.world.player.position : null;
    const ring = ARCHETYPES[type]?.inert ? SANDBOX_RING_INERT : SANDBOX_RING;
    if (t && anchor) {
      for (let i = 0; i < 24; i++) {
        const a = rng() * TAU;
        const r = lerp(ring[0], ring[1], rng());
        const x = anchor.x + Math.cos(a) * r;
        const z = anchor.z + Math.sin(a) * r;
        if (!t.inBounds(x, z, 8)) continue;
        if (t.slopeAt(x, z) > 0.5) continue;
        return new THREE.Vector3(x, t.height(x, z), z);
      }
    }
    return ctx.pickSpawn(type);
  }

  /**
   * The whole sandbox: hold the population at `count`, hold the trigger at
   * `fire`. Both are re-read every frame off `world.settings`, which is the
   * same object the menu writes to — so a slider moved on the pause screen is
   * live the moment the game unpauses, with no restart and no reload.
   */
  _sandboxUpdate(dt, ctx) {
    const cfg = sandboxConfig(this.world.settings);
    // The ships have to fly. `update` returns here before it reaches the
    // arrivals step, so without this the sandbox's own arrivals would be queued
    // and never delivered — the room would simply stop producing bodies, which
    // is a worse failure than the teleport it replaced.
    this.arrivals.update(dt, ctx);

    // Fire rate rides the difficulty's own divisor. Cloned, never mutated in
    // place: DIFFICULTY entries are shared module constants and scaling one
    // would follow the player into their next run.
    if (this._fireApplied !== cfg.fire) {
      this._diffBase = this._diffBase || this.world.difficulty;
      if (this._diffBase) {
        // At 1× hand back the original object rather than an identical copy —
        // a run that never touches the slider should be indistinguishable from
        // one in a mode that has no slider.
        this.world.difficulty = cfg.fire === 1 ? this._diffBase
          : { ...this._diffBase, fireRate: (this._diffBase.fireRate ?? 1) * Math.max(cfg.fire, 1e-3) };
      }
      this._fireApplied = cfg.fire;
      for (const e of this.world.enemies) tuneFireRate(e, cfg.fire);
    }

    const alive = [];
    for (const e of this.world.enemies) if (!e.dead) alive.push(e);
    if (cfg.fire <= 0) for (const e of alive) holdFire(e);
    /* A body that arrived by ship missed the `_fireApplied` edge above — that
     * only fires when the SLIDER moves — so it would come off the ramp at the
     * archetype's own cadence in a room dialled to a tenth of it. Tuned once,
     * on arrival, marked so it is not re-tuned every frame. */
    for (const e of alive) {
      if (e._sbFire === cfg.fire) continue;
      e._sbFire = cfg.fire;
      tuneFireRate(e, cfg.fire);
      if (cfg.fire <= 0) holdFire(e);
    }

    // Decide what STAYS, which is the only formulation that handles both ways
    // the room can be wrong at once: too many bodies, and bodies of a kind you
    // stopped asking for. Keep up to `count` of the right archetype, nearest
    // first — so switching the picker converges instead of waiting for you to
    // kill the old ones, and shrinking the count takes the far edge of the room
    // rather than the fight you are standing in.
    const anchor = this.world.player ? this.world.player.position : null;
    const right = cfg.type === 'mixed' ? alive.slice() : alive.filter(e => e.type === cfg.type);
    if (anchor) right.sort((a, b) => a.position.distanceToSquared(anchor) - b.position.distanceToSquared(anchor));
    const keep = new Set(right.slice(0, cfg.count));
    if (keep.size < alive.length) {
      for (const e of alive) {
        if (keep.has(e)) continue;
        const idx = this.world.enemies.indexOf(e);
        if (idx >= 0) this.world.enemies.splice(idx, 1);
        this.world.bladeSolver?.clearTarget?.(e.id);
        e.dispose();
      }
    }

    // Floored: a full room runs this every frame and an unclamped countdown
    // would be at -3600 after an hour, which is a spawn that never waits again.
    this.spawnTimer = Math.max(this.spawnTimer - dt, -1);
    /* Bodies already on a ship or walking in count against the population, or
     * the room asks for twenty more the whole time the first twenty are inbound
     * and lands forty. The wave path has counted `arrivals.pending` for exactly
     * this reason since arrivals shipped; the sandbox path never had to. */
    const inbound = this.arrivals.enabled ? this.arrivals.pending : 0;
    if (keep.size + inbound < cfg.count && this.spawnTimer <= 0) {
      const type = this._sandboxType(cfg);
      /* THE DEFAULT IS AN ARRIVAL — note #17. `request` returns false when
       * arrivals are off (`settings.instantSpawn`), and then the old direct
       * path runs exactly as it always did, because a room must never fail to
       * produce the body the slider asked for. */
      if (!this.arrivals.request(type, null)) {
        const e = ctx.spawnEnemy(type, this._sandboxSpawn(ctx, type));
        tuneFireRate(e, cfg.fire);
        if (cfg.fire <= 0) holdFire(e);
      }
      this.totalSpawned++;
      // Fast enough that dialling 0 → 20 fills the room in three seconds,
      // slow enough that twenty bodies do not all build their rigs on one frame.
      this.spawnTimer = 0.15;
    }
  }

  /**
   * DOES THIS BODY KEEP THE WAVE OPEN? — the one statement of the rule, and it
   * now has three callers that used to have three copies of it.
   *
   * `ctx.enemies` is `world.enemies`, and Command puts YOUR OWN TROOPS in that
   * same array: an ally is an `Enemy` with a different `team`. So "how many
   * enemies are left" is not "how many bodies are left", and every place that
   * confused the two was wrong in a different way:
   *
   *   `update`      cleared a wave the instant your army died and never while
   *                 it lived — fixed once, in place, with this arithmetic
   *                 written out inline;
   *   `remaining`   is what the HUD prints as "N remaining" and what the co-op
   *                 host puts on the wire, and it counted every trooper you own
   *                 — so a Command wave of six droids read as sixteen, and it
   *                 never reached zero while you had an army;
   *   `_watchdog`   accumulated its stall clock against your own troops, which
   *                 is the whole of the "take cover is destroyed by the
   *                 watchdog" defect. A body that cannot keep the wave open
   *                 cannot be the reason it has not ended, so there is nothing
   *                 for the watchdog to be protecting the run from. Driven: ten
   *                 troopers ordered to hold ground 83 m from a moving
   *                 commander were rescued or retired 19 times in 88 s, because
   *                 the clock measures distance to a PLAYER and an ordered body
   *                 is standing exactly where it was told to stand.
   *
   * `?? 1` for the team, because a stub body in a check has none and the horde
   * is team 1 everywhere else in the tree.
   */
  blocksWaveEnd(e) {
    return !!e && !e.dead && (e.team ?? 1) !== (this.world?.partyTeam ?? 0);
  }

  /**
   * NOTHING LEFT TO PUT ON THE FIELD — the bodies standing are the whole wave.
   *
   * The watchdog's warrant (a stalled body is only terminal once it is the last
   * thing between the player and the next wave) and Command's endgame leash
   * release both ask this same question, and they used to ask it with two
   * copies of the same conjunction.
   */
  get delivered() { return !this.spawnQueue.length && !this.arrivals.pending; }

  /**
   * ONE FRAME OF THE WATCHDOG. See the note above STALL_RESCUE.
   *
   * Per body it keeps four numbers — the closest it has ever been to a player,
   * the health it had last frame, how long it has been getting neither closer
   * nor hurt, and how many times it has already been rescued. `best` is a
   * high-water mark rather than a per-frame delta, so a body that oscillates
   * around a pillar (which a real one does, constantly) does not read as
   * progress and a body that is genuinely orbiting at its preferred range does:
   * a marksman holding 42 m has already got its `best` down to 42 and is not
   * accumulating.
   *
   * Keyed on the enemy object in a WeakMap, so a body that is disposed by any of
   * the other five paths that dispose bodies takes its record with it. A Map
   * keyed on id was the first shape and it leaks one small object per body for
   * the life of the level — 3 000 of them over a forty-wave run.
   */
  _watchdog(dt, ctx) {
    const list = ctx.enemies;
    if (!list || !list.length) return;
    const players = this.world?.players;
    const w = this._watch || (this._watch = new WeakMap());
    // The wave is otherwise finished: nothing queued, nothing in the air. This
    // is the state note #7 describes, and it is the state in which a stalled
    // body is not merely annoying but terminal.
    const blocking = this.delivered;

    for (const e of list) {
      if (!e || e.dead) continue;
      let r = w.get(e);
      if (!r) { r = { best: Infinity, hp: e.hp, t: 0, n: 0 }; w.set(e, r); }

      /* INVALID beats every clock. There is no number of seconds for which
       * being under the terrain or outside the heightfield is acceptable, and
       * `_stuckT` cannot see either — a body falling through the world is
       * moving, so the local handling reads it as healthy right up until it is
       * at y = -400 and the wave has stopped. */
      if (!positionIsValid(this.world, e)) {
        /* …AND THE RESCUE CAN FAIL, WHICH THE FIRST DRAFT OF THIS DID NOT
         * ALLOW FOR. `tools/checks/command.mjs` caught it end to end: the site
         * picker gives up onto the ring when twenty tries all miss, and on a
         * world whose bounds are tighter than `ring × MARCH_RADIUS` that
         * give-up point is ITSELF outside the heightfield. So the body was
         * moved from one impossible place to another, this branch `continue`d
         * without touching either clock, and the wave still never ended — the
         * watchdog looping forever on the exact bug it exists to survive. The
         * rescue COUNT is the bound, and past it the body is withdrawn. */
        if (r.n >= STALL_RESCUES) this._retire(e, r, 'invalid position, unrescuable');
        else this._rescue(e, r, ctx, 'invalid position');
        continue;
      }

      /**
       * A BODY THAT CAN FIGHT IS NOT STUCK, however still it is standing.
       *
       * The other direction, and it is the one that matters more: a watchdog
       * that teleports a marksman doing its job correctly is worse than the bug
       * it fixes. Measured on the shipped roster, a sniper's `preferred` band is
       * [22, 42] m — it is SUPPOSED to hold station, it will never close, and
       * nothing will hurt it while it is doing so. Under the clocks alone it
       * accumulated the full retire time and was withdrawn mid-fight, which
       * `tools/checks/command.mjs` caught on the first run.
       *
       * The discriminator is the archetype's OWN engagement band, which is the
       * only honest statement of "can this body reach the fight from here": a
       * marksman at 38 m is where it wants to be, an acolyte at 38 m (preferred
       * [1.6, 3.4]) has manifestly failed to arrive. Read off `preferred` rather
       * than a constant, so a body added tomorrow is judged by its own reach.
       *
       * The margin is generous — 1.5× the far edge plus 6 m — because the cost
       * of being wrong in this direction is a body removed from a live fight and
       * the cost of being wrong in the other is a body removed thirty seconds
       * later than it might have been.
       */
      const reach = (e.A?.preferred?.[1] ?? 12) * 1.5 + 6;

      let d = Infinity;
      for (const p of players || []) {
        if (!p || p.alive === false) continue;
        const dd = p.position.distanceToSquared(e.position);
        if (dd < d) d = dd;
      }
      d = Math.sqrt(d);
      const closed = d < r.best - STALL_PROGRESS;
      const hurt = e.hp !== r.hp;
      if (closed) r.best = d;
      r.hp = e.hp;
      if (closed || hurt) { r.t = 0; continue; }

      // Only accumulate while the body is the reason the wave has not ended.
      // A stalled body in the middle of a live wave is a body the player has not
      // got to yet, and moving it would be the watchdog playing the game.
      //
      // …AND ONLY IF IT COULD BE THAT REASON AT ALL. `blocksWaveEnd` is the
      // same rule the wave-end count is made of, called rather than restated:
      // one of your own troops never holds a wave open, so a trooper standing
      // where its ORDER put it — which for `cover` is a spot the commander has
      // since walked 80 m away from — has nothing to be rescued from. It was
      // being teleported out of its own firing position instead.
      if (!blocking || !this.blocksWaveEnd(e)) continue;
      // …and only while it cannot fight from where it is standing. See `reach`.
      if (d <= reach) { r.t = 0; continue; }
      r.t += dt;
      if (r.t > STALL_RETIRE || (r.t > STALL_RESCUE && r.n >= STALL_RESCUES)) {
        this._retire(e, r, 'unreachable');
      } else if (r.t > STALL_RESCUE) {
        this._rescue(e, r, ctx, 'no progress');
      }
    }
  }

  /**
   * PUT A BODY BACK SOMEWHERE THE LEVEL SAYS IS VALID.
   *
   * Through `arrivals.relocate`, which reuses the site picker every march
   * already uses — terrain bounds, slope and `spawnClear` — and drops the body
   * at MARCH radius, beyond the ring anything is spawned at. So the recovery
   * looks exactly like a march: the body walks back into the fight from the
   * edge, which is the one arrival note #17 approves of, and it lands in the
   * arrival log so `deliveryIsAnnounced` covers it like any other delivery.
   *
   * The IDENTITY IS KEPT. A fresh spawn would be simpler and is wrong in the one
   * mode where it matters most: a body in Command carries a name, a rank and a
   * campaign's worth of experience, and replacing it would kill a trooper the
   * player has been protecting in order to fix a bug they never saw.
   */
  _rescue(e, r, ctx, why) {
    const from = e.position.clone ? e.position.clone() : { ...e.position };
    const ok = this.arrivals.relocate(e);
    r.n++;
    r.t = 0;
    r.best = Infinity;
    (this.rescues || (this.rescues = [])).push({
      what: 'rescue', ok, why, type: e.type, wave: this.wave,
      from: [from.x, from.y, from.z], to: [e.position.x, e.position.y, e.position.z],
    });
    if (!ok) this._retire(e, r, `${why} (nowhere to put it)`);
    return ok;
  }

  /**
   * REMOVE A BODY SO THE WAVE CAN END. The last resort, and it is logged.
   *
   * `dead = true` rather than splicing it out of `world.enemies`: everything
   * that counts a wave down counts live bodies, the corpse budget and the blade
   * solver both key off the same flag, and a body removed from the array while
   * something else holds a reference to it is the shape of half the lifecycle
   * bugs this repository has fixed.
   *
   * AND IT HAS TO SAY SO OUT LOUD, WHICH IT DID NOT.
   *
   * "It is disposed by the same path every other dead body is" was the sentence
   * that used to end this note, and it was false: every other dead body reaches
   * `World.onEnemyKilled`, which is described in World.js as "the one place a
   * death is visible centrally" and is where the two things that care about one
   * are hung — `corpses.take`, the note-#15 budget that is the only thing in the
   * tree that ever removes a ragdoll, and `command.onDeath`, the note-#21
   * roster. Setting the flag and telling nobody meant a retired body's meshes
   * and joints were never freed, and — measured over 66 minutes of driven
   * Command play, in which permadeath fired ZERO times — a retired TROOPER was
   * not a casualty at all: its roster record stayed `alive` with a dead body
   * hanging off it, and `deploy()` skips a record whose body is dead, so the
   * next area silently built it a new one. The watchdog was a free respawn.
   *
   * `source` is null and the kind is `retire`, so nothing is credited with a
   * kill: `onEnemyKilled` only pays a killer it can identify. The wave's SCORE
   * is paid, which is the one thing this change buys that is not obviously
   * right — a body the level failed to make reachable is worth its points to
   * nobody. It is left that way deliberately rather than special-cased, because
   * the alternative is a second definition of what a death is, and retirement is
   * rare (the last resort of two clocks) where a leaked ragdoll is forever.
   */
  _retire(e, r, why) {
    if (e.dead) return false;
    e.dead = true;
    e.dying = 0;
    r.t = 0;
    this.world?.onEnemyKilled?.(e, null, 'retire');
    (this.rescues || (this.rescues = [])).push({ what: 'retire', why, type: e.type, wave: this.wave });
    // Said out loud. A watchdog that fires silently hides the defect it exists
    // to survive, and this one fires on a level's geometry being wrong.
    this.world?.notify?.('CONTACT LOST', `an unreachable ${e.A?.label ?? e.type} was withdrawn`);
    return true;
  }

  /* ── what a condition does once the wave is running ──────────────── */

  /** The quarter this wave comes from, or null when it comes from everywhere. */
  _bearing() { return this.shape?.bearing ? (this._bearingAt ?? null) : null; }

  /**
   * WHERE ONE BODY LANDS, UNDER A BEARING.
   *
   * By REJECTION SAMPLING `ctx.pickSpawn` rather than by rotating the point it
   * returns, and the difference matters: `pickSpawn` tests terrain bounds,
   * slope and the level's own `spawnClear` — 94.3% of one deleted level's naive
   * picks were under its own water — and a rotated point has passed none of
   * them. Asking again is the only way to get a bearing AND keep every validity
   * test the level owns. Costs a handful of extra tries on one spawn per body,
   * and falls back to the best of what it saw, so a level too narrow to satisfy
   * the bearing still produces its wave.
   */
  _spawnPoint(ctx, type) {
    const first = ctx.pickSpawn(type);
    const b = this._bearing();
    const a = this.world?.player?.position;
    if (b === null || !first || !a) return first;
    const off = (p) => Math.abs(((Math.atan2(p.z - a.z, p.x - a.x) - b + Math.PI * 3) % TAU) - Math.PI);
    let best = first, bestOff = off(first);
    for (let i = 0; i < BEARING_TRIES && bestOff > BEARING_ARC / 2; i++) {
      const p = ctx.pickSpawn(type);
      if (!p) break;
      const o = off(p);
      if (o < bestOff) { best = p; bestOff = o; }
    }
    return best;
  }

  /**
   * THE ONE CONDITION THAT CHANGES WHAT CLEARING A WAVE IS.
   *
   * Found by scanning for the wave's only `leader` — `CONDITIONS.vanguard`
   * takes that modifier out of the fill's allowance precisely so this scan is
   * unambiguous, and `applyModifier` records the key on the body, so nothing
   * here needs a second ledger of which enemy was the head. It also means the
   * head is found whichever way it arrived: a gunship delivers asynchronously
   * and hands the director no reference back.
   */
  _watchHead(ctx) {
    if (this._routed) { this._break(ctx); return; }
    if (!this._head) {
      for (const e of ctx.enemies) {
        if (e && !e.dead && e.mod === 'leader' && this.blocksWaveEnd(e)) { this._head = e; break; }
      }
      return;
    }
    if (this._head.dead) this._rout(ctx);
  }

  /**
   * The leader is down, so the wave is over.
   *
   * Nothing further is delivered and what is standing breaks. `onEnemyKilled`
   * with a null source, exactly as `_retire` does it, so the rout credits
   * nobody with a kill it did not make — the player is paid for the wave, which
   * is what they earned, and not for sixty bodies they did not fight.
   *
   * A FEW PER FRAME rather than all of them, and that is not only a frame-time
   * argument (a rout of 125 bodies is 125 ragdolls on one tick). A line that
   * collapses over two seconds is something you watch break; a line that all
   * falls on the same frame is a bug that happens to be intentional.
   */
  _rout(ctx) {
    this._routed = true;
    const left = this.spawnQueue.length + this.arrivals.pending;
    this.spawnQueue.length = 0;
    // Nothing further is staged. Anything already in the air still lands and is
    // broken by the sweep below on the frame it arrives.
    if (Array.isArray(this.arrivals?.staging)) this.arrivals.staging.length = 0;
    this.world?.notify?.('THEY BREAK', `the leader is down — ${left} more were called off`);
    this._break(ctx);
  }

  _break(ctx) {
    let n = 0;
    for (const e of ctx.enemies) {
      if (n >= ROUT_PER_FRAME) break;
      if (!this.blocksWaveEnd(e)) continue;
      e.dead = true;
      e.dying = 0;
      this.world?.onEnemyKilled?.(e, null, 'rout');
      n++;
    }
    return n;
  }

  update(dt, ctx) {
    if (this.sandbox) { this._sandboxUpdate(dt, ctx); return; }
    // Ships and gates keep flying through an intermission and a draft: a run
    // that pauses does not leave a gunship frozen in the sky.
    this.arrivals.update(dt, ctx);
    // …and the wave is watched whether or not it is active, because the state
    // note #7 describes is precisely "the queue is empty and one body remains".
    this._watchdog(dt, ctx);
    if (!this.active) {
      if (this.intermission > 0) {
        this.intermission -= dt;
        if (this.intermission <= 0) this.start(this.wave + 1);
      }
      return;
    }

    this.spawnTimer -= dt;
    /**
     * ONLY THE HORDE COUNTS, and this is why Command mode could not finish a
     * wave.
     *
     * `ctx.enemies` is `world.enemies`, and Command puts YOUR OWN TROOPS in
     * that same array — an ally is an `Enemy` with a different `team`, which is
     * the design decision that makes allies real. The consequence nobody
     * traced: this line counted them, so a wave stayed open while your army was
     * alive and cleared the instant the last of your own troopers died.
     * Measured on a driven run: wave 1 sat open for six seconds with zero
     * hostiles on the field, and closed 0.1 s after a probe killed all ten
     * clones.
     *
     * `blocksWaveEnd` is that rule, stated once for the three callers that
     * need it — this line, `remaining`, and the watchdog.
     */
    const alive = ctx.enemies.reduce((n, e) => n + (this.blocksWaveEnd(e) ? 1 : 0), 0);
    // …and the head of the wave, if it has one. See `_rout`.
    if (this.shape?.head) this._watchHead(ctx);
    // Bodies already on their way count against the cap. Without this the
    // director would keep calling for more the whole time a ship was inbound
    // and land six at once.
    const inbound = this.arrivals.pending;
    // How much of the wave stands at once, and how fast it is fed in — both
    // are what ALL AT ONCE moves, and both belong to the shape rather than to
    // this line, so a condition added tomorrow needs no edit here.
    const maxAlive = this.shape?.alive ?? this.maxAlive;
    if (this.spawnQueue.length && alive + inbound < maxAlive && this.spawnTimer <= 0) {
      const entry = this.spawnQueue.shift();
      const type = spawnType(entry);
      const mod = spawnMod(entry);
      // The arrival owns where and when. If it declines — arrivals off, or a
      // level with nothing that could bring anything — the old direct path is
      // still here, because a level must never fail to produce its wave.
      // The arc travels with the bearing so BEARING_ARC stays the one statement
      // of how wide a front is — Arrivals.js cannot import it back (this file
      // imports Arrivals), and two numbers for one idea is §2.3's defect.
      if (!this.arrivals.request(type, mod, this._bearing(), BEARING_ARC)) {
        const e = ctx.spawnEnemy(type, this._spawnPoint(ctx, type));
        if (e && mod) applyModifier(e, mod);
      }
      this.totalSpawned++;
      this.spawnTimer = lerp(0.85, 0.16, clamp(this.wave / 16, 0, 1)) * (0.6 + rng() * 0.8)
        * (this.shape?.pace ?? 1);
    }

    if (!this.spawnQueue.length && !this.arrivals.pending && alive === 0) {
      this.active = false;
      // ONCE PER WAVE, NOT ONCE PER CLEAR. See payWave.
      const fresh = this.payWave(this.wave);
      const draft = fresh && this.drafts && this.isDraftWave(this.wave) && !this.rungEnds;
      this.intermission = draft ? 999 : 5.5;
      /**
       * RUNG-LOCAL, and it is the only number in this file that is.
       *
       * World's handler answers one question with it — `run.wave >= rung.waves`,
       * "was that the last wave of THIS rung" — and `Run.depth` adds the rungs
       * below back on. Handing it the run-wide number would end the foundry
       * after one wave. Everything else about a cleared wave reads
       * `director.wave`, which is run-wide.
       *
       * `fresh` rides along because the payouts World hangs off this signal —
       * `score += 500 * w`, the party's 8 hp and 0.35 flow, and INSIGHT — are
       * the same kind of thing as the draft and have to be gated by the same
       * ledger. The announcement is not: a wave that was cleared was cleared,
       * and the player should hear so however many times they fought it.
       */
      if (this.onWaveClear) this.onWaveClear(this.rungWave, fresh);
      if (draft && this.onDraft) {
        const boss = this.isBossWave(this.wave);
        this.onDraft(drawBoons(this.draftSize(this.wave), this.world.takenBoons, this.wave, {
          // A set-piece cleared is worth more than a wave cleared: the boss
          // draft is one card wider AND cannot be three commons.
          floor: boss ? 'rare' : null,
          // …and past the FIRST set-piece it is not a card at all. See
          // ATTUNEMENTS: this is the growth that does not converge, and it is
          // put behind the boss so that it paces with the thing it is racing.
          // `drawBoons` owns which boss waves those are (isAttuneWave), so the
          // co-op relay in main.js cannot draw a different hand from the host's.
          attune: boss,
        }));
      }
    }
  }

  get remaining() {
    // `arrivals.pending` is bodies bought and paid for that are still in a ship
    // or behind a door. Leaving it out told the HUD "0 remaining" while a
    // gunship was on final approach, and ended the wave under it.
    //
    // …and `blocksWaveEnd` rather than `!e.dead`, for the reason on that method:
    // this is the number the HUD prints and the number the co-op host puts on
    // the wire, and in Command it counted the player's own army. A wave of six
    // droids read as sixteen remaining and could not reach zero while a single
    // trooper of yours was alive — the readout said the fight was not over when
    // it was.
    return this.spawnQueue.length + this.arrivals.pending
      + this.world.enemies.reduce((n, e) => n + (this.blocksWaveEnd(e) ? 1 : 0), 0);
  }

  resumeAfterDraft() {
    this.intermission = 4.0;
  }
}

/* ══════════════════════════════════════════════════════════════════════ */
/*  Cleaving Throw                                                        */
/* ══════════════════════════════════════════════════════════════════════ */

/**
 * The two numbers on the card, and why they are those numbers.
 *
 * `recall` — the outbound leg is capped at 1.5 s and the stock recall closes at
 * up to 34 m/s, so a throw across a wave leaves you unarmed for the better part
 * of three seconds. Doubling the recall clock brings the round trip back under
 * two, which is the difference between a technique you use IN a fight and one
 * you only use to open it. The card says "twice as fast" because this says 2.
 *
 * `speed` — the cut events a cleave produces carry a FIXED speed rather than
 * the disc's own. World._applyBladeEvent reads ev.speed for exactly two things:
 * the hitstop steps at 20 m/s (0.03 s below, 0.055 above) and the camera kick
 * is clamp(speed/60, 0.05, 0.3), which is already at its ceiling by 18. The
 * disc's real speed runs 26 m/s outbound and up to 68 on a doubled recall, so
 * reading it would make the same cut feel different depending on which leg of
 * the flight caught you — and both ends land on the identical kick anyway. 24
 * sits just over the hitstop step, because a blade going clean through a body
 * is the heavy version of a cut, not the glancing one.
 */
export const CLEAVE = { recall: 2.0, speed: 24 };

const _c1 = new THREE.Vector3(), _c2 = new THREE.Vector3();
const _cUp = new THREE.Vector3(0, 1, 0);

/**
 * Cleaving Throw, in full — because nothing else implements it.
 *
 * Every other boon on the list below is a number: multiply cutPower, add
 * stamina, set a flag Player.js already reads. This one is a MECHANIC, and it
 * shipped as `p.boonMods.throwPierce = true` with no reader anywhere in the
 * tree. The card promised a blade that passes through everything and comes back
 * faster; the throw behaved exactly as it did without it. So the technique is
 * installed on the player it is granted to, and each promise is one thing here.
 *
 * PASSES THROUGH. A held blade has to EARN a cut — BladeContactSolver
 * accumulates speed·dt·2.4 against the material's toughness, so plastoid (1.5)
 * parts in a frame and anything heavy (14 and up) has to be leaned on. A thrown
 * blade is never leaned on anything: at 26 m/s it crosses a body in about 40 ms,
 * two frames, roughly 3.4 of work. So the stock throw scores flesh and droid
 * plating and grinds uselessly off everything above them. Cleaving skips the
 * accumulator entirely — the disc's swept path is tested against every capsule
 * in reach and each body it meets is cut on the frame it is met, toughness
 * ignored, once per body per flight.
 *
 * The blade in flight is treated as a SPHERE of the blade's own radius, not as
 * the horizontal disc it is drawn as. That is the honest simplification: the
 * disc spins at 27 rad/s and translates at 26 m/s, so it sweeps its own
 * diameter in about 90 ms and there is no orientation a body can be in, on the
 * frame scale that matters, that the rim does not reach.
 *
 * It wraps Player._updateThrow because that is the only seam the throw has.
 * tools/checks/controls.mjs pins that seam: rename it in Player.js and the
 * check fails, rather than this boon quietly going back to doing nothing.
 *
 * @returns true if the technique is actually live on this player.
 */
export function cleavingThrow(p) {
  const base = p?._updateThrow;
  if (typeof base !== 'function') return false;

  p.throwCleaved = new Set();     // ids already met on THIS flight
  p.throwCleaves = 0;             // bodies passed through, this flight
  const from = new THREE.Vector3();

  p._updateThrow = function (dt, ctx) {
    // throwOrRecall zeroes the timer on the way out and never again, so this is
    // the one frame that is the start of a new flight. A manual recall must NOT
    // reset it — the way back is the same flight, and a body already parted on
    // the way out should not be parted a second time on the way home.
    if (this.throwTimer === 0) { this.throwCleaved.clear(); this.throwCleaves = 0; }
    from.copy(this.throwPos);
    // Scale dt rather than the recall's own speed clamp: the spin, the steering
    // lerp and the arrival test all read the same clock, so the blade still
    // lands in the hand at the end of a rotation instead of mid-turn.
    base.call(this, this.throwState === 'returning' ? dt * CLEAVE.recall : dt, ctx);
    if (this.boonMods.throwPierce) cleaveAlong(this, from, this.throwPos, dt);
  };
  return true;
}

/**
 * Everything the disc passed between `from` and `to`, cut once.
 *
 * The events go through World._applyBladeEvent rather than calling takeCut and
 * Prop.cut directly, because that function is where a cut's CONSEQUENCES live —
 * flow, combo, score, lifesteal, the hitmark, the kill credit. Duplicating that
 * policy here is how a technique drifts out of step with the rest of the game
 * one commit at a time.
 */
function cleaveAlong(p, from, to, dt) {
  const w = p.world;
  if (!w || typeof w._applyBladeEvent !== 'function') return;
  const reach = p.saber?.bladeLength ?? 1.15;
  const seen = p.throwCleaved;

  /**
   * `key` is what the flight REMEMBERS and `id` is what the cut is addressed
   * to, and for everything except a forest they are the same string. See the
   * stand of trees below: one prop id, many independent bodies.
   */
  const meet = (id, caps, target, key = id) => {
    let best = null, bestGap = Infinity;
    for (const cap of caps) {
      const r = segmentSegment(from, to, cap.p0, cap.p1, _c1, _c2);
      const gap = Math.sqrt(r.distSq) - (cap.r ?? 0);
      if (gap < bestGap) { bestGap = gap; best = { cap, t: r.t }; }
    }
    if (!best || bestGap > reach) return;
    seen.add(key);
    p.throwCleaves++;

    // The disc cuts on the horizontal plane it is spinning in, so where it
    // crosses a limb is where that plane meets it — a thrown saber takes a leg
    // at the height it was flying, not always at the middle. When the plane
    // misses the limb's span entirely (a limb lying flat, or one the disc only
    // clipped the end of) that answer is meaningless and the closest point on
    // the limb is used instead.
    const cap = best.cap;
    const dy = cap.p1.y - cap.p0.y;
    const plane = Math.abs(dy) > 1e-3 ? (to.y - cap.p0.y) / dy : -1;
    const cutT = clamp(plane >= 0 && plane <= 1 ? plane : best.t, 0.06, 0.94);
    const point = cap.p0.clone().lerp(cap.p1, cutT);
    w._applyBladeEvent(p, {
      type: 'cut', target: { id, ...target }, cap, bone: cap.name,
      cutT, bladeT: 1, speed: CLEAVE.speed,
      point, impulse: p.throwVel.clone(), normal: _cUp.clone(),
    }, dt);
  };

  // One body at a time: Enemy.capsules() hands back a shared array it reuses,
  // so collecting them all first would leave every entry pointing at the last
  // enemy's bones.
  const enemies = w.enemies || [], props = w.props || [];
  for (let i = 0, n = enemies.length; i < n && i < enemies.length; i++) {
    const e = enemies[i];
    if (!e || e.dead || seen.has(e.id)) continue;
    meet(e.id, e.capsules(), { enemy: e });
  }

  // Props need the loop bounded AND the offspring disowned, because cutting one
  // creates more of them: World._applyBladeEvent pushes the two halves onto
  // world.props, they carry new ids, and they are lying exactly where the disc
  // is. Unbounded, a for…of walks into them on the same frame; bounded but
  // unmarked, the NEXT frame finds them and cuts those, and their halves after
  // that — two crates measured 14 cleaves before this, a crate sawn to its
  // generation cap in the length of one flight.
  //
  // One pass means one pass. Anything the cut just produced is the same body in
  // two parts, and the disc has already been through it.
  for (let i = 0, n = props.length; i < n && i < props.length; i++) {
    const pr = props[i];
    if (!pr || pr.dead) continue;
    /**
     * A STAND OF TREES IS ONE PROP AND MANY BODIES.
     *
     * `attachForest` pushes the whole wood into `world.props` as a single
     * duck-typed prop — one `id`, one `capsules()` returning every trunk near
     * the blade, each named `t<i>`. So the loop below reached it perfectly
     * well and then `seen.add(pr.id)` retired ALL EIGHTEEN HUNDRED TRUNKS
     * after the first one, and `meet` only ever picks the single closest
     * capsule out of what it is handed anyway. Measured on the wood, a disc
     * thrown 24 m through a dense line: `throwCleaved` held exactly one entry
     * — `forest1` — and `throwCleaves` read 1 for the whole flight. The card
     * says the blade cuts clean through everything it passes.
     *
     * What made it invisible is worth writing down, because it is why this is
     * a smaller defect than it looks: trees are `TOUGHNESS.plastoid`, which a
     * disc at 24 m/s parts through the ORDINARY solver without any help, so
     * the wood came down either way. Measured on the same throw, 17 trunks
     * felled with the technique switched off against 15 with it on — the boon
     * was contributing nothing, and nothing is what it looked like.
     *
     * One key per TRUNK fixes both halves: each tree is offered on its own,
     * cut once per flight, and the counter is the number of bodies the blade
     * actually went through. The cut is still addressed to `pr` — the prop
     * branch of `World._applyBladeEvent` calls `Forest.cut(point, …)`, which
     * resolves the trunk from the point via `nearestStanding` and fells it
     * with its chain. There is nothing to add there; a target carrying neither
     * `enemy` nor `prop` is dropped by that function in silence.
     */
    if (pr.kind === 'forest' && typeof pr.capsules === 'function') {
      // `Forest.capsules()` already culls to the trunks near the blade — its
      // body position follows the disc in flight — so this must not cull again.
      for (const cap of pr.capsules()) {
        const key = pr.id + ':' + cap.name;
        if (seen.has(key)) continue;
        meet(pr.id, [cap], { prop: pr }, key);
      }
      continue;
    }
    if (seen.has(pr.id)) continue;
    const before = props.length;
    meet(pr.id, pr.capsules(), { prop: pr });
    for (let k = before; k < props.length; k++) if (props[k]) seen.add(props[k].id);
  }
}

/* ══════════════════════════════════════════════════════════════════════ */
/*  The technique layer                                                   */
/* ══════════════════════════════════════════════════════════════════════ */

/**
 * Five seams, and every conditional boon below is built out of them.
 *
 * Cleaving Throw was the first card whose effect was a MECHANIC rather than a
 * number, and it shipped as a flag nothing read. The reason it could is that
 * there was nowhere for a mechanic to live: `apply(p)` runs once, at the draft
 * screen, and a boon that has to know what is happening THIS FRAME — whether
 * you are in a riposte, how many of them are around you, how close to death you
 * are — has nothing to hold on to. So it either got written into Player.js and
 * World.js as a special case, or it got written as a lie.
 *
 * These four give it somewhere to live, on the player, installed by the card
 * that needs it:
 *
 *   boonTick     run something every frame, after the player has updated and
 *                before World resolves blades — so a value written here is read
 *                by the same frame that produced the state it read.
 *   boonFactor   drive one boonMods multiplier from a changing number without
 *                fighting the other cards that multiply it. Divide by exactly
 *                what was applied last, multiply by what is wanted now: two
 *                cards can drive cutPower and a third can multiply it flat, and
 *                none of them stamps on the others.
 *   boonGuard    change or intercept a hit before it lands, and answer after.
 *   boonOnSever  hear about every limb this player takes off.
 *   boonOnKill   hear about every body this player puts down.
 *
 * All five DECLINE cleanly on anything that is not a live player, exactly as
 * cleavingThrow does, and all five return whether they actually installed — so
 * a card can set its own flag from the result and a dead seam shows up as a
 * card that reports itself dead rather than a card that quietly does nothing.
 *
 * ── on where a technique keeps its NUMBERS ────────────────────────────────
 *
 * `Player.defaultBoonMods()` is the contract for every key a boon may MOVE, and
 * it is deliberately closed: verify.mjs fails a card that writes a key Player
 * never declares, because `undefined * 1.33` is NaN and a NaN in cutPower is a
 * blade that cuts nothing. A technique whose parameter is not one of those keys
 * therefore keeps it on the PLAYER INSTANCE, exactly as the existing techniques
 * keep `_juyoStacks`, `_mendClock`, `_conduitKills` and `_bastionDeflects`
 * there. The rule that matters is unchanged and is the only one worth having:
 * the number must be READ, every frame, by the reader the card installed —
 * which is what tools/checks/living-force.mjs measures, on a real Player, by
 * driving the fight and watching the difference rather than by reading a flag.
 */

/** Run `fn(dt, ctx)` on the player every frame. Idempotent per `name`. */
export function boonTick(p, name, fn) {
  if (!p || typeof p.update !== 'function' || typeof fn !== 'function') return false;
  if (!p._boonTicks) {
    p._boonTicks = new Map();
    const base = p.update;
    p._boonTickBase = base;
    p.update = function (dt, ctx) {
      base.call(this, dt, ctx);
      for (const f of this._boonTicks.values()) f.call(this, dt, ctx);
    };
  }
  p._boonTicks.set(name, fn);
  return true;
}

/**
 * Hold `boonMods[key]` at `want` times whatever the static cards left it at.
 *
 * The alternative — remembering a base at install time and writing
 * `base * want` — is wrong the moment a LATER card multiplies the same key,
 * because the next tick overwrites that card's contribution. Dividing out
 * exactly the factor previously applied composes with anything.
 */
export function boonFactor(p, key, name, want) {
  const mods = p?.boonMods;
  if (!mods || !isFinite(want) || want <= 0) return false;
  const dyn = p._boonDyn || (p._boonDyn = new Map());
  const slot = key + ':' + name;
  const applied = dyn.get(slot) ?? 1;
  if (Math.abs(want - applied) < 1e-4) return false;
  mods[key] = (mods[key] ?? 1) / applied * want;
  dyn.set(slot, want);
  return true;
}

/**
 * Sit in front of `Player.damage`.
 *
 * `before(amount, kind, source)` returns the amount that should actually land —
 * zero or less refuses the hit outright. `after(amount, kind, source)` runs
 * once the hit has resolved, which is the only place a card can raise `invuln`
 * without the base call seeing it and rejecting the blow it was supposed to
 * survive.
 */
export function boonGuard(p, name, before, after) {
  if (!p || typeof p.damage !== 'function') return false;
  if (!p._boonGuards) {
    p._boonGuards = new Map();
    p._boonAfterHit = new Map();
    const base = p.damage;
    /* `...rest` RATHER THAN THE FOUR NAMED ARGUMENTS, and it is not tidiness.
     * A wrapper that restates its wrappee's signature silently drops whatever
     * that signature grows next, and `Player.damage` grew a fifth argument the
     * day the Force learned to answer the Force: `preResisted`, set by
     * `applyKnockback` to say "this blow has already been weighed against the
     * pool, do not charge it twice". Dropped here, a drafted player paid for
     * every enemy shove twice over — measured through the checks' own copy of
     * this mistake, lightning delivering 19% of its authored damage instead of
     * 43%, and the pool spent twice for it. Forwarding everything cannot go
     * stale. */
    p.damage = function (amount, point, ...rest) {
      let a = amount;
      const [source, kind] = rest;
      for (const g of this._boonGuards.values()) a = g.call(this, a, kind, source);
      if (!(a > 0)) return false;
      const died = base.call(this, a, point, ...rest);
      for (const g of this._boonAfterHit.values()) g.call(this, a, kind, source);
      return died;
    };
  }
  if (before) p._boonGuards.set(name, before);
  if (after) p._boonAfterHit.set(name, after);
  return true;
}

/**
 * Hear about limbs this player takes off, by wrapping the World hook Enemy
 * already calls. Dispatch is filtered on `source`, so in co-op one player's
 * card does not fire on another player's cut.
 */
export function boonOnSever(p, name, fn) {
  const w = p?.world;
  if (!w || typeof fn !== 'function') return false;
  if (!w._boonSever) {
    w._boonSever = [];
    const base = w.onLimbSevered;
    w.onLimbSevered = function (enemy, bone, point, source) {
      if (typeof base === 'function') base.call(this, enemy, bone, point, source);
      for (const h of this._boonSever) if (h.p === source) h.fn.call(h.p, enemy, bone, point);
    };
  }
  if (!w._boonSever.some(h => h.p === p && h.name === name)) w._boonSever.push({ p, name, fn });
  return true;
}

/**
 * Hear about bodies this player puts down, by wrapping the World hook Enemy
 * already calls on death. Same shape as boonOnSever and for the same reason:
 * `World.onEnemyKilled(enemy, source, kind)` is the one place in the game that
 * knows a kill happened AND who owns it, and a card that wants to answer a kill
 * (a detonation, a reaping, a stack of momentum) otherwise has to poll
 * `p.kills` and guess where the body was.
 *
 * Dispatch is filtered on `source`, so in co-op one player's card does not fire
 * on another player's kill.
 */
export function boonOnKill(p, name, fn) {
  const w = p?.world;
  if (!w || typeof fn !== 'function') return false;
  if (!w._boonKill) {
    w._boonKill = [];
    const base = w.onEnemyKilled;
    w.onEnemyKilled = function (enemy, source, kind) {
      if (typeof base === 'function') base.call(this, enemy, source, kind);
      for (const h of this._boonKill) if (h.p === source) h.fn.call(h.p, enemy, kind);
    };
  }
  if (!w._boonKill.some(h => h.p === p && h.name === name)) w._boonKill.push({ p, name, fn });
  return true;
}

/**
 * How many cards of one axis a holding contains.
 *
 * Takes the SET OF IDS, not a player, so the draft screen can ask the same
 * question of `world.takenBoons` that a mastery card asks of the player who is
 * about to be handed it.
 *
 * RANKS COUNT. A second rank of Djem So is another commitment to the blade, and
 * the alternative makes ranks a trap: if only distinct cards counted, taking
 * the rank the draft just offered you would push your mastery further away, so
 * the correct play would be to refuse every rank until wave 12. A reward you
 * are punished for accepting is worse than no reward.
 */
export function axisCountOf(taken, axis) {
  if (!taken) return 0;
  let n = 0;
  for (const b of BOONS) if (b.axes?.includes(axis)) n += rankOf(taken, b.id);
  return n;
}

/**
 * Per-wave boon charges, handed back at the top of every wave.
 *
 * TO THE NUMBER OF RANKS HELD, which is the only definition that survives a
 * card that stacks. `if (secondWind === 0) secondWind = 1` was two bugs in one
 * line: a player holding both ranks of Second Wind got ONE charge back at the
 * top of every wave after the first, so the rank they paid for expired after a
 * single use; and `defaultBoonMods` seeds the key at 0, so the `=== 0` test
 * fired for every player in the game and handed a charge to people who had
 * never seen the card. (That second one was inert — the guard that reads the
 * charge is installed by `apply`, so an unbought charge had no reader — but a
 * flag that says a player has something they do not is how the next reader
 * added here becomes a bug nobody wrote.)
 *
 * The player's own rank ledger is the source, exactly as `Player.applyBoon`
 * uses it: a run replayed into a freshly built body arrives at the same ranks,
 * so it arrives at the same charges.
 */
export function refreshWaveBoons(world) {
  for (const p of (world?.players || [])) {
    if (!p?.boonMods) continue;
    p.boonMods.secondWind = rankOf(p.boons, 'secondwind');
  }
}

/* ── the readers ─────────────────────────────────────────────────────── */

const _s1 = new THREE.Vector3(), _s2 = new THREE.Vector3();
const _sUp = new THREE.Vector3(0, 1, 0);

/** Squared distance from a point to a capsule segment, minus the radius. */
function gapToCapsule(point, cap) {
  _s1.subVectors(cap.p1, cap.p0);
  const len2 = _s1.lengthSq();
  const t = len2 > 1e-9 ? clamp(_s2.subVectors(point, cap.p0).dot(_s1) / len2, 0, 1) : 0;
  _s2.copy(cap.p0).addScaledVector(_s1, t);
  return { gap: _s2.distanceTo(point) - (cap.r ?? 0), point: _s2.clone() };
}

/** Counterstroke — the riposte window is when your blade is worth the most. */
function riposteEdge() {
  const k = this.riposteTimer > 0 ? (this.boonMods.riposteCut ?? 1) : 1;
  boonFactor(this, 'cutPower', 'counterstroke', k);
}

/** Wellspring — the extra share of the Force's own regeneration. */
function wellspringFlow(dt) {
  const extra = (this.boonMods.forceRegen ?? 1) - 1;
  if (extra <= 0 || typeof this.force !== 'number') return;
  this.force = Math.min(this.maxForce ?? this.force, this.force + 7.5 * extra * dt);
}

/** Juyo — ferocity that compounds while you keep cutting, and cools when you stop. */
const JUYO_MAX = 6, JUYO_DECAY = 1.7;
function juyoEdge(dt) {
  const per = this.boonMods.ferocity ?? 0;
  const taken = this.limbsRemoved || 0;
  const prev = this._juyoLimbs ?? taken;
  let s = this._juyoStacks ?? 0;
  if (taken > prev) s = Math.min(JUYO_MAX, s + (taken - prev));
  this._juyoLimbs = taken;
  this._juyoStacks = Math.max(0, s - dt / JUYO_DECAY);
  boonFactor(this, 'cutPower', 'juyo', 1 + Math.floor(this._juyoStacks) * per);
}

/** Conduit — a kill hands back a measure of the Force that bought it. */
function conduitReturn() {
  const back = this.boonMods.conduit ?? 0;
  const kills = this.kills || 0;
  const prev = this._conduitKills ?? kills;
  this._conduitKills = kills;
  if (back <= 0 || kills <= prev || typeof this.force !== 'number') return;
  this.force = Math.min(this.maxForce ?? this.force, this.force + back * (kills - prev));
}

/** Fury — everything you have left, spent harder the less of it there is. */
function furyEdge() {
  const k = this.boonMods.fury ?? 0;
  if (k <= 0 || !(this.maxHp > 0)) return;
  const hurt = clamp(1 - this.hp / this.maxHp, 0, 1);
  boonFactor(this, 'cutPower', 'fury', 1 + k * hurt);
  boonFactor(this, 'moveSpeed', 'fury', 1 + 0.45 * hurt);
}

/** Encircled — a crowd is cover, if you are built for it. */
const ENCIRCLE_R2 = 7 * 7, ENCIRCLE_CAP = 0.42;
function encircleGuard(amount) {
  const per = this.boonMods.encircle ?? 0;
  if (per <= 0 || !this.position) return amount;
  let n = 0;
  for (const e of (this.world?.enemies || [])) {
    if (!e.dead && e.position.distanceToSquared(this.position) < ENCIRCLE_R2) n++;
  }
  return amount * (1 - Math.min(ENCIRCLE_CAP, per * n));
}

const STAGGER_AT = 14;
/**
 * Steadfast — the big hits are the ones that get halved, and none of them move
 * you. `boonMods.steadfast` IS A REDUCTION, not a multiplier — and the guard
 * used to read it as the second one.
 *
 * The card accumulates `min(0.75, steadfast + 0.5·rankScale)` and the cap's own
 * comment explains itself as "two ranks of 0.5 would be immunity to every heavy
 * blow", which is only true if the number is the share taken OFF; `Player.
 * defaultBoonMods` seeds it at 0, which is only sane the same way. The guard
 * then returned `amount * k`. Measured on a 40-point heavy blow: no card 40.00,
 * rank I 20.00, rank II 30.00 — rank two of a rare card cost the player a draft
 * slot (or 9+ Insight on the guard current, where a second rank carries
 * an extra RANK_STEP) to take FIFTY PERCENT MORE damage from every heavy blow
 * than rank one, with nothing on screen to say so.
 *
 * Read as a reduction the ladder is monotone and the cap does what it says:
 * 40 → 20.00 → 10.00, and the second rank stops one quarter short of immunity.
 */
function steadfastGuard(amount) {
  const cut = this.boonMods.steadfast ?? 0;
  if (!(cut > 0)) return amount;
  const scale = this.world?.difficulty?.damageTaken ?? 1;
  return amount * scale > STAGGER_AT ? amount * (1 - Math.min(cut, 1)) : amount;
}
function steadfastStance() { this.staggerTimer = 0; }

/**
 * Second Wind — once a wave, the blow that would end it does not. SPEND ONE
 * CHARGE, not all of them.
 *
 * `= 0` is an assignment where the card needs a decrement, and it made the
 * second rank of a `stack: 2` rare card a measured no-op: the card's own
 * comment says "two is the cap because a third makes a wave essentially
 * unloseable", and two ranks bought exactly what one rank bought. Measured at
 * 40 hp against 500-point blows — rank I survives 1 of 3, rank II survived 1 of
 * 3 — because the first save threw the second charge away in the same
 * instruction that spent the first.
 */
function secondWindGuard(amount) {
  if (!(this.boonMods.secondWind > 0)) return amount;
  const scale = this.world?.difficulty?.damageTaken ?? 1;
  if (amount * scale < this.hp) return amount;
  this.boonMods.secondWind -= 1;
  this._secondWindFired = true;
  return Math.max(0.01, (this.hp - 1) / scale);
}
function secondWindAfter() {
  if (!this._secondWindFired) return;
  this._secondWindFired = false;
  this.invuln = Math.max(this.invuln ?? 0, 1.6);
  this.heal?.(this.maxHp * 0.25);
  this.world?.notify?.('SECOND WIND', 'not this wave');
  this.world?.engine?.flash?.(0.16);
}

/**
 * Attunement of the Guard — the one defensive axis with a growth curve.
 *
 * ── THE HOLE, MEASURED ─────────────────────────────────────────────────────
 *
 * Every offensive axis in this game compounds and no defensive one did.
 * Applied through the real `BOONS[].apply` onto a real `defaultBoonMods`, a
 * build that takes every card of its kind that a wave-40 run can hold:
 *
 *     committed offence    cutPower  1.00 → 29.62      ×29.6
 *     committed defence    maxHp      100 → 292        ×2.9
 *     the wave itself      threat       7 → 425        ×61
 *
 * — and an undirected run moves `maxHp` by 0-9% over SIXTY waves. Offence
 * multiplies (Shatterpoint ×1.9, Djem So ×1.4, the blade attunement ×1.12 per
 * rank and uncapped); defence ADDS (Vitality +30, the body attunement +18) or
 * is capped flat (the Aegis is a 22-point ward, Encircled tops out at 42%). An
 * additive hit-point pool against a multiplicative threat curve is not a
 * defensive build, it is a slightly later death, and the deep waves therefore
 * have exactly one answer: kill it before it reaches you.
 *
 * ── WHY HERE AND NOT IN A NEW CARD ─────────────────────────────────────────
 *
 * `attune-guard` is offered at every set-piece forever, is uncapped, is
 * repeatable, and is the heart of the guard current — it is already the
 * shape a growth curve needs. What it granted was `deflectDamage ×1.12`, which
 * is OFFENCE THROUGH DEFLECTION, and `flowGain ×1.05`. Its own card text says
 * "what you turn aside comes back harder", and that was the whole of it: the
 * guard axis's permanent, unbounded choice bought no survivability at all.
 *
 * ATTUNE_STEP, the same constant and the same direction as the blade's — a
 * rank makes the edge 12% deeper there and makes a blow 12% shallower here, so
 * the two axes race on the same terms rather than one of them standing still.
 * Compounding, because the thing it is racing compounds: four ranks is 0.64 of
 * the blow, ten is 0.31. The floor exists because a multiplier this shape
 * reaches zero eventually and nothing in this game may be unkillable.
 */
export const WARD_FLOOR = 0.2;
function wardGuard(amount) {
  return amount * Math.max(WARD_FLOOR, this.boonMods.ward ?? 1);
}

/** Bastion — a guard that pays for itself. See the honesty note under BOONS. */
function bastionGuardRefund() {
  const back = this.boonMods.guardRefund ?? 0;
  const n = this.deflects || 0;
  const prev = this._bastionDeflects ?? n;
  this._bastionDeflects = n;
  if (back <= 0 || n <= prev || typeof this.stamina !== 'number') return;
  this.stamina = Math.min(this.maxStamina ?? this.stamina, this.stamina + back * (n - prev));
}

/** Tempest — Flow is the fuel, so the deeper it runs the less the Force costs. */
function tempestDiscount() {
  const k = this.boonMods.tempest ?? 0;
  if (k <= 0) return;
  boonFactor(this, 'forceCost', 'tempest', Math.max(0.05, 1 - k * clamp(this.flow ?? 0, 0, 1)));
}

/** Undying — a body that mends itself once nothing has touched it for a while. */
const MEND_AFTER = 5;
function undyingMend(dt) {
  const rate = this.boonMods.mend ?? 0;
  if (rate <= 0 || !(this.maxHp > 0)) return;
  if (this.hp < (this._mendHp ?? this.hp)) this._mendClock = 0;
  this._mendHp = this.hp;
  this._mendClock = (this._mendClock ?? 0) + dt;
  if (this._mendClock > MEND_AFTER && this.hp < this.maxHp) this.heal?.(rate * dt);
}

/** Djem So — what you cut goes backwards. */
function severShove(enemy) {
  const k = this.boonMods.sunderShock ?? 0;
  if (k <= 0 || !enemy || enemy.dead || !enemy.position || !this.position) return;
  _s1.subVectors(enemy.position, this.position).setY(0.35);
  if (_s1.lengthSq() < 1e-6) _s1.set(0, 0.35, 1);
  _s1.normalize().multiplyScalar(k);
  enemy.applyKnockback?.(_s1.clone(), 0, this, false);
  enemy.stun?.(0.3);
}

/**
 * Sundering — the stroke carries into whatever stood behind the body it took.
 *
 * The second cut goes through `World._applyBladeEvent`, not through takeCut, so
 * it collects the same flow, score, lifesteal, hitmark and kill credit any
 * other cut does — the same reason Cleaving Throw routes that way. `_sundering`
 * bounds it to one generation: the second cut fires this same hook, and without
 * the latch a crowd would unzip itself in a single frame.
 */
function sunderThrough(enemy, bone, point) {
  const w = this.world;
  const reach = this.boonMods.sunderReach ?? 0;
  if (reach <= 0 || this._sundering || !w || typeof w._applyBladeEvent !== 'function') return;
  let best = null, bestGap = reach;
  for (const e of (w.enemies || [])) {
    if (!e || e.dead || e === enemy || !e.position) continue;
    if (e.position.distanceTo(point) > reach + 2.5) continue;
    // Enemy.capsules() recycles the ARRAY but mints fresh entries, so holding
    // on to one entry is safe; holding on to the array is not.
    for (const cap of e.capsules()) {
      if (cap.shield) continue;
      const hit = gapToCapsule(point, cap);
      if (hit.gap < bestGap) { bestGap = hit.gap; best = { e, cap, at: hit.point }; }
    }
  }
  if (!best) return;
  this._sundering = true;
  try {
    w._applyBladeEvent(this, {
      type: 'cut', target: { id: best.e.id, enemy: best.e }, cap: best.cap, bone: best.cap.name,
      cutT: 0.5, bladeT: 1, speed: 22,
      point: best.at, impulse: _s2.subVectors(best.at, point).normalize().multiplyScalar(9).clone(),
      normal: _sUp.clone(),
    }, 1 / 60);
  } finally { this._sundering = false; }
}

/* ── the readers the Holocron added ────────────────────────────────── */

/**
 * Reflection — a share of every blow that lands goes back to whoever struck it.
 *
 * The AFTER half of boonGuard, not the before half: the thing that has to be
 * true is that the hit really landed. `source` is whatever World handed to
 * `damage`, which is the enemy for a melee strike and for a bolt; anything with
 * no `damage` of its own (a fall, a grenade with no owner, a peer's claim) is
 * declined rather than guessed at.
 */
function thornsBack(amount, kind, source) {
  const share = this._thornsShare ?? 0;
  if (share <= 0 || !(amount > 0)) return;
  if (!source || source === this || source.dead || typeof source.damage !== 'function') return;
  source.damage(amount * share, source.position || this.position, this, 'thorns');
}

/**
 * Aegis — a barrier that eats the blow before your body does, and mends itself
 * once nothing has touched it for a while.
 *
 * The one survivability shape this game did not have. Vitality is a bigger
 * pool, Undying is a slow refill, Second Wind is one save a wave — all three
 * are answers to how much damage you can TAKE. A barrier is an answer to how
 * much you can take BETWEEN fights: it is free every time it refills, worth
 * nothing if you never break contact, and it is the reason a tank build has a
 * rhythm rather than a number.
 *
 * AEGIS_RATE is a share of the pool per second, so a deeper barrier refills
 * proportionally rather than taking forever — the wait, not the rate, is what
 * makes it a decision.
 */
const AEGIS_WAIT = 4.0, AEGIS_RATE = 0.30;
function aegisSoak(amount) {
  if (!((this._aegisMax ?? 0) > 0) || !(amount > 0)) return amount;
  // Any hit at all resets the clock, absorbed or not: a barrier that recharged
  // while you were being shot at would simply be more health.
  this._aegisClock = 0;
  const pool = this._aegis ?? 0;
  if (pool <= 0) return amount;
  const eaten = Math.min(pool, amount);
  this._aegis = pool - eaten;
  return amount - eaten;
}
function aegisMend(dt) {
  const max = this._aegisMax ?? 0;
  if (max <= 0) return;
  this._aegisClock = (this._aegisClock ?? 0) + dt;
  if (this._aegisClock < AEGIS_WAIT) return;
  this._aegis = Math.min(max, (this._aegis ?? 0) + max * AEGIS_RATE * dt);
}

/**
 * Momentum — killing makes you faster, and stopping costs it.
 *
 * Reads `p.kills`, which World increments on every body this player puts down,
 * for the same reason Juyo reads `limbsRemoved`: it is a counter that already
 * exists and cannot disagree with the fight. The stacks decay on a clock, so
 * the card pays for aggression and refuses to pay for a full health bar.
 */
const RUSH_MAX = 5, RUSH_DECAY = 4.0;
function momentumRush(dt) {
  const per = this._momentumPer ?? 0;
  const kills = this.kills || 0;
  const prev = this._momentumKills ?? kills;
  let s = this._momentumStacks ?? 0;
  if (kills > prev) s = Math.min(RUSH_MAX, s + (kills - prev));
  this._momentumKills = kills;
  this._momentumStacks = Math.max(0, s - dt / RUSH_DECAY);
  const n = Math.floor(this._momentumStacks);
  boonFactor(this, 'moveSpeed', 'momentum', 1 + n * per);
  boonFactor(this, 'attackRate', 'momentum', 1 + n * per * 0.6);
}

/**
 * Mercy Stroke — a body already opened does not get to walk away.
 *
 * Fires on a SEVER rather than on damage, so it is a consequence of the thing
 * this game is about: you took a limb, and what was left of them went with it.
 * The kill is dealt through `enemy.damage(…, this, …)`, so it is credited, it
 * scores, it feeds healOnKill and it fires every on-kill card — a finisher that
 * did not count as your kill would be the same lie in a nicer coat.
 */
function executeCut(enemy, bone, point) {
  const at = this._executeAt ?? 0;
  if (at <= 0 || !enemy || enemy.dead || !(enemy.maxHp > 0)) return;
  if (enemy.hp > enemy.maxHp * at) return;
  enemy.damage(enemy.hp + 1, point || enemy.position, this, 'execute');
}

/**
 * Detonation — what you fell goes off.
 *
 * `_detonating` bounds it to one generation, exactly as `_sundering` does for
 * Sundering, and for a sharper reason: this handler is fired BY a kill and
 * deals damage that can kill, so without the latch one body in a crowd unzips
 * the whole crowd in a single frame and the recursion is exponential rather
 * than merely wrong.
 */
const DETONATE_R = 4.6;
function detonateBody(enemy) {
  const dmg = this._detonate ?? 0;
  const w = this.world;
  if (dmg <= 0 || this._detonating || !w || !enemy?.position) return;
  this._detonating = true;
  try {
    const at = enemy.position;
    for (const e of (w.enemies || [])) {
      if (!e || e.dead || e === enemy || !e.position) continue;
      const d = e.position.distanceTo(at);
      if (d > DETONATE_R) continue;
      // Falloff, but never to nothing: the edge of a blast is still a blast.
      e.damage(dmg * (0.45 + 0.55 * (1 - d / DETONATE_R)), at, this, 'blast');
    }
    w.particles?.explosion?.(at, 0.55);
  } finally { this._detonating = false; }
}

/* ══════════════════════════════════════════════════════════════════════ */
/*  Communion — the boons that land on somebody else                      */
/* ══════════════════════════════════════════════════════════════════════ */

/**
 * WHAT WAS MISSING. Every boon in this table is a thing that happens to YOU.
 * Co-op has existed since Net.js was written and there has never been a single
 * card whose effect crosses to the other player, so two people in a session are
 * two solo runs standing next to each other.
 *
 * The Communion cards are the other shape: an aura the holder projects and an
 * ALLY receives. Three properties make it honest rather than decorative:
 *
 *   ONE RECEIVER, ONE WRITER. `_bondIn` is written only by somebody else's
 *   aura — never by your own — and read by `bondReceive`/`bondGuardIn`, which
 *   World installs on every local player at spawn whether or not that player
 *   holds a single bond card. A buff that only worked if the RECEIVER had also
 *   drafted the card would be a co-op feature that needs a rehearsal.
 *
 *   IT CROSSES THE WIRE, SPATIALLY. A peer is a RemoteAvatar with a position on
 *   this machine, so the sender knows perfectly well how far away they are and
 *   only sends to the ones inside the aura. See World._bondTick and the `bond`
 *   message in Net.js — sent by one end and handled at the other, which is the
 *   thing co-op in this project has historically got wrong.
 *
 *   IT IS NEVER A DEAD CARD ALONE. Solo, the holder keeps half of their own
 *   aura. That is not charity: it is what makes the Communion current
 *   draftable in a solo run without being a trap, and the mastery is what turns
 *   the half back into a whole.
 */
export const BOND = {
  /** How far a communion reaches, in metres. */
  range: 16,
  /** How long a received aura survives without being renewed — comfortably more
   *  than the 1/18 s host tick, so a dropped packet dims rather than blinks. */
  hold: 1.2,
  /** The most an ally's ward may take off an incoming blow. */
  wardCap: 0.35,
  /**
   * WHAT A STRANGER'S AURA MAY CLAIM TO BE — a bound on the WIRE, not on the game.
   *
   * `bondGive` is one function with two doors: a local ally's aura, whose
   * numbers this machine computed from its own cards, and `World.applyBond`,
   * whose numbers are whatever arrived. Only `ward` was ever bounded (through
   * `bondGuardIn`), so a peer sending `{c: 1e6, s: 1e6, h: 1e6}` bought itself
   * ×10⁶ cut power and move speed and a full heal — measured, moveSpeed 1 →
   * 1000000 and cutPower 0.85 → 850000 — laundered through the host, which
   * relayed it and therefore vouched for it.
   *
   * Deliberately far above anything the cards can reach rather than tight to
   * them: `cut` is `1 + edge` and `edge` accrues in steps of `step` (0.16), so
   * `cutCap` is about nineteen bond cards' worth and no run gets there. A cap
   * that bit a legitimate ally would be a worse bug than the one it fixes, and
   * a stranger has no business anywhere near this range regardless.
   */
  cutCap: 4,
  /** As `cutCap`. `spd` is `1 + edge * 0.5`, so this is the same edge. */
  spdCap: 2.5,
  /**
   * What one step along the bond axis is worth, as `_bondEdge`.
   *
   * Named because two cards spend it and they must not drift: Communion pays
   * one of these per rank, and Attunement of the Bond pays one per take —
   * which is the whole statement of what an attunement is on this axis, "a
   * rank of the axis's own card, for ever". Written as a number in each of
   * them, the two would be the eighth hand-maintained pair in this file.
   */
  step: 0.16,
};

/** Local players other than `p` — a RemoteAvatar has no boonMods and is not one. */
function localAllies(p) {
  const out = [];
  for (const q of (p.world?.players || [])) {
    if (q === p || !q || !q.boonMods || q.alive === false) continue;
    out.push(q);
  }
  return out;
}

/**
 * Hand `q` an aura for the next BOND.hold seconds. The only writer of _bondIn.
 *
 * KEPT PER GIVER, then collapsed to the strongest live offer. Two things go
 * wrong with a single slot, and they pull in opposite directions: writing it
 * outright means a second ally standing beside you can make you WEAKER than the
 * first one had, and merging by max across renewals means the moment the
 * strongest ally walks away their aura is latched on you forever, because every
 * later renewal maxes against the value they left behind. Keyed by giver, both
 * questions have the same obvious answer: whatever the people actually near you
 * are offering, right now.
 *
 * Healing is not merged at all — it is an event rather than a level, and two
 * allies each mend you.
 */
export function bondGive(q, desc, now, from = 'ally') {
  if (!q || !desc) return false;
  const t = now ?? 0;
  const m = q._bondFrom || (q._bondFrom = new Map());
  m.set(from, { cut: desc.cut ?? 1, spd: desc.spd ?? 1, ward: desc.ward ?? 0, until: t + BOND.hold });
  let cut = 1, spd = 1, ward = 0, until = 0;
  for (const [k, a] of m) {
    if (t >= a.until) { m.delete(k); continue; }
    cut = Math.max(cut, a.cut); spd = Math.max(spd, a.spd);
    ward = Math.max(ward, a.ward); until = Math.max(until, a.until);
  }
  q._bondIn = { cut, spd, ward, until };
  if (desc.heal > 0) q.heal?.(desc.heal);
  return true;
}

/** The receiver, installed on every local player by World.spawnPlayer. */
export function bondReceive() {
  const b = this._bondIn;
  const live = !!b && (this.world?.time ?? 0) < b.until;
  boonFactor(this, 'cutPower', 'bond', live ? b.cut : 1);
  boonFactor(this, 'moveSpeed', 'bond', live ? b.spd : 1);
}

/** …and its half of the damage path, for the Vow's ward. */
export function bondGuardIn(amount) {
  const b = this._bondIn;
  if (!b || (this.world?.time ?? 0) >= b.until) return amount;
  return amount * (1 - Math.min(BOND.wardCap, b.ward || 0));
}

/**
 * The aura itself, installed by every Communion card.
 *
 * One tick for the whole current, because the descriptor is the SUM of
 * whatever bond parameters the holder has collected — so taking a second bond
 * card widens the same aura instead of installing a second one that fights it.
 * The self-share goes through its own boonFactor slot so that an ally's aura
 * landing on you cannot be confused with your own.
 */
function bondAura() {
  const edge = this._bondEdge ?? 0, ward = this._bondWard ?? 0;
  if (edge <= 0 && ward <= 0) return;
  const w = this.world;
  const now = w?.time ?? 0;
  const range = this._bondRange ?? BOND.range;
  const r2 = range * range;
  const desc = { cut: 1 + edge, spd: 1 + edge * 0.5, ward: Math.min(BOND.wardCap, ward) };

  let reached = 0;
  for (const q of localAllies(this)) {
    const near = !this.position || !q.position || q.position.distanceToSquared(this.position) < r2;
    // Keyed on the giver — this player — so two allies projecting onto the same
    // third do not overwrite one another. See bondGive.
    if (near) { bondGive(q, desc, now, this); reached++; }
  }
  // The wire half. World owns the sending, because it owns the net and the
  // remote avatars; this only says what is being offered and how far it reaches.
  if (w) { w._bondOut = desc; w._bondRange = range; }
  reached += w?._bondPeers ?? 0;
  this._bondReached = reached;

  // Solo — or simply nobody in range — you keep half of it. The mastery gives
  // the whole of it back, which is what "the Force binds you to yourself too"
  // is worth as a mechanic.
  const share = this._bondMastery ? 1 : 0.5;
  boonFactor(this, 'cutPower', 'communion', 1 + edge * share);
  boonFactor(this, 'moveSpeed', 'communion', 1 + edge * 0.5 * share);
}

/** The Vow's own half: standing with somebody hardens you as well as them. */
function vowGuard(amount) {
  const ward = this._bondWard ?? 0;
  if (ward <= 0) return amount;
  const n = this._bondReached ?? 0;
  return amount * (1 - Math.min(BOND.wardCap, ward * (n > 0 ? 1 : 0.5)));
}

/**
 * Suffusion — the limb you take mends somebody else.
 *
 * The healer's whole loop, and the one card in this table whose payload is
 * deliberately WORSE for you than for the person beside you: allies take the
 * full measure, you take half of it and only when there is nobody to give it
 * to. `_bondHealOut` is picked up by World's bond tick and sent to the peers in
 * range on the same wire as the aura.
 */
function suffuseSever() {
  const v = this._bondHeal ?? 0;
  if (v <= 0) return;
  const range = this._bondRange ?? BOND.range;
  const r2 = range * range;
  let landed = 0;
  for (const q of localAllies(this)) {
    if (this.position && q.position && q.position.distanceToSquared(this.position) >= r2) continue;
    q.heal?.(v);
    landed++;
  }
  const w = this.world;
  if (w) w._bondHealOut = (w._bondHealOut ?? 0) + v;
  landed += w?._bondPeers ?? 0;
  if (!landed || this._bondMastery) this.heal?.(v * 0.5);
}

/* ══════════════════════════════════════════════════════════════════════ */
/*  Boons                                                                 */
/* ══════════════════════════════════════════════════════════════════════ */

/**
 * Every clause on every card is a claim about code, and four of them were not.
 *
 *   Cleaving Throw   set a flag nothing read — see cleavingThrow above.
 *   Makashi          "ripostes last twice as long" set riposteWindow to 1.0,
 *                    and World reads it as `?? 1`. The identity value. The boon
 *                    and no boon produced the same 0.6 s window. It multiplies
 *                    by 2 now — multiplies, because Counterstroke lengthens the
 *                    same window and an assignment would silently eat it.
 *   Soresu           "blocked bolts cost no stamina" — World._creditDeflect
 *                    charges a flat 4 on a BLOCK and consults no boon.
 *   Celerity         "dashes cost less" — Player._tryDash charges a flat 18 and
 *                    consults no boon.
 *
 * The Soresu clause is BACK, on a different card. It needed a line in World.js,
 * which this lane does not own — but `boonTick` runs after the player updates
 * and `p.deflects` counts every bolt turned aside, so Bastion watches that
 * counter and hands the stamina back. The clause is true again because there is
 * finally somewhere for it to be true. Celerity's is still off the card: dash
 * cost is spent inside `_tryDash` and leaves no counter behind to watch.
 * Two more were simply overstated: Ataru's "cost nothing" is a 45% discount and
 * it applies to every Force power, not just jumps, and Focusing Crystal makes
 * the trail THICKER, not longer.
 *
 * ── on 16 cards, drafted 3 at a time, every third wave ────────────────────
 *
 * A thirty-wave run saw ten drafts and took ten of sixteen cards — five eighths
 * of the whole system, near enough every run, which is the opposite of variety.
 * Whatever you were offered, you ended up in roughly the same place.
 *
 * Three things changed, and they are the same change:
 *
 *   MORE, AND OFTENER. Twenty-nine cards, a draft every second wave. A run now
 *   takes about fifteen of twenty-nine — half, not five eighths — and two runs
 *   that both went thirty waves no longer hold mostly the same cards.
 *
 *   RARITY, WEIGHTED BY DEPTH. `RARITY` is not a label, it is the probability
 *   of being offered at all, and it moves with the wave: commons are flat, rares
 *   climb, epics are locked below wave 7 and then climb hard. So the wave-2
 *   draft is a choice between small things and the wave-25 draft is a choice
 *   between large ones, from the same table.
 *
 *   AXES, AND CARDS THAT READ THEM. Every card declares `axes` — blade, guard,
 *   force, body, dark. Five MASTERIES are gated on holding three of an axis
 *   already (`requires`, checked against the draft's own taken-set), so they
 *   cannot be offered to a player who has not committed, and taking one is the
 *   moment a pile of cards becomes a build. Around them sit the cards that
 *   MULTIPLY other cards rather than adding to them: Counterstroke wants
 *   Makashi's longer window, Juyo wants anything that severs, Fury wants Dark
 *   Sustenance to keep it alive at the health where it is strongest.
 *
 * Every effect below is a real reader. The numbers land on `boonMods` keys that
 * Player.js, World.js and Duel.js already consult; the conditional ones land on
 * keys read by the technique layer above, every frame, on the player they were
 * installed on. tools/checks/controls.mjs proves it card by card.
 *
 * ── on Shatterpoint and Djem So ───────────────────────────────────────────
 *
 * They were the same card. Both wrote `cutPower` and nothing else, ×1.9 against
 * ×1.55, at the same rarity, out of the same pool — so Shatterpoint strictly
 * dominated: same mechanism, bigger number, never a reason to take the other
 * one. Djem So is Form V, and the card already promised what it never did
 * ("stagger harder"), so that is what it is now: a smaller edge, and everything
 * you cut goes backwards off its feet. Shatterpoint keeps the raw number and
 * pays for it by being rare.
 */

/**
 * How likely a card of each rarity is to be offered, at a given wave.
 *
 * Weights, not gates — a gate makes the same card appear every run at the same
 * wave, which is the variability problem wearing a different hat. The one hard
 * gate is `minWave`, and it exists so that the third card of a run cannot be
 * the thing that ends the run's difficulty curve.
 */
export const RARITY = {
  common: { label: 'Common', weight: () => 1 },
  rare: { label: 'Rare', weight: (w) => clamp(0.18 + w * 0.035, 0, 0.9) },
  epic: { label: 'Epic', weight: (w) => clamp((w - 6) * 0.055, 0, 1.0) },
};
const RARITY_ORDER = ['common', 'rare', 'epic'];

/** A mastery needs this many cards of its axis already in hand, and this depth. */
export const MASTERY_NEEDS = 3;
export const MASTERY_AT = 12;
const mastery = (axis) => (taken) => axisCountOf(taken, axis) >= MASTERY_NEEDS;

/* ══════════════════════════════════════════════════════════════════════ */
/*  RANKS — why a run does not run out of cards                           */
/* ══════════════════════════════════════════════════════════════════════ */

/**
 * `drawBoons` filtered out everything already taken and nothing could be taken
 * twice. With the 34 cards of the day and a draft every DRAFT_EVERY = 2 waves,
 * that meant a run exhausted the entire system at about wave 68 — `drawBoons`
 * returns `[]`,
 * `offerDraft` sees an empty hand and silently resumes, and from there the
 * player's power is frozen while the budget keeps climbing forever. In the mode
 * whose whole promise is endless escalation, the reward half of the loop had a
 * hard stop and gave no sign it had reached it.
 *
 * So the numeric cards have RANKS. A card with `stack: n` stays in the pool
 * until it has been taken n times, and rank k is worth
 *
 *     1 + (v - 1) · RANK_DIMINISH^(k-1)
 *
 * of whatever the card's rank-1 value v is. Two properties matter and both are
 * deliberate:
 *
 *   A RANK IS NEVER WORTH NOTHING. 0.6^4 is still 0.13 of the first rank. There
 *   is no dead card at the bottom of a deep run, which is the failure mode of
 *   flat stacking with a cap.
 *
 *   A RANK NEVER RUNS AWAY. The geometric sum converges to 1/(1-0.6) = 2.5, so
 *   a card stacked forever is worth two and a half of itself and no more. Five
 *   ranks of Vitality is +69 hp, not +150. That bound is why `stack` can be
 *   generous without handing the harness another 12x outlier.
 *
 * WHAT DOES NOT STACK, and why: the cards that unlock a verb rather than move a
 * number — Force Lightning, Ataru's double jump, Cleaving Throw — and the five
 * masteries. A second Force Lightning is not a card, it is a no-op wearing the
 * costume of a reward, and the draft offering one would be worse than the draft
 * being empty.
 */
export const RANK_DIMINISH = 0.6;

/** What rank `k` of a card is worth, as a fraction of its rank-1 value. */
export function rankScale(rank) {
  return Math.pow(RANK_DIMINISH, Math.max(0, (rank | 0) - 1));
}

/** How many times a card may be taken. Unranked cards are `stack: 1`. */
export function maxRank(boon) { return Math.max(1, boon?.stack ?? 1); }

/**
 * Scale a MULTIPLIER by a rank. `grow(1.4, 0.6)` is 1.24 — the excess over 1 is
 * what shrinks, not the multiplier itself, because scaling 1.4 directly would
 * make a high rank a *penalty* (1.4 × 0.36 = 0.5).
 */
/**
 * The factor rank k multiplies by, so that k ranks land EXACTLY on the series.
 *
 * WHAT THIS USED TO BE: `1 + (v - 1) * scale`, i.e. the rank-scaled multiplier
 * itself, applied afresh on every take. That reads like the comment above it —
 * "the excess over 1 is what shrinks" — and it is not what it does, because the
 * factors COMPOUND. Three ranks of a 1.5x card are
 *
 *     (1 + a)(1 + 0.6a)(1 + 0.36a),  a = 0.5
 *
 * whose excess is 1.96a PLUS the cross terms, and the cross terms grow with the
 * square of the multiplier. Measured across the table: every ranked card
 * overshot its own series, and TWO ESCAPED THE LADDER ENTIRELY — Makashi's 2.0x
 * and Shatterpoint's 1.9x both have a SECOND rank worth more than their first
 * (ratios 1.20 and 1.14). The bound is `v < 1 + (1/d - 1)` = 1.667x, and
 * nothing in the design said so because nobody had done the arithmetic. A rank
 * ladder whose second step is bigger than its first is not a rank ladder.
 *
 * WHAT IT IS NOW. Rank k multiplies by the ratio of the cumulative series at k
 * to the series at k-1, so after k takes the total is exactly `1 + a·S_k` where
 * `S_k = 1 + d + … + d^(k-1)`. That is the geometric series the design has
 * always claimed, for EVERY multiplier, with no per-card bound and no card
 * nerfed: rank 1 is `1 + a` for every card exactly as before, and only ranks 2
 * and up change — which is the half that was wrong.
 *
 * THE RANK COMES BACK OUT OF THE SCALE, rather than the contract changing.
 * `apply(p, s)` is called from two places and thirteen cards read `s`; some
 * multiply through `grow` and some use it directly on an additive term, where
 * `d^(k-1)` is already the right number. So `grow` inverts `rankScale` —
 * `k = 1 + log(s)/log(d)` — which is exact for every scale `rankScale`
 * produces, and leaves `grow(v)` and `grow(v, 1)` meaning what they always did.
 */
export function grow(v, scale = 1) {
  const a = v - 1;
  if (!(scale > 0) || !a) return 1 + a * (scale > 0 ? scale : 0);
  const d = RANK_DIMINISH;
  // which rank produced this scale; `rankScale(k) = d^(k-1)` inverted
  const k = Math.max(1, Math.round(1 + Math.log(scale) / Math.log(d)));
  const S = (n) => (n <= 0 ? 0 : (1 - Math.pow(d, n)) / (1 - d));
  return (1 + a * S(k)) / (1 + a * S(k - 1));
}

/**
 * A taken-set that counts.
 *
 * Extends Set so that every existing `.has(id)`, `[...taken]` and
 * `for (const id of taken)` in World, main.js, Order.js and the checks keeps
 * working unchanged and yields each card once. `take()` is the rank-aware
 * addition — it is separate from `add()` so that `add` keeps Set's contract of
 * returning `this`, which is what anything chaining would expect.
 */
export class RankSet extends Set {
  constructor(ids) { super(); this._n = new Map(); if (ids) for (const id of ids) this.take(id); }
  /** Add one rank of `id`; returns the rank now held (1 for the first). */
  take(id) { const r = (this._n.get(id) || 0) + 1; this._n.set(id, r); super.add(id); return r; }
  add(id) { this.take(id); return this; }
  /** How many ranks of `id` are held. 0 if never taken. */
  rank(id) { return this._n.get(id) || 0; }
  /** Total ranks across every card — the real size of a build. */
  get ranks() { let n = 0; for (const v of this._n.values()) n += v; return n; }
  /**
   * Every rank held, as a flat list of ids — `new RankSet(s.flat())` is a copy.
   *
   * Iterating a RankSet yields each id ONCE, because it is a Set, so `[...set]`
   * silently flattens a rank-3 Vitality to a rank-1 one. That is exactly the
   * shape of loss `World.runCarry` cannot afford: a build carried across a
   * ground change through the Set's own iterator would come out the far side
   * with every card at rank 1 and no error anywhere. Replaying this list
   * through `applyBoon` reproduces the build move for move, because a rank was
   * always N separate `applyBoon` calls and `boon.apply(p, rankScale(rank))`
   * compounds them in that order.
   */
  flat() { const out = []; for (const [id, n] of this._n) for (let i = 0; i < n; i++) out.push(id); return out; }
  delete(id) { this._n.delete(id); return super.delete(id); }
  clear() { this._n.clear(); super.clear(); }
}

/** Ranks of `id` held by a Set-or-RankSet, so callers need not care which. */
export function rankOf(taken, id) {
  if (!taken) return 0;
  if (typeof taken.rank === 'function') return taken.rank(id);
  return taken.has(id) ? 1 : 0;
}

export const BOONS = [
  {
    id: 'vaapad', icon: '⚡', name: 'Vaapad', tag: 'Form VII',
    rarity: 'rare', axes: ['guard'], stack: 3,
    text: 'Returned bolts strike for half again as much, and every return feeds your Flow.',
    apply(p, s = 1) { p.boonMods.deflectDamage *= grow(1.5, s); p.boonMods.flowGain *= grow(1.35, s); },
  },
  {
    id: 'soresu', icon: '🛡', name: 'Soresu', tag: 'Form III',
    rarity: 'common', axes: ['guard'], stack: 3,
    /* "DEFLECTION IS FORGIVEN FURTHER ALONG THE BLADE" described a different
     * mechanic from the one this card moves, and the two share a literal, which
     * is almost certainly how it happened. `gradeCaught` gates a RETURN on
     * `bladeT > RETURN_ZONE` — where along the blade the bolt landed — and on
     * `pickReturnTarget(..., ctx.returnCone ?? 0.42)`, which is how far OFF
     * YOUR SIGHTLINE the game will look for something to send it to. Both
     * numbers were 0.42. This card moves the second one and nothing anywhere
     * moves the first, so a rank of Soresu forgave your AIM, never your contact
     * point. Measured: the cone opens from ±54.5° to ±65.2° at rank 1; the
     * blade-position gate is identical at every rank of every card in the game.
     * Combat.RETURN_ZONE now has its own name so the coincidence cannot
     * mislead the next reader. */
    text: 'A wider guard. A returned bolt finds its mark further off your sightline, and your reserves run deeper.',
    // The cone GROWS by rank instead of being set to a constant, or rank 2
    // would silently be half a card. Capped, because a return cone wide enough
    // to contain everything on screen is an auto-aim, not a guard.
    apply(p, s = 1) {
      p.boonMods.returnCone = Math.min(0.80, (p.boonMods.returnCone ?? 0.42) + 0.16 * s);
      p.control.deadzone = 0.30;
      p.maxStamina += 25 * s; p.stamina = p.maxStamina;
    },
  },
  {
    id: 'ataru', icon: '🌀', name: 'Ataru', tag: 'Form IV',
    rarity: 'rare', axes: ['force'],
    /* "…AND YOU MAY LEAP A SECOND TIME IN THE AIR" is what this said, and every
     * player in the game can already do that. `Player._move` grants
     * `airJumps = boonMods.doubleJump ? 2 : 1` on every landing, and the note
     * beside it says so out loud — "Everyone gets the second jump — it is a
     * Force jump, not an upgrade. The boon grants a third." Driven on a real
     * Player: 1 air jump without the card, 2 with it. So the rare card that
     * carries this game's whole acrobatic axis was selling, as one of its three
     * promises, a thing the player had before they drafted anything.
     *
     * The card is not changed. The sentence is, to the leap it actually adds. */
    text: 'Acrobatic. Every Force power costs little over half, you leap higher, and the air gives you one leap more than it gives anyone else.',
    apply(p) { p.boonMods.doubleJump = true; p.boonMods.forceCost *= 0.55; p.boonMods.jumpPower *= 1.18; },
  },
  {
    id: 'djemso', icon: '🗡', name: 'Djem So', tag: 'Form V',
    rarity: 'common', axes: ['blade'], stack: 3,
    text: 'Power over finesse. Cuts bite deeper, and whatever you cut is thrown off its feet.',
    // The shove is the half of this card that was only ever a sentence. It is
    // an impulse and a stun on the body that was cut, so Form V opens ground
    // where Shatterpoint only opens armour.
    apply(p, s = 1) {
      p.boonMods.cutPower *= grow(1.4, s);
      p.boonMods.sunderShock = (p.boonMods.sunderShock ?? 0) + 9 * s;
      boonOnSever(p, 'djemso', severShove);
    },
  },
  {
    id: 'makashi', icon: '🤺', name: 'Makashi', tag: 'Form II',
    rarity: 'common', axes: ['guard', 'blade'], stack: 2,
    text: 'Duellist. A steadier blade against another blade, and ripostes last twice as long.',
    apply(p, s = 1) { p.boonMods.riposteWindow = (p.boonMods.riposteWindow ?? 1) * grow(2, s); p.control.sensitivity *= grow(1.06, s); },
  },
  {
    id: 'shatterpoint', icon: '💠', name: 'Shatterpoint', tag: 'Sight',
    rarity: 'rare', axes: ['blade'], stack: 3,
    // THE NICHE cutPower ACTUALLY HAS, said out loud. tools/balance.mjs measures
    // kill time at one pass — 0.64 s — for ten of fifteen archetypes, so against
    // a B1 or a trooper a deeper cut buys nothing: the limb was already coming
    // off. It is worth a great deal against the five that need four or more
    // passes (droideka, walker, armoured and shielded elites), and that is what
    // the card is for. The text now says so instead of promising a general edge.
    text: 'You see where things want to break. Armour, shields and heavy plate part in half the time.',
    apply(p, s = 1) { p.boonMods.cutPower *= grow(1.9, s); },
  },
  {
    id: 'tutaminis', icon: '🌡', name: 'Tutaminis', tag: 'Absorption',
    rarity: 'common', axes: ['force', 'guard'],
    text: 'Bolts that strike you feed the Force instead of only wounding.',
    apply(p) { p.boonMods.absorb = true; },
  },
  {
    id: 'repulse', icon: '💥', name: 'Force Repulse', tag: 'Impact',
    rarity: 'rare', axes: ['force'],
    text: 'Landing from a height blows everything nearby off its feet.',
    apply(p) { p.boonMods.repulse = true; },
  },
  {
    id: 'lightning', icon: '🗲', name: 'Force Lightning', tag: 'Dark',
    rarity: 'epic', minWave: 7, axes: ['force', 'dark'],
    // No key name. This card said "on Z" — a key typed into a run reward,
    // which is wrong for anyone who has rebound `lightning` and is a second
    // home for a name that lives in ACTIONS. The Codex prints the live key.
    text: 'Unlocks Force lightning, on its own key. It is not the Jedi way.',
    apply(p) { p.boonMods.lightning = true; },
  },
  {
    /**
     * The only card in the table that hands you an ALLY rather than a number.
     *
     * Epic, and gated to wave 9 rather than lightning's 7, because it is worth
     * more than one enemy's health: a compelled droid is a gun taken out of the
     * line AND a gun added to yours, so in arithmetic alone it is worth about
     * twice a kill for as long as it holds, and in a crowded wave it is worth
     * more than that because the crowd shoots back at it.
     *
     * `dark` and `force`, not `blade`: it is the one power in the game that
     * acts on a mind, and the alignment system already reads `dark` as the axis
     * of things done TO people rather than to bodies.
     */
    id: 'compel', icon: '👁', name: 'Domination', tag: 'Dark',
    rarity: 'epic', minWave: 9, axes: ['force', 'dark'],
    text: 'Take a mind. The one you touch turns its blaster on its own — or, alone, on itself.',
    apply(p) { p.boonMods.compel = true; },
  },
  {
    id: 'saberthrow', icon: '🪃', name: 'Cleaving Throw', tag: 'Technique',
    rarity: 'epic', minWave: 7, axes: ['blade'],
    text: 'The thrown blade cuts clean through everything it passes, and returns twice as fast.',
    // The flag is set from the RESULT, so it means "the technique is live on
    // this player" and not "somebody once ticked a box". cleavingThrow reads it
    // back every frame, which is also what makes it a setting with a reader.
    apply(p) { p.boonMods.throwPierce = cleavingThrow(p); },
  },
  {
    id: 'meditation', icon: '🧘', name: 'Meditation', tag: 'Discipline',
    rarity: 'common', axes: ['body'], stack: 3,
    /* "AND FLOW BLEEDS AWAY MORE SLOWLY" was the second half, and there is no
     * such mechanic anywhere in the tree. Flow bleeds at a flat `dt * 0.085` in
     * `Player._regen` and nothing scales it — `flowGain`, which is what this
     * card actually moves, multiplies what a returned bolt or a kill PAYS IN
     * (Player.addFlow) and never touches the drain. Driven on a real Player,
     * flow after 5 s of standing still from full:
     *
     *     no card         0.5750
     *     meditation ×1   0.5750     (flowGain 1.150)
     *     meditation ×3   0.5750     (flowGain 1.521)
     *
     * Identical to four decimal places at three ranks. The card is unchanged
     * and the sentence now describes the half that is real; making the bleed
     * itself scale would need a reader in Player._regen, which is handed over
     * rather than smuggled in here. */
    text: 'Stamina returns half again as fast, and everything you do earns more Flow.',
    apply(p, s = 1) { p.boonMods.staminaRegen *= grow(1.5, s); p.boonMods.flowGain *= grow(1.15, s); },
  },
  {
    id: 'vitality', icon: '❤', name: 'Vitality', tag: 'Body',
    // THE MEASURED OUTLIER. Paired same-seed runs put this at Δ1.730 model-depth
    // against a median modelled card of Δ0.143 — twelve times the median, the
    // widest gap in the table, and the top six cards were all survivability.
    // It is NOT nerfed here, because it is not overpowered so much as unopposed:
    // the fix is the offensive cards having something to sell (see Shatterpoint,
    // Extended Blade, Cadence) and the diminishing ranks bounding what a run can
    // pile into one axis. tools/checks/balance.mjs holds the spread to 6x.
    rarity: 'common', axes: ['body'], stack: 4,
    text: 'Thirty more vitality, and a kill returns a little of it.',
    apply(p, s = 1) {
      const d = Math.round(30 * s);
      p.maxHp += d; p.hp += d; p.boonMods.healOnKill += 3 * s;
    },
  },
  {
    id: 'celerity', icon: '💨', name: 'Celerity', tag: 'Speed',
    rarity: 'common', axes: ['body'], stack: 3,
    text: 'You move a fifth faster.',
    apply(p, s = 1) { p.boonMods.moveSpeed *= grow(1.2, s); },
  },
  {
    id: 'longblade', icon: '📏', name: 'Extended Blade', tag: 'Crystal',
    rarity: 'common', axes: ['blade'], stack: 3,
    // THE TIP-SPEED CARD, and it always was — the same angular swing through a
    // longer radius moves the point faster, which is the only reason the text
    // could promise "a faster tip for the same swing" without any code for it.
    // What changed is that tip speed is now worth something: SPEED_GRADE.perfect
    // came down off 15 m/s to 9.4, which a real swing can reach, so a longer
    // blade is what turns RETURNs into PERFECTs and their 1.5x into 2.5x. The
    // text says the consequence now rather than the mechanism.
    text: 'A longer blade. More reach, and a tip fast enough to turn returns into perfect ones.',
    apply(p, s = 1) { p.saber.bladeLength += 0.24 * s; },
  },
  {
    id: 'dualcrystal', icon: '💎', name: 'Focusing Crystal', tag: 'Crystal',
    rarity: 'rare', axes: ['blade'],
    text: 'A brighter, hotter blade. Cuts land more easily and the trail burns wider.',
    // Three promises, and for a long time one of them landed. The line is
    // unchanged — `coreWidth` is now an accessor on Saber, so writing it pushes
    // the new width into uWidth/uRadius and into trailThickness instead of
    // sitting in a field that only the constructor had ever read. Measured on a
    // live blade 60 frames after the draft: uWidth 0.0110/0.0330/0.1050 →
    // 0.0138/0.0413/0.1313, uRadius 0.360 → 0.450, trail half-thickness
    // 0.0528 → 0.0660. Before, all three were unchanged.
    apply(p, s = 1) { p.saber.coreWidth *= grow(1.25, s); p.boonMods.cutPower *= grow(1.2, s); },
  },
  {
    id: 'cadence', icon: '🥁', name: 'Cadence', tag: 'Tempo',
    rarity: 'common', axes: ['blade'], stack: 3,
    /**
     * THE CARD THE BLADE AXIS DID NOT HAVE.
     *
     * Every offensive boon in this table bought CUT DEPTH, and the harness
     * showed why that was worth nothing: kill time is one pass, 0.64 s, for ten
     * of fifteen archetypes, so a deeper cut removes a limb that was already
     * coming off. The blade's real ceiling is not how hard it cuts, it is
     * OVERHEAD.cooldown — 0.46 s, 2.17 swings a second — and nothing in the
     * game could move it.
     *
     * That is what this sells. It is the one offensive axis the model can see
     * and the one a player feels immediately, because it changes how often they
     * get to act rather than what happens when they do.
     */
    /* "A THIRD SOONER" was arithmetic run in the wrong direction. `attackRate`
     * is swings per second and SaberController divides by it —
     * `swingCool = OVERHEAD.cooldown / attackRate` — so a rank-1 1.33 takes the
     * 0.46 s recovery to 0.346 s, which is 24.8% sooner, not 33%. (Against the
     * whole 0.78 s swing-plus-recovery cycle it is 14.6%.) A card whose entire
     * pitch is a number has to state the number it produces. */
    text: 'You recover from a swing faster. The blade comes back around a quarter sooner.',
    apply(p, s = 1) { p.boonMods.attackRate *= grow(1.33, s); },
  },
  {
    id: 'lifesteal', icon: '🩸', name: 'Dark Sustenance', tag: 'Dark',
    rarity: 'rare', axes: ['dark'], stack: 3,
    text: 'Severing a limb returns vitality.',
    apply(p, s = 1) { p.boonMods.lifesteal += 5 * s; },
  },

  /* ── the conditional cards ──────────────────────────────────────────── */

  {
    id: 'counterstroke', icon: '↩', name: 'Counterstroke', tag: 'Riposte',
    rarity: 'common', axes: ['blade', 'guard'], stack: 3,
    text: 'A parry opens them up and you take the opening: while the riposte lasts your blade cuts twice as hard.',
    // Multiplies the window rather than setting it, so Makashi's doubling and
    // this card's stack instead of one overwriting the other.
    apply(p, s = 1) {
      p.boonMods.riposteWindow = (p.boonMods.riposteWindow ?? 1) * grow(1.35, s);
      p.boonMods.riposteCut = (p.boonMods.riposteCut ?? 1) + 1.0 * s;
      boonTick(p, 'counterstroke', riposteEdge);
    },
  },
  {
    id: 'wellspring', icon: '🔷', name: 'Wellspring', tag: 'Reservoir',
    rarity: 'common', axes: ['force'], stack: 3,
    /* "HALF AGAIN AS FAST" was 1.5 and the card gives 1.6 — a small drift, and
     * exactly the kind that survives forever because nobody does the division.
     * Caught by parsing the quantity out of this sentence and driving the card,
     * which is the only way a claim check is worth anything. The number stays
     * (tools/checks/escalation.mjs measures a real second of regeneration
     * against it); the sentence moves to what it actually pays. */
    text: 'A deeper well, and it fills back up three fifths again as fast.',
    apply(p, s = 1) {
      if (typeof p.maxForce === 'number') { p.maxForce += 45 * s; p.force = p.maxForce; }
      p.boonMods.forceRegen = (p.boonMods.forceRegen ?? 1) * grow(1.6, s);
      boonTick(p, 'wellspring', wellspringFlow);
    },
  },
  {
    id: 'encircle', icon: '⭕', name: 'Encircled', tag: 'Bulwark',
    rarity: 'common', axes: ['guard', 'body'], stack: 3,
    text: 'A crowd is cover. Every one of them within reach of you takes a little of the sting out of all of them.',
    // CAPPED, and this is the general rule for anything that subtracts damage:
    // `encircleGuard` scales this by the crowd size, so an uncapped third rank
    // in a wave-30 press would reach total immunity — a stack that ends the
    // game is not a reward. 0.14 against BODY_MAX is a hard ceiling well short
    // of one.
    apply(p, s = 1) {
      p.boonMods.encircle = Math.min(0.14, (p.boonMods.encircle ?? 0) + 0.06 * s);
      boonGuard(p, 'encircle', encircleGuard);
    },
  },
  {
    id: 'juyo', icon: '☄', name: 'Juyo', tag: 'Form VII',
    rarity: 'rare', axes: ['blade', 'dark'], stack: 3,
    text: 'Ferocity compounds. Every limb you take sharpens the next cut, and the edge cools the moment you stop.',
    apply(p, s = 1) {
      p.boonMods.ferocity = (p.boonMods.ferocity ?? 0) + 0.12 * s;
      boonTick(p, 'juyo', juyoEdge);
    },
  },
  {
    id: 'conduit', icon: '🌊', name: 'Conduit', tag: 'Channel',
    rarity: 'rare', axes: ['force'], stack: 3,
    text: 'The fight feeds the Force: every body you put down hands a measure of it straight back.',
    apply(p, s = 1) {
      p.boonMods.conduit = (p.boonMods.conduit ?? 0) + 22 * s;
      boonTick(p, 'conduit', conduitReturn);
    },
  },
  {
    id: 'secondwind', icon: '🕊', name: 'Second Wind', tag: 'Endurance',
    // A COUNT, so its ranks are whole and `rankScale` is deliberately ignored:
    // 0.6 of a second chance is not a thing. Two is the cap because a third
    // makes a wave essentially unloseable at the health where Fury pays best.
    rarity: 'rare', axes: ['body'], stack: 2,
    text: 'Once each wave, the blow that would finish you leaves you standing on a sliver instead.',
    apply(p) {
      p.boonMods.secondWind = (p.boonMods.secondWind ?? 0) + 1;
      boonGuard(p, 'secondwind', secondWindGuard, secondWindAfter);
    },
  },
  {
    id: 'fury', icon: '🔥', name: 'Fury', tag: 'Dark',
    rarity: 'rare', axes: ['dark', 'blade'], stack: 3,
    text: 'Pain is a weapon. The nearer death you are, the harder you strike and the faster you move.',
    apply(p, s = 1) {
      p.boonMods.fury = (p.boonMods.fury ?? 0) + 0.7 * s;
      boonTick(p, 'fury', furyEdge);
    },
  },
  {
    id: 'thorns', icon: '🪞', name: 'Reflection', tag: 'Retribution',
    rarity: 'common', axes: ['guard'], stack: 3,
    text: 'What is done to you is done back. A share of every blow that lands returns to whoever struck it.',
    apply(p, s = 1) {
      p._thornsShare = (p._thornsShare ?? 0) + 0.35 * s;
      boonGuard(p, 'thorns', null, thornsBack);
    },
  },
  {
    id: 'aegis', icon: '🔰', name: 'Aegis', tag: 'Barrier',
    // THE SHAPE THE GUARD AXIS DID NOT HAVE. Everything else that keeps you
    // alive is a bigger pool or a slower drain; this is a pool that comes BACK,
    // and only if you break contact. It is worth nothing to a player who stands
    // in the middle of a wave for ninety seconds and a great deal to one who
    // uses the ground — which is the behaviour the guard axis is supposed to
    // reward and had no way of paying for.
    rarity: 'common', axes: ['guard'], stack: 3,
    text: 'A ward of Force stands between you and the blow. It breaks, and it knits itself back together in the quiet.',
    apply(p, s = 1) {
      p._aegisMax = (p._aegisMax ?? 0) + 22 * s;
      p._aegis = p._aegisMax;
      p._aegisClock = AEGIS_WAIT;
      boonGuard(p, 'aegis', aegisSoak);
      boonTick(p, 'aegis', aegisMend);
    },
  },
  {
    id: 'momentum', icon: '🌠', name: 'Momentum', tag: 'Cadence',
    rarity: 'common', axes: ['body'], stack: 3,
    text: 'A body that falls is a step you did not have to take. Each kill drives the next, and standing still spends it.',
    apply(p, s = 1) {
      p.boonMods.moveSpeed *= grow(1.06, s);
      p._momentumPer = (p._momentumPer ?? 0) + 0.05 * s;
      boonTick(p, 'momentum', momentumRush);
    },
  },
  {
    id: 'execute', icon: '🗝', name: 'Mercy Stroke', tag: 'Finisher',
    rarity: 'rare', axes: ['dark'], stack: 3,
    text: 'Take a limb from something already broken and it does not get up. The kill is yours, and everything a kill pays.',
    apply(p, s = 1) {
      p._executeAt = Math.min(0.42, (p._executeAt ?? 0) + 0.14 * s);
      boonOnSever(p, 'execute', executeCut);
    },
  },
  {
    id: 'detonate', icon: '☢', name: 'Detonation', tag: 'Blast',
    rarity: 'rare', axes: ['force', 'dark'], stack: 3,
    text: 'What you fell goes off. Whatever was standing over the body wishes it had not been.',
    apply(p, s = 1) {
      p._detonate = (p._detonate ?? 0) + 14 * s;
      boonOnKill(p, 'detonate', detonateBody);
    },
  },
  {
    id: 'steadfast', icon: '🗿', name: 'Steadfast', tag: 'Stance',
    rarity: 'rare', axes: ['guard', 'body'], stack: 2,
    text: 'Nothing staggers you, and anything heavy enough to have tried lands for half.',
    // Capped for the same reason as Encircled: this one subtracts damage
    // outright, so two ranks of 0.5 would be immunity to every heavy blow in
    // the game.
    apply(p, s = 1) {
      p.boonMods.steadfast = Math.min(0.75, (p.boonMods.steadfast ?? 0) + 0.5 * s);
      boonGuard(p, 'steadfast', steadfastGuard);
      boonTick(p, 'steadfast', steadfastStance);
    },
  },

  /* ── communion: the cards that land on somebody else ────────────────── */

  {
    id: 'communion', icon: '🕯', name: 'Communion', tag: 'Bond',
    rarity: 'common', axes: ['bond'], stack: 3,
    text: 'Your presence is felt. Anyone fighting beside you cuts harder and moves faster for it — and alone, half of it stays with you.',
    apply(p, s = 1) {
      p._bondEdge = (p._bondEdge ?? 0) + BOND.step * s;
      boonTick(p, 'bond', bondAura);
    },
  },
  {
    id: 'suffusion', icon: '💠', name: 'Suffusion', tag: 'Bond',
    rarity: 'rare', axes: ['bond'], stack: 3,
    text: 'Every limb you take mends the people around you. If there is nobody, half of it mends you.',
    apply(p, s = 1) {
      p._bondHeal = (p._bondHeal ?? 0) + 4 * s;
      boonOnSever(p, 'suffusion', suffuseSever);
      boonTick(p, 'bond', bondAura);
    },
  },
  {
    id: 'vow', icon: '🤝', name: 'The Vow', tag: 'Bond',
    rarity: 'rare', axes: ['bond', 'guard'], stack: 2,
    // Capped in TWO places on purpose — BOND.wardCap bounds what an ally can be
    // handed and `vowGuard` bounds what you keep — for the same reason
    // Encircled and Steadfast are capped: anything that subtracts damage
    // outright reaches immunity if you let it stack.
    text: 'You stand between them and it. Anyone inside your communion takes less, and while somebody is there, so do you.',
    apply(p, s = 1) {
      p._bondWard = Math.min(BOND.wardCap, (p._bondWard ?? 0) + 0.12 * s);
      boonGuard(p, 'vow', vowGuard);
      boonTick(p, 'bond', bondAura);
    },
  },

  /* ── masteries: one per axis, and you must have committed ───────────── */

  {
    id: 'bastion', icon: '🏰', name: 'Bastion', tag: 'Mastery of Defence',
    rarity: 'epic', minWave: MASTERY_AT, axes: ['guard'], requires: mastery('guard'),
    text: 'Everything you turn aside comes back twice as hard, and turning it aside costs you nothing.',
    apply(p) {
      p.boonMods.deflectDamage *= 2.0;
      p.boonMods.guardRefund = 4;
      boonTick(p, 'bastion', bastionGuardRefund);
    },
  },
  {
    id: 'tempest', icon: '🌪', name: 'Tempest', tag: 'Mastery of the Force',
    rarity: 'epic', minWave: MASTERY_AT, axes: ['force'], requires: mastery('force'),
    text: 'Power feeds power. The deeper your Flow runs the less the Force asks, and at the flood it asks almost nothing.',
    apply(p) {
      p.boonMods.tempest = 0.85;
      boonTick(p, 'tempest', tempestDiscount);
    },
  },
  {
    id: 'sunder', icon: '⚔', name: 'Sundering', tag: 'Mastery of the Blade',
    rarity: 'epic', minWave: MASTERY_AT, axes: ['blade'], requires: mastery('blade'),
    text: 'The stroke does not stop at one body. Whatever was standing behind it loses a limb too.',
    apply(p) {
      p.boonMods.sunderReach = 2.4;
      boonOnSever(p, 'sunder', sunderThrough);
    },
  },
  {
    id: 'undying', icon: '🌿', name: 'Undying', tag: 'Mastery of the Body',
    rarity: 'epic', minWave: MASTERY_AT, axes: ['body'], requires: mastery('body'),
    text: 'Give it a few seconds without a wound and the wounds close by themselves.',
    apply(p) {
      p.boonMods.mend = 7;
      boonTick(p, 'undying', undyingMend);
    },
  },
  {
    id: 'unity', icon: '♾', name: 'The Unifying Force', tag: 'Mastery of Communion',
    rarity: 'epic', minWave: MASTERY_AT, axes: ['bond'], requires: mastery('bond'),
    text: 'The bond closes. Your communion reaches twice as far, and everything you were giving away you now also keep.',
    apply(p) {
      p._bondMastery = true;
      p._bondRange = (p._bondRange ?? BOND.range) * 2;
      p._bondEdge = (p._bondEdge ?? 0) + 0.10;
      boonTick(p, 'bond', bondAura);
    },
  },
  {
    id: 'darkside', icon: '⚫', name: 'The Dark Side', tag: 'Mastery of the Dark',
    rarity: 'epic', minWave: MASTERY_AT, axes: ['dark'], requires: mastery('dark'),
    text: 'A third of your vitality, gone. Everything you take from them, doubled — and the blade bites deeper for it.',
    apply(p) {
      if (p.maxHp > 0) { p.maxHp = Math.round(p.maxHp * 0.66); p.hp = Math.min(p.hp, p.maxHp); }
      p.boonMods.lifesteal = (p.boonMods.lifesteal || 0) * 2 + 4;
      p.boonMods.healOnKill = (p.boonMods.healOnKill || 0) * 2 + 5;
      p.boonMods.cutPower *= 1.25;
    },
  },
];

/* ══════════════════════════════════════════════════════════════════════ */
/*  ATTUNEMENTS — the growth that has no end                              */
/* ══════════════════════════════════════════════════════════════════════ */

/**
 * WHY THIS EXISTS, and why ranks were not enough.
 *
 * `RANK_DIMINISH` is a geometric series, so a ranked card converges: stack one
 * forever and it is worth 2.5 of itself and never more. That is exactly right
 * for keeping a build bounded, and exactly wrong as an answer to a budget that
 * grows without bound. Measured: the wave budget goes 7 -> 162 over twenty
 * waves and the raw damage a wave puts on an undefended player goes 17.8 ->
 * 230. Nothing that converges can race that.
 *
 * And even with ranks the card pool is finite — today 91 ranks across 40 cards,
 * which a draft every second wave exhausts at about wave 182. Better than the
 * 68 it was, still a wall, and past it the reward half of the loop went quiet
 * while the pressure half kept climbing forever.
 *
 * So: one choice, on every boss wave, that does NOT diminish and has NO cap.
 * Five axes, so a run's attunements and its cards pull in the same direction
 * and a build has one identity rather than two.
 *
 * FIVE, AND THE MASTERIES NAME SIX. This sentence used to read "the same five
 * the masteries already name", which stopped being true when Communion was
 * added: `bond` has a mastery (The Unifying Force) and no attunement, so a run
 * built entirely on the bond axis has nothing to spend a set-piece draft on
 * that is aimed at it. That is a real gap and it is written down rather than
 * papered over — adding a sixth attunement changes every draft distribution in
 * the game and is not something to slip in under a claims sweep.
 *
 * WHAT THEY DO NOT DO, corrected here because this comment used to claim it.
 * It read "1.12^20 by wave 100 is 9.6x, which is the same order as the ramp it
 * is racing", and that compares twenty ATTUNEMENTS — which is wave 100 — against
 * ramp figures measured over twenty WAVES. Measured properly, at the same waves,
 * with the pressure taken as raw dps rather than as the threat budget (each
 * extra unit of budget buys less dps than the last, so the budget overstates by
 * half):
 *
 *     wave   attunements   dps/w1    player   ratio
 *        5             1     4.02×    1.12×   0.279
 *       20             4    16.37×    1.57×   0.096
 *      100            20   203.33×    9.65×   0.047
 *
 * Attunements alone do not keep pace and were never going to. Cards, ranks,
 * skill and a blade that cuts anything carry most of it. What an attunement
 * actually provides is growth that is UNBOUNDED and MONOTONE where a rank
 * converges at 2.50x of one card — so the reward half of the loop never goes
 * quiet however deep the run gets, which is a different property from keeping
 * pace and is the one that makes an endless mode endless.
 *
 * `node --import ./tools/register.mjs tools/balance.mjs --only=attune` prints
 * that table; tools/checks/balance.mjs pins the property.
 *
 * They are shaped exactly like a boon — same `id`, `icon`, `name`, `text`,
 * `apply` — so they travel the whole existing path (draft screen, World.applyBoon,
 * Run.take, the replay in spawnPlayer) with no new machinery and no new UI.
 * `stack: Infinity` keeps them permanently in their pool, and every `apply`
 * IGNORES the rank scale it is handed, which is the one way they differ from a
 * card and the entire point of them.
 */
export const ATTUNE_STEP = 0.12;

export const ATTUNEMENTS = [
  {
    id: 'attune-blade', icon: '⚔', name: 'Attunement of the Blade', tag: 'Attunement',
    rarity: 'epic', stack: Infinity, attune: 'blade',
    text: 'The edge sharpens and the recovery shortens. Permanent, and it will happen again.',
    apply(p) { p.boonMods.cutPower *= 1 + ATTUNE_STEP; p.boonMods.attackRate *= 1.06; },
  },
  {
    id: 'attune-guard', icon: '🛡', name: 'Attunement of the Guard', tag: 'Attunement',
    rarity: 'epic', stack: Infinity, attune: 'guard',
    text: 'What you turn aside comes back harder, and what lands lands lighter. '
      + 'Permanent, and repeatable.',
    // See `wardGuard`: this is the game's only defensive axis that compounds,
    // and it is the blade attunement's own step in the opposite direction.
    apply(p) {
      p.boonMods.deflectDamage *= 1 + ATTUNE_STEP;
      p.boonMods.flowGain *= 1.05;
      p.boonMods.ward = (p.boonMods.ward ?? 1) * (1 - ATTUNE_STEP);
      boonGuard(p, 'attune-guard', wardGuard);
    },
  },
  {
    id: 'attune-force', icon: '🌀', name: 'Attunement of the Force', tag: 'Attunement',
    rarity: 'epic', stack: Infinity, attune: 'force',
    text: 'The Force asks less and returns sooner. Permanent, and repeatable.',
    apply(p) {
      p.boonMods.forceCost *= 1 - ATTUNE_STEP * 0.7;
      p.boonMods.forceRegen = (p.boonMods.forceRegen ?? 1) * 1.10;
      /* "…AND RETURNS SOONER" DID NOTHING WHATEVER ON ITS OWN.
       *
       * `Player._regen` regenerates the Force at a flat 7.5/s and does not read
       * `forceRegen` at all — the only thing in the tree that spends that field
       * is `wellspringFlow`, and until this line the only thing that installed
       * that tick was the Wellspring CARD. So half of an attunement that is
       * offered on every set-piece forever, and whose whole reason to exist is
       * unbounded growth, was live only for a player who happened to have drawn
       * a particular common. Measured, force regenerated over 4 s from empty:
       *
       *     no cards            30.00% of max
       *     attune-force ×1     30.00%      (forceRegen 1.10)
       *     attune-force ×4     30.00%      (forceRegen 1.46)
       *     wellspring          1.60× the base rate, as its text promises
       *
       * Four takes of a permanent uncapped choice, and the number it moved was
       * read by nothing. The existing balance check missed it because it asks
       * whether `boonMods` CHANGED, on a stub player with no update loop — a
       * field moving is not a field being read.
       *
       * The tick is installed under Wellspring's own name deliberately: it is a
       * Map keyed by name, so the two cards share one installation and the
       * regeneration is added once rather than twice. */
      boonTick(p, 'wellspring', wellspringFlow);
    },
  },
  {
    id: 'attune-body', icon: '❤', name: 'Attunement of the Body', tag: 'Attunement',
    rarity: 'epic', stack: Infinity, attune: 'body',
    // Additive on hp rather than multiplicative, so it does not compound with
    // Vitality's ranks into the same runaway the harness already caught once.
    text: 'You endure more of it, and carry it faster. Permanent, and repeatable.',
    apply(p) { p.maxHp += 18; p.hp += 18; p.boonMods.moveSpeed *= 1.04; },
  },
  {
    id: 'attune-bond', icon: '🕯', name: 'Attunement of the Bond', tag: 'Attunement',
    rarity: 'epic', stack: Infinity, attune: 'bond',
    /**
     * THE SIXTH AXIS, WHICH HAD A MASTERY AND NO ATTUNEMENT.
     *
     * `drawBoons` returns `ATTUNEMENTS.slice()` at an attunement wave, and the
     * comment on that line explains why it is all of them rather than a sample:
     * "a draft that happened not to offer the dark one would be denying a build
     * by dice". There were five of them and six axes with a mastery — guard,
     * force, blade, body, bond, dark — so a player who had committed to the
     * bond axis, taken Communion, Suffusion and the Vow and earned The Unifying
     * Force, was offered five permanent choices at every boss wave and not one
     * of them was theirs. Not denied by dice; denied outright, for the whole
     * life of the mode.
     *
     * WHAT IT DOES, and why it is written this way. `_bondEdge` is what the
     * aura carries and `_bondRange` is how far, both read by `bondAura` — and
     * `bondAura` has to be installed here, because a player can now reach this
     * card without ever having held a bond boon.
     *
     * ONE STEP IS ONE RANK OF COMMUNION — `BOND.step`, shared with the card
     * rather than typed again, which is also the plainest statement of what an
     * attunement is on this axis: the axis's own common card, once more, for
     * ever.
     *
     * The last two lines are the giver's own half, applied at APPLY time rather
     * than waiting for the first tick. `bondAura` computes exactly this every
     * frame and `boonFactor` is idempotent per slot, so the tick agrees with it
     * and does nothing; what it buys is that the card visibly moves the player
     * the instant it is taken. That matters beyond tidiness — a solo player
     * with nobody in range would otherwise see a permanent epic choice change
     * no number they can see, which is the exact shape of the two dead
     * attunements this suite caught last pass.
     */
    text: 'Your communion reaches further and carries more — and half of what you give, you keep.',
    apply(p) {
      const edge = p._bondEdge = (p._bondEdge ?? 0) + BOND.step;
      p._bondRange = (p._bondRange ?? BOND.range) * 1.12;
      boonTick(p, 'bond', bondAura);
      const share = p._bondMastery ? 1 : 0.5;
      boonFactor(p, 'cutPower', 'communion', 1 + edge * share);
      boonFactor(p, 'moveSpeed', 'communion', 1 + edge * 0.5 * share);
    },
  },
  {
    id: 'attune-dark', icon: '⚫', name: 'Attunement of the Dark', tag: 'Attunement',
    rarity: 'epic', stack: Infinity, attune: 'dark',
    text: 'It gives back more of what you take from them, and the taking sharpens you.',
    apply(p) {
      p.boonMods.lifesteal += 2;
      p.boonMods.ferocity = (p.boonMods.ferocity ?? 0) + 0.03;
      /* "AND THE TAKING SHARPENS YOU" — the same hole as attune-force, in the
       * other axis. `ferocity` is read by exactly one function, `juyoEdge`, and
       * the only thing that installed it was the Juyo card. Measured, cutPower
       * after five limbs taken:
       *
       *     attune-dark alone   1.00 → 1.00     (ferocity 0.03, unread)
       *     juyo alone          1.00 → 1.48
       *     juyo + attune-dark  1.00 → 1.60
       *
       * Same name as Juyo's own installation, for the same reason as above: one
       * tick, whichever card or attunement brought it. */
      boonTick(p, 'juyo', juyoEdge);
    },
  },
];

/**
 * Which set-piece drafts are attunements rather than cards.
 *
 * "…and past the first set-piece it is not a card at all" is what the draft
 * call has always said, and `attune: boss && wave >= BOSS_EVERY` is not that
 * sentence: a boss wave is a multiple of BOSS_EVERY, so `wave >= BOSS_EVERY` is
 * implied by `boss` and the condition was the constant `true`. Every boss draft
 * that could ever be laid out returned these five, and the four-card rare-floor
 * draft the same call configures two lines above was unreachable code.
 *
 * The rule lives HERE, below the pool it selects from, rather than at the two
 * call sites — the director and the co-op relay in main.js — because those two
 * hands must be the same hand. The relay passes its own `attune` computed off a
 * wave number sent over the wire; drawBoons is what makes it agree.
 */
export function isAttuneWave(wave) {
  return wave > BOSS_EVERY && wave % BOSS_EVERY === 0;
}

/** A card or an attunement, by id — the HUD and the scoreboard want either. */
export function boonById(id) {
  return BOONS.find((b) => b.id === id) || ATTUNEMENTS.find((a) => a.id === id) || null;
}

/**
 * How many times this holding has attuned to an axis. Ranks, so it counts the
 * repeats that are the whole point.
 */
export function attunementOf(taken, axis) {
  return rankOf(taken, `attune-${axis}`);
}

/** Weighted pick without replacement. Weights are strictly positive. */
function weightedPick(pool, weightOf) {
  let total = 0;
  for (const b of pool) total += weightOf(b);
  let r = rng() * total;
  for (const b of pool) { r -= weightOf(b); if (r <= 0) return b; }
  return pool[pool.length - 1];
}

/**
 * One draft.
 *
 * @param n       how many cards to lay out
 * @param taken   ids already held — never offered twice, and the set a mastery
 *                asks about to decide whether it may be offered at all
 * @param wave    what depth is asking, which is what moves the rarity weights
 * @param opts.floor  lowest rarity the FIRST card may be, if one is available
 */
export function drawBoons(n, taken = new Set(), wave = 1, opts = {}) {
  /**
   * WHICH TABLE. A boss wave hands out attunements instead of cards — see
   * ATTUNEMENTS — and every other draft is topped up with them once the card
   * pool thins, because a draft that offers nothing (or offers two things where
   * it promised three) is the failure this whole system exists to remove.
   * Attunements never run out, so neither branch can fail the way the old
   * no-repeats pool did at wave 68.
   */
  const inPool = (b) => rankOf(taken, b.id) < maxRank(b)
    && wave >= (b.minWave ?? 1)
    && (!b.requires || b.requires(taken));
  // ALL FIVE, never a weighted sample of them. An attunement is a permanent
  // commitment to an axis, and a draft that happened not to offer the dark one
  // would be denying a build by dice — with a slice of four out of five, the
  // last axis in the array was literally unreachable for a whole run.
  if (opts.attune && isAttuneWave(wave)) return ATTUNEMENTS.slice();
  // A card is in the pool while it has ranks left, not while it is unheld —
  // that one condition is what stops a deep run from draining the whole system
  // and then drafting nothing. See RANK_DIMINISH.
  const pool = BOONS.filter(inPool);
  // TOPPED UP, not merely rescued when empty. A pool down to its last two cards
  // hands back a two-card draft, and a short draft screen is the same failure
  // as an empty one wearing a smaller hat: the player is offered less because
  // of bookkeeping they cannot see. Attunements never run out, so they are what
  // the tail of a very deep run is made of.
  for (let i = 0; pool.length < n && i < ATTUNEMENTS.length; i++) pool.push(ATTUNEMENTS[i]);
  const weightOf = (b) => Math.max(1e-4, (RARITY[b.rarity] ?? RARITY.common).weight(wave));
  const out = [];
  const take = (from) => {
    const pick = weightedPick(from, weightOf);
    out.push(pick);
    pool.splice(pool.indexOf(pick), 1);
  };
  if (opts.floor && pool.length) {
    const tier = RARITY_ORDER.indexOf(opts.floor);
    const strong = pool.filter(b => RARITY_ORDER.indexOf(b.rarity ?? 'common') >= tier);
    if (strong.length) take(strong);
  }
  while (out.length < n && pool.length) take(pool);
  // Stamp the rank being OFFERED, for the card face. Display only: what a boon
  // is actually worth is decided by the rank the PLAYER holds when it is
  // applied, because a player respawned from a carried run replays its ranks in
  // order and must arrive at the same numbers it had before the level changed.
  return out.map((b) => {
    const rank = rankOf(taken, b.id) + 1;
    return rank > 1 ? { ...b, rank, name: `${b.name} ${ROMAN[rank] || rank}` } : b;
  });
}

const ROMAN = [, 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII'];
