/**
 * ══════════════════════════════════════════════════════════════════════════
 *  A MAN WHO CAN BE KNOCKED OVER — one body, and the clock that gets him up
 * ══════════════════════════════════════════════════════════════════════════
 *
 * "Force powers work in here: shove the line over, they get up and re-form,
 *  annoyed."  — HANGAR-SPEC, PLAY
 *
 * ── THE PROBLEM, IN ONE PARAGRAPH ─────────────────────────────────────────
 *
 * Everything else in that sentence is already free. `Player._grippableBody`
 * takes ANY dynamic body on the PROP, DEBRIS or RAGDOLL layer, `forcePush` and
 * `_shockwave` both run a second loop over `ctx.physics.bodies` that knows
 * nothing about enemies, and `hurlGripped` throws whatever the grip is holding
 * — so the deck's loose crates are pickable, shovable and throwable with no new
 * code at all. The company is not, and the reason is not the Force: a parade
 * figure is a rig in a holder (src/game/Parade.js `buildFigure`), and the whole
 * point of that decision is that it has no archetype, no AI, no capsule, no
 * ragdoll and nothing running per frame. A man the Force cannot feel is a man
 * standing in the middle of a physics world made of paper.
 *
 * ── WHAT IT COSTS, MEASURED AGAINST THE TWO ALTERNATIVES ──────────────────
 *
 * There are exactly three ways to make a rig-only figure shovable and this is
 * the cheapest of them by an order of magnitude:
 *
 *   1. NOTHING AT ALL — a scripted topple keyed off the player's push.
 *      Free, and a lie: the man does not fall when a hurled crate hits him,
 *      cannot be gripped, cannot be thrown at the field, and the one sentence
 *      the spec actually wrote is "physics on everything, in the hangar and on
 *      every troop, mine or anyone's."
 *
 *   2. THIS. One dynamic collider a man, plus the state machine below.
 *      24 men = 24 bodies against `World`'s `maxBodies: 1100`, and they SLEEP
 *      at attention, so a formation standing still is 24 retired islands and
 *      costs the solver nothing. No joints. No change to Player.js — the
 *      existing PROP-layer path in `_grippableBody` sees them the day they
 *      exist. What it does NOT buy is the fall itself: this topples a man
 *      rigidly, as one piece, because one collider is one piece.
 *
 *   3. `Ragdoll.Actor.goRagdoll` — the real thing, and `Actor` already takes a
 *      BARE RIG (`new Actor(scene, physics, rig, {mass})`), so no new class is
 *      needed for it. 19 bodies and 18 `RagdollJoint`s a man: one shoved man is
 *      37 objects, and a whole line going over at once is 456 bodies and 432
 *      joints — 41% of the world's body budget for one press of `unleash`. It
 *      is also INCOMPATIBLE WITH THE MERGED SKIN the deck needs to afford two
 *      dozen figures at all: `goRagdoll` re-homes each bone's own child meshes
 *      into per-bone holders and hides `rig.root`, and after `mergeFigure` the
 *      thing being drawn is a `SkinnedMesh` that is neither — so a ragdolled
 *      merged figure is a man who vanishes. Dropping the merge for the men who
 *      are down costs a re-bake per man on recovery (`BAKES_PER_FRAME` is 1)
 *      and about 50 draw calls each while they lie there.
 *
 * So: this file is (2), it is ~24 bodies, and the honest gap it leaves is
 * named in `SHOVE.fall` below. A figure DOES have to become a real body to be
 * shoved. It does not have to become nineteen.
 *
 * ── WHAT THIS FILE DOES NOT DO ────────────────────────────────────────────
 *
 * It does not pose anybody. `Parade.js` owns every joint angle in this game's
 * standing figures and this module owns one rigid transform and a clock, which
 * is the same split `Rig.BipedAnimator` and `Parade.poseParade` already keep.
 * The caller reads `state`/`t`/`up` and decides what the man looks like.
 */

import * as THREE from '../../vendor/three/three.module.js';
import { Body, LAYER, box, boxSpheres } from './RapierWorld.js';

const _v = new THREE.Vector3();
const _w = new THREE.Vector3();
const _up = new THREE.Vector3();
const _q = new THREE.Quaternion();
const UP = new THREE.Vector3(0, 1, 0);

/**
 * The numbers, with the reason each one is that number and not another.
 *
 * `halfW`/`halfH`/`halfD` are a man in plan and not a capsule, and the choice
 * is measured rather than aesthetic: `RapierWorld.Body`'s own note reports that
 * a capsule resting on flat ground spins up to ~1.08 rad/s about its axis from
 * a standing start under every combination of friction, damping and solver it
 * was tried with, so an island holding one NEVER SLEEPS — "which is a whole
 * corpse, forever" — while "a cuboid or a round cuboid in the same test is
 * asleep by step 130." Twenty-four men standing at attention have to be twenty
 * -four retired islands or the formation costs more than the room.
 */
export const SHOVE = {
  /** 0.60 m across the shoulders, 1.72 m tall, 0.44 m through the chest. */
  halfW: 0.30, halfH: 0.86, halfD: 0.22,
  /**
   * A trooper in armour. `Ragdoll.Actor` defaults a humanoid to 74 and this is
   * that number rather than a second opinion about what a man weighs.
   *
   * It also lands somewhere worth knowing: `grip.mjs` measures the default lift
   * capacity at 77.8 kg, so one of your own men comes off the deck and a second
   * one added to the hold does not. That is the right shape for this room — a
   * player CAN pick a trooper up, and finds out he is heavy doing it.
   */
  mass: 74,
  /**
   * WHAT COUNTS AS BEING KNOCKED OVER, and it is deliberately two tests.
   *
   * `wake` is the speed: a man who has been pushed, pulled, hurled or lifted is
   * travelling, and 1.4 m/s is comfortably above the millimetre-per-second
   * jitter a body has while the solver settles it and comfortably below a
   * push's 8-plus. `tip` is the attitude: something can put a man on the deck
   * without ever moving him fast — a crate landing on him, a second man
   * falling into him — and a figure standing at attention at 40° off vertical
   * is the funniest bug this room could ship.
   */
  wake: 1.4,
  /**
   * WHAT IT TAKES TO PUT A PLANTED MAN DOWN. `wake` is the speed at which a
   * body that is already down is read as moving again; this is the speed a
   * body standing at its post has to be given before it stops being a man
   * who was brushed and starts being a man who was shoved. 3.2 m/s: above the
   * 1-2 m/s the player's capsule hands a body it walks into, below the 8+ of
   * the weakest Force push. Measured on the deck: a walk straight through a
   * formed line at 4.6 m/s puts 0.6-1.9 m/s on the men it touches.
   */
  shove: 3.2,
  tip: Math.cos(0.55),                       // 31.5° off vertical
  /** Back on his feet only once he has actually stopped. */
  still: 0.45,
  /**
   * THE CLOCK OF GETTING UP. `Enemy._tickGetUp` waits for the chest to be
   * under 2 m/s and then spends `GET_UP = 1.35 s`; those two numbers are the
   * game's existing answer to this exact question and this is them, plus a
   * beat of lying there first. The beat is the "annoyed" in the ask — a man
   * who bounces straight back up has not been knocked over, he has been
   * animated.
   */
  down: 1.1, rise: 1.35,
  /** Walking back to his mark. A parade pace, not a run: he is not in a hurry. */
  pace: 1.6,
  /** Close enough to his mark to call it formed up again. */
  mark: 0.12,
  /**
   * THE HONEST GAP. One collider is one rigid piece, so a shoved man goes over
   * as a plank: the pose he was standing in is the pose he lands in. That is
   * this file's whole limitation and it is not hidden behind a number —
   * closing it is either two authored poses in `Parade.js` (a fall and a
   * push-up, in the `attention`/`atEase` idiom, no extra bodies at all) or
   * `Actor.goRagdoll` at 19 bodies and 18 joints a man. See the header.
   */
  fall: 'rigid',
};

/** The five things a man can be doing. `post` is the only resting state. */
export const STATE = { POST: 'post', DOWN: 'down', REST: 'rest', RISE: 'rise', BACK: 'back' };

/**
 * ══ ONE MAN, ONE BODY, ONE CLOCK ══════════════════════════════════════════
 *
 * Built at his mark, asleep, dynamic. Asleep because a formation that is not
 * being touched should cost the solver nothing; DYNAMIC because that is the
 * whole point — `_grippableBody` refuses a kinematic body outright
 * (`invMass > 0`), which is exactly why an `Enemy`'s kinematic movement proxy
 * needs the special ENEMY-layer case in that method and a crate does not.
 * A man on the PROP layer needs no case at all.
 *
 * `userData.figure` and NOT `userData.prop`: the Force reads `prop.grippable`
 * as an author's veto and `World`/`Impact` read `prop` expecting a real `Prop`
 * with a mesh, an hp and a place in `world.props`. Answering that key with
 * something that is not one is the "a missing thing answered with a plausible
 * default" defect this repository keeps deleting.
 */
export class Shovable {
  /**
   * @param world   the live World (needs `.physics`)
   * @param mark    THREE.Vector3, the deck point his heels stand on
   * @param opts.facing   yaw he stands at, radians
   * @param opts.mass     override for a heavier or lighter frame
   */
  constructor(world, mark, opts = {}) {
    this.world = world;
    this.mark = mark.clone();
    this.facing = opts.facing ?? 0;
    this.state = STATE.POST;
    /** Seconds in the current state. */
    this.t = 0;
    /** 0 while he is on the deck, 1 once he is on his feet. The pose handle. */
    this.up = 1;
    /** Where the caller should stand the figure this frame, and facing where. */
    this.at = mark.clone();
    /** The rigid attitude, for as long as `state` is DOWN or REST. See SHOVE.fall. */
    this.quaternion = new THREE.Quaternion();
    /** How many times he has been put on the deck. The "annoyed" counter. */
    this.falls = 0;

    const half = new THREE.Vector3(SHOVE.halfW, SHOVE.halfH, SHOVE.halfD);
    this.body = new Body({
      position: _v.copy(mark).setY(mark.y + SHOVE.halfH),
      quaternion: _q.setFromAxisAngle(UP, this.facing),
      shape: box(half.x, half.y, half.z),
      spheres: boxSpheres(half.x, half.y, half.z),
      mass: opts.mass ?? SHOVE.mass,
      /* A man is not a crate: he does not bounce and he does not slide. */
      friction: 0.9, restitution: 0.0,
      linearDamping: 0.08, angularDamping: 0.35,
      layer: LAYER.PROP,
      mask: LAYER.WORLD | LAYER.PROP | LAYER.DEBRIS | LAYER.RAGDOLL | LAYER.ENEMY | LAYER.PLAYER,
    });
    this.body.userData.figure = this;
    world.physics.add(this.body);
    /* HE IS STANDING STILL, so the island retires immediately rather than after
     * the solver has spent a second convincing itself. `sleep()` also zeroes
     * both velocities, which is what stops a body placed on the deck this frame
     * from drifting a centimetre before it settles. */
    this.body.sleep();
  }

  /** Is he on the deck rather than on his feet? The caller's pose question. */
  get down() { return this.state === STATE.DOWN || this.state === STATE.REST; }

  /**
   * HIS MARK MOVED, WHICH HAPPENS THE MOMENT ANYBODY IS DISMISSED.
   *
   * `mark` is where BACK walks him and where a man culled below `killY` is put
   * back — both of which are wrong the instant the company is given a new
   * shape. Without this a dismissed man's figure walks off to his new spot and
   * his body stays standing on the old one, so the Force still finds him where
   * he used to be. That is the exact class of bug this whole file exists to
   * stop: a drawn man and a physical man in two different places.
   */
  retarget(mark) {
    const y = this._deckY(mark.x, mark.z, mark.y);
    this.mark.set(mark.x, y, mark.z);
    /* IF HE IS STANDING ON IT, HE MOVES WITH IT. If he is down, mid-rise or
     * walking, leave the body alone — BACK will find the new mark on its own
     * and a body teleported out from under a tumble is a man who blinks. */
    if (this.state === STATE.POST) {
      this.body.setTransform(_v.copy(this.mark).setY(this.mark.y + SHOVE.halfH),
        _q.setFromAxisAngle(UP, this.facing));
      this.body.sleep();
      this._publish();
    }
    return this;
  }

  /**
   * PUT HIM DOWN, without waiting for the Force to do it. The deck's own
   * scripting uses this — a ship coming through the field, a crate landing in
   * the line — and so does the check, because a test that can only knock a man
   * over by casting a real power is a test of two things at once.
   */
  shove(dir, speed = 4) {
    this.body.wake();
    this.body.applyImpulse(
      _v.copy(dir).setY(0).normalize().multiplyScalar(this.body.mass * speed).setY(this.body.mass * 1.2),
      null);
    this._topple(dir);
    return this;
  }

  /**
   * THE TIP, AND WHY IT IS APPLIED BY HAND.
   *
   * A push is `mass * 15 * k * P * heft` applied AT THE BODY'S CENTRE
   * (`Player.forcePush`), and an impulse through the centre of mass of a box
   * standing on a high-friction deck produces a slide with whatever torque the
   * base contact happens to resolve — which for a 74 kg slab on plate is a man
   * skating backwards upright. That is not what "shove the line over" means. So
   * the module reads the shove and adds the topple: a torque impulse about the
   * horizontal axis perpendicular to it, which is the axis a man actually falls
   * about.
   *
   * PROPORTIONAL TO MASS, so a heavier frame is not tipped harder than a
   * lighter one: the box's own moment about that axis is m(h² + d²)/12, so
   * dividing a mass-proportional impulse by it leaves the same spin whatever
   * the man weighs. At the default frame that is 85 N·m·s against 19.4 kg·m²,
   * or 4.4 rad/s — a quarter turn in a third of a second, which is a man going
   * over rather than a man being launched.
   */
  _topple(dir) {
    _w.copy(dir).setY(0);
    if (_w.lengthSq() < 1e-6) return;
    _w.normalize().cross(UP).multiplyScalar(-this.body.mass * 1.15);
    this.body.applyTorqueImpulse(_w);
  }

  /**
   * ══ ONE FRAME ═════════════════════════════════════════════════════════
   *
   * Called by whatever owns the company. Returns `this`, so a caller can read
   * `state`, `up`, `at` and `quaternion` off the return.
   *
   * THE STATES, and each transition is one sentence:
   *
   *   POST  standing on his mark, asleep. He leaves the moment the solver has
   *         him moving or leaning — which covers being pushed, pulled, gripped,
   *         hurled, unleashed at, walked into or landed on, with no knowledge
   *         here of which of those it was.
   *   DOWN  pure physics. Nothing in this file touches the body: he tumbles,
   *         slides, hangs in a Force grip or flies at the shield exactly as a
   *         crate would, because for these seconds he IS one.
   *   REST  he has stopped. Lying there for `SHOVE.down` seconds, which is the
   *         beat the ask calls "annoyed".
   *   RISE  `SHOVE.rise` seconds of getting his feet under him. The body is
   *         pinned upright where he lies — dynamics are OFF here, because a man
   *         standing up is doing something to the world rather than the other
   *         way round.
   *   BACK  walking to his mark at `SHOVE.pace`, then asleep on it again.
   *
   * A SHOVE DURING ANY OF THE LAST THREE PUTS HIM STRAIGHT BACK TO DOWN, which
   * is both correct and the only way the room stays funny.
   */
  update(dt) {
    const b = this.body;
    this.t += dt;

    /**
     * AND IF HE IS NOT IN THE WORLD ANY MORE, HE WALKS BACK IN.
     *
     * `RapierWorld.step` culls anything below `killY` and sets `dead` on it,
     * which is the right answer for a crate and leaves a HOLE IN THE ROLL for a
     * man: the field's barrier closes the four sides of the deck but not the
     * sky over it, so a man thrown hard enough straight up leaves and never
     * comes back. `add` clears `dead` — see its note — so putting him back is
     * two lines, and putting him back at his MARK is the only place a man who
     * has fallen off a ship could plausibly reappear.
     */
    if (b.dead) {
      b.setTransform(_v.copy(this.mark).setY(this.mark.y + SHOVE.halfH),
        _q.setFromAxisAngle(UP, this.facing));
      b.velocity.set(0, 0, 0); b.angularVelocity.set(0, 0, 0);
      this.world.physics.add(b);
      b.sleep();
      return this._enter(STATE.POST)._publish();
    }

    /* WHAT THE SOLVER SAYS ABOUT HIM, asked once and shared by every branch.
     * `_up` is his own Y axis in world space: the dot against world up is the
     * cosine of his lean, so 1 is standing and 0 is flat out. */
    _up.copy(UP).applyQuaternion(b.quaternion);
    const lean = _up.dot(UP);
    const speed = b.velocity.length();

    if (this.state === STATE.POST) {
      /**
       * ══ A SHOULDER IS NOT A SHOVE ═══════════════════════════════════════
       *
       * "The troops you inspect in the hangar act more like bowling pins than
       *  actual models you would see in game like you touch them and they
       *  fall over."
       *
       * They did, and the reason is the player's own capsule: `Player._collide`
       * wakes and impulses any PROP body it overlaps, and inspecting a man
       * means walking up to within a couple of metres of him while he steps
       * half a metre toward you. One brush put 1.4 m/s or 31° of lean on a
       * tall thin box and the old rule below read that as being knocked over.
       *
       * So a man standing at his post is a man PLANTED: anything under
       * `SHOVE.shove` of speed is a nudge, and a nudge is undone — he is put
       * back on his mark, upright, and sent back to sleep, which is what a
       * soldier who has been bumped does. A Force push arrives at eight
       * metres a second and more; a hurled crate at twenty; those go over.
       * The lean test is kept for the case the speed test cannot see — a
       * crate landing on his head — but only past the bump band.
       */
      if (speed > SHOVE.shove || (lean < SHOVE.tip && speed > SHOVE.wake)) this._enter(STATE.DOWN);
      else {
        if (speed > 0.02 || lean < 0.9995) {
          b.setTransform(_v.copy(this.mark).setY(this.mark.y + SHOVE.halfH),
            _q.setFromAxisAngle(UP, this.facing));
          b.velocity.set(0, 0, 0); b.angularVelocity.set(0, 0, 0);
          b.sleep();
        }
        return this._publish();
      }
    }

    if (this.state === STATE.DOWN) {
      /* SETTLED, not "slow this frame". A body at the top of a throw is
       * momentarily still and is not resting, so this counts CONSECUTIVE quiet
       * seconds — the same shape `RapierWorld._still` uses to retire an island,
       * kept here rather than read off it because the solver's own answer is a
       * boolean about a different question and it is not published. */
      if (speed < SHOVE.still && Math.abs(b.angularVelocity.length()) < 1.2) {
        this._settled = (this._settled || 0) + dt;
        if (this._settled > 0.35) this._enter(STATE.REST);
      } else this._settled = 0;
      return this._publish();
    }

    if (this.state === STATE.REST) {
      if (speed > SHOVE.wake) return this._enter(STATE.DOWN)._publish();
      if (this.t >= SHOVE.down) this._enter(STATE.RISE);
      else return this._publish();
    }

    if (this.state === STATE.RISE) {
      if (speed > SHOVE.wake) return this._enter(STATE.DOWN)._publish();
      /* ON HIS FEET WHERE HE LIES. The body is driven rather than simulated for
       * these 1.35 s: `setTransform` with the upright quaternion and his heels
       * at whatever height the deck is under him. Standing up is not something
       * the solver can be asked to do, and `Enemy._tickGetUp` does not ask it
       * either — it restores the bind pose and eats a stun. */
      this.up = Math.min(1, this.t / SHOVE.rise);
      const y = this._deckY(b.position.x, b.position.z);
      b.setTransform(_v.set(b.position.x, y + SHOVE.halfH, b.position.z),
        _q.setFromAxisAngle(UP, this.facing));
      b.velocity.set(0, 0, 0); b.angularVelocity.set(0, 0, 0);
      if (this.t >= SHOVE.rise) this._enter(STATE.BACK);
      return this._publish();
    }

    if (this.state === STATE.BACK) {
      if (speed > SHOVE.wake) return this._enter(STATE.DOWN)._publish();
      _v.copy(this.mark).sub(b.position).setY(0);
      const gap = _v.length();
      if (gap <= SHOVE.mark) {
        b.setTransform(_v.copy(this.mark).setY(this.mark.y + SHOVE.halfH),
          _q.setFromAxisAngle(UP, this.facing));
        b.sleep();
        this._enter(STATE.POST);
        return this._publish();
      }
      /* HE WALKS. Driven, for the same reason the get-up is: a rigid body
       * pushed toward a point with an impulse arrives skating and overshoots,
       * and the thing that is actually walking is the gait solver on the rig
       * the caller is posing — this only says where the feet have got to. */
      const step = Math.min(gap, SHOVE.pace * dt);
      _v.multiplyScalar(step / gap);
      b.setTransform(_v.add(b.position).setY(this._deckY(b.position.x, b.position.z) + SHOVE.halfH),
        _q.setFromAxisAngle(UP, this.facing));
      b.velocity.set(0, 0, 0); b.angularVelocity.set(0, 0, 0);
      return this._publish();
    }
    return this._publish();
  }

  _enter(state) {
    this.state = state;
    this.t = 0;
    this._settled = 0;
    if (state === STATE.DOWN) { this.falls++; this.up = 0; this.body.wake(); }
    if (state === STATE.POST) this.up = 1;
    return this;
  }

  /** The deck under a point. Null-terrain-safe, like `Support.supportHeight`. */
  /**
   * THE FLOOR UNDER HIM. `world.floorAt` when the level installs one — the
   * flight deck does, because its pads stand 0.45 m and 1.2 m proud of a
   * flat heightfield and a transport's ramp is a floor too — else the
   * terrain, else his own mark. Reading only the heightfield put every man
   * on a pad 0.45 m into it, and stood him up INSIDE its collider.
   */
  _deckY(x, z, fallback = this.mark.y) {
    const one = this.world.floorAt ? this.world.floorAt
      : this.world.terrain ? (px, pz) => this.world.terrain.height(px, pz) : null;
    if (!one) return fallback;
    /* THE BOX, NOT THE POINT. A man's body is 0.6 m wide, and a floor read
     * at his centre put half the box inside a pad's kerb as he walked over
     * its edge — the solver threw the overlap out at eight metres a second
     * and the walk-off from the transport was ten men falling over on the
     * apron. The highest floor under any corner is the floor the box stands
     * on; he steps up a third of a metre early, which is what a foot does. */
    let y = one(x, z);
    y = Math.max(y, one(x + SHOVE.halfW, z + SHOVE.halfD), one(x - SHOVE.halfW, z + SHOVE.halfD),
      one(x + SHOVE.halfW, z - SHOVE.halfD), one(x - SHOVE.halfW, z - SHOVE.halfD));
    return y;
  }

  /** Where the caller should put the rig this frame. */
  _publish() {
    this.at.copy(this.body.position);
    this.at.y -= SHOVE.halfH;
    this.quaternion.copy(this.body.quaternion);
    return this;
  }

  /**
   * Take the body out of the world. `World.unload` calls `physics.clear()` and
   * would do it anyway; this is for a company dismissed while the deck is still
   * standing, which is the case that would otherwise leak a body a frame.
   */
  dispose() {
    this.world.physics?.remove?.(this.body);
    this.body.userData.figure = null;
  }
}

/**
 * Stand a whole company up. `rows` is anything with a `mark` — the shape
 * `Hangar.callTheCompany` already builds — and the shovable is hung on each
 * row under `shove`, so the deck's own per-frame loop is one line longer:
 *
 *     for (const r of company.men) r.shove.update(dt);
 *
 * Returns the list, so a caller can `dispose()` them all on the way out.
 */
export function makeShovable(world, rows, opts = {}) {
  const out = [];
  for (const r of rows) {
    if (!r || !r.mark || r.shove) continue;
    const mark = r.mark.isVector3 ? r.mark
      : new THREE.Vector3(r.mark.x, r.mark.y ?? 0, r.mark.z);
    r.shove = new Shovable(world, mark, { facing: r.man?.facing ?? opts.facing ?? 0 });
    r.shove.retarget(mark);
    out.push(r.shove);
  }
  return out;
}
