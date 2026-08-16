/**
 * WHAT THE BIG CREATURES LOOK LIKE AT FORTY METRES — as numbers.
 *
 *   node --import ./tools/register.mjs tools/_creature.mjs
 *
 * The complaint this was written for is "all your monsters look the same,
 * sphere with some legs", and the thing that makes that answerable rather than
 * a matter of taste is the reference the player supplied:
 * `assets/reference/maps/colosseum/more arena 1.jpg` has three creatures in one
 * frame at roughly forty metres, and at that range NONE of the detail survives.
 * What tells them apart is the SILHOUETTE — a low wide block, a tall splayed
 * tripod, a small squat one — so that is what this measures.
 *
 * Per creature it prints, off the real built rig posed by the real gait solver:
 *
 *   tris/meshes    against the 13 000 / 76 the characters check caps a body at
 *   L×W×H          the bounding box in metres, at the scale the archetype uses
 *   L/H            long-and-low against tall-and-heavy, the first read
 *   fill           silhouette pixels over the area of its own bounding box —
 *                  a solid animal fills 0.6+, a thing made of legs fills 0.2
 *   mass@          height of the silhouette's centroid over its own height:
 *                  where the weight is. A reek is 0.42, an acklay 0.62.
 *   IoU            worst overlap with any OTHER creature, rasterised into one
 *                  world frame at the same metres per pixel. This is the whole
 *                  number: two animals that share a body plan land above 0.5.
 *
 * The frame is deliberately shared and absolute (12 m wide, 12 m tall, feet on
 * the bottom edge) rather than per-creature-normalised, for the reason
 * tools/checks/characters.mjs gives for its own: normalising each figure to its
 * own box would call a 2 m nexu and a 7 m rancor identical for being the same
 * shape, and they are not the same shape BECAUSE they are not the same size.
 */
// The DOM shim FIRST — hideMat reaches Textures.js, which bakes onto a canvas.
import './dom-shim.mjs';
import * as THREE from 'three';
import { buildQuadruped, buildBeast, CREATURE_PLANS } from '../src/game/Bodies.js';
import { ARCHETYPES } from '../src/game/Enemy.js';
import '../src/game/Levels.js';          // registers the colosseum's creatures

/** Every archetype that runs the beast brain, found rather than listed. */
const BEASTS = Object.keys(ARCHETYPES).filter((k) => ARCHETYPES[k].custom === 'beast');

const W = 128, H = 128, SPAN = 12;

/** Front silhouette (looking down -Z) into a fixed world frame, feet on the floor. */
function silhouette(root) {
  const bits = new Uint8Array(W * H);
  const u0 = -SPAN / 2, v0 = 0, v1 = SPAN;
  const sx = (W - 1) / SPAN, sy = (H - 1) / (v1 - v0);
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  root.traverse((o) => {
    if (!o.isMesh || !o.geometry?.attributes?.position) return;
    const g = o.geometry, p = g.attributes.position, idx = g.index;
    const n = idx ? idx.count : p.count;
    for (let i = 0; i < n; i += 3) {
      const i0 = idx ? idx.getX(i) : i, i1 = idx ? idx.getX(i + 1) : i + 1, i2 = idx ? idx.getX(i + 2) : i + 2;
      a.fromBufferAttribute(p, i0).applyMatrix4(o.matrixWorld);
      b.fromBufferAttribute(p, i1).applyMatrix4(o.matrixWorld);
      c.fromBufferAttribute(p, i2).applyMatrix4(o.matrixWorld);
      const P = [a, b, c].map((q) => [(q.x - u0) * sx, (v1 - q.y) * sy]);
      const x0 = Math.max(0, Math.floor(Math.min(P[0][0], P[1][0], P[2][0])));
      const x1 = Math.min(W - 1, Math.ceil(Math.max(P[0][0], P[1][0], P[2][0])));
      const y0 = Math.max(0, Math.floor(Math.min(P[0][1], P[1][1], P[2][1])));
      const y1 = Math.min(H - 1, Math.ceil(Math.max(P[0][1], P[1][1], P[2][1])));
      const d0 = (P[1][0] - P[0][0]) * (P[2][1] - P[0][1]) - (P[2][0] - P[0][0]) * (P[1][1] - P[0][1]);
      if (Math.abs(d0) < 1e-12) continue;
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
        const px = x + 0.5, py = y + 0.5;
        const w0 = ((P[1][0] - px) * (P[2][1] - py) - (P[2][0] - px) * (P[1][1] - py)) / d0;
        const w1 = ((P[2][0] - px) * (P[0][1] - py) - (P[0][0] - px) * (P[2][1] - py)) / d0;
        if (w0 >= -1e-6 && w1 >= -1e-6 && 1 - w0 - w1 >= -1e-6) bits[y * W + x] = 1;
      }
    }
  });
  return bits;
}

function iou(a, b) {
  let inter = 0, uni = 0;
  for (let i = 0; i < a.length; i++) { if (a[i] || b[i]) uni++; if (a[i] && b[i]) inter++; }
  return uni ? inter / uni : 0;
}

const rows = [];
const sils = {};
for (const type of BEASTS) {
  const A = ARCHETYPES[type];
  const built = A.build({ scale: A.scale });
  const root = built.rig.root;
  root.updateMatrixWorld(true);

  // Stand it on the floor the way _poseWalker does: hips at the plan's own hip
  // height. The stance the builder publishes IS the pose, so this is the shipped
  // number rather than a second copy of it.
  const st = built.stance;
  if (st) built.rig.hipsBone.obj.position.y = st.hipHeight;
  built.rig.updateMatrices();
  root.updateMatrixWorld(true);

  let tris = 0, meshes = 0;
  const box = new THREE.Box3();
  root.traverse((o) => {
    if (!o.isMesh || !o.geometry) return;
    meshes++; box.expandByObject(o);
    const g = o.geometry;
    tris += g.index ? g.index.count / 3 : g.attributes.position.count / 3;
  });
  // drop it onto the floor so every silhouette shares one ground line
  root.position.y -= box.min.y;
  root.updateMatrixWorld(true);
  const bits = silhouette(root);
  sils[type] = bits;

  const s = box.getSize(new THREE.Vector3());
  let px = 0, sumY = 0, minY = H, maxY = 0;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (!bits[y * W + x]) continue;
    px++; sumY += (H - 1 - y); minY = Math.min(minY, y); maxY = Math.max(maxY, y);
  }
  const hPx = (maxY - minY + 1), wPx = s.x * ((W - 1) / SPAN);
  rows.push({
    type, label: A.label, tris: Math.round(tris), meshes,
    L: s.z, Wd: s.x, Ht: s.y, lh: s.z / s.y,
    fill: px / Math.max(1, hPx * wPx),
    mass: (sumY / Math.max(1, px)) / Math.max(1, H - 1 - minY),
  });
}

let worst = 0, worstPair = '';
for (const a of BEASTS) for (const b of BEASTS) {
  if (a >= b) continue;
  const v = iou(sils[a], sils[b]);
  if (v > worst) { worst = v; worstPair = `${a}/${b}`; }
}

console.log('creature      tris  mesh     L     W     H   L/H  fill  mass@   worst IoU');
for (const r of rows) {
  let mx = 0, mxWith = '';
  for (const o of BEASTS) if (o !== r.type) { const v = iou(sils[r.type], sils[o]); if (v > mx) { mx = v; mxWith = o; } }
  console.log(
    `${r.label.padEnd(9)} ${String(r.tris).padStart(6)} ${String(r.meshes).padStart(4)}  `
    + `${r.L.toFixed(2).padStart(5)} ${r.Wd.toFixed(2).padStart(5)} ${r.Ht.toFixed(2).padStart(5)}  `
    + `${r.lh.toFixed(2)}  ${r.fill.toFixed(2)}  ${r.mass.toFixed(2)}   ${mx.toFixed(2)} (${mxWith})`);
}
console.log(`\nworst pair overall: ${worstPair} ${worst.toFixed(3)}`);
console.log(`body plans: ${Object.keys(CREATURE_PLANS).join(', ')}`);
void buildQuadruped; void buildBeast;
