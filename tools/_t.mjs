import './dom-shim.mjs';
import * as THREE from 'three';
const B = await import('../src/game/Bodies.js');
const built = B.buildMedic({ scale: 1 });
const root = built.rig.root; root.updateMatrixWorld(true);
const all = [];
root.traverse((o) => {
  if (!o.isMesh || !o.geometry?.attributes?.position) return;
  const lit = !!(o.material?.emissive && o.material.emissiveIntensity > 1 && o.material.emissive.getHex() !== 0);
  const pos = o.geometry.attributes.position, idx = o.geometry.index;
  const n = idx ? idx.count : pos.count;
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  for (let i = 0; i < n; i += 3) {
    const i0 = idx ? idx.getX(i) : i, i1 = idx ? idx.getX(i + 1) : i + 1, i2 = idx ? idx.getX(i + 2) : i + 2;
    a.fromBufferAttribute(pos, i0).applyMatrix4(o.matrixWorld);
    b.fromBufferAttribute(pos, i1).applyMatrix4(o.matrixWorld);
    c.fromBufferAttribute(pos, i2).applyMatrix4(o.matrixWorld);
    all.push([a.clone(), b.clone(), c.clone(), lit, o.parent?.name]);
  }
});
const lit = all.filter((t) => t[3]), body = all.filter((t) => !t[3]);
const key = (v) => `${Math.round(v.x * 1e5)},${Math.round(v.y * 1e5)},${Math.round(v.z * 1e5)}`;
const parent = lit.map((_, i) => i);
const find = (i) => { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; } return i; };
const seen = new Map();
lit.forEach((t, i) => { for (const v of [t[0], t[1], t[2]]) { const k = key(v); if (seen.has(k)) { const a = find(seen.get(k)), b = find(i); if (a !== b) parent[a] = b; } else seen.set(k, i); } });
const g = new Map(); lit.forEach((t, i) => { const r = find(i); if (!g.has(r)) g.set(r, []); g.get(r).push(t); });
const ray = new THREE.Ray(), tri = new THREE.Triangle(), hit = new THREE.Vector3(), n0 = new THREE.Vector3(), mid = new THREE.Vector3();
for (const cl of g.values()) {
  let clear = 0;
  for (const [a, b, c] of cl) {
    tri.set(a, b, c); tri.getNormal(n0);
    mid.copy(a).add(b).add(c).multiplyScalar(1 / 3);
    ray.origin.copy(mid).addScaledVector(n0, 1e-4); ray.direction.copy(n0);
    let blocked = false;
    for (const [p, q, r] of body) if (ray.intersectTriangle(p, q, r, false, hit)) { blocked = true; break; }
    if (!blocked) clear++;
  }
  const box = new THREE.Box3(); for (const t of cl) { box.expandByPoint(t[0]); box.expandByPoint(t[1]); box.expandByPoint(t[2]); }
  const ctr = box.getCenter(new THREE.Vector3());
  console.log(`${clear}/${cl.length} on ${cl[0][4]} at ${ctr.x.toFixed(3)} ${ctr.y.toFixed(3)} ${ctr.z.toFixed(3)}`);
}
