/**
 * HOW MUCH OF THE FIGHTING FLOOR IS OVER EYE HEIGHT IN THE LEVEL'S OWN FLUID.
 *
 * The check that owns this property lives in `levels-quality.mjs` and builds a
 * whole World to ask it, which is a minute a try. This asks the heightfield
 * directly — the same question, on the same disc, against the same
 * `LEVELS[key].water.level` — so a landform can be tuned in seconds instead.
 *
 * IT IS NOT A SECOND COPY OF THE RULE. The rule is "the player's eye must not
 * pass under a level's own fluid on ground they are meant to stand and fight
 * on", and both the check and this read it off the same two numbers: the
 * level's `water.level` and 1.62 m of eye height. What this cannot see is the
 * camera, which is why the check still has to run.
 *
 *   node --import ./tools/register.mjs tools/_wetfloor.mjs [level ...]
 */
import './dom-shim.mjs';

const THREE = await import('three');
const { Terrain } = await import('../src/world/Terrain.js');
const { LEVELS, LEVEL_ORDER } = await import('../src/game/Levels.js');

const EYE = 1.62;
const keys = process.argv.slice(2).filter((a) => !a.startsWith('-'));
for (const key of (keys.length ? keys : LEVEL_ORDER)) {
  const L = LEVELS[key];
  if (!L?.water) continue;
  const terrain = new Terrain(new THREE.Scene(), L.terrain, 0.5);
  const wl = L.water.level ?? 0;
  const R = 60;
  let n = 0, over = 0, wet = 0, deepest = 0;
  const hs = [];
  for (let z = -R; z <= R; z += 1.5) {
    for (let x = -R; x <= R; x += 1.5) {
      if (x * x + z * z > R * R) continue;
      const h = terrain.height(x, z);
      n++; hs.push(h - wl);
      if (h < wl) wet++;
      if (h < wl - EYE) over++;
      deepest = Math.min(deepest, h - wl);
    }
  }
  hs.sort((a, b) => a - b);
  const q = (f) => hs[Math.min(hs.length - 1, Math.floor(hs.length * f))];
  console.log(`${key.padEnd(10)} water ${wl.toFixed(2)}  wet ${(100 * wet / n).toFixed(1)}%  `
    + `over eye ${(100 * over / n).toFixed(1)}%  deepest ${deepest.toFixed(2)} m  `
    + `floor p05 ${q(0.05).toFixed(2)} p50 ${q(0.5).toFixed(2)}`);
  terrain.dispose();
}
