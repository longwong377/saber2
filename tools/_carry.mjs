/**
 * WHERE THE THIRD-PERSON BODY CARRIES ITS SWORD AT REST AND ON THE MOVE — as
 * heights off the ground, against the body's own landmarks.
 *
 * The player, of the walk: the arms and shoulders read janky. The walk sheet
 * (tools/motion.mjs --clip walk) shows the fists carried at face height. This
 * prints the numbers the sheet implies: hand, hilt, chest, chin and shoulder
 * heights, idle and walking, so a carry change is a measured delta rather than
 * a redraw-and-squint.
 *
 *   node --import ./tools/register.mjs tools/_carry.mjs
 */
import './dom-shim.mjs';
import { bootWorld, idleInput } from './checks/_coop.mjs';
import * as THREE from 'three';

const { world } = await bootWorld({
  level: 'geonosis',
  settings: { mode: 'sandbox', difficulty: 'knight', firstPerson: false },
});
const p = world.player;
p.camera.firstPerson = false;
p._applyViewMode?.();
p.saber.lit = true;

const V = () => new THREE.Vector3();
const at = (name) => {
  const b = p.rig.get(name);
  return b ? V().setFromMatrixPosition(b.obj.matrixWorld) : null;
};
const ground = () => world.terrain?.height?.(p.position.x, p.position.z) ?? 0;

function report(tag) {
  p.rig.updateMatrices(); p.rig.root.updateMatrixWorld(true);
  const g = ground();
  const rows = {};
  for (const n of ['head', 'chest', 'clavR', 'armR', 'foreR', 'handR', 'handL']) {
    const w = at(n);
    if (w) rows[n] = +(w.y - g).toFixed(3);
  }
  rows.hilt = +(p.control.handPos.y - g).toFixed(3);
  const tip = V().set(0, 1, 0).applyQuaternion(p.control.quat)
    .multiplyScalar(1.0).add(p.control.handPos);
  rows.tipY = +(tip.y - g).toFixed(3);
  const fwd = V().set(0, 1, 0).applyQuaternion(p.control.quat);
  rows.bladeUpDeg = +(Math.asin(fwd.y) * 180 / Math.PI).toFixed(1);
  console.log(tag, JSON.stringify(rows));
}

const input = idleInput();
for (let i = 0; i < 150; i++) world.update(1 / 60, input);
report('idle   ');

const walk = idleInput();
walk.moveAxis = (o) => { if (o) { o.x = 0; o.y = 1; return o; } return { x: 0, y: 1 }; };
for (let i = 0; i < 150; i++) world.update(1 / 60, walk);
report('walking');
process.exit(0);
