/**
 * Carve a column to a measured depth with a real blade and see what stands.
 *
 *   node tools/_carve.mjs
 */
import './dom-shim.mjs';
import * as THREE from 'three';
import { initPhysics } from '../src/physics/Rapier.js';
import { RapierWorld } from '../src/physics/RapierWorld.js';
import { propMaterials, addColumn } from '../src/world/Props.js';
import { BladeContactSolver } from '../src/game/Combat.js';
import { Saber } from '../src/game/Saber.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);
function mkHost(physics, player) {
  const scene = new THREE.Scene();
  return {
    scene, statics: [], props: [], enemies: [], doors: [], levelLights: [], debris: [],
    physics, particles: null, bladeSolver: null,
    terrain: { height: () => 0, slopeAt: () => 0, inBounds: () => true, friction: 0.9, size: 400,
      normalAt: (x, z, o) => o.set(0, 1, 0), raycast: () => null },
    player: { position: player || V(0, 1, 0) }, settings: { quality: 'medium' },
    addProp(p) { this.props.push(p); return p; }, addLight(l) { return l; }, onExplosion() {},
  };
}
const rg = () => ({ size: 256, res: 33, heights: new Float32Array(33 * 33), height: () => 0,
  normalAt: (x, z, o) => o.set(0, 1, 0), slopeAt: () => 0, inBounds: () => true, friction: 0.9,
  deformSeq: 0, raycast: () => null });

await initPhysics();
propMaterials();

/** Sweep a blade laterally at height `h`, its tip reaching `depth` past x=-R. */
function carve(depth, opts = {}) {
  const w = new RapierWorld({ gravity: -22 });
  w.terrain = rg();
  const host = mkHost(w, V(-1.4, 3.2, 0));
  const solver = new BladeContactSolver();
  host.bladeSolver = solver;
  addColumn(host, V(0, 0, 0), { height: 7.5, radius: 0.55, seed: 500, drift: false });
  const D = host.destruction;
  const s = D.structures[0];
  s.prepareAll();
  const R = 0.55, h = opts.h ?? 3.4, L = 1.3;
  const saber = new Saber(host.scene, { colorIndex: 0, bladeLength: L });
  saber.ignite(); saber.ignition = 1;
  // blade points +x at the column; the hilt sits so the tip ends `depth` past
  // the near face at x = -R
  const hiltX = -R - L + depth;
  const q = new THREE.Quaternion().setFromUnitVectors(V(0, 1, 0), V(1, 0, 0));
  let cuts = 0, grinds = 0;
  for (let i = 0; i < (opts.frames ?? 250); i++) {
    const dt = 1 / 60, t = i * dt;
    saber.setHiltPose(V(hiltX, h, Math.sin(t * 9) * 1.1), q);
    saber.update(dt, dt);
    const caps = D.proxy.capsules();
    for (const e of solver.solve(saber, [{ id: D.proxy.id, capsules: caps, prop: D.proxy, dead: false }], dt, {})) {
      if (e.type === 'cut') { cuts++; D.proxy.cut(e.point, e.normal, e.impulse); }
      else if (e.type === 'grind') grinds++;
    }
    D.update(dt); w.step(dt);
  }
  // let it settle
  for (let i = 0; i < 240; i++) { D.update(1 / 60); w.step(1 / 60); }
  if (process.env.DIAG) {
    const near = s.chunks.filter((c) => c.bounds.min.y <= h && c.bounds.max.y >= h);
    console.log('   cells straddling y=' + h + ':');
    for (const c of near) console.log(`     #${c.index} ${c.state} c=(${c.centre.x.toFixed(2)},${c.centre.y.toFixed(2)},${c.centre.z.toFixed(2)}) half=${c.half.x.toFixed(2)},${c.half.y.toFixed(2)},${c.half.z.toFixed(2)}`);
    const caps = [];
    D.bladeCapsules(V(-1.4, 3.2, 0), caps);
    const att = s.chunks.filter(c=>c.state==='attached');
    console.log('   attached: ' + att.map(c=>`#${c.index}[y${c.bounds.min.y.toFixed(2)}-${c.bounds.max.y.toFixed(2)} g=${c.grounded?1:0} n=${c.neighbours.filter(n=>n.state==='attached').map(n=>n.index).join('/')}]`).join(' '));
    console.log('   capsules published: ' + caps.length + ' — ' + caps.slice(0,8).map(c=>`${c.name}@(${c.p0.x.toFixed(2)},${c.p0.y.toFixed(2)})-(${c.p1.x.toFixed(2)},${c.p1.y.toFixed(2)})r${c.r.toFixed(2)}`).join(' '));
  }
  const above = s.chunks.filter((c) => c.centre.y > h + 0.5);
  const standing = above.filter((c) => c.state === 'attached').length;
  const gone = s.chunks.filter((c) => c.state !== 'attached').length;
  let topY = -Infinity;
  for (const c of s.chunks) if (c.state === 'attached') topY = Math.max(topY, c.bounds.max.y);
  return { depth, cuts, grinds, cells: s.chunks.length, gone, above: above.length, standing,
    topY, state: s.state };
}

console.log('\ncarving a stone column 1.10 m across, horizontally, at y=3.4\n');
console.log('dwell   depth  cuts  cells  detached  above standing/total   top of what stands   piece');
for (const f of [300, 480]) {
  for (const d of [0.0, 0.3, 0.6, 0.9]) {
    const r = carve(d, { frames: f });
    console.log(`${(f/60).toFixed(1)}s   ${d.toFixed(2)}m  ${String(r.cuts).padStart(4)}  ${String(r.cells).padStart(5)}  `
      + `${String(r.gone).padStart(8)}  ${String(r.standing).padStart(8)}/${r.above}  `
      + `${(r.topY === -Infinity ? 'nothing' : r.topY.toFixed(2) + ' m').padStart(18)}   ${r.state}`);
  }
}
console.log('');
