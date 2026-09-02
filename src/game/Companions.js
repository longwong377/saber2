/**
 * ══════════════════════════════════════════════════════════════════════════
 *  BATTLEFRONT BORZ — THE COMPANION
 * ══════════════════════════════════════════════════════════════════════════
 *
 * "I want you to build companions, this is a feature seperate from your troops
 *  this is like a pet/close personal companion/protector that you can choose to
 *  go into battle with … they stay close to you at all times but you can give
 *  them a limited set of orders … obviously they're going to be less mobile
 *  than you so protecting the companions and keeping them safe is another thing
 *  the player can choose to worry about … this relationship between player and
 *  companion should be really cool"
 *
 * ── WHAT A COMPANION IS, IN ONE SENTENCE ─────────────────────────────────
 *
 * One body that is yours in every mode without ever being on the roll.
 *
 * Every clause of that is load-bearing. ONE, so there is nothing to average
 * and nothing to replace — the muster sells you another trooper and there is
 * no muster for this. YOURS IN EVERY MODE, because nine of the eleven give you
 * no troops at all: the order wheel is dark, the roster is hidden, and you
 * fight alone. And NOT ON THE ROLL, because the roll is `Company.keep`, the
 * muster and permadeath, and REVIEW-V12's "what I would not touch" says
 * plainly that a feature must be built around that door rather than through
 * it.
 *
 * ── WHY IT IS A PACK IN `world.props` AND NOT A TROOPER ───────────────────
 *
 * `CommandDirector.steer` — the follow-the-player machinery — returns on its
 * first line if `!e.trooper`, and everything under it reads `e.trooper.*`: the
 * broken flag, the rout, the medic, the leash, the slot index, the squad key.
 * So a companion could only have the follow code by being a Trooper on a
 * CommandRoster, and that would put it in the muster, in the formation, in the
 * squad plan and on the order-of-battle screen — a pet with a rank and a
 * casualty row.
 *
 * The follow point is fifteen lines. So the companion writes them itself and
 * `commandOf` is never set, and with it go every hazard that only exists for a
 * body that has one: `commanderOf` never returning null, `slotFor`'s zero
 * defaults, the `_troops` stamp loop, the `underFire` latch. All of them at
 * once, by not opting in.
 *
 * `world.props` is the seam two shipped subsystems already use — `Riders.js`
 * and `Flight.js` — and its own note says why: the World's update order is
 * enemies (2), blades (3), bolts (4), physics (5), props (6), so a prop's
 * `update` runs after every body has moved and before anything draws, and it
 * costs no line in World.js at all.
 *
 * ── THE ONE THING THAT COULD NOT BE DONE FROM A PROP TICK ─────────────────
 *
 * Targeting. `Enemy._think` opens with
 *
 *     this.target = this.compelled?.target ?? ctx.pickTarget(this);
 *
 * and everything under it — the wish, the cover hunt, `_shoot` — reads that
 * one field. A target written from a prop tick is overwritten on the next
 * frame, and in the frame it survives it is a body walking toward one thing
 * and shooting at another. `Levy.js`'s `installLevyAim` had this exact problem
 * and solved it by wrapping `_think` on the one body and substituting
 * `ctx.pickTarget` for the length of one synchronous call. This is that
 * pattern, pointed the other way.
 *
 * AND THE OTHER WAY IS THE WHOLE PROBLEM. `World.pickTarget` runs two passes:
 * every player this body may fight, and then — `if (this.command)` — every
 * cross-army body. `this.command` is null in every mode without a
 * CommandDirector, which is nine of the eleven. So a friendly body outside
 * Command literally cannot find an enemy: the levy wanted the first pass and
 * not the second, and a companion wants the second and cannot have it.
 *
 * `World._hostilesFor(who)` is the answer and it is already there, gated on
 * nothing: one pass over the enemies and the players returning everything this
 * body is opposed to. It is what `CommandDirector.targetFor` reaches back
 * through when it has no leash. Asking it for ONE body, once a frame, is a
 * single linear pass and costs what a trooper already costs.
 *
 * ── LESS MOBILE THAN YOU, AND THAT IS THE FEATURE ─────────────────────────
 *
 * The brief says it: "obviously they're going to be less mobile than you so
 * protecting the companions and keeping them safe is another thing the player
 * can choose to worry about". You dash at 15.5 m/s; it walks. Every good
 * decision you make with your own body — break left, cross the open, take the
 * high line — leaves it behind in the fire. It is not a power-up you carry, it
 * is a liability you chose, and the tension between your mobility and its
 * loyalty is the whole relationship.
 */

import * as THREE from '../../vendor/three/three.module.js';
import { ARCHETYPES } from './Enemy.js';
/* The friendly-fire scaling every ally in the game already gets — see
 * `fieldCompanion`, which is the one place it is installed. */
import { installTeamDamage, TEAM_DAMAGE_DEFAULT } from './Command.js';
/* The move table and the length of the winded window, both read rather than
 * restated — see `CompanionPack.update`. */
import { BEAST_MOVES, WIND_OPEN } from './Enemy.js';
/* The one gate every damage path in the game answers to — see `installCompanionHide`. */
import { canHarm } from './Player.js';

/* ══════════════════════════════════════════════════════════════════════════ */
/*  The dial                                                                  */
/* ══════════════════════════════════════════════════════════════════════════ */

/**
 * How far behind you it tries to stand, and the band it is happy in.
 *
 * `HEEL` is a point rather than a radius because a companion that merely stays
 * within a circle wanders across your line of fire; one that holds a station
 * off your back quarter is somewhere you can predict.
 *
 * 3.4 m BACK AND 0.9 ACROSS, AND THE FIRST TWO NUMBERS I TRIED KILLED IT.
 * At 2.2 m and 0.35 across, the kill test's player — walking a circle with a
 * lit blade — cut his own companion down inside sixty seconds: measured, six
 * hits and 101 damage at a range of 1.5 m, and the animal ended the minute at
 * -311 of 210 hp. A saber is about 1.4 m on a 1.9 m arm and the sweep reaches
 * past three, so a station at 2.2 m is a station inside the swing. The heel
 * has to stand OUTSIDE the arc of the thing it is standing behind.
 */
export const HEEL = { back: 3.4, side: 0.9, slack: 1.1 };

/**
 * How far from its station it will go — to fight or to wander — before the
 * walk home overrides whatever it wanted.
 *
 * ONE NUMBER FOR TWO QUESTIONS, DELIBERATELY. It is both the radius the target
 * search is measured over and the distance that triggers the recall, and they
 * have to be the same number or the animal grabs something at the edge of its
 * sight and is dragged home before it arrives — a dog that starts every charge
 * and finishes none.
 *
 * 8 m was the first value and it made the companion useless in exactly that
 * way: measured over a minute, a target on 13.2% of frames and 508 frames
 * stood still with something shooting at its owner from inside twenty metres.
 * The station sits 3.4 m off your back, so 14 lets it reach about seventeen
 * metres in front of you — a charge at what is shooting at you — and no
 * further. Same minute at 14: see the kill test's own numbers.
 */
export const LEASH = 14;

/** Inside this of its station it stops walking, so it does not jitter on the spot. */
export const SETTLED = 0.55;

/* ══════════════════════════════════════════════════════════════════════════ */
/*  1. THE TWO WRAPS                                                          */
/* ══════════════════════════════════════════════════════════════════════════ */

const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();

/**
 * WHO THIS BODY IS ALLOWED TO FIGHT, ASKED OF THE WORLD.
 *
 * `Levy.js`'s note applies here word for word: an instrument that restates a
 * rule eventually disagrees with it. `_hostilesFor` is the shipped answer to
 * "everything one body on this field is opposed to", it already excludes the
 * dead, the downed and its own team, and it is what the director itself falls
 * back to. Nothing here re-implements the question.
 */
function installCompanionAim(e) {
  if (e._companionAim) return;
  e._companionAim = true;
  const think = e._think.bind(e);
  e._think = function (dt, ctx) {
    const pick = ctx.pickTarget;
    /* SUBSTITUTED FOR THE LENGTH OF ONE SYNCHRONOUS CALL and put back in a
     * `finally` — `_think` is a straight line with no awaits, no events and no
     * callbacks, so nothing else can observe the swap. Levy.js:336 argues this
     * at length and this is the same trade. */
    ctx.pickTarget = (b) => {
      if (b !== e) return pick(b);
      const w = e.world;
      if (!w?._hostilesFor) return pick(b);
      let best = null, bestD = Infinity;
      const leash = (e._cmpLeash ?? LEASH);
      /* THE ORDER FIRST, IF THERE IS ONE AND IT IS STILL ALIVE. A companion
       * told to take a body takes THAT body, which is the whole of "attacking
       * a specific enemy that you target". */
      /**
       * THE LEASH IS ON ITS FEET, NOT ON ITS EYES, AND THE OTHER WAY ROUND
       * COST THE ANIMAL ITS WHOLE FIGHT.
       *
       * The first version of this returned null the moment the companion was
       * dragged past the leash, on the reasoning that a body which keeps its
       * target fights its own steering. It does not: the move wrap below
       * overrides the wish outright when `dragged`, so the pull home was never
       * contested. What the null actually did was stop the brain.
       *
       * `Enemy._brain` returns on `if (!target)` before it ever reaches
       * `_meleeBrain`, so a creature with no target is a creature whose state
       * machine is NOT SERVICED — `stateTime` goes on climbing (Enemy.js:6175)
       * and nothing reads it. Measured over one minute of the kill test: the
       * animal froze mid-`lunge` with no target and stayed there, and a
       * `winded` window that is 2.4 seconds long lasted TWELVE — from t=5 s to
       * t=17 s, a fifth of the minute, standing still. It dealt 0 damage in
       * 0 blows while getting to within 0.2 m of something it was hunting.
       *
       * The leash it actually needs is the one below: the search is measured
       * from the STATION, so a hostile out of reach of where the animal is
       * supposed to be is never a target in the first place, and the walk home
       * is the move wrap's job. Nothing here returns null that `_hostilesFor`
       * would not have returned null for.
       */
      const bid = e._cmpBidden;
      if (bid && !bid.dead && bid.team !== e.team) return bid;
      const home = e._cmpHome;
      for (const o of w._hostilesFor(e)) {
        /* KEPT ON A LEASH ROUND ITS STATION AND NOT ROUND ITSELF. A companion
         * that chased the nearest hostile would walk itself out of the fight
         * one body at a time; measuring from where it is SUPPOSED to be is
         * what keeps it beside you. */
        const from = home || e.position;
        const d = o.position.distanceToSquared(from);
        if (d > leash * leash) continue;
        if (d < bestD) { bestD = d; best = o; }
      }
      return best;
    };
    try { return think(dt, ctx); } finally { ctx.pickTarget = pick; }
  };
}

/**
 * WHERE IT WANTS TO BE, WRITTEN AFTER THE BRAIN AND BEFORE THE MOVE.
 *
 * The only slot between `_think` and `_move` is an instance wrap of `_move`
 * itself, and two shipped subsystems already take it — `Flight.js:440` and
 * `Command.js:4809`, whose note says why it is the right one: the wrapper
 * steers FIRST and calls the original SECOND, so everything `_move` already
 * does — the wall slide, the stuck commit, the backpedal limit, the
 * acceleration ramp, the grade limit, the support query — applies to a
 * companion exactly as it applies to a charge. A formation is not a different
 * movement model; it is a different destination for the same one.
 *
 * `_think` returning a null wish is harmless, because this runs after it and
 * base `_move` consumes the wish after that.
 */
function installCompanionMove(e) {
  if (e._companionMove) return;
  e._companionMove = true;
  const move = e._move.bind(e);
  e._move = function (dt, ctx) {
    /**
     * ITS JAWS TRACK WHAT THEY ARE BITING, BECAUSE WHAT IT BITES CANNOT READ
     * THE TELEGRAPH — and this is the fourth thing a companion is the first
     * body in the game to need.
     *
     * `hitTarget` resolves a creature's blow against `swingAt`: the point the
     * target stood on when the wind-up began, tested against a footprint of
     * `M.reach × A.scale`. Enemy.js argues that at length and the argument is
     * right — it is what makes a telegraphed attack DODGEABLE, and it was
     * measured against a real player breaking sideways. Every word of it is
     * about a player.
     *
     * A B1 is not dodging. It is walking, at about 4 m/s, and a massiff's
     * lunge remembers its point half a second before the claw arrives — so the
     * droid is 2 m away from a 0.71 m footprint through no decision of its
     * own. Measured on the kill test: sixty seconds, a target for 46% of them,
     * closest approach 0.2 m, and ZERO blows landed. Wild creatures never hit
     * this because a wild creature fights the player from the frame it spawns;
     * a companion is the first beast in the game whose whole job is fighting
     * NPCs.
     *
     * So the remembered point is refreshed while the blow is still in flight,
     * for a target that is not a player. A player keeps the dodge exactly as
     * Enemy.js designed it — in co-op and versus, where a companion's hostile
     * CAN be a player, footwork still beats the animal. `_swiped` is the
     * engine's own "the blow has landed" latch, so nothing is re-aimed after
     * the fact, and the moves that aim at the animal itself (`aim: 'self'`)
     * never read this field at all.
     *
     * The player test is `isLocal !== undefined`, which is `Extraction.js`'s
     * own — one idiom for "this body is somebody playing".
     */
    {
      const t = e.target;
      if (e.swingAt && t && !t.dead && !e._swiped && t.isLocal === undefined) {
        e.swingAt.copy(t.position);
      }
    }
    let was = null;
    const p = e._cmpOwner;
    const owned = !!(p && p.alive !== false && !p.dead && p.position);
    /**
     * AN OWNER WHO IS DOWN LEAVES IT STANDING WHERE HE FELL, AND THIS IS THE
     * ONE BRANCH THE KILL TEST FOUND BY DYING.
     *
     * Written as `if (owner) … ` and nothing else, the station is simply not
     * updated on a frame where the owner is gone — so `_cmpHome` keeps the
     * last point it was written at, forever. Everything downstream then reads
     * a ghost: the wish is never rewritten, the leash in the aim wrap measures
     * hostiles from a spot nobody is standing on, and the animal stands still
     * with its own speed decaying to zero while the fight goes on around it.
     * Measured on the kill test's own minute — the player died at 24.5 s and
     * the remaining 35 s recorded an animal 33.7 m from a station it thought
     * was 8.5 m away, at 0.000 m of movement a frame.
     *
     * Standing its ground is the answer and it is also the right one to read
     * on the field: the station becomes WHERE IT IS, so the leash still binds
     * — around itself now instead of around you — and it goes on taking
     * anything that comes inside it. A dog over a body, not a statue.
     */
    if (!owned) {
      e._cmpHome = (e._cmpHome || new THREE.Vector3()).copy(e.position);
    }
    if (owned) {
      /* THE STATION: off the owner's back quarter, on the side it was born on
       * so two companions in co-op do not stand in one place. */
      const yaw = p.aimDir ? Math.atan2(p.aimDir.x, p.aimDir.z) : (p.facing || 0);
      const side = e._cmpSide || 1;
      _v1.set(
        p.position.x - Math.sin(yaw) * HEEL.back + Math.cos(yaw) * HEEL.side * side,
        p.position.y,
        p.position.z - Math.cos(yaw) * HEEL.back - Math.sin(yaw) * HEEL.side * side,
      );
      e._cmpHome = (e._cmpHome || new THREE.Vector3()).copy(_v1);
      const dx = _v1.x - e.position.x, dz = _v1.z - e.position.z;
      const d = Math.hypot(dx, dz);
      /* IT ONLY WALKS HOME WHEN IT HAS NOTHING BETTER TO DO, or when it has
       * been dragged past the leash. A companion that abandoned a body it was
       * biting because you took a step would never finish anything. */
      const busy = !!e.target && !e.target.dead;
      const dragged = d > (e._cmpLeash ?? LEASH);
      if (dragged || !busy) {
        if (d > SETTLED) {
          e.wish = (e.wish || new THREE.Vector3()).set(dx / d, 0, dz / d);
          if (!e.toTarget) e.toTarget = new THREE.Vector3();
          e.toTarget.copy(e.wish);
          /* A TROT HOME, NOT A SPRINT. It is meant to be slower than you —
           * this only lets it close a gap you opened at a walk, and it is the
           * archetype's own speed rather than a second number. */
          const want = (e.A?.speed ?? 4) * (dragged ? 1.25 : 1);
          if (want > e.speed) { was = e.speed; e.speed = want; }
        } else if (!busy) {
          e.wish = null;
        }
      }
    }
    /**
     * AND THE PACE GOES BACK, which `CommandDirector.steer` also does and for
     * the reason its note gives: a catch-up speed written and not restored
     * compounds with everything else that scales speed. Measured before this,
     * over one minute of the kill test, the companion's `speed` climbed 5.8 →
     * 6.3 → 6.5 and never came down — a dog that gets permanently faster every
     * time you walk away from it.
     */
    try { return move(dt, ctx); } finally { if (was !== null) e.speed = was; }
  };
}

/**
 * YOUR OWN BLADE DOES NOT TAKE YOUR OWN ANIMAL APART.
 *
 * `World._resolveBlades` hands the solver every living enemy near the blade —
 * with one guard, for a stick riding down with you — and nothing on that path
 * asks `canHarm`. That is right for what it was written for: your blade IS
 * dangerous to the men around you, and `installTeamDamage` scales what lands
 * so a brush costs a trooper a slice rather than his life.
 *
 * `takeCut` is the hole. It subtracts from `hp` DIRECTLY — the note on its own
 * line says why, so that a sever can open the winded window — so the
 * friendly-fire scaling every ally has never sees it, and a cut the solver
 * calls vital is `maxHp * 2`. Measured on the kill test with friendly fire OFF
 * and `canHarm(player, dog)` answering FALSE: the animal lost 420 hp in a
 * single frame at t=12.53 s, from 144 to -276, killed by a player who was not
 * attacking — walking a circle with a lit blade while the dog crossed behind
 * him to reach a droid.
 *
 * So the companion answers the gate the rest of the game answers. Friendly
 * fire off — the default, and every mode where the roster exists — and your
 * blade passes through it. Friendly fire on, which the player turned on
 * deliberately, and it cuts exactly as it cuts anything else. One rule, read
 * rather than restated, and the slider already in the menu is its switch.
 *
 * A WRAP AND NOT A LINE IN `_resolveBlades`, for the reason the header gives:
 * the whole feature is built so that World.js does not learn the word
 * companion. The guard belongs to the body that needs it.
 */
function installCompanionHide(e) {
  if (e._companionHide) return;
  e._companionHide = true;
  /**
   * BOTH PATHS, BECAUSE THE BLADE HAS TWO AND ONLY ONE OF THEM SEVERS.
   *
   * Stopping `takeCut` alone left the grind — `_applyBladeEvent`'s ordinary
   * contact damage, which goes through `damage()` — and that path is not
   * gated either. Measured with the sever blocked and nothing else changed:
   * the same idle circuit put 249 damage into the animal over 17 contacts and
   * still killed it inside the minute.
   *
   * `canHarm` in `damage` is a no-op for everything else that can reach this
   * body — bolts, powers and explosions all consult it before they call —
   * so what this actually gates is the one path that does not.
   */
  const cut = e.takeCut.bind(e);
  e.takeCut = function (ev, source) {
    if (source && source !== e && !canHarm(source, e, e.world?.rules)) return null;
    return cut(ev, source);
  };
  const hurt = e.damage.bind(e);
  e.damage = function (amount, point, source, kind) {
    if (source && source !== e && !canHarm(source, e, e.world?.rules)) return false;
    return hurt(amount, point, source, kind);
  };
}

/* ══════════════════════════════════════════════════════════════════════════ */
/*  2. THE PACK                                                               */
/* ══════════════════════════════════════════════════════════════════════════ */

/**
 * A `world.props` entry, in the shape `RiderPack` and `FlightPack` already use.
 *
 * It adopts on a scan of `world.enemies` rather than at a spawn call site, for
 * the reason `Riders.js` gives: there are several doors a body can come into
 * the world through, and a pack that hooked one of them would miss the rest.
 * `capsules()` returns nothing so the blade solver is never offered a contact
 * on the pack itself — the companion is already in the target list on its own
 * account.
 */
export class CompanionPack {
  constructor(world) {
    this.world = world;
    this.id = 'companions';
    this.dead = false;
    this.grippable = false;
    this.kind = 'companions';
    this.toughness = Infinity;
    this.hp = Infinity;
    this.seen = new WeakSet();
    this.list = [];
    /**
     * THE STUB BODY, AND IT IS NOT OPTIONAL. `World._resolveBlades` walks
     * `this.props` and reads `pr.body.position` BEFORE it asks for capsules,
     * so a pack without one throws on the first frame a blade is out. Copied
     * from `RiderPack`, which pays for the same contract for the same reason —
     * a pack is a tick, not an object in the world, and this is what says so.
     */
    this.body = {
      position: new THREE.Vector3(), quaternion: new THREE.Quaternion(),
      velocity: new THREE.Vector3(), angularVelocity: new THREE.Vector3(),
      boundingRadius: 0, mass: 0, invMass: 0, static: true,
      applyImpulse() {}, wake() {},
    };
    this.mesh = null;
  }

  /* Nothing is offered to the blade solver: the companion is already in the
   * target list on its own account, as an Enemy. */
  capsules(out = []) { out.length = 0; return out; }
  cut() { return []; }
  shatter() {}
  damage() { return false; }

  /** Take a body into the pack: it belongs to `owner` from now on. */
  adopt(e, owner, opts = {}) {
    if (!e || this.seen.has(e)) return e;
    this.seen.add(e);
    e._cmpOwner = owner;
    e._cmpSide = opts.side ?? 1;
    e._cmpLeash = opts.leash ?? LEASH;
    e.companion = true;
    installCompanionAim(e);
    installCompanionMove(e);
    installCompanionHide(e);
    this.list.push(e);
    return e;
  }

  /** Give it a body to take, or clear the order. */
  bid(e, target) { if (e) e._cmpBidden = target || null; }

  update() {
    for (let i = this.list.length - 1; i >= 0; i--) {
      const e = this.list[i];
      if (!e || e.dead || e.disposed) { this.list.splice(i, 1); continue; }
      /* A BID ON A BODY THAT IS GONE IS NOT AN ORDER ANY MORE. Cleared here
       * rather than in the aim wrap so the wrap stays a pure reader. */
      if (e._cmpBidden && (e._cmpBidden.dead || e._cmpBidden.disposed)) e._cmpBidden = null;
      /**
       * AND THE CLOCK KEEPS RUNNING ON AN ANIMAL WITH NOTHING TO FIGHT.
       *
       * `Enemy._brain` returns at `if (!target)` before `_meleeBrain`, so a
       * creature whose target has just died — or walked out of the leash —
       * never reaches `_beastBrain` and never reaches `_windTick`. Neither one
       * is wrong for a wild acklay, which has a player in front of it from the
       * moment it spawns to the moment it dies. A companion is the first body
       * in the game that is a beast AND is routinely idle, and it is the only
       * one that can be caught by this.
       *
       * What it looks like on the field: the animal stops mid-attack in the
       * pose it stopped in and holds it until something else wanders into
       * range. Measured on the kill test — frozen in `lunge` for five seconds
       * at a time, and a `winded` window of 2.4 s that ran for twelve.
       *
       * `stateTime` is advanced unconditionally in `Enemy.update`, so the
       * clock is already correct; this only reads it and lets the state end.
       * The two lengths come from the two tables that own them rather than
       * from numbers written here.
       */
      if (!e.target || e.target.dead) {
        const st = e.stateTime || 0;
        if (e.state === 'winded') { if (st > WIND_OPEN) e.state = 'approach'; }
        else {
          const M = BEAST_MOVES[e.state];
          if (M && st >= M.done) { e.state = 'approach'; e._swiped = false; e.swingAt = null; }
        }
      }
    }
  }

  dispose() { this.list.length = 0; }
}

/** Hang a pack on the world, once. */
export function attachCompanions(world) {
  if (!world || world._companions) return world?._companions || null;
  const pack = new CompanionPack(world);
  world._companions = pack;
  (world.props ||= []).push(pack);
  return pack;
}

/**
 * Put one on the field beside its owner.
 *
 * `spawnEnemy` is the one door every other body comes through, so a companion
 * is built, rigged, LOD'd, cohorted and physically real by exactly the same
 * path as everything else — and then `team` and the two wraps are the whole of
 * what makes it yours.
 */
export function fieldCompanion(world, owner, kind = 'massiff', opts = {}) {
  if (!world?.spawnEnemy || !owner?.position) return null;
  if (!ARCHETYPES[kind]) return null;
  const pack = attachCompanions(world);
  const yaw = owner.aimDir ? Math.atan2(owner.aimDir.x, owner.aimDir.z) : 0;
  _v2.set(
    owner.position.x - Math.sin(yaw) * HEEL.back,
    owner.position.y,
    owner.position.z - Math.cos(yaw) * HEEL.back,
  );
  _v2.y = world.terrain?.height ? world.terrain.height(_v2.x, _v2.z) : owner.position.y;
  const e = world.spawnEnemy(kind, _v2);
  if (!e) return null;
  /* THE TEAM IS THE WHOLE OF "IT IS ON YOUR SIDE" — Command.js's own header
   * says so: the only things that make a body yours are a team number and the
   * fields hung off it. Set before the pack adopts, so the first frame's
   * targeting already reads it. */
  e.team = owner.team ?? 0;
  /**
   * AND IT TAKES THE SAME FRIENDLY-FIRE DISCOUNT EVERY OTHER ALLY TAKES, which
   * is not a nicety — it is the difference between a companion and a target.
   *
   * `canHarm` lets a blade through onto your own side whenever the world's
   * `friendlyFire` rule is on, and `installTeamDamage` is the wrapper that
   * then scales what lands: every trooper gets it inside `enlistBody`, and a
   * companion is not enlisted, so nothing was scaling anything. Measured
   * without it, on the kill test: the player cut his own animal to -311 of 210
   * hp in one minute of ordinary walking.
   *
   * `TEAM_DAMAGE_DEFAULT` and not a private number, because the player has a
   * slider for this and asked for it by name; one table, one owner.
   */
  installTeamDamage(e, world.settings?.teamDamage ?? TEAM_DAMAGE_DEFAULT);
  return pack.adopt(e, owner, opts);
}
