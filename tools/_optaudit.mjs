/**
 * WHICH OPTIONS DOES A BUILDER READ, AND WHICH DOES A CALL SITE HAND IT.
 * Iteration aid behind `tools/checks/builder-options.mjs` — same derivation,
 * no assertions, and it prints everything instead of the first failure.
 *
 *   node --import ./tools/register.mjs tools/_optaudit.mjs [--all]
 */
import './dom-shim.mjs';
import { readFileSync } from 'node:fs';
import * as P from '../src/world/Props.js';
import { optionKeys, optionSinks } from '../src/world/Props.js';
import { callSites } from './_optscan.mjs';

const files = ['src/world/Props.js', 'src/world/Scenery.js', 'src/world/Trees.js',
  'src/world/Destruction.js', 'src/game/Levels.js', 'src/game/World.js', 'src/game/Waves.js'];

const makers = [];
for (const [name, v] of Object.entries(P)) {
  if (typeof v !== 'function' || !/^(add|make|strew)[A-Z]/.test(name)) continue;
  const src = v.toString();
  if (!/\bopts\b/.test(src)) continue;
  makers.push([name, v]);
}
console.log(`${makers.length} option-taking exports in Props.js`);
for (const [name, fn] of makers) {
  const ks = optionKeys(fn);
  const keys = ks ? [...ks].sort() : ['— unguarded —'];
  const sinks = optionSinks(fn);
  console.log(`  ${name.padEnd(20)} ${String(keys.length).padStart(2)} keys  [${sinks.join(',') || '—'}]  ${keys.join(' ')}`);
}

console.log('\n── call sites that hand a key the builder does not read ──');
let bad = 0, seen = 0;
for (const f of files) {
  let src;
  try { src = readFileSync(new URL('../' + f, import.meta.url), 'utf8'); } catch { continue; }
  for (const site of callSites(src, new Set(makers.map(([n]) => n)))) {
    seen++;
    const known = optionKeys(P[site.name]);
    if (!known || site.spread) continue;
    const unknown = site.keys.filter((k) => !known.has(k));
    if (!unknown.length) continue;
    bad++;
    const line = src.slice(0, site.at).split('\n').length;
    console.log(`  ${f}:${line}  ${site.name}({ ${site.keys.join(', ')} })  → UNKNOWN: ${unknown.join(', ')}`);
  }
}
console.log(`${seen} literal call sites scanned, ${bad} of them pass something unread`);
