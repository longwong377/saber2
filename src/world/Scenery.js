/**
 * SABER — wind, ground cover, water and the air itself.
 *
 * Three ideas hold this file together.
 *
 * 1. There is ONE wind. `WindField` is a coherent, travelling gust field with a
 *    matching GLSL implementation, so a blade of grass, a sheet of blown sand,
 *    an ember and a column of smoke all lean the same way at the same moment.
 *    Everything else in the game can import `wind` and sample it.
 *
 * 2. The ground remembers. A single small wrapping "disturbance" texture rides
 *    with the player and records what has been walked through, slid across,
 *    blasted or cut. The grass reads it in the vertex shader, so trails,
 *    flattening and saber cuts cost one texture fetch instead of a uniform
 *    array with eight slots in it.
 *
 * 3. Grass is geometry, not a picture of grass. Near the camera each instance
 *    is a real tapered blade bent along a circular arc, lit with N·L, a
 *    wrap-around term and a translucency lobe, shadowed by the sun and fogged
 *    like everything else. Past that it degrades to a billboard tuft, which is
 *    where the instance budget actually goes.
 */

import * as THREE from 'three';
import { grassSprite, smokeSprite, radialSprite } from '../engine/Textures.js';
import { makeRng, clamp, fbm2, TAU } from '../engine/MathUtil.js';

const rng = makeRng(70707);
const _v1 = new THREE.Vector3(), _v2 = new THREE.Vector3();
const _col = new THREE.Color();

/* ══════════════════════════════════════════════════════════════════════ */
/*  Wind                                                                  */
/* ══════════════════════════════════════════════════════════════════════ */

/*
 * The gust field is three travelling sinusoids sharing one phase axis. That
 * sounds crude and is not: because every term is a function of `dot(p, dir)`
 * the whole pattern is a set of fronts perpendicular to the wind that march
 * downwind together, which is exactly what a gust looks like crossing a field.
 * Per-blade noise cannot do that — it shimmers instead of gusting.
 *
 * These constants are duplicated verbatim in WIND_GLSL below. If you touch one,
 * touch the other; `verify` compares the two behaviours through the shader's
 * own arithmetic.
 */
const GUST_K = 0.055;      // 1/m along the wind — front spacing ≈ 114m
const GUST_W = 0.62;       // rad/s — fronts travel at GUST_W/GUST_K ≈ 11 m/s
const GUST_CROSS = 0.037;  // 1/m across the wind, breaks up straight fronts
const SWIRL_K = 0.019, SWIRL_W = 0.21, SWIRL_A = 0.34;

export class WindField {
  constructor(opts = {}) {
    this.time = 0;
    this.baseHeading = opts.heading ?? 0.62;   // radians; the way the wind BLOWS
    this.strength = opts.strength ?? 1.7;      // metres/second at gust neutral
    this.gustiness = clamp(opts.gustiness ?? 0.62, 0, 0.95);
    this.wander = opts.wander ?? 1;            // how much the heading roams
    this.heading = this.baseHeading;
    this.dir = new THREE.Vector2(Math.cos(this.heading), Math.sin(this.heading));
  }

  /** Point the wind somewhere. `strength` and `gustiness` are optional. */
  set(heading, strength, gustiness) {
    this.baseHeading = heading;
    if (strength !== undefined) this.strength = strength;
    if (gustiness !== undefined) this.gustiness = clamp(gustiness, 0, 0.95);
    this._refresh();
    return this;
  }

  /** Adopt a direction and speed from a world vector (y is ignored). */
  setFromVector(v) {
    const m = Math.hypot(v.x, v.z);
    if (m > 1e-5) this.set(Math.atan2(v.z, v.x), m);
    return this;
  }

  _refresh() {
    // Two slow incommensurate terms: bounded, smooth, never repeating usefully.
    this.heading = this.baseHeading
      + (Math.sin(this.time * 0.083) * 0.35 + Math.sin(this.time * 0.031 + 1.7) * 0.22) * this.wander;
    this.dir.set(Math.cos(this.heading), Math.sin(this.heading));
  }

  update(dt) {
    this.time += dt;
    this._refresh();
    return this;
  }

  /** Signed gust, strictly within [-1, 1], coherent in space and travelling. */
  gust(x, z, t = this.time) {
    const a = (x * this.dir.x + z * this.dir.y) * GUST_K - t * GUST_W;
    const b = (-x * this.dir.y + z * this.dir.x) * GUST_CROSS;
    return Math.sin(a) * 0.55
         + Math.sin(a * 1.93 + b * 1.7 + 1.3) * 0.28
         + Math.sin(a * 0.47 - b * 0.83 - 0.7) * 0.17;
  }

  /** Wind speed at a point — never negative. */
  strengthAt(x, z, t = this.time) {
    return Math.max(0, this.strength * (1 + this.gustiness * this.gust(x, z, t)));
  }

  /** Full wind velocity, including the local swirl and a small updraft. */
  sample(x, z, out = new THREE.Vector3(), t = this.time) {
    const g = this.gust(x, z, t);
    const s = Math.max(0, this.strength * (1 + this.gustiness * g));
    const sw = Math.sin((-x * this.dir.y + z * this.dir.x) * SWIRL_K + t * SWIRL_W) * SWIRL_A;
    const c = Math.cos(sw), n = Math.sin(sw);
    const dx = this.dir.x * c - this.dir.y * n;
    const dz = this.dir.x * n + this.dir.y * c;
    return out.set(dx * s, s * 0.06 * g, dz * s);
  }

  /** Pack into the vec4 the shaders take: (dirX, dirZ, strength, time). */
  writeUniform(v4) { return v4.set(this.dir.x, this.dir.y, this.strength, this.time); }
}

/** The one wind every system samples. Import it; do not make another. */
export const wind = new WindField();

/** GLSL twin of WindField. Declares `uWind` (vec4) and `uGustiness` (float). */
export const WIND_GLSL = /* glsl */`
  uniform vec4 uWind;          // dirX, dirZ, strength, time
  uniform float uGustiness;
  float windGust(vec2 p){
    vec2 D = uWind.xy;
    float a = dot(p, D) * ${GUST_K.toFixed(6)} - uWind.w * ${GUST_W.toFixed(6)};
    float b = dot(p, vec2(-D.y, D.x)) * ${GUST_CROSS.toFixed(6)};
    return sin(a) * 0.55
         + sin(a * 1.93 + b * 1.7 + 1.3) * 0.28
         + sin(a * 0.47 - b * 0.83 - 0.7) * 0.17;
  }
  vec3 windAt(vec2 p){
    float g = windGust(p);
    float s = max(0.0, uWind.z * (1.0 + uGustiness * g));
    float sw = sin(dot(p, vec2(-uWind.y, uWind.x)) * ${SWIRL_K.toFixed(6)}
                   + uWind.w * ${SWIRL_W.toFixed(6)}) * ${SWIRL_A.toFixed(6)};
    float c = cos(sw), n = sin(sw);
    vec2 d = vec2(uWind.x * c - uWind.y * n, uWind.x * n + uWind.y * c);
    return vec3(d.x * s, s * 0.06 * g, d.y * s);
  }
`;

/** Fresh uniform objects for a material that includes WIND_GLSL. */
export function windUniforms() {
  return {
    uWind: { value: new THREE.Vector4(wind.dir.x, wind.dir.y, wind.strength, 0) },
    uGustiness: { value: wind.gustiness },
  };
}

/** Push the shared wind into a material built with `windUniforms()`. */
export function syncWind(uniforms) {
  if (!uniforms || !uniforms.uWind) return;
  wind.writeUniform(uniforms.uWind.value);
  uniforms.uGustiness.value = wind.gustiness;
}

/* ══════════════════════════════════════════════════════════════════════ */
/*  The broker                                                            */
/* ══════════════════════════════════════════════════════════════════════ */

/**
 * Particles and scenery need to see each other — a splash has to ring the
 * water, a saber cut has to shorten the grass and throw clippings — without
 * either owning the other and without the World having to wire it up. This is
 * the whole of that coupling.
 */
export const ground = {
  wind,
  grass: null,     // the live GrassField, if the level has one
  water: null,     // the live Water, if the level has one
  fx: null,        // the live Particles facade
  terrain: null,   // published by whoever was handed one

  /** Press / cut / scar the ground cover at a point. Safe with nothing there. */
  disturb(x, z, radius, opts) { ground.grass?.disturb(x, z, radius, opts); },
  /** Ring the water surface. Safe with no water in the level. */
  ripple(x, z, strength) { ground.water?.ripple(x, z, strength); },
  /** Ground height if anyone published a terrain, else null. */
  heightAt(x, z) { return ground.terrain ? ground.terrain.height(x, z) : null; },
};

/* ── small shared helpers ────────────────────────────────────────────── */

/** The sun and the sky fill, dug out of the scene the level just built. */
function sceneLights(scene) {
  let sun = null, hemi = null;
  for (const c of scene.children) {
    if (c.isDirectionalLight && (!sun || (c.castShadow && !sun.castShadow))) sun = c;
    else if (c.isHemisphereLight && !hemi) hemi = c;
  }
  return { sun, hemi };
}

function fogColorOf(scene, out = new THREE.Color()) {
  return scene.fog ? out.copy(scene.fog.color) : out.setRGB(0.72, 0.68, 0.6);
}

/** True when the level is under a sky rather than under a roof. */
function isOutdoor(scene) {
  return !(scene.background && scene.background.isColor);
}

/**
 * Match this frame's pushers against last frame's so each one gets a velocity.
 * The World hands over a bare list of positions whose order changes as enemies
 * die, so identity is recovered by proximity — which is exactly right here: if
 * two bodies swapped places within one frame the grass cannot tell either.
 */
export class PusherTracker {
  constructor(maxMatch = 2.5) {
    this.maxMatch = maxMatch;
    this.prev = [];         // {x, z, vx, vz} from last frame
    this.out = [];          // reused result slots — this runs every frame
    this._used = [];
  }

  _slot(i) {
    let s = this.out[i];
    if (!s) s = this.out[i] = { x: 0, y: 0, z: 0, r: 1.1, vx: 0, vz: 0, speed: 0 };
    return s;
  }

  /**
   * Returns the tracker's own slot objects — read them this frame, do not keep
   * them. This runs every frame for every body in the field; allocating a fresh
   * array of records here would be pure garbage.
   */
  update(list, dt) {
    const inv = dt > 1e-5 ? 1 / dt : 0;
    const used = this._used;
    used.length = this.prev.length;
    used.fill(false);

    const n = list.length;
    for (let i = 0; i < n; i++) {
      const p = list[i];
      let best = -1, bestD = this.maxMatch * this.maxMatch;
      for (let k = 0; k < this.prev.length; k++) {
        if (used[k]) continue;
        const q = this.prev[k];
        const d = (q.x - p.x) * (q.x - p.x) + (q.z - p.z) * (q.z - p.z);
        if (d < bestD) { bestD = d; best = k; }
      }
      const s = this._slot(i);
      s.x = p.x; s.y = p.y; s.z = p.z; s.r = p.w || p.r || 1.1;
      if (best >= 0) {
        used[best] = true;
        const q = this.prev[best];
        // one frame of a 60Hz clock is a noisy derivative; smooth it
        s.vx = q.vx * 0.55 + (p.x - q.x) * inv * 0.45;
        s.vz = q.vz * 0.55 + (p.z - q.z) * inv * 0.45;
      } else { s.vx = 0; s.vz = 0; }
      s.speed = Math.hypot(s.vx, s.vz);
    }

    this.prev.length = n;
    for (let i = 0; i < n; i++) {
      const s = this.out[i];
      const q = this.prev[i] || (this.prev[i] = { x: 0, z: 0, vx: 0, vz: 0 });
      q.x = s.x; q.z = s.z; q.vx = s.vx; q.vz = s.vz;
    }
    // the caller must only read the first `n`; hand back exactly that
    return n === this.out.length ? this.out : this.out.slice(0, n);
  }

  reset() { this.prev.length = 0; this.out.length = 0; }
}

/* ══════════════════════════════════════════════════════════════════════ */
/*  Grass                                                                 */
/* ══════════════════════════════════════════════════════════════════════ */

const TRAIL_RES = 128;      // texels across the disturbance window
const TRAIL_SIZE = 40;      // metres across the disturbance window
const TRAIL_HOLD = 6;       // seconds of decay after the last splat

const GRASS_VERT = /* glsl */`
  precision highp float;
  #include <common>
  #include <fog_pars_vertex>
  #include <shadowmap_pars_vertex>
  ${WIND_GLSL}

  attribute vec4 aInst;      // world x, ground y, world z, height
  attribute vec4 aOrient;    // facing x, facing z, natural lean, phase
  attribute vec3 aTint;

  uniform float uTime;
  uniform vec3 uCenter;
  uniform float uNear;       // where this ring starts fading in
  uniform float uFar;        // where this ring is gone
  uniform float uWidth;
  uniform float uBendGain;
  uniform sampler2D uTrail;
  uniform vec2 uTrailCenter;
  uniform float uTrailSize;

  varying vec2 vUv;
  varying vec3 vTint;
  varying vec3 vNormal;
  varying vec3 vWorld;
  varying float vHeight;
  varying float vCut;

  void main(){
    vUv = uv;
    vTint = aTint;
    vec3 base = aInst.xyz;
    float h = uv.y;

    // ── ring fade. Blades shrink to nothing at the ends of their annulus so
    // the hand-off to the billboard ring, and the reshuffle at the outer edge,
    // never pop. A ring that starts at zero has no inner edge to fade — doing
    // it anyway clears the grass out from under the player's own feet.
    float d = distance(base.xz, uCenter.xz);
    float fade = (uNear > 0.01 ? smoothstep(uNear, uNear * 1.55, d) : 1.0)
               * (1.0 - smoothstep(uFar * 0.80, uFar * 0.99, d));
    float len = aInst.w * fade;
    if(len <= 0.004){
      gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
      vNormal = vec3(0.0, 1.0, 0.0); vWorld = base; vHeight = 0.0; vCut = 0.0;
      #ifdef USE_FOG
        vFogDepth = 0.0;
      #endif
      return;
    }

    // ── what the ground remembers here
    vec4 tr = texture2D(uTrail, fract(base.xz / uTrailSize));
    float valid = 1.0 - smoothstep(uTrailSize * 0.30, uTrailSize * 0.46,
                                   distance(base.xz, uTrailCenter));
    float press = tr.r * valid;
    float cut   = tr.g * valid;
    vec2 shove  = (tr.ba * 2.0 - 1.0) * valid;

    len *= (1.0 - cut * 0.80) * (1.0 - press * 0.30);
    vCut = cut;

    // ── bend. One vector; wind, the natural lean and everything that has been
    // through here all add into it, and the blade is then swept along a
    // circular arc of that total curvature. Adding them as ANGLES instead would
    // let a gust and a bootprint cancel out, which is not how grass works.
    vec3 w = windAt(base.xz);
    float wmag = length(w.xz);
    vec2 wdir = wmag > 1e-4 ? w.xz / wmag : aOrient.xy;
    float flutter = sin(uTime * (5.0 + aOrient.w * 4.0) + aOrient.w * 6.2831) * 0.09
                  * (0.25 + wmag);

    vec2 bv = wdir * (uBendGain * wmag + flutter)
            + aOrient.xy * aOrient.z
            + shove * (press * 2.2)
            + wdir * (press * 0.4);
    float bend = length(bv);
    vec2 bdir = bend > 1e-4 ? bv / bend : aOrient.xy;
    bend = min(bend + press * 1.15, 2.0);

    // ── sweep the blade along the arc (series form of sin/cos, no divide)
    vec3 bd = vec3(bdir.x, 0.0, bdir.y);
    vec3 sideV = vec3(-bd.z, 0.0, bd.x);
    float s = h * len;
    float ks = bend * h;
    float t2 = ks * ks;
    float cy = s * (1.0 - t2 * 0.1666667 + t2 * t2 * 0.0083333);
    float cx = s * ks * (0.5 - t2 * 0.0416667);

    // ── width. Widest at the sheath, a point at the tip. (pow() of an exact
    // zero is undefined in GLSL ES; keep the base off it.)
    float wdt = uWidth * len * pow(max(1.0 - h, 0.001), 0.55);

    vec3 world = base + bd * cx + vec3(0.0, cy, 0.0) + sideV * (position.x * wdt);

    // ── normal: the arc's tangent crossed with the blade's width axis, then
    // fanned across the width so the blade shades like the curved trough it is
    vec3 tang = sin(ks) * bd + cos(ks) * vec3(0.0, 1.0, 0.0);
    vec3 nrm = normalize(cross(tang, sideV) + sideV * (position.x * 1.4));
    vNormal = nrm;
    vWorld = world;
    vHeight = h;

    vec4 worldPosition = vec4(world, 1.0);
    vec3 transformedNormal = mat3(viewMatrix) * nrm;
    #include <shadowmap_vertex>
    vec4 mvPosition = viewMatrix * worldPosition;
    #include <fog_vertex>
    gl_Position = projectionMatrix * mvPosition;
  }
`;

const GRASS_CARD_VERT = /* glsl */`
  precision highp float;
  #include <common>
  #include <fog_pars_vertex>
  #include <shadowmap_pars_vertex>
  ${WIND_GLSL}

  attribute vec4 aInst;
  attribute vec4 aOrient;
  attribute vec3 aTint;

  uniform float uTime;
  uniform vec3 uCenter;
  uniform float uNear;
  uniform float uFar;
  uniform float uWidth;
  uniform float uBendGain;
  uniform sampler2D uTrail;
  uniform vec2 uTrailCenter;
  uniform float uTrailSize;

  varying vec2 vUv;
  varying vec3 vTint;
  varying vec3 vNormal;
  varying vec3 vWorld;
  varying float vHeight;
  varying float vCut;

  void main(){
    // A tuft is many blades, so the sprite tiles across the card and each
    // instance starts at its own phase — otherwise every clump in the field is
    // visibly the same four blades.
    vUv = vec2(uv.x * 3.0 + aOrient.w * 4.0, uv.y);
    vTint = aTint;
    vec3 base = aInst.xyz;
    float h = uv.y;

    float d = distance(base.xz, uCenter.xz);
    // fully in by the range the geometry ring has faded out at, so the two
    // rings hand over without a visible band of thin cover between them
    float fade = (uNear > 0.01 ? smoothstep(uNear, uNear * 1.55, d) : 1.0)
               * (1.0 - smoothstep(uFar * 0.78, uFar * 0.99, d));
    float len = aInst.w * fade;
    if(len <= 0.004){
      gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
      vNormal = vec3(0.0, 1.0, 0.0); vWorld = base; vHeight = 0.0; vCut = 0.0;
      #ifdef USE_FOG
        vFogDepth = 0.0;
      #endif
      return;
    }

    vec4 tr = texture2D(uTrail, fract(base.xz / uTrailSize));
    float valid = 1.0 - smoothstep(uTrailSize * 0.30, uTrailSize * 0.46,
                                   distance(base.xz, uTrailCenter));
    float press = tr.r * valid;
    float cut   = tr.g * valid;
    vec2 shove  = (tr.ba * 2.0 - 1.0) * valid;
    len *= (1.0 - cut * 0.80) * (1.0 - press * 0.35);
    vCut = cut;

    vec3 w = windAt(base.xz);
    float wmag = length(w.xz);
    vec2 wdir = wmag > 1e-4 ? w.xz / wmag : aOrient.xy;
    vec2 bv = wdir * (uBendGain * wmag * 0.8
                      + sin(uTime * 2.2 + aOrient.w * 6.2831) * 0.06 * wmag)
            + shove * (press * 1.8);
    // a tuft is many blades: it leans, it does not curl over
    vec2 lean = bv * (h * h) * len * 0.5;

    // billboard around Y so a tuft keeps its width whatever the camera does
    vec3 toCam = vec3(cameraPosition.x - base.x, 0.0, cameraPosition.z - base.z);
    float tl = length(toCam);
    toCam = tl > 1e-4 ? toCam / tl : vec3(0.0, 0.0, 1.0);
    vec3 sideV = vec3(-toCam.z, 0.0, toCam.x);

    // Cards are wide because they have to be: the far ring spreads a fixed
    // instance budget over thirty times the area of the near one, so each
    // instance has to stand in for a patch rather than for a plant. They widen
    // further out again, where a gap between clumps would be a bald spot.
    float widen = 0.8 + 0.7 * (d / uFar);
    vec3 world = base
               + sideV * (position.x * uWidth * len * 2.2 * widen)
               + vec3(lean.x, h * len, lean.y);

    // a tuft is a soft rounded mass; face it half at the camera, half upward
    vNormal = normalize(mix(vec3(0.0, 1.0, 0.0), toCam, 0.45));
    vWorld = world;
    vHeight = h;

    vec4 worldPosition = vec4(world, 1.0);
    vec3 transformedNormal = mat3(viewMatrix) * vNormal;
    #include <shadowmap_vertex>
    vec4 mvPosition = viewMatrix * worldPosition;
    #include <fog_vertex>
    gl_Position = projectionMatrix * mvPosition;
  }
`;

const GRASS_FRAG = /* glsl */`
  precision highp float;
  #include <common>
  #include <packing>
  #include <fog_pars_fragment>
  #include <lights_pars_begin>
  #include <shadowmap_pars_fragment>
  #include <shadowmask_pars_fragment>

  uniform sampler2D uMap;
  uniform vec3 uDry;
  uniform float uTranslucency;
  uniform float uAmbientBoost;

  varying vec2 vUv;
  varying vec3 vTint;
  varying vec3 vNormal;
  varying vec3 vWorld;
  varying float vHeight;
  varying float vCut;

  void main(){
    #ifdef CARD
      float a = texture2D(uMap, vUv).a;
      if(a < 0.42) discard;
    #endif

    vec3 V = normalize(cameraPosition - vWorld);
    vec3 N = normalize(vNormal);
    // grass is thin: whichever way you look at it you see the lit side
    if(dot(N, V) < 0.0) N = -N;
    // three keeps every light direction in VIEW space, so lighting either
    // happens there or the directions come back out; N is a world normal here
    vec3 Nv = mat3(viewMatrix) * N;

    // ── base colour: dry and pale at the root, saturated at the tip, plus the
    // ambient occlusion of standing inside your own clump. The occlusion floor
    // has to stay well off zero — a tuft whose lower half is black reads as a
    // separate black object sitting under a green one.
    vec3 albedo = mix(uDry, vTint, smoothstep(0.0, 0.42, vHeight));
    float ao = 0.48 + 0.52 * smoothstep(0.0, 0.45, vHeight);
    // a cut blade shows its pale severed end
    albedo = mix(albedo, mix(albedo, vec3(0.86, 0.84, 0.62), 0.55),
                 vCut * smoothstep(0.55, 1.0, vHeight));

    // The terrain underneath is lit by sun, hemisphere AND a sky probe. There
    // is no probe here, so the hemisphere term stands in for it.
    vec3 irradiance = ambientLightColor;
    #if NUM_HEMI_LIGHTS > 0
      #pragma unroll_loop_start
      for(int i = 0; i < NUM_HEMI_LIGHTS; i++){
        irradiance += getHemisphereLightIrradiance(hemisphereLights[i], Nv) * uAmbientBoost;
      }
      #pragma unroll_loop_end
    #endif

    vec3 direct = vec3(0.0);
    float shadow = getShadowMask();
    #if NUM_DIR_LIGHTS > 0
      // NB: the unroll pragma pastes this body once per light into the SAME
      // scope, so anything declared here has to get a block of its own or the
      // second light is a pile of redefinition errors.
      #pragma unroll_loop_start
      for(int i = 0; i < NUM_DIR_LIGHTS; i++){
        {
          vec3 L = inverseTransformDirection(directionalLights[i].direction, viewMatrix);
          // half-lambert: a blade lit from behind is not black, it is dim
          float wrap = clamp(dot(N, L) * 0.62 + 0.38, 0.0, 1.0);
          // and light coming THROUGH it is what makes a field glow at low sun
          float back = pow(clamp(dot(-V, L), 0.0, 1.0), 3.0) * uTranslucency
                     * smoothstep(0.0, 0.6, vHeight);
          direct += directionalLights[i].color * (wrap * shadow + back * (0.35 + 0.65 * shadow));
        }
      }
      #pragma unroll_loop_end
    #endif

    vec3 col = albedo * RECIPROCAL_PI * ao * (irradiance + direct);
    gl_FragColor = vec4(col, 1.0);
    #include <fog_fragment>
  }
`;

export class GrassField {
  constructor(scene, terrain, opts = {}) {
    this.scene = scene;
    this.terrain = terrain;
    if (terrain) ground.terrain = terrain;
    this.radius = opts.radius ?? 42;
    this.nearRadius = Math.min(opts.nearRadius ?? 10, this.radius * 0.5);
    this.time = 0;
    this.meshes = [];
    this.tracker = new PusherTracker();

    const density = opts.density ?? 1;
    const total = Math.max(0, Math.floor((opts.count ?? 9000) * density));
    this.count = total;
    if (total === 0) { this.mesh = null; return; }

    this.tintA = new THREE.Color(opts.tintA ?? 0x9aa860);
    this.tintB = new THREE.Color(opts.tintB ?? 0x5d6b34);
    this.dry = new THREE.Color(opts.dry ?? 0x6a6142);

    this._buildTrail();

    // Half the instances go to the near ring, which is deliberately small: a
    // field only reads as grass if the blades you can actually resolve are
    // packed, and packing ten metres costs a fifth of what packing twenty does.
    const nearCount = Math.max(1, Math.round(total * 0.5));
    const farCount = Math.max(1, total - nearCount);

    this.near = this._buildRing({
      count: nearCount, card: false,
      geometry: bladeGeometry(4),
      near: 0, far: this.nearRadius,
      width: 0.048, bendGain: 0.23, translucency: 0.9,
    });
    this.far = this._buildRing({
      count: farCount, card: true,
      geometry: new THREE.PlaneGeometry(1, 1, 1, 2),
      near: this.nearRadius * 0.66, far: this.radius,
      width: 0.95, bendGain: 0.34, translucency: 0.55,
      map: repeating(grassSprite(96)),
    });
    this.mesh = this.near.mesh;     // kept for anything that pokes at `.mesh`

    this.center = new THREE.Vector3(1e9, 0, 1e9);
    ground.grass = this;
  }

  /* ── the ground's memory ───────────────────────────────────────────── */

  _buildTrail() {
    const N = TRAIL_RES;
    this.trailRes = N;
    this.trailSize = TRAIL_SIZE;
    this.trailCell = TRAIL_SIZE / N;
    const data = new Uint8Array(N * N * 4);
    for (let o = 0; o < data.length; o += 4) { data[o + 2] = 128; data[o + 3] = 128; }
    this.trailData = data;
    const tex = new THREE.DataTexture(data, N, N, THREE.RGBAFormat);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.minFilter = tex.magFilter = THREE.LinearFilter;
    tex.generateMipmaps = false;
    tex.needsUpdate = true;
    this.trailTex = tex;
    this.trailCenter = new THREE.Vector2(0, 0);
    this._ti = 0; this._tj = 0;
    this._trailHot = 0;
    this._trailDirty = false;
  }

  _clearCol(i) {
    const N = this.trailRes, d = this.trailData;
    const ii = ((i % N) + N) % N;
    for (let j = 0; j < N; j++) {
      const o = (j * N + ii) * 4;
      d[o] = 0; d[o + 1] = 0; d[o + 2] = 128; d[o + 3] = 128;
    }
  }

  _clearRow(j) {
    const N = this.trailRes, d = this.trailData;
    const jj = ((j % N) + N) % N;
    for (let i = 0; i < N; i++) {
      const o = (jj * N + i) * 4;
      d[o] = 0; d[o + 1] = 0; d[o + 2] = 128; d[o + 3] = 128;
    }
  }

  /**
   * Slide the disturbance window to follow the camera. Addressing is toroidal,
   * so a column leaving the back of the window has the same texel index as the
   * one arriving at the front — moving the window is just clearing that column.
   */
  _scrollTrail(cx, cz) {
    const N = this.trailRes, cell = this.trailCell, half = N / 2;
    const ni = Math.floor(cx / cell), nj = Math.floor(cz / cell);
    let di = ni - this._ti, dj = nj - this._tj;
    if (di === 0 && dj === 0) return;
    if (Math.abs(di) >= N || Math.abs(dj) >= N) {
      const d = this.trailData;
      for (let o = 0; o < d.length; o += 4) { d[o] = 0; d[o + 1] = 0; d[o + 2] = 128; d[o + 3] = 128; }
    } else {
      for (let k = 0; k < Math.abs(di); k++) {
        this._clearCol(di > 0 ? this._ti + half + 1 + k : this._ti - half - k);
      }
      for (let k = 0; k < Math.abs(dj); k++) {
        this._clearRow(dj > 0 ? this._tj + half + 1 + k : this._tj - half - k);
      }
    }
    this._ti = ni; this._tj = nj;
    this._trailDirty = true;
  }

  /**
   * Press, shove, scar or cut the cover.
   *
   * @param {number} radius   metres
   * @param {object} opts     press 0..1, cut 0..1, dirX/dirZ shove direction
   */
  disturb(x, z, radius, { press = 0, cut = 0, dirX = 0, dirZ = 0 } = {}) {
    if (!this.trailData) return;
    // Addressing wraps, so anything outside the window would alias onto a texel
    // belonging to a completely different patch of ground. Drop it instead.
    const away = Math.max(Math.abs(x - this.trailCenter.x), Math.abs(z - this.trailCenter.y));
    if (away > this.trailSize * 0.47) return;
    const N = this.trailRes, cell = this.trailCell, d = this.trailData;
    const r = Math.max(cell * 0.75, radius);
    const inv = 1 / r;
    const i0 = Math.floor((x - r) / cell), i1 = Math.ceil((x + r) / cell);
    const j0 = Math.floor((z - r) / cell), j1 = Math.ceil((z + r) / cell);
    const hasDir = dirX !== 0 || dirZ !== 0;
    let touched = false;
    for (let j = j0; j <= j1; j++) {
      const wz = (j + 0.5) * cell;
      const tj = ((j % N) + N) % N;
      for (let i = i0; i <= i1; i++) {
        const wx = (i + 0.5) * cell;
        const dx = (wx - x) * inv, dz = (wz - z) * inv;
        const q = dx * dx + dz * dz;
        if (q > 1) continue;
        // saturate the core, so a splat lands as a definite mark with a soft
        // edge rather than a cone that only reaches full strength at one texel
        const k = Math.min(1, (1 - q) * 1.45);
        const ti = ((i % N) + N) % N;
        const o = (tj * N + ti) * 4;
        if (press > 0) {
          const v = press * k * 255;
          if (v > d[o]) d[o] = v;
        }
        if (cut > 0) {
          const v = cut * k * 255;
          if (v > d[o + 1]) d[o + 1] = v;
        }
        if (hasDir) {
          const w = k * 0.75;
          d[o + 2] += (128 + dirX * 127 - d[o + 2]) * w;
          d[o + 3] += (128 + dirZ * 127 - d[o + 3]) * w;
        }
        touched = true;
      }
    }
    if (touched) { this._trailDirty = true; this._trailHot = TRAIL_HOLD; }
  }

  /**
   * Read back what the ground remembers at a point — what the vertex shader
   * sees. Outside the window everything reads as undisturbed.
   */
  sampleTrail(x, z, out = { press: 0, cut: 0, dirX: 0, dirZ: 0, inside: false }) {
    out.press = 0; out.cut = 0; out.dirX = 0; out.dirZ = 0; out.inside = false;
    if (!this.trailData) return out;
    const away = Math.max(Math.abs(x - this.trailCenter.x), Math.abs(z - this.trailCenter.y));
    if (away > this.trailSize * 0.47) return out;
    const N = this.trailRes, cell = this.trailCell;
    const i = ((Math.floor(x / cell) % N) + N) % N;
    const j = ((Math.floor(z / cell) % N) + N) % N;
    const o = (j * N + i) * 4;
    const d = this.trailData;
    out.press = d[o] / 255;
    out.cut = d[o + 1] / 255;
    out.dirX = (d[o + 2] / 255) * 2 - 1;
    out.dirZ = (d[o + 3] / 255) * 2 - 1;
    out.inside = true;
    return out;
  }

  /**
   * A blade swept from `a` to `b`. Everything under the sweep is cut short and
   * the clippings are thrown, which is why the swing reads as having removed
   * something rather than as having recoloured it.
   */
  cut(a, b, radius = 0.28, opts = {}) {
    if (!this.trailData) return 0;
    const dx = b.x - a.x, dz = b.z - a.z;
    const len = Math.hypot(dx, dz);
    const steps = Math.min(24, Math.max(1, Math.ceil(len / (radius * 0.8))));
    const depth = opts.cut ?? 0.92;
    for (let s = 0; s <= steps; s++) {
      const t = steps ? s / steps : 0;
      this.disturb(a.x + dx * t, a.z + dz * t, radius, {
        cut: depth, press: 0.5,
        dirX: len > 1e-4 ? dx / len : 0, dirZ: len > 1e-4 ? dz / len : 0,
      });
    }
    if (opts.clippings !== false && ground.fx) {
      ground.fx.grassClippings(a, b, this.tintB.getHex(), Math.min(1, 0.4 + len));
    }
    return steps + 1;
  }

  /* ── scatter ───────────────────────────────────────────────────────── */

  _buildRing({ count, card, geometry, near, far, width, bendGain, translucency, map }) {
    const geo = new THREE.InstancedBufferGeometry();
    geo.index = geometry.index;
    geo.attributes.position = geometry.attributes.position;
    geo.attributes.uv = geometry.attributes.uv;
    geo.instanceCount = count;

    const aInst = new THREE.InstancedBufferAttribute(new Float32Array(count * 4), 4);
    const aOrient = new THREE.InstancedBufferAttribute(new Float32Array(count * 4), 4);
    const aTint = new THREE.InstancedBufferAttribute(new Float32Array(count * 3), 3);
    for (const a of [aInst, aOrient, aTint]) a.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('aInst', aInst);
    geo.setAttribute('aOrient', aOrient);
    geo.setAttribute('aTint', aTint);

    const uniforms = THREE.UniformsUtils.merge([THREE.UniformsLib.lights, THREE.UniformsLib.fog]);
    Object.assign(uniforms, windUniforms(), {
      uMap: { value: map || null },
      uTime: { value: 0 },
      uCenter: { value: new THREE.Vector3() },
      uNear: { value: near },
      uFar: { value: far },
      uWidth: { value: width },
      uBendGain: { value: bendGain },
      uTranslucency: { value: translucency },
      // The terrain the grass grows out of is also lit by the sky probe, and
      // that probe is worth several times the hemisphere light on its own. With
      // no probe here the hemisphere has to carry both, or grass in shadow
      // reads as a different, much darker material than the ground beside it.
      uAmbientBoost: { value: 4.0 },
      uDry: { value: this.dry.clone() },
      uTrail: { value: this.trailTex },
      uTrailCenter: { value: this.trailCenter },
      uTrailSize: { value: this.trailSize },
    });

    const mat = new THREE.ShaderMaterial({
      uniforms,
      defines: card ? { CARD: '' } : {},
      vertexShader: card ? GRASS_CARD_VERT : GRASS_VERT,
      fragmentShader: GRASS_FRAG,
      side: THREE.DoubleSide,
      lights: true,
      fog: true,
      transparent: false,
    });

    const mesh = new THREE.Mesh(geo, mat);
    mesh.frustumCulled = false;
    mesh.matrixAutoUpdate = false;
    mesh.castShadow = false;
    mesh.receiveShadow = true;
    this.scene.add(mesh);
    this.meshes.push(mesh);

    return { mesh, mat, geo, aInst, aOrient, aTint, count, near, far, card };
  }

  /**
   * Scatter one ring.
   *
   * Grass grows in TUFTS, and that is not a detail — a uniform scatter of the
   * same instance count reads as a field of isolated spikes no matter how many
   * you spend, because real cover gets its density from blades standing beside
   * each other. Placing them in fives inside a hand's width buys apparent
   * density for nothing, and the gaps between tufts are what make it read as
   * ground rather than as carpet.
   */
  _scatterRing(ring, center) {
    const a = ring.aInst.array, o = ring.aOrient.array, t = ring.aTint.array;
    const inner = ring.card ? this.nearRadius * 0.62 : 0;
    const outer = ring.far;
    const span = outer * outer - inner * inner;
    const waterLine = ground.water ? ground.water.level : null;
    const perTuft = ring.card ? 2 : 5;
    const spread = ring.card ? 0.55 : 0.13;

    let left = 0, tx = 0, tz = 0, density = 0, live = false, lean = 0;
    for (let i = 0; i < ring.count; i++) {
      if (left <= 0) {
        const ang = rng() * TAU;
        const rad = Math.sqrt(inner * inner + rng() * span);
        tx = center.x + Math.cos(ang) * rad;
        tz = center.z + Math.sin(ang) * rad;
        const slope = this.terrain ? this.terrain.slopeAt(tx, tz) : 0;
        const y = this.terrain ? this.terrain.height(tx, tz) : 0;
        // Steep ground carries little, and clumping comes from a low-frequency
        // field so the cover reads as patches. Water thins it rather than
        // cutting it dead: the interesting grass in a river wash is the reeds
        // standing in the shallows along the margin.
        const clump = clamp(fbm2(tx * 0.028, tz * 0.028, 3) * 1.15 + 0.58, 0, 1);
        const wet = waterLine === null ? 1 : clamp((y - (waterLine - 0.30)) / 0.45, 0, 1);
        density = clamp(1 - slope * 1.7, 0, 1) * clump * wet;
        live = density > 0.14;
        lean = 0.16 + rng() * 0.42;      // a tuft leans together, not per blade
        left = perTuft;
      }
      left--;

      const x = tx + (rng() - 0.5) * spread;
      const z = tz + (rng() - 0.5) * spread;
      const y = this.terrain ? this.terrain.height(x, z) : 0;
      const base = ring.card ? 0.50 : 0.40;
      const varies = ring.card ? 0.44 : 0.52;
      const scale = live ? (base + rng() * varies) * clamp(density * 1.8, 0.4, 1.5) : 0;

      a[i * 4] = x;
      a[i * 4 + 1] = y - 0.02;
      a[i * 4 + 2] = z;
      a[i * 4 + 3] = scale;

      const fa = rng() * TAU;
      o[i * 4] = Math.cos(fa);
      o[i * 4 + 1] = Math.sin(fa);
      o[i * 4 + 2] = lean * (0.6 + rng() * 0.8);
      o[i * 4 + 3] = rng();

      _col.copy(this.tintA).lerp(this.tintB, rng() * 0.9);
      // a little per-blade value noise stops the field reading as one flat hue
      const v = 0.82 + rng() * 0.36;
      t[i * 3] = _col.r * v; t[i * 3 + 1] = _col.g * v; t[i * 3 + 2] = _col.b * v;
    }
    ring.aInst.needsUpdate = true;
    ring.aOrient.needsUpdate = true;
    ring.aTint.needsUpdate = true;
    ring.mat.uniforms.uCenter.value.copy(center);
  }

  /* ── frame ─────────────────────────────────────────────────────────── */

  /**
   * @param {THREE.Vector3} center   what to keep the field around
   * @param {Array} pushers          [{x,y,z,w}] — bodies moving through it
   * @param {THREE.Color} [sunColor] ignored — the grass reads the scene's own
   *                                  lights now, so it stays consistent with
   *                                  the ground it grows out of. Kept so the
   *                                  existing call site does not have to change.
   */
  update(dt, center, pushers = [], sunColor, opts = {}) {
    if (!this.mesh) return;
    this.time += dt;

    // The window has to be where the player is BEFORE anything splats into it,
    // or the first frame of a level writes into the wrong patch of ground.
    this._scrollTrail(center.x, center.z);
    this.trailCenter.set(center.x, center.z);

    // Bodies press the cover down and shove it the way they are travelling.
    const tracked = this.tracker.update(pushers, dt);
    for (const p of tracked) {
      const sp = Math.min(p.speed, 12);
      const lead = sp * 0.10;
      const dirX = sp > 0.4 ? p.vx / p.speed : 0;
      const dirZ = sp > 0.4 ? p.vz / p.speed : 0;
      this.disturb(p.x + dirX * lead, p.z + dirZ * lead, p.r, {
        press: clamp(0.55 + sp * 0.06, 0, 1),
        dirX, dirZ,
      });
    }

    if (this._trailHot > 0) {
      this._trailHot -= dt;
      this._decayTrail(dt);
      this._trailDirty = true;
    }
    if (this._trailDirty) { this.trailTex.needsUpdate = true; this._trailDirty = false; }

    if (center.distanceToSquared(this.center) > this.radius * this.radius * 0.09) {
      this.center.copy(center);
      this._scatterRing(this.near, center);
      this._scatterRing(this.far, center);
    }

    for (const ring of [this.near, this.far]) {
      const u = ring.mat.uniforms;
      u.uTime.value = this.time;
      syncWind(u);
      if (opts.bendGain) u.uBendGain.value = opts.bendGain;
    }
  }

  /*
   * The buffer is eight-bit, so a decay slower than one part in 255 per frame
   * is entirely truncation: `v * 0.99942` rounds down to `v - 1` every time,
   * and a cut meant to take half a minute to regrow disappears in four
   * seconds. Fast channels decay every frame; the slow one accumulates its
   * time and decays in steps big enough to actually be an exponential.
   */
  _decayTrail(dt) {
    const kPress = Math.exp(-dt * 2.6);     // springs back in about half a second
    const kDir = Math.exp(-dt * 2.0);
    this._cutAccum = (this._cutAccum || 0) + dt;
    const cutStep = this._cutAccum >= 0.4;
    const kCut = cutStep ? Math.exp(-this._cutAccum * 0.035) : 1;   // regrows over ~half a minute
    if (cutStep) this._cutAccum = 0;
    const d = this.trailData;
    for (let o = 0; o < d.length; o += 4) {
      d[o] = d[o] * kPress;
      if (cutStep) d[o + 1] = d[o + 1] * kCut;
      d[o + 2] = 128 + (d[o + 2] - 128) * kDir;
      d[o + 3] = 128 + (d[o + 3] - 128) * kDir;
    }
  }

  dispose() {
    if (ground.grass === this) ground.grass = null;
    // the next level builds its own; leaving this pointing at a disposed
    // heightfield makes every chip and decal land at the wrong altitude
    if (ground.terrain === this.terrain) ground.terrain = null;
    if (!this.mesh) return;
    for (const m of this.meshes) {
      m.geometry.dispose();
      m.material.dispose();
      m.parent?.remove(m);
    }
    this.meshes.length = 0;
    this.trailTex?.dispose();
    this.far?.mat.uniforms.uMap.value?.dispose();
    this.mesh = null;
  }
}

/** Let a sprite tile horizontally, so one card can hold several clumps. */
function repeating(tex) {
  tex.wrapS = THREE.RepeatWrapping;
  tex.needsUpdate = true;
  return tex;
}

/**
 * A blade: a strip `segments` tall, one quad wide, rooted at the origin and one
 * unit long. Everything else about its shape — taper, curvature, lean — happens
 * in the vertex shader, because all of it is per-instance.
 */
function bladeGeometry(segments = 4) {
  const rows = segments + 1;
  const pos = new Float32Array(rows * 2 * 3);
  const uv = new Float32Array(rows * 2 * 2);
  const idx = [];
  for (let r = 0; r < rows; r++) {
    const v = r / segments;
    for (let s = 0; s < 2; s++) {
      const k = r * 2 + s;
      pos[k * 3] = s ? 0.5 : -0.5;
      pos[k * 3 + 1] = v;
      pos[k * 3 + 2] = 0;
      uv[k * 2] = s;
      uv[k * 2 + 1] = v;
    }
    if (r < segments) {
      const a = r * 2, b = r * 2 + 1, c = a + 2, d = b + 2;
      idx.push(a, c, b, b, c, d);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setIndex(idx);
  return g;
}

/* ══════════════════════════════════════════════════════════════════════ */
/*  Water                                                                 */
/* ══════════════════════════════════════════════════════════════════════ */

const MAX_RIPPLES = 10;

const WATER_VERT = /* glsl */`
  #include <common>
  #include <fog_pars_vertex>
  uniform float uTime;
  varying vec3 vW; varying vec2 vUv; varying float vWave;

  void main(){
    vUv = uv;
    vec3 p = position;
    // world xz is unaffected by the vertical displacement, so it can be taken
    // before the wave is applied
    vec2 wxz = (modelMatrix * vec4(position.x, position.y, 0.0, 1.0)).xz;

    // Only the long swell goes in the vertices. The sheet is tessellated every
    // six metres or so, which cannot represent anything shorter — the impact
    // rings are a metre across and live in the fragment shader instead.
    float w = sin(wxz.x * 0.55 + uTime * 1.3) * 0.055
            + sin(wxz.y * 0.71 - uTime * 1.05) * 0.045
            + sin((wxz.x + wxz.y) * 0.23 + uTime * 0.6) * 0.09;

    p.z += w;
    vWave = w;
    vec4 wp = modelMatrix * vec4(p, 1.0);
    vW = wp.xyz;
    vec4 mvPosition = viewMatrix * wp;
    #include <fog_vertex>
    gl_Position = projectionMatrix * mvPosition;
  }
`;

const WATER_FRAG = /* glsl */`
  precision highp float;
  #include <common>
  #include <fog_pars_fragment>
  uniform float uTime; uniform vec3 uShallow; uniform vec3 uDeep; uniform vec3 uSunDir; uniform vec3 uSky;
  uniform vec4 uRipples[${MAX_RIPPLES}];    // world x, world z, start time, strength
  uniform float uRippleActive;
  varying vec3 vW; varying vec2 vUv; varying float vWave;
  float hash(vec2 p){ return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453); }
  float vnoise(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.-2.*f);
    return mix(mix(hash(i),hash(i+vec2(1,0)),f.x), mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x), f.y); }
  void main(){
    vec3 V = normalize(cameraPosition - vW);
    vec2 q = vW.xz*1.6;
    float n1 = vnoise(q + vec2(uTime*0.35, uTime*0.21));
    float n2 = vnoise(q*2.3 - vec2(uTime*0.27, uTime*0.41));
    vec3 N = normalize(vec3((n1-n2)*0.55, 1.0, (n2-n1)*0.55));

    // ── impact rings. Expanding wave fronts, tilting the surface along the
    // radius and throwing foam at the crest. Doing this here rather than in the
    // vertices is what lets a one-metre ring exist on a six-metre grid at all.
    float foamRing = 0.0;
    // The sheet is half a kilometre across and mostly nowhere near an impact,
    // so the ring loop is gated off entirely while the water is still.
    if(uRippleActive > 0.5){
      for(int i = 0; i < ${MAX_RIPPLES}; i++){
        vec4 r = uRipples[i];
        if(r.w <= 0.0) continue;
        float age = uTime - r.z;
        if(age < 0.0 || age > 2.6) continue;
        vec2 d = vW.xz - r.xy;
        float dist = length(d);
        float front = age * 3.6;
        float band = exp(-abs(dist - front) * 1.5);
        float decay = exp(-age * 1.35) * smoothstep(0.0, 0.10, age);
        float amp = band * decay * r.w;
        float phase = (dist - front) * 5.2;
        N.xz += (dist > 1e-4 ? d / dist : vec2(0.0)) * (cos(phase) * amp * 0.55);
        foamRing += amp * max(sin(phase), 0.0) * 0.5;
      }
    }
    N = normalize(N);

    float fres = pow(1.0 - clamp(dot(N,V),0.0,1.0), 3.2);
    vec3 base = mix(uDeep, uShallow, clamp(vWave*3.0+0.5,0.0,1.0));
    vec3 col = mix(base, uSky, fres*0.86);
    float spec = pow(max(dot(reflect(-normalize(uSunDir), N), V), 0.0), 90.0);
    col += vec3(1.0,0.95,0.85) * spec * 2.4;
    float foam = smoothstep(0.06, 0.12, abs(vWave)) * 0.16 + clamp(foamRing, 0.0, 1.4) * 0.5;
    col += foam;
    gl_FragColor = vec4(col, clamp(0.86 + fres*0.14 + foamRing*0.25, 0.0, 1.0));
    #include <fog_fragment>
  }
`;

export class Water {
  constructor(scene, opts = {}) {
    const size = opts.size ?? 520;
    const geo = new THREE.PlaneGeometry(size, size, 96, 96);
    this.time = 0;
    this._ripple = 0;
    const ripples = [];
    for (let i = 0; i < MAX_RIPPLES; i++) ripples.push(new THREE.Vector4(0, 0, -99, 0));
    this.mat = new THREE.ShaderMaterial({
      uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {}]),
      vertexShader: WATER_VERT, fragmentShader: WATER_FRAG,
      transparent: true, side: THREE.DoubleSide, depthWrite: false, fog: true,
    });
    Object.assign(this.mat.uniforms, {
      uTime: { value: 0 },
      uShallow: { value: new THREE.Color(opts.shallow ?? 0x2f7f96) },
      uDeep: { value: new THREE.Color(opts.deep ?? 0x0c2a3c) },
      uSunDir: { value: new THREE.Vector3(0.4, 0.7, 0.3) },
      uSky: { value: new THREE.Color(opts.sky ?? 0x9fc4e4) },
      uRipples: { value: ripples },
      uRippleActive: { value: 0 },
    });
    this.mesh = new THREE.Mesh(geo, this.mat);
    this.mesh.rotation.x = -Math.PI / 2;
    this.mesh.position.y = opts.level ?? 0;
    this.mesh.renderOrder = 3;
    this.level = opts.level ?? 0;
    scene.add(this.mesh);
    ground.water = this;
  }

  /** Something entered the water here. Rings spread from it and fade. */
  ripple(x, z, strength = 1) {
    const r = this.mat.uniforms.uRipples.value[this._ripple];
    this._ripple = (this._ripple + 1) % MAX_RIPPLES;
    r.set(x, z, this.time, clamp(strength, 0.05, 3));
  }

  update(dt, sunDir, skyColor) {
    this.time += dt;
    this.mat.uniforms.uTime.value = this.time;
    let active = 0;
    for (const r of this.mat.uniforms.uRipples.value) {
      if (r.w > 0 && this.time - r.z < 2.6) { active = 1; break; }
    }
    this.mat.uniforms.uRippleActive.value = active;
    if (sunDir) this.mat.uniforms.uSunDir.value.copy(sunDir);
    if (skyColor) this.mat.uniforms.uSky.value.copy(skyColor);
  }

  dispose() {
    if (ground.water === this) ground.water = null;
    this.mesh.geometry.dispose(); this.mat.dispose(); this.mesh.parent?.remove(this.mesh);
  }
}

/* ══════════════════════════════════════════════════════════════════════ */
/*  The air                                                               */
/* ══════════════════════════════════════════════════════════════════════ */

/**
 * Motes. Points, wind-driven, wrapped into a box that follows the camera, and
 * — the part that matters — lit by the sun rather than tinted a flat colour, so
 * they flare when you look toward it and vanish when you look away. That single
 * term is most of what separates dust in a sunbeam from grey confetti.
 */
class Motes {
  constructor(scene, opts) {
    this.count = Math.floor(opts.count ?? 900);
    if (this.count <= 0) { this.mesh = null; return; }
    const geo = new THREE.BufferGeometry();
    const pos = new Float32Array(this.count * 3);
    const seed = new Float32Array(this.count * 2);
    const span = opts.span ?? 90, height = opts.height ?? 24;
    for (let i = 0; i < this.count; i++) {
      pos[i * 3] = (rng() - 0.5) * span;
      pos[i * 3 + 1] = rng() * height;
      pos[i * 3 + 2] = (rng() - 0.5) * span;
      seed[i * 2] = rng();
      seed[i * 2 + 1] = rng();
    }
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('aSeed', new THREE.BufferAttribute(seed, 2));

    const uniforms = THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {}]);
    Object.assign(uniforms, windUniforms(), {
      uTime: { value: 0 },
      uCenter: { value: new THREE.Vector3() },
      uColor: { value: new THREE.Color(opts.color ?? 0xd8c8a8) },
      uSun: { value: new THREE.Color(1, 1, 1) },
      uSunDir: { value: new THREE.Vector3(0.4, 0.7, 0.3) },
      uSize: { value: opts.size ?? 22 },
      uOpacity: { value: opts.opacity ?? 0.30 },
      uSpan: { value: new THREE.Vector3(span, height, span) },
    });

    this.mat = new THREE.ShaderMaterial({
      uniforms, fog: true,
      vertexShader: /* glsl */`
        #include <common>
        #include <fog_pars_vertex>
        ${WIND_GLSL}
        attribute vec2 aSeed;
        uniform float uTime; uniform vec3 uCenter; uniform float uSize; uniform vec3 uSpan;
        uniform vec3 uSunDir;
        varying float vA; varying float vGlow;
        void main(){
          vec3 p = position;
          // carried by the wind, then wrapped into a box around the camera
          vec3 w = windAt(p.xz + uCenter.xz);
          p += w * (uTime * (0.55 + aSeed.x * 0.8));
          p.y += sin(uTime * 0.6 + aSeed.y * 11.0) * 0.7;
          // NB: "half" is a reserved word in GLSL ES; a variable named that
          // fails to compile the whole shader.
          vec3 halfSpan = uSpan * 0.5;
          p = mod(p - uCenter + halfSpan, uSpan) - halfSpan + uCenter;
          vec4 mv = modelViewMatrix * vec4(p, 1.0);
          float dist = max(-mv.z, 0.5);
          gl_PointSize = uSize * (0.6 + aSeed.x * 1.6) / dist;
          // A mote that wraps has to be invisible when it does, or the far edge
          // of the box is a line of dust winking in and out of existence.
          float edge = 1.0 - smoothstep(uSpan.x * 0.33, uSpan.x * 0.49,
                                        length(p.xz - uCenter.xz));
          vA = smoothstep(90.0, 10.0, dist) * (0.35 + aSeed.y * 0.65)
             * smoothstep(0.6, 3.0, dist) * edge;
          // forward scattering: a mote is a lens, and it is brightest when it
          // sits between you and the sun
          vec3 look = normalize(p - cameraPosition);
          vGlow = pow(clamp(dot(look, normalize(uSunDir)), 0.0, 1.0), 5.0);
          vec4 mvPosition = mv;
          #include <fog_vertex>
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */`
        precision highp float;
        #include <common>
        #include <fog_pars_fragment>
        uniform vec3 uColor; uniform vec3 uSun; uniform float uOpacity;
        varying float vA; varying float vGlow;
        void main(){
          vec2 c = gl_PointCoord - 0.5;
          float d = 1.0 - clamp(length(c) * 2.0, 0.0, 1.0);
          float a = d * d * vA * uOpacity;
          if(a < 0.003) discard;
          vec3 col = mix(uColor, uSun, 0.35) * (1.0 + vGlow * 2.6);
          gl_FragColor = vec4(col, a);
          #include <fog_fragment>
        }`,
      transparent: true, depthWrite: false, blending: THREE.NormalBlending,
    });
    this.mesh = new THREE.Points(geo, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.matrixAutoUpdate = false;
    this.mesh.renderOrder = 6;
    scene.add(this.mesh);
  }
  update(t, center, sun, sunDir) {
    if (!this.mesh) return;
    const u = this.mat.uniforms;
    u.uTime.value = t;
    u.uCenter.value.copy(center);
    if (sun) u.uSun.value.copy(sun);
    if (sunDir) u.uSunDir.value.copy(sunDir);
    syncWind(u);
  }
  dispose() {
    if (!this.mesh) return;
    this.mesh.geometry.dispose(); this.mat.dispose(); this.mesh.parent?.remove(this.mesh);
  }
}

/**
 * Everything the wind is carrying that is too big to be a point: sheets of sand
 * skimming the ground, and leaves, ash and seed heads tumbling through the air.
 * One instanced quad system, one draw call, two behaviours picked per instance.
 */
class Windborne {
  constructor(scene, opts) {
    this.sheets = Math.max(0, Math.floor(opts.sheets ?? 0));
    this.flecks = Math.max(0, Math.floor(opts.flecks ?? 0));
    this.count = this.sheets + this.flecks;
    if (this.count <= 0) { this.mesh = null; return; }
    this.span = opts.span ?? 76;

    const quad = new THREE.PlaneGeometry(1, 1);
    const geo = new THREE.InstancedBufferGeometry();
    geo.index = quad.index;
    geo.attributes.position = quad.attributes.position;
    geo.attributes.uv = quad.attributes.uv;
    geo.instanceCount = this.count;

    const aHome = new Float32Array(this.count * 4);   // x, y, z, size
    const aSeed = new Float32Array(this.count * 4);   // seed, kind, drift, spin
    for (let i = 0; i < this.count; i++) {
      const sheet = i < this.sheets;
      aHome[i * 4] = (rng() - 0.5) * this.span;
      aHome[i * 4 + 1] = sheet ? rng() * 0.9 : 0.6 + rng() * 12;
      aHome[i * 4 + 2] = (rng() - 0.5) * this.span;
      aHome[i * 4 + 3] = sheet ? 2.4 + rng() * 5.5 : 0.06 + rng() * 0.11;
      aSeed[i * 4] = rng();
      aSeed[i * 4 + 1] = sheet ? 0 : 1;
      aSeed[i * 4 + 2] = 0.6 + rng() * 0.9;
      aSeed[i * 4 + 3] = (rng() - 0.5) * 5;
    }
    geo.setAttribute('aHome', new THREE.InstancedBufferAttribute(aHome, 4));
    geo.setAttribute('aSeed', new THREE.InstancedBufferAttribute(aSeed, 4));

    const uniforms = THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {}]);
    Object.assign(uniforms, windUniforms(), {
      uMap: { value: opts.map || smokeSprite(128) },
      uTime: { value: 0 },
      uCenter: { value: new THREE.Vector3() },
      uSpan: { value: this.span },
      uSheet: { value: new THREE.Color(opts.sheetColor ?? 0xd8c8a8) },
      uFleck: { value: new THREE.Color(opts.fleckColor ?? 0x9a8b64) },
      uOpacity: { value: opts.opacity ?? 0.3 },
      uGround: { value: 0 },
    });

    this.mat = new THREE.ShaderMaterial({
      uniforms, fog: true,
      vertexShader: /* glsl */`
        #include <common>
        #include <fog_pars_vertex>
        ${WIND_GLSL}
        attribute vec4 aHome; attribute vec4 aSeed;
        uniform float uTime; uniform vec3 uCenter; uniform float uSpan; uniform float uGround;
        varying vec2 vUv; varying float vKind; varying float vA;
        void main(){
          vUv = uv;
          vKind = aSeed.y;
          vec3 home = aHome.xyz;
          vec3 w = windAt(home.xz + uCenter.xz);
          float speed = length(w.xz);

          vec3 p = home;
          p.xz += w.xz * uTime * aSeed.z;
          p.xz = mod(p.xz - uCenter.xz + uSpan * 0.5, uSpan) - uSpan * 0.5 + uCenter.xz;
          if(vKind < 0.5){
            // a sheet skims the ground and only exists when it is blowing
            p.y = uGround + home.y * (0.4 + speed * 0.25);
          } else {
            // a fleck tumbles and sinks
            p.y = uGround + home.y + sin(uTime * (0.5 + aSeed.x) + aSeed.x * 6.28) * 0.9
                - mod(uTime * 0.5 * aSeed.z, 12.0);
            p.y = uGround + mod(p.y - uGround, 12.0);
          }

          float size = aHome.w * (vKind < 0.5 ? clamp(speed * 0.55, 0.0, 1.6) : 1.0);
          vec3 camRight = vec3(modelViewMatrix[0][0], modelViewMatrix[1][0], modelViewMatrix[2][0]);
          vec3 camUp    = vec3(modelViewMatrix[0][1], modelViewMatrix[1][1], modelViewMatrix[2][1]);
          vec2 q = position.xy;
          if(vKind < 0.5){
            // A sheet is billboarded about the WIND axis, not about the camera:
            // it stays a long low streak lying along the gust however you look
            // at it, instead of collapsing to an invisible edge-on plane the
            // moment you crouch — which is exactly when you want to see it.
            vec2 d = speed > 1e-4 ? w.xz / speed : vec2(1.0, 0.0);
            vec3 along = vec3(d.x, 0.0, d.y);
            vec3 toCam = normalize(cameraPosition - p);
            vec3 perp = normalize(cross(along, toCam) + vec3(1e-5));
            vec3 rise = normalize(cross(perp, along));
            p += along * (q.x * size * 3.0) + rise * (q.y * size * 0.34);
            vA = clamp(speed * 0.42 - 0.15, 0.0, 1.0);
          } else {
            float sp = uTime * aSeed.w + aSeed.x * 6.2831;
            float cs = cos(sp), sn = sin(sp);
            q = vec2(q.x * cs - q.y * sn, q.x * sn + q.y * cs);
            // a flat fleck edge-on nearly disappears; that flicker is the tell
            float face = abs(cos(sp * 0.7));
            p += camRight * (q.x * size * (0.25 + face)) + camUp * (q.y * size);
            // fade out before it wraps back to the ground, or it teleports
            vA = (0.55 + 0.45 * face) * smoothstep(12.0, 9.0, p.y - uGround);
          }
          // and fade at the edge of the box everything is being wrapped into
          vA *= 1.0 - smoothstep(uSpan * 0.33, uSpan * 0.49, length(p.xz - uCenter.xz));
          vec4 mvPosition = modelViewMatrix * vec4(p, 1.0);
          #include <fog_vertex>
          gl_Position = projectionMatrix * mvPosition;
        }`,
      fragmentShader: /* glsl */`
        precision highp float;
        #include <common>
        #include <fog_pars_fragment>
        uniform sampler2D uMap; uniform vec3 uSheet; uniform vec3 uFleck; uniform float uOpacity;
        varying vec2 vUv; varying float vKind; varying float vA;
        void main(){
          float t = texture2D(uMap, vUv).a;
          float a = t * vA * uOpacity * (vKind < 0.5 ? 1.0 : 2.6);
          if(a < 0.004) discard;
          gl_FragColor = vec4(vKind < 0.5 ? uSheet : uFleck, a);
          #include <fog_fragment>
        }`,
      transparent: true, depthWrite: false, side: THREE.DoubleSide,
    });

    this.mesh = new THREE.Mesh(geo, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.matrixAutoUpdate = false;
    this.mesh.renderOrder = 7;
    scene.add(this.mesh);
  }
  update(t, center) {
    if (!this.mesh) return;
    const u = this.mat.uniforms;
    u.uTime.value = t;
    u.uCenter.value.copy(center);
    u.uGround.value = center.y;
    syncWind(u);
  }
  dispose() {
    if (!this.mesh) return;
    this.mesh.geometry.dispose(); this.mat.dispose(); this.mesh.parent?.remove(this.mesh);
  }
}

/**
 * Distance. Fog alone gives you a flat wash; what reads as depth is fog with
 * STRUCTURE in it — banks of haze at different ranges, slightly brighter on the
 * sun side, drifting. A dozen very soft billboards is all it takes.
 */
class Haze {
  constructor(scene, opts) {
    this.count = Math.max(0, Math.floor(opts.count ?? 14));
    if (this.count <= 0) { this.mesh = null; return; }
    const quad = new THREE.PlaneGeometry(1, 1);
    const geo = new THREE.InstancedBufferGeometry();
    geo.index = quad.index;
    geo.attributes.position = quad.attributes.position;
    geo.attributes.uv = quad.attributes.uv;
    geo.instanceCount = this.count;

    const aBank = new Float32Array(this.count * 4);   // angle, distance, height, size
    const aSeed = new Float32Array(this.count);
    for (let i = 0; i < this.count; i++) {
      aBank[i * 4] = (i / this.count) * TAU + rng() * 0.4;
      aBank[i * 4 + 1] = 55 + Math.pow(rng(), 0.7) * 145;
      aBank[i * 4 + 2] = 2 + rng() * 22;
      aBank[i * 4 + 3] = 60 + rng() * 90;
      aSeed[i] = rng();
    }
    geo.setAttribute('aBank', new THREE.InstancedBufferAttribute(aBank, 4));
    geo.setAttribute('aSeed', new THREE.InstancedBufferAttribute(aSeed, 1));

    this.mat = new THREE.ShaderMaterial({
      uniforms: {
        uMap: { value: opts.map || smokeSprite(128) },
        uTime: { value: 0 },
        uCenter: { value: new THREE.Vector3() },
        uColor: { value: new THREE.Color(opts.color ?? 0xc9b391) },
        uSunColor: { value: new THREE.Color(1, 1, 1) },
        uSunDir: { value: new THREE.Vector3(0.4, 0.7, 0.3) },
        uOpacity: { value: opts.opacity ?? 0.085 },
      },
      vertexShader: /* glsl */`
        attribute vec4 aBank; attribute float aSeed;
        uniform float uTime; uniform vec3 uCenter; uniform vec3 uSunDir;
        varying vec2 vUv; varying float vSun; varying float vA;
        void main(){
          vUv = uv;
          float a = aBank.x + uTime * (0.004 + aSeed * 0.006);
          vec3 p = uCenter + vec3(cos(a) * aBank.y, aBank.z + sin(uTime * 0.09 + aSeed * 6.28) * 1.6, sin(a) * aBank.y);
          vec3 camRight = vec3(modelViewMatrix[0][0], modelViewMatrix[1][0], modelViewMatrix[2][0]);
          vec3 camUp    = vec3(modelViewMatrix[0][1], modelViewMatrix[1][1], modelViewMatrix[2][1]);
          p += camRight * (position.x * aBank.w) + camUp * (position.y * aBank.w * 0.34);
          vec3 toBank = normalize(vec3(cos(a), 0.0, sin(a)));
          vSun = pow(clamp(dot(toBank, normalize(uSunDir)), 0.0, 1.0), 3.0);
          vA = 0.5 + aSeed * 0.5;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
        }`,
      fragmentShader: /* glsl */`
        precision highp float;
        uniform sampler2D uMap; uniform vec3 uColor; uniform vec3 uSunColor; uniform float uOpacity;
        varying vec2 vUv; varying float vSun; varying float vA;
        void main(){
          float t = texture2D(uMap, vUv).a;
          float a = t * uOpacity * vA;
          if(a < 0.002) discard;
          gl_FragColor = vec4(mix(uColor, uSunColor, vSun * 0.55) * (1.0 + vSun * 0.6), a);
        }`,
      transparent: true, depthWrite: false, depthTest: true, side: THREE.DoubleSide,
    });
    this.mesh = new THREE.Mesh(geo, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.matrixAutoUpdate = false;
    this.mesh.renderOrder = 2;
    scene.add(this.mesh);
  }
  update(t, center, sunColor, sunDir) {
    if (!this.mesh) return;
    const u = this.mat.uniforms;
    u.uTime.value = t;
    u.uCenter.value.copy(center);
    if (sunColor) u.uSunColor.value.copy(sunColor);
    if (sunDir) u.uSunDir.value.copy(sunDir);
  }
  dispose() {
    if (!this.mesh) return;
    this.mesh.geometry.dispose(); this.mat.dispose(); this.mesh.parent?.remove(this.mesh);
  }
}

/**
 * Heat shimmer. There is no scene colour to refract in a forward pass, so this
 * does what the air actually does: hot ground bends sky light up into your eye,
 * which is why a mirage is sky-coloured and only appears at a grazing angle.
 * Standing sheets, sky-tinted, wobbling, and invisible from above.
 */
class Shimmer {
  constructor(scene, opts) {
    this.count = Math.max(0, Math.floor(opts.count ?? 0));
    if (this.count <= 0) { this.mesh = null; return; }
    const quad = new THREE.PlaneGeometry(1, 1, 1, 3);
    const geo = new THREE.InstancedBufferGeometry();
    geo.index = quad.index;
    geo.attributes.position = quad.attributes.position;
    geo.attributes.uv = quad.attributes.uv;
    geo.instanceCount = this.count;

    const aCell = new Float32Array(this.count * 4);
    for (let i = 0; i < this.count; i++) {
      aCell[i * 4] = (i / this.count) * TAU + rng() * 0.6;   // bearing
      aCell[i * 4 + 1] = 14 + Math.pow(rng(), 0.75) * 40;    // range
      aCell[i * 4 + 2] = 2.6 + rng() * 5.6;                  // width
      aCell[i * 4 + 3] = rng();
    }
    geo.setAttribute('aCell', new THREE.InstancedBufferAttribute(aCell, 4));

    this.mat = new THREE.ShaderMaterial({
      uniforms: {
        uMap: { value: opts.map || smokeSprite(128) },
        uTime: { value: 0 },
        uCenter: { value: new THREE.Vector3() },
        uColor: { value: new THREE.Color(opts.color ?? 0xbfd4ec) },
        uOpacity: { value: opts.opacity ?? 0.09 },
      },
      vertexShader: /* glsl */`
        attribute vec4 aCell;
        uniform float uTime; uniform vec3 uCenter;
        varying vec2 vUv; varying float vA;
        void main(){
          vUv = uv;
          // A mirage is not an object on the ground, it is a viewing angle: it
          // always sits at the same apparent distance and it travels with you.
          // Positioning it that way is both more correct and free of the pop a
          // world-anchored grid gets every time the player crosses a cell.
          float bearing = aCell.x + uTime * (0.004 + aCell.w * 0.005);
          float range = aCell.y;
          float h = 0.8 + aCell.w * 1.5;
          vec3 p = vec3(uCenter.x + cos(bearing) * range, uCenter.y,
                        uCenter.z + sin(bearing) * range);
          vec3 toCam = vec3(cameraPosition.x - p.x, 0.0, cameraPosition.z - p.z);
          float dist = length(toCam);
          toCam = dist > 1e-4 ? toCam / dist : vec3(0.0, 0.0, 1.0);
          vec3 side = vec3(-toCam.z, 0.0, toCam.x);
          float wob = sin(uTime * 3.1 + aCell.w * 6.283 + uv.y * 5.0) * 0.10 * uv.y
                    + sin(uTime * 5.7 - aCell.w * 3.1 + uv.y * 9.0) * 0.05 * uv.y;
          p += side * ((position.x + wob) * aCell.z) + vec3(0.0, uv.y * h, 0.0);
          // grazing angles only: from above there is nothing to see
          float grazing = 1.0 - clamp(abs(normalize(cameraPosition - p).y) * 2.6, 0.0, 1.0);
          vA = grazing * smoothstep(72.0, 18.0, dist) * smoothstep(6.0, 13.0, dist);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
        }`,
      fragmentShader: /* glsl */`
        precision highp float;
        uniform sampler2D uMap; uniform vec3 uColor; uniform float uOpacity; uniform float uTime;
        varying vec2 vUv; varying float vA;
        void main(){
          float t = texture2D(uMap, vUv * vec2(1.0, 0.7) + vec2(uTime * 0.06, uTime * 0.11)).a;
          float a = t * vA * uOpacity * (1.0 - vUv.y) * 1.6;
          if(a < 0.002) discard;
          gl_FragColor = vec4(uColor, a);
        }`,
      transparent: true, depthWrite: false, side: THREE.DoubleSide,
    });
    this.mesh = new THREE.Mesh(geo, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.matrixAutoUpdate = false;
    this.mesh.renderOrder = 5;
    scene.add(this.mesh);
  }
  update(t, center) {
    if (!this.mesh) return;
    this.mat.uniforms.uTime.value = t;
    this.mat.uniforms.uCenter.value.copy(center);
  }
  dispose() {
    if (!this.mesh) return;
    this.mesh.geometry.dispose(); this.mat.dispose(); this.mesh.parent?.remove(this.mesh);
  }
}

/**
 * The air, as one object. The level only describes its dust; everything else is
 * inferred from what the level already built — whether there is a sky overhead,
 * what colour the fog is, how hard the sun is hitting. Indoors that means motes
 * and nothing else; out on the dunes it means sand sheets, mirage and haze.
 */
export class Atmosphere {
  constructor(scene, opts = {}) {
    this.scene = scene;
    this.time = 0;
    const density = clamp(opts.density ?? 1, 0, 2);
    const outdoor = opts.outdoor ?? isOutdoor(scene);
    const lights = sceneLights(scene);
    this.sun = lights.sun;
    this.hemi = lights.hemi;
    this.sunDir = new THREE.Vector3(0.4, 0.7, 0.3);
    this._readSun();
    const fog = fogColorOf(scene);
    const sunPower = this.sun ? this.sun.intensity : 0;
    const dust = new THREE.Color(opts.color ?? 0xd8c8a8);
    // one soft blob, baked once, shared by every layer that wants one — the
    // fbm bake is the most expensive thing in this constructor by far
    this.puff = smokeSprite(128);

    this.motes = new Motes(scene, {
      count: Math.floor((opts.count ?? 900) * density),
      color: dust, size: opts.size ?? 22, opacity: opts.opacity ?? 0.30,
      span: outdoor ? 90 : 56, height: outdoor ? 24 : 14,
    });

    this.windborne = new Windborne(scene, {
      map: this.puff,
      sheets: outdoor ? Math.floor(70 * density) : 0,
      flecks: Math.floor((outdoor ? 150 : 60) * density),
      sheetColor: dust,
      fleckColor: _col.copy(dust).multiplyScalar(0.62).getHex(),
      opacity: (opts.opacity ?? 0.3) * 0.85,
      span: 76,
    });

    this.haze = new Haze(scene, {
      map: this.puff,
      count: outdoor ? Math.max(6, Math.floor(16 * density)) : 0,
      color: fog, opacity: 0.075,
    });

    this.shimmer = new Shimmer(scene, {
      map: this.puff,
      // only where the ground is genuinely being cooked
      count: outdoor && sunPower > 5 ? Math.floor(46 * density) : 0,
      color: this.hemi ? this.hemi.color.clone() : new THREE.Color(0xbfd4ec),
      opacity: 0.10,
    });

    this.parts = [this.motes, this.windborne, this.haze, this.shimmer];
    // the legacy handle — anything that looked for `.mesh` still finds one
    this.mesh = this.motes.mesh;
    this.count = this.motes.count;
  }

  /**
   * Where the sun actually is. NOT `sun.position` — the shadow rig walks the
   * light around with the player to keep the ortho frustum tight, so its
   * position is a point twenty metres away, not a direction. The direction is
   * the light relative to what it is aimed at.
   */
  _readSun() {
    if (!this.sun) { _col.setRGB(1, 1, 1); return; }
    _v1.copy(this.sun.position);
    if (this.sun.target) _v1.sub(this.sun.target.position);
    if (_v1.lengthSq() > 1e-8) this.sunDir.copy(_v1).normalize();
    _col.copy(this.sun.color).multiplyScalar(clamp(this.sun.intensity / 6, 0.2, 1.6));
  }

  update(dt, center) {
    this.time += dt;
    wind.update(dt);
    this._readSun();
    this.motes.update(this.time, center, _col, this.sunDir);
    this.windborne.update(this.time, center);
    this.haze.update(this.time, center, _col, this.sunDir);
    this.shimmer.update(this.time, center);
  }

  /** Legacy hook: point the shared wind with a world vector. */
  setWind(v) { wind.setFromVector(v); }

  dispose() {
    for (const p of this.parts) p.dispose();
    this.parts.length = 0;
    this.puff?.dispose();
    this.puff = null;
    this.mesh = null;
  }
}
