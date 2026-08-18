import * as Waves from '../src/game/Waves.js';
import * as Foe from '../src/game/Enemy.js';
import '../src/game/Levels.js';
const { ARCHETYPES, MODIFIERS, modifiersFor, modifierThreat } = Foe;
const d = new Waves.WaveDirector({ enemies: [], difficulty: null, takenBoons: new Set(), players: [] }, { mode: 'duel' });
const { rungs, bosses } = d.duelRoster();
console.log('rungs', rungs.map(k=>`${k}:${ARCHETYPES[k].threat}`).join(' '));
console.log('bosses', bosses.map(k=>`${k}:${ARCHETYPES[k].threat}`).join(' '));
for (const k of [...rungs, ...bosses]) {
  const ms = modifiersFor(k);
  console.log(k, 'mods:', ms.map(m=>`${m}=${modifierThreat(k,m).toFixed(1)}`).join(' ') || '(none)');
}
