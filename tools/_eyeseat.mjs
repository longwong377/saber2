/* scratch — how far each authored eye stands proud of its own skull shell */
import './dom-shim.mjs';
import * as THREE from 'three';
const B = await import('../src/game/Bodies.js');

const SEATS = {
  charger: [[0.18, 0.10, 0.20, 0.046]],
  massiff: [[0.11, 0.10, 0.26, 0.042], [0.16, 0.03, 0.16, 0.030]],
  pup:     [[0.16, 0.14, 0.30, 0.040]],
  taun:    [[0.175, 0.11, 0.10, 0.044]],
  tooka:   [[0.148, 0.005, 0.255, 0.105]],
  varac:   [[0.13, 0.08, 0.24, 0.038]],
  acklay:  [[0.14, 0.12, 0.22, 0.048]],
};
const EXTRA = JSON.parse(process.env.EXTRA || '{}');
Object.assign(SEATS, EXTRA);

for (const kind of Object.keys(SEATS)) {
  let skull = null;
  B.setAssemblyProbe((tag, parts) => { if (tag === 'skull' && !skull) skull = parts; });
  B.buildQuadruped({ kind, scale: 1 });
  B.setAssemblyProbe(null);
  const tris = [];
  for (const p of skull) {
    const g = p.geo.clone().applyMatrix4(p.matrix);
    const pos = g.attributes.position, idx = g.index;
    const n = idx ? idx.count : pos.count;
    const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
    for (let i = 0; i < n; i += 3) {
      const i0 = idx ? idx.getX(i) : i, i1 = idx ? idx.getX(i + 1) : i + 1, i2 = idx ? idx.getX(i + 2) : i + 2;
      a.fromBufferAttribute(pos, i0); b.fromBufferAttribute(pos, i1); c.fromBufferAttribute(pos, i2);
      tris.push([a.clone(), b.clone(), c.clone()]);
    }
  }
  const P = B.CREATURE_PLANS[kind];
  const [segs, nLen, , nPitch, nCurl] = P.neck;
  let HY = 0, HZ = 0, pitch = nPitch;
  for (let i = 0; i < segs; i++) { HY += Math.sin(pitch) * nLen; HZ += Math.cos(pitch) * nLen; pitch += nCurl; }
  const O = new THREE.Vector3(0, HY, HZ);
  const ray = new THREE.Ray(), hit = new THREE.Vector3();
  for (const [x, y, z, r] of SEATS[kind]) {
    const v = new THREE.Vector3(x, y, z);
    const d = v.length();
    ray.origin.copy(O); ray.direction.copy(v).normalize();
    let far = 0;
    for (const [p, q, s] of tris) if (ray.intersectTriangle(p, q, s, false, hit)) far = Math.max(far, hit.distanceTo(O));
    const proud = d + r - far;
    console.log(`${(kind + ' ' + P.head).padEnd(20)} (${x}, ${y}, ${z}) r=${r}  |v|=${d.toFixed(3)}  shell=${far.toFixed(3)}  proud=${proud.toFixed(4)} = ${(proud / r).toFixed(2)}r`);
  }
}
