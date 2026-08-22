/** Where does the engagement's front sit, relative to the men who must take it? */
import './dom-shim.mjs';
const H = await import('./checks/_coop.mjs');
const { engagementFront } = await import('../src/world/Front.js');
const { frontLine } = await import('../src/world/Battlefield.js');
const { MORALE } = await import('../src/game/Morale.js');
for (const seed of [1, 3, 7]) {
  const { world } = await H.bootWorld({ level: 'geonosis',
    settings: { mode: 'theline', level: 'geonosis', order: 'jedi' }, runSeed: seed });
  const d = world.command; d.start(1);
  const input = H.idleInput();
  for (let i = 0; i < 60; i++) world.update(1 / 30, input);
  const p = world.player.position;
  for (const n of [1, 2, 3]) {
    const f = engagementFront(world, n);
    const line = frontLine(f);
    const me = line.side(p.x, p.z);
    const men = d.roster.living.filter((t) => t.body && !t.body.dead)
      .map((t) => line.side(t.body.position.x, t.body.position.z).d);
    men.sort((a, b) => a - b);
    console.log(`seed ${seed} engagement ${n}: player d=${me.d.toFixed(1)} m  `
      + `men d=[${men.map((v) => v.toFixed(0)).join(' ')}]  NEAR=${MORALE.NEAR}`);
  }
  world.unload();
}
