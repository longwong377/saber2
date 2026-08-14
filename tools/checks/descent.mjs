/**
 * THE DESCENT, AS A PLACE — src/game/Levels.js, src/world/Terrain.js.
 *
 * `run.mjs` holds the LADDER: that it ends, that every rung is somewhere the
 * game can go, that it goes down and that the light goes with it. This file
 * holds the three claims the ROOMS make, none of which the ladder can check
 * because none of them are properties of a list.
 *
 *   1. AN INTERIOR HAS A ROOF. The first render of all four new interiors had
 *      the same fault and it was invisible to every existing check: above the
 *      walls there was nothing at all. A level with `sky: false` paints a flat
 *      `bgColor` behind everything, so the top third of the frame was an empty
 *      black field and the room read as a courtyard at night. Nothing in the
 *      suite asked whether a room has a ceiling, because until now the only
 *      interiors in the game were hand-built and happened to have one.
 *
 *   2. AN INTERIOR HAS WALLS THE PLAYER CANNOT WALK OVER. The rooms are made
 *      out of the heightfield — a Chebyshev shell rising at the room's edge —
 *      and the difference between a wall and a ramp is one number in a
 *      smoothstep. Written first as 78 → 134 it was a 51° slope, and the
 *      walkable disc every survey in the suite measures ran straight up and
 *      over it: the level was a bowl, not a hall.
 *
 *   3. THE LIGHT IS IN THE ROOM AND NOT ONLY IN THE ATMOSPHERE BLOCK. A rung
 *      whose air says `sunIntensity: 0.12` is a dark room only if something is
 *      actually lighting the parts of it that are meant to be lit; the deeps
 *      is supposed to be navigable by the fittings somebody left on, and a
 *      level that authored none of them would be uniformly black rather than
 *      dark.
 */

import * as THREE from 'three';
import { initPhysics } from '../../src/physics/Rapier.js';
import { World } from '../../src/game/World.js';
import { DEFAULT_SETTINGS } from '../../src/ui/Menu.js';
import { Terrain, TERRAIN_PRESETS } from '../../src/world/Terrain.js';
import { GrassField } from '../../src/world/Scenery.js';
import { LEVELS, LEVEL_ORDER } from '../../src/game/Levels.js';
import { DESCENT } from '../../src/game/Run.js';

function stubWorld(terrain) {
  const scene = new THREE.Scene();
  return {
    scene, statics: [], levelLights: [], props: [], enemies: [], doors: [], grass: null,
    physics: { addStaticBox() {}, staticBoxes: [], add() {}, bodies: [], raycast: () => null },
    addLight(l) { scene.add(l); return l; },
    addProp(p) { this.props.push(p); return p; },
    addDoor(d) { this.doors.push(d); return d; },
    particles: { sandPuff() {}, sparkBurst() {}, slag() {} },
    notify() {}, report() {}, spawnEnemy: () => null,
    time: 0, terrain, settings: { quality: 'medium' }, level: null,
  };
}

/**
 * The thirty-line engine a real World runs on — the one lifecycle.mjs proved
 * out. Nothing here needs a GL context.
 */
function stubEngine() {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(60, 16 / 9, 0.045, 900);
  const sun = new THREE.DirectionalLight(0xffffff, 1);
  sun.shadow.camera.updateProjectionMatrix();
  const hemi = new THREE.HemisphereLight(0x88aaff, 0x886644, 1);
  scene.add(sun, hemi);
  return {
    scene, camera, sun, hemi,
    sunDir: new THREE.Vector3(0.4, 0.7, 0.5).normalize(),
    renderer: { info: { render: { calls: 0, triangles: 0 }, memory: { geometries: 0, textures: 0 } } },
    profiler: { begin() {}, end() {}, beginDraw() {}, endDraw() {}, dispose() {} },
    applyAtmosphere() {}, fitShadows() {}, flash() {}, hurt() {}, addHeat() {},
    setFocus() {}, setRadial() {}, setGrain() {}, setBloom() {}, setSense() {},
    setQuality() {}, setResolutionScale() {}, render() {},
  };
}

/** Nothing pressed but the movement axis. */
const idleInput = (x = 0, y = 0) => ({
  act: () => false, actHit: () => false, actDown: () => false,
  moveAxis(o) { if (o) { o.x = x; o.y = y; return o; } return { x, y }; },
  mouse: { dx: 0, dy: 0, wheel: 0, left: false, right: false },
  delta: { x: 0, y: 0 }, accel: { x: 0, y: 0 },
  end() {},
});

let DRESSED = null;
/** Every interior in the game, dressed once, the way World.loadLevel does. */
function interiors() {
  if (DRESSED) return DRESSED;
  DRESSED = new Map();
  for (const key of LEVEL_ORDER) {
    const L = LEVELS[key];
    if (!L || typeof L.dress !== 'function' || L.atmosphere.sky !== false) continue;
    const terrain = new Terrain(new THREE.Scene(), L.terrain, 0.5);
    const world = stubWorld(terrain);
    world.level = L;
    const grass = L.grass
      ? new GrassField(new THREE.Scene(), terrain, { count: 4000, density: L.grass, radius: 46 })
      : null;
    L.dress(world);
    DRESSED.set(key, { L, world, terrain });
    grass?.dispose();
  }
  return DRESSED;
}

export function run({ check, assert }) {

  check('rooms: every interior has something over the player\'s head', () => {
    /* A vertical ray from twenty places on the floor. What it has to hit is
     * geometry ABOVE head height and BELOW the point where a shadow map stops
     * caring — a ceiling, in other words, rather than the top of a tank.
     *
     * The 60% bar is not a rounding allowance: the intake's roof has a 60 m
     * light well cut across it and the whole point of that well is that you
     * can see out of it. What must not happen is a room with no roof at all,
     * which is what every one of these had on its first render. */
    const rows = [];
    const ray = new THREE.Raycaster();
    const up = new THREE.Vector3(0, 1, 0);
    for (const [key, d] of interiors()) {
      /* The scene is never rendered here, and `addWall` sets
       * `matrixAutoUpdate = false`: without this the roof's matrixWorld is the
       * identity and every ray misses a ceiling that is demonstrably there.
       * (It is what this check first reported as "the temple has no roof".) */
      d.world.scene.updateMatrixWorld(true);
      const meshes = [];
      d.world.scene.traverse((o) => { if (o.isMesh && o.geometry) meshes.push(o); });
      let hits = 0, n = 0, lowest = Infinity, highest = 0;
      const heights = [];
      /* OVER THE WHOLE FLOOR, on a grid, rather than round a ring at r ≤ 50.
       * The intake's roof has a 60 m light well cut straight across it, so a
       * ring sampled near the middle lands mostly in the opening and scored a
       * correctly-roofed hall at 25%. The plan is the honest denominator. */
      for (let z0 = -64; z0 <= 64; z0 += 8) for (let x0 = -64; x0 <= 64; x0 += 8) {
        const x = x0 + 1.3, z = z0 - 0.7;              // off the bay lattice
        const y = d.terrain.height(x, z) + 1.8;
        ray.set(new THREE.Vector3(x, y, z), up);
        ray.far = 40;
        const hit = ray.intersectObjects(meshes, false);
        n++;
        /* ABOVE FOUR METRES, or it is not a ceiling. A grid over a dressed
         * floor lands on fallen columns and crate stacks, and the first form
         * of this check reported a temple ceiling 0.4 m over the player's head
         * because the ray started under a piece of rubble. What is being asked
         * is whether there is a ROOF, so anything at head height is not an
         * answer to it. */
        const top = hit.find((h) => h.point.y - y > 4.0);
        if (top) {
          hits++;
          heights.push(top.point.y - y);
          lowest = Math.min(lowest, top.point.y - y);
          highest = Math.max(highest, top.point.y - y);
        }
      }
      heights.sort((a, b) => a - b);
      /* 55%, and the number is set by the one room that is MEANT to be open
       * to the sky: the intake's light well takes 60 m out of a 160 m plan, so
       * a correctly roofed intake is about 62% covered and a roofless room is
       * near zero. There is no value between them to argue about. */
      assert(hits / n > 0.55,
        `${key}: only ${(hits / n * 100).toFixed(0)}% of the floor has anything over it — `
        + 'an interior with no ceiling renders as a flat bgColor above the walls, which reads as night');
      const median = heights[(heights.length * 0.5) | 0];
      assert(median > 6.0,
        `${key}: the median thing over the player's head is ${median.toFixed(1)} m up — `
        + 'that is a gantry deck, not a ceiling');
      rows.push(`${key} ${(hits / n * 100).toFixed(0)}% covered, median ${median.toFixed(1)} m `
        + `(${lowest.toFixed(1)}–${highest.toFixed(1)})`);
    }
    assert(rows.length >= 4, `only ${rows.length} interiors surveyed`);
    return rows.join('; ');
  });

  check('rooms: an interior is a room because a body cannot get out of it', async () => {
    /**
     * THIS CHECK USED TO BE A LIE, AND IT IS WORTH SAYING HOW.
     *
     * It asserted that every one of sixteen bearings out of each room crossed
     * ground with `slopeAt > 0.55`, "the number every survey in the suite
     * already uses to mean not ground you can stand on". That number has no
     * reader anywhere in src/. The movement code's own gate is 0.52 on
     * `1 - n.y`, and until this pass the only thing it did was add a downhill
     * nudge of `(slope - 0.52) * 26` — at most 12.5 m/s² against a walk that
     * pulls `damp(v, 4.6, 19.3)`, i.e. 88.9 m/s² from rest. Steady state on a
     * VERTICAL face was still 3.95 m/s uphill.
     *
     * So the survey passed, reporting shells of 0.64-0.80, while a real player
     * holding W walked up those shells and out over the roof of every room in
     * the game: the intake finished at y = 46.0 m at r = 107 m (its roof is at
     * 16.5), the deeps at 44.8, the warship at 44.8. Measuring a slope proves
     * a slope. What a boundary needs proved is that a BODY cannot cross it.
     *
     * So it is now measured with a real World, a real Player and a real input
     * device, driven at each room's own shell: find the toe of the wall along
     * a bearing, stand the player six metres short of it, hold forward for
     * eight seconds and see what height they gained. The geometric survey
     * stays, because "is this room big enough to be a room" is a real and
     * cheap claim — but it is no longer allowed to stand in for the boundary.
     */
    const rows = [];
    for (const [key, d] of interiors()) {
      const T = d.terrain;
      let walkable = 0, steep = 0;
      for (let z = -90; z <= 90; z += 4) {
        for (let x = -90; x <= 90; x += 4) {
          if (x * x + z * z > 8100) continue;
          if (!T.inBounds(x, z, 6)) continue;
          if (T.slopeAt(x, z) > 0.55) { steep++; continue; }
          walkable++;
        }
      }
      assert(walkable > 900, `${key}: only ${walkable} walkable samples — that is a corridor, not a hall`);
      rows.push({ key, walkable });
    }

    /* ── and now the part a survey cannot answer ─────────────────────── */
    await initPhysics();
    const out = [];
    for (const { key, walkable } of rows) {
      const engine = stubEngine();
      /* `low` on purpose: the terrain grid is coarsest at the bottom tier and a
       * heightfield cannot hold a face steeper than rise/step, so this is where
       * a wall is most likely to be a ramp. */
      const world = new World(engine, { ...DEFAULT_SETTINGS, quality: 'low' });
      await world.loadLevel(key);
      const T = world.terrain;
      let worst = 0, worstBearing = 0, tested = 0;
      for (let b = 0; b < 6; b++) {
        /* `Player._move` takes forward as `-(sin yaw, cos yaw)`, so a player
         * told to face `yaw` walks along `-(sin yaw, cos yaw)`. Facing yaw + π
         * is what sends them OUT along the bearing this loop is surveying —
         * without it this check walked them back into the middle of the room
         * and measured a bump on the floor. */
        const yaw = (b / 6) * Math.PI * 2;
        const dx = Math.sin(yaw), dz = Math.cos(yaw);
        // the toe of the wall: the first radius where the ground climbs at
        // more than the walk limit over one grid step
        let toe = -1;
        const e = T.step;
        for (let r = 24; r < 130; r += 1) {
          const x = dx * r, z = dz * r;
          if (!T.inBounds(x, z, 4)) break;
          const g = Math.hypot((T.height(x + e, z) - T.height(x - e, z)) / (2 * e),
            (T.height(x, z + e) - T.height(x, z - e)) / (2 * e));
          if (g > 1.83) { toe = r; break; }
        }
        if (toe < 12) continue;
        tested++;
        // where the WALL starts: everything below this is the room's floor and
        // the ramp at the foot of its shell, both of which are places to stand
        const yToe = T.height(dx * toe, dz * toe);
        const sx = dx * (toe - 6), sz = dz * (toe - 6);
        world.spawnPlayer();
        const p = world.player;
        p.position.set(sx, T.height(sx, sz), sz);
        p.velocity.set(0, 0, 0);
        p.camera.yaw = yaw + Math.PI;
        let gain = 0;
        for (let f = 0; f < 8 * 60; f++) {
          p.camera.yaw = yaw + Math.PI;
          p.saber.retract();
          world.update(1 / 60, idleInput(0, 1));
          gain = Math.max(gain, p.position.y - yToe);
        }
        if (gain > worst) { worst = gain; worstBearing = Math.round(yaw * 57.3); }
        p.dispose(); world.players.length = 0; world.player = null;
      }
      assert(tested >= 4, `${key}: only ${tested} of 6 bearings out of the room reach a wall at all`);
      /**
       * MEASURED FROM THE FOOT OF THE WALL, not from where the player started,
       * because the approach to a shell is itself a slope and standing on it is
       * fine. `yToe` is the ground at the first point on a 1 m scan out along
       * the bearing whose sampled gradient passes the walk limit.
       *
       * 4 m of allowance over that, and the number is the instrument's rather
       * than the level's: this scan finds where the wall BEGINS, while
       * `Terrain.blockClimb` refuses the move where the face still climbs at
       * more than the limit three metres further up — which on a shell that
       * curves into its wall is a metre or two higher up the same face. The
       * warship measures 3.1 m by that difference alone and the intake 0.0.
       * What this bar catches is the thing it exists for: before blockClimb
       * this measured 20-40 m on every room in the game, and the intake ended
       * at y = 46.0 m with its roof at 16.5.
       */
      assert(worst < 4.0,
        `${key}: holding W at the shell ended ${worst.toFixed(1)} m above the foot of the wall on `
        + `bearing ${worstBearing}° — the room opens onto a ramp the player walks out over`);
      out.push(`${key} ${walkable} floor, ${tested} walls, worst climb ${worst.toFixed(2)} m over the toe`);
      world.unload();
      world.dispose?.();
    }
    return out.join('; ');
  });

  check('rooms: the descent is lit by fittings, and the bottom is lit by you', () => {
    /* Two halves of one property. Every room the descent uses has to author
     * REAL lights — the rung's air can only scale what the level put there —
     * and the deepest rung has to be somewhere those lights cannot save you.
     *
     * The second half is asserted as a RATIO of what the level's own lights
     * put out against what its air does, because that is the thing a player
     * sees: on the last rung the authored key is 0.12 and the fittings are
     * unchanged, so for the first time in the game the room's own lamps are
     * the majority of the light in it and they do not reach. */
    const rows = [];
    const used = new Set(DESCENT.map((t) => t.level));
    for (const [key, d] of interiors()) {
      const lights = d.world.levelLights.length;
      if (used.has(key)) {
        assert(lights >= 4,
          `${key} is a rung of the descent and authors ${lights} lights — `
          + 'a dark room with no fittings in it is a black frame, not a dark room');
      }
      rows.push(`${key} ${lights} fittings`);
    }
    // and the ladder's own bottom, against the room it stands in
    const bottom = DESCENT[DESCENT.length - 1];
    const top = DESCENT[0];
    assert(bottom.level === 'deeps' || LEVELS[bottom.level].atmosphere.sky === false,
      'the bottom of the descent is not indoors');
    assert(bottom.air.sunIntensity * 8 < top.air.sunIntensity,
      `the deepest rung runs ${bottom.air.sunIntensity} of key against the first rung's `
      + `${top.air.sunIntensity} — that is not eight times darker`);
    return rows.join(', ');
  });

  check('rooms: the descent is one building, and the cut is not made of the same stuff', () => {
    /* The claim the whole ladder rests on, stated about the GROUND rather than
     * about the light: two of the three rooms stand on a floor somebody poured
     * and the third is the rock it was cut out of, so the first two must be
     * indistinguishable in palette and the third must not be.
     *
     * Without the second half the first is trivially satisfiable by giving
     * every room one preset, which would make the descent one room with three
     * lighting states. */
    const hue = (c) => {
      const r = ((c >> 16) & 255) / 255, g = ((c >> 8) & 255) / 255, b = (c & 255) / 255;
      const mx = Math.max(r, g, b), mn = Math.min(r, g, b), dd = mx - mn;
      if (dd < 1e-6) return null;
      const h = mx === r ? ((g - b) / dd + 6) % 6 : mx === g ? (b - r) / dd + 2 : (r - g) / dd + 4;
      return h * 60;
    };
    const lum = (c) => 0.2126 * ((c >> 16) & 255) + 0.7152 * ((c >> 8) & 255) + 0.0722 * (c & 255);
    const works = TERRAIN_PRESETS.works, foundry = TERRAIN_PRESETS.foundry, cavern = TERRAIN_PRESETS.cavern;
    assert(works.sandColor === foundry.sandColor && works.maps === foundry.maps,
      'the intake and the foundry no longer stand on the same floor — the descent stops being one building');
    assert(cavern.maps !== works.maps,
      'the cut is surfaced as the poured floor above it, so the excavation and the building are one material');
    // …and the cut is DARKER, because it is rock that has never been finished
    assert(lum(cavern.sandColor) < lum(works.sandColor),
      `the cut's floor (${lum(cavern.sandColor).toFixed(0)}) is brighter than the works' `
      + `(${lum(works.sandColor).toFixed(0)}) — a cut seam does not out-reflect a poured deck`);
    const hs = [hue(works.sandColor), hue(cavern.sandColor)].filter((h) => h !== null);
    return `works/foundry ${works.sandColor.toString(16)}, cavern ${cavern.sandColor.toString(16)}, `
      + `hues ${hs.map((h) => h.toFixed(0)).join('/')}°`;
  });
}
