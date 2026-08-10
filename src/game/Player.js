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
import { SKIN_TONES, HAIR_COLORS } from '../ui/Menu.js';
import { Rig, BipedAnimator } from './Rig.js';
import { attachCloak, attachSkirt } from './Cloth.js';
import { Body, LAYER, capsuleSpheres, capsule } from '../physics/RapierWorld.js';
import { supportHeight, STEP_UP, GROUND_SNAP } from '../physics/Support.js';
import { clamp, lerp, damp, smoothstep, dampVec, makeRng, TAU } from '../engine/MathUtil.js';
import { audio } from '../engine/Audio.js';

const rng = makeRng(1212);
const _v1 = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3();
const _v4 = new THREE.Vector3(), _v5 = new THREE.Vector3(), _v6 = new THREE.Vector3();
const _q1 = new THREE.Quaternion(), _q2 = new THREE.Quaternion();
// The Force powers get scratch of their own. _v1.._v6 are threaded through the
// blade solve, the collide pass and the body pose in the same frame, and a
// gesture that borrowed one of them would corrupt whichever of those ran next —
// the exact class of bug that is invisible until an arm folds inside out.
const _g1 = new THREE.Vector3(), _g2 = new THREE.Vector3(), _g3 = new THREE.Vector3();
const _g4 = new THREE.Vector3(), _g5 = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);
const FWD = new THREE.Vector3(0, 0, -1);
/** Read-only stand-in for a missing pelvis offset. Never written to. */
const _ZERO = new THREE.Vector3();
/** Reused by syncAim, which runs twice a frame and must not allocate. */
const _eul = new THREE.Euler();

/* ══════════════════════════════════════════════════════════════════════ */
/*  The Force's one hard number                                           */
/* ══════════════════════════════════════════════════════════════════════ */

/**
 * How many kilograms a grip can hold at forcePower = 1, and how that scales.
 *
 * Before this there was no such number, and that was the bug. The grip wrote a
 * held body's VELOCITY directly, so — measured — a 900 kg pillar and a 22 kg
 * crate both travelled 5.01 m in the first second and a hurl launched every
 * mass in the game at exactly 26 m/s. Mass was invisible. The only real size
 * limit anywhere was Enemy.grippable (`!A.big && !A.boss`), a boolean no
 * setting could move: the 900 kg spider walker and the 1400 kg Acklay were
 * un-liftable at forcePower 4 exactly as they were at 0.25.
 *
 * 220 kg at 1x is read off the real mass table — it takes a droideka (210) and
 * a vaporator (180) but not a spire (500). The 1.5 exponent is read off the
 * ends of the slider: 0.25x lands at 27.5 kg, which is one crate and you feel
 * it; 4x lands at 1760 kg, which clears the heaviest body in the game with room
 * to spare. So the top of the slider genuinely moves genuinely large things,
 * and the middle of it is a progression rather than a switch.
 */
const LIFT_AT_ONE = 220;
const LIFT_EXPONENT = 1.5;

/**
 * Force gestures — the arm that reads the power.
 *
 * Every offset is in the AIM frame and in metres from the chest: `out` along
 * where you are looking, `side` to the player's right, `up` world up. `attack`
 * and `release` are seconds and are deliberately lopsided, because a Force
 * gesture is a snap and a settle; symmetric timing reads as a wave.
 *
 * `palm` rolls the hand from pointing at the target (0) to a flat palm facing
 * it (1). `lean` and `twist` are radians added to the spine, so the whole torso
 * commits instead of just the arm — a push you can only see in the forearm does
 * not look like it moved a crate.
 *
 * The saber lives in the right hand and the blade solve owns that arm outright,
 * so every gesture here is left-handed and pays for the rest of its read with
 * the spine, the head and the cloak.
 */
const GESTURES = {
  push:      { attack: 0.09, release: 0.40, out: 0.66, side: -0.04, up: 0.10, palm: 0.85, lean: 0.30, twist: -0.12 },
  pull:      { attack: 0.12, release: 0.46, out: -0.24, side: -0.36, up: 0.20, palm: 0.15, lean: -0.28, twist: 0.18 },
  grip:      { attack: 0.18, release: 0.26, out: 0.56, side: -0.14, up: 0.18, palm: 0.35, lean: 0.10, twist: -0.08, sustain: true, track: true },
  hurl:      { attack: 0.07, release: 0.36, out: 0.78, side: 0.02, up: 0.00, palm: 0.30, lean: 0.36, twist: -0.24 },
  stasis:    { attack: 0.13, release: 0.30, out: 0.50, side: -0.18, up: 0.36, palm: 1.00, lean: -0.10, twist: -0.06, sustain: true, track: true },
  unleash:   { attack: 0.06, release: 0.38, out: 0.74, side: 0.08, up: 0.12, palm: 0.55, lean: 0.32, twist: -0.26 },
  rend:      { attack: 0.22, release: 0.62, out: 0.48, side: -0.44, up: 0.28, palm: 0.60, lean: 0.06, twist: 0.30 },
  lightning: { attack: 0.08, release: 0.52, out: 0.70, side: -0.08, up: 0.14, palm: 0.70, lean: 0.24, twist: -0.14 },
  sense:     { attack: 0.26, release: 0.62, out: 0.10, side: -0.28, up: 0.42, palm: 0.00, lean: -0.12, twist: 0.10 },
  cast:      { attack: 0.06, release: 0.34, out: 0.58, side: -0.30, up: 0.04, palm: 0.20, lean: 0.30, twist: -0.26 },
};

/**
 * A pinned point in space that pretends to be a lit blade.
 *
 * BoltPool already knows how to arrest a bolt: while `bolt.held` is set it is
 * placed at `held.saber.pointAt(t)` every frame, it stops moving, it stops
 * ageing, it drops out of threatsNear so the aim assist ignores it, and it is
 * drawn as a fat, crackling, bleached version of itself instead of a streak.
 * That is the entire visual and behavioural vocabulary a Force-stopped bolt
 * wants; the only difference is that this anchor does not move. So the anchor
 * IS the blade interface, three members wide, and Force stop inherits all of it
 * rather than growing a second, subtly different copy.
 */
class StasisAnchor {
  constructor(p) { this.p = p.clone(); this.ignition = 1; this.coreWidth = 1; }
  pointAt(t, out) { return out.copy(this.p); }
}

/**
 * What can be taken apart. Flesh does not disassemble — an Acolyte or an Acklay
 * has to be cut, which is what the blade is for.
 */
const MECHANICAL = /b1|b2|droid|deka|walker|remote|dummy/;

/** Bones a droid still needs to be a droid. Never the first thing to come off. */
const CORE_BONE = /^(hips|spine|chest|body|core|pelvis)$/;

/** Anything it is standing on — see forceDisassemble for why these go last. */
const LEG_BONE = /thigh|shin|foot|femur|tibia|tarsus|^leg/;

/* ══════════════════════════════════════════════════════════════════════ */
/*  Camera                                                                */
/* ══════════════════════════════════════════════════════════════════════ */

/**
 * How much of the pelvis's own motion the first-person eye rides. ONE number,
 * applied to every axis, and it is 1 because a head is bolted to a spine.
 *
 * This used to be two numbers and neither of them said so. The pelvis takes the
 * full gait bob and the camera took `bob * 0.5`; the pelvis sways up to 30mm
 * laterally per step and the camera took none of it at all; and the pelvis
 * drops 41mm into a run and the eye did not move. Measured on the walk, with
 * the whole upper body expressed in the eye's own view space — which is what
 * the player is actually looking at:
 *
 *       standing   chest 22.9mm across, 6.0mm up    (idle sway, uncancelled)
 *       1.6 m/s    chest 29.2mm across, 26.4mm up
 *                  shoulder 20.1 / 32.3 / 17.3mm in x/y/z
 *       4.6 m/s    shoulder 5.4 / 71.2 / 21.9mm
 *
 * Seventy-one millimetres of your own shoulder sliding up and down the screen,
 * 27cm from the lens. That is not a gait, it is the body and the camera being
 * two separate simulations of the same person, and it is the largest single
 * source of the "jumbled mess" the player described. At a gain of 1 the number
 * is zero by construction, in every axis, at every speed.
 */
const EYE_FOLLOW = 1;

/**
 * The fastest a neck is allowed to carry the eye, m/s.
 *
 * A rate cap and not a filter, deliberately: a damped follower that tracks the
 * 3 Hz bob closely enough to leave no residual swim (rate 60 leaves 4.7%) does
 * essentially nothing to a one-frame spike, and one slow enough to absorb the
 * spike puts 19% of the bob back on the screen as swim. A cap is exact in the
 * regime that matters and only engages where the body is already wrong.
 *
 * It has to engage at all only because the pelvis is still not smooth.
 * SWING_LAND in Rig.js took the worst single-frame pelvis travel from 69.6 mm
 * to 43.9 mm at a 4.6 m/s run and from 88.3 to 87.5 at a 7.4 m/s sprint, but
 * 87 mm in a 1/60 s frame is 5.2 m/s of pelvis and no neck does that. The
 * residue is the swing foot arriving at a measured 5.3 m/s with the reach clamp
 * chained to it — a defect in the gait, named where it lives in Rig.js rather
 * than hidden behind a filter here.
 *
 * 2.8 m/s and not 2.2: the game's ordinary forward speed IS 4.6 m/s, where the
 * pelvis peaks at 43.9 mm/frame = 2.63 m/s. A 2.2 cap trimmed 5.9 mm there —
 * a filter running during normal play, putting 5.9 mm of swim back on the
 * screen. 2.8 leaves the run untouched and still refuses 41 mm of the sprint.
 */
const EYE_MAX_SPEED = 2.8;

/* ══════════════════════════════════════════════════════════════════════ */
/*  The first-person viewmodel                                            */
/* ══════════════════════════════════════════════════════════════════════ */

/**
 * WHERE THE WIELDER'S OWN SHOULDERS GO WHEN THEY ARE LOOKING OUT OF THEIR OWN
 * EYES — which, until now, was "wherever the third-person body happened to put
 * them", and that is not a place a camera can be.
 *
 * Measured on the built figure, the right shoulder joint in the eye's own view
 * space while standing still:
 *
 *       x  +0.153 m   (to the right)
 *       y  -0.224 m   (below the lens)
 *       z  +0.068 m   ← BEHIND THE LENS
 *
 * The near plane in first person is 0.045 m, so both upper arms began 6.8 cm
 * behind the camera and crossed the camera plane on their way to the hilt. The
 * rasteriser cannot draw that: it clips at the plane, so what reached the
 * screen was two forearms erupting out of the bottom corners with no visible
 * origin, sliced flat. That is the "jumbled mess", and no amount of tuning the
 * pose could have fixed it, because the problem was the ARM'S ROOT, not its
 * pose. The whole distance from the shoulder to the lens was 0.279 m.
 *
 * So the shoulders move to the view, which is what every first-person game
 * does. Three numbers, in the aim frame, in metres from the eye:
 *
 *   Z is IN FRONT and it has a hard floor. The deltoid is a tube of radius
 *   0.055 m about the joint, so anything closer than 0.045 + 0.055 = 0.10 m
 *   has its own shoulder sliced open by the near plane. 0.115 leaves 1.5 cm.
 *
 *   Y is how far below the lens, and it is deeper than anatomy (0.224) on
 *   purpose: the shoulders have to sit outside a 60-degree frustum at 0.115 m
 *   out, whose half-height there is only 0.066 m, or you are looking at your
 *   own deltoids all day.
 *
 *   X is the half-width of the shoulder line. 0.21 is a real one.
 */
const VM_SHOULDER_X = 0.21;
const VM_SHOULDER_Y = -0.32;
const VM_SHOULDER_Z = 0.115;
/** The clavicle's own slope, kept off the skeleton's rest so the deltoid sits right. */
const VM_CLAV_RISE = 0.18;
/** Body left is the camera's left: clavL points along -right. */
const VM_CLAV = [['clavL', -1], ['clavR', 1]];

/**
 * How far below the eye the first-person blade is solved from.
 *
 * This was 0.26 and the consequence is not visible in any still the project
 * could previously take: measured off tools/fpview.mjs, with the camera level,
 * the hilt sat 43 degrees off the view axis against a 30-degree half-frustum.
 * THIRTEEN DEGREES OFF THE BOTTOM OF THE SCREEN. Looking straight ahead, a
 * first-person player of a lightsaber game could see the blade and no part of
 * their own hands, gloves, bracers or hilt at all — which is a fair description
 * of what "the hands are a jumbled mess" feels like when the mess is invisible
 * and only its consequences are not.
 *
 * 0.15 is an 11 cm raise and it is measured, not chosen. Off the level-gaze
 * pose, angles below the centre of a 30-degree half-frustum:
 *
 *       hilt emitter   18.8 deg     on screen
 *       right wrist    27.2 deg     on screen
 *       hilt grip      29.8 deg     on the bottom edge, 0.2 deg inside
 *       left wrist     32.8 deg     still 2.8 deg off the bottom
 *
 * So the weapon and the sword hand are on screen and the off hand is not quite.
 * It stops at 11 cm because everything here is REAL: this anchor is where the
 * blade is SOLVED from, so raising it raises the blade in the world, and a
 * lightsaber whose base has climbed a foot is a different weapon, not a
 * different view. Going further wants the blade's own framing checked against
 * the top of the frame — tools/fpview.mjs, `--only 'level gaze'` — and that is
 * a picture, not an inequality.
 */
const FP_HILT_DROP = 0.15;

// Scratch for the viewmodel alone. It runs in the middle of the arm solve,
// which is already holding _v1.._v6 AND _g1.._g5, so it may borrow neither.
const _m1 = new THREE.Vector3(), _m2 = new THREE.Vector3(), _m3 = new THREE.Vector3();
const _m4 = new THREE.Vector3(), _m5 = new THREE.Vector3(), _m6 = new THREE.Vector3();
const _m7 = new THREE.Vector3();

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
    this.fov = 60;
    this.fovTarget = 60;
    this.roll = 0;
    this.rollTarget = 0;
    this.enabled = true;
    this.aimQuat = new THREE.Quaternion();
    this._smoothTarget = new THREE.Vector3();
    this._init = false;
    /** Where the eye currently sits relative to a neutral stance — see EYE_FOLLOW. */
    this.eyeOffset = new THREE.Vector3();
    /** How much of the pelvis the cap had to refuse this frame, metres. */
    this.eyeCapped = 0;
  }

  /**
   * Advance the eye's ride on the pelvis. Called EXACTLY once a frame, by the
   * owner, immediately after the gait has been solved — never from update().
   *
   * The split exists because the first-person arms are hung off the eye and the
   * eye is hung off the pelvis, so all three have to be resolved in that order
   * inside one frame. When the camera advanced its own offset during update(),
   * which runs last, the arms could only ever be built against the PREVIOUS
   * frame's eye — a one-frame lag between a viewmodel and the view it is bolted
   * to, which is visible as judder the moment the player turns quickly.
   */
  advanceEye(dt, pelvis) {
    if (!this.firstPerson) { this.eyeOffset.set(0, 0, 0); this.eyeCapped = 0; return this.eyeOffset; }
    // THE EYE RIDES THE PELVIS. All of it, every axis — bob, sway, the run's
    // crouch, the landing dip and the reach clamp — because that is what a head
    // bolted to a spine does, and because any fraction less than all of it is
    // the body and the camera being two simulations of one person. See
    // EYE_FOLLOW; the cap is a statement about necks, see EYE_MAX_SPEED.
    _v5.copy(pelvis || _ZERO).multiplyScalar(EYE_FOLLOW).sub(this.eyeOffset);
    // VERTICAL ONLY. The lateral sway is a pure cosine of the gait clock with
    // nothing clamped on top of it, so it is smooth by construction, and capping
    // it can only open a gap for the body to slide through — measured, a
    // magnitude cap cost 4.9 mm of lateral weld at a sprint and bought nothing.
    // It is the vertical that has spikes, because that is where the reach clamp
    // is.
    const maxStep = EYE_MAX_SPEED * Math.max(dt, 1e-4);
    this.eyeCapped = Math.max(0, Math.abs(_v5.y) - maxStep);
    if (Math.abs(_v5.y) > maxStep) _v5.y = Math.sign(_v5.y) * maxStep;
    this.eyeOffset.add(_v5);
    return this.eyeOffset;
  }

  /**
   * Where the eye is. ONE function, and both callers that matter use it: the
   * camera itself, and the first-person arms that have to be welded to it.
   * Two copies of this arithmetic is precisely how the arms and the view came
   * to disagree in the first place.
   */
  eyePosition(target, eyeHeight, out) {
    out.copy(target).addScaledVector(UP, eyeHeight).add(this.eyeOffset);
    // Offset along the body's HORIZONTAL forward, not the view forward.
    // Following the view meant looking down also moved the eye downward and out
    // of the head, so the pivot drifted as you aimed.
    _v4.set(0, 0, -1).applyQuaternion(this.aimQuat).setY(0);
    if (_v4.lengthSq() > 1e-6) out.addScaledVector(_v4.normalize(), 0.07);
    return out;
  }

  /**
   * Rebuild the aim quaternion from the yaw and pitch the input just wrote.
   *
   * update() does this too, but update() runs LAST, so everything solved before
   * it — the blade, and now the arms welded to the view — was reading an aim
   * that was one frame old. On a 400 deg/s flick that is 6.7 degrees, which at
   * the 0.3 m the hands sit from the lens is 3.5 cm of viewmodel lagging behind
   * its own camera. Cheap enough to simply do twice.
   */
  syncAim() { this.aimQuat.setFromEuler(_eul.set(this.pitch, this.yaw, 0, 'YXZ')); return this.aimQuat; }

  addYaw(d) { this.yaw += d; }
  addPitch(d) { this.pitch = clamp(this.pitch + d, -1.28, 1.16); }

  aimDirection(out = new THREE.Vector3()) {
    return out.set(0, 0, -1).applyQuaternion(this.aimQuat);
  }

  update(dt, target, ctx = {}) {
    this.syncAim();

    if (!this._init) { this._smoothTarget.copy(target); this._init = true; }
    // First person locks the eye to the body with NO positional smoothing. Even
    // at a damping rate of 40 the eye trails the body by a couple of frames,
    // and in first person that reads as the entire world swimming behind your
    // own movement — the single largest source of first-person jank. Third
    // person still wants the lag; it is what makes the camera feel like a
    // camera rather than a rigid boom.
    if (this.firstPerson) this._smoothTarget.copy(target);
    else dampVec(this._smoothTarget, target, 16, dt);

    this.distance = damp(this.distance, this.targetDistance, 8, dt);
    this.fov = damp(this.fov, this.fovTarget, 7, dt);
    this.roll = damp(this.roll, this.rollTarget, 6, dt);

    const fwd = _v1.set(0, 0, -1).applyQuaternion(this.aimQuat);
    const right = _v2.set(1, 0, 0).applyQuaternion(this.aimQuat);

    if (this.firstPerson) {
      this.eyePosition(this._smoothTarget, ctx.eyeHeight ?? 1.62, this.pos);
      this.look.copy(this.pos).addScaledVector(fwd, 10);
    } else {
      this.eyeOffset.set(0, 0, 0);
      this.eyeCapped = 0;
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
    if (this.firstPerson) {
      // Take the orientation straight from aimQuat instead of re-deriving it
      // with lookAt(). lookAt rebuilds a basis against `up` every frame, which
      // at the pitch limits sits close to the view direction and goes unstable
      // — visible as the horizon twitching when you look far up or down. The
      // aim quaternion is already exact; roll is composed onto it.
      this.camera.quaternion.copy(this.aimQuat);
      if (Math.abs(this.roll) > 1e-5) {
        this.camera.quaternion.multiply(_q1.setFromAxisAngle(FWD, this.roll));
      }
      this.camera.up.set(0, 1, 0);
    } else {
      this.camera.up.set(Math.sin(this.roll), Math.cos(this.roll), 0).applyQuaternion(
        _q1.setFromAxisAngle(UP, this.yaw));
      this.camera.lookAt(this.look);
    }
    // The near plane has to be tighter in first person or your own hands and
    // the base of the blade clip through it.
    const near = this.firstPerson ? 0.045 : 0.15;
    if (this.camera.near !== near) { this.camera.near = near; this.camera.updateProjectionMatrix(); }
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
    // skinColor and hairColor have been parameters of buildJedi since it was
    // written and nothing ever passed them, so every Jedi in the game wore the
    // one default face. The builder needed no change; this line was the feature.
    const built = buildJedi({
      robeIndex: opts.robeIndex ?? 0, scale: 1,
      skinColor: SKIN_TONES[opts.skinIndex ?? 2]?.hex,
      hairColor: HAIR_COLORS[opts.hairIndex ?? 1]?.hex,
      build: opts.build,
    });
    this.rig = built.rig;
    this.palette = built.palette;
    this.built = built;
    world.scene.add(this.rig.root);
    this.animator = new BipedAnimator(this.rig, { scale: 1, hipHeight: 0.95 });
    this.animator.onFootstep = (p, speed) => this._footstep(p, speed);
    this._makeCloak();

    // ── saber
    this.saber = new Saber(world.scene, {
      colorIndex: opts.colorIndex ?? 0,
      bladeLength: opts.bladeLength ?? 1.15,
      coreWidth: opts.coreWidth ?? 1,
      hiltStyle: opts.hiltStyle ?? 'Graflex',
    });
    this.control = new SaberController({
      sensitivity: opts.sensitivity ?? 1,
      followStrength: opts.followStrength ?? 0,
      scheme: opts.scheme ?? 'hold',
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
    /** Colliders near enough to stand on, rebuilt once a frame by _gatherNear. */
    this._nearBoxes = [];
    this._nearProps = [];
    /** The height of whatever the feet are over — terrain, rock or crate. */
    this.supportY = 0;
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
    this.gripEnemy = null;
    this.gripDistance = 4;
    /** Where the lifted enemy is being walked to — see _updateGrip. */
    this._liftPoint = new THREE.Vector3();
    /** Why the last grip attempt was refused, so the refusal is measurable. */
    this.lastGripRefusal = null;
    this.senseActive = false;
    this.senseTimer = 0;
    this.saberThrown = false;
    this.throwState = 'held';
    this.throwPos = new THREE.Vector3();
    this.throwVel = new THREE.Vector3();
    this.throwSpin = 0;
    this.throwTimer = 0;
    /** The arm gesture currently reading out whatever the Force is doing. */
    this.gesture = { kind: '', t: 0, env: 0, sustain: false, at: new THREE.Vector3(), hasAt: false };
    /**
     * Force stop. `held` is what is frozen right now, `firing` is what has been
     * let go and is leaving in a ripple, and `bodies` is the membership test so
     * the per-frame capture sweep is not quadratic.
     */
    this.stasis = {
      active: false, timer: 0, radius: 0, fireT: 0, target: null,
      held: [], firing: [], bodies: new Set(),
      centre: new THREE.Vector3(), point: new THREE.Vector3(), vfx: 0,
    };
    /**
     * Things we threw, and what they have already hit. RapierWorld stores
     * Body.onContact and never dispatches it — only the retired sphere solver
     * ever did — so nothing in the game reads `userData.hurledBy`, and a hurled
     * crate passed straight through a droid. Until contacts come back the
     * thrower owns the consequence.
     */
    this.hurled = [];
    this._wheel = 0;
    this.cooldowns = { push: 0, pull: 0, throw: 0, sense: 0, dash: 0, lightning: 0, stasis: 0, rend: 0 };
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
      shape: capsule(0.55, this.radius),
      mass: 78, kinematic: true, static: false, layer: LAYER.PLAYER,
      mask: LAYER.WORLD, allowSleep: false, gravityScale: 0,
    });
    this.body.userData.player = this;
    world.physics.add(this.body);

    this.chest = new THREE.Vector3();
    /**
     * Where the WEAPON hangs from — the body's chest in third person, a fixed
     * point in the aim frame in first. Separate from `chest` because `chest` is
     * what the rest of the game aims at. See _updateBlade.
     */
    this.gripAnchor = new THREE.Vector3();
    this.headPos = new THREE.Vector3();
    this._prevChest = new THREE.Vector3();
    this.aimDir = new THREE.Vector3(0, 0, -1);
    this._stepTimer = 0;
    this._lastSwingSound = 0;
    this.hitFlash = 0;
    this.events = [];
  }

  _makeCloak() {
    this.cloak?.dispose();
    this.skirt?.dispose(); this.skirt = null;
    const mat = this.palette.outer.clone();
    mat.side = THREE.DoubleSide;
    this.cloak = attachCloak(this.world.scene, this.rig, {
      // narrow at the collar, flared at the hem, and stopping above the knee so
      // the legs still read — a floor-length sack hides the whole silhouette.
      material: mat, width: 0.36, length: 0.86, cols: 9, rows: 11, flare: 1.0,
    });
    // THE ROBE BELOW THE BELT IS CLOTH NOW.
    //
    // It was three rigid lathes bolted to the hips bone, so a hem vertex
    // travelled 0.000 mm in the pelvis frame over seven seconds of walking
    // while the cape beside it travelled 217 mm. That contrast is what the
    // player saw and called "a hard cylinder" under the clothes.
    //
    // It REPLACES those 616 triangles rather than adding to them, so the
    // figure is 448 triangles cheaper with the simulation on than it was
    // without it.
    if (this.built?.robeSkirt) {
      const smat = (this.palette.over || this.palette.outer).clone();
      smat.side = THREE.DoubleSide;
      this.skirt = attachSkirt(this.world.scene, this.rig, {
        material: smat, rigid: this.built.robeSkirt,
      });
      // The cape used to avoid the skirt via a fixed table of spheres sampled
      // off a standing figure. Now the skirt can move, so the cape follows the
      // real thing: live proxy in, table out.
      this.cloak.outer = this.skirt;
    }
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
    // The aim the input just wrote, available to everything solved this frame
    // rather than only to the camera at the end of it — see syncAim.
    this.camera.syncAim();
    this._move(dt, ctx);
    this._updateForce(dt, ctx);
    // ONE ORDER, AND IT IS A CHAIN OF DEPENDENCIES, NOT A HABIT.
    //
    // The gait moves the pelvis; the eye rides the pelvis; the blade is solved
    // from the eye in first person; the arms are IK'd to the blade and rooted
    // on the eye. Every arrow points forward, so all of it resolves inside one
    // frame. It used to run blade → body → camera, which put two of those
    // arrows backwards: the blade anchor was built from a stale eye and the
    // eye was advanced after everything that depended on it had already been
    // drawn. Measured on the walk, that alone was 97mm of hilt sliding up and
    // down the first-person frame, once per stride.
    this._poseGait(dt, ctx);
    this._updateBlade(dt, ctx);
    this._updateBody(dt, ctx);
    this._updateCamera(dt, ctx);
    this._regen(dt);
  }

  /* ── input ───────────────────────────────────────────────────────── */

  _readInput(dt, ctx) {
    const input = ctx.input;
    if (!this.isLocal) return;

    // ── the wheel belongs to whatever is actually being held.
    // SaberController spends it on wrist roll (`rollInput += mouse.wheel*0.55`)
    // and it runs first, so before this a single notch both rolled the blade
    // AND moved the gripped object — two answers to one gesture, which is why
    // distance control read to the player as "there isn't any". Claim it while
    // a grip or a stasis field is live and hand it straight back otherwise.
    this._wheel = 0;
    if (this.gripBody || this.gripEnemy || this.stasis.active) {
      this._wheel = input.mouse.wheel;
      input.mouse.wheel = 0;
    }

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
    if (input.actHit('ignite')) {
      this.saber.toggle();
      if (this.saber.lit) { this.hum.ignite(); audio.tone({ freq: 180, freqEnd: 900, dur: 0.4, gain: 0.22, type: 'sawtooth', pos: this.saber.base }); }
      else { this.hum.retract(); audio.tone({ freq: 900, freqEnd: 120, dur: 0.35, gain: 0.2, type: 'sawtooth', pos: this.saber.base }); }
    }
    if (input.actHit('view')) {
      this.camera.firstPerson = !this.camera.firstPerson;
      this._applyViewMode();
    }

    // grip / one-hand.
    //
    // Only a SUSTAINED hold changes the blade's actual grip. GRIPS.two → one
    // moves handExtend 0.29 → 0.36 and guardR 0.60 → 0.72 with no blend of any
    // kind (SaberController.gripBlend is set once and never read), so switching
    // it for a 0.4 s push gesture would jump the hilt target 7 cm out and back
    // twice a second in the middle of a duel. Carrying a crate or holding a
    // stasis field is a decision that lasts, and the looser one-handed blade is
    // the honest price of it; a gesture only borrows the arm, which
    // _updateBody handles on its own.
    const wantOne = input.act('grip2') || this.saberThrown
      || !!this.gripBody || !!this.gripEnemy || this.stasis.active;
    this.control.grip = wantOne ? 'one' : 'two';

    // force powers
    if (input.actHit('push')) this.forcePush(ctx);
    if (input.actHit('pull')) this.forcePull(ctx);
    if (input.actHit('grip')) this.toggleGrip(ctx);
    if (input.actHit('throw')) this.throwOrRecall(ctx);
    if (input.actHit('sense')) this.toggleSense(ctx);
    if (input.actHit('lightning') && this.boonMods.lightning) this.forceLightning(ctx);
    if (input.actHit('stasis')) this.toggleStasis(ctx);
    if (input.actHit('rend')) this.forceDisassemble(ctx);
    // One meaning for `hurl` whichever way the Force is currently full: send
    // what I am holding at what I am looking at. (It said "Mouse2" here until
    // the key moved off Mouse2 — which is why comments name the ACTION.)
    if (input.actHit('hurl')) {
      if (this.gripBody || this.gripEnemy) this.hurlGripped(ctx);
      else if (this.stasis.active) this.releaseStasis(ctx, true);
    }
    if (input.actHit('dash') && this.cooldowns.dash <= 0) this._tryDash(ctx);
  }

  _applyViewMode() {
    const fp = this.camera.firstPerson;

    // Hide the MESHES, not the bones — scaling a bone enters matrixWorld, so a
    // 0.0001x head was silently seen by the sever code, the cloak colliders,
    // the ragdoll body sizes and every worldPos() call.
    //
    // And hide EVERY mesh under the bone, not bone.parts. `parts` holds only
    // the limb tube the rig built: the head bone carries fifteen meshes (jaw,
    // ears, nose, eyes, brows, mouth, hair, hood) and `parts` lists one. Hiding
    // just that left the whole face wrapped around the first-person camera,
    // which is why first person looked like being inside your own skull.
    // Traversing the NECK covers the head too, since head parents to it — and
    // stops short of the chest, so the arms stay visible holding the blade.
    const neck = this.rig.get('neck');
    if (neck) {
      neck.obj.scale.setScalar(1);
      const head = this.rig.get('head');
      if (head) head.obj.scale.setScalar(1);
      neck.obj.traverse((o) => { if (o.isMesh) o.visible = !fp; });
    }

    // The clavicles are the join between a torso that is still standing where
    // the body is and a pair of shoulders that have moved onto the camera, so
    // in first person they are a 13cm tube stretched between two places the
    // player is not meant to think about. Hide the tube; the bone still does
    // its job, which is to carry the arm.
    //
    // Restoring is not optional and not free: _anchorViewArms OVERWRITES the
    // clavicle's local position and rotation every frame it runs, so leaving
    // first person without putting the rest pose back leaves the third-person
    // figure with its shoulders frozen wherever the camera last was.
    for (const [name] of VM_CLAV) {
      const b = this.rig.get(name);
      if (!b) continue;
      b.obj.traverse((o) => { if (o.isMesh && o.parent === b.obj) o.visible = !fp; });
      if (!fp) { b.obj.position.copy(b.offset); b.obj.quaternion.copy(b.restQuat); }
    }

    // AND THE RIBCAGE, BECAUSE YOU ARE INSIDE IT.
    //
    // The chest lathe ends in a domed cap 16 cm across — the shoulder line,
    // which is the first thing a human silhouette is read by and is worth every
    // triangle in third person. In first person its top sits 16 cm below a lens
    // with a 4.5 cm near plane, so it is both inside the frustum and across the
    // camera plane. tools/fpview.mjs at 70 degrees down: a smooth brown dome
    // filling the bottom 60% of the frame, radial lathe seams and all, with the
    // player's own legs and boots behind it. Looking down at yourself showed you
    // the inside of your own chest.
    //
    // The spine and hips keep their robe, so looking down still finds a body
    // and a pair of legs where they belong — just not from inside the ribs.
    const chestBone = this.rig.get('chest');
    if (chestBone) {
      chestBone.obj.traverse((o) => { if (o.isMesh && o.parent === chestBone.obj) o.visible = !fp; });
    }

    this.camera.targetDistance = fp ? 0 : 3.05;
    // Say WHICH resting pose, never what it is. These two lines used to carry
    // their own copies of readyX/readyY, and the third-person one still said
    // 0.30 — the exact value commit 2e23892 had lowered to 0.08 to stop the
    // blade cursor resting 22 deg above screen centre. The fix landed in
    // SaberController and was undone from here every time the view mode was
    // applied, which includes every respawn. READY_GUARD owns the numbers now.
    this.control.setViewMode(fp);
  }

  /* ── locomotion ──────────────────────────────────────────────────── */

  _move(dt, ctx) {
    const input = ctx.input;
    const terrain = ctx.terrain;
    const axis = this.isLocal ? input.moveAxis(_axis) : (this.netAxis || _axis0);

    const sprinting = this.isLocal && input.act('sprint') && axis.y > 0.2 && this.stamina > 4;
    const crouching = this.isLocal && input.act('crouch');
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
    // Everyone gets the second jump — it is a Force jump, not an upgrade. The
    // boon grants a third.
    if (this.grounded) { this.coyote = 0.14; this.airJumps = this.boonMods.doubleJump ? 2 : 1; }
    else this.coyote = Math.max(0, this.coyote - dt);

    if (this.isLocal) {
      if (input.actHit('jump')) {
        if (this.coyote > 0) {
          this.velocity.y = 7.4 * this.boonMods.jumpPower;
          this.grounded = false; this.coyote = 0;
          this.jumpHeld = 0.42;
          audio.force(this.position, 'jump');
          if (ctx.particles) ctx.particles.sandPuff(this.position.clone(), 0.8, this.position.y, ctx.groundColor);
        } else if (this.airJumps > 0 && this._canSpend(12)) {
          this.airJumps--;
          this._spend(12);
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
      if (input.act('jump') && this.jumpHeld > 0 && this.velocity.y > 0 && this.force > 0) {
        this._spend(34 * dt);
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

  /**
   * WHAT AM I STANDING ON? — the whole answer, in one place.
   *
   * Before this there were two answers and the wrong one won. A block in
   * `_collide` set `grounded = true` when the player landed on a box, and then
   * fifty lines further down an unguarded `else if` re-decided it from the
   * TERRAIN HEIGHTFIELD ALONE — which on top of a boulder is metres below you,
   * so `grounded` went false again on the very same frame, every frame. That
   * one line produced every symptom the player reported:
   *
   *   the repeated hop     gravity re-applies each frame, you sink into the
   *                        rock, the snap teleports you back out, ~5 Hz
   *   phasing into it      the collider was ONE SPHERE AT MID-BODY, 0.89 m
   *                        above the feet with a 0.36 m radius, so the top-snap
   *                        could not fire until the feet were 0.53 m inside
   *   sliding off          depenetration was horizontal-only (`_v5.y = 0`), so
   *                        near an edge the nearest face is a side and you get
   *                        shoved off it
   *   legs through the rock  the gait's `groundAt` sampled terrain only, so both
   *                        ankles were driven to y=0 under a pelvis at y=2
   *   footstep spam        `grounded` flickering makes Rig.js re-plant every
   *                        frame, and re-planting fires onFootstep
   *
   * It also meant air control (12 instead of 46) the whole time you stood on
   * anything, no coyote time so your jump silently became a Force-costing air
   * jump, no landing thud, and a stale `fallSpeed` that fired a bogus violent
   * landing the moment you stepped back onto sand.
   *
   * So: one query, every surface, highest wins. Terrain, static boxes and
   * dynamic props all answer the same question and the caller cannot tell them
   * apart — which is the point, because the player cannot either.
   *
   * `feetY` is where the feet are; a surface above `feetY + STEP_UP` is a wall,
   * not a floor, and is ignored so that jumping up past a ledge does not snap
   * you onto it.
   */
  _supportAt(ctx, x, z, feetY) {
    return supportHeight(ctx.terrain, this._nearBoxes, this._nearProps,
      x, z, feetY, this.radius, STEP_UP);
  }

  /** The short list of colliders near enough to matter, rebuilt once a frame. */
  _gatherNear(ctx) {
    const near = this._nearBoxes; near.length = 0;
    const props = this._nearProps; props.length = 0;
    const physics = ctx.physics;
    if (!physics) return;
    // Generous enough to cover both feet at full stride and the capsule's own
    // radius, small enough that the per-foot ground query below is a short scan
    // rather than a walk of every collider in the level.
    const R = 2.6;
    for (const box of physics.staticBoxes) {
      if (box.disabled) continue;
      const dx = box.center.x - this.position.x, dz = box.center.z - this.position.z;
      if (dx * dx + dz * dz < (box.radius + R) ** 2) near.push(box);
    }
    for (const b of physics.bodies) {
      if (b.invMass === 0 || b === this.body || !b.extent) continue;
      if (b.layer !== LAYER.PROP && b.layer !== LAYER.DEBRIS && b.layer !== LAYER.RAGDOLL) continue;
      const dx = b.position.x - this.position.x, dz = b.position.z - this.position.z;
      if (dx * dx + dz * dz < (b.boundingRadius + R) ** 2) props.push(b);
    }
  }

  _collide(dt, ctx) {
    const terrain = ctx.terrain;
    const physics = ctx.physics;
    const wasGrounded = this.grounded;
    this._gatherNear(ctx);

    // static boxes and props: push out horizontally
    if (physics) {
      for (let iter = 0; iter < 2; iter++) {
        for (const box of this._nearBoxes) {
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
          // An upward face is FLOOR, and floors are resolved by the support
          // query below, which knows about every surface at once. Resolving it
          // here as well is what used to fight it: this loop would shove the
          // body up while the terrain branch pulled it back down.
          if (_v5.y > 0.5) continue;
          _v5.y = 0;
          if (_v5.lengthSq() < 1e-6) continue;
          _v5.normalize();
          this.position.addScaledVector(_v5, push);
          const vn = this.velocity.dot(_v5);
          if (vn < 0) this.velocity.addScaledVector(_v5, -vn);
        }
      }
      // shove dynamic props out of the way — the same short list the support
      // query uses, so a crate you are standing on and a crate you are walking
      // into are the same object seen twice, not two different searches
      for (const b of this._nearProps) {
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

    // ── the ground, whatever it happens to be made of
    const gh = terrain ? terrain.height(this.position.x, this.position.z) : 0;
    const support = this._supportAt(ctx, this.position.x, this.position.z, this.position.y);
    this.supportY = support;
    // Never inside it: a body below the surface it is standing on is the
    // "phase into it" the player described, and it is unconditional.
    if (this.position.y < support) this.position.y = support;
    if (this.position.y <= support + GROUND_SNAP && this.velocity.y <= 0.1) {
      // ONE landing path, so a prop landing sounds and looks like a sand one.
      // `_land` and the `fallSpeed` reset used to live only on the terrain
      // branch, so landing on a rock was silent and kept a stale fall speed
      // that fired a bogus violent landing the moment you stepped off it.
      if (!wasGrounded && this.fallSpeed < -7) this._land(ctx, -this.fallSpeed);
      this.position.y = support;
      if (this.velocity.y < 0) this.velocity.y = 0;
      this.grounded = true;
      this.fallSpeed = 0;
      // Slide down steep faces — but only off the TERRAIN. A boulder's top is
      // flat by construction and the terrain normal underneath it is whatever
      // the hillside does, which would drag you off a rock you are standing on.
      if (terrain && support <= gh + GROUND_SNAP) {
        terrain.normalAt(this.position.x, this.position.z, _v1);
        const slope = 1 - _v1.y;
        if (slope > 0.52) {
          _v2.set(_v1.x, 0, _v1.z).normalize().multiplyScalar((slope - 0.52) * 26 * dt);
          this.velocity.add(_v2);
        }
      }
    } else if (this.position.y > support + 0.06) {
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
    this.cloak?.impulse(_v5.set(0, 1, 0), power * 2.2); this.skirt?.impulse(_v5.set(0, 1, 0), power * 2.2);
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
    // Four arguments, not three. The signature is (amount, point, source, kind)
    // and this shipped as (amount, null, 'fall') — so `source` got the string
    // 'fall' and `kind` got undefined. A fall that killed you then called
    // die('fall') → onPlayerDeath(player, 'fall'), i.e. a killer that is a
    // string where every other death hands over an entity, and the one
    // diagnostic that prints `kind` printed undefined. Enemy.js's identical
    // fall-damage line has always passed four. Nothing threw; the third
    // distinct bug this one method has produced.
    if (impactSpeed > 26) this.damage(clamp((impactSpeed - 26) * 2.6, 0, 45), null, null, 'fall');
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
    // Any direction, including pure strafe and pure backward — this used to
    // require a forward or back input, so you could not sidestep a bolt.
    this.dashDir.set(0, 0, 0).addScaledVector(fwd, axis.y).addScaledVector(right, axis.x);
    // No direction held means "get me out of here": dash backward, not into it.
    if (this.dashDir.lengthSq() < 0.01) this.dashDir.copy(fwd).negate();
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
    // Chest anchor: the frame the whole blade solve lives in.
    //
    // In first person this cannot be the real chest. The eye sits ~28cm above
    // it, so a blade solved from the sternum arrives at the lens from below and
    // to the side, a metre of it filling a quarter of the screen. Every first
    // person game solves this the same way: the weapon hangs off the VIEW, not
    // off the ribcage. So drop the anchor further below the eye and push it
    // back behind it, which both recedes the blade to a sane size and puts the
    // hilt where your hands would actually be if you were holding it up.
    // THE BODY'S CHEST, ALWAYS, IN BOTH VIEWS.
    //
    // Everything outside this file that asks the player where they are asks
    // `chest`: Enemy.js aims every bolt and every lunge at `target.chest`,
    // Duel.js builds the blade-lock midpoint from it, World.js searches for
    // threats near it, and a dozen Force powers use it as their origin and as
    // the position of their own sound. It is a place on a body.
    //
    // It used to be quietly redefined in first person as the point the WEAPON
    // hangs from, which is a different thing that merely happened to be at a
    // similar height. Making that point follow the aim — which the viewmodel
    // needs, so the hands stay in front of the lens when you look up — would
    // have carried all of the above with it: measured, looking straight up put
    // it 0.20 m ABOVE the player's own eye, so every droid in the level would
    // have been shooting over the head of a player who looked at the sky.
    // They are two points and they are now two fields.
    this.chest.copy(this.position).setY(this.position.y + lerp(1.34, 1.0, this.crouch));
    this.gripAnchor.copy(this.chest);
    if (this.camera.firstPerson) {
      // OFF THE EYE, AND OFF THE SAME EYE THE CAMERA USES.
      //
      // This took `position.y + eyeHeight` for its height and `position` for
      // its x and z, which is the eye MINUS everything the eye actually does:
      // the pelvis ride, the lateral sway, the 7cm forward set. So the hilt
      // hung off a point that did not move while the view did. Measured on the
      // walk, before this, the wrist travelled 97mm up and down the frame per
      // stride against a shoulder that was already pinned to the lens — the
      // arm stretching and folding to reach a weapon that was swimming.
      const eye = this.camera.eyePosition(this.position, lerp(1.62, 1.22, this.crouch), _v5);
      // FORWARD and down, not back. The hands sit ~0.29m out along the guard
      // from this anchor; at 0.30m below the eye they need to be at least
      // 0.30/tan(30) = 0.52m in FRONT of it to fall inside a 60 degree vertical
      // frustum at all. Anchoring behind the eye put the hilt permanently off
      // the bottom of the screen, and closer to the lens made the blade bigger
      // rather than smaller.
      // IN THE AIM FRAME, ALL OF IT. The forward offset used to be flattened to
      // horizontal, so the hilt stayed roughly where the BODY was while the view
      // rotated off it: at 63 degrees of look-up the left elbow came within 8 mm
      // of a 45 mm near plane and was sliced in half, and the arms moved against
      // the view every time the player pitched. Solved in the aim frame the
      // hands sit at a FIXED point in view space at every pitch, which is what
      // makes them a viewmodel rather than a body that happens to be near a
      // camera.
      //
      // Kept modest on purpose: this anchor is the REAL one, so whatever it adds
      // in front of you is real reach. 0.45 looked best but handed first person
      // a third more range than third person, which is not a view option, it is
      // a different weapon.
      this.gripAnchor.copy(eye)
        .addScaledVector(_v4.set(0, 1, 0).applyQuaternion(this.camera.aimQuat), -FP_HILT_DROP)
        .addScaledVector(_v4.set(0, 0, -1).applyQuaternion(this.camera.aimQuat), 0.28);
    }
    this.headPos.copy(this.position).setY(this.position.y + lerp(1.62, 1.22, this.crouch));
    this.camera.aimDirection(this.aimDir);

    if (this.isLocal && this.difficulty && this.difficulty.assist > 0) {
      this.control.assist = this.difficulty.assist;
      // 34 m, not 26: the assist works to a fixed 0.9 s of warning, and at
      // Padawan's 30 m/s a 26 m search only ever handed it 0.87 s — so the one
      // tier that most needs the full lead was the one being clipped.
      const threats = ctx.bolts ? ctx.bolts.threatsNear(this.chest, 34) : [];
      this.control.applyAssist(threats.filter(t => t.bolt.team !== this.team), this.gripAnchor, this.camera.aimQuat, dt);
    } else this.control.assist = 0;

    this.control.update(dt, this.gripAnchor, this.camera.aimQuat, {
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

    // The same vector, published as well as passed. Saber.update consumes it to
    // separate a swing from a walk for the whoosh and the stamina drain;
    // Combat.captureSnapshot needs it for the same reason one layer down, and
    // it is handed only the saber, so the saber is where it has to live. It is
    // kept by reference — this.velocity is a persistent vector — so the frame
    // is always current, and a blade nobody publishes one for reads as still.
    this.saber.carrierVel = this.velocity;
    this.saber.update(dt, ctx.time, this.velocity);
    const swing = this.saber.swingSpeed;
    this.hum.set(swing, this.saber.contactStrain);
    this.hum.move(this.saber.pointAt(0.5, _v1));

    // swing whoosh when the blade crosses a speed threshold
    const now = ctx.time;
    if (swing > 11 && now - this._lastSwingSound > 0.19) {
      this._lastSwingSound = now;
      audio.swing(swing, this.saber.pointAt(0.7, _v1));
      this.world.report?.({ type: 'swing', speed: swing });
      this.stamina = Math.max(0, this.stamina - clamp(swing * 0.055, 0, 2.4) * (this.difficulty?.staminaDrain ?? 1));
    }

    // Heat haze off the blade — but ONLY while it is genuinely moving. Emitting
    // this at rest parked a permanent refractive smear over screen centre,
    // where a third-person blade lives, and read as condensation on the lens.
    if (this.saber.ignition > 0.5 && this.world.settings.bloom && swing > 9) {
      _v1.copy(this.saber.pointAt(0.5, _v2)).project(ctx.camera);
      if (_v1.z < 1) {
        const heat = clamp((swing - 9) / 22, 0, 1);
        this.world.engine.addHeat((_v1.x * 0.5 + 0.5), (_v1.y * 0.5 + 0.5),
          0.07 + heat * 0.05, heat * 0.42);
      }
    }
  }

  /**
   * Move the shoulders onto the camera, and return the torso point the elbow
   * poles hang off. This is the whole first-person viewmodel.
   *
   * It is a re-anchoring rather than a second set of arms on purpose. A
   * viewmodel built as its own mesh is a second copy of the sleeve, the glove,
   * the bracer, the palette and the cut geometry, and every one of them is then
   * a thing that can drift out of step with the body — including on a sever,
   * where the arm you are looking down is supposed to come off. Here there is
   * exactly one pair of arms in the game. All that changes in first person is
   * WHERE THEY START: the clavicle's tip is placed on a fixed point in the aim
   * frame instead of on the ribcage, and everything below it — the IK to the
   * hilt, the wrist taking the hilt's roll, the sever path, the ragdoll — is
   * the same code addressing the same bones.
   *
   * Consequences that are properties, not accidents:
   *   · the shoulder-to-eye vector is CONSTANT, so the arms cannot swim against
   *     the view no matter what the gait, the camera or the terrain does;
   *   · the whole arm is in front of the near plane, so nothing is sliced;
   *   · look up and the arms come with you, because they are in the aim frame.
   */
  _anchorViewArms(out) {
    const rig = this.rig;
    const q = this.camera.aimQuat;
    // The SAME eye the camera will use this frame, from the same function.
    const eye = this.camera.eyePosition(this.position, lerp(1.62, 1.22, this.crouch), _m1);
    const right = _m2.set(1, 0, 0).applyQuaternion(q);
    const up = _m3.set(0, 1, 0).applyQuaternion(q);
    const fwd = _m4.set(0, 0, -1).applyQuaternion(q);

    out.copy(eye).addScaledVector(up, VM_SHOULDER_Y).addScaledVector(fwd, VM_SHOULDER_Z);

    for (const [name, side] of VM_CLAV) {
      const b = rig.get(name);
      if (!b || !b.obj.parent) continue;
      // where the clavicle's TIP has to land: the shoulder joint
      const joint = _m5.copy(out).addScaledVector(right, side * VM_SHOULDER_X);
      // the clavicle keeps its own slope, so the deltoid sits as it was built
      const dir = _m6.copy(right).multiplyScalar(side).addScaledVector(up, VM_CLAV_RISE).normalize();
      // root = tip - length·dir, so the tip lands exactly on the joint rather
      // than merely near it — the arm's reach budget is measured from there.
      b.obj.parent.worldToLocal(_m7.copy(joint).addScaledVector(dir, -b.length));
      b.obj.position.copy(_m7);
      rig.aimBoneWorld(name, dir, fwd);
    }
    rig.updateMatrices();
    return out;
  }

  /* ── body pose ───────────────────────────────────────────────────── */

  /**
   * The gait, and the eye that rides it. Split out of _updateBody so that it
   * can run BEFORE the blade: in first person the hilt is anchored to the eye,
   * and the eye cannot be known until the pelvis is. See update().
   */
  _poseGait(dt, ctx) {
    const terrain = ctx.terrain;
    const speed = Math.hypot(this.velocity.x, this.velocity.z);
    this.animator.setFacing(this.facing);
    this.animator.update(dt, {
      position: this.position,
      facing: this.facing,
      velocity: this.velocity,
      grounded: this.grounded,
      // THE FEET STAND WHERE THE BODY STANDS. This was terrain-only, so with
      // the pelvis on a two-metre boulder both ankles were driven to y=0 and
      // the legs were drawn through the rock. It is the same query the body
      // uses, over the short list _gatherNear already built this frame.
      groundAt: (x, z) => this._supportAt(ctx, x, z, this.position.y),
      crouch: this.crouch,
      accelForward: clamp(speed / 8, 0, 1),
      accelStrafe: 0,
    });
    this.camera.advanceEye(dt, this.animator.pelvis);
  }

  _updateBody(dt, ctx) {
    const rig = this.rig;

    // Spine FIRST. It is an ancestor of chest -> clavicle -> arm, so rewriting
    // it after the arms have been IK'd to world-space grip points drags the
    // solved hands straight off the hilt — measured up to 18cm at the clamp
    // limits, on exactly the fast swings where this layer is most active.
    const spine = rig.get('spine');
    if (spine) {
      const w = this.control.angVel;
      let twist = clamp(-w.y * 0.026, -0.32, 0.32);
      let lean = clamp(this.control.handVel.dot(_v1.set(Math.sin(this.facing), 0, Math.cos(this.facing))) * 0.012, -0.2, 0.2);
      // A power moves the whole body, not just the arm. Added on top of the
      // blade's own lean rather than replacing it, so a push thrown mid-swing
      // keeps the swing's weight and gains the push's.
      const g = GESTURES[this.gesture.kind];
      if (g) { lean += g.lean * this.gesture.env; twist += g.twist * this.gesture.env; }
      spine.obj.quaternion.copy(spine.restQuat)
        .multiply(_q1.setFromEuler(new THREE.Euler(lean, twist, 0, 'XYZ')));
    }
    rig.updateMatrices();

    // arms to the hilt
    // A gesture takes the off hand off the hilt without touching the blade's
    // grip model — see the note in _readInput on why those are separate.
    const twoHanded = this.control.grip === 'two' && this.throwState === 'held' && !this.gesture.kind;
    // In first person the arms hang off the VIEW, not off the ribcage, and
    // `chest` — which is the frame every elbow pole below is built in — becomes
    // the point midway between the two viewmodel shoulders. See _anchorViewArms.
    const chest = this.camera.firstPerson
      ? this._anchorViewArms(_v1) : rig.worldPos('chest', _v1);

    if (this.throwState === 'held') {
      const gripR = this.saber.root.localToWorld(_v2.set(0, 0.03, 0));
      const gripL = this.saber.root.localToWorld(_v3.set(0, -0.035, 0));
      const fwd = _v4.set(0, 0, -1).applyQuaternion(this.camera.aimQuat);
      const right = _v5.set(1, 0, 0).applyQuaternion(this.camera.aimQuat);

      // Elbow poles track which side of the body the hands are actually on. A
      // pole pinned to the right of the chest folds the right elbow straight
      // through the ribs the moment the guard crosses to the left — which is
      // most of what read as the body overlapping itself.
      const side = clamp(_v6.subVectors(this.control.handPos, chest).dot(right) * 1.3, -0.62, 0.62);
      const lift = clamp(_v6.subVectors(this.control.handPos, chest).dot(UP) * 0.5, -0.1, 0.42);

      const poleR = _v6.copy(chest).addScaledVector(right, 0.75 + side)
        .addScaledVector(UP, -0.75 + lift).addScaledVector(fwd, -0.2);
      rig.solveIK('armR', 'foreR', gripR, poleR);
      if (twoHanded) {
        const poleL = _v6.copy(chest).addScaledVector(right, -0.62 + side)
          .addScaledVector(UP, -0.8 + lift).addScaledVector(fwd, -0.2);
        rig.solveIK('armL', 'foreL', gripL, poleL);
      } else {
        // handL's local quaternion is force-set while two-handed; nothing put it
        // back, so switching to one hand left it frozen 167 degrees off rest.
        const hl = rig.get('handL');
        if (hl) hl.obj.quaternion.copy(hl.restQuat);
        // Rest is the hip. Everything the Force does moves the hand off it —
        // this used to be a single `gripBody ? 0.55 : -0.05` reach that only
        // applied while the one-hand key was ALSO held, so in practice no power
        // in the game had a visible arm.
        const rest = _v6.copy(chest).addScaledVector(right, -0.34).addScaledVector(UP, -0.62)
          .addScaledVector(fwd, -0.05);
        const poleL = _v2.copy(chest).addScaledVector(right, -0.85).addScaledVector(UP, -0.7);
        const palm = this._gesturePose(rest, poleL, chest, fwd, right);
        rig.solveIK('armL', 'foreL', rest, poleL);
        // Wrist AFTER the IK: solveIK writes armL and foreL, and the hand hangs
        // off the end of both.
        if (palm) rig.aimBoneWorld('handL', palm, right);
      }
      // THE WRIST IS SET TO AN ARBITRARY ORIENTATION, AND THAT IS A REAL DEFECT.
      //
      // The hand's world quaternion is copied straight off the hilt, so the
      // wrist absorbs the entire difference between the roll solveIK gave the
      // forearm and the roll the blade wants. Measured through a real
      // mouse-driven slash: the wrist reaches 179.7 degrees from its own rest
      // pose. A human wrist bends about 80 and rolls about 30. At the extremes
      // of a swing this hand is folded completely backwards.
      //
      // Moving the roll onto the forearm — the anatomically right answer, since
      // pronation is a forearm motion and not a wrist one — was implemented,
      // MEASURED, AND REMOVED. It took the worst wrist deviation only from
      // 179.7 to 157.4 degrees, both of which are impossible, and it took the
      // forearm's own peak angular rate from 6874 deg/s to 10653: the required
      // twist passes +/-180, the swing-twist decomposition wraps there, and the
      // bone snapped between its anatomical limits frame to frame. Spinning
      // faster is not the fix.
      //
      // The 6874 deg/s the forearm ALREADY turns at is the other half of it and
      // is not the wrist's doing: solveIK rolls the lower bone with aimY against
      // the elbow pole, and aimY substitutes a fixed reference whenever the two
      // come within 10 degrees of parallel — which snaps the roll by up to 90
      // degrees in the middle of a swing. Measured: it fires on 7 frames of 210,
      // isolated spikes, and nothing below touches it.
      //
      // ── SECOND ATTEMPT, ALSO MEASURED, ALSO REMOVED ──────────────────────
      //
      // Redistributing the twist properly this time — decomposed in the
      // FOREARM's frame about the axis the roll actually turns about, twist-
      // first because a forearm roll arrives pre-multiplied, and unwrapped
      // against the previous frame so +/-180 cannot snap it. All three of those
      // were wrong or missing in the first attempt. Splitting the wrist's
      // deviation apart shows why it looked like the answer:
      //
      //        BEND   median 37.4  p90 110.4  max 145.6   past 80: 43/210
      //        ROLL   median 81.5  p90 151.9  max 179.7   past 30: 197/210
      //
      // Roll dominates, so pronation IS the right lever for it, and cancelling
      // all of it works: roll median 81.5 -> 6.0, total p90 164.8 -> 110.9,
      // max 179.7 -> 156.4, frames past 80 166 -> 121.
      //
      // It still does not ship, for two reasons that are the whole finding.
      // Cancelling all the roll needs 172 degrees of forearm pronation, and a
      // real forearm has about 150 through its ENTIRE range; at any anatomical
      // limit (75-120 deg) the result is WORSE than doing nothing, median 106
      // to 120 against 90.3, because a partly-cancelled roll adds to the bend
      // instead of opposing it. And with the roll gone entirely the BEND alone
      // is still past 80 degrees on 43 frames of 210.
      //
      // No amount of roll can change that bend. It is the angle between the
      // forearm's direction — which solveIK picks purely from where the grip
      // POINT is — and the hilt's axis. So the fix is not a limit and not a
      // redistribution: the arm has to be solved from the grip's ORIENTATION as
      // well as its position, so the forearm arrives already pointing somewhere
      // a wrist can finish from. That is a real solver change and it is worth
      // doing; what is written down here is that the two cheaper answers have
      // both now been measured and neither one is it.
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
      const poleL = _v2.copy(chest).addScaledVector(right, -0.8).addScaledVector(UP, -0.7);
      // The off hand still answers to the Force with the blade away — and the
      // saber throw's own gesture lives here, since throwState leaves 'held' on
      // the frame it fires and this is the only branch that runs afterwards.
      const palm = this._gesturePose(rest, poleL, chest, fwd, right);
      rig.solveIK('armL', 'foreL', rest, poleL);
      if (palm) rig.aimBoneWorld('handL', palm, right);
    }

    // Both branches above turn the WRIST and nothing else. The fingers are the
    // other half of the gesture and they live here — see _openPalm.
    this._openPalm();

    // Head: a limited glance toward the aim, layered on the rest pose. The head
    // bone's +Y runs up through the skull and its face is +Z, so the old code —
    // which aimed +Y at the blade tip — laid the head over sideways every time
    // the blade moved. It read as a snapped neck, not a look.
    const head = rig.get('head');
    if (head && head.obj.parent) {
      head.obj.parent.getWorldQuaternion(_q1);
      _q1.multiply(head.restQuat);                      // rest orientation, in world
      _v1.copy(this.aimDir).applyQuaternion(_q1.invert());
      // Shortest arc, then clamp. Raw atan2 jumps +pi -> -pi when the aim
      // passes directly behind the head, which whipped the head 97 degrees
      // across the front every time facing diverged from the camera.
      let yaw = Math.atan2(_v1.x, _v1.z);
      let d = yaw - (this._headYaw ?? 0);
      while (d > Math.PI) d -= TAU;
      while (d < -Math.PI) d += TAU;
      yaw = clamp((this._headYaw ?? 0) + d, -0.85, 0.85);
      const pitch = clamp(Math.asin(clamp(_v1.y, -1, 1)), -0.5, 0.42);
      this._headYaw = damp(this._headYaw ?? 0, yaw, 11, dt);
      this._headPitch = damp(this._headPitch ?? 0, pitch, 11, dt);
      head.obj.quaternion.copy(head.restQuat)
        .multiply(_q2.setFromEuler(new THREE.Euler(-this._headPitch, this._headYaw, 0, 'YXZ')));
    }
    rig.updateMatrices();

    // the cloak hangs off the finished pose, and feels the wind and the run
    if (this.cloak) {
      _v1.set(0, 0, 0).addScaledVector(this.velocity, -0.85);
      _v1.x += Math.sin(ctx.time * 0.7) * 1.1;
      _v1.z += Math.cos(ctx.time * 0.53) * 1.1;
      // SKIRT FIRST: the cape's collider proxy is the skirt's own particles, so
      // stepping the cape first would have it dodging where the skirt was last
      // frame.
      if (this.skirt) {
        this.skirt.setVisible(!this.camera.firstPerson);
        if (!this.camera.firstPerson) this.skirt.update(dt, this.skirt.refreshColliders(), _v1);
      }
      this.cloak.update(dt, this.cloak.refreshColliders(), _v1);
      this.cloak.setVisible(!this.camera.firstPerson);
    }
  }

  _updateCamera(dt, ctx) {
    const s = this.world.settings;
    this.camera.fovTarget = s.fov + clamp(Math.hypot(this.velocity.x, this.velocity.z) - 4.6, 0, 4) * 1.6
      + (this.dashTimer > 0 ? 7 : 0);
    this.camera.rollTarget = clamp(-this.control.angVel.y * 0.006, -0.05, 0.05);
    this.camera.update(dt, this.position, {
      physics: ctx.physics, terrain: ctx.terrain, eyeHeight: lerp(1.62, 1.22, this.crouch),
      // The whole pelvis, not the bob and not half of it. _updateBody runs
      // before this, so `pelvis` is this frame's, not last frame's.
      pelvis: this.animator?.pelvis,
    });
  }

  /**
   * Force economy, in one place.
   *
   * `forcePower` scales how hard every power hits; `forceDrain` scales what it
   * costs, and at 0 it costs nothing at all. Both are player-facing settings —
   * this is a power fantasy, and someone who wants to spend an afternoon
   * throwing rocks around should not have to fight a resource meter for it.
   */
  get forceScale() { return this.world.settings?.forcePower ?? 1; }
  _spend(cost) {
    const drain = this.world.settings?.forceDrain ?? 1;
    if (drain <= 0) return true;                   // unlimited
    const c = cost * drain * this.boonMods.forceCost;
    if (this.force < c) return false;
    this.force -= c;
    return true;
  }
  _canSpend(cost) {
    const drain = this.world.settings?.forceDrain ?? 1;
    return drain <= 0 || this.force >= cost * drain * this.boonMods.forceCost;
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

  /* ── force powers: the shared laws ───────────────────────────────── */

  /**
   * The heaviest thing the Force can take hold of right now, in kilograms.
   * See LIFT_AT_ONE for why these two numbers are the numbers they are.
   */
  get liftCapacity() { return LIFT_AT_ONE * Math.pow(this.forceScale, LIFT_EXPONENT); }

  /** How far out the Force reaches to take hold of something, in metres. */
  get forceReach() { return 18 * Math.sqrt(this.forceScale); }

  /**
   * How briskly the Force moves a given mass: 1 for something it barely
   * notices, 0.28 for something right at the limit. Every lift, shove and throw
   * multiplies by this, and it is the whole reason mass is now visible at all.
   * It never reaches zero — a thing you can hold is a thing you can move, just
   * slowly, and a lift that stalls dead reads as a broken button.
   */
  _heft(mass) { return lerp(1, 0.28, clamp(Math.max(0, mass) / this.liftCapacity, 0, 1)); }

  /**
   * Where an enemy's middle is, derived from its POSITION rather than from
   * Enemy.aimPoint.
   *
   * aimPoint reads the chest BONE's world matrix, which is (0,0,0) until that
   * enemy has been through one update — and the player runs before the enemies
   * do, so on the frame a wave spawns every Force power would have aimed at the
   * world origin. Position plus chest height is always true.
   */
  _enemyPoint(e, out) {
    return out.set(e.position.x, e.position.y + 1.12 * (e.A ? e.A.scale : 1), e.position.z);
  }

  /* ── gestures ────────────────────────────────────────────────────── */

  /**
   * Start an arm gesture. Sustained ones run until _endGesture.
   *
   * `at` is where the hand should point for a one-shot — captured NOW, because
   * a hurl's target has stopped existing as a held object by the time the arm
   * finishes travelling. Sustained gestures ignore it and track their subject
   * live instead; see GESTURES[].track.
   */
  _gesture(kind, at = null) {
    const g = GESTURES[kind];
    if (!g) return;
    this.gesture.kind = kind;
    this.gesture.t = 0;
    this.gesture.sustain = !!g.sustain;
    this.gesture.hasAt = !!at;
    if (at) this.gesture.at.copy(at);
  }

  /** Let a held gesture go; it falls back to rest over its own release time. */
  _endGesture(kind) {
    const G = this.gesture;
    if (!G.kind || (kind && G.kind !== kind) || !G.sustain) return;
    G.sustain = false;
    G.t = GESTURES[G.kind].attack;         // start the release from full extension
  }

  _advanceGesture(dt) {
    const G = this.gesture;
    const g = GESTURES[G.kind];
    if (!g) { G.env = 0; return; }
    G.t += dt;
    if (G.sustain || G.t <= g.attack) { G.env = smoothstep(0, g.attack, G.t); return; }
    G.env = 1 - smoothstep(g.attack, g.attack + g.release, G.t);
    if (G.t >= g.attack + g.release) { G.kind = ''; G.env = 0; }
  }

  /** What the current gesture is aimed AT, if it is aimed at anything. */
  _gestureFocus(out) {
    const g = GESTURES[this.gesture.kind];
    // A hold tracks its subject as it moves — the crate you are carrying does
    // not stay where it was when you picked it up.
    if (g && g.track) {
      if (this.gripBody) return out.copy(this.gripBody.position);
      if (this.gripEnemy) return this._enemyPoint(this.gripEnemy, out);
      if (this.stasis.active && this.stasis.held.length) {
        const h = this.stasis.held[0];
        return out.copy(h.bolt ? h.bolt.pos : h.body.position);
      }
    }
    return this.gesture.hasAt ? out.copy(this.gesture.at) : null;
  }

  /**
   * Open the off hand.
   *
   * `palm` used to reach exactly one place — aimBoneWorld, which writes a
   * QUATERNION and nothing else. So `stasis` at palm 1.0 correctly rolled the
   * wrist until the back of the hand faced the target and then presented it a
   * clenched fist, because the hand is one baked BufferGeometry built at
   * curl 0.95 and there is no bone, no morph and no retained transform inside
   * it that anything could address. Bodies.js now bakes a second, open build
   * of the same part list as morph target 0, so `palm × env` — a product this
   * function's caller already computes and smooths — is a continuous open and
   * close for one float per frame and no CPU work at all.
   *
   * LEFT HAND ONLY, and that is load-bearing rather than incidental: the saber
   * lives in the right hand, the blade solve owns that arm outright, and every
   * gesture in GESTURES is left-handed for exactly that reason. handR is never
   * touched here, so the grip cannot open mid-swing.
   */
  _openPalm() {
    const b = this.rig.get('handL');
    const m = b && b.primary;
    // droids, and anything else whose hand was not built with the morph
    if (!m || !m.morphTargetInfluences || !m.morphTargetInfluences.length) return;
    const g = GESTURES[this.gesture.kind];
    m.morphTargetInfluences[0] = g ? clamp(g.palm * this.gesture.env, 0, 1) : 0;
  }

  /**
   * Bend the free hand toward whatever the Force is doing, and hand back the
   * direction the palm should face.
   *
   * Blended by the gesture envelope rather than switched, so the hand travels
   * from the hip to the gesture and back instead of teleporting, and a power
   * fired mid-swing does not snap the arm across the body.
   */
  _gesturePose(target, pole, chest, fwd, right) {
    const g = GESTURES[this.gesture.kind];
    const env = this.gesture.env;
    if (!g || env <= 0.001) return null;

    // where the gesture wants the hand, in the aim frame
    _g1.copy(chest).addScaledVector(fwd, g.out).addScaledVector(right, g.side).addScaledVector(UP, g.up);

    // A grip or a hurl points at the THING, not at the crosshair — you cannot
    // read "he is holding that" off a hand aimed somewhere else.
    const reach = Math.hypot(g.out, g.side, g.up);
    const at = this._gestureFocus(_g2);
    _g4.copy(fwd);
    if (at) {
      _g3.subVectors(at, chest);
      const d = _g3.length();
      if (d > 0.3) {
        _g3.multiplyScalar(1 / d);
        _g1.copy(chest).addScaledVector(_g3, reach).addScaledVector(UP, 0.05);
        _g4.copy(_g3);
      }
    }
    target.lerp(_g1, env);

    // The elbow has to ride out with the hand or the forearm folds back through
    // the ribs — the same failure the hilt poles were fixed for.
    _g3.copy(chest).addScaledVector(right, -0.92).addScaledVector(UP, -0.40).addScaledVector(fwd, -0.12);
    pole.lerp(_g3, env);

    // Palm: 0 points the fingers at the target, 1 turns the hand flat to face
    // it. The hand bone's +Y runs out through the fingers, so rolling the palm
    // up IS rotating +Y toward world up.
    _g5.copy(_g4).lerp(UP, clamp(g.palm * env, 0, 0.98));
    if (_g5.lengthSq() < 1e-8) return null;
    return _g5.normalize();
  }

  /* ── force powers ────────────────────────────────────────────────── */

  forcePush(ctx) {
    if (this.cooldowns.push > 0 || !this._spend(20)) return;
    this.cooldowns.push = 0.55;
    this._gesture('push');
    audio.force(this.chest, 'push');
    this.camera.addShake(0.3);
    this.cloak?.impulse(_v5.copy(this.aimDir).negate().setY(0.4), 2.6); this.skirt?.impulse(_v5.copy(this.aimDir).negate().setY(0.4), 2.6);

    const origin = this.chest;
    const dir = this.aimDir;
    // forcePower scales reach and impulse together, so turning it up makes the
    // push genuinely bigger rather than just harder-hitting in the same cone.
    const P = this.forceScale;
    const range = 13 * Math.sqrt(P), halfAngle = 0.72;

    for (const e of ctx.enemies || []) {
      if (e.dead) continue;
      _v1.subVectors(e.position, origin);
      const d = _v1.length();
      if (d > range) continue;
      _v1.multiplyScalar(1 / d);
      if (_v1.dot(dir) < Math.cos(halfAngle)) continue;
      const k = (1 - d / range);
      _v2.copy(dir).multiplyScalar(20 * k * P).setY((7 * k + 3) * P);
      e.applyKnockback(_v2, 8 * k * P, this);
    }
    for (const b of (ctx.physics ? ctx.physics.bodies : [])) {
      if (b.invMass === 0 || b === this.body) continue;
      _v1.subVectors(b.position, origin);
      const d = _v1.length();
      if (d > range) continue;
      _v1.multiplyScalar(1 / d);
      if (_v1.dot(dir) < Math.cos(halfAngle)) continue;
      const k = 1 - d / range;
      // Mass-proportional impulse cancels mass exactly, so every prop in the
      // game took the same 8.6 m/s off a default push — a 900 kg pillar left
      // like a 22 kg crate. `heft` puts the weight back: at forcePower 1 the
      // pillar gets a quarter of the crate's delta-v, at 4 it gets all of it.
      const heft = this._heft(b.mass);
      _v2.copy(dir).multiplyScalar(b.mass * 15 * k * P * heft).setY(b.mass * 6 * k * P * heft);
      b.applyImpulse(_v2, b.position);
    }
    // architecture: a push does not move a wall, it damages it (Destruction.js)
    this.world?.destruction?.forceBlast(origin, dir, range, P);
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
    if (this.cooldowns.pull > 0 || !this._spend(16)) return;
    this.cooldowns.pull = 0.6;
    this._gesture('pull');
    audio.force(this.chest, 'pull');
    this.cloak?.impulse(_v5.copy(this.aimDir).setY(0.3), 1.8); this.skirt?.impulse(_v5.copy(this.aimDir).setY(0.3), 1.8);
    // Reach scales with the setting, same law as push and grip. A pull that
    // stayed at 17 m while the grip reached 36 was the odd one out.
    const P = this.forceScale;
    const origin = this.chest, dir = this.aimDir, range = 17 * Math.sqrt(P);
    for (const e of ctx.enemies || []) {
      if (e.dead) continue;
      _v1.subVectors(e.position, origin);
      const d = _v1.length();
      if (d > range || d < 1.5) continue;
      _v1.multiplyScalar(1 / d);
      if (_v1.dot(dir) < 0.72) continue;
      const heft = this._heft(e.A ? e.A.mass : 80);
      _v2.copy(_v1).multiplyScalar(-Math.min(d * 3.2, 22) * heft).setY(4.5 * heft);
      e.applyKnockback(_v2, 2, this, true);
    }
    for (const b of (ctx.physics ? ctx.physics.bodies : [])) {
      if (b.invMass === 0 || b === this.body) continue;
      _v1.subVectors(b.position, origin);
      const d = _v1.length();
      if (d > range || d < 1) continue;
      _v1.multiplyScalar(1 / d);
      if (_v1.dot(dir) < 0.72) continue;
      const heft = this._heft(b.mass);
      _v2.copy(_v1).multiplyScalar(-b.mass * Math.min(d * 2.2, 16) * heft).setY(b.mass * 3.4 * heft);
      b.applyImpulse(_v2, b.position);
    }
  }

  /** Is this physics body something the Force is allowed to take hold of? */
  _grippableBody(b) {
    if (!b || b === this.body || b.dead) return false;
    // An enemy's movement proxy is KINEMATIC, so invMass is 0 and the old
    // filter could never see one. That is why gripping a droid only worked when
    // the ray hit nothing at all — a crate anywhere behind it won the pick.
    if (b.layer === LAYER.ENEMY) return !!(b.userData.enemy && !b.userData.enemy.dead);
    // `grippable` was WRITTEN AND NEVER READ. Props.js sets it false on exactly
    // two things — the pillar and the spire — and Destruction's proxy sets it
    // false too, and not one line in src/ or tools/ ever looked at it. The only
    // real gate was mass, so at a high Force Power slider the 900 kg pillar the
    // author had explicitly excluded came out of the ground anyway, and the
    // proxy that stands in for every destructible structure in the level was
    // grippable in principle. An author's "no" now means no.
    if (b.userData && b.userData.prop && b.userData.prop.grippable === false) return false;
    return b.invMass > 0
      && (b.layer === LAYER.PROP || b.layer === LAYER.DEBRIS || b.layer === LAYER.RAGDOLL);
  }

  /**
   * Everything the Force could pick up, and how heavy it is.
   *
   * Three widenings on what this used to be, all of them asked for by name:
   *  · enemies are in the SAME search as props rather than a fallback that only
   *    ran when the ray hit literally nothing;
   *  · anything loose counts — crates, barrels, consoles, spires, pillars, cut
   *    prop halves, wall rubble from Destruction, corpses, severed limbs, and
   *    the enemies themselves. The only things left out are the terrain, the
   *    static architecture (a push damages that; see Destruction.forceBlast)
   *    and the player;
   *  · the crosshair does not have to be ON it. The ray is tried first because
   *    it is exact, and a cone around the aim catches everything else — pixel
   *    accuracy on a tumbling rock at 20 m is not a skill worth testing.
   */
  _pickGripTarget(ctx) {
    const reach = this.forceReach;
    // The ray leaves the CAMERA so it agrees with the crosshair, and in third
    // person that is ~3 m behind the head — so it has to run that much further
    // than the reach or the far end of the reach is unreachable.
    const lead = this.camera.pos.distanceTo(this.chest);
    const maxD = reach + lead;

    const hit = ctx.physics ? ctx.physics.raycast(this.camera.pos, this.aimDir, maxD,
      (b) => this._grippableBody(b)) : null;
    if (hit && hit.body && this._grippableBody(hit.body)) {
      const e = hit.body.userData.enemy;
      return e ? { enemy: e, mass: e.A ? e.A.mass : 80, distance: hit.distance }
               : { body: hit.body, mass: hit.body.mass, distance: hit.distance };
    }

    // Nothing under the crosshair. Take the best thing near it, but never
    // through the wall the ray just stopped on.
    const wall = hit ? hit.distance : maxD;
    let best = null, bestDot = 0.965;              // ≈15° cone
    const consider = (obj, point, mass, isEnemy) => {
      _g1.subVectors(point, this.camera.pos);
      const d = _g1.length();
      if (d > maxD || d < 0.6 || d > wall + 1.2) return;
      const dot = _g1.multiplyScalar(1 / d).dot(this.aimDir);
      if (dot < bestDot) return;
      bestDot = dot;
      best = isEnemy ? { enemy: obj, mass, distance: d } : { body: obj, mass, distance: d };
    };
    for (const b of (ctx.physics ? ctx.physics.bodies : [])) {
      if (!this._grippableBody(b) || b.layer === LAYER.ENEMY) continue;
      consider(b, b.position, b.mass, false);
    }
    for (const e of ctx.enemies || []) {
      if (e.dead) continue;
      consider(e, this._enemyPoint(e, _g2), e.A ? e.A.mass : 80, true);
    }
    return best;
  }

  toggleGrip(ctx) {
    if (this.gripBody || this.gripEnemy) { this.releaseGrip(); return; }
    if (!this._canSpend(10)) return;

    const target = this._pickGripTarget(ctx);
    this.lastGripRefusal = null;
    if (!target) return;

    // The mass gate. Note this replaces Enemy.grippable, which was a flat
    // `!A.big && !A.boss` — a size limit no setting could reach, and precisely
    // the cap the player hit. A walker or an Acklay is now a question of how
    // far the Force slider is turned up, not a permanent no.
    const cap = this.liftCapacity;
    if (target.mass > cap) {
      // Say WHY. This recorded the two numbers and nothing ever read them, so a
      // refused lift was a groan and a shudder and no explanation — which reads
      // as the Force being broken rather than as the thing being too heavy. The
      // player cannot see a mass, so the feedback has to carry it, and it has to
      // name the slider that moves the cap or the number is just a wall.
      this.lastGripRefusal = { mass: target.mass, cap };
      // Read back out of the FIELD, by name, rather than off the locals. It
      // looks redundant and is not: writing these two numbers somewhere nothing
      // read them is exactly how a refused lift ended up being a groan with no
      // explanation, and a field with no reader is a comment with syntax. One
      // home, and the seam stays open for the HUD to show it too.
      const why = this.lastGripRefusal;
      this.world?.notify?.('TOO HEAVY',
        `${Math.round(why.mass)} kg against your ${Math.round(why.cap)} kg — raise Force Power`);
      this._gripStrain(ctx, target);
      return;
    }

    this._gesture('grip');
    const lead = this.camera.pos.distanceTo(this.chest);
    this.gripDistance = clamp(target.distance, lead + 1.4, lead + this.forceReach);
    if (target.enemy) {
      this.gripEnemy = target.enemy;
      target.enemy.gripped = true;
      this._liftPoint.copy(target.enemy.position);
    } else {
      this.gripBody = target.body;
      target.body.gravityScale = 0;
      target.body.wake();
    }
    audio.force(this.chest, 'pull');
  }

  /**
   * Too heavy is a real answer and it has to SOUND like one, or the player
   * reads it as the button not working. A groan, a shudder, and dust off the
   * thing that would not come.
   */
  _gripStrain(ctx, target) {
    const p = target.enemy ? target.enemy.position : target.body.position;
    audio.tone({ freq: 96, freqEnd: 42, dur: 0.42, gain: 0.22, type: 'sawtooth', pos: p });
    audio.noise({ dur: 0.34, gain: 0.14, type: 'lowpass', freq: 420, freqEnd: 110, pos: p, pink: true });
    this.camera.addShake(0.12);
    if (ctx.particles) {
      for (let i = 0; i < 10; i++) {
        _g1.set((rng() - 0.5) * 2, rng() * 0.6, (rng() - 0.5) * 2);
        ctx.particles.dust.spawn(p, _g1, { life: 0.5, size: 0.3, drag: 3, gravity: 1.4,
          color: 0xc8c0b0, alpha: 0.2 });
      }
    }
  }

  releaseGrip() {
    if (this.gripBody) { this.gripBody.gravityScale = 1; this.gripBody = null; }
    if (this.gripEnemy) { this.gripEnemy.gripped = false; this.gripEnemy.liftTarget = null; this.gripEnemy = null; }
    this._endGesture('grip');
  }

  /**
   * Where the player is actually pointing, as a world point, plus whoever is
   * standing on it.
   *
   * The old hurl aimed at `camera.pos + aim * 40`, which is a point in space
   * rather than a target: something held out to the left of the crosshair was
   * launched along the line from IT to that point, so it landed metres wide of
   * what the player was looking at, and the error grew with hold distance.
   */
  _aimTarget(ctx, out = new THREE.Vector3()) {
    const FAR = 110;
    let dist = FAR, enemy = null;
    const hit = ctx.physics ? ctx.physics.raycast(this.camera.pos, this.aimDir, FAR,
      (b) => b !== this.body && b !== this.gripBody) : null;
    if (hit) dist = hit.distance;
    // Someone standing near the aim line beats the wall behind them. This is
    // the "send them back towards whoever I want" half, and it has to be
    // forgiving or picking a target at 30 m is a coin flip.
    let bestDot = 0.985;                             // ≈10° cone
    for (const e of ctx.enemies || []) {
      if (e.dead) continue;
      _g1.subVectors(this._enemyPoint(e, _g2), this.camera.pos);
      const d = _g1.length();
      if (d < 1 || d > FAR) continue;
      const dot = _g1.multiplyScalar(1 / d).dot(this.aimDir);
      if (dot < bestDot) continue;
      bestDot = dot; enemy = e; dist = d;
    }
    out.copy(this.camera.pos).addScaledVector(this.aimDir, dist);
    if (enemy) this._enemyPoint(enemy, out);
    return { point: out, enemy };
  }

  hurlGripped(ctx) {
    if (!this.gripBody && !this.gripEnemy) return;
    const aim = this._aimTarget(ctx, _g3);
    const P = this.forceScale;
    const cap = this.liftCapacity;
    this._gesture('hurl', aim.point);
    this.cloak?.impulse(_v5.copy(this.aimDir).negate().setY(0.3), 2.4); this.skirt?.impulse(_v5.copy(this.aimDir).negate().setY(0.3), 2.4);
    this.camera.addShake(0.26);
    this.world?.addHitstop?.(0.035);

    if (this.gripBody) {
      const b = this.gripBody;
      const m = Math.max(1, b.mass);
      b.gravityScale = 1;
      _v2.subVectors(aim.point, b.position);
      if (_v2.lengthSq() < 1e-8) _v2.copy(this.aimDir);
      _v2.normalize();
      // Speed by mass. Before this every mass in the game left at exactly the
      // same 26 m/s (104 at forcePower 4), which is why a throw had no weight
      // at either end of the scale. Written as a velocity rather than an
      // impulse because that is what the number MEANS — an impulse of
      // mass × speed is the same statement with a cancellation hidden in it.
      const speed = 34 * Math.sqrt(P) * lerp(1.25, 0.45, clamp(m / cap, 0, 1));
      b.velocity.copy(_v2).multiplyScalar(speed);
      b.angularVelocity.set((rng() - .5) * 7, (rng() - .5) * 7, (rng() - .5) * 7);
      b.wake();
      this._trackHurl(b, speed);
      this._hurlVfx(ctx, b.position, _v2, Math.max(0.3, b.boundingRadius), speed);
      this.gripBody = null;
    } else {
      const e = this.gripEnemy;
      const m = e.A ? e.A.mass : 80;
      e.gripped = false;
      e.liftTarget = null;
      _v2.subVectors(aim.point, e.position);
      if (_v2.lengthSq() < 1e-8) _v2.copy(this.aimDir);
      _v2.normalize();
      const speed = 30 * Math.sqrt(P) * lerp(1.2, 0.5, clamp(m / cap, 0, 1));
      e.applyKnockback(_v2.clone().multiplyScalar(speed), 8 + 14 * P, this);
      e.stun(0.9);
      this._hurlVfx(ctx, e.position, _v2, 0.5, speed);
      this.gripEnemy = null;
    }
    this._endGesture('grip');
    audio.force(this.chest, 'push');
  }

  /** The visible half of a throw: a cone of exhaust behind it and a whoosh. */
  _hurlVfx(ctx, pos, dir, radius, speed) {
    audio.swing(clamp(speed * 0.7, 12, 40), pos);
    if (!ctx.particles) return;
    for (let i = 0; i < 18; i++) {
      _g1.copy(dir).multiplyScalar(-(2 + rng() * 6));
      _g1.x += (rng() - 0.5) * 5; _g1.y += (rng() - 0.5) * 4; _g1.z += (rng() - 0.5) * 5;
      ctx.particles.dust.spawn(pos, _g1, { life: 0.55, size: radius * 0.9, drag: 3,
        gravity: 0.3, color: 0xdce6f2, alpha: 0.16 });
    }
    ctx.particles.plasma.spawn(pos, _g2.set(0, 0, 0),
      { life: 0.22, size: radius * 3.2, drag: 1, gravity: 0, color: 0x9fd8ff, alpha: 0.5 });
  }

  /**
   * Remember what we threw, so it can hurt what it hits.
   *
   * `userData.hurledBy` has been set here since the beginning and is read by
   * nobody: RapierWorld stores Body.onContact and never dispatches it — only
   * the retired sphere solver ever did — so a hurled crate passed through a
   * droid without touching it. Until contacts come back the thrower owns the
   * consequence, which is also the only place that knows it was a throw.
   */
  _trackHurl(body, speed) {
    body.userData.hurledBy = this;
    body.userData.hurlTimer = 2.6;
    this.hurled.push({ body, timer: 2.6, hit: new Set(), speed });
    if (this.hurled.length > 12) this.hurled.shift();
  }

  _updateHurled(dt, ctx) {
    for (let i = this.hurled.length - 1; i >= 0; i--) {
      const h = this.hurled[i];
      const b = h.body;
      h.timer -= dt;
      const speed = b.velocity.length();
      // Spent: out of time, gone, or slowed to something that could not hurt a
      // droid if it landed on one.
      if (h.timer <= 0 || b.dead || speed < 7) { this.hurled.splice(i, 1); continue; }
      for (const e of ctx.enemies || []) {
        if (e.dead || h.hit.has(e.id)) continue;
        const r = b.boundingRadius + (e.radius ?? 0.4) + 0.25;
        _g1.copy(e.position).setY(e.position.y + (e.A && e.A.big ? 1.4 : 0.9));
        if (_g1.distanceToSquared(b.position) > r * r) continue;
        h.hit.add(e.id);
        // Kinetic energy, scaled to the damage numbers this game uses: a 22 kg
        // crate at 40 m/s reads 21, a 210 kg droideka body at 25 reads 79, and
        // the ceiling stops a pillar from one-shotting a boss.
        const dmg = clamp(b.mass * speed * speed * 0.0006, 8, 140);
        _g2.copy(b.velocity).multiplyScalar(1 / Math.max(1e-3, speed));
        e.applyKnockback(_g2.multiplyScalar(clamp(speed * 0.5, 4, 22)).setY(4), dmg, this);
        audio.thud(b.position, clamp(dmg / 60, 0.4, 1.4));
        this.camera.addShake(clamp(dmg / 220, 0.04, 0.3));
        ctx.particles?.sparkBurst(b.position, null, 14, { speed: 7 });
        // A throw sheds most of its momentum into whatever it hit.
        b.velocity.multiplyScalar(0.35);
      }
    }
  }

  _updateGrip(dt, ctx) {
    const cap = this.liftCapacity;

    // ── distance control.
    // The hold point is measured from the CAMERA, which in third person sits
    // ~3.05 m behind the head — so the old floor of 1.6 m parked the object
    // 1.45 m BEHIND the chest, inside the player. Everything here is therefore
    // done on the distance in front of the CHEST and converted back, which is
    // both the number the player perceives and the one worth clamping.
    const lead = this.camera.pos.distanceTo(this.chest);
    let out = this.gripDistance - lead;
    // One notch is a fixed 12% of the current distance rather than a fixed
    // 0.6 m. That makes it fine at arm's length (19 cm a notch at 1.4 m) and
    // fast across the arena (2.2 m a notch at 18), and it costs a comparable
    // number of notches to cross the whole reach at any setting — measured
    // 14 at forcePower 0.25, 19 at 1, 25 at 4 — where the fixed step took 13,
    // 27 and 57 for the same three ranges.
    if (this._wheel) out *= Math.pow(0.88, this._wheel);
    out = clamp(out, 1.4, this.forceReach);
    this.gripDistance = lead + out;
    const hold = _v1.copy(this.camera.pos).addScaledVector(this.aimDir, this.gripDistance);

    if (this.gripBody) {
      const b = this.gripBody;
      if (b.dead || b.mass > cap) { this.releaseGrip(); return; }
      // Heavy things cost more to hold, which is what stops the top of the
      // slider from being free. Only drop it when the Force actually ran out —
      // with drain disabled the bar sits wherever it was and this must not fire.
      if (!this._spend((7 + 6 * clamp(b.mass / cap, 0, 1)) * dt)) { this.releaseGrip(); return; }
      const heft = this._heft(b.mass);
      b.wake();
      _v2.subVectors(hold, b.position);
      b.velocity.copy(_v2).multiplyScalar(9 * heft).clampLength(0, 28 * heft);
      b.angularVelocity.multiplyScalar(1 - dt * 2);
      b.angularVelocity.y += dt * 2.2 * heft;
      if (ctx.particles && rng() < 0.4) {
        ctx.particles.plasma.spawn(b.position, _v3.set(0, 0, 0),
          { life: 0.3, size: b.boundingRadius * 1.5, drag: 1, gravity: 0, color: 0x88bbff, alpha: 0.12 });
      }
    } else if (this.gripEnemy) {
      const e = this.gripEnemy;
      const m = e.A ? e.A.mass : 80;
      if (e.dead || m > cap) { this.releaseGrip(); return; }
      if (!this._spend((11 + 9 * clamp(m / cap, 0, 1)) * dt)) { this.releaseGrip(); return; }
      // Enemy.update damps its own position toward liftTarget at a fixed rate,
      // so the only place a heavy body can be made to FEEL heavy from here is
      // the target: walk it toward the hold point at a speed the Force can
      // actually manage rather than teleporting it there every frame.
      dampVec(this._liftPoint, hold, 0.8 + 3.4 * this._heft(m), dt);
      e.liftTarget = this._liftPoint;
      if (ctx.particles && rng() < 0.3) {
        ctx.particles.plasma.spawn(this._enemyPoint(e, _v3), _v4.set(0, 0, 0),
          { life: 0.3, size: 0.8, drag: 1, gravity: 0, color: 0x88bbff, alpha: 0.12 });
      }
    }
  }

  throwOrRecall(ctx) {
    if (this.throwState === 'held') {
      if (!this.saber.lit || this.force < 14 || this.cooldowns.throw > 0) return;
      this.force -= 14 * this.boonMods.forceCost;
      this.cooldowns.throw = 0.4;
      this._gesture('cast');
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
    // A one-shot, not a hold. Sense is a mode you can leave running for a whole
    // fight, and a sustained gesture would have the off hand raised — and the
    // blade one-handed — for the entire duration of it.
    this._gesture('sense');
    this.world.setTimeScale(0.42);
    this.world.engine.setSense(1);
    audio.force(this.chest, 'sense');
  }

  forceLightning(ctx) {
    const cost = 30 * this.boonMods.forceCost;
    if (this.force < cost || this.cooldowns.lightning > 0) return;
    this.force -= cost;
    this.cooldowns.lightning = 1.5;
    this._gesture('lightning');
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

  /* ── force stop ──────────────────────────────────────────────────── */

  /**
   * FORCE STOP — freeze what is in flight, then decide where it goes.
   *
   * The marquee power, and the reason it earns that is the ORDER it puts things
   * in: the blade decides nothing here. A wall of blaster fire stops dead in
   * the air, the camera is entirely yours for as long as the field holds, and
   * where you are looking when you let go is where all of it goes at once.
   *
   * It reuses BoltPool's hold/release rather than reimplementing arrest — see
   * StasisAnchor for why that is not a hack but the point.
   */
  toggleStasis(ctx) {
    if (this.stasis.active) { this.releaseStasis(ctx, true); return; }
    if (this.cooldowns.stasis > 0 || !this._spend(26)) return;
    const S = this.stasis;
    const P = this.forceScale;
    S.active = true;
    // 9 m at 1x reaches across a firefight; 18 m at 4x swallows one whole.
    S.radius = 9 * Math.sqrt(P);
    S.timer = 3.2 + 1.6 * P;
    S.centre.copy(this.chest);
    S.target = null;
    S.vfx = 0;
    this._gesture('stasis');
    const taken = this._stasisCapture(ctx);
    audio.force(this.chest, 'sense');
    audio.tone({ freq: 220, freqEnd: 1500, dur: 0.5, gain: 0.18, type: 'triangle', pos: this.chest });
    this.world?.engine?.flash?.(0.05);
    this.camera.addShake(0.14);
    if (ctx.particles) {
      for (let i = 0; i < 26; i++) {
        const a = (i / 26) * TAU;
        _g1.set(Math.cos(a), 0.15, Math.sin(a)).multiplyScalar(S.radius * 0.9);
        ctx.particles.dust.spawn(this.chest, _g1, { life: 0.7, size: 0.5, drag: 3.4,
          gravity: 0, color: 0xbcd8ff, alpha: 0.14 });
      }
    }
    return taken;
  }

  /** Sweep the field and arrest anything hostile inside it. Returns how many. */
  _stasisCapture(ctx) {
    const S = this.stasis;
    const r2 = S.radius * S.radius;
    let taken = 0;
    if (ctx.bolts) {
      for (const bolt of ctx.bolts.bolts) {
        if (!bolt.active || bolt.held || bolt.team === this.team) continue;
        if (bolt.pos.distanceToSquared(S.centre) > r2) continue;
        ctx.bolts.hold(bolt, new StasisAnchor(bolt.pos), 0.5);
        S.held.push({ bolt });
        taken++;
      }
    }
    const cap = this.liftCapacity;
    if (ctx.physics) {
      for (const b of ctx.physics.bodies) {
        if (b.invMass === 0 || b === this.body || b === this.gripBody || b.mass > cap) continue;
        if (b.layer !== LAYER.PROP && b.layer !== LAYER.DEBRIS && b.layer !== LAYER.RAGDOLL) continue;
        if (S.bodies.has(b) || b.position.distanceToSquared(S.centre) > r2) continue;
        // Only things actually IN FLIGHT. Freezing the crate you are standing
        // next to is not a moment, it is a bug report.
        if (b.velocity.lengthSq() < 4) continue;
        S.bodies.add(b);
        S.held.push({ body: b, grav: b.gravityScale });
        b.gravityScale = 0;
        taken++;
      }
    }
    return taken;
  }

  _updateStasis(dt, ctx) {
    const S = this.stasis;
    if (S.firing.length) this._flushStasisFire(dt, ctx);
    if (!S.active) return;

    // The field is centred on YOU — you are the one being shot at — so walking
    // out of a firefight ends the capture, while anything already frozen stays
    // frozen wherever it stopped.
    S.centre.copy(this.chest);
    S.timer -= dt;
    this._stasisCapture(ctx);

    // Drop anything the world took back from under us — a bolt pool cleared by
    // a level change, a corpse culled, a prop shattered. Left in the list they
    // would go on charging Force for holding nothing.
    for (let i = S.held.length - 1; i >= 0; i--) {
      const h = S.held[i];
      if (h.bolt ? (!h.bolt.active || !h.bolt.held) : (!h.body || h.body.dead)) {
        if (h.body) S.bodies.delete(h.body);
        S.held.splice(i, 1);
      }
    }

    const n = S.held.length;
    // Holding costs more the more you are holding. Running the bar dry DROPS
    // the field; letting the clock run out FIRES it — the two failures should
    // not feel the same.
    if (!this._spend((5 + 0.9 * n) * dt)) { this.releaseStasis(ctx, false); return; }
    if (S.timer <= 0) { this.releaseStasis(ctx, true); return; }

    for (const h of S.held) {
      if (!h.body || h.body.dead) continue;
      h.body.velocity.set(0, 0, 0);
      h.body.angularVelocity.set(0, 0, 0);
      h.body.wake();
    }

    // 30 Hz, throttled per FIELD rather than per bolt — twenty arrested bolts
    // is exactly when the particle pool can least afford one burst each.
    S.vfx -= dt;
    if (ctx.particles && S.vfx <= 0) {
      S.vfx = 0.033;
      for (const h of S.held) {
        const p = h.bolt ? h.bolt.pos : h.body.position;
        ctx.particles.plasma.spawn(p, _g1.set(0, 0, 0),
          { life: 0.09, size: h.bolt ? 0.2 : 0.7, drag: 1, gravity: 0, color: 0xa8d0ff, alpha: 0.5 });
      }
    }
  }

  /**
   * Let the field go. `fire` sends everything at the target; otherwise it all
   * just falls, which is what running out of Force in the middle looks like.
   */
  releaseStasis(ctx, fire = true) {
    const S = this.stasis;
    if (!S.active) return;
    S.active = false;
    this._endGesture('stasis');
    this.cooldowns.stasis = 1.4;

    if (!fire || !S.held.length) {
      for (const h of S.held) {
        if (h.bolt) { h.bolt.held = null; h.bolt.active = false; }
        else if (h.body) h.body.gravityScale = h.grav;
      }
      S.held.length = 0;
      S.bodies.clear();
      if (!fire) audio.tone({ freq: 400, freqEnd: 90, dur: 0.4, gain: 0.14, type: 'sine', pos: this.chest });
      return;
    }

    const aim = this._aimTarget(ctx, S.point);
    S.target = aim.enemy;
    this._gesture('unleash', S.point);
    // Fired in a RIPPLE. Twenty bolts leaving on one frame is a single white
    // flash; 28 ms apart they read as a volley, which is the entire reason it
    // was worth stopping them.
    S.firing = S.held;
    S.held = [];
    S.fireT = 0;
    audio.force(this.chest, 'push');
    this.camera.addShake(0.3);
    this.cloak?.impulse(_g1.copy(this.aimDir).negate().setY(0.35), 2.6); this.skirt?.impulse(_g1.copy(this.aimDir).negate().setY(0.35), 2.6);
    this.world?.addHitstop?.(0.05);
  }

  _flushStasisFire(dt, ctx) {
    const S = this.stasis;
    S.fireT -= dt;
    let guard = 0;
    while (S.firing.length && S.fireT <= 0 && guard++ < 10) {
      S.fireT += 0.028;
      this._launchStasisItem(ctx, S.firing.shift());
    }
    if (!S.firing.length) S.bodies.clear();
  }

  _launchStasisItem(ctx, h) {
    const S = this.stasis;
    const live = S.target && !S.target.dead;
    const at = live ? this._enemyPoint(S.target, _g1) : _g1.copy(S.point);
    const P = this.forceScale;

    if (h.bolt) {
      const b = h.bolt;
      if (!b.active) return;
      _g2.subVectors(at, b.pos);
      if (_g2.lengthSq() < 1e-8) _g2.copy(this.aimDir);
      _g2.normalize();
      ctx.bolts.release(b, _g2, Math.max(60, b.speed) * (0.9 + 0.35 * P));
      // team 0 AND deflected: World._boltHitTest only lets an enemy be hit by a
      // team-1 bolt if it was deflected, and only lets the player be hit by a
      // bolt that is not team 0. Both flags, or the volley passes through.
      b.team = this.team;
      b.deflected = true;
      b.deflector = this;
      b.owner = this;
      b.damage *= 1.2 + 0.3 * P;
      b.life = Math.max(b.life, 2.6);
      b.speed = b.vel.length();
      if (live) { b.homing = 2.4; b.target = at.clone(); }
      ctx.particles?.sparkBurst(b.pos, null, 5, { speed: 6, embers: false, color: 0xfff2c0 });
      return;
    }
    const b = h.body;
    if (!b || b.dead) return;
    b.gravityScale = h.grav;
    _g2.subVectors(at, b.position);
    if (_g2.lengthSq() < 1e-8) _g2.copy(this.aimDir);
    _g2.normalize();
    const speed = 34 * Math.sqrt(P) * lerp(1.25, 0.45, clamp(b.mass / this.liftCapacity, 0, 1));
    b.velocity.copy(_g2).multiplyScalar(speed);
    b.angularVelocity.set((rng() - .5) * 7, (rng() - .5) * 7, (rng() - .5) * 7);
    b.wake();
    this._trackHurl(b, speed);
    this._hurlVfx(ctx, b.position, _g2, Math.max(0.3, b.boundingRadius), speed);
  }

  /* ── force disassemble ───────────────────────────────────────────── */

  /** The nearest mechanical thing under the aim, or null. */
  _pickMechanical(ctx) {
    const range = 14 * Math.sqrt(this.forceScale);
    let best = null, bestDot = 0.93;
    for (const e of ctx.enemies || []) {
      if (e.dead && !e.actor) continue;
      if (!MECHANICAL.test(e.type)) continue;
      _g1.subVectors(this._enemyPoint(e, _g2), this.chest);
      const d = _g1.length();
      if (d > range || d < 0.5) continue;
      const dot = _g1.multiplyScalar(1 / d).dot(this.aimDir);
      if (dot < bestDot) continue;
      bestDot = dot; best = e;
    }
    return best;
  }

  /**
   * FORCE DISASSEMBLE — take a droid apart at the joints.
   *
   * Deliberately routed through Enemy.takeCut with the REAL cap from
   * Enemy.capsules(), which is the same path a sabre cut takes. So every
   * consequence a cut has happens here for free and stays in one place: the
   * molten stub on the remaining limb, the detached piece becoming a jointed
   * physics body, the topple when the legs go, the disarm when the arms go, the
   * sever event the dojo grades, the droid spark burst. Not one line of that is
   * duplicated here — a second copy of it is how the two drift apart.
   *
   * Extremities first, core last: a droid coming apart from the hands inward
   * reads as disassembly, whereas going for the chest first reads as an
   * execution and is over before you can see it.
   */
  forceDisassemble(ctx) {
    if (this.cooldowns.rend > 0) return;
    const e = this._pickMechanical(ctx);
    if (!e || !e.capsules) return;

    const P = this.forceScale;
    const centre = this._enemyPoint(e, _g1).clone();
    const caps = e.capsules();
    // Bone DEPTH, used only to break ties — it keeps the order sane on the one
    // frame after a spawn when the rig has not been solved and every capsule is
    // sitting on top of every other.
    const depth = (name) => { let b = e.rig ? e.rig.get(name) : null, n = 0; while (b && b.parent) { b = b.parent; n++; } return n; };
    const live = caps
      // vital ≥ 0.15 drops the hands and the feet. They are not worth a joint
      // of the budget: a cut takes the whole subtree, so an elbow already
      // brings the hand with it, and spending the entire default budget on two
      // detached hands is not what "take it apart" looks like.
      .filter(c => !c.shield && (c.vital ?? 0.4) >= 0.15 && (c.vital ?? 0.4) < 0.7 && !CORE_BONE.test(c.name))
      .filter(c => !e.actor || !e.actor.isSevered(c.name))
      .map(c => ({ c, d: _g2.lerpVectors(c.p0, c.p1, 0.5).distanceTo(centre), k: depth(c.name) }))
      .sort((a, b) => (b.d - a.d) || (b.k - a.k))
      .map(x => x.c);
    if (!live.length) return;
    if (!this._spend(38)) return;

    this.cooldowns.rend = 2.4;
    this._gesture('rend', centre);

    // How far it comes apart. round(1.6·P + 0.6) is 1 joint at 0.25x, 2 at 1x,
    // 4 at 2x and 7 at 4x — and seven joints off a humanoid frame is both arms
    // at the elbow, both at the shoulder, both clavicles and the head, i.e. the
    // top of the slider really does dismantle it.
    const budget = clamp(Math.round(1.6 * P + 0.6), 1, 8);

    // Legs LAST, whatever the geometry says. Enemy._loseLimbBehaviour topples
    // on the first leg lost, and topple() ragdolls the body — after which every
    // further cut is a broken joint rather than a detached piece with a molten
    // stub. Taking a foot first therefore turned a seven-joint disassembly into
    // one flying limb and a heap. Arms and head first, then it collapses.
    const legs = live.filter(c => LEG_BONE.test(c.name));
    const limbs = live.filter(c => !LEG_BONE.test(c.name));
    // The head goes after the arms and before the legs: vital 0.95 makes it a
    // lethal cut, so leading with it ends the show before it starts.
    if (budget >= 5) {
      const head = caps.find(c => c.name === 'head' && (!e.actor || !e.actor.isSevered('head')));
      if (head) limbs.push(head);
    }
    limbs.push(...legs);

    let cut = 0;
    for (const c of limbs) {
      if (cut >= budget) break;
      // Re-checked INSIDE the loop, not just when the list was built. A cut
      // takes the whole subtree below it, so severing an upper arm severs the
      // forearm and the hand too — and without this the next two iterations
      // spent budget on bones that were already gone, reported two sever
      // events the actor never made, and a forcePower-4 disassembly took
      // exactly one joint off.
      if (e.actor && e.actor.isSevered(c.name)) continue;
      _g3.lerpVectors(c.p0, c.p1, 0.5);
      _g4.subVectors(_g3, centre);
      _g4.y = _g4.y * 0.4 + 0.35;                       // bias the scatter upward
      if (_g4.lengthSq() < 1e-8) _g4.set(0, 1, 0);
      // Ragdoll scales this by 0.35 in takeCut and again by 0.34 in finalise,
      // so ~28 here is the 3 m/s of drift that makes a piece leave rather than
      // drop; the rest is what forcePower buys.
      _g4.normalize().multiplyScalar(18 + 14 * P);
      e.takeCut({
        bone: c.name, cutT: 0.14, cap: c, point: _g3.clone(),
        impulse: _g4.clone(), normal: UP.clone(), speed: 18,
      }, this);
      this.limbsRemoved++;
      cut++;
    }
    if (!cut) return;

    if (!e.dead) e.stun(1.6);
    this.score += 40 * cut;
    this.addFlow(0.08 * cut);
    audio.force(this.chest, 'pull');
    audio.noise({ dur: 0.5, gain: 0.26, type: 'bandpass', freq: 3200, freqEnd: 700, q: 1.6, pos: centre });
    audio.tone({ freq: 150, freqEnd: 48, dur: 0.55, gain: 0.22, type: 'sawtooth', pos: centre });
    this.camera.addShake(0.34);
    this.world?.addHitstop?.(0.07);
    this.cloak?.impulse(_g1.set(0, 1, 0), 2.0); this.skirt?.impulse(_g1.set(0, 1, 0), 2.0);
    ctx.particles?.sparkBurst(centre, null, 30 + 8 * cut, { speed: 11 });
  }

  _updateForce(dt, ctx) {
    this._advanceGesture(dt);
    if (this.gripBody || this.gripEnemy) this._updateGrip(dt, ctx);
    if (this.stasis.active || this.stasis.firing.length) this._updateStasis(dt, ctx);
    if (this.hurled.length) this._updateHurled(dt, ctx);
  }

  /* ── damage & death ──────────────────────────────────────────────── */

  damage(amount, point, source, kind) {
    if (!this.alive || this.invuln > 0) return false;
    const scale = this.difficulty ? this.difficulty.damageTaken : 1;
    const dmg = amount * scale;
    // A NaN here is unrecoverable and SILENT: hp becomes NaN, every later
    // `hp <= 0` is false, and the player is immortal with a blank health bar
    // for the rest of the run. It has happened — a caller passed Enemy's
    // damage() method where it meant attackDamage. Refuse the hit instead of
    // poisoning hp, and say so once, loudly, rather than throwing inside the
    // frame (a throw here abandons the rest of the update and freezes the game
    // while rAF keeps drawing — that has also happened).
    if (!Number.isFinite(dmg)) {
      if (!Player._warnedBadDamage) {
        Player._warnedBadDamage = true;
        console.error('Player.damage got a non-finite amount', amount, 'from', kind, source);
      }
      return false;
    }
    this.hp -= dmg;
    // the dojo promises nothing there can kill you, and means it
    if (this.world.training) this.hp = Math.max(this.hp, 1);
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
    // A corpse is not holding a stasis field. Dropped rather than fired: the
    // bolts were never aimed, and a dying player should not get a free volley.
    this.releaseStasis(this.world, false);
    // A volley already in the air mid-ripple has nobody left to flush it —
    // _updateForce stops running the moment `alive` goes false — so its bolts
    // would hang on their anchors forever.
    for (const h of this.stasis.firing) {
      if (h.bolt) { h.bolt.held = null; h.bolt.active = false; }
      else if (h.body) h.body.gravityScale = h.grav;
    }
    this.stasis.firing.length = 0;
    this.stasis.bodies.clear();
    this.hurled.length = 0;
    this.gesture.kind = ''; this.gesture.env = 0; this.gesture.sustain = false; this.gesture.hasAt = false;
    if (this.senseActive) this.toggleSense(this.world);
    this.saber.retract();
    this.hum.retract();
    this.cloak?.dispose(); this.cloak = null;
    this.skirt?.dispose(); this.skirt = null;
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
    const built = buildJedi({
      robeIndex: this.world.settings.robeIndex ?? 0,
      skinColor: SKIN_TONES[this.world.settings.skinIndex ?? 2]?.hex,
      hairColor: HAIR_COLORS[this.world.settings.hairIndex ?? 1]?.hex,
      build: this.world.settings.build,
    });
    this.rig = built.rig;
    this.palette = built.palette;
    this.built = built;          // _makeCloak needs robeSkirt on a respawn too
    this.world.scene.add(this.rig.root);
    this.animator = new BipedAnimator(this.rig, { scale: 1, hipHeight: 0.95 });
    this.animator.onFootstep = (p, s) => this._footstep(p, s);
    this._makeCloak();
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
    // Anything the Force is holding has its gravity switched off and its bolt
    // pinned to an anchor. Leaving on a level change would strand both.
    this.releaseGrip();
    this.releaseStasis(this.world, false);
    for (const h of this.stasis.firing) if (h.body) h.body.gravityScale = h.grav;
    this.stasis.firing.length = 0;
    this.stasis.bodies.clear();
    this.hurled.length = 0;
    this.hum.dispose();
    this.cloak?.dispose();
    this.saber.dispose();
    if (this.actor) this.actor.dispose();
    else { this.world.scene.remove(this.rig.root); this.rig.dispose(); }
    this.world.physics.remove(this.body);
  }
}

const _axis = { x: 0, y: 0 };
const _axis0 = { x: 0, y: 0 };
