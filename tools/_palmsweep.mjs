/**
 * THE ROLL ABOUT THE HILT, swept — which way the fist sits round the shaft.
 *
 * `_palm.mjs` says what the shipped pose does; this says what every other pose
 * would do, so the choice is made against a table instead of against a guess.
 * One boot, then `handPoseOnHilt` is called directly with the live hilt
 * quaternion for each candidate — the same function the game calls, so nothing
 * here is a second copy of the grip model.
 *
 * The candidate is a TURN OF `toward` ABOUT THE BLADE. `toward` is the free
 * axis (see handPoseOnHilt) and in first person it is already a camera-frame
 * direction rather than an arm, so rolling it about the hilt is exactly
 * "where round the shaft does the fist go".
 *
 * Read the columns as: palm-eye positive means the palm is turned at the lens,
 * which is what shows the inside of the wrist and the fingers wrapping; palm-
 * out positive is the back of the glove to the lens, which is the fault.
 * wrist-up must stay NEGATIVE — a wrist above the grip point is the icepick.
 *
 * Run: node --import ./tools/register.mjs tools/_palmsweep.mjs
 */
import './dom-shim.mjs';
import { bootWorld, idleInput } from './checks/_coop.mjs';
import * as THREE from 'three';
import { handPoseOnHilt, fpGripOn } from '../src/game/Player.js';

const { world } = await bootWorld({
  level: 'drifts',
  settings: { mode: 'sandbox', difficulty: 'knight', firstPerson: true },
});
const p = world.player;
p.camera.firstPerson = true;
p._applyViewMode?.();
p.saber.lit = true;
for (let i = 0; i < 120; i++) world.update(1 / 60, idleInput());

const cam = world.engine.camera;
cam.updateMatrixWorld(true);
const cq = new THREE.Quaternion(); cam.getWorldQuaternion(cq);
const R = new THREE.Vector3(1, 0, 0).applyQuaternion(cq);
const U = new THREE.Vector3(0, 1, 0).applyQuaternion(cq);
const E = new THREE.Vector3(0, 0, 1).applyQuaternion(cq);   // toward the lens

const hq = new THREE.Quaternion();
p.saber.root.getWorldQuaternion(hq);
const blade = new THREE.Vector3(0, 1, 0).applyQuaternion(hq);
const gs = p.saber.gripScale ?? 1;
const grip = p.saber.root.localToWorld(new THREE.Vector3(0, fpGripOn(p.saber) * gs, 0));
const hs = p.rig.scale ?? 1;

const SIDE = Number(process.env.SIDE || -0.05);
const base = new THREE.Vector3(SIDE, 1, 0).normalize().applyQuaternion(p.camera.aimQuat);

const q = new THREE.Quaternion(), wr = new THREE.Vector3();
const t = new THREE.Vector3();
console.log('\n   roll   palm(out  up  eye)    thumb(out up  eye)   wrist rel. grip(out up  eye)');
for (let deg = -180; deg < 180; deg += 20) {
  t.copy(base).applyAxisAngle(blade, deg * Math.PI / 180);
  handPoseOnHilt('R', hq, t, q, wr, hs);
  const palm = new THREE.Vector3(0, 0, 1).applyQuaternion(q);
  const thumb = new THREE.Vector3(-1, 0, 0).applyQuaternion(q);
  const f = (v) => `${v.dot(R) >= 0 ? ' ' : ''}${v.dot(R).toFixed(2)} `
    + `${v.dot(U) >= 0 ? ' ' : ''}${v.dot(U).toFixed(2)} `
    + `${v.dot(E) >= 0 ? ' ' : ''}${v.dot(E).toFixed(2)}`;
  const w = wr.clone();
  console.log(`   ${String(deg).padStart(4)}   ${f(palm)}    ${f(thumb)}    `
    + `${(w.dot(R) * 1000).toFixed(0).padStart(4)} ${(w.dot(U) * 1000).toFixed(0).padStart(4)} `
    + `${(w.dot(E) * 1000).toFixed(0).padStart(4)} mm`);
}
console.log();
world.unload();
