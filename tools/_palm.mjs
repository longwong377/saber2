/**
 * WHICH WAY THE PALM FACES, in the camera's own frame — first person and third.
 *
 * "Still looks like the palms are facing out." That is a claim about ONE axis
 * of the hand and it has never had a number against it, so every previous pass
 * at the grip argued about the wrist and the thumb and left the roll alone.
 *
 * `buildHand` settles which axis it is without a guess: the finger roots carry
 * `rotation.x = 1.24 * curl` and a positive turn about X takes +Y toward +Z, so
 * the fingers close toward +Z and THE PALM FACES THE HAND'S +Z. `GRIP_BORE`
 * agrees — the hilt's axis passes 30 mm out on +Z, which is where a rod sits
 * when a hand is closed round it.
 *
 * So the reading is `handQuat · (0,0,1)` expressed in the camera's basis:
 *
 *   out    +1 is the palm turned away from the body's centreline (sword side)
 *   up     +1 is the palm turned at the sky
 *   eye    +1 is the palm turned at the lens
 *
 * A sabre held in your own eyeline shows the INSIDE of the wrist: the palm
 * faces across the body and a little back at you, so `out` should be clearly
 * negative for the right hand and `eye` positive. `out` positive is the fault
 * the player is describing — the back of the glove to the lens.
 *
 * Run: node --import ./tools/register.mjs tools/_palm.mjs
 */
import './dom-shim.mjs';
import { bootWorld, idleInput } from './checks/_coop.mjs';
import * as THREE from 'three';

const FP = process.env.PALM_TP !== '1';
const { world } = await bootWorld({
  level: 'drifts',
  settings: { mode: 'sandbox', difficulty: 'knight', firstPerson: FP,
    fpHands: process.env.PALM_HANDS || 'one' },
});
const p = world.player;
p.camera.firstPerson = FP;
p._applyViewMode?.();
p.saber.lit = true;
for (let i = 0; i < 120; i++) world.update(1 / 60, idleInput());

const cam = world.engine.camera;
cam.updateMatrixWorld(true);
const q = new THREE.Quaternion();
cam.getWorldQuaternion(q);
const camRight = new THREE.Vector3(1, 0, 0).applyQuaternion(q);
const camUp = new THREE.Vector3(0, 1, 0).applyQuaternion(q);
const camEye = new THREE.Vector3(0, 0, 1).applyQuaternion(q);   // +Z is BACK toward the lens

const rows = [];
for (const [bone, side] of [['handR', 'R'], ['handL', 'L']]) {
  const b = p.rig.get(bone);
  if (!b || !b.obj.visible) { rows.push([side, 'not in the frame']); continue; }
  const hq = b.obj.getWorldQuaternion(new THREE.Quaternion());
  const palm = new THREE.Vector3(0, 0, 1).applyQuaternion(hq);
  const thumb = new THREE.Vector3(side === 'L' ? 1 : -1, 0, 0).applyQuaternion(hq);
  const fingers = new THREE.Vector3(0, 1, 0).applyQuaternion(hq);
  const sign = side === 'R' ? 1 : -1;   // "out" is away from the centreline
  rows.push([side,
    `palm  out ${(sign * palm.dot(camRight)).toFixed(2)}  up ${palm.dot(camUp).toFixed(2)}  `
    + `eye ${palm.dot(camEye).toFixed(2)}`,
    `thumb out ${(sign * thumb.dot(camRight)).toFixed(2)}  up ${thumb.dot(camUp).toFixed(2)}  `
    + `eye ${thumb.dot(camEye).toFixed(2)}`,
    `fingers out ${(sign * fingers.dot(camRight)).toFixed(2)}  up ${fingers.dot(camUp).toFixed(2)}  `
    + `eye ${fingers.dot(camEye).toFixed(2)}`]);
}
/* ── AND THE ONE THAT SETTLES "that's not how human hands contort" ──────
 * Two hands on one shaft is a geometric claim with two parts: each palm faces
 * the shaft, and the two hands wrap it the SAME way round. Both are dots, and
 * neither had ever been taken. */
const axis = new THREE.Vector3(0, 1, 0).applyQuaternion(
  p.saber.root.getWorldQuaternion(new THREE.Quaternion()));
const hiltAt = p.saber.root.getWorldPosition(new THREE.Vector3());
const grip = [];
for (const [bone, side] of [['handR', 'R'], ['handL', 'L']]) {
  const b = p.rig.get(bone);
  if (!b) continue;
  const wp = b.obj.getWorldPosition(new THREE.Vector3());
  const hq = b.obj.getWorldQuaternion(new THREE.Quaternion());
  const palm = new THREE.Vector3(0, 0, 1).applyQuaternion(hq);
  const knuck = new THREE.Vector3(0, 1, 0).applyQuaternion(hq);
  // the perpendicular from the wrist onto the hilt's axis
  const d = wp.clone().sub(hiltAt);
  const toShaft = d.clone().addScaledVector(axis, -d.dot(axis)).negate();
  const r = toShaft.length();
  toShaft.normalize();
  grip.push([side, palm.dot(toShaft), knuck.dot(toShaft), r, palm.clone(), knuck.clone()]);
}
console.log(`\n  ${FP ? 'FIRST' : 'THIRD'} PERSON, hands=${process.env.PALM_HANDS || 'one'}`);
console.log('   palm·(wrist→shaft)   knuckles·(wrist→shaft)   wrist off the axis');
for (const [side, pd, kd, r] of grip) {
  console.log(`   ${side}   ${pd.toFixed(2).padStart(6)}              ${kd.toFixed(2).padStart(6)}            ${(r * 1000).toFixed(0)} mm`);
}
if (grip.length === 2) {
  console.log(`   the two palms agree to ${grip[0][4].dot(grip[1][4]).toFixed(2)}, `
    + `the two knuckle axes to ${grip[0][5].dot(grip[1][5]).toFixed(2)}`);
}
for (const r of rows) console.log('   ' + r.join('\n     '));
console.log();
world.unload();
