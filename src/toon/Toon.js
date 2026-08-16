/**
 * BATTLEFRONT BORZ — a stylised render path, as an experiment.
 *
 * ── SUPERSEDED. READ src/toon/Cel.js INSTEAD. ─────────────────────────────
 *
 * The game is cel shaded now, and it is not shaded by this file. This one
 * SWAPS MATERIALS, and the verdict on it was "there will be PBR leftovers
 * everywhere" — correctly, because a sweep over MeshStandardMaterial cannot
 * reach a material carrying an onBeforeCompile (the terrain, i.e. most of the
 * frame), cannot reach a hand-written ShaderMaterial (the grass, the water, the
 * sky dome), and cannot reach anything built after it runs (a severed limb, a
 * fractured chunk). src/toon/Cel.js rewrites three's BRDF chunks instead, once,
 * so every material in the build is cel shaded including the ones that do not
 * exist yet.
 *
 * This file is kept because `toon.html` is still the A/B page and because the
 * four bugs written up in OutlinePass below — the inked sky, the inked cloud
 * rectangles, the inked saber quad and the grass stipple — are the record of
 * how the ink in src/toon/Ink.js came to have the four exclusions it has. Read
 * it as a lab notebook, not as the renderer.
 *
 * ──────────────────────────────────────────────────────────────────────────
 *
 * This is NOT wired into the game. It exists so the question "should this game
 * be cel-shaded?" can be answered by looking at the real thing rather than by
 * arguing about it, and it is deliberately additive: nothing under src/game or
 * src/engine changes, and `toon.html` is a separate page.
 *
 * ── WHAT IS REAL HERE ──────────────────────────────────────────────────────
 *
 * The scene is built from the game's own code — `buildJedi`, `buildB1`, the
 * real `Saber`, the real `Rig`/`BipedAnimator`, the real cloth and the real
 * procedural PBR materials out of `Textures.js`. That matters: a generic toon
 * demo proves nothing about whether THIS game's geometry, silhouettes and
 * surfaces survive being flattened. These are the actual bodies.
 *
 * It is also why `src/engine/Engine.js` is NOT imported anywhere in this
 * folder. Engine rewrites three's fog ShaderChunks as a module side effect
 * behind a once-only flag (see `installAerialPerspective`), so importing it
 * here would drag the game's physical height-stratified extinction into a page
 * whose whole purpose is to try a stylised alternative. Bodies.js, Saber.js,
 * Rig.js and Cloth.js each import only THREE, Textures and MathUtil, so the
 * bodies come across without the atmosphere.
 *
 * ── THE THREE PIECES OF A CEL LOOK ─────────────────────────────────────────
 *
 * People say "cel shading" and mean at least three separable things, and the
 * demo separates them because they are worth judging separately:
 *
 *   BANDED LIGHT   the diffuse response quantised through a ramp instead of a
 *                  smooth Lambert falloff. This is `toonMaterial` below.
 *   OUTLINES       see `OutlinePass`. Screen-space, not inverted hull, and the
 *                  reason why is specific to this game — read the note there.
 *   FLAT DISTANCE  banded fog instead of physical extinction, so depth reads as
 *                  a few discrete plates rather than a continuous gradient.
 *
 * Any one of them alone reads as a filter. Together they read as a style, and
 * that is the whole argument for committing rather than half-measuring.
 */

import * as THREE from 'three';

/* ══════════════════════════════════════════════════════════════════════ */
/*  The ramp                                                              */
/* ══════════════════════════════════════════════════════════════════════ */

/**
 * A gradient map for MeshToonMaterial: N·L is looked up in this 1-D texture.
 *
 * `NearestFilter` is the entire trick. With LinearFilter three interpolates
 * between the steps and you get a smooth gradient with extra maths — which is
 * exactly the "uncanny middle" failure, a realistic falloff wearing a toon
 * costume. Nearest gives hard terminators, which is what the eye reads as
 * drawn rather than lit.
 *
 * `softness` re-introduces a controlled amount of blend, but as a WIDTH ON THE
 * STEP rather than as filtering: each band still has a flat interior and the
 * transition is a narrow authored ramp. That is how a hand-painted ramp behaves
 * and it is not the same thing as turning the filter back on.
 */
export function rampTexture(bands = 3, softness = 0, dark = 0.34) {
  const N = 256;
  const data = new Uint8Array(N * 4);
  const edge = Math.max(1e-4, softness) * (0.5 / bands);
  for (let i = 0; i < N; i++) {
    const t = i / (N - 1);
    // which band, and how far into its transition
    const s = t * bands;
    const idx = Math.min(bands - 1, Math.floor(s));
    let v = idx / Math.max(1, bands - 1);
    if (softness > 0) {
      const frac = s - idx;
      const w = edge * bands;
      if (frac < w && idx > 0) {
        const prev = (idx - 1) / Math.max(1, bands - 1);
        v = prev + (v - prev) * (frac / w);
      }
    }
    // `dark` lifts the darkest band off black: a cel look with a pure black
    // shadow side loses every form cue in shadow, and every good stylised game
    // keeps the dark band as a saturated colour rather than an absence.
    const lit = dark + (1 - dark) * v;
    const b = Math.round(lit * 255);
    data[i * 4] = b; data[i * 4 + 1] = b; data[i * 4 + 2] = b; data[i * 4 + 3] = 255;
  }
  const tex = new THREE.DataTexture(data, N, 1, THREE.RGBAFormat);
  tex.minFilter = THREE.NearestFilter;
  tex.magFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  return tex;
}

/* ══════════════════════════════════════════════════════════════════════ */
/*  Material conversion                                                   */
/* ══════════════════════════════════════════════════════════════════════ */

/**
 * A toon twin of a MeshStandardMaterial, keeping everything worth keeping.
 *
 * WHAT CARRIES OVER: `map` and `normalMap`.
 *
 * AND `normalMap` IS A LIE IN THE SHIPPED GAME, WHICH THIS FILE IS NOT. This
 * paragraph used to read "the normal map is why the procedural surfaces still
 * read at all — it perturbs the N used for the ramp lookup, so a soil map's
 * crumb structure still breaks the terminator into something with texture
 * rather than a flat plate". That was true of the ramp prototype this file IS,
 * and it is false of what shipped: src/engine/Textures.js binds
 * `normalMap: null` on every surface (see materialFrom), because a detail
 * normal under the two-tone terminator of src/toon/Cel.js produces speckle
 * rather than relief — the same measurement TER_RELIEF records for the
 * terrain. Nothing in the frame perturbs N any more.
 *
 * It is left carried over here because this file is the RECORD of the rejected
 * approach and has to keep working as one; a reader arriving from Cel.js should
 * know that `src.normalMap` is null for every material the foundry hands out,
 * so the line below is a no-op on anything the game builds today.
 *
 * WHAT DOES NOT: `roughnessMap` and `metalnessMap`. A toon ramp has no GGX
 * lobe to roughen. That is a real cost of this direction and worth being honest
 * about — `materialFrom` bakes a packed ORM map for every surface in the game,
 * and under this path most of that work becomes decorative. The demo keeps the
 * ORM bake alive only so the PBR side of the A/B is the genuine article.
 */
export function toonMaterial(src, ramp) {
  const m = new THREE.MeshToonMaterial({
    color: src.color ? src.color.clone() : new THREE.Color(0xffffff),
    map: src.map || null,
    normalMap: src.normalMap || null,
    normalScale: src.normalScale ? src.normalScale.clone() : new THREE.Vector2(1, 1),
    gradientMap: ramp,
    transparent: src.transparent,
    opacity: src.opacity ?? 1,
    side: src.side,
    vertexColors: src.vertexColors,
    alphaTest: src.alphaTest ?? 0,
    emissive: src.emissive ? src.emissive.clone() : new THREE.Color(0x000000),
    emissiveIntensity: src.emissiveIntensity ?? 1,
  });
  m.userData.toonOf = src;
  // Marks this as OURS, so the rim/fog extensions we add below are not later
  // mistaken by `hasCustomShader` for pre-existing work we must not replace.
  m.userData.toonOwned = true;
  return m;
}

/**
 * Walk a subtree and swap every standard material for a toon twin, keeping the
 * originals so the A/B toggle is instant and lossless.
 *
 * Materials the demo must NOT touch: anything with its own ShaderMaterial. The
 * blade, its trail and the grass are hand-written shaders, and replacing them
 * would be replacing the thing under test rather than shading it. The saber in
 * particular is emissive by construction and is supposed to stay exactly as it
 * is — the claim being tested is that it reads BETTER against flattened
 * surroundings, which can only be checked if it is unchanged.
 */
export function collectSwappable(root, ramp) {
  const swaps = [];
  root.traverse((o) => {
    if (!o.material) return;
    const list = Array.isArray(o.material) ? o.material : [o.material];
    const toon = [];
    let any = false;
    for (const m of list) {
      if (m && m.isMeshStandardMaterial && !hasCustomShader(m)) {
        toon.push(toonMaterial(m, ramp)); any = true;
      } else toon.push(m);
    }
    if (any) swaps.push({ mesh: o, pbr: o.material, toon: Array.isArray(o.material) ? toon : toon[0] });
  });
  return swaps;
}

/**
 * Does this material carry shader work a straight swap would throw away?
 *
 * MEASURED THE HARD WAY. The terrain is a `MeshStandardMaterial` with an
 * `onBeforeCompile` that blends TWO map sets — soil against rock, by slope and
 * height (`Terrain.js`). Converting it to a plain `MeshToonMaterial` kept the
 * colour and the first map and silently dropped the blend, and the meadow's
 * ground rendered blown-out white while the PBR side of the same frame looked
 * correct.
 *
 * So the rule is: a material that has been extended is not swappable, because
 * the swap is not a conversion — it is a replacement, and a replacement loses
 * whatever the extension was for. Those materials stay PBR. Banding them
 * properly means injecting into the shader they already have, the way
 * `bandGrass` does, which is per-material work and not a sweep.
 */
export function hasCustomShader(m) {
  return typeof m.onBeforeCompile === 'function'
    && m.onBeforeCompile !== THREE.Material.prototype.onBeforeCompile
    && !m.userData.toonOwned;
}

/**
 * Point every collected mesh at one side of the A/B.
 *
 * Tolerates a missing list on purpose: on the live page the controls exist
 * before the world does — the panel is in the DOM from the first frame and the
 * boot takes seconds — so a click can legitimately arrive before there is
 * anything to shade. Throwing there would be a crash caused by the user being
 * quick.
 */
export function applyShading(swaps, mode) {
  if (!swaps) return;
  for (const s of swaps) s.mesh.material = mode === 'toon' ? s.toon : s.pbr;
}

/** Re-point every toon material at a freshly built ramp. */
export function retargetRamp(swaps, ramp) {
  if (!swaps) return;
  for (const s of swaps) {
    const list = Array.isArray(s.toon) ? s.toon : [s.toon];
    for (const m of list) if (m && m.isMeshToonMaterial) { m.gradientMap = ramp; m.needsUpdate = true; }
  }
}

/* ══════════════════════════════════════════════════════════════════════ */
/*  Outlines                                                              */
/* ══════════════════════════════════════════════════════════════════════ */

/**
 * SCREEN-SPACE EDGE DETECTION, AND WHY NOT INVERTED HULL.
 *
 * The default instinct for toon outlines is the inverted hull: draw the mesh
 * again, backfaces only, scaled along its normals. It is cheap, it is per-object
 * and it gives lovely tapering lines. It is also the wrong choice for THIS game,
 * for two reasons that are specific rather than stylistic:
 *
 *   THIS GAME CUTS PEOPLE APART. Every severed limb becomes a NEW mesh at
 *   runtime (see Slice.js and Ragdoll.js), so every one of them would need its
 *   own hull built on the frame it is created — and the cut cap, a flat disc of
 *   fresh geometry with normals pointing along the blade, outlines in a way
 *   that reads as a bright rim rather than an edge.
 *
 *   THE FIELD IS INSTANCED. Eleven thousand grass blades, thousands of chips
 *   and debris. A hull pass doubles all of it.
 *
 * A depth+normal edge detect handles both for free: dismemberment needs no
 * special case because the pass never knows what an object is, and the cost is
 * one fullscreen shader regardless of how much is on screen. It also gives
 * UNIFORM line weight in screen space, which is what reads as ink rather than
 * as a rim light.
 *
 * The trade is that it cannot vary line weight per object, and it finds edges
 * inside a silhouette (creases) as well as around it. Both are visible in the
 * demo — the normal-sensitivity slider is exactly the crease control.
 */
/**
 * Is this material's drawn silhouette something other than its geometry?
 *
 * If so it cannot appear in the outline prepass, because `overrideMaterial`
 * replaces it with `MeshNormalMaterial` — which has no alpha map, no alpha test
 * and no blend, and therefore draws a fully opaque copy of whatever quad the
 * thing happens to live on. See the note in `OutlinePass.prepass`.
 *
 * Cached on the material, because the `discard` test reads shader source and
 * this runs for every object every frame.
 */
function cutsItsOwnSilhouette(m) {
  // Explicitly excluded — see `noOutline`.
  if (m.userData._toonNoOutline) return true;
  if (m.userData._toonCut !== undefined) return m.userData._toonCut;
  const cut = !!(m.transparent || m.alphaTest > 0
    || m.blending === THREE.AdditiveBlending
    || (typeof m.fragmentShader === 'string' && m.fragmentShader.indexOf('discard') >= 0));
  m.userData._toonCut = cut;
  return cut;
}

/**
 * Never ink this material.
 *
 * THE GRASS, and this is a design finding rather than a workaround. A field is
 * tens of thousands of thin blades: every one of them is a genuine silhouette,
 * so a screen-space edge detector finds an edge on all of them, and at any
 * distance where a blade is about a pixel wide the result is a band of black
 * stipple across the middle of the frame. It looked like a bug in the shader
 * and is not — it is the effect working exactly as specified on input it should
 * never have been given.
 *
 * The reference games do not outline grass either. Ink goes on things that read
 * as FORMS — figures, rocks, architecture — and not on things that read as
 * texture. That distinction has to be authored; it cannot be derived.
 */
export function noOutline(material) {
  if (!material) return;
  for (const m of (Array.isArray(material) ? material : [material])) {
    if (m) m.userData._toonNoOutline = true;
  }
}

export class OutlinePass {
  constructor(renderer, width, height) {
    this.renderer = renderer;
    /**
     * A normal+depth target. `MeshNormalMaterial` writes view-space normals to
     * RGB, and the depth texture comes along for free — two buffers out of one
     * pass, which is why this is affordable at all.
     */
    this.target = new THREE.WebGLRenderTarget(width, height, {
      minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter,
      type: THREE.UnsignedByteType, depthBuffer: true,
    });
    this.target.depthTexture = new THREE.DepthTexture(width, height);
    this.target.depthTexture.type = THREE.UnsignedShortType;

    this.normalMat = new THREE.MeshNormalMaterial();

    this.uniforms = {
      tNormal: { value: this.target.texture },
      tDepth: { value: this.target.depthTexture },
      uTexel: { value: new THREE.Vector2(1 / width, 1 / height) },
      uWidth: { value: 1.4 },
      /**
       * A SECOND, NARROWER WIDTH FOR CREASES.
       *
       * One uniform line weight is most of why the first pass read as
       * "flat-shaded 3D" rather than "drawn". Ink varies: heavy on the
       * silhouette, light on interior folds. The two terms were already
       * computed separately here — the depth Sobel finds silhouettes, the
       * normal Sobel finds creases — so giving them their own sample radius is
       * nearly free and is the difference between a wireframe and a drawing.
       */
      uCreaseWidth: { value: 0.7 },
      uDepthBias: { value: 0.55 },
      uNormalBias: { value: 0.62 },
      uColor: { value: new THREE.Color(0x0b1018) },
      uNear: { value: 0.1 },
      uFar: { value: 400 },
      uOpacity: { value: 1 },
    };

    this.quad = new THREE.Mesh(
      new THREE.PlaneGeometry(2, 2),
      new THREE.ShaderMaterial({
        uniforms: this.uniforms,
        transparent: true,
        depthTest: false,
        depthWrite: false,
        vertexShader: /* glsl */`
          varying vec2 vUv;
          void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
        `,
        fragmentShader: /* glsl */`
          uniform sampler2D tNormal;
          uniform sampler2D tDepth;
          uniform vec2  uTexel;
          uniform float uWidth, uCreaseWidth, uDepthBias, uNormalBias, uOpacity, uNear, uFar;
          uniform vec3  uColor;
          varying vec2 vUv;

          // Depth is non-linear in the buffer, so a raw difference finds edges
          // near the camera and nothing at all in the distance. Linearising is
          // what makes one bias value work across the whole scene.
          float linear(vec2 uv) {
            float z = texture2D(tDepth, uv).x * 2.0 - 1.0;
            return (2.0 * uNear * uFar) / (uFar + uNear - z * (uFar - uNear));
          }

          void main() {
            vec2 o = uTexel * uWidth;
            // NOTHING IN EMPTY SKY. The prepass clears to the far plane, so a
            // pixel at (or beyond) 1.0 has no geometry in it and cannot have an
            // edge — and without this test it gets one, because the Sobel below
            // is only meaningful where something was drawn.
            if (texture2D(tDepth, vUv).x >= 0.9999) discard;
            // Sobel-ish 4-tap cross. A full 8-tap Sobel is prettier on
            // diagonals and twice the cost; at a 1-2 px line weight the cross
            // is indistinguishable.
            float dC = linear(vUv);
            float dL = linear(vUv - vec2(o.x, 0.0));
            float dR = linear(vUv + vec2(o.x, 0.0));
            float dD = linear(vUv - vec2(0.0, o.y));
            float dU = linear(vUv + vec2(0.0, o.y));
            // Scaled by depth: without this, distant geometry never differs
            // enough to trip the bias and the far field loses all its lines.
            float dEdge = (abs(dL + dR - 2.0 * dC) + abs(dU + dD - 2.0 * dC)) / max(dC, 1.0);

            /**
             * GRAZING-ANGLE CORRECTION, and without it the horizon is a scribble.
             *
             * A depth Sobel asks "does depth change faster here than across a
             * flat surface" — but on a surface seen edge-on, depth changes
             * enormously per pixel with no edge present at all. So a rolling
             * meadow inked a solid black band along every ridgeline and across
             * the whole mid-distance, which looked like the threshold was
             * mistuned and was not: it was correct for surfaces facing the
             * camera and meaningless for surfaces facing away from it.
             *
             * The view-space normal's Z is exactly |N·V| for a view-space
             * frame, so it says how side-on this pixel is. Dividing the
             * measured gradient by it removes the part of the change that the
             * angle alone explains, leaving the part an actual edge caused.
             */
            float facing = max(abs(normalize(texture2D(tNormal, vUv).xyz * 2.0 - 1.0).z), 0.06);
            dEdge *= facing;

            // NORMALIZED, and this is not defensive tidiness — it was a bug.
            // 1.0 - dot(a, b) is only "the angle between two normals" when
            // both are unit length. Un-normalized, a FLAT region of the buffer
            // scores 1 - |n|^2, which for anything that is not already unit
            // reads as a maximal edge. Empty sky decoded to |n|^2 = 0.48, so
            // every one of the four taps contributed 0.52, the sum was 2.08
            // against a 0.62 threshold, and the entire sky was painted with the
            // line colour. It looked exactly like "the background is broken".
            // Creases sample on their OWN, narrower radius — see uCreaseWidth.
            vec2 c = uTexel * uCreaseWidth;
            vec3 nC = normalize(texture2D(tNormal, vUv).xyz * 2.0 - 1.0);
            vec3 nL = normalize(texture2D(tNormal, vUv - vec2(c.x, 0.0)).xyz * 2.0 - 1.0);
            vec3 nR = normalize(texture2D(tNormal, vUv + vec2(c.x, 0.0)).xyz * 2.0 - 1.0);
            vec3 nD = normalize(texture2D(tNormal, vUv - vec2(0.0, c.y)).xyz * 2.0 - 1.0);
            vec3 nU = normalize(texture2D(tNormal, vUv + vec2(0.0, c.y)).xyz * 2.0 - 1.0);
            float nEdge = (1.0 - dot(nC, nL)) + (1.0 - dot(nC, nR))
                        + (1.0 - dot(nC, nD)) + (1.0 - dot(nC, nU));

            float e = max(
              smoothstep(uDepthBias * 0.02, uDepthBias * 0.02 + 0.004, dEdge),
              smoothstep(uNormalBias, uNormalBias + 0.28, nEdge));
            if (e <= 0.001) discard;
            gl_FragColor = vec4(uColor, e * uOpacity);
          }
        `,
      }),
    );
    this.quad.frustumCulled = false;
    this.scene = new THREE.Scene();
    this.scene.add(this.quad);
    this.cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  }

  setSize(w, h) {
    this.target.setSize(w, h);
    this.uniforms.uTexel.value.set(1 / w, 1 / h);
  }

  /**
   * Render the normal+depth prepass. Call before the beauty pass.
   *
   * THE BACKGROUND IS REMOVED FOR THE DURATION, and that is the root cause of
   * the bug the shader now also guards against: with `scene.background` left
   * in place, three paints it into this target too — so "empty space" in the
   * NORMAL buffer contained the sky colour, which decodes to a plausible-
   * looking but non-unit vector and read as an edge everywhere. Clearing to
   * black instead gives empty space a normal of (-1,-1,-1) and, more usefully,
   * a depth of 1.0, which is what the shader tests.
   */
  prepass(scene, camera) {
    this.uniforms.uNear.value = camera.near;
    this.uniforms.uFar.value = camera.far;
    /**
     * TRANSPARENT THINGS ARE HIDDEN FOR THE PREPASS, and this is not a polish
     * detail — without it the effect is unusable on a real scene.
     *
     * `overrideMaterial` replaces EVERY material with `MeshNormalMaterial`,
     * which has no alpha map, no alpha test and no additive blend. So every
     * camera-facing billboard renders as a fully opaque rectangle in the normal
     * and depth buffers: the cloud layer became a wall of inked squares across
     * the sky, and the lightsaber — an additive quad — became an outlined
     * quadrilateral instead of a blade. Both looked like the outline shader was
     * broken; neither was.
     *
     * The test is not a hand-kept list but the property that actually matters:
     * IS THIS OBJECT'S SILHOUETTE ITS GEOMETRY? Three ways it can fail to be,
     * and all three were found by looking at a render:
     *
     *   `transparent`  — the cloud layer, which inked a wall of squares.
     *   additive       — the lightsaber, which became an outlined quadrilateral
     *                    instead of a blade.
     *   `alphaTest`    — the ordinary cutout case.
     *   a `discard`    — the grass CARDS, and the subtle one. They set
     *                    `transparent: false` and NO alphaTest: the cutout is a
     *                    `discard` inside their own fragment shader. So the
     *                    first three rules all let them through, and the
     *                    mid-field turned into a band of black stipple where
     *                    every card quad had been inked as a rectangle.
     *
     * That last case is why the test ends up looking at shader SOURCE. It is
     * not elegant, but the alternative is a list of object names, and a list is
     * wrong the first time somebody adds a cutout material.
     */
    const hidden = this._hidden || (this._hidden = []);
    hidden.length = 0;
    scene.traverseVisible((o) => {
      const m = o.material;
      if (!m) return;
      const list = Array.isArray(m) ? m : [m];
      if (list.some((x) => x && cutsItsOwnSilhouette(x))) {
        o.visible = false;
        hidden.push(o);
      }
    });
    const prevMat = scene.overrideMaterial;
    const prevBg = scene.background;
    const prevFog = scene.fog;
    scene.overrideMaterial = this.normalMat;
    scene.background = null;
    // Fog would blend the encoded normals toward the fog colour with distance,
    // which silently rotates every far-field normal toward the same direction
    // and erases the creases out there.
    scene.fog = null;
    this.renderer.setRenderTarget(this.target);
    this.renderer.setClearColor(0x000000, 1);
    this.renderer.clear(true, true, false);
    this.renderer.render(scene, camera);
    this.renderer.setRenderTarget(null);
    scene.overrideMaterial = prevMat;
    scene.background = prevBg;
    scene.fog = prevFog;
    for (const o of hidden) o.visible = true;
    hidden.length = 0;
  }

  /** Composite the lines over whatever is already in the frame buffer. */
  draw() {
    const auto = this.renderer.autoClear;
    this.renderer.autoClear = false;
    this.renderer.render(this.scene, this.cam);
    this.renderer.autoClear = auto;
  }

  dispose() {
    this.target.dispose();
    this.target.depthTexture?.dispose();
    this.quad.geometry.dispose();
    this.quad.material.dispose();
    this.normalMat.dispose();
  }
}

/* ══════════════════════════════════════════════════════════════════════ */
/*  Palettes                                                              */
/* ══════════════════════════════════════════════════════════════════════ */

/**
 * Authored looks, because a raw shader toggle is not the question.
 *
 * The claim being tested is that a stylised path can look INTENTIONAL, and
 * intentional means somebody chose the colours. Each of these is a complete
 * set — key, fill, sky, ground, fog, line — rather than a tint, because that is
 * what "commit rather than half-measure" means in practice.
 */
export const PALETTES = {
  temple: {
    name: 'Cool temple',
    key: 0xfff2d8, keyI: 2.6, fill: 0x4a6a9a, fillI: 0.85,
    sky: 0x9fc4e8, ground: 0x6f7f8c, fog: 0xa9c6e0, line: 0x121a26,
    fogNear: 14, fogFar: 90, dark: 0.36,
  },
  dune: {
    name: 'Warm dune',
    key: 0xffe0a8, keyI: 3.1, fill: 0xa4713f, fillI: 0.9,
    sky: 0xe8c98d, ground: 0xc79a5e, fog: 0xe9cb9a, line: 0x2a1c10,
    fogNear: 18, fogFar: 110, dark: 0.42,
  },
  storm: {
    name: 'Storm',
    key: 0xcfe0ff, keyI: 1.5, fill: 0x37455c, fillI: 1.1,
    sky: 0x6a7788, ground: 0x4e5866, fog: 0x7d8a9c, line: 0x0a0e14,
    fogNear: 8, fogFar: 46, dark: 0.30,
  },
};

/* ══════════════════════════════════════════════════════════════════════ */
/*  The grass                                                             */
/* ══════════════════════════════════════════════════════════════════════ */

/**
 * BAND THE GRASS — the single most important surface in this game, and the one
 * the first demo missed entirely.
 *
 * `collectSwappable` converts `MeshStandardMaterial` and nothing else, and the
 * grass is a hand-written `ShaderMaterial` (`GRASS_FRAG`, Scenery.js). So on a
 * level whose whole subject is a field, the toon pass skipped the entire
 * picture — which is a large part of why "the ground barely changed".
 *
 * The injection point is one line, and it is the right line:
 *
 *     float wrap = clamp(dot(N, L) * 0.62 + 0.38, 0.0, 1.0);
 *
 * That is the blade's HALF-LAMBERT diffuse response — the 0.62/0.38 wrap is
 * there because a blade lit from behind is dim rather than black. Quantising
 * `wrap` bands exactly the term a ramp is supposed to band, and leaves the
 * translucency, the sheen, the wave-as-light and the ambient alone. Quantising
 * the final colour instead would posterise the wind, which is the one thing in
 * this level that must stay continuous.
 *
 * It sits inside `#pragma unroll_loop_start`, so the replacement lands once per
 * directional light, which is what we want.
 *
 * Gated on a uniform rather than compiled in, so the same material is the live
 * A/B rather than needing a rebuild.
 */
const GRASS_WRAP = 'float wrap = clamp(dot(N, L) * 0.62 + 0.38, 0.0, 1.0);';

export function bandGrass(material, bandsRef) {
  if (!material || material.userData.toonBanded) return false;
  const src = material.fragmentShader;
  if (!src || src.indexOf(GRASS_WRAP) < 0) return false;   // not the grass, or it moved
  material.fragmentShader = src.replace(GRASS_WRAP, /* glsl */`
        ${GRASS_WRAP}
        if (uGrassBands > 0.5) {
          float gb = max(2.0, uGrassBands);
          // floor, not round: rounding puts the brightest band at the very top
          // of the range and a fully-lit blade lands a hair under 1.0, so the
          // crest of the field never reaches the light it should.
          wrap = clamp(floor(wrap * gb) / (gb - 1.0), 0.0, 1.0);
        }
  `);
  material.fragmentShader = `uniform float uGrassBands;\n${material.fragmentShader}`;
  material.uniforms.uGrassBands = bandsRef;
  material.needsUpdate = true;
  material.userData.toonBanded = true;
  // Banded, but never inked — see `noOutline` for why a field must not be.
  noOutline(material);
  return true;
}

/**
 * Find every grass material in a scene and band it.
 *
 * By SHADER CONTENT rather than by name or by walking to a known field object:
 * `GrassField` builds more than one material (blades and cards), rebuilds them
 * on an LOD change, and a level may hold several. Matching on the wrap line
 * catches all of them and cannot be fooled by something merely called grass.
 */
export function bandAllGrass(scene, bandsRef) {
  let n = 0;
  scene.traverse((o) => {
    const list = Array.isArray(o.material) ? o.material : (o.material ? [o.material] : []);
    for (const m of list) if (m?.isShaderMaterial && bandGrass(m, bandsRef)) n++;
  });
  return n;
}

/* ══════════════════════════════════════════════════════════════════════ */
/*  Rim light                                                             */
/* ══════════════════════════════════════════════════════════════════════ */

/**
 * A Fresnel rim on the toon materials.
 *
 * The cheapest thing missing from the first pass and, per the reference games,
 * one of the two that most separates a figure from the ground behind it. Added
 * AFTER the tone-mapped output rather than into the light loop, because a rim
 * is a drawn convention — an ink-and-paint highlight — and not a light that
 * obeys the rig.
 */
export function installRim(material, rimRef, colorRef) {
  const prev = material.onBeforeCompile;
  material.onBeforeCompile = (shader, renderer) => {
    prev?.call(material, shader, renderer);
    shader.uniforms.uRim = rimRef;
    shader.uniforms.uRimColor = colorRef;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\n varying vec3 vRimN;\n varying vec3 vRimV;')
      .replace('#include <fog_vertex>',
        '#include <fog_vertex>\n vRimN = normalize(normalMatrix * normal);\n vRimV = normalize(-mvPosition.xyz);');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>',
        '#include <common>\n uniform float uRim;\n uniform vec3 uRimColor;\n varying vec3 vRimN;\n varying vec3 vRimV;')
      .replace('#include <dithering_fragment>', /* glsl */`
        #include <dithering_fragment>
        if (uRim > 0.0) {
          float f = 1.0 - clamp(dot(normalize(vRimN), normalize(vRimV)), 0.0, 1.0);
          // Stepped, not smooth: a soft Fresnel is a realism cue and reads as
          // wet plastic. A hard edge reads as a drawn highlight.
          float r = step(0.62, f) * uRim;
          gl_FragColor.rgb += uRimColor * r;
        }
      `);
  };
  material.needsUpdate = true;
}

/**
 * Banded distance fog.
 *
 * The game's own fog is a physical height-stratified extinction with an
 * energy-limited sunward inscatter term, and it is genuinely good — but it is
 * good at CONTINUITY, which is the opposite of what this look wants. Quantising
 * the fog factor into the same number of steps as the light ramp is what makes
 * depth read as a few discrete plates, the way a background painting does.
 *
 * Installed via `onBeforeCompile` on the toon materials rather than by touching
 * three's shared fog chunks — this page must not do to ShaderChunk what
 * Engine.js does, or the two fog models would fight over one global.
 */
export function installBandedFog(material, bandsRef) {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uFogBands = bandsRef;
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <fog_pars_fragment>',
        `#include <fog_pars_fragment>\n uniform float uFogBands;`)
      .replace('#include <fog_fragment>', /* glsl */`
        #ifdef USE_FOG
          #ifdef FOG_EXP2
            float fogFactor = 1.0 - exp( - fogDensity * fogDensity * vFogDepth * vFogDepth );
          #else
            float fogFactor = smoothstep( fogNear, fogFar, vFogDepth );
          #endif
          if (uFogBands > 0.5) {
            float n = max(1.0, uFogBands);
            fogFactor = floor(fogFactor * n + 0.5) / n;
          }
          gl_FragColor.rgb = mix( gl_FragColor.rgb, fogColor, fogFactor );
        #endif
      `);
  };
  material.needsUpdate = true;
}
