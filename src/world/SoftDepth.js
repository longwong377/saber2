/**
 * BATTLEFRONT BORZ — SOFT PARTICLES, and why a cel-shaded game needs them MORE.
 *
 * `grep -n 'softParticle\|depthTexture\|sceneDepth' src/world/Particles.js
 * src/world/Smoke.js` returned nothing at all. Every sprite in the game is a
 * `depthWrite: false` billboard, so where one crosses the ground, a wall, a
 * crate or a body it ends on a perfectly straight line — the quad's own
 * intersection with the geometry behind it — and that line moves as the camera
 * moves. It is the single loudest tell that a puff of smoke is a picture of
 * smoke.
 *
 * The received wisdom is that this matters less in a stylised renderer. It is
 * the other way round. A photographic frame has noise, texture and gradient
 * everywhere, and a hard intersection edge is one more high-frequency line
 * among thousands. This game draws FLAT COLOUR FIELDS with drawn ink over them
 * — an unintended straight edge across a flat field is the most visible thing
 * that can happen to it, and it is a line the ink pass did not draw.
 *
 * ── WHERE THE DEPTH COMES FROM, AND WHY IT IS FREE ──────────────────────
 *
 * `src/toon/Ink.js` already rasterises the whole scene into a render target
 * with a 24-bit `DepthTexture` attached, once a frame, immediately before the
 * composer takes over — and it HIDES every transparent, additive and
 * alpha-tested material while it does it (`cutsItsOwnSilhouette`). That is not
 * a near miss, it is exactly the buffer a soft-particle pass wants: opaque
 * depth only, with no particle in it to occlude itself against, finished before
 * the frame that reads it is drawn. No second target, no second pass, no
 * per-frame allocation. One texture fetch and one `smoothstep` in the fragment.
 *
 * Two honest limits, both of them harmless:
 *
 *   THE PREPASS HAS ITS OWN FAR PLANE — the ink's reach, `max(60, fade*1.06)`
 *     — so anything past it reads as "nothing in front of me" and gets no
 *     softening. At that distance a billboard's intersection edge is under a
 *     pixel wide, which is why the ink stops drawing there in the first place.
 *   IT MAY BE AT HALF RESOLUTION on the medium tier. A softness ramp is the
 *     lowest-frequency signal in the frame; half a texel of slop in where it
 *     starts is invisible, where half a texel of slop in an ink line is not.
 *
 * ── ONE COPY OF THE MATHS ───────────────────────────────────────────────
 *
 * Both consumers — the instanced billboard pool in Particles.js and the lofted
 * smoke tubes in Smoke.js, which are a `MeshBasicMaterial` and therefore reach
 * it through `onBeforeCompile` — include the SAME string and share the SAME
 * uniform objects. A second copy of a depth linearisation beside the first is
 * the defect this project keeps a section of HANDOFF for (§2.3), and it would
 * fail silently: two slightly different linearisations put the smoke's fade and
 * the sparks' fade at different distances and nothing anywhere would throw.
 */

import * as THREE from 'three';

/**
 * The shared uniform OBJECTS.
 *
 * Shared and not copied, the same trick `Engine._installFogUniforms` uses for
 * the aerial-perspective pair: every material built by `softUniforms()` ends up
 * pointing at these three, so `setSceneDepth` is three writes a frame however
 * many pools and columns exist. `windUniforms()` in Scenery.js hands out fresh
 * objects because the wind is written per material through `syncWind`; this is
 * one global fact about the frame and wants the opposite.
 */
const tDepth = { value: null };
/** x = prepass near, y = prepass far, z = 1 when the buffer is usable at all. */
const uDepthRange = { value: new THREE.Vector3(0.15, 400, 0) };
/** Frame size in pixels, for turning gl_FragCoord into a buffer lookup. */
const uDepthSize = { value: new THREE.Vector2(1, 1) };

/** Uniform slots for a material that includes SOFT_GLSL. */
export function softUniforms(softness = 0.6) {
  return {
    tSceneDepth: tDepth,
    uDepthRange,
    uDepthSize,
    /* HOW MANY METRES OF OVERLAP ARE FADED, per material rather than global.
     * A 12 m smoke column wants a metre and a half; a 2 cm spark wants
     * essentially none, because a spark that faded as it approached a wall
     * would read as the spark going out early. 0 turns the whole thing off and
     * costs one comparison. */
    uSoft: { value: softness },
  };
}

/**
 * THE CHUNK. Include it in a fragment shader and call `softFade()`.
 *
 * `uDepthRange.z` is the arm: until something has handed this a real buffer it
 * is 0 and `softFade` returns 1 without sampling anything, which is what makes
 * a Particles built with no Engine behind it — every headless check in
 * tools/ — behave exactly as it did.
 */
export const SOFT_GLSL = /* glsl */`
  uniform sampler2D tSceneDepth;
  uniform vec3 uDepthRange;
  uniform vec2 uDepthSize;
  uniform float uSoft;

  /* Depth in the attachment is 1/z-distributed, so a raw difference finds
   * everything under the camera's nose and nothing at all past ten metres.
   * This is the same linearisation Ink.js's own detector uses, against the same
   * buffer and the same near/far pair, which is the whole reason it lives in
   * one file. */
  float sceneLinearDepth(vec2 uv){
    float z = texture2D(tSceneDepth, uv).x * 2.0 - 1.0;
    return (2.0 * uDepthRange.x * uDepthRange.y)
         / (uDepthRange.y + uDepthRange.x - z * (uDepthRange.y - uDepthRange.x));
  }

  /**
   * 1 where the sprite is clear of the world, easing to 0 as it reaches it.
   * @param viewZ  the fragment's own distance down the view axis, positive.
   */
  float softFade(float viewZ){
    if(uDepthRange.z < 0.5 || uSoft <= 0.0) return 1.0;
    float scene = sceneLinearDepth(gl_FragCoord.xy / uDepthSize);
    /* Anything the prepass did not draw comes back at its far plane. Treating
     * that as a surface would fade every sprite against the sky, so the last
     * two per cent of the range is read as "nothing there". */
    if(scene >= uDepthRange.y * 0.98) return 1.0;
    return clamp((scene - viewZ) / uSoft, 0.0, 1.0);
  }
`;

/**
 * Hand the frame's opaque depth to every material built with `softUniforms()`.
 *
 * Called once a frame by whoever owns the prepass. `near`/`far` are the
 * PREPASS's, not the camera's — Ink narrows its own far plane to the ink's
 * reach and publishes the pair it used on `uRange.x/.y`, and reading the
 * camera's instead would linearise every sample against the wrong frustum and
 * put the fade at the wrong distance by a factor of three on a foggy level.
 */
export function setSceneDepth(texture, near, far, width, height) {
  const ok = !!texture && Number.isFinite(near) && Number.isFinite(far) && far > near;
  tDepth.value = ok ? texture : null;
  uDepthRange.value.set(ok ? near : 0.15, ok ? far : 400, ok ? 1 : 0);
  if (Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0) {
    uDepthSize.value.set(width, height);
  }
  return ok;
}

/** What the chunk is currently reading. Exported so a check can measure it. */
export function sceneDepthState() {
  return { texture: tDepth.value, near: uDepthRange.value.x, far: uDepthRange.value.y,
    armed: uDepthRange.value.z === 1, width: uDepthSize.value.x, height: uDepthSize.value.y };
}

/**
 * Fit a stock three material with the same treatment, for the one consumer that
 * is not a ShaderMaterial.
 *
 * Smoke.js's columns are a `MeshBasicMaterial` with vertex alpha, deliberately
 * (see the note on `smokeMaterial`), and the base of a 60 m tube is exactly
 * where a hard intersection with the terrain shows worst. `onBeforeCompile` is
 * the only seam a stock material has, and `customProgramCacheKey` is what stops
 * three handing back a program compiled before the patch.
 */
export function makeSoft(material, softness = 1.4) {
  if (!material || material.userData.softDepth) return material;
  material.userData.softDepth = true;
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, softUniforms(softness));
    shader.vertexShader = 'varying float vSoftViewZ;\n' + shader.vertexShader.replace(
      '#include <fog_vertex>',
      '#include <fog_vertex>\n  vSoftViewZ = -mvPosition.z;');
    shader.fragmentShader = 'varying float vSoftViewZ;\n' + SOFT_GLSL + '\n' + shader.fragmentShader.replace(
      '#include <fog_fragment>',
      '  gl_FragColor.a *= softFade(vSoftViewZ);\n  #include <fog_fragment>');
  };
  material.customProgramCacheKey = () => 'softDepth';
  material.needsUpdate = true;
  return material;
}
