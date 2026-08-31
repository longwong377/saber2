import './dom-shim.mjs';
const Cmd = await import('../src/game/Command.js');
await import('../src/game/Levels.js');
const A = Cmd.ARMIES.republic;
console.log('tiers', JSON.stringify(A.tiers.map(t=>({type:t.type, cost:t.cost}))));
for (const op of [8, 12, 20, 24]) {
  const r = Cmd.composeContingent(A, op, [], Cmd.CONTINGENT_MIXED);
  const tally = {}; for (const t of r.types) tally[t]=(tally[t]|0)+1;
  console.log('opening', op, JSON.stringify(tally), 'n=', r.types.length, 'refused', r.refused);
}
console.log('MAX_STRENGTH', Cmd.MAX_STRENGTH);
