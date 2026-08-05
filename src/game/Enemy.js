/**
 * SABER — enemies.
 *
 * Everything here respects the same rules the player does: real limbs on a
 * real skeleton, real ragdolls, real cuts wherever the blade crossed. A droid
 * whose leg comes off falls over because it has no leg, not because it played
 * the falling-over animation.
 */

import * as THREE from 'three';
import { Actor } from './Ragdoll.js';
import { Rig, BipedAnimator, aimY } from './Rig.js';
import { buildB1, buildB2, buildTrooper, buildAcolyte, buildDroideka, buildWalker, buildBeast, buildBlaster } from './Bodies.js';
import { Saber } from './Saber.js';
import { DuelBrain, Telegraph, FORMS, FORM_KEYS, TIER } from './Duel.js';
import { buildRemote } from './Dojo.js';
import { attachCloak } from './Cloth.js';
import { LAYER, Body, capsuleSpheres } from '../physics/Physics.js';
import { TOUGHNESS } from './Combat.js';
import { BOLT_COLORS } from './Bolts.js';
import { clamp, lerp, damp, smoothstep, makeRng, TAU, dampVec } from '../engine/MathUtil.js';
import { audio } from '../engine/Audio.js';

const rng = makeRng(4711);
const _v1 = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3();
const _v4 = new THREE.Vector3(), _v5 = new THREE.Vector3(), _v6 = new THREE.Vector3();
const _q1 = new THREE.Quaternion(), _q2 = new THREE.Quaternion();
const UP = new THREE.Vector3(0, 1, 0);

let _enemyId = 1;

/* ── archetypes ──────────────────────────────────────────────────────── */

export const ARCHETYPES = {
  b1: {
    label: 'B1 Battle Droid', build: buildB1, scale: 1.02, hp: 28, mass: 52,
    speed: 3.5, toughness: TOUGHNESS.droid, ranged: true, weapon: 'e5',
    fireRate: 1.5, burst: 3, burstGap: 0.13, spread: 0.075, damage: 9,
    preferred: [7, 15], boltColor: BOLT_COLORS.red, score: 100, threat: 1,
    voice: 'droid', hipHeight: 0.96,
  },
  b2: {
    label: 'B2 Super Battle Droid', build: buildB2, scale: 1.18, hp: 96, mass: 130,
    speed: 2.6, toughness: TOUGHNESS.armour, ranged: true, weapon: null,
    fireRate: 1.9, burst: 4, burstGap: 0.1, spread: 0.05, damage: 13,
    preferred: [6, 13], boltColor: BOLT_COLORS.red, score: 300, threat: 3,
    armored: true, hipHeight: 1.1,
  },
  trooper: {
    label: 'Clone Trooper', build: buildTrooper, scale: 1.0, hp: 46, mass: 78,
    speed: 4.1, toughness: TOUGHNESS.plastoid, ranged: true, weapon: 'dc15',
    fireRate: 1.35, burst: 3, burstGap: 0.11, spread: 0.045, damage: 12,
    preferred: [9, 19], boltColor: BOLT_COLORS.blue, score: 180, threat: 2,
    grenades: true, hipHeight: 0.95,
  },
  sniper: {
    label: 'Marksman', build: buildTrooper, scale: 1.0, hp: 38, mass: 76,
    speed: 3.6, toughness: TOUGHNESS.plastoid, ranged: true, weapon: 'dc15',
    fireRate: 3.4, burst: 1, spread: 0.004, damage: 34, telegraph: 1.0,
    preferred: [22, 42], boltColor: BOLT_COLORS.gold, score: 320, threat: 3,
    trooperColor: 0x2c3038, accent: 0xff9a20, hipHeight: 0.95,
  },
  acolyte: {
    label: 'Sith Acolyte', build: buildAcolyte, scale: 1.04, hp: 130, mass: 82,
    speed: 5.0, toughness: TOUGHNESS.flesh, melee: true, saber: true,
    saberColor: 4, damage: 26, preferred: [1.6, 3.4], score: 700, threat: 6,
    hipHeight: 0.97,
  },
  droideka: {
    label: 'Droideka', build: buildDroideka, scale: 1.5, hp: 170, mass: 210,
    speed: 3.0, toughness: TOUGHNESS.armour, ranged: true, custom: 'droideka',
    fireRate: 0.72, burst: 6, burstGap: 0.07, spread: 0.055, damage: 8,
    preferred: [8, 16], boltColor: 0x66ff99, score: 550, threat: 5, shield: true,
  },
  walker: {
    label: 'Spider Walker', build: buildWalker, scale: 2.4, hp: 620, mass: 900,
    speed: 2.4, toughness: TOUGHNESS.heavy, ranged: true, custom: 'walker',
    fireRate: 2.6, burst: 2, burstGap: 0.22, spread: 0.03, damage: 26, big: true,
    preferred: [12, 26], boltColor: BOLT_COLORS.gold, score: 1600, threat: 12,
  },
  /* ── dojo only ── */
  remote: {
    label: 'Training Remote', build: buildRemote, scale: 1.0, hp: 4, mass: 3,
    speed: 2.6, toughness: TOUGHNESS.plastoid, ranged: true, custom: 'remote',
    fireRate: 2.0, burst: 1, spread: 0.02, damage: 3, float: 1.55,
    preferred: [4.5, 7.5], boltColor: 0xffc040, score: 0, threat: 0, training: true,
  },
  dummy: {
    label: 'Training Droid', build: buildB1, scale: 1.02, hp: 999, mass: 52,
    speed: 0, toughness: TOUGHNESS.droid, inert: true,
    preferred: [0, 0], score: 0, threat: 0, training: true,
  },
  sparring: {
    label: 'Sparring Partner', build: buildAcolyte, scale: 1.04, hp: 400, mass: 82,
    speed: 3.4, toughness: TOUGHNESS.flesh, melee: true, saber: true,
    saberColor: 1, hilt: 'Guardian', damage: 3, preferred: [1.6, 3.2],
    score: 0, threat: 0, training: true,
  },

  beast: {
    label: 'Acklay', build: buildBeast, scale: 2.9, hp: 900, mass: 1400,
    speed: 4.6, toughness: TOUGHNESS.flesh, melee: true, custom: 'beast',
    damage: 42, preferred: [2.5, 5], score: 2400, threat: 16, boss: true,
  },
};

/* ══════════════════════════════════════════════════════════════════════ */
/*  Enemy                                                                 */
/* ══════════════════════════════════════════════════════════════════════ */

export class Enemy {
  constructor(world, type, spawn) {
    const A = ARCHETYPES[type] || ARCHETYPES.b1;
    this.id = 'e' + (_enemyId++);
    this.type = type;
    this.A = A;
    this.world = world;
    this.team = 1;
    this.dead = false;
    this.dying = 0;
    this.grippable = !A.big && !A.boss;
    this.gripped = false;
    this.liftTarget = null;

    const diff = world.difficulty;
    this.hp = A.hp * (world.hpScale ?? 1);
    this.maxHp = this.hp;
    this.speed = A.speed * (0.9 + rng() * 0.2) * (diff ? lerp(0.86, 1.12, diff.enemyAggression / 1.25) : 1);
    this.damage = A.damage * (world.dmgScale ?? 1);

    this.position = spawn.clone();
    this.position.y = world.terrain ? world.terrain.height(spawn.x, spawn.z) : 0;
    this.velocity = new THREE.Vector3();
    this.facing = rng() * TAU;
    this.grounded = true;
    this.knockTimer = 0;
    this.stunTimer = 0;
    this.attackTimer = rng() * 1.2;
    this.burstLeft = 0;
    this.burstTimer = 0;
    this.aimCharge = 0;
    this.state = 'approach';
    this.stateTime = 0;
    this.bossPhase = 1;
    this.recentDamage = 0;
    this.windTimer = 0;
    this.strafeDir = rng() < 0.5 ? 1 : -1;
    this.strafeTimer = rng() * 2;
    this.target = null;
    this.lastSeen = 0;
    this.lod = 0;

    this._build();

    // movement proxy so bodies and players collide with a living enemy
    const r = A.big ? 1.1 : 0.36;
    this.radius = r;
    this.body = new Body({
      position: this.position.clone().setY(this.position.y + (A.big ? 1.4 : 0.9)),
      spheres: capsuleSpheres(A.big ? 0.9 : 0.55, r, 'y', 3),
      mass: A.mass, kinematic: true, layer: LAYER.ENEMY,
      mask: LAYER.WORLD, allowSleep: false, gravityScale: 0,
    });
    this.body.userData.enemy = this;
    world.physics.add(this.body);

    this._caps = [];
    this._capsDirty = true;
  }

  _build() {
    const A = this.A;
    const opts = { scale: A.scale };
    if (this.type === 'sniper') { opts.color = A.trooperColor; opts.accent = A.accent; }
    const built = A.build(opts);
    this.built = built;

    if (built.rig) {
      this.rig = built.rig;
      this.world.scene.add(this.rig.root);
      this.actor = new Actor(this.world.scene, this.world.physics, this.rig, {
        mass: A.mass, layer: LAYER.RAGDOLL, bladeColor: 0x57c9ff,
        onSever: (bone, point) => this._onSever(bone, point),
      });
      this.humanoid = !A.custom || A.custom === 'humanoid';
      if (this.humanoid) {
        this.animator = new BipedAnimator(this.rig, { scale: A.scale, hipHeight: A.hipHeight ?? 0.95 });
        this.animator.onFootstep = (p) => {
          if (this.lod > 1) return;
          audio.step(p, this.world.terrain ? this.world.terrain.surfaceAt(p.x, p.z) : 'sand');
          this.world.particles?.sandPuff(p.clone(), 0.16, p.y, this.world.groundColor);
        };
      } else {
        this.walkPhase = rng();
        this.legTargets = [];
      }
    } else {
      // droideka / training remote: a bespoke group rather than a bone rig
      this.group = built.group;
      this.world.scene.add(this.group);
      if (A.custom === 'remote') {
        this.hoverPhase = rng() * TAU;
        this.orbitPhase = rng() * TAU;
      }
    }

    // weapon
    if (A.weapon) {
      this.weapon = buildBlaster(A.weapon);
      const hand = this.rig?.get('handR');
      if (hand) { hand.obj.add(this.weapon); this.weapon.position.set(0, 0.06 * A.scale, 0.02); this.weapon.rotation.x = -0.2; }
    }
    if (A.saber) {
      this.saber = new Saber(this.world.scene, {
        colorIndex: A.saberColor ?? 4, bladeLength: 1.12, hiltStyle: A.hilt ?? 'Sentinel',
      });
      this.saber.ignite();
      this.hum = audio.createHum(this.saber.color.getHex());
      this.hum.ignite();
      this.telegraphArc = new Telegraph(this.world.scene);
      this.duel = new DuelBrain(this, {
        form: A.form || FORM_KEYS[Math.floor(rng() * FORM_KEYS.length)],
        telegraph: this.telegraphArc,
      });
      this.formName = this.duel.describe();
      this.saberHand = new THREE.Vector3();
      this.saberQuat = new THREE.Quaternion();
      this.cloak = attachCloak(this.world.scene, this.rig, {
        scale: A.scale, width: 0.34, length: 0.82, cols: 7, rows: 9, flare: 1.0,
        color: this.type === 'sparring' ? 0x2c3742 : 0x14151a,
      });
    }
    if (A.shield) {
      this.shieldUp = false;
      this.shieldHp = 260;
      this.shieldMax = 260;
      this.deployTimer = 0;
    }
  }

  /* ── queries ─────────────────────────────────────────────────────── */

  aimPoint(out = new THREE.Vector3()) {
    if (this.rig && !this.actor?.ragdolled) return this.rig.worldPos('chest', out);
    if (this.group) return out.copy(this.group.position).addScaledVector(UP, 0.8 * this.A.scale);
    return out.copy(this.position).setY(this.position.y + 1.1 * this.A.scale);
  }

  get chestY() { return this.position.y + 1.15 * this.A.scale; }

  /** Capsules the blade solver tests against — one per living bone. */
  capsules() {
    const out = this._caps;
    out.length = 0;
    if (this.dead && !this.actor?.ragdolled) return out;

    if (this.rig) {
      for (const b of this.rig.list) {
        if (b.severed || !b.parts.length) continue;
        if (this.actor?.ragdolled) {
          const body = this.actor.bodies.get(b.name);
          if (!body) continue;
          const len = b.length * b.cutT;
          _v1.set(0, -len / 2, 0).applyQuaternion(body.quaternion).add(body.position);
          _v2.set(0, len / 2, 0).applyQuaternion(body.quaternion).add(body.position);
        } else {
          b.obj.updateMatrixWorld(false);
          _v1.setFromMatrixPosition(b.obj.matrixWorld);
          _q1.setFromRotationMatrix(b.obj.matrixWorld);
          _v2.copy(_v1).add(_v3.set(0, b.length * b.cutT, 0).applyQuaternion(_q1));
        }
        out.push({
          name: b.name, p0: _v1.clone(), p1: _v2.clone(), r: b.radius * 1.12,
          toughness: this._boneToughness(b.name), enemy: this, vital: VITAL[b.name] ?? 0.4,
        });
      }
    } else if (this.group && this.A.custom === 'remote') {
      const c = _v1.copy(this.group.position);
      out.push({ name: 'core', p0: c.clone(), p1: c.clone(), r: 0.14 * this.A.scale,
        toughness: this.A.toughness, enemy: this, vital: 1 });
    } else if (this.group) {
      // droideka: shield first, then the core
      const c = _v1.copy(this.group.position).addScaledVector(UP, 0.62 * this.A.scale);
      if (this.shieldUp) {
        out.push({ name: 'shield', p0: c.clone(), p1: c.clone(),
          r: 1.15 * this.A.scale, toughness: TOUGHNESS.heavy, enemy: this, shield: true });
      }
      out.push({ name: 'core', p0: c.clone(), p1: c.clone().setY(c.y + 0.3 * this.A.scale),
        r: 0.34 * this.A.scale, toughness: this.A.toughness, enemy: this, vital: 1 });
      for (const leg of (this.built.legs || [])) {
        leg.leg.getWorldPosition(_v2);
        leg.lower.getWorldPosition(_v3);
        out.push({ name: 'leg' + this.built.legs.indexOf(leg), p0: _v2.clone(), p1: _v3.clone(),
          r: 0.12 * this.A.scale, toughness: this.A.toughness, enemy: this, vital: 0.2 });
      }
    }
    return out;
  }

  _boneToughness(name) {
    const A = this.A;
    if (A.armored && (name === 'chest' || name === 'spine' || name === 'hips')) return TOUGHNESS.heavy;
    if (A.custom === 'walker' && (name === 'body' || name === 'hips')) return TOUGHNESS.durasteel;
    if (A.custom === 'beast' && name === 'body') return TOUGHNESS.heavy;
    return A.toughness;
  }

  /* ── damage ──────────────────────────────────────────────────────── */

  damage(amount, point, source, kind) {
    if (this.dead) return false;
    if (this.invincible) return false;
    if (this.shieldUp && kind !== 'melee') {
      this.shieldHp -= amount;
      this.built.shieldMat.uniforms.uPower.value = 1.4;
      if (this.shieldHp <= 0) this.dropShield();
      return false;
    }
    this.hp -= amount;
    if (this.A.boss) this.recentDamage = (this.recentDamage || 0) + amount;
    if (this.hp <= 0) { this.die(point, source, kind); return true; }
    if (amount > this.maxHp * 0.22) this.stun(0.28);
    return false;
  }

  /** A blade crossed a limb. */
  takeCut(ev, source) {
    if (this.dead && !this.actor) return;
    const bone = ev.bone;
    const vital = ev.cap.vital ?? 0.4;

    if (ev.cap.shield) { this.dropShield(); return; }

    if (this.actor) {
      const impulse = _v1.copy(ev.impulse).multiplyScalar(0.35);
      if (this.actor.ragdolled) this.actor.cutRagdoll(bone, impulse);
      else this.actor.cut(bone, ev.cutT, impulse, ev.point, { spin: 1.2 });
      this.world.onLimbSevered?.(this, bone, ev.point, source);
    } else if (this.group) {
      this._cutDroideka(bone, ev, source);
    }

    const lethal = vital >= 0.9 || (vital >= 0.7 && this.hp < this.maxHp * 0.55);
    const dmg = lethal ? this.maxHp * 2 : this.maxHp * vital * 1.15;
    this.hp -= dmg;
    if (this.hp <= 0) this.die(ev.point, source, 'cut');
    else {
      this.stun(0.4);
      this._loseLimbBehaviour(bone);
    }
  }

  _loseLimbBehaviour(bone) {
    // walking on a severed leg does not work
    if (/thigh|shin|foot|femur|tibia|tarsus/.test(bone)) {
      this.legsLost = (this.legsLost || 0) + 1;
      if (this.legsLost >= (this.A.custom === 'walker' || this.A.custom === 'beast' ? 3 : 1)) {
        this.topple();
      }
    }
    if (/arm|fore|hand/.test(bone)) {
      this.armsLost = (this.armsLost || 0) + 1;
      if (this.armsLost >= 1 && (this.A.ranged || this.A.saber)) {
        this.disarmed = true;
        if (this.weapon) { this.weapon.parent?.remove(this.weapon); this.weapon = null; }
        if (this.saber) { this.saber.retract(); }
      }
    }
    if (bone === 'head' || bone === 'neck') { this.blinded = true; this.hp = Math.min(this.hp, this.maxHp * 0.1); }
  }

  _onSever(bone, point) {
    const p = this.world.particles;
    if (p) {
      p.cutFlare(point, null, 0x57c9ff, this.A.big ? 44 : 26);
      if (/droid|b1|b2|walker|droideka/.test(this.type)) p.sparkBurst(point, null, 22, { speed: 8 });
    }
    audio.cut(point, this.A.big);
  }

  _cutDroideka(name, ev, source) {
    const idx = parseInt(name.replace('leg', ''), 10);
    if (!isNaN(idx) && this.built.legs[idx] && !this.built.legs[idx].gone) {
      const leg = this.built.legs[idx];
      leg.gone = true;
      leg.leg.getWorldPosition(_v1);
      const mesh = leg.leg;
      mesh.parent.remove(mesh);
      this.world.spawnDebrisGroup(mesh, _v1, ev.impulse.clone().multiplyScalar(0.3), 0.4);
      this.legsLost = (this.legsLost || 0) + 1;
      if (this.legsLost >= 2) this.topple();
    }
  }

  topple() {
    if (this.toppled || this.dead) return;
    this.toppled = true;
    this.stun(9999);
    if (this.actor && !this.actor.ragdolled) {
      this.actor.goRagdoll(this.velocity.clone(), _v1.set((rng() - .5) * 4, 0, (rng() - .5) * 4));
      this.world.physics.remove(this.body);
      this.bodyRemoved = true;
    }
  }

  applyKnockback(impulse, damage, source, gentle) {
    if (this.dead) {
      if (this.actor?.ragdolled) {
        for (const b of this.actor.bodies.values()) b.applyImpulse(_v1.copy(impulse).multiplyScalar(b.mass * 0.4), b.position);
      }
      return;
    }
    this.velocity.add(impulse);
    this.knockTimer = gentle ? 0.35 : 0.7;
    this.grounded = false;
    if (damage > 0) this.damage(damage, this.position, source, 'force');
    if (!gentle && impulse.length() > 12 && this.actor && !this.A.boss) {
      // hit hard enough to leave its feet
      this.stun(1.2);
    }
  }

  stun(t) { this.stunTimer = Math.max(this.stunTimer, t); }

  dropShield() {
    if (!this.shieldUp) return;
    this.shieldUp = false;
    this.built.shield.visible = false;
    this.shieldHp = 0;
    this.deployTimer = 4.5;
    audio.explosion(this.position, 0.4);
    this.world.particles?.sparkBurst(this.aimPoint(_v1), null, 30, { speed: 12, color: 0x88ffcc });
  }

  die(point, source, kind) {
    if (this.dead) return;
    this.dead = true;
    this.dying = 0;
    this.world.onEnemyKilled?.(this, source, kind);

    if (this.hum) this.hum.retract();
    if (this.telegraphArc) this.telegraphArc.hide();
    if (this.cloak) { this.cloak.dispose(); this.cloak = null; }
    if (this.saber) {
      // the blade falls with them, then goes out
      this.saber.retract();
      setTimeout(() => this.saber && this.saber.setVisible(false), 900);
    }
    if (this.actor && !this.actor.ragdolled) {
      _v1.copy(this.velocity).multiplyScalar(0.6);
      if (point && source) {
        _v2.subVectors(this.position, source.position ?? point).setY(0.4).normalize().multiplyScalar(2.2);
        _v1.add(_v2);
      }
      this.actor.goRagdoll(_v1, _v3.set((rng() - .5) * 6, (rng() - .5) * 4, (rng() - .5) * 6));
    }
    if (this.group) {
      this.world.particles?.explosion(this.aimPoint(_v1), 0.9);
      audio.explosion(this.position, 0.8);
      this.world.spawnDebrisGroup(this.group, this.position.clone(), _v2.set(0, 3, 0), 0.9);
      this.group = null;
    }
    if (!this.bodyRemoved) { this.world.physics.remove(this.body); this.bodyRemoved = true; }
    audio.thud(this.position, 1);
  }

  /* ── update ──────────────────────────────────────────────────────── */

  update(dt, ctx) {
    if (this.dead) {
      this.dying += dt;
      if (this.actor) this.actor.update(dt);
      if (this.saber && this.actor?.ragdolled) {
        const hand = this.actor.bodies.get('handR') || this.actor.bodies.get('foreR');
        if (hand) this.saber.setHiltPose(hand.position, hand.quaternion);
        this.saber.update(dt, ctx.time, this.velocity);
      }
      return this.dying < 40;
    }

    this.stateTime += dt;
    this.stunTimer = Math.max(0, this.stunTimer - dt);
    this.knockTimer = Math.max(0, this.knockTimer - dt);
    if (this.actor) this.actor.update(dt);

    // level of detail: distant enemies skip the expensive solves
    const camDist = ctx.camera.position.distanceTo(this.position);
    this.lod = camDist > 62 ? 2 : camDist > 30 ? 1 : 0;

    if (this.netDriven) {
      // a client's copy: the host owns where this thing is, we own how it looks
      if (this.netTarget) {
        _v1.subVectors(this.netTarget, this.position);
        this.velocity.copy(_v1).multiplyScalar(dt > 0 ? Math.min(1 / dt, 18) : 0);
        dampVec(this.position, this.netTarget, 14, dt);
      }
      let d = (this.netFacing ?? this.facing) - this.facing;
      while (d > Math.PI) d -= TAU;
      while (d < -Math.PI) d += TAU;
      this.facing += d * Math.min(1, dt * 10);
      this.target = ctx.pickTarget(this);
      if (this.target) this.toTarget = _v2.subVectors(this.target.position, this.position).setY(0).normalize().clone();
      this._syncBody();
      this._pose(dt, ctx);
      return true;
    }

    this._think(dt, ctx);
    this._move(dt, ctx);
    this._pose(dt, ctx);
    return true;
  }

  _think(dt, ctx) {
    const A = this.A;
    const target = this.target = ctx.pickTarget(this);
    if (!target) { this.wish = null; return; }

    _v1.subVectors(target.position, this.position);
    const dist = _v1.length();
    this.distToTarget = dist;
    _v1.y = 0;
    if (_v1.lengthSq() > 1e-6) _v1.normalize();
    this.toTarget = _v1.clone();

    if (this.gripped) { this.wish = null; return; }
    if (this.stunTimer > 0 || this.toppled) { this.wish = null; return; }
    if (A.inert) { this.wish = null; return; }
    if (A.custom === 'remote') { this._remoteBrain(dt, ctx, dist); return; }

    const [near, far] = A.preferred;
    this.strafeTimer -= dt;
    if (this.strafeTimer <= 0) { this.strafeTimer = 1.1 + rng() * 2.2; this.strafeDir = rng() < 0.5 ? 1 : -1; }

    const side = _v2.set(-this.toTarget.z, 0, this.toTarget.x).multiplyScalar(this.strafeDir);
    const wish = _v3.set(0, 0, 0);

    if (dist > far) wish.copy(this.toTarget);
    else if (dist < near) wish.copy(this.toTarget).negate();
    else wish.copy(side).addScaledVector(this.toTarget, A.melee ? 0.35 : 0.08);

    // spread out — a horde that clumps looks like a bug
    for (const other of ctx.enemies) {
      if (other === this || other.dead) continue;
      _v4.subVectors(this.position, other.position);
      const d2 = _v4.lengthSq();
      const want = (this.radius + other.radius) * 2.4;
      if (d2 > want * want || d2 < 1e-6) continue;
      const d = Math.sqrt(d2);
      wish.addScaledVector(_v4.multiplyScalar(1 / d), (1 - d / want) * 1.5);
    }
    if (wish.lengthSq() > 1) wish.normalize();
    this.wish = wish.clone();

    if (A.melee) this._meleeBrain(dt, ctx, dist);
    else this._rangedBrain(dt, ctx, dist);
  }

  _rangedBrain(dt, ctx, dist) {
    if (this.disarmed || this.blinded) return;
    const A = this.A;
    const diff = this.world.difficulty;

    if (A.shield) {
      this.deployTimer = Math.max(0, this.deployTimer - dt);
      const wantShield = dist < 22 && this.deployTimer <= 0 && this.shieldHp > 0;
      if (wantShield && !this.shieldUp && this.stateTime > 1.2) {
        this.shieldUp = true;
        this.built.shield.visible = true;
        this.shieldHp = this.shieldMax;
        audio.tone({ freq: 220, freqEnd: 700, dur: 0.5, gain: 0.16, type: 'sine', pos: this.position });
      }
    }

    this.attackTimer -= dt;
    if (this.burstLeft > 0) {
      this.burstTimer -= dt;
      if (this.burstTimer <= 0) {
        this._shoot(ctx);
        this.burstLeft--;
        this.burstTimer = A.burstGap ?? 0.12;
      }
      return;
    }
    if (this.attackTimer <= 0 && dist < (A.preferred[1] + 12) && this._hasLineOfSight(ctx)) {
      if (A.telegraph) {
        if (this.aimCharge <= 0) {
          this.aimCharge = A.telegraph;
          this._beginTelegraph(ctx);
        }
        this.aimCharge -= dt;
        if (this.aimCharge <= 0) {
          this._endTelegraph();
          this.burstLeft = A.burst ?? 1;
          this.burstTimer = 0;
          this.attackTimer = A.fireRate * (0.75 + rng() * 0.5) / (diff ? diff.enemyAggression : 1);
        }
      } else {
        this.burstLeft = A.burst ?? 1;
        this.burstTimer = 0;
        this.attackTimer = A.fireRate * (0.7 + rng() * 0.6) / (diff ? diff.enemyAggression : 1);
      }
    }
  }

  _remoteBrain(dt, ctx, dist) {
    // circle the student at a polite distance and fire slowly
    this.orbitPhase += dt * 0.55;
    const side = _v2.set(-this.toTarget.z, 0, this.toTarget.x);
    const want = _v3.copy(side).multiplyScalar(Math.sin(this.orbitPhase) > 0 ? 1 : -1);
    if (dist > this.A.preferred[1]) want.add(this.toTarget);
    else if (dist < this.A.preferred[0]) want.sub(this.toTarget);
    this.wish = want.normalize().clone();

    this.attackTimer -= dt;
    if (this.attackTimer <= 0) {
      this.attackTimer = (this.trainingFireRate ?? this.A.fireRate) * (0.8 + rng() * 0.4);
      this._shoot(ctx);
    }
  }

  _beginTelegraph(ctx) {
    if (!this.laser) {
      const g = new THREE.CylinderGeometry(0.006, 0.006, 1, 4);
      g.translate(0, 0.5, 0);
      g.rotateX(Math.PI / 2);
      this.laser = new THREE.Mesh(g, new THREE.MeshBasicMaterial({
        color: 0xff3020, transparent: true, opacity: 0.6, toneMapped: false, blending: THREE.AdditiveBlending, depthWrite: false }));
      this.world.scene.add(this.laser);
    }
    this.laser.visible = true;
    audio.tone({ freq: 1400, freqEnd: 2200, dur: 0.9, gain: 0.07, type: 'sine', pos: this.position });
  }
  _endTelegraph() { if (this.laser) this.laser.visible = false; }

  _hasLineOfSight(ctx) {
    if (!this.target) return false;
    const from = this._muzzleWorld(_v5);
    _v6.subVectors(this.target.chest ?? this.target.position, from);
    const d = _v6.length();
    _v6.multiplyScalar(1 / d);
    const hit = ctx.physics.raycast(from, _v6, d - 0.6, (b) => b.static || b.layer === LAYER.PROP);
    if (hit) return false;
    if (ctx.terrain) {
      const t = ctx.terrain.raycast(from, _v6, d - 0.6, _v1, _v2);
      if (t !== null) return false;
    }
    return true;
  }

  _muzzleWorld(out) {
    if (this.built?.muzzles?.length) {
      // a remote fires from whichever emitter is facing the student
      const m = this.built.muzzles[(this._armToggle = ((this._armToggle || 0) + 1) % this.built.muzzles.length)];
      return m.getWorldPosition(out);
    }
    if (this.weapon && this.weapon.userData.muzzle) {
      return out.copy(this.weapon.userData.muzzle).applyMatrix4(this.weapon.matrixWorld);
    }
    if (this.built?.arms?.length) {
      const a = this.built.arms[(this._armToggle = 1 - (this._armToggle || 0))];
      return a.muzzle.getWorldPosition(out);
    }
    if (this.built?.cannons?.length) {
      const c = this.built.cannons[(this._armToggle = 1 - (this._armToggle || 0))];
      return c.muzzle.getWorldPosition(out);
    }
    if (this.rig) {
      const f = this.rig.get('foreR');
      if (f) return this.rig.tipPos('foreR', out);
    }
    return out.copy(this.position).setY(this.chestY);
  }

  _shoot(ctx) {
    const A = this.A;
    const target = this.target;
    if (!target) return;
    const from = this._muzzleWorld(_v1).clone();
    const aimAt = _v2.copy(target.chest ?? target.position);

    const diff = this.world.difficulty;
    const acc = diff ? diff.enemyAccuracy : 0.7;
    // lead the shot, then throw it off by however good this difficulty is
    const speed = 88 * (diff ? diff.boltSpeed : 1) * (A.big ? 1.2 : 1);
    const tof = from.distanceTo(aimAt) / speed;
    if (target.velocity) aimAt.addScaledVector(target.velocity, tof * acc);

    _v3.subVectors(aimAt, from).normalize();
    const spread = (A.spread ?? 0.06) * (2 - acc);
    _v3.x += (rng() - 0.5) * spread; _v3.y += (rng() - 0.5) * spread * 0.7; _v3.z += (rng() - 0.5) * spread;
    _v3.normalize();

    ctx.bolts.fire(from, _v3, {
      speed: this.trainingBoltSpeed ?? speed, damage: this.damage, color: A.boltColor ?? BOLT_COLORS.red,
      owner: this, team: this.team, big: !!A.big,
      length: A.big ? 2.4 : 1.15, radius: A.big ? 0.1 : 0.05,
    });
    audio.blaster(from, !!A.big);
    this.world.particles?.plasma.spawn(from, _v4.set(0, 0, 0), {
      life: 0.07, size: A.big ? 0.9 : 0.42, drag: 1, gravity: 0, color: A.boltColor ?? 0xff3020, alpha: 1 });
    this.muzzleFlash = 0.06;
  }

  _meleeBrain(dt, ctx, dist) {
    if (!this.saber) { this._beastBrain(dt, ctx, dist); return; }
    if (this.lock) { this.wish = null; return; }   // a blade lock pins both fighters
    if (this.trainingSpeed) this.duel.timeScale = this.trainingSpeed;
    this.duel.update(dt, ctx, dist);
    // a lunging attack actually carries the duellist forward
    if (this.duel.lungeSpeed > 0.01 && this.toTarget) {
      this.velocity.addScaledVector(this.toTarget, this.duel.lungeSpeed * dt * 9);
    }
  }

  /**
   * A boss should not be one move repeated. The acklay works through three
   * phases as it loses health — stalking, then sweeping, then enraged — and
   * every heavy attack leaves it winded, which is the window to take a leg.
   * Three legs and it goes down, physically, because it has three legs left.
   */
  _beastBrain(dt, ctx, dist) {
    const A = this.A;
    const hpFrac = clamp(this.hp / this.maxHp, 0, 1);
    const phase = hpFrac > 0.66 ? 1 : hpFrac > 0.33 ? 2 : 3;
    if (phase !== this.bossPhase) {
      this.bossPhase = phase;
      this.speed = A.speed * (1 + (phase - 1) * 0.22);
      if (phase > 1) {
        this.world.notify?.(`${A.label.toUpperCase()} — PHASE ${phase}`, phase === 3 ? 'it has stopped being careful' : 'it is angry now');
        audio.explosion(this.position, 1.2);
        this.stun(0.6);
        this.world.particles?.sandPuff(this.position.clone(), 3.2,
          this.world.terrain?.height(this.position.x, this.position.z), this.world.groundColor);
        this.world.engine?.flash(0.1);
      }
    }

    // being hurt fast enough winds it — the only safe time to go for a leg
    this.windTimer = Math.max(0, (this.windTimer || 0) - dt);
    this.recentDamage = Math.max(0, (this.recentDamage || 0) - dt * this.maxHp * 0.12);
    if (this.recentDamage > this.maxHp * 0.14 && this.windTimer <= 0 && this.state !== 'winded') {
      this.recentDamage = 0;
      this.state = 'winded';
      this.stateTime = 0;
      this.windTimer = 7;
      this.world.notifyFloating?.(this.aimPoint(_v1), 'WINDED', '#ffd88a');
      audio.explosion(this.position, 0.7);
    }
    if (this.state === 'winded') {
      this.wish = null;
      if (this.stateTime > 2.4) { this.state = 'approach'; }
      return;
    }

    this.attackTimer -= dt;
    if (dist < A.preferred[1] + 2.5 && this.attackTimer <= 0 && this.state === 'approach') {
      const roll = rng();
      const canSweep = phase >= 2;
      const canCharge = phase >= 3;
      this.state = canCharge && roll < 0.34 ? 'charge'
                 : canSweep && roll < 0.66 ? 'sweep'
                 : 'lunge';
      this.attackTimer = lerp(2.4, 1.15, (phase - 1) / 2) + rng() * 1.1;
      this.stateTime = 0;
      this._swiped = false;
      this.lungeDir = this.toTarget.clone();
      audio.explosion(this.position, this.state === 'charge' ? 0.9 : 0.5);
      if (this.state === 'charge') this.world.notifyFloating?.(this.aimPoint(_v1), 'CHARGE', '#ff6a52');
    }

    const hitTarget = (radius, dmg, lift) => {
      if (this._swiped) return;
      this._swiped = true;
      const t = this.target;
      if (t && t.position.distanceTo(this.position) < radius) {
        _v1.subVectors(t.position, this.position).setY(lift).normalize().multiplyScalar(16);
        t.damage?.(dmg, this.position, this);
        t.velocity?.add(_v1);
        t.camera?.addShake(0.7);
      }
      this.world.particles?.sandPuff(this.position.clone().addScaledVector(this.toTarget, 3), 2.4,
        this.world.terrain?.height(this.position.x, this.position.z), this.world.groundColor);
    };

    if (this.state === 'lunge') {
      if (this.stateTime < 0.5) this.velocity.addScaledVector(this.lungeDir, 42 * dt);
      else if (this.stateTime < 0.85) hitTarget(5.4 * A.scale * 0.6, this.damage, 0.5);
      else { this.state = 'approach'; this._swiped = false; }
    } else if (this.state === 'sweep') {
      // a wide claw arc — step aside rather than back
      if (this.stateTime > 0.55 && this.stateTime < 0.95) hitTarget(6.6 * A.scale * 0.6, this.damage * 0.85, 0.9);
      else if (this.stateTime >= 1.15) { this.state = 'approach'; this._swiped = false; }
    } else if (this.state === 'charge') {
      if (this.stateTime < 0.65) this.wish = null;                    // the wind-up
      else if (this.stateTime < 1.9) {
        this.velocity.addScaledVector(this.lungeDir, 30 * dt);
        hitTarget(4.6 * A.scale * 0.6, this.damage * 1.3, 0.8);
        if (rng() < 0.4) this.world.particles?.sandPuff(this.position.clone(), 1.4,
          this.world.terrain?.height(this.position.x, this.position.z), this.world.groundColor);
      } else { this.state = 'approach'; this._swiped = false; }
    }
  }

  /* ── motion ──────────────────────────────────────────────────────── */

  _move(dt, ctx) {
    const terrain = ctx.terrain;

    if (this.gripped && this.liftTarget) {
      dampVec(this.position, this.liftTarget, 8, dt);
      this.velocity.set(0, 0, 0);
      this.grounded = false;
      this._syncBody();
      return;
    }
    if (this.toppled) { this._syncBody(); return; }

    const canMove = this.stunTimer <= 0 && this.knockTimer <= 0 && !this.gripped;
    if (canMove && this.wish) {
      const speed = this.speed * (this.legsLost ? 0.45 : 1);
      _v1.copy(this.wish).multiplyScalar(speed);
      this.velocity.x = damp(this.velocity.x, _v1.x, 8, dt);
      this.velocity.z = damp(this.velocity.z, _v1.z, 8, dt);
    } else if (this.knockTimer <= 0) {
      this.velocity.x = damp(this.velocity.x, 0, 6, dt);
      this.velocity.z = damp(this.velocity.z, 0, 6, dt);
    }

    if (this.A.float) {
      // hover: hold a height above the ground with a slow bob
      const gh = terrain ? terrain.height(this.position.x, this.position.z) : 0;
      this.hoverPhase += dt * 1.7;
      const want = gh + this.A.float + Math.sin(this.hoverPhase) * 0.16;
      this.velocity.y = damp(this.velocity.y, (want - this.position.y) * 4.5, 8, dt);
      this.position.addScaledVector(this.velocity, dt);
      this.grounded = false;
      this._syncBody();
      return;
    }

    if (!this.grounded) this.velocity.y -= 24 * dt;
    this.position.addScaledVector(this.velocity, dt);

    const gh = terrain ? terrain.height(this.position.x, this.position.z) : 0;
    if (this.position.y <= gh) {
      if (this.velocity.y < -9) {
        ctx.particles?.sandPuff(this.position.clone(), 0.8, gh, this.world.groundColor);
        audio.thud(this.position, 0.6);
        if (this.velocity.y < -20 && !this.A.boss) this.damage(clamp(-this.velocity.y - 20, 0, 60), this.position, null, 'fall');
      }
      this.position.y = gh;
      if (this.velocity.y < 0) this.velocity.y = 0;
      this.grounded = true;
    } else this.grounded = false;

    // stay inside the arena
    if (terrain && !terrain.inBounds(this.position.x, this.position.z, 4)) {
      const h = terrain.half - 4;
      this.position.x = clamp(this.position.x, -h, h);
      this.position.z = clamp(this.position.z, -h, h);
    }

    // static geometry
    for (const box of ctx.physics.staticBoxes) {
      if (box.disabled) continue;
      _v1.set(this.position.x, this.position.y + 0.9, this.position.z);
      if (_v1.distanceToSquared(box.center) > (box.radius + 1.6) ** 2) continue;
      _v2.subVectors(_v1, box.center).applyQuaternion(box.invQuat);
      const h = box.halfExtents;
      _v3.set(clamp(_v2.x, -h.x, h.x), clamp(_v2.y, -h.y, h.y), clamp(_v2.z, -h.z, h.z));
      _v4.subVectors(_v2, _v3);
      const d2 = _v4.lengthSq();
      const r = this.radius;
      if (d2 > r * r || d2 < 1e-8) continue;
      const d = Math.sqrt(d2);
      _v4.multiplyScalar(1 / d).applyQuaternion(box.quat);
      _v4.y = 0;
      if (_v4.lengthSq() < 1e-6) continue;
      _v4.normalize();
      this.position.addScaledVector(_v4, r - d);
    }

    // face the target while fighting, face travel otherwise
    let want = this.facing;
    if (this.toTarget && this.stunTimer <= 0) want = Math.atan2(this.toTarget.x, this.toTarget.z);
    else if (this.velocity.lengthSq() > 1) want = Math.atan2(this.velocity.x, this.velocity.z);
    let d = want - this.facing;
    while (d > Math.PI) d -= TAU;
    while (d < -Math.PI) d += TAU;
    this.facing += d * Math.min(1, dt * (this.A.big ? 3.2 : 8));

    this._syncBody();
  }

  _syncBody() {
    if (this.bodyRemoved) return;
    this.body.setTransform(_v1.set(this.position.x, this.position.y + (this.A.big ? 1.4 : 0.9), this.position.z), null);
  }

  /* ── pose ────────────────────────────────────────────────────────── */

  _pose(dt, ctx) {
    const A = this.A;
    if (this.actor?.ragdolled) return;

    if (this.animator) {
      const groundAt = (x, z) => (ctx.terrain ? ctx.terrain.height(x, z) : 0);
      this.animator.setFacing(this.facing);
      this.animator.update(dt, {
        position: this.position, facing: this.facing, velocity: this.velocity,
        grounded: this.grounded, groundAt, crouch: 0,
        accelForward: clamp(this.velocity.length() / 5, 0, 1),
      });
      this._poseArms(dt, ctx);
    } else if (this.rig) {
      this._poseWalker(dt, ctx);
    } else if (this.group && A.custom === 'remote') {
      this.group.position.copy(this.position);
      this.group.rotation.y += dt * 1.2;
      if (this.built.halo) this.built.halo.intensity = 1.1 + Math.sin(ctx.time * 6 + this.hoverPhase) * 0.5;
    } else if (this.group) {
      this._poseDroideka(dt, ctx);
    }

    if (this.laser && this.laser.visible && this.target) {
      const from = this._muzzleWorld(_v1);
      _v2.subVectors(this.target.chest ?? this.target.position, from);
      const len = _v2.length();
      this.laser.position.copy(from);
      this.laser.quaternion.setFromUnitVectors(_v3.set(0, 0, 1), _v2.normalize());
      this.laser.scale.set(1, 1, len);
    }
    if (this.muzzleFlash > 0) this.muzzleFlash -= dt;
  }

  _poseArms(dt, ctx) {
    const rig = this.rig;
    if (!rig || this.lod > 1) return;
    const chest = rig.worldPos('chest', _v1);
    const fwd = _v2.set(Math.sin(this.facing), 0, Math.cos(this.facing));
    const right = _v3.set(fwd.z, 0, -fwd.x);
    const S = this.A.scale;

    if (this.saber) {
      this._poseSaber(dt, ctx, chest, fwd, right);
      return;
    }
    if (this.disarmed || !this.weapon) {
      this.animator?.swingArms(dt, this.velocity.length(), 1);
      return;
    }
    // both hands to the weapon, weapon pointed at the target
    const aim = this.target ? _v4.copy(this.target.chest ?? this.target.position).sub(chest).normalize()
                            : _v4.copy(fwd);
    const holdR = _v5.copy(chest).addScaledVector(aim, 0.34 * S).addScaledVector(right, 0.16 * S).addScaledVector(UP, -0.13 * S);
    const poleR = _v6.copy(chest).addScaledVector(right, 0.8).addScaledVector(UP, -0.7);
    rig.solveIK('armR', 'foreR', holdR, poleR);
    if (!this.A.custom) {
      const holdL = _v5.copy(chest).addScaledVector(aim, 0.5 * S).addScaledVector(right, -0.02 * S).addScaledVector(UP, -0.1 * S);
      const poleL = _v6.copy(chest).addScaledVector(right, -0.8).addScaledVector(UP, -0.7);
      rig.solveIK('armL', 'foreL', holdL, poleL);
    }
    // point the weapon down the aim line
    const hand = rig.get('handR');
    if (hand && hand.obj.parent) {
      aimY(_v5.copy(aim).lerp(UP, 0.42).normalize(), null, _q1);
      hand.obj.parent.getWorldQuaternion(_q2);
      hand.obj.quaternion.copy(_q2.invert()).multiply(_q1);
    }
    rig.updateMatrices();
  }

  _poseSaber(dt, ctx, chest, fwd, right) {
    const rig = this.rig;
    const S = this.A.scale;

    // the duel brain owns where the guard wants to be
    const guard = this.duel.guardDir;
    const fast = this.duel.phase === 'strike';

    // convert to world using the enemy's facing, plus any spin the move carries
    _q1.setFromAxisAngle(UP, this.facing + this.duel.spin);
    const dirWorld = _v5.copy(guard).applyQuaternion(_q1).normalize();
    const reach = 0.34 + (this.duel.attack?.reach ?? 0);
    const handTarget = _v6.copy(chest).addScaledVector(dirWorld, reach * S).addScaledVector(UP, -0.08 * S);
    const guardPoint = _v1.copy(chest).addScaledVector(dirWorld, (reach + 0.61) * S);

    if (!this._saberHandInit) { this.saberHand.copy(handTarget); this._saberHandInit = true; }
    dampVec(this.saberHand, handTarget, fast ? 30 : 12, dt);

    _v2.subVectors(guardPoint, this.saberHand).normalize();
    aimY(_v2, null, _q2);
    this.saberQuat.slerp(_q2, clamp(dt * (fast ? 26 : 10), 0, 1));

    this.saber.setHiltPose(this.saberHand, this.saberQuat);
    this.saber.update(dt, ctx.time, this.velocity);
    if (this.hum) { this.hum.set(this.saber.swingSpeed, this.saber.contactStrain); this.hum.move(this.saber.pointAt(0.5, _v3)); }

    // arms follow the hilt, exactly like the player's do
    const poleR = _v3.copy(chest).addScaledVector(right, 0.8 * S).addScaledVector(UP, -0.75 * S);
    rig.solveIK('armR', 'foreR', this.saberHand, poleR);
    const poleL = _v3.copy(chest).addScaledVector(right, -0.7 * S).addScaledVector(UP, -0.8 * S);
    rig.solveIK('armL', 'foreL', _v2.copy(this.saberHand).addScaledVector(right, -0.06 * S).addScaledVector(UP, -0.06 * S), poleL);
    rig.updateMatrices();

    // close duellists get simulated robes; distant ones do not need them
    if (this.cloak) {
      if (this.lod > 1) { this.cloak.setVisible(false); }
      else {
        this.cloak.setVisible(true);
        _v3.copy(this.velocity).multiplyScalar(-0.8).setY(0);
        this.cloak.update(dt, this.cloak.refreshColliders(), _v3);
      }
    }
  }

  _poseWalker(dt, ctx) {
    const rig = this.rig;
    const S = this.A.scale;
    const nLegs = this.A.custom === 'beast' ? 6 : 4;
    const speed = Math.hypot(this.velocity.x, this.velocity.z);
    this.walkPhase = (this.walkPhase + dt * clamp(speed / (1.1 * S), 0.1, 2.4)) % 1;

    const bodyH = (this.A.custom === 'beast' ? 1.5 : 1.6) * S;
    const hips = rig.hipsBone.obj;
    const gh = ctx.terrain ? ctx.terrain.height(this.position.x, this.position.z) : 0;
    hips.position.set(this.position.x, Math.max(this.position.y, gh) + bodyH + Math.sin(this.walkPhase * TAU * 2) * 0.05 * S, this.position.z);
    hips.quaternion.setFromAxisAngle(UP, this.facing);
    rig.updateMatrices();

    if (this.lod > 1) return;
    const fwd = _v1.set(Math.sin(this.facing), 0, Math.cos(this.facing));
    const right = _v2.set(fwd.z, 0, -fwd.x);

    for (let i = 0; i < nLegs; i++) {
      const femur = rig.get(`femur${i}`);
      if (!femur || femur.severed) continue;
      const side = i % 2 === 0 ? 1 : -1;
      const row = Math.floor(i / 2);
      const ph = (this.walkPhase + (i % 2) * 0.5 + row * 0.18) % 1;
      const stance = ph < 0.5;
      const t = stance ? 0 : (ph - 0.5) * 2;

      const zOff = (row - (nLegs / 2 - 1) / 2) * 0.62 * S;
      const foot = _v3.copy(this.position)
        .addScaledVector(right, side * 1.35 * S)
        .addScaledVector(fwd, zOff + (stance ? -0.3 : lerp(-0.3, 0.7, t)) * S);
      foot.y = (ctx.terrain ? ctx.terrain.height(foot.x, foot.z) : 0) + (stance ? 0 : Math.sin(t * Math.PI) * 0.42 * S);

      const knee = _v4.copy(foot).addScaledVector(right, side * 1.4 * S).addScaledVector(UP, 1.5 * S);
      rig.solveIK(`femur${i}`, `tibia${i}`, foot, knee);
      const tarsus = rig.get(`tarsus${i}`);
      if (tarsus) {
        _v5.copy(fwd).multiplyScalar(0.3).setY(-0.95).normalize();
        rig.aimBoneWorld(`tarsus${i}`, _v5, null);
      }
    }
    // head tracks the target — a yaw/pitch, since the chassis geometry is
    // authored facing +Z rather than along the bone axis
    const headBone = rig.get('head');
    if (this.target && headBone && !headBone.severed) {
      _v3.subVectors(this.target.chest ?? this.target.position, rig.worldPos('head', _v4));
      const localYaw = Math.atan2(_v3.x, _v3.z) - this.facing - Math.PI;
      headBone.obj.quaternion.copy(headBone.restQuat).multiply(
        _q1.setFromEuler(new THREE.Euler(clamp(Math.atan2(_v3.y, Math.hypot(_v3.x, _v3.z)), -0.5, 0.5),
          clamp(((localYaw + Math.PI * 3) % (Math.PI * 2)) - Math.PI, -0.7, 0.7), 0, 'YXZ')));
    }
    rig.updateMatrices();
  }

  _poseDroideka(dt, ctx) {
    if (!this.group) return;
    const b = this.built;
    const gh = ctx.terrain ? ctx.terrain.height(this.position.x, this.position.z) : 0;
    this.group.position.set(this.position.x, Math.max(this.position.y, gh), this.position.z);
    this.group.quaternion.setFromAxisAngle(UP, this.facing);

    const speed = Math.hypot(this.velocity.x, this.velocity.z);
    this.walkPhase = (this.walkPhase + dt * clamp(speed / 1.2, 0.05, 3)) % 1;
    b.legs.forEach((leg, i) => {
      if (leg.gone) return;
      const ph = (this.walkPhase + i / 3) % 1;
      leg.leg.rotation.x = Math.sin(ph * TAU) * 0.22;
      leg.lower.rotation.x = -0.2 + Math.cos(ph * TAU) * 0.2;
    });
    if (this.target) {
      _v1.subVectors(this.target.chest ?? this.target.position, b.headG.getWorldPosition(_v2));
      const pitch = Math.atan2(_v1.y, Math.hypot(_v1.x, _v1.z));
      b.headG.rotation.x = clamp(-pitch, -0.5, 0.5);
      for (const arm of b.arms) arm.arm.rotation.x = clamp(-pitch * 0.6, -0.5, 0.5);
    }
    if (b.shield.visible) {
      b.shieldMat.uniforms.uTime.value += dt;
      const u = b.shieldMat.uniforms.uPower;
      u.value = damp(u.value, clamp(this.shieldHp / this.shieldMax, 0, 1) * 0.85, 4, dt);
    }
  }

  dispose() {
    if (this.saber) this.saber.dispose();
    if (this.hum) this.hum.dispose();
    if (this.cloak) this.cloak.dispose();
    if (this.telegraphArc) this.telegraphArc.dispose();
    if (this.laser) { this.world.scene.remove(this.laser); this.laser.geometry.dispose(); this.laser.material.dispose(); }
    if (this.actor) this.actor.dispose();
    else if (this.rig) { this.world.scene.remove(this.rig.root); this.rig.dispose(); }
    if (this.group) this.world.scene.remove(this.group);
    if (!this.bodyRemoved) this.world.physics.remove(this.body);
  }
}

/** How lethal losing each bone is. */
const VITAL = {
  head: 0.95, neck: 1.0, chest: 1.0, spine: 1.0, hips: 1.0, body: 1.0,
  clavL: 0.5, clavR: 0.5, armL: 0.35, armR: 0.35, foreL: 0.22, foreR: 0.22,
  handL: 0.1, handR: 0.1, thighL: 0.55, thighR: 0.55, shinL: 0.3, shinR: 0.3,
  footL: 0.12, footR: 0.12,
};
