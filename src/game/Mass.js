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
/* The mode's size is declared on the mode, not here — see `openFront`. */
import { MODES } from './Waves.js';
/* Whose uniform each line wears is the game's own three-clause rule, asked
 * rather than restated — see `Front.sides`. */
import { armyToLead, enemyOf } from './Command.js';
/* Where the instanced rung starts. The moulds have to stand past it — see
 * `MOULD_FLANK`. */
import { L3_AT } from './Cohorts.js';

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

/**
 * HOW FAR A BROKEN BLOCK GETS BEFORE IT IS GONE, and this number is the
 * difference between a battle and a rout that eats one side whole.
 *
 * A broken rank stopped firing (`_fire` refuses on `broken`) and kept being
 * SHOT AT, because nothing took it off the field. So the moment either side
 * broke a block it stopped contributing volume and started absorbing rounds
 * for free — and the side that broke first snowballed. Measured on the first
 * real run of the mode, twelve blocks a side, ninety seconds:
 *
 *     240 v 240   →   47 v 195
 *
 * Not a damage imbalance: a trooper rank hits for 7.2 and a B1 rank for 5.4.
 * It was entirely the spiral.
 *
 * So a broken block that has put this much ground between itself and the
 * nearest enemy is off the field. That is what routing MEANS — the unit is out
 * of the battle, not standing in the open being shot at — and it is also the
 * only ending that stops a lost flank from becoming a lost army. Its men are
 * not casualties and are not counted as any: they ran.
 */
export const ROUT_AWAY = 60;

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
        /**
         * THE GAIT PHASE, SPREAD ACROSS THE CYCLE BY INDEX, exactly as
         * `Enemy._animPhase` spreads a crowd — so a block reads as men rather
         * than as a sheet of copies.
         *
         * WHAT IT ACTUALLY BUYS DEPENDS ON SOMETHING THIS FILE DOES NOT OWN,
         * and that is worth writing down rather than implying. `CohortField`
         * draws an instance in the palette slot its phase names, and the
         * palette is filled by `step` from a cohort MEMBER — a real body of
         * that type, posing its own bones against its own position. A man of
         * the mass is not one and must never be (see `_joinAll`), so until a
         * real body of the same uniform crosses `Cohorts.L3_AT` and joins the
         * same cohort, every slot is identity and the block wears the pose it
         * was frozen in. One does and they all start walking; none does and
         * they stand. Both are correct pictures; only the second is the one
         * these numbers are usually seen in.
         */
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

  /**
   * Give every living man of `r` a cohort instance.
   *
   * ── AND A MAN NEVER CARRIES THE MOULD'S RIG, which he used to ────────
   *
   * This copied `donor.rig` and `donor._l2` onto every man, and the two of them
   * are exactly what `CohortField` reads to POSE a cohort — so both halves of
   * the drawing were taken from a body standing somewhere else:
   *
   *   THE FREEZE. `_cohortFor` bakes the static geometry with `freezeSkin(skin,
   *     e.position, e.facing)` — the MAN's coordinates — off `bone.matrixWorld`,
   *     which is the MOULD's. Measured on a laid battle: the frozen skin came
   *     out centred 111 m from its own origin, and in a browser three hundred
   *     men were drawn floating in the air over the plain while every
   *     `man.position` in this file was correct.
   *   THE CAPTURE. `capture(pose, man)` computes `canon(man.position) ·
   *     mouldBone.matrixWorld · inv`, and the shader's own algebra then cancels
   *     the instance matrix against that canon — so a captured slot draws every
   *     man wearing it AT THE MOULD. The palette is per cohort KEY, which real
   *     distant bodies of the same type share, so it is not even a mistake the
   *     mass could keep to itself.
   *
   * Both go away with one rule: a man carries a TYPE and nothing else. The bake
   * is taken once per key off the mould at the mould's own coordinates
   * (`_bake`), and the gait palette is filled by real bodies of that type
   * standing in the instanced band — which is what the moulds are placed to be.
   * A man with no rig can never be picked to pose one.
   */
  _joinAll(r) {
    const F = this.world?.cohorts;
    if (!F) return;
    const donor = this._donorFor(r.type);
    if (!donor) return;
    this._bake(F, donor);
    for (const m of r.men) {
      if (!m.alive || m._l3) continue;
      m.type = donor.type; m.mod = donor.mod; m.bodyScale = donor.bodyScale;
      F.join(m);
    }
  }

  /**
   * MAKE THE COHORT ONCE, AT THE MOULD'S OWN COORDINATES.
   *
   * `CohortField._cohortFor` bakes on the FIRST join of a key and caches
   * forever after, so whoever joins first decides where the frozen geometry
   * sits. That must be a body whose `position`, `facing` and bones agree — a
   * real one — and the men do not qualify. So a seed carrying the mould's
   * coordinates goes in first and is taken straight back out; every man after
   * it lands in a cohort that is already correct and is only ever asked for a
   * matrix.
   *
   * Nothing happens when the key already exists, which is the common case:
   * twenty-four ranks share two moulds.
   */
  _bake(F, donor) {
    if (!donor.rig || F.cohorts.has(F.keyFor(donor))) return;
    const seed = {
      type: donor.type, mod: donor.mod, bodyScale: donor.bodyScale,
      rig: donor.rig, _l2: donor._l2,
      position: donor.position.clone(), facing: donor.facing,
      animator: { moving: false, phase: 0 },
    };
    if (F.join(seed)) F.leave(seed);
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
      /* …AND A BLOCK THAT HAS GOT AWAY IS GONE. See `ROUT_AWAY`: a broken rank
       * that stays on the field is a free target that fires nothing back, and
       * that is what turned the first real run of this mode into 47 against
       * 195 from an even start. */
      if (r.broken) {
        const foe = this._nearestFoe(r);
        if (!foe || r.anchor.distanceTo(foe) > STAND_OFF + ROUT_AWAY) this.retire(r);
      }
    }
  }

  /**
   * Take a block off the field — routed, or wiped.
   *
   * Its instances go back to the cohort's free list, which is what makes the
   * men vanish rather than freeze in place. Not a casualty count: `count()`
   * answers "men standing on this field", and a block that ran is not standing
   * on it.
   */
  retire(r) {
    for (const m of r.men) if (m.alive) { m.alive = false; this._release(m); }
    r.alive = 0;
    const i = this.ranks.indexOf(r);
    if (i >= 0) this.ranks.splice(i, 1);
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
    /**
     * …AND THE PLAYER ONLY WHEN THERE IS NOTHING ELSE, which is a correction
     * and is the whole of a battle that was lopsided from the first minute.
     *
     * This used to take the player whenever they were the NEAREST hostile
     * thing, and standing in front of a firing line should feel like standing
     * in front of a firing line. But the player is one point, and every enemy
     * block that picked them aimed at the same point — so their fire arrived
     * CONCENTRATED on one axis while the other side, each block picking its own
     * nearest anchor, spread its fire across the whole frontage. Concentration
     * beats spread, and it beat it badly. Measured, twelve blocks a side from
     * an even start, ninety seconds:
     *
     *     240 v 240   →   2 v 208
     *
     * with fire VOLUME nearly equal at 1094 rounds against 1229. It was never a
     * damage or a rate problem; it was twelve blocks agreeing on a target.
     *
     * So a rank shoots the enemy LINE while there is one in reach, and turns on
     * the player only when there is not — which is also the truer picture: a
     * firing line engages the line in front of it, and notices the one man
     * running at it when the line is gone.
     */
    const p = this.world?.player;
    if (p && p.alive !== false && !best) {
      const d = p.position.distanceToSquared(r.anchor);
      if (d < REACH * REACH) best = p.position;
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
 * ── THE GROUND BETWEEN TWO LINES DECIDES THE BATTLE ──────────────────────
 *
 * This was the mode's worst defect and it is invisible from a screenshot.
 * `layBattle` put its anchors at fixed distances along the axis and never
 * asked whether the two lines could SEE each other. Measured on the shipped
 * Geonosis front, twelve blocks a side, twenty seconds:
 *
 *     real terrain    122 v 202     hit rates 3.4% and 7.4%
 *     flat ground     225 v 239     16 casualties in total
 *
 * Fire volume was near-equal at 1034 rounds against 1222, so it was neither
 * damage nor cadence. Flattening the ground removed the imbalance completely,
 * which makes the ground the cause rather than a suspicion: a ridge between
 * the two anchors eats one side's fire and not the other's, and which side
 * loses is decided by where the level generator happened to put a rise.
 *
 * So each pair of opposing blocks is SEATED before it is planted: the profile
 * between the two nominal anchors is sampled, and if something stands between
 * them both anchors slide along the axis, together, to the nearby pair with
 * the clearest line. Together, so the no-man's-land keeps the width the mode
 * declared; along the axis only, so the frontage keeps its shape and blocks do
 * not end up standing in each other.
 *
 * A LINE THAT CANNOT BE CLEARED IS LEFT WHERE IT WAS. Some ground has a hill
 * in the middle of it and no amount of sliding fixes that — and a block shoved
 * forty metres to find a sightline is a block that is no longer part of its
 * own army's line. The bound is what makes this a seating and not a search.
 */
export const SEAT_WINDOW = 26;
export const SEAT_STEPS = 7;
export const SEAT_SAMPLES = 12;

/**
 * What a clear line between two opposing blocks is worth when a bearing is
 * chosen, and how much a height advantage costs.
 *
 * Both are scored against the picture terms, which are worth 15 at most (five
 * points across your own line at two each, five across theirs at one). Three
 * clear pairs at 1.5 is 4.5 — enough to move a bearing off a plateau and not
 * enough to choose a battle you cannot see. `TILT_CAP` stops one cliff
 * dominating the whole sweep: past twenty metres of difference the bearing is
 * already disqualified and how much worse it gets does not matter.
 */
export const SIGHT_WORTH = 1.5;
export const TILT_WORTH = 0.22;
export const TILT_CAP = 20;

/**
 * How much ground stands between two points, in metres above the sightline.
 *
 * Zero is a clear shot. Sampled rather than swept, because the answer only has
 * to rank candidate seatings against each other and a dozen points across a
 * hundred and fifty metres already finds every ridge a body could hide behind.
 */
export function blockage(terrain, a, b) {
  if (!terrain?.height) return 0;
  const ay = terrain.height(a.x, a.z) + MUZZLE;
  const by = terrain.height(b.x, b.z) + MUZZLE;
  let worst = 0;
  for (let i = 1; i < SEAT_SAMPLES; i++) {
    const t = i / SEAT_SAMPLES;
    const x = a.x + (b.x - a.x) * t, z = a.z + (b.z - a.z) * t;
    const over = terrain.height(x, z) - (ay + (by - ay) * t);
    if (over > worst) worst = over;
  }
  return worst;
}

/**
 * Slide one opposing pair along the axis to where they can see each other.
 *
 * Both anchors are moved by the same amount, so the gap the mode declared is
 * the gap they fight across. `a` and `b` are edited in place.
 */
export function seatPair(terrain, a, b, axis) {
  if (!terrain?.height) return 0;
  let best = blockage(terrain, a, b), bestAt = 0;
  if (best <= 0) return 0;
  for (let s = 1; s <= SEAT_STEPS; s++) {
    const d = (s / SEAT_STEPS) * SEAT_WINDOW;
    for (const sign of [1, -1]) {
      _v.copy(axis).multiplyScalar(d * sign);
      const blocked = blockage(terrain, _s.copy(a).add(_v), _w.copy(b).add(_v));
      if (blocked < best) { best = blocked; bestAt = d * sign; }
      if (best <= 0) break;
    }
    if (best <= 0) break;
  }
  if (bestAt) {
    _v.copy(axis).multiplyScalar(bestAt);
    a.add(_v); b.add(_v);
    a.y = terrain.height(a.x, a.z);
    b.y = terrain.height(b.x, b.z);
  }
  return best;
}

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
  const terrain = field.world?.terrain || null;
  for (let i = 0; i < blocks; i++) {
    const off = (i - (blocks - 1) / 2) * width;
    const a = origin.clone().addScaledVector(axis, mineAt).addScaledVector(right, off);
    const b = origin.clone().addScaledVector(axis, mineAt + gap).addScaledVector(right, off);
    /* …AND THEY HAVE TO BE ABLE TO SEE EACH OTHER. See `seatPair`. */
    seatPair(terrain, a, b, axis);
    const mine = field.add({ type: opts.mine ?? 'trooper', team: 0, dir: axis, anchor: a,
      men: opts.men ?? RANK_MEN });
    const theirs = field.add({ type: opts.theirs ?? 'b1', team: 1, dir: axis.clone().negate(),
      anchor: b, men: opts.men ?? RANK_MEN });
    if (mine) out.mine.push(mine);
    if (theirs) out.theirs.push(theirs);
  }
  return out;
}

/* ══════════════════════════════════════════════════════════════════════ */
/*  THE FRONT — the mode, and the seam it is driven on                    */
/* ══════════════════════════════════════════════════════════════════════ */

/**
 * EVERYTHING ABOVE THIS LINE WAS UNREACHABLE, which is the defect this section
 * closes and the one the player was told about.
 *
 * `MassField` was measured, checked at 7/7 and called by nothing but its own
 * suite: `grep -rn 'MassField\|layBattle' src/` outside this file returned
 * ZERO. A tier that no mode deploys into is a tier the player cannot see, which
 * is the same complaint the header opens with wearing a different hat.
 *
 * ── THE MODE IS TWO FIGHTS AT ONCE, AND THAT IS THE WHOLE POINT ──────────
 *
 * `PROMOTE` is 90 m and this file refuses to plant a rank inside it, because
 * the seam between a rank and a real body is not solved (see that constant).
 * So a mode that fielded ONLY mass would leave the player standing in ninety
 * metres of empty ground watching a war they cannot reach.
 *
 * The mode therefore runs the ORDINARY WAVE DIRECTOR for the near fight and
 * the mass for the far one. Nothing here starts the director or knows how — it
 * is `main.js`'s `director.start(1)`, the same line every non-Command mode
 * deploys through — and nothing here is a second escalation. You are one Jedi
 * in a real battle: full bodies, physics, ragdolls and dismemberment inside 90
 * m, and hundreds of instanced men firing real bolts past you outside it.
 *
 * ── THE PER-FRAME SEAM IS `world.props`, WHICH ALREADY EXISTS ────────────
 *
 * `World.update` drives `for (const p of this.props) p.update(dt)` and
 * `World.unload` calls `destroy()` on every one of them. `Levy.js`,
 * `Riders.js`, `Flight.js` and `Hazard.js` are all attached exactly this way —
 * a game system with a per-frame tick and a teardown, registered through
 * `world.addProp`. Adding a `world.mass?.update()` line to `World.update`
 * would be a fifth way to say the same thing, so this takes the fourth.
 *
 * It runs AFTER `bolts.update` in the frame, which is the ordering `_sweep`
 * wants: a bolt's `prev → pos` segment for THIS frame is already written when
 * the mass asks who it passed through.
 *
 * ── AND IT IS LAID WHEN THE PLAYER IS STANDING ON THE GROUND ─────────────
 *
 * `layBattle` lays the whole battle around ONE point and ONE bearing, and
 * neither can be read at deploy: every fighting mode opens with
 * `beginInsertion`, so for the first ~28 seconds `player.position` is a seat
 * in a gunship 900 m up and the camera belongs to the bay. Measured on a real
 * insertion, the commander is put on the sand at 24.3 s.
 *
 * So the front ARMS at deploy and LAYS on the first frame the player is on
 * their feet — `player.riding`, the same field `World.pickSpawn` consults for
 * the same reason. With no flight (a check, `instantSpawn`) that is frame one.
 * The bearing is then chosen against the ground rather than taken from where
 * they happen to be looking; see `Front._bearing`.
 */

/**
 * THE MOULD, AND EXACTLY WHERE IT HAS TO STAND.
 *
 * `MassField._donorFor`'s note says the mass needs one real `Enemy` per unit
 * type to bake a merged skin off, and that a caller with one should hand it in
 * through `useDonor`. These two numbers are where that body goes, and both of
 * them are a band with a measured wall on each side.
 *
 * PAST 62 m, because that is where `applyMergedSkin` bakes `_l2` — the merged
 * skin `CohortField._cohortFor` wants — and a body at the player's elbow never
 * has one.
 *
 * AND INSIDE `Cohorts.L3_AT` (137.8 m), which is the surprising half and was
 * found the expensive way. `Enemy.update` applies its LOD rung at line ~5822
 * and poses its rig two thousand lines later, so a body that is ALREADY past
 * L3_AT on its first update joins a cohort before it has ever been posed —
 * and `_cohortFor` freezes the skin out of `bone.matrixWorld`, which for an
 * unposed rig is still at the WORLD ORIGIN. Measured, a trooper spawned 150 m
 * out: the frozen geometry came back centred 152 m from its own origin, and in
 * a real browser the whole cohort was drawn floating in the air over the plain.
 * (That is a defect in the shipped LOD path, not in this file; it is simply not
 * reachable by any body that walks out to the band instead of appearing in it.)
 *
 * So a mould stands in the middle of that band, where it is guaranteed to have
 * a merged skin and guaranteed never to bake a cohort itself — and `_bake`
 * makes the cohort deliberately, off that posed body, at its own coordinates.
 *
 * WHAT THE MEN THEN WEAR is the frozen pose, and that is the honest state: the
 * gait palette is filled by `CohortField.step` from a cohort MEMBER, and the
 * only members here are men with no rig of their own (see `_joinAll` for why
 * they must not have one). A real body of the same type that later crosses
 * L3_AT joins this same cohort and fills the palette correctly, and every man
 * in it starts walking; until one does, they stand. `place`'s own `-1` is that
 * state and it is the rung as it shipped.
 */
const MOULD_FWD = 85;
const MOULD_SIDE = 45;

/** Roughly where the player's eye is over their feet, and how tall a man is.
 *  Both are only used to ask whether a line would be over a ridge or behind
 *  it — see `Front._bearing` — so they are the body's rough numbers and not a
 *  second copy of anything the rig owns. */
const EYE = 1.5;
const STANDING = 1.8;

/** How many bearings `Front._bearing` sweeps. Every 10°: finer than the 16 m
 *  a block is wide at the range the near line stands. */
const BEARINGS = 36;

/**
 * A LAID BATTLE, ATTACHED TO THE WORLD AND DRIVEN BY IT.
 *
 * Registered as a prop, so `World.update` ticks it and `World.unload` tears it
 * down without either of them knowing what it is.
 */
class Front {
  constructor(world, plan) {
    this.world = world;
    this.plan = plan;
    this.field = new MassField(world);
    this.moulds = [];
    this.laid = null;
    this.dead = false;
    this.id = 'front';
    this.kind = 'front';
    this.grippable = false;
    this.hp = Infinity;
    this.toughness = Infinity;
    /**
     * THE DUCK-TYPED BODY EVERY PROP OWES, and it is not optional.
     *
     * `World._boltHitTest` walks `world.props` and reads
     * `pr.body.boundingRadius` on every one before it looks at anything else;
     * `World._resolveBlades` reads `pr.body.position.distanceToSquared`. A
     * prop without one throws on the first bolt of the first frame — measured,
     * this mode died in `_boltHitTest` before a rank was ever laid. The shape
     * is `LevyPack`'s, whose own note records the same lesson, and the radius
     * is zero because a front is not a thing a bolt can hit: the men are.
     */
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

  /**
   * THE TWO UNIFORMS, DERIVED FROM THE GROUND AND THE PLAYER'S ORDER.
   *
   * Not typed here. `armyToLead` is the three-clause rule every other part of
   * the game resolves a side with — the player's order first, the ground's own
   * armies second — and `enemyOf` is the other one. Typing `'trooper'` and
   * `'b1'` would put clones on both sides of a Sith's battle, which is the
   * exact complaint `Databank.armyForOrder`'s note quotes.
   */
  sides() {
    const w = this.world;
    const mine = armyToLead(w.settings?.order, { ground: w.level?.armies });
    return { mine: mine.tiers[0].type, theirs: enemyOf(mine).tiers[0].type };
  }

  /** Is the player on their own feet on real ground yet? See the note above. */
  _ready() {
    const p = this.world?.player;
    return !!(p && p.alive !== false && !p.riding && this.world.terrain);
  }

  /**
   * One real soldier of `type`, put down through the world's own door, on the
   * flank of the ground between the player and their line.
   *
   * `side` is which flank. The distance is fixed rather than derived from the
   * battle's size, because it is answering the LOD band and not the frontage —
   * see `MOULD_FWD`.
   */
  _mould(type, team, side) {
    const w = this.world;
    const p = w.player.position;
    const right = new THREE.Vector3(this.axis.z, 0, -this.axis.x);
    const at = p.clone().addScaledVector(this.axis, MOULD_FWD)
      .addScaledVector(right, MOULD_SIDE * side);
    /* Off the edge of the world is no use to anybody: try the other flank, then
     * the axis itself. */
    if (!w.terrain.inBounds(at.x, at.z, 8)) {
      at.copy(p).addScaledVector(this.axis, MOULD_FWD).addScaledVector(right, -MOULD_SIDE * side);
    }
    if (!w.terrain.inBounds(at.x, at.z, 8)) at.copy(p).addScaledVector(this.axis, MOULD_FWD);
    at.y = w.terrain.height(at.x, at.z);
    const e = w.spawnEnemy(type, at);
    if (!e) return null;
    /* `e.team = 0` and nothing else: that is the one field `Command.enlistBody`
     * sets to put a body on the player's side, and the rest of what it does is
     * roster, rank and formation — none of which this body has or needs. A
     * team-0 body is not counted by `WaveDirector.blocksWaveEnd`, so a mould
     * standing in your line cannot hold the near fight's wave open. */
    e.team = team;
    e.frontSide = side;
    this.field.useDonor(e);
    return e;
  }

  /**
   * WHICH WAY THE BATTLE FACES, AND WHY IT IS NOT SIMPLY WHERE YOU LOOK.
   *
   * `layBattle`'s own note is that a battle is a PICTURE — it lays the player
   * behind the middle of their own line looking down the axis so that the first
   * frame is a wall of your men with a wall of theirs beyond it. That
   * arrangement is angular, and angles are not what an authored heightfield
   * gives you. Measured on a shipped Geonosis deploy, the ground between the
   * player and their own line sampled every tenth of the way:
   *
   *     -0.7  -0.3  -0.2  -0.2  -0.3  -0.5  -0.2  8.6  19.3  1.4  0.2
   *
   * A nineteen-metre rock standing at 80 m. Four hundred and eighty men were on
   * the field and every one of them was inside the camera's angle — the frustum
   * count said 480 of 480 — and the picture was an empty plain. That is check
   * 5's defect wearing terrain instead of a spawn heuristic, and no count can
   * see it.
   *
   * Nor is it rare. Twenty-four bearings swept on three grounds, scoring the
   * highest thing standing between the player and 250 m: geonosis 1 of 24 under
   * 2°, drifts 0 of 24, scoria 0 of 24 (and half of them off the map). A
   * bearing picked without asking the ground is a bearing that is usually wrong.
   *
   * So the axis is CHOSEN: every bearing is walked, each line is asked whether
   * it would stand above everything in front of it, and the best answer wins
   * with the player's own facing as the tie-break. `PROMOTE` is what makes this
   * necessary rather than optional — the near line cannot be brought closer
   * than 90 m to duck under a ridge, because inside 90 m the mass may not
   * stand at all.
   */
  _bearing(fallback) {
    const w = this.world;
    const p = w.player.position;
    const eye = p.y + EYE;
    const mineAt = PROMOTE + 10;
    const theirsAt = mineAt + this.plan.gap;
    const half = (this.plan.blocks * (RANK_COLS * SPACING + 6)) / 2;
    let best = null;
    for (let k = 0; k < BEARINGS; k++) {
      const a = fallback + (k / BEARINGS) * Math.PI * 2;
      const dx = Math.sin(a), dz = Math.cos(a);
      const rx = dz, rz = -dx;
      let score = 0;
      /* Five points across each line rather than one down the middle: a block
       * on the flank stands behind different ground from the one in the
       * centre, and the picture is the whole frontage. Your own line is worth
       * twice theirs — it is the wall you are standing behind and the near half
       * of the picture. */
      for (const [at, worth] of [[mineAt, 2], [theirsAt, 1]]) {
        for (const off of [-1, -0.5, 0, 0.5, 1]) {
          const x = p.x + dx * at + rx * off * half;
          const z = p.z + dz * at + rz * off * half;
          if (this._sees(x, z, p, eye)) score += worth;
        }
      }
      /**
       * …AND WHETHER THE TWO LINES CAN FIGHT EACH OTHER, which is a different
       * question from whether you can SEE them and is the one that decides the
       * battle.
       *
       * The clauses above score the PICTURE — the player's own sightline to
       * both frontages — and a bearing can win them outright while putting the
       * enemy line on top of a plateau. Measured on the shipped front, twelve
       * blocks a side: mean ground under your line 1.9 m, under theirs 31.7 m,
       * with four of nine opposing pairs still blocked by up to 33 m of rock
       * after `seatPair` had done what a ±26 m nudge can do. The result was a
       * battle nobody could have won from the low side:
       *
       *     122 v 202 on real ground, 225 v 239 on flat
       *
       * with fire volume near-equal. So two more terms, both about the pair
       * rather than the viewer: the ground between them has to be clear, and
       * the two lines have to stand at comparable height. A thirty-metre
       * advantage is not a battle, it is a firing range.
       *
       * Weighted to outrank the tie-break and to be outranked by the picture:
       * a battle you cannot see is worse than a battle that is unfair, because
       * the unfair one is at least happening in front of you.
       */
      let mutual = 0, tilt = 0;
      for (const off of [-1, 0, 1]) {
        _s.set(p.x + dx * mineAt + rx * off * half, 0, p.z + dz * mineAt + rz * off * half);
        _w.set(p.x + dx * theirsAt + rx * off * half, 0, p.z + dz * theirsAt + rz * off * half);
        mutual += blockage(w.terrain, _s, _w) > 0 ? 0 : 1;
        tilt += Math.abs((w.terrain?.height(_w.x, _w.z) ?? 0) - (w.terrain?.height(_s.x, _s.z) ?? 0));
      }
      score += mutual * SIGHT_WORTH;
      score -= Math.min(tilt / 3, TILT_CAP) * TILT_WORTH;
      /* Then how far you have to turn, so a tie goes to where you are already
       * looking. Never more than one point, so it can only break a tie. */
      score -= Math.abs(((k + BEARINGS / 2) % BEARINGS) - BEARINGS / 2) / BEARINGS;
      if (!best || score > best.score) best = { score, a };
    }
    /** What the winning bearing scored, out of 15 — five points across your own
     *  line at two each and five across theirs at one. A readable number for a
     *  probe or a report: 15 is both frontages entirely in the clear. */
    this.sightline = best ? Math.round(best.score * 10) / 10 : 0;
    return best ? best.a : fallback;
  }

  /**
   * Would a man standing at `(x, z)` be visible from the player's eye?
   *
   * The heightfield sampled along the sightline against the line itself, which
   * is the only question that matters and the one an angular frustum count
   * cannot answer. Coarse on purpose — 8 m steps over a couple of hundred
   * metres — because it is deciding a bearing, not a hit.
   */
  _sees(x, z, p, eye) {
    const t = this.world.terrain;
    if (!t.inBounds(x, z, 6)) return false;
    const tx = x - p.x, tz = z - p.z;
    const d = Math.hypot(tx, tz);
    if (d < 1) return true;
    const top = t.height(x, z) + STANDING;
    for (let s = 10; s < d - 4; s += 8) {
      const k = s / d;
      const hx = p.x + tx * k, hz = p.z + tz * k;
      if (!t.inBounds(hx, hz, 6)) return false;
      if (t.height(hx, hz) > eye + (top - eye) * k) return false;
    }
    return true;
  }

  /** Put the two moulds down, and fix the axis they were placed around. */
  _plant() {
    const p = this.world.player;
    const f = this._bearing(p.facing ?? 0);
    this.axis = new THREE.Vector3(Math.sin(f), 0, Math.cos(f)).normalize();
    /**
     * …AND YOU ARE TURNED TO FACE IT, ONCE, ON THE FRAME IT IS LAID.
     *
     * Half a measure otherwise: a battle laid on a bearing the player is not
     * looking down is a battle behind them, which is the same empty frame by a
     * different route. `CameraRig.addYaw` is the rig's own door and this is the
     * only thing in this file that ever writes to it — one turn, at the moment
     * the mode begins, and the camera is the player's again on the next frame.
     */
    /* THE RIG'S `yaw` IS WHERE THE CAMERA SITS, WHICH IS BEHIND YOU, so the
     * look direction is its opposite. Measured by setting it to the bearing
     * outright: `player.facing` converged on the bearing PLUS 180°, and the
     * battle stood exactly behind the player — 0 of 480 men in the frame, on a
     * bearing chosen for its clear line of sight. */
    const look = f + Math.PI;
    const turn = ((look - (p.camera?.yaw ?? look)) + Math.PI * 3) % (Math.PI * 2) - Math.PI;
    if (Math.abs(turn) > 0.02) p.camera?.addYaw?.(turn);
    const { mine, theirs } = this.sides();
    this.types = { mine, theirs };
    for (const [type, team, side] of [[mine, 0, -1], [theirs, 1, 1]]) {
      const e = this._mould(type, team, side);
      if (e) this.moulds.push(e);
    }
  }

  /**
   * ARE THE MOULDS' BONES WHERE THE MOULDS ARE? — and the battle waits for it.
   *
   * `_bake` freezes the cohort's geometry out of `bone.matrixWorld` against the
   * mould's `position`, so the two have to agree or every man in that cohort is
   * drawn by the difference between them. They do not agree at once: measured,
   * frame by frame, on a b1 spawned 110 m out, the hips sit within 30 cm of the
   * WORLD ORIGIN for four frames and only then jump to the body — and
   * `Enemy._poseAt`, which looks like the answer, is already set on frame 0.
   * A battle laid on the frame its moulds were planted therefore baked a skin
   * displaced by the mould's whole world position, and in a real browser three
   * hundred men were drawn floating in the air over the plain while every
   * `man.position` in this file was correct.
   *
   * So the question is asked of the bones the bake will actually read, and it
   * is asked flat: the first bone is the hips and they ride about a metre over
   * the body's feet, while the failure is a hundred metres.
   */
  _posed() {
    if (!this.moulds.length) return false;
    const at = new THREE.Vector3();
    for (const m of this.moulds) {
      if (!m?.rig) return false;
      const bone = m._l2?.skin?.skeleton?.bones?.[0] || m.rig.bones?.get?.('hips')?.obj;
      if (!bone) return false;
      m.rig.updateMatrices();
      at.setFromMatrixPosition(bone.matrixWorld).setY(0);
      if (at.distanceToSquared(new THREE.Vector3(m.position.x, 0, m.position.z)) > 4) return false;
    }
    return true;
  }

  /**
   * A DEAD MOULD IS STILL THE THING THE COHORT WAS BAKED FROM, and after it is
   * disposed its rig is gone. Nothing already drawn breaks — the frozen
   * geometry outlives the body it came off — but a battle that has not been
   * laid yet needs a live one, and a cohort that is being posed by a real body
   * of the same type wants the freshest one there is.
   */
  _replaceMoulds() {
    for (let i = 0; i < this.moulds.length; i++) {
      const m = this.moulds[i];
      if (m && !m.dead && !m.disposed && m.rig) continue;
      const type = m?.type;
      if (!type) continue;
      const live = this.world.enemies.find(
        (e) => e && e.type === type && e.rig && !e.dead && !e.disposed && e !== m);
      if (live) { this.moulds[i] = live; this.field.useDonor(live); continue; }
      /* Nothing of that uniform is left standing, so put another one down —
       * but only while there is still a battle waiting on it. */
      if (this.laid) continue;
      const fresh = this._mould(type, m.team ?? 1, m.frontSide ?? (i ? 1 : -1));
      if (fresh) this.moulds[i] = fresh;
    }
  }

  _lay() {
    const w = this.world;
    const p = w.player;
    const { mine, theirs } = this.types;
    this.laid = layBattle(this.field, {
      mine, theirs,
      blocks: this.plan.blocks, gap: this.plan.gap,
      origin: p.position, axis: this.axis,
    });
    const n = this.field.count(0) + this.field.count(1);
    w.notify?.('THE FRONT', `${this.field.count(0)} of yours against ${this.field.count(1)} of theirs`);
    return n;
  }

  update(dt) {
    if (this.dead) return;
    if (!this.laid) {
      if (!this._ready()) return;
      if (!this.moulds.length) this._plant();
      this._replaceMoulds();
      /* Nothing may be baked off a mould whose bones are not yet where the
       * mould is — see `_posed`. A handful of frames, normally. */
      if (!this._posed()) return;
      this._lay();
      return;
    }
    this._replaceMoulds();
    this.field.update(dt);
  }

  destroy() {
    if (this.dead) return;
    this.dead = true;
    this.field.dispose();
    const i = this.world.props.indexOf(this);
    if (i >= 0) this.world.props.splice(i, 1);
    if (this.world.front === this) { this.world.front = null; this.world.mass = null; }
  }
  dispose() { this.destroy(); }
}

/**
 * OPEN THE FRONT FOR A MODE THAT DECLARES ONE.
 *
 * The size of the battle is the MODE's, off `MODES[mode].massBattle`, in the
 * same way `objectives`, `fireMissions` and `battles` are the mode's — so this
 * function names no mode and a second mass mode lights itself. Called once
 * from `main.js`'s deploy path beside `director.start(1)`; everything after
 * that is the prop tick.
 */
export function openFront(world, opts = {}) {
  if (!world) return null;
  const plan = opts.plan || MODES[world.settings?.mode]?.massBattle;
  if (!plan) return null;
  if (world.front && !world.front.dead) return world.front;
  const front = new Front(world, plan);
  world.front = front;
  /** What a HUD, a check or the next mode asks for the battle itself. */
  world.mass = front.field;
  if (world.addProp) world.addProp(front); else world.props?.push(front);
  return front;
}
