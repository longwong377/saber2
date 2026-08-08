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
import { clamp, lerp, damp, smoothstep, shortestArc, quatToRotVec, Ema, TAU } from '../engine/MathUtil.js';

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
 * How much warning the deflection assist works with, in seconds. Everything
 * about the assist is expressed against this: `DIFFICULTY.assist` is the share
 * of your aiming error it closes across one of these. 0.9 s is a little over
 * human reaction time, so the assist is finishing a movement you have started
 * rather than making one you never began.
 */
const ASSIST_LEAD = 0.9;

/**
 * THRUST envelope, in seconds. The old thrust was `this.thrust = 1` followed by
 * `damp(thrust, 0, 9, dt)` every frame — an instantaneous spike that had decayed
 * to 22% by 150 ms. The hands chase it through a spring whose own rise time is
 * ~400 ms (lin 118, linD 15 → ω 10.9 rad/s, ζ 0.69), so the target was gone
 * before the hands could get anywhere near it: a standing thrust moved the tip
 * 11.5 cm. That is not a stab, and it is exactly why "how do you stab when
 * standing still?" has no answer in the current build.
 *
 * A real envelope instead: drive to full in `rise`, HOLD there through `hold` so
 * the spring has time to arrive, then recover. The hold is the part that makes
 * it read as a lunge rather than a twitch.
 */
const THRUST = { rise: 0.07, hold: 0.13, fall: 0.20 };

/**
 * How far a thrust drives the hands and the guard point, in metres, at full
 * extension. 0.30/0.34 was the old pair and it was never reached; these are
 * reached, so they are the numbers that actually set the reach.
 *
 * A standing thrust gets the LONGER of the two: with no legs behind it the
 * whole lunge has to come from the arms and shoulders, and a stab you take from
 * a standstill should still cross the gap a walking one covers with its feet.
 */
const THRUST_REACH = { hand: 0.34, guard: 0.40, standing: 1.55 };

/**
 * FLOURISH — an idle twirl. Purely cosmetic: it drives roll and traces the
 * guard round a small circle, and it touches nothing that grades a contact.
 * 0.62 s is two full wrist rotations at a speed a hand can actually make.
 */
const FLOURISH = { dur: 0.62, turns: 2, radius: 0.30 };

/**
 * WHERE THE BLADE RESTS when you are not steering it, per view mode, in units
 * of max deflection. This table is the ONLY place these two numbers exist:
 * `readyX`/`readyY` are set from it and from nowhere else, and tools/checks/
 * feel.mjs fails the build if any other file assigns to them.
 *
 * That check is not paranoia. Commit 2e23892 lowered the third-person `y` from
 * 0.30 to 0.08 precisely to answer "the cursor feels way too high" — and
 * Player._applyViewMode set it straight back to 0.30 two lines of another file
 * away, so the fix shipped and was undone in the same build. Measured: 0.30 ×
 * maxPitch 1.28 rad = 22.0 deg above screen centre, which is where every
 * deflection had to start by dragging back down to the middle before you could
 * begin aiming.
 *
 *   third  0.08 → 5.9 deg up. A hint of high guard rather than a handicap; a
 *          guard IS carried high, but the blade cursor is what you aim with and
 *          it belongs near the middle of the screen.
 *   first  0.02 → 1.5 deg up. Over-the-shoulder height reads well in third
 *          person but leaves first person staring at the flat of the blade, so
 *          it drops further and crosses the lower view.
 *
 * `x` is the same story sideways: 0.30 × maxYaw 1.62 = 27.8 deg right, pulled
 * in slightly in first person because the weapon is nearer the lens.
 */
export const READY_GUARD = {
  third: { x: 0.30, y: 0.08 },
  first: { x: 0.26, y: 0.02 },
};

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

    // Where the blade sits when you are not steering it. Releasing the mouse
    // returns to this, rather than leaving the blade wherever the last flick
    // abandoned it. Set from READY_GUARD and from nowhere else — call
    // setViewMode() to change it, never assign readyX/readyY directly.
    this.readyX = 0; this.readyY = 0;
    this.setViewMode(false);
    this.recentre = 5.5;     // rad/s of easing back to the ready guard
    // The camera does NOT move while you are steering the blade. A full
    // left-to-right slash has to fit INSIDE the cone, or every slash spills
    // over and spins the view — which is exactly what made horizontal slashing
    // while strafing impossible.
    this.overflowTurn = 0;
    // Blade travel is ~2.0 units corner to corner, so at this gain a full slash
    // is about 350px of mouse: one comfortable sweep, not an arm's length.
    this.bladeGain = 0.0057;
    this.camGain = 0.0024;
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

    // thrust / lunge. `thrust` is the 0..1 envelope the solver reads; `thrustT`
    // is where we are along it in seconds, and `thrustStanding` is latched at
    // the press so a lunge that starts still stays a standing lunge even if you
    // begin walking halfway through it.
    this.thrust = 0;
    this.thrustT = -1;
    this.thrustStanding = 0;
    this.thrustCooldown = 0;

    // Flourish — an idle twirl with no combat effect at all. It is carried as an
    // ADDITIVE offset on the guard and the wrist (_flX/_flY/_flRoll), removed
    // and re-applied every frame, so starting one does not snap the guard to the
    // middle of the circle and finishing one does not snap it back.
    this.flourishT = -1;
    this.flourish = 0;
    this._flX = 0; this._flY = 0; this._flRoll = 0;

    /**
     * LATERAL GUARD. "How do I position the blade laterally? Imagine a guard
     * stance?" — you could not, and the reason was geometric rather than a
     * missing keybind. Both the hands and the guard point sit along the SAME
     * ray out of the chest, so the blade always pointed radially outward: it
     * could be aimed anywhere on the sphere but never laid ACROSS the body.
     * Measured over the whole reachable guard, the blade never once crossed the
     * player's own centreline.
     *
     * `stance` splits that ray. The hands go one way off it and the guard point
     * the other, so the blade lies across the chest — a horizontal guard you can
     * hold. -1 is hands-left/tip-right, +1 is the mirror.
     */
    this.stance = 0;
    this.stanceTarget = 0;
    this.stanceRate = 9;

    /**
     * Catch window. Set from outside (World) to the seconds left on a caught
     * bolt. While it is positive the camera comes BACK to the player even with
     * the blade button held, and the guard freezes where it is — it is holding
     * something.
     */
    this.catchHold = 0;
    this.bladeHeld = false;

    /**
     * "Blade holds position": on release the blade stays where you left it
     * instead of easing back to the ready guard. Off by default, because the
     * recentre is what makes the blade cursor a cursor.
     */
    this.holdPosition = opts.holdPosition ?? false;

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
    this.stance = 0; this.stanceTarget = 0;
    this.thrust = 0; this.thrustT = -1; this.thrustStanding = 0;
    this.flourish = 0; this.flourishT = -1;
    this._flX = 0; this._flY = 0; this._flRoll = 0;
    this.catchHold = 0; this.bladeHeld = false;
    this.initialised = false;
    this.solveTargets(chest, aimQuat, 0);
    this.handLocal.subVectors(this._handTarget, chest);
    this.handPos.copy(this._handTarget);
    this.quat.copy(this._targetQuat);
    this.initialised = true;
  }

  setScheme(s) { this.scheme = s; }

  /**
   * The blade cursor's resting place, chosen by view mode. The one door onto
   * readyX/readyY: a caller says WHICH POSE it wants, never what the numbers
   * are, so the pair can only ever be tuned in READY_GUARD above.
   */
  setViewMode(firstPerson) {
    const r = firstPerson ? READY_GUARD.first : READY_GUARD.third;
    this.readyX = r.x;
    this.readyY = r.y;
    return this;
  }

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
   *
   * The two actions this file reads that nothing else does — `stance` and
   * `flourish` — are ordinary entries in Bindings.js like every other control.
   * They used to be seeded onto KeyB and KeyN here at runtime behind a one-shot
   * flag, which meant they were absent from the ACTIONS table: not rebindable,
   * not listed in the options screen, and silently sharing their keys with the
   * stasis field, rend, and the dojo's own lesson navigation. A feature the
   * player cannot find does not exist.
   */
  applyInput(input, dt, ctx) {
    const cam = { yaw: 0, pitch: 0 };
    if (this.locked) return cam;

    // One control at a time. Hold the mouse button and the mouse IS the blade —
    // the camera does not move. Let go and the mouse is the camera again, and
    // the blade settles back to guard. Driving both at once, which is what the
    // old blade-leads-camera scheme did, makes neither of them legible.
    // 'blade' is a rebindable action, so the player can move it off LMB.
    const bladeHeld = this.scheme === 'free' ? !input.act('thrust') : input.act('blade');
    this.bladeHeld = bladeHeld;
    // …except while a bolt is caught. Then the camera comes back immediately and
    // fully, button or no button, because the whole reason the bolt is stuck to
    // the blade is to give you the camera back long enough to aim the throw.
    // This is the one line that turns block-and-aim from simultaneous — which is
    // impossible — into sequential.
    const bladeMode = bladeHeld && this.catchHold <= 0;
    // Two separate gains: the blade needs a full arc inside one sweep, the
    // camera needs shooter-normal turn rates. Sharing one number made the blade
    // sluggish or the camera twitchy, depending which you tuned for.
    const s = this.sensitivity * this.bladeGain;
    const cs = this.sensitivity * this.camGain;
    const dx = input.mouse.dx, dy = input.mouse.dy;

    if (bladeMode) {
      this.steering = 1;
      // While you hold the button the mouse is purely the blade and the view
      // does not move at all. The cone is wide enough that a full left-to-right
      // slash fits inside it in one sweep, which is the whole point: an earlier
      // version let a push past the cone turn the camera, and since a real
      // slash overshoots the cone every time, every slash spun the view and
      // horizontal attacks while strafing were impossible. overflowTurn is kept
      // as a knob but ships at zero.
      // gx and gy are in units of their OWN max deflection, and those maxima are
      // not equal: yaw reaches 1.62 rad, pitch only 1.28. Sharing one gain
      // therefore turned one pixel of mouse into 1.27x more ANGLE sideways than
      // vertically, so a straight overhead pull curved off to the side under
      // nothing worse than normal hand wobble, and a diagonal never went where
      // it was aimed. Scaling the vertical term by the ratio makes a pixel mean
      // the same angle whichever way you move it.
      const wantX = this.gx + dx * s;
      const wantY = this.gy - dy * s * (this.maxYaw / this.maxPitch);
      this.gx = clamp(wantX, -GX_MAX, GX_MAX);
      this.gy = clamp(wantY, -GY_MIN, GY_MAX);
      cam.yaw -= (wantX - this.gx) * this.maxYaw * this.overflowTurn;
      cam.pitch += (wantY - this.gy) * this.maxPitch * this.overflowTurn * 0.7;

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
      cam.yaw = -dx * cs;
      cam.pitch = -dy * cs;
      // The blade does not drift home while it is holding a caught bolt, and it
      // does not drift home at all if the player asked it not to.
      if (this.catchHold <= 0 && !this.holdPosition) {
        const k = clamp(dt * this.recentre, 0, 1);
        this.gx = lerp(this.gx, this.readyX, k);
        this.gy = lerp(this.gy, this.readyY, k);
      }
    }

    // wrist roll
    let rollInput = 0;
    if (input.act('rollL')) rollInput -= 1;
    if (input.act('rollR')) rollInput += 1;
    rollInput += input.mouse.wheel * 0.55;
    if (input.padButtons) {
      if (input.padDown(4)) rollInput -= 1;
      if (input.padDown(5)) rollInput += 1;
    }
    this.rollVel = damp(this.rollVel, rollInput * 5.4, 14, dt);
    this.roll += this.rollVel * dt;

    // ── LATERAL GUARD. Held, not toggled: a guard stance is a thing you stand
    // in. Which side leads comes from where the guard already is, so one binding
    // reaches both the left-lead and the right-lead horizontal guard — drift the
    // cursor across the centre and the blade turns over with you.
    if (input.act('stance')) {
      const side = Math.abs(this.gx) > 0.06 ? Math.sign(this.gx) : (this.stanceTarget || 1);
      this.stanceTarget = side;
    } else this.stanceTarget = 0;
    this.stance = damp(this.stance, this.stanceTarget, this.stanceRate, dt);

    // ── FLOURISH. No combat effect: it drives roll and the guard point and
    // nothing else, and any real intent — steering, stancing, stabbing —
    // cancels it on the spot.
    //
    // Take last frame's twirl back off the guard and the wrist before anything
    // else touches them. The flourish is decoration ON TOP of whatever the blade
    // is already doing, so it must never leave a residue: without this, starting
    // one snapped the guard to the centre of the circle and cancelling one left
    // the wrist wherever the twirl had got to.
    this.gx -= this._flX; this.gy -= this._flY; this.roll -= this._flRoll;
    this._flX = 0; this._flY = 0; this._flRoll = 0;
    if (input.actHit('flourish') && this.flourishT < 0 && !bladeHeld) this.flourishT = 0;
    if (this.flourishT >= 0) {
      if (bladeHeld || this.stanceTarget || this.thrustT >= 0) this.flourishT = -1;
      else {
        this.flourishT += dt;
        if (this.flourishT >= FLOURISH.dur) this.flourishT = -1;
      }
    }
    // Ease in and out so the twirl grows out of the guard and settles back into
    // it rather than snapping onto a circle and snapping off it again.
    this.flourish = this.flourishT < 0 ? 0
      : Math.sin(Math.PI * clamp(this.flourishT / FLOURISH.dur, 0, 1));
    if (this.flourishT >= 0) {
      const ph = TAU * FLOURISH.turns * (this.flourishT / FLOURISH.dur);
      this._flRoll = ph;
      // Clamp the OFFSET rather than the result, so next frame's subtraction is
      // still exact and the guard cannot be twirled outside its own travel.
      this._flX = clamp(this.gx + Math.sin(ph) * FLOURISH.radius * this.flourish, -GX_MAX, GX_MAX) - this.gx;
      this._flY = clamp(this.gy + Math.cos(ph) * FLOURISH.radius * this.flourish, -GY_MIN, GY_MAX) - this.gy;
    }
    this.gx += this._flX; this.gy += this._flY; this.roll += this._flRoll;

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

    // ── THRUST. A genuine forward drive of the hands along the blade, run off a
    // rise/hold/fall envelope rather than a spike, because the hands are on a
    // spring that takes ~400 ms to arrive and a spike is gone before they do.
    this.thrustCooldown = Math.max(0, this.thrustCooldown - dt);
    const stabPressed = this.scheme === 'free' ? input.actHit('blade') : input.actHit('thrust');
    if (stabPressed && this.thrustCooldown <= 0 && ctx.stamina > 0.12) {
      this.thrustT = 0;
      // A lunge with no feet behind it has to come entirely out of the arms, so
      // it gets more of them. The controller works this out from how fast the
      // chest anchor it is handed each frame is actually travelling — 1.2 m/s
      // is a quarter of walking pace, i.e. genuinely planted. Callers may say so
      // explicitly with ctx.moving, but none has to.
      this.thrustStanding = (ctx.moving ?? this.carrierSpeed > 1.2) ? 0 : 1;
      this.thrustCooldown = 0.42;
      if (ctx.onThrust) ctx.onThrust();
    }
    if (this.thrustT >= 0) {
      this.thrustT += dt;
      const T = THRUST;
      if (this.thrustT < T.rise) this.thrust = smoothstep(0, T.rise, this.thrustT);
      else if (this.thrustT < T.rise + T.hold) this.thrust = 1;
      else {
        this.thrust = 1 - smoothstep(T.rise + T.hold, T.rise + T.hold + T.fall, this.thrustT);
        if (this.thrustT >= T.rise + T.hold + T.fall) { this.thrust = 0; this.thrustT = -1; }
      }
    } else this.thrust = 0;

    return cam;
  }

  /* ── targets ───────────────────────────────────────────────────────── */

  solveTargets(chest, aimQuat, dt) {
    const g = GRIPS[this.grip];
    this._grip = g;

    // A standing stab gets THRUST_REACH.standing times the reach of a moving
    // one; a moving one has a body behind it already.
    const reach = this.thrust * lerp(1, THRUST_REACH.standing, this.thrustStanding);
    const gd = this.guardDir(aimQuat, _v1);
    // In a lateral guard the guard point comes back IN to the hands' own radius.
    // What is then left between hands and guard is almost purely the sideways
    // offset applied below — which is the difference between a blade angled
    // across you (64 deg, what a bare lateral offset gives) and a bar laid
    // across you (85 deg). 5 cm of forward gap is all that is kept, and only so
    // the blade still has a direction to point in.
    const sAbs = Math.abs(this.stance);
    const guardR = lerp(g.guardR, g.handExtend + 0.05, sAbs) + reach * THRUST_REACH.guard;
    const guardWorld = _v2.copy(chest).addScaledVector(gd, guardR);

    // hands: partway along the guard direction, offset into the body
    _v3.copy(g.offset).applyQuaternion(aimQuat);
    const handTarget = _v4.copy(chest).add(_v3).addScaledVector(gd, g.handExtend + reach * THRUST_REACH.hand);

    // ── LATERAL GUARD. Split the hands off the guard ray in one direction and
    // the guard point in the other, about an axis perpendicular to both the
    // guard direction and world up. That is what lays the blade across the body
    // instead of along a spoke out of it: at |stance| = 1 the hilt sits on one
    // side of your centreline and the tip on the other.
    //
    // 0.30 m of hand and 0.34 m of guard is the whole travel. Bigger and the
    // arms cross the ribs; smaller and the blade is merely tilted, not laid
    // across — measured, |stance| = 1 puts the blade 8.5 deg off horizontal.
    if (sAbs > 0.001) {
      _v3.crossVectors(gd, UP);
      if (_v3.lengthSq() < 1e-6) _v3.set(1, 0, 0).applyQuaternion(aimQuat);
      _v3.normalize();
      handTarget.addScaledVector(_v3, -this.stance * 0.30);
      guardWorld.addScaledVector(_v3, this.stance * 0.34);
      // A guard across the body is carried level. Without this the hands' own
      // 20 cm drop below the guard point tilts the bar 17 deg, and the blade
      // rides up with whatever elevation the cursor happened to have.
      guardWorld.y = handTarget.y + (guardWorld.y - handTarget.y) * (1 - sAbs * 0.85);
    }

    // Never let the hands leave arm's reach — except that a lunge is exactly the
    // move where the shoulder and the torso add to the arm, so the ceiling
    // lifts with the thrust rather than clipping the one action that needs it.
    _v5.subVectors(handTarget, chest);
    const armMax = 0.78 + this.thrust * 0.10;
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
    // How fast the body carrying the blade is moving. Read here rather than
    // asked for, so a standing thrust is detected without every caller having
    // to remember to say so.
    this._prevChest = this._prevChest || new THREE.Vector3().copy(chest);
    if (dt > 1e-5) {
      const v = _v1.subVectors(chest, this._prevChest).length() / dt;
      this.carrierSpeed = damp(this.carrierSpeed ?? 0, v, 12, dt);
    }
    this._prevChest.copy(chest);

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
   * Difficulty assist: bias the guard toward an incoming threat. At Grandmaster
   * this is zero and the blade is entirely yours.
   *
   * `this.assist` is the FRACTION OF THE GUARD ERROR CLOSED over one full
   * ASSIST_LEAD of approach. 0.92 means a bolt you had 0.9 s of warning about
   * arrives with 8% of your original aiming error left. That is a number you can
   * reason about and tune against the ±12.5 cm capture window, which the old
   * formula was not: it was `assist · urgency · clamp(dt·5.5, 0, 0.4)`, which at
   * Knight closed 26% of the error over a whole flight and at Master 6%. The
   * tiers all claimed to guide your guard and none of them did.
   *
   * Two things were wrong beyond the gain, and both inverted the feature:
   *
   *   • Threats were SCORED BY ALIGNMENT WITH THE GUARD YOU ALREADY HAD, then
   *     vetoed outright on `bestScore <= 0`. So the further your guard was from
   *     the bolt — the only situation where assist is worth anything — the less
   *     it did, and past 123° off it switched itself off completely.
   *   • The engagement gate was 12 m of DISTANCE, which is 0.40 s of warning at
   *     Padawan's 30 m/s but only 0.19 s at Grandmaster's 63 m/s. Difficulty
   *     was silently shortening the assist window on top of everything else.
   *
   * Selection is now by time-to-impact among threats that are actually in front
   * of you, and the gate is in seconds, so every tier gets the same warning and
   * the tier number alone decides how much of the work is done for you.
   */
  applyAssist(threats, chest, aimQuat, dt) {
    if (this.assist <= 0.001 || !threats.length || dt <= 0) return;

    // Forward is the AIM direction, never the guard direction — a bolt coming
    // at your face is equally your problem whichever way the blade is pointing.
    _v4.set(0, 0, -1).applyQuaternion(aimQuat);
    let best = null, bestEta = Infinity;
    for (const t of threats) {
      if (!(t.eta >= 0) || t.eta > ASSIST_LEAD || t.eta >= bestEta) continue;
      _v2.subVectors(t.point, chest);
      const d = _v2.length();
      if (d < 0.4) continue;                       // already on top of you
      // A bolt that has gone past is not a threat, whatever its eta says.
      // threatsNear() already drops these, but the guard is one line and this
      // function should not be able to chase a receding bolt because a caller
      // handed it a stale list.
      if (t.bolt && t.bolt.vel && _v2.dot(t.bolt.vel) > 0) continue;
      _v2.multiplyScalar(1 / d);
      // Nothing behind the shoulder line: you cannot bring a guard there, and
      // dragging toward it would only pull you off the bolts you can answer.
      if (_v2.dot(_v4) < -0.17) continue;          // 100° half-cone
      bestEta = t.eta;
      best = _v5.copy(_v2);
    }
    if (!best) return;

    // convert the threat direction into guard coordinates
    _v3.copy(best).applyQuaternion(_q1.copy(aimQuat).invert());
    const yaw = Math.atan2(_v3.x, -_v3.z);
    const pitch = Math.asin(clamp(_v3.y, -1, 1));
    const tx = clamp(yaw / this.maxYaw, -GX_MAX, GX_MAX);
    const ty = clamp(pitch / this.maxPitch, -GY_MIN, GY_MAX);

    // Exponential approach expressed so that a full ASSIST_LEAD of it closes
    // exactly `assist` of the error, whatever the frame rate: compounding
    // (1 − k) over ASSIST_LEAD/dt frames returns (1 − assist) by construction.
    const k = 1 - Math.pow(1 - clamp(this.assist, 0, 0.999), dt / ASSIST_LEAD);
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
