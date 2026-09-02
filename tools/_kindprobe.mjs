import './dom-shim.mjs';
const { bootWorld, idleInput } = await import('./checks/_coop.mjs');
const { world } = await bootWorld({ level: 'geonosis',
  settings: { mode: 'waves', level: 'geonosis', allies: 0, quality: 'low' }, runSeed: 21 });
const input = idleInput();
for (let i = 0; i < 30; i++) world.update(1/30, input);
const p = world.player;
console.log('destruction?', !!world.destruction, 'structures', world.destruction?.structures?.length);
console.log('doors', world.doors.length);
console.log('command?', !!world.command, 'director?', !!world.director, 'downedMen', world.director?.downedMen, world.director?.downedScale);
const near = (world.destruction?.structures||[]).map(s=>({k:s.profile===undefined?'?':s.spec?.profile||s.kind, d:s.centre.distanceTo(p.position), hp:s.hp, r:s.radius})).sort((a,b)=>a.d-b.d).slice(0,8);
console.log(near);
console.log('props kinds', [...new Set((world.props||[]).map(x=>x.kind||x.constructor.name))].slice(0,20));
