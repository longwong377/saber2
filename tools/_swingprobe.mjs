import './dom-shim.mjs';
import * as THREE from 'three';
import { initPhysics } from '../src/physics/Rapier.js';
import { RapierWorld } from '../src/physics/RapierWorld.js';
import { DIFFICULTY } from '../src/game/Combat.js';
const { Enemy } = await import('../src/game/Enemy.js');
await import('../src/game/Levels.js');
const { attachFlight } = await import('../src/game/Flight.js');
const { Player } = await import('../src/game/Player.js');
const V = (x,y,z)=>new THREE.Vector3(x,y,z);
const flat = () => ({ height: () => 0, normalAt: (x,z,o)=>o.set(0,1,0), raycast: () => null,
  size: 400, half: 200, inBounds: () => true, surfaceAt: () => 'sand', crater(){}, flush(){}, slopeAt: () => 0 });
await initPhysics();
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
const e = w.spawnEnemy('geonosian', V(2.4,0,0));
const drive = { advance: 0 }; const fire = { hit:false, held:false };
const input = { keys: new Set(), buttons:[false,false,false], mouse:{dx:0,dy:0,wheel:0}, accel:{x:0,y:0}, bindings:null,
  moveAxis:(o)=>{o.x=0;o.y=drive.advance;return o;}, act:(k)=>(k==='attackOver'?fire.held:false),
  actHit:(k)=>(k==='attackOver'&&fire.hit?(fire.hit=false,true):false) };
const pctx = { input, terrain, physics, particles:null, bolts:w.bolts, camera:w.engine.camera, time:0,
  groundColor:0, enemies:w.enemies, players:w.players, pickTarget:()=>e };
const ectx = { terrain, physics, particles:null, bolts:w.bolts, camera:w.engine.camera, time:0,
  groundColor:0, enemies:w.enemies, players:w.players, input:null, pickTarget:()=>p };
p.saber.ignite();
const dt = 1/120;
for (let i=0;i<120*20;i++) {
  pctx.time = ectx.time = w.time += dt;
  for (const pr of w.props) pr.update?.(dt);
  e.update(dt, ectx); e.target = p; p.update(dt, pctx);
  if (i>30) fire.held = false;
  const f2 = Math.hypot(e.position.x-p.position.x, e.position.z-p.position.z);
  const down = e._flightState === 'stoop';
  drive.advance = down && f2 > 1.4 ? -1 : 0;
  if (down) p.yaw = Math.atan2(e.position.x-p.position.x, e.position.z-p.position.z);
  if (down && i % 30 === 0) console.log(`   stoop t=${(i/120).toFixed(2)} flat=${f2.toFixed(2)} ey=${e.position.y.toFixed(2)} dot=${((p.velocity.x*(e.position.x-p.position.x)+p.velocity.z*(e.position.z-p.position.z))/Math.max(0.01,f2)).toFixed(2)} pvel=${Math.hypot(p.velocity.x,p.velocity.z).toFixed(2)} evel=${Math.hypot(e.velocity.x,e.velocity.z).toFixed(2)}`);
  if (i % 120 === 0) console.log(`${(i/120).toFixed(0)}s state=${e._flightState} flight=${!!e._flight} y=${e.position.y.toFixed(2)} flat=${f2.toFixed(2)} pmoved=${p.position.length().toFixed(2)} lit=${p.saber.lit}`);
}
