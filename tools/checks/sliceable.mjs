/**
 * SABER — if you can walk up to it and it is the size of a crate, the blade has
 * to be able to touch it.
 *
 * Notes 9 and 57: "some objects ignore the saber entirely but can be stood on",
 * and "everything touchable must have real physics and be sliceable."
 *
 * There is no way to catch this by reading a level's dressing code. Everything
 * a level places goes through `addProp`, `addStatic` or `addDoor` and looks
 * equally solid at the call site; whether the BLADE can reach it depends on
 * whether some prop or DestructionProxy ends up offering a capsule at that
 * point, three layers down, and the answer is not visible from where the crate
 * is placed. So this measures the frame instead of the source: dress each
 * level, collect every capsule the blade solver would be offered, and ask of
 * every reachable object whether any of them is actually there.
 *
 * MEASURED THE FIRST TIME IT RAN, human-scale objects within a swing of ground
 * the player can stand on, "with a contact" / total:
 *
 *     temple      0/51      kamino    32/90     deeps      0/4
 *     foundry    58/74      warship   97/113    intake    83/95
 *     arena      49/51      mustafar  21/23     colosseum  8/10
 *
 * The Jedi Temple had FIFTY-ONE reachable objects and not one of them could be
 * cut — a hall full of furniture you can stand on and cannot touch, which is
 * precisely the note. The two rules that make the survey honest are worth
 * stating because both were wrong in earlier cuts of it:
 *
 *   · HUMAN SCALE ONLY, nothing over 3.2 m in any dimension. "Everything
 *     touchable" means the things in a room. A colonnade, a hull plate or a
 *     horizon range is not something a sword is meant to part, and their
 *     bounding boxes dominate any volume-ranked list — the first survey
 *     reported a 133,411,362 m³ offender, which is a mountain.
 *   · ASK FOR A CONTACT, not for ownership. "Is this mesh owned by a prop"
 *     gets it wrong in both directions: a DestructionProxy makes a wall
 *     cuttable without the wall being a prop, and a prop can exist with an
 *     empty `capsules()` — the Colosseum crowd is deliberately exactly that,
 *     because three thousand spectators sixty metres up a bank are scenery and
 *     putting them in the solver's list would cost three thousand capsules.
 */

import * as THREE from 'three';
import { Terrain } from '../../src/world/Terrain.js';
import { LEVELS, LEVEL_ORDER } from '../../src/game/Levels.js';

/** The world a dressing pass is happy with, recording what it is handed. */
function stubWorld(terrain) {
  const scene = new THREE.Scene();
  return {
    scene, statics: [], levelLights: [], props: [], enemies: [], doors: [], grass: null,
    physics: {
      addStaticBox(b) { this.staticBoxes.push(b); return b; }, staticBoxes: [],
      add(b) { this.bodies.push(b); return b; }, bodies: [], raycast: () => null,
    },
    addLight(l) { (this.lights ||= []).push(l); scene.add(l); return l; },
    addDoor(d) { this.doors.push(d); return d; },
    particles: { sandPuff() {}, sparkBurst() {}, slag() {} },
    notify() {}, report() {}, spawnEnemy: () => null, time: 0,
    addProp(p) { this.props.push(p); return p; },
    terrain, settings: { quality: 'medium' },
  };
}

/** Every capsule the blade solver would be offered this frame. */
function contacts(world) {
  const caps = [];
  const take = (src) => {
    let list = null;
    try { list = src.capsules?.(); } catch { list = null; }
    for (const c of list || []) if (c && c.p0 && c.p1) caps.push(c);
  };
  for (const p of world.props) take(p);
  for (const d of world.doors) take(d);
  return caps;
}

/** Does a capsule reach inside this box? Sampled along its segment. */
function reaches(box, c, p = new THREE.Vector3()) {
  for (let i = 0; i <= 6; i++) {
    p.lerpVectors(c.p0, c.p1, i / 6);
    if (box.distanceToPoint(p) <= (c.r ?? 0.2) + 0.05) return true;
  }
  return false;
}

/** One level's survey. */
function survey(key) {
  const L = LEVELS[key];
  const terrain = new Terrain(new THREE.Scene(), L.terrain, 0.5);
  const world = stubWorld(terrain);
  L.dress(world);
  const caps = contacts(world);
  world.scene.updateMatrixWorld(true);
  const box = new THREE.Box3(), v = new THREE.Vector3(), p = new THREE.Vector3();
  let total = 0, hit = 0;
  const misses = [];
  world.scene.traverse((o) => {
    if (!o.isMesh || o.isInstancedMesh) return;
    box.setFromObject(o);
    if (!isFinite(box.min.y)) return;
    box.getCenter(v);
    // on ground the player can reach, and low enough to swing at
    if (Math.hypot(v.x, v.z) > 90) return;
    const gh = terrain.height(v.x, v.z);
    if (box.min.y - gh > 2.4 || box.max.y - gh < 0.12) return;
    const ex = [box.max.x - box.min.x, box.max.y - box.min.y, box.max.z - box.min.z];
    const vol = ex[0] * ex[1] * ex[2];
    if (vol < 0.02 || Math.max(...ex) > 3.2) return;
    total++;
    if (caps.some((c) => reaches(box, c, p))) hit++;
    else misses.push([vol, v.x.toFixed(0), v.z.toFixed(0)]);
  });
  misses.sort((a, b) => b[0] - a[0]);
  return { total, hit, misses, caps: caps.length };
}

export function run({ check, assert }) {
  check('sliceable: if you can walk up to it and it is crate-sized, the blade reaches it', () => {
    /* 70%, and the bar is not 100% for a reason that is visible in the good
     * levels' numbers: a floor inlay, a lamp housing, a strip of trim and the
     * inside face of a doorway are all reachable, crate-sized meshes that no
     * sane contact model gives a capsule to. The levels that were built with
     * this in mind land at 78-96%, so 70% has room under every one of them and
     * still fails a level where nothing at all can be cut.
     *
     * Levels with fewer than eight such objects are reported and not asserted
     * on — an open snowfield with one thing in it is not evidence either way,
     * and a percentage of four is not a percentage. */
    const rows = [], bad = [];
    for (const key of LEVEL_ORDER) {
      const s = survey(key);
      if (!s.total) { rows.push(`${key} —`); continue; }
      const frac = s.hit / s.total;
      rows.push(`${key} ${s.hit}/${s.total}`);
      if (s.total < 8) continue;
      if (frac < 0.70) {
        bad.push(`${key} ${(frac * 100).toFixed(0)}% (${s.total - s.hit} of ${s.total} untouchable, `
          + `biggest ${s.misses[0][0].toFixed(1)} m³ at ${s.misses[0][1]},${s.misses[0][2]})`);
      }
    }
    assert(!bad.length,
      'objects the player can walk up to and cannot cut:\n    ' + bad.join('\n    '));
    return rows.join(', ');
  });

  check('sliceable: the survey is measuring something', () => {
    /* A survey that finds nothing to look at passes vacuously, and this one has
     * four moving parts that could each silently empty it — the reach filter,
     * the scale filter, the capsule collection and the dressing itself. So:
     * enough levels with enough objects, and capsules actually being offered. */
    let levels = 0, objects = 0, caps = 0;
    for (const key of LEVEL_ORDER) {
      const s = survey(key);
      if (s.total >= 8) levels++;
      objects += s.total;
      caps += s.caps;
    }
    assert(levels >= 6, `only ${levels} levels have enough reachable objects to measure`);
    assert(objects > 200, `only ${objects} reachable objects across the whole game`);
    assert(caps > 400, `only ${caps} blade contacts offered across every level`);
    return `${objects} reachable objects over ${levels} measurable levels, ${caps} contacts offered`;
  });
}
