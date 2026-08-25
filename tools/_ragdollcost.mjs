/**
 * WHAT A RAGDOLL COSTS TO BUILD AND TO THROW AWAY — PLAN §6's B1b, piece 1.
 *
 * B1b asks for ragdoll POOLING. `src/game/Ragdoll.js` has no pool: every death
 * builds a fresh rigid-body set and every retirement throws one away. This
 * prices that, so the question is answered with a number instead of a label.
 *
 * ── THE FIXTURE ─────────────────────────────────────────────────────────
 *
 * Lifted whole from `tools/checks/lifecycle.mjs`'s corpse-material check — the
 * headless world stub, a real `Enemy`, a real `goRagdoll()`, a real
 * `dispose()`. Nothing about the subject is invented here; the additions are
 * the clock, Rapier's OWN counters either side of each cycle, and a split of
 * `goRagdoll` into the part that crosses into WASM and the part that does not.
 *
 * ── THE CLOCK ───────────────────────────────────────────────────────────
 *
 * CPU and not wall, and the box load printed beside every figure:
 * `tools/checks/_cpuclock.mjs` is this project's whole argument about that, and
 * the residual error bar it names (~25% under load, from cache pressure) is the
 * honest one on everything below. A COUNT is the same number on every machine
 * and a millisecond is one machine's — so the counts are the load-bearing rows
 * here (19 bodies, 19 colliders, 18 joints, and 0 of any of them left behind)
 * and the milliseconds are only there to answer "is this a frame's worth".
 *
 * ── HOW TO READ THE ANSWER ──────────────────────────────────────────────
 *
 * A death is not a per-frame cost, it is an event, so the per-death figure has
 * to be multiplied by a rate before it can be compared to a frame. The rate is
 * not guessed here: PLAN §2's M5 table is five real minutes of `theline` per
 * cell and reads 19.7–56.0 kills and 7.0–8.7 of your own fallen, so a real
 * engagement kills something on the order of 0.1–0.25 bodies a second. The
 * closing lines below price the measured cost at that rate and at one an order
 * of magnitude above it.
 *
 * ── AND THE THING THE CLOCK CANNOT SAY, WHICH DECIDES IT ────────────────
 *
 * `Body._unbind` is `world.removeRigidBody`: taking a body OUT of the Rapier
 * world destroys it. So a pool cannot park nineteen rigid bodies somewhere
 * cheap and hand them back — it has to keep them IN the world, which is exactly
 * the 573 → 33 bodies `Corpses`' SETTLE step exists to remove and the
 * 47%-of-`world.update` physics line that step bought back. Whatever the rows
 * below say, a pool pays a per-FRAME cost to save a per-DEATH one.
 *
 *   node --import ./tools/register.mjs tools/_ragdollcost.mjs [type] [n]
 */
import './dom-shim.mjs';
import * as THREE from 'three';
import { initPhysics } from '../src/physics/Rapier.js';
import { RapierWorld } from '../src/physics/RapierWorld.js';
import { cpuMs, loadPhrase } from './checks/_cpuclock.mjs';

const V = (x, y, z) => new THREE.Vector3(x, y, z);

function stubWorld(physics, terrain) {
  const particles = { sandPuff() {}, muzzle() {}, sparkBurst() {}, cutFlare() {}, slag() {},
    plasma: { spawn() {} }, smoke: { spawn() {} } };
  return {
    scene: new THREE.Scene(), physics, terrain, statics: [],
    settings: { fov: 60, bloom: false, forcePower: 1, forceDrain: 1 },
    players: [], enemies: [], props: [], doors: [], locks: [], particles,
    bolts: { fire() {}, update() {}, threatsNear: () => [] },
    time: 0, combatIntensity: 0, groundColor: 0xcfae82,
    engine: { addHeat() {}, hurt() {}, flash() {}, setRadial() {},
      camera: new THREE.PerspectiveCamera(60, 16 / 9, 0.045, 1000) },
    report() {}, notify() {}, notifyFloating() {}, addHitstop() {},
    onDeflectFeedback() {}, onEnemyKilled() {}, onLimbSevered() {}, onHitmark() {},
    onExplosion() {}, spawnDebrisGroup() {},
  };
}

const med = (a) => { const s = [...a].sort((x, y) => x - y); return s[s.length >> 1]; };
const lo = (a) => Math.min(...a), hi = (a) => Math.max(...a);
const row = (name, a) => `  ${name.padEnd(26)} median ${med(a).toFixed(3)} ms  [${lo(a).toFixed(3)}–${hi(a).toFixed(3)}]`;

const TYPE = process.argv[2] || 'acolyte';
const N = Number(process.argv[3] || 30);
const WARM = 6;

await initPhysics();
const { Enemy, enemyRng } = await import('../src/game/Enemy.js');

const terrain = { height: () => 0, normalAt: (x, z, o) => o.set(0, 1, 0), raycast: () => null,
  size: 400, half: 200, inBounds: () => true, surfaceAt: () => 'sand',
  crater() {}, flush() {}, slopeAt: () => 0 };
const physics = new RapierWorld({ gravity: -24, iterations: 4, maxBodies: 8000 });
physics.terrain = terrain;
const world = stubWorld(physics, terrain);

const rap = () => ({ b: physics.world.bodies.len(), c: physics.world.colliders.len(),
  j: physics.world.impulseJoints.len(), wrap: physics.bodies.length, wj: physics.joints.length });

/* The two calls that cross into WASM, metered where they are, so the split
 * between "Rapier built a body" and "javascript built a holder" is measured
 * rather than reasoned about. */
let sinkAdd = 0, sinkJoint = 0, sinkRemove = 0;
const realAdd = physics.add.bind(physics);
const realJoint = physics.addJoint.bind(physics);
const realRemove = physics.remove.bind(physics);
physics.add = (b) => { const t = cpuMs(); try { return realAdd(b); } finally { sinkAdd += cpuMs() - t; } };
physics.addJoint = (j) => { const t = cpuMs(); try { return realJoint(j); } finally { sinkJoint += cpuMs() - t; } };
physics.remove = (b) => { const t = cpuMs(); try { return realRemove(b); } finally { sinkRemove += cpuMs() - t; } };

const tRag = [], tAdd = [], tJoint = [], tDisp = [], tRem = [];
let bones = 0, joints = 0;
/* Taken with NOTHING built, and compared against the same state at the end. A
 * baseline read while a body was standing would be a baseline that includes the
 * body, which is how a leak check ends up asserting the leak. */
const base = rap();

for (let i = 0; i < WARM + N; i++) {
  enemyRng.seed(4711 + i);
  const e = new Enemy(world, TYPE, V(0, 0, -3));
  e.position.set(0, 0, -3);

  const b0 = rap();
  sinkAdd = sinkJoint = 0;
  const t0 = cpuMs();
  e.actor.goRagdoll(V(0, 0, 0), V(0, 0, 0));
  const t1 = cpuMs();
  const b1 = rap();

  sinkRemove = 0;
  const t2 = cpuMs();
  e.dispose();
  const t3 = cpuMs();

  if (i < WARM) continue;
  bones = b1.b - b0.b; joints = b1.j - b0.j;
  tRag.push(t1 - t0); tAdd.push(sinkAdd); tJoint.push(sinkJoint);
  tDisp.push(t3 - t2); tRem.push(sinkRemove);
}
const end = rap();

const sum = (a) => a.reduce((x, y) => x + y, 0);
console.log(`\ntools/_ragdollcost.mjs — ${TYPE}, ${N} build/ragdoll/dispose cycles after ${WARM} warm-up, ${await loadPhrase()}`);
console.log(`\none ragdoll = ${bones} rapier rigid bodies + ${bones} colliders + ${joints} joints\n`);
console.log(row('goRagdoll() TOTAL', tRag));
console.log(row('  of which physics.add', tAdd));
console.log(row('  of which addJoint', tJoint));
console.log(row('  the rest (three.js)', tRag.map((v, i) => v - tAdd[i] - tJoint[i])));
console.log(row('dispose() TOTAL', tDisp));
console.log(row('  of which physics.remove', tRem));
/* 16.67 ms is 1/60 s written out, not a constant anybody chose. */
const FRAME = 1000 / 60;
const per = med(tRag) + med(tDisp);
console.log(`\n  one death costs ${per.toFixed(2)} ms of CPU end to end `
  + `(${(per / FRAME * 100).toFixed(1)}% of a ${FRAME.toFixed(2)} ms frame, ONCE — it is an event, not a load)`);
/**
 * A SHARE OF FRAME TIME, and the arithmetic is per SECOND rather than per frame
 * so the frame rate cancels: `rate` deaths a second cost `per * rate` ms out of
 * the 1000 ms a second contains, however many frames that is cut into.
 *
 * The pool's ceiling is the two rows that cross into WASM — `physics.add` and
 * `physics.remove` — and it is a CEILING in the generous sense: it assumes a
 * pooled body needs no re-seating at all, which is false.
 */
const poolCeiling = med(tAdd) + med(tRem);
for (const rate of [0.1, 0.25, 1, 10]) {
  const share = per * rate / 1000;
  const pool = poolCeiling * rate / 1000;
  console.log(`    at ${String(rate).padStart(5)} deaths/s: ${(share * 100).toFixed(3)}% of every frame, `
    + `of which a POOL could return at most ${(pool * 100).toFixed(3)}% `
    + `(the ${poolCeiling.toFixed(2)} ms that crosses into WASM — the rest is three.js and is rebuilt anyway)`);
}
console.log('  M5 in PLAN §2 measures 19.7-56.0 kills and 7.0-8.7 own fallen over five minutes, '
  + 'so 0.1-0.25 deaths/s is the real rate and 10 is an order of magnitude past any of it.');
console.log(`  ${N} deaths: ${sum(tRag).toFixed(1)} ms ragdolling + ${sum(tDisp).toFixed(1)} ms freeing`);
console.log(`\n  LEAK: rapier bodies ${base.b} → ${end.b}, colliders ${base.c} → ${end.c}, `
  + `joints ${base.j} → ${end.j}; wrapper ${base.wrap} → ${end.wrap} bodies, ${base.wj} → ${end.wj} joints`);
