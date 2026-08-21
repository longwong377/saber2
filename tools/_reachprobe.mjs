/* scratch probe: how high does a standing player's blade actually get? */
import './dom-shim.mjs';
import * as THREE from 'three';
import { initPhysics } from '../src/physics/Rapier.js';
import { RapierWorld } from '../src/physics/RapierWorld.js';
import { Player } from '../src/game/Player.js';
import { DIFFICULTY } from '../src/game/Combat.js';

const flat = () => ({
  height: () => 0, normalAt: (x, z, o) => o.set(0, 1, 0), raycast: () => null,
  size: 400, half: 200, inBounds: () => true, surfaceAt: () => 'sand',
  crater() {}, flush() {}, slopeAt: () => 0,
});
const world = () => {
  const physics = new RapierWorld({ gravity: -24, iterations: 4, maxBodies: 400 });
  const terrain = flat(); physics.terrain = terrain;
  return { scene: new THREE.Scene(), physics, terrain, statics: [],
    settings: { fov: 60, bloom: false, forcePower: 1, forceDrain: 1 },
    difficulty: DIFFICULTY.knight, players: [], enemies: [], props: [], doors: [], locks: [],
    particles: null, bolts: null, time: 0, combatIntensity: 0, groundColor: 0xcfae82,
    engine: { addHeat() {}, hurt() {}, flash() {}, setRadial() {}, camera: new THREE.PerspectiveCamera(60, 16 / 9, 0.045, 1000) },
    report() {}, notify() {}, notifyFloating() {}, addHitstop() {},
    onDeflectFeedback() {}, onEnemyKilled() {}, onLimbSevered() {}, onHitmark() {}, onExplosion() {}, spawnDebrisGroup() {} };
};

await initPhysics();

function run(action, pitch = 0) {
  const w = world();
  const p = new Player(w, { isLocal: true });
  p.position.set(0, 0, 0); w.players.push(p);
  const fire = { hit: false };
  const input = {
    keys: new Set(), buttons: [false, false, false], mouse: { dx: 0, dy: 0, wheel: 0 },
    accel: { x: 0, y: 0 }, bindings: null,
    moveAxis: (o) => { o.x = 0; o.y = 0; return o; },
    act: (k) => (k === action ? fire.held : false),
    actHit: (k) => (k === action && fire.hit ? (fire.hit = false, true) : false),
  };
  const ctx = { input, terrain: w.terrain, physics: w.physics, particles: null, bolts: null,
    camera: w.engine.camera, time: 0, groundColor: 0, enemies: [], players: w.players, pickTarget: () => null };
  const dt = 1 / 120;
  const step = (n) => { for (let i = 0; i < n; i++) { ctx.time = w.time += dt; p.update(dt, ctx); } };
  p.saber.ignite();
  step(180);                      // settle, blade lit
  p.pitch = pitch;
  let maxTip = -9, maxBase = -9, maxAny = -9;
  fire.hit = true; fire.held = true;
  for (let i = 0; i < 240; i++) {
    ctx.time = w.time += dt; p.update(dt, ctx);
    if (i > 30) fire.held = false;
    const s = p.saber;
    if (s && s.lit) {
      maxTip = Math.max(maxTip, s.tip.y);
      maxBase = Math.max(maxBase, s.base.y);
      maxAny = Math.max(maxAny, s.tip.y, s.base.y);
    }
  }
  return { action, pitch, maxTip, maxBase, maxAny, feet: p.position.y };
}

for (const a of ['attackOver', 'thrust', 'attackSpin', 'attackStab']) {
  for (const pitch of [0, 0.6, 1.16, -0.6, -1.28]) {
    const r = run(a, pitch);
    console.log(`${a.padEnd(12)} pitch ${pitch.toFixed(2)}  tip max ${r.maxTip.toFixed(3)} m  base max ${r.maxBase.toFixed(3)} m`);
  }
}
