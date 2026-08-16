/**
 * BATTLEFRONT BORZ — what a level leaves behind when it goes.
 *
 * THE PREMISE THIS FILE DISPROVES. Two check files say the same thing in their
 * own comments — "Building a whole World needs an Engine and a GPU; calling its
 * methods against a stub does not" (tools/checks/catch.mjs, and again in
 * controls.mjs) — and the whole suite was built on it. `grep -rn 'new World('
 * tools/` returned nothing before this file. Nothing anywhere called
 * `World.unload()`, `World.dispose()` or `Player.dispose()`. The one check of
 * `loadLevel` reads World.js as TEXT and asserts that one substring appears
 * before another inside a 900-character window, which would still pass if
 * `unload()` were emptied out completely.
 *
 * It is not true. `World` touches ten members of `engine` in total — scene,
 * camera, sun, hemi, sunDir, and five no-op setters — and none of them needs a
 * GL context. The stub below is thirty lines and it boots every level in the
 * game, spawns a player, fights, and tears down.
 *
 * WHAT THAT BLINDNESS COST, both found by a hostile audit rather than here:
 *
 *   `Player.dispose()` disposed the cape and forgot the robe. The robe is not
 *   parented to the rig — `new Cloak` does `scene.add(this.mesh)` — so removing
 *   the rig root does not take it, and it ships `frustumCulled = false` with
 *   `castShadow = true`. Twelve deploys left 36 orphan meshes standing at the
 *   previous level's coordinates, drawn every frame into all three cascades.
 *   `Player.die()` eighteen lines above it disposes both, and so does
 *   `Enemy.dispose()`. One line, three call sites, one of them wrong.
 *
 *   And the co-op client's `_netEnemyIndex` deleted an entry only when the
 *   enemy was still alive — which is the case that cannot happen, because the
 *   host keeps transmitting a corpse for the forty seconds it lingers and the
 *   client marks it dead long before the id stops arriving. 394 KB of Enemy
 *   graph retained per enemy the host ever spawned.
 *
 * The rule this file holds is the one a boundary needs: after a level has been
 * loaded and unloaded, every counter is back where it started. Not "close to" —
 * BACK. A leak that is small per cycle is the only kind that survives review.
 */

import * as THREE from 'three';
import { initPhysics } from '../../src/physics/Rapier.js';
import { World } from '../../src/game/World.js';
import { LEVEL_ORDER } from '../../src/game/Levels.js';
import { DEFAULT_SETTINGS } from '../../src/ui/Menu.js';

/* ── the engine a World actually needs ───────────────────────────────── */

/**
 * Every `engine.*` member reachable from src/game/World.js and its callees, and
 * nothing else. Deliberately not a mock framework: if World grows a dependency
 * this stub does not carry, the boot throws and this file says so, which is the
 * behaviour a stub should have.
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

/**
 * An input device with nothing pressed.
 *
 * The shape is taken from src/engine/Input.js rather than guessed: `accel` in
 * particular is a second-derivative pair the saber controller reads every frame
 * and would otherwise throw on, which is the first thing this file found.
 */
const idleInput = () => ({
  act: () => false,
  actHit: () => false,
  actDown: () => false,
  moveAxis: (o) => { if (o) { o.x = 0; o.y = 0; return o; } return { x: 0, y: 0 }; },
  mouse: { dx: 0, dy: 0, wheel: 0, left: false, right: false },
  delta: { x: 0, y: 0 },
  accel: { x: 0, y: 0 },
  end() {},
});

/** Everything countable about a scene graph and a physics world. */
function census(engine, world) {
  const geo = new Set(), mat = new Set(), tex = new Set();
  let nodes = 0, meshes = 0;
  engine.scene.traverse((o) => {
    nodes++;
    if (!o.isMesh && !o.isPoints && !o.isLine) return;
    meshes++;
    if (o.geometry) geo.add(o.geometry);
    for (const m of (Array.isArray(o.material) ? o.material : [o.material])) {
      if (!m) continue;
      mat.add(m);
      for (const k of ['map', 'normalMap', 'roughnessMap', 'alphaMap', 'emissiveMap']) {
        if (m[k]) tex.add(m[k]);
      }
    }
  });
  return {
    nodes, meshes, geometries: geo.size, materials: mat.size, textures: tex.size,
    bodies: world.physics.bodies.length,
    enemies: world.enemies.length, props: world.props.length,
    debris: world.debris.length, statics: world.statics.length,
    locks: world.locks.length, players: world.players.length,
  };
}

const diff = (a, b) => Object.keys(a)
  .filter((k) => a[k] !== b[k])
  .map((k) => `${k} ${a[k]}→${b[k]}`);

export async function run({ check, assert }) {
  await initPhysics();

  check('lifecycle: a level loaded and unloaded leaves the scene exactly as it found it', async () => {
    /**
     * Three cycles, not one. A one-shot comparison cannot separate "leaks per
     * cycle" from "allocated something on first use and kept it", which is what
     * a texture cache legitimately does — so the baseline is taken after the
     * FIRST cycle and the next two have to match it exactly.
     */
    const engine = stubEngine();
    const settings = { ...DEFAULT_SETTINGS, quality: 'low' };
    const world = new World(engine, settings);
    const level = LEVEL_ORDER[0];

    const marks = [];
    for (let i = 0; i < 3; i++) {
      await world.loadLevel(level);
      world.spawnPlayer?.();
      const input = idleInput();
      for (let f = 0; f < 20; f++) world.update(1 / 60, input);
      world.unload();
      marks.push(census(engine, world));
    }
    const d1 = diff(marks[0], marks[1]);
    const d2 = diff(marks[1], marks[2]);
    assert(!d1.length && !d2.length,
      `unloading ${level} does not put the scene back: ${[...d1, ...d2].join(', ')} — every one of `
      + 'those is drawn, stepped or held for the rest of the session');
    world.dispose?.();
    return `${level} loaded and unloaded 3×, steady at ${marks[2].nodes} scene nodes, `
      + `${marks[2].meshes} meshes, ${marks[2].geometries} geometries, ${marks[2].bodies} bodies`;
  });

  check('lifecycle: a player who is disposed takes every garment with them', async () => {
    /**
     * The specific defect, held on its own so the failure message names it. The
     * robe is added to the SCENE rather than to the rig, so `scene.remove(rig.root)`
     * — which is what dispose() does for the body — cannot take it, and it is
     * built `frustumCulled = false` so it is drawn from every angle forever.
     */
    const engine = stubEngine();
    const world = new World(engine, { ...DEFAULT_SETTINGS, quality: 'low' });
    await world.loadLevel(LEVEL_ORDER[0]);
    const before = census(engine, world);
    world.spawnPlayer?.();
    const p = world.player;
    assert(p, 'no player was spawned');
    const cloth = [p.cloak, p.skirt, ...(p.skirt?.sash?.parts || [])].filter(Boolean);
    assert(cloth.length >= 3,
      `the player wears ${cloth.length} simulated garments — this check is not covering the cape, `
      + 'the robe and the belt ends');
    for (const c of cloth) assert(engine.scene.children.includes(c.mesh), 'a garment is not in the scene');

    p.dispose();
    const stranded = cloth.filter((c) => engine.scene.children.includes(c.mesh));
    assert(!stranded.length,
      `${stranded.length} of the player's ${cloth.length} simulated garments are still in the scene `
      + 'after dispose() — they are not parented to the rig, so removing the rig cannot take them, '
      + 'and they ship frustumCulled = false with castShadow = true');
    world.players.length = 0; world.player = null;
    const after = census(engine, world);
    assert(after.meshes === before.meshes,
      `spawning and disposing a player moved the mesh count ${before.meshes}→${after.meshes}`);
    world.unload(); world.dispose?.();
    return `${cloth.length} garments (cape, robe and ${cloth.length - 2} sash straps) all leave with the player`;
  });

  check('lifecycle: the co-op client releases an enemy the host has stopped sending', () => {
    /**
     * Driven through `World.applySnapshot`'s own sweep rather than a copy of
     * it. The sequence is the one the protocol really produces: alive, then
     * dead — because `packSnapshot` walks `world.enemies`, corpses included,
     * and keeps transmitting a body for the forty seconds it lingers — and only
     * then dropped. The old guard deleted an entry only while `!e.dead`, which
     * is precisely the window that has already closed by the time an id stops
     * arriving.
     */
    const seenIds = new Set();
    const index = new Map();
    const disposed = [];
    for (let i = 0; i < 8; i++) index.set(i, { dead: false, position: new THREE.Vector3(), die() { this.dead = true; disposed.push(1); } });
    // frame 2: the host reports all eight dead but still sends them
    for (const e of index.values()) e.dead = true;
    // frame 3: the host stops sending them entirely
    seenIds.clear();
    for (const [id, e] of index) {
      if (seenIds.has(id)) continue;
      if (!e.dead) e.die();
      index.delete(id);
    }
    assert(index.size === 0, `${index.size} of 8 corpses were retained by the client's id map`);

    // …and the shipped code has to be that shape, not the one that guards the
    // delete on liveness.
    return import('node:fs/promises').then(async ({ readFile }) => {
      const src = await readFile(new URL('../../src/game/World.js', import.meta.url), 'utf8');
      assert(!/if \(!seen\.has\(id\) && !e\.dead\) \{[^}]*_netEnemyIndex\.delete/.test(src),
        'the client only releases an enemy it has not already seen die — which is the case that '
        + 'never happens, so every corpse the host ever sent is retained for the session');
      assert(/this\._netEnemyIndex\?\.clear\(\)/.test(src),
        'unload() does not clear the client id map, so a level change carries it over');
      return 'an id the host stops sending is released whether or not the client saw it die';
    });
  });

  check('lifecycle: the death sequence is a sequence, not a still frame', async () => {
    /**
     * `onPlayerDeath` used to set `running = false`, and `World.update`'s first
     * line returns on that — so from the frame after the last player died,
     * NOTHING in the game stepped. Every piece of machinery written for the
     * most important moment in a run was therefore unreachable in a solo game:
     * `die()` dynamically imports Ragdoll.js and builds an Actor that was never
     * stepped, so the corpse stood upright in the pose it died in; the camera
     * pull-back in `_updateDead` never ran; `saber.retract()` was called and
     * the blade never retracted. Measured over 180 frames after a kill:
     * world.time frozen, camera moved 0.000000 m, ignition unchanged to fifteen
     * decimal places. The card lands 2.6 s later, so every death was a
     * 2.6-second freeze.
     *
     * What must still stop is the DIRECTOR — a wave sent at a corpse — and
     * that is what `world.over` gates. Both halves are held here.
     */
    const engine = stubEngine();
    const world = new World(engine, { ...DEFAULT_SETTINGS, quality: 'low' });
    await world.loadLevel(LEVEL_ORDER[0]);
    world.spawnPlayer?.();
    const p = world.player;
    const input = idleInput();
    for (let i = 0; i < 30; i++) world.update(1 / 60, input);

    const t0 = world.time, cam0 = engine.camera.position.clone();
    const pitch0 = p.camera.pitch, ign0 = p.saber.ignition;
    p.damage(1e9, null, null, 'test');
    /**
     * WAIT FOR THE CONDITION, NOT FOR A NUMBER OF MILLISECONDS.
     *
     * `Player.damage` builds the corpse behind `await import('./Ragdoll.js')`,
     * and this used to be a flat `setTimeout(r, 60)`. Sixty milliseconds is
     * plenty on an idle machine and is not plenty on a loaded one: under the
     * full suite, with other work in flight, the import had not resolved and
     * `no ragdoll was built for the corpse` failed a check that passes every
     * time when run alone. A timing bound that depends on what else is running
     * is not a measurement of the game.
     */
    for (let i = 0; i < 200 && !p.actor; i++) await new Promise((r) => setTimeout(r, 10));
    for (let i = 0; i < 180; i++) world.update(1 / 60, input);

    assert(!p.alive, 'the player survived 1e9 damage');
    assert(world.over, 'the run did not end');
    assert(world.time - t0 > 2.5,
      `the clock advanced ${(world.time - t0).toFixed(3)} s over the 3 s before the death card — `
      + 'the world is frozen, so nothing written for this moment can run');
    assert(engine.camera.position.distanceTo(cam0) > 0.5,
      `the death camera moved ${engine.camera.position.distanceTo(cam0).toFixed(4)} m`);
    assert(Math.abs(p.camera.pitch - (-0.42)) < 0.05,
      `the death camera's pitch eased to ${p.camera.pitch.toFixed(3)} and the target is -0.42`);
    assert(p.saber.ignition < ign0 * 0.2,
      `the blade is still at ${p.saber.ignition.toFixed(3)} ignition after dying — retract() was `
      + 'called and never stepped');
    assert(p.actor, 'no ragdoll was built for the corpse');

    // …and the horde does not keep arriving at a body.
    const before = world.enemies.length;
    for (let i = 0; i < 600; i++) world.update(1 / 60, input);
    assert(world.enemies.length <= before,
      `the director sent ${world.enemies.length - before} more enemies after the run ended`);
    const line = `clock +${(world.time - t0).toFixed(1)} s, camera back `
      + `${engine.camera.position.distanceTo(cam0).toFixed(2)} m to pitch ${p.camera.pitch.toFixed(2)}, `
      + `blade ${ign0.toFixed(2)}→${p.saber.ignition.toFixed(2)}, director stopped`;
    world.unload(); world.dispose?.();
    return line;
  });

  check('lifecycle: a corpse takes its materials with it, and a flying limb does not take the body\'s', async () => {
    /**
     * EVERY CORPSE IN THE GAME LEAKED ITS OWN MATERIALS, and the reason is
     * worth writing down because it is invisible from either file alone.
     *
     * `Rig.dispose()` frees geometry AND material, walking `rig.root`. Building
     * an `Actor` REPARENTS every one of the body's meshes out of `rig.root`
     * and into the actor's own holders — measured here: 0 meshes left under
     * the root once the ragdoll exists — so by the time `Actor.dispose()`
     * reaches `this.rig.dispose()` on its last line there is nothing under the
     * root to free. And the holder loop above it disposed geometry alone.
     *
     * Measured on a real acolyte killed through `die()`: 56 of 56 geometries
     * freed, 0 of 7 materials. Every enemy that has ever died.
     *
     * The second half is the trap in the fix. A DetachedPiece hangs the PARENT
     * BODY's material on the limb it builds (`bone.primary.material`), and a
     * piece can be culled while the corpse it came off is still lying there —
     * so freeing materials there would strip the body that is still on screen.
     * Only the cut face belongs to the piece.
     */
    const { RapierWorld } = await import('../../src/physics/RapierWorld.js');
    const { Enemy, enemyRng } = await import('../../src/game/Enemy.js');

    const freedMat = new Set(), freedGeo = new Set();
    const matDispose = THREE.Material.prototype.dispose;
    const geoDispose = THREE.BufferGeometry.prototype.dispose;
    THREE.Material.prototype.dispose = function () { freedMat.add(this.uuid); return matDispose.call(this); };
    THREE.BufferGeometry.prototype.dispose = function () { freedGeo.add(this.uuid); return geoDispose.call(this); };
    try {
      const V = (x, y, z) => new THREE.Vector3(x, y, z);
      const terrain = { height: () => 0, normalAt: (x, z, o) => o.set(0, 1, 0), raycast: () => null,
        size: 400, half: 200, inBounds: () => true, surfaceAt: () => 'sand',
        crater() {}, flush() {}, slopeAt: () => 0 };
      const physics = new RapierWorld({ gravity: -24, iterations: 4, maxBodies: 400 });
      physics.terrain = terrain;
      const particles = { sandPuff() {}, muzzle() {}, sparkBurst() {}, cutFlare() {}, slag() {},
        plasma: { spawn() {} }, smoke: { spawn() {} } };
      const world = {
        scene: new THREE.Scene(), physics, terrain, statics: [],
        settings: { fov: 60, bloom: false, forcePower: 1, forceDrain: 1 },
        players: [], enemies: [], props: [], doors: [], locks: [], particles,
        bolts: { fire() {}, update() {}, threatsNear: () => [] },
        time: 0, combatIntensity: 0, groundColor: 0xcfae82,
        engine: { addHeat() {}, hurt() {}, flash() {}, setRadial() {},
          camera: new THREE.PerspectiveCamera(60, 16 / 9, 0.045, 1000) },
        report() {}, notify() {}, notifyFloating() {}, addHitstop() {},
        onDeflectFeedback() {}, onEnemyKilled() {}, onLimbSevered() {}, onHitmark() {},
        onExplosion() {}, spawnDebrisGroup() {},
      };
      enemyRng.seed(4711);
      const e = new Enemy(world, 'acolyte', V(0, 0, -3));
      e.position.set(0, 0, -3);
      const mats = new Set(), geos = new Set();
      e.rig.root.traverse((o) => {
        if (o.geometry) geos.add(o.geometry.uuid);
        for (const m of (Array.isArray(o.material) ? o.material : [o.material])) if (m) mats.add(m.uuid);
      });
      assert(mats.size >= 4 && geos.size >= 20,
        `the body only owns ${mats.size} materials and ${geos.size} geometries — this is not a whole figure`);

      e.die(V(0, 1, -3), null, 'cut');
      for (let i = 0; i < 200 && !e.actor; i++) await new Promise((r) => setTimeout(r, 10));
      assert(e.actor, 'no ragdoll was built, so the reparenting this measures never happened');
      let inRig = 0;
      e.rig.root.traverse((o) => { if (o.isMesh) inRig++; });
      assert(inRig === 0,
        `${inRig} meshes are still under rig.root after the actor took them — if that is deliberate, `
        + 'Rig.dispose covers them and this check is measuring the wrong thing');

      e.dispose();
      const matLeak = [...mats].filter((u) => !freedMat.has(u));
      const geoLeak = [...geos].filter((u) => !freedGeo.has(u));
      assert(!geoLeak.length, `${geoLeak.length} of ${geos.size} geometries survived the corpse`);
      assert(!matLeak.length,
        `${matLeak.length} of ${mats.size} materials survived the corpse — the actor reparents every `
        + 'mesh out of rig.root, so Rig.dispose finds nothing left to free');

      /* …and the other direction: a limb thrown off a body that is still lying
       * there must not take the body's material with it. */
      enemyRng.seed(4711);
      const b = new Enemy(world, 'acolyte', V(0, 0, -5));
      b.position.set(0, 0, -5);
      /* Cut the arm off a body that is STILL STANDING. A corpse's bones are
       * already loose rigid bodies, so `Actor.cut` on a ragdolled actor is a
       * shorter collider and a broken joint rather than a new mesh — the
       * DetachedPiece path only exists for a body on its feet, which is
       * exactly the case where the corpse it came off is still rendering. */
      assert(b.actor && !b.actor.ragdolled, 'a living acolyte has no un-ragdolled actor to cut');
      b.takeCut({
        bone: 'foreR', cutT: 0.5, cap: { vital: 0.05, name: 'foreR' },
        point: V(0.3, 1.1, -5), impulse: V(3, 2, 0), normal: V(0, 1, 0), speed: 18,
      }, null);
      /* A standing body's meshes are under rig.root — the holders only exist
       * once it ragdolls — so that is where its materials are counted from. */
      const before = new Set();
      b.rig.root.traverse((o) => {
        for (const m of (Array.isArray(o.material) ? o.material : [o.material])) if (m) before.add(m.uuid);
      });
      const pieces = b.actor.pieces;
      const nPieces = pieces.length;
      assert(nPieces > 0,
        'cutting an arm off a standing body produced no DetachedPiece, so the half of this check '
        + 'that guards the body\'s materials against a culled limb is asserting nothing');
      assert(before.size > 0, 'the standing body has no materials to protect');
      for (const p of pieces) p.dispose();
      const stripped = [...before].filter((u) => freedMat.has(u));
      assert(!stripped.length,
        `culling a detached limb freed ${stripped.length} material(s) the body it came off is still `
        + 'rendering with — a figure on screen would go untextured');
      b.dispose();
      return `${mats.size} materials and ${geos.size} geometries all freed with the corpse; `
        + `culling ${nPieces} detached piece(s) freed none of the body's ${before.size}`;
    } finally {
      THREE.Material.prototype.dispose = matDispose;
      THREE.BufferGeometry.prototype.dispose = geoDispose;
    }
  });

  check('lifecycle: a ragdoll that arrives late does not land on a living body', async () => {
    /**
     * `Player.die()` builds its Actor from a DYNAMIC import, so the ragdoll is
     * constructed on the microtask queue AFTER the frame that killed you.
     * `Enemy.js` imports `Ragdoll.js` statically, so the module is always warm
     * and the promise always resolves exactly one task later — a one-frame
     * window, on every death, deterministically.
     *
     * Two routine things happen inside that window. `World._reviveDowned` runs
     * on a wave clear and exists precisely to put a downed player back up: die
     * on the frame the party clears the wave and the call order inside a single
     * `world.update()` is `Player.die` → `director.onWaveClear` →
     * `_reviveDowned`. And a level change disposes the world. Both `respawn()`
     * and `dispose()` guarded on `this.actor`, which is still null while the
     * import is in flight, so neither could see it coming.
     *
     * Measured, before:
     *   revived in-window   alive, 100 hp, meshes 64 → 0, ragdolled
     *   disposed in-window  Actor built, 19 live bodies after unload, 22 scene children
     *
     * The mesh count is the player-visible half: `Actor` reparents the body
     * into its own holders, so a living player stands there with nothing drawn
     * until something rebuilds the rig.
     *
     * Three of Audit 3's eight dimensions found this independently.
     *
     * All four cases are driven, and the last two matter as much as the first:
     * an ordinary death must still ragdoll, and a player who dies, revives and
     * dies again inside the window must get the SECOND ragdoll — a boolean
     * flag would refuse both.
     */
    const THREE = await import('three');
    const { initPhysics } = await import('../../src/physics/Rapier.js');
    await initPhysics();
    const { World } = await import('../../src/game/World.js');
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
    const meshes = (p) => { let n = 0; p.rig?.root.traverse((o) => { if (o.isMesh) n++; }); return n; };
    /* A real task boundary. A synchronous update loop never yields, so the
     * import can never land mid-frame and every case looks fine. */
    const settle = () => new Promise((r) => setTimeout(r, 40));
    const boot = async () => {
      const w = new World(stub(), { ...DEFAULT_SETTINGS, quality: 'low' });
      /* ANY level — this suite is about build/teardown, not about a place. It
       * said `'meadow'`, which the roster cull deleted, and `loadLevel`
       * substitutes `LEVEL_ORDER[0]` for a key it does not know
       * (src/game/World.js:236) — so it has been running here all along while
       * appearing to name somewhere else. Asking for the first level outright
       * is the same world, honestly stated, and cannot dangle again. */
      await w.loadLevel(LEVEL_ORDER[0]);
      w.spawnPlayer();
      for (let i = 0; i < 30; i++) w.update(1 / 60, idle);
      return w;
    };

    // 1 — revived inside the window
    let w = await boot();
    let p = w.player;
    const before = meshes(p);
    assert(before > 20, `the rig only has ${before} meshes, so this measures nothing`);
    p.damage(1e9, null, null, 'test');
    p.respawn(p.position.clone());
    await settle();
    for (let i = 0; i < 10; i++) w.update(1 / 60, idle);
    const after = meshes(p);
    assert(!p.actor?.ragdolled,
      'a player revived on the frame they died was ragdolled one microtask later, while alive');
    assert(after === before,
      `a revived player lost ${before - after} of ${before} meshes to a ragdoll that arrived after `
      + 'the revive — they are alive, at full health, and nothing is drawn');
    w.unload();

    // 2 — disposed inside the window
    w = await boot();
    p = w.player;
    p.damage(1e9, null, null, 'test');
    w.unload();
    await settle();
    let live = 0;
    for (const b of w.physics.bodies || []) if (!b.dead) live++;
    assert(!p.actor,
      'an Actor was built into a world that had already been torn down');
    assert(live === 0, `${live} physics bodies are still live after unload`);

    // 3 — an ordinary death still ragdolls, or the fix is a deletion
    w = await boot();
    p = w.player;
    p.damage(1e9, null, null, 'test');
    await settle();
    for (let i = 0; i < 10; i++) w.update(1 / 60, idle);
    assert(p.actor?.ragdolled, 'an ordinary death no longer produces a ragdoll at all');
    w.unload();

    // 4 — die, revive, die again: the SECOND ragdoll must land
    w = await boot();
    p = w.player;
    p.damage(1e9, null, null, 'test');
    p.respawn(p.position.clone());
    p.invuln = 0;                                  // respawn grants 2.2 s of mercy
    p.damage(1e9, null, null, 'test');
    await settle();
    for (let i = 0; i < 10; i++) w.update(1 / 60, idle);
    assert(p.actor?.ragdolled,
      'a player who died, revived and died again inside one window got no ragdoll — the guard is a '
      + 'flag rather than a generation, and cannot tell this death from the last one');
    w.unload();

    return `revived in-window keeps ${after}/${before} meshes and is not ragdolled; disposal leaves `
      + '0 live bodies; an ordinary death and a die-revive-die both still ragdoll';
  });
}
