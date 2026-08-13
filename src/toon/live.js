/**
 * SABER — the real game, on the meadow, cel-shaded.
 *
 * The first experiment (`toon.html`) shaded a hand-built scene and answered a
 * narrow question: what does a ramp do to the lighting. The verdict was "better,
 * still crude, and the ground barely changed", and both halves of that were
 * structural rather than tuning:
 *
 *   A RAMP CANNOT BAND A FLAT PLANE. That scene's ground was a flat circle, so
 *   its normal was (0,1,0) everywhere, so N·L was constant across the whole
 *   surface and it landed in exactly ONE band. Not "didn't" — couldn't.
 *
 *   AND THE GRASS WAS NEVER TOUCHED. `collectSwappable` converts
 *   MeshStandardMaterial and the grass is a hand-written ShaderMaterial, so on
 *   a level whose subject is a field the toon pass skipped the picture.
 *
 * So this file does the opposite of what that one did. It does not build a
 * scene: it BOOTS THE GAME — the real Engine with its bloom, ACES tonemap,
 * cascaded shadows, sky dome and aerial perspective; the real World on the real
 * `meadow`; the real terrain, GrassField, WindField, weather and painted
 * horizon ranges; and the real Player, with the real controls. Then it converts
 * what is already there.
 *
 * NOTE THE INVERSION: `Toon.js`'s header explains at length why `Engine.js`
 * must stay out of THAT page's import graph. Here it is imported deliberately.
 * That page was testing an alternative to the physical atmosphere; this one is
 * showing the game at full power with a different shading model on top, and
 * every effect Engine brings is part of the question.
 *
 * `index.html` and everything under src/game and src/engine are untouched.
 */

import * as THREE from 'three';
import { Engine } from '../engine/Engine.js';
import { Input } from '../engine/Input.js';
import { initPhysics } from '../physics/Rapier.js';
import { World } from '../game/World.js';
import { DIFFICULTY } from '../game/Combat.js';
import { DEFAULT_SETTINGS } from '../ui/Menu.js';
import { GrassField } from '../world/Scenery.js';
import { rampTexture, collectSwappable, applyShading, retargetRamp,
  OutlinePass, installBandedFog, installRim, bandAllGrass } from './Toon.js';

/**
 * How far off black the darkest band sits.
 *
 * A cel look whose shadow side is pure black loses every form cue in shade, and
 * on a level lit by a low raking sun — which is the meadow's whole silhouette —
 * roughly half of every hill is shade. 0.38 keeps the dark side readable as a
 * colour rather than as an absence.
 */
const TOON_DARK = 0.38;

export class LiveToon {
  constructor(canvas) {
    this.canvas = canvas;
    this.state = {
      mode: 'toon',        // 'pbr' | 'toon'
      bands: 4,
      softness: 0.0,
      grassBands: true,
      outline: true,
      outlineWidth: 1.6,
      creaseWidth: 0.7,
      outlineNormal: 0.7,
      outlineDepth: 0.5,
      bandedFog: true,
      rim: 0.10,
      hardShadows: true,
      grassCount: 26000,
    };
    /**
     * NO PALETTE OVERRIDE HERE, unlike the first experiment.
     *
     * That page invented three palettes because it had no world to take one
     * from. This one has the meadow's OWN authored atmosphere — its turbidity,
     * its 28° sun at 115° azimuth chosen so the light rakes across the swell
     * rather than along it, its sky and ground colours, its weather. Replacing
     * that with something of mine would be answering "can I art-direct a
     * scene" when the question is "what does THIS level look like stylised".
     */
    this._fogBands = { value: 4 };
    this._grassBands = { value: 4 };
    this._rim = { value: 0.10 };
    this._rimColor = { value: new THREE.Color(0xcfe8ff) };
    this.ready = false;
  }

  async build(onStep = () => {}) {
    const step = async (frac, msg, fn) => {
      onStep(frac, msg);
      await new Promise((r) => requestAnimationFrame(() => r()));
      return fn();
    };

    await step(0.05, 'starting the physics', () => {});
    await initPhysics();

    await step(0.25, 'lighting the sky', () => {
      /**
       * The real engine. `quality` is taken up rather than down on purpose —
       * the question this page exists to answer is what the look can be at full
       * power, so answering it at 'medium' would be answering a different one.
       */
      this.engine = new Engine(this.canvas, 'ultra');
      this.engine.setBloom(true);
      this.engine.setGrain(0);
      this.input = new Input(this.canvas);
    });

    await step(0.45, 'raising the hills', () => {
      /**
       * SANDBOX WITH NOTHING IN IT. `sandboxConfig` already clamps
       * `sandboxCount` at 0, so this is the whole living world — weather,
       * wind, grass, sky — with nothing shooting at you. That is exactly the
       * "small scene to look around in" this page is for, and it needed no new
       * mode to get it.
       *
       * Grass is pushed to its ceiling because the brief is that the ground
       * should not be visible at all.
       */
      this.settings = {
        ...DEFAULT_SETTINGS,
        level: 'meadow', quality: 'ultra', mode: 'sandbox',
        sandboxCount: 0, sandboxFire: 0,
        grassScale: 1.5, particleScale: 1.2, resolutionScale: 1,
        volume: 0, music: 0, firstPerson: false,
      };
      this.world = new World(this.engine, this.settings);
      this.world.difficulty = DIFFICULTY.knight;
      this.world.loadLevel('meadow');
      this._thickenGrass();
    });

    await step(0.7, 'walking in', () => {
      this.player = this.world.spawnPlayer({ name: 'Jedi', isLocal: true });
      this.player.camera.fov = this.settings.fov;
      this.player.camera.fovTarget = this.settings.fov;
    });

    await step(0.88, 'flattening the light', () => this._installToon());

    onStep(1, 'ready');
    this.ready = true;
    this.input.enabled = true;
    return this;
  }

  /**
   * "You shouldn't see the ground at all — just grass."
   *
   * The blade COUNT is fixed at `11000 * QUALITY[tier].grass`, and ultra's
   * factor is 1.5 — so even at the top tier the game draws 16,500 blades over
   * a 46 m radius, which is a field you can see the dirt through. The settings
   * expose `grassScale`, but that drives `density` (cover and ground tint), not
   * count, so no combination of the shipped knobs gets there.
   *
   * So the field is rebuilt: more blades, over a wider radius. This is an
   * experiment page asking what the look can be at full power, and the honest
   * answer to "the ground shows through" is more grass rather than a tint that
   * hides it. It is also a real finding for the game — if this direction is
   * taken, the meadow wants a higher count than the quality tiers allow.
   *
   * 26,000 is the DEFAULT rather than the ceiling, and the reason is recorded
   * because it is a limitation of the verification and not of the idea: the
   * headless boot check runs on SwiftShader, where 46,000 blades never reach a
   * first frame inside any sane timeout. So the default is a number that can be
   * checked, and the slider goes to 60,000 for real hardware. Do not raise the
   * default without re-running `tools/toon-smoke.mjs --page meadow.html`.
   */
  _thickenGrass(count = this.state.grassCount) {
    const w = this.world;
    if (!w?.terrain) return;
    const prev = w.grass;
    w.grass = new GrassField(this.engine.scene, w.terrain, {
      count: Math.round(count), density: 1.6, radius: 54,
      tintA: w.level?.grassTint?.[0], tintB: w.level?.grassTint?.[1],
    });
    prev?.dispose();
    // A rebuilt field is new materials, so the banding injection has to run
    // again — otherwise turning the slider silently un-stylises the grass.
    this.grassBanded = bandAllGrass(this.engine.scene, this._grassBands);
  }

  /** Rebuild the field at the current blade count, from the panel. */
  regrass() { this._thickenGrass(); }

  /* ── the toon layer, laid over a world that already exists ─────────── */

  _installToon() {
    this.ramp = rampTexture(this.state.bands, this.state.softness, TOON_DARK);
    this.outlines = new OutlinePass(this.engine.renderer,
      Math.max(2, this.canvas.width), Math.max(2, this.canvas.height));
    this.outlines.uniforms.uColor.value.setHex(0x14202c);
    this._convert();
    this._applyShadowStyle();
  }

  /**
   * Convert everything currently in the scene, and remember what was converted.
   *
   * MUST BE RE-RUNNABLE. `loadLevel` builds hundreds of materials, props spawn
   * and despawn, the grass rebuilds its own materials on an LOD change, and
   * bodies are constructed whenever something is spawned. A one-shot conversion
   * at boot would slowly fill the frame with un-flattened objects — so this is
   * called again on a timer, and `collectSwappable` is idempotent per mesh
   * because it stores the pair on the mesh's own record.
   */
  _convert() {
    const fresh = collectSwappable(this.engine.scene, this.ramp)
      .filter((s) => !s.mesh.userData.toonPaired);
    for (const s of fresh) {
      s.mesh.userData.toonPaired = s;
      const list = Array.isArray(s.toon) ? s.toon : [s.toon];
      for (const m of list) {
        if (!m?.isMeshToonMaterial) continue;
        installBandedFog(m, this._fogBands);
        installRim(m, this._rim, this._rimColor);
      }
    }
    this.swaps = (this.swaps || []).concat(fresh);
    applyShading(fresh, this.state.mode);
    // The grass is a ShaderMaterial and needs its own injection — see bandGrass.
    this.grassBanded = (this.grassBanded || 0) + bandAllGrass(this.engine.scene, this._grassBands);
    return fresh.length;
  }

  /**
   * Hard shadows, and shadows that are COLOURED rather than merely dark.
   *
   * The tint is done by lifting the hemisphere's ground colour toward a
   * saturated blue instead of by touching the shadow maths: a shadowed surface
   * is lit only by the sky term, so the sky term IS the shadow colour. That is
   * both physically the right lever and the one that needs no shader edit.
   */
  _applyShadowStyle() {
    if (!this.engine) return;
    const r = this.engine.renderer;
    r.shadowMap.type = this.state.hardShadows ? THREE.BasicShadowMap : THREE.PCFSoftShadowMap;
    r.shadowMap.needsUpdate = true;
    this.engine.scene.traverse((o) => {
      if (o.isLight && o.isHemisphereLight) {
        if (!o.userData.toonGround) o.userData.toonGround = o.groundColor.clone();
        if (this.state.mode === 'toon') o.groundColor.copy(o.userData.toonGround).lerp(new THREE.Color(0x3f6ea8), 0.55);
        else o.groundColor.copy(o.userData.toonGround);
      }
    });
  }

  /* ── controls ──────────────────────────────────────────────────────── */

  /**
   * The uniforms are ALWAYS updated, even before the world exists; only the
   * scene-touching half is skipped. The panel is in the DOM from the first
   * frame while the boot takes seconds, so a control can legitimately be used
   * before there is anything to shade — and the setting must still stick, or it
   * silently reverts the moment the world arrives.
   */
  setMode(mode) {
    this.state.mode = mode;
    this._grassBands.value = (mode === 'toon' && this.state.grassBands) ? this.state.bands : 0;
    this._fogBands.value = (mode === 'toon' && this.state.bandedFog) ? this.state.bands : 0;
    this._rim.value = mode === 'toon' ? this.state.rim : 0;
    if (!this.swaps) return;
    applyShading(this.swaps, mode);
    this._applyShadowStyle();
  }

  rebuildRamp() {
    if (!this.ramp) return;
    const old = this.ramp;
    this.ramp = rampTexture(this.state.bands, this.state.softness, TOON_DARK);
    retargetRamp(this.swaps, this.ramp);
    old?.dispose();
    this.setMode(this.state.mode);
  }

  /**
   * `Engine.resize()` takes NO arguments — it reads window.innerWidth/Height
   * itself and also has to re-pitch the EffectComposer's targets, which is why
   * it is not a two-liner and why this must not reimplement it.
   */
  setSize() {
    this.engine?.resize?.();
    const dpr = this.engine?.renderer?.getPixelRatio?.() ?? 1;
    this.outlines?.setSize(
      Math.max(2, Math.floor(window.innerWidth * dpr)),
      Math.max(2, Math.floor(window.innerHeight * dpr)));
  }

  /* ── frame ─────────────────────────────────────────────────────────── */

  /**
   * THE FRAME CONTRACT, and it is not optional.
   *
   * `Input` ACCUMULATES `mouse.dx/dy` from every mousemove event and clears
   * them in `end()`. It is a per-frame delta that gameplay consumes exactly
   * once — so a loop that reads it without ever calling `end()` does not read
   * "how far the mouse moved this frame", it reads "how far the mouse has moved
   * since the page opened", and applies that as a yaw every frame. The result
   * is a camera that spins faster and faster and cannot be stopped. That is
   * what shipped, and it made the page unusable.
   *
   * `end()` also clears `pressed` and `released`, so without it every one-shot
   * action — jump, attack, ignite — re-fires on every single frame.
   *
   * The ordering is copied from `main.js` (`input.begin` before `world.update`,
   * `input.end` after `engine.render`) rather than approximated, because the
   * two halves live in different methods here and the temptation to put `end()`
   * at the bottom of `update` is exactly how the render would come to read
   * already-cleared input.
   */
  update(dt) {
    if (!this.ready) return;
    this.input.begin(dt);
    this.world.update(dt, this.input);
    // Catch materials that appeared since the last sweep — see _convert.
    this._sweep = (this._sweep || 0) + dt;
    if (this._sweep > 1.0) { this._sweep = 0; this._convert(); applyShading(this.swaps, this.state.mode); }
  }

  render(dt) {
    if (!this.ready) return;
    const S = this.state;
    const o = this.outlines.uniforms;
    o.uWidth.value = S.outlineWidth;
    o.uCreaseWidth.value = S.creaseWidth;
    o.uNormalBias.value = S.outlineNormal;
    o.uDepthBias.value = S.outlineDepth;

    const lines = S.outline && S.mode === 'pbr' ? false : S.outline;
    /**
     * The prepass runs against the ENGINE'S scene and the PLAYER'S camera, and
     * it must happen before `engine.render` — which owns the composer, the
     * bloom and the tonemap. The lines are composited after, straight onto the
     * canvas, so they sit on top of the bloom rather than being bloomed
     * themselves. Ink that glows is not ink.
     */
    if (lines) this.outlines.prepass(this.engine.scene, this.engine.camera);
    this.engine.render(dt);
    if (lines) this.outlines.draw();
    // The other half of the frame contract — see `update`. Last, after the
    // render, exactly where main.js puts it.
    this.input.end();
  }

  /**
   * Drop whatever movement accumulated while the mouse was free.
   *
   * Called on a pointer-lock change. Without it, opening the Tab panel, moving
   * the cursor across the screen to reach a slider and then re-locking delivers
   * that whole traversal as one enormous yaw on the next frame — a small
   * version of the same bug, and the one a player would meet every time they
   * touched a control.
   */
  flushLook() {
    if (!this.input) return;
    this.input.mouse.dx = 0;
    this.input.mouse.dy = 0;
    this.input.mouse.wheel = 0;
  }
}
