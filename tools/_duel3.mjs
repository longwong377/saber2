import * as Waves from '../src/game/Waves.js';
import '../src/game/Levels.js';
const tw = () => ({ enemies: [], difficulty: null, takenBoons: new Set(), players: [] });
const SEEDS = [1,2,3,5,8,13,21,34,55,89,144,233];
const rows = [];
for (const w of [5,8,10,13,16,19,22,25,28,31,34,40,60]) {
  let t=0, el=0, n=0, forms=new Set();
  for (const s of SEEDS) {
    Waves.seedWaves(s,0); const d = new Waves.WaveDirector(tw(), { mode:'duel' }); d.wave=w; d._compose();
    t += d.spawnQueue.reduce((a,e)=>a+Waves.spawnCost(e),0);
    el += d.spawnQueue.filter(e=>Waves.spawnMod(e)).length;
    n += d.spawnQueue.length;
    for (const e of d.spawnQueue) forms.add(e);
  }
  rows.push(`w${w}\tthreat ${(t/SEEDS.length).toFixed(1)}\tbodies ${(n/SEEDS.length).toFixed(2)}\telites ${(el/SEEDS.length).toFixed(2)}\tdistinct ${forms.size}`);
}
console.log(rows.join('\n'));
