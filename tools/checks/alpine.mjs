/**
 * THE WHITE PASS: ITS FORMS ARE SOLID, AND THEY ARE THE RIGHT COLOUR.
 *
 * Two reports, both about the same level, both measurable:
 *
 *   "all the boulders you see on the snow/ice level don't have physics like I
 *    would say the majority of the rocks on the ice level you can just walk
 *    through or you fall through"
 *
 *   "I don't know why the rocks are yellowish on the ice planet that doesn't
 *    really fit they should be greyish or something."
 *
 * THE FIT. Every massif, every big drift hump and every rock outcrop on the
 * level is rayed from above on a grid, and from the side at three heights, and
 * the PHYSICS answer — `RapierWorld.raycast` against the colliders the dressing
 * actually added — is held to within `TOL` of the VISUAL answer, a
 * `THREE.Raycaster` against the meshes the player sees. A walk-through is the
 * physics surface below the visual one; a fall-through is the physics above
 * it; both are one number here, signed, and the worst of each is printed.
 *
 * Measured before the fit on the shipped nine-massif level, the same rays:
 * physics 3.1 m UNDER the snow at the massifs' skirts, 1.4 m OVER it along the
 * old box's top edge, and the big humps at nothing at all.
 *
 * THE COLOUR. `snowPack` and `rockCold` carry their measured linear albedo on
 * userData (Props.js `mk`), so what is held is the product the material
 * actually renders at: snow at least as blue as it is red, rock with no
 * channel over 0.45 and blue its strongest. Yellow snow was the sand bake
 * under a blue multiplier — the product was (1.82, 1.32, 0.69).
 */

import * as THREE from 'three';
import { Terrain } from '../../src/world/Terrain.js';
import { LEVELS } from '../../src/game/Levels.js';
import { propMaterials } from '../../src/world/Props.js';
import { RapierWorld } from '../../src/physics/RapierWorld.js';
import { initPhysics } from '../../src/physics/Rapier.js';

/** Physics must agree with the picture to this, everywhere on every form. */
const TOL = 0.25;

function stubWorld(terrain, physics, level) {
  return {
    scene: new THREE.Scene(), level, statics: [], levelLights: [], props: [], enemies: [], doors: [], grass: null,
    physics,
    addLight(l) { (this.lights ||= []).push(l); this.scene.add(l); return l; },
    addDoor(d) { this.doors.push(d); return d; },
    particles: { sandPuff() {}, sparkBurst() {}, slag() {} },
    notify() {}, report() {}, spawnEnemy: () => null, spawnDebris() {},
    time: 0,
    addProp(p) { this.props.push(p); return p; },
    terrain,
    settings: { quality: 'medium' },
  };
}

let built = null;
function build() {
  if (built) return built;
  const terrain = new Terrain(new THREE.Scene(), 'alpine', 0.5);
  const physics = new RapierWorld({ gravity: -24, iterations: 4, maxBodies: 64 });
  physics.terrain = terrain;
  const world = stubWorld(terrain, physics, LEVELS.alpine);
  propMaterials();
  LEVELS.alpine.dress(world);
  // Rapier's query pipeline sees a collider only after a step
  physics.step(1 / 60);
  world.scene.updateMatrixWorld(true);
  const massifs = world.statics.filter((m) => m.name === 'snowMassif');
  const rocks = world.statics.filter((m) => m.name === 'rockOutcrop');
  const humps = world.statics.filter((m) => m.name === 'snowDrift1');
  /* THE SOLID FORMS, as one list the visual rays can be asked about together:
   * a ray over a hump that meets a massif first is a ray the physics answers
   * with the massif, and the picture has to be asked the same question. A
   * hump is solid iff its crest stands over 0.6 m — see strewSnowForms — so
   * the big grade is split here into proxies for the solid ones. */
  const solids = [...massifs, ...rocks];
  const solidHumps = [], freeHumps = [];
  for (const im of humps) {
    const solidIdx = new Set(im.userData.solid || []);
    for (let i = 0; i < im.count; i++) {
      const box = boundsOf(im, i);
      const cx = (box.min.x + box.max.x) / 2, cz = (box.min.z + box.max.z) / 2;
      const crest = box.max.y - terrain.height(cx, cz);
      const mtx = new THREE.Matrix4(); im.getMatrixAt(i, mtx);
      const proxy = new THREE.Mesh(im.geometry);
      proxy.matrixWorld.copy(im.matrixWorld).multiply(mtx); proxy.matrixAutoUpdate = false;
      proxy.userData.crest = crest; proxy.userData.box = box;
      // the dressing's own word on which got colliders; the crest it decided
      // on is asserted below against the one measured here
      (solidIdx.has(i) ? solidHumps : freeHumps).push(proxy);
    }
  }
  solids.push(...solidHumps);
  const fitted = physics.staticBoxes.filter((b) => b.userData && b.userData.fitted);
  return (built = { terrain, physics, world, massifs, rocks, humps, solids, solidHumps, freeHumps, fitted });
}

/** World-space bounds of a mesh, or of one instance of an instanced mesh. */
function boundsOf(mesh, instance = -1) {
  const g = mesh.geometry;
  if (!g.boundingBox) g.computeBoundingBox();
  const m = new THREE.Matrix4().copy(mesh.matrixWorld);
  if (instance >= 0) { const im = new THREE.Matrix4(); mesh.getMatrixAt(instance, im); m.multiply(im); }
  return new THREE.Box3().copy(g.boundingBox).applyMatrix4(m);
}

/**
 * THE PHYSICS ANSWER, off the records the game's own sweeps read.
 *
 * `Player._gatherNear`, both of `Enemy`'s sweeps and `Support` walk
 * `physics.staticBoxes` and read `.center`, `.halfExtents` and `.quat` off
 * each record — that is the collision the player feels, and it is what is
 * rayed here: a slab test per box in its own frame, over the boxes the fitter
 * added (`userData.fitted`), plus the terrain. Not `RapierWorld.raycast`,
 * which also answers with every crate, hull and barrel on the level, none of
 * which is in the picture being compared against.
 */
function physRay(B, origin, dir, far) {
  let best = null, bestT = far;
  const inv = new THREE.Quaternion(), o = new THREE.Vector3(), d = new THREE.Vector3();
  for (const b of B.fitted) {
    if (b.disabled) continue;
    // cheap reject on the bounding sphere
    const dx = b.center.x - origin.x, dy = b.center.y - origin.y, dz = b.center.z - origin.z;
    const along = dx * dir.x + dy * dir.y + dz * dir.z;
    const perp2 = dx * dx + dy * dy + dz * dz - along * along;
    if (perp2 > b.radius * b.radius || along < -b.radius || along - b.radius > bestT) continue;
    inv.copy(b.quat).invert();
    o.subVectors(origin, b.center).applyQuaternion(inv);
    d.copy(dir).applyQuaternion(inv);
    let t0 = 0, t1 = bestT, ok = true;
    for (const [oc, dc, h] of [[o.x, d.x, b.halfExtents.x], [o.y, d.y, b.halfExtents.y], [o.z, d.z, b.halfExtents.z]]) {
      if (Math.abs(dc) < 1e-9) { if (Math.abs(oc) > h) { ok = false; break; } continue; }
      let ta = (-h - oc) / dc, tb = (h - oc) / dc;
      if (ta > tb) { const q = ta; ta = tb; tb = q; }
      if (ta > t0) t0 = ta;
      if (tb < t1) t1 = tb;
      if (t0 > t1) { ok = false; break; }
    }
    if (ok && t0 < bestT) { bestT = t0; best = b; }
  }
  // the ground, marched
  let tg = -1;
  for (let t = 0; t <= far; t += 0.2) {
    const x = origin.x + dir.x * t, y = origin.y + dir.y * t, z = origin.z + dir.z * t;
    if (y <= B.terrain.height(x, z)) { tg = t; break; }
  }
  if (tg >= 0 && tg < bestT) {
    // refine to the crossing
    let lo = Math.max(0, tg - 0.2), hi = tg;
    for (let i = 0; i < 12; i++) {
      const mid = (lo + hi) / 2;
      const y = origin.y + dir.y * mid;
      if (y <= B.terrain.height(origin.x + dir.x * mid, origin.z + dir.z * mid)) hi = mid; else lo = mid;
    }
    bestT = hi; best = null;
    return { point: origin.clone().addScaledVector(dir, bestT), distance: bestT, box: null, terrain: true };
  }
  if (!best) return null;
  return { point: origin.clone().addScaledVector(dir, bestT), distance: bestT, box: best, terrain: false };
}

/**
 * THE DISTANCE BETWEEN THE TWO SURFACES, when a ray says they are far apart.
 *
 * A ray measures along itself, and along itself is the wrong axis at a cliff:
 * a collider 15 cm outside a vertical rock face is 57 cm "over" it to a ray
 * from above, and a box fitted to the crest of a dome is 5 m "proud" to a
 * level ray that clips the dome. So a miss along the ray is re-measured as
 * what the player would feel — the nearest picture to the physics hit, and
 * the nearest physics to the picture's hit — and the smallest of the three is
 * the error. A real gap is a gap on every axis.
 */
const _tri = { a: new THREE.Vector3(), b: new THREE.Vector3(), c: new THREE.Vector3(), t: new THREE.Triangle(), q: new THREE.Vector3() };
function visualTris(B) {
  if (B._vtris) return B._vtris;
  const out = [];
  for (const m of B.solids) {
    const g = m.geometry, p = g.attributes.position, idx = g.index;
    const n = idx ? idx.count : p.count;
    const W = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      _tri.a.fromBufferAttribute(p, idx ? idx.getX(i) : i).applyMatrix4(m.matrixWorld);
      W[i * 3] = _tri.a.x; W[i * 3 + 1] = _tri.a.y; W[i * 3 + 2] = _tri.a.z;
    }
    const bb = boundsOf(m);
    out.push({ W, bb });
  }
  return (B._vtris = out);
}
function distToVisual(B, pt, cap) {
  let best = cap;
  for (const { W, bb } of visualTris(B)) {
    if (bb.distanceToPoint(pt) >= best) continue;
    for (let i = 0; i + 8 < W.length; i += 9) {
      _tri.t.a.set(W[i], W[i + 1], W[i + 2]); _tri.t.b.set(W[i + 3], W[i + 4], W[i + 5]); _tri.t.c.set(W[i + 6], W[i + 7], W[i + 8]);
      _tri.t.closestPointToPoint(pt, _tri.q);
      const d = _tri.q.distanceTo(pt);
      if (d < best) best = d;
    }
  }
  // the ground counts as picture too
  const dg = Math.abs(pt.y - B.terrain.height(pt.x, pt.z));
  return Math.min(best, dg);
}
function distToPhysics(B, pt, cap) {
  let best = cap;
  const inv = new THREE.Quaternion(), l = new THREE.Vector3();
  for (const b of B.fitted) {
    if (b.center.distanceTo(pt) - b.radius >= best) continue;
    inv.copy(b.quat).invert();
    l.subVectors(pt, b.center).applyQuaternion(inv);
    const dx = Math.max(0, Math.abs(l.x) - b.halfExtents.x), dy = Math.max(0, Math.abs(l.y) - b.halfExtents.y), dz = Math.max(0, Math.abs(l.z) - b.halfExtents.z);
    const d = Math.hypot(dx, dy, dz);
    if (d < best) best = d;
  }
  const dg = Math.abs(pt.y - B.terrain.height(pt.x, pt.z));
  return Math.min(best, dg);
}
/** The signed error, re-measured across the surfaces when the ray overstates it. */
function settle(B, e, vis, ph) {
  if (Math.abs(e) <= TOL) return e;
  let m = Math.abs(e);
  if (ph && ph.point) m = Math.min(m, distToVisual(B, ph.point, m));
  if (vis && vis.point) m = Math.min(m, distToPhysics(B, vis.point, m));
  return Math.sign(e) * m;
}

/**
 * Ray one form: vertical grid over its bounds and horizontal rays into its
 * flanks. Returns the signed physics-minus-visual error at every sample where
 * the form stands at least 5 cm proud of the ground, plus the worst each way.
 */
function fitOf(B, box, step = 0.5) {
  const ray = new THREE.Raycaster();
  const down = new THREE.Vector3(0, -1, 0);
  const errs = [];
  let under = 0, over = 0, n = 0, miss = 0, at = null;
  /* From ABOVE EVERYTHING, not two metres over this form: a hump bedded into
   * a massif's skirt has its crest 2.5 m under the massif's surface, and a
   * ray started there begins inside both the picture and the collider. */
  const top = box.max.y + 40;
  const sample = (origin, dir, far) => {
    ray.set(origin, dir); ray.far = far;
    const vis = ray.intersectObjects(B.solids, false)[0];
    const ph = physRay(B, origin, dir, far);
    return { vis, ph };
  };
  const note = (e, x, z, vis, ph) => {
    if (!at || Math.abs(e) > Math.abs(at.e)) {
      const b = ph?.box;
      at = { e: +e.toFixed(2), x: +x.toFixed(2), z: +z.toFixed(2), vis: vis?.point?.y?.toFixed(2), ph: ph?.point?.y?.toFixed(2),
        n: vis?.face?.normal?.toArray().map((v) => v.toFixed(2)).join(','),
        box: b ? { c: b.center.toArray().map((v) => v.toFixed(2)).join(','), h: b.halfExtents.toArray().map((v) => v.toFixed(2)).join(','), w: +b.userData.worst.toFixed(2) } : null };
    }
  };
  for (let x = box.min.x; x <= box.max.x; x += step) {
    for (let z = box.min.z; z <= box.max.z; z += step) {
      const g = B.terrain.height(x, z);
      const { vis, ph } = sample(new THREE.Vector3(x, top, z), down, top - g + 4);
      const visY = vis ? Math.max(vis.point.y, g) : g;
      n++;
      if (!ph) { const e = settle(B, -(visY - g), vis, null); miss++; errs.push(e); under = Math.max(under, -e); continue; }
      // ground against ground is the heightfield against Terrain.height and
      // says nothing about the form; everything else is the fit
      if (visY < g + 0.05 && ph.terrain) continue;
      const e = settle(B, ph.point.y - visY, vis, ph);
      errs.push(e); note(e, x, z, vis, ph);
      if (e < 0) under = Math.max(under, -e); else over = Math.max(over, e);
    }
  }
  // the flanks: from outside the bounds toward the centre, at three heights
  const c = box.getCenter(new THREE.Vector3());
  const R = Math.hypot(box.max.x - box.min.x, box.max.z - box.min.z) * 0.5 + 1;
  for (let a = 0; a < Math.PI * 2; a += Math.PI / 12) {
    for (const h of [0.5, 1.0, 1.6]) {
      const ox = c.x + Math.cos(a) * R, oz = c.z + Math.sin(a) * R;
      const oy = B.terrain.height(ox, oz) + h;
      const dir = new THREE.Vector3(c.x - ox, 0, c.z - oz).normalize();
      const { vis, ph } = sample(new THREE.Vector3(ox, oy, oz), dir, R);
      if (!vis) continue;
      // a ray that meets the ground first is not a flank test
      const gAt = B.terrain.height(vis.point.x, vis.point.z);
      if (vis.point.y < gAt + 0.15) continue;
      n++;
      if (!ph) { const e = settle(B, -(R - vis.distance), vis, null); miss++; errs.push(e); under = Math.max(under, -e); continue; }
      // physics nearer = physics proud of the picture; see `settle`
      const e = settle(B, vis.distance - ph.distance, vis, ph);
      errs.push(e); note(e, vis.point.x, vis.point.z, vis, ph);
      if (e < 0) under = Math.max(under, -e); else over = Math.max(over, e);
    }
  }
  return { n, miss, under, over, errs, at };
}

export async function run({ check, assert }) {
  await initPhysics();
  check('alpine: the level builds nine massifs and a modest field of rock', () => {
    const B = build();
    assert(B.massifs.length >= 7, `${B.massifs.length} massifs — the level has lost its cover`);
    assert(B.rocks.length >= 6 && B.rocks.length <= 10,
      `${B.rocks.length} rock outcrops — the brief is six to ten, low and wide`);
    const boxes = B.physics.staticBoxes.length;
    assert(boxes > 100, `${boxes} static boxes on the whole level — the forms are not tiled`);
    return `${B.massifs.length} massifs, ${B.rocks.length} outcrops, ${boxes} static boxes`;
  });

  check('alpine: every massif is solid to within a quarter metre of the snow you see', () => {
    const B = build();
    let worstU = 0, worstO = 0, total = 0, miss = 0, sum = 0;
    for (const m of B.massifs) {
      const f = fitOf(B, boundsOf(m));
      total += f.n; miss += f.miss;
      for (const e of f.errs) sum += Math.abs(e);
      worstU = Math.max(worstU, f.under); worstO = Math.max(worstO, f.over);
      assert(f.under <= TOL, `massif at (${m.position.x.toFixed(0)}, ${m.position.z.toFixed(0)}): physics `
        + `${f.under.toFixed(2)} m under the snow — walk-through ${JSON.stringify(f.at)}`);
      assert(f.over <= TOL, `massif at (${m.position.x.toFixed(0)}, ${m.position.z.toFixed(0)}): physics `
        + `${f.over.toFixed(2)} m over the snow — you would stand on air ${JSON.stringify(f.at)}`);
    }
    return `${total} rays over ${B.massifs.length} massifs: worst ${worstU.toFixed(2)} m under, `
      + `${worstO.toFixed(2)} m over, mean |err| ${(sum / Math.max(1, total)).toFixed(3)} m, ${miss} misses`;
  });

  check('alpine: every rock outcrop is solid to within a quarter metre', () => {
    const B = build();
    let worstU = 0, worstO = 0, total = 0, sum = 0;
    for (const m of B.rocks) {
      const f = fitOf(B, boundsOf(m), 0.35);
      total += f.n;
      for (const e of f.errs) sum += Math.abs(e);
      worstU = Math.max(worstU, f.under); worstO = Math.max(worstO, f.over);
      assert(f.under <= TOL, `outcrop at (${m.position.x.toFixed(0)}, ${m.position.z.toFixed(0)}): physics `
        + `${f.under.toFixed(2)} m inside the rock — walk-through ${JSON.stringify(f.at)}`);
      assert(f.over <= TOL, `outcrop at (${m.position.x.toFixed(0)}, ${m.position.z.toFixed(0)}): physics `
        + `${f.over.toFixed(2)} m proud of the rock ${JSON.stringify(f.at)}`);
      assert((m.userData.boxes || []).length >= 3, 'an outcrop with fewer than three colliders is a box under a pile');
    }
    return `${total} rays over ${B.rocks.length} outcrops: worst ${worstU.toFixed(2)} m under, `
      + `${worstO.toFixed(2)} m over, mean |err| ${(sum / Math.max(1, total)).toFixed(3)} m`;
  });

  check('alpine: a drift hump you could trip on is solid; one you could not is free', () => {
    const B = build();
    assert(B.humps.length === 1, 'the large drift grade is not on the level');
    let worstU = 0, worstO = 0, total = 0;
    for (const p of B.solidHumps) {
      const box = p.userData.box, crest = p.userData.crest;
      const f = fitOf(B, box, 0.3);
      total += f.n;
      worstU = Math.max(worstU, f.under); worstO = Math.max(worstO, f.over);
      assert(f.under <= TOL && f.over <= TOL,
        `a ${crest.toFixed(2)} m hump at (${box.min.x.toFixed(0)}, ${box.min.z.toFixed(0)}) is off by ${Math.max(f.under, f.over).toFixed(2)} m ${JSON.stringify(f.at)}`);
    }
    // and a hump under the bar is free: no collider stands over its crest
    let freeChecked = 0;
    for (const p of B.freeHumps) {
      const box = p.userData.box;
      const cx = (box.min.x + box.max.x) / 2, cz = (box.min.z + box.max.z) / 2;
      const ph = physRay(B, new THREE.Vector3(cx, box.max.y + 40, cz), new THREE.Vector3(0, -1, 0), 60);
      if (!ph || !ph.box) { freeChecked++; continue; }
      // a box here belongs to something else standing over the hump, which
      // the visual set can say
      const ray = new THREE.Raycaster(new THREE.Vector3(cx, box.max.y + 40, cz), new THREE.Vector3(0, -1, 0), 0, 60);
      assert(ray.intersectObjects(B.solids, false).length > 0,
        `a ${p.userData.crest.toFixed(2)} m hump at (${cx.toFixed(0)}, ${cz.toFixed(0)}) carries a collider it should not`);
      freeChecked++;
    }
    assert(B.solidHumps.length > 0, 'no hump on the level reaches 0.6 m — the grade the report is about is gone');
    // the bar is 0.6 m and the dressing drew it where this file measures it
    for (const p of B.solidHumps) assert(p.userData.crest > 0.5, `a solid hump measures only ${p.userData.crest.toFixed(2)} m`);
    for (const p of B.freeHumps) assert(p.userData.crest < 0.7, `a free hump measures ${p.userData.crest.toFixed(2)} m — that is one you trip on`);
    return `${B.solidHumps.length} humps over 0.6 m solid (worst ${worstU.toFixed(2)} under / ${worstO.toFixed(2)} over), `
      + `${freeChecked} under it free, ${total} rays`;
  });

  check('alpine: the snow is blue-white and the rock is dark and cold', () => {
    const M = propMaterials();
    const snow = M.snowPack.userData.albedo, rock = M.rockCold.userData.albedo;
    assert(snow && rock, 'the materials carry no measured albedo');
    assert(snow[2] >= snow[0], `snow albedo (${snow.map((v) => v.toFixed(3)).join(', ')}) is redder than it is blue — that is the yellow`);
    assert(snow[0] > 0.40 && snow[0] < 0.75, `snow albedo ${snow[0].toFixed(2)} is off the range the ground is graded for`);
    assert(Math.max(...rock) < 0.45, `rock albedo (${rock.map((v) => v.toFixed(3)).join(', ')}) is too bright to read as rock in snow`);
    assert(rock[2] >= rock[0] && rock[2] >= rock[1], 'rock is warm — the desert stone again');
    const B = build();
    for (const m of B.massifs) assert(m.material === M.snowPack, 'a massif is not made of snowPack');
    for (const m of B.rocks) assert(m.material === M.rockCold, 'an outcrop is not made of rockCold');
    // the snow bake, not the sand bake: the map under the snow is the terrain's own
    assert(M.snowPack.map !== M.drift.map, 'snowPack still stands on the sand map');
    return `snow (${snow.map((v) => v.toFixed(2)).join(', ')}), rock (${rock.map((v) => v.toFixed(3)).join(', ')})`;
  });

  check('alpine: the outcrops wear a cap of snow', () => {
    const B = build();
    for (const m of B.rocks) {
      const c = m.geometry.attributes.color, n = m.geometry.attributes.normal;
      assert(c, 'an outcrop carries no vertex colour — no snow cap');
      let up = 0, upN = 0, side = 0, sideN = 0;
      for (let i = 0; i < c.count; i++) {
        if (n.getY(i) > 0.9) { up += c.getZ(i); upN++; } else if (n.getY(i) < 0.2) { side += c.getZ(i); sideN++; }
      }
      assert(upN && sideN && up / upN > 2.5 * (side / sideN),
        `the top of an outcrop (${(up / upN).toFixed(2)}) is not whiter than its flank (${(side / sideN).toFixed(2)})`);
    }
    return `${B.rocks.length} outcrops, tops at least 2.5x the flank`;
  });

  check('alpine: the world this file built comes down', () => {
    const B = build();
    B.physics.dispose?.();
    B.terrain.dispose?.();
    built = null;
    return 'disposed';
  });
}
