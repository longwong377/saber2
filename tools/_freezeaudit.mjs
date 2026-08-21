/**
 * THROWAWAY AUDIT PROBE — does the anti-freeze behaviour hold on a ground and
 * in a mode `tools/checks/nerve.mjs` never drives?
 *
 * nerve.mjs measures Geonosis in `command`. The player reaches allies through
 * the `allies` slider ("muster anywhere"), which puts a contingent into modes
 * that are NOT command, on grounds that are not Geonosis. This asks the same
 * question there: what share of allied body-frames are motionless, upright and
 * silent, and what is the longest unbroken run.
 */
import './dom-shim.mjs';

const DT = 1 / 30, WARM = 12, STILL = 0.35, DOWN = 0.5;

async function army(level, mode, allies) {
  const { stubEngine } = await import('./checks/_coop.mjs');
  const { World } = await import('../src/game/World.js');
  const { DEFAULT_SETTINGS } = await import('../src/ui/Menu.js');
  const { initPhysics } = await import('../src/physics/Rapier.js');
  const { DIFFICULTY } = await import('../src/game/Combat.js');
  await initPhysics();
  const engine = await stubEngine();
  const s = { ...DEFAULT_SETTINGS, quality: 'low', mode, allies };
  const world = new World(engine, s);
  world.runSeed = 20260821;
  world.difficulty = DIFFICULTY[s.difficulty] || DIFFICULTY.knight;
  await world.loadLevel(level);
  world.spawnPlayer({ name: 'Jedi', isLocal: true });
  return world;
}

async function measure(level, mode, allies, seconds = 18) {
  const { idleInput } = await import('./checks/_coop.mjs');
  const world = await army(level, mode, allies);
  const input = idleInput();
  world.director?.start?.(1);
  for (let i = 0; i < WARM * 30; i++) world.update(DT, input);
  const run = new Map();
  let frames = 0, bodies = 0, frozen = 0, worst = 0, teams = new Set();
  for (let i = 0; i < seconds * 30; i++) {
    world.update(DT, input);
    for (const e of world.enemies) {
      if (!e || e.dead || !e.trooper) continue;
      if (e.team !== world.player?.team) continue;
      teams.add(e.team);
      bodies++;
      const moving = Math.hypot(e.velocity?.x || 0, e.velocity?.z || 0) >= STILL;
      const firing = (e.burstLeft > 0) || (e.aimCharge > 0) || (e.muzzleFlash > 0);
      const isFrozen = !moving && !firing && (e.crouch || 0) < DOWN;
      const r = isFrozen ? (run.get(e.id) || 0) + DT : 0;
      run.set(e.id, r);
      if (isFrozen) frozen++;
      if (r > worst) worst = r;
    }
    frames++;
  }
  world.dispose?.();
  const per = bodies / Math.max(1, frames);
  console.log(`${level.padEnd(10)} ${mode.padEnd(9)} allies=${allies}  bodies/frame ${per.toFixed(1)}  `
    + `frozen ${(100 * frozen / Math.max(1, bodies)).toFixed(1)}%  worst run ${worst.toFixed(1)}s`);
}

for (const [level, mode] of [['scoria', 'waves'], ['wood', 'waves'], ['drifts', 'waves'], ['alpine', 'skirmish'], ['colosseum', 'waves']]) {
  await measure(level, mode, 8);
}
