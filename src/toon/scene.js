/**
 * The cel-shading test scene.
 *
 * Built from the game's own code so the comparison means something: a real
 * `buildJedi` body with real cloth, a real ignited `Saber`, a real B1, and
 * ground and rocks using the real procedural PBR maps. See the header of
 * Toon.js for why `src/engine/Engine.js` is deliberately not imported.
 */

import * as THREE from '../../vendor/three/three.module.js';
import { buildJedi, buildB1, ROBE_COLORS } from '../game/Bodies.js';
import { BipedAnimator } from '../game/Rig.js';
import { Saber } from '../game/Saber.js';
import { attachCloak, attachSkirt } from '../game/Cloth.js';
import { soilMaps, rockMaps } from '../engine/Textures.js';
import { clamp, TAU } from '../engine/MathUtil.js';
import { rampTexture, collectSwappable, applyShading, retargetRamp,
  OutlinePass, PALETTES, installBandedFog } from './Toon.js';

const UP = new THREE.Vector3(0, 1, 0);
const _v1 = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3();

/**
 * A LINEAR multiplier, not a colour. Same helper as Props.js:78, and the same
 * reason — with ColorManagement enabled `new THREE.Color(hex)` performs an
 * sRGB→linear conversion, which is right for a colour and wrong for a factor
 * that multiplies an already-linear albedo map.
 */
const lit = (r, g, b) => new THREE.Color().setRGB(r, g, b, THREE.LinearSRGBColorSpace);

export class ToonScene {
  constructor(canvas) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(46, 1, 0.1, 400);

    // orbit state, driven from main.js
    // Pitch 0.22 rad put the eye 2.4 m up and the horizon through the middle of
    // the frame, which reads as standing in a field rather than looking at a
    // subject. 0.42 is roughly a three-quarter view: enough ground under the
    // feet to show the shadow and the ramp terminator on a horizontal surface,
    // which is half of what there is to judge here.
    this.orbit = { yaw: 0.6, pitch: 0.42, dist: 6.0, target: new THREE.Vector3(0, 1.0, 0) };

    this.state = {
      mode: 'toon',          // 'pbr' | 'toon' | 'wipe'
      wipe: 0.5,
      bands: 3,
      softness: 0.0,
      outline: true,
      outlineWidth: 1.4,
      outlineNormal: 0.62,
      outlineDepth: 0.55,
      bandedFog: true,
      palette: 'temple',
      walking: true,
      spin: true,
    };

    this._fogBands = { value: 3 };
    this.ramp = rampTexture(this.state.bands, this.state.softness, PALETTES.temple.dark);
    this.outlines = new OutlinePass(this.renderer, 2, 2);
    this.time = 0;
    this.ready = false;
  }

  /**
   * Build the scene, YIELDING BETWEEN STEPS.
   *
   * Not a constructor, and not synchronous, because the honest cost of using
   * the game's real assets is that this blocks: `rockMaps` alone is a 2.1 s
   * 1024² bake and the soil map is another half second, before any body is
   * built. Done in one synchronous lump the page is a white rectangle for
   * several seconds and looks broken — which is exactly why `main.js` runs its
   * own warm-up as awaited steps behind a loading screen.
   *
   * `onStep` is handed a 0..1 fraction and a label so the page can say what it
   * is doing. The `requestAnimationFrame` await is what actually lets the
   * browser paint between steps; a bare `await` on an already-resolved promise
   * would not.
   */
  async build(onStep = () => {}) {
    const steps = [
      ['lighting the set', () => this._buildLights()],
      ['baking soil and rock', () => this._buildGround()],
      ['building a Jedi', () => this._buildJedi()],
      ['weaving the cloak', () => this._buildCloth()],
      ['assembling a B1', () => this._buildDroid()],
      ['flattening the light', () => this._buildSwaps()],
    ];
    for (let i = 0; i < steps.length; i++) {
      onStep(i / steps.length, steps[i][0]);
      await new Promise((r) => requestAnimationFrame(() => r()));
      steps[i][1]();
    }
    this.applyPalette('temple');
    onStep(1, 'ready');
    this.ready = true;
    return this;
  }

  _buildSwaps() {
    this.swaps = collectSwappable(this.scene, this.ramp);
    // Banded fog is a toon-side concern only; the PBR side keeps three's own
    // so the A/B compares like with like on the shading and not on the fog.
    for (const s of this.swaps) {
      const list = Array.isArray(s.toon) ? s.toon : [s.toon];
      for (const m of list) if (m?.isMeshToonMaterial) installBandedFog(m, this._fogBands);
    }
    applyShading(this.swaps, this.state.mode === 'pbr' ? 'pbr' : 'toon');
  }

  /* ── contents ──────────────────────────────────────────────────────── */

  _buildLights() {
    this.key = new THREE.DirectionalLight(0xfff2d8, 2.6);
    this.key.position.set(4.5, 7.5, 3.2);
    this.key.castShadow = true;
    this.key.shadow.mapSize.set(2048, 2048);
    const c = this.key.shadow.camera;
    c.left = -9; c.right = 9; c.top = 9; c.bottom = -9; c.near = 0.5; c.far = 34;
    this.key.shadow.bias = -0.0009;
    this.scene.add(this.key, this.key.target);

    this.fill = new THREE.HemisphereLight(0x9fc4e8, 0x40332a, 0.85);
    this.scene.add(this.fill);
  }

  _buildGround() {
    /**
     * The real soil bake — so "the ORM half becomes decorative under a ramp" is
     * something you can see rather than something I asserted.
     *
     * The tint is a LINEAR multiplier via `lit()`, copied from Props.js, and the
     * first version of this line was a bug worth recording: it tried
     * `new THREE.Color(hex).multiplyScalar(1 / MEAN_ALBEDO.soil)` — but
     * MEAN_ALBEDO entries are RGB TRIPLES, not scalars, so `1 / [0.389,…]` is
     * NaN and the whole ground rendered pure black. It read as "the lights are
     * broken" in a screenshot, which is why the fix came from dumping the live
     * material rather than from staring at the render.
     *
     * `setRGB(..., LinearSRGBColorSpace)` is the point of `lit`: with
     * ColorManagement on, `new THREE.Color(hex)` converts sRGB→linear, and a
     * multiplier is not a colour — it must not be converted.
     */
    const maps = soilMaps(9);
    const groundMat = new THREE.MeshStandardMaterial({
      // Against soil's 0.389 mean this lands near 0.16/0.20/0.13 linear — damp
      // earth under grass. The first pass at 1.35/1.55/1.20 gave 0.53 and read
      // as cracked white playa, which is a fine surface and not this one.
      ...maps, color: lit(0.42, 0.52, 0.34), roughness: 1, metalness: 0,
    });
    const g = new THREE.Mesh(new THREE.CircleGeometry(26, 64).rotateX(-Math.PI / 2), groundMat);
    g.receiveShadow = true;
    this.scene.add(g);

    // A few rocks, for hard silhouettes against the soft ones.
    // Rock's mean albedo is much darker than soil's (0.11/0.08/0.06 against
    // 0.389 flat), so it needs a far bigger multiplier to sit beside it —
    // exactly the reasoning Props.js works through for its own boulders.
    const rmaps = rockMaps(2);
    const rockMat = new THREE.MeshStandardMaterial({
      ...rmaps, color: lit(2.4, 2.3, 2.2), roughness: 1, metalness: 0,
    });
    // Pushed out and shrunk: the first arrangement put a 0.85 m boulder 3 m
    // behind the Jedi, where it read as a wall growing out of their shoulder.
    const place = [[-4.4, 0, -3.6, 0.62], [4.6, 0, -2.4, 0.44], [2.9, 0, 4.4, 0.34],
      [-5.6, 0, 2.4, 0.28], [0.6, 0, -6.4, 0.86]];
    for (const [x, , z, s] of place) {
      const r = new THREE.Mesh(new THREE.IcosahedronGeometry(s, 1), rockMat);
      // flatten and jitter so they read as boulders, not as balls
      r.scale.set(1, 0.72 + Math.random() * 0.3, 1);
      r.position.set(x, s * 0.5, z);
      r.rotation.set(Math.random(), Math.random() * TAU, Math.random());
      r.castShadow = true; r.receiveShadow = true;
      this.scene.add(r);
    }
  }

  _buildJedi() {
    const built = buildJedi({ robeIndex: 1, species: 'human', scale: 1 });
    this.rig = built.rig;
    this.rig.root.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    this.scene.add(this.rig.root);
    this.animator = new BipedAnimator(this.rig, { scale: 1, hipHeight: 0.95 });

    this.saber = new Saber(this.scene, { colorIndex: 1, bladeLength: 1.15, hiltStyle: 'Guardian' });
    this.saber.ignite();
    this.saber.ignition = 1;

    this.jedi = { pos: new THREE.Vector3(0, 0, 0), facing: 0, vel: new THREE.Vector3() };
    this.hiltPos = new THREE.Vector3();
    this.hiltQuat = new THREE.Quaternion();
  }

  /** Real cloth, because a ramp across a moving cape is most of the question. */
  _buildCloth() {
    this.cloak = attachCloak(this.scene, this.rig, { scale: 1, colorIndex: 1 });
    this.skirt = attachSkirt(this.scene, this.rig, { scale: 1, colorIndex: 1 });
  }

  _buildDroid() {
    const b1 = buildB1({ scale: 1 });
    this.b1 = b1.rig;
    this.b1.root.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    // Beside the Jedi rather than behind the camera: the point of the droid is
    // a hard-surface material next to skin and cloth IN THE SAME FRAME, and at
    // (2.6, 1.2) it spent most of the orbit off the bottom of the screen.
    this.b1.root.position.set(1.9, 0, -1.5);
    this.b1.root.rotation.y = -2.5;
    this.scene.add(this.b1.root);
    this.b1.updateMatrices?.();
  }

  /* ── controls ──────────────────────────────────────────────────────── */

  applyPalette(key) {
    const p = PALETTES[key] || PALETTES.temple;
    this.state.palette = key;
    this.key.color.setHex(p.key); this.key.intensity = p.keyI;
    this.fill.color.setHex(p.sky); this.fill.intensity = p.fillI;
    this.fill.groundColor.setHex(p.ground);
    this.scene.background = new THREE.Color(p.sky);
    this.scene.fog = new THREE.Fog(p.fog, p.fogNear, p.fogFar);
    this.outlines.uniforms.uColor.value.setHex(p.line);
    this.rebuildRamp();
  }

  rebuildRamp() {
    const p = PALETTES[this.state.palette] || PALETTES.temple;
    const old = this.ramp;
    this.ramp = rampTexture(this.state.bands, this.state.softness, p.dark);
    retargetRamp(this.swaps, this.ramp);
    old?.dispose();
  }

  setSize(w, h) {
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    const dpr = this.renderer.getPixelRatio();
    this.outlines.setSize(Math.floor(w * dpr), Math.floor(h * dpr));
  }

  /* ── frame ─────────────────────────────────────────────────────────── */

  update(dt) {
    if (!this.ready) return;
    this.time += dt;
    const S = this.state;

    // A slow walk in a circle: the gait, the cloth and the ramp terminator all
    // need motion to be judged, and a T-pose flatters everything.
    const j = this.jedi;
    if (S.walking) {
      const w = 0.42;
      j.facing += w * dt;
      const speed = 1.35;
      j.vel.set(Math.sin(j.facing), 0, Math.cos(j.facing)).multiplyScalar(speed);
      j.pos.addScaledVector(j.vel, dt);
      const r = Math.hypot(j.pos.x, j.pos.z);
      if (r > 2.6) j.pos.multiplyScalar(2.6 / r);
    } else j.vel.set(0, 0, 0);

    this.animator.setFacing(j.facing);
    this.animator.update(dt, {
      position: j.pos, facing: j.facing, velocity: j.vel,
      grounded: true, groundAt: () => 0, crouch: 0,
      accelForward: clamp(j.vel.length() / 6, 0, 1),
    });

    // A slow guard sweep so the blade moves through the frame and the trail and
    // the bloom-adjacent emissive have something to do.
    const chest = this.rig.worldPos('chest', _v1);
    const sway = Math.sin(this.time * 0.9) * 0.55;
    const right = _v2.set(Math.cos(j.facing), 0, -Math.sin(j.facing));
    this.hiltPos.copy(chest)
      .addScaledVector(right, 0.42 + sway * 0.25)
      .addScaledVector(UP, -0.12 + Math.cos(this.time * 1.3) * 0.16)
      .addScaledVector(_v3.set(Math.sin(j.facing), 0, Math.cos(j.facing)), 0.34);
    const e = new THREE.Euler(-0.5 + sway * 0.5, j.facing + sway, 0.3, 'YXZ');
    this.hiltQuat.setFromEuler(e);

    const poleR = _v3.copy(chest).addScaledVector(right, 0.75).addScaledVector(UP, -0.75);
    this.rig.solveIK('armR', 'foreR', this.hiltPos, poleR);
    const poleL = _v3.copy(chest).addScaledVector(right, -0.62).addScaledVector(UP, -0.8);
    this.rig.solveIK('armL', 'foreL', _v1.copy(this.hiltPos).addScaledVector(UP, -0.06), poleL);
    this.rig.updateMatrices();

    this.saber.setHiltPose(this.hiltPos, this.hiltQuat);
    this.saber.update(dt, this.time);

    /**
     * The cloth, driven exactly as Player.js drives it.
     *
     * SKIRT FIRST, and that ordering is load-bearing rather than cosmetic: the
     * cape's collider proxy is the skirt's own particles, so stepping the cape
     * first would have it dodging where the skirt was LAST frame. Copied from
     * Player._updateCloth for the same reason the rest of this scene is copied
     * — a demo that poses the cloth differently from the game is not a demo of
     * the game's cloth.
     */
    _v1.set(Math.sin(this.time * 0.31) * 1.6, 0, Math.cos(this.time * 0.53) * 1.1);
    this.skirt?.update(dt, this.skirt.refreshColliders(), _v1);
    this.cloak?.update(dt, this.cloak.refreshColliders(), _v1);

    // camera
    if (S.spin) this.orbit.yaw += dt * 0.11;
    const o = this.orbit;
    const cp = Math.cos(o.pitch), sp = Math.sin(o.pitch);
    this.camera.position.set(
      o.target.x + Math.sin(o.yaw) * o.dist * cp,
      o.target.y + o.dist * sp,
      o.target.z + Math.cos(o.yaw) * o.dist * cp);
    this.camera.lookAt(o.target);
    this.key.target.position.copy(o.target);
    this.key.target.updateMatrixWorld();
  }

  render() {
    if (!this.ready) return;
    const S = this.state;
    this._fogBands.value = S.bandedFog ? Math.max(2, S.bands) : 0;
    const o = this.outlines.uniforms;
    o.uWidth.value = S.outlineWidth;
    o.uNormalBias.value = S.outlineNormal;
    o.uDepthBias.value = S.outlineDepth;

    if (S.mode === 'wipe') {
      // ONE FRAME, TWO SHADINGS. Scissor is the honest way to do this: both
      // halves are the same scene at the same instant from the same camera, so
      // the only difference on screen is the thing under test.
      const size = new THREE.Vector2();
      this.renderer.getSize(size);
      const x = Math.floor(size.x * S.wipe);

      if (S.outline) this.outlines.prepass(this.scene, this.camera);

      this.renderer.setScissorTest(true);
      applyShading(this.swaps, 'pbr');
      this.renderer.setScissor(0, 0, x, size.y);
      this.renderer.setViewport(0, 0, size.x, size.y);
      this.renderer.render(this.scene, this.camera);

      applyShading(this.swaps, 'toon');
      this.renderer.setScissor(x, 0, size.x - x, size.y);
      this.renderer.autoClear = false;
      this.renderer.render(this.scene, this.camera);
      // The line pass is a fullscreen quad, but the scissor is still set to the
      // toon half — so it inks that side only, which is what makes the divider
      // read as a comparison rather than as a filter over both.
      if (S.outline) this.outlines.draw();
      this.renderer.autoClear = true;
      this.renderer.setScissorTest(false);
      return;
    }

    /**
     * OUTLINES BELONG TO THE TOON PATH. The headline toggle says "PBR (today)",
     * and today's game has no outlines — drawing them on that side made the
     * comparison dishonest in the direction that flatters the thing being
     * proposed, which is the worst direction for it to be wrong in. The
     * checkbox still turns them off; it cannot turn them on over PBR.
     */
    applyShading(this.swaps, S.mode);
    const lines = S.outline && S.mode !== 'pbr';
    if (lines) this.outlines.prepass(this.scene, this.camera);
    this.renderer.render(this.scene, this.camera);
    if (lines) this.outlines.draw();
  }
}
