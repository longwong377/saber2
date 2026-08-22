/**
 * WHAT THE MODE OPENS AGAINST, ON EVERY GROUND IT CAN ROLL.
 *
 * `theline.11` reports the number and NEXT.md records the spread: **colosseum
 * 2 · scoria 3 · four grounds 8 · geonosis 49**, all seven handed the same
 * budget of 8.0. Geonosis' 49 is the levy and is Levy.js's business. The 2 is
 * not: a pool with expensive bodies in its unlocked set spends the whole
 * opening budget on two or three of them, and the Colosseum opens on a stalker.
 * A mode about a LINE opening against two bodies is a defect.
 *
 * Composes only — `d.start(w)` and read the queue — so this is seconds, and it
 * prints what each ground actually bought rather than a count, because the
 * count alone cannot tell "two bodies because the pool is thin" from "two
 * bodies because one of them cost seven of the eight".
 *
 *   node --import ./tools/register.mjs tools/_lineopen.mjs [waves] [seed]
 */
import './dom-shim.mjs';
const H = await import('./checks/_coop.mjs');
const { LEVEL_ORDER } = await import('../src/game/Levels.js');
const { ARCHETYPES } = await import('../src/game/Enemy.js');
const { spawnType } = await import('../src/game/Waves.js');

const WAVES = Number(process.argv[2] || 1);
const SEED = Number(process.argv[3] || 3);
console.log(`opening ${WAVES} wave(s), seed ${SEED}, one line per ground\n`);
for (const key of LEVEL_ORDER) {
  const { world } = await H.bootWorld({ level: key,
    settings: { mode: 'theline', level: key, order: 'jedi' }, runSeed: SEED });
  const d = world.command;
  d.start(1);
  for (let w = 1; w <= WAVES; w++) {
    d.start(w);
    const by = {};
    let hp = 0;
    for (const e of d.spawnQueue) {
      const t = spawnType(e);
      by[t] = (by[t] | 0) + 1;
      hp += ARCHETYPES[t]?.hp || 0;
    }
    const parts = Object.entries(by).sort((a, b) => b[1] - a[1])
      .map(([t, n]) => `${n}×${t}(${ARCHETYPES[t]?.threat ?? '?'})`);
    console.log(`${key.padEnd(10)} w${w}  budget ${String(d.budgetFor(w)).padStart(3)}`
      + `  bodies ${String(d.spawnQueue.length).padStart(3)}  hp ${String(hp).padStart(5)}`
      + `  levy ${String(d.shape?.levy | 0).padStart(2)}  ${parts.join(' ')}`);
  }
  world.unload();
}
