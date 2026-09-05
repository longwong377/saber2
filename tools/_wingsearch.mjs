import './dom-shim.mjs';
import * as THREE from 'three';
const { COMPANION_KINDS, COMPANION_UNITS, bodyScaleOf, growthOptsFrom } = await import('../src/game/CompanionKinds.js');
const { companionOptsFrom } = await import('../src/game/Bodies.js');
const A = COMPANION_UNITS[COMPANION_KINDS.hawk.archetype];
const mk = () => A.build({ scale: bodyScaleOf('hawk', null), ...companionOptsFrom({}), ...growthOptsFrom('hawk', null) });
const box = (root) => { root.position.set(0,0,0); root.quaternion.identity(); root.updateMatrixWorld(true);
  const b = new THREE.Box3().setFromObject(root); const s = b.getSize(new THREE.Vector3());
  return { x: s.x, y: s.y, z: s.z, min: b.min.y }; };
const e = new THREE.Euler(), q = new THREE.Quaternion();
function fold(built, arm, fan) {
  const rig = built.rig;
  for (const L of ['L','R']) { const side = L === 'L' ? 1 : -1;
    for (const [n, r] of [[`wing${L}`, arm], [`wingTip${L}`, fan]]) {
      const b = rig.bones.get(n); if (!b) continue;
      e.set(r[0], r[1]*side, r[2]*side); q.setFromEuler(e);
      b.obj.quaternion.copy(b.restQuat).multiply(q);
    } }
}
const base = box(mk().rig.root);
console.log('unfolded  ', `x${base.x.toFixed(2)} y${base.y.toFixed(2)} z${base.z.toFixed(2)} min${base.min.toFixed(2)}`);
for (const ax of [-1.0, -0.85, -0.7, -0.55, -0.4]) {
  for (const fx of [-0.8, -0.5, -0.25, 0, 0.25, 0.5]) {
    for (const ay of [-0.3, 0, 0.3]) {
      const b = mk(); fold(b, [ax, ay, 0], [fx, 0, 0]);
      const r = box(b.rig.root);
      if (r.x < 0.75 && r.z < 1.55 && r.min > -0.30) console.log(`arm x=${ax} y=${ay} fan=${fx}`.padEnd(30), `span${r.x.toFixed(2)} tall${r.y.toFixed(2)} long${r.z.toFixed(2)} min${r.min.toFixed(2)}`);
    }
  }
}
