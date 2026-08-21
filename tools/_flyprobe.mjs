import './dom-shim.mjs';
import * as THREE from 'three';
import { initPhysics } from '../src/physics/Rapier.js';
import { RapierWorld } from '../src/physics/RapierWorld.js';
import { DIFFICULTY } from '../src/game/Combat.js';

const { Enemy, ARCHETYPES } = await import('../src/game/Enemy.js');
await import('../src/game/Levels.js');
const { attachFlight, FLIGHT, BLADE_REACH, wingLift } = await import('../src/game/Flight.js');

const flat = () => ({
  height: () => 0, normalAt: (x, z, o) => o.set(0, 1, 0), raycast: () => null,
  size: 400, half: 200, inBounds: () => true, surfaceAt: () => 'sand',
  crater() {}, flush() {}, slopeAt: () => 0,
});
const world = () => {
  const physics = new RapierWorld({ gravity: -24, iterations: 4, maxBodies: 400 });
  const terrain = flat(); physics.terrain = terrain;
  const w = { scene: new THREE.Scene(), physics, terrain, statics: [],
    settings: { fov: 60, bloom: false, forcePower: 1, forceDrain: 1 },
    difficulty: DIFFICULTY.knight, players: [], enemies: [], props: [], doors: [], locks: [],
    particles: null, bolts: null, time: 0, combatIntensity: 0, groundColor: 0xcfae82,
    engine: { addHeat() {}, hurt() {}, flash() {}, setRadial() {}, camera: new THREE.PerspectiveCamera(60, 16/9, 0.045, 1000) },
    report() {}, notify() {}, notifyFloating() {}, addHitstop() {},
    onDeflectFeedback() {}, onEnemyKilled() {}, onLimbSevered() {}, onHitmark() {}, onExplosion() {}, spawnDebrisGroup() {},
    addProp(p) { w.props.push(p); return p; },
    spawnEnemy(t, pos) { const e = new Enemy(w, t, pos); w.enemies.push(e); return e; },
  };
  return w;
};

await initPhysics();
const w = world();
attachFlight(w);
// a stationary target the enemy fights
const target = { position: new THREE.Vector3(0, 0, 0), team: 0, dead: false, hp: 100, maxHp: 100,
  isLocal: true, chest: new THREE.Vector3(0, 1.3, 0), velocity: new THREE.Vector3(),
  damage() {}, grounded: true, radius: 0.35 };
w.players.push(target);
w.player = target;

const e = w.spawnEnemy('geonosian', new THREE.Vector3(14, 0, 0));
e.target = target;
let shots = 0;
const bolts = { fire() { shots++; }, update() {} };
w.bolts = bolts;
const ctx = { terrain: w.terrain, physics: w.physics, particles: null, bolts,
  camera: w.engine.camera, time: 0, groundColor: 0, enemies: w.enemies, players: w.players,
  input: null, pickTarget: () => target };

const dt = 1 / 60;
let inReach = 0, frames = 0;
let minAlt = 99, maxAlt = -99, minLow = 99;
const trace = [];
let wingTipY0 = null, tipMin = 99, tipMax = -99;
for (let i = 0; i < 60 * 60; i++) {
  ctx.time = w.time += dt;
  for (const p of w.props) p.update?.(dt);
  e.update(dt, ctx);
  e.target = target;
  // lowest cuttable capsule on the body
  const caps = e.capsules();
  let low = 99;
  for (const c of caps) { if (c.p0) low = Math.min(low, c.p0.y - c.r, c.p1.y - c.r); }
  if (low < 90) { minLow = Math.min(minLow, low); if (low <= BLADE_REACH) inReach++; }
  frames++;
  minAlt = Math.min(minAlt, e.position.y); maxAlt = Math.max(maxAlt, e.position.y);
  if (i > 180) {
    const wt = e.rig?.get('wingTipL'), ch = e.rig?.get('chest');
    if (wt && ch) {
      e.rig.root.updateMatrixWorld(true);
      const v = new THREE.Vector3().setFromMatrixPosition(wt.obj.matrixWorld);
      const c = new THREE.Vector3().setFromMatrixPosition(ch.obj.matrixWorld);
      tipMin = Math.min(tipMin, v.y - c.y); tipMax = Math.max(tipMax, v.y - c.y);
    }
  }
  if (i === 150 || i === 300) {
    e.rig.root.updateMatrixWorld(true);
    const cs = e.capsules();
    console.log('--- frame', i, 'y', e.position.y.toFixed(2), 'state', e._flightState, 'caps', cs.length);
    console.log(cs.map((c) => `${c.name} ${c.p0.y.toFixed(2)}/${c.p1.y.toFixed(2)} r${c.r.toFixed(2)}`).join('  '));
  }
  if (i % 30 === 0) trace.push(`${(i/60).toFixed(1)}s y=${e.position.y.toFixed(2)} st=${e._flightState} low=${low<90?low.toFixed(2):'-'} d=${Math.hypot(e.position.x, e.position.z).toFixed(1)} shots=${shots}`);
}
console.log(trace.slice(0, 30).join('\n'));
console.log('---');
console.log('altitude range', minAlt.toFixed(2), '..', maxAlt.toFixed(2));
console.log('lowest capsule ever', minLow.toFixed(2), 'BLADE_REACH', BLADE_REACH);
console.log('frames within reach', inReach, '/', frames, '=', (100*inReach/frames).toFixed(1) + '%');
console.log('wing tip Y relative to feet:', tipMin.toFixed(3), '..', tipMax.toFixed(3), 'travel', (tipMax-tipMin).toFixed(3));
console.log('wing lift', wingLift(e), 'hp', e.hp);
