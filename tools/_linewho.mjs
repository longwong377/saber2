/** WHAT KILLS THE LINE — one engagement, damage on party-team men by source. */
import './dom-shim.mjs';
const H = await import('./checks/_coop.mjs');
const { dutyInput } = await import('./_flagship.mjs');
const { enemyRng, Enemy } = await import('../src/game/Enemy.js');
const { seedWaves } = await import('../src/game/Waves.js');
const { seedWorld } = await import('../src/game/World.js');
const seed = +(process.argv[2] || 5);
const arm = process.argv[3] || 'none';
enemyRng.seed(seed); seedWaves(seed); seedWorld?.(seed);

const { world } = await H.bootWorld({ level: 'geonosis', spawn: arm !== 'none',
  settings: { mode: 'theline', level: 'geonosis', order: 'jedi' }, runSeed: seed });
const d = world.command;
d.onMuster = () => {};

const dmgBy = new Map();
const real = Enemy.prototype.damage;
Enemy.prototype.damage = function (amount, point, source, kind, preResisted) {
  const ours = this.team === world.partyTeam;
  const before = this.hp;
  const out = real.call(this, amount, point, source, kind, preResisted);
  if (ours && before > 0) {
    const key = `${source?.type || source?.constructor?.name || '?'}`;
    dmgBy.set(key, (dmgBy.get(key) || 0) + Math.max(0, before - this.hp));
  }
  return out;
};
/* AND WHO EACH CONSCRIPT IS POINTED AT — the whole question. `installLevyAim`
 * is meant to send the levy at the Jedi so the paid wave fights the line. */
const aimTally = { player: 0, line: 0, none: 0 };

d.start(1);
const n0 = d.roster.all.length;
const STEP = 1 / 30;
let t = 0, ended = 'cap', samples = 0;
const input = arm === 'blade' ? dutyInput(world) : H.idleInput();
for (let i = 0; i < 600 / STEP; i++) {
  if (world.player) world.player.hp = world.player.maxHp;
  input.tick?.(STEP);
  world.update(STEP, input); t += STEP;
  if (i % 30 === 0) {
    for (const e of world.enemies) {
      if (e.dead || e.type !== 'conscript') continue;
      samples++;
      const tg = e.target;
      if (!tg) aimTally.none++;
      else if (tg === world.player || tg.isLocal) aimTally.player++;
      else aimTally.line++;
    }
  }
  if (d.mustering) { ended = 'cleared'; break; }
  if (world.over) { ended = 'over'; break; }
  if (d.roster.strength === 0) { ended = 'wiped'; break; }
}
const sort = (m) => [...m].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${Math.round(v)}`).join(', ');
console.log(`seed ${seed} arm ${arm}: ${d.roster.strength} of ${n0} left after ${t.toFixed(0)}s wave ${d.wave} — ${ended}`);
console.log('DAMAGE ON OUR MEN BY SOURCE:', sort(dmgBy));
const pct = (n) => samples ? `${(n / samples * 100).toFixed(0)}%` : '—';
console.log(`CONSCRIPTS AIMED AT: player ${pct(aimTally.player)}, our line ${pct(aimTally.line)}, nothing ${pct(aimTally.none)} (${samples} samples)`);
world.unload();
