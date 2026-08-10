/**
 * SABER — the world.
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
import { GrassField, Water, Atmosphere } from '../world/Scenery.js';
import { BoltPool } from './Bolts.js';
import { BladeContactSolver, captureSnapshot, gradeCaught, resolveBladeClash, GRADE, GRADE_NAME, DIFFICULTY, CatchWindow } from './Combat.js';
import { Player } from './Player.js';
import { Enemy, ARCHETYPES } from './Enemy.js';
import { WaveDirector } from './Waves.js';
import { LEVELS } from './Levels.js';
import { BladeLock } from './Duel.js';
import { FocusSystem } from './Focus.js';
import { DojoDirector } from './Dojo.js';
import { updateCauterisation } from './Ragdoll.js';
import { packAvatar, packSnapshot } from '../net/Net.js';
import { QUALITY } from '../engine/Engine.js';
import { clamp, lerp, damp, makeRng, TAU } from '../engine/MathUtil.js';
import { audio } from '../engine/Audio.js';

const rng = makeRng((Math.random() * 1e9) | 0);
const _v1 = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3();
const _v4 = new THREE.Vector3(), _v5 = new THREE.Vector3();

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

export class World {
  constructor(engine, settings) {
    this.engine = engine;
    this.scene = engine.scene;
    this.settings = settings;
    this.physics = new RapierWorld({ gravity: -24, iterations: 4, maxBodies: settings.maxBodies ?? 1100 });

    this.players = [];
    this.enemies = [];
    this.props = [];
    this.doors = [];
    this.debris = [];
    this.locks = [];
    this.statics = [];
    this.levelLights = [];
    this.takenBoons = new Set();

    this.timeScale = 1;
    this.focus = new FocusSystem();
    this.targetTimeScale = 1;
    this.hitstop = 0;
    this.time = 0;
    this.score = 0;
    this.combatIntensity = 0;
    this.paused = false;
    this.running = false;

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

    this.bladeSolver = new BladeContactSolver();
    this.events = [];
    this.notifications = [];

    this._targets = [];
    this._capsCache = [];
  }

  /* ── level lifecycle ─────────────────────────────────────────────── */

  loadLevel(key) {
    this.unload();
    const L = LEVELS[key] || LEVELS.dunes;
    this.level = L;
    this.levelKey = key;
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
      });
    }

    L.dress(this);

    if (L.training) {
      // the dojo runs lessons instead of waves
      this.director = new DojoDirector(this);
      this.training = true;
      this.running = true;
      return L;
    }
    this.training = false;
    this.director = new WaveDirector(this, { mode: this.settings.mode ?? 'roguelite', pool: L.pool });
    this.director.onWaveStart = (w, n) => {
      this.notify(`WAVE ${w}`, `${n} contacts inbound`);
      audio.ui('wave');
    };
    this.director.onWaveClear = (w) => {
      this.notify('WAVE CLEAR', 'the Force is with you');
      audio.ui('good');
      this.score += 500 * w;
      for (const p of this.players) { p.addFlow(0.35); p.heal(8); }
    };
    this.director.onDraft = (boons) => { this.onDraftOffer?.(boons); };

    this.running = true;
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

  spawnPlayer(opts = {}) {
    const p = new Player(this, {
      ...opts,
      colorIndex: this.settings.colorIndex,
      bladeLength: this.settings.bladeLength,
      coreWidth: this.settings.coreWidth,
      hiltStyle: this.settings.hiltStyle,
      robeIndex: this.settings.robeIndex,
      sensitivity: this.settings.sensitivity,
      followStrength: this.settings.camFollow,
      scheme: this.settings.scheme,
      spawn: opts.spawn || new THREE.Vector3(0, 0, 8),
    });
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
    this.locks.length = 0;
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
    this.running = false;
  }

  /* ── spawning ────────────────────────────────────────────────────── */

  addProp(p) { this.props.push(p); return p; }

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
      return new THREE.Vector3(x, this.terrain.height(x, z), z);
    }
    const a = rng() * TAU;
    return new THREE.Vector3(anchor.x + Math.cos(a) * rmin, 0, anchor.z + Math.sin(a) * rmin);
  }

  pickTarget(enemy) {
    let best = null, bestD = Infinity;
    for (const p of this.players) {
      if (!p.alive) continue;
      const d = p.position.distanceToSquared(enemy.position);
      if (d < bestD) { bestD = d; best = p; }
    }
    return best;
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
    this.notifications.push({ title, sub, t: 0 });
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
      const spent = this.focus.update(rawDt, input?.act('focus'), P.force, hostile);
      if (spent) P.force = Math.max(0, P.force - spent);
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

    // 2 — enemies
    for (let i = this.enemies.length - 1; i >= 0; i--) {
      const e = this.enemies[i];
      if (!e.update(dt, ctx)) { e.dispose(); this.enemies.splice(i, 1); }
    }

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
    if (this.netMode !== 'client') this.director.update(dt, ctx);
    if (this.netMode) this._netTick(rawDt);

    // 9 — intensity drives the score and the mix
    const alive = this.enemies.filter(e => !e.dead).length;
    const near = this.enemies.filter(e => !e.dead && e.position.distanceToSquared(focus) < 400).length;
    this.combatIntensity = damp(this.combatIntensity, clamp(near / 9 + alive / 26, 0, 1), 1.4, rawDt);
    audio.updateScore(rawDt, this.combatIntensity);
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

      const events = this.bladeSolver.solve(p.saber, targets, dt, { power: p.boonMods.cutPower });
      for (const ev of events) this._applyBladeEvent(p, ev, dt);
    }

    // enemy blades vs the player, and blade-on-blade
    for (const e of this.enemies) {
      if (e.dead || !e.saber || e.saber.ignition < 0.6) continue;
      if (e.lock) continue;                       // a lock owns both blades
      for (const p of this.players) {
        if (!p.alive || !p.control) continue;
        // blades meeting takes precedence over a blade meeting a body
        if (p.saber.ignition > 0.5) {
          const clash = resolveBladeClash(p.saber, e.saber);
          if (clash) { this._applyClash(p, e, clash); continue; }
        }
        // enemy blade vs the player's body
        if (e.duel && e.duel.phase === 'strike' && p.invuln <= 0) {
          _v1.copy(p.position).setY(p.position.y + 0.4);
          _v2.copy(p.position).setY(p.position.y + 1.7);
          const hit = segmentNear(e.saber.prevTip, e.saber.tip, _v1, _v2, 0.44);
          if (hit) {
            // attackDamage, NOT damage: damage() is Enemy's METHOD. The number
            // it deals was renamed out of the way precisely because the two
            // collided, and this caller was left behind — function * number is
            // NaN, and Player.damage subtracts it straight into hp.
            p.damage(e.attackDamage * e.duel.damageScale, hit, e, 'saber');
            _v3.subVectors(p.position, e.position).setY(0.3).normalize().multiplyScalar(6);
            p.velocity.add(_v3);
            this.particles.cutFlare(hit, null, e.saber.color.getHex(), 20);
            audio.cut(hit, false);
            e.duel.interrupt(0.45);
            this.addHitstop(0.05);
          }
        }
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

  _applyBladeEvent(player, ev, dt) {
    const P = this.particles;
    if (ev.type === 'clang') {
      P.sparkBurst(ev.point, null, 8, { speed: 6 });
      // A blast door presents a capsule every 0.55m, each with its own 0.12s
      // contact cooldown, so holding the blade against one fired ~24 clashes a
      // second — 72 voices, half the pool, and it buzzed. Throttle it the way
      // grind already is.
      if (this._clangSound <= 0) { this._clangSound = 0.1; audio.clash(ev.point, 0.5); }
      player.camera.addShake(0.06);
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
      player.camera.addShake(0.02);
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
      player.camera.addShake(clamp(ev.speed / 60, 0.05, 0.3));
      this.onHitmark?.(ev.point, wasAlive && e.dead ? 'kill' : 'cut', ev.bone);
    } else if (t.prop) {
      const halves = t.prop.cut(ev.point, ev.normal, ev.impulse);
      if (!halves) t.prop.shatter(ev.impulse, ev.point);
      else { for (const h of halves) this.props.push(h); }
      // Only the capsule that parted, when the target is the destruction proxy.
      // Every destructible structure in the level shares that one proxy id, so
      // the prefix sweep was resetting grind progress on every column and wall
      // in the level each time one cell came away. A real Prop is genuinely
      // gone — replaced by halves carrying new ids — so it still clears whole.
      this.bladeSolver.clearTarget(t.id, ev.cap?.structure ? ev.cap.name : null);
      P.cutFlare(ev.point, null, player.saber.color.getHex(), 18);
      audio.cut(ev.point, false);
      player.camera.addShake(0.06);
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
      duel.interrupt(0.85);
      enemy.stun(0.6);
      player.riposteTimer = 0.6 * (player.boonMods.riposteWindow ?? 1);
      player.addFlow(0.34);
      this.addHitstop(0.085);
      this.engine.flash(0.06);
      this.notifyFloating(clash.point, 'CHAMBER', '#8fe8ff');
      this.report({ type: 'chamber', enemy });
      audio.deflect(clash.point, 3);
      player.score += 160;
      player.chambers = (player.chambers || 0) + 1;
      this.onDeflectFeedback?.(4, clash.point, `chambered ${duel.attack.label}`);
      return;
    }

    // ── UNBLOCKABLE: the blade is not the answer
    if (attacking && !tier.parryable && !tier.chamberable) {
      player.control.hitImpulse(clash.point, _v1.clone().multiplyScalar(-9), 1.0);
      player.stamina = Math.max(0, player.stamina - 10);
      this.notifyFloating(clash.point, 'UNBLOCKABLE', '#ff5a62');
      this.onDeflectFeedback?.(-1, clash.point, 'that one had to be dodged');
      return;
    }

    // ── HEAVY parried flat: guard broken
    if (attacking && !tier.parryable) {
      player.control.hitImpulse(clash.point, _v1.clone().multiplyScalar(-16), 1.5);
      player.stamina = Math.max(0, player.stamina - 22 * tier.guardBreak);
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
    player.control.hitImpulse(clash.point, _v1.clone().multiplyScalar(playerWon ? -5 : -13), playerWon ? 0.6 : 1.3);
    if (playerWon) {
      if (duel) duel.interrupt(0.45);
      enemy.stun(0.18);
      player.riposteTimer = 0.42 * (player.boonMods.riposteWindow ?? 1);
      player.addFlow(0.12);
      player.score += 45;
      this.notifyFloating(clash.point, 'PARRY', '#a8f0ff');
      this.report({ type: 'parry', enemy });
      this.onDeflectFeedback?.(3, clash.point, 'riposte now');
    } else {
      player.stamina = Math.max(0, player.stamina - 14);
      if (player.stamina <= 0) player.staggerTimer = 0.6;
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
    if (bolt.team !== 0) {
      for (const p of this.players) {
        if (!p.alive || p.invuln > 0) continue;
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
      if (bolt.team === 1 && bolt.owner !== e) {
        // enemies do not shoot each other unless the bolt came back at them
        if (!bolt.deflected) continue;
      }
      if (bolt.team === 1 && !bolt.deflected) continue;
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
    this.score += A.score;
    if (source instanceof Player) {
      source.kills++;
      source.score += A.score;
      source.addFlow(kind === 'cut' ? 0.16 : 0.08);
      source.combo++;
      source.comboTimer = 3.4;
      if (source.boonMods.healOnKill) source.heal(source.boonMods.healOnKill);
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

  onPlayerDeath(player, source) {
    if (this.players.every(p => !p.alive)) {
      this.running = false;
      this.onGameOver?.({
        wave: this.director.wave,
        score: this.score,
        kills: this.players.reduce((a, p) => a + p.kills, 0),
        deflects: this.players.reduce((a, p) => a + p.deflects, 0),
        perfects: this.players.reduce((a, p) => a + p.perfects, 0),
        limbs: this.players.reduce((a, p) => a + p.limbsRemoved, 0),
      });
    }
  }

  applyBoon(boon) {
    this.takenBoons.add(boon.id);
    for (const p of this.players) p.applyBoon(boon);
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

    if (this.player) {
      const { packAvatar, packSnapshot } = this._netPack;
      net.broadcast(packAvatar(this.player));
      if (this.netMode === 'host') net.broadcast(packSnapshot(this));
    }
  }

  /** Host → client: reconcile the enemy list against the snapshot. */
  applySnapshot(msg) {
    if (this.netMode !== 'client' || !this.terrain) return;
    const seen = new Set();
    for (const rec of msg.e) {
      const [id, type, x, y, z, f, hp, dead] = rec;
      seen.add(id);
      let e = this._netEnemyIndex.get(id);
      if (!e) {
        e = this.spawnEnemy(type, new THREE.Vector3(x, y, z));
        e.id = id;
        e.netDriven = true;
        this._netEnemyIndex.set(id, e);
      }
      e.netTarget = (e.netTarget || new THREE.Vector3()).set(x, y, z);
      e.netFacing = f;
      e.hp = hp;
      if (dead && !e.dead) e.die(e.position.clone(), null, 'net');
    }
    for (const [id, e] of this._netEnemyIndex) {
      if (!seen.has(id) && !e.dead) { e.die(e.position.clone(), null, 'net'); this._netEnemyIndex.delete(id); }
    }
    this.director.wave = msg.w;
    this.director.active = !!msg.act;
    this.director._netRemaining = msg.rem;
    this.score = msg.sc;
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
  _claim(msg) {
    if (this.netMode === 'client' && this.net?.connected) this.net.toHost(msg);
  }

  applyClaim(peerId, msg) {
    if (this.netMode !== 'host') return;
    const e = this._netEnemyIndex?.get(msg.id) || this.enemies.find(x => x.id === msg.id);
    if (!e || e.dead) return;
    if (msg.k === 'cut') {
      const cap = e.capsules().find(c => c.name === msg.b);
      if (!cap) return;
      e.takeCut({
        // `ct`, NOT `t`: Net routes every message on `msg.t`, so the receiver
        // asking for the cut parameter under the same name would have read the
        // string 'claim'. Never caught because nothing ever sent one.
        bone: msg.b, cutT: msg.ct, cap, point: new THREE.Vector3(...msg.p),
        impulse: new THREE.Vector3(...msg.v), normal: new THREE.Vector3(0, 1, 0), speed: 20,
      }, null);
    } else if (msg.k === 'dmg') {
      e.damage(msg.d, new THREE.Vector3(...msg.p), null, 'remote');
    }
  }

  dispose() { this.unload(); }
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
