import './dom-shim.mjs';
import * as THREE from 'three';
import { initPhysics } from '../src/physics/Rapier.js';
import { RapierWorld } from '../src/physics/RapierWorld.js';
import { DIFFICULTY } from '../src/game/Combat.js';
const { Enemy } = await import('../src/game/Enemy.js');
await import('../src/game/Levels.js');

const flat = () => ({ height: () => 0, normalAt: (x, z, o) => o.set(0, 1, 0), raycast: () => null,
  size: 400, half: 200, inBounds: () => true, surfaceAt: () => 'sand', crater() {}, flush() {}, slopeAt: () => 0 });
await initPhysics();
const physics = new RapierWorld({ gravity: -24, iterations: 4, maxBodies: 400 });
const terrain = flat(); physics.terrain = terrain;
const w = { scene: new THREE.Scene(), physics, terrain, statics: [],
  settings: { fov: 60, bloom: false, forcePower: 1, forceDrain: 1 }, difficulty: DIFFICULTY.knight,
  players: [], enemies: [], props: [], doors: [], locks: [], particles: null,
  bolts: { fire() {}, update() {} }, time: 0, combatIntensity: 0, groundColor: 0xcfae82,
  engine: { addHeat() {}, hurt() {}, flash() {}, setRadial() {}, camera: new THREE.PerspectiveCamera(60, 16/9, 0.045, 1000) },
  report() {}, notify() {}, notifyFloating() {}, addHitstop() {}, onDeflectFeedback() {}, onEnemyKilled() {},
  onLimbSevered() {}, onHitmark() {}, onExplosion() {}, spawnDebrisGroup() {}, addProp(p) { w.props.push(p); } };
const target = { position: new THREE.Vector3(0,0,0), team: 0, dead: false, hp: 100, maxHp: 100, isLocal: true,
  chest: new THREE.Vector3(0,1.3,0), velocity: new THREE.Vector3(), damage() {}, grounded: true, radius: 0.35 };
w.players.push(target); w.player = target;
const ctx = { terrain, physics, particles: null, bolts: w.bolts, camera: w.engine.camera, time: 0,
  groundColor: 0, enemies: w.enemies, players: w.players, input: null, pickTarget: () => target };

for (const [type, X] of [['jet', 2], ['jet', 14], ['jet', 30], ['remote', 14]]) {
  const e = new Enemy(w, type, new THREE.Vector3(X, 0, 0)); w.enemies.length = 0; w.enemies.push(e); e.target = target;
  let worst = 0, at = 0;
  for (let i = 0; i < 60 * 8; i++) {
    ctx.time = w.time += 1/60; e.update(1/60, ctx); e.target = target;
    if (i < 60) continue;
    e.rig?.root.updateMatrixWorld(true);
    const caps = e.capsules();
    const hips = caps.find((c) => c.name === 'hips');
    if (!hips) continue;
    const err = Math.hypot(hips.p0.x - e.position.x, hips.p0.z - e.position.z);
    if (err > worst) { worst = err; at = i / 60; }
  }
  console.log(`${type} spawned at x=${X}: worst hips-to-body horizontal error ${worst.toFixed(3)} m at ${at.toFixed(1)}s (body now x=${e.position.x.toFixed(1)})`);
}
