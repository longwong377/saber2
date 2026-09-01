/**
 * THE DECK'S MIRROR — a planar reflection of the room in its own floor.
 *
 * `assets/reference/REFERENCES.md` rule 2, agreed by all seven images: THE
 * FLOOR IS A BLACK MIRROR. Open `misc/hangar 5.webp` — the rim, the shuttle
 * and a thousand men are doubled in the plate under them as long vertical
 * smears, and the reflection is half the picture. In `hangar 3.jpg` every
 * wall strip runs down into the floor as a bright vertical streak and the
 * fighters hang under themselves as dark shapes, with the deck's own grid
 * lines still visible through all of it. The player asked for exactly this:
 * "can we do any actual reflective/mirror surfaces like in all the hangar
 * reference images?"
 *
 * ── WHY NO MATERIAL SETTING CAN DO IT ────────────────────────────────────
 *
 * The deck is a terrain heightfield (`TERRAIN_PRESETS.hangardeck`, L=0.11,
 * flat, seams on a 6 m module) with a `MeshStandardMaterial`, and the cel
 * model in `src/toon/Cel.js` DELETES the GGX lobe and the environment
 * reflection from every material's shader — not zeroed, removed, so a deleted
 * term cannot come back. `hangardeck.gloss` is therefore a number nothing
 * reads. The room's "reflection" until now was `DeckKit.smear`: an additive
 * quad drawn under every strip, bright at the wall foot and gone by the far
 * end. Those stay (they are the light BLOOMING on the plate, which a
 * reflection does not draw); this is the reflection itself.
 *
 * ── WHAT THIS IS: three's Reflector, ported and made DARK ───────────────
 *
 * `vendor/three/objects` has only `Sky.js` and nothing may be fetched, so the
 * essential technique is ported here in the open:
 *
 *   1. A second camera, the real one mirrored about the plane y = MIRROR.y —
 *      position reflected, forward reflected, up reflected. `lookAt` builds a
 *      proper right-handed basis from those, so the image it renders is an
 *      ordinary view from under the floor and no winding flips.
 *   2. Its near plane is replaced by the mirror plane (Lengyel's oblique
 *      clipping — the projection's third row is rewritten so clip z = -w
 *      exactly on the plane). Nothing under the deck can leak into the
 *      reflection: the pit's floor, the heightfield's own back face, the
 *      bulkhead's roots. No `renderer.clippingPlanes`, which would add a
 *      define to every program in the scene and recompile all of them.
 *   3. The scene is rendered ONCE into a render target sized off the frame
 *      by tier (below), from inside the mirror mesh's own `onBeforeRender`,
 *      so it happens after the shadow maps are fresh and before the plate is
 *      drawn — with the shadow cascades' auto-update switched off for the
 *      duration, for the reason `Ink.prepass` gives: a second `render()`
 *      re-renders all three cascades and they would come back byte-identical.
 *   4. A single mesh at y = MIRROR.y over the whole deck samples that target
 *      with projective coordinates (world → mirrored camera clip → [0,1]).
 *
 *   …AND IT IS ADDITIVE, AT A LOW VIEW-DEPENDENT STRENGTH. The plate stays:
 *   the heightfield's dark plate and its seams are drawn as they always were,
 *   and the mirror ADDS the reflected radiance on top, multiplied by
 *   `MIRROR.headOn` (0.18) looking straight down rising to `MIRROR.graze`
 *   (0.45) at grazing incidence on a (1 - cos)^3 curve. That is the shape of
 *   a Fresnel term without being one — a dielectric's real F0 is 0.04 and a
 *   0.04 reflection is invisible on a plate this dark, while the references
 *   plainly show 20-40% of the rim coming back. Cubed rather than Schlick's
 *   fifth power because the fifth power keeps the reflection at its floor
 *   until the last ten degrees, and a man standing 20 m away looks at the deck
 *   under the rim at 5°.
 *
 *   …AND IT IS SMEARED VERTICALLY. Seven taps up and down the texture's v
 *   axis, spread over ±MIRROR.smear of the frame height with triangular
 *   weights. For a point ON the plane, the mirrored camera's projection lands
 *   at the same screen height as the real camera's (the x axis flips, the y
 *   axis does not — see `mirrorCamera`), so texture v IS screen vertical and
 *   the blur runs straight down the picture. That is what turns a crisp
 *   doubled strip into the long streak every reference has: a polished deck
 *   is not a clean mirror, it is a mirror with a vertical brush through it.
 *
 * ── THE CEL LOOK ─────────────────────────────────────────────────────────
 *
 * The mirror material is a `ShaderMaterial` with `lights: false`. It has no
 * BRDF, no specular term, no highlight — it draws the mirrored scene and
 * nothing else, and the mirrored scene is drawn by the same cel model as the
 * room. It carries `saberNoInk`, so the ink prepass never rasterises it (its
 * silhouette is the floor's, which the floor already draws) — which is also
 * the first of three guards that keep the reflection to ONE render a frame:
 * the prepass hides the mesh, so `onBeforeRender` cannot fire there; the
 * hook ignores any camera that is not the engine's own (the prepass renders
 * through a clone); and `stepDeckMirror` arms exactly one render per stepped
 * frame. The mirror is invisible during its own render, so it cannot recurse.
 *
 * ── THE TIER GATE, AND WHAT IT COSTS ─────────────────────────────────────
 *
 * A reflection is a second rasterisation of every opaque object in the room,
 * at the target's resolution. `MIRROR.scale` is the target's size as a
 * fraction of the frame: nothing at `low` (the tier the menu offers to
 * integrated graphics — the mesh is hidden and the target is 2×2), half at
 * `medium`, three quarters at `high` and `ultra` (ultra's frame is already
 * 2.25× the pixels of high's, so 0.75 of it is more than a 1080p frame).
 * Transparent things — the field, the smears, the particles, the lift's
 * glass — are hidden for the render: they are a handful of quads that would
 * cost sorting and blending and add nothing to what the eye reads in a floor.
 * The sky dome is the ONE transparent thing kept, because the planet in the
 * aperture is the brightest thing the deck can reflect. A material that wants
 * to stay in the reflection sets `userData.saberMirror = true`.
 *
 * Nothing here adds a light (the pool is the engine's, and `_syncLights` is
 * not re-run) and nothing recompiles: the mirror render uses the same
 * materials, the same lights, the same fog and the same kind of target as the
 * beauty pass, so every program is already built. `tools/_mirrorprobe.mjs`
 * measures the draw calls and the frame with the mirror on and off in a real
 * browser; `tools/checks/deckmirror.mjs` holds everything above headlessly.
 *
 * MEASURED, medium tier, 960×540, standing at (0, 1.7, -60) looking forward
 * and a quarter radian down, twelve frames a window, on/off/on:
 *
 *   draw calls       1271 / 1148 / 1297      +123..+149, about 11-13%
 *   triangles        1.18 M / 1.04 M / 1.18 M
 *   compiled programs  60→60 / 60→61 / 61→61  (the one new program landed in
 *                                              the OFF window: not the mirror's)
 *   textures         85 / 85 / 85            the target is one, allocated once
 *   reflections      15 / 0 / 15             one per frame, never two
 *   frame, median    4650 / 4033 / 4567 ms   +13-15% — ON A SOFTWARE RASTERISER
 *
 * That last row is ANGLE on SwiftShader, a CPU drawing 1.2 M triangles; it is
 * the mirror's share of a frame and not a prediction of anyone's card. The
 * draw-call and triangle rows are exact: the reflection is a second pass over
 * the room's opaque geometry at a quarter of the pixels.
 */

import * as THREE from '../../vendor/three/three.module.js';
/* Lazy — read inside functions only. Hangar.js imports this file and this
 * file imports Hangar.js; an eager `const X = DECK.y` at the top is the dead
 * zone `tools/checks/decklife.mjs` warns about, and it stops the game booting. */
import { DECK } from './Hangar.js';

/**
 * Every number the mirror runs on. Each is inlined into GLSL as a literal, so
 * a check can transcribe the shader without copying the value.
 */
export const MIRROR = {
  /**
   * Height of the mirror plane over the plate. The heightfield's top is at
   * ≤ +0.012 (the fbm relief) with seams cut 0.055 below it; 0.02 clears the
   * relief. The rest of the coplanar fight is won by polygon offset on the
   * material — at 150 m with a 4.5 cm near plane a 24-bit depth step is about
   * 3 cm, more than this gap, and without the offset the far reflection
   * speckles against the plate exactly where the rim is.
   */
  y: 0.02,
  /** Reflection strength looking straight down, and at grazing incidence. */
  headOn: 0.18,
  graze: 0.45,
  /** Half-length of the vertical smear, as a fraction of the frame height. */
  smear: 0.032,
  /**
   * Render-target size as a fraction of the drawing buffer, per tier. 0 is
   * "no mirror at all": the mesh is hidden and the target holds 2×2 texels.
   */
  scale: { low: 0, medium: 0.5, high: 0.75, ultra: 0.75 },
  /**
   * The hole in the plate. `hangardeck.height` carves the pit at
   * |x+52| < 17, |z-6| < 24 (Terrain.js) and `PIT_KERBS` stands its kerbs on
   * that edge (Hangar.js). The mirror cannot float over a hole, so it is cut
   * out here to the same numbers — and `deckmirror.mjs` reads the ground
   * itself rather than these literals to say whether they still agree.
   */
  pit: { x: -52, z: 6, hx: 17, hz: 24 },
};

/** The target's size as a fraction of the frame for a tier name. */
export function mirrorScale(tier) {
  const s = MIRROR.scale[tier];
  return Number.isFinite(s) ? s : MIRROR.scale.medium;
}

/**
 * The reflection strength for a view direction's cosine to the plane normal —
 * the JS transcription of the shader's own curve, so a check can hold the
 * two ends without a GPU.
 */
export function strengthAt(cosTheta) {
  const g = 1 - Math.min(1, Math.max(0, cosTheta));
  return MIRROR.headOn + (MIRROR.graze - MIRROR.headOn) * g * g * g;
}

/**
 * The plate, as axis-aligned rectangles [x0, z0, x1, z1] in the deck's own
 * frame: wall to wall, bulkhead to lip, minus the pit. Four rectangles and not
 * one, because a single quad over the hole would put a reflection in mid-air
 * three metres above the pit's floor.
 */
export function mirrorRects() {
  const W = DECK.wall, A = DECK.aft, L = DECK.lip, P = MIRROR.pit;
  const px0 = P.x - P.hx, px1 = P.x + P.hx, pz0 = P.z - P.hz, pz1 = P.z + P.hz;
  return [
    [-W, A, W, pz0],        // aft of the pit, the full width
    [-W, pz1, W, L],        // forward of the pit, the full width
    [-W, pz0, px0, pz1],    // port of the pit
    [px1, pz0, W, pz1],     // starboard of the pit
  ];
}

/** The mirror's geometry: the rectangles above as two triangles each, at y = MIRROR.y. */
function mirrorGeometry() {
  const rects = mirrorRects();
  const pos = new Float32Array(rects.length * 4 * 3);
  const idx = [];
  rects.forEach(([x0, z0, x1, z1], r) => {
    const b = r * 4;
    pos.set([x0, MIRROR.y, z0, x1, MIRROR.y, z0, x1, MIRROR.y, z1, x0, MIRROR.y, z1], b * 3);
    /* Counter-clockwise seen from above (+y), so the front face is up. */
    idx.push(b, b + 2, b + 1, b, b + 3, b + 2);
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeBoundingSphere();
  g.computeBoundingBox();
  return g;
}

const VERT = /* glsl */`
  uniform mat4 uTexMat;
  varying vec4 vProj;
  varying vec3 vWorld;
  varying float vFogDepth;
  void main() {
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vWorld = wp.xyz;
    /* uTexMat already carries the mesh's own matrixWorld (folded in on the
     * CPU each frame, as three's Reflector does), so it maps OBJECT space. */
    vProj = uTexMat * vec4(position, 1.0);
    vec4 mv = viewMatrix * wp;
    vFogDepth = -mv.z;
    gl_Position = projectionMatrix * mv;
  }`;

const FRAG = /* glsl */`
  uniform sampler2D tMirror;
  uniform float uOn;
  /* three's fog block. fogColor is in the material's uniforms too — the
   * renderer writes it unconditionally for any fogged material — but nothing
   * here reads it, so it is not declared: an additive surface has no fog
   * colour to take on (below). */
  uniform float fogDensity;
  uniform float fogNear;
  uniform float fogFar;
  varying vec4 vProj;
  varying vec3 vWorld;
  varying float vFogDepth;
  void main() {
    vec2 uv = vProj.xy / vProj.w;
    /* The view-dependent strength: ${MIRROR.headOn.toFixed(3)} looking straight
     * down, ${MIRROR.graze.toFixed(3)} at grazing incidence, on a cubed curve
     * (see the file header for why not Schlick's fifth power). */
    vec3 v = cameraPosition - vWorld;
    float cosT = clamp(v.y / max(length(v), 1e-4), 0.0, 1.0);
    float g = 1.0 - cosT;
    float k = ${MIRROR.headOn.toFixed(3)} + (${MIRROR.graze.toFixed(3)} - ${MIRROR.headOn.toFixed(3)}) * g * g * g;
    /* The vertical smear: seven taps over ±${MIRROR.smear.toFixed(3)} of the
     * frame height along texture v, which for a point on the plane is the
     * screen's own vertical. Triangular weights. */
    vec3 c = vec3(0.0);
    float wsum = 0.0;
    for (int i = -3; i <= 3; i++) {
      float t = float(i) / 3.0;
      float w = 1.0 - abs(t) * 0.75;
      c += texture2D(tMirror, uv + vec2(0.0, t * ${MIRROR.smear.toFixed(3)})).rgb * w;
      wsum += w;
    }
    c /= wsum;
    /* AN ADDITIVE SURFACE FADES BY LOSING ITS OWN LIGHT, not by taking on the
     * fog's colour — the plate under it has already been fogged toward
     * fogColor by its own material, so mixing toward it here would add the
     * fog twice. The reflected scene was rendered with fog; this is the
     * extinction over the path from the plate to the eye. */
    float fogT = 1.0;
    #ifdef USE_FOG
      #ifdef FOG_EXP2
        fogT = exp(-fogDensity * fogDensity * vFogDepth * vFogDepth);
      #else
        fogT = 1.0 - smoothstep(fogNear, fogFar, vFogDepth);
      #endif
    #endif
    gl_FragColor = vec4(c * k * fogT * uOn, 1.0);
  }`;

/* Scratch, so the per-frame hook allocates nothing. */
const _size = new THREE.Vector2();
const _camPos = new THREE.Vector3();
const _fwd = new THREE.Vector3();
const _up = new THREE.Vector3();
const _at = new THREE.Vector3();
const _plane = new THREE.Plane();
const _n = new THREE.Vector3(0, 1, 0);
const _p0 = new THREE.Vector3();
const _clip = new THREE.Vector4();
const _q = new THREE.Vector4();

/**
 * The tier the world is running at.
 *
 * THE ENGINE'S, FIRST. `world.settings` is a COPY of main.js's settings taken
 * when the world was built (`worldSettings()`), so a tier the player changes
 * in the options screen mid-visit never reaches it; `engine.setQuality` is
 * what that screen calls, and `engine.quality` is the name it keeps. The
 * settings' tier is the answer only where there is no engine tier — the
 * headless harness, whose stub engine has none.
 */
function tierOf(world) {
  return world?.engine?.quality ?? world?.settings?.quality ?? 'high';
}

/**
 * Size the target off a frame. Exported so a check can size it without a
 * renderer. Returns the target, or null when the tier has switched the mirror
 * off.
 */
export function fitMirror(S, frameW, frameH) {
  if (!S || !(S.scale > 0)) return null;
  const w = Math.max(2, Math.round(frameW * S.scale));
  const h = Math.max(2, Math.round(frameH * S.scale));
  if (S.target.width !== w || S.target.height !== h) S.target.setSize(w, h);
  return S.target;
}

/** Move the mirror to a tier: its scale, and whether it exists at all. */
function applyTier(S, tier) {
  S.tier = tier;
  S.scale = mirrorScale(tier);
  if (S.scale === 0) {
    /* Off: hide the mesh and give the target back. A disposed target is
     * re-allocated by three the next time it is rendered into, so raising the
     * tier later needs no rebuild. */
    S.mesh.visible = false;
    S.material.uniforms.uOn.value = 0;
    if (S.target.width !== 2 || S.target.height !== 2) S.target.setSize(2, 2);
    S.target.dispose();
  }
}

/**
 * Point the mirrored camera. The real camera reflected about the plane:
 * position, forward and up all flipped in y about MIRROR.y. `lookAt` then
 * builds an orthonormal basis, and the handedness works out so that a point
 * ON the plane projects to the same screen height in both cameras with the
 * horizontal mirrored — which is what lets the shader's vertical blur be a
 * vertical blur on screen.
 */
function mirrorCamera(S, camera) {
  const e = camera.matrixWorld.elements;
  _camPos.setFromMatrixPosition(camera.matrixWorld);
  _fwd.set(-e[8], -e[9], -e[10]).normalize();
  _up.set(e[4], e[5], e[6]).normalize();
  const V = S.camera;
  V.position.set(_camPos.x, 2 * MIRROR.y - _camPos.y, _camPos.z);
  V.up.set(_up.x, -_up.y, _up.z);
  _at.set(V.position.x + _fwd.x, V.position.y - _fwd.y, V.position.z + _fwd.z);
  V.lookAt(_at);
  V.near = camera.near; V.far = camera.far;
  V.fov = camera.fov; V.aspect = camera.aspect; V.zoom = camera.zoom;
  V.updateMatrixWorld(true);
  V.matrixWorldInverse.copy(V.matrixWorld).invert();
  V.projectionMatrix.copy(camera.projectionMatrix);

  /* World → clip → [0,1], through the UNMODIFIED projection (the oblique
   * rewrite below touches only the z row, which the uv never reads). */
  S.texMat.set(
    0.5, 0.0, 0.0, 0.5,
    0.0, 0.5, 0.0, 0.5,
    0.0, 0.0, 0.5, 0.5,
    0.0, 0.0, 0.0, 1.0,
  );
  S.texMat.multiply(V.projectionMatrix);
  S.texMat.multiply(V.matrixWorldInverse);
  S.texMat.multiply(S.mesh.matrixWorld);

  /* THE OBLIQUE NEAR PLANE — Lengyel, "Oblique View Frustum Depth Projection
   * and Clipping". The mirror plane in the virtual camera's view space
   * replaces the near plane, so everything under the deck is clipped by the
   * hardware and nothing is added to any shader. The far plane goes
   * degenerate with it; depth precision far from the plane suffers, which on
   * a reflection nobody reads depth from costs nothing. */
  _p0.set(0, MIRROR.y, 0);
  _plane.setFromNormalAndCoplanarPoint(_n, _p0);
  _plane.applyMatrix4(V.matrixWorldInverse);
  _clip.set(_plane.normal.x, _plane.normal.y, _plane.normal.z, _plane.constant);
  const P = V.projectionMatrix.elements;
  _q.x = (Math.sign(_clip.x) + P[8]) / P[0];
  _q.y = (Math.sign(_clip.y) + P[9]) / P[5];
  _q.z = -1.0;
  _q.w = (1.0 + P[10]) / P[14];
  _clip.multiplyScalar(2.0 / _clip.dot(_q));
  P[2] = _clip.x;
  P[6] = _clip.y;
  P[10] = _clip.z + 1.0;
  P[14] = _clip.w;
  V.projectionMatrixInverse.copy(V.projectionMatrix).invert();
}

/**
 * Hide what the reflection does not need — the mirror itself, points, sprites
 * and every transparent material except the sky dome's — and remember what
 * was hidden so it can all come back. Objects are hidden and not removed, for
 * the reason the engine's light pool exists: the scene graph must not change
 * shape mid-frame.
 */
function hideForReflection(S, scene) {
  const hidden = S.hidden;
  hidden.length = 0;
  S.mesh.visible = false;
  scene.traverseVisible((o) => {
    if (o.isPoints || o.isSprite) { o.visible = false; hidden.push(o); return; }
    const m = o.material;
    if (!m || S.keep.has(o)) return;
    const list = Array.isArray(m) ? m : [m];
    for (const x of list) {
      if (x && x.transparent && !x.userData.saberMirror) { o.visible = false; hidden.push(o); return; }
    }
  });
}

function restoreAfterReflection(S) {
  for (const o of S.hidden) o.visible = true;
  S.hidden.length = 0;
  S.mesh.visible = true;
}

/**
 * The render hook. Runs inside the beauty pass, once, when the mirror mesh is
 * about to be drawn by the engine's own camera.
 */
function renderMirror(world, S, renderer, scene, camera) {
  const u = S.material.uniforms;
  if (S.rendering || S.disposed) return;
  /* ONE RENDER PER STEPPED FRAME. `stepDeckMirror` arms it; the first hook
   * to fire disarms it. Anything else — a second pass, a stray render — reads
   * the target as it is. */
  if (!S.armed) { S.skipped++; return; }
  /* THE ENGINE'S OWN CAMERA, and no other. The ink prepass renders through a
   * clone (`OutlinePass.prepass`); a shadow pass has its own; a probe may
   * render with anything. The reflection belongs to the frame the player
   * sees. */
  const main = world?.engine?.camera;
  if (main && camera !== main) { S.skipped++; return; }
  if (typeof renderer?.getDrawingBufferSize !== 'function' || typeof renderer.render !== 'function') return;
  S.armed = false;
  /* BELOW THE PLANE THERE IS NOTHING TO REFLECT. The camera in the pit, or
   * dropped through the floor, would see the room mirrored the wrong way. */
  _camPos.setFromMatrixPosition(camera.matrixWorld);
  if (_camPos.y <= MIRROR.y) { u.uOn.value = 0; S.below = true; S.skipped++; return; }
  S.below = false;

  renderer.getDrawingBufferSize(_size);
  fitMirror(S, _size.x, _size.y);
  mirrorCamera(S, camera);
  hideForReflection(S, scene);

  S.rendering = true;
  const prevTarget = renderer.getRenderTarget();
  const xr = renderer.xr;
  const prevXr = xr ? xr.enabled : false;
  const sm = renderer.shadowMap;
  const prevAuto = sm ? sm.autoUpdate : false;
  const prevNeeds = sm ? sm.needsUpdate : false;
  if (xr) xr.enabled = false;
  if (sm) { sm.autoUpdate = false; sm.needsUpdate = false; }
  renderer.setRenderTarget(S.target);
  /* The depth mask may be off after a depthWrite:false material; a clear with
   * it off leaves last frame's depth in the target (three #18897). */
  renderer.state?.buffers?.depth?.setMask?.(true);
  /* The composer's RenderPass runs with autoClear off; clear by hand or the
   * target keeps whatever it held. With a Colour background three clears
   * again to that colour, which is what the aperture's edges want. */
  if (renderer.autoClear === false) renderer.clear();
  try {
    renderer.render(scene, S.camera);
  } finally {
    if (xr) xr.enabled = prevXr;
    if (sm) { sm.autoUpdate = prevAuto; sm.needsUpdate = prevNeeds; }
    renderer.setRenderTarget(prevTarget);
    const vp = camera.viewport;
    if (vp !== undefined) renderer.state?.viewport?.(vp);
    restoreAfterReflection(S);
    S.rendering = false;
  }
  u.uTexMat.value.copy(S.texMat);
  u.uOn.value = 1;
  S.renders++;
}

/**
 * Build the mirror: the mesh, its material, its target and its camera, on
 * `world._deckMirror`. Returns the state, or null if there is no scene to put
 * it in. Idempotent — a second call hands back the first mirror.
 */
export function dressDeckMirror(world) {
  if (!world?.scene) return null;
  if (world._deckMirror) return world._deckMirror;

  const geometry = mirrorGeometry();
  const target = new THREE.WebGLRenderTarget(2, 2, {
    /* Linear filtering, because the smear is seven taps that fall between
     * texels at every resolution but the frame's own. HALF FLOAT, because the
     * rim and a lit blade sit above 1.0 and a byte target would clip them to
     * white before the strength ever multiplied them down. No mipmaps, no
     * samples: it is read once a frame at roughly its own scale. */
    minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter,
    type: THREE.HalfFloatType, generateMipmaps: false,
    colorSpace: THREE.LinearSRGBColorSpace, depthBuffer: true, stencilBuffer: false,
  });
  target.texture.name = 'deck-mirror';
  const material = new THREE.ShaderMaterial({
    name: 'deck-mirror',
    uniforms: Object.assign({
      uTexMat: { value: new THREE.Matrix4() },
      tMirror: { value: target.texture },
      uOn: { value: 0 },
    }, THREE.UniformsUtils.clone(THREE.UniformsLib.fog)),
    vertexShader: VERT,
    fragmentShader: FRAG,
    /* Additive over the plate: the floor's own material stays and the
     * reflection is light added to it, which is what a dark mirror is. No
     * depth write, so nothing standing on the deck is ever behind it. */
    transparent: true, depthWrite: false, depthTest: true,
    blending: THREE.AdditiveBlending, side: THREE.FrontSide,
    fog: true, lights: false,
    /* Pulled toward the camera in depth so the plane at +0.02 wins against
     * the plate at 0 all the way to the lip — see MIRROR.y. */
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4,
  });
  material.userData.saberNoInk = true;

  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = 'deck-mirror';
  /* First among the transparents, so smoke and the field blend OVER the
   * reflection rather than the reflection being added over them. */
  mesh.renderOrder = -1;
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  mesh.updateMatrixWorld(true);

  const camera = new THREE.PerspectiveCamera(60, 16 / 9, 0.05, 900);
  camera.name = 'deck-mirror-camera';

  const S = {
    mesh, material, geometry, target, camera,
    texMat: new THREE.Matrix4(),
    tier: null, scale: 0,
    /** A manual switch, for the profiler's A/B and nothing else. */
    enabled: true,
    armed: false, below: false, rendering: false, disposed: false,
    renders: 0, skipped: 0,
    /** Transparent objects kept in the reflection: the sky dome, always. */
    keep: new Set(),
    hidden: [],
  };
  const dome = world.engine?.skyDome?.mesh;
  if (dome) S.keep.add(dome);
  mesh.onBeforeRender = (renderer, scene, cam) => renderMirror(world, S, renderer, scene, cam);

  world.scene.add(mesh);
  world._deckMirror = S;
  applyTier(S, tierOf(world));
  /* Off until the first step arms it: the mesh is in the scene but the
   * target holds nothing yet, and adding an empty texture to the plate is
   * adding black, which is fine, but the uniform says so explicitly. */
  mesh.visible = S.scale > 0;
  return S;
}

/**
 * Once a frame, from the director: follow the tier, keep the mirror off when
 * the camera is under the plane, and arm exactly one reflection render.
 */
export function stepDeckMirror(world, dt) {
  const S = world?._deckMirror;
  if (!S || S.disposed) return;
  const tier = tierOf(world);
  if (tier !== S.tier) applyTier(S, tier);
  const cam = world.engine?.camera;
  S.below = !!cam && cam.position.y <= MIRROR.y;
  const on = S.enabled && S.scale > 0 && !S.below;
  S.mesh.visible = on;
  S.armed = on;
  if (!on) S.material.uniforms.uOn.value = 0;
}

/** Take the mirror out: the mesh from the scene, the target from the GPU. */
export function undressDeckMirror(world) {
  const S = world?._deckMirror;
  if (!S) return;
  S.disposed = true;
  S.armed = false;
  S.mesh.onBeforeRender = () => {};
  world.scene?.remove(S.mesh);
  S.material.uniforms.tMirror.value = null;
  S.geometry.dispose();
  S.material.dispose();
  S.target.dispose();
  S.keep.clear();
  S.hidden.length = 0;
  world._deckMirror = null;
}
