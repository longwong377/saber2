/** The three sets, on a real player, measured rather than asserted. */
import './dom-shim.mjs';
const { bootWorld, idleInput } = await import('./checks/_coop.mjs');
const { SABER_SETS } = await import('../src/game/SaberSet.js');
const idle = idleInput();
const STEP = 1 / 30;
for (const S of SABER_SETS) {
  const { world } = await bootWorld({
    level: 'geonosis',
    settings: { mode: 'waves', level: 'geonosis', allies: 0, quality: 'low', saberSet: S.id },
    runSeed: 5,
  });
  const p = world.player;
  let err = null;
  try { for (let i = 0; i < 120; i++) world.update(STEP, idle); } catch (e) { err = e; }
  const blades = [p.saber, p.sidearm?.saber].filter(Boolean);
  console.log(`${S.id.padEnd(7)} sidearm=${!!p.sidearm} blades=${blades.length}`
    + ` grip=${p.control?.grip} hands=${p.handsOnHilt?.() ?? '?'}`
    + ` lit=${blades.filter((b) => b.ignition > 0.5).length}`
    + ` ${err ? 'THREW: ' + err.message : '120 frames clean'}`);
  world.unload();
}
