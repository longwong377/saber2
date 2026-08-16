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

  /* THE HULL, separately from the whole machine.
   *
   * "Long and low" is a claim about the BODY, and a bounding box that includes
   * a five-metre gun barrel and a whip antenna cannot answer it. This is the
   * box of the load-bearing hull segments alone — which is also what "can I
   * walk under it" and "can the blade reach the middle of it" are about. */
  const hullBox = new THREE.Box3().makeEmpty();
  for (const name of ['body', 'prow', 'stern']) {
    const b = rig.get(name);
    if (!b || !b.primary) continue;
    box.setFromObject(b.primary);
    hullBox.union(box);
  }
  if (hullBox.isEmpty()) hullBox.copy(all);
  const hullFloor = hullBox.min.y;
  hullBox.getSize(size);
  const H = { w: size.x, h: size.y, l: size.z };

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
  let covered = 0, inProxy = 0;
  const yMid = (hullBox.min.y + hullBox.max.y) * 0.5;
  const s = new THREE.Vector3(), ab = new THREE.Vector3(), ap = new THREE.Vector3();
  /**
   * THE PROXY THE BODY REALLY GETS — asked for, not copied.
   *
   * This read `const proxyR = 1.1, proxyHalf = 0.9, proxyY = 1.4;` under a
   * comment saying "copied from Enemy.js:1296". That is the defect this project
   * keeps rediscovering (HANDOFF 2.3), and here it hid the fix it existed to
   * measure: `Enemy` now prefers `built.proxy` — the sphere chain a builder
   * generates off its own hull — and this instrument went on reporting the
   * capsule's 0% for the AT-TE afterwards, because it was never looking at the
   * game. An instrument with a copy of the constant cannot see the constant
   * change.
   *
   * So the sample now asks whichever collider the body would actually be given.
   */
  const P = built?.proxy;
  const inProxyAt = (z, y) => {
    if (P?.spheres?.length) {
      /* A sphere is `{c:{x,y,z}, r}`. Reading it as flat `sp.y`/`sp.z` silently
       * yields undefined → 0, which put every sphere on the centreline and
       * reported a figure that was neither the old capsule's nor the new
       * chain's. The test is 3D against the sampled point, because the chain is
       * laid out across the hull's WIDTH as well as its length and a 2D test
       * would credit cover that is not over the line being sampled. */
      for (const sp of P.spheres) {
        const c = sp.c ?? sp;
        const sr = sp.r ?? sp.radius ?? P.radius ?? 1;
        if (Math.hypot(0 - (c.x ?? 0), y - ((c.y ?? 0) + (P.y ?? 0)), z - (c.z ?? 0)) <= sr) return true;
      }
      return false;
    }
    const dy = Math.max(0, Math.abs(y - 1.4) - 0.9);
    return Math.hypot(z, dy) <= 1.1;
  };
  for (let i = 0; i < zs; i++) {
    const z = hullBox.min.z + (i + 0.5) / zs * H.l;
    s.set(0, yMid, z);
    for (const c of caps) {
      ab.subVectors(c.p1, c.p0);
      const len2 = Math.max(1e-9, ab.lengthSq());
      const t = Math.max(0, Math.min(1, ap.subVectors(s, c.p0).dot(ab) / len2));
      if (ap.copy(c.p0).addScaledVector(ab, t).distanceTo(s) <= c.r) { covered++; break; }
    }
    if (inProxyAt(z, yMid)) inProxy++;
  }

  const cycle = A.fireRate + A.burst * (A.burstGap ?? 0.12) + (A.telegraph ?? 0);
  return {
    type, side: VEHICLE_SIDE[type], legs, meshes, kept, tris: Math.round(tris),
    S, L, H, hullFloor, caps: caps.length,
    cut: covered / zs, proxy: inProxy / zs,
    burst: A.burst, cycle, dps: (A.burst * A.damage) / cycle,
    volley: A.burst * A.damage, band: A.preferred,
  };
}

const rows = types.map(measure);
const f = (n, d = 2) => n.toFixed(d).padStart(d === 0 ? 4 : 5 + d);

console.log('\n  type          side        legs   whole w × h × l      hull w × h × l    hull L/H  clear  meshes LOD1 caps cut% proxy%');
console.log('  ' + '─'.repeat(122));
for (const r of rows) {
  console.log(`  ${r.type.padEnd(13)} ${String(r.side).padEnd(11)} ${String(r.legs).padStart(3)}  `
    + `${f(r.S.w, 1)}×${f(r.S.h, 1)}×${f(r.S.l, 1)}  `
    + `${f(r.H.w, 1)}×${f(r.H.h, 1)}×${f(r.H.l, 1)}   ${f(r.H.l / r.H.h, 2)}  ${f(r.hullFloor, 2)}`
    + `  ${String(r.meshes).padStart(5)} ${String(r.kept).padStart(4)} ${String(r.caps).padStart(4)}`
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

/* ── --art: the flank, as characters ──────────────────────────────────────
 *
 * Everything above is a number, and a number cannot tell you that a cab is on
 * upside down. This rasterises the same flank `tools/checks/vehicles.mjs`
 * measures the overlap of, into one shared absolute frame, so four machines can
 * be looked at side by side at the scale they actually are. `#` is what
 * survives the LOD cull past thirty metres; `.` is detail that does not.
 */
if (flag('art', false)) {
  const RW = 116, RH = 34, RSPAN = 20, RTALL = 9;
  const tri = new THREE.Vector3(), tb = new THREE.Vector3(), tc = new THREE.Vector3();
  const draw = (root, keep) => {
    const bits = new Uint8Array(RW * RH);
    const sx = (RW - 1) / RSPAN, sy = (RH - 1) / RTALL;
    root.traverse((o) => {
      if (!o.isMesh || !o.geometry?.attributes?.position) return;
      const lvl = (keep.has(o) || o.userData.silhouette) ? 2 : 1;
      const g = o.geometry, p = g.attributes.position, idx = g.index;
      const n = idx ? idx.count : p.count;
      for (let i = 0; i < n; i += 3) {
        const i0 = idx ? idx.getX(i) : i, i1 = idx ? idx.getX(i + 1) : i + 1, i2 = idx ? idx.getX(i + 2) : i + 2;
        tri.fromBufferAttribute(p, i0).applyMatrix4(o.matrixWorld);
        tb.fromBufferAttribute(p, i1).applyMatrix4(o.matrixWorld);
        tc.fromBufferAttribute(p, i2).applyMatrix4(o.matrixWorld);
        const P = [tri, tb, tc].map((q) => [(q.z + RSPAN / 2) * sx, (RTALL - q.y) * sy]);
        const x0 = Math.max(0, Math.floor(Math.min(P[0][0], P[1][0], P[2][0])));
        const x1 = Math.min(RW - 1, Math.ceil(Math.max(P[0][0], P[1][0], P[2][0])));
        const y0 = Math.max(0, Math.floor(Math.min(P[0][1], P[1][1], P[2][1])));
        const y1 = Math.min(RH - 1, Math.ceil(Math.max(P[0][1], P[1][1], P[2][1])));
        const d0 = (P[1][0] - P[0][0]) * (P[2][1] - P[0][1]) - (P[2][0] - P[0][0]) * (P[1][1] - P[0][1]);
        if (Math.abs(d0) < 1e-12) continue;
        for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
          const px = x + 0.5, py = y + 0.5;
          const w0 = ((P[1][0] - px) * (P[2][1] - py) - (P[2][0] - px) * (P[1][1] - py)) / d0;
          const w1 = ((P[2][0] - px) * (P[0][1] - py) - (P[0][0] - px) * (P[2][1] - py)) / d0;
          if (w0 >= -1e-6 && w1 >= -1e-6 && 1 - w0 - w1 >= -1e-6) {
            bits[y * RW + x] = Math.max(bits[y * RW + x], lvl);
          }
        }
      }
    });
    return bits;
  };
  /* POSED FOR REAL, not at rest.
   *
   * The first version of this drew the rig in its rest pose and the AT-TE's
   * feet came out as spikes — the pads were there and were simply seen
   * edge-on, because `_poseWalker` throws the rest pose away and IK-solves
   * every leg to a target on the floor. A picture of a pose the game never
   * shows is worse than no picture: it invites a fix to something that is not
   * broken. So this spawns a live Enemy and steps its own pose solver, which
   * is the same thing tools/_creature.mjs does and for the same reason. */
  const { initPhysics } = await import('../src/physics/Rapier.js');
  const { RapierWorld } = await import('../src/physics/RapierWorld.js');
  const { Enemy } = await import('../src/game/Enemy.js');
  await initPhysics();
  const terrain = {
    height: () => 0, normalAt: (x, z, o) => o.set(0, 1, 0), raycast: () => null,
    size: 400, half: 200, inBounds: () => true, surfaceAt: () => 'sand',
    crater() {}, flush() {}, slopeAt: () => 0,
  };
  const world = {
    scene: new THREE.Scene(), physics: new RapierWorld(), terrain,
    enemies: [], particles: null, difficulty: null, groundColor: 0xa9764a,
  };
  for (const type of types) {
    const e = new Enemy(world, type, new THREE.Vector3(0, 0, 0));
    /* FACING ZERO, deliberately. `_poseWalker` yaws the hips to `this.facing`,
     * which a fresh Enemy sets from its spawn heading — so the first version of
     * this drew the AT-TE HEAD ON, 8.3 m wide and 6.8 m tall, and it read as a
     * blob. The flank is the view every reference plate is taken from and the
     * only one that carries leg count and ground clearance. */
    e.facing = 0;
    const pctx = { terrain, time: 0 };
    for (let i = 0; i < 8; i++) { pctx.time += 1 / 60; e._poseWalker(1 / 60, pctx); }
    e.rig.root.updateMatrixWorld(true);
    const keep = new Set();
    for (const b of e.rig.list) if (b.primary) keep.add(b.primary);
    const bits = draw(e.rig.root, keep);
    console.log(`\n  ${type} — flank, nose to the right, ${RSPAN} m across`);
    for (let y = 0; y < RH; y++) {
      let line = '  ';
      for (let x = 0; x < RW; x++) line += bits[y * RW + x] === 2 ? '#' : bits[y * RW + x] ? '.' : ' ';
      if (line.trim()) console.log(line.replace(/\s+$/, ''));
    }
    console.log('  ' + '─'.repeat(RW));
  }
}
