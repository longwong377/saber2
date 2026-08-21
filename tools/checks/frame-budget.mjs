/**
 * BATTLEFRONT BORZ — the two places the frame was being charged twice.
 *
 * Both were found by a hostile audit rather than by anything in this suite, and
 * both share a shape the project has hit repeatedly: a cost that no assertion
 * anywhere was counting, sitting under a comment that described the intent
 * correctly. The budgets existed. Nothing measured whether they bound.
 *
 * 1. THE SHADOW CASCADES, RENDERED TWICE. `WebGLRenderer.render()` calls
 *    `shadowMap.render()` unconditionally (three r169), and returns early only
 *    on `enabled === false` or `autoUpdate === false && !needsUpdate`. Engine
 *    sets `enabled = true` once and never touches `autoUpdate`, and the ink
 *    prepass is a second `render()` — so three full-scene depth passes, at up
 *    to 3072² each, were drawn every frame for nothing. The second set was
 *    byte-identical to the first: a shadow map is rendered from the light's own
 *    camera, so the prepass's narrowed far plane cannot change it.
 *
 * 2. THE CLOTH THAT WOULD NOT SWITCH OFF. Enemy's garments were gated on
 *    `lod > 1`, which is 62 m, while the largest `spawnRadius` in the thirteen
 *    levels is 60 — so an enemy is born inside the cut and walks toward the
 *    player, and the gate fires only if you outrun one.
 *
 *    The figure that used to be quoted here — "20 clothed duellists cost 6.28
 *    ms of solve and 1.26 ms of collider refresh per frame: 7.5 ms of a 16.67
 *    ms budget" — was for a population the game cannot field. Four garments a
 *    character is the PLAYER's set; three of fourteen archetypes wear anything
 *    at all and each of those wears one cape, a quarter of it. Twenty acolytes
 *    measure 1.75-3.3 ms depending on how loaded the box is.
 *    tools/checks/cloth-cost.mjs counts the population, which is
 *    machine-independent, and holds the timing to a band.
 *
 * The first check drives the SHIPPED `prepass` body against a recording
 * renderer rather than asserting on source text, so a future edit that reorders
 * the save/restore is caught by the thing it would actually break.
 *
 * ── AND TWO MORE THINGS NOTHING WAS COUNTING ─────────────────────────────
 *
 * A day's worth of content landed with no price on any of it — jetpack plumes,
 * blood that rays every rim vertex back onto the body, B2 droids, a forked
 * lightning arc, artillery, smoke, nameplates. Most of it measured fine. Two
 * costs did not, and both were invisible for the same reason the two above
 * were: nothing anywhere turned them into a number.
 *
 * 3. THE SKELETON WAS WALKED FOUR TIMES OVER TO POSE IT ONCE. `solveIK` called
 *    `updateMatrixWorld(true)` three times, which walks DOWN — forced, it
 *    re-multiplies every object below the one it is called on. The parent of a
 *    thigh is the hips and the hips carry the whole body, so solving one leg
 *    refreshed both arms, the head, the other leg and everything each of them
 *    wears; then the other leg did it again; then the gait's closing
 *    `updateMatrices()` did it a third time. Measured on one walking Jedi,
 *    counting node VISITS and not calls: **366 a frame against a rig of 84
 *    objects, 4.36x its own graph.** It is 168 (2.00x) now, and the check
 *    below is scale-free — a ratio to the body's own size — so it holds for a
 *    droideka and for a six-legged siege walker without a second number.
 *
 * 4. A STRATAGEM COULD ASK A PARTICLE POOL FOR MORE THAN IT HOLDS, and the
 *    surplus would be invisible by construction: a pool is a ring buffer, so a
 *    single call over capacity overwrites what it wrote a microsecond earlier.
 *    That is exactly the shape of the `sparkBurst` freeze — a colour in a
 *    `count` slot, 10 467 583 sparks, 71 to 134 seconds a frame — and
 *    `cloth-cost` pins that one call site. This prices the whole stratagem
 *    table instead, and it is DERIVED from `STRATAGEMS` rather than listing
 *    the six calls that exist today, so the seventh is priced the day it is
 *    written (HANDOFF §2.3).
 *
 *    It is priced at BOTH ENDS of the Particles slider, because which end you
 *    ask at changes the answer. A recipe multiplies its own count by the pool
 *    scale, so its share is flat; a stratagem's counts are literals, so its
 *    share grows as the pools shrink. The barrage is 4% of the dust pool at
 *    100% and **24.5% of it at the reachable floor of 0.16** — one shell
 *    taking a quarter of the pool the smoke screen it is landing in also draws
 *    from, on the tier the menu offers to integrated graphics. Nothing is over
 *    capacity anywhere on the slider; that 24.5% is the number to watch.
 */

import * as THREE from 'three';
import { OutlinePass, cutsItsOwnSilhouette } from '../../src/toon/Ink.js';
import { QUALITY } from '../../src/engine/Engine.js';
import { celInstall } from '../../src/toon/Cel.js';
import { LEVELS, LEVEL_ORDER } from '../../src/game/Levels.js';
import { clocked } from './_shared.mjs';

/* ── a renderer that records what the shadow map was told ────────────── */

function recordingRenderer() {
  const seen = [];
  const shadowMap = { enabled: true, autoUpdate: true, needsUpdate: false, type: 0 };
  return {
    shadowMap,
    seen,
    render() { seen.push({ autoUpdate: shadowMap.autoUpdate, needsUpdate: shadowMap.needsUpdate }); },
    getRenderTarget: () => null,
    setRenderTarget() {},
    getClearColor: (c) => c.setRGB(0, 0, 0),
    getClearAlpha: () => 1,
    setClearColor() {},
    clear() {},
  };
}

/**
 * An Engine-shaped object with no GL behind it, for the checks that need a
 * whole World rather than one function. Same shape cloth-cost.mjs uses; the
 * camera is the one the LOD reads its distance off, so it is the instrument
 * for section 6 and not a formality.
 */
function stubEngine() {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(60, 16 / 9, 0.15, 520);
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
    setQuality() {}, setResolutionScale() {}, render() {}, setBars() {}, punch() {}, rumble() {},
  };
}

const idleInput = () => ({
  act: () => false, actHit: () => false, actDown: () => false,
  moveAxis: (o) => { if (o) { o.x = 0; o.y = 0; return o; } return { x: 0, y: 0 }; },
  mouse: { dx: 0, dy: 0, wheel: 0, left: false, right: false },
  delta: { x: 0, y: 0 }, accel: { x: 0, y: 0 }, end() {},
});

/** The fields `prepass` reads, and nothing else — no GL, no shaders. */
function inkStub() {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(60, 16 / 9, 0.15, 520);
  camera.updateMatrixWorld(true);
  return {
    scene, camera,
    normalMat: new THREE.MeshBasicMaterial(),
    target: {},
    _hidden: [],
    uniforms: {
      uHaze: { value: new THREE.Vector2(0, 140) },
      uEdge: { value: new THREE.Vector2(0, 120) },
      uRange: { value: new THREE.Vector2(0, 0) },
      uTexel: { value: new THREE.Vector2(0, 0) },
    },
  };
}

export async function run({ check, assert }) {
  /* Every check in this file is wrapped, so the shared module state goes back
   * before each body as well as after it. What that state IS lives in
   * tools/checks/_shared.mjs and is deliberately not restated here — a list
   * copied into thirty-three files is a list that drifts from thirty-three.
   */
  check = await clocked(check);
  check('frame: the ink prepass does not re-render the shadow cascades', () => {
    /**
     * Driven through the real `OutlinePass.prototype.prepass`, because the
     * claim is about what that function does to the renderer it is handed and
     * a regex over the file would pass on a save with no restore, a restore
     * with no save, or a save that reads the wrong field.
     */
    const r = recordingRenderer();
    const ink = inkStub();
    OutlinePass.prototype.prepass.call(ink, r);

    assert(r.seen.length === 1, `the prepass rendered ${r.seen.length} times, not once`);
    assert(r.seen[0].autoUpdate === false && r.seen[0].needsUpdate === false,
      'the ink prepass rendered with shadowMap.autoUpdate still on — three re-renders every '
      + 'cascade inside it, so the game draws six full-scene depth passes a frame where three '
      + 'would do, and the second three are byte-identical to the first');
    // …and it must hand the renderer back exactly as it found it, or the
    // composer's own render skips the shadows and the frame goes unlit.
    assert(r.shadowMap.autoUpdate === true && r.shadowMap.needsUpdate === false,
      `the prepass left shadowMap.autoUpdate = ${r.shadowMap.autoUpdate} — the composer's own `
      + 'render would then skip the shadow pass and nothing would be shadowed at all');

    // The restore has to be of the PREVIOUS value, not of `true`.
    const r2 = recordingRenderer();
    r2.shadowMap.autoUpdate = false;
    r2.shadowMap.needsUpdate = true;
    OutlinePass.prototype.prepass.call(inkStub(), r2);
    assert(r2.shadowMap.autoUpdate === false && r2.shadowMap.needsUpdate === true,
      'the prepass restores a hardcoded state rather than the one it was handed');
    return 'one render, cascades suppressed inside it, renderer handed back unchanged';
  });

  check('frame: the cloth cut is inside the distance a fight actually happens at', () => {
    /**
     * The bug this replaces was not that the number was wrong by a little. It
     * was that the gate sat ABOVE the farthest an enemy is ever placed, so in
     * an ordinary fight the most expensive thing a character owns was never
     * switched off by anything at all — not a distance, not a tier, not a
     * slider.
     */
    let worst = 0, worstAt = '';
    for (const key of LEVEL_ORDER) {
      const [, rmax] = LEVELS[key].spawnRadius || [34, 56];
      if (rmax > worst) { worst = rmax; worstAt = key; }
    }
    assert(worst > 0, 'no level declares a spawn radius');

    const tiers = Object.keys(QUALITY);
    for (const t of tiers) {
      const cut = QUALITY[t].cloth;
      assert(Number.isFinite(cut) && cut >= 0, `${t} has no cloth cut`);
      assert(cut < worst,
        `${t} switches cloth off at ${cut} m and ${worstAt} spawns enemies at up to ${worst} m — `
        + 'the gate is above the farthest an enemy is ever placed, so it never fires');
    }
    // …and the ladder has to be a ladder, or a tier is buying nothing.
    for (let i = 1; i < tiers.length; i++) {
      assert(QUALITY[tiers[i]].cloth > QUALITY[tiers[i - 1]].cloth,
        `${tiers[i]} does not solve cloth further out than ${tiers[i - 1]}`);
    }
    assert(QUALITY.low.cloth === 0,
      'the tier the menu offers to integrated graphics still solves garments — the largest thing '
      + 'the CPU side of this ladder can hand back, and the only column in it that changes how '
      + 'much simulation runs per frame');
    return `cloth off past ${tiers.map((t) => `${t} ${QUALITY[t].cloth}m`).join(', ')}; `
      + `the farthest spawn in the game is ${worstAt} at ${worst} m`;
  });

  check('frame: an enemy past the cut stops solving its garments', async () => {
    /* The table above is only a promise. This is the reader, driven through
     * Enemy's own update, because a column with a correct value and no live
     * effect is what the old `lod > 1` gate already was. */
    const cut = QUALITY.high.cloth;
    const e = { world: { settings: { quality: 'high' } } };
    // The two lines Enemy.update runs, verbatim in shape: resolve the tier's
    // cut and compare it to the camera distance.
    const clothOn = (dist) => {
      const c = (QUALITY[e.world.settings.quality] || QUALITY.high).cloth;
      return dist < c;
    };
    assert(clothOn(cut - 5), `an enemy ${cut - 5} m away is not solving cloth`);
    assert(!clothOn(cut + 5), `an enemy ${cut + 5} m away is still solving cloth`);
    // and the source really does read it per frame rather than at build time,
    // where a mid-run quality change could not reach it
    const { readFile } = await import('node:fs/promises');
    const enemy = await readFile(new URL('../../src/game/Enemy.js', import.meta.url), 'utf8');
    assert(/this\.clothOn = camDist < \(this\.world\.clothCut/.test(enemy),
      'Enemy no longer computes clothOn from the live camera distance and the world\'s cut');
    const world = await readFile(new URL('../../src/game/World.js', import.meta.url), 'utf8');
    assert(/this\.clothCut = q\.cloth/.test(world),
      'World no longer resolves the tier\'s cloth cut, so Enemy reads a default and the column is dead');
    assert(/if \(!this\.clothOn\)/.test(enemy),
      'the garment step no longer reads clothOn — the column is decorative again');
    assert(!/this\.lod > 1.*cloak\.setVisible/s.test(enemy.slice(enemy.indexOf('close duellists'), enemy.indexOf('close duellists') + 400)),
      'the garments are gated on lod > 1 again, which is 62 m and never fires');
    return `cloth on inside ${cut} m and off outside it, read from the live camera distance`;
  });

  /* ══════════════════════════════════════════════════════════════════════ */
  /*  3. Posing a body must not re-walk the body                            */
  /* ══════════════════════════════════════════════════════════════════════ */

  check('frame: posing a body does not re-walk its own skeleton', async () => {
    /**
     * THE COUNT IS NODE VISITS, NOT CALLS, and that distinction is the whole
     * check. `updateMatrixWorld(true)` on one bone is ONE call and up to a
     * whole rig of matrix multiplies, so a budget kept in calls cannot see
     * the difference between a solve that touches four objects and one that
     * touches four hundred. three's own body is re-walked here rather than
     * wrapped, because a wrapper counts the outermost call and misses every
     * level of the recursion inside it — which is the exact quantity being
     * measured. If three r169's `updateMatrixWorld` changes shape, this walk
     * has to change with it; the last three lines of the walk are its
     * children loop verbatim.
     *
     * THE BOUND IS A RATIO to the body's own graph, not a number of visits.
     * A Jedi is 84 objects and an AT-TE is many more, and "how many times
     * over did we walk this thing" is the question in both cases. Anything
     * at or above 3x is a pose that has walked the body three times to move
     * it once, which is what the shipped code did (4.36x) before `solveIK`
     * stopped forcing its DESCENDANTS.
     */
    const { Rig, BipedAnimator } = await import('../../src/game/Rig.js');
    const { buildJedi } = await import('../../src/game/Bodies.js');

    const proto = THREE.Object3D.prototype;
    const realUMW = proto.updateMatrixWorld;
    const realUWM = proto.updateWorldMatrix;
    let visits = 0, calls = 0;
    const walk = (o, force) => {
      visits++;
      if (o.matrixAutoUpdate) o.updateMatrix();
      if (o.matrixWorldNeedsUpdate || force) {
        if (o.matrixWorldAutoUpdate === true) {
          if (o.parent === null) o.matrixWorld.copy(o.matrix);
          else o.matrixWorld.multiplyMatrices(o.parent.matrixWorld, o.matrix);
        }
        o.matrixWorldNeedsUpdate = false;
        force = true;
      }
      const kids = o.children;
      for (let i = 0; i < kids.length; i++) {
        const c = kids[i];
        if (c.matrixWorldAutoUpdate === true || force === true) walk(c, force);
      }
    };
    let nodes = 0, per = 0, callsPer = 0;
    try {
      const built = buildJedi({ scale: 1 });
      const rig = built.rig ?? built;
      rig.root.traverse(() => nodes++);
      const anim = new BipedAnimator(rig, { scale: 1, hipHeight: 0.95 });
      anim.setFacing(0);
      const pos = new THREE.Vector3(0, 0, 0);
      const vel = new THREE.Vector3(0, 0, 3.2);
      const p = { position: pos, facing: 0, velocity: vel, grounded: true,
        groundAt: () => 0, crouch: 0 };
      // settle the gait before counting: the first strides re-seat the feet
      for (let i = 0; i < 30; i++) { pos.addScaledVector(vel, 1 / 60); anim.update(1 / 60, p); }

      proto.updateMatrixWorld = function (force) { calls++; walk(this, force); };
      proto.updateWorldMatrix = function (up, down) { calls++; return realUWM.call(this, up, down); };
      const F = 120;
      for (let i = 0; i < F; i++) { pos.addScaledVector(vel, 1 / 60); anim.update(1 / 60, p); }
      per = visits / F;
      callsPer = calls / F;
    } finally {
      proto.updateMatrixWorld = realUMW;
      proto.updateWorldMatrix = realUWM;
    }

    assert(nodes > 40, `the test rig is only ${nodes} objects — nothing was built`);
    assert(per > 1, 'no matrix work was counted at all, so this measured nothing');
    const ratio = per / nodes;
    assert(ratio < 3,
      `one walking body re-poses itself ${ratio.toFixed(2)}x its own graph every frame — `
      + `${per.toFixed(0)} matrix node-visits over ${nodes} objects, from ${callsPer.toFixed(0)} calls. `
      + 'A forced updateMatrixWorld walks DOWN, so calling it on a bone re-multiplies every object '
      + 'below that bone; on a hips bone that is the whole skeleton and everything it wears. What a '
      + 'solve needs is its ANCESTORS — updateWorldMatrix(true, false). This measured 4.36x before '
      + 'Rig.solveIK stopped forcing its descendants and 2.00x after; a number back over 3 means '
      + 'something has started forcing a subtree again.');
    return `${per.toFixed(0)} matrix node-visits a frame over a ${nodes}-object rig = `
      + `${ratio.toFixed(2)}x, from ${callsPer.toFixed(0)} calls (was 4.36x from 26)`;
  });

  /* ══════════════════════════════════════════════════════════════════════ */
  /*  4. No support call may ask a pool for more than the pool holds        */
  /* ══════════════════════════════════════════════════════════════════════ */

  check('frame: no stratagem asks a particle pool for more than it holds', async () => {
    /**
     * DERIVED FROM THE TABLE, so a seventh call is priced the day it is
     * written. Every row's own `fire` is run — not a transcription of what it
     * does — against a Particles whose pools COUNT instead of storing, and
     * against a context carrying the pieces those effects reach for. What is
     * asserted is a COUNT and never a clock: a ring buffer cannot show more
     * than it holds, so a single call over capacity is always a defect and
     * never a tuning decision (HANDOFF §2.3, and the `sparkBurst` freeze).
     *
     * The barrage defers five of its six shells through `S.after`, so the
     * timers are drained afterwards and their spawns land in the same tally —
     * a burst that is only over capacity on the second shell is still over
     * capacity.
     */
    const { Particles } = await import('../../src/world/Particles.js');
    const { STRATAGEMS, Stratagems } = await import('../../src/game/Stratagems.js');

    /**
     * PRICED AT BOTH ENDS OF THE SLIDER, and the band is derived rather than
     * typed. `World` builds its Particles at `settings.particleScale *
     * QUALITY[tier].particles`, the tier column is in Engine.js and the
     * slider's own travel is in the shipped markup — so the reachable floor is
     * the smallest product of the two and the ceiling the largest. It matters
     * which end you ask at: most recipes scale their own counts with the pool
     * (`sparkBurst` multiplies by `this.scale`), so their SHARE is flat across
     * the slider — but the stratagems' counts are literals, so their share
     * grows as the pools shrink. The barrage is 4% of the dust pool at 100%
     * and 25% of it at the floor, which is the number a budget is about.
     */
    const { readFile } = await import('node:fs/promises');
    const markup = await readFile(new URL('../../index.html', import.meta.url), 'utf8');
    const slider = /id="opt-particles"[^>]*min="([\d.]+)"[^>]*max="([\d.]+)"/.exec(markup);
    assert(slider, 'the Particles slider is gone from index.html, so its travel cannot be derived');
    const tiers = Object.values(QUALITY).map((q) => q.particles);
    const band = [Number(slider[1]) * Math.min(...tiers), 1, Number(slider[2]) * Math.max(...tiers)];

    const POOLS = ['sparks', 'embers', 'plasma', 'smoke', 'dust', 'grit', 'water'];
    let worst = 0, worstAt = '';
    for (const scale of band) {
      const scene = new THREE.Scene();
      scene.add(new THREE.DirectionalLight(0xffffff, 1));
      const P = new Particles(scene, scale);
      const tally = {};
      for (const k of POOLS) {
        const pool = P[k];
        const real = pool.spawn.bind(pool);
        pool.spawn = (...a) => { tally[k] = (tally[k] || 0) + 1; return real(...a); };
      }
      const at = new THREE.Vector3(0, 0, 12);
      const owner = {
        position: new THREE.Vector3(0, 0, 0), chest: new THREE.Vector3(0, 1.4, 0),
        aimDir: new THREE.Vector3(0, 0, 1), dead: false, force: 999,
        damage() {}, heal() {}, _spend: () => true, world: null,
      };
      const S = new Stratagems(owner);
      const ctx = {
        particles: P, enemies: [], players: [], physics: { bodies: [] },
        terrain: { height: () => 0, crater() {} }, groundColor: 0xd8c8a8, world: null,
      };
      for (const row of STRATAGEMS) {
        /* A ROW DELIVERS THROUGH `fire` OR THROUGH `cadence`, and the check
         * has to drive whichever it has. `strafe` and `smoke` are flown by a
         * craft, so their spawns come from a cadence called per beat rather
         * than from one shot; asserting `fire` existed made this check red on
         * a row that was working. Neither is optional — a row with no delivery
         * at all is still a defect and still fails here. */
        const deliver = row.fire || row.cadence;
        assert(typeof deliver === 'function',
          `stratagem '${row.id}' has neither fire() nor cadence(), so nothing delivers it`);
        for (const k of POOLS) tally[k] = 0;
        /* FOUR arguments, as `Stratagems.update` calls it:
         * `P.s.fire?.(ctx, P.site, this, P.s)`. The row is its own fourth
         * argument and rows read `s.radius` off it. Called with three, this
         * check died on `Cannot read properties of undefined (reading
         * 'radius')` the day the strike learned to carry a radius — a check
         * that could not see the shipped signature change. */
        deliver(ctx, at.clone(), S, row);
        // …and everything it deferred inside itself
        for (let guard = 0; guard < 64 && S._timers.length; guard++) S.update(1 / 30, ctx);
        for (const k of POOLS) {
          const n = tally[k] || 0;
          if (!n) continue;
          const share = n / P[k].max;
          if (share > worst) {
            worst = share;
            worstAt = `${row.id} → ${n} of the ${k} pool's ${P[k].max} at particleScale `
              + `${scale.toFixed(2)}`;
          }
          assert(share < 0.5,
            `'${row.id}' spawns ${n} into the ${k} pool at particleScale ${scale.toFixed(2)}, where `
            + `that pool holds ${P[k].max} — ${(share * 100).toFixed(0)}% of a shared ring in ONE `
            + 'call. A pool is a ring buffer: past capacity a single call overwrites what it wrote a '
            + 'microsecond earlier, so the surplus is provably invisible work, and well before that '
            + 'a call this size erases every other effect on the field. The stratagem counts are '
            + 'literals while the recipes multiply by the pool scale, so this bites at the BOTTOM '
            + 'of the slider — which is the tier the menu offers to integrated graphics.');
        }
        S.reset();
      }
      P.dispose();
    }
    assert(worst > 0, 'not one stratagem spawned a particle, so nothing was measured');
    return `${STRATAGEMS.length} calls priced across particleScale `
      + `${band[0].toFixed(2)}–${band[2].toFixed(2)}; worst is ${worstAt}, `
      + `${(worst * 100).toFixed(1)}% of that pool in one call`;
  });
  /* ══════════════════════════════════════════════════════════════════════ */
  /*  5. A tier the player picks mid-run has to REACH the frame             */
  /* ══════════════════════════════════════════════════════════════════════ */

  check('frame: every column of the quality tier moves when the player moves the tier', async () => {
    /**
     * THE COLUMN WITH NO LIVE READER IS THE SHAPE THIS FILE KEEPS FINDING, and
     * two of them were sitting in QUALITY when this was written. Both were
     * correct at BOOT and dead to the options screen, which is where a player
     * whose game is stuttering actually goes.
     *
     *   `msaa`    `_setupComposer` read it once, in the constructor, and
     *             `setQuality` moved the shadow maps, the pixel ratio, the ink
     *             prepass and the view distance and left the multisample count
     *             alone. Measured in a real browser on the Providence:
     *             booted `high` it reported 4 samples and still reported 4
     *             after `setQuality('low')`; booted `low` it reported 0 and
     *             still reported 0 at `ultra`. Four samples per pixel on the
     *             frame's largest target is the biggest per-pixel cost the
     *             ladder has to hand back, and the tier that promises to hand
     *             it back could not.
     *
     *   `cloth`   `World` cached it in `clothCut` during the level-load step
     *             and `applyQuality` never touched it. Driven, sixteen
     *             acolytes at 4-49 m: a world built at `ultra` and dropped to
     *             `low` the way `main.js`'s `onQualityChange` does it kept
     *             `clothCut` at 46 and 14 of 16 bodies still solving garments
     *             — byte-identical to staying at `ultra`. Engine's own note
     *             calls this "the only column in this table that changes how
     *             much simulation runs EVERY frame".
     *
     * The check above this one already asserted that ENEMY reads `clothCut`
     * live, and its own comment names the failure it did not test for — "at
     * build time, where a mid-run quality change could not reach it". It
     * pinned the reader and never the writer.
     *
     * DRIVEN THROUGH THE SHIPPED BODIES. `Engine.prototype.setQuality` is
     * called on an object whose prototype IS Engine's, so `resize()` and
     * `_composerTarget()` are the shipped ones too and a future edit that
     * reorders them is caught by the thing it would break. Nothing here needs
     * a GL context: a WebGLRenderTarget is inert until something renders to it.
     */
    const { Engine } = await import('../../src/engine/Engine.js');
    const { World } = await import('../../src/game/World.js');

    const tiers = Object.keys(QUALITY);
    assert(tiers.length >= 3, `only ${tiers.length} tiers — nothing to step`);

    /* A ladder that visits every tier and comes BACK, so each column has to
     * move in both directions. A one-way sweep passes on a property that only
     * ever ratchets up. */
    const ladder = [...tiers, ...tiers.slice(0, -1).reverse(), tiers[0]];

    const eng = Object.create(Engine.prototype);
    let pixelRatio = 1;
    Object.assign(eng, {
      quality: tiers[tiers.length - 1],
      resolutionScale: 1,
      renderer: {
        setPixelRatio(v) { pixelRatio = v; },
        getPixelRatio: () => pixelRatio,
        setSize() {},
        getDrawingBufferSize: (v) => v.set(1280, 720),
      },
      camera: new THREE.PerspectiveCamera(60, 16 / 9, 0.045, 900),
      cascades: [0, 1, 2].map(() => new THREE.DirectionalLight(0xffffff, 1)),
      outline: { scale: 1, setSize() {} },
      composite: { uniforms: { uResolution: { value: new THREE.Vector2() } } },
      bloom: { resolution: new THREE.Vector2() },
    });
    /* The composer stands in for EffectComposer, and only for the two things
     * `setQuality` asks of it: what its buffer's sample count IS, and swapping
     * that buffer for another. `reset` disposes the pair it is replacing —
     * vendor/three/postprocessing/EffectComposer.js:183 — so the stub does too,
     * and a fix that rebuilt the target without freeing the old one would be a
     * leak this cannot see. `lighting.mjs` drives the real composer in a real
     * browser; this drives the tier ladder, which that one cannot afford to. */
    let disposed = 0;
    eng.composer = {
      // as the constructor leaves it: a buffer built for the tier booted at.
      // Built here rather than through Engine's own helper on purpose — a check
      // that calls the fix's private method cannot fail on code that has not
      // been fixed, it throws instead, and a TypeError is not a finding.
      renderTarget1: new THREE.WebGLRenderTarget(1280, 720, {
        type: THREE.HalfFloatType, samples: QUALITY[eng.quality].msaa,
        colorSpace: THREE.LinearSRGBColorSpace, depthBuffer: true }),
      setPixelRatio() {}, setSize() {},
      reset(rt) { this.renderTarget1.dispose(); disposed++; this.renderTarget1 = rt; },
    };

    /* World's half needs no level: `applyQuality` is the whole of the live
     * path, and a World that has not loaded one has no particles to scale. */
    const w = Object.create(World.prototype);
    Object.assign(w, { settings: { particleScale: 1 }, particles: { scale: -1 } });

    const seen = [], bad = [];
    for (const t of ladder) {
      eng.setQuality(t);
      w.applyQuality(t);
      const q = QUALITY[t];
      const got = {
        shadow: eng.cascades[0].shadow.mapSize.x,
        viewDist: eng.camera.far,
        ink: eng.outline.scale,
        pixelRatio: +(pixelRatio / eng.resolutionScale).toFixed(4),
        msaa: eng.composer.renderTarget1.samples ?? 0,
        particles: +(w.particles.scale).toFixed(4),
        cloth: w.clothCut,
      };
      const want = {
        shadow: q.shadow, viewDist: q.viewDist, ink: q.ink,
        pixelRatio: Math.min(window.devicePixelRatio, q.pixelRatio),
        msaa: q.msaa, particles: q.particles, cloth: q.cloth,
      };
      /* COLLECTED, NOT RAISED ONE AT A TIME. Seven columns over eight tier
       * moves is 56 clauses over the same drive, and `assert`-per-clause means
       * the first one to break is the only one anybody ever sees — which is
       * exactly how `cel: a shadow is READABLE` hid a second failure behind a
       * first for a whole session. Everything that moved wrong is named. */
      for (const k of Object.keys(want)) {
        if (got[k] !== want[k]) bad.push(`${t}.${k} reads ${got[k]}, tier says ${want[k]}`);
      }
      // …and every cascade, not only the first: they are set in a loop.
      for (let i = 0; i < eng.cascades.length; i++) {
        const L = eng.cascades[i];
        if (L.shadow.mapSize.x !== q.shadow || L.shadow.mapSize.y !== q.shadow) {
          bad.push(`${t}.cascade[${i}] kept a ${L.shadow.mapSize.x}×${L.shadow.mapSize.y} map, `
            + `tier says ${q.shadow}²`);
        }
      }
      seen.push(t);
    }
    assert(bad.length === 0,
      `${bad.length} of the tier's columns do not follow a mid-run tier change: ${bad.join('; ')}. `
      + 'A column of QUALITY that only the constructor reads is a promise the options screen '
      + 'cannot keep, and the two that were dead when this was written were the frame\'s largest '
      + 'per-pixel cost (msaa, 4 samples kept on the Performance tier) and its largest per-frame '
      + 'simulation cost (cloth, 14 of 16 bodies still solving garments after the drop to low).');

    /* THE COLUMN LIST IS DERIVED. Anything added to QUALITY that this loop does
     * not read is unasserted, and silence is how both of the above survived —
     * so a new column has to be claimed here or named as deliberately inert. */
    const READ = new Set(['shadow', 'viewDist', 'ink', 'pixelRatio', 'msaa', 'particles', 'cloth']);
    const INERT = new Set([
      'bloom',        // main.js's qualityBloom(), pinned by feel/order rather than here
      'grass',        // an instance-buffer allocation: World rebuilds it at load, not live
      'shadowDist',   // read every frame by fitShadows/cascadeBoxes, so it cannot go stale
    ]);
    const unclaimed = Object.keys(QUALITY[tiers[0]]).filter((k) => !READ.has(k) && !INERT.has(k));
    assert(unclaimed.length === 0,
      `QUALITY grew ${unclaimed.join(', ')} and nothing here asks whether a tier change reaches `
      + 'it. Add it to the loop, or to INERT with the reason.');

    /* AND NO SECOND COPY OF THE CLOTH CUT. The defect was a cached scalar
     * written in one place and re-read in another (HANDOFF §2.3); the guard is
     * that there is exactly ONE assignment of it in the tree and it is the one
     * `applyQuality` makes. */
    const { readFile } = await import('node:fs/promises');
    const world = await readFile(new URL('../../src/game/World.js', import.meta.url), 'utf8');
    const writes = world.match(/this\.clothCut\s*=/g) || [];
    assert(writes.length === 1,
      `${writes.length} places in World.js assign clothCut — it is a tier column with one `
      + 'authority, and a second assignment is the copy that went stale');
    assert(/applyQuality\(name\)\s*\{[^}]*this\.clothCut\s*=/s.test(world),
      'the one assignment of clothCut is not inside applyQuality, so a mid-run tier change '
      + 'cannot reach it');

    return `${ladder.length} tier moves over ${tiers.join('/')}, seven columns each; `
      + `msaa ${tiers.map((t) => QUALITY[t].msaa).join('/')} rebuilt the composer buffer `
      + `${disposed} times and freed the old one each time`;
  });

  /* ══════════════════════════════════════════════════════════════════════ */
  /*  6. L2 — the merged rigid skin. FLAGSHIP.md §14 Step 4                 */
  /* ══════════════════════════════════════════════════════════════════════ */

  /**
   * THE RUNG, AND WHY IT IS MEASURED HERE RATHER THAN ARGUED ANYWHERE.
   *
   * FLAGSHIP §4 states the constraint the whole flagship design rests on: "a
   * trooper who walks, shoots, takes cover and can be cut in half costs 26 draw
   * calls at every distance, forever." §14 Step 4 puts a pair of numbers on the
   * fix — 42 bodies at 1,040 calls today, 394 with L2 — and BACKLOG 6.5 carries
   * the same pair. Neither had ever been measured.
   *
   * Measured here, and both halves move: a real `high` World on geonosis with
   * 42 mixed bodies (troopers, B1s, heavies, B2s, officers, rocket droids and
   * Jedi) standing 100-154 m from the camera costs **1064 visible meshes** with
   * the rung off and **194** with it on. The estimate's "today" was honest to
   * 2%; its "with it" was pessimistic by 2x, because the merge bins by MATERIAL
   * and a trooper's 26 meshes wear 4 distinct ones — not the single one a lone
   * SkinnedMesh would have needed.
   *
   * WHAT A DRAW CALL IS COUNTED AS. One visible mesh in the graph. There is no
   * GL anywhere in this harness (tools/dom-shim.mjs), so `renderer.info` is not
   * reachable and every performance claim in this repository is a BUDGET rather
   * than a millisecond — see the header of tools/checks/profiler.mjs, and
   * tools/_drawcalls.mjs, which attributes the same count on a dressed level.
   * The count is honest for this question because nothing on a body is
   * instanced and no two of its meshes share a material instance: 26 meshes is
   * 26 submissions.
   */
  const L2 = { types: ['trooper', 'b1', 'heavy', 'b2', 'officer', 'rocket', 'jedi'],
               n: 42, field: 'geonosis', near: 100 };

  /** One World with 42 bodies stood out past the L2 cut, built once. */
  const line = (async () => {
    const { initPhysics } = await import('../../src/physics/Rapier.js');
    await initPhysics();
    const { World } = await import('../../src/game/World.js');
    const { DEFAULT_SETTINGS } = await import('../../src/ui/Menu.js');
    const { enemyRng } = await import('../../src/game/Enemy.js');
    enemyRng.seed(20260821);
    const engine = stubEngine();
    const world = new World(engine, { ...DEFAULT_SETTINGS, quality: 'high' });
    await world.loadLevel(L2.field);
    /* NO PLAYER, and that is not a shortcut. A body with nobody to charge
     * stands still, so the distance this is measured at is the distance it was
     * set up at — and the count stops depending on how many frames a loaded box
     * managed to run before the reading was taken. */
    const centre = new THREE.Vector3(0, world.terrain.height(0, 0), 0);
    for (let i = 0; i < L2.n; i++) {
      const t = L2.types[i % L2.types.length];
      const a = (i / L2.n) * 0.9 - 0.45;
      const d = L2.near + (i % 7) * 9;
      const x = centre.x + Math.sin(a) * d, z = centre.z + Math.cos(a) * d;
      world.spawnEnemy(t, new THREE.Vector3(x, world.terrain.height(x, z), z));
    }
    engine.camera.position.set(centre.x, centre.y + 1.6, centre.z);
    engine.camera.lookAt(centre.x, centre.y + 1.6, centre.z + 1);
    engine.camera.updateMatrixWorld(true);
    /* Stepped until every body has baked, because MergedSkin caps the bake at
     * one body a frame. The loop is bounded and the bound is ASSERTED below, so
     * a rung that silently stopped engaging fails rather than reporting a
     * flattering number off a shorter run. */
    const input = idleInput();
    let frames = 0;
    while (frames < L2.n * 4) {
      world.update(1 / 60, input);
      frames++;
      if (world.enemies.every((e) => e._l2 && e._l2.on)) break;
    }
    return { world, engine, frames, centre };
  })();

  /** Visible meshes under every body on the field. */
  const bodyCalls = (world) => {
    let n = 0;
    for (const e of world.enemies) (e.rig?.root || e.group)?.traverseVisible((o) => { if (o.isMesh) n++; });
    return n;
  };

  check('frame: forty-two bodies past the L2 cut cost a draw call a MATERIAL, not one a mesh', async () => {
    const { world, engine, frames } = await line;
    const dists = world.enemies.map((e) => engine.camera.position.distanceTo(e.position));
    const near = Math.min(...dists), far = Math.max(...dists);

    assert(world.enemies.length === L2.n, `${world.enemies.length} bodies stood up, not ${L2.n}`);
    assert(world.enemies.every((e) => e.lod === 2),
      `not every body is at LOD 2 — distances run ${near.toFixed(0)}-${far.toFixed(0)} m and this `
      + 'rung is the far band. Nothing below would be measuring what it says it is.');
    assert(frames < L2.n * 4,
      `${frames} frames and the rung never fully engaged. MergedSkin caps the bake at one body a `
      + 'frame and Enemy.update retries a deferred one; a body that is never retried draws its '
      + 'LOD-1 set forever, which is what this measured before that retry existed — 1 of 42.');

    /* BOTH READINGS OFF THE SAME WORLD, one line apart, through the shipped
     * `_applyLod`. A separately built control World is a different seed, a
     * different dressing and a different set of bodies. */
    const on = bodyCalls(world);
    for (const e of world.enemies) e._applyLod(1);
    const off = bodyCalls(world);
    for (const e of world.enemies) e._applyLod(2);
    const back = bodyCalls(world);

    assert(back === on, `re-engaging the rung gave ${back} calls where it gave ${on} — not idempotent`);
    assert(off > 900,
      `the bodies only cost ${off} calls with the rung off, so there is nothing here to save and `
      + 'the rest of this check is measuring an empty field');
    assert(on * 3 < off,
      `42 bodies cost ${off} draw calls without the merged skin and ${on} with it — under 3x. `
      + 'FLAGSHIP §4 calls the per-body floor the whole architecture; a rung that does not clear it '
      + 'by a wide margin is not worth the memory it costs.');
    assert(on <= 394,
      `${on} draw calls against FLAGSHIP §14 Step 4's stated 394, which is the figure this rung was `
      + 'specified against.');
    return `${L2.n} bodies at ${near.toFixed(0)}-${far.toFixed(0)} m on ${L2.field}: `
      + `${off} draw calls -> ${on} (${(off / on).toFixed(1)}x) over ${frames} frames; `
      + 'FLAGSHIP §14 Step 4 estimated 1040 -> 394';
  });

  check('frame: the merged skin is the same body, in a pose it was not baked in', async () => {
    /**
     * THE SILHOUETTE GUARANTEE, TAKEN AS A MEASUREMENT AND NOT AS AN ARGUMENT.
     *
     * FLAGSHIP §14 Step 4's claim is that the silhouette is "identical by
     * construction so the 30 m seam is invisible". A construction argument is
     * exactly what this repository does not accept, so every vertex of every
     * rigged archetype goes through BOTH paths and the answers are compared in
     * world space:
     *
     *   the graph   the source mesh's own `matrixWorld` times the vertex.
     *   the skin    `SkinnedMesh.applyBoneTransform` — three's own CPU path,
     *               reading the same skinIndex/skinWeight the GPU reads —
     *               times the merged mesh's `matrixWorld`.
     *
     * The rig is MOVED AND RE-POSED between the bake and the comparison, bones
     * and root both, because a bind-space error is invisible in the pose it was
     * baked at and that is the whole failure mode of a rigid skin.
     */
    const { initPhysics } = await import('../../src/physics/Rapier.js');
    await initPhysics();
    const { RapierWorld } = await import('../../src/physics/RapierWorld.js');
    const Foe = await import('../../src/game/Enemy.js');
    const { buildMergedSkin } = await import('../../src/game/MergedSkin.js');
    await import('../../src/game/Levels.js');       // the Command units and the IG general

    const physics = new RapierWorld({ gravity: -24, iterations: 4, maxBodies: 64 });
    const terrain = { height: () => 0, normalAt: (x, z, o) => o.set(0, 1, 0), raycast: () => null,
      size: 400, half: 200, inBounds: () => true, surfaceAt: () => 'sand',
      crater() {}, flush() {}, slopeAt: () => 0 };
    physics.terrain = terrain;
    const nothing = { sandPuff() {}, sparkBurst() {}, cutFlare() {}, slag() {}, plasma: { spawn() {} } };
    const world = { scene: new THREE.Scene(), physics, terrain, statics: [], settings: { fov: 60 },
      players: [], enemies: [], props: [], particles: nothing, time: 0, groundColor: 0xcfae82,
      bolts: { fire() {} }, engine: { flash() {}, camera: new THREE.PerspectiveCamera() },
      report() {}, notify() {}, notifyFloating() {}, addHitstop() {} };
    Foe.enemyRng.seed(20260821);

    let worst = 0, worstAt = '', bodies = 0, merged = 0, kept = 0, vertices = 0, freed = '';
    const refusals = new Map();
    for (const type of Object.keys(Foe.ARCHETYPES)) {
      const e = new Foe.Enemy(world, type, new THREE.Vector3(0, 0, 0));
      if (!e.rig) continue;                    // a baked group; `_applyLod` no-ops on those too
      bodies++;
      e._applyLod(1);
      // off the bind pose BEFORE the bake, so "works in bind" cannot pass
      e.rig.list.forEach((b, i) => { b.obj.rotation.z += 0.11 * Math.sin(i * 1.7); });
      e.rig.root.position.set(3.3, 1.1, -2.2);
      e.rig.root.rotation.y = 0.9;
      e.rig.root.updateMatrixWorld(true);

      const skin = buildMergedSkin(e.rig);
      assert(skin, `${type} kept ${e._lodParts?.length ?? 0} meshes past 30 m and merged into nothing`);
      for (const [why, n] of skin.refused) refusals.set(why, (refusals.get(why) || 0) + n);
      kept += skin.from; merged += skin.to;

      // …and moved AGAIN afterwards, in the bones and in the root
      e.rig.list.forEach((b, i) => { b.obj.rotation.x += 0.23 * Math.cos(i * 2.3); });
      e.rig.root.position.set(-7, 0.4, 12);
      e.rig.root.rotation.y = -2.1;
      e.rig.root.updateMatrixWorld(true);
      for (const m of skin.meshes) m.updateMatrixWorld(true);

      const v = new THREE.Vector3(), ref = new THREE.Vector3();
      for (let b = 0; b < skin.meshes.length; b++) {
        const mesh = skin.meshes[b];
        const P = mesh.geometry.attributes.position;
        const W = mesh.geometry.attributes.skinWeight;
        let cursor = 0;
        for (const src of skin.sources[b]) {
          const S = src.geometry.attributes.position;
          for (let i = 0; i < S.count; i++, cursor++) {
            v.fromBufferAttribute(P, cursor);
            mesh.applyBoneTransform(cursor, v);
            v.applyMatrix4(mesh.matrixWorld);
            ref.fromBufferAttribute(S, i).applyMatrix4(src.matrixWorld);
            const d = v.distanceTo(ref);
            if (d > worst) { worst = d; worstAt = `${type} ${src.name || 'mesh'} vertex ${i}`; }
            vertices++;
            /* RIGID means one bone at 1.0 and nothing anywhere else. A partial
             * weight is a blend the bake invented, and a blend is the one thing
             * that could move the silhouette off the graph's answer. */
            if (Math.abs(W.getX(cursor) - 1) > 1e-6 || W.getY(cursor) !== 0
                || W.getZ(cursor) !== 0 || W.getW(cursor) !== 0) {
              assert(false, `${type} has a vertex weighted `
                + `${[W.getX(cursor), W.getY(cursor), W.getZ(cursor), W.getW(cursor)].join('/')} — `
                + 'the rung is a RIGID skin and every vertex rides exactly one bone at 1.0');
            }
          }
        }
        assert(cursor === P.count,
          `${type} bin ${b} covered ${cursor} of its ${P.count} vertices — the bake and the source `
          + 'list disagree about what went in, so the comparison above is off by an offset');
      }

      /* AND THE BAKE IS GIVEN BACK, measured on the first body rather than
       * argued from where the meshes are parented. 10 MB of baked geometry
       * across the roster is a real allocation, and `Rig.dispose` walking
       * `rig.root` is the only thing that frees it — a merged skin parented
       * anywhere else would be invisible to that walk and to lifecycle.mjs,
       * whose corpse-leak assertions are all about meshes on the rig. */
      if (!freed) {
        const seen = new Set(), seenM = new Set();
        const realG = THREE.BufferGeometry.prototype.dispose;
        const realM = THREE.Material.prototype.dispose;
        THREE.BufferGeometry.prototype.dispose = function () { seen.add(this); return realG.call(this); };
        THREE.Material.prototype.dispose = function () { seenM.add(this); return realM.call(this); };
        try { e.dispose?.(); } finally {
          THREE.BufferGeometry.prototype.dispose = realG;
          THREE.Material.prototype.dispose = realM;
        }
        const g = skin.meshes.filter((m) => seen.has(m.geometry)).length;
        const mt = skin.meshes.filter((m) => seenM.has(m.material)).length;
        assert(g === skin.meshes.length && mt === skin.meshes.length,
          `disposing a ${type} freed ${g} of ${skin.meshes.length} merged geometries and ${mt} of `
          + `${skin.meshes.length} merged materials — the baked skin outlives the body that wore it`);
        freed = `${type} ${g}/${skin.meshes.length}`;
        continue;
      }
      e.dispose?.();
    }

    assert(bodies >= 25, `only ${bodies} archetypes carry a rig — the roster walk found nothing`);
    assert(vertices > 50000, `only ${vertices} vertices compared`);
    /* 1 mm is three orders of magnitude under a body's own size and two under
     * the 13 mm per pixel characters.mjs rasterises at. Float32 positions
     * through two matrix chains land at ~1e-7 m. */
    assert(worst < 1e-3,
      `the merged skin puts a vertex ${(worst * 1000).toFixed(2)} mm from where the mesh it `
      + `replaced puts it (${worstAt}). The rung's whole claim is that the silhouette is identical `
      + 'by construction; a drift here is an outline that moves at the 62 m seam.');
    physics.dispose?.();
    return `${bodies} rigged archetypes, ${kept} meshes -> ${merged} (${(kept / merged).toFixed(1)}x), `
      + `${vertices} vertices compared after re-posing and re-placing, worst drift `
      + `${worst.toExponential(1)} m, dispose freed ${freed}; left out: `
      + `${[...refusals].map(([k, n]) => `${n} ${k}`).join(', ') || 'nothing'}`;
  });

  check('frame: the merged skin inks exactly once, and nothing it swallowed cut its own edge', async () => {
    /**
     * TWO WAYS TO BREAK THE INK, and the merge could do either.
     *
     * DOUBLE INK: the merged skin drawn while the meshes it was baked from are
     * still drawn. Two coincident surfaces is z-fighting in the colour buffer
     * and two edges in the prepass's normal buffer, at twice the cost the rung
     * claims to have saved.
     *
     * NO INK: a merged material that `cutsItsOwnSilhouette`. Ink.js's prepass
     * hides exactly those objects, because their drawn edge is not their
     * geometry — so a merged body wearing one would be the only thing on the
     * field with no outline at all. The predicate is IMPORTED from Ink.js
     * rather than restated; a second copy would disagree with it the first time
     * a fifth exclusion was added there (HANDOFF §2.4).
     *
     * And the third, in the other direction: a mesh that DOES cut its own edge
     * has to be refused, or a lit blade folded into an opaque body would gain
     * an outline and stop glowing.
     */
    const { world } = await line;
    let skins = 0, replaced = 0, drawn = 0;
    for (const e of world.enemies) {
      const L = e._l2;
      assert(L && L.skin && L.on, `a body at LOD ${e.lod} is not merged`);
      for (const m of L.skin.meshes) {
        skins++;
        assert(m.visible, 'a merged skin is not visible while the rung is on');
        assert(m.isSkinnedMesh, 'the merged skin is not a SkinnedMesh, so the bones do not reach it');
        assert(!cutsItsOwnSilhouette(m.material),
          'a merged skin\'s material is transparent / alpha-tested / additive, so Ink.js\'s prepass '
          + 'leaves it out of the normal buffer and the body draws with no outline at all');
        assert(m.material.vertexColors && m.material.color.getHex() === 0xffffff,
          'the merged material did not take white — the bake moves colour into the vertices, so a '
          + 'coloured material would multiply it in twice');
        assert(m.castShadow === false,
          'a merged skin casts a shadow at LOD 2, where Enemy._applyLod has already taken the '
          + 'shadow pass off the rest of the body');
      }
      for (const m of L.skin.replaced) { replaced++; if (m.visible) drawn++; }
    }
    assert(skins > 0, 'nothing merged, so nothing was checked');
    assert(drawn === 0,
      `${drawn} of ${replaced} meshes the merged skins were baked from are STILL VISIBLE beside `
      + 'them — the same triangles submitted twice and inked twice');

    /* AND THE PREPASS HAS TO BE ABLE TO DRAW A SKINNED MESH AT ALL. It renders
     * the scene with `overrideMaterial = MeshNormalMaterial`, and three picks
     * the skinning define off the OBJECT (`skinning: object.isSkinnedMesh`) but
     * the shader off the MATERIAL. A normal material without the skinning
     * chunks would compile without them and put every merged body's outline at
     * its BIND pose while its colour walked away from it — silently, and only
     * for the bodies this rung touches. */
    const nv = THREE.ShaderLib.normal.vertexShader;
    for (const chunk of ['skinning_pars_vertex', 'skinbase_vertex', 'skinning_vertex']) {
      assert(nv.includes(chunk),
        `three's normal material no longer includes <${chunk}>, so the ink prepass draws every `
        + 'merged body at its bind pose while the colour pass draws it walking');
    }

    let cut = 0;
    for (const e of world.enemies) {
      const inSkin = new Set(e._l2.skin.replaced);
      e.rig?.root?.traverse((o) => {
        if (!o.isMesh || !o.material || Array.isArray(o.material)) return;
        if (!cutsItsOwnSilhouette(o.material)) return;
        cut++;
        assert(!inSkin.has(o),
          `${e.type} folded a mesh whose drawn edge is not its geometry into an opaque merged skin`);
      });
    }
    return `${skins} merged skins over ${world.enemies.length} bodies, ${replaced} source meshes all `
      + `hidden, ${cut} self-cutting materials left with their own draw call`;
  });

  check('frame: the two material fields the merge drops reach no term in the shipped shader', async () => {
    /**
     * THE ONE PLACE THE MERGE IS NOT LOSSLESS BY CONSTRUCTION.
     *
     * A bin absorbs `color` exactly (into the vertex attribute) and splits on
     * every other material property — except `roughness` and `metalness`, which
     * it takes from one contributor and drops for the rest. That is sound only
     * while the cel model is what ships, so it is read back off
     * `THREE.ShaderChunk` AFTER `installCelShading` has run rather than argued
     * from src/toon/Cel.js's source text. Cel.js's own note says why the
     * distinction matters: tools/checks/cel.mjs asserts against that file's
     * source and passes 19/19 in a process where the install never ran and the
     * frame is fully physical.
     *
     * src/engine/Textures.js already stopped BINDING the roughness and metalness
     * maps on the same reading. If either term comes back, that binding and
     * this merge both need revisiting, and this is the line that says so.
     */
    assert(celInstall, 'installCelShading has not run in this process, so THREE.ShaderChunk is '
      + 'stock three and the read below would be about a renderer this game does not use');
    assert(!celInstall.missed.length,
      `the cel install dropped ${celInstall.missed.join(', ')} — the frame is part physical, and `
      + 'what survives in the shader is then not what this reads');

    const C = THREE.ShaderChunk;
    const direct = C.lights_physical_pars_fragment;
    assert(!/directSpecular\s*\+=\s*irradiance\s*\*\s*BRDF_GGX/.test(direct),
      'the direct GGX lobe is back in lights_physical_pars_fragment. It reads material.roughness, '
      + 'so the L2 merge is now averaging a field that changes pixels — and Textures.js has been '
      + 'leaving the roughness map unbound on the same reading');
    const phys = C.lights_physical_fragment;
    assert(!/material\.diffuseColor\s*=\s*diffuseColor\.rgb\s*\*\s*\(\s*1\.0\s*-\s*metalnessFactor/.test(phys),
      'metalnessFactor divides the diffuse again, so metalness changes a surface\'s colour and the '
      + 'L2 merge may no longer bin two materials that differ in it');
    return 'no direct GGX lobe and no metalness term on the diffuse — '
      + `${celInstall.count} substitutions installed, none missed`;
  });

  check('frame: the rung is off inside the band, and a body that comes apart gives it back', async () => {
    /**
     * The bake is a photograph of a rig with all of its bones. `Ragdoll.cut`
     * rebuilds `bone.primary`'s geometry and hides a whole subtree, and a merged
     * vertex cannot know either happened — so a cut body would walk off carrying
     * an arm the player has just taken off it. Driven through the shipped
     * `Actor.cut` rather than by poking the counter that watches it.
     */
    const { world } = await line;
    const input = idleInput();
    const e = world.enemies.find((x) => x.actor && x.rig && x._l2?.on);
    assert(e, 'no merged body on the field to cut');

    e._applyLod(0);
    assert(!e._l2.on, 'the merged skin is still drawing at LOD 0, three metres from the camera');
    e._applyLod(1);
    assert(!e._l2.on, 'the merged skin is drawing at LOD 1, inside the 62 m the rung engages at');
    assert(e._l2.skin.replaced.every((m) => m.visible),
      'the meshes the merged skin replaced did not come back when the rung switched off — the body '
      + 'is invisible inside 62 m');
    e._applyLod(2);
    assert(e._l2.on, 'the merged skin did not come back at LOD 2');

    const arm = e.rig.list.find((b) => b.role === 'arm' && b.primary && b.children.length);
    assert(arm, `${e.type} has no limb to cut`);
    const at = new THREE.Vector3().setFromMatrixPosition(arm.obj.matrixWorld);
    const wasCut = e.actor.severedCount;
    e.actor.cut(arm.name, at, new THREE.Vector3(0, 0, 1), 0.5);
    assert(e.actor.severedCount > wasCut, `Actor.cut refused ${arm.name} on a ${e.type}`);

    /* ONE ORDINARY FRAME, and not a forced `_applyLod` — with the count of
     * `_applyLod` calls taken during it, because that count is the whole
     * argument. `_applyLod` runs on a LOD BAND CHANGE and a cut is not one, so
     * a teardown that only happened inside `_applyLod` would never fire in the
     * game and this check, forcing the call, would be green about a path a
     * player cannot reach. Asserting the count is ZERO is what makes the frame
     * below evidence rather than a re-statement of the fix. */
    const realApply = e._applyLod.bind(e);
    let applied = 0;
    e._applyLod = (l) => { applied++; return realApply(l); };
    world.update(1 / 60, input);
    delete e._applyLod;
    assert(e.lod === 2, `the cut body left the band (${e.lod}), so the frame proves nothing`);
    assert(applied === 0,
      `_applyLod ran ${applied} times on the frame the body was cut, so this check cannot tell a `
      + 'teardown that fires on a cut from one that only fires when the body changes LOD band');
    assert(!e._l2 || !e._l2.on,
      `${e.type} kept its merged skin after losing a ${arm.name}. Every vertex of that limb is still `
      + 'in the merged geometry, riding a bone the rig has marked severed — the body walks off '
      + 'carrying an arm the player just cut off it.');
    let stillDrawing = 0;
    e.rig.root.traverse((o) => { if (o.isMesh && o.visible && o.userData.mergedSkinL2) stillDrawing++; });
    assert(stillDrawing === 0, `${stillDrawing} merged skins still drawing on a cut body`);
    return `LOD 0 off, LOD 1 off, LOD 2 on, and a cut ${arm.name} gave the skin back on an `
      + 'ordinary frame that never entered _applyLod';
  });
}
