import './dom-shim.mjs';
const { bootWorld, idleInput } = await import('./checks/_coop.mjs');
const { fieldCompanion } = await import('../src/game/Companions.js');
const D = await import('../src/game/Driving.js');
const idle = idleInput();
const { world } = await bootWorld({ level: 'geonosis',
  settings: { mode: 'waves', level: 'geonosis', allies: 0, quality: 'low' }, runSeed: 7 });
const STEP = 1/30; const p = world.player;
for (let i=0;i<30;i++) world.update(STEP, idle);
for (const kind of ['taun','blurrg','varac']) {
  const m = fieldCompanion(world, p, kind);
  if (!m) { console.log(kind, 'FAILED TO FIELD'); continue; }
  m.position.copy(p.position); m.position.x += 1.5;
  for (let i=0;i<10;i++) world.update(STEP, idle);
  console.log(kind, '| A.crew =', m.A?.crew, '| isCrewed =', D.isCrewed(m),
    '| drivableNear =', D.drivableNear(world, p)?.type ?? null,
    '| whyNotDrive =', JSON.stringify(D.whyNotDrive(world, p, m)));
  console.log('   player.driving after take attempt:', (()=>{ try { return !!D.takeControls?.(world,p,m); } catch(e){ return 'no takeControls export'; } })());
  m.dead = true; m.hp = 0;
}
console.log('Driving exports:', Object.keys(D).join(','));
process.exit(0);
