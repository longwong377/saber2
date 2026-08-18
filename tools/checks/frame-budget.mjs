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
import { OutlinePass } from '../../src/toon/Ink.js';
import { QUALITY } from '../../src/engine/Engine.js';
import { LEVELS, LEVEL_ORDER } from '../../src/game/Levels.js';

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
        assert(typeof row.fire === 'function', `stratagem '${row.id}' has no fire()`);
        for (const k of POOLS) tally[k] = 0;
        row.fire(ctx, at.clone(), S);
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
}
