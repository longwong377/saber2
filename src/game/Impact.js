/**
 * BATTLEFRONT BORZ — what a moving object does to what it hits.
 *
 * ── the gap this closes ───────────────────────────────────────────────────
 *
 * The brief says everything is simulated. It very nearly is: props are real
 * hulls, walls come down, corpses are articulated. What was missing is the
 * last step of the sentence — a thing in motion MEETING another thing and
 * that meaning something.
 *
 * Until `RapierWorld._dispatchContacts` existed, nothing in the game was ever
 * told that two objects touched. Every system that needed the fact grew its
 * own private sweep instead:
 *
 *   Player._updateHurled   a sphere sweep against `ctx.enemies`, run by the
 *                          THROWER, which is why only the player's own throws
 *                          have ever hurt anything
 *   Forest._sweep          a raycast, for falling trunks
 *   World.onExplosion      a sphere, for blasts
 *
 * Three narrow collision systems, each reimplementing what Rapier computes
 * every step, and between them they cover three verbs out of the hundreds a
 * physics sandbox can produce. A crate dropped by a collapsing gantry, a
 * barrel knocked loose by a blast, a droid shoved into the droid behind it, a
 * chunk of wall thrown by a Force push — every one of those was inert, not
 * because anybody decided it should be but because there was no wire.
 *
 * This file is the wire, and it is deliberately ONE RULE rather than a table
 * of cases: mass meets mass at a speed, and the game already knows what that
 * is worth.
 *
 * ── the rule is not a new rule ────────────────────────────────────────────
 *
 * `Combat.impactDamage` has priced kinetic hits since the thrown crate was
 * built, and `Forest.crushDamage` already reaches it rather than keeping a
 * second copy. This file adds no arithmetic of its own: it hands the SAME
 * function the mass and speed that `RapierWorld` measured, so a crate that
 * hits a droid because you threw it and a crate that hits a droid because a
 * roof fell on it are worth the same, which is the whole point.
 *
 * ── only strikers are armed ───────────────────────────────────────────────
 *
 * Both sides of a contact are offered a handler, so if a crate and a droid
 * were both armed, one collision would be billed twice. The rule that avoids
 * it needs no bookkeeping: ARM THE THINGS THAT DELIVER A HIT, never the things
 * that take one. Props, debris and chunks are armed; enemies and the player
 * are found through the other side of the contact and are never armed
 * themselves. Two crates meeting are both strikers and both take a share,
 * which is correct and is the only symmetric case.
 */

import * as THREE from 'three';
import { impactDamage } from './Combat.js';
import { clamp } from '../engine/MathUtil.js';
import { audio } from '../engine/Audio.js';

const _dir = new THREE.Vector3();
const _imp = new THREE.Vector3();
const _pt = new THREE.Vector3();
/* Its own scratch: `_selfDamage` is handed `_dir` and needs the reverse of it,
 * and negating the caller's vector in place is the kind of aliasing that works
 * until somebody adds a line after the call. */
const _back = new THREE.Vector3();

/**
 * Below this closing speed a contact is a nudge and buys nothing.
 *
 * It is the same number `Player._updateHurled` has always used to decide that
 * a throw is spent (`speed < 7`), one metre lower because the contact channel
 * reports the speed actually exchanged rather than the speed of travel — a
 * distinction that did not exist when that constant was chosen. Below it the
 * damage the curve would produce is under half a point anyway: a 22 kg crate
 * at 6 m/s reads 0.48.
 */
export const KINETIC_MIN_SPEED = 6;

/**
 * The default price of a collision, and it is the CRATE's price.
 *
 * `k`, `floor` and `cap` are `impactDamage`'s own signature. The floor is 0
 * here where the throw uses 8: a deliberate throw is allowed a minimum because
 * you chose to make it, but a contact happens to you, and a world where every
 * bump that clears the speed gate is worth 8 damage is a world where walking
 * into a barrel is a threat. With no floor the curve fades in smoothly and
 * `KINETIC_MIN_SPEED` is the only gate that matters.
 */
export const KINETIC = { k: 0.0006, floor: 0, cap: 140 };

/**
 * …AND THE PRICE OF ONE YOU THREW ON PURPOSE, which is not the same price.
 *
 * These are `Player._trackHurl`'s prop coefficients, unchanged: `k` 0.0006,
 * floor 8, cap 140. The floor is the whole difference and it is the reason
 * this table exists rather than being folded into `KINETIC`.
 *
 * A contact HAPPENS TO YOU — a crate a collapse drops, a droid shoved into the
 * droid behind it — and a world where every bump that clears the speed gate is
 * worth 8 damage is a world where walking into a barrel is a threat. A THROW
 * is an act: you spent 14 Force and your grip on it, you aimed it, and a
 * glancing hit at the end of that still has to be worth something or the power
 * is worse than it reads. `_updateHurled` has floored a throw at 8 since it
 * was written and the feel of the power is built on it.
 *
 * Found by `force.mjs` rather than by reasoning: with the throw priced as an
 * ambient contact, a crate that used to take 8 off a B1 took 3.6, and the
 * check that has always asserted "a thrown crate actually hurts what it lands
 * on" said so. `userData.hurledBy` is what tells the two apart, and it is
 * already set — it is the same field that decides whose kill it is.
 */
export const KINETIC_THROWN = { k: 0.0006, floor: 8, cap: 140 };

/**
 * Arm a body so that what it hits knows about it.
 *
 * `opts` is stored on the body and read back in the handler, so one shared
 * function serves every armed body in the level and no closure is allocated
 * per prop. Pass `k`, `floor` and `cap` to price a kind of object differently;
 * pass `fragile: false` to stop it hurting itself on the architecture.
 */
export function armKinetic(body, opts = null) {
  if (!body) return body;
  if (opts) body.userData.kinetic = opts;
  body.onContact = kineticContact;
  return body;
}

/** Undo `armKinetic`. The collider is disarmed with it. */
export function disarmKinetic(body) {
  if (body) body.onContact = null;
  return body;
}

/**
 * WHO TOOK THE HIT — the one place that knows how a physics body maps back
 * onto a thing with hit points.
 *
 * The three keys are not invented here. `Enemy` has written `userData.enemy`
 * on its capsule since it was built, `Prop` writes `userData.prop`, `Player`
 * writes `userData.player` and `Ragdoll` writes `userData.actor`. They existed
 * as debugging conveniences; this makes them the contract.
 */
export function victimOf(body) {
  if (!body) return null;
  const u = body.userData;
  return u.enemy || u.player || u.prop || u.actor || null;
}

/**
 * The handler itself. `this` is the armed body; `c` is RapierWorld's scratch
 * contact and must not be kept.
 *
 * WHAT IT DOES NOT DO, on purpose: it does not look at `ctx.enemies`, it does
 * not sweep, and it does not know what kind of level it is in. Everything it
 * needs is in the contact — which is the difference between a rule and the
 * three special cases it replaces.
 */
export function kineticContact(other, c) {
  if (c.speed < KINETIC_MIN_SPEED) return;
  const self = c.self;
  /**
   * WHOSE KILL IT IS decides WHAT IT IS WORTH, which is one lookup for both.
   * A body still carrying a thrower is mid-throw and is priced as one; the
   * same crate three seconds later, after `_updateHurled` has released the
   * claim, is ordinary matter again. See `KINETIC_THROWN`.
   */
  const source = self.userData.hurledBy || null;
  const tune = self.userData.kinetic || (source ? KINETIC_THROWN : KINETIC);
  const dmg = impactDamage(c.mass, c.speed, tune);
  if (dmg <= 0) return;

  /* A thrown thing carries its thrower, so a droid crushed by a crate you put
   * in the air is your kill and pays out as one. Anything else — a collapse, a
   * blast, another droid's shove — has no author and passes `null`, which every
   * `damage()` in the game already accepts. */
  _pt.copy(c.point);
  _dir.copy(c.normal);

  const victim = victimOf(other);

  // The world itself: architecture, a wall, the ground. Nothing to hurt, but
  // the thing that hit it can still break on it.
  if (!victim) { _selfDamage(self, tune, dmg, _pt, _dir); _thud(_pt, dmg); return; }

  /**
   * ONE HIT PER VICTIM PER THROW. A contact start is once per meeting, which
   * is dedupe enough for ordinary matter — a crate that bounces off a droid
   * and comes back down SHOULD hurt again. A throw is different: its claim
   * lasts 2.6 s and prices every hit at the throw's floor, so a crate settling
   * against the body it landed on would bill 8 a time as it came to rest. The
   * Set is the throw record's own, handed over by `Player._trackHurl`.
   */
  const seen = source ? self.userData.hurlHit : null;
  if (seen) {
    const key = victim.id ?? victim;
    if (seen.has(key)) return;
    seen.add(key);
  }

  if (typeof victim.applyKnockback === 'function') {
    /**
     * A living thing. Damage and impulse go through ONE call because
     * `applyKnockback` weighs them together — see IMPULSE_AS_HP — and billing
     * them separately would charge a body twice for one blow.
     *
     * THE SHOVE IS OFF THE MOMENTUM, NOT OFF THE SPEED, and the first version
     * took it off the speed because that is what `_updateHurled` does. That
     * was safe there and is not safe here: `_updateHurled` only ever sees
     * things the player deliberately threw, which are heavy, so `speed * 0.5`
     * with a floor of 4 was a fine shorthand for "a crate just hit you". The
     * contact channel sees everything — including a 0.4 kg severed finger,
     * which under that formula shoved exactly as hard as a 120 kg crate,
     * because neither the floor nor the ceiling mentions mass.
     *
     * `c.impulse` is the real momentum exchanged, in N·s, so the division is
     * only a change of units. It is calibrated to leave the throw alone: the
     * 22 kg crate at 30 m/s that used to read 15.0 reads 15.0, and the finger
     * that used to read 4 now reads 0.2.
     */
    const mag = Math.min(22, c.impulse / 35);
    _imp.copy(_dir).multiplyScalar(mag).setY(Math.min(4, mag * 0.27));
    victim.applyKnockback(_imp, dmg, source);
  } else if (typeof victim.damage === 'function') {
    // A prop. Its own `damage` decides whether that was enough to break it.
    victim.damage(dmg, _pt, _dir);
  }

  _selfDamage(self, tune, dmg, _pt, _dir);
  _thud(_pt, dmg);
}

/**
 * A THROWN THING BREAKING ON WHAT IT HITS — OFF BY DEFAULT, and the reason it
 * is off is the best argument in this file.
 *
 * The case for it is real: a prop that survives every wall it is thrown at is
 * a projectile with unlimited ammunition, and the level is full of them. So
 * the first version of this billed every armed body a share of what it dealt,
 * `_updateHurled`'s own 55%, including against the world.
 *
 * `dropped.mjs` failed immediately, and it was right to. A dropped lightsaber
 * is a `Prop`; a dropped lightsaber LANDS; landing is a contact with the
 * world at a speed that clears every gate — and the blade on the floor, which
 * is a whole shipped feature with its own suite, shattered on arrival. The
 * check that caught it had nothing to do with contacts, which is exactly why
 * it was worth having.
 *
 * The lesson is not "guard the saber". It is that BREAKING A PROP IS A BALANCE
 * DECISION AND THIS FILE IS NOT ENTITLED TO MAKE IT. The gap this whole
 * channel exists to close is that a moving object does nothing to what it
 * hits; making objects destroy THEMSELVES is a separate change with its own
 * consequences for every prop in every level, and smuggling it in under a
 * bug fix is how a physics fix turns into a balance patch nobody asked for.
 *
 * So it is opt-in: `{ fragile: true }` on a prop that should break, and the
 * share is `selfShare`. When somebody does want thrown crates to break, the
 * place to start is a threshold well above landing speed, and a check that
 * asserts a dropped weapon survives its own drop.
 */
function _selfDamage(self, tune, dmg, pt, dir) {
  if (tune.fragile !== true) return;
  const prop = self.userData.prop;
  if (!prop || prop.dead || typeof prop.damage !== 'function') return;
  prop.damage(dmg * (tune.selfShare ?? 0.55), pt, _back.copy(dir).negate());
}

function _thud(pt, dmg) {
  audio.thud(pt, clamp(dmg / 60, 0.4, 1.4));
}
