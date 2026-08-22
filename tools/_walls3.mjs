/**
 * THE INVISIBLE WALL PROBE, third form — walk into them.
 *
 * "the forest map still has a shit ton of invisible walls blocking you, I think
 *  maybe only when you cut trees down"
 *
 * The previous two probes audited the tree system against itself and against
 * its own drawing, and both came back clean — which is the answer to a
 * different question. This one is the player's: walk the real Player across the
 * wood, hold a direction, and record every place they STOP. Then ask what is
 * standing there.
 */
import './dom-shim.mjs';
import { bootWorld, idleInput } from './checks/_coop.mjs';
const THREE = await import('three');

const FELL = Number(process.argv[2] || 40);
const { world } = await bootWorld({ level: 'wood', settings: { mode: 'waves', quality: 'low', instantSpawn: true } });
const F = world.forest;
const P = world.player;
const STRIDE = 15, X = 0, Z = 1;

const input = { ...idleInput() };
let wish = { x: 0, y: -1 };
input.moveAxis = (o) => { if (o) { o.x = wish.x; o.y = wish.y; return o; } return { ...wish }; };

const alive = () => { P.hp = P.maxHp; P.alive = true; };
const step = (n) => { for (let i = 0; i < n; i++) { alive(); world.update(1 / 60, input); } };

/* Fell a stand of trees around the player, the way a player clearing a path
 * does — through `cut`'s own entry point so the chain rules apply. */
const near = [];
for (let i = 0; i < F.count; i++) {
  near.push([i, Math.hypot(F.data[i * STRIDE + X] - P.position.x, F.data[i * STRIDE + Z] - P.position.z)]);
}
near.sort((a, b) => a[1] - b[1]);
let felled = 0;
for (const [i] of near) {
  if (felled >= FELL) break;
  const before = F.stats.felled;
  F.fell(i, Math.cos(i * 1.7), Math.sin(i * 1.7), 0.6);
  if (F.stats.felled > before) felled++;
  step(8);
}
step(60 * 12);

/** What is drawn, as segments — trunks, stumps and carried logs. */
const drawnSegs = () => {
  const segs = [];
  const m = new THREE.Matrix4(); const p = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3();
  for (const mesh of [F.trunkMesh, F.stumpMesh]) {
    if (!mesh) continue;
    for (let i = 0; i < mesh.count; i++) {
      mesh.getMatrixAt(i, m); m.decompose(p, q, s);
      if (s.y < 0.02 || s.x < 0.005) continue;
      const up = new THREE.Vector3(0, 1, 0).applyQuaternion(q).multiplyScalar(s.y);
      segs.push({ a: p.clone(), b: p.clone().add(up), r: Math.max(s.x, s.z) });
    }
  }
  for (const b of world.physics.bodies) {
    if (b.invMass === 0 || !b.boundingRadius) continue;
    segs.push({ a: b.position.clone(), b: b.position.clone(), r: b.boundingRadius });
  }
  /* Anything else in the scene with real geometry, as a bounding sphere — the
   * level's rocks, huts and dressing. A wall is only a wall if NOTHING at all
   * is drawn there, so this list is deliberately generous. */
  world.scene.traverse((o) => {
    if (!o.isMesh || !o.visible || !o.geometry || o.isInstancedMesh) return;
    if (!o.geometry.boundingSphere) o.geometry.computeBoundingSphere();
    const bs = o.geometry.boundingSphere;
    /* Not the terrain, not the skydome: a bounding sphere the size of the level
     * swallows every query and turns this instrument into one that always says
     * "something is drawn there". That is how the first run of this probe
     * reported zero walls — the ground was 353 m of "nearest drawn thing". */
    if (!bs || !isFinite(bs.radius) || bs.radius > 8) return;
    const c = bs.center.clone().applyMatrix4(o.matrixWorld);
    const sc = new THREE.Vector3().setFromMatrixScale(o.matrixWorld);
    segs.push({ a: c, b: c, r: bs.radius * Math.max(sc.x, sc.y, sc.z) });
  });
  return segs;
};

const distToSeg = (p, a, b) => {
  const ab = new THREE.Vector3().subVectors(b, a);
  if (ab.lengthSq() < 1e-9) return a.distanceTo(p);
  const t = Math.max(0, Math.min(1, new THREE.Vector3().subVectors(p, a).dot(ab) / ab.lengthSq()));
  return new THREE.Vector3().copy(a).addScaledVector(ab, t).distanceTo(p);
};

const tally = {};
const logStalls = [];
/** Distance from a point to a box, in the box's own frame. */
const boxDist = (b, p) => {
  const q = new THREE.Vector3().subVectors(p, b.center).applyQuaternion(b.invQuat);
  const dx = Math.max(0, Math.abs(q.x) - b.halfExtents.x);
  const dy = Math.max(0, Math.abs(q.y) - b.halfExtents.y);
  const dz = Math.max(0, Math.abs(q.z) - b.halfExtents.z);
  return Math.hypot(dx, dy, dz);
};
const segs = drawnSegs();
const home = P.position.clone();
let blocked = 0, walks = 0, sampled = 0;
const hits = [];
for (let w = 0; w < 24; w++) {
  /* Start at the edge of the felled patch and walk through the middle of it. */
  const a = (w / 24) * Math.PI * 2;
  P.position.set(home.x + Math.cos(a) * 16, home.y + 3, home.z + Math.sin(a) * 16);
  P.velocity.set(0, 0, 0);
  P.aimDir.set(-Math.cos(a), 0, -Math.sin(a)).normalize();
  P.yaw = Math.atan2(-P.aimDir.x, -P.aimDir.z);
  if (P.camera) { P.camera.yaw = P.yaw; P.camera.pitch = 0; }
  wish = { x: 0, y: -1 };
  step(30);
  walks++;
  let stallT = 0, last = P.position.clone();
  for (let f = 0; f < 60 * 10; f++) {
    step(1);
    sampled++;
    const moved = P.position.distanceTo(last) * 60;
    last.copy(P.position);
    if (moved < 0.6 && P.grounded) {
      stallT += 1 / 60;
      if (stallT > 0.5) {
        stallT = 0;
        /* WHAT STOPPED US? The nearest drawn thing to the player's own chest. */
        let d = Infinity;
        for (const s of segs) d = Math.min(d, distToSeg(P.position, s.a, s.b) - s.r);
        blocked++;
        /* AND WHAT KIND OF THING IT IS. A stall against a standing trunk is the
         * system working; a stall against a log lying on the ground is the
         * complaint whether or not the log is drawn, because a man steps over
         * a log. */
        let who = 'nothing', top = 0, gap = Infinity;
        const foot = P.position.clone();
        for (const [i, b] of F.live) {
          const dd = boxDist(b, foot);
          if (dd < gap) { gap = dd; who = `standing #${i}`; top = b.center.y + b.halfExtents.y; }
        }
        for (const [i, arr] of F.logs) for (const b of arr) {
          const dd = boxDist(b, foot);
          if (dd < gap) { gap = dd; who = `log #${i}`; top = b.center.y + b.halfExtents.y; }
        }
        for (const b of world.physics.staticBoxes) {
          const dd = boxDist(b, foot);
          if (dd < gap) { gap = dd; who = 'level box'; top = b.center.y + b.halfExtents.y; }
        }
        const ground = world.terrain.height(foot.x, foot.z);
        tally[who.split(' ')[0]] = (tally[who.split(' ')[0]] || 0) + 1;
        /* WHY THE CLIMB DID NOT ENGAGE, for a stall against a log. Everything
         * the three gates in `Player._collide` read, at the moment the body
         * gave up: how high the wood is over the ground it is standing on,
         * whether the support query is answering with the box at all, and
         * whether the body thinks it is climbing. */
        if (who.startsWith('log')) {
          const { supportHeight, STEP_UP } = await import('../src/physics/Support.js');
          const sup = supportHeight(world.terrain, P._nearBoxes, null, foot.x, foot.z, foot.y, P.radius, STEP_UP);
          /* AND THE BOX ITSELF, because everything above is downstream of it. */
          const { boxTopAt } = await import('../src/physics/Support.js');
          let box = null, bd = Infinity;
          for (const [, arr] of F.logs) for (const b of arr) {
            const d = boxDist(b, foot);
            if (d < bd) { bd = d; box = b; }
          }
          const inNear = P._nearBoxes.includes(box);
          const topAt = box ? boxTopAt(box, foot.x, foot.z, P.radius) : null;
          logStalls.push({
            climbFlag: box?.userData?.climb ?? null,
            inNear,
            topAt: topAt === -Infinity ? '-inf' : +(topAt - foot.y).toFixed(2),
            disabled: !!box?.disabled,
            top: +(top - ground).toFixed(2),
            gap: +gap.toFixed(2),
            support: +(sup - foot.y).toFixed(2),
            climbing: !!P.climbing,
            grounded: !!P.grounded,
            slope: +(world.terrain.height(foot.x + 1, foot.z + 1) - ground).toFixed(2),
          });
        }
        if (hits.length < 15) {
          hits.push(`  at ${foot.toArray().map((v) => v.toFixed(1)).join(',')} — nearest drawn ${d.toFixed(2)} m; blocker ${who} ${gap.toFixed(2)} m away, its top ${(top - ground).toFixed(2)} m over the ground`);
        }
      }
    } else stallT = 0;
  }
}
console.log(`felled ${felled} (chained to ${F.stats.felled}); ${walks} walks, ${sampled} frames`);
console.log(`stalls: ${blocked}; stalls with nothing drawn within 1.2 m: ${hits.length}`);
for (const h of hits) console.log(h);
console.log('blockers:', JSON.stringify(tally));
console.log('log stalls, why the climb did not engage:');
for (const L of logStalls.slice(0, 14)) console.log(' ', JSON.stringify(L));
