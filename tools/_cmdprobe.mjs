await import('/home/user/saber2/tools/dom-shim.mjs');
const { bootWorld, idleInput } = await import('/home/user/saber2/tools/checks/_coop.mjs');
const { world } = await bootWorld({ level:'geonosis', settings:{ mode:'command', level:'geonosis', order:'jedi' } });
const d = world.command; world.director.start(1);
const input = idleInput();
for (let i=0;i<30*20;i++) world.update(1/30, input);
const party = world.partyTeam ?? 0;
const alive = world.enemies.filter(e=>!e.dead);
const mine = alive.filter(e=>(e.team??1)===party);
console.log('alive', alive.length, 'mine', mine.length, 'hostile', alive.length-mine.length, 'partyTeam', party);
const used={}; for(const e of alive){const c=(e.A?.boss||e.A?.big)?'boss':'enemy'; used[c]=(used[c]||0)+1;}
console.log('minimap enemies-loop colours:', JSON.stringify(used), 'ally colour used: 0');
const p = world.player;
const near = alive.filter(e => e.position.distanceToSquared(p.position) < 25);
console.log('within 5m:', near.length, 'hostile within 5m:', near.filter(e=>(e.team??1)!==party).length);
console.log('formations:', Object.keys((await import('/home/user/saber2/src/game/Command.js')).FORMATIONS).join(','));
// per formation threat
const { FORMATIONS } = await import('/home/user/saber2/src/game/Command.js');
for (const f of Object.keys(FORMATIONS)) {
  d.order(f);
  for (let i=0;i<30*6;i++) world.update(1/30, input);
  const a = world.enemies.filter(e=>!e.dead);
  const n = a.filter(e => e.position.distanceToSquared(p.position) < 25);
  console.log(` ${f}: within5m ${n.length} (hostile ${n.filter(e=>(e.team??1)!==party).length}) → threat lit: ${n.length>0}`);
}
const bigs = world.enemies.filter(e=>!e.dead && (e.A?.boss||e.A?.big));
console.log('big/boss on field:', bigs.map(e=>`${e.A.label}/team${e.team}`).join(', ')||'none');
const { openState } = await import('/home/user/saber2/src/game/Combat.js');
const opens = world.enemies.filter(e=>openState(e));
console.log('open-state bodies:', opens.map(e=>`${e.A.label}/team${e.team}/${openState(e).key}`).join(', ')||'none');
