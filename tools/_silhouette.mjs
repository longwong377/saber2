/**
 * A BODY, AS TWO ASCII SILHOUETTES, SO A PERSON CAN LOOK AT IT.
 *
 *   node --import ./tools/register.mjs tools/_silhouette.mjs geonosian
 *
 * `tools/_roster.mjs` says how ALIKE two bodies are and `characters.mjs` holds
 * them apart; neither tells you whether the thing you just built has its head
 * on. There is no GPU here (HANDOFF §2.6) and a rendered frame costs four
 * seconds, so this rasterises the transformed vertices of the bind pose into a
 * 42x34 grid from the flank and from the front. It is enough to catch a wing
 * inside a torso, a head at the ankles, or an arm that never got built.
 */
import './dom-shim.mjs';
import * as THREE from 'three';
const B = await import('../src/game/Bodies.js');
const type = process.argv[2] || 'geonosian';
const makers = { geonosian: () => B.buildGeonosian({ scale: 0.928 }), trooper: () => B.buildTrooper({ scale: 1 }),
  b1: () => B.buildB1({ scale: 1.02 }) };
const built = makers[type]();
built.rig.root.updateMatrixWorld(true);
const pts = [];
const v = new THREE.Vector3();
built.rig.root.traverse((o) => {
  if (!o.isMesh || !o.geometry?.attributes?.position) return;
  const pos = o.geometry.attributes.position;
  const idx = o.geometry.index;
  const tri = (a, b, c) => {
    // barycentric fill at low res
    for (let i = 0; i <= 4; i++) for (let j = 0; j + i <= 4; j++) {
      const u = i / 4, w = j / 4, t = 1 - u - w;
      pts.push([a.x * t + b.x * u + c.x * w, a.y * t + b.y * u + c.y * w, a.z * t + b.z * u + c.z * w]);
    }
  };
  const A = new THREE.Vector3(), C = new THREE.Vector3(), D = new THREE.Vector3();
  const n = idx ? idx.count : pos.count;
  for (let i = 0; i < n; i += 3) {
    const ia = idx ? idx.getX(i) : i, ib = idx ? idx.getX(i + 1) : i + 1, ic = idx ? idx.getX(i + 2) : i + 2;
    A.fromBufferAttribute(pos, ia).applyMatrix4(o.matrixWorld);
    C.fromBufferAttribute(pos, ib).applyMatrix4(o.matrixWorld);
    D.fromBufferAttribute(pos, ic).applyMatrix4(o.matrixWorld);
    tri(A, C, D);
  }
});
const ys = pts.map(p => p[1]);
const y0 = Math.min(...ys), y1 = Math.max(...ys);
const H = 34, W = 42;
function draw(getX, label) {
  const xs = pts.map(getX);
  const x0 = Math.min(...xs), x1 = Math.max(...xs);
  const span = Math.max(x1 - x0, 0.001);
  const grid = Array.from({ length: H }, () => new Array(W).fill(' '));
  for (let i = 0; i < pts.length; i++) {
    const col = Math.round((xs[i] - x0) / span * (W - 1));
    const row = Math.round((1 - (pts[i][1] - y0) / (y1 - y0)) * (H - 1));
    if (col >= 0 && col < W && row >= 0 && row < H) grid[row][col] = '#';
  }
  console.log(`\n${label}  (${(x1 - x0).toFixed(2)} m wide x ${(y1 - y0).toFixed(2)} m tall)`);
  for (const r of grid) console.log('  ' + r.join(''));
}
draw((p) => p[2], `${type} — FLANK (looking along X)`);
draw((p) => p[0], `${type} — FRONT (looking along Z)`);
