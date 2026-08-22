/**
 * WHAT A WAVE OF THE LINE IS MADE OF, WITHOUT FIGHTING IT.
 *
 * A wave's length is what the army has to chew through divided by how fast it
 * chews, and only one of those two is cheap to measure. This composes every
 * wave of every stage a plan walks — through the director's own `start`, so the
 * budget, the area multiplier, the ally scale, the conditions and the levy are
 * all the shipped ones — and reports the BULK of it: bodies, and the hit points
 * those bodies are carrying.
 *
 * Nothing is stepped, so this is seconds rather than half an hour, and it is
 * the number to iterate a lever against. The clock still has to be taken on a
 * real sitting afterwards (`_lineclock.mjs`), because bulk is not time.
 *
 *   node --import ./tools/register.mjs tools/_linebulk.mjs [seeds]
 */
import './dom-shim.mjs';
const H = await import('./checks/_coop.mjs');
const { ARCHETYPES } = await import('../src/game/Enemy.js');
const { spawnType } = await import('../src/game/Waves.js');

const rows = [];
for (const seed of (process.argv[2] || '1,2,3').split(',').map(Number)) {
  const { world } = await H.bootWorld({ level: 'geonosis',
    settings: { mode: 'theline', level: 'geonosis', order: 'jedi' }, runSeed: seed });
  const d = world.command;
  d.start(1);
  let w = 0, total = { n: 0, hp: 0, pay: 0 };
  const per = [];
  for (let s = 0; s < d.stages.length; s++) {
    d.areaIndex = s;
    for (let k = 0; k < d.area.waves; k++) {
      w++;
      d.start(w);
      let hp = 0, pay = 0;
      for (const entry of d.spawnQueue) {
        const A = ARCHETYPES[spawnType(entry)];
        hp += A?.hp || 0;
        if (A && A.score !== 0) pay++;
      }
      per.push({ s: s + 1, w, n: d.spawnQueue.length, levy: d.shape?.levy | 0, hp,
        budget: d.budgetFor(w), area: d.area.id });
      total.n += d.spawnQueue.length; total.hp += hp; total.pay += pay;
    }
  }
  console.log(`\nseed ${seed}  ${d.plan.id}  stages ${d.stages.map((a) => a.id).join('>')}`
    + `  ${per.length} waves  ${total.n} bodies  ${total.hp} hp`);
  for (const r of per) {
    console.log(`   ar${r.s} ${r.area.padEnd(9)} w${String(r.w).padStart(2)}  budget ${String(r.budget).padStart(4)}`
      + `  bodies ${String(r.n).padStart(3)} (levy ${String(r.levy).padStart(2)})  hp ${String(r.hp).padStart(6)}`);
  }
  rows.push({ seed, plan: d.plan.id, waves: per.length, n: total.n, hp: total.hp });
  world.unload();
}
console.log('\nseed  plan   waves  bodies      hp');
for (const r of rows) console.log(`${String(r.seed).padStart(4)}  ${r.plan.padEnd(6)} ${String(r.waves).padStart(5)}  ${String(r.n).padStart(6)}  ${String(r.hp).padStart(6)}`);
