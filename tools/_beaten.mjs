/**
 * BATTLEFRONT BORZ — FLAGSHIP §6's TWELVE SECONDS AND ITS BEATEN ZONE.
 *
 *   node --import ./tools/register.mjs tools/_beaten.mjs [--rifles 20] [--range 14]
 *   node --import ./tools/register.mjs tools/_beaten.mjs sweep
 *
 * §6 states the design arithmetic and NOT a measurement: twenty B1s fire 18
 * bolts a second, at 1.2 stamina a block that is 21.6/s against a 16/s regen
 * and a 100 pool, so the bar is empty in about twelve seconds. Every term in
 * that sentence is an assumption about a real fight — that every bolt fired
 * arrives, that every bolt that arrives is answered, and that every answer is a
 * BLOCK. This probe stands a real Player on a real World in front of real B1s
 * and reads the bar.
 *
 * The player HOLDS THE GUARD and does nothing else. That is the honest floor:
 * a person who works the blade earns DEFLECTs and RETURNs, which cost a third
 * and nothing, so any figure here is the most suppression a given wall of fire
 * can apply. `_flagship.mjs`'s note on the same choice applies — a script that
 * fights is measuring the script.
 */

import './dom-shim.mjs';
import * as THREE from 'three';
import { resolve } from 'node:path';
import { bootWorld } from './checks/_coop.mjs';

const argv = process.argv.slice(2);
const CMD = argv[0] && !argv[0].startsWith('--') ? argv[0] : 'one';
const flag = (n, d) => { const i = argv.indexOf('--' + n); return i >= 0 ? Number(argv[i + 1]) : d; };
const STEP = 1 / 60;

/**
 * TWO KINDS OF SHOOTER IN ONE WORLD, and every point of damage attributed to
 * the archetype that fired it.
 *
 * WHY IT EXISTS AND `firingLine` DOES NOT ANSWER THIS. Comparing two roster
 * rows by booting a world for each is comparing two worlds: measured, the same
 * B1 arm read 3.485, 3.468 and 2.805 hp/s across three runs of the identical
 * call — a 24% spread on the CONTROL, which is more than the difference the
 * comparison is trying to see. Level dressing, prop placement and the weather
 * are not the same between two boots, and a gun's own scatter needs a long
 * sample before it settles.
 *
 * So both kinds stand on one field, at one range, under one sky, shooting one
 * player, and the tally is taken off `Player.damage`'s `source` — which is the
 * body that fired the bolt. Every confound between the two arms is gone by
 * construction, because there are no longer two arms: there is one measurement
 * with two columns.
 */
async function mixedLine({ types = ['b1', 'conscript'], each = 4, range = 12, seconds = 90 } = {}) {
  const { world } = await bootWorld({
    level: 'geonosis',
    settings: { mode: 'waves', level: 'geonosis', difficulty: 'knight' },
  });
  const p = world.player;
  p.position.set(0, (world.terrain?.height(0, 0) ?? 0) + 0.05, 0);
  /* Blade down: with a guard up, what reaches the player is what the guard
   * missed, and that is a measurement of the guard. */
  p.saber.ignition = 0;
  p.camera.yaw = Math.PI;

  /* INTERLEAVED ROUND THE ARC, not one type to a side: a body's range, its
   * line of sight and the ground under it all vary along the arc, and blocking
   * the two types would hand one of them the better half of the field. */
  const n = types.length * each;
  const spread = 1.4;
  for (let i = 0; i < n; i++) {
    const a = -spread / 2 + (n > 1 ? spread * i / (n - 1) : 0);
    const x = Math.sin(a) * range, z = Math.cos(a) * range;
    const e = world.spawnEnemy(types[i % types.length], new THREE.Vector3(x, 0, z));
    if (e) { e.position.y = (world.terrain?.height(x, z) ?? 0) + 0.02; e.hp = 1e6; }
  }

  const took = new Map(types.map((t) => [t, 0]));
  const damage = p.damage.bind(p);
  /* Variadic past the two arguments it reads (HANDOFF §6.1a): `Player.damage`
   * has grown an argument once already and a wrapper that names the list drops
   * the next one silently. */
  p.damage = (amount, point, source, ...rest) => {
    const before = p.hp;
    const out = damage(amount, point, source, ...rest);
    const lost = before - p.hp;
    if (lost > 0 && source && took.has(source.type)) took.set(source.type, took.get(source.type) + lost);
    return out;
  };

  const input = guardInput();
  input.act = () => false;
  const frames = Math.round(seconds / STEP);
  let t = 0;
  for (let i = 0; i < frames; i++) {
    world.update(STEP, input);
    t += STEP;
    /* Topped up before it can die, for `firingLine`'s reason: the death path
     * must not run inside a measurement. Nothing is added to the tally here —
     * the tally is taken at the door, per blow. */
    if (p.hp < p.maxHp * 0.35) p.hp = p.maxHp;
  }
  world.unload?.();
  return {
    seconds: +t.toFixed(1), each,
    dps: Object.fromEntries(types.map((k) => [k, +(took.get(k) / t / each).toFixed(3)])),
  };
}

/** Holds the guard and nothing else. See the header. */
function guardInput() {
  return {
    keys: new Set(), buttons: [false, false, false],
    mouse: { dx: 0, dy: 0, wheel: 0, left: false, right: false },
    delta: { x: 0, y: 0 }, accel: { x: 0, y: 0 }, bindings: null,
    moveAxis: (o) => { if (o) { o.x = 0; o.y = 0; return o; } return { x: 0, y: 0 }; },
    act: (id) => id === 'blade',
    actHit: () => false, actDown: () => false, end() {},
  };
}

/**
 * A firing line of `n` B1s on an arc of `spread` radians at `range` metres,
 * every one of them looking at the player.
 */
async function firingLine({ n = 20, range = 14, spread = 1.2, seconds = 30, type = 'b1', guard = true } = {}) {
  const { world } = await bootWorld({
    level: 'geonosis',
    settings: { mode: 'waves', level: 'geonosis', difficulty: 'knight' },
  });
  const p = world.player;
  p.position.set(0, 0, 0);
  p.position.y = (world.terrain?.height(0, 0) ?? 0) + 0.05;
  p.saber.ignite(); p.saber.ignition = 1;
  p.camera.yaw = Math.PI;                       // looking down +z, at the line

  for (let i = 0; i < n; i++) {
    const a = -spread / 2 + (n > 1 ? spread * i / (n - 1) : 0);
    const x = Math.sin(a) * range, z = Math.cos(a) * range;
    const e = world.spawnEnemy(type, new THREE.Vector3(x, 0, z));
    if (e) e.position.y = (world.terrain?.height(x, z) ?? 0) + 0.02;
  }

  const input = guardInput();
  const trace = [];
  let fired = 0, answered = 0, arrivals = 0, revived = 0, topUps = 0;
  /* EVERY BOLT THE LINE PUT IN THE AIR. §6's arithmetic starts from "twenty
   * B1s fire 18 bolts a second", which is a claim about the ARCHETYPE's
   * fireRate and burst read off the table; what a firing line at a range
   * actually emits is a different number and it is the denominator every share
   * below is taken against. */
  const fire = world.bolts.fire.bind(world.bolts);
  world.bolts.fire = (...a) => { const b = fire(...a); if (b && b.team === 1) fired++; return b; };
  /* EVERY BOLT THE GUARD ANSWERED, counted at the shipped callback rather than
   * off the deflect counter, so a bolt that is caught and thrown later is one
   * answer and not two. HANDOFF §2.4: the game says what an answer is. */
  const onDeflect = world.bolts.onDeflect;
  world.bolts.onDeflect = (...a) => { answered++; return onDeflect.apply(world.bolts, a); };
  const hitTest = world._boltHitTest.bind(world);
  world._boltHitTest = (...a) => { const r = hitTest(...a); if (r && r.victim === p) arrivals++; return r; };

  const frames = Math.round(seconds / STEP);
  let emptyAt = null, t = 0;
  const hp0 = p.hp;
  /* `guard: false` PUTS THE BLADE DOWN, which is the only honest way to read a
   * body's raw damage: with a guard up, what reaches the player is what the
   * blade missed, and that is a measurement of the guard. */
  if (!guard) { input.act = () => false; p.saber.ignition = 0; }
  for (let i = 0; i < frames; i++) {
    const before = p.stamina;
    if (guard) input.act = (id) => id === 'blade';
    world.update(STEP, input);
    t += STEP;
    if (p.stamina <= 0.001 && emptyAt === null) emptyAt = +t.toFixed(2);
    if (i % 30 === 0) trace.push({ t: +t.toFixed(1), stam: +p.stamina.toFixed(1), force: +p.force.toFixed(1), hp: +p.hp.toFixed(1) });
    void before;
    /**
     * A DEAD PLAYER MEASURES NOTHING — AND A REVIVED ONE MEASURES THE WRONG
     * THING, which cost a reading before it was written down.
     *
     * The first version let the player die and stood it back up. Measured, that
     * takes the answered share of a twenty-rifle line from 68% to 47% and the
     * drain from 10.8/s to 7.0/s, because `Player.die` puts the blade out and
     * drops the guard: what came back up was a body with no answer in it, and
     * the run went on billing seconds against a guard that was not there.
     *
     * So the body is topped up BEFORE it can die, at the same 35% floor
     * `tools/_flagship.mjs` uses and for the same reason — the death path
     * never runs, so nothing about the guard changes mid-measurement. Every
     * point handed back is added to the tally, or the damage rate would be
     * under-reported by exactly the interventions.
     */
    if (p.hp < p.maxHp * 0.35) { topUps++; revived += p.maxHp - p.hp; p.hp = p.maxHp; }
  }
  const out = {
    type, rifles: n, range, seconds: +t.toFixed(1),
    /* HEALTH A SECOND, per shooter. §6 prices a B1 at 2.17 dps against a
     * MOVING player and a conscript at 1.4; this player is standing still, so
     * both figures here are higher than either and only their RATIO is
     * comparable across the two. */
    dpsPerRifle: +((hp0 - p.hp + revived) / t / Math.max(1, n)).toFixed(3),
    fired, firedPerS: +(fired / t).toFixed(2),
    answeredShare: fired ? +(answered / fired).toFixed(3) : 0,
    topUps, revived: +revived.toFixed(1),
    stamina: +p.stamina.toFixed(1), force: +p.force.toFixed(1),
    /* WHETHER THE REFILL IS STILL RUNNING. `Player._regen` pauses on
     * `staminaHold`, and §6's whole arithmetic is a drain racing that refill —
     * so a guard cost that set it would be a different mechanic wearing the
     * same numbers. Read off the player, not asserted from the constant. */
    staminaHold: +(p.staminaHold || 0).toFixed(3),
    hpLost: +(hp0 - p.hp + revived).toFixed(1),
    guardSpent: +(p.guardSpent || 0).toFixed(1),
    guardForceSpent: +(p.guardForceSpent || 0).toFixed(1),
    answered, answeredPerS: +(answered / t).toFixed(2),
    boltsOnBody: arrivals,
    drainPerS: +((p.guardSpent || 0) / t).toFixed(2),
    forceDrainPerS: +((p.guardForceSpent || 0) / t).toFixed(2),
    emptyAt,
    deflects: p.deflects, perfects: p.perfects,
    trace,
  };
  world.unload?.();
  return out;
}

/**
 * ONLY WHEN THIS FILE IS THE ONE THAT WAS RUN — the same guard, and for the
 * same reason, as `tools/_flagship.mjs`'s. `tools/checks/suppression.mjs`
 * imports `firingLine` so the gate measures the line the probe measures rather
 * than a second copy of it; a module that runs a sweep at import time makes
 * that impossible.
 */
const ENTRY = process.argv[1] && resolve(process.argv[1]) === resolve(new URL(import.meta.url).pathname);
export { firingLine, mixedLine, guardInput, STEP };

if (!ENTRY) { /* imported: the CLI below is not this module's business */ }
else if (CMD === 'one') {
  const r = await firingLine({ n: flag('rifles', 20), range: flag('range', 14), seconds: flag('seconds', 30) });
  console.log(JSON.stringify({ ...r, trace: undefined }, null, 2));
  console.log('\n  t   stamina  force   hp');
  for (const s of r.trace) console.log(`  ${String(s.t).padStart(4)}  ${String(s.stam).padStart(6)}  ${String(s.force).padStart(6)}  ${String(s.hp).padStart(5)}`);
} else if (CMD === 'sweep') {
  const range = flag('range', 14);
  console.log(`  rifles at ${range} m · guard held, nothing else`);
  console.log('  n    fired/s  answered/s  drain/s  net/s   stamina@30s  empty at   hp lost');
  for (const n of [1, 4, 8, 12, 16, 20, 28]) {
    const r = await firingLine({ n, range, seconds: 30 });
    const net = +(16 - r.drainPerS).toFixed(2);
    console.log(`  ${String(n).padStart(2)}   ${String(r.firedPerS).padStart(7)}  ${String(r.answeredPerS).padStart(9)}  ${String(r.drainPerS).padStart(7)}  `
      + `${String(net).padStart(6)}  ${String(r.stamina).padStart(10)}  ${String(r.emptyAt ?? '—').padStart(8)}  ${String(r.hpLost).padStart(7)}`);
  }
} else if (CMD === 'mixed') {
  const r = await mixedLine({ seconds: flag('seconds', 90), each: flag('each', 4) });
  console.log(JSON.stringify(r, null, 2));
} else if (CMD === 'class') {
  /* THE THIRD BODY CLASS AGAINST THE ONE IT IS A WORSE COPY OF. Same harness,
   * same range, same seconds, blade down — so the ratio is a fact about the
   * two roster rows and not about the guard. */
  const secs = flag('seconds', 40);
  console.log(`  one shooter, blade down, ${secs} s`);
  console.log('  type        hp/s   hp   score   threat   turned passes');
  const { ARCHETYPES, guardFor } = await import('../src/game/Enemy.js');
  for (const type of ['b1', 'conscript']) {
    const r = await firingLine({ n: 1, range: 12, seconds: secs, type, guard: false });
    const A = ARCHETYPES[type];
    console.log(`  ${type.padEnd(10)}  ${String(r.dpsPerRifle).padStart(5)}  ${String(A.hp).padStart(3)}  `
      + `${String(A.score).padStart(5)}  ${String(A.threat).padStart(6)}  ${String(guardFor(A)).padStart(13)}`);
  }
} else if (CMD === 'ranges') {
  const n = flag('rifles', 20);
  console.log(`  ${n} rifles · the player at range`);
  console.log('  range  answered/s  drain/s  stamina@30s  empty at  hp lost');
  for (const range of [6, 10, 14, 20, 28, 40]) {
    const r = await firingLine({ n, range, seconds: 30 });
    console.log(`  ${String(range).padStart(5)}  ${String(r.answeredPerS).padStart(9)}  ${String(r.drainPerS).padStart(7)}  `
      + `${String(r.stamina).padStart(10)}  ${String(r.emptyAt ?? '—').padStart(8)}  ${String(r.hpLost).padStart(7)}`);
  }
}
