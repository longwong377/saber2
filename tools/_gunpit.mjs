/**
 * THE EMPLACEMENT, ON ITS OWN, FOR LONG ENOUGH TO BE A RATE.
 *
 * `tools/checks/breach.mjs` has an isolated arm — one gun, a formed-up line,
 * nothing else on the field — and at `GUN.every` it gets about twenty rounds
 * off in ninety seconds. Twenty rounds is not a sample: at the hit rate the
 * dispersion allows over 69 m it produces one name or none on a coin, which is
 * why that check flaked for a whole session and why its `lost >= 1` had to go.
 *
 * This is the same arm run long enough that the numbers mean something, and it
 * reports the quantities the DIAL is set on rather than a verdict:
 *
 *   rounds/min · hits · hit share · hp/min · names, and MEN A MINUTE, which is
 *   hp/min in the health a body of this line actually carries. The note on
 *   `GUN.every` prices the gun at "about one name a minute of sustained fire";
 *   that column is the sentence.
 *
 *   AND THE AIM, which is the reason this file exists at all. Every round's
 *   line is caught at the muzzle and the height at which it crosses the
 *   target's own vertical column is recorded, against the height that body
 *   publishes as its chest. `Emplacement._fire` used to read
 *   `_v.copy(t.position); _v.y += (t.chestY ?? 1.1)` — and `chestY` is an
 *   ABSOLUTE world height, `position.y + 1.15 * bodyScale`, so adding it to
 *   `position.y` counted the ground under the man twice and the gun fired over
 *   his head by however high the terrain was.
 *
 *   node --import ./tools/register.mjs tools/_gunpit.mjs [seconds] [seeds]
 *
 * Run it from a pinned `git worktree` for a before-and-after; two arms in one
 * process are not comparable (HANDOFF §2.5b).
 */
import './dom-shim.mjs';
const H = await import('./checks/_coop.mjs');
const { Enemy, enemyRng } = await import('../src/game/Enemy.js');
const { seedWaves } = await import('../src/game/Waves.js');
const { seedWorld } = await import('../src/game/World.js');
const { GUN } = await import('../src/game/Emplacement.js');

const SECONDS = Number(process.argv[2] || 600);
const seeds = (process.argv[3] || '1,2,3').split(',').map(Number);
const STEP = 1 / 60;

const idle = () => ({
  act: () => false, actHit: () => false, actDown: () => false,
  moveAxis: (o) => { if (o) { o.x = 0; o.y = 0; return o; } return { x: 0, y: 0 }; },
  mouse: { dx: 0, dy: 0, wheel: 0, left: false, right: false },
  delta: { x: 0, y: 0 }, accel: { x: 0, y: 0 }, end() {},
});

const median = (a) => (a.length ? a.slice().sort((x, y) => x - y)[a.length >> 1] : NaN);

/**
 * THE TALLY IS INSTALLED BEFORE ANY WORLD EXISTS, AND THAT IS NOT TIDINESS.
 *
 * `Command.installTeamDamage` puts a PER-INSTANCE `damage` on every body it
 * deploys and captures `base = e.damage` — the prototype method as it stands at
 * that moment. A wrapper installed after the line is on the ground is therefore
 * never reached by a single one of them: the first cut of this file wrapped
 * after `d.start(1)` and read **0 hits and 0 hp while five names died**, which
 * looks exactly like a gun that cannot shoot. `tools/_linetoll.mjs` wraps at
 * module scope and that is why its tally was right.
 *
 * The live pit is a mutable binding rather than an argument, so the wrapper is
 * installed once and every run below writes into its own tally.
 */
let PIT = null, GUN_T = null;
const realDamage = Enemy.prototype.damage;
Enemy.prototype.damage = function (amount, point, source, kind, ...rest) {
  const before = this.hp;
  const out = realDamage.call(this, amount, point, source, kind, ...rest);
  if (GUN_T && source === PIT) {
    const took = Math.max(0, before - this.hp);
    if (took > 0) { GUN_T.hits++; GUN_T.hp += took; if (this.hp <= 0) GUN_T.killed++; }
  }
  return out;
};

for (const seed of seeds) {
  enemyRng.seed((20260821 ^ Math.imul(seed, 2654435761)) >>> 0);
  seedWaves((20260821 ^ Math.imul(seed, 40503)) >>> 0);
  seedWorld((20260821 ^ Math.imul(seed, 2246822519)) >>> 0);
  const { world } = await H.bootWorld({
    level: 'geonosis', spawn: false,
    settings: { mode: 'command', level: 'geonosis', order: 'jedi' }, runSeed: seed });
  const d = world.command;
  d.onMuster = () => {};
  d.start(1);
  const pit = world.gunPits?.[0];
  if (!pit) { console.log(`seed ${seed}: no gun pit on this ground`); world.unload(); continue; }

  /* THE DIRECTOR'S OWN IDLE STATE — `active` false with an endless
   * intermission, read at the top of `WaveDirector.update`. The army stays
   * deployed because nothing recalls it and no wave is ever composed, so the
   * only thing shooting on this field is the gun. `breach.mjs` states the
   * reason at length: an emptied wave CLEARS, and a cleared wave starts the
   * next one. */
  d.spawnQueue.length = 0;
  for (const e of world.enemies.slice()) {
    if (d.blocksWaveEnd(e)) { e.dead = true; e.dying = 0; world.onEnemyKilled?.(e, null, 'rout'); }
  }
  d.active = false;
  d.intermission = Infinity;

  const start = d.roster.living.length;
  const manHp = d.roster.living[0]?.body?.maxHp ?? 0;
  const ground = d.roster.living[0]?.body?.position.y ?? 0;

  /* WHERE EACH ROUND'S LINE PASSES THE TARGET'S OWN COLUMN. Caught at
   * `bolts.fire` so the reading is of the aim the gun took, not of what the
   * bolt met. */
  const errs = [];
  const realFire = world.bolts.fire.bind(world.bolts);
  world.bolts.fire = (from, dir, opts) => {
    if (opts?.owner === pit && pit.target) {
      const at = pit.target.position;
      const dd = dir.x * dir.x + dir.z * dir.z;
      if (dd > 1e-9) {
        const s = ((at.x - from.x) * dir.x + (at.z - from.z) * dir.z) / dd;
        errs.push((from.y + dir.y * s - at.y) - (pit.target.chestY - at.y));
      }
    }
    return realFire(from, dir, opts);
  };

  const gun = { hits: 0, hp: 0, killed: 0 };
  PIT = pit; GUN_T = gun;
  const input = idle();
  try {
    for (let f = 0; f < SECONDS / STEP; f++) world.update(STEP, input);
  } finally { PIT = null; GUN_T = null; world.bolts.fire = realFire; }

  const mins = SECONDS / 60;
  console.log(`seed ${seed}  ground ${ground.toFixed(2)} m  ${start} men @ ${manHp} hp  `
    + `${pit.shots} rounds (${(pit.shots / mins).toFixed(1)}/min, cadence ${GUN.every}s × ${GUN.burst})  `
    + `${gun.hits} hits (${(100 * gun.hits / Math.max(1, pit.shots)).toFixed(1)}%)  `
    + `${gun.hp.toFixed(0)} hp (${(gun.hp / mins).toFixed(1)}/min = `
    + `${(gun.hp / mins / Math.max(1, manHp)).toFixed(2)} men/min)  `
    + `${start - d.roster.living.length} names  `
    + `aim ${median(errs) >= 0 ? '+' : ''}${median(errs).toFixed(2)} m off the chest (n=${errs.length})`);
  world.unload();
}
