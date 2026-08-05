/**
 * SABER — blade control.
 *
 * This is the game. Everything else is scenery.
 *
 * The mouse drives a guard point on a sphere in front of the chest. The hands
 * follow it partway; the blade points from the hands through the guard point.
 * Neither the hands nor the blade get there instantly — both are integrated
 * through a spring-damper with real inertia, so the weapon lags a flick,
 * overshoots a snap, and hangs when you decelerate.
 *
 * Accels, decels, drags and feints are not moves. They are what happens when a
 * heavy object is attached to your wrist and you change your mind.
 */

import * as THREE from 'three';
import { clamp, lerp, damp, smoothstep, shortestArc, quatToRotVec, Ema } from '../engine/MathUtil.js';

const _v1 = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3();
const _v4 = new THREE.Vector3(), _v5 = new THREE.Vector3();
const _q1 = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _q3 = new THREE.Quaternion();
const _m = new THREE.Matrix4();
const UP = new THREE.Vector3(0, 1, 0);

/**
 * Guard travel limits, in units of max deflection. At maxYaw = 1.62 rad,
 * GX_MAX = 1 puts the guard at 93 deg off centre — the edge of what a pair of
 * arms can hold in front of the chest. The old 1.35 reached 125 deg, behind
 * the shoulder, where the only IK solution runs the arm through the ribs.
 */
const GX_MAX = 1.0, GY_MAX = 1.05, GY_MIN = 1.0;
const YAXIS = new THREE.Vector3(0, 1, 0);

/**
 * The angular term integrates as  θ'' = (kP/I)·θ_err − kD·θ'.
 * Critical damping is therefore kD = 2·√(kP/I); everything here sits around a
 * damping ratio of 0.6, which is what gives the blade its weight — a flick
 * overshoots by roughly a tenth of the arc and swings back, exactly as a
 * metre of metal on the end of your wrist would.
 */
export const GRIPS = {
  two:  { kP: 156, kD: 15.0, inertia: 1.00, guardR: 0.60, handExtend: 0.29, offset: new THREE.Vector3(0.055, -0.20, 0.02), lin: 118, linD: 15 },
  one:  { kP: 118, kD: 13.6, inertia: 0.74, guardR: 0.72, handExtend: 0.36, offset: new THREE.Vector3(0.185, -0.13, 0.0), lin: 92,  linD: 13 },
  rev:  { kP: 132, kD: 14.4, inertia: 0.86, guardR: 0.58, handExtend: 0.26, offset: new THREE.Vector3(-0.14, -0.06, 0.03), lin: 104, linD: 14 },
};

export class SaberController {
  constructor(opts = {}) {
    // guard point, in units of max deflection (-1..1)
    this.gx = 0.18;
    this.gy = 0.12;
    this.maxYaw = 1.62;      // rad at |gx| = 1
    this.maxPitch = 1.28;
    this.roll = 0;
    this.rollVel = 0;

    this.sensitivity = opts.sensitivity ?? 1;
    this.followStrength = opts.followStrength ?? 0;
    this.deadzone = 0.24;
    this.scheme = opts.scheme ?? 'hold';     // 'hold' | 'free'

    // Where the blade sits when you are not steering it: a high right guard.
    // Releasing the mouse returns to this, rather than leaving the blade
    // wherever the last flick abandoned it.
    this.readyX = 0.30;
    this.readyY = 0.30;
    this.recentre = 5.5;     // rad/s of easing back to the ready guard
    this.steering = 0;       // 1 while the player is actually driving the blade

    this.grip = 'two';
    this.gripBlend = 1;

    // Integrated blade state. handLocal is the hand offset from the chest and
    // is what actually gets integrated: a spring chasing a world-space target
    // lags by v·kD/kP, which at a run is over half a metre — the blade trailed
    // behind the body like a windsock any time you moved.
    this.handLocal = new THREE.Vector3();
    this.handPos = new THREE.Vector3();
    this.handVel = new THREE.Vector3();
    this.quat = new THREE.Quaternion();
    this.angVel = new THREE.Vector3();
    this.initialised = false;

    // gesture analysis
    this.mouseSpeed = new Ema(18);
    this.mouseAccel = new Ema(12);
    this.swingEnergy = 0;
    this.commitment = 0;       // 0 = free to reverse, 1 = fully committed
    this.lastGestureDir = new THREE.Vector2();
    this.gestureDir = new THREE.Vector2();

    // thrust / lunge
    this.thrust = 0;
    this.thrustCooldown = 0;

    // bind (blade lock) state
    this.bindContact = null;
    this.bindPush = 0;

    // strain from contacts — a blocked blade is physically pushed
    this.impulseAng = new THREE.Vector3();
    this.impulseLin = new THREE.Vector3();

    this.assist = 0;
    this.stamina = 1;
    this.flow = 0;
    this.locked = false;
  }

  reset(chest, aimQuat) {
    this.gx = this.readyX; this.gy = this.readyY; this.roll = 0;
    this.handVel.set(0, 0, 0); this.angVel.set(0, 0, 0);
    this.initialised = false;
    this.solveTargets(chest, aimQuat, 0);
    this.handLocal.subVectors(this._handTarget, chest);
    this.handPos.copy(this._handTarget);
    this.quat.copy(this._targetQuat);
    this.initialised = true;
  }

  setScheme(s) { this.scheme = s; }

  /** Guard direction in world space. */
  guardDir(aimQuat, out = new THREE.Vector3()) {
    const yaw = this.gx * this.maxYaw;
    const pitch = this.gy * this.maxPitch;
    out.set(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch));
    return out.applyQuaternion(aimQuat).normalize();
  }

  /* ── input ─────────────────────────────────────────────────────────── */

  /**
   * Consume mouse motion. Returns the camera yaw/pitch delta the blade wants
   * the view to follow (Free Blade) — the caller applies it to the camera.
   */
  applyInput(input, dt, ctx) {
    const cam = { yaw: 0, pitch: 0 };
    if (this.locked) return cam;

    // One control at a time. Hold the mouse button and the mouse IS the blade —
    // the camera does not move. Let go and the mouse is the camera again, and
    // the blade settles back to guard. Driving both at once, which is what the
    // old blade-leads-camera scheme did, makes neither of them legible.
    const bladeMode = this.scheme === 'free' ? !input.buttons[2] : input.buttons[0];
    const s = this.sensitivity * 0.0021;
    const dx = input.mouse.dx, dy = input.mouse.dy;

    if (bladeMode) {
      this.steering = 1;
      this.gx = clamp(this.gx + dx * s, -GX_MAX, GX_MAX);
      this.gy = clamp(this.gy - dy * s, -GY_MIN, GY_MAX);

      // Optional, off by default: let the camera drift after a blade that has
      // left the deadzone, pulling the guard back by the same amount so the
      // blade stays put in the world while the view swings to meet it.
      const f = this.followStrength;
      if (f > 0.001) {
        const ox = Math.abs(this.gx) > this.deadzone ? (this.gx - Math.sign(this.gx) * this.deadzone) : 0;
        const oy = Math.abs(this.gy) > this.deadzone * 1.3 ? (this.gy - Math.sign(this.gy) * this.deadzone * 1.3) : 0;
        const rate = clamp(f * 7.5 * dt, 0, 0.6);
        const cy = ox * this.maxYaw * rate;
        const cp = oy * this.maxPitch * rate * 0.72;
        cam.yaw = -cy;
        cam.pitch = cp;
        this.gx -= cy / this.maxYaw;
        this.gy -= cp / this.maxPitch;
      }
    } else {
      this.steering = 0;
      // camera-only. The guard is body-relative, so it simply rides round with
      // the shoulders — it must NOT be counter-rotated to stay world-fixed, or
      // turning ninety degrees pins the blade against its own travel limit.
      cam.yaw = -dx * s * 1.15;
      cam.pitch = -dy * s * 1.15;
      const k = clamp(dt * this.recentre, 0, 1);
      this.gx = lerp(this.gx, this.readyX, k);
      this.gy = lerp(this.gy, this.readyY, k);
    }

    // wrist roll
    let rollInput = 0;
    if (input.down('KeyQ')) rollInput -= 1;
    if (input.down('KeyE')) rollInput += 1;
    rollInput += input.mouse.wheel * 0.55;
    if (input.padButtons) {
      if (input.padDown(4)) rollInput -= 1;
      if (input.padDown(5)) rollInput += 1;
    }
    this.rollVel = damp(this.rollVel, rollInput * 5.4, 14, dt);
    this.roll += this.rollVel * dt;

    // gesture signal
    const gspeed = Math.hypot(dx, dy) / Math.max(dt, 1e-4);
    this.mouseSpeed.push(gspeed, dt);
    if (gspeed > 1) {
      this.gestureDir.set(dx, dy).normalize();
      const dot = this.gestureDir.dot(this.lastGestureDir);
      // a reversal releases commitment: this is what makes feints real
      if (dot < -0.15) this.commitment *= 0.35;
      this.lastGestureDir.copy(this.gestureDir);
    }
    this.mouseAccel.push(Math.hypot(input.accel.x, input.accel.y), dt);

    // thrust — a genuine forward drive of the hands along the blade
    this.thrustCooldown = Math.max(0, this.thrustCooldown - dt);
    const stabPressed = this.scheme === 'free' ? input.buttonPressed[0] : input.buttonPressed[2];
    if (stabPressed && this.thrustCooldown <= 0 && ctx.stamina > 0.12) {
      this.thrust = 1;
      this.thrustCooldown = 0.42;
      if (ctx.onThrust) ctx.onThrust();
    }
    this.thrust = damp(this.thrust, 0, 9, dt);

    return cam;
  }

  /* ── targets ───────────────────────────────────────────────────────── */

  solveTargets(chest, aimQuat, dt) {
    const g = GRIPS[this.grip];
    this._grip = g;

    const gd = this.guardDir(aimQuat, _v1);
    const guardWorld = _v2.copy(chest).addScaledVector(gd, g.guardR + this.thrust * 0.34);

    // hands: partway along the guard direction, offset into the body
    _v3.copy(g.offset).applyQuaternion(aimQuat);
    const handTarget = _v4.copy(chest).add(_v3).addScaledVector(gd, g.handExtend + this.thrust * 0.30);

    // never let the hands leave arm's reach
    _v5.subVectors(handTarget, chest);
    const armMax = 0.78;
    if (_v5.length() > armMax) { _v5.setLength(armMax); handTarget.copy(chest).add(_v5); }

    this._handTarget = this._handTarget || new THREE.Vector3();
    this._handTarget.copy(handTarget);

    // blade direction: hands → guard point
    const dir = _v5.subVectors(guardWorld, handTarget);
    if (dir.lengthSq() < 1e-6) dir.copy(gd);
    dir.normalize();
    this._bladeDir = this._bladeDir || new THREE.Vector3();
    this._bladeDir.copy(dir);

    // orientation: +Y along the blade, rolled about it
    _q1.setFromUnitVectors(YAXIS, dir);
    _q2.setFromAxisAngle(dir, this.roll);
    this._targetQuat = this._targetQuat || new THREE.Quaternion();
    this._targetQuat.copy(_q2).multiply(_q1);
    return this._targetQuat;
  }

  /* ── integration ───────────────────────────────────────────────────── */

  update(dt, chest, aimQuat, ctx = {}) {
    this.solveTargets(chest, aimQuat, dt);
    if (!this.initialised) {
      this.handLocal.subVectors(this._handTarget, chest);
      this.handPos.copy(this._handTarget);
      this.quat.copy(this._targetQuat);
      this.initialised = true;
      return;
    }

    const g = this._grip;
    this.stamina = ctx.stamina ?? 1;
    this.flow = ctx.flow ?? 0;

    // Stamina and Flow change the weapon's character: a tired arm is heavy and
    // sloppy, a Jedi in Flow holds a line that does not waver.
    const fatigue = lerp(0.52, 1, smoothstep(0.02, 0.5, this.stamina));
    const focus = 1 + this.flow * 0.30;
    const riposte = ctx.riposte ? 1.42 : 1;

    let kP = g.kP * fatigue * focus * riposte * (ctx.stiffnessScale ?? 1);
    let kD = g.kD * lerp(1.12, 0.9, this.flow) * (ctx.dampingScale ?? 1);

    // Commitment: while the blade carries momentum in a direction, it resists
    // being redirected. That resistance is what gives a swing follow-through
    // and what makes a genuine feint cost something.
    const wLen = this.angVel.length();
    this.swingEnergy = damp(this.swingEnergy, wLen, 10, dt);
    quatToRotVec(_q1.copy(this._targetQuat).multiply(_q2.copy(this.quat).invert()), _v1);
    const errLen = _v1.length();
    if (wLen > 3.2 && errLen > 0.35) {
      const align = _v1.dot(this.angVel) / (errLen * wLen + 1e-6);
      const against = clamp(-align, 0, 1);
      this.commitment = damp(this.commitment, against * clamp(wLen / 16, 0, 1), 9, dt);
      kP *= lerp(1, 0.42, this.commitment);
    } else {
      this.commitment = damp(this.commitment, 0, 6, dt);
    }

    // angular spring–damper with inertia
    const invI = 1 / (g.inertia * (ctx.inertiaScale ?? 1));
    _v2.copy(_v1).multiplyScalar(kP * invI).addScaledVector(this.angVel, -kD);
    _v2.add(this.impulseAng);
    this.impulseAng.multiplyScalar(Math.max(0, 1 - dt * 14));

    this.angVel.addScaledVector(_v2, dt);
    const maxW = 42;
    if (this.angVel.lengthSq() > maxW * maxW) this.angVel.setLength(maxW);

    // integrate the quaternion
    _q1.set(this.angVel.x * dt * 0.5, this.angVel.y * dt * 0.5, this.angVel.z * dt * 0.5, 0).multiply(this.quat);
    this.quat.x += _q1.x; this.quat.y += _q1.y; this.quat.z += _q1.z; this.quat.w += _q1.w;
    this.quat.normalize();

    // Linear spring for the hands, solved in the chest's frame. handVel is
    // therefore a velocity *relative to the body* — which is also exactly what
    // the spine lean and the blade-lock push want to read.
    _v5.subVectors(this._handTarget, chest);
    _v3.subVectors(_v5, this.handLocal).multiplyScalar(g.lin * fatigue);
    _v3.addScaledVector(this.handVel, -g.linD);
    _v3.add(this.impulseLin);
    this.impulseLin.multiplyScalar(Math.max(0, 1 - dt * 12));
    this.handVel.addScaledVector(_v3, dt);
    if (this.handVel.lengthSq() > 900) this.handVel.setLength(30);
    this.handLocal.addScaledVector(this.handVel, dt);

    // keep the hands within reach of the chest no matter what hit them
    const maxReach = 0.86, minReach = 0.16;
    const rl = this.handLocal.length();
    if (rl > maxReach) { this.handLocal.setLength(maxReach); this.handVel.multiplyScalar(0.5); }
    else if (rl < minReach) this.handLocal.setLength(minReach);
    this.handPos.copy(chest).add(this.handLocal);
  }

  /** External impulse on the blade — a parry, a bind, a bolt landing on it. */
  hitImpulse(worldPoint, impulse, angScale = 1) {
    _v1.subVectors(worldPoint, this.handPos);
    _v2.crossVectors(_v1, impulse).multiplyScalar(9.5 * angScale);
    this.impulseAng.add(_v2);
    this.impulseLin.addScaledVector(impulse, 5.5);
    this.commitment = 0;
  }

  /** Shove the guard point itself — used when a blade is physically blocked. */
  displaceGuard(dx, dy) {
    this.gx = clamp(this.gx + dx, -GX_MAX, GX_MAX);
    this.gy = clamp(this.gy + dy, -GY_MIN, GY_MAX);
  }

  /**
   * Difficulty assist: gently bias the guard toward an incoming threat. At
   * Grandmaster this is zero and the blade is entirely yours.
   */
  applyAssist(threats, chest, aimQuat, dt) {
    if (this.assist <= 0.001 || !threats.length) return;
    const gd = this.guardDir(aimQuat, _v1);
    let best = null, bestScore = -1;
    for (const t of threats) {
      _v2.subVectors(t.point, chest);
      const d = _v2.length();
      if (d < 0.4 || d > 12) continue;
      _v2.multiplyScalar(1 / d);
      const align = _v2.dot(gd);
      const urgency = 1 - clamp(t.eta / 0.55, 0, 1);
      const score = urgency * (0.35 + align * 0.65);
      if (score > bestScore) { bestScore = score; best = { dir: _v2.clone(), urgency }; }
    }
    if (!best || bestScore <= 0) return;
    // convert the threat direction into guard coordinates
    _v3.copy(best.dir).applyQuaternion(_q1.copy(aimQuat).invert());
    const yaw = Math.atan2(_v3.x, -_v3.z);
    const pitch = Math.asin(clamp(_v3.y, -1, 1));
    const tx = clamp(yaw / this.maxYaw, -GX_MAX, GX_MAX);
    const ty = clamp(pitch / this.maxPitch, -GY_MIN, GY_MAX);
    const k = this.assist * best.urgency * clamp(dt * 5.5, 0, 0.4);
    this.gx = lerp(this.gx, tx, k);
    this.gy = lerp(this.gy, ty, k);
  }

  /** Read-out used by the HUD to draw the blade cursor. */
  screenGuard(camera, chest, aimQuat, out = new THREE.Vector2()) {
    const gd = this.guardDir(aimQuat, _v1);
    _v2.copy(chest).addScaledVector(gd, this._grip ? this._grip.guardR : 0.6);
    _v2.project(camera);
    return out.set(_v2.x, _v2.y);
  }
}
