/**
 * SABER — arrivals.
 *
 * WHAT WAS WRONG: `WaveDirector.update` did this, and only this —
 *
 *     const pos = ctx.pickSpawn(type);
 *     const e = ctx.spawnEnemy(type, pos);
 *
 * — so every body in the game came into existence fully formed, standing on
 * the sand, 34 to 56 metres away, facing you. No vehicle, no door, no dust, no
 * warning; a wave was a list of `new Enemy(...)` calls with a timer between
 * them. On the dunes you could watch it happen: a droid was not there, and
 * then it was, and the only thing that had changed was a number in a queue.
 *
 * An arrival is the answer, and it is a THING IN THE WORLD rather than an
 * animation played on a body:
 *
 *   dropship   a gunship comes down out of the sky, flares, hovers a few
 *              metres up, drops its squad and climbs away
 *   gate       a sally port rumbles, parts, and they walk out of the dark
 *   march      they come over the far edge of the map on foot, from beyond
 *              the ring anything is normally spawned at, and walk the
 *              distance in
 *
 * ── THE INVARIANT ─────────────────────────────────────────────────────────
 *
 * Everything here exists to make one property true, and it is the property
 * tools/checks/arrivals.mjs measures:
 *
 *     NOTHING IS DELIVERED NEAR THE PLAYER UNLESS SOMETHING THE PLAYER COULD
 *     SEE HAS BEEN STANDING WHERE IT ARRIVES FOR AT LEAST `ARRIVAL_LEAD`
 *     SECONDS FIRST.
 *
 * A dropship and a gate satisfy it by being visible for seconds before they
 * deliver anything. A march satisfies it by delivering at `MARCH_RADIUS` times
 * the level's own spawn ring — far enough out that the body walks in as a
 * silhouette on the horizon, which is itself the announcement. Every delivery
 * records which of the two it passed on, so a future arrival that quietly
 * satisfies neither cannot be added without the check saying so.
 *
 * ── COSTS ─────────────────────────────────────────────────────────────────
 *
 * Every geometry and every material below is built ONCE, at module scope, and
 * shared by every arrival that ever runs — the single exception is a dropship's
 * landing wash, whose opacity is animated per ship and which is disposed with
 * it. An arrival is therefore a handful of Mesh objects and a group transform.
 *
 * That is what makes it safe that `World.unload` does not know this file
 * exists: the director parks its one persistent group in `world.statics`, the
 * list World already empties out of the scene when a level goes away, and a
 * ship caught mid-landing by a level change leaves nothing behind but shared
 * geometry that was going to be reused anyway.
 */

import * as THREE from 'three';
import { clamp, lerp, damp, smoothstep, makeRng, TAU } from '../engine/MathUtil.js';
import { audio } from '../engine/Audio.js';

const rng = makeRng(20931);
let _arrivalId = 1;
const _v1 = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);

/**
 * How long an arrival must have been standing in the world before it is
 * allowed to put a body on the ground. Three seconds is about a breath and a
 * half: long enough to look up, turn, and decide where you would rather be
 * standing when it opens.
 */
export const ARRIVAL_LEAD = 2.4;

/**
 * How far out a marching body starts, as a multiple of the level's own outer
 * spawn ring. 1.45 puts it at 45–90 m depending on the level, which is past
 * the LOD-2 threshold (62 m) on the wider ones and reads as a shape on the
 * skyline rather than a droid.
 */
export const MARCH_RADIUS = 1.45;

/** Ships and gates in flight at once. Three is a busy sky; four is a queue. */
export const MAX_CONCURRENT = 3;

/* ══════════════════════════════════════════════════════════════════════ */
/*  Shared geometry and materials — built once, for every arrival ever    */
/* ══════════════════════════════════════════════════════════════════════ */

const G = {};
const M = {};
let _built = false;

function build() {
  if (_built) return;
  _built = true;

  // ── dropship
  G.hull = new THREE.BoxGeometry(2.0, 1.15, 5.6);
  G.nose = new THREE.ConeGeometry(1.05, 2.2, 4);
  G.nose.rotateX(-Math.PI / 2);
  G.wing = new THREE.BoxGeometry(3.4, 0.22, 1.7);
  G.nacelle = new THREE.CylinderGeometry(0.42, 0.5, 1.9, 8);
  G.nacelle.rotateX(Math.PI / 2);
  G.strut = new THREE.BoxGeometry(0.18, 0.9, 0.18);
  G.glow = new THREE.SphereGeometry(0.34, 8, 6);
  // the light a ship throws down at a landing zone: a wide, soft cone
  G.wash = new THREE.ConeGeometry(3.6, 7.0, 16, 1, true);
  G.wash.translate(0, -3.5, 0);

  // ── gate
  G.pillar = new THREE.BoxGeometry(0.9, 5.0, 1.3);
  G.lintel = new THREE.BoxGeometry(6.4, 1.0, 1.5);
  G.leaf = new THREE.BoxGeometry(2.35, 4.3, 0.42);
  G.dark = new THREE.PlaneGeometry(4.7, 4.3);
  G.strip = new THREE.BoxGeometry(4.7, 0.09, 0.1);

  const solid = (color, opts = {}) => new THREE.MeshStandardMaterial({
    color, roughness: opts.roughness ?? 0.75, metalness: opts.metalness ?? 0.35, ...opts,
  });
  M.hull = solid(0x4a5058, { roughness: 0.62, metalness: 0.55 });
  M.trim = solid(0x2a2e34, { roughness: 0.5, metalness: 0.7 });
  M.stone = solid(0x8d7f66, { roughness: 0.95, metalness: 0.02 });
  M.panel = solid(0x565d68, { roughness: 0.55, metalness: 0.65 });
  M.dark = new THREE.MeshBasicMaterial({ color: 0x05070a, toneMapped: false });
  M.engine = new THREE.MeshBasicMaterial({
    color: 0x6fd0ff, toneMapped: false, transparent: true, opacity: 0.95,
    blending: THREE.AdditiveBlending, depthWrite: false });
  M.lamp = new THREE.MeshBasicMaterial({
    color: 0xffcf88, toneMapped: false, transparent: true, opacity: 0.9,
    blending: THREE.AdditiveBlending, depthWrite: false });
  M.wash = new THREE.MeshBasicMaterial({
    color: 0xffd9a0, toneMapped: false, transparent: true, opacity: 0,
    blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
  M.strip = new THREE.MeshBasicMaterial({
    color: 0xff6a4a, toneMapped: false, transparent: true, opacity: 0.85,
    blending: THREE.AdditiveBlending, depthWrite: false });
}

const mesh = (g, m, parent) => { const o = new THREE.Mesh(g, m); o.frustumCulled = false; parent.add(o); return o; };

/* ══════════════════════════════════════════════════════════════════════ */
/*  Which arrival a level gets                                            */
/* ══════════════════════════════════════════════════════════════════════ */

/**
 * Levels are grouped by what an arrival can physically be in them, which is
 * the only thing that matters here: an open sky takes a ship, a walled bowl
 * takes a door in the wall, and an interior takes a bay door.
 *
 * Keyed by the level's own `terrain` string rather than its display name, so a
 * new level built on an existing terrain inherits the right arrival instead of
 * silently falling through to the default.
 */
export const ARRIVAL_BY_TERRAIN = {
  // Two ships to one march on the open levels: a march is honest but it is
  // also 80–100 m of walking before the body is in the fight, and a wave made
  // mostly of them is a wave you spend watching. Weighted by repetition rather
  // than by a probability table so the whole model is one literal you can read.
  meadow: ['dropship', 'dropship', 'march'],
  drifts: ['dropship', 'dropship', 'march'],
  alpine: ['dropship', 'dropship', 'march'],
  dunes: ['dropship', 'dropship', 'march'],
  canyon: ['dropship', 'dropship', 'march'],
  arena: ['gate'],
  hangar: ['gate'],
};

/** Bodies too big to fit in anything: they walk. */
const walksIn = (A) => !!(A && (A.big || A.boss));

/**
 * Pick the arrival for one body.
 * @param level  the LEVELS entry (needs `terrain`; `sky:false` marks interiors)
 * @param A      the archetype
 */
export function arrivalKindFor(level, A, roll = rng) {
  if (walksIn(A)) return 'march';
  const kinds = ARRIVAL_BY_TERRAIN[level?.terrain] || ['march'];
  // A gate level has no sky to fly a ship through, so its list is a single
  // entry and this returns it every time; open levels alternate.
  return kinds[Math.floor(roll() * kinds.length) % kinds.length];
}

/** How many bodies one arrival of this kind carries. */
export function capacityOf(kind) {
  return kind === 'dropship' ? 4 : kind === 'gate' ? 5 : 1;
}

/* ══════════════════════════════════════════════════════════════════════ */
/*  One arrival                                                           */
/* ══════════════════════════════════════════════════════════════════════ */

class Arrival {
  /**
   * @param world    the World (scene, terrain, particles, groundColor)
   * @param kind     'dropship' | 'gate' | 'march'
   * @param at       where the bodies are to be delivered, on the ground
   * @param toward   the point the arrival should face (the player)
   * @param parent   the director's persistent group
   */
  constructor(world, kind, at, toward, parent) {
    build();
    this.world = world;
    this.kind = kind;
    this.id = 'a' + (_arrivalId++);
    this.at = at.clone();
    this.age = 0;
    this.done = false;
    this.manifest = [];        // { type, mod }
    this.delivered = 0;
    this.releaseTimer = 0;
    this.group = new THREE.Group();
    this.group.frustumCulled = false;
    parent.add(this.group);

    this.yaw = Math.atan2(toward.x - at.x, toward.z - at.z);
    this[`_make${kind[0].toUpperCase()}${kind.slice(1)}`]?.();
  }

  get capacity() { return capacityOf(this.kind); }
  get full() { return this.manifest.length >= this.capacity; }
  get pending() { return this.manifest.length - this.delivered; }
  /** Seconds before this arrival will put its first body down. */
  get openAt() { return this.kind === 'dropship' ? 3.6 : this.kind === 'gate' ? 2.6 : 0; }

  add(type, mod) { this.manifest.push({ type, mod }); }

  /* ── the ship ──────────────────────────────────────────────────────── */

  _makeDropship() {
    const g = this.group;
    const hull = mesh(G.hull, M.hull, g);
    hull.castShadow = true;
    const nose = mesh(G.nose, M.hull, g); nose.position.z = -3.6;
    for (const s of [-1, 1]) {
      const w = mesh(G.wing, M.trim, g);
      w.position.set(s * 2.4, -0.1, 0.7);
      w.rotation.z = s * 0.16;
      const n = mesh(G.nacelle, M.trim, g);
      n.position.set(s * 3.3, -0.16, 0.9);
      const fire = mesh(G.glow, M.engine, g);
      fire.position.set(s * 3.3, -0.16, 1.9);
      fire.scale.set(0.8, 0.8, 1.5);
      this[`_fire${s > 0 ? 'R' : 'L'}`] = fire;
      const strut = mesh(G.strut, M.trim, g);
      strut.position.set(s * 1.0, -0.95, 1.4);
    }
    const lamp = mesh(G.glow, M.lamp, g);
    lamp.position.set(0, -0.5, -2.8);
    lamp.scale.setScalar(0.45);
    this._lamp = lamp;

    // the light and the dust it throws at the ground while it hovers
    this._wash = new THREE.Mesh(G.wash, M.wash.clone());
    this._wash.frustumCulled = false;
    this._wash.renderOrder = 6;
    g.add(this._wash);

    // the flight path: in from beyond the ring, high and fast, flaring to a
    // hover over the drop point
    const away = _v1.set(Math.sin(this.yaw), 0, Math.cos(this.yaw)).multiplyScalar(-1);
    this.hover = this.at.clone().setY(this.at.y + 5.6);
    this.start = this.at.clone().addScaledVector(away, 88).setY(this.at.y + 38);
    this.exit = this.at.clone().addScaledVector(away, -70).setY(this.at.y + 46);
    this.group.position.copy(this.start);
    audio.noise({ dur: 2.6, gain: 0.09, type: 'bandpass', freq: 260, q: 0.9, pos: this.start });
  }

  _updateDropship(dt, ctx) {
    const t = this.age;
    const g = this.group;
    const IN = 3.6;                                  // arrive
    const out = IN + 0.35 * this.manifest.length + 0.9;
    if (t < IN) {
      // ease in and flare: fast and high, then slow and low
      const k = smoothstep(0, 1, t / IN);
      g.position.lerpVectors(this.start, this.hover, k * k * (3 - 2 * k));
      g.position.y = lerp(this.start.y, this.hover.y, smoothstep(0, 1, Math.pow(k, 0.72)));
    } else if (t < out) {
      // hold, with the small drift a hovering thing has
      g.position.x = damp(g.position.x, this.hover.x, 3, dt);
      g.position.z = damp(g.position.z, this.hover.z, 3, dt);
      g.position.y = this.hover.y + Math.sin(t * 2.6) * 0.10;
    } else {
      const k = clamp((t - out) / 3.4, 0, 1);
      g.position.lerpVectors(this.hover, this.exit, k * k);
      if (k >= 1) this.done = true;
    }
    // nose into the flight direction, level over the pad
    const banking = t < IN ? clamp((IN - t) / IN, 0, 1) * 0.35 : 0;
    g.rotation.set(banking * 0.6, this.yaw + Math.PI, 0);

    const low = 1 - clamp((g.position.y - this.at.y) / 16, 0, 1);
    const w = this._wash;
    w.position.set(0, -0.6, 0);
    w.material.opacity = low * 0.16;
    w.scale.setScalar(lerp(0.55, 1, low));
    const flare = 0.8 + Math.sin(t * 31) * 0.12;
    if (this._fireL) this._fireL.scale.set(0.8 * flare, 0.8 * flare, 1.5 * flare);
    if (this._fireR) this._fireR.scale.set(0.8 * flare, 0.8 * flare, 1.5 * flare);

    // sand off the pad while it is down
    if (low > 0.5 && ctx.particles && rng() < 0.5) {
      const a = rng() * TAU, r = 1.2 + rng() * 2.6;
      _v2.set(this.at.x + Math.cos(a) * r, this.at.y, this.at.z + Math.sin(a) * r);
      ctx.particles.sandPuff(_v2.clone(), 0.5 + rng() * 0.5, this.at.y, this.world.groundColor);
    }
    return t >= IN && t < out;
  }

  /** Where a dropship puts a body: under its belly, in the air. */
  _dropPoint(out) {
    return out.copy(this.group.position).setY(this.group.position.y - 1.5);
  }

  /* ── the gate ──────────────────────────────────────────────────────── */

  _makeGate() {
    const g = this.group;
    g.position.copy(this.at);
    g.rotation.y = this.yaw;
    const interior = this.world.level?.atmosphere?.sky === false;
    const body = interior ? M.panel : M.stone;
    for (const s of [-1, 1]) {
      const p = mesh(G.pillar, body, g);
      p.position.set(s * 2.85, 2.5, 0);
      p.castShadow = true;
    }
    const lintel = mesh(G.lintel, body, g);
    lintel.position.set(0, 5.4, 0);
    lintel.castShadow = true;
    // the dark behind the doors, so an open gate reads as a way IN somewhere
    const dark = mesh(G.dark, M.dark, g);
    dark.position.set(0, 2.15, -0.3);
    this._leaves = [];
    for (const s of [-1, 1]) {
      const l = mesh(G.leaf, interior ? M.panel : M.trim, g);
      l.position.set(s * 1.175, 2.15, 0);
      l.castShadow = true;
      this._leaves.push(l);
    }
    const strip = mesh(G.strip, M.strip, g);
    strip.position.set(0, 4.55, 0.35);
    this._strip = strip;
    audio.noise({ dur: 1.8, gain: 0.13, type: 'lowpass', freq: 180, q: 0.7, pos: this.at });
  }

  _updateGate(dt, ctx) {
    const t = this.age;
    const OPEN = 1.1, WIDE = 2.6;
    const shut = WIDE + 0.5 * this.manifest.length + 1.4;
    let k;
    if (t < OPEN) k = 0;                                        // rumble first
    else if (t < WIDE) k = smoothstep(0, 1, (t - OPEN) / (WIDE - OPEN));
    else if (t < shut) k = 1;
    else k = 1 - smoothstep(0, 1, clamp((t - shut) / 1.3, 0, 1));
    if (this._leaves) {
      this._leaves[0].position.x = -1.175 - k * 1.62;
      this._leaves[1].position.x = 1.175 + k * 1.62;
    }
    // the dust a heavy door shakes loose
    if (t < WIDE && ctx.particles && rng() < 0.35) {
      _v2.set(this.at.x + (rng() - 0.5) * 5.4, this.at.y, this.at.z);
      ctx.particles.sandPuff(_v2.clone(), 0.3, this.at.y, this.world.groundColor);
    }
    if (t > shut + 1.6) this.done = true;
    return t >= WIDE && t < shut;
  }

  /** Where a gate puts a body: in the doorway, on its feet. */
  _gatePoint(out) {
    return out.copy(this.at).addScaledVector(
      _v3.set(Math.sin(this.yaw), 0, Math.cos(this.yaw)), 0.8);
  }

  /* ── the long walk ─────────────────────────────────────────────────── */

  _makeMarch() {
    // Nothing is built. The body IS the arrival: it is put down beyond the
    // ring anything is normally spawned at and walks the whole way in, which
    // is the one arrival that needs no vehicle to be honest.
    this.group.visible = false;
  }

  _updateMarch() {
    if (this.delivered >= this.manifest.length) this.done = true;
    return true;
  }

  /* ── the frame ─────────────────────────────────────────────────────── */

  update(dt, ctx, deliver) {
    this.age += dt;
    const open = this.kind === 'dropship' ? this._updateDropship(dt, ctx)
               : this.kind === 'gate' ? this._updateGate(dt, ctx)
               : this._updateMarch(dt, ctx);
    if (!open || this.delivered >= this.manifest.length) return;

    this.releaseTimer -= dt;
    if (this.releaseTimer > 0) return;
    this.releaseTimer = this.kind === 'dropship' ? 0.35 : this.kind === 'gate' ? 0.5 : 0;

    const slot = this.manifest[this.delivered];
    const point = this.kind === 'dropship' ? this._dropPoint(_v1)
                : this.kind === 'gate' ? this._gatePoint(_v1)
                : _v1.copy(this.at);
    const e = deliver(slot.type, slot.mod, point, this);
    this.delivered++;
    if (!e) return;

    if (this.kind === 'dropship') {
      // dropped, not placed: it falls the last few metres and lands on its own
      // feet, with the same puff every other hard landing in the game makes
      e.position.copy(point);
      e.grounded = false;
      e.velocity.set((rng() - 0.5) * 1.2, -1.5, (rng() - 0.5) * 1.2);
      e.facing = this.yaw;
      audio.thud(point, 0.5);
    } else if (this.kind === 'gate') {
      e.facing = this.yaw;
    }
  }

  remove() {
    this.group.parent?.remove(this.group);
    // The one per-arrival allocation in the file: the wash cone's opacity is
    // animated, so it cannot be the shared material. It goes with the arrival.
    this._wash?.material.dispose();
    this._wash = null;
  }
}

/* ══════════════════════════════════════════════════════════════════════ */
/*  The director                                                          */
/* ══════════════════════════════════════════════════════════════════════ */

export class ArrivalDirector {
  /**
   * @param world  the World
   * @param spawn  (type, mod, position) => Enemy — the ONE door into the game,
   *               kept as a callback so this file never has to know about
   *               World.spawnEnemy or the modifier table.
   * @param archetypes  the ARCHETYPES table, passed in for the same reason and
   *               taken once rather than spread into a fresh ctx every frame.
   */
  constructor(world, spawn, archetypes = {}) {
    this.world = world;
    this.spawn = spawn;
    this.archetypes = archetypes;
    this.flights = [];
    this.staging = [];
    /** Every body ever put down, and how it was announced. See the invariant. */
    this.log = [];
    this.enabled = true;
    this.group = new THREE.Group();
    this.group.name = 'arrivals';
    this.group.frustumCulled = false;
    world.scene?.add(this.group);
    // World.unload empties `statics` out of the scene; parking the group there
    // is how an arrival in flight when a level ends stops being in the next one.
    world.statics?.push(this.group);
  }

  /** Bodies queued or in the air — a wave is not clear while this is nonzero. */
  get pending() {
    let n = this.staging.length;
    for (const f of this.flights) n += f.pending;
    return n;
  }

  /**
   * Ask for one body. It is delivered later, by something you can watch.
   * Returns false if arrivals are off, in which case the caller spawns
   * directly — a level with no arrival for its terrain still has to work.
   */
  request(type, mod = null) {
    if (!this.enabled) return false;
    this.staging.push({ type, mod });
    return true;
  }

  /** How far out the level puts things, and therefore how far out a march is. */
  _ring() {
    const [, rmax] = this.world.level?.spawnRadius || [34, 56];
    return rmax;
  }

  _anchor(out) {
    const p = this.world.player;
    return out.copy(p ? p.position : _v3.set(0, 0, 0));
  }

  /** Ground a point on the level's own terrain. */
  _ground(p) {
    const t = this.world.terrain;
    p.y = t ? t.height(p.x, p.z) : 0;
    return p;
  }

  /**
   * A landing site between two radii.
   *
   * The band is a MINIMUM and a maximum rather than a centre and a jitter,
   * because for a march the minimum is load-bearing: the whole reason a body
   * that simply appears and walks is an acceptable arrival is that it appears
   * beyond the ring anything else is spawned at. A symmetric jitter around
   * `ring × MARCH_RADIUS` put a quarter of them back inside it — measured, at
   * 77.6 m against an 80.9 m floor — and those are exactly the ones that read
   * as popping in.
   */
  _sitePoint(rMin, rMax, out) {
    const t = this.world.terrain;
    this._anchor(out);
    const ax = out.x, az = out.z;
    for (let i = 0; i < 20; i++) {
      const a = rng() * TAU;
      const r = lerp(rMin, rMax, rng());
      const x = ax + Math.cos(a) * r, z = az + Math.sin(a) * r;
      if (t && !t.inBounds(x, z, 10)) continue;
      if (t && t.slopeAt && t.slopeAt(x, z) > 0.5) continue;
      return this._ground(out.set(x, 0, z));
    }
    const a = rng() * TAU;
    return this._ground(out.set(ax + Math.cos(a) * rMin, 0, az + Math.sin(a) * rMin));
  }

  _open(kind, A) {
    const anchor = this._anchor(new THREE.Vector3());
    const ring = this._ring();
    const at = kind === 'march'
      ? this._sitePoint(ring * MARCH_RADIUS, ring * MARCH_RADIUS * 1.14, new THREE.Vector3())
      : this._sitePoint(ring * 0.72, ring * 0.94, new THREE.Vector3());
    const f = new Arrival(this.world, kind, at, anchor, this.group);
    this.flights.push(f);
    return f;
  }

  update(dt, ctx) {
    // fill flights from the staging list
    while (this.staging.length && this.flights.filter(f => !f.done).length < MAX_CONCURRENT) {
      const slot = this.staging[0];
      const A = this.archetypes[slot.type];
      const kind = arrivalKindFor(this.world.level, A, rng);
      // an existing flight of the right kind with room takes it, so a squad
      // rides in together instead of one ship per droid
      let f = this.flights.find(x => !x.done && x.kind === kind && !x.full && x.age < x.openAt * 0.6);
      if (!f) f = this._open(kind, A);
      f.add(slot.type, slot.mod);
      this.staging.shift();
    }

    for (let i = this.flights.length - 1; i >= 0; i--) {
      const f = this.flights[i];
      f.update(dt, ctx, (type, mod, point, arrival) => this._deliver(type, mod, point, arrival));
      if (f.done) { f.remove(); this.flights.splice(i, 1); }
    }
  }

  _deliver(type, mod, point, arrival) {
    const e = this.spawn(type, mod, point);
    const anchor = this._anchor(_v2);
    this.log.push({
      kind: arrival.kind,
      flight: arrival.id,
      lead: arrival.age,
      dist: Math.hypot(point.x - anchor.x, point.z - anchor.z),
      type,
    });
    if (this.log.length > 200) this.log.shift();
    return e;
  }

  /** Drop everything — a wave reset, a level change, a run ending. */
  clear() {
    for (const f of this.flights) f.remove();
    this.flights.length = 0;
    this.staging.length = 0;
  }

  dispose() {
    this.clear();
    this.group.parent?.remove(this.group);
  }
}

/**
 * Does one delivery satisfy the invariant at the top of this file?
 *
 * Exported because it is the property, and a property that only exists inside
 * a test is a property the game does not have. Anything that adds a new
 * arrival kind is answerable to this function.
 */
export function deliveryIsAnnounced(entry, ring = 56) {
  return entry.lead >= ARRIVAL_LEAD || entry.dist >= ring * MARCH_RADIUS * 0.9;
}
