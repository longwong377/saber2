import './dom-shim.mjs';
import * as THREE from 'three';
const { buildGeonosian } = await import('../src/game/Bodies.js');

const built = buildGeonosian({ scale: Number(process.argv[2] || 0.97) });
built.rig.root.updateMatrixWorld(true);
// measure off TRANSFORMED VERTICES, as giants.mjs does
const box = new THREE.Box3();
const v = new THREE.Vector3();
let meshes = 0, tris = 0;
built.rig.root.traverse((o) => {
  if (!o.isMesh || !o.geometry) return;
  meshes++;
  const pos = o.geometry.attributes.position;
  tris += (o.geometry.index ? o.geometry.index.count : pos.count) / 3;
  for (let i = 0; i < pos.count; i++) { v.fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld); box.expandByPoint(v); }
});
const size = new THREE.Vector3(); box.getSize(size);
console.log('meshes', meshes, 'tris', Math.round(tris));
console.log('box  h', size.y.toFixed(3), ' w', size.x.toFixed(3), ' d', size.z.toFixed(3));
console.log('y range', box.min.y.toFixed(3), '..', box.max.y.toFixed(3));
console.log('bones', built.rig.list.length, 'wing bones', built.rig.list.filter((b) => b.role === 'wing').map((b) => `${b.name} share ${b.roleShare.toFixed(2)} of ${b.roleOf}`).join(', '));
