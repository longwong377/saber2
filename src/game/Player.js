/**
 * SABER — the player.
 *
 * A kinematic capsule for movement, a spring-arm camera, and a body whose arms
 * are IK'd to wherever the blade controller put the hilt. The character is not
 * playing an animation of holding a sword — the sword is solved first and the
 * body is solved to match it.
 */

import * as THREE from 'three';
import { Saber, SABER_COLORS } from './Saber.js';
import { SaberController } from './SaberController.js';
import { buildJedi } from './Bodies.js';
import { Rig, BipedAnimator } from './Rig.js';
import { Body, LAYER, capsuleSpheres } from '../physics/Physics.js';
import { clamp, lerp, damp, smoothstep, dampVec, makeRng, TAU } from '../engine/MathUtil.js';
import { audio } from '../engine/Audio.js';

const rng = makeRng(1212);
const _v1 = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3();
const _v4 = new THREE.Vector3(), _v5 = new THREE.Vector3(), _v6 = new THREE.Vector3();
const _q1 = new THREE.Quaternion(), _q2 = new THREE.Quaternion();
const UP = new THREE.Vector3(0, 1, 0);

/* ══════════════════════════════════════════════════════════════════════ */
/*  Camera                                                                */
/* ══════════════════════════════════════════════════════════════════════ */

export class CameraRig {
  constructor(camera) {
    this.camera = camera;
    this.yaw = 0;
    this.pitch = -0.06;
    this.distance = 3.05;
    this.targetDistance = 3.05;
    this.height = 1.52;
    this.shoulder = 0.46;
    this.firstPerson = false;
    this.pos = new THREE.Vector3();
    this.look = new THREE.Vector3();
    this.shake = 0;
    this.shakeSeed = rng() * 100;
    this.fov = 78;
    this.fovTarget = 78;
    this.roll = 0;
    this.rollTarget = 0;
    this.enabled = true;
    this.aimQuat = new THREE.Quaternion();
    this._smoothTarget = new THREE.Vector3();
    this._init = false;
  }

  addYaw(d) { this.yaw += d; }
  addPitch(d) { this.pitch = clamp(this.pitch + d, -1.28, 1.16); }

  aimDirection(out = new THREE.Vector3()) {
    return out.set(0, 0, -1).applyQuaternion(this.aimQuat);
  }

  update(dt, target, ctx = {}) {
    this.aimQuat.setFromEuler(new THREE.Euler(this.pitch, this.yaw, 0, 'YXZ'));

    if (!this._init) { this._smoothTarget.copy(target); this._init = true; }
    dampVec(this._smoothTarget, target, this.firstPerson ? 40 : 16, dt);

    this.distance = damp(this.distance, this.targetDistance, 8, dt);
    this.fov = damp(this.fov, this.fovTarget, 7, dt);
    this.roll = damp(this.roll, this.rollTarget, 6, dt);

    const fwd = _v1.set(0, 0, -1).applyQuaternion(this.aimQuat);
    const right = _v2.set(1, 0, 0).applyQuaternion(this.aimQuat);

    if (this.firstPerson) {
      this.pos.copy(this._smoothTarget).addScaledVector(UP, ctx.eyeHeight ?? 1.62);
      this.pos.addScaledVector(fwd, 0.08);
      this.look.copy(this.pos).addScaledVector(fwd, 10);
    } else {
      const anchor = _v3.copy(this._smoothTarget).addScaledVector(UP, this.height)
        .addScaledVector(right, this.shoulder);
      let dist = this.distance;
      // pull in when the camera would clip geometry
      if (ctx.physics) {
        const back = _v4.copy(fwd).negate();
        const hit = ctx.physics.raycast(anchor, back, dist + 0.42,
          (b) => b.static || b.layer === LAYER.PROP);
        if (hit && hit.distance < dist + 0.42) dist = Math.max(0.55, hit.distance - 0.34);
      }
      if (ctx.terrain) {
        const p = _v5.copy(anchor).addScaledVector(fwd, -dist);
        const h = ctx.terrain.height(p.x, p.z) + 0.4;
        if (p.y < h) {
          const dy = h - p.y;
          anchor.y += dy * 0.6;
          dist = Math.max(0.7, dist - dy * 0.35);
        }
      }
      this.pos.copy(anchor).addScaledVector(fwd, -dist);
      this.look.copy(anchor).addScaledVector(fwd, 6);
    }

    // shake
    if (this.shake > 0.001) {
      const t = performance.now() * 0.001 + this.shakeSeed;
      const amp = this.shake * (this.firstPerson ? 0.055 : 0.09);
      this.pos.x += Math.sin(t * 47.3) * amp;
      this.pos.y += Math.sin(t * 39.7 + 1.7) * amp;
      this.pos.z += Math.cos(t * 43.1 + 0.6) * amp;
      this.shake = damp(this.shake, 0, 5.5, dt);
    }

    this.camera.position.copy(this.pos);
    this.camera.up.set(Math.sin(this.roll), Math.cos(this.roll), 0).applyQuaternion(
      _q1.setFromAxisAngle(UP, this.yaw));
    this.camera.lookAt(this.look);
    if (Math.abs(this.camera.fov - this.fov) > 0.01) {
      this.camera.fov = this.fov;
      this.camera.updateProjectionMatrix();
    }
  }

  addShake(v) { this.shake = Math.min(1.5, this.shake + v); }
}

/* ══════════════════════════════════════════════════════════════════════ */
/*  Player                                                                */
/* ══════════════════════════════════════════════════════════════════════ */

export class Player {
  constructor(world, opts = {}) {
    this.world = world;
    this.id = opts.id ?? 'local';
    this.name = opts.name ?? 'Jedi';
    this.isLocal = opts.isLocal !== false;
    this.team = 0;

    // ── body
    const built = buildJedi({ robeIndex: opts.robeIndex ?? 0, scale: 1 });
    this.rig = built.rig;
    this.palette = built.palette;
    world.scene.add(this.rig.root);
    this.animator = new BipedAnimator(this.rig, { scale: 1, hipHeight: 0.95 });
    this.animator.onFootstep = (p, speed) => this._footstep(p, speed);

    // ── saber
    this.saber = new Saber(world.scene, {
      colorIndex: opts.colorIndex ?? 0,
      bladeLength: opts.bladeLength ?? 1.15,
      coreWidth: opts.coreWidth ?? 1,
      hiltStyle: opts.hiltStyle ?? 'Graflex',
    });
    this.control = new SaberController({
      sensitivity: opts.sensitivity ?? 1,
      followStrength: opts.followStrength ?? 0.75,
      scheme: opts.scheme ?? 'free',
    });
    this.hum = audio.createHum(this.saber.color.getHex());

    // ── movement state
    this.position = new THREE.Vector3(opts.spawn ? opts.spawn.x : 0, 0, opts.spawn ? opts.spawn.z : 6);
    this.position.y = world.terrain ? world.terrain.height(this.position.x, this.position.z) : 0;
    this.velocity = new THREE.Vector3();
    this.facing = 0;
    this.grounded = true;
    this.crouch = 0;
    this.radius = 0.34;
    this.height = 1.78;
    this.coyote = 0;
    this.jumpHeld = 0;
    this.dashTimer = 0;
    this.dashDir = new THREE.Vector3();
    this.lastGroundY = 0;
    this.fallSpeed = 0;

    // ── stats
    this.maxHp = 100; this.hp = 100;
    this.maxForce = 100; this.force = 100;
    this.maxStamina = 100; this.stamina = 100;
    this.flow = 0;
    this.alive = true;
    this.invuln = 0;
    this.riposteTimer = 0;
    this.staggerTimer = 0;
    this.combo = 0;
    this.comboTimer = 0;
    this.score = 0;
    this.kills = 0;
    this.deflects = 0;
    this.perfects = 0;
    this.limbsRemoved = 0;

    // ── force powers
    this.gripBody = null;
    this.gripDistance = 4;
    this.senseActive = false;
    this.senseTimer = 0;
    this.saberThrown = false;
    this.throwState = 'held';
    this.throwPos = new THREE.Vector3();
    this.throwVel = new THREE.Vector3();
    this.throwSpin = 0;
    this.throwTimer = 0;
    this.cooldowns = { push: 0, pull: 0, throw: 0, sense: 0, dash: 0, lightning: 0 };
    this.boons = new Set();
    this.boonMods = {
      deflectDamage: 1, cutPower: 1, forceCost: 1, staminaRegen: 1, moveSpeed: 1,
      jumpPower: 1, flowGain: 1, returnCone: 0.42, healOnKill: 0, lightning: false,
      repulse: false, throwPierce: false, doubleJump: false, lifesteal: 0,
    };
    this.airJumps = 0;

    // ── camera
    this.camera = new CameraRig(world.engine.camera);
    this.camera.yaw = Math.PI;
    this.eyeHeight = 1.62;

    // ── physics proxy so enemies and props collide with us
    this.body = new Body({
      position: this.position.clone().setY(this.position.y + 0.9),
      spheres: capsuleSpheres(0.55, this.radius, 'y', 3),
      mass: 78, kinematic: true, static: false, layer: LAYER.PLAYER,
      mask: LAYER.WORLD, allowSleep: false, gravityScale: 0,
    });
    this.body.userData.player = this;
    world.physics.add(this.body);

    this.chest = new THREE.Vector3();
    this.headPos = new THREE.Vector3();
    this._prevChest = new THREE.Vector3();
    this.aimDir = new THREE.Vector3(0, 0, -1);
    this._stepTimer = 0;
    this._lastSwingSound = 0;
    this.hitFlash = 0;
    this.events = [];
  }

  /* ── convenience ─────────────────────────────────────────────────── */

  get difficulty() { return this.world.difficulty; }
  aimPoint(out = new THREE.Vector3()) { return out.copy(this.chest); }
  get dead() { return !this.alive; }

  setSaberColor(i) {
    this.saber.setColor(i);
    this.hum.dispose();
    this.hum = audio.createHum(this.saber.color.getHex());
    if (this.saber.lit) this.hum.ignite();
  }

  /* ── main update ─────────────────────────────────────────────────── */

  update(dt, ctx) {
    const input = ctx.input;
    this.comboTimer -= dt;
    if (this.comboTimer <= 0 && this.combo > 0) { this.combo = 0; }
    for (const k in this.cooldowns) this.cooldowns[k] = Math.max(0, this.cooldowns[k] - dt);
    this.invuln = Math.max(0, this.invuln - dt);
    this.riposteTimer = Math.max(0, this.riposteTimer - dt);
    this.staggerTimer = Math.max(0, this.staggerTimer - dt);
    this.hitFlash = damp(this.hitFlash, 0, 5, dt);

    if (!this.alive) { this._updateDead(dt, ctx); return; }

    this._readInput(dt, ctx);
    this._move(dt, ctx);
    this._updateForce(dt, ctx);
    this._updateBlade(dt, ctx);
    this._updateBody(dt, ctx);
    this._updateCamera(dt, ctx);
    this._regen(dt);
  }

  /* ── input ───────────────────────────────────────────────────────── */

  _readInput(dt, ctx) {
    const input = ctx.input;
    if (!this.isLocal) return;

    // blade → camera coupling
    const camDelta = this.control.applyInput(input, dt, {
      stamina: this.stamina / this.maxStamina,
      onThrust: () => {
        this.stamina = Math.max(0, this.stamina - 6);
        audio.swing(16, this.saber.base);
      },
    });
    this.camera.addYaw(camDelta.yaw);
    this.camera.addPitch(camDelta.pitch);

    // ignite / retract
    if (input.hit('KeyX')) {
      this.saber.toggle();
      if (this.saber.lit) { this.hum.ignite(); audio.tone({ freq: 180, freqEnd: 900, dur: 0.4, gain: 0.22, type: 'sawtooth', pos: this.saber.base }); }
      else { this.hum.retract(); audio.tone({ freq: 900, freqEnd: 120, dur: 0.35, gain: 0.2, type: 'sawtooth', pos: this.saber.base }); }
    }
    if (input.hit('KeyV')) {
      this.camera.firstPerson = !this.camera.firstPerson;
      this._applyViewMode();
    }

    // grip / one-hand
    const wantOne = input.down('AltLeft') || input.down('AltRight') || this.saberThrown;
    this.control.grip = wantOne ? 'one' : 'two';

    // force powers
    if (input.hit('KeyF')) {
      if (input.down('ShiftLeft') || input.down('ShiftRight')) this.forcePull(ctx);
      else this.forcePush(ctx);
    }
    if (input.hit('KeyG')) this.toggleGrip(ctx);
    if (input.hit('KeyR')) this.throwOrRecall(ctx);
    if (input.hit('KeyC')) this.toggleSense(ctx);
    if (input.hit('KeyZ') && this.boonMods.lightning) this.forceLightning(ctx);
    if (input.buttonPressed[1] && this.gripBody) this.hurlGripped(ctx);
    if (input.hit('ShiftLeft') && input.moveAxis(_axis).y !== 0 && this.cooldowns.dash <= 0) this._tryDash(ctx);
  }

  _applyViewMode() {
    const head = this.rig.get('head');
    const fp = this.camera.firstPerson;
    if (head) head.obj.scale.setScalar(fp ? 0.0001 : 1);
    const neck = this.rig.get('neck');
    if (neck) neck.obj.scale.setScalar(fp ? 0.35 : 1);
    this.camera.targetDistance = fp ? 0 : 3.05;
  }

  /* ── locomotion ──────────────────────────────────────────────────── */

  _move(dt, ctx) {
    const input = ctx.input;
    const terrain = ctx.terrain;
    const axis = this.isLocal ? input.moveAxis(_axis) : (this.netAxis || _axis0);

    const sprinting = this.isLocal && (input.down('ShiftLeft') || input.down('ShiftRight')) && axis.y > 0.2 && this.stamina > 4;
    const crouching = this.isLocal && (input.down('ControlLeft') || input.down('ControlRight'));
    this.crouch = damp(this.crouch, crouching ? 1 : 0, 12, dt);

    const base = 4.6 * this.boonMods.moveSpeed;
    let speed = base * (sprinting ? 1.62 : 1) * lerp(1, 0.48, this.crouch);
    if (this.staggerTimer > 0) speed *= 0.35;
    if (this.senseActive) speed *= 1.18;

    const fwd = _v1.set(Math.sin(this.camera.yaw), 0, Math.cos(this.camera.yaw)).negate();
    const right = _v2.set(fwd.z, 0, -fwd.x).negate();
    const wish = _v3.set(0, 0, 0).addScaledVector(fwd, axis.y).addScaledVector(right, axis.x);
    if (wish.lengthSq() > 1) wish.normalize();

    // acceleration: crisp on the ground, floaty in the air
    const accel = this.grounded ? 46 : 12;
    const targetV = _v4.copy(wish).multiplyScalar(speed);
    if (this.dashTimer > 0) {
      this.dashTimer -= dt;
      targetV.copy(this.dashDir).multiplyScalar(15.5);
    }
    this.velocity.x = damp(this.velocity.x, targetV.x, accel * 0.42, dt);
    this.velocity.z = damp(this.velocity.z, targetV.z, accel * 0.42, dt);

    // ── jump
    if (this.grounded) { this.coyote = 0.14; this.airJumps = this.boonMods.doubleJump ? 1 : 0; }
    else this.coyote = Math.max(0, this.coyote - dt);

    if (this.isLocal) {
      if (input.hit('Space')) {
        if (this.coyote > 0) {
          this.velocity.y = 7.4 * this.boonMods.jumpPower;
          this.grounded = false; this.coyote = 0;
          this.jumpHeld = 0.42;
          audio.force(this.position, 'jump');
          if (ctx.particles) ctx.particles.sandPuff(this.position.clone(), 0.8, this.position.y, ctx.groundColor);
        } else if (this.airJumps > 0 && this.force > 12) {
          this.airJumps--;
          this.force -= 12;
          this.velocity.y = 6.9 * this.boonMods.jumpPower;
          this.jumpHeld = 0.34;
          audio.force(this.position, 'jump');
          if (ctx.particles) {
            _v5.copy(this.position).setY(this.position.y + 0.4);
            ctx.particles.plasma.spawn(_v5, _v6.set(0, 0, 0), { life: 0.35, size: 1.6, drag: 1, gravity: 0, color: 0x9fd8ff, alpha: 0.7 });
          }
        }
      }
      // holding jump feeds the Force into the leap — a real, controllable arc
      if (input.down('Space') && this.jumpHeld > 0 && this.velocity.y > 0 && this.force > 0) {
        const cost = 34 * dt * this.boonMods.forceCost;
        this.force = Math.max(0, this.force - cost);
        this.velocity.y += 20 * dt;
        this.jumpHeld -= dt;
        if (ctx.particles && rng() < 0.5) {
          _v5.copy(this.position).setY(this.position.y + 0.1);
          ctx.particles.dust.spawn(_v5, _v6.set((rng() - .5) * 2, -1, (rng() - .5) * 2),
            { life: 0.6, size: 0.3, drag: 2, gravity: -1, color: 0xd8c8a8, alpha: 0.16, floor: this.position.y });
        }
      } else this.jumpHeld = 0;
    }

    // ── gravity + integrate
    if (!this.grounded) this.velocity.y -= 24 * dt;
    this.fallSpeed = Math.min(this.fallSpeed, this.velocity.y);
    this.position.addScaledVector(this.velocity, dt);

    // ── collide
    this._collide(dt, ctx);

    // ── facing: toward the blade in combat, toward movement otherwise
    const wantFace = this.camera.yaw + Math.PI;
    let target = wantFace;
    if (!this.saber.lit && this.velocity.lengthSq() > 1.5) {
      target = Math.atan2(this.velocity.x, this.velocity.z);
    }
    let d = target - this.facing;
    while (d > Math.PI) d -= TAU;
    while (d < -Math.PI) d += TAU;
    this.facing += d * Math.min(1, dt * 13);

    // stamina from sprinting
    if (sprinting) this.stamina = Math.max(0, this.stamina - 11 * dt);
  }

  _collide(dt, ctx) {
    const terrain = ctx.terrain;
    const physics = ctx.physics;
    const wasGrounded = this.grounded;

    // static boxes and props: push out horizontally
    if (physics) {
      for (let iter = 0; iter < 2; iter++) {
        for (const box of physics.staticBoxes) {
          if (box.disabled) continue;
          _v1.set(this.position.x, this.position.y + this.height * 0.5, this.position.z);
          if (_v1.distanceToSquared(box.center) > (box.radius + 1.4) ** 2) continue;
          _v2.subVectors(_v1, box.center).applyQuaternion(box.invQuat);
          const h = box.halfExtents;
          const cx = clamp(_v2.x, -h.x, h.x), cy = clamp(_v2.y, -h.y, h.y), cz = clamp(_v2.z, -h.z, h.z);
          _v3.set(cx, cy, cz);
          _v4.subVectors(_v2, _v3);
          let d2 = _v4.lengthSq();
          const r = this.radius + 0.02;
          if (d2 > r * r) continue;
          if (d2 < 1e-8) {
            const dx = h.x - Math.abs(_v2.x), dy = h.y - Math.abs(_v2.y), dz = h.z - Math.abs(_v2.z);
            if (dx <= dy && dx <= dz) _v4.set(Math.sign(_v2.x) || 1, 0, 0);
            else if (dy <= dz) _v4.set(0, Math.sign(_v2.y) || 1, 0);
            else _v4.set(0, 0, Math.sign(_v2.z) || 1);
            d2 = 1e-4;
          }
          const d = Math.sqrt(d2);
          _v4.multiplyScalar(1 / d);
          const push = r - d;
          _v5.copy(_v4).applyQuaternion(box.quat);
          // land on top of it rather than sliding off
          if (_v5.y > 0.6 && this.velocity.y <= 0.1) {
            const topY = box.center.y + h.y;
            if (this.position.y < topY && this.position.y > topY - 1.2) {
              this.position.y = topY;
              this.velocity.y = 0;
              this.grounded = true;
              continue;
            }
          }
          _v5.y = 0;
          if (_v5.lengthSq() < 1e-6) continue;
          _v5.normalize();
          this.position.addScaledVector(_v5, push);
          const vn = this.velocity.dot(_v5);
          if (vn < 0) this.velocity.addScaledVector(_v5, -vn);
        }
      }
      // shove dynamic props out of the way
      for (const b of physics.bodies) {
        if (b.invMass === 0 || b === this.body) continue;
        if (b.layer !== LAYER.PROP && b.layer !== LAYER.DEBRIS && b.layer !== LAYER.RAGDOLL) continue;
        _v1.set(this.position.x, this.position.y + 0.9, this.position.z);
        const rr = this.radius + b.boundingRadius;
        _v2.subVectors(b.position, _v1);
        const d2 = _v2.lengthSq();
        if (d2 > rr * rr || d2 < 1e-8) continue;
        const d = Math.sqrt(d2);
        _v2.multiplyScalar(1 / d);
        b.wake();
        b.applyImpulse(_v3.copy(_v2).multiplyScalar(Math.min(b.mass, 40) * (rr - d) * 2.4), _v1);
        _v2.y = 0;
        if (_v2.lengthSq() > 1e-6) {
          _v2.normalize();
          const massRatio = clamp(b.mass / 220, 0, 0.55);
          this.position.addScaledVector(_v2, -(rr - d) * massRatio);
        }
      }
    }

    // terrain
    const gh = terrain ? terrain.height(this.position.x, this.position.z) : 0;
    if (this.position.y <= gh + 0.02) {
      if (!wasGrounded && this.fallSpeed < -7) this._land(ctx, -this.fallSpeed);
      this.position.y = gh;
      if (this.velocity.y < 0) this.velocity.y = 0;
      this.grounded = true;
      this.fallSpeed = 0;
      // slide down steep faces
      if (terrain) {
        terrain.normalAt(this.position.x, this.position.z, _v1);
        const slope = 1 - _v1.y;
        if (slope > 0.52) {
          _v2.set(_v1.x, 0, _v1.z).normalize().multiplyScalar((slope - 0.52) * 26 * dt);
          this.velocity.add(_v2);
        }
      }
    } else if (this.position.y > gh + 0.06) {
      this.grounded = false;
    }

    if (terrain && !terrain.inBounds(this.position.x, this.position.z, 6)) {
      const h = terrain.half - 6;
      this.position.x = clamp(this.position.x, -h, h);
      this.position.z = clamp(this.position.z, -h, h);
    }

    this.body.setTransform(_v1.set(this.position.x, this.position.y + 0.9, this.position.z), null);
  }

  _land(ctx, impactSpeed) {
    const power = clamp(impactSpeed / 18, 0.2, 1.6);
    this.camera.addShake(power * 0.5);
    audio.thud(this.position, power);
    if (ctx.particles) {
      ctx.particles.sandPuff(this.position.clone(), power * 1.9, this.position.y, ctx.groundColor);
    }
    if (impactSpeed > 15) {
      // a Force landing cracks the ground and staggers everything near it
      if (ctx.terrain) ctx.terrain.crater(this.position.x, this.position.z, 1.8 + power, 0.42 * power);
      audio.explosion(this.position, 0.5);
      this._shockwave(ctx, 5.4 * power, 11 * power, 14 * power);
      if (this.boonMods.repulse) this._shockwave(ctx, 8 * power, 20 * power, 26 * power);
    }
    if (impactSpeed > 26) this.damage(clamp((impactSpeed - 26) * 2.6, 0, 45), null, 'fall');
  }

  _shockwave(ctx, radius, force, damage) {
    const enemies = ctx.enemies || [];
    for (const e of enemies) {
      if (e.dead) continue;
      const d = e.position.distanceTo(this.position);
      if (d > radius) continue;
      const k = 1 - d / radius;
      _v1.subVectors(e.position, this.position).setY(0.6).normalize();
      e.applyKnockback(_v1.multiplyScalar(force * k), damage * k, this);
    }
    if (ctx.physics) {
      for (const b of ctx.physics.bodies) {
        if (b.invMass === 0) continue;
        const d = b.position.distanceTo(this.position);
        if (d > radius) continue;
        const k = 1 - d / radius;
        _v1.subVectors(b.position, this.position).setY(0.5).normalize();
        b.applyImpulse(_v1.multiplyScalar(force * k * b.mass * 0.5), b.position);
      }
    }
    if (ctx.particles) {
      for (let i = 0; i < 26; i++) {
        const a = (i / 26) * TAU;
        _v1.set(Math.cos(a), 0.2, Math.sin(a)).multiplyScalar(radius * 1.4);
        _v2.copy(this.position).setY(this.position.y + 0.1);
        ctx.particles.dust.spawn(_v2, _v1, { life: 1.1, size: 0.5, drag: 2.2, gravity: 0.6,
          color: ctx.groundColor ?? 0xd8c8a8, alpha: 0.22, floor: this.position.y });
      }
    }
    this.world.engine.setRadial?.(0.5);
  }

  _tryDash(ctx) {
    if (this.stamina < 18) return;
    const axis = ctx.input.moveAxis(_axis);
    const fwd = _v1.set(Math.sin(this.camera.yaw), 0, Math.cos(this.camera.yaw)).negate();
    const right = _v2.set(fwd.z, 0, -fwd.x).negate();
    this.dashDir.set(0, 0, 0).addScaledVector(fwd, axis.y).addScaledVector(right, axis.x);
    if (this.dashDir.lengthSq() < 0.01) this.dashDir.copy(fwd);
    this.dashDir.normalize();
    this.dashTimer = 0.17;
    this.stamina -= 18;
    this.cooldowns.dash = 0.55;
    this.invuln = Math.max(this.invuln, 0.16);
    audio.force(this.position, 'jump');
    if (ctx.particles) ctx.particles.sandPuff(this.position.clone(), 0.9, this.position.y, ctx.groundColor);
    this.camera.fovTarget = this.camera.fov + 6;
    setTimeout(() => { this.camera.fovTarget = this.world.settings.fov; }, 180);
  }

  _footstep(p, speed) {
    const ctx = this.world;
    const surface = ctx.terrain ? ctx.terrain.surfaceAt(p.x, p.z) : 'sand';
    audio.step(p, surface, speed > 5);
    if (ctx.particles && speed > 0.6) {
      if (surface === 'water') ctx.particles.splash(p.clone(), 0.4);
      else ctx.particles.sandPuff(p.clone(), clamp(speed * 0.09, 0.12, 0.5), p.y, ctx.groundColor);
    }
  }

  /* ── blade ───────────────────────────────────────────────────────── */

  _updateBlade(dt, ctx) {
    // chest anchor: the frame the whole blade solve lives in
    this.chest.copy(this.position).setY(this.position.y + lerp(1.34, 1.0, this.crouch));
    this.headPos.copy(this.position).setY(this.position.y + lerp(1.62, 1.22, this.crouch));
    this.camera.aimDirection(this.aimDir);

    if (this.isLocal && this.difficulty && this.difficulty.assist > 0) {
      this.control.assist = this.difficulty.assist;
      const threats = ctx.bolts ? ctx.bolts.threatsNear(this.chest, 26) : [];
      this.control.applyAssist(threats.filter(t => t.bolt.team !== this.team), this.chest, this.camera.aimQuat, dt);
    } else this.control.assist = 0;

    this.control.update(dt, this.chest, this.camera.aimQuat, {
      stamina: this.stamina / this.maxStamina,
      flow: this.flow,
      riposte: this.riposteTimer > 0,
      stiffnessScale: this.staggerTimer > 0 ? 0.45 : 1,
    });

    if (this.throwState === 'held') {
      this.saber.setHiltPose(this.control.handPos, this.control.quat);
      this.saber.setVisible(true);
    } else {
      this._updateThrow(dt, ctx);
    }

    this.saber.update(dt, ctx.time);
    this.hum.set(this.saber.tipSpeed, this.saber.contactStrain);
    this.hum.move(this.saber.pointAt(0.5, _v1));

    // swing whoosh when the blade crosses a speed threshold
    const now = ctx.time;
    if (this.saber.tipSpeed > 11 && now - this._lastSwingSound > 0.19) {
      this._lastSwingSound = now;
      audio.swing(this.saber.tipSpeed, this.saber.pointAt(0.7, _v1));
      this.stamina = Math.max(0, this.stamina - clamp(this.saber.tipSpeed * 0.055, 0, 2.4) * (this.difficulty?.staminaDrain ?? 1));
    }

    // heat haze off the blade
    if (this.saber.ignition > 0.5 && this.world.settings.bloom) {
      _v1.copy(this.saber.pointAt(0.5, _v2)).project(ctx.camera);
      if (_v1.z < 1) {
        this.world.engine.addHeat((_v1.x * 0.5 + 0.5), (_v1.y * 0.5 + 0.5),
          0.14 + this.saber.tipSpeed * 0.002, clamp(0.4 + this.saber.tipSpeed * 0.03, 0.4, 1.4));
      }
    }
  }

  /* ── body pose ───────────────────────────────────────────────────── */

  _updateBody(dt, ctx) {
    const terrain = ctx.terrain;
    const groundAt = (x, z) => (terrain ? terrain.height(x, z) : 0);

    const speed = Math.hypot(this.velocity.x, this.velocity.z);
    this.animator.setFacing(this.facing);
    this.animator.update(dt, {
      position: this.position,
      facing: this.facing,
      velocity: this.velocity,
      grounded: this.grounded,
      groundAt,
      crouch: this.crouch,
      accelForward: clamp(speed / 8, 0, 1),
      accelStrafe: 0,
    });

    // arms to the hilt
    const twoHanded = this.control.grip === 'two' && this.throwState === 'held';
    const rig = this.rig;
    const chest = rig.worldPos('chest', _v1);

    if (this.throwState === 'held') {
      const gripR = this.saber.root.localToWorld(_v2.set(0, 0.03, 0));
      const gripL = this.saber.root.localToWorld(_v3.set(0, -0.035, 0));
      const fwd = _v4.set(0, 0, -1).applyQuaternion(this.camera.aimQuat);
      const right = _v5.set(1, 0, 0).applyQuaternion(this.camera.aimQuat);

      const poleR = _v6.copy(chest).addScaledVector(right, 0.75).addScaledVector(UP, -0.75).addScaledVector(fwd, -0.2);
      rig.solveIK('armR', 'foreR', gripR, poleR);
      if (twoHanded) {
        const poleL = _v6.copy(chest).addScaledVector(right, -0.62).addScaledVector(UP, -0.8).addScaledVector(fwd, -0.2);
        rig.solveIK('armL', 'foreL', gripL, poleL);
      } else {
        const rest = _v6.copy(chest).addScaledVector(right, -0.34).addScaledVector(UP, -0.62)
          .addScaledVector(fwd, this.gripBody ? 0.55 : -0.05);
        const poleL = _v2.copy(chest).addScaledVector(right, -0.85).addScaledVector(UP, -0.7);
        rig.solveIK('armL', 'foreL', rest, poleL);
      }
      // hands take the hilt's roll
      this.saber.root.getWorldQuaternion(_q1);
      for (const h of twoHanded ? ['handR', 'handL'] : ['handR']) {
        const b = rig.get(h);
        if (!b || !b.obj.parent) continue;
        b.obj.parent.getWorldQuaternion(_q2);
        b.obj.quaternion.copy(_q2.invert()).multiply(_q1);
      }
    } else {
      // saber is in flight — the throwing hand stays extended, calling it back
      const fwd = _v4.set(0, 0, -1).applyQuaternion(this.camera.aimQuat);
      const right = _v5.set(1, 0, 0).applyQuaternion(this.camera.aimQuat);
      const reach = _v6.copy(chest).addScaledVector(fwd, 0.55).addScaledVector(right, 0.22).addScaledVector(UP, 0.05);
      rig.solveIK('armR', 'foreR', reach, _v2.copy(chest).addScaledVector(right, 0.8).addScaledVector(UP, -0.6));
      const rest = _v6.copy(chest).addScaledVector(right, -0.3).addScaledVector(UP, -0.6);
      rig.solveIK('armL', 'foreL', rest, _v2.copy(chest).addScaledVector(right, -0.8).addScaledVector(UP, -0.7));
    }

    // spine counter-rotation: the body braces against the blade's momentum
    const spine = rig.get('spine');
    if (spine) {
      const w = this.control.angVel;
      const twist = clamp(-w.y * 0.026, -0.32, 0.32);
      const lean = clamp(this.control.handVel.dot(_v1.set(Math.sin(this.facing), 0, Math.cos(this.facing))) * 0.012, -0.2, 0.2);
      spine.obj.quaternion.copy(spine.restQuat)
        .multiply(_q1.setFromEuler(new THREE.Euler(lean, twist, 0, 'XYZ')));
    }
    // head looks where the blade is going
    const head = rig.get('head');
    if (head) {
      _v1.copy(this.saber.tip).sub(rig.worldPos('neck', _v2));
      if (_v1.lengthSq() > 0.01) {
        _v1.normalize().lerp(_v3.copy(this.aimDir), 0.55).normalize();
        rig.aimBoneWorld('head', _v1.lerp(UP, 0.5).normalize(), null);
      }
    }
    rig.updateMatrices();
  }

  _updateCamera(dt, ctx) {
    const s = this.world.settings;
    this.camera.fovTarget = s.fov + clamp(Math.hypot(this.velocity.x, this.velocity.z) - 4.6, 0, 4) * 1.6
      + (this.dashTimer > 0 ? 7 : 0);
    this.camera.rollTarget = clamp(-this.control.angVel.y * 0.006, -0.05, 0.05);
    this.camera.update(dt, this.position, {
      physics: ctx.physics, terrain: ctx.terrain, eyeHeight: lerp(1.62, 1.22, this.crouch),
    });
  }

  _regen(dt) {
    const combatHot = this.world.combatIntensity ?? 0;
    this.stamina = Math.min(this.maxStamina, this.stamina + (16 + 10 * (1 - combatHot)) * dt * this.boonMods.staminaRegen);
    this.force = Math.min(this.maxForce, this.force + (this.senseActive ? 0 : 7.5) * dt);
    // Flow bleeds unless you keep earning it
    this.flow = clamp(this.flow - dt * 0.085, 0, 1);
    if (this.senseActive) {
      this.force -= 22 * dt;
      if (this.force <= 0) this.toggleSense(this.world);
    }
  }

  addFlow(v) {
    this.flow = clamp(this.flow + v * this.boonMods.flowGain, 0, 1);
  }

  /* ── force powers ────────────────────────────────────────────────── */

  forcePush(ctx) {
    const cost = 20 * this.boonMods.forceCost;
    if (this.force < cost || this.cooldowns.push > 0) return;
    this.force -= cost;
    this.cooldowns.push = 0.55;
    audio.force(this.chest, 'push');
    this.camera.addShake(0.3);

    const origin = this.chest;
    const dir = this.aimDir;
    const range = 13, halfAngle = 0.72;

    for (const e of ctx.enemies || []) {
      if (e.dead) continue;
      _v1.subVectors(e.position, origin);
      const d = _v1.length();
      if (d > range) continue;
      _v1.multiplyScalar(1 / d);
      if (_v1.dot(dir) < Math.cos(halfAngle)) continue;
      const k = (1 - d / range);
      _v2.copy(dir).multiplyScalar(20 * k).setY(7 * k + 3);
      e.applyKnockback(_v2, 8 * k, this);
    }
    for (const b of (ctx.physics ? ctx.physics.bodies : [])) {
      if (b.invMass === 0 || b === this.body) continue;
      _v1.subVectors(b.position, origin);
      const d = _v1.length();
      if (d > range) continue;
      _v1.multiplyScalar(1 / d);
      if (_v1.dot(dir) < Math.cos(halfAngle)) continue;
      const k = 1 - d / range;
      _v2.copy(dir).multiplyScalar(b.mass * 15 * k).setY(b.mass * 6 * k);
      b.applyImpulse(_v2, b.position);
    }
    // bolts get scattered
    if (ctx.bolts) {
      for (const bolt of ctx.bolts.bolts) {
        if (!bolt.active || bolt.team === this.team) continue;
        _v1.subVectors(bolt.pos, origin);
        const d = _v1.length();
        if (d > range || _v1.normalize().dot(dir) < Math.cos(halfAngle)) continue;
        bolt.vel.addScaledVector(dir, 40).setLength(bolt.speed);
        bolt.team = this.team;
      }
    }
    if (ctx.particles) {
      for (let i = 0; i < 30; i++) {
        _v1.copy(dir).multiplyScalar(9 + rng() * 12);
        _v1.x += (rng() - 0.5) * 7; _v1.y += (rng() - 0.5) * 5; _v1.z += (rng() - 0.5) * 7;
        _v2.copy(origin).addScaledVector(dir, 0.6);
        ctx.particles.dust.spawn(_v2, _v1, { life: 0.75, size: 0.4, drag: 2.6, gravity: 0.2,
          color: 0xe0e8f0, alpha: 0.12 });
      }
    }
    if (ctx.terrain) {
      _v1.copy(origin).addScaledVector(dir, 4.5);
      if (Math.abs(_v1.y - ctx.terrain.height(_v1.x, _v1.z)) < 1.6) {
        ctx.terrain.crater(_v1.x, _v1.z, 2.6, 0.22);
        ctx.particles?.sandPuff(_v1.setY(ctx.terrain.height(_v1.x, _v1.z)), 1.4, _v1.y, ctx.groundColor);
      }
    }
    this.world.engine.setRadial?.(0.35);
  }

  forcePull(ctx) {
    const cost = 16 * this.boonMods.forceCost;
    if (this.force < cost || this.cooldowns.pull > 0) return;
    this.force -= cost;
    this.cooldowns.pull = 0.6;
    audio.force(this.chest, 'pull');
    const origin = this.chest, dir = this.aimDir, range = 17;
    for (const e of ctx.enemies || []) {
      if (e.dead) continue;
      _v1.subVectors(e.position, origin);
      const d = _v1.length();
      if (d > range || d < 1.5) continue;
      _v1.multiplyScalar(1 / d);
      if (_v1.dot(dir) < 0.72) continue;
      _v2.copy(_v1).multiplyScalar(-Math.min(d * 3.2, 22)).setY(4.5);
      e.applyKnockback(_v2, 2, this, true);
    }
    for (const b of (ctx.physics ? ctx.physics.bodies : [])) {
      if (b.invMass === 0 || b === this.body) continue;
      _v1.subVectors(b.position, origin);
      const d = _v1.length();
      if (d > range || d < 1) continue;
      _v1.multiplyScalar(1 / d);
      if (_v1.dot(dir) < 0.72) continue;
      _v2.copy(_v1).multiplyScalar(-b.mass * Math.min(d * 2.2, 16)).setY(b.mass * 3.4);
      b.applyImpulse(_v2, b.position);
    }
  }

  toggleGrip(ctx) {
    if (this.gripBody) { this.releaseGrip(); return; }
    if (this.force < 10) return;
    const hit = ctx.physics.raycast(this.camera.pos, this.aimDir, 32,
      (b) => b.invMass > 0 && (b.layer === LAYER.PROP || b.layer === LAYER.DEBRIS || b.layer === LAYER.RAGDOLL));
    if (!hit || !hit.body) {
      // nothing inert — try to lift an enemy instead
      let best = null, bestD = 26;
      for (const e of ctx.enemies || []) {
        if (e.dead || !e.grippable) continue;
        _v1.subVectors(e.position, this.chest);
        const d = _v1.length();
        if (d > bestD) continue;
        if (_v1.normalize().dot(this.aimDir) < 0.94) continue;
        best = e; bestD = d;
      }
      if (best) { this.gripEnemy = best; best.gripped = true; this.gripDistance = bestD; audio.force(this.chest, 'pull'); }
      return;
    }
    this.gripBody = hit.body;
    this.gripDistance = clamp(hit.distance, 2.4, 14);
    this.gripBody.gravityScale = 0;
    audio.force(this.chest, 'pull');
  }

  releaseGrip() {
    if (this.gripBody) { this.gripBody.gravityScale = 1; this.gripBody = null; }
    if (this.gripEnemy) { this.gripEnemy.gripped = false; this.gripEnemy = null; }
  }

  hurlGripped(ctx) {
    const target = _v1.copy(this.camera.pos).addScaledVector(this.aimDir, 40);
    if (this.gripBody) {
      const b = this.gripBody;
      b.gravityScale = 1;
      _v2.subVectors(target, b.position).normalize().multiplyScalar(b.mass * 26);
      b.applyImpulse(_v2, b.position);
      b.userData.hurledBy = this;
      b.userData.hurlTimer = 2.4;
      this.gripBody = null;
    } else if (this.gripEnemy) {
      const e = this.gripEnemy;
      e.gripped = false;
      _v2.subVectors(target, e.position).normalize().multiplyScalar(26);
      e.applyKnockback(_v2, 12, this);
      this.gripEnemy = null;
    }
    audio.force(this.chest, 'push');
  }

  _updateGrip(dt, ctx) {
    const hold = _v1.copy(this.camera.pos).addScaledVector(this.aimDir, this.gripDistance);
    if (this.gripBody) {
      const b = this.gripBody;
      this.force -= 9 * dt * this.boonMods.forceCost;
      if (this.force <= 0) { this.releaseGrip(); return; }
      b.wake();
      _v2.subVectors(hold, b.position);
      b.velocity.copy(_v2).multiplyScalar(9).clampLength(0, 28);
      b.angularVelocity.multiplyScalar(1 - dt * 2);
      b.angularVelocity.y += dt * 2.2;
      if (ctx.particles && rng() < 0.4) {
        ctx.particles.plasma.spawn(b.position, _v3.set(0, 0, 0),
          { life: 0.3, size: b.boundingRadius * 1.5, drag: 1, gravity: 0, color: 0x88bbff, alpha: 0.12 });
      }
      this.gripDistance = clamp(this.gripDistance + (ctx.input?.mouse.wheel || 0) * -0.6, 2, 18);
    } else if (this.gripEnemy) {
      const e = this.gripEnemy;
      this.force -= 14 * dt * this.boonMods.forceCost;
      if (this.force <= 0 || e.dead) { this.releaseGrip(); return; }
      e.liftTarget = hold.clone();
    }
  }

  throwOrRecall(ctx) {
    if (this.throwState === 'held') {
      if (!this.saber.lit || this.force < 14 || this.cooldowns.throw > 0) return;
      this.force -= 14 * this.boonMods.forceCost;
      this.cooldowns.throw = 0.4;
      this.throwState = 'flying';
      this.throwPos.copy(this.saber.base);
      this.throwVel.copy(this.aimDir).multiplyScalar(26);
      this.throwTimer = 0;
      this.throwSpin = 0;
      audio.force(this.saber.base, 'push');
      audio.swing(24, this.saber.base);
    } else {
      this.throwState = 'returning';
    }
  }

  _updateThrow(dt, ctx) {
    this.throwTimer += dt;
    this.throwSpin += dt * 27;

    if (this.throwState === 'flying') {
      // steerable: the blade drifts toward where you are looking
      _v1.copy(this.aimDir).multiplyScalar(26);
      this.throwVel.lerp(_v1, clamp(dt * 1.4, 0, 1));
      this.throwPos.addScaledVector(this.throwVel, dt);
      if (this.throwTimer > 1.5) this.throwState = 'returning';
    } else {
      _v1.subVectors(this.control.handPos, this.throwPos);
      const d = _v1.length();
      if (d < 0.45) {
        this.throwState = 'held';
        this.control.handPos.copy(this.throwPos);
        audio.clash(this.throwPos, 0.4);
        return;
      }
      _v1.multiplyScalar(1 / d);
      this.throwVel.lerp(_v2.copy(_v1).multiplyScalar(clamp(d * 7, 12, 34)), clamp(dt * 7, 0, 1));
      this.throwPos.addScaledVector(this.throwVel, dt);
    }

    // the flying blade is a horizontal spinning disc
    _q1.setFromAxisAngle(UP, this.throwSpin);
    _q2.setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI / 2);
    this.saber.setHiltPose(this.throwPos, _q1.multiply(_q2));
    this.saber.setVisible(true);

    if (ctx.particles && rng() < 0.5) {
      ctx.particles.plasma.spawn(this.throwPos, _v3.set(0, 0, 0),
        { life: 0.2, size: 0.5, drag: 1, gravity: 0, color: this.saber.color.getHex(), alpha: 0.35 });
    }
  }

  toggleSense(ctx) {
    if (this.senseActive) {
      this.senseActive = false;
      this.world.setTimeScale(1);
      this.world.engine.setSense(0);
      return;
    }
    if (this.force < 25) return;
    this.senseActive = true;
    this.world.setTimeScale(0.42);
    this.world.engine.setSense(1);
    audio.force(this.chest, 'sense');
  }

  forceLightning(ctx) {
    const cost = 30 * this.boonMods.forceCost;
    if (this.force < cost || this.cooldowns.lightning > 0) return;
    this.force -= cost;
    this.cooldowns.lightning = 1.5;
    audio.force(this.chest, 'lightning');
    const origin = _v1.copy(this.chest).addScaledVector(this.aimDir, 0.4);
    for (const e of ctx.enemies || []) {
      if (e.dead) continue;
      _v2.subVectors(e.position, origin);
      const d = _v2.length();
      if (d > 16) continue;
      if (_v2.normalize().dot(this.aimDir) < 0.8) continue;
      e.damage(46, e.position, this, 'lightning');
      e.stun(1.4);
      if (ctx.particles) {
        for (let i = 0; i < 12; i++) {
          _v3.copy(origin).lerp(e.position, i / 12);
          _v3.x += (rng() - 0.5) * 0.6; _v3.y += (rng() - 0.5) * 0.6; _v3.z += (rng() - 0.5) * 0.6;
          ctx.particles.sparks.spawn(_v3, _v4.set((rng() - .5) * 3, (rng() - .5) * 3, (rng() - .5) * 3),
            { life: 0.2, size: 0.06, drag: 1, gravity: 0, color: 0x9fd8ff, alpha: 1 });
        }
      }
    }
  }

  _updateForce(dt, ctx) {
    if (this.gripBody || this.gripEnemy) this._updateGrip(dt, ctx);
  }

  /* ── damage & death ──────────────────────────────────────────────── */

  damage(amount, point, source, kind) {
    if (!this.alive || this.invuln > 0) return false;
    const scale = this.difficulty ? this.difficulty.damageTaken : 1;
    const dmg = amount * scale;
    this.hp -= dmg;
    this.invuln = 0.18;
    this.hitFlash = 1;
    this.flow = clamp(this.flow - 0.28, 0, 1);
    this.combo = 0;
    this.camera.addShake(clamp(dmg / 22, 0.12, 0.9));
    this.world.engine.hurt(clamp(dmg / 30, 0.2, 1));
    audio.boltHit(point || this.chest);
    if (dmg > 14) this.staggerTimer = Math.max(this.staggerTimer, 0.28);
    if (this.hp <= 0) { this.hp = 0; this.die(source); return true; }
    return false;
  }

  heal(v) { this.hp = Math.min(this.maxHp, this.hp + v); }

  die(source) {
    if (!this.alive) return;
    this.alive = false;
    this.releaseGrip();
    if (this.senseActive) this.toggleSense(this.world);
    this.saber.retract();
    this.hum.retract();
    this.world.onPlayerDeath?.(this, source);
    audio.ui('bad');
    // collapse
    import('./Ragdoll.js').then(({ Actor }) => {
      this.actor = new Actor(this.world.scene, this.world.physics, this.rig, {
        mass: 78, layer: LAYER.RAGDOLL, bladeColor: this.saber.color.getHex(),
      });
      this.actor.goRagdoll(this.velocity.clone().multiplyScalar(0.7), new THREE.Vector3(0, 2, 0));
    });
  }

  _updateDead(dt, ctx) {
    if (this.actor) this.actor.update(dt);
    this.camera.targetDistance = 4.4;
    this.camera.pitch = damp(this.camera.pitch, -0.42, 2, dt);
    const t = this.actor ? this.actor.centre(_v1) : this.position;
    this.camera.update(dt, _v2.copy(t).setY(t.y - 0.6), { physics: ctx.physics, terrain: ctx.terrain });
    this.saber.update(dt, ctx.time);
  }

  respawn(pos) {
    this.alive = true;
    this.hp = this.maxHp; this.force = this.maxForce; this.stamina = this.maxStamina;
    this.flow = 0; this.combo = 0;
    this.velocity.set(0, 0, 0);
    if (pos) this.position.copy(pos);
    this.invuln = 2.2;
    if (this.actor) { this.actor.dispose(); this.actor = null; }
    const built = buildJedi({ robeIndex: this.world.settings.robeIndex ?? 0 });
    this.rig = built.rig;
    this.palette = built.palette;
    this.world.scene.add(this.rig.root);
    this.animator = new BipedAnimator(this.rig, { scale: 1, hipHeight: 0.95 });
    this.animator.onFootstep = (p, s) => this._footstep(p, s);
    this._applyViewMode();
    this.saber.ignite();
    this.hum.ignite();
  }

  /* ── boons ───────────────────────────────────────────────────────── */

  applyBoon(boon) {
    this.boons.add(boon.id);
    boon.apply(this);
  }

  dispose() {
    this.hum.dispose();
    this.saber.dispose();
    if (this.actor) this.actor.dispose();
    else { this.world.scene.remove(this.rig.root); this.rig.dispose(); }
    this.world.physics.remove(this.body);
  }
}

const _axis = { x: 0, y: 0 };
const _axis0 = { x: 0, y: 0 };
