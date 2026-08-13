/**
 * The world you stand in: how full it is, how it moves, and how far it goes.
 *
 * Everything pinned here was measured, because every one of these read as
 * perfectly reasonable in the source:
 *
 *   · a third to a half of every outdoor level was ground the player could
 *     walk across with nothing within twelve metres of them. Measured on a 3 m
 *     grid over the walkable r = 90 m disc: dunes 55.0%, canyon 37.4%, arena
 *     33.3%. Nothing about the dressing code looked sparse — it places wrecks,
 *     colonnades, outposts and rock — because all of it was aimed at the
 *     fight, and the fight is the inner forty metres;
 *   · the wind's only spatial scale had fronts 114 m apart, and the grass ring
 *     is 46 m across. Less than half a wavelength is ever on screen, so the
 *     whole field leaned one way and then the other together. That is a slider
 *     being moved, not wind crossing a meadow, and no amount of per-blade
 *     noise fixes it — per-blade noise is the OPPOSITE of the fix;
 *   · the weather was a particle count. A dust field at a fixed density is
 *     identical in the first second and the ten-thousandth, so the eye files it
 *     as texture and stops seeing it;
 *   · the only thing at distance was painted on a dome at infinity, so it did
 *     not move when the player did, and the terrain visibly stopped.
 *
 * None of those throw. They are what makes a level read as a diorama.
 */

import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { Terrain } from '../../src/world/Terrain.js';
import { LEVELS, LEVEL_ORDER } from '../../src/game/Levels.js';
import {
  WindField, wind, weather, Weather, WIND_GLSL, STORM_GLSL, Atmosphere, addHorizon, ground,
  GrassField, windSettings, WIND_DEFAULTS,
} from '../../src/world/Scenery.js';
import { skyRadiance, skyShoulder, skyDisplayShoulder, sunDirection } from '../../src/engine/Engine.js';
import { SkyDome } from '../../src/engine/SkyDome.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);

/** The levels with open ground and a sun on it. */
const OUTDOOR_LEVELS = ['dunes', 'arena', 'canyon'];

/** Vertex rows per column in a horizon ring: deep root, grade, crest. The row
 *  at grade is what lets the visible band converge on the sky it actually
 *  stands against rather than on the sky over the summit. */
const ROWS = 3;

/* ── a world stub the dressing passes are happy with ─────────────────── */
function stubWorld(terrain) {
  const scene = new THREE.Scene();
  return {
    scene, statics: [], levelLights: [], props: [], enemies: [], doors: [], grass: null,
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

/**
 * Every mesh that reached the scene, as [x, z, horizontal radius]. Instanced
 * meshes are expanded — the whole point of them is that they are hundreds of
 * separate objects, and counting one InstancedMesh as one thing is exactly how
 * a level full of scree measures as empty.
 */
function occupancy(world) {
  const out = [];
  const b = new THREE.Box3(), s = new THREE.Vector3(), c = new THREE.Vector3();
  const m = new THREE.Matrix4(), t = new THREE.Vector3();
  const q = new THREE.Quaternion(), sc = new THREE.Vector3();
  const take = (o) => {
    if (!o.isMesh || !o.geometry || !o.geometry.attributes || !o.geometry.attributes.position) return;
    o.updateMatrixWorld(true);
    if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
    if (o.isInstancedMesh) {
      o.geometry.boundingBox.getSize(s);
      for (let i = 0; i < o.count; i++) {
        o.getMatrixAt(i, m); m.decompose(t, q, sc);
        t.applyMatrix4(o.matrixWorld);
        const r = Math.max(s.x * sc.x, s.z * sc.z) * 0.5;
        if (isFinite(t.x) && isFinite(t.z)) out.push([t.x, t.z, Math.max(0.05, r)]);
      }
    } else {
      b.copy(o.geometry.boundingBox).applyMatrix4(o.matrixWorld);
      b.getSize(s); b.getCenter(c);
      // The ground plane and the horizon curtains ARE the view; they are not
      // things standing in it, and counting them would make every sample pass.
      if (s.x > 120 || s.z > 120) return;
      if (isFinite(c.x) && isFinite(c.z)) out.push([c.x, c.z, Math.max(0.05, Math.max(s.x, s.z) * 0.5)]);
    }
  };
  world.scene.traverse(take);
  for (const p of world.props) { if (p.mesh) (p.mesh.traverse ? p.mesh.traverse(take) : take(p.mesh)); }
  return out;
}

function nearestGap(occ, x, z, minR) {
  let best = Infinity;
  for (let i = 0; i < occ.length; i++) {
    if (occ[i][2] < minR) continue;
    const dx = occ[i][0] - x, dz = occ[i][1] - z;
    const d = Math.sqrt(dx * dx + dz * dz) - occ[i][2];
    if (d < best) best = d;
  }
  return best < 0 ? 0 : best;
}

let FILL = null;
/** The barrenness survey, run once and shared by the checks below. */
function fill() {
  if (FILL) return FILL;
  FILL = new Map();
  for (const key of LEVEL_ORDER) {
    const L = LEVELS[key];
    /* The dojo is skipped, and the reason matters: it is a walled octagonal
     * hall 22 m across that the player cannot leave, so surveying a 90 m disc
     * around it measures 78% "barren" ground nobody can ever reach. The metric
     * is only meaningful where the walkable area and the survey area are the
     * same thing. The hangar is also an interior and is NOT skipped — its bay
     * is 92 m across, so the survey is measuring real floor. */
    if (!L || typeof L.dress !== 'function' || L.training) continue;
    const terrain = new Terrain(new THREE.Scene(), L.terrain, 0.5);
    const world = stubWorld(terrain);
    /* GROUND COVER COUNTS, and it is the level's OWN field rather than a
     * restatement of it — built through the real constructor with the real
     * arguments the World passes, BEFORE dress(), in the order World.loadLevel
     * uses. The order is load-bearing now: the stone drifts bias themselves
     * away from the cover, so a survey that dressed first would be measuring a
     * layout the game never produces. */
    const grass = L.grass
      ? new GrassField(new THREE.Scene(), terrain, { count: 11000, density: L.grass, radius: 46 })
      : null;
    L.dress(world);
    const occ = occupancy(world);
    /* ── GROUND COVER, AND WHAT COUNTS AS IT ──────────────────────────
     *
     * This used to be `grass.cover.at()` or zero, which was correct while
     * every outdoor level had a grass field and became a false question the
     * moment four of them stopped: "the tundra/ice maps must have NO GRASS AT
     * ALL… the dune sea must have no grass either." A snowfield with no
     * tussock in it is not barren ground, and scoring it zero would have made
     * this check demand the exact thing the level was asked to remove.
     *
     * So cover is now COVER APPROPRIATE TO THE SURFACE, and the two halves are
     * held to the same standard — ground you are IN rather than ground you are
     * standing on top of:
     *
     *   a growing medium   the level's own field, exactly as before;
     *   snow or sand       the LOOSE LAYER, from Terrain.mantleAt, at least
     *                      ankle deep and not bare rock. That is a real
     *                      measurement off the same landform channels the
     *                      material shades itself with — deep in the lee
     *                      hollows, stripped on the scoured crests, absent on
     *                      anything steep enough to slough — and on the alpine
     *                      preset it spans 0.10 m to 0.95 m, which is the
     *                      ankle-to-waist the level was asked for.
     *
     * A deck plate is neither and scores zero, which is right: the hangar has
     * always had to answer this on its objects alone, and it does.
     */
    const ANKLE = 0.12;
    const slopeK = (x, z) => Math.max(0, Math.min(1, (0.30 - terrain.slopeAt(x, z)) / 0.22));
    const coverAt = grass
      ? (x, z) => grass.cover.at(x, z) * slopeK(x, z)
      : (x, z) => {
        const m = terrain.mantleAt ? terrain.mantleAt(x, z) : 0;
        if (m < ANKLE) return 0;
        const rock = terrain.preset.rockAt(x, z, terrain.slopeAt(x, z));
        return rock > 0.5 ? 0 : slopeK(x, z);
      };
    const R = 90, step = 4;
    let total = 0, footBad = 0, silBad = 0, objBad = 0, covered = 0;
    const foot = [];
    for (let z = -R; z <= R; z += step) {
      for (let x = -R; x <= R; x += step) {
        if (x * x + z * z > R * R) continue;
        if (!terrain.inBounds(x, z, 6)) continue;
        if (terrain.slopeAt(x, z) > 0.55) continue;      // not ground you can stand on
        total++;
        const f = nearestGap(occ, x, z, 0.35);
        foot.push(f);
        const cov = coverAt(x, z);
        if (cov > 0.5) covered++;
        if (f > 12) objBad++;
        if (f > 12 && cov <= 0.5) footBad++;
        if (nearestGap(occ, x, z, 1.20) > 25) silBad++;
      }
    }
    foot.sort((a, b) => a - b);
    grass?.dispose();
    let meshes = 0;
    world.scene.traverse((o) => { if (o.isMesh && o.geometry) meshes++; });
    for (const p of world.props) { if (p.mesh) p.mesh.traverse((o) => { if (o.isMesh && o.geometry) meshes++; }); }
    FILL.set(key, {
      samples: total, objects: occ.length, meshes,
      foot: footBad / total, objFoot: objBad / total, cover: covered / total,
      sil: silBad / total, hasGrass: !!L.grass,
      /** What the cover is MADE OF, so the bars below can be per surface. */
      kind: L.grass ? 'field' : (terrain.preset.loose && terrain.preset.loose.depth >= ANKLE
        ? 'loose' : 'hard'),
      mantle: terrain.preset.loose ? terrain.preset.loose.depth : 0,
      p50: foot[(foot.length * 0.5) | 0], p95: foot[(foot.length * 0.95) | 0],
    });
    terrain.dispose();
  }
  return FILL;
}

export function run({ check, assert, near }) {

  /* ══ nowhere barren ══════════════════════════════════════════════════ */

  check('levels: nowhere you can stand has nothing in reach', () => {
    /* THE measurement this whole workstream exists for. On a 4 m grid over the
     * walkable r = 90 m disc, how much of the ground has nothing with a
     * silhouette within twelve metres of it?
     *
     * Before:  dunes 55.0%   arena 33.3%   canyon 37.4%   hangar 1.4%
     *
     * A third to a half of three levels. The dressing code did not look sparse
     * — it builds a colonnade, an outpost, three wrecks, a rock arch — but all
     * of it aims at the inner forty metres, and past that the levels were bare
     * heightfield. The gate is 0.35 m because that is about the smallest thing
     * that reads as an object rather than as ground texture.
     *
     * WHAT CHANGED, and why this is the stronger form of the same property.
     * The first answer to that 55% was a uniform spray of 1,200-2,000 pebbles
     * of 20-95 cm over a 108-165 m disc. It moved this number to 4.6% and it
     * was the wrong answer: a landscape filled with isolated small objects is
     * the opposite of ground cover, and the level it produced was described as
     * "a jumbled mess with just little objects everywhere". The scatter is a
     * clustered one now, with real drifts and real clearings — Clark–Evans
     * 0.89/0.82/0.80 before, 0.59/0.48/0.46 after — and a clearing IS empty by
     * construction, which put the object-only figure back to 23% on the dunes.
     *
     * So the question this asks is now the question it was always a proxy for.
     * "Something in reach" is an object within 12 m OR ground you are standing
     * in — real knee-high cover, from the level's own field, the same field
     * the terrain paints itself with, reaching 400 m rather than 46. That is
     * strictly MORE than the old bar demanded, because it also requires the
     * cover to exist: every outdoor level has to clear a stated fraction of it
     * below, and no amount of gravel can fake that. Both figures are reported,
     * so the pebble-spray number cannot regress unnoticed. */
    const rows = [];
    for (const [key, f] of fill()) {
      assert(f.samples > 900, `${key}: only ${f.samples} walkable samples to survey`);
      assert(f.foot < 0.10,
        `${key}: ${(f.foot * 100).toFixed(1)}% of the walkable ground has neither an object within 12 m nor cover on it`);
      // and where there is no cover at all, the old bar stands unchanged
      if (f.kind === 'hard') {
        assert(f.p50 < 6.5, `${key}: the median gap to the nearest object is ${f.p50.toFixed(1)} m`);
      }
      rows.push(`${key} ${(f.foot * 100).toFixed(1)}% (objects alone ${(f.objFoot * 100).toFixed(1)}%, `
        + `cover ${(f.cover * 100).toFixed(0)}%) p50 ${f.p50.toFixed(1)}m`);
    }
    assert(rows.length >= 4, `only ${rows.length} levels surveyed`);
    return rows.join(', ');
  });

  check('levels: an outdoor level is covered ground, not a bare plate with things on it', () => {
    /* The half of "nowhere barren" that gravel cannot answer, and the player's
     * complaint stated as a number: "rather than having you play on an entire
     * field of grass all you did was add a couple patches here and there."
     *
     * Measured on the shipped build, the grass was a 46 m bubble — 2.1% of the
     * dune sea's 313,600 m² of terrain, 3.1% of the arena's — and 12-18% of
     * the 3 m cells inside the walkable disc held any grass at all. Beyond
     * 46 m there was none, at any quality, on levels you can see 700 m across.
     *
     * The bar is on the walkable disc because that is the ground the player
     * judges, and it is deliberately well under 100%: a field with no
     * clearings is as false as one with no field. */
    /* RE-DERIVED, and it is a stronger statement than the one it replaces.
     *
     * The old form asked "does this level have a grass field, and is it
     * between 35% and 98%", and skipped anything without one — so a level
     * could pass by having no ground cover at all as long as it also had no
     * grass. It survived only because every outdoor level had grass. Four no
     * longer do, by request, so the question becomes what it should always
     * have been: EVERY outdoor level must carry cover appropriate to what its
     * ground is made of, and no level is exempt.
     *
     * The two bars are deliberately different, because the two materials are:
     *
     *   a field   35%–98%. A meadow has bare crowns and worn tracks; a field
     *             with no clearings in it is a carpet.
     *   loose     70% and NO ceiling. Snow and sand do not come in clearings —
     *             the erg is sand from edge to edge and that is the level's own
     *             blurb — so the honest bar here is that most of the walkable
     *             ground is material you are IN, and the ceiling that keeps a
     *             meadow honest would be a lie about a desert. The floor is
     *             twice the field's because it is a much easier thing to be.
     */
    const rows = [];
    let covered = 0;
    for (const [key, f] of fill()) {
      if (f.kind === 'hard') {
        assert(f.cover === 0,
          `${key}: a deck plate is scoring ${(f.cover * 100).toFixed(0)}% ground cover`);
        rows.push(`${key} — (hard)`);
        continue;
      }
      covered++;
      if (f.kind === 'field') {
        assert(f.cover > 0.35,
          `${key}: only ${(f.cover * 100).toFixed(0)}% of the walkable ground carries ground cover`);
        assert(f.cover < 0.98,
          `${key}: ${(f.cover * 100).toFixed(0)}% covered — a field with no clearings in it is a carpet`);
      } else {
        assert(f.cover > 0.70,
          `${key}: only ${(f.cover * 100).toFixed(0)}% of the walkable ground is loose material `
          + `at least ${(0.12).toFixed(2)} m deep — the rest is a plate`);
        assert(!LEVELS[key].grass,
          `${key}: ground made of ${LEVELS[key].terrain} is still growing grass`);
      }
      rows.push(`${key} ${(f.cover * 100).toFixed(0)}% (${f.kind})`);
    }
    assert(covered >= 5, `only ${covered} levels carry any ground cover at all`);
    return rows.join(', ');
  });

  check('levels: and there is always something with a silhouette in view', () => {
    /* The other half, and a different question: "at my feet" is not "in view".
     * A metre of gravel does not stop a level reading as empty — what does is
     * something big enough to sit on the skyline and give the ground a scale.
     * Gate 1.2 m radius within 25 m.
     *
     * Before:  dunes 31.8%   canyon 21.6%   arena 7.4%   hangar 0.0% */
    const rows = [];
    for (const [key, f] of fill()) {
      assert(f.sil < 0.12,
        `${key}: ${(f.sil * 100).toFixed(1)}% of the ground has nothing over 1.2 m within 25 m`);
      rows.push(`${key} ${(f.sil * 100).toFixed(1)}%`);
    }
    return rows.join(', ');
  });

  check('levels: filling the ground did not cost a draw call per pebble', () => {
    /* The obvious way to fill a level is a loop around `addRock`, which is ONE
     * DRAW CALL PER ROCK. The first version of this pass did exactly that and
     * took the arena from 351 meshes to 502 for less fill than the instanced
     * version gives. Everything wide-area now goes through `addScree`, which is
     * one instanced call for hundreds of stones — so the object count and the
     * mesh count have to be allowed to diverge by a wide margin. */
    const rows = [];
    const ratios = [];
    for (const [key, f] of fill()) {
      assert(f.meshes < 520, `${key} dresses itself in ${f.meshes} draw calls`);
      rows.push(`${key} ${f.objects} objects / ${f.meshes} calls (${(f.objects / f.meshes).toFixed(1)}:1)`);
      // Only the levels with open ground to fill. A hangar is a room: it is
      // dense because it is small, every object in it is hand-placed and near
      // enough to be seen properly, and instancing its crates would buy
      // nothing. Holding it to the same ratio would be measuring the wrong
      // thing and would push someone to instance a workshop.
      if (LEVELS[key].atmosphere.sky !== false) ratios.push(f.objects / f.meshes);
    }
    const worst = Math.min(...ratios);
    assert(ratios.length >= 3, `only ${ratios.length} outdoor levels to measure`);
    assert(worst > 5, `the least instanced outdoor level packs only ${worst.toFixed(1)} objects per draw call`);
    return rows.join('; ');
  });

  check('ground: a chip LIES on the ground instead of standing in it', () => {
    /*
     * THE STRAY POLYGON, named at last. Three rounds of screenshots called it an
     * "unlit untextured plane standing upright at a random angle, with no
     * shadow and no ground contact", in all three outdoor levels; the round
     * before this one went looking in the decal path and in Slice and found
     * real bugs there that were not this one.
     *
     * It is addScree. Its chip is an icosahedron flattened to 0.52 and it was
     * turned by THREE UNBOUNDED EULER ANGLES, so a uniformly random orientation
     * stood it on edge as often as it laid it flat — the same generator
     * Levels.js had already had to abandon for the landmark grade, for the same
     * reason, in a comment that says so. Measured on the three outdoor levels,
     * with only addScree's own chip counted (detail 0, 60 vertices;
     * addBoulderCluster and addDebrisField are detail 1+ and both already cap
     * their tilt):
     *
     *              blades  maxTilt  worstChip m²  two-tone plate  floating
     *   dunes      179 → 0  90° → 36°  1.004 → 0.260  0.396 → 0.156   12 → 0
     *   arena      447 → 0  90° → 36°  0.428 → 0.189  0.297 → 0.159   15 → 0
     *   canyon     894 → 0  90° → 36°  1.834 → 0.547  0.503 → 0.145   18 → 0
     *
     * A "blade" is a chip past 55° with a face over 0.6 m. The brightness that
     * made them read as UNLIT follows from the tilt on its own: a plate square
     * to a low sun returns up to 4.13× the radiance the flat ground does
     * (canyon, sun at 14°), so the lit face clips to white and the back face
     * gets nothing but sky ambient — the white triangle with a saturated blue
     * one welded to it, exactly as shot. The chip's own albedo is 0.112-0.190
     * linear, DARKER than the sand it sits on, so orientation is the only
     * channel it could have been.
     *
     * "worstChip" is the excess sunlit area of the worst single chip: the area
     * of its faces weighted by how much more than a flat patch of ground each
     * one returns, in m². It is the second channel, and it is the one that
     * matters — the first cut of this check measured tilt alone, watched it go
     * to zero, and would have shipped on that.
     */
    const UP = new THREE.Vector3(0, 1, 0);
    const rows = [];
    for (const key of OUTDOOR_LEVELS) {
      const L = LEVELS[key];
      const terrain = new Terrain(new THREE.Scene(), L.terrain, 0.5);
      const world = stubWorld(terrain);
      L.dress(world);
      const sun = sunDirection(L.atmosphere).normalize();
      const groundNL = Math.max(0, UP.dot(sun));
      const m = new THREE.Matrix4(), q = new THREE.Quaternion();
      const t = new THREE.Vector3(), s = new THREE.Vector3(), ny = new THREE.Vector3();
      const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
      const e1 = new THREE.Vector3(), e2 = new THREE.Vector3(), fn = new THREE.Vector3();
      let chips = 0, blades = 0, maxTilt = 0, maxExcess = 0, maxPair = 0, floating = 0, maxFloat = 0;
      world.scene.traverse((o) => {
        if (!o.isInstancedMesh || o.geometry.type !== 'IcosahedronGeometry') return;
        const pos = o.geometry.attributes.position;
        if (pos.count !== 60) return;             // detail 0 — addScree's chip and nothing else
        o.updateMatrixWorld(true);
        for (let i = 0; i < o.count; i++) {
          o.getMatrixAt(i, m); m.premultiply(o.matrixWorld); m.decompose(t, q, s);
          chips++;
          ny.set(0, 1, 0).applyQuaternion(q);
          const tilt = Math.acos(Math.min(1, Math.abs(ny.dot(UP)))) * 180 / Math.PI;
          if (tilt > maxTilt) maxTilt = tilt;
          if (tilt > 55 && Math.max(s.x, s.z) > 0.6) blades++;
          let ex = 0, lit = 0, dark = 0, lowest = Infinity;
          for (let f = 0; f < 20; f++) {
            a.fromBufferAttribute(pos, f * 3).applyMatrix4(m);
            b.fromBufferAttribute(pos, f * 3 + 1).applyMatrix4(m);
            c.fromBufferAttribute(pos, f * 3 + 2).applyMatrix4(m);
            lowest = Math.min(lowest, a.y, b.y, c.y);
            e1.subVectors(b, a); e2.subVectors(c, a); fn.crossVectors(e1, e2);
            const area = fn.length() * 0.5;
            if (area < 1e-7) continue;
            fn.normalize();
            const nl = Math.max(0, fn.dot(sun));
            ex += area * Math.max(0, nl - groundNL);
            if (nl >= 0.80 && area > lit) lit = area;    // the white face
            if (nl <= 0.05 && area > dark) dark = area;  // the blue one welded to it
          }
          if (ex > maxExcess) maxExcess = ex;
          const pair = Math.min(lit, dark);
          if (pair > maxPair) maxPair = pair;
          const gap = lowest - terrain.height(t.x, t.z);
          if (gap > 0.01) { floating++; maxFloat = Math.max(maxFloat, gap); }
        }
      });
      assert(chips > 400, `${key}: only ${chips} scree chips to survey`);
      assert(blades === 0, `${key}: ${blades} chips stand past 55° with a face over 0.6 m across`);
      // 36° is CHIP_REPOSE, the angle of repose of loose rock; a shade over it
      // for the quaternion round trip
      assert(maxTilt < 38, `${key}: a chip lies at ${maxTilt.toFixed(1)}°, steeper than loose rock rests`);
      // 0.65 against a measured worst of 0.547 (canyon, and canyon is worst
      // because its sun is at 14°, so the flat ground only returns 0.242 and
      // ANY tilt toward the sun buys a large multiple of it). Was 1.834.
      assert(maxExcess < 0.65,
        `${key}: one chip presents ${maxExcess.toFixed(3)} m² of excess sunlit area — it will clip to white`);
      assert(maxPair < 0.22,
        `${key}: a chip shows a ${maxPair.toFixed(3)} m² face square to the sun with an equally big one in shade — that is the white-and-blue plate`);
      assert(floating === 0, `${key}: ${floating} chips hover clear of the ground, worst ${maxFloat.toFixed(3)} m`);
      rows.push(`${key} ${chips} chips, 0 blades, ≤${maxTilt.toFixed(0)}°, worst ${maxExcess.toFixed(2)} m² excess sunlit, plate ${maxPair.toFixed(2)} m²`);
      terrain.dispose();
    }
    return rows.join('; ');
  });

  /* ══ the wind's fine scale ═══════════════════════════════════════════ */

  check('wind: the wave is a travelling band, and its GLSL twin has the same numbers', () => {
    // Same guarantee `windGust` already has: WindField and WIND_GLSL are
    // hand-mirrored, and if one drifts the grass waves at one speed and the
    // dust at another.
    const nums = (s) => (s.match(/(?<![\w.])\d+\.\d+/g) || []).map(Number);
    const glsl = WIND_GLSL.slice(WIND_GLSL.indexOf('float windWave'), WIND_GLSL.lastIndexOf('vec3 windAt'));
    assert(glsl.length > 40, 'WIND_GLSL has no windWave at all');
    const inShader = new Set(nums(glsl).map((n) => n.toFixed(6)));
    const inJs = nums(WindField.prototype.wave.toString()).map((n) => n.toFixed(6));
    const missing = inJs.filter((n) => !inShader.has(n));
    assert(missing.length === 0, `coefficients only the CPU has: ${missing.join(', ')}`);

    const w = new WindField({ heading: 0, strength: 2, gustiness: 0.6 });
    w.wander = 0;
    w._refresh();
    // ── crest spacing along the wind. This is the number that decides whether
    // a field reads as a field: 15 m puts three crests across a 46 m grass
    // ring, and the gust scale's 114 m puts less than half of one.
    const zeros = [];
    let prev = w.wave(0, 0, 0);
    for (let x = 0.1; x < 200; x += 0.1) {
      const v = w.wave(x, 0, 0);
      if ((prev < 0) !== (v < 0)) zeros.push(x);
      prev = v;
    }
    assert(zeros.length > 12, `only ${zeros.length} zero crossings in 200 m — that is not a wave`);
    const spacing = 2 * (zeros[zeros.length - 1] - zeros[0]) / (zeros.length - 1);
    assert(spacing > 9 && spacing < 24,
      `crests are ${spacing.toFixed(1)} m apart — a field reads waves at 10-20 m`);
    // and the gust scale must still be the LONG one, or there is only one scale
    const gz = [];
    let gp = w.gust(0, 0, 0);
    for (let x = 0.5; x < 600; x += 0.5) {
      const v = w.gust(x, 0, 0);
      if ((gp < 0) !== (v < 0)) gz.push(x);
      gp = v;
    }
    const gustSpacing = 2 * (gz[gz.length - 1] - gz[0]) / (gz.length - 1);
    assert(gustSpacing > spacing * 3,
      `gusts repeat every ${gustSpacing.toFixed(0)} m against waves at ${spacing.toFixed(0)} m — one scale, not two`);

    // ── it TRAVELS, downwind, at a believable speed. Measured by finding the
    // shift that best re-aligns the field a second later.
    const dt = 1.0;
    let bestShift = 0, bestErr = Infinity;
    for (let sh = -20; sh <= 20; sh += 0.05) {
      let e = 0;
      for (let x = 0; x < 120; x += 1) e += Math.abs(w.wave(x + sh, 0, dt) - w.wave(x, 0, 0));
      if (e < bestErr) { bestErr = e; bestShift = sh; }
    }
    // positive shift means the pattern moved toward +x, which IS downwind here
    assert(bestShift > 3 && bestShift < 14,
      `the wave pattern moves at ${bestShift.toFixed(1)} m/s — wind waves travel at walking to jogging pace`);
    assert(bestErr < 6, `the pattern does not survive being shifted (residual ${bestErr.toFixed(1)})`);
    return `crests ${spacing.toFixed(1)} m apart travelling ${bestShift.toFixed(1)} m/s, ` +
      `gusts ${gustSpacing.toFixed(0)} m apart (${(gustSpacing / spacing).toFixed(1)}× coarser)`;
  });

  check('grass: a gust front crossing the field is visible as LIGHT, not only as motion', () => {
    /* Wind on a meadow is legible from a hundred metres, and almost none of
     * that is the movement — it is that a band of blades laid over shows you
     * its pale underside and its sheen at the same moment. This ports the two
     * places the shader uses the wave and checks both are actually doing
     * something: `1 + uWaveGain·wave` on the bend, and the silver mix on the
     * albedo. Read out of the SOURCE, so it cannot pass on a copy of the
     * numbers that has drifted from the shader.
     */
    const w = new WindField({ heading: 0, strength: 1.7, gustiness: 0.62 });
    w.wander = 0; w._refresh();
    const waveGain = 0.62, sheen = 0.55, lift = 1.7;

    // bend, as the vertex shader computes it, along one line across the field
    let bendMin = Infinity, bendMax = 0;
    let lumMin = Infinity, lumMax = 0;
    const base = [0.32, 0.40, 0.22];             // a mid green blade, linear
    const L = (c) => c[0] * 0.2126 + c[1] * 0.7152 + c[2] * 0.0722;
    for (let x = 0; x < 120; x += 0.25) {
      const g = w.gust(x, 0, 0);
      const wmag = Math.max(0, w.strength * (1 + w.gustiness * g));
      const wv = w.wave(x, 0, 0);                // per-tuft factor left at 1
      const lay = 1 + waveGain * wv;
      const bend = 0.23 * wmag * lay;
      bendMin = Math.min(bendMin, bend); bendMax = Math.max(bendMax, bend);
      // the fragment shader's silver, at the tip where the height ramp is 1
      const k = Math.min(1, Math.max(0, wv * 0.5 + 0.5)) * sheen;
      const l0 = L(base);
      const silver = base.map((c) => (c + (l0 - c) * 0.45) * lift);
      const out = base.map((c, i) => c + (silver[i] - c) * k);
      lumMin = Math.min(lumMin, L(out)); lumMax = Math.max(lumMax, L(out));
    }
    assert(lay0Positive(waveGain), `1 + ${waveGain}·wave can go negative — the crest bends upwind`);
    assert(bendMax / bendMin > 2.5,
      `the wave only moves the bend by ${(bendMax / bendMin).toFixed(2)}:1 — that is a breeze, not a wave`);
    const depth = (lumMax - lumMin) / lumMax;
    assert(depth > 0.18,
      `a crest is only ${(depth * 100).toFixed(1)}% brighter than a trough — the wave is invisible at range`);
    assert(depth < 0.60, `a crest is ${(depth * 100).toFixed(0)}% brighter — that is a strobe, not grass`);
    return `bend ${bendMin.toFixed(2)}–${bendMax.toFixed(2)} rad (${(bendMax / bendMin).toFixed(1)}:1), ` +
      `crest/trough luminance ${(depth * 100).toFixed(0)}%`;
  });

  /* ══ weather ═════════════════════════════════════════════════════════ */

  check('weather: a squall arrives, peaks, and leaves — and it is mostly calm', () => {
    /* The whole difference between weather and a particle count. Walked over a
     * full cycle at 10 Hz: the intensity has to spend most of its time low, get
     * to something like full at the peak, and take LONGER to leave than to
     * arrive, because a squall line hits in seconds and blows itself out over
     * a minute. A symmetric bump is a fade-in/fade-out, which is a transition. */
    const W = new Weather({ peak: 1, period: 120, duration: 40, unrest: 0.14, phase: 0 });
    const N = 1200, dt = 0.1;
    const trace = [];
    for (let i = 0; i < N; i++) { W.update(dt); trace.push(W.intensity); }
    const peak = Math.max(...trace);
    const calmFrac = trace.filter((v) => v < 0.25).length / trace.length;
    assert(peak > 0.9, `the storm only reaches ${peak.toFixed(2)} — that is a breeze`);
    assert(calmFrac > 0.55,
      `only ${(calmFrac * 100).toFixed(0)}% of the cycle is calm — permanent weather is wallpaper`);
    // and it is never dead flat, or calm is its own tell
    assert(Math.min(...trace) < 0.12 && new Set(trace.map((v) => v.toFixed(3))).size > 200,
      'the calm between fronts is a constant');
    // rise vs fall, measured between the half-power crossings and the peak
    const iPeak = trace.indexOf(peak);
    let rise = 0; for (let i = iPeak; i > 0 && trace[i] > 0.5; i--) rise = (iPeak - i) * dt;
    let fall = 0; for (let i = iPeak; i < N && trace[i] > 0.5; i++) fall = (i - iPeak) * dt;
    assert(fall > rise * 1.6,
      `the front takes ${rise.toFixed(0)} s to arrive and ${fall.toFixed(0)} s to leave — that is symmetric`);
    return `peak ${peak.toFixed(2)}, calm ${(calmFrac * 100).toFixed(0)}% of the cycle, ` +
      `${rise.toFixed(0)} s in / ${fall.toFixed(0)} s out`;
  });

  check('weather: the front is somewhere, then here, then gone', () => {
    /* A global fade is not a storm rolling through, it is a slider. The leading
     * edge has a position along the wind axis, it crosses the camera at the
     * gust fronts' own speed, and a point downwind of it is still clear while a
     * point upwind of it is already in the dust. */
    const W = new Weather({ peak: 1, period: 120, duration: 40, unrest: 0, phase: 0 });
    const prevWander = wind.wander;
    wind.set(0, 2, 0.6); wind.wander = 0; wind._refresh();
    let sawApproach = false, sawOver = false, sawPast = false;
    let crossStart = -1, crossEnd = -1;
    let worstOrder = 0, backwards = 0, prevFront = -1e9, minFront = 1e9, maxFront = -1e9;
    for (let i = 0; i < 1200; i++) {
      W.update(0.1);
      const up = W.localAt(-140, 0);    // 140 m upwind — where the wall comes from
      const here = W.localAt(0, 0);
      const down = W.localAt(45, 0);    // just downwind — the last ground to go
      // The invariant, every frame: dust never increases downwind. A front that
      // is denser ahead of itself than behind is not a front.
      worstOrder = Math.max(worstOrder, down - up);
      if (W.intensity > 0.4) {
        // the edge has to advance while the storm is actually blowing
        if (W.frontOffset + 1e-9 < prevFront) backwards++;
        prevFront = W.frontOffset;
        minFront = Math.min(minFront, W.frontOffset);
        maxFront = Math.max(maxFront, W.frontOffset);
        if (up > here + 0.05 && here > down + 0.05) sawApproach = true;
        if (here > 0.55) { sawOver = true; if (crossStart < 0) crossStart = i * 0.1; crossEnd = i * 0.1; }
        if (down > 0.55 && here > 0.55) sawPast = true;
      } else { prevFront = -1e9; }
      // never out of range, whatever the front is doing
      assert(here >= 0 && here <= 1.0001, `local dust load left [0,1]: ${here}`);
    }
    wind.wander = prevWander;
    assert(worstOrder <= 1e-6, `the dust is ${worstOrder.toFixed(2)} denser downwind than upwind`);
    assert(sawApproach, 'the dust load is the same upwind and downwind — the front does not travel');
    assert(sawOver, 'the front never actually reached the camera while the storm was still blowing');
    assert(sawPast, 'the front never got past the camera before the storm blew out');
    assert(backwards === 0, `the leading edge moved upwind on ${backwards} frames`);
    // and it has to arrive from upwind and leave downwind, not appear on top of you
    assert(minFront < -40 && maxFront > 90,
      `the edge only travelled ${minFront.toFixed(0)} → ${maxFront.toFixed(0)} m while the storm was blowing`);
    const dwell = crossEnd - crossStart;
    assert(dwell > 6 && dwell < 45, `the wall sat on the camera for ${dwell.toFixed(0)} s`);

    // the GLSL twin has to be the same profile
    assert(/1\.0 - smoothstep\(uStorm\.y - uStorm\.z, uStorm\.y, s\)/.test(STORM_GLSL),
      'STORM_GLSL no longer computes the leading edge the way Weather.localAt does');
    return `edge runs ${minFront.toFixed(0)} → ${maxFront.toFixed(0)} m, crosses in ${dwell.toFixed(0)} s, ` +
      'upwind leads downwind throughout';
  });

  check('weather: one number drives wind, visibility and the light together', () => {
    /* The reason there is a scheduler at all. If the dust decided its own
     * density, the fog its own thickness and the sun its own level, they would
     * disagree — and disagreement is what reads as fake. Built on a real
     * Atmosphere over a lit, fogged scene, then driven to a peak. */
    const scene = new THREE.Scene();
    const sun = new THREE.DirectionalLight(0xfff0d8, 7);
    sun.position.set(30, 60, 20); sun.castShadow = true;
    const hemi = new THREE.HemisphereLight(0xcfe0f5, 0x8a6a44, 0.30);
    scene.add(sun); scene.add(hemi);
    scene.fog = new THREE.FogExp2(0xd8c8a4, 0.0042);

    const a = new Atmosphere(scene, {
      count: 120, density: 0.5, color: 0xd8c8a8, opacity: 0.34,
      weather: { peak: 1, period: 120, duration: 40, unrest: 0, phase: 0, fogGain: 3.6, windGain: 2.6 },
    });
    const fog0 = scene.fog.density, sun0 = sun.intensity, hemi0 = hemi.intensity;
    const windSpeed0 = wind.strength;
    const vis0 = a.weather.visibility(fog0);

    let peak = null;
    const centre = V(0, 0, 0);
    for (let i = 0; i < 400; i++) {
      a.update(0.1, centre);
      if (!peak || a.weather.intensity > peak.I) {
        peak = { I: a.weather.intensity, fog: scene.fog.density, sun: sun.intensity,
          hemi: hemi.intensity, wind: wind.strength, vis: a.weather.visibility(fog0) };
      }
    }
    assert(peak.I > 0.9, `the storm never got going (${peak.I.toFixed(2)})`);
    assert(peak.fog > fog0 * 2, `fog only went ${fog0.toFixed(4)} → ${peak.fog.toFixed(4)}`);
    /* HALF THE LIGHT SURVIVING AT 43 m INSTEAD OF 198 m, which is what the dune
     * sea's own fogGain asks for and what it did not used to get. The storm was
     * held to 85 m by a cap that had nothing to do with weather —
     * Terrain._syncAtmosphere used to test the LIVE fog density against 0.01 to
     * decide whether it was indoors, so anything past that line switched the
     * ground's aerial term off mid-squall and the cap existed to stay under it.
     * Measured cost: a full-strength front moved the arena's median frame
     * luminance from 0.2856 to 0.2711. Five per cent, for the whole storm.
     *
     * Terrain now tests the density the level AUTHORED, so the check is the
     * real one: visibility has to collapse to a quarter, AND the ground has to
     * still know it is outdoors while it does. */
    assert(peak.vis < vis0 * 0.28,
      `visibility only fell ${vis0.toFixed(0)} m → ${peak.vis.toFixed(0)} m`);
    {
      const t = new Terrain(new THREE.Scene(), 'dunes', 0.5);
      t._scene = scene;
      scene.fog.density = fog0; t._syncAtmosphere();          // calm, outdoors
      const calm = t._uniforms.uHaze.value.y;
      scene.fog.density = peak.fog; t._syncAtmosphere();      // the same air, stormed
      const storm = t._uniforms.uHaze.value.y;
      assert(calm > 0.01 && storm === calm,
        `the ground's aerial term went ${calm.toFixed(3)} → ${storm.toFixed(3)} at fog ` +
        `${peak.fog.toFixed(4)} — the storm is switching the terrain indoors and back`);
      t.dispose();
      scene.fog.density = peak.fog;
    }
    assert(peak.sun < sun0 * 0.65, `the key light barely moved: ${sun0} → ${peak.sun.toFixed(2)}`);
    assert(peak.hemi > hemi0 * 1.2,
      'the fill did not come up — a dust storm converts direct light into ambient, it is not a dimmer');
    assert(peak.wind > windSpeed0 * 2.5, `the wind only went ${windSpeed0} → ${peak.wind.toFixed(2)} m/s`);
    // and the sun took the colour of what it is coming through
    assert(sun.color.b < 0.98, 'the sun kept its clear-air colour through a dust storm');

    a.dispose();
    // ── and NOTHING it borrowed outlives the level
    near(scene.fog.density, fog0, 1e-9, 'the fog stayed thickened after dispose');
    near(sun.intensity, sun0, 1e-9, 'the sun stayed dimmed after dispose');
    near(hemi.intensity, hemi0, 1e-9, 'the fill stayed lifted after dispose');
    near(wind.strength, windSpeed0, 1e-9, 'the wind stayed up after dispose');
    near(weather.intensity, 0, 1e-9, 'the weather kept running with no level to run in');
    return `I ${peak.I.toFixed(2)}: visibility ${vis0.toFixed(0)} → ${peak.vis.toFixed(0)} m, ` +
      `sun ${sun0.toFixed(1)} → ${peak.sun.toFixed(1)}, fill ×${(peak.hemi / hemi0).toFixed(2)}, ` +
      `wind ${windSpeed0.toFixed(1)} → ${peak.wind.toFixed(1)} m/s; all restored`;
  });

  check('weather: indoors there is none of it', () => {
    // A dust storm crossing a hangar bay is a bug report. The only signal is
    // whether the scene has a sky, which is what the rest of Atmosphere uses.
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0a0d13);
    scene.add(new THREE.DirectionalLight(0xbcd0ff, 3.4));
    scene.fog = new THREE.FogExp2(0x141922, 0.016);
    const fog0 = scene.fog.density;
    const a = new Atmosphere(scene, { count: 60, density: 0.5, weather: { peak: 1, phase: 0 } });
    for (let i = 0; i < 200; i++) a.update(0.1, V(0, 0, 0));
    assert(a.weather.intensity === 0, `the hangar is in a ${a.weather.intensity.toFixed(2)} dust storm`);
    near(scene.fog.density, fog0, 1e-9, 'the hangar fog moved');
    assert(!a.banks.mesh, 'a hangar grew fog banks');
    a.dispose();
    return 'no weather without a sky';
  });

  check('weather: every outdoor level says how hard its own weather gets', () => {
    // The scheduler is shared; the CHARACTER is the level's. An open dune sea
    // and a sheltered bowl cannot have the same storm, and a level that forgot
    // to say gets none at all rather than a default that is wrong everywhere.
    const rows = [];
    for (const key of LEVEL_ORDER) {
      const L = LEVELS[key];
      if (!L) continue;
      const outdoor = L.atmosphere.sky !== false;
      const w = L.dust && L.dust.weather;
      if (!outdoor) { assert(!w || !w.peak, `${key} is indoors and has weather`); continue; }
      assert(w && w.peak > 0.4, `${key} is outdoors under an open sky with no weather at all`);
      assert(w.period > w.duration * 1.8,
        `${key} storms for ${w.duration}s every ${w.period}s — that is not weather, that is the climate`);
      rows.push(`${key} peak ${w.peak} every ${w.period}s`);
    }
    assert(rows.length >= 3, `only ${rows.length} outdoor levels carry weather`);
    /* And NO TWO LEVELS MAY BE THE SAME STORM. This used to be `size > 1`,
     * which only refused a world where every level had the identical squall
     * and passed happily on three levels sharing one between two of them.
     * Weather is the strongest single thing distinguishing one open-sky level
     * from another — it decides visibility, key-to-fill and how hard the cover
     * lies down — so "some of them differ" is not the property; "each of them
     * is its own place" is. */
    const storms = new Set(rows.map((r) => r.split(' ').slice(1).join(' ')));
    assert(storms.size === rows.length,
      `${rows.length} outdoor levels share ${storms.size} distinct storms between them`);
    return rows.join(', ');
  });

  check('weather: a front is a whole frame, not a fog slider', () => {
    /* THE SCORE THIS CHECK EXISTS FOR: "the storm is a fog slider, not
     * weather." Forced to peak on the dune sea the horizon band moved
     * luminance 0.511 → 0.731 and saturation 0.197 → 0.064, which is real, and
     * the sky 200 px above it moved 1.4% — an 80 m whiteout under a clear blue
     * sky with crisp cumulus and a hard sun in it.
     *
     * The sky's half of that lives in SkyDome and is pinned in the painted
     * skyline check. This is the rest of the frame, in the units the code
     * already knows how to compute rather than in gains nobody can picture:
     * how far you can see, how hard the light is, and whether the cover goes
     * over. A gain that has been quietly capped or multiplied by a peak of 0.2
     * looks fine in the level file and does nothing here. */
    const rows = [];
    for (const key of LEVEL_ORDER) {
      const L = LEVELS[key];
      const a = L.atmosphere || {};
      const w = L.dust && L.dust.weather;
      if (a.sky === false || !w || !w.peak) continue;
      const W = new Weather(w);
      const base = a.fogDensity ?? 0.0035;
      W.intensity = 0; const vCalm = W.visibility(base);
      W.intensity = w.peak; const vPeak = W.visibility(base);
      /* THE LEVEL'S OWN PREVAILING WIND, resolved through the code that
       * resolves it. This line used to read `const wCalm = 1.7` under the
       * comment "the one wind everything reads; no level overrides its base
       * speed" — true when it was written and false now that `dust.wind`
       * exists. Pinning the constant would have quietly measured the wrong
       * level the first time one authored a gale, and the property that
       * matters was never the number: it is that a front more than doubles
       * whatever the level's calm air is, and that the cover goes over at the
       * peak of it. Both are now tested against what the level actually says. */
      const wCalm = windSettings(L.dust && L.dust.wind).strength;
      const wPeak = wCalm * (1 + W.windGain * w.peak);
      // What that does to a blade of the near ring, which is where the eye
      // reads the rake: uBendGain 0.23, the wave at its crest, clamped at 2 rad.
      const bend = (s) => Math.min(0.23 * s * 1.62, 2.0);
      const kCalm = (a.sunIntensity ?? 7) / (a.ambient ?? 0.85);
      const kPeak = ((a.sunIntensity ?? 7) * (1 - W.sunLoss * w.peak))
        / ((a.ambient ?? 0.85) * (1 + W.fillGain * w.peak));

      assert(vPeak < vCalm * 0.5,
        `${key} sees ${vPeak.toFixed(0)} m at the peak of its own storm against ${vCalm.toFixed(0)} m ` +
        'in calm air — that is haze, not a front');
      assert(kPeak < kCalm * 0.55,
        `${key} holds a ${kPeak.toFixed(1)}:1 key-to-fill through a dust storm against ${kCalm.toFixed(1)}:1 ` +
        'in the clear — the sun is being dimmed but not softened, so every shadow stays razor-edged');
      assert(wPeak > wCalm * 2,
        `${key}'s wind only reaches ${wPeak.toFixed(1)} m/s in a front`);
      assert(bend(wPeak) > 1.0,
        `${key}'s ground cover bends ${bend(wPeak).toFixed(2)} rad at the peak — the storm does not lay it over`);
      rows.push(`${key} ${vCalm.toFixed(0)}→${vPeak.toFixed(0)} m, key ${kCalm.toFixed(0)}→${kPeak.toFixed(0)}:1, ` +
        `blade ${bend(wCalm).toFixed(2)}→${bend(wPeak).toFixed(2)} rad`);
    }
    assert(rows.length >= 3, `only ${rows.length} outdoor levels have a measurable front`);
    return rows.join('; ');
  });

  /* ══ distance ════════════════════════════════════════════════════════ */

  check('horizon: three ranges at three distances, and they move when you do', () => {
    /* The sky dome's painted ridges sit at infinity: they do not shift when the
     * player walks, and the eye reads that inside about ten seconds. These are
     * real geometry at 170/250/340 m, which is the ONE cue a dome cannot fake.
     *
     * Measured as parallax: from the centre and from 60 m off it, the apparent
     * bearing of a point on the near range has to move several times as far as
     * the same point on the far one. */
    const terrain = new Terrain(new THREE.Scene(), 'dunes', 0.5);
    const world = stubWorld(terrain);
    world.scene.fog = new THREE.FogExp2(0xd8c8a4, 0.0042);
    const before = world.physics.staticBoxes.length;
    const meshes = addHorizon(world, { seed: 4401 });
    assert(meshes.length === 3, `${meshes.length} ranges — layering needs at least three`);
    assert(world.physics.staticBoxes.length === before,
      'the far ranges took colliders — they are scenery, and the player can never reach them');
    assert(world.statics.length >= 3, 'the ranges never reached world.statics, so unload will leak them');

    const radii = [], heights = [], spans = [];
    for (const m of meshes) {
      assert(!m.castShadow, 'a range 300 m away is in the shadow cascade');
      const p = m.geometry.attributes.position;
      assert(m.geometry.attributes.aNear && m.geometry.attributes.aFar,
        'a range with no aNear/aFar attribute renders as the material colour — a white wall');
      let rmin = Infinity, rmax = 0, top = -1e9, bot = 1e9;
      const tops = [];
      // Three rows a column — deep root, grade, crest — so the crest is every
      // third vertex. Derived from the mesh rather than hard-coded, because a
      // stride that silently stops selecting crests turns the span assertion
      // below into a measurement of nothing.
      const stride = ROWS;
      assert(p.count % stride === 0, `a range has ${p.count} vertices, not a whole number of columns`);
      for (let i = 0; i < p.count; i++) {
        const r = Math.hypot(p.getX(i), p.getZ(i));
        rmin = Math.min(rmin, r); rmax = Math.max(rmax, r);
        const y = p.getY(i);
        top = Math.max(top, y); bot = Math.min(bot, y);
        if (i % stride === stride - 1) tops.push(y);
      }
      assert(tops.length === p.count / stride, 'the crest row is not one vertex a column');
      near(rmax, rmin, rmax * 0.02, 'a range is not a ring');
      radii.push(rmax);
      heights.push(top);
      tops.sort((a, b) => a - b);
      spans.push(tops[(tops.length * 0.9) | 0] - tops[(tops.length * 0.1) | 0]);
      assert(bot < -20, 'a range is not rooted below grade — you can see under it');
    }
    for (let i = 1; i < radii.length; i++) {
      assert(radii[i] > radii[i - 1] * 1.2, `ranges at ${radii[i - 1].toFixed(0)} and ${radii[i].toFixed(0)} m are the same range`);
      assert(heights[i] > heights[i - 1], 'a further range is not taller — it will hide behind the near one');
    }
    for (let i = 0; i < spans.length; i++) {
      assert(spans[i] > radii[i] * 0.03,
        `range ${i} varies by only ${spans[i].toFixed(1)} m over ${radii[i].toFixed(0)} m — a cylinder with a lid`);
    }

    // parallax: how far a crest slides across the view when the player walks
    const bearingShift = (R) => {
      const off = 60;
      // a point straight ahead at range R, seen from 60 m to the side
      return Math.abs(Math.atan2(off, R)) * 180 / Math.PI;
    };
    const nearShift = bearingShift(radii[0]), farShift = bearingShift(radii[2]);
    assert(nearShift > farShift * 1.5,
      `the near range shifts ${nearShift.toFixed(1)}° and the far one ${farShift.toFixed(1)}° — no layering`);
    // and something too big to be near: the far range has to out-subtend
    // everything in the play space (nothing there is over 20 m)
    const farAngle = Math.atan2(heights[2], radii[2]) * 180 / Math.PI;
    assert(heights[2] > 45, `the far range tops out at ${heights[2].toFixed(0)} m — that could be a building`);
    terrain.dispose();
    return `ranges at ${radii.map((r) => r.toFixed(0)).join('/')} m, crests to ` +
      `${heights.map((h) => h.toFixed(0)).join('/')} m, parallax ${nearShift.toFixed(1)}° vs ${farShift.toFixed(1)}°, ` +
      `far range subtends ${farAngle.toFixed(1)}°`;
  });

  check('horizon: every range is DARKER and LESS SATURATED than its sky, and converges on it', () => {
    /* This check used to assert "darker AND BLUER", and the "bluer" half was
     * pinning a bug. It was satisfied by multiplying the sky by the chromatic
     * constant [0.62, 0.68, 0.84], which raises blue-over-red by 1.35 whatever
     * colour that sky is — so a range could pass while converging on a colour
     * its own sky never reaches. Measured that way, saturation of the asymptote
     * over saturation of the sky directly above it ran 1.11–93.6× on dunes,
     * 1.15–53.3× on arena and 1.37–89.5× on canyon, and on canyon the sky at 8°
     * is warm (hue 46–199°) while the asymptote was blue (210–222°): 171° apart
     * on the wheel. Navy paper triangles instead of white ones — the same bug
     * as the first round, one channel over.
     *
     * Aerial perspective drives luminance contrast AND chroma contrast toward
     * zero. So the property is the whole of that, and none of it is a constant:
     *
     *   1. darker — composited luminance under the drawn sky directly above it,
     *      at every crest vertex of every range of every outdoor level;
     *   2. no more saturated than that sky, at the same vertices. Stated as a
     *      DIFFERENCE, not a ratio: inside the aureole the sky is 0.004
     *      saturated and any ratio of two near-neutrals is noise;
     *   3. and converging with distance, both by the mix that produces it — the
     *      mean extinction toward the asymptote has to rise ring by ring — and
     *      in what comes out: mean luminance contrast has to fall ring by ring.
     *
     * All of it off the engine's own exported sky, not a transcription. */
    const lum = (c) => c.r * 0.2126 + c.g * 0.7152 + c.b * 0.0722;
    const sat = (c) => {
      const m = Math.max(c.r, c.g, c.b);
      return m <= 1e-6 ? 0 : (m - Math.min(c.r, c.g, c.b)) / m;
    };
    const rows = [];
    let worstL = 0, worstS = -Infinity, worstLat = '', worstSat = '';
    let worstCrest = 0, worstCrestAt = '';
    for (const key of LEVEL_ORDER) {
      const L = LEVELS[key];
      const a = L.atmosphere || {};
      if (a.sky === false || a.horizon === false) continue;
      const terrain = new Terrain(new THREE.Scene(), L.terrain, 0.5);
      const world = stubWorld(terrain);
      world.level = L;
      world.scene.fog = new THREE.FogExp2(a.fogColor ?? 0xc9b391, a.fogDensity ?? 0.0035);
      // The ranges read the sky the DOME baked, so the dome has to exist —
      // which is also the check that the two agree about the same horizon.
      const dome = new SkyDome(world.scene);
      dome.configure(a);
      const disp = skyDisplayShoulder(a);
      const sun = sunDirection(a, new THREE.Vector3());
      /* And the KEY has to be hung before the ranges are built, exactly as a
       * level does it. addHorizon reads the light off the scene rather than
       * re-deriving it, so a stub with no sun in it measured every level
       * against the same fallback vector — which is how a facing term can be
       * backwards in the game and right in the test. */
      const key0 = new THREE.DirectionalLight(0xffffff, 1);
      key0.position.copy(sun).multiplyScalar(90);
      world.scene.add(key0);
      const meshes = addHorizon(world, { seed: 4400 });
      const invH = 1 / (a.fogHeight ?? 38), rho = a.fogDensity ?? 0.0035;
      const camY = 1.75, sky = new THREE.Color(), out = new THREE.Color();
      let hi = 0, lo = Infinity, dMax = -Infinity;
      const meanF = [], meanC = [], lits = [];
      /* The shader's own extinction at one vertex, camera in the middle of the
       * ring — the composited value that vertex hands the rasteriser. */
      const at = (P, N, F, i, o) => {
        const x = P.getX(i), y = P.getY(i), z = P.getZ(i);
        const R = Math.hypot(x, z), relY = y - camY, dist = Math.hypot(R, relY);
        const k = relY * invH, t0 = Math.exp(-camY * invH);
        const mm = Math.abs(k) < 1e-3 ? t0 : t0 * (1 - Math.exp(-k)) / k;
        const path = dist * Math.min(6, Math.max(0, mm));
        const f = 1 - Math.exp(-rho * rho * path * path);
        o.setRGB(N.getX(i) + (F.getX(i) - N.getX(i)) * f,
          N.getY(i) + (F.getY(i) - N.getY(i)) * f,
          N.getZ(i) + (F.getZ(i) - N.getZ(i)) * f);
        return { y, R, f };
      };
      const cTop = new THREE.Color(), cMid = new THREE.Color();
      for (const m of meshes) {
        const P = m.geometry.attributes.position;
        const N = m.geometry.attributes.aNear, F = m.geometry.attributes.aFar;
        let fs = 0, cs = 0, n = 0;
        for (let i = ROWS - 1; i < P.count; i += ROWS) {
          /* NOT THE CREST ROW ONLY. The mesh interpolates between its rows, and
           * a check that samples one of them measures the one place the two
           * happen to agree. Measured at the crest alone, the ranges cleared
           * this comfortably while the BAND BELEW them — crest down to grade,
           * which is most of what is on screen — ran up to 0.336 of saturation
           * ABOVE the sky beside it, because the asymptote was baked once at
           * the crest's elevation and the sky is not flat over the few degrees
           * that band spans. So walk the visible span. */
          const top = at(P, N, F, i, cTop);
          const mid = at(P, N, F, i - 1, cMid);        // the row at grade
          for (let s = 0; s <= 6; s++) {
            const t = s / 6;
            const y = top.y + (mid.y - top.y) * t;
            const el = Math.atan2(y - camY, top.R) + 0.052;
            if (el <= 0.009) continue;                 // under the skyline
            out.setRGB(cTop.r + (cMid.r - cTop.r) * t, cTop.g + (cMid.g - cTop.g) * t,
              cTop.b + (cMid.b - cTop.b) * t);
            const ce = Math.cos(el) / Math.max(top.R, 1e-4);
            skyShoulder(skyRadiance(new THREE.Vector3(P.getX(i) * ce, Math.sin(el), P.getZ(i) * ce),
              sun, a, sky), disp.knee, disp.ceil);
            const ratio = lum(out) / Math.max(1e-4, lum(sky));
            const dSat = sat(out) - sat(sky);
            hi = Math.max(hi, ratio); lo = Math.min(lo, ratio); dMax = Math.max(dMax, dSat);
            if (ratio > worstL) { worstL = ratio; worstLat = key; }
            if (dSat > worstS) { worstS = dSat; worstSat = key; }
            // The CREST is the silhouette the eye reads a range by, so it is
            // held to a much harder bound than the base — a base at 0.98 of the
            // horizon sky is a range dissolving into the haze, which is right;
            // a crest at 0.98 is a range that is not there.
            if (s === 0 && ratio > worstCrest) { worstCrest = ratio; worstCrestAt = key; }
            fs += top.f + (mid.f - top.f) * t; cs += 1 - ratio; n++;
          }
        }
        assert(n > 0, 'no visible band on a range at all');
        meanF.push(fs / n); meanC.push(cs / n);

        /* ── and the sun has to light the half it can reach ──────────────
         * The player stands INSIDE the ring, so what they see is its inward
         * face: the ranges on the far side of the compass from the sun are
         * front-lit and the ones standing between the player and the sun are
         * contre-jour. The term that did this used the OUTWARD radial and so
         * brightened exactly the backlit half — the same shape of bug as an
         * aim assist scoring threats by alignment with the guard you already
         * have. lum(aNear)/lum(aFar) is the surface's own scalar shortfall,
         * because the rock hue carries unit luminance and aFar's luminance is
         * the sky's, so it reads straight off the geometry. */
        const sb = Math.atan2(sun.z, sun.x);
        let toward = 0, nt = 0, away = 0, nw = 0;
        for (let i = ROWS - 1; i < P.count; i += ROWS) {
          const b = Math.atan2(P.getZ(i), P.getX(i));
          const d = Math.abs(((b - sb + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - Math.PI);
          const c = lum({ r: N.getX(i), g: N.getY(i), b: N.getZ(i) })
            / Math.max(1e-6, lum({ r: F.getX(i), g: F.getY(i), b: F.getZ(i) }));
          if (d < Math.PI / 4) { toward += c; nt++; } else if (d > 3 * Math.PI / 4) { away += c; nw++; }
        }
        const gain = (away / nw) / (toward / nt);
        assert(gain > 1.15,
          `${key}: the ranges standing between the player and the sun come out ${gain < 1 ? 'BRIGHTER' : 'the same'} ` +
          `as the ones opposite (${(toward / nt).toFixed(3)} vs ${(away / nw).toFixed(3)}) — the sun is ` +
          'lighting the faces it cannot see');
        lits.push(gain);
      }
      for (let i = 1; i < meanF.length; i++) {
        assert(meanF[i] > meanF[i - 1],
          `${key}: ring ${i} sits ${meanF[i].toFixed(3)} of the way to its sky and ring ${i - 1} ` +
          `sits ${meanF[i - 1].toFixed(3)} — the further range is not the hazier one`);
        assert(meanC[i] < meanC[i - 1],
          `${key}: ring ${i} holds ${meanC[i].toFixed(3)} luminance contrast against ring ${i - 1}'s ` +
          `${meanC[i - 1].toFixed(3)} — distance is not costing contrast, so it will not read as distance`);
      }
      rows.push(`${key} ${lo.toFixed(2)}–${hi.toFixed(2)}× Δsat ≤${dMax.toFixed(3)} ` +
        `contrast ${meanC.map((v) => v.toFixed(2)).join('>')} lit +` +
        `${((Math.min(...lits) - 1) * 100).toFixed(0)}%`);
      dome.dispose();
      terrain.dispose();
    }
    assert(rows.length >= 3, 'no outdoor level built ranges to measure');
    assert(worstL < 0.995,
      `a range reaches ${worstL.toFixed(3)}× the sky above it on ${worstLat} — a landform behind 300 m ` +
      'of the same air cannot be that bright');
    assert(worstCrest < 0.90,
      `a CREST reaches ${worstCrest.toFixed(3)}× the sky above it on ${worstCrestAt} — the silhouette the ` +
      'eye reads the range by has no contrast left to read it with');
    // 0.01 of HSV saturation is under a JND and is the width of the sky band's
    // own interpolation error; anything a viewer could see has to be negative.
    assert(worstS < 0.01,
      `a range is ${worstS.toFixed(3)} MORE saturated than its own sky on ${worstSat} — ` +
      'aerial perspective takes chroma away, it does not add it');
    return `${rows.join(', ')}; worst crest ${worstCrest.toFixed(2)}×, worst anywhere ` +
      `${worstL.toFixed(2)}× (radiance, before the tone curve)`;
  });

  check('horizon: the silhouette has energy at every scale the mesh can draw', () => {
    /* "A perfect isoceles cone with dead-straight sides." It was, and the cause
     * was not too little noise but too much of it in the wrong place: the
     * profile's finest authored octave sat at 22× its base — 312 to 490 cycles
     * around the compass — on a ring the code capped at 256 segments. That is
     * 0.8 samples per period. Everything above the mesh's Nyquist came back as
     * single-segment spikes, and a spike two vertices wide IS a triangle with
     * dead-straight sides; meanwhile the scales the eye actually reads a
     * ridgeline by had almost nothing in them.
     *
     * So: assert the SPECTRUM of the crest profile, in harmonics around the
     * compass, which is the axis the silhouette lives on. A cone puts nearly
     * everything in one harmonic. A ridgeline spreads it — and every band it
     * spreads into must be one the mesh can resolve. */
    const OCT = [[2, 3], [4, 7], [8, 15], [16, 31], [32, 63]];
    const rows = [];
    let thinnest = 1, peakiest = 0, coarsest = 1, at = '';
    for (const key of LEVEL_ORDER) {
      const L = LEVELS[key];
      const a = L.atmosphere || {};
      if (a.sky === false || a.horizon === false) continue;
      const terrain = new Terrain(new THREE.Scene(), L.terrain, 0.5);
      const world = stubWorld(terrain);
      world.level = L;
      world.scene.fog = new THREE.FogExp2(a.fogColor ?? 0xc9b391, a.fogDensity ?? 0.0035);
      const dome = new SkyDome(world.scene);
      dome.configure(a);
      const meshes = addHorizon(world, { seed: 4400 });
      for (let mi = 0; mi < meshes.length; mi++) {
        const P = meshes[mi].geometry.attributes.position;
        /* The LANDFORM this code authors, which is the crest minus the ground
         * the ring is standing on. The eye sees the sum, and the sum is allowed
         * to have a huge low-frequency term — canyon's ring straddles a gorge,
         * and 57% of its drawn silhouette is that gorge. But the gorge is
         * Terrain's, and pinning it here would make this check pass or fail on
         * somebody else's heightfield. */
        const p = [];
        for (let i = ROWS - 1; i < P.count - ROWS; i += ROWS) {
          const x = P.getX(i), z = P.getZ(i);
          p.push(P.getY(i) - terrain.height(x, z));
        }
        const N = p.length;
        assert(N >= 384,
          `${key} ring ${mi} draws its skyline with ${N} samples — ${(360 / N).toFixed(2)}° a segment, ` +
          'so anything finer than that is a spike rather than a shape');
        const mean = p.reduce((s, v) => s + v, 0) / N;
        const q = p.map((v) => v - mean);
        const S = [];
        for (let k = 1; k <= 63; k++) {
          let re = 0, im = 0;
          for (let n = 0; n < N; n++) {
            const t = (2 * Math.PI * k * n) / N;
            re += q[n] * Math.cos(t); im += q[n] * Math.sin(t);
          }
          S.push(re * re + im * im);
        }
        const tot = S.reduce((s, v) => s + v, 0) || 1e-12;
        const band = ([a0, b0]) => S.slice(a0 - 1, b0).reduce((s, v) => s + v, 0) / tot;
        const shares = OCT.map(band);
        const peak = Math.max(...S) / tot;
        // energy in features narrower than 45° of bearing — a "cone" is what
        // you get when the answer is "almost none"
        const fine = band([8, 63]);
        thinnest = Math.min(thinnest, ...shares);
        peakiest = Math.max(peakiest, peak);
        if (fine < coarsest) { coarsest = fine; at = `${key} ring ${mi}`; }
        rows.push(`${key}${mi} ${shares.map((v) => (v * 100).toFixed(0)).join('/')}`);
      }
      dome.dispose();
      terrain.dispose();
    }
    assert(rows.length >= 9, 'no outdoor level built ranges to measure');
    assert(thinnest > 0.05,
      `an octave band of the skyline carries only ${(thinnest * 100).toFixed(1)}% of its energy — ` +
      'a ridgeline has structure at every scale, and a missing band is a scale the eye reads as drawn');
    assert(peakiest < 0.25,
      `one harmonic carries ${(peakiest * 100).toFixed(0)}% of a skyline — that is a cone, not a range`);
    assert(coarsest > 0.45,
      `${at} puts only ${(coarsest * 100).toFixed(0)}% of its silhouette into features under 45° of ` +
      'bearing — the horizon is a handful of big lumps');
    return `${rows.length} rings, octave shares k2-3/4-7/8-15/16-31/32-63 = ${rows.join(', ')} %, ` +
      `worst band ${(thinnest * 100).toFixed(1)}%, tallest harmonic ${(peakiest * 100).toFixed(0)}%`;
  });

  check('sky: the painted skyline is the sky times an extinction, and a storm takes it away', () => {
    /* The dome and the geometry do different jobs: the geometry owns 170-340 m
     * and parallaxes, the dome owns everything past it and does not.
     *
     * There used to be four painted ranges, mixed toward the haze at
     * 0.08 / 0.18 / 0.32 / 0.50. Composited contrast is exactly
     * alpha × mix × (land − haze), so the top two landed under two per cent of
     * the sky's luminance once the grade was applied: below the threshold at
     * which anything is a shape. Two ranges that can be seen beat four where
     * half are paid for and not delivered — and both are now the SKY IN THAT
     * DIRECTION times a per-range extinction, so neither can come out brighter
     * than what is behind it whatever the level authored. */
    const src = SKY_SOURCE();
    const bands = (src.match(/float ridge(Far|Near)\s*=/g) || []).length;
    assert(bands === 2, `the dome paints ${bands} ranges`);
    assert(/uSkyBand/.test(src) && /texture2D\(uSkyBand/.test(src),
      'the dome has no directional sky, so its skyline is one colour round the whole compass again');
    /* These used to be vec3 and this check used to demand they be
     * Rayleigh-ORDERED — which sounds like physics and is the bug. A
     * per-channel constant multiplied onto the sky raises blue-over-red by a
     * fixed factor whatever colour that sky is, so the painted skyline
     * converged on a colour its own sky never reaches; on canyon, where the
     * sky at 8° runs warm, that painted a blue ridge against a gold horizon.
     * The shortfall a landform has against its sky is in VALUE. So: scalars,
     * and whatever chroma the range carries of its own has to be bounded by
     * the sky's rather than added to it. */
    const tints = [...src.matchAll(/const float BAND_(FAR|NEAR)\s*=\s*([0-9.]+)/g)]
      .map((m) => [m[1], Number(m[2])]);
    assert(tints.length === 2, 'the painted ranges no longer declare their extinction');
    assert(!/const vec3 BAND_(FAR|NEAR)/.test(src),
      'a painted range is back on a per-channel extinction, which tints the sky it is standing in');
    for (const [name, t] of tints) {
      assert(t > 0 && t < 1, `BAND_${name} is not an extinction — ${t}`);
      // ~2% of the sky's own luminance is where a soft-edged shape stops being
      // a shape. Both ranges have to clear that by a wide margin.
      assert(1 - t > 0.08, `BAND_${name} sits ${((1 - t) * 100).toFixed(1)}% under its sky — invisible`);
    }
    assert(/BAND_CHROMA\s*=\s*0?\.\d+/.test(src) && /BAND_CHROMA \* skySat/.test(src),
      'the painted skyline no longer holds its own chroma under the sky it stands in');

    /* ── and the front has to reach the sky, not just the bottom of it ──
     * Forced to peak on the dune sea, the horizon band moved luminance
     * 0.511 → 0.731 and saturation 0.197 → 0.064, and the sky 200 px above it
     * moved 1.4%: an 80 m whiteout under a clear blue sky with crisp cumulus
     * and a hard sun. So uStorm has to be in the coverage, in the deck's own
     * sunlit term, and in a lid over the WHOLE dome — and the lid is ported
     * here rather than pattern-matched, because "the source mentions uStorm"
     * is exactly the kind of assertion that passes while nothing moves. */
    assert(/uStorm/.test(src), 'the dome cannot see the weather, so the skyline survives a dust storm');
    assert(/mix\(0\.10, 0\.62, uStorm\)/.test(src),
      'the skyline haze band does not lift during a front — dust does not stay near the ground');
    assert(/uCoverage \+ front \* ([0-9.]+)/.test(src),
      'a front brings no cloud with it — the deck over a dust storm is still fair weather');
    assert(/\* \(1\.0 - 0\.\d+ \* front\)/.test(src),
      'the cloud deck keeps its full sunlit face through a front, so the sun never goes out');
    const lidM = src.match(/front \* mix\(1\.0, ([0-9.]+), smoothstep\(0\.0, ([0-9.]+),/);
    assert(lidM, 'there is no whole-dome lid, so a storm is still a band at the bottom of the sky');
    const [, hiFall, span] = lidM.map(Number);
    const gain = Number(src.match(/float w = clamp\(lid \* ([0-9.]+)/)[1]);
    const smooth = (t) => { const x = Math.min(1, Math.max(0, t)); return x * x * (3 - 2 * x); };
    const frontM = src.match(/float front = smoothstep\(([0-9.]+), 1\.0, uStorm\)/);
    assert(frontM, 'nothing separates a front from the air merely not being still');
    const gate = Number(frontM[1]);
    const front = (storm) => smooth((storm - gate) / (1 - gate));
    const lid = (e, storm) =>
      Math.min(1, front(storm) * (1 + (hiFall - 1) * smooth(e / span)) * gain);
    // 12° up is where the "sky 200 px above the horizon" reading was taken;
    // the zenith is the sky that never moved at all.
    const at12 = lid(Math.sin(12 * Math.PI / 180), 1), atZen = lid(1, 1);
    assert(at12 > 0.85, `a full front covers only ${(at12 * 100).toFixed(0)}% of the sky 12° up`);
    assert(atZen > 0.55, `a full front covers only ${(atZen * 100).toFixed(0)}% of the zenith — ` +
      'the player can look up and see there is no weather');
    /* AND THE OTHER WAY. `unrest` rides under every level permanently so the
     * calm between squalls is not a flat line; if the lid read it, fair weather
     * would carry a permanent film of dust across the whole dome, which is the
     * same bug as a storm that never leaves the ground pointing the other way.
     * Same class as the `min` against the fog cap that quietly re-lit a hangar
     * with no weather in it. */
    let worstCalm = 0, calmAt = '';
    for (const key of LEVEL_ORDER) {
      const w = LEVELS[key].dust && LEVELS[key].dust.weather;
      if (!w || !w.peak) continue;
      // the most "storm" a level ever carries with no squall running at all
      const calm = w.peak * (w.unrest ?? 0.14);
      if (calm > worstCalm) { worstCalm = calm; calmAt = key; }
      assert(front(calm) <= 0,
        `${key} sits at ${calm.toFixed(3)} storm in calm air and the sky reads it as a front`);
    }
    const contrast = tints.map(([n, t]) => `${n} ${((1 - t) * 100).toFixed(1)}%`).join(', ');
    return `2 painted ranges off the sky band, scalar contrast ${contrast}, chroma held under the sky's; ` +
      `at full storm the dome covers ${(at12 * 100).toFixed(0)}% at 12° and ${(atZen * 100).toFixed(0)}% at the zenith, ` +
      `and nothing at all in calm air (worst unrest ${calmAt} ${worstCalm.toFixed(3)}, gate ${gate})`;
  });

  /* ══ advection ═══════════════════════════════════════════════════════
   *
   * `position += windAt(p) * t` is what every carried layer in this file did,
   * and it is not advection. `windAt` is a function of time, so that product
   * differentiates to `w + t·dw/dt` and the second term has no bound: a fleck
   * that should drift at 2 m/s reaches 20 m/s a minute in, 304 m/s at ten
   * minutes, and 2701 m/s at ten minutes of storm wind. The `mod` wrap hid it
   * — the flecks never flew off screen, they turned into static — which is
   * exactly why nothing caught it.
   */

  check('wind: what the air CARRIES moves at the wind\'s speed, ten minutes in as much as one', () => {
    const w = new WindField({ heading: 0.7, strength: 1.7, gustiness: 0.62 });
    w.wander = 0; w._refresh();
    const sites = [[3, -7], [40, 25], [-18, 60], [-90, -110]];
    const rows = [];
    for (const [strength, gustiness] of [[1.7, 0.62], [8, 0.84], [16, 0.95]]) {
      w.strength = strength; w.gustiness = gustiness;
      let sumE = 0, sumW = 0, maxSpeed = 0, maxErr = 0;
      const h = 1 / 240;
      // fifteen minutes, which is longer than anyone plays one level
      for (let t = 0; t < 900; t += 0.05) {
        for (const [x, z] of sites) {
          const a = w.drift(x, z, t), b = w.drift(x, z, t + h);
          const vx = (b.x - a.x) / h, vz = (b.y - a.y) / h;
          const truth = w.sample(x, z, V(0, 0, 0), t);
          const e = Math.hypot(vx - truth.x, vz - truth.z);
          sumE += e * e; sumW += truth.x * truth.x + truth.z * truth.z;
          maxErr = Math.max(maxErr, e);
          maxSpeed = Math.max(maxSpeed, Math.hypot(vx, vz));
        }
      }
      const rel = Math.sqrt(sumE / sumW);
      /* What is dropped is the gust×swirl cross term and the swirl's second
       * harmonic — see SWIRL_MEAN / SWIRL_H1. A tenth of the wind, and it does
       * not grow with the wind or with the clock, which is the whole point. */
      assert(rel < 0.12,
        `the drift's own velocity is ${(rel * 100).toFixed(1)}% off the wind it is supposed to be`);
      // and the thing that actually broke: no runaway, at any strength, ever
      assert(maxSpeed < strength * 2.4,
        `something carried by a ${strength} m/s wind reaches ${maxSpeed.toFixed(0)} m/s`);
      rows.push(`${strength} m/s: ${(rel * 100).toFixed(1)}% err, tops out at ` +
        `${maxSpeed.toFixed(1)} m/s (${(maxSpeed / strength).toFixed(2)}×)`);
    }
    // and no carried layer may go back to multiplying a velocity by the clock
    const src = SCENERY_SOURCE();
    assert(/vec2 windDrift\(vec2 p, float t\)/.test(src),
      'WIND_GLSL has no drift, so nothing in a shader can be advected honestly');
    const carried = src.match(/p\.xz \+= [^;]*;/g) || [];
    assert(carried.length >= 3, `only ${carried.length} layers offset themselves horizontally at all`);
    for (const line of carried) {
      assert(/windDrift/.test(line),
        `a layer is back on velocity × clock, which has no bound: ${line.trim()}`);
    }
    return `${carried.length} carried layers on the integrated wind; ${rows.join('; ')}`;
  });

  check('wind: a level points the prevailing wind, and gives it back when it unloads', () => {
    /* The wind was a module singleton with hardcoded defaults — heading 0.62,
     * 1.7 m/s, gustiness 0.62 — so a level could not say which way its own
     * weather came from. Making it per-level must not make it per-SYSTEM:
     * there is still exactly one WindField and everything still samples it. */
    assert(typeof windSettings === 'function', 'a level has no way to author the wind');
    // the compass a level writes in, resolved the way `atmosphere.azimuth` is
    const east = windSettings({ from: 270 });        // a westerly blows toward +x
    near(Math.cos(east.heading), 1, 1e-9, 'a westerly does not blow toward +x');
    near(Math.sin(east.heading), 0, 1e-9, 'a westerly has a cross-wind component');
    const north = windSettings({ from: 180 });       // a southerly blows toward +z
    near(Math.sin(north.heading), 1, 1e-9, 'a southerly does not blow toward +z');
    // saying nothing gets the documented default, not the last level's gale
    for (const k of ['heading', 'strength', 'gustiness', 'wander']) {
      near(windSettings({})[k], WIND_DEFAULTS[k], 1e-12, `an unauthored ${k} is not the default`);
    }
    // gustiness cannot be pushed past where the gust field stays positive, or
    // the closed-form drift stops being the integral of a wind that exists
    assert(windSettings({ gustiness: 5 }).gustiness < 1,
      'a level can author a gustiness that makes the wind blow backwards');

    const scene = litOutdoor();
    const before = { heading: wind.baseHeading, strength: wind.strength, gust: wind.gustiness, wander: wind.wander };
    const a = new Atmosphere(scene, {
      count: 60, density: 0.4,
      wind: { from: 250, strength: 4.2, gustiness: 0.55, wander: 0.3 },
      weather: { peak: 1, period: 120, duration: 40, phase: 0, windGain: 2.9 },
    });
    near(wind.strength, 4.2, 1e-9, 'the level authored a 4.2 m/s prevailing and did not get it');
    near(wind.wander, 0.3, 1e-9, 'the level pinned its heading and the wind roamed anyway');
    // and the storm multiplies the LEVEL's calm air, not the engine's default
    let peak = 0;
    for (let i = 0; i < 400; i++) { a.update(0.1, V(0, 0, 0)); peak = Math.max(peak, wind.strength); }
    assert(peak > 4.2 * 3.5 && peak < 4.2 * 4.2,
      `a 2.9× gain off a 4.2 m/s prevailing reached ${peak.toFixed(1)} m/s`);
    a.dispose();
    for (const [k, v] of [['baseHeading', before.heading], ['strength', before.strength],
      ['gustiness', before.gust], ['wander', before.wander]]) {
      near(wind[k], v, 1e-9, `the level kept the shared wind's ${k} after unloading`);
    }
    // one field, still
    assert(ground.wind === wind, 'something forked the wind');
    return `from 250° at 4.2 m/s gusting to ${peak.toFixed(1)}; heading/strength/gust/wander all handed back`;
  });

  /* ══ precipitation ═══════════════════════════════════════════════════ */

  check('snow: it FALLS — at its own speed, and the wind rakes the fall over', () => {
    /* Nothing in this engine fell. Every particle layer was horizontal —
     * motes hang, sheets skim, banks roll past — which is the right model for
     * dust and the wrong one for weather coming out of the sky.
     *
     * The trajectory is ported out of the vertex shader here rather than
     * asserted about, because "the source mentions gravity" is the kind of
     * check that passes while the flakes hang in the air. */
    const scene = litOutdoor();
    const a = new Atmosphere(scene, {
      count: 40, density: 1, snow: { count: 900, calm: 1, span: 48, height: 26, fall: [0.7, 1.9] },
    });
    assert(a.snow && a.snow.mesh, 'a level asked for snow and got none');
    const A = a.snow.mesh.geometry.attributes;
    const H = a.snow.height;

    // ── every flake has its OWN terminal velocity, or the column is a rigid
    // curtain sliding down the screen and the eye locks onto the spacing
    const terms = [];
    for (let i = 0; i < a.snow.count; i++) terms.push(A.aFlake.array[i * 4]);
    const tMin = Math.min(...terms), tMax = Math.max(...terms);
    assert(tMax / tMin > 2, `terminal velocity runs ${tMin.toFixed(2)}–${tMax.toFixed(2)} m/s — one speed for all`);
    assert(tMin > 0.3 && tMax < 3.5, `${tMin.toFixed(2)}–${tMax.toFixed(2)} m/s is not snow, it is rain or ash`);

    const flake = (i, t) => {
      const hx = A.aHome.array[i * 4], hz = A.aHome.array[i * 4 + 1];
      const vT = A.aFlake.array[i * 4], phase = A.aFlake.array[i * 4 + 1];
      const flut = A.aFlake.array[i * 4 + 2], tumble = A.aFlake.array[i * 4 + 3];
      const cyc = H / vT;
      const age = ((t + phase * cyc) % cyc + cyc) % cyc;
      const d1 = wind.drift(hx, hz, t), d0 = wind.drift(hx, hz, t - age);
      const ph = phase * 6.2831 + t * tumble;
      return {
        x: hx + (d1.x - d0.x) + Math.sin(ph) * flut,
        z: hz + (d1.y - d0.y) + Math.cos(ph * 0.73 + 1.1) * flut,
        y: H - vT * age + Math.sin(ph * 1.6) * 0.11,
        age, vT, cyc,
      };
    };

    const rows = [];
    for (const [name, strength] of [['still', 0.2], ['breeze', 3.0], ['blizzard', 14.0]]) {
      wind.configure({ heading: 0.4, strength, gustiness: 0.6, wander: 0 });
      let sumFall = 0, sumSlant = 0, sumDrift = 0, n = 0, wobbles = 0;
      const h = 1 / 120;
      for (let i = 0; i < 220; i++) {
        // sample away from the recycle so the difference is one flake's motion
        const t = 3 + (i % 11) * 0.9;
        const f0 = flake(i, t), f1 = flake(i, t + h);
        if (f1.age < f0.age) continue;                    // it recycled between frames
        const vy = (f1.y - f0.y) / h;
        const vx = (f1.x - f0.x) / h, vz = (f1.z - f0.z) / h;
        sumFall += -vy; sumDrift += Math.hypot(vx, vz);
        sumSlant += Math.atan2(Math.hypot(vx, vz), Math.max(1e-6, -vy));
        n++;
        // and the lateral track is not a straight line: a plate rocks
        const back = flake(i, t + 0.9);
        if (Math.sign(f1.x - f0.x) !== Math.sign(back.x - f1.x)) wobbles++;
      }
      const fall = sumFall / n, drift = sumDrift / n, slant = (sumSlant / n) * 180 / Math.PI;
      const air = wind.strengthAt(0, 0);
      assert(fall > 0.4 && fall < 3.2, `flakes fall at ${fall.toFixed(2)} m/s in ${name} air`);
      /* CARRIED, not pushed: the horizontal speed IS the air's, so the snow
       * agrees with the grass, the sheets and the banks about what the wind is
       * doing. This is the assertion that a "snow" made of downward-only
       * particles with a fudge factor cannot pass. */
      assert(Math.abs(drift - air) < air * 0.35 + 0.25,
        `the air is moving at ${air.toFixed(1)} m/s and the snow at ${drift.toFixed(1)} m/s`);
      if (name === 'still') {
        assert(slant < 35, `flakes fall ${slant.toFixed(0)}° off vertical in still air`);
        assert(wobbles > 20, `only ${wobbles} of ${n} flakes changed lateral direction — they fall on rails`);
      }
      if (name === 'blizzard') {
        assert(slant > 70, `a 14 m/s gale only rakes the fall to ${slant.toFixed(0)}° off vertical`);
      }
      rows.push(`${name} ${fall.toFixed(2)} m/s down, ${drift.toFixed(1)} across, ${slant.toFixed(0)}° off vertical`);
    }
    /* ── A STREAK, NOT A SCRATCH. The quad stretches along the flake's own
     * velocity, which is what makes driven snow read as driven; the first
     * version also NARROWED it across by the factor Particles.js narrows a
     * spark by, and the screenshot came back with 1-pixel-by-18-pixel
     * hairlines that looked like dirt on the lens. A spark is a point source
     * and has to narrow. A flake is an object being motion-blurred, and motion
     * blur lengthens a smear without thinning it. */
    {
      const u = a.snow.mat.uniforms;
      const aspect = (speed, face) =>
        (1 + Math.min(speed * u.uStreak.value, 2)) / (0.4 + 0.6 * face);
      assert(aspect(1.3, 1) < 1.35, `a flake falling in still air is already ${aspect(1.3, 1).toFixed(1)}:1`);
      assert(aspect(17, 1) > 2, 'a 17 m/s gale does not stretch the flake at all');
      assert(aspect(17, 1) < 4, `a gale stretches a flake to ${aspect(17, 1).toFixed(1)}:1 — that is a scratch`);
      assert(aspect(60, 1) < 4, 'the streak has no cap, so a runaway wind draws hairlines');
    }

    // ── and the column is a POOL: a flake that reaches the ground is the flake
    // that appears at the top, so nothing is allocated and nothing escapes.
    wind.configure({ strength: 6, gustiness: 0.6, wander: 0 });
    let lowest = Infinity, highest = -Infinity;
    for (let t = 0; t < 240; t += 0.37) {
      for (let i = 0; i < 60; i++) {
        const f = flake(i, t);
        lowest = Math.min(lowest, f.y); highest = Math.max(highest, f.y);
      }
    }
    assert(lowest > -0.4 && highest < H + 0.4,
      `flakes reach ${lowest.toFixed(1)}–${highest.toFixed(1)} m in a ${H} m column`);
    a.dispose();
    wind.configure({});
    return `${rows.join('; ')}; column ${lowest.toFixed(2)}–${highest.toFixed(1)} m of ${H}, ` +
      `terminal ${tMin.toFixed(2)}–${tMax.toFixed(2)} m/s`;
  });

  check('snow: the front decides how hard it comes down, and calling for none costs nothing', () => {
    /* Two properties in one, because they are the same property: the pool is
     * a fixed allocation and the WEATHER decides what share of it is falling.
     * A blizzard that costs its peak all the time is a particle count, which
     * is the thing the whole weather system exists not to be. */
    const bare = litOutdoor();
    const n0 = bare.children.length;
    const dry = new Atmosphere(bare, { count: 100, density: 1 });
    assert(bare.children.length === n0 + 5, 'the air without snow is not five draw calls');
    assert(dry.snow && !dry.snow.mesh && !dry.snow.mat,
      'a level that never snows still built a snow shader');
    dry.dispose();

    // the tier scales it, like every other pool in the air
    const thin = new Atmosphere(litOutdoor(), { count: 100, density: 0.4, snow: { count: 2600 } });
    near(thin.snow.count, Math.floor(2600 * 0.4), 0.5, 'the quality tier does not reach the snow');
    thin.dispose();
    // and a typo cannot allocate a million quads
    const huge = new Atmosphere(litOutdoor(), { count: 100, density: 2, snow: { count: 900000 } });
    assert(huge.snow.count <= 14000, `a level asked for 900k flakes and got ${huge.snow.count}`);
    // …while a blizzard authored for `high` still fits at `ultra` unclamped
    const ultra = new Atmosphere(litOutdoor(), { count: 100, density: 1.35, snow: { count: 9000 } });
    assert(ultra.snow.count === Math.floor(9000 * 1.35),
      `the top tier silently clamps a 9000-flake blizzard to ${ultra.snow.count}`);
    ultra.dispose();
    huge.dispose();

    /* Built LAST, because `weather` is one shared scheduler and constructing
     * any Atmosphere re-configures it — which is the correct design (there is
     * one storm over one world) and a trap for a check that builds several. */
    const scene = litOutdoor();
    const before = scene.children.length;
    const a = new Atmosphere(scene, {
      count: 100, density: 1,
      snow: { count: 2600, calm: 0.18 },
      weather: { peak: 1, period: 120, duration: 40, phase: 0 },
    });
    assert(scene.children.length === before + 6, 'snow costs more than one draw call');
    assert(a.snow.count === 2600, `2600 flakes became ${a.snow.count}`);

    // ── the front drives it
    let calm = Infinity, peak = -Infinity, atCalm = 0, atPeak = 0;
    for (let i = 0; i < 400; i++) {
      a.update(0.1, V(0, 0, 0));
      const live = a.snow.mat.uniforms.uFall.value;
      if (a.weather.intensity < calm) { calm = a.weather.intensity; atCalm = live; }
      if (a.weather.intensity > peak) { peak = a.weather.intensity; atPeak = live; }
    }
    assert(peak > 0.9 && calm < 0.1, `the storm ran ${calm.toFixed(2)}–${peak.toFixed(2)}`);
    assert(atPeak > atCalm * 3,
      `the fall goes ${atCalm.toFixed(2)} → ${atPeak.toFixed(2)} of the pool — that is a fixed flurry`);
    assert(atCalm > 0.05, 'between fronts it stops snowing entirely on a level that says it is snowing');
    assert(atPeak <= 1.0001, `the front asks for ${atPeak.toFixed(2)} of a pool that only has 1`);
    a.dispose();
    assert(scene.children.length === before, 'the snow leaked its mesh on dispose');
    return `off: no mesh, no material, 5 calls. on: 1 call, 2600 instances, ` +
      `${(atCalm * 100).toFixed(0)}% falling in calm air and ${(atPeak * 100).toFixed(0)}% at the peak`;
  });

  check('weather: a blizzard is the same machine as a dust storm with different air in it', () => {
    /* The scheduler couples ONE intensity to fog, key, fill, wind and every
     * layer, and it must not have "sand" written into it anywhere: the same
     * machine has to deliver a brown-out and a white-out from the same shape
     * of level entry. What separates them is what the level says is in the
     * air, and nothing else. */
    const build = (air, snow, tint) => {
      const scene = litOutdoor();
      scene.fog = new THREE.FogExp2(air, 0.0072);
      const a = new Atmosphere(scene, {
        count: 120, density: 0.5, color: air,
        wind: { strength: 3.4, gustiness: 0.5, wander: 0 },
        snow: snow ? { count: 400, calm: 0.15 } : undefined,
        weather: { peak: 1, period: 120, duration: 40, phase: 0, unrest: 0, fogGain: 4.2,
          windGain: 2.9, sunLoss: 0.82, fillGain: 1.3, tint },
      });
      const sun = a.sun, hemi = a.hemi;
      const cold = { key: sun.intensity, fill: hemi.intensity, vis: a.weather.visibility(0.0072) };
      assert(a.weather.intensity === 0, 'the calm baseline was read mid-front');
      let top = null;
      for (let i = 0; i < 400; i++) {
        a.update(0.1, V(0, 0, 0));
        if (!top || a.weather.intensity > top.I) {
          top = { I: a.weather.intensity, key: sun.intensity, fill: hemi.intensity,
            vis: a.weather.visibility(0.0072), sunB: sun.color.b, sunR: sun.color.r,
            fall: a.snow.mesh ? a.snow.mat.uniforms.uFall.value : 0 };
        }
      }
      a.dispose();
      return { cold, top, clear: { r: sun0.r, b: sun0.b } };
    };
    const sun0 = new THREE.Color(0xfff0d8);
    const clearBR = sun0.b / sun0.r;
    const sand = build(0xd8c8a8, false, 0.6);
    const blizzard = build(0xdfe9ff, true, 0.92);

    for (const [name, r] of [['sandstorm', sand], ['blizzard', blizzard]]) {
      assert(r.top.vis < r.cold.vis * 0.28,
        `${name}: visibility ${r.cold.vis.toFixed(0)} → ${r.top.vis.toFixed(0)} m`);
      assert(r.top.key < r.cold.key * 0.65, `${name}: the key light barely moved`);
      assert(r.top.fill > r.cold.fill * 1.2, `${name}: the fill did not come up`);
    }
    /* THE ONE THING THAT HAS TO DIFFER: what the sun turns into. A front takes
     * the beam apart and hands back the colour of what is in the air, so the
     * SAME arithmetic gives a browner sun over sand and a colder, paler one
     * over snow — which is the whole of "a blizzard, not a sandstorm with the
     * swatches changed". If this ever stops separating, the coupling has an
     * assumption about deserts baked into it. */
    const sandBR = sand.top.sunB / sand.top.sunR, snowBR = blizzard.top.sunB / blizzard.top.sunR;
    assert(sandBR < clearBR,
      `the sun over a dust storm went from B/R ${clearBR.toFixed(2)} to ${sandBR.toFixed(2)} — it got bluer`);
    assert(snowBR > clearBR * 1.5,
      `the sun in a whiteout only reached B/R ${snowBR.toFixed(2)} against ${clearBR.toFixed(2)} in clear air`);
    assert(snowBR > sandBR * 1.6, 'the two fronts light the world the same colour');
    // and only one of the two has anything falling out of it
    assert(sand.top.fall === 0 && blizzard.top.fall > 0.9,
      'the snow is not what tells the two apart');
    return `sun B/R ${clearBR.toFixed(2)} clear → ${sandBR.toFixed(2)} in sand, ${snowBR.toFixed(2)} in snow; ` +
      `both ${sand.cold.vis.toFixed(0)} → ${sand.top.vis.toFixed(0)} m, key ×` +
      `${(sand.top.key / sand.cold.key).toFixed(2)}, fill ×${(sand.top.fill / sand.cold.fill).toFixed(2)}`;
  });
}

/** A scene with a sky, a sun hard enough for a mirage, and a fill. */
function litOutdoor() {
  const scene = new THREE.Scene();
  const sun = new THREE.DirectionalLight(0xfff0d8, 7);
  sun.position.set(30, 60, 20); sun.castShadow = true;
  scene.add(sun);
  scene.add(new THREE.HemisphereLight(0xcfe0f5, 0x8a6a44, 0.30));
  scene.fog = new THREE.FogExp2(0xd8c8a4, 0.0042);
  return scene;
}

/** Scenery's own source, for the assertions that are about what the SHADERS
 *  do — their code is module-private template literals, and a copy of it in
 *  here would agree with itself forever. */
let _scenerySrc = null;
function SCENERY_SOURCE() {
  if (_scenerySrc === null) {
    _scenerySrc = readFileSync(new URL('../../src/world/Scenery.js', import.meta.url), 'utf8');
  }
  return _scenerySrc;
}

/** `1 + gain·wave` must stay positive, or the crest of every band bends upwind. */
function lay0Positive(gain) { return gain * 1.25 < 1; }

/**
 * The sky dome's source. Its shader is a module-private template literal, so
 * the only honest way to assert on it is to read the file — a copy of the
 * constants in here would agree with itself forever.
 */
let _skySrc = null;
function SKY_SOURCE() {
  if (_skySrc === null) {
    _skySrc = readFileSync(new URL('../../src/engine/SkyDome.js', import.meta.url), 'utf8');
  }
  return _skySrc;
}
