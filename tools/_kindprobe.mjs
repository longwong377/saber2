import './dom-shim.mjs';
const K = await import('../src/game/CompanionKinds.js');
await import('../src/game/Levels.js');
const { ARCHETYPES } = await import('../src/game/Enemy.js');
for (const id of K.COMPANION_ORDER) {
  const row = K.COMPANION_KINDS[id];
  console.log(id.padEnd(8), row.archetype.padEnd(8), ARCHETYPES[row.archetype] ? 'BODY' : '--none--', row.verb.id);
}
