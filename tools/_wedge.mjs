/**
 * CENSUS — how many men in an ordered formation move end up wedged on level
 * geometry, over six arms of the shipped Geonosis.
 *
 * This is the wide version of the single arm `tools/checks/movement.mjs` gates
 * on, and it is what produced the numbers quoted there and in `Enemy._move`:
 *
 *     before   4 of 54 men wedged, in 3 of 6 arms, EVERY ONE OF THEM against
 *              the same rock: they stand at (-3.03..-3.74, 2.37..2.57), and of
 *              the level's 233 static boxes the nearest to each of them is the
 *              one centred at (-1.78, 4.23), at 2.2-2.6 m — the next nearest to
 *              any of them is 20 m off. Furthest living man from the formation
 *              anchor 34.8-35.8 m in the arms that had one.
 *     after    0 of 54, in 0 of 6. Furthest man 12.0-14.2 m.
 *
 * WEDGED here is a fact about GROUND COVERED and not about velocity — the four
 * it caught read 0.7-6.0 m/s the whole time they were going nowhere, and any
 * test that watched the velocity would have called them healthy. A body that
 * wants to be somewhere else (its slot more than 3 m away) and whose net XZ
 * displacement over a rolling 3 s window is under 1 m is not walking. `Nf` in
 * the output is the whole span including that window, so the shortest thing it
 * can report is 90 frames.
 *
 *   node --import ./tools/register.mjs tools/_wedge.mjs
 */
import './dom-shim.mjs';
import { bootWorld } from './checks/_coop.mjs';

const walk = { keys: new Set(), buttons: [false, false, false],
  mouse: { dx: 0, dy: 0, wheel: 0, left: false, right: false },
  delta: { x: 0, y: 0 }, accel: { x: 0, y: 0 },
  moveAxis: (o) => (o ? (o.x = 0, o.y = 1, o) : { x: 0, y: 1 }),
  act: () => false, actHit: () => false, actDown: () => false, end() {} };
const idle = { ...walk, moveAxis: (o) => (o ? (o.x = 0, o.y = 0, o) : { x: 0, y: 0 }) };
const DT = 1 / 30, WIN = 90, GAP = 1.0, WANT = 3;

async function arm(seed) {
  const { world } = await bootWorld({ level: 'geonosis',
    settings: { mode: 'command', level: 'geonosis', order: 'jedi', seed, difficulty: 'knight' } });
  const d = world.command, p = world.player;
  world.director.start(1); d.spawnQueue.length = 0;
  for (let i = 0; i < 60; i++) world.update(DT, idle);
  const men = d.commander.roster.living.map((t) => t.body).filter(Boolean);
  const hist = new Map(men.map((e) => [e, []]));
  const worst = new Map(men.map((e) => [e, { run: 0, best: 0, at: null, lo: Infinity, hi: 0, rlo: Infinity, rhi: 0 }]));
  const from = p.position.clone();
  for (let i = 0; i < 900; i++) {
    world.update(DT, walk);
    for (const e of men) {
      const h = hist.get(e), w = worst.get(e);
      if (e.dead) continue;
      h.push([e.position.x, e.position.z, (e.cmdSlotDist ?? 0) > WANT]);
      if (h.length > WIN) h.shift();
      if (h.length === WIN && h.every((r) => r[2])) {
        const net = Math.hypot(h[WIN - 1][0] - h[0][0], h[WIN - 1][1] - h[0][1]);
        if (net < GAP) {
          w.run++;
          /* THE SPEED WHILE GOING NOWHERE is the whole point: a wedged body is
           * not a stopped one, and a check that read velocity would have called
           * this man healthy. `rlo`/`rhi` band the CURRENT run and are promoted
           * with it, so what gets printed is the speed over the longest stall
           * rather than over one frame of it. */
          const v = Math.hypot(e.velocity.x, e.velocity.z);
          w.rlo = Math.min(w.rlo, v); w.rhi = Math.max(w.rhi, v);
          if (w.run > w.best) {
            w.best = w.run; w.at = [+e.position.x.toFixed(2), +e.position.z.toFixed(2)];
            w.lo = w.rlo; w.hi = w.rhi;
          }
        } else { w.run = 0; w.rlo = Infinity; w.rhi = 0; }
      } else { w.run = 0; w.rlo = Infinity; w.rhi = 0; }
    }
    if (p.position.distanceTo(from) >= 35) break;
  }
  const a = d.commander._paceAnchor || p.position;
  const out = [];
  for (const e of men) {
    if (e.dead) continue;
    const w = worst.get(e);
    out.push({ name: e.trooper?.name, wedged: w.best > 0, frames: w.best + (w.best ? WIN : 0),
      at: w.at, lo: w.lo, hi: w.hi, dist: +Math.hypot(e.position.x - a.x, e.position.z - a.z).toFixed(1) });
  }
  world.unload?.();
  const ds = out.map((r) => r.dist).sort((x, y) => x - y);
  return { seed, n: out.length, wedged: out.filter((r) => r.wedged),
    median: ds[Math.floor(ds.length / 2)], max: ds[ds.length - 1] };
}

let tot = 0, bods = 0, armsWith = 0;
for (const seed of [3, 5, 7, 11, 13, 17]) {
  const r = await arm(seed);
  tot += r.n; bods += r.wedged.length; if (r.wedged.length) armsWith++;
  console.log(`seed ${seed}: ${r.wedged.length}/${r.n} wedged · median ${r.median} m · max ${r.max} m · `
    + r.wedged.map((w) => `${w.name}@${w.at} ${w.frames}f at ${w.lo.toFixed(1)}-${w.hi.toFixed(1)} m/s`).join(' | '));
}
console.log(`TOTAL ${bods}/${tot} bodies wedged, in ${armsWith}/6 arms`);
