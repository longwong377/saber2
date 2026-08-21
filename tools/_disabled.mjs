/**
 * DOES SWITCHING A STATIC BOX OFF SWITCH IT OFF?
 *
 * `disabled` is read by six hand-rolled queries and was written into the record
 * as a plain field, while `addStaticBox` left a live Rapier cuboid in the
 * solver. This drops a dynamic body onto a box, switches the box off, and drops
 * another one: if the flag means anything, the second falls through.
 */
import './dom-shim.mjs';
import * as THREE from 'three';
import { initPhysics } from '../src/physics/Rapier.js';
import { RapierWorld, Body } from '../src/physics/RapierWorld.js';
import { boxSpheres, LAYER } from '../src/physics/Physics.js';

await initPhysics();
const drop = (off) => {
  const w = new RapierWorld({ gravity: -22, iterations: 4, maxBodies: 64 });
  const box = w.addStaticBox(new THREE.Vector3(0, 1, 0), new THREE.Vector3(3, 0.5, 3));
  if (off) box.disabled = true;
  const b = new Body({
    position: new THREE.Vector3(0, 4, 0),
    shape: { type: 'box', hx: 0.4, hy: 0.4, hz: 0.4 },
    spheres: boxSpheres(0.4, 0.4, 0.4), mass: 20,
    layer: LAYER.DEBRIS, mask: LAYER.ALL,
  });
  w.add(b);
  for (let i = 0; i < 120; i++) w.step(1 / 60);
  const y = b.position.y;
  w.dispose();
  return y;
};
const on = drop(false), off = drop(true);
console.log(`box ON:  the crate rests at y=${on.toFixed(2)}`);
console.log(`box OFF: the crate rests at y=${off.toFixed(2)}`);
console.log(off < on - 0.9 ? 'the flag is real' : 'THE FLAG IS A LIE — the collider is still there');
