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

import * as THREE from '../../vendor/three/three.module.js';
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
 * …AND THE SAME GATE FOR A BODY, WHICH IS MUCH LOWER, BECAUSE MASS CARRIES IT.
 *
 * The 6 above is right for a thing whose damage comes from how fast it is
 * going — a crate, a chunk, a limb. A living body's comes from how much of it
 * there is: an AT-TE is 900 kg and a beast is 1400, and neither of them ever
 * moves at 6 m/s. At 4 m/s a walker reads 8.6 damage and at 1.5 it reads 1.2,
 * so the curve is already doing the gating; all this floor has to do is stop
 * two droids brushing shoulders in a crowd from being an event.
 */
export const KINETIC_MIN_APPROACH = 1.5;

/**
 * HOW OFTEN ONE BODY MAY HURT THE SAME BODY, in seconds.
 *
 * A contact START is once per meeting, which is all the dedupe a crate needs:
 * it arrives, it hits, it is done. Two LIVING bodies do not do that. They are
 * kinematic capsules driven into each other by their own locomotion, and while
 * they are overlapping they slide, separate by a millimetre and touch again —
 * so the pair raises a start, and another, and another, several times a second
 * for as long as they are jostling.
 *
 * Found by `powers.mjs`, which had nothing to do with contacts: its mend test
 * put a hurt ally next to the player and reported "the ally went 14 → 4 hp —
 * the mend paid for itself and did nothing". Ten damage from standing next to
 * somebody, arriving as a few dozen tiny bills.
 */
export const BODY_HIT_EVERY = 0.6;

/**
 * What a body's blow is worth to somebody on its OWN side.
 *
 * `Command.installTeamDamage` already wraps `damage` on enlisted bodies and
 * scales a blow to a team-mate by `settings.teamDamage`, 0.35 by default. That
 * wrapper is only installed where an army has been enlisted, so in Waves or
 * the Trials a Jedi walking into their own trooper would be billed in full —
 * and a body walking into a body is the one kind of blow that happens whether
 * or not anybody meant it. So the same rule is applied here, off the victim's
 * own `teamDamage` where it has one, and the wrapper is left to do its work
 * where it exists: the two compose, which is right, because a shove between
 * team-mates should be gentler than a shove between enemies twice over.
 */
export const TEAM_SHARE = 0.35;

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
 * …AND THE PRICE OF BEING HIT BY SOMETHING ALIVE.
 *
 * Same curve, and two differences that are both about what a body is.
 *
 * `hurtsProps: false` — a body shoves scenery, it does not smash it. Every
 * droid in a crowd brushing past every crate in a level would otherwise chew
 * through the props of a busy room in a minute, and a trooper walking into a
 * barrel is not an attack on the barrel. The shove still happens; that is
 * Rapier's job and it has always worked.
 *
 * The cap is the same 140 and it BINDS here, which is the point. A 1400 kg
 * beast at 8 m/s prices at 430 and a walker at 6 prices at 194: both saturate,
 * and that is the correct read — being run down by either should be somewhere
 * between very bad and fatal rather than a number that scales forever.
 */
/**
 * `jostle` — THE THING THE PARAGRAPH ABOVE `KINETIC_MIN_APPROACH` CLAIMED AND
 * DID NOT HAVE.
 *
 * That note says the approach gate's whole job is "to stop two droids brushing
 * shoulders in a crowd from being an event", and reasons that "the curve is
 * already doing the gating" because it fades in smoothly. It fades — it never
 * reaches zero. At 1.5 m/s a walker reads 1.2 and the gate lets it through,
 * so a shoulder brush IS an event, worth a fifth of a point.
 *
 * That is nothing in a fight, which lasts a minute and is between people
 * trying to kill each other. It is not nothing on a STATION, where thirty-five
 * residents mill about in a concourse for hours and never heal. Measured on
 * deck 40 with the player standing still and pressing nothing: 479 contacts in
 * 45 s, 0.21 damage each, 102 damage spread over the crowd — 31 of 35
 * residents visibly hurt, none of them by anybody. `StationLife.witness` then
 * read that as an assault and shut every shop on the station (see its note).
 *
 * So a body-on-body contact under `jostle` damage is a JOSTLE and buys
 * nothing. It is on `KINETIC_BODY` alone: a crate is not a shoulder, and a
 * thrown thing has `KINETIC_THROWN`'s floor of 8 precisely because you meant
 * it. 1.5 sits above the 1.2 a walker reads at the approach gate and far under
 * the 8.6 it reads at 4 m/s, so being run down still lands in full and the
 * only thing removed is the bill for standing in a crowd.
 */
export const KINETIC_BODY = { k: 0.0006, floor: 0, cap: 140, hurtsProps: false, jostle: 1.5 };

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
 * Are these two bodies parts of ONE creature?
 *
 * Three ways they can be, and all three happen: the same body on both sides of
 * a pair (Rapier will not raise that, but a caller might), a bone and the
 * capsule of the actor it belongs to, and two bones of the same ragdoll.
 * `userData.actor` is the Ragdoll and `Enemy.actor` is the same object, which
 * is what makes the middle case answerable at all.
 */
export function sameCreature(a, b, victim) {
  if (!a || !b) return false;
  if (a === b) return true;
  const ua = a.userData, ub = b.userData;
  if (ua.actor && ua.actor === ub.actor) return true;              // two bones, one corpse
  const mine = ua.enemy || ua.player;
  if (mine && (mine === victim || mine.actor === ub.actor)) return true;
  if (ua.actor && victim && victim.actor === ua.actor) return true;  // bone → its own body
  return false;
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
  /* Two gates, because there are two regimes — see KINETIC_MIN_APPROACH.
   * `c.approach` is set by the dispatcher when neither side could recoil, which
   * is every pair of living bodies in the game. */
  if (c.speed < (c.approach ? KINETIC_MIN_APPROACH : KINETIC_MIN_SPEED)) return;
  const self = c.self;
  /**
   * WHOSE KILL IT IS decides WHAT IT IS WORTH, which is one lookup for both.
   * A body still carrying a thrower is mid-throw and is priced as one; the
   * same crate three seconds later, after `_updateHurled` has released the
   * claim, is ordinary matter again. See `KINETIC_THROWN`.
   */
  const source = self.userData.hurledBy || null;
  const tune = self.userData.kinetic
    || (source ? KINETIC_THROWN : (c.approach ? KINETIC_BODY : KINETIC));
  /**
   * `price` — the one escape valve, for a striker that is not uniform.
   *
   * Everything in this file assumes a body is a lump: one mass, one speed,
   * priced by one curve. A falling TREE is not. The mass that reaches you is
   * your own width of trunk rather than the whole tree, and the speed depends
   * where along it you were standing, because a rod pivoting at one end moves
   * at `ω·r`. `Forest.crushDamage` has known both of those since it was
   * written and is a strictly better answer than `impactDamage(mass, speed)`
   * for that one shape.
   *
   * This is a TUNING, not a second collision system. The contact is still
   * dispatched here, deduped here, attributed here and applied here; the
   * striker is only allowed to say what its own blow is worth.
   */
  let dmg = tune.price ? tune.price(c, self) : impactDamage(c.mass, c.speed, tune);
  if (!(dmg > 0)) return;
  /* A brush is not a blow. See `jostle` on KINETIC_BODY — the only tune that
   * carries one, because it is the only tune whose striker is a person. */
  if (tune.jostle && dmg < tune.jostle) return;

  /* A thrown thing carries its thrower, so a droid crushed by a crate you put
   * in the air is your kill and pays out as one. Anything else — a collapse, a
   * blast, another droid's shove — has no author and passes `null`, which every
   * `damage()` in the game already accepts. */
  _pt.copy(c.point);
  _dir.copy(c.normal);

  const victim = victimOf(other);

  /**
   * NOTHING HITS ITSELF, and this is not a theoretical case.
   *
   * A creature is in the physics world more than once: a living body is a
   * kinematic capsule, and the moment it goes down it is ALSO nineteen ragdoll
   * capsules occupying the same space. Now that RAGDOLL and ENEMY name each
   * other, those two halves of one creature are a collider pair — so a downed
   * trooper's own shoulder grinds against their own capsule and bills them for
   * it, several times a second, forever.
   *
   * `powers.mjs` caught it and the shape of the report is worth keeping: its
   * mend test said "the ally went 14 → 4 hp — the mend paid for itself and did
   * nothing". Nobody was attacking anybody. The man was lying on himself.
   */
  if (victim && sameCreature(self, other, victim)) return;

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

  /**
   * A BODY DOES NOT HIT THE SAME BODY TWICE IN A HURRY, and it does not hit
   * its own side as hard. Both only apply to the body regime — a crate has
   * neither a side nor a habit of lingering. See BODY_HIT_EVERY, TEAM_SHARE.
   */
  if (c.approach) {
    let log = self.userData.kinLog;
    if (!log) { log = self.userData.kinLog = new Map(); }
    const key = victim.id ?? victim;
    const last = log.get(key);
    if (last !== undefined && c.time - last < BODY_HIT_EVERY) return;
    log.set(key, c.time);
    /* The map is per striker and a striker meets a bounded number of things;
     * it is still swept, because a body that lives a whole level meets a lot
     * of them one at a time. */
    if (log.size > 24) for (const [k, t] of log) { if (c.time - t > BODY_HIT_EVERY * 4) log.delete(k); }

    const mine = self.userData.enemy?.team ?? self.userData.player?.team;
    const theirs = victim.team;
    if (mine !== undefined && theirs !== undefined && mine === theirs) {
      dmg *= (victim.teamDamage ?? TEAM_SHARE);
      if (dmg <= 0) { _thud(_pt, 1); return; }
    }
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
    /* THE HEALTH BEFORE, FOR THE WIRE. On a co-op client both machines run the
     * same physics world and resolve the same contacts, so a bump that hurts
     * has already been billed by the host — `World.netContactBilled` moves that
     * machine's baseline instead of claiming it back. Measured as a live leak
     * before this existed: an idle joining player billing the host 0.1–0.5 hp a
     * time in `force` damage, out of forty men in a line jostling each other.
     * A no-op off the wire, and the only thing this file knows about the net. */
    const hp0 = victim.hp;
    victim.applyKnockback(_imp, dmg, source);
    victim.world?.netContactBilled?.(victim, hp0, source);
  } else if (typeof victim.damage === 'function') {
    // A prop. Its own `damage` decides whether that was enough to break it —
    // unless the striker is a body, which shoves scenery rather than breaking
    // it. See KINETIC_BODY.
    if (tune.hurtsProps !== false) victim.damage(dmg, _pt, _dir);
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
