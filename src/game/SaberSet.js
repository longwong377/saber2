/**
 * BATTLEFRONT BORZ — THE THREE SABER SETS.
 *
 * *"I also want you to add A double-bladed lightsaber/saberstaff … and also
 * dual weilding (one lightsaber in each hand), these two differing player
 * fighting methods will require unique playstyles and have moves that are
 * unique to them, don't change anything with the default single blade usage."*
 *
 * The last clause is the hard one and it is what shapes this file. Both new
 * weapons are built as EXTRA `Saber` INSTANCES driven through the same public
 * two-call contract — `setHiltPose(pos, quat)` then `update(dt, time,
 * carrierVel)` — that `Enemy.installOffhand`, `Net`'s RemoteAvatar, the menu
 * preview and the thrown blade already drive. So `Saber.js` and `Combat.js`
 * have zero changed lines, which is checkable in one line of `git diff --stat`
 * rather than argued for: the two endpoint lines at Saber.js:1949-1950 that
 * feed the sweep, `speedAt`, `cutPowerAt`, `PROFILE` and `HILT_SPECS` are
 * untouched for every blade in the build, the ~30 enemy sabers included.
 *
 * ── WHY A SEGMENT PER BLADE, AND NEVER ONE LONG SHAFT ──────────────────
 *
 * This is the single most important structural decision here and it is not an
 * implementation detail. `Saber.speedAt(t) = lerp(|baseVelocity|,
 * |tipVelocity|, t)` and `captureSnapshot`'s identical `bladeSpeed` both assume
 * speed rises monotonically from a slow base to a fast tip. That is true of a
 * weapon pivoting near or below its grip and FALSE of a staff spun about its
 * middle, where both ends move at V and the centre at ~0 — the lerp would
 * report V along the whole shaft, the grip would sever flesh as hard as the
 * tip, and every contact would clear `SPEED_GRADE.perfect` (9.4 m/s) for free.
 *
 * Built as two segments each pivoting about its own base at the hands, the lerp
 * is correct on both halves with no change to `speedAt` for anybody, and
 * everything bladeT-indexed goes on meaning the same thing measured from the
 * hand outward on all four segments in the game: `returnBladeT` 0.42,
 * `perfectBladeT` 0.55, `bolts.hold`'s pin fraction and `intersectBladeSweep`'s
 * return value. `tools/checks/saberforms.mjs` holds that as an assertion — it
 * drives a real swing in every set and requires speedAt(0.25) ≤ speedAt(0.5) ≤
 * speedAt(0.9) on every blade — because it is exactly the property a future
 * "simplification" to one long segment would quietly destroy.
 *
 * ── WHAT THIS MODULE MAY AND MAY NOT IMPORT ────────────────────────────
 *
 * It imports `Saber` and THREE and nothing else, and in particular NOT
 * `SaberController`: the controller imports the envelope tables below, so an
 * import the other way is a cycle. That is why `ENVELOPES.single` is `null`
 * rather than a copy of SLASH — the controller resolves null to its own shipped
 * objects BY REFERENCE, so there is not a second copy of a single-blade number
 * anywhere in this diff and there is therefore nothing to drift. HANDOFF §2.4.
 */

import * as THREE from '../../vendor/three/three.module.js';
import { clamp } from '../engine/MathUtil.js';
import { Saber } from './Saber.js';

const _s1 = new THREE.Vector3(), _s2 = new THREE.Vector3(), _s3 = new THREE.Vector3();
const _s4 = new THREE.Vector3(), _s5 = new THREE.Vector3(), _s6 = new THREE.Vector3();
const _sq = new THREE.Quaternion(), _sq2 = new THREE.Quaternion();
const _sm = new THREE.Matrix4();
const UP = new THREE.Vector3(0, 1, 0);

/* ══════════════════════════════════════════════════════════════════════ */
/*  THE THREE SETS                                                       */
/* ══════════════════════════════════════════════════════════════════════ */

/**
 * IT IS CALLED `saberSet`, NOT `saberForm`, AND THAT IS LOAD-BEARING RATHER
 * THAN A PREFERENCE. `FORMS` and `FORM_KEYS` are exported from Duel.js for the
 * five duelling styles, `Duel` picks one per duellist as `this.formKey`, and
 * `tools/checks/forms.mjs` already exists and is entirely about them. `stance`
 * is taken by the controller's lateral guard binding; `grip`, `style` and
 * `weaponStyle` are all taken in Saber.js and SaberController.js. Calling this
 * a "form" would collide in grep, in check names, and in every conversation
 * anyone ever has about it.
 *
 * Each row is the WHOLE of what a set is, so nothing anywhere else has to carry
 * a second half of the answer:
 *
 *   `grip`      which `GRIPS` row the controller drives the weapon on. `single`
 *               names `two`, which is the row it has always been on, so a
 *               single-blade player's `control.grip` never takes a new value.
 *   `offScale`  the second blade's length as a share of the player's own
 *               `bladeLength`. 1 for the staff — the reach is the player's own
 *               setting read twice — and 0.80 for the pair, which is 0.92 m on
 *               a stock blade, so it reads as a shoto and the pair's claim is
 *               BEARINGS rather than metres.
 *   `hands`     what `Player.handsOnHilt` answers. A saberstaff genuinely IS
 *               two hands on one hilt; the pair is one hand on the main hilt
 *               and the other on its own, which is 1 and not 2 — see
 *               `offHandOn()` beside it for the question this cannot express.
 *   `offDamage` the second blade's share of the cut. The staff's far end is the
 *               same weapon; the pair's shoto takes Enemy `_offhandStrike`'s
 *               shipped 0.55, ported rather than invented.
 *   `throwKey`  what `throw` means in this set. One key, one meaning at a time
 *               — the pattern `swap`, `drive`, `hurl` and `throw` already use
 *               four times over.
 */
export const SABER_SETS = [
  { id: 'single', name: 'One blade', blurb: 'The blade you know. The heavy, the bind, the whole ladder.',
    grip: 'two', offScale: 0, hands: 2, offDamage: 0, throwKey: 'throw' },
  { id: 'staff', name: 'Saberstaff', blurb: 'Two blades on one shaft. Answers a wider arc, and pays for it.',
    grip: 'staff', offScale: 1, hands: 2, offDamage: 1, throwKey: 'orbit' },
  { id: 'pair', name: 'Paired blades', blurb: 'Two blades, two bearings. Covers you while you are busy.',
    grip: 'pair', offScale: 0.80, hands: 1, offDamage: 0.55, throwKey: 'throwOff' },
];

/** The row, or the single blade's — never undefined, because sixty call sites
 *  read `player.saber` without a guard and this must be no worse. */
export function setById(id) {
  return SABER_SETS.find((s) => s.id === id) || SABER_SETS[0];
}

/** Every set's id, for the menu, the orders and the checks. */
export const SET_IDS = SABER_SETS.map((s) => s.id);

/* ══════════════════════════════════════════════════════════════════════ */
/*  THE ENVELOPES                                                        */
/* ══════════════════════════════════════════════════════════════════════ */

/**
 * THE TWO NEW ARCS, READ STRAIGHT OFF SLASH'S OWN SHIPPED WIDTH TABLE.
 *
 * SLASH's note measures three widths on `tools/checks/animation.mjs`'s ring of
 * eighteen bodies and records what each one's tip peaked at:
 *
 *     rise / drop      tip peak
 *     0.65 / 0.67      13.2 m/s
 *     0.80 / 0.82      16.9 m/s   ← SLASH, and it is NOT TOUCHED
 *     0.98 / 1.00      18.5 m/s
 *
 * A narrower arc is a slower tip is a softer contact, and that is the whole
 * currency the two new sets are paid for in. It is never a shorter
 * `PARRY.cooldown`, never a `SPEED_GRADE` move and never a damage multiplier:
 * every one of those would look like an improvement and land as a regression,
 * because they are shared by every blade in the game.
 *
 * THE STAFF trades width for repetition. 0.60/0.62 at a 0.22 s cooldown is
 * 4.55 presses a second against the single blade's 3.33 — 36% faster to repeat
 * and about 25% softer per contact — and the reason it can repeat that fast is
 * geometric rather than granted: the far end is rigidly opposite the near one,
 * so it is already chambered when the near one has finished. That is the
 * player's "the second blade is instantly ready for a follow-up strike",
 * delivered by the shaft rather than by a number.
 *
 * THE PAIR sits between them at 0.74/0.76 and 0.26, because it genuinely is
 * between them: two lighter weapons, each on its own bearing.
 *
 * `chain` is the window the third press has to arrive in. The staff's is longer
 * (0.72) because its own cooldown is shorter and a sequence you cannot reach is
 * not a sequence.
 */
export const STAFF_SLASH = {
  wind: 0.075, cut: 0.115, dur: 0.315,
  rise: 0.60, drop: 0.62, lift: 0.30, fall: 0.62,
  cooldown: 0.22, chain: 0.72, lunge: 0.30,
};

/**
 * THE WHIRL — the staff's third press, and it is flatter and lower than HEAVY.
 *
 * HEAVY lifts to 0.30 and falls to 0.75 because one blade has to cover the
 * high line on its way to the low one. A staff does not: the far end is on the
 * high line for the whole arc, for free. So the whirl keeps HEAVY's whole
 * CHARGE block — `hold`, `full`, `cutScale`, `rec`, `drain` and `reach` are all
 * read from HEAVY unchanged, because the chamber is the same chamber — and
 * differs only in where the arc goes.
 */
export const STAFF_HEAVY = {
  wind: 0.10, cut: 0.125, dur: 0.50,
  rise: 0.86, drop: 0.90, lift: 0.10, fall: 0.62,
};

/** The pair's alternating cut. Between the single blade and the staff on every
 *  term, which is what the form is. */
export const DUAL_SLASH = {
  wind: 0.075, cut: 0.115, dur: 0.315,
  rise: 0.74, drop: 0.76, lift: 0.30, fall: 0.72,
  cooldown: 0.26, chain: 0.62, lunge: 0.30,
};

/**
 * THE CROSS — and it is NOT A HEAVY, by construction rather than by a flag.
 *
 * The pair holds no hilt with two hands, so it cannot chamber: there is no
 * `heavy` row in its envelope set at all, and the controller's third press
 * therefore falls through to another light cut with both blades converging.
 * Two contacts at roughly 15.6 m/s each instead of one at HEAVY's measured 22.0
 * tapped. Severance is a work budget against TOUGHNESS, so that is worse
 * against one armoured body and better against two soft ones — which is the
 * trade the whole form is made of, arrived at by removing something rather than
 * by adding a multiplier.
 */
export const DUAL_CROSS = null;

/**
 * WHAT EACH SET SWINGS, and `single` is `null` ON PURPOSE.
 *
 * The controller resolves a null row to its own shipped `SLASH` / `HEAVY`
 * OBJECT, by reference. So `tables('single').slash === SLASH` holds with `===`
 * and not with a deep-equal, there is no second copy of a single-blade number
 * in this diff, and no later pass can re-space the light cut for one set and
 * miss the other. See `SaberController.setTables`.
 */
export const ENVELOPES = {
  single: { slash: null, heavy: null, chamber: true },
  staff:  { slash: STAFF_SLASH, heavy: STAFF_HEAVY, chamber: true },
  /* `chamber: false` IS THE CROSS. It is what makes HEAVY and CHARGE
   * unreachable in this set — see DUAL_CROSS above — and it is a fact about
   * the weapon (no second hand on the hilt) rather than a difficulty flag. */
  pair:   { slash: DUAL_SLASH, heavy: DUAL_CROSS, chamber: false },
};

/* ══════════════════════════════════════════════════════════════════════ */
/*  THE SECOND BLADE                                                     */
/* ══════════════════════════════════════════════════════════════════════ */

/**
 * How far the off blade is carried below the main one, and how far its guard
 * mirrors — Enemy `_poseOffhand`'s own numbers, because a second blade carried
 * low and ready to come up under the first is the same pose whoever is holding
 * it. `lagStart` and `lagSpan` are the SAME rule that file states verbatim:
 * `lag = clamp((u - 0.35) / 0.65, 0, 1)`, zero until the main blade is a third
 * of the way through its arc and one at the end, so the two blades arrive on
 * two beats rather than reading as one weapon drawn twice.
 */
export const OFFHAND = { drop: 0.28, lagStart: 0.35, lagSpan: 0.65, settle: 12 };

/**
 * HOW FAR APART THE TWO FISTS ARE CARRIED IN THE PAIR, in metres on a
 * standard arm, before `reachScale` is applied.
 *
 * 0.42 m is a fighting stance rather than a shrug: the off hand is carried out
 * and low (see `OFFHAND.drop`), not tucked at the hip. It is deliberately
 * SMALLER than the saberstaff's shaft — measured at 0.20 m of grip either side
 * of centre plus two blades — because a quarterstaff answers a wider rose than
 * two short swords do, and what the pair buys instead is the free hand and a
 * blade it can throw without disarming itself.
 */
export const PAIR_CROSS = 0.42;

/**
 * THE ORBIT — the saberstaff spun round the chest by pure telekinesis.
 *
 * *"the double bladed user can use pure telekinesis to spin the staff at high
 * speeds around your body like a protective barrier, keeping your hands free to
 * cast whatever."*
 *
 * `radius` is a metre and a bit clear of the chest, so both blades sweep
 * outside the body's own capsules and a bolt has to cross the ring to reach
 * you. `rate` is the knob if it ever proves too strong, and it is the RIGHT
 * knob: lowering it lowers `speedAt` for every consumer at once and therefore
 * lowers the grade of every contact the ring makes — never a damage multiplier
 * and never a price. `cap` is the hard ceiling in seconds, on top of the Force
 * it drains, because this is a panic button and not a stance.
 */
export const ORBIT = { radius: 1.7, rate: 9.0, cap: 4.0, rise: 0.18 };

/**
 * THE WHOLE OF THE SECOND WEAPON — the blade, its pose, its own throw and the
 * orbit, in one object a Player owns or does not.
 *
 * ONE OBJECT AND NOT A SET OF FIELDS ON Player. `player.saber` exists in every
 * set and only `offSaber` is conditional, reached solely through here, so
 * Player.js:10118's honest note — "sixty call sites outside this file
 * dereference `player.saber` without a guard" — goes on being true.
 */
export class Sidearm {
  /**
   * @param owner   the Player. Read for its chest, its aim and its controller;
   *                never written except through the two published fields below.
   * @param setId   'staff' | 'pair'. 'single' never builds one of these.
   * @param opts    the SAME appearance the main blade was built from, so the
   *                second blade is genuinely the same weapon rather than a
   *                default one wearing its colour.
   */
  constructor(owner, setId, opts = {}) {
    this.owner = owner;
    this.set = setById(setId);
    const main = owner.saber;
    this.saber = new Saber(owner.world.scene, {
      colorIndex: opts.colorIndex ?? main.colorIndex ?? 0,
      bladeLength: (opts.bladeLength ?? main.bladeLength ?? 1.15) * this.set.offScale,
      coreWidth: opts.coreWidth ?? main.coreWidth ?? 1,
      hiltStyle: opts.hiltStyle ?? main.hiltStyle ?? 'Graflex',
      order: opts.order ?? main._order ?? null,
      engine: owner.world.engine,
      /**
       * ZERO, AND NEVER 1. `Engine.lightUp`'s pool is FIXED at eight precisely
       * so `NUM_POINT_LIGHTS` cannot move and no lit material recompiles; a
       * second LOCAL blade at priority 1 would take two of those eight off a
       * colosseum that already puts thirty enemy blades in it. The second blade
       * ranks on brightness and distance like anybody else's.
       */
      lightPriority: 0,
    });
    this.saber.setGripScale?.(main.gripScale ?? 1);

    /**
     * THE SPAN, MEASURED OFF THE BUILT MESHES RATHER THAN TYPED.
     *
     * Two hilts pommel-to-pommel: the lower one is the SAME hilt flipped π
     * about the hand's forward axis and slid down the shaft by twice that
     * hilt's own `hiltFloor()` — which `Saber` already measures from the
     * geometry, because the ten hilts do not agree about where their metal
     * stops (a Graflex bottoms out 85 mm below the origin and a Shoto 54).
     *
     * So every hilt in the rack becomes a saberstaff for free, with no new
     * `HILT_SPECS` row — the table's ±15 mm `emitter` bound and its ten-row
     * silhouette check are untouched — and the span is whatever that hilt's own
     * metal makes it. Measured on the shipped rack: Graflex 0.480 m, Warden
     * 0.551 (the longest), Shoto 0.392 (the shortest).
     */
    this.offset = this.set.id === 'staff' ? 2 * (main.hiltFloor ?? -0.085) : 0;
    this.span = this.set.id === 'staff'
      ? (main.emitterY ?? 0) - (this.offset - (this.saber.emitterY ?? 0)) : 0;

    /**
     * ── THE PAIR'S OWN SPAN, AND WHY IT IS A SEPARATE FIELD ──────────────
     *
     * "maybe with dual wielding blocking bolts is easier or area that you can
     *  cover is larger … Dual-wielding lightsabers generally provides
     *  increased offensive capabilities and mobility, making it effective
     *  against multiple opponents"
     *
     * MEASURED WITHOUT THIS, and it is the finding that put the field here:
     * against one blade, the pair's tip-to-tip span was **−30%** and its extra
     * guard rose was **+0.0°**. It had a shorter second blade cutting at 55%,
     * one hand instead of two, and NOTHING back — the set was the single blade
     * with a handicap and a second hilt, which is exactly the "only better or
     * only worse" collapse the trade check exists to prevent, in the worse
     * direction.
     *
     * A STAFF'S SPAN IS METAL AND A PAIR'S IS ARMS, and that is why the two
     * cannot share one number. The staff's is the shaft: fixed, rigid, and
     * measured off the two built hilts (above). The pair's is how far apart
     * the two FISTS are carried — `GRIP_PAIR.R - GRIP_PAIR.L` scaled by the
     * carrier's own arm, because a small frame covers less ground with two
     * blades than a tall one does and the whole point of `reachScale` in
     * `GRIPS` is that the guard is held at arm's length.
     *
     * IT IS NARROWER THAN THE STAFF'S, which is right and is the trade: a
     * quarterstaff answers a wider rose than two short swords, and what the
     * pair buys instead is the free hand (`hands: 1`) and the blade it can
     * throw without disarming itself.
     */
    this.cross = this.set.id === 'pair'
      ? Math.abs((owner?.limbs?.arm ?? 1) * PAIR_CROSS) : 0;

    /**
     * THE OFF BLADE'S OWN THROW STATE, and it is a NEW FIELD rather than a
     * rewritten one. `Player.throwState` is read by nine places and every one
     * of them means "the weapon in your right hand is gone" — `handsOnHilt`,
     * the `wantOne` derivation, `_updateBlade`'s pose and heat-haze gates, the
     * arm block's gate, the attack gate, `swapSaber`, `_dropSaber`,
     * `_maybeDisarm` and the HUD's active wheel border. Making a throw not
     * empty your hands is a one-word change there and it would silently re-arm
     * the single blade in all nine. So the pair does not touch it.
     */
    this.throwState = 'held';           // held | flying | returning
    this.throwPos = new THREE.Vector3();
    this.throwVel = new THREE.Vector3();
    this.throwTimer = 0;
    this.throwSpin = 0;

    /** Held ONLY while the staff's orbit is up. See `Player._updateThrow`. */
    this.orbitAngle = 0;
    this.orbitT = 0;

    this.hand = new THREE.Vector3();
    this.quat = new THREE.Quaternion();
    this._posed = false;
  }

  /** True when the off blade is a weapon in a hand — the question
   *  `handsOnHilt` cannot express and must not learn. */
  get inHand() { return this.throwState === 'held'; }

  /** Both blades of this weapon, main first — the order `_bladeEntries`
   *  depends on, so the main blade is always the one credited with `auto`. */
  blades() { return [this.owner.saber, this.saber]; }

  ignite() { this.saber.ignite?.(); }
  retract() { this.saber.retract?.(); }
  setVisible(v) { this.saber.setVisible?.(v); }

  /**
   * WHICH SEGMENT OF A STAFF IS IN FRONT.
   *
   * `GUARD.reach` is 100°, which already says you cannot guard behind you, so a
   * staff pushes exactly ONE extra blade entry — whichever end has the greater
   * dot with the aim — and a blade eating bolts behind your own back is not a
   * feature. Returns the main blade for a pair, which never asks.
   */
  frontBlade(aimDir) {
    const main = this.owner.saber;
    if (this.set.id !== 'staff' || !aimDir) return this.saber;
    const a = _s1.subVectors(main.tip, main.base).normalize().dot(aimDir);
    const b = _s2.subVectors(this.saber.tip, this.saber.base).normalize().dot(aimDir);
    return b > a ? this.saber : main;
  }

  /**
   * ONE FRAME OF THE SECOND WEAPON, and it is the same two public calls
   * everything else in this game drives a Saber with.
   */
  update(dt, ctx) {
    const p = this.owner;
    if (this.set.id === 'staff') {
      if (p.throwState === 'orbit') this._poseOrbit(dt);
      else this._poseStaff();
    } else if (this.throwState === 'held') {
      this._posePair(dt);
    } else {
      this._flyOff(dt, ctx);
    }
    this.saber.carrierVel = p.velocity;
    this.saber.update(dt, ctx?.time ?? 0, p.velocity);
  }

  /**
   * THE STAFF'S LOWER BLADE — the same hand point, a π flip about the hand's
   * FORWARD axis, and a slide down the shaft.
   *
   * The flip is about forward and not about the blade's own axis for the reason
   * `handPoseOnHilt`'s 119.6° palm repair records: the hilt's roll has to be
   * carried through the composition rather than reinvented, or the lower hilt
   * comes out rolled relative to the upper one and the two halves of what is
   * supposed to be one shaft do not line up.
   */
  _poseStaff() {
    const c = this.owner.control;
    _sq.setFromAxisAngle(_s1.set(0, 0, 1), Math.PI);
    this.quat.copy(c.quat).multiply(_sq);
    // Down the shaft in the HILT's own frame, so the two pommels meet wherever
    // the hand happens to be pointing.
    _s2.set(0, this.offset, 0).applyQuaternion(c.quat);
    this.hand.copy(c.handPos).add(_s2);
    this.saber.setHiltPose(this.hand, this.quat);
    this.saber.setVisible(true);
  }

  /**
   * THE PAIR'S OFF BLADE — the main guard mirrored about the body's right axis
   * and dropped, driven along the main blade's own arc on the second beat.
   *
   * Enemy's shipped `_poseOffhand` rule, ported: mirror, drop by 0.28 while the
   * blade is at guard, and close that drop as `lag` runs to 1 so the second
   * blade comes UP under the first. The lag itself is that file's own measured
   * expression and is not re-derived here.
   *
   * The mirror is a REFLECTION, which is not a rotation — reflecting all three
   * axes of a right-handed basis gives a left-handed one, and a quaternion
   * built from it is garbage. So the blade axis and the forward axis are
   * reflected and the third is taken as their cross product, which restores the
   * handedness and is what makes the off hilt read as a hilt held the other way
   * up rather than as a mirror-image model.
   */
  _posePair(dt) {
    const p = this.owner, c = p.control;
    const chest = _s1.copy(p.chest);
    const right = _s2.set(1, 0, 0).applyQuaternion(p.camera.aimQuat).setY(0).normalize();
    if (!Number.isFinite(right.x) || right.lengthSq() < 1e-6) right.set(1, 0, 0);

    /* HOW FAR THROUGH THE ARC THE MAIN BLADE IS. `slash` is the controller's
     * own 0..1 envelope — it is already smoothstepped up and back down — so
     * this needs no second clock and cannot disagree with the animation. */
    const u = clamp(c.slash ?? 0, 0, 1);
    const lag = clamp((u - OFFHAND.lagStart) / OFFHAND.lagSpan, 0, 1);

    // The hand: mirrored about the right axis, dropped, and the drop closing as
    // the second beat arrives.
    const rel = _s3.subVectors(c.handPos, chest);
    rel.addScaledVector(right, -2 * rel.dot(right));
    rel.addScaledVector(UP, -OFFHAND.drop * (1 - lag));
    const target = _s4.copy(chest).add(rel);
    if (!this._posed) { this.hand.copy(target); this._posed = true; }
    this.hand.lerp(target, clamp(dt * OFFHAND.settle, 0, 1));

    // …and the orientation, reflected in the same plane.
    const y = _s5.set(0, 1, 0).applyQuaternion(c.quat);
    const z = _s6.set(0, 0, 1).applyQuaternion(c.quat);
    y.addScaledVector(right, -2 * y.dot(right)).normalize();
    z.addScaledVector(right, -2 * z.dot(right)).normalize();
    const x = _s1.crossVectors(y, z).normalize();
    _s2.crossVectors(z, x).normalize();
    _sm.makeBasis(x, _s2, z);
    _sq2.setFromRotationMatrix(_sm);
    this.quat.slerp(_sq2, clamp(dt * OFFHAND.settle, 0, 1));

    this.saber.setHiltPose(this.hand, this.quat);
    this.saber.setVisible(true);
  }

  /**
   * THE SHOTO IN THE AIR — the shipped throw, on the off blade's own state.
   *
   * `_updateThrow`'s body is set-agnostic once you hand it a saber, a position
   * and a velocity: 26 m/s along the aim, turning home after 1.5 s, and the
   * horizontal-disc pose through `setHiltPose`. The argument the shipped
   * cooldown note makes — that it starts when the blade is BACK IN THE HAND
   * rather than at release, because a cooldown that runs while the power is
   * still going off is a decoration — is form-independent, so it carries over
   * unchanged and `Player` writes `cooldowns.throwOff` at the catch.
   */
  _flyOff(dt, ctx) {
    const p = this.owner;
    this.throwTimer += dt;
    this.throwSpin += dt * 27;
    if (this.throwState === 'flying') {
      _s1.copy(p.aimDir).multiplyScalar(26);
      this.throwVel.lerp(_s1, clamp(dt * 1.4, 0, 1));
      this.throwPos.addScaledVector(this.throwVel, dt);
      if (this.throwTimer > 1.5) this.throwState = 'returning';
    } else {
      _s1.subVectors(p.control.handPos, this.throwPos);
      const d = _s1.length();
      if (d < 0.45) {
        this.throwState = 'held';
        this._posed = false;
        this.caught = true;
        return;
      }
      _s1.multiplyScalar(1 / d);
      this.throwVel.lerp(_s2.copy(_s1).multiplyScalar(clamp(d * 7, 12, 34)), clamp(dt * 7, 0, 1));
      this.throwPos.addScaledVector(this.throwVel, dt);
    }
    /* AND IT DOES NOT GO UNDER THE FLOOR — the shipped skim, for the shipped
     * reason: `Saber.update` calls `ground.scar(prevTip, tip)` on every lit
     * frame, so a buried blade gouges a trench nobody can see. */
    const terrain = ctx?.terrain || p.world?.terrain;
    if (terrain) {
      const gh = terrain.height(this.throwPos.x, this.throwPos.z) + 0.34;
      if (this.throwPos.y < gh) {
        this.throwPos.y = gh;
        if (this.throwVel.y < 0) this.throwVel.y = 0;
      }
    }
    _sq.setFromAxisAngle(UP, this.throwSpin);
    _sq2.setFromAxisAngle(_s1.set(1, 0, 0), Math.PI / 2);
    this.hand.copy(this.throwPos);
    this.quat.copy(_sq.multiply(_sq2));
    this.saber.setHiltPose(this.throwPos, this.quat);
    this.saber.setVisible(true);
  }

  /**
   * THE SPIN BARRIER — both blades round the chest, on a circle, hands free.
   *
   * The whole trick is that this is the THROW MACHINE and not a new one: the
   * blades are driven by `setHiltPose` exactly as the flying disc already is,
   * they stay in `_bladeEntries` and in the target sweep, and so they deflect
   * and cut through the ORDINARY paths at the ORDINARY prices. Not a new absorb
   * shape queried before the body, not immunity, and no bolt skips
   * `gradeCaught` — which is what keeps SCOPE §3 satisfied with no new combat
   * rule at all.
   *
   * "Hands free" costs nothing to build, and it is the part of the player's
   * brief the shipped code already answers: `handsOnHilt()` returns 0 for
   * `throwState !== 'held'`, so both fists come off the hilt through a reader
   * that shipped years ago, `_openPalm` opens the left palm through the path
   * that already exists, and all thirteen left-handed GESTURES become available
   * with the whole arm.
   *
   * The two halves are π apart on the ring, which is what a staff spun about
   * its middle is, and each is posed with its own blade pointing along the
   * tangent — so `speedAt` is measured along a segment pivoting about its own
   * base and stays monotone, exactly as it is in the hand.
   */
  _poseOrbit(dt) {
    const p = this.owner;
    this.orbitT += dt;
    this.orbitAngle += dt * ORBIT.rate;
    const grow = clamp(this.orbitT / ORBIT.rise, 0, 1);
    const r = ORBIT.radius * grow;
    const fwd = _s1.set(0, 0, -1).applyQuaternion(p.camera.aimQuat).setY(0).normalize();
    if (!Number.isFinite(fwd.x) || fwd.lengthSq() < 1e-6) fwd.set(0, 0, -1);
    const right = _s2.crossVectors(fwd, UP).normalize().negate();
    const blades = [p.saber, this.saber];
    for (let i = 0; i < 2; i++) {
      const a = this.orbitAngle + i * Math.PI;
      const ca = Math.cos(a), sa = Math.sin(a);
      // Where the hilt is on the ring…
      const at = _s3.copy(p.chest).addScaledVector(right, ca * r * 0.45).addScaledVector(fwd, sa * r * 0.45);
      // …and the blade lies along the tangent, so the tip leads the base and
      // the segment is a real swept quad rather than a spoke.
      const tan = _s4.copy(right).multiplyScalar(-sa).addScaledVector(fwd, ca).normalize();
      _sm.lookAt(_s5.set(0, 0, 0), _s6.copy(tan).negate(), UP);
      _sq.setFromRotationMatrix(_sm);
      // `lookAt` points -Z; a blade points +Y, so turn the frame a quarter.
      _sq2.setFromAxisAngle(_s5.set(1, 0, 0), -Math.PI / 2);
      const b = blades[i];
      b.setHiltPose(at, _sq.multiply(_sq2));
      b.setVisible(true);
      if (i === 1) { this.hand.copy(at); this.quat.copy(_sq); }
    }
  }

  dispose() {
    this.saber?.dispose?.();
    this.saber = null;
  }
}
