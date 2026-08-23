/**
 * A V8 CPU profile of the MEASURED frames only.
 *
 *   node --import ./tools/register.mjs tools/_prof.mjs [--bodies 160] [--frames 400]
 *
 * `--cpu-prof` on the command line samples the boot too, and booting this game
 * bakes every texture in the level — so the top of that profile is `pnoise` and
 * `pworley` and the frame it is supposed to be about is buried. This starts the
 * profiler after the warm-up and stops it before the report.
 */
import './dom-shim.mjs';
import * as THREE from 'three';
import { Session } from 'node:inspector/promises';
import { writeFileSync } from 'node:fs';

const args = process.argv.slice(2);
const flag = (n, d) => { const i = args.indexOf('--' + n); return i >= 0 ? args[i + 1] : d; };
const BODIES = parseInt(flag('bodies', '160'), 10);
const FRAMES = parseInt(flag('frames', '400'), 10);
const OUT = flag('out', '/tmp/frame.cpuprofile');

const H = await import('./checks/_coop.mjs');
const { Enemy, enemyRng } = await import('../src/game/Enemy.js');
const { layoutNamed } = await import('./_layouts.mjs');
const LAYOUT = layoutNamed(flag('layout', 'front'));
enemyRng.seed(20260823);
const { world } = await H.bootWorld({
  level: flag('level', 'geonosis'),
  settings: { quality: 'high', difficulty: 'knight', mode: flag('mode', 'command') },
});
const input = H.idleInput();
for (let i = 0; i < 1200; i++) world.update(1 / 60, input);
const p = world.player, kinds = ['b1', 'b1', 'b2', 'trooper'];
for (let i = 0; i < BODIES; i++) {
  const { x, z } = LAYOUT(p, i, BODIES);
  const e = new Enemy(world, kinds[i % kinds.length],
    new THREE.Vector3(x, world.terrain.height(x, z), z));
  e.team = i % 2 ? p.team : (p.team === 0 ? 1 : 0);
  world.enemies.push(e);
}
for (let i = 0; i < 60; i++) world.update(1 / 60, input);

const s = new Session();
s.connect();
await s.post('Profiler.enable');
await s.post('Profiler.setSamplingInterval', { interval: 100 });
await s.post('Profiler.start');
for (let i = 0; i < FRAMES; i++) world.update(1 / 60, input);
const { profile } = await s.post('Profiler.stop');
s.disconnect();
writeFileSync(OUT, JSON.stringify(profile));

const byId = new Map(profile.nodes.map((n) => [n.id, n]));
const self = new Map();
for (let i = 0; i < profile.samples.length; i++) {
  const id = profile.samples[i];
  self.set(id, (self.get(id) || 0) + (profile.timeDeltas[i] || 0));
}
const agg = new Map();
for (const [id, us] of self) {
  const cf = byId.get(id).callFrame;
  const k = `${cf.functionName || '(anon)'}  ${(cf.url || '').split('/').slice(-1)[0]}:${cf.lineNumber + 1}`;
  agg.set(k, (agg.get(k) || 0) + us);
}
const rows = [...agg.entries()].map(([k, us]) => ({ k, us })).sort((a, b) => b.us - a.us);
const total = rows.reduce((a, b) => a + b.us, 0);
const alive = world.enemies.filter((e) => !e.dead).length;
console.log(`\n  cpu profile — ${alive} bodies · ${FRAMES} frames · ${(total / 1000).toFixed(0)} ms sampled `
  + `(${(total / 1000 / FRAMES).toFixed(2)} ms/frame)\n`);
for (const r of rows.slice(0, parseInt(flag('top', '30'), 10))) {
  console.log(`  ${(r.us / 1000 / FRAMES).toFixed(3).padStart(7)} ms/f ${(r.us / total * 100).toFixed(1).padStart(5)}%  ${r.k}`);
}
console.log(`\n  written to ${OUT}\n`);
