/**
 * WHO DOES A JEDI ACTUALLY MEET, AND WHO DOES A SITH?
 *
 * The first probe (`tools/_sides.mjs`) read the level tables and found seven of
 * seven grounds fielding bodies against the side they belong to. This one asks
 * the shipped composer instead: it drives a real WaveDirector at a real level
 * for twenty waves under each order and counts what it puts on the field.
 */
import './dom-shim.mjs';
const { bootWorld, idleInput } = await import('./checks/_coop.mjs');
const { factionOf, FACTIONS, armyForOrder } = await import('../src/game/Databank.js');
const { enemyRng } = await import('../src/game/Enemy.js');

for (const order of ['jedi', 'sith', 'grey']) {
  const mine = armyForOrder(order);
  const seen = new Map();
  for (const level of ['geonosis', 'colosseum', 'wood']) {
    enemyRng.seed(17);
    const { world } = await bootWorld({
      level, settings: { mode: 'waves', quality: 'low', instantSpawn: true, order },
    });
    const d = world.director;
    for (let w = 1; w <= 20; w++) {
      const types = d.unlockedAt(w);
      for (const t of types) {
        seen.set(t, (seen.get(t) || 0) + 1);
        if (mine && factionOf(t) === mine) console.log(`      LEAK: ${t} on ${level} wave ${w}`);
      }
    }
    world.unload?.();
  }
  const own = [...seen.keys()].filter((t) => factionOf(t) === mine);
  const list = [...seen.keys()].sort();
  console.log(`${order.padEnd(5)} (leads ${String(mine)}): ${list.length} types over 3 levels x 20 waves`);
  console.log(`      ${list.join(', ')}`);
  console.log(`      OWN SIDE ON THE FIELD: ${own.length ? own.join(', ') : 'none'}`);
}
