import './dom-shim.mjs';
const L = await import('../src/game/Levels.js');
const E = await import('../src/game/Enemy.js');
const W = await import('../src/game/Waves.js');
const C = await import('../src/game/Command.js');
const A = E.ARCHETYPES;
const keys = Object.keys(A);
console.log('archetypes:', keys.length);
// pools
const pooled = new Set();
for (const k of L.LEVEL_ORDER) {
  const lv = L.LEVELS[k];
  for (const p of (lv.pool||[])) pooled.add(p);
}
console.log('LEVEL_ORDER', L.LEVEL_ORDER.length, L.LEVEL_ORDER.join(','));
console.log('levels in LEVELS but not in LEVEL_ORDER:', Object.keys(L.LEVELS).filter(k=>!L.LEVEL_ORDER.includes(k)).join(',')||'none');
const sandbox = new Set(W.sandboxUnits ? W.sandboxUnits().map(u=>u.key ?? u.type ?? u.id ?? u) : []);
console.log('sandbox units:', [...sandbox].join(' '));
const cmd = new Set();
for (const armyKey of Object.keys(C.ARMIES||{})) {
  const army = C.ARMIES[armyKey];
  for (const t of army.tiers||[]) cmd.add(t.type);
}
console.log('command units:', [...cmd].join(' '));
console.log('\n-- archetype reachability --');
for (const k of keys) {
  const inPool = pooled.has(k);
  const inSand = sandbox.has(k);
  const inCmd = cmd.has(k);
  const inMix = (W.DOJO_MIX||[]).includes(k);
  if (!inPool && !inSand && !inCmd && !inMix) console.log('UNREACHABLE', k, JSON.stringify({threat:A[k].threat, setPieceOnly:A[k].setPieceOnly}));
}
console.log('\n-- pool names with no archetype --');
for (const k of pooled) if (!A[k]) console.log('GHOST POOL ENTRY', k);
console.log('\n-- per-level pools --');
for (const k of L.LEVEL_ORDER) console.log(k.padEnd(10), (L.LEVELS[k].pool||[]).join(' '));
