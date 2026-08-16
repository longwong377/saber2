/**
 * WHAT EVERY BODY ON THE ROSTER LOOKS LIKE AT THIRTY METRES — as numbers.
 *
 *   node --import ./tools/register.mjs tools/_roster.mjs
 *   node --import ./tools/register.mjs tools/_roster.mjs --family humanoid
 *
 * `tools/_creature.mjs` answered "all your monsters look the same, sphere with
 * some legs" for the MENAGERIE and stopped there. It measures four creatures
 * out of a roster of thirty-one, and the thing it proved — that a silhouette
 * rasterised into one shared world frame is a number you can hold a body to —
 * had never been pointed at the other twenty-seven.
 *
 * Pointed at them, it says the complaint was never about creatures alone: at
 * LOD 1 the nineteen HUMANOIDS were a hundred pairs above 0.50 flank IoU, two
 * of them at 1.000 — the same builder called twice with the same arguments.
 *
 * WHAT IS MEASURED, AND WHY EACH PIECE IS THE SHIPPED ONE RATHER THAN A COPY:
 *
 *   the body      a real `Enemy`, so `_build` runs, the weapon goes in the
 *                 hand and the archetype's own scale applies.
 *   the pose      `Enemy._pose`, i.e. the real BipedAnimator/`_poseWalker`.
 *                 The bind pose is a different figure — _creature.mjs measured
 *                 a reek and a gundark 59% alike in bind and 27% once the gait
 *                 had planted their feet.
 *   the LOD       `Enemy._applyLod(1)`, the shipped cull, so what is rasterised
 *                 is exactly the mesh set a player sees past thirty metres.
 *                 Restating that rule here is how a probe manufactures a
 *                 defect (HANDOFF 2.4); it is called instead.
 *   the family    `Enemy.humanoid`, which `_build` sets from `A.custom`. Also
 *                 the shipped rule rather than a list of names kept beside it.
 *
 *   IoU           flank silhouettes rasterised into ONE absolute frame per
 *                 family, feet on the floor, at the same metres per pixel — so
 *                 a 1.06-scale heavy and a 1.00 trooper are not normalised into
 *                 agreement. The flank is the view a firing line is read from
 *                 and it is the one that carries a pack, a kama and a pauldron.
 *   kept          meshes surviving the cull / meshes built. 19 of 19 for every
 *                 humanoid on the roster before this pass — literally the same
 *                 nineteen tubes — against 27-31 of 31-37 for a creature.
 *   accent        the share of the body's triangles wearing the archetype's
 *                 rank colour that SURVIVES the cull. Six trooper archetypes
 *                 carried 340 triangles of unit paint each and none of it was
 *                 drawn past thirty metres.
 */
import './dom-shim.mjs';
import * as THREE from 'three';
import { initPhysics } from '../src/physics/Rapier.js';
import { RapierWorld } from '../src/physics/RapierWorld.js';
import { Enemy, enemyRng, ARCHETYPES } from '../src/game/Enemy.js';
import { bodyOptsFor } from '../src/game/Bodies.js';
import '../src/game/Levels.js';          // registers the Command units and the IG general

await initPhysics();

/* ── a field to stand them in ─────────────────────────────────────────── */

const physics = new RapierWorld({ gravity: -24, iterations: 4, maxBodies: 64 });
const terrain = {
  height: () => 0, normalAt: (x, z, o) => o.set(0, 1, 0), raycast: () => null,
  size: 400, half: 200, inBounds: () => true, surfaceAt: () => 'sand',
  crater() {}, flush() {}, slopeAt: () => 0,
};
physics.terrain = terrain;
const particles = { sandPuff() {}, sparkBurst() {}, cutFlare() {}, slag() {}, plasma: { spawn() {} } };
const world = {
  scene: new THREE.Scene(), physics, terrain, statics: [], settings: { fov: 60 },
  players: [], enemies: [], props: [], particles, time: 0, groundColor: 0xcfae82,
  bolts: { fire() {} }, engine: { flash() {}, camera: new THREE.PerspectiveCamera() },
  report() {}, notify() {}, notifyFloating() {}, addHitstop() {},
};
const ctx = { enemies: [], particles, terrain, physics, bolts: world.bolts, time: 0,
  pickTarget: () => null, camera: world.engine.camera };

/* ── the raster ───────────────────────────────────────────────────────── */

/**
 * Flank silhouette into a fixed world frame, feet on the bottom edge.
 *
 * `visible === false` is honoured because that is the whole point: the LOD sets
 * it, and a raster that ignored it would measure the close-up model and call
 * the roster distinct on detail nobody at thirty metres can see.
 */
export function silhouette(root, W, H, frame) {
  const [u0, u1, v0, v1] = frame;
  const bits = new Uint8Array(W * H);
  const sx = (W - 1) / (u1 - u0), sy = (H - 1) / (v1 - v0);
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  root.traverse((o) => {
    if (o.visible === false) return;
    if (!o.isMesh || !o.geometry?.attributes?.position) return;
    const g = o.geometry, p = g.attributes.position, idx = g.index;
    const n = idx ? idx.count : p.count;
    for (let i = 0; i < n; i += 3) {
      const i0 = idx ? idx.getX(i) : i, i1 = idx ? idx.getX(i + 1) : i + 1, i2 = idx ? idx.getX(i + 2) : i + 2;
      a.fromBufferAttribute(p, i0).applyMatrix4(o.matrixWorld);
      b.fromBufferAttribute(p, i1).applyMatrix4(o.matrixWorld);
      c.fromBufferAttribute(p, i2).applyMatrix4(o.matrixWorld);
      const P = [a, b, c].map((q) => [(q.x - u0) * sx, (v1 - q.y) * sy]);
      const x0 = Math.max(0, Math.floor(Math.min(P[0][0], P[1][0], P[2][0])));
      const x1 = Math.min(W - 1, Math.ceil(Math.max(P[0][0], P[1][0], P[2][0])));
      const y0 = Math.max(0, Math.floor(Math.min(P[0][1], P[1][1], P[2][1])));
      const y1 = Math.min(H - 1, Math.ceil(Math.max(P[0][1], P[1][1], P[2][1])));
      const d0 = (P[1][0] - P[0][0]) * (P[2][1] - P[0][1]) - (P[2][0] - P[0][0]) * (P[1][1] - P[0][1]);
      if (Math.abs(d0) < 1e-12) continue;
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
        const px = x + 0.5, py = y + 0.5;
        const w0 = ((P[1][0] - px) * (P[2][1] - py) - (P[2][0] - px) * (P[1][1] - py)) / d0;
        const w1 = ((P[2][0] - px) * (P[0][1] - py) - (P[0][0] - px) * (P[2][1] - py)) / d0;
        if (w0 >= -1e-6 && w1 >= -1e-6 && 1 - w0 - w1 >= -1e-6) bits[y * W + x] = 1;
      }
    }
  });
  return bits;
}

export function iou(a, b) {
  let inter = 0, uni = 0;
  for (let i = 0; i < a.length; i++) { if (a[i] || b[i]) uni++; if (a[i] && b[i]) inter++; }
  return uni ? inter / uni : 0;
}

/* ── one body, built, posed and culled the way the game does it ───────── */

const triCount = (g) => (g.index ? g.index.count : g.attributes.position.count) / 3;

/**
 * @param type   archetype key
 * @param lod    0 (close) or 1 (past thirty metres)
 * @returns everything a silhouette needs plus the census the tables print
 */
export function poseOne(type, lod = 1, seed = 99, wired = false) {
  enemyRng.seed(seed);
  /**
   * `--wired` IS THE ONE LINE THAT IS NOT IN Enemy.js YET, AND NOTHING MORE.
   *
   * `Bodies.BODY_KITS` says what each archetype wears; `Enemy._build` builds
   * every body with `{ scale: A.scale }` and never asks. This wraps the
   * archetype's own `build` for the duration of one pose so the two numbers —
   * what the game renders today, and what it renders once `_build` threads
   * `bodyOptsFor(this.type)` — can be printed side by side instead of one of
   * them being a claim. It is a PROBE doing this and not a check: a check that
   * monkey-patched the roster would be measuring itself (HANDOFF 2.4).
   */
  const A = ARCHETYPES[type];
  const restore = wired && bodyOptsFor(type) ? A.build : null;
  if (restore) A.build = (o) => restore({ ...o, ...bodyOptsFor(type) });
  const e = new Enemy(world, type, new THREE.Vector3(0, 0, 0));
  if (restore) A.build = restore;
  e.position.set(0, 0, 0);
  /* Facing +X, so a raster looking down -Z sees the FLANK. Head-on, every
   * humanoid in the game is "a vertical thing with a head on it" and the
   * measurement says nothing; the flank is where a pack, a kama, a pauldron,
   * a rangefinder and a slung weapon live. */
  e.facing = Math.PI / 2;
  e.walkPhase = 0.12;
  e.state = 'approach';
  e.grounded = true;
  e.lod = 0;
  // settle the gait — the animator smooths toward its target over several frames
  for (let i = 0; i < 24; i++) e._pose(1 / 60, ctx);
  e.lod = lod;
  e._applyLod(lod);
  const root = e.rig ? e.rig.root : e.group;
  root.updateMatrixWorld(true);

  let tris = 0, meshes = 0, keptTris = 0, kept = 0;
  const box = new THREE.Box3();
  root.traverse((o) => {
    if (!o.isMesh || !o.geometry) return;
    meshes++;
    const t = triCount(o.geometry);
    tris += t;
    if (o.visible !== false) { kept++; keptTris += t; box.expandByObject(o); }
  });
  root.position.y -= box.min.y;                // one ground line for everybody
  root.updateMatrixWorld(true);
  return { e, root, box, tris, meshes, kept, keptTris,
    humanoid: e.humanoid === true, size: box.getSize(new THREE.Vector3()) };
}

/**
 * Triangle-weighted colour spread of what SURVIVES the cull.
 *
 * The rank accent is 3.7% of a trooper's triangles and 0% of what is drawn at
 * thirty metres, which is why `trooper↔heavy` measured 0.000 apart in visible
 * colour while the two archetypes are painted white and gunmetal. Weighted by
 * triangles because a 4-triangle chip is not a paint job.
 */
export function visibleColour(root) {
  let r = 0, g = 0, b = 0, n = 0;
  const seen = new Map();
  root.traverse((o) => {
    if (o.visible === false || !o.isMesh || !o.geometry || !o.material?.color) return;
    const t = triCount(o.geometry);
    const c = o.material.color;
    const mean = o.material.userData?.mapMean || [1, 1, 1];
    r += c.r * mean[0] * t; g += c.g * mean[1] * t; b += c.b * mean[2] * t; n += t;
    const key = o.material.uuid;
    seen.set(key, (seen.get(key) || 0) + t);
  });
  return { rgb: n ? [r / n, g / n, b / n] : [0, 0, 0], tris: n, materials: seen.size };
}
export const colourDist = (a, b) =>
  Math.hypot(a.rgb[0] - b.rgb[0], a.rgb[1] - b.rgb[1], a.rgb[2] - b.rgb[2]);

/* ══════════════════════════════════════════════════════════════════════ */
/*  the report                                                            */
/* ══════════════════════════════════════════════════════════════════════ */

if (import.meta.url === `file://${process.argv[1]}`) {
  const only = process.argv.includes('--family')
    ? process.argv[process.argv.indexOf('--family') + 1] : null;
  const lod = process.argv.includes('--lod')
    ? Number(process.argv[process.argv.indexOf('--lod') + 1]) : 1;

  const wired = process.argv.includes('--wired');
  const rows = [];
  for (const type of Object.keys(ARCHETYPES)) {
    const u = poseOne(type, lod, 99, wired);
    const family = u.humanoid ? 'humanoid' : (ARCHETYPES[type].custom === 'beast' ? 'creature' : 'machine');
    rows.push({ type, family, u, colour: visibleColour(u.root) });
  }

  const FAMILIES = ['humanoid', 'machine', 'creature'];
  /* Metres across, and pixels across, per family. Humanoids get 1.3 cm/px —
   * fine enough that a 3 cm rangefinder stalk is three pixels and coarse
   * enough that the raster is not measuring tessellation. */
  const FRAME = { humanoid: 2.6, machine: 14, creature: 11 };
  const RES = { humanoid: 200, machine: 160, creature: 160 };
  for (const fam of FAMILIES) {
    const mine = rows.filter((r) => r.family === fam && (!only || only === fam));
    if (!mine.length) continue;
    /* THE FRAME IS A CONSTANT, and it has to be.
     *
     * The first version sized it off the family's own tallest member, which is
     * a confound of exactly the kind HANDOFF 2.5 is about: adding a banner to
     * one droid grew the frame 12%, dropped every body's pixel count, and
     * raised EVERY pair's IoU — so a change that made two bodies more distinct
     * printed as the whole roster getting more alike. Two runs are only
     * comparable at the same metres per pixel. Asserted below rather than
     * assumed, because a body that outgrows the frame is silently cropped. */
    const span = FRAME[fam], N = RES[fam], frame = [-span / 2, span / 2, 0, span];
    for (const r of mine) {
      if (r.u.size.y > span || r.u.size.x > span) {
        console.log(`  !! ${r.type} is ${r.u.size.y.toFixed(2)}×${r.u.size.x.toFixed(2)} m `
          + `and the ${fam} frame is ${span} m — raise FRAME.${fam}`);
      }
    }
    for (const r of mine) r.bits = silhouette(r.u.root, N, N, frame);

    const pairs = [];
    for (let i = 0; i < mine.length; i++) for (let j = i + 1; j < mine.length; j++) {
      pairs.push({ a: mine[i], b: mine[j], v: iou(mine[i].bits, mine[j].bits) });
    }
    pairs.sort((p, q) => q.v - p.v);

    console.log(`\n── ${fam.toUpperCase()} — ${mine.length} archetypes, `
      + `${span.toFixed(2)} m frame at ${N}px, LOD ${lod}`
      + `${wired ? ', KITS WIRED' : ', as shipped'} ──`);
    console.log('archetype    tris  mesh  kept   H     W    worstIoU   with');
    for (const r of mine) {
      let mx = 0, mxWith = '';
      for (const o of mine) {
        if (o === r) continue;
        const v = iou(r.bits, o.bits);
        if (v > mx) { mx = v; mxWith = o.type; }
      }
      r.worst = mx;
      console.log(`${r.type.padEnd(10)} ${String(Math.round(r.u.tris)).padStart(6)} `
        + `${String(r.u.meshes).padStart(4)} ${String(r.u.kept).padStart(5)}  `
        + `${r.u.size.y.toFixed(2)} ${r.u.size.x.toFixed(2)}    `
        + `${mx.toFixed(3)}   ${mxWith}`);
    }
    const over = pairs.filter((p) => p.v > 0.50);
    console.log(`  pairs over 0.50: ${over.length} of ${pairs.length}`);
    console.log('  worst: ' + pairs.slice(0, 12).map((p) => `${p.a.type}/${p.b.type} ${p.v.toFixed(3)}`).join(' · '));

    if (fam === 'humanoid') {
      const cd = [];
      for (let i = 0; i < mine.length; i++) for (let j = i + 1; j < mine.length; j++) {
        cd.push({ a: mine[i].type, b: mine[j].type, d: colourDist(mine[i].colour, mine[j].colour) });
      }
      cd.sort((p, q) => p.d - q.d);
      console.log('  closest visible colour: '
        + cd.slice(0, 8).map((p) => `${p.a}↔${p.b} ${p.d.toFixed(3)}`).join(' · '));
    }
  }
}
