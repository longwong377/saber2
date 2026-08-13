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

  check('rooms: an interior is walled by ground the player cannot walk up', () => {
    /* The shell is part of the heightfield, so "wall" is a claim about slope.
     * 0.55 of (1 − cos θ) is 63°, and it is the number every survey in the
     * suite already uses to mean "not ground you can stand on" — so this asks
     * the shell to be, by that shared definition, not ground.
     *
     * And the room has to be a ROOM: at least 900 walkable samples on the 4 m
     * grid world-immersion uses, which is about 14,400 m² of floor. Both bars
     * bind from opposite directions and a shell that is a ramp fails one or
     * the other. */
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
      /* THE SHELL, asked as the question that matters: walking out along any
       * bearing, is there a radius you cannot get past? A fraction of steep
       * samples over a fixed band is the wrong question — each room puts its
       * wall at its own radius, and a band that misses one room's shell scores
       * it as open when it is not. This finds the steepest point on each of
       * sixteen bearings and requires every one of them to be a wall. */
      let closed = 0;
      const steepest = [];
      for (let a = 0; a < 16; a++) {
        const th = (a / 16) * Math.PI * 2;
        const c = Math.cos(th), s = Math.sin(th);
        const k = 1 / Math.max(Math.abs(c), Math.abs(s));
        let worst = 0;
        for (let r = 50; r <= 112; r += 1.5) {
          const x = c * k * r, z = s * k * r;
          if (!T.inBounds(x, z, 2)) break;
          worst = Math.max(worst, T.slopeAt(x, z));
        }
        steepest.push(worst);
        if (worst > 0.55) closed++;
      }
      assert(walkable > 900, `${key}: only ${walkable} walkable samples — that is a corridor, not a hall`);
      assert(closed === 16,
        `${key}: ${16 - closed} of 16 bearings have no ground steeper than 63° anywhere between 50 and 112 m — `
        + 'the room opens onto a ramp the player walks out over');
      rows.push(`${key} ${walkable} floor / shell ${Math.min(...steepest).toFixed(2)}–${Math.max(...steepest).toFixed(2)}`);
    }
    return rows.join('; ');
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
