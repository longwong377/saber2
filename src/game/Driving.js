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
 * of bodies it seats, and the presence of that number is the whole rule. There
 * is no second list of drivable things to fall out of step with it — including
 * for the three mounts, which seat exactly one body and say so with the same
 * field. See the mount section below.
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
 *
 * ── AND THE THING YOU GET ON IS NOT ALWAYS A MACHINE ─────────────────────
 *
 * The player, in the companion list, three times over: *"a Tauntaun you
 * ride/mount"*, *"a Blurgg you ride/mount"*, *"a Varactyl you ride/mount"*.
 * Three of the twelve companion kinds exist ONLY to be got on, and until this
 * pass riding was not in the game at all while three separate surfaces said it
 * was — the Kennel card ("You can ride this one."), three Databank entries and
 * the tauntaun's own blurb.
 *
 * IT IS THIS FILE AND NOT `Riders.js`, and COMPANIONS.md argues that at length.
 * `Riders.crew()` is the only door into that pack's `bound` map, it can only
 * `spawnEnemy` a FRESH body out of `ARCHETYPES[A.saddle]` — there is no bind
 * for a body that already exists — and nothing in its update suppresses
 * `Player._move`, so a player written to a seat there is walked straight off it
 * on the next frame. `Crew` is already the right skeleton: both pointers, the
 * seat written from `Enemy.update`'s driven branch rather than the player's own
 * tick, throttle and steering off `input.moveAxis`, `Player.damage` rerouted
 * into the body underneath you, and four clean exits including the thing dying
 * under you.
 *
 * SO THERE IS NO SECOND BOARDING VERB AND NO SECOND RULE. A mount declares
 * `crew: 1` like everything else with a seat in it, so `whyNotDrive`,
 * `drivableNear`, the `drive` binding, `Player.takeControls` and
 * `HUD._drivePrompt`'s live board prompt with its refusal reason all reach it
 * with not one line changed. What `A.mount` is for is the four places an animal
 * is genuinely NOT a machine, and they are all in this file bar one:
 *
 *   · `seat()` sits you on the measured platform behind the shoulders instead
 *     of at the nose on `chestY` — a saddle, not a cupola;
 *   · `update()` turns at the animal's own `steer` rate instead of a
 *     twenty-five-metre hull's 0.9 rad/s;
 *   · `fire()` REFUSES OUTRIGHT. A tauntaun is not a gun platform, it has no
 *     trigger, and the blade is on your belt while you are on it — which is the
 *     whole trade riding is: the map gets smaller and you arrive unarmed;
 *   · and the boarding notice says what you got on rather than counting a crew.
 *
 * The fifth is `Enemy._measurePlatform`'s gate, which reads `A.mount` beside
 * `A.big` for the reason its own note gives.
 *
 * WHAT RIDING DOES NOT CHANGE is everything that makes it your animal: it is
 * still adopted by the companion pack, still under whatever order you gave it,
 * still taking the friendly-fire discount, and still yours when you get off.
 * The one thing the pack has to learn is to keep its hands off the wish while
 * somebody is steering — see the note on `installCompanionMove`.
 */

import * as THREE from '../../vendor/three/three.module.js';
import { ARCHETYPES } from './Enemy.js';
import { throwClear, THROWN } from './Riders.js';
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
  /** The fallback turn rate, and every machine on the roster takes it. An
   *  ANIMAL declares its own `steer` — see `update` and the note over
   *  COMPANION_UNITS, which argues the three numbers as turning radii. */
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
  /**
   * NOT FROM A JOINING PLAYER'S SEAT, AND THE REFUSAL IS THE FIX.
   *
   * Nothing in this file asked `netMode`, and taking the controls off-host was
   * not a desync — it was a soft-lock, measured on two real Worlds over the
   * pair harness (`tools/_netrubble.mjs`):
   *
   *   · the guest boards, `Crew` retracts and hides the blade, and
   *     `Player.update` hands every frame to `Crew.update` from then on;
   *   · `Enemy.update` takes the `netDriven` branch BEFORE the `driven` one on
   *     a client, so the machine is still being written by the host's snapshot
   *     — the guest's throttle and steering reach nothing, and `Crew.ride`,
   *     which is called from the `driven` branch, never runs;
   *   · so the driver is never seated. Measured over six seconds at full
   *     throttle: the guest's body moved **0.00 m**, ended **3.58 m** from a
   *     hull it was supposed to be sitting on, and had no blade;
   *   · and the host was never told, so its copy stayed on the horde's team
   *     with its brain running and went on shooting at the player sitting in
   *     it. Only pressing the key a second time got them out.
   *
   * Replicating the seat is a real feature — a claim carrying the driver's
   * throttle, steering and gun heading, and the host driving the machine with
   * it — and it is not this pass. What IS this pass is that the game stops
   * offering a control that cannot work: `HUD` prints this string over the
   * machine and `Player.takeControls` refuses with it, which is the same way
   * every other refusal in this file reaches the player.
   */
  if (world?.netMode === 'client') {
    return 'the controls answer to whoever is hosting — you cannot take them from here';
  }
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
    /* AND THE NOTICE SAYS WHAT YOU GOT ON. "1 crew, and you are all of them" is
     * the right sentence about an AAT with a hatch and a silly one about an
     * animal, and this is the one place in the file where the difference is
     * cosmetic rather than mechanical — which is exactly why it is worth
     * getting right: the boarding notice is the first thing the feature ever
     * says to the player. */
    if (vehicle.A?.mount) {
      this.world?.notify?.('UP',
        `${vehicle.A?.label ?? 'it'} — your hands are on the reins and your blade is on your belt`);
    } else {
      this.world?.notify?.('AT THE CONTROLS',
        `${vehicle.A?.label ?? 'the machine'} — ${crewOf(vehicle.type)} crew, and you are all of them`);
    }
  }

  /**
   * Where the driver sits, in world space: on top of the hull, at the nose.
   *
   * `v.chestY` IS AN ABSOLUTE WORLD HEIGHT and this added it to `position.y`,
   * so the terrain under the machine was counted twice: a tank parked 4 m up a
   * slope seated its driver 4 m in the air, and `aimPoint` below put the gun's
   * aim on the same doubled height. `chestY` is `position.y + 1.15 * bodyScale`
   * — see Enemy.js — so the height IS the answer and nothing may be added to
   * it. The 1.4 stays as the fallback for a machine with no chest at all, and
   * it is now a fallback for the whole expression rather than for half of it.
   */
  seat(out = _v1) {
    const v = this.vehicle;
    const s = v.A?.scale ?? 1;
    /**
     * ── AND A SADDLE IS MEASURED, NOT GUESSED ────────────────────────────
     *
     * `Enemy._measurePlatform` already answers "where is the flat part of this
     * body you could stand on" off the BUILT GEOMETRY — the highest vertex
     * inside the central 60% of the torso's own footprint, bobbing with the
     * gait because it hangs off the hips bone. That is a better answer than
     * `chestY` for anything that publishes one, and for a mount it is the only
     * honest one: measured on a live world, the three animals' backs sit 2.59 /
     * 2.96 / 1.86 m over their own position and `chestY` is 0.92 / 1.00 / 0.31
     * m away from that — a rider hanging most of a metre off a tauntaun.
     *
     * BEHIND THE SHOULDERS AND NOT AT THE NOSE. `+0.35·scale` down the facing
     * is a driver's cupola on a hull; a saddle sits BACK, which is the same
     * offset `Riders.crew` picks for the body it puts on a reek. Machines keep
     * the nose, because that is where their cupola is and it is what the tank
     * checks were measured against.
     */
    const plat = v.A?.mount ? v.platform?.() : null;
    const fore = plat ? -0.34 * s : 0.35 * s;
    return out.set(
      v.position.x + Math.sin(v.facing) * fore,
      plat ? plat.position.y + plat.extent.y : (v.chestY ?? (v.position.y + 1.4)),
      v.position.z + Math.cos(v.facing) * fore);
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
    /* THE ANIMAL'S OWN RATE IF IT HAS ONE. One reader, one fallback — see
     * DRIVE.turn, and the mount rows, which argue theirs as turning radii. */
    const rate = v.A?.steer ?? DRIVE.turn;
    if (steer) v.facing = wrapAngle(v.facing - steer * rate * dt);
    if (Math.abs(throttle) > 0.05) {
      _v2.set(Math.sin(v.facing), 0, Math.cos(v.facing)).multiplyScalar(Math.sign(throttle));
      v.wish = _v2.clone();
      /**
       * ── AND `toTarget` IS WHERE THE DRIVER IS GOING, WHICH COST 30% OF THE
       *    PACE OF EVERYTHING EVER DRIVEN ────────────────────────────────
       *
       * `_move` ends with `if (this.toTarget) limitBackpedal(_v1, this.toTarget)`
       * — nobody backpedals as fast as they run, and the AI writes `toTarget`
       * every frame from `_think`. A DRIVEN body never reaches `_think`, so
       * whatever heading the brain last wanted stays on the field and the
       * driver's throttle is measured against it. Point the machine away from
       * where its brain was last looking and the limiter takes the away
       * component at BACKPEDAL for the whole run.
       *
       * Measured on a live tauntaun at full throttle in a straight line, with
       * `speed` at its own 5.90 m/s: the body plateaued at **4.11 m/s** — 70%
       * of it, on flat ground with nothing in the way — which was the whole
       * reason a ridden mount lost a ten-second race to the player's own legs
       * (15.6 m against 18.2). It is the same defect on every machine in the
       * game and has been since the day driving landed; a tank whose brain had
       * been walking north drove south at two thirds of its pace.
       *
       * Written rather than cleared, because `toTarget` is a UNIT HEADING the
       * brain also steers with and a null is a different statement. Its own
       * vector rather than a shared scratch, for `_toBuf`'s reason one file
       * over: handing a per-frame temporary to a field somebody else reads next
       * frame is the aliasing defect this codebase has already paid for once.
       * And reversing stays slower — that is `DRIVE.reverse` on the line above,
       * priced once and deliberately, instead of twice by accident.
       */
      v.toTarget = (this._to || (this._to = new THREE.Vector3())).copy(_v2);
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
      (v.chestY ?? (v.position.y + 1.4)) + this.player.aimDir.y * 60,
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
    /**
     * ── AND AN ANIMAL HAS NO TRIGGER, WHICH IS REFUSED OUT LOUD ──────────
     *
     * Everything below this line goes through the machine's own `_shoot` — its
     * damage, its bolt colour, its muzzle, its shell length. A tauntaun has
     * none of those, so on a body with no `weapon` and no `ranged` the call
     * would either do nothing at all or, worse, fire whatever the beast's
     * default happens to be from a body the player is sitting on.
     *
     * SILENCE IS THE DEFECT, NOT THE FIX. A bound key that does nothing and
     * does not say why is the same lie `Player._refuse` was written for — its
     * own note says so — so this refuses the way every Force key refuses, rate
     * limited to one notice every 0.7 s because a held trigger is sixty
     * refusals a second. The sentence is the trade riding IS: your blade is on
     * your belt, both hands are on the reins, and arriving somewhere is the
     * whole of what you bought.
     */
    if (A?.mount) {
      this.player._refuse?.('fire', `${A.label ?? 'it'} is not a gun — your blade is on your belt`);
      this.fireT = Math.max(this.fireT, DRIVE.gap);
      return false;
    }
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
    /* …AND THE HEADING THE DRIVER WAS STEERING WITH GOES BACK TOO. `update`
     * writes `toTarget` so the backpedal limiter measures the throttle against
     * the driver's own intent rather than against whatever the brain last
     * wanted; left behind, it is a stale unit vector aliased into a Crew that
     * no longer exists, and the body walks away from it at BACKPEDAL until its
     * brain next picks a target. Nulling is what a body with nothing in mind
     * already looks like — `_move` guards on `if (this.toTarget)`. */
    v.toTarget = null;
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

  /**
   * THROWN OFF, WHICH IS A DIFFERENT EVENT FROM CLIMBING DOWN.
   *
   * The tauntaun's card has always said *"above a threshold it bucks you off
   * and bolts"* and until this pass the word "buck" occurred nowhere in `src/`
   * except inside "bucket". This is the half of that sentence the seat owns;
   * the threshold and the bolt are the companion pack's — see `PANIC` in
   * Companions.js, which is the only caller.
   *
   * IT IS `leave` PLUS MOMENTUM AND NOTHING ELSE, because everything that makes
   * getting off safe is already in `leave`: the team, the pace, the wish and
   * both pointers are put back, the blade comes off your belt and lights again
   * if it was lit, and you are set down clear of the body rather than inside
   * its collision. A second exit that did any of that itself would be the two
   * copies of one rule this file keeps deleting.
   *
   * AND THE NUMBERS ARE `Riders.THROWN`, not four fresh ones. A B2 whose reek
   * was killed under it and a player whose tauntaun has had enough are the same
   * event seen from two saddles: 0.8 of the mount's own momentum, 2.6 m/s up,
   * 2.4 m/s out along its facing. The stun is spent in the player's currency
   * rather than the enemy's — `staggerTimer`, because Player.js:4087's rule is
   * that a player is never taken off the controls — and 0.7 s of it at the
   * ×0.35 the stagger already costs a walk is enough to matter and short enough
   * not to be a cutscene.
   */
  throwRider(why = null) {
    const v = this.vehicle;
    const p = this.player;
    if (!this.leave(why)) return false;
    throwClear(p, v, v.facing ?? 0);
    p.staggerTimer = Math.max(p.staggerTimer ?? 0, THROWN.stun);
    audio.thud?.(p.position, 0.9);
    return true;
  }
}

const _axis = { x: 0, y: 0 };

function wrapAngle(a) {
  while (a > Math.PI) a -= TAU;
  while (a < -Math.PI) a += TAU;
  return a;
}
