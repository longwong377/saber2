/**
 * THE INVISIBLE WALL PROBE, second form — against what is DRAWN.
 *
 * "the forest map still has a shit ton of invisible walls blocking you, I think
 *  maybe only when you cut trees down"
 *
 * The authority on what a player can see is the instance matrices actually
 * uploaded for the trunk, stump and crown meshes — not the tree records, which
 * are what the collider code already believes. So this samples the volume of
 * every static box the forest owns and asks whether any DRAWN instance overlaps
 * it; a box with nothing drawn in it is exactly the wall in the complaint.
 */
import './dom-shim.mjs';
import { bootWorld, idleInput } from './checks/_coop.mjs';
const THREE = await import('three');

const { world } = await bootWorld({ level: 'wood', settings: { mode: 'waves', quality: 'low', instantSpawn: true } });
const input = idleInput();
const F = world.forest;
const N = Number(process.argv[2] || 40);
const P = world.player;

/** Every drawn cylinder, as a segment with a radius. */
const drawn = () => {
  const segs = [];
  const m = new THREE.Matrix4();
  const pos = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3();
  for (const mesh of [F.trunkMesh, F.stumpMesh]) {
    if (!mesh) continue;
    for (let i = 0; i < mesh.count; i++) {
      mesh.getMatrixAt(i, m);
      m.decompose(pos, q, s);
      if (s.y < 0.02 || s.x < 0.005) continue;          // collapsed = not drawn
      const up = new THREE.Vector3(0, 1, 0).applyQuaternion(q).multiplyScalar(s.y);
      segs.push({ a: pos.clone(), b: pos.clone().add(up), r: Math.max(s.x, s.z), mesh: mesh.name, i });
    }
  }
  /* Logs the player has picked up are ordinary props with their own mesh. */
  for (const [, rec] of F.real) {
    const p = rec.prop;
    if (!p?.body) continue;
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(p.body.quaternion).multiplyScalar(p.length ?? 4);
    segs.push({ a: p.body.position.clone().sub(up.clone().multiplyScalar(0.5)), b: p.body.position.clone().add(up.clone().multiplyScalar(0.5)), r: p.radius ?? 0.4, mesh: 'prop', i: -1 });
  }
  return segs;
};

const distToSeg = (p, a, b) => {
  const ab = new THREE.Vector3().subVectors(b, a);
  const t = Math.max(0, Math.min(1, new THREE.Vector3().subVectors(p, a).dot(ab) / Math.max(1e-6, ab.lengthSq())));
  return new THREE.Vector3().copy(a).addScaledVector(ab, t).distanceTo(p);
};

/* NEAR THE PLAYER, because the collider ring is laid around the player and a
 * tree felled on the far side of the wood is a tree with nothing under it by
 * design. The complaint is about ground the player is standing on. */
const STRIDE = 15, X = 0, Z = 1;      // F's own record layout, src/world/Trees.js
const near = [];
for (let i = 0; i < F.count; i++) {
  const d = Math.hypot(F.data[i * STRIDE + X] - P.position.x, F.data[i * STRIDE + Z] - P.position.z);
  near.push([i, d]);
}
near.sort((a, b) => a[1] - b[1]);
let felled = 0;
for (const [i] of near) {
  if (felled >= N) break;
  const before = F.stats.felled;
  F.fell(i, Math.cos(i * 1.7), Math.sin(i * 1.7), 0.6);
  if (F.stats.felled > before) felled++;
  for (let f = 0; f < 6; f++) { P.hp = P.maxHp; P.alive = true; world.update(1 / 30, input); }
}
/* THE PLAYER SURVIVES THEIR OWN LOGGING. A tree that lands on you kills you,
 * and a dead player lays no collider ring at all — which would make this probe
 * measure an empty wood. */
const keepAlive = () => { P.hp = P.maxHp; P.alive = true; };
for (let f = 0; f < 30 * 25; f++) { keepAlive(); world.update(1 / 30, input); }
/* …and then a walk through the felled ground, because the ring follows the
 * body and a wall you never walk into is a wall nobody has met. */
const start = P.position.clone();
for (let f = 0; f < 30 * 30; f++) {
  keepAlive();
  const a = (f / (30 * 30)) * Math.PI * 2;
  P.position.set(start.x + Math.cos(a) * 9, P.position.y, start.z + Math.sin(a) * 9);
  world.update(1 / 30, input);
}

console.log(`down=${F.down.size} live=${F.live.size} logs=${F.logs.size} real=${F.real.size} players=${world.players.length} alive=${world.player?.alive}`);
const segs = drawn();
const boxes = [];
for (const [i, b] of F.live) boxes.push([b, `standing #${i}`]);
for (const [i, arr] of F.logs) for (const b of arr) boxes.push([b, `log #${i}`]);
for (const [i, r] of F.real) if (r.box) boxes.push([r.box, `prop #${i}`]);

let walls = 0;
for (const [b, who] of boxes) {
  /* The box's own volume, sampled on a 3x3x3 lattice of its half extents. */
  let nearest = Infinity;
  for (let sx = -1; sx <= 1; sx++) for (let sy = -1; sy <= 1; sy++) for (let sz = -1; sz <= 1; sz++) {
    const local = new THREE.Vector3(b.halfExtents.x * sx * 0.7, b.halfExtents.y * sy * 0.7, b.halfExtents.z * sz * 0.7);
    const p = local.applyQuaternion(b.quat).add(b.center);
    for (const s of segs) {
      const d = distToSeg(p, s.a, s.b) - s.r;
      if (d < nearest) nearest = d;
    }
  }
  if (nearest > 0.9) {
    walls++;
    if (walls <= 12) console.log(`  WALL ${who}: nothing drawn within ${nearest.toFixed(2)} m of it — box at ${b.center.toArray().map((v) => v.toFixed(1)).join(',')} half ${b.halfExtents.toArray().map((v) => v.toFixed(2)).join(',')}`);
  }
}
console.log(`felled ${felled} (chained to ${F.stats.felled}), ${boxes.length} forest colliders, ${segs.length} drawn pieces`);
console.log(`invisible walls: ${walls}`);
