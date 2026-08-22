/**
 * THE TUNNEL A CLOSED FIST MAKES — measured off `buildHand`'s own construction,
 * not guessed.
 *
 * `GRIP_BORE` in Player.js is the CENTRE of that tunnel, and its note records
 * how it was found: replay the finger construction, recover the phalanx joints
 * the bake throws away, and look for the largest circle that fits between the
 * palm face and the returning fingers. It found one hole, under the middle
 * finger, and stopped there — so the hilt's AXIS was then assumed to be the
 * hand's own X, the mediolateral line.
 *
 * A hand is not built that way and this one is not either. The four fingers sit
 * at different heights up the palm (`hy` 0.95 / 1.00 / 0.96 / 0.87 in
 * FINGER_TABLE) and are different lengths (`lf` 0.93 / 1.00 / 0.93 / 0.76), so
 * the hole each one closes is in a different place, and the line through the
 * four of them is OBLIQUE. That line is what a cylinder held in this fist
 * actually lies along.
 *
 * This finds one bore per finger by search rather than by construction — the
 * same method the GRIP_BORE note used for its cross-check — and fits the axis.
 *
 *   node --import ./tools/register.mjs tools/_bore.mjs
 */
import './dom-shim.mjs';
import * as THREE from 'three';

const D = 180 / Math.PI;

/* buildHand's own numbers, for a 1.78 m figure at S = 1. Read from
 * src/game/Bodies.js; the check below asserts they still match. */
const palmW = 0.086, palmL = 0.074, palmT = 0.030;
const fingerL = 0.077, fingerR = 0.0097;
const wristY = palmT * 0.42;
const TABLE = [
  ['index', 0.310, 0.95, 0.93, 0.98, 0.14],
  ['middle', 0.105, 1.00, 1.00, 1.00, 0.04],
  ['ring', -0.105, 0.96, 0.93, 0.95, -0.06],
  ['little', -0.305, 0.87, 0.76, 0.85, -0.17],
];
const CURL = 1, SPLAY = 1;
const SIDE = 'L';                       // tw = +1; the mirror is exact
const tw = SIDE === 'L' ? 1 : -1;

/** The four joint centres and three segment radii of one finger, in hand space. */
function finger([, ox, hy, lf, rf]) {
  const root = new THREE.Object3D();
  root.position.set(tw * ox * palmW, wristY + palmL * hy, palmT * 0.16);
  root.rotation.z = -tw * TABLE.find((t) => t[1] === ox)[5] * SPLAY;
  root.rotation.x = 1.24 * CURL;
  const L = fingerL * lf, R = fingerR * rf;
  const l1 = L * 0.42, l2 = L * 0.33, l3 = L * 0.25;
  const mid = new THREE.Object3D();
  mid.position.y = l1 * 0.93; mid.rotation.x = 1.02 * CURL; root.add(mid);
  const dis = new THREE.Object3D();
  dis.position.y = l2 * 0.93; dis.rotation.x = 0.60 * CURL; mid.add(dis);
  root.updateMatrixWorld(true);
  const p = (o, y) => new THREE.Vector3(0, y, 0).applyMatrix4(o.matrixWorld);
  return {
    segs: [
      [p(root, 0), p(root, l1), R],
      [p(mid, 0), p(mid, l2), R * 0.95],
      [p(dis, 0), p(dis, l3), R * 0.87],
    ],
    x: root.position.x,
    thick: R,
  };
}

const distToSeg = (q, a, b) => {
  const ab = new THREE.Vector3().subVectors(b, a);
  const t = Math.max(0, Math.min(1, new THREE.Vector3().subVectors(q, a).dot(ab) / Math.max(ab.lengthSq(), 1e-12)));
  return new THREE.Vector3().copy(a).addScaledVector(ab, t).distanceTo(q);
};

/**
 * THE CENTRE OF THE ARC THE FINGER CLOSES ON, which is what GRIP_BORE's own
 * note fitted for the middle finger: the four phalanx joints lie on a circle
 * and its centre is the middle of the hole. Fitted in the finger's own YZ
 * plane, by least squares on the circle equation, and the radius reported with
 * the finger's own thickness taken off — the note's "taking off the 9.7 mm the
 * finger itself is thick leaves a bore of about 15 mm".
 */
function bore(f) {
  const pts = [f.segs[0][0], f.segs[1][0], f.segs[2][0], f.segs[2][1]];
  /* circle through (y, z): solve  y² + z² + A y + B z + C = 0  */
  let n = 0, sy = 0, sz = 0, syy = 0, szz = 0, syz = 0, sr = 0, sry = 0, srz = 0;
  for (const p of pts) {
    const y = p.y, z = p.z, r = y * y + z * z;
    n++; sy += y; sz += z; syy += y * y; szz += z * z; syz += y * z;
    sr += r; sry += r * y; srz += r * z;
  }
  // normal equations for [A, B, C]
  const M = [[syy, syz, sy], [syz, szz, sz], [sy, sz, n]];
  const V = [-sry, -srz, -sr];
  // 3x3 solve, Cramer
  const det = (m) => m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1])
    - m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0])
    + m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]);
  const sub = (i) => M.map((row, r) => row.map((v, c) => (c === i ? V[r] : v)));
  const d0 = det(M);
  const A = det(sub(0)) / d0, B = det(sub(1)) / d0, C = det(sub(2)) / d0;
  const y0 = -A / 2, z0 = -B / 2;
  const rad = Math.sqrt(Math.max(0, y0 * y0 + z0 * z0 - C));
  return { y: y0, z: z0, clear: rad - f.thick, joints: pts };
}

const pts = [];
for (const row of TABLE) {
  const f = finger(row);
  const b = bore(f);
  pts.push(new THREE.Vector3(f.x, b.y, b.z));
  console.log(`  ${row[0].padEnd(7)} x ${(f.x * 1000).toFixed(1).padStart(6)} mm   joints `
    + b.joints.map((p) => `(${(p.y * 1000).toFixed(0)},${(p.z * 1000).toFixed(0)})`).join(' ')
    + `   arc about (${(b.y * 1000).toFixed(1)}, ${(b.z * 1000).toFixed(1)}) mm, bore r ${(b.clear * 1000).toFixed(1)} mm`);
}

/* the line through the four bores, by least squares on x */
const n = pts.length;
const mx = pts.reduce((s, p) => s + p.x, 0) / n;
const my = pts.reduce((s, p) => s + p.y, 0) / n;
const mz = pts.reduce((s, p) => s + p.z, 0) / n;
let sxx = 0, sxy = 0, sxz = 0;
for (const p of pts) { sxx += (p.x - mx) ** 2; sxy += (p.x - mx) * (p.y - my); sxz += (p.x - mx) * (p.z - mz); }
const dy = sxy / sxx, dz = sxz / sxx;
const axis = new THREE.Vector3(1, dy, dz).normalize();
console.log(`\n  centre of the four bores   (${(mx * 1000).toFixed(1)}, ${(my * 1000).toFixed(1)}, ${(mz * 1000).toFixed(1)}) mm`);
console.log(`  axis through them          (${axis.x.toFixed(4)}, ${axis.y.toFixed(4)}, ${axis.z.toFixed(4)})`);
console.log(`  tilt off the hand's X, toward the knuckles   ${(Math.atan2(dy, 1) * D).toFixed(1)}°`);
console.log(`  tilt off the hand's X, out of the palm       ${(Math.atan2(dz, 1) * D).toFixed(1)}°`);
console.log(`\n  GRIP_BORE ships as (0, 0.065, 0.030); the centre above is the`);
console.log('  same measurement taken over four fingers instead of one.');
