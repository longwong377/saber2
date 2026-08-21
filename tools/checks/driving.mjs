/**
 * BATTLEFIELD BORZ — TAKING THE CONTROLS.
 *
 * The player, in the V5 list:
 *
 *   "I think we should be able to drive the vehicles it makes sense to drive"
 *
 * ── WHAT THIS SUITE IS ACTUALLY GUARDING ────────────────────────────────
 *
 * "It makes sense" is the whole design and it is the thing a check can hold.
 * The roster splits along a line the source material already drew: an AT-TE
 * has six crew and a spotter's cupola, a Juggernaut has a driver's cabin at
 * each end, an AAT has four battle droids in a hull with a hatch, a SPHA has
 * twenty-five gunners. A hailfire droid, a dwarf spider, an Octuptarra
 * tri-droid and a Persuader snail tank have NOBODY IN THEM — the brain is the
 * machine, there is no seat to take and nobody to displace.
 *
 * So the first check below is that rule, read off the archetypes rather than
 * off a list typed in this file, and the rest are the three ways a driven
 * vehicle could quietly stop being the vehicle you were just fighting:
 *
 *   • it stops being a machine — a tank that no longer walks on its own legs,
 *     takes its own grade or loses them to a blade is a camera with a gun;
 *   • it stops being dangerous to you — armour that is really invulnerability
 *     deletes the encounter rather than winning it;
 *   • it never gives you back — a state you can enter and not leave is worse
 *     than one that does not exist.
 */

import { clocked } from './_shared.mjs';

export async function run({ check, assert }) {
  check = await clocked(check);

  const D = await import('../../src/game/Driving.js');
  /* VEHICLES FIRST. The vehicle rows are added to `ARCHETYPES` by an
   * `Object.assign` inside src/game/Vehicles.js, so a suite that imports the
   * roster without importing that file reads a roster with no vehicles in it —
   * and the first check reported "0 machines declare a crew" for a roster that
   * declares four. */
  await import('../../src/game/Vehicles.js');
  const { ARCHETYPES } = await import('../../src/game/Enemy.js');
  const { DRIVE, crewOf, isCrewed, whyNotDrive, drivableNear } = D;

  const boot = async () => {
    const H = await import('./_coop.mjs');
    const THREE = await import('three');
    const { enemyRng } = await import('../../src/game/Enemy.js');
    enemyRng.seed(19);
    const { world } = await H.bootWorld({
      level: 'colosseum', settings: { mode: 'waves', quality: 'low', instantSpawn: true },
    });
    const p = world.player;
    const input = H.idleInput();
    for (let i = 0; i < 10; i++) world.update(1 / 60, input);
    p.force = p.maxForce; p.hp = p.maxHp;
    const ctx = { input, terrain: world.terrain, physics: world.physics,
      particles: world.particles, bolts: world.bolts, camera: world.engine.camera,
      time: world.time, enemies: world.enemies, players: world.players };
    const step = (n = 30) => { for (let i = 0; i < n; i++) world.update(1 / 60, input); };
    /** Put a machine of `type` next to the player and hand it back. */
    const park = (type, out = 3) => {
      const at = new THREE.Vector3(p.position.x + out, p.position.y, p.position.z);
      const e = world.spawnEnemy(type, at);
      assert(e, `setup: nothing spawned for ${type}`);
      step(4);
      e.position.copy(at);
      return e;
    };
    return { world, p, ctx, input, THREE, step, park };
  };

  /* ────────────────────────────────────────────────────────────────────
   * 1. WHICH ONES, AND IT IS ONE FIELD
   * ──────────────────────────────────────────────────────────────────── */

  check('driving: a machine with a crew can be driven and a droid cannot', () => {
    /**
     * DERIVED, both halves. A list of drivable names typed here would be the
     * second copy of `crew` on the archetypes and one roster change from being
     * a lie — HANDOFF §2.3 — so what is asserted is the SHAPE of the split:
     * every machine that declares a crew is drivable, no machine without one
     * is, and the four droid vehicles the player can walk up to are all on the
     * dark side of that line.
     */
    const crewed = Object.keys(ARCHETYPES).filter(k => crewOf(k) > 0);
    assert(crewed.length >= 4,
      `only ${crewed.length} machines declare a crew — the roster lost its drivable hardware`);
    for (const k of crewed) {
      assert(isCrewed({ type: k }), `${k} declares ${crewOf(k)} crew and is not drivable`);
      assert(Number.isInteger(crewOf(k)) && crewOf(k) > 0,
        `${k} declares a crew of ${crewOf(k)}, which is not a number of bodies`);
    }
    /* THE DROIDS, BY NAME, because this is the half of the rule that is a
     * statement about the source material and not about the code: there is
     * nobody inside any of these to displace. */
    for (const k of ['dwarfspider', 'hailfire', 'tridroid', 'snailtank']) {
      if (!ARCHETYPES[k]) continue;
      assert(!isCrewed({ type: k }),
        `${k} is a droid — the brain IS the machine — and something declared a crew in it`);
    }
    /* …and every crewed machine is big enough to be worth taking. A crewed
     * B1 would pass every check above and be a joke. */
    for (const k of crewed) {
      assert(ARCHETYPES[k].big, `${k} declares a crew and is not a vehicle`);
    }
    return `${crewed.length} drivable: ${crewed.map(k => `${k}×${crewOf(k)}`).join(' ')}; `
      + 'four droid vehicles refused';
  });

  check('driving: a droid is refused BY NAME, not in silence', async () => {
    const b = await boot();
    const { p } = b;
    const droid = b.park('hailfire');
    droid.team = p.team;                       // …even one of yours
    const why = whyNotDrive(b.world, p, droid);
    assert(why, 'a hailfire droid was offered as drivable');
    assert(/droid|seat|brain/i.test(why), `the refusal reads "${why}" and never says why`);
    /* AND THE PROMPT FINDS IT ANYWAY. `drivableNear` deliberately does not
     * filter the refusable ones out, so the HUD can print the reason instead
     * of leaving the player next to a machine with nothing on screen. */
    /* CAUGHT AT THE DOOR EVERY REFUSAL GOES THROUGH. `world.notices` is a
     * bench field and this is a real World, so the notice is taken where it is
     * raised rather than from a list this World does not keep. */
    const said = [];
    const inner = b.world.notify.bind(b.world);
    b.world.notify = (t, sub) => { said.push(`${t} — ${sub}`); return inner(t, sub); };
    p.takeControls(b.ctx);
    b.world.notify = inner;
    assert(!p.driving, 'the player is driving a droid');
    assert(said.length, 'pressing the key at a droid did nothing and said nothing');
    assert(said.some(n => /droid|seat|brain/i.test(n)),
      `the refusal on screen reads ${JSON.stringify(said)} and never says it is a droid`);
    return `refused: "${why}"`;
  });

  check('driving: an enemy machine has to be crippled first; your own does not', async () => {
    const b = await boot();
    const { p } = b;
    const foe = b.park('aat');
    foe.team = p.team === 0 ? 1 : 0;
    foe.hp = foe.maxHp;
    const why = whyNotDrive(b.world, p, foe);
    assert(why && /crew|%/i.test(why),
      `a full-health ENEMY tank was takeable: ${why === null ? 'no refusal at all' : why}`);

    /* CRIPPLED, and it is a share of the hull rather than a flat number: this
     * roster spans 340 hp on a dwarf spider and 4 400 on a SPHA. */
    foe.hp = foe.maxHp * DRIVE.wreck * 0.9;
    assert(!whyNotDrive(b.world, p, foe),
      `a tank at ${Math.round(foe.hp / foe.maxHp * 100)}% is still refused`);

    /* …and one of yours, at full health, any time. */
    const mine = b.park('atte', -3);
    mine.team = p.team;
    mine.hp = mine.maxHp;
    assert(!whyNotDrive(b.world, p, mine),
      `your own AT-TE at full health was refused: ${whyNotDrive(b.world, p, mine)}`);
    return `enemy at 100% refused, at ${Math.round(DRIVE.wreck * 90)}% taken; your own always`;
  });

  /* ────────────────────────────────────────────────────────────────────
   * 2. AND IT IS STILL THE MACHINE YOU WERE FIGHTING
   * ──────────────────────────────────────────────────────────────────── */

  check('driving: you steer it, it moves on its own legs, and it fires its own gun', async () => {
    const b = await boot();
    const { p } = b;
    const tank = b.park('aat');
    tank.team = p.team;
    assert(p.takeControls(b.ctx), 'could not take the controls of my own tank');
    assert(p.driving && tank.driven === p.driving, 'the two halves of the state disagree');
    assert(tank.team === p.team, 'a tank you are driving is not on your side');

    /* THROTTLE. The move axis is the tank's, so a held forward is the machine
     * travelling under its own `_move` — grade limit, legs and all — and not a
     * position being written by the crew. */
    const from = tank.position.clone();
    b.input.moveAxis = (o) => { if (o) { o.x = 0; o.y = 1; return o; } return { x: 0, y: 1 }; };
    b.input.act = () => false;
    b.step(90);
    const drove = tank.position.distanceTo(from);
    assert(drove > 2, `a second and a half of full throttle moved the tank ${drove.toFixed(2)} m`);

    /* …AND THE DRIVER CAME WITH IT. `Crew.ride` runs in the enemy's own tick,
     * after the hull has moved, so the seat is never a frame behind. */
    const off = Math.hypot(p.position.x - tank.position.x, p.position.z - tank.position.z);
    assert(off < 2.5, `the driver is ${off.toFixed(2)} m from the hull they are sitting on`);

    /* STEERING. Left on the axis swings the hull, at the driver's rate rather
     * than the AI's. */
    const facing0 = tank.facing;
    b.input.moveAxis = (o) => { if (o) { o.x = 1; o.y = 0; return o; } return { x: 1, y: 0 }; };
    b.step(60);
    const turned = Math.abs(((tank.facing - facing0 + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
    assert(turned > 0.4, `a second of full steer swung the hull ${turned.toFixed(2)} rad`);

    /* THE GUN. Its own damage, its own colour, its own muzzle — through the
     * machine's `_shoot`, which is why a taken AAT is an AAT. */
    /* COUNTED AT THE POOL'S OWN DOOR. `BoltPool` has no live count to read —
     * it is a ring of slots with an `active` flag — and a check that invented
     * one would be measuring a field nothing else in the game has. */
    b.input.moveAxis = (o) => { if (o) { o.x = 0; o.y = 0; return o; } return { x: 0, y: 0 }; };
    b.input.act = (id) => id === 'thrust';
    const shells = [];
    const innerFire = b.world.bolts.fire.bind(b.world.bolts);
    b.world.bolts.fire = (o, d, opts = {}) => { shells.push(opts); return innerFire(o, d, opts); };
    p.driving.fireT = 0;
    p.driving.fire(b.ctx);
    b.world.bolts.fire = innerFire;
    assert(shells.length > 0, 'pulling the trigger in a tank fired nothing');
    /* …AND IT IS THE TANK'S SHELL, not a generic bolt. Its damage, its colour
     * and its owner all come off the archetype through the machine's own
     * `_shoot`, which is the whole reason a taken AAT is an AAT. */
    const shell = shells[0];
    assert(shell.owner === tank, 'the shell was not fired by the machine');
    assert(shell.team === p.team, `the shell went out on team ${shell.team}, not the driver's`);
    assert(shell.damage > 30, `the tank's shell does ${shell.damage} — that is a rifle`);
    assert(shell.big, "the tank's shell is not a big bolt");
    const fired = shells.length;
    return `drove ${drove.toFixed(1)} m, swung ${turned.toFixed(2)} rad, fired ${fired} shell(s)`;
  });

  /* ────────────────────────────────────────────────────────────────────
   * 3. THE ARMOUR IS A TRADE, NOT AN IMMUNITY
   * ──────────────────────────────────────────────────────────────────── */

  check('driving: hits land on the hull, and the hull dying puts you out', async () => {
    const b = await boot();
    const { p } = b;
    const tank = b.park('aat');
    tank.team = p.team;
    p.takeControls(b.ctx);
    assert(p.driving, 'setup: not driving');

    const hp0 = p.hp, hull0 = tank.hp;
    p.invuln = 0;
    p.damage(80, p.chest, null, 'bolt');
    assert(p.hp === hp0, `the driver took ${(hp0 - p.hp).toFixed(1)} hp through the armour`);
    assert(tank.hp < hull0,
      'the blow reached neither the driver nor the hull — that is invulnerability, not armour');
    assert(Math.abs((hull0 - tank.hp) - 80 * (tank.dmgScale ?? 1)) < 80,
      `the hull took ${(hull0 - tank.hp).toFixed(1)} of an 80-point blow`);

    /* AND WHEN THE HULL IS FINISHED YOU ARE ON THE GROUND. Not dead with it:
     * the trade for the armour is that you cannot heal it and everything on
     * the field is aiming at a fourteen-metre target you are sitting on. */
    tank.hp = 1;
    p.damage(400, p.chest, null, 'bolt');
    b.step(4);
    assert(!p.driving, 'the tank died and the player is still at its controls');
    assert(p.alive, 'the driver died with the machine');
    const clear = p.position.distanceTo(tank.position);
    assert(clear > 1, `the player was put down ${clear.toFixed(2)} m from the wreck — inside it`);
    return `80-point bolt: driver 0, hull ${(hull0 - tank.hp).toFixed(0)}; wreck puts you out ${clear.toFixed(1)} m clear`;
  });

  check('driving: the same key gets you out, and everything you borrowed goes back', async () => {
    const b = await boot();
    const { p } = b;
    const tank = b.park('atte');
    const wasTeam = tank.team = p.team === 0 ? 1 : 0;
    tank.hp = tank.maxHp * 0.1;                   // crippled, so it is takeable
    const wasSpeed = tank.speed;
    p.saber.ignite(); p.saber.ignition = 1;
    assert(p.takeControls(b.ctx), `could not board: ${whyNotDrive(b.world, p, tank)}`);
    assert(!p.saber.lit, 'both hands are on the controls and the blade is still lit');

    p.takeControls(b.ctx);
    assert(!p.driving && !tank.driven, 'pressing the key again did not get the player out');
    /* THE BORROWED FIELDS. A tank you sit in for a second must not become
     * yours, and a pace written for a driver must not stay on the body — the
     * same trap `Enemy.update`'s own note describes for a reaction's speed. */
    assert(tank.team === wasTeam, `the machine kept the player's side after they climbed down`);
    assert(Math.abs(tank.speed - wasSpeed) < 1e-6,
      `it walks at ${tank.speed.toFixed(2)} now against ${wasSpeed.toFixed(2)} before`);
    assert(p.saber.lit || p.saber.ignition > 0, 'the blade did not come back lit');
    const clear = p.position.distanceTo(tank.position);
    assert(clear > 1, `climbing down put the player ${clear.toFixed(2)} m away — inside the hull`);

    /* AND THE MACHINE GOES BACK TO FIGHTING. Its brain was skipped while it was
     * driven; nothing may have broken on the way through. */
    b.step(60);
    assert(!tank.dead, 'the machine died the moment it was handed back');
    return `out on the same key, side ${wasTeam} restored, pace restored, ${clear.toFixed(1)} m clear`;
  });

  return;
}
