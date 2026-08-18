await import('/home/user/saber2/tools/dom-shim.mjs');
const { bootWorld, idleInput } = await import('/home/user/saber2/tools/checks/_coop.mjs');
const { openState, openMul } = await import('/home/user/saber2/src/game/Combat.js');
const { world } = await bootWorld({ level:'geonosis', settings:{ mode:'command', level:'geonosis', order:'jedi' } });
world.director.start(1);
const input = idleInput();
for (let i=0;i<30*20;i++) world.update(1/30, input);
const party = world.partyTeam ?? 0;
const p = world.player;
const mine = world.enemies.filter(e=>!e.dead && (e.team??1)===party);
console.log('OPEN_STATES source:', JSON.stringify(Object.keys((await import('/home/user/saber2/src/game/Combat.js')).OPEN_STATES)));
// put one of MY OWN troops into an open state, next to the player
const ally = mine[0];
ally.position.copy(p.position); ally.position.x += 2;
ally.toppled = true;
const s = openState(ally);
console.log('ally downed → openState:', s ? `${s.key} "${s.label}" ${openMul(s, ally)}x` : 'none');
// the reader as written: nearest open body of ANY team
let best=null,bs=null,bd=Infinity;
for (const e of world.enemies){ const st=openState(e); if(!st) continue; const d=e.gripped?-1:e.position.distanceToSquared(p.position); if(d<bd){bd=d;best=e;bs=st;} }
console.log('readout would offer:', bs? `${bs.label} ${openMul(bs,best)}x on team${best.team} (mine=${(best.team??1)===party})` : 'nothing', 'd2', bd.toFixed(1));
// boss bar with an allied big
ally.A = { ...ally.A, big: true, label: 'CT-ALLY HEAVY' };
let boss=null;
for (const e of world.enemies){ if(e.dead || (!e.A.boss && !e.A.big)) continue; if(!boss || e.position.distanceToSquared(p.position) < boss.position.distanceToSquared(p.position)) boss=e; }
console.log('boss bar would show:', boss? `${boss.A.label} team${boss.team} (mine=${(boss.team??1)===party})` : 'nothing');
