import * as Waves from '../src/game/Waves.js';
import * as Foe from '../src/game/Enemy.js';
import { LEVELS } from '../src/game/Levels.js';
const { ARCHETYPES } = Foe;
const tableWorld = () => ({ enemies: [], difficulty: null, takenBoons: new Set(), players: [] });
const pool = LEVELS.colosseum.pool;
const mk = (mode) => new Waves.WaveDirector(tableWorld(), { mode, pool });
const threatOf = (e) => Waves.spawnCost(e);
const rows = [];
for (let w = 1; w <= 40; w++) {
  Waves.seedWaves(99, 0); const d = mk('duel'); d.wave = w; d._compose();
  const q = d.spawnQueue;
  Waves.seedWaves(99, 0); const v = mk('waves'); v.wave = w; v._compose();
  rows.push({ w, tier: d.duelTier(w), size: d.duelSize(w), n: q.length,
    threat: q.reduce((s,e)=>s+threatOf(e),0),
    elites: q.filter(e=>Waves.spawnMod(e)).length,
    budget: Math.round(d.budgetFor(w)),
    wavesThreat: v.spawnQueue.reduce((s,e)=>s+threatOf(e),0), q: q.join(',') });
}
console.log('w tier size n threat elites budget wavesThreat');
for (const r of rows) console.log(`${r.w} ${r.tier} ${r.size} ${r.n} ${r.threat} ${r.elites} ${r.budget} ${r.wavesThreat}   ${r.q}`);
const span = rows.filter(r=>r.w>=19);
console.log('duel w19..40 threat:', span.map(r=>r.threat).join(' '));
