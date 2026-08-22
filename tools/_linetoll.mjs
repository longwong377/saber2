/**
 * WHAT KILLS THE LINE.
 *
 * Ten named men die inside one engagement in both army modes, and no number
 * anywhere says what to. This wraps `Enemy.prototype.damage` at runtime — no
 * file is touched — and tallies every point of damage that lands on a
 * party-team body by KIND and by the archetype that dealt it, plus where the
 * man was standing and how far the nearest hostile was.
 */
import './dom-shim.mjs';
const H = await import('./checks/_coop.mjs');
const { Enemy } = await import('../src/game/Enemy.js');
const STEP = 1 / 30;

const mode = process.argv[2] || 'theline';
const seeds = (process.argv[3] || '1,2').split(',').map(Number);
const byKind = new Map(), byOwner = new Map();
let deaths = 0, total = 0, ranges = [];

const real = Enemy.prototype.damage;
Enemy.prototype.damage = function (amount, point, source, kind, ...rest) {
  const mine = this.team === 0 && this.trooper;
  const before = this.hp;
  const out = real.call(this, amount, point, source, kind, ...rest);
  if (mine && Number.isFinite(amount)) {
    const took = Math.max(0, before - this.hp);
    if (took > 0) {
      total += took;
      byKind.set(kind || '?', (byKind.get(kind || '?') || 0) + took);
      const who = source?.type || (source?.isPlayer ? 'player' : source?.constructor?.name || '?');
      byOwner.set(who, (byOwner.get(who) || 0) + took);
      if (this.hp <= 0) deaths++;
    }
  }
  return out;
};

for (const seed of seeds) {
  const { world } = await H.bootWorld({ level: 'geonosis',
    settings: { mode, level: 'geonosis', order: 'jedi' }, runSeed: seed });
  const d = world.command;
  /**
   * THE MUSTER IS HELD OPEN, OR THIS TALLY RUNS PAST THE ENGAGEMENT IT MEANT
   * TO MEASURE.
   *
   * The loop below stops on `d.mustering`, and that flag is true for less than
   * one frame: `_areaClear` ends with "no screen wired: muster for the player
   * and press on" — `autoMuster()` then `closeMuster()`, both inside the same
   * `payWave` call — so the boundary opens and shuts between two
   * `world.update` calls and the poll never fires. Every reading taken here
   * therefore ran on into area 2 and 3 and reported the roster at whatever
   * wipe it eventually hit, which is where "the roster is wiped in wave 1 and
   * the muster is unreachable" came from. A no-op `onMuster` is what a
   * player's screen is to the director. See tools/_linehold.mjs.
   */
  d.onMuster = () => {};
  d.start(1);
  const input = H.idleInput();
  const n0 = d.roster.all.length;
  let t = 0;
  for (let i = 0; i < 240 / STEP; i++) {
    if (world.player) world.player.hp = world.player.maxHp;
    world.update(STEP, input); t += STEP;
    if (i % 60 === 0) {
      for (const tr of d.roster.living) {
        if (!tr.body || tr.body.dead) continue;
        let near = Infinity;
        for (const e of world.enemies) {
          if (e.dead || e.team === 0) continue;
          near = Math.min(near, Math.hypot(e.position.x - tr.body.position.x, e.position.z - tr.body.position.z));
        }
        if (Number.isFinite(near)) ranges.push(near);
      }
    }
    if (d.mustering || world.over || d.roster.strength === 0) break;
  }
  console.log(`seed ${seed}: ${t.toFixed(0)}s  roster ${d.roster.strength}/${n0}  wave ${d.wave}`);
  world.unload();
}
Enemy.prototype.damage = real;
const pc = (v) => `${(v / total * 100).toFixed(1)}%`;
console.log(`\n${total.toFixed(0)} damage onto the line · ${deaths} killing blows`);
console.log('by kind:  ' + [...byKind].sort((a, b) => b[1] - a[1])
  .map(([k, v]) => `${k} ${pc(v)}`).join('  '));
console.log('by dealer:' + [...byOwner].sort((a, b) => b[1] - a[1]).slice(0, 8)
  .map(([k, v]) => ` ${k} ${pc(v)}`).join(' '));
ranges.sort((a, b) => a - b);
console.log(`nearest hostile to a living trooper: median ${ranges[Math.floor(ranges.length / 2)]?.toFixed(1)} m `
  + `· p10 ${ranges[Math.floor(ranges.length * 0.1)]?.toFixed(1)} m · n=${ranges.length}`);
