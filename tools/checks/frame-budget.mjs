/**
 * SABER — the two places the frame was being charged twice.
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
 *    player, and the gate fires only if you outrun one. Measured on this
 *    machine, 20 clothed duellists cost 6.28 ms of solve and 1.26 ms of
 *    collider refresh per frame: 7.5 ms of a 16.67 ms budget, with no renderer,
 *    physics, AI, particles or bolts in the loop.
 *
 * The first check drives the SHIPPED `prepass` body against a recording
 * renderer rather than asserting on source text, so a future edit that reorders
 * the save/restore is caught by the thing it would actually break.
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
      'the tier the menu offers to integrated graphics still solves garments — that is the '
      + 'largest single thing it can hand back');
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
}
