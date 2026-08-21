/**
 * BATTLEFRONT BORZ — IS A LEVEL A PLACE? — src/game/Levels.js, src/world/*.
 *
 * Every check in this file drives a REAL World: the terrain the game builds,
 * the props the level dresses, a real Player with real input, real physics.
 * That is not thoroughness for its own sake — it is the only way these
 * particular defects were ever going to be caught, because each of them was
 * invisible to a survey of the same data. The suite already held that "an
 * interior is walled by ground the player cannot walk up" (descent.mjs) and it
 * was measuring `slopeAt > 0.55`, a convention with no reader anywhere in src/,
 * while the player walked up 74° ground and out over the roof of every room in
 * the game. A property of a level is what a body finds when it goes there.
 *
 * The stub engine below is the one tools/checks/lifecycle.mjs proved out: World
 * touches ten members of `engine` and none of them needs a GL context.
 *
 * WHAT IS HELD HERE, and what each one cost before it was:
 *
 *   THE BOUNDARY.        Holding W walked the player out of every level in the
 *                        game. (descent.mjs holds the interiors' own shells
 *                        with the same instrument; this file holds the bowl.)
 *   TREES ARE SOLID.     1,800 trunks with no collision until you cut them down.
 *   THE WATER BITES.     A lava sea, a canal of melt and an ocean, all walkable
 *                        at zero cost, 100/100 HP.
 *   SPAWNS ARE CLEAR.    11.9% of Temple spawns arrived inside solid masonry.
 *   THE CUT IS A CAVE.   92.6% of its floor was under its own water sheet.
 *   ONE SEA, ONE NUMBER. the Ember Shelf drew its coast at 0.55 and walked it at 0.00.
 *   THE DOORS EXIST.     `world.doors` was empty on all thirteen levels.
 *   THE DECKS ARE REACHED. Eight of twelve gantry decks stood above the ceiling
 *                        of the highest jump in the game.
 */

import * as THREE from 'three';
import { initPhysics } from '../../src/physics/Rapier.js';
import { World } from '../../src/game/World.js';
import { LEVELS, LEVEL_ORDER } from '../../src/game/Levels.js';
import { DEFAULT_SETTINGS } from '../../src/ui/Menu.js';
import { clocked } from './_shared.mjs';

/* ── the smallest engine a World runs on ─────────────────────────────── */

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

/** An input device with a movement axis you can pin and nothing else pressed. */
const held = (x = 0, y = 0) => ({
  axis: { x, y },
  act: () => false, actHit: () => false, actDown: () => false,
  moveAxis(o) { if (o) { o.x = this.axis.x; o.y = this.axis.y; return o; } return { ...this.axis }; },
  mouse: { dx: 0, dy: 0, wheel: 0, left: false, right: false },
  delta: { x: 0, y: 0 }, accel: { x: 0, y: 0 },
  end() {},
});

const WORLDS = new Map();
/** One booted World per level, shared by every check in this file. */
async function level(key) {
  /**
   * THE KEY HAS TO EXIST, AND NOTHING SAID SO UNTIL A SUITE STOPPED FINISHING.
   *
   * `World.loadLevel` substitutes `LEVEL_ORDER[0]` for a key it does not know —
   * correctly, because a saved profile pointing at a deleted level must still
   * boot. In a CHECK that safety net is a trap: this file asked for `deeps`,
   * which was deleted in the roster cull, got the Ember Shelf back, cached it
   * under a second key, and measured the wrong level's water against a
   * submersion bar. It also built a NINTH full World — terrain heightfield,
   * Rapier world, instanced fields, texture set — and this suite is one of the
   * two HANDOFF §2.7 names as holding the most Worlds alive at once. Adding an
   * eighth real level on top of that is what took it from slow to not
   * finishing.
   *
   * `roster.mjs` scans the whole tree for level names and could not see this
   * one: it knows five syntactic forms and `level('deeps')` is none of them —
   * which its own note predicts ("a form this does not know is a violation that
   * goes unreported"). So the assertion goes where the call is.
   */
  if (!LEVELS[key]) {
    throw new Error(`levels-quality asks for the level '${key}', which no longer exists — `
      + `loadLevel would silently substitute ${LEVEL_ORDER[0]} and this file would measure it instead`);
  }
  if (WORLDS.has(key)) return WORLDS.get(key);
  const engine = stubEngine();
  /* `low`, deliberately: the terrain grid is coarser at the bottom tier — the
   * colosseum builds at res 130 (step 3.10 m) against 240 at the top — and a
   * heightfield cannot hold a face steeper than rise/step, so the cheapest
   * tier is the one where a wall is most likely to be a ramp. Hold the worst
   * case and the rest follow. */
  const world = new World(engine, { ...DEFAULT_SETTINGS, quality: 'low' });
  await world.loadLevel(key);
  const rec = { engine, world };
  WORLDS.set(key, rec);
  return rec;
}

/** A player standing at (x, z), facing `yaw`, with the blade put away. */
function stand(world, x, z, yaw = 0) {
  if (world.player) { world.player.dispose(); world.players.length = 0; world.player = null; }
  world.spawnPlayer();
  const p = world.player;
  p.position.set(x, world.terrain.height(x, z), z);
  p.velocity.set(0, 0, 0);
  p.camera.yaw = yaw;
  p.saber.retract();
  return p;
}

/** Hold the axis for `secs`, keeping the facing pinned, and report the walk. */
function walk(world, p, secs, input) {
  const yaw = p.camera.yaw;
  let peak = p.position.y, maxR = Math.hypot(p.position.x, p.position.z);
  const frames = Math.round(secs * 60);
  for (let f = 0; f < frames; f++) {
    p.camera.yaw = yaw;
    p.saber.retract();
    world.update(1 / 60, input);
    peak = Math.max(peak, p.position.y);
    maxR = Math.max(maxR, Math.hypot(p.position.x, p.position.z));
  }
  return { peak, maxR };
}

export async function run({ check, assert }) {
  /* Every check in this file is wrapped, so the shared module state goes back
   * before each body as well as after it. What that state IS lives in
   * tools/checks/_shared.mjs and is deliberately not restated here — a list
   * copied into thirty-three files is a list that drifts from thirty-three.
   */
  check = await clocked(check);
  await initPhysics();

  /* Every check here is async and the harness starts them all in one pass, so
   * the teardown at the bottom has to wait for them rather than run first —
   * which is exactly what it did on the first run of this file, reporting
   * "0 levels booted". `started` is filled synchronously at registration. */
  const started = [];
  const acheck = (name, fn) => check(name, () => { const pr = fn(); started.push(pr.catch(() => {})); return pr; });

  /* ── 1. the boundary ──────────────────────────────────────────────── */

  acheck('levels: the bowl of the colosseum is a building, not a hill with people on it', async () => {
    /**
     * THE ESCAPE THIS HOLDS. Real Player, `moveAxis {0,1}` pinned, 25 s a
     * bearing from the middle of the sand: six of eight bearings finished at
     * y = 45.1 m and r = 114.8 m — up the podium, through seven thousand
     * non-colliding spectators, over the arcade and out onto the plain, and on
     * longer runs out to r = 236 m. The arena's own comments say the podium is
     * 68° and "past the number every walkability survey uses"; on the grid the
     * game actually samples it never measured over 0.374, because a heightfield
     * with a 3.1 m step cannot hold a face steeper than rise/step.
     *
     * MEASURED FROM THE BANK, NOT FROM THE MIDDLE OF THE SAND. Walking out
     * from the origin takes 20 s to reach the cavea and the answer then depends
     * on how long the check felt like walking — the first cut of this ran 22 s,
     * stopped the player at r = 101 m in both configurations, and would have
     * passed on the shipped arcade. Starting two thirds of the way up the bank
     * asks the question the level's edge is actually about, in a quarter of the
     * frames: put a player on the seating and let them walk at the rim.
     *
     * `e` is the arena's own normalised radius, `hypot(x/62, z/46)` — the
     * number the preset is written in. The last row of seating is at 1.95 and
     * the plain outside the building begins at 2.06. Measured over eight
     * bearings × 12 s: with the arcade as shipped (6 m proud of the last row,
     * over 11 e-hundredths) the player reached e = 2.80 and stood at y = 45.1 m
     * on the plain outside; with it as a wall (15 m over 4 hundredths, gradient
     * 2.42 on the coarse grid against the 1.83 the movement code enforces) they
     * stop at e = 1.95, against the foot of it.
     *
     * The crowd bank itself stays walkable on purpose — 41.5% of this level's
     * own spawns land on it and walk down — so this is a claim about leaving
     * the building, not about standing in the cheap seats.
     */
    const { world } = await level('colosseum');
    const T = world.terrain;
    const E = (x, z) => Math.hypot(x / 62, z / 46);
    let worstE = 0, worstY = -Infinity;
    const rows = [];
    for (let b = 0; b < 8; b++) {
      const yaw = (b / 8) * Math.PI * 2;
      const dx = Math.sin(yaw), dz = Math.cos(yaw);
      let r0 = 10;
      for (let r = 10; r < 200; r += 0.5) { if (E(dx * r, dz * r) >= 1.6) { r0 = r; break; } }
      // yaw + π faces OUT along the bearing: forward is -(sin yaw, cos yaw).
      const p = stand(world, dx * r0, dz * r0, yaw + Math.PI);
      const input = held(0, 1);
      for (let f = 0; f < 12 * 60; f++) {
        p.camera.yaw = yaw + Math.PI;
        p.saber.retract();
        world.update(1 / 60, input);
        worstE = Math.max(worstE, E(p.position.x, p.position.z));
        worstY = Math.max(worstY, p.position.y);
      }
      rows.push(`${(yaw * 57.3) | 0}°→${E(p.position.x, p.position.z).toFixed(2)}`);
    }
    assert(worstE < 2.0,
      `holding W on the cavea walked the player out to e = ${worstE.toFixed(2)} and y = ${worstY.toFixed(0)} m — `
      + 'the last row of seating is at 1.95 and the plain outside the building begins at 2.06');
    return `8 bearings × 12 s from the bank, furthest e = ${worstE.toFixed(2)} (${rows.join(' ')})`;
  });

  acheck('hazard: the sheet a level is built round is in front of the player when it opens', async () => {
    /**
     * THE EMBER SHELF'S LAVA SEA COULD NOT BE SEEN FROM WHERE THE GAME STOOD
     * YOU UP, ON ANY BEARING.
     *
     * `World._playerSpawn` hard-coded `(0, h(0, 8), 8)` for all nine levels,
     * so a level had no way to say where it opens. Measured from that point on
     * scoria at eye height: nearest ground under the sheet 94 m away, 0.0% of
     * the r ≤ 60 m fight disc under it, and 0 of 360 bearings with an
     * unobstructed line to it — over a ridge, behind you, on a level whose
     * blurb is "a basalt shelf standing out of a lava sea". `Hazard.js`'s own
     * header is the rule this makes checkable: "the levels that have a hazard
     * are the levels whose fights happen along its edge."
     *
     * Driven through `_playerSpawn` itself rather than through `L.start`, so
     * the check measures where the game ACTUALLY stands the player — the
     * authored point, or whatever the widening ring found instead when the
     * authored point was illegal. The eye line is a straight segment from eye
     * height to the sheet, stepped against the heightfield.
     *
     * 60 m and one bearing are deliberately weak bars: this is a claim about
     * a sea being present at the opening, not about how much of it there is.
     * Measured now — mustafar 40 m with 156 bearings, scoria 30 m with 63.
     */
    const rows = [];
    for (const key of LEVEL_ORDER) {
      const L = LEVELS[key];
      if (!L?.water?.damage) continue;
      const { world } = await level(key);
      const T = world.terrain, sheet = L.water.level ?? 0;
      const p = world._playerSpawn();
      const eye = p.y + 1.6;
      let nearest = Infinity, seen = 0, reach = 0;
      for (let b = 0; b < 360; b++) {
        const cx = Math.cos(b * Math.PI / 180), cz = Math.sin(b * Math.PI / 180);
        for (let r = 2; r <= 300; r += 2) {
          const x = p.x + cx * r, z = p.z + cz * r;
          if (!T.inBounds(x, z, 4)) break;
          if (T.height(x, z) >= sheet) continue;
          reach++;
          nearest = Math.min(nearest, r);
          let clear = true;
          for (let t = 4; t < r; t += 3) {
            if (T.height(p.x + cx * t, p.z + cz * t) > eye + (sheet - eye) * (t / r)) { clear = false; break; }
          }
          if (clear) seen++;
          break;
        }
      }
      assert(reach > 0, `${key}: no bearing from the opening position reaches the sheet at all`);
      assert(nearest <= 60, `${key}: the nearest ${L.water.damage} HP/s sheet is ${nearest} m from where the `
        + `game stands the player up, at (${p.x.toFixed(0)}, ${p.z.toFixed(0)})`);
      assert(seen >= 1, `${key}: ${reach} bearings reach the sheet and NONE of them has an eye line to it — `
        + `the hazard the level is built round is not visible from where it opens`);
      rows.push(`${key} ${nearest} m, ${seen}/${reach} bearings see it`);
    }
    assert(rows.length >= 1, 'no level in the game declares a damaging sheet — nothing was measured');
    return rows.join('; ');
  });

  /* ── 2. the trees ─────────────────────────────────────────────────── */

  acheck('wood: a standing trunk is something you walk into, not through', async () => {
    /**
     * `Forest.plant()` wrote three InstancedMeshes and never touched physics.
     * Measured before the fix, driving the real Player at the level's largest
     * trunk (r = 0.63 m, h = 25.9 m) from 5 m out with the blade put away:
     * closest approach to the trunk axis 0.01 m — dead centre — and the player
     * finished 21.8 m past it. The only `addStaticBox` in Trees.js belonged to
     * `_land()`, i.e. a tree became solid AFTER you cut it down.
     *
     * The blade is retracted for the whole run because a lit saber CUTS the
     * trunk you walk into, which is the correct behaviour and would hide this
     * defect completely: the first version of this measurement read 0.01 m
     * after the fix as well, because the tree had been felled by the player's
     * own blade on the way in.
     */
    const { world } = await level('wood');
    const f = world.forest;
    assert(f && f.count > 1000, `the wood planted ${f ? f.count : 0} trees`);
    let big = 0;
    for (let i = 0; i < f.count; i++) if (f.data[i * 15 + 4] > f.data[big * 15 + 4]) big = i;
    const bx = f.data[big * 15], bz = f.data[big * 15 + 1], br = f.data[big * 15 + 4];
    const a = Math.atan2(bx, bz);
    const p = stand(world, bx - Math.sin(a) * 5, bz - Math.cos(a) * 5, a + Math.PI);
    let closest = Infinity, live = 0;
    for (let i = 0; i < 60 * 8; i++) {
      p.camera.yaw = a + Math.PI;
      p.saber.retract();
      world.update(1 / 60, held(0, 1));
      closest = Math.min(closest, Math.hypot(p.position.x - bx, p.position.z - bz));
      live = Math.max(live, f.live.size);
    }
    assert(closest > br + 0.2,
      `the player's centre reached ${closest.toFixed(2)} m from the axis of a ${br.toFixed(2)} m trunk `
      + '— the trunk is a hologram');
    /* …and it is a RING, not 1,800 colliders. Every near-list in the engine
     * walks `physics.staticBoxes` linearly once per body per frame: measured on
     * this level with a 12-strong wave, 76 boxes cost 3.18 ms/frame and 1,876
     * cost 14.09. */
    assert(live > 0, 'no trunk near the player ever carried a collider');
    assert(world.physics.staticBoxes.length < 400,
      `${world.physics.staticBoxes.length} static boxes on the wood — a collider per trunk costs `
      + '10.9 ms a frame to make solid the 1,770 trees nobody is near');
    return `closest approach ${closest.toFixed(2)} m to a ${br.toFixed(2)} m trunk; `
      + `${live} of ${f.count} trunks live at the peak, ${world.physics.staticBoxes.length} static boxes`;
  });

  /* ── 3. the water ─────────────────────────────────────────────────── */

  acheck('hazard: the lava sea is lethal and the ocean will not let you walk under it', async () => {
    /**
     * `L.water` had one consumer in the entire game — the shader plane World
     * builds from it — so a lava sea, a canal of molten metal and an ocean were
     * all floors. Measured: 90 s of holding forward on the Ember Shelf finished 33 m
     * UNDER the surface of the sea at 100/100 HP; 45 s on Kamino finished on
     * the seabed at y = -9.0 with the camera under the ocean for 64% of the
     * walk, also at 100/100. The Foundry puts "the melt is not cover" on screen
     * as a titled notification, about a decal.
     *
     * Two different answers, because they are two different things. Lava burns
     * (52 HP/s, 1.9 s to kill). The sea is the edge of the level: you wade to a
     * metre and the bed refuses to let you go deeper, because nothing in this
     * game swims and an ocean that kills in two seconds is a lava sea painted
     * blue.
     */
    const mus = (await level('scoria')).world;
    const T = mus.terrain;
    // find sea: walk out along a bearing until the ground is under the sheet
    const sea = { x: 0, z: 0 };
    outer: for (let b = 0; b < 64; b++) {
      const a = (b / 64) * Math.PI * 2;
      for (let r = 40; r < 200; r += 2) {
        const x = Math.cos(a) * r, z = Math.sin(a) * r;
        if (T.height(x, z) < mus.level.water.level - 1.2) { sea.x = x; sea.z = z; break outer; }
      }
    }
    const p = stand(mus, sea.x, sea.z, 0);
    const hp0 = p.hp;
    let died = -1;
    for (let f = 0; f < 60 * 6 && died < 0; f++) {
      mus.update(1 / 60, held(0, 0));
      if (!p.alive) died = f / 60;
    }
    assert(died > 0 && died < 4.0,
      `standing in the lava sea took ${(hp0 - p.hp).toFixed(0)} HP in six seconds and the player is `
      + `${p.alive ? 'alive' : 'dead'} — the sea is 69% of this map and it was free ground`);

    /* Started at the SHORE, not at the middle of the deck: the platform is
     * 130 m across and a player walking off the middle of it for fourteen
     * seconds never reaches the sea at all, so a test that starts at the origin
     * would pass on a level made entirely of water. Each bearing walks out to
     * the first ground under the sheet, backs up 10 m, and holds W. */
    /* AND THE DROIDS BURN TOO, which is not a flourish: the fights on these
     * levels happen along the edge of the hazard, and a sea that only kills the
     * player is a sea the player learns to fight beside instead of over. */
    const e = mus.spawnEnemy('b1', new THREE.Vector3(sea.x, mus.terrain.height(sea.x, sea.z), sea.z));
    for (let f = 0; f < 60 * 8 && !e.dead; f++) mus.update(1 / 60, held(0, 0));
    assert(e.dead, 'a droid stood in the lava sea for eight seconds and walked out of it');

    /* THE FOUNDRY'S CANAL was the second damaging sheet and the Foundry is
     * deleted, so the clause is DERIVED rather than deleted: every level whose
     * water declares `damage` must kill a body standing in it. That is the
     * property the canal was one instance of, it cannot pass vacuously (the
     * roster is asserted non-empty), and the day a new level pours melt it is
     * already covered. */
    const burners = [];
    for (const key of LEVEL_ORDER) {
      const L = LEVELS[key];
      if (!L?.water?.damage) continue;
      burners.push(key);
    }
    assert(burners.length >= 1, 'no level in the game declares a damaging water sheet');
    let fdied = -1;
    for (const key of burners) {
      const w = (await level(key)).world;
      const WT = w.terrain, wwl = w.level.water.level;
      let hot = null;
      outer2: for (let b = 0; b < 96; b++) {
        const a = (b / 96) * Math.PI * 2;
        for (let r = 6; r < 120; r += 1) {
          const x = Math.cos(a) * r, z = Math.sin(a) * r;
          if (WT.height(x, z) < wwl - 0.2) { hot = { x, z }; break outer2; }
        }
      }
      assert(hot, `no ${key} sheet found to stand in at all`);
      const fp = stand(w, hot.x, hot.z, 0);
      let d = -1;
      for (let f = 0; f < 60 * 6 && d < 0; f++) {
        w.update(1 / 60, held(0, 0));
        if (!fp.alive) d = f / 60;
      }
      assert(d > 0 && d < 4.0,
        `standing in ${key}'s burning sheet for six seconds left the player `
        + `${fp.alive ? 'alive' : 'dead'} at ${fp.hp.toFixed(0)} HP — the level declares it damaging`);
      fdied = d;
    }

    /* THE WADE. Kamino's ocean was the subject and Kamino is deleted, so this
     * walks every level that declares a HARMLESS sheet instead — the property
     * was never about one platform, it is "a level with water in it does not
     * let you stroll along the seabed with the camera under the surface". */
    const waders = LEVEL_ORDER.filter((k) => LEVELS[k]?.water && !LEVELS[k].water.damage);
    assert(waders.length >= 1, 'no level in the game declares a harmless water sheet');
    let worstDepth = -Infinity, eyeUnder = 0, frames = 0, shores = 0, endDepth = -Infinity;
    for (const key of waders) {
      const kam = (await level(key)).world;
      const wl = kam.level.water.level;
      const KT = kam.terrain;
      for (let b = 0; b < 6; b++) {
        const yaw = (b / 6) * Math.PI * 2;
        const dx = Math.sin(yaw), dz = Math.cos(yaw);
        let shore = -1;
        for (let r = 6; r < 150; r += 1) {
          if (KT.height(dx * r, dz * r) < wl) { shore = r; break; }
        }
        if (shore < 12) continue;
        shores++;
        // yaw + π: forward is `-(sin yaw, cos yaw)`, so this is what walks the
        // player OUT along the bearing rather than back across the deck.
        const q = stand(kam, dx * (shore - 10), dz * (shore - 10), yaw + Math.PI);
        for (let f = 0; f < 60 * 12; f++) {
          q.camera.yaw = yaw + Math.PI;
          kam.update(1 / 60, held(0, 1));
          worstDepth = Math.max(worstDepth, wl - q.position.y);
          if (q.position.y + 1.62 < wl) eyeUnder++;
          frames++;
        }
        endDepth = Math.max(endDepth, wl - q.position.y);
      }
    }
    assert(shores >= 2, `only ${shores} bearings across ${waders.length} levels found open water`);
    /* Three bars, because a plunge and a walk are different things. Never deep
     * enough to be swimming, back in the shallows by the end of the bearing,
     * and the eye under the surface for moments rather than for the level. */
    assert(worstDepth < 3.0,
      `the player reached ${worstDepth.toFixed(1)} m below the surface — the sheet is not a swim`);
    assert(endDepth < 2.0,
      `after twelve seconds of walking out the player is still ${endDepth.toFixed(1)} m under — `
      + 'the bed is meant to put them back in the shallows');
    assert(eyeUnder / frames < 0.05,
      `${(100 * eyeUnder / frames).toFixed(0)}% of frames had the player's eye under the water`);
    return `lava kills in ${died.toFixed(1)} s and takes a droid with it, ${burners.length} burning `
      + `sheet(s) in ${fdied.toFixed(1)} s; ${shores} bearings walked into open water stop at `
      + `${worstDepth.toFixed(2)} m of depth, eye never submerged over ${(frames / 60).toFixed(0)} s`;
  });

  /* ── 4. spawns ────────────────────────────────────────────────────── */

  acheck('spawns: nobody arrives inside a wall, and nobody arrives under the water', async () => {
    /**
     * `World.pickSpawn` tested `inBounds` and `slopeAt` and nothing else — not
     * one thing the level had put on the ground. Measured over 5,400 picks per
     * level from six anchors, chest point at y + 1.0 against every enabled
     * static box with a 0.35 m pad: temple 11.9%, arena 12.7%, warship 8.7%,
     * deeps 7.2%, intake 5.3%. Under the level's own water: deeps 94.3%,
     * wood 20.3%.
     *
     * It matters more than a bad-looking arrival. Enemy's push-out skips a
     * chest point that is strictly inside a box (`d2 < 1e-8 → continue`), so a
     * body born in a column is never pushed out of it — it walks out through
     * the masonry — and a body born under a hazard sheet is born in lava.
     */
    /**
     * FIVE DEAD LEVEL NAMES, and the whole check had been measuring the Ember
     * Shelf five times over.
     *
     * It named `temple`, `arena`, `warship`, `intake` and `deeps` — every one of
     * which was deleted in the roster cull. `World.loadLevel` substitutes the
     * first surviving level for a key it does not know, so each of the five
     * booted a copy of the Ember Shelf, cached it under a dead key, and had its
     * spawn picks measured against a sentence about a level that is not there.
     * FIVE EXTRA WORLDS, held simultaneously, on top of the file's real six —
     * which is precisely why HANDOFF §2.7 names this suite as the one holding
     * the most Worlds alive at once, and why adding an eighth real level took it
     * from slow to not finishing. `roster.mjs` cannot see these: `level('x')` is
     * none of the five syntactic forms it scans for.
     *
     * ENUMERATED over the real roster instead. The property is not about those
     * five rooms — it is that NO level puts a body inside its own masonry or
     * under its own water — so it is asked of every level the game has, and it
     * cannot be outlived by another cull.
     */
    const rows = [];
    for (const key of LEVEL_ORDER) {
      const { world } = await level(key);
      const T = world.terrain;
      let inside = 0, deep = 0, n = 0;
      for (const [ax, az] of [[0, 0], [26, 0], [-26, 0], [0, 26], [0, -26], [18, 18]]) {
        world.player = { position: new THREE.Vector3(ax, T.height(ax, az), az) };
        for (let i = 0; i < 220; i++) {
          const s = world.pickSpawn('acolyte');
          n++;
          const c = new THREE.Vector3(s.x, s.y + 1.0, s.z);
          for (const b of world.physics.staticBoxes) {
            if (b.disabled) continue;
            const rr = b.radius + 0.35;
            if (c.distanceToSquared(b.center) > rr * rr) continue;
            const q = c.clone().sub(b.center).applyQuaternion(b.invQuat);
            const h = b.halfExtents;
            if (Math.abs(q.x) - h.x < 0.35 && Math.abs(q.y) - h.y < 0.35
              && Math.abs(q.z) - h.z < 0.35) { inside++; break; }
          }
          const w = world.level.water;
          if (w && w.level - s.y > 0.5) deep++;
        }
      }
      world.player = null;
      assert(inside === 0,
        `${key}: ${(100 * inside / n).toFixed(1)}% of ${n} spawns arrive inside a collider`);
      assert(deep === 0,
        `${key}: ${(100 * deep / n).toFixed(1)}% of ${n} spawns arrive more than knee-deep in the level's own water`);
      rows.push(`${key} ${n}`);
    }
    return `0 embedded and 0 submerged over ${rows.join(', ')} picks`;
  });

  /* ── 5. the Cut ───────────────────────────────────────────────────── */

  acheck('deeps: The Cut is a cave with standing water in it, not a swimming pool', async () => {
    /**
     * The preset says what this level is for, over `sump`: "two long low bays,
     * so the level has standing water you fight around instead of a puddle in
     * the middle". It was the opposite. The cavern floor's median inside the
     * 60 m fighting disc is -1.09 m and the sheet was at +0.30: 92.6% of the
     * floor submerged, 64.4% waist-deep, and 44.8% of it deep enough to put the
     * 1.62 m eye under a DoubleSide, depthWrite-off transparent plane — so on
     * half the level the entire frame was seen through the water shader.
     *
     * Both halves are held: the geometry, and then the CAMERA, which is the
     * thing the player actually complains about.
     */
    /**
     * NAMED `deeps`, WHICH WAS DELETED, and the check went on running for
     * months against a level that was not there.
     *
     * `loadLevel` substitutes the first surviving level for a key it does not
     * know, so this measured the Ember Shelf's LAVA sheet against a submersion
     * bar written for a flooded cavern, cached a second copy of that world under
     * the dead key, and — the part that showed — pushed this suite's peak to
     * nine simultaneous Worlds. It is one of the two HANDOFF §2.7 names as
     * holding the most alive at once, and adding an eighth real level on top
     * took it from slow to not finishing. `level()` now refuses a dead key
     * outright; this is the check that was pointed at one.
     *
     * ENUMERATED RATHER THAN NAMED, which is the fix this file has already made
     * three times over. The property is not about one cavern — it is that NO
     * level drowns the ground it is fought on — so it is asked of every level
     * that has a sea. That is strictly stronger and it cannot be outlived by a
     * roster cull.
     */
    const rows = [];
    let worst = null;
    for (const key of LEVEL_ORDER) {
      const L = LEVELS[key];
      if (!L?.water || !(L.water.level > -900)) continue;
      const { world } = await level(key);
      const T = world.terrain, wl = L.water.level;
      let n = 0, sub = 0, eye = 0;
      for (let x = -60; x <= 60; x += 1) {
        for (let z = -60; z <= 60; z += 1) {
          if (x * x + z * z > 3600) continue;
          const y = T.height(x, z); n++;
          if (y < wl) sub++;
          if (y + 1.62 < wl) eye++;
        }
      }
      /* A LAVA SEA IS NOT A FLOODED FLOOR. The Ember Shelf's own note says 69%
       * of that map is lava and that walking into it is a death rather than a
       * swim — the level is a shelf standing OUT of a sea, so the sea is the
       * boundary and not the floor. What the bar is about is water you fight
       * IN, so a hazard sea is asked the eye-height question only: whatever the
       * fluid is, the player's eye must not be under the plane on the ground
       * they are meant to stand on. */
      if (!L.water.damage) {
        assert(sub / n < 0.60,
          `${key}: ${(100 * sub / n).toFixed(1)}% of the fighting floor is under the water sheet`);
      }
      assert(eye / n < 0.03,
        `${key}: ${(100 * eye / n).toFixed(1)}% of the fighting floor is deep enough to put the `
        + "player's eye under the surface");
      rows.push(`${key} ${(100 * sub / n).toFixed(0)}% wet / ${(100 * eye / n).toFixed(1)}% over eye`);
      if (!worst || eye / n > worst.eye) worst = { key, eye: eye / n, wl };
    }
    assert(rows.length > 0, 'no level in the roster has a sea, so this check measured nothing');

    /* …and then the CAMERA, on the worst of them, which is the half the player
     * actually complains about: a floor that is technically dry at the feet and
     * puts the eye through a DoubleSide depthWrite-off plane while you walk. */
    const { world, engine } = await level(worst.key);
    const wl = worst.wl;
    let frames = 0, camUnder = 0;
    for (let b = 0; b < 4; b++) {
      const p = stand(world, 0, 0, (b / 4) * Math.PI * 2);
      for (let f = 0; f < 60 * 8; f++) {
        p.camera.yaw = (b / 4) * Math.PI * 2;
        world.update(1 / 60, held(0, 1));
        if (engine.camera.position.y < wl) camUnder++;
        frames++;
      }
    }
    assert(camUnder / frames < 0.05,
      `${worst.key}: the render camera is under the water plane on `
      + `${(100 * camUnder / frames).toFixed(0)}% of frames over four bearings of walking`);
    return rows.join('; ') + `; camera under ${worst.key}'s sheet on `
      + `${(100 * camUnder / frames).toFixed(1)}% of ${frames} frames`;
  });

  /* ── 6. one sea, one number ───────────────────────────────────────── */

  acheck('water: a level that has a sea has one number for where it is', async () => {
    /**
     * `Levels.water.level` is what World builds the sheet from;
     * `TERRAIN_PRESETS[...].waterLevel` is what `surfaceAt` (footstep sample,
     * splash particle) and the ground shader's damp band key off. the Ember Shelf had
     * 0.55 and 0.00. Ray-walking 64 bearings on the built heightfield, the
     * drawn contour came out at 100.8-145.0 m and the terrain's at
     * 104.5-147.3 m: a ring 0.3 to 11.0 m wide, median 2.5, that was molten on
     * screen and gave a rock footstep underfoot.
     */
    const rows = [];
    for (const key of LEVEL_ORDER) {
      const L = LEVELS[key];
      if (!L?.water) continue;
      const { world } = await level(key);
      const a = L.water.level, b = world.terrain.waterLevel;
      assert(Math.abs(a - b) < 1e-6,
        `${key}: the sheet is drawn at ${a} and the ground believes ${b} — everything between the two `
        + 'contours is water on screen and dry rock underfoot');
      rows.push(`${key} ${a.toFixed(2)}`);
    }
    /* EVERY LEVEL THAT HAS A LIQUID, and the count is DERIVED rather than
     * typed — which is the third time that number has had to move. It was 5 of
     * 13, then 4 of 4 (the Ember Shelf's sea, Kamino's ocean, the Drowned
     * Wood's bog and the foundry's canal), and Kamino and the foundry are both
     * deleted. A hand-typed floor beside a derived list is HANDOFF §2.3's
     * signature defect; what the check actually needs is that it surveyed
     * every one there is and that there is at least one. */
    const declared = LEVEL_ORDER.filter((k) => LEVELS[k]?.water).length;
    assert(rows.length === declared && rows.length >= 1,
      `${rows.length} of ${declared} levels with water were surveyed`);
    return rows.join(', ');
  });

  /* ── 7. the doors ─────────────────────────────────────────────────── */

  acheck('doors: the blast doors the works describes are in the works', async () => {
    /**
     * `World.doors` was allocated in the constructor, disposed on unload,
     * stepped every frame and handed to the blade solver every frame — and it
     * was EMPTY on every level, because World had no method that could
     * put anything in it. `BlastDoor` is a finished object (kerf texture,
     * discard-through hole, static collider, capsules at 0.55 m for the blade,
     * a breach that drops the slug out) that no level had ever built, while
     * nine stub worlds in this suite implemented an `addDoor` the real World
     * did not have.
     */
    /* DERIVED, because no level's name may be typed here. The property is "a
     * blast door a level builds is a real object", and the roster it runs over
     * is whatever levels actually build one — which is how it keeps working
     * when the bulkheads move to a new level rather than silently measuring
     * LEVEL_ORDER[0].
     *
     * AND THE FLOOR IS BACK. It was here, then it was demoted to a REPORT —
     * "a check that cannot pass is a check that gets deleted or ignored" —
     * because the Foundry and then the Providence were both deleted and
     * `works()` in Levels.js was left as the only `BlastDoor` construction in
     * the tree with no caller. It is satisfiable again: `magazine()` in
     * Levels.js hangs a rank of three on Geonosis, outdoors, in a revetment cut
     * into the toe of a stack, which is what FLAGSHIP.md §4 permits an interior
     * to be. So the assertion goes back, and with it the sentence it always
     * carried: unreachable content is the defect, not this assertion.
     *
     * `tools/checks/blast-door.mjs` is where the MECHANIC is measured — the
     * seconds of the hold, what a swing does not do, what is behind the door.
     * This clause only holds the line that a shipped level builds one. */
    const doorLevels = [];
    for (const key of LEVEL_ORDER) {
      const { world } = await level(key);
      assert(typeof world.addDoor === 'function', 'World still has no addDoor');
      if (world.doors?.length) doorLevels.push(key);
    }
    for (const key of doorLevels) {
      const { world } = await level(key);
      assert(world.doors.length >= 3,
        `${key}: ${world.doors.length} doors — a level that builds bulkheads builds a rank of them`);
      for (const d of world.doors) {
        assert(d.collider && !d.collider.disabled, `${key}: a door with no collider`);
        assert(world.physics.staticBoxes.includes(d.collider),
          `${key}: a door's collider is not in the physics world`);
        assert(d.capsules().length > 4,
          `${key}: a door the blade solver cannot find (${d.capsules().length} capsules)`);
      }
    }
    assert(doorLevels.length >= 1,
      'NO LEVEL IN THE GAME BUILDS A BLAST DOOR — `BlastDoor` (kerf texture, discard-through hole, '
      + 'static collider, blade capsules, a breach that drops the slug) is finished content, '
      + 'DESIGN.md calls the twenty-second hold a signature mechanic, and `World.addDoor` is live on '
      + `all ${LEVEL_ORDER.length} levels with nothing calling it. Unreachable content is the defect `
      + 'here, not this assertion');
    const { world } = await level(doorLevels[0]);
    return `${world.doors.length} blast doors on ${doorLevels[0]}, each a collider and `
      + `${world.doors[0].capsules().length} blade capsules`;
  });

  /* ── 8. the decks ─────────────────────────────────────────────────── */

  acheck('props: a deck the level builds is a deck the player can get onto', async () => {
    /**
     * A full double Force jump was measured headless with unlimited Force,
     * sweeping the second jump across every frame of the arc: 6.18 m above the
     * take-off point, best at frame 40. Against that, the gantries stood at
     * 6.4 and 5.4 m (works, used by intake AND foundry), 7.2 and 6.2 (the cut)
     * and 7.0 twice (warship) — with a LADDER as the only route up, built out
     * of `kit.put(pipeBetween(...))`, which bins geometry and emits no collider
     * at all. Eight of the twelve decks in the game were furniture: you could
     * see them, you could never stand on them, and nothing spawned up there.
     *
     * A deck here is what the support query would call one: a wide, thin,
     * horizontal collider standing clear of the ground. The bar is 5.6 m, which
     * is the jump less the 0.16 m of deck and a real margin — a deck you can
     * only reach on a frame-perfect input is not a place either.
     */
    const rows = [];
    /* DERIVED for the same reason the doors are: the Descent's rooms are gone
     * and so is the Foundry, so this runs over every level that actually
     * builds a raised deck rather than over a typed list of level names. */
    const deckLevels = [];
    for (const key of LEVEL_ORDER) {
      const { world } = await level(key);
      const T0 = world.terrain;
      if (world.physics.staticBoxes.some((b) => !b.disabled && b.halfExtents.y < 0.5
        && b.halfExtents.x > 1.5 && b.halfExtents.z > 1.5
        && b.center.y - T0.height(b.center.x, b.center.z) > 2.0)) deckLevels.push(key);
    }
    for (const key of deckLevels) {
      const { world } = await level(key);
      const T = world.terrain;
      const decks = [];
      for (const b of world.physics.staticBoxes) {
        if (b.disabled) continue;
        const h = b.halfExtents;
        if (h.y > 0.35) continue;                       // not a deck: a wall
        if (h.x * h.z < 6) continue;                    // not a deck: a sill
        if (Math.abs(b.quat.x) > 0.02 || Math.abs(b.quat.z) > 0.02) continue;   // a ramp
        const top = b.center.y + h.y;
        const rise = top - T.height(b.center.x, b.center.z);
        if (rise < 2.5 || rise > 12) continue;          // on the floor, or a roof
        decks.push({ rise, x: b.center.x, z: b.center.z });
      }
      assert(decks.length > 0, `${key}: no deck-shaped collider found at all`);
      const worst = decks.reduce((a, d) => (d.rise > a.rise ? d : a));
      assert(worst.rise <= 5.6,
        `${key}: a deck stands ${worst.rise.toFixed(2)} m over the ground at `
        + `(${worst.x.toFixed(0)}, ${worst.z.toFixed(0)}) and the highest jump in the game reaches 6.18 m `
        + '— nothing can ever stand on it');
      rows.push(`${key} ${decks.length} decks ≤ ${worst.rise.toFixed(1)} m`);
    }
    return rows.length ? rows.join('; ') : 'no level in the roster builds a raised deck';
  });

  /* ── 9. the wood's own arithmetic ─────────────────────────────────── */

  acheck('wood: the level states its tree count once, and states it right', async () => {
    /**
     * The header block over this level said "520 trees" and "the median sight
     * line on the walkable ground is 21 m" — three times, in the block a
     * maintainer reads first — while two hundred lines below it the dressing
     * pass planted 1,800 and recorded that at 520 the median measured 110 m,
     * "which is not a wood, it is a park with trees in it". One number, three
     * values, two measured consequences that cannot both be true.
     */
    const { readFile } = await import('node:fs/promises');
    const src = await readFile(new URL('../../src/game/Levels.js', import.meta.url), 'utf8');
    const { world } = await level('wood');
    const n = world.forest.count;
    assert(!/\b520 trees\b/.test(src), 'the wood still claims 520 trees somewhere in Levels.js');
    const counts = [...src.matchAll(/count:\s*(\d{3,5})[,\s]/g)]
      .map((m) => Number(m[1])).filter((v) => v === n);
    assert(counts.length >= 1,
      `Levels.js never sets a tree count of ${n}, which is what the level actually planted`);
    assert(new RegExp(String(n).replace(/(\d)(\d{3})$/, '$1,$2')).test(src)
      || new RegExp(`\\b${n}\\b`).test(src),
      `the header does not name the ${n} trees the level plants`);
    return `${n} planted, and Levels.js says so`;
  });

  /* release the worlds this file booted */
  check('levels-quality: the worlds this file built come down cleanly', async () => {
    await Promise.all(started);
    for (const { world, engine } of WORLDS.values()) {
      world.unload();
      world.dispose?.();
      assert(engine.scene.children.length < 40,
        `a level left ${engine.scene.children.length} nodes in the scene after unload`);
    }
    const n = WORLDS.size;
    WORLDS.clear();
    return `${n} levels booted, driven and torn down`;
  });

  check('nav: an enemy gets to you through a building, and does not press the wall it met', async () => {
    /**
     * THERE WAS NO NAVIGATION AT ALL.
     *
     * `Enemy._brain`'s `wish` is a direction toward the target with a circling
     * term and a neighbour-separation term on it, and nothing between it and
     * the geometry. So an acolyte walked the straight line to the player, met
     * the first wall on that line, and pressed into it for the rest of the
     * fight — its only response to a collider being a push-out that resolves
     * POSITION and never touches velocity or intent.
     *
     * And a body that got a shoulder strictly INSIDE a box was not even pushed
     * out: `_v3` is the chest point clamped into the box, so an interior point
     * gives a zero separation vector and the loop read `|| d2 < 1e-8) continue`.
     * The one case that most needs resolving was the one case skipped.
     *
     * DETERMINISM MATTERS HERE AND IT IS NOT FREE. World's own rng is seeded
     * from `Math.random()` at module load, so anything routed through
     * `pickSpawn` varies run to run — the same code measured 8/12, 9/12 and
     * 10/12 on three consecutive runs, which is a band wide enough to hide the
     * defect and wide enough to fake the fix. The bodies are placed on fixed
     * bearings instead, and a placement that is inside geometry or off the map
     * is DROPPED rather than nudged, so the denominator is stable too.
     *
     * Measured BY THIS CHECK, 16 bearings at 26 m, 40 s, four levels, arrivals
     * within 6 m:
     *
     *     before   temple 11/13   warship  9/13   intake 14/14   cut 16/16   50/56
     *     after    temple 12/13   warship 10/13   intake 14/14   cut 16/16   52/56
     *
     * BY THIS CHECK, and the emphasis is the correction. The table here first
     * read 49/55 · 52/55, which is what the scratchpad probe this grew out of
     * reported — a different harness, admitting one fewer bearing on the
     * warship because it tested placement itself instead of calling
     * `spawnClear`. A number copied from the thing that inspired a check
     * rather than taken from the check is a number that does not reproduce,
     * which is precisely the defect this file exists to catch elsewhere.
     *
     * The bar is 92%: the fixed tree measures 93% and the tree it replaces
     * 89.3%. It was 90%, which is 50.4 bodies against a pre-fix 50 — one extra
     * arrival anywhere, from a tuning tweak or a level edit or a spawn change,
     * and the check could no longer tell navigation from no navigation. It is
     * not higher than 92% because the bodies that still fail are placed in
     * rooms with no route out, and this must not become an argument about
     * level layout.
     */
    const THREE = await import('three');
    const { World } = await import('../../src/game/World.js');
    const { DEFAULT_SETTINGS } = await import('../../src/ui/Menu.js');
    const { Enemy, enemyRng } = await import('../../src/game/Enemy.js');
    const { duelRng } = await import('../../src/game/Duel.js');
    const { spawnClear } = await import('../../src/game/Spawn.js');

    const stubEngine = () => {
      const scene = new THREE.Scene();
      const sun = new THREE.DirectionalLight(0xffffff, 1);
      sun.shadow.camera.updateProjectionMatrix();
      scene.add(sun, new THREE.HemisphereLight(0x88aaff, 0x886644, 1));
      return { scene, camera: new THREE.PerspectiveCamera(60, 16 / 9, 0.045, 900),
        sun, hemi: scene.children[1], sunDir: new THREE.Vector3(0.4, 0.7, 0.5).normalize(),
        renderer: { info: { render: { calls: 0, triangles: 0 }, memory: { geometries: 0, textures: 0 } } },
        profiler: { begin() {}, end() {}, beginDraw() {}, endDraw() {}, dispose() {} },
        applyAtmosphere() {}, fitShadows() {}, flash() {}, hurt() {}, addHeat() {},
        setFocus() {}, setRadial() {}, setGrain() {}, setBloom() {}, setSense() {},
        setQuality() {}, setResolutionScale() {}, render() {} };
    };
    const idle = { act: () => false, actHit: () => false, actDown: () => false,
      moveAxis: (o) => { if (o) { o.x = 0; o.y = 0; return o; } return { x: 0, y: 0 }; },
      mouse: { dx: 0, dy: 0, wheel: 0, left: false, right: false },
      delta: { x: 0, y: 0 }, accel: { x: 0, y: 0 }, end() {} };

    /**
     * TEN BEARINGS AND NOT SIXTEEN, because the level list doubled.
     *
     * This ran 16 bearings on four levels — 56 placeable bodies for 40 s each.
     * Those four levels were `temple`, `warship`, `intake` and `cut`, ALL OF
     * WHICH WERE DELETED, so it was really walking four copies of the Ember
     * Shelf and calling the result four interiors (see the note in the spawns
     * check). Pointed at the real roster it covers eight genuinely different
     * grounds instead, and 10 × 8 keeps the sample within a body or two of what
     * it was while doubling the number of layouts it is drawn from. A wider
     * sample over more places beats a deeper one over the same place four times.
     *
     * SIX, AND THIS IS THE LONG POLE OF THE WHOLE SUITE — measured, because it
     * looks exactly like the §2.7 hang and is not one.
     *
     * Cost here is bodies × SECONDS × 60 of full `world.update` with real
     * physics and real enemies. Traced check by check on a ten-level roster:
     * ELEVEN of this file's twelve finish together in 72 s, and this one alone
     * was still running at 840 s. It is not stalled and it is not new — the
     * original 4 levels × 16 bearings × 40 s is 134,400 frames and the present
     * 10 × 6 × 40 is 144,000, so it has always been most of this suite's
     * wall-clock. What WAS a hang — nine dead level names booting nine extra
     * Worlds — is the fix above, and it is the reason eleven checks now finish
     * in the time twelve used to fail to.
     *
     * SECONDS stays at 40 because the 92% bar was calibrated at 40 and a shorter
     * walk would move it. The BEARINGS are what may safely move: the bar is a
     * RATIO, so fewer bearings is the same measurement with a slightly wider
     * error bar. Six is chosen so that a roster which has grown from four
     * levels to ten costs what it did when it was measuring four copies of one —
     * a wider sample over ten real layouts for the frames that bought four fake
     * ones.
     *
     * IF THIS EVER HAS TO GET CHEAPER, take it off the bearings and never off
     * SECONDS, and re-run the two-sided table above rather than moving the bar.
     */
    const N = 6, RADIUS = 26, SECONDS = 40;
    const walk = async (level) => {
      enemyRng.seed(4711);
      duelRng.seed(8123);
      const world = new World(stubEngine(), { ...DEFAULT_SETTINGS, quality: 'low' });
      await world.loadLevel(level);
      world.spawnPlayer?.();
      const p = world.player;
      const home = p.position.clone();
      for (const e of world.enemies) e.dispose();
      world.enemies.length = 0;
      const made = [];
      for (let i = 0; i < N; i++) {
        const a = (i / N) * Math.PI * 2;
        const x = home.x + Math.cos(a) * RADIUS, z = home.z + Math.sin(a) * RADIUS;
        if (!world.terrain.inBounds(x, z, 3)) continue;
        const y = world.terrain.height(x, z);
        if (!spawnClear(world, x, y, z)) continue;
        const e = new Enemy(world, 'acolyte', new THREE.Vector3(x, y, z));
        e.position.set(x, y, z);
        world.enemies.push(e);
        made.push({ e, best: Infinity });
      }
      for (let f = 0; f < SECONDS * 60; f++) {
        p.position.copy(home);
        p.hp = p.maxHp;
        world.update(1 / 60, idle);
        for (const m of made) m.best = Math.min(m.best, m.e.position.distanceTo(home));
      }
      const arrived = made.filter((m) => m.best < 6).length;
      world.unload();
      return { arrived, n: made.length };
    };

    const rows = [];
    let got = 0, tot = 0;
    /* FOUR MORE DEAD NAMES — see the note in the spawns check above. All four
     * of these rooms were deleted, so this walked four copies of the Ember Shelf
     * and called the result four interiors. Asked of the real roster instead:
     * "an enemy gets to you" is a property of every level, and the ones with
     * architecture in them are the ones that will fail it. */
    for (const level of LEVEL_ORDER) {
      const r = await walk(level);
      /**
       * THE FLOOR IS A FRACTION OF `N`, BECAUSE A LITERAL HERE WENT STALE THE
       * MOMENT `N` MOVED — and this is the first run that could ever have said so.
       *
       * It read `r.n >= 10`: correct while the check cast 16 bearings, and
       * unsatisfiable once the note above took it to 6. The failure it produced
       * says `only 6 of 6 bearings on scoria were placeable — nothing measured`,
       * which is every bearing the check asked for and the healthiest possible
       * result. Nobody had seen it because this suite has not completed a run
       * since: it was the second of the two suites voiding the gate, and the
       * check is the last one in the file.
       *
       * HANDOFF §2.3 in miniature — a hand-maintained number beside the thing it
       * is derived from. The guard exists to refuse a sample too small to carry
       * the 92% ratio, so it is written as the share of the cast it needs and
       * cannot be outlived by the next change to `N`.
       */
      assert(r.n >= Math.ceil(N * 0.6),
        `only ${r.n} of ${N} bearings on ${level} were placeable — fewer than the `
        + `${Math.ceil(N * 0.6)} this needs to carry a ratio`);
      got += r.arrived; tot += r.n;
      rows.push(`${level} ${r.arrived}/${r.n}`);
    }
    assert(got / tot >= 0.92,
      `${got} of ${tot} bodies (${(got / tot * 100).toFixed(0)}%) got within 6 m of a stationary `
      + `player in ${SECONDS} s — ${rows.join(', ')}. The rest are pressing a wall they walked into.`);
    return `${got}/${tot} arrive (${(got / tot * 100).toFixed(0)}%): ${rows.join(', ')}`;
  });

  check('levels: the game does not start you somewhere that kills you', async () => {
    /**
     * `spawnPlayer` placed the player at the literal `new THREE.Vector3(0, 0, 8)`
     * on all thirteen levels, tested against nothing. On The Foundry the floor
     * at (0, 8) is −2.29 and the melt sheet is at −1.45, so a run began with
     * the body 0.84 m UNDER a hazard dealing 58 HP a second: dead at 2.38 s
     * having pressed no key, at every quality tier, with four of five escape
     * directions also lethal.
     *
     * THE TERRAIN HEIGHT IS THE HALF THAT HID IT. `spawnClear` has guarded the
     * ENEMY picker since the same pass that added hazards — but the literal's
     * y of 0 sits above the melt, so even a spawnClear test at the old
     * coordinate would have returned true while the body stood under the
     * sheet. The deeps is the control: also submerged, also unmoved for years,
     * and harmless, because its water block carries no `damage` key.
     *
     * Driven rather than asserted: build every level, spawn, and press nothing
     * for ten seconds.
     */
    const THREE = await import('three');
    const { World } = await import('../../src/game/World.js');
    const { LEVEL_ORDER } = await import('../../src/game/Levels.js');
    const { DEFAULT_SETTINGS } = await import('../../src/ui/Menu.js');

    const stub = () => {
      const scene = new THREE.Scene();
      const sun = new THREE.DirectionalLight(0xffffff, 1);
      sun.shadow.camera.updateProjectionMatrix();
      scene.add(sun, new THREE.HemisphereLight(0x88aaff, 0x886644, 1));
      return { scene, camera: new THREE.PerspectiveCamera(60, 16 / 9, 0.045, 900),
        sun, hemi: scene.children[1], sunDir: new THREE.Vector3(0.4, 0.7, 0.5).normalize(),
        renderer: { info: { render: { calls: 0, triangles: 0 }, memory: { geometries: 0, textures: 0 } } },
        profiler: { begin() {}, end() {}, beginDraw() {}, endDraw() {}, dispose() {} },
        applyAtmosphere() {}, fitShadows() {}, flash() {}, hurt() {}, addHeat() {},
        setFocus() {}, setRadial() {}, setGrain() {}, setBloom() {}, setSense() {},
        setQuality() {}, setResolutionScale() {}, render() {} };
    };
    const idle = { act: () => false, actHit: () => false, actDown: () => false,
      moveAxis: (o) => { if (o) { o.x = 0; o.y = 0; return o; } return { x: 0, y: 0 }; },
      mouse: { dx: 0, dy: 0, wheel: 0, left: false, right: false },
      delta: { x: 0, y: 0 }, accel: { x: 0, y: 0 }, end() {} };

    const rows = [];
    for (const key of LEVEL_ORDER) {
      const w = new World(stub(), { ...DEFAULT_SETTINGS, quality: 'low' });
      await w.loadLevel(key);
      w.spawnPlayer();
      const p = w.player;
      const at = p.position.clone();
      let died = -1;
      for (let f = 0; f < 10 * 60; f++) {
        w.update(1 / 60, idle);
        if (!p.alive && died < 0) died = f / 60;
      }
      const hp = Math.max(0, p.hp);
      w.unload();
      assert(died < 0,
        `${key} killed a player who pressed nothing, ${died.toFixed(2)} s after the run began, `
        + `at (${at.x.toFixed(1)}, ${at.y.toFixed(2)}, ${at.z.toFixed(1)})`);
      assert(hp >= 100,
        `${key} took a player who pressed nothing from 100 hp to ${hp.toFixed(0)} in ten seconds, `
        + `at (${at.x.toFixed(1)}, ${at.y.toFixed(2)}, ${at.z.toFixed(1)})`);
      rows.push(`${key} ${at.y.toFixed(2)}`);
    }
    return `${LEVEL_ORDER.length} levels, ten seconds of no input each, nobody hurt (spawn y: `
      + `${rows.join(', ')})`;
  });
}
