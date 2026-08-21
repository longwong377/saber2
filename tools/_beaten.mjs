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
async function firingLine({ n = 20, range = 14, spread = 1.2, seconds = 30 } = {}) {
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
    const e = world.spawnEnemy('b1', new THREE.Vector3(x, 0, z));
    if (e) e.position.y = (world.terrain?.height(x, z) ?? 0) + 0.02;
  }

  const input = guardInput();
  const trace = [];
  let fired = 0, answered = 0, arrivals = 0;
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
  for (let i = 0; i < frames; i++) {
    const before = p.stamina;
    input.act = (id) => id === 'blade';
    world.update(STEP, input);
    t += STEP;
    if (p.stamina <= 0.001 && emptyAt === null) emptyAt = +t.toFixed(2);
    if (i % 30 === 0) trace.push({ t: +t.toFixed(1), stam: +p.stamina.toFixed(1), force: +p.force.toFixed(1), hp: +p.hp.toFixed(1) });
    void before;
    if (!p.alive) break;
  }
  const out = {
    rifles: n, range, seconds: +t.toFixed(1),
    fired, firedPerS: +(fired / t).toFixed(2),
    answeredShare: fired ? +(answered / fired).toFixed(3) : 0,
    alive: p.alive,
    stamina: +p.stamina.toFixed(1), force: +p.force.toFixed(1),
    /* WHETHER THE REFILL IS STILL RUNNING. `Player._regen` pauses on
     * `staminaHold`, and §6's whole arithmetic is a drain racing that refill —
     * so a guard cost that set it would be a different mechanic wearing the
     * same numbers. Read off the player, not asserted from the constant. */
    staminaHold: +(p.staminaHold || 0).toFixed(3),
    hpLost: +(hp0 - p.hp).toFixed(1),
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
export { firingLine, guardInput, STEP };

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
