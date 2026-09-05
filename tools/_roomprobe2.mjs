import './dom-shim.mjs';
import { LESSONS } from '../src/game/Dojo.js';
import * as H from '../src/game/Holodeck.js';
import { LEVELS, theatresFor, theatreFor } from '../src/game/Levels.js';
import { DEFAULT_SETTINGS } from '../src/ui/Menu.js';
import { bootWorld, run, idleInput } from './checks/_coop.mjs';
const G = theatresFor('sandbox').map((k) => ({ key: k, name: LEVELS[k].name, blurb: LEVELS[k].blurb }));
const all = H.programs(LESSONS, G);
const featured = new Set(all.filter(p=>p.kind!=='ground').map(p=>p.ground));
const p = all.find(r=>r.kind==='ground' && !featured.has(r.ground));
const settings = { ...DEFAULT_SETTINGS };
Object.assign(settings, H.programSettings(p, { ...settings, sandboxCount: 12, sandboxFire: 0, sandboxType: 'b1', sandboxMix: { droideka: 7 } }));
const key = theatreFor(settings.mode, settings.level, 12345);
const { world } = await bootWorld({ level: key, settings });
console.log('program', p.id, 'level', world.levelKey, 'director', world.director?.constructor?.name);
for (let t = 5; t <= 60; t += 5) {
  run(world, 5, idleInput());
  const alive = (world.enemies||[]).filter(e=>!e.dead).length;
  const dek = (world.enemies||[]).filter(e=>(e.type||e.kind)==='droideka').length;
  const dead = (world.enemies||[]).filter(e=>e.dead).length;
  console.log(`t=${t}s alive=${alive} dead=${dead} droideka=${dek} kinds=${JSON.stringify((world.enemies||[]).reduce((a,e)=>{const k=e.type||e.kind||'?';a[k]=(a[k]||0)+1;return a;},{}))}`);
}
console.log('cfg', JSON.stringify((await import('../src/game/Waves.js')).sandboxConfig(settings)));
world.dispose?.();
process.exit(0);
