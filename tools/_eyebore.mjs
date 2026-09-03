/* scratch — which part buries the eye */
import './dom-shim.mjs';
import * as THREE from 'three';
const B = await import('../src/game/Bodies.js');

const kind = process.argv[2] || 'pup';
const rec = [];
B.setAssemblyProbe((tag, parts, parent) => {
  if (!/skull|kit:head/.test(tag)) return;
  rec.push({ tag, parts: parts.map((p, i) => ({ i, geo: p.geo, m: p.matrix })) });
});
B.buildQuadruped({ kind, scale: 1 });
B.setAssemblyProbe(null);

const groups = [];
for (const r of rec) {
  r.parts.forEach((p) => {
    const g = p.geo.clone().applyMatrix4(p.m);
    const pos = g.attributes.position, idx = g.index;
    const n = idx ? idx.count : pos.count;
    const t = [];
    const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
    for (let i = 0; i < n; i += 3) {
      const i0 = idx ? idx.getX(i) : i, i1 = idx ? idx.getX(i + 1) : i + 1, i2 = idx ? idx.getX(i + 2) : i + 2;
      a.fromBufferAttribute(pos, i0); b.fromBufferAttribute(pos, i1); c.fromBufferAttribute(pos, i2);
      t.push([a.clone(), b.clone(), c.clone()]);
    }
    const box = new THREE.Box3().setFromBufferAttribute(g.attributes.position);
    groups.push({ tag: r.tag, i: p.i, tris: t, box, n: t.length });
  });
}
console.log(kind, 'groups', groups.length);
groups.forEach((g, i) => console.log(i, g.tag, g.n,
  'x', g.box.min.x.toFixed(3), g.box.max.x.toFixed(3),
  'y', g.box.min.y.toFixed(3), g.box.max.y.toFixed(3),
  'z', g.box.min.z.toFixed(3), g.box.max.z.toFixed(3)));

// occlusion attribution: eye groups are the ones named on argv[3..] or auto (70/80-tri kit spheres)
const eyeIdx = process.argv.length > 3 ? process.argv.slice(3).map(Number)
  : groups.map((g, i) => i).filter((i) => /kit/.test(groups[i].tag)
    && (groups[i].n === 70 || groups[i].n === 80)
    && groups[i].box.getSize(new THREE.Vector3()).length() < 0.30);
const ray = new THREE.Ray(), tri = new THREE.Triangle(), hit = new THREE.Vector3();
const n = new THREE.Vector3(), mid = new THREE.Vector3();
for (const ei of eyeIdx) {
  const eg = groups[ei];
  const blame = new Map();
  let clear = 0;
  for (const [a, b, c] of eg.tris) {
    tri.set(a, b, c); tri.getNormal(n);
    mid.copy(a).add(b).add(c).multiplyScalar(1 / 3);
    ray.origin.copy(mid).addScaledVector(n, 1e-4); ray.direction.copy(n);
    let who = null, best = Infinity;
    groups.forEach((g, gi) => {
      if (gi === ei) return;
      for (const [p, q, r] of g.tris) {
        if (ray.intersectTriangle(p, q, r, false, hit)) {
          const d = hit.distanceTo(ray.origin);
          if (d < best) { best = d; who = gi; }
        }
      }
    });
    if (who === null) clear++; else blame.set(who, (blame.get(who) || 0) + 1);
  }
  console.log(`eye ${ei}: ${clear}/${eg.n} clear; blocked by`,
    [...blame].sort((a, b) => b[1] - a[1]).map(([g, c]) => `${g}(${groups[g].tag})×${c}`).join(' '));
}
