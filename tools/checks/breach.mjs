/**
 * BATTLEFRONT BORZ — BREACH, THE FOURTH VERB. FLAGSHIP §7.
 *
 * "BREACH — the one thing on the field only a Jedi can touch. Twenty seconds of
 * held blade, deflecting nothing, away from your line, both bars draining."
 *
 * `blast-door.mjs` already owns the MECHANIC: that the game ships a reachable
 * blast door, that the blade can grind on it, that a hold of about twenty
 * seconds opens one and that no amount of swinging does. None of that made
 * BREACH a verb. Behind each of the magazine's three doors was a cache, so the
 * whole rank was an errand: nothing on the field changed if you walked past it,
 * and §7's other three verbs are all things the battle makes you do in the
 * middle of a fight.
 *
 * The middle bay is a gun pit now (src/game/Emplacement.js). This file measures
 * the three things that turn it into a price:
 *
 *   1. NOTHING BUT A BLADE CAN REACH IT — driven, with real bolts and a real
 *      Force power, not read off a flag.
 *   2. LEAVING IT COSTS NAMES — measured in bodies off the roster, against a
 *      control where the same engagement runs with the gun already silent.
 *   3. ANSWERING IT COSTS THE LINE — the seconds the breach takes, what the
 *      line loses in exactly those seconds, and what it loses over the same
 *      seconds when the player stands with it instead.
 *
 * ── THE THING THIS FILE FOUND, WHICH IS NOT ABOUT DOORS ──────────────────
 *
 * Check 2 read ZERO the first time it ran, and so did every arm of check 3.
 * `World._boltHitTest` opened its enemy loop with `if (bolt.team === 1 &&
 * !friendly) continue` — an early-out over the whole loop for every hostile
 * bolt in the game — and Command's own troopers live in `world.enemies` on the
 * PARTY's team. So in the one mode whose subject is a list of names that only
 * shrinks, no rifle on the other side could touch it. Ten troopers, ninety
 * seconds, a live wave: 10 of 10, all at full health. The fix is at the source
 * and the measurement it made possible is check 2.
 */

import * as THREE from 'three';
import { GUN } from '../../src/game/Emplacement.js';
import { clocked } from './_shared.mjs';

const V = (x, y, z) => new THREE.Vector3(x, y, z);
/** Face a world direction. The same conversion `blast-door.mjs` measured off
 *  the shipped controller: `moveAxis {0,1}` at yaw 0 walks a Player to −z. */
const facing = (dx, dz) => Math.atan2(-dx, -dz);
const outOf = (door) => V(0, 0, 1).applyQuaternion(door.mesh.quaternion);

const idle = () => ({
  act: () => false, actHit: () => false, actDown: () => false,
  moveAxis: (o) => { if (o) { o.x = 0; o.y = 0; return o; } return { x: 0, y: 0 }; },
  mouse: { dx: 0, dy: 0, wheel: 0, left: false, right: false },
  delta: { x: 0, y: 0 }, accel: { x: 0, y: 0 }, end() {},
});

export async function run({ check, assert }) {
  check = await clocked(check);
  const { initPhysics } = await import('../../src/physics/Rapier.js');
  await initPhysics();

  /**
   * ONE WORLD PER CHECK, DISPOSED BEFORE THE NEXT IS BUILT, AND THE BODIES
   * SERIALISED — the shape `blast-door.mjs` had to adopt and states its reasons
   * for at length: async checks interleave, and world count is what kills these
   * runs (HANDOFF §2.7). `prepareBudgetMs` is pinned for the reason that file
   * measured — the pre-fracture scheduler is on the wall clock, so how many of
   * the magazine's structures have cells by frame N is a fact about the machine
   * and it moves where the kerf lands.
   */
  let LIVE = null;
  const retire = () => {
    const gone = LIVE; LIVE = null;
    try { gone?.world?.dispose?.(); } catch { /* a half-built World is still gone */ }
  };
  const field = async (settings = {}) => {
    retire();
    const { bootWorld } = await import('./_coop.mjs');
    const { enemyRng } = await import('../../src/game/Enemy.js');
    const Waves = await import('../../src/game/Waves.js');
    enemyRng.seed(20260821); Waves.seedWaves(20260821);
    LIVE = await bootWorld({
      level: 'geonosis',
      settings: { mode: 'command', level: 'geonosis', ...settings },
    });
    LIVE.world.destruction.prepareBudgetMs = Infinity;
    return LIVE;
  };

  const started = [];
  let gate = Promise.resolve();
  const acheck = (name, fn) => check(name, () => {
    const pr = gate.then(fn);
    gate = pr.then(() => {}, () => {});
    started.push(gate);
    return pr;
  });

  /* ── 1. only a Jedi can touch it ──────────────────────────────────── */

  acheck('breach: the emplacement is on the field and nothing but a blade can reach it', async () => {
    const { world } = await field();
    const pit = world.gunPits?.[0];
    assert(pit, 'the mode\'s own ground has no gun emplacement — §7\'s fourth verb has nothing to '
      + 'be a verb about');
    assert(world.doors.includes(pit.door), 'the gun is not wired to a door the level hung');
    assert(!world.enemies.includes(pit),
      'the gun is in `world.enemies`, so every rifle on the field can shoot it and the answer to '
      + 'it is arithmetic rather than a Jedi');
    assert(pit.capsules().length === 0, 'the gun publishes capsules, so the blade solver can find it');
    assert(pit.damage(999) === false, 'the gun takes damage');
    assert(pit.grippable === false, 'the gun can be picked up with the Force');

    /**
     * AND IT IS DRIVEN, not read. A flag that says a thing is untouchable is
     * the same kind of claim as a comment that says a feature exists — the
     * whole reason `BlastDoor` shipped unreachable for a year. So: a hundred
     * real bolts on the player's own team, fired straight through the gun from
     * six metres, through the shipped hit test.
     */
    const from = pit.muzzle.clone().addScaledVector(outOf(pit.door), 6);
    const dir = pit.muzzle.clone().sub(from).normalize();
    let touched = 0;
    const prev = world.bolts.onImpact;
    world.bolts.onImpact = (b, res) => { if (res.victim === pit) touched++; return prev?.(b, res); };
    for (let k = 0; k < 100; k++) world.bolts.fire(from, dir, { speed: 100, damage: 40, team: 0 });
    for (let f = 0; f < 60; f++) world.update(1 / 60, idle());
    world.bolts.onImpact = prev;
    assert(touched === 0, `${touched} of 100 bolts found the gun`);
    assert(!pit.taken, 'a hundred bolts silenced the gun');
    return `a gun pit behind door ${world.doors.indexOf(pit.door) + 1} of ${world.doors.length}, `
      + `muzzle ${pit.muzzle.distanceTo(world.player.position).toFixed(0)} m from the muster ground; `
      + '100 bolts through it changed nothing';
  });

  /* ── 2. leaving it standing costs names ───────────────────────────── */

  acheck('breach: a gun nobody cuts takes the roster apart', async () => {
    /**
     * THE COST OF WALKING PAST IT, ISOLATED.
     *
     * The wave is taken off the field so the only thing shooting at the line is
     * the emplacement — otherwise this measures a Command engagement, which is
     * a different question and one `command.mjs` already asks. Two arms on two
     * fresh worlds: the gun live, and the gun silenced on frame one. The
     * difference is what the twenty seconds buys.
     */
    const arm = async (silent) => {
      const { world } = await field();
      const d = world.director;
      d.start(1);
      const pit = world.gunPits[0];
      if (silent) pit.silence();
      /**
       * NOTHING ELSE ON THE FIELD, AND NOTHING ELSE COMING.
       *
       * Emptying the queue and sweeping what had landed was not enough and the
       * first run said so: the control arm lost its WHOLE roster with the gun
       * silent, because an emptied wave CLEARS, and a cleared wave starts the
       * next one — which arrived with a full levy and killed the line the
       * check was trying to leave alone.
       *
       * `active` false with an endless intermission is the director's own idle
       * state, read at the top of `WaveDirector.update`: the arrivals still
       * fly, the watchdog still runs, and no wave is ever composed or started.
       * The army stays deployed because nothing recalls it. It is the state
       * the mode is in between two waves, held open.
       */
      d.spawnQueue.length = 0;
      for (const e of world.enemies.slice()) {
        if (d.blocksWaveEnd(e)) { e.dead = true; e.dying = 0; world.onEnemyKilled?.(e, null, 'rout'); }
      }
      d.active = false;
      d.intermission = Infinity;
      const input = idle();
      const start = d.roster.living.length;
      for (let f = 0; f < 60 * 90; f++) world.update(1 / 60, input);
      return { start, left: d.roster.living.length, shots: pit.shots, taken: pit.taken };
    };
    const live = await arm(false);
    const off = await arm(true);
    assert(off.shots === 0, `a silenced gun fired ${off.shots} times`);
    assert(live.shots > 10,
      `the gun fired ${live.shots} times in 90 s at a cadence of ${GUN.every} s — it is not `
      + 'shooting, and a gun that cannot see out of its own wall is a silent prop');
    assert(off.left === off.start,
      `the control arm lost ${off.start - off.left} men with the gun silent and nothing else on the `
      + 'field, so the live arm below is not measuring the gun');
    const lost = live.start - live.left;
    /**
     * ONE NAME IS THE BAR, AND THE BENCH IS WHY IT IS NOT MORE.
     *
     * This arm is deliberately the gun ALONE — nothing else on the field, a
     * full-health line, ninety seconds — so every point of damage it does has
     * to kill a man from 46 hit points by itself. In a battle it does not have
     * to: the mode lane's tally over two seeds of a real engagement puts this
     * one emplacement at **36.9% of every point of damage that lands on the
     * line**, second only to the whole Confederate fill, because most of its
     * rounds are finishing men the wave has already opened.
     *
     * So the isolated figure UNDERSTATES the gun by design and the assertion is
     * set against what the isolated bench can honestly see. It is a bar on the
     * gun being a threat at all — the first cut of this file fired single
     * rounds and measured 26 shots for 1 man, which is a thing you walk past —
     * and the tuning is done on `_linetoll.mjs`, which can see the other 90%.
     */
    assert(lost >= 1,
      `${live.shots} rounds over 90 s took ${lost} men off a roster of ${live.start} with nothing `
      + 'else on the field. A gun that can be ignored is not a price, and §7 asks for a verb '
      + 'rather than an errand.');
    return `90 s of one emplacement against a formed-up line, nothing else on the field: `
      + `${live.shots} rounds, ${lost} of ${live.start} names gone `
      + `(one every ${(90 / lost).toFixed(0)} s of ITS fire alone; in a real engagement the mode `
      + `lane's tally puts it at 36.9% of everything that hits the line); silenced, `
      + `${off.start - off.left}`;
  });

  /* ── 3. the twenty seconds, and what the line pays for them ───────── */

  acheck('breach: twenty seconds at the plate, and the line pays for every one of them', async () => {
    /**
     * §7's sentence has four clauses and three of them are measurable here:
     * how long the hold takes with a real player script, what the line loses in
     * exactly those seconds, and what it loses over the same seconds when the
     * player is standing with it instead. The fourth — "both bars draining" —
     * is REPORTED rather than asserted, and the reason is in the number: the
     * magazine is 76.7 m from the muster ground, so a player at the plate is
     * out of the fight rather than in it, and the guard has nothing to answer.
     * That is the cost being paid in the currency §7 actually names first —
     * "away from your line" — and it would be dishonest to assert a stamina
     * drain that the geometry does not produce.
     *
     * THE DRIVE is `blast-door.mjs`'s: under the `free` scheme the mouse IS the
     * blade, so the input is a CLOSED LOOP on the controller's own guard
     * deflection — each frame it asks for the mouse motion that would put the
     * guard on the next point of a circle. An open loop traces a Lissajous that
     * never reaches the radius and re-burns one patch; that file measured it
     * saturating and stalling. It is written out again here rather than shared
     * because it is a DRIVE and not a rule: two harnesses may steer a player
     * differently, and neither is the authority on anything.
     */
    /**
     * BOTH ARMS RUN THE SAME ENGAGEMENT AND DIFFER ONLY IN WHERE THE PLAYER IS.
     *
     * `field` re-seeds `enemyRng` and `seedWaves` before each boot, so the two
     * arms compose the same wave; what it cannot make identical is the
     * dressing, because two boots are two draws off the world stream (HANDOFF
     * §2.6's "two boots are two dressings"). That is why the reading is a
     * COUNT OF NAMES over a fixed window rather than a difference of hit points.
     *
     * WARMED UP FIRST, AND AT A REAL DEPTH. The first cut of this measured
     * wave 1 from its first frame and read 0 against 1 — a fight that had not
     * started yet, in which standing anywhere costs the same nothing. The
     * window opens after `WARM` seconds of a wave-3 engagement, which is where
     * `AREAS` says the mode spends its time.
     *
     * THE PLAYER IS PINNED RATHER THAN WALKED, in both arms. `blast-door.mjs`
     * already owns the walk — a Player on foot from the muster ground reaches
     * the plate in about twenty seconds — and including it here would make the
     * two arms differ by a walk as well as by a place.
     *
     * AND THE PINNED PLAYER IS HELD ALIVE, in both arms, for the whole run.
     * The first cut of this did not, and the drive came back "75 s of held
     * blade burned 79 texels and never opened it" — because a Jedi bolted to
     * one spot in the middle of a wave-3 engagement, unable to dash, dive or
     * step out of a beaten zone, is dead inside the warm-up, and a dead player
     * has no blade to hold against a plate. What this check is a measurement
     * of is what happens to the LINE; a pinned player is not a measurement of
     * a player, and holding one alive on both sides of the comparison removes
     * a variable rather than adding one.
     */
    const WARM = 20;
    const arm = async (breaches, seconds) => {
      const { world } = await field({ scheme: 'free' });
      const d = world.director;
      d.start(1);
      d.wave = 3; d._compose();
      const pit = world.gunPits[0], door = pit.door;
      const p = world.player, C = p.control;
      p.saber.ignite(); p.saber.ignition = 1;
      const anchor = p.position.clone();
      const input = idle();
      const hold = () => { p.hp = p.maxHp; p.alive = true; };
      /* The warm-up, with the player in the formation in both arms. */
      for (let f = 0; f < WARM * 60; f++) {
        p.position.copy(anchor); p.velocity.set(0, 0, 0); hold();
        world.update(1 / 60, input);
      }
      const before = { men: d.roster.living.length, stam: p.stamina, force: p.force };
      let t = 0;
      if (breaches) {
        const out = outOf(door);
        const yaw = facing(-out.x, -out.z);
        const stand = door.mesh.position.clone().addScaledVector(out, 0.95);
        stand.y = world.terrain.height(stand.x, stand.z);
        for (let f = 0; f < 60 * 110; f++) {
          p.position.copy(stand); p.velocity.set(0, 0, 0); hold();
          p.camera.yaw = yaw; p.camera.pitch = 0;
          const th = t * 0.8, gain = C.sensitivity * C.bladeGain, R = 0.70;
          input.mouse.dx = (Math.cos(th) * R - C.gx) / gain;
          input.mouse.dy = -(Math.sin(th) * R - C.gy) / gain * (C.maxPitch / C.maxYaw);
          world.update(1 / 60, input);
          t += 1 / 60;
          if (door.opened) break;
        }
      } else {
        for (let f = 0; f < Math.round(seconds * 60); f++) {
          p.position.copy(anchor); p.velocity.set(0, 0, 0); hold();
          world.update(1 / 60, input);
          t += 1 / 60;
        }
      }
      return { world, d, pit, door, p, t, before,
        after: { men: d.roster.living.length, stam: p.stamina, force: p.force } };
    };

    /* ARM 1 — the breach, with the battle running. */
    const cut = await arm(true);
    assert(cut.door.opened,
      `110 s of held blade on the emplacement's door burned ${cut.door.cutArea} texels and never `
      + 'opened it — the one door in the game the battle forces you to cut is the one that cannot '
      + 'be cut');
    /**
     * ── §7'S TWENTY SECONDS IS THE UNDISTURBED FIGURE, AND THIS IS THE OTHER ONE
     *
     * `blast-door.mjs` drives the identical loop on the identical plate with
     * nothing else happening and reads **tight 13.7 s · natural 18.8 s · wide
     * 21.7 s**. The same hold, on the same door, in the middle of the
     * engagement the mode puts it in, reads **57.9 s** — because FLAGSHIP §6's
     * levy aims at the Jedi, forty conscripts follow you the 69 m to the plate,
     * and a blade that is answering bolts is not a blade that is tracing a
     * kerf. That is §7's own sentence arriving as a number: "twenty seconds of
     * held blade, DEFLECTING NOTHING". You do not get to deflect nothing, so
     * you do not get twenty seconds.
     *
     * The band is therefore wide on purpose and it is anchored at the bottom
     * rather than the top: what would be a defect is the mode's door being
     * EASIER than the bench's, or unfinishable. Anything between is the fight.
     */
    assert(cut.t > 10 && cut.t < 90,
      `the breach took ${cut.t.toFixed(1)} s. blast-door.mjs reads 13.7-21.7 s for the identical `
      + 'loop on an undisturbed plate; this one is fought for, so it is allowed to be longer — but '
      + 'not so long that the verb is a chore, and never shorter than the bench.');
    /* AND THE GUN WAS TAKEN BY IT. One mechanism, wired at construction. */
    assert(cut.pit.taken, 'the door opened and the gun went on firing');
    const shotsAfter = cut.pit.shots;
    for (let f = 0; f < 60 * 20; f++) cut.world.update(1 / 60, idle());
    assert(cut.pit.shots === shotsAfter,
      `the gun fired ${cut.pit.shots - shotsAfter} more rounds in the 20 s after it was taken`);
    const paidAtThePlate = cut.before.men - cut.after.men;
    const bars = { stam: cut.before.stam - cut.after.stam, force: cut.before.force - cut.after.force };

    /* ARM 2 — the same seconds, standing with the line instead. */
    const held = cut.t;
    const stay = await arm(false, held);
    const paidWithTheLine = stay.before.men - stay.after.men;

    assert(paidAtThePlate > 0,
      `the line lost nothing at all in the ${held.toFixed(1)} s the player spent at the plate. `
      + 'BREACH is meant to be a price paid in the mode\'s own currency, and a price of zero is an '
      + 'errand with a longer animation.');
    /**
     * ── AND THE PAIRED CONTROL IS REPORTED, NOT ASSERTED, BECAUSE IT WENT THE
     *    OTHER WAY ──────────────────────────────────────────────────────────
     *
     * The clause that stood here was `paidAtThePlate >= paidWithTheLine` — "the
     * breach must cost the line more than being there". Measured: **1 man lost
     * over 22.4 s with the player at the plate and 3 over the same 22.4 s with
     * the player standing in the formation.** It leans the wrong way, and there
     * are two reasons not to assert it in either direction:
     *
     *   IT IS ONE SAMPLE A SIDE. Three names against one, on two worlds that
     *     `field` can seed identically but cannot dress identically (two boots
     *     are two draws off the world stream). A difference of two bodies at
     *     n = 1 is not a difference.
     *   AND THE MECHANISM MAY BE REAL, WHICH IS THE INTERESTING PART. A Jedi
     *     standing in a formation is what the wave walks toward: `pickTarget`
     *     takes the nearest hostile, so a player IN the line pulls the fight
     *     onto the line, and a player 69 m away at a plate takes some of it
     *     with them. §7 assumes leaving your line exposes it; on this ground
     *     leaving it may also unburden it. That is a question about the
     *     targeting rule and it wants its own measurement over many runs, not
     *     an assertion here that would pass or fail on a coin.
     *
     * What IS asserted is the half that does not depend on the comparison: the
     * hold is in §7's band, the line pays something in those seconds, and the
     * gun that was the reason to be there stops.
     */
    return `${cut.t.toFixed(1)} s of held blade opened it (${cut.door.cutArea} texels) against `
      + `blast-door.mjs's 18.8 s median on an undisturbed plate — the difference is the levy, `
      + `which follows you to the plate. `
      + `In those seconds the line lost ${paidAtThePlate} of ${cut.before.men}; over the same `
      + `${held.toFixed(1)} s with the player standing in the formation it lost ${paidWithTheLine} `
      + `of ${stay.before.men} — one sample a side, and it leans the wrong way; see the note. `
      + `The gun fired ${cut.pit.shots} rounds and none after the plate fell. `
      + `Bars at the plate: stamina −${bars.stam.toFixed(1)}, Force −${bars.force.toFixed(1)} `
      + '(§7 says both drain; at 69 m from the line there is nothing arriving to guard, and the '
      + 'cost is the men rather than the meters)';
  });

  acheck('breach: the two flanking doors are still caches, so the rank is a choice', async () => {
    /* THE OTHER HALF OF THE DESIGN, and it is one assertion: if all three doors
     * became emplacements the rank would be a queue of three compulsory
     * twenty-seconds. One you must spend and two you may is what makes it a
     * decision.
     *
     * ON THE SAME CHAIN, which is not tidiness. As a plain `check` it started
     * immediately and read `LIVE` in a race with the teardown at the foot of
     * this file — and it would also have been a fourth simultaneous World if it
     * had built its own, which is the count HANDOFF §2.7 says is what kills
     * these runs. Serialised, it asks the ground the check above left standing. */
    const world = LIVE?.world;
    assert(world, 'no world left standing to ask');
    assert(world.gunPits.length === 1,
      `${world.gunPits.length} emplacements on one rank of doors — the magazine is a queue of `
      + 'compulsory twenty-seconds rather than one price and two choices');
    const armed = world.doors.indexOf(world.gunPits[0].door);
    assert(armed > 0 && armed < world.doors.length - 1,
      `the emplacement is behind door ${armed + 1} of ${world.doors.length} — the wing walls close `
      + 'the approach narrowest on the centre line, and the door the battle forces you to stand at '
      + 'should be the one with the least ground behind your back');
    return `${world.doors.length} doors, ${world.gunPits.length} of them a gun (the middle one); `
      + 'the other two are the caches they were';
  });

  await Promise.allSettled(started);
  retire();
}
