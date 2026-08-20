/** TEMP probe: an orbital strike, end to end, on a real wave 26. */
import './dom-shim.mjs';
import * as THREE from 'three';
const { initPhysics } = await import('../src/physics/Rapier.js');
const { World } = await import('../src/game/World.js');
const { DEFAULT_SETTINGS } = await import('../src/ui/Menu.js');
const { seedWaves } = await import('../src/game/Waves.js');
const St = await import('../src/game/Stratagems.js');
await initPhysics();
function stubEngine() {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(60, 16/9, 0.045, 900);
  const sun = new THREE.DirectionalLight(0xffffff, 1); sun.shadow.camera.updateProjectionMatrix();
  scene.add(sun, new THREE.HemisphereLight(0x88aaff, 0x886644, 1));
  return { scene, camera, sun, hemi: scene.children[1], sunDir: new THREE.Vector3(0.4,0.7,0.5).normalize(),
    renderer: { info: { render: { calls:0, triangles:0 }, memory: { geometries:0, textures:0 } } },
    profiler: { begin(){}, end(){}, beginDraw(){}, endDraw(){}, dispose(){} },
    applyAtmosphere(){}, fitShadows(){}, flash(){}, hurt(){}, addHeat(){}, setFocus(){}, setRadial(){},
    setGrain(){}, setBloom(){}, setSense(){}, setQuality(){}, setResolutionScale(){}, render(){}, punch(){}, rumble(){} };
}
const idle = { axis:{x:0,y:0}, act:()=>false, actHit:()=>false, actDown:()=>false,
  moveAxis(o){ if(o){o.x=0;o.y=0;return o;} return {x:0,y:0}; },
  mouse:{dx:0,dy:0,wheel:0,left:false,right:false}, delta:{x:0,y:0}, accel:{x:0,y:0} };
seedWaves(4242);
const world = new World(stubEngine(), { ...DEFAULT_SETTINGS, quality: 'low' });
await world.loadLevel('geonosis');
world.spawnPlayer();
const p = world.player;
p.damage = () => false;
world.director.start(26);
for (let f = 0; f < 60 * 90; f++) {
  world.update(1/60, idle);
  if (world.director.remaining === 0 && world.enemies.filter(e=>!e.dead).length >= 18) break;
}
const alive = () => world.enemies.filter(e => !e.dead);
const counts = {}; for (const e of alive()) counts[e.type] = (counts[e.type]||0)+1;
const hpTotal = alive().reduce((a,e)=>a+e.hp,0);
console.log(`FIELD  wave 26, ${alive().length} bodies, ${hpTotal|0} hp:`, Object.entries(counts).map(([k,v])=>`${v}x${k}`).join(' '));
function densest(R) {
  let best = null; const L = alive();
  for (const c of L) { let n=0,hp=0;
    for (const e of L) if (e.position.distanceTo(c.position) <= R) { n++; hp+=e.hp; }
    if (!best || n>best.n) best={n,hp,at:c.position.clone()}; }
  return best;
}
const d12 = densest(12);
console.log(`       densest 12 m disc: ${d12.n} bodies, ${d12.hp|0} hp`);
const snap = alive().map(e => ({ e, pos:e.position.clone(), hp:e.hp, force:e.force }));
const restore = () => { for (const s of snap) { s.e.position.copy(s.pos); s.e.hp=s.hp; s.e.force=s.force; s.e.dead=false; } };
const S = p.stratagems;
const ctx = { dt:1/60, terrain: world.terrain, enemies: world.enemies, particles: world.particles,
  physics: world.physics, world, input: idle, camera: world.engine.camera, time: world.time, groundColor: 0 };
function trial(row, label) {
  restore();
  const site = d12.at.clone(); site.y = world.terrain.height(site.x, site.z);
  const before = snap.map(s => s.e.hp);
  p.position.set(site.x + 60, 0, site.z);
  row(site);
  let killed=0, dealt=0;
  snap.forEach((s,i)=>{ const t=before[i]-s.e.hp; dealt+=Math.max(0,t); if (s.e.hp<=0||s.e.dead) killed++; });
  console.log(`  ${label.padEnd(30)} ${String(killed).padStart(2)} killed of ${snap.length}, ${String(dealt|0).padStart(5)} hp`);
  return {killed, dealt};
}
console.log('\nWHAT EACH CALL IS WORTH, on the densest disc of that field:');
trial(site => S.blast(ctx, site, 7.5, 62, 150), 'SHIPPED strike (r7.5, 150)');
const strike = St.STRATAGEM_BY_ID.strike;
trial(site => strike.fire(ctx, site, S, strike), 'NEW orbital strike');
const barrage = St.STRATAGEM_BY_ID.barrage;
trial(site => { barrage.fire(ctx, site, S); for (let i=0;i<200;i++) S.update(1/60, ctx); }, 'NEW artillery barrage');
const strafe = St.STRATAGEM_BY_ID.strafe;
trial(site => { for (const c of S.gunRun(ctx, site)) c.fn(site.clone().setY(site.y+26), ctx); }, 'NEW strafing run');

// ── the crater, and the clock ───────────────────────────────────────────
restore();
const T = world.terrain;
const cx = d12.at.x + 70, cz = d12.at.z;
const h0 = T.height(cx, cz);
S.blast(ctx, new THREE.Vector3(cx, h0, cz), 12, 150, 300, { core:0.35, shake:1, size:3.6, crater:2.1 });
let rimMax = 0;
for (let a = 0; a < 6.28; a += 0.4) rimMax = Math.max(rimMax, h0 - T.height(cx+Math.cos(a)*0.4, cz+Math.sin(a)*0.4));
console.log(`\nCRATER  ${(h0).toFixed(2)} → ${T.height(cx,cz).toFixed(2)} — ${rimMax.toFixed(2)} m deep, 6.0 m across`);

// ── the timeline, driven through the real state machine ────────────────
restore();
p.position.set(d12.at.x - 40, 0, d12.at.z);
p.force = 400;
// Look at the cluster, so the beam has something to find.
p.camera.yaw = Math.atan2(d12.at.x - p.position.x, d12.at.z - p.position.z) + Math.PI;
p.camera.pitch = -0.18;
const held = new Set(['stratagem']), hits = new Set();
const input = { act:(id)=>held.has(id), actHit:(id)=>hits.has(id), actDown:()=>false, actAxis:()=>0,
  moveAxis(o){ if(o){o.x=0;o.y=0;return o;} return {x:0,y:0}; },
  mouse:{dx:0,dy:0,wheel:0,left:false,right:false}, delta:{x:0,y:0}, accel:{x:0,y:0}, locked:true, enabled:true };
const log = [];
let t = 0, i = 0, released = false, landed = null;
const KEY_EVERY = 0.28;            // a deliberate human pace, 3.6 presses a second
let nextKey = 0;
const HOLD_MARK = 1.2;             // how long this driver spends painting
let markOpenedAt = null;
const before = snap.map(s => s.e.hp);
S.reset();
for (let f = 0; f < 60 * 20; f++) {
  hits.clear();
  if (!S.designating && i < strike.code.length && t >= nextKey) {
    hits.add(St.DIR_ACTION[strike.code[i]]);
    const w = S.wordAt({world, enemies: world.enemies}, i);
    log.push([t, `keystroke ${i+1}/${strike.code.length} — "${w}"`]);
    i++; nextKey = t + KEY_EVERY;
  }
  if (S.designating && markOpenedAt === null) { markOpenedAt = t; log.push([t, `designation open — ${S.designating.lock ? 'LOCKED on ' + S.designating.lock.type : 'ground'}`]); }
  if (S.designating && markOpenedAt !== null && t - markOpenedAt >= HOLD_MARK && !released) {
    held.delete('stratagem'); released = true; log.push([t, 'released — call away, lance inbound']);
  }
  const pend0 = S.pending.length;
  world.time = t;
  p.update(1/60, { dt:1/60, terrain: world.terrain, enemies: world.enemies, particles: world.particles,
    physics: world.physics, world, input, camera: world.engine.camera, time: t, groundColor: 0 });
  if (pend0 && !S.pending.length && landed === null) { landed = t; log.push([t, 'IMPACT']); }
  t += 1/60;
  if (landed !== null && t > landed + 0.2) break;
}
console.log('\nTIMELINE  one orbital strike, driven through the real input path:');
for (const [tt, what] of log) console.log(`   t=${tt.toFixed(2)}s  ${what}`);
let killed=0, dealt=0;
snap.forEach((s,idx)=>{ const d=before[idx]-s.e.hp; dealt+=Math.max(0,d); if (s.e.hp<=0||s.e.dead) killed++; });
console.log(`   killed ${killed} of ${snap.length}, ${dealt|0} hp, player force ${p.force.toFixed(0)}/400`);
