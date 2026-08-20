/**
 * WHAT A FALLING TREE COSTS YOU — the table, in about a second.
 *
 * Note #31 is "trees instakill you when they fall instead of doing damage
 * relative to their size or speed", and the answer to it is a CURVE: a trunk
 * bills `Combat.impactDamage` off the mass that arrived and the speed it
 * arrived at, so every tree in the wood hurts differently and every part of
 * each tree hurts differently again. That is not a thing a single number in a
 * comment can carry, and it is not a thing to re-derive by hand — this drives
 * the shipped `Forest.crushDamage` over the size distribution the wood plants
 * and prints where the survivable/lethal line falls.
 *
 * Use it before moving `k`, the floor or the ceiling in Combat.js: those three
 * are shared with every thrown crate and every thrown body in the game.
 *
 *     node --import ./tools/register.mjs tools/_treedmg.mjs
 *
 * The bound itself lives in `tools/checks/forest.mjs`, which asserts the SHAPE
 * — bigger hurts more, further out hurts more, a sapling cannot kill you and
 * the biggest trunk in the wood can — through the same path a felling takes.
 */
import './dom-shim.mjs';
import * as THREE from 'three';
import { Forest } from '../src/world/Trees.js';
import { propMaterials } from '../src/world/Props.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);
function stubWorld() {
  return { scene: new THREE.Scene(), statics: [], props: [], enemies: [], players: [],
    physics: { staticBoxes: [], bodies: [], addStaticBox: () => null, removeStaticBox() {}, add(b){return b;}, remove(){} },
    particles: { sparkBurst() {}, sandPuff() {} }, addProp(p) { this.props.push(p); return p; },
    addHitstop() {}, terrain: null, player: { position: V(0,0,0) }, settings: { quality: 'low' } };
}

const SIZES = [
  ['sapling',  7.5, 0.16],
  ['small',   11.0, 0.26],
  ['median',  13.0, 0.42],
  ['big',     20.0, 0.50],
  ['giant',   25.9, 0.63],
];

console.log('A falling trunk, hitting a 0.35 m-radius player. Damage, and the speed of the wood that hit them.');
console.log('');
console.log('                        hit at 15% of the trunk   at 40%           at 70%           at the tip');
for (const [name, h, r] of SIZES) {
  const w = stubWorld();
  const f = new Forest(w, {});
  f.plant([{ x: 0, z: 0, y: 0, height: h, radius: r, yaw: 0, tone: 1 }], { materials: {} });
  f.fell(0, 0, 1, 0.6);
  // step to horizontal, which is where the trunk is when it reaches the ground
  const D = f.data, len = h - D[11];
  const G = 9.81;
  let ang = 0.02, vel = 0;
  const dt = 1 / 240;
  while (ang < Math.PI / 2) { vel += (3 * G / (2 * len)) * Math.sin(ang) * dt; ang += vel * dt; }
  D[7] = ang; D[8] = vel;
  const mass = f.massPerMetre(0) * len;
  const cells = [];
  for (const t of [0.15, 0.40, 0.70, 1.0]) {
    const dmg = f.crushDamage(0, t, 0.35);
    const speed = vel * t * len;
    cells.push(`${dmg.toFixed(0).padStart(3)} hp @ ${speed.toFixed(1).padStart(4)} m/s`);
  }
  console.log(`${name.padEnd(8)} ${h.toFixed(1).padStart(4)} m × r ${r.toFixed(2)} (${(mass/1000).toFixed(1)} t)  ${cells.join('   ')}`);
}
console.log('');
console.log('The same trunks, at the tip, against a 0.5 m body (a droid) and a 1.2 m one (a beast):');
for (const [name, h, r] of SIZES) {
  const w = stubWorld();
  const f = new Forest(w, {});
  f.plant([{ x: 0, z: 0, y: 0, height: h, radius: r, yaw: 0, tone: 1 }], { materials: {} });
  f.fell(0, 0, 1, 0.6);
  const D = f.data, len = h - D[11];
  let ang = 0.02, vel = 0; const dt = 1 / 240;
  while (ang < Math.PI / 2) { vel += (3 * 9.81 / (2 * len)) * Math.sin(ang) * dt; ang += vel * dt; }
  D[7] = ang; D[8] = vel;
  console.log(`${name.padEnd(8)}  droid ${f.crushDamage(0, 1, 0.5).toFixed(0).padStart(3)} hp   beast ${f.crushDamage(0, 1, 1.2).toFixed(0).padStart(3)} hp`);
}

console.log('');
console.log('Where the survivable/lethal line falls for a 100 hp player (0.35 m radius):');
for (const [name, h, r] of SIZES) {
  const w = stubWorld();
  const f = new Forest(w, {});
  f.plant([{ x: 0, z: 0, y: 0, height: h, radius: r, yaw: 0, tone: 1 }], { materials: {} });
  f.fell(0, 0, 1, 0.6);
  const D = f.data, len = h - D[11];
  let ang = 0.02, vel = 0; const dt = 1 / 240;
  while (ang < Math.PI / 2) { vel += (3 * 9.81 / (2 * len)) * Math.sin(ang) * dt; ang += vel * dt; }
  D[7] = ang; D[8] = vel;
  let lethal = -1, half = -1;
  for (let s = 0; s <= 1000; s++) {
    const t = s / 1000, d = f.crushDamage(0, t, 0.35);
    if (half < 0 && d >= 50) half = t;
    if (lethal < 0 && d >= 100) { lethal = t; break; }
  }
  const fmt = (t) => t < 0 ? 'never' : `${(t * len).toFixed(1)} m out (${(t * 100).toFixed(0)}% of the trunk)`;
  console.log(`${name.padEnd(8)} half your health from ${fmt(half).padEnd(28)} dead from ${fmt(lethal)}`);
}
