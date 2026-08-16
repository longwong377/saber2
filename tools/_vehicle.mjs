/**
 * What a vehicle actually IS, measured off the built body.
 *
 *   node --import ./tools/register.mjs tools/_vehicle.mjs
 *   node --import ./tools/register.mjs tools/_vehicle.mjs --type atte --verbose
 *
 * This is an instrument, not a check: it has no bars and asserts nothing, for
 * the reason HANDOFF §3 gives about the two traces. The moment it scores
 * something it becomes a second copy of tools/checks/vehicles.mjs with the
 * bounds written down twice, and one of the two copies will be wrong.
 *
 * It prints the numbers the silhouette argument is made of — box, leg count,
 * ground clearance, what survives the LOD cull, what the blade can reach, and
 * the shot cadence — so that "they look different" can be replaced by a table
 * somebody can read.
 *
 * `dom-shim.mjs` first, because the materials reach Textures.js, which bakes
 * onto a canvas.
 */
import './dom-shim.mjs';
import * as THREE from 'three';

if ((await import('three')) !== THREE) {
  console.error('\n  tools/_vehicle.mjs was started without its module loader.\n'
    + '  Run: node --import ./tools/register.mjs tools/_vehicle.mjs\n');
  process.exit(2);
}

const argv = process.argv.slice(2);
const flag = (name, def) => {
  const i = argv.indexOf('--' + name);
  return i < 0 ? def : (argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : true);
};

const { ARCHETYPES } = await import('../src/game/Enemy.js');
const { VEHICLE_TYPES, VEHICLE_SIDE, buildGunship } = await import('../src/game/Vehicles.js');

const want = flag('type', null);
const types = want ? [want] : VEHICLE_TYPES;
const verbose = !!flag('verbose', false);

const box = new THREE.Box3();
const size = new THREE.Vector3();

function measure(type) {
  const A = ARCHETYPES[type];
  const built = A.build({ scale: A.scale });
  const rig = built.rig;
  const ST = built.stance;

  // Pose the rig at rest, standing on flat ground at hipHeight. That is what
  // `_poseWalker` does on the first frame and it is the only pose that can be
  // reproduced without an Enemy, a World and a terrain.
  rig.hipsBone.obj.position.set(0, ST.hipHeight, 0);
  rig.updateMatrices();
  rig.root.updateMatrixWorld(true);

  let legs = 0;
  while (rig.get(`femur${legs}`)) legs++;

  // the whole body, and the part of it that survives the LOD cull
  const all = new THREE.Box3().makeEmpty();
  const lod = new THREE.Box3().makeEmpty();
  const keep = new Set();
  for (const b of rig.list) if (b.primary) keep.add(b.primary);
  let meshes = 0, kept = 0, tris = 0;
  rig.root.traverse((o) => {
    if (!o.isMesh) return;
    meshes++;
    o.updateMatrixWorld(true);
    box.setFromObject(o);
    all.union(box);
    const g = o.geometry;
    tris += (g.index ? g.index.count : g.attributes.position.count) / 3;
    if (keep.has(o) || o.userData.silhouette) { kept++; lod.union(box); }
  });
  all.getSize(size);
  const S = { w: size.x, h: size.y, l: size.z };
  lod.getSize(size);
  const L = { w: size.x, h: size.y, l: size.z };

  // where the lowest hull piece sits, which is what "can I walk under it" means
  let hullFloor = Infinity;
  for (const name of ['body', 'prow', 'stern', 'head']) {
    const b = rig.get(name);
    if (!b || !b.primary) continue;
    box.setFromObject(b.primary);
    hullFloor = Math.min(hullFloor, box.min.y);
  }

  // what the blade can touch: one capsule per bone that carries geometry
  const caps = [];
  const p0 = new THREE.Vector3(), p1 = new THREE.Vector3(), q = new THREE.Quaternion();
  for (const b of rig.list) {
    if (!b.parts.length) continue;
    b.obj.updateMatrixWorld(false);
    p0.setFromMatrixPosition(b.obj.matrixWorld);
    q.setFromRotationMatrix(b.obj.matrixWorld);
    p1.copy(p0).add(new THREE.Vector3(0, b.length, 0).applyQuaternion(q));
    caps.push({ name: b.name, p0: p0.clone(), p1: p1.clone(), r: b.radius * 1.12 });
  }

  // how much of the hull's own length lies inside SOME capsule, sampled along
  // the centreline at hull height — the honest form of "can I cut it anywhere"
  const zs = 64;
  let covered = 0;
  const yMid = (all.min.y + all.max.y) * 0.55;
  const s = new THREE.Vector3(), ab = new THREE.Vector3(), ap = new THREE.Vector3();
  for (let i = 0; i < zs; i++) {
    const z = all.min.z + (i + 0.5) / zs * S.l;
    s.set(0, yMid, z);
    for (const c of caps) {
      ab.subVectors(c.p1, c.p0);
      const len2 = Math.max(1e-9, ab.lengthSq());
      const t = Math.max(0, Math.min(1, ap.subVectors(s, c.p0).dot(ab) / len2));
      if (ap.copy(c.p0).addScaledVector(ab, t).distanceTo(s) <= c.r) { covered++; break; }
    }
  }

  // the movement proxy Enemy gives every `big` body, unchanged from Enemy.js
  const proxyR = 1.1, proxyHalf = 0.9, proxyY = 1.4;
  let inProxy = 0;
  for (let i = 0; i < zs; i++) {
    const z = all.min.z + (i + 0.5) / zs * S.l;
    const dy = Math.max(0, Math.abs(yMid - proxyY) - proxyHalf);
    if (Math.hypot(z, dy) <= proxyR) inProxy++;
  }

  const cycle = A.fireRate + A.burst * (A.burstGap ?? 0.12) + (A.telegraph ?? 0);
  return {
    type, side: VEHICLE_SIDE[type], legs, meshes, kept, tris: Math.round(tris),
    S, L, hullFloor, caps: caps.length,
    cut: covered / zs, proxy: inProxy / zs,
    burst: A.burst, cycle, dps: (A.burst * A.damage) / cycle,
    volley: A.burst * A.damage, band: A.preferred,
  };
}

const rows = types.map(measure);
const f = (n, d = 2) => n.toFixed(d).padStart(d === 0 ? 4 : 5 + d);

console.log('\n  type          side        legs   w × h × l (m)      L/H   clear  meshes  LOD1  caps  cut%  proxy%');
console.log('  ' + '─'.repeat(100));
for (const r of rows) {
  console.log(`  ${r.type.padEnd(13)} ${String(r.side).padEnd(11)} ${String(r.legs).padStart(3)}  `
    + `${f(r.S.w, 1)}×${f(r.S.h, 1)}×${f(r.S.l, 1)}  ${f(r.S.l / r.S.h, 2)}  ${f(r.hullFloor, 2)}`
    + `  ${String(r.meshes).padStart(5)} ${String(r.kept).padStart(5)} ${String(r.caps).padStart(5)}`
    + `  ${f(r.cut * 100, 0)}  ${f(r.proxy * 100, 0)}`);
}

console.log('\n  type          burst  cycle(s)  volley  dps    band(m)      LOD1 w×h×l');
console.log('  ' + '─'.repeat(80));
for (const r of rows) {
  console.log(`  ${r.type.padEnd(13)} ${String(r.burst).padStart(4)}  ${f(r.cycle, 2)}     ${f(r.volley, 0)}  ${f(r.dps, 1)}`
    + `  ${String(r.band[0]).padStart(3)}–${String(r.band[1]).padEnd(4)}  `
    + `${f(r.L.w, 1)}×${f(r.L.h, 1)}×${f(r.L.l, 1)}`);
}

// the gunship, which is not an archetype and is measured on its own terms
const gs = buildGunship();
gs.updateMatrixWorld(true);
const gb = new THREE.Box3().setFromObject(gs);
gb.getSize(size);
let gm = 0, gt = 0;
gs.traverse((o) => {
  if (!o.isMesh) return;
  gm++;
  gt += (o.geometry.index ? o.geometry.index.count : o.geometry.attributes.position.count) / 3;
});
console.log(`\n  gunship       ${size.x.toFixed(1)} × ${size.y.toFixed(1)} × ${size.z.toFixed(1)} m, `
  + `${gm} meshes, ${Math.round(gt)} triangles`);
console.log(`                the box it replaces in Arrivals.js is 2.7 × 1.55 × 7.6 with a 10.0 m wing span\n`);

if (verbose) {
  for (const r of rows) {
    const A = ARCHETYPES[r.type];
    console.log(`\n  ${r.type}: hp ${A.hp} mass ${A.mass} speed ${A.speed} threat ${A.threat} score ${A.score}`);
  }
}
