/**
 * A LIVE BODY PAST L3_AT — is anything drawing it?
 *
 * `darken()` hides every mesh a body owns and is only supposed to run once a
 * cohort has taken it. This walks the frames and reports every one where the
 * body is dark and NOT in a cohort — which is a body nothing draws at all.
 *
 *   node --import ./tools/register.mjs tools/_darkprobe.mjs [--pre 1]
 */
import './dom-shim.mjs';
import * as THREE from 'three';
import { bootWorld, idleInput } from './checks/_coop.mjs';

const argv = process.argv.slice(2);
const flag = (n, d) => { const i = argv.indexOf('--' + n); return i >= 0 ? argv[i + 1] : d; };
const PRE = Number(flag('pre', '1'));   // spawn-and-kill a body at 100 m first
const STEP = 1 / 30;

const { world } = await bootWorld({
  level: 'geonosis', settings: { mode: 'sandbox', level: 'geonosis', quality: 'high' }, runSeed: 11,
});
const input = idleInput();
const run = (n) => { for (let i = 0; i < n; i++) world.update(STEP, input); };

const put = (d) => {
  const p = new THREE.Vector3(0, 0, -d);
  p.y = world.terrain?.height?.(p.x, p.z) ?? 0;
  return world.spawnEnemy('b1', p);
};

if (PRE) {
  const a = put(100);
  run(60);
  if (a) { a.hp = 0; a.die?.(null, 'probe'); }
  run(90);
}

/* Log every join/leave that touches the body under test. */
const F = world.cohorts;
const j0 = F.join.bind(F), l0 = F.leave.bind(F);
let watched = null, tick = 0;
F.join = (x) => { const r = j0(x); if (x === watched) console.log(`  f${tick} join -> ${r} slot=${x._l3?.slot}`); return r; };
F.leave = (x) => { if (x === watched) console.log(`  f${tick} LEAVE slot=${x._l3?.slot}\n${new Error().stack.split('\n').slice(1,5).join('\n')}`); return l0(x); };

const e = put(163);
watched = e;
if (!e) { console.log('no body'); process.exit(0); }

const state = () => {
  const inCohort = [...(world.cohorts?.cohorts?.values?.() || [])].some((c) => c && c.members.has(e));
  return { dark: (e._dark || []).length, l3: !!e._l3, l3w: !!e._l3Wait, l2: !!e._l2, l2on: !!e._l2?.on, l2w: !!e._l2Wait, inCohort, lod: e.lod };
};

let prev = null, blind = 0;
for (let i = 0; i < 240; i++) {
  tick = i;
  world.update(STEP, input);
  const s = state();
  const key = JSON.stringify(s);
  if (key !== prev) { console.log(`frame ${String(i).padStart(3)}  ${key}`); prev = key; }
  if (s.dark > 0 && !s.inCohort) blind++;
}
console.log(`\nframes dark with no cohort drawing it: ${blind} of 240`);
console.log(`cohort refusals: ${JSON.stringify([...(world.cohorts?.refused || [])])}`);
process.exit(0);
