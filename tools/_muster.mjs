/**
 * WHAT THE MUSTER ACTUALLY RESTORES, AND WHETHER IT CARRIES A LINE ACROSS.
 *
 * `tools/_lethality.mjs` and `tools/_linehold.mjs` both stop AT the boundary —
 * they hold the muster open with a no-op `onMuster` precisely so the reading is
 * taken before the replacements, which is what makes "an engagement costs about
 * half a ten-man line" a statement about the engagement. That leaves the other
 * half of the question unmeasured: an area is followed by a muster, and the run
 * is a sitting of three to five of them. If the muster does not put back what an
 * engagement takes, the target is being met on the wrong unit.
 *
 * So this drives area 1 to its boundary, lets the director's OWN `autoMuster`
 * and `closeMuster` run — the two calls `_areaClear` makes when no screen is
 * wired, which is what a player's muster screen stands in for — and prints the
 * roster on both sides of it, with the purse the area paid and what it bought.
 *
 *   node --import ./tools/register.mjs tools/_muster.mjs [seeds] [arm]
 *
 * Same three streams pinned per run and the same phase constants as
 * `_lethality.mjs`, so a seed here is the same seed there.
 */
import './dom-shim.mjs';
const H = await import('./checks/_coop.mjs');
const { dutyInput } = await import('./_flagship.mjs');
const { enemyRng } = await import('../src/game/Enemy.js');
const { seedWaves } = await import('../src/game/Waves.js');
const { seedWorld } = await import('../src/game/World.js');
const { musterCost } = await import('../src/game/Command.js');

const STEP = 1 / 30;
const CAP = 600;
const seeds = (process.argv[2] || '1,2,3,4,5,6').split(',').map(Number);
const arm = process.argv[3] || 'none';

const phase = (seed) => {
  enemyRng.seed((20260821 ^ Math.imul(seed, 2654435761)) >>> 0);
  seedWaves((20260821 ^ Math.imul(seed, 40503)) >>> 0);
  seedWorld((20260821 ^ Math.imul(seed, 2246822519)) >>> 0);
};

for (const seed of seeds) {
  phase(seed);
  const { world } = await H.bootWorld({
    level: 'geonosis', spawn: arm !== 'none',
    settings: { mode: 'theline', level: 'geonosis', order: 'jedi' }, runSeed: seed });
  const d = world.command;
  /**
   * THE BOUNDARY IS CAUGHT AND HELD, and then let go DELIBERATELY.
   *
   * `_areaClear` ends with "no screen wired: muster for the player and press
   * on" — `autoMuster()` then `closeMuster()` inside one `payWave` call — so
   * `mustering` is true for less than a frame and a poll never sees it. A no-op
   * `onMuster` is what stops that; this one records the state at the boundary
   * and then makes the two calls itself, which is exactly what the director
   * would have done.
   */
  let at = null;
  d.onMuster = () => {
    /* `areaNumber` has ALREADY moved: `_areaClear` increments `areaIndex` and
     * then opens the muster, so the area that was just held is the one before
     * the one this reads. Named here rather than off by one in the message. */
    at = { area: d.areaNumber - 1, strength: d.roster.strength, points: d.roster.points,
           types: d.roster.living.map((t) => t.type) };
  };
  d.start(1);
  const n0 = d.roster.all.length;
  const input = arm === 'blade' ? dutyInput(world) : H.idleInput();
  let t = 0, ended = 'cap';
  for (let i = 0; i < CAP / STEP; i++) {
    if (world.player) world.player.hp = world.player.maxHp;
    input.tick?.(STEP);
    world.update(STEP, input); t += STEP;
    if (at) { ended = 'cleared'; break; }
    if (world.over) { ended = 'over'; break; }
    if (d.roster.strength === 0) { ended = 'wiped'; break; }
  }
  if (!at) {
    console.log(`seed ${seed}  ${arm}  ${ended} at ${t.toFixed(0)}s with ${d.roster.strength}/${n0} `
      + '— never reached a muster');
    world.unload();
    continue;
  }
  const before = at.strength;
  d.autoMuster();
  d.closeMuster();
  const after = d.roster.strength;
  console.log(`seed ${seed}  ${arm}  area ${at.area} held at ${t.toFixed(0)}s  `
    + `${before}/${n0} standing, purse ${at.points} pts (a ${at.types[0] || 'trooper'} costs `
    + `${musterCost(at.types[0] || 'trooper')})  →  ${after}/${n0} after the muster  `
    + `(+${after - before}, net ${after - n0} on the area)`);
  world.unload();
}
