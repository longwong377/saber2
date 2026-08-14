/**
 * SABER — IS A LEVEL A PLACE? — src/game/Levels.js, src/world/*.
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
 *   ONE SEA, ONE NUMBER. Mustafar drew its coast at 0.55 and walked it at 0.00.
 *   THE DOORS EXIST.     `world.doors` was empty on all thirteen levels.
 *   THE DECKS ARE REACHED. Eight of twelve gantry decks stood above the ceiling
 *                        of the highest jump in the game.
 */

import * as THREE from 'three';
import { initPhysics } from '../../src/physics/Rapier.js';
import { World } from '../../src/game/World.js';
import { LEVELS, LEVEL_ORDER } from '../../src/game/Levels.js';
import { DEFAULT_SETTINGS } from '../../src/ui/Menu.js';

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
     * y = 45.1 m and r = 114.8 m — up the podium, through thirty thousand
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
     * all floors. Measured: 90 s of holding forward on Mustafar finished 33 m
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
    const mus = (await level('mustafar')).world;
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
    const kam = (await level('kamino')).world;
    const wl = kam.level.water.level;
    const KT = kam.terrain;
    let worstDepth = -Infinity, eyeUnder = 0, frames = 0, shores = 0, endDepth = -Infinity;
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
    assert(shores >= 4, `only ${shores} of 6 bearings off the platform found the sea`);
    /* Three bars, because a plunge and a walk are different things. The deck
     * stands 5.6 m over the sea and its edge is a chamfer you slide off, so
     * walking off it is a FALL and the fall wins against the shove for the
     * second it lasts — the player goes 2.4 m under. What must not happen is
     * what used to: 45 s of walking finishing on the seabed at y = -9.0 with
     * the camera under the ocean for 64% of the walk. So: never deep enough to
     * be swimming, back in the shallows by the end of the bearing, and the eye
     * under the surface for moments rather than for the level. */
    assert(worstDepth < 3.0,
      `the player reached ${worstDepth.toFixed(1)} m below the surface of the ocean — the seabed is at `
      + '-9.0 m and the deck is the level');
    /* 2.0 m at the end, not 1.0: a player who keeps holding forward comes to
     * rest in a standoff a little seaward of the wade line — the shove is
     * 7.5 m/s against a 4.6 m/s walk, but the shove runs up the bed's own
     * gradient and the walk does not, so the balance point sits where the two
     * cross rather than where `wade` is. Measured on Kamino, the player stops
     * dead at 1.53 m of depth with their eye 9 cm clear of the surface, and
     * stays there: chest-deep at the edge of the world, which is the reading,
     * against the 9 m seabed they used to end up strolling along. */
    assert(endDepth < 2.0,
      `after twelve seconds of walking out to sea the player is still ${endDepth.toFixed(1)} m under — `
      + 'the bed is meant to put them back in the shallows');
    assert(eyeUnder / frames < 0.05,
      `${(100 * eyeUnder / frames).toFixed(0)}% of frames had the player's eye under the ocean`);
    return `lava kills in ${died.toFixed(1)} s; ${shores} bearings walked into the ocean stop at `
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
    const rows = [];
    for (const key of ['temple', 'arena', 'warship', 'intake', 'deeps']) {
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
    const { world, engine } = await level('deeps');
    const T = world.terrain, wl = world.level.water.level;
    let n = 0, sub = 0, eye = 0;
    for (let x = -60; x <= 60; x += 1) {
      for (let z = -60; z <= 60; z += 1) {
        if (x * x + z * z > 3600) continue;
        const y = T.height(x, z); n++;
        if (y < wl) sub++;
        if (y + 1.62 < wl) eye++;
      }
    }
    assert(sub / n < 0.60,
      `${(100 * sub / n).toFixed(1)}% of the fighting floor is under the water sheet`);
    assert(eye / n < 0.03,
      `${(100 * eye / n).toFixed(1)}% of the fighting floor is deep enough to put the player's eye `
      + 'under the surface');
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
      `the render camera is under the water plane on ${(100 * camUnder / frames).toFixed(0)}% of frames `
      + 'over four bearings of walking');
    return `${(100 * sub / n).toFixed(0)}% of the floor wet, ${(100 * eye / n).toFixed(1)}% over eye height, `
      + `camera under the sheet on ${(100 * camUnder / frames).toFixed(1)}% of ${frames} frames`;
  });

  /* ── 6. one sea, one number ───────────────────────────────────────── */

  acheck('water: a level that has a sea has one number for where it is', async () => {
    /**
     * `Levels.water.level` is what World builds the sheet from;
     * `TERRAIN_PRESETS[...].waterLevel` is what `surfaceAt` (footstep sample,
     * splash particle) and the ground shader's damp band key off. Mustafar had
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
    assert(rows.length >= 5, `only ${rows.length} levels with water were surveyed`);
    return rows.join(', ');
  });

  /* ── 7. the doors ─────────────────────────────────────────────────── */

  acheck('doors: the blast doors the works describes are in the works', async () => {
    /**
     * `World.doors` was allocated in the constructor, disposed on unload,
     * stepped every frame and handed to the blade solver every frame — and it
     * was EMPTY on all thirteen levels, because World had no method that could
     * put anything in it. `BlastDoor` is a finished object (kerf texture,
     * discard-through hole, static collider, capsules at 0.55 m for the blade,
     * a breach that drops the slug out) that no level had ever built, while
     * nine stub worlds in this suite implemented an `addDoor` the real World
     * did not have.
     */
    for (const key of ['intake', 'foundry']) {
      const { world } = await level(key);
      assert(typeof world.addDoor === 'function', 'World still has no addDoor');
      assert(world.doors.length >= 3,
        `${key}: ${world.doors.length} doors — the shell comment says every fourth bay is a blast door recess`);
      for (const d of world.doors) {
        assert(d.collider && !d.collider.disabled, `${key}: a door with no collider`);
        assert(world.physics.staticBoxes.includes(d.collider),
          `${key}: a door's collider is not in the physics world`);
        assert(d.capsules().length > 4,
          `${key}: a door the blade solver cannot find (${d.capsules().length} capsules)`);
      }
    }
    const { world } = await level('intake');
    return `${world.doors.length} blast doors on the intake, each a collider and `
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
    for (const key of ['intake', 'foundry', 'deeps', 'warship']) {
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
    return rows.join('; ');
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
}
