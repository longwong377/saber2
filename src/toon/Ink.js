/**
 * SABER — the ink.
 *
 * Rule 4 of src/toon/REFERENCE.md: "dark, thin, even weight, on interior detail
 * as well as silhouettes … they draw the strata in the cliffs, the mortar
 * between stones and the panel seams on the mech — not just the outside edge.
 * An outline pass that only inks silhouettes gives you half the look."
 *
 * ── WHY SCREEN SPACE AND NOT AN INVERTED HULL ─────────────────────────────
 *
 * The default instinct for toon outlines is the inverted hull: draw the mesh
 * again, backfaces only, pushed out along its normals. It is per-object, it
 * tapers nicely, and it is the wrong choice for THIS game for two reasons that
 * are specific rather than stylistic:
 *
 *   THIS GAME CUTS PEOPLE APART. Every severed limb is a NEW BufferGeometry
 *   built at runtime (Slice.js), so each one would need its hull generated on
 *   the frame it is created, mid-combat — and the cut cap, a flat disc of fresh
 *   geometry whose normals point along the blade, extrudes into a bright collar
 *   rather than an edge.
 *
 *   THE FIELD IS INSTANCED. Eleven thousand grass blades, thousands of chips,
 *   the debris field, the bolts. A hull pass doubles every one of them.
 *
 * A depth+normal edge detect handles both without a special case, because it
 * never learns what an object is, and it costs the same whatever is on screen.
 * It also gives UNIFORM WEIGHT in screen space, which is what reads as ink
 * rather than as a rim light — and rule 4 asks for even weight explicitly.
 *
 * ── WHAT THE FIRST ATTEMPT GOT WRONG ──────────────────────────────────────
 *
 * Four separate bugs, all of which drew lines where there was no edge, and all
 * of which are guarded here. They are worth naming because each one looked like
 * "the outline shader is broken" and none of them was:
 *
 *   THE SKY WAS SOLID INK. `1.0 - dot(a, b)` is the angle between two normals
 *   ONLY IF BOTH ARE UNIT LENGTH. With the scene background left in place the
 *   prepass painted the sky colour into the normal buffer, which decoded to a
 *   vector of length² 0.48; every one of the four taps then scored 0.52, the
 *   sum was 2.08 against a 0.62 threshold, and the whole sky was painted with
 *   the line colour. Fixed at the root — the prepass clears black and removes
 *   the background — and again in the shader, which normalizes.
 *
 *   THE HORIZON WAS A SCRIBBLE. A depth Sobel asks "does depth change faster
 *   here than across a flat surface?", and on a surface seen edge-on depth
 *   changes enormously per pixel with no edge present at all. So a rolling
 *   meadow inked a solid black band along every ridgeline. The view-space
 *   normal's z IS |N·V|, so dividing the measured gradient by it removes
 *   exactly the part of the change that the grazing angle explains.
 *
 *   CLOUDS AND THE BLADE CAME OUT AS RECTANGLES. `overrideMaterial` replaces
 *   every material with MeshNormalMaterial, which has no alpha map, no alpha
 *   test and no blending — so every camera-facing billboard writes a fully
 *   opaque quad into the normal and depth buffers.
 *
 *   THE MID-FIELD WAS BLACK STIPPLE. The grass cards set `transparent: false`
 *   and no alphaTest: their cutout is a `discard` inside their own fragment
 *   shader, so the first three tests all let them through.
 *
 * ── AND ONE THING THAT IS A DESIGN FINDING RATHER THAN A BUG ──────────────
 *
 * A field is tens of thousands of thin blades. Every one of them is a genuine
 * silhouette, so an edge detector correctly finds an edge on all of them, and
 * at any distance where a blade is about a pixel wide the result is a band of
 * stipple across the middle of the frame. The reference frames do not outline
 * grass either: ink goes on things that read as FORMS and not on things that
 * read as texture. That distinction has to be authored — see `noInk`.
 */

import * as THREE from 'three';
import { Pass, FullScreenQuad } from 'three/addons/postprocessing/Pass.js';

/**
 * Line weight and colour.
 *
 * SILHOUETTE AND CREASE HAVE THEIR OWN SAMPLE RADIUS, and that is the whole of
 * rule 4. The depth term finds where one thing ends and another begins; the
 * normal term finds folds inside a single thing. Giving them one shared radius
 * is what made the first pass read as a wireframe: either the creases were
 * missing or the silhouettes were fat.
 *
 * THE LINE IS NOT BLACK. Rule 4 again — the reference frames ink in dark brown
 * and charcoal. Pure black on a coloured field reads as a hole; a dark warm
 * neutral reads as a drawn line. This is an sRGB value applied AFTER the tone
 * curve (see where the pass sits in Engine's chain), so it is exactly the
 * colour that lands on the screen.
 */
export const INK = {
  /** Silhouette sample radius, in pixels. */
  width: 1.15,
  /** Crease sample radius, in pixels. Narrower: interior lines are finer. */
  creaseWidth: 0.85,
  /** Depth-gradient threshold, scaled by 0.02 in the shader. */
  depthBias: 0.95,
  /**
   * Crease threshold on the normal LAPLACIAN of two axes — see the shader.
   *
   * 0.34 is a fold of 20° between one sample radius and the next: a chamfer, a
   * panel seam, the corner of a crate, the riser of a stair. It was 0.16 (a 9°
   * fold) on the argument that rule 4 wants the finest interior detail it can
   * get, and the frames said otherwise — the canyon's cliff faces and the
   * arena's scattered rock came out crazed with black, because a procedurally
   * displaced rock is thousands of facets and most of them meet at ten to
   * fifteen degrees. Those are not folds anybody drew; they are the mesh.
   *
   * The distinction rule 4 is actually making is between geometry a modeller
   * put there and detail an artist drew — "the strata in the cliffs, the mortar
   * between stones" are DRAWN marks in the reference frames, not creases in
   * their meshes, which is rule 6 said from the other side. So the crease term
   * finds what is genuinely built (seams, chamfers, corners) and drawn detail
   * stays the albedo's job. 20° is where the frames put that line.
   */
  creaseBias: 0.34,
  /** How far past the threshold a line reaches full opacity. */
  creaseSoft: 0.16,
  color: 0x2a2118,
  opacity: 0.92,
  /**
   * Distance at which a crease line fades out, in metres, and the reach.
   *
   * Interior detail at 300 m is not detail, it is noise: the fold is a fraction
   * of a pixel wide and the line detector finds it every frame in a different
   * place, which shimmers. Silhouettes are NOT faded by THIS — they are faded
   * by the haze instead, see setHaze — so a mountain keeps its outline for as
   * long as you can still see the mountain.
   */
  creaseFade: [40, 120],
};

/** Never ink this material. See the note above about grass. */
export function noInk(material) {
  if (!material) return;
  for (const m of (Array.isArray(material) ? material : [material])) {
    if (m) m.userData.saberNoInk = true;
  }
}

/**
 * Is this material's drawn silhouette something other than its geometry?
 *
 * Cached on the material, because the `discard` test reads shader source and
 * this question is asked of every visible object every frame.
 */
function cutsItsOwnSilhouette(m) {
  if (m.userData.saberNoInk) return true;
  if (m.userData._inkCut !== undefined) return m.userData._inkCut;
  const cut = !!(m.transparent || m.alphaTest > 0
    || m.blending === THREE.AdditiveBlending
    || m.blending === THREE.MultiplyBlending
    || (typeof m.fragmentShader === 'string' && m.fragmentShader.indexOf('discard') >= 0));
  m.userData._inkCut = cut;
  return cut;
}

const INK_FRAG = /* glsl */`
  uniform sampler2D tDiffuse;
  uniform sampler2D tNormal;
  uniform sampler2D tDepth;
  uniform vec2  uTexel;
  uniform vec4  uWeight;      // silhouette px, crease px, depth bias, crease bias
  uniform vec4  uInk;         // rgb line colour, a opacity
  uniform vec4  uRange;       // near, far, crease fade start, crease fade end
  uniform vec2  uHaze;        // metres at which the line starts and finishes fading
  varying vec2 vUv;

  // Depth in the buffer is non-linear, so a raw difference finds edges under
  // the camera's nose and nothing at all in the distance. Linearising is what
  // lets one threshold work across the whole scene.
  float linearDepth( vec2 uv ) {
    float z = texture2D( tDepth, uv ).x * 2.0 - 1.0;
    return ( 2.0 * uRange.x * uRange.y ) / ( uRange.y + uRange.x - z * ( uRange.y - uRange.x ) );
  }

  void main() {
    vec4 src = texture2D( tDiffuse, vUv );
    float zc = texture2D( tDepth, vUv ).x;
    // NOTHING IN EMPTY SKY. The prepass clears to the far plane, so a pixel at
    // 1.0 has no geometry in it and cannot have an edge. Without this the sky
    // gets one, because the Sobel below is only meaningful where something was
    // drawn.
    if ( zc >= 0.9999 ) { gl_FragColor = src; return; }

    vec2 o = uTexel * uWeight.x;
    float dC = linearDepth( vUv );
    float dL = linearDepth( vUv - vec2( o.x, 0.0 ) );
    float dR = linearDepth( vUv + vec2( o.x, 0.0 ) );
    float dD = linearDepth( vUv - vec2( 0.0, o.y ) );
    float dU = linearDepth( vUv + vec2( 0.0, o.y ) );
    // Second difference, scaled by depth: without the division distant geometry
    // never differs enough to trip the bias and the far field loses its lines.
    float dEdge = ( abs( dL + dR - 2.0 * dC ) + abs( dU + dD - 2.0 * dC ) ) / max( dC, 1.0 );

    vec3 nC = texture2D( tNormal, vUv ).xyz * 2.0 - 1.0;
    // GRAZING-ANGLE CORRECTION. In a view-space frame the normal's z is |N·V|,
    // so it says how side-on this pixel is; dividing the gradient by it removes
    // the part of the change the angle alone explains and leaves the part an
    // actual edge caused. Without it every ridgeline is a solid black band.
    // Squared, not linear. The floor is what decides how much a surface seen
    // almost edge-on is allowed to contribute, and at 0.06 the meadow's ground
    // still inked a solid band across the whole mid-frame: the heightfield's
    // quad grid is metres wide out there, so its raw second difference is
    // enormous and one sixteenth of enormous is still over the line.
    float facing = abs( normalize( nC ).z );
    dEdge *= facing * facing;

    /* THE CREASE TERM IS A SECOND DIFFERENCE, NOT A FIRST ONE, and that is the
     * difference between rule 4 and a scribble.
     *
     * The obvious crease detector is sum(1 - dot(n0, nᵢ)) — how far the
     * neighbours have turned. Measured on the meadow it inks the ENTIRE
     * landscape: the terrain is a heightfield on a 1.5 m quad grid, so a rolling
     * meadow's normal turns a little between every pair of adjacent pixels, and
     * at a threshold low enough to find a panel seam (rule 4 wants seams) every
     * hill in the frame comes out as a black hatch. Lowering the sensitivity to
     * stop it is the same as not having interior lines at all.
     *
     * A first difference cannot separate the two, because a smooth bend and a
     * sharp fold both produce one. The LAPLACIAN can: on a smoothly curving
     * surface nL and nR sit symmetrically either side of n0, so nL + nR - 2·n0
     * cancels to within the curvature's second order, while a fold leaves the
     * whole of the turn behind. On the same frame that is a rolling hill at
     * ~0.01 and a chamfer at 0.4 — a factor of forty, where the first
     * difference gave less than three. */
    vec2 c = uTexel * uWeight.y;
    vec3 n0 = normalize( nC );
    vec3 nL = normalize( texture2D( tNormal, vUv - vec2( c.x, 0.0 ) ).xyz * 2.0 - 1.0 );
    vec3 nR = normalize( texture2D( tNormal, vUv + vec2( c.x, 0.0 ) ).xyz * 2.0 - 1.0 );
    vec3 nD = normalize( texture2D( tNormal, vUv - vec2( 0.0, c.y ) ).xyz * 2.0 - 1.0 );
    vec3 nU = normalize( texture2D( tNormal, vUv + vec2( 0.0, c.y ) ).xyz * 2.0 - 1.0 );
    float nEdge = length( nL + nR - 2.0 * n0 ) + length( nD + nU - 2.0 * n0 );
    // Interior detail fades with range; silhouettes do not. A fold half a pixel
    // wide is not detail, it is a different pixel every frame.
    nEdge *= 1.0 - smoothstep( uRange.z, uRange.w, dC );

    float e = max(
      smoothstep( uWeight.z * 0.02, uWeight.z * 0.02 + 0.004, dEdge ),
      smoothstep( uWeight.w, uWeight.w + ${INK.creaseSoft.toFixed(3)}, nEdge ) );

    /* ── INK IS A PROPERTY OF A SURFACE YOU CAN STILL SEE ────────────────
     *
     * The single worst thing in the first meadow frame was a hard black line
     * ruled straight across the whole width of the picture at the horizon. It
     * was not a bug in the detector: it is the EDGE OF THE WORLD. The
     * heightfield is a 520 m box and past it there is sky, so the far rim is a
     * genuine depth silhouette and the pass drew it, faithfully, at full
     * strength — the one thing every level's fog exists to hide.
     *
     * Fog cannot help by itself, because this pass runs after the tone curve
     * and knows nothing about the scene's air. So it is told: uHaze carries the
     * distances at which the level's own extinction reaches half and nearly
     * all, and the line fades over exactly that span. A surface dissolved in
     * air has no edge, which is also why the reference frames' far cliffs are
     * pale flat shapes with no line on them while their near buttes are inked.
     *
     * On the dune sea, whose air is clear, this is 198 m to 378 m and every
     * painted range keeps its outline. On the meadow, whose whole subject is
     * mist, it is 95 m to 180 m and the world's edge is gone. */
    e *= 1.0 - smoothstep( uHaze.x, uHaze.y, dC );
    if ( e <= 0.002 ) { gl_FragColor = src; return; }
    gl_FragColor = vec4( mix( src.rgb, uInk.rgb, e * uInk.a ), src.a );
  }
`;

/**
 * The ink, as an EffectComposer pass.
 *
 * WHERE IT SITS IN THE CHAIN, and it is not arbitrary: after OutputPass and
 * before the composite grade. After the tone curve, so `INK.color` is the exact
 * sRGB value that lands on the screen rather than a linear radiance that ACES
 * then moves; and after bloom, so a line next to the blade does not glow. Ink
 * is drawn, not lit — it should be the one thing in the frame the light rig
 * cannot touch.
 */
export class OutlinePass extends Pass {
  /**
   * @param {number} scale prepass resolution as a fraction of the frame. The
   *   only quality knob this pass has — see Engine.QUALITY.ink.
   */
  constructor(scene, camera, scale = 1) {
    super();
    this.scene = scene;
    this.camera = camera;
    this.scale = scale;
    this.needsSwap = true;

    this.target = new THREE.WebGLRenderTarget(2, 2, {
      minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter,
      type: THREE.UnsignedByteType, depthBuffer: true,
      // No colour space conversion: these are encoded normals, not colour.
      colorSpace: THREE.NoColorSpace,
    });
    this.target.depthTexture = new THREE.DepthTexture(2, 2);
    this.target.depthTexture.type = THREE.UnsignedShortType;

    this.normalMat = new THREE.MeshNormalMaterial();

    this.uniforms = {
      tDiffuse: { value: null },
      tNormal: { value: this.target.texture },
      tDepth: { value: this.target.depthTexture },
      uTexel: { value: new THREE.Vector2(1 / 1024, 1 / 1024) },
      uWeight: { value: new THREE.Vector4(INK.width, INK.creaseWidth, INK.depthBias, INK.creaseBias) },
      uInk: { value: new THREE.Vector4(0, 0, 0, INK.opacity) },
      uRange: { value: new THREE.Vector4(0.15, 400, INK.creaseFade[0], INK.creaseFade[1]) },
      // Clear air until a level says otherwise, so an Ink built without an
      // Engine still draws lines rather than nothing.
      uHaze: { value: new THREE.Vector2(600, 1200) },
    };
    this.setColor(INK.color);

    this.material = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: /* glsl */`
        varying vec2 vUv;
        void main() { vUv = uv; gl_Position = vec4( position.xy, 0.0, 1.0 ); }
      `,
      fragmentShader: INK_FRAG,
      depthTest: false, depthWrite: false,
    });
    this.quad = new FullScreenQuad(this.material);
    this._hidden = [];
  }

  /**
   * The line colour, as it will land on screen.
   *
   * SET WITHOUT THE sRGB→LINEAR CONVERSION, on purpose. `new THREE.Color(hex)`
   * converts under ColorManagement, and this pass runs after OutputPass has
   * already encoded the frame — so the buffer it is mixing into holds sRGB
   * bytes and a linearised colour would come out several times too dark.
   */
  setColor(hex) {
    const u = this.uniforms.uInk.value;
    u.x = ((hex >> 16) & 255) / 255;
    u.y = ((hex >> 8) & 255) / 255;
    u.z = (hex & 255) / 255;
    return this;
  }

  /**
   * How far the level lets you see, so the ink can stop where sight does.
   *
   * `density` is FogExp2's, whose transmittance is exp(-(d·k)²), so the
   * distance at which a given fraction f of a surface has been replaced by air
   * is sqrt(-ln(1-f))/k — closed form, no tuning. The line starts fading where
   * the air has taken half the surface and is gone where it has taken 92%,
   * which is the point past which there is nothing left for a line to be the
   * edge OF.
   *
   * The engine's extinction is height-stratified on top of this (see AERIAL),
   * so the true path is shorter for anything above the haze layer and this is
   * an upper bound on where the ink survives — which is the safe direction: a
   * line that fades slightly early is invisible, and one that fades slightly
   * late rules the world's edge across the frame.
   *
   * @param {number} density FogExp2 density, or 0/undefined for clear air.
   */
  setHaze(density) {
    const k = density > 1e-6 ? density : 0;
    const at = (f) => (k ? Math.sqrt(-Math.log(1 - f)) / k : 1e4);
    this.uniforms.uHaze.value.set(at(0.5), at(0.92));
    return this;
  }

  setSize(w, h) {
    const pw = Math.max(2, Math.round(w * this.scale));
    const ph = Math.max(2, Math.round(h * this.scale));
    this.target.setSize(pw, ph);
    this.uniforms.uTexel.value.set(1 / pw, 1 / ph);
  }

  /**
   * Render the normal+depth prepass. Engine calls this immediately before the
   * composer, because the composer owns the frame from that point on.
   *
   * THE BACKGROUND AND THE FOG ARE REMOVED FOR THE DURATION. The background is
   * the root cause of the "solid ink sky" bug; the fog would blend every
   * encoded normal toward the fog colour with distance, which rotates the whole
   * far field toward one direction and erases its creases.
   */
  prepass(renderer) {
    /* ── THE PREPASS HAS ITS OWN FAR PLANE, AND IT IS THE INK'S OWN REACH ──
     *
     * Two things fall out of one line, and the second one was a visible bug.
     *
     * COST. This is a second rasterisation of the scene, and the cheapest thing
     * to do with a draw call is not to issue it. The ink is already zero past
     * uHaze.y (see setHaze), so everything beyond it is being drawn to produce
     * pixels the composite multiplies by nothing. Pulling the far plane in to
     * the fade's end hands the whole question to three's own frustum culling.
     *
     * PRECISION, and this is the one that mattered. The depth attachment is
     * DEPTH_COMPONENT16 — one texture rather than the float pair a
     * higher-precision buffer would cost — and 16 bits over 0.15 m to 520 m
     * puts a quantisation step of about 8 m at 400 m. The far rim of the
     * heightfield therefore came back with a depth that was noise, the range
     * fade could not be trusted to switch anything off out there, and a hard
     * black line was ruled straight across the whole width of the meadow at the
     * horizon. Against a 190 m far plane the same step is 1.8 m at 190 m and
     * 2 cm at 20 m, and anything past it is simply not drawn — so it clears to
     * the far plane and the shader's own sky test discards it.
     *
     * Clamped to the real camera in both directions: a level with no fog at all
     * gets the full view distance, and one whose air closes at 40 m still gets
     * enough depth in front of it for a fight to have edges. */
    const cam = this._cam || (this._cam = this.camera.clone());
    cam.copy(this.camera, false);
    cam.matrixWorld.copy(this.camera.matrixWorld);
    cam.matrixWorldInverse.copy(this.camera.matrixWorldInverse);
    cam.far = Math.min(this.camera.far, Math.max(60, this.uniforms.uHaze.value.y * 1.06));
    cam.updateProjectionMatrix();
    this.uniforms.uRange.value.x = cam.near;
    this.uniforms.uRange.value.y = cam.far;

    const hidden = this._hidden;
    hidden.length = 0;
    this.scene.traverseVisible((o) => {
      const m = o.material;
      if (!m) return;
      const list = Array.isArray(m) ? m : [m];
      if (list.some((x) => x && cutsItsOwnSilhouette(x))) { o.visible = false; hidden.push(o); }
    });

    const prevMat = this.scene.overrideMaterial;
    const prevBg = this.scene.background;
    const prevFog = this.scene.fog;
    const prevTarget = renderer.getRenderTarget();
    this.scene.overrideMaterial = this.normalMat;
    this.scene.background = null;
    this.scene.fog = null;
    renderer.getClearColor(_prevClear);
    const prevAlpha = renderer.getClearAlpha();
    renderer.setRenderTarget(this.target);
    renderer.setClearColor(0x000000, 1);
    renderer.clear(true, true, false);
    renderer.render(this.scene, cam);
    renderer.setRenderTarget(prevTarget);
    renderer.setClearColor(_prevClear, prevAlpha);
    this.scene.overrideMaterial = prevMat;
    this.scene.background = prevBg;
    this.scene.fog = prevFog;
    for (const o of hidden) o.visible = true;
    hidden.length = 0;
  }

  render(renderer, writeBuffer, readBuffer /* , deltaTime, maskActive */) {
    this.uniforms.tDiffuse.value = readBuffer.texture;
    renderer.setRenderTarget(this.renderToScreen ? null : writeBuffer);
    if (this.clear) renderer.clear();
    this.quad.render(renderer);
  }

  dispose() {
    this.target.depthTexture?.dispose();
    this.target.dispose();
    this.material.dispose();
    this.normalMat.dispose();
    this.quad.dispose();
  }
}

const _prevClear = new THREE.Color();
