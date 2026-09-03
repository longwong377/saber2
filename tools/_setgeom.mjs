import './dom-shim.mjs';
const { bootWorld, idleInput } = await import('./checks/_coop.mjs');
const { SABER_SETS } = await import('../src/game/SaberSet.js');
const STEP = 1 / 60;
for (const S of SABER_SETS) {
  const { world } = await bootWorld({ level: 'geonosis',
    settings: { mode: 'waves', level: 'geonosis', allies: 0, quality: 'low', saberSet: S.id }, runSeed: 5 });
  const p = world.player;
  let want = false;
  const drv = idleInput();
  drv.actHit = (a) => (a === 'thrust' && want) ? (want = false, true) : false;
  for (let i = 0; i < 60; i++) world.update(STEP, drv);
  let far = 0, farA = 0;
  const blades = [p.saber, p.sidearm?.saber].filter(Boolean);
  for (let f = 0; f < 600; f++) {
    if (f % 22 === 0) want = true;
    world.update(STEP, drv);
    const fwd = p.aimDir;
    for (const b of blades) for (const pt of [b.tip, b.base]) {
      const dx = pt.x - p.position.x, dz = pt.z - p.position.z;
      const d = Math.hypot(dx, dz);
      if (d > far) far = d;
      if ((dx * fwd.x + dz * fwd.z) > 0.5 * d && d > farA) farA = d;
    }
  }
  console.log(`  swing envelope: any ${far.toFixed(3)} m, forward-of-aim ${farA.toFixed(3)} m`);
  const h = p.control.handPos;
  console.log(`${S.id.padEnd(7)} hand→tip ${h.distanceTo(p.saber.tip).toFixed(3)}  chest→tip ${p.chest.distanceTo(p.saber.tip).toFixed(3)}`
    + `  hand→base ${h.distanceTo(p.saber.base).toFixed(3)}  lift ${(p.sidearm?.lift ?? 0).toFixed(3)}`
    + `  offset ${(p.sidearm?.offset ?? 0).toFixed(3)}  half ${(p.sidearm?.half ?? 0).toFixed(3)}`
    + `  span ${(p.sidearm?.span ?? 0).toFixed(3)}`);
  world.unload();
}
