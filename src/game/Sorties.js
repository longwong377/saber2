/**
 * BATTLEFRONT BORZ — SORTIES: the flight between the call and the effect.
 *
 * Player note #31, verbatim: *"every effect needs to be turned up to 9000. like
 * okay you call it in, you place it, and then the ships have to fire or come in
 * right, it's not immediate. you should be able to see the ship come in and
 * attack and bomb or do a strafing run or drop smoke. like right now there's
 * just nothing"*.
 *
 * ── WHAT WAS ACTUALLY MISSING, AND IT IS NOT AN EFFECT ──────────────────
 *
 * `Stratagems` already had a lead time: you called, and `lead` seconds later
 * the damage happened. The lead was a NUMBER and nothing occupied it. Three
 * seconds of a ring tightening on the ground is a countdown, not an event —
 * the player is told something is coming and is never shown anything coming.
 *
 * So this file owns exactly one thing: **the seconds between the call and the
 * effect, as something on screen with a position in the world.** A craft
 * crosses the sky on a real path, from a real bearing, at a real speed, and
 * whatever it is carrying leaves it AT THE MOMENT IT IS OVER THE PLACE. The
 * lead is no longer a timer that fires; it is the flight time of a thing you
 * can watch, and can lose sight of, and can be standing underneath.
 *
 * ── WHAT IT DELIBERATELY DOES NOT OWN ───────────────────────────────────
 *
 * Everything a payload DOES belongs to whoever already owns that verb, exactly
 * as it does in Stratagems.js — `Terrain.crater` breaks ground, `BoltPool.fire`
 * shoots, `Smoke.addSmoke` blinds, `Stratagems.blast` throws bodies. A sortie
 * carries a CADENCE: a list of `{ t, at, fn }`, and the only thing this file
 * decides is *when the craft is over that point*. A profile that needed its own
 * damage rule would be a second copy of somebody else's, which is the defect
 * this codebase keeps removing (HANDOFF §2.3).
 *
 * The consequence to hold on to: a new kind of run is a new PROFILE — a speed,
 * an altitude, and a function that says what leaves the craft and when. It is
 * not a new class.
 *
 * ── THE TWO SHAPES, AND WHY THERE ARE ONLY TWO ──────────────────────────
 *
 *   PASS   an atmospheric craft on a straight line through the site. It is
 *          already at the edge of the field when the call commits, it flies
 *          in, it releases along its own track, and it leaves. Strafing runs,
 *          bombing runs and smoke drops are three cadences on one path.
 *
 *   LANCE  something in orbit, which is not a craft you can see and must not
 *          pretend to be one. What arrives is a COLUMN — a spear of light that
 *          finds the ground, holds, and then the ground goes. The flight time
 *          is the same idea (nothing is instant) and the read is completely
 *          different, which is the point: an orbital strike should not look
 *          like a gunship.
 */

import * as THREE from 'three';
import { clamp, lerp, smoothstep, TAU } from '../engine/MathUtil.js';
import { audio } from '../engine/Audio.js';
import { dropshipModel } from './Arrivals.js';
import { armyForOrder } from './Databank.js';

const _v1 = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3();

/**
 * HOW FAR OUT A PASS BEGINS, and it is not a taste number.
 *
 * `Stratagems._aimSite` caps a designation at `AIM_REACH` (90 m), so a craft
 * that started closer than that could be spawned *behind* the player's own
 * mark — the ship would appear between them and the target, which reads as a
 * teleport rather than an approach. 150 m is that reach plus enough sky that
 * the craft is a speck when it appears and a silhouette when it fires.
 */
export const PASS_START = 150;
/** …and how far past the site it carries on before it is gone. */
export const PASS_EXIT = 170;

/**
 * THE PROFILES. A row is a craft, a speed and an altitude; the cadence is the
 * caller's, because only the caller knows what it bought.
 *
 *   speed   m/s along the track. A LAAT gun run is a slow pass — the whole
 *           read is that it is deliberately hanging over you — and a bombing
 *           run is faster because it is not trying to hit anything precisely.
 *   height  metres above the site. Low enough to be a silhouette against the
 *           sky, high enough that the level's own geometry does not eat it.
 *   bank    radians of roll into the run. A craft that flies straight and
 *           level through its own gun run reads as a prop.
 */
export const PROFILES = {
  strafe: { speed: 42, height: 26, bank: 0.34, kind: 'pass' },
  bomb:   { speed: 66, height: 46, bank: 0.12, kind: 'pass' },
  smoke:  { speed: 48, height: 30, bank: 0.20, kind: 'pass' },
  /**
   * THE ORBITAL LANCE. `fall` is its lead, and it is the one flight time in
   * this file that is authored rather than divided out of a path — there is no
   * path, because the ship is in orbit and the only thing that crosses the sky
   * is the round.
   *
   * 5.5 s, and it is longer than everything else here on purpose. It is the
   * biggest call in the table (40 Force, an eight-word phrase, a 12 m lethal
   * circle) and the counter-play to a thing that big has to be REACHABLE: at
   * the player's own walking pace it is enough time for anything with legs to
   * leave a 12 m circle, which is what stops the lance being a delayed
   * instant-kill on whatever it was pointed at. It is also long enough that
   * the caller can be standing in it when it lands, which is the other half.
   */
  lance:  { kind: 'lance', fall: 5.5 },
};

/**
 * ONE CRAFT, ONE RUN.
 *
 * Built at the moment the call commits and dead when it has left the field.
 * `t` is seconds since it appeared; `arrive` is the moment it is over the site,
 * which is what every cadence is written relative to — a cadence entry at
 * `t: -0.4` fires four tenths of a second before the ship is overhead, which
 * is how a bomb released early lands on the mark.
 */
class Sortie {
  /**
   * @param world   needs `scene` and, for the ground, `terrain`
   * @param profile a key of PROFILES
   * @param site    where the run is aimed, on the ground
   * @param bearing radians — the compass direction the craft comes FROM
   * @param cadence [{ t, fn }] — `t` in seconds relative to being overhead
   */
  constructor(world, profile, site, bearing, cadence = []) {
    this.world = world;
    this.P = PROFILES[profile] || PROFILES.strafe;
    this.profile = profile;
    this.site = site.clone();
    this.bearing = bearing;
    this.cadence = cadence.map((c) => ({ ...c, done: false }));
    this.t = 0;
    this.done = false;
    this.group = new THREE.Group();
    this.group.frustumCulled = false;
    if (world?.scene) world.scene.add(this.group);
    if (this.P.kind === 'lance') this._makeLance();
    else this._makePass();
  }

  /* ── an atmospheric pass ───────────────────────────────────────────── */

  _makePass() {
    const P = this.P;
    /* THE SAME HULL THE ARRIVALS FLY. A support call answered by a craft the
     * player has never seen would be a second air force; `dropshipModel` is
     * the readable side of the injection point Arrivals.js already keeps for
     * exactly this reason, and it returns null in any tree without Vehicles.js
     * in it — so the run still happens, with nothing to look at, rather than
     * throwing inside a frame. */
    let ship = null;
    /* YOUR OWN AIR FORCE, and this is the one caller of this door where that is
     * the answer: a support pass is a ship you called, so it wears the hull of
     * the army you lead. The wave's gunship — `Arrivals._makeDropship` — asks
     * for the opposite side, from the same table. */
    const side = armyForOrder(this.world?.settings?.order ?? null);
    try { ship = dropshipModel(side); } catch { ship = null; }
    if (ship) { this.group.add(ship); this._model = ship; }
    const away = _v1.set(Math.sin(this.bearing), 0, Math.cos(this.bearing));
    this.from = this.site.clone().addScaledVector(away, PASS_START).setY(this.site.y + P.height);
    this.to = this.site.clone().addScaledVector(away, -PASS_EXIT).setY(this.site.y + P.height * 1.5);
    /* WHEN IT IS OVERHEAD, derived from the path and the speed rather than
     * authored beside them. Two numbers that have to agree by hand is the twin
     * this project keeps deleting; here the disagreement would be a bomb
     * released at a place the ship is not. */
    this.arrive = PASS_START / P.speed;
    this.life = (PASS_START + PASS_EXIT) / P.speed;
    this.group.position.copy(this.from);
    this.group.rotation.set(0, this.bearing + Math.PI, 0);
    /* THE APPROACH IS AUDIBLE BEFORE IT IS VISIBLE, which is the whole of what
     * a lead time is for. Positioned at the craft's start, so it arrives from
     * the bearing the craft is on and the player can turn toward it. */
    audio.noise({ dur: Math.min(6, this.life), gain: 0.22, type: 'bandpass', freq: 210, q: 0.8,
      pos: this.from });
  }

  _updatePass(dt, ctx) {
    const P = this.P;
    const k = clamp(this.t / this.life, 0, 1);
    this.group.position.lerpVectors(this.from, this.to, k);
    /* Roll into the run and out of it. Peaks where the guns are, which is what
     * a gun run looks like and what a level pass does not. */
    const over = 1 - clamp(Math.abs(this.t - this.arrive) / 1.6, 0, 1);
    this.group.rotation.set(-0.06 * over, this.bearing + Math.PI, P.bank * over);
    if (ctx?.particles && this.t < this.life * 0.9) {
      // engine wash, so the thing has a wake and is not a sliding decal
      if (Math.random() < 0.5) {
        _v2.copy(this.group.position).addScaledVector(
          _v1.set(Math.sin(this.bearing), 0, Math.cos(this.bearing)), 5);
        ctx.particles.smoke?.spawn(_v2, _v3.set(0, -1.4, 0),
          { life: 1.4, size: 0.7, drag: 1.4, gravity: -0.6, color: 0x8a8e96, alpha: 0.16 });
      }
    }
    if (this.t >= this.life) this.done = true;
  }

  /* ── something in orbit ────────────────────────────────────────────── */

  /**
   * THE COLUMN, and it is deliberately not a craft.
   *
   * Two cylinders: a thin bright core and a wide soft sheath, standing from the
   * ground to well past the top of anything on the level. It does not exist for
   * the whole lead — see `_updateLance`, which opens it in the last seconds —
   * because a beam that stood there for the entire countdown would be a light
   * fixture, and what the moment wants is something that ARRIVES.
   */
  _makeLance() {
    const H = 260;
    const core = new THREE.Mesh(
      new THREE.CylinderGeometry(0.5, 0.5, H, 10, 1, true),
      new THREE.MeshBasicMaterial({ color: 0xdff0ff, transparent: true, opacity: 0.9,
        depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending }));
    const sheath = new THREE.Mesh(
      new THREE.CylinderGeometry(3.4, 1.2, H, 12, 1, true),
      new THREE.MeshBasicMaterial({ color: 0x8fc8ff, transparent: true, opacity: 0.22,
        depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending }));
    core.frustumCulled = sheath.frustumCulled = false;
    core.renderOrder = sheath.renderOrder = 7;
    core.position.y = sheath.position.y = H * 0.5;
    this.group.add(sheath, core);
    this._core = core; this._sheath = sheath;
    this.group.position.copy(this.site);
    this.group.scale.set(0.001, 1, 0.001);
    this.life = 0;                       // set by the caller through `hold`
    this.arrive = 0;
  }

  _updateLance(dt) {
    if (this.follow) {
      const at = this.follow();
      if (at) { this.site.copy(at); this.group.position.copy(at); }
    }
    /* It opens over `SPIN_UP`, holds at full for a beat, and is gone the
     * instant the ground goes — the blast is what the player is meant to be
     * looking at, and a beam still standing in the dust afterwards would be
     * the game holding a pose. */
    const SPIN_UP = 1.1;
    const k = smoothstep(0, SPIN_UP, this.t);
    const flicker = 0.85 + Math.sin(this.t * 47) * 0.15;
    this.group.scale.set(k * flicker, 1, k * flicker);
    this._core.material.opacity = 0.9 * k;
    this._sheath.material.opacity = 0.22 * k * (0.6 + k * 0.4);
    if (this.t >= this.life) this.done = true;
  }

  /* ── the frame ─────────────────────────────────────────────────────── */

  update(dt, ctx) {
    this.t += dt;
    if (this.P.kind === 'lance') this._updateLance(dt);
    else this._updatePass(dt, ctx);
    for (const c of this.cadence) {
      if (c.done || this.t < this.arrive + c.t) continue;
      c.done = true;
      try { c.fn(this.group.position, ctx); } catch { /* a payload must never take the frame */ }
    }
  }

  remove() {
    if (this.group.parent) this.group.parent.remove(this.group);
    this.group.traverse((o) => {
      if (o.isMesh && o.geometry && o.material?.blending === THREE.AdditiveBlending) {
        o.geometry.dispose(); o.material.dispose();
      }
    });
  }
}

/**
 * EVERY RUN IN THE AIR AT ONCE.
 *
 * One per caller, built lazily by `Stratagems` because a player who never
 * spells a code should not pay for a scene group. `MAX_LIVE` is a frame-rate
 * bound and not a design one: each pass is one gunship's worth of geometry,
 * and the barrage can put three in the sky legitimately.
 */
export const MAX_LIVE = 4;

export class SortieDirector {
  constructor(world) { this.world = world; this.live = []; }

  /**
   * Launch a run. Returns the seconds until it is over the site, so the caller
   * can line a warning ring up with the thing the ring is warning about.
   */
  launch(profile, site, bearing, cadence = [], opts = {}) {
    if (this.live.length >= MAX_LIVE) {
      // The oldest goes rather than the newest being refused: the call the
      // player just made is the one they are watching for.
      this.live.shift()?.remove();
    }
    const s = new Sortie(this.world, profile, site, bearing, cadence);
    /* `hold` IS THE LANCE'S LIFE AND NOTHING ELSE. A pass computes its own from
     * the path and the speed, and `_updatePass` lerps along that path by
     * `t / life` — so writing a caller's number over it does not shorten the
     * run, it makes the craft fly the WHOLE path in that time and arrive over
     * the mark early. Measured when it did: a 3.57 s lead put the ship over the
     * site at 1.77 s, which is the payload and the craft on two clocks and is
     * the exact defect `leadOf` exists to make impossible. */
    if (opts.hold && s.P.kind === 'lance') s.life = opts.hold;
    /* A LANCE FOLLOWS WHAT IT WAS FIRED AT. See Stratagems `_designate`: the
     * designation may latch onto a BODY, and a column standing over the ground
     * that body used to be on would be the game showing the player the wrong
     * place. A `pass` never follows — a pilot on a gun run has committed to a
     * line — so the field is read only by `_updateLance`. */
    if (opts.follow) s.follow = opts.follow;
    this.live.push(s);
    return s.arrive;
  }

  /** How long a `pass` profile takes to reach its site, before it is flown. */
  static leadOf(profile) {
    const P = PROFILES[profile];
    if (!P) return 0;
    return P.kind === 'pass' ? PASS_START / P.speed : (P.fall ?? 0);
  }

  update(dt, ctx) {
    for (let i = this.live.length - 1; i >= 0; i--) {
      const s = this.live[i];
      s.update(dt, ctx);
      if (s.done) { s.remove(); this.live.splice(i, 1); }
    }
  }

  clear() { for (const s of this.live) s.remove(); this.live.length = 0; }
}
