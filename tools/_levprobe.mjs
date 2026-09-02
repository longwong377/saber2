import './dom-shim.mjs';
import * as THREE from 'three';
const V = (x,y,z)=>new THREE.Vector3(x,y,z);
const { bootWorld, idleInput } = await import('./checks/_coop.mjs');
const { MORALE } = await import('../src/game/Morale.js');
const idle = idleInput();
const { world } = await bootWorld({ level:'geonosis', settings:{ mode:'theline', level:'geonosis', quality:'low' }, runSeed:9 });
const d = world.command; d.start(1); const c = d.commander; c.player = world.player;
world.player.position.set(0, world.terrain.height(0,0), 0);
const mine = world.player.team ?? 0;
for (let i=world.enemies.length-1;i>=0;i--){ const e=world.enemies[i]; if(e.team===mine) continue; e.dispose?.(); world.enemies.splice(i,1); }
world.director.active = false; world.director.spawnQueue.length = 0;
const men = d.roster.living.map(t=>t.body).filter(Boolean);
men.forEach((e,i)=>{ const a=(i/men.length)*Math.PI*2; e.position.set(Math.sin(a)*4,0,Math.cos(a)*4); e.position.y=world.terrain.height(e.position.x,e.position.z); });
d.order('circle', c); d._troops(1/30, {});
console.log('MORALE.NEAR', MORALE.NEAR, 'men', men.length, 'gathered', d.lineGathered(c));
const ctx = world._frameCtx || { world, enemies: world.enemies, terrain: world.terrain, physics: world.physics, particles: world.particles };
const S = world.player.stratagems;
for (let i=0;i<12;i++){ const at=V(c.player.position.x+(i-5.5)*3.4,0,c.player.position.z+((i%3)-1)*2.6); at.y=world.terrain.height(at.x,at.z); S.blast(ctx, at, 6.5, 70, 120, {core:0.25,size:1.7,crater:0.9}); }
for (let i=0;i<60;i++) world.update(1/30, idle);
const rep=(t)=>{ const a=men.filter(e=>!e.dead); const line=a.map(e=>`${e.id}:${e.downed?'DOWN':''}hp${(e.hp||0).toFixed(0)} d${e.position.distanceTo(world.player.position).toFixed(0)} br${e.broken?1:0} nv${(e.nerve??-1).toFixed?.(2)} mo${(e.morale??-1).toFixed?.(2)}`).join(' | ');
  console.log(t, 'alive', a.length, 'gathered', d.lineGathered(c), '\n   ', line); };
rep('after');
const dbg=(e,t)=>{ console.log(t,e.id,'pos',e.position.toArray().map(v=>v.toFixed(1)).join(','),
  'gy',world.terrain.height(e.position.x,e.position.z).toFixed(1),
  'vel',(e.vel||e.velocity)?.toArray?.().map(v=>v.toFixed(2)).join(',')??'-',
  'speed',e.speed,'stun',e.stun,'stagger',e.stagger,'prone',e.prone,'getUp',e.getUp,
  'ragdoll',!!e.ragdoll,'act',e.actor?.state??e.state,'goal',e.goal?.toArray?.().map(v=>v.toFixed(1)).join(',')??'-',
  'slot',e.trooper?.slot?.pos?.toArray?.().map(v=>v.toFixed(1)).join(',')??'-'); };
for (let s=0;s<5;s++){ for(let i=0;i<30*5;i++) world.update(1/30, idle); rep('t+'+((s+1)*5));
  for(const e of men.filter(x=>!x.dead)) dbg(e,'  t+'+((s+1)*5)); }
const e1 = men.filter(x=>!x.dead)[0];
console.log('stuckT', e1._stuckT, 'wish', e1.wish?.toArray?.().map(v=>v.toFixed(2)).join(','));
const o=new THREE.Vector3(e1.position.x, e1.position.y+0.9, e1.position.z);
for (let a=0;a<8;a++){ const th=a/8*Math.PI*2; const dir=new THREE.Vector3(Math.sin(th),0,Math.cos(th));
  const h = world.physics?.raycast?.(o, dir, 3, null);
  console.log('  ray', (th*180/Math.PI).toFixed(0), h? h.distance.toFixed(2):'-'); }
{ const P=world.physics; const boxes=P?.staticBoxes||[];
  const c1=new THREE.Vector3(e1.position.x, e1.position.y+0.9, e1.position.z);
  const a=new THREE.Vector3(), b=new THREE.Vector3(), q=new THREE.Vector3();
  let n=0;
  for(const box of boxes){ if(box.disabled) continue;
    const rr=box.radius+1.6; if(c1.distanceToSquared(box.center)>rr*rr) continue;
    a.subVectors(c1,box.center).applyQuaternion(box.invQuat);
    const h=box.halfExtents;
    b.set(Math.max(-h.x,Math.min(h.x,a.x)),Math.max(-h.y,Math.min(h.y,a.y)),Math.max(-h.z,Math.min(h.z,a.z)));
    q.subVectors(a,b); const d2=q.lengthSq(); const r=e1.radius;
    if(d2>r*r) continue; n++;
    console.log('  BOX hit d2',d2.toExponential(2),'r',r,'half',h.toArray().map(v=>v.toFixed(2)).join(','),
      'pen px',(h.x-Math.abs(a.x)).toFixed(2),'py',(h.y-Math.abs(a.y)).toFixed(2),'pz',(h.z-Math.abs(a.z)).toFixed(2),
      'signY',Math.sign(a.y)); }
  console.log('  boxes total',boxes.length,'overlapping',n); }
console.log('terrain ring', [0,1,2,3].map(r=>[0,90,180,270].map(a=>world.terrain.height(e1.position.x+r*Math.sin(a*Math.PI/180), e1.position.z+r*Math.cos(a*Math.PI/180)).toFixed(2)).join('/')).join('  '));
