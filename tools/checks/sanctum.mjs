/**
 * THE SANCTUM IS COLOSSAL, and that is a number rather than an adjective.
 *
 * The level keyed `arena` used to be an execution ground: a ring of 8.4 m wall
 * bays with 7.5 m columns in front of them, four 7.5 m arches, and a 17 m
 * toppled statue for a landmark. Measured on the dressed level, the tallest
 * object standing in it was 18.3 m and NOTHING in it reached 20 — which is a
 * town wall, and which is why the place read as a yard rather than as a temple.
 *
 * The brief that replaced it is "monumental alien ruins of a grand Jedi/Sith
 * temple — colossal broken architecture, a sense of something that was once
 * sacred and is now a killing floor". Every word of that is checkable:
 *
 *   COLOSSAL      the order is 30 m tall. A person at the foot of one column
 *                 is 6% of its height and a third of its diameter, and that
 *                 ratio is the whole of the sensation.
 *   BROKEN        a run of the peristyle has come down and taken its
 *                 entablature with it. A ruin that is uniformly intact is a
 *                 model; one that fails at random is damage; one that fails in
 *                 a RUN is a collapse, which is a history.
 *   A KILLING FLOOR  the middle of the bowl is still clear enough to duel in.
 *                 Monumentality that fills the floor is a corridor.
 *
 * And the fourth, which is the one that makes the other three affordable: it
 * cost LESS than what it replaced. Fourteen colossal columns merged one to an
 * island with their own architrave and rubble is cheaper than thirty-six wall
 * bays plus eighteen colonnade shafts, because the expensive thing was never
 * the size — it was the count of separate emits.
 *
 * These are geometric measurements of the dressed scene, not a count of calls
 * to a maker: what matters is what is standing there, and a check that counted
 * `addColumn` calls would pass on fourteen columns 3 m tall.
 */

import * as THREE from 'three';
import { Terrain } from '../../src/world/Terrain.js';
import { LEVELS } from '../../src/game/Levels.js';
import { TAU } from '../../src/engine/MathUtil.js';

/** The same world stub every dressing survey in this directory uses. */
/**
 * `level` belongs on the stub, because dressing passes read it: the cut takes
 * its water line from `world.level?.water?.level ?? 0.30` and then refuses to
 * place anything loose below that, so a survey without a level attached is
 * surveying a level the game does not ship. Measured when sliceable.mjs was
 * missing it — the deeps lost every crate and barrel on its floor, 4 reachable
 * objects where the shipped level has 48.
 */
function stubWorld(terrain, level = null) {
  const scene = new THREE.Scene();
  return {
    scene, level, statics: [], levelLights: [], props: [], enemies: [], doors: [], grass: null,
    physics: { addStaticBox() {}, staticBoxes: [], add() {}, bodies: [], raycast: () => null },
    addLight(l) { (this.lights ||= []).push(l); scene.add(l); return l; },
    addDoor(d) { this.doors.push(d); return d; },
    particles: { sandPuff() {}, sparkBurst() {}, slag() {} },
    notify() {}, report() {}, spawnEnemy: () => null,
    time: 0,
    addProp(p) { this.props.push(p); return p; },
    terrain,
    settings: { quality: 'medium' },
  };
}

let DRESSED = null;
/**
 * Dress the sanctum once and record every built mesh as
 * `{ x, z, w, top, base }` in world metres.
 *
 * `top` is measured from the TERRAIN under the piece rather than from the world
 * datum, because the bowl's own floor runs from −0.8 m at the centre to 64 m of
 * rim: a piece's absolute y says as much about where it stands as about how
 * tall it is.
 *
 * Anything over 120 m on a horizontal axis is dropped for the reason
 * `world-immersion`'s occupancy survey drops it — the ground plane and the
 * painted ranges ARE the view, not things standing in it.
 */
function sanctum() {
  if (DRESSED) return DRESSED;
  const L = LEVELS.arena;
  const terrain = new Terrain(new THREE.Scene(), L.terrain, 0.5);
  const world = stubWorld(terrain, L);
  L.dress(world);

  const built = [];
  /**
   * Every vertex of every built mesh, in world metres, as a flat [x, y, z] run.
   *
   * The bounding boxes above cannot answer "is a column standing at this
   * station", and the reason is exactly the merging this rework is built on: a
   * bay whose architrave survives is ONE mesh containing a shaft at one end and
   * a 27 m beam running off it, so its box centre sits in the middle of the bay
   * and its box is 33 m tall over ground that is empty. Asked of the boxes, a
   * fallen station next to a surviving one measures as standing.
   *
   * The vertices do not have that problem, and they are the honest question
   * anyway: what is the highest STONE within a shaft's radius of this station.
   */
  const verts = [];
  let meshes = 0, instances = 0;
  const b = new THREE.Box3(), s = new THREE.Vector3(), c = new THREE.Vector3();
  const p = new THREE.Vector3();
  world.scene.traverse((o) => {
    if (!o.isMesh || !o.geometry?.attributes?.position) return;
    meshes++;
    instances += o.isInstancedMesh ? o.count : 1;
    // an InstancedMesh is scree and rubble here; none of it is architecture
    if (o.isInstancedMesh) return;
    o.updateMatrixWorld(true);
    if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
    b.copy(o.geometry.boundingBox).applyMatrix4(o.matrixWorld);
    b.getSize(s); b.getCenter(c);
    if (s.x > 120 || s.z > 120) return;
    const g = terrain.height(c.x, c.z);
    built.push({ x: c.x, z: c.z, w: Math.max(s.x, s.z), h: s.y, top: b.max.y - g, r: Math.hypot(c.x, c.z) });
    const a = o.geometry.attributes.position;
    for (let i = 0; i < a.count; i++) {
      p.fromBufferAttribute(a, i).applyMatrix4(o.matrixWorld);
      verts.push(p.x, p.y, p.z);
    }
  });
  DRESSED = { world, terrain, built, verts, meshes, instances };
  return DRESSED;
}

/** The highest stone within `r` metres of (x, z), measured off the ground there. */
function crestAt(D, x, z, r) {
  const { verts, terrain } = D;
  const r2 = r * r;
  let top = -Infinity;
  for (let i = 0; i < verts.length; i += 3) {
    const dx = verts[i] - x, dz = verts[i + 2] - z;
    if (dx * dx + dz * dz > r2) continue;
    if (verts[i + 1] > top) top = verts[i + 1];
  }
  return top === -Infinity ? 0 : top - terrain.height(x, z);
}

export function run({ check, assert }) {
  check('sanctum: the order is colossal, and it is what you see from the floor', () => {
    const { built } = sanctum();
    // the precinct, i.e. everything inside the bowl and its wall
    const inside = built.filter((p) => p.r <= 96);
    const tall = inside.filter((p) => p.top >= 24).sort((a, b) => b.top - a.top);
    const tallest = tall.length ? tall[0].top : 0;

    /* 30 m, not 20. The order is authored at 30 m and its capital and
     * architrave carry it past 33; the gates reach 36. A threshold at 20 would
     * be met by a single 21 m spire, which is a landmark and not an ORDER — the
     * count is the half of this that says "colossal" rather than "tall". */
    assert(tallest >= 30, `the tallest thing standing in the sanctum is ${tallest.toFixed(1)} m`);
    assert(tall.length >= 12,
      `only ${tall.length} pieces of the sanctum reach 24 m — a temple is an ORDER, not one spire`);

    /* And they are SLENDER. A 30 m mass 40 m wide is a mesa; a 30 m mass 8 m
     * wide is a column, and the difference is the whole reason the eye reads
     * height. At least eight of them have to be shafts. */
    const shafts = tall.filter((p) => p.w <= 12);
    assert(shafts.length >= 8,
      `only ${shafts.length} of the sanctum's colossal pieces are slender enough to read as shafts`);
    return `${tall.length} pieces over 24 m (${shafts.length} of them shafts under 12 m wide), tallest ${tallest.toFixed(1)} m`;
  });

  check('sanctum: the peristyle is a ruin — it failed in a run, not at random', () => {
    const D = sanctum();
    /* The fourteen bays of the order, at the radius the level places them.
     * Asked of the STONE rather than of the source: what is being tested is
     * whether a column is standing at each station, and the highest vertex
     * inside a 4 m column of air over that station is exactly that question —
     * 4 m because the shaft is 2.3 m in radius at its base and the plinth is
     * wider than the shaft. */
    const R = 62, N = 16;
    const bay = 2 * Math.sin(Math.PI / N) * R;
    const standing = [];
    for (let i = 0; i < N; i++) {
      const a = (i / N) * TAU;
      standing.push(crestAt(D, Math.cos(a) * R, Math.sin(a) * R, 4));
    }
    /* 19 m, and the number is measured rather than picked. The sixteen
     * stations fall into three populations with clear water between them:
     *
     *   29.8 – 34.1 m   a column standing, with or without its entablature
     *   20.7 – 21.0 m   a gate: a 17 m opening under a 22 m entablature
     *   14.3 – 17.4 m   a column DOWN — `standing` 0.30-0.50 of a 30 m shaft
     *                   leaves a 9-15 m stump with its reinforcement bursting
     *                   out of the break
     *
     * So anything over 19 m is a bay whose member is still up, and the gap
     * either side of that line is 1.6 m and 1.7 m. A threshold of 24 was tried
     * first and it counted every GATE as a fallen bay, which measured the level
     * as half rubble. */
    const UP = 19;
    const up = standing.filter((h) => h >= UP).length;
    const down = standing.filter((h) => h < UP).length;
    assert(up + down === N, `the peristyle has ${up + down} stations, not ${N}`);
    /* Between a fifth and a half. Nothing down is a model of a temple; half of
     * it down is a rubble field with some columns in it, and the fight needs
     * the order intact enough to be fought between. */
    assert(down >= 3 && down <= 7,
      `${down} of ${N} bays are down — a ruin fails in a run, and this is ${down < 3 ? 'a model' : 'a rubble field'}`);
    /* …and CONSECUTIVELY. A collapse propagates along a colonnade because each
     * arch pushes on the next; four bays picked independently at random is
     * damage from fourteen unrelated events. */
    let longest = 0, runLen = 0;
    for (let i = 0; i < N * 2; i++) {
      if (standing[i % N] < UP) { runLen++; if (runLen > longest) longest = runLen; }
      else runLen = 0;
    }
    assert(longest >= 3, `the longest run of fallen bays is ${longest} — that is damage, not a collapse`);
    return `${up} of ${N} bays standing, ${down} down in a longest run of ${longest}; ` +
      `bay ${bay.toFixed(1)} m at R ${R}`;
  });

  check('sanctum: the middle of the killing floor still belongs to the duel', () => {
    const { built, meshes, instances } = sanctum();
    /* Nothing over waist height inside 8 m of the centre. The altar stands at
     * (8, −7) — r = 10.6 — precisely so that the one place two blades meet is
     * not inside a building. */
    const inMiddle = built.filter((p) => p.r < 8 && p.h > 1.0);
    assert(!inMiddle.length,
      `${inMiddle.length} piece(s) of architecture stand in the middle 8 m of the floor`);

    /* And the whole of it cost less than the town wall it replaced. Measured
     * before this rework: 411 draw calls for 4609 instances, with the tallest
     * thing in the level standing 18.3 m. `world-immersion` caps a level at
     * 520; the point of pinning the OLD number here is that monumentality was
     * paid for by merging, not by spending. */
    assert(meshes <= 411,
      `the sanctum dresses itself in ${meshes} draw calls, more than the ${411} the execution ground cost`);
    assert(instances / meshes > 5,
      `${(instances / meshes).toFixed(1)} objects per draw call — the loose grades are not instanced`);
    return `${meshes} draw calls (was 411), ${instances} objects, ${(instances / meshes).toFixed(1)}:1; ` +
      `middle 8 m clear`;
  });
}
