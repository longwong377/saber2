/**
 * THE ROOM'S ROSTER, DRIVEN — a probe, not a check.
 *
 *   node --import ./tools/register.mjs tools/_roomprobe.mjs
 *
 * rAF never fires in this tree's headless Chromium, so a browser test of a
 * click is void. This boots a REAL World per ground the room offers, from the
 * settings blob `runProgram` would hand `deploy()`, and asks the world which
 * ground it built and what is standing on it.
 */
import './dom-shim.mjs';
import { LESSONS } from '../src/game/Dojo.js';
import * as H from '../src/game/Holodeck.js';
import { LEVELS, theatresFor, theatreFor } from '../src/game/Levels.js';
import { DEFAULT_SETTINGS } from '../src/ui/Menu.js';
import { bootWorld, run, idleInput } from './checks/_coop.mjs';

const GROUNDS = theatresFor('sandbox').map((k) => ({ key: k, name: LEVELS[k].name, blurb: LEVELS[k].blurb }));
const rack = H.programs(LESSONS, GROUNDS);
const ground = rack.filter((p) => p.kind === 'ground');
const featured = new Set(rack.filter((p) => p.kind !== 'ground').map((p) => p.ground));

console.log(`rack ${rack.length}: ${rack.filter(p=>p.kind==='lesson').length} lessons, `
  + `${rack.filter(p=>p.kind==='open').length} featured rooms, ${ground.length} grounds`);
console.log(`roster ${theatresFor('sandbox').join(', ')}`);
console.log(`grounds no featured program names: ${theatresFor('sandbox').filter((k) => !featured.has(k)).join(', ') || '(none)'}`);

/* The console, as a player would leave it: 9 droidekas by name on whatever
 * ground is picked. A `dials: null` roster room must carry both. */
const console_ = { ...DEFAULT_SETTINGS, sandboxCount: 11, sandboxFire: 0.4,
  sandboxType: 'b1', sandboxMix: { droideka: 9 }, unlimitedFocus: true };

for (const p of ground) {
  const s = H.programSettings(p, console_);
  const key = theatreFor(s.mode, s.level, 12345);
  const { world } = await bootWorld({ level: key, settings: s });
  run(world, 25.0, idleInput());
  const alive = world.enemies?.filter?.((e) => !e.dead)?.length ?? world.enemies?.length ?? 0;
  const kinds = {};
  for (const e of (world.enemies || [])) kinds[e.type || e.kind || '?'] = (kinds[e.type || e.kind || '?'] || 0) + 1;
  const ok = world.levelKey === p.ground;
  console.log(`${ok ? 'OK ' : 'BAD'} ${p.id.padEnd(18)} asked ${p.ground.padEnd(10)} built ${String(world.levelKey).padEnd(10)} `
    + `mode=${s.mode} count=${s.sandboxCount} focus=${s.unlimitedFocus} alive=${alive} ${JSON.stringify(kinds)}`);
  world.dispose?.();
}
process.exit(0);
