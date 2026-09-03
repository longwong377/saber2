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
import { OutlinePass, cutsItsOwnSilhouette, INK } from '../../src/toon/Ink.js';
import { QUALITY } from '../../src/engine/Engine.js';
import { celInstall } from '../../src/toon/Cel.js';
import { hasCustomShader } from '../../src/toon/Toon.js';
import { BAKES_PER_FRAME } from '../../src/game/MergedSkin.js';
import { L3_AT, JOINS_PER_FRAME, CohortField, CAPTURES_PER_FRAME, poseSlots, poseMatrix,
  poseSlotOf, posedVertexShader, POSE_GLSL } from '../../src/game/Cohorts.js';
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
     * over did we walk this thing" is the question in both cases.
     *
     * The floor is 1.00x — one walk, which is what a pose has to do — and that
     * is now where it sits, so the bound is 1.6 rather than the 3 it was.
     * Anything above means a second full walk has come back:
     *
     *     4.36x   shipped, before `solveIK` stopped forcing its DESCENDANTS
     *     2.00x   after that: the gait made the whole tree current twice, once
     *             before the legs and once after
     *     1.00x   after the first of those became `freshPos` on the one bone
     *             it existed to serve — see the note in `BipedAnimator.update`
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
    assert(ratio < 1.6,
      `one walking body re-poses itself ${ratio.toFixed(2)}x its own graph every frame — `
      + `${per.toFixed(0)} matrix node-visits over ${nodes} objects, from ${callsPer.toFixed(0)} calls. `
      + 'A forced updateMatrixWorld walks DOWN, so calling it on a bone re-multiplies every object '
      + 'below that bone; on a hips bone that is the whole skeleton and everything it wears. What a '
      + 'solve needs is its ANCESTORS — updateWorldMatrix(true, false). This measured 4.36x before '
      + 'Rig.solveIK stopped forcing its descendants, 2.00x after, and 1.00x once the gait stopped '
      + 'making the whole tree current twice; a number back over 1.6 means a second full walk has '
      + 'come back.');
    return `${per.toFixed(0)} matrix node-visits a frame over a ${nodes}-object rig = `
      + `${ratio.toFixed(2)}x, from ${callsPer.toFixed(0)} calls (was 4.36x from 26, then 2.00x)`;
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
    const markup = await readFile(new URL('../../index.play.html', import.meta.url), 'utf8');
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
               n: 42, field: 'geonosis', near: 75, step: 7 };

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
      const d = L2.near + (i % 7) * L2.step;
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
    const budget = Math.ceil(L2.n / BAKES_PER_FRAME);
    let frames = 0;
    while (frames < budget * 4) {
      world.update(1 / 60, input);
      frames++;
      if (world.enemies.every((e) => e._l2 && e._l2.on)) break;
    }
    return { world, engine, frames, budget, centre };
  })();

  /** Visible meshes under every body on the field. */
  const bodyCalls = (world) => {
    let n = 0;
    for (const e of world.enemies) (e.rig?.root || e.group)?.traverseVisible((o) => { if (o.isMesh) n++; });
    return n;
  };

  check('frame: forty-two bodies past the L2 cut cost a draw call a MATERIAL, not one a mesh', async () => {
    const { world, engine, frames, budget } = await line;
    const dists = world.enemies.map((e) => engine.camera.position.distanceTo(e.position));
    const near = Math.min(...dists), far = Math.max(...dists);

    assert(world.enemies.length === L2.n, `${world.enemies.length} bodies stood up, not ${L2.n}`);
    assert(world.enemies.every((e) => e.lod === 2),
      `not every body is at LOD 2 — distances run ${near.toFixed(0)}-${far.toFixed(0)} m and this `
      + 'rung is the far band. Nothing below would be measuring what it says it is.');
    assert(frames < budget * 4,
      `${frames} frames and the rung never fully engaged. MergedSkin caps the bake at `
      + `${BAKES_PER_FRAME} a frame and Enemy.update retries a deferred one; a body that is never `
      + 'retried draws its LOD-1 set forever, which is what this measured before that retry '
      + 'existed — 1 of 42.');
    /* …and the cap is REAL. `BAKES_PER_FRAME` is read here rather than
     * transcribed, so a cap raised to make this loop shorter shows up as the
     * 116 ms lurch it buys back rather than as a faster check. */
    assert(frames >= budget,
      `${L2.n} bodies all merged inside ${frames} frames against a cap of ${BAKES_PER_FRAME} a `
      + `frame, which needs ${budget}. The cap is not binding, so a wave that crosses 62 m `
      + 'together pays every bake on one frame.');

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


  /* ══════════════════════════════════════════════════════════════════════ */
  /*  7. L3 — the instanced cohort. FLAGSHIP.md §14 Step 5                  */
  /* ══════════════════════════════════════════════════════════════════════ */

  /**
   * THE OTHER END OF THE LADDER, MEASURED THE SAME WAY.
   *
   * §14 Step 5 asks for "instanced cohorts beyond 140 m, where a leg is 3.9 px".
   * Both halves of that sentence come back true and one of them is exact: at
   * 137.8 m, 720 px over a 60° vertical field, a 0.86 m leg is 3.9 px and a
   * 1.8 m body is 8.1 px tall.
   *
   * 137.8 is where the band starts, and it is not 140 because it is not chosen:
   * `OutlinePass.prepass` narrows its own camera to `min(uHaze.y, uEdge.y)·1.06`
   * and `INK.edgeFade[1]` is 130, so **no outline is drawn on anything past
   * 137.8 m in clear air, today**. That is the licence the rung needs — an
   * instanced body cannot carry a per-body outline — and it is read off Ink.js
   * rather than typed. The second check below drives the shipped prepass on
   * every level and every quality tier and fails if its far plane ever reaches
   * a body a cohort has taken.
   *
   * THE READING IS TAKEN ON THE SAME WORLD AS §6's, one line apart, by moving
   * the CAMERA rather than the bodies — so the three rungs are three readings
   * of one field and the numbers are comparable:
   *
   *     cull only (LOD 1)     1064 draw calls
   *     merged skins (LOD 2)   194
   *     cohorts (LOD 3)         38
   *
   * and the last of those does not move when the field doubles.
   */

  /**
   * The same World, stepped back past the ink's reach. LAZY on purpose: every
   * check body here runs at registration time and the harness resumes `await`
   * continuations in registration order, so building this eagerly would move
   * the camera out from under §6's readings.
   */
  let _far = null;
  const farLine = () => (_far ||= (async () => {
    const { world, engine, centre } = await line;
    const back = 90;
    engine.camera.position.set(centre.x, centre.y + 1.6, centre.z - back);
    engine.camera.lookAt(centre.x, centre.y + 1.6, centre.z + 1);
    engine.camera.updateMatrixWorld(true);
    const input = idleInput();
    const budget = Math.ceil(L2.n / JOINS_PER_FRAME);
    let frames = 0;
    while (frames < budget * 4) {
      world.update(1 / 60, input);
      frames++;
      if (world.enemies.every((e) => e._l3)) break;
    }
    return { world, engine, centre, frames, budget, back };
  })());

  const cohortCalls = (world) => world.cohorts.stats().calls;

  /**
   * How far the ink's own prepass reaches, written by the band check below and
   * read by the crowd check under that. Shared rather than recomputed because
   * driving the shipped `prepass` over every level × tier pair is the expensive
   * half of that check, and the margin it leaves is the same margin the pose
   * palette has to stay inside.
   */
  const inkReach = { plane: 0, at: '' };

  check('frame: past the ink’s reach a body stops drawing itself, and the cost stops counting bodies', async () => {
    const { world, engine, frames, budget } = await farLine();
    const dists = world.enemies.map((e) => engine.camera.position.distanceTo(e.position));
    const near = Math.min(...dists), far = Math.max(...dists);

    assert(near > L3_AT,
      `the nearest body is ${near.toFixed(0)} m and the band starts at ${L3_AT.toFixed(1)} — `
      + 'this is not measuring the L3 rung');
    assert(world.enemies.every((e) => e.lod === 3), 'not every body reached LOD 3');
    assert(frames < budget * 4,
      `${frames} frames and not every body joined a cohort. Cohorts.js caps the freeze at `
      + `${JOINS_PER_FRAME} a frame and Enemy.update retries a deferred one.`);
    assert(frames >= budget,
      `${L2.n} bodies all joined inside ${frames} frames against a cap of ${JOINS_PER_FRAME} a `
      + 'frame — the cap is not binding, so a line that crosses the band together pays every '
      + 'freeze on one frame');

    /* THREE READINGS, ONE WORLD, ONE LINE APART. LOD 3 first because it is the
     * live state; dropping to 2 and then 1 tears the cohorts down, and a
     * separately built control World would be a different seed and a different
     * dressing. */
    const arm = (lod) => {
      for (const e of world.enemies) e._applyLod(lod);
      let n = 0;
      for (const e of world.enemies) (e.rig?.root || e.group)?.traverseVisible((o) => { if (o.isMesh) n++; });
      return n + cohortCalls(world);
    };
    const l3 = arm(3), stats = world.cohorts.stats();
    const l2 = arm(2), l1 = arm(1);
    /* …and put the field back the way it was found, so the checks below this
     * one are looking at a live cohort rather than at the wreckage of a
     * reading. `_applyLod` is edge-triggered; the join budget is not, so the
     * frames are stepped rather than forced. */
    const input = idleInput();
    for (let f = 0; f < budget * 4 && !world.enemies.every((e) => e._l3); f++) world.update(1 / 60, input);

    assert(l1 > 900, `the cull-only arm is only ${l1} draw calls — there is nothing here to save`);
    assert(l3 * 3 < l2, `L3 is ${l3} draw calls against L2's ${l2} — under 3x, and the rung costs `
      + 'a frozen copy of every archetype in memory to buy it');
    assert(stats.instances === L2.n,
      `${stats.instances} of ${L2.n} bodies are instances`);
    assert(stats.calls === l3,
      `the cohorts report ${stats.calls} calls and the scene walk found ${l3} — one of the two is `
      + 'not counting what is drawn');

    /* AND THE COST DOES NOT COUNT BODIES. The same field again with twice the
     * army in it: the instance count doubles and the DRAW CALL COUNT MUST NOT
     * MOVE, because a cohort is one call per material bin however many bodies
     * are standing in it. This is the whole claim of the rung and it is the one
     * number that separates it from L2, which is linear. */
    const centre = (await line).centre;
    for (let i = 0; i < L2.n; i++) {
      const t = L2.types[i % L2.types.length];
      const a = (i / L2.n) * 0.9 - 0.45 + 0.03;
      const d = L2.near + (i % 7) * L2.step;
      const x = centre.x + Math.sin(a) * d, z = centre.z + Math.cos(a) * d;
      world.spawnEnemy(t, new THREE.Vector3(x, world.terrain.height(x, z), z));
    }
    for (let f = 0; f < budget * 8 && !world.enemies.every((e) => e._l3); f++) world.update(1 / 60, input);
    const twice = world.cohorts.stats();
    assert(twice.instances >= L2.n * 2 - 2,
      `${twice.instances} instances after doubling the field, expected about ${L2.n * 2}`);
    assert(twice.calls === stats.calls,
      `doubling the army took the cohorts from ${stats.calls} draw calls to ${twice.calls}. A `
      + 'cohort is one call per material bin whatever is standing in it; a count that moves with '
      + 'the body count is L2 wearing an InstancedMesh.');

    return `${L2.n} bodies at ${near.toFixed(0)}-${far.toFixed(0)} m on ${L2.field}: `
      + `cull ${l1} → merged ${l2} → cohorts ${l3} draw calls `
      + `(${(l1 / l3).toFixed(0)}× the cull, ${(l2 / l3).toFixed(1)}× the merge), `
      + `${stats.live} cohorts over ${stats.instances} bodies; `
      + `${twice.instances} bodies cost the same ${twice.calls}`;
  });

  check('frame: the band starts where the ink stops, on every level and every tier', async () => {
    /**
     * THE ONE THING AN INSTANCED BODY CANNOT CARRY IS AN OUTLINE, so the rung
     * is only honest where there is no outline to carry. `OutlinePass.prepass`
     * decides that, per frame, from the level's air and `INK.edgeFade` — and
     * this drives THAT FUNCTION rather than repeating its arithmetic, because a
     * second copy of it here is HANDOFF §2.4 exactly and would go on passing
     * after the real one moved.
     *
     * Every outdoor level's own fog density goes through the shipped `setHaze`,
     * every quality tier's `viewDist` through the camera, and what comes back is
     * `uRange.y` — the far plane the prepass gave itself. `L3_AT` has to be at
     * or past every one of them.
     */
    const worst = [];
    const tiers = Object.keys(QUALITY);
    for (const key of LEVEL_ORDER) {
      const density = LEVELS[key]?.atmosphere?.fogDensity ?? 0;
      for (const t of tiers) {
        const ink = inkStub();
        ink.camera.far = QUALITY[t].viewDist;
        ink.camera.updateProjectionMatrix();
        OutlinePass.prototype.setHaze.call(ink, density);
        OutlinePass.prototype.prepass.call(ink, recordingRenderer());
        const plane = ink.uniforms.uRange.value.y;
        assert(plane > 0, `${key}/${t}: the prepass gave itself a far plane of ${plane}`);
        worst.push([`${key}/${t}`, plane]);
      }
    }
    worst.sort((a, b) => b[1] - a[1]);
    const [at, plane] = worst[0];
    assert(plane <= L3_AT + 1e-6,
      `the ink prepass reaches ${plane.toFixed(1)} m on ${at} and cohorts start at `
      + `${L3_AT.toFixed(1)} m. A body inside the prepass drawn as an instance is a body whose `
      + 'outline is one shared pose while its colour is another — move L3_AT, or find out what '
      + 'moved INK.edgeFade.');
    /* …and the constant is DERIVED from the same two terms, not typed beside
     * them: a change to edgeFade has to move the band with it. */
    assert(Math.abs(L3_AT - INK.edgeFade[1] * 1.06) < 1e-9,
      `L3_AT is ${L3_AT} and INK.edgeFade[1] · 1.06 is ${INK.edgeFade[1] * 1.06} — the band has `
      + 'stopped being the ink\'s own reach and become a number somebody typed');
    /* …and the gap between the two is published, because it is also the room a
     * cohort's POSE PALETTE has to move a vertex in before it would be drawn
     * into the prepass at a pose its colour is not in. See the crowd check. */
    inkReach.plane = plane; inkReach.at = at;
    return `${worst.length} level × tier pairs; the prepass reaches furthest on ${at} at `
      + `${plane.toFixed(1)} m, and the band starts at ${L3_AT.toFixed(1)} m`;
  });

  check('frame: an instance stands exactly where the body it was frozen from stood', async () => {
    /**
     * THE FREEZE, AS A MEASUREMENT. Collapsing a skin to a static pose and then
     * carrying it on an instance matrix is four matrices composed in the right
     * order or a body buried in the ground facing backwards, and the two look
     * identical in a draw-call count. So every vertex of every rigged archetype
     * goes through the shipped `CohortField.join` and `place`, the instance is
     * then MOVED AND RE-FACED, and what comes out is compared against the live
     * merged skin's world vertices carried by the same rigid motion.
     */
    const { initPhysics } = await import('../../src/physics/Rapier.js');
    await initPhysics();
    const { RapierWorld } = await import('../../src/physics/RapierWorld.js');
    const Foe = await import('../../src/game/Enemy.js');
    const { buildMergedSkin } = await import('../../src/game/MergedSkin.js');
    await import('../../src/game/Levels.js');

    const physics = new RapierWorld({ gravity: -24, iterations: 4, maxBodies: 64 });
    const terrain = { height: () => 0, normalAt: (x, z, o) => o.set(0, 1, 0), raycast: () => null,
      size: 400, half: 200, inBounds: () => true, surfaceAt: () => 'sand',
      crater() {}, flush() {}, slopeAt: () => 0 };
    physics.terrain = terrain;
    const nothing = { sandPuff() {}, sparkBurst() {}, cutFlare() {}, slag() {}, plasma: { spawn() {} } };
    const scene = new THREE.Scene();
    const world = { scene, physics, terrain, statics: [], settings: { fov: 60 },
      players: [], enemies: [], props: [], particles: nothing, time: 0, groundColor: 0xcfae82,
      bolts: { fire() {} }, engine: { flash() {}, camera: new THREE.PerspectiveCamera() },
      report() {}, notify() {}, notifyFloating() {}, addHitstop() {} };
    Foe.enemyRng.seed(20260821);

    const FROM = new THREE.Vector3(11.5, 2.25, -7.25), FACE = 1.31;
    const TO = new THREE.Vector3(-40.5, 1.0, 88.25), TOFACE = -2.4;
    const YAX = new THREE.Vector3(0, 1, 0);
    let worst = 0, worstAt = '', n = 0, bodies = 0, refused = 0;
    const v = new THREE.Vector3(), ref = new THREE.Vector3(), im = new THREE.Matrix4();
    for (const type of Object.keys(Foe.ARCHETYPES)) {
      const e = new Foe.Enemy(world, type, new THREE.Vector3(0, 0, 0));
      if (!e.rig) continue;
      bodies++;
      world.cohorts = new CohortField(scene);
      e._applyLod(1);
      e.rig.list.forEach((b, i) => { b.obj.rotation.z += 0.09 * Math.sin(i * 1.9); });
      e.position.copy(FROM); e.facing = FACE;
      e.rig.root.position.copy(FROM); e.rig.root.rotation.y = FACE;
      e.rig.root.updateMatrixWorld(true);
      const skin = e._l2?.skin || buildMergedSkin(e.rig);
      if (!skin) { refused++; continue; }
      for (const m of skin.meshes) m.updateMatrixWorld(true);

      // where the live merged skin puts every vertex, before anything is frozen
      const live = skin.meshes.map((m) => {
        const P = m.geometry.attributes.position, out = new Float64Array(P.count * 3);
        for (let i = 0; i < P.count; i++) {
          v.fromBufferAttribute(P, i); m.applyBoneTransform(i, v); v.applyMatrix4(m.matrixWorld);
          out[i * 3] = v.x; out[i * 3 + 1] = v.y; out[i * 3 + 2] = v.z;
        }
        return out;
      });
      assert(world.cohorts.join(e), `${type} could not join a cohort`);
      e.position.copy(TO); e.facing = TOFACE;
      world.cohorts.place(e);

      const L = e._l3;
      for (let b = 0; b < L.c.meshes.length; b++) {
        const mesh = L.c.meshes[b];
        im.fromArray(mesh.instanceMatrix.array, L.slot * 16);
        const P = mesh.geometry.attributes.position;
        assert(P.count * 3 === live[b].length, `${type} bin ${b} lost vertices in the freeze`);
        for (let i = 0; i < P.count; i++) {
          v.fromBufferAttribute(P, i).applyMatrix4(im);
          ref.set(live[b][i * 3], live[b][i * 3 + 1], live[b][i * 3 + 2])
            .sub(FROM).applyAxisAngle(YAX, TOFACE - FACE).add(TO);
          const d = v.distanceTo(ref);
          if (d > worst) { worst = d; worstAt = `${type} bin ${b} vertex ${i}`; }
          n++;
        }
      }
      world.cohorts.dispose();
      e.dispose?.();
    }
    assert(bodies >= 25, `only ${bodies} archetypes carry a rig`);
    assert(n > 50000, `only ${n} instance vertices compared`);
    assert(worst < 1e-3,
      `an instance puts a vertex ${(worst * 1000).toFixed(2)} mm from where the body it was frozen `
      + `from puts it (${worstAt}) — the freeze or the instance matrix has an axis the wrong way`);
    physics.dispose?.();
    return `${bodies} rigged archetypes, ${n} instance vertices, moved 96 m and turned 214°: `
      + `worst placement error ${worst.toExponential(1)} m${refused ? `, ${refused} refused` : ''}`;
  });

  /**
   * ── THE RASTERISER §7 PRICES THE POSE ON, AND THE BENCH IT DRIVES ──────
   *
   * At module scope because TWO checks read them now: what the frozen pose cost
   * a body, and what the palette gives a CROWD back. A second copy of either
   * would be a second opinion about what a cohort looks like, which is the
   * thing being measured (HANDOFF §2.4).
   *
   * `cohortTris` takes the instance's gait PHASE and reads the palette through
   * the shipped `poseMatrix`, so what it rasterises is the data the vertex
   * shader is handed. A negative phase is a body that is not walking and gets
   * the identity — which is the rung exactly as it shipped, and is how the
   * before/after below are two readings of one function rather than two
   * functions.
   */
  const H = 720, VFOV = 60, SS = 4;
  const pxPerM = (d) => (H / 2) / (d * Math.tan(VFOV * Math.PI / 360));
  const cover = (tris, anchor, d, frame = 2.6) => {
    const s = pxPerM(d) * SS, N = Math.max(4, Math.round(frame * pxPerM(d))), M = N * SS;
    const g = new Uint8Array(M * M);
    for (const [a, b, c] of tris) {
      const A = [(a.z - anchor.z + frame / 2) * s, (a.y - anchor.y) * s];
      const B = [(b.z - anchor.z + frame / 2) * s, (b.y - anchor.y) * s];
      const C = [(c.z - anchor.z + frame / 2) * s, (c.y - anchor.y) * s];
      const x0 = Math.max(0, Math.floor(Math.min(A[0], B[0], C[0])));
      const x1 = Math.min(M - 1, Math.ceil(Math.max(A[0], B[0], C[0])));
      const y0 = Math.max(0, Math.floor(Math.min(A[1], B[1], C[1])));
      const y1 = Math.min(M - 1, Math.ceil(Math.max(A[1], B[1], C[1])));
      for (let py = y0; py <= y1; py++) for (let px = x0; px <= x1; px++) {
        const X = px + 0.5, Y = py + 0.5;
        const d1 = (X - B[0]) * (A[1] - B[1]) - (A[0] - B[0]) * (Y - B[1]);
        const d2 = (X - C[0]) * (B[1] - C[1]) - (B[0] - C[0]) * (Y - C[1]);
        const d3 = (X - A[0]) * (C[1] - A[1]) - (C[0] - A[0]) * (Y - A[1]);
        if (!(((d1 < 0) || (d2 < 0) || (d3 < 0)) && ((d1 > 0) || (d2 > 0) || (d3 > 0)))) g[py * M + px] = 1;
      }
    }
    const cov = new Float32Array(N * N);
    for (let y = 0; y < M; y++) for (let x = 0; x < M; x++) {
      if (g[y * M + x]) cov[((y / SS) | 0) * N + ((x / SS) | 0)] += 1 / (SS * SS);
    }
    return cov;
  };
  const L1 = (a, b) => { let t = 0; for (let i = 0; i < a.length; i++) t += Math.abs(a[i] - b[i]); return t; };
  const A1 = (a) => { let t = 0; for (let i = 0; i < a.length; i++) t += a[i]; return t; };
  const skinTris = (skin) => {
    const out = [];
    for (const m of skin.meshes) {
      m.updateMatrixWorld(true);
      const P = m.geometry.attributes.position, idx = m.geometry.index, w = [];
      for (let i = 0; i < P.count; i++) {
        const v = new THREE.Vector3().fromBufferAttribute(P, i);
        m.applyBoneTransform(i, v); w.push(v.applyMatrix4(m.matrixWorld));
      }
      for (let i = 0; i < idx.count; i += 3) out.push([w[idx.getX(i)], w[idx.getX(i + 1)], w[idx.getX(i + 2)]]);
    }
    return out;
  };
  const cohortTris = (L, phase = -1) => {
    const out = [], im = new THREE.Matrix4(), pm = new THREE.Matrix4(), full = new THREE.Matrix4();
    for (const mesh of L.c.meshes) {
      im.fromArray(mesh.instanceMatrix.array, L.slot * 16);
      const P = mesh.geometry.attributes.position, AB = mesh.geometry.attributes.aBone;
      const idx = mesh.geometry.index, w = [];
      /* THE PALETTE FIRST, THEN THE INSTANCE MATRIX, which is the order the
       * vertex shader applies them in: the palette is a canonical-frame
       * transform and `instanceMatrix` is what puts the canonical body back on
       * the ground. `poseMatrix` is the shipped reader — a phase below zero is
       * "not walking" and gives the identity, i.e. the frozen rung. */
      let bone = -1;
      for (let i = 0; i < P.count; i++) {
        const b = AB ? AB.getX(i) : 0;
        if (b !== bone) { bone = b; full.multiplyMatrices(im, poseMatrix(L.c, phase, b, pm)); }
        w.push(new THREE.Vector3().fromBufferAttribute(P, i).applyMatrix4(full));
      }
      for (let i = 0; i < idx.count; i += 3) out.push([w[idx.getX(i)], w[idx.getX(i + 1)], w[idx.getX(i + 2)]]);
    }
    return out;
  };

  /**
   * One physics world and one scene for every §7 check that needs a body it can
   * drive by hand. Lazy and shared for the same reason `farLine` is: building
   * it is the expensive part, and two of them would be two seeds.
   */
  let _bench = null;
  const poseBench = () => (_bench ||= (async () => {
    const { initPhysics } = await import('../../src/physics/Rapier.js');
    await initPhysics();
    const { RapierWorld } = await import('../../src/physics/RapierWorld.js');
    const Foe = await import('../../src/game/Enemy.js');
    await import('../../src/game/Levels.js');
    const physics = new RapierWorld({ gravity: -24, iterations: 4, maxBodies: 64 });
    const terrain = { height: () => 0, normalAt: (x, z, o) => o.set(0, 1, 0), raycast: () => null,
      size: 400, half: 200, inBounds: () => true, surfaceAt: () => 'sand',
      crater() {}, flush() {}, slopeAt: () => 0 };
    physics.terrain = terrain;
    const nothing = { sandPuff() {}, sparkBurst() {}, cutFlare() {}, slag() {}, plasma: { spawn() {} } };
    const scene = new THREE.Scene();
    const world = { scene, physics, terrain, statics: [], settings: { fov: 60 },
      players: [], enemies: [], props: [], particles: nothing, time: 0, groundColor: 0xcfae82,
      bolts: { fire() {} }, engine: { flash() {}, camera: new THREE.PerspectiveCamera() },
      report() {}, notify() {}, notifyFloating() {}, addHitstop() {} };
    Foe.enemyRng.seed(20260821);
    return { world, scene, physics, terrain, nothing, Foe };
  })());

  /**
   * ONE MARCHING COHORT, BUILT ONCE, READ BY TWO CHECKS.
   *
   * Shared because the two things worth asserting about the pose palette are
   * the same crowd in two states — walking and halted — and a second crowd
   * would be a second seed, a second freeze and a second answer to "what does
   * this cohort look like". The checks below take it in order: the first fills
   * the palette and prices the picture, the second halts it and disposes.
   *
   * The bodies are spread along X so the side-on rasteriser sees each man in
   * his own frame, and each starts at a different point of the walk so the
   * crowd arrives spread across the cycle — which is what `Enemy._animPhase`
   * does to a wave that spawns together, reproduced here by construction.
   */
  const CROWD = { type: 'trooper', n: 8 };
  let _crowd = null;
  const poseCrowd = (assert) => (_crowd ||= (async () => {
    const { world, scene, physics, terrain, nothing, Foe } = await poseBench();
    Foe.enemyRng.seed(20260824);
    const field = new CohortField(scene);
    world.cohorts = field;
    const ctx = { camera: world.engine.camera, terrain, particles: nothing, physics,
      enemies: [], players: [], time: 0, dt: 1 / 60, bolts: world.bolts, pickTarget: () => null };
    /* `velocity` and `grounded` are what `BipedAnimator.solve` reads to decide
     * it is walking, so driving them by hand is driving the shipped predicate —
     * `halt` is the same call with the speed taken out and nothing else. */
    const stride = (e) => { e.velocity.set(0, 0, 3.0); e.grounded = true; e._pose(1 / 60, ctx); };
    const halt = (e) => { e.velocity.set(0, 0, 0); e.grounded = true; e._pose(1 / 60, ctx); };
    const crowd = [];
    const enlist = (i) => {
      const e = new Foe.Enemy(world, CROWD.type, new THREE.Vector3(i * 4, 0, 0));
      e.facing = 0;
      for (let k = 0; k < 40 + i * 9; k++) stride(e);
      world.time += 1; e._applyLod(2);
      if (!e._l2?.skin) { world.time += 1; e._applyLod(1); e._applyLod(2); }
      world.time += 1;
      assert(field.join(e), `${CROWD.type} could not join a cohort`);
      crowd.push(e);
      return e;
    };
    for (let i = 0; i < CROWD.n; i++) enlist(i);
    return { world, physics, field, crowd, ctx, stride, halt, enlist, cold: field.stats() };
  })());

  check('frame: the pose a cohort freezes is inside the band the gait already occupies', async () => {
    /**
     * WHAT THE RUNG ACTUALLY TRADES, AND THE ONLY HONEST WAY TO PRICE IT.
     *
     * Every instance of a cohort wears one pose, so a walking body is drawn in
     * a stride it is not currently in. "You cannot see it at that range" is an
     * argument; this is the measurement. The body's flank is rasterised into
     * the pixels it really owns at the band's own distance — 4.52 px/m, so a
     * trooper is about ten pixels of coverage — supersampled 4× so the answer
     * is fractional area rather than a 12×12 quantisation artefact. Then:
     *
     *   how far the body's own silhouette moves between two frames of its walk
     *   how far the frozen pose sits from any of those frames
     *
     * The bar is that the second is no bigger than the first. A rung whose
     * error is inside the band the animation already occupies cannot be told
     * from a frame of the animation, and that is a stronger statement than any
     * threshold anybody would have chosen.
     */
    const { world, scene, physics, terrain, nothing, Foe } = await poseBench();

    const rows = [];
    let worstRatio = 0, worstAt = '', smallest = 1e9;
    for (const type of L2.types) {
      const e = new Foe.Enemy(world, type, new THREE.Vector3(0, 0, 0));
      if (!e.rig || !e.animator) continue;
      e.facing = 0;
      const anchor = e.position.clone();
      const ctx = { camera: world.engine.camera, terrain, particles: nothing, physics,
        enemies: [], players: [], time: 0, dt: 1 / 60, bolts: world.bolts, pickTarget: () => null };
      const stride = () => { e.velocity.set(0, 0, 3.0); e.grounded = true; e._pose(1 / 60, ctx); };
      for (let i = 0; i < 60; i++) stride();
      world.cohorts = new CohortField(scene);
      world.time += 1; e._applyLod(2);
      if (!e._l2?.skin) { world.time += 1; e._applyLod(1); e._applyLod(2); }
      world.time += 1;
      assert(world.cohorts.join(e), `${type} could not join a cohort`);
      const frozen = cover(cohortTris(e._l3), anchor, L3_AT);
      const live = [];
      for (let k = 0; k < 10; k++) { for (let i = 0; i < 4; i++) stride(); live.push(cover(skinTris(e._l2.skin), anchor, L3_AT)); }

      let gait = 0;
      for (let i = 0; i < live.length; i++) for (let j = i + 1; j < live.length; j++) gait = Math.max(gait, L1(live[i], live[j]));
      let froze = 0;
      for (const l of live) froze = Math.max(froze, L1(frozen, l));
      const area = A1(live[0]);
      smallest = Math.min(smallest, area);
      assert(area > 1, `${type} covers ${area.toFixed(2)} px at ${L3_AT.toFixed(0)} m — nothing was rasterised`);
      assert(gait > 0.5, `${type}'s own gait moves ${gait.toFixed(2)} px between frames, so this `
        + 'comparison has no band to sit inside and is not measuring anything');
      const ratio = froze / gait;
      if (ratio > worstRatio) { worstRatio = ratio; worstAt = type; }
      rows.push(`${type} ${area.toFixed(1)}px gait ${gait.toFixed(1)} frozen ${froze.toFixed(1)}`);
      world.cohorts.dispose();
      e.dispose?.();
    }
    assert(rows.length >= 5, `only ${rows.length} archetypes were compared`);
    assert(worstRatio <= 1.0,
      `${worstAt}'s frozen pose sits ${worstRatio.toFixed(2)}× further from the live body than the `
      + 'live body sits from itself one gait frame later. The rung is meant to be indistinguishable '
      + 'from a frame of the animation it replaces; past 1.0 it is a pose nobody would have drawn.');
    return `${rows.length} archetypes at ${L3_AT.toFixed(0)} m (${pxPerM(L3_AT).toFixed(2)} px/m, `
      + `smallest body ${smallest.toFixed(1)} px of coverage): worst frozen/gait ratio `
      + `${worstRatio.toFixed(2)} (${worstAt}) — ${rows.join(', ')}`;
  });


  check('frame: a cohort wears a CROWD of poses now, and still costs a draw call a MATERIAL', async () => {
    /**
     * ══ WHAT THE PALETTE BUYS, AND THE ONLY THING IT IS ALLOWED TO COST ══
     *
     * The check above this one prices the frozen pose against ONE body and the
     * answer is that it is already honest — worst archetype 0.98x the gait's own
     * frame-to-frame movement. What it cannot see is the defect a player
     * actually reports, because it never looks at two bodies at once: every
     * instance of one cohort wore ONE pose, so the error was the SAME error on
     * every man at the same instant and a hundred of them read as lockstep long
     * before any one of them reads as wrong.
     *
     * So this is the same rasteriser pointed at a CROWD, and it asserts the two
     * halves of the trade separately:
     *
     *   THE DECISION CHANGES. The frozen crowd is literally one silhouette
     *   repeated — every pair of instances is identical to the pixel. With the
     *   palette it is not, and each instance sits CLOSER to the body it is
     *   standing in for than the frozen pose did. Both readings come out of one
     *   function (`cohortTris`) called with and without a phase, so this is not
     *   two rasterisers agreeing with each other.
     *
     *   THE COUNT DOES NOT. `stats().calls` is taken before the palette exists,
     *   after it has filled, and again with the crowd doubled. A pose that cost
     *   a draw call would be a palette of frozen cohorts, and §7's own reading
     *   prices that: 8 cohorts at 38 calls x `poseSlots()` is 456, against the
     *   L2 merge's 196 — worse than deleting the rung.
     *
     * And the GLSL is held to the JS. `poseMatrix` is what this rasterises
     * through; `POSE_GLSL` is what the GPU runs. They address one texture with
     * one pair of terms and neither is allowed to move alone — see
     * tools/checks/_glsl.mjs for why a check with its own copy of a shader's
     * arithmetic measures nothing.
     */
    const patched = posedVertexShader(THREE.ShaderLib.physical.vertexShader);
    assert(patched.indexOf('objectNormal = mat3( cohortPoseM )') < patched.indexOf('#include <defaultnormal_vertex>'),
      'the pose rotates objectNormal AFTER <defaultnormal_vertex> has consumed it — the body would '
      + 'be lit in a pose it is not drawn in');
    assert(patched.indexOf('transformed = ( cohortPoseM') > patched.indexOf('#include <begin_vertex>'),
      'the pose moves `transformed` before <begin_vertex> assigns it');
    assert(POSE_GLSL.pars.includes('floor( aPose * uPoseSlots )')
      && POSE_GLSL.pars.includes('aBone.x * 3.0'),
      'the shader no longer addresses the palette the way `poseMatrix` does — one of the two moved, '
      + 'so what this check rasterises is not what the GPU draws');

    const slots = poseSlots();
    const { field, crowd, stride, enlist, cold } = await poseCrowd(assert);
    const N = CROWD.n;
    assert(cold.instances === N, `${cold.instances} of ${N} bodies are instances`);
    const c = crowd[0]._l3.c;
    assert(c.pose, 'the cohort has no pose palette at all');
    /* AND THE MATERIAL IT HANGS OFF WAS NOT ALREADY EXTENDED. `Cohorts` ASSIGNS
     * `onBeforeCompile` on its clone rather than chaining, so a character
     * material that had grown one of its own would lose it — silently, and only
     * on the cohort rung. `Toon.hasCustomShader` is the codebase's own test for
     * "this material has been extended"; nothing in the character path trips it
     * today and this is what says so out loud if that changes. */
    for (const e of crowd) for (const m of e._l2.skin.meshes) {
      assert(!hasCustomShader(m.material),
        `${CROWD.type}'s merged bin \`${m.material.name || m.material.type}\` carries its own `
        + 'onBeforeCompile, and the cohort clone assigns over it — that extension is dropped for '
        + 'every instanced body and kept for every one a metre closer');
    }
    assert(c.pose.filled === 0, `the palette holds ${c.pose.filled} captured slots before a frame `
      + 'has been stepped — an untouched palette must be the identity, which is this rung as it shipped');

    /* A CAPTURE A FRAME OVER THE WHOLE FIELD, which is what `step` promises and
     * what the bound below is measuring: the palette cannot fill faster than
     * `CAPTURES_PER_FRAME`, and if it needed more than a few seconds of them a
     * crowd would spend the fight in lockstep anyway. */
    const budget = slots * 40;
    let frames = 0;
    while (frames < budget && c.pose.filled < slots) {
      for (const e of crowd) { stride(e); field.place(e); }
      field.step();
      frames++;
    }
    assert(c.pose.filled === slots,
      `${frames} frames at ${CAPTURES_PER_FRAME} capture a frame and the palette has ${c.pose.filled} `
      + `of ${slots} slots. A crowd that never fills its palette is a crowd in lockstep.`);

    const warm = field.stats(), poses = field.poseStats();
    assert(warm.calls === cold.calls,
      `the palette took the cohort from ${cold.calls} draw calls to ${warm.calls}`);
    assert(poses.worn > 1,
      `${N} instances are wearing ${poses.worn} distinct pose${poses.worn === 1 ? '' : 's'}. That is `
      + 'the rung as it was: one pose for the whole cohort, whatever the population.');
    assert(poses.frozen === 0,
      `${poses.frozen} of ${N} walking bodies are still wearing the frozen pose`);
    /* AND NO PHASE ADDRESSES A ROW THAT IS NOT THERE. `poseSlotOf` CLAMPS to the
     * last slot and the GLSL's `floor( aPose * uPoseSlots )` does not, so the
     * writer in `place` is the only thing keeping the two in agreement: a phase
     * that reached 1.0 would send the shader a row past the palette while every
     * reader on this side quietly answered with the last one. */
    for (const e of crowd) {
      const ph = c.aPose.array[e._l3.slot];
      assert(Math.floor(ph * slots) === poseSlotOf(ph, slots),
        `a phase of ${ph} sends the shader to row ${Math.floor(ph * slots)} of a ${slots}-row `
        + `palette, while poseSlotOf clamps it to ${poseSlotOf(ph, slots)}`);
    }

    /* …AND THE COST STILL DOES NOT COUNT BODIES. Same claim as the rung's own,
     * re-asserted with the palette on, because a per-instance pose is exactly
     * the shape of change that quietly turns an instanced draw back into one. */
    for (let i = 0; i < N; i++) enlist(N + i);
    for (let f = 0; f < 8; f++) { for (const e of crowd) { stride(e); field.place(e); } field.step(); }
    const twice = field.stats();
    assert(twice.instances >= N * 2 - 1 && twice.calls === cold.calls,
      `${twice.instances} instances now cost ${twice.calls} draw calls against ${cold.calls} for ${N}`);

    /* ── the picture, at the band's own distance ─────────────────────── */
    const posed = [], frozenC = [], live = [];
    for (const e of crowd.slice(0, N)) {
      const ph = c.aPose.array[e._l3.slot];
      assert(ph >= 0, 'a walking body wrote a negative phase');
      posed.push(cover(cohortTris(e._l3, ph), e.position, L3_AT));
      frozenC.push(cover(cohortTris(e._l3, -1), e.position, L3_AT));
      live.push(cover(skinTris(e._l2.skin), e.position, L3_AT));
    }
    let sameFrozen = 0, samePosed = 0, pairs = 0;
    for (let i = 0; i < N; i++) for (let j = i + 1; j < N; j++) {
      pairs++;
      if (L1(frozenC[i], frozenC[j]) < 1e-9) sameFrozen++;
      if (L1(posed[i], posed[j]) < 1e-9) samePosed++;
    }
    assert(sameFrozen === pairs,
      `${sameFrozen} of ${pairs} frozen pairs are identical — this check is not measuring the rung `
      + 'it thinks it is, because the frozen cohort is one silhouette by construction');
    assert(samePosed < pairs,
      `all ${pairs} pairs of the posed crowd are still pixel-identical: the palette is filled but `
      + 'nothing is reading it');

    let ef = 0, ep = 0, worstPair = 0;
    for (let i = 0; i < N; i++) {
      ef += L1(frozenC[i], live[i]);
      ep += L1(posed[i], live[i]);
    }
    for (let i = 0; i < N; i++) for (let j = i + 1; j < N; j++) worstPair = Math.max(worstPair, L1(posed[i], posed[j]));
    assert(ep < ef,
      `the posed crowd sits ${(ep / N).toFixed(2)} px from the bodies it stands in for and the frozen `
      + `crowd sat ${(ef / N).toFixed(2)} px. The palette is meant to move each instance TOWARD the `
      + 'man it replaces; if it does not, it is decoration with a texture fetch attached.');

    /* ── and it stays out of the ink, which is the licence for all of it ─ */
    let disp = 0;
    const pm = new THREE.Matrix4(), v0 = new THREE.Vector3(), v1 = new THREE.Vector3();
    const g0 = c.meshes[0].geometry, PA = g0.attributes.position, AB = g0.attributes.aBone;
    for (let sl = 0; sl < slots; sl++) {
      for (let i = 0; i < PA.count; i += 7) {
        poseMatrix(c, (sl + 0.5) / slots, AB.getX(i), pm);
        v0.fromBufferAttribute(PA, i);
        v1.copy(v0).applyMatrix4(pm);
        disp = Math.max(disp, v0.distanceTo(v1));
      }
    }
    assert(inkReach.plane > 0,
      'the ink-reach check has not run yet, so this has nothing to compare the pose against');
    assert(disp < L3_AT - inkReach.plane,
      `a palette slot moves a vertex ${disp.toFixed(2)} m and the gap between the ink prepass's `
      + `furthest reach (${inkReach.plane.toFixed(1)} m on ${inkReach.at}) and the band `
      + `(${L3_AT.toFixed(1)} m) is only ${(L3_AT - inkReach.plane).toFixed(1)} m. A posed vertex `
      + 'that crossed into the prepass would be outlined at the pose it is not in, which is the '
      + 'objection this rung refused a vertex shader over.');

    /* NOT DISPOSED — the halt check below takes this same crowd, because the
     * pose the palette must NOT hold is only meaningful against the one it
     * does. It disposes. */
    return `${N} bodies of one cohort, ${slots} palette slots filled in ${frames} frames at `
      + `${CAPTURES_PER_FRAME} capture a frame: ${poses.worn} distinct poses drawn where the frozen `
      + `rung drew 1, all ${pairs} frozen pairs identical and ${samePosed} posed; error to the live `
      + `body ${(ef / N).toFixed(2)} → ${(ep / N).toFixed(2)} px, crowd spread ${worstPair.toFixed(2)} px; `
      + `${twice.instances} bodies still cost ${twice.calls} draw calls (a pose a mesh would be `
      + `${cold.calls * slots}); worst slot moves a vertex ${disp.toFixed(2)} m into a `
      + `${(L3_AT - inkReach.plane).toFixed(1)} m gap before the ink`;
  });

  check('frame: a cohort that halts wears the pose it halted in, and stops feeding the palette', async () => {
    /**
     * ══ WHY `BipedAnimator.moving` IS PUBLISHED, AND WHAT IT DECIDES ══════
     *
     * The palette is a WALK, and `phase` alone cannot say whether a body is
     * walking: a man who stops keeps the phase he stopped on. Both sides of the
     * palette read the gait's own predicate instead, and both would be wrong
     * without it —
     *
     *   THE WRITER (`Cohorts.place`). A halted instance writes -1 and wears the
     *     pose the cohort was frozen in. Off `phase` alone the crowd would be
     *     held mid-stride, each man on a different foot — a field of statues
     *     caught walking, which is worse than the lockstep this rung started as
     *     because it is now a LIE ABOUT WHAT THE BODY IS DOING.
     *
     *   THE DONOR (`Cohorts.capture`). A halted man is never read into the
     *     palette. Otherwise a slice of parade rest lands in one slot and every
     *     instance in the crowd whose phase reaches it snaps to attention for
     *     one twelfth of a second, forever.
     *
     * THE SAME CROWD as the check above, which is the point: it walked, its
     * palette filled, and the picture was measured. Halting it must put every
     * one of those readings back exactly where the frozen rung had them — one
     * silhouette, no captures, a palette that does not move a byte. That is the
     * decision changing, measured in both directions on one field.
     */
    const { field, crowd, stride, halt, physics } = await poseCrowd(assert);
    const c = crowd[0]._l3.c, P = c.pose;
    const slots = poseSlots();
    assert(P.filled === slots,
      `the palette holds ${P.filled} of ${slots} slots — the walking check above did not run, so `
      + 'this has no filled palette to prove is left alone');

    /* Every one of them is indexing the palette while it walks, which is what
     * the halt below has to take away. */
    assert(crowd.every((e) => c.aPose.array[e._l3.slot] >= 0),
      'a walking body wrote a negative phase, so there is nothing here for the halt to change');

    const before = P.data.slice();
    let took = 0;
    for (let f = 0; f < slots * 4; f++) {
      for (const e of crowd) { halt(e); field.place(e); }
      took += field.step();
    }
    const held = crowd.map((e) => e.animator.phase - Math.floor(e.animator.phase));
    const worn = crowd.map((e) => c.aPose.array[e._l3.slot]);

    assert(held.some((p) => p > 0.02 && p < 0.98),
      'every halted body\'s gait phase is at the top of the cycle, so nothing here would have shown '
      + 'a reader that held a standing man mid-stride');
    assert(worn.every((p) => p < 0), `${worn.filter((p) => p >= 0).length} of ${crowd.length} halted `
      + 'bodies are still indexing the walk palette — they are held mid-stride, on whichever foot '
      + 'they stopped on');
    assert(took === 0, `${took} captures were taken off a crowd that is standing still. The palette `
      + 'is a walk cycle; a standing pose in it snaps the whole crowd to attention for one slot.');
    let moved = 0;
    for (let i = 0; i < before.length; i++) if (before[i] !== P.data[i]) moved++;
    assert(moved === 0, `${moved} palette floats changed while nobody walked`);
    const poses = field.poseStats();
    assert(poses.frozen === poses.instances,
      `${poses.instances - poses.frozen} of ${poses.instances} halted instances are not on the `
      + 'frozen pose');
    assert(poses.worn === 0, `${poses.worn} distinct walk poses are still being drawn`);

    /* AND IT IS ONE SILHOUETTE AGAIN, pixel for pixel — the rung exactly as it
     * shipped, which is the state a halted crowd is supposed to fall back to.
     * Read through the same rasteriser the walking crowd was, at the same
     * distance, so the two readings are comparable by construction. */
    const cov = crowd.slice(0, CROWD.n).map((e) => cover(cohortTris(e._l3, c.aPose.array[e._l3.slot]),
      e.position, L3_AT));
    let same = 0, pairs = 0;
    for (let i = 0; i < cov.length; i++) for (let j = i + 1; j < cov.length; j++) {
      pairs++; if (L1(cov[i], cov[j]) < 1e-9) same++;
    }
    assert(same === pairs, `${same} of ${pairs} halted pairs are identical — a halted cohort is `
      + 'meant to be the frozen rung, and the frozen rung is one silhouette by construction');

    /**
     * …AND IT WALKS AGAIN THE MOMENT THEY DO, so the halt is a state and not a
     * door that shuts. Same bodies, same field, speed put back.
     *
     * `frozen === 0` is the assertion. `worn` IS NOT, and the reason is a
     * property of the shipped gait rather than of this rung: `BipedAnimator`
     * resets `phase` on the walk-restart edge so a body "starts on the foot a
     * person would start on — the one already furthest behind" (Rig.js), and a
     * squad that halted together and steps off together therefore shares one
     * phase for the first stride. That is a real squad stepping off in unison,
     * which is what a squad does; the lockstep the palette exists to break is
     * the PERMANENT one, and the crowd it breaks arrives already spread because
     * `Enemy._animPhase` offsets a wave that spawns together. Asserting a
     * spread here would be asserting the gait is wrong about how people start
     * walking.
     */
    for (let f = 0; f < slots; f++) { for (const e of crowd) { stride(e); field.place(e); } field.step(); }
    const again = field.poseStats();
    assert(again.frozen === 0,
      `${again.frozen} of ${again.instances} bodies are still wearing the frozen pose after the `
      + 'crowd started walking again — the halt is one-way');
    assert(new Set(crowd.map((e) => e.animator.phase)).size === 1,
      `the crowd stepped off on ${new Set(crowd.map((e) => e.animator.phase)).size} different phases. `
      + 'Rig.js resets the phase on the walk-restart edge, so a squad that halted together shares '
      + 'one — if that stopped being true this note about why `worn` is not asserted is stale');

    field.dispose();
    for (const e of crowd) e.dispose?.();
    physics.dispose?.();
    return `${crowd.length} bodies halted mid-stride (phases ${held.slice(0, 3).map((p) => p.toFixed(2)).join('/')}…): `
      + `every one wears the frozen pose, all ${pairs} pairs identical again, ${took} captures taken `
      + `and ${moved} of ${before.length} palette floats moved in ${slots * 4} frames; `
      + `0 frozen over ${again.instances} bodies when they march again, all on one phase because `
      + 'Rig.js starts a stride on the foot furthest behind';
  });

  check('frame: a cohort member is still a body — it is the drawing that changed', async () => {
    /**
     * THE LIMIT OF WHAT THIS RUNG IS ALLOWED TO TOUCH.
     *
     * A cohort trooper has to shoot, be shot, take damage and die on the frame
     * it would have anyway. Hit tests read `Enemy.capsules()` off the bone
     * world matrices and the physics proxy off `Enemy._syncBody`, and NEITHER
     * is downstream of anything here — the rig is still solved every frame,
     * only its meshes are hidden. Asserted rather than asserted-in-prose: the
     * capsules are read before and after the body joins, and they have to be
     * the same numbers.
     */
    const { world } = await farLine();
    const e = world.enemies.find((x) => x._l3 && x.rig && !x.dead);
    assert(e, 'no cohort member on the field');

    const snap = () => e.capsules().map((c) => [c.a?.x, c.a?.y, c.a?.z, c.b?.x, c.b?.y, c.b?.z, c.r]
      .map((n) => (typeof n === 'number' ? +n.toFixed(6) : n)).join(','));
    const inCohort = snap();
    const proxy = e.body.position.clone();
    assert(inCohort.length > 0, `${e.type} has no hit capsules at all`);

    /* Take it out of the cohort and read the same body again. Nothing about
     * where it can be hit may have moved. */
    e._applyLod(2);
    assert(!e._l3, 'the body did not leave its cohort');
    const outside = snap();
    assert(inCohort.length === outside.length,
      `${e.type} has ${inCohort.length} hit capsules as an instance and ${outside.length} as `
      + 'itself');
    for (let i = 0; i < inCohort.length; i++) {
      assert(inCohort[i] === outside[i],
        `${e.type} capsule ${i} reads ${inCohort[i]} as an instance and ${outside[i]} as itself — `
        + 'the rung has moved where the body can be hit');
    }
    assert(e.body.position.distanceTo(proxy) === 0,
      'the physics proxy moved when the body left its cohort');
    const input = idleInput();
    for (let f = 0; f < 8 && !e._l3; f++) world.update(1 / 60, input);
    return `${inCohort.length} hit capsules and the physics proxy identical in the cohort and out `
      + 'of it';
  });

  /* ══════════════════════════════════════════════════════════════════════ */
  /*  8. Both rungs let go of a body that stops being one of forty          */
  /* ══════════════════════════════════════════════════════════════════════ */

  check('frame: a body that comes apart gives both rungs back, on the frame it comes apart', async () => {
    /**
     * BOTH BAKES ARE PHOTOGRAPHS OF A RIG WITH ALL OF ITS BONES.
     *
     * `Ragdoll.cut` rebuilds `bone.primary`'s geometry and hides a whole
     * subtree; neither a merged vertex nor a frozen instance can know it
     * happened, so a cut body would walk off carrying an arm the player has
     * just taken off it — and the cohort's copy would put that arm on every
     * other body in the cohort too, because they share one geometry.
     *
     * Driven through the shipped `Actor.cut`, and through an ORDINARY FRAME
     * rather than a forced `_applyLod`, with the number of `_applyLod` calls
     * during that frame asserted to be ZERO. That count is the whole argument:
     * a cut is not a LOD band change, `_applyLod` is edge-triggered, and a
     * teardown that only fired inside it would never fire in the game. This
     * check was green about exactly that until the count was taken.
     *
     * This runs LAST in the file because it is the one check that damages the
     * shared World, and the harness resumes `await` continuations in
     * registration order.
     */
    const { world } = await farLine();
    const input = idleInput();
    const e = world.enemies.find((x) => x.actor && x.rig && x._l3);
    assert(e, 'no cohort member on the field to cut');
    const band = e.lod;

    /* First the rungs' own switches, forced, because those ARE band changes and
     * the band is what they answer to. */
    e._applyLod(0);
    assert(!e._l3, 'the cohort is still drawing this body three metres from the camera');
    assert(!e._l2?.on, 'the merged skin is still drawing at LOD 0');
    e._applyLod(1);
    assert(!e._l3 && !e._l2?.on, 'both rungs are still on at LOD 1, inside the 62 m the first engages at');
    assert(e._l2.skin.replaced.every((m) => m.visible),
      'the meshes the merged skin replaced did not come back — the body is invisible inside 62 m');
    e._applyLod(2);
    assert(e._l2.on && !e._l3, 'LOD 2 is the merged skin and nothing else');
    e._applyLod(3);
    for (let f = 0; f < 8 && !e._l3; f++) world.update(1 / 60, input);
    assert(e._l3, 'the body did not rejoin its cohort at LOD 3');
    assert(e._dark && e._dark.length > 0, 'a cohort member is still drawing meshes of its own');

    const arm = e.rig.list.find((b) => b.role === 'arm' && b.primary && b.children.length);
    assert(arm, `${e.type} has no limb to cut`);
    const at = new THREE.Vector3().setFromMatrixPosition(arm.obj.matrixWorld);
    const wasCut = e.actor.severedCount;
    e.actor.cut(arm.name, at, new THREE.Vector3(0, 0, 1), 0.5);
    assert(e.actor.severedCount > wasCut, `Actor.cut refused ${arm.name} on a ${e.type}`);

    const real = e._applyLod.bind(e);
    let applied = 0;
    e._applyLod = (l) => { applied++; return real(l); };
    world.update(1 / 60, input);
    delete e._applyLod;

    assert(e.lod === band,
      `the cut body changed LOD band (${band} → ${e.lod}), so the frame proves nothing`);
    assert(applied === 0,
      `_applyLod ran ${applied} times on the frame the body was cut, so this check cannot tell a `
      + 'teardown that fires on a cut from one that only fires when the body changes band');
    assert(!e._l3,
      `${e.type} kept its place in a cohort after losing a ${arm.name}. That geometry is SHARED — `
      + 'every other body in the cohort would be wearing the arm too.');
    assert(!e._dark, 'the body is still hidden but nothing is drawing it');
    assert(!e._l2 || !e._l2.on,
      `${e.type} kept its merged skin after losing a ${arm.name}. Every vertex of that limb is `
      + 'still in the merged geometry, riding a bone the rig has marked severed.');
    let ghost = 0;
    e.rig.root.traverse((o) => {
      if (o.isMesh && o.visible && (o.userData.mergedSkinL2 || o.userData.cohortL3)) ghost++;
    });
    assert(ghost === 0, `${ghost} rung meshes still drawing on a cut body`);
    let drawn = 0;
    e.rig.root.traverseVisible((o) => { if (o.isMesh) drawn++; });
    assert(drawn > 0, `${e.type} is drawing nothing at all after the cut`);
    return `LOD 0/1 off, LOD 2 merged, LOD 3 instanced; a cut ${arm.name} gave both rungs back on `
      + `an ordinary frame that never entered _applyLod, and the body draws its own ${drawn} meshes again`;
  });
  check('L2: a merged body is CULLED BY ITS OWN BOUND, not by the world origin', async () => {
    /*
     * THE "MY TROOPS ARE INVISIBLE" BUG, and it is a culling bug rather than a
     * drawing one — which is exactly why nothing caught it. `_auditVisible` and
     * `_anyVisibleMesh` ask whether `mesh.visible` is true, and it always was.
     * The scene graph was right, the skin was bound, the material was fine, and
     * three simply never submitted the draw.
     *
     * The rig root is permanently identity at the world origin (the animator
     * writes the pelvis in WORLD space onto a bone beneath it), so a merged
     * SkinnedMesh parented to it has an identity matrixWorld — and its bake-time
     * bounding sphere was centred on (0,0,0) with a body-sized radius while the
     * vertices were eighty metres away. Every body between L2_LOD (62 m) and
     * L3_AT (137.8 m) vanished unless the camera happened to be looking at the
     * middle of the map. Past 137.8 m the cohort sets frustumCulled=false and
     * the body came back, which is why it read as a band rather than as "far
     * away things are gone".
     *
     * Measured 300 m off the origin so the origin is nowhere near the frustum —
     * that is the whole point, and a body tested AT the origin passes either
     * way. Both directions are asserted: the bound must follow the body, and it
     * must still cull when the camera turns round, or the fix is just
     * frustumCulled=false wearing a disguise.
     */
    const { initPhysics } = await import('../../src/physics/Rapier.js');
    await initPhysics();
    const { RapierWorld } = await import('../../src/physics/RapierWorld.js');
    const Foe = await import('../../src/game/Enemy.js');
    const { applyMergedSkin } = await import('../../src/game/MergedSkin.js');
    await import('../../src/game/Levels.js');

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

    const BX = 300, BZ = -80;                    // in the L2 band, far from the origin
    const cam = new THREE.PerspectiveCamera(70, 16 / 9, 0.1, 900);
    const frustum = new THREE.Frustum(), mm = new THREE.Matrix4();
    const aim = (z) => {
      cam.position.set(BX, 1.6, 0); cam.lookAt(BX, 1.6, z); cam.updateMatrixWorld(true);
      mm.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
      frustum.setFromProjectionMatrix(mm);
    };

    let tested = 0, seen = 0, hidden = 0, atOrigin = 0, bodies = 0;
    for (const type of ['trooper', 'b1', 'b2', 'conscript', 'sentinel', 'acolyte']) {
      if (!Foe.ARCHETYPES[type]) continue;
      const e = new Foe.Enemy(world, type, new THREE.Vector3(BX, 0, BZ));
      if (!e.rig) continue;
      e._applyLod(1);
      e.position.set(BX, 0, BZ);
      e.rig.root.updateMatrixWorld(true);
      applyMergedSkin(e, 2);                     // the bake (one body a frame)
      applyMergedSkin(e, 2);                     // …and the per-frame bound
      const L = e._l2;
      if (!L?.skin?.meshes?.length || !L.on) continue;
      bodies++;
      for (const m of L.skin.meshes) m.updateMatrixWorld(true);

      aim(-100);
      // what the original code did, restored afterwards
      const keep = L.skin.meshes.map((m) => m.boundingSphere.center.clone());
      for (const m of L.skin.meshes) m.boundingSphere.center.set(0, 0, 0);
      atOrigin += L.skin.meshes.filter((m) => frustum.intersectsObject(m)).length;
      L.skin.meshes.forEach((m, i) => m.boundingSphere.center.copy(keep[i]));

      tested += L.skin.meshes.length;
      seen += L.skin.meshes.filter((m) => frustum.intersectsObject(m)).length;
      aim(100);
      hidden += L.skin.meshes.filter((m) => frustum.intersectsObject(m)).length;
    }
    assert(bodies > 0, 'no archetype merged at all — the bake budget or the L2 band moved');
    assert(seen === tested,
      `${tested - seen} of ${tested} merged meshes were culled while the camera was pointed straight at them `
      + '— the bound is not following the body, which is the invisible-troops bug');
    assert(hidden === 0,
      `${hidden} of ${tested} merged meshes still drew with the camera turned away — the bound is not culling `
      + 'anything, which is frustumCulled=false in disguise');
    return `${tested} merged meshes over ${bodies} bodies: origin-centred ${atOrigin}/${tested} drawn, `
      + `body-centred ${seen}/${tested}, and ${hidden}/${tested} with the camera turned round`;
  });

}
