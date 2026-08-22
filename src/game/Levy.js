/**
 * BATTLEFRONT BORZ — THE LEVY. FLAGSHIP §6's forty conscripts, fielded.
 *
 * "The lawnmower is only a lawnmower when mowing pays. Forty conscripts that
 * pay nothing are weather."
 *
 * `ARCHETYPES.conscript` was built last session and it is finished: 6 hp, one
 * turned pass, 0.71 of a B1's gun, and `World.paysOut` false so killing one
 * advances nothing at all. The lane that built it wrote down what was still
 * missing in one sentence — **"nothing yet fields forty conscripts"** — and
 * that is the whole of this file. A pool weight cannot do it: `conscript`
 * appears twice in the eleven Confederate entries of `LEVELS.geonosis.pool`,
 * so the composer draws about two of them into a wave of fifteen. Two
 * conscripts are not weather. They are a B1 that gave you nothing, which is
 * the worst version of the idea — the player learns the body is a waste of
 * time and never sees the thing the waste of time is FOR.
 *
 * ── WHY THE LEVY IS NOT BOUGHT OUT OF THE WAVE'S THREAT BUDGET ────────────
 *
 * This is the load-bearing decision and it is the opposite of what the rest of
 * Waves.js does, so it needs its argument written down.
 *
 * Everything in `_composeUnder` is bought: a body costs its `threat` and the
 * wave stops when the budget is gone. Put the levy on that ledger and forty
 * conscripts at threat 0.5 cost 20 — which at the Open Plain's wave-4 budget of
 * about 30 is the ENTIRE WAVE. The levy would arrive by deleting the rifles it
 * is supposed to be standing behind, and a levied wave would be strictly
 * EASIER than an unlevied one: forty bodies that do 1.4 dps each and die to one
 * pass, instead of ten that do 2.17 and have to be fought. Weather that makes
 * the storm smaller is not weather.
 *
 * So the levy is free, and the reason it is allowed to be free is the same
 * field that makes the conscript a conscript: `World.paysOut` is false, so the
 * levy is the one thing the director can add that changes NOTHING on either
 * ledger. It pays the player no score, no Flow, no combo and no war support,
 * and it costs the wave no threat. It is the only body on the roster that can
 * be given away in quantity without moving a number somebody tuned.
 *
 * The price it does pay is the FRAME, and that is measured rather than
 * asserted — see `LEVY_STRENGTH` and tools/checks/levy.mjs §the ladder.
 *
 * ── THE PACE IS DERIVED, NOT CHOSEN ──────────────────────────────────────
 *
 * `WaveDirector.update` feeds ONE entry off the queue per `spawnTimer`, and the
 * timer does not care what the entry is. Append forty conscripts to a fifteen-
 * body wave and the rifles arrive at a quarter of their old rate: at wave 3 the
 * gap is ~0.72 s, so the last paying body of a levied wave lands 40 s after the
 * first instead of 11 s after it. That is not "the wave got bigger", it is the
 * wave the director composed being delivered as a different wave.
 *
 * So the levy shortens the pace by exactly its own share of the queue —
 * `paying / (paying + levy)` — which makes the arrival RATE of the paying
 * bodies identical to what it was before the levy existed. One line, and it is
 * the only honest number: any other multiplier is a difficulty change smuggled
 * in beside a crowd.
 *
 * `alive` is raised by the levy's own size for the same reason. `maxAlive` is
 * 26 and FLAGSHIP §4 calls that honest; raising it to 66 for everybody would
 * re-point every wave in the game. Raising it BY the levy leaves the paying
 * bodies exactly the room they had.
 *
 * ── WHAT ADOPTS A BODY, AND WHY IT IS THE TYPE AND NOT A FLAG ────────────
 *
 * Nothing here marks a spawn. A `conscript` on the field IS the levy, however
 * it got there — off this composer, off the pool's own two entries, or out of
 * a sandbox. That is not laziness: the class was defined by an absence
 * (`score: 0`) rather than by a spawn path, and a rule that only held for
 * bodies this file queued would be a second definition of the same class,
 * which is HANDOFF §2.3's defect with a new coat.
 */

import * as THREE from 'three';
import { ARCHETYPES, paysOut } from './Enemy.js';
/**
 * `paysOut` CAME FROM `World.js` AND THE CYCLE WAS NOT SAFE.
 *
 * The note that stood here argued that Levy → World → … → Levy was harmless
 * because `paysOut` is a hoisted function declaration read at runtime rather
 * than a constant read at module scope. That is true of `paysOut` and it is
 * not what broke: the cycle it closed was
 *
 *     Command → Levy → World → Player → ui/Menu → Command
 *
 * and `ui/Menu.js` line 174 calls `registerOrders(FORMATIONS)` AT MODULE
 * SCOPE, off a `const` in the half-evaluated Command.js. Importing
 * `Command.js`, `Levels.js` or `tools/_flagship.mjs` as the first module of a
 * process threw `Cannot access 'FORMATIONS' before initialization` — the
 * flagship instrument would not load at all. A cycle is safe or unsafe because
 * of what is at module scope ANYWHERE around it, not because of the shape of
 * the one binding you are importing.
 *
 * So `paysOut` moved to `Enemy.js`, beside the `ARCHETYPES` row it asks about,
 * and this file reads it from there — still one statement in the tree of what
 * a body is worth (HANDOFF §2.4), one hop shorter, and out of ui/'s way.
 */
import { ROUT_PER_FRAME } from './Waves.js';

/** The body class the levy is made of. FLAGSHIP §6's third class. */
export const LEVY_TYPE = 'conscript';

/**
 * HOW MANY. §6 says forty, and forty is what the frame was measured against.
 *
 * MEASURED, on a real `high` World on geonosis in Command, camera on the
 * player, over a 90-second engagement with the shipped composer, the shipped
 * arrivals and the shipped LOD ladder. A body's cost in visible meshes is a
 * pure function of its rung and the ladder is clean:
 *
 *     conscript   12 m LOD0  45 meshes · 45 m LOD1  23 · 90 m LOD2  4 · 170 m LOD3  0
 *     b1          the same four numbers, exactly
 *     trooper     47 · 26 · 4 · 0
 *
 * So forty conscripts standing ON you is 1 800 draw calls and no ladder can
 * help: L2 does not begin until 62 m. That number is the ceiling this constant
 * is up against, and it is not what a levy actually costs, because a levy
 * arrives from the spawn ring at 58-96 m and dies on the way in. Measured
 * through the shipped path, peak over the engagement:
 *
 *     no levy    18 bodies (10 of them yours)    767 body draw calls
 *     levy 40    64 bodies                     1 415 body draw calls
 *
 * — 46 more bodies for 648 more calls, 14 a body against the 45 a contact body
 * costs, because at any instant most of the mass is still crossing the ground
 * at L1 and L2. THAT is the ladder earning its keep, and it is the first time
 * `MergedSkin` and `Cohorts` have been asked to carry a real mass rather than
 * a bench of 42 bodies stood at a fixed radius.
 *
 * The number is not raised past forty and the reason is arithmetic rather than
 * taste: the levy's cost is linear in bodies at every rung, so eighty is 2 830
 * calls at the same peak and there is nothing in the ladder that bends. Forty
 * is what §6 asked for and forty is what the frame was shown to hold.
 */
export const LEVY_STRENGTH = 40;

/**
 * Does this director's ground want a levy at all?
 *
 * ASKED OF THE POOL, not of a list of level keys. A level that names
 * `conscript` in its pool has said it wants the body; a level that does not has
 * said it does not, and a hand-written list of grounds beside `LEVELS[*].pool`
 * is the twin-table defect (HANDOFF §2.3) waiting to happen. Today that is
 * geonosis and only geonosis, which is the mode's own ground.
 */
export function levies(director) {
  if (!director || !ARCHETYPES[LEVY_TYPE]) return false;
  /**
   * …AND IT IS THE CROSSING'S, NOT A CONTINGENT'S.
   *
   * `CommandDirector` runs four things: Command, a skirmish, a campaign, and a
   * CONTINGENT — the same roster and ranks and permadeath dropped into a mode
   * that has its own escalation and its own ending. `campaign` is the field
   * that already draws exactly that line and is read by `budgetFor`,
   * `heavyBias`, `payWave` and `unlockAt` for the same reason: a second
   * escalation on top of an endless one ends the Trial of Waves on wave 21 and
   * calls it a victory. Forty free bodies a wave, forever, is that mistake
   * spelled in bodies — and it is the one version of it the frame would notice.
   */
  if (director.campaign === false) return false;
  return !!director.pool?.includes(LEVY_TYPE);
}

/**
 * How many conscripts this wave's levy is.
 *
 * Flat, and that is deliberate. Everything else in this mode escalates — the
 * budget, the heavy bias, the muster shelf — and the levy is the one thing that
 * must not, because its whole content is that it is not worth anything. A levy
 * that grew would be an escalation made of bodies that pay nothing, which is
 * the reward curve and the difficulty curve pulling in opposite directions.
 * The weather is the same weather in area 1 and area 5; what changes is what is
 * shooting from inside it.
 */
export function levySize(director, wave = director?.wave ?? 1) {
  if (!levies(director)) return 0;
  return LEVY_STRENGTH;
}

/**
 * Put the levy into a composed wave.
 *
 * Takes and returns `_composeUnder`'s own `{queue, left, shape}` record, so the
 * surplus loop in `_compose` — which re-composes and reads `left` to buy
 * another condition — sees exactly what it saw before: the levy costs no
 * budget, so `left` is untouched and the conditions a wave buys are the
 * conditions it would have bought.
 *
 * The levy goes in BEHIND the shuffle, not into it. A shuffled levy would put
 * conscripts in the first rank at random and the wave would open with weather;
 * appended, the paying bodies of the wave lead and the mass comes in over them,
 * which is the shape the reference plates of this battle have and the shape the
 * pace correction above assumes.
 */
export function applyLevy(out, director, wave = director?.wave ?? 1) {
  const n = levySize(director, wave);
  if (!n || !out?.queue || !out.shape) return out;
  const paying = out.queue.length;
  for (let i = 0; i < n; i++) out.queue.push(LEVY_TYPE);
  /* The room and the rate. Both are stated against `paying`, so a wave the
   * composer made small gets the same levy and the same paying-body cadence as
   * one it made large. */
  out.shape.alive = (out.shape.alive ?? 26) + n;
  out.shape.pace = (out.shape.pace ?? 1) * (paying / (paying + n));
  out.shape.levy = n;
  /* The pack that takes them off again. Made here rather than at level load,
   * because the only world that needs one is a world whose director has just
   * composed a levy. */
  attachLevy(director?.world);
  return out;
}


/* ══════════════════════════════════════════════════════════════════════ */
/*  When the levy stops being on the field                                */
/* ══════════════════════════════════════════════════════════════════════ */

/**
 * THE DEFECT THE FIRST FIELDING HAD, WHICH IS WORTH THE WHOLE OF THIS SECTION.
 *
 * Measured, on a real Command world on geonosis at wave 3, an idle player and
 * the shipped composer, 90 seconds:
 *
 *     no levy    the wave cleared at s72
 *     levy 42    still wave 3 at s90, with 26 conscripts standing
 *
 * `WaveDirector.update` ends a wave when nothing that `blocksWaveEnd` is alive,
 * and `blocksWaveEnd` is "not dead, and not on your team". A conscript is both,
 * so forty of them are forty bodies the player has to KILL before the wave can
 * end — which is the precise inversion of the design. §6's sentence is that
 * mowing does not pay; a levy that gates the wave makes mowing not merely
 * profitable but COMPULSORY, and the mode would have shipped with the one
 * mechanic that was supposed to stop the lawnmower being the thing that hands
 * the player the lawnmower.
 *
 * ── AND THE FIX IS NOT `blocksWaveEnd` ───────────────────────────────────
 *
 * The obvious repair is to override it so an unpaid body does not gate the
 * wave. It is wrong, and the reason is that ONE METHOD IS ANSWERING TWO
 * QUESTIONS. `update` computes `alive` off `blocksWaveEnd` once and uses it
 * both for "is the wave over" and for "may another body be let onto the field"
 * (`alive + inbound < maxAlive`). Take the levy out of it and the second
 * question loses its answer: the concurrency cap stops seeing forty of the
 * bodies on the field and the director dumps the whole queue as fast as the
 * spawn timer allows, which is the frame budget this file spent its whole
 * `LEVY_STRENGTH` note measuring, thrown away in one line.
 *
 * ── SO THE LEVY BREAKS ───────────────────────────────────────────────────
 *
 * When the last PAYING body of the wave is down and there are no more coming,
 * the conscripts break and run — the levy is not something you clear, it is
 * something that stops being there once the regulars it was standing behind
 * are dead. That is FLAGSHIP §7's first verb told from the other side, it is
 * what a levy has always done in every battle anyone has written down, and it
 * needs no change to the base director at all.
 *
 * Withdrawn a few a frame off `ROUT_PER_FRAME` for the reason `_rout` gives
 * about itself: "a line that collapses over two seconds is something you watch
 * break; a line that all falls on the same frame is a bug that happens to be
 * intentional."
 *
 * ── WHY IT IS A PROP AND NOT A LINE IN THE DIRECTOR ──────────────────────
 *
 * `World.update` steps every entry of `world.props` once a frame, so a prop is
 * a per-frame tick that costs no edit to World.js and none to Waves.js — the
 * same seam `Flight.js` and `Riders.js` both take, and its whole cost on a
 * ground with no levy is one early return.
 */

/**
 * ── WHAT FORTY EXTRA RIFLES DO TO YOUR LINE, AND THE ANSWER THAT DID NOT WORK
 *
 * MEASURED, on a real Command world on geonosis with an IDLE player — no
 * blade, no dash, no orders — ninety seconds, a roster of ten:
 *
 *     no levy    10 → 8 at 30 s → 5 at 60 s → 2 at 90 s, player alive
 *     levy 40    10 → 6 at 30 s → 0 at 60 s → 0,          player dead
 *
 * Forty extra rifles is forty extra rifles. §6 prices a conscript at 1.4 dps
 * "against a MOVING PLAYER" — a player with a guard, a dash and a dive — and a
 * clone trooper has none of those: he has 46 hit points and a slot to stand in.
 * (Both columns are new. Until this session no hostile bolt could touch a body
 * in `world.enemies` at all, your own troopers included — FLAGSHIP §16.3 — so
 * the honest comparison is not "before the levy" but "the first time the line
 * could be shot".)
 *
 * THE ANSWER, AND THE MEASUREMENT THAT NEARLY THREW IT AWAY. §6's paragraph is
 * about the PLAYER throughout — "Twenty B1s fire 18 bolts/s… The crowd does not
 * kill you. It nails your feet to the floor, and then the four B2s at 5.85 dps
 * each kill you" — so the levy AIMS AT THE JEDI. `installLevyAim` below is the
 * whole of it: one instance wrapper round `_think` that substitutes
 * `ctx.pickTarget` for that body only, so the fill of the wave goes on fighting
 * your line while the weather comes for you.
 *
 * It was written, measured, REMOVED as useless, and put back — and the reason
 * is worth more than the rule. Measured on the idle-player bench above it moved
 * the roster from 6 to 7 at thirty seconds and not at all at sixty, which reads
 * as a rule that does nothing. **The bench was the problem.** Forty bodies
 * converging on a player who never moves kill the player in under a minute, and
 * a levy with no blade left to walk at falls back on the line anyway — so the
 * arm that was supposed to show the levy pointed away from the line spent most
 * of its window pointed straight back at it. An idle Jedi is not a Jedi; it is
 * a corpse with a delay.
 *
 * `tools/_linetoll.mjs` is the bench that can see it: it holds the player
 * unkillable, which is the honest stand-in for a player who is playing, and
 * tallies every point of damage that lands on a party-team trooper by the
 * archetype that dealt it. That is the instrument any future tuning of this
 * number should use.
 *
 * WHAT IS STILL OPEN, stated so the next lane does not re-derive it: how much
 * of a ten-man roster one engagement should cost, now that the roster can be
 * shot at all (FLAGSHIP §16.3 — until this session it could not be). The muster
 * between areas is what refills a line and §13 wants the name list to shrink;
 * what nobody has set is the rate.
 */
function installLevyAim(e) {
  if (!e || e._levyAim) return false;
  const base = e._think;
  if (typeof base !== 'function') return false;
  e._levyAim = true;
  e._think = function (dt, ctx) {
    const pick = ctx.pickTarget;
    if (typeof pick !== 'function') return base.call(this, dt, ctx);
    /* THE SUBSTITUTION HAS TO HAPPEN WHERE THE PICK HAPPENS. `Enemy._think`
     * opens with `this.target = this.compelled?.target ?? ctx.pickTarget(this)`
     * and everything below it — `wish`, the cover hunt, `_shoot` — reads that
     * one field, so a target written from a prop tick is both overwritten next
     * frame and, in the frame it survives, a body walking toward one thing and
     * shooting at another. `ctx` is the world's single per-frame context
     * object, so it goes back in a `finally`. */
    ctx.pickTarget = (b) => {
      if (b !== this) return pick(b);
      /**
       * THE SAME PICKER, ASKED WITH THE OTHER ARMY OUT OF THE ROOM.
       *
       * `World.pickTarget` runs two passes: every player this body is allowed
       * to fight, and then — only `if (this.command)` — every cross-army body.
       * What a levy wants is the first pass and not the second, and the honest
       * way to get it is to ask the shipped function rather than to write a
       * second copy of "who may this body shoot at" (HANDOFF §2.4: an
       * instrument that restates a rule eventually disagrees with it, and it
       * fails by manufacturing defects). `hostileTo` and `canHarm` are the one
       * gate in the game, they live in Player.js, and importing them from here
       * closes an initialisation cycle — Levy is imported by Command, which is
       * imported by Levels — that throws `Cannot access 'COMMAND_UNITS' before
       * initialization` for any entry point reaching Command.js first.
       *
       * So the field the second pass is gated on is taken away for the length
       * of ONE synchronous call and put back in a `finally`. Nothing else runs
       * in between: `pickTarget` is a loop over two arrays with no awaits, no
       * events and no callbacks.
       */
      const w = this.world;
      let best = null;
      if (w) {
        const cmd = w.command;
        w.command = null;
        try { best = pick(b); } finally { w.command = cmd; }
      }
      /* No blade left to walk at — a levy on a field with no Jedi standing
       * still has to do something, and what it does is whatever it would have
       * done. That is also every mode with no player on the party's team. */
      return best || pick(b);
    };
    try { return base.call(this, dt, ctx); } finally { ctx.pickTarget = pick; }
  };
  return true;
}

class LevyPack {
  constructor(world) {
    this.id = 'levy';
    this.world = world;
    this.dead = false;
    this.kind = 'levy';
    this.grippable = false;
    this.generation = 0;
    this.toughness = Infinity;
    this.hp = Infinity;
    this.broke = false;
    this.body = {
      /* REAL VECTORS, and it cost a run to learn: `World._resolveBlades` walks
       * `world.props` and calls `pr.body.position.distanceToSquared(...)` on
       * every one of them before it looks at anything else, so a duck-typed
       * body carrying plain `{x,y,z}` throws on the first frame a blade is
       * lit. `FlightPack` had this right; the shape is copied from it. */
      position: new THREE.Vector3(), quaternion: new THREE.Quaternion(),
      velocity: new THREE.Vector3(), angularVelocity: new THREE.Vector3(),
      boundingRadius: 0, mass: 0, invMass: 0, static: true,
      applyImpulse() {}, wake() {},
    };
    this.mesh = null;
  }

  capsules(out = []) { out.length = 0; return out; }
  cut() { return []; }
  shatter() {}
  damage() { return false; }

  /**
   * `paysOut` and `blocksWaveEnd` are both ASKED rather than restated (HANDOFF
   * §2.4). The first is World's one statement of "is this body worth anything";
   * the second is the director's one statement of "is this body the wave". A
   * second copy of either here would eventually disagree with the thing it is
   * describing, and it would disagree silently.
   */
  update() {
    const w = this.world;
    const d = w?.director;
    if (!d || !d.active || !w.enemies) { this.broke = false; return; }
    let paying = 0;
    const levy = [];
    for (const e of w.enemies) {
      if (!d.blocksWaveEnd(e)) continue;
      if (paysOut(e.A)) paying++;
      else levy.push(e);
    }
    /* THE AIM, INSTALLED ONCE A BODY, on the same one-pass-over-the-enemies
     * `FlightPack` makes. Its whole cost on a ground with no levy is the early
     * return above. */
    for (const e of levy) installLevyAim(e);
    if (!levy.length) { this.broke = false; return; }
    /* Anything still queued or in the air counts as the wave not being over —
     * `delivered` is the director's own word for it, and asking it is what
     * stops a levy breaking in the gap between two gunships. A queue holding
     * nothing but levy entries is not a wave still coming, so those are
     * dropped rather than waited for. */
    if (!this.broke) {
      if (paying > 0) return;
      const queued = d.spawnQueue.filter((e) => paysOut(ARCHETYPES[String(e).split('|')[0]]));
      if (queued.length || d.arrivals?.pending) return;
      d.spawnQueue.length = 0;
      this.broke = true;
      w.notify?.('THE LEVY BREAKS', `${levy.length} conscripts run — they were never the wave`);
    }
    let n = 0;
    for (const e of levy) {
      if (n >= ROUT_PER_FRAME) break;
      e.dead = true;
      /* `1e6`, NOT `0` — the same ceiling `CommandDirector.recall` uses, and for
       * the reason its own note gives twenty lines of: a body retired this way
       * is never ragdolled, never loses its capsule and is never handed to
       * `Corpses`, and `Enemy.update`'s dead branch POSES NOTHING. So `dying:0`
       * left a soldier standing frozen in a walk pose, untouchable by anything
       * the player can do to it, until `World.update` disposed it at `dying >=
       * 40` — forty seconds of scenery per routed man, dozens at a time.
       * Reported as exactly that: "a lot of enemies would be dead technically
       * but their corpses would be standing and frozen, immaterial, and there
       * would be many like that across the battlefield." The ceiling makes the
       * body leave on the next frame, through the door every other body leaves
       * by. */
      e.dying = 1e6;
      /* Null source, exactly as `_rout` and `_retire` do it: nobody killed
       * these and nobody is credited with them. `paysOut` is false for a
       * conscript anyway, so this cannot pay — the null is there so that the
       * day a levy is made of something else, it still cannot. */
      w.onEnemyKilled?.(e, null, 'rout');
      n++;
    }
  }

  destroy() {
    if (this.dead) return;
    this.dead = true;
    const i = this.world.props.indexOf(this);
    if (i >= 0) this.world.props.splice(i, 1);
  }
  dispose() { this.destroy(); }
}

/** The world's levy pack, made on demand by the first wave that fields one. */
export function attachLevy(world) {
  if (!world) return null;
  if (world.levy && !world.levy.dead) return world.levy;
  const pack = new LevyPack(world);
  world.levy = pack;
  if (world.addProp) world.addProp(pack);
  else if (world.props) world.props.push(pack);
  return pack;
}

export { LevyPack };
