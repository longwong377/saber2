/**
 * BATTLEFIELD BORZ — TAKING THE CONTROLS.
 *
 * The player, in the V5 list:
 *
 *   "I think we should be able to drive the vehicles it makes sense to drive"
 *
 * ── WHICH ONES IT MAKES SENSE TO DRIVE, AND IT IS NOT A SIZE RULE ────────
 *
 * The roster splits cleanly along a line the source material already drew, and
 * it is the line the note is pointing at: some of these machines have a CREW
 * COMPARTMENT and the rest are droids. An AT-TE has six crew and a spotter's
 * cupola. A Juggernaut has a driver's cabin at each end so it never has to
 * turn round. An AAT has four battle droids in a hull with a hatch, which is
 * why the films are full of droids riding on top of one. A SPHA has twenty-five
 * gunners walking a gun the length of a city block.
 *
 * A hailfire droid, a dwarf spider, an Octuptarra tri-droid and a Persuader
 * snail tank have NOBODY IN THEM. There is no seat to take, no hatch to open
 * and nobody to displace — the brain is the machine. Making those drivable
 * would be a game rule that contradicts the thing the model is of, and the
 * whole point of "it makes sense" is that the player can tell which is which
 * by LOOKING at it. So `crew` is declared on the archetype as the canon number
 * of bodies inside, and the presence of that number is the whole rule. There is
 * no second list of drivable things to fall out of step with it.
 *
 * ── AND WHOSE MACHINE YOU MAY TAKE ───────────────────────────────────────
 *
 * Your own side's, whenever you like: a tank your army brought to the field is
 * a tank you are entitled to. The enemy's ONLY once it has stopped fighting —
 * `WRECK` of its hull or less, which reads as the crew being dead and the
 * machine still running. That is the choice worth having: a tank you kill is a
 * tank nobody drives, and a tank you cripple is one you can turn round. Killing
 * it outright is easier and gets you nothing, which is exactly the trade the
 * note is asking for when it says "contextually".
 *
 * ── WHAT DRIVING ONE IS, STRUCTURALLY ────────────────────────────────────
 *
 * The vehicle stays an ordinary `Enemy` and nothing about it is replaced. What
 * changes is one field — `vehicle.driven` — and the three things that read it:
 * `Enemy.update` skips the brain, `_move` gets a `wish` from the crew instead
 * of from the AI, and `_shoot` is called by the crew instead of by the fire
 * loop. Everything else the machine has keeps working without knowing: its hp,
 * its armour table, its legs coming off at three, its `_poseWalker` gait, the
 * blade's contact set against its plates, and its death.
 *
 * That is deliberate and it is the same argument `Riders.js` makes one file
 * over: a driven tank you can be shot out of, whose legs can still be cut from
 * under you, is worth having; a driven tank that is a camera with a gun is not.
 */

import * as THREE from 'three';
import { ARCHETYPES } from './Enemy.js';
import { audio } from '../engine/Audio.js';
import { clamp, TAU } from '../engine/MathUtil.js';

const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _v3 = new THREE.Vector3();

/**
 * THE NUMBERS, AND WHY EACH IS THE NUMBER IT IS.
 *
 * `reach` is measured from the HULL and not from the centre — a machine
 * thirteen metres long whose centre you had to stand within five metres of
 * would be one you could only board from the side. `boundingRadius` is what
 * that means in practice and it is read off the archetype's own scale.
 *
 * `wreck` is a share of max hp rather than a flat number because this roster
 * spans 340 hp on a dwarf spider and 4 400 on a SPHA, and a flat threshold is
 * either "already dead" or "barely scratched" depending on which one you walked
 * up to.
 *
 * `turn` is in radians a second and is deliberately SLOWER than the AI's own
 * yaw. A machine that spins under the reticle reads as a cursor; the whole feel
 * of driving something this big is that pointing it somewhere is a decision you
 * commit to. The gun does not share the limit — see `_aimGun` — because a
 * turret turning faster than the hull is the entire reason a turret exists.
 */
export const DRIVE = {
  reach: 4.5,
  wreck: 0.25,
  board: 0.55,
  turn: 0.9,
  /** How much of its own pace a machine gives a driver, forward and reversing. */
  drive: 1.0,
  reverse: 0.45,
  /** Where the gun may be pointed, off the hull's nose, in radians. */
  arc: Math.PI * 0.85,
  gunTurn: 2.2,
  /** Seconds between shells, over and above the archetype's own fire rate. */
  gap: 0.25,
};

/** Everything the crew compartment of a machine is worth knowing. */
export function crewOf(type) { return ARCHETYPES[type]?.crew ?? 0; }

/** Is this a machine with somebody in it, rather than a droid? */
export function isCrewed(enemy) { return !!enemy && crewOf(enemy.type) > 0; }

/**
 * WHY YOU MAY OR MAY NOT TAKE THIS ONE — a reason, never a bare false.
 *
 * Every refusal in this game says which of its reasons it was (see
 * `Player._refuse`), and a control that silently does nothing when you are
 * standing next to a tank is the exact shape of defect the Force keys were
 * full of before that method existed. So this hands back a string, and the
 * caller prints it.
 */
export function whyNotDrive(world, player, enemy) {
  if (!enemy || enemy.dead) return 'there is nothing there to take';
  if (!isCrewed(enemy)) {
    return `${enemy.A?.label ?? 'it'} is a droid — the brain is the machine, and there is no seat in it`;
  }
  if (enemy.driven) return 'somebody already has the controls';
  if (enemy.legsLost >= 3) return 'it has no legs left to drive it on';
  const mine = enemy.team === player.team;
  if (!mine && enemy.hp > enemy.maxHp * DRIVE.wreck) {
    return `its crew is alive and shooting — put it under ${Math.round(DRIVE.wreck * 100)}% first`;
  }
  const d = Math.sqrt(hullDistanceSq(enemy, player));
  if (d > DRIVE.reach) return `too far from the hull — ${d.toFixed(1)} m`;
  return null;
}

/**
 * How far a body is from the HULL of a machine, squared.
 *
 * Not centre to centre: an AT-TE is thirteen metres long and a Juggernaut
 * twenty-five, so a centre-to-centre reach that let you board one from the nose
 * would let you board it from forty metres away at the tail. The bounding
 * radius is the machine's own, off the physics body it already carries.
 */
export function hullDistanceSq(enemy, actor) {
  const r = enemy.radius ?? 0.5;
  const d = Math.max(0, Math.sqrt(enemy.position.distanceToSquared(actor.position)) - r);
  return d * d;
}

/**
 * The machine this player could take the controls of, or null.
 *
 * Nearest hull first, and it deliberately returns a machine it will then refuse
 * — `whyNotDrive` is what decides, and a picker that filtered the refusable
 * ones out would leave the player standing next to an enemy tank with nothing
 * on screen telling them why they cannot have it.
 */
export function drivableNear(world, player) {
  if (!world?.enemies) return null;
  let best = null, bestD = Infinity;
  for (const e of world.enemies) {
    if (e.dead || !isCrewed(e) || e.driven) continue;
    const d = hullDistanceSq(e, player);
    if (d < bestD && d <= DRIVE.reach * DRIVE.reach) { bestD = d; best = e; }
  }
  return best;
}

/**
 * ONE PLAYER, AT THE CONTROLS OF ONE MACHINE.
 *
 * Held on the player as `player.driving` and on the vehicle as `vehicle.driven`
 * — both, because both sides have readers and neither can derive the other
 * cheaply: `Enemy.update` runs before `Player.update` and has to know inside
 * its own frame, and `Player.damage` has to know without walking the roster.
 * `leave()` is the only thing that clears either, so they cannot drift.
 */
export class Crew {
  constructor(player, vehicle) {
    this.player = player;
    this.vehicle = vehicle;
    this.world = player.world;
    this.t = 0;
    /** Where the gun is pointed, as a world heading. Starts down the nose. */
    this.gun = vehicle.facing;
    this.fireT = 0;
    /* WHOSE MACHINE IT IS NOW. A tank you have taken is on your side for as
     * long as you are in it, which is the whole point of taking it: your own
     * line must stop shooting at it and it must stop shooting at them. Put
     * back in `leave`, so a machine you abandon goes back to whoever owned it
     * and the player cannot launder a tank by sitting in it for a second. */
    this.wasTeam = vehicle.team;
    this.wasSpeed = vehicle.speed;
    vehicle.team = player.team;
    vehicle.driven = this;
    vehicle.stopFiring?.();
    player.driving = this;
    /* THE BLADE GOES AWAY, because both hands are on the controls. Not
     * `_dropSaber` — you are not putting your weapon on the floor of a tank,
     * you are hanging it on your belt — so this is the same `retract` +
     * `setVisible(false)` pair `_dropSaber` uses WITHOUT `saberDown`, and
     * `leave` lights it again if it was lit. */
    this.wasLit = !!player.saber?.lit;
    player.saber?.retract();
    player.saber?.setVisible(false);
    player.hum?.retract?.();
    /* Anything the Force was doing is over: you cannot hold a droid off the
     * ground and drive a tank, and a stasis field left running from inside a
     * hull is a field nobody can see the edge of. */
    player.releaseGrip?.();
    player._abandonStasis?.();
    if (player.senseActive) player.toggleSense?.(this.world);
    if (player.shield?.up) player._endShield?.('you took the controls');
    audio.thud?.(vehicle.position, 0.9);
    this.world?.notify?.('AT THE CONTROLS',
      `${vehicle.A?.label ?? 'the machine'} — ${crewOf(vehicle.type)} crew, and you are all of them`);
  }

  /** Where the driver sits, in world space: on top of the hull, at the nose. */
  seat(out = _v1) {
    const v = this.vehicle;
    const s = v.A?.scale ?? 1;
    return out.set(
      v.position.x + Math.sin(v.facing) * 0.35 * s,
      v.position.y + (v.chestY ?? 1.4),
      v.position.z + Math.cos(v.facing) * 0.35 * s);
  }

  /**
   * ONE FRAME AT THE CONTROLS. Called from `Player.update` BEFORE the player's
   * own movement, and it returns true when it owned the frame.
   *
   * The order matters and is the reverse of the obvious one: the machine is
   * driven from the input here, and the PLAYER is then parked on it. Doing it
   * the other way — moving the player and dragging the tank after them — is
   * how you get a body that clips through its own hull on every corner, and it
   * throws away the machine's grade limit, its legs and its collision.
   */
  update(dt, ctx) {
    const v = this.vehicle;
    const p = this.player;
    const input = ctx.input;
    this.t += dt;
    this.fireT = Math.max(0, this.fireT - dt);

    /* THE THREE WAYS THIS ENDS THAT ARE NOT THE PLAYER PRESSING THE KEY. */
    if (v.dead || v.hp <= 0) { this.leave('the machine is finished'); return true; }
    if (!p.alive) { this.leave(null); return true; }
    if (v.legsLost >= 3) { this.leave('it has lost too many legs to drive'); return true; }

    /* ── steering. The move axis is a tank's, not a man's: forward and back on
     * one stick and the HULL on the other, because a twenty-five-metre machine
     * does not strafe. */
    const axis = input.moveAxis ? input.moveAxis(_axis) : { x: 0, y: 0 };
    const throttle = clamp(axis.y, -1, 1);
    const steer = clamp(axis.x, -1, 1);
    if (steer) v.facing = wrapAngle(v.facing - steer * DRIVE.turn * dt);
    if (Math.abs(throttle) > 0.05) {
      _v2.set(Math.sin(v.facing), 0, Math.cos(v.facing)).multiplyScalar(Math.sign(throttle));
      v.wish = _v2.clone();
      v.speed = this.wasSpeed * (throttle > 0 ? DRIVE.drive : DRIVE.reverse) * Math.abs(throttle);
    } else {
      v.wish = null;
      v.speed = this.wasSpeed;
    }

    /* ── the gun. It turns faster than the hull and it is limited to an arc off
     * the nose, which is the difference between driving a tank and pointing
     * one. A machine whose gun could come all the way round would never need
     * to be steered at all. */
    this._aimGun(dt, ctx);

    if (input.act && input.act('thrust') && this.fireT <= 0) this.fire(ctx);

    return true;
  }

  /**
   * THE DRIVER RIDES — called from `Enemy.update`'s driven branch, after the
   * machine has moved, and not from `Player.update`, which runs a step earlier.
   *
   * `position` is the seat and `velocity` is the machine's, so a fall, a
   * landing and every reader of "how fast is this player going" gets the truth
   * rather than a body standing still on a moving hull.
   */
  ride() {
    const p = this.player;
    this.seat(p.position);
    p.velocity.copy(this.vehicle.velocity);
    p.grounded = true;
    p.body?.position?.copy(p.position);
  }

  /**
   * WHERE THE GUN IS POINTED, and it is a heading rather than a vector on
   * purpose: `Enemy._shoot` wants a world point to aim at, the hull's arc is an
   * angle, and keeping both in the same currency is what makes the clamp one
   * line instead of three cross products.
   */
  _aimGun(dt, ctx) {
    const v = this.vehicle;
    const want = Math.atan2(this.player.aimDir.x, this.player.aimDir.z);
    let d = wrapAngle(want - this.gun);
    const step = DRIVE.gunTurn * dt;
    this.gun = wrapAngle(this.gun + clamp(d, -step, step));
    /* …and it cannot come further round than the arc. Clamped against the HULL
     * every frame rather than at the moment of firing, so the player can see
     * the gun stop instead of pressing the trigger and being told no. */
    const off = wrapAngle(this.gun - v.facing);
    if (Math.abs(off) > DRIVE.arc) this.gun = wrapAngle(v.facing + Math.sign(off) * DRIVE.arc);
  }

  /** Where the gun is looking, as a point far enough out to aim at. */
  aimPoint(out = _v3) {
    const v = this.vehicle;
    return out.set(
      v.position.x + Math.sin(this.gun) * 60,
      v.position.y + (v.chestY ?? 1.4) + this.player.aimDir.y * 60,
      v.position.z + Math.cos(this.gun) * 60);
  }

  /**
   * PULL THE TRIGGER — through the machine's own `_shoot`, which is the whole
   * reason a driven vehicle feels like the vehicle you were just fighting.
   *
   * Its damage, its bolt colour, its muzzle, its spread, its shell length and
   * its sound all come off the archetype, so a player who takes an AAT gets the
   * AAT's two-shell ripple at 52 a shell and not a generic gun. `telegraphAim`
   * is the field `_shoot` already uses for a committed shot: set it and the
   * bolt goes down the line the gun is on rather than being led onto a target
   * the crew does not have.
   */
  fire(ctx) {
    const v = this.vehicle;
    const A = v.A;
    const at = this.aimPoint().clone();
    const wasTarget = v.target;
    const wasAim = v.telegraphAim;
    v.target = { position: at, chest: at };
    v.telegraphAim = at;
    v._shoot(ctx);
    v.target = wasTarget;
    v.telegraphAim = wasAim;
    /* The machine's own cadence, and the floor under it. `fireRate` is seconds
     * between BURSTS for the AI, which for an AT-TE is 4.6 — an eternity with a
     * finger on the trigger — so a driver gets the burst gap instead, with
     * `DRIVE.gap` as the floor so nothing here becomes a machine gun. */
    this.fireT = Math.max(DRIVE.gap, A?.burstGap ?? DRIVE.gap);
    this.player.camera?.addShake?.(A?.big ? 0.35 : 0.2);
  }

  /**
   * OUT. Idempotent, and it puts back every field it borrowed.
   *
   * The player is set down BESIDE the hull rather than inside it, on the side
   * the machine is not facing, because a body left at the seat is a body inside
   * the collision of a thirteen-metre tank on the next frame.
   */
  leave(why = null) {
    const v = this.vehicle;
    const p = this.player;
    if (p.driving !== this && v.driven !== this) return false;
    v.team = this.wasTeam;
    v.speed = this.wasSpeed;
    v.wish = null;
    v.driven = null;
    v.telegraphAim = null;
    p.driving = null;
    /* Down and to the left of the nose, clear of the hull by its own radius. */
    const r = (v.radius ?? 1) + 1.2;
    _v2.set(Math.sin(v.facing + Math.PI / 2), 0, Math.cos(v.facing + Math.PI / 2)).multiplyScalar(r);
    p.position.copy(v.position).add(_v2);
    const gh = this.world?.terrain?.height?.(p.position.x, p.position.z);
    if (Number.isFinite(gh)) p.position.y = gh;
    p.body?.position?.copy(p.position);
    p.velocity.set(0, 0, 0);
    p.grounded = false;
    if (p.saber) {
      p.saber.setVisible(!p.saberDown);
      if (this.wasLit && !p.saberDown) { p.saber.ignite(); p.hum?.ignite?.(); }
    }
    if (why) this.world?.notify?.('OUT', why);
    audio.thud?.(p.position, 0.5);
    return true;
  }
}

const _axis = { x: 0, y: 0 };

function wrapAngle(a) {
  while (a > Math.PI) a -= TAU;
  while (a < -Math.PI) a += TAU;
  return a;
}
