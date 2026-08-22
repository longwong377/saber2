/**
 * BATTLEFRONT BORZ — the first enemy that fights from above your blade.
 *
 * ── WHY THIS FILE EXISTS ──────────────────────────────────────────────────
 *
 * The V5 giants note ends with a sentence nobody had answered: *"Look up other
 * vehicles/mechs/monsters that we could be missing."* The audit that answered
 * it is `BACKLOG.md` §4.5. Most of what it found was already in the game — the
 * Reek, the Nexu, the BX commando droid and the MagnaGuard are all on the
 * shipped roster — and it found exactly one structural hole:
 *
 *   THIRTY-FIVE ARCHETYPES AND NOT ONE OF THEM FIGHTS FROM THE AIR.
 *
 * Not for want of a hover. `Enemy._move` has had a `float` branch since the
 * training remote, and two bodies use it — the remote at 1.55 m and the Jet
 * Trooper at 1.35. Measured off a driven `Player`, a standing overhead swing
 * puts the blade's TIP at **3.047 m** and its hilt at 1.953 m, so both of those
 * hover comfortably inside a swing. What the game had was two bodies standing
 * on air, and Command.js's own note says so in as many words: *"this game has
 * no flying brain and inventing one for a trooper would be a different
 * project."*
 *
 * This is that project, and the Geonosian warrior is what it is for. It is the
 * arena's own army — the Petranaki plates the Colosseum was built off are full
 * of them — and it is the one canon body of the era whose whole character is
 * that it is not standing on the ground.
 *
 * ── THE ENGINEERING QUESTION, WHICH IS NOT THE MODEL ──────────────────────
 *
 * A body the blade cannot reach is not an enemy, it is weather. Everything in
 * this file exists to make an altitude answerable, and there are three answers
 * rather than one, because a single one would be a lock:
 *
 *   THE STOOP    the flyer cannot stay up. Its cycle is `HOLD_HIGH` seconds at
 *                a cruise the blade cannot touch, a dive, `HOLD_LOW` seconds
 *                inside a swing, and a laboured climb back — and the dive is
 *                three times faster than the climb, so the low half of it is
 *                also the half where it is closing on you. `tools/checks/
 *                flight.mjs` measures the share of a real fight the body spends
 *                inside `BLADE_REACH` off a DRIVEN body rather than off these
 *                constants.
 *   THE WING     `wing` is a bone role (src/game/Rig.js) and this body is the
 *                only thing in the game that carries it. A Geonosian flies on
 *                two: sever either root and it is on the ground for the rest of
 *                the fight, which is the answer this archetype declares as its
 *                own. The wing roots are inside a standing swing at the bottom
 *                of the stoop and outside it at the top, which is the whole
 *                shape of the fight.
 *   THE FORCE    it weighs 68 kg. Every anti-air power the game already has —
 *                grip, pull, push, stasis — works on it, and a body that has
 *                been held is FELLED: `FELL_FOR` seconds on the ground before
 *                it can climb again. That is the one place a Force verb in this
 *                game does something no blade can do.
 *
 * ── WHY IT IS AN INSTANCE WRAPPER AND NOT A LINE IN Enemy.js ──────────────
 *
 * `Command.installCommand` states the seam and the reason: *"the only way to
 * get there without editing Enemy.js is to wrap `_move` on the instance"*, the
 * same seam `Waves.cleavingThrow` and `Order.liveMod` use. The altitude has to
 * be decided between the brain and the integration, which is exactly where a
 * wrapper sits, and `_move` reads `this.A.float` — so the body is given its own
 * copy of its archetype first, which is not a new idea either: `applyModifier`
 * has done `e.A = { ...base }` for every elite in the game since it was
 * written.
 *
 * `FlightPack` is `RiderPack`'s shape for the same reason Riders.js gives it —
 * a prop's `update` runs after every enemy has moved, so riding in `world.props`
 * buys a per-frame tick without a line of World.js changing. Here it is used
 * only to ADOPT: one pass over `world.enemies` looking for bodies that declare
 * a flight plan and have not been wrapped yet.
 */

import * as THREE from 'three';
import { ARCHETYPES } from './Enemy.js';
import { buildGeonosian } from './Bodies.js';
import { TOUGHNESS } from './Combat.js';
import { BOLT_COLORS } from './Bolts.js';
import { clamp } from '../engine/MathUtil.js';

/**
 * A STANDING PLAYER'S BLADE, in metres off the floor, and it is MEASURED.
 *
 * 3.047 m is the highest the tip of a lit blade gets during an overhead swing,
 * off a real `Player` driven through `Player.update` on flat ground with the
 * shipped `attackOver` binding held. The hilt tops out at 1.953 m and a thrust,
 * a stab and a spin all top out at 2.20–2.23 m, so the overhead is the number
 * that matters and it is the most generous one the player has.
 *
 * `tools/checks/flight.mjs` re-measures it every run rather than trusting this
 * line: it is here so the altitudes below can be read against something, and
 * the check is what stops it from becoming a hand-maintained twin of a driven
 * body (HANDOFF §2.3).
 */
export const BLADE_REACH = 3.047;

/**
 * WHAT THE REFERENCE STATES AND WHAT WAS BUILT — the same contract as
 * `GIANT_CANON`, and in the source file rather than in the check for the same
 * reason: a table of reference dimensions kept in a test is a table the builder
 * cannot be measured against by anything else.
 *
 * `h` is metres at 1:1 exactly as the reference gives it, `built` is the
 * divisor, and `null` means the reference does not state that dimension and
 * nothing is asserted about it.
 */
export const FLIGHT_CANON = {
  geonosian: {
    name: 'Geonosian warrior', side: 'separatist',
    /* 1.75 m is the Geonosian average height. It is the ONE dimension the
     * reference states as a number — no wingspan is given anywhere, and a
     * check that asserted one would be asserting something invented, so `w`
     * and `l` are null and the suite says nothing about them. */
    h: 1.75, w: null, l: null, built: 1,
    /* HOW IT IS MEANT TO DIE, stated so it can be held against the game rather
     * than against a comment — the same three fields `GIANT_CANON.kill` uses.
     * `chains` is how many wing chains the rig has, `lose` how many it takes,
     * and `says` the words the databank page has to contain, because an answer
     * the player is never told is not an answer. */
    kill: { chains: 2, lose: 1, at: 'wings', says: ['wing'] },
    note: '1.75 m; winged warrior caste, sonic blaster, Confederate at Geonosis',
  },
};

/* ══════════════════════════════════════════════════════════════════════ */
/*  The flight plan                                                       */
/* ══════════════════════════════════════════════════════════════════════ */

/**
 * THE CYCLE, AND EVERY NUMBER IN IT IS A DECISION ABOUT REACH.
 *
 *   CRUISE   5.60 m of altitude at the FEET, so the lowest thing on the body
 *            is 2.55 m clear of the tip of an overhead swing. Out of reach and
 *            unambiguously so: an altitude that were merely awkward would read
 *            as the blade missing rather than as the body being up there.
 *   STOOP    1.30 m at the feet. The chest sits at about 2.5 m and the wing
 *            roots just under 2.7 — inside a standing swing with room to spare,
 *            which is the point: the window has to be winnable by a player who
 *            is looking up, not only by one who is jumping.
 *   DIVE/CLIMB  7.5 m/s down against 3.2 up. The asymmetry is the fight. A
 *            stoop arrives in about 0.57 s and the climb out takes 1.34, so
 *            most of the transition is ALSO reachable and the window is much
 *            wider than `HOLD_LOW` alone. It is also what a wing does: falling
 *            is free and lifting is not.
 *   HOLD_*   4.0 s up, 2.2 s down. The measured share of a fight inside blade
 *            reach comes out well above the third that ratio implies, because
 *            of the climb — `flight.mjs` reports the number, this file does
 *            not claim it.
 *
 * `band` is the engagement band each half of the cycle asks `_rangedBrain` for.
 * A flyer that stayed at nineteen metres while it dived would dive to a height
 * nobody could reach across the ground between; the stoop is a PASS, so it
 * closes to knife range while it is down there and opens again on the climb.
 */
export const FLIGHT = {
  CRUISE: 5.60,
  STOOP: 1.30,
  DIVE: 7.5,
  CLIMB: 3.2,
  HOLD_HIGH: 4.0,
  HOLD_LOW: 3.2,
  /**
   * WHERE IT FIGHTS FROM, PER HALF OF THE CYCLE — and the low band is 1.6 to
   * 3.4 because it was 2.2 to 7 and that made the stoop a lie.
   *
   * `_rangedBrain` holds the band's FAR edge as happily as its near one, so a
   * stoop whose band opened at 7 m dropped to head height and then sat seven
   * metres away drifting outward as the player walked in. Measured with a real
   * Player advancing at it for 40 s: the gap never closed below 6.06 m and the
   * blade got zero swings. The altitude was right and the fight was not there.
   *
   * 3.0 m is inside the blade's own arc and 1.1 is close enough that the body
   * has to break away rather than hover, which is what makes the low half a
   * PASS instead of a lower hover — the thing the whole cycle is for. Both
   * edges were pulled in once a real Player was driven at it: at [1.6, 3.4] the
   * blade's nearest approach over four swings was 82 cm of clear air, because
   * the near edge is where the body settles and 1.6 m of separation plus 1.2 m
   * of height is 2.0 m from a chest to a chest — further than an arm and a
   * blade.
   */
  bandHigh: [9, 20],
  bandLow: [1.1, 3.0],
  /**
   * SECONDS ON THE GROUND AFTER THE FORCE HAS HAD IT.
   *
   * A grip, a pull, a push or a stasis field all end with the body somewhere it
   * did not choose, and `_move`'s float branch would otherwise haul it straight
   * back to cruise inside half a second — so the Force would look like it had
   * worked and would have bought nothing. Six seconds is long enough to finish
   * one, which is what an anti-air power is FOR.
   */
  FELL_FOR: 6.0,
  /** Wingbeats a second, and how far the wing swings. Cosmetic; measured anyway. */
  BEAT_HZ: 7.5,
  BEAT_ARC: 0.62,
};

/* ══════════════════════════════════════════════════════════════════════ */
/*  The roster                                                            */
/* ══════════════════════════════════════════════════════════════════════ */

/**
 * THE GEONOSIAN WARRIOR.
 *
 * Registered from here and assigned into `ARCHETYPES` by src/game/Levels.js,
 * which is already the module that owns "what bodies exist" for everything not
 * declared in Enemy.js — the menagerie and the seven Command rungs both arrive
 * that way.
 *
 * ── HOW IT IS PRICED, AGAINST BODIES THAT ALREADY EXIST ─────────────────
 *
 * `threat: 5`. The comparisons are the Jet Trooper at 4 (54 hp, 6.2 m/s, and
 * the only other body in the game that leaves the ground) and the BX commando
 * at 6 (120 hp and a blade). This is 66 hp and a light gun, so on its own
 * numbers it is under both — and it is priced ABOVE the jet trooper because
 * for most of its cycle it cannot be answered with the weapon the player is
 * holding, which is worth more than eleven hit points.
 *
 * It is NOT `big`. That is deliberate and it is the difference between a
 * set-piece and a swarm: `heavyLimit` allows one big body plus one per ten
 * waves, and the whole character of Geonosians in the reference is that there
 * are a lot of them. At 5 a wave budget buys them in fives.
 *
 * `unlockAt: 2` rather than 1. A player meeting one on the first wave they
 * ever play meets a body they cannot reach before they have found the overhead
 * swing; one wave of ordinary ground fighting first is the whole of the
 * argument, and it is the same reason the droideka is gated to 6.
 */
export const GEONOSIAN_UNITS = {
  geonosian: {
    label: 'Geonosian Warrior',
    build: (o) => buildGeonosian(o),
    /* 0.928, and it is a MEASUREMENT rather than a taste: the body's own
     * transformed-vertex box comes out 1.749 m tall at this scale against the
     * reference's 1.75 m. See FLIGHT_CANON and `flight.mjs`. */
    scale: 0.928,
    /* 66 hp and 68 kg — the lightest fighting body on the roster after the B1,
     * and it has to be. `guardFor` gives anything under 300 kg zero turned
     * passes, so this dies to one clean pass the moment you can touch it: the
     * difficulty is entirely the touching, and a health pool would be the
     * wrong place to put it. */
    hp: 66, mass: 68,
    speed: 5.4, toughness: TOUGHNESS.plastoid,
    ranged: true, weapon: 'sonic',
    /**
     * THE SONIC BLASTER, AND IT IS NOT A RIFLE'S CADENCE.
     *
     * Two rounds 0.34 s apart on a 1.5 s cycle. Every other two-round shooter
     * in the game fires its pair inside two tenths — the jet trooper at 0.16,
     * the officer at 0.12 — so this reads as two separate reports rather than
     * as a double tap, which is what a weapon that throws a ball of sound
     * should sound like. Slow, hard-hitting singles from a body you cannot
     * answer is also the only cadence that suits the altitude: a stream from up
     * there would be a turret.
     */
    fireRate: 1.5, burst: 2, burstGap: 0.34, spread: 0.055, damage: 13,
    preferred: FLIGHT.bandHigh, boltColor: BOLT_COLORS.blue,
    score: 520, threat: 5, hipHeight: 0.98, unlockAt: 2,
    /**
     * `float` IS THE FLOOR OF THE CYCLE AND NOT THE CRUISE, deliberately.
     *
     * This is the altitude a body holds when nothing has installed a flight
     * plan on it — a sandbox on a level with no `attachFlight`, a fixture in a
     * check, a spawn path nobody has thought of yet. The failure mode of the
     * OTHER choice is a Geonosian permanently at 5.6 m that no player can ever
     * touch, which is the exact defect this whole file exists to avoid, so the
     * degraded case is a low-hovering enemy and never weather.
     */
    float: FLIGHT.STOOP,
    /** The plan itself. Its presence is what `FlightPack` adopts on. */
    flight: 'geonosian',
  },
};

/* ══════════════════════════════════════════════════════════════════════ */
/*  Wings                                                                 */
/* ══════════════════════════════════════════════════════════════════════ */

/** The wing chains this body has: the roots, and the fan on each. */
export function wingChains(rig) {
  const out = [];
  for (const b of rig?.list ?? []) {
    if (b.role === 'wing' && b.parent?.role !== 'wing') out.push(b);
  }
  return out;
}

/**
 * THE LEAST SPAN THIS BODY IS BEATING WITH, and it flies as well as its worse
 * wing.
 *
 * ── IT READS `cutT` AND NOT `severed`, WHICH IS THE WHOLE OF THE BUG THIS
 *    FUNCTION WAS WRITTEN WITH ─────────────────────────────────────────────
 *
 * The first version answered 0 as soon as a wing ROOT was `severed`, which is a
 * state a blade cannot produce: `Actor.cut` SHORTENS the bone it meets
 * (`bone.cutT *= t`) and severs only the SUBTREE below it, so a wing cut clean
 * off at the shoulder leaves `wingL` unsevered with `cutT` near zero.
 * `severance.mjs`'s own note says it in as many words — "a LEAF bone is
 * SHORTENED rather than severed" — and `tools/checks/flight.mjs` caught it on
 * the first run by cutting a real wing off a real body and finding it still
 * flying at 0.8 lift.
 *
 * So the measure is SPAN: how much bone is still attached along the chain,
 * against how much it was built with. It is graded on the way down, which is
 * the feedback a cut that did not quite land ought to give — a body with a torn
 * fan cruises lower and is easier to reach next time — and below `WING_MIN` it
 * is nothing at all, because an insect does not fly on one wing and that is the
 * answer this archetype declares as its own (`FLIGHT_CANON.geonosian.kill`).
 *
 * `isSevered` walks the parent chain rather than reading the flag, for the same
 * reason `Enemy.takeCut` does: a bone whose ancestor is gone is gone.
 */
const WING_MIN = 0.35;
export function wingLift(e) {
  const rig = e?.rig;
  if (!rig) return 1;
  const roots = wingChains(rig);
  if (!roots.length) return 1;
  const gone = (name) => (e.actor ? e.actor.isSevered(name) : !!rig.get(name)?.severed);
  let worst = 1;
  for (const r of roots) {
    let full = 0, left = 0;
    const walk = (b) => {
      full += b.length;
      if (!gone(b.name)) left += b.length * (b.cutT ?? 1);
      for (const c of b.children) if (c.role === 'wing') walk(c);
    };
    walk(r);
    const span = full > 0 ? left / full : 1;
    if (span < worst) worst = span;
  }
  return worst < WING_MIN ? 0 : clamp(worst, 0, 1);
}

/**
 * Beat the wings. Written straight onto the bone quaternions from the wrapped
 * `_move`, which runs BEFORE `_pose` — `BipedAnimator` knows the humanoid's
 * fifteen bone names and touches none of these, so nothing overwrites them.
 *
 * The delta is applied on the PARENT side (`delta × rest`) so the axis is the
 * chest's forward, which is what makes a flap a flap: applied on the bone side
 * it is a twist about the spar and the tip barely moves. Measured either way
 * before this line was written.
 */
const _beat = new THREE.Quaternion();
const _axis = new THREE.Vector3(0, 0, 1);
export function beatWings(e, dt, effort) {
  const rig = e.rig;
  if (!rig) return;
  e._wingPhase = (e._wingPhase ?? 0) + dt * FLIGHT.BEAT_HZ * (0.45 + effort) * Math.PI * 2;
  const swing = Math.sin(e._wingPhase) * FLIGHT.BEAT_ARC * (0.25 + effort * 0.75);
  for (const b of rig.list) {
    if (b.role !== 'wing' || b.severed) continue;
    const side = b.name.endsWith('L') ? 1 : -1;
    const fan = b.parent?.role === 'wing' ? 1.5 : 1;
    _beat.setFromAxisAngle(_axis, -side * swing * fan);
    b.obj.quaternion.copy(_beat).multiply(b.restQuat);
  }
}

/* ══════════════════════════════════════════════════════════════════════ */
/*  The state machine                                                     */
/* ══════════════════════════════════════════════════════════════════════ */

/**
 * One frame of flight, run from inside the `_move` wrapper.
 *
 * It writes two fields on the body's OWN copy of its archetype — `float`, which
 * `Enemy._move` integrates toward, and `preferred`, which `_rangedBrain` reads
 * next frame — and nothing else. Everything the game already does with a
 * hovering body (the jet lean, the engine plume, the bob, the wall slide) goes
 * on happening, because this decides a number and does not reimplement a move.
 *
 * The commanded altitude is RATE-LIMITED here rather than left to `_move`'s own
 * damp. That damp has a time constant near a fifth of a second, which would
 * teleport the body 4.3 m vertically between two frames of a stoop; a climb
 * rate is a property of a wing and this is the file that owns wings.
 */
export function flightStep(e, dt) {
  const A = e.A;
  const F = FLIGHT;
  const lift = wingLift(e);

  // the Force has had it: down, and it stays down
  if (e.gripped || e.liftTarget || e.stasisHeld) e._felled = F.FELL_FOR;
  else if (e._felled > 0) e._felled -= dt;

  const grounded = lift <= 0 || e._felled > 0 || e.toppled || e.dead;

  let want;
  if (grounded) {
    want = 0;
    e._flightState = lift <= 0 ? 'downed' : 'felled';
    e._flightT = 0;
  } else {
    e._flightT = (e._flightT ?? 0) + dt;
    const hold = e._flightState === 'stoop' ? F.HOLD_LOW : F.HOLD_HIGH;
    /* The cycle only advances once the body has ARRIVED. Timing the hold from
     * the moment the order changed would spend most of a short hold in transit,
     * and the low half is the half the player is owed. */
    const at = Math.abs((e._flightCmd ?? 0) - (e._flightState === 'stoop' ? F.STOOP : F.CRUISE * lift)) < 0.15;
    if (at && e._flightT >= hold) {
      e._flightState = e._flightState === 'stoop' ? 'cruise' : 'stoop';
      e._flightT = 0;
    }
    want = e._flightState === 'stoop' ? F.STOOP : F.CRUISE * lift;
  }

  const cmd = e._flightCmd ?? A.float ?? 0;
  const rate = want < cmd ? F.DIVE : F.CLIMB;
  const next = cmd + clamp(want - cmd, -rate * dt, rate * dt);
  e._flightCmd = next;
  A.float = next;
  A.preferred = (grounded || e._flightState === 'stoop') ? F.bandLow : F.bandHigh;

  /* Effort drives the wingbeat: hard on the climb, idling on the dive, folded
   * on the ground. It is read off what the body is DOING rather than off the
   * state name, so a body fighting a Force push beats as hard as one climbing. */
  const effort = grounded ? 0 : clamp(0.25 + (want - cmd) * 0.5, 0, 1);
  beatWings(e, dt, effort);
  return next;
}

/**
 * Give this body its own archetype and put the flight model between its brain
 * and its integration. Idempotent; returns whether it installed.
 *
 * The copy is not an optimisation, it is a correctness requirement: `ARCHETYPES`
 * entries are shared by every body of a type, so writing `A.float` on the table
 * would fly every Geonosian on the field in lockstep with the first one.
 */
export function installFlight(e) {
  if (!e || e._flight) return false;
  const A = e.A;
  if (!A || !A.flight) return false;
  const base = e._move;
  if (typeof base !== 'function') return false;
  e._flight = true;
  e.A = { ...A };
  e._flightState = 'cruise';
  e._flightT = 0;
  e._felled = 0;
  e._flightCmd = e.A.float;
  /* Variadic for the reason `installCommand`'s wrapper is: `dt` is the only
   * argument this wrapper has an opinion about, and naming the rest is taking
   * a position on a signature it does not own. */
  e._move = function (dt, ...rest) {
    if (dt > 0 && !this.dead) flightStep(this, dt);
    return base.call(this, dt, ...rest);
  };
  return true;
}

/* ══════════════════════════════════════════════════════════════════════ */
/*  The pack                                                              */
/* ══════════════════════════════════════════════════════════════════════ */

/**
 * `RiderPack`'s shape, and Riders.js's argument for it applies unchanged: a
 * prop's `update` runs after every enemy has moved, so riding in `world.props`
 * buys a per-frame tick without a line of World.js changing — and World.js has
 * more than one door a body can come through (the wave director's arrivals,
 * Command's muster, the Dojo, a rider dismounting), so adopting on a scan is
 * the only thing that catches all of them.
 *
 * `capsules()` returns nothing: the pack is not a body and the blade must never
 * be offered a contact on it.
 */
class FlightPack {
  constructor(world) {
    this.id = 'flight';
    this.world = world;
    this.dead = false;
    this.kind = 'flight';
    this.grippable = false;
    this.generation = 0;
    this.toughness = Infinity;
    this.hp = Infinity;
    this.seen = new WeakSet();
    this.body = {
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

  update(dt) {
    if (!(dt > 0)) return;
    const enemies = this.world.enemies;
    if (!enemies) return;
    for (let i = 0; i < enemies.length; i++) {
      const e = enemies[i];
      if (e.dead || !e.A || !e.A.flight) continue;
      if (this.seen.has(e)) continue;
      this.seen.add(e);
      installFlight(e);
    }
  }

  destroy() {
    if (this.dead) return;
    this.dead = true;
    const i = this.world.props.indexOf(this);
    if (i >= 0) this.world.props.splice(i, 1);
  }
}

/**
 * The world's flight pack, made on demand. A level whose pool has nothing
 * winged in it never needs to call this, and the pack's whole per-frame cost
 * with no flyers on the field is one pass over `world.enemies`.
 */
export function attachFlight(world) {
  if (!world) return null;
  if (world.flight && !world.flight.dead) return world.flight;
  const pack = new FlightPack(world);
  world.flight = pack;
  if (world.addProp) world.addProp(pack);
  else if (world.props) world.props.push(pack);
  return pack;
}

export { FlightPack };
