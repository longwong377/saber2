/**
 * ARE YOU FIGHTING YOUR OWN SIDE?
 *
 * "Ive noticed that many times when as a sith i'll be fighting against mechs
 *  that are associated with the separtists which doesnt' make sense, make sure
 *  that doesn't happen and also the other way around too like when you're
 *  playing as the republic you shouldnt be fighting against things that are
 *  canonically on your side, that goes for single npcs too"
 *
 * `Command.ARMIES` already knows which hardware belongs to which side — it is
 * how a muster ladder is built. This asks whether anything ELSE does: it walks
 * every level's `pool` and reports, for each side the player can lead, which of
 * the bodies in it are canonically that player's own.
 */
import './dom-shim.mjs';
const { LEVELS, LEVEL_ORDER } = await import('../src/game/Levels.js');
const { ARMIES } = await import('../src/game/Command.js');
const { ARCHETYPES } = await import('../src/game/Enemy.js');

/** Who each army musters — the game's own answer, not a second table. */
const own = {};
for (const [id, A] of Object.entries(ARMIES)) {
  own[id] = new Set(A.tiers.map((t) => t.type ?? t.key ?? t));
}
console.log('republic musters :', [...own.republic].join(', '));
console.log('separatist musters:', [...own.separatist].join(', '));
console.log();

let bad = 0;
for (const key of LEVEL_ORDER) {
  const L = LEVELS[key];
  if (!L?.pool) continue;
  const uniq = [...new Set(L.pool)];
  const clash = { republic: [], separatist: [] };
  for (const t of uniq) {
    for (const side of ['republic', 'separatist']) if (own[side].has(t)) clash[side].push(t);
  }
  const line = [];
  if (clash.republic.length) line.push(`a JEDI fights their own: ${clash.republic.join(', ')}`);
  if (clash.separatist.length) line.push(`a SITH fights their own: ${clash.separatist.join(', ')}`);
  if (line.length) { bad++; console.log(`${key.padEnd(11)} ${line.join('  |  ')}`); }
}
console.log();
console.log(`${bad} of ${LEVEL_ORDER.filter((k) => LEVELS[k]?.pool).length} levels field bodies against the side they belong to`);
/* AND THE ARCHETYPES THEMSELVES: does anything declare a faction at all? */
const withSide = Object.entries(ARCHETYPES).filter(([, A]) => A.faction || A.side || A.army);
console.log(`archetypes declaring a faction of their own: ${withSide.length} of ${Object.keys(ARCHETYPES).length}`);
