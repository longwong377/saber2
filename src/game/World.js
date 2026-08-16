/**
 * BATTLEFRONT BORZ — the world.
 *
 * Owns the frame: input, blade solve, contact resolution, physics, spawning,
 * and everything the HUD reads. The update order matters — blades resolve
 * before bolts move, so a deflection is decided by where your blade was when
 * the bolt arrived, not by where it ended up afterwards.
 */

import * as THREE from 'three';
import { RapierWorld, Body, LAYER, box, ball, hullFromGeometry, boxFromObject } from '../physics/RapierWorld.js';
import { Terrain } from '../world/Terrain.js';
import { Particles } from '../world/Particles.js';
import { GrassField, Water, Atmosphere, weather } from '../world/Scenery.js';
import { BoltPool } from './Bolts.js';
import { BladeContactSolver, captureSnapshot, gradeCaught, resolveBladeClash, GRADE, GRADE_NAME, DIFFICULTY, CatchWindow } from './Combat.js';
import { Player, bladeTargets, canHarm, hostileTo, pvpRules, TEAM } from './Player.js';
import { ageDropped } from './Dropped.js';
import { Enemy, ARCHETYPES, applyModifier } from './Enemy.js';
import { WaveDirector, RankSet, boonTick, boonGuard, bondReceive, bondGuardIn, bondGive, BOND, boonById, MODES } from './Waves.js';
import { Communion, STARS } from './Constellation.js';
/**
 * What "open" is worth, in Insight. Every facet in the sky, at its first-
 * purchase price, plus the escalator — `Communion.price` adds COST_STEP per
 * facet already bought, so the last one costs a great deal more than the
 * first. 600 clears the whole chart with room over; it is deliberately a
 * number rather than a computed sum, because the point is "you will not run
 * out" and a computed sum would be exactly enough and therefore tense.
 */
const HOLOCRON_PURSE = 600;
import { applyOrder } from './Order.js';
import { LEVELS, LEVEL_ORDER, groundMight, spawnClear } from './Levels.js';
import { CommandDirector, COMMAND_POWER_RULES } from './Command.js';
import { Corpses, CORPSE_BUDGET } from './Corpses.js';
import { BladeLock } from './Duel.js';
import { FocusSystem } from './Focus.js';
import { DojoDirector } from './Dojo.js';
import { updateCauterisation } from './Ragdoll.js';
import { packAvatar, packSnapshot } from '../net/Net.js';
import { QUALITY } from '../engine/Engine.js';
import { clamp, lerp, damp, dampVec, makeRng, TAU } from '../engine/MathUtil.js';
import { audio } from '../engine/Audio.js';

const rng = makeRng((Math.random() * 1e9) | 0);
const _v1 = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3();
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
 */
const GRIND_LETHALITY = 0.55;
/** Stamina a lost exchange costs, before the attack's tier scales it. */
const GUARD_COST = 22;

export class World {
  constructor(engine, settings) {
    this.engine = engine;
    this.scene = engine.scene;
    this.settings = settings;
    this.physics = new RapierWorld({ gravity: -24, iterations: 4, maxBodies: settings.maxBodies ?? 1100 });

    this.players = [];
    /* WHO MAY HARM WHOM, as one object rather than a test repeated at every
     * damage path. `pvpRules({})` returns co-op's rules — friendly fire off,
     * everyone on side 0 — so every existing world is unchanged by this. */
    this.rules = pvpRules(settings);
    /**
     * THE NUMBER THAT MEANS "ON THE PLAYER'S SIDE".
     *
     * `TEAM.PARTY` is 0 and every comparison in this game already spells it as
     * the literal. This field exists for one caller: `CommandDirector.deploy`
     * enlists an `Enemy` onto the party's team, and a mode file writing a bare
     * `0` there would be a second place that decides what a side IS — which is
     * exactly what `sideTeam`'s own note in Player.js forbids ("nobody can hand
     * out a player side of 1 and post half a duel to the horde's ledger").
     */
    this.partyTeam = TEAM.PARTY;
    this.enemies = [];
    this.props = [];
    this.doors = [];
    this.debris = [];
    this.locks = [];
    this.statics = [];
    this.levelLights = [];
    this.takenBoons = new RankSet();
    /**
     * The Insight this run has earned and the stars it has spent it on.
     *
     * Lives on the World because the wave director is what earns it and the
     * meditation is what spends it; carried across a landing by the Run, which
     * is the only object that outlives a level. See Constellation.js.
     *
     * SURVIVING A WAVE IS THE ONLY THING THAT EARNS IT — not kills, not score,
     * not accuracy. A currency that pays out for anything other than the thing
     * the mode is about ends up being farmed instead of played, and there is
     * nothing here to farm. A set-piece pays more because a set-piece cost more.
     */
    this.communion = new Communion();

    this.timeScale = 1;
    this.focus = new FocusSystem();
    this.targetTimeScale = 1;
    this.hitstop = 0;
    this.time = 0;
    this.score = 0;
    this.combatIntensity = 0;
    this.paused = false;
    this.running = false;
    /** The run has ended. Everything still steps; the director does not. */
    this.over = false;

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
  }

  /* ── level lifecycle ─────────────────────────────────────────────── */

  /**
   * @param key   a LEVELS key
   * @param opts.run  a Run that must SURVIVE this call.
   *
   * `unload()` disposes every player, and with it `boonMods`, `maxHp`, the
   * taken boons and the score — which is why every level in this game used to
   * be a separate arena rather than a place in a longer journey. A run handed
   * in here is held across that and re-applied to the player that comes out the
   * other side, so a landing is a transition rather than a restart.
   */
  loadLevel(key, opts = {}) {
    this.unload();
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
    // …and the same for the Insight ledger. It used to be restored from the
    // Run across a landing, because `bought.length` is the price escalator and
    // a climb that forgot it would make every star on the next rung cost
    // first-purchase prices again. There are no landings now — the Descent was
    // the only mode with them — so a level load starts a fresh ledger, which is
    // what every other mode always did.
    this.communion = new Communion({});
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
     * `kamino` through the ordinary door and observe geonosis come back.
     */
    const owned = MODES[this.settings?.mode]?.level;
    if (owned && LEVELS[owned]) key = owned;
    const resolved = LEVELS[key] ? key : LEVEL_ORDER[0];
    const L = LEVELS[resolved];
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
    const q = QUALITY[this.settings.quality] || QUALITY.high;
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
    this.clothCut = q.cloth ?? 30;
    const detail = q.viewDist / QUALITY.high.viewDist;
    const particleScale = (this.settings.particleScale ?? 1) * q.particles;

    this.terrain = new Terrain(this.scene, L.terrain, detail);
    this.physics.terrain = this.terrain;

    this.particles = new Particles(this.scene, particleScale);
    this.bolts = new BoltPool(this.scene, 460);
    this.bolts.onDeflect = (b, entry, hit, pt) => this._onBoltDeflect(b, entry, hit, pt);
    this.bolts.onImpact = (b, res) => this._onBoltImpact(b, res);

    this.engine.applyAtmosphere(L.atmosphere);
    audio.setAmbience(L.ambience || {});

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

    L.dress(this);

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
    const mode = this.settings.mode ?? 'roguelite';
    this.director = mode === 'command'
      ? new CommandDirector(this, { pool: L.pool })
      : new WaveDirector(this, { mode, pool: L.pool });
    /** The army, or null. Read by the HUD, the summary and the checks. */
    this.command = mode === 'command' ? this.director : null;
    this.director.onWaveStart = (w, n) => {
      this.notify(`WAVE ${w}`, `${n} contacts inbound`);
      audio.ui('wave');
    };
    this.director.onWaveClear = (w) => {
      this.notify('WAVE CLEAR', 'the Force is with you');
      audio.ui('good');
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
      }
      cleared(w);
      this._reviveDowned();
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
    return L;
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
   */
  applyQuality(name) {
    const q = QUALITY[name] || QUALITY.high;
    if (this.particles) this.particles.scale = (this.settings.particleScale ?? 1) * q.particles;
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
  _playerSpawn() {
    const t = this.terrain;
    const h = (x, z) => (t ? t.height(x, z) : 0);
    const home = new THREE.Vector3(0, h(0, 8), 8);
    if (spawnClear(this, home.x, home.y, home.z)) return home;
    for (let r = 4; r <= 44; r += 4) {
      for (let i = 0; i < 16; i++) {
        const a = (i / 16) * Math.PI * 2 + r * 0.37;
        const x = Math.cos(a) * r, z = 8 + Math.sin(a) * r;
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
     *   'all'   every facet already lit. No choice at all: the workshop
     *           setting, for looking at a power rather than earning it.
     *
     * Applied through `applyBoon`-equivalent paths rather than by poking
     * `boonMods`, so a facet cannot behave differently when it is granted than
     * when it is bought — which is the whole reason the star table carries an
     * id into BOONS instead of carrying an effect of its own.
     */
    if (this.settings.holocron === 'open') {
      this.communion.insight = Math.max(this.communion.insight, HOLOCRON_PURSE);
    } else if (this.settings.holocron === 'all') {
      for (const star of STARS) {
        const boon = boonById(star.id);
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
    this.players.push(p);
    if (!this.player) this.player = p;
    p.saber.ignite();
    p.hum.ignite();
    return p;
  }

  unload() {
    // The level's wind and drone are level state; without this they kept
    // playing under the main menu after quitting.
    audio.setAmbience?.({ wind: 0, drone: 0 });
    for (const e of this.enemies) e.dispose();
    this.enemies.length = 0;
    /* The corpse ledger holds references to bodies that have just been
     * disposed. `clear()` and not `dispose()`: the ledger itself outlives the
     * level exactly as the World does, and what must not survive is its
     * pointers into a scene graph that no longer exists. */
    this.corpses?.clear();
    this.locks.length = 0;
    // …and the client's id→enemy map, which holds a whole Enemy graph per
    // entry. Clearing the list it points into is not the same as clearing it.
    this._netEnemyIndex?.clear();
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
    this.grass?.dispose(); this.grass = null;
    this.water?.dispose(); this.water = null;
    this.atmosphere?.dispose(); this.atmosphere = null;
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
    this.running = false;
    this.over = false;
  }

  /* ── spawning ────────────────────────────────────────────────────── */

  addProp(p) { this.props.push(p); return p; }

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
    const e = new Enemy(this, type, pos);
    this.enemies.push(e);
    return e;
  }

  pickSpawn(type) {
    const L = this.level;
    const [rmin, rmax] = L.spawnRadius || [34, 56];
    const anchor = this.player ? this.player.position : _v1.set(0, 0, 0);
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
      return this.command.targetFor(enemy, this._hostilesFor(enemy));
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
    /* …and the other army, if there is one. Skipped entirely when there is not,
     * which is every mode but Command: `this.command` is null and this line
     * does not run at all. */
    if (this.command) {
      for (const e of this.enemies) {
        if (e === enemy || e.dead || e.team === enemy.team) continue;
        const d = e.position.distanceToSquared(enemy.position);
        if (d < bestD) { bestD = d; best = e; }
      }
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
      if (e === who || e.dead || e.team === who.team) continue;
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
      mask: LAYER.WORLD | LAYER.DEBRIS | LAYER.PROP | LAYER.RAGDOLL,
    });
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
      mask: LAYER.WORLD | LAYER.DEBRIS | LAYER.PROP | LAYER.RAGDOLL,
    });
    if (velocity) body.velocity.copy(velocity);
    body.angularVelocity.set((rng() - .5) * 8, (rng() - .5) * 8, (rng() - .5) * 8);
    const entry = { mesh: group, body, age: 0, life: 24 };
    body.userData.onCull = () => { this.scene.remove(group); entry.gone = true; };
    this.physics.add(body);
    this.debris.push(entry);
    return entry;
  }

  onExplosion(centre, size = 1) {
    this.particles?.explosion(centre, size);
    audio.explosion(centre, size);
    const radius = 5.5 * size, force = 24 * size, damage = 55 * size;
    for (const e of this.enemies) {
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
      p.damage(damage * 0.4 * k, centre, null, 'explosion');
      _v1.subVectors(p.position, centre).setY(0.6).normalize().multiplyScalar(force * 0.35 * k);
      p.velocity.add(_v1);
      p.camera.addShake(k);
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

  /** Anything a lesson might be watching for. Free outside the dojo. */
  report(ev) { if (this.director && this.director.report) this.director.report(ev); }

  notify(title, sub) {
    this.onNotify?.(title, sub);
  }

  update(rawDt, input) {
    if (!this.running || this.paused) return;

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

    this.timeScale = damp(this.timeScale, this.targetTimeScale, 9, rawDt);
    dt *= this.timeScale * this.focus.scale;
    dt = Math.min(dt, 1 / 24);
    this.time += dt;
    this.engine.setFocus?.(this.focus.intensity());

    const camera = this.engine.camera;
    const ctx = {
      input, dt, time: this.time, camera,
      physics: this.physics, terrain: this.terrain, particles: this.particles,
      bolts: this.bolts, enemies: this.enemies, players: this.players,
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
       */
      rules: this.command ? COMMAND_POWER_RULES : undefined,
      pickTarget: (e) => this.pickTarget(e),
      pickSpawn: (t) => this.pickSpawn(t),
      spawnEnemy: (t, p) => this.spawnEnemy(t, p),
    };

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

    // 2 — enemies. On a client the body is placed from the wire FIRST, so the
    // pose that follows is solved against a velocity that is the host's own.
    if (this.netMode === 'client') this._stepNetEnemies(dt);
    for (let i = this.enemies.length - 1; i >= 0; i--) {
      const e = this.enemies[i];
      if (!e.update(dt, ctx)) { e.dispose(); this.enemies.splice(i, 1); }
    }

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
    if (this.netMode !== 'client' && !this.over) this.director.update(dt, ctx);
    if (this.netMode) {
      // A remote player's death arrives as a field in a packet and raises
      // nothing, so the wipe condition has to be re-read rather than waited on.
      this._checkWipe();
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
      out.push({ saber: p.saber, owner: p, team: 0, guard: p.boltCatch ? p.boltCatch.guard() : null });
    }
    for (const e of this.enemies) if (!e.dead && e.saber && e.saber.ignition > 0.5) out.push({ saber: e.saber, owner: e, team: 1 });
    return out;
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
    const candidates = this.enemies.filter(e => !e.dead);
    let best = -1, bestPoint = null;
    const n = cw.held.length;

    for (const h of cw.held) {
      const bolt = h.bolt;
      if (!bolt.active) continue;
      const res = gradeCaught(h.snap, {
        aimOrigin: player.camera.pos,
        aimDir: player.aimDir,
        candidates,
        flow: player.flow,
        returnCone: player.boonMods.returnCone,
        aimMode: this.settings.deflectAim || 'reticle',
        caught: true,
      });
      const from = bolt.pos.clone();
      this.bolts.release(bolt, res.dir, bolt.speed * (res.grade >= GRADE.RETURN ? 1.25 : 1));
      this._creditDeflect(player, bolt, res, from);
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
  _creditDeflect(owner, bolt, res, point) {
    bolt.damage *= res.damageMul * owner.boonMods.deflectDamage;
    bolt.team = 0;
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
    owner.camera.addShake(0.03 + res.grade * 0.02);
    if (res.grade === GRADE.PERFECT) owner.perfects++;
    else if (res.grade === GRADE.BLOCK) owner.stamina = Math.max(0, owner.stamina - 4);
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

      // build the target list once per player
      const targets = this._targets;
      targets.length = 0;
      const bladeMid = p.saber.pointAt(0.5, _v1);
      for (const e of this.enemies) {
        if (e.dead && !e.actor?.ragdolled) continue;
        if (e.position.distanceToSquared(bladeMid) > 36) continue;
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
        // Damage is the SHARE OF A SEVER done this frame, so it is bounded by
        // construction: work accumulates to `tough` and then the limb comes
        // off, which means a grind can never deal more than GRIND_LETHALITY of
        // max hp before it stops being a grind. That holds at any frame rate,
        // because the share is a share of work and not of time.
        const t = ev.target;
        if (t.enemy && ev.dWork > 0 && ev.need > 0 && !t.enemy.dead) {
          const e = t.enemy;
          const wasAlive = !e.dead;
          const share = ev.dWork / ev.need;
          const dmg = share * e.maxHp * GRIND_LETHALITY;
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
         * nothing at all. */
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
      e.takeCut(ev, player);
      if (player.isLocal) this._claim({ t: 'claim', k: 'cut', id: e.id, b: ev.bone, ct: ev.cutT,
        p: [ev.point.x, ev.point.y, ev.point.z],
        v: [ev.impulse.x, ev.impulse.y, ev.impulse.z] });
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
    } else if (t.prop) {
      const halves = t.prop.cut(ev.point, ev.normal, ev.impulse);
      if (!halves) t.prop.shatter(ev.impulse, ev.point);
      else { for (const h of halves) this.props.push(h); }
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
    player.camera.addShake(0.08 + clash.power * 0.12);

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
    // ── UNBLOCKABLE: the blade is not the answer
    if (attacking && !tier.parryable && !tier.chamberable) {
      player.control?.hitImpulse(clash.point, _v1.clone().multiplyScalar(-9), 1.0);
      player.stamina = Math.max(0, player.stamina - GUARD_COST * tier.guardBreak);
      if (player.stamina <= 0) player.staggerTimer = Math.max(player.staggerTimer, 0.6);
      this.notifyFloating(clash.point, 'UNBLOCKABLE', '#ff5a62');
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
      this.report({ type: 'parry', enemy });
      this.onDeflectFeedback?.(3, clash.point, 'riposte now');
    } else {
      player.stamina = Math.max(0, player.stamina - GUARD_COST * tier.guardBreak);
      if (player.stamina <= 0) player.staggerTimer = Math.max(player.staggerTimer, 0.6);
    }
    this.addHitstop(0.03);
  }

  notifyFloating(point, text, color) { this.onFloating?.(point, text, color); }

  /* ── bolts ───────────────────────────────────────────────────────── */

  _onBoltDeflect(bolt, entry, hit, bladePoint) {
    const owner = entry.owner;
    const isPlayer = owner instanceof Player;

    if (!isPlayer) {
      // an enemy duelist batting a bolt away — no grading, just a deflection
      bolt.vel.copy(hit.point).sub(bladePoint).normalize().multiplyScalar(bolt.speed);
      if (bolt.vel.lengthSq() < 1) bolt.vel.set(rng() - .5, rng() * .4, rng() - .5).setLength(bolt.speed);
      bolt.team = 1;
      bolt.deflected = true; bolt.deflector = owner;
      this.particles.sparkBurst(bladePoint, null, 8, { speed: 6 });
      audio.deflect(bladePoint, 0);
      return;
    }
    if (bolt.team === 0) return;    // already ours

    // Freeze the blade half of the grade NOW; the aim half waits for the throw.
    const snap = captureSnapshot(bolt, owner.saber, { bladeT: hit.bladeT, point: bladePoint, auto: hit.auto });
    const cw = owner.boltCatch;

    // ── CAUGHT. Only a driven blade takes hold of a bolt: `snap.caught` is the
    // same speed/closing test that has always separated a DEFLECT from a BLOCK.
    // A blade you merely parked in the way still blocks, and a block still
    // scatters — which is precisely what stops catch-and-throw from collapsing
    // into hold-the-button-and-win.
    if (cw && snap.caught) {
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
      aimOrigin: owner.camera.pos,
      aimDir: owner.aimDir,
      candidates: this.enemies.filter(e => !e.dead),
      flow: owner.flow,
      returnCone: owner.boonMods.returnCone,
      aimMode: this.settings.deflectAim || 'reticle',
    });
    bolt.pos.copy(bladePoint);
    bolt.prev.copy(bladePoint);
    bolt.vel.copy(res.dir).multiplyScalar(bolt.speed * (res.grade >= GRADE.RETURN ? 1.25 : 1));
    this._creditDeflect(owner, bolt, res, bladePoint);
    audio.deflect(bladePoint, res.grade);
    if (res.grade >= GRADE.RETURN) {
      this.notifyFloating(bladePoint, GRADE_NAME[res.grade], '#a8f0ff');
      if (res.grade === GRADE.PERFECT) { this.addHitstop(0.07); this.engine.flash(0.09); }
    }
    this.onDeflectFeedback?.(res.grade, bladePoint, DEFLECT_WHY[res.grade]);
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
        const shield = p.shieldBody?.();
        if (shield) {
          const hit = segmentNear(from, to, shield.p0, shield.p1, shield.r);
          if (hit) {
            shield.take(bolt.damage, hit, bolt.owner);
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
      if (bolt.team === 1 && !friendly) continue;
      if (bolt.team === 1 && bolt.owner === e && !bolt.turned) continue;
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
      if (bolt.owner && !canHarm(bolt.owner, e, this.rules)) continue;
      const caps = e.capsules();
      for (const c of caps) {
        if (c.shield) {
          const hit = segmentNear(from, to, c.p0, c.p1, c.r);
          if (hit) {
            e.damage(bolt.damage, hit, bolt.owner, 'bolt');
            this.particles.sparkBurst(hit, null, 10, { speed: 5, color: 0x88ffcc });
            return { point: hit, normal: _v3.subVectors(from, to).normalize().clone(), victim: e, bone: 'shield' };
          }
          continue;
        }
        const hit = segmentNear(from, to, c.p0, c.p1, c.r);
        if (!hit) continue;
        const vital = c.vital ?? 0.4;
        const dmg = bolt.damage * lerp(0.6, 1.9, vital);
        const killed = e.damage(dmg, hit, bolt.owner, 'bolt');
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
    /* A trooper of yours is not worth score, is not a kill, and does not feed
     * the combo — it is a casualty. Everything below this line is the reward for
     * killing something on the other side, and it must not pay out for losing
     * one of your own. */
    if (enemy.team !== undefined && enemy.team !== 1 && this.command) return;
    this.score += A.score;
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
      this.onGameOver?.({
        wave: this.director.wave,
        score: this.score,
        kills: this.players.reduce((a, p) => a + p.kills, 0),
        deflects: this.players.reduce((a, p) => a + p.deflects, 0),
        perfects: this.players.reduce((a, p) => a + p.perfects, 0),
        limbs: this.players.reduce((a, p) => a + p.limbsRemoved, 0),
      });
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
    const gained = this.communion.earn(wave, !!this.director?.isBossWave?.(wave));
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
    this._netWave = { w: this.director?.wave ?? 1, act: 0, started: false };
    if (mode === 'host') this._recordFires();
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
  _recordFires() {
    const pool = this.bolts;
    if (!pool || pool._netRecorder) return;
    const inner = pool.fire.bind(pool);
    pool._netRecorder = true;
    pool.fire = (origin, dir, opts = {}) => {
      const b = inner(origin, dir, opts);
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
    this._bondTick(net);
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
      const base = e._netHp;
      if (base === undefined) continue;
      const lost = base - e.hp;
      const killed = e.dead && !e._netDead;
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
    // Keyed on the peer it came from, exactly as a local ally's aura is keyed on
    // the ally: with three in a session the strongest live offer wins rather
    // than the most recent packet.
    return bondGive(p, { cut: msg.c, spd: msg.s, ward: msg.g, heal: msg.h }, this.time, from || 'peer');
  }

  /** Host → client: reconcile the enemy list against the snapshot. */
  applySnapshot(msg) {
    if (this.netMode !== 'client' || !this.terrain) return;
    const seen = new Set();
    for (const rec of msg.e) {
      const [id, type, x, y, z, f, hp, dead, vx, vz, tg, dl, md] = rec;
      seen.add(id);
      let e = this._netEnemyIndex.get(id);
      if (!e) {
        e = this.spawnEnemy(type, new THREE.Vector3(x, y, z));
        e.id = id;
        e.netDriven = true;
        this._netEnemyIndex.set(id, e);
      }
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
      if (dead && !e.dead) e.die(e.position.clone(), null, 'net');
    }
    this._spawnNetBolts(msg.bf);
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
   * THE WAVE SIGNAL, FOR A MACHINE WITH NO DIRECTOR.
   *
   * `director.update` is gated off on a client, and everything a wave is worth
   * hangs off the callbacks only that method fires: the WAVE N and WAVE CLEAR
   * announcements, `score += 500 * w`, the 8 hp and 0.35 flow every player gets
   * for surviving one — and INSIGHT, whose single earning path is
   * `_earnInsight` installed on `onWaveClear`. So a joining player earned zero
   * Insight for a whole session: the Constellation was a dead screen, the
   * "kneel to connect to the Force" prompt always read 0, no star could ever be
   * lit, and they were 8 hp and 0.35 flow per wave weaker than the host for as
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
      this.bolts.fire(_v1, _v2, {
        speed, damage, color, owner, team: 1, big: !!big, turned: !!turned,
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
   */
  _stepNetEnemies(dt) {
    for (const e of this._netEnemyIndex.values()) {
      if (!e._netPos || e.dead) continue;
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
    if (msg.k === 'cut') {
      const cap = e.capsules().find(c => c.name === msg.b);
      if (!cap) return;
      e.takeCut({
        // `ct`, NOT `t`: Net routes every message on `msg.t`, so the receiver
        // asking for the cut parameter under the same name would have read the
        // string 'claim'. Never caught because nothing ever sent one.
        bone: msg.b, cutT: msg.ct, cap, point: new THREE.Vector3(...msg.p),
        impulse: new THREE.Vector3(...msg.v), normal: new THREE.Vector3(0, 1, 0), speed: 20,
      }, by);
    } else if (msg.k === 'dmg') {
      e.damage(msg.d, new THREE.Vector3(...msg.p), by, 'remote');
    }
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
    this.unload();
    /* Terminal, and RapierWorld owns what that means — see its dispose(),
     * which frees the Rapier world instead of allocating a fresh one nobody
     * will ever step, and refuses anything that binds in afterwards. */
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
