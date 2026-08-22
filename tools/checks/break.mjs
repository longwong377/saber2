/**
 * BATTLEFRONT BORZ — THE HORDE'S NERVE. FLAGSHIP §7's BREAK and TURN verbs.
 *
 *   "BREAK — morale is fully built and barely used. Walk into the front of a
 *    formation and it comes apart. `unleash`, `dread`, then stand there so
 *    `JEDI_NEAR` holds your nerve while theirs goes."
 *
 *   "TURN — a returned bolt that kills its firer counts on THEIR morale
 *    ledger. Every bolt sent home deletes a rifle and breaks a nerve."
 *
 * Morale was fully built and it was the ROSTER's: every term in `MORALE` hangs
 * off a `Trooper` record, and a body composed by `WaveDirector` has none. So
 * `Enemy.aimQuality`'s own comment read "bodies with no morale (the horde) read
 * 1", `CommandDirector._castDread`'s read "in a campaign there is none and the
 * three above are the entire effect", and the first of §7's four verbs landed
 * on nothing at all outside a meeting between two human commanders.
 *
 * `src/game/Nerve.js` is the ledger. What this file checks is the four things
 * that make it a VERB rather than a field:
 *
 *   it is INERT until a player does something — nothing in a shipped wave
 *     moves without a blade in the rank, which is what keeps this from being a
 *     balance change wearing a feature's name;
 *   PRESENCE takes it, at a rate a player can feel and not one that makes the
 *     blade unnecessary;
 *   a DEATH takes it from the men who could see it, and not from the rest;
 *   a RETURNED BOLT takes three times as much, which is TURN;
 *   and a body that has lost it STOPS HOLDING ITS PLACE, because a number that
 *     changes nothing a player can see is a random number generator with a
 *     name.
 *
 * `tools/checks/nerve.mjs` is the same subject on the other side of the field —
 * a soldier of YOURS who is not fighting — and the two share the two
 * thresholds (`MORALE.BREAK`, `MORALE.REFUSE`) on purpose.
 */

import * as THREE from 'three';
import { NERVE, nerveOf, nerveBroken, shakeNerve, witnessDeath, turnedHome, nerveAim, nerveTick, boltAnswered }
  from '../../src/game/Nerve.js';
import { MORALE } from '../../src/game/Morale.js';
import { clocked } from './_shared.mjs';

const STEP = 1 / 30;

/** A rank of `n` bodies of `type` on an arc `range` metres from the origin. */
function rank(world, n, range, type = 'b1', spread = 1.0) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const a = -spread / 2 + (n > 1 ? spread * i / (n - 1) : 0);
    const x = Math.sin(a) * range, z = Math.cos(a) * range;
    const e = world.spawnEnemy(type, new THREE.Vector3(x, 0, z));
    if (e) { e.position.y = (world.terrain?.height(x, z) ?? 0) + 0.02; out.push(e); }
  }
  return out;
}

const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

export async function run({ check, assert }) {
  check = await clocked(check);

  /* ══════════════════════════════════════════════════════════════════ */
  /*  The ledger                                                        */
  /* ══════════════════════════════════════════════════════════════════ */

  check('break: the horde has a nerve ledger, it starts full, and a record keeps its own', () => {
    const horde = { position: new THREE.Vector3(), team: 1, dead: false };
    assert(nerveOf(horde) === 1,
      `a body with no ledger reads ${nerveOf(horde)} — it must read full, or every wave in the `
      + 'shipped game becomes worse at shooting the day this file lands');
    assert(nerveAim(horde) === 1,
      `a full-nerve body shoots at ${nerveAim(horde)} of its spread — the term must be the identity `
      + 'at the top of the range for the same reason');
    assert(shakeNerve(horde, -0.5), 'a body with no record refused the ledger');
    assert(Math.abs(nerveOf(horde) - 0.5) < 1e-9, `shaking by -0.5 left ${nerveOf(horde)}`);
    assert(nerveAim(horde) > 1, 'a half-broken body shoots exactly as well as a steady one');

    /* A NAME ON A ROLL IS THE DIRECTOR'S. `CommandDirector.shake` does three
     * more things with the event than this does — the log, the "IS BREAKING"
     * call, the flag `steer` reads — so a second writer would be a second
     * answer to how frightened a man is. */
    const named = { position: new THREE.Vector3(), team: 0, dead: false, trooper: { morale: 0.9 } };
    assert(!shakeNerve(named, -0.5), 'shakeNerve wrote a body that has a roster record');
    assert(named.trooper.morale === 0.9, `the record moved to ${named.trooper.morale}`);
    assert(nerveOf(named) === 0.9, 'nerveOf reads the wrong ledger for a body with a record');
    assert(nerveAim(named) === 1,
      'nerveAim double-charges a body with a record — aimQuality already ran the morale term on it');

    /* ONE THRESHOLD FOR BOTH ARMIES. */
    horde.nerve = MORALE.BREAK - 0.001;
    assert(nerveBroken(horde), 'a body under MORALE.BREAK is not broken');
    horde.nerve = MORALE.BREAK + 0.001;
    assert(!nerveBroken(horde), 'a body over MORALE.BREAK is broken');
    return `starts ${NERVE.START} · breaks at ${MORALE.BREAK} · refuses at ${MORALE.REFUSE} · `
      + `worst aim ${nerveAim({ nerve: 0 }).toFixed(2)}x`;
  });

  check('break: nothing moves it without a blade in the rank — the ledger is inert by default', async () => {
    const { bootWorld, idleInput } = await import('./_coop.mjs');
    const { world } = await bootWorld({ level: 'geonosis', settings: { mode: 'waves', level: 'geonosis' } });
    try {
      const p = world.player;
      /**
       * THE BLADE IS OUT AND THE PLAYER IS FORTY METRES AWAY, which is the
       * condition every wave in every mode is in for most of its life. If the
       * ledger drifts here then this feature is a stealth nerf to the whole
       * shipped game — every droid in every level shooting worse, for reasons
       * no player caused and no player can see.
       */
      p.position.set(0, (world.terrain?.height(0, 0) ?? 0) + 0.05, 40);
      p.saber.ignition = 0;
      const bodies = rank(world, 8, 6, 'b1');
      assert(bodies.length === 8, `only ${bodies.length} of 8 bodies stood up`);
      const idle = idleInput();
      for (let i = 0; i < 300; i++) world.update(STEP, idle);
      const live = bodies.filter((e) => !e.dead);
      const worst = Math.min(...live.map(nerveOf));
      assert(live.length > 0, 'the whole rank died with nobody attacking it');
      assert(worst >= 1 - 1e-6,
        `after ten seconds with no blade on the field the steadiest-shaken body reads ${worst.toFixed(3)} `
        + '— the ledger drifts on its own, which makes every wave in the game quietly easier');
      return `${live.length} bodies, 10 game-seconds, no blade lit → nerve ${worst.toFixed(3)}`;
    } finally { world.unload?.(); }
  });

  /* ══════════════════════════════════════════════════════════════════ */
  /*  BREAK                                                             */
  /* ══════════════════════════════════════════════════════════════════ */

  check('break: a lit blade standing in the front of a rank takes it apart, and the back rank holds', async () => {
    const { bootWorld, idleInput } = await import('./_coop.mjs');
    const { world } = await bootWorld({ level: 'geonosis', settings: { mode: 'waves', level: 'geonosis' } });
    try {
      const p = world.player;
      p.position.set(0, (world.terrain?.height(0, 0) ?? 0) + 0.05, 0);
      p.saber.ignite(); p.saber.ignition = 1;
      /**
       * TWO RANKS, ONE WORLD, ONE CLOCK — so the comparison is not two runs.
       * The front stands inside `NERVE.BLADE_REACH` and the back stands well
       * outside it, and §7's claim is precisely that the difference between
       * those two places is what a formation coming apart LOOKS like. A rank
       * that broke from end to end at once would be an army evaporating.
       */
      const front = rank(world, 6, NERVE.BLADE_REACH - 2.5, 'b1', 1.4);
      const back = rank(world, 6, NERVE.BLADE_REACH + 14, 'b1', 0.8);
      assert(front.length === 6 && back.length === 6, 'the two ranks did not both stand up');
      /* The bodies are frozen where they were put: this measures the LEDGER,
       * not the pathfinding, and a rank that walked out of the radius while it
       * was being measured would be measuring the walk. */
      for (const e of [...front, ...back]) { e._think = () => { e.wish = null; }; e.hp = 1e6; }

      const idle = idleInput();
      let brokeAt = null;
      for (let i = 0; i < 900; i++) {
        world.update(STEP, idle);
        if (brokeAt === null && front.every(nerveBroken)) brokeAt = +((i + 1) * STEP).toFixed(1);
        if (brokeAt !== null) break;
      }
      const f = mean(front.map(nerveOf)), b = mean(back.map(nerveOf));
      assert(brokeAt !== null,
        `thirty seconds of a lit blade standing in the front rank left it at ${f.toFixed(3)} and it `
        + `never crossed ${MORALE.BREAK} — §7's first verb does not fire`);
      assert(b >= 1 - 1e-6,
        `the rank ${(NERVE.BLADE_REACH + 14).toFixed(0)} m back is at ${b.toFixed(3)} — presence is `
        + 'reaching bodies that cannot see the player, so a formation does not come apart, it dissolves');
      /* NOT INSTANTLY, and the bound is the design's own rate rather than a
       * number chosen here: nobody breaks from a Jedi WALKING at them, and a
       * body that did would make the blade unnecessary. */
      const soonest = (1 - MORALE.BREAK) / Math.abs(NERVE.BLADE + NERVE.RALLY_PER_S);
      assert(brokeAt >= soonest - 0.5,
        `the front rank broke in ${brokeAt}s against the ${soonest.toFixed(1)}s the table's own rate `
        + 'allows — something else is taking their nerve');
      return `front rank broken in ${brokeAt}s (nerve ${f.toFixed(3)}) · the rank behind it `
        + `${b.toFixed(3)} · the table's own rate says ${soonest.toFixed(1)}s`;
    } finally { world.unload?.(); }
  });

  check('break: a body that has lost its nerve gives ground, and one that has lost it all stops firing', async () => {
    const { bootWorld, idleInput } = await import('./_coop.mjs');
    const { world } = await bootWorld({ level: 'geonosis', settings: { mode: 'waves', level: 'geonosis' } });
    try {
      const p = world.player;
      p.position.set(0, (world.terrain?.height(0, 0) ?? 0) + 0.05, 0);
      p.saber.ignite(); p.saber.ignition = 1;
      const idle = idleInput();
      /**
       * THE SAME BODY AT THREE NERVE LEVELS, and the thing read is `wish` —
       * the direction the brain wants to walk, which is what `_move` steers on.
       * A dot against `toTarget` is the whole claim: positive is closing,
       * negative is giving ground.
       */
      /**
       * `shadow` KEEPS THE RANGE CONSTANT BY MOVING THE PLAYER, and it took two
       * failed harnesses to arrive at.
       *
       * The trigger finger cannot be read off a body that is free to walk: a
       * broken B1 takes itself from 9 m to 15.7 m in four seconds, past the far
       * edge of its own `preferred` band, and stops firing because it is OUT OF
       * RANGE. That behaviour is true and wanted, and it is the FEET; crediting
       * the nerve clause with it would be measuring the retreat twice.
       *
       * The two obvious fixes are both wrong and both fail in the same
       * direction — a steady body at full nerve firing nothing, which reads
       * exactly like the ledger switching the gun off:
       *
       *   WRITING THE POSITION BACK each frame stands the body in its own
       *     spawn point, whose y is the ground rather than the height its own
       *     support code solves. `_hasLineOfSight` then casts from a muzzle in
       *     the dirt and finds terrain. 0 shots at full nerve.
       *   FREEZING `_move` skips `_syncBody`, so the collider and the rig stop
       *     following the body at all. Also 0 shots at full nerve.
       *
       * So nothing about the body is touched. The PLAYER is put back on the
       * same bearing at the same distance after every frame, which holds the
       * range without interfering with a single thing the brain reads. Measured
       * on a steady body: 3 shots shadowed against 6 free, which is the same
       * gun firing over a shorter effective window and not a different one.
       */
      const bearing = new THREE.Vector3();
      const RANGE = 9;
      const at = (nerve, shadow = false) => {
        const [e] = rank(world, 1, RANGE, 'b1');
        e.hp = 1e6;
        /* THE SUBJECT'S BOLTS, NOT THE WORLD'S — and the difference is not
         * hypothetical. `BoltPool.fire` is the one door every blaster round in
         * the game leaves by, so an unfiltered counter here reads any shooter
         * that happens to be on this ground: a wave the director let in, a
         * body left over from an earlier arm of this same drive, an emplaced
         * gun in the level's own dressing. The sentence the assertion below
         * makes is about ONE BODY, so `opts.owner === e` is what it has to
         * count, and a red that does appear then names a body that fired
         * rather than a number nobody can attribute. `Enemy._shoot` is the
         * only caller that stamps an owner, and it stamps `this`. */
        let shots = 0, elsewhere = 0;
        const fire = world.bolts.fire.bind(world.bolts);
        world.bolts.fire = (from, dir, opts = {}) => {
          if (opts.owner === e) shots++; else elsewhere++;
          return fire(from, dir, opts);
        };
        let closing = 0, n = 0;
        for (let i = 0; i < 120; i++) {
          e.nerve = nerve;                       // held, so the drift does not move the arm
          world.update(STEP, idle);
          if (shadow) {
            bearing.subVectors(p.position, e.position).setY(0);
            if (bearing.lengthSq() > 1e-6) {
              bearing.normalize();
              p.position.x = e.position.x + bearing.x * RANGE;
              p.position.z = e.position.z + bearing.z * RANGE;
            }
          }
          if (e.wish && e.toTarget) { closing += e.wish.dot(e.toTarget); n++; }
        }
        world.bolts.fire = fire;
        const out = { closing: n ? closing / n : 0, shots, elsewhere,
          at: +e.position.distanceTo(p.position).toFixed(1) };
        e.dead = true; e.dispose?.();
        const ix = world.enemies.indexOf(e); if (ix >= 0) world.enemies.splice(ix, 1);
        return out;
      };
      const home = p.position.clone();
      const steady = at(1);
      p.position.copy(home);
      const broken = at((MORALE.BREAK + MORALE.REFUSE) / 2);
      p.position.copy(home);
      const gunSteady = at(1, true);
      const gunBroken = at((MORALE.BREAK + MORALE.REFUSE) / 2, true);
      const gunRefusing = at(MORALE.REFUSE * 0.4, true);

      assert(steady.closing > 0,
        `a steady B1 walks at ${steady.closing.toFixed(3)} of the line to the player — the control `
        + 'arm is not closing, so nothing below it means anything');
      assert(broken.closing < 0,
        `a broken B1 still walks toward the player (${broken.closing.toFixed(3)}) — §7's "it comes `
        + 'apart" has to be visible in the feet or it is a hidden number');
      assert(broken.at > steady.at,
        `a broken B1 ended ${broken.at} m out against a steady one's ${steady.at} — giving ground `
        + 'has to move the body, not only its wish');
      assert(gunSteady.shots > 0, 'a steady B1 fired nothing, so the fire test below proves nothing');
      assert(gunRefusing.shots === 0,
        `a body under MORALE.REFUSE fired ${gunRefusing.shots} bolts from its own range — it will `
        + 'not take an order and it is still shooting');
      assert(gunBroken.shots > 0,
        'a merely BROKEN body held at its own range has stopped firing too — a line falling back '
        + 'while shooting is the difference between breaking a formation and switching it off');
      const stray = gunSteady.elsewhere + gunBroken.elsewhere + gunRefusing.elsewhere;
      return `feet: steady ${steady.closing.toFixed(2)} (ends ${steady.at} m) · broken `
        + `${broken.closing.toFixed(2)} (ends ${broken.at} m) · gun at a held ${RANGE} m: steady `
        + `${gunSteady.shots} · broken ${gunBroken.shots} · refusing ${gunRefusing.shots}`
        + ` · ${stray} bolts on this ground came from somewhere else`;
    } finally { world.unload?.(); }
  });

  check('break: a death takes the nerve of the men who could see it, and nobody else\'s', () => {
    const body = (x, team = 1) => ({ position: new THREE.Vector3(x, 0, 0), team, dead: false });
    const near = body(NERVE.SEE - 1), far = body(NERVE.SEE + 1), other = body(1, 0);
    const fallen = body(0);
    const bodies = [fallen, near, far, other];
    fallen.dead = true;
    const n = witnessDeath(bodies, fallen);
    assert(n === 1, `${n} bodies felt a death that only one of them was near enough to see`);
    assert(nerveOf(near) < 1, 'the man beside the body felt nothing');
    assert(nerveOf(far) === 1, `a body ${NERVE.SEE + 1} m away felt a death at ${nerveOf(far)}`);
    assert(nerveOf(other) === 1,
      'a body on the OTHER SIDE lost nerve when its enemy went down — the rank opposite has just '
      + 'watched something good happen');
    /* HOW MANY IT TAKES, reported rather than bound: §7 wants a Jedi cutting
     * through the front of a formation to break it, and the number of bodies
     * that costs is the design's real dial. */
    const need = Math.ceil((1 - MORALE.BREAK) / Math.abs(NERVE.COMRADE_FELL));
    assert(need >= 3 && need <= 40,
      `${need} bodies have to fall inside ${NERVE.SEE} m to break the man beside them — at that rate `
      + 'a formation either evaporates on the first cut or never breaks at all');
    return `${NERVE.COMRADE_FELL} a body within ${NERVE.SEE} m · ${need} of them breaks a nerve`;
  });

  /* ══════════════════════════════════════════════════════════════════ */
  /*  ANSWERED FIRE — the term the verb is carried by                   */
  /* ══════════════════════════════════════════════════════════════════ */

  check('break: six of a body\'s own bolts, answered, breaks it — and the constant is derived off that count', () => {
    /**
     * WHY THE VERB HAS THIS TERM AT ALL, in one line of arithmetic: the two
     * proximity terms are billed by how many bodies are near a point, and
     * measured over two Geonosis Command battles the horde puts 0.4 bodies
     * inside `BLADE_REACH` and 1.1 witnesses inside `SEE` of a body going down.
     * `NERVE.ANSWERED`'s own note carries the whole table. This check holds the
     * arithmetic that note is written around.
     */
    const need = Math.ceil((1 - MORALE.BREAK) / Math.abs(NERVE.ANSWERED));
    assert(need === NERVE.ANSWERED_TO_BREAK,
      `${need} answered bolts breaks a man against the ${NERVE.ANSWERED_TO_BREAK} the table says — `
      + 'the constant has stopped being derived off the count, which is how a tuning pass moves one '
      + 'and leaves the other');
    assert(Math.abs(NERVE.ANSWERED) > Math.abs(NERVE.COMRADE_FELL),
      `a bolt of his own coming back costs ${Math.abs(NERVE.ANSWERED).toFixed(3)} against the man `
      + `beside him falling at ${Math.abs(NERVE.COMRADE_FELL)} — it is happening TO him, not near him`);
    /* …AND LESS THAN A TURNED KILL COSTS, which is the whole of what a turned
     * kill costs a witness — `COMRADE_FELL` and `TURNED` stack, see the TURN
     * check below — because nothing died here. The comparison is against the
     * SUM and not against `TURNED` alone: `TURNED` is what a witness pays and
     * this is what the firer pays, and two different subjects do not order. */
    const turnedKill = Math.abs(NERVE.COMRADE_FELL) + Math.abs(NERVE.TURNED);
    assert(Math.abs(NERVE.ANSWERED) < turnedKill,
      `an answered bolt costs ${Math.abs(NERVE.ANSWERED).toFixed(3)} against the ${turnedKill.toFixed(3)} `
      + 'a bolt sent home that KILLS costs — a bolt that hurt nobody is worth as much as one that '
      + 'deleted a rifle');
    /* …and it is the one term in this table that does not ask where anybody is
     * standing. Six calls, no positions, no radius. */
    const firer = { team: 1, dead: false };
    let crossed = null;
    for (let i = 1; i <= NERVE.ANSWERED_TO_BREAK + 2; i++) {
      assert(boltAnswered(firer), `boltAnswered refused the ledger on bolt ${i}`);
      if (crossed === null && nerveBroken(firer)) crossed = i;
    }
    assert(crossed === NERVE.ANSWERED_TO_BREAK,
      `it took ${crossed} answered bolts to cross ${MORALE.BREAK}, not ${NERVE.ANSWERED_TO_BREAK}`);
    const named = { team: 1, dead: false, trooper: { morale: 0.9 } };
    assert(!boltAnswered(named), 'boltAnswered wrote a body that has a roster record');
    assert(named.trooper.morale === 0.9, 'a name on a roll was rewritten from outside CommandDirector.shake');
    return `${NERVE.ANSWERED.toFixed(3)} a bolt · ${NERVE.ANSWERED_TO_BREAK} of them breaks a man · `
      + `a turned kill costs a witness ${turnedKill.toFixed(3)}`;
  });

  check('break: the shipped deflection path bills the man whose shot it was', async () => {
    const { bootWorld, idleInput } = await import('./_coop.mjs');
    const { world } = await bootWorld({ level: 'geonosis', settings: { mode: 'waves', level: 'geonosis' } });
    try {
      const p = world.player;
      p.position.set(0, (world.terrain?.height(0, 0) ?? 0) + 0.05, 0);
      p.saber.ignite(); p.saber.ignition = 1;
      const idle = idleInput();
      world.update(1 / 60, idle); world.update(1 / 60, idle);
      const [shooter] = rank(world, 1, 9, 'b1');
      assert(shooter, 'nothing stood up to fire');
      shooter.hp = 1e6;

      /**
       * THROUGH `World._onBoltDeflect`, WHICH IS THE ONE DOOR EVERY TURNED BOLT
       * IN THE GAME ARRIVES AT — blade sweep, guard zone, auto-guard cone and
       * screen all call it. Nothing here re-implements the rule: the bolt comes
       * out of the shipped pool with the shipped owner stamp, the blade entry
       * is the world's own (`_bladeEntries`), and the assertion is that the
       * path reaches the ledger with the right body on the end of it.
       */
      const entry = world._bladeEntries().find((b) => b.owner === p);
      assert(entry, 'the player has no blade entry, so there is nothing to deflect with');
      const before = nerveOf(shooter);
      const bolt = world.bolts.fire(
        new THREE.Vector3(0, p.position.y + 1.2, 6), new THREE.Vector3(0, 0, -1),
        { speed: 90, team: 1, damage: 9, owner: shooter });
      assert(bolt, 'no bolt came out of the pool');
      const at = new THREE.Vector3(0, p.position.y + 1.2, 1.1);
      world._onBoltDeflect(bolt, entry, { bladeT: 0.5, point: at.clone(), auto: true, screen: 0 }, at.clone());
      const cost = before - nerveOf(shooter);
      assert(Math.abs(cost - Math.abs(NERVE.ANSWERED)) < 1e-6,
        `the body that fired it lost ${cost.toFixed(4)} against NERVE.ANSWERED's `
        + `${Math.abs(NERVE.ANSWERED).toFixed(4)} — the shipped door is not reaching the ledger, so `
        + '§7\'s first verb is a constant nothing writes');
      /* …AND THE PLAYER IS NOT A BODY WITH A LEDGER. His own bolt, turned by
       * something else, must not give HIM a nerve — `Player` has no `trooper`
       * to route on, so the only thing standing between it and a stray field
       * on the player is the side test at the call site. */
      const mine = world.bolts.fire(
        new THREE.Vector3(0, p.position.y + 1.2, 1), new THREE.Vector3(0, 0, 1),
        { speed: 90, team: 0, damage: 9, owner: p });
      world._onBoltDeflect(mine, entry, { bladeT: 0.5, point: at.clone(), auto: true, screen: 0 }, at.clone());
      assert(p.nerve === undefined, `the player picked up a nerve of ${p.nerve} off his own bolt`);
      return `one bolt answered → the body that fired it ${before.toFixed(3)} → `
        + `${nerveOf(shooter).toFixed(3)} (-${cost.toFixed(3)}) · the player has no ledger`;
    } finally { world.unload?.(); }
  });

  check('break: a rank more than half of which is running takes the rest with it, and one runner does not', () => {
    /**
     * THE CARRIER WHOSE RADIUS IS THE FORMATION. Every other term in this table
     * is billed at a point the PLAYER chose, and the horde does not stand near
     * the player: measured, 0.4 bodies inside `BLADE_REACH` and 1.1 witnesses
     * per death. This is the one term whose reach is the rank's own.
     *
     * NO POSITIONS ARE INVENTED BEYOND A METRE APART — the subject is the share,
     * and `MORALE.ROUT` is the threshold the roster already uses for exactly
     * this sentence on the other side of the field.
     */
    const at = (x, nerve) => ({ position: new THREE.Vector3(x, 0, 0), team: 1, dead: false, nerve });
    const blades = [];

    /* ONE RUNNER AMONG THREE STEADY MEN IS NOT A ROUT — a quarter of what the
     * steady ones can see, against a half. They rally exactly as if he were
     * not there. */
    const calm = [at(0, MORALE.BREAK - 0.05), at(1, 0.5), at(2, 0.5), at(3, 0.5)];
    nerveTick(calm, blades, 1);
    for (let i = 1; i < calm.length; i++) {
      assert(Math.abs(calm[i].nerve - (0.5 + MORALE.RALLY_PER_S)) < 1e-9,
        `a steady man beside ONE runner lost ${(0.5 - calm[i].nerve).toFixed(4)} — a single broken `
        + 'body is taking a rank with it, which is an army evaporating rather than a formation '
        + 'coming apart');
    }

    /* …AND THREE OF FOUR IS. The rally does not merely stop, it turns over: the
     * rate is the rally's own with the sign changed, so the sentence is the
     * exact inverse of the one out-of-contact recovery makes. */
    const rout = [at(0, 0.1), at(1, 0.1), at(2, 0.1), at(3, 0.5)];
    nerveTick(rout, blades, 1);
    assert(Math.abs(rout[3].nerve - (0.5 - MORALE.RALLY_PER_S)) < 1e-9,
      `the last steady man in a rank three quarters of which is running read ${rout[3].nerve.toFixed(4)} `
      + `against the ${(0.5 - MORALE.RALLY_PER_S).toFixed(4)} the rally's own rate turned over gives`);

    /* …AND A MAN WHO CANNOT SEE THEM IS NOT IN THAT RANK. `SEE` is the radius,
     * the same one a death travels through. */
    const away = [at(0, 0.1), at(1, 0.1), at(2, 0.1), at(NERVE.SEE + 5, 0.5)];
    nerveTick(away, blades, 1);
    assert(Math.abs(away[3].nerve - (0.5 + MORALE.RALLY_PER_S)) < 1e-9,
      `a body ${NERVE.SEE + 5} m from a rout was carried by it — the carrier has no radius, which `
      + 'makes it the flat aura this whole table is written to avoid');

    /* …AND THE OTHER ARMY IS NOT HIS RANK. */
    const other = [at(0, 0.1), at(1, 0.1), at(2, 0.1), { ...at(3, 0.5), team: 0 }];
    nerveTick(other, blades, 1);
    assert(Math.abs(other[3].nerve - (0.5 + MORALE.RALLY_PER_S)) < 1e-9,
      'a body was routed by the men opposite breaking, which is something good happening to it');

    /* …AND NOTHING IS PAID FOR THE CENSUS WHILE NOBODY IS RUNNING. The O(n²)
     * pass is skipped outright, which is what keeps this off the frame of every
     * wave in the shipped game — the same inertness the whole table has. */
    const steady = [at(0, 1), at(1, 1), at(2, 1)];
    nerveTick(steady, blades, 1);
    for (const e of steady) assert(e.nerve === 1, `a full-nerve rank with nobody running drifted to ${e.nerve}`);
    return `> ${MORALE.ROUT} of what a body can see, running → its rally turns over to `
      + `-${MORALE.RALLY_PER_S}/s · one runner in four does nothing · ${NERVE.SEE} m is the reach`;
  });

  /* ══════════════════════════════════════════════════════════════════ */
  /*  TURN                                                              */
  /* ══════════════════════════════════════════════════════════════════ */

  check('turn: a bolt sent home costs the rank more than an ordinary kill, and it comes off the same ledger', () => {
    const mk = () => {
      const fallen = { position: new THREE.Vector3(), team: 1, dead: true };
      const mate = { position: new THREE.Vector3(2, 0, 0), team: 1, dead: false };
      return { bodies: [fallen, mate], fallen, mate };
    };
    const plain = mk();
    witnessDeath(plain.bodies, plain.fallen);
    const turned = mk();
    witnessDeath(turned.bodies, turned.fallen);
    turnedHome(turned.bodies, turned.fallen);

    const a = 1 - nerveOf(plain.mate), b = 1 - nerveOf(turned.mate);
    assert(b > a,
      `a bolt sent home cost the man beside the body ${b.toFixed(3)} against ${a.toFixed(3)} for an `
      + 'ordinary kill — TURN is not on the ledger at all');
    /* ON TOP OF, NOT INSTEAD OF: two facts arrived, so both are billed. */
    assert(Math.abs((b - a) - Math.abs(NERVE.TURNED)) < 1e-9,
      `the extra is ${(b - a).toFixed(4)} against NERVE.TURNED's ${Math.abs(NERVE.TURNED)} — the two `
      + 'terms are replacing each other rather than stacking');
    assert(Math.abs(NERVE.TURNED) > Math.abs(NERVE.COMRADE_FELL) * 2,
      'a bolt sent home is worth barely more than any other kill, and it is the rarest thing a '
      + 'player can do — only 5% RETURN and 9% PERFECT by blade speed alone');
    return `ordinary kill -${a.toFixed(3)} · sent home -${b.toFixed(3)} (${(b / a).toFixed(1)}x)`;
  });

  check('turn: the shipped bolt path bills it — a returned bolt that kills breaks the rank around it', async () => {
    const { bootWorld } = await import('./_coop.mjs');
    const { world } = await bootWorld({ level: 'geonosis', settings: { mode: 'waves', level: 'geonosis' } });
    try {
      const p = world.player;
      p.position.set(0, (world.terrain?.height(0, 0) ?? 0) + 0.05, 0);
      /**
       * THROUGH `World._boltHitTest`, WHICH IS THE ONLY PLACE THE BOLT AND THE
       * BODY ARE BOTH IN HAND. The bolt is stamped the way `_creditDeflect`
       * stamps one — `deflected`, a `deflector`, and the player's own team —
       * and then driven at a body that dies to it. Nothing here re-implements
       * the rule; the assertion is that the shipped path reaches the ledger.
       */
      const victim = world.spawnEnemy('b1', new THREE.Vector3(0, 0, 10));
      const mate = world.spawnEnemy('b1', new THREE.Vector3(2, 0, 10));
      assert(victim && mate, 'the pair would not stand up');
      victim.position.y = (world.terrain?.height(0, 10) ?? 0) + 0.02;
      mate.position.y = (world.terrain?.height(2, 10) ?? 0) + 0.02;
      /* TWO FRAMES FIRST. A body's `capsules()` are solved off its rig, and a
       * rig that has never been stepped is still at the bind pose sitting at
       * the origin — so a bolt driven at a freshly spawned body passes through
       * empty air and the check reports the ledger as unwired. */
      const idle2 = (await import('./_coop.mjs')).idleInput();
      world.update(1 / 60, idle2); world.update(1 / 60, idle2);
      victim.hp = 1;

      const before = nerveOf(mate);
      const bolt = world.bolts.fire(
        new THREE.Vector3(0, victim.position.y + 1.0, 4),
        new THREE.Vector3(0, 0, 1), { speed: 90, team: 0, damage: 60, owner: p });
      assert(bolt, 'no bolt came out of the pool');
      bolt.deflected = true; bolt.deflector = p; bolt.owner = p; bolt.team = 0;
      for (let i = 0; i < 240 && !victim.dead; i++) {
        world._boltHitTest(bolt, bolt.pos.clone(), bolt.pos.clone().add(new THREE.Vector3(0, 0, 0.25)));
        bolt.pos.z += 0.25;
        if (bolt.pos.z > 14) break;
      }
      assert(victim.dead, 'the returned bolt did not kill the body it was aimed at');
      const cost = before - nerveOf(mate);
      const want = Math.abs(NERVE.COMRADE_FELL) + Math.abs(NERVE.TURNED);
      assert(Math.abs(cost - want) < 1e-6,
        `the man beside him lost ${cost.toFixed(4)} against the ${want.toFixed(4)} a death plus a `
        + 'bolt sent home is worth — the shipped path is billing one of the two, or neither');
      return `victim down to its own bolt · the man 2 m away ${before.toFixed(3)} → `
        + `${nerveOf(mate).toFixed(3)} (-${cost.toFixed(3)})`;
    } finally { world.unload?.(); }
  });

  /* ══════════════════════════════════════════════════════════════════ */
  /*  The two verbs §7 names by name                                    */
  /* ══════════════════════════════════════════════════════════════════ */

  check('break: unleash and dread both move the ledger, and neither rewrites a name on a roll', async () => {
    const { bootWorld, idleInput } = await import('./_coop.mjs');
    const { world } = await bootWorld({ level: 'geonosis', settings: { mode: 'waves', level: 'geonosis' } });
    try {
      const p = world.player;
      p.position.set(0, (world.terrain?.height(0, 0) ?? 0) + 0.05, 0);
      p.saber.ignite(); p.saber.ignition = 1;
      const [near] = rank(world, 1, 4, 'b1');
      assert(near, 'nothing to unleash at');
      near.hp = 1e6;
      /* A BODY WITH A RECORD BESIDE IT. `shakeNerve` must leave it alone: that
       * number belongs to `CommandDirector.shake`, and in a meeting it is the
       * other player's roster. */
      const [named] = rank(world, 1, 5, 'b1');
      named.hp = 1e6;
      named.trooper = { morale: 0.9, alive: true };

      const was = nerveOf(near);
      p.force = p.maxForce;
      p.cooldowns.unleash = 0;
      p.forceUnleash({ input: idleInput(), dt: STEP, enemies: world.enemies, rules: world.rules });
      const now = nerveOf(near);
      assert(now < was,
        `unleash left the body four metres away at ${now.toFixed(3)} — §7 names this power by name `
        + 'and it is the loudest thing a Jedi can do');
      assert(Math.abs(now - (was + MORALE.SHAKEN)) < 1e-6,
        `unleash took ${(was - now).toFixed(3)} against MORALE.SHAKEN's ${Math.abs(MORALE.SHAKEN)} — `
        + 'the power has a second constant of its own, which is the twin this repository deletes');
      assert(named.trooper.morale === 0.9,
        `unleash rewrote a roster record to ${named.trooper.morale} from outside the one door that `
        + 'writes morale');
      return `unleash → ${was.toFixed(3)} → ${now.toFixed(3)} (MORALE.SHAKEN ${MORALE.SHAKEN}); `
        + 'a record beside it untouched';
    } finally { world.unload?.(); }
  });

  check('break: the per-second pass is one sweep and it skips every body that has a record', () => {
    /* CHEAP, and the point is the SKIP rather than the arithmetic: two writers
     * on one number is two answers to how frightened a man is, and
     * `CommandDirector._morale` already runs its own per-second pass over
     * exactly the bodies this one must not touch. */
    const horde = { position: new THREE.Vector3(1, 0, 0), team: 1, dead: false };
    const named = { position: new THREE.Vector3(1, 0, 0), team: 1, dead: false, trooper: { morale: 0.9 } };
    const blades = [{ position: new THREE.Vector3(), team: 0 }];
    nerveTick([horde, named], blades, 1);
    const perSecond = NERVE.BLADE + NERVE.RALLY_PER_S;
    assert(Math.abs(horde.nerve - (1 + perSecond)) < 1e-9,
      `a second under a blade left ${horde.nerve} against ${1 + perSecond} — the rally is paid every `
      + 'second and the blade is added to it, the way CommandDirector._morale sums its own terms');
    assert(named.trooper.morale === 0.9 && named.nerve === undefined,
      'the sweep wrote a body that has a roster record');
    /* …and a friendly blade is not a threat. */
    const ally = { position: new THREE.Vector3(1, 0, 0), team: 0, dead: false };
    nerveTick([ally], blades, 1);
    assert(ally.nerve === 1, `a body on the blade's own side lost nerve to it (${ally.nerve})`);
    /* …and out of contact it comes back at the roster's own rate. */
    const away = { position: new THREE.Vector3(60, 0, 0), team: 1, dead: false, nerve: 0.5 };
    nerveTick([away], blades, 1);
    assert(Math.abs(away.nerve - (0.5 + MORALE.RALLY_PER_S)) < 1e-9,
      `out of contact a body recovered ${(away.nerve - 0.5).toFixed(4)}/s against the roster's `
      + `${MORALE.RALLY_PER_S}`);
    return `under a blade ${NERVE.BLADE}/s inside ${NERVE.BLADE_REACH} m (net ${perSecond.toFixed(3)}/s) · `
      + `out of contact +${MORALE.RALLY_PER_S}/s · records skipped`;
  });

  /* ══════════════════════════════════════════════════════════════════ */
  /*  …AND WHAT IT COMES TO IN A BATTLE, WHICH IS NOT WHAT IT LOOKS     */
  /* ══════════════════════════════════════════════════════════════════ */

  check('break: what share of a real battle the horde spends broken, and what the player had to do for it', async () => {
    /**
     * EVERY CHECK ABOVE IS A HAND-BUILT FIELD, and every one of them passes.
     * What none of them can say is what SHARE of a real battle a real horde
     * spends broken, and that is the number §7's first verb is a claim about.
     *
     * ── WHAT IT USED TO READ, AND WHY ───────────────────────────────────────
     *
     *     2043 hostile body-seconds · broken 0.00% · refusing 0.00%
     *     steadiest-shaken body on the field 0.863, against a 0.24 line
     *
     * Not small. NONE — with the Jedi walked onto his own line's centroid every
     * frame, blade lit, never leaving. The cause was not the tuning of the two
     * terms that existed; it was their SHAPE. Both are billed by how many
     * bodies are near a point, the blade or the corpse, and measured over two
     * Geonosis Command battles (`tools/_nervewhy.mjs`) the horde puts
     *
     *     0.4 bodies inside `BLADE_REACH` of the Jedi at any instant
     *     0.44 s of a 32-second life inside it, and 25% of bodies ever enter
     *     1.1 witnesses inside `SEE` of a body going down
     *     ONE of its own side inside `SEE` of any given body
     *
     * — so the death channel's entire budget over a body's whole life is 0.037
     * against the 0.76 a break costs, and the blade channel's is 0.05. That
     * last line is the one that matters most and it is the one nobody had
     * taken: THE HORDE IS NOT A FORMATION. A body can see one of its own men.
     * §7's sentence — "walk into the front of a formation and it comes apart" —
     * describes a thing that is not on the field, and no radius reaches it: at
     * 30 m, which is the whole engagement, the mean body still only accumulates
     * 4.5 seconds of dwell, and teleporting the Jedi onto the horde's centroid
     * every frame reads 2.82% and 0.12%.
     *
     * ── SO THE VERB IS CARRIED BY THE BOLTS INSTEAD ─────────────────────────
     *
     * `NERVE.ANSWERED` — see its note. It is not a radius, so it does not care
     * where the player stands; it works at 7-42 m, which is where every ranged
     * archetype's `preferred` band puts the horde; and it is billed to the
     * player on `Combat.GUARD_COST`'s ladder and by having to be the thing the
     * horde is shooting at.
     *
     * ── AND THIS CHECK ASSERTS THE WIRING AND REPORTS THE SHARE ─────────────
     *
     * A bound on the share would be a bound on the wave composer, the spawn
     * cadence and the script's tactics at once — and the script is a MEDIOCRE
     * PLAYER, which is the single biggest term in the number below: it holds
     * one guard and never chooses a zone, and it answers about a quarter of the
     * fire aimed at it. The message carries `aimed` and `answered` beside the
     * share for exactly that reason, because the ratio between them is the
     * player's, not the ledger's, and it is what the verb pays out of.
     */
    const { bootWorld, idleInput } = await import('./_coop.mjs');
    const { world } = await bootWorld({
      level: 'geonosis',
      settings: { mode: 'command', level: 'geonosis', order: 'jedi', seed: 3, difficulty: 'knight' },
    });
    try {
      world.director.start(1);
      const p = world.player;
      p.saber.ignite(); p.saber.ignition = 1;
      const idle = idleInput();
      /* THE JEDI IS PUT IN THE RANK AND KEPT THERE. Not the flagship probe's
       * script — this is measuring the ledger, so the player is walked onto
       * the centroid of his own line each frame and left standing in it, which
       * is the single most favourable condition `NERVE.BLADE` can be given. */
      /* WHAT THE PLAYER HAD TO DO FOR IT, at the game's own two doors: the
       * pool stamps the owner of every bolt and `Enemy.target` is who its brain
       * picked, so `aimed` is fire the horde chose to send at the Jedi rather
       * than a geometric guess; `_onBoltDeflect` is the one door a turned bolt
       * arrives at. The ratio is the deflection rate the number below is paid
       * out of. */
      let aimed = 0, answered = 0;
      const fire = world.bolts.fire.bind(world.bolts);
      world.bolts.fire = (from, dir, o = {}) => {
        if (o.owner && o.owner.team !== p.team && o.owner.target === p) aimed++;
        return fire(from, dir, o);
      };
      const od = world._onBoltDeflect.bind(world);
      world._onBoltDeflect = (b, entry, hit, at) => {
        if (entry && entry.owner === p && b.owner && b.owner.team !== p.team) answered++;
        return od(b, entry, hit, at);
      };
      /* …AND HOW MANY OF ITS OWN SIDE A BODY CAN SEE, which is the formation's
       * own density and the reason the two proximity terms cannot reach.
       * Sampled rather than integrated: it is a picture of the field, not a
       * quantity anything is billed against. */
      let seenSum = 0, seenN = 0;
      let secs = 0, hostileSeconds = 0, brokenSeconds = 0, refusingSeconds = 0, worst = 1, ticked = 0;
      const brokeEver = new Set(), sawBodies = new Set();
      for (let i = 0; i < 2700; i++) {
        let ax = 0, az = 0, n = 0;
        for (const t of (world.command?.commander?.roster.living || [])) {
          const b = t.body;
          if (!b || b.dead) continue;
          ax += b.position.x; az += b.position.z; n++;
        }
        if (n) {
          p.position.x = ax / n; p.position.z = az / n;
          p.position.y = (world.terrain?.height(p.position.x, p.position.z) ?? 0) + 0.05;
        }
        if (p.saber.ignition < 1) p.saber.ignition = 1;
        world.update(STEP, idle);
        secs += STEP;
        for (const e of world.enemies) {
          if (e.dead || e.trooper || e.team === p.team) continue;
          hostileSeconds += STEP;
          sawBodies.add(e);
          if (typeof e.nerve === 'number') ticked++;
          if (nerveOf(e) < MORALE.BREAK) { brokenSeconds += STEP; brokeEver.add(e); }
          if (nerveOf(e) < MORALE.REFUSE) refusingSeconds += STEP;
          worst = Math.min(worst, nerveOf(e));
          if (i % 60 === 0) {
            let seen = 0;
            for (const o of world.enemies) {
              if (o === e || o.dead || o.team !== e.team) continue;
              const dx = o.position.x - e.position.x, dz = o.position.z - e.position.z;
              if (dx * dx + dz * dz <= NERVE.SEE * NERVE.SEE) seen++;
            }
            seenSum += seen; seenN++;
          }
        }
      }
      assert(hostileSeconds > 100,
        `only ${hostileSeconds.toFixed(0)} hostile body-seconds in ${secs.toFixed(0)} game-seconds — `
        + 'there was no battle to measure');
      assert(ticked > 0,
        'not one hostile body on the field carries a nerve at all — `nerveTick` is not reaching the '
        + 'live roster, so §7\'s first verb is a module nothing calls');
      assert(worst < 1 - 1e-6,
        `the steadiest-shaken body on the field after ${secs.toFixed(0)} game-seconds of a lit blade `
        + `standing in the line still reads ${worst.toFixed(3)} — the ledger is wired but nothing in `
        + 'the battle moves it, and the verb is decorative');
      const bp = 100 * brokenSeconds / hostileSeconds, rp = 100 * refusingSeconds / hostileSeconds;
      const seen = seenSum / Math.max(1, seenN);
      return `${hostileSeconds.toFixed(0)} hostile body-seconds · broken ${bp.toFixed(2)}% · `
        + `refusing ${rp.toFixed(2)}% · ${brokeEver.size} of ${sawBodies.size} bodies broke at least `
        + `once · steadiest-shaken ${worst.toFixed(3)} against a ${MORALE.BREAK} line · the player `
        + `answered ${answered} of ${aimed} bolts aimed at him `
        + `(${(100 * answered / Math.max(1, aimed)).toFixed(0)}%) · a body can see ${seen.toFixed(1)} `
        + 'of its own side';
    } finally { world.unload?.(); }
  });
}
