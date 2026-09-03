/* scratch — occlusion probe */
import './dom-shim.mjs';
import * as THREE from 'three';
const B = await import('../src/game/Bodies.js');
const { COMPANION_KINDS } = await import('../src/game/CompanionKinds.js');
const { ARCHETYPES } = await import('../src/game/Enemy.js');
await import('../src/game/Levels.js');

function tris(root, pick) {
  root.updateMatrixWorld(true);
  const out = [];
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  root.traverse((o) => {
    if (!o.isMesh || !o.geometry?.attributes?.position) return;
    if (!pick(o)) return;
    const pos = o.geometry.attributes.position, idx = o.geometry.index;
    const n = idx ? idx.count : pos.count;
    for (let i = 0; i < n; i += 3) {
      const i0 = idx ? idx.getX(i) : i, i1 = idx ? idx.getX(i + 1) : i + 1, i2 = idx ? idx.getX(i + 2) : i + 2;
      a.fromBufferAttribute(pos, i0).applyMatrix4(o.matrixWorld);
      b.fromBufferAttribute(pos, i1).applyMatrix4(o.matrixWorld);
      c.fromBufferAttribute(pos, i2).applyMatrix4(o.matrixWorld);
      out.push([a.clone(), b.clone(), c.clone(), o]);
    }
  });
  return out;
}

const isEye = (o) => !!(o.material?.emissive && o.material.emissiveIntensity > 1
  && o.material.emissive.getHex() !== 0);

function probe(root) {
  const eyes = tris(root, isEye);
  const body = tris(root, (o) => !isEye(o));
  const ray = new THREE.Ray();
  const tri = new THREE.Triangle();
  const hit = new THREE.Vector3();
  const n = new THREE.Vector3(), mid = new THREE.Vector3();
  let clear = 0;
  for (const [a, b, c] of eyes) {
    tri.set(a, b, c);
    tri.getNormal(n);
    mid.copy(a).add(b).add(c).multiplyScalar(1 / 3);
    ray.origin.copy(mid).addScaledVector(n, 1e-4);
    ray.direction.copy(n);
    let blocked = false;
    for (const [p, q, r] of body) {
      if (ray.intersectTriangle(p, q, r, false, hit)) { blocked = true; break; }
    }
    if (!blocked) clear++;
  }
  return { clear, total: eyes.length, meshes: eyes.length ? 1 : 0 };
}

const rows = [];
for (const id of Object.keys(COMPANION_KINDS)) {
  const K = COMPANION_KINDS[id];
  const A = ARCHETYPES[K.archetype];
  const built = A.build({ scale: A.scale ?? 1 });
  const root = built.rig ? built.rig.root : built.group;
  const r = probe(root);
  rows.push(`${id.padEnd(9)} ${String(r.clear).padStart(4)}/${String(r.total).padEnd(5)}`);
}
console.log(rows.join('\n'));
console.log('--- creature plans ---');
for (const kind of Object.keys(B.CREATURE_PLANS)) {
  const built = B.buildQuadruped({ kind, scale: 1 });
  const r = probe(built.rig.root);
  console.log(`${kind.padEnd(9)} ${String(r.clear).padStart(4)}/${String(r.total).padEnd(5)}`);
}
