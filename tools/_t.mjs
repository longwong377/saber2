import './dom-shim.mjs';
const { COMPANION_KINDS } = await import('../src/game/CompanionKinds.js');
const { ARCHETYPES } = await import('../src/game/Enemy.js');
for (const id of Object.keys(COMPANION_KINDS)) {
  const K = COMPANION_KINDS[id];
  console.log(id, K.archetype, !!ARCHETYPES[K.archetype]);
}
