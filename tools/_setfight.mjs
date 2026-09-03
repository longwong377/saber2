/**
 * THE THREE SETS IN A FIGHT — throw-one-keep-one, two-tempo, and four bodies.
 *
 * Everything here drives the shipped world: real bodies, the real solver, the
 * real bolt ladder. Nothing recomputes a rule it is measuring.
 */
import './dom-shim.mjs';
import * as THREE from 'three';
const H = await import('./checks/_coop.mjs');
const STEP = 1 / 60;
const UP = new THREE.Vector3(0, 1, 0);

export async function bootSet(setId, { level = 'colosseum', fullBar = true } = {}) {
  const { world } = await H.bootWorld({
    level, settings: { mode: 'waves', quality: 'low', instantSpawn: true, saberSet: setId },
  });
  const p = world.player;
  let want = 0;
  const input = H.idleInput();
  input.actHit = (a) => (a === 'thrust' && want > 0) ? (want--, true) : false;
  for (let i = 0; i < 40; i++) world.update(STEP, input);
  p.force = p.maxForce; p.hp = p.maxHp; p.stamina = 100;
  const ctx = { input, terrain: world.terrain, physics: world.physics,
    particles: world.particles, bolts: world.bolts, camera: world.engine.camera,
    time: world.time, enemies: world.enemies, players: world.players };
  const clear = () => { for (const e of world.enemies) e.dispose(); world.enemies.length = 0; };
  clear();
  /** A dummy that cannot die, cannot move and cannot fight back. */
  const dummy = (a = 0, d = 1.3) => {
    const dir = p.aimDir.clone().setY(0).normalize().applyAxisAngle(UP, a);
    const at = p.position.clone().addScaledVector(dir, d);
    at.y = world.terrain.height(at.x, at.z);
    const e = world.spawnEnemy('b1', at);
    e.hp = e.maxHp = 1e9;
    e._home = at;
    return e;
  };
  /**
   * Steps `n` frames, pinning every dummy where it was put AND THE PLAYER WHERE
   * THEY STOOD.
   *
   * The player pin is not tidiness. A light cut opens the lunge, so a mashed
   * attack walks the body forward about 0.2 m a swing and does not walk it
   * back: measured without this, 22 accepted strikes produced contacts on 3 of
   * them because by the fourth swing the fighter had strolled past the man.
   */
  const home = p.position.clone();
  const step = (n) => {
    for (let i = 0; i < n; i++) {
      for (const e of world.enemies) if (e._home) { e.position.copy(e._home); e.velocity?.set?.(0, 0, 0); }
      p.position.copy(home); p.velocity.set(0, 0, 0);
      /* AND THE BAR IS HELD FULL. Mashing the attack is stamina-bound within
       * three swings, so without this the cadence measured is the STAMINA's and
       * not the weapon's — every set converges on one strike per 0.85 s, which
       * is the regen rate wearing three different costumes. */
      if (fullBar) p.stamina = 100;
      world.update(STEP, input);
    }
  };
  const swing = () => { want = 1; };
  /**
   * Every blade event, WITH THE BLADE THAT MADE IT. The solver is asked once
   * per blade, so which call is running says which blade landed the contact —
   * no new field on the event and nothing in src/ that exists for a probe.
   */
  const log = [], strikes = [];
  const orig = world._applyBladeEvent.bind(world);
  const solve = world.bladeSolver.solve.bind(world.bladeSolver);
  let frame = 0, which = 'main';
  world.bladeSolver.solve = (sab, t, dt, o) => {
    which = sab === p.saber ? 'main' : (sab === p.sidearm?.saber ? 'off' : 'other');
    return solve(sab, t, dt, o);
  };
  world._applyBladeEvent = (pl, ev, dt) => {
    log.push({ t: frame * STEP, type: ev.type, id: ev.target?.id ?? null, work: ev.dWork ?? 0, blade: which });
    return orig(pl, ev, dt);
  };
  /* A STRIKE IS THE CONTROLLER'S OWN, not a guess off the contacts: `slashT`
   * goes from -1 to 0 on the frame a light cut starts, which is the press the
   * player made. */
  let wasT = -1;
  const wrapped = (n) => {
    for (let i = 0; i < n; i++) {
      step(1); frame++;
      const t = p.control.slashT;
      if (t >= 0 && wasT < 0) strikes.push(frame * STEP);
      wasT = t;
    }
  };
  return { world, p, ctx, input, step: wrapped, swing, dummy, clear, log, strikes,
    frameAt: () => frame };
}

/**
 * FROM ONE LANDED STRIKE TO THE NEXT ONE THAT LANDS.
 *
 * A strike is a press the controller accepted (`slashT` leaving -1); a landed
 * strike is one that produced at least one contact before the next strike
 * began. The gap is between the FIRST CONTACTS of consecutive landed strikes,
 * which is exactly "how long until the follow-up arrives" and is immune to how
 * long a blade lies in a body once it is there.
 */
export function tempo(log, strikes) {
  const first = [];
  for (let i = 0; i < strikes.length; i++) {
    const from = strikes[i], to = strikes[i + 1] ?? Infinity;
    const e = log.find((x) => x.t >= from && x.t < to);
    if (e) first.push(e.t);
  }
  const gaps = [];
  for (let i = 1; i < first.length; i++) gaps.push(first[i] - first[i - 1]);
  gaps.sort((a, b) => a - b);
  const at = (q) => gaps.length ? gaps[Math.min(gaps.length - 1, Math.floor(q * gaps.length))] : Infinity;
  return { strikes: strikes.length, landed: first.length, gaps,
    fastest: at(0), quarter: at(0.25), median: at(0.5) };
}

/**
 * THE DISTANCE AT WHICH THIS SET'S PARKED BLADE IS NOT ALREADY IN THE BODY.
 *
 * Measured per set and never typed, because the three sets are held at three
 * different measures: a staff at rest already has its tip 2.06 m out and a
 * single blade 1.72, so ONE fixed distance measures a swing in one set and a
 * blade resting inside a torso in another. The first cut of the two-tempo
 * number did exactly that and reported 200 contacts collapsing into 3 "hits".
 */
export function measureOut(b, a = 0) {
  for (let d = 1.0; d < 3.2; d += 0.05) {
    b.clear();
    const e = b.dummy(a, d);
    b.log.length = 0;
    b.step(45);
    const quiet = b.log.length === 0;
    b.clear();
    if (quiet) return d;
  }
  return 3.2;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  /* ── 4. TWO-TEMPO: from one landed strike to the next ───────────────── */
  console.log('TWO-TEMPO — one body at each set\'s own measure, the attack mashed');
  for (const set of ['single', 'staff', 'pair']) {
    const b = await bootSet(set);
    /* A FRESH BODY EVERY HALF SECOND. A B1 held at 1e9 hp does not die, but it
     * does come APART — measured, the first second of contacts took both arms
     * and a leg off, after which the blade swept through a torso lying on the
     * floor and 21 of 22 strikes touched nothing. The tempo is a property of
     * the weapon, so the target must not decay under it. */
    b.log.length = 0; b.strikes.length = 0;
    for (let i = 0; i < 900; i++) {
      if (i % 30 === 0) { b.clear(); b.dummy(0, 1.20); }
      if (i % 6 === 0) b.swing();
      b.step(1);
    }
    const t = tempo(b.log, b.strikes);
    const off = b.log.filter((e) => e.blade === 'off').length;
    console.log(`  ${set.padEnd(7)} ${t.landed}/${t.strikes} strikes landed · follow-up:`
      + ` fastest ${t.fastest.toFixed(3)} s, lower quartile ${t.quarter.toFixed(3)}, median ${t.median.toFixed(3)}`
      + ` · ${off}/${b.log.length} contacts off the second blade`);
    b.world.unload();
  }

  /* ── 5. FOUR HOSTILES AT ONCE ───────────────────────────────────────── */
  console.log('\nFOUR BODIES IN THE ARC — at -57, -20, +20 and +57 degrees, each at the set\'s own measure');
  for (const set of ['single', 'staff', 'pair']) {
    const b = await bootSet(set);
    b.log.length = 0; b.strikes.length = 0;
    for (let i = 0; i < 900; i++) {
      if (i % 30 === 0) { b.clear(); for (const a of [-1.0, -0.35, 0.35, 1.0]) b.dummy(a, 1.20); }
      if (i % 6 === 0) b.swing();
      b.step(1);
    }
    const work = b.log.reduce((s, e) => s + e.work, 0);
    /* HOW MANY OF THE FOUR ARE ANSWERED IN ONE HALF-SECOND WINDOW — the same
     * window the four are replaced on, so ids cannot be counted twice. */
    const win = new Map();
    for (const e of b.log) {
      const k = Math.floor(e.t / 0.5);
      if (!win.has(k)) win.set(k, new Set());
      win.get(k).add(e.id);
    }
    const counts = [...win.values()].map((v) => v.size);
    const mean = counts.reduce((a, c) => a + c, 0) / Math.max(counts.length, 1);
    const off = b.log.filter((e) => e.blade === 'off');
    console.log(`  ${set.padEnd(7)} ${mean.toFixed(2)} of the 4 answered per half-second`
      + ` (best ${Math.max(...counts)}), work ${work.toFixed(1)}`
      + ` · ${off.length}/${b.log.length} contacts off the second blade`);
    b.world.unload();
  }

  /* ── 3. THROW ONE, KEEP ONE ─────────────────────────────────────────── */
  console.log('\nTHROW ONE AND KEEP ONE — the pair, with the shoto in the air');
  {
    const shots = (b, n = 12) => {
      let landed = 0;
      for (let i = 0; i < n; i++) {
        b.p.hp = b.p.maxHp;
        const away = b.p.aimDir.clone().setY(0).normalize().applyAxisAngle(UP, (i % 5 - 2) * 0.10);
        b.world.bolts.fire(b.p.chest.clone().addScaledVector(away, 9), away.clone().negate(),
          { speed: 60, team: 1, damage: 10 });
        const hp = b.p.hp; b.step(11);
        if (b.p.hp < hp - 1e-6) landed++;
      }
      return landed;
    };
    const b = await bootSet('pair');
    b.dummy(0, 1.20);
    const held = shots(b);
    b.log.length = 0;
    for (let i = 0; i < 180; i++) {
      if (i % 30 === 0) { b.clear(); b.dummy(0, 1.20); }
      if (i % 6 === 0) b.swing(); b.step(1);
    }
    const cutHeld = b.log.length;

    b.p.force = b.p.maxForce; b.p.cooldowns.throwOff = 0;
    b.p.throwOffBlade(b.ctx);
    const flying = b.p.sidearm.throwState;
    b.log.length = 0;
    for (let i = 0; i < 180 && b.p.sidearm.throwState !== 'held'; i++) {
      if (i % 30 === 0) { b.clear(); b.dummy(0, 1.20); }
      if (i % 6 === 0) b.swing(); b.step(1);
    }
    const cutOut = b.log.length;
    // Keep it out for the bolt run: the flight is 1.5 s and this is longer.
    /* THE SHOTO IS SENT OUT AGAIN WHENEVER IT COMES HOME, so the whole bolt
     * run is measured with the pair genuinely one blade down. */
    let gone = 0;
    for (let i = 0; i < 12; i++) {
      b.p.force = b.p.maxForce; b.p.cooldowns.throwOff = 0;
      if (b.p.sidearm.throwState === 'held') b.p.throwOffBlade(b.ctx);
      b.p.hp = b.p.maxHp;
      const away = b.p.aimDir.clone().setY(0).normalize().applyAxisAngle(UP, (i % 5 - 2) * 0.10);
      b.world.bolts.fire(b.p.chest.clone().addScaledVector(away, 9), away.clone().negate(),
        { speed: 60, team: 1, damage: 10 });
      const hp = b.p.hp; b.step(11);
      if (b.p.hp < hp - 1e-6) gone++;
    }

    // …and the control that says the blade is what was blocking: put it down.
    b.p.saberDown = true;
    b.step(20);
    const bare = shots(b);
    console.log(`  throw → ${flying}; hands ${b.p.handsOnHilt()}`);
    console.log(`  contacts landed in 3 s: both in hand ${cutHeld}, shoto in the air ${cutOut}`);
    console.log(`  bolts through: both in hand ${held}/12, shoto out ${gone}/12, blade down ${bare}/12`);
    b.world.unload();
  }
}
