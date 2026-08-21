/**
 * DOES A TRACED CIRCLE CUT A SLUG OUT OF A BLAST DOOR?
 *
 * The kerf brush is `res * 0.030` — 3.8 texels of a 128 map, so 3% of the
 * plate's width per pass. This walks a circle of a given radius (as a fraction
 * of the plate) directly through `burn`, and reports the melted kerf, the
 * enclosed slug the flood finds, and what that is in square metres.
 */
import './dom-shim.mjs';
import * as THREE from 'three';
import { BlastDoor } from '../src/world/Props.js';

/* Only what BlastDoor reaches for. `breach()` drops a slug through
 * `spawnDebris` and credits the side, and neither is what this probe measures. */
const world = { scene: new THREE.Scene(), physics: { addStaticBox: () => ({}), removeStaticBox() {} },
  particles: null, support: null, spawnDebris() {}, notify() {} };
for (const frac of [0.10, 0.15, 0.20, 0.28, 0.35]) {
  const d = new BlastDoor(world, { position: new THREE.Vector3(0, 2, 0), width: 3.3, height: 3.4 });
  d.mesh.updateMatrixWorld(true);
  const R = frac;                      // radius as a fraction of the plate
  let passes = 0;
  for (let lap = 0; lap < 40 && !d.opened; lap++) {
    for (let a = 0; a < 200 && !d.opened; a++) {
      const th = (a / 200) * Math.PI * 2;
      const p = new THREE.Vector3(Math.cos(th) * R * d.width, 2 + Math.sin(th) * R * d.height, 0);
      d.burn(p, 1, 1 / 60);
      passes++;
    }
  }
  const cells = d._slug();
  const cellArea = (d.width * d.height) / (d.res * d.res);
  console.log(`r=${(frac * 100).toFixed(0)}% of the plate: kerf ${d.cutArea} texels, slug ${cells} cells `
    + `= ${(cells * cellArea).toFixed(3)} m², opened=${d.opened} after ${passes} burns`);
}
