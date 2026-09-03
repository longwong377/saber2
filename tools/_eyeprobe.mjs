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

function cluster(list) {
  // union-find over shared (quantised) vertex positions
  const key = (v) => `${Math.round(v.x * 1e5)},${Math.round(v.y * 1e5)},${Math.round(v.z * 1e5)}`;
  const parent = list.map((_, i) => i);
  const find = (i) => { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; } return i; };
  const seen = new Map();
  list.forEach((t, i) => {
    for (const v of [t[0], t[1], t[2]]) {
      const kk = key(v);
      if (seen.has(kk)) { const a = find(seen.get(kk)), b = find(i); if (a !== b) parent[a] = b; }
      else seen.set(kk, i);
    }
  });
  const g = new Map();
  list.forEach((t, i) => { const r = find(i); if (!g.has(r)) g.set(r, []); g.get(r).push(t); });
  return [...g.values()];
}

function probe(root) {
  const eyes = tris(root, isEye);
  const body = tris(root, (o) => !isEye(o));
  const ray = new THREE.Ray();
  const tri = new THREE.Triangle();
  const hit = new THREE.Vector3();
  const n = new THREE.Vector3(), n0 = new THREE.Vector3(), mid = new THREE.Vector3();
  let clear = 0;
  const per = [];
  for (const cl of cluster(eyes)) {
    let n = 0;
    for (const [a, b, c] of cl) {
      tri.set(a, b, c); tri.getNormal(n0);
      mid.copy(a).add(b).add(c).multiplyScalar(1 / 3);
      ray.origin.copy(mid).addScaledVector(n0, 1e-4); ray.direction.copy(n0);
      let blocked = false;
      for (const [p, q, r] of body) if (ray.intersectTriangle(p, q, r, false, hit)) { blocked = true; break; }
      if (!blocked) n++;
    }
    per.push(`${n}/${cl.length}`);
  }
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
  return { clear, total: eyes.length, per };
}

const ONLY = process.argv[2] ? process.argv[2].split(',') : null;
const rows = [];
for (const id of Object.keys(COMPANION_KINDS)) {
  if (ONLY && !ONLY.includes(id)) continue;
  const K = COMPANION_KINDS[id];
  const A = ARCHETYPES[K.archetype];
  const built = A.build({ scale: A.scale ?? 1 });
  const root = built.rig ? built.rig.root : built.group;
  const r = probe(root);
  rows.push(`${id.padEnd(9)} ${String(r.clear).padStart(4)}/${String(r.total).padEnd(5)} [${r.per.join(' ')}]`);
}
console.log(rows.join('\n'));
console.log('--- creature plans ---');
for (const kind of Object.keys(B.CREATURE_PLANS)) {
  if (ONLY && !ONLY.includes(kind)) continue;
  const built = B.buildQuadruped({ kind, scale: 1 });
  const r = probe(built.rig.root);
  console.log(`${kind.padEnd(9)} ${String(r.clear).padStart(4)}/${String(r.total).padEnd(5)} [${r.per.join(' ')}]`);
}
