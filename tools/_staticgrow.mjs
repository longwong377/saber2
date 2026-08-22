/**
 * Where does a level's static-box count come from while nobody is building it?
 *
 * Wraps `addStaticBox` / `removeStaticBox` on a live world and tallies the call
 * site, so growth during a fight can be attributed instead of guessed.
 *
 *   node --import ./tools/register.mjs tools/_staticgrow.mjs [--level colosseum] [--seconds 180]
 */
import './dom-shim.mjs';
import { bootWorld } from './checks/_coop.mjs';
import { dutyInput } from './_flagship.mjs';

const argv = process.argv.slice(2);
const flag = (n, d) => { const i = argv.indexOf('--' + n); return i >= 0 ? argv[i + 1] : d; };
const LEVEL = flag('level', 'colosseum');
const SECONDS = Number(flag('seconds', '180'));
const STEP = 1 / 30;

const site = () => {
  const s = (new Error().stack || '').split('\n').slice(3, 6)
    .map((l) => l.trim().replace(/^at\s+/, '').replace(/.*\/src\//, 'src/'))
    .filter((l) => l.includes('src/'));
  return s[0] || 'unknown';
};

const { world } = await bootWorld({
  level: LEVEL, settings: { mode: 'waves', level: LEVEL, quality: 'high', difficulty: 'knight' },
  runSeed: 7,
});
world.director?.start?.(1);
const P = world.physics;
const add = P.addStaticBox.bind(P), rem = P.removeStaticBox.bind(P);
const tallyAdd = new Map(), tallyRem = new Map();
let live = false;
P.addStaticBox = (...a) => { if (live) tallyAdd.set(site(), (tallyAdd.get(site()) || 0) + 1); return add(...a); };
P.removeStaticBox = (...a) => { if (live) tallyRem.set(site(), (tallyRem.get(site()) || 0) + 1); return rem(...a); };

const input = dutyInput(world);
live = true;
const start = P.staticBoxes.length;
const n = Math.round(SECONDS / STEP);
for (let i = 0; i < n; i++) { input.tick?.(STEP); world.update(STEP, input); }
console.log(`statics ${start} → ${P.staticBoxes.length} over ${SECONDS}s on ${LEVEL}`);
console.log('added:');
for (const [k, v] of [...tallyAdd].sort((a, b) => b[1] - a[1])) console.log(`  ${String(v).padStart(5)}  ${k}`);
console.log('removed:');
for (const [k, v] of [...tallyRem].sort((a, b) => b[1] - a[1])) console.log(`  ${String(v).padStart(5)}  ${k}`);
process.exit(0);
