/**
 * BATTLEFRONT BORZ — THE MASS. Hundreds against hundreds, and why it is not
 * hundreds of `Enemy` objects.
 *
 * The player, across several sessions and in the end flatly:
 *
 *   "I still have yet to experience a single giant battle like what I've asked
 *    for… I asked for a mode with hundreds of troops vs hundreds of troops."
 *
 * They were right, and the reason is arithmetic rather than neglect. Measured
 * on this container, full `Enemy` bodies standing on a real Geonosis field:
 *
 *      26 bodies    6.4 ms      the shipped `maxAlive`
 *      66          8.2 ms      …plus a full levy
 *     120         15.0 ms
 *     200         25.5 ms
 *     320         42.8 ms      23 fps of sim headroom, before any rendering
 *
 * About 0.13 ms a body, and linear. So "hundreds vs hundreds" as real bodies is
 * not a thing the game was ever one tuning pass away from — it is a thing the
 * architecture forbids. `MAX_STRENGTH` is 24 and The Line fields ten of yours
 * against thirty-odd. The battle the player kept asking for did not exist.
 *
 * ── THE INSIGHT: A BATTLE OF HUNDREDS NEEDS HUNDREDS OF SOLDIERS AND ONLY
 *    DOZENS OF AGENTS ────────────────────────────────────────────────────
 *
 * Nobody standing 140 m away needs a behaviour tree, a ragdoll, a cloth
 * simulation, a physics capsule or a skeleton solve. They need to be THERE:
 * standing in a line, walking forward, firing, and falling over when shot. Four
 * facts and a matrix.
 *
 * `src/game/Cohorts.js` already draws exactly that. It is the LOD-3 rung — past
 * the distance the ink prepass reaches, every body of one kind becomes an
 * instance in one shared mesh, "so the cost stops depending on how many of them
 * there are". It was built to make forty distant bodies cheap. It turns out to
 * take anything with a position, a facing and a gait phase.
 *
 * Measured, the same field, 240 men who are NOT `Enemy` objects joined to a
 * cohort and moved every frame:
 *
 *     240 instanced men + the whole world update    6.05 ms, 7 draw bins
 *
 * Against ~31 ms and several hundred draw calls for 240 real ones. That is the
 * whole design, and it was proved before a line of this file was written.
 *
 * ── SO THERE ARE THREE TIERS AND THE PLAYER SEES ONE BATTLE ───────────────
 *
 *   REAL BODIES     `Enemy`. Full AI, physics, ragdoll, damage, dismemberment.
 *                   Everything within `PROMOTE` metres of the player. This is
 *                   the game you actually play and nothing about it changes.
 *   RANKS           this file. A block of men simulated as ONE entity — an
 *                   anchor, a facing, a strength, a morale, and a pooled rate
 *                   of REAL bolts — drawn as cohort instances. About one
 *                   agent's worth of work for twenty men.
 *   THE FAR FIELD   ranks past `SILENT` metres draw and march and do not
 *                   shoot. At that range their fire could not be aimed at
 *                   anything the player can see, and a bolt nobody can dodge
 *                   is a bolt nobody should be paying for.
 *
 * ── WHAT MAKES IT ONE BATTLE RATHER THAN TWO SYSTEMS ─────────────────────
 *
 * THE BOLTS ARE REAL. A rank fires through `BoltPool.fire`, the same door
 * `Enemy._fire` uses, with a real team and real damage. So a rank two hundred
 * metres away can kill you, you can deflect its fire back, and the wall of
 * tracer that makes a battle look like a battle is the same object the whole
 * game already understands. Nothing here invents a second kind of shot.
 *
 * THE CASUALTIES ARE REAL. Rank men are swept against live hostile bolts every
 * frame — coarse against the rank's own sphere first, then per man — so
 * shooting into a distant line thins it, and the line thins visibly because a
 * dead man's instance is released and the block re-forms without him.
 *
 * AND THE FRONT MOVES. Two facing masses push against each other on one axis;
 * whichever has more standing men advances and the other gives ground. That is
 * the one variable that makes a big battle READABLE — you can look up from what
 * you are doing and tell whether the war is going your way, which is the thing
 * a field of scattered skirmishers can never say.
 *
 * ── WHAT THIS FILE DELIBERATELY DOES NOT DO ──────────────────────────────
 *
 * PROMOTION IS NOT HERE YET. The intended end state is that a rank you walk
 * toward dissolves into real `Enemy` bodies before you reach it, and folds back
 * into a rank behind you. The seam is the hard part and it deserves its own
 * pass with its own checks; until it exists, `PROMOTE` is enforced the blunt
 * way — ranks are never planted inside it, so the near fight is the real
 * bodies' and the far battle is the mass's, and the two do not overlap.
 * Writing that down is the point: a reader must not think the seam is solved.
 */

import * as THREE from 'three';
import { ARCHETYPES } from './Enemy.js';

/* ══════════════════════════════════════════════════════════════════════ */
/*  The dial                                                              */
/* ══════════════════════════════════════════════════════════════════════ */

/** Men in one rank. Twenty is four ranks deep by five across at `SPACING`. */
export const RANK_MEN = 20;
export const RANK_COLS = 5;
/** Metres between men, and between rows. A real firing line is not shoulder to
 *  shoulder — at 2 m a twenty-man block is 8 m of frontage and reads as a unit
 *  at two hundred metres, which is the range it is meant to be read at. */
export const SPACING = 2.0;

/**
 * HOW CLOSE A RANK IS EVER PLANTED TO THE PLAYER.
 *
 * The blunt enforcement of the seam this file does not yet solve. Inside this
 * radius the fight is real bodies with real physics; outside it, mass. 90 m is
 * past `Enemy`'s LOD-2 cut (62 m) and comfortably inside its LOD-3 cohort band
 * (137.8 m), so a rank is always drawn by the rung it was designed for and a
 * real body near the player is always drawn by its own.
 */
export const PROMOTE = 90;

/**
 * Past this from the PLAYER, a rank marches and draws and does not fire.
 *
 * It was 240 for one build and that was too tight to be right: a battle laid
 * out with the player 100 m behind their own line and a 150 m no-man's-land
 * puts the ENEMY line 250 m away, so the far half of the battle stood there in
 * silence and only your own men shot. Measured, 8 ranks firing and 8 mute.
 * A battle where one side does not fire back is not a battle.
 *
 * 400 covers the whole of a laid battle with room over, and `REACH` is still
 * the thing that decides whether a rank has anything to shoot AT — the two
 * refusals are different questions and both are wanted.
 */
export const SILENT = 400;

/** Rounds a rank puts out per standing man per second. */
export const RATE = 0.28;

/** How far a rank's fire reaches. Beyond this it holds. */
export const REACH = 210;

/** Metres a second a rank walks when it is winning the push. */
export const MARCH = 1.15;

/**
 * HOW FAR APART TWO LINES ACTUALLY FIGHT, and this number was the whole of the
 * first version's failure.
 *
 * The battle was laid out with 150 m of no-man's-land because that is what a
 * battlefield looks like in a photograph. Measured on real Geonosis ground:
 * **448 rounds fired and 0 of them got within 12 m of the enemy line.** Not a
 * targeting bug — the ground. A levelled rifle fired from 1.25 m over 150 m of
 * rock and ridge hits the rock, every time, and the bolt pool correctly ate
 * every round.
 *
 * So the lines CLOSE. They start apart, walk toward each other until they are
 * this far apart, and then stand and fight — which is both the thing that makes
 * the rounds arrive and, as it happens, the thing that makes a battle look like
 * a battle rather than two static hedges. The approach is the opening beat the
 * mode never had.
 *
 * 55 m is chosen against the game's own scale rather than a photograph's: every
 * archetype in `ARCHETYPES` has a `preferred` band inside 30 m, so this is
 * already generous, and it is far enough that the far line still reads as a
 * line rather than as individuals.
 */
export const STAND_OFF = 55;

/** How wide a rank's fire scatters, in radians. Wider than a trooper's own
 *  cone on purpose: this is volume, not marksmanship, and a mass that grouped
 *  like a sniper would delete the player from four hundred metres. */
export const CONE = 0.075;

/** A rank at or under this fraction of its strength breaks and falls back. */
export const BREAK_AT = 0.35;

/** How near a swept bolt has to pass a man to fell him. See `_sweep`. */
export const HIT = 0.9;

/** Where a rank's rifles sit, and where they aim. See `_fire`. */
export const MUZZLE = 1.25;

/* ══════════════════════════════════════════════════════════════════════ */
/*  One rank                                                              */
/* ══════════════════════════════════════════════════════════════════════ */

const _v = new THREE.Vector3();
const _w = new THREE.Vector3();
const _s = new THREE.Vector3();

/**
 * Does the segment `a → b` pass within `r` of `p`, ignoring height?
 *
 * Flat, and that is deliberate rather than lazy: these men have no capsules and
 * their `y` is whatever the terrain was under the anchor, while a bolt is
 * flying at chest height over ground that dips. A 3-D test would miss a whole
 * rank standing in a shallow depression, which is a thing Geonosis is made of.
 */
function segNear(a, b, p, r) {
  const abx = b.x - a.x, abz = b.z - a.z;
  const apx = p.x - a.x, apz = p.z - a.z;
  const len = abx * abx + abz * abz;
  let t = len > 1e-9 ? (apx * abx + apz * abz) / len : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const dx = apx - abx * t, dz = apz - abz * t;
  return dx * dx + dz * dz <= r * r;
}

/**
 * A block of men that is one thing.
 *
 * `men` is a flat array of plain objects — position, facing, gait phase, alive.
 * They are what the cohort draws and what bolts are swept against, and they are
 * deliberately NOT class instances: this is the array that gets long, and a
 * literal is the cheapest thing to make three hundred of.
 */
export class Rank {
  constructor(opts) {
    this.type = opts.type;
    this.team = opts.team;
    /** Which way the block faces and marches, as a unit vector on the ground. */
    this.dir = opts.dir.clone().setY(0).normalize();
    this.anchor = opts.anchor.clone();
    this.n = opts.men ?? RANK_MEN;
    this.alive = this.n;
    this.broken = false;
    this.fireT = Math.random() * 0.5;
    this.men = [];
    const A = ARCHETYPES[this.type];
    this.damage = (A?.damage ?? 9) * 0.6;   // a rank's round is a lighter round
    this.color = A?.boltColor ?? 0xff4d3d;
    for (let i = 0; i < this.n; i++) {
      this.men.push({
        alive: true, slot: i,
        position: new THREE.Vector3(),
        facing: 0,
        /* The gait phase is what makes a block of instances read as marching
         * men rather than a sheet of copies. Spread across the cycle by index,
         * exactly as `Enemy._animPhase` spreads a crowd. */
        animator: { moving: true, phase: (i * 0.37) % 1 },
      });
    }
    this.place();
  }

  /** Where man `i` stands, relative to the anchor, in the block's own frame. */
  _offset(i, out) {
    const col = i % RANK_COLS, row = (i / RANK_COLS) | 0;
    return out.set((col - (RANK_COLS - 1) / 2) * SPACING, 0, -row * SPACING);
  }

  /** Re-seat every living man on the anchor. One rotate per man, no allocation. */
  place(terrain = null) {
    const c = Math.cos(this.facingAngle), s = Math.sin(this.facingAngle);
    for (const m of this.men) {
      if (!m.alive) continue;
      this._offset(m.slot, _v);
      const x = this.anchor.x + _v.x * c + _v.z * s;
      const z = this.anchor.z - _v.x * s + _v.z * c;
      m.position.set(x, terrain ? terrain.height(x, z) : this.anchor.y, z);
      m.facing = this.facingAngle;
    }
  }

  /** The block's heading as an angle, derived from `dir` so there is one truth. */
  get facingAngle() { return Math.atan2(this.dir.x, this.dir.z); }

  /** Its rough extent, for the coarse half of the bolt sweep. */
  get radius() { return SPACING * Math.max(RANK_COLS, this.n / RANK_COLS) * 0.75 + 2; }

  /** Fraction of the block still standing. */
  get strength() { return this.n ? this.alive / this.n : 0; }

  /** Kill man `m`. Returns true if he was standing. */
  fell(m) {
    if (!m.alive) return false;
    m.alive = false;
    this.alive--;
    if (!this.broken && this.strength <= BREAK_AT) this.broken = true;
    return true;
  }
}

/* ══════════════════════════════════════════════════════════════════════ */
/*  The field                                                             */
/* ══════════════════════════════════════════════════════════════════════ */

/**
 * Every rank on the ground, and the one update that drives them.
 *
 * Holds a DONOR body per unit type — one real `Enemy`, built once, whose rig
 * the cohort bakes its merged skin from. `CohortField._cohortFor` needs a rig
 * exactly once per key; after that a join only wants a position, a facing and a
 * gait phase, which is why the men can be literals. The donor is parked far
 * below the ground and never updated: it is a mould, not a soldier.
 */
export class MassField {
  constructor(world) {
    this.world = world;
    this.ranks = [];
    this.donors = new Map();
    /** Two sides pushing on one axis. `axis` is the direction the player's
     *  side advances; the enemy advances along its negation. */
    this.axis = new THREE.Vector3(0, 0, 1);
    this.origin = new THREE.Vector3();
    this.enabled = true;
  }

  /**
   * Plant a rank. Refuses one inside `PROMOTE` of the player — see that
   * constant: the seam between mass and real bodies is not solved, and the
   * enforcement is that the two never share ground.
   */
  add(opts) {
    const p = this.world?.player?.position;
    if (p && opts.anchor.distanceTo(p) < PROMOTE) return null;
    const r = new Rank(opts);
    r.place(this.world?.terrain || null);
    this.ranks.push(r);
    this._joinAll(r);
    return r;
  }

  /** Give every living man of `r` a cohort instance. */
  _joinAll(r) {
    const F = this.world?.cohorts;
    if (!F) return;
    const donor = this._donorFor(r.type);
    if (!donor) return;
    for (const m of r.men) {
      if (!m.alive || m._l3) continue;
      m.type = donor.type; m.mod = donor.mod; m.bodyScale = donor.bodyScale;
      m.rig = donor.rig; m._l2 = donor._l2;
      F.join(m);
    }
  }

  /**
   * THE MOULD FOR ONE UNIT TYPE, and it is a body that is already here.
   *
   * `CohortField._cohortFor` needs a rig exactly once per key — it bakes a
   * merged skin off it and every join after that only wants a position, a
   * facing and a gait phase. So the mass needs ONE real body of each type on
   * the field to copy, and the mode that lays a battle out is expected to have
   * one: a `walker` from `Armour.js`, a trooper of your own line, anything.
   *
   * Reused rather than built, deliberately. Constructing a private `Enemy` here
   * would be a second way to make a droid and would wear last month's body the
   * day `buildB1` changes; `useDonor` is the door for a caller that wants to
   * hand one in.
   */
  _donorFor(type) {
    let d = this.donors.get(type);
    if (d !== undefined) return d;
    d = null;
    const E = this.world?.enemies?.find?.((e) => e && e.type === type && e.rig) || null;
    if (E) d = E;                                  // reuse a body already here
    this.donors.set(type, d);
    return d;
  }

  /** Hand a donor in explicitly, for a caller that has one. */
  useDonor(e) {
    if (e?.type && e.rig) this.donors.set(e.type, e);
  }

  /**
   * ONE FRAME OF THE BATTLE.
   *
   * Order matters and is the order the eye reads: who is left, where they
   * stand, what they are shooting at. Casualties are applied before the march
   * so a rank that broke this frame gives ground on this frame rather than
   * advancing once more into the fire that broke it.
   */
  update(dt, ctx = null) {
    if (!this.enabled || !this.ranks.length) return;
    const bolts = ctx?.bolts || this.world?.bolts || null;
    this._sweep(bolts);
    this._march(dt);
    this._fire(dt, bolts);
    this._draw();
  }

  /**
   * BOLTS INTO THE MASS.
   *
   * Coarse then fine: one distance test against the whole rank, and only a rank
   * that a bolt is actually near pays for its twenty men. With sixteen ranks and
   * a hundred live bolts that is 1 600 cheap tests and almost no expensive ones,
   * against 32 000 if every bolt asked every man.
   *
   * The radius is generous — `HIT` metres — because these men have no capsules
   * and are drawn at a range where a metre is a pixel. A mass that demanded a
   * torso-accurate hit would read as bolts passing through a crowd.
   *
   * ── AND IT IS THE SEGMENT, NOT THE POINT ─────────────────────────────
   *
   * The first version tested `bolt.pos` against each man and killed NOBODY. A
   * rank bolt travels 92 m/s, which is 1.53 m between frames at 60 Hz, and a
   * man is a metre wide: most rounds simply teleported past. Measured, 320 men
   * exchanging fire for five seconds — **0 casualties**, a light show.
   *
   * So the test is the swept SEGMENT `prev → pos`, which is the same thing
   * `BoltPool` does against real bodies and for the same reason. `prev` is
   * already on every bolt. This is the difference between a battle and a
   * screensaver, and it is exactly the class of defect that only shows up when
   * you look at the number rather than the frame.
   */
  _sweep(bolts) {
    if (!bolts?.bolts) return;
    for (const b of bolts.bolts) {
      if (!b.active || b.held) continue;
      for (const r of this.ranks) {
        if (!r.alive) continue;
        if (b.team === r.team) continue;
        /* Coarse: the whole swept segment against the rank's sphere, grown by
         * the step so a bolt that crossed the block in one frame still asks. */
        _v.copy(b.pos).sub(r.anchor).setY(0);
        const step = _w.copy(b.pos).sub(b.prev).length();
        if (_v.lengthSq() > (r.radius + step + HIT) ** 2) continue;
        for (const m of r.men) {
          if (!m.alive) continue;
          if (segNear(b.prev, b.pos, m.position, HIT)) {
            if (r.fell(m)) this._release(m);
            b.active = false;
            break;
          }
        }
        if (!b.active) break;
      }
    }
  }

  /** Take a dead man's instance back. His slot zero-scales, which is how an
   *  instance hides — so the block visibly thins as it is shot. */
  _release(m) {
    this.world?.cohorts?.leave?.(m);
  }

  /**
   * THE PUSH, WHICH IS THE ONE THING THAT MAKES A BIG BATTLE READABLE.
   *
   * Total standing men on each side decide who advances. The loser does not
   * rout — it gives ground at the same rate, so the line bends rather than
   * evaporating, and a player who kills a hundred droids can watch their own
   * side's line move forward because of it. That is the feedback a battle of
   * this size has to give or it is wallpaper.
   *
   * A BROKEN RANK ALWAYS FALLS BACK, whatever its side is doing. `BREAK_AT` is
   * a third of the block, and a third of a block is not a unit any more.
   */
  _march(dt) {
    let mine = 0, theirs = 0;
    for (const r of this.ranks) { if (r.team === 1) theirs += r.alive; else mine += r.alive; }
    const total = mine + theirs;
    if (!total) return;
    /* −1..1, and the winner's share of it is how fast they walk. */
    const tilt = (mine - theirs) / total;
    const terrain = this.world?.terrain || null;
    for (const r of this.ranks) {
      if (!r.alive) continue;
      let push;
      if (r.broken) {
        push = -1;                                   // a broken block always goes back
      } else {
        /**
         * THE APPROACH, AND THEN THE PUSH.
         *
         * Two lines that both start out of range and only move when one is
         * winning never meet: `tilt` is zero while the strengths are equal, so
         * the opening state of a fair battle is deadlock at whatever distance
         * it was laid out at. That is exactly what happened — see `STAND_OFF`.
         *
         * So a rank out of its stand-off closes at full pace whatever the tilt
         * says, and a rank at its stand-off stops closing and starts pushing.
         * The approach is the opening beat and the push is the battle.
         */
        const foe = this._nearestFoe(r);
        const d = foe ? r.anchor.distanceTo(foe) : 0;
        push = d > STAND_OFF ? 1 : (r.team !== 1 ? tilt : -tilt);
      }
      if (Math.abs(push) < 0.02) continue;
      const step = MARCH * push * dt * (r.broken ? 1.6 : 1);
      r.anchor.addScaledVector(r.dir, step);
      if (terrain) r.anchor.y = terrain.height(r.anchor.x, r.anchor.z);
      r.place(terrain);
    }
  }

  /**
   * VOLUME OF FIRE, AND IT IS REAL FIRE.
   *
   * One accumulator per rank rather than per man: the rate is `RATE` a standing
   * man, so a thinned block fires visibly less, and the shots come out of
   * random living men so the muzzle flashes are spread across the frontage
   * instead of coming from one corner of it.
   *
   * `REACH` and `SILENT` are two different refusals. A rank past `REACH` has
   * nothing in range and holds; a rank past `SILENT` from the PLAYER does not
   * fire at all, because at that distance its rounds cannot be seen, dodged or
   * deflected and are pure cost.
   */
  _fire(dt, bolts) {
    if (!bolts) return;
    const p = this.world?.player?.position || null;
    for (const r of this.ranks) {
      if (!r.alive || r.broken) continue;
      if (p && r.anchor.distanceTo(p) > SILENT) continue;
      const foe = this._nearestFoe(r);
      if (!foe) continue;
      const d = r.anchor.distanceTo(foe);
      if (d > REACH) continue;
      r.fireT += dt * RATE * r.alive;
      let shots = Math.floor(r.fireT);
      if (shots <= 0) continue;
      r.fireT -= shots;
      if (shots > 6) shots = 6;                  // no burst from a resumed tab
      for (let i = 0; i < shots; i++) {
        const m = this._anyLiving(r);
        if (!m) break;
        /**
         * MUZZLE HEIGHT TO MUZZLE HEIGHT, and the first version did not.
         *
         * It fired from the shooter's chest at the target rank's ANCHOR, which
         * carries the terrain height under the block — so every round left at
         * +1.25 m and aimed at 0 m, descending a metre and a quarter over a
         * hundred and fifty. On ground with any rise in it that is a shot into
         * the dirt, and it is why 224 rounds produced exactly zero casualties
         * on the first real run of this file.
         *
         * Flat is also the honest picture: a firing line levels its rifles.
         */
        _w.copy(m.position); _w.y += MUZZLE;
        _v.copy(foe).setY(foe.y + MUZZLE).sub(_w).normalize();
        _v.x += (Math.random() - 0.5) * CONE;
        _v.y += (Math.random() - 0.5) * CONE * 0.35;
        _v.z += (Math.random() - 0.5) * CONE;
        bolts.fire(_w, _v.normalize(),
          { team: r.team, damage: r.damage, color: r.color, speed: 92 });
      }
    }
  }

  /** What this rank is shooting at: the nearest opposing anchor, or the player
   *  when they are the closest hostile thing — which is what makes standing in
   *  front of a firing line feel like standing in front of a firing line. */
  _nearestFoe(r) {
    let best = null, bd = Infinity;
    for (const o of this.ranks) {
      if (!o.alive || o.team === r.team) continue;
      const d = o.anchor.distanceToSquared(r.anchor);
      if (d < bd) { bd = d; best = o.anchor; }
    }
    const p = this.world?.player;
    if (p && p.alive !== false && r.team === 1) {
      const d = p.position.distanceToSquared(r.anchor);
      if (d < bd) { bd = d; best = p.position; }
    }
    return best;
  }

  _anyLiving(r) {
    for (let i = 0; i < 8; i++) {
      const m = r.men[(Math.random() * r.men.length) | 0];
      if (m.alive) return m;
    }
    return r.men.find((m) => m.alive) || null;
  }

  /** Push every living man's matrix. One compose each, however many bins. */
  _draw() {
    const F = this.world?.cohorts;
    if (!F) return;
    for (const r of this.ranks) {
      for (const m of r.men) if (m.alive && m._l3) F.place(m);
    }
  }

  /** Standing men, by side. What a HUD would print. */
  count(team) {
    let n = 0;
    for (const r of this.ranks) if (r.team === team) n += r.alive;
    return n;
  }

  dispose() {
    const F = this.world?.cohorts;
    for (const r of this.ranks) for (const m of r.men) if (m._l3) F?.leave?.(m);
    this.ranks.length = 0;
    this.donors.clear();
  }
}

/* ══════════════════════════════════════════════════════════════════════ */
/*  Laying out a battle                                                   */
/* ══════════════════════════════════════════════════════════════════════ */

/**
 * TWO ARMIES FACING EACH OTHER, AND THE PLAYER BEHIND THEIR OWN LINE.
 *
 * This is the part that decides whether the player ever SEES the battle, and it
 * is the thing every previous attempt got wrong. Measured on a shipped Command
 * deploy: 49 hostiles on the field and **zero inside the camera frustum six
 * seconds after landing**. The armies existed. The battle did not, because a
 * battle is a picture and the picture was empty.
 *
 * So the layout is not "scatter them around the objective". It is two ranks of
 * blocks on one axis, `gap` apart, both perpendicular to it — and the player
 * stands `back` metres behind the middle of their own line, facing along the
 * axis. The first frame after deploy is a wall of your own men with a wall of
 * theirs beyond it. Nothing about that is left to a spawn heuristic.
 *
 * @param field   a `MassField`
 * @param opts.mine / opts.theirs   unit type per side
 * @param opts.blocks               blocks per side (each `RANK_MEN` strong)
 * @param opts.gap                  metres between the two front lines
 * @param opts.axis                 the direction the player's side advances
 */
export function layBattle(field, opts = {}) {
  const blocks = opts.blocks ?? 8;
  const gap = opts.gap ?? 150;
  const axis = (opts.axis || new THREE.Vector3(0, 0, 1)).clone().setY(0).normalize();
  const right = new THREE.Vector3(axis.z, 0, -axis.x);
  const origin = (opts.origin || field.world?.player?.position || new THREE.Vector3()).clone();
  field.axis.copy(axis);
  field.origin.copy(origin);

  /* Frontage: the blocks stand side by side across the axis, centred on it, so
   * the line is `blocks × width` wide and the player is looking down its
   * middle. A 8-block line at 5 across and 2 m spacing is 80 m of frontage,
   * which fills a 60° camera at a hundred metres. */
  const width = RANK_COLS * SPACING + 6;
  const mineAt = opts.back ?? PROMOTE + 10;
  const out = { mine: [], theirs: [] };
  for (let i = 0; i < blocks; i++) {
    const off = (i - (blocks - 1) / 2) * width;
    const a = origin.clone().addScaledVector(axis, mineAt).addScaledVector(right, off);
    const b = origin.clone().addScaledVector(axis, mineAt + gap).addScaledVector(right, off);
    const mine = field.add({ type: opts.mine ?? 'trooper', team: 0, dir: axis, anchor: a,
      men: opts.men ?? RANK_MEN });
    const theirs = field.add({ type: opts.theirs ?? 'b1', team: 1, dir: axis.clone().negate(),
      anchor: b, men: opts.men ?? RANK_MEN });
    if (mine) out.mine.push(mine);
    if (theirs) out.theirs.push(theirs);
  }
  return out;
}
