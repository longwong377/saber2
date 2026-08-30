/**
 * BATTLEFRONT BORZ — the world.
 *
 * Owns the frame: input, blade solve, contact resolution, physics, spawning,
 * and everything the HUD reads. The update order matters — blades resolve
 * before bolts move, so a deflection is decided by where your blade was when
 * the bolt arrived, not by where it ended up afterwards.
 */

import * as THREE from '../../vendor/three/three.module.js';
import { RapierWorld, Body, LAYER, LOOSE_MASK, box, ball, hullFromGeometry, boxFromObject } from '../physics/RapierWorld.js';
import { Terrain, TERRAIN_PRESETS } from '../world/Terrain.js';
/* The cel band the ground sits in, for the contact marks' own contrast — see
 * the note beside `contacts.setGround` in `loadLevel`. One function, no table. */
import { celTone } from '../toon/Cel.js';
/* §12's generated ground. A leaf over Terrain.js — it borrows an authored
 * preset and replaces one field — so importing it here closes no cycle. */
import { battlefieldGround, installGround, removeGround } from '../world/Battlefield.js';
import { Particles } from '../world/Particles.js';
import { LightningVfx } from '../world/Lightning.js';
import { GrenadeField } from './Reactions.js';
import { CohortField } from './Cohorts.js';
import { openFront } from './Mass.js';
import { WarSupport } from './Support.js';
import { GrassField, Water, Atmosphere, weather } from '../world/Scenery.js';
import { BoltPool } from './Bolts.js';
import { BladeContactSolver, captureSnapshot, gradeCaught, resolveBladeClash, GRADE, GRADE_DAMAGE, GRADE_NAME, DIFFICULTY, CatchWindow, openness, guardCost, SCREEN, screenReach } from './Combat.js';
/* GUARD, for the arc a screen covers. SaberController imports nothing out of
 * game/ at all, so this edge cannot close a cycle — and the alternative was a
 * second copy of the shoulder line, which is the twin §2.3 keeps deleting. */
import { GUARD } from './SaberController.js';
import { assignSides, DuelMatch, Player, asTeam, bladeTargets, canHarm, hostileTo, pvpRules, PVP_LIMITS, sideTeam, teamOf, TEAM } from './Player.js';
import { ageDropped } from './Dropped.js';
import { Enemy, ARCHETYPES, applyModifier, ENEMY_POWERS, FORCE_KINDS, gripClaim, gripRelease, heldMass,
         IMPULSE_AS_HP, paysOut } from './Enemy.js';
import { armKinetic } from './Impact.js';
import { WaveDirector, RankSet, boonTick, boonGuard, bondReceive, bondGuardIn, bondGive, BOND, boonById, MODES,
  skirmishConfig, SKIRMISH } from './Waves.js';
import { Communion, FACETS, insightRate } from './LivingForce.js';
/**
 * WHAT ONE BROKEN THING IS WORTH IN INSIGHT — PLAN.md §4.6's Salvage.
 *
 * One. `INSIGHT_PER_WAVE` is 1 and a wave is minutes of fighting, so a level's
 * fifty breakable props are worth about fifty waves of Insight to a player who
 * goes and breaks every one of them — which sounds enormous until you price
 * what it costs: `COST` runs 4 to 9 with a step of 2 per facet already woken,
 * so a run that spent every prop on the lattice would buy about six more
 * facets and would have spent the whole battle hitting scenery instead of the
 * army that is taking its ground. The card pays for a way of playing rather
 * than for a chore, and the ceiling is the field.
 */
const SALVAGE_INSIGHT = 1;
import { nerveTick, witnessDeath, turnedHome, shakeNerve, nerveOf, boltAnswered, NERVE } from './Nerve.js';
/**
 * What "open" is worth, in Insight — and it was a quarter of what it promised.
 *
 * The card the player clicks says "A full purse at every deploy … you simply
 * never run short", and the note here said 600 "clears the whole chart with
 * room over". Measured through `Communion.costOf` itself, cheapest-first at
 * rank 0 — the most favourable order there is — waking all 46 facets costs
 * **2359**, and 600 buys **22 of 46**. Not a rounding error: a 3.9x shortfall
 * behind a sentence promising the opposite, on the setting that exists because
 * a player reported they could not reach Force lightning or Compel to find out
 * whether those powers work.
 *
 * DERIVED NOW, because the escalator makes any typed number wrong again the day
 * a facet is added — which is exactly how this one rotted. The old note's
 * REASONING was right and only its arithmetic was wrong, so the half again on
 * top is kept: the point is that you do not run out, and a sum that is exactly
 * enough is tense.
 */
const HOLOCRON_PURSE = (() => {
  const c = new Communion();
  const left = new Set(FACETS.map((f) => f.id));
  const taken = new Set();
  let total = 0;
  while (left.size) {
    let best = null, bp = Infinity;
    for (const id of left) { const p = c.costOf(id, taken); if (p < bp) { bp = p; best = id; } }
    total += bp; taken.add(best); c.bought.push(best); left.delete(best);
  }
  return Math.ceil(total * 1.5 / 100) * 100;
})();

/**
 * HOW HARD THE GROUND IS, as a reflection coefficient.
 *
 * The four keys are `Terrain.surfaceAt`'s own vocabulary — the same one
 * `Audio.SURFACES` already keys a footstep off — so this is a second reading of
 * an existing fact rather than a second table of levels. Sand is close to
 * anechoic; a steel deck gives you almost all of it back.
 */
const GROUND_ECHO = { sand: 0.14, water: 0.52, stone: 0.86, metal: 1.0 };

/**
 * WHAT ROOM IS THIS, derived from what the level already says.
 *
 * `Audio.init` built ONE convolver — `_makeImpulse(2.4, 2.6)` at a send of
 * 0.16 — and `grep reverbSend` found nothing after line 388. A 30,000-seat
 * stone bowl, an open dune sea and a sealed foundry shared a 2.4 s tail
 * forever, which is the one thing that makes seven distinct places sound like
 * one place.
 *
 * A level may say only `ambience: {wind, windFreq, drone}` and NONE of them has
 * a reverb field. Adding one to ten levels would be ten more hand-written
 * numbers beside a generated twin, which is the defect HANDOFF §2.3 is a
 * section about. So the room is DERIVED, from four facts every level already
 * carries, and each term is a physical claim rather than a taste:
 *
 *   WIND is the tell of OPENNESS. A sealed room has none — the temple ships
 *     0.05 and the foundry 0.04 — and an exposed ridge has all of it (alpine
 *     0.34, kamino 0.42). Air moving past your ears means there is nothing
 *     close enough to stop it, which is the same statement as "nothing close
 *     enough to reflect".
 *   THE GROUND decides how much of what does come back, comes back. Sand eats
 *     it; a foundry's steel deck returns nearly all of it.
 *   HOW FAR THE FIGHT SPREADS sets the path length, and `spawnRadius` is the
 *     one number every level states about its own size — geonosis's 96 m plain
 *     against the temple's 52 m hall.
 *   GRASS AND WATER are absorption and brightness. A metre of cover is the best
 *     broadband absorber outdoors; standing water is a mirror.
 *
 * @param level    a LEVELS entry
 * @param surface  what `Terrain.surfaceAt` says is underfoot
 * @returns {{seconds, decay, send}} straight into `audio.setRoom`
 */
export function roomOf(level, surface = 'sand') {
  const A = level?.ambience || {};
  // 0.26 is geonosis's open plain, and it is the point at which a level is
  // fully outdoors as far as this is concerned rather than the windiest thing
  // on the roster — alpine and kamino are ABOVE it because a ridge and an ocean
  // platform are more open than a plain, not because they are louder.
  const open = clamp(num(A.wind, 0.2) / 0.26, 0, 1);
  const enclosed = 1 - open;
  const echo = GROUND_ECHO[surface] ?? 0.4;
  const far = clamp(num(level?.spawnRadius?.[1], 50) / 96, 0.25, 1);
  const soft = clamp(num(level?.grass, 0) * 0.5, 0, 0.6);
  const wet = level?.water ? 1 : 0;

  /* THREE NUMBERS AND THREE SEPARATE CAUSES, which is the whole reason this is
   * not one curve with three outputs:
   *
   *   LENGTH is geometry. How far the reflection has to travel, and nothing
   *     else — a marble hall and a hay barn of the same size have the same
   *     path length and sound nothing alike, and that difference is `decay`.
   *   DECAY is material. How much survives each bounce.
   *   SEND is enclosure. How much of the room reaches the ear at all.
   *
   * Mixing them is how the first version of this gave a 30,000-seat stone bowl
   * a 1.13 s tail, because it multiplied the length by the SAND on its floor. */
  const seconds = clamp(0.28 + 2.7 * enclosed * (0.5 + 0.8 * far), 0.28, 3.6);
  // `decay` is the impulse's own exponent — bigger is a steeper die-away — so
  // absorption RAISES it. Grass is the strongest broadband absorber outdoors.
  const decay = clamp(3.4 - 1.9 * echo + 2.6 * soft - 0.4 * wet, 1.1, 5.2);
  /* Half the reflectors in an enclosed space are its WALLS, and the level says
   * nothing about those — only about the ground under your feet. So the surface
   * gets half the vote and the fact of being enclosed at all gets the other
   * half, which is what stops an arena with a sand floor reading as a field.
   * `enclosed ** 1.3` rather than linear: a partly sheltered plain is a plain. */
  const send = clamp(0.035 + 0.34 * Math.pow(enclosed, 1.3) * (0.5 + 0.5 * echo)
    + 0.05 * wet - 0.06 * soft, 0.03, 0.38);
  return { seconds, decay, send };
}
import { applyOrder } from './Order.js';
import { CAMPAIGNS, CAMPAIGN_IDS, LEVELS, LEVEL_ORDER, campaignAt, groundMight, levelRotation,
  spawnClear } from './Levels.js';

/**
 * WHAT A LEVEL'S AIR ASKS OF A BLADE.
 *
 * One place, so `_loadSteps` and `spawnPlayer` cannot answer differently. The
 * two inputs are the fog density and the sky's luminance because those are the
 * two things that decide how much of an ADDITIVE skirt survives — see the note
 * over the lobes in `Saber._syncWidth`. Rec. 709 luma, the same weights the
 * blade shader neutralises its core with, so "bright" means the same thing in
 * both files.
 */
function bladeEnvFor(a = {}) {
  const c = a.skyColor ?? 0x000000;
  const r = ((c >> 16) & 255) / 255, g = ((c >> 8) & 255) / 255, b = (c & 255) / 255;
  // sRGB → linear, because the atmosphere authors these as display colours and
  // the amplitude they are being compared against is linear.
  const lin = (v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
  return {
    haze: a.fogDensity ?? 0.0035,
    skyLum: lin(r) * 0.2126 + lin(g) * 0.7152 + lin(b) * 0.0722,
  };
}
import { AREAS, ARMY_IDS, CommandDirector, COMMAND_POWER_RULES, MAX_STRENGTH, OPENING_STRENGTH,
  assignArmies, commandConfig } from './Command.js';
import { ArmyIndex } from './ArmyIndex.js';
import { ObjectiveField } from './Objectives.js';
import { FireMissionDirector } from './FireMission.js';
import { CraterLog, SESSION_MEMORY } from '../world/CraterLog.js';
import { GraveField } from '../world/Graves.js';
import { FallenField } from '../world/Fallen.js';
import { Corpses, CORPSE_BUDGET } from './Corpses.js';
import { BladeLock } from './Duel.js';
import { FocusSystem } from './Focus.js';
import { DojoDirector } from './Dojo.js';
import { updateCauterisation } from './Ragdoll.js';
import { packAvatar, packMatch, packSnapshot, sessionPart } from '../net/Net.js';
import { QUALITY } from '../engine/Engine.js';
import { clamp, lerp, damp, dampVec, makeRng, moduleSeed, TAU } from '../engine/MathUtil.js';
import { audio, PRIO } from '../engine/Audio.js';
import { TokenPool } from './Tokens.js';
import { ContactShadows } from '../world/Contact.js';
/** Scratch for the contact-mark pass; one array, refilled, never grown. */
const _contactList = [];
/** Scratch for the one ground-colour read in `loadLevel`. */
const _groundCol = new THREE.Color();
import { ExtractionDirector, WITHDRAW_HOLD } from './Extraction.js';
import { runReport } from './Session.js';

/* Random per session, FIXED under the gate — see `moduleSeed`. The salt keeps
 * this stream from being the same sequence as MathUtil's `rand`. */
const rng = makeRng(moduleSeed(2));

/**
 * PUT THIS FILE'S STREAM BACK TO A STATED PLACE.
 *
 * `enemyRng.seed(n)` and `Waves.seedWaves(n)` have existed for a long time and
 * this stream had no equivalent, so a harness could pin two of the game's
 * three module-level streams and not the third. That is not a small gap: this
 * one is drawn by `pickSpawn`, `spawnDebris`, the dressing and a dozen other
 * per-frame callers, so its position after one run is a function of everything
 * that happened in it, and every run after the first in a process starts
 * somewhere nobody chose.
 *
 * WHAT IT COST, MEASURED, because "runs are not reproducible" is too weak a
 * sentence for it. Driving one engagement of the flagship mode to its muster
 * and counting survivors: two arms that differed ONLY in the mode string —
 * `theline` rolls a session plan (`rollSession`) and `command` does not, which
 * is a single extra draw — read **5.4 and 3.0 of ten** on the same director
 * and the same change. A whole tuning conclusion was drawn from that gap and
 * was wrong. Four consecutive readings of one build by one check spanned
 * **1.3 to 6.0**, purely on where the eleven checks above it had left this
 * stream.
 *
 * So it is exported the same way the other two are, `makeRng` already carries
 * the method, and a bench or a check that wants a comparison it can trust
 * calls all three. It changes nothing about a real session: `moduleSeed` still
 * decides where the stream opens, and nothing in `src/` calls this.
 */
export function seedWorld(seed) { rng.seed(seed >>> 0); return rng; }
/** Finite-or-default. Level data and game maths both produce NaN; WebAudio throws on it. */
const num = (v, d) => (Number.isFinite(v) ? v : d);

/**
 * Give the browser a frame — the yield `loadLevelAsync` is built out of.
 *
 * A real `requestAnimationFrame` where there is one, because only a repaint
 * actually moves a progress bar: a `setTimeout(0)` or a bare `await` lets the
 * next stage start before the pixels the last one paid for have been drawn, and
 * the bar jumps from 0 to 1 in one frame at the end. A microtask where there is
 * not, so a headless caller gets the same ORDERING without a 16 ms tax per
 * stage — the checks run this path too, and eight stages of real frames is a
 * tenth of a second per world.
 */
function nextFrame() {
  if (typeof requestAnimationFrame === 'function') {
    return new Promise((r) => requestAnimationFrame(() => r()));
  }
  return Promise.resolve();
}
/** Scratch for the aim origin — see the `aimOrigin` note in _throwCaught. */
const _aimFrom = new THREE.Vector3();
const _v1 = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3();
const _blastAt = new THREE.Vector3();
const _v4 = new THREE.Vector3(), _v5 = new THREE.Vector3();
/** Wire precision. Centimetres for positions, milli-units for directions. */
const r2 = (v) => Math.round(v * 100) / 100;
const r3 = (v) => Math.round(v * 1000) / 1000;

/**
 * How much of a body a full sever is worth, when you take it a share at a time.
 *
 * Grinding a limb off accumulates work up to the material's toughness and then
 * parts it. Partial work now deals partial damage, and this is the exchange
 * rate: complete a whole sever's worth of work and you will have dealt this
 * share of the target's maximum health along the way. 0.55 rather than 1.0
 * because taking the limb is itself supposed to be the decisive event — the
 * damage is what stops a failed pass from being free.
 *
 * ── AND IT IS A SHARE OF THE BONE, NOT OF THE BODY ────────────────────────
 *
 * That paragraph argues the number correctly for a body and never asks whether
 * a TOE is a body. It was a flat 0.55 of maximum health for every capsule on
 * every archetype, so completing a pass anywhere had already dealt 55% before
 * the sever was billed at all:
 *
 *   Rancor toe   grind 55.0% + sever 11.6% = 66.6% of a 2200 hp animal
 *   Acklay toe   grind 55.0% + sever  4.2% = 59.2%
 *   AT-TE toe    grind 55.0% + sever  2.8% = 57.8%
 *
 * Two completed passes killed anything in the game, through any bone it has.
 * That is the same defect that `VITAL[name] ?? 0.4` was — one price for every
 * part of every body — surviving one module to the side of where it was fixed,
 * and `SEVERANCE`'s note in Enemy.js named it as the bigger half of the toe.
 *
 * `grindWorth` below multiplies by what the capsule is actually worth, so this
 * constant keeps its meaning and its tuned value: for a full-worth capsule —
 * a torso, a neck, a head — a completed grind still deals exactly 0.55 of
 * maximum health, which is where the number was measured and felt. Everything
 * cheaper than a body now costs what it is.
 */
export const GRIND_LETHALITY = 0.55;
/**
 * What the capsule under the blade is worth, for billing a grind.
 *
 * The shield first, and for `takeCut`'s reason: a bubble is not a bone, it
 * carries no `vital` on purpose, and the pass costs the shield rather than the
 * body. Grinding one bills nothing here; `takeCut` drops it when the pass
 * completes.
 *
 * And no `?? 1` after that. A bone capsule with no price is a capsule that has
 * not been through `severance`, which is exactly the condition `takeCut` throws
 * on — so answering it here with a quiet default would put the silent fallback
 * back into the game one function away from where it was taken out. A capsule
 * that reaches this without a price will throw there a moment later anyway;
 * this returns 0 so the frame survives to get there, and bills nothing rather
 * than billing a body.
 */
export function grindWorth(cap) {
  if (!cap || cap.shield) return 0;
  return typeof cap.vital === 'number' ? cap.vital : 0;
}

/**
 * WHETHER KILLING THIS BODY IS WORTH ANYTHING — FLAGSHIP §6's third class.
 *
 * MOVED TO `Enemy.js`, beside the table it asks about, and re-exported here so
 * that every reader of `World.paysOut` is unchanged. The move is not tidying:
 * `Levy.js` is reached from `Command.js` and imported this from `World.js`,
 * which closed Command → Levy → World → Player → ui/Menu → Command and made
 * `Command.js`, `Levels.js` and `tools/_flagship.mjs` unloadable as the first
 * module of a process. The whole argument is over the definition.
 */
export { paysOut };
/** Stamina a lost exchange costs, before the attack's tier scales it. */
const GUARD_COST = 22;
/**
 * The most often the army's state is put on the wire, in seconds. See
 * `_armyTick` — it is a ceiling on a message that is only sent when something
 * changed, not a heartbeat.
 */
const ARMY_INTERVAL = 0.5;
/**
 * How long the host keeps holding a body a peer said it was lifting, with
 * nothing further heard. See `applyClaim`'s grip branch — the claim is re-sent
 * on every one of the client's claim ticks (1/24 s), so this is fourteen of
 * them: long enough that a bad connection cannot drop what a player is holding,
 * short enough that a lid closing does not leave an acolyte in the air.
 */
const NET_GRIP_LEASE = 0.6;

/**
 * Re-exported, not restated: the number is Extraction.js's, and its note there
 * says why it had to live in the file the Codex can also see. `HUD` fills its
 * ring against it and `tools/checks/extraction.mjs` reads it, both through
 * here, so neither had to move.
 */
export { WITHDRAW_HOLD } from './Extraction.js';

export class World {
  /**
   * @param run  WHAT THIS RUN IS, as opposed to what the PLAYER PREFERS.
   *
   * A third bag, and it is a scope and not a convenience. `settings` is a blob
   * that is saved, loaded, spread over by a host's session, held to a default
   * apiece and audited by four checks in `controls.mjs` — one of which exists
   * precisely to catch "a setting that is read by shipped code and declared
   * nowhere", because such a key needs no default, no control and no reader
   * declaration and nothing anywhere complains. A saved COMPANY is not a
   * preference by any of those tests: it has no control, it must never ride a
   * host's session blob into somebody else's save, and a default for it is
   * meaningless. So it comes in here instead, where `runSeed` and the rest of
   * what makes one run this run already live.
   */
  constructor(engine, settings, run = null) {
    this.engine = engine;
    this.scene = engine.scene;
    this.settings = settings;
    /** Run-scoped inputs — see the parameter's note. Never persisted. */
    this.run = run || {};
    this.physics = new RapierWorld({ gravity: -24, iterations: 4, maxBodies: settings.maxBodies ?? 1100 });

    this.players = [];
    /* WHO MAY HARM WHOM, as one object rather than a test repeated at every
     * damage path. `pvpRules({})` returns co-op's rules — friendly fire off,
     * everyone on side 0 — so every existing world is unchanged by this. */
    this.rules = pvpRules(settings);
    /**
     * THE NUMBER THAT MEANS "ON *MY* SIDE" — and the emphasis is the change.
     *
     * It was `TEAM.PARTY`, a world-scoped constant, and it read correctly for
     * as long as every player in a session was on side 0. Its two readers both
     * mean "the side the person at THIS keyboard is on":
     * `WaveDirector.blocksWaveEnd` counts what is left to fight, and the HUD's
     * hostile count is the number beside it. On a machine whose player is on
     * side 2 — which is what a duel and a two-commander Command match are —
     * both of them counted their own army as the enemy and the enemy as their
     * own.
     *
     * So it follows the local player now, written by `spawnPlayer`, and it is
     * still `TEAM.PARTY` before there is one and in every co-op session there
     * will ever be. `CommandDirector.deploy` no longer reads it at all: an army
     * belongs to a COMMANDER and wears that commander's side, which is the
     * whole of how two of them can stand on one field.
     */
    this.partyTeam = TEAM.PARTY;
    this.enemies = [];
    /* THE BROAD PHASE FOR THE BODY LIST, rebuilt once a frame in `update`.
     * `pickTarget`'s own note has said "this is O(bodies²) per frame" for as
     * long as the cross-army pass has existed; src/game/ArmyIndex.js is the
     * structure that stops it being true. */
    this.armyIndex = new ArmyIndex();
    /** Who `_hostilePred` is answering for. See `pickTarget`. */
    this._hostileTo = null;
    /* `!e.downed` — a man on the ground is not what anybody is shooting at.
     * PLAN.md §4.9 has an enemy who REACHES the body finish it, and that is a
     * proximity rule (`Enemy._tickDown`), not a targeting one: a line that
     * preferred casualties to the men still firing at it would walk past the
     * fight to execute the wounded, which is neither what soldiers do nor what
     * makes recovering them a decision. */
    this._hostilePred = (e) => e !== this._hostileTo && !e.dead && !e.downed
      && e.team !== this._hostileTo.team;
    this.props = [];
    this.doors = [];
    this.debris = [];
    this.locks = [];
    this.statics = [];
    this.levelLights = [];
    this.takenBoons = new RankSet();
    /**
     * The Insight this run has earned and the facets it has spent it on.
     *
     * Lives on the World because the wave director is what earns it and the
     * meditation is what spends it; carried across a landing by the Run, which
     * is the only object that outlives a level. See LivingForce.js.
     *
     * SURVIVING A WAVE IS THE ONLY THING THAT EARNS IT — not kills, not score,
     * not accuracy. A currency that pays out for anything other than the thing
     * the mode is about ends up being farmed instead of played, and there is
     * nothing here to farm. A set-piece pays more because a set-piece cost more.
     */
    this.communion = new Communion({ seed: this.runSeed | 0 });

    this.timeScale = 1;
    this.focus = new FocusSystem();
    this.targetTimeScale = 1;
    this.hitstop = 0;
    this.time = 0;
    this.score = 0;
    /**
     * HOW MANY BODIES THIS RUN HAD TO BE PUT BACK ON SCREEN. See
     * `Enemy._auditVisible`, which is the only writer.
     *
     * It is a COUNTER and not a log line because the number is the useful
     * thing: in a healthy run it is 0 for the whole battle, and any other
     * value is a body that was drawing nothing while it was alive — the defect
     * the player reported as "troops go completely invisible a lot". A check
     * asserts the zero; a repair that happened silently would be a defect that
     * had been hidden rather than fixed.
     */
    this.ghostFixes = 0;
    this.combatIntensity = 0;
    this.paused = false;
    this.running = false;
    /** The run has ended. Everything still steps; the director does not. */
    this.over = false;
    /** How far through the extraction hold the player is, in [0,1]. The HUD's ring. */
    this.withdrawHold = 0;
    /** Who was on the ship when a withdrawal ended the run. Null until then. */
    this.manifest = null;

    this.difficulty = DIFFICULTY[settings.difficulty] || DIFFICULTY.knight;
    // `this.hpScale = 1` and `this.dmgScale = 1` used to sit here. Enemy reads
    // them as `A.hp * (world.hpScale ?? 1)` and `A.damage * (world.dmgScale ??
    // 1)`, and no line in src/ ever wrote either of them again — they were
    // written once, to the identity of the operation they feed, and moved by
    // nothing: no difficulty tier, no mode, no wave, no menu control. A knob
    // pinned at its own identity forever is not a knob, it is a claim that one
    // exists, and the next reader greps for a writer and finds the constructor
    // agreeing with itself. The SEAM is not lost — Enemy's `?? 1` is what
    // makes the field optional — so the day something really does want to
    // scale a droid's hp it assigns it here and every enemy spawned after
    // picks it up, which is exactly what the old line looked like it was for
    // and never did.

    /**
     * HOW MANY OF THE DEAD THE FIELD KEEPS — player note #15, second half.
     *
     * "sometimes for fun I'll spawn like 30 enemies and then it gets really
     * really laggy, framerate probably <10 once there are that many DEAD AND
     * ALIVE enemies on the map." Measured with tools/_crowd.mjs, thirty
     * acolytes on the colosseum: thirty CORPSES simulate at 11.46 ms against
     * thirty live ones at 6.76 and an empty field at 5.30, because a ragdoll is
     * nineteen loose bodies with joints where a walking enemy is one capsule —
     * 573 rigid bodies against 33. Nothing in this repository had ever removed
     * one.
     *
     * ON THE WORLD rather than on the director, because a corpse outlives the
     * wave that made it and every mode makes them — a duel, the sandbox and the
     * dojo all leave bodies on the floor and none of them has a wave director
     * that could own the budget.
     *
     * The budget rides the fidelity tier and not the difficulty: it is a
     * frame-rate number, in the same sense `HEAVY_CAP` is, and `CORPSE_BUDGET`
     * derives it from the measured cost of one corpse against the draw budget
     * `world-immersion` holds a level to. Read `Corpses.js` before changing it —
     * retirement is GRADED, and the big win (573 bodies → 33) is the SETTLE step
     * which every corpse gets unrationed and which takes nothing off the screen.
     */
    this.corpses = new Corpses(this, {
      budget: CORPSE_BUDGET[settings?.quality] ?? CORPSE_BUDGET.high,
    });

    this.bladeSolver = new BladeContactSolver();
    /**
     * `this.events = []` AND `this.notifications = []` USED TO BE HERE.
     *
     * `grep -rn 'notifications' src/` returned exactly two lines: this
     * declaration and the push in `notify()`. `.events` returned one: the
     * declaration. Neither was ever read by anything, neither was aged (`t: 0`
     * was a field nothing ever advanced), neither was capped, and `unload()`
     * cleared twelve other collections and not these — so a level change
     * carried them over too.
     *
     * `onNotify` is the real path to the HUD, which caps its own popups at
     * four. This array was a second, unread source of truth that only grew, and
     * its volume driver is `Player._refuse()` — one entry for every Force power
     * refused on cooldown. Measured: 262 objects in 90 s of ordinary play, ~2.9
     * a second, still 262 after `unload()`, about ten thousand an hour.
     *
     * Deleted rather than fixed, because there is no reader to fix it for. If a
     * feed ever wants a history, it belongs where the HUD already keeps one.
     */

    this._targets = [];
    this._capsCache = [];

    /**
     * THE JOURNEY BETWEEN GROUNDS — see src/game/Extraction.js.
     *
     * Built with the World and not with the level, deliberately: it is the one
     * director that has to be ALIVE ACROSS a level change, because the flight
     * it runs spans one. `unload()` therefore does not touch it and neither
     * does `_loadSteps`; `dispose()` does, and so does the run ending.
     */
    /**
     * WAR SUPPORT — what a stratagem costs, and it is not the player's Force.
     *
     * The player: "strategems should not cost force how does that even fucking
     * make sense? maybe there's a bar and it shows the level of outside support
     * and resources that have built up… when you use them it depletes your
     * side's support resources so like carriers rearming".
     *
     * It is on the WORLD and not on the Player because a side has one supply
     * line: in co-op the party shares it, which is what makes spending it a
     * thing to talk about. See src/game/Support.js.
     */
    this.support = new WarSupport();
    this.extraction = new ExtractionDirector(this);
    /* WHO MAY BE SWINGING AT YOU AT ONCE — see `src/game/Tokens.js`. Held on the
     * world rather than on the player because a meeting has two commanders and
     * an ally can be mobbed too: the ring is keyed by TARGET. */
    this.tokens = new TokenPool();
    /* THE DARK UNDER A MAN'S FEET — see `src/world/Contact.js`. Built here and
     * not in `loadLevel` because it survives a ground change: it holds no level
     * geometry, only a pool of marks it rewrites every frame. */
    this.contacts = new ContactShadows(this.scene);
  }

  /* ── level lifecycle ─────────────────────────────────────────────── */

  /**
   * @param key   a LEVELS key
   *
   * `unload()` disposes every player, and with it `boonMods`, `maxHp`, the taken
   * boons, the Insight and the per-player tally — which is why every level in
   * this game is a separate arena rather than a place in a longer journey.
   *
   * THIS DOC BLOCK USED TO PROMISE `opts.run`: "a Run that must SURVIVE this
   * call … held across that and re-applied to the player that comes out the
   * other side, so a landing is a transition rather than a restart." That was
   * true of the Descent and `Run.js` was deleted with it. `grep -n 'opts.run'`
   * over this file returned that one line — the parameter had no reader
   * anywhere in `_loadSteps`, so anything trusting the sentence would have
   * silently lost the whole build. A promise with no implementation is worse
   * than an absence, because it is the absence plus a reason not to look.
   *
   * The capability the sentence described is real again and is `rotateTo`,
   * which snapshots with `runCarry()` and restores with `applyCarry()`. It is
   * NOT a parameter of this method: a level load starts a clean world by
   * definition, and the carry is a decision the CALLER makes about a run, which
   * is the same reason `runSeed` is assigned by main.js and not by World.
   */
  loadLevel(key, opts = {}) {
    for (const step of this._loadSteps(key, opts)) step.run();
    return this.level;
  }

  /**
   * THE SAME LOAD, WITH THE TAB STILL BREATHING — and a progress bar over it.
   *
   * `deploy()` calls this work synchronously: terrain heightfield, Rapier
   * world, instanced fields, textures and up to 341 hand-placed statics, all on
   * the main thread with no yield. Measured headless per level on this box,
   * warm: 444 ms (colosseum) to 1150 ms (mustafar), and the first load of a
   * session 4469 ms. For that whole time the page cannot paint, cannot answer a
   * click and cannot show a spinner — the menu simply disappears and the tab
   * freezes, which is indistinguishable from a crash.
   *
   * THE BOOT SEQUENCE ALREADY DOES THIS PROPERLY. Eleven named steps, each
   * awaiting a frame, with a bar over them. This is the same shape for the same
   * reason, and it shares ONE list of steps with the synchronous path — a
   * second copy of the level build beside the first is the defect this project
   * keeps a section of HANDOFF for, and it would drift the moment a level
   * gained a system.
   *
   * `frame()` is a real `requestAnimationFrame` where there is one and a
   * microtask where there is not, so a headless caller gets the same ordering
   * without a 16 ms tax per step.
   *
   * @param onProgress (fraction 0..1, label) before each step
   */
  async loadLevelAsync(key, opts = {}, onProgress = null) {
    const steps = this._loadSteps(key, opts);
    for (let i = 0; i < steps.length; i++) {
      try { onProgress?.(i / steps.length, steps[i].name); } catch {}
      await nextFrame();
      steps[i].run();
    }
    try { onProgress?.(1, 'ready'); } catch {}
    return this.level;
  }

  /**
   * The level build, as a list of named stages.
   *
   * Closures over one scope rather than methods taking six arguments each: the
   * stages genuinely share `L`, the quality tier and the two derived scales,
   * and threading those through a signature would be six places for them to
   * disagree. The list is the authority for BOTH doors above.
   */
  _loadSteps(key, opts = {}) {
    let L = null, q = null, detail = 1, particleScale = 1;
    const steps = [
      /* THE OLD LEVEL GOING AWAY IS ITS OWN STAGE, and measured, it is the
       * biggest one on a level-to-level transition: disposing a built Temple
       * (341 statics, each with geometry and a collider) took 5366 ms of a
       * 7098 ms rebuild on this box. Folded into the bookkeeping below it, the
       * progress bar would have sat at 1/7 for three quarters of the wait and
       * then run to the end — which is the shape of bar players read as hung. */
      { name: 'clearing the field', run: () => this.unload() },

      { name: 'reading the level', run: () => {
    /**
     * DERIVED, so it is rebuilt rather than appended to.
     *
     * `unload()` does not clear this — it disposes the world, and the taken-set
     * is not part of the world — so a landing used to re-add every carried boon
     * to a set that already held it. That was harmless while the set was a
     * plain Set and an id could only be present once. It stopped being harmless
     * the moment cards had RANKS: a four-rung climb would have counted a
     * rank-2 Vitality as rank 8, dropping cards out of the draft pool early and
     * handing out masteries three tiers before they were earned.
     *
     * `spawnPlayer` refills it from the order's grants and the run's own list,
     * which are the only two things it should ever have contained.
     */
    this.takenBoons = new RankSet();
    // …and the same for the Insight ledger. `bought.length` is the price
    // escalator, so a ground change that forgot it would make every facet cost
    // first-purchase prices again. A level load starts a FRESH ledger — that is
    // what a level load is — and the run that has to survive one puts it back:
    // `runCarry` reads `insight`/`bought`/`earned` off here and `applyCarry`
    // rebuilds the Communion from them, which is the same shape the deleted Run
    // used and the same three fields `Communion`'s own constructor takes.
    /* SEEDED WITH THE RUN, because the Holocron's offer is a fact about this
     * sitting — see `LivingForce.OFFER`. `runSeed` is written onto the World by
     * main.js before the level loads, which is the same door the wave stream and
     * the objective field read it through. */
    this.communion = new Communion({ seed: this.runSeed | 0 });
    // LEVEL_ORDER[0] rather than a name: a named fallback is how a deleted
    // level stays load-bearing after it is gone. See Levels.js's alias block.
    //
    // `levelKey` names the level that was ACTUALLY loaded, not the one that was
    // asked for. It used to record the request, which made the fallback a trap
    // rather than a safety net: the world came up fine on the substitute and
    // then whoever read the key back — `main.js` does, for the HUD's level
    // name — indexed LEVELS with a key that is not in it and threw. A saved
    // profile pointing at a deleted level took the game down on the frame after
    // it had already recovered.
    /**
     * A MODE THAT OWNS ITS GROUND OVERRULES THE REQUEST, and this belongs here
     * rather than in `deploy()`.
     *
     * `MODES.command` declares `level: 'geonosis'` — the machine-readable half
     * of the `fixedTheatre` sentence the menu prints while greying the Theatre
     * column. My first fix read that field in `main.js:deploy()`, which fixes
     * the game and nothing else: `bootWorld`, the checks, the net layer and
     * every future caller reach `loadLevel` directly and would each have needed
     * their own copy of the rule. That is HANDOFF §2.4 — the rule lives with
     * the thing it governs, and is CALLED, not restated.
     *
     * Putting it here is also what makes the check honest: it can ask for
     * another theatre through the ordinary door and observe geonosis come back.
     */
    const owned = MODES[this.settings?.mode]?.level;
    if (owned && LEVELS[owned]) key = owned;
    const resolved = LEVELS[key] ? key : LEVEL_ORDER[0];
    L = LEVELS[resolved];
    this.level = L;
    this.levelKey = resolved;
    this.groundColor = L.groundColor;

    // ONE VALUE, ONE HOME. This used to be `{low:0.55, medium:0.8, high:1,
    // ultra:1.25}[quality]`, written out here, and Engine's QUALITY.grass
    // (0.25→1.5) and QUALITY.particles (0.4→1.35) had no reader in src/ at all
    // — they had been dead since the foundation commit. Two of the four things
    // the Performance card promises ("fewer particles… for laptops") were
    // therefore identical at every tier: 19,800 pooled particles and 11,000
    // blades at `low` exactly as at `ultra`. The `?? q` on particleScale made
    // it worse than dead: particleScale is an UNCONDITIONAL key of
    // DEFAULT_SETTINGS, so the fallback could never be reached and the tier
    // never touched particles even by accident.
    //
    // So the ladder is Engine's, and the player's own two sliders MULTIPLY it
    // rather than replace it. Those sliders are #opt-grass and #opt-particles
    // under Fidelity, writing `grassScale` and `particleScale`. When this
    // sentence was written they did not exist — the two settings had a reader
    // here, a default of 1 in DEFAULT_SETTINGS, no control anywhere in the menu
    // and therefore no way of ever being anything but 1, while this comment
    // described the UI a player would go looking for and not find.
    q = QUALITY[this.settings.quality] || QUALITY.high;
    // Terrain detail is the tier's own VIEW DISTANCE, normalised to `high`:
    // the mesh exists to be looked across, so the tier that draws to 900 m has
    // to carry the vertices for it. 380/520/700/900 against high's 700 gives
    // 0.54 / 0.74 / 1.00 / 1.29 — within a vertex row of the hand-written
    // ladder it replaces, and unlike it, it cannot drift away from the tier.
    /**
     * HOW FAR AN ENEMY MAY BE AND STILL SOLVE ITS GARMENTS, resolved here.
     *
     * Enemy reads `world.clothCut` rather than QUALITY directly, and that is
     * not indirection for its own sake. Enemy.js is inside verify.mjs's own
     * STATIC import graph (verify → Waves → Enemy), and a static edge from
     * there to Engine.js evaluates Engine's module-level ShaderChunk rewrites
     * against the node_modules copy of three rather than the vendored one,
     * burning their once-only flags — which turns the four aerial-perspective
     * checks and two materials checks quietly red. The note at the top of
     * tools/verify.mjs records the same trap being sprung through Player.js.
     * World is not in that graph, so the lookup belongs here.
     */
    // CALLED, not restated (HANDOFF §2.4). `applyQuality` is the one place a
    // tier's live scalars are resolved, so a column added there is applied at
    // load as well without a second line here to keep in step. It is safe this
    // early: its other clause is guarded on `this.particles`, which the pools
    // stage builds later in this same list.
    this.applyQuality(this.settings.quality);
    detail = q.viewDist / QUALITY.high.viewDist;
    particleScale = (this.settings.particleScale ?? 1) * q.particles;
      } },

      /* The heightfield and the Rapier collider under it — the single most
       * expensive thing a level build does, and the reason the tab used to
       * stop answering for half a second before anything appeared. */
      { name: 'raising the ground', run: () => {
    this.terrain = new Terrain(this.scene, this._groundKeyFor(L), detail);
    this.physics.terrain = this.terrain;
      } },

      { name: 'lighting the sky', run: () => {
    this.particles = new Particles(this.scene, particleScale);
    /**
     * FORCE LIGHTNING HAS ITS OWN POOL, and that is the whole answer to a note
     * the player has now made many times: "it's nothing in the air right now
     * like there's no VFX or anything".
     *
     * It used to be drawn out of `particles.sparks` — a shared ring of 6 cm
     * point sprites sized for blade hits — so a bolt was forty dots in a line
     * competing with every cut in the fight for the same ring. `LightningVfx`
     * draws camera-facing RIBBONS: one continuous strip whose width is in
     * world units, so it is a bright filament at two metres and at twenty
     * rather than a row of dots that thins as you back away.
     *
     * It lives on the World rather than on the Player because two players in
     * co-op share it, and because `unload` is the one place that knows when a
     * scene stops existing.
     */
    this.lightning = new LightningVfx(this.scene);
    /**
     * LIVE GRENADES, and the reason they are a WORLD system rather than a
     * stratagem or an enemy's private toy.
     *
     * The player: "I haven't seen any troops diving or having any dynamic
     * movements… diving out of the way of a grenade or picking one up and
     * throwing it back (sometimes killing themselves) or diving on a grenade to
     * save their friends". Every one of those is a decision taken during the
     * second and a half a grenade spends lying on the ground — and nothing in
     * this game had ever occupied a piece of ground for a second and a half.
     * `Stratagems.blast` is instantaneous: it lands, it hurts, the frame moves
     * on. So the thing to build first was the object, not the behaviour.
     *
     * It sits here beside `bolts` because it is the same kind of thing: a
     * shared, world-owned list of live hazards that every body on both sides
     * reads and none of them owns. See src/game/Reactions.js.
     */
    this.grenades = new GrenadeField(this);
    /* …and the far end of the rendering ladder, for the same reason it sits
     * here: a shared, world-owned thing that every body past L3_AT draws
     * through and none of them owns. See src/game/Cohorts.js. */
    this.cohorts = new CohortField(this.scene);
    this.bolts = new BoltPool(this.scene, 460);
    this.bolts.onDeflect = (b, entry, hit, pt) => this._onBoltDeflect(b, entry, hit, pt);
    this.bolts.onImpact = (b, res) => this._onBoltImpact(b, res);

    this.engine.applyAtmosphere(L.atmosphere);
    /**
     * …AND THE CONTACT MARKS ARE TOLD WHAT GROUND THEY ARE DRAWN ON.
     *
     * `Contact.farAlphaFor` solves the mark's darkness against the ground's
     * own value so it holds a stated contrast on a pale salt pan and on a mid
     * sand alike — see its note for the seven measured ratios that made a
     * fixed 0.5 the wrong number. This is the one place both the level record
     * and the pool are in hand.
     *
     * THE VALUE ON SCREEN, NOT THE AUTHORED ALBEDO. The eye compares the mark
     * against the lit ground, and flat ground sits in the cel LIT band by
     * construction (`CEL.terminatorRel` is placed relative to the light's own
     * horizontal response for exactly that reason), so the band the ground is
     * in is `celTone(sin e, sin e)` at the level's own sun elevation.
     * `Rec.709` because that is the luminance a silhouette is read by.
     */
    const gc = TERRAIN_PRESETS[this._groundKeyFor(L)]?.sandColor;
    if (gc != null && this.contacts) {
      const e = (L.atmosphere?.elevation ?? 22) * Math.PI / 180;
      const key = Math.sin(e);
      _groundCol.set(gc);
      const lum = 0.2126 * _groundCol.r + 0.7152 * _groundCol.g + 0.0722 * _groundCol.b;
      this.contacts.setGround(lum * celTone(key, key));
    }
    /* AND THE BLADE IS TOLD WHAT AIR IT IS BEING SWUNG IN.
     *
     * `Saber.setEnvironment` lifts the two OUTER lobes on a bright or hazy
     * ground — see the long note in BLADE_FRAG for why the colour washing out
     * in weather is a per-level quantity and not a curve in the shader. Read
     * off `L.atmosphere` here rather than authored per level, so a sky that is
     * re-lit carries its blade with it and there is no second table to drift.
     * Stored for `spawnPlayer`, because on a fresh load the player does not
     * exist yet at this point in `_loadSteps`. */
    this._bladeEnv = bladeEnvFor(L.atmosphere);
    this.player?.saber?.setEnvironment?.(this._bladeEnv);
    /**
     * The bed AND the room, out of the one call, because they are the same fact
     * about a place. `surfaceAt(0, 0)` is the level's own centre — the ground
     * the fight is standing on — and it is the same reading `audio.step` takes
     * for a footstep, so a level whose floor is steel gets a steel room without
     * anybody writing "steel" down twice. See roomOf().
     */
    this.room = roomOf(L, this.terrain.surfaceAt(0, 0));
    audio.setAmbience({ ...(L.ambience || {}), room: this.room });

      } },

      { name: 'seeding the air and the ground cover', run: () => {
    // The motes, windborne sheets, haze and heat shimmer are particles too, so
    // they ride the particle tier and not the terrain one.
    this.atmosphere = new Atmosphere(this.scene, { ...(L.dust || {}), density: particleScale });
    if (L.water) this.water = new Water(this.scene, { ...L.water, size: this.terrain.size + 60 });
    if (L.grass) {
      // The tier scales the BLADE BUDGET (count); the level and the player's
      // slider scale `density`, which GrassField also uses to decide how much
      // cover to tint into the ground underneath. Putting the tier on `count`
      // and not on `density` is what stops Performance quietly repainting the
      // ground as bare dirt on top of thinning the grass standing on it.
      this.grass = new GrassField(this.scene, this.terrain, {
        count: Math.round(11000 * q.grass),
        density: (this.settings.grassScale ?? 1) * L.grass,
        tintA: L.grassTint?.[0], tintB: L.grassTint?.[1], radius: 46,
        /* WHAT KIND OF COVER, and the default is grass because it always was.
         * See COVER_KINDS in Scenery.js: the Drowned Wood asks for `swamp`,
         * whose cards are matted litter and root arches rather than blades,
         * because the reference for that level has no grass in it at all. */
        kind: L.grassKind,
      });
    }

      } },

      /* Up to 341 hand-placed statics on the Temple, each with its own geometry
       * and collider. The longest single stage on every level that has one. */
      { name: 'dressing the level', run: () => {
    L.dress(this);
      } },

      { name: 'forming the enemy', run: () => {

    /**
     * LESSONS INSTEAD OF WAVES — and now anywhere, not only in the dojo.
     *
     * THE MODE IS THE ONLY DOOR NOW. `DojoDirector` places everything it spawns
     * relative to the PLAYER and reads nothing at all off the level, so the
     * eleven lessons work identically on a dune face or in a blizzard, and
     * pinning them to one octagonal hall was a restriction with no cause. See
     * MODES.training in Waves.js.
     *
     * `L.training ||` used to lead this test — the dojo level's own flag. That
     * level is gone (see the note at the foot of Levels.js) and `grep -c
     * 'training:' src/game/Levels.js` returns 0, so the clause was a reader
     * with no writer: a condition that could never be true, sitting in front of
     * the one that decides. A dead disjunct reads like a supported path.
     */
    if (this.settings.mode === 'training') {
      this.director = new DojoDirector(this);
      this.training = true;
      this.running = true;
      this.over = false;
      /**
       * …AND IT EARNS, which this early return used to take away.
       *
       * Everything below — the wave-clear callback, and `_earnInsight` hanging
       * off it — is skipped by this branch, so Training was the one mode in the
       * game where the Holocron could be opened and never spent: measured
       * across all ten modes, 4 Insight a clear everywhere, 1 in Path of the
       * Blade, and 0 here. Training is the worst mode to make that exception
       * in, because it is where a player goes to find out what a power does.
       *
       * A finished LESSON is this director's cleared wave and it fires the same
       * callback (see `DojoDirector._advance`), so the one line that has to
       * survive the early return is the income. The rest of the block below is
       * a wave director's business — the score, the party heal, the draft, the
       * rung signal — and none of it belongs to a syllabus.
       */
      this.director.onWaveClear = (w, fresh = true) => { if (fresh) this._earnInsight(w); };
      return L;
    }
    this.training = false;
    /**
     * COMMAND GETS ITS OWN DIRECTOR, off the mode string and nothing else.
     *
     * `CommandDirector` IS a `WaveDirector` — it subclasses it, and every one of
     * the escalation's tuned parts (the budget curve, the body cap, the heavy
     * limit, the modifier ladder, the arrivals, the liveness watchdog) runs
     * unchanged inside it. What it adds is a second army, an AREA above the
     * wave, and a pool filtered to one side. So this branch is which class, not
     * which code path: everything below this line — the callbacks, the Insight,
     * the draft, the party heal — is identical for both, which is the property
     * that keeps Command inside the balance the rest of the game is held to.
     */
    /**
     * …AND SO DOES A SKIRMISH, THROUGH THE SAME DOOR, because a skirmish IS a
     * Command engagement with the campaign taken off it. See MODES.skirmish.
     *
     * `leadsArmy` rather than two branches: everything that follows — the
     * callbacks, the Insight, the party heal, the pool, the escalation — is
     * identical for all three of Command, a meeting and a skirmish, and a
     * second construction of the same director beside the first is the shape
     * this repository keeps deleting. What separates them is entirely in
     * `this.skirmish` below and in `beginSkirmish`.
     *
     * The director's own `mode` stays `'command'` — `CommandDirector`'s super
     * call sets it and this lane does not own that file. It is load-bearing
     * rather than cosmetic: `WaveDirector.sideFor` returns null on exactly that
     * string, because a director whose `unlockedAt` has already narrowed the
     * pool to one army must not ALSO alternate the level's two armies wave by
     * wave — its own note says half the waves would come back empty. The cost
     * is that `MODES[director.mode].name` reads "Command" on a skirmish's
     * progress line; `settings.mode` is what the record is keyed on and that is
     * right. The honest fix is in the handover.
     */
    const mode = this.settings.mode ?? 'roguelite';
    /* `MODES[mode].battles` and not a list of mode names: `skirmish` and
     * `campaign` both fight bounded battles with an army, and a third will,
     * and a roster of strings in this file is the twin defect. Command is
     * named because it is the one mode with an army that is NOT a bounded
     * battle — it is five areas and its own ending. */
    const battles = !!MODES[mode]?.battles;
    /**
     * The modes whose subject IS an army: they get the crossing too.
     *
     * `MODES[mode].crossing` and not `mode === 'command'`, which is what this
     * line said for the life of the mode. A mode-name literal here is the same
     * defect the two notes above and below it are each an account of, and it
     * came due the day THE LINE was authored: the flagship mode is a crossing
     * of one ground by definition and would have been handed a `campaign` of
     * false, which takes away the seeded length, the five stages, the muster
     * and the ending in one line. Command declares the field; so does The
     * Line; a fourth crossing lights itself.
     */
    const campaign = !!MODES[mode]?.crossing || battles;
    /**
     * …AND AN ARMY IS NO LONGER A PROPERTY OF THE MODE.
     *
     * The player: "I should be able to choose to spawn in allied troops on any
     * map in any mode if I so wish." This line was the whole reason they could
     * not — `leadsArmy` was three mode names, so the answer to "can I have
     * troops here" was decided by a menu column the player had already left,
     * and the entire roster, rank, morale and formation system was unreachable
     * from five of the eight modes and eight of the nine grounds.
     *
     * `commandConfig` reads the number, exactly as it already reads the team
     * damage, the opening formation and the meeting flag. What the director
     * then does with it is one field — see `CommandDirector.campaign`: the same
     * roster, ranks, permadeath, morale and orders, WITHOUT the five-area
     * crossing, because an endless mode already has an escalation and an ending
     * and a second one on top would end the Trial of Waves on wave 21 and call
     * it a victory.
     *
     * `training` never reaches this line — the branch above it builds a
     * `DojoDirector` and returns — which is the correct exemption and it is not
     * spelled here: nothing can kill you in a lesson, so there is nothing for a
     * line to be lost to.
     */
    const contingent = campaign ? 0 : commandConfig(this.settings, this).contingent;
    const leadsArmy = campaign || contingent > 0;
    this.director = leadsArmy
      ? new CommandDirector(this, { pool: L.pool, campaign,
          strength: contingent || OPENING_STRENGTH,
          /**
           * THE COMPANY, IF THE PLAYER HAS ONE — and it arrives on `settings`
           * rather than being read here.
           *
           * `Company.js` is a localStorage module and this file has never been
           * one: `Progress.js` keeps the same split, with `main.js` owning the
           * store and the game owning the game. So whoever built this World
           * hands `Company.fieldable(load(army), n)` to the constructor's `run`
           * bag and the director enlists what it is handed. A check hands it
           * six veterans with no browser in the room; a headless bench that
           * passes nothing gets the fresh muster it always got.
           */
          veterans: this.run.veterans || null })
      : new WaveDirector(this, { mode, pool: L.pool });
    /** The army, or null. Read by the HUD, the summary and the checks. */
    this.command = leadsArmy ? this.director : null;
    /**
     * THE THINGS ON THE FIELD YOUR MEN CAN HOLD AND YOU CANNOT — PLAN.md §4.2.
     *
     * Gated on the mode declaring `objectives`, and only where there is an army
     * to crew them: "a gun without a crew is scenery", so a mode with no named
     * men has nothing to put on a battery and installing one would be six props
     * nobody can touch. The axis is the generated front's advance bearing when
     * there is one, so the sites are laid between the two armies rather than
     * off to a side neither was going.
     *
     * `myTeam` is the player's, which is the only thing on this object that is
     * about a point of view: it decides which ring is blue and whether a notice
     * reads TAKEN or LOST.
     */
    this.objectives?.dispose?.();
    this.objectives = null;
    if (leadsArmy && MODES[mode]?.objectives) {
      this.objectives = new ObjectiveField(this, { myTeam: this.player?.team ?? 0 });
      const bearing = this.battlefield?.bearing ?? 0;
      const rng = makeRng(((this.runSeed | 0) ^ 0x0b1ec7) >>> 0);
      this.objectives.place({ count: 4, axis: bearing, rng: () => rng() });
    }
    /**
     * …AND THE BATTLE BEHIND THEM — the mass tier, armed off the same kind of
     * declared field.
     *
     * `openFront` lived in `main.js`'s deploy path for one build, which is the
     * one entry point a player uses and the only one anything else does. So a
     * headless world booted straight into the mode had `world.mass` undefined
     * and no battle at all: every check had to lay one by hand, which proves
     * the tier works and proves nothing about whether the MODE does. A co-op
     * client would have had none either.
     *
     * Here instead, beside `objectives` and `fireMissions`, because the mode
     * row's own note says that is where it belongs: a branch belongs to the
     * property it is gated on, not to the screen that happens to call it first.
     * `openFront` only ARMS the front — it does not lay it, because the player
     * spends the next half minute as a seat in a gunship — so running it at
     * load is exactly as correct as running it at deploy and reaches every
     * caller instead of one.
     */
    /* `front` is the object and `mass` is its field — `openFront` sets both and
     * the teardown has to take both, or a level change leaves a dead Front on
     * `world.front` and `openFront`'s own `if (world.front && !world.front.dead)`
     * hands the next ground the last one's battle. */
    this.front?.dispose?.();
    this.front = null;
    this.mass = null;
    if (this.netMode !== 'client' && MODES[mode]?.massBattle) openFront(this);

    /**
     * THE ORDER YOU CAN CHECK — PLAN.md §1, and it is gated the same way.
     *
     * A mode with no army has nobody to be in the ellipse and no quorum for
     * walking out to read it to cost anything, so the flag and the army are
     * both required — the same pair `objectives` above is built on.
     *
     * SEEDED OFF THE RUN, so the same sitting cuts the same orders in the same
     * order: the cadence and the pattern of shells are the run's, exactly as
     * the field of installations is, and a battlefield that reshuffles between
     * reloads is one nobody can learn from.
     */
    /**
     * THE GROUND REMEMBERS — PLAN.md §4.7, and it was one dangling wire.
     *
     * `CommandDirector.marchTo` has passed `w.craterLog` into `marchFront` for
     * as long as the front has been dressed, `src/world/CraterLog.js` is
     * written and checked to the last bit of the heightfield, and **nothing in
     * the tree has ever constructed one** — so every engagement of every run
     * opened on ground that had never been fought over, while the code that
     * would have carried it sat complete on both sides of the gap.
     *
     * A RUN FACT, exactly as `runSeed` and the skirmish plan are. The World
     * outlives `loadLevel` and the terrain does not, so the log is made once
     * and RE-ATTACHED to each new ground: what it records is a battle, and a
     * battle is longer than a heightfield. `attach` is idempotent per terrain
     * and `replay` now refuses a second pass over the same ground, which is
     * what makes it safe for `marchTo` to hand it over once per engagement.
     *
     * TRIMMED AT THE DOOR, because a log that grows without bound eventually
     * replays a lunar surface (FLAGSHIP §4, and `SESSION_MEMORY` carries the
     * arithmetic).
     *
     * Gated on leading an army for the reason CraterLog's own header gives:
     * "recording is a property of the SESSION and not of the ground — a
     * sandbox, a duel and a training ground all build a Terrain and none of
     * them has anything to remember."
     */
    if (leadsArmy && !this.frontOff) {
      this.craterLog = (this.craterLog || new CraterLog()).trim(SESSION_MEMORY).attach(this.terrain);
    } else {
      this.craterLog?.detach();
      this.craterLog = null;
    }
    /**
     * …AND THE GROUND KEEPS YOUR DEAD — PLAN.md §4.7's last item.
     *
     * The same shape as the crater log one line up and for the same reason: the
     * RECORD is the run's and the drawing is the scene's, so a marker stands on
     * the same coordinates in engagement three that it was planted on in
     * engagement one. Gated on leading an army because a grave is a NAME off a
     * roll, and a mode with no roll has no names to lose.
     */
    if (leadsArmy) {
      this.graves = (this.graves || new GraveField()).attach(this.scene, this.terrain);
    } else {
      this.graves?.detach();
      this.graves = null;
    }
    /**
     * …AND THE ANONYMOUS DEAD, WHICH ARE EVERYBODY ELSE.
     *
     * `GraveField` above is one marker per NAME and it outlives the ground it
     * was planted on. This is the opposite object on both counts, which is why
     * it is not gated the way that one is: it holds no record, nobody in it has
     * a name, and it belongs to THIS ground — a corpse from the last engagement
     * lying on the next one's dirt would be a body that never fell there. So
     * `attach` resets it, `unload` detaches it, and every mode gets one because
     * a duel and a sandbox leave bodies on the floor exactly as a battle does.
     *
     * What fills it is `Corpses.js`'s SINK step, which until now deleted the
     * body it had chosen to spend. See `FallenField`.
     *
     * NOT `roster.fallen`, which is a list of NAMES and is the thing `graves`
     * draws. Same word, opposite object: this one is the men nobody counted.
     */
    this.fallen = (this.fallen || new FallenField()).attach(this.scene, this.terrain);
    this.fireMissions?.dispose?.();
    this.fireMissions = null;
    if (leadsArmy && MODES[mode]?.fireMissions) {
      this.fireMissions = new FireMissionDirector(this, {
        myTeam: this.player?.team ?? 0,
        seed: ((this.runSeed | 0) ^ 0x1e11e) >>> 0,
      });
      /**
       * …AND IT IS WHERE THE OTHER SIDE'S BATTERY FIRES FROM.
       *
       * `Objectives._pay` has called `world.onObjectiveFire` since the day the
       * six sites landed and nothing has ever installed it, so the Battery's
       * "lost: it fires for them" row cost the player exactly nothing. The
       * shells are laid by the one thing on this world that already knows how
       * to lay shells; see `FireMissionDirector.theirBarrage`.
       */
      this.onObjectiveFire = () => this.fireMissions?.theirBarrage?.();
    } else this.onObjectiveFire = null;
    /**
     * THE BATTLE, or null — and it is CARRIED, never rebuilt.
     *
     * `rotateTo` re-enters this whole list of stages for every engagement, so a
     * plan made here would draw a fresh rotation on the ground it had just
     * rotated to and the run would never reach engagement two. A plan is a fact
     * about the RUN — its seed, its length, its army — exactly as `runSeed` is,
     * so it outlives the level the way the run does.
     *
     * Made by `beginSkirmish`, which is where the picks arrive; `update` calls
     * that on the first frame if nothing else has. This line exists only to
     * make sure a world that has stopped being a skirmish stops carrying one.
     */
    if (!battles) this.skirmish = null;
    /**
     * THE CAMPAIGN, CARRIED FOR THE SAME REASON THE BATTLE IS.
     *
     * A campaign spans several loads by definition — that is the whole of what
     * makes it one — so this line exists only to stop a world that has stopped
     * being a campaign from carrying one. It is built by `beginCampaign`, off
     * the ground the player picked; see `Levels.campaignAt`.
     */
    if (mode !== 'campaign') this.campaign = null;
    /**
     * A MEETING IS A FIGHT BETWEEN PLAYERS, SO IT IS FOUGHT UNDER A FIGHT'S
     * RULES — and this is where the mode-wide freeze retires.
     *
     * `COMMAND_POWER_RULES` is `{pvp: false, friendlyFire: true}`, frozen and
     * applied to every Command world, and it is exactly right for a campaign:
     * your powers must reach your own troops (note #29 asks for it in as many
     * words) and there is nobody else on the field to hurt. It is the wrong
     * object for two commanders, because `pvp: false` is a statement about the
     * session and versus is the session it is false about.
     *
     * `pvpRules({pvp: true})` derives `friendlyFire` from `pvp` — one boolean,
     * two consequences, no way to set them inconsistently — so a meeting gets
     * the same friendly fire the campaign has plus the thing the campaign does
     * not have, which is another player who may be hit. `duelRounds: 1` is a
     * design decision and it is stated here rather than left to a default: a
     * meeting engagement between two armies with PERMADEATH on the roster is
     * one battle. A best-of-three would need both rosters restored between
     * rounds, and a roster you get back is not a roster you can lose.
     */
    if (this.command?.versus) {
      /**
       * …AND THE ROUND COUNT AND THE CLOCK ARE NOW THE WIN CONDITION'S.
       *
       * `duelRounds: 1` was the decision above and it stays the decision for
       * two of the three conditions, for the reason the paragraph gives: a
       * roster you get back between rounds is a roster you cannot lose, and
       * permadeath is the mode. `rounds` is the one condition that asks for
       * the opposite and says so on its own card — best of three on a timer —
       * so it is the one that gets `PVP_LIMITS.rounds`' own default.
       *
       * THE CLOCK IS THE OTHER HALF AND IT WAS THE SILENT ONE. `roundTime`
       * defaults to 120 s whatever anybody asked for, so the shipped meeting
       * ended in a draw on a timer nobody had been told about — measured at
       * 124 s, `10 v 10 -> 10 v 10`, and that was the whole session. A battle
       * to the last man does not have a timer; `VERSUS_WINS[key].clock` says
       * which do, and a condition with no clock is handed the ceiling
       * `pvpLimit` will allow rather than a special case inside `DuelMatch`.
       */
      const rule = this.command.meetingPlan?.rule ?? null;
      this.rules = pvpRules({
        ...this.settings, pvp: true,
        duelRounds: rule?.clock ? undefined : 1,
        duelRoundTime: rule?.clock ? undefined : PVP_LIMITS.roundTime.max,
      });
    }
    /**
     * …AND THE SCORE, WHICH IS TOLD FACTS AND NOT A STATE.
     *
     * `setMusicState` takes `{active, boss, wave, dead, won}` and DERIVES what
     * to play, so a mode that never raises a wave — the dojo, the sandbox —
     * still gets a score out of combat intensity. Handing it `{state: 'boss'}`
     * instead latches the derivation off, which is one authority replaced by
     * two. The wave director is the authority for all three of these and it is
     * the thing raising the callback, so this is where they are known.
     *
     * `isBossWave(w)` and NOT the announcer's boss line. The audio lane tried
     * that and every wave on the Colosseum became a boss wave: the announcer
     * fires for `A.boss || A.big`, and four archetypes carry `big` at
     * `unlockAt: 1`.
     */
    this.director.onWaveStart = (w, n) => {
      this.notify(`WAVE ${w}`, `${n} contacts inbound`, 'threat');
      audio.ui('wave');
      audio.setMusicState({ wave: w, active: true, boss: !!this.director.isBossWave?.(w) });
    };
    this.director.onWaveClear = (w) => {
      this.notify('WAVE CLEAR', 'the Force is with you');
      // `audio.ui('good')` was the same 620 → 1240 Hz ping the menu plays when
      // you buy an upgrade. Holding a field is not buying an upgrade.
      audio.victory();
      audio.setMusicState({ active: false, boss: false });
    };
    /**
     * INSIGHT hangs off the same signal — composed onto it rather than written
     * inside it.
     *
     * THE REASON THIS COMMENT GIVES USED TO BE FALSE, and it is worth leaving
     * the correction in place. It said the split was forced because
     * tools/checks/run.mjs "reads the first 1600 characters after
     * `onWaveClear = `" and the callback "is within a line or two of that
     * budget" — a magic number in the harness dictating the structure of the
     * game. Two other comments in this file said the same. The check now reads
     * the callback by counting braces to its real end
     * (tools/checks/_source.mjs), so there is no budget and nothing here is
     * held to a character count.
     *
     * What stands is the ordering, which was always a real reason: FIRST, not
     * last, because `_earnInsight` mirrors the ledger into the run and the rung
     * signal inside the callback can end the level.
     */
    const cleared = this.director.onWaveClear;
    /**
     * …and a party that survived a wave gets its dead back. `_reviveDowned` is
     * a no-op solo (there is nobody left standing to revive you) and a no-op
     * when nobody is down, so this costs an `Array.some` per wave.
     *
     * Composed out here for the same reason `_earnInsight` is: the callback
     * above is the window tools/checks/run.mjs reads the rung signal out of.
     */
    /* `this.director.wave` for the LEDGER and `w` for the RUN, and they are not
     * the same number on a rung: `w` is rung-local, so a Descent earned Insight
     * as if it were sixteen first waves (18 over the climb instead of 22, and
     * one set-piece counted instead of three). `cleared(w)` must keep the local
     * one — World's own `run.wave >= rung.waves` is written against it. */
    /**
     * EVERYTHING A CLEARED WAVE PAYS, IN ONE PLACE, ONCE PER WAVE.
     *
     * The score and the party's heal used to sit INSIDE the callback above,
     * beside the announcement, and both of them are payouts rather than
     * announcements — which is what made them farmable. `restartWave` (the
     * pause card's button, present in every mode) re-composes the wave the
     * player is standing in and hands the director the SAME number back, so
     * the clear signal fires again and everything hanging off it paid again:
     * measured, ten restarts of wave 2 each fought to a real clear were worth
     * +10 drafts, +8 boons, +20,400 score and +10 Insight with the counter
     * reading 2 throughout. `WaveDirector.payWave` is the ledger; `fresh` is
     * its answer, and it gates the three payouts and the draft and nothing
     * else. The WAVE CLEAR line and the revive still happen every time,
     * because a wave that was survived was survived.
     *
     * `fresh = true` by default so a caller that predates the ledger — a check
     * driving the director by hand, a mode that fires the callback itself —
     * still pays. The two callers in the tree both pass it explicitly.
     *
     * Out here rather than inside because of a character budget that no longer
     * exists — see the correction on the note above. It stays out here because
     * moving it back would buy nothing, but nothing about this file is held to
     * a length any more.
     */
    this.director.onWaveClear = (w, fresh = true) => {
      if (fresh) {
        this._earnInsight(this.director.wave);
        this.score += 500 * w;
        for (const p of this.players) { p.addFlow(0.35); p.heal(8); }
        /**
         * …AND THE GROUND HEARS THE WAVE COUNT, which it never did.
         *
         * `groundMight` reads `director.wave`, and `setMight` had exactly three
         * callers: dressing, `applyBoon` and `applyCarry`. Dressing runs BEFORE
         * `this.director` is assigned, so the wave term is zero there; the other
         * two are a draft and a level change. So in `waves`, `duel`, `command`,
         * `sandbox` and `training` — no draft, no rotation — `might` sat at its
         * dressing value of 1.000 for the whole run. Measured at wave 21: the
         * function said 1.900 and the terrain had never been told, so the
         * retarget was true of the function and false of the game in five of
         * eight modes. Wave clear is the signal the term is made of, so it is
         * where the ground is told.
         */
        this.terrain?.setMight?.(groundMight(this));
        /* A CLEARED WAVE IS THE BIGGEST THING THAT HAPPENS TO THE SUPPLY LINE
         * short of holding ground. Behind `fresh` with the rest of the payouts,
         * so `restartWave` cannot farm it. */
        this.support?.credit('wave');
      }
      cleared(w);
      this._reviveDowned();
      /* AN ENGAGEMENT IS A CLEARED WAVE, so a skirmish counts on the ledger's
       * own signal and not on a second one. `fresh` is `payWave`'s answer —
       * the same gate the score, the Insight and the heal are behind — so
       * `restartWave` cannot advance a battle towards its victory by
       * re-clearing a wave the player has already been paid for. That is the
       * defect tools/checks/restart.mjs measured at +10 drafts and +20,400
       * score, arriving in a new mode if this were hung off the announcement
       * instead. */
      if (fresh) this._skirmishCleared();
      /* …AND THE LADDER HAS A TOP. Same signal and same gate as the engagement
       * above it: a duel is over when the wave that runs the climb out has been
       * cleared, and `fresh` is what stops a re-clear reaching it. */
      if (fresh) this._ladderCleared();
    };

    this.director.onDraft = (boons) => {
      this.onDraftOffer?.(boons);
      /**
       * …AND TELL THE PEERS, because a client's director never runs — main.js
       * only calls `director.start` when `netMode !== 'client'` — so a joining
       * player was never offered a card at all. They fought every wave the host
       * did and drafted nothing for the whole session.
       *
       * The HAND is not sent, only the moment. Each machine draws from its own
       * taken-set, which is the only set that knows what that player already
       * holds, what ranks they have left and which masteries they have earned.
       * Sending the host's three cards would offer a Vitality III to someone who
       * has never taken one.
       */
      if (this.netMode === 'host') {
        this.net?.broadcast({ t: 'draft', w: this.director.wave, boss: this.director.isBossWave(this.director.wave) });
      }
    };

    this.running = true;
    this.over = false;
      } },
    ];
    return steps;
  }

  /**
   * A tier change while a run is live.
   *
   * Pool capacity, terrain resolution and the grass instance budget are all
   * allocations made at level load and cannot move without rebuilding the
   * level, which would cost the player their run. Emission CAN move: every
   * recipe in Particles multiplies its count by `particles.scale` at the moment
   * it fires, and that is the number that actually costs frames — the pool's
   * `max` only decides how long a spark lives before its slot is recycled. So
   * dropping to Performance mid-fight thins every burst from the very next
   * impact, and the buffers follow on the next deploy.
   *
   * ── AND SO CAN THE CLOTH CUT, WHICH IS AN ALLOCATION OF NOTHING AT ALL.
   *
   * `clothCut` is a scalar an Enemy compares its camera distance against every
   * frame, and it was set once, in the level-load step, and never again — so
   * the column Engine's own QUALITY note calls "the only column in this table
   * that changes how much simulation runs EVERY frame" and "the largest thing
   * the CPU side of the ladder hands back" was the one thing a player could not
   * reach from the options screen. Driven, sixteen acolytes at 4 m to 49 m on
   * the Ember Shelf, three frames:
   *
   *   built at low                  clothCut 0    0 of 16 solving garments
   *   built at ultra → low          clothCut 46  14 of 16     ← unchanged
   *   built at ultra                clothCut 46  14 of 16
   *
   * A player whose game is stuttering drags Quality down to Performance and
   * gets the thinner bursts and none of the cloth, until they happen to change
   * level. It is set HERE now and the load step calls this rather than keeping
   * a second copy of the line (HANDOFF §2.3): a cached scalar beside the table
   * it was read from is the shape this project keeps removing.
   */
  applyQuality(name) {
    const q = QUALITY[name] || QUALITY.high;
    if (this.particles) this.particles.scale = (this.settings.particleScale ?? 1) * q.particles;
    this.clothCut = q.cloth ?? 30;
  }

  /**
   * WHERE THE PLAYER STANDS UP, AND WHY IT IS NOT (0, 0, 8).
   *
   * It was exactly that — a literal, the same on all thirteen levels, tested
   * against nothing. On The Foundry the floor at (0, 8) is −2.29 and the melt
   * sheet is at −1.45, so the game began with the player 0.84 m under a hazard
   * that deals 58 HP a second: dead at 2.40 s having pressed no key, at every
   * quality tier, and four of the five directions you might run also kill you.
   *
   * `spawnClear` — which the ENEMY spawn picker has used since the same pass
   * that added the hazard — answers both halves of it, the collider and the
   * level's own water block. Note it must be handed the TERRAIN HEIGHT: the
   * literal's y of 0 is above the melt, so even a spawnClear test at the old
   * coordinate would have passed while the body stood under the sheet. That is
   * why the deeps, also submerged, is fine — its water carries no `damage`
   * key — and why this was invisible for so long.
   *
   * The search is a widening ring rather than a random scatter so the opening
   * shot of a level stays where its author put it whenever that spot is legal,
   * which on twelve of thirteen levels it is.
   */
  /**
   * AND WHY IT IS NOT (0, 8) ON EVERY LEVEL EITHER.
   *
   * The literal above was replaced by a search and the SEARCH's centre stayed
   * a literal, the same one on all nine levels, so a level still had no way to
   * say where it opens. The Ember Shelf is what that costs: its lava sea is
   * the reason the level exists and `Hazard.js`'s own header argues "the
   * levels that have a hazard are the levels whose fights happen along its
   * edge" — measured from (0, 8), the nearest point under the sheet is 94 m
   * away, 0.0% of the r ≤ 60 m fight disc is under it, and 0 of 360 bearings
   * have an unobstructed eye line to it. The sea cannot be seen from where the
   * game stands you up, on any bearing. Mustafar's is 40 m out and 3.0% of its
   * disc; the Drowned Wood's is 12 m and 20.9%.
   *
   * `start: [x, z]` is the level's answer, defaulting to the same (0, 8) every
   * level used to get, so eight of the nine are unchanged to the metre. It is
   * a POSITION and not a spawn, because everything below still applies to it:
   * the collider test, the level's own water block, and the widening ring if
   * the authored spot is illegal.
   */
  _playerSpawn() {
    const t = this.terrain;
    const h = (x, z) => (t ? t.height(x, z) : 0);
    const s = this.level && Array.isArray(this.level.start) ? this.level.start : [0, 8];
    const home = new THREE.Vector3(s[0], h(s[0], s[1]), s[1]);
    if (spawnClear(this, home.x, home.y, home.z)) return home;
    for (let r = 4; r <= 44; r += 4) {
      for (let i = 0; i < 16; i++) {
        const a = (i / 16) * Math.PI * 2 + r * 0.37;
        const x = home.x + Math.cos(a) * r, z = home.z + Math.sin(a) * r;
        if (t && !t.inBounds(x, z, 3)) continue;
        if (t?.slopeAt && t.slopeAt(x, z) > 0.5) continue;
        const y = h(x, z);
        if (spawnClear(this, x, y, z)) return new THREE.Vector3(x, y, z);
      }
    }
    // Nothing legal anywhere: the level is the problem, and standing the player
    // in the authored spot is a better failure than standing them in the void.
    return home;
  }

  spawnPlayer(opts = {}) {
    const p = new Player(this, {
      ...opts,
      colorIndex: this.settings.colorIndex,
      bladeLength: this.settings.bladeLength,
      coreWidth: this.settings.coreWidth,
      hiltStyle: this.settings.hiltStyle,
      robeIndex: this.settings.robeIndex,
      skinIndex: this.settings.skinIndex,
      hairIndex: this.settings.hairIndex,
      build: this.settings.build,
      robeCut: this.settings.robeCut,
      species: this.settings.species,
      face: this.settings.face,
      order: this.settings.order,
      sensitivity: this.settings.sensitivity,
      followStrength: this.settings.camFollow,
      scheme: this.settings.scheme,
      spawn: opts.spawn || this._playerSpawn(),
      /* WHICH SIDE, and it has to travel with the body. Without it every
       * player is built on side 0 — so a duel's two fighters are allies, their
       * blades pass through each other and a point-blank shove moves the rival
       * at 0.000 m/s. `undefined` here means "the default side", which is
       * co-op's, so nothing that does not ask for a side changes. */
      team: opts.team,
    });

    // THE ORDER, before any boon. It writes the same `boonMods` a boon card
    // writes, through the same shape, so a card that multiplies cutPower still
    // multiplies whatever the order set — applying it afterwards would have the
    // order overwrite the run instead of starting it.
    /* A duel's health setting, applied before the order's own modifiers so a
     * card that scales max hp scales the duel's number rather than the
     * campaign's. `rules.pvp` is false for every world that is not a duel. */
    if (this.rules?.pvp && this.rules.health > 0) { p.maxHp = this.rules.health; p.hp = p.maxHp; }
    const rec = applyOrder(p, this.settings.order);
    if (rec) for (const id of rec.grants) this.takenBoons.add(id);

    /**
     * AND THEN THE HOLOCRON, if the player has asked for it to be open.
     *
     * `settings.holocron` has three values and the default, 'earned', does
     * nothing here — Insight is a run currency, you kneel to spend it, and
     * that is the game. The other two exist because of a real report: "I can't
     * actually test out anything… I haven't even been able to force lightning
     * or force compel yet." Both are gated on `boonMods.lightning` /
     * `boonMods.compel`, which arrive only as a boon, which arrives only from
     * a draft or a facet bought at roughly 1.4 Insight a wave. A player can
     * finish a run without ever meeting half the kit.
     *
     *   'open'  a full purse. Everything is REACHABLE and the shape of the
     *           choice survives — you still kneel, you still pick, prices
     *           still escalate.
     *   'all'   every facet already woken. No choice at all: the workshop
     *           setting, for looking at a power rather than earning it.
     *
     * Applied through `applyBoon`-equivalent paths rather than by poking
     * `boonMods`, so a facet cannot behave differently when it is granted than
     * when it is bought — which is the whole reason the facet table carries an
     * id into BOONS instead of carrying an effect of its own.
     */
    if (this.settings.holocron === 'open') {
      /* THE PURSE, AND THE GATE BEHIND IT. `HOLOCRON_PURSE` is what the number
       * on the screen reads; `open` is what makes the promise true — see the
       * note on `Communion.open` for the nineteen facets an infinite purse
       * still could not reach at wave 1. */
      this.communion.insight = Math.max(this.communion.insight, HOLOCRON_PURSE);
      this.communion.open = true;
    } else if (this.settings.holocron === 'all') {
      for (const facet of FACETS) {
        const boon = boonById(facet.id);
        if (!boon) continue;
        this.takenBoons.take?.(boon.id) ?? this.takenBoons.add(boon.id);
        if (typeof p.applyBoon === 'function') p.applyBoon(boon);
      }
    }

    /**
     * AND THEN THE RUN, which is what makes a landing a transition rather than
     * a restart. Order first, boons second: the order STARTS the numbers and a
     * boon multiplies them, so the reverse order would have the order overwrite
     * everything the run had earned.
     *
     * The boons are re-applied rather than a snapshot of `boonMods` restored,
     * because a snapshot would drift the first time a boon's effect changed.
     */
    /**
     * THE OTHER END OF EVERY COMMUNION, installed whether or not this player
     * holds a single bond card.
     *
     * A buff that lands on your ally has to be received by them, and the
     * receiver cannot be installed by the card — the card is on the GIVER's
     * player, on the giver's machine. So the seam lives here, on every local
     * player at spawn, exactly as `boltCatch` does: `_bondIn` is written by
     * somebody else's aura (locally by Waves.bondAura, across the wire by
     * applyBond below) and read every frame by these two.
     *
     * This is the difference between a co-op buff and a co-op buff that works:
     * without it, "your ally cuts harder" would have been true only if your
     * ally had happened to draft the same card you did.
     */
    boonTick(p, 'bond-in', bondReceive);
    boonGuard(p, 'bond-in', bondGuardIn);
    p.camera.firstPerson = !!this.settings.firstPerson;
    p._applyViewMode();
    // Catch-and-throw state lives out here rather than on the Player, because
    // it is a property of the fight (bolts, blades, the camera) rather than of
    // the body, and World is what owns all three.
    p.boltCatch = new CatchWindow();
    // "Blade holds position": leave the blade where the last flick left it
    // instead of easing back to the ready guard. Off unless asked for.
    p.control.holdPosition = !!this.settings.bladeHold;
    /* The air this blade is being swung in — see `bladeEnvFor`. `_loadSteps`
     * computes it before any player exists, so every player picks it up here
     * rather than the load path reaching forward for one that is not there. */
    if (this._bladeEnv) p.saber?.setEnvironment?.(this._bladeEnv);
    this.players.push(p);
    if (!this.player) {
      this.player = p;
      /* …AND THE SIDE THIS MACHINE IS PLAYING ON. See `partyTeam` in the
       * constructor: `blocksWaveEnd` and the HUD's hostile count both mean
       * "not mine", and on a machine whose player is on side 2 the constant
       * had them counting their own army as the enemy. `asTeam` because it
       * comes off a settings blob or the wire. */
      this.partyTeam = asTeam(p.team);
      /* The commander this machine is playing is that player. `CommandDirector`
       * is built during `loadLevel`, before any player exists, so its first
       * commander is created with no body to lead. */
      const c = this.command?.commander;
      if (c && !c.player) { c.player = p; c.side = this.partyTeam; }
    }
    p.saber.ignite();
    p.hum.ignite();
    return p;
  }

  unload() {
    /* THE PRESET TABLE IS PROCESS-GLOBAL and a generated ground is a row this
     * world put in it, so leaving it there outlives the world that made it. It
     * is not merely untidy: `installGround` refuses to shadow an existing key,
     * so the SECOND world to generate a front on the same base gets a refusal
     * and silently falls back to the authored ground. Measured before this
     * line — seed 1 generated, seeds 2 and 3 both came back "already a ground"
     * and stood on stock geonosis. See `_groundKeyFor`, which takes the same
     * precaution from the other end for a world that never unloaded. */
    this._dropGeneratedGround();
    /**
     * AND THE SHIP GOES, UNLESS IT IS THE ONE CARRYING US.
     *
     * The extraction's group is parented to `scene` rather than to `statics` so
     * that this method CANNOT take it — which is correct while a transport is
     * flying the party from one ground to the next, and wrong every other time
     * a level changes. Everything else took the exemption too: an insertion
     * interrupted by a rotate, a run left mid-flight, a mode change under a
     * descent. Measured across one ground change: 44 meshes — hull, capital
     * ship, both pilots, both doors, the ramp — left in the scene with no
     * physics and no owner, and drawn on top of every level loaded after it.
     * That is the superimposed geometry, and it is not the level's at all.
     *
     * `carryingBetweenGrounds` is the one case the exemption was written for.
     */
    if (!this.extraction?.carryingBetweenGrounds) this.extraction?.clear();
    // The level's wind and drone are level state; without this they kept
    // playing under the main menu after quitting.
    audio.setAmbience?.({ wind: 0, drone: 0 });
    /* …AND EVERY HELD VOICE. A jetpack is a loop keyed on a body id (see
     * `Audio.jet`), and a body disposed while its engines are running has no
     * way left to release it — twelve jet troopers across three level loads
     * is thirty-six roars nobody can stop. */
    audio.stopLoops?.();
    /* …and so is everything a death left on the screen and on the clock. A
     * player who quits from the death card and deploys again used to arrive on
     * the next level grey, letterboxed and at a third speed, because the three
     * states die() sets are held until something lets go of them and only
     * `respawn` ever did. */
    this.engine?.setDrain?.(0);
    this.engine?.setBars?.(0);
    this._killTime = null;
    this.setTimeScale(1);
    this.timeScale = 1;
    for (const e of this.enemies) e.dispose();
    this.enemies.length = 0;
    /* The installations go with the level. They are scene-graph groups with
     * geometry on them, and the field is rebuilt by the next `loadLevel` —
     * leaving them would be six masts standing on the next ground. */
    this.objectives?.dispose?.();
    this.objectives = null;
    /* The standing order goes with the ground it was laid on, and so does the
     * ring drawn for it. */
    this.fireMissions?.dispose?.();
    this.fireMissions = null;
    /* The markers come out of the scene and the names stay on the record —
     * `detach`, never `dispose`. See GraveField. */
    this.graves?.detach();
    /* The retired dead have no record to keep: they fell on THIS ground and the
     * instances were the whole of them. See FallenField. */
    this.fallen?.detach();
    /* The corpse ledger holds references to bodies that have just been
     * disposed. `clear()` and not `dispose()`: the ledger itself outlives the
     * level exactly as the World does, and what must not survive is its
     * pointers into a scene graph that no longer exists. */
    this.corpses?.clear();
    this.locks.length = 0;
    // …and the client's id→enemy map, which holds a whole Enemy graph per
    // entry. Clearing the list it points into is not the same as clearing it.
    this._netEnemyIndex?.clear();
    /**
     * …AND THE PEERS, which is the OTHER half of the same registration.
     *
     * This method disposes every RemoteAvatar — they live in `players` — and
     * empties that list, and left `remotes` pointing at every one of them.
     * `main.js`'s `avatar` handler builds a peer only when `remotes.get(id)` is
     * ABSENT, so it never built a replacement: measured across one ground
     * change, `remotes` still maps the peer to the avatar `unload` had just
     * disposed, that avatar is no longer in `players`, and the handler declines
     * to make a new one. Every packet from that peer is then applied to a body
     * with no mesh that nothing targets and no blade can test, and `netSource`
     * still hands it back as a damage source — for the rest of the session,
     * from the first cleared skirmish or campaign mission onward.
     */
    this.remotes?.clear();
    for (const p of this.props.slice()) p.destroy();
    this.props.length = 0;
    for (const d of this.doors) d.dispose();
    this.doors.length = 0;
    for (const d of this.debris) { this.scene.remove(d.mesh); d.mesh.geometry?.dispose?.(); }
    this.debris.length = 0;
    for (const m of this.statics) { this.scene.remove(m); m.geometry?.dispose?.(); }
    this.statics.length = 0;
    for (const l of this.levelLights) this.scene.remove(l);
    this.levelLights.length = 0;
    for (const p of this.players) p.dispose();
    this.players.length = 0;
    this.player = null;
    this.bolts?.dispose();
    this.particles?.dispose();
    this.lightning?.dispose();
    this.grenades?.dispose();
    this.cohorts?.dispose();
    this.lightning = null;
    this.grass?.dispose(); this.grass = null;
    this.water?.dispose(); this.water = null;
    this.atmosphere?.dispose(); this.atmosphere = null;
    /* THE RECORDER COMES OFF THE GROUND BEFORE THE GROUND GOES, and the log
     * itself survives: it is the run's memory of the battle, and the next
     * `loadLevel` re-attaches it to the ground it replays onto. Detaching is
     * what stops the wrapper holding a disposed terrain alive. */
    this.craterLog?.detach();
    this.terrain?.dispose(); this.terrain = null;
    this.physics.clear();
    this.physics.terrain = null;
    this.bladeSolver.reset();
    // The dressing pass's own bookkeeping. `beginDressing` resets it at the
    // start of every level, so it never grew without bound — but it is the
    // departed level's state and it was still standing (64 entries on the
    // arena) after a quit to the menu, for as long as the World was held.
    this._siteTaken = null;
    this._stoneField = null;
    /**
     * …AND THE STATE THAT IS NOT A THING BUT IS STILL THE DEPARTED LEVEL'S.
     *
     * Everything above frees an object. These are FIELDS, and every one of them
     * was found by diffing what the constructor sets against what this method
     * mentions. Harmless while a level change only ever happened between two
     * fresh Worlds; each one is a real fault the moment a run rotates ground
     * mid-fight, which is what `rotateTo` now does:
     *
     *   `focus`      `held`, `passive` and `active` are a blend, not an event.
     *                Rotating while the player is holding Focus opened the next
     *                ground at heldScale — the world in slow motion, with the
     *                drain still billing — until they pressed and released the
     *                key. `reset()` is the FocusSystem's own door and `update`
     *                already calls it every frame there is no live local player.
     *   `hitstop` and `targetTimeScale`  the line below sets `timeScale`, which
     *                is the OUTPUT; these two are the inputs it is damped
     *                towards, so a rotation during a 120 ms freeze carried the
     *                freeze and a rotation during kill-time carried the target.
     *   `paused`     a fresh field is not a paused one, and `update` returns on
     *                this before it reaches anything.
     *   `_targets` / `_capsCache` / `_foes`  retained scratch arrays, each
     *                emptied at the top of its own use. Between an `unload` and
     *                the next frame of the next level they hold up to forty
     *                `{enemy, capsules}` records pointing at disposed bodies —
     *                a whole Enemy graph apiece, held across the most expensive
     *                second in the game.
     *   `match` / `_matchSent` / `_aloneAt`  a DuelMatch is the state of ONE
     *                battle on ONE field. `beginVersus` refuses to build a
     *                second while one exists, so a finished match surviving a
     *                ground change is a new battle scored by the old one's
     *                clock.
     *   `_bossFrame` the timer that releases the letterbox. `setBars(0)` above
     *                puts the bars away; a non-zero timer left behind also
     *                suppresses the NEXT boss's entrance, because `spawnEnemy`
     *                frames one only when this is falsy.
     *   `_frameCtx`  the frame context, kept as a field so `grenades.update`
     *                can reach it later in the same frame. It is the departed
     *                level in one object: measured after an `unload`, it still
     *                held the disposed Terrain (`world.terrain` is null and
     *                `world._frameCtx.terrain` is not), the physics world, the
     *                particle system, the bolt pool and the camera. Every one
     *                of those is exactly what the list above exists to catch,
     *                and this one arrives with a whole heightfield attached.
     *
     * `rotating` is deliberately NOT in this list: `loadLevelAsync` yields
     * between stages and that flag is what stops `update` stepping a half-built
     * world in the frames between them. Clearing it here would defeat it.
     */
    this.focus?.reset?.();
    this.hitstop = 0;
    this.targetTimeScale = 1;
    this.paused = false;
    this.combatIntensity = 0;
    this._bossFrame = 0;
    this._targets.length = 0;
    this._capsCache.length = 0;
    if (this._foes) this._foes.length = 0;
    this.match = null;
    this._matchSent = '';
    this._aloneAt = false;
    this._frameCtx = null;
    this.running = false;
    this.over = false;
  }

  /* ── a run that outlives the ground it is fought on ───────────────── */

  /**
   * EVERYTHING ABOUT THIS RUN THAT IS NOT THE LEVEL.
   *
   * `unload()` is thorough and this is not a complaint about it: it disposes
   * every player, and a Player is where `boonMods`, `maxHp`, the blade, the
   * per-player tally and the whole of a build live. `_loadSteps` then rebuilds
   * `takenBoons` and `communion` from nothing, and it is RIGHT to — its own
   * note explains that appending to a carried set would have counted a rank-2
   * Vitality as rank 8. So a level change is a clean world by construction, and
   * the run has to be handed back to it by something.
   *
   * NOTHING WAS DOING THAT. `loadLevel`'s doc block promised `opts.run` and no
   * stage read it; `spawnPlayer` still carries a paragraph headed "AND THEN THE
   * RUN — which is what makes a landing a transition rather than a restart",
   * with no statement whatsoever under it. Measured on a real World, roguelite
   * on the Colosseum, four ranks of three cards drafted (Vaapad twice) and two
   * Insight earned, then a plain `loadLevel` into the next ground and a
   * respawn:
   *
   *     ranks held      4 → 0        Insight        2 → 0
   *     distinct cards  3 → 0        facets bought  1 → 0
   *     Vaapad rank     2 → 0        deflectDamage  1.800 → 1.000
   *     kills           9 → 0        director wave  6 → 0
   *
   * `world.score` is the one thing that already survived, because it is on the
   * World and nothing resets it. Everything else is on the Player or is rebuilt
   * by `_loadSteps`. The map-rotation feature dies here if this is not fixed
   * first, and it dies SILENTLY — nothing throws, no console line, the player
   * simply arrives on the next ground as a fresh character with the same score.
   *
   * `boons` is `RankSet.flat()` and not `[...takenBoons]`: a RankSet is a Set,
   * so its iterator yields a rank-3 card once. See that method.
   *
   * The Insight ledger crosses as the three fields `Communion`'s constructor
   * takes, because `bought.length` is the price escalator — a carry that kept
   * the purse and forgot the receipts would re-price every facet at
   * first-purchase rates.
   */
  runCarry() {
    const p = this.player;
    return {
      boons: this.takenBoons.flat(),
      communion: {
        insight: this.communion?.insight ?? 0,
        bought: [...(this.communion?.bought ?? [])],
        earned: this.communion?.earned ?? 0,
        /* AND THE SEED, because the Holocron's offer is derived from it and
         * from the purchase count — a carry that dropped it would deal the
         * player a different three on the far side of every ground change,
         * which is the one thing an offer must not do. See LivingForce.OFFER. */
        seed: this.communion?.seed ?? 0,
      },
      score: this.score,
      wave: this.director?.wave ?? 0,
      /* WHO THE PLAYER IS, because `spawnPlayer` takes the name as an argument
       * and the World never stored it — a rotation without this line respawns
       * the local player as whatever the caller's default is, and in co-op that
       * is a different name on the roster every ground. */
      name: this.player?.name ?? null,
      /* The tally the death card and `runStats` print. It lives on the Player
       * and the Player does not survive `unload`, so a rotation without this
       * reports the last engagement's kills as the battle's. */
      tally: p ? {
        kills: p.kills | 0, deflects: p.deflects | 0, perfects: p.perfects | 0,
        limbsRemoved: p.limbsRemoved | 0, score: p.score | 0,
      } : null,
      /**
       * …AND THE STATE YOU ARE IN, WHICH IS A DECISION AND NOT AN OVERSIGHT.
       *
       * A respawned Player is at full health, full Force and full stamina.
       * Leaving it there would make a ground change the cheapest heal in the
       * game — free, repeatable, and worth more the longer the battle runs —
       * and this method is the door every mode's rotation will go through, so
       * whatever it does becomes the rule. A transition is not a rest.
       *
       * Carried as a FRACTION rather than as points, because `maxHp`, `maxForce`
       * and `maxStamina` are all re-derived from the order and the boons on the
       * far side and a raw number would either overflow the new maximum or
       * quietly shrink against it. A mode that wants to heal between rounds
       * heals — `CommandDirector` already pays 8 hp at every wave clear — and
       * it does so where that decision is legible.
       */
      vitals: p ? {
        hp: p.maxHp ? clamp(p.hp / p.maxHp, 0, 1) : 1,
        force: p.maxForce ? clamp(p.force / p.maxForce, 0, 1) : 1,
        stamina: p.maxStamina ? clamp(p.stamina / p.maxStamina, 0, 1) : 1,
      } : null,
    };
  }

  /**
   * …AND BACK ONTO THE WORLD THAT CAME OUT OF THE REBUILD.
   *
   * Order matters and it is the same order `spawnPlayer` states for the order
   * and the boons: the ORDER starts the numbers, a boon multiplies them, so the
   * boons go on a player that has already had `applyOrder` run over it — which
   * it has, because `spawnPlayer` did that before this is called.
   *
   * Applied through `Player.applyBoon` and NOT through `World.applyBoon`, and
   * the difference is not style: `World.applyBoon` notifies, repaints the
   * ground's might and calls `director.resumeAfterDraft()`, which sets a four
   * second intermission. Replaying an eight-card build through it would put
   * eight banners on the screen and hand the next engagement a 4 s delay for
   * each. The two things it does that a restore DOES want — the taken-set and
   * the ground's might — are done here once.
   */
  applyCarry(carry) {
    if (!carry) return null;
    this.communion = new Communion({ seed: this.runSeed | 0, ...(carry.communion || {}) });
    this.score = carry.score || 0;
    for (const id of carry.boons || []) {
      const boon = boonById(id);
      if (!boon) continue;
      this.takenBoons.take(id);
      for (const p of this.players) if (typeof p.applyBoon === 'function') p.applyBoon(boon);
    }
    const t = carry.tally, p = this.player;
    if (t && p) {
      p.kills = t.kills; p.deflects = t.deflects; p.perfects = t.perfects;
      p.limbsRemoved = t.limbsRemoved; p.score = t.score;
    }
    const v = carry.vitals;
    if (v && p) {
      /* A floor of one point rather than zero: a fraction of 0 is a body that
       * was already dead when the ground changed, and arriving on the next one
       * dead is a run that ends to a level load. `_checkWipe` is the only thing
       * allowed to end a run. */
      p.hp = Math.max(1, Math.round(p.maxHp * v.hp));
      p.force = p.maxForce * v.force;
      p.stamina = p.maxStamina * v.stamina;
    }
    // Once, after the build is back on, for the reason World.applyBoon does it
    // per card: `might` is otherwise fixed at dressing time.
    this.terrain?.setMight?.(groundMight(this));
    return carry;
  }

  /**
   * THE GROUND CHANGES AND THE RUN DOES NOT — player note #48.
   *
   * One method rather than a sequence every caller repeats, because the
   * sequence is the whole feature and every step of it is load-bearing:
   *
   *   the army comes OFF the field first, through `recall`, so the records
   *     survive the bodies. Its own note explains why detaching before
   *     disposing matters — `onDeath` reads `e.trooper` to decide whether a
   *     death is a casualty, and twelve troopers disposed by `unload` would
   *     otherwise be twelve casualties on the roster at every ground change.
   *   the run is snapshotted BEFORE the load, because the load disposes the
   *     player it has to be read off;
   *   the load is the ordinary one, unchanged, with no carry parameter — see
   *     the note on `loadLevel`;
   *   the player is respawned and the run put back;
   *   `onRotate` lets a front end re-apply the handful of per-player view
   *     settings it owns (fov, the HUD's level name) exactly as it does after
   *     the first `spawnPlayer`. It is optional: a headless caller and a check
   *     get a complete, playable world without one.
   *
   * `rotating` is what stops `update` stepping a half-built world. It matters
   * for the async door below, where several frames pass between the two halves.
   *
   * @returns the level that was actually loaded.
   */
  rotateTo(key) {
    const carry = this._beforeRotate();
    /* THE SAME GUARD `rotateToAsync` CARRIES, and for a worse reason. `rotating`
     * gates `update`, and `unload` deliberately does not clear it (see the note
     * there) — so a build that throws in here stops the world for the rest of
     * the session: the tab paints, the input works, and nothing steps, ever.
     * Measured against the async door, which has the catch: sync leaves
     * `rotating` true and the clock advances 0.000 s over 120 frames; async
     * recovers and advances 2.000 s. This is the door `update` takes itself
     * whenever a front end does not answer `onRotate`. */
    try { this.loadLevel(key); }
    catch (e) { this.rotating = false; throw e; }
    return this._afterRotate(carry);
  }

  /** The same, yielding between stages, for a front end that draws a bar. */
  async rotateToAsync(key, onProgress = null) {
    const carry = this._beforeRotate();
    try {
      await this.loadLevelAsync(key, {}, onProgress);
    } catch (e) { this.rotating = false; throw e; }
    return this._afterRotate(carry);
  }

  _beforeRotate() {
    this.rotating = true;
    /* Names, ranks and casualty lists belong to the CAMPAIGN, which is the mode
     * whose whole subject is a body you recognise. A skirmish raises a line for
     * the battle and raises a fresh one on the next ground — see
     * `_musterSkirmish`. The recall is still the right call: it is how bodies
     * leave the field without being counted as casualties, and `unload` is
     * about to dispose every one of them. */
    this.command?.recall?.();
    return this.runCarry();
  }

  _afterRotate(carry) {
    const p = this.spawnPlayer({ name: carry?.name || this.settings.playerName || 'Jedi', isLocal: true });
    this.applyCarry(carry);
    /* THE MISSION'S TERMS BEFORE THE WAVE'S BUDGET. `beginMission` writes the
     * pressure onto `areaIndex` and raises the line, and `budgetFor` reads both
     * — so composing first would field the outgoing mission's wave on the
     * incoming mission's ground. It starts the director itself, which is why
     * the line below asks whether one is running rather than assuming not. */
    if (this.campaign && !this.skirmish) this.beginMission((carry?.wave || 0) + 1);
    else if (this.skirmish) this._musterSkirmish();
    /* THE ESCALATION CONTINUES. `start(1)` on a new ground would hand the
     * player wave 1's budget again on every engagement, which is the sawtooth
     * `WaveDirector.floor` was written for and which cost the Descent its whole
     * difficulty curve: 7,11,15 · 7,11,15,21 · 7,11,15,21 was a ladder that
     * DROPS 53% at the exact moment the fiction says you went further. */
    if (!this.training && this.netMode !== 'client' && !this.director.active) {
      this.director.start((carry?.wave || 0) + 1);
      this._skirmishBanner();
    }
    this.rotating = false;
    /**
     * …AND EVERYONE ELSE IN THE SESSION IS TOLD, which nothing did.
     *
     * A ground change is host-only by construction — `_groundPending` is set by
     * `_advanceMission` and `_skirmishCleared`, and a client's director never
     * runs — so a client never rotated. Both machines stayed up and neither
     * said anything: the host rebuilt on the next mission's ground and went on
     * broadcasting snapshots in its own absolute coordinates, and the client
     * kept applying them to the OLD terrain. That is the same failure the
     * `start` handler in main.js was written for, described there in full: the
     * bodies all arrive, some buried in the client's hills and some hanging in
     * its air, and the level's hazards exist on one machine only.
     *
     * `start` IS the message for this — "the session is now on this ground",
     * carrying level, difficulty and mode, and a client that gets it tears its
     * world down and lands in the new one. It was sent once, at deploy, and
     * never again. Sending it from here rather than from the two callers is the
     * same choice `onGround` makes one line down: both doors, sync and async,
     * come through `_afterRotate`, so a rotation that forgot to announce itself
     * is not a shape this can take.
     *
     * `this.levelKey` and not the key that was asked for, for the reason
     * main.js gives at its own `start`: a host whose key missed and fell back
     * would otherwise send the key that missed and let every client fall back
     * independently.
     */
    if (this.netMode === 'host' && this.net?.connected) {
      /* …AND THE SEED WITH IT. A rotation is a new ground and the client
       * rebuilds from this message; without the number that generated the
       * host's ground it builds a different one. See Net.SESSION_KEYS. */
      this.net.broadcast({ t: 'start', ...sessionPart(this.settings), level: this.levelKey, seed: this.runSeed });
    }
    /* WE HAVE ARRIVED — a separate signal from `onRotate`, which is the
     * request. The handful of things a front end owns per player (the camera's
     * fov, the HUD's level name and difficulty, the boon strip) are re-applied
     * here exactly as they are after the first `spawnPlayer` in main.js. */
    this.onGround?.(this.levelKey, this.level, p);
    return this.level;
  }

  /* ── skirmish ─────────────────────────────────────────────────────── */

  /**
   * THE BATTLE, AS A PLAN — decided once, from the run's number.
   *
   * `skirmishConfig` normalises what Waves.js can see; the two clamps that need
   * Command's own tables are here, because this is the file that can see them
   * and because a copy of `MAX_STRENGTH` over there would be the twin defect.
   *
   *   PRESSURE is an index into `AREAS`, Command's own tuned ladder — a budget
   *     multiplier, a heavy bias and a reinforcement purse per rung, five rungs
   *     from the landing zone to the core ship. A skirmish picks a rung and
   *     stays on it; the campaign is the mode that walks up them. Inventing a
   *     second difficulty ladder beside a tuned one is the defect §2.3 is about.
   *   STRENGTH is the size of your line. Floored at `OPENING_STRENGTH`, which
   *     is the number the muster is built around and what every Command
   *     campaign opens with, and ceilinged at `MAX_STRENGTH`, which is
   *     `recruit`'s own refusal. 0 means "whatever the campaign opens with", so
   *     a player who never touches the control gets Command's line.
   *
   * THE ROTATION IS DRAWN HERE AND NOWHERE ELSE, which is what makes a battle
   * reproducible: the same seed lays out the same grounds in the same order
   * before the first shot. `first: this.levelKey` and not `settings.level` —
   * `loadLevel` is allowed to substitute for a key it does not know, and the
   * ground the rotation opens on has to be the ground the player is standing
   * on rather than the one they asked for. That distinction is exactly the trap
   * `levelKey`'s own note in `_loadSteps` records.
   */
  _planSkirmish(picks) {
    const cfg = skirmishConfig(picks);
    const pressure = Math.min(cfg.pressure, AREAS.length - 1);
    const strength = clamp(cfg.strength || OPENING_STRENGTH, OPENING_STRENGTH, MAX_STRENGTH);
    const seed = Number.isFinite(this.runSeed) ? this.runSeed : 0;
    return {
      engagements: cfg.engagements,
      pressure,
      strength,
      rotate: cfg.rotate,
      /* HOW MANY CLEARED WAVES MAKE ONE ENGAGEMENT, and the counter under it.
       * See `SKIRMISH.waves`: this was structurally 1, so a skirmish announced
       * the ground was held after the wave that composes a single body. */
      waves: cfg.waves,
      waveCount: 0,
      /* One entry per engagement, so `[cleared]` is where you are going next
       * and index 0 is where you started. Length `engagements` even when the
       * rotation is off, so the readout can name the ground of every round. */
      rotation: cfg.rotate
        ? levelRotation(seed, { length: cfg.engagements, first: this.levelKey })
        : new Array(cfg.engagements).fill(this.levelKey),
      seed,
      cleared: 0,
      /** Raised by `beginSkirmish`, once. */
      started: false,
      done: false,
      /** true, false or null while it is still being fought. */
      won: null,
      log: [],
    };
  }

  /**
   * THE BATTLE OPENS — the one call a front end makes, in place of `start(1)`.
   *
   * A meeting has `beginVersus` for the same reason: a mode whose opening is
   * more than "compose wave one" cannot be started by the line that composes
   * wave one, and main.js already branches on exactly that. This is the other
   * arm of that branch.
   *
   * Three statements and every one of them is a call into machinery that
   * already exists:
   *
   *   the PRESSURE is written onto `areaIndex`, so `budgetFor`, `heavyBias`
   *     and the muster shelf's `at <= areaNumber` gate all move together —
   *     they already read it, and reading it is all this mode does to them.
   *   the LINE is raised by `_musterSkirmish` through the muster's own prices.
   *   the WAVE is the ordinary `start`, so the composer, the CONDITIONS, the
   *     arrivals and the escalation are untouched. A skirmish is the standard
   *     wave with an army beside the player and a stopping rule after it.
   *
   * IDEMPOTENT, and `update` calls it on the first frame if nothing else has —
   * which is what makes the front-end wiring genuinely optional rather than
   * nominally optional. The mode card builds itself out of `MODES`, the plan
   * defaults itself out of `skirmishConfig`, and a player who reaches Skirmish
   * through a menu nobody has taught about it gets a real battle at the first
   * pressure with the campaign's opening line. `CommandDirector._areaClear`
   * takes the same position about its muster screen and says why: a mode that
   * cannot be played without a UI that does not exist yet is a mode that does
   * not exist.
   *
   * `deploy()` rather than `start()` on the second door: main.js says
   * `director.start(1)` for every mode and may well have already run, in which
   * case the wave is composed and the bodies this call just enlisted have no
   * body yet. `deploy` builds one for every record that has none and skips the
   * rest, so the two orderings converge.
   */
  beginSkirmish(picks = null, wave = null) {
    const d = this.command;
    if (!d || !MODES[this.settings?.mode]?.battles) return null;
    /**
     * …AND NOT UNDER A MEETING, which is the one battle this must not open.
     *
     * `MODES.versus` declares `battles` — it is a bounded battle with an army,
     * which is exactly what the field is for, and it is what gets the mode a
     * CommandDirector instead of a bare wave director. That declaration also
     * arms `update`'s "the battle opens itself if nobody opened it", which is
     * the line that makes a mode playable through a front end that knows
     * nothing about it — and under a meeting it would compose a wave against a
     * commander's strength and drop a THIRD force onto a field with two armies
     * already on it. `beginVersus` is the opening this mode has; `start`'s own
     * note has the same refusal for the same reason.
     *
     * Refused here rather than in the caller because there are two callers —
     * main.js's deploy branch and the self-opening line — and a guard in one of
     * them is a guard the other does not have.
     */
    if (d.versus) return null;
    const sk = (this.skirmish ||= this._planSkirmish(picks));
    if (sk.started || sk.done) return sk;
    sk.started = true;
    d.areaIndex = sk.pressure;
    d.areaWaves = 0;
    sk.waveCount = 0;
    this._musterSkirmish();
    /* …AND THE ESCALATION OPENS WHERE THE PRESSURE SAYS. `pressure` already
     * moved the budget curve's `areaIndex` and the muster shelf and left the
     * wave NUMBER at 1, so the heaviest skirmish still opened on the one-body
     * wave. See `SKIRMISH.pressureWaves`. */
    const opening = Math.max(this.director.wave + 1,
      1 + sk.pressure * SKIRMISH.pressureWaves);
    if (!d.active) d.start(wave ?? opening);
    else d.deploy();
    this._skirmishBanner();
    return sk;
  }

  /* ── campaign ──────────────────────────────────────────────────────── */

  /**
   * A NAMED SEQUENCE OF BATTLES — player notes #21 and #47.
   *
   * The runner is thirty lines because the machinery is already here: a
   * mission IS a skirmish with its picks authored instead of drawn, a mission
   * boundary IS `rotateTo`, and the run that survives it is `runCarry`. What a
   * campaign adds over a rotation is an ORDER somebody chose, a BRIEF on each
   * ground, and an ENDING that is the last mission rather than a number of
   * engagements — see `Levels.CAMPAIGNS`.
   *
   * WHICH CAMPAIGN IS THE GROUND THE PLAYER PICKED. `campaignAt` maps the
   * theatre to the campaign that opens on it, which is why this mode declares
   * neither `fixedTheatre` nor `level`: the Theatre column IS the picker. An
   * explicit id wins over it, for a check and for a future card row; a ground
   * that opens nothing falls to the first campaign and the run is walked to its
   * opening ground through the ordinary door.
   *
   * IDEMPOTENT, and called by `update` on the first frame for the reason
   * `beginSkirmish` is: a mode that needs front-end wiring to be playable is a
   * mode that is not playable.
   */
  beginCampaign(id = null) {
    /* Off `picksCampaign` and not off the mode's name, exactly as
     * `beginSkirmish` reads `battles`: the property is what the branch is
     * about, and a second mode that picks a campaign from the Theatre column
     * would otherwise need this line edited to reach its own runner. */
    if (!this.command || !MODES[this.settings?.mode]?.picksCampaign) return null;
    if (!this.campaign) {
      const def = (id && CAMPAIGNS[id]) || campaignAt(this.levelKey) || CAMPAIGNS[CAMPAIGN_IDS[0]];
      if (!def || !def.missions?.length) return null;
      this.campaign = { id: def.id, def, index: 0, log: [], done: false, won: null };
    }
    const c = this.campaign;
    if (c.done) return c;
    const m = c.def.missions[c.index];
    /* THE OPENING GROUND, if the player is not standing on it. Only reachable
     * when the theatre they picked opens no campaign at all — `campaignAt`
     * makes the ordinary path a no-op — and it goes through the same deferred
     * rotation a mission boundary does rather than loading a level inside a
     * frame. */
    if (m && m.level !== this.levelKey && LEVELS[m.level]) { this._groundPending = m.level; return c; }
    this.beginMission();
    return c;
  }

  /**
   * THE MISSION IN FRONT OF YOU, as a skirmish with its terms written down.
   *
   * The brief goes up BEFORE the engagement banner, because it is the reason
   * the ground was chosen and the banner is a count. `rotate: false` is the
   * line that separates a campaign from a playlist: within a mission the ground
   * is fixed, between missions it is authored, and neither of those is the
   * seeded shuffle `levelRotation` draws.
   */
  beginMission(wave = null) {
    const c = this.campaign;
    if (!c || c.done) return null;
    const m = c.def.missions[c.index];
    if (!m) return null;
    this.skirmish = null;
    if (m.name) this.notify(m.name, m.brief || '');
    const sk = this.beginSkirmish({ ...m, rotate: false }, wave);
    if (sk) c.started = true;
    return sk;
  }

  /**
   * THE MISSION IS BEHIND YOU — and this is what stops a campaign ending four
   * missions early.
   *
   * `_endSkirmish` is the ending for a battle and a mission IS a battle, so
   * every mission would have called `onGameOver` and shown the death card with
   * `won: true` on it. This runs first and answers "was that a run or a leg of
   * one": on a leg it advances the index, throws the finished plan away so the
   * next `beginMission` builds a new one, and defers the ground change to the
   * top of the next frame for the reason `_skirmishCleared` gives.
   *
   * @returns true when the run continues.
   */
  _advanceMission() {
    const c = this.campaign;
    if (!c || c.done) return false;
    const m = c.def.missions[c.index];
    c.log.push({
      mission: c.index + 1, name: m?.name ?? null, level: this.levelKey,
      wave: this.director?.wave ?? 0, standing: this.command?.roster?.strength ?? 0,
    });
    if (c.index >= c.def.missions.length - 1) return false;
    c.index++;
    this.skirmish = null;
    const next = c.def.missions[c.index].level;
    this._groundPending = LEVELS[next] ? next : this.levelKey;
    return true;
  }

  /** What the campaign looks like from outside. Derived, so it cannot drift. */
  campaignReadout() {
    const c = this.campaign;
    if (!c) return null;
    const m = c.def.missions[c.index];
    return {
      id: c.id,
      name: c.def.name,
      mission: c.index + 1,
      missions: c.def.missions.length,
      missionName: m?.name ?? null,
      brief: m?.brief ?? null,
      level: this.levelKey,
      levelName: this.level?.name ?? null,
      next: c.def.missions[c.index + 1]
        ? (LEVELS[c.def.missions[c.index + 1].level]?.name ?? null) : null,
      grounds: c.def.missions.map((x) => LEVELS[x.level]?.name || x.level),
      won: c.won,
      done: c.done,
      log: c.log,
      battle: this.skirmishReadout(),
    };
  }

  /**
   * WHERE YOU ARE AND HOW MUCH OF THE BATTLE IS LEFT — said once, from one
   * place, because the opening engagement, a same-ground engagement and one
   * arrived at by a ground change are the same announcement and three copies of
   * a template string is how they stop being.
   */
  _skirmishBanner() {
    const sk = this.skirmish;
    if (!sk || sk.done) return;
    this.notify(`${(this.level?.name || '').toUpperCase()} — ENGAGEMENT ${sk.cleared + 1} OF ${sk.engagements}`,
      `${this.command?.roster?.strength ?? 0} of yours on the ground`);
  }

  /**
   * RAISE THE LINE TO THE STATED STRENGTH, through the muster and not beside it.
   *
   * `CommandDirector`'s constructor has already enlisted `OPENING_STRENGTH`
   * bodies of the army's first rung — that is `_musterOpening`, and it is why
   * the plan's strength is floored there rather than at one. What is left is to
   * fill the gap, and the fill walks `musterOffer(c).units` IN LADDER ORDER and
   * wraps: an army of eighteen is the ladder twice over rather than eighteen
   * line troopers, and the shelf is already filtered by `at <= areaNumber` so
   * the pressure decides what is on it. A skirmish at the landing zone fields
   * troopers and heavies; one at the core ship can field the machine.
   *
   * THE PURSE IS CREDITED EXACTLY WHAT THE NEXT BODY COSTS, one at a time, so
   * `musterCost` stays the only price list in the game and `MAX_STRENGTH` stays
   * `recruit`'s own refusal rather than a second bound written here. The
   * remainder is zeroed afterwards: a skirmish has no muster screen and points
   * left in a purse nobody can spend are a number on a HUD that lies.
   *
   * Called again by `_afterRotate`, which is the whole of "how the armies are
   * reinforced": the line is brought back up to strength on the next ground,
   * with new designations for the replacements, and the fallen stay fallen on
   * the roll that is about to be replaced. Names persist within an engagement
   * and not across one — Command is the mode where a body you recognise walks
   * off the planet with you, and a skirmish that also did that would be Command
   * with a shorter map list.
   */
  _musterSkirmish() {
    const sk = this.skirmish, d = this.command;
    if (!sk || !d) return 0;
    d.areaIndex = sk.pressure;
    let added = 0;
    for (const c of d.commanders) {
      const shelf = d.musterOffer(c)?.units || [];
      if (!shelf.length) continue;
      for (let i = 0; c.roster.strength < sk.strength && i < MAX_STRENGTH * shelf.length; i++) {
        const unit = shelf[i % shelf.length];
        c.roster.points += unit.cost;
        if (!d.recruit(unit.type, c)) { c.roster.points -= unit.cost; break; }
        added++;
      }
      c.roster.points = 0;
    }
    return added;
  }

  /**
   * ONE ENGAGEMENT IS BEHIND YOU.
   *
   * `areaWaves = 0` is the load-bearing line and it is worth the paragraph.
   * `CommandDirector.payWave` counts cleared waves against `this.area.waves`
   * and calls `_areaClear` when it reaches it — the campaign's area boundary,
   * which recalls the army, credits a purse, opens a muster screen and names
   * the next AREA OF GEONOSIS in a banner. Every one of those is wrong for a
   * battle on the Colosseum, and `_endCampaign` beyond it announces "walked off
   * Geonosis". Command.js is not this lane's file and none of it needs to be:
   * resetting the counter after every clear keeps `areaWaves` at 1, the
   * shortest area in the table is 3 waves long, and the campaign's boundary is
   * therefore unreachable by construction. A skirmish's ending is World's, the
   * way a meeting's is.
   *
   * The ground change is DEFERRED rather than done here. This runs inside
   * `WaveDirector.update`, immediately after the clear branch, and `unload()`
   * disposes the bodies that loop is standing in. `update` takes it at the top
   * of the next frame, which is the same shape `_bossFrame` and the kill-time
   * release use for the same reason.
   */
  _skirmishCleared() {
    const sk = this.skirmish, d = this.command;
    if (!sk || sk.done || this.over) return false;
    /* A CLIENT IS TOLD WHERE IT IS, IT DOES NOT DECIDE. `_afterRotate` spawns
     * one local player and knows nothing about the RemoteAvatars `unload`
     * disposed, so a peer rotating itself would leave a session on two
     * different grounds with each machine drawing one body. The host-side
     * message that carries a mid-run level change does not exist yet and is in
     * the handover; until it does, a joined skirmish holds the ground it
     * started on rather than desynchronising. */
    if (this.netMode === 'client') return false;
    if (d) d.areaWaves = 0;
    /**
     * AN ENGAGEMENT IS `sk.waves` CLEARED WAVES, NOT ONE.
     *
     * The player: "in skirmish mode I'll start the map will immediately say
     * cleared and we leave like there were never any enemies." That is this
     * method firing on wave 1, which the escalation composes as ONE body — so
     * the ground was declared held before the second enemy in the battle had
     * been bought. Driven in `tools/_stall.mjs --mode skirmish`: engagement 1
     * closed at t = 6.0 s, one hostile composed, transport called.
     *
     * Counted here rather than by reading `director.wave`, because a battle can
     * open at any wave number (`beginSkirmish` opens it at the pressure's) and
     * the campaign's own missions restart the count.
     */
    sk.waveCount = (sk.waveCount || 0) + 1;
    if (sk.waveCount < (sk.waves || 1)) {
      this.notify(`WAVE ${sk.waveCount} OF ${sk.waves} — HOLD`,
        `${this.command?.roster?.strength ?? 0} of yours still standing`);
      return false;
    }
    sk.waveCount = 0;
    sk.cleared++;
    sk.log.push({
      engagement: sk.cleared, level: this.levelKey, name: this.level?.name,
      wave: this.director?.wave ?? 0,
      standing: d?.roster?.strength ?? 0, fallen: d?.roster?.fallen?.length ?? 0,
    });
    if (sk.cleared >= sk.engagements) { this._endSkirmish(true); return true; }
    const next = sk.rotation[sk.cleared % sk.rotation.length] || this.levelKey;
    if (next !== this.levelKey) this._groundPending = next;
    else {
      // Same ground, so there is nothing to tear down — but the line is still
      // brought back to strength, because reinforcement is a property of the
      // engagement boundary and not of the rotation being on.
      this._musterSkirmish();
      this._skirmishBanner();
    }
    return true;
  }

  /**
   * THE BATTLE IS DECIDED — the third door in this game that can say `won`.
   *
   * Through `onGameOver`, which is the one event that stops the director,
   * releases the pointer, shows a card and writes the record — the same door
   * `_endMeeting` and `CommandDirector._endCampaign` use, for the same reason,
   * with the same six fields under it. `runStats` is what stops those six from
   * being written out a third time; see it.
   *
   * A DEFEAT DOES NOT COME THROUGH HERE. The player going down is `_checkWipe`,
   * which every mode in the game already ends on, and restating it would be a
   * second wipe rule that could disagree with the first. Losing your whole LINE
   * is deliberately not a defeat either: the army is a cost, not a life bar,
   * and a Jedi standing alone at the end of a lost engagement is a real thing
   * this mode should let you fight your way out of.
   *
   * WHAT THE DEFEAT PATH DID NOT GET WAS THE ANNOUNCEMENT, and that is the
   * defect `_announceBattle` closes. This method held the notify and
   * `audio.runWon` in its own body, and its only caller passes `true` — so a
   * battle you WON said "THE BATTLE IS WON" over the victory cue and a battle
   * you LOST said nothing at all. Measured on the drive in
   * `tools/checks/skirmish.mjs`: the last line a beaten player saw was
   * "THE COLOSSEUM — ENGAGEMENT 1 OF 4", the banner from the engagement they
   * had just died in, and `audio.runWon` fired zero times against the victory's
   * one. See `_announceBattle`.
   */
  _endSkirmish(won) {
    const sk = this.skirmish;
    if (!sk || this.over) return false;
    sk.done = true;
    sk.won = !!won;
    /* A MISSION IS NOT A RUN. `_advanceMission` answers "was that battle a leg
     * of a campaign", and on a leg it takes the run to the next ground and this
     * returns without ending anything — without it every mission of every
     * campaign would raise the death card with `won: true` on it. */
    if (won && this._advanceMission()) return false;
    if (this.campaign && !this.campaign.done) { this.campaign.done = true; this.campaign.won = !!won; }
    if (this.command) this.command.done = true;
    this.over = true;
    this._announceBattle(!!won);
    this.onGameOver?.(this.runStats({ won: !!won }));
    return true;
  }

  /**
   * ══ CALLING FOR EXTRACTION, AND WHY IT IS A HOLD ═══════════════════════
   *
   * Every other ending in this game happens TO you: you die, or you clear the
   * last wave. This is the one you choose, and it is the reason the company
   * can persist at all — a roster that is only ever wiped is a save file that
   * always reads zero. Leaving with eight men is a result. Quitting is not.
   *
   * IT IS HELD FOR `WITHDRAW_HOLD` SECONDS AND NOT PRESSED. A press ends the
   * run, and there is no undo; a key next to the movement cluster that ends a
   * forty-minute run on one bounce is not a control, it is a hazard. The hold
   * also does a second job, which is that it cannot be done while you are
   * busy — you have to stop swinging for a second and a half to ask, which is
   * itself the decision being made.
   *
   * THE TIMER RESETS ON RELEASE and is reported to the HUD every frame as
   * `withdrawHold` in [0,1], so the ring the player watches fill is the same
   * number this method is counting. One quantity, one owner (HANDOFF 2.3).
   *
   * FOUR REFUSALS, and each one is a case where the call cannot mean anything:
   * a run already over, a client (the host owns the ship), a dead commander,
   * and a sequence already running — including the insertion you arrived on,
   * which is why this cannot be spammed during the opening flight.
   */
  _withdrawTick(dt, ctx) {
    /* `.act('withdraw')` and not `.act?.('withdraw')`, and the difference is
     * not style. `controls.mjs` finds the reader of every registered action by
     * scanning src/ for `.act(` with a literal id — an optional CALL is
     * invisible to it, so the hold key read through `?.()` was reported as
     * "bound, listed and handled by nobody", which is exactly the class of
     * defect that check exists to catch. The guard moves onto the function. */
    const input = ctx?.input;
    const held = this.canWithdraw && !!(input?.act && input.act('withdraw'));
    if (!held) { this.withdrawHold = 0; return; }
    this.withdrawHold = Math.min(1, (this.withdrawHold || 0) + dt / WITHDRAW_HOLD);
    if (this.withdrawHold < 1) return;
    this.withdrawHold = 0;
    this.withdraw();
  }

  /** Whether asking to leave could do anything right now. The HUD reads it. */
  get canWithdraw() {
    return !!(this.player && this.player.alive && !this.over
      && this.netMode !== 'client' && !this.extraction?.active);
  }

  /** Ask for the ship. Public because the HUD's own button and a check both use it. */
  withdraw() {
    if (!this.canWithdraw) return false;
    if (!this.extraction?.withdraw()) return false;
    this.notify('WITHDRAWING', 'Get to the ramp', 'alarm');
    return true;
  }

  /**
   * THE SHIP IS CLIMBING AND THE RUN IS OVER.
   *
   * `kept` is the passenger list — the roster records of the men who walked up
   * the ramp inside the `LAST_CALL` the ship held it. Everybody else is still
   * on the ground, and the whole cost of calling late is in the difference
   * between those two numbers.
   *
   * NOBODY IS KILLED HERE. A man left behind is not marked dead — he is simply
   * not on the manifest, and the layer that persists the company keeps what is
   * on the manifest and nothing else. Writing a death for him would put him on
   * the memorial roll beside men who actually fell, which is a different fact.
   */
  _endWithdrawal(kept) {
    if (this.over) return;
    this.over = true;
    const roster = this.command?.roster;
    const total = roster ? roster.living.length : null;
    const n = kept ? kept.length : 0;
    if (this.command) this.command.done = true;
    this.manifest = kept || [];
    this.notify('CLEAR OF THE GROUND',
      total === null ? 'The ship is away'
        : (n === total ? `All ${n} aboard` : `${n} of ${total} aboard`));
    this.onGameOver?.(this.runStats({ won: null, ended: 'withdrew', extracted: n, leftBehind: total === null ? null : total - n }));
  }

  /**
   * A BOUNDED BATTLE ENDED, AND THIS IS THE ONLY PLACE THAT SAYS SO.
   *
   * Two endings, one sentence. `_endSkirmish` is reached by clearing the last
   * engagement and `_checkWipe` by dying in any of them, and the second one is
   * the ONE A PLAYER MEETS FIRST — the mode's blurb promises "a victory or a
   * defeat, not a high score" and half of that promise was unspoken. The
   * announcement cannot live in `_endSkirmish` because `_checkWipe` deliberately
   * does not route through it (that method returns on `this.over`, and there is
   * exactly one wipe rule in the game), so it lives here and both call it.
   *
   * Everything in the line is DERIVED from the plan that is already closed by
   * the time this runs: `sk.cleared` / `c.index` are the rounds behind you,
   * `sk.rotation` / `c.def.missions` name them, and `c.def.name` is what the
   * run is called. A lost battle on round one has no grounds to list, so the
   * subtitle falls back to the count rather than printing a dangling dash — the
   * won path never reached that branch, which is why it had never been written
   * for the campaign.
   *
   * `audio.runWon(false)` rather than silence: the cue takes the argument
   * precisely so a decided run makes the sound of how it was decided, which is
   * the position `_endMeeting` already takes for the commander who lost.
   *
   * THE THIRD BRANCH IS COMMAND'S ADVANCE, and it had the identical defect one
   * mode earlier. `CommandDirector._endCampaign` held its own notify and its
   * own `audio.runWon(true)` — a victory sentence with no losing half — so a
   * player who went down leading the army on Geonosis was told nothing at all:
   * driven, the last line on screen was "WAVE 1 · 8 contacts inbound" and the
   * cue fired zero times. Three plans, three verdicts, one announcement.
   *
   * The order is the nesting order, not a preference. A campaign mission and a
   * skirmish both run a CommandDirector, so a check against `this.command`
   * first would announce every lost engagement as a lost advance.
   *
   * @returns false when there is no bounded run to announce, which is every
   *   endless mode — those end on `_checkWipe` alone and have no verdict.
   */
  _announceBattle(won) {
    const c = this.campaign, sk = this.skirmish, d = this.command, w = this.director;
    /* ONE `notify` AND ONE `audio.runWon` AT THE FOOT, not one per branch. The
     * branches decide the WORDS; that a decided run is announced and makes the
     * sound of how it was decided is the property, and three copies of it is
     * how a fourth plan ends up with a sentence and no cue — which is the exact
     * defect this method was extracted to close. */
    let title = null, sub = '';
    if (c || sk) {
      const done = c ? c.index + (won ? 1 : 0) : sk.cleared;
      const of = c ? c.def.missions.length : sk.engagements;
      const rounds = c
        ? c.def.missions.slice(0, done).map((m) => LEVELS[m.level]?.name || m.level)
        : sk.rotation.slice(0, done).map((k) => LEVELS[k]?.name || k);
      const what = c ? c.def.name.toUpperCase() : 'THE BATTLE';
      title = won ? `${what} IS WON` : `${what} IS LOST`;
      sub = rounds.length ? `${done} of ${of} — ${rounds.join(' · ')}`
        : `${done} of ${of} ${c ? 'missions' : 'engagements'}`;
    } else if (d) {
      /* THE GROUND IS NAMED OFF THE GROUND, exactly as `_endMeeting` names it:
       * the shipped sentence said "walked off Geonosis" from inside a file that
       * is holding the level, which is a level name written beside a level
       * list. `MODES.command.level` makes it Geonosis today and the derivation
       * makes it right the day that changes. */
      const where = this.level?.name || 'the field';
      const all = d.roster?.all?.length ?? 0;
      /**
       * THE MODE THAT IS WON BY ITS LINE SAYS SO — `MODES.theline.holdTheLine`.
       *
       * "THE ADVANCE IS LOST" is Command's sentence and it is right there: that
       * mode is won by taking the ground, so the ground is what was lost. In
       * THE LINE the ground is not the win condition and the roster is, and the
       * card the player is about to read says **"The line did not hold"**
       * (`Menu.LINE_LOST_TITLE`). Two announcements of one ending disagreeing
       * about what the ending WAS is the same defect as a victory card over a
       * table of casualties, which is what `Menu.VICTORY_TITLE` exists to have
       * fixed.
       *
       * Read off `holdTheLine` rather than off the mode's name, so the sentence
       * follows the RULE — a second mode that is won by its line gets it, and
       * Command keeps its own words unchanged.
       */
      const line = !!d.holdTheLine;
      title = won ? (line ? 'THE LINE HOLDS' : 'THE ADVANCE IS OVER')
        : (line ? 'THE LINE IS BROKEN' : 'THE ADVANCE IS LOST');
      sub = won ? `${d.roster?.strength ?? 0} of ${all} walked off ${where}`
        : `${d.areasTaken} of ${AREAS.length} areas · ${d.roster?.fallen?.length ?? 0} of ${all} lost`;
    } else if (MODES[this.settings?.mode]?.ladder && w?.duelTop) {
      /* THE LADDER — the duel's plan, and it does not need an object to be one.
       * Where a skirmish's shape is three picks a player made, a ladder's is a
       * function of the ROSTER: `duelTop` is the wave the climb runs out on and
       * `duelTier` is how much of it is behind you, both derived off the same
       * archetypes the composer draws from. See `MODES.duel.ladder`. */
      const top = w.duelTop();
      const faced = w.duelTier(w.wave);
      title = won ? 'THE LADDER IS CLIMBED' : 'THE LADDER IS LOST';
      sub = won ? `every form on it, and the master at the top — ${top} waves`
        : `wave ${w.wave} of ${top} · ${faced} of ${w.duelRoster().rungs.length} forms faced`;
    }
    if (!title) return false;
    this.notify(title, sub);
    audio.runWon?.(!!won);
    return true;
  }

  /**
   * THE LAST RUNG IS BEHIND YOU — the duel's ending, and it had none.
   *
   * The mode card has promised "a master at the top" for the whole life of the
   * mode and the ladder had a PLATEAU: measured off the shipped composer, the
   * window narrows to its last two rungs at wave 28 and every wave from 30
   * onwards is identical for ever. `WaveDirector.duelTop` is where the climb
   * runs out — the first set-piece wave at full narrowing, four promoted blades
   * in the two heaviest forms plus the boss that is not on the ladder — and
   * clearing it is a WIN, which makes the duel the fourth thing in this game
   * that can be won and the first that is not an army mode.
   *
   * Hung off the wave-clear ledger beside `_skirmishCleared` and behind the
   * same `fresh` gate, for the same reason: `restartWave` re-composes the wave
   * the player is standing in and fires the clear signal again, so an ending on
   * the announcement rather than on the ledger could be reached by re-clearing
   * a wave already paid for. That is the defect `tools/checks/restart.mjs`
   * measured at +10 drafts and +20,400 score, arriving in a new mode.
   */
  _ladderCleared() {
    if (this.over || !MODES[this.settings?.mode]?.ladder) return false;
    const d = this.director;
    if (!d?.duelTop || (d.wave ?? 0) < d.duelTop()) return false;
    this.over = true;
    this._announceBattle(true);
    this.onGameOver?.(this.runStats({ won: true }));
    return true;
  }

  /**
   * WHAT THE BATTLE LOOKS LIKE FROM OUTSIDE — the HUD's line and the summary's,
   * derived off the plan so the two cannot disagree. `CommandDirector.readout`
   * is the precedent and the reason: one authority, no second assembly.
   */
  skirmishReadout() {
    const sk = this.skirmish;
    if (!sk) return null;
    const d = this.command;
    return {
      engagement: Math.min(sk.cleared + 1, sk.engagements),
      engagements: sk.engagements,
      cleared: sk.cleared,
      level: this.levelKey,
      levelName: this.level?.name ?? null,
      next: sk.done ? null : (LEVELS[sk.rotation[(sk.cleared + 1) % sk.rotation.length]]?.name ?? null),
      area: AREAS[sk.pressure]?.name ?? null,
      strength: d?.roster?.strength ?? 0,
      wanted: sk.strength,
      fallen: d?.roster?.fallen?.length ?? 0,
      rotation: sk.rotation.map((k) => LEVELS[k]?.name || k),
      seed: sk.seed,
      won: sk.won,
      done: sk.done,
      log: sk.log,
    };
  }

  /**
   * EVERY NUMBER AN ENDING REPORTS, IN ONE PLACE.
   *
   * `_checkWipe`, `_endMeeting` and `CommandDirector._endCampaign` each
   * assembled this object by hand. That is a three-way twin, and it was known:
   * the note over `_endCampaign` says so in as many words and
   * `tools/checks/command.mjs` holds a wipe's key set and a victory's to being
   * identical precisely because nothing else could — "the honest fix is a
   * `World.runStats()` both call; it is in the handover at the foot of this
   * file". All four endings call it now.
   *
   * IT WAS SIX FIELDS AND THE CARD READS EIGHT. `main.js`'s `gameOver` prints
   * `stats.taken` and `stats.fallen` on a won run, no ending sent either, and
   * the card covered for both with `?? 5` and `?? 0` — so **every won run ever
   * played printed "Areas taken 5"**, a literal with no subject, and "Troops
   * lost 0" on the mode whose entire subject is named people dying for good.
   * That is §2.3's close relative exactly: a missing thing answered with a
   * plausible default. The defaults are gone from the card and the numbers are
   * sent from here.
   *
   * BOTH ARE DERIVED AND BOTH MAY BE `null`, which is the load-bearing part.
   * `taken` is ONE NUMBER WITH THREE MEANINGS — missions, engagements, areas —
   * and the mode is what names it, so the number is read off whichever plan is
   * running and the LABEL stays in main.js's `TAKEN` map beside the row it
   * writes. The endless modes take no ground and lose no troops: they report
   * `null`, and `gameOver` drops a row it has no number for rather than
   * inventing one. A key that is present and null is what lets that check be
   * "did the ending send this field", not "did it send a truthy value".
   *
   * The order is the nesting order and not a preference: a campaign mission IS
   * a skirmish (`beginMission` builds one), so a campaign that read the
   * skirmish first would report the engagements of its current mission as the
   * missions of its run.
   */
  /**
   * WHICH HEIGHTFIELD THIS RUN STANDS ON — the authored one, or one generated
   * around a front for this seed.
   *
   * `FLAGSHIP.md` §12's first line is "generate the battle, then the ground
   * that explains it", and `src/world/Battlefield.js` builds that: a reason
   * drawn from a table of five, a bezier front from six seeded numbers, and a
   * height closure in which high ground FLANKS the front and never sits on it,
   * with exactly one chokepoint and a ridge field running along the advance.
   * It had no caller. This is the caller.
   *
   * ── IT IS A LAYER, WHICH IS WHAT KEEPS §13.5 TRUE ───────────────────────
   *
   * §13.5: "no room's deletion deletes the mode — every level in `LEVEL_ORDER`
   * is a legal seed. That is exactly what killed the Descent." So the generated
   * ground is NOT a new theatre a seed can land on. The mode still rolls one of
   * the seven authored theatres (`Session.rollGround`), keeps its pool, its
   * dressing, its arrivals, its sky and its whole palette — §12.5, "do not
   * generate the palette" — and only the HEIGHT is replaced. Delete a room and
   * the mode loses that room's draw, exactly as before; nothing generated is
   * reachable except through a room that exists.
   *
   * ── WHY IT FALLS BACK RATHER THAN THROWS ────────────────────────────────
   *
   * `battlefieldGround` refuses a ground with a roof over it — a front cannot
   * be derived on a floor — and refuses to shadow an authored preset key. Both
   * refusals are correct and neither is a reason to fail to load a level: the
   * honest answer to "this ground cannot carry a generated front" is the ground
   * as authored, which is what every other mode gets. It is reported once so it
   * cannot be silent (§2.3's relative — a missing thing answered with a
   * plausible default is how a literal survives).
   *
   * A SEEDLESS RUN GETS THE AUTHORED GROUND, and that is the same rule the
   * ground roll already follows: `null` means nobody has stated a number, which
   * is every headless check that builds a World by hand.
   */
  _groundKeyFor(L) {
    const key = L.terrain;
    /* THE MODE IS READ OFF SETTINGS HERE and not taken as an argument: the
     * ground is raised in an early stage of `loadLevel`'s list and the local
     * `mode` is not declared until the director stage, a hundred lines further
     * down. Taking it as a parameter compiled and threw `mode is not defined`
     * on the first boot. `settings.mode` is what that local reads anyway. */
    const mode = this.settings?.mode ?? 'roguelite';
    /* Taken down first: `installGround` refuses to overwrite, so a second run
     * on the same base would throw on its own leftovers. `rotateTo` re-enters
     * this whole list for every engagement. */
    this._dropGeneratedGround();
    if (!MODES[mode]?.generatedGround) return key;
    /**
     * …AND THE LEVEL HAS TO SAY IT CAN CARRY ONE.
     *
     * A generated heightfield is raised UNDER a level's own dressing, and the
     * dressing was authored against the contours it replaces. Measured, scoria
     * at seed 3: with the authored ground the line deploys 10 of 10 and the
     * wave puts 47 hostiles on the field; with a generated one **6 of the ten
     * are dead inside twenty seconds, the other four cannot be placed at all,
     * and the wave manages 2 bodies.** Geonosis at the same seed is 10 of 10
     * and unaffected. Whatever scoria's rocks and wrecks do on new contours,
     * they take the ground a body needs to stand on with them.
     *
     * So it is the LEVEL's declaration and not the mode's, for the reason
     * `LEVELS[*].pool` and `terrain` are the level's: it is a fact about that
     * room. A ground that has not been measured stays authored, which costs the
     * mode nothing — it still rolls that theatre, and §13.5 still holds — and a
     * room lights this the day somebody measures it. The alternative was a list
     * of level keys in this file, which is the twin-table defect (§2.3) and
     * would have been wrong about scoria in exactly the same way.
     */
    if (!L.battlefield) return key;
    /* …AND ANYBODY ELSE'S LEFTOVER on this exact base, for a world that was
     * dropped without unloading. `removeGround` refuses an authored preset, so
     * this can only ever take back something this file installed. */
    try { removeGround(`front:${key}`); } catch { /* authored: not ours */ }
    const seed = Number.isFinite(this.runSeed) ? this.runSeed : null;
    if (seed === null) return key;
    try {
      /* AND WHERE THE PLAYER ACTUALLY LANDS. The generated front is pulled
       * through the deploy point and the shelf that stands it out of a
       * borrowed sea is measured from it; `planBattle`'s default is the
       * origin, which is true of five of the seven theatres and 71 m wrong on
       * the Ember Shelf. `L.start` is the same array `_playerSpawn` reads. */
      const made = battlefieldGround(key, seed, { deploy: L.start, keep: L.spawnRadius?.[1] });
      installGround(made.key, made.preset);
      this._genGround = made.key;
      /** The plan, published for anything that wants the front rather than the
       *  ground: the curve, the reason, the chokepoint and the advance bearing.
       *  `Front.js`'s dressing takes a half-plane and `frontAtChoke` is the
       *  bridge — see its note there. */
      this.battlefield = made.plan;
      return made.key;
    } catch (err) {
      if (!this._genWarned) {
        this._genWarned = true;
        console.warn(`[battlefield] ${key} keeps its authored ground: ${err.message}`);
      }
      this.battlefield = null;
      return key;
    }
  }

  /** Take this world's generated ground back out of the shared preset table. */
  _dropGeneratedGround() {
    if (!this._genGround) return;
    try { removeGround(this._genGround); } catch { /* authored: not ours to take */ }
    this._genGround = null;
    this.battlefield = null;
  }

  runStats(extra = null) {
    const sum = (f) => (this.players || []).reduce((a, p) => a + (p[f] || 0), 0);
    const c = this.campaign, sk = this.skirmish, d = this.command;
    /* ONE PROJECTION OF THE LOG, read twice. `roll` and `report` are the same
     * `fell` entries seen at two magnifications, and the day they were two
     * filters was the day they could disagree about who is on the list. */
    const rep = d?.log ? runReport(d.log) : null;
    return {
      ...(extra || {}),
      wave: this.director?.wave ?? 0,
      score: this.score,
      kills: sum('kills'),
      deflects: sum('deflects'),
      perfects: sum('perfects'),
      limbs: sum('limbsRemoved'),
      taken: this._taken(),
      /* The roll, not a tally kept beside it: `CommandRoster.fallen` is a
       * getter over the records themselves. Null where there is no army, so
       * "Troops lost" leaves the card in the modes that have no troops. */
      fallen: d?.roster?.fallen?.length ?? null,
      /**
       * …AND THE NAMES, WHICH THE COUNT ABOVE HAS NEVER CARRIED — PLAN §4.9.
       *
       * "The after-action report — who killed whom, from what direction, at
       * what minute. No death is mysterious, so no death is the AI's fault."
       *
       * The RECORD for that has been complete for some time: `_deathOf` writes
       * the killer's name, the bearing in degrees and the minute of the run
       * onto every `fell` entry, and `interludeBeats` renders them between
       * engagements. What no ending has ever carried is the WHOLE RUN'S list.
       * A player who finishes a crossing is told a number — "Troops lost 6" —
       * over the one mode whose entire subject is named people dying for good,
       * and the six names, each with the thing that killed it, exist in
       * `d.log` and are thrown away with the director.
       *
       * So the roll is reported here with the count, off the same log the
       * interlude reads, in the order the men fell. It is the ENTRIES and not
       * a rendering of them: `main.js` decides what a card says and this
       * decides what is true, which is the same split `taken` is built on.
       *
       * Null — not `[]` — where there is no army, for `ended`'s stated reason:
       * a key that is present and null lets a check ask "did this ending send
       * the field", and an empty array would mean "an army that lost nobody".
       */
      roll: rep ? rep.fell.map((e) => ({
        name: e.name, rank: e.rank, unit: e.unit, area: e.area, wave: e.wave,
        killer: e.killer ?? null, bearing: e.bearing ?? null, at: e.at ?? null,
      })) : null,
      /**
       * …AND THE SAME LIST COUNTED — PLAN.md §4.9's census, which is the half
       * of the report that changes a decision rather than the half that is
       * owed. Its whole argument is written over `Session.runReport`; what it
       * is doing HERE is being available to the one screen the pause card
       * cannot reach, because the run is over and there is nothing to pause.
       * Null on the same terms as `roll`, and for the same stated reason.
       */
      report: rep,
      /**
       * HOW a run ended, where "you died" is not the answer — see `main.js`'s
       * `gameOver`, which picks a third card off it.
       *
       * REPORTED HERE AND NOT ONLY PASSED IN `extra`, and the difference is
       * the whole point of this method. `skirmish.mjs` lifts every
       * `stats.<field>` the card reads out of main.js's own source and requires
       * it to be a field `runStats` REPORTS; a field that exists only on the
       * two endings that happen to pass it is exactly the "Areas taken 5"
       * shape — a card asking for something most endings do not send, and a
       * value invented at the reader to cover it. Null is the honest answer
       * for the four endings that have no such reason: you died, or you won.
       */
      ended: (extra && 'ended' in extra) ? (extra.ended ?? null) : null,
      /* THE WITHDRAWAL'S TWO NUMBERS, reported by every ending rather than only
       * by the one that has them, for the reason `ended` states above: a field
       * that exists on one ending is a card asking for something most endings
       * do not send. Null is the honest answer everywhere else — you did not
       * leave, so nobody was left. */
      extracted: (extra && 'extracted' in extra) ? (extra.extracted ?? null) : null,
      leftBehind: (extra && 'leftBehind' in extra) ? (extra.leftBehind ?? null) : null,
    };
  }

  /**
   * HOW MUCH OF THE RUN IS BEHIND YOU — one number with four meanings, and the
   * MODE is what names it. `main.js`'s `TAKEN` map holds the four labels beside
   * the row it writes; this holds the four counts beside the plans they are
   * counts of, and each one is read off a ledger something else already keeps:
   *
   *   `c.log`      one entry per mission, written by `_advanceMission` —
   *                  including on the last one, so a finished campaign counts
   *                  itself rather than needing `index + 1`.
   *   `sk.cleared` engagements, counted by `_skirmishCleared`.
   *   `areasTaken` boundaries crossed, counted off `_areaClear`'s own log.
   *   `duelTier`   how far up the ladder the climb got.
   *
   * The order is the nesting order and not a preference: a campaign mission IS
   * a skirmish and both run a CommandDirector, so any other order would report
   * an inner plan's count as the outer one's. `null` is the fourth answer and
   * the load-bearing one — an endless run takes nothing, and the card leaves
   * the row off rather than inventing the "Areas taken 5" it used to print.
   */
  _taken() {
    if (this.campaign) return this.campaign.log.length;
    if (this.skirmish) return this.skirmish.cleared;
    if (this.command) return this.command.areasTaken;
    if (MODES[this.settings?.mode]?.ladder && this.director?.duelTier) {
      return this.director.duelTier(this.director.wave);
    }
    return null;
  }

  /* ── spawning ────────────────────────────────────────────────────── */

  /**
   * IDEMPOTENT, because `Prop` now registers itself and every existing caller
   * still hands its prop over by hand. Both roads lead here and the second one
   * has to be free — see the note in `Prop`'s constructor for why the
   * constructor took the job over.
   */
  addProp(p) { if (p && !this.props.includes(p)) this.props.push(p); return p; }

  /**
   * A door the level has hung. `this.doors` is stepped every frame and fed to
   * the blade solver every frame — that is where `BlastDoor.burn` is reached
   * from — but nothing could ever get INTO the array: there was no `addDoor`
   * on World, so `doors.length` was 0 on all thirteen levels and the finished
   * blast-door system was dead content. Nine stub worlds in tools/checks
   * already implemented this method against a World that did not have it.
   */
  addDoor(d) { this.doors.push(d); return d; }

  spawnEnemy(type, pos) {
    /* NOTHING IS PUT DOWN ON THE PAD. This is the one door every body in the
     * game comes through — the director's direct path, every gunship's
     * `_deliver`, the sandbox — which is why the rule is asked here rather than
     * at each of them, and why it is ASKED rather than restated: the extraction
     * owns where the ship is coming down and how much room it needs, so it owns
     * the push. See `ExtractionDirector.clearOfLZ`. Costs one `hypot` per body
     * spawned, and only while a flight is up: `lzPoint` is null otherwise. */
    pos = this.extraction?.clearOfLZ(pos) ?? pos;
    const e = new Enemy(this, type, pos);
    this.enemies.push(e);
    /**
     * A BOSS ARRIVING IS A SHOT, and the camera had never framed one.
     *
     * A boss got exactly the same nothing as a B1: the notify banner, and the
     * body simply standing there. `setBars` and `punch` already exist for the
     * death card; an entrance is the same two channels used the other way
     * round — the frame narrows and holds, a low swell arrives under it, and
     * the world dips for three quarters of a second so you actually see the
     * thing walk in. The bars are released by a timer on the WORLD's clock (see
     * `_bossFrame`), never by a `setTimeout`, for the reason the jump's lens
     * kick is now on the world's clock too.
     */
    if (e.A?.boss && this.player?.isLocal && !this._bossFrame) {
      this.notify(String(e.A.label || 'A CHALLENGER').toUpperCase(), 'it has come for you', 'threat');
      this._bossFrame = 2.6;
      this.engine?.setBars?.(0.075);
      if (this.feelOn?.('shake') !== false) {
        this.engine?.punch?.(0.5);
        this.engine?.rumble?.(0.75, 0.3, 420);
      }
      this.killTime(0.5, 0.75);
      const at = e.position;
      audio.tone({ freq: 46, freqEnd: 30, dur: 2.4, gain: 0.34, type: 'sine', attack: 0.04,
        prio: PRIO.critical });
      audio.tone({ freq: 92, freqEnd: 61, dur: 1.9, gain: 0.14, type: 'triangle', attack: 0.12,
        prio: PRIO.critical });
      if (at) audio.bodyThump(at, clamp(num(e.A.mass, 300) * 3, 200, 2400));
    }
    return e;
  }

  pickSpawn(type) {
    const L = this.level;
    const [rmin, rmax] = L.spawnRadius || [34, 56];
    /* THE GROUND THE COMMANDER IS ABOUT TO STAND ON, while they are still in
     * the air above it. The director now runs through the landing (see the gate
     * in `update`), and for those nine seconds `player.position` is a seat in a
     * bay: measured on a geonosis insertion it opens the descent 150 m from the
     * pad and 900 m up, so a ring drawn round it puts the wave up to 246 m from
     * where the ramp is going to come down. The LZ is the anchor the whole
     * flight is aimed at, so it is the anchor the wave is drawn round; the
     * moment `_release` puts the commander on the sand, `riding` clears and
     * this is their own position again — which is the same point. */
    const flying = this.player?.riding && this.extraction?.landing ? this.extraction.lzPoint : null;
    const anchor = flying || (this.player ? this.player.position : _v1.set(0, 0, 0));
    for (let i = 0; i < 24; i++) {
      const a = rng() * TAU;
      const r = lerp(rmin, rmax, rng());
      const x = anchor.x + Math.cos(a) * r;
      const z = anchor.z + Math.sin(a) * r;
      if (!this.terrain.inBounds(x, z, 10)) continue;
      if (this.terrain.slopeAt(x, z) > 0.5) continue;
      const y = this.terrain.height(x, z);
      // …and what the LEVEL put there, which these 24 tries used to ignore
      // entirely: 11.9% of Temple picks landed inside solid masonry and 94.3%
      // of the deeps' under its own water. See `spawnClear` in Levels.js.
      if (!spawnClear(this, x, y, z)) continue;
      return new THREE.Vector3(x, y, z);
    }
    /* The give-up case is a LAST RESORT and it is still the level's own ring,
     * so it gets the same test: better to arrive at rmin on a clear patch than
     * to be dropped inside a column because 24 tries were unlucky. */
    for (let i = 0; i < 12; i++) {
      const a = rng() * TAU;
      const x = anchor.x + Math.cos(a) * rmin, z = anchor.z + Math.sin(a) * rmin;
      const y = this.terrain.height(x, z);
      if (spawnClear(this, x, y, z)) return new THREE.Vector3(x, y, z);
    }
    const a = rng() * TAU;
    return new THREE.Vector3(anchor.x + Math.cos(a) * rmin,
      this.terrain.height(anchor.x + Math.cos(a) * rmin, anchor.z + Math.sin(a) * rmin),
      anchor.z + Math.sin(a) * rmin);
  }

  /**
   * WHO IS THIS BODY FIGHTING — one function, and it now answers for both
   * armies rather than for the horde alone.
   *
   * `Enemy._think` asks this every frame and twelve things downstream read the
   * answer, so it is the single seam that decides who anybody in this world is
   * pointing at. Two branches:
   *
   *   A TROOP OF YOURS delegates to the command director, because the answer
   *     depends on its FORMATION as well as on distance — the leash is what
   *     makes "circle around me" a wall that will not chase and "charge" a wall
   *     that will. The director owns the formation; it therefore owns the pick.
   *     Returning null is a legitimate answer there and is what makes the leash
   *     mean anything: `_think` sets `wish = null` on a null target and
   *     `CommandDirector.steer` supplies the walk home.
   *
   *   EVERYTHING ELSE keeps exactly the rule it had, plus the enemy list. That
   *     addition is the whole of "the horde fights your army too": with allies
   *     living in `this.enemies` on the party's team, a B1 asking this question
   *     used to be shown only the players and would walk past a squad of clones
   *     to reach you. `hostileTo` is the same gate `bladeTargets` and
   *     `Player.damage` consult, so nothing anywhere is built from a different
   *     idea of who is fighting whom — and in every mode with no allies in it
   *     the second loop finds nothing and this costs one `canHarm` per body.
   */
  pickTarget(enemy) {
    if (enemy?.trooper && this.command) {
      /* THE INDEX RATHER THAN THE WHOLE OPPOSED ARMY. `_hostilesFor` builds a
       * list of every hostile on the field, once per trooper per frame, so that
       * `targetFor` can reject almost all of it against a leash of thirty
       * metres — the second of the two squares this file used to run. The
       * director asks the index for what is inside its own leash when it has
       * one, and reaches back through `world._hostilesFor` only when it does
       * not — a CHARGE order has no leash. `null` and not the list itself: the
       * list is the cost, so building it eagerly and then not using it would
       * leave the square exactly where it was. */
      return this.command.targetFor(enemy, null, this.armyIndex);
    }
    let best = null, bestD = Infinity;
    /* `hostileTo` rather than every player: in a duel the horde is on nobody's
     * side, and in co-op it returns all four unchanged. Filtering here rather
     * than at the twelve places that read `enemy.target` is the same argument
     * `bladeTargets` makes — a targeting rule with two copies decides twice. */
    for (const p of hostileTo(enemy, this.players, this.rules)) {
      if (!p.alive) continue;
      const d = p.position.distanceToSquared(enemy.position);
      if (d < bestD) { bestD = d; best = p; }
    }
    /* …and the other army, if there is one. Skipped entirely when there is not:
     * `this.command` is null and this loop does not run at all.
     *
     * THAT IS THREE MODES NOW, NOT ONE. This used to say "every mode but
     * Command"; `World.loadLevel` builds a CommandDirector for `command`,
     * `skirmish` and `campaign` alike, so all three get the cross-army pass and
     * the rest do not.
     *
     * AND IT IS STILL A MODE GATE RATHER THAN A FIELD ONE, deliberately. Six
     * levels field Republic and Confederate bodies in the same wave without
     * declaring a split (`factions` prints the census), so dropping this gate
     * would set those two halves on each other in the Trial and in Path of the
     * Blade — and every one of those levels' notes argues a HORDE, a field
     * united against you. That is a design decision about six levels and not a
     * defect to be quietly fixed here; ROADMAP and HANDOFF §6.5 both carry it
     * as an open question. What is NOT deliberate is the cost if it ever
     * changes: this is O(bodies²) per frame and it is only affordable because
     * `_hostilesFor` is the path Command actually takes. */
    if (this.command) {
      /* …THROUGH THE BROAD PHASE, and the predicate is the old loop's three
       * `continue`s verbatim. `bestD` is carried in as the seed: a body that
       * has already found a player two metres away wants only something closer,
       * and a seeded nearest search finishes inside its first ring. See
       * src/game/ArmyIndex.js. */
      const p = enemy.position;
      /* The predicate is a field and not a fresh arrow: this runs once per body
       * per frame, so a closure written here is one allocation per body per
       * frame for a function whose body never changes. `_hostilePred` reads the
       * asker off `_hostileTo`, which is set immediately before the call. */
      this._hostileTo = enemy;
      const found = this.armyIndex.nearest(p.x, p.y, p.z, this._hostilePred, bestD);
      if (found) best = found;
    }
    return best;
  }

  /**
   * Everything one body on this field is opposed to — players and bodies alike.
   *
   * The array is retained between calls for the reason `Player._foeList` is:
   * this runs once per troop per frame, and a Command wave is twenty-four
   * troops against forty droids.
   */
  _hostilesFor(who) {
    const out = (this._foes ||= []);
    out.length = 0;
    for (const e of this.enemies) {
      /* `downed` for the reason `_hostilePred` gives: a man on the ground is
       * finished by being reached, not by being aimed at. */
      if (e === who || e.dead || e.downed || e.team === who.team) continue;
      out.push(e);
    }
    for (const p of this.players) {
      if (!p.alive || p.team === who.team) continue;
      out.push(p);
    }
    return out;
  }

  /** A loose mesh becomes a rigid body — with the mesh's own shape, hulled. */
  spawnDebris(mesh, position, velocity, size) {
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    this.scene.add(mesh);
    const shape = hullFromGeometry(mesh.geometry)
      || (size ? box(size.x / 2, size.y / 2, size.z / 2) : ball(0.25));
    const body = new Body({
      position, shape, mass: 6 + rng() * 8,
      friction: 0.8, restitution: 0.06, layer: LAYER.DEBRIS,
      /* Everything, via LOOSE_MASK — this named neither PLAYER nor ENEMY, so
       * every fragment of every broken prop fell through the person standing
       * under it. Driven, dropped from 4 m: 0.00 m of clearance on a player
       * whose capsule reaches 1.79, and 0.29 on a Training Droid. */
      mask: LOOSE_MASK,
    });
    /* A FRAGMENT IS A STRIKER. This is the case the contact channel was
     * rebuilt for — a prop shatters over somebody's head and the pieces are
     * real. See src/game/Impact.js. */
    armKinetic(body);
    if (velocity) body.velocity.copy(velocity);
    body.angularVelocity.set((rng() - .5) * 9, (rng() - .5) * 9, (rng() - .5) * 9);
    const entry = { mesh, body, age: 0, life: 22 + rng() * 8 };
    body.userData.onCull = () => { this.scene.remove(mesh); mesh.geometry?.dispose?.(); entry.gone = true; };
    this.physics.add(body);
    this.debris.push(entry);
    return entry;
  }

  /** A whole Object3D subtree (a droideka leg, a wrecked chassis) becomes debris. */
  spawnDebrisGroup(group, position, velocity, radius = 0.5) {
    group.position.copy(position);
    group.quaternion.identity();
    this.scene.add(group);
    // A wrecked chassis is a box the size of the wreck, not a beach ball. The
    // group is already at `position` with no rotation, so its world AABB minus
    // that position is the body-local box — and any scale the builder put on
    // the group is baked into it, which is what the collider wants.
    const shape = boxFromObject(group, position) || ball(radius);
    const body = new Body({
      position: position.clone(), shape,
      mass: 20, friction: 0.8, restitution: 0.05, layer: LAYER.DEBRIS,
      /* …and this is the one that hurts: `Enemy.js` hands this the WHOLE
       * wrecked chassis of a destroyed machine, and it was walk-through. */
      mask: LOOSE_MASK,
    });
    /* Twenty kilos of wrecked chassis thrown by whatever destroyed it. */
    armKinetic(body);
    if (velocity) body.velocity.copy(velocity);
    body.angularVelocity.set((rng() - .5) * 8, (rng() - .5) * 8, (rng() - .5) * 8);
    const entry = { mesh: group, body, age: 0, life: 24 };
    body.userData.onCull = () => { this.scene.remove(group); entry.gone = true; };
    this.physics.add(body);
    this.debris.push(entry);
    return entry;
  }

  /**
   * A BLAST IS A THING THAT HAPPENS, so it goes on the wire like the grenade
   * and the bolt do — see `_recordNades`, which makes the whole argument.
   *
   * `GrenadeField.throw` could be wrapped because every grenade in the game
   * goes through it. This is the same seam for a blast: an exploding barrel
   * (`Prop.shatter`), a droideka's death (`Enemy.js`) and every structure
   * charge all reach the world through this one method, and a client that
   * never hears it sees a barrel vanish in silence, takes damage from nowhere,
   * and stands on ground with no crater in it while the host's has one.
   *
   * `ghost` is the client's copy and it is a PICTURE, for the reason
   * `_spawnNetNades` states: the host has already billed the damage and it
   * arrives as hp in the next snapshot, so a client that also billed it would
   * kill the same droid twice on its own screen and then be corrected.
   *
   * It is forced on for anything a CLIENT raises locally, too. A client can
   * cut an explosive barrel open itself, and before this it applied a full
   * 55-damage sphere to bodies it does not own — the host disagreed a frame
   * later and the correction looked like a droid teleporting back to its feet.
   * The host is the only node that bills; every other copy is a picture.
   *
   * What a ghost still does: particles, sound, the flash, the screen shake,
   * the crater, the shove on loose physics bodies, and (through Destruction's
   * wrapper) the structural damage — none of which is in the snapshot, and all
   * of which the client must produce for itself or not have at all.
   */
  onExplosion(centre, size = 1, opts = {}) {
    const ghost = !!opts.ghost || this.netMode === 'client';
    if (!ghost && this.netMode === 'host' && this._netBlasts) {
      this._netBlasts.push([r2(centre.x), r2(centre.y), r2(centre.z), r2(size)]);
    }
    this.particles?.explosion(centre, size);
    audio.explosion(centre, size);
    const radius = 5.5 * size, force = 24 * size, damage = 55 * size;
    for (const e of ghost ? [] : this.enemies) {
      if (e.dead) continue;
      const d = e.position.distanceTo(centre);
      if (d > radius) continue;
      const k = 1 - d / radius;
      _v1.subVectors(e.position, centre).setY(0.7).normalize().multiplyScalar(force * k);
      e.applyKnockback(_v1, damage * k, null);
    }
    for (const p of this.players) {
      if (!p.alive) continue;
      const d = p.position.distanceTo(centre);
      if (d > radius) continue;
      const k = 1 - d / radius;
      /* The shove, the shake and the crater are the client's to draw; the
       * damage is the host's to bill and arrives as a `hit`. See the note
       * over this method. */
      if (!ghost) p.damage(damage * 0.4 * k, centre, null, 'explosion');
      _v1.subVectors(p.position, centre).setY(0.6).normalize().multiplyScalar(force * 0.35 * k);
      p.velocity.add(_v1);
      /* `?.` — see the note over `_applyBladeEvent`. A RemoteAvatar is in
       * `world.players` and has no camera, and this is the third site of that
       * same crash the note describes: it throws out of `World.update()` on the
       * HOST, which abandons the frame before the snapshot goes out. Reachable
       * from any blast next to a joining player — a grenade, a wave clear, or
       * the Unstable elite the co-op suite drives, which is where it surfaced
       * the moment the pair harness started building avatars at all. */
      p.camera?.addShake(k);
    }
    for (const b of this.physics.bodies) {
      if (b.invMass === 0) continue;
      const d = b.position.distanceTo(centre);
      if (d > radius) continue;
      const k = 1 - d / radius;
      _v1.subVectors(b.position, centre).setY(0.5).normalize().multiplyScalar(force * k * b.mass * 0.6);
      b.applyImpulse(_v1, b.position);
    }
    if (this.terrain) this.terrain.crater(centre.x, centre.z, 2.6 * size, 0.55 * size);
    this.engine.flash(0.18 * size);
  }

  /* ── frame ───────────────────────────────────────────────────────── */

  setTimeScale(s) { this.targetTimeScale = s; }
  addHitstop(t) { this.hitstop = Math.max(this.hitstop, t); }

  /**
   * IS THIS CLASS OF FEEDBACK TURNED ON?
   *
   * `applyFeelSettings` (ui/Menu.js) hangs the player's answer on
   * `world._feelSettings` and wraps the two funnels that existed when it was
   * written — `addShake` and `addHitstop`. Everything added since needs the
   * same gate and must not need a second copy of the lookup, so it is one
   * predicate and every new effect asks it.
   *
   * The mapping is the honest one rather than the literal one: `shake` means
   * "kinetic feedback the game applies without being asked", which is the
   * screen punch and the pad as much as the camera, and `slowmo` means "the
   * game bending time at me", which is hitstop and kill-time. A world nobody
   * has spoken to answers yes, which is what keeps every check and every
   * headless harness measuring the shipped behaviour.
   */
  feelOn(kind) {
    const s = this._feelSettings;
    return !s || s[kind] !== false;
  }

  /**
   * KILL-TIME — the world holding its breath, and the reason it is not hitstop.
   *
   * Hitstop is a freeze: `update` runs the whole world at 0.06× for 30–120 ms
   * and it exists to make a blow land in the hands. This is the other half of
   * the same sentence — the world *continuing*, at a third of its speed, for
   * long enough to watch a body fall. It rides `targetTimeScale`, which damps
   * at 9 rather than snapping, so the entry and the exit are both ramps.
   *
   * `setTimeScale` had exactly two callers in the whole project before this,
   * both of them `Player.toggleSense`. A held power owns the scale for as long
   * as it is held, so this must never be able to take it back: `_killTime`
   * carries the value it wrote, and the release only restores 1 if nothing else
   * has moved the target in the meantime.
   */
  killTime(scale, seconds) {
    if (!this.feelOn('slowmo')) return false;
    const s = clamp(num(scale, 0.4), 0.05, 1);
    const d = clamp(num(seconds, 0.2), 0.02, 2);
    const k = this._killTime;
    // A dip may only ever slow the world FURTHER than whatever is already
    // commanded. Force Sense at 0.42 is a power the player is paying for, and a
    // kill landing inside it must not speed the world back up.
    const now = this.targetTimeScale;
    if (!k && s >= now) return false;
    // Deeper or longer wins; shallower and shorter may not cut one short.
    if (k && s >= k.scale && d <= k.left) return false;
    // `restore` is what was commanded BEFORE any dip — captured once, so a
    // second kill inside the first does not record the first dip as the state
    // to go back to.
    this._killTime = { scale: Math.min(s, k ? k.scale : s), left: Math.max(d, k ? k.left : d),
      restore: k ? k.restore : now };
    this.setTimeScale(this._killTime.scale);
    return true;
  }


  /**
   * WHAT A KILL FEELS LIKE — the one place, because a kill has one place.
   *
   * `_applyBladeEvent` knew it had killed (`wasAlive && e.dead`) and spent the
   * answer on choosing the string 'kill' over 'cut' for the hitmarker: the
   * hitstop, the shake, the particles and the sound were byte-identical whether
   * the blow took an arm or ended a life. And it could only ever have covered
   * blade kills — a body dropped by lightning, a detonation, a fall or a
   * trooper's rifle raised nothing at all.
   *
   * `Enemy.die` calls `onEnemyKilled` before it does anything else, for every
   * death by every cause, so this is the only site that sees all of them.
   *
   * WEIGHT IS DERIVED FROM THE BODY, not typed per archetype. `A.mass` spans
   * 3 kg (a training remote) to 1400 kg (an acklay) across the roster, and
   * `Math.pow(m/78, 0.32)` maps that onto 0.35…1.85 — a curve rather than a
   * table, so the seven Command units and the four machines added last session
   * are already weighed and the next one will be too. HANDOFF §2.3 is a section
   * about exactly the table this is not.
   *
   * EVERY LINE OF IT IS GATED. A player who has turned the two feel toggles off
   * gets the score, the feed and the notification and nothing that moves the
   * camera, the clock or the pad.
   */
  _killFelt(enemy, source, kind) {
    const A = enemy.A || {};
    const w = clamp(Math.pow(clamp(num(A.mass, 78), 2, 2000) / 78, 0.32), 0.3, 2);
    // A boss is not a heavy trooper. `big`/`boss` add a step the mass curve
    // cannot, because a Jedi Master weighs 78 kg and ending one is an event.
    const rank = A.boss ? 1 : (A.big ? 0.55 : 0);
    const heft = clamp(w * (1 + rank), 0.3, 3);
    const at = enemy.position;
    /**
     * WHOSE KILL, and it decides everything but the sound.
     *
     * A body makes its noise whoever felled it — that is physics, and in
     * Command it is the difference between an army fighting around you and a
     * silent diorama. The CLOCK and the FRAME are not physics: hitstop and
     * kill-time are global, so a friend's kill on the far side of a co-op field
     * freezing your world would be the worst possible reading of "wire it to
     * the player's senses". Only what this machine's player did moves them.
     */
    const mine = source?.isLocal === true;

    /* ── THE BODY'S OWN SOUND. Enemy.die ends on `audio.thud(pos, 1)` — the
     * same 110 Hz for a 3 kg remote and a 1400 kg acklay — and the announcer's
     * death cry goes through a shared once-per-ENEMY_GAP budget, so most of the
     * bodies in a wave fell in silence. `bodyThump` already scales all three of
     * its terms off mass and exists for precisely this; the low sweep over it is
     * the sound of the thing STOPPING, which is what a kill has and a wound
     * does not. */
    if (at) {
      audio.bodyThump(at, clamp(num(A.mass, 78) * 2.2, 60, 2400));
      audio.tone({ freq: 210 / heft, freqEnd: 46 / heft, dur: 0.28 + heft * 0.16,
        gain: 0.10 + heft * 0.06, type: 'triangle', pos: at, prio: PRIO.combat });
      audio.noise({ dur: 0.26 + heft * 0.1, gain: 0.09 + heft * 0.05, type: 'lowpass',
        freq: 1500, freqEnd: 190, q: 0.7, pos: at, pink: true, prio: PRIO.combat });
    }

    /* ── THE FRAME. A wound already flashes; a kill squeezes. The punch is the
     * only new screen effect and it is short by construction (see Engine's
     * damp rate) so twenty of them across a wave read as twenty impacts rather
     * than as a filter. */
    if (mine && this.feelOn('shake')) {
      this.engine?.punch?.(clamp(0.20 + heft * 0.22, 0.2, 0.85));
      source.camera?.addShake?.(clamp(0.10 + heft * 0.18, 0.1, 0.6));
      this.engine?.rumble?.(clamp(0.28 + heft * 0.30, 0.2, 1),
        clamp(0.14 + heft * 0.12, 0.1, 0.6), Math.round(60 + heft * 90));
    }
    // A boss going down lights the room whoever landed the blow.
    if (rank > 0) this.engine?.flash?.(0.06 + rank * 0.09);

    /* ── THE CLOCK. Not on every kill — a dip that fires twenty times a wave is
     * a frame-rate problem, not a moment. It is reserved for the two kills that
     * are punctuation: anything big or boss, and the body that empties the
     * side it was fighting for. */
    if (mine) {
      const lastOne = !this.enemies?.some(e => e !== enemy && !e.dead && e.team === enemy.team);
      if (rank > 0) {
        this.addHitstop(0.10 + rank * 0.06);
        this.killTime(rank >= 1 ? 0.32 : 0.45, 0.55 + rank * 0.35);
      } else {
        // An ordinary kill still lands harder in the hands than a wound: the
        // cut that wounded gave 0.03–0.055 and this is on top of it, by
        // Math.max inside addHitstop.
        this.addHitstop(0.055 + heft * 0.03);
        if (lastOne) this.killTime(0.36, 0.6);
      }
    }

    /* ── THE FIELD. Something visibly leaves the body: a burst at the chest in
     * the killer's own blade colour where there is one, so the kill is drawn in
     * the same ink as the blow that caused it. */
    if (at && this.particles) {
      const col = kind === 'cut' && source?.saber ? source.saber.color.getHex() : 0xffb060;
      this.particles.sparkBurst(_v3.copy(at).setY(at.y + 0.9), null,
        Math.round(10 + heft * 12), { speed: 5 + heft * 4, color: col });
    }
  }

  /** Anything a lesson might be watching for. Free outside the dojo. */
  report(ev) { if (this.director && this.director.report) this.director.report(ev); }

  /**
   * THE BANNER, AND WHICH OF THREE IT IS.
   *
   * `kind` was not here, and everything the game says used one voice: a
   * greeting, a boss arriving and "CHECK YOUR FIRE — CT-2042 IS ONE OF YOURS"
   * were the same size, the same weight, the same colour and the same place.
   * Two outside reviewers found that independently and both drew the same
   * conclusion, which is the one that matters: a player who cannot tell a
   * pleasantry from an alarm learns to read neither.
   *
   *   'flavour'  where you are, what wave it is, a lesson learned. Out of the
   *              sightline, small, and it may be missed with nothing lost.
   *   'threat'   something on the field is now hurting you or your line.
   *   'alarm'    YOU are doing the damage. The one tier that earns the middle
   *              of the screen.
   *
   * Absent, it is `flavour` — because most of these are, and because a caller
   * that has not thought about it is not making a claim on the player's
   * attention. */
  notify(title, sub, kind = 'flavour') {
    this.onNotify?.(title, sub, kind);
  }

  update(rawDt, input) {
    if (!this.running || this.paused) return;
    /**
     * THE GROUND CHANGES BETWEEN ENGAGEMENTS — here, at the top of a frame, and
     * not where the decision was made.
     *
     * `_skirmishCleared` runs inside `WaveDirector.update`, three lines after
     * the clear branch, and `unload()` disposes the enemies that loop is
     * standing in and the player whose `_move` is about to run. Deferring by
     * one frame is the same shape `_bossFrame` and the kill-time release use,
     * and for the same reason: the world's own clock is the only safe place to
     * do something to the world.
     *
     * `onRotate` gets first refusal so a front end can put its progress bar
     * over the rebuild (`rotateToAsync`), and `rotating` holds the frame loop
     * off until it says it is done. Without a front end this takes the
     * synchronous door, which is the same fallback `CommandDirector._areaClear`
     * takes when no muster screen is wired: a mode that cannot be played
     * without a UI that does not exist yet is a mode that does not exist.
     */
    if (this.rotating) return;
    /* THE BATTLE OPENS ITSELF IF NOBODY OPENED IT. See `beginSkirmish` — the
     * plan is built at load and the picks are applied here, so the mode is
     * playable through a front end that knows nothing about it. Guarded on a
     * body because `deploy` puts the line down around the commander. */
    /* …AND NOT ON A CLIENT, which is the guard `director.update` and main.js's
     * own call sites already carry. A client rebuilt by the host's `start` ran
     * `beginCampaign()` here, which builds a FRESH campaign at index 0, sees
     * that mission 1's ground is not the one it is standing on, and sets
     * `_groundPending` — which the block below then acts on. Measured: a client
     * correctly rotated to the host's mission-2 ground walked itself back to
     * mission 1's in a single frame, silently, because its own `_afterRotate`
     * broadcast is host-gated. That is the exact symptom the rotation announce
     * was written to remove, arriving by the other door. */
    /**
     * …AND NOT WHILE A JOURNEY IS ALREADY CARRYING THE ANSWER. THIS IS THE
     * CAMPAIGN FREEZE, and it is a two-line loop between three correct pieces.
     *
     * The player: "in campaign mode the game completely freezes when you finish
     * the first wave, never unfreezes."  Reproduced in
     * `tools/_stall.mjs --mode campaign`, which is the first thing in the tree
     * to drive a campaign WITHOUT `instantSpawn` — every campaign check sets
     * that flag, so the transition the player actually plays had never run
     * under a harness at all.
     *
     *   1. mission 1 ends → `_advanceMission` bumps the index, sets
     *      `this.skirmish = null` and asks for mission 2's ground.
     *   2. `_groundPending` is taken below and handed to the extraction, which
     *      begins its five-second aftermath.
     *   3. NEXT FRAME, `skirmish` is null, so this block re-opens the campaign,
     *      which sees mission 2's ground is not the one underfoot and sets
     *      `_groundPending` AGAIN.
     *   4. The block below finds it, calls `extraction.begin`, which answers
     *      "I already own this" — and `return`s.
     *
     * That `return` is above `extraction.update`, so the director is never
     * stepped: `phase` stays `aftermath` and `t` never advances. The whole game
     * is one frame wide from then on. Measured: 40 s of driven play, `phase`
     * unchanged, wave 0, nothing else in the world moving.
     *
     * A journey in flight IS the pending ground change, so neither door may be
     * opened while one is running. Both guards are here rather than inside
     * `beginCampaign`, because the same shape would bite `beginSkirmish` the
     * moment a mode rotates on it, and because a re-entrancy bug belongs next
     * to the `return` that makes it fatal.
     */
    if (this.netMode !== 'client' && MODES[this.settings?.mode]?.battles
        && !this.skirmish?.started && this.player
        && !this._groundPending && !this.extraction?.active && !this.rotating) {
      if (this.settings.mode === 'campaign') this.beginCampaign();
      else this.beginSkirmish();
    }
    if (this._groundPending) {
      const key = this._groundPending;
      this._groundPending = null;
      /* THE RETURN VALUE IS THE CONTRACT. A front end that wants a progress bar
       * over the rebuild answers by calling `rotateToAsync`, which raises
       * `rotating` before its first await and returns a promise — truthy, so
       * this leaves it alone. Anything falsy, including no handler at all,
       * means nobody took it and the synchronous door is used, because a battle
       * that silently stops changing ground is worse than one that hitches. */
      /**
       * …AND THE GROUND CHANGE IS NOW A JOURNEY, WHICH IS THE FIRST DOOR.
       *
       * The player, on what used to happen right here: "right now you just
       * teleport and it's really disorientating … you should never just
       * teleport." `ExtractionDirector.begin` takes the change if it can fly
       * it — five seconds of aftermath, a transport you walk to, a bay you
       * stand in and a flight with the rebuild hidden inside it — and the
       * rotate below happens INSIDE that flight, at altitude, behind cloud.
       *
       * It DECLINES on a client, with no living player, with no terrain, and
       * whenever `settings.instantSpawn` says this player wants things to
       * simply appear. Every one of those falls through to the two lines that
       * were here before, which is the same shape `ArrivalDirector.request`
       * uses: a caller that cannot be choreographed still has to work.
       */
      if (this.extraction?.begin(key)) return;
      if (!this.onRotate?.(key)) this.rotateTo(key);
      return;
    }

    // hitstop bites first — it is what makes a perfect return land in the hands
    let dt = rawDt;
    if (this.hitstop > 0) {
      this.hitstop -= rawDt;
      dt = rawDt * 0.06;
    }
    // ── Focus. Two layers, both of which slow the WORLD: a free shallow dip
    // when a bolt is genuinely about to land, and a deep, Force-hungry one the
    // player holds deliberately. The player is compensated back up afterwards,
    // so what the system actually produces is not bullet time — it is you being
    // fast while everything else is not.
    const P = this.player;
    if (P && P.alive && P.isLocal) {
      const threats = this.bolts ? this.bolts.threatsNear(P.chest, this.focus.passiveRange) : null;
      const hostile = threats ? threats.filter(t => t.bolt.team !== P.team) : null;
      /* UNLIMITED FOCUS is a bill that is not sent, not a different system.
       * The world still runs at heldScale and the player is still compensated
       * back to playerScale, so what the player learns inside it is the same
       * thing they will use when they turn it off — which is the whole reason
       * to spell it this way rather than by handing the FocusSystem a zero
       * drain, which would also stop `minToEnter` gating and let it flicker on
       * at an empty bar. */
      const free = !!this.settings.unlimitedFocus;
      const spent = this.focus.update(rawDt, input?.act('focus'),
        free ? Math.max(P.force, this.focus.minToEnter + 1) : P.force, hostile);
      if (spent && !free) P.force = Math.max(0, P.force - spent);
    } else this.focus.reset();

    /**
     * KILL-TIME EXPIRING, on the RAW clock and inline.
     *
     * Raw because a dip that measured itself in dilated seconds would run for
     * 1/0.32 as long as it asked for, and a dip deep enough to be worth having
     * would never end. Inline rather than a method because several checks drive
     * `World.prototype.update` against a hand-built stub world that lists the
     * methods it borrows — a new call out of the frame loop breaks every one of
     * them with `is not a function`, and six lines is not worth that.
     *
     * The scale only goes back if it is still OURS: Force Sense pressed during
     * a dip owns the clock from that moment, and the dip expiring underneath it
     * must not cancel a power the player is holding.
     */
    const kt = this._killTime;
    if (kt && (kt.left -= rawDt) <= 0) {
      this._killTime = null;
      if (Math.abs(this.targetTimeScale - kt.scale) < 1e-6) this.setTimeScale(kt.restore);
    }
    // …and the boss entrance's letterbox, on the same clock and inline for the
    // same reason. A `setTimeout` would release the bars behind a pause card.
    if (this._bossFrame > 0 && (this._bossFrame -= rawDt) <= 0) {
      this._bossFrame = 0;
      this.engine?.setBars?.(0);
    }
    this.timeScale = damp(this.timeScale, this.targetTimeScale, 9, rawDt);
    /**
     * THE MIX HEARS THE CLOCK. The dilation the player is HOLDING — Sense at
     * 0.42×, a full Focus hold at 0.18×, kill-time at 0.32–0.45 — and
     * deliberately not the hitstop, which is a 30–120 ms freeze rather than a
     * slowdown and reads as a dropout if the whole mix drops with it.
     *
     * Before this line, `grep focus src/engine/Audio.js` returned nothing: the
     * signature power of the game slowed the world with no acoustic response
     * whatsoever.
     */
    audio.setTimeScale?.(this.timeScale * this.focus.scale);
    dt *= this.timeScale * this.focus.scale;
    dt = Math.min(dt, 1 / 24);
    this.time += dt;
    this.engine.setFocus?.(this.focus.intensity());

    const camera = this.engine.camera;
    const ctx = {
      input, dt, time: this.time, camera,
      physics: this.physics, terrain: this.terrain, particles: this.particles,
      bolts: this.bolts, enemies: this.enemies, players: this.players,
      /* Who may be swinging at a given body at once — see `src/game/Tokens.js`.
       * `world` rides along because `capacityFor` reads the roster around the
       * target, and a body's own `this.world` is the same object. */
      tokens: this.tokens, world: this,
      groundColor: this.groundColor,
      /**
       * WHAT THE PLAYER'S FORCE POWERS MAY REACH — player note #29, in one field.
       *
       * "your allies should be as real as the enemies like no difference — you
       * can do damage to them and throw them and manipulate them so you need to
       * be careful not to hurt them … but like obviously the force blaster-stop
       * thing shouldn't affect your allies' blasters."
       *
       * `Player._foes` — the list EVERY force power in this game iterates — reads
       * `ctx.rules ?? this.world.rules`. The first half of that expression had no
       * writer anywhere in the tree until this line. Handing the POWERS a
       * friendly-fire rule while the WORLD keeps co-op's is not a fudge; it is
       * exactly the distinction the note draws, and it is why every clause of it
       * falls out of one field:
       *
       *   push, pull, grip, lightning, compel and rend reach your own troops,
       *     because a Force power does not check a uniform;
       *   an ally's BLASTER does not reach you or another ally, because
       *     `_boltHitTest` and `bladeTargets` both consult `world.rules`, which
       *     is untouched;
       *   the BOLT-STOP does not freeze your army's fire, because
       *     `Player._stasisCapture` skips `bolt.team === this.team` and your
       *     troops are on your team — a line written years before this mode and
       *     correct for it by construction.
       *
       * `undefined` in every other mode, so `_foes` falls through to
       * `world.rules` exactly as it always did.
       *
       * …AND `undefined` IN A MEETING TOO, which is the mode-wide freeze
       * retiring. The frozen object exists to say "friendly fire is on for
       * powers even though the world's rules say it is off"; in versus the
       * world's rules are `pvpRules({pvp: true})` and already say so, so
       * overriding them here would be a second, quieter answer to a question
       * that now has one — and it would say `pvp: false` about a session whose
       * whole content is another player.
       */
      rules: this.command && !this.command.versus ? COMMAND_POWER_RULES : undefined,
      pickTarget: (e) => this.pickTarget(e),
      pickSpawn: (t) => this.pickSpawn(t),
      spawnEnemy: (t, p) => this.spawnEnemy(t, p),
    };
    /* THE SAME CONTEXT, REACHABLE FROM LATER IN THE FRAME. `grenades.update`
     * runs with the particles and the debris — after the bodies, because a
     * blast has to land on where they ARE — and it needs the terrain and the
     * enemy list this object already carries. Kept as a field rather than
     * rebuilt, because two ctx objects in one frame is two answers to "who is
     * on the field". */
    this._frameCtx = ctx;

    /**
     * THE BODY BROAD PHASE, REBUILT — here, and not later.
     *
     * Everything that asks "what is nearest" runs inside the enemy loop below,
     * so the index has to be built before the first body is stepped. It is one
     * linear pass over `enemies` and it replaces two O(bodies²) sweeps; see
     * src/game/ArmyIndex.js for the bound that makes the answer exact and for
     * the frame of staleness this ordering buys.
     */
    this.armyIndex.sync(this.enemies);
    /**
     * WHO IS STANDING ON WHAT — before the bodies are stepped, because the
     * quorum reads it.
     *
     * `CommandDirector.lineGathered` asks `objectives.crewIds()` for the men who
     * are on a gun and therefore not with the line (PLAN.md §4.2's welding
     * clause). That question is asked inside the army's own update, which runs
     * below this line, so the set has to be current before it does — a frame of
     * lag here is a frame in which a squad that just took a battery still counts
     * toward the advance, which is the one thing this must not do.
     */
    this.objectives?.update(dt, ctx);
    /* The standing order, its reading and its shells. After the objectives
     * because a battery that changed hands this frame is what asks for the
     * other side's barrage, and before the bodies because the shells that land
     * this frame have to be resolved against the positions the reading was
     * taken from. */
    this.fireMissions?.update(dt, ctx);
    /* AND THE ONE YOU ARE STANDING OVER SAYS WHO HE WAS, once ever. The field
     * owns the "once" (`seen` is on the record, so it survives a ground
     * change); this owns the words, because `notify` is the World's door. */
    const grave = this.graves?.update(dt, this.player);
    if (grave) {
      this.notify(`${grave.rank ? `${grave.rank} ` : ''}${grave.name}`.toUpperCase(),
        GraveField.epitaph(grave));
    }

    /**
     * BEFORE EVERYTHING, because a passenger's seat has to be written before
     * the passenger is stepped.
     *
     * `ExtractionDirector` moves the transport and then writes every riding
     * body's position from the ship's new transform. Run with the props, one
     * frame later, it would place the bodies where the ship WAS — 20 cm of
     * slide at cruise, once per frame, which is the whole difference between
     * standing in a bay and being dragged behind one. It is also the only
     * position in the order where the commander the rotate has just respawned
     * can be put back aboard before their own `update` walks them off a cliff
     * on the new ground.
     */
    this.extraction?.update(dt, ctx);
    this.tokens.update(dt);
    /* Every living body that is not riding, plus the players. Rewritten whole
     * each frame — see the note on `update`. */
    if (this.contacts && camera) {
      _contactList.length = 0;
      for (const e of this.enemies) if (!e.dead) _contactList.push(e);
      for (const p of this.players) if (p && p.alive !== false) _contactList.push(p);
      this.contacts.update(_contactList, camera, this.terrain,
        this.engine?.renderer?.domElement?.height || 1080);
    }
    this._withdrawTick(dt, ctx);

    // 0 — the catch window, BEFORE the players read input. That order is the
    // feature: control.catchHold has to be true when applyInput runs or the
    // camera does not come back until the frame after the catch.
    this._updateCatch(dt);

    // 1 — players. The local player gets time back that Focus took away; that
    // asymmetry between the player's clock and the world's IS the ability.
    for (const p of this.players) {
      if (p.isLocal && this.focus.playerCompensation > 1.0001) {
        p.update(Math.min(dt * this.focus.playerCompensation, 1 / 24), { ...ctx, dt: dt * this.focus.playerCompensation });
      } else p.update(dt, ctx);
    }

    /**
     * 1b — THE HORDE'S NERVE. FLAGSHIP §7's BREAK verb, per second.
     *
     * BEFORE the bodies think, so a body that broke this frame gives ground on
     * this frame rather than on the next one — the same ordering argument
     * `CommandDirector.rallyNear` makes about its own rally ("a man who was
     * running stops running THIS frame rather than at the top of the next").
     *
     * Once for the whole field rather than once per body: the expensive half is
     * the list of lit blades and there are at most four of them. Bodies with a
     * roster record are skipped inside `nerveTick`, because `CommandDirector.
     * _morale` runs its own per-second pass over exactly those.
     *
     * ON THE HOST ONLY. A client's bodies are placed from the wire and their
     * brains do not run (`netDriven`), so a second nerve drifting locally would
     * be a number the two machines disagree about with nothing to reconcile it.
     */
    if (this.netMode !== 'client') {
      this._nerveBlades = this._nerveBlades || [];
      this._nerveBlades.length = 0;
      for (const b of this._bladeEntries()) {
        if (!b.saber || b.saber.ignition < 0.6) continue;
        const owner = b.owner;
        if (!owner || owner.dead || owner.alive === false) continue;
        this._nerveBlades.push({ position: owner.position, team: asTeam(owner.team) });
      }
      nerveTick(this.enemies, this._nerveBlades, dt);
    }

    // 2 — enemies. On a client the body is placed from the wire FIRST, so the
    // pose that follows is solved against a velocity that is the host's own.
    if (this.netMode === 'client') this._stepNetEnemies(dt, ctx);
    for (let i = this.enemies.length - 1; i >= 0; i--) {
      const e = this.enemies[i];
      if (!e.update(dt, ctx)) { e.dispose(); this.enemies.splice(i, 1); }
    }

    /* …and ONE cohort re-reads ONE slot of its gait palette. Here rather than
     * inside the loop above: every body has just posed and placed itself, so
     * this is the freshest rig in the frame, and the cost is the same one
     * capture whether the field holds forty bodies or four hundred — which is
     * the property the whole rung is. See src/game/Cohorts.js `step`. */
    this.cohorts?.step();

    // …and the hilts lying about age, so one just dropped cannot be picked
    // straight back up before the player has seen it leave their hand.
    ageDropped(this, dt);

    /* …and the dead, whose cost this is the only thing that bounds. AFTER the
     * enemy step, because that is where a ragdoll's bodies are integrated and
     * `Corpses` decides to settle one on how fast it is still moving — asking
     * before the step reads last frame's velocity, which on the frame a body
     * lands is exactly the frame it would wrongly look still. */
    this.corpses?.update(dt);

    // 3 — blades against everything
    this._resolveBlades(dt);

    // 4 — bolts
    this.bolts.update(dt, {
      blades: this._bladeEntries(),
      hitTest: (b, from, to) => this._boltHitTest(b, from, to),
    });

    // 5 — physics
    this.physics.step(dt);

    // 6 — bookkeeping
    for (const p of this.props) p.update(dt);
    for (const d of this.doors) d.update(dt);
    for (let i = this.debris.length - 1; i >= 0; i--) {
      const d = this.debris[i];
      if (d.gone) { this.debris.splice(i, 1); continue; }
      d.mesh.position.copy(d.body.position);
      d.mesh.quaternion.copy(d.body.quaternion);
      d.age += dt;
      if (d.age > d.life) {
        const k = clamp((d.age - d.life) / 2.2, 0, 1);
        d.mesh.scale.setScalar(Math.max(0.001, 1 - k));
        if (k >= 1) { this.physics.remove(d.body); this.scene.remove(d.mesh); d.mesh.geometry?.dispose?.(); this.debris.splice(i, 1); }
      }
    }
    updateCauterisation(dt);
    this.particles.update(dt);
    this.lightning?.update(dt);
    this.grenades?.update(dt, this._frameCtx ?? this);
    this.support?.update(dt);
    this.terrain.flush();

    // 7 — scenery
    const focus = this.player ? this.player.position : _v1.set(0, 0, 0);
    if (this.grass) {
      const pushers = [];
      for (const p of this.players) pushers.push({ x: p.position.x, y: p.position.y, z: p.position.z, w: 1.4 });
      for (const e of this.enemies) {
        if (e.dead || pushers.length >= 8) continue;
        if (e.position.distanceToSquared(focus) > 900) continue;
        pushers.push({ x: e.position.x, y: e.position.y, z: e.position.z, w: 1.2 * e.A.scale });
      }
      this.grass.update(dt, focus, pushers, this.engine.sun.color);
    }
    this.water?.update(dt, this.engine.sunDir, this.engine.hemi.color);
    this.atmosphere?.update(dt, focus);

    // 8 — director (the host owns the horde; clients receive it)
    // …but not once the run is over: a director that keeps spawning at a corpse
    // is the reason `running` used to be switched off here. See onPlayerDeath.
    /* …AND NOT WHILE THE ARMY IS BEING FLOWN OFF THE GROUND — but the LANDING
     * is not that, and for as long as this said `!extraction.active` it was
     * treated as if it were. `active` is `phase !== 'done'` and `beginInsertion`
     * is the last line of deploy, so every fighting mode opened with 28 seconds
     * of empty field under a HUD reading "50 HOSTILES LEFT".
     *
     * `holdsHorde` is that gate stated by PHASE — the whole outbound leg, plus
     * the orbit and the entry burn — and its own note gives the four things it
     * has always protected. The one number it is handed is the LEVEL's, because
     * `spawnRadius` is the level's: everything that sites a body measures from
     * the commander, so the horde is not called until the ship's ground track
     * is inside the ring the level itself spawns at. See that method. */
    if (this.netMode !== 'client' && !this.over
      && !this.extraction?.holdsHorde(this.level?.spawnRadius?.[1])) this.director.update(dt, ctx);
    /* The meeting's clock, and it is outside the director because it is not the
     * director's: `DuelMatch` is driven by facts about the WHOLE field — who
     * has anybody left standing — and the host owns it whether or not there is
     * a wave. See _matchTick. */
    if (this.match) this._matchTick(dt);
    if (this.netMode) {
      // A remote player's death arrives as a field in a packet and raises
      // nothing, so the wipe condition has to be re-read rather than waited on.
      this._checkWipe();
      /* OUTSIDE `_netTick`, and deliberately: that method returns on the first
       * line when the connection is gone, and a body a peer was holding when
       * the session ended would then stay held for the rest of the run — out of
       * its own brain, hanging in the air, with nothing left that could ever
       * say otherwise. The lease has to outlive the wire it came from. */
      this._netGripLeases();
      this._netTick(rawDt);
    }
    // Solo, the aura still runs — it is what keeps the holder's own half — but
    // nothing is going to consume what it offered outbound, so it is dropped on
    // the frame it was written rather than accumulated into a number that grows
    // for the whole session and is never read.
    else { this._bondOut = null; this._bondHealOut = 0; this._bondPeers = 0; }

    // 9 — intensity drives the score and the mix
    const alive = this.enemies.filter(e => !e.dead).length;
    const near = this.enemies.filter(e => !e.dead && e.position.distanceToSquared(focus) < 400).length;
    this.combatIntensity = damp(this.combatIntensity, clamp(near / 9 + alive / 26, 0, 1), 1.4, rawDt);
    // …and the WEATHER drives the room. Eight levels ship a squall that Scenery
    // draws — fog, sun, hemi fill and a 2.4× particle wind, all off this one
    // number — and the audio wind used to sit at whatever setAmbience was
    // handed at load, so a 44-second kamino white-out crossed the level in
    // silence. It is the same singleton Scenery reads; see AudioEngine._bed.
    audio.updateScore(rawDt, this.combatIntensity, weather.intensity);
    audio.updateListener(camera);

    this.engine.fitShadows(focus);
    this.engine.setRadial(this.player?.senseActive ? 0.35 : 0);
  }

  _bladeEntries() {
    const out = [];
    for (const p of this.players) {
      if (!p.alive || p.saber.ignition <= 0.5) continue;
      // `guard` is the auto-guard cone a successful deflect opened. Null when
      // shut, which is most of the time — it is 0.40 s off a manual catch.
      // `asTeam(p.team)` and not the literal 0: `Bolts.update` skips the guard
      // on `b.team === entry.team`, and in PvP a duellist is on side 2, 3 or 4.
      // Stamping every player's blade with the party's number told that test
      // the wrong side for three of the four. Same rule as `_onBoltDeflect`.
      out.push({ saber: p.saber, owner: p, team: asTeam(p.team), guard: p.boltCatch ? p.boltCatch.guard() : null,
        screen: this._screenFor(p) });
    }
    /* NO `screen` ON AN ENEMY BLADE, and it is a rule rather than an omission.
     * `_onBoltDeflect`'s enemy branch bats a bolt away with no grading and no
     * bill at all — there is no bar on that body to spend — so a screen there
     * would be exactly the free damage-reduction aura `SCREEN`'s own note says
     * the mechanic must not be, handed to every duellist the horde fields. The
     * day an enemy Jedi is meant to shield ITS line, it needs a pool to pay
     * from first. */
    for (const e of this.enemies) if (!e.dead && e.saber && e.saber.ignition > 0.5) out.push({ saber: e.saber, owner: e, team: asTeam(e.team) });
    return out;
  }

  /**
   * THE GROUND THIS JEDI IS COVERING FOR HIS OWN MEN, or null.
   *
   * FLAGSHIP §6's suppression aimed at the man beside you — the whole argument
   * is over `SCREEN` in Combat.js. This is where the four gates are assembled;
   * `Bolts.screenIntercept` enforces three of them per bolt and this one owns
   * the fourth, which is the bar:
   *
   *   `screenReach(p.force)` IS THE REACH. The price is Force by the metre, so
   *   the radius a player is granted is the price solved the other way — and
   *   that means the screen narrows as the bar empties and widens as it comes
   *   back, with no second rule to keep in step with the first and nothing new
   *   on the HUD. An empty bar returns 0 and this returns null.
   *
   * `bladeHeld` and not `control.guard.active`: a raised zone only exists under
   * the `directional` scheme, and a mechanic that vanished for a player who
   * picked one of the continuous-aim schemes would be a feature with a
   * settings-menu switch nobody was told about. Holding the blade is what
   * "I am guarding" means in every scheme.
   *
   * The body list is rebuilt in place each frame rather than allocated: this
   * runs twice a frame per player (here and in the nerve pass), and the fan in
   * `_boltHitTest` is the one place in this file where allocation per frame has
   * already been measured to cost.
   */
  _screenFor(p) {
    if (!p.control || !p.control.bladeHeld) return null;
    const reach = screenReach(p.force);
    if (!(reach > 0.5)) return null;
    const side = asTeam(p.team);
    const pool = this._screenPool || (this._screenPool = []);
    const desc = this._screenDesc || (this._screenDesc = {
      origin: new THREE.Vector3(), axis: new THREE.Vector3(), reach: 0,
      sector: GUARD.reach, margin: SCREEN.margin, bodies: [],
      /**
       * ── AND THE BONE TEST, WHICH IS WHAT MAKES IT A SCREEN ──────────────
       *
       * The bound sphere in `screenIntercept` is a reject and nothing more.
       * Measured on a real Command battle with the sphere as the whole test:
       * **128 bolts screened for 8 fewer arriving in the rank** — the bound
       * wraps every capsule a body presents, so it stands about a metre off
       * the chest and sixteen near misses were answered for every shot that
       * was going to land. That is precisely the aura `SCREEN`'s own note says
       * the mechanic must not be, and it had it.
       *
       * So the question is put to the body: the same `capsules()` fan
       * `_boltHitTest` resolves a bolt through, against a segment run forward
       * along the bolt's own line as far as the candidate can be. One reader
       * for "would this bolt have hit that man", rather than a second, looser
       * model of it standing next to the real one (HANDOFF §2.4).
       *
       * Cheap because of where it sits: only bolts that already crossed the
       * reach, arrived inside the arc and cleared a body's bound get here, and
       * `capsules()` is the same call the bolt is about to make anyway if the
       * screen lets it through.
       */
      hits: (rec, from, dir, len) => {
        const e = rec.e;
        if (!e || e.dead) return false;
        _screenEnd.copy(from).addScaledVector(dir, len);
        for (const c of e.capsules()) {
          if (segmentNear(from, _screenEnd, c.p0, c.p1, c.r)) return true;
        }
        return false;
      },
    });
    desc.origin.copy(p.chest);
    desc.axis.copy(p.aimDir);
    desc.reach = reach;
    desc.bodies.length = 0;
    const r2 = reach * reach;
    let n = 0;
    for (const e of this.enemies) {
      if (e.dead || asTeam(e.team) !== side) continue;
      const dx = e.position.x - desc.origin.x, dz = e.position.z - desc.origin.z;
      if (dx * dx + dz * dz > r2) continue;
      /* THE SAME SPHERE `_boltHitTest` REJECTS ON. `boltBound` wraps what the
       * body actually presents — the dwarf spider's legs stand its capsules
       * 2.7 m up and well outside its hull radius — so a screen built off
       * `radius` and `chestY` would have been blind to exactly the bodies that
       * note was written about. A ragdoll answers null and is skipped: a man
       * already on the ground is not one you are covering. */
      const b = boltBound(e);
      if (!b) continue;
      const rec = pool[n] || (pool[n] = { x: 0, y: 0, z: 0, r: 0, e: null });
      rec.x = e.position.x; rec.y = e.position.y + b.y; rec.z = e.position.z; rec.r = b.r; rec.e = e;
      desc.bodies.push(rec);
      n++;
    }
    return desc.bodies.length ? desc : null;
  }

  /* ── catch and throw ─────────────────────────────────────────────── */

  /**
   * Tick every open catch window: crackle the held bolts, hand the controller
   * the flag that gives the camera back, and fire the throw when the player
   * lets go or the window runs out.
   */
  _updateCatch(dt) {
    for (const p of this.players) {
      const cw = p.boltCatch;
      if (!cw) continue;

      // A bolt cannot stay caught on a blade that went out, and a dead player
      // is not holding anything.
      if (cw.open && (!p.alive || p.saber.ignition < 0.4)) {
        for (const h of cw.held) { h.bolt.held = null; h.bolt.active = false; }
        cw.clear();
      }

      const fire = cw.update(dt, p.control ? p.control.bladeHeld : false);
      if (p.control) p.control.catchHold = cw.t;

      if (cw.open && this.particles) {
        // Crackle. Throttled per WINDOW rather than per bolt, because three
        // caught at once is exactly when the particle pool can least afford it.
        // 30 Hz is the slowest rate that still reads as arcing rather than as
        // a blinking light.
        cw.vfx -= dt;
        if (cw.vfx <= 0) {
          cw.vfx = 0.033;
          for (const h of cw.held) {
            this.particles.sparkBurst(h.bolt.pos, null, 3, { speed: 4.5, embers: false, color: 0xfff2c0 });
            this.particles.plasma.spawn(h.bolt.pos, _v1.set(0, 0, 0), {
              life: 0.07, size: 0.15, drag: 1, gravity: 0,
              color: h.bolt.color.getHex(), alpha: 0.85, hdr: 3.2,
            });
          }
        }
      }
      if (fire) this._throwCaught(p);
    }
  }

  /**
   * Let go of everything on the blade. This is where the aim finally gets read
   * — not at the moment of contact — which is the entire point of the window:
   * the blade decided IF, and the camera you have had back for up to 250 ms
   * decides WHERE.
   */
  _throwCaught(player) {
    const cw = player.boltCatch;
    // clear() unconditionally: it is what resets `age`, and a window left with a
    // spent age can never open wide again.
    if (!cw.held.length) { cw.clear(); return; }
    /**
     * WHO A RETURNED BOLT MAY BE AIMED AT — THE SAME GATE THE BLADE ASKS.
     *
     * This was `this.enemies.filter(e => !e.dead)`, here and again in
     * `_onBoltDeflect`, and in Command mode YOUR OWN TROOPERS stand in
     * `world.enemies` on the party's team. Measured with one ally at 14 m and
     * one foe 9 m off-axis: the raw list offered 2 candidates where `hostileTo`
     * offers 1, `pickReturnTarget` chose THE ALLY, and `gradeCaught` paid a
     * PERFECT RETURN for it — 2.5× damage, 160 score, a hitstop and a screen
     * flash — after which the bolt passed through them harmlessly. A reward for
     * nothing, and with `friendlyFire` on the bolt lands.
     *
     * `hostileTo` already drops the dead, so it REPLACES the filter rather than
     * joining it, and it is the gate `bladeTargets` and `_boltHitTest` consult:
     * an aim assist that can lock onto someone the damage rules will refuse is
     * worse than no assist. Called at both sites rather than wrapped in a
     * method of this class, because three suites drive these two methods
     * against a hand-built stub world that lists the members it borrows.
     */
    const candidates = hostileTo(player, this.enemies, this.rules);
    let best = -1, bestPoint = null;
    const n = cw.held.length;

    for (const h of cw.held) {
      const bolt = h.bolt;
      if (!bolt.active) continue;
      const res = gradeCaught(h.snap, {
        /**
         * FROM THE BODY, NOT THE LENS — and this one line was two complaints.
         *
         * "as the game progresses… my cursor from my perspective is now way to
         * my left… makes aiming really difficult" and "it's easier to block
         * bolts and send bolts back to where you want when the deflection
         * aiming is set to physical rather than the standard reticle… I'm
         * missing enemies to the left and right more often since they're
         * usually strafing."
         *
         * This was `player.camera.pos`. In third person that is 3.05 m behind
         * the player and 0.46 m to ONE SHOULDER — and `CameraRig._resolveShoulder`
         * swaps which shoulder on a wall raycast, silently, mid-fight. So the
         * cone `pickReturnTarget` searches was hung off the lens, and measured
         * with two enemies mirrored exactly about the sightline at ±1, 2, 3, 5
         * and 8 m, the answer was the camera's and not the player's: on the
         * right shoulder it returned the bolt at the RIGHT one every time, on
         * the left shoulder at the LEFT one every time. Walk past a wall and
         * your aim changes sides without you touching anything.
         *
         * It also explains why `physical` felt better: that model never asks
         * this question, so it never inherits the parallax.
         *
         * `aimPoint()` is the player's chest — the anchor the rest of the game
         * already aims from. The DIRECTION stays the camera's, because that is
         * what the reticle means; only the origin comes back to the body.
         */
        aimOrigin: player.aimPoint(_aimFrom),
        aimDir: player.aimDir,
        candidates,
        flow: player.flow,
        returnCone: player.boonMods.returnCone,
        aimMode: this.settings.deflectAim || 'reticle',
        caught: true,
      });
      const from = bolt.pos.clone();
      this.bolts.release(bolt, res.dir, bolt.speed * (res.grade >= GRADE.RETURN ? 1.25 : 1));
      this._creditDeflect(player, bolt, res, from, h.snap);
      if (res.grade > best) { best = res.grade; bestPoint = from; }
    }
    cw.clear();

    // One piece of feedback for the whole throw, not one per bolt: a flurry of
    // three that all go back should read as one act, because it was one.
    if (bestPoint) {
      audio.deflect(bestPoint, best);
      this.onDeflectFeedback?.(best, bestPoint, n > 1 ? `${n} bolts sent back` : DEFLECT_WHY[best]);
      if (n > 1) this.notifyFloating(bestPoint, `${n}× ${GRADE_NAME[best]}`, '#ffe9a0');
      else if (best >= GRADE.RETURN) this.notifyFloating(bestPoint, GRADE_NAME[best], '#a8f0ff');
      if (best === GRADE.PERFECT) { this.addHitstop(0.07); this.engine.flash(0.09); }
    }
  }

  /** Score, flow, strain and sparks for one bolt that has just left the blade. */
  _creditDeflect(owner, bolt, res, point, snap = null) {
    /**
     * REMEMBER THE BASE, CAP THE PRODUCT.
     *
     * This was `bolt.damage *= res.damageMul * deflectDamage` and nothing ever
     * put it back. A bolt is a pooled object that survives every exchange, and
     * the enemy branch of `_onBoltDeflect` hands it straight back — so one
     * bolt volleyed between a player and a duellist went
     * 11.00 → 16.50 → 41.25 → … → 2175.29 over eight exchanges, 198× its
     * muzzle damage, while `bolt.life` was pushed back to 2.2 s on every touch
     * so the volley never expired. `canHarm(bolt.owner, victim)` is
     * attacker === victim → true, so the end of that rally is a 2175 damage
     * bolt pointed at the 100 hp player who made it.
     *
     * `baseDamage` is taken on the FIRST deflection — a fresh bolt out of the
     * pool has `deflected` false, which is what makes this safe against reuse —
     * and the ceiling is one perfect return by this deflector. A rally can
     * still earn the 2.5×; it cannot compound past it. Eight exchanges now end
     * at 27.50 instead of 2175.29.
     */
    if (!bolt.deflected || !(bolt.baseDamage > 0)) bolt.baseDamage = bolt.damage;
    const boon = owner.boonMods.deflectDamage ?? 1;
    bolt.damage = Math.min(bolt.damage * res.damageMul * boon,
      bolt.baseDamage * GRADE_DAMAGE[GRADE.PERFECT] * boon);
    // "Ours" is a question about SIDES. A flat 0 made every returned bolt the
    // party's, which in PvP hands a duellist on side 2 a bolt their own gate
    // then calls friendly. `asTeam` is the one place a side number is minted.
    bolt.team = asTeam(owner.team);
    bolt.owner = owner;
    bolt.deflected = true;
    bolt.deflector = owner;
    if (res.grade >= GRADE.RETURN) bolt.color.setHex(0xfff0a0);
    bolt.life = Math.max(bolt.life, 2.2);

    owner.saber.strain(0.45 + res.grade * 0.15);
    owner.deflects++;
    owner.combo++;
    owner.comboTimer = 3.2;
    this.particles.sparkBurst(point, res.normal, 8 + res.grade * 8, { speed: 6 + res.grade * 4 });
    this.particles.plasma.spawn(point, _v1.set(0, 0, 0),
      { life: 0.16, size: 0.34 + res.grade * 0.16, drag: 1, gravity: 0, color: owner.saber.color.getHex(), alpha: 0.9 });

    owner.addFlow([0.03, 0.06, 0.13, 0.24][res.grade]);
    owner.score += [10, 25, 70, 160][res.grade];
    // `?.` — `_bladeEntries` offers every lit blade in `world.players`, and a
    // RemoteAvatar's is one of them. See the note over `_applyBladeEvent`.
    owner.camera?.addShake(0.03 + res.grade * 0.02);
    if (res.grade === GRADE.PERFECT) owner.perfects++;
    /**
     * ── AND THE GUARD PAYS FOR IT. FLAGSHIP §6, and see `GUARD_COST`.
     *
     * This was one line — `else if (res.grade === GRADE.BLOCK) owner.stamina
     * -= 4` — a flat charge on the bottom rung and nothing on the other three.
     * At four a block was expensive enough to be felt once and the ladder said
     * nothing at all about the difference between a driven blade and a met
     * one, which is the difference the whole grade exists to measure.
     *
     * Now every rung has a price and the top two are free, so volume of fire
     * is a drain a good player can zero and a poor one cannot. `guardCost`
     * owns the table and the auto-guard clause; nothing here restates either.
     *
     * `staminaHold` is deliberately NOT set — see the note over GUARD_COST.
     * The mechanic is a drain racing a regen, and pausing the regen deletes
     * the race.
     *
     * The counters are cumulative and monotone because a RATE cannot be read
     * off a pool four other things spend; `guardSpent`'s own note says who
     * reads them.
     *
     * `typeof owner.stamina === 'number'` GUARDS BOTH, and it is a live defect
     * rather than belt-and-braces. `_creditDeflect` is reached by every lit
     * blade in `world.players`, and a `RemoteAvatar` is one of them: it carries
     * `kills`, `score`, `deflects` and `combo` and it deliberately carries no
     * bars at all, because a peer owns its own health. The line this replaces
     * was `owner.stamina = Math.max(0, owner.stamina - 4)` — `undefined - 4` is
     * NaN, `Math.max(0, NaN)` is NaN, and the peer's local copy has carried a
     * NaN stamina since the day a remote avatar could hold a blade. Nothing
     * read it, so nothing said so; charging on every rung instead of one makes
     * it forty times as likely and `guardSpent` would carry the NaN outward.
     */
    /* AND THE ONE THAT WAS NOT FOR HIM AT ALL, COUNTED. `screened` is
     * cumulative and monotone for the reason `guardSpent`'s own note gives: a
     * rate cannot be read off a pool that four other things spend. It is the
     * only number that separates a Jedi who is covering his line from one who
     * is merely standing in it, and `tools/checks/screen.mjs` reads it. */
    if (snap && snap.screen > 0) owner.screened = (owner.screened || 0) + 1;
    const cost = guardCost(res.grade, snap);
    if (cost.stamina > 0 && typeof owner.stamina === 'number') {
      const paid = Math.min(cost.stamina, owner.stamina);
      owner.stamina = Math.max(0, owner.stamina - cost.stamina);
      owner.guardSpent = (owner.guardSpent || 0) + paid;
    }
    if (cost.force > 0 && typeof owner.force === 'number') {
      const paid = Math.min(cost.force, owner.force);
      owner.force = Math.max(0, owner.force - cost.force);
      owner.guardForceSpent = (owner.guardForceSpent || 0) + paid;
    }
    this.report({ type: 'deflect', grade: res.grade });
  }

  /* ── blade resolution ────────────────────────────────────────────── */

  _resolveBlades(dt) {
    // Contact-sound throttles are drained once per frame, not once per contact.
    this._clangSound = (this._clangSound || 0) - dt;
    this._grindSound = (this._grindSound || 0) - dt;
    // Same reason as the sound: a grind fires every frame it is in contact, and
    // an unthrottled hitmarker would put sixty floating numbers a second on the
    // screen. Drained once per frame here, never per event.
    this._grindMark = (this._grindMark || 0) - dt;
    for (const p of this.players) {
      if (!p.alive || p.saber.ignition < 0.6) continue;
      /**
       * A LOCK OWNS BOTH BLADES — AND ONLY ONE OF THE TWO LOOPS KNEW IT.
       *
       * The enemy pass below stands down for a locked duellist (`if (e.lock)
       * continue`) and `Enemy._saberStrike` stands down again while the steel
       * is crossed. This loop had neither, so during a bind the player's blade
       * went on being solved against the body it was locked with — and a lock
       * is WON by driving the mouse hard, which is the same input that feeds
       * the solver. Measured with both fighters locked and `bladesTouching`
       * true, over 12 frames: 1 cut billed, a forearm severed, 20.63 hp of
       * grind and +60 score, taken off an opponent whose own blade was barred
       * from answering.
       *
       * `lockState` is what `_applyClash` sets on the player when it builds the
       * BladeLock and clears when the lock resolves, so this is the same flag
       * from the other end — not a second opinion about what a lock is. The
       * contest is decided in `BladeLock.update`, which runs below.
       */
      if (p.lockState && !p.lockState.done) continue;

      // build the target list once per player
      const targets = this._targets;
      targets.length = 0;
      const bladeMid = p.saber.pointAt(0.5, _v1);
      for (const e of this.enemies) {
        if (e.dead && !e.actor?.ragdolled) continue;
        if (e.position.distanceToSquared(bladeMid) > 36) continue;
        /**
         * NOT THE MEN SHARING YOUR SEAT ROW.
         *
         * A troop bay is 2.4 m wide with ten bodies in it and a plasma blade
         * among them, and the blade solver does not care that they are on your
         * side — it resolves a swept quad against whatever capsules are within
         * six metres. The extraction has always known this: `SEAL_NEEDS_BLADE_DOWN`
         * is the rule that made you put the blade away before the doors closed,
         * and its whole subject is close quarters inside the hull.
         *
         * I narrowed that rule to the OUTBOUND leg earlier in this branch,
         * because on the way in it was firing after the player had already
         * walked off the ramp and confiscating the blade on a battlefield. That
         * was right about the message and wrong about the hazard: the hazard is
         * being ABOARD, not which direction the ship is going. Measured after
         * the passengers started being drawn where they actually sit — up to
         * four of ten troopers cut to death during the descent, by the player's
         * own blade, before the ramp had opened.
         *
         * So the guard moves to where the harm is decided rather than to a
         * notice: while you are riding, your own side is not a target.
         * Everything else still is — a duellist who boards is fair game the
         * whole way down — and the guard ends the moment you step off the ramp,
         * which is also the moment you can see what you are swinging at.
         *
         * AND IT IS YOUR SIDE, NOT "ALSO RIDING", which the first cut of it
         * was. `Extraction._release` clears `riding` one man at a time as the
         * stick files off the ramp, so the first trooper out stops being a
         * rider while the commander is still aboard with a lit blade a metre
         * behind him — and for that window he is an ordinary target standing in
         * a doorway. It failed the way a window fails: `insertion: your own
         * blade does not kill the stick riding with you` came back red once in
         * five runs at 1 of 10 hurt, green the other four, which is worse than
         * a red — the version of this check that said "10 of 10 survive" had
         * simply been lucky. `nudgeFromSwing` already pushes a released man off
         * the blade at that instant and is why it is one in five rather than
         * five in five; it is a mitigation and this is the rule.
         *
         * Not routed through `canHarm`: that answers to `friendlyFire`, and a
         * mode with friendly fire on still must not let you take your own stick
         * apart inside a 2.4 m bay they cannot leave.
         */
        if (p.riding && (e.riding || teamOf(e) === teamOf(p))) continue;
        targets.push({ id: e.id, capsules: e.capsules(), enemy: e, dead: false });
      }
      for (const pr of this.props) {
        if (pr.body.position.distanceToSquared(bladeMid) > 25) continue;
        targets.push({ id: pr.id, capsules: pr.capsules(), prop: pr, dead: false });
      }
      for (const d of this.doors) {
        if (d.opened) continue;
        if (d.mesh.position.distanceToSquared(bladeMid) > 64) continue;
        targets.push({ id: d.id, capsules: d.capsules(), door: d, dead: false });
      }
      /**
       * A DUEL'S BODIES.
       *
       * This list was enemies, props and doors — so a player's blade swept
       * through another player's chest and the solver was never handed anything
       * to hit. Measured on two real Players in one arena over 180 frames: 0.0
       * damage and 0 blade-target records that were a player.
       *
       * `bladeTargets` IS the rule, and it consults the same gate every damage
       * path does — so in co-op it returns an empty list and this costs one
       * call per swinging blade. Never write the loop out here: this file has
       * twice had to un-duplicate a targeting rule, and the note fifty lines up
       * about the enemy blade test that existed twice and disagreed with itself
       * on five terms is why.
       */
      for (const t of bladeTargets(p, this.players, this.rules)) targets.push(t);

      const events = this.bladeSolver.solve(p.saber, targets, dt, { power: p.boonMods.cutPower });
      for (const ev of events) this._applyBladeEvent(p, ev, dt);
    }

    // enemy blades vs the player, and blade-on-blade
    for (const e of this.enemies) {
      if (e.dead || !e.saber || e.saber.ignition < 0.6) continue;
      if (e.lock) continue;                       // a lock owns both blades
      for (const p of this.players) {
        // `!p.control` used to be here, and a RemoteAvatar has none — so enemy
        // sabers passed straight through every joining player, in the one mode
        // where being surrounded is the point. The guard was standing in for
        // "is this a local Player" and the thing it actually protects is the
        // two hitImpulse calls inside _applyClash, which is where it now lives.
        if (!p.alive) continue;
        // Blades meeting takes precedence over a blade meeting a body — but
        // ONLY for a local player. A clash is resolved on the machine that owns
        // the blade: it is a mouse-driven contest (a blade lock is literally a
        // drag race), and the stamina, riposte window, stagger and score it
        // moves all live on that player's own machine. Running it here for a
        // remote would decide a duel on their behalf with none of their input.
        if (p.control && p.saber.ignition > 0.5) {
          const clash = resolveBladeClash(p.saber, e.saber);
          if (clash) { this._applyClash(p, e, clash); continue; }
        }
        /**
         * ENEMY BLADE VERSUS A BODY — ONE IMPLEMENTATION, NOT TWO.
         *
         * There used to be a second copy of this test inlined right here, and
         * it disagreed with `Enemy._saberStrike` on every term that matters:
         *
         *   • shape   an UNSWEPT segmentNear on the tip alone at r = 0.44,
         *             against a swept eight-substep segment-segment on the
         *             whole blade at r = radius + BLADE_BITE. The tip covers
         *             up to ~0.9 m in a 30 fps frame; this one stepped past
         *             bodies, and had no notion of the blade's base at all.
         *   • damage  `attackDamage * damageScale` with NO rally multiplier,
         *             so a rallied duellist that missed the real test landed
         *             here for less than it was supposed to deal.
         *   • crouch  ignored — a fixed 0.4→1.7 capsule, so crouching made a
         *             player no smaller.
         *   • steel   no `bladesTouching` stand-down, so a blade being held
         *             against this one still scored a body hit.
         *   • after   `interrupt(0.45)` — the exact behaviour DuelBrain.followUp
         *             was written to replace ("a landed hit is pressure, not a
         *             full stop"). Landing a cut here bought the duellist half
         *             a second of quiet, which is the bug that comment names.
         *
         * The two never double-hit, because a real hit ends the strike phase —
         * which is precisely why this went unnoticed. It only ever fired when
         * the accurate test had already decided the swing MISSED. Every hit it
         * produced was a false positive with the wrong number attached.
         *
         * `_saberStrike` runs itself against `e.target` inside `e.update`; the
         * call here covers everyone ELSE standing in the arc — which in co-op
         * is most of the room. Its own once-per-strike guard means a swing
         * still lands on one body.
         */
        if (p !== e.target) e._saberStrike(null, p);
      }
    }

    // blade locks run their own contest
    for (let i = this.locks.length - 1; i >= 0; i--) {
      const lock = this.locks[i];
      lock.update(dt, this);
      if (lock.done) {
        lock.enemy.lock = null;
        lock.player.lockState = null;
        this.locks.splice(i, 1);
        this.notifyFloating(lock.point, lock.result === 'player' ? 'LOCK WON' : 'OVERPOWERED',
          lock.result === 'player' ? '#ffd88a' : '#ff8080');
        if (lock.result === 'player') this.report({ type: 'lockWon' });
      }
    }
  }

  /**
   * A BLADE TOUCHED SOMETHING — AND THE HOLDER MAY NOT BE A LOCAL PLAYER.
   *
   * Every `addShake` below used to be `player.camera.addShake(...)`, and a
   * `RemoteAvatar` has no camera. Avatars were put into `world.players` on
   * purpose — that is what let an enemy blade cut a joining player — and they
   * carry a real ignited `Saber`, so `_resolveBlades` feeds their contacts
   * through here like anyone else's.
   *
   * The consequence was not a cosmetic miss. `TypeError: cannot read
   * properties of undefined (reading 'addShake')` is thrown out of
   * `World.update()`, which abandons the rest of the frame ON THE HOST —
   * before `engine.render`, before the director ticks, before the snapshot
   * goes out. Measured over 600 frames with one idle avatar holding a lit
   * blade against level geometry: 7 of 7 grind events threw, the host's screen
   * stopped repainting and the session stalled for everyone. Two separate
   * auditors hit it independently, one of them while measuring something else.
   *
   * `?.` rather than a guard clause at the top, because everything else in
   * here — the cut, the damage, the score, the claim to the host — is exactly
   * as valid for a remote as for a local. The camera is the only part of the
   * feedback that belongs to one machine.
   */
  _applyBladeEvent(player, ev, dt) {
    const P = this.particles;
    if (ev.type === 'clang') {
      P.sparkBurst(ev.point, null, 8, { speed: 6 });
      // A blast door presents a capsule every 0.55m, each with its own 0.12s
      // contact cooldown, so holding the blade against one fired ~24 clashes a
      // second — 72 voices, half the pool, and it buzzed. Throttle it the way
      // grind already is.
      if (this._clangSound <= 0) { this._clangSound = 0.1; audio.clash(ev.point, 0.5); }
      player.camera?.addShake(0.06);
      return;
    }

    if (ev.type === 'grind') {
      // holding the blade against something that will not part quickly
      if (ev.target.door) {
        const breached = ev.target.door.burn(ev.point, ev.speed * player.boonMods.cutPower, dt);
        player.saber.strain(0.9);
        if (breached) this.addHitstop(0.05);
      } else {
        // A GRIND HAS TO HURT. This branch used to be particles and nothing
        // else: no hp, no hitmarker, no hitstop. Since severing needs a full
        // work budget and a single pass rarely filled one, the overwhelmingly
        // common outcome of putting a lit blade through a body was a puff of
        // slag and no consequence — "you slash them and it appears to do
        // nothing", exactly as reported.
        //
        // Damage is the SHARE OF A SEVER done this frame, so it is bounded per
        // CAPSULE: that capsule's work accumulates to `tough`, the limb comes
        // off, and the total billed on the way is GRIND_LETHALITY × `vital` of
        // max hp. That much holds at any frame rate, because the share is a
        // share of work and not of time.
        //
        // IT IS NOT A BOUND ON THE BODY, and this comment used to claim it was.
        // A torso publishes four overlapping capsules (hips, spine, chest,
        // neck) and one blade laid across it is in contact with all of them, so
        // four independent budgets are spent at once. Measured on a real rig,
        // a 0.4 m/s press held for one second: 3.14× max hp across 326 bills.
        // Against a Player that is throttled elsewhere — see the branch below —
        // and against an Enemy the body is long dead before the fourth capsule
        // finishes, which is why nothing ever felt it.
        const t = ev.target;
        if (t.enemy && ev.dWork > 0 && ev.need > 0 && !t.enemy.dead) {
          const e = t.enemy;
          const wasAlive = !e.dead;
          const share = ev.dWork / ev.need;
          const dmg = share * e.maxHp * GRIND_LETHALITY * grindWorth(ev.cap);
          e.damage(dmg, ev.point, player, 'saber');
          if (player.isLocal) this._claim({ t: 'claim', k: 'dmg', id: e.id, d: dmg,
            p: [ev.point.x, ev.point.y, ev.point.z] });
          if (this._grindMark <= 0) {
            this._grindMark = 0.12;
            this.onHitmark?.(ev.point, wasAlive && e.dead ? 'kill' : 'hit', ev.cap?.name);
          }
          player.addFlow(0.012);
        }
        /* …and the same share of a sever against a duelling opponent, off the
         * VICTIM's maxHp so the duel's health setting scales it. Holding a
         * blade on someone is a pressure tool in a duel exactly as it is
         * against the horde, and it was the one contact type that produced
         * nothing at all.
         *
         * WHAT HOLDS THIS DOWN IS `Player.damage`'s 0.18 s INVULNERABILITY
         * WINDOW, and it is worth naming because nothing at this site says so.
         * There is no `_grindMark`-style throttle here and no `grindWorth`
         * vital term as the enemy branch above has, so read alone this bills
         * every capsule of every frame at full price — and against a stub
         * victim with no window it does exactly that: 3.14× max hp in one
         * second. Against a real Player the window swallows all but one bill
         * per 0.18 s: measured 4.9 hp over two seconds of the same press. So
         * the exploit is refuted, by a guard that lives in another file — do
         * not remove or shorten that window without putting a throttle here. */
        if (t.player && ev.dWork > 0 && ev.need > 0 && t.player.alive) {
          t.player.damage((ev.dWork / ev.need) * t.player.maxHp * GRIND_LETHALITY,
            ev.point, player, 'saber');
          if (this._grindMark <= 0) {
            this._grindMark = 0.12;
            this.onHitmark?.(ev.point, t.player.alive ? 'hit' : 'kill', ev.cap?.name);
          }
          player.addFlow(0.012);
        }
        P.slag(ev.point, _v1.subVectors(ev.point, player.saber.base).normalize(), 0xffb040);
        if (rng() < 0.35) P.sparkBurst(ev.point, null, 3, { speed: 5, embers: false });
      }
      // NB: the timer is drained once per frame in _resolveBlades, not here —
      // decrementing per event made a 0.14s throttle behave like 0.047s
      // whenever three contacts landed on the same frame.
      if (this._grindSound <= 0) {
        this._grindSound = 0.14;
        audio.noise({ dur: 0.16, gain: 0.13, type: 'bandpass', freq: 2800, freqEnd: 1400, q: 2.4, pos: ev.point });
      }
      player.camera?.addShake(0.02);
      return;
    }

    if (ev.type !== 'cut') return;

    // ── a real cut
    const t = ev.target;
    if (t.enemy) {
      const e = t.enemy;
      const wasAlive = !e.dead;
      /**
       * A PASS THAT WAS TURNED IS NOT A LIMB, AND THIS PAID FOR ONE.
       *
       * `takeCut` returns `'turned'` when a duellist's guard caught the blade
       * and nothing came off — the derived guard is why "they die too easily"
       * is fixed, and torso passes to a kill went 1 → 3 on an acolyte and 1 → 5
       * on a master without a single health number moving. This branch predates
       * that return and ran the whole sever path for it: `limbsRemoved++`, the
       * combo, sixty score, lifesteal, hitstop and an `onHitmark(…, 'cut')`.
       *
       * So a player whose pass a Jedi Master BLOCKED was told they had taken a
       * limb, and the run's limb counter — which is printed on the death card —
       * inflated by one every time the guard did its job. A false reward is
       * worse than a missing one: it teaches the player that the block was a
       * hit and that the fight is going better than it is.
       *
       * The claim goes out either way, and deliberately: the host has to hear
       * about the pass so it can run the same guard against the same bone and
       * reach the same answer. What it must not do is pay for it here.
       */
      const outcome = e.takeCut(ev, player);
      if (player.isLocal) this._claim({ t: 'claim', k: 'cut', id: e.id, b: ev.bone, ct: ev.cutT,
        p: [ev.point.x, ev.point.y, ev.point.z],
        v: [ev.impulse.x, ev.impulse.y, ev.impulse.z] });
      if (outcome === 'turned') {
        // Felt, and not rewarded. Two blades met; the shake is the whole of it.
        player.camera?.addShake(clamp(ev.speed / 90, 0.03, 0.18));
        return;
      }
      /**
       * A CORPSE IS NOT AN OPPONENT, AND SAWING ONE PAID FULL PRICE FOREVER.
       *
       * A ragdolled body stays a blade target on purpose — you can take an arm
       * off a corpse and it should come off — but nothing here asked whether it
       * was alive, and nothing downstream stops the till. `Ragdoll.cutRagdoll`
       * never sets `severed`, so `isSevered` stays false and the SAME hand can
       * be chopped without bound. Measured, 10 s of sawing one hand of one dead
       * body: 53 severs billed, limbsRemoved 53, score 3180, combo 53, flow
       * +5.30 against a bar clamped to 0..1 — 530 full bars — and 318 hp of
       * lifesteal. Corpses linger for the whole Corpses budget, so that is
       * available on every body after every wave, at no risk whatever.
       *
       * The grind branch fifty lines up already refuses a dead body
       * (`!t.enemy.dead`); this is the same rule on the other contact type.
       * `wasAlive` was already sitting here, computed and unread by this path.
       * The cut itself still happens — `takeCut` ran above — so the limb comes
       * off and the shake lands; it is only the till that closes.
       */
      if (!wasAlive) {
        player.camera?.addShake(clamp(ev.speed / 90, 0.03, 0.18));
        return;
      }
      player.limbsRemoved++;
      player.addFlow(0.10);
      player.combo++;
      player.comboTimer = 3.2;
      player.score += 60;
      if (player.boonMods.lifesteal) player.heal(player.boonMods.lifesteal);
      this.addHitstop(ev.speed > 20 ? 0.055 : 0.03);
      player.camera?.addShake(clamp(ev.speed / 60, 0.05, 0.3));
      this.onHitmark?.(ev.point, wasAlive && e.dead ? 'kill' : 'cut', ev.bone);
    } else if (t.player) {
      /**
       * A LIMB IS NOT TAKEN OFF A PLAYER — AND A PASS IS ONE HIT.
       *
       * `Player` has no `takeCut` and should not grow one: losing an arm
       * mid-duel is a different feature with a different animation budget. So
       * a clean pass is a heavy hit scaled by which bone it crossed, off the
       * VICTIM's own maxHp so the duel's health setting scales it.
       *
       * THE THROTTLE IS THE PART THAT MATTERS. The solver reports a cut per
       * capsule per frame of contact — measured at 215 events over 92 contact
       * frames across 18 bones for one sweep through a torso. Against an enemy
       * that is right, because `takeCut` severs a named bone once and the
       * second event finds it gone. A player has no such bookkeeping, so
       * billing every event killed a 150 hp rival inside two frames and the
       * duel was over before the blade had finished travelling. The first
       * version of this shipped that way and the pvp suite caught it by
       * failing a LATER step: the rival was already dead when the next power
       * was tested.
       *
       * One hit per attacker per 0.28 s, which is fractionally longer than the
       * longest authored strike phase, so a single sweep bills once however
       * many capsules it crosses and a genuine second pass bills again.
       */
      const now = this.time;
      const seen = (t.player._cutAt ||= new Map());
      if (now - (seen.get(player.id ?? player) ?? -9) < 0.28) return;
      seen.set(player.id ?? player, now);
      t.player.damage(t.player.maxHp * 0.34 * lerp(0.6, 1.9, ev.cap?.vital ?? 0.4),
        ev.point, player, 'saber');
      player.score += 60;
      this.addHitstop(0.055);
      // `?.` — a RemoteAvatar has no camera, and four unguarded calls in this
      // function were abandoning 295 of 300 host frames.
      player.camera?.addShake(clamp(ev.speed / 60, 0.05, 0.3));
      this.onHitmark?.(ev.point, t.player.alive ? 'cut' : 'kill', ev.bone);
      P.cutFlare(ev.point, null, player.saber.color.getHex(), 18);
      audio.cut(ev.point, false);
    } else if (t.door) {
      /**
       * A DOOR'S "CUT" IS STILL A BURN — otherwise a frame of the hold is
       * thrown away every five seconds.
       *
       * A blast door's capsules are `structure` capsules with
       * `TOUGHNESS.blastdoor` on them (see `BlastDoor.capsules`), so the solver
       * accumulates press work against them exactly as it does against a
       * column: `dWork = speed·dt·WORK_RATE`, and `cutNeed` for a blast-door
       * capsule is 110 — a few seconds of a swing's contact, and reachable by a
       * long hold too. On the frame that budget fills the solver emits `cut`
       * INSTEAD of `grind`, and the grind branch above is where `burn()` lives,
       * so the door lost that frame's melt and took a 0.14 s cooldown on the
       * capsule on top of it.
       *
       * There is nothing to sever here: a door is one plate and the thing that
       * happens when you get through it is `breach()`, which `burn()` decides
       * for itself off the kerf map. So the frame's work is spent the same way
       * every other frame of the hold spends it, and the fall-through below
       * (which did nothing at all for a door) is gone.
       */
      t.door.burn(ev.point, ev.speed * player.boonMods.cutPower, dt);
      P.slag(ev.point, _v1.subVectors(ev.point, player.saber.base).normalize(), 0xffb040);
    } else if (t.prop) {
      const halves = t.prop.cut(ev.point, ev.normal, ev.impulse);
      if (!halves) t.prop.shatter(ev.impulse, ev.point);
      // …and nothing else: the halves are `Prop`s built in `Prop.cut`, and a
      // `Prop` puts itself in this list from its own constructor. The push
      // that stood here was the second copy of every cut half in the game.
      // Only the capsule that parted, when the target is the destruction proxy.
      // Every destructible structure in the level shares that one proxy id, so
      // the prefix sweep was resetting grind progress on every column and wall
      // in the level each time one cell came away. A real Prop is genuinely
      // gone — replaced by halves carrying new ids — so it still clears whole.
      //
      // …AND A FOREST IS THE SAME SHAPE. `attachForest` rides the whole stand
      // in `world.props` as one duck-typed prop with one id, and its capsules
      // are named per TRUNK (`t0`, `t1`, …) — so the prefix sweep threw away
      // the accumulated grind on all 1,800 of them every time one tree came
      // down, and the tree beside the one you just felled started again from
      // zero. `cap.forest` is the marker the capsule already carries, exactly
      // as `cap.structure` is the proxy's.
      this.bladeSolver.clearTarget(t.id, (ev.cap?.structure || ev.cap?.forest) ? ev.cap.name : null);
      P.cutFlare(ev.point, null, player.saber.color.getHex(), 18);
      audio.cut(ev.point, false);
      player.camera?.addShake(0.06);
      player.score += 10;
    }
  }

  /**
   * Blade meets blade. What happens depends on what the duellist is actually
   * doing — which the telegraph told you a moment ago:
   *
   *   light        parry it or chamber it, either works
   *   heavy        chamber it or get out of the way; a flat parry breaks your guard
   *   unblockable  your blade is not an answer, only your feet are
   */
  _applyClash(player, enemy, clash) {
    const P = this.particles;
    const now = this.time;
    if (now - (enemy._lastClash || -1) < 0.09) return;
    enemy._lastClash = now;

    const duel = enemy.duel;
    const tier = duel ? duel.tier : { parryable: true, chamberable: true, guardBreak: 0.6, colour: 0x9fd8ff };
    const attacking = duel && (duel.phase === 'windup' || duel.phase === 'strike');

    _v1.subVectors(player.saber.pointAt(0.5, _v2), clash.point).normalize();
    // the direction the player's blade is actually travelling
    _v4.lerpVectors(player.saber.baseVelocity, player.saber.tipVelocity, 0.7);
    const bladeSpeed = _v4.length();

    P.sparkBurst(clash.point, null, Math.round(10 + clash.power * 22), { speed: 8 + clash.power * 9 });
    audio.clash(clash.point, clash.power);
    player.saber.strain(clash.power);
    enemy.saber.strain(clash.power);
    /* GUARDED, because a clash is resolved for whichever blade in
     * `world.players` met the enemy's and a RemoteAvatar has no camera — see
     * the note over `_applyBladeEvent` for what that TypeError costs on the
     * host. Written as an `if` and not `?.` on purpose: `duelling.mjs` pins the
     * six consequences of a clash by looking for `camera.addShake(` in this
     * method, and an optional-chain spells it `camera?.addShake(` and reads to
     * that check as the kick having been deleted. */
    if (player.camera) player.camera.addShake(0.08 + clash.power * 0.12);

    // ── CHAMBER: swung against the declared arc, inside the window
    if (duel && duel.chamberOpen && bladeSpeed > 5.5 && duel.chambersWith(_v4)) {
      /**
       * THE NAME OF THE ATTACK, TAKEN BEFORE IT IS CLEARED.
       *
       * `interrupt()` sets `this.attack = null` on its second line, and the
       * feedback call at the bottom of this branch read `duel.attack.label` —
       * so the FIRST successful chamber in a run threw
       * `Cannot read properties of null (reading 'label')` straight out of
       * World.update. rAF is re-armed at the top of main.js's frame(), so the
       * page did not hard-freeze; instead every remaining step of that frame
       * was skipped — bolts, physics.step, props, particles, terrain.flush,
       * the director, the net tick, the HUD, the render, and input.end() —
       * and profiler.begin() ran with no matching end(). Measured over 240
       * directed trials against a makashi acolyte: 9 real chambers, 9 crashes.
       * A 100% crash rate on the mechanic.
       *
       * Nothing in the suite could see it because tools/checks/duelling.mjs
       * re-implements this branch rather than driving it, and its copy has no
       * label dereference in it. See tools/checks/answerable.mjs, which now
       * runs the shipped `_applyClash`.
       */
      const chambered = duel.attack?.label ?? 'the attack';
      duel.interrupt(0.85);
      /**
       * THE DIRECTION AND THE WEIGHT, WHICH NOTHING EVER SUPPLIED.
       *
       * `DuelBrain.stagger(seconds, worldDir, power)` was written to throw the
       * guard to the side the blade was actually driven and to scale the throw
       * by how hard — and every one of the eleven callers passed a duration
       * and nothing else, so `worldDir` was null at every site and `power` was
       * 1 at every site. The whole directional half of the mechanic was dead
       * on arrival: a beat from the left and a beat from the right produced
       * the same opening, on the same side, of the same size.
       *
       * `_v4` is the player's blade velocity, already computed above for
       * `chambersWith` — literally the direction the enemy's blade was driven.
       */
      enemy.stun(0.6, _v4, 1.35);
      player.riposteTimer = 0.6 * (player.boonMods.riposteWindow ?? 1);
      player.addFlow(0.34);
      this.addHitstop(0.085);
      this.engine.flash(0.06);
      this.notifyFloating(clash.point, 'CHAMBER', '#8fe8ff');
      this.report({ type: 'chamber', enemy });
      audio.deflect(clash.point, 3);
      player.score += 160;
      player.chambers = (player.chambers || 0) + 1;
      this.onDeflectFeedback?.(4, clash.point, `chambered ${chambered}`);
      return;
    }

    /**
     * THE STAMINA A FAILED GUARD COSTS, WHICH IS WHAT `TIER.guardBreak` IS.
     *
     * Three tiers author it — light 0.6, heavy 1.9, unblockable 3.2 — and one
     * branch read it. `heavy` alone: the two other rows had no reader anywhere
     * in the game, and verify.mjs asserted only that they were in increasing
     * order, which a table nobody reads satisfies for free. So putting your
     * blade in front of an UNBLOCKABLE cost a flat 10 stamina, less than the
     * 14 a lost light clash cost, and the red arc — the one thing in the game
     * whose entire meaning is "your blade is not the answer" — was the
     * cheapest mistake available.
     *
     * One rule on all three paths now: `GUARD_COST * tier.guardBreak`, so the
     * colour you ignored is the size of the hole it leaves. Light lands at
     * 13.2 against the 14 it was, which is the point — the tier that was
     * already tuned barely moves, and the two that were lying stop.
     */
    /* AND EACH OUTCOME SOUNDS LIKE ITSELF. `audio.clash` above fires on every
     * contact, before the branch is taken, so four of the six ways an exchange
     * can end — unblockable, guard broken, parry, lost — arrived on one sound.
     * The verb is `clashOutcome`, which ends in a fallback so a fifth outcome
     * cannot be silent; it is called HERE rather than from `onDeflectFeedback`
     * because that seam is HUD text and a machine with the HUD off would then
     * fight in silence. */
    // ── UNBLOCKABLE: the blade is not the answer
    if (attacking && !tier.parryable && !tier.chamberable) {
      player.control?.hitImpulse(clash.point, _v1.clone().multiplyScalar(-9), 1.0);
      player.stamina = Math.max(0, player.stamina - GUARD_COST * tier.guardBreak);
      if (player.stamina <= 0) player.staggerTimer = Math.max(player.staggerTimer, 0.6);
      this.notifyFloating(clash.point, 'UNBLOCKABLE', '#ff5a62');
      audio.clashOutcome(clash.point, 'unblockable', clash.power);
      this.onDeflectFeedback?.(-1, clash.point, 'that one had to be dodged');
      return;
    }

    // ── HEAVY parried flat: guard broken
    if (attacking && !tier.parryable) {
      player.control?.hitImpulse(clash.point, _v1.clone().multiplyScalar(-16), 1.5);
      player.stamina = Math.max(0, player.stamina - GUARD_COST * tier.guardBreak);
      player.staggerTimer = Math.max(player.staggerTimer, 0.38);
      this.addHitstop(0.05);
      this.notifyFloating(clash.point, 'GUARD BROKEN', '#ffa040');
      audio.clashOutcome(clash.point, 'guardBroken', clash.power);
      this.onDeflectFeedback?.(-1, clash.point, 'heavy — chamber it or step aside');
      return;
    }

    // ── BIND: both blades slow and touching, nobody committed → a lock
    if (clash.type === 'bind' && !enemy.lock && !attacking && this.locks.length < 2) {
      const lock = new BladeLock(player, enemy, clash.point);
      enemy.lock = lock;
      player.lockState = lock;
      this.locks.push(lock);
      this.notifyFloating(clash.point, 'BLADE LOCK', '#ffd88a');
      this.onDeflectFeedback?.(5, clash.point, 'drive the mouse to overpower');
      return;
    }

    // ── PARRY / CLASH — both blades recoil, the slower one loses ground
    const playerWon = clash.winner === 'a' || bladeSpeed > clash.sb;
    player.control?.hitImpulse(clash.point, _v1.clone().multiplyScalar(playerWon ? -5 : -13), playerWon ? 0.6 : 1.3);
    if (playerWon) {
      if (duel) duel.interrupt(0.45);
      // A parry is a beat, not an invitation — same direction, less of it.
      enemy.stun(0.18, _v4, 0.7 + Math.min(0.4, bladeSpeed / 40));
      player.riposteTimer = 0.42 * (player.boonMods.riposteWindow ?? 1);
      player.addFlow(0.12);
      player.score += 45;
      this.notifyFloating(clash.point, 'PARRY', '#a8f0ff');
      audio.clashOutcome(clash.point, 'parry', clash.power);
      this.report({ type: 'parry', enemy });
      this.onDeflectFeedback?.(3, clash.point, 'riposte now');
    } else {
      player.stamina = Math.max(0, player.stamina - GUARD_COST * tier.guardBreak);
      if (player.stamina <= 0) player.staggerTimer = Math.max(player.staggerTimer, 0.6);
      audio.clashOutcome(clash.point, 'lost', clash.power);
    }
    this.addHitstop(0.03);
  }

  notifyFloating(point, text, color) { this.onFloating?.(point, text, color); }

  /* ── bolts ───────────────────────────────────────────────────────── */

  _onBoltDeflect(bolt, entry, hit, bladePoint) {
    const owner = entry.owner;
    const isPlayer = owner instanceof Player;
    /**
     * "ALREADY OURS" IS A QUESTION ABOUT SIDES, NOT ABOUT THE CONSTANT 0.
     *
     * The player branch used to stand down on `bolt.team === 0` and the enemy
     * branch had no gate at all. Both are the same rule and both were wrong:
     *
     *   • In PvP a human duellist on side 1 met a bolt player A had just
     *     returned — team 0, hostile to them — and this returned. Measured:
     *     `B.deflects` 0 and the velocity untouched, while a non-Player
     *     duellist standing in the same spot turned it. And it is worse than a
     *     no-op, because `Bolts.update` has already set `consumed` for the
     *     frame by the time we return: the bolt phases through the guard AND
     *     skips its own body hit-test, so it cannot even be taken in the chest.
     *
     *   • The enemy branch stamped `team = 1` for anyone, so an enemy could bat
     *     back a bolt that was already the horde's.
     *
     * One gate, asked of the deflector's own side.
     */
    const side = asTeam(owner.team);
    /**
     * …AND THE MAN WHOSE SHOT IT WAS. FLAGSHIP §7's BREAK verb, billed at the
     * one door every turned bolt in the game passes through — see
     * `Nerve.boltAnswered`, which owns the amount, the routing and the reason.
     * A player is not a body with a ledger, so the deflector's own side is
     * asked first and `this.players` filters the other end.
     */
    if (bolt.team !== side && !this.players.includes(bolt.owner)) boltAnswered(bolt.owner);
    /**
     * ── AND THE ONE THING THAT IS ALLOWED TO BE OURS ALREADY: A STRAY ──────
     *
     * The screen answers a bolt on its way into one of YOUR OWN MEN, and
     * measured on a real Command battle every such bolt was fired by your own
     * line — 47 hits, 569.8 damage, seed 3, and not one of them hostile. So
     * the gate above, which is right about every other contact in the game,
     * would refuse the only fire the mechanic exists to stop.
     *
     * A stray is KNOCKED DOWN rather than turned, and that is the honest
     * picture as well as the safe one. There is nothing to send it back at —
     * it is your own man's shot — and `_creditDeflect` would raise its damage
     * by the grade and push its life back to 2.2 s, so a batted stray would go
     * on through the rank harder and for longer than it arrived. It costs the
     * same Force by the metre as any other screened bolt, through the same
     * `guardCost`, and it is counted in the same place.
     */
    if (bolt.team === side) {
      if (!(hit.screen > 0)) return;
      const cost = guardCost(GRADE.BLOCK, { screen: hit.screen });
      if (typeof owner.force === 'number' && cost.force > 0) {
        const paid = Math.min(cost.force, owner.force);
        owner.force = Math.max(0, owner.force - cost.force);
        owner.guardForceSpent = (owner.guardForceSpent || 0) + paid;
      }
      owner.screened = (owner.screened || 0) + 1;
      owner.strayed = (owner.strayed || 0) + 1;
      bolt.active = false;
      owner.saber.strain(0.3);
      this.particles.sparkBurst(bladePoint, null, 8, { speed: 6 });
      audio.deflect(bladePoint, 0);
      this.onDeflectFeedback?.(GRADE.BLOCK, bladePoint, 'a stray off your own line, stopped');
      return;
    }

    if (!isPlayer) {
      // an enemy duelist batting a bolt away — no grading, just a deflection
      bolt.vel.copy(hit.point).sub(bladePoint).normalize().multiplyScalar(bolt.speed);
      if (bolt.vel.lengthSq() < 1) bolt.vel.set(rng() - .5, rng() * .4, rng() - .5).setLength(bolt.speed);
      bolt.team = side;
      bolt.deflected = true; bolt.deflector = owner;
      this.particles.sparkBurst(bladePoint, null, 8, { speed: 6 });
      audio.deflect(bladePoint, 0);
      return;
    }

    // Freeze the blade half of the grade NOW; the aim half waits for the throw.
    const snap = captureSnapshot(bolt, owner.saber, { bladeT: hit.bladeT, point: bladePoint, auto: hit.auto, screen: hit.screen });
    const cw = owner.boltCatch;

    // ── CAUGHT. Only a driven blade takes hold of a bolt: `snap.caught` is the
    // same speed/closing test that has always separated a DEFLECT from a BLOCK.
    // A blade you merely parked in the way still blocks, and a block still
    // scatters — which is precisely what stops catch-and-throw from collapsing
    // into hold-the-button-and-win.
    /* `!snap.screen` — A SCREENED BOLT CANNOT BE CAUGHT AND HELD. The catch
     * window pins the bolt onto the blade (`bolts.hold`), and this contact
     * happened up to fourteen metres from it: the bolt would jump the width of
     * a rank to stick to a weapon that was never near it. Turning it aside
     * where it is is both the honest picture and the one the mechanic is named
     * after. */
    if (cw && snap.caught && !snap.screen) {
      // Stack them along the blade so three caught in a flurry are three
      // visible objects and not one. add() has to come FIRST: it is the thing
      // that can refuse (the blade is already carrying maxHeld), and a bolt
      // pinned to a blade that no window is tracking never gets thrown at all.
      const slot = cw.count;
      _v2.set(Math.cos(slot * 2.4) * 0.055, 0, Math.sin(slot * 2.4) * 0.055);
      const accepted = cw.add({ bolt, snap }, {
        manual: !hit.auto,
        bladeHeld: owner.control ? owner.control.bladeHeld : false,
        chest: owner.chest,
        incoming: snap.boltDir,
      });
      if (accepted) {
        this.bolts.hold(bolt, owner.saber, clamp(hit.auto ? 0.55 : snap.bladeT, 0.15, 0.92), _v2);
        if (owner.control) owner.control.catchHold = cw.t;
        owner.saber.strain(0.35);
        this.particles.sparkBurst(bladePoint, snap.normal, hit.auto ? 6 : 12, { speed: 5.5 });
        audio.deflect(bladePoint, hit.auto ? 0 : 1);
        this.onDeflectFeedback?.(GRADE.DEFLECT, bladePoint,
          hit.auto ? 'auto-guard caught it — aim and release' : 'caught — look where you want it');
        return;
      }
    }

    // ── BLOCK. Not caught, not aimed: it goes somewhere and that is the point.
    const res = gradeCaught(snap, {
      /* The body and not the lens — see the note on the other `gradeCaught`
       * call in this file for the measurement. */
      aimOrigin: owner.aimPoint(_aimFrom),
      aimDir: owner.aimDir,
      candidates: hostileTo(owner, this.enemies, this.rules),   // see _throwCaught
      flow: owner.flow,
      returnCone: owner.boonMods.returnCone,
      aimMode: this.settings.deflectAim || 'reticle',
    });
    bolt.pos.copy(bladePoint);
    bolt.prev.copy(bladePoint);
    bolt.vel.copy(res.dir).multiplyScalar(bolt.speed * (res.grade >= GRADE.RETURN ? 1.25 : 1));
    this._creditDeflect(owner, bolt, res, bladePoint, snap);
    audio.deflect(bladePoint, res.grade);
    /* A BOLT LANDING ON YOUR BLADE IS THE MOST TACTILE EVENT IN THE GAME and it
     * reached the pad through nothing at all. Scaled by the grade so a lucky
     * block and a perfect return are not the same in the hands — which is the
     * whole argument of this pass, applied to the one mechanic that already had
     * a four-step grade to spend on it. */
    /* `feelOn?.()` and not `feelOn()`: three suites drive World.prototype
     * methods against a hand-built stub world that lists the members it
     * borrows, and a bare call out of one of them fails every one of them with
     * `is not a function`. The optional call reads as "ask the gate if there is
     * one", and the absent case is the shipped behaviour rather than a
     * plausible default for a missing thing. */
    if (owner.isLocal && this.feelOn?.('shake') !== false) {
      this.engine?.rumble?.(0.20 + res.grade * 0.16, 0.34 + res.grade * 0.14, 45 + res.grade * 22);
    }
    if (res.grade >= GRADE.RETURN) {
      this.notifyFloating(bladePoint, GRADE_NAME[res.grade], '#a8f0ff');
      if (res.grade === GRADE.PERFECT) { this.addHitstop(0.07); this.engine.flash(0.09); }
    }
    this.onDeflectFeedback?.(res.grade, bladePoint, DEFLECT_WHY[res.grade]);
  }

  /**
   * ── A BOLT INTO A BODY, AND THE QUESTION OF WHO BILLS IT ────────────────
   *
   * Every hostile round is fired on BOTH machines. `_spawnNetBolts` puts the
   * host's shots into the client's own pool as real bolts, deliberately and for
   * a reason DESIGN.md is about — a guest has to be able to deflect one, catch
   * it, and send it home — and this hit test then resolves them against the
   * client's own mirrors of the horde. `_reconcileClaims` measures a claim as
   * whatever hp a mirror has lost since the last snapshot "whatever dealt it",
   * so without this the host was billed a second time for its own fire: one
   * round fired by one host trooper, simulated twice and charged twice.
   *
   * Measured before the rule, on a real co-op Command pair on geonosis with the
   * joining player holding `idleInput` and firing nothing: the client's copies
   * of the horde lost 273.1 hp to bolts nobody on that machine had fired, 317
   * claims went back up the wire, and the host applied 42.2 hp of them to the
   * horde ON TOP of the 187.8 hp of the same bolts it had already applied
   * itself — a 22% surcharge on the horde's whole bolt attrition, paid by
   * nothing anybody did.
   *
   * THE RULE IS NOT "DO NOT SIMULATE IT". That would delete the deflection the
   * replication exists to allow. It is:
   *
   *   a replicated bolt that no local hand has touched resolves here exactly as
   *   it resolved on the host, so the host has already billed it — move the
   *   baseline by what it took and claim nothing;
   *
   *   a replicated bolt the local player DEFLECTED, caught and threw, or pulled
   *   out of the air is a bolt whose path only this machine knows about, and
   *   the host cannot have applied it — bill it exactly like any other blow.
   *
   * The discriminator is the OWNER, asked at the moment of the hit rather than
   * stamped by whoever changed it. Every door that takes a bolt off its course
   * — `_creditDeflect`, the catch-and-throw, `Player._launchStasisItem` —
   * writes the new holder into `bolt.owner`, and on a client the only owner
   * that is not a mirror of something the host is simulating is this machine's
   * own player. A list of call sites clearing a flag would be one more list
   * waiting to be forgotten, which is the defect `_reconcileClaims` itself
   * exists to have already fixed.
   *
   * This is the same move `_stepNetEnemies` makes for a shove the host is also
   * integrating, and the mirror image of the rule `RemoteAvatar._tellHit`
   * already applies in the other direction: the host does not bill a peer for a
   * bolt, because the peer is resolving that one itself.
   */
  _boltHurt(e, dmg, hit, bolt) {
    const hp0 = e.hp;
    const killed = e.damage(dmg, hit, bolt.owner, 'bolt');
    this._netBoltBilled(e, hp0, bolt);
    return killed;
  }

  /**
   * The half of `_boltHurt` that is about the wire, split out because the
   * grip-shield's bite is the one bolt hit in this file that does not go
   * through `Enemy.damage` here — it is taken by a closure in Player.js — and
   * a held body is being shot to pieces on the host at the same time.
   *
   * @param hp0  the body's health BEFORE the blow, so this measures what the
   *   game decided rather than what the caller asked for: resistances, armour
   *   and a body already at 3 hp all make those different numbers.
   */
  _netBoltBilled(e, hp0, bolt) {
    if (this.netMode !== 'client' || !bolt.replicated || bolt.owner?.isLocal) return;
    this._netHostDealt(e, hp0);
  }

  /**
   * A BLOW THIS MACHINE WATCHED RATHER THAN STRUCK — the rule, once, for the
   * three doors that reach it.
   *
   * `_reconcileClaims` measures a claim as the gap between the host's last
   * stated health and ours, "whatever dealt it", and that is the right seam:
   * it is why a guest's lightning, choke and rend all reach the host with no
   * call site apiece. What it cannot see is that a client SIMULATES a great
   * deal it did not do — the host's bolts are replicated into its own pool so
   * a guest can deflect one, the host's shoves are integrated locally so a
   * flying body does not stutter, and Rapier resolves the same contacts on
   * both machines because both machines have the same physics world. Every one
   * of those lands on a mirror, and every one of them the host has already
   * billed itself.
   *
   * Moving the BASELINE by what the blow took is the whole rule: it says "this
   * one is already yours" without deleting the simulation, which is what a
   * "don't simulate it" fix would have cost — the deflection the replication
   * exists to allow.
   *
   * Three callers and they were two: `_boltHurt` for a replicated round,
   * `_stepNetEnemies` for what `_move` takes off a body it is carrying, and now
   * `Impact.kineticContact` for a collision. That third one was measured as a
   * live leak by `command-pvp.mjs` and read as a flake for as long as it was
   * one: a joining player holding an idle input still billed the host 0.1 to
   * 0.5 hp a time in `force` damage, from bodies bumping each other in a line
   * of forty, which is a sum that is zero on a quiet frame and not on a busy
   * one. The check that caught it asserts ZERO for exactly that reason.
   *
   * @param hp0 the body's health BEFORE the blow, so this measures what the
   *   game decided rather than what the caller asked for.
   */
  _netHostDealt(e, hp0) {
    if (!e || e._netHp === undefined) return;
    e._netHp -= Math.max(0, hp0 - e.hp);
    /**
     * …AND A BODY THE HOST'S OWN ROUND PUT DOWN HERE IS NOT A KILL TO CLAIM.
     *
     * `_reconcileClaims` bills a mirror this machine has killed and the host
     * still has standing for the WHOLE rest of its health, and that clause is
     * where most of the surcharge actually came from — not from the hp, from
     * the deaths. Rounding puts the two copies a point or two apart, so the
     * client's copy goes down on a round the host's copy survives; the next
     * snapshot writes the host's hp back over a body that is already dead here
     * and resets `_netDead`, and the mirror then claims its own full health
     * every tick for the rest of the session. Measured on the pair: one B1
     * claiming 28 hp and then 0 hp, over and over, off one bolt.
     *
     * A flag rather than `_netDead`, because the snapshot owns that field and
     * rewrites it 18 times a second. This one is a fact about how this copy
     * died and nothing later can make it untrue.
     */
    if (e.dead) { e._netDead = true; e._netHostKill = true; }
  }

  /**
   * A COLLISION, AND WHOSE IT IS. Called by `Impact.kineticContact` around the
   * blow it delivers — see `_netHostDealt` for the rule.
   *
   * The discriminator is the STRIKER'S AUTHOR, which the contact channel
   * already carries: `self.userData.hurledBy` is the hand that put the object
   * in the air, and everything else — a collapse, a blast, one droid shoved
   * into the droid behind it — passes null. So a crate this player threw is
   * this machine's alone (the host never applied that impulse and its copy of
   * the crate is sitting still) and is billed like any other blow; a contact
   * with no author, or with somebody else's, is one both machines just watched
   * happen the same way.
   */
  netContactBilled(e, hp0, source) {
    if (this.netMode !== 'client') return;
    if (source && (source === this.player || source.isLocal)) return;
    this._netHostDealt(e, hp0);
  }

  _boltHitTest(bolt, from, to) {
    // players
    {
      for (const p of this.players) {
        if (!p.alive || p.invuln > 0) continue;
        /**
         * PER VICTIM, NOT PER BOLT.
         *
         * This was `if (bolt.team !== 0)` wrapped around the whole loop — one
         * number deciding for every player in the room at once. In co-op that
         * is right by accident, because every player is on team 0 and every
         * hostile bolt is not. In a duel it is wrong in both directions: a bolt
         * a duellist deflected back carries their team and so could not reach
         * the person it was aimed at, and a bolt from the horde could not be
         * made to spare an ally.
         *
         * `bolt.owner` is whoever fired or last deflected it, and `canHarm` is
         * the same gate `Player.damage` and `bladeTargets` consult. The
         * fallback synthesises the minimum an owner-less bolt needs so a bolt
         * fired before this field existed still behaves as it did.
         */
        if (!canHarm(bolt.owner ?? { team: bolt.team }, p, this.rules)) continue;
        /**
         * A BODY HELD IN FRONT OF YOU IS A SHIELD.
         *
         * The Force grip could lift an enemy or a crate and hold it between the
         * player and a firing line, and bolts went straight through it into the
         * player — because this test knows about players and about enemies and
         * a held thing was neither: an enemy in the air is skipped by the enemy
         * loop only if it is dead, but a bolt aimed at the PLAYER never reaches
         * that loop at all, it returns on the player capsule first.
         *
         * So the held thing is tested BEFORE its holder, and it is tested for
         * every player, because in co-op the useful version of this is holding
         * something in front of your friend.
         *
         * The shield is not free: what it stops, it takes. A droid used as
         * cover is being shot to pieces while you hold it, which is the whole
         * bargain and is why this cannot simply be an invulnerability window.
         */
        /**
         * THE FORCE BARRIER — the sphere, not the held body.
         *
         * Tested FIRST and tested from the outside in: `segmentSphere` hands
         * back the ENTRY point so the flash lands on the surface of the bubble
         * rather than on the player inside it, and it refuses a bolt whose
         * muzzle is already inside the radius. That refusal is the rule that
         * makes the power a barrier instead of an invulnerability window — a
         * droid that walks the two metres in and fires point blank is shooting
         * a man, and the bubble is behind its gun.
         *
         * `shieldAbsorb` is what charges for it: every bolt that dies here
         * costs SHIELD.bolt on top of the per-second hold, and the raise ends
         * the moment the bar cannot pay. See Player.SHIELD.
         */
        const bubble = p.shieldSphere?.();
        if (bubble) {
          const at = segmentSphere(from, to, bubble.c, bubble.r);
          if (at) {
            p.shieldAbsorb(at);
            this.particles.sparkBurst(at, null, 10, { speed: 6, color: 0x8fd8ff });
            return { point: at, normal: _v3.subVectors(from, to).normalize().clone(), victim: null };
          }
        }
        const shield = p.shieldBody?.();
        if (shield) {
          const hit = segmentNear(from, to, shield.p0, shield.p1, shield.r);
          if (hit) {
            /* The bite is a bolt into a body the host also owns, so it is the
             * same billing question the enemy loop below asks. See
             * `_netBoltBilled`. */
            const held = shield.victim, heldHp = held ? held.hp : 0;
            shield.take(bolt.damage, hit, bolt.owner);
            this._netBoltBilled(held, heldHp, bolt);
            this.particles.sparkBurst(hit, null, 8, { speed: 5, color: 0xffc070 });
            return { point: hit, normal: _v3.subVectors(from, to).normalize().clone(), victim: shield.victim };
          }
        }
        _v1.copy(p.position).setY(p.position.y + 0.35);
        _v2.copy(p.position).setY(p.position.y + 1.72);
        const hit = segmentNear(from, to, _v1, _v2, 0.36);
        if (hit) {
          if (p.boonMods.absorb) {
            p.force = Math.min(p.maxForce, p.force + bolt.damage * 0.8);
            p.damage(bolt.damage * 0.45, hit, bolt.owner, 'bolt');
          } else p.damage(bolt.damage, hit, bolt.owner, 'bolt');
          return { point: hit, normal: _v3.subVectors(from, to).normalize().clone(), victim: p };
        }
      }
    }
    // enemies
    for (const e of this.enemies) {
      if (e.dead) continue;
      /* TWO WAYS A DROID'S BOLT MAY HURT A DROID, and they are the same seam.
       *
       * `deflected` is a bolt the player sent back. `turned` is a bolt fired by
       * a unit under Force compulsion, which has not changed sides — it is
       * still team 1 — but has been made to point the wrong way. Sorting purely
       * by team meant a compelled droid's shots passed through the ally it was
       * aiming at, and the ability was an expensive impression of itself.
       *
       * `owner !== e` is deliberately NOT required for a turned bolt: "make an
       * enemy fire on itself" is half of what the note asks for, and a shot
       * that cannot hit the thing that fired it cannot do that. */
      const friendly = bolt.deflected || bolt.turned;
      /**
       * ── AND THIS LINE MADE YOUR ARMY BULLETPROOF. MEASURED. ─────────────
       *
       * It read `if (bolt.team === 1 && !friendly) continue;` — an early-out
       * over the WHOLE loop for every hostile bolt in the game, on the premise
       * the `canHarm` clause below already writes down and contradicts: "the
       * two rules above sort bolts by the literal team 1, which is right for as
       * long as everything in `this.enemies` is on it. Command puts your troops
       * in that same array on the PARTY's team."
       *
       * They do, and this line skipped them too. So in the one mode whose whole
       * subject is a list of names that only shrinks, **the enemy's rifles
       * could not touch it.** Measured on a real Command world on geonosis,
       * ten troopers formed up with a wave shooting at them: 90 seconds, roster
       * 10 of 10, every man at full health, and a synthetic bolt driven
       * straight through a trooper's own capsule mid-line by `_boltHitTest`
       * returns NO HIT while the identical segment through a droid returns the
       * droid. Your line could be killed by a blade, a grenade or a stratagem
       * and by nothing that was fired at it.
       *
       * The `canHarm` call thirty lines down is the real gate and it already
       * gets every one of these cases right — a droid's bolt into a droid is
       * refused for the same team, a droid's bolt into a trooper is allowed
       * because the teams differ. What this line is for is the CHEAP reject
       * that keeps that call off the hot path, so it is restated as the
       * cheap half of the same question: skip only when the bolt and the body
       * are on the same side. It is no longer a statement about the number 1.
       *
       * The owner clause loses its `team === 1` for the same reason — "a body
       * cannot shoot itself" was never a fact about one team.
       */
      if (bolt.team === (e.team ?? 1) && !friendly) continue;
      if (bolt.owner === e && !bolt.turned) continue;
      /**
       * …AND THE THIRD WAY, WHICH IS AN ARMY OF YOUR OWN.
       *
       * The two rules above sort bolts by the literal team 1, which is right
       * for as long as everything in `this.enemies` is on it. Command puts your
       * troops in that same array on the PARTY's team, and their bolts carry
       * their owner's team — so without this line every trooper's rifle would
       * pass the `team === 1` gate above and mow down the squad in front of it.
       *
       * `canHarm` rather than a team comparison, because that is the one gate
       * this game is allowed to answer the question with, and it is the same
       * one the player loop twenty lines up already consults. In every mode
       * with no allies this is one extra call per body per bolt and its answer
       * is always the one the two lines above already gave.
       */
      /* …EXCEPT A TURNED ONE, WHICH IS THE ABILITY.
       *
       * This gate and the `friendly` bypass six lines up disagreed, and the
       * gate won. `turned` means a unit has been MADE to fire on its own side —
       * that is the whole of Force compel and the reason the flag exists — so
       * asking `canHarm` whether a droid may shoot a droid unmakes it: the
       * shooter and its victim are both team 1, friendly fire is off in every
       * mode that is not a duel, and the bolt passed straight through the ally
       * it was aimed at. Measured on the shipped hit test with a real compelled
       * shooter and a real ally at 6 m: the turned bolt found nothing and the
       * ally lost 0.0 hp, in the check whose own note says "a fix that let
       * every enemy bolt hit every enemy would also pass a one-sided test".
       *
       * `deflected` is deliberately NOT included. A bolt the player sent back
       * carries their team, and letting it past this line would put every
       * deflection into their own troopers — which is the exact defect the gate
       * was added for. One flag is an explicit override of the side rule; the
       * other is just a bolt that changed hands.
       */
      if (bolt.owner && !bolt.turned && !canHarm(bolt.owner, e, this.rules)) continue;
      /**
       * ── THE FORCE IS A MULTIPLIER ON OTHER PEOPLE'S GUNS ────────────────
       *
       * FLAGSHIP §7's third verb, and until this line it did not exist:
       *
       *   "OPEN — `openness()` is the most under-used system in the tree (held
       *    ×3.0, yanked ×2.0, downed ×1.5) and its own comment says it is
       *    invisible. Grip a B2 and the ten riflemen who needed 17 seconds need
       *    six. The Force is a multiplier on other people's guns."
       *
       * `grep -rn 'openness(' src/` returned ONE call site — `Combat.js`, the
       * blade's own slash rate — and a comment in the HUD. So a body held off
       * the floor, yanked off balance or toppled was easier for YOUR BLADE to
       * cut and no easier for anybody else to shoot, and the sentence above was
       * a description of a system that had never been wired to a gun.
       *
       * It is exactly why the Dead Jedi test reads the way it does: five seeds,
       * three arms, and the enemy body count does not move (37.4 / 36.8 / 36.4)
       * whatever the Jedi does. The Force could not help the line's guns
       * because nothing asked it to.
       *
       * THE ENEMY BRANCH ONLY, and that is not an oversight. `OPEN_STATES`
       * tests `gripped`, `yankT` and `toppled || stunTimer` — fields a body
       * that the FORCE has taken hold of carries. The player's own bad moments
       * are already priced by the stagger, and multiplying incoming fire while
       * they are staggered is a death spiral rather than a mechanic.
       */
      /**
       * ── A BODY-SPHERE REJECT, BEFORE THE BONES ARE BUILT ──────────────────
       *
       * `Enemy.capsules()` rebuilds every bone of a body from its rig, every
       * time it is asked, and this loop asked it for EVERY enemy on the field
       * for EVERY bolt in the air. Measured on a real Geonosis with the blade
       * lit and 39 live bodies: **463 calls a frame, 8,797 capsule entries, and
       * 16.43 ms** — a quarter of a 60 Hz frame at a fifth of the body count
       * FLAGSHIP §10 measured its own "39% of the frame" at. §10 lists this as
       * item 3 and calls it "a live bug today", which it was.
       *
       * The blade path above already rejects on distance before it gathers; the
       * bolt path had nothing. A segment-versus-sphere test on the body's own
       * bound is the cheapest possible answer and it is exact in the direction
       * that matters: a bolt that misses the sphere cannot touch a bone inside
       * it, so nothing that could have been hit is dropped.
       *
       * THE SPHERE IS MEASURED, NOT GUESSED. A first attempt built it out of
       * `radius` and `chestY`, and that is a trunk width and a chest height,
       * neither of which is a bound: the fan below lost 134 of 13,320 bolts on
       * the dwarf spider alone, whose legs stand its capsules 2.7 m up and well
       * outside the hull radius. `boltBound` instead takes one `capsules()`
       * call and wraps what the body ACTUALLY presents.
       */
      /* `_bolt4` and not a shared scratch: `segmentNear` builds its own
       * working vectors out of `_v4`, `_v5`, `_a` and `_b`, so handing it one
       * of those AS the point it is measuring to is handing it a variable it
       * is about to overwrite. Measured with `_v4`: 5,585 of 13,320 fanned
       * bolts changed their answer, which is a fifth of the roster's hit boxes
       * going missing rather than an optimisation. */
      const bound = this._noBoltReject ? null : boltBound(e);
      if (bound) {
        _bolt4.copy(e.position).setY(e.position.y + bound.y);
        /* `segmentNear` with a degenerate second segment IS a segment-to-point
         * test, and it is the same routine the bone pass below uses — one
         * reader for "does this bolt come within r of that", rather than a
         * second distance function that could disagree with it about a
         * grazing hit. */
        if (!segmentNear(from, to, _bolt4, _bolt4, bound.r)) continue;
      }
      const open = openness(e);
      const caps = e.capsules();
      /* Every pass that got through re-measures for free, so a pose that
       * reaches further than the bake widens the sphere for the next bolt. */
      if (bound) growBoltBound(e, caps);
      for (const c of caps) {
        if (c.shield) {
          const hit = segmentNear(from, to, c.p0, c.p1, c.r);
          if (hit) {
            this._boltHurt(e, bolt.damage * open, hit, bolt);
            this.particles.sparkBurst(hit, null, 10, { speed: 5, color: 0x88ffcc });
            return { point: hit, normal: _v3.subVectors(from, to).normalize().clone(), victim: e, bone: 'shield' };
          }
          continue;
        }
        const hit = segmentNear(from, to, c.p0, c.p1, c.r);
        if (!hit) continue;
        const vital = c.vital ?? 0.4;
        const dmg = bolt.damage * lerp(0.6, 1.9, vital) * open;
        const killed = this._boltHurt(e, dmg, hit, bolt);
        /**
         * ── AND A BOLT SENT HOME BREAKS A NERVE. FLAGSHIP §7's SECOND VERB ──
         *
         *   "TURN — a returned bolt that kills its firer counts on THEIR
         *    morale ledger. Every bolt sent home deletes a rifle and breaks a
         *    nerve. Only 5% RETURN / 9% PERFECT by speed alone: a hundred hours
         *    will not exhaust it."
         *
         * `witnessDeath` has already run inside `damage` — the rank pays for
         * the body either way — and this is the SECOND fact: it was their own
         * fire that did it. Three times the ordinary knock (see NERVE.TURNED),
         * and it is the only term in that table a player earns by skill.
         *
         * `bolt.deflected` AND a deflector, not "the bolt hit the man who fired
         * it". The design's second sentence is the operative one: what breaks a
         * rank is watching its own fire come back, and the return goes to
         * whoever was under the reticle. The strict case — the firer himself —
         * is a subset and `tools/checks/nerve.mjs` reports its share rather
         * than the game paying differently for it.
         */
        if (killed && bolt.deflected && bolt.deflector) turnedHome(this.enemies, e);
        if (bolt.owner instanceof Player) {
          bolt.owner.score += killed ? 150 : 25;
          this.onHitmark?.(hit, killed ? 'kill' : 'hit');
        }
        return { point: hit, normal: _v3.subVectors(from, to).normalize().clone(), victim: e, bone: c.name };
      }
    }
    // props
    for (const pr of this.props) {
      const rr = pr.body.boundingRadius;
      const hit = segmentNear(from, to, pr.body.position, pr.body.position, rr);
      if (hit) {
        pr.damage(bolt.damage * 0.8, hit, _v3.subVectors(to, from).normalize());
        pr.body.applyImpulse(_v3.copy(to).sub(from).normalize().multiplyScalar(bolt.damage * 2.4), hit);
        return { point: hit, normal: _v3.clone().negate(), victim: pr };
      }
    }
    // world
    const dir = _v1.subVectors(to, from);
    const len = dir.length();
    if (len < 1e-6) return null;
    dir.multiplyScalar(1 / len);
    const hit = this.physics.raycast(from, dir, len, (b) => b.static || b.layer === LAYER.DEBRIS || b.layer === LAYER.RAGDOLL);
    if (hit) {
      if (hit.body && hit.body.invMass > 0) hit.body.applyImpulse(_v2.copy(dir).multiplyScalar(bolt.damage * 1.6), hit.point);
      return { point: hit.point.clone(), normal: hit.normal.clone(), victim: null };
    }
    return null;
  }

  _onBoltImpact(bolt, res) {
    this.particles.boltImpact(res.point, res.normal || _v1.set(0, 1, 0), bolt.color.getHex());
    audio.boltHit(res.point);
    if (this.terrain && !res.victim) {
      const gh = this.terrain.height(res.point.x, res.point.z);
      if (Math.abs(res.point.y - gh) < 0.3) {
        this.terrain.crater(res.point.x, res.point.z, 0.55, 0.06);
        this.particles.sandPuff(res.point, 0.35, gh, this.groundColor);
      }
    }
  }

  /* ── callbacks ───────────────────────────────────────────────────── */

  /**
   * SOMETHING BREAKABLE CAME APART — PLAN.md §4.6's Salvage, and the only
   * reader of `Props.shatter`'s new door.
   *
   * "Shattering a prop refunds Insight" is one of that section's own three
   * examples of a facet that changes a RULE rather than a number: an act that
   * has never paid anything starts paying a currency. It is self-limiting
   * without a cooldown or a cap, and deliberately — a level ships about fifty
   * breakable things (measured: 54 on geonosis) and every one of them pays
   * once, so the ceiling is the field itself. It also argues with §4.7's other
   * half in the right direction: cover is finite, and this makes spending it a
   * choice rather than an accident.
   */
  onPropBroken() {
    if (!this.player?.boonMods?.salvage || !this.communion) return 0;
    this.communion.insight += SALVAGE_INSIGHT;
    this.communion.earned += SALVAGE_INSIGHT;
    this.salvaged = (this.salvaged | 0) + 1;
    return SALVAGE_INSIGHT;
  }

  onEnemyKilled(enemy, source, kind) {
    const A = enemy.A;
    /**
     * THE ONE PLACE A DEATH IS VISIBLE CENTRALLY, so it is where both of the
     * things that care about one are hung.
     *
     * `corpses.take` is the budget from note #15: the body has stopped being a
     * fighter and started being a cost, and this is the frame that transition
     * happens on. `command.onDeath` is the roster from note #21: yours is a name
     * off the roll and permanent, theirs is experience for whoever killed it.
     *
     * Both are `?.` because a check drives this method with a five-field stub
     * world, and neither is worth a branch at the call sites that would
     * otherwise have to remember them.
     */
    this.corpses?.take(enemy);
    this.command?.onDeath(enemy, source);
    /**
     * …AND THE MEN AROUND HIM SAW IT. FLAGSHIP §7's BREAK verb.
     *
     * ABOVE the casualty return below, and deliberately: a body coming apart
     * eleven metres away is the same event whichever side it belonged to, and
     * `witnessDeath` reads the side off the corpse so only its own rank pays.
     * Putting it under the return would mean a formation only broke when the
     * player was killing the army the composer happened to call the enemy.
     *
     * Bodies with a roster record are skipped inside `shakeNerve` — a name on a
     * roll is `CommandDirector.shake`'s to move, and it does three more things
     * with the event than this does (the log, the "IS BREAKING" call, the flag
     * the steering reads). This is the half of the field that has no roll.
     */
    witnessDeath(this.enemies, enemy);
    /* BEFORE the casualty return below, and deliberately so: one of your own
     * troopers falling is not a reward, but it is still a body hitting the
     * ground three metres away and it has to make the sound and move the frame.
     * `_killFelt` reads the BODY, not the scoreboard. */
    this._killFelt(enemy, source, kind);
    /* A trooper of yours is not worth score, is not a kill, and does not feed
     * the combo — it is a casualty. Everything below this line is the reward for
     * killing something on the other side, and it must not pay out for losing
     * one of your own. */
    if (enemy.team !== undefined && enemy.team !== 1 && this.command) return;
    /**
     * …AND A CONSCRIPT PAYS NOTHING AT ALL. FLAGSHIP §6's third body class.
     *
     * "6 hp, 1.4 dps, one pass, worth 0 score and 0 Insight. The lawnmower is
     * only a lawnmower when mowing pays. Forty conscripts that pay nothing are
     * weather."
     *
     * Zero score alone does not make that true: the four lines below this one
     * hand out war support, flow, a combo and a kill-feed entry, and every one
     * of them is a reward for the same act. A body worth no score that still
     * fed the Flow meter would be worth MORE than a B1 per second of blade
     * time, which is the exact opposite of the design.
     *
     * DERIVED FROM `score`, not from a second flag. One field says whether a
     * body is worth killing, so a future archetype cannot be half-conscript by
     * forgetting the other one — the class is a property of the roster row and
     * the roster row is one number. `paysOut` is exported so a check can ask
     * the same question the game asks (HANDOFF §2.4).
     *
     * WHAT IT DOES NOT TOUCH: `kills`, because a body that went down went
     * down and the run summary is a record rather than a reward; the corpse
     * budget and the Command roster above, because a conscript's death is
     * still a death on the field; and `_killFelt`, because a body hitting the
     * ground three metres away has to make the sound whatever it was worth.
     */
    if (!paysOut(A)) { if (source instanceof Player || source?.isRemote) source.kills++; return; }
    this.score += A.score;
    /* AND THE FLEET NOTICES. War support is what stratagems cost now, and it
     * builds off the side doing well — see src/game/Support.js. Hung here
     * beside the score because they are the same event answered twice: a body
     * on the other side is down. */
    this.support?.credit('kill');
    /**
     * `instanceof Player` OR a peer's avatar.
     *
     * A RemoteAvatar is in `world.players`, it carries the counters (`kills`,
     * `score`, `combo`), its `heal`/`addFlow` are deliberate no-ops because a
     * peer owns its own health, and it is what `run.kills` sums. Requiring the
     * class meant a friend's kill was credited to nobody: no feed entry, no
     * score, and a party's run summary that undercounted every kill they did
     * not personally land.
     */
    if (source instanceof Player || source?.isRemote) {
      source.kills++;
      source.score += A.score;
      source.addFlow(kind === 'cut' ? 0.16 : 0.08);
      source.combo++;
      source.comboTimer = 3.4;
      if (source.boonMods?.healOnKill) source.heal(source.boonMods.healOnKill);
      this.onKillFeed?.(source.name, A.label, kind);
    }
    if (A.boss || A.big) {
      this.addHitstop(0.12);
      this.engine.flash(0.12);
      this.notify(A.label.toUpperCase() + ' DOWN', 'the field is yours');
    }
  }

  onLimbSevered(enemy, bone, point, source) {
    if (source instanceof Player) {
      this.onHitmark?.(point, 'sever', bone);
      this.report({ type: 'sever', bone, enemy });
    }
  }

  /**
   * ONE PLAYER DIED. THAT IS NOT THE SAME EVENT AS THE PARTY DYING.
   *
   * This method used to be only the second one, and the whole player-facing
   * death flow — `input.enabled = false`, the pointer release, the card, the
   * run record — hangs off `onGameOver`, which requires EVERY entry of
   * `world.players` to be dead. So in co-op the first player to die got nothing
   * at all: pointer still locked, input still enabled, `screens.state` still
   * 'playing', watching their own ragdoll for the rest of the run with Escape →
   * Abandon as the only exit. Measured: local player killed with one live
   * RemoteAvatar present, then 240 frames — onGameOver fired 0 times.
   *
   * And it could never fire late, either: `onPlayerDeath` had exactly one
   * caller, `Player.die()`, so nothing re-evaluated the predicate when the
   * REMOTE body died afterwards — a RemoteAvatar's death is `this.alive = s.a
   * !== 0` in Net.js and raises nothing. That is what `_checkWipe` is for.
   */
  onPlayerDeath(player, source) {
    if (player?.isLocal && this.players.some((p) => p.alive)) this.onLocalDown?.(player, source);
    this._checkWipe();
  }

  /**
   * Is the party down? Called on every death and, in co-op, every frame —
   * because the death that ends the run may be one this machine only ever hears
   * about as a field in a packet.
   */
  _checkWipe() {
    if (this.over || !this.players.length) return false;
    /**
     * A MEETING IS NOT DECIDED BY WHO IS STILL HOLDING A LIGHTSABER.
     *
     * The wipe rule is "every player on this field is down, so the run is
     * over", and it is right for every mode where the players ARE the side. In
     * a meeting the side is an army: `census` counts the commander as one of
     * the standing precisely so that losing your general costs you your orders
     * and not the battle, and `_frame` falls back to the anchor so a leaderless
     * line holds the ground it was on. Two generals who kill each other in the
     * opening pass would otherwise end a match with twenty bodies still firing
     * — and end it as a DEFEAT for both, when the field is about to belong to
     * one of them. `DuelMatch` is the authority here and it is already running.
     */
    if (this.match && !this.match.over) return false;
    if (this.players.every(p => !p.alive)) {
      /**
       * THE RUN IS OVER. THE WORLD IS NOT.
       *
       * This used to set `running = false`, and `update()`'s first line returns
       * on that — so from the frame after the last player died, nothing in the
       * game stepped at all. Which means every piece of machinery written for
       * the most important moment in a run was unreachable in a solo game:
       * `Player.die()` dynamically imports Ragdoll.js and builds an Actor, and
       * nothing ever stepped it, so the corpse stood upright in the pose it
       * died in; `_updateDead` exists solely to pull the camera back to 4.4 m
       * and ease the pitch to -0.42, and it never ran; `saber.retract()` was
       * called and the blade never retracted. Measured headless over 180 frames
       * after a kill: world.time frozen at 0.500, camera moved 0.000000 m, rig
       * moved 0.000000 m, ignition unchanged to fifteen decimal places, 31
       * physics bodies with no step. The death card lands 2.6 s later, so every
       * death in the game was a 2.6-second still frame.
       *
       * `over` is the flag the things that must stop read — the director, which
       * would otherwise keep sending waves at a corpse. Everything else keeps
       * ticking, which is what makes the death sequence a sequence. `paused` is
       * still there for when an overlay genuinely owns the screen.
       */
      this.over = true;
      /* A LOST SKIRMISH IS STILL A DECIDED BATTLE, so the plan is closed before
       * the card goes up: `won` is what the record is keyed on and a plan left
       * at `won: null` would report a battle nobody lost. Through the flag and
       * not through `_endSkirmish`, which returns on `this.over` on purpose —
       * there is exactly one ending and this is it. */
      if (this.skirmish && !this.skirmish.done) { this.skirmish.done = true; this.skirmish.won = false; }
      if (this.campaign && !this.campaign.done) { this.campaign.done = true; this.campaign.won = false; }
      /* …AND IT IS SAID OUT LOUD. The flags above decided the battle and
       * nothing told the player: the last line on screen was the banner of the
       * engagement they died in. `_announceBattle` is the victory's own
       * sentence and cue with the verdict as its argument, and it returns false
       * in the endless modes — which have no verdict to announce and whose card
       * is the whole of their ending. */
      const decided = this._announceBattle(false);
      /* `won: false` EXACTLY WHEN THERE WAS SOMETHING TO LOSE, and the
       * announcement is what knows: it returns false in the endless modes,
       * which have no verdict and whose summary must not claim one. Two tests
       * of one question — this used to ask `skirmish || campaign` while the
       * sentence asked something wider — is the twin this file keeps deleting. */
      this.onGameOver?.(this.runStats(decided ? { won: false } : null));
      return true;
    }
    return false;
  }

  /**
   * Take a boon — on THIS machine's players only.
   *
   * This used to loop every entry of `this.players`, and a RemoteAvatar is in
   * that list and has no `applyBoon`: drafting a single card in co-op threw a
   * TypeError. It was also wrong in principle even without the crash, because a
   * build belongs to a player. Each machine drafts its own card from its own
   * taken-set, so two people climbing the Spire together arrive at the top with
   * different runs — which is the point of a draft.
   */
  /**
   * A wave was survived, so the Force has something to say.
   *
   * A METHOD, not four lines inside `onWaveClear`. This used to say it was
   * forced: tools/checks/run.mjs read "the first 1600 characters after
   * `onWaveClear = `" and required the rung signal to be inside that window.
   * The check now reads the callback to its real end, so the budget is gone —
   * what remains true is the narrower claim, that the rung signal must be
   * inside the wave-clear callback and not fired from anywhere in the file.
   *
   * The mirror into the run happens HERE rather than at the landing, because a
   * run that ends mid-rung still has to report what it earned: `summary()` is
   * read off a corpse as well as off a winner.
   */
  _earnInsight(wave) {
    /**
     * …AT THE RATE THE MODE IS PAID AT, which was one rate for every mode.
     *
     * A mode with no draft has the Holocron and nothing else, and 1/wave against
     * an arithmetic price series bought it four facets in forty waves. See
     * LivingForce's TRIAL_INSIGHT_PER_WAVE for the derivation; `director.drafts`
     * is the shipped statement of which modes hand out cards, called here rather
     * than restated as a mode name.
     */
    /**
     * …AND AT THE RATE THE RUN'S OWN TERMS PAY — PLAN.md §4.6.
     *
     * `director.hazard` is `1 + Σ worth` over the rules the player authored on
     * the Deploy panel, which is the same share `conditionCost` charges the
     * director for dealing one and deliberately does not charge for a rule. So
     * a wave under DELUGE is 30% more fight and pays 30% more Insight, and the
     * exchange rate cannot drift from the price because it IS the price.
     *
     * `?? 1` and not a mode test: `DojoDirector` has no rules and no hazard,
     * and a run under no rules multiplies by one.
     */
    const gained = this.communion.earn(wave, !!this.director?.isBossWave?.(wave),
      insightRate(this.director?.drafts !== false, this.director?.hazard ?? 1));
    this.onInsight?.(gained, this.communion);
  }

  applyBoon(boon) {
    this.takenBoons.take(boon.id);
    for (const p of this.players) if (typeof p.applyBoon === 'function') p.applyBoon(boon);
    // How hard the ground is hit scales with how strong the player has become,
    // and `might` is otherwise fixed at dressing time — so a boon taken mid-run
    // would not have landed until the next level. See Levels.groundMight.
    this.terrain?.setMight?.(groundMight(this));
    this.director.resumeAfterDraft();
    this.notify(boon.name.toUpperCase(), boon.tag);
  }

  /* ── networking ──────────────────────────────────────────────────── */

  attachNet(net, mode) {
    this.net = net;
    this.netMode = mode;            // 'host' | 'client'
    this.remotes = new Map();
    this._netAccum = 0;
    this._netEnemyIndex = new Map();
    this._netPack = { packAvatar, packSnapshot };
    this._netFires = [];
    /* …and the grenades, on the same wire and for the same reason. */
    this._netNades = [];
    this._netBlasts = [];
    /* …and the architecture. A wall coming down is a thing that HAPPENS too,
     * and it was the last big class of them that was not on the wire: measured
     * over the pair harness, 8 of 11 pieces the host demolished were still
     * standing on the joining player's screen. Filled by
     * `Destruction._netRecord`, drained by `packSnapshot`, replayed by
     * `_spawnNetRubble`. The whole argument is in src/world/Destruction.js's
     * REPLICATION block. */
    this._netRubble = [];
    this._netWave = { w: this.director?.wave ?? 1, act: 0, started: false };
    if (mode === 'host') { this._recordFires(); this._recordNades(); }
    if (mode === 'client') this._netDirector();
  }

  /**
   * EVERY BOLT THE HORDE FIRES, AS AN EVENT.
   *
   * A snapshot is a set of STATES, and a shot is not a state: it exists for the
   * 55 ms between two packets and is gone. That is the whole reason a joining
   * player saw an empty firefight — there is no arrangement of position and hp
   * fields that can contain a muzzle flash.
   *
   * Recorded at the pool rather than at the shooter because `BoltPool.fire` is
   * the one seam every shot in the game passes through (`grep -rn '\.fire('
   * src/` outside Bolts.js returns exactly one line, Enemy._shoot) — so this
   * cannot miss a caller, and a new kind of shooter is replicated the day it is
   * written rather than the day somebody remembers to add it here.
   */
  /**
   * EVERY GRENADE THE FIELD THROWS, AS AN EVENT — the same shape as the bolts
   * one below it, and for the same reason.
   *
   * A snapshot is a set of STATES, and a grenade is not a state either: it is
   * an arc, a shout, a body diving away from it and a hole in the ground, all
   * of which happen and are over. `NEXT.md` had it as an open gap in exactly
   * those words — *"GrenadeField is host-side only, so a co-op client sees no
   * grenade, no shout and no crater. Not a desync — a gap."*
   *
   * RECORDED AT THE FIELD rather than at the thrower, because
   * `GrenadeField.throw` is the one seam every grenade in the game passes
   * through — `Enemy._maybeGrenade` throws one, `Reactions.stepReaction`
   * throws one back, and anything written next month goes through the same
   * door. That is the argument `_recordFires` makes and it is the reason
   * neither of these can miss a caller.
   *
   * WHAT CROSSES: where it left, where it was aimed, whose it is and how long
   * is left on the fuse. The client rebuilds the arc from those four rather
   * than being streamed a position every frame — `LiveGrenade` derives its
   * flight time and its apex from the throw alone, so the two ends agree
   * without a byte per frame, and a grenade that has been thrown BACK is
   * simply a second event.
   */
  _recordNades() {
    const field = this.grenades;
    if (!field || field._netRecorder) return;
    const inner = field.throw.bind(field);
    field._netRecorder = true;
    field.throw = (from, to, opts = {}, ...rest) => {
      const g = inner(from, to, opts, ...rest);
      if (g && this._netNades && this.netMode === 'host' && !opts.ghost) {
        this._netNades.push([
          r2(from.x), r2(from.y), r2(from.z),
          r2(to.x), r2(to.y), r2(to.z),
          opts.owner?.team ?? opts.team ?? 1,
          Math.round((g.fuse - g.t) * 100) / 100,
        ]);
      }
      return g;
    };
  }

  /**
   * …AND THE CLIENT'S COPY IS A PICTURE. See `Reactions.LiveGrenade`'s `ghost`.
   *
   * It flies the same arc, makes the same noise, is dived away from by the
   * same men and leaves the same hole — and it does no damage at all, because
   * the host already did it and the result arrives as hp in the next snapshot.
   * A client that also applied the blast would kill the same droid twice on
   * its own screen and then be corrected, which is the visible version of a
   * desync.
   */
  _spawnNetNades(nades) {
    if (!nades || !nades.length || !this.grenades) return;
    for (const n of nades) {
      const [x, y, z, tx, ty, tz, team, fuse] = n;
      _v1.set(x, y, z); _v2.set(tx, ty, tz);
      this.grenades.throw(_v1, _v2, { team, fuse, ghost: true });
    }
  }

  /** …and the client's copy of a blast, for the reason `_spawnNetNades` gives. */
  _spawnNetBlasts(blasts) {
    if (!blasts || !blasts.length) return;
    for (const b of blasts) {
      const [x, y, z, size] = b;
      /* Through `this.onExplosion` and NOT the World method by name, because
       * Destruction replaces the property with a wrapper at load and the
       * structural half of the blast lives in that wrapper.
       *
       * That wrapper now REFUSES on a client — every break arrives on `rb`
       * instead, `_spawnNetRubble` below — and this call still has to go
       * through it, because a wrapper that is asked and declines is the only
       * shape that keeps one door for the whole thing. See Destruction's
       * `_netAllows`. */
      /* NOT a shared scratch vector: `onExplosion` writes `_v1` in its own
       * body loop, and passing `_v1` in as `centre` means every body after the
       * first is shoved away from a point that has already been overwritten. */
      this.onExplosion(_blastAt.set(x, y, z), size, { ghost: true });
    }
  }

  /**
   * …AND THE CLIENT'S COPY OF A BUILDING COMING DOWN, for the reason
   * `_spawnNetNades` gives about the grenade: the host has already decided
   * what fell, and a client that decided for itself would be holding a
   * different level from the one everybody else is fighting in.
   *
   * The whole of the replay is in src/world/Destruction.js — one call rather
   * than a loop here, because which piece an event names and what it does to
   * it is that file's business and not this one's, and a second copy of the
   * decoding beside the encoder is this repository's signature defect.
   */
  _spawnNetRubble(list) {
    if (!list || !list.length) return 0;
    return this.destruction?.netReplay?.(list) ?? 0;
  }

  _recordFires() {
    const pool = this.bolts;
    if (!pool || pool._netRecorder) return;
    const inner = pool.fire.bind(pool);
    pool._netRecorder = true;
    /* Variadic past the three it reads, for the reason `installTeamDamage` is:
     * a wrapper that names the whole argument list has taken a position on a
     * signature it does not own, and it goes silently wrong the day that list
     * grows — which is exactly how a fifth parameter on `Enemy.damage` came to
     * be dropped by four different wrappers in this tree. */
    pool.fire = (origin, dir, opts = {}, ...rest) => {
      const b = inner(origin, dir, opts, ...rest);
      if (b && this._netFires && this.netMode === 'host') {
        this._netFires.push([
          opts.owner?.id ?? 0,
          r2(origin.x), r2(origin.y), r2(origin.z),
          r3(dir.x), r3(dir.y), r3(dir.z),
          Math.round(b.speed), Math.round(b.damage * 10) / 10,
          b.color.getHex(), b.big ? 1 : 0, opts.turned ? 1 : 0,
        ]);
      }
      return b;
    };
  }

  /**
   * THE CLIENT'S DIRECTOR IS A SHELL, so it has to be told what it would know.
   *
   * `WaveDirector.update` never runs on a client (see the gate in update()), so
   * `remaining` — a getter over the spawn queue, the arrivals in transit and
   * the live local enemies — computes over three empty things and reports the
   * handful of bodies that happen to be on screen. The HUD prints that number.
   * The correct one arrives in every snapshot as `rem` and was written to
   * `director._netRemaining`, where nothing read it.
   *
   * Defined on the INSTANCE, over the prototype's getter, because the shell is
   * a property of this director and not of the class: a host's director must
   * keep counting its own queue.
   */
  _netDirector() {
    const d = this.director;
    /* …AND THE ARMY THIS MACHINE INVENTED FOR ITSELF. `CommandDirector`'s
     * constructor musters ten troopers on every machine in the session and a
     * client deploys none of them, so a joining player's roster panel was ten
     * names that could never fight, never fall and never appear on anybody
     * else's screen. See `CommandDirector.netShell`. */
    this.command?.netShell?.();
    if (!d || Object.prototype.hasOwnProperty.call(d, 'remaining')) return;
    Object.defineProperty(d, 'remaining', {
      configurable: true,
      get() { return this._netRemaining ?? 0; },
    });
  }

  _netTick(rawDt) {
    const net = this.net;
    if (!net || !net.connected) return;
    // `Net` answers a ping with a pong and derives `latency` from the round
    // trip, and NOTHING EVER SENT A PING — so the number it publishes was
    // whatever it was initialised to, for the whole session. Same shape as the
    // claim: a wire built at one end.
    this._pingAccum = (this._pingAccum || 0) + rawDt;
    if (this._pingAccum > 2 && this.netMode === 'client') {
      this._pingAccum = 0;
      net.toHost({ t: 'ping', s: performance.now() });
    }
    this._netAccum += rawDt;
    const interval = 1 / (this.netMode === 'host' ? 18 : 24);
    if (this._netAccum < interval) return;
    this._netAccum = 0;

    // A peer that stopped talking without closing its connection. PeerJS only
    // raises `close` on a clean teardown, so without this a lid closing left a
    // ghost in the roster and in every other player's world forever.
    if (this.netMode === 'host') net.sweep?.();
    if (this.netMode === 'client') this._reconcileClaims();

    if (this.player) {
      const { packAvatar, packSnapshot } = this._netPack;
      net.broadcast(packAvatar(this.player));
      if (this.netMode === 'host') net.broadcast(packSnapshot(this));
    }
    if (this.netMode === 'host') this._armyTick(net);
    this._bondTick(net);
  }

  /**
   * THE ARMY, AS A FACT ABOUT THE CAMPAIGN RATHER THAN ABOUT A FRAME.
   *
   * Nothing about the roster was on the wire at all: not a name, not a rank,
   * not an experience total, not the area, not the formation, not who had
   * fallen. A joining player's Command HUD was fed entirely by a director that
   * had mustered its own ten strangers and never deployed one of them.
   *
   * SENT WHOLE, AND ONLY WHEN IT CHANGES.
   *
   * Whole, because a roster is a hundred small fields that move together — a
   * promotion is a rank, a title, an experience total and a colour at once —
   * and a diff of that is a second encoder with its own opinion about which
   * fields go together, which is precisely the shape that produced a twelve-slot
   * record against a thirteen-slot packer. `readout()` is already the single
   * authority for what a campaign looks like from outside; this puts THAT
   * object on the wire and the far end returns it verbatim.
   *
   * On change, because it is not a per-frame quantity. The comparison is over
   * the serialised payload itself rather than over a list of fields somebody
   * remembered to include — a hand-kept signature beside a generated payload is
   * the twin defect again, and it fails silently in the direction where a
   * promotion never reaches the other machine.
   *
   * `ARMY_INTERVAL` bounds the worst case rather than setting the pace. A
   * twenty-four man roll is about 2.5 KB and every kill moves it, so an
   * unbounded on-change send during a firefight would cost more than the
   * snapshot does; half a second is imperceptible on a roster panel and caps it
   * at 5 KB/s in the worst composition the mode can field. Zero the rest of the
   * time, which is most of the time.
   */
  _armyTick(net) {
    const d = this.command;
    if (!d) return;
    if (this.time - (this._armyAt ?? -ARMY_INTERVAL) < ARMY_INTERVAL) return;
    this._armyAt = this.time;
    /**
     * ADDRESSED IN A MEETING, BROADCAST IN A CAMPAIGN — and the difference is
     * not an optimisation, it is the difference between a joining commander
     * seeing their own army and seeing somebody else's.
     *
     * In co-op there is one army and everybody in the session is leading it, so
     * one readout is the truth on every screen. In a meeting each commander has
     * a roster, a rank ladder and a casualty list of their OWN, and a broadcast
     * of the host's would put the Republic's dead down the side of the
     * Confederacy's screen. `readout(c)` takes the commander for exactly this.
     *
     * Keyed per peer for the change test as well, or a two-army session would
     * compare the Confederacy's payload against the Republic's and resend both
     * every half second forever.
     */
    if (!d.versus || d.commanders.length < 2) {
      const s = JSON.stringify(d.readout());
      if (s === this._armyLast) return;
      this._armyLast = s;
      net.broadcast({ t: 'army', r: JSON.parse(s) });
      return;
    }
    const sent = (this._armyPer ||= new Map());
    for (const c of d.commanders) {
      const id = c.player?.id;
      if (!id || c.player === this.player) continue;
      const s = JSON.stringify(d.readout(c));
      if (sent.get(id) === s) continue;
      sent.set(id, s);
      net.toPeer(id, { t: 'army', r: JSON.parse(s) });
    }
  }

  /* ── two commanders ─────────────────────────────────────────────────── */

  /**
   * TWO SIDES COMMAND TWO DIFFERENT ARMIES AND MEET ON THE BATTLEFIELD.
   *
   * The owner's headline question, and this is the call that answers it. Five
   * things, and each of them was the reason it could not happen:
   *
   *   A SIDE PER COMMANDER, from `sideTeam` — the only function allowed to
   *     invent one. Everything downstream is already generic: `canHarm` is the
   *     one gate every damage path consults, `hostileTo` is what both armies
   *     pick targets through, and `_boltHitTest` asks the same question of a
   *     bolt as `bladeTargets` does of a blade. None of them needed a line.
   *   AN ARMY PER COMMANDER, from `assignArmies`, so two Jedi hosting each
   *     other are the Republic and the Confederacy rather than the Republic
   *     twice. See its note: the order still picks first, the CONFLICT is what
   *     is resolved.
   *   TWO ANCHORS, from `formUp`. `pickSpawn` and the arrival ring both assume
   *     one player at the centre of the world.
   *   THE PLAYERS THEMSELVES moved onto those anchors, because a commander
   *     standing in the other army's line is not a meeting.
   *   A WIN CONDITION, which is `DuelMatch` unchanged — see `census`.
   *
   * IDEMPOTENT, and that is not defensive coding. In a real session the peer's
   * body does not exist until their first avatar packet arrives, which is after
   * the world is standing; calling this again once it does is how the second
   * commander gets a body to lead. Until then their army holds its anchor,
   * which `_frame` supports on purpose.
   *
   * Returns the commanders, so a caller can say who is leading what.
   */
  /**
   * A SECOND PLAYER ON YOUR SIDE, TAKING A SQUAD OUT OF YOUR ROSTER.
   *
   * FLAGSHIP §9: "`SQUAD = 5` is already the unit and `CommandRoster.squads()`
   * already slices the living list into fives. Four players take four squads
   * out of one roster of up to 24."
   *
   * `beginVersus` above is the OTHER answer to a second player — two armies
   * facing each other — and it was the only one that existed: a peer joining a
   * Command run got a body, a blade and no army at all, because nothing
   * anywhere called `enlistCommander` outside a meeting. So co-op in the
   * flagship mode was one general and up to three tourists.
   *
   * ONE ROSTER IS WHAT MAKES IT ONE LINE RATHER THAN FOUR. The commander is
   * enlisted on the local commander's side and army, which is the key
   * `CommandDirector._rosterFor` deals on, so the joining player shares the
   * roll, shares the purse — §9's actual co-op mechanic, "a Heavy for your
   * squad or an ARC for mine" — and musters nobody new. `squadsOf` deals the
   * squads that already exist between however many people are holding them.
   *
   * HOST ONLY, like every other authority in this file: a client's director is
   * a shell that says what it was told (`_netShell`), and a shell that enlisted
   * commanders of its own would be inventing an army the host does not have.
   *
   * @returns the Commander, or null when this is not that kind of session.
   */
  seatAlly(player) {
    const d = this.command;
    if (!d || d.versus || !player) return null;
    if (this.netMode !== 'host') return null;
    const mine = d.commander;
    if (!mine) return null;
    /* THE SAME SIDE. `canHarm` is the one gate every damage path consults and
     * it reads the number — a co-op ally on side 0 while the host is on side 2
     * is a friendly fire incident waiting for the first sweep. */
    player.team = mine.side;
    return d.enlistCommander({ player, side: mine.side, army: mine.army });
  }

  beginVersus(players = null) {
    const d = this.command;
    if (!d || !d.versus) return null;
    const list = (players || this.players).filter((p) => p && p.alive !== false);
    if (!list.length) return null;

    /**
     * ONE SIDE PER ARMY, AND THE RULE IS `assignSides`' — CALLED, NOT RESTATED.
     *
     * It used to be `sideTeam(i)`: a side of its own for every commander, up to
     * the four `SIDES` holds. That is right for a free-for-all and it is not
     * what this mode can field. Driven at four commanders, which had never been
     * done: four sides against a roster of TWO armies, so the third and fourth
     * commanders fielded somebody else's units in somebody else's colours; two
     * commanders sharing each end of `formUp`'s line while opposed to each
     * other; and a `DuelMatch` whose `sides` carried the same number twice — so
     * its "one side left standing" filter counted a wiped-out army as two
     * survivors and the battle could not end at all.
     *
     * `ARMY_IDS.length` rather than a 2, because that is where the limit comes
     * from: a side with no army has no units, no paint and no enemy list.
     * `assignSides` rather than `i % 2`, because it is the same question the
     * duel already answers and its own note already writes this file's answer
     * down — "the roster alternates, so a four-player session is 2v2 in roster
     * order and a three-player one is 2v1 with the host on the larger side".
     * A second copy of that sentence here is the shape this repository has paid
     * for six times. The keys are indices because a local Player carries no
     * peer id and the answer is positional either way.
     *
     * Identical for two commanders, which is every session that has run. An odd
     * count is a 2v1 rather than a refusal: an uneven meeting is a real thing to
     * want and stranding the third player is not.
     */
    const seats = assignSides(list.map((_, i) => ({ id: i })), ARMY_IDS.length);
    /**
     * …AND THE HOST MAY SAY OTHERWISE, WHICH IS THE WHOLE MODE.
     *
     * "you and your friends can choose to be either allies or enemy
     * commanders." `assignSides` alternates down the roster, so the only way to
     * change who is with whom was to change who joined first — which is not a
     * choice, it is a race. `versusTeams` is the host's stated map from peer id
     * to side, written in the lobby and carried on `SESSION_KEYS`, and
     * `versusCommandConfig` is the one thing that reads it.
     *
     * PER PLAYER, FALLING BACK PER PLAYER. A host who has moved one name and
     * left the rest alone gets exactly that: the one they moved goes where they
     * put it and everybody else alternates as before. An empty map is the
     * shipped behaviour, byte for byte.
     *
     * AND IT CANNOT EMPTY THE FIELD. Every commander on one side is a battle
     * with nobody in it — `beginVersus` would build no match, `_aloneAt` would
     * announce it and the mode would look broken — so a stated map that leaves
     * fewer than two sides standing is refused as a whole and the alternation
     * is used. Refused rather than patched, because a half-honoured seating
     * chart puts somebody somewhere nobody asked for.
     */
    const plan = d.meetingPlan;
    const idOf = (p, i) => (p === this.player ? (this.net?.peer?.id ?? 'host') : (p?.id ?? i));
    let sides = list.map((_, i) => seats.get(i));
    if (plan?.seats?.size) {
      const asked = list.map((p, i) => {
        const seat = plan.seats.get(String(idOf(p, i)));
        return seat === undefined ? seats.get(i) : sideTeam(seat);
      });
      if (new Set(asked).size >= 2) sides = asked;
      else {
        this.notify('SIDES IGNORED',
          'every commander was put on one side — falling back to alternating the roster', 'alarm');
      }
    }
    /**
     * …AND AN ARMY PER SIDE, so two allies lead one and wear one colour.
     *
     * Every commander is read as the HOST's own order, and that is measured
     * rather than tolerated. `LOOK_KEYS` leaves `order` off the wire, so a
     * commander this machine cannot ask has no stated choice — and it turns out
     * not to matter: `assignArmies` gives the first commander what they ask for
     * and resolves everything after that against what is already taken, so with
     * two armies the second side gets whichever one is left whatever it wanted.
     * Enumerated over every roster of two, three and four commanders and both
     * orders apiece, the peer's real order changes the assignment in 0 of 28.
     * The note in Net.js carries the same measurement, because that is where
     * somebody will next be tempted to add the field.
     */
    const armies = assignArmies(list.map((p) => p.order || this.settings?.order || 'jedi'), sides);
    d.formUp(sides, armies, list);

    for (let i = 0; i < list.length; i++) {
      const p = list[i], c = d.commanders[i];
      p.team = sides[i];
      if (p === this.player) this.partyTeam = sides[i];
      /**
       * Onto their own end of the field — a remote body too, and that is not
       * cosmetic. A formation is solved in its commander's frame, so a
       * commander standing at the origin has their whole army walking back to
       * the middle of the plain. A remote body is a DRAWING of one on another
       * machine and its own next packet overwrites this; until that packet
       * arrives, its army's frame has to be somewhere true, and the peer's own
       * machine puts them here too (see `applySeat`).
       */
      if (p.position && c?.anchor) {
        p.position.copy(c.anchor);
        p.actor?.setPosition?.(c.anchor);
      }
    }

    /**
     * …AND TELL THE OTHER MACHINES, because a side and a seat are exactly the
     * two things a client cannot work out for itself.
     *
     * `assignSides` and `Net.setSides` both existed, complete, with ZERO
     * CALLERS anywhere in the repository — the same wire-built-at-one-end shape
     * `claim` and `toHost` were. So every remote body in every session was on
     * side 0 whatever the host had decided, and a client's own local player was
     * built by `spawnPlayer` with no team at all.
     *
     * The SEAT goes with it, and without it the sides alone are not enough: a
     * client told it was the Confederacy but not where the Confederacy stands
     * spawns at the level's home spot, in the middle of the Republic's line,
     * with its own army forming up around it — because a formation is solved in
     * its commander's frame. Both machines internally consistent, and no two
     * sides on the field.
     */
    if (this.netMode === 'host' && this.net?.setSides) {
      const teams = new Map(), seats = new Map();
      for (let i = 0; i < list.length; i++) {
        /* The host's own id is the PEER's, not a field on the Player — only a
         * RemoteAvatar carries one, because only a remote body needs to be
         * addressed. Without this the host is absent from its own map and
         * `_sideOf` falls back to the party's 0, which is right today only
         * because the host happens to be first in the roster. */
        const id = list[i] === this.player ? this.net.peer?.id : list[i].id;
        if (!id) continue;
        const a = d.commanders[i]?.anchor;
        teams.set(id, sides[i]);
        if (a) seats.set(id, { at: [r2(a.x), r2(a.y), r2(a.z)], facing: d.commanders[i].facing });
      }
      this.net.setSides(teams);
      this.net.setSeats?.(seats);
    }

    /**
     * NO MATCH UNTIL THERE IS SOMEBODY TO HAVE ONE WITH.
     *
     * `DuelMatch` ends a round when one side is left standing, so a match built
     * with ONE side ends on the frame the countdown does — a host who deploys
     * into a meeting before their opponent's body has arrived would be handed
     * the field against nobody, three seconds in, and the peer would join a
     * finished battle. `beginVersus` is idempotent and runs again when that
     * body appears, which is where the match is really made.
     */
    /* The sides IN PLAY, each named once. `DuelMatch` keys its scores on the
     * side and filters `sides` for who is still standing, so the same number
     * twice — which is what a 2v2 hands it — makes a wiped-out side look like
     * two survivors and the round never ends. */
    const fielded = [...new Set(sides)];
    if (!this.match && fielded.length >= 2) {
      this.match = new DuelMatch(this.rules, fielded);
      this._matchSent = '';
    }
    /**
     * …AND A HOST WHO TURNED THIS ON AND IS STANDING HERE ALONE IS TOLD SO.
     *
     * The line above is why they are not simply handed the field three seconds
     * in — a match needs two sides — and the cost of that fix was silence: an
     * army deployed onto an empty plain, a countdown that never starts, no
     * opponent, and nothing anywhere saying why. The player's own reading of
     * that is that the mode is broken.
     *
     * Said ONCE per spell of being alone. `beginVersus` is idempotent and
     * main.js calls it again on every roster change, so an unguarded notify
     * would be a banner every time anybody's name moved; and clearing the flag
     * when a second side does arrive is what makes it say so AGAIN if that
     * opponent then leaves, which is the same fact arriving the other way
     * round.
     */
    if (fielded.length < 2) {
      if (!this._aloneAt) {
        this._aloneAt = true;
        this.notify('NO OPPONENT YET', this.net?.code
          ? `a meeting needs a second commander — share the code ${this.net.code}`
          : 'a meeting needs a second commander — this is a session for two');
      }
    } else this._aloneAt = false;
    if (!d.active) d.start(1);
    else d.deployAll();
    return d.commanders;
  }

  /**
   * THE HOST HAS TOLD US WHICH SIDE WE ARE ON AND WHERE WE STAND.
   *
   * Applied to the LOCAL player from this machine's own roster entry, so a
   * joining commander is on their own side, standing on their own ground, with
   * their own army's anchor under them. Everything downstream is already
   * generic — `canHarm`, `partyTeam`, the HUD's hostile count — so this is the
   * one write the whole client half of a meeting needs.
   *
   * Idempotent and order-free on purpose: the roster arrives more than once and
   * may arrive before or after the world is built, so this is safe to call on
   * every one of them and does nothing when there is nothing new to say.
   */
  applySeat(entry) {
    const p = this.player;
    if (!entry || !p || this.netMode !== 'client') return false;
    let moved = false;
    const team = asTeam(entry.team);
    if (p.team !== team) {
      p.team = team;
      this.partyTeam = team;
      const c = this.command?.commander;
      if (c) c.side = team;
      moved = true;
    }
    const at = entry.at;
    if (Array.isArray(at) && at.length === 3 && this._seatAt !== at.join()) {
      this._seatAt = at.join();
      _v1.set(at[0], at[1], at[2]);
      p.position.copy(_v1);
      p.actor?.setPosition?.(_v1);
      if (p.camera && entry.facing !== undefined) p.camera.yaw = entry.facing;
      const c = this.command?.commander;
      if (c) { c.anchor = _v1.clone(); c.facing = entry.facing ?? 0; }
      moved = true;
    }
    return moved;
  }

  /**
   * THE MEETING'S OWN CLOCK.
   *
   * The host drives the match and everybody else receives it, for the reason
   * `Net`'s `match` case gives: a round ends when a side has nothing standing,
   * and the only node that can see every body is the host — a client knows its
   * own health for certain and everybody else's as of 90 ms ago, so a client
   * that scored its own rounds would award itself one every time a packet was
   * late.
   *
   * Sent on a phase change rather than at the snapshot rate. The record is
   * under 150 bytes and changes about four times a match; folding it into the
   * 18 Hz snapshot would spend 2.7 KB/s saying the same thing eighteen times.
   */
  _matchTick(dt) {
    const m = this.match, d = this.command;
    if (!m || !d || this.netMode === 'client' || this.over) return;
    const { standing, health, generals } = d.census();
    /**
     * WHICH TALLY DECIDES THE ROUND — the meeting's win condition, applied at
     * the one line that can apply it.
     *
     * `DuelMatch.update` asks "how many of this side are still in it" and ends
     * the round when only one side answers above zero. That question has more
     * than one honest answer now, and which one is right is the player's pick
     * rather than the match's business — so the CENSUS is chosen here and the
     * match is left as the one thing that knows about rounds, clocks and
     * scores. `VERSUS_WINS[key].counts` is the whole switch; adding a fourth
     * condition is a row in that table and a tally in `census()`, not a branch
     * in here.
     *
     * `commanders` is the interesting one: the armies still fight and still
     * matter, because they are what stands between you and the other general,
     * but the battle is decided by the people playing it.
     */
    const rule = d.meetingPlan?.rule;
    const tally = rule?.counts === 'generals' ? generals : standing;
    const events = m.update(dt, tally, health);
    for (const ev of events) {
      if (ev.type === 'fight') this.notify('ENGAGE', `${d.commander.army.name} against ${d.commander.foe.name}`);
      if (ev.type !== 'match-end') continue;
      this._endMeeting(m.winner);
    }
    if (this.net?.connected && this.netMode === 'host') {
      const rec = packMatch(m);
      const s = JSON.stringify(rec);
      if (s !== this._matchSent) { this._matchSent = s; this.net.broadcast(rec); }
    }
  }

  /**
   * THE MEETING IS DECIDED.
   *
   * Through `onGameOver` with `won` on it, which is the door `_endCampaign`
   * already uses and the one event in the tree that stops the director,
   * releases the pointer, shows a card and writes the record. `won` is answered
   * for THIS machine — the same match is a victory on one screen and a defeat
   * on the other, which is the first time that has been true of anything in
   * this game.
   */
  _endMeeting(winner) {
    if (this.over) return;
    this.over = true;
    const d = this.command;
    if (d) d.done = true;
    const mine = this.partyTeam;
    const name = d?.commanders.find((c) => c.side === winner)?.army.name ?? null;
    /* THE GROUND IS NAMED OFF THE GROUND. This said "holds Geonosis", which was
     * true for as long as Command owned the only field a meeting could be
     * fought on — `MODES.command.level` pins it. It is a level name written out
     * in a file that is holding the level, which is the same defect as a price
     * written beside a price list, and a skirmish makes it visibly wrong: a
     * battle decided on the Colosseum floor announced Geonosis. */
    const where = this.level?.name || 'the field';
    this.notify(winner === mine ? 'THE FIELD IS YOURS' : 'THE FIELD IS LOST',
      name ? `${name} holds ${where}` : 'neither army holds the field');
    /**
     * …AND IT MAKES A SOUND. Until this line a won meeting was silent: the
     * score's only ending was a death, and this mode is the first thing in the
     * game that can be WON.
     *
     * The argument is answered for THIS machine, exactly as `won` below is —
     * the same match is a victory on one screen and a defeat on the other, and
     * `false` deliberately hands the losing commander the death cue rather than
     * nothing.
     */
    audio.runWon?.(winner === mine);
    this.onGameOver?.(this.runStats({ won: winner === mine }));
  }

  /** Host → this client: the state of the meeting. A client owns none of it. */
  applyMatch(rec) {
    if (this.netMode !== 'client' || !rec) return false;
    /**
     * MADE FROM THE FIRST RECORD, because nothing on a client ever makes one.
     *
     * `beginVersus` is the only constructor of a match and it runs on the host
     * — correctly, since the host is the only node that can see every body. So
     * this used to return on `!this.match` at the first line, every time, and a
     * joining commander received the whole match and was told none of it: no
     * countdown, no clock, and no card at the end of a battle they had just
     * fought. `DuelMatch.WIRE` carries `sides`, which is the one thing the
     * constructor needs and the one thing a client cannot work out.
     */
    if (!this.match) {
      this.match = new DuelMatch(this.rules, Array.isArray(rec.sides) && rec.sides.length
        ? rec.sides : [TEAM.PARTY, sideTeam(1)]);
    }
    this.match.apply(rec);
    if (this.match.phase === 'match-over') this._endMeeting(this.match.winner);
    return true;
  }

  /** Host → this client: the campaign as the host has it. */
  applyArmy(msg) {
    if (this.netMode !== 'client') return false;
    return this.command?.applyNet?.(msg?.r) ?? false;
  }

  /**
   * A JOINING PLAYER PRESSED AN ORDER KEY.
   *
   * The other direction from every other Command message, and the only one:
   * `main.js` binds the six formation keys to `CommandDirector.order` on
   * whichever machine pressed them, and the bodies only exist on the host. So
   * this is the ask, and `applyOrder` below is the host deciding.
   */
  requestOrder(id) {
    if (this.netMode !== 'client' || !this.net?.connected) return false;
    this.net.toHost({ t: 'order', f: id });
    return true;
  }

  /**
   * …AND THE HOST DECIDING, through the same `order` every local key press
   * goes through.
   *
   * Validation is NOT repeated here. `CommandDirector.order` already refuses an
   * id that is not a formation and returns false, and writing a second
   * membership test on this side is how the two come to disagree about what an
   * order is — the rule is called, not restated. What this adds is the one
   * thing the director cannot know: that only the host may move an army, so a
   * peer cannot re-form somebody else's line by sending this to a machine that
   * is not holding it.
   */
  applyOrder(peerId, msg) {
    if (this.netMode !== 'host' || !this.command) return false;
    return this.command.order(msg?.f, this.commanderFor(peerId));
  }

  /**
   * WHOSE ARMY A PEER IS ENTITLED TO MOVE.
   *
   * `applyOrder` used to call `this.command.order(f)`, which defaults to
   * `commanders[0]` — the HOST's commander. In co-op that is right and is the
   * whole point: one army, everybody in the session leading it, so a peer's
   * order and the host's reach the same line. In a MEETING it is the defect the
   * mode was built to remove: a joining commander pressing `wedge` re-formed the
   * host's line, in the host's colours, against their own army — the two
   * machines then disagreed about a formation neither player had ordered for
   * the army they were watching.
   *
   * So a peer moves the army it is commanding, and falls back to the shared one
   * when it is not commanding anything. The fallback is not defensive: in co-op
   * a peer HAS no commander of its own, and `find` returning nothing is exactly
   * the statement that there is one army here.
   *
   * The host's own Player is skipped by identity rather than by id: only a
   * RemoteAvatar carries one, so a `undefined === undefined` match would hand
   * the first peer to send anything the host's army.
   */
  commanderFor(peerId) {
    const d = this.command;
    if (!d) return null;
    return d.commanders.find((c) => c.player && c.player !== this.player
      && c.player.id === peerId) || d.commander;
  }

  /**
   * A JOINING COMMANDER PRESSED BUY, OR DONE.
   *
   * The other direction from every Command message but `order`, and it exists
   * for the identical reason: the screen is on this machine and the ROSTER —
   * the purse, the shelf, the strength cap, the names — is on the host's.
   *
   * What crosses is the unit or the word "done", and deliberately nothing else.
   * A cost, a balance or a strength on this wire would be a number the host has
   * to either trust or re-derive, and re-deriving it is what `recruit` already
   * does with the roster in its hands.
   */
  requestMuster(type, done = false) {
    if (this.netMode !== 'client' || !this.net?.connected) return false;
    this.net.toHost(done ? { t: 'muster', done: 1 } : { t: 'muster', u: type });
    return true;
  }

  /**
   * ASK THE HOST TO COMMEND A MAN — PLAN §4.4's third muster option.
   *
   * The twin of `requestMuster` and it exists for the same reason: a client's
   * director is a shell, so the request carries the DESIGNATION and nothing
   * else. Not the cost, not the balance, not the rank — every one of those is
   * derived on the host from the roster it actually keeps, so there is no claim
   * a peer can make about its own purse that anything reads.
   */
  requestCommend(name) {
    if (this.netMode === 'client') { this.net?.toHost?.({ t: 'muster', cm: name }); return; }
    this.command?.commend?.(name);
  }

  /**
   * …AND A JOINING COMMANDER CHOSE A ROAD.
   *
   * The third thing a peer can say on the muster wire, beside a unit and the
   * word done, and the same one-field message for the same reason: what crosses
   * is the GROUND'S ID and nothing else. A route is a fact about the run — the
   * host composes every wave of the next area off `stages` — so a client that
   * rewrote its own copy would be looking at a brief for ground the host is not
   * taking it to. `CommandDirector.takeRoute` runs on the machine holding the
   * army, against the fork that machine dealt, and the answer comes back as the
   * next offer like every other muster answer.
   *
   * NOT GUARDED HERE, exactly as `applyMuster` does not re-check affordability:
   * `takeRoute` already refuses an id that is not on the open fork, a fork that
   * is not open, and a tail that would not fit. A second copy of those three
   * tests on this side is how the two come to disagree about where the run is
   * going.
   */
  requestRoute(id) {
    if (this.netMode !== 'client' || !this.net?.connected) return false;
    this.net.toHost({ t: 'muster', r: id });
    return true;
  }

  /**
   * THE MUSTER, IN WHICHEVER DIRECTION THIS MACHINE IS FACING.
   *
   * One message type, one handler, and the branch is `netMode` — which is total
   * and mutually exclusive, so an offer can only ever be read by a machine that
   * does not hold the army and an intent can only ever be acted on by one that
   * does. That split is the whole of the security story, and it is the reason
   * Net.js does not guard this case by direction: a guard there could assert
   * only one of the two.
   *
   * VALIDATION IS NOT REPEATED HERE, exactly as it is not in `applyOrder`.
   * `CommandDirector.recruit` already refuses a unit that is not in this army's
   * list, one the advance has not reached, one there are not the points for and
   * one that would break the strength cap — and it does all four against the
   * roster the host is holding. A second membership or affordability test on
   * this side would be a rule restated, which is how the two come to disagree
   * about what the player can afford. What this adds is the one thing the
   * director cannot know: which commander is asking.
   */
  applyMuster(msg, peerId) {
    const d = this.command;
    if (!d || !msg) return false;
    /* A client owns none of this and is told all of it. */
    if (this.netMode === 'client') return d.applyMusterNet?.(msg.o ?? null, msg.no) ?? false;
    if (this.netMode !== 'host') return false;
    /* No muster is open, so there is nothing to spend and nothing to close. A
     * peer whose card is stale — the host closed it a frame ago — gets its next
     * `muster` message from `closeMuster`'s own publish and takes the card
     * down; it does not get to reopen a purse. */
    if (!d.mustering) return false;
    const c = this.commanderFor(peerId);
    if (msg.done) return d.closeMuster();
    /* THE ROAD, AND ANY COMMANDER SHARING THE PURSE MAY PICK IT — the same rule
     * `recruit` is under one line down, and it is one rule rather than two on
     * purpose: in co-op there is one army, one purse and one crossing, so a
     * route only one player could steer would be a decision the others watch.
     * `takeRoute` publishes the new offer to everybody when it lands; a refusal
     * is nobody else's business and goes back to the peer that asked, with the
     * offer they still have. */
    if (msg.r !== undefined) {
      if (d.takeRoute(msg.r)) return true;
      this.net?.toPeer?.(peerId, { t: 'muster', o: d.musterOffer(c), no: d.refused });
      return false;
    }
    /* A COMMENDATION, under the same rule as the road above and for the same
     * reason: one army, one purse, so any commander sharing it may spend on any
     * man on the roll. `commend` publishes on success; a refusal goes back to
     * the peer that asked. */
    if (msg.cm !== undefined) {
      if (d.commend(msg.cm, c)) return true;
      this.net?.toPeer?.(peerId, { t: 'muster', o: d.musterOffer(c), no: d.refused });
      return false;
    }
    /* `recruit` publishes the new offer to everyone sharing this purse when it
     * succeeds — the host's own screen buys through the same line. A REFUSAL
     * publishes nothing and is nobody else's business, so it goes back to the
     * one peer that asked, with the offer they still have. */
    if (d.recruit(msg.u, c)) return true;
    this.net?.toPeer?.(peerId, { t: 'muster', o: d.musterOffer(c), no: d.refused });
    return false;
  }

  /**
   * THE MUSTER OFFER, TO EVERY MACHINE THAT IS NOT HOLDING THE PURSE.
   *
   * SENT AT THE MOMENT IT MOVES, and not folded into `_armyTick`'s throttled
   * on-change send, which is where this obviously belonged and would not have
   * worked at all. A muster STOPS THE WORLD on the machine showing it —
   * `Screens.take` is the whole point of that overlay — so on a host sitting on
   * its own muster card `world.update` is not running, `_netTick` is not
   * running, and a polled message is never sent. The one moment a client most
   * needs to hear from the host is the one moment the host's frame loop is
   * stopped. So the three moments publish for themselves: the muster opening
   * (`_areaClear`), a purchase landing (`recruit`), and the card coming down
   * (`closeMuster`).
   *
   * ADDRESSED IN A MEETING, BROADCAST IN A CAMPAIGN — the same split
   * `_armyTick` makes and for the same reason. In co-op there is one army and
   * one purse and everybody in the session is spending it, so one offer is the
   * truth on every screen. In a meeting each commander has a roster and a purse
   * of their own, and the Confederacy's shelf is not the Republic's.
   *
   * THE MEETING HALF IS NOT REACHABLE TODAY and is written anyway. A meeting
   * composes no waves — `CommandDirector.start` returns before `super.start`
   * and `update` before `super.update` — so `payWave` never runs, `_areaClear`
   * never fires and no muster ever opens in one. So this is a branch with no
   * live caller, which this codebase is right to be suspicious of; it is here
   * because the alternative is a plain broadcast that is silently WRONG the day
   * a meeting grows an area, and because `_armyTick` twenty lines above makes
   * the identical split for the identical reason. Two neighbouring answers to
   * one question is how they come to disagree. Noted rather than hidden.
   */
  publishMuster(cmdr = null) {
    const net = this.net, d = this.command;
    if (this.netMode !== 'host' || !net?.connected || !d) return false;
    const offer = (c) => (d.mustering ? d.musterOffer(c) : null);
    if (!d.versus || d.commanders.length < 2) {
      net.broadcast({ t: 'muster', o: offer(d.commander) });
      return true;
    }
    for (const c of (cmdr ? [cmdr] : d.commanders)) {
      const id = c.player?.id;
      if (!id || c.player === this.player) continue;
      net.toPeer(id, { t: 'muster', o: offer(c) });
    }
    return true;
  }

  /**
   * WHAT THIS MACHINE DID TO THE HORDE, WHOEVER DID IT.
   *
   * `_claim` had exactly two call sites, both inside the blade-event handler —
   * a grind and a cut. There are at least six ways a player hurts an enemy:
   * Force lightning, choke, rend's dismemberment, the grip-shield's bite, and a
   * deflected or returned bolt are all of them unclaimed, so on a client they
   * were PHANTOM kills. You threw lightning into a pack and they dropped on
   * your screen only; the host kept fighting bodies you had watched die and
   * kept sending you `hit` messages from them. The suite's own check pinned the
   * two kinds as "the two ways of hurting an enemy" and therefore certified the
   * stub.
   *
   * The fix is not a seventh call site, it is a seam that cannot be forgotten:
   * the host's hp is authoritative and arrives every snapshot, so any hp this
   * machine has taken off since then is damage the host has not heard about —
   * whatever dealt it. A future ability is replicated the day it is written.
   *
   * The two explicit claims stay: a CUT carries a bone and an impulse, so the
   * host can take the same arm off rather than merely subtracting a number.
   * They call `_claim` with the enemy, which resyncs the baseline so this
   * cannot bill for them twice.
   */
  _reconcileClaims() {
    const net = this.net;
    if (!net?.connected || !this._netEnemyIndex) return;
    for (const [id, e] of this._netEnemyIndex) {
      // The lift is a STATE and is reconciled on its own terms — see
      // _netGripSync. It rides this loop because this is the tick that already
      // walks every replicated body once, at the rate a claim is allowed to go.
      this._netGripSync(e);
      const base = e._netHp;
      if (base === undefined) continue;
      const lost = base - e.hp;
      /* …UNLESS THE HOST'S OWN FIRE IS WHAT PUT IT DOWN HERE. See
       * `_netBoltBilled`: the snapshot rewrites `_netDead` at 18 Hz, so a
       * mirror killed locally by a replicated bolt that the host's own copy
       * survived would re-claim its whole remaining health on every tick,
       * forever. `_netHostKill` is the fact the snapshot cannot overwrite. */
      const killed = e.dead && !e._netDead && !e._netHostKill;
      if (lost < 0.05 && !killed) continue;
      // A body this machine has killed that the host still has standing is
      // worth the whole rest of its health, or the host keeps it alive and
      // shooting at a corpse.
      const d = killed ? Math.max(lost, base) : lost;
      this._claim({ t: 'claim', k: 'dmg', id, d: Math.round(d * 10) / 10,
        p: [r2(e.position.x), r2(e.position.y + 1), r2(e.position.z)] }, e);
    }
  }

  /**
   * THE COMMUNION, ACROSS THE WIRE.
   *
   * Sent on the same tick as the avatar and to the same peers, because it is
   * the same kind of fact — "this is what I am doing to you" — and it is
   * addressed, not broadcast: a peer is a RemoteAvatar with a position on this
   * machine, so the sender already knows exactly who is inside the aura and
   * only pays for those. An aura that reached the whole session regardless of
   * distance would be a different, and much worse, ability.
   *
   * `_bondOut` is set by Waves.bondAura, which is installed by the bond cards;
   * with no bond card there is no descriptor and nothing is sent at all.
   * `_bondPeers` goes back the other way — it is how the aura knows whether it
   * reached anybody, which decides whether the holder keeps their solo half.
   */
  _bondTick(net) {
    const p = this.player, desc = this._bondOut;
    const heal = this._bondHealOut ?? 0;
    this._bondHealOut = 0;
    this._bondOut = null;
    let peers = 0;
    if (!p || !desc || !this.remotes || !net?.connected) { this._bondPeers = 0; return; }
    const r = this._bondRange ?? BOND.range;
    for (const [id, avatar] of this.remotes) {
      if (!avatar?.position || avatar.position.distanceTo(p.position) > r) continue;
      peers++;
      const msg = { t: 'bond', to: id, c: desc.cut, s: desc.spd, g: desc.ward, h: heal };
      if (this.netMode === 'host') net.toPeer(id, msg); else net.broadcast(msg);
    }
    this._bondPeers = peers;
  }

  /**
   * A peer's communion reached us. Applied to OUR OWN local player, through the
   * same `_bondIn` slot a local ally's aura writes, which is what makes the
   * co-op path and the same-machine path one mechanism with one reader.
   */
  applyBond(msg, from) {
    const p = this.player;
    if (!p || !msg) return false;
    /**
     * THROUGH THE GAME'S OWN NUMBERS, NOT THE SENDER'S.
     *
     * `bondGive` is shared with the local path, where the descriptor was
     * computed on this machine from this machine's cards and needs no checking.
     * This is the other door, and everything through it is a stranger's claim:
     * `{c: 1e6, s: 1e6, h: 1e6}` bought moveSpeed 1 → 1000000, cutPower 0.85 →
     * 850000 and a full heal. `ward` was already bounded by `bondGuardIn`; the
     * other three were not. See BOND.cutCap for why the ceilings are loose.
     *
     * A heal is bounded by the body being healed, because a heal past full is
     * not a bigger heal — it is a number nobody can spend.
     */
    const num = (v, lo, hi) => {
      const n = Number(v);
      return Number.isFinite(n) ? clamp(n, lo, hi) : lo;
    };
    return bondGive(p, {
      cut: num(msg.c, 1, BOND.cutCap),
      spd: num(msg.s, 1, BOND.spdCap),
      ward: num(msg.g, 0, BOND.wardCap),
      heal: num(msg.h, 0, p.maxHp ?? 100),
    }, this.time, from || 'peer');
  }

  /** Host → client: reconcile the enemy list against the snapshot. */
  applySnapshot(msg) {
    if (this.netMode !== 'client' || !this.terrain) return;
    const seen = new Set();
    for (const rec of msg.e) {
      const [id, type, x, y, z, f, hp, dead, vx, vz, tg, dl, md, tm, ck, cw, ch] = rec;
      seen.add(id);
      let e = this._netEnemyIndex.get(id);
      if (!e) {
        e = this.spawnEnemy(type, new THREE.Vector3(x, y, z));
        e.id = id;
        e.netDriven = true;
        this._netClaimImpulse(e);
        this._netEnemyIndex.set(id, e);
      }
      /**
       * WHOSE BODY THIS IS — and until this line every one of them was the
       * horde's, because `Enemy`'s constructor writes `team = 1` and nothing
       * on the wire had ever said otherwise.
       *
       * That is right for every mode where `world.enemies` holds one army. It
       * is wrong the moment Command puts YOUR army in the same list on the
       * party's team: measured on a real host/client pair with a ten-man
       * roster on the field, 10 of 10 named troopers arrived here as horde,
       * `canHarm(this.player, yourTrooper)` returned true, and both directions
       * of the resulting friendly fire were automatic — your troopers' own
       * rifles found the joining player through `_boltHitTest`'s owner test,
       * and every bolt that player deflected into the line hit somebody with a
       * name on the roster.
       *
       * Written EVERY snapshot rather than only on the frame the body is
       * created: `enlistBody` runs after `spawnEnemy` on the host, so the
       * record that creates a trooper here is the one from before it was
       * enlisted, and a body promoted onto a side later would otherwise stay
       * on the wrong one for the rest of the session. `asTeam` is the gate —
       * an illegible number is the horde, never a friend. See packSnapshot.
       */
      e.team = asTeam(tm);
      /**
       * THE ELITE, AND IT NEVER CROSSED.
       *
       * `spawnEnemy` builds the bare archetype, `applyModifier` had exactly two
       * call sites — both inside `WaveDirector.update`, which a client never
       * runs — and nothing else in the tree ever called it. So on a joining
       * player's screen every elite in the game was a plain body: measured on
       * two real Worlds fielding one of every producible (archetype, modifier)
       * pair, 23 of 23 arrived with `e.mod` undefined, host-vs-client tells 4/0
       * deflector bubbles, 5/0 reactor cores, 4/0 rally rings, 1/0 off-hand
       * blades, 18/0 tinted bodies, and the labels read "Sith Acolyte" against
       * the host's "Armoured Sith Acolyte". The one tell that did cross is the
       * marksman's laser, as `tg` below, and only because it is a boolean.
       *
       * It is not only what the player sees. `_applyBladeEvent` bills a grind
       * as `share * e.maxHp * GRIND_LETHALITY` off THIS copy, so a client's
       * identical swing claimed 0.667× on an armoured or leader body and
       * 1.724× on a frenzied one, and 7 of those 23 arrived carrying more hp
       * than this machine believed the chassis could hold.
       *
       * Applied on any frame the copy is still plain rather than only on the
       * frame it is created: the host applies its modifier immediately after
       * `spawnEnemy`, so today it is always the first frame — but a body that
       * were ever promoted later would otherwise be an elite the client could
       * never catch up with. `applyModifier` is idempotent (it returns false
       * once `e.mod` is set) and it runs BEFORE `e.hp = hp` below, so the
       * host's health still wins over the full-health reset inside it.
       */
      if (md && !e.mod) this._applyNetModifier(e, md);
      /**
       * `_netPos`, NOT `netTarget` — and that one rename is a bug fix.
       *
       * Enemy's netDriven branch derives velocity from its own tracking error:
       * `velocity = (netTarget - position) * 18` while the body only closes
       * that error at `1 - e^(-14/60)` per frame, which is 12.49/s. The ratio
       * is 18/12.49 = 1.4413 exactly, and that number is the gait solver's ONLY
       * speed input (Rig.js: `speed = hypot(v.x, v.z)` → stride frequency and
       * stance span). Measured on a trooper walking a true 3.00 m/s at 18 Hz:
       * reported 4.32 m/s average, sawtoothing ±33% at the packet rate. Every
       * body in a joining player's level ran a sprint cadence while translating
       * at a walk — foot-skate on the whole horde.
       *
       * Leaving `netTarget` unset makes that branch a no-op and the integration
       * happens in `_stepNetEnemies` below, where the velocity is the body's
       * OWN, off the wire.
       */
      e._netPos = (e._netPos || new THREE.Vector3()).set(x, y, z);
      e._netVel = (e._netVel || new THREE.Vector3()).set(vx || 0, 0, vz || 0);
      e.netFacing = f;
      e.hp = hp;
      // The host's number is the baseline every local claim is measured
      // against. See _reconcileClaims.
      e._netHp = hp;
      e._netDead = !!dead;
      // The marksman's laser: the fairness contract of the ranged game, and a
      // client had never seen one. `_pose` already aims it every frame — it
      // simply never became visible, because `_beginTelegraph` is reached only
      // from a brain that does not run here.
      if (tg && !e.laser?.visible) e._beginTelegraph(null);
      else if (!tg && e.laser?.visible) e._endTelegraph();
      /**
       * THE BLADE, which on a client had never moved.
       *
       * `DuelBrain.update` runs on the host alone, so every duellist in a
       * joining player's level held the guard its constructor gave it and
       * never swung — `_poseSaber` reads `guardDir`, `phase`, `spin` and
       * `attack.reach`, and all four sat still for the whole session. Six
       * numbers off the wire, applied in Enemy's netDriven branch just before
       * the pose. See packDuel in Net.js.
       */
      e.netDuel = dl || null;
      this._applyNetCast(e, ck || null, cw || 0, ch || 0);
      if (dead && !e.dead) e.die(e.position.clone(), null, 'net');
    }
    this._spawnNetBolts(msg.bf);
    this._spawnNetNades(msg.gn);
    this._spawnNetBlasts(msg.ex);
    this._spawnNetRubble(msg.rb);
    /**
     * AN ID THE HOST HAS STOPPED SENDING IS GONE, dead or not.
     *
     * The delete used to sit inside the `!e.dead` guard, which is exactly the
     * case that never fires: `packSnapshot` walks `world.enemies`, corpses
     * included, so the host keeps transmitting a body for the forty seconds it
     * lingers, and the client sets `e.dead` from that snapshot long before the
     * id stops arriving. By the time it does, `!e.dead` is false and the entry
     * is orphaned for the rest of the session — a whole Enemy graph, rig,
     * bones, Actor, saber and world backreference, per enemy the host ever
     * spawned. Measured over 240 host spawns: 92.3 MB retained, 394 KB each,
     * with the scene and the physics world both perfectly clean, so nothing on
     * screen shows it. Joining a co-op game was the leak.
     */
    for (const [id, e] of this._netEnemyIndex) {
      if (seen.has(id)) continue;
      if (!e.dead) e.die(e.position.clone(), null, 'net');
      this._netEnemyIndex.delete(id);
    }
    this.director.wave = msg.w;
    this.director.active = !!msg.act;
    this.director._netRemaining = msg.rem;
    this.director.intermission = msg.ic ?? 0;
    /* THE FRONT IS THE HOST'S — see `packSnapshot`'s `fr`. A client's director
     * never runs `_front`, so without this line the bar every player in a
     * meeting is reading would sit at the middle of the field for the whole
     * battle on every machine but one. */
    if (msg.fr !== undefined && this.command) this.command.front = msg.fr;
    this.score = msg.sc;
    this._netWaveEdge(msg);
  }

  /**
   * PROMOTE A REPLICATED BODY TO THE ELITE THE HOST SAYS IT IS.
   *
   * Everything `applyModifier` does is wanted here: the patched archetype (so
   * `A.label` reads "Armoured Sith Acolyte" and `armorPlus` sends the blade off
   * a durasteel torso exactly as it does on the host), the reset `maxHp` (which
   * is what the grind bills against), and `install` — the bubble, the core, the
   * plates, the standard and its rally ring, the off-hand blade, the tint. Six
   * of the seven tells in the game arrive through this one call; the seventh,
   * the marksman's laser, was already crossing as `tg`.
   *
   * ONE THING IS HELD BACK, AND IT IS HELD BACK ON PURPOSE.
   *
   * `_updateElite` runs before Enemy.update's netDriven branch — for the living
   * and the dead alike, because a fuse burns on a corpse — so an Unstable body
   * promoted here would light its fuse in `die()` and 0.85 s later run
   * `_detonate` on THIS machine: `hurt()` over `world.players` and
   * `world.enemies`, off interpolated positions, on a machine that is not the
   * authority for any of it. Measured with the naive version of this fix: a
   * client's local player 2 m from an unstable B1 lost 24.8 hp to its own copy
   * of a blast the host was billing at the same moment over `hit` — and the
   * same loop would have taken hp off every net-driven body in the radius,
   * which `_reconcileClaims` would then have claimed to the host as damage this
   * machine had dealt. Two double-counts from one blast.
   *
   * Net.js's own note on `hit` already states the rule: "`hit` keeps everything
   * the peer CANNOT see: sabers, explosions, the unstable core." So the core
   * goes on the chest, where it is the tell that lets a player decide whether
   * to kill this thing next to their friend — and the detonation stays the
   * host's, marked spent before it can ever be armed. `die()` reads
   * `!this._detonated` before lighting the fuse, so this one assignment is the
   * whole disarm.
   *
   * The clean version of this belongs one line inside `Enemy._detonate` — skip
   * the two `hurt` loops when `this.netDriven`, keeping the particles, the
   * flash and the scream — at which point this line comes out and the client
   * gets the fuse and the blast as well. That file is not this workstream's to
   * edit; the handover is written up rather than half-applied.
   */
  _applyNetModifier(e, key) {
    if (!applyModifier(e, key)) return false;
    if (e.mod === 'unstable') e._detonated = true;
    return true;
  }

  /**
   * THE CAST A JOINING PLAYER COULD NOT SEE COMING.
   *
   * `_forceBrain` opens every enemy power with a 0.45 s wind-up and a floating
   * call over the head — FORCE PUSH, LIGHTNING, CHOKE — and its own note says
   * the tell is the whole fairness contract: "a power that arrives with no
   * frame of warning is the 11.5 m sphere the beasts check has a note about".
   * That brain does not run here, and none of `_castKey`, `_castTimer` or
   * `casting` was on the wire, so off-host the contract did not exist. Driven,
   * a Jedi Master casting at a peer for 40 s: six casts, six tells on the
   * host's screen, and on the peer's — six anonymous numbers arriving over
   * `hit`, zero telegraphs, zero metres of displacement.
   *
   * The call is raised on the EDGE, when the key changes, so the tell appears
   * once per cast and not eighteen times a second. It reads its label and its
   * colour out of `ENEMY_POWERS` — the table the host's own call is drawn from
   * — rather than a second table here, because a floating word that says
   * something different on two machines is worse than no word at all.
   *
   * The fields are written whole rather than as a flag, because things that a
   * client DOES run read them: `Enemy.damage` refuses to reach `breakCast`
   * unless `_castTimer > 0 || casting`, and the HUD and any counterplay prompt
   * want to know how much of the window is left.
   */
  _applyNetCast(e, key, windup, hold) {
    const was = e._castKey || e.casting || null;
    e._castKey = windup > 0 ? key : null;
    e._castTimer = windup;
    e.casting = key && windup <= 0 ? key : null;
    e.castLeft = hold;
    if (!key || key === was) return;
    const P = ENEMY_POWERS[key];
    if (P) this.notifyFloating(e.aimPoint(_v1), P.label, P.color);
  }

  /**
   * THE SHOVE THIS MACHINE JUST GAVE A BODY IT DOES NOT OWN.
   *
   * `_claim` sent `cut` and `dmg` and nothing else, so there was no impulse on
   * this wire at all. Measured on a real host/client pair, the host body taken
   * off its brain so nothing else could move it: push, pull and throw each
   * moved it 0.000 m on the guest's screen and 0.000 m on the host's, and the
   * grip lifted it 0.000 m on both while `player.gripEnemy` was true the whole
   * time on the guest's own machine — a hold that was real state with no physics
   * under it. The DAMAGE crossed throughout and the hp came off. For everybody
   * who was not the host, the Force was a number applied at a distance.
   *
   * WRAPPED AT THE DOOR, NOT ADDED AT THE CALL SITES, and that is the same
   * argument `_recordFires` makes about `BoltPool.fire` and `_reconcileClaims`
   * makes about hp. Enemy.js's own note names the two doors every power in the
   * game arrives through — "`damage()` and `applyKnockback` are the two doors
   * … so one call each means a blow is answered exactly once however it was
   * thrown" — and the second of those two is the one that carries a direction.
   * A power written next month is replicated the day it is written; a list of
   * call sites here would be a seventh one waiting to be forgotten, which is
   * the exact defect `_reconcileClaims` exists to have already fixed.
   *
   * The RAW arguments are claimed, before this machine's copy has resisted
   * anything, so the HOST runs the contest: `Enemy.applyKnockback` weighs the
   * shove and the harm together against the pool it holds (which is not
   * replicated), breaks whatever the body was casting, stuns it past 12 m/s and
   * makes it scream. Every one of those is a consequence only the authority can
   * decide, and every one of them is now reachable from a guest's hands.
   *
   * `_claim(msg, e)` resyncs the hp baseline, so the damage half is billed here
   * and NOT a second time by `_reconcileClaims` on the next tick.
   */
  _netClaimImpulse(e) {
    if (e._netKnock) return;
    e._netKnock = true;
    const inner = e.applyKnockback.bind(e);
    e.applyKnockback = (impulse, damage, source, gentle) => {
      const mine = !!source?.isLocal && this.netMode === 'client';
      /* READ BEFORE THE CALL, not after it. Every force power in Player.js
       * hands this a shared module scratch (`_v2`), `applyKnockback` re-enters
       * a great deal of code through `damage` and `stun`, and this file already
       * carries a note about a direction being clobbered part way through a
       * loop for exactly that reason. Three numbers cost less than the
       * question of whether anything downstream writes to that vector. */
      const v = mine && impulse ? [r2(impulse.x), r2(impulse.y), r2(impulse.z)] : null;
      /**
       * APPLIED LOCALLY FIRST, and for the reason the blade is: each player is
       * authoritative over their own hands because they cannot tolerate a frame
       * of lag. A guest whose own push waited a round trip to move anything
       * would be a guest whose Force feels broken — which is what the wire said
       * about it for the whole life of this protocol. `_netOwn` below is what
       * stops the next snapshot stomping the shove it just applied.
       */
      inner(impulse, damage, source, gentle);
      if (!mine) return;
      this._netOwn(e);
      // A body you were holding and have now thrown is a body you have let go
      // of, and the host has to hear that BEFORE the throw or it will hold the
      // thing in place while it flies. One rule, two callers.
      this._netGripSync(e);
      this._claim({ t: 'claim', k: 'imp', id: e.id, v,
        d: Math.round((damage || 0) * 10) / 10,
        g: gentle ? 1 : 0 }, e);
    };
  }

  /**
   * THE AUTHORITY WINDOW, and it is the crux of the whole thing.
   *
   * `_stepNetEnemies` overwrites `e.velocity` from the wire and damps position
   * toward the host's at 14/s at the top of EVERY frame. That is correct for
   * ordinary motion — a body walking is the host's business and the client's
   * drawing — and it is wrong for the frames after a shove, because it erased a
   * locally-applied impulse before anything could integrate it. The guest did
   * not even get the local illusion.
   *
   * So a body this machine has just shoved is OURS for a moment, and the moment
   * is the game's own clock rather than a number picked here: `applyKnockback`
   * writes `knockTimer` — 0.7 s for a real shove, 0.35 for a gentle one — and
   * `Enemy._move` reads exactly that field to decide when a knocked body stops
   * being ballistic and starts steering again. The window is that, plus one
   * round trip, because the host's stream cannot possibly carry the shove any
   * sooner than the claim can reach it and a snapshot can come back: the
   * client's own claim tick (1/24 s), the host's snapshot tick (1/18 s) and
   * whatever the ping says. Close it earlier and the body snaps back to where
   * the host still thinks it is; leave it open longer and the guest is
   * simulating a body it is not the authority for.
   *
   * The host stays authoritative throughout: it has the impulse, it ran its own
   * resistance contest against it, and the instant the window closes the damp
   * resumes from wherever this copy got to toward wherever the host says it is.
   * Both machines integrated the same shove, so that gap is small — and it is
   * reconciled by the mechanism that was already there, not a new one.
   *
   * BOTH TERMS EARN THEIR PLACE, and the second one is the surprising half.
   * Measured on an 11.5 m flight over a 240 ms round trip, watching how far the
   * guest's own copy ever travels BACK toward where it started, which is what a
   * rubber-band is:
   *
   *     this window                    0.78 m inside 50 ms · snap-back 0.74 m
   *     knockTimer alone               0.78 m inside 50 ms · snap-back 2.31 m
   *     no window (what shipped)       0.00 m inside 50 ms · snap-back 0.00 m
   *
   * Read the last line carefully: without the window the guest's copy still
   * ends up flying, because the impulse claim alone reaches the host and the
   * host's position comes back. It simply stands still for a quarter of a
   * second first, and then teleports into a flight it never started.
   */
  _netOwn(e) {
    const trip = 1 / 24 + 1 / 18 + 2 * (this.net?.latency || 0) / 1000;
    e._netOwnT = Math.max(e._netOwnT || 0, (e.knockTimer || 0) + trip);
  }

  /**
   * THE GRIP, WHICH IS A STATE AND NOT A BLOW.
   *
   * Every other force power ends in one impulse and is over. Lifting a body
   * does not: `Player.toggleGrip` sets `e.gripped` and `_updateGrip` walks
   * `e.liftTarget` toward the hold point every frame for as long as the player
   * holds it, and `Enemy._move` reads those two to suspend the ragdoll by the
   * chest. Neither field is an event, so neither can ride the impulse claim.
   *
   * Reconciled as a DIFF against what this machine last told the host, exactly
   * as the hp is, so it cannot be forgotten by a call site: whatever the local
   * player's grip is doing to a replicated body is what the host is told, and
   * releasing, hurling and dying all clear the same two fields and therefore
   * all send the same release.
   *
   * Re-sent every tick while held rather than only when the point moves,
   * because the host puts a LEASE on it — see applyClaim. A guest whose lid
   * closes mid-lift must not leave an enemy hanging in the air for the rest of
   * the session, and a silence is the only signal that can ever say so.
   */
  _netGripSync(e) {
    const lift = e.gripped && e.liftTarget ? e.liftTarget : null;
    if (lift) {
      e._netGripAt = true;
      /**
       * ── AND WHAT IT IS BEING PULLED WITH, BECAUSE THE HOST CANNOT SEE IT ──
       *
       * A lift point alone was enough while exactly one person could ever own a
       * body. It is not enough for a contest: `gripClaim` weighs a pull against
       * an opposing POOL through `forceResistance`, and this machine's Force is
       * the one thing about a guest that the protocol deliberately does not
       * replicate — `applyClaim`'s own note says so, and until now that was
       * correct, because the host only ever needed the guest's Force to resist
       * blows that had already been priced here.
       *
       * So a grip claim carries the three numbers the arithmetic needs and
       * nothing else: `w` what this hand pulls with, `f` the pool behind it,
       * `b` whether this hand's guard is already broken. Without them the host
       * would resolve a two-sided contest from one side — which is not a
       * conservative guess, it is a different game on each screen.
       *
       * Guarded on the local player actually being the one holding THIS body:
       * `e.gripped` is also true of a body the host is holding and this machine
       * is only mirroring, and quoting somebody else's pull as our own would
       * make a guest the loudest voice in a fight it is not in.
       */
      const p = this.player;
      const mine = p && (p.gripEnemy === e);
      /**
       * ── AND WHAT A GRAB DOES TO THIS NUMBER, SAID PLAINLY ───────────────
       *
       * `heldMass` is the man plus any squadmate hanging off him (PLAN §4.8's
       * second bullet). The grab is decided in `Enemy.update`, which a client's
       * copy of an enemy never reaches — it returns at `netDriven` several
       * screens earlier — so the grab exists on the HOST and nowhere else.
       *
       * That is the right side for it to be on, because `applyClaim`'s own note
       * says the host is where a contest is settled; but it is not free, and
       * the cost is this: a GUEST gripping a man the host has a grab on quotes
       * a `w` built on the man alone, and prices its own hold, heft and cap
       * gate on the man alone too. The error is bounded by `HOLD_COST.person
       * .rise × grabMass / cap` — the whole of what the mass term can move —
       * and it is second-order in the contest itself, because that term is
       * common to both hands and cancels out of the ratio between them (see
       * `Player._gripPull`). Nothing is stranded and no position diverges: the
       * host still resolves and still ships the resolution in the snapshot.
       *
       * The exact fix is one bit in `packSnapshot`'s enemy row saying whether
       * this body is grabbed, and it is deliberately not taken here: that row
       * is positional and every reader of it is a wire format change.
       */
      const m = heldMass(e);
      this._claim({ t: 'claim', k: 'grip', id: e.id, g: 1,
        p: [r2(lift.x), r2(lift.y), r2(lift.z)],
        w: mine ? r2(p._gripPull(m, true)) : 0,
        f: mine ? r2(p.force) : 0,
        b: mine && p._guardOpen() ? 1 : 0 });
    } else if (e._netGripAt) {
      e._netGripAt = false;
      this._claim({ t: 'claim', k: 'grip', id: e.id, g: 0 });
    }
  }

  /**
   * THE WAVE SIGNAL, FOR A MACHINE WITH NO DIRECTOR.
   *
   * `director.update` is gated off on a client, and everything a wave is worth
   * hangs off the callbacks only that method fires: the WAVE N and WAVE CLEAR
   * announcements, `score += 500 * w`, the 8 hp and 0.35 flow every player gets
   * for surviving one — and INSIGHT, whose single earning path is
   * `_earnInsight` installed on `onWaveClear`. So a joining player earned zero
   * Insight for a whole session: the Holocron was a dead screen, the
   * "kneel to connect to the Force" prompt always read 0, no facet could ever
   * be woken, and they were 8 hp and 0.35 flow per wave weaker than the host for as
   * long as the session lasted.
   *
   * The signal is already on the wire — `w` and `act` — as an EDGE rather than
   * an event. Reading the edge is what makes the client's world a world.
   */
  _netWaveEdge(msg) {
    const st = this._netWave || (this._netWave = { w: msg.w, act: 0, started: false });
    const act = msg.act ? 1 : 0;
    if (act && (!st.act || msg.w !== st.w)) {
      st.started = true;
      this.director.onWaveStart?.(msg.w, msg.rem ?? 0);
    } else if (!act && st.act && st.started) {
      /**
       * The same callback the host runs, so a client cannot silently receive a
       * different wave-clear than everyone else. The rung signal inside it is
       * gated on `netMode !== 'client'` — the host owns the ladder.
       *
       * …AND THE SAME LEDGER, applied to the same number. `payWave` is asked
       * here rather than sent on the wire because the host's own edge is all a
       * client needs: a co-op host who presses Restart Wave leaves `act` at 1
       * and `w` unchanged, so no edge is raised by the restart itself, and the
       * re-clear that follows would otherwise have paid every peer a second
       * time for a wave they had already been paid for. `st.w` is `msg.w`,
       * which is the host's run-wide `director.wave` — the same number the
       * host's own ledger is keyed on.
       */
      this.director.onWaveClear?.(st.w, this.director.payWave?.(st.w) ?? true);
      this._reviveDowned();
    }
    st.act = act;
    st.w = msg.w;
  }

  /**
   * REPLICATED BOLTS.
   *
   * Fired into the client's own pool, so they are real: they are drawn, they
   * are heard, they can be deflected by the blade the local player is holding,
   * they can be caught and thrown back, and a perfect return off one kills the
   * thing that fired it. That is the game DESIGN.md is about, and none of it
   * existed for a joining player.
   *
   * Owner is looked up by id so the returned bolt can hit the shooter and so
   * `_boltHitTest`'s friendly-fire rules still apply; an owner the client has
   * not met yet is null, which every reader already tolerates.
   */
  _spawnNetBolts(fires) {
    if (!fires || !fires.length || !this.bolts) return;
    for (const f of fires) {
      const [oid, x, y, z, dx, dy, dz, speed, damage, color, big, turned] = f;
      const owner = this._netEnemyIndex.get(oid) || null;
      _v1.set(x, y, z); _v2.set(dx, dy, dz);
      if (_v2.lengthSq() < 1e-8) continue;
      /**
       * THE BOLT'S OWN SIDE, WHICH USED TO BE THE LITERAL 1.
       *
       * Right for as long as everything that fires on this wire is the horde,
       * and the other half of the trooper defect the moment it is not: the
       * enemy branch of `_boltHitTest` sorts on `bolt.team === 1` BEFORE it
       * reaches `canHarm`, so a trooper's replicated rifle round could not
       * reach the droid it was aimed at on a joining player's screen — the
       * shot flew through the body the host had just killed with it.
       *
       * Off the owner now that the owner carries a team (see applySnapshot).
       * `TEAM.HORDE` when the owner has not arrived yet, which is what the
       * literal said and what an unattributed bolt in this game has always
       * been.
       */
      /**
       * `replicated` IS WHAT KEEPS THIS SHOT OFF THE CLIENT'S BILL.
       *
       * The bolt is real here and has to be — it is the whole reason this
       * method exists — so it resolves against this machine's copy of the
       * horde and takes hp off it. That hp is not this machine's to claim: the
       * host fired the same round on its own field and has already applied it.
       * One flag, set at the ONE door a bolt off the wire comes through, is
       * what `_boltHurt` reads to tell the two apart. It is deliberately not
       * derived from the owner — an emplacement's rounds are nobody's body and
       * arrive here with `owner` null.
       */
      this.bolts.fire(_v1, _v2, {
        speed, damage, color, owner, team: owner ? asTeam(owner.team) : TEAM.HORDE,
        big: !!big, turned: !!turned, replicated: true,
        length: big ? 2.4 : 1.15, radius: big ? 0.1 : 0.05,
      });
      audio.blaster(_v1, !!big);
      this.particles?.plasma.spawn(_v1, _v3.set(0, 0, 0), {
        life: 0.07, size: big ? 0.9 : 0.42, drag: 1, gravity: 0, color, alpha: 1 });
      if (owner) owner.muzzleFlash = 0.06;
    }
  }

  /**
   * The client integrates its own copy of the horde.
   *
   * Enemy's netDriven branch only does this when `netTarget` is set, and it is
   * deliberately not — see the note in applySnapshot. What it did was report a
   * velocity of 1.44× the truth to the gait solver; what happens here is the
   * body moves toward the host's position and reports the host's OWN velocity,
   * so the feet are planted for the ground the body actually covers.
   *
   * …EXCEPT FOR THE FRAMES AFTER THIS MACHINE SHOVED SOMETHING, which is the
   * whole reason a guest's Force did nothing physical. See `_netOwn` for what
   * opens that window and why it is as long as it is. Inside it the body runs
   * `Enemy._move` — the shipped integrator, CALLED rather than restated, so the
   * gravity, the ground it lands on, the arena bounds, the static geometry, the
   * `knockTimer` that keeps a shoved body ballistic and the ragdoll suspension
   * a lifted body hangs from are all the game's own and cannot drift from it.
   * A net-driven body has no `wish` — `_think` never runs here — so `_move`
   * steers it nowhere; it only carries it.
   */
  _stepNetEnemies(dt, ctx) {
    for (const e of this._netEnemyIndex.values()) {
      if (!e._netPos || e.dead) continue;
      if (e._castTimer > 0) e._castTimer = Math.max(0, e._castTimer - dt);
      const held = e.gripped && e.liftTarget;
      if (e._netOwnT > 0) e._netOwnT = Math.max(0, e._netOwnT - dt);
      if (ctx && (e._netOwnT > 0 || held)) {
        /**
         * …AND WHAT `_move` TAKES OFF IT IS NOT OURS TO BILL. `_reconcileClaims`
         * measures a claim as the gap between the host's last hp and ours, and
         * the host is integrating the same body off the same impulse — so a
         * landing hard enough to hurt would be charged to it twice. Moving the
         * baseline by the same amount is what says "this one is already yours".
         */
        const hp0 = e.hp;
        e._move(dt, ctx);
        if (e.hp < hp0 && e._netHp !== undefined) e._netHp -= hp0 - e.hp;
        continue;
      }
      _v5.copy(e.position);
      dampVec(e.position, e._netPos, 14, dt);
      // The host's own number when we have it. The fallback is what the body
      // ACTUALLY did this frame, which is still the truth about the ground it
      // covered — never the tracking error, which is what reported 1.44×.
      if (e._netVel) e.velocity.copy(e._netVel);
      else if (dt > 0) e.velocity.subVectors(e.position, _v5).multiplyScalar(1 / dt);
    }
  }

  /**
   * RESTART THE WAVE — and refuse to, on a machine that does not own the horde.
   *
   * Lives here rather than in main.js because the damage is here: emptying
   * `this.enemies` without `_netEnemyIndex` leaves every id the host is still
   * sending pointing at a disposed Enemy, and `applySnapshot` only ever spawns
   * a body for an id that is NOT in that map — so those bodies can never come
   * back. Measured: four net-driven enemies before, zero after, all four ids
   * still held, for the rest of the host's wave.
   *
   * Returns false when it declined, so the caller can say why.
   */
  restartWave() {
    if (this.netMode === 'client') return false;
    for (const e of this.enemies) e.dispose();
    this.enemies.length = 0;
    this._netEnemyIndex?.clear();
    /**
     * …AND THE LEDGERS THAT POINT INTO THE LIST JUST DISPOSED.
     *
     * `unload` clears both of these; a wave reset is the same event with the
     * ground left standing, and it cleared neither. Measured: six corpses
     * survived a restart pointing at enemies this method had disposed, which is
     * the WHOLE `low` corpse budget held by ghosts — stepped and `worth()`-ranked
     * every frame against real bodies, so fresh corpses were evicted early right
     * after a restart, and each ghost was eventually disposed a SECOND time
     * inside Corpses' own bare `catch {}`.
     *
     * The ledger has an escape hatch for exactly this and it was dead code:
     * `Corpses.update` guards on `e.disposed`, and `Enemy.dispose` never wrote
     * it — only `Player` does. Both halves are fixed, because either alone
     * leaves the other reader wrong.
     */
    this.corpses?.clear();
    /* …and the dead those corpses were retired into, for the same reason: a
     * restart is `unload` with the ground left standing, and the men who fell
     * in the attempt that failed did not fall in this one. */
    this.fallen?.clear();
    this.locks.length = 0;
    /**
     * …AND WHAT IS STILL IN THE AIR, which this did not touch.
     *
     * A wave does not arrive all at once: `ArrivalDirector` holds bodies that
     * have been bought and paid for in flights and in staging, and they land
     * over the following seconds. Emptying `world.enemies` and re-composing
     * left every one of those inbound — so the restarted wave fielded its own
     * seven AND the leftovers of the wave the player had just abandoned.
     *
     * Measured on a real world, arena/roguelite/knight, seeded, 90 s a trial:
     * with no restart the director announced 7 contacts and fielded exactly 7.
     * Restarting once at t = 1, 2, 3 and 5 s announced 7 every time and fielded
     * 8, 10, 10 and 9. Four restarts 2.5 s apart announced 7 and fielded 14 —
     * exactly twice the wave the banner named. At the call, `arrivals.flights`
     * and `arrivals.staging` were byte-identical either side of the restart
     * (3 flights and 1 staged before, 3 and 1 after) while `world.enemies`
     * went 4 → 0.
     *
     * `ArrivalDirector.clear()` already existed and already does exactly this;
     * its own comment names "a wave reset, a level change, a run ending" as its
     * callers, and a wave reset was not one of them.
     */
    this.director.arrivals?.clear();
    for (const p of this.players) {
      if (!p.isLocal) continue;
      p.hp = p.maxHp; p.force = p.maxForce; p.stamina = p.maxStamina;
    }
    this.director.start(Math.max(1, this.director.wave));
    return true;
  }

  /**
   * A player who went down comes back when the wave is survived.
   *
   * `Player.respawn` was written — forty complete lines — and had ZERO CALLERS
   * anywhere in the tree. So the first player to die in a co-op session got
   * nothing at all: no card, no spectate, no revive, no rejoin. They lay in a
   * corpse with a live camera for the rest of the run and the only exit was
   * Escape → Abandon.
   *
   * The wave boundary is the revive because it is the one moment the party has
   * already earned something together, and it cannot become a way to ignore
   * death: if NOBODY is standing, the run is over and this never runs.
   */
  _reviveDowned() {
    if (!this.players.some((p) => p.alive)) return;
    for (const p of this.players) {
      if (p.alive || typeof p.respawn !== 'function') continue;
      const anchor = this.players.find((o) => o.alive && o !== p);
      const at = anchor ? _v1.copy(anchor.position).add(_v2.set(1.4, 0, 1.4)) : null;
      if (at && this.terrain) at.y = this.terrain.height(at.x, at.z);
      p.respawn(at ? at.clone() : null);
      this.notify('YOU RISE AGAIN', 'the wave was survived — your allies held the line');
      this.onLocalRevive?.(p);
    }
  }

  /** Client → host: "my blade did this." Trusted; this is co-op with friends. */
  /**
   * TELL THE HOST WHAT MY BLADE DID.
   *
   * `applyClaim` below has always existed to receive this, and `Net.toHost` has
   * always existed to send it, and NOTHING EVER CALLED EITHER — `toHost` had
   * zero callers in the whole repository. Both ends of the wire were built and
   * nothing crossed it, so a joining player could move, be seen and deflect,
   * and then every enemy they hit came straight back to life 55 ms later when
   * the host's next snapshot hard-wrote `e.hp`. Co-op existed; killing things
   * in it did not. This codebase's signature bug, surviving in one seam.
   *
   * The hit is applied LOCALLY as well, and deliberately: the architecture note
   * in Net.js is that each player is authoritative over their own blade because
   * it cannot tolerate a frame of lag. So the client shows its own hit at once
   * and the host's snapshot confirms it a moment later — rather than the client
   * waiting a round trip to find out whether its own sword works.
   */
  _claim(msg, enemy = null) {
    if (this.netMode !== 'client' || !this.net?.connected) return;
    this.net.toHost(msg);
    // Billed. `_reconcileClaims` measures unclaimed damage as the gap between
    // the host's last hp and ours, so a claim that does not move the baseline
    // is sent twice.
    if (enemy) { enemy._netHp = enemy.hp; enemy._netDead = enemy.dead; }
  }

  /**
   * A FRIEND'S KILL, CREDITED TO A FRIEND.
   *
   * `null` used to be passed as the source, and `onEnemyKilled` requires a
   * source before it credits anything — so every enemy a joining player
   * legitimately killed was scored to nobody: no kill feed entry, no score, no
   * combo, and `run.kills` (which sums `p.kills` across `world.players`)
   * undercounted the party for the whole run summary. The peer's own
   * RemoteAvatar is the right source: it is already in `world.players`, it is
   * what the run reads, and it is what the kill feed can name.
   */
  applyClaim(peerId, msg) {
    if (this.netMode !== 'host') return;
    const e = this._netEnemyIndex?.get(msg.id) || this.enemies.find(x => x.id === msg.id);
    if (!e || e.dead) return;
    const by = this.remotes?.get(peerId) || null;
    /**
     * THE GATE EVERY LOCAL BLADE PASSES, ASKED ON THIS SIDE TOO.
     *
     * `RemoteAvatar._tellHit` consults `canHarm` before it will SEND a hit, and
     * its own note says the host is "the only machine in the session that can
     * see both fighters". The receiving half never asked. Measured on a Command
     * host with ten of its own troopers on the field: `canHarm(peer, trooper)`
     * is false — the answer every local blade gets — and a peer's `dmg` claim
     * took that trooper to −349954 hp and killed it anyway, 9 of 10 standing.
     * In a meeting that is how a commander deletes the opposing army from
     * across the map with no blade in reach; in co-op it is a peer shooting
     * your named troopers in the back.
     *
     * A NULL `by` keeps today's behaviour on purpose: an unattributed claim is
     * the environment, which is exactly how `_tellHit` treats a null source.
     */
    if (by && !canHarm(by, e, this.rules)) return;
    /**
     * …AND THE NUMBER HAS TO BE A NUMBER.
     *
     * `Enemy.damage` does `hp -= amount` with no finiteness test, and `NaN <= 0`
     * is false forever — so one claim carrying a string, an object, or NOTHING
     * AT ALL makes a body permanently unkillable and the wave permanently
     * unclearable. Measured: `d` of `"x"`, `{}`, `"5e"` and `undefined` each
     * took a 420 hp body to NaN, after which thirty seconds of the host swinging
     * for 10^6 a blow left `remaining 1, active true, wave 1` — nobody in the
     * session ever gets the payout, the revive, or wave 2. `null` and `[]`
     * coerce to 0 and were already harmless.
     *
     * THIS NEEDS NO MALICE. A string survives JSON, so a client that simply
     * forgets to fill in `d` does it. Clamped as well as checked, because a
     * peer's honest claim is bounded by what it could actually have dealt and
     * `maxHp * 2` is past any single blow in the game.
     */
    const asDamage = (v) => {
      const n = Number(v);
      return Number.isFinite(n) && n > 0 ? Math.min(n, e.maxHp * 2) : 0;
    };
    /** A point off the wire, or null. Three finite numbers or nothing. */
    const asVec = (a) => (Array.isArray(a) && a.length === 3 && a.every(Number.isFinite)
      ? new THREE.Vector3(a[0], a[1], a[2]) : null);
    /**
     * …AND AN IMPULSE IS BOUNDED BY THE SAME RULE, IN THE SAME CURRENCY.
     *
     * Clamping the damage and not the shove leaves the hole half open, and the
     * half that is left is the worse one: `d: 1e9` is absorbed downstream, but
     * `v: [1e9,1e9,1e9]` reaches Rapier, and Rapier does not absorb it — it
     * traps. Measured: with only the damage clamped, a claim carrying a 10^9
     * impulse put the body at y = 2×10^9 and the NEXT step of the physics world
     * died on `RuntimeError: unreachable` out of wasm. A peer can crash the host
     * with one packet.
     *
     * `IMPULSE_AS_HP` is how the rest of the game converts a shove into the
     * currency `asDamage` is already bounded in, so this is that same ceiling
     * asked in impulse units rather than a second number invented here. For a
     * 420 hp body it is 700 m/s — far past the 12 m/s that knocks a body off its
     * feet, and far short of what breaks the solver.
     */
    const asImpulse = (a) => {
      const v = asVec(a);
      if (!v) return null;
      const cap = (e.maxHp * 2) / IMPULSE_AS_HP;
      return v.length() > cap ? v.setLength(cap) : v;
    };
    if (msg.k === 'cut') {
      const cap = e.capsules().find(c => c.name === msg.b);
      if (!cap) return;
      const at = asVec(msg.p);
      if (!at) return;                      // see asVec — a cut with no place did not happen
      const ct = Number(msg.ct);
      e.takeCut({
        // `ct`, NOT `t`: Net routes every message on `msg.t`, so the receiver
        // asking for the cut parameter under the same name would have read the
        // string 'claim'. Never caught because nothing ever sent one.
        bone: msg.b, cutT: Number.isFinite(ct) ? ct : 0.5, cap, point: at,
        impulse: asImpulse(msg.v) || new THREE.Vector3(), normal: new THREE.Vector3(0, 1, 0), speed: 20,
      }, by);
    } else if (msg.k === 'dmg') {
      /* `asVec` and not a bare spread: `new THREE.Vector3(...undefined)` THROWS,
       * and a claim with no `p` used to take the handler down half-applied.
       * `Net._emit` wraps every handler in a try/catch so it was never a crash
       * — which is precisely why nobody saw it. */
      const at = asVec(msg.p);
      if (!at) return;
      e.damage(asDamage(msg.d), at, by, 'remote');
    } else if (msg.k === 'imp') {
      /**
       * A FRIEND'S SHOVE, ARRIVING AS A SHOVE.
       *
       * Through `applyKnockback` and not through a velocity write, because
       * everything that makes a shove mean something lives inside it and none
       * of it can be decided anywhere else: the resistance contest against the
       * pool THIS machine holds (the guest cannot see it — `force` is not
       * replicated), `breakCast`, the stun past 12 m/s, the scream past 10, and
       * the damage weighed in the same currency as the impulse so the body is
       * not billed twice for one blow. `by` is the peer's own RemoteAvatar, so
       * a kill lands in their column exactly as `dmg` already made it.
       */
      e.applyKnockback(asImpulse(msg.v), asDamage(msg.d), by, !!msg.g);
    } else if (msg.k === 'grip') {
      /**
       * A LIFT POINT THAT IS NOT THREE FINITE NUMBERS IS NOT A LIFT.
       *
       * The knockback branch above resists a non-finite impulse; this one wrote
       * `msg.p` straight into `liftTarget`, and `_move` suspends the body by it.
       * Measured: a grip claim carrying NaN put the host's copy of a body at
       * `NaN,NaN,NaN`, shipped `[null,null,null]` to everyone in the snapshot,
       * and left the two machines permanently disagreeing — the host's copy
       * unrecoverable. A malformed lift releases instead, which is the same
       * ending the lease already has for a guest that goes silent.
       */
      const at = msg.g ? asVec(msg.p) : null;
      if (at) {
        /* Through the same door a local grip uses, and with a lease long
         * enough to outlive the gap between claim ticks — see `Enemy.hold`.
         * `_netGripLeases` below is still the authority on a peer that has
         * gone quiet; this stops a body being stranded in the window where a
         * host's own copy of the gripper goes away underneath it. */
        e.hold(NET_GRIP_LEASE * 2);
        /**
         * ── THE HOST IS WHERE A CONTEST IS SETTLED ───────────────────────
         *
         * Straight into `liftTarget` is the last-writer-wins this whole change
         * exists to end: with the host's own player also gripping, whichever of
         * `_updateGrip` and this handler ran later that frame owned the body
         * outright and the other one paid for nothing. Through `gripClaim` the
         * peer becomes one claimant among however many there are, and BOTH
         * sides read the same resolution, because the resolution is a pure
         * function of the ledger and the clock rather than of iteration order.
         *
         * It is settled HERE and only here. The host is the one machine that
         * can see both pulls — the guest is told what its hand is doing and is
         * never told what the host's is — so a guest's own copy resolves as
         * though it were alone and is corrected by the next snapshot, exactly
         * as every other optimistic claim on this wire already is.
         *
         * The claim's lease is `NET_GRIP_LEASE`, the same clock `_netGripUntil`
         * runs on two lines down, so a peer that goes quiet leaves the contest
         * and the hold on the same tick rather than on two.
         */
        gripClaim(e, by, at, Number(msg.w) || 0, {
          time: this.time, pool: Number(msg.f) || 0, beaten: !!msg.b,
          radius: e.radius ?? 0.55, lease: NET_GRIP_LEASE,
          out: (e._netLift ||= new THREE.Vector3()),
        });
        e.liftTarget = e._netLift;
        /**
         * A LEASE, because a held body is the one state a lost connection can
         * strand. Every other claim is an event that happened; this one is a
         * standing instruction, and a guest whose lid closes mid-lift would
         * otherwise leave an acolyte hanging in the air, out of its brain
         * (`_think` returns on `gripped`), for the rest of the host's session.
         * The guest re-sends it every claim tick, so a silence longer than a
         * handful of them is the only thing it can mean.
         */
        e._netGripUntil = this.time + NET_GRIP_LEASE;
      } else {
        /* HIS HAND OFF IT, NOT EVERY HAND. The host's own player may still be
         * holding this body, and a peer letting go used to drop it for both. */
        if (gripRelease(e, by, this.time) === 0) e.releaseHold();
        e._netGripUntil = 0;
      }
    }
  }

  /**
   * DROP WHATEVER A PEER STOPPED ASKING US TO HOLD. See the lease above.
   *
   * Over `enemies` rather than over a list of held bodies, because a held body
   * is one field on an ordinary enemy and a second index of them would be a
   * second thing to keep in step. It runs at the host's snapshot rate over a
   * wave, which is the same loop `packSnapshot` already pays for.
   */
  _netGripLeases() {
    if (this.netMode !== 'host') return;
    for (const e of this.enemies) {
      if (!e._netGripUntil || this.time < e._netGripUntil) continue;
      e._netGripUntil = 0;
      /* AND THE SAME RULE AS AN EXPLICIT RELEASE: the silence is the peer's,
       * not the host's, and the host may have a hand on this body too.
       * `gripRelease` with no claimant prunes the lapsed rows and answers how
       * many live ones are left — the peer's row lapses on this same tick
       * because `applyClaim` leases it on `NET_GRIP_LEASE`. */
      if (gripRelease(e, null, this.time) === 0) e.releaseHold();
    }
  }

  /**
   * THE BODY BEHIND AN ID ON THE WIRE — the far end of `hitSourceId`.
   *
   * A `hit` used to be applied as `p.damage(d, null, null, kind)`, and the
   * third null is the one that cost something: `Player.die` hands its source to
   * `onPlayerDeath`, so a joining player killed by a Master's lightning died to
   * nobody — no name on the card, no kill credit, nothing in the feed.
   *
   * `null` for an id this machine cannot place, which is exactly the state
   * every one of these was in before, so an unknown attacker costs nothing.
   *
   * AND IT DOES NOT RE-JUDGE THE HIT. The host has already run `canHarm`, on
   * the only machine that can see both fighters, and `Player.damage` runs it
   * again at its own sink — so an attacker this machine's rulebook would refuse
   * is dropped back to null rather than cancelling a blow the authority
   * allowed. A duel's rules arrive in their own message and can be a packet
   * behind; a hit that vanished because of it would be a hit nobody could
   * explain.
   */
  netSource(id) {
    if (!id) return null;
    const src = this._netEnemyIndex?.get(id) || this.remotes?.get(id) || null;
    if (!src || !this.player) return null;
    return canHarm(src, this.player, this.rules) ? src : null;
  }

  /**
   * THE HOST SAYS WE WERE HIT — the far end of `RemoteAvatar._tellHit`.
   *
   * It lived in main.js, which is the reason it could carry a defect for as
   * long as it did: every other message on this wire is applied by a method on
   * World (`applySnapshot`, `applyClaim`, `applyBond`, `applyMatch`,
   * `applyArmy`, `applyMuster`, `applySeat`) and is therefore drivable by a
   * check against two real endpoints, and this one alone was a closure inside a
   * `net.on` in the entry point, where nothing could reach it. It was also the
   * one that threw a direction and an attacker away.
   *
   * Applied through OUR OWN Player, so every boon that lives in the damage path
   * is consulted where it actually exists: Second Wind, Steadfast, Encircled,
   * the difficulty's damageTaken. Tutaminis is the exception — `absorb` is
   * applied at the call site rather than inside `damage`, so it is repeated
   * here or a peer would silently lose it.
   *
   * THROUGH `applyKnockback` WHEN A SHOVE CAME WITH IT, and that is not a
   * detail. It is the door the host's own copy of this blow went through, and
   * it weighs the impulse and the harm TOGETHER against the pool
   * (`IMPULSE_AS_HP`) — so bracing against a shove means the same thing on both
   * machines. Answering only the damage ran the contest, correctly and once,
   * against a fraction of the weight. The same Master's push, priced both ways
   * on a full bar:
   *
   *     p.damage(9.0, …, 'force')              −3.4 hp   3.5 Force   0.00 m/s
   *     p.applyKnockback(27.9 m/s, 9.0)        −3.4 hp  16.7 Force  12.57 m/s
   *
   * 16.7 is the number HANDOFF §6.1a measured for bracing against this shove on
   * the host. Off-host the pool was asked about the 9 and never about the 33 hp
   * of shove behind it, so a joining player's guard cost a fifth of what it
   * costs everyone else — and bought them nothing, because there was no shove
   * on the wire for it to blunt.
   *
   * THE BRANCH IS THE DOOR, NOT THE WORD. `_tellHit` is reached from exactly
   * two places on the host — `applyKnockback`, which stamps `k:'force'`, and
   * `damage`, which carries the caller's own word — so "was this the Force" is
   * a fact about which door it came through, and `Player.damage` reads `kind`
   * for exactly one thing: whether the pool answers it. A held power bills with
   * a null impulse (`Enemy._sustain` → `applyKnockback(null, debt, …)`) and
   * still has to reach the contest, which is why the test is the kind and not
   * the presence of a vector.
   *
   * The other branch passes `'remote'`, the word `applyClaim` already uses for a
   * blow that arrived over the wire, and it is the truth this branch has just
   * established: not the Force, so the pool has nothing to say. The host's own
   * word for it rides the packet as `k` for anyone reading the traffic.
   *
   * THE TUTAMINIS BRANCH THAT USED TO BE HERE WAS UNREACHABLE. It read
   * `msg.k === 'bolt'`, and `_tellHit` refuses to send a bolt at all — the peer
   * resolves every replicated bolt in its own pool, where `_boltHitTest` has
   * its own `absorb` branch, which is where a joining player's Tutaminis has
   * actually been working all along. Two copies of one boon, one of which the
   * wire could not deliver to.
   */
  applyHit(msg) {
    const p = this.player;
    if (!p || !p.alive || !msg) return false;
    /**
     * ONE DIRECTION, AND THIS END SAYS SO TOO.
     *
     * `hit` is the host telling a peer what landed on it — the reconciliation
     * for what that peer's own machine could not resolve. It has never been a
     * message a client may send, and until now nothing on either end said so:
     * `Net` guards `army`, `match` and `left` by direction and did not guard
     * this one, and this method never asked `netMode`. A client sending one
     * `{d: 9999, k: 'force', v: [0, 40, 0], s: 0}` took the HOST from 100 hp to
     * 0 and threw it 39 m/s, with `canHarm` never consulted — `s: 0` resolves
     * to a null source, which `RemoteAvatar._tellHit`'s own note defines as
     * "the environment", and the environment is never gated.
     *
     * Guarded in `Net` as well, which is where the other three are. Both,
     * because a rule with one enforcement point is a rule that moves house the
     * next time somebody adds a caller.
     */
    if (this.netMode !== 'client') return false;
    const push = Array.isArray(msg.v) && msg.v.every(Number.isFinite)
      ? _v1.set(msg.v[0], msg.v[1], msg.v[2]) : null;
    const dRaw = Number(msg.d);
    const d = Number.isFinite(dRaw) && dRaw > 0 ? dRaw : 0;
    if (!d && !push) return false;
    const by = this.netSource(msg.s);
    if (push || FORCE_KINDS.test(msg.k ?? '')) p.applyKnockback(push, d, by, !!msg.g);
    else p.damage(d, null, by, 'remote');
    return true;
  }

  /**
   * TEARDOWN ENDS BY ALLOCATING THE THING TEARDOWN EXISTS TO RELEASE.
   *
   * `unload()` finishes with `physics.clear()`, and `clear()` is a RESET: its
   * last three lines free the Rapier world and build a replacement, complete
   * with broad phase, narrow phase, island manager and pipelines. That is right
   * for a level change and wrong for a dispose — every `world.dispose()` (the
   * top of every buildWorld, and quitting to the menu) stranded a whole fresh
   * physics world that no reference in the program could ever free again.
   * Measured over 400 create/dispose cycles: +28.2 KB per cycle, against
   * +8.3 KB with the world freed. WASM linear memory is monotonic — it is never
   * handed back.
   *
   * The Rapier world is per-World (the constructor builds its own), so freeing
   * it here cannot reach anything else, and `dispose` is terminal: main.js
   * drops its reference on the next line.
   */
  dispose() {
    /* BEFORE `unload`, and it is the one director with that ordering. The
     * transport is added to `scene` rather than to `statics` precisely so that
     * `unload` cannot take it — which is what makes the flight continuous
     * across a planet change and what makes it this method's job to end. */
    this.extraction?.dispose();
    this.unload();
    /* Terminal, and RapierWorld owns what that means — see its dispose(),
     * which frees the Rapier world instead of allocating a fresh one nobody
     * will ever step, and refuses anything that binds in afterwards. */
    this.contacts?.dispose();
    this.physics?.dispose();
  }
}

/**
 * Why a deflection graded the way it did. Being told "BLOCK" teaches nothing;
 * being told the blade was too slow teaches the whole game.
 */
const DEFLECT_WHY = [
  'blade too slow — drive it into the bolt',
  'good — now aim at someone as you meet it',
  'returned',
  'perfect',
];

/* ── helper: closest approach between two segments ───────────────────── */

const _a = new THREE.Vector3(), _b = new THREE.Vector3();
/* The bolt pass's own, for the reason its call site gives: `segmentNear`
 * consumes `_v4`, `_v5`, `_a` and `_b` itself. */
const _bolt4 = new THREE.Vector3();

/**
 * THE SPHERE THE BOLT BROAD PHASE REJECTS AGAINST.
 *
 * Baked from one `capsules()` call and cached on the body, as `{ y, r }`
 * relative to `position`: every capsule endpoint, grown by its own radius, then
 * a margin for the swing of a pose the bake did not happen to catch. Bolts that
 * DO get through re-measure through `growBoltBound`, so the sphere only ever
 * widens and a body that reaches further than its bake fixes itself.
 *
 * Returns null — meaning "test every bone, reject nothing" — for a ragdoll.
 * A ragdoll's capsules are placed by the solver and sprawl metres from
 * `position`, which is still standing where the body fell; no sphere centred
 * there is honest, and there are few enough loose corpses that the saving is
 * not worth a wrong answer.
 */
/* The far end of the segment `_screenDesc.hits` runs forward along a bolt's
 * line. Module scope for the reason every other scratch here is: the test runs
 * per candidate body per screened bolt and must not allocate. */
const _screenEnd = new THREE.Vector3();

function boltBound(e) {
  if (e.actor?.ragdolled) return null;
  /* The bubble is a capsule too, so a shield coming up or going down changes
   * what the body presents. Rebake rather than carry a stale bound. */
  const sh = !!e.shieldUp;
  let b = e._boltBound;
  if (!b || b.shield !== sh) {
    b = e._boltBound = { y: 0, r: 0, shield: sh };
    const caps = e.capsules();
    if (!caps.length) { e._boltBound = null; return null; }
    let lo = Infinity, hi = -Infinity;
    for (const c of caps) {
      /* A non-finite endpoint is skipped rather than folded in, because one
       * NaN would make the whole sphere NaN and a NaN radius rejects EVERY
       * bolt — the body would stop being shootable entirely. `segmentNear`
       * already answers a NaN capsule with a miss, so skipping it here agrees
       * with the bone pass instead of amplifying it. (A live one: the droideka
       * presented three, see the `walkPhase` note in Enemy.js.) */
      if (!Number.isFinite(c.p0.y) || !Number.isFinite(c.p1.y)) continue;
      lo = Math.min(lo, c.p0.y - c.r, c.p1.y - c.r);
      hi = Math.max(hi, c.p0.y + c.r, c.p1.y + c.r);
    }
    if (!Number.isFinite(lo) || !Number.isFinite(hi)) { e._boltBound = null; return null; }
    b.y = (lo + hi) * 0.5 - e.position.y;
    b.r = 0;
    growBoltBound(e, caps);
  }
  return b;
}

/** Widen a baked bound to hold `caps`. Cheap: it is called only where the
 *  capsules were gathered anyway. `BOLT_BOUND_SLACK` is roughly a forearm —
 *  enough that an arm thrown out between two frames is inside the sphere
 *  before the growth below has seen it. */
const BOLT_BOUND_SLACK = 0.75;
function growBoltBound(e, caps) {
  const b = e._boltBound;
  if (!b) return;
  _bolt4.copy(e.position).setY(e.position.y + b.y);
  let far = b.r - BOLT_BOUND_SLACK;
  for (const c of caps) {
    if (!Number.isFinite(c.p0.y) || !Number.isFinite(c.p1.y)) continue;
    far = Math.max(far, _bolt4.distanceTo(c.p0) + c.r, _bolt4.distanceTo(c.p1) + c.r);
  }
  b.r = far + BOLT_BOUND_SLACK;
}
/**
 * Where a segment ENTERS a sphere, or null.
 *
 * Deliberately not `segmentNear` with a point for a capsule: that returns the
 * CLOSEST point on the segment, which for a bolt fired through a bubble is a
 * point somewhere near the middle of the player, and a barrier that flashes
 * inside itself reads as a barrier that failed. This returns the first
 * crossing of the surface.
 *
 * A segment that STARTS inside the sphere returns null — see the call site in
 * `_boltHitTest` for why that is the rule and not an oversight.
 */
function segmentSphere(p0, p1, c, radius) {
  const d = _v4.subVectors(p1, p0);
  const m = _v5.subVectors(p0, c);
  if (m.lengthSq() <= radius * radius) return null;      // muzzle is inside
  const a = d.dot(d);
  if (a <= 1e-8) return null;
  const b = m.dot(d);
  const cc = m.dot(m) - radius * radius;
  if (b > 0 && cc > 0) return null;                      // pointing away
  const disc = b * b - a * cc;
  if (disc < 0) return null;
  const t = (-b - Math.sqrt(disc)) / a;
  if (t < 0 || t > 1) return null;
  return _a.copy(p0).addScaledVector(d, t).clone();
}

function segmentNear(p0, p1, c0, c1, radius) {
  const d1 = _v4.subVectors(p1, p0);
  const d2 = _v5.subVectors(c1, c0);
  const r = _a.subVectors(p0, c0);
  const a = d1.dot(d1), e = d2.dot(d2), f = d2.dot(r);
  let s, t;
  if (a <= 1e-8 && e <= 1e-8) { s = t = 0; }
  else if (a <= 1e-8) { s = 0; t = clamp(f / e, 0, 1); }
  else {
    const c = d1.dot(r);
    if (e <= 1e-8) { t = 0; s = clamp(-c / a, 0, 1); }
    else {
      const b = d1.dot(d2);
      const denom = a * e - b * b;
      s = denom !== 0 ? clamp((b * f - c * e) / denom, 0, 1) : 0;
      t = (b * s + f) / e;
      if (t < 0) { t = 0; s = clamp(-c / a, 0, 1); }
      else if (t > 1) { t = 1; s = clamp((b - c) / a, 0, 1); }
    }
  }
  _a.copy(p0).addScaledVector(d1, s);
  _b.copy(c0).addScaledVector(d2, t);
  return _a.distanceToSquared(_b) <= radius * radius ? _a.clone() : null;
}
