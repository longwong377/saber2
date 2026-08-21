import './dom-shim.mjs';
import * as THREE from 'three';
import { initPhysics } from '../src/physics/Rapier.js';
import { RapierWorld } from '../src/physics/RapierWorld.js';
import { DIFFICULTY } from '../src/game/Combat.js';
const { Enemy } = await import('../src/game/Enemy.js');
await import('../src/game/Levels.js');
const { attachFlight, FLIGHT } = await import('../src/game/Flight.js');
const { Player } = await import('../src/game/Player.js');
const V = (x,y,z)=>new THREE.Vector3(x,y,z);
const flat = () => ({ height: () => 0, normalAt: (x,z,o)=>o.set(0,1,0), raycast: () => null,
  size: 400, half: 200, inBounds: () => true, surfaceAt: () => 'sand', crater(){}, flush(){}, slopeAt: () => 0 });
function segDist(a0,a1,b0,b1){const u=new THREE.Vector3().subVectors(a1,a0),v=new THREE.Vector3().subVectors(b1,b0),w0=new THREE.Vector3().subVectors(a0,b0);
 const a=u.dot(u),b=u.dot(v),c=v.dot(v),d=u.dot(w0),e=v.dot(w0),D=a*c-b*b;let s,t;
 if(D<1e-9){s=0;t=b>c?d/b:e/c;}else{s=(b*e-c*d)/D;t=(a*e-b*d)/D;}
 s=Math.min(1,Math.max(0,s));t=Math.min(1,Math.max(0,t));
 return u.multiplyScalar(s).add(a0).distanceTo(v.multiplyScalar(t).add(b0));}
await initPhysics();
const pitchSign = Number(process.argv[2] || 0);
const physics = new RapierWorld({ gravity: -24, iterations: 4, maxBodies: 400 });
const terrain = flat(); physics.terrain = terrain;
const w = { scene: new THREE.Scene(), physics, terrain, statics: [], shots: 0,
  settings: { fov: 60, bloom: false, forcePower: 1, forceDrain: 1 }, difficulty: DIFFICULTY.knight,
  players: [], enemies: [], props: [], doors: [], locks: [], particles: null, time: 0, combatIntensity: 0,
  groundColor: 0xcfae82,
  engine: { addHeat(){}, hurt(){}, flash(){}, setRadial(){}, camera: new THREE.PerspectiveCamera(60,16/9,0.045,1000) },
  report(){}, notify(){}, notifyFloating(){}, addHitstop(){}, onDeflectFeedback(){}, onEnemyKilled(){},
  onLimbSevered(){}, onHitmark(){}, onExplosion(){}, spawnDebrisGroup(){},
  addProp(p){ w.props.push(p); return p; },
  spawnEnemy(t,pos){ const e=new Enemy(w,t,pos); w.enemies.push(e); return e; } };
w.bolts = { bolts: [], fire(){ w.shots++; }, update(){}, hold(){}, release(){}, threatsNear: () => [] };
attachFlight(w);
const p = new Player(w, { isLocal: true }); p.position.set(0,0,0); w.players.push(p); w.player = p;
const TYPE = process.argv[3] || 'geonosian';
if (process.env.STOOP) FLIGHT.STOOP = Number(process.env.STOOP);
const e = w.spawnEnemy(TYPE, V(2.4,0,0));
const drive = { advance: 0 }; const fire = { hit:false, held:false };
const input = { keys: new Set(), buttons:[false,false,false], mouse:{dx:0,dy:0,wheel:0}, accel:{x:0,y:0}, bindings:null,
  moveAxis:(o)=>{o.x=0;o.y=drive.advance;return o;}, act:(k)=>(k==='attackOver'?fire.held:false),
  actHit:(k)=>(k==='attackOver'&&fire.hit?(fire.hit=false,true):false) };
const pctx = { input, terrain, physics, particles:null, bolts:w.bolts, camera:w.engine.camera, time:0,
  groundColor:0, enemies:w.enemies, players:w.players, pickTarget:()=>e };
const ectx = { terrain, physics, particles:null, bolts:w.bolts, camera:w.engine.camera, time:0,
  groundColor:0, enemies:w.enemies, players:w.players, input:null, pickTarget:()=>p };
p.saber.ignite();
const dt = 1/120; let closest = Infinity, at='', swings=0, last=-9, minFlat=99, tipMax=0;
for (let i=0;i<120*60;i++) {
  pctx.time = ectx.time = w.time += dt;
  for (const pr of w.props) pr.update?.(dt);
  e.update(dt, ectx); e.target = p; p.update(dt, pctx);
  if (i>30) fire.held = false;
  const f2 = Math.hypot(e.position.x-p.position.x, e.position.z-p.position.z);
  const down = TYPE === 'geonosian' ? e._flightState === 'stoop' : true;
  drive.advance = down && f2 > 0.9 ? -1 : 0;
  p.yaw = Math.atan2(e.position.x-p.position.x, e.position.z-p.position.z);
  if (pitchSign) p.pitch = pitchSign * Math.atan2((e.position.y + 1.2) - 1.3, Math.max(0.3, f2));
  if (down) minFlat = Math.min(minFlat, f2);
  if (e.position.y < 3.0 && f2 < 2.2 && w.time - last > 0.6) { last = w.time; fire.hit = true; fire.held = true; swings++; }
  if (!p.saber?.lit) continue;
  tipMax = Math.max(tipMax, p.saber.tip.y);
  e.rig?.root.updateMatrixWorld(true);
  for (const c of e.capsules()) { if (!c.p0) continue;
    const d = segDist(p.saber.base, p.saber.tip, c.p0, c.p1) - c.r;
    if (d < closest) { closest = d; at = c.name; } }
}
console.log(`${TYPE} pitchSign ${pitchSign} STOOP ${FLIGHT.STOOP}: swings ${swings} closest ${closest.toFixed(3)} at ${at} minFlat ${minFlat.toFixed(2)} tipMax ${tipMax.toFixed(2)}`);
